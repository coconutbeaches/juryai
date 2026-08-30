/**
 * The canonical requirement set a new P2 case starts with.
 *
 * This is runtime configuration, not core: the core owns what a requirement IS
 * and how satisfaction is decided, and deliberately owns no opinion about
 * which questions JuryAI asks. It is injectable so a future case-type router
 * can supply a different opening set without touching the pipeline.
 *
 * Two properties are load-bearing and are asserted by the structural
 * validator, not by convention here:
 *
 *  - No requirement accepts both halves of a non-coercible type pair. Asking
 *    "what date did you expect" and "what deadline was agreed as binding" as
 *    ONE question, satisfied by either type, silently destroys the distinction
 *    the type system exists to preserve. They are two questions.
 *  - Requirement ids are stable logical identities and are never reused.
 *
 * Non-answer types satisfy every requirement on purpose. A case in which the
 * user genuinely does not recall must be able to reach readiness with that
 * recorded as a canonical fact, rather than stalling until someone invents a
 * recollection.
 */

import type { RequirementDefinition } from '../core/requirements.js';

export const INITIAL_REQUIREMENT_SET_VERSION = 'juryai-p2-initial-requirements-v0.2.0';

const NON_ANSWER = ['non_recollection', 'declined_to_answer'] as const;

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

/** Provider seam so case-type selection can vary without changing the runtime. */
export interface RequirementSetProvider {
  readonly version: string;
  initialRequirements(): RequirementDefinition[];
}

export function initialRequirementSet(): RequirementDefinition[] {
  return [
    definition('req_scope_requested', 'What did you ask the other party to do or provide?', [
      'requested_scope',
    ]),
    definition(
      'req_scope_accepted',
      'What did the other party actually agree to do or provide, and how was that agreement reached?',
      ['accepted_scope'],
    ),
    definition(
      'req_binding_deadline',
      'Was a completion or delivery date agreed as a binding obligation? If so, what was it and how was it agreed?',
      ['contractual_deadline'],
    ),
    definition(
      'req_expected_date',
      'Separately from any binding obligation, by what date did you expect the work to be finished?',
      ['target_date'],
    ),
    definition('req_invoiced', 'What was invoiced or billed to you, and when?', ['invoice']),
    definition('req_paid', 'What payments did you actually make, and when?', ['payment']),
    definition('req_disputed_balance', 'What amount, if any, do you say is still in dispute?', [
      'disputed_balance',
    ]),
    definition('req_remedy_sought', 'What outcome are you asking for?', ['requested_remedy']),
    definition(
      'req_other_party_position',
      "As best you understand it, what is the other party's explanation, including anything they say you got wrong?",
      ['narrative_fact'],
      true,
    ),
    definition(
      'req_own_performance',
      'Is there anything you were required to do that you did not do, or did late?',
      ['narrative_fact'],
      true,
    ),
  ];
}

export const defaultRequirementSetProvider: RequirementSetProvider = {
  version: INITIAL_REQUIREMENT_SET_VERSION,
  initialRequirements: initialRequirementSet,
};
