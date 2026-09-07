export {
  type PartyId as PartyIdV215,
  type WorkflowState as WorkflowStateV215,
  type PartyInteractionAuthority as PartyInteractionAuthorityV215,
  type AuthenticatedPartyAuthority as AuthenticatedPartyAuthorityV215,
  type TrustedSystemAuthority as TrustedSystemAuthorityV215,
  type ExecutionAuthority as ExecutionAuthorityV215,
  type PartyBinding as PartyBindingV215,
  type SourceTurnPayloadLayout as SourceTurnPayloadLayoutV215,
  type SourceTurn as SourceTurnV215,
  type SourceSpanCommitment as SourceSpanCommitmentV215,
  type CanonicalSemanticPosition as CanonicalSemanticPositionV215,
  type FormationRequirement as FormationRequirementV215,
  type FormationClarification as FormationClarificationV215,
  type EvidenceReference as EvidenceReferenceV215,
  type FormationChallengeResponse as FormationChallengeResponseV215,
  type FormationChallenge as FormationChallengeV215,
  type PartyConfirmationReceipt as PartyConfirmationReceiptV215,
  type FormationReopenEvent as FormationReopenEventV215,
  type PartyViewCursor as PartyViewCursorV215,
  type FormationExplanatoryState as FormationExplanatoryStateV215,
  type DisclosureReviewAcknowledgment as DisclosureReviewAcknowledgmentV215,
  type CaseEnvelope as CaseEnvelopeV215,
  PARTY_IDS as PARTY_IDS_V215,
  ID_PATTERN as ID_PATTERN_V215,
  HASH_PATTERN as HASH_PATTERN_V215,
  type PartyScopedIdKind as PartyScopedIdKindV215,
  otherParty as otherPartyV215,
  isPartyScopedId as isPartyScopedIdV215,
  hashAdoptionStatement as hashAdoptionStatementV215,
  hashDisclosureReviewAcknowledgmentStatement as hashDisclosureReviewAcknowledgmentStatementV215,
  hashCaseEnvelope as hashCaseEnvelopeV215,
  cloneCaseEnvelope as cloneCaseEnvelopeV215,
  isTrustedSystemAuthority as isTrustedSystemAuthorityV215,
  partyAuthority as partyAuthorityV215,
  isAuthenticatedPartyAuthority as isAuthenticatedPartyAuthorityV215,
} from '../formation/envelope.js';
import { trustedSystemAuthority } from '../formation/envelope.js';
import { V215_SPEC } from './generation-spec.js';
export const TRUSTED_SYSTEM_AUTHORITY_V215 = trustedSystemAuthority(V215_SPEC);
export const CASE_ENVELOPE_SCHEMA_VERSION_V215 = V215_SPEC.identity.envelope_schema_version;
export const FORMATION_PROTOCOL_VERSION_V215 = V215_SPEC.identity.formation_protocol_version;
export const ENVELOPE_COMMAND_VERSION_V215 = V215_SPEC.contracts.command_version;
export const EXTERNAL_RELAY_SUBMISSION_VERSION_V215 =
  V215_SPEC.contracts.external_relay_submission_version;
export const EXTERNAL_RELAY_SUBMISSION_INTENT_VERSION_V215 =
  V215_SPEC.contracts.external_relay_submission_intent_version;
export const PARTY_FORMATION_PROJECTION_VERSION_V215 = V215_SPEC.contracts.projection_version;
export const PARTY_FORMATION_READBACK_VERSION_V215 = V215_SPEC.contracts.readback_version;
export const FORMATION_READINESS_VERSION_V215 = V215_SPEC.contracts.readiness_version;
export const PARTY_CONFIRMATION_VERSION_V215 = V215_SPEC.contracts.confirmation_version;
export const DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V215 =
  V215_SPEC.contracts.disclosure_acknowledgment_version;
export const DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V215 =
  V215_SPEC.contracts.disclosure_acknowledgment_statement;
