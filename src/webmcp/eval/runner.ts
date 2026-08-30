/**
 * The eval runner.
 *
 * Each case is taken through two phases:
 *
 *  1. COMPILE — the compiler under test receives a real `CompilerInput` built
 *     the way the runtime builds one, and its output is graded semantically.
 *  2. BOUNDARY — that same output is then pushed through the merged runtime's
 *     own guard chain, in order: shape validation, core contract validation,
 *     server-owned mutation application, structural validation of the resulting
 *     case state.
 *
 * Phase 2 matters because a semantically plausible reading that the runtime
 * would refuse is not a passing result, and a reading the runtime would ACCEPT
 * despite being wrong is exactly what phase 1 exists to catch. Neither phase
 * is sufficient alone.
 *
 * The runner never commits anything and owns no store: it uses the runtime's
 * pure guard functions directly, so an eval cannot accidentally exercise
 * persistence semantics it does not own.
 */

import {
  validateCompilerOutput,
  type CompilerInput,
  type CompilerOutput,
} from '../core/compiler-contract.js';
import type { CaseState } from '../core/attestation.js';
import { validateCaseState } from '../core/structural-validator.js';
import type { ContractIssue } from '../core/types.js';
import { appendTurn } from '../core/turns.js';
import { validateCompilerOutputShape } from '../runtime/compiler-output-shape.js';
import { applyCompilerOutput } from '../runtime/mutation-application.js';
import type { SemanticCompilerPort } from '../runtime/compiler-port.js';
import { buildEvalScenario, evalMutationIds } from './scenario.js';
import { gradeCompilerOutput, type GradeResult } from './graders.js';
import type { SemanticEvalCase } from './types.js';

export type BoundaryDisposition =
  | 'committed'
  | 'rejected_shape'
  | 'rejected_contract'
  | 'rejected_mutation'
  | 'rejected_structural';

export interface BoundaryResult {
  disposition: BoundaryDisposition;
  issues: ContractIssue[];
  accepted_proposition_ids: string[];
  superseded_proposition_ids: string[];
  opened_clarification_ids: string[];
}

/**
 * The merged runtime's guard chain, in the merged runtime's order. Nothing is
 * relaxed and nothing is added: this is the same sequence `submitTurn` runs
 * between receiving compiler output and committing.
 */
export function runBoundary(
  state: CaseState,
  input: CompilerInput,
  output: CompilerOutput,
  evalCase: SemanticEvalCase,
  nextCaseVersion: number,
): BoundaryResult {
  const empty = {
    accepted_proposition_ids: [],
    superseded_proposition_ids: [],
    opened_clarification_ids: [],
  };

  const shapeIssues = validateCompilerOutputShape(output);
  if (shapeIssues.length > 0) {
    return { disposition: 'rejected_shape', issues: shapeIssues, ...empty };
  }

  const contractIssues = validateCompilerOutput(input, output);
  if (contractIssues.length > 0) {
    return { disposition: 'rejected_contract', issues: contractIssues, ...empty };
  }

  const mutation = applyCompilerOutput({
    state,
    turn: input.turn,
    output,
    next_case_version: nextCaseVersion,
    ids: evalMutationIds(evalCase),
  });
  if (!mutation.ok) {
    return { disposition: 'rejected_mutation', issues: mutation.issues, ...empty };
  }

  const nextState: CaseState = {
    ...state,
    case_version: mutation.mutation.changed ? nextCaseVersion : state.case_version,
    propositions: mutation.mutation.propositions,
    clarifications: mutation.mutation.clarifications,
    turn_log: appendTurn(state.turn_log, input.turn),
  };

  const report = validateCaseState(nextState);
  if (!report.ok) {
    return { disposition: 'rejected_structural', issues: report.issues, ...empty };
  }

  return {
    disposition: 'committed',
    issues: [],
    accepted_proposition_ids: mutation.mutation.accepted_proposition_ids,
    superseded_proposition_ids: mutation.mutation.superseded_proposition_ids,
    opened_clarification_ids: mutation.mutation.opened_clarification_ids,
  };
}

export interface EvalCaseResult {
  case_id: string;
  category: SemanticEvalCase['category'];
  description: string;
  ok: boolean;
  /** Set when the compiler threw rather than returning an output. */
  compiler_error: string | null;
  grade: GradeResult | null;
  boundary: BoundaryResult | null;
  elapsed_ms: number;
}

export interface EvalRunReport {
  compiler_version_id: string;
  model_id: string;
  model_snapshot: string | null;
  prompt_hash: string;
  config_hash: string;
  case_count: number;
  passed: number;
  failed: number;
  elapsed_ms: number;
  results: EvalCaseResult[];
}

export interface RunEvalOptions {
  compiler: SemanticCompilerPort;
  cases: readonly SemanticEvalCase[];
  signal?: AbortSignal;
  onCase?: (result: EvalCaseResult) => void;
}

export async function runSemanticEval(options: RunEvalOptions): Promise<EvalRunReport> {
  const { compiler, cases } = options;
  const entry = compiler.registryEntry;
  const results: EvalCaseResult[] = [];
  const runStart = Date.now();

  for (const evalCase of cases) {
    options.signal?.throwIfAborted();
    const started = Date.now();
    const scenario = buildEvalScenario(evalCase, entry);

    let output: CompilerOutput | null = null;
    let compilerError: string | null = null;
    try {
      output = await compiler.compile(structuredClone(scenario.input), {
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      compilerError = error instanceof Error ? error.message : 'unknown compiler error';
    }

    let grade: GradeResult | null = null;
    let boundary: BoundaryResult | null = null;
    if (output !== null) {
      grade = gradeCompilerOutput(evalCase, scenario.input, output);
      boundary = runBoundary(
        scenario.state,
        scenario.input,
        output,
        evalCase,
        scenario.next_case_version,
      );
    }

    // A case passes only when the compiler produced output, the semantic
    // graders accepted it, AND the runtime would have taken it. A reading the
    // runtime refuses is a failed reading no matter how sensible it looks.
    const ok =
      compilerError === null &&
      grade !== null &&
      grade.ok &&
      boundary !== null &&
      boundary.disposition === 'committed';

    const result: EvalCaseResult = {
      case_id: evalCase.id,
      category: evalCase.category,
      description: evalCase.description,
      ok,
      compiler_error: compilerError,
      grade,
      boundary,
      elapsed_ms: Date.now() - started,
    };
    results.push(result);
    options.onCase?.(result);
  }

  return {
    compiler_version_id: entry.compiler_version_id,
    model_id: entry.version.model_id,
    model_snapshot: entry.version.model_snapshot,
    prompt_hash: entry.version.prompt_hash,
    config_hash: entry.version.config_hash,
    case_count: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    elapsed_ms: Date.now() - runStart,
    results,
  };
}
