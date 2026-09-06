/**
 * Offline replay of the primary V0.4 corpus through the REAL V0.4 compiler.
 *
 * This proves pipeline + corpus + oracle integration and NOTHING about model
 * quality. Every completion is a fixture written by the same hand that wrote
 * the expectations, so a green run here says the corpus is internally
 * consistent, every declared citation resolves against the stored turn, and
 * every expectation is satisfiable by output the V0.4 contract admits.
 *
 * It is not evidence that a model can do this. That is what the live eval is
 * for, and the distinction is stated wherever these numbers are reported.
 */

import { describe, expect, it } from 'vitest';

import {
  PRIMARY_CORPUS,
  SEMANTIC_EVAL_CORPUS_VERSION,
  corpusHash,
  corpusWellFormednessErrors,
  casesByCategory,
} from '../webmcp/eval-v0-4-corpus/index.js';
import { createOfflineCompilerV04 } from '../webmcp/eval-v0-4-corpus/offline.js';
import { OFFLINE_COMPLETIONS } from '../webmcp/eval-v0-4-corpus/offline-completions.js';
import { runCorpusV04 } from '../webmcp/eval-v0-4-corpus/runner.js';
import { COMPILER_CONTRACT_VERSION_V04 } from '../webmcp/core-v0-4/compiler-contract.js';
import type { EvalCategoryV04 } from '../webmcp/eval-v0-4/types.js';

const ALL_CATEGORIES: EvalCategoryV04[] = [
  'same_type_multi_fact',
  'same_type_mixed_strength',
  'exact_supersession',
  'additive_vs_correction',
  'pure_restatement',
  'volunteered_unasked_requirement',
  'bulk_testimony',
  'explicit_absence',
  'target_date_vs_deadline',
  'adverse_fact',
  'non_recollection',
  'declined_answer',
  'no_manufacture',
  'no_context_laundering',
  'prompt_injection',
  'existing_proposition_awareness',
];

describe('V0.4 primary corpus shape', () => {
  it('is well formed', () => {
    expect(corpusWellFormednessErrors(PRIMARY_CORPUS)).toEqual([]);
  });

  it('holds at least 40 materially distinct cases', () => {
    expect(PRIMARY_CORPUS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(PRIMARY_CORPUS.map((item) => item.id)).size).toBe(PRIMARY_CORPUS.length);
  });

  it('represents every EvalCategoryV04', () => {
    const byCategory = casesByCategory(PRIMARY_CORPUS);
    for (const category of ALL_CATEGORIES) {
      expect(byCategory.get(category)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('scripts exactly one offline completion per case, and no orphans', () => {
    const caseIds = new Set(PRIMARY_CORPUS.map((item) => item.id));
    for (const id of caseIds) expect(OFFLINE_COMPLETIONS[id]).toBeDefined();
    for (const id of Object.keys(OFFLINE_COMPLETIONS)) expect(caseIds.has(id)).toBe(true);
  });

  it('declares the corpus version', () => {
    expect(SEMANTIC_EVAL_CORPUS_VERSION).toBe('juryai-semantic-eval-v0.4.2');
  });
});

describe('offline replay through the real V0.4 compiler', () => {
  it('runs every case green, with zero blockers and zero ordinary failures', async () => {
    const compiler = createOfflineCompilerV04(PRIMARY_CORPUS);
    const run = await runCorpusV04(compiler, PRIMARY_CORPUS);

    // Report every failing case by id before asserting, so a red run names what
    // broke instead of only how much.
    for (const result of run.results) {
      if (!result.ok) {
        console.error(
          'OFFLINE FAILURE',
          result.case_id,
          result.error ?? '',
          JSON.stringify([...result.hard_blockers, ...result.ordinary_failures]),
        );
      }
    }

    expect(run.failed).toBe(0);
    expect(run.hard_blocker_count).toBe(0);
    expect(run.ordinary_failure_count).toBe(0);
    expect(run.passed).toBe(PRIMARY_CORPUS.length);
  });

  it('binds the exact compiler artefact it reports', async () => {
    const compiler = createOfflineCompilerV04(PRIMARY_CORPUS);
    const run = await runCorpusV04(compiler, PRIMARY_CORPUS);
    expect(run.compiler_version_id).toBe(compiler.registryEntry.compiler_version_id);
    expect(run.contract_version).toBe(COMPILER_CONTRACT_VERSION_V04);
    expect(run.prompt_version).toBe('juryai-semantic-compiler-prompt-v0.4.0');
    // One provider call per case: no resampling anywhere.
    expect(run.provider_calls).toBe(PRIMARY_CORPUS.length);
  });

  it('is deterministic: the same corpus yields the same hash', () => {
    expect(corpusHash(PRIMARY_CORPUS)).toBe(corpusHash([...PRIMARY_CORPUS]));
  });
});
