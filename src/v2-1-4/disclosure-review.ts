import { cloneCanonical } from '../v2/case-envelope.js';
import {
  DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V214,
  HASH_PATTERN_V214,
  PARTY_FORMATION_PROJECTION_VERSION_V214,
  PARTY_FORMATION_READBACK_VERSION_V214,
  hashDisclosureReviewAcknowledgmentStatementV214,
  type CaseEnvelopeV214,
  type DisclosureReviewAcknowledgmentV214,
  type PartyIdV214,
} from './case-envelope.js';
import {
  hashPartyFormationProjectionV214,
  renderPartyFormationReadbackV214,
} from './party-projection.js';

export function currentDisclosureReviewAcknowledgmentV214(
  envelope: CaseEnvelopeV214,
  partyId: PartyIdV214,
): DisclosureReviewAcknowledgmentV214 | null {
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
  const projectionHash = hashPartyFormationProjectionV214(envelope, partyId);
  const readback = renderPartyFormationReadbackV214(envelope, partyId);
  const statementHash = hashDisclosureReviewAcknowledgmentStatementV214(
    DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V214,
  );
  const acknowledgment = [...envelope.formation.disclosure_review_acknowledgments[partyId]]
    .reverse()
    .find(
      (candidate) =>
        candidate.dispute_id === envelope.control.case_id &&
        candidate.party_id === partyId &&
        candidate.authenticated_subject_id === party.authenticated_subject_id &&
        candidate.formation_epoch === party.formation_epoch &&
        candidate.party_projection_version === PARTY_FORMATION_PROJECTION_VERSION_V214 &&
        candidate.party_projection_hash === projectionHash &&
        candidate.party_projection_hash === cursor.party_projection_hash &&
        candidate.party_visible_version === cursor.party_visible_version &&
        candidate.party_readback_version === PARTY_FORMATION_READBACK_VERSION_V214 &&
        candidate.party_readback_hash === readback.document_hash &&
        candidate.acknowledgment_statement_hash === statementHash &&
        HASH_PATTERN_V214.test(candidate.acknowledgment_statement_hash),
    );

  return acknowledgment ? cloneCanonical(acknowledgment) : null;
}

export function disclosureReviewClosureCurrentV214(envelope: CaseEnvelopeV214): boolean {
  return (
    currentDisclosureReviewAcknowledgmentV214(envelope, 'party_a') !== null &&
    currentDisclosureReviewAcknowledgmentV214(envelope, 'party_b') !== null
  );
}
