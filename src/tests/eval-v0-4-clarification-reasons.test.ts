/**
 * PR 8C1b-0.1 — doctrinally equivalent clarification reasons.
 *
 * 8C1b-0 shipped clarification grading with NO self-tests, and 8C1b-1's live
 * eval found the consequence: a case where the doctrine plainly requires a
 * clarification, but names no enum member for the ambiguity it describes. "Ask
 * for clarification if polarity/adoption is unclear" is satisfied honestly by
 * either `multiple_incompatible_readings` or
 * `answer_does_not_address_requirement`, and exact pair matching made the
 * result depend on which label the compiler happened to choose rather than on
 * whether it asked.
 *
 * This file is the missing coverage as well as the fix. It grades REAL
 * `CompilerOutput` values through the real grader, and most tests feed it
 * output that must FAIL — the same discipline as the 8C1b-0 oracle self-tests,
 * for the same reason: a grader nobody has watched fail is a grader nobody has
 * tested.
 */

import { describe, expect, it } from 'vitest';

import { buildEvalInputV04 } from '../webmcp/eval-v0-4/scenario.js';
import { gradeCompilerOutputV04 } from '../webmcp/eval-v0-4/graders.js';
import type { ExpectedClarificationV04, SemanticEvalCaseV04 } from '../webmcp/eval-v0-4/types.js';
import type { CompilerOutput } from '../webmcp/core-v0-3/compiler-contract.js';

function ambiguousCase(clarifications: ExpectedClarificationV04[]): SemanticEvalCaseV04 {
  return {
    id: 'clarification_probe',
    category: 'target_date_vs_deadline',
    description: 'probe',
    in_reply_to: ['binding_deadline'],
    requirement_context: [
      { requirement_id: 'binding_deadline', satisfying_types: ['contractual_deadline'] },
      { requirement_id: 'target_completion', satisfying_types: ['target_date'] },
    ],
    answer: 'It is hard to say what we settled on.',
    expect: { verdict: 'ambiguous', assertions: [], clarifications },
  };
}

function ambiguousOutput(requested: { requirement_id: string; reason: string }[]): CompilerOutput {
  const probe = ambiguousCase([]);
  return {
    compile_run_id: `run_${probe.id}`,
    compiler_version_id: buildEvalInputV04(probe).compiler_version_id,
    verdict: 'ambiguous',
    assertions: [],
    rejected_candidates: [],
    clarifications_requested: requested.map((entry) => ({
      requirement_id: entry.requirement_id,
      reason: entry.reason,
      prompt: 'Which did you mean?',
    })),
    // The shape validator requires it; the eval never reads it.
    raw_model_output: '{}',
  } as unknown as CompilerOutput;
}

function gradeRules(
  evalCase: SemanticEvalCaseV04,
  output: CompilerOutput,
): { ok: boolean; rules: string[] } {
  const input = buildEvalInputV04(evalCase);
  const graded = gradeCompilerOutputV04(evalCase, input, output);
  return { ok: graded.ok, rules: graded.failures.map((entry) => entry.rule) };
}

const BOTH_REASONS: ExpectedClarificationV04 = {
  requirement_id: 'binding_deadline',
  reasons: ['multiple_incompatible_readings', 'answer_does_not_address_requirement'],
};

describe('an explicit set of acceptable reasons', () => {
  it('accepts the first declared reason', () => {
    const graded = gradeRules(
      ambiguousCase([BOTH_REASONS]),
      ambiguousOutput([
        { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
      ]),
    );
    expect(graded.ok).toBe(true);
  });

  it('accepts the second declared reason', () => {
    const graded = gradeRules(
      ambiguousCase([BOTH_REASONS]),
      ambiguousOutput([
        { requirement_id: 'binding_deadline', reason: 'answer_does_not_address_requirement' },
      ]),
    );
    expect(graded.ok).toBe(true);
  });

  it('REJECTS a reason outside the declared set', () => {
    const graded = gradeRules(
      ambiguousCase([BOTH_REASONS]),
      ambiguousOutput([
        { requirement_id: 'binding_deadline', reason: 'epistemic_strength_indeterminate' },
      ]),
    );
    expect(graded.ok).toBe(false);
    expect(graded.rules).toContain('clarifications.undeclared');
    expect(graded.rules).toContain('clarifications.required_missing');
  });

  it('REJECTS an accepted reason raised against the wrong requirement', () => {
    const graded = gradeRules(
      ambiguousCase([BOTH_REASONS]),
      ambiguousOutput([
        { requirement_id: 'target_completion', reason: 'multiple_incompatible_readings' },
      ]),
    );
    expect(graded.ok).toBe(false);
    expect(graded.rules).toContain('clarifications.undeclared');
  });

  it('refuses an empty acceptable set rather than silently accepting nothing', () => {
    expect(() =>
      gradeRules(
        ambiguousCase([{ requirement_id: 'binding_deadline', reasons: [] }]),
        ambiguousOutput([
          { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
        ]),
      ),
    ).toThrow(/at least one acceptable reason/u);
  });
});

describe('one clarification cannot satisfy two expectations', () => {
  it('fails when two same-requirement expectations share one emitted clarification', () => {
    // Both expectations accept the emitted reason. Without one-to-one matching
    // the single clarification would satisfy both and the case would pass.
    const graded = gradeRules(
      ambiguousCase([
        { requirement_id: 'binding_deadline', reasons: ['multiple_incompatible_readings'] },
        {
          requirement_id: 'binding_deadline',
          reasons: ['multiple_incompatible_readings', 'answer_does_not_address_requirement'],
        },
      ]),
      ambiguousOutput([
        { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
      ]),
    );
    expect(graded.ok).toBe(false);
    expect(graded.rules).toContain('clarifications.required_missing');
  });

  it('passes only when each expectation gets its own distinct clarification', () => {
    const graded = gradeRules(
      ambiguousCase([
        { requirement_id: 'binding_deadline', reasons: ['multiple_incompatible_readings'] },
        {
          requirement_id: 'binding_deadline',
          reasons: ['multiple_incompatible_readings', 'answer_does_not_address_requirement'],
        },
      ]),
      ambiguousOutput([
        { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
        { requirement_id: 'binding_deadline', reason: 'answer_does_not_address_requirement' },
      ]),
    );
    expect(graded.ok).toBe(true);
  });

  it('is order-independent: the same two expectations pass with the arrays reversed', () => {
    const graded = gradeRules(
      ambiguousCase([
        {
          requirement_id: 'binding_deadline',
          reasons: ['multiple_incompatible_readings', 'answer_does_not_address_requirement'],
        },
        { requirement_id: 'binding_deadline', reasons: ['multiple_incompatible_readings'] },
      ]),
      ambiguousOutput([
        { requirement_id: 'binding_deadline', reason: 'answer_does_not_address_requirement' },
        { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
      ]),
    );
    expect(graded.ok).toBe(true);
  });

  /**
   * THE SHARP ONE, and the reason clarification grading was rebuilt rather than
   * extended. Pre-fix these two expectations collapsed into a single Set key,
   * so ONE emitted clarification satisfied BOTH and the case reported green —
   * the same false-green shape 8C1b-0 found and fixed for assertions, still
   * present on the clarification side because it had no self-tests.
   *
   * Uses SINGLE reasons deliberately: it fails pre-fix because of the collapse,
   * not because the old grader could not read a `reasons` array.
   */
  it('fails two IDENTICAL single-reason expectations sharing one clarification', () => {
    const graded = gradeRules(
      ambiguousCase([
        { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
        { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
      ]),
      ambiguousOutput([
        { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
      ]),
    );
    expect(graded.ok).toBe(false);
    expect(graded.rules).toContain('clarifications.required_missing');
  });

  it('fails an extra accepted clarification no expectation can claim', () => {
    const graded = gradeRules(
      ambiguousCase([BOTH_REASONS]),
      ambiguousOutput([
        { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
        { requirement_id: 'binding_deadline', reason: 'answer_does_not_address_requirement' },
      ]),
    );
    expect(graded.ok).toBe(false);
    expect(graded.rules).toContain('clarifications.undeclared');
  });
});

describe('exact single-reason fixtures behave identically to before', () => {
  const single: ExpectedClarificationV04 = {
    requirement_id: 'binding_deadline',
    reason: 'multiple_incompatible_readings',
  };

  it('passes on the exact declared pair', () => {
    const graded = gradeRules(
      ambiguousCase([single]),
      ambiguousOutput([
        { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
      ]),
    );
    expect(graded.ok).toBe(true);
  });

  it('reports required_missing when nothing is asked', () => {
    const graded = gradeRules(ambiguousCase([single]), ambiguousOutput([]));
    expect(graded.rules).toContain('clarifications.required_missing');
    // An ambiguous verdict with no clarification at all also trips the
    // universal fail-closed rule, exactly as before.
    expect(graded.rules).toContain('fail_closed.ambiguous_without_clarification');
  });

  it('reports undeclared once per occurrence of an unexpected pair', () => {
    const graded = gradeRules(
      ambiguousCase([single]),
      ambiguousOutput([
        { requirement_id: 'target_completion', reason: 'type_classification_indeterminate' },
        { requirement_id: 'target_completion', reason: 'type_classification_indeterminate' },
        { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
      ]),
    );
    expect(graded.rules.filter((rule) => rule === 'clarifications.undeclared')).toHaveLength(2);
  });

  it('reports duplicated once for a repeated expected pair', () => {
    const graded = gradeRules(
      ambiguousCase([single]),
      ambiguousOutput([
        { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
        { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
      ]),
    );
    expect(graded.rules.filter((rule) => rule === 'clarifications.duplicated')).toHaveLength(1);
    expect(graded.rules).not.toContain('clarifications.required_missing');
  });

  it('still rejects an ambiguous verdict that carries assertions', () => {
    const evalCase = ambiguousCase([single]);
    const output = ambiguousOutput([
      { requirement_id: 'binding_deadline', reason: 'multiple_incompatible_readings' },
    ]);
    (output as { assertions: unknown[] }).assertions = [
      {
        assertion_id: 'a1',
        requirement_id: 'binding_deadline',
        proposed_type: 'contractual_deadline',
        epistemic_strength: 'asserted_confident',
        statement: 'x',
        supersedes_candidate: null,
        spans: [],
      },
    ];
    const graded = gradeRules(evalCase, output);
    expect(graded.rules).toContain('fail_closed.ambiguous_with_assertions');
  });
});
