/**
 * Human-readable eval reporting.
 *
 * The header is the reproducibility record: which compiler artefact ran, over
 * which prompt and config, against which model. A pass rate without that is an
 * unattributable number.
 *
 * User answers are never printed. The corpus is synthetic, but this formatter
 * is the one a live run against real case material would also use, and a
 * reporting path that prints answers by default is a reporting path that leaks
 * legal-case material into CI logs.
 */

import type { EvalRunReport } from './runner.js';
import type { MalformedResult, TrapSuiteReport } from './offline.js';

function line(label: string, value: string): string {
  return label.padEnd(22) + value;
}

export function formatEvalReport(report: EvalRunReport): string {
  const out: string[] = [
    'JuryAI semantic compiler eval',
    line('model_id', report.model_id),
    line('model_snapshot', report.model_snapshot ?? '(none declared)'),
    line('compiler_version_id', report.compiler_version_id),
    line('prompt_hash', report.prompt_hash),
    line('config_hash', report.config_hash),
    line('cases', String(report.case_count)),
    line('passed', String(report.passed)),
    line('failed', String(report.failed)),
    line('elapsed_ms', String(report.elapsed_ms)),
    '',
  ];

  for (const result of report.results) {
    out.push(
      (result.ok ? '  PASS  ' : '  FAIL  ') +
        result.case_id.padEnd(38) +
        result.category +
        ' (' +
        String(result.elapsed_ms) +
        'ms)',
    );
    if (result.ok) continue;
    if (result.compiler_error !== null) {
      out.push('          compiler error: ' + result.compiler_error);
    }
    for (const failure of result.grade?.failures ?? []) {
      out.push('          ' + failure);
    }
    if (result.boundary && result.boundary.disposition !== 'committed') {
      out.push(
        '          runtime boundary: ' +
          result.boundary.disposition +
          ' (' +
          (result.boundary.issues[0]?.code ?? 'no issue code') +
          ')',
      );
    }
  }
  return out.join('\n');
}

export function formatTrapReport(report: TrapSuiteReport): string {
  const out: string[] = [
    '',
    'Trap suite (completions that MUST be refused)',
    line('traps', String(report.trap_count)),
    line('passed', String(report.passed)),
    line('failed', String(report.failed)),
    '',
  ];
  for (const result of report.results) {
    out.push(
      (result.ok ? '  PASS  ' : '  FAIL  ') +
        (result.case_id + ' / ' + result.trap).padEnd(72) +
        'expected ' +
        result.expected_layer +
        ', got ' +
        (result.actual_layer ?? 'NOT CAUGHT'),
    );
    if (!result.ok) out.push('          ' + result.detail);
  }
  return out.join('\n');
}

export function formatMalformedReport(results: readonly MalformedResult[]): string {
  const out: string[] = ['', 'Malformed provider output', ''];
  for (const result of results) {
    out.push((result.rejected ? '  PASS  ' : '  FAIL  ') + result.name.padEnd(48) + result.detail);
  }
  return out.join('\n');
}
