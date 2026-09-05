/**
 * PR 8C1b-0 — self-tests for the V0.4 semantic eval oracle.
 *
 * The most important tests here feed the grader WRONG outputs. An evaluator is
 * only worth its green result if it is known to turn red when the model does
 * the dangerous thing, so every load-bearing rule has a mutation that proves
 * it fails. Testing only correct outputs would measure the fixtures.
 *
 * No model is called. Every `CompilerOutput` is hand-authored.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEvalInputV04,
  gradeCompilerOutputV04,
  matchOneToOne,
  turnId,
  type ExpectedAssertionV04,
  type SemanticEvalCaseV04,
} from '../webmcp/eval-v0-4/index.js';
import type { CompilerOutput } from '../webmcp/core-v0-3/compiler-contract.js';
import { validateCompilerOutput } from '../webmcp/core-v0-3/compiler-contract.js';

const REQ = 'req_other_party_performance';
const REQ_B = 'req_other_party_nonperformance';
const UNASKED = 'req_payment_terms';
const FACT_A = 'They delivered on 15 July';
const FACT_B = 'the contact form did not work';
const ANSWER = `${FACT_A} and ${FACT_B} afterwards.`;

function caseWith(
  expectations: ExpectedAssertionV04[],
  overrides: Partial<SemanticEvalCaseV04> = {},
): SemanticEvalCaseV04 {
  return {
    id: 'oracle_fixture',
    category: 'same_type_multi_fact',
    description: 'fixture',
    in_reply_to: [REQ],
    requirement_context: [{ requirement_id: REQ }, { requirement_id: REQ_B }],
    answer: ANSWER,
    expect: { verdict: 'accepted_candidates', assertions: expectations, clarifications: [] },
    ...overrides,
  };
}

/** A resolved span, the way the compiler's own draft parser produces one. */
function span(
  caseId: string,
  quote: string,
  haystack = ANSWER,
  region: 'answer' | 'context' = 'answer',
) {
  const found = haystack.indexOf(quote);
  const start = found < 0 ? 0 : found;
  return {
    turn_id: turnId(caseId),
    region,
    message_index: region === 'context' ? 0 : null,
    encoding: 'utf16' as const,
    start,
    end: start + quote.length,
    quote,
  };
}

function assertion(
  caseId: string,
  options: {
    id: string;
    requirement?: string;
    type?: string;
    strength?: string;
    statement: string;
    quote?: string;
    supersedes?: string | null;
    region?: 'answer' | 'context';
    haystack?: string;
  },
) {
  const quote = options.quote ?? options.statement;
  return {
    assertion_id: options.id,
    requirement_id: options.requirement ?? REQ,
    proposed_type: options.type ?? 'narrative_fact',
    epistemic_strength: options.strength ?? 'asserted_confident',
    statement: options.statement,
    spans: [span(caseId, quote, options.haystack ?? ANSWER, options.region ?? 'answer')],
    supersedes_candidate: options.supersedes ?? null,
  };
}

function output(
  caseId: string,
  assertions: unknown[],
  verdict = 'accepted_candidates',
): CompilerOutput {
  return {
    compile_run_id: `run_${caseId}`,
    compiler_version_id: buildEvalInputV04(caseWith([], { id: caseId })).compiler_version_id,
    verdict,
    assertions,
    rejected_candidates: [],
    clarifications_requested: [],
    // The shape validator requires it; the eval never reads it.
    raw_model_output: '{}',
  } as unknown as CompilerOutput;
}

const grade = (evalCase: SemanticEvalCaseV04, out: CompilerOutput) =>
  gradeCompilerOutputV04(evalCase, buildEvalInputV04(evalCase), out);
const rules = (result: { failures: { rule: string }[] }) => result.failures.map((f) => f.rule);

const TWO_SAME_SLOT: ExpectedAssertionV04[] = [
  {
    expectation_id: 'e_delivery',
    requirement_id: REQ,
    type: 'narrative_fact',
    statement_mentions: ['15 July'],
  },
  {
    expectation_id: 'e_form',
    requirement_id: REQ,
    type: 'narrative_fact',
    statement_mentions: ['contact form'],
  },
];

describe('1-2: two same requirement/type/strength expectations', () => {
  const evalCase = caseWith(TWO_SAME_SLOT);

  it('1. two matching assertions pass', () => {
    const result = grade(
      evalCase,
      output('oracle_fixture', [
        assertion('oracle_fixture', { id: 'a1', statement: FACT_A }),
        assertion('oracle_fixture', { id: 'a2', statement: FACT_B }),
      ]),
    );
    expect(result.ok).toBe(true);
  });

  it('2. ONE merged assertion carrying both facts FAILS', () => {
    // The defining case. Under the historical Map-keyed grader both
    // expectations collapse to one slot and a merged assertion scores green —
    // which is precisely the behaviour multi-live exists to make visible.
    const merged = assertion('oracle_fixture', {
      id: 'a1',
      statement: `${FACT_A} and ${FACT_B}`,
      quote: `${FACT_A} and ${FACT_B}`,
    });
    const result = grade(evalCase, output('oracle_fixture', [merged]));
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('assertions.required_missing');
  });
});

describe('3-4: same requirement/type, distinct expected strengths', () => {
  const evalCase = caseWith([
    {
      expectation_id: 'e_fact',
      requirement_id: REQ,
      type: 'narrative_fact',
      epistemic_strengths: ['asserted_confident'],
      statement_mentions: ['15 July'],
    },
    {
      expectation_id: 'e_assessment',
      requirement_id: REQ,
      type: 'narrative_fact',
      epistemic_strengths: ['asserted_qualified'],
      statement_mentions: ['contact form'],
    },
  ]);

  it('3. correct two outputs pass', () => {
    expect(
      grade(
        evalCase,
        output('oracle_fixture', [
          assertion('oracle_fixture', { id: 'a1', statement: FACT_A }),
          assertion('oracle_fixture', {
            id: 'a2',
            statement: FACT_B,
            strength: 'asserted_qualified',
          }),
        ]),
      ).ok,
    ).toBe(true);
  });

  it('4. both flattened to one strength FAILS as a HARD BLOCKER', () => {
    const result = grade(
      evalCase,
      output('oracle_fixture', [
        assertion('oracle_fixture', { id: 'a1', statement: FACT_A }),
        assertion('oracle_fixture', { id: 'a2', statement: FACT_B }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('assertions.strength_flattened');
    expect(result.hard_blockers.some((f) => f.rule === 'assertions.strength_flattened')).toBe(true);
  });
});

describe('5-7: cardinality and one-to-one', () => {
  it('5. three expected, two actual FAILS', () => {
    const evalCase = caseWith([
      ...TWO_SAME_SLOT,
      {
        expectation_id: 'e_third',
        requirement_id: REQ,
        type: 'narrative_fact',
        statement_mentions: ['afterwards'],
      },
    ]);
    const result = grade(
      evalCase,
      output('oracle_fixture', [
        assertion('oracle_fixture', { id: 'a1', statement: FACT_A }),
        assertion('oracle_fixture', { id: 'a2', statement: FACT_B }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(rules(result).filter((r) => r === 'assertions.required_missing')).toHaveLength(1);
  });

  it('6. two expected, three actual FAILS closed-world', () => {
    const result = grade(
      caseWith(TWO_SAME_SLOT),
      output('oracle_fixture', [
        assertion('oracle_fixture', { id: 'a1', statement: FACT_A }),
        assertion('oracle_fixture', { id: 'a2', statement: FACT_B }),
        assertion('oracle_fixture', { id: 'a3', statement: `${FACT_A} afterwards` }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('assertions.undeclared_extra');
    expect(result.hard_blockers.some((f) => f.rule === 'assertions.undeclared_extra')).toBe(true);
  });

  it('7. one actual assertion cannot satisfy two expectations', () => {
    // Both expectations are satisfiable by the same assertion; one-to-one means
    // exactly one is satisfied and the other is reported missing.
    const evalCase = caseWith([
      { expectation_id: 'e_one', requirement_id: REQ, type: 'narrative_fact' },
      { expectation_id: 'e_two', requirement_id: REQ, type: 'narrative_fact' },
    ]);
    const result = grade(
      evalCase,
      output('oracle_fixture', [assertion('oracle_fixture', { id: 'a1', statement: FACT_A })]),
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('assertions.required_missing');
  });
});

describe('8-9: permutation invariance', () => {
  /**
   * The overlap that breaks greedy matching: `e_loose` accepts either
   * assertion, `e_strict` accepts only one. Written in the unlucky order, a
   * first-match grader lets the loose expectation consume the assertion the
   * strict one needed, and the verdict depends on how the fixture was typed.
   */
  const OVERLAPPING: ExpectedAssertionV04[] = [
    { expectation_id: 'e_loose', requirement_id: REQ, type: 'narrative_fact' },
    {
      expectation_id: 'e_strict',
      requirement_id: REQ,
      type: 'narrative_fact',
      // The literal that appears ONLY in the assertion a greedy matcher would
      // already have handed to `e_loose`.
      statement_mentions: ['15 July'],
    },
  ];
  const ACTUALS = [
    assertion('oracle_fixture', { id: 'a1', statement: FACT_A }),
    assertion('oracle_fixture', { id: 'a2', statement: FACT_B }),
  ];

  it('8. expectation-array permutation gives the identical result', () => {
    const forward = grade(caseWith(OVERLAPPING), output('oracle_fixture', ACTUALS));
    const reversed = grade(caseWith([...OVERLAPPING].reverse()), output('oracle_fixture', ACTUALS));
    expect(forward.ok).toBe(true);
    expect(reversed).toEqual(forward);
  });

  it('9. actual-output permutation gives the identical result', () => {
    const forward = grade(caseWith(OVERLAPPING), output('oracle_fixture', ACTUALS));
    const reversed = grade(caseWith(OVERLAPPING), output('oracle_fixture', [...ACTUALS].reverse()));
    expect(reversed).toEqual(forward);
  });

  it('a greedy first-match would have failed this fixture', () => {
    // Proof the fixture is actually adversarial: matching in written order
    // without augmentation leaves the strict expectation unmatched.
    const greedy = (): number => {
      const used = new Set<number>();
      let matched = 0;
      for (const expected of OVERLAPPING) {
        const index = ACTUALS.findIndex(
          (actual, i) =>
            !used.has(i) &&
            (expected.statement_mentions ?? []).every((literal) =>
              actual.statement.toLowerCase().includes(literal.toLowerCase()),
            ),
        );
        if (index >= 0) {
          used.add(index);
          matched += 1;
        }
      }
      return matched;
    };
    expect(greedy()).toBe(1);
    expect(
      matchOneToOne(2, 2, (e, a) =>
        (OVERLAPPING[e]!.statement_mentions ?? []).every((literal) =>
          ACTUALS[a]!.statement.toLowerCase().includes(literal.toLowerCase()),
        ),
      ).unmatchedExpected,
    ).toEqual([]);
  });
});

describe('10-12: exact supersession', () => {
  /** The contract requires a supersession target to exist in the input. */
  const EXISTING: SemanticEvalCaseV04['existing_propositions'] = [
    {
      proposition_id: 'position_party_a_x',
      requirement_id: REQ,
      type: 'narrative_fact',
      epistemic_strength: 'asserted_confident',
      statement: 'An earlier account of the delivery.',
    },
  ];
  const SUPERSESSION: ExpectedAssertionV04[] = [
    {
      expectation_id: 'e_correction',
      requirement_id: REQ,
      type: 'narrative_fact',
      supersedes: 'position_party_a_x',
      statement_mentions: ['15 July'],
    },
    {
      expectation_id: 'e_addition',
      requirement_id: REQ,
      type: 'narrative_fact',
      supersedes: null,
      statement_mentions: ['contact form'],
    },
  ];

  it('10. correct mapping passes', () => {
    expect(
      grade(
        caseWith(SUPERSESSION, { existing_propositions: EXISTING }),
        output('oracle_fixture', [
          assertion('oracle_fixture', {
            id: 'a1',
            statement: FACT_A,
            supersedes: 'position_party_a_x',
          }),
          assertion('oracle_fixture', { id: 'a2', statement: FACT_B }),
        ]),
      ).ok,
    ).toBe(true);
  });

  it('11. swapped supersession targets FAIL as a HARD BLOCKER', () => {
    const result = grade(
      caseWith(SUPERSESSION, { existing_propositions: EXISTING }),
      output('oracle_fixture', [
        assertion('oracle_fixture', { id: 'a1', statement: FACT_A }),
        assertion('oracle_fixture', {
          id: 'a2',
          statement: FACT_B,
          supersedes: 'position_party_a_x',
        }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('assertions.wrong_supersession_target');
    expect(result.hard_blockers.length).toBeGreaterThan(0);
  });

  it('12. a cross-type exact correction passes where explicitly expected', () => {
    // 8C1a decided a correction may change proposition type. The oracle must
    // be able to express that, or the eval could not grade the decision.
    const evalCase = caseWith(
      [
        {
          expectation_id: 'e_cross_type',
          requirement_id: REQ,
          type: 'explicit_absence',
          supersedes: 'position_party_a_x',
        },
      ],
      {
        category: 'exact_supersession',
        answer: ANSWER,
        existing_propositions: EXISTING,
        // The requirement must actually admit the replacement type, exactly as
        // the shipped V2.1.4 set does for absence-eligible requirements.
        requirement_context: [
          { requirement_id: REQ, satisfying_types: ['narrative_fact', 'explicit_absence'] },
        ],
      },
    );
    const result = grade(
      evalCase,
      output('oracle_fixture', [
        assertion('oracle_fixture', {
          id: 'a1',
          type: 'explicit_absence',
          statement: ANSWER,
          quote: ANSWER,
          supersedes: 'position_party_a_x',
        }),
      ]),
    );
    expect(result.ok).toBe(true);
  });
});

describe('13-16: the V0.4 contract is the gate', () => {
  it('13. an unasked own requirement in context is accepted', () => {
    // in_reply_to names only REQ; the assertion targets REQ_B, which is in the
    // supplied context. V0.3 would emit compiler_requirement_not_answered.
    const evalCase = caseWith(
      [{ expectation_id: 'e_volunteered', requirement_id: REQ_B, type: 'narrative_fact' }],
      { category: 'volunteered_unasked_requirement' },
    );
    expect(
      grade(
        evalCase,
        output('oracle_fixture', [
          assertion('oracle_fixture', { id: 'a1', requirement: REQ_B, statement: FACT_B }),
        ]),
      ).ok,
    ).toBe(true);
  });

  it('14. a requirement NOT in context is refused', () => {
    const evalCase = caseWith([
      { expectation_id: 'e_outside', requirement_id: UNASKED, type: 'narrative_fact' },
    ]);
    const result = grade(
      evalCase,
      output('oracle_fixture', [
        assertion('oracle_fixture', { id: 'a1', requirement: UNASKED, statement: FACT_A }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('contract');
    expect(result.hard_blockers.some((f) => f.rule === 'contract')).toBe(true);
  });

  it('15. a same-slot duplicate output is accepted by the V0.4 contract', () => {
    expect(
      grade(
        caseWith(TWO_SAME_SLOT),
        output('oracle_fixture', [
          assertion('oracle_fixture', { id: 'a1', statement: FACT_A }),
          assertion('oracle_fixture', { id: 'a2', statement: FACT_B }),
        ]),
      ).ok,
    ).toBe(true);
  });

  it('16. the SAME output is still rejected by the historical V0.3 contract', () => {
    // Demonstrates the gate actually moved, rather than the fixture being easy.
    const evalCase = caseWith(TWO_SAME_SLOT);
    const out = output('oracle_fixture', [
      assertion('oracle_fixture', { id: 'a1', statement: FACT_A }),
      assertion('oracle_fixture', { id: 'a2', statement: FACT_B }),
    ]);
    const v03 = validateCompilerOutput(buildEvalInputV04(evalCase), out).map((i) => i.code);
    expect(v03).toContain('compiler_assertion_slot_duplicate');
  });
});

describe('17-20: grounding, restatement and fabrication', () => {
  it('17. an assertion grounded only in assistant context FAILS', () => {
    const contextText = 'The assistant says the deadline was 1 July.';
    const evalCase = caseWith(
      [{ expectation_id: 'e_ctx', requirement_id: REQ, type: 'narrative_fact' }],
      { context: [contextText], category: 'no_context_laundering' },
    );
    const result = grade(
      evalCase,
      output('oracle_fixture', [
        assertion('oracle_fixture', {
          id: 'a1',
          statement: contextText,
          quote: contextText,
          region: 'context',
          haystack: contextText,
        }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('grounding.no_answer_region');
    expect(result.hard_blockers.some((f) => f.rule === 'grounding.no_answer_region')).toBe(true);
  });

  it('18. a pure restatement expecting zero assertions passes on no_assertions', () => {
    const evalCase = caseWith([], {
      category: 'pure_restatement',
      expect: { verdict: 'no_assertions', assertions: [], clarifications: [] },
    });
    expect(grade(evalCase, output('oracle_fixture', [], 'no_assertions')).ok).toBe(true);
  });

  it('19. the same case emitting one assertion FAILS closed-world', () => {
    const evalCase = caseWith([], {
      category: 'pure_restatement',
      expect: { verdict: 'no_assertions', assertions: [], clarifications: [] },
    });
    const result = grade(
      evalCase,
      output(
        'oracle_fixture',
        [assertion('oracle_fixture', { id: 'a1', statement: FACT_A })],
        'no_assertions',
      ),
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('assertions.undeclared_extra');
    expect(rules(result)).toContain('fail_closed.no_assertions_with_assertions');
  });

  it('20. a fabricated value not permitted by the fixture FAILS', () => {
    const evalCase = caseWith(
      [
        {
          expectation_id: 'e_fact',
          requirement_id: REQ,
          type: 'narrative_fact',
          statement_mentions: ['15 July'],
        },
      ],
      {
        category: 'no_manufacture',
        expect: {
          verdict: 'accepted_candidates',
          assertions: [
            {
              expectation_id: 'e_fact',
              requirement_id: REQ,
              type: 'narrative_fact',
              statement_mentions: ['15 July'],
            },
          ],
          clarifications: [],
          statements_must_not_mention: ['5,000'],
        },
      },
    );
    const result = grade(
      evalCase,
      output('oracle_fixture', [
        assertion('oracle_fixture', { id: 'a1', statement: `${FACT_A} for 5,000`, quote: FACT_A }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('output.forbidden_literal');
    expect(result.hard_blockers.some((f) => f.rule === 'output.forbidden_literal')).toBe(true);
  });
});

describe('blocker severity cannot be averaged away', () => {
  it('a material adverse fact missing is a HARD BLOCKER, an ordinary miss is not', () => {
    const adverse = grade(
      caseWith([
        {
          expectation_id: 'e_adverse',
          requirement_id: REQ,
          type: 'narrative_fact',
          material_adverse_fact: true,
        },
      ]),
      output('oracle_fixture', []),
    );
    expect(adverse.hard_blockers.map((f) => f.rule)).toContain(
      'assertions.material_adverse_fact_missing',
    );

    const ordinary = grade(
      caseWith([{ expectation_id: 'e_plain', requirement_id: REQ, type: 'narrative_fact' }]),
      output('oracle_fixture', []),
    );
    expect(ordinary.ordinary_failures.map((f) => f.rule)).toContain('assertions.required_missing');
    expect(ordinary.hard_blockers).toEqual([]);
  });

  it('an optional expectation may be omitted without failing', () => {
    expect(
      grade(
        caseWith([
          { expectation_id: 'e_opt', requirement_id: REQ, type: 'narrative_fact', optional: true },
        ]),
        output('oracle_fixture', []),
      ).ok,
    ).toBe(true);
  });

  it('every failure carries a severity, and the two sets partition the whole', () => {
    const result = grade(
      caseWith(TWO_SAME_SLOT),
      output('oracle_fixture', [assertion('oracle_fixture', { id: 'a1', statement: 'unrelated' })]),
    );
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.hard_blockers.length + result.ordinary_failures.length).toBe(
      result.failures.length,
    );
    for (const entry of result.failures) {
      expect(['hard_blocker', 'ordinary']).toContain(entry.severity);
    }
  });
});

describe('the oracle speaks the V0.4 vocabulary, not the V0.2 one', () => {
  /**
   * Regression for a wrong-oracle bug caught while building this PR.
   *
   * The historical `validateCompilerOutputShape` lives in `src/webmcp/runtime/`
   * and validates proposition types against the V0.2-era `core/types.js`
   * vocabulary, which has NO `explicit_absence`. Gating the V0.4 grader on it
   * rejected every assertion in an entire corpus family — including V0.3's own
   * hard-won absence corpus — while reporting only a generic "shape" failure.
   *
   * A green score from the wrong oracle is worse than no score; a RED score
   * from the wrong oracle is how you spend a day tuning a prompt that was
   * already right.
   */
  it('grades an explicit_absence assertion instead of rejecting it', () => {
    const evalCase = caseWith(
      [{ expectation_id: 'e_absence', requirement_id: REQ, type: 'explicit_absence' }],
      {
        category: 'explicit_absence',
        requirement_context: [
          { requirement_id: REQ, satisfying_types: ['narrative_fact', 'explicit_absence'] },
        ],
      },
    );
    const result = grade(
      evalCase,
      output('oracle_fixture', [
        assertion('oracle_fixture', {
          id: 'a1',
          type: 'explicit_absence',
          statement: ANSWER,
          quote: ANSWER,
        }),
      ]),
    );
    expect(result.ok).toBe(true);
  });

  it('still rejects a genuinely unknown proposition type', () => {
    // Dropping the V0.2 shape gate must not drop type validation: the V0.4
    // contract carries it, against the correct vocabulary.
    const evalCase = caseWith([
      { expectation_id: 'e_bogus', requirement_id: REQ, type: 'narrative_fact' },
    ]);
    const result = grade(
      evalCase,
      output('oracle_fixture', [
        assertion('oracle_fixture', { id: 'a1', type: 'vibes', statement: FACT_A }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('contract');
  });

  it('still rejects an unknown epistemic strength', () => {
    const evalCase = caseWith([
      { expectation_id: 'e_strength', requirement_id: REQ, type: 'narrative_fact' },
    ]);
    const result = grade(
      evalCase,
      output('oracle_fixture', [
        assertion('oracle_fixture', { id: 'a1', statement: FACT_A, strength: 'quite_sure' }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('contract');
  });
});
