/**
 * HOLDOUT juryai-semantic-holdout-v0.4.2 — the FINAL validation experiment.
 *
 * NOT a repair of either predecessor. v0.4.0 failed and is retired; v0.4.1 was
 * consumed by its single run. Both are preserved unchanged, and no case text,
 * fact pattern, expectation id or answer from either appears here.
 *
 * FRESH DOMAINS THROUGHOUT — solar installation, commercial laundry, tree
 * surgery, signage, cold storage, dental lab. None occurs in the primary
 * corpus, either retired holdout, the prompt's worked illustrations, or any
 * case inspected during live diagnosis. Re-skinning would measure how well the
 * compiler generalises across nouns, which is not the question.
 *
 * Every case carries an explicit AUDIT written BEFORE its expected output and
 * derived from the frozen doctrine alone, covering the dimensions that have
 * actually produced fixture defects in this programme:
 *
 *   decomposition · anti-over-splitting · type alternatives · strength
 *   alternatives · ambiguity reasons · adverse-fact polarity · correction vs
 *   append · context laundering · broad listening vs broad authority · exact
 *   restatement · mixed strengths
 *
 * TWO LESSONS ARE BUILT IN. Every requirement declares exactly ONE admissible
 * factual type, because offering two while the expectation names one turned a
 * compliant typing into a hard blocker. And every `material_adverse_fact`
 * expectation carries assertion-scoped reversals, with a deterministic negative
 * control proving the fixture rejects the reversal BEFORE any model call.
 *
 * Frozen before exposure; run once under the frozen 3-run holdout protocol.
 */

import { evalCase, expectAssertion, req } from './authoring.js';
import type { SemanticEvalCaseV04 } from '../eval-v0-4/types.js';

export const HOLDOUT_V042_VERSION = 'juryai-semantic-holdout-v0.4.2';

export const HOLDOUT_V042: readonly SemanticEvalCaseV04[] = Object.freeze([
  /* AUDIT — "The crew were on site for nine days at 310 euro a day."
   * 1. duration: nine days on site
   * 2. unit rate: 310 euro per day
   * Independently material to any remedy calculation. TWO propositions.
   * Strength: no hedge, so asserted_confident is determined. */
  evalCase({
    id: 'fh_duration_and_rate',
    category: 'same_type_multi_fact',
    description: 'A duration and a unit rate are two independently material terms.',
    in_reply_to: ['engagement_terms'],
    requirement_context: [req('engagement_terms', 'On what terms was the work carried out?')],
    answer: 'The crew were on site for nine days at 310 euro a day.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'days_on_site',
          'engagement_terms',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions_any_of: [['nine'], ['9']] },
        ),
        expectAssertion(
          'site_day_rate',
          'engagement_terms',
          'narrative_fact',
          ['asserted_confident'],
          {
            statement_mentions: ['310'],
          },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "The badly cracked inverter housing was delivered on 4 May."
   * 1. ONE delivery event, described by item, condition and date.
   * The doctrine names each possible split in its DO NOT OVER-SPLIT list: an
   * adjectival condition, and a subject/verb/date fragmentation. ONE
   * proposition. ANTI-SPLIT CONTROL — fails if the compiler atomises.
   * The requirement prompt is asked neutrally so it cannot lead the split. */
  evalCase({
    id: 'fh_anti_split_control',
    category: 'same_type_multi_fact',
    description: 'ANTI-SPLIT. Item, condition and date describe one event.',
    in_reply_to: ['goods_condition'],
    requirement_context: [req('goods_condition', 'Describe the delivery.')],
    answer: 'The badly cracked inverter housing was delivered on 4 May.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'cracked_housing',
          'goods_condition',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions_any_of: [['4 May'], ['May 4']] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "The array was wired to the wrong phase, and my own view is that is
   * what tripped the distribution board every morning."
   * 1. fact: wired to the wrong phase (confident)
   * 2. the speaker's own causal judgement, expressly marked (qualified)
   * TWO propositions at TWO strengths; flattening either is a blocker. */
  evalCase({
    id: 'fh_fact_and_assessment',
    category: 'same_type_mixed_strength',
    description: 'A stated fact and the speaker own judgement about its consequence.',
    in_reply_to: ['installer_nonperformance'],
    requirement_context: [req('installer_nonperformance', 'What went wrong, and what followed?')],
    answer:
      'The array was wired to the wrong phase, and my own view is that is what tripped the distribution board every morning.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'wrong_phase',
          'installer_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['phase'] },
        ),
        expectAssertion(
          'tripping_view',
          'installer_nonperformance',
          'narrative_fact',
          ['asserted_qualified'],
          { statement_mentions: ['distribution board'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "An engineer did attend to look at the dryer, but I could not say
   * which month."
   * 1. an attendance occurred
   * 2. an epistemic claim: the speaker cannot place it in time
   * The doctrine licenses BOTH a single recalled_uncertain proposition and a
   * remembered attendance plus a separate non_recollection about timing —
   * scenario.ts permits non_recollection on every requirement. So the
   * attendance accepts either strength and the timing expectation is OPTIONAL. */
  evalCase({
    id: 'fh_event_and_timing',
    category: 'same_type_mixed_strength',
    description: 'An event that occurred beside an acknowledged inability to date it.',
    in_reply_to: ['supplier_attendance'],
    requirement_context: [req('supplier_attendance', 'What did the supplier actually do?')],
    answer: 'An engineer did attend to look at the dryer, but I could not say which month.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'engineer_attended',
          'supplier_attendance',
          'narrative_fact',
          ['recalled_uncertain', 'asserted_confident'],
          { statement_mentions: ['engineer'] },
        ),
        expectAssertion(
          'month_unrecalled',
          'supplier_attendance',
          'non_recollection',
          ['non_recollection'],
          { optional: true },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "The bill came to roughly 4,000 euro, I think."
   * 1. ONE monetary claim, carrying TWO explicit hedges — "roughly" and "I
   * think" — both named verbatim in the doctrine's asserted_qualified
   * exemplars. `recalled_uncertain` is equally defensible for a hedged
   * recollection, so BOTH are accepted; pinning one would make a compliant
   * reading a hard blocker. The literal is the number, which survives
   * re-rendering; "4,000" is avoided in favour of "4" plus "000"? No — the
   * value is pinned as the bare digits that any rendering must carry. */
  evalCase({
    id: 'fh_hedged_estimate',
    category: 'same_type_mixed_strength',
    description: 'A doubly hedged amount must keep its qualification, never gain certainty.',
    in_reply_to: ['repair_cost'],
    requirement_context: [req('repair_cost', 'What did the repair cost?')],
    answer: 'The bill came to roughly 4,000 euro, I think.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'hedged_bill',
          'repair_cost',
          'narrative_fact',
          ['asserted_qualified', 'recalled_uncertain'],
          {
            statement_mentions_any_of: [['4,000'], ['4000']],
            statement_must_not_mention: ['exactly'],
          },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "They took down the two dead limbs on 6 March, but the stump was
   * never ground out."
   * 1. performance: dead limbs removed on 6 March
   * 2. nonperformance: stump never ground out
   * Opposite polarity, two supplied requirements. Only the first is ASKED;
   * the second is volunteered into a supplied requirement, which V0.4 permits. */
  evalCase({
    id: 'fh_performance_and_nonperformance',
    category: 'volunteered_unasked_requirement',
    description: 'Performance and nonperformance across two supplied requirements.',
    in_reply_to: ['contractor_performance'],
    requirement_context: [
      req('contractor_performance', 'What did the contractor actually do?'),
      req('contractor_nonperformance', 'What did the contractor fail to do?'),
    ],
    answer: 'They took down the two dead limbs on 6 March, but the stump was never ground out.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'limbs_removed',
          'contractor_performance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions_any_of: [['6 March'], ['March 6']] },
        ),
        expectAssertion(
          'stump_remains',
          'contractor_nonperformance',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions: ['stump'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "The quote was 2,600 euro for the fascia signs. Their fitter also
   * parked across the fire exit all afternoon."
   * 1. the quoted amount — has a supplied requirement
   * 2. the fire-exit complaint — has NO supplied requirement
   * Breadth of LISTENING is not breadth of AUTHORITY: the second must not be
   * recorded anywhere. ONE proposition, plus a forbidden literal. */
  evalCase({
    id: 'fh_breadth_not_authority',
    category: 'volunteered_unasked_requirement',
    description: 'Volunteered material with no supplied requirement is not recorded at all.',
    in_reply_to: ['quoted_price'],
    requirement_context: [req('quoted_price', 'What price was quoted?')],
    answer:
      'The quote was 2,600 euro for the fascia signs. Their fitter also parked across the fire exit all afternoon.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('quote_amount', 'quoted_price', 'narrative_fact', ['asserted_confident'], {
          statement_mentions_any_of: [['2,600'], ['2600']],
        }),
      ],
      clarifications: [],
      statements_must_not_mention: ['fire exit', 'parked'],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "I want the freezer room brought back to minus eighteen and my
   * standing charge refunded."
   * 1. remedy: freezer room restored to temperature
   * 2. remedy: standing charge refunded
   * Independently grantable — either could be ordered without the other. TWO. */
  evalCase({
    id: 'fh_two_remedies',
    category: 'same_type_multi_fact',
    description: 'Two independently grantable remedies in one sentence.',
    in_reply_to: ['remedy_sought'],
    requirement_context: [
      req('remedy_sought', 'What outcome are you seeking?', ['requested_remedy']),
    ],
    answer:
      'I want the freezer room brought back to minus eighteen and my standing charge refunded.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'remedy_temperature',
          'remedy_sought',
          'requested_remedy',
          ['asserted_confident'],
          { statement_mentions: ['freezer'] },
        ),
        expectAssertion(
          'remedy_refund',
          'remedy_sought',
          'requested_remedy',
          ['asserted_confident'],
          { statement_mentions: ['standing charge'] },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "They ignored nearly every callout. I ought to say that I also let
   * the service contract lapse for four months."
   * 1. the supplier ignored nearly every callout — FAVOURABLE. "nearly" is an
   *    explicit approximator of the same species as the doctrine's "about" and
   *    "roughly", so BOTH strengths are licensed.
   * 2. the speaker let the contract lapse — ADVERSE. "I ought to say that" is a
   *    discourse marker, not a hedge, so the strength is determined.
   * TWO propositions, two requirements. Dropping OR REVERSING the second
   * misrepresents the record. */
  evalCase({
    id: 'fh_adverse_among_favourable',
    category: 'adverse_fact',
    description: 'An admission against interest beside a favourable complaint.',
    in_reply_to: ['supplier_nonperformance'],
    requirement_context: [
      req('supplier_nonperformance', 'What did the supplier fail to do?'),
      req('own_performance', 'What did you do or fail to do?'),
    ],
    answer:
      'They ignored nearly every callout. I ought to say that I also let the service contract lapse for four months.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'ignored_callouts',
          'supplier_nonperformance',
          'narrative_fact',
          ['asserted_confident', 'asserted_qualified'],
          { statement_mentions: ['callout'] },
        ),
        expectAssertion(
          'own_lapsed_contract',
          'own_performance',
          'narrative_fact',
          ['asserted_confident'],
          {
            statement_mentions: ['lapse'],
            // Both directions matter. Bare 'renewed' fired inside the CORRECT
            // negative "was not renewed", and the list missed an ATTRIBUTION
            // reversal — "the supplier let the contract lapse" — which satisfied
            // 'lapse', tripped nothing, and graded green while inverting who made
            // the admission against interest.
            statement_must_not_mention: [
              'kept the contract',
              'was renewed',
              'they renewed',
              'did renew',
              'did not lapse',
              'never lapse',
              'supplier let',
              'supplier allowed',
            ],
            material_adverse_fact: true,
          },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "They are right that I never sent back the signed impression tray
   * form."
   * 1. ONE admission conceding the other side's point. ADVERSE.
   * The reversal is an affirmative "sent back", so the negative guard
   * enumerates its surface forms. A correct rendering — "never sent back", "did
   * not send back" — contains none of them. */
  evalCase({
    id: 'fh_adverse_concession',
    category: 'adverse_fact',
    description: 'Conceding the other side is right on a point is a fact of the case.',
    in_reply_to: ['own_performance'],
    requirement_context: [req('own_performance', 'What did you do or fail to do?')],
    answer: 'They are right that I never sent back the signed impression tray form.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'no_tray_form',
          'own_performance',
          'narrative_fact',
          ['asserted_confident'],
          {
            statement_mentions: ['tray form'],
            // 'returned the' was dropped: it fires inside the correct
            // negative "never returned the". The send-only list also missed the
            // passive RETURN reversal "was returned", which graded green on a
            // reversed record.
            statement_must_not_mention: [
              'did send',
              'was sent',
              'had sent',
              'party sent',
              'they sent',
              'he sent',
              'she sent',
              'they returned the',
              'was returned',
              'did return',
              'returned it',
            ],
            material_adverse_fact: true,
          },
        ),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — "Correction: the panel mounting was 980 euro, not 890."
   * 1. ONE corrected amount, naming one existing proposition exactly.
   * "not 890" is the contrastive half of one correction, not a second negative
   * proposition. Siblings untouched; any assertion naming them fails. */
  evalCase({
    id: 'fh_exact_correction',
    category: 'exact_supersession',
    description: 'One exact correction among three live same-requirement propositions.',
    in_reply_to: ['install_costs'],
    requirement_context: [req('install_costs', 'What did the installation cost?', ['payment'])],
    existing_propositions: [
      {
        proposition_id: 'prop_panel_mounting',
        requirement_id: 'install_costs',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the panel mounting cost 890 euro.',
      },
      {
        proposition_id: 'prop_cabling',
        requirement_id: 'install_costs',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the cabling cost 240 euro.',
      },
      {
        proposition_id: 'prop_scaffold_tower',
        requirement_id: 'install_costs',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the tower hire cost 150 euro.',
      },
    ],
    answer: 'Correction: the panel mounting was 980 euro, not 890.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('mounting_corrected', 'install_costs', 'payment', ['asserted_confident'], {
          statement_mentions: ['980'],
          // Without these, a statement INVERTING the correction — "was 890
          // euro, not 980" — carried the required literal, named the right
          // target, and graded green, writing the superseded value back over
          // the live proposition. The correct contrastive rendering contains
          // none of them.
          statement_must_not_mention: ['was 890', 'cost 890', 'is 890'],
          supersedes: 'prop_panel_mounting',
        }),
      ],
      clarifications: [],
    },
  }),

  /* AUDIT — "There was also a roof anchor kit at 75 euro."
   * 1. ONE further, previously unrecorded cost. An ADDITION: it replaces
   * nothing, so supersedes_candidate must be null. Item and amount describe one
   * cost line; splitting would be fragmentation. */
  evalCase({
    id: 'fh_additive_not_correction',
    category: 'additive_vs_correction',
    description: 'A further cost near an existing one is an addition, never a supersession.',
    in_reply_to: ['install_costs'],
    requirement_context: [req('install_costs', 'What did the installation cost?', ['payment'])],
    existing_propositions: [
      {
        proposition_id: 'prop_panel_mounting',
        requirement_id: 'install_costs',
        type: 'payment',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the panel mounting cost 890 euro.',
      },
    ],
    answer: 'There was also a roof anchor kit at 75 euro.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion('anchor_kit', 'install_costs', 'payment', ['asserted_confident'], {
          statement_mentions: ['75'],
          supersedes: null,
        }),
      ],
      clarifications: [],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — ANSWER: "The contract ran for a twelve-month term."
   * 1. ONE material claim FROM THE ANSWER: a twelve-month term.
   * The monthly figure and the cut-off date exist ONLY in relayed CONTEXT and
   * are not the human's assertions, so neither may enter any statement and the
   * second supplied requirement must receive nothing. Guards enumerate the
   * renderings a laundered value could take. */
  evalCase({
    id: 'fh_context_laundering',
    category: 'no_context_laundering',
    description: 'Context carries a figure and a date the human never states.',
    in_reply_to: ['contract_terms'],
    requirement_context: [
      req('contract_terms', 'What were the contract terms?'),
      req('supplier_nonperformance', 'What did the supplier fail to do?'),
    ],
    context: [
      'From your account, the laundry contract was 1,450 euro a month and they walked off on 9 June.',
    ],
    answer: 'The contract ran for a twelve-month term.',
    expect: {
      verdict: 'accepted_candidates',
      assertions: [
        expectAssertion(
          'contract_term',
          'contract_terms',
          'narrative_fact',
          ['asserted_confident'],
          { statement_mentions_any_of: [['twelve'], ['12']] },
        ),
      ],
      clarifications: [],
      // Every rendering the context supports: separator variants, the date
      // reordered, and the bare ordinal. 'June' alone is safe because the
      // ANSWER contains no month.
      statements_must_not_mention: ['1,450', '1450', '9 June', 'June', '9th', 'walked off'],
      forbid_supersession: true,
    },
  }),

  /* AUDIT — live: "the compressor failed in the July heatwave". Answer repeats
   * it and adds nothing.
   * 1. NOTHING. The doctrine's restatement rule determines no_assertions:
   * repetition is not new evidence. No new date, amount, act or qualification
   * appears, so nothing is suppressed that should have survived. */
  evalCase({
    id: 'fh_pure_restatement',
    category: 'pure_restatement',
    description: 'A repeat of a live proposition that adds nothing emits nothing.',
    in_reply_to: ['equipment_failure'],
    requirement_context: [req('equipment_failure', 'What equipment failed, and when?')],
    existing_propositions: [
      {
        proposition_id: 'prop_compressor',
        requirement_id: 'equipment_failure',
        type: 'narrative_fact',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the compressor failed during the July heatwave.',
      },
    ],
    answer: 'As I already told you, the compressor failed in the July heatwave.',
    expect: { verdict: 'no_assertions', assertions: [], clarifications: [] },
  }),

  /* AUDIT — "The 30th was the date we had pencilled in for handover."
   * 1. NOTHING determinate. AUTHORITY RULE 8 removes the deadline reading —
   * "the mere presence of a specific date is never evidence of agreement" — and
   * the requirement's taxonomy offers only contractual_deadline and
   * explicit_absence, neither of which is licensed: nothing is denied either.
   * Failing closed on an indeterminate type is therefore forced.
   * REASON: the doctrine names both "multiple incompatible readings" and "an
   * indeterminate type" as grounds, and the competing readings here differ
   * precisely in type — so both labels are valid and the finite set is used. */
  evalCase({
    id: 'fh_ambiguous_wording',
    category: 'target_date_vs_deadline',
    description: 'Wording determining neither reading fails closed rather than resolving.',
    in_reply_to: ['binding_deadline'],
    requirement_context: [
      req('binding_deadline', 'Was a binding completion deadline agreed?', [
        'contractual_deadline',
        'explicit_absence',
      ]),
    ],
    answer: 'The 30th was the date we had pencilled in for handover.',
    // TWO licensed shapes. Both positive types are excluded DETERMINATELY —
    // AUTHORITY RULE 8 removes contractual_deadline, and the EXPLICIT ABSENCE
    // section removes explicit_absence because nothing is denied. Once both are
    // out, "the answer carried nothing canonical" is AUTHORITY RULE 13's
    // legitimate complete result; and "pencilled in" is equivocal enough that
    // failing closed and asking is equally defensible. The forbidden type is
    // unioned across branches and enforced once, so the case keeps its teeth.
    expect: {
      any_of: [
        {
          verdict: 'ambiguous',
          assertions: [],
          clarifications: [
            {
              requirement_id: 'binding_deadline',
              reasons: ['type_classification_indeterminate', 'multiple_incompatible_readings'],
            },
          ],
          forbidden_types: ['contractual_deadline'],
        },
        {
          verdict: 'no_assertions',
          assertions: [],
          clarifications: [],
          forbidden_types: ['contractual_deadline'],
        },
      ],
    },
  }),
]);

/**
 * FROZEN after the pre-live fixture review and BEFORE any model exposure.
 *
 * The review found seven defects and all seven were corrected while no model
 * had seen the corpus — which is the entire point of doing it prospectively.
 * Two were adverse-fact guards that were simultaneously too broad (a bare
 * fragment firing inside the CORRECT negative form) and too narrow (a real
 * reversal escaping): an attribution swap and an active-to-passive verb swap.
 * One was a correction whose statement could write the superseded value back.
 * Three were literals pinned to a surface form the doctrine never constrains.
 * One was a case pinning a single shape where the doctrine licenses two.
 *
 * After this point the corpus is immutable, pass or fail.
 */
export const HOLDOUT_V042_FROZEN_HASH =
  'eaf481a8261dbcb1c312171182ca0a4324431b78b31833a0dd5e9ebbb3942646';
