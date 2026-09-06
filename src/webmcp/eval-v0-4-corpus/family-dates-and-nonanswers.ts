/**
 * `explicit_absence`, `target_date_vs_deadline`, `non_recollection` and
 * `declined_answer`.
 *
 * These are the V0.3 safety doctrine, carried into V0.4 unchanged and re-proved
 * rather than assumed. Decomposition and broad listening both widen what the
 * compiler may emit, and a widened compiler is exactly where a previously safe
 * rule quietly stops holding — so the corpus re-tests them under the new
 * doctrine instead of trusting that nothing moved.
 *
 * The date family is the one with a production history: a target date silently
 * promoted to a contractual deadline is a manufactured legal obligation. All
 * four readings are represented — target only, binding only, explicit denial of
 * binding alongside a live target, and genuinely ambiguous wording that must
 * fail closed rather than resolve to the more likely reading.
 *
 * Note the contract requirement these cases have to satisfy: an
 * `explicit_absence` assertion must cite the COMPLETE answer as one span,
 * including the negative wording, any qualification and the attribution. So
 * every denial here is authored as a self-contained answer.
 */

import { evalCase, expectAssertion, req } from './authoring.js';
import type { SemanticEvalCaseV04 } from '../eval-v0-4/types.js';

export const DATES_AND_NONANSWERS_CASES: SemanticEvalCaseV04[] = [
  evalCase({
    id: 'ea_no_payments',
    category: 'explicit_absence',
    description: 'A plain affirmative denial that any payment was made.',
    in_reply_to: ['payments_made'],
    requirement_context: [
      req('payments_made', 'What payments have you made?', ['payment', 'explicit_absence']),
    ],
    answer: 'I made no payments to them at any point.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'no_payments',
          'payments_made',
          'explicit_absence',
          ['asserted_confident'],
          { statement_mentions: ['payment'] },
        ),
      ],
      clarifications: [],
      forbidden_types: ['payment'],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ea_qualified_denial',
    category: 'explicit_absence',
    description: 'A qualified denial keeps its qualification and is never promoted to certainty.',
    in_reply_to: ['invoices_received'],
    requirement_context: [
      req('invoices_received', 'What invoices did you receive?', ['invoice', 'explicit_absence']),
    ],
    answer: 'As far as I am aware, they never issued an invoice.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'no_invoice_qualified',
          'invoices_received',
          'explicit_absence',
          ['asserted_qualified', 'recalled_uncertain'],
          { statement_mentions: ['invoice'] },
        ),
      ],
      clarifications: [],
      forbidden_types: ['invoice'],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'ea_opponent_denial_not_adopted',
    category: 'explicit_absence',
    description:
      "An opponent's denial that the speaker expressly does not adopt is not the speaker's denial.",
    // CORRECTED EXPECTATION, disclosed in the PR body. The case construction is
    // the one originally authored; only the expected VERDICT changed, from a
    // silent `no_assertions` to `ambiguous` plus one clarification.
    //
    // The justification is doctrine that predates this PR entirely, inherited
    // verbatim from V0.3: "Quoted, hypothetical, conditional, sarcastic or
    // adversarial negative wording is not automatically an affirmative denial.
    // Ask for clarification if polarity/adoption is unclear." Here the speaker
    // distances from the other side's denial without stating their own
    // position, and `binding_deadline` WAS asked — so the requirement is left
    // genuinely open and the doctrinally correct move is to fail closed and
    // ask, not to record silence. The two readings (a deadline was agreed / was
    // not) are incompatible, which is what `multiple_incompatible_readings`
    // names; `answer_does_not_address_requirement` would be wrong, because the
    // answer does address the topic.
    //
    // What the case exists to prove is unchanged and still enforced by
    // `forbidden_types`: the other side's denial never becomes the speaker's
    // explicit_absence.
    in_reply_to: ['binding_deadline'],
    requirement_context: [
      req('binding_deadline', 'Was a binding completion deadline agreed?', [
        'contractual_deadline',
        'explicit_absence',
      ]),
    ],
    answer:
      'They keep saying they never agreed to any deadline, but that is their position, not mine.',
    expect: {
      verdict: 'ambiguous',
      assertions: [],
      // BOTH labels are doctrinally correct here, and the corpus must not pick
      // one arbitrarily. The rule that applies — "Ask for clarification if
      // polarity/adoption is unclear" — names no adoption-specific reason, and
      // the speaker's missing position is described honestly either as two
      // incompatible readings or as an answer that does not address the
      // requirement. 8C1b-0.1 added the acceptable-set form for exactly this;
      // a reason outside the set still fails.
      clarifications: [
        {
          requirement_id: 'binding_deadline',
          reasons: ['multiple_incompatible_readings', 'answer_does_not_address_requirement'],
        },
      ],
      forbidden_types: ['explicit_absence', 'contractual_deadline'],
    },
  }),

  evalCase({
    id: 'date_target_only',
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
    answer: 'We were aiming for 1 July.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('target_july', 'target_completion', 'target_date', ['asserted_confident'], {
          statement_mentions: ['1 July'],
        }),
      ],
      clarifications: [],
      forbidden_types: ['contractual_deadline'],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'date_binding_only',
    category: 'target_date_vs_deadline',
    description: 'An expressly agreed, signed completion date is a contractual deadline.',
    in_reply_to: ['binding_deadline'],
    requirement_context: [
      req('binding_deadline', 'Was a binding completion deadline agreed?', [
        'contractual_deadline',
        'explicit_absence',
      ]),
      req('target_completion', 'What completion date were you aiming for?', [
        'target_date',
        'explicit_absence',
      ]),
    ],
    answer:
      '1 July was written into the contract as the completion deadline and both sides signed it.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'deadline_july',
          'binding_deadline',
          'contractual_deadline',
          ['asserted_confident'],
          { statement_mentions: ['1 July'] },
        ),
      ],
      clarifications: [],
      forbidden_types: ['target_date'],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'date_denial_with_live_target',
    category: 'target_date_vs_deadline',
    description:
      'An explicit denial of a binding deadline alongside a target date that independently survives.',
    in_reply_to: ['binding_deadline'],
    requirement_context: [
      req('binding_deadline', 'Was a binding completion deadline agreed?', [
        'contractual_deadline',
        'explicit_absence',
      ]),
      req('target_completion', 'What completion date were you aiming for?', [
        'target_date',
        'explicit_absence',
      ]),
    ],
    // Worded to share no long window with the prompt's explicit-absence example,
    // which a structural guard enforces. A corpus sentence lifted from the prompt
    // tests recall of the prompt, not the doctrine.
    answer:
      '12 August was only ever the date we were working towards, and I never agreed to it as a binding obligation.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'no_binding_obligation',
          'binding_deadline',
          'explicit_absence',
          ['asserted_confident'],
          { statement_mentions: ['binding'] },
        ),
        expectAssertion(
          'target_august',
          'target_completion',
          'target_date',
          ['asserted_confident'],
          {
            statement_mentions: ['12 August'],
          },
        ),
      ],
      clarifications: [],
      forbidden_types: ['contractual_deadline'],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'date_ambiguous_wording',
    category: 'target_date_vs_deadline',
    description:
      'Wording that determines neither reading fails closed rather than resolving to the likelier one.',
    in_reply_to: ['binding_deadline'],
    requirement_context: [
      req('binding_deadline', 'Was a binding completion deadline agreed?', [
        'contractual_deadline',
        'target_date',
        'explicit_absence',
      ]),
    ],
    answer: '1 July was the date we had down for handover.',
    expect: {
      verdict: 'ambiguous',
      assertions: [],
      clarifications: [
        { requirement_id: 'binding_deadline', reason: 'type_classification_indeterminate' },
      ],
    },
  }),

  evalCase({
    id: 'nr_deadline_not_remembered',
    category: 'non_recollection',
    description: 'Not remembering whether a deadline was agreed is a real answer, not a gap.',
    in_reply_to: ['binding_deadline'],
    requirement_context: [
      req('binding_deadline', 'Was a binding completion deadline agreed?', [
        'contractual_deadline',
        'explicit_absence',
      ]),
    ],
    answer: 'I honestly do not remember whether we agreed a completion date.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('deadline_unremembered', 'binding_deadline', 'non_recollection', [
          'non_recollection',
        ]),
      ],
      clarifications: [],
      forbidden_types: ['contractual_deadline', 'explicit_absence'],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'nr_amount_not_remembered',
    category: 'non_recollection',
    description: 'Not remembering an amount must never become an invented amount.',
    in_reply_to: ['deposit_amount'],
    requirement_context: [
      req('deposit_amount', 'What deposit was paid?', ['payment', 'explicit_absence']),
    ],
    answer: 'I cannot remember what the deposit came to.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('deposit_unremembered', 'deposit_amount', 'non_recollection', [
          'non_recollection',
        ]),
      ],
      clarifications: [],
      forbidden_types: ['payment', 'explicit_absence'],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'da_declines_costs',
    category: 'declined_answer',
    description: 'A refusal to answer is recorded as a refusal, never as an inferred fact.',
    in_reply_to: ['prior_legal_costs'],
    requirement_context: [
      req('prior_legal_costs', 'What have you spent on legal costs so far?', [
        'payment',
        'explicit_absence',
      ]),
    ],
    answer: 'I would rather not go into what I paid my previous solicitor.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('costs_declined', 'prior_legal_costs', 'declined_to_answer', ['declined']),
      ],
      clarifications: [],
      forbidden_types: ['payment', 'explicit_absence'],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'da_declines_one_answers_other',
    category: 'declined_answer',
    description:
      'A declined answer for one requirement does not suppress a real answer to another.',
    in_reply_to: ['settlement_discussions', 'agreed_price'],
    requirement_context: [
      req('settlement_discussions', 'What settlement discussions took place?'),
      req('agreed_price', 'What price was agreed?'),
    ],
    answer: 'The agreed price was 12,000 euro. I am not willing to discuss the settlement talks.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('price_12000', 'agreed_price', 'narrative_fact', ['asserted_confident'], {
          statement_mentions: ['12,000'],
        }),
        expectAssertion('settlement_declined', 'settlement_discussions', 'declined_to_answer', [
          'declined',
        ]),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),
];
