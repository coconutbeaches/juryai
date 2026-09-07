/**
 * The V0.4 eval report must not become a leak.
 *
 * The report exists to be read by people who may have no right to the case
 * material, so the one field it does not control — the provider-reported model
 * — is the one that has to be proved safe. A configured gateway can return an
 * arbitrary string there, and printing it verbatim would let a response inject
 * newlines, forged report lines, or submitted case text into exactly the
 * document that is supposed to contain none.
 *
 * These tests exist because the live command may not be imported by any test
 * (a structural guard keeps CI away from a model), which would otherwise leave
 * this rule with no behavioural coverage at all.
 */

import { describe, expect, it } from 'vitest';

import { formatEvalReportV04, formatReportedModels } from '../webmcp/eval-v0-4-corpus/report.js';
import { PRIMARY_CORPUS } from '../webmcp/eval-v0-4-corpus/index.js';
import type { CorpusRunResult } from '../webmcp/eval-v0-4-corpus/runner.js';

function runResult(overrides: Partial<CorpusRunResult> = {}): CorpusRunResult {
  return {
    compiler_version_id: 'c'.repeat(64),
    prompt_version: 'juryai-semantic-compiler-prompt-v0.4.0',
    prompt_hash: 'p'.repeat(64),
    config_hash: 'g'.repeat(64),
    model_id: 'test-model',
    model_snapshot: null,
    contract_version: 'juryai-webmcp-compiler-contract-v0.4.0',
    case_count: 1,
    passed: 1,
    failed: 0,
    hard_blocker_count: 0,
    ordinary_failure_count: 0,
    provider_calls: 1,
    input_tokens: 10,
    output_tokens: 5,
    reported_models: [],
    elapsed_ms: 1,
    results: [],
    ...overrides,
  };
}

describe('provider-reported model identity is sanitized', () => {
  it('passes an ordinary identifier through unchanged', () => {
    expect(formatReportedModels(['gpt-5.6-2026-08-01'])).toBe('gpt-5.6-2026-08-01');
  });

  it('says so plainly when nothing was reported', () => {
    expect(formatReportedModels([])).toBe('(none reported)');
  });

  it('REFUSES a provider string carrying newlines and case text', () => {
    const hostile = 'model\nPRIVATE CASE TEXT: the deposit was 500 euro';
    expect(formatReportedModels([hostile])).toBe('(invalid provider identifier)');
  });

  it('REFUSES a forged report line, so identity cannot fake a verdict', () => {
    const hostile = 'x\nRESULT: PASS';
    const rendered = formatEvalReportV04(
      'PRIMARY',
      PRIMARY_CORPUS.slice(0, 1),
      runResult({
        reported_models: [hostile],
      }),
      'test-corpus-version',
    );
    expect(rendered).not.toContain('RESULT: PASS');
    expect(rendered).toContain('(invalid provider identifier)');
  });

  it('sanitizes every reported model, not only the first', () => {
    expect(formatReportedModels(['good-model', 'bad\nmodel'])).toBe(
      'good-model, (invalid provider identifier)',
    );
  });
});

describe('the report carries identities and counts, never case material', () => {
  it('prints no corpus answer text', () => {
    const rendered = formatEvalReportV04(
      'PRIMARY',
      PRIMARY_CORPUS,
      runResult(),
      'test-corpus-version',
    );
    for (const item of PRIMARY_CORPUS) {
      expect(rendered).not.toContain(item.answer);
    }
  });

  it('names failures by case id and machine rule only', () => {
    const rendered = formatEvalReportV04(
      'PRIMARY',
      PRIMARY_CORPUS.slice(0, 1),
      runResult({
        passed: 0,
        failed: 1,
        hard_blocker_count: 1,
        results: [
          {
            case_id: 'some_case',
            category: 'adverse_fact',
            ok: false,
            error: null,
            hard_blockers: [{ rule: 'assertions.undeclared_extra', severity: 'hard_blocker' }],
            ordinary_failures: [],
          },
        ],
      }),
      'test-corpus-version',
    );
    expect(rendered).toContain('some_case');
    expect(rendered).toContain('HARD:assertions.undeclared_extra');
  });

  it('records an unpinned alias honestly rather than inventing a snapshot', () => {
    const rendered = formatEvalReportV04(
      'PRIMARY',
      PRIMARY_CORPUS.slice(0, 1),
      runResult(),
      'test-corpus-version',
    );
    expect(rendered).toContain('null (moving alias, not pinned)');
  });
});

describe('the report labels the corpus that actually ran', () => {
  it('prints the version it was given, not a module default', () => {
    // Regression: the version used to be read from the PRIMARY corpus constant,
    // so a holdout run printed the primary corpus's label beside the holdout's
    // hash. The hash still identified the run, but a report that mislabels
    // which corpus was measured is a provenance error.
    const rendered = formatEvalReportV04(
      'HOLDOUT',
      PRIMARY_CORPUS.slice(0, 1),
      runResult(),
      'juryai-semantic-holdout-v0.4.1',
    );
    expect(rendered).toContain('juryai-semantic-holdout-v0.4.1');
    expect(rendered).not.toContain('juryai-semantic-eval-v0.4.2');
  });
});
