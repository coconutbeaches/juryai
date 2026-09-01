import {
  canonicalSerialize,
  cloneCanonical,
  sha256,
  type ContractIssue,
  type JsonValue,
} from '../v2/case-envelope.js';

export const CASE_ENVELOPE_SCHEMA_VERSION_V21 = 'juryai-case-envelope-v2.1.0';
export const FORMATION_PROTOCOL_VERSION_V21 = 'juryai-formation-protocol-v2.1.0';
export const ENVELOPE_COMMAND_VERSION_V21 = 'juryai-envelope-command-v2.1.0';
export const PARTY_MUTATION_INTENT_VERSION_V21 = 'juryai-party-mutation-intent-v2.1.0';
export const PARTY_FORMATION_PROJECTION_VERSION_V21 = 'juryai-party-formation-projection-v2.1.0';
export const PARTY_FORMATION_READBACK_VERSION_V21 = 'juryai-party-formation-readback-v2.1.0';
export const FORMATION_READINESS_VERSION_V21 = 'juryai-formation-readiness-v2.1.0';
export const PARTY_CONFIRMATION_VERSION_V21 = 'juryai-party-confirmation-v2.1.0';
export const BILATERAL_LOCK_RECEIPT_VERSION_V21 = 'juryai-bilateral-lock-receipt-v2.1.0';

export type PartyIdV21 = 'party_a' | 'party_b';
export type WorkflowStateV21 =
  'independent_formation' | 'challenge_response' | 'final_confirmation' | 'ready_for_lock';
export type PartyInteractionAuthorityV21 = 'external_relay' | 'first_party_human';

export interface AuthenticatedPartyAuthorityV21 {
  actor_type: 'party';
  party_id: PartyIdV21;
  authenticated_subject_id: string;
  interaction_authority: PartyInteractionAuthorityV21;
}

const SYSTEM_AUTHORITY_BRAND_V21: unique symbol = Symbol('juryai-system-authority-v2.1');

/**
 * This value is an internal domain capability, not a serializable caller role.
 * A request-decoded object cannot manufacture the symbol identity or compare
 * equal to the frozen singleton used by the command boundary.
 */
export interface TrustedSystemAuthorityV21 {
  readonly actor_type: 'system';
  readonly authority_kind: 'trusted_domain_system';
  readonly [SYSTEM_AUTHORITY_BRAND_V21]: true;
}

export const TRUSTED_SYSTEM_AUTHORITY_V21: TrustedSystemAuthorityV21 = Object.freeze({
  actor_type: 'system',
  authority_kind: 'trusted_domain_system',
  [SYSTEM_AUTHORITY_BRAND_V21]: true as const,
});

export type ExecutionAuthorityV21 = AuthenticatedPartyAuthorityV21 | TrustedSystemAuthorityV21;

export function isTrustedSystemAuthorityV21(
  authority: unknown,
): authority is TrustedSystemAuthorityV21 {
  return authority === TRUSTED_SYSTEM_AUTHORITY_V21;
}

export interface PartyBindingV21 {
  party_id: PartyIdV21;
  role: PartyIdV21;
  authenticated_subject_id: string | null;
  identity_assurance: 'unbound' | 'authenticated';
  binding_event_id: string | null;
  independent_formation_complete: boolean;
  edit_state: 'open' | 'confirmed' | 'reopened';
  formation_epoch: number;
}

export interface SourceTurnV21 {
  turn_id: string;
  attributed_party_id: PartyIdV21;
  content: string | null;
  content_hash: string;
  content_length: number;
  redacted_at: string | null;
}

export interface SourceSpanCommitmentV21 {
  start: number;
  end: number;
  quote_hash: string;
}

export interface CanonicalPositionV21 {
  position_id: string;
  attributed_party_id: PartyIdV21;
  position_kind: 'assertion' | 'admission' | 'denial' | 'uncertainty';
  statement: string;
  resolution_status: 'disputed' | 'unresolved' | 'procedurally_resolved';
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitmentV21[];
  introduced_envelope_version: number;
  last_material_envelope_version: number;
}

export interface FormationRequirementV21 {
  requirement_id: string;
  party_id: PartyIdV21;
  label: string;
  required: boolean;
  status: 'open' | 'resolved' | 'declined';
  response_summary: string | null;
}

export interface FormationClarificationV21 {
  clarification_id: string;
  party_id: PartyIdV21;
  question: string;
  answer: string;
  status: 'open' | 'resolved';
}

export interface EvidenceReferenceV21 {
  evidence_id: string;
  attributed_party_id: PartyIdV21;
  description: string;
  required_for_readiness: boolean;
  eligibility: 'pending' | 'eligible' | 'ineligible' | 'not_required';
}

export interface FormationChallengeV21 {
  challenge_id: string;
  challenging_party_id: PartyIdV21;
  target_party_id: PartyIdV21;
  target_position_id: string;
  statement: string;
  status: 'open' | 'resolved' | 'withdrawn';
  response_statement: string | null;
  response_party_id: PartyIdV21 | null;
}

export interface PartyConfirmationReceiptV21 {
  confirmation_version: typeof PARTY_CONFIRMATION_VERSION_V21;
  confirmation_id: string;
  party_id: PartyIdV21;
  authenticated_subject_id: string;
  party_projection_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V21;
  party_projection_hash: string;
  party_visible_version: number;
  party_readback_version: typeof PARTY_FORMATION_READBACK_VERSION_V21;
  party_readback_hash: string;
  adoption_statement_hash: string;
  formation_epoch: number;
  shared_envelope_version: number;
  shared_envelope_hash: string;
  confirmed_at: string;
  event_id: string;
}

export interface FormationReopenEventV21 {
  event_id: string;
  party_id: PartyIdV21;
  authenticated_subject_id: string;
  prior_formation_epoch: number;
  resulting_formation_epoch: number;
  reason: string;
  occurred_at: string;
}

/** Future lock seam only. PR 1 deliberately defines no lock operation. */
export interface BilateralLockReceiptV21 {
  lock_receipt_version: typeof BILATERAL_LOCK_RECEIPT_VERSION_V21;
  shared_envelope_version: number;
  shared_envelope_hash: string;
  party_projection_hashes: Record<PartyIdV21, string>;
  confirmation_ids: Record<PartyIdV21, string>;
  created_at: string;
}

export interface PartyViewCursorV21 {
  party_visible_version: number;
  party_projection_hash: string;
}

export interface FormationExplanatoryStateV21 {
  open_required_fields: string[];
  lock_prerequisites: string[];
  lock_blockers: string[];
}

export interface CaseEnvelopeV21 {
  control: {
    schema_version: typeof CASE_ENVELOPE_SCHEMA_VERSION_V21;
    protocol_version: typeof FORMATION_PROTOCOL_VERSION_V21;
    command_contract_version: typeof ENVELOPE_COMMAND_VERSION_V21;
    projection_contract_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V21;
    readiness_contract_version: typeof FORMATION_READINESS_VERSION_V21;
    case_id: string;
    workflow_state: WorkflowStateV21;
    envelope_version: number;
    envelope_hash: string;
    disclosure_state: 'embargoed' | 'disclosed';
    party_views: Record<PartyIdV21, PartyViewCursorV21>;
  };
  parties: Record<PartyIdV21, PartyBindingV21>;
  source_turns: Record<string, SourceTurnV21>;
  positions: Record<string, CanonicalPositionV21>;
  requirements: Record<string, FormationRequirementV21>;
  clarifications: Record<string, FormationClarificationV21>;
  evidence: Record<string, EvidenceReferenceV21>;
  challenges: Record<string, FormationChallengeV21>;
  formation: {
    confirmations: Record<PartyIdV21, PartyConfirmationReceiptV21[]>;
    reopen_events: FormationReopenEventV21[];
    explanatory: FormationExplanatoryStateV21;
  };
}

export const PARTY_IDS_V21: readonly PartyIdV21[] = Object.freeze(['party_a', 'party_b']);

export const ID_PATTERN_V21 = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;
export const HASH_PATTERN_V21 = /^[a-f0-9]{64}$/u;

export function otherPartyV21(partyId: PartyIdV21): PartyIdV21 {
  return partyId === 'party_a' ? 'party_b' : 'party_a';
}

export function isPartyScopedIdV21(
  kind: 'position' | 'turn' | 'clarification' | 'evidence' | 'confirmation' | 'confirmation_event',
  partyId: PartyIdV21,
  identifier: string,
): boolean {
  return identifier.startsWith(`${kind}_${partyId}_`) && ID_PATTERN_V21.test(identifier);
}

export function hashSourceTurnContentV21(content: string): string {
  return sha256(content);
}

export function hashAdoptionStatementV21(statement: string): string {
  return sha256(statement);
}

function envelopeHashProjectionV21(envelope: CaseEnvelopeV21): JsonValue {
  const projection = cloneCanonical(envelope) as unknown as Record<string, JsonValue>;
  const control = projection.control as Record<string, JsonValue>;
  delete control.envelope_hash;
  return projection;
}

export function hashCaseEnvelopeV21(envelope: CaseEnvelopeV21): string {
  return sha256(canonicalSerialize(envelopeHashProjectionV21(envelope)));
}

export function partyAuthorityV21(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
  interactionAuthority: PartyInteractionAuthorityV21,
): AuthenticatedPartyAuthorityV21 {
  const party = envelope.parties[partyId];
  if (party.identity_assurance !== 'authenticated' || !party.authenticated_subject_id) {
    throw new TypeError(`${partyId} has no authenticated subject binding.`);
  }
  return {
    actor_type: 'party',
    party_id: partyId,
    authenticated_subject_id: party.authenticated_subject_id,
    interaction_authority: interactionAuthority,
  };
}

export function cloneCaseEnvelopeV21(envelope: CaseEnvelopeV21): CaseEnvelopeV21 {
  return cloneCanonical(envelope);
}

export type { ContractIssue };
