/**
 * The offline semantic eval, run as CI.
 *
 * This suite needs no API key, no network and no paid model call: the real
 * `ModelSemanticCompiler` runs over a replay client at the provider seam. What
 * it proves is that the pipeline and the graders behave. It proves nothing
 * about any model's quality, and the assertions below are worded so that a
 * green run cannot be read as saying otherwise.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEvalScenario,
  formatEvalReport,
  gradeCompilerOutput,
  offlineCorpusCompiler,
  runMalformedSuite,
  runOfflineCorpus,
  runSemanticEval,
  runTrapSuite,
  SEMANTIC_EVAL_CORPUS,
  SEMANTIC_EVAL_CORPUS_VERSION,
  type EvalCategory,
} from '../webmcp/eval/index.js';
import { validateCaseState } from '../webmcp/core/structural-validator.js';
import { validateCompilerOutput } from '../webmcp/core/compiler-contract.js';
import { fixedModelClient, ModelSemanticCompiler } from '../webmcp/compiler/index.js';
import { runBoundary } from '../webmcp/eval/runner.js';

const REQUIRED_CATEGORIES: EvalCategory[] = [
  'accepted_extraction',
  'epistemic_strength',
  'expected_date_vs_deadline',
  'non_recollection',
  'declined_answer',
  'unrelated_answer',
  'multiple_readings',
  'correction',
  'refinement_uncertainty',
  'adverse_fact',
  'context_contamination',
  'prompt_injection',
  'fabrication_resistance',
  'translation_provenance',
  'existing_proposition_awareness',
];

describe('the semantic eval corpus', () => {
  it('covers every V0.2 category', () => {
    const present = new Set(SEMANTIC_EVAL_CORPUS.map((entry) => entry.category));
    for (const category of REQUIRED_CATEGORIES) {
      expect(present, 'missing eval category: ' + category).toContain(category);
    }
  });

  it('uses unique case ids', () => {
    const ids = SEMANTIC_EVAL_CORPUS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is versioned', () => {
    expect(SEMANTIC_EVAL_CORPUS_VERSION).toMatch(/^juryai-semantic-eval-corpus-v/u);
  });

  it('builds a scenario the structural validator already accepts', () => {
    // A seeded case the runtime would have refused proves nothing about the
    // compiler, so the starting state of every scenario is validated first.
    const compiler = offlineCorpusCompiler(() => undefined);
    for (const evalCase of SEMANTIC_EVAL_CORPUS) {
      const scenario = buildEvalScenario(evalCase, compiler.registryEntry);
      const report = validateCaseState(scenario.state);
      expect(
        report.issues,
        evalCase.id + ' seeded state: ' + JSON.stringify(report.issues),
      ).toEqual([]);
    }
  });
});

describe('offline semantic eval', () => {
  it('passes every case in the corpus', async () => {
    const report = await runOfflineCorpus();
    const failures = report.results
      .filter((result) => !result.ok)
      .map(
        (result) =>
          result.case_id + ': ' + (result.grade?.failures.join('; ') ?? result.compiler_error),
      );
    expect(failures).toEqual([]);
    expect(report.passed).toBe(SEMANTIC_EVAL_CORPUS.length);
  });

  it('takes every accepted reading through the full runtime guard chain', async () => {
    const report = await runOfflineCorpus();
    for (const result of report.results) {
      expect(result.boundary?.disposition, result.case_id).toBe('committed');
    }
  });

  it('reports the replay artefact, never a live model identity', async () => {
    const report = await runOfflineCorpus();
    expect(report.model_id).toBe('juryai-offline-replay');
    expect(report.model_snapshot).toBeNull();
    expect(report.compiler_version_id).toMatch(/^[a-f0-9]{64}$/u);
  });
});

describe('the trap suite', () => {
  it('refuses every completion that must be refused, at the intended layer', async () => {
    const report = await runTrapSuite();
    const failures = report.results
      .filter((result) => !result.ok)
      .map(
        (result) =>
          result.case_id +
          ' / ' +
          result.trap +
          ': expected ' +
          result.expected_layer +
          ', got ' +
          (result.actual_layer ?? 'NOT CAUGHT') +
          ' — ' +
          result.detail,
      );
    expect(failures).toEqual([]);
    // Without traps, a corpus of hand-written good answers only proves the
    // graders can be satisfied. This is the assertion that they can be failed.
    expect(report.trap_count).toBeGreaterThanOrEqual(20);
  });

  it('has traps that exercise all three refusal layers', async () => {
    const report = await runTrapSuite();
    const layers = new Set(report.results.map((result) => result.expected_layer));
    expect(layers).toContain('compiler');
    expect(layers).toContain('boundary');
    expect(layers).toContain('grader');
  });
});

describe('malformed provider output', () => {
  it('is never normalised into something that looks valid', async () => {
    const results = await runMalformedSuite();
    expect(results.filter((result) => !result.rejected)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(8);
  });
});

describe('every corpus case takes an explicit stance on extra output', () => {
  it('declares a closed assertion world', () => {
    // The field is required by the type, so this is really an assertion that no
    // case has quietly declared a wide-open world to make itself easy to pass.
    for (const evalCase of SEMANTIC_EVAL_CORPUS) {
      expect(Array.isArray(evalCase.expect.assertions), evalCase.id).toBe(true);
      for (const slot of evalCase.expect.assertions) {
        expect(slot.max ?? 1, evalCase.id).toBeLessThanOrEqual(2);
        expect(slot.citation_must_mention.length, evalCase.id).toBeGreaterThan(0);
        for (const alternatives of slot.citation_must_mention) {
          expect(alternatives.length, evalCase.id).toBeGreaterThan(0);
          expect(
            alternatives.every((term) => term.trim().length > 0),
            evalCase.id,
          ).toBe(true);
        }
      }
    }
  });

  it('permits no assertion at all where the case expects none', () => {
    for (const evalCase of SEMANTIC_EVAL_CORPUS) {
      if (evalCase.expect.verdict === 'accepted_candidates') continue;
      // `ambiguous` and `no_assertions` may never carry an accepted reading, so
      // their allowed set has to be empty rather than merely small.
      expect(evalCase.expect.assertions, evalCase.id).toEqual([]);
    }
  });

  it('declares a closed clarification world, as requirement/reason pairs', () => {
    for (const evalCase of SEMANTIC_EVAL_CORPUS) {
      expect(Array.isArray(evalCase.expect.clarifications), evalCase.id).toBe(true);
      for (const pair of evalCase.expect.clarifications) {
        expect(pair.requirement_id, evalCase.id).toMatch(/^req_/u);
        expect(pair.reason, evalCase.id).toBeTypeOf('string');
        expect(pair.prompt_must_mention.length, evalCase.id).toBeGreaterThan(0);
        for (const alternatives of pair.prompt_must_mention) {
          expect(alternatives.length, evalCase.id).toBeGreaterThan(0);
          expect(
            alternatives.every((term) => term.trim().length > 0),
            evalCase.id,
          ).toBe(true);
        }
      }
      if (evalCase.expect.verdict === 'ambiguous') {
        // The contract requires an ambiguous verdict to ask for something.
        expect(evalCase.expect.clarifications.length, evalCase.id).toBeGreaterThan(0);
      }
    }
  });
});

describe('the graders themselves have teeth', () => {
  const anchor = SEMANTIC_EVAL_CORPUS.find((entry) => entry.id === 'accept.payment')!;
  const ambiguous = SEMANTIC_EVAL_CORPUS.find(
    (entry) => entry.id === 'ambiguous.multiple_readings',
  )!;
  const unrelated = SEMANTIC_EVAL_CORPUS.find((entry) => entry.id === 'unrelated.answer')!;
  const expectedDate = SEMANTIC_EVAL_CORPUS.find(
    (entry) => entry.id === 'deadline.expectation_only',
  )!;

  async function compileCompletion(evalCase: typeof anchor, completion: string) {
    const compiler = new ModelSemanticCompiler({
      client: fixedModelClient(completion),
      model_id: 'juryai-offline-replay',
      model_snapshot: null,
    });
    const scenario = buildEvalScenario(evalCase, compiler.registryEntry);
    const output = await compiler.compile(structuredClone(scenario.input));
    return { scenario, output };
  }

  it('refuses a correct reading carrying an extra false assertion', async () => {
    // The exact trap from the review: a true `payment` plus a contract-valid
    // but semantically false `non_recollection` for the same requirement.
    const { scenario, output } = await compileCompletion(
      anchor,
      JSON.stringify({
        verdict: 'accepted_candidates',
        assertions: [
          {
            requirement_id: 'req_paid',
            proposed_type: 'payment',
            epistemic_strength: 'asserted_confident',
            statement: 'The user paid the other party 2,000 pounds by bank transfer on 25 April.',
            supersedes_candidate: null,
            citations: [
              {
                region: 'answer',
                message_index: null,
                quote: 'I paid them 2,000 pounds by bank transfer on 25 April',
              },
            ],
          },
          {
            requirement_id: 'req_paid',
            proposed_type: 'non_recollection',
            epistemic_strength: 'non_recollection',
            statement: 'The user does not remember whether any further payments were made.',
            supersedes_candidate: null,
            citations: [{ region: 'answer', message_index: null, quote: 'and nothing since' }],
          },
        ],
        rejected_candidates: [],
        clarifications_requested: [],
      }),
    );

    // The runtime takes it, and is right to: both readings satisfy req_paid,
    // they are different types so nothing collides, and both quote exactly.
    expect(validateCompilerOutput(scenario.input, output)).toEqual([]);
    const boundary = runBoundary(
      scenario.state,
      scenario.input,
      output,
      anchor,
      scenario.next_case_version,
    );
    expect(boundary.disposition).toBe('committed');

    // Everything the OLD reason-blind grading checked is still satisfied here,
    // which is exactly why a blacklist could not catch it.
    expect(output.assertions.some((a) => a.proposed_type === 'payment')).toBe(true);
    expect(output.assertions.some((a) => a.proposed_type === 'invoice')).toBe(false);

    // The closed world is the layer that refuses it.
    const grade = gradeCompilerOutput(anchor, scenario.input, output);
    expect(grade.ok).toBe(false);
    expect(grade.failures.join(' ')).toMatch(/over-extraction/u);
    expect(grade.failures.join(' ')).toMatch(/type\/requirement pairing/u);
  });

  it('refuses a clarification whose reason is attached to the wrong requirement', async () => {
    const { scenario, output } = await compileCompletion(
      ambiguous,
      JSON.stringify({
        verdict: 'ambiguous',
        assertions: [],
        rejected_candidates: [],
        clarifications_requested: [
          {
            requirement_id: 'req_own_performance',
            reason: 'multiple_incompatible_readings',
            prompt: 'Which of several things did you mean?',
          },
        ],
      }),
    );

    // req_own_performance is a real requirement on this case, so the runtime
    // opens the clarification without complaint. It cannot know the ambiguity
    // was about a date.
    expect(validateCompilerOutput(scenario.input, output)).toEqual([]);
    const boundary = runBoundary(
      scenario.state,
      scenario.input,
      output,
      ambiguous,
      scenario.next_case_version,
    );
    expect(boundary.disposition).toBe('committed');

    // Reason-only grading would have passed this: the expected reason IS
    // present somewhere in the output.
    expect(
      output.clarifications_requested.some((c) => c.reason === 'multiple_incompatible_readings'),
    ).toBe(true);

    // Atomic pairing is what refuses it.
    const grade = gradeCompilerOutput(ambiguous, scenario.input, output);
    expect(grade.ok).toBe(false);
    expect(grade.failures.join(' ')).toMatch(/no single clarification carried both/u);
  });

  it('refuses a clarification with the right metadata but an unrelated prompt', async () => {
    const { scenario, output } = await compileCompletion(
      ambiguous,
      JSON.stringify({
        verdict: 'ambiguous',
        assertions: [],
        rejected_candidates: [],
        clarifications_requested: [
          {
            requirement_id: 'req_invoiced',
            reason: 'multiple_incompatible_readings',
            prompt: 'How much sleep did you get last night?',
          },
        ],
      }),
    );

    // Prompt meaning is outside the runtime's structural boundary, so only the
    // semantic grader can catch a question that would send the human elsewhere.
    expect(validateCompilerOutput(scenario.input, output)).toEqual([]);
    expect(
      runBoundary(scenario.state, scenario.input, output, ambiguous, scenario.next_case_version)
        .disposition,
    ).toBe('committed');

    const grade = gradeCompilerOutput(ambiguous, scenario.input, output);
    expect(grade.ok).toBe(false);
    expect(grade.failures.join(' ')).toMatch(/clarification.*prompt.*topic/u);
  });

  it('refuses duplicate metadata even when a later prompt has the right topics', async () => {
    const { scenario, output } = await compileCompletion(
      ambiguous,
      JSON.stringify({
        verdict: 'ambiguous',
        assertions: [],
        rejected_candidates: [],
        clarifications_requested: [
          {
            requirement_id: 'req_invoiced',
            reason: 'multiple_incompatible_readings',
            prompt: 'How much sleep did you get last night?',
          },
          {
            requirement_id: 'req_invoiced',
            reason: 'multiple_incompatible_readings',
            prompt: 'Is the 15th the invoice date or the payment date?',
          },
        ],
      }),
    );

    // The runtime commits the first clarification and drops the duplicate, so
    // existential grading would approve the second prompt while exposing the
    // unrelated first prompt to the human.
    expect(validateCompilerOutput(scenario.input, output)).toEqual([]);
    expect(
      runBoundary(scenario.state, scenario.input, output, ambiguous, scenario.next_case_version)
        .disposition,
    ).toBe('committed');

    const grade = gradeCompilerOutput(ambiguous, scenario.input, output);
    expect(grade.ok).toBe(false);
    expect(grade.failures.join(' ')).toMatch(/duplicate clarification/u);
    expect(grade.failures.join(' ')).toMatch(/prompt.*topic/u);
  });

  it('allows an invoice clarification to name the subject it asks about', async () => {
    const { scenario, output } = await compileCompletion(
      unrelated,
      JSON.stringify({
        verdict: 'ambiguous',
        assertions: [],
        rejected_candidates: [],
        clarifications_requested: [
          {
            requirement_id: 'req_invoiced',
            reason: 'answer_does_not_address_requirement',
            prompt: 'What date did you receive the invoice?',
          },
        ],
      }),
    );

    const grade = gradeCompilerOutput(unrelated, scenario.input, output);
    expect(grade.failures).toEqual([]);
    expect(grade.ok).toBe(true);
  });

  it('refuses an extra clarification on a requirement the case did not expect', async () => {
    const { scenario, output } = await compileCompletion(
      ambiguous,
      JSON.stringify({
        verdict: 'ambiguous',
        assertions: [],
        rejected_candidates: [],
        clarifications_requested: [
          {
            requirement_id: 'req_invoiced',
            reason: 'multiple_incompatible_readings',
            prompt: 'Is the 15th the date you were invoiced or the date you paid?',
          },
          {
            requirement_id: 'req_own_performance',
            reason: 'answer_does_not_address_requirement',
            prompt: 'Did you do everything you were meant to?',
          },
        ],
      }),
    );
    expect(validateCompilerOutput(scenario.input, output)).toEqual([]);
    const grade = gradeCompilerOutput(ambiguous, scenario.input, output);
    expect(grade.ok).toBe(false);
    expect(grade.failures.join(' ')).toMatch(/unexpected .* requirement pairing/u);
    expect(grade.failures.join(' ')).not.toContain('req_own_performance');
  });

  it('fails a contract-valid reading that fabricates a value', async () => {
    const completion = JSON.stringify({
      verdict: 'accepted_candidates',
      assertions: [
        {
          requirement_id: 'req_paid',
          proposed_type: 'payment',
          epistemic_strength: 'asserted_confident',
          statement: 'The user paid 9,999 pounds on 25 April.',
          supersedes_candidate: null,
          citations: [{ region: 'answer', message_index: null, quote: 'I paid them 2,000 pounds' }],
        },
      ],
      rejected_candidates: [],
      clarifications_requested: [],
    });
    const compiler = new ModelSemanticCompiler({
      client: fixedModelClient(completion),
      model_id: 'juryai-offline-replay',
      model_snapshot: null,
    });
    const scenario = buildEvalScenario(anchor, compiler.registryEntry);
    const output = await compiler.compile(structuredClone(scenario.input));

    // The runtime would take this: it is contract-valid and exactly grounded.
    expect(validateCompilerOutput(scenario.input, output)).toEqual([]);
    // The grader is what catches it, which is the point of grading meaning.
    const grade = gradeCompilerOutput(anchor, scenario.input, output);
    expect(grade.ok).toBe(false);
    // The value the user actually gave is absent and an invented one is in its
    // place. The grader identifies the rule without echoing provider content.
    expect(grade.failures.join(' ')).toMatch(/unsupported fact/u);
    expect(grade.failures.join(' ')).not.toContain('9,999');
    expect(grade.failures.join(' ')).toMatch(/req_paid/u);
  });

  it('refuses an assertion whose exact citation does not support its meaning', async () => {
    const { scenario, output } = await compileCompletion(
      expectedDate,
      JSON.stringify({
        verdict: 'accepted_candidates',
        assertions: [
          {
            requirement_id: 'req_expected_date',
            proposed_type: 'target_date',
            epistemic_strength: 'asserted_confident',
            statement: 'The user expected the work to be finished by Friday 12 June.',
            supersedes_candidate: null,
            citations: [
              {
                region: 'answer',
                message_index: null,
                quote: 'nobody promised me one',
              },
            ],
          },
        ],
        rejected_candidates: [],
        clarifications_requested: [],
      }),
    );

    // The quotation is exact and the runtime therefore commits it, but it is
    // evidence against a binding promise rather than support for the expected
    // completion date asserted here.
    expect(validateCompilerOutput(scenario.input, output)).toEqual([]);
    expect(
      runBoundary(scenario.state, scenario.input, output, expectedDate, scenario.next_case_version)
        .disposition,
    ).toBe('committed');

    const grade = gradeCompilerOutput(expectedDate, scenario.input, output);
    expect(grade.ok).toBe(false);
    expect(grade.failures.join(' ')).toMatch(/citation.*support/u);
  });

  async function paymentWithStatement(statement: string) {
    return compileCompletion(
      anchor,
      JSON.stringify({
        verdict: 'accepted_candidates',
        assertions: [
          {
            requirement_id: 'req_paid',
            proposed_type: 'payment',
            epistemic_strength: 'asserted_confident',
            statement,
            supersedes_candidate: null,
            citations: [
              {
                region: 'answer',
                message_index: null,
                quote: 'I paid them 2,000 pounds by bank transfer on 25 April',
              },
            ],
          },
        ],
        rejected_candidates: [],
        clarifications_requested: [],
      }),
    );
  }

  it('keeps provider-controlled requirement ids out of eval reports', async () => {
    const injectedRequirement = 'John Smith paid 2,000 pounds\nfor another matter';
    const compiler = new ModelSemanticCompiler({
      client: fixedModelClient(
        JSON.stringify({
          verdict: 'accepted_candidates',
          assertions: [
            {
              requirement_id: injectedRequirement,
              proposed_type: 'payment',
              epistemic_strength: 'asserted_confident',
              statement: 'The user paid the other party 2,000 pounds by bank transfer on 25 April.',
              supersedes_candidate: null,
              citations: [
                {
                  region: 'answer',
                  message_index: null,
                  quote: 'I paid them 2,000 pounds by bank transfer on 25 April',
                },
              ],
            },
          ],
          rejected_candidates: [],
          clarifications_requested: [],
        }),
      ),
      model_id: 'juryai-offline-replay',
      model_snapshot: null,
    });

    const report = await runSemanticEval({ compiler, cases: [anchor] });
    expect(report.failed).toBe(1);
    const rendered = formatEvalReport(report);
    expect(rendered).not.toContain(injectedRequirement);
    expect(rendered).not.toContain('John Smith');
    expect(rendered).not.toContain('another matter');
  });

  it('refuses a lowercase named fact absent from otherwise supporting citations', async () => {
    const statement = 'The user paid john smith 2,000 pounds by bank transfer on 25 April.';
    const { scenario, output } = await paymentWithStatement(statement);

    expect(validateCompilerOutput(scenario.input, output)).toEqual([]);
    expect(
      runBoundary(scenario.state, scenario.input, output, anchor, scenario.next_case_version)
        .disposition,
    ).toBe('committed');

    const grade = gradeCompilerOutput(anchor, scenario.input, output);
    expect(grade.ok).toBe(false);
    expect(grade.failures.join(' ')).toMatch(/unsupported (?:fact|entity)/u);
    expect(grade.failures.join(' ')).not.toContain('john smith');
  });

  it('refuses a single-token named fact absent from otherwise supporting citations', async () => {
    const { scenario, output } = await paymentWithStatement(
      'Payment to Alice of 2,000 pounds by bank transfer was made on 25 April.',
    );

    const grade = gradeCompilerOutput(anchor, scenario.input, output);
    expect(grade.ok).toBe(false);
    expect(grade.failures.join(' ')).toMatch(/unsupported (?:fact|entity)/u);
    expect(grade.failures.join(' ')).not.toContain('Alice');
  });

  it.each(['$', '£', '€'])('refuses an unsupported %s currency symbol', async (symbol) => {
    const { scenario, output } = await paymentWithStatement(
      `Payment of ${symbol}2,000 by bank transfer was made on 25 April.`,
    );

    const grade = gradeCompilerOutput(anchor, scenario.input, output);
    expect(grade.ok).toBe(false);
    expect(grade.failures.join(' ')).toMatch(/unsupported fact/u);
    expect(grade.failures.join(' ')).not.toContain(symbol);
  });

  it('does not print a fabricated name in grader failures', async () => {
    const statement = 'The user paid John Smith 2,000 pounds by bank transfer on 25 April.';
    const { scenario, output } = await paymentWithStatement(statement);

    const grade = gradeCompilerOutput(anchor, scenario.input, output);
    expect(grade.ok).toBe(false);
    expect(grade.failures.join(' ')).not.toContain('John Smith');
    expect(grade.failures.join(' ')).not.toContain(statement);
  });

  it('allows a valid sentence-initial Payment paraphrase', async () => {
    const { scenario, output } = await paymentWithStatement(
      'Payment of 2,000 pounds by bank transfer was made to the other party on 25 April.',
    );

    const grade = gradeCompilerOutput(anchor, scenario.input, output);
    expect(grade.failures).toEqual([]);
    expect(grade.ok).toBe(true);
  });
});
