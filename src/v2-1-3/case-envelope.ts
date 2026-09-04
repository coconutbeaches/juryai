import {
  canonicalSerialize,
  cloneCanonical,
  sha256,
  type ContractIssue,
  type JsonValue,
} from '../v2/case-envelope.js';
import type { AmbiguityReason } from '../webmcp/core-v0-3/compiler-contract.js';
import type {
  EpistemicStrength,
  PropositionType,
  SourceChannel,
} from '../webmcp/core-v0-3/types.js';
import type { SourceTurnPayload } from '../webmcp/core/turns.js';

export const CASE_ENVELOPE_SCHEMA_VERSION_V213 = 'juryai-case-envelope-v2.1.3';
export const FORMATION_PROTOCOL_VERSION_V213 = 'juryai-formation-protocol-v2.1.3';
export const ENVELOPE_COMMAND_VERSION_V213 = 'juryai-envelope-command-v2.1.3';
export const EXTERNAL_RELAY_SUBMISSION_VERSION_V213 = 'juryai-external-relay-submission-v2.1.3';
export const EXTERNAL_RELAY_SUBMISSION_INTENT_VERSION_V213 =
  'juryai-external-relay-submission-intent-v2.1.1';
export const PARTY_FORMATION_PROJECTION_VERSION_V213 = 'juryai-party-formation-projection-v2.1.3';
export const PARTY_FORMATION_READBACK_VERSION_V213 = 'juryai-party-formation-readback-v2.1.3';
export const FORMATION_READINESS_VERSION_V213 = 'juryai-formation-readiness-v2.1.3';
export const PARTY_CONFIRMATION_VERSION_V213 = 'juryai-party-confirmation-v2.1.3';

export const DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V213 =
  'juryai-disclosure-review-acknowledgment-v2.1.3';

export const DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V213 =
  'I have reviewed the currently disclosed case material and have no further challenges to raise at this time.';

export type PartyIdV213 = 'party_a' | 'party_b';
export type WorkflowStateV213 =
  'independent_formation' | 'challenge_response' | 'final_confirmation' | 'ready_for_lock';
export type PartyInteractionAuthorityV213 = 'external_relay' | 'first_party_human';

const PARTY_AUTHORITY_BRAND_V213: unique symbol = Symbol('juryai-party-authority-v2.1.3');

export interface AuthenticatedPartyAuthorityV213 {
  readonly actor_type: 'party';
  readonly party_id: PartyIdV213;
  readonly authenticated_subject_id: string;
  readonly interaction_authority: PartyInteractionAuthorityV213;
  readonly [PARTY_AUTHORITY_BRAND_V213]: true;
}

const SYSTEM_AUTHORITY_BRAND_V213: unique symbol = Symbol('juryai-system-authority-v2.1.3');

export interface TrustedSystemAuthorityV213 {
  readonly actor_type: 'system';
  readonly authority_kind: 'trusted_domain_system_v2_1_3';
  readonly [SYSTEM_AUTHORITY_BRAND_V213]: true;
}

export const TRUSTED_SYSTEM_AUTHORITY_V213: TrustedSystemAuthorityV213 = Object.freeze({
  actor_type: 'system',
  authority_kind: 'trusted_domain_system_v2_1_3',
  [SYSTEM_AUTHORITY_BRAND_V213]: true as const,
});

export type ExecutionAuthorityV213 = AuthenticatedPartyAuthorityV213 | TrustedSystemAuthorityV213;

export function isTrustedSystemAuthorityV213(
  authority: unknown,
): authority is TrustedSystemAuthorityV213 {
  return authority === TRUSTED_SYSTEM_AUTHORITY_V213;
}

export interface PartyBindingV213 {
  party_id: PartyIdV213;
  role: PartyIdV213;
  authenticated_subject_id: string | null;
  identity_assurance: 'unbound' | 'authenticated';
  binding_event_id: string | null;
  edit_state: 'open' | 'confirmed' | 'reopened';
  formation_epoch: number;
}

export interface SourceTurnPayloadLayoutV213 {
  context_utf16_lengths: number[];
  answer_utf16_length: number;
}

export interface SourceTurnV213 {
  turn_id: string;
  dispute_id: string;
  attributed_party_id: PartyIdV213;
  authenticated_subject_id_at_receipt: string;
  party_visible_version_before: number;
  received_at: string;
  source_channel: SourceChannel;
  relaying_agent: string | null;
  source_language: string | null;
  translation_indicated: boolean;
  in_reply_to: string[];
  client_turn_id: string;
  request_fingerprint: string;
  payload: SourceTurnPayload | null;
  payload_layout: SourceTurnPayloadLayoutV213;
  payload_commitment_salt: string;
  payload_commitment: string;
  compile_run_id: string;
  redacted_at: string | null;
  redacted_at_envelope_version: number | null;
}

export interface SourceSpanCommitmentV213 {
  turn_id: string;
  region: 'answer' | 'context';
  message_index: number | null;
  encoding: 'utf16';
  start: number;
  end: number;
  quote_hash: string;
}

export interface CanonicalSemanticPositionV213 {
  position_id: string;
  attributed_party_id: PartyIdV213;
  requirement_id: string;
  proposition_type: PropositionType;
  epistemic_strength: EpistemicStrength;
  statement: string;
  resolution_status: 'disputed' | 'unresolved' | 'procedurally_resolved';
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitmentV213[];
  supersedes: string | null;
  superseded_by: string | null;
  superseded_at_envelope_version: number | null;
  introduced_envelope_version: number;
  last_material_envelope_version: number;
  compile_run_id: string;
  compiler_version_id: string;
  evidence_ref_id: string | null;
}

export interface FormationRequirementV213 {
  requirement_id: string;
  party_id: PartyIdV213;
  label: string;
  prompt: string;
  required: boolean;
  satisfying_types: PropositionType[];
  min_propositions: number;
  max_propositions: number | null;
  adverse_fact_probe: boolean;
  reopened_from: string | null;
}

export interface FormationClarificationV213 {
  clarification_id: string;
  party_id: PartyIdV213;
  requirement_id: string;
  reason: AmbiguityReason;
  prompt: string;
  opened_at_envelope_version: number;
  resolved_at_envelope_version: number | null;
  reopened_as: string | null;
}

export interface EvidenceReferenceV213 {
  evidence_id: string;
  attributed_party_id: PartyIdV213;
  description: string;
  required_for_readiness: boolean;
  eligibility: 'pending' | 'eligible' | 'ineligible' | 'not_required';
}

export interface FormationChallengeResponseV213 {
  response_id: string;
  responding_party_id: PartyIdV213;
  statement: string;
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitmentV213[];
  compile_run_id: string;
  compiler_version_id: string;
  semantic_position_id: string | null;
  introduced_envelope_version: number;
}

export interface FormationChallengeV213 {
  challenge_id: string;
  challenging_party_id: PartyIdV213;
  target_party_id: PartyIdV213;
  target_position_id: string;
  statement: string;
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitmentV213[];
  compile_run_id: string;
  compiler_version_id: string;
  introduced_envelope_version: number;
  status: 'open' | 'resolved' | 'withdrawn';
  response: FormationChallengeResponseV213 | null;
}

export interface PartyConfirmationReceiptV213 {
  confirmation_version: typeof PARTY_CONFIRMATION_VERSION_V213;
  confirmation_id: string;
  party_id: PartyIdV213;
  authenticated_subject_id: string;
  party_projection_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V213;
  party_projection_hash: string;
  party_visible_version: number;
  party_readback_version: typeof PARTY_FORMATION_READBACK_VERSION_V213;
  party_readback_hash: string;
  adoption_statement_hash: string;
  formation_epoch: number;
  shared_envelope_version: number;
  shared_envelope_hash: string;
  confirmed_at: string;
  event_id: string;
}

export interface FormationReopenEventV213 {
  event_id: string;
  party_id: PartyIdV213;
  authenticated_subject_id: string;
  prior_formation_epoch: number;
  resulting_formation_epoch: number;
  reason: string;
  occurred_at: string;
}

export interface PartyViewCursorV213 {
  party_visible_version: number;
  party_projection_hash: string;
}

export interface FormationExplanatoryStateV213 {
  open_required_fields: string[];
  lock_prerequisites: string[];
  lock_blockers: string[];
}

export interface DisclosureReviewAcknowledgmentV213 {
  acknowledgment_version: typeof DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V213;
  acknowledgment_id: string;
  event_id: string;
  dispute_id: string;
  party_id: PartyIdV213;
  authenticated_subject_id: string;
  formation_epoch: number;
  party_projection_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V213;
  party_projection_hash: string;
  party_visible_version: number;
  party_readback_version: typeof PARTY_FORMATION_READBACK_VERSION_V213;
  party_readback_hash: string;
  acknowledgment_statement_hash: string;
  acknowledged_at: string;
  acknowledged_at_envelope_version: number;
}

export interface CaseEnvelopeV213 {
  control: {
    schema_version: typeof CASE_ENVELOPE_SCHEMA_VERSION_V213;
    protocol_version: typeof FORMATION_PROTOCOL_VERSION_V213;
    command_contract_version: typeof ENVELOPE_COMMAND_VERSION_V213;
    external_submission_contract_version: typeof EXTERNAL_RELAY_SUBMISSION_VERSION_V213;
    projection_contract_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V213;
    readiness_contract_version: typeof FORMATION_READINESS_VERSION_V213;
    case_id: string;
    workflow_state: WorkflowStateV213;
    envelope_version: number;
    envelope_hash: string;
    disclosure_state: 'embargoed' | 'disclosed';
    party_views: Record<PartyIdV213, PartyViewCursorV213>;
  };
  parties: Record<PartyIdV213, PartyBindingV213>;
  source_turns: Record<string, SourceTurnV213>;
  positions: Record<string, CanonicalSemanticPositionV213>;
  requirements: Record<string, FormationRequirementV213>;
  clarifications: Record<string, FormationClarificationV213>;
  evidence: Record<string, EvidenceReferenceV213>;
  challenges: Record<string, FormationChallengeV213>;
  formation: {
    confirmations: Record<PartyIdV213, PartyConfirmationReceiptV213[]>;
    reopen_events: FormationReopenEventV213[];
    disclosure_review_acknowledgments: Record<PartyIdV213, DisclosureReviewAcknowledgmentV213[]>;
    explanatory: FormationExplanatoryStateV213;
  };
}

export const PARTY_IDS_V213: readonly PartyIdV213[] = Object.freeze(['party_a', 'party_b']);
export const ID_PATTERN_V213 = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;
export const HASH_PATTERN_V213 = /^[a-f0-9]{64}$/u;

export function otherPartyV213(partyId: PartyIdV213): PartyIdV213 {
  return partyId === 'party_a' ? 'party_b' : 'party_a';
}

export function isPartyScopedIdV213(
  kind:
    | 'binding'
    | 'position'
    | 'turn'
    | 'clarification'
    | 'challenge'
    | 'challenge_response'
    | 'confirmation'
    | 'confirmation_event'
    | 'reopen_event'
    | 'disclosure_ack'
    | 'disclosure_ack_event',
  partyId: PartyIdV213,
  identifier: string,
): boolean {
  return identifier.startsWith(`${kind}_${partyId}_`) && ID_PATTERN_V213.test(identifier);
}

export function hashAdoptionStatementV213(statement: string): string {
  return sha256(statement);
}

function envelopeHashProjectionV213(envelope: CaseEnvelopeV213): JsonValue {
  const projection = cloneCanonical(envelope) as unknown as Record<string, JsonValue>;
  const control = projection.control as Record<string, JsonValue>;
  delete control.envelope_hash;
  return projection;
}

export function hashCaseEnvelopeV213(envelope: CaseEnvelopeV213): string {
  return sha256(canonicalSerialize(envelopeHashProjectionV213(envelope)));
}

export function partyAuthorityV213(
  envelope: CaseEnvelopeV213,
  partyId: PartyIdV213,
  interactionAuthority: PartyInteractionAuthorityV213,
): AuthenticatedPartyAuthorityV213 {
  const party = envelope.parties[partyId];
  if (party.identity_assurance !== 'authenticated' || !party.authenticated_subject_id) {
    throw new TypeError(`${partyId} has no authenticated subject binding.`);
  }
  return Object.freeze({
    actor_type: 'party',
    party_id: partyId,
    authenticated_subject_id: party.authenticated_subject_id,
    interaction_authority: interactionAuthority,
    [PARTY_AUTHORITY_BRAND_V213]: true as const,
  });
}

export function isAuthenticatedPartyAuthorityV213(
  authority: unknown,
): authority is AuthenticatedPartyAuthorityV213 {
  return (
    typeof authority === 'object' &&
    authority !== null &&
    PARTY_AUTHORITY_BRAND_V213 in authority &&
    (authority as AuthenticatedPartyAuthorityV213)[PARTY_AUTHORITY_BRAND_V213] === true
  );
}

export function cloneCaseEnvelopeV213(envelope: CaseEnvelopeV213): CaseEnvelopeV213 {
  return cloneCanonical(envelope);
}

export function hashDisclosureReviewAcknowledgmentStatementV213(statement: string): string {
  return sha256(statement);
}
export type { ContractIssue };
