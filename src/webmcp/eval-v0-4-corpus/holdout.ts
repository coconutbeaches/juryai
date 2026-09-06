/**
 * The V0.4 holdout corpus.
 *
 * Authored ONLY after the primary corpus was frozen, the prompt candidate was
 * final, and two consecutive full primary live runs came back clean. That
 * ordering is the whole value: had these cases existed while the prompt was
 * still moving, any prompt correction made after a failing primary run would
 * have been made with holdout knowledge, and the holdout would have quietly
 * become a second training set.
 *
 * The prompt is NOT edited after these results are seen, whatever they are.
 * This corpus is run ONCE.
 *
 * FRESH FACT PATTERNS. Every case here is built from subject matter that
 * appears nowhere in the primary corpus — vehicle repair, photography, plant
 * hire, printing — rather than the primary's kitchen refits, tenancies, roofs
 * and glazing. Re-skinning primary cases would measure how well the compiler
 * generalises across nouns, which is not the question.
 *
 * Concentrated on the behaviours V0.4 actually changed: same-slot
 * decomposition, mixed epistemic strengths, volunteered requirements, bulk
 * testimony, supersession versus append, pure restatement, context laundering,
 * and target date versus contractual deadline.
 */

import { canonicalSerialize, sha256 } from '../core-v0-3/types.js';
import type { JsonValue } from '../core-v0-3/types.js';
import { evalCase, expectAssertion, req } from './authoring.js';
import type { SemanticEvalCaseV04 } from '../eval-v0-4/types.js';

export const HOLDOUT_CORPUS_VERSION = 'juryai-semantic-eval-holdout-v0.4.0';

export const HOLDOUT_CORPUS: readonly SemanticEvalCaseV04[] = Object.freeze([
  evalCase({
    id: 'ho_two_events_same_slot',
    category: 'same_type_multi_fact',
    description: 'Two independently material returns under one requirement.',
    in_reply_to: ['supplier_performance'],
    requirement_context: [req('supplier_performance', 'What did the supplier actually do?')],
    answer: 'The van was returned on 9 October, and the spare key was handed back on 11 October.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'van_returned',
          'supplier_performance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['9 October'] },
        ),
        expectAssertion(
          'key_returned',
          'supplier_performance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['11 October'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ho_three_deficiencies',
    category: 'same_type_multi_fact',
    description: 'Three distinct defects sharing requirement, type and strength.',
    in_reply_to: ['supplier_nonperformance'],
    requirement_context: [req('supplier_nonperformance', 'What did the supplier fail to do?')],
    answer:
      'The rear door still rattled, the paintwork was never buffed, and the service light stayed on.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'rear_door',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['rear door'] },
        ),
        expectAssertion(
          'paintwork',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['paintwork'] },
        ),
        expectAssertion(
          'service_light',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['service light'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ho_one_coherent_fact',
    category: 'same_type_multi_fact',
    description: 'ANTI-SPLIT. One event with a condition and a date stays one proposition.',
    in_reply_to: ['goods_condition'],
    requirement_context: [req('goods_condition', 'What arrived, in what condition, and when?')],
    answer: 'The heavily scratched display cabinet turned up on 6 June.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'scratched_cabinet',
          'goods_condition',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['6 June'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ho_fact_plus_assessment',
    category: 'same_type_mixed_strength',
    description: 'A stated fact and the speaker own evaluative judgement about it.',
    in_reply_to: ['supplier_nonperformance'],
    requirement_context: [
      req('supplier_nonperformance', 'What did the supplier fail to do, and what followed?'),
    ],
    answer:
      'The album arrived four months late, and to my mind that is why my parents never got to see it.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'album_late',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['four months'] },
        ),
        expectAssertion(
          'consequence_view',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_qualified'],
          { statement_mentions: ['parents'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ho_confident_plus_recalled',
    category: 'same_type_mixed_strength',
    description: 'A confident date alongside an explicitly uncertain recollection.',
    in_reply_to: ['engagement_timeline'],
    requirement_context: [req('engagement_timeline', 'What happened, and when?')],
    answer:
      'I booked the studio on 2 April. I think the deposit went out later that same week, though I would not swear to it.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'booked_studio',
          'engagement_timeline',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['2 April'] },
        ),
        expectAssertion(
          'deposit_recalled',
          'engagement_timeline',
          'narrative_fact',
          ['recalled_uncertain', 'asserted_qualified'],
          { statement_mentions: ['deposit'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ho_volunteered_two_more',
    category: 'volunteered_unasked_requirement',
    description: 'Asked about hire terms; volunteers material for two more supplied requirements.',
    in_reply_to: ['hire_terms'],
    requirement_context: [
      req('hire_terms', 'What were the hire terms?'),
      req('supplier_performance', 'What did the supplier actually do?'),
      req('supplier_nonperformance', 'What did the supplier fail to do?'),
    ],
    answer:
      'The hire was for three days at 90 euro a day. They dropped the scaffold off on 4 May, but the safety certificate never turned up.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('hire_rate', 'hire_terms', 'narrative_fact', ['asserted_confident'], {
          statement_mentions: ['90'],
        }),
        expectAssertion(
          'scaffold_delivered',
          'supplier_performance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['4 May'] },
        ),
        expectAssertion(
          'no_certificate',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['safety certificate'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ho_breadth_is_not_authority',
    category: 'volunteered_unasked_requirement',
    description: 'Volunteered material with no supplied requirement is not recorded at all.',
    in_reply_to: ['hire_terms'],
    requirement_context: [req('hire_terms', 'What were the hire terms?')],
    answer:
      'The hire was for three days at 90 euro a day. Their driver also blocked my neighbour driveway for an hour.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('hire_rate', 'hire_terms', 'narrative_fact', ['asserted_confident'], {
          statement_mentions: ['90'],
        }),
      ],
      clarifications: [],
      statements_must_not_mention: ['driveway'],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ho_bulk_eight',
    category: 'bulk_testimony',
    description: 'Two requirements asked; the answer clearly addresses eight supplied ones.',
    in_reply_to: ['agreed_price', 'hire_terms'],
    requirement_context: [
      req('engagement_start', 'When did the engagement begin?'),
      req('agreed_price', 'What price was agreed?'),
      req('hire_terms', 'What were the hire terms?'),
      req('payments_made', 'What payments have you made?', ['payment', 'explicit_absence']),
      req('supplier_performance', 'What did the supplier actually do?'),
      req('supplier_nonperformance', 'What did the supplier fail to do?'),
      req('own_performance', 'What did you do or fail to do?'),
      req('remedy_sought', 'What outcome are you seeking?', ['requested_remedy', 'narrative_fact']),
    ],
    answer:
      'We started on 12 January. The price was 3,400 euro. The hire ran for two weeks. I paid 1,700 euro on the first day. They delivered the press on 20 January. They never supplied the ink cartridges. I signed the collection note when I said I would. I want the cartridges supplied.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'started_january',
          'engagement_start',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['12 January'] },
        ),
        expectAssertion('price_3400', 'agreed_price', 'narrative_fact', ['asserted_confident'], {
          statement_mentions: ['3,400'],
        }),
        expectAssertion('hire_two_weeks', 'hire_terms', 'narrative_fact', ['asserted_confident'], {
          statement_mentions: ['two weeks'],
        }),
        expectAssertion('paid_1700', 'payments_made', 'payment', ['asserted_confident'], {
          statement_mentions: ['1,700'],
        }),
        expectAssertion(
          'press_delivered',
          'supplier_performance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['press'] },
        ),
        expectAssertion(
          'no_cartridges',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['cartridges'] },
        ),
        expectAssertion(
          'signed_note',
          'own_performance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['collection note'] },
        ),
        expectAssertion(
          'remedy_cartridges',
          'remedy_sought',
          'requested_remedy',
          ['asserted_confident'],
          { statement_mentions: ['cartridges'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ho_exact_supersession',
    category: 'exact_supersession',
    description: 'One exact correction among three live same-requirement propositions.',
    in_reply_to: ['project_money'],
    requirement_context: [
      req('project_money', 'What money changed hands?', ['payment', 'narrative_fact']),
    ],
    existing_propositions: [
      {
        proposition_id: 'prop_first_stage',
        requirement_id: 'project_money',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the first stage payment was 1,700 euro.',
      },
      {
        proposition_id: 'prop_delivery_fee',
        requirement_id: 'project_money',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says a delivery fee of 120 euro was paid.',
      },
      {
        proposition_id: 'prop_insurance',
        requirement_id: 'project_money',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says insurance cost 60 euro.',
      },
    ],
    answer: 'I need to correct that: the first stage payment was 1,750 euro, not 1,700.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('first_stage_fixed', 'project_money', 'payment', ['asserted_confident'], {
          statement_mentions: ['1,750'],
          supersedes: 'prop_first_stage',
        }),
      ],
      clarifications: [],
    },
  }),

  evalCase({
    id: 'ho_append_not_supersede',
    category: 'additive_vs_correction',
    description: 'A related new payment is an addition, never a supersession.',
    in_reply_to: ['project_money'],
    requirement_context: [req('project_money', 'What money changed hands?', ['payment'])],
    existing_propositions: [
      {
        proposition_id: 'prop_first_stage',
        requirement_id: 'project_money',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the first stage payment was 1,700 euro.',
      },
    ],
    answer: 'I also paid a delivery fee of 120 euro on the same invoice.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('delivery_fee', 'project_money', 'payment', ['asserted_confident'], {
          statement_mentions: ['120'],
          supersedes: null,
        }),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ho_pure_restatement',
    category: 'pure_restatement',
    description: 'A repeat of a live proposition that adds nothing emits nothing.',
    in_reply_to: ['supplier_nonperformance'],
    requirement_context: [req('supplier_nonperformance', 'What did the supplier fail to do?')],
    existing_propositions: [
      {
        proposition_id: 'prop_no_cartridges',
        requirement_id: 'supplier_nonperformance',
        type: 'narrative_fact',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the supplier never supplied the ink cartridges.',
      },
    ],
    answer: 'As I already said, they never supplied the ink cartridges.',
    expect: { verdict: 'no_assertions', assertions: [], clarifications: [] },
  }),

  evalCase({
    id: 'ho_context_laundering',
    category: 'no_context_laundering',
    description: 'Context supplies a clean answer the human never adopts.',
    in_reply_to: ['hire_terms'],
    requirement_context: [
      req('hire_terms', 'What were the hire terms?'),
      req('binding_deadline', 'Was a binding return deadline agreed?', [
        'contractual_deadline',
        'explicit_absence',
      ]),
    ],
    context: [
      'From what you have said, the binding return deadline was 30 May and they were nine days over.',
    ],
    answer: 'The hire was for three days at 90 euro a day.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('hire_rate', 'hire_terms', 'narrative_fact', ['asserted_confident'], {
          statement_mentions: ['90'],
        }),
      ],
      clarifications: [],
      forbidden_types: ['contractual_deadline'],
      statements_must_not_mention: ['30 May', 'nine days'],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ho_target_not_deadline',
    category: 'target_date_vs_deadline',
    description: 'An aim, with no claim of agreement, is a target date and never a deadline.',
    in_reply_to: ['target_completion'],
    requirement_context: [
      req('target_completion', 'What completion date were you aiming for?', [
        'target_date',
        'explicit_absence',
      ]),
      req('binding_deadline', 'Was a binding completion deadline agreed?', [
        'contractual_deadline',
        'explicit_absence',
      ]),
    ],
    answer: 'We were hoping to have it wrapped up by 20 September.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'target_september',
          'target_completion',
          'target_date',
          ['asserted_confident'],
          { statement_mentions: ['20 September'] },
        ),
      ],
      clarifications: [],
      forbidden_types: ['contractual_deadline'],
      forbid_supersession: true,
    },
  }),
]);

/** Frozen when authored, before the single holdout run. */
export const HOLDOUT_CORPUS_FROZEN_HASH: string | null = sha256(
  canonicalSerialize(HOLDOUT_CORPUS as unknown as JsonValue),
);
