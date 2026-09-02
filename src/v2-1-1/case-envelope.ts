import {
  canonicalSerialize,
  cloneCanonical,
  sha256,
  type ContractIssue,
  type JsonValue,
} from '../v2/case-envelope.js';
import type { AmbiguityReason } from '../webmcp/core/compiler-contract.js';
import type { EpistemicStrength, PropositionType, SourceChannel } from '../webmcp/core/types.js';
import type { SourceTurnPayload } from '../webmcp/core/turns.js';

export const CASE_ENVELOPE_SCHEMA_VERSION_V211 = 'juryai-case-envelope-v2.1.1';
export const FORMATION_PROTOCOL_VERSION_V211 = 'juryai-formation-protocol-v2.1.1';
export const ENVELOPE_COMMAND_VERSION_V211 = 'juryai-envelope-command-v2.1.1';
export const EXTERNAL_RELAY_SUBMISSION_VERSION_V211 = 'juryai-external-relay-submission-v2.1.1';
export const EXTERNAL_RELAY_SUBMISSION_INTENT_VERSION_V211 =
  'juryai-external-relay-submission-intent-v2.1.1';
export const PARTY_FORMATION_PROJECTION_VERSION_V211 = 'juryai-party-formation-projection-v2.1.1';
export const PARTY_FORMATION_READBACK_VERSION_V211 = 'juryai-party-formation-readback-v2.1.1';
export const FORMATION_READINESS_VERSION_V211 = 'juryai-formation-readiness-v2.1.1';
export const PARTY_CONFIRMATION_VERSION_V211 = 'juryai-party-confirmation-v2.1.1';
export const BILATERAL_LOCK_RECEIPT_VERSION_V211 = 'juryai-bilateral-lock-receipt-v2.1.1';

export type PartyIdV211 = 'party_a' | 'party_b';
export type WorkflowStateV211 =
  'independent_formation' | 'challenge_response' | 'final_confirmation' | 'ready_for_lock';
export type PartyInteractionAuthorityV211 = 'external_relay' | 'first_party_human';

const PARTY_AUTHORITY_BRAND_V211: unique symbol = Symbol('juryai-party-authority-v2.1.1');

export interface AuthenticatedPartyAuthorityV211 {
  readonly actor_type: 'party';
  readonly party_id: PartyIdV211;
  readonly authenticated_subject_id: string;
  readonly interaction_authority: PartyInteractionAuthorityV211;
  readonly [PARTY_AUTHORITY_BRAND_V211]: true;
}

const SYSTEM_AUTHORITY_BRAND_V211: unique symbol = Symbol('juryai-system-authority-v2.1.1');

export interface TrustedSystemAuthorityV211 {
  readonly actor_type: 'system';
  readonly authority_kind: 'trusted_domain_system_v2_1_1';
  readonly [SYSTEM_AUTHORITY_BRAND_V211]: true;
}

export const TRUSTED_SYSTEM_AUTHORITY_V211: TrustedSystemAuthorityV211 = Object.freeze({
  actor_type: 'system',
  authority_kind: 'trusted_domain_system_v2_1_1',
  [SYSTEM_AUTHORITY_BRAND_V211]: true as const,
});

export type ExecutionAuthorityV211 = AuthenticatedPartyAuthorityV211 | TrustedSystemAuthorityV211;

export function isTrustedSystemAuthorityV211(
  authority: unknown,
): authority is TrustedSystemAuthorityV211 {
  return authority === TRUSTED_SYSTEM_AUTHORITY_V211;
}

export interface PartyBindingV211 {
  party_id: PartyIdV211;
  role: PartyIdV211;
  authenticated_subject_id: string | null;
  identity_assurance: 'unbound' | 'authenticated';
  binding_event_id: string | null;
  edit_state: 'open' | 'confirmed' | 'reopened';
  formation_epoch: number;
}

export interface SourceTurnPayloadLayoutV211 {
  context_utf16_lengths: number[];
  answer_utf16_length: number;
}

export interface SourceTurnV211 {
  turn_id: string;
  dispute_id: string;
  attributed_party_id: PartyIdV211;
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
  payload_layout: SourceTurnPayloadLayoutV211;
  payload_commitment_salt: string;
  payload_commitment: string;
  compile_run_id: string;
  redacted_at: string | null;
  redacted_at_envelope_version: number | null;
}

export interface SourceSpanCommitmentV211 {
  turn_id: string;
  region: 'answer' | 'context';
  message_index: number | null;
  encoding: 'utf16';
  start: number;
  end: number;
  quote_hash: string;
}

export interface CanonicalSemanticPositionV211 {
  position_id: string;
  attributed_party_id: PartyIdV211;
  requirement_id: string;
  proposition_type: PropositionType;
  epistemic_strength: EpistemicStrength;
  statement: string;
  resolution_status: 'disputed' | 'unresolved' | 'procedurally_resolved';
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitmentV211[];
  supersedes: string | null;
  superseded_by: string | null;
  superseded_at_envelope_version: number | null;
  introduced_envelope_version: number;
  last_material_envelope_version: number;
  compile_run_id: string;
  compiler_version_id: string;
  evidence_ref_id: string | null;
}

export interface FormationRequirementV211 {
  requirement_id: string;
  party_id: PartyIdV211;
  label: string;
  prompt: string;
  required: boolean;
  satisfying_types: PropositionType[];
  min_propositions: number;
  max_propositions: number | null;
  adverse_fact_probe: boolean;
  reopened_from: string | null;
}

export interface FormationClarificationV211 {
  clarification_id: string;
  party_id: PartyIdV211;
  requirement_id: string;
  reason: AmbiguityReason;
  prompt: string;
  opened_at_envelope_version: number;
  resolved_at_envelope_version: number | null;
  reopened_as: string | null;
}

export interface EvidenceReferenceV211 {
  evidence_id: string;
  attributed_party_id: PartyIdV211;
  description: string;
  required_for_readiness: boolean;
  eligibility: 'pending' | 'eligible' | 'ineligible' | 'not_required';
}

export interface FormationChallengeResponseV211 {
  response_id: string;
  responding_party_id: PartyIdV211;
  statement: string;
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitmentV211[];
  compile_run_id: string;
  compiler_version_id: string;
  semantic_position_id: string | null;
  introduced_envelope_version: number;
}

export interface FormationChallengeV211 {
  challenge_id: string;
  challenging_party_id: PartyIdV211;
  target_party_id: PartyIdV211;
  target_position_id: string;
  statement: string;
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitmentV211[];
  compile_run_id: string;
  compiler_version_id: string;
  introduced_envelope_version: number;
  status: 'open' | 'resolved' | 'withdrawn';
  response: FormationChallengeResponseV211 | null;
}

export interface PartyConfirmationReceiptV211 {
  confirmation_version: typeof PARTY_CONFIRMATION_VERSION_V211;
  confirmation_id: string;
  party_id: PartyIdV211;
  authenticated_subject_id: string;
  party_projection_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V211;
  party_projection_hash: string;
  party_visible_version: number;
  party_readback_version: typeof PARTY_FORMATION_READBACK_VERSION_V211;
  party_readback_hash: string;
  adoption_statement_hash: string;
  formation_epoch: number;
  shared_envelope_version: number;
  shared_envelope_hash: string;
  confirmed_at: string;
  event_id: string;
}

export interface FormationReopenEventV211 {
  event_id: string;
  party_id: PartyIdV211;
  authenticated_subject_id: string;
  prior_formation_epoch: number;
  resulting_formation_epoch: number;
  reason: string;
  occurred_at: string;
}

export interface BilateralLockReceiptV211 {
  lock_receipt_version: typeof BILATERAL_LOCK_RECEIPT_VERSION_V211;
  shared_envelope_version: number;
  shared_envelope_hash: string;
  party_projection_hashes: Record<PartyIdV211, string>;
  confirmation_ids: Record<PartyIdV211, string>;
  created_at: string;
}

export interface PartyViewCursorV211 {
  party_visible_version: number;
  party_projection_hash: string;
}

export interface FormationExplanatoryStateV211 {
  open_required_fields: string[];
  lock_prerequisites: string[];
  lock_blockers: string[];
}

export interface CaseEnvelopeV211 {
  control: {
    schema_version: typeof CASE_ENVELOPE_SCHEMA_VERSION_V211;
    protocol_version: typeof FORMATION_PROTOCOL_VERSION_V211;
    command_contract_version: typeof ENVELOPE_COMMAND_VERSION_V211;
    external_submission_contract_version: typeof EXTERNAL_RELAY_SUBMISSION_VERSION_V211;
    projection_contract_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V211;
    readiness_contract_version: typeof FORMATION_READINESS_VERSION_V211;
    case_id: string;
    workflow_state: WorkflowStateV211;
    envelope_version: number;
    envelope_hash: string;
    disclosure_state: 'embargoed' | 'disclosed';
    party_views: Record<PartyIdV211, PartyViewCursorV211>;
  };
  parties: Record<PartyIdV211, PartyBindingV211>;
  source_turns: Record<string, SourceTurnV211>;
  positions: Record<string, CanonicalSemanticPositionV211>;
  requirements: Record<string, FormationRequirementV211>;
  clarifications: Record<string, FormationClarificationV211>;
  evidence: Record<string, EvidenceReferenceV211>;
  challenges: Record<string, FormationChallengeV211>;
  formation: {
    confirmations: Record<PartyIdV211, PartyConfirmationReceiptV211[]>;
    reopen_events: FormationReopenEventV211[];
    explanatory: FormationExplanatoryStateV211;
  };
}

export const PARTY_IDS_V211: readonly PartyIdV211[] = Object.freeze(['party_a', 'party_b']);
export const ID_PATTERN_V211 = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;
export const HASH_PATTERN_V211 = /^[a-f0-9]{64}$/u;

export function otherPartyV211(partyId: PartyIdV211): PartyIdV211 {
  return partyId === 'party_a' ? 'party_b' : 'party_a';
}

export function isPartyScopedIdV211(
  kind:
    | 'binding'
    | 'position'
    | 'turn'
    | 'clarification'
    | 'challenge'
    | 'challenge_response'
    | 'confirmation'
    | 'confirmation_event'
    | 'reopen_event',
  partyId: PartyIdV211,
  identifier: string,
): boolean {
  return identifier.startsWith(`${kind}_${partyId}_`) && ID_PATTERN_V211.test(identifier);
}

export function hashAdoptionStatementV211(statement: string): string {
  return sha256(statement);
}

function envelopeHashProjectionV211(envelope: CaseEnvelopeV211): JsonValue {
  const projection = cloneCanonical(envelope) as unknown as Record<string, JsonValue>;
  const control = projection.control as Record<string, JsonValue>;
  delete control.envelope_hash;
  return projection;
}

export function hashCaseEnvelopeV211(envelope: CaseEnvelopeV211): string {
  return sha256(canonicalSerialize(envelopeHashProjectionV211(envelope)));
}

export function partyAuthorityV211(
  envelope: CaseEnvelopeV211,
  partyId: PartyIdV211,
  interactionAuthority: PartyInteractionAuthorityV211,
): AuthenticatedPartyAuthorityV211 {
  const party = envelope.parties[partyId];
  if (party.identity_assurance !== 'authenticated' || !party.authenticated_subject_id) {
    throw new TypeError(`${partyId} has no authenticated subject binding.`);
  }
  return Object.freeze({
    actor_type: 'party',
    party_id: partyId,
    authenticated_subject_id: party.authenticated_subject_id,
    interaction_authority: interactionAuthority,
    [PARTY_AUTHORITY_BRAND_V211]: true as const,
  });
}

export function isAuthenticatedPartyAuthorityV211(
  authority: unknown,
): authority is AuthenticatedPartyAuthorityV211 {
  return (
    typeof authority === 'object' &&
    authority !== null &&
    PARTY_AUTHORITY_BRAND_V211 in authority &&
    (authority as AuthenticatedPartyAuthorityV211)[PARTY_AUTHORITY_BRAND_V211] === true
  );
}

export function cloneCaseEnvelopeV211(envelope: CaseEnvelopeV211): CaseEnvelopeV211 {
  return cloneCanonical(envelope);
}

export type { ContractIssue };
