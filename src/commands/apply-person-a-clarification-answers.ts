import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyPersonAClarificationAnswers,
  PERSON_A_CLARIFICATION_ANSWER_BATCH_VERSION,
  type PersonAClarificationAnswerApplicationOptions,
  type PersonAClarificationAnswerApplicationResult,
} from '../runtime/person-a-clarification-answer-application.js';

type JsonObject = Record<string, unknown>;

export interface ApplyPersonAClarificationsCommandArgs {
  runtimePlan: string;
  answers: string;
  outputDir: string;
}

export interface ApplyPersonAClarificationsCommandDependencies {
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  makeDirectory(path: string): Promise<void>;
  apply: typeof applyPersonAClarificationAnswers;
}

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFile, '../../..');

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseApplyPersonAClarificationsArgs(
  argv: string[],
): ApplyPersonAClarificationsCommandArgs {
  const allowed = new Set(['runtime-plan', 'answers', 'output-dir']);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--') || token === '--' || token.startsWith('---')) {
      throw new TypeError(`Unexpected positional or short argument: ${String(token)}`);
    }
    const name = token.slice(2);
    if (!allowed.has(name)) throw new TypeError(`Unknown option: --${name}`);
    if (values.has(name)) throw new TypeError(`Duplicate option: --${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) throw new TypeError(`Missing value for --${name}`);
    values.set(name, value);
    index += 1;
  }
  for (const required of allowed) {
    if (!values.has(required)) throw new TypeError(`Required option is missing: --${required}`);
  }
  return {
    runtimePlan: resolve(projectRoot, values.get('runtime-plan')!),
    answers: resolve(projectRoot, values.get('answers')!),
    outputDir: resolve(projectRoot, values.get('output-dir')!),
  };
}

const defaultDependencies: ApplyPersonAClarificationsCommandDependencies = {
  readText: (path) => readFile(path, 'utf8'),
  writeText: (path, contents) => writeFile(path, contents),
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  apply: applyPersonAClarificationAnswers,
};

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new TypeError(`${label} must contain valid JSON.`, { cause: error });
  }
}

function deterministicJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function answerBatch(value: unknown): {
  answers: unknown[];
  options: PersonAClarificationAnswerApplicationOptions;
} {
  if (
    !isRecord(value) ||
    value.version !== PERSON_A_CLARIFICATION_ANSWER_BATCH_VERSION ||
    !Array.isArray(value.answers) ||
    Object.keys(value).some((key) => !['version', 'answers', 'options'].includes(key))
  ) {
    throw new TypeError('Answer batch does not match the documented runtime contract.');
  }
  const rawOptions = value.options ?? {};
  if (
    !isRecord(rawOptions) ||
    Object.keys(rawOptions).some(
      (key) =>
        !['created_at', 'expired_question_ids', 'already_applied_question_ids'].includes(key),
    )
  ) {
    throw new TypeError('Answer batch options are malformed.');
  }
  const options: PersonAClarificationAnswerApplicationOptions = {};
  if (rawOptions.created_at !== undefined && rawOptions.created_at !== null) {
    if (typeof rawOptions.created_at !== 'string') {
      throw new TypeError('created_at must be null or an RFC 3339 UTC string.');
    }
    options.createdAt = rawOptions.created_at;
  }
  if (rawOptions.expired_question_ids !== undefined) {
    if (!Array.isArray(rawOptions.expired_question_ids)) {
      throw new TypeError('expired_question_ids must be an array.');
    }
    options.expiredQuestionIds = rawOptions.expired_question_ids as string[];
  }
  if (rawOptions.already_applied_question_ids !== undefined) {
    if (!Array.isArray(rawOptions.already_applied_question_ids)) {
      throw new TypeError('already_applied_question_ids must be an array.');
    }
    options.alreadyAppliedQuestionIds = rawOptions.already_applied_question_ids as string[];
  }
  return { answers: value.answers, options };
}

export async function runApplyPersonAClarificationsCommand(
  argv: string[],
  dependencies: ApplyPersonAClarificationsCommandDependencies = defaultDependencies,
): Promise<PersonAClarificationAnswerApplicationResult> {
  const args = parseApplyPersonAClarificationsArgs(argv);
  const [runtimePlanText, answersText] = await Promise.all([
    dependencies.readText(args.runtimePlan),
    dependencies.readText(args.answers),
  ]);
  const runtimePlan = parseJson(runtimePlanText, 'Runtime plan');
  const batch = answerBatch(parseJson(answersText, 'Answer batch'));
  const baseline = isRecord(runtimePlan) ? runtimePlan.repaired_extraction : null;
  const result = dependencies.apply({
    baseline,
    runtimePlan,
    answers: batch.answers,
    options: batch.options,
  });

  await dependencies.makeDirectory(args.outputDir);
  const artifacts: Record<string, unknown> = {
    'submitted-answers.json': result.submitted_answers,
    'validated-answers.json': result.validated_answers,
    'amendments.json': result.amendments,
    'amended-person-a.json': result.amended_record,
    'answer-application-audit.json': {
      stage_statuses: result.stage_statuses,
      rejected_answers: result.rejected_answers,
      validation_errors: result.validation_errors,
      audit: result.audit,
    },
    'runtime-answer-result.json': result,
  };
  await Promise.all(
    Object.entries(artifacts).map(([filename, value]) =>
      dependencies.writeText(resolve(args.outputDir, filename), deterministicJson(value)),
    ),
  );
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    const result = await runApplyPersonAClarificationsCommand(process.argv.slice(2));
    console.log(
      `Person A clarification answer application ${result.audit.final_status}: ${result.amendments.length} amendment(s).`,
    );
    if (result.audit.final_status === 'failed_closed') process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
