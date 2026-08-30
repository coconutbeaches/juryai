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

/** A required assertion, described by the facts it must carry, not its prose. */
export interface RequiredAssertion {
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
  /** Exact proposition id this assertion must claim to supersede, or null. */
  supersedes?: string | null;
}

export interface SemanticExpectation {
  verdict: CompilerVerdict;
  required_assertions?: RequiredAssertion[];
  /** Types that must not appear on ANY assertion. The coercion guards. */
  forbidden_types?: PropositionType[];
  /** Types that must not be asserted against one specific requirement. */
  forbidden_requirement_types?: Array<{ requirement_id: string; type: PropositionType }>;
  max_assertions?: number;
  /** At least one clarification carrying each listed reason. */
  clarification_reasons?: AmbiguityReason[];
  /**
   * Values that must NOT appear in any canonical statement: dates, amounts and
   * names the human did not give. This is the fabrication assertion, and it is
   * the reason the corpus exists.
   */
  statements_must_not_mention?: string[];
  /** No assertion may claim to supersede anything. Default false. */
  forbid_supersession?: boolean;
  /** Requirement ids that must carry no accepted assertion at all. */
  requirements_without_assertions?: string[];
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
