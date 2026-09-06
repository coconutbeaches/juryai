/**
 * V0.4 semantic eval types.
 *
 * A PARALLEL oracle. The historical evaluator under `src/webmcp/eval/` stays
 * exactly as it is and remains useful regression evidence — but it cannot grade
 * V0.4, for two independent reasons:
 *
 *  1. It identifies an expected assertion by `(requirement_id, type)` and
 *     stores expectations in a Map keyed on that pair, so two expectations that
 *     share a slot COLLAPSE — the second silently overwrites the first. Under
 *     V0.4 two distinct facts may legitimately share requirement, type and even
 *     epistemic strength, which is precisely what cannot be expressed.
 *  2. Its universal gate is `validateCompilerOutput` from
 *     `src/webmcp/core/compiler-contract.ts`, which is
 *     `juryai-webmcp-compiler-contract-v0.2.1` — not V0.3 and certainly not
 *     V0.4. Its runner then applies output through the V0.2-era `CaseState`
 *     boundary.
 *
 * So a V0.4 experiment graded by the historical oracle would be measured
 * against the wrong contract AND against an expectation model that cannot
 * represent the behaviour under test. A green score from the wrong oracle is
 * worse than no score.
 *
 * This module deliberately does not interpret English. Fixture literals are
 * matched only because a human case author declared exactly which load-bearing
 * literal must appear. No embeddings, no edit distance, no similarity
 * threshold, no model-as-judge: if English equivalence is required, that is
 * live or human judgement, not deterministic software.
 */

import type { AmbiguityReason, CompilerVerdict } from '../core-v0-3/compiler-contract.js';
import type { EpistemicStrength, PropositionType } from '../core-v0-3/types.js';

/**
 * The corpus families 8C1b-1 will populate. Declared now so cases can be added
 * without touching the evaluator.
 */
export type EvalCategoryV04 =
  | 'same_type_multi_fact'
  | 'same_type_mixed_strength'
  | 'exact_supersession'
  | 'additive_vs_correction'
  | 'pure_restatement'
  | 'volunteered_unasked_requirement'
  | 'bulk_testimony'
  | 'explicit_absence'
  | 'target_date_vs_deadline'
  | 'adverse_fact'
  | 'non_recollection'
  | 'declined_answer'
  | 'no_manufacture'
  | 'no_context_laundering'
  | 'prompt_injection'
  | 'existing_proposition_awareness';

/**
 * Failure severity.
 *
 * Kept separate from any aggregate because a run of 39/40 with one fabrication
 * FAILS. Averaging is how a dangerous behaviour becomes a rounding error.
 */
export type EvalSeverity = 'hard_blocker' | 'ordinary';

export interface EvalFailureV04 {
  /** Stable machine rule name. Content-free: never carries model or case text. */
  rule: string;
  severity: EvalSeverity;
  /** Which expectation this concerns, when the failure is expectation-scoped. */
  expectation_id?: string;
}

/**
 * ONE independently required assertion.
 *
 * `expectation_id` is eval identity only — it never enters canonical case
 * state and is never shown to the model. It exists so that two expectations
 * sharing requirement, type and strength remain two expectations.
 */
export interface ExpectedAssertionV04 {
  expectation_id: string;
  requirement_id: string;
  type: PropositionType;
  /** Any one of these is acceptable where the wording genuinely allows range. */
  epistemic_strengths?: EpistemicStrength[];
  /**
   * Case-insensitive substrings the canonical statement must contain. ALL of
   * them. Reserved for load-bearing VALUES — a date, an amount, a named
   * obligation — never stylistic phrasing.
   */
  statement_mentions?: string[];
  /**
   * Finite ALTERNATIVE literal groups, for content with more than one
   * legitimate surface form.
   *
   * Each inner array is an ALL-OF group; satisfying ANY ONE group satisfies
   * this constraint. So `[['three weeks late'], ['missed', 'three weeks']]`
   * accepts either rendering and rejects everything else.
   *
   * This exists because `statement_mentions` is AND-only, which forced an
   * author to either pin one surface form — false-failing a correct statement
   * that renders it differently — or drop the guard and admit a false green.
   *
   * It remains EXACT: fixture-authored substrings, case-folded, nothing more.
   * No embeddings, no edit distance, no threshold, no model judge.
   */
  statement_mentions_any_of?: readonly (readonly string[])[];
  /**
   * Case-insensitive substrings this assertion's statement must NOT contain.
   *
   * Assertion-scoped, unlike the case-wide
   * `SemanticExpectationV04.statements_must_not_mention`. It lets a material
   * adverse expectation declare the reverse surface forms of ITS OWN
   * admission without banning those strings from unrelated statements in the
   * same case.
   *
   * A statement carrying one of these cannot satisfy this expectation, so a
   * reversed admission leaves the expectation unmatched — which for a
   * `material_adverse_fact` is a HARD blocker rather than a quiet miss.
   *
   * PREFER MULTI-TOKEN PHRASES. Bare fragments collide: "early" occurs inside
   * "nearly" and "clearly". Tests pin exactly that.
   *
   * WHAT THIS DOES NOT DO — and the boundary matters more than the mechanism.
   * It does NOT make this oracle a general English entailment checker, and no
   * report should claim it does. The honest claim is:
   *
   *   "Fixture-authored positive and negative lexical constraints can prove
   *    that DECLARED COUNTEREXAMPLE FAMILIES are rejected."
   *
   * NOT:
   *
   *   "The oracle can prove arbitrary semantic polarity."
   *
   * A reversal phrased outside the declared families — swapping the verb
   * entirely, say — is not caught. The oracle remains exact fixture-authored
   * matching, by design, and its coverage of polarity is exactly as wide as the
   * counterexamples an author thought to enumerate.
   */
  statement_must_not_mention?: readonly string[];
  /** Exact proposition id this assertion must claim to supersede, or null. */
  supersedes?: string | null;
  /** The case may omit this reading. Default false. */
  optional?: boolean;
  /**
   * Missing this assertion is a HARD BLOCKER rather than an ordinary miss.
   * Set for material adverse facts, and anywhere dropping the proposition
   * would misrepresent the record rather than merely thin it.
   */
  material_adverse_fact?: boolean;
}

/**
 * One expected clarification.
 *
 * The requirement is always fixed. The REASON may be pinned to exactly one
 * value, or — where the doctrine genuinely licenses more than one label for the
 * same ambiguity — to an explicit, fixture-authored set of reasons any one of
 * which satisfies the expectation.
 *
 * WHY THE SET EXISTS. The compiler doctrine can require a clarification without
 * naming which enum member describes it. "Ask for clarification if
 * polarity/adoption is unclear" is such a rule: a speaker who reports someone
 * else's denial without stating their own position leaves the requirement open,
 * and both `multiple_incompatible_readings` and
 * `answer_does_not_address_requirement` describe that honestly. Matching the
 * pair exactly then makes a case turn on an arbitrary enum choice rather than
 * on the behaviour under test, and a compliant compiler fails for picking the
 * other applicable label.
 *
 * WHAT THIS IS NOT. It is not fuzzy matching and not a similarity threshold.
 * The acceptable set is written out by the case author, member by member, and a
 * reason outside it still fails. Grading stays closed-world in both directions
 * and one clarification still satisfies at most one expectation.
 *
 * Exactly one of `reason` or `reasons` is supplied; the union makes supplying
 * both a compile error.
 */
export type ExpectedClarificationV04 =
  | { requirement_id: string; reason: AmbiguityReason; reasons?: never }
  | { requirement_id: string; reasons: readonly AmbiguityReason[]; reason?: never };

/** A requirement the compiler is given context for. */
export interface EvalRequirementV04 {
  requirement_id: string;
  prompt?: string;
  satisfying_types?: PropositionType[];
  max_propositions?: number | null;
}

/** A live proposition the compiler is shown as existing case material. */
export interface EvalExistingPropositionV04 {
  proposition_id: string;
  requirement_id: string;
  type: PropositionType;
  epistemic_strength: EpistemicStrength;
  statement: string;
}

export interface SemanticExpectationV04 {
  verdict: CompilerVerdict;
  /**
   * CLOSED WORLD. Every accepted assertion must satisfy exactly one of these,
   * and each of these may be satisfied by at most one assertion. An empty array
   * means NO assertion is permitted at all.
   */
  assertions: ExpectedAssertionV04[];
  /** CLOSED WORLD, for the same reason. */
  clarifications: ExpectedClarificationV04[];
  /** Types that must not appear on any assertion. */
  forbidden_types?: PropositionType[];
  /** Explicit fixture literals that must not appear in any canonical statement. */
  statements_must_not_mention?: string[];
  /** No assertion may claim to supersede anything. */
  forbid_supersession?: boolean;
}

/**
 * What a case expects: ONE complete output shape, or a finite set of complete
 * ALTERNATIVE shapes.
 *
 * WHY WHOLE SHAPES, AND NOT WIDER FIELDS. The doctrine sometimes licenses two
 * correlated whole outputs for one input. A qualified denial, for instance,
 * "retains qualification with asserted_qualified or recalled_uncertain, or
 * requests clarification" — which is:
 *
 *   A) verdict accepted_candidates, one qualified assertion, no clarification
 *   B) verdict ambiguous, no assertion, one clarification
 *
 * Widening the individual dimensions instead — an optional clarification, a
 * set of permitted verdicts — would form a CROSS PRODUCT and silently admit
 * combinations the doctrine forbids: `ambiguous` carrying an assertion, or
 * `accepted_candidates` carrying a clarification neither branch permits. The
 * alternatives have to stay CORRELATED, so the unit of alternation is the
 * entire expectation.
 *
 * Each alternative is graded closed-world in full, exactly as a single
 * expectation is, and the case passes iff at least one alternative passes
 * COMPLETELY. Fields are never mixed across alternatives.
 *
 * This also gives mutual exclusivity for free. "One merged proposition" and
 * "two split propositions" become two alternatives, and because each is
 * closed-world, output containing BOTH shapes satisfies neither.
 */
export type CaseExpectationV04 =
  | SemanticExpectationV04
  | { any_of: readonly [SemanticExpectationV04, ...SemanticExpectationV04[]] };

export interface SemanticEvalCaseV04 {
  id: string;
  category: EvalCategoryV04;
  description: string;
  /** What the interviewer explicitly asked. */
  in_reply_to: string[];
  /**
   * Every requirement the compiler is given. Under `all_own_requirements` this
   * is wider than `in_reply_to` — that difference is the whole point, and the
   * case states both rather than deriving one from the other.
   */
  requirement_context: EvalRequirementV04[];
  answer: string;
  context?: string[];
  existing_propositions?: EvalExistingPropositionV04[];
  /** One shape, or a finite set of complete alternative shapes. */
  expect: CaseExpectationV04;
}

/**
 * The alternatives a case declares, always as a non-empty list.
 *
 * An EMPTY `any_of` is a fixture-authoring error, not a grading result: it
 * could never be satisfied, so every output would fail for a reason that says
 * nothing about the output.
 */
export function expectationAlternatives(
  expect: CaseExpectationV04,
): readonly SemanticExpectationV04[] {
  if ('any_of' in expect) {
    if (expect.any_of.length === 0) {
      throw new TypeError('An `any_of` expectation must declare at least one alternative.');
    }
    return expect.any_of;
  }
  return [expect];
}

export interface GradeResultV04 {
  ok: boolean;
  failures: EvalFailureV04[];
  hard_blockers: EvalFailureV04[];
  ordinary_failures: EvalFailureV04[];
}
