/**
 * Scripted provider completions for holdout v0.4.1.
 *
 * Same purpose and limits as the primary fixtures: they prove the holdout is
 * internally consistent, that every declared citation resolves against the
 * stored turn, and that every expectation is satisfiable by output the V0.4
 * contract admits. They are NOT model evidence.
 *
 * Verified offline BEFORE the single live run, so no fixture or harness mistake
 * can consume the one run this corpus gets — which is exactly how v0.4.0 was
 * lost.
 *
 * Where a case's audit found two legitimate readings, the fixture takes one of
 * them; the optional expectation covers the other.
 */

import { HOLDOUT_V041 } from './holdout-v041.js';
import type { OfflineDraft, OfflineAssertion, OfflineCitation } from './offline-completions.js';

const answerOf = new Map(HOLDOUT_V041.map((item) => [item.id, item.answer]));

function wholeAnswer(caseId: string): string {
  const text = answerOf.get(caseId);
  if (text === undefined) throw new TypeError(`no holdout v0.4.1 case '${caseId}'`);
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

export const HOLDOUT_V041_COMPLETIONS: Record<string, OfflineDraft> = {
  nh_duration_and_rate: accepted([
    a(
      'engagement_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says the crew worked eleven days.',
      [q('The crew worked eleven days')],
    ),
    a(
      'engagement_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says the rate was 240 euro a day.',
      [q('at 240 euro a day')],
    ),
  ]),

  nh_two_payments: accepted([
    a(
      'payments_made',
      'payment',
      'asserted_confident',
      'The party says they paid 1,200 euro on 3 March.',
      [q('I paid 1,200 euro on 3 March')],
    ),
    a(
      'payments_made',
      'payment',
      'asserted_confident',
      'The party says they paid the balance of 800 euro on 17 April.',
      [q('the balance of 800 euro on 17 April')],
    ),
  ]),

  nh_performance_and_nonperformance: accepted([
    a(
      'contractor_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says the contractor laid the whole terrace by 12 June.',
      [q('They laid the whole terrace by 12 June')],
    ),
    a(
      'contractor_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the drainage channel was never connected.',
      [q('the drainage channel was never connected')],
    ),
  ]),

  nh_fact_and_judgement: accepted([
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the marquee collapsed during the reception.',
      [q('The marquee collapsed during the reception')],
    ),
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_qualified',
      'The party says, as their own judgement, that the collapse turned the evening into a write-off.',
      [q('in my judgement that is what turned the evening into a write-off')],
    ),
  ]),

  nh_event_and_timing_uncertainty: accepted([
    a(
      'supplier_performance',
      'narrative_fact',
      'recalled_uncertain',
      'The party recalls that a technician came out to look at the oven but could not say which week.',
      [q(wholeAnswer('nh_event_and_timing_uncertainty'))],
    ),
  ]),

  nh_three_defects: accepted([
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the subtitles were out of sync.',
      [q('The subtitles were out of sync')],
    ),
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the glossary was missing.',
      [q('the glossary was missing')],
    ),
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says two chapters were left untranslated.',
      [q('two chapters were left untranslated')],
    ),
  ]),

  nh_two_remedies: accepted([
    a(
      'remedy_sought',
      'requested_remedy',
      'asserted_confident',
      'The party says they want the two chapters translated.',
      [q('I want the two chapters translated')],
    ),
    a(
      'remedy_sought',
      'requested_remedy',
      'asserted_confident',
      'The party says they want their 600 euro deposit returned.',
      [q('my 600 euro deposit returned')],
    ),
  ]),

  nh_adverse_among_favourable: accepted([
    a(
      'contractor_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the contractor missed almost every milestone.',
      [q('They missed almost every milestone')],
    ),
    a(
      'own_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says they changed the specification twice after signing.',
      [q('I also changed the specification twice after we had signed')],
    ),
  ]),

  nh_explicit_absence: accepted([
    a(
      'deposit_paid',
      'explicit_absence',
      'asserted_confident',
      'The party says no deposit was ever taken from them for the container.',
      [q(wholeAnswer('nh_explicit_absence'))],
    ),
  ]),

  nh_non_recollection: accepted([
    a(
      'demurrage_charge',
      'non_recollection',
      'non_recollection',
      'The party says they could not tell what the demurrage charge came to.',
      [q(wholeAnswer('nh_non_recollection'))],
    ),
  ]),

  nh_declined_and_answered: accepted([
    a(
      'insurance_cover',
      'narrative_fact',
      'asserted_confident',
      'The party says the cargo was insured for 40,000 euro.',
      [q('The cargo was insured for 40,000 euro')],
    ),
    a(
      'settlement_discussions',
      'declined_to_answer',
      'declined',
      'The party says they are not going to discuss the without-prejudice calls.',
      [q('I am not going to discuss the without-prejudice calls')],
    ),
  ]),

  nh_exact_correction: accepted([
    a(
      'repair_costs',
      'payment',
      'asserted_confident',
      'The party says the bridge fitting was 165 euro.',
      [q('the bridge fitting was 165 euro')],
      'prop_bridge_fitting',
    ),
  ]),

  nh_additive_not_correction: accepted([
    a(
      'repair_costs',
      'payment',
      'asserted_confident',
      'The party says there was also a soundpost adjustment at 45 euro.',
      [q(wholeAnswer('nh_additive_not_correction'))],
    ),
  ]),

  nh_context_only_facts: accepted([
    a(
      'licence_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says the licence ran for a three-year term.',
      [q(wholeAnswer('nh_context_only_facts'))],
    ),
  ]),

  nh_anti_split_control: accepted([
    a(
      'goods_condition',
      'narrative_fact',
      'asserted_confident',
      'The party says the severely rusted trailer axle arrived on 8 August.',
      [q(wholeAnswer('nh_anti_split_control'))],
    ),
  ]),
};
