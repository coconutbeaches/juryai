/**
 * Offline checks for the deterministic semantic-compiler eval contract.
 *
 * The replay corpus proves compiler plumbing, explicit fixture gates, and the
 * real runtime boundary. It does not claim that TypeScript can judge arbitrary
 * English or that a live model has semantic quality.
 */

import { describe, expect, it } from 'vitest';
import { validateCaseState } from '../webmcp/core/structural-validator.js';
import { fixedModelClient, ModelSemanticCompiler } from '../webmcp/compiler/index.js';
import {
  buildEvalScenario,
  formatEvalReport,
  formatProviderModelIdentifier,
  gradeCompilerOutput,
  offlineCorpusCompiler,
  runMalformedSuite,
  runOfflineCorpus,
  runSemanticEval,
  runTrapSuite,
  SEMANTIC_EVAL_CORPUS,
  SEMANTIC_EVAL_CORPUS_VERSION,
  type EvalCategory,
  type SemanticEvalCase,
} from '../webmcp/eval/index.js';

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

function corpusCase(id: string): SemanticEvalCase {
  const found = SEMANTIC_EVAL_CORPUS.find((entry) => entry.id === id);
  if (!found) throw new Error('Missing corpus fixture.');
  return found;
}

async function compileFixture(
  evalCase: SemanticEvalCase,
  completion = evalCase.offline_completion,
) {
  const compiler = new ModelSemanticCompiler({
    client: fixedModelClient(completion),
    model_id: 'juryai-offline-replay',
    model_snapshot: null,
  });
  const scenario = buildEvalScenario(evalCase, compiler.registryEntry);
  const output = await compiler.compile(structuredClone(scenario.input));
  return { compiler, scenario, output };
}

describe('semantic eval corpus', () => {
  it('retains all 27 versioned scenarios and required categories', () => {
    expect(SEMANTIC_EVAL_CORPUS).toHaveLength(27);
    expect(SEMANTIC_EVAL_CORPUS_VERSION).toMatch(/^juryai-semantic-eval-corpus-v/u);
    const ids = SEMANTIC_EVAL_CORPUS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set(SEMANTIC_EVAL_CORPUS.map((entry) => entry.category));
    for (const category of REQUIRED_CATEGORIES) expect(categories).toContain(category);
  });

  it('builds structurally valid seeded states', () => {
    const compiler = offlineCorpusCompiler(() => undefined);
    for (const evalCase of SEMANTIC_EVAL_CORPUS) {
      const scenario = buildEvalScenario(evalCase, compiler.registryEntry);
      expect(validateCaseState(scenario.state).issues, evalCase.id).toEqual([]);
    }
  });

  it('declares closed assertion and clarification worlds', () => {
    for (const evalCase of SEMANTIC_EVAL_CORPUS) {
      expect(Array.isArray(evalCase.expect.assertions), evalCase.id).toBe(true);
      expect(Array.isArray(evalCase.expect.clarifications), evalCase.id).toBe(true);
      if (evalCase.expect.verdict !== 'accepted_candidates') {
        expect(evalCase.expect.assertions, evalCase.id).toEqual([]);
      }
      if (evalCase.expect.verdict === 'ambiguous') {
        expect(evalCase.expect.clarifications.length, evalCase.id).toBeGreaterThan(0);
      }
    }
  });
});

describe('offline replay and runtime boundary', () => {
  it('passes every recorded completion through both layers', async () => {
    const report = await runOfflineCorpus();
    expect(
      report.results
        .filter((result) => !result.ok)
        .map((result) => ({
          case_id: result.case_id,
          failures: result.grade?.failures ?? [result.compiler_error],
          boundary: result.boundary?.disposition,
        })),
    ).toEqual([]);
    expect(report.passed).toBe(27);
    for (const result of report.results) {
      expect(result.boundary?.disposition, result.case_id).toBe('committed');
    }
  });

  it('identifies the replay artefact rather than a live model', async () => {
    const report = await runOfflineCorpus();
    expect(report.model_id).toBe('juryai-offline-replay');
    expect(report.model_snapshot).toBeNull();
    expect(report.compiler_version_id).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('keeps bounded provider identifiers content-free', () => {
    expect(formatProviderModelIdentifier('gpt-5.6-2026-08-01')).toBe('gpt-5.6-2026-08-01');
    expect(formatProviderModelIdentifier('PRIVATE PERSON\nPRIVATE CASE TEXT')).toBe(
      '(invalid provider identifier)',
    );
  });

  it('catches every retained trap at its declared layer', async () => {
    const report = await runTrapSuite();
    expect(
      report.results
        .filter((result) => !result.ok)
        .map((result) => ({
          case_id: result.case_id,
          trap: result.trap,
          expected: result.expected_layer,
          actual: result.actual_layer,
          detail: result.detail,
        })),
    ).toEqual([]);
    expect(report.trap_count).toBeGreaterThan(0);
    expect(new Set(report.results.map((result) => result.expected_layer))).toEqual(
      new Set(['compiler', 'boundary', 'grader']),
    );
  });

  it('rejects malformed provider output instead of normalising it', async () => {
    const results = await runMalformedSuite();
    expect(results.filter((result) => !result.rejected)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(8);
  });
});

describe('deterministic assertion expectations', () => {
  it('accepts the expected verdict and rejects a different verdict', async () => {
    const evalCase = corpusCase('accept.payment');
    const { scenario, output } = await compileFixture(evalCase);
    expect(gradeCompilerOutput(evalCase, scenario.input, output).failures).toEqual([]);

    const wrong = structuredClone(output);
    wrong.verdict = 'no_assertions';
    expect(gradeCompilerOutput(evalCase, scenario.input, wrong).failures).toContain(
      'verdict: output did not match the expected verdict',
    );
  });

  it('enforces required, undeclared, and cardinality-limited slots', async () => {
    const evalCase = corpusCase('accept.payment');
    const { scenario, output } = await compileFixture(evalCase);

    const missing = structuredClone(output);
    missing.assertions = [];
    expect(gradeCompilerOutput(evalCase, scenario.input, missing).failures).toContain(
      'assertions: required slot is missing',
    );

    const unexpected = structuredClone(output);
    unexpected.assertions[0]!.requirement_id = 'req_invoiced';
    expect(gradeCompilerOutput(evalCase, scenario.input, unexpected).failures).toContain(
      'assertions: output occupied an undeclared slot',
    );

    const duplicate = structuredClone(output);
    duplicate.assertions.push({ ...structuredClone(output.assertions[0]!), assertion_id: 'a-2' });
    expect(gradeCompilerOutput(evalCase, scenario.input, duplicate).failures).toContain(
      'assertions: slot cardinality exceeded',
    );
  });

  it('enforces explicitly allowed epistemic strength', async () => {
    const evalCase = corpusCase('accept.payment');
    const { scenario, output } = await compileFixture(evalCase);
    const wrong = structuredClone(output);
    wrong.assertions[0]!.epistemic_strength = 'asserted_qualified';
    expect(gradeCompilerOutput(evalCase, scenario.input, wrong).failures).toContain(
      'assertions: slot used a disallowed epistemic strength',
    );
  });

  it('enforces required and globally forbidden supersession', async () => {
    const correction = corpusCase('correction.explicit');
    const compiledCorrection = await compileFixture(correction);
    expect(
      gradeCompilerOutput(correction, compiledCorrection.scenario.input, compiledCorrection.output)
        .failures,
    ).toEqual([]);

    const missing = structuredClone(compiledCorrection.output);
    missing.assertions[0]!.supersedes_candidate = null;
    expect(
      gradeCompilerOutput(correction, compiledCorrection.scenario.input, missing).failures,
    ).toContain('assertions: slot used an unexpected supersession target');

    const payment = structuredClone(corpusCase('accept.payment'));
    payment.expect.forbid_supersession = true;
    const compiledPayment = await compileFixture(payment);
    const forbidden = structuredClone(compiledPayment.output);
    forbidden.assertions[0]!.supersedes_candidate = 'private-proposition-id';
    expect(
      gradeCompilerOutput(payment, compiledPayment.scenario.input, forbidden).failures,
    ).toContain('assertions: output used forbidden supersession');
  });

  it('checks only explicit required and forbidden fixture literals', async () => {
    const evalCase = structuredClone(corpusCase('accept.payment'));
    evalCase.expect.statements_must_not_mention = ['PRIVATE-FORBIDDEN-LITERAL'];
    const { scenario, output } = await compileFixture(evalCase);

    const omitted = structuredClone(output);
    omitted.assertions[0]!.statement = 'A payment occurred.';
    expect(gradeCompilerOutput(evalCase, scenario.input, omitted).failures).toContain(
      'assertions: statement omitted an explicit required fixture literal',
    );

    const forbidden = structuredClone(output);
    forbidden.assertions[0]!.statement += ' PRIVATE-FORBIDDEN-LITERAL';
    expect(gradeCompilerOutput(evalCase, scenario.input, forbidden).failures).toContain(
      'assertions: statement used an explicit forbidden fixture literal',
    );
  });
});

describe('deterministic clarification expectations', () => {
  it('matches requirement and reason as one atomic pair', async () => {
    const evalCase = corpusCase('ambiguous.multiple_readings');
    const { scenario, output } = await compileFixture(evalCase);
    expect(gradeCompilerOutput(evalCase, scenario.input, output).failures).toEqual([]);

    const wrongPair = structuredClone(output);
    wrongPair.clarifications_requested[0]!.requirement_id = 'req_own_performance';
    const failures = gradeCompilerOutput(evalCase, scenario.input, wrongPair).failures;
    expect(failures).toContain('clarifications: output contained an undeclared metadata pair');
    expect(failures).toContain('clarifications: required metadata pair is missing');
  });

  it('rejects duplicate and excess clarification metadata', async () => {
    const evalCase = corpusCase('ambiguous.multiple_readings');
    const { scenario, output } = await compileFixture(evalCase);

    const duplicate = structuredClone(output);
    duplicate.clarifications_requested.push(structuredClone(output.clarifications_requested[0]!));
    expect(gradeCompilerOutput(evalCase, scenario.input, duplicate).failures).toContain(
      'clarifications: metadata pair is duplicated',
    );

    const excess = structuredClone(output);
    excess.clarifications_requested.push({
      requirement_id: 'req_own_performance',
      reason: 'answer_does_not_address_requirement',
      prompt: 'A non-empty prompt.',
    });
    expect(gradeCompilerOutput(evalCase, scenario.input, excess).failures).toContain(
      'clarifications: output contained an undeclared metadata pair',
    );
  });

  it('does not pretend to judge the English meaning of a non-empty prompt', async () => {
    const evalCase = corpusCase('ambiguous.multiple_readings');
    const { scenario, output } = await compileFixture(evalCase);
    output.clarifications_requested[0]!.prompt = 'This remains a non-empty model-owned question.';
    expect(gradeCompilerOutput(evalCase, scenario.input, output).failures).toEqual([]);
  });
});

describe('grounding and confidential diagnostics', () => {
  it('requires answer-region grounding for accepted assertions', async () => {
    const evalCase = corpusCase('accept.payment');
    const { scenario, output } = await compileFixture(evalCase);
    const contextOnly = structuredClone(output);
    for (const span of contextOnly.assertions[0]!.spans) {
      span.region = 'context';
      span.message_index = 0;
    }
    expect(gradeCompilerOutput(evalCase, scenario.input, contextOnly).failures).toContain(
      'grounding: accepted assertion lacks answer-region support',
    );
  });

  it('does not echo model statements, case text, or unknown requirement ids', async () => {
    const evalCase = structuredClone(corpusCase('accept.payment'));
    const privateCaseText = 'PRIVATE CASE ANSWER 7e91';
    const privateStatement = 'PRIVATE MODEL STATEMENT 4cc2';
    const privateRequirement = 'PRIVATE REQUIREMENT 0ad8';
    evalCase.answer += ' ' + privateCaseText;
    const { scenario, output } = await compileFixture(evalCase);
    output.assertions[0]!.statement = privateStatement;
    output.assertions[0]!.requirement_id = privateRequirement;
    output.assertions[0]!.spans[0]!.turn_id = 'PRIVATE SOURCE TURN';

    const rendered = gradeCompilerOutput(evalCase, scenario.input, output).failures.join('\n');
    expect(rendered).not.toContain(privateCaseText);
    expect(rendered).not.toContain(privateStatement);
    expect(rendered).not.toContain(privateRequirement);
    expect(rendered).not.toContain('PRIVATE SOURCE TURN');
  });

  it('keeps provider-controlled identifiers out of formatted reports', async () => {
    const evalCase = corpusCase('accept.payment');
    const privateRequirement = 'PRIVATE PERSON\nPRIVATE MATTER';
    const completion = JSON.parse(evalCase.offline_completion) as {
      assertions: { requirement_id: string }[];
    };
    completion.assertions[0]!.requirement_id = privateRequirement;
    const compiler = new ModelSemanticCompiler({
      client: fixedModelClient(JSON.stringify(completion)),
      model_id: 'juryai-offline-replay',
      model_snapshot: null,
    });
    const report = await runSemanticEval({ compiler, cases: [evalCase] });
    const rendered = formatEvalReport(report);
    expect(report.failed).toBe(1);
    expect(rendered).not.toContain(privateRequirement);
    expect(rendered).not.toContain('PRIVATE PERSON');
    expect(rendered).not.toContain('PRIVATE MATTER');
  });
});
