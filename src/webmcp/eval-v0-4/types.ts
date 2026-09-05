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
   * Case-insensitive substrings the canonical statement must contain. Reserved
   * for load-bearing VALUES — a date, an amount, a named obligation — never
   * stylistic phrasing.
   */
  statement_mentions?: string[];
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

/** One expected clarification, as an ATOMIC pair — unchanged from V0.3. */
export interface ExpectedClarificationV04 {
  requirement_id: string;
  reason: AmbiguityReason;
}

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
  expect: SemanticExpectationV04;
}

export interface GradeResultV04 {
  ok: boolean;
  failures: EvalFailureV04[];
  hard_blockers: EvalFailureV04[];
  ordinary_failures: EvalFailureV04[];
}
