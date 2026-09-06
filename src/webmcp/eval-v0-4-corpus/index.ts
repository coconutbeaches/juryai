/**
 * The V0.4 semantic eval corpus.
 *
 * A HUMAN-AUTHORED expectation set, graded by the 8C1b-0 oracle exactly as that
 * oracle was designed. Nothing here interprets English, scores partial credit,
 * or decides that two readings are close enough: an expectation is satisfied by
 * a compatible assertion or it is not.
 *
 * CLOSED WORLD IN BOTH DIRECTIONS. Every accepted assertion must satisfy one
 * declared expectation, and every non-optional expectation must be satisfied.
 * Under-extraction and over-extraction both fail, which is why the corpus is
 * authored as complete readings rather than as spot checks.
 *
 * FROZEN BEFORE THE FIRST LIVE CALL. `corpusHash` fixes the exact graded
 * content, and `PRIMARY_CORPUS_FROZEN_HASH` records it. Freezing before any
 * model has been asked is what stops the corpus becoming a record of what the
 * model happened to do — the failure mode where a case is quietly softened
 * after a red run and the eval reports green against a ruler the model helped
 * carve.
 */

import { canonicalSerialize, sha256 } from '../core-v0-3/types.js';
import type { JsonValue } from '../core-v0-3/types.js';
import { normalizeForStorage } from '../core/turns.js';
import type { EvalCategoryV04, SemanticEvalCaseV04 } from '../eval-v0-4/types.js';
import { DECOMPOSITION_CASES } from './family-decomposition.js';
import { SUPERSESSION_CASES } from './family-supersession.js';
import { SCOPE_CASES } from './family-scope.js';
import { DATES_AND_NONANSWERS_CASES } from './family-dates-and-nonanswers.js';
import { INTEGRITY_CASES } from './family-integrity.js';

export const SEMANTIC_EVAL_CORPUS_VERSION = 'juryai-semantic-eval-v0.4.0';

export const PRIMARY_CORPUS: readonly SemanticEvalCaseV04[] = Object.freeze([
  ...DECOMPOSITION_CASES,
  ...SUPERSESSION_CASES,
  ...SCOPE_CASES,
  ...DATES_AND_NONANSWERS_CASES,
  ...INTEGRITY_CASES,
]);

/**
 * THE FROZEN PRIMARY CORPUS HASH.
 *
 * Recorded BEFORE the first live model call, and never moved to accommodate a
 * result. If a corpus correction is genuinely required after live observation,
 * this constant changes and the PR body records the before/after with an
 * independent justification — conspicuously, because a silently re-frozen
 * corpus is indistinguishable from a corpus tuned to the model.
 */
export const PRIMARY_CORPUS_FROZEN_HASH =
  '2f912f3baa2ad03a4caa2c53a61b90d23d956534d0b8d512f9e5f69b8fa73f9e';

/**
 * The content hash of a corpus.
 *
 * Over the CASES only. Deliberately excludes the offline completion fixtures:
 * those are a scripted stand-in for a provider and may legitimately be
 * corrected without the graded expectations moving at all. Mixing them in would
 * make the freeze hash change for reasons that are not corpus changes, and a
 * freeze that moves for innocent reasons stops being read.
 */
export function corpusHash(cases: readonly SemanticEvalCaseV04[]): string {
  return sha256(canonicalSerialize(cases as unknown as JsonValue));
}

/**
 * Structural well-formedness. Not grading — these are properties a case must
 * have for the harness to be able to run it at all, and each one has produced a
 * real authoring mistake at least once.
 */
export function corpusWellFormednessErrors(cases: readonly SemanticEvalCaseV04[]): string[] {
  const errors: string[] = [];
  const seenCaseIds = new Set<string>();

  for (const item of cases) {
    if (seenCaseIds.has(item.id)) errors.push(`duplicate case id: ${item.id}`);
    seenCaseIds.add(item.id);

    // The answer is shown to the model in STORED form. If the authored text is
    // not already its own normalized form, every declared citation would have
    // to be written against text no author ever sees.
    if (normalizeForStorage(item.answer) !== item.answer) {
      errors.push(`${item.id}: answer is not already in normalized stored form`);
    }
    for (const [index, message] of (item.context ?? []).entries()) {
      if (normalizeForStorage(message) !== message) {
        errors.push(`${item.id}: context[${String(index)}] is not in normalized stored form`);
      }
    }

    const requirementIds = new Set(item.requirement_context.map((entry) => entry.requirement_id));
    if (requirementIds.size !== item.requirement_context.length) {
      errors.push(`${item.id}: duplicate requirement_id in requirement_context`);
    }
    for (const asked of item.in_reply_to) {
      if (!requirementIds.has(asked)) {
        errors.push(`${item.id}: in_reply_to '${asked}' is absent from requirement_context`);
      }
    }

    const seenExpectationIds = new Set<string>();
    for (const expectation of item.expect.assertions) {
      if (seenExpectationIds.has(expectation.expectation_id)) {
        errors.push(`${item.id}: duplicate expectation_id ${expectation.expectation_id}`);
      }
      seenExpectationIds.add(expectation.expectation_id);
      if (!requirementIds.has(expectation.requirement_id)) {
        // An expectation outside the supplied context could never be satisfied:
        // the contract rejects such an assertion as `compiler_requirement_unknown`.
        errors.push(
          `${item.id}: expectation ${expectation.expectation_id} targets unsupplied requirement`,
        );
      }
    }
    for (const clarification of item.expect.clarifications) {
      if (!requirementIds.has(clarification.requirement_id)) {
        errors.push(`${item.id}: clarification targets unsupplied requirement`);
      }
    }

    // The oracle's universal gate fails an ambiguous verdict that carries
    // assertions, and one that carries no clarification.
    if (item.expect.verdict === 'ambiguous') {
      if (item.expect.assertions.length > 0) {
        errors.push(`${item.id}: ambiguous verdict cannot expect assertions`);
      }
      if (item.expect.clarifications.length === 0) {
        errors.push(`${item.id}: ambiguous verdict must expect a clarification`);
      }
    }
    if (item.expect.verdict === 'no_assertions' && item.expect.assertions.length > 0) {
      errors.push(`${item.id}: no_assertions verdict cannot expect assertions`);
    }
    if (item.expect.verdict === 'accepted_candidates' && item.expect.assertions.length === 0) {
      errors.push(`${item.id}: accepted_candidates verdict must expect at least one assertion`);
    }
  }
  return errors;
}

export function casesByCategory(
  cases: readonly SemanticEvalCaseV04[],
): Map<EvalCategoryV04, SemanticEvalCaseV04[]> {
  const byCategory = new Map<EvalCategoryV04, SemanticEvalCaseV04[]>();
  for (const item of cases) {
    const bucket = byCategory.get(item.category) ?? [];
    bucket.push(item);
    byCategory.set(item.category, bucket);
  }
  return byCategory;
}

export {
  DECOMPOSITION_CASES,
  SUPERSESSION_CASES,
  SCOPE_CASES,
  DATES_AND_NONANSWERS_CASES,
  INTEGRITY_CASES,
};
