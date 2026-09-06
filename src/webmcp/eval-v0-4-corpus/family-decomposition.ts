/**
 * Decomposition families: `same_type_multi_fact` and `same_type_mixed_strength`.
 *
 * This is the corpus half of the production defect 8C1a was built to fix. Under
 * V0.3 a single requirement/type slot could hold one proposition, so the
 * compiler was instructed to MERGE compatible same-slot facts — which made a
 * stated fact plus the speaker's own assessment of it unrepresentable, and
 * silently collapsed several distinct events into one sentence.
 *
 * The oracle can express these because expectations are matched one-to-one:
 * two expectations sharing requirement, type AND strength stay two
 * expectations, and one merged assertion can satisfy at most one of them.
 *
 * `mf_one_coherent_fact` is the counterweight. Every other case here fails if
 * the model merges; that one fails if the model atomises. Without it a corpus
 * that rewards decomposition would quietly reward maximum assertion count,
 * which is a different failure with the same score.
 */

import { evalCase, expectAssertion, req } from './authoring.js';
import type { SemanticEvalCaseV04 } from '../eval-v0-4/types.js';

export const DECOMPOSITION_CASES: SemanticEvalCaseV04[] = [
  evalCase({
    id: 'mf_two_events_same_slot',
    category: 'same_type_multi_fact',
    description:
      'Two independently material events under one requirement, sharing type and strength.',
    in_reply_to: ['other_party_performance'],
    requirement_context: [
      req('other_party_performance', 'What did the other side actually do, and when?'),
    ],
    answer: 'They fitted the cabinets on 15 July, and they took the old units away on 18 July.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'fitted_cabinets',
          'other_party_performance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['15 July'] },
        ),
        expectAssertion(
          'removed_units',
          'other_party_performance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['18 July'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'mf_three_deficiencies',
    category: 'same_type_multi_fact',
    description: 'Three distinct deficiencies under one requirement, sharing type and strength.',
    in_reply_to: ['other_party_nonperformance'],
    requirement_context: [req('other_party_nonperformance', 'What did the other side fail to do?')],
    answer:
      'The contact form still did not work, the mobile layout was never finished, and the checkout page returned an error.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'contact_form',
          'other_party_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['contact form'] },
        ),
        expectAssertion(
          'mobile_layout',
          'other_party_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['mobile layout'] },
        ),
        expectAssertion(
          'checkout_page',
          'other_party_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['checkout'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'mf_two_payments_same_type',
    category: 'same_type_multi_fact',
    description: 'Two payments of different amounts and dates under one requirement.',
    in_reply_to: ['payments_made'],
    requirement_context: [
      req('payments_made', 'What payments have you made?', ['payment', 'explicit_absence']),
    ],
    answer: 'I paid a deposit of 500 euro in March and a further 250 euro in April.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('deposit_500', 'payments_made', 'payment', ['asserted_confident'], {
          statement_mentions: ['500'],
        }),
        expectAssertion('further_250', 'payments_made', 'payment', ['asserted_confident'], {
          statement_mentions: ['250'],
        }),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'mf_one_coherent_fact',
    category: 'same_type_multi_fact',
    description:
      'ANTI-SPLIT. One event carrying a condition and a date is ONE proposition, not three.',
    in_reply_to: ['delivery_condition'],
    requirement_context: [req('delivery_condition', 'What arrived, in what condition, and when?')],
    answer: 'The badly damaged oak table arrived late on 3 March.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'damaged_table',
          'delivery_condition',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['3 March'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'mf_same_requirement_two_types',
    category: 'same_type_multi_fact',
    description: 'One requirement carrying two facts of different canonical types.',
    in_reply_to: ['billing_history'],
    requirement_context: [
      req('billing_history', 'What was invoiced and what was paid?', [
        'invoice',
        'payment',
        'explicit_absence',
      ]),
    ],
    answer: 'I sent invoice 118 on 2 May for 1,200 euro, and they paid 400 euro on 30 May.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('invoice_118', 'billing_history', 'invoice', ['asserted_confident'], {
          statement_mentions: ['118'],
        }),
        expectAssertion('paid_400', 'billing_history', 'payment', ['asserted_confident'], {
          statement_mentions: ['400'],
        }),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ms_fact_plus_own_assessment',
    category: 'same_type_mixed_strength',
    description:
      'THE PRODUCTION REGRESSION SHAPE. A fact stated as fact plus the speaker own assessment of it.',
    in_reply_to: ['other_party_nonperformance'],
    requirement_context: [
      req('other_party_nonperformance', 'What did the other side fail to do, and what followed?'),
    ],
    answer:
      'The delivery was late, and in my own assessment that lateness is what cost me the Henley contract.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'lateness_fact',
          'other_party_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['late'] },
        ),
        expectAssertion(
          'causation_assessment',
          'other_party_nonperformance',
          'narrative_fact',
          ['asserted_qualified'],
          { statement_mentions: ['Henley'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ms_confident_plus_recalled',
    category: 'same_type_mixed_strength',
    description: 'A confidently stated date and an explicitly uncertain recollection.',
    in_reply_to: ['engagement_timeline'],
    requirement_context: [req('engagement_timeline', 'What happened, and when?')],
    answer:
      'I signed the agreement on 4 June. I think the site visit was about a week later, but I am not certain.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'signed_agreement',
          'engagement_timeline',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['4 June'] },
        ),
        expectAssertion(
          'site_visit',
          'engagement_timeline',
          'narrative_fact',
          ['recalled_uncertain', 'asserted_qualified'],
          { statement_mentions: ['site visit'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ms_three_strengths',
    category: 'same_type_mixed_strength',
    description: 'Three facts under one requirement at three different epistemic strengths.',
    in_reply_to: ['property_condition'],
    requirement_context: [req('property_condition', 'What was wrong with the property?')],
    answer:
      'The roof leaked in January. I am fairly sure the repair quote was around 3,000 euro. I remember someone from the agency visiting, but I could not say when.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'roof_leak',
          'property_condition',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['January'] },
        ),
        expectAssertion(
          'repair_quote',
          'property_condition',
          'narrative_fact',
          ['asserted_qualified'],
          { statement_mentions: ['3,000'] },
        ),
        expectAssertion(
          'agency_visit',
          'property_condition',
          'narrative_fact',
          ['recalled_uncertain'],
          { statement_mentions: ['agency'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ms_flattening_trap',
    category: 'same_type_mixed_strength',
    description:
      'A confident fact and an explicitly held view in one sentence; flattening either is a blocker.',
    in_reply_to: ['other_party_nonperformance'],
    requirement_context: [
      req('other_party_nonperformance', 'What did the other side do or fail to do?'),
    ],
    answer:
      'They never returned my calls, which in my view shows they had already decided to walk away.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'no_returned_calls',
          'other_party_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['calls'] },
        ),
        expectAssertion(
          'walk_away_view',
          'other_party_nonperformance',
          'narrative_fact',
          ['asserted_qualified'],
          { statement_mentions: ['walk away'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),
];
