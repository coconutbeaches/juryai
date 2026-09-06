/**
 * V0.4 eval reporting.
 *
 * A pure formatter, deliberately separated from the live command so it can be
 * TESTED. The command may not be imported by any test — a structural guard
 * enforces that, so CI can never reach a model — which would otherwise leave
 * the report's one security-relevant rule with no behavioural coverage at all.
 *
 * WHAT MUST NEVER APPEAR HERE. No answer text, no context text, no model
 * statement, no clarification prompt, no failure prose. Failures are named by
 * case id and machine rule. An eval report is read by people who are not
 * entitled to the case material, and a reporting path that leaks legal text is
 * a privacy incident wearing a diagnostic hat.
 *
 * The provider-reported model is the one field here that is not ours. A gateway
 * can return any string in `model`, so it is validated to identifier shape
 * before it is printed; otherwise a response could inject newlines, or
 * submitted case text, into exactly the report that is supposed to contain
 * none.
 */

import { formatProviderModelIdentifier } from '../eval/report.js';
import type { SemanticEvalCaseV04 } from '../eval-v0-4/types.js';
import { SEMANTIC_EVAL_CORPUS_VERSION, casesByCategory, corpusHash } from './index.js';
import type { CorpusRunResult } from './runner.js';

const line = (label: string, value: string): string => `${label.padEnd(22)}${value}`;

/** Provider-supplied identity, reduced to something printable. */
export function formatReportedModels(reportedModels: readonly string[]): string {
  const formatted = reportedModels.map((value) => formatProviderModelIdentifier(value));
  return formatted.join(', ') || '(none reported)';
}

export function formatEvalReportV04(
  label: string,
  corpus: readonly SemanticEvalCaseV04[],
  run: CorpusRunResult,
): string {
  const out: string[] = [
    '',
    `=== V0.4 SEMANTIC EVAL — ${label} ===`,
    line('corpus_version', SEMANTIC_EVAL_CORPUS_VERSION),
    line('corpus_hash', corpusHash(corpus)),
    line('compiler_version_id', run.compiler_version_id),
    line('prompt_version', run.prompt_version),
    line('prompt_hash', run.prompt_hash),
    line('config_hash', run.config_hash),
    line('contract_version', run.contract_version),
    line('model_id', run.model_id),
    line('model_snapshot', run.model_snapshot ?? 'null (moving alias, not pinned)'),
    line('provider_reported', formatReportedModels(run.reported_models)),
    '',
    line('cases', String(run.case_count)),
    line('passed', String(run.passed)),
    line('failed', String(run.failed)),
    line('hard_blockers', String(run.hard_blocker_count)),
    line('ordinary_failures', String(run.ordinary_failure_count)),
    line('provider_calls', String(run.provider_calls)),
    line('input_tokens', run.input_tokens === null ? 'n/a' : String(run.input_tokens)),
    line('output_tokens', run.output_tokens === null ? 'n/a' : String(run.output_tokens)),
    line('elapsed_ms', String(run.elapsed_ms)),
    '',
    'cases by category:',
  ];

  for (const [category, list] of [...casesByCategory(corpus)].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    out.push(`  ${category.padEnd(34)} ${String(list.length)}`);
  }

  const failures = run.results.filter((entry) => !entry.ok);
  if (failures.length > 0) {
    out.push('', 'FAILURES (case id and machine rule only — no case or model text):');
    for (const entry of failures) {
      const blockers = entry.hard_blockers.map((item) => `HARD:${item.rule}`);
      const ordinary = entry.ordinary_failures.map((item) => `ord:${item.rule}`);
      const threw = entry.error === null ? '' : ` threw:${entry.error}`;
      out.push(`  ${entry.case_id.padEnd(40)} ${[...blockers, ...ordinary].join(' ')}${threw}`);
    }
  }

  return out.join('\n');
}
