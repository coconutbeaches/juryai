import { canonicalSerialize, cloneCanonical, sha256 } from '../v2/case-envelope.js';
import type { GenerationSpec } from './generation-spec.js';
import type { EpistemicStrength, PropositionType } from '../webmcp/core-v0-3/types.js';
import {
  otherParty,
  type CaseEnvelope,
  type EvidenceReference,
  type PartyConfirmationReceipt,
  type PartyId,
  type SourceSpanCommitment,
} from './envelope.js';
import {
  derivePartyIndependentFormationComplete,
  evaluateFormationRequirement,
  type FormationRequirementStatus,
} from './requirements.js';

export interface PartyVisiblePosition {
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
  evidence_ref_id: string | null;
}

export interface PartyVisibleRequirement {
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
  status: FormationRequirementStatus;
  satisfying_position_ids: string[];
  non_satisfying_position_ids: string[];
}

export interface PartyVisibleClarification {
  clarification_id: string;
  party_id: PartyId;
  requirement_id: string;
  reason: string;
  prompt: string;
  status: 'open' | 'resolved';
  reopened_as: string | null;
}

export interface PartyVisibleChallengeResponse {
  response_id: string;
  responding_party_id: PartyId;
  statement: string;
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitment[];
  semantic_position_id: string | null;
}

export interface PartyVisibleChallenge {
  challenge_id: string;
  challenging_party_id: PartyId;
  target_party_id: PartyId;
  target_position_id: string;
  statement: string;
  source_turn_id: string;
  source_span_commitments: SourceSpanCommitment[];
  status: 'open' | 'resolved' | 'withdrawn';
  response: PartyVisibleChallengeResponse | null;
}

export interface PartyScopedFormationProjection {
  projection_version: string;
  case_id: string;
  party_id: PartyId;
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
    positions: PartyVisiblePosition[];
    requirements: PartyVisibleRequirement[];
    clarifications: PartyVisibleClarification[];
    evidence: EvidenceReference[];
  };
  visible_challenges: PartyVisibleChallenge[];
  opponent_material: null | {
    party_id: PartyId;
    positions: PartyVisiblePosition[];
    evidence: EvidenceReference[];
  };
  warnings: string[];
}

export interface PartyFormationReadback {
  readback_version: string;
  party_id: PartyId;
  party_projection_hash: string;
  document: string;
  document_hash: string;
}

function positionsFor(envelope: CaseEnvelope, partyId: PartyId): PartyVisiblePosition[] {
  return Object.values(envelope.positions)
    .filter((position) => position.attributed_party_id === partyId)
    .sort((left, right) => left.position_id.localeCompare(right.position_id))
    .map((position) => ({
      position_id: position.position_id,
      attributed_party_id: position.attributed_party_id,
      requirement_id: position.requirement_id,
      proposition_type: position.proposition_type,
      epistemic_strength: position.epistemic_strength,
      statement: position.statement,
      resolution_status: position.resolution_status,
      source_turn_id: position.source_turn_id,
      source_span_commitments: cloneCanonical(position.source_span_commitments),
      supersedes: position.supersedes,
      superseded_by: position.superseded_by,
      evidence_ref_id: position.evidence_ref_id,
    }));
}

function requirementsFor(envelope: CaseEnvelope, partyId: PartyId): PartyVisibleRequirement[] {
  return Object.values(envelope.requirements)
    .filter((requirement) => requirement.party_id === partyId)
    .sort((left, right) => left.requirement_id.localeCompare(right.requirement_id))
    .map((requirement) => ({
      ...cloneCanonical(requirement),
      ...evaluateFormationRequirement(envelope, requirement),
    }));
}

function clarificationsFor(envelope: CaseEnvelope, partyId: PartyId): PartyVisibleClarification[] {
  return Object.values(envelope.clarifications)
    .filter((clarification) => clarification.party_id === partyId)
    .sort((left, right) => left.clarification_id.localeCompare(right.clarification_id))
    .map((clarification) => ({
      clarification_id: clarification.clarification_id,
      party_id: clarification.party_id,
      requirement_id: clarification.requirement_id,
      reason: clarification.reason,
      prompt: clarification.prompt,
      status: clarification.resolved_at_envelope_version === null ? 'open' : 'resolved',
      reopened_as: clarification.reopened_as,
    }));
}

function evidenceFor(envelope: CaseEnvelope, partyId: PartyId): EvidenceReference[] {
  return Object.values(envelope.evidence)
    .filter((evidence) => evidence.attributed_party_id === partyId)
    .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id))
    .map((evidence) => cloneCanonical(evidence));
}

function visibleChallenge(challenge: CaseEnvelope['challenges'][string]): PartyVisibleChallenge {
  return {
    challenge_id: challenge.challenge_id,
    challenging_party_id: challenge.challenging_party_id,
    target_party_id: challenge.target_party_id,
    target_position_id: challenge.target_position_id,
    statement: challenge.statement,
    source_turn_id: challenge.source_turn_id,
    source_span_commitments: cloneCanonical(challenge.source_span_commitments),
    status: challenge.status,
    response: challenge.response
      ? {
          response_id: challenge.response.response_id,
          responding_party_id: challenge.response.responding_party_id,
          statement: challenge.response.statement,
          source_turn_id: challenge.response.source_turn_id,
          source_span_commitments: cloneCanonical(challenge.response.source_span_commitments),
          semantic_position_id: challenge.response.semantic_position_id,
        }
      : null,
  };
}

function visibleChallengesFor(envelope: CaseEnvelope, partyId: PartyId): PartyVisibleChallenge[] {
  if (envelope.control.disclosure_state !== 'disclosed') return [];
  return Object.values(envelope.challenges)
    .filter(
      (challenge) =>
        challenge.challenging_party_id === partyId || challenge.target_party_id === partyId,
    )
    .sort((left, right) => left.challenge_id.localeCompare(right.challenge_id))
    .map(visibleChallenge);
}

function projectionWarnings(
  ownEvidence: readonly EvidenceReference[],
  opponentEvidence: readonly EvidenceReference[],
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

/** Internal envelope versions and hidden-party activity never enter this projection. */
export function projectPartyFormation(
  spec: GenerationSpec,
  envelope: CaseEnvelope,
  partyId: PartyId,
): PartyScopedFormationProjection {
  const opponentId = otherParty(partyId);
  const ownEvidence = evidenceFor(envelope, partyId);
  const disclosed = envelope.control.disclosure_state === 'disclosed';
  const opponentEvidence = disclosed ? evidenceFor(envelope, opponentId) : [];
  const lastReopenEvent = [...envelope.formation.reopen_events]
    .reverse()
    .find((event) => event.party_id === partyId);

  return cloneCanonical({
    projection_version: spec.contracts.projection_version,
    case_id: envelope.control.case_id,
    party_id: partyId,
    formation_epoch: envelope.parties[partyId].formation_epoch,
    visible_phase: disclosed ? 'disclosed_review' : 'independent_formation',
    own_identity: {
      authenticated_subject_id: envelope.parties[partyId].authenticated_subject_id,
      identity_assurance: envelope.parties[partyId].identity_assurance,
    },
    own_progress: {
      independent_formation_complete: derivePartyIndependentFormationComplete(envelope, partyId),
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

export function serializePartyFormationProjection(
  spec: GenerationSpec,
  envelope: CaseEnvelope,
  partyId: PartyId,
): string {
  return canonicalSerialize(projectPartyFormation(spec, envelope, partyId));
}

export function hashPartyFormationProjection(
  spec: GenerationSpec,
  envelope: CaseEnvelope,
  partyId: PartyId,
): string {
  return sha256(serializePartyFormationProjection(spec, envelope, partyId));
}

export function renderPartyFormationReadback(
  spec: GenerationSpec,
  envelope: CaseEnvelope,
  partyId: PartyId,
): PartyFormationReadback {
  const projection = projectPartyFormation(spec, envelope, partyId);
  const partyProjectionHash = sha256(canonicalSerialize(projection));
  const document = canonicalSerialize({
    readback_version: spec.contracts.readback_version,
    party_id: partyId,
    adopted_formation: projection,
  });
  return {
    readback_version: spec.contracts.readback_version,
    party_id: partyId,
    party_projection_hash: partyProjectionHash,
    document,
    document_hash: sha256(document),
  };
}

export function currentPartyConfirmation(
  spec: GenerationSpec,
  envelope: CaseEnvelope,
  partyId: PartyId,
): PartyConfirmationReceipt | null {
  const party = envelope.parties[partyId];
  if (
    party.edit_state !== 'confirmed' ||
    party.identity_assurance !== 'authenticated' ||
    !party.authenticated_subject_id
  ) {
    return null;
  }
  const projectionHash = hashPartyFormationProjection(spec, envelope, partyId);
  const readback = renderPartyFormationReadback(spec, envelope, partyId);
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
