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
} from '../webmcp/eval-v0-4-corpus/index.js';
// The ACTIVE holdout. The retired v0.4.0 holdout is deliberately NOT imported
// here: that corpus failed, its model outputs were then inspected, and it must
// never be runnable again. A test asserts this file cannot reach it.
import {
  HOLDOUT_V041,
  HOLDOUT_V041_FROZEN_HASH,
  HOLDOUT_V041_VERSION,
} from '../webmcp/eval-v0-4-corpus/holdout-v041.js';
import { createOfflineCompilerV04 } from '../webmcp/eval-v0-4-corpus/offline.js';
import { runCorpusV04 } from '../webmcp/eval-v0-4-corpus/runner.js';
// Reused, not reimplemented. The historical evaluator already solved this and
// its module is byte-frozen, so importing keeps one definition of what is
// printable rather than a second that can drift.
import { formatEvalReportV04 } from '../webmcp/eval-v0-4-corpus/report.js';
import {
  RELIABILITY_PROTOCOL,
  countNonSafety,
  countSafety,
  evaluateReliability,
  summariseRun,
} from '../webmcp/eval-v0-4-corpus/reliability.js';
import type { CaseRunResult } from '../webmcp/eval-v0-4-corpus/runner.js';

/**
 * A positive integer, or a loud configuration error.
 *
 * Without this a `0`, negative, fractional or non-numeric value is accepted and
 * then fails on EVERY corpus case as a provider request, turning one
 * configuration mistake into 48 failed paid calls and a misleading run report.
 * Non-numeric values fail even later, during artefact hashing, as an unrelated
 * finite-number error. The V0.3 live factory already validates this; the V0.4
 * construction path must not be the one that forgot.
 */
function positiveIntegerEnv(name: string, fallback: number | null): number | null {
  const value = process.env[name];
  if (value === undefined || value.length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

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

  const options: ModelSemanticCompilerOptions = {
    client: new OpenAiResponsesSemanticModelClient({
      apiKey,
      baseUrl: process.env[COMPILER_ENV.baseUrl] ?? DEFAULT_OPENAI_BASE_URL,
    }),
    model_id: modelId,
    model_snapshot: snapshot !== undefined && snapshot.length > 0 ? snapshot : null,
    decoding: {
      ...DEFAULT_COMPILER_DECODING,
      max_output_tokens: positiveIntegerEnv(
        COMPILER_ENV.maxOutputTokens,
        DEFAULT_COMPILER_DECODING.max_output_tokens,
      ),
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

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const holdout = args.has('--holdout');
  const offline = args.has('--offline');

  const corpus = holdout ? HOLDOUT_V041 : PRIMARY_CORPUS;
  const corpusVersion = holdout ? HOLDOUT_V041_VERSION : SEMANTIC_EVAL_CORPUS_VERSION;
  const label = `${holdout ? 'HOLDOUT' : 'PRIMARY'} · ${offline ? 'OFFLINE REPLAY' : 'LIVE MODEL'}`;

  if (holdout && corpus.length === 0) {
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
  const frozen = holdout ? HOLDOUT_V041_FROZEN_HASH : PRIMARY_CORPUS_FROZEN_HASH;
  const actual = corpusHash(corpus);
  if (actual !== frozen) {
    console.error('CORPUS FREEZE VIOLATION');
    console.error(`  frozen ${frozen}`);
    console.error(`  actual ${actual}`);
    console.error('  Refusing to run. A corpus change after freezing must be recorded explicitly.');
    process.exitCode = 1;
    return;
  }

  /**
   * REPEATED-RUN RELIABILITY PROTOCOL.
   *
   * Predeclared and frozen in `reliability.ts` before the first live call. The
   * budget is fixed, every run counts, and nothing is inspected or edited
   * between runs. A single SAFETY-critical violation stops the series
   * immediately — safety is never averaged into a rate.
   */
  if (args.has('--reliability')) {
    const total = RELIABILITY_PROTOCOL.runs;
    console.log('');
    console.log(`=== REPEATED-RUN RELIABILITY PROTOCOL — ${label} ===`);
    console.log(`declared budget       ${String(total)} complete runs`);
    console.log(`safety tolerance      ${String(RELIABILITY_PROTOCOL.max_safety_violations)}`);
    console.log(`pass-rate floor       ${(RELIABILITY_PROTOCOL.min_pass_rate * 100).toFixed(1)}%`);
    console.log(
      `max failures per case ${String(RELIABILITY_PROTOCOL.max_failures_per_case)} of ${String(total)}`,
    );
    console.log(
      `anchor                ${RELIABILITY_PROTOCOL.anchor_case_id} >= ${String(RELIABILITY_PROTOCOL.anchor_min_passes)}`,
    );

    const allRuns: CaseRunResult[][] = [];
    for (let index = 1; index <= total; index += 1) {
      const perRunCompiler = offline ? createOfflineCompilerV04(corpus) : createLiveCompilerV04();
      const outcome = await runCorpusV04(perRunCompiler, corpus);
      allRuns.push([...outcome.results]);
      const safety = countSafety(outcome.results);
      const ordinary = countNonSafety(outcome.results);
      console.log('');
      console.log(`--- run ${String(index)}/${String(total)} ---`);
      console.log(`compiler_version_id   ${outcome.compiler_version_id}`);
      console.log(`corpus_hash           ${corpusHash(corpus)}`);
      console.log(`passed                ${String(outcome.passed)}/${String(outcome.case_count)}`);
      console.log(`safety_violations     ${String(safety)}`);
      console.log(`non_safety_failures   ${String(ordinary)}`);
      console.log(`provider_calls        ${String(outcome.provider_calls)}`);
      console.log(
        `tokens in/out         ${String(outcome.input_tokens ?? 0)}/${String(outcome.output_tokens ?? 0)}`,
      );
      console.log(`elapsed_ms            ${String(outcome.elapsed_ms)}`);
      for (const entry of summariseRun(index, outcome.results)) {
        console.log(
          `  ${entry.safety ? 'SAFETY' : 'ordinary'}  ${entry.case_id.padEnd(38)} ${entry.rules.join(' ')}`,
        );
      }
      if (safety > 0) {
        console.log('');
        console.log('SAFETY-CRITICAL VIOLATION — stopping the series immediately.');
        console.log('RESULT: FAIL');
        process.exitCode = 1;
        return;
      }
    }

    const verdict = evaluateReliability(allRuns);
    console.log('');
    console.log('=== RELIABILITY VERDICT ===');
    console.log(
      `green case-runs       ${String(verdict.green_case_runs)}/${String(verdict.total_case_runs)} = ${(verdict.pass_rate * 100).toFixed(2)}%`,
    );
    console.log(`safety_violations     ${String(verdict.safety_violations)}`);
    console.log(
      `anchor passes         ${String(verdict.anchor_passes)}/${String(RELIABILITY_PROTOCOL.runs)}`,
    );
    console.log('per-case failure counts (failing cases only):');
    for (const entry of verdict.per_case_failures) {
      console.log(`  ${entry.case_id.padEnd(38)} ${String(entry.failures)}`);
    }
    console.log('acceptance clauses:');
    for (const clause of verdict.clauses) {
      console.log(`  [${clause.ok ? 'PASS' : 'FAIL'}] ${clause.name} — ${clause.detail}`);
    }
    console.log('');
    console.log(verdict.accepted ? 'RESULT: PASS' : 'RESULT: FAIL');
    process.exitCode = verdict.accepted ? 0 : 1;
    return;
  }

  const compiler = offline ? createOfflineCompilerV04(corpus) : createLiveCompilerV04();
  const run = await runCorpusV04(compiler, corpus);
  console.log(formatEvalReportV04(label, corpus, run, corpusVersion));

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
