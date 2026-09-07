/**
 * Case-authoring helpers for the V0.4 semantic eval corpus.
 *
 * These reduce repetition in the fixtures and nothing else. They add no
 * grading behaviour, no matching, and no interpretation: every judgement
 * belongs to the 8C1b-0 oracle, which this corpus deliberately uses exactly as
 * designed.
 *
 * ANSWERS ARE WRITTEN IN STORED FORM. `normalizeForStorage` collapses every
 * whitespace run to one space and trims, so a fixture answer containing a line
 * break or a double space would be shown to the model in a form the fixture
 * text does not equal — and every declared citation would have to be written
 * against text the case author never sees. `corpusIsWellFormed` proves each
 * answer is already its own normalized form, so what is authored is what is
 * compiled.
 */

import type {
  EvalRequirementV04,
  EvalCategoryV04,
  ExpectedAssertionV04,
  SemanticEvalCaseV04,
} from '../eval-v0-4/types.js';
import type { EpistemicStrength, PropositionType } from '../core-v0-3/types.js';

/** A requirement the compiler is given context for. */
export function req(
  requirement_id: string,
  prompt: string,
  satisfying_types: PropositionType[] = ['narrative_fact'],
): EvalRequirementV04 {
  return { requirement_id, prompt, satisfying_types };
}

/** One independently required assertion. */
export function expectAssertion(
  expectation_id: string,
  requirement_id: string,
  type: PropositionType,
  epistemic_strengths: EpistemicStrength[],
  extra: Omit<
    ExpectedAssertionV04,
    'expectation_id' | 'requirement_id' | 'type' | 'epistemic_strengths'
  > = {},
): ExpectedAssertionV04 {
  return { expectation_id, requirement_id, type, epistemic_strengths, ...extra };
}

export interface CaseSpec {
  id: string;
  category: EvalCategoryV04;
  description: string;
  in_reply_to: string[];
  requirement_context: EvalRequirementV04[];
  answer: string;
  context?: string[];
  existing_propositions?: SemanticEvalCaseV04['existing_propositions'];
  expect: SemanticEvalCaseV04['expect'];
}

export const evalCase = (spec: CaseSpec): SemanticEvalCaseV04 => spec;
