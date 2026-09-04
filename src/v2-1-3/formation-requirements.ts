import { cloneCanonical } from '../v2/case-envelope.js';
import { canSatisfyRole } from '../webmcp/core-v0-3/types.js';
import type {
  CanonicalSemanticPositionV213,
  CaseEnvelopeV213,
  FormationRequirementV213,
  PartyIdV213,
} from './case-envelope.js';

export type FormationRequirementStatusV213 =
  'unsatisfied' | 'satisfied' | 'blocked_by_clarification';

export interface FormationRequirementEvaluationV213 {
  requirement_id: string;
  status: FormationRequirementStatusV213;
  satisfying_position_ids: string[];
  non_satisfying_position_ids: string[];
}

export function liveSemanticPositionsV213(
  envelope: CaseEnvelopeV213,
  partyId?: PartyIdV213,
): CanonicalSemanticPositionV213[] {
  return Object.values(envelope.positions)
    .filter(
      (position) =>
        position.superseded_by === null &&
        (partyId === undefined || position.attributed_party_id === partyId),
    )
    .sort((left, right) => left.position_id.localeCompare(right.position_id));
}

export function evaluateFormationRequirementV213(
  envelope: CaseEnvelopeV213,
  definition: FormationRequirementV213,
): FormationRequirementEvaluationV213 {
  const linked = liveSemanticPositionsV213(envelope, definition.party_id).filter(
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

export function evaluatePartyFormationRequirementsV213(
  envelope: CaseEnvelopeV213,
  partyId: PartyIdV213,
): FormationRequirementEvaluationV213[] {
  return Object.values(envelope.requirements)
    .filter((requirement) => requirement.party_id === partyId)
    .sort((left, right) => left.requirement_id.localeCompare(right.requirement_id))
    .map((requirement) => evaluateFormationRequirementV213(envelope, requirement));
}

export function derivePartyIndependentFormationCompleteV213(
  envelope: CaseEnvelopeV213,
  partyId: PartyIdV213,
): boolean {
  const party = envelope.parties[partyId];
  if (party.identity_assurance !== 'authenticated' || !party.authenticated_subject_id) return false;
  const required = Object.values(envelope.requirements).filter(
    (requirement) => requirement.party_id === partyId && requirement.required,
  );
  return required.every(
    (requirement) => evaluateFormationRequirementV213(envelope, requirement).status === 'satisfied',
  );
}
