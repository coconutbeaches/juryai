import { cloneCanonical } from '../v2/case-envelope.js';
import {
  DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V212,
  HASH_PATTERN_V212,
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  PARTY_FORMATION_READBACK_VERSION_V211,
  hashDisclosureReviewAcknowledgmentStatementV212,
  type CaseEnvelopeV212,
  type DisclosureReviewAcknowledgmentV212,
  type PartyIdV212,
} from './case-envelope.js';
import {
  hashPartyFormationProjectionV212,
  renderPartyFormationReadbackV212,
} from './party-projection.js';

export function currentDisclosureReviewAcknowledgmentV212(
  envelope: CaseEnvelopeV212,
  partyId: PartyIdV212,
): DisclosureReviewAcknowledgmentV212 | null {
  const party = envelope.parties[partyId];
  if (
    envelope.control.disclosure_state !== 'disclosed' ||
    envelope.control.workflow_state === 'independent_formation' ||
    Object.values(envelope.challenges).some((challenge) => challenge.status === 'open') ||
    party.identity_assurance !== 'authenticated' ||
    !party.authenticated_subject_id
  ) {
    return null;
  }

  const cursor = envelope.control.party_views[partyId];
  const projectionHash = hashPartyFormationProjectionV212(envelope, partyId);
  const readback = renderPartyFormationReadbackV212(envelope, partyId);
  const statementHash = hashDisclosureReviewAcknowledgmentStatementV212(
    DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V212,
  );
  const acknowledgment = [...envelope.formation.disclosure_review_acknowledgments[partyId]]
    .reverse()
    .find(
      (candidate) =>
        candidate.dispute_id === envelope.control.case_id &&
        candidate.party_id === partyId &&
        candidate.authenticated_subject_id === party.authenticated_subject_id &&
        candidate.formation_epoch === party.formation_epoch &&
        candidate.party_projection_version === PARTY_FORMATION_PROJECTION_VERSION_V211 &&
        candidate.party_projection_hash === projectionHash &&
        candidate.party_projection_hash === cursor.party_projection_hash &&
        candidate.party_visible_version === cursor.party_visible_version &&
        candidate.party_readback_version === PARTY_FORMATION_READBACK_VERSION_V211 &&
        candidate.party_readback_hash === readback.document_hash &&
        candidate.acknowledgment_statement_hash === statementHash &&
        HASH_PATTERN_V212.test(candidate.acknowledgment_statement_hash),
    );

  return acknowledgment ? cloneCanonical(acknowledgment) : null;
}

export function disclosureReviewClosureCurrentV212(envelope: CaseEnvelopeV212): boolean {
  return (
    currentDisclosureReviewAcknowledgmentV212(envelope, 'party_a') !== null &&
    currentDisclosureReviewAcknowledgmentV212(envelope, 'party_b') !== null
  );
}
