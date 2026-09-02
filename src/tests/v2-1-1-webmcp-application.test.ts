import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import {
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  TRUSTED_SYSTEM_AUTHORITY_V211,
  partyAuthorityV211,
  type CaseEnvelopeV211,
  type FormationRequirementV211,
  type PartyIdV211,
} from '../v2-1-1/case-envelope.js';
import {
  TRUSTED_CONTROLLED_DISCLOSURE_APPLICATION_V211,
  openControlledDisclosureV211,
} from '../v2-1-1/controlled-disclosure.js';
import {
  applyEnvelopeCeremonyCommandV211,
  ceremonyCommandForV211,
  createInitialCaseEnvelopeV211,
  type EnvelopeCeremonyOperationV211,
} from '../v2-1-1/envelope-ceremony.js';
import {
  applyExternalRelaySubmissionV211,
  rebaseExternalRelaySubmissionV211,
} from '../v2-1-1/external-relay-submission.js';
import {
  FORMATION_PERSISTENCE_CONTRACT_VERSION_V211,
  type ActiveFormationContextV211,
  type CommitControlledDisclosureInputV211,
  type CommitControlledDisclosureResultV211,
  type CommitExternalRelaySubmissionInputV211,
  type CommitExternalRelaySubmissionResultV211,
  type FormationPartyPersistenceContextV211,
  type FormationReplayRecordV211,
  type FormationReplayResponseV211,
  type StoredFormationDisputeV211,
} from '../v2-1-1/formation-persistence.js';
import {
  createV211PartyCaseService,
  projectPartyCaseStateV211,
  type FormationRelayRepositoryV211,
  type RelayApplicationIdsV211,
  type V211PartyCaseService,
} from '../v2-1-1/webmcp-application.js';
import { projectPartyFormationV211 } from '../v2-1-1/party-projection.js';
import {
  PERMITTED_CASE_STATE_SLOTS,
  decodeCaseStateResponse,
  decodeCaseServiceResult,
  type CaseServicePort,
} from '../webmcp/public-contract.js';
import type { CompilerInput, CompilerOutput } from '../webmcp/core/compiler-contract.js';
import type { CompileOptions, SemanticCompilerPort } from '../webmcp/runtime/compiler-port.js';
import {
  ScriptedSemanticCompiler,
  type CompilerScript,
} from '../webmcp/runtime/scripted-compiler.js';
import { createDarkVersionedCaseService } from '../v2-1-1/versioned-case-service.js';
import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';

const SUBJECT_A = 'subject_party_a';
const SUBJECT_B = 'subject_party_b';
let sequence = 0;

function unique(label: string): string {
  sequence += 1;
  return `${label}_${sequence}`;
}

function requirement(id: string, required = true): Omit<FormationRequirementV211, 'party_id'> {
  return {
    requirement_id: id,
    label: id,
    prompt: `Please answer ${id}.`,
    required,
    satisfying_types: ['narrative_fact'],
    min_propositions: 1,
    max_propositions: null,
    adverse_fact_probe: false,
    reopened_from: null,
  };
}

function ceremony(
  envelope: CaseEnvelopeV211,
  authority: Parameters<typeof applyEnvelopeCeremonyCommandV211>[0]['execution_authority'],
  operation: EnvelopeCeremonyOperationV211,
): CaseEnvelopeV211 {
  const result = applyEnvelopeCeremonyCommandV211({
    envelope,
    command: ceremonyCommandForV211(envelope, unique('ceremony'), operation),
    execution_authority: authority,
  });
  if (result.status !== 'applied') throw new Error(result.message);
  return result.envelope;
}

function baseEnvelope(disputeId = unique('dispute_app')): CaseEnvelopeV211 {
  let envelope = createInitialCaseEnvelopeV211(disputeId, {
    party_a: [requirement('req_a'), requirement('req_a_optional', false)],
    party_b: [requirement('req_b'), requirement('req_b_optional', false)],
  });
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
    type: 'bind_party',
    party_slot: 'party_a',
    authenticated_subject_id: SUBJECT_A,
    binding_event_id: unique('binding_party_a'),
  });
  return ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
    type: 'bind_party',
    party_slot: 'party_b',
    authenticated_subject_id: SUBJECT_B,
    binding_event_id: unique('binding_party_b'),
  });
}

function replayResponse(
  envelope: CaseEnvelopeV211,
  partyId: PartyIdV211,
  submission: CommitExternalRelaySubmissionInputV211['submission'],
  applied: Extract<ReturnType<typeof applyExternalRelaySubmissionV211>, { status: 'applied' }>,
): FormationReplayResponseV211 {
  const cursor = envelope.control.party_views[partyId];
  return {
    persistence_contract_version: FORMATION_PERSISTENCE_CONTRACT_VERSION_V211,
    dispute_id: envelope.control.case_id,
    party_id: partyId,
    submission_id: submission.submission_id,
    source_turn_id: submission.source_turn.turn_id,
    accepted_position_ids: [...applied.result.accepted_position_ids],
    superseded_position_ids: [...applied.result.superseded_position_ids],
    opened_clarification_ids: [...applied.result.opened_clarification_ids],
    resolved_clarification_ids: [...applied.result.resolved_clarification_ids],
    challenge_ids: [...applied.result.challenge_ids],
    challenge_response_ids: [...applied.result.challenge_response_ids],
    warnings: [...applied.result.warnings],
    resulting_internal_envelope_version: envelope.control.envelope_version,
    resulting_internal_envelope_hash: envelope.control.envelope_hash,
    resulting_party_visible_version: cursor.party_visible_version,
    resulting_party_projection_hash: cursor.party_projection_hash,
  };
}

class MemoryFormationRepository implements FormationRelayRepositoryV211 {
  envelope: CaseEnvelopeV211;
  readonly replays = new Map<string, FormationReplayRecordV211>();
  readonly issued = new WeakSet<object>();

  constructor(envelope: CaseEnvelopeV211) {
    this.envelope = cloneCanonical(envelope);
  }

  replace(envelope: CaseEnvelopeV211): void {
    this.envelope = cloneCanonical(envelope);
  }

  stored(): StoredFormationDisputeV211 {
    return {
      envelope: cloneCanonical(this.envelope),
      internal_envelope_version: this.envelope.control.envelope_version,
      internal_envelope_hash: this.envelope.control.envelope_hash,
      created_at_ms: 1,
      updated_at_ms: this.envelope.control.envelope_version,
    };
  }

  async findById(disputeId: string): Promise<StoredFormationDisputeV211 | null> {
    return disputeId === this.envelope.control.case_id ? this.stored() : null;
  }

  async listActiveContextsForPrincipal(subjectId: string): Promise<ActiveFormationContextV211[]> {
    const partyId = this.partyFor(subjectId);
    if (!partyId) return [];
    const cursor = this.envelope.control.party_views[partyId];
    return [
      {
        dispute_id: this.envelope.control.case_id,
        party_id: partyId,
        internal_envelope_version: this.envelope.control.envelope_version,
        internal_envelope_hash: this.envelope.control.envelope_hash,
        party_visible_version: cursor.party_visible_version,
        party_projection_hash: cursor.party_projection_hash,
      },
    ];
  }

  async resolvePartyContext(
    disputeId: string,
    subjectId: string,
  ): Promise<FormationPartyPersistenceContextV211 | null> {
    if (disputeId !== this.envelope.control.case_id) return null;
    const partyId = this.partyFor(subjectId);
    if (!partyId) return null;
    const cursor = this.envelope.control.party_views[partyId];
    const context = Object.freeze({
      dispute_id: disputeId,
      party_id: partyId,
      authenticated_subject_id: subjectId,
      internal_envelope_version: this.envelope.control.envelope_version,
      internal_envelope_hash: this.envelope.control.envelope_hash,
      party_visible_version: cursor.party_visible_version,
      party_projection_hash: cursor.party_projection_hash,
    });
    this.issued.add(context);
    return context;
  }

  async readReplayRecord(
    context: FormationPartyPersistenceContextV211,
    clientTurnId: string,
  ): Promise<FormationReplayRecordV211 | null> {
    if (!this.issued.has(context)) return null;
    return cloneCanonical(
      this.replays.get(`${context.dispute_id}|${context.party_id}|${clientTurnId}`) ?? null,
    );
  }

  async commitExternalRelaySubmission(
    input: CommitExternalRelaySubmissionInputV211,
  ): Promise<CommitExternalRelaySubmissionResultV211> {
    if (!this.issued.has(input.context)) return { status: 'unauthorized', replayed: false };
    const key = `${input.context.dispute_id}|${input.context.party_id}|${input.submission.source_turn.client_turn_id}`;
    const replay = this.replays.get(key);
    if (replay) {
      return replay.request_fingerprint === input.submission.source_turn.request_fingerprint
        ? {
            status: 'replayed',
            replayed: true,
            stored: this.stored(),
            response: cloneCanonical(replay.response),
          }
        : { status: 'idempotency_conflict', replayed: false };
    }
    let submission = input.submission;
    let rebased = false;
    if (
      submission.base_internal_envelope_version !== this.envelope.control.envelope_version ||
      submission.base_internal_envelope_hash !== this.envelope.control.envelope_hash
    ) {
      const next = rebaseExternalRelaySubmissionV211(submission, this.envelope);
      if (!next) return { status: 'conflict', replayed: false, current: this.stored() };
      submission = next;
      rebased = true;
    }
    const applied = applyExternalRelaySubmissionV211({
      envelope: this.envelope,
      submission,
      execution_authority: partyAuthorityV211(
        this.envelope,
        input.context.party_id,
        'external_relay',
      ),
    });
    if (applied.status === 'rejected') {
      return {
        status: 'domain_rejected',
        replayed: false,
        reason_code: applied.reason_code,
        message: applied.message,
      };
    }
    this.envelope = cloneCanonical(applied.envelope);
    const response = replayResponse(this.envelope, input.context.party_id, submission, applied);
    this.replays.set(key, {
      dispute_id: input.context.dispute_id,
      party_id: input.context.party_id,
      client_turn_id: submission.source_turn.client_turn_id,
      request_fingerprint: submission.source_turn.request_fingerprint,
      response,
      recorded_at_ms: input.recorded_at_ms,
    });
    return {
      status: 'committed',
      replayed: false,
      hidden_state_rebased: rebased,
      stored: this.stored(),
      response,
    };
  }

  async commitControlledDisclosure(
    input: CommitControlledDisclosureInputV211,
  ): Promise<CommitControlledDisclosureResultV211> {
    if (
      input.dispute_id !== this.envelope.control.case_id ||
      input.expected_internal_envelope_version !== this.envelope.control.envelope_version ||
      input.expected_internal_envelope_hash !== this.envelope.control.envelope_hash
    ) {
      return { status: 'conflict', current: this.stored() };
    }
    const applied = applyEnvelopeCeremonyCommandV211({
      envelope: this.envelope,
      command: ceremonyCommandForV211(this.envelope, input.command_id, {
        type: 'open_controlled_disclosure',
      }),
      execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
    });
    if (applied.status === 'rejected') {
      return {
        status: 'domain_rejected',
        reason_code: applied.reason_code,
        message: applied.message,
      };
    }
    this.envelope = cloneCanonical(applied.envelope);
    return { status: 'committed', stored: this.stored() };
  }

  private partyFor(subjectId: string): PartyIdV211 | null {
    for (const partyId of ['party_a', 'party_b'] as const) {
      if (this.envelope.parties[partyId].authenticated_subject_id === subjectId) return partyId;
    }
    return null;
  }
}

function ids(): RelayApplicationIdsV211 {
  return { next: (kind, partyId) => unique(`${kind}_${partyId}`) };
}

function standardScript(): CompilerScript {
  return (input) => ({
    verdict: 'accepted_candidates',
    assertions: input.turn.in_reply_to.map((requirementId) => ({
      quote: input.turn.payload.answer.text,
      requirement_id: requirementId,
      type: 'narrative_fact',
      epistemic_strength: 'asserted_confident',
      statement: input.turn.payload.answer.text,
      supersedes_candidate: null,
    })),
  });
}

function serviceFor(
  repository: MemoryFormationRepository,
  partyId: PartyIdV211,
  compiler: SemanticCompilerPort = new ScriptedSemanticCompiler(standardScript()),
): V211PartyCaseService {
  return createV211PartyCaseService({
    authenticated_subject_id: partyId === 'party_a' ? SUBJECT_A : SUBJECT_B,
    repository,
    compiler,
    review_url: (id) => `https://dark.invalid/cases/${id}/review`,
    ids: ids(),
    clock: { now: () => 1_788_336_000_000 + sequence++ },
    salts: { next: () => `0123456789abcdef${unique('salt')}` },
    relaying_agent: 'test-relay',
  });
}

async function get(service: V211PartyCaseService, disputeId: string) {
  const result = await service.getCaseState({ case_id: disputeId });
  if (!result.ok) throw new Error(result.error.message);
  return result.case;
}

async function submit(
  service: V211PartyCaseService,
  disputeId: string,
  inReplyTo: string[],
  answer: string,
  clientTurnId = unique('client_turn'),
) {
  const state = await get(service, disputeId);
  return service.submitTurn({
    case_id: disputeId,
    expected_case_version: state.case_version,
    in_reply_to: inReplyTo,
    payload: { context: [], answer: { role: 'user', text: answer } },
    client_turn_id: clientTurnId,
  });
}

async function completeAndDisclose(input: {
  repository: MemoryFormationRepository;
  a: V211PartyCaseService;
  b: V211PartyCaseService;
}): Promise<void> {
  const id = input.repository.envelope.control.case_id;
  expect(await submit(input.a, id, ['req_a'], 'Party A account.')).toMatchObject({ ok: true });
  expect(await submit(input.b, id, ['req_b'], 'Party B account.')).toMatchObject({ ok: true });
  const result = await openControlledDisclosureV211({
    authority: TRUSTED_CONTROLLED_DISCLOSURE_APPLICATION_V211,
    repository: input.repository,
    dispute_id: id,
  });
  expect(result.status).toBe('committed');
}

describe('V2.1.1 dark party-scoped WebMCP application', () => {
  it('keeps both embargoes byte-stable and emits exactly the frozen twelve slots', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const id = repository.envelope.control.case_id;
    const compilerA = new ScriptedSemanticCompiler(standardScript());
    const a = serviceFor(repository, 'party_a', compilerA);
    const b = serviceFor(repository, 'party_b');
    const beforeA = await get(a, id);
    const beforeAProjection = canonicalSerialize(
      projectPartyFormationV211(repository.envelope, 'party_a'),
    );
    expect(beforeA.case_version).toBe(
      repository.envelope.control.party_views.party_a.party_visible_version,
    );
    expect(beforeA.unresolved_requirement_count).toBe(1);
    expect(await submit(b, id, ['req_b'], 'B supplied a hidden account.')).toMatchObject({
      ok: true,
    });
    const afterA = await get(a, id);
    expect(canonicalSerialize(afterA)).toBe(canonicalSerialize(beforeA));
    expect(canonicalSerialize(projectPartyFormationV211(repository.envelope, 'party_a'))).toBe(
      beforeAProjection,
    );
    expect(afterA.recent_interpretations).toEqual([]);
    expect(canonicalSerialize(afterA)).not.toContain('internal_envelope');
    expect(canonicalSerialize(afterA)).not.toContain(repository.envelope.control.envelope_hash);
    expect(Object.keys(afterA).sort()).toEqual([...PERMITTED_CASE_STATE_SLOTS].sort());
    expect(decodeCaseStateResponse(afterA)).toEqual(afterA);

    const beforeB = await get(b, id);
    expect(await submit(a, id, ['req_a'], 'A supplied a hidden account.')).toMatchObject({
      ok: true,
    });
    expect(compilerA.calls[0]!.existing_propositions).toEqual([]);
    expect(canonicalSerialize(await get(b, id))).toBe(canonicalSerialize(beforeB));
    expect((await get(a, id)).recent_interpretations[0]?.statement).toContain('A supplied');
  });

  it('commits multiple compiler assertions as one source event and one visible version step', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const id = repository.envelope.control.case_id;
    const compiler = new ScriptedSemanticCompiler((input) => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: 'first and second',
          requirement_id: 'req_a',
          type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'First material fact.',
        },
        {
          quote: 'first and second',
          requirement_id: 'req_a',
          type: 'payment',
          epistemic_strength: 'asserted_qualified',
          statement: 'Second material fact.',
        },
      ],
    }));
    const a = serviceFor(repository, 'party_a', compiler);
    const before = await get(a, id);
    const result = await submit(a, id, ['req_a'], 'first and second');
    expect(result).toMatchObject({ ok: true, recorded: [{}, {}] });
    expect(decodeCaseServiceResult('submitTurn', result)).toEqual(result);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.case.case_version).toBe(before.case_version + 1);
    expect(Object.keys(repository.envelope.source_turns)).toHaveLength(1);
    expect(Object.keys(repository.envelope.positions)).toHaveLength(2);
    expect(Object.keys(repository.envelope.positions)).toSatisfy((positionIds: string[]) =>
      positionIds.every((id) => id.startsWith('position_party_a_')),
    );
    expect(Object.keys(repository.envelope.positions)).not.toContain('assert_1');
  });

  it('maps compiler ambiguity to one server-minted party clarification', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const id = repository.envelope.control.case_id;
    const compiler = new ScriptedSemanticCompiler(() => ({
      verdict: 'ambiguous',
      clarifications: [
        {
          requirement_id: 'req_a',
          reason: 'multiple_incompatible_readings',
          prompt: 'Which reading did you mean?',
        },
      ],
    }));
    const a = serviceFor(repository, 'party_a', compiler);
    const result = await submit(a, id, ['req_a'], 'It could mean either one.');
    expect(result).toMatchObject({ ok: true, recorded: [] });
    const state = await get(a, id);
    expect(state.open_clarifications).toHaveLength(1);
    expect(state.open_clarifications[0]).toMatchObject({
      requirement_id: 'req_a',
      clarification_id: expect.stringMatching(/^clarification_party_a_/u),
    });
    expect(Object.keys(repository.envelope.positions)).toHaveLength(0);
  });

  it('opens disclosure only through the trusted seam and changes both projections once', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const a = serviceFor(repository, 'party_a');
    const b = serviceFor(repository, 'party_b');
    const id = repository.envelope.control.case_id;
    expect(await submit(a, id, ['req_a'], 'A account.')).toMatchObject({ ok: true });
    expect(await submit(b, id, ['req_b'], 'B account.')).toMatchObject({ ok: true });
    const before = cloneCanonical(repository.envelope.control.party_views);
    await expect(
      openControlledDisclosureV211({
        authority: {} as typeof TRUSTED_CONTROLLED_DISCLOSURE_APPLICATION_V211,
        repository,
        dispute_id: id,
      }),
    ).rejects.toThrow(/Trusted controlled-disclosure/u);
    const disclosed = await openControlledDisclosureV211({
      authority: TRUSTED_CONTROLLED_DISCLOSURE_APPLICATION_V211,
      repository,
      dispute_id: id,
    });
    expect(disclosed.status).toBe('committed');
    expect(repository.envelope.control.disclosure_state).toBe('disclosed');
    for (const partyId of ['party_a', 'party_b'] as const) {
      expect(repository.envelope.control.party_views[partyId].party_visible_version).toBe(
        before[partyId].party_visible_version + 1,
      );
      expect(
        projectPartyFormationV211(repository.envelope, partyId).opponent_material,
      ).not.toBeNull();
    }
  });

  it('rejects hidden opponent targets without compiling, then records sourced challenge/response', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const compilerA = new ScriptedSemanticCompiler(standardScript());
    const a = serviceFor(repository, 'party_a', compilerA);
    const bCompiler = new ScriptedSemanticCompiler(standardScript());
    const b = serviceFor(repository, 'party_b', bCompiler);
    const id = repository.envelope.control.case_id;
    expect(await submit(b, id, ['req_b'], 'B says work was complete.')).toMatchObject({ ok: true });
    const hiddenBPosition = Object.values(repository.envelope.positions)[0]!.position_id;
    expect(await submit(a, id, [hiddenBPosition], 'I dispute that.')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(compilerA.calls).toHaveLength(0);
    expect(await submit(a, id, ['req_a'], 'A says work was incomplete.')).toMatchObject({
      ok: true,
    });
    await openControlledDisclosureV211({
      authority: TRUSTED_CONTROLLED_DISCLOSURE_APPLICATION_V211,
      repository,
      dispute_id: id,
    });
    const ownAPosition = Object.values(repository.envelope.positions).find(
      (position) => position.attributed_party_id === 'party_a',
    )!.position_id;
    const callsBeforeOwnTarget = compilerA.calls.length;
    expect(await submit(a, id, [ownAPosition], 'I challenge my own position.')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(compilerA.calls).toHaveLength(callsBeforeOwnTarget);
    expect(
      await submit(a, id, [hiddenBPosition], 'I dispute that completion claim.'),
    ).toMatchObject({
      ok: true,
    });
    const challengeCompilerInput = compilerA.calls.at(-1)!;
    expect(challengeCompilerInput.existing_propositions).toHaveLength(1);
    expect(challengeCompilerInput.existing_propositions[0]!.statement).toBe(
      'A says work was incomplete.',
    );
    expect(challengeCompilerInput.existing_propositions[0]!.statement).not.toContain(
      'B says work was complete.',
    );
    expect(Object.keys(challengeCompilerInput.existing_propositions[0]!.spans[0]!).sort()).toEqual([
      'encoding',
      'end',
      'message_index',
      'quote',
      'region',
      'start',
      'turn_id',
    ]);
    const challenge = Object.values(repository.envelope.challenges)[0]!;
    expect(challenge).toMatchObject({
      challenging_party_id: 'party_a',
      target_party_id: 'party_b',
      target_position_id: hiddenBPosition,
      status: 'open',
    });
    bCompiler.setScript(() => ({ verdict: 'no_assertions' }));
    expect(await submit(b, id, [challenge.challenge_id], 'I stand by my account.')).toMatchObject({
      ok: true,
    });
    expect(bCompiler.calls.at(-1)!.requirement_context[0]!.prompt).toContain(
      'I dispute that completion claim.',
    );
    expect(repository.envelope.challenges[challenge.challenge_id]).toMatchObject({
      status: 'resolved',
      response: {
        responding_party_id: 'party_b',
        statement: 'I stand by my account.',
      },
    });
    expect(
      repository.envelope.challenges[challenge.challenge_id]!.response!.source_turn_id,
    ).toMatch(/^turn_party_b_/u);
    expect((await get(a, id)).warnings.join('\n')).toContain('challenge_resolved');
    expect((await get(a, id)).warnings.join('\n')).toContain('I stand by my account.');
  });

  it('uses immutable supersession for an unconfirmed challenge response correction', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const a = serviceFor(repository, 'party_a');
    const bCompiler = new ScriptedSemanticCompiler(standardScript());
    const b = serviceFor(repository, 'party_b', bCompiler);
    const id = repository.envelope.control.case_id;
    await completeAndDisclose({ repository, a, b });
    const target = Object.values(repository.envelope.positions).find(
      (position) => position.attributed_party_id === 'party_b',
    )!;
    expect(await submit(a, id, [target.position_id], 'That is wrong.')).toMatchObject({ ok: true });
    const challenge = Object.values(repository.envelope.challenges)[0]!;
    bCompiler.setScript((input) => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: input.turn.payload.answer.text,
          requirement_id: 'req_b',
          type: 'narrative_fact',
          epistemic_strength: 'asserted_qualified',
          statement: 'Party B says only half was complete.',
          supersedes_candidate: target.position_id,
        },
      ],
    }));
    const corrected = await submit(
      b,
      id,
      [challenge.challenge_id, 'req_b'],
      'Correction: only half was complete.',
    );
    expect(corrected).toMatchObject({ ok: true, superseded: [target.position_id] });
    expect(repository.envelope.positions[target.position_id]!.superseded_by).toMatch(
      /^position_party_b_/u,
    );
    expect(
      repository.envelope.challenges[challenge.challenge_id]!.response?.semantic_position_id,
    ).toBe(repository.envelope.positions[target.position_id]!.superseded_by);
  });

  it('rejects duplicate challenge and response effects atomically', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const aCompiler = new ScriptedSemanticCompiler(standardScript());
    const a = serviceFor(repository, 'party_a', aCompiler);
    const bCompiler = new ScriptedSemanticCompiler(standardScript());
    const b = serviceFor(repository, 'party_b', bCompiler);
    const id = repository.envelope.control.case_id;
    await completeAndDisclose({ repository, a, b });
    const target = Object.values(repository.envelope.positions).find(
      (position) => position.attributed_party_id === 'party_b',
    )!;
    aCompiler.setScript((input) => ({
      verdict: 'accepted_candidates',
      assertions: ['narrative_fact', 'payment'].map((type) => ({
        quote: input.turn.payload.answer.text,
        requirement_id: 'req_b',
        type: type as 'narrative_fact' | 'payment',
        epistemic_strength: 'asserted_confident',
        statement: `${type} challenge`,
      })),
    }));
    const beforeChallenge = canonicalSerialize(repository.envelope);
    expect(await submit(a, id, [target.position_id], 'Two challenge readings.')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(canonicalSerialize(repository.envelope)).toBe(beforeChallenge);

    aCompiler.setScript(standardScript());
    expect(await submit(a, id, [target.position_id], 'One challenge.')).toMatchObject({ ok: true });
    const challenge = Object.values(repository.envelope.challenges)[0]!;
    bCompiler.setScript((input) => ({
      verdict: 'accepted_candidates',
      assertions: ['narrative_fact', 'payment'].map((type) => ({
        quote: input.turn.payload.answer.text,
        requirement_id: 'req_b',
        type: type as 'narrative_fact' | 'payment',
        epistemic_strength: 'asserted_confident',
        statement: `${type} response`,
      })),
    }));
    const beforeResponse = canonicalSerialize(repository.envelope);
    expect(await submit(b, id, [challenge.challenge_id], 'Two response readings.')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(canonicalSerialize(repository.envelope)).toBe(beforeResponse);
  });

  it('returns explicit first-party reopen-required for a confirmed-party correction', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const a = serviceFor(repository, 'party_a');
    const bCompiler = new ScriptedSemanticCompiler(standardScript());
    const b = serviceFor(repository, 'party_b', bCompiler);
    const id = repository.envelope.control.case_id;
    await completeAndDisclose({ repository, a, b });
    const firstTarget = Object.values(repository.envelope.positions).find(
      (position) => position.attributed_party_id === 'party_b',
    )!;
    await submit(a, id, [firstTarget.position_id], 'First challenge.');
    const firstChallenge = Object.values(repository.envelope.challenges)[0]!;
    bCompiler.setScript(() => ({ verdict: 'no_assertions' }));
    await submit(b, id, [firstChallenge.challenge_id], 'I stand by it.');

    let envelope = ceremony(repository.envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
      type: 'enter_final_confirmation',
    });
    for (const partyId of ['party_a', 'party_b'] as const) {
      envelope = ceremony(envelope, partyAuthorityV211(envelope, partyId, 'first_party_human'), {
        type: 'record_party_confirmation',
        confirmation_id: unique(`confirmation_${partyId}`),
        event_id: unique(`confirmation_event_${partyId}`),
        adoption_statement: `I adopt ${partyId}.`,
        confirmed_at: '2026-09-02T10:00:00.000Z',
      });
    }
    envelope = ceremony(envelope, partyAuthorityV211(envelope, 'party_a', 'first_party_human'), {
      type: 'reopen_own_formation',
      event_id: unique('reopen_event_party_a'),
      reason: 'Party A needs another challenge.',
      occurred_at: '2026-09-02T10:01:00.000Z',
    });
    repository.replace(envelope);
    const liveTarget = Object.values(repository.envelope.positions).find(
      (position) => position.attributed_party_id === 'party_b' && position.superseded_by === null,
    )!;
    await submit(a, id, [liveTarget.position_id], 'Second challenge.');
    const openChallenge = Object.values(repository.envelope.challenges).find(
      (challenge) => challenge.status === 'open',
    )!;
    bCompiler.setScript((input) => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: input.turn.payload.answer.text,
          requirement_id: 'req_b',
          type: 'narrative_fact',
          epistemic_strength: 'asserted_qualified',
          statement: 'Party B materially corrects the account.',
          supersedes_candidate: liveTarget.position_id,
        },
      ],
    }));
    const before = canonicalSerialize(repository.envelope);
    const result = await submit(
      b,
      id,
      [openChallenge.challenge_id, 'req_b'],
      'I materially correct my account.',
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: expect.stringMatching(/first-party reopen/u) },
    });
    expect(canonicalSerialize(repository.envelope)).toBe(before);
  });

  it('prechecks deterministic replay, fingerprint conflicts, and opposite-party key isolation', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const compilerA = new ScriptedSemanticCompiler(standardScript());
    const compilerB = new ScriptedSemanticCompiler(standardScript());
    const a = serviceFor(repository, 'party_a', compilerA);
    const b = serviceFor(repository, 'party_b', compilerB);
    const id = repository.envelope.control.case_id;
    const clientTurn = 'shared-client-turn';
    const first = await submit(a, id, ['req_a'], 'A account.', clientTurn);
    expect(first).toMatchObject({ ok: true });
    const calls = compilerA.calls.length;
    const replayed = await a.submitTurn({
      case_id: id,
      expected_case_version: 1,
      in_reply_to: ['req_a'],
      payload: { context: [], answer: { role: 'user', text: 'A account.' } },
      client_turn_id: clientTurn,
    });
    expect(replayed).toMatchObject({ ok: true, replayed: true });
    if (first.ok && replayed.ok) expect(replayed.turn_id).toBe(first.turn_id);
    expect(compilerA.calls).toHaveLength(calls);
    expect(
      await a.submitTurn({
        case_id: id,
        expected_case_version: 1,
        in_reply_to: ['req_a'],
        payload: { context: [], answer: { role: 'user', text: 'Changed answer.' } },
        client_turn_id: clientTurn,
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(compilerA.calls).toHaveLength(calls);
    expect(await submit(b, id, ['req_b'], 'B account.', clientTurn)).toMatchObject({ ok: true });
    expect(compilerB.calls).toHaveLength(1);
    expect(repository.replays.size).toBe(2);
    const stale = await a.submitTurn({
      case_id: id,
      expected_case_version: 1,
      in_reply_to: ['req_a_optional'],
      payload: { context: [], answer: { role: 'user', text: 'A later fact.' } },
      client_turn_id: unique('stale_turn'),
    });
    expect(stale).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
    if (!stale.ok && 'recent_turns' in stale) {
      expect(stale.recent_turns).toHaveLength(1);
      expect(stale.recent_turns[0]!.answer_excerpt).toContain('A account.');
      expect(stale.recent_turns[0]!.answer_excerpt).not.toContain('B account.');
    }
  });

  it('rebases hidden contention without recompiling and conflicts on visible contention', async () => {
    const hiddenRepository = new MemoryFormationRepository(baseEnvelope());
    const hiddenB = serviceFor(hiddenRepository, 'party_b');
    const innerA = new ScriptedSemanticCompiler(standardScript());
    let hiddenInterleave = true;
    const compilerA: SemanticCompilerPort = {
      registryEntry: innerA.registryEntry,
      compile: async (input, options) => {
        const output = await innerA.compile(input, options);
        if (hiddenInterleave) {
          hiddenInterleave = false;
          await submit(
            hiddenB,
            hiddenRepository.envelope.control.case_id,
            ['req_b_optional'],
            'Hidden B activity.',
          );
        }
        return output;
      },
    };
    const hiddenA = serviceFor(hiddenRepository, 'party_a', compilerA);
    expect(
      await submit(
        hiddenA,
        hiddenRepository.envelope.control.case_id,
        ['req_a'],
        'A commits after hidden activity.',
      ),
    ).toMatchObject({ ok: true });
    expect(innerA.calls).toHaveLength(1);

    const visibleRepository = new MemoryFormationRepository(baseEnvelope());
    const setupA = serviceFor(visibleRepository, 'party_a');
    const visibleB = serviceFor(visibleRepository, 'party_b');
    await completeAndDisclose({ repository: visibleRepository, a: setupA, b: visibleB });
    const innerVisibleA = new ScriptedSemanticCompiler(standardScript());
    let visibleInterleave = true;
    const interleavingVisibleCompiler: SemanticCompilerPort = {
      registryEntry: innerVisibleA.registryEntry,
      compile: async (input, options) => {
        const output = await innerVisibleA.compile(input, options);
        if (visibleInterleave) {
          visibleInterleave = false;
          await submit(
            visibleB,
            visibleRepository.envelope.control.case_id,
            ['req_b_optional'],
            'Visible B activity.',
          );
        }
        return output;
      },
    };
    const visibleA = serviceFor(visibleRepository, 'party_a', interleavingVisibleCompiler);
    expect(
      await submit(
        visibleA,
        visibleRepository.envelope.control.case_id,
        ['req_a_optional'],
        'A collides with visible activity.',
      ),
    ).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
    expect(innerVisibleA.calls).toHaveLength(1);
  });

  it('fails closed on malformed compiler shape and bad spans without mutation', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const malformed: SemanticCompilerPort = {
      registryEntry: new ScriptedSemanticCompiler().registryEntry,
      compile: async (input): Promise<CompilerOutput> =>
        ({
          compile_run_id: input.compile_run_id,
          compiler_version_id: input.compiler_version_id,
          verdict: 'accepted_candidates',
          assertions: [],
          rejected_candidates: [],
          clarifications_requested: [],
          raw_model_output: null,
          party_id: 'party_b',
        }) as CompilerOutput,
    };
    const id = repository.envelope.control.case_id;
    const before = canonicalSerialize(repository.envelope);
    expect(
      await submit(serviceFor(repository, 'party_a', malformed), id, ['req_a'], 'Answer.'),
    ).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(canonicalSerialize(repository.envelope)).toBe(before);

    const badSpan: SemanticCompilerPort = {
      registryEntry: new ScriptedSemanticCompiler().registryEntry,
      compile: async (input) => ({
        compile_run_id: input.compile_run_id,
        compiler_version_id: input.compiler_version_id,
        verdict: 'accepted_candidates',
        assertions: [
          {
            assertion_id: 'assert_bad_span',
            spans: [
              {
                turn_id: input.turn.turn_id,
                region: 'answer',
                message_index: null,
                encoding: 'utf16',
                start: 0,
                end: 6,
                quote: 'wrong!',
              },
            ],
            proposed_type: 'narrative_fact',
            epistemic_strength: 'asserted_confident',
            requirement_id: 'req_a',
            statement: 'Bad span.',
            supersedes_candidate: null,
          },
        ],
        rejected_candidates: [],
        clarifications_requested: [],
        raw_model_output: null,
      }),
    };
    expect(
      await submit(serviceFor(repository, 'party_a', badSpan), id, ['req_a'], 'Answer.'),
    ).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(canonicalSerialize(repository.envelope)).toBe(before);
  });

  it('routes case/dispute families without changing start_case or auto-selecting ambiguity', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const v211 = serviceFor(repository, 'party_a');
    const legacyCalls: string[] = [];
    const legacyState = projectPartyCaseStateV211(
      repository.envelope,
      'party_a',
      'https://dark.invalid/review',
    );
    legacyState.case_id = 'case_legacy';
    const legacy: CaseServicePort = {
      startCase: async () => {
        legacyCalls.push('start');
        return { ok: true, case: legacyState };
      },
      getCaseState: async (query) => {
        legacyCalls.push(`get:${query.case_id ?? 'active'}`);
        return { ok: true, case: legacyState };
      },
      submitTurn: async () => {
        legacyCalls.push('submit');
        return {
          ok: true,
          turn_id: 'turn_legacy',
          case: legacyState,
          recorded: [],
          superseded: [],
        };
      },
    };
    const routed = createDarkVersionedCaseService({ legacy, v211 });
    expect(await routed.startCase({ client_request_id: 'start-1' })).toMatchObject({
      ok: true,
      case: { case_id: 'case_legacy' },
    });
    expect(
      await routed.getCaseState({ case_id: repository.envelope.control.case_id }),
    ).toMatchObject({
      ok: true,
      case: { case_id: repository.envelope.control.case_id },
    });
    expect(await routed.getCaseState({ case_id: 'case_legacy' })).toMatchObject({ ok: true });
    expect(await routed.getCaseState({})).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(await routed.getCaseState({ case_id: 'unknown_1' })).toMatchObject({
      ok: false,
      error: { code: 'CASE_NOT_FOUND' },
    });
    expect(legacyCalls).toEqual(['start', 'get:case_legacy', 'get:active']);
  });

  it('keeps production composition V2.1.1-unreachable and the tool names frozen', () => {
    const production = readFileSync(
      resolve(process.cwd(), 'src/webmcp/server/production.ts'),
      'utf8',
    );
    const server = readFileSync(resolve(process.cwd(), 'src/webmcp/server/server.ts'), 'utf8');
    expect(production).not.toMatch(/v2-1-1|createDarkVersionedCaseService/u);
    expect(server).not.toMatch(/v2-1-1|createDarkVersionedCaseService/u);
    const service = {
      startCase: async () => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: '', retryable: false },
      }),
      getCaseState: async () => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: '', retryable: false },
      }),
      submitTurn: async () => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: '', retryable: false },
      }),
    };
    expect(createJuryAiToolDefinitions(service).map((tool) => tool.name)).toEqual([
      'start_case',
      'get_case_state',
      'submit_turn',
    ]);
    expect(PARTY_FORMATION_PROJECTION_VERSION_V211).toBe(
      'juryai-party-formation-projection-v2.1.1',
    );
  });
});
