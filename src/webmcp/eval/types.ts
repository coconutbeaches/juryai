/**
 * Semantic eval types.
 *
 * Offline expectations describe only properties deterministic software can
 * prove: closed-world metadata, explicit fixture literals, grounding, and
 * runtime contracts. Whether free-form language carries the right meaning is a
 * live-model/human evaluation concern, not a TypeScript parser concern.
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
 * case, identified by deterministic metadata rather than by its prose.
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
   * world above and kept deliberately to document a case-authored constraint.
   */
  forbidden_types?: PropositionType[];
  /**
   * Explicit fixture literals that must NOT appear in canonical statements.
   * This is literal matching only; it does not infer equivalent expressions.
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
   * `grader` means it is contract-valid but violates an explicitly declared
   * deterministic expectation.
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
