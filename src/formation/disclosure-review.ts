import { cloneCanonical } from '../v2/case-envelope.js';
import type { GenerationSpec } from './generation-spec.js';
import {
  HASH_PATTERN,
  hashDisclosureReviewAcknowledgmentStatement,
  type CaseEnvelope,
  type DisclosureReviewAcknowledgment,
  type PartyId,
} from './envelope.js';
import { hashPartyFormationProjection, renderPartyFormationReadback } from './projection.js';

export function currentDisclosureReviewAcknowledgment(
  spec: GenerationSpec,
  envelope: CaseEnvelope,
  partyId: PartyId,
): DisclosureReviewAcknowledgment | null {
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
  const projectionHash = hashPartyFormationProjection(spec, envelope, partyId);
  const readback = renderPartyFormationReadback(spec, envelope, partyId);
  const statementHash = hashDisclosureReviewAcknowledgmentStatement(
    spec.contracts.disclosure_acknowledgment_statement,
  );
  const acknowledgment = [...envelope.formation.disclosure_review_acknowledgments[partyId]]
    .reverse()
    .find(
      (candidate) =>
        candidate.dispute_id === envelope.control.case_id &&
        candidate.party_id === partyId &&
        candidate.authenticated_subject_id === party.authenticated_subject_id &&
        candidate.formation_epoch === party.formation_epoch &&
        candidate.party_projection_version === spec.contracts.projection_version &&
        candidate.party_projection_hash === projectionHash &&
        candidate.party_projection_hash === cursor.party_projection_hash &&
        candidate.party_visible_version === cursor.party_visible_version &&
        candidate.party_readback_version === spec.contracts.readback_version &&
        candidate.party_readback_hash === readback.document_hash &&
        candidate.acknowledgment_statement_hash === statementHash &&
        HASH_PATTERN.test(candidate.acknowledgment_statement_hash),
    );

  return acknowledgment ? cloneCanonical(acknowledgment) : null;
}

export function disclosureReviewClosureCurrent(
  spec: GenerationSpec,
  envelope: CaseEnvelope,
): boolean {
  return (
    currentDisclosureReviewAcknowledgment(spec, envelope, 'party_a') !== null &&
    currentDisclosureReviewAcknowledgment(spec, envelope, 'party_b') !== null
  );
}
