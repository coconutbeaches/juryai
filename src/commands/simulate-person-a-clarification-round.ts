import { isDeepStrictEqual } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignPersonA } from '../alignment/person-a-alignment-corrected.js';
import {
  applyClarificationRound,
  buildBeforeAfterSummary,
  CLARIFICATION_ROUND_VERSION,
} from '../clarification/apply-clarification-round.js';
import { evaluatePersonA } from '../evaluation/person-a-diff-corrected.js';
import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';

type JsonObject = Record<string, any>;

type Args = {
  extraction: string;
  report: string;
  alignment: string;
  clarifications: string;
  answers: string;
  outputDir: string;
};

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFile, '../../..');
const canonicalGoldenPath = resolve(projectRoot, 'src/fixtures/dry_run_001.golden.json');

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArgs(argv: string[]): Args {
  const allowed = new Set([
    'extraction',
    'report',
    'alignment',
    'clarifications',
    'answers',
    'output-dir',
  ]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) throw new TypeError(`Unexpected argument: ${String(token)}`);
    const name = token.slice(2);
    if (!allowed.has(name)) throw new TypeError(`Unknown option: --${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new TypeError(`Missing value for --${name}`);
    if (values.has(name)) throw new TypeError(`Duplicate option: --${name}`);
    values.set(name, value);
    index += 1;
  }
  for (const name of allowed) {
    if (!values.has(name)) throw new TypeError(`Required option is missing: --${name}`);
  }
  return {
    extraction: resolve(projectRoot, values.get('extraction')!),
    report: resolve(projectRoot, values.get('report')!),
    alignment: resolve(projectRoot, values.get('alignment')!),
    clarifications: resolve(projectRoot, values.get('clarifications')!),
    answers: resolve(projectRoot, values.get('answers')!),
    outputDir: resolve(projectRoot, values.get('output-dir')!),
  };
}

async function readJson(path: string, label: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${path}`, { cause: error });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${path}`, { cause: error });
  }
}

async function writeJson(directory: string, filename: string, value: unknown): Promise<void> {
  await writeFile(resolve(directory, filename), `${JSON.stringify(value, null, 2)}\n`);
}

function assertArtifactObject(value: unknown, label: string): asserts value is JsonObject {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [extraction, savedReport, savedAlignment, clarifications, answerFixture, fullGolden] =
    await Promise.all([
      readJson(args.extraction, 'extraction artifact'),
      readJson(args.report, 'report artifact'),
      readJson(args.alignment, 'alignment artifact'),
      readJson(args.clarifications, 'clarifications artifact'),
      readJson(args.answers, 'clarification answers fixture'),
      readJson(canonicalGoldenPath, 'canonical golden fixture'),
    ]);

  assertArtifactObject(extraction, 'extraction artifact');
  assertArtifactObject(clarifications, 'clarifications artifact');
  assertArtifactObject(answerFixture, 'clarification answers fixture');
  if (!Array.isArray(clarifications.generated_questions)) {
    throw new TypeError('clarifications.generated_questions must be an array');
  }
  if (answerFixture.version !== 'person-a-clarification-answers-v0.1.0') {
    throw new TypeError('clarification answers fixture version is invalid');
  }
  if (!Array.isArray(answerFixture.answers)) {
    throw new TypeError('clarification answers fixture answers must be an array');
  }
  const narrative = extraction.submission?.raw_text;
  if (typeof narrative !== 'string') {
    throw new TypeError('extraction submission raw_text must be present');
  }

  const goldenProjection = buildPersonAGoldenProjection();
  const beforeAlignment = alignPersonA(extraction, goldenProjection);
  const beforeReport = evaluatePersonA(extraction, goldenProjection, beforeAlignment);
  if (!isDeepStrictEqual(savedAlignment, beforeAlignment)) {
    throw new Error('saved alignment does not match deterministic reevaluation');
  }
  if (!isDeepStrictEqual(savedReport, beforeReport)) {
    throw new Error('saved report does not match deterministic reevaluation');
  }

  const round = applyClarificationRound({
    extraction,
    questions: clarifications.generated_questions,
    answers: answerFixture.answers,
    goldenFixture: fullGolden,
    narrative,
  });
  const validation = validatePersonAExtraction(round.projected_effective_record, narrative);
  if (!validation.valid) {
    const messages = [...validation.schemaErrors, ...validation.invariantErrors].map(
      (error) => `${error.path}: ${error.message}`,
    );
    throw new Error(`clarified extraction failed validation:\n${messages.join('\n')}`);
  }

  const afterAlignment = alignPersonA(round.projected_effective_record, goldenProjection);
  const afterReport = evaluatePersonA(
    round.projected_effective_record,
    goldenProjection,
    afterAlignment,
  );
  const summary = buildBeforeAfterSummary(beforeReport, afterReport, round);

  await mkdir(args.outputDir, { recursive: true });
  await Promise.all([
    writeJson(args.outputDir, 'clarified-extraction.json', round.projected_effective_record),
    writeJson(args.outputDir, 'amendments.json', {
      version: CLARIFICATION_ROUND_VERSION,
      applied_amendments: round.applied_amendments,
    }),
    writeJson(args.outputDir, 'amendment-audit.json', {
      audit_summary: round.audit_summary,
      rejected_amendments: round.rejected_amendments,
      source_artifacts: {
        extraction: relative(projectRoot, args.extraction),
        report: relative(projectRoot, args.report),
        alignment: relative(projectRoot, args.alignment),
        clarifications: relative(projectRoot, args.clarifications),
        answers: relative(projectRoot, args.answers),
      },
    }),
    writeJson(args.outputDir, 'unresolved-questions.json', {
      version: CLARIFICATION_ROUND_VERSION,
      unresolved_questions: round.unresolved_questions,
    }),
    writeJson(args.outputDir, 'alignment.json', afterAlignment),
    writeJson(args.outputDir, 'report.json', afterReport),
    writeJson(args.outputDir, 'before-after-summary.json', summary),
  ]);

  console.log(
    `✓ Applied ${round.applied_amendments.length} amendments; ${round.unresolved_questions.length} questions remain unresolved`,
  );
  console.log(`✓ Clarification simulation written to ${args.outputDir}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
