import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPersonAAssessmentResult,
  PERSON_A_ASSESSMENT_ADAPTER_VERSION,
} from '../clarification/build-assessments.js';
import {
  CLARIFICATION_GENERATOR_VERSION,
  generateClarificationQuestions,
} from '../clarification/question-generator.js';

type Args = {
  extraction: string;
  report: string;
  alignment: string;
  output: string;
};

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFile, '../../..');

function parseArgs(argv: string[]): Args {
  const allowed = new Set(['extraction', 'report', 'alignment', 'output']);
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
    output: resolve(projectRoot, values.get('output')!),
  };
}

async function readJson(path: string, label: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${label} artifact at ${path}`, { cause: error });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label} artifact is not valid JSON: ${path}`, { cause: error });
  }
}

function displayPath(path: string): string {
  const projectRelative = relative(projectRoot, path);
  return projectRelative.startsWith('..') ? path : projectRelative;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [extraction, report, alignment] = await Promise.all([
    readJson(args.extraction, 'extraction'),
    readJson(args.report, 'report'),
    readJson(args.alignment, 'alignment'),
  ]);
  const result = buildPersonAAssessmentResult(extraction, report, alignment);
  const generatedQuestions = generateClarificationQuestions(result.assessments, {
    maxQuestions: 6,
    phase: 'pre_lock',
  });
  const output = {
    generator_version: CLARIFICATION_GENERATOR_VERSION,
    adapter_version: PERSON_A_ASSESSMENT_ADAPTER_VERSION,
    source_artifacts: {
      extraction: displayPath(args.extraction),
      report: displayPath(args.report),
      alignment: displayPath(args.alignment),
    },
    assessments: result.assessments,
    generated_questions: generatedQuestions,
    question_count: generatedQuestions.length,
    excluded_internal_issues: result.excluded_internal_issues,
  };

  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`✓ Generated ${generatedQuestions.length} deterministic clarification questions`);
  console.log(`✓ Results written to ${args.output}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
