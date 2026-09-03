import { cloneCanonical } from '../v2/case-envelope.js';
import {
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  PARTY_FORMATION_READBACK_VERSION_V211,
  type CaseEnvelopeV212,
  type PartyIdV212,
} from './case-envelope.js';
import { deriveFormationReadinessV212 } from './formation-readiness.js';
import {
  currentPartyConfirmationV212,
  projectPartyFormationV212,
  renderPartyFormationReadbackV212,
} from './party-projection.js';
import {
  PARTY_REVIEW_STATE_VERSION_V1,
  hashPartyReviewStateV1,
  validatePartyReviewStateV1,
  type PartyConfirmationEligibilityV1,
  type PartyReviewStateV1,
} from '../v2-1-1/party-review-state.js';

export type PartyReviewStateV212 = PartyReviewStateV1;

/**
 * Derives the frozen PR 5 review contract from authoritative V2.1.2 state.
 * The serialized review shape and its embedded projection/read-back contracts
 * remain byte-for-byte V1/V2.1.1; only the canonical source envelope differs.
 */
export function derivePartyReviewStateV212(
  envelope: CaseEnvelopeV212,
  partyId: PartyIdV212,
): PartyReviewStateV1 {
  const formationProjection = projectPartyFormationV212(envelope, partyId);
  const formationReadback = renderPartyFormationReadbackV212(envelope, partyId);
  const cursor = envelope.control.party_views[partyId];
  const reviewWithoutHash: Omit<PartyReviewStateV1, 'review_state_hash'> = {
    review_state_version: PARTY_REVIEW_STATE_VERSION_V1,
    dispute_id: envelope.control.case_id,
    party_id: partyId,
    formation_projection_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
    party_projection_hash: cursor.party_projection_hash,
    party_visible_version: cursor.party_visible_version,
    formation_readback_version: PARTY_FORMATION_READBACK_VERSION_V211,
    party_readback_hash: formationReadback.document_hash,
    formation_epoch: envelope.parties[partyId].formation_epoch,
    formation_projection: formationProjection,
    formation_readback: formationReadback,
    own_confirmation_state:
      currentPartyConfirmationV212(envelope, partyId) === null ? 'unconfirmed' : 'confirmed',
    shared_readiness: deriveFormationReadinessV212(envelope).ready_for_bilateral_lock
      ? 'ready_for_lock'
      : 'not_ready',
  };
  const review = cloneCanonical({
    ...reviewWithoutHash,
    review_state_hash: hashPartyReviewStateV1(reviewWithoutHash),
  });
  if (validatePartyReviewStateV1(review).length > 0) {
    throw new TypeError('V2.1.2 could not derive the frozen party review contract.');
  }
  return review;
}

export function derivePartyConfirmationEligibilityV212(
  envelope: CaseEnvelopeV212,
  partyId: PartyIdV212,
): PartyConfirmationEligibilityV1 {
  const readiness = deriveFormationReadinessV212(envelope);
  const blockers = readiness.blockers.filter(
    (blocker) => !/^party_(?:a|b)_confirmation_missing_or_stale$/u.test(blocker),
  );
  if (envelope.control.workflow_state !== 'final_confirmation') {
    blockers.push('final_confirmation_state_required');
  }
  if (currentPartyConfirmationV212(envelope, partyId) !== null) {
    blockers.push('own_confirmation_already_current');
  }
  return { eligible: blockers.length === 0, blockers: [...new Set(blockers)].sort() };
}
