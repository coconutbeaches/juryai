/**
 * Existing-proposition families: `exact_supersession`, `additive_vs_correction`,
 * `pure_restatement` and `existing_proposition_awareness`.
 *
 * These four are authored together because they are the same question asked
 * from four sides: given live case material, is this answer a replacement, an
 * addition, or nothing at all? Getting it wrong in either direction is serious.
 * Over-supersession silently retires evidence the person never withdrew;
 * under-suppression fills the record with duplicates; and treating "similar" as
 * "the same" deletes genuinely distinct facts.
 *
 * The domain is deliberately free of fuzzy deduplication, so the only place
 * this judgement can live is the compiler — which is exactly why it is graded
 * here rather than assumed.
 *
 * `sup_siblings_untouched` is the sharpest of them: three live propositions
 * share one requirement, and only one is corrected. A model that supersedes the
 * wrong one, or several, fails on a HARD blocker rather than a miss.
 */

import { evalCase, expectAssertion, req } from './authoring.js';
import type { SemanticEvalCaseV04 } from '../eval-v0-4/types.js';

export const SUPERSESSION_CASES: SemanticEvalCaseV04[] = [
  evalCase({
    id: 'sup_siblings_untouched',
    category: 'exact_supersession',
    description:
      'One exact correction among three live same-requirement propositions; siblings must not be named.',
    in_reply_to: ['tenancy_money'],
    requirement_context: [
      req('tenancy_money', 'What money changed hands under the tenancy?', [
        'payment',
        'narrative_fact',
      ]),
    ],
    existing_propositions: [
      {
        proposition_id: 'prop_deposit_500',
        requirement_id: 'tenancy_money',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the deposit was 500 euro.',
      },
      {
        proposition_id: 'prop_cleaning_80',
        requirement_id: 'tenancy_money',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says a cleaning fee of 80 euro was paid.',
      },
      {
        proposition_id: 'prop_rent_950',
        requirement_id: 'tenancy_money',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the monthly rent was 950 euro.',
      },
    ],
    answer: 'Correction: the deposit was 550 euro, not 500.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('deposit_corrected', 'tenancy_money', 'payment', ['asserted_confident'], {
          statement_mentions: ['550'],
          supersedes: 'prop_deposit_500',
        }),
      ],
      clarifications: [],
    },
  }),

  evalCase({
    id: 'sup_cross_type_correction',
    category: 'exact_supersession',
    description:
      'A clear correction that legitimately changes proposition TYPE under the same requirement.',
    in_reply_to: ['binding_deadline'],
    requirement_context: [
      req('binding_deadline', 'Was a binding completion deadline agreed?', [
        'contractual_deadline',
        'explicit_absence',
      ]),
    ],
    existing_propositions: [
      {
        proposition_id: 'prop_no_deadline',
        requirement_id: 'binding_deadline',
        type: 'explicit_absence',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says no binding completion deadline was agreed.',
      },
    ],
    answer:
      'Actually I was wrong about that. 1 July was agreed as the binding deadline in the signed contract.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'deadline_now_positive',
          'binding_deadline',
          'contractual_deadline',
          ['asserted_confident'],
          { statement_mentions: ['1 July'], supersedes: 'prop_no_deadline' },
        ),
      ],
      clarifications: [],
    },
  }),

  evalCase({
    id: 'sup_one_of_two_invoices',
    category: 'exact_supersession',
    description: 'A corrected amount must name the one invoice it corrects, not its sibling.',
    in_reply_to: ['invoices_issued'],
    requirement_context: [
      req('invoices_issued', 'What invoices did you issue?', ['invoice', 'explicit_absence']),
    ],
    existing_propositions: [
      {
        proposition_id: 'prop_invoice_118',
        requirement_id: 'invoices_issued',
        type: 'invoice',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says invoice 118 was for 1,200 euro.',
      },
      {
        proposition_id: 'prop_invoice_119',
        requirement_id: 'invoices_issued',
        type: 'invoice',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says invoice 119 was for 800 euro.',
      },
    ],
    answer: 'Invoice 118 was 1,250 euro, not 1,200.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('invoice_118_fixed', 'invoices_issued', 'invoice', ['asserted_confident'], {
          statement_mentions: ['1,250'],
          supersedes: 'prop_invoice_118',
        }),
      ],
      clarifications: [],
    },
  }),

  evalCase({
    id: 'add_related_new_fact',
    category: 'additive_vs_correction',
    description: 'A new payment near an existing one is an ADDITION, never a supersession.',
    in_reply_to: ['tenancy_money'],
    requirement_context: [
      req('tenancy_money', 'What money changed hands under the tenancy?', ['payment']),
    ],
    existing_propositions: [
      {
        proposition_id: 'prop_deposit_500',
        requirement_id: 'tenancy_money',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the deposit was 500 euro.',
      },
    ],
    answer: 'I also paid a cleaning fee of 80 euro at the same time.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('cleaning_fee', 'tenancy_money', 'payment', ['asserted_confident'], {
          statement_mentions: ['80'],
          supersedes: null,
        }),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'add_second_occurrence',
    category: 'additive_vs_correction',
    description:
      'A second occurrence of the same kind of event is a new fact, not a correction of the first.',
    in_reply_to: ['site_visits'],
    requirement_context: [req('site_visits', 'When did site visits take place?')],
    existing_propositions: [
      {
        proposition_id: 'prop_visit_march',
        requirement_id: 'site_visits',
        type: 'narrative_fact',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says a site visit took place in March.',
      },
    ],
    answer: 'There was another site visit in September.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'visit_september',
          'site_visits',
          'narrative_fact',
          ['asserted_confident'],
          {
            statement_mentions: ['September'],
            supersedes: null,
          },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'add_scope_extension',
    category: 'additive_vs_correction',
    description:
      'Later-agreed extra scope adds to the record; it does not replace the original scope.',
    in_reply_to: ['agreed_scope'],
    requirement_context: [
      req('agreed_scope', 'What work was agreed?', ['accepted_scope', 'narrative_fact']),
    ],
    existing_propositions: [
      {
        proposition_id: 'prop_scope_kitchen',
        requirement_id: 'agreed_scope',
        type: 'accepted_scope',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the agreed scope was the kitchen only.',
      },
    ],
    answer: 'The bathroom was added to the scope in May.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'scope_bathroom',
          'agreed_scope',
          'accepted_scope',
          ['asserted_confident'],
          {
            statement_mentions: ['bathroom'],
            supersedes: null,
          },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'rest_verbatim_repeat',
    category: 'pure_restatement',
    description: 'A verbatim repeat of a live proposition adds nothing and must emit nothing.',
    in_reply_to: ['property_condition'],
    requirement_context: [req('property_condition', 'What was wrong with the property?')],
    existing_propositions: [
      {
        proposition_id: 'prop_roof_january',
        requirement_id: 'property_condition',
        type: 'narrative_fact',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the roof leaked in January.',
      },
    ],
    answer: 'Like I said before, the roof leaked in January.',
    expect: { verdict: 'no_assertions', assertions: [], clarifications: [] },
  }),

  evalCase({
    id: 'rest_reworded_repeat',
    category: 'pure_restatement',
    description: 'A reworded repeat carrying no new material also emits nothing.',
    in_reply_to: ['other_party_nonperformance'],
    requirement_context: [req('other_party_nonperformance', 'What did the other side fail to do?')],
    existing_propositions: [
      {
        proposition_id: 'prop_delivery_late',
        requirement_id: 'other_party_nonperformance',
        type: 'narrative_fact',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the delivery arrived after the agreed date.',
      },
    ],
    answer: 'To repeat, the delivery came in later than it was supposed to.',
    expect: { verdict: 'no_assertions', assertions: [], clarifications: [] },
  }),

  evalCase({
    id: 'rest_repeat_plus_new_fact',
    category: 'pure_restatement',
    description:
      'ANTI-SUPPRESSION. A repeat carrying one genuinely new event yields exactly that new event.',
    in_reply_to: ['property_condition'],
    requirement_context: [req('property_condition', 'What was wrong with the property?')],
    existing_propositions: [
      {
        proposition_id: 'prop_roof_january',
        requirement_id: 'property_condition',
        type: 'narrative_fact',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the roof leaked in January.',
      },
    ],
    answer: 'As I said, the roof leaked in January, and it leaked again in March.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'march_leak',
          'property_condition',
          'narrative_fact',
          ['asserted_confident'],
          {
            statement_mentions: ['March'],
            supersedes: null,
          },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'epa_answer_elsewhere_no_duplicate',
    category: 'existing_proposition_awareness',
    description:
      'Answering one requirement while restating a live proposition under another yields only the new fact.',
    in_reply_to: ['rent_amount'],
    requirement_context: [
      req('rent_amount', 'What was the monthly rent?', ['payment', 'narrative_fact']),
      req('deposit_amount', 'What deposit was paid?', ['payment', 'explicit_absence']),
    ],
    existing_propositions: [
      {
        proposition_id: 'prop_deposit_500',
        requirement_id: 'deposit_amount',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the deposit was 500 euro.',
      },
    ],
    answer: 'The rent was 950 euro a month. The deposit was 500 euro, as I mentioned.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('rent_950', 'rent_amount', 'payment', ['asserted_confident'], {
          statement_mentions: ['950'],
          supersedes: null,
        }),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  evalCase({
    id: 'epa_same_amount_different_month',
    category: 'existing_proposition_awareness',
    description:
      'Same amount, different month is a distinct fact and must be recorded, not collapsed.',
    in_reply_to: ['payments_made'],
    requirement_context: [req('payments_made', 'What payments have you made?', ['payment'])],
    existing_propositions: [
      {
        proposition_id: 'prop_payment_march',
        requirement_id: 'payments_made',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says a payment of 500 euro was made in March.',
      },
    ],
    answer: 'I made another payment of 500 euro in April.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('payment_april', 'payments_made', 'payment', ['asserted_confident'], {
          statement_mentions: ['April'],
          supersedes: null,
        }),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),
];
