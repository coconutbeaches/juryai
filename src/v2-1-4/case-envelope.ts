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

export const CASE_ENVELOPE_SCHEMA_VERSION_V214 = 'juryai-case-envelope-v2.1.4';
export const FORMATION_PROTOCOL_VERSION_V214 = 'juryai-formation-protocol-v2.1.4';
export const ENVELOPE_COMMAND_VERSION_V214 = 'juryai-envelope-command-v2.1.4';
export const EXTERNAL_RELAY_SUBMISSION_VERSION_V214 = 'juryai-external-relay-submission-v2.1.4';
export const EXTERNAL_RELAY_SUBMISSION_INTENT_VERSION_V214 =
  'juryai-external-relay-submission-intent-v2.1.1';
export const PARTY_FORMATION_PROJECTION_VERSION_V214 = 'juryai-party-formation-projection-v2.1.4';
export const PARTY_FORMATION_READBACK_VERSION_V214 = 'juryai-party-formation-readback-v2.1.4';
export const FORMATION_READINESS_VERSION_V214 = 'juryai-formation-readiness-v2.1.4';
export const PARTY_CONFIRMATION_VERSION_V214 = 'juryai-party-confirmation-v2.1.4';

export const DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V214 =
  'juryai-disclosure-review-acknowledgment-v2.1.4';

export const DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V214 =
  'I have reviewed the currently disclosed case material and have no further challenges to raise at this time.';

export type PartyIdV214 = 'party_a' | 'party_b';
export type WorkflowStateV214 =
  'independent_formation' | 'challenge_response' | 'final_confirmation' | 'ready_for_lock';
export type PartyInteractionAuthorityV214 = 'external_relay' | 'first_party_human';

const PARTY_AUTHORITY_BRAND_V214: unique symbol = Symbol('juryai-party-authority-v2.1.4');

export interface AuthenticatedPartyAuthorityV214 {
  readonly actor_type: 'party';
  readonly party_id: PartyIdV214;
  readonly authenticated_subject_id: string;
  readonly interaction_authority: PartyInteractionAuthorityV214;
  readonly [PARTY_AUTHORITY_BRAND_V214]: true;
}

const SYSTEM_AUTHORITY_BRAND_V214: unique symbol = Symbol('juryai-system-authority-v2.1.4');

export interface TrustedSystemAuthorityV214 {
  readonly actor_type: 'system';
  readonly authority_kind: 'trusted_domain_system_v2_1_4';
  readonly [SYSTEM_AUTHORITY_BRAND_V214]: true;
}

export const TRUSTED_SYSTEM_AUTHORITY_V214: TrustedSystemAuthorityV214 = Object.freeze({
  actor_type: 'system',
  authority_kind: 'trusted_domain_system_v2_1_4',
  [SYSTEM_AUTHORITY_BRAND_V214]: true as const,
});

export type ExecutionAuthorityV214 = AuthenticatedPartyAuthorityV214 | TrustedSystemAuthorityV214;

export function isTrustedSystemAuthorityV214(
  authority: unknown,
): authority is TrustedSystemAuthorityV214 {
  return authority === TRUSTED_SYSTEM_AUTHORITY_V214;
}

export interface PartyBindingV214 {
  party_id: PartyIdV214;
  role: PartyIdV214;
  authenticated_subject_id: string | null;
  identity_assurance: 'unbound' | 'authenticated';
  binding_event_id: string | null;
  edit_state: 'open' | 'confirmed' | 'reopened';
  formation_epoch: number;
}

export interface SourceTurnPayloadLayoutV214 {
  context_utf16_lengths: number[];
  answer_utf16_length: number;
}

export interface SourceTurnV214 {
  turn_id: string;
  dispute_id: string;
  attributed_party_id: PartyIdV214;
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
  payload_layout: SourceTurnPayloadLayoutV214;
  payload_commitment_salt: string;
  payload_commitment: string;
  compile_run_id: string;
  redacted_at: string | null;
  redacted_at_envelope_version: number | null;
}

export interface SourceSpanCommitmentV214 {
  turn_id: string;
  region: 'answer' | 'context';
  message_index: number | null;
  encoding: 'utf16';
  start: number;
  end: number;
  quote_hash: string;
}

export interface CanonicalSemanticPositionV214 {
  position_id: string;
  attributed_party_id: PartyIdV214;
  requirement_id: string;
  proposition_type: PropositionType;
  epistemic_strength: EpistemicStrength;
  statement: string;
  resolution_status: 'disputed' | 'unresolved' | 'procedurally_resolved';
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitmentV214[];
  supersedes: string | null;
  superseded_by: string | null;
  superseded_at_envelope_version: number | null;
  introduced_envelope_version: number;
  last_material_envelope_version: number;
  compile_run_id: string;
  compiler_version_id: string;
  evidence_ref_id: string | null;
}

export interface FormationRequirementV214 {
  requirement_id: string;
  party_id: PartyIdV214;
  label: string;
  prompt: string;
  required: boolean;
  satisfying_types: PropositionType[];
  min_propositions: number;
  max_propositions: number | null;
  adverse_fact_probe: boolean;
  reopened_from: string | null;
}

export interface FormationClarificationV214 {
  clarification_id: string;
  party_id: PartyIdV214;
  requirement_id: string;
  reason: AmbiguityReason;
  prompt: string;
  opened_at_envelope_version: number;
  resolved_at_envelope_version: number | null;
  reopened_as: string | null;
}

export interface EvidenceReferenceV214 {
  evidence_id: string;
  attributed_party_id: PartyIdV214;
  description: string;
  required_for_readiness: boolean;
  eligibility: 'pending' | 'eligible' | 'ineligible' | 'not_required';
}

export interface FormationChallengeResponseV214 {
  response_id: string;
  responding_party_id: PartyIdV214;
  statement: string;
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitmentV214[];
  compile_run_id: string;
  compiler_version_id: string;
  semantic_position_id: string | null;
  introduced_envelope_version: number;
}

export interface FormationChallengeV214 {
  challenge_id: string;
  challenging_party_id: PartyIdV214;
  target_party_id: PartyIdV214;
  target_position_id: string;
  statement: string;
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitmentV214[];
  compile_run_id: string;
  compiler_version_id: string;
  introduced_envelope_version: number;
  status: 'open' | 'resolved' | 'withdrawn';
  response: FormationChallengeResponseV214 | null;
}

export interface PartyConfirmationReceiptV214 {
  confirmation_version: typeof PARTY_CONFIRMATION_VERSION_V214;
  confirmation_id: string;
  party_id: PartyIdV214;
  authenticated_subject_id: string;
  party_projection_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V214;
  party_projection_hash: string;
  party_visible_version: number;
  party_readback_version: typeof PARTY_FORMATION_READBACK_VERSION_V214;
  party_readback_hash: string;
  adoption_statement_hash: string;
  formation_epoch: number;
  shared_envelope_version: number;
  shared_envelope_hash: string;
  confirmed_at: string;
  event_id: string;
}

export interface FormationReopenEventV214 {
  event_id: string;
  party_id: PartyIdV214;
  authenticated_subject_id: string;
  prior_formation_epoch: number;
  resulting_formation_epoch: number;
  reason: string;
  occurred_at: string;
}

export interface PartyViewCursorV214 {
  party_visible_version: number;
  party_projection_hash: string;
}

export interface FormationExplanatoryStateV214 {
  open_required_fields: string[];
  lock_prerequisites: string[];
  lock_blockers: string[];
}

export interface DisclosureReviewAcknowledgmentV214 {
  acknowledgment_version: typeof DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V214;
  acknowledgment_id: string;
  event_id: string;
  dispute_id: string;
  party_id: PartyIdV214;
  authenticated_subject_id: string;
  formation_epoch: number;
  party_projection_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V214;
  party_projection_hash: string;
  party_visible_version: number;
  party_readback_version: typeof PARTY_FORMATION_READBACK_VERSION_V214;
  party_readback_hash: string;
  acknowledgment_statement_hash: string;
  acknowledged_at: string;
  acknowledged_at_envelope_version: number;
}

export interface CaseEnvelopeV214 {
  control: {
    schema_version: typeof CASE_ENVELOPE_SCHEMA_VERSION_V214;
    protocol_version: typeof FORMATION_PROTOCOL_VERSION_V214;
    command_contract_version: typeof ENVELOPE_COMMAND_VERSION_V214;
    external_submission_contract_version: typeof EXTERNAL_RELAY_SUBMISSION_VERSION_V214;
    projection_contract_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V214;
    readiness_contract_version: typeof FORMATION_READINESS_VERSION_V214;
    case_id: string;
    workflow_state: WorkflowStateV214;
    envelope_version: number;
    envelope_hash: string;
    disclosure_state: 'embargoed' | 'disclosed';
    party_views: Record<PartyIdV214, PartyViewCursorV214>;
  };
  parties: Record<PartyIdV214, PartyBindingV214>;
  source_turns: Record<string, SourceTurnV214>;
  positions: Record<string, CanonicalSemanticPositionV214>;
  requirements: Record<string, FormationRequirementV214>;
  clarifications: Record<string, FormationClarificationV214>;
  evidence: Record<string, EvidenceReferenceV214>;
  challenges: Record<string, FormationChallengeV214>;
  formation: {
    confirmations: Record<PartyIdV214, PartyConfirmationReceiptV214[]>;
    reopen_events: FormationReopenEventV214[];
    disclosure_review_acknowledgments: Record<PartyIdV214, DisclosureReviewAcknowledgmentV214[]>;
    explanatory: FormationExplanatoryStateV214;
  };
}

export const PARTY_IDS_V214: readonly PartyIdV214[] = Object.freeze(['party_a', 'party_b']);
export const ID_PATTERN_V214 = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;
export const HASH_PATTERN_V214 = /^[a-f0-9]{64}$/u;

export function otherPartyV214(partyId: PartyIdV214): PartyIdV214 {
  return partyId === 'party_a' ? 'party_b' : 'party_a';
}

export function isPartyScopedIdV214(
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
  partyId: PartyIdV214,
  identifier: string,
): boolean {
  return identifier.startsWith(`${kind}_${partyId}_`) && ID_PATTERN_V214.test(identifier);
}

export function hashAdoptionStatementV214(statement: string): string {
  return sha256(statement);
}

function envelopeHashProjectionV214(envelope: CaseEnvelopeV214): JsonValue {
  const projection = cloneCanonical(envelope) as unknown as Record<string, JsonValue>;
  const control = projection.control as Record<string, JsonValue>;
  delete control.envelope_hash;
  return projection;
}

export function hashCaseEnvelopeV214(envelope: CaseEnvelopeV214): string {
  return sha256(canonicalSerialize(envelopeHashProjectionV214(envelope)));
}

export function partyAuthorityV214(
  envelope: CaseEnvelopeV214,
  partyId: PartyIdV214,
  interactionAuthority: PartyInteractionAuthorityV214,
): AuthenticatedPartyAuthorityV214 {
  const party = envelope.parties[partyId];
  if (party.identity_assurance !== 'authenticated' || !party.authenticated_subject_id) {
    throw new TypeError(`${partyId} has no authenticated subject binding.`);
  }
  return Object.freeze({
    actor_type: 'party',
    party_id: partyId,
    authenticated_subject_id: party.authenticated_subject_id,
    interaction_authority: interactionAuthority,
    [PARTY_AUTHORITY_BRAND_V214]: true as const,
  });
}

export function isAuthenticatedPartyAuthorityV214(
  authority: unknown,
): authority is AuthenticatedPartyAuthorityV214 {
  return (
    typeof authority === 'object' &&
    authority !== null &&
    PARTY_AUTHORITY_BRAND_V214 in authority &&
    (authority as AuthenticatedPartyAuthorityV214)[PARTY_AUTHORITY_BRAND_V214] === true
  );
}

export function cloneCaseEnvelopeV214(envelope: CaseEnvelopeV214): CaseEnvelopeV214 {
  return cloneCanonical(envelope);
}

export function hashDisclosureReviewAcknowledgmentStatementV214(statement: string): string {
  return sha256(statement);
}
export type { ContractIssue };
