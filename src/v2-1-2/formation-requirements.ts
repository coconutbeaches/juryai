import type {
  CaseEnvelopeV211,
  FormationRequirementV211,
  PartyIdV211,
} from '../v2-1-1/case-envelope.js';
import {
  derivePartyIndependentFormationCompleteV211,
  evaluateFormationRequirementV211,
  evaluatePartyFormationRequirementsV211,
  liveSemanticPositionsV211,
} from '../v2-1-1/formation-requirements.js';
import type { CaseEnvelopeV212, FormationRequirementV212, PartyIdV212 } from './case-envelope.js';

/**
 * V2.1.2 deliberately preserves V2.1.1 formation semantics. These adapters
 * narrow a validated V2.1.2 envelope to the unchanged fields consumed by the
 * frozen V2.1.1 evaluators; they never convert persisted V2.1.1 state.
 */
function frozenFormationViewV211(envelope: CaseEnvelopeV212): CaseEnvelopeV211 {
  return envelope as unknown as CaseEnvelopeV211;
}

export function liveSemanticPositionsV212(envelope: CaseEnvelopeV212, partyId?: PartyIdV212) {
  return liveSemanticPositionsV211(
    frozenFormationViewV211(envelope),
    partyId as PartyIdV211 | undefined,
  );
}

export function evaluateFormationRequirementV212(
  envelope: CaseEnvelopeV212,
  definition: FormationRequirementV212,
) {
  return evaluateFormationRequirementV211(
    frozenFormationViewV211(envelope),
    definition as FormationRequirementV211,
  );
}

export function evaluatePartyFormationRequirementsV212(
  envelope: CaseEnvelopeV212,
  partyId: PartyIdV212,
) {
  return evaluatePartyFormationRequirementsV211(
    frozenFormationViewV211(envelope),
    partyId as PartyIdV211,
  );
}

export function derivePartyIndependentFormationCompleteV212(
  envelope: CaseEnvelopeV212,
  partyId: PartyIdV212,
): boolean {
  return derivePartyIndependentFormationCompleteV211(
    frozenFormationViewV211(envelope),
    partyId as PartyIdV211,
  );
}

export type {
  FormationRequirementEvaluationV211 as FormationRequirementEvaluationV212,
  FormationRequirementStatusV211 as FormationRequirementStatusV212,
} from '../v2-1-1/formation-requirements.js';
