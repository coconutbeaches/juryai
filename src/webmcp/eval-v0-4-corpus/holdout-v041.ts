/**
 * HOLDOUT juryai-semantic-holdout-v0.4.1 — a NEW validation experiment.
 *
 * NOT a repair or rerun of v0.4.0. That corpus failed, its model outputs were
 * inspected afterwards, and it is permanently retired from holdout use; it is
 * preserved unchanged in `holdout-v040-retired.ts`. None of its case text, fact
 * patterns, expectation ids or answers appear here.
 *
 * WHY v0.4.0 FAILED, AND WHAT CHANGED IN THE AUTHORING. Its fixtures
 * systematically UNDER-DECOMPOSED: one sentence carrying a duration and a unit
 * rate was declared as a single expectation, so a compiler correctly applying
 * the frozen decomposition doctrine produced two assertions and graded as a
 * hard blocker. The defect was in the ruler, and the same defect had already
 * appeared once in the primary corpus.
 *
 * So every case below carries an explicit DECOMPOSITION AUDIT, written BEFORE
 * the expected output and derived only from the frozen V0.4 doctrine. The
 * governing rule:
 *
 *   If two pieces of information could independently matter to a later juror,
 *   settlement analysis, remedy calculation, chronology or obligation analysis,
 *   presume they are two propositions unless the doctrine says otherwise. Do
 *   not combine them merely because they share a sentence.
 *
 * The audit deliberately covers the shapes that hide a second proposition:
 * quantity plus unit rate, duration plus rate, date plus amount, two monetary
 * terms, performance beside nonperformance, fact beside assessment, an event
 * beside uncertainty about its timing, several deficiencies, several remedies,
 * and an adverse fact among favourable ones. Anti-split controls are included
 * so the corpus cannot reward atomising instead.
 *
 * FROZEN PROSPECTIVELY. Version, hash, case count and the full compiler
 * artefact identity are committed BEFORE the single live call. The prompt is
 * not touched: `180f76e10c2899d6a931dc6964368d5802731c62f4933478092c2ca0760cf45a`.
 *
 * Fresh domains throughout — landscaping, catering, appliance repair,
 * translation, freight, instrument repair, software licensing, farm machinery —
 * none of which appear in the primary corpus, the retired holdout, the prompt's
 * worked illustrations, or any case inspected during live diagnosis.
 */

import { evalCase, expectAssertion, req } from './authoring.js';
import type { SemanticEvalCaseV04 } from '../eval-v0-4/types.js';

export const HOLDOUT_V041_VERSION = 'juryai-semantic-holdout-v0.4.1';

export const HOLDOUT_V041: readonly SemanticEvalCaseV04[] = Object.freeze([
  /* AUDIT — "The crew worked eleven days at 240 euro a day."
   * 1. duration: eleven days worked
   * 2. unit rate: 240 euro per day
   * Independently material: a juror can accept the rate and dispute the days,
   * and a remedy calculation needs both. TWO propositions.
   * This is the exact shape that broke v0.4.0, retested on fresh material. */
  evalCase({
    id: 'nh_duration_and_rate',
    category: 'same_type_multi_fact',
    description: 'A duration and a unit rate in one sentence are two independently material terms.',
    in_reply_to: ['engagement_terms'],
    requirement_context: [req('engagement_terms', 'On what terms was the work carried out?')],
    answer: 'The crew worked eleven days at 240 euro a day.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'days_worked',
          'engagement_terms',
          'narrative_fact',
          ['asserted_confident'],
          // A spelled numeral survives a canonical statement that renders the
          // count as "11 days".
          { statement_mentions: ['eleven'] },
        ),
        expectAssertion('day_rate', 'engagement_terms', 'narrative_fact', ['asserted_confident'], {
          statement_mentions: ['240'],
        }),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "I paid 1,200 euro on 3 March and the balance of 800 euro on 17 April."
   * 1. payment of 1,200 on 3 March
   * 2. payment of 800 on 17 April
   * Two separate transfers on separate dates. TWO propositions. */
  evalCase({
    id: 'nh_two_payments',
    category: 'same_type_multi_fact',
    description: 'Two payments of different amounts on different dates.',
    in_reply_to: ['payments_made'],
    requirement_context: [
      req('payments_made', 'What payments have you made?', ['payment', 'explicit_absence']),
    ],
    answer: 'I paid 1,200 euro on 3 March and the balance of 800 euro on 17 April.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        // Pinned on the DATES. They are equally load-bearing, they distinguish
        // the two payments unambiguously, and unlike "1,200" they cannot be
        // lost to thousands-separator normalisation in the canonical statement.
        expectAssertion('first_payment', 'payments_made', 'payment', ['asserted_confident'], {
          statement_mentions: ['3 March'],
        }),
        expectAssertion('balance_payment', 'payments_made', 'payment', ['asserted_confident'], {
          statement_mentions: ['17 April'],
        }),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "They laid the whole terrace by 12 June, but the drainage channel
   * was never connected."
   * 1. performance: terrace laid by 12 June
   * 2. nonperformance: drainage channel never connected
   * Different requirements, opposite polarity. TWO propositions. Only
   * contractor_performance was asked; the second is volunteered into a supplied
   * requirement, which V0.4 permits. */
  evalCase({
    id: 'nh_performance_and_nonperformance',
    category: 'volunteered_unasked_requirement',
    description:
      'Performance and nonperformance in one sentence, across two supplied requirements.',
    in_reply_to: ['contractor_performance'],
    requirement_context: [
      req('contractor_performance', 'What did the contractor actually do?'),
      req('contractor_nonperformance', 'What did the contractor fail to do?'),
    ],
    answer: 'They laid the whole terrace by 12 June, but the drainage channel was never connected.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'terrace_laid',
          'contractor_performance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['12 June'] },
        ),
        expectAssertion(
          'drainage_unconnected',
          'contractor_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['drainage'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "The marquee collapsed during the reception, and in my judgement
   * that is what turned the evening into a write-off."
   * 1. fact: the marquee collapsed during the reception (confident)
   * 2. the speaker's own evaluative judgement about the consequence (qualified)
   * TWO propositions at TWO strengths; flattening either is a blocker. */
  evalCase({
    id: 'nh_fact_and_judgement',
    category: 'same_type_mixed_strength',
    description: 'A stated fact and the speaker own judgement about its consequence.',
    in_reply_to: ['supplier_nonperformance'],
    requirement_context: [req('supplier_nonperformance', 'What went wrong, and what followed?')],
    answer:
      'The marquee collapsed during the reception, and in my judgement that is what turned the evening into a write-off.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'marquee_collapsed',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['marquee'] },
        ),
        expectAssertion(
          'write_off_judgement',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_qualified'],
          { statement_mentions: ['write-off'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "A technician did come out to look at the oven, but I could not
   * tell you which week."
   * 1. an attendance occurred
   * 2. an epistemic claim: the speaker cannot place it in time
   * The doctrine licenses BOTH readings: one recalled_uncertain proposition
   * covering the whole clause, or a remembered attendance plus a separate
   * non_recollection about timing — `scenario.ts` permits non_recollection on
   * every requirement. So the attendance accepts either strength and the timing
   * non-recollection is OPTIONAL, present under one reading and absent under
   * the other. This is the shape that was mis-specified in the primary corpus. */
  evalCase({
    id: 'nh_event_and_timing_uncertainty',
    category: 'same_type_mixed_strength',
    description: 'An event that occurred beside an acknowledged inability to date it.',
    in_reply_to: ['supplier_performance'],
    requirement_context: [req('supplier_performance', 'What did the supplier actually do?')],
    answer: 'A technician did come out to look at the oven, but I could not tell you which week.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'technician_attended',
          'supplier_performance',
          'narrative_fact',
          ['recalled_uncertain', 'asserted_confident'],
          { statement_mentions: ['technician'] },
        ),
        expectAssertion(
          'timing_unrecalled',
          'supplier_performance',
          'non_recollection',
          ['non_recollection'],
          { optional: true },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "The subtitles were out of sync, the glossary was missing, and two
   * chapters were left untranslated."
   * 1. subtitles out of sync
   * 2. glossary missing
   * 3. two chapters untranslated
   * Three independently remediable defects. THREE propositions. */
  evalCase({
    id: 'nh_three_defects',
    category: 'same_type_multi_fact',
    description: 'Three independently remediable defects under one requirement.',
    in_reply_to: ['supplier_nonperformance'],
    requirement_context: [req('supplier_nonperformance', 'What was wrong with the work?')],
    answer:
      'The subtitles were out of sync, the glossary was missing, and two chapters were left untranslated.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'subtitles',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['subtitles'] },
        ),
        expectAssertion(
          'glossary',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['glossary'] },
        ),
        expectAssertion(
          'chapters',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['chapters'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "I want the two chapters translated and my 600 euro deposit returned."
   * 1. remedy: the two chapters translated
   * 2. remedy: return of the 600 euro deposit
   * Independently grantable — either could be ordered without the other. TWO
   * propositions. This is the shape mis-specified at `bulk_ten_requirements`. */
  evalCase({
    id: 'nh_two_remedies',
    category: 'same_type_multi_fact',
    description: 'Two independently grantable remedies in one sentence.',
    in_reply_to: ['remedy_sought'],
    requirement_context: [
      // ONE admissible factual typing. Offering both requested_remedy and
      // narrative_fact would let a compliant compiler pick either while the
      // closed-world expectation can only name one. scenario.ts still appends
      // the non-answer types.
      req('remedy_sought', 'What outcome are you seeking?', ['requested_remedy']),
    ],
    answer: 'I want the two chapters translated and my 600 euro deposit returned.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'remedy_translation',
          'remedy_sought',
          'requested_remedy',
          ['asserted_confident'],
          { statement_mentions: ['chapters'] },
        ),
        expectAssertion(
          'remedy_deposit',
          'remedy_sought',
          'requested_remedy',
          ['asserted_confident'],
          { statement_mentions: ['600'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "They missed almost every milestone. I should say that I also
   * changed the specification twice after we had signed."
   * 1. the contractor missed almost every milestone (favourable to speaker)
   * 2. the speaker changed the specification twice after signing (ADVERSE)
   * Different requirements. TWO propositions, and dropping the second
   * misrepresents the record, so it is a material adverse fact. */
  evalCase({
    id: 'nh_adverse_among_favourable',
    category: 'adverse_fact',
    description: 'An admission against interest sitting beside a favourable complaint.',
    in_reply_to: ['contractor_nonperformance'],
    requirement_context: [
      req('contractor_nonperformance', 'What did the contractor fail to do?'),
      req('own_performance', 'What did you do or fail to do?'),
    ],
    answer:
      'They missed almost every milestone. I should say that I also changed the specification twice after we had signed.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        // "almost every" is an explicit approximating qualifier, and the
        // doctrine's own exemplars for asserted_qualified include "about" and
        // "roughly". Both strengths are licensed, so pinning one would make a
        // doctrinally correct output a HARD BLOCKER via strength_flattened.
        // The adverse expectation below stays pinned: "I should say that" is a
        // discourse marker, not a hedge.
        expectAssertion(
          'missed_milestones',
          'contractor_nonperformance',
          'narrative_fact',
          ['asserted_confident', 'asserted_qualified'],
          { statement_mentions: ['milestone'] },
        ),
        expectAssertion(
          'own_spec_changes',
          'own_performance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['specification'], material_adverse_fact: true },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "No deposit was ever taken from me for the container."
   * 1. an affirmative denial that any deposit was taken
   * ONE proposition. explicit_absence requires the COMPLETE answer as one
   * citation, and the subject of the denial must survive into the statement. */
  evalCase({
    id: 'nh_explicit_absence',
    category: 'explicit_absence',
    description: 'A plain affirmative denial that a deposit was ever taken.',
    in_reply_to: ['deposit_paid'],
    requirement_context: [
      req('deposit_paid', 'What deposit was taken?', ['payment', 'explicit_absence']),
    ],
    answer: 'No deposit was ever taken from me for the container.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('no_deposit', 'deposit_paid', 'explicit_absence', ['asserted_confident'], {
          statement_mentions: ['deposit'],
        }),
      ],
      clarifications: [],
      forbidden_types: ['payment'],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "I could not tell you what the demurrage charge came to."
   * 1. a non-recollection of the amount
   * ONE proposition. No figure exists in the answer, so none may be invented. */
  evalCase({
    id: 'nh_non_recollection',
    category: 'non_recollection',
    description: 'Not remembering an amount must never become an invented amount.',
    in_reply_to: ['demurrage_charge'],
    requirement_context: [
      req('demurrage_charge', 'What was the demurrage charge?', ['payment', 'explicit_absence']),
    ],
    answer: 'I could not tell you what the demurrage charge came to.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('demurrage_unrecalled', 'demurrage_charge', 'non_recollection', [
          'non_recollection',
        ]),
      ],
      clarifications: [],
      forbidden_types: ['payment', 'explicit_absence'],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "The cargo was insured for 40,000 euro. I am not going to discuss
   * the without-prejudice calls."
   * 1. fact: cargo insured for 40,000 euro
   * 2. a refusal to answer on the settlement discussions
   * Different requirements, and a refusal is itself a canonical result. TWO. */
  evalCase({
    id: 'nh_declined_and_answered',
    category: 'declined_answer',
    description: 'A refusal on one requirement alongside a real answer to another.',
    in_reply_to: ['insurance_cover', 'settlement_discussions'],
    requirement_context: [
      req('insurance_cover', 'What insurance was in place?'),
      req('settlement_discussions', 'What settlement discussions took place?'),
    ],
    answer:
      'The cargo was insured for 40,000 euro. I am not going to discuss the without-prejudice calls.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'insured_amount',
          'insurance_cover',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['40,000'] },
        ),
        expectAssertion('settlement_declined', 'settlement_discussions', 'declined_to_answer', [
          'declined',
        ]),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "Correction: the bridge fitting was 165 euro, not 140."
   * 1. a corrected amount for ONE named existing proposition
   * ONE proposition, superseding the bridge entry exactly. The two sibling
   * propositions are untouched and must not be named. */
  evalCase({
    id: 'nh_exact_correction',
    category: 'exact_supersession',
    description: 'One exact correction among three live same-requirement propositions.',
    in_reply_to: ['repair_costs'],
    requirement_context: [
      // ['payment'] only, matching nh_additive_not_correction. The doctrine
      // permits a correction to change type where the taxonomy allows it, so a
      // two-type taxonomy would license a narrative_fact correction that the
      // single expectation could not claim.
      req('repair_costs', 'What did the repairs cost?', ['payment']),
    ],
    existing_propositions: [
      {
        proposition_id: 'prop_bow_rehair',
        requirement_id: 'repair_costs',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the bow rehair cost 85 euro.',
      },
      {
        proposition_id: 'prop_bridge_fitting',
        requirement_id: 'repair_costs',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the bridge fitting cost 140 euro.',
      },
      {
        proposition_id: 'prop_case_repair',
        requirement_id: 'repair_costs',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the case repair cost 60 euro.',
      },
    ],
    answer: 'Correction: the bridge fitting was 165 euro, not 140.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('bridge_corrected', 'repair_costs', 'payment', ['asserted_confident'], {
          statement_mentions: ['165'],
          supersedes: 'prop_bridge_fitting',
        }),
      ],
      clarifications: [],
    },
  }),

  /* AUDIT — "There was also a soundpost adjustment at 45 euro."
   * 1. a further, previously unrecorded cost
   * ONE proposition, and an ADDITION: it replaces nothing, so
   * supersedes_candidate must be null. */
  evalCase({
    id: 'nh_additive_not_correction',
    category: 'additive_vs_correction',
    description: 'A further cost near an existing one is an addition, never a supersession.',
    in_reply_to: ['repair_costs'],
    requirement_context: [req('repair_costs', 'What did the repairs cost?', ['payment'])],
    existing_propositions: [
      {
        proposition_id: 'prop_bow_rehair',
        requirement_id: 'repair_costs',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the bow rehair cost 85 euro.',
      },
    ],
    answer: 'There was also a soundpost adjustment at 45 euro.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('soundpost_cost', 'repair_costs', 'payment', ['asserted_confident'], {
          statement_mentions: ['45'],
          supersedes: null,
        }),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — ANSWER: "The licence ran for a three-year term."
   * 1. the licence term was three years
   * ONE proposition from the answer. The fee and the cut-off date exist ONLY in
   * relayed CONTEXT and are not the human's assertions, so they must not enter
   * any statement and supplier_nonperformance must receive nothing at all. */
  evalCase({
    id: 'nh_context_only_facts',
    category: 'no_context_laundering',
    description: 'Context carries a fee and a date the human never states; neither may cross over.',
    in_reply_to: ['licence_terms'],
    requirement_context: [
      req('licence_terms', 'What were the licence terms?'),
      req('supplier_nonperformance', 'What did the supplier fail to do?'),
    ],
    context: [
      'From your account, the licence fee was 9,500 euro a year and they cut you off on 2 August.',
    ],
    answer: 'The licence ran for a three-year term.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('licence_term', 'licence_terms', 'narrative_fact', ['asserted_confident'], {
          // The number is the load-bearing value, and 'three' survives both
          // "a three-year term" and "a term of three years".
          statement_mentions: ['three'],
        }),
      ],
      clarifications: [],
      // Substring matching is literal, so the guard must cover the renderings a
      // laundered value could take. "August" alone cannot false-positive: the
      // answer contains no month.
      statements_must_not_mention: ['9,500', '9500', '2 August', 'August'],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "The severely rusted trailer axle arrived on 8 August."
   * 1. one delivery event, described by its item, its condition and its date
   * ONE proposition. The condition is not independently material from the
   * arrival: there is no world where the axle arrived but its rust did not.
   * ANTI-SPLIT CONTROL — this case fails if the compiler atomises. */
  evalCase({
    id: 'nh_anti_split_control',
    category: 'same_type_multi_fact',
    description: 'ANTI-SPLIT. Item, condition and date describe one event, not three.',
    in_reply_to: ['goods_condition'],
    // The requirement prompt is rendered to the model verbatim. A three-part
    // question above an anti-split control pushes toward the very split the
    // control exists to punish, so it is asked neutrally.
    requirement_context: [req('goods_condition', 'Describe the delivery.')],
    answer: 'The severely rusted trailer axle arrived on 8 August.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'rusted_axle',
          'goods_condition',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['8 August'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),
]);

/**
 * FROZEN PROSPECTIVELY, and committed BEFORE the single live call.
 *
 * Set only after the pre-live fixture review passed. If that review had found
 * a defect, the fixture would have been corrected and this value recomputed —
 * that is permitted, because no model had yet seen the corpus. After the live
 * call it is immutable, pass or fail.
 */
export const HOLDOUT_V041_FROZEN_HASH =
  '15f32cdffbf83456f57e42c6a34b51db7ff0183c3f70e4233d65add8979d017a';
