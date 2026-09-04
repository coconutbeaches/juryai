import { cloneCanonical } from '../v2/case-envelope.js';
import {
  DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V213,
  HASH_PATTERN_V213,
  PARTY_FORMATION_PROJECTION_VERSION_V213,
  PARTY_FORMATION_READBACK_VERSION_V213,
  hashDisclosureReviewAcknowledgmentStatementV213,
  type CaseEnvelopeV213,
  type DisclosureReviewAcknowledgmentV213,
  type PartyIdV213,
} from './case-envelope.js';
import {
  hashPartyFormationProjectionV213,
  renderPartyFormationReadbackV213,
} from './party-projection.js';

export function currentDisclosureReviewAcknowledgmentV213(
  envelope: CaseEnvelopeV213,
  partyId: PartyIdV213,
): DisclosureReviewAcknowledgmentV213 | null {
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
  const projectionHash = hashPartyFormationProjectionV213(envelope, partyId);
  const readback = renderPartyFormationReadbackV213(envelope, partyId);
  const statementHash = hashDisclosureReviewAcknowledgmentStatementV213(
    DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V213,
  );
  const acknowledgment = [...envelope.formation.disclosure_review_acknowledgments[partyId]]
    .reverse()
    .find(
      (candidate) =>
        candidate.dispute_id === envelope.control.case_id &&
        candidate.party_id === partyId &&
        candidate.authenticated_subject_id === party.authenticated_subject_id &&
        candidate.formation_epoch === party.formation_epoch &&
        candidate.party_projection_version === PARTY_FORMATION_PROJECTION_VERSION_V213 &&
        candidate.party_projection_hash === projectionHash &&
        candidate.party_projection_hash === cursor.party_projection_hash &&
        candidate.party_visible_version === cursor.party_visible_version &&
        candidate.party_readback_version === PARTY_FORMATION_READBACK_VERSION_V213 &&
        candidate.party_readback_hash === readback.document_hash &&
        candidate.acknowledgment_statement_hash === statementHash &&
        HASH_PATTERN_V213.test(candidate.acknowledgment_statement_hash),
    );

  return acknowledgment ? cloneCanonical(acknowledgment) : null;
}

export function disclosureReviewClosureCurrentV213(envelope: CaseEnvelopeV213): boolean {
  return (
    currentDisclosureReviewAcknowledgmentV213(envelope, 'party_a') !== null &&
    currentDisclosureReviewAcknowledgmentV213(envelope, 'party_b') !== null
  );
}
