import { cloneCanonical } from '../v2/case-envelope.js';
import { canSatisfyRole } from '../webmcp/core-v0-3/types.js';
import type {
  CanonicalSemanticPosition,
  CaseEnvelope,
  FormationRequirement,
  PartyId,
} from './envelope.js';

export type FormationRequirementStatus = 'unsatisfied' | 'satisfied' | 'blocked_by_clarification';

export interface FormationRequirementEvaluation {
  requirement_id: string;
  status: FormationRequirementStatus;
  satisfying_position_ids: string[];
  non_satisfying_position_ids: string[];
}

export function liveSemanticPositions(
  envelope: CaseEnvelope,
  partyId?: PartyId,
): CanonicalSemanticPosition[] {
  return Object.values(envelope.positions)
    .filter(
      (position) =>
        position.superseded_by === null &&
        (partyId === undefined || position.attributed_party_id === partyId),
    )
    .sort((left, right) => left.position_id.localeCompare(right.position_id));
}

export function evaluateFormationRequirement(
  envelope: CaseEnvelope,
  definition: FormationRequirement,
): FormationRequirementEvaluation {
  const linked = liveSemanticPositions(envelope, definition.party_id).filter(
    (position) => position.requirement_id === definition.requirement_id,
  );
  const satisfying = linked.filter((position) =>
    canSatisfyRole(position.proposition_type, definition.satisfying_types),
  );
  const nonSatisfying = linked.filter(
    (position) => !canSatisfyRole(position.proposition_type, definition.satisfying_types),
  );
  const openClarification = Object.values(envelope.clarifications).some(
    (clarification) =>
      clarification.party_id === definition.party_id &&
      clarification.requirement_id === definition.requirement_id &&
      clarification.resolved_at_envelope_version === null,
  );

  const withinCardinality =
    satisfying.length >= definition.min_propositions &&
    (definition.max_propositions === null || satisfying.length <= definition.max_propositions);

  return cloneCanonical({
    requirement_id: definition.requirement_id,
    status: openClarification
      ? 'blocked_by_clarification'
      : withinCardinality
        ? 'satisfied'
        : 'unsatisfied',
    satisfying_position_ids: satisfying.map((position) => position.position_id),
    non_satisfying_position_ids: nonSatisfying.map((position) => position.position_id),
  });
}

export function evaluatePartyFormationRequirements(
  envelope: CaseEnvelope,
  partyId: PartyId,
): FormationRequirementEvaluation[] {
  return Object.values(envelope.requirements)
    .filter((requirement) => requirement.party_id === partyId)
    .sort((left, right) => left.requirement_id.localeCompare(right.requirement_id))
    .map((requirement) => evaluateFormationRequirement(envelope, requirement));
}

export function derivePartyIndependentFormationComplete(
  envelope: CaseEnvelope,
  partyId: PartyId,
): boolean {
  const party = envelope.parties[partyId];
  if (party.identity_assurance !== 'authenticated' || !party.authenticated_subject_id) return false;
  const required = Object.values(envelope.requirements).filter(
    (requirement) => requirement.party_id === partyId && requirement.required,
  );
  return required.every(
    (requirement) => evaluateFormationRequirement(envelope, requirement).status === 'satisfied',
  );
}
