/**
 * Deterministic relay fixtures for the PR 8C0b-2 parity suites.
 *
 * Every nondeterministic input the relay consumes — receipt time, commitment
 * salt, all server-minted canonical identifiers, the compiler run identity and
 * the compiler's effects — is generated ONCE per scenario and then fed
 * unchanged to both implementations. That is what makes byte comparison
 * meaningful: any difference in the output is a difference in behaviour, not a
 * difference in inputs, so no output normalisation is ever needed.
 *
 * Base envelopes are built by driving the FROZEN implementation, so every
 * envelope compared is one production could actually have produced.
 */

import { canonicalSerialize, cloneCanonical, sha256 } from '../v2/case-envelope.js';
import {
  PARTY_FORMATION_PROJECTION_VERSION_V214,
  TRUSTED_SYSTEM_AUTHORITY_V214,
  partyAuthorityV214,
  type CaseEnvelopeV214,
  type PartyIdV214,
} from '../v2-1-4/case-envelope.js';
import { createInitialCaseEnvelopeV214 } from '../v2-1-4/envelope-ceremony.js';
import {
  TRUSTED_EXTERNAL_RELAY_BRIDGE_V214,
  applyExternalRelaySubmissionV214,
  prepareExternalRelaySubmissionV214,
  rebaseExternalRelaySubmissionV214,
  trustedExternalRelayRuntimeV214,
  type ExternalRelayEffectCandidateV214,
} from '../v2-1-4/external-relay-submission.js';
import { partyAuthority, type CaseEnvelope } from '../formation/envelope.js';
import type { SourceTurnPayload, TurnSpan } from '../webmcp/core/turns.js';
import { answerSpan, bindBoth, ceremony, requirement, unique } from './v2-1-4-test-helpers.js';
import { V214_RELAY, asEngine } from './formation-relay-wiring.js';

const NOW = '2026-09-05T04:00:00.000Z';

export interface RuntimeIds {
  submission_id: string;
  source_turn_id: string;
  position_ids: string[];
  clarification_ids: string[];
  challenge_ids: string[];
  challenge_response_ids: string[];
}

export interface RelayScenario {
  envelope: CaseEnvelopeV214;
  requirementId: string;
  partyId: PartyIdV214;
  turnId: string;
  payload: SourceTurnPayload;
  inReplyTo: string[];
  clientTurnId: string;
  receivedAt: string;
  salt: string;
  ids: RuntimeIds;
  compilerRun: {
    compile_run_id: string;
    compiler_version_id: string;
    party_projection_contract_version: string;
    input_hash: string;
    output_hash: string;
  };
  effects: ExternalRelayEffectCandidateV214[];
  turnId2?: string;
}

/** A minimal runtime input, for tests that only exercise minting. */
export function RUNTIME_INPUT(turnId: string): {
  source_channel: 'webmcp_agent_relay';
  relaying_agent: string | null;
  received_at: string;
  payload_commitment_salt: string;
  ids: RuntimeIds;
} {
  return {
    source_channel: 'webmcp_agent_relay',
    relaying_agent: 'parity-relay',
    received_at: NOW,
    payload_commitment_salt: 'parity-salt-0123456789abcdef',
    ids: {
      submission_id: `submission_party_a_${turnId}`,
      source_turn_id: turnId,
      position_ids: [],
      clarification_ids: [],
      challenge_ids: [],
      challenge_response_ids: [],
    },
  };
}

export function boundEnvelope(requirementIds: {
  party_a?: string[];
  party_b?: string[];
}): CaseEnvelopeV214 {
  return bindBoth(
    createInitialCaseEnvelopeV214(unique('dispute_relay_parity'), {
      party_a: (requirementIds.party_a ?? []).map((id) => requirement(id)),
      party_b: (requirementIds.party_b ?? []).map((id) => requirement(id)),
    }),
  );
}

function assertionEffect(
  requirementId: string,
  turnId: string,
  statement: string,
  overrides: Partial<ExternalRelayEffectCandidateV214 & { proposed_type: string }> = {},
): ExternalRelayEffectCandidateV214 {
  return {
    type: 'semantic_assertion_candidate',
    compiler_assertion_id: unique('compiler_assertion'),
    requirement_id: requirementId,
    proposed_type: 'narrative_fact',
    epistemic_strength: 'asserted_confident',
    statement,
    spans: [answerSpan(turnId, statement)],
    supersedes_candidate: null,
    ...overrides,
  } as ExternalRelayEffectCandidateV214;
}

/**
 * The default scenario: party A records one narrative fact against one of its
 * own requirements, in an embargoed two-party case.
 */
export function relayCase(
  options: {
    envelope?: CaseEnvelopeV214;
    requirementId?: string;
    partyId?: PartyIdV214;
    answer?: string;
    effects?: (turnId: string, requirementId: string) => ExternalRelayEffectCandidateV214[];
    inReplyTo?: string[];
    positionCount?: number;
  } = {},
): RelayScenario {
  const partyId = options.partyId ?? 'party_a';
  const requirementId = options.requirementId ?? unique('req_a_performance');
  const envelope =
    options.envelope ?? boundEnvelope({ [partyId]: [requirementId] } as { party_a?: string[] });
  const answer =
    options.answer ?? 'The site was delivered on 15 July, two weeks after the agreed date.';
  const turnId = unique(`turn_${partyId}`);
  const effects = options.effects
    ? options.effects(turnId, requirementId)
    : [assertionEffect(requirementId, turnId, answer)];
  const positions =
    options.positionCount ??
    effects.reduce(
      (count, effect) =>
        count +
        (effect.type === 'semantic_assertion_candidate' ? 1 : 0) +
        (effect.type === 'challenge_response_candidate' && effect.semantic_correction ? 1 : 0),
      0,
    );
  return {
    envelope,
    requirementId,
    partyId,
    turnId,
    payload: { context: [], answer: { role: 'user', text: answer } },
    inReplyTo: options.inReplyTo ?? [requirementId],
    clientTurnId: unique('client_turn'),
    receivedAt: NOW,
    salt: `parity-salt-${unique('s')}-0123456789`,
    ids: {
      submission_id: unique(`submission_${partyId}`),
      source_turn_id: turnId,
      position_ids: Array.from({ length: positions }, () => unique(`position_${partyId}`)),
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
    compilerRun: {
      compile_run_id: unique('compile_run'),
      compiler_version_id: sha256('parity-compiler'),
      party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V214,
      input_hash: sha256(unique('input')),
      output_hash: sha256(unique('output')),
    },
    effects,
  };
}

type Tamper = (runtime: never) => unknown;
type IntentPatch = Record<string, unknown>;

function intentFor(scenario: RelayScenario, patch: IntentPatch = {}) {
  const cursor = scenario.envelope.control.party_views[scenario.partyId];
  return {
    intent_version: 'juryai-external-relay-submission-intent-v2.1.1',
    expected_party_visible_version: cursor.party_visible_version,
    expected_party_projection_hash: cursor.party_projection_hash,
    client_turn_id: scenario.clientTurnId,
    in_reply_to: scenario.inReplyTo,
    payload: scenario.payload,
    source_language: 'en',
    translation_indicated: false,
    ...patch,
  };
}

const runtimeInput = (scenario: RelayScenario) => ({
  source_channel: 'webmcp_agent_relay' as const,
  relaying_agent: 'parity-relay',
  received_at: scenario.receivedAt,
  payload_commitment_salt: scenario.salt,
  ids: cloneCanonical(scenario.ids) as RuntimeIds,
});

export function frozenPrepare(scenario: RelayScenario, tamper?: Tamper, patch?: IntentPatch) {
  const minted = trustedExternalRelayRuntimeV214(
    TRUSTED_EXTERNAL_RELAY_BRIDGE_V214,
    runtimeInput(scenario),
  );
  return prepareExternalRelaySubmissionV214({
    envelope: scenario.envelope,
    execution_authority: partyAuthorityV214(scenario.envelope, scenario.partyId, 'external_relay'),
    intent: intentFor(scenario, patch) as never,
    runtime: (tamper ? tamper(minted as never) : minted) as never,
    compiler_run: scenario.compilerRun as never,
    effects: cloneCanonical(scenario.effects),
  });
}

export function sharedPrepare(scenario: RelayScenario, tamper?: Tamper, patch?: IntentPatch) {
  const minted = V214_RELAY.mintRuntime(V214_RELAY.bridge, runtimeInput(scenario));
  return V214_RELAY.prepareExternalRelaySubmission({
    envelope: asEngine(scenario.envelope),
    execution_authority: partyAuthority(
      asEngine(scenario.envelope),
      scenario.partyId,
      'external_relay',
    ),
    intent: intentFor(scenario, patch) as never,
    runtime: (tamper ? tamper(minted as never) : minted) as never,
    compiler_run: scenario.compilerRun as never,
    effects: cloneCanonical(scenario.effects) as never,
  });
}

/** Prepares on the frozen side, then applies the SAME submission to both. */
export function bothApply(
  scenario: RelayScenario,
  mutate?: (submission: Record<string, unknown>) => void,
  authorityParty?: PartyIdV214,
) {
  const prepared = frozenPrepare(scenario);
  if (prepared.status !== 'prepared') throw new Error(`prepare failed: ${prepared.message}`);
  const submission = cloneCanonical(prepared.submission) as unknown as Record<string, unknown>;
  if (mutate) mutate(submission);
  const party = authorityParty ?? scenario.partyId;
  const frozen = applyExternalRelaySubmissionV214({
    envelope: scenario.envelope,
    submission: submission as never,
    execution_authority: partyAuthorityV214(scenario.envelope, party, 'external_relay'),
  });
  const shared = V214_RELAY.applyExternalRelaySubmission({
    envelope: asEngine(scenario.envelope),
    submission: cloneCanonical(submission) as never,
    execution_authority: partyAuthority(asEngine(scenario.envelope), party, 'external_relay'),
  });
  return { frozen, shared, submission };
}

export function bothRebase(scenario: RelayScenario, current: CaseEnvelopeV214) {
  const prepared = frozenPrepare(scenario);
  if (prepared.status !== 'prepared') throw new Error(`prepare failed: ${prepared.message}`);
  const submission = cloneCanonical(prepared.submission);
  return {
    frozen: rebaseExternalRelaySubmissionV214(submission, current),
    shared: V214_RELAY.rebaseExternalRelaySubmission(
      cloneCanonical(submission) as never,
      asEngine(current) as never,
    ),
  };
}

/** Canonical byte comparison, the only equality this PR trusts. */
export const bytes = (value: unknown): string => canonicalSerialize(value as never);

/** Records a fact through the FROZEN implementation, for building base state. */
export function recordFact(
  envelope: CaseEnvelopeV214,
  partyId: PartyIdV214,
  requirementId: string,
  answer: string,
): CaseEnvelopeV214 {
  const scenario = relayCase({ envelope, requirementId, partyId, answer });
  const prepared = frozenPrepare(scenario);
  if (prepared.status !== 'prepared') throw new Error(prepared.message);
  const applied = applyExternalRelaySubmissionV214({
    envelope,
    submission: prepared.submission,
    execution_authority: partyAuthorityV214(envelope, partyId, 'external_relay'),
  });
  if (applied.status !== 'applied') throw new Error(`${applied.reason_code}: ${applied.message}`);
  return applied.envelope;
}

export function disclose(envelope: CaseEnvelopeV214): CaseEnvelopeV214 {
  return ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V214, {
    type: 'open_controlled_disclosure',
  });
}

export { answerSpan, unique, assertionEffect, type CaseEnvelope, type TurnSpan };
