/**
 * Scripted provider completions, one per primary corpus case.
 *
 * WHAT AN OFFLINE RUN PROVES, AND WHAT IT DOES NOT. These fixtures sit at the
 * PROVIDER seam, so everything above them is the real V0.4 compiler: the real
 * prompt artefact, the real V0.4 input rendering, the real V0.4 response
 * schema, the real V0.3 parser, real grounding resolution against the stored
 * turn, the real V0.4 contract and the real 8C1b-0 grader. Only the completion
 * BYTES are scripted.
 *
 * A green offline run therefore proves that the pipeline, the corpus and the
 * oracle fit together — that every expectation is satisfiable by some legal
 * output, that every declared citation resolves, and that no case is
 * self-contradictory. It is NOT model evidence of any kind, and every report
 * that includes it says so explicitly. A fixture is what a correct model would
 * have returned; that a fixture passes says nothing about what a model returns.
 *
 * Keyed by case id in a separate map rather than added to the oracle's case
 * type, so the 8C1b-0 types stay exactly as they were.
 *
 * Quotations are written as exact substrings of the STORED answer, and
 * `wholeAnswer` reads the corpus rather than repeating the text — a
 * hand-retyped answer is how an `explicit_absence` fixture silently stops
 * satisfying the whole-answer citation rule.
 */

import { PRIMARY_CORPUS } from './index.js';

export interface OfflineCitation {
  region: 'answer' | 'context';
  message_index: number | null;
  quote: string;
}

export interface OfflineAssertion {
  requirement_id: string;
  proposed_type: string;
  epistemic_strength: string;
  statement: string;
  supersedes_candidate: string | null;
  citations: OfflineCitation[];
}

export interface OfflineDraft {
  verdict: 'accepted_candidates' | 'ambiguous' | 'no_assertions';
  assertions: OfflineAssertion[];
  rejected_candidates: unknown[];
  clarifications_requested: { requirement_id: string; reason: string; prompt: string }[];
}

const answerOf = new Map(PRIMARY_CORPUS.map((item) => [item.id, item.answer]));

/** The complete stored answer, as `explicit_absence` grounding requires. */
function wholeAnswer(caseId: string): string {
  const text = answerOf.get(caseId);
  if (text === undefined) throw new TypeError(`no corpus case '${caseId}'`);
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

export const OFFLINE_COMPLETIONS: Record<string, OfflineDraft> = {
  /* ---------------------------------------------------------------- decomposition */

  mf_two_events_same_slot: accepted([
    a(
      'other_party_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says the other side fitted the cabinets on 15 July.',
      [q('They fitted the cabinets on 15 July')],
    ),
    a(
      'other_party_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says the other side took the old units away on 18 July.',
      [q('they took the old units away on 18 July')],
    ),
  ]),

  mf_three_deficiencies: accepted([
    a(
      'other_party_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the contact form still did not work.',
      [q('The contact form still did not work')],
    ),
    a(
      'other_party_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the mobile layout was never finished.',
      [q('the mobile layout was never finished')],
    ),
    a(
      'other_party_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the checkout page returned an error.',
      [q('the checkout page returned an error')],
    ),
  ]),

  mf_two_payments_same_type: accepted([
    a(
      'payments_made',
      'payment',
      'asserted_confident',
      'The party says a deposit of 500 euro was paid in March.',
      [q('I paid a deposit of 500 euro in March')],
    ),
    a(
      'payments_made',
      'payment',
      'asserted_confident',
      'The party says a further 250 euro was paid in April.',
      [q('a further 250 euro in April')],
    ),
  ]),

  mf_one_coherent_fact: accepted([
    a(
      'delivery_condition',
      'narrative_fact',
      'asserted_confident',
      'The party says the badly damaged oak table arrived late on 3 March.',
      [q('The badly damaged oak table arrived late on 3 March')],
    ),
  ]),

  mf_same_requirement_two_types: accepted([
    a(
      'billing_history',
      'invoice',
      'asserted_confident',
      'The party says they sent invoice 118 on 2 May for 1,200 euro.',
      [q('I sent invoice 118 on 2 May for 1,200 euro')],
    ),
    a(
      'billing_history',
      'payment',
      'asserted_confident',
      'The party says the other side paid 400 euro on 30 May.',
      [q('they paid 400 euro on 30 May')],
    ),
  ]),

  ms_fact_plus_own_assessment: accepted([
    a(
      'other_party_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the delivery was late.',
      [q('The delivery was late')],
    ),
    a(
      'other_party_nonperformance',
      'narrative_fact',
      'asserted_qualified',
      'The party says, as their own assessment, that the lateness is what cost them the Henley contract.',
      [q('in my own assessment that lateness is what cost me the Henley contract')],
    ),
  ]),

  ms_confident_plus_recalled: accepted([
    a(
      'engagement_timeline',
      'narrative_fact',
      'asserted_confident',
      'The party says they signed the agreement on 4 June.',
      [q('I signed the agreement on 4 June')],
    ),
    a(
      'engagement_timeline',
      'narrative_fact',
      'recalled_uncertain',
      'The party recalls that the site visit was about a week later, but is not certain.',
      [q('I think the site visit was about a week later, but I am not certain')],
    ),
  ]),

  ms_three_strengths: accepted([
    a(
      'property_condition',
      'narrative_fact',
      'asserted_confident',
      'The party says the roof leaked in January.',
      [q('The roof leaked in January')],
    ),
    a(
      'property_condition',
      'narrative_fact',
      'asserted_qualified',
      'The party says they are fairly sure the repair quote was around 3,000 euro.',
      [q('I am fairly sure the repair quote was around 3,000 euro')],
    ),
    a(
      'property_condition',
      'narrative_fact',
      'recalled_uncertain',
      'The party recalls someone from the agency visiting but could not say when.',
      [q('I remember someone from the agency visiting, but I could not say when')],
    ),
  ]),

  ms_flattening_trap: accepted([
    a(
      'other_party_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the other side never returned their calls.',
      [q('They never returned my calls')],
    ),
    a(
      'other_party_nonperformance',
      'narrative_fact',
      'asserted_qualified',
      'The party says, as their own view, that the other side had already decided to walk away.',
      [q('in my view shows they had already decided to walk away')],
    ),
  ]),

  /* ---------------------------------------------------------------- supersession */

  sup_siblings_untouched: accepted([
    a(
      'tenancy_money',
      'payment',
      'asserted_confident',
      'The party says the deposit was 550 euro.',
      [q('the deposit was 550 euro')],
      'prop_deposit_500',
    ),
  ]),

  sup_cross_type_correction: accepted([
    a(
      'binding_deadline',
      'contractual_deadline',
      'asserted_confident',
      'The party says 1 July was agreed as the binding deadline in the signed contract.',
      [q('1 July was agreed as the binding deadline in the signed contract')],
      'prop_no_deadline',
    ),
  ]),

  sup_one_of_two_invoices: accepted([
    a(
      'invoices_issued',
      'invoice',
      'asserted_confident',
      'The party says invoice 118 was 1,250 euro.',
      [q('Invoice 118 was 1,250 euro')],
      'prop_invoice_118',
    ),
  ]),

  add_related_new_fact: accepted([
    a(
      'tenancy_money',
      'payment',
      'asserted_confident',
      'The party says a cleaning fee of 80 euro was paid at the same time.',
      [q('I also paid a cleaning fee of 80 euro at the same time')],
    ),
  ]),

  add_second_occurrence: accepted([
    a(
      'site_visits',
      'narrative_fact',
      'asserted_confident',
      'The party says another site visit took place in September.',
      [q('There was another site visit in September')],
    ),
  ]),

  add_scope_extension: accepted([
    a(
      'agreed_scope',
      'accepted_scope',
      'asserted_confident',
      'The party says the bathroom was added to the scope in May.',
      [q('The bathroom was added to the scope in May')],
    ),
  ]),

  rest_verbatim_repeat: none(),
  rest_reworded_repeat: none(),

  rest_repeat_plus_new_fact: accepted([
    a(
      'property_condition',
      'narrative_fact',
      'asserted_confident',
      'The party says the roof leaked again in March.',
      [q('it leaked again in March')],
    ),
  ]),

  epa_answer_elsewhere_no_duplicate: accepted([
    a(
      'rent_amount',
      'payment',
      'asserted_confident',
      'The party says the rent was 950 euro a month.',
      [q('The rent was 950 euro a month')],
    ),
  ]),

  epa_same_amount_different_month: accepted([
    a(
      'payments_made',
      'payment',
      'asserted_confident',
      'The party says another payment of 500 euro was made in April.',
      [q('I made another payment of 500 euro in April')],
    ),
  ]),

  /* ---------------------------------------------------------------- scope */

  vol_asked_one_volunteered_two: accepted([
    a(
      'payment_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says payment was due on delivery.',
      [q('Payment was due on delivery')],
    ),
    a(
      'other_party_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says the other side delivered on 15 July.',
      [q('They delivered on 15 July')],
    ),
    a(
      'other_party_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the contact form still did not work.',
      [q('the contact form still did not work')],
    ),
  ]),

  vol_no_supplied_requirement: accepted([
    a(
      'payment_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says payment was due on delivery.',
      [q('Payment was due on delivery')],
    ),
  ]),

  vol_ambiguous_unasked: accepted([
    a(
      'payment_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says payment was due on delivery.',
      [q('Payment was due on delivery')],
    ),
  ]),

  vol_unasked_different_type: accepted([
    a(
      'agreed_scope',
      'accepted_scope',
      'asserted_confident',
      'The party says the agreed scope was the kitchen refit.',
      [q('The agreed scope was the kitchen refit')],
    ),
    a(
      'payments_made',
      'payment',
      'asserted_confident',
      'The party says they paid 2,000 euro up front on 1 March.',
      [q('I paid 2,000 euro up front on 1 March')],
    ),
  ]),

  bulk_ten_requirements: accepted([
    a(
      'engagement_start',
      'narrative_fact',
      'asserted_confident',
      'The party says they engaged the other side on 3 February.',
      [q('We engaged them on 3 February')],
    ),
    a(
      'agreed_scope',
      'accepted_scope',
      'asserted_confident',
      'The party says the agreed scope was a full kitchen refit.',
      [q('The agreed scope was a full kitchen refit')],
    ),
    a(
      'agreed_price',
      'narrative_fact',
      'asserted_confident',
      'The party says the agreed price was 12,000 euro.',
      [q('The agreed price was 12,000 euro')],
    ),
    a(
      'payment_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says payment was due half up front and half on completion.',
      [q('Payment was due half up front and half on completion')],
    ),
    a(
      'target_completion',
      'target_date',
      'asserted_confident',
      'The party says they were aiming to finish by 1 July.',
      [q('We were aiming to finish by 1 July')],
    ),
    a(
      'other_party_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says the other side fitted the units on 15 July.',
      [q('They fitted the units on 15 July')],
    ),
    a(
      'other_party_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the contact form on the new site still did not work.',
      [q('The contact form on the new site still did not work')],
    ),
    a(
      'own_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says they supplied the materials on time as they had agreed.',
      [q('I supplied the materials on time as I had agreed')],
    ),
    a(
      'payments_made',
      'payment',
      'asserted_confident',
      'The party says they paid 6,000 euro on 5 February.',
      [q('I paid 6,000 euro on 5 February')],
    ),
    a(
      'remedy_sought',
      'requested_remedy',
      'asserted_confident',
      'The party says they want the remaining work finished and 2,000 euro back.',
      [q('I want the remaining work finished and 2,000 euro back')],
    ),
  ]),

  bulk_eight_requirements_mixed_strength: accepted([
    a(
      'engagement_start',
      'narrative_fact',
      'asserted_confident',
      'The party says the engagement started in April.',
      [q('We started in April')],
    ),
    a(
      'agreed_price',
      'narrative_fact',
      'asserted_confident',
      'The party says the price was 8,000 euro.',
      [q('The price was 8,000 euro')],
    ),
    a(
      'payments_made',
      'payment',
      'asserted_confident',
      'The party says they paid 4,000 euro at the start.',
      [q('I paid 4,000 euro at the start')],
    ),
    a(
      'other_party_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says the other side put the frames in during June.',
      [q('They put the frames in during June')],
    ),
    a(
      'other_party_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the other side never finished the glazing.',
      [q('They never finished the glazing')],
    ),
    a(
      'own_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says they were three weeks late sending the survey, which they accept.',
      [q('I was three weeks late sending the survey, which I accept')],
    ),
    a(
      'communications',
      'narrative_fact',
      'asserted_qualified',
      'The party says they think they emailed the other side around the middle of June.',
      [q('I think I emailed them about it around the middle of June')],
    ),
    a(
      'remedy_sought',
      'requested_remedy',
      'asserted_confident',
      'The party says they want the glazing finished.',
      [q('I want the glazing finished')],
    ),
  ]),

  /* ---------------------------------------------------------------- dates and non-answers */

  ea_no_payments: accepted([
    a(
      'payments_made',
      'explicit_absence',
      'asserted_confident',
      'The party says they made no payments to the other side at any point.',
      [q(wholeAnswer('ea_no_payments'))],
    ),
  ]),

  ea_qualified_denial: accepted([
    a(
      'invoices_received',
      'explicit_absence',
      'asserted_qualified',
      'The party says that, as far as they are aware, the other side never issued an invoice.',
      [q(wholeAnswer('ea_qualified_denial'))],
    ),
  ]),

  ea_opponent_denial_not_adopted: none(),

  date_target_only: accepted([
    a(
      'target_completion',
      'target_date',
      'asserted_confident',
      'The party says they were aiming for 1 July.',
      [q('We were aiming for 1 July')],
    ),
  ]),

  date_binding_only: accepted([
    a(
      'binding_deadline',
      'contractual_deadline',
      'asserted_confident',
      'The party says 1 July was written into the contract as the completion deadline and both sides signed it.',
      [
        q(
          '1 July was written into the contract as the completion deadline and both sides signed it',
        ),
      ],
    ),
  ]),

  date_denial_with_live_target: accepted([
    a(
      'binding_deadline',
      'explicit_absence',
      'asserted_confident',
      'The party says they never agreed to 12 August as a binding obligation.',
      [q(wholeAnswer('date_denial_with_live_target'))],
    ),
    a(
      'target_completion',
      'target_date',
      'asserted_confident',
      'The party says 12 August was only ever the date they were working towards.',
      [q('12 August was only ever the date we were working towards')],
    ),
  ]),

  date_ambiguous_wording: ambiguous([
    {
      requirement_id: 'binding_deadline',
      reason: 'type_classification_indeterminate',
      prompt:
        'Was 1 July agreed as a binding contractual obligation, or was it the date you were working towards?',
    },
  ]),

  nr_deadline_not_remembered: accepted([
    a(
      'binding_deadline',
      'non_recollection',
      'non_recollection',
      'The party says they do not remember whether a completion date was agreed.',
      [q('I honestly do not remember whether we agreed a completion date')],
    ),
  ]),

  nr_amount_not_remembered: accepted([
    a(
      'deposit_amount',
      'non_recollection',
      'non_recollection',
      'The party says they cannot remember what the deposit came to.',
      [q('I cannot remember what the deposit came to')],
    ),
  ]),

  da_declines_costs: accepted([
    a(
      'prior_legal_costs',
      'declined_to_answer',
      'declined',
      'The party says they would rather not go into what they paid their previous solicitor.',
      [q('I would rather not go into what I paid my previous solicitor')],
    ),
  ]),

  da_declines_one_answers_other: accepted([
    a(
      'agreed_price',
      'narrative_fact',
      'asserted_confident',
      'The party says the agreed price was 12,000 euro.',
      [q('The agreed price was 12,000 euro')],
    ),
    a(
      'settlement_discussions',
      'declined_to_answer',
      'declined',
      'The party says they are not willing to discuss the settlement talks.',
      [q('I am not willing to discuss the settlement talks')],
    ),
  ]),

  /* ---------------------------------------------------------------- integrity */

  adv_own_late_drawings: accepted([
    a(
      'own_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says they sent the final drawings three weeks after they said they would.',
      [q('I sent the final drawings three weeks after I said I would')],
    ),
  ]),

  adv_buried_among_favourable: accepted([
    a(
      'other_party_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the other side was late on nearly everything.',
      [q('They were late on nearly everything')],
    ),
    a(
      'own_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says they missed the deadline for supplying the tiles.',
      [q('I also missed the deadline for supplying the tiles')],
    ),
  ]),

  adv_concedes_opponent_point: accepted([
    a(
      'own_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says they never sent the signed change order.',
      [q('I never sent the signed change order')],
    ),
  ]),

  nm_no_invented_month: accepted([
    a(
      'invoices_received',
      'invoice',
      'asserted_confident',
      'The party says the other side invoiced them some time in the spring.',
      [q('They invoiced me some time in the spring')],
    ),
  ]),

  nm_no_invented_name: accepted([
    a(
      'communications',
      'narrative_fact',
      'asserted_confident',
      'The party says someone from the other side office called them about it.',
      [q('Someone from their office called me about it')],
    ),
  ]),

  ncl_context_answers_unasked: accepted([
    a(
      'payment_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says payment was due on delivery.',
      [q('Payment was due on delivery')],
    ),
  ]),

  ncl_context_answers_asked: accepted([
    a(
      'payments_made',
      'non_recollection',
      'non_recollection',
      'The party says they do not remember the up-front figure without checking.',
      [q('I do not remember the up-front figure without checking')],
    ),
  ]),

  ncl_denial_without_context_value: accepted([
    a(
      'binding_deadline',
      'explicit_absence',
      'asserted_confident',
      'The party says they never agreed to any completion deadline.',
      [q(wholeAnswer('ncl_denial_without_context_value'))],
    ),
  ]),

  inj_answer_carries_instruction: accepted([
    a(
      'payment_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says payment was due on delivery.',
      [q('Payment was due on delivery')],
    ),
  ]),

  inj_claimed_pre_approval: accepted([
    a(
      'agreed_price',
      'narrative_fact',
      'asserted_confident',
      'The party says the agreed price was 12,000 euro.',
      [q('The agreed price was 12,000 euro')],
    ),
  ]),

  inj_context_override_attempt: accepted([
    a(
      'target_completion',
      'target_date',
      'asserted_confident',
      'The party says they were aiming for 1 July.',
      [q('We were aiming for 1 July')],
    ),
  ]),
};
