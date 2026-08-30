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
  gradeCompilerOutput,
  offlineCorpusCompiler,
  runMalformedSuite,
  runOfflineCorpus,
  runTrapSuite,
  SEMANTIC_EVAL_CORPUS,
  SEMANTIC_EVAL_CORPUS_VERSION,
  type EvalCategory,
} from '../webmcp/eval/index.js';
import { validateCaseState } from '../webmcp/core/structural-validator.js';
import { validateCompilerOutput } from '../webmcp/core/compiler-contract.js';
import { fixedModelClient, ModelSemanticCompiler } from '../webmcp/compiler/index.js';

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

describe('the graders themselves have teeth', () => {
  const anchor = SEMANTIC_EVAL_CORPUS.find((entry) => entry.id === 'accept.payment')!;

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
    // place; the grader names both rather than just saying "did not match".
    expect(grade.failures.join(' ')).toMatch(/9,999/u);
    expect(grade.failures.join(' ')).toMatch(/req_paid/u);
  });
});
