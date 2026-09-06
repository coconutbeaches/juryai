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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRoot } from './test-helpers.js';

import {
  PRIMARY_CORPUS,
  SEMANTIC_EVAL_CORPUS_VERSION,
  corpusHash,
  corpusWellFormednessErrors,
  casesByCategory,
} from '../webmcp/eval-v0-4-corpus/index.js';
import { createOfflineCompilerV04 } from '../webmcp/eval-v0-4-corpus/offline.js';
import { HOLDOUT_V041, HOLDOUT_V041_FROZEN_HASH } from '../webmcp/eval-v0-4-corpus/holdout-v041.js';
import {
  RETIRED_HOLDOUT_V040,
  RETIRED_HOLDOUT_V040_FROZEN_HASH,
  RETIRED_HOLDOUT_V040_RESULT,
  retiredHoldoutV040Hash,
} from '../webmcp/eval-v0-4-corpus/holdout-v040-retired.js';
import { SEMANTIC_COMPILER_SYSTEM_PROMPT_V04 } from '../webmcp/compiler-v0-4/prompt.js';
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
    expect(SEMANTIC_EVAL_CORPUS_VERSION).toBe('juryai-semantic-eval-v0.4.3');
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

describe('holdout v0.4.1', () => {
  it('is well formed, fresh, and frozen', () => {
    expect(corpusWellFormednessErrors(HOLDOUT_V041)).toEqual([]);
    expect(HOLDOUT_V041.length).toBeGreaterThanOrEqual(8);
    expect(HOLDOUT_V041_FROZEN_HASH).toBe(corpusHash(HOLDOUT_V041));
    // Distinct cases, and no id shared with the primary corpus.
    const primary = new Set(PRIMARY_CORPUS.map((item) => item.id));
    for (const item of HOLDOUT_V041) expect(primary.has(item.id)).toBe(false);
  });

  it('shares no answer with the primary corpus', () => {
    // Fresh fact patterns, not re-skinned primary cases: a holdout that reuses
    // the primary's material measures nothing the primary did not already.
    const primaryAnswers = new Set(PRIMARY_CORPUS.map((item) => item.answer));
    for (const item of HOLDOUT_V041) expect(primaryAnswers.has(item.answer)).toBe(false);
  });

  it('leaks nothing into the prompt', () => {
    for (const item of HOLDOUT_V041) {
      expect(SEMANTIC_COMPILER_SYSTEM_PROMPT_V04).not.toContain(item.id);
      expect(SEMANTIC_COMPILER_SYSTEM_PROMPT_V04).not.toContain(item.answer);
      for (let start = 0; start + 48 <= item.answer.length; start += 8) {
        expect(SEMANTIC_COMPILER_SYSTEM_PROMPT_V04).not.toContain(
          item.answer.slice(start, start + 48),
        );
      }
    }
  });

  it('replays green offline, so the single live run is not spent on a fixture bug', async () => {
    const compiler = createOfflineCompilerV04(HOLDOUT_V041);
    const run = await runCorpusV04(compiler, HOLDOUT_V041);
    for (const result of run.results) {
      if (!result.ok) {
        console.error(
          'HOLDOUT OFFLINE FAILURE',
          result.case_id,
          result.error ?? '',
          JSON.stringify([...result.hard_blockers, ...result.ordinary_failures]),
        );
      }
    }
    expect(run.failed).toBe(0);
    expect(run.hard_blocker_count).toBe(0);
    expect(run.ordinary_failure_count).toBe(0);
  });
});

describe('the retired holdout v0.4.0 is preserved, immutable, and unreachable', () => {
  it('still hashes to exactly what was frozen before its single live run', () => {
    // The historical record cannot drift. If these cases are ever edited, this
    // fails — which is the point of keeping a failed experiment at all.
    expect(retiredHoldoutV040Hash()).toBe(RETIRED_HOLDOUT_V040_FROZEN_HASH);
    expect(RETIRED_HOLDOUT_V040_FROZEN_HASH).toBe(
      '44cfb43a88d381828facc11d0cfc53e80a4982a7fddfe59c048561b2320bcbce',
    );
    expect(RETIRED_HOLDOUT_V040).toHaveLength(13);
  });

  it('records its failure faithfully rather than quietly becoming a pass', () => {
    expect(RETIRED_HOLDOUT_V040_RESULT.status).toBe('FAILED');
    expect(RETIRED_HOLDOUT_V040_RESULT.passed).toBe(10);
    expect(RETIRED_HOLDOUT_V040_RESULT.hard_blockers).toBe(3);
    expect(RETIRED_HOLDOUT_V040_RESULT.reusable_as_holdout_evidence).toBe(false);
    expect([...RETIRED_HOLDOUT_V040_RESULT.failing_case_ids]).toEqual([
      'ho_volunteered_two_more',
      'ho_breadth_is_not_authority',
      'ho_context_laundering',
    ]);
  });

  it('shares no case id, answer or fact pattern with the fresh holdout', () => {
    const retiredIds = new Set(RETIRED_HOLDOUT_V040.map((item) => item.id));
    const retiredAnswers = new Set(RETIRED_HOLDOUT_V040.map((item) => item.answer));
    for (const item of HOLDOUT_V041) {
      expect(retiredIds.has(item.id)).toBe(false);
      expect(retiredAnswers.has(item.answer)).toBe(false);
    }
    // No expectation id is reused either.
    const retiredExpectationIds = new Set(
      RETIRED_HOLDOUT_V040.flatMap((item) =>
        item.expect.assertions.map((expectation) => expectation.expectation_id),
      ),
    );
    for (const item of HOLDOUT_V041) {
      for (const expectation of item.expect.assertions) {
        expect(retiredExpectationIds.has(expectation.expectation_id)).toBe(false);
      }
    }
  });

  it('is not reachable from the live eval command', () => {
    const command = readFileSync(
      resolve(projectRoot, 'src/commands/run-compiler-eval-v04.ts'),
      'utf8',
    );
    expect(command).not.toMatch(/holdout-v040-retired/u);
    expect(command).toMatch(/holdout-v041/u);
  });
});
