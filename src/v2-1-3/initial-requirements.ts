import { initialRequirementSet as historicalRequirements } from '../webmcp/runtime/initial-requirements.js';
import type { RequirementDefinition } from '../webmcp/core-v0-3/requirements.js';

export const INITIAL_REQUIREMENT_SET_VERSION_V213 = 'juryai-p2-initial-requirements-v0.3.0';

/** Explicit decisions for this set only; future sets opt in individually. */
export const EXPLICIT_ABSENCE_REQUIREMENT_DECISIONS_V213 = {
  req_scope_requested: 'The party may have requested nothing, including unsolicited work.',
  req_scope_accepted: 'The party may deny that any scope was agreed.',
  req_binding_deadline: 'No binding deadline does not deny a separate target date.',
  req_expected_date: 'The party may have had no particular expected completion date.',
  req_invoiced: 'No invoice or bill was issued to the party.',
  req_paid: 'No payment was made by the party; this does not establish debt.',
  req_disputed_balance: 'The party may say no amount remains in dispute.',
  req_remedy_sought: 'The party may explicitly seek no remedy, including as respondent.',
  req_other_party_position: 'No explanation has been provided; not adoption of an opponent denial.',
  req_own_performance: 'Absence of own nonperformance, not absence of all obligations.',
} as const;

export function initialRequirementSet(): RequirementDefinition[] {
  return historicalRequirements().map((definition) => ({
    ...definition,
    satisfying_types: Object.hasOwn(
      EXPLICIT_ABSENCE_REQUIREMENT_DECISIONS_V213,
      definition.requirement_id,
    )
      ? [...definition.satisfying_types, 'explicit_absence']
      : [...definition.satisfying_types],
  }));
}
