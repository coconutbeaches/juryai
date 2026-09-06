/**
 * Scripted provider completions for the holdout corpus.
 *
 * Same purpose and same limits as the primary fixtures: they prove the
 * holdout is internally consistent, that every declared citation resolves
 * against the stored turn, and that every expectation is satisfiable by output
 * the V0.4 contract admits. They are NOT model evidence.
 *
 * Verified offline BEFORE the single live holdout run, so a harness or fixture
 * mistake cannot consume the one run this corpus gets.
 */

import { HOLDOUT_CORPUS } from './holdout.js';
import type { OfflineDraft, OfflineAssertion, OfflineCitation } from './offline-completions.js';

const answerOf = new Map(HOLDOUT_CORPUS.map((item) => [item.id, item.answer]));

function wholeAnswer(caseId: string): string {
  const text = answerOf.get(caseId);
  if (text === undefined) throw new TypeError(`no holdout case '${caseId}'`);
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

export const HOLDOUT_OFFLINE_COMPLETIONS: Record<string, OfflineDraft> = {
  ho_two_events_same_slot: accepted([
    a(
      'supplier_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says the van was returned on 9 October.',
      [q('The van was returned on 9 October')],
    ),
    a(
      'supplier_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says the spare key was handed back on 11 October.',
      [q('the spare key was handed back on 11 October')],
    ),
  ]),

  ho_three_deficiencies: accepted([
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the rear door still rattled.',
      [q('The rear door still rattled')],
    ),
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the paintwork was never buffed.',
      [q('the paintwork was never buffed')],
    ),
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the service light stayed on.',
      [q('the service light stayed on')],
    ),
  ]),

  ho_one_coherent_fact: accepted([
    a(
      'goods_condition',
      'narrative_fact',
      'asserted_confident',
      'The party says the heavily scratched display cabinet turned up on 6 June.',
      [q(wholeAnswer('ho_one_coherent_fact'))],
    ),
  ]),

  ho_fact_plus_assessment: accepted([
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the album arrived four months late.',
      [q('The album arrived four months late')],
    ),
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_qualified',
      'The party says, as their own view, that the delay is why their parents never got to see the album.',
      [q('to my mind that is why my parents never got to see it')],
    ),
  ]),

  ho_confident_plus_recalled: accepted([
    a(
      'engagement_timeline',
      'narrative_fact',
      'asserted_confident',
      'The party says they booked the studio on 2 April.',
      [q('I booked the studio on 2 April')],
    ),
    a(
      'engagement_timeline',
      'narrative_fact',
      'recalled_uncertain',
      'The party recalls the deposit going out later that same week but would not swear to it.',
      [q('I think the deposit went out later that same week, though I would not swear to it')],
    ),
  ]),

  ho_volunteered_two_more: accepted([
    a(
      'hire_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says the hire was for three days at 90 euro a day.',
      [q('The hire was for three days at 90 euro a day')],
    ),
    a(
      'supplier_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says the supplier dropped the scaffold off on 4 May.',
      [q('They dropped the scaffold off on 4 May')],
    ),
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the safety certificate never turned up.',
      [q('the safety certificate never turned up')],
    ),
  ]),

  ho_breadth_is_not_authority: accepted([
    a(
      'hire_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says the hire was for three days at 90 euro a day.',
      [q('The hire was for three days at 90 euro a day')],
    ),
  ]),

  ho_bulk_eight: accepted([
    a(
      'engagement_start',
      'narrative_fact',
      'asserted_confident',
      'The party says the engagement started on 12 January.',
      [q('We started on 12 January')],
    ),
    a(
      'agreed_price',
      'narrative_fact',
      'asserted_confident',
      'The party says the price was 3,400 euro.',
      [q('The price was 3,400 euro')],
    ),
    a(
      'hire_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says the hire ran for two weeks.',
      [q('The hire ran for two weeks')],
    ),
    a(
      'payments_made',
      'payment',
      'asserted_confident',
      'The party says they paid 1,700 euro on the first day.',
      [q('I paid 1,700 euro on the first day')],
    ),
    a(
      'supplier_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says the supplier delivered the press on 20 January.',
      [q('They delivered the press on 20 January')],
    ),
    a(
      'supplier_nonperformance',
      'narrative_fact',
      'asserted_confident',
      'The party says the supplier never supplied the ink cartridges.',
      [q('They never supplied the ink cartridges')],
    ),
    a(
      'own_performance',
      'narrative_fact',
      'asserted_confident',
      'The party says they signed the collection note when they said they would.',
      [q('I signed the collection note when I said I would')],
    ),
    a(
      'remedy_sought',
      'requested_remedy',
      'asserted_confident',
      'The party says they want the cartridges supplied.',
      [q('I want the cartridges supplied')],
    ),
  ]),

  ho_exact_supersession: accepted([
    a(
      'project_money',
      'payment',
      'asserted_confident',
      'The party says the first stage payment was 1,750 euro.',
      [q('the first stage payment was 1,750 euro')],
      'prop_first_stage',
    ),
  ]),

  ho_append_not_supersede: accepted([
    a(
      'project_money',
      'payment',
      'asserted_confident',
      'The party says a delivery fee of 120 euro was paid on the same invoice.',
      [q(wholeAnswer('ho_append_not_supersede'))],
    ),
  ]),

  ho_pure_restatement: none(),

  ho_context_laundering: accepted([
    a(
      'hire_terms',
      'narrative_fact',
      'asserted_confident',
      'The party says the hire was for three days at 90 euro a day.',
      [q(wholeAnswer('ho_context_laundering'))],
    ),
  ]),

  ho_target_not_deadline: accepted([
    a(
      'target_completion',
      'target_date',
      'asserted_confident',
      'The party says they were hoping to have it wrapped up by 20 September.',
      [q(wholeAnswer('ho_target_not_deadline'))],
    ),
  ]),
};
