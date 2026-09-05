import { describe, expect, it } from 'vitest';
import {
  INTENT_ASSURANCE_ACTIONS_V1,
  INTENT_ASSURANCE_POLICY_VERSION_V1,
  TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
  TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
  hashIntentAssuranceActionPayloadV1,
  observeIntentAssuranceEvidenceV1,
  resolveIntentAssurancePolicyDecisionV1,
  type HumanHandoffChallengeV1,
  type IntentAssuranceActionV1,
  type IntentAssuranceLevelV1,
  type IntentAssuranceProtocolProfileV1,
} from '../intent-assurance/intent-assurance.js';
import { cloneCanonical, type JsonValue } from '../v2/case-envelope.js';
import {
  PARTY_REVIEW_PROTECTED_ACTION_VERSION_V1,
  validatePartyReviewProtectedActionPayloadV1,
  type PartyReviewProtectedActionV1,
} from '../v2-1-1/party-review-application.js';
import {
  ENVELOPE_COMMAND_VERSION_V214,
  TRUSTED_SYSTEM_AUTHORITY_V214,
  partyAuthorityV214,
  type CaseEnvelopeV214,
  type PartyIdV214,
} from '../v2-1-4/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV214,
  ceremonyCommandForV214,
  createInitialCaseEnvelopeV214,
  type EnvelopeCeremonyOperationV214,
} from '../v2-1-4/envelope-ceremony.js';
import {
  PARTY_REVIEW_PROTECTED_ACTION_VERSION_V214,
  executePartyReviewProtectedActionV214,
  preparePartyReviewChallengeV214,
  validatePartyReviewProtectedActionPayloadV214,
  type PartyReviewProtectedActionPayloadV214,
} from '../v2-1-4/party-review-application.js';

const BASE_TIME = Date.parse('2026-09-03T07:45:00.000Z');
let sequence = 0;

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence}`;
}

function now(): string {
  return new Date(BASE_TIME + sequence * 1_000).toISOString();
}

function ceremony(
  envelope: CaseEnvelopeV214,
  authority: Parameters<typeof applyEnvelopeCeremonyCommandV214>[0]['execution_authority'],
  operation: EnvelopeCeremonyOperationV214,
): CaseEnvelopeV214 {
  const result = applyEnvelopeCeremonyCommandV214({
    envelope,
    command: ceremonyCommandForV214(envelope, unique('command'), operation),
    execution_authority: authority,
  });
  if (result.status !== 'applied') throw new Error(`${result.reason_code}: ${result.message}`);
  return result.envelope;
}

function finalConfirmationEnvelope(): CaseEnvelopeV214 {
  let envelope = createInitialCaseEnvelopeV214(unique('dispute_party_review'));
  for (const partyId of ['party_a', 'party_b'] as const) {
    envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V214, {
      type: 'bind_party',
      party_slot: partyId,
      authenticated_subject_id: unique(`subject_${partyId}`),
      binding_event_id: unique(`binding_${partyId}`),
    });
  }
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V214, {
    type: 'open_controlled_disclosure',
  });
  for (const partyId of ['party_a', 'party_b'] as const) {
    envelope = ceremony(envelope, partyAuthorityV214(envelope, partyId, 'first_party_human'), {
      type: 'record_disclosure_review_acknowledgment',
      acknowledgment_id: unique(`disclosure_ack_${partyId}`),
      event_id: unique(`disclosure_ack_event_${partyId}`),
      acknowledged_at: now(),
    });
  }
  return ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V214, {
    type: 'enter_final_confirmation',
  });
}

function policy(action: PartyReviewProtectedActionV1) {
  const profile: IntentAssuranceProtocolProfileV1 = {
    policy_version: INTENT_ASSURANCE_POLICY_VERSION_V1,
    profile_id: 'profile_v214_normal_hhc3',
    minimum_assurance_by_action: Object.fromEntries(
      INTENT_ASSURANCE_ACTIONS_V1.map((candidate) => [candidate, 'HHC-3']),
    ) as Record<IntentAssuranceActionV1, IntentAssuranceLevelV1>,
  };
  const decision = resolveIntentAssurancePolicyDecisionV1(
    action,
    profile,
    TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
  );
  if (!decision) throw new Error('test policy must resolve');
  return decision;
}

function ids(partyId: PartyIdV214) {
  return {
    challenge_id: unique('handoff_challenge'),
    public_reference: `PR6-${String(++sequence).padStart(3, '0')}`,
    command_id: unique(`command_${partyId}`),
    confirmation_id: unique(`confirmation_${partyId}`),
    confirmation_event_id: unique(`confirmation_event_${partyId}`),
    reopen_event_id: unique(`reopen_event_${partyId}`),
  };
}

function evidence(challenge: HumanHandoffChallengeV1) {
  const observed = observeIntentAssuranceEvidenceV1(
    {
      method: 'first_party_ceremony',
      challenge_id: challenge.challenge_id,
      first_party_session_id: unique('first_party_session'),
      ceremony_event_id: unique('ceremony_event'),
      server_observed: true,
      observed_at: challenge.issued_at,
      evidence_reference: unique('evidence_reference'),
    },
    TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
  );
  if (!observed) throw new Error('test evidence must be trusted');
  return observed;
}

function prepare(
  envelope: CaseEnvelopeV214,
  partyId: PartyIdV214,
  action: PartyReviewProtectedActionV1,
) {
  const prepared = preparePartyReviewChallengeV214({
    envelope,
    authenticated_subject_id: envelope.parties[partyId].authenticated_subject_id!,
    requested_action: action,
    current_policy_decision: policy(action),
    permitted_methods: ['first_party_ceremony'],
    expires_in_seconds: 300,
    issued_at: now(),
    ids: ids(partyId),
    ...(action === 'reopen_confirmed_material'
      ? { reopen_reason: 'I need to correct my own canonical account.' }
      : {}),
  });
  if (prepared.status !== 'prepared') throw new Error(prepared.message);
  return prepared;
}

function execute(
  envelope: CaseEnvelopeV214,
  partyId: PartyIdV214,
  prepared: ReturnType<typeof prepare>,
  action: PartyReviewProtectedActionV1,
) {
  return executePartyReviewProtectedActionV214({
    envelope,
    authenticated_subject_id: envelope.parties[partyId].authenticated_subject_id!,
    challenge: prepared.challenge,
    action_payload: prepared.action_payload,
    expected_action: action,
    current_policy_decision: policy(action),
    observed_evidence: evidence(prepared.challenge),
    completed_at: prepared.challenge.issued_at,
    consumed_at: prepared.challenge.issued_at,
    receipt_id: unique('assurance_receipt'),
    consumption_id: unique('assurance_consumption'),
  });
}

export { prepare, execute };
