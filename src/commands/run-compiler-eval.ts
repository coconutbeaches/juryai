/**
 * Semantic-compiler eval CLI.
 *
 *   npm run eval:compiler          offline: no key, no network, no paid call
 *   npm run eval:compiler -- --live   live: requires explicit configuration
 *
 * Offline is the default and is what CI runs. `--live` is opt-in and FAILS
 * LOUDLY when it is not configured: silently skipping a requested live eval and
 * printing a pass would be the single most misleading thing this tool could do.
 */

import {
  formatEvalReport,
  formatMalformedReport,
  formatTrapReport,
  runMalformedSuite,
  runOfflineCorpus,
  runSemanticEval,
  runTrapSuite,
  SEMANTIC_EVAL_CORPUS,
  SEMANTIC_EVAL_CORPUS_VERSION,
} from '../webmcp/eval/index.js';
import {
  CompilerConfigurationError,
  createLiveSemanticCompiler,
} from '../webmcp/compiler/index.js';

function has(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function filterCases(): typeof SEMANTIC_EVAL_CORPUS {
  const args = process.argv.slice(2);
  const index = args.indexOf('--case');
  if (index < 0) return SEMANTIC_EVAL_CORPUS;
  const wanted = args[index + 1];
  if (wanted === undefined) throw new Error('--case requires an eval case id.');
  const selected = SEMANTIC_EVAL_CORPUS.filter((entry) => entry.id === wanted);
  if (selected.length === 0) throw new Error("No eval case with id '" + wanted + "'.");
  return selected;
}

async function runOffline(): Promise<boolean> {
  const cases = filterCases();
  const report = await runOfflineCorpus(cases);
  process.stdout.write(formatEvalReport(report) + '\n');

  const traps = await runTrapSuite(cases);
  process.stdout.write(formatTrapReport(traps) + '\n');

  const malformed = await runMalformedSuite();
  process.stdout.write(formatMalformedReport(malformed) + '\n');

  process.stdout.write(
    '\nOffline replay exercises the real compiler over a scripted provider seam.\n' +
      'It is evidence about the pipeline and the graders. It is NOT evidence about\n' +
      'any model: no model was called.\n',
  );
  return report.failed === 0 && traps.failed === 0 && malformed.every((result) => result.rejected);
}

async function runLive(): Promise<boolean> {
  let compiler;
  try {
    compiler = createLiveSemanticCompiler();
  } catch (error) {
    if (error instanceof CompilerConfigurationError) {
      process.stderr.write('Live eval requested but not configured: ' + error.message + '\n');
      process.stderr.write(
        'Set JURYAI_COMPILER_API_KEY (or OPENAI_API_KEY) and JURYAI_COMPILER_MODEL.\n',
      );
      return false;
    }
    throw error;
  }

  const cases = filterCases();
  const report = await runSemanticEval({ compiler, cases });
  process.stdout.write(formatEvalReport(report) + '\n');

  // Provider usage is diagnostics, printed as such. It never reaches canonical
  // state and it is not part of the pass criterion.
  const inputTokens = compiler.telemetry.reduce((sum, entry) => sum + (entry.input_tokens ?? 0), 0);
  const outputTokens = compiler.telemetry.reduce(
    (sum, entry) => sum + (entry.output_tokens ?? 0),
    0,
  );
  const reported = [...new Set(compiler.telemetry.map((entry) => entry.reported_model ?? '?'))];
  process.stdout.write(
    '\nProvider diagnostics (non-authoritative)\n' +
      '  provider-reported model  ' +
      reported.join(', ') +
      '\n  input tokens             ' +
      String(inputTokens) +
      '\n  output tokens            ' +
      String(outputTokens) +
      '\n  provider calls           ' +
      String(compiler.telemetry.reduce((sum, entry) => sum + entry.attempts, 0)) +
      '\n',
  );
  return report.failed === 0;
}

async function main(): Promise<void> {
  process.stdout.write('corpus: ' + SEMANTIC_EVAL_CORPUS_VERSION + '\n\n');
  const ok = has('--live') ? await runLive() : await runOffline();
  if (!ok) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
});
