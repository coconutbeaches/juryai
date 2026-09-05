/**
 * The V0.4 semantic eval oracle.
 *
 * Deterministic and closed-world: it grades a `CompilerOutput` against a
 * human-authored expectation. It calls no model, needs no API key, and does not
 * touch production. 8C1b-1 adds the corpus and the live run.
 */

export * from './types.js';
export { matchOneToOne, type Compatible, type MatchingResult } from './matching.js';
export { gradeCompilerOutputV04, gradeUniversalV04, gradeExpectationV04 } from './graders.js';
export { buildEvalInputV04, compileRunId, compilerVersionId, turnId } from './scenario.js';
