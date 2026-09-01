import { canonicalSerialize, cloneCanonical, sha256 } from '../v2/case-envelope.js';
import {
  PARTY_FORMATION_PROJECTION_VERSION_V21,
  PARTY_FORMATION_READBACK_VERSION_V21,
  otherPartyV21,
  type CanonicalPositionV21,
  type CaseEnvelopeV21,
  type EvidenceReferenceV21,
  type FormationChallengeV21,
  type FormationClarificationV21,
  type FormationRequirementV21,
  type PartyConfirmationReceiptV21,
  type PartyIdV21,
} from './case-envelope.js';

export interface PartyScopedFormationProjectionV21 {
  projection_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V21;
  case_id: string;
  party_id: PartyIdV21;
  formation_epoch: number;
  visible_phase: 'independent_formation' | 'disclosed_review';
  own_identity: {
    authenticated_subject_id: string | null;
    identity_assurance: 'unbound' | 'authenticated';
  };
  own_progress: {
    independent_formation_complete: boolean;
    last_reopen_event: null | {
      event_id: string;
      prior_formation_epoch: number;
      resulting_formation_epoch: number;
      reason: string;
      occurred_at: string;
    };
  };
  own_material: {
    positions: CanonicalPositionV21[];
    requirements: FormationRequirementV21[];
    clarifications: FormationClarificationV21[];
    evidence: EvidenceReferenceV21[];
  };
  visible_challenges: FormationChallengeV21[];
  opponent_material: null | {
    party_id: PartyIdV21;
    positions: CanonicalPositionV21[];
    evidence: EvidenceReferenceV21[];
  };
  warnings: string[];
}

export interface PartyFormationReadbackV21 {
  readback_version: typeof PARTY_FORMATION_READBACK_VERSION_V21;
  party_id: PartyIdV21;
  party_projection_hash: string;
  document: string;
  document_hash: string;
}

function sortedValues<T>(record: Record<string, T>, id: (value: T) => string): T[] {
  return Object.values(record).sort((left, right) => id(left).localeCompare(id(right)));
}

function positionsFor(envelope: CaseEnvelopeV21, partyId: PartyIdV21): CanonicalPositionV21[] {
  return sortedValues(envelope.positions, (position) => position.position_id).filter(
    (position) => position.attributed_party_id === partyId,
  );
}

function requirementsFor(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
): FormationRequirementV21[] {
  return sortedValues(envelope.requirements, (requirement) => requirement.requirement_id).filter(
    (requirement) => requirement.party_id === partyId,
  );
}

function clarificationsFor(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
): FormationClarificationV21[] {
  return sortedValues(
    envelope.clarifications,
    (clarification) => clarification.clarification_id,
  ).filter((clarification) => clarification.party_id === partyId);
}

function evidenceFor(envelope: CaseEnvelopeV21, partyId: PartyIdV21): EvidenceReferenceV21[] {
  return sortedValues(envelope.evidence, (evidence) => evidence.evidence_id).filter(
    (evidence) => evidence.attributed_party_id === partyId,
  );
}

function visibleChallengesFor(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
): FormationChallengeV21[] {
  if (envelope.control.disclosure_state !== 'disclosed') return [];
  return sortedValues(envelope.challenges, (challenge) => challenge.challenge_id).filter(
    (challenge) =>
      challenge.challenging_party_id === partyId || challenge.target_party_id === partyId,
  );
}

function projectionWarnings(
  ownEvidence: readonly EvidenceReferenceV21[],
  opponentEvidence: readonly EvidenceReferenceV21[],
): string[] {
  return [...ownEvidence, ...opponentEvidence]
    .filter(
      (evidence) =>
        evidence.required_for_readiness &&
        !['eligible', 'not_required'].includes(evidence.eligibility),
    )
    .map((evidence) => `evidence_not_eligible:${evidence.evidence_id}`)
    .sort();
}

/**
 * The requesting party is mandatory and server-derived. Before disclosure the
 * opponent branch is literally null: no opponent text, progress, counts,
 * warnings, timing, or shared envelope version can enter the projection.
 */
export function projectPartyFormationV21(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
): PartyScopedFormationProjectionV21 {
  const opponentId = otherPartyV21(partyId);
  const ownEvidence = evidenceFor(envelope, partyId);
  const disclosed = envelope.control.disclosure_state === 'disclosed';
  const opponentEvidence = disclosed ? evidenceFor(envelope, opponentId) : [];
  const lastReopenEvent = [...envelope.formation.reopen_events]
    .reverse()
    .find((event) => event.party_id === partyId);
  return cloneCanonical({
    projection_version: PARTY_FORMATION_PROJECTION_VERSION_V21,
    case_id: envelope.control.case_id,
    party_id: partyId,
    formation_epoch: envelope.parties[partyId].formation_epoch,
    visible_phase: disclosed ? 'disclosed_review' : 'independent_formation',
    own_identity: {
      authenticated_subject_id: envelope.parties[partyId].authenticated_subject_id,
      identity_assurance: envelope.parties[partyId].identity_assurance,
    },
    own_progress: {
      independent_formation_complete: envelope.parties[partyId].independent_formation_complete,
      last_reopen_event: lastReopenEvent
        ? {
            event_id: lastReopenEvent.event_id,
            prior_formation_epoch: lastReopenEvent.prior_formation_epoch,
            resulting_formation_epoch: lastReopenEvent.resulting_formation_epoch,
            reason: lastReopenEvent.reason,
            occurred_at: lastReopenEvent.occurred_at,
          }
        : null,
    },
    own_material: {
      positions: positionsFor(envelope, partyId),
      requirements: requirementsFor(envelope, partyId),
      clarifications: clarificationsFor(envelope, partyId),
      evidence: ownEvidence,
    },
    visible_challenges: visibleChallengesFor(envelope, partyId),
    opponent_material: disclosed
      ? {
          party_id: opponentId,
          positions: positionsFor(envelope, opponentId),
          evidence: opponentEvidence,
        }
      : null,
    warnings: projectionWarnings(ownEvidence, opponentEvidence),
  });
}

export function serializePartyFormationProjectionV21(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
): string {
  return canonicalSerialize(projectPartyFormationV21(envelope, partyId));
}

export function hashPartyFormationProjectionV21(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
): string {
  return sha256(serializePartyFormationProjectionV21(envelope, partyId));
}

export function renderPartyFormationReadbackV21(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
): PartyFormationReadbackV21 {
  const projection = projectPartyFormationV21(envelope, partyId);
  const partyProjectionHash = sha256(canonicalSerialize(projection));
  const document = canonicalSerialize({
    readback_version: PARTY_FORMATION_READBACK_VERSION_V21,
    party_id: partyId,
    adopted_formation: projection,
  });
  return {
    readback_version: PARTY_FORMATION_READBACK_VERSION_V21,
    party_id: partyId,
    party_projection_hash: partyProjectionHash,
    document,
    document_hash: sha256(document),
  };
}

/** Shared envelope movement is audit evidence only, never a currency test. */
export function currentPartyConfirmationV21(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
): PartyConfirmationReceiptV21 | null {
  const party = envelope.parties[partyId];
  if (
    party.edit_state !== 'confirmed' ||
    party.identity_assurance !== 'authenticated' ||
    !party.authenticated_subject_id
  ) {
    return null;
  }
  const projectionHash = hashPartyFormationProjectionV21(envelope, partyId);
  const readback = renderPartyFormationReadbackV21(envelope, partyId);
  const receipt = [...envelope.formation.confirmations[partyId]]
    .reverse()
    .find(
      (candidate) =>
        candidate.authenticated_subject_id === party.authenticated_subject_id &&
        candidate.formation_epoch === party.formation_epoch &&
        candidate.party_projection_hash === projectionHash &&
        candidate.party_readback_hash === readback.document_hash &&
        candidate.party_visible_version ===
          envelope.control.party_views[partyId].party_visible_version,
    );
  return receipt ? cloneCanonical(receipt) : null;
}
