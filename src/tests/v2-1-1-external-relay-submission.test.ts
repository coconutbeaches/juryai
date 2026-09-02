import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, cloneCanonical, sha256 } from '../v2/case-envelope.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V21,
  FORMATION_PROTOCOL_VERSION_V21,
} from '../v2-1/case-envelope.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V211,
  EXTERNAL_RELAY_SUBMISSION_VERSION_V211,
  FORMATION_PROTOCOL_VERSION_V211,
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  TRUSTED_SYSTEM_AUTHORITY_V211,
  partyAuthorityV211,
  type CaseEnvelopeV211,
  type FormationRequirementV211,
  type PartyIdV211,
} from '../v2-1-1/case-envelope.js';
import { validateCaseEnvelopeV211 } from '../v2-1-1/contract-validator.js';
import {
  applyEnvelopeCeremonyCommandV211,
  ceremonyCommandForV211,
  createInitialCaseEnvelopeV211,
  type EnvelopeCeremonyOperationV211,
  type InitialFormationRequirementsV211,
} from '../v2-1-1/envelope-ceremony.js';
import { createInitialCaseEnvelopeV21 } from '../v2-1/envelope-command.js';
import {
  applyExternalRelaySubmissionV211,
  conflictTurnSummariesForPartyV211,
  prepareExternalRelaySubmissionV211,
  trustedExternalRelayRuntimeV211,
  TRUSTED_EXTERNAL_RELAY_BRIDGE_V211,
  type ApplyExternalRelaySubmissionResultV211,
  type ExternalRelayEffectCandidateV211,
  type ExternalRelaySubmissionV211,
} from '../v2-1-1/external-relay-submission.js';
import {
  derivePartyIndependentFormationCompleteV211,
  evaluateFormationRequirementV211,
} from '../v2-1-1/formation-requirements.js';
import { deriveFormationReadinessV211 } from '../v2-1-1/formation-readiness.js';
import {
  currentPartyConfirmationV211,
  hashPartyFormationProjectionV211,
  serializePartyFormationProjectionV211,
} from '../v2-1-1/party-projection.js';
import type { SourceTurnPayload, TurnSpan } from '../webmcp/core/turns.js';

const NOW = '2026-09-02T08:00:00.000Z';
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let sequence = 0;

function sourceFilesBelow(relativeDirectory: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(absolute);
    }
  };
  visit(resolve(REPOSITORY_ROOT, relativeDirectory));
  return files.sort();
}

function unique(label: string): string {
  sequence += 1;
  return `${label}_${sequence}`;
}

function requirement(
  requirementId: string,
  type: 'payment' | 'narrative_fact' | 'declined_to_answer' = 'narrative_fact',
): Omit<FormationRequirementV211, 'party_id'> {
  return {
    requirement_id: requirementId,
    label: requirementId,
    prompt: `Please answer ${requirementId}.`,
    required: true,
    satisfying_types: [type],
    min_propositions: 1,
    max_propositions: 1,
    adverse_fact_probe: false,
    reopened_from: null,
  };
}

function executeCeremony(
  envelope: CaseEnvelopeV211,
  authority: Parameters<typeof applyEnvelopeCeremonyCommandV211>[0]['execution_authority'],
  operation: EnvelopeCeremonyOperationV211,
): CaseEnvelopeV211 {
  const result = applyEnvelopeCeremonyCommandV211({
    envelope,
    command: ceremonyCommandForV211(envelope, unique('ceremony'), operation),
    execution_authority: authority,
  });
  expect(result.status, result.message).toBe('applied');
  if (result.status !== 'applied') throw new Error(result.message);
  expect(result.resulting_envelope_version).toBe(result.prior_envelope_version + 1);
  expect(validateCaseEnvelopeV211(result.envelope)).toEqual([]);
  return result.envelope;
}

function bind(
  envelope: CaseEnvelopeV211,
  partyId: PartyIdV211,
  subjectId = `subject_${partyId}`,
): CaseEnvelopeV211 {
  return executeCeremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
    type: 'bind_party',
    party_slot: partyId,
    authenticated_subject_id: subjectId,
    binding_event_id: unique(`binding_${partyId}`),
  });
}

function boundEnvelope(
  requirements: InitialFormationRequirementsV211 = {
    party_a: [requirement('req_a_story')],
    party_b: [requirement('req_b_story')],
  },
): CaseEnvelopeV211 {
  let envelope = createInitialCaseEnvelopeV211(unique('dispute_v211'), requirements);
  envelope = bind(envelope, 'party_a');
  envelope = bind(envelope, 'party_b');
  return envelope;
}

function answerSpan(turnId: string, answer: string, quote = answer): TurnSpan {
  const start = answer.indexOf(quote);
  return {
    turn_id: turnId,
    region: 'answer',
    message_index: null,
    encoding: 'utf16',
    start,
    end: start + quote.length,
    quote,
  };
}

function contextSpan(turnId: string, context: string, quote = context): TurnSpan {
  const start = context.indexOf(quote);
  return {
    turn_id: turnId,
    region: 'context',
    message_index: 0,
    encoding: 'utf16',
    start,
    end: start + quote.length,
    quote,
  };
}

function prepareSubmission(input: {
  envelope: CaseEnvelopeV211;
  party_id: PartyIdV211;
  payload: SourceTurnPayload;
  in_reply_to: string[];
  effects: (turnId: string) => ExternalRelayEffectCandidateV211[];
  client_turn_id?: string;
}): {
  submission: ExternalRelaySubmissionV211;
  authority: ReturnType<typeof partyAuthorityV211>;
} {
  const { envelope, party_id: partyId } = input;
  const authority = partyAuthorityV211(envelope, partyId, 'external_relay');
  const turnId = unique(`turn_${partyId}`);
  const effects = input.effects(turnId);
  const positionCount = effects.reduce(
    (count, effect) =>
      count +
      (effect.type === 'semantic_assertion_candidate' ? 1 : 0) +
      (effect.type === 'challenge_response_candidate' && effect.semantic_correction ? 1 : 0),
    0,
  );
  const result = prepareExternalRelaySubmissionV211({
    envelope,
    execution_authority: authority,
    intent: {
      intent_version: 'juryai-external-relay-submission-intent-v2.1.1',
      expected_party_visible_version: envelope.control.party_views[partyId].party_visible_version,
      expected_party_projection_hash: envelope.control.party_views[partyId].party_projection_hash,
      client_turn_id: input.client_turn_id ?? unique(`client_turn_${partyId}`),
      in_reply_to: input.in_reply_to,
      payload: input.payload,
      source_language: 'en',
      translation_indicated: false,
    },
    runtime: trustedExternalRelayRuntimeV211(TRUSTED_EXTERNAL_RELAY_BRIDGE_V211, {
      source_channel: 'webmcp_agent_relay',
      relaying_agent: 'test-relay',
      received_at: new Date(Date.parse(NOW) + sequence * 1_000).toISOString(),
      payload_commitment_salt: `payload-salt-${unique('salt')}-0123456789`,
      ids: {
        submission_id: unique(`submission_${partyId}`),
        source_turn_id: turnId,
        position_ids: Array.from({ length: positionCount }, () => unique(`position_${partyId}`)),
        clarification_ids: effects
          .filter((effect) => effect.type === 'clarification_request')
          .map(() => unique(`clarification_${partyId}`)),
        challenge_ids: effects
          .filter((effect) => effect.type === 'challenge_candidate')
          .map(() => unique(`challenge_${partyId}`)),
        challenge_response_ids: effects
          .filter((effect) => effect.type === 'challenge_response_candidate')
          .map(() => unique(`challenge_response_${partyId}`)),
      },
    }),
    compiler_run: {
      compile_run_id: unique(`compile_run_${partyId}`),
      compiler_version_id: sha256('compiler-v211'),
      party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
      input_hash: sha256(`input-${sequence}`),
      output_hash: sha256(`output-${sequence}`),
    },
    effects,
  });
  expect(result.status, result.status === 'rejected' ? result.message : '').toBe('prepared');
  if (result.status !== 'prepared') throw new Error(result.message);
  return { submission: result.submission, authority };
}

function applyPrepared(
  envelope: CaseEnvelopeV211,
  prepared: ReturnType<typeof prepareSubmission>,
): ApplyExternalRelaySubmissionResultV211 {
  return applyExternalRelaySubmissionV211({
    envelope,
    submission: prepared.submission,
    execution_authority: prepared.authority,
  });
}

function submitAssertion(
  envelope: CaseEnvelopeV211,
  partyId: PartyIdV211,
  requirementId: string,
  answer: string,
  proposedType: 'payment' | 'narrative_fact' | 'declined_to_answer' = 'narrative_fact',
): CaseEnvelopeV211 {
  const prepared = prepareSubmission({
    envelope,
    party_id: partyId,
    payload: { context: [], answer: { role: 'user', text: answer } },
    in_reply_to: [requirementId],
    effects: (turnId) => [
      {
        type: 'semantic_assertion_candidate',
        compiler_assertion_id: unique('assertion'),
        requirement_id: requirementId,
        proposed_type: proposedType,
        epistemic_strength:
          proposedType === 'declined_to_answer' ? 'declined' : 'asserted_confident',
        statement: answer,
        spans: [answerSpan(turnId, answer)],
        supersedes_candidate: null,
      },
    ],
  });
  const result = applyPrepared(envelope, prepared);
  expect(result.status, result.message).toBe('applied');
  if (result.status !== 'applied') throw new Error(result.message);
  return result.envelope;
}

describe('V2.1.1 version and semantic source contract', () => {
  it('introduces incompatible V2.1.1 identifiers without changing V2.1.0', () => {
    expect(CASE_ENVELOPE_SCHEMA_VERSION_V21).toBe('juryai-case-envelope-v2.1.0');
    expect(FORMATION_PROTOCOL_VERSION_V21).toBe('juryai-formation-protocol-v2.1.0');
    expect(CASE_ENVELOPE_SCHEMA_VERSION_V211).toBe('juryai-case-envelope-v2.1.1');
    expect(FORMATION_PROTOCOL_VERSION_V211).toBe('juryai-formation-protocol-v2.1.1');
    expect(EXTERNAL_RELAY_SUBMISSION_VERSION_V211).toBe('juryai-external-relay-submission-v2.1.1');
  });

  it('records one normalized source for multiple requirements/types in one version transition', () => {
    const requirements: InitialFormationRequirementsV211 = {
      party_a: [requirement('req_a_payment', 'payment'), requirement('req_a_story')],
      party_b: [],
    };
    const envelope = boundEnvelope(requirements);
    const answer = 'I paid $5,000. The work remained incomplete.';
    const context = 'What did you pay, and what remained incomplete?';
    const beforeA = envelope.control.party_views.party_a;
    const beforeBBytes = serializePartyFormationProjectionV211(envelope, 'party_b');
    const beforeB = envelope.control.party_views.party_b;
    const prepared = prepareSubmission({
      envelope,
      party_id: 'party_a',
      payload: {
        context: [{ role: 'assistant', text: `  ${context}  ` }],
        answer: { role: 'user', text: `  ${answer}  ` },
      },
      in_reply_to: ['req_a_story', 'req_a_payment'],
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('assertion_payment'),
          requirement_id: 'req_a_payment',
          proposed_type: 'payment',
          epistemic_strength: 'asserted_confident',
          statement: 'Party A paid $5,000.',
          spans: [answerSpan(turnId, answer, 'paid $5,000')],
          supersedes_candidate: null,
        },
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('assertion_story'),
          requirement_id: 'req_a_story',
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'Party A says the work remained incomplete.',
          spans: [
            contextSpan(turnId, context, 'remained incomplete'),
            answerSpan(turnId, answer, 'work remained incomplete'),
          ],
          supersedes_candidate: null,
        },
      ],
    });
    const result = applyPrepared(envelope, prepared);
    expect(result.status, result.message).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);

    expect(result.resulting_envelope_version).toBe(result.prior_envelope_version + 1);
    expect(Object.keys(result.envelope.source_turns)).toEqual([
      prepared.submission.source_turn.turn_id,
    ]);
    expect(result.result.accepted_position_ids).toHaveLength(2);
    const positions = result.result.accepted_position_ids.map(
      (id) => result.envelope.positions[id]!,
    );
    expect(new Set(positions.map((position) => position.source_turn_id))).toEqual(
      new Set([prepared.submission.source_turn.turn_id]),
    );
    expect(positions.map((position) => position.proposition_type).sort()).toEqual([
      'narrative_fact',
      'payment',
    ]);
    expect(positions.flatMap((position) => position.source_span_commitments)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ region: 'answer', message_index: null, encoding: 'utf16' }),
        expect.objectContaining({ region: 'context', message_index: 0, encoding: 'utf16' }),
      ]),
    );
    expect(result.envelope.source_turns[prepared.submission.source_turn.turn_id]!.payload).toEqual({
      context: [{ role: 'assistant', text: context }],
      answer: { role: 'user', text: answer },
    });
    expect(result.envelope.control.party_views.party_a.party_visible_version).toBe(
      beforeA.party_visible_version + 1,
    );
    expect(result.envelope.control.party_views.party_b).toEqual(beforeB);
    expect(serializePartyFormationProjectionV211(result.envelope, 'party_b')).toBe(beforeBBytes);
    expect(
      evaluateFormationRequirementV211(
        result.envelope,
        result.envelope.requirements.req_a_payment!,
      ),
    ).toMatchObject({
      status: 'satisfied',
    });
    expect(
      evaluateFormationRequirementV211(result.envelope, result.envelope.requirements.req_a_story!),
    ).toMatchObject({
      status: 'satisfied',
    });
    expect(derivePartyIndependentFormationCompleteV211(result.envelope, 'party_a')).toBe(true);
  });

  it.each([
    ['wrong quote', (span: TurnSpan) => ({ ...span, quote: 'not in the answer' })],
    ['wrong answer index', (span: TurnSpan) => ({ ...span, message_index: 0 })],
    ['out of bounds', (span: TurnSpan) => ({ ...span, end: 9_999 })],
    ['wrong region', (span: TurnSpan) => ({ ...span, region: 'context' as const })],
  ])('rejects every effect atomically for %s', (_label, mutate) => {
    const envelope = boundEnvelope();
    const answer = 'A precise answer.';
    const prepared = prepareSubmission({
      envelope,
      party_id: 'party_a',
      payload: { context: [], answer: { role: 'user', text: answer } },
      in_reply_to: ['req_a_story'],
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('assertion_bad_span'),
          requirement_id: 'req_a_story',
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: answer,
          spans: [mutate(answerSpan(turnId, answer))],
          supersedes_candidate: null,
        },
      ],
    });
    const before = canonicalSerialize(envelope);
    const result = applyPrepared(envelope, prepared);
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'span_fidelity_failed' });
    expect(canonicalSerialize(result.envelope)).toBe(before);
    expect(Object.keys(result.envelope.source_turns)).toHaveLength(0);
    expect(Object.keys(result.envelope.positions)).toHaveLength(0);
  });

  it('uses UTF-16 offsets exactly when non-BMP text precedes the cited span', () => {
    const envelope = boundEnvelope();
    const answer = '😀 I paid the deposit.';
    const quote = 'paid the deposit';
    const prepared = prepareSubmission({
      envelope,
      party_id: 'party_a',
      payload: { context: [], answer: { role: 'user', text: answer } },
      in_reply_to: ['req_a_story'],
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('assertion_utf16'),
          requirement_id: 'req_a_story',
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'Party A says the deposit was paid.',
          spans: [answerSpan(turnId, answer, quote)],
          supersedes_candidate: null,
        },
      ],
    });
    const applied = applyPrepared(envelope, prepared);
    expect(applied.status, applied.message).toBe('applied');
    if (applied.status !== 'applied') return;
    const position = applied.envelope.positions[applied.result.accepted_position_ids[0]!]!;
    expect(position.source_span_commitments[0]).toMatchObject({
      encoding: 'utf16',
      start: answer.indexOf(quote),
      end: answer.indexOf(quote) + quote.length,
      quote_hash: sha256(quote),
    });
  });

  it('derives a declined requirement from the canonical proposition taxonomy', () => {
    const envelope = boundEnvelope({
      party_a: [requirement('req_a_declined', 'declined_to_answer')],
      party_b: [],
    });
    const result = submitAssertion(
      envelope,
      'party_a',
      'req_a_declined',
      'I decline to answer that question.',
      'declined_to_answer',
    );
    expect(
      evaluateFormationRequirementV211(result, result.requirements.req_a_declined!),
    ).toMatchObject({
      status: 'satisfied',
      satisfying_position_ids: expect.any(Array),
      non_satisfying_position_ids: [],
    });
  });

  it('rejects compiler-shaped party authority and canonical IDs at the preparation boundary', () => {
    const envelope = boundEnvelope();
    const authority = partyAuthorityV211(envelope, 'party_a', 'external_relay');
    const cursor = envelope.control.party_views.party_a;
    const injected = {
      type: 'semantic_assertion_candidate',
      compiler_assertion_id: unique('assertion_injected'),
      requirement_id: 'req_a_story',
      proposed_type: 'narrative_fact',
      epistemic_strength: 'asserted_confident',
      statement: 'Injected.',
      spans: [],
      supersedes_candidate: null,
      party_id: 'party_b',
      position_id: 'position_party_b_injected',
      system_authority: true,
    } as unknown as ExternalRelayEffectCandidateV211;
    const prepared = prepareExternalRelaySubmissionV211({
      envelope,
      execution_authority: authority,
      intent: {
        intent_version: 'juryai-external-relay-submission-intent-v2.1.1',
        expected_party_visible_version: cursor.party_visible_version,
        expected_party_projection_hash: cursor.party_projection_hash,
        client_turn_id: unique('client_injected'),
        in_reply_to: ['req_a_story'],
        payload: { context: [], answer: { role: 'user', text: 'Injected.' } },
        source_language: null,
        translation_indicated: false,
      },
      runtime: trustedExternalRelayRuntimeV211(TRUSTED_EXTERNAL_RELAY_BRIDGE_V211, {
        source_channel: 'webmcp_agent_relay',
        relaying_agent: null,
        received_at: NOW,
        payload_commitment_salt: '0123456789abcdef',
        ids: {
          submission_id: unique('submission_party_a'),
          source_turn_id: unique('turn_party_a'),
          position_ids: [unique('position_party_a')],
          clarification_ids: [],
          challenge_ids: [],
          challenge_response_ids: [],
        },
      }),
      compiler_run: {
        compile_run_id: unique('compile_run'),
        compiler_version_id: sha256('compiler'),
        party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
        input_hash: sha256('input'),
        output_hash: sha256('output'),
      },
      effects: [injected],
    });
    expect(prepared).toMatchObject({ status: 'rejected', reason_code: 'invalid_intent' });
  });

  it('rejects malformed prepared effect values without throwing', () => {
    const envelope = boundEnvelope();
    const valid = prepareSubmission({
      envelope,
      party_id: 'party_a',
      payload: { context: [], answer: { role: 'user', text: 'A valid answer.' } },
      in_reply_to: ['req_a_story'],
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('assertion_valid'),
          requirement_id: 'req_a_story',
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'A valid answer.',
          spans: [answerSpan(turnId, 'A valid answer.')],
          supersedes_candidate: null,
        },
      ],
    });
    const malformedPrepared = cloneCanonical(valid.submission) as unknown as {
      effects: Array<Record<string, unknown>>;
    };
    malformedPrepared.effects[0]!.spans = null;
    expect(() =>
      applyExternalRelaySubmissionV211({
        envelope,
        submission: malformedPrepared as unknown as ExternalRelaySubmissionV211,
        execution_authority: valid.authority,
      }),
    ).not.toThrow();
    expect(
      applyExternalRelaySubmissionV211({
        envelope,
        submission: malformedPrepared as unknown as ExternalRelaySubmissionV211,
        execution_authority: valid.authority,
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'invalid_submission' });

    const missingSource = {
      ...cloneCanonical(valid.submission),
      source_turn: null,
    } as unknown as ExternalRelaySubmissionV211;
    expect(() =>
      applyExternalRelaySubmissionV211({
        envelope,
        submission: missingSource,
        execution_authority: valid.authority,
      }),
    ).not.toThrow();
    expect(
      applyExternalRelaySubmissionV211({
        envelope,
        submission: missingSource,
        execution_authority: valid.authority,
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'invalid_submission' });
  });

  it('permits a source-only accepted turn without changing either party-visible cursor', () => {
    const envelope = boundEnvelope();
    const beforeViews = cloneCanonical(envelope.control.party_views);
    const prepared = prepareSubmission({
      envelope,
      party_id: 'party_a',
      payload: { context: [], answer: { role: 'user', text: 'I cannot add anything else.' } },
      in_reply_to: ['req_a_story'],
      effects: () => [],
    });
    const applied = applyPrepared(envelope, prepared);
    expect(applied.status, applied.message).toBe('applied');
    if (applied.status !== 'applied') return;
    expect(applied.resulting_envelope_version).toBe(envelope.control.envelope_version + 1);
    expect(applied.envelope.control.party_views).toEqual(beforeViews);
    expect(applied.changed_visible_parties).toEqual([]);
    expect(Object.keys(applied.envelope.source_turns)).toEqual([
      prepared.submission.source_turn.turn_id,
    ]);
  });

  it('rejects a source reply target that is hidden from the submitting party', () => {
    const envelope = boundEnvelope();
    const authority = partyAuthorityV211(envelope, 'party_a', 'external_relay');
    const cursor = envelope.control.party_views.party_a;
    const prepared = prepareExternalRelaySubmissionV211({
      envelope,
      execution_authority: authority,
      intent: {
        intent_version: 'juryai-external-relay-submission-intent-v2.1.1',
        expected_party_visible_version: cursor.party_visible_version,
        expected_party_projection_hash: cursor.party_projection_hash,
        client_turn_id: unique('client_hidden_target'),
        in_reply_to: ['req_b_story'],
        payload: { context: [], answer: { role: 'user', text: 'A source-only answer.' } },
        source_language: null,
        translation_indicated: false,
      },
      runtime: trustedExternalRelayRuntimeV211(TRUSTED_EXTERNAL_RELAY_BRIDGE_V211, {
        source_channel: 'webmcp_agent_relay',
        relaying_agent: null,
        received_at: NOW,
        payload_commitment_salt: '0123456789abcdef',
        ids: {
          submission_id: unique('submission_party_a'),
          source_turn_id: unique('turn_party_a'),
          position_ids: [],
          clarification_ids: [],
          challenge_ids: [],
          challenge_response_ids: [],
        },
      }),
      compiler_run: {
        compile_run_id: unique('compile_run'),
        compiler_version_id: sha256('compiler'),
        party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
        input_hash: sha256('input'),
        output_hash: sha256('output'),
      },
      effects: [],
    });
    expect(prepared).toMatchObject({ status: 'rejected', reason_code: 'invalid_intent' });
  });

  it('fails closed for arbitrary ceremony effects and mixed V2.1.0 envelopes', () => {
    const envelope = boundEnvelope();
    const authority = partyAuthorityV211(envelope, 'party_a', 'external_relay');
    const cursor = envelope.control.party_views.party_a;
    const arbitraryEffect = prepareExternalRelaySubmissionV211({
      envelope,
      execution_authority: authority,
      intent: {
        intent_version: 'juryai-external-relay-submission-intent-v2.1.1',
        expected_party_visible_version: cursor.party_visible_version,
        expected_party_projection_hash: cursor.party_projection_hash,
        client_turn_id: unique('client_arbitrary'),
        in_reply_to: [],
        payload: { context: [], answer: { role: 'user', text: 'Bind another party.' } },
        source_language: null,
        translation_indicated: false,
      },
      runtime: trustedExternalRelayRuntimeV211(TRUSTED_EXTERNAL_RELAY_BRIDGE_V211, {
        source_channel: 'webmcp_agent_relay',
        relaying_agent: null,
        received_at: NOW,
        payload_commitment_salt: '0123456789abcdef',
        ids: {
          submission_id: unique('submission_party_a'),
          source_turn_id: unique('turn_party_a'),
          position_ids: [],
          clarification_ids: [],
          challenge_ids: [],
          challenge_response_ids: [],
        },
      }),
      compiler_run: {
        compile_run_id: unique('compile_run'),
        compiler_version_id: sha256('compiler'),
        party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
        input_hash: sha256('input'),
        output_hash: sha256('output'),
      },
      effects: [{ type: 'bind_party', party_slot: 'party_b' } as never],
    });
    expect(arbitraryEffect).toMatchObject({ status: 'rejected', reason_code: 'invalid_intent' });

    const oldEnvelope = createInitialCaseEnvelopeV21(unique('dispute_old_contract'));
    expect(validateCaseEnvelopeV211(oldEnvelope as unknown as CaseEnvelopeV211)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'v211_exact_keys', path: 'envelope.control' }),
        expect.objectContaining({
          code: 'v211_contract_version',
          path: 'envelope.control.schema_version',
        }),
      ]),
    );
  });

  it('rejects duplicate party principals and party authority for system-only transitions', () => {
    let envelope = createInitialCaseEnvelopeV211(unique('dispute_v211_authority'));
    envelope = bind(envelope, 'party_a', 'subject_shared');
    const duplicate = applyEnvelopeCeremonyCommandV211({
      envelope,
      command: ceremonyCommandForV211(envelope, unique('ceremony_duplicate_binding'), {
        type: 'bind_party',
        party_slot: 'party_b',
        authenticated_subject_id: 'subject_shared',
        binding_event_id: unique('binding_party_b'),
      }),
      execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
    });
    expect(duplicate).toMatchObject({ status: 'rejected', reason_code: 'invalid_transition' });
    expect(duplicate.envelope.parties.party_b.authenticated_subject_id).toBeNull();

    envelope = bind(envelope, 'party_b', 'subject_distinct');
    const partyDisclosure = applyEnvelopeCeremonyCommandV211({
      envelope,
      command: ceremonyCommandForV211(envelope, unique('ceremony_party_disclosure'), {
        type: 'open_controlled_disclosure',
      }),
      execution_authority: partyAuthorityV211(envelope, 'party_a', 'first_party_human'),
    });
    expect(partyDisclosure).toMatchObject({
      status: 'rejected',
      reason_code: 'unauthorized_actor',
    });
    expect(partyDisclosure.envelope.control.disclosure_state).toBe('embargoed');

    const arbitraryCeremony = applyEnvelopeCeremonyCommandV211({
      envelope,
      command: {
        ...ceremonyCommandForV211(envelope, unique('ceremony_unknown'), {
          type: 'open_controlled_disclosure',
        }),
        operation: { type: 'manufacture_system_authority' },
      } as never,
      execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
    });
    expect(arbitraryCeremony).toMatchObject({
      status: 'rejected',
      reason_code: 'invalid_command',
    });
    expect(arbitraryCeremony.envelope.control.envelope_version).toBe(
      envelope.control.envelope_version,
    );
  });

  it('keeps every V2.1.1 authority and repository out of production composition', () => {
    for (const file of [...sourceFilesBelow('api'), ...sourceFilesBelow('src/webmcp')]) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toContain('/v2-1-1/');
      expect(source, file).not.toContain('TRUSTED_EXTERNAL_RELAY_BRIDGE_V211');
      expect(source, file).not.toContain('TRUSTED_SYSTEM_AUTHORITY_V211');
      expect(source, file).not.toContain('PostgresFormationRepositoryV211');
      expect(source, file).not.toContain('PostgresFormationInvitationRepositoryV211');
    }
  });
});

describe('derived clarification, supersession, challenge, and quiescence semantics', () => {
  it('opens ambiguity without a position and resolves it only through a satisfying assertion', () => {
    let envelope = boundEnvelope();
    const ambiguous = prepareSubmission({
      envelope,
      party_id: 'party_a',
      payload: { context: [], answer: { role: 'user', text: 'I am not sure what you mean.' } },
      in_reply_to: ['req_a_story'],
      effects: () => [
        {
          type: 'clarification_request',
          requirement_id: 'req_a_story',
          reason: 'multiple_incompatible_readings',
          prompt: 'Which event do you mean?',
        },
      ],
    });
    const opened = applyPrepared(envelope, ambiguous);
    expect(opened.status, opened.message).toBe('applied');
    if (opened.status !== 'applied') throw new Error(opened.message);
    envelope = opened.envelope;
    expect(opened.result.accepted_position_ids).toEqual([]);
    expect(opened.result.opened_clarification_ids).toHaveLength(1);
    expect(
      evaluateFormationRequirementV211(envelope, envelope.requirements.req_a_story!),
    ).toMatchObject({
      status: 'blocked_by_clarification',
    });

    const duplicate = prepareSubmission({
      envelope,
      party_id: 'party_a',
      payload: { context: [], answer: { role: 'user', text: 'Still unclear.' } },
      in_reply_to: ['req_a_story'],
      effects: () => [
        {
          type: 'clarification_request',
          requirement_id: 'req_a_story',
          reason: 'answer_does_not_address_requirement',
          prompt: 'Please explain.',
        },
      ],
    });
    expect(applyPrepared(envelope, duplicate)).toMatchObject({
      status: 'rejected',
      reason_code: 'effect_rejected',
    });

    const answered = prepareSubmission({
      envelope,
      party_id: 'party_a',
      payload: { context: [], answer: { role: 'user', text: 'The project stopped on March 1.' } },
      in_reply_to: ['req_a_story'],
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('assertion_answer'),
          requirement_id: 'req_a_story',
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'Party A says the project stopped on March 1.',
          spans: [answerSpan(turnId, 'The project stopped on March 1.')],
          supersedes_candidate: null,
        },
      ],
    });
    const resolved = applyPrepared(envelope, answered);
    expect(resolved.status, resolved.message).toBe('applied');
    if (resolved.status !== 'applied') throw new Error(resolved.message);
    expect(resolved.result.resolved_clarification_ids).toEqual(
      opened.result.opened_clarification_ids,
    );
    expect(
      evaluateFormationRequirementV211(
        resolved.envelope,
        resolved.envelope.requirements.req_a_story!,
      ).status,
    ).toBe('satisfied');
  });

  it('preserves immutable semantic history when a later assertion supersedes a live slot', () => {
    let envelope = submitAssertion(
      boundEnvelope(),
      'party_a',
      'req_a_story',
      'The work stopped in March.',
    );
    const original = Object.values(envelope.positions)[0]!;
    const prepared = prepareSubmission({
      envelope,
      party_id: 'party_a',
      payload: { context: [], answer: { role: 'user', text: 'Correction: it stopped in April.' } },
      in_reply_to: ['req_a_story'],
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('assertion_correction'),
          requirement_id: 'req_a_story',
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'Party A says the work stopped in April.',
          spans: [answerSpan(turnId, 'Correction: it stopped in April.')],
          supersedes_candidate: original.position_id,
        },
      ],
    });
    const result = applyPrepared(envelope, prepared);
    expect(result.status, result.message).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);
    const replacement = result.envelope.positions[result.result.accepted_position_ids[0]!]!;
    expect(result.result.superseded_position_ids).toEqual([original.position_id]);
    expect(result.envelope.positions[original.position_id]).toMatchObject({
      statement: original.statement,
      superseded_by: replacement.position_id,
      superseded_at_envelope_version: result.resulting_envelope_version,
    });
    expect(replacement.supersedes).toBe(original.position_id);
    expect(replacement.compile_run_id).toBe(prepared.submission.compiler_run.compile_run_id);
    expect(replacement.compiler_version_id).toBe(
      prepared.submission.compiler_run.compiler_version_id,
    );
  });

  it('records sourced challenges and sourced procedural responses after disclosure', () => {
    let envelope = submitAssertion(
      boundEnvelope({ party_a: [], party_b: [requirement('req_b_story')] }),
      'party_b',
      'req_b_story',
      'Party B completed the work.',
    );
    envelope = executeCeremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
      type: 'open_controlled_disclosure',
    });
    const target = Object.values(envelope.positions)[0]!;
    const challenged = prepareSubmission({
      envelope,
      party_id: 'party_a',
      payload: { context: [], answer: { role: 'user', text: 'I dispute that completion claim.' } },
      in_reply_to: [target.position_id],
      effects: (turnId) => [
        {
          type: 'challenge_candidate',
          target_position_id: target.position_id,
          statement: 'Party A disputes the completion claim.',
          spans: [answerSpan(turnId, 'I dispute that completion claim.')],
        },
      ],
    });
    const challengeResult = applyPrepared(envelope, challenged);
    expect(challengeResult.status, challengeResult.message).toBe('applied');
    if (challengeResult.status !== 'applied') throw new Error(challengeResult.message);
    envelope = challengeResult.envelope;
    const challenge = envelope.challenges[challengeResult.result.challenge_ids[0]!]!;
    expect(challenge).toMatchObject({
      challenging_party_id: 'party_a',
      target_party_id: 'party_b',
      source_turn_id: challenged.submission.source_turn.turn_id,
      compile_run_id: challenged.submission.compiler_run.compile_run_id,
      status: 'open',
    });

    const response = prepareSubmission({
      envelope,
      party_id: 'party_b',
      payload: { context: [], answer: { role: 'user', text: 'I stand by my completion account.' } },
      in_reply_to: [challenge.challenge_id],
      effects: (turnId) => [
        {
          type: 'challenge_response_candidate',
          challenge_id: challenge.challenge_id,
          statement: 'Party B stands by the completion account.',
          spans: [answerSpan(turnId, 'I stand by my completion account.')],
          semantic_correction: null,
        },
      ],
    });
    const responseResult = applyPrepared(envelope, response);
    expect(responseResult.status, responseResult.message).toBe('applied');
    if (responseResult.status !== 'applied') throw new Error(responseResult.message);
    expect(responseResult.envelope.challenges[challenge.challenge_id]!.response).toMatchObject({
      response_id: responseResult.result.challenge_response_ids[0],
      responding_party_id: 'party_b',
      source_turn_id: response.submission.source_turn.turn_id,
      compile_run_id: response.submission.compiler_run.compile_run_id,
      semantic_position_id: null,
    });
  });

  it('allows an unconfirmed challenge correction but requires first-party reopen once confirmed', () => {
    let envelope = submitAssertion(
      boundEnvelope({ party_a: [], party_b: [requirement('req_b_story')] }),
      'party_b',
      'req_b_story',
      'The work was complete.',
    );
    envelope = executeCeremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
      type: 'open_controlled_disclosure',
    });
    const target = Object.values(envelope.positions)[0]!;
    const makeChallenge = (current: CaseEnvelopeV211, targetPositionId: string) => {
      const prepared = prepareSubmission({
        envelope: current,
        party_id: 'party_a',
        payload: { context: [], answer: { role: 'user', text: 'That is not accurate.' } },
        in_reply_to: [targetPositionId],
        effects: (turnId) => [
          {
            type: 'challenge_candidate',
            target_position_id: targetPositionId,
            statement: 'Party A challenges the completion claim.',
            spans: [answerSpan(turnId, 'That is not accurate.')],
          },
        ],
      });
      const applied = applyPrepared(current, prepared);
      expect(applied.status, applied.message).toBe('applied');
      if (applied.status !== 'applied') throw new Error(applied.message);
      return applied.envelope;
    };
    envelope = makeChallenge(envelope, target.position_id);
    const challenge = Object.values(envelope.challenges)[0]!;
    const correction = prepareSubmission({
      envelope,
      party_id: 'party_b',
      payload: {
        context: [],
        answer: { role: 'user', text: 'Correction: only half was complete.' },
      },
      in_reply_to: [challenge.challenge_id, 'req_b_story'],
      effects: (turnId) => [
        {
          type: 'challenge_response_candidate',
          challenge_id: challenge.challenge_id,
          statement: 'Party B corrects the completion claim.',
          spans: [answerSpan(turnId, 'Correction: only half was complete.')],
          semantic_correction: {
            type: 'semantic_assertion_candidate',
            compiler_assertion_id: unique('assertion_challenge_correction'),
            requirement_id: 'req_b_story',
            proposed_type: 'narrative_fact',
            epistemic_strength: 'asserted_confident',
            statement: 'Party B says only half the work was complete.',
            spans: [answerSpan(turnId, 'Correction: only half was complete.')],
            supersedes_candidate: target.position_id,
          },
        },
      ],
    });
    const corrected = applyPrepared(envelope, correction);
    expect(corrected.status, corrected.message).toBe('applied');
    if (corrected.status !== 'applied') throw new Error(corrected.message);
    expect(corrected.result.superseded_position_ids).toEqual([target.position_id]);

    // Build a second cycle: close the current challenge, confirm both parties,
    // then Party A reopens and creates a challenge against still-confirmed B.
    envelope = corrected.envelope;
    envelope = executeCeremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
      type: 'enter_final_confirmation',
    });
    for (const partyId of ['party_a', 'party_b'] as const) {
      envelope = executeCeremony(
        envelope,
        partyAuthorityV211(envelope, partyId, 'first_party_human'),
        {
          type: 'record_party_confirmation',
          confirmation_id: unique(`confirmation_${partyId}`),
          event_id: unique(`confirmation_event_${partyId}`),
          adoption_statement: `I adopt ${partyId}.`,
          confirmed_at: NOW,
        },
      );
    }
    envelope = executeCeremony(
      envelope,
      partyAuthorityV211(envelope, 'party_a', 'first_party_human'),
      {
        type: 'reopen_own_formation',
        event_id: unique('reopen_event_party_a'),
        reason: 'A new challenge is necessary.',
        occurred_at: NOW,
      },
    );
    const liveTarget = Object.values(envelope.positions).find(
      (position) => position.attributed_party_id === 'party_b' && position.superseded_by === null,
    )!;
    envelope = makeChallenge(envelope, liveTarget.position_id);
    const secondChallenge = Object.values(envelope.challenges).find(
      (candidate) => candidate.status === 'open',
    )!;
    const blockedCorrection = prepareSubmission({
      envelope,
      party_id: 'party_b',
      payload: {
        context: [],
        answer: { role: 'user', text: 'Correction: almost all was complete.' },
      },
      in_reply_to: [secondChallenge.challenge_id, 'req_b_story'],
      effects: (turnId) => [
        {
          type: 'challenge_response_candidate',
          challenge_id: secondChallenge.challenge_id,
          statement: 'Party B offers a material correction.',
          spans: [answerSpan(turnId, 'Correction: almost all was complete.')],
          semantic_correction: {
            type: 'semantic_assertion_candidate',
            compiler_assertion_id: unique('assertion_confirmed_correction'),
            requirement_id: 'req_b_story',
            proposed_type: 'narrative_fact',
            epistemic_strength: 'asserted_qualified',
            statement: 'Party B says almost all work was complete.',
            spans: [answerSpan(turnId, 'Correction: almost all was complete.')],
            supersedes_candidate: liveTarget.position_id,
          },
        },
      ],
    });
    const beforeBlocked = canonicalSerialize(envelope);
    expect(applyPrepared(envelope, blockedCorrection)).toMatchObject({
      status: 'rejected',
      reason_code: 'explicit_reopen_required',
    });
    expect(canonicalSerialize(envelope)).toBe(beforeBlocked);

    const relayReopen = applyEnvelopeCeremonyCommandV211({
      envelope,
      command: ceremonyCommandForV211(envelope, unique('ceremony_relay_reopen'), {
        type: 'reopen_own_formation',
        event_id: unique('reopen_event_party_b'),
        reason: 'A relay must not reopen this account.',
        occurred_at: NOW,
      }),
      execution_authority: partyAuthorityV211(envelope, 'party_b', 'external_relay'),
    });
    expect(relayReopen).toMatchObject({ status: 'rejected', reason_code: 'unauthorized_actor' });
    expect(canonicalSerialize(relayReopen.envelope)).toBe(beforeBlocked);

    envelope = executeCeremony(
      envelope,
      partyAuthorityV211(envelope, 'party_b', 'first_party_human'),
      {
        type: 'reopen_own_formation',
        event_id: unique('reopen_event_party_b'),
        reason: 'I need to make a material challenge-response correction.',
        occurred_at: NOW,
      },
    );
    const allowedCorrection = prepareSubmission({
      envelope,
      party_id: 'party_b',
      payload: {
        context: [],
        answer: { role: 'user', text: 'Correction: almost all was complete.' },
      },
      in_reply_to: [secondChallenge.challenge_id, 'req_b_story'],
      effects: (turnId) => [
        {
          type: 'challenge_response_candidate',
          challenge_id: secondChallenge.challenge_id,
          statement: 'Party B offers a material correction.',
          spans: [answerSpan(turnId, 'Correction: almost all was complete.')],
          semantic_correction: {
            type: 'semantic_assertion_candidate',
            compiler_assertion_id: unique('assertion_reopened_correction'),
            requirement_id: 'req_b_story',
            proposed_type: 'narrative_fact',
            epistemic_strength: 'asserted_qualified',
            statement: 'Party B says almost all work was complete.',
            spans: [answerSpan(turnId, 'Correction: almost all was complete.')],
            supersedes_candidate: liveTarget.position_id,
          },
        },
      ],
    });
    const allowed = applyPrepared(envelope, allowedCorrection);
    expect(allowed.status, allowed.message).toBe('applied');
    if (allowed.status !== 'applied') throw new Error(allowed.message);
    expect(allowed.result.superseded_position_ids).toEqual([liveTarget.position_id]);
  });
});

describe('redaction, confirmation currency, and readiness', () => {
  it('keeps source attribution/commitments while excluding redacted conflict excerpts', () => {
    let envelope = submitAssertion(
      boundEnvelope(),
      'party_a',
      'req_a_story',
      'A source statement that will be erased.',
    );
    const position = Object.values(envelope.positions)[0]!;
    const turnId = position.source_turn_id;
    expect(conflictTurnSummariesForPartyV211(envelope, 'party_a')).toHaveLength(1);
    expect(conflictTurnSummariesForPartyV211(envelope, 'party_b')).toEqual([]);
    envelope = executeCeremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
      type: 'redact_source_turn',
      turn_id: turnId,
      redacted_at: NOW,
    });
    expect(envelope.source_turns[turnId]).toMatchObject({
      payload: null,
      attributed_party_id: 'party_a',
      authenticated_subject_id_at_receipt: 'subject_party_a',
    });
    expect(envelope.positions[position.position_id]).toMatchObject({
      attributed_party_id: 'party_a',
      source_turn_id: turnId,
      source_span_commitments: position.source_span_commitments,
    });
    expect(conflictTurnSummariesForPartyV211(envelope, 'party_a')).toEqual([]);
    expect(validateCaseEnvelopeV211(envelope)).toEqual([]);
  });

  it('does not trust corrupted explanatory blockers over derived readiness', () => {
    const envelope = boundEnvelope();
    const tampered = cloneCanonical(envelope);
    tampered.formation.explanatory = {
      open_required_fields: [],
      lock_prerequisites: [],
      lock_blockers: [],
    };
    const readiness = deriveFormationReadinessV211(tampered);
    expect(readiness.ready_for_bilateral_lock).toBe(false);
    expect(readiness.blockers).toContain('required_field_open:req_a_story');
    expect(readiness.explanatory_consistency_issues.length).toBeGreaterThan(0);
  });

  it('invalidates a party confirmation after that party explicitly reopens', () => {
    let envelope = boundEnvelope({ party_a: [], party_b: [requirement('req_b_story')] });
    envelope = submitAssertion(envelope, 'party_b', 'req_b_story', 'B formed an account.');
    envelope = executeCeremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
      type: 'open_controlled_disclosure',
    });
    envelope = executeCeremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
      type: 'enter_final_confirmation',
    });
    envelope = executeCeremony(
      envelope,
      partyAuthorityV211(envelope, 'party_a', 'first_party_human'),
      {
        type: 'record_party_confirmation',
        confirmation_id: unique('confirmation_party_a'),
        event_id: unique('confirmation_event_party_a'),
        adoption_statement: 'I adopt Party A account.',
        confirmed_at: NOW,
      },
    );
    expect(currentPartyConfirmationV211(envelope, 'party_a')).not.toBeNull();

    // Reopen A returns the workflow to challenge_response and invalidates A only.
    envelope = executeCeremony(
      envelope,
      partyAuthorityV211(envelope, 'party_a', 'first_party_human'),
      {
        type: 'reopen_own_formation',
        event_id: unique('reopen_event_party_a'),
        reason: 'I need to change my account.',
        occurred_at: NOW,
      },
    );
    expect(currentPartyConfirmationV211(envelope, 'party_a')).toBeNull();
  });

  it('derives bilateral readiness procedurally without requiring factual agreement', () => {
    let envelope = boundEnvelope();
    envelope = submitAssertion(
      envelope,
      'party_a',
      'req_a_story',
      'Party A says the work was incomplete.',
    );
    envelope = submitAssertion(
      envelope,
      'party_b',
      'req_b_story',
      'Party B says the work was complete.',
    );
    envelope = executeCeremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
      type: 'open_controlled_disclosure',
    });
    envelope = executeCeremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
      type: 'enter_final_confirmation',
    });
    for (const partyId of ['party_a', 'party_b'] as const) {
      envelope = executeCeremony(
        envelope,
        partyAuthorityV211(envelope, partyId, 'first_party_human'),
        {
          type: 'record_party_confirmation',
          confirmation_id: unique(`confirmation_${partyId}`),
          event_id: unique(`confirmation_event_${partyId}`),
          adoption_statement: `I adopt ${partyId}'s account.`,
          confirmed_at: NOW,
        },
      );
    }
    expect(Object.values(envelope.positions).map((position) => position.statement)).toEqual(
      expect.arrayContaining([
        'Party A says the work was incomplete.',
        'Party B says the work was complete.',
      ]),
    );
    expect(deriveFormationReadinessV211(envelope)).toMatchObject({
      ready_for_bilateral_lock: true,
      blockers: [],
      required_current_confirmations: [],
    });
    const duplicateConfirmation = applyEnvelopeCeremonyCommandV211({
      envelope,
      command: ceremonyCommandForV211(envelope, unique('ceremony_duplicate_confirmation'), {
        type: 'record_party_confirmation',
        confirmation_id: unique('confirmation_party_a'),
        event_id: unique('confirmation_event_party_a'),
        adoption_statement: 'I already adopted this account.',
        confirmed_at: NOW,
      }),
      execution_authority: partyAuthorityV211(envelope, 'party_a', 'first_party_human'),
    });
    expect(duplicateConfirmation).toMatchObject({
      status: 'rejected',
      reason_code: 'invalid_transition',
    });
  });
});
