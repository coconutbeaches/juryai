/**
 * PR 8A — zero-effect `submit_turn` safety.
 *
 * A structurally valid formation answer whose compiler output carries neither
 * an assertion nor a clarification request produced NO canonical effect, yet
 * was committed: a source turn and replay record were persisted and the caller
 * received `ok: true` with an empty `recorded` array. For an evidence system a
 * successful-looking write that discarded the substance is the dangerous
 * outcome, so it must now fail before persistence.
 *
 * These tests pin both halves: the no-op is refused and leaves the envelope
 * byte-identical, and every path that intentionally synthesizes an effect —
 * assertions, clarifications, challenges, challenge responses — still commits.
 */

import { describe, expect, it } from 'vitest';
import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import {
  TRUSTED_SYSTEM_AUTHORITY_V213,
  type CaseEnvelopeV213,
  type FormationRequirementV213,
  type PartyIdV213,
} from '../v2-1-3/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV213,
  ceremonyCommandForV213,
  createInitialCaseEnvelopeV213,
  type EnvelopeCeremonyOperationV213,
} from '../v2-1-3/envelope-ceremony.js';
import {
  createV213PartyCaseService,
  type V213PartyCaseService,
} from '../v2-1-3/webmcp-application.js';
import type { SemanticCompilerPort } from '../webmcp/runtime-v0-3/compiler-port.js';
import {
  ScriptedSemanticCompiler,
  type CompilerScript,
} from '../webmcp/runtime-v0-3/scripted-compiler.js';
import { MemoryFormationRepository } from './v2-1-3-memory-repository.js';

const SUBJECT_A = 'subject_zero_effect_a';
const SUBJECT_B = 'subject_zero_effect_b';
let sequence = 0;

function unique(label: string): string {
  sequence += 1;
  return `${label}_${sequence}`;
}

function requirement(id: string, required = true): Omit<FormationRequirementV213, 'party_id'> {
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
  envelope: CaseEnvelopeV213,
  operation: EnvelopeCeremonyOperationV213,
): CaseEnvelopeV213 {
  const result = applyEnvelopeCeremonyCommandV213({
    envelope,
    command: ceremonyCommandForV213(envelope, unique('ceremony'), operation),
    execution_authority: TRUSTED_SYSTEM_AUTHORITY_V213,
  });
  if (result.status !== 'applied') throw new Error(result.message);
  return result.envelope;
}

function baseEnvelope(): CaseEnvelopeV213 {
  let envelope = createInitialCaseEnvelopeV213(unique('dispute_zero_effect'), {
    party_a: [requirement('req_a')],
    party_b: [requirement('req_b')],
  });
  envelope = ceremony(envelope, {
    type: 'bind_party',
    party_slot: 'party_a',
    authenticated_subject_id: SUBJECT_A,
    binding_event_id: unique('binding_party_a'),
  });
  return ceremony(envelope, {
    type: 'bind_party',
    party_slot: 'party_b',
    authenticated_subject_id: SUBJECT_B,
    binding_event_id: unique('binding_party_b'),
  });
}

/** Compiler that accepts one narrative_fact per target: the normal happy path. */
function standardScript(): CompilerScript {
  return (input) => ({
    verdict: 'accepted_candidates',
    assertions: input.turn.in_reply_to.map((requirementId) => ({
      quote: input.turn.payload.answer.text,
      requirement_id: requirementId,
      type: 'narrative_fact' as const,
      epistemic_strength: 'asserted_confident' as const,
      statement: input.turn.payload.answer.text,
      supersedes_candidate: null,
    })),
  });
}

/** The defect's trigger: structurally valid, semantically empty. */
function zeroEffectScript(): CompilerScript {
  return () => ({ verdict: 'no_assertions' });
}

function serviceFor(
  repository: MemoryFormationRepository,
  partyId: PartyIdV213,
  compiler: SemanticCompilerPort = new ScriptedSemanticCompiler(standardScript()),
): V213PartyCaseService {
  return createV213PartyCaseService({
    authenticated_subject_id: partyId === 'party_a' ? SUBJECT_A : SUBJECT_B,
    repository,
    compiler,
    review_url: (id) => `https://juryai.test/cases/${id}/review`,
    ids: { next: (kind, party) => unique(`${kind}_${party}`) },
    clock: { now: () => 1_788_336_000_000 + sequence++ },
    salts: { next: () => `0123456789abcdef${unique('salt')}` },
    relaying_agent: 'pr8a-test-relay',
  });
}

async function get(service: V213PartyCaseService, disputeId: string) {
  const result = await service.getCaseState({ case_id: disputeId });
  if (!result.ok) throw new Error(result.error.message);
  return result.case;
}

async function submit(
  service: V213PartyCaseService,
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

describe('PR 8A: a zero-effect formation submission is refused before persistence', () => {
  it('returns non-retryable INVALID_INPUT instead of ok:true with an empty recorded array', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const service = serviceFor(
      repository,
      'party_a',
      new ScriptedSemanticCompiler(zeroEffectScript()),
    );
    const id = repository.envelope.control.case_id;

    const result = await submit(service, id, ['req_a'], 'Thanks, that is all for now.');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the zero-effect turn to be refused');
    expect(result.error).toEqual({
      code: 'INVALID_INPUT',
      message: 'The answer produced no recordable change to this case.',
      retryable: false,
    });
  });

  it('leaves the envelope byte-identical: no version bump, turn, position, or clarification', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const service = serviceFor(
      repository,
      'party_a',
      new ScriptedSemanticCompiler(zeroEffectScript()),
    );
    const id = repository.envelope.control.case_id;
    const before = canonicalSerialize(repository.envelope);
    const versionBefore = repository.envelope.control.party_views.party_a.party_visible_version;

    expect(await submit(service, id, ['req_a'], 'No content.')).toMatchObject({ ok: false });

    expect(canonicalSerialize(repository.envelope)).toBe(before);
    expect(repository.envelope.control.party_views.party_a.party_visible_version).toBe(
      versionBefore,
    );
    expect(Object.keys(repository.envelope.source_turns)).toEqual([]);
    expect(Object.keys(repository.envelope.positions)).toEqual([]);
    expect(Object.keys(repository.envelope.clarifications)).toEqual([]);
    expect(repository.replays.size).toBe(0);
  });

  it('allocates no submission or effect-scoped identifier for a refused turn', async () => {
    // The guard cannot precede every allocation: `run`, `turn` and `source`
    // ids and the payload salt are drawn before compiling because the compiler
    // input embeds the source turn and its spans cite that turn_id. What the
    // guard must protect is everything downstream of the compile — the
    // submission id and every canonical effect id — since those name material
    // that will never exist. Production injects neither provider and uses
    // randomUUID/randomBytes, so the pre-compile draws reserve nothing.
    const repository = new MemoryFormationRepository(baseEnvelope());
    const kinds: string[] = [];
    const service = createV213PartyCaseService({
      authenticated_subject_id: SUBJECT_A,
      repository,
      compiler: new ScriptedSemanticCompiler(zeroEffectScript()),
      review_url: (id) => `https://juryai.test/cases/${id}/review`,
      ids: {
        next: (kind, party) => {
          kinds.push(kind);
          return unique(`${kind}_${party}`);
        },
      },
      clock: { now: () => 1_788_336_000_000 + sequence++ },
      salts: { next: () => `0123456789abcdef${unique('salt')}` },
    });
    const id = repository.envelope.control.case_id;

    expect(await submit(service, id, ['req_a'], 'Nothing recordable.')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });

    expect(kinds).toEqual(['run', 'turn', 'source']);
    for (const kind of [
      'submission',
      'position',
      'clarification',
      'challenge',
      'challenge_response',
    ]) {
      expect(kinds).not.toContain(kind);
    }
  });

  it('does not consume the client_turn_id, so a corrected answer can be resubmitted', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const compiler = new ScriptedSemanticCompiler(zeroEffectScript());
    const service = serviceFor(repository, 'party_a', compiler);
    const id = repository.envelope.control.case_id;
    const clientTurnId = unique('retry_after_no_op');

    expect(await submit(service, id, ['req_a'], 'Nothing here.', clientTurnId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });

    compiler.setScript(standardScript());
    const corrected = await submit(
      service,
      id,
      ['req_a'],
      'The site was delivered around July 15.',
      clientTurnId,
    );

    expect(corrected.ok, JSON.stringify(corrected)).toBe(true);
    if (!corrected.ok) throw new Error(corrected.error.message);
    expect(corrected.recorded).toHaveLength(1);
    expect(repository.replays.size).toBe(1);
  });
});

describe('PR 8A: submissions that do produce a canonical effect still commit', () => {
  it('records a normal assertion', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const service = serviceFor(repository, 'party_a');
    const id = repository.envelope.control.case_id;

    const result = await submit(service, id, ['req_a'], 'A full account of the work.');

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.recorded).toHaveLength(1);
    expect(Object.keys(repository.envelope.positions)).toHaveLength(1);
  });

  it('commits a clarification-producing answer that carries no assertion', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const service = serviceFor(
      repository,
      'party_a',
      new ScriptedSemanticCompiler(() => ({
        verdict: 'no_assertions',
        clarifications: [
          {
            requirement_id: 'req_a',
            reason: 'multiple_incompatible_readings',
            prompt: 'Which reading did you mean?',
          },
        ],
      })),
    );
    const id = repository.envelope.control.case_id;

    const result = await submit(service, id, ['req_a'], 'It was late, sort of.');

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(Object.keys(repository.envelope.clarifications)).toHaveLength(1);
    expect(result.case.open_clarifications).toHaveLength(1);
  });

  it('still synthesizes a challenge and a challenge response from a zero-assertion answer', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const a = serviceFor(repository, 'party_a');
    const b = serviceFor(repository, 'party_b');
    const id = repository.envelope.control.case_id;

    expect(await submit(a, id, ['req_a'], 'A says the work was incomplete.')).toMatchObject({
      ok: true,
    });
    expect(await submit(b, id, ['req_b'], 'B says the work was complete.')).toMatchObject({
      ok: true,
    });
    repository.replace(ceremony(repository.envelope, { type: 'open_controlled_disclosure' }));

    const bPosition = Object.values(repository.envelope.positions).find(
      (position) => position.attributed_party_id === 'party_b',
    )!.position_id;

    // Zero assertions on the challenge path must still synthesize a challenge
    // from the answer text — this is the behaviour the new guard must not break.
    const challengeService = serviceFor(
      repository,
      'party_a',
      new ScriptedSemanticCompiler(zeroEffectScript()),
    );
    const challenged = await submit(challengeService, id, [bPosition], 'I dispute that claim.');
    expect(challenged.ok, JSON.stringify(challenged)).toBe(true);
    const challenge = Object.values(repository.envelope.challenges)[0]!;
    expect(challenge.target_position_id).toBe(bPosition);

    const responseService = serviceFor(
      repository,
      'party_b',
      new ScriptedSemanticCompiler(zeroEffectScript()),
    );
    const responded = await submit(
      responseService,
      id,
      [challenge.challenge_id],
      'I stand by my account.',
    );
    expect(responded.ok, JSON.stringify(responded)).toBe(true);
    expect(repository.envelope.challenges[challenge.challenge_id]!.response).not.toBeNull();
  });
});

describe('PR 8A: idempotency and version-conflict behaviour are unchanged', () => {
  it('replays an identical committed turn rather than double-applying it', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const service = serviceFor(repository, 'party_a');
    const id = repository.envelope.control.case_id;
    const clientTurnId = unique('idempotent');
    const state = await get(service, id);
    const command = {
      case_id: id,
      expected_case_version: state.case_version,
      in_reply_to: ['req_a'],
      payload: { context: [], answer: { role: 'user' as const, text: 'One account.' } },
      client_turn_id: clientTurnId,
    };

    const first = await service.submitTurn(command);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const afterFirst = cloneCanonical(repository.envelope);

    const replayed = await service.submitTurn(command);
    expect(replayed.ok, JSON.stringify(replayed)).toBe(true);
    if (!replayed.ok) throw new Error(replayed.error.message);
    expect(replayed.replayed).toBe(true);
    expect(canonicalSerialize(repository.envelope)).toBe(canonicalSerialize(afterFirst));
    expect(Object.keys(repository.envelope.positions)).toHaveLength(1);
  });

  it('still reports VERSION_CONFLICT for a stale expected_case_version', async () => {
    const repository = new MemoryFormationRepository(baseEnvelope());
    const service = serviceFor(repository, 'party_a');
    const id = repository.envelope.control.case_id;
    const stale = (await get(service, id)).case_version;

    expect(await submit(service, id, ['req_a'], 'First account.')).toMatchObject({ ok: true });

    const conflicted = await service.submitTurn({
      case_id: id,
      expected_case_version: stale,
      in_reply_to: ['req_a'],
      payload: { context: [], answer: { role: 'user', text: 'Second account.' } },
      client_turn_id: unique('stale_turn'),
    });

    expect(conflicted).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
  });
});
