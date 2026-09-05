/**
 * The V2.1.4 opening requirement set.
 *
 * V2.1.3 asked ten questions and could reach
 * `independent_formation_complete: true` without ever recording what the OTHER
 * party actually did, or what this party says the other party failed to do.
 * The live V2.1.3 canary demonstrated exactly that: formation complete, zero
 * unresolved requirements, and no record of the alleged late delivery or the
 * alleged incomplete work — the breach allegations themselves.
 *
 * The gap was in requirement ROLES, not in the proposition vocabulary. The
 * compiler already distinguishes `narrative_fact`, `explicit_absence`,
 * `non_recollection` and `declined_to_answer`; nothing here needs a new
 * proposition type. Two roles are added instead, and they are deliberately
 * two rather than one: a case that records only what happened, or only what is
 * alleged to be deficient, is still missing half of the dispute.
 *
 * The roles are kept strictly distinct from their neighbours:
 *
 *  - `accepted_scope` is an agreement fact. Agreeing that something would be
 *    done is not evidence that it was done.
 *  - `contractual_deadline` is an agreement fact. Agreeing on July 1 does not
 *    record an actual July 15 delivery.
 *  - `req_other_party_position` is the speaker's understanding of the
 *    OPPONENT's explanation. It is not the speaker's own allegation.
 *  - `req_own_performance` is the speaker's own shortfall. Attribution stays
 *    exact in both directions.
 *
 * Neither new requirement encodes a legal conclusion. "Failed to do, did late,
 * did incompletely, did defectively" are factual descriptions; breach,
 * negligence, liability and entitlement are adjudication and are not asked here.
 */

import { initialRequirementSet as historicalRequirements } from '../webmcp/runtime/initial-requirements.js';
import type { RequirementDefinition } from '../webmcp/core-v0-3/requirements.js';

export const INITIAL_REQUIREMENT_SET_VERSION_V214 = 'juryai-p2-initial-requirements-v0.4.0';

/** Non-answer types satisfy every requirement, exactly as in the historical set. */
const NON_ANSWER = ['non_recollection', 'declined_to_answer'] as const;

/**
 * Explicit decisions for this set only; future sets opt in individually.
 *
 * Opting a requirement into `explicit_absence` is a claim that "none / it did
 * not happen" is a meaningful DIRECT answer to that question, not a way of
 * declining it. Silence is never absence, and an opponent's denial that this
 * party has not adopted is never this party's absence.
 */
export const EXPLICIT_ABSENCE_REQUIREMENT_DECISIONS_V214 = {
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
  req_other_party_performance:
    'The other party may have done nothing at all. "They never delivered anything" is a direct factual answer about performance, not a refusal to answer, and must not be inferred from silence.',
  req_other_party_nonperformance:
    'The party may allege no shortfall at all. Declining to allege is a substantive position that must be recordable, and is distinct from not remembering, from refusing to answer, and from the opponent denying a shortfall.',
} as const;

function definition(
  requirementId: string,
  prompt: string,
  satisfying: RequirementDefinition['satisfying_types'],
  adverseFactProbe = false,
): RequirementDefinition {
  return {
    requirement_id: requirementId,
    prompt,
    satisfying_types: [...satisfying, ...NON_ANSWER],
    min_propositions: 1,
    max_propositions: null,
    adverse_fact_probe: adverseFactProbe,
    reopened_from: null,
  };
}

/** The two roles V2.1.3 never asked for. */
export function performanceRequirementsV214(): RequirementDefinition[] {
  return [
    definition(
      'req_other_party_performance',
      'What did the other party actually do or deliver, and when?',
      ['narrative_fact'],
    ),
    definition(
      'req_other_party_nonperformance',
      'What, if anything, do you say the other party failed to do, did late, did incompletely, did defectively, or otherwise did not perform as agreed?',
      ['narrative_fact'],
    ),
  ];
}

export function initialRequirementSet(): RequirementDefinition[] {
  return [...historicalRequirements(), ...performanceRequirementsV214()].map((definition) => ({
    ...definition,
    satisfying_types: Object.hasOwn(
      EXPLICIT_ABSENCE_REQUIREMENT_DECISIONS_V214,
      definition.requirement_id,
    )
      ? [...definition.satisfying_types, 'explicit_absence']
      : [...definition.satisfying_types],
  }));
}
