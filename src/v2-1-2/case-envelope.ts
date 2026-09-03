import {
  canonicalSerialize,
  cloneCanonical,
  sha256,
  type ContractIssue,
  type JsonValue,
} from '../v2/case-envelope.js';
import {
  EXTERNAL_RELAY_SUBMISSION_VERSION_V211,
  PARTY_CONFIRMATION_VERSION_V211,
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  PARTY_FORMATION_READBACK_VERSION_V211,
  type CanonicalSemanticPositionV211,
  type EvidenceReferenceV211,
  type FormationChallengeV211,
  type FormationClarificationV211,
  type FormationExplanatoryStateV211,
  type FormationRequirementV211,
  type FormationReopenEventV211,
  type PartyBindingV211,
  type PartyConfirmationReceiptV211,
  type PartyIdV211,
  type PartyViewCursorV211,
  type SourceTurnV211,
} from '../v2-1-1/case-envelope.js';

export const CASE_ENVELOPE_SCHEMA_VERSION_V212 = 'juryai-case-envelope-v2.1.2';
export const FORMATION_PROTOCOL_VERSION_V212 = 'juryai-formation-protocol-v2.1.2';
export const ENVELOPE_COMMAND_VERSION_V212 = 'juryai-envelope-command-v2.1.2';
export const DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V212 =
  'juryai-disclosure-review-acknowledgment-v2.1.2';
export const FORMATION_READINESS_VERSION_V212 = 'juryai-formation-readiness-v2.1.2';

export const DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V212 =
  'I have reviewed the currently disclosed case material and have no further challenges to raise at this time.';

export type PartyIdV212 = PartyIdV211;
export type WorkflowStateV212 =
  'independent_formation' | 'challenge_response' | 'final_confirmation' | 'ready_for_lock';
export type PartyInteractionAuthorityV212 = 'external_relay' | 'first_party_human';

const PARTY_AUTHORITY_BRAND_V212: unique symbol = Symbol('juryai-party-authority-v2.1.2');

export interface AuthenticatedPartyAuthorityV212 {
  readonly actor_type: 'party';
  readonly party_id: PartyIdV212;
  readonly authenticated_subject_id: string;
  readonly interaction_authority: PartyInteractionAuthorityV212;
  readonly [PARTY_AUTHORITY_BRAND_V212]: true;
}

const SYSTEM_AUTHORITY_BRAND_V212: unique symbol = Symbol('juryai-system-authority-v2.1.2');

export interface TrustedSystemAuthorityV212 {
  readonly actor_type: 'system';
  readonly authority_kind: 'trusted_domain_system_v2_1_2';
  readonly [SYSTEM_AUTHORITY_BRAND_V212]: true;
}

export const TRUSTED_SYSTEM_AUTHORITY_V212: TrustedSystemAuthorityV212 = Object.freeze({
  actor_type: 'system',
  authority_kind: 'trusted_domain_system_v2_1_2',
  [SYSTEM_AUTHORITY_BRAND_V212]: true as const,
});

export type ExecutionAuthorityV212 = AuthenticatedPartyAuthorityV212 | TrustedSystemAuthorityV212;

export interface DisclosureReviewAcknowledgmentV212 {
  acknowledgment_version: typeof DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V212;
  acknowledgment_id: string;
  event_id: string;
  dispute_id: string;
  party_id: PartyIdV212;
  authenticated_subject_id: string;
  formation_epoch: number;
  party_projection_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V211;
  party_projection_hash: string;
  party_visible_version: number;
  party_readback_version: typeof PARTY_FORMATION_READBACK_VERSION_V211;
  party_readback_hash: string;
  acknowledgment_statement_hash: string;
  acknowledged_at: string;
  acknowledged_at_envelope_version: number;
}

export interface CaseEnvelopeV212 {
  control: {
    schema_version: typeof CASE_ENVELOPE_SCHEMA_VERSION_V212;
    protocol_version: typeof FORMATION_PROTOCOL_VERSION_V212;
    command_contract_version: typeof ENVELOPE_COMMAND_VERSION_V212;
    external_submission_contract_version: typeof EXTERNAL_RELAY_SUBMISSION_VERSION_V211;
    projection_contract_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V211;
    readiness_contract_version: typeof FORMATION_READINESS_VERSION_V212;
    case_id: string;
    workflow_state: WorkflowStateV212;
    envelope_version: number;
    envelope_hash: string;
    disclosure_state: 'embargoed' | 'disclosed';
    party_views: Record<PartyIdV212, PartyViewCursorV211>;
  };
  parties: Record<PartyIdV212, PartyBindingV211>;
  source_turns: Record<string, SourceTurnV211>;
  positions: Record<string, CanonicalSemanticPositionV211>;
  requirements: Record<string, FormationRequirementV211>;
  clarifications: Record<string, FormationClarificationV211>;
  evidence: Record<string, EvidenceReferenceV211>;
  challenges: Record<string, FormationChallengeV211>;
  formation: {
    confirmations: Record<PartyIdV212, PartyConfirmationReceiptV211[]>;
    reopen_events: FormationReopenEventV211[];
    disclosure_review_acknowledgments: Record<PartyIdV212, DisclosureReviewAcknowledgmentV212[]>;
    explanatory: FormationExplanatoryStateV211;
  };
}

export type {
  CanonicalSemanticPositionV211 as CanonicalSemanticPositionV212,
  EvidenceReferenceV211 as EvidenceReferenceV212,
  FormationChallengeV211 as FormationChallengeV212,
  FormationClarificationV211 as FormationClarificationV212,
  FormationExplanatoryStateV211,
  FormationRequirementV211 as FormationRequirementV212,
  PartyConfirmationReceiptV211 as PartyConfirmationReceiptV212,
  SourceTurnV211 as SourceTurnV212,
};

export {
  EXTERNAL_RELAY_SUBMISSION_INTENT_VERSION_V211,
  EXTERNAL_RELAY_SUBMISSION_VERSION_V211,
  PARTY_CONFIRMATION_VERSION_V211,
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  PARTY_FORMATION_READBACK_VERSION_V211,
} from '../v2-1-1/case-envelope.js';

export const PARTY_IDS_V212: readonly PartyIdV212[] = Object.freeze(['party_a', 'party_b']);
export const ID_PATTERN_V212 = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;
export const HASH_PATTERN_V212 = /^[a-f0-9]{64}$/u;

export function otherPartyV212(partyId: PartyIdV212): PartyIdV212 {
  return partyId === 'party_a' ? 'party_b' : 'party_a';
}

export function isPartyScopedIdV212(
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
  partyId: PartyIdV212,
  identifier: string,
): boolean {
  return identifier.startsWith(`${kind}_${partyId}_`) && ID_PATTERN_V212.test(identifier);
}

export function isTrustedSystemAuthorityV212(
  authority: unknown,
): authority is TrustedSystemAuthorityV212 {
  return authority === TRUSTED_SYSTEM_AUTHORITY_V212;
}

export function partyAuthorityV212(
  envelope: CaseEnvelopeV212,
  partyId: PartyIdV212,
  interactionAuthority: PartyInteractionAuthorityV212,
): AuthenticatedPartyAuthorityV212 {
  const party = envelope.parties[partyId];
  if (party.identity_assurance !== 'authenticated' || !party.authenticated_subject_id) {
    throw new TypeError(`${partyId} has no authenticated subject binding.`);
  }
  return Object.freeze({
    actor_type: 'party',
    party_id: partyId,
    authenticated_subject_id: party.authenticated_subject_id,
    interaction_authority: interactionAuthority,
    [PARTY_AUTHORITY_BRAND_V212]: true as const,
  });
}

export function isAuthenticatedPartyAuthorityV212(
  authority: unknown,
): authority is AuthenticatedPartyAuthorityV212 {
  return (
    typeof authority === 'object' &&
    authority !== null &&
    PARTY_AUTHORITY_BRAND_V212 in authority &&
    (authority as AuthenticatedPartyAuthorityV212)[PARTY_AUTHORITY_BRAND_V212] === true
  );
}

export function hashDisclosureReviewAcknowledgmentStatementV212(statement: string): string {
  return sha256(statement);
}

function envelopeHashProjectionV212(envelope: CaseEnvelopeV212): JsonValue {
  const projection = cloneCanonical(envelope) as unknown as Record<string, JsonValue>;
  const control = projection.control as Record<string, JsonValue>;
  delete control.envelope_hash;
  return projection;
}

export function hashCaseEnvelopeV212(envelope: CaseEnvelopeV212): string {
  return sha256(canonicalSerialize(envelopeHashProjectionV212(envelope)));
}

export function cloneCaseEnvelopeV212(envelope: CaseEnvelopeV212): CaseEnvelopeV212 {
  return cloneCanonical(envelope);
}

export type { ContractIssue };

void PARTY_CONFIRMATION_VERSION_V211;
