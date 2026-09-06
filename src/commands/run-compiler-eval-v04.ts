/**
 * The LIVE V0.4 semantic eval.
 *
 * Explicit and manual. Nothing in CI reaches this file, and a structural guard
 * proves no test imports it: a suite that can silently spend money on a model
 * is a suite whose green means something different from what it says.
 *
 * Usage:
 *   npx tsx src/commands/run-compiler-eval-v04.ts            # primary corpus
 *   npx tsx src/commands/run-compiler-eval-v04.ts --holdout  # holdout corpus
 *   npx tsx src/commands/run-compiler-eval-v04.ts --offline  # replay, no model
 *
 * Environment (never printed, never defaulted):
 *   JURYAI_COMPILER_API_KEY | OPENAI_API_KEY
 *   JURYAI_COMPILER_MODEL
 *   JURYAI_COMPILER_MODEL_SNAPSHOT          only if genuinely pinned
 *   JURYAI_COMPILER_OMIT_SAMPLING_PARAMS
 *   JURYAI_COMPILER_MAX_OUTPUT_TOKENS
 *   JURYAI_COMPILER_BASE_URL
 *
 * REPORTING DISCIPLINE. The summary carries identities, counts and diagnostics
 * — never case text, answer text, model statements or failure prose. Failures
 * are named by case id and machine rule only. An eval report is read by people
 * who are not entitled to the case material, and a report that leaks legal text
 * is a privacy incident wearing a diagnostic hat.
 *
 * BLOCKERS ARE NEVER AVERAGED. The exit code is non-zero if a single hard
 * blocker or a single ordinary failure occurred. 47/48 is a failing run.
 */

import {
  OpenAiResponsesSemanticModelClient,
  DEFAULT_OPENAI_BASE_URL,
} from '../webmcp/compiler/openai-responses-client.js';
import { COMPILER_ENV } from '../webmcp/compiler/config.js';
import {
  DEFAULT_COMPILER_DECODING,
  type ModelSemanticCompilerOptions,
} from '../webmcp/compiler-v0-3/model-compiler.js';
import { ModelSemanticCompilerV04 } from '../webmcp/compiler-v0-4/model-compiler.js';
import {
  PRIMARY_CORPUS,
  PRIMARY_CORPUS_FROZEN_HASH,
  SEMANTIC_EVAL_CORPUS_VERSION,
  corpusHash,
  corpusWellFormednessErrors,
  casesByCategory,
} from '../webmcp/eval-v0-4-corpus/index.js';
import { HOLDOUT_CORPUS, HOLDOUT_CORPUS_FROZEN_HASH } from '../webmcp/eval-v0-4-corpus/holdout.js';
import { createOfflineCompilerV04 } from '../webmcp/eval-v0-4-corpus/offline.js';
import { runCorpusV04, type CorpusRunResult } from '../webmcp/eval-v0-4-corpus/runner.js';
import type { SemanticEvalCaseV04 } from '../webmcp/eval-v0-4/types.js';

function requireEnv(names: readonly string[], what: string): string {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  throw new Error(`${what} is required; set ${names.join(' or ')} in the environment.`);
}

const flag = (name: string): boolean => process.env[name] === '1' || process.env[name] === 'true';

/**
 * Builds the LIVE V0.4 compiler.
 *
 * Deliberately not `createLiveSemanticCompiler`: that factory returns the V0.3
 * `ModelSemanticCompiler`, and reusing it would run the V0.3 artefact while the
 * report named V0.4. The env contract is identical so an operator configures
 * one thing, but the artefact assembled here is the V0.4 one.
 *
 * The snapshot is only ever what the operator explicitly pinned. The model id
 * is never copied into it: an alias wearing a snapshot field is a false claim
 * of reproducibility, and it would be recorded into every proposition's
 * provenance.
 */
function createLiveCompilerV04(): ModelSemanticCompilerV04 {
  const apiKey = requireEnv(
    [COMPILER_ENV.apiKey, COMPILER_ENV.fallbackApiKey],
    'A semantic-compiler API key',
  );
  const modelId = requireEnv([COMPILER_ENV.model], 'A semantic-compiler model id');
  const snapshot = process.env[COMPILER_ENV.snapshot];
  const maxOutput = process.env[COMPILER_ENV.maxOutputTokens];

  const options: ModelSemanticCompilerOptions = {
    client: new OpenAiResponsesSemanticModelClient({
      apiKey,
      baseUrl: process.env[COMPILER_ENV.baseUrl] ?? DEFAULT_OPENAI_BASE_URL,
    }),
    model_id: modelId,
    model_snapshot: snapshot !== undefined && snapshot.length > 0 ? snapshot : null,
    decoding: {
      ...DEFAULT_COMPILER_DECODING,
      max_output_tokens:
        maxOutput !== undefined && maxOutput.length > 0
          ? Number(maxOutput)
          : DEFAULT_COMPILER_DECODING.max_output_tokens,
    },
    omit_sampling_params: flag(COMPILER_ENV.omitSampling),
    retain_raw_output: false,
    // Transient TRANSPORT failures only. The compiler never resamples a
    // completion that parsed badly or graded badly.
    max_transient_retries: 2,
    retry_backoff_ms: 2000,
  };
  return new ModelSemanticCompilerV04(options);
}

function report(label: string, corpus: readonly SemanticEvalCaseV04[], run: CorpusRunResult): void {
  const byCategory = casesByCategory(corpus);
  console.log('');
  console.log(`=== V0.4 SEMANTIC EVAL — ${label} ===`);
  console.log(`corpus_version        ${SEMANTIC_EVAL_CORPUS_VERSION}`);
  console.log(`corpus_hash           ${corpusHash(corpus)}`);
  console.log(`compiler_version_id   ${run.compiler_version_id}`);
  console.log(`prompt_version        ${run.prompt_version}`);
  console.log(`prompt_hash           ${run.prompt_hash}`);
  console.log(`config_hash           ${run.config_hash}`);
  console.log(`contract_version      ${run.contract_version}`);
  console.log(`model_id              ${run.model_id}`);
  console.log(`model_snapshot        ${run.model_snapshot ?? 'null (moving alias, not pinned)'}`);
  console.log(`provider_reported     ${run.reported_models.join(', ') || '(none reported)'}`);
  console.log('');
  console.log(`cases                 ${String(run.case_count)}`);
  console.log(`passed                ${String(run.passed)}`);
  console.log(`failed                ${String(run.failed)}`);
  console.log(`hard_blockers         ${String(run.hard_blocker_count)}`);
  console.log(`ordinary_failures     ${String(run.ordinary_failure_count)}`);
  console.log(`provider_calls        ${String(run.provider_calls)}`);
  console.log(
    `input_tokens          ${run.input_tokens === null ? 'n/a' : String(run.input_tokens)}`,
  );
  console.log(
    `output_tokens         ${run.output_tokens === null ? 'n/a' : String(run.output_tokens)}`,
  );
  console.log(`elapsed_ms            ${String(run.elapsed_ms)}`);
  console.log('');
  console.log('cases by category:');
  for (const [category, list] of [...byCategory].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${category.padEnd(34)} ${String(list.length)}`);
  }

  const failures = run.results.filter((entry) => !entry.ok);
  if (failures.length > 0) {
    console.log('');
    console.log('FAILURES (case id and machine rule only — no case or model text):');
    for (const entry of failures) {
      const blockers = entry.hard_blockers.map((f) => `HARD:${f.rule}`);
      const ordinary = entry.ordinary_failures.map((f) => `ord:${f.rule}`);
      const reason = entry.error === null ? '' : ` threw:${entry.error}`;
      console.log(`  ${entry.case_id.padEnd(40)} ${[...blockers, ...ordinary].join(' ')}${reason}`);
    }
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const holdout = args.has('--holdout');
  const offline = args.has('--offline');

  const corpus = holdout ? HOLDOUT_CORPUS : PRIMARY_CORPUS;
  const label = `${holdout ? 'HOLDOUT' : 'PRIMARY'} · ${offline ? 'OFFLINE REPLAY' : 'LIVE MODEL'}`;

  if (holdout && (corpus.length === 0 || HOLDOUT_CORPUS_FROZEN_HASH === null)) {
    console.error(
      'The holdout corpus has not been authored yet. It is written only after the primary',
    );
    console.error(
      'corpus is frozen, the prompt is final, and two consecutive live runs are green.',
    );
    process.exitCode = 1;
    return;
  }

  const wellFormed = corpusWellFormednessErrors(corpus);
  if (wellFormed.length > 0) {
    console.error('corpus is not well formed:');
    for (const error of wellFormed) console.error(`  ${error}`);
    process.exitCode = 1;
    return;
  }

  // FREEZE CHECK. A corpus that no longer hashes to its frozen value has been
  // edited, and an edited corpus after first live observation is exactly the
  // failure the freeze exists to make visible.
  const frozen = holdout ? (HOLDOUT_CORPUS_FROZEN_HASH as string) : PRIMARY_CORPUS_FROZEN_HASH;
  const actual = corpusHash(corpus);
  if (actual !== frozen) {
    console.error('CORPUS FREEZE VIOLATION');
    console.error(`  frozen ${frozen}`);
    console.error(`  actual ${actual}`);
    console.error('  Refusing to run. A corpus change after freezing must be recorded explicitly.');
    process.exitCode = 1;
    return;
  }

  const compiler = offline ? createOfflineCompilerV04(corpus) : createLiveCompilerV04();
  const run = await runCorpusV04(compiler, corpus);
  report(label, corpus, run);

  if (offline) {
    console.log('');
    console.log(
      'NOTE: this was an OFFLINE REPLAY. It proves pipeline, corpus and oracle integration.',
    );
    console.log('      It is NOT model evidence of any kind.');
  }

  // Never averaged: one blocker or one ordinary failure fails the run.
  const passedCleanly = run.hard_blocker_count === 0 && run.ordinary_failure_count === 0;
  console.log('');
  console.log(passedCleanly ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exitCode = passedCleanly ? 0 : 1;
}

await main();
