/**
 * PR 8C1b-0.2 — finite whole-output expectation alternatives.
 *
 * The doctrine sometimes licenses two CORRELATED whole outputs for one input.
 * A qualified denial "retains qualification with asserted_qualified or
 * recalled_uncertain, OR requests clarification" — an assertion-shaped output
 * or a clarification-shaped one, never a mixture.
 *
 * The danger in fixing that is the CROSS PRODUCT. Widening each dimension
 * separately — a permitted-verdict set here, an optional clarification there —
 * would admit combinations the doctrine forbids: `ambiguous` carrying an
 * assertion, or `accepted_candidates` carrying a clarification no branch
 * permits. So the unit of alternation is the whole expectation, and most of
 * these tests exist to prove hybrids still fail.
 *
 * The second danger is safety being washed out: adding a branch that simply
 * does not check something must not excuse it. A failure is hard only when it
 * fires under EVERY declared alternative.
 */

import { describe, expect, it } from 'vitest';

import {
  buildEvalInputV04,
  gradeCompilerOutputV04,
  turnId,
  type ExpectedAssertionV04,
  type SemanticEvalCaseV04,
  type SemanticExpectationV04,
} from '../webmcp/eval-v0-4/index.js';
import { expectationAlternatives } from '../webmcp/eval-v0-4/types.js';
import type { CompilerOutput } from '../webmcp/core-v0-3/compiler-contract.js';

const REQ = 'req_invoices_received';
const ANSWER = 'As far as I am aware, they never issued an invoice.';
const CASE_ID = 'alt_fixture';

function caseWith(expect: SemanticEvalCaseV04['expect']): SemanticEvalCaseV04 {
  return {
    id: CASE_ID,
    category: 'explicit_absence',
    description: 'fixture',
    in_reply_to: [REQ],
    requirement_context: [
      { requirement_id: REQ, satisfying_types: ['invoice', 'explicit_absence'] },
    ],
    answer: ANSWER,
    expect,
  };
}

function span(quote: string) {
  const start = Math.max(0, ANSWER.indexOf(quote));
  return {
    turn_id: turnId(CASE_ID),
    region: 'answer' as const,
    message_index: null,
    encoding: 'utf16' as const,
    start,
    end: start + quote.length,
    quote,
  };
}

function assertion(options: {
  id: string;
  requirement?: string;
  type?: string;
  strength?: string;
  statement: string;
  quote?: string;
}) {
  return {
    assertion_id: options.id,
    requirement_id: options.requirement ?? REQ,
    proposed_type: options.type ?? 'explicit_absence',
    epistemic_strength: options.strength ?? 'asserted_qualified',
    statement: options.statement,
    spans: [span(options.quote ?? ANSWER)],
    supersedes_candidate: null,
  };
}

function output(
  assertions: unknown[],
  verdict = 'accepted_candidates',
  clarifications: unknown[] = [],
): CompilerOutput {
  return {
    compile_run_id: `run_${CASE_ID}`,
    compiler_version_id: buildEvalInputV04(
      caseWith({ verdict: 'no_assertions', assertions: [], clarifications: [] }),
    ).compiler_version_id,
    verdict,
    assertions,
    rejected_candidates: [],
    clarifications_requested: clarifications,
    raw_model_output: '{}',
  } as unknown as CompilerOutput;
}

const grade = (evalCase: SemanticEvalCaseV04, out: CompilerOutput) =>
  gradeCompilerOutputV04(evalCase, buildEvalInputV04(evalCase), out);
const rules = (r: { failures: { rule: string }[] }) => r.failures.map((f) => f.rule);

/** The doctrine's two licensed shapes for a qualified denial. */
const ASSERTION_BRANCH: SemanticExpectationV04 = {
  verdict: 'accepted_candidates',
  assertions: [
    {
      expectation_id: 'no_invoice',
      requirement_id: REQ,
      type: 'explicit_absence',
      epistemic_strengths: ['asserted_qualified', 'recalled_uncertain'],
      statement_mentions: ['invoice'],
    },
  ],
  clarifications: [],
};
const CLARIFICATION_BRANCH: SemanticExpectationV04 = {
  verdict: 'ambiguous',
  assertions: [],
  clarifications: [{ requirement_id: REQ, reason: 'epistemic_strength_indeterminate' }],
};
const EITHER = caseWith({ any_of: [ASSERTION_BRANCH, CLARIFICATION_BRANCH] });

const goodAssertion = () =>
  assertion({
    id: 'a1',
    statement: 'The party says that, as far as they are aware, no invoice was ever issued.',
  });
const goodClarification = () => ({
  requirement_id: REQ,
  reason: 'epistemic_strength_indeterminate',
  prompt: 'How sure are you that no invoice was issued?',
});

describe('AUDIT GAP 1 — a doctrinally licensed pair of whole output shapes', () => {
  it('A. the assertion branch passes', () => {
    expect(grade(EITHER, output([goodAssertion()])).ok).toBe(true);
  });

  it('B. the clarification branch passes', () => {
    expect(grade(EITHER, output([], 'ambiguous', [goodClarification()])).ok).toBe(true);
  });

  it('C. HYBRID ambiguous + assertion fails', () => {
    const result = grade(EITHER, output([goodAssertion()], 'ambiguous', [goodClarification()]));
    expect(result.ok).toBe(false);
    // The universal fail-closed rule catches it regardless of branch.
    expect(rules(result)).toContain('fail_closed.ambiguous_with_assertions');
    expect(result.hard_blockers.length).toBeGreaterThan(0);
  });

  it('D. HYBRID accepted_candidates + clarification fails', () => {
    // Branch A permits the assertion but no clarification; branch B permits the
    // clarification but not the verdict. Neither permits the combination.
    const result = grade(
      EITHER,
      output([goodAssertion()], 'accepted_candidates', [goodClarification()]),
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('clarifications.undeclared');
  });

  it('E. output matching neither alternative fails', () => {
    const result = grade(EITHER, output([], 'no_assertions'));
    expect(result.ok).toBe(false);
  });

  it('G. alternative ORDER cannot change the result', () => {
    const reversed = caseWith({ any_of: [CLARIFICATION_BRANCH, ASSERTION_BRANCH] });
    expect(grade(reversed, output([goodAssertion()])).ok).toBe(true);
    expect(grade(reversed, output([], 'ambiguous', [goodClarification()])).ok).toBe(true);
    // And a failing output produces the same verdict either way.
    expect(grade(reversed, output([], 'no_assertions')).ok).toBe(
      grade(EITHER, output([], 'no_assertions')).ok,
    );
  });

  it('H. an EMPTY any_of is rejected as a fixture-authoring error', () => {
    const empty = caseWith({ any_of: [] as never });
    expect(() => grade(empty, output([goodAssertion()]))).toThrow(/at least one alternative/u);
    expect(() => expectationAlternatives({ any_of: [] as never })).toThrow();
  });

  it('I. a single-expectation fixture grades exactly as before', () => {
    const single = caseWith(ASSERTION_BRANCH);
    expect(grade(single, output([goodAssertion()])).ok).toBe(true);
    expect(grade(single, output([], 'ambiguous', [goodClarification()])).ok).toBe(false);
  });
});

describe('alternatives cannot wash out safety', () => {
  it('F. an undeclared EXTRA assertion fails under every branch and stays HARD', () => {
    const result = grade(
      EITHER,
      output([
        goodAssertion(),
        assertion({
          id: 'a2',
          type: 'invoice',
          strength: 'asserted_confident',
          statement: 'The party says an invoice was issued.',
          quote: 'they never issued an invoice',
        }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.hard_blockers.map((f) => f.rule)).toContain('assertions.undeclared_extra');
  });

  it('a forbidden type declared by BOTH branches remains a hard blocker', () => {
    const guarded = caseWith({
      any_of: [
        { ...ASSERTION_BRANCH, forbidden_types: ['invoice'] },
        { ...CLARIFICATION_BRANCH, forbidden_types: ['invoice'] },
      ],
    });
    const result = grade(
      guarded,
      output([
        assertion({
          id: 'a1',
          type: 'invoice',
          strength: 'asserted_confident',
          statement: 'The party says an invoice was issued.',
          quote: 'they never issued an invoice',
        }),
      ]),
    );
    expect(result.hard_blockers.map((f) => f.rule)).toContain('assertions.forbidden_type');
  });

  it('but a constraint only ONE branch declares is branch-contingent, not hard', () => {
    // Branch B genuinely permits an output branch A forbids. Reporting that as
    // a safety violation would be false: a declared shape allows it.
    const asymmetric = caseWith({
      any_of: [
        { ...ASSERTION_BRANCH, forbidden_types: ['invoice'] },
        { ...ASSERTION_BRANCH, statements_must_not_mention: ['nothing-matches-this'] },
      ],
    });
    const result = grade(
      asymmetric,
      output([
        assertion({
          id: 'a1',
          type: 'invoice',
          strength: 'asserted_confident',
          statement: 'The party says an invoice was issued.',
          quote: 'they never issued an invoice',
        }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.hard_blockers.map((f) => f.rule)).not.toContain('assertions.forbidden_type');
  });

  it('universal grounding checks still run once and always apply', () => {
    const contextOnly = {
      ...goodAssertion(),
      spans: [{ ...span(ANSWER), region: 'context' as const, message_index: 0 }],
    };
    const result = grade(EITHER, output([contextOnly]));
    expect(result.hard_blockers.map((f) => f.rule)).toContain('grounding.no_answer_region');
  });
});

describe('AUDIT GAP 4 — merged OR split, but never both', () => {
  const MERGED: SemanticExpectationV04 = {
    verdict: 'accepted_candidates',
    assertions: [
      {
        expectation_id: 'merged',
        requirement_id: REQ,
        type: 'explicit_absence',
        statement_mentions: ['invoice'],
      },
    ],
    clarifications: [],
  };
  const SPLIT: SemanticExpectationV04 = {
    verdict: 'accepted_candidates',
    assertions: [
      {
        expectation_id: 'split_a',
        requirement_id: REQ,
        type: 'explicit_absence',
        statement_mentions: ['invoice'],
      },
      {
        expectation_id: 'split_b',
        requirement_id: REQ,
        type: 'explicit_absence',
        statement_mentions: ['aware'],
      },
    ],
    clarifications: [],
  };
  const eitherShape = caseWith({ any_of: [MERGED, SPLIT] });

  const one = () => assertion({ id: 'a1', statement: 'The party says no invoice was issued.' });
  const two = () =>
    assertion({ id: 'a2', statement: 'The party says they are aware of the position.' });

  it('the merged shape passes', () => {
    expect(grade(eitherShape, output([one()])).ok).toBe(true);
  });

  it('the split shape passes', () => {
    expect(grade(eitherShape, output([one(), two()])).ok).toBe(true);
  });

  it('BOTH shapes together fails — closed world gives exclusivity for free', () => {
    const result = grade(
      eitherShape,
      output([
        one(),
        two(),
        assertion({ id: 'a3', statement: 'The party says no invoice was issued at all.' }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('assertions.undeclared_extra');
  });
});

describe('AUDIT GAP 2 — finite alternative statement literals', () => {
  const withAnyOf = (groups: readonly (readonly string[])[]): SemanticEvalCaseV04 =>
    caseWith({
      verdict: 'accepted_candidates',
      assertions: [
        {
          expectation_id: 'x',
          requirement_id: REQ,
          type: 'explicit_absence',
          statement_mentions_any_of: groups,
        } as ExpectedAssertionV04,
      ],
      clarifications: [],
    });

  const GROUPS = [['no invoice'], ['never issued'], ['none', 'invoice']] as const;

  it('accepts the first surface form', () => {
    expect(
      grade(
        withAnyOf(GROUPS),
        output([assertion({ id: 'a', statement: 'The party says no invoice existed.' })]),
      ).ok,
    ).toBe(true);
  });

  it('accepts a different legitimate surface form', () => {
    expect(
      grade(
        withAnyOf(GROUPS),
        output([assertion({ id: 'a', statement: 'The party says they never issued anything.' })]),
      ).ok,
    ).toBe(true);
  });

  it('accepts a multi-literal ALL-OF group', () => {
    expect(
      grade(
        withAnyOf(GROUPS),
        output([
          assertion({ id: 'a', statement: 'The party says none of the invoice paperwork exists.' }),
        ]),
      ).ok,
    ).toBe(true);
  });

  it('REJECTS a statement satisfying no group', () => {
    const result = grade(
      withAnyOf(GROUPS),
      output([assertion({ id: 'a', statement: 'The party says something unrelated entirely.' })]),
    );
    expect(result.ok).toBe(false);
  });

  it('a partial ALL-OF group does not count as satisfied', () => {
    const result = grade(
      withAnyOf([['none', 'invoice']]),
      output([assertion({ id: 'a', statement: 'The party says none of it happened.' })]),
    );
    expect(result.ok).toBe(false);
  });
});

describe('AUDIT GAP 3 — declared adverse-polarity counterexamples', () => {
  const adverse = (forbidden: readonly string[]): SemanticEvalCaseV04 =>
    caseWith({
      verdict: 'accepted_candidates',
      assertions: [
        {
          expectation_id: 'admission',
          requirement_id: REQ,
          type: 'explicit_absence',
          statement_mentions: ['invoice'],
          statement_must_not_mention: forbidden,
          material_adverse_fact: true,
        } as ExpectedAssertionV04,
      ],
      clarifications: [],
    });

  it('accepts the faithful admission', () => {
    expect(
      grade(
        adverse(['did issue', 'was issued']),
        output([assertion({ id: 'a', statement: 'The party says no invoice was ever created.' })]),
      ).ok,
    ).toBe(true);
  });

  it('REJECTS a declared reversal, as a HARD blocker on the adverse expectation', () => {
    const result = grade(
      adverse(['did issue', 'was issued']),
      output([assertion({ id: 'a', statement: 'The party says an invoice was issued.' })]),
    );
    expect(result.ok).toBe(false);
    expect(result.hard_blockers.map((f) => f.rule)).toContain(
      'assertions.material_adverse_fact_missing',
    );
  });

  it('is ASSERTION-scoped: it does not ban the phrase from unrelated statements', () => {
    // The case-wide `statements_must_not_mention` would fail this; the
    // assertion-scoped form is what lets a sibling statement use the words.
    const twoAssertions = caseWith({
      verdict: 'accepted_candidates',
      assertions: [
        {
          expectation_id: 'admission',
          requirement_id: REQ,
          type: 'explicit_absence',
          statement_mentions: ['invoice'],
          statement_must_not_mention: ['was issued'],
          material_adverse_fact: true,
        } as ExpectedAssertionV04,
        {
          expectation_id: 'sibling',
          requirement_id: REQ,
          type: 'invoice',
          statement_mentions: ['receipt'],
        } as ExpectedAssertionV04,
      ],
      clarifications: [],
    });
    const result = grade(
      twoAssertions,
      output([
        assertion({ id: 'a', statement: 'The party says no invoice was ever created.' }),
        assertion({
          id: 'b',
          type: 'invoice',
          strength: 'asserted_confident',
          statement: 'The party says a receipt was issued.',
          quote: 'they never issued an invoice',
        }),
      ]),
    );
    expect(result.ok).toBe(true);
  });

  describe('substring collision regressions', () => {
    const collide = (forbidden: string, statement: string) =>
      grade(adverse([forbidden]), output([assertion({ id: 'a', statement })]));

    it('"nearly" must not trigger a bare "early" guard — so use phrases', () => {
      // Demonstrates WHY bare fragments are unsafe: this SHOULD pass on meaning
      // but fails on substring. The fixture-authoring rule is to prefer
      // multi-token phrases, and this test documents the trap concretely.
      const bare = collide('early', 'The party says the invoice arrived nearly on time.');
      expect(bare.ok).toBe(false);
      // The safe phrasing does not collide.
      const safe = collide('weeks early', 'The party says no invoice arrived nearly on time.');
      expect(safe.ok).toBe(true);
    });

    it('"clearly" also contains "early"', () => {
      expect(collide('early', 'The party clearly says no invoice was issued.').ok).toBe(false);
      expect(collide('weeks early', 'The party clearly says no invoice was issued.').ok).toBe(true);
    });
  });
});
