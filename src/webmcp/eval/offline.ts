/**
 * The offline eval: the corpus and the trap suite, with no network.
 *
 * Offline runs drive the REAL `ModelSemanticCompiler` — real prompt assembly,
 * real input rendering, real parsing, real grounding resolution, real retry and
 * cancellation policy — over a replay client at the provider seam. The only
 * thing that is not real is where the completion bytes came from.
 *
 * That distinction is the whole honesty of this harness. An offline pass is
 * evidence about the PIPELINE. It is not evidence about a model, and this
 * module deliberately reports its compiler identity as the replay artefact so
 * an offline result can never be mistaken for a live one: the replay client's
 * provider id is part of `config_hash`, so the two runs cannot even share a
 * `compiler_version_id`.
 */

import type { CompilerOutput } from '../core/compiler-contract.js';
import { ModelSemanticCompiler } from '../compiler/model-compiler.js';
import { fixedModelClient, ScriptedSemanticModelClient } from '../compiler/replay-client.js';
import { buildEvalScenario } from './scenario.js';
import { gradeCompilerOutput } from './graders.js';
import { runBoundary, runSemanticEval, type EvalRunReport } from './runner.js';
import { MALFORMED_COMPLETIONS, SEMANTIC_EVAL_CORPUS } from './corpus.js';
import type { SemanticEvalCase } from './types.js';

export const OFFLINE_COMPILER_MODEL_ID = 'juryai-offline-replay';

/**
 * A compiler whose provider seam replays a completion chosen per compile run.
 * One instance serves the whole corpus, so every case shares one artefact and
 * one `compiler_version_id`.
 */
export function offlineCorpusCompiler(
  completionFor: (compileRunId: string) => string | undefined,
): ModelSemanticCompiler {
  const client = new ScriptedSemanticModelClient((request) => {
    // The compile run id is server-owned and appears verbatim in the rendered
    // input, which is the only thing the provider seam ever sees.
    const match = /compile_run_id: (\S+)/u.exec(request.input);
    const completion = match ? completionFor(match[1]!) : undefined;
    if (completion === undefined) {
      return { kind: 'error', error: new Error('No offline completion for this compile run.') };
    }
    return { kind: 'text', text: completion };
  });
  return new ModelSemanticCompiler({
    client,
    model_id: OFFLINE_COMPILER_MODEL_ID,
    model_snapshot: null,
  });
}

/** Runs the corpus offline, replaying each case's recorded good completion. */
export async function runOfflineCorpus(
  cases: readonly SemanticEvalCase[] = SEMANTIC_EVAL_CORPUS,
): Promise<EvalRunReport> {
  // Scenario construction is deterministic, so the compile-run id for each case
  // can be resolved up front and used as the replay key.
  const probe = offlineCorpusCompiler(() => undefined);
  const byRunId = new Map<string, string>();
  for (const evalCase of cases) {
    const scenario = buildEvalScenario(evalCase, probe.registryEntry);
    byRunId.set(scenario.input.compile_run_id, evalCase.offline_completion);
  }
  const compiler = offlineCorpusCompiler((runId) => byRunId.get(runId));
  return runSemanticEval({ compiler, cases });
}

/* ------------------------------------------------------------------------ */
/* Trap suite                                                                */
/* ------------------------------------------------------------------------ */

export type TrapLayer = 'compiler' | 'boundary' | 'grader';

export interface TrapResult {
  case_id: string;
  trap: string;
  expected_layer: TrapLayer;
  /** Where the trap was actually stopped; null means it was not stopped. */
  actual_layer: TrapLayer | null;
  detail: string;
  ok: boolean;
}

export interface TrapSuiteReport {
  trap_count: number;
  passed: number;
  failed: number;
  results: TrapResult[];
}

/**
 * A corpus of good answers only proves the graders can be satisfied. The traps
 * prove they can be FAILED: each is a completion that must be refused, and the
 * suite fails if any trap slips through — or if it is stopped by a layer other
 * than the one obliged to stop it, which would mean the intended guard is not
 * actually doing the work.
 */
export async function runTrapSuite(
  cases: readonly SemanticEvalCase[] = SEMANTIC_EVAL_CORPUS,
): Promise<TrapSuiteReport> {
  const results: TrapResult[] = [];

  for (const evalCase of cases) {
    for (const trap of evalCase.traps ?? []) {
      const compiler = new ModelSemanticCompiler({
        client: fixedModelClient(trap.completion),
        model_id: OFFLINE_COMPILER_MODEL_ID,
        model_snapshot: null,
      });
      const scenario = buildEvalScenario(evalCase, compiler.registryEntry);

      let output: CompilerOutput | null = null;
      let actual: TrapLayer | null = null;
      let detail = '';
      try {
        output = await compiler.compile(structuredClone(scenario.input));
      } catch (error) {
        actual = 'compiler';
        detail = error instanceof Error ? error.message : 'compiler rejected the completion';
      }

      if (output !== null) {
        const boundary = runBoundary(
          scenario.state,
          scenario.input,
          output,
          evalCase,
          scenario.next_case_version,
        );
        if (boundary.disposition !== 'committed') {
          actual = 'boundary';
          detail = boundary.disposition + ': ' + (boundary.issues[0]?.code ?? 'no issue code');
        } else {
          const grade = gradeCompilerOutput(evalCase, scenario.input, output);
          if (!grade.ok) {
            actual = 'grader';
            detail = grade.failures[0] ?? 'graded as failing';
          } else {
            detail = 'the trap was accepted by every layer';
          }
        }
      }

      results.push({
        case_id: evalCase.id,
        trap: trap.name,
        expected_layer: trap.caught_by,
        actual_layer: actual,
        detail,
        ok: actual === trap.caught_by,
      });
    }
  }

  return {
    trap_count: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}

export interface MalformedResult {
  name: string;
  rejected: boolean;
  detail: string;
}

/**
 * Provider garbage, run against a real corpus scenario. Every one of these must
 * fail; none may be normalised into something that looks like a valid reading.
 */
export async function runMalformedSuite(): Promise<MalformedResult[]> {
  const anchor = SEMANTIC_EVAL_CORPUS.find((entry) => entry.id === 'accept.payment');
  if (!anchor) throw new Error('The malformed suite needs the accept.payment scenario.');

  const results: MalformedResult[] = [];
  for (const malformed of MALFORMED_COMPLETIONS) {
    const compiler = new ModelSemanticCompiler({
      client: fixedModelClient(malformed.completion),
      model_id: OFFLINE_COMPILER_MODEL_ID,
      model_snapshot: null,
    });
    const scenario = buildEvalScenario(anchor, compiler.registryEntry);
    try {
      const output = await compiler.compile(structuredClone(scenario.input));
      const boundary = runBoundary(
        scenario.state,
        scenario.input,
        output,
        anchor,
        scenario.next_case_version,
      );
      results.push({
        name: malformed.name,
        rejected: boundary.disposition !== 'committed',
        detail: boundary.disposition,
      });
    } catch (error) {
      results.push({
        name: malformed.name,
        rejected: true,
        detail: error instanceof Error ? error.message : 'rejected',
      });
    }
  }
  return results;
}
