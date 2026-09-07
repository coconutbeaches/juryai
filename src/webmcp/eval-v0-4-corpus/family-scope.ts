/**
 * Scope families: `volunteered_unasked_requirement` and `bulk_testimony`.
 *
 * "Ask narrowly, listen broadly." The interviewer paces the questions; the
 * compiler is allowed to hear everything the supplied REQUIREMENTS cover. What
 * these cases exist to separate is LISTENING from AUTHORITY — the two look
 * identical on a case where every volunteered fact happens to have a supplied
 * requirement, and only diverge on `vol_no_supplied_requirement`, where the
 * correct behaviour is to record nothing at all.
 *
 * `vol_ambiguous_unasked` pins the deliberate asymmetry 8C1a chose: clarification
 * targeting stays strict downstream, so ambiguous material about a requirement
 * nobody asked yields neither an assertion NOR a clarification. The interviewer
 * can ask it directly later. The oracle grades clarifications closed-world, so
 * an unsolicited clarification fails the case.
 */

import { evalCase, expectAssertion, req } from './authoring.js';
import type { SemanticEvalCaseV04 } from '../eval-v0-4/types.js';

/**
 * The ten expectations `bulk_ten_requirements` shares across both of its
 * licensed payment-terms shapes. Hoisted so the two alternatives differ in
 * exactly the payment_terms expectation and nothing else.
 */
const BULK_TEN_SHARED = [
  expectAssertion('engaged_feb', 'engagement_start', 'narrative_fact', ['asserted_confident'], {
    statement_mentions: ['3 February'],
  }),
  expectAssertion('scope_refit', 'agreed_scope', 'accepted_scope', ['asserted_confident'], {
    statement_mentions: ['kitchen'],
  }),
  expectAssertion('price_12000', 'agreed_price', 'narrative_fact', ['asserted_confident'], {
    statement_mentions: ['12,000'],
  }),
  expectAssertion('target_july', 'target_completion', 'target_date', ['asserted_confident'], {
    statement_mentions: ['1 July'],
  }),
  expectAssertion(
    'fitted_units',
    'other_party_performance',
    'narrative_fact',
    ['asserted_confident'],
    { statement_mentions: ['15 July'] },
  ),
  expectAssertion(
    'contact_form_broken',
    'other_party_nonperformance',
    'narrative_fact',
    ['asserted_confident'],
    { statement_mentions: ['contact form'] },
  ),
  expectAssertion('own_materials', 'own_performance', 'narrative_fact', ['asserted_confident'], {
    statement_mentions: ['materials'],
  }),
  expectAssertion('paid_6000', 'payments_made', 'payment', ['asserted_confident'], {
    statement_mentions: ['6,000'],
  }),
  // TWO remedies, not one. "the remaining work finished" and "2,000 euro
  // back" can be independently granted or refused, so the decomposition
  // doctrine makes them two propositions. The original single expectation
  // contradicted that doctrine; see the PR body for the disclosed
  // post-freeze correction.
  expectAssertion(
    'remedy_work_finished',
    'remedy_sought',
    'requested_remedy',
    ['asserted_confident'],
    { statement_mentions: ['remaining work'] },
  ),
  expectAssertion(
    'remedy_money_back',
    'remedy_sought',
    'requested_remedy',
    ['asserted_confident'],
    { statement_mentions: ['2,000'] },
  ),
];

export const SCOPE_CASES: SemanticEvalCaseV04[] = [
  evalCase({
    id: 'vol_asked_one_volunteered_two',
    category: 'volunteered_unasked_requirement',
    description: 'Asked about payment terms; volunteers material for two more own requirements.',
    in_reply_to: ['payment_terms'],
    requirement_context: [
      req('payment_terms', 'What were the payment terms?'),
      req('other_party_performance', 'What did the other side actually do?'),
      req('other_party_nonperformance', 'What did the other side fail to do?'),
    ],
    answer:
      'Payment was due on delivery. They delivered on 15 July, and the contact form still did not work.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'terms_on_delivery',
          'payment_terms',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['delivery'] },
        ),
        expectAssertion(
          'delivered_july',
          'other_party_performance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['15 July'] },
        ),
        expectAssertion(
          'contact_form_broken',
          'other_party_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['contact form'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'vol_no_supplied_requirement',
    category: 'volunteered_unasked_requirement',
    description:
      'BREADTH IS NOT AUTHORITY. Volunteered material with no supplied requirement is not recorded.',
    in_reply_to: ['payment_terms'],
    requirement_context: [req('payment_terms', 'What were the payment terms?')],
    answer: 'Payment was due on delivery. They also damaged the hallway wall when they delivered.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'terms_on_delivery',
          'payment_terms',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['delivery'] },
        ),
      ],
      clarifications: [],
      statements_must_not_mention: ['hallway'],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'vol_ambiguous_unasked',
    category: 'volunteered_unasked_requirement',
    description:
      'Ambiguous material about an UNASKED requirement yields no assertion AND no clarification.',
    in_reply_to: ['payment_terms'],
    requirement_context: [
      req('payment_terms', 'What were the payment terms?'),
      req('project_completion', 'Was the project completed?'),
    ],
    answer:
      'Payment was due on delivery. As for finishing, well, it depends what you count as finished.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'terms_on_delivery',
          'payment_terms',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['delivery'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'vol_unasked_different_type',
    category: 'volunteered_unasked_requirement',
    description: 'Volunteered material reaching an unasked requirement of a different type.',
    in_reply_to: ['agreed_scope'],
    requirement_context: [
      req('agreed_scope', 'What work was agreed?', ['accepted_scope', 'narrative_fact']),
      req('payments_made', 'What payments have you made?', ['payment', 'explicit_absence']),
    ],
    answer: 'The agreed scope was the kitchen refit. I paid 2,000 euro up front on 1 March.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('scope_kitchen', 'agreed_scope', 'accepted_scope', ['asserted_confident'], {
          statement_mentions: ['kitchen'],
        }),
        expectAssertion('upfront_2000', 'payments_made', 'payment', ['asserted_confident'], {
          statement_mentions: ['2,000'],
        }),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'bulk_ten_requirements',
    category: 'bulk_testimony',
    description:
      'Three requirements asked; the answer clearly addresses ten supplied own requirements.',
    in_reply_to: ['agreed_scope', 'agreed_price', 'payment_terms'],
    requirement_context: [
      req('engagement_start', 'When did the engagement begin?'),
      req('agreed_scope', 'What work was agreed?', ['accepted_scope', 'narrative_fact']),
      req('agreed_price', 'What price was agreed?', ['narrative_fact']),
      req('payment_terms', 'What were the payment terms?'),
      // ['target_date'] only, matching every other target_completion
      // requirement in the corpus.
      req('target_completion', 'What completion date were you aiming for?', ['target_date']),
      req('other_party_performance', 'What did the other side actually do?'),
      req('other_party_nonperformance', 'What did the other side fail to do?'),
      req('own_performance', 'What did you do or fail to do?'),
      req('payments_made', 'What payments have you made?', ['payment', 'explicit_absence']),
      req('remedy_sought', 'What outcome are you seeking?', ['requested_remedy']),
    ],
    answer:
      'We engaged them on 3 February. The agreed scope was a full kitchen refit. The agreed price was 12,000 euro. Payment was due half up front and half on completion. We were aiming to finish by 1 July. They fitted the units on 15 July. The contact form on the new site still did not work. I supplied the materials on time as I had agreed. I paid 6,000 euro on 5 February. I want the remaining work finished and 2,000 euro back.',
    // MERGED or SPLIT payment terms, never both.
    //
    // "Payment was due half up front and half on completion" carries two
    // clauses that can be independently true or false and describe two
    // independently material obligations — the same independence test this
    // case already applies to the two remedies one sentence later. So both a
    // single combined proposition and two separate ones are doctrinally
    // licensed, and pinning either would hard-fail a compliant compiler.
    //
    // Expressed as whole-output alternatives rather than an optional extra
    // expectation, because each branch is closed-world: output carrying BOTH
    // shapes satisfies neither.
    expect: {
      any_of: [
        {
          verdict: 'accepted_candidates',
          assertions: [
            ...BULK_TEN_SHARED,
            expectAssertion(
              'terms_half',
              'payment_terms',
              'narrative_fact',
              ['asserted_confident'],
              { statement_mentions: ['half'] },
            ),
          ],
          clarifications: [],
          forbid_supersession: true,
        },
        {
          verdict: 'accepted_candidates',
          assertions: [
            ...BULK_TEN_SHARED,
            expectAssertion(
              'terms_up_front',
              'payment_terms',
              'narrative_fact',
              ['asserted_confident'],
              { statement_mentions: ['up front'] },
            ),
            expectAssertion(
              'terms_on_completion',
              'payment_terms',
              'narrative_fact',
              ['asserted_confident'],
              { statement_mentions: ['completion'] },
            ),
          ],
          clarifications: [],
          forbid_supersession: true,
        },
      ],
    },
  }),

  evalCase({
    id: 'bulk_eight_requirements_mixed_strength',
    category: 'bulk_testimony',
    description:
      'Bulk testimony across eight supplied requirements, carrying mixed epistemic strengths.',
    in_reply_to: ['other_party_nonperformance', 'own_performance'],
    requirement_context: [
      req('engagement_start', 'When did the engagement begin?'),
      req('agreed_price', 'What price was agreed?'),
      req('payments_made', 'What payments have you made?', ['payment', 'explicit_absence']),
      req('other_party_performance', 'What did the other side actually do?'),
      req('other_party_nonperformance', 'What did the other side fail to do?'),
      req('own_performance', 'What did you do or fail to do?'),
      req('communications', 'What communications passed between you?'),
      req('remedy_sought', 'What outcome are you seeking?', ['requested_remedy']),
    ],
    answer:
      'We started in April. The price was 8,000 euro. I paid 4,000 euro at the start. They put the frames in during June. They never finished the glazing. I was three weeks late sending the survey, which I accept. I think I emailed them about it around the middle of June. I want the glazing finished.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'started_april',
          'engagement_start',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['April'] },
        ),
        expectAssertion('price_8000', 'agreed_price', 'narrative_fact', ['asserted_confident'], {
          statement_mentions: ['8,000'],
        }),
        expectAssertion('paid_4000', 'payments_made', 'payment', ['asserted_confident'], {
          statement_mentions: ['4,000'],
        }),
        expectAssertion(
          'frames_june',
          'other_party_performance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['frames'] },
        ),
        expectAssertion(
          'glazing_unfinished',
          'other_party_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['glazing'] },
        ),
        expectAssertion(
          'own_late_survey',
          'own_performance',
          'narrative_fact',
          ['asserted_confident'],
          {
            statement_mentions: ['three weeks'],
            // This adverse expectation had NO polarity guard at all: a
            // statement saying the survey went out three weeks EARLY carried
            // the requirement, type, strength and literal and graded green.
            statement_must_not_mention: ['weeks early', 'weeks before', 'ahead of', 'on time'],
            material_adverse_fact: true,
          },
        ),
        expectAssertion(
          'emailed_june',
          'communications',
          'narrative_fact',
          ['asserted_qualified', 'recalled_uncertain'],
          { statement_mentions: ['June'] },
        ),
        expectAssertion(
          'remedy_glazing',
          'remedy_sought',
          'requested_remedy',
          ['asserted_confident'],
          { statement_mentions: ['glazing'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),
];
