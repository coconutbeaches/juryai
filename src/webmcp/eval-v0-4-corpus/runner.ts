/**
 * Runs a V0.4 corpus through the REAL V0.4 compiler and the 8C1b-0 oracle.
 *
 * ONE run path, used by both the offline replay and the live eval. That is the
 * point: if offline had its own shortened path, a green offline run would prove
 * something about a pipeline the live run does not use, and the difference
 * would only surface when the model was already being blamed.
 *
 * The two modes differ in exactly one object — the `SemanticModelClient` — so
 * offline exercises the real prompt artefact, the real V0.4 rendering, the real
 * V0.4 schema, the real parser and grounding resolution, the real V0.4 contract
 * and the real grader, with only the completion bytes scripted.
 *
 * INPUT IDENTITY IS BOUND, NOT ASSERTED. Every case input is built with the
 * compiler's own `registryEntry.compiler_version_id`, and the compiler refuses
 * anything else. So a report naming a compiler artefact is a report about the
 * artefact that actually ran.
 *
 * NO RESAMPLING. A case that produces malformed or ungrounded output is a
 * FAILED case, recorded as such. Retrying it until it parses would convert a
 * fabricating model into one that eventually gets lucky, and the eval exists to
 * measure exactly that.
 */

import type { CompilerOutput } from '../core-v0-3/compiler-contract.js';
import { buildEvalInputV04 } from '../eval-v0-4/scenario.js';
import { gradeCompilerOutputV04 } from '../eval-v0-4/graders.js';
import type { EvalFailureV04, SemanticEvalCaseV04 } from '../eval-v0-4/types.js';
import { ModelSemanticCompilerV04 } from '../compiler-v0-4/model-compiler.js';

export interface CaseRunResult {
  case_id: string;
  category: string;
  ok: boolean;
  /** Set when the compile itself threw: a failed case, never a retried one. */
  error: string | null;
  hard_blockers: EvalFailureV04[];
  ordinary_failures: EvalFailureV04[];
}

export interface CorpusRunResult {
  compiler_version_id: string;
  prompt_version: string;
  prompt_hash: string;
  config_hash: string;
  model_id: string;
  model_snapshot: string | null;
  contract_version: string;
  case_count: number;
  passed: number;
  failed: number;
  hard_blocker_count: number;
  ordinary_failure_count: number;
  provider_calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  reported_models: string[];
  elapsed_ms: number;
  results: CaseRunResult[];
}

/**
 * A compile that threw is recorded as one failed case with a content-free
 * reason. The message is the error's NAME only: a provider error can quote
 * model output, and eval reporting must never relay case or model text.
 */
function errorLabel(error: unknown): string {
  if (error instanceof Error) return error.name;
  return 'UnknownError';
}

export async function runCorpusV04(
  compiler: ModelSemanticCompilerV04,
  cases: readonly SemanticEvalCaseV04[],
): Promise<CorpusRunResult> {
  const startedAt = Date.now();
  const results: CaseRunResult[] = [];

  for (const evalCase of cases) {
    // THE BINDING. The compiler refuses any other compiler_version_id.
    const input = buildEvalInputV04(evalCase, compiler.registryEntry.compiler_version_id);
    let output: CompilerOutput | null = null;
    let error: string | null = null;
    try {
      output = await compiler.compile(input);
    } catch (thrown) {
      error = errorLabel(thrown);
    }

    if (output === null) {
      results.push({
        case_id: evalCase.id,
        category: evalCase.category,
        ok: false,
        error,
        // A compile that never produced output is a hard failure of the run,
        // not an ordinary miss: nothing was measured.
        hard_blockers: [{ rule: 'compile.failed', severity: 'hard_blocker' }],
        ordinary_failures: [],
      });
      continue;
    }

    const graded = gradeCompilerOutputV04(evalCase, input, output);
    results.push({
      case_id: evalCase.id,
      category: evalCase.category,
      ok: graded.ok,
      error: null,
      hard_blockers: graded.hard_blockers,
      ordinary_failures: graded.ordinary_failures,
    });
  }

  const telemetry = compiler.telemetry;
  const sum = (pick: (entry: (typeof telemetry)[number]) => number | null): number | null => {
    const values = telemetry.map(pick).filter((value): value is number => value !== null);
    return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
  };

  const version = compiler.registryEntry.version;
  const config = compiler.registryEntry.config as unknown as { prompt_version: string };
  return {
    compiler_version_id: compiler.registryEntry.compiler_version_id,
    prompt_version: config.prompt_version,
    prompt_hash: version.prompt_hash,
    config_hash: version.config_hash,
    model_id: version.model_id,
    model_snapshot: version.model_snapshot,
    contract_version: version.schema_version,
    case_count: cases.length,
    passed: results.filter((entry) => entry.ok).length,
    failed: results.filter((entry) => !entry.ok).length,
    hard_blocker_count: results.reduce((total, entry) => total + entry.hard_blockers.length, 0),
    ordinary_failure_count: results.reduce(
      (total, entry) => total + entry.ordinary_failures.length,
      0,
    ),
    provider_calls: telemetry.reduce((total, entry) => total + entry.attempts, 0),
    input_tokens: sum((entry) => entry.input_tokens),
    output_tokens: sum((entry) => entry.output_tokens),
    reported_models: [
      ...new Set(
        telemetry
          .map((entry) => entry.reported_model)
          .filter((value): value is string => value !== null),
      ),
    ],
    elapsed_ms: Date.now() - startedAt,
    results,
  };
}
