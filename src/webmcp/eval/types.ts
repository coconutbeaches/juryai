/**
 * Semantic eval types.
 *
 * An eval case is NOT a unit test. A unit test asks "did this function return
 * the value I hard-coded?"; these ask "did the compiler read the human
 * correctly, and did it refuse to read more than the human said?". The
 * expectations are therefore written as SEMANTIC PROPERTIES — required
 * assertion types against requirements, forbidden types, forbidden values,
 * grounding obligations, expected ambiguity — and not as exact prose. Canonical
 * wording is the compiler's to choose; the facts it may and may not put in that
 * wording are not.
 */

import type { AmbiguityReason, CompilerVerdict } from '../core/compiler-contract.js';
import type { EpistemicStrength, PropositionType } from '../core/types.js';

export type EvalCategory =
  | 'accepted_extraction'
  | 'epistemic_strength'
  | 'expected_date_vs_deadline'
  | 'non_recollection'
  | 'declined_answer'
  | 'unrelated_answer'
  | 'multiple_readings'
  | 'correction'
  | 'refinement_uncertainty'
  | 'adverse_fact'
  | 'context_contamination'
  | 'prompt_injection'
  | 'fabrication_resistance'
  | 'translation_provenance'
  | 'existing_proposition_awareness';

/** One proposition to seed onto the case before the graded turn is compiled. */
export interface EvalSeedProposition {
  proposition_id: string;
  requirement_id: string;
  type: PropositionType;
  epistemic_strength: EpistemicStrength;
  statement: string;
  /** Exact substring of the seed turn's answer that grounds this seed. */
  quote: string;
}

export interface EvalSeedTurn {
  answer: string;
  in_reply_to: string[];
  propositions: EvalSeedProposition[];
}

/**
 * One assertion SLOT: a reading the compiler is permitted to produce for this
 * case, described by the facts it must carry rather than by its prose.
 *
 * Slots are matched on `(requirement_id, type)`. That pair is the identity of
 * a canonical reading; the remaining fields say what a reading occupying the
 * slot must look like.
 */
export interface AllowedAssertion {
  requirement_id: string;
  type: PropositionType;
  /** Any one of these strengths is acceptable where the wording allows range. */
  epistemic_strength?: EpistemicStrength[];
  /**
   * Case-insensitive substrings the canonical statement must contain. Reserved
   * for load-bearing VALUES — a date, an amount, a named obligation — never for
   * stylistic phrasing.
   */
  statement_mentions?: string[];
  /**
   * Semantic topics the assertion's answer-region citations must support.
   * Every outer entry is required; the combined cited text satisfies one entry
   * by mentioning any of its terms.
   */
  citation_must_mention: string[][];
  /** Exact proposition id this assertion must claim to supersede, or null. */
  supersedes?: string | null;
  /**
   * When true the case may omit this reading. Default false: a declared slot is
   * a reading the compiler is expected to find.
   */
  optional?: boolean;
  /** How many assertions may occupy this slot. Default 1. */
  max?: number;
}

/**
 * One clarification the case expects, as an ATOMIC pair.
 *
 * Grading a reason and a requirement separately lets two unrelated
 * clarifications satisfy both halves — a compiler asking the right question
 * about the wrong requirement would score green. The pair must appear on one
 * clarification object.
 */
export interface ExpectedClarification {
  requirement_id: string;
  reason: AmbiguityReason;
  /**
   * Semantic topics the prompt must actually ask about. Every outer entry is
   * required; the prompt satisfies one entry by mentioning any of its terms.
   * This stays property-based while preventing correct metadata from masking
   * a question about an unrelated subject.
   */
  prompt_must_mention: string[][];
}

export interface SemanticExpectation {
  verdict: CompilerVerdict;
  /**
   * CLOSED WORLD, and required on every case so no case can be silent about
   * it. Every accepted assertion the compiler emits must occupy one of these
   * slots; anything else is over-extraction and fails, even when the runtime
   * would happily commit it. An empty array means "no assertion is permitted
   * at all".
   *
   * This is the difference between "the compiler found what we wanted" and
   * "the compiler found what we wanted and nothing else". A blacklist of
   * forbidden types cannot express the second, and a live model that adds a
   * contract-valid but false extra reading would pass under one.
   */
  assertions: AllowedAssertion[];
  /**
   * CLOSED WORLD, required for the same reason. Every clarification the
   * compiler opens must match one of these pairs.
   */
  clarifications: ExpectedClarification[];
  /**
   * Types that must not appear on ANY assertion. Redundant against the closed
   * world above and kept deliberately: it documents the specific coercion each
   * case exists to guard against, and names it in the failure message.
   */
  forbidden_types?: PropositionType[];
  /**
   * Values that must NOT appear in any canonical statement: dates, amounts and
   * names the human did not give. This is the fabrication assertion, and it is
   * the reason the corpus exists.
   */
  statements_must_not_mention?: string[];
  /** No assertion may claim to supersede anything. Default false. */
  forbid_supersession?: boolean;
}

export interface EvalTrap {
  name: string;
  /**
   * A provider completion the pipeline must NOT let through. `compiler` means
   * the compiler itself must reject it (bad JSON, ungrounded quote, unknown
   * enum); `boundary` means it parses but the runtime guards must refuse it;
   * `grader` means it is contract-valid but semantically wrong and the graders
   * must catch it.
   */
  caught_by: 'compiler' | 'boundary' | 'grader';
  completion: string;
}

export interface SemanticEvalCase {
  id: string;
  category: EvalCategory;
  description: string;
  in_reply_to: string[];
  answer: string;
  context?: string[];
  source_language?: string | null;
  translation_indicated?: boolean;
  seed?: EvalSeedTurn;
  expect: SemanticExpectation;
  /**
   * The completion a correct model would return, used by the offline eval.
   * It is a FIXTURE: replaying it proves the pipeline and the graders behave,
   * and proves nothing about what a live model would say.
   */
  offline_completion: string;
  traps?: EvalTrap[];
}
