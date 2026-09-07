/**
 * Scripted provider completions for holdout v0.4.2.
 *
 * Same purpose and limits as every other fixture set: they prove the holdout is
 * internally consistent, that each declared citation resolves against the
 * stored turn, and that every expectation is satisfiable by output the V0.4
 * contract admits. They are NOT model evidence.
 *
 * Verified offline BEFORE the single live series, so no fixture or harness
 * mistake can consume runs this corpus only gets once.
 */

import { HOLDOUT_V042 } from './holdout-v042.js';
import type { OfflineDraft, OfflineAssertion, OfflineCitation } from './offline-completions.js';

const answerOf = new Map(HOLDOUT_V042.map((item) => [item.id, item.answer]));

function wholeAnswer(caseId: string): string {
  const text = answerOf.get(caseId);
  if (text === undefined) throw new TypeError(`no holdout v0.4.2 case '${caseId}'`);
  return text;
}

const q = (quote: string): OfflineCitation => ({ region: 'answer', message_index: null, quote });

function a(
  requirement_id: string,
  proposed_type: string,
  epistemic_strength: string,
  statement: string,
  citations: OfflineCitation[],
  supersedes_candidate: string | null = null,
): OfflineAssertion {
  return {
    requirement_id,
    proposed_type,
    epistemic_strength,
    statement,
    supersedes_candidate,
    citations,
  };
}

const accepted = (assertions: OfflineAssertion[]): OfflineDraft => ({
  verdict: 'accepted_candidates',
  assertions,
  rejected_candidates: [],
  clarifications_requested: [],
});

const none = (): OfflineDraft => ({
  verdict: 'no_assertions',
  assertions: [],
  rejected_candidates: [],
  clarifications_requested: [],
});

const ambiguous = (
  clarifications: { requirement_id: string; reason: string; prompt: string }[],
): OfflineDraft => ({
  verdict: 'ambiguous',
  assertions: [],
  rejected_candidates: [],
  clarifications_requested: clarifications,
});

export const HOLDOUT_V042_COMPLETIONS: Record<string, OfflineDraft> = {
  fh_duration_and_rate: accepted([
    a(
      'engagement_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says the crew were on site for nine days.',
      [q('The crew were on site for nine days')],
    ),
    a(
      'engagement_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says the rate was 310 euro a day.',
      [q('at 310 euro a day')],
    ),
  ]),

  fh_anti_split_control: accepted([
    a(
      'goods_condition',
      'narrative_fact',
      'asserted_confident',
      'The party says the badly cracked inverter housing was delivered on 4 May.',
      [q(wholeAnswer('fh_anti_split_control'))],
    ),
  ]),

  fh_fact_and_assessment: accepted([
    a(
      'installer_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the array was wired to the wrong phase.',
      [q('The array was wired to the wrong phase')],
    ),
    a(
      'installer_nonperformance',
      'narrative_fact',
      'asserted_qualified',
      'The party says, as their own view, that this tripped the distribution board every morning.',
      [q('my own view is that is what tripped the distribution board every morning')],
    ),
  ]),

  fh_event_and_timing: accepted([
    a(
      'supplier_attendance',
      'narrative_fact',
      'recalled_uncertain',
      'The party recalls that an engineer attended to look at the dryer but could not say which month.',
      [q(wholeAnswer('fh_event_and_timing'))],
    ),
  ]),

  fh_hedged_estimate: accepted([
    a(
      'repair_cost',
      'narrative_fact',
      'asserted_qualified',
      'The party says the bill came to roughly 4,000 euro.',
      [q(wholeAnswer('fh_hedged_estimate'))],
    ),
  ]),

  fh_performance_and_nonperformance: accepted([
    a(
      'contractor_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says the contractor took down the two dead limbs on 6 March.',
      [q('They took down the two dead limbs on 6 March')],
    ),
    a(
      'contractor_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the stump was never ground out.',
      [q('the stump was never ground out')],
    ),
  ]),

  fh_breadth_not_authority: accepted([
    a(
      'quoted_price',
      'narrative_fact',
      'asserted_confident',
      'The party says the quote was 2,600 euro for the fascia signs.',
      [q('The quote was 2,600 euro for the fascia signs')],
    ),
  ]),

  fh_two_remedies: accepted([
    a(
      'remedy_sought',
      'requested_remedy',
      'asserted_confident',
      'The party says they want the freezer room brought back to minus eighteen.',
      [q('I want the freezer room brought back to minus eighteen')],
    ),
    a(
      'remedy_sought',
      'requested_remedy',
      'asserted_confident',
      'The party says they want their standing charge refunded.',
      [q('my standing charge refunded')],
    ),
  ]),

  fh_adverse_among_favourable: accepted([
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the supplier ignored nearly every callout.',
      [q('They ignored nearly every callout')],
    ),
    a(
      'own_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says they let the service contract lapse for four months.',
      [q('I also let the service contract lapse for four months')],
    ),
  ]),

  fh_adverse_concession: accepted([
    a(
      'own_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says they never sent back the signed impression tray form.',
      [q('I never sent back the signed impression tray form')],
    ),
  ]),

  fh_exact_correction: accepted([
    a(
      'install_costs',
      'payment',
      'asserted_confident',
      'The party says the panel mounting was 980 euro.',
      [q('the panel mounting was 980 euro')],
      'prop_panel_mounting',
    ),
  ]),

  fh_additive_not_correction: accepted([
    a(
      'install_costs',
      'payment',
      'asserted_confident',
      'The party says there was also a roof anchor kit at 75 euro.',
      [q(wholeAnswer('fh_additive_not_correction'))],
    ),
  ]),

  fh_context_laundering: accepted([
    a(
      'contract_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says the contract ran for a twelve-month term.',
      [q(wholeAnswer('fh_context_laundering'))],
    ),
  ]),

  fh_pure_restatement: none(),

  fh_ambiguous_wording: ambiguous([
    {
      requirement_id: 'binding_deadline',
      reason: 'type_classification_indeterminate',
      prompt: 'Was the 30th agreed as a binding obligation, or a date you had pencilled in?',
    },
  ]),
};
