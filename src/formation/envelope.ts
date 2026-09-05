/**
 * Generation-neutral case-envelope types and pure helpers.
 *
 * Extracted from the frozen V2.1.4 implementation, which remains the
 * behavioural reference. The only structural difference is that fields the
 * frozen code types as `typeof SOME_V214_CONSTANT` are typed here as `string`
 * and supplied by a GenerationSpec. At runtime the serialized envelope is
 * identical, which is what the parity harness asserts byte-for-byte.
 *
 * Nothing in this module is generation-specific, so nothing here needs a spec.
 */

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

export type PartyId = 'party_a' | 'party_b';
export type WorkflowState =
  'independent_formation' | 'challenge_response' | 'final_confirmation' | 'ready_for_lock';
export type PartyInteractionAuthority = 'external_relay' | 'first_party_human';

const PARTY_AUTHORITY_BRAND: unique symbol = Symbol('juryai-formation-party-authority');
const SYSTEM_AUTHORITY_BRAND: unique symbol = Symbol('juryai-formation-system-authority');

export interface AuthenticatedPartyAuthority {
  readonly actor_type: 'party';
  readonly party_id: PartyId;
  readonly authenticated_subject_id: string;
  readonly interaction_authority: PartyInteractionAuthority;
  readonly [PARTY_AUTHORITY_BRAND]: true;
}

export interface TrustedSystemAuthority {
  readonly actor_type: 'system';
  /** Value supplied by the generation, e.g. `trusted_domain_system_v2_1_4`. */
  readonly authority_kind: string;
  readonly [SYSTEM_AUTHORITY_BRAND]: true;
}

export type ExecutionAuthority = AuthenticatedPartyAuthority | TrustedSystemAuthority;

export interface PartyBinding {
  party_id: PartyId;
  role: PartyId;
  authenticated_subject_id: string | null;
  identity_assurance: 'unbound' | 'authenticated';
  binding_event_id: string | null;
  edit_state: 'open' | 'confirmed' | 'reopened';
  formation_epoch: number;
}

export interface SourceTurnPayloadLayout {
  context_utf16_lengths: number[];
  answer_utf16_length: number;
}

export interface SourceTurn {
  turn_id: string;
  dispute_id: string;
  attributed_party_id: PartyId;
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
  payload_layout: SourceTurnPayloadLayout;
  payload_commitment_salt: string;
  payload_commitment: string;
  compile_run_id: string;
  redacted_at: string | null;
  redacted_at_envelope_version: number | null;
}

export interface SourceSpanCommitment {
  turn_id: string;
  region: 'answer' | 'context';
  message_index: number | null;
  encoding: 'utf16';
  start: number;
  end: number;
  quote_hash: string;
}

export interface CanonicalSemanticPosition {
  position_id: string;
  attributed_party_id: PartyId;
  requirement_id: string;
  proposition_type: PropositionType;
  epistemic_strength: EpistemicStrength;
  statement: string;
  resolution_status: 'disputed' | 'unresolved' | 'procedurally_resolved';
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitment[];
  supersedes: string | null;
  superseded_by: string | null;
  superseded_at_envelope_version: number | null;
  introduced_envelope_version: number;
  last_material_envelope_version: number;
  compile_run_id: string;
  compiler_version_id: string;
  evidence_ref_id: string | null;
}

export interface FormationRequirement {
  requirement_id: string;
  party_id: PartyId;
  label: string;
  prompt: string;
  required: boolean;
  satisfying_types: PropositionType[];
  min_propositions: number;
  max_propositions: number | null;
  adverse_fact_probe: boolean;
  reopened_from: string | null;
}

export interface FormationClarification {
  clarification_id: string;
  party_id: PartyId;
  requirement_id: string;
  reason: AmbiguityReason;
  prompt: string;
  opened_at_envelope_version: number;
  resolved_at_envelope_version: number | null;
  reopened_as: string | null;
}

export interface EvidenceReference {
  evidence_id: string;
  attributed_party_id: PartyId;
  description: string;
  required_for_readiness: boolean;
  eligibility: 'pending' | 'eligible' | 'ineligible' | 'not_required';
}

export interface FormationChallengeResponse {
  response_id: string;
  responding_party_id: PartyId;
  statement: string;
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitment[];
  compile_run_id: string;
  compiler_version_id: string;
  semantic_position_id: string | null;
  introduced_envelope_version: number;
}

export interface FormationChallenge {
  challenge_id: string;
  challenging_party_id: PartyId;
  target_party_id: PartyId;
  target_position_id: string;
  statement: string;
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitment[];
  compile_run_id: string;
  compiler_version_id: string;
  introduced_envelope_version: number;
  status: 'open' | 'resolved' | 'withdrawn';
  response: FormationChallengeResponse | null;
}

export interface PartyConfirmationReceipt {
  confirmation_version: string;
  confirmation_id: string;
  party_id: PartyId;
  authenticated_subject_id: string;
  party_projection_version: string;
  party_projection_hash: string;
  party_visible_version: number;
  party_readback_version: string;
  party_readback_hash: string;
  adoption_statement_hash: string;
  formation_epoch: number;
  shared_envelope_version: number;
  shared_envelope_hash: string;
  confirmed_at: string;
  event_id: string;
}

export interface FormationReopenEvent {
  event_id: string;
  party_id: PartyId;
  authenticated_subject_id: string;
  prior_formation_epoch: number;
  resulting_formation_epoch: number;
  reason: string;
  occurred_at: string;
}

export interface PartyViewCursor {
  party_visible_version: number;
  party_projection_hash: string;
}

export interface FormationExplanatoryState {
  open_required_fields: string[];
  lock_prerequisites: string[];
  lock_blockers: string[];
}

export interface DisclosureReviewAcknowledgment {
  acknowledgment_version: string;
  acknowledgment_id: string;
  event_id: string;
  dispute_id: string;
  party_id: PartyId;
  authenticated_subject_id: string;
  formation_epoch: number;
  party_projection_version: string;
  party_projection_hash: string;
  party_visible_version: number;
  party_readback_version: string;
  party_readback_hash: string;
  acknowledgment_statement_hash: string;
  acknowledged_at: string;
  acknowledged_at_envelope_version: number;
}

export interface CaseEnvelope {
  control: {
    schema_version: string;
    protocol_version: string;
    command_contract_version: string;
    external_submission_contract_version: string;
    projection_contract_version: string;
    readiness_contract_version: string;
    case_id: string;
    workflow_state: WorkflowState;
    envelope_version: number;
    envelope_hash: string;
    disclosure_state: 'embargoed' | 'disclosed';
    party_views: Record<PartyId, PartyViewCursor>;
  };
  parties: Record<PartyId, PartyBinding>;
  source_turns: Record<string, SourceTurn>;
  positions: Record<string, CanonicalSemanticPosition>;
  requirements: Record<string, FormationRequirement>;
  clarifications: Record<string, FormationClarification>;
  evidence: Record<string, EvidenceReference>;
  challenges: Record<string, FormationChallenge>;
  formation: {
    confirmations: Record<PartyId, PartyConfirmationReceipt[]>;
    reopen_events: FormationReopenEvent[];
    disclosure_review_acknowledgments: Record<PartyId, DisclosureReviewAcknowledgment[]>;
    explanatory: FormationExplanatoryState;
  };
}

export const PARTY_IDS: readonly PartyId[] = Object.freeze(['party_a', 'party_b']);
export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;
export const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export type PartyScopedIdKind =
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
  | 'disclosure_ack_event';

export function otherParty(partyId: PartyId): PartyId {
  return partyId === 'party_a' ? 'party_b' : 'party_a';
}

export function isPartyScopedId(
  kind: PartyScopedIdKind,
  partyId: PartyId,
  identifier: string,
): boolean {
  return identifier.startsWith(`${kind}_${partyId}_`) && ID_PATTERN.test(identifier);
}

export function hashAdoptionStatement(statement: string): string {
  return sha256(statement);
}

export function hashDisclosureReviewAcknowledgmentStatement(statement: string): string {
  return sha256(statement);
}

function envelopeHashProjection(envelope: CaseEnvelope): JsonValue {
  const projection = cloneCanonical(envelope) as unknown as Record<string, JsonValue>;
  const control = projection.control as Record<string, JsonValue>;
  delete control.envelope_hash;
  return projection;
}

export function hashCaseEnvelope(envelope: CaseEnvelope): string {
  return sha256(canonicalSerialize(envelopeHashProjection(envelope)));
}

export function cloneCaseEnvelope(envelope: CaseEnvelope): CaseEnvelope {
  return cloneCanonical(envelope);
}

/** The generation supplies `authority_kind`; the brand keeps it unforgeable. */
export function trustedSystemAuthority(authorityKind: string): TrustedSystemAuthority {
  return Object.freeze({
    actor_type: 'system',
    authority_kind: authorityKind,
    [SYSTEM_AUTHORITY_BRAND]: true as const,
  });
}

export function isTrustedSystemAuthority(authority: unknown): authority is TrustedSystemAuthority {
  return (
    typeof authority === 'object' &&
    authority !== null &&
    SYSTEM_AUTHORITY_BRAND in authority &&
    (authority as TrustedSystemAuthority)[SYSTEM_AUTHORITY_BRAND] === true
  );
}

export function partyAuthority(
  envelope: CaseEnvelope,
  partyId: PartyId,
  interactionAuthority: PartyInteractionAuthority,
): AuthenticatedPartyAuthority {
  const party = envelope.parties[partyId];
  if (party.identity_assurance !== 'authenticated' || !party.authenticated_subject_id) {
    throw new TypeError(`${partyId} has no authenticated subject binding.`);
  }
  return Object.freeze({
    actor_type: 'party',
    party_id: partyId,
    authenticated_subject_id: party.authenticated_subject_id,
    interaction_authority: interactionAuthority,
    [PARTY_AUTHORITY_BRAND]: true as const,
  });
}

export function isAuthenticatedPartyAuthority(
  authority: unknown,
): authority is AuthenticatedPartyAuthority {
  return (
    typeof authority === 'object' &&
    authority !== null &&
    PARTY_AUTHORITY_BRAND in authority &&
    (authority as AuthenticatedPartyAuthority)[PARTY_AUTHORITY_BRAND] === true
  );
}

export type { ContractIssue };
