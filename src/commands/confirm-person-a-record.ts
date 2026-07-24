import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  confirmPersonARecord,
  type PersonARecordConfirmationResult,
} from '../runtime/person-a-record-confirmation.js';

export interface ConfirmPersonARecordCommandArgs {
  runtimePlan: string;
  answerApplication: string;
  amendedRecord: string;
  submission: string;
  output: string;
}

export interface ConfirmPersonARecordCommandDependencies {
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  makeDirectory(path: string): Promise<void>;
  confirm: typeof confirmPersonARecord;
}

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFile, '../../..');

export function parseConfirmPersonARecordArgs(argv: string[]): ConfirmPersonARecordCommandArgs {
  const allowed = new Set([
    'runtime-plan',
    'answer-application',
    'amended-record',
    'submission',
    'output',
  ]);
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
  for (const name of allowed) {
    if (!values.has(name)) throw new TypeError(`Required option is missing: --${name}`);
  }
  return {
    runtimePlan: resolve(projectRoot, values.get('runtime-plan')!),
    answerApplication: resolve(projectRoot, values.get('answer-application')!),
    amendedRecord: resolve(projectRoot, values.get('amended-record')!),
    submission: resolve(projectRoot, values.get('submission')!),
    output: resolve(projectRoot, values.get('output')!),
  };
}

const defaultDependencies: ConfirmPersonARecordCommandDependencies = {
  readText: (path) => readFile(path, 'utf8'),
  writeText: (path, contents) => writeFile(path, contents, { flag: 'wx' }),
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  confirm: confirmPersonARecord,
};

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new TypeError(`${label} must contain valid JSON.`, { cause: error });
  }
}

export async function runConfirmPersonARecordCommand(
  argv: string[],
  dependencies: ConfirmPersonARecordCommandDependencies = defaultDependencies,
): Promise<PersonARecordConfirmationResult> {
  const args = parseConfirmPersonARecordArgs(argv);
  const [runtimePlan, answerApplication, amendedRecord, submission] = (
    await Promise.all([
      dependencies.readText(args.runtimePlan),
      dependencies.readText(args.answerApplication),
      dependencies.readText(args.amendedRecord),
      dependencies.readText(args.submission),
    ])
  ).map((text, index) =>
    parseJson(
      text,
      ['Runtime plan', 'Answer application', 'Amended record', 'Confirmation submission'][index]!,
    ),
  );
  const result = dependencies.confirm({
    runtimePlan,
    answerApplication,
    amendedRecord,
    submission,
  });
  await dependencies.makeDirectory(dirname(args.output));
  await dependencies.writeText(args.output, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    const result = await runConfirmPersonARecordCommand(process.argv.slice(2));
    console.log(`Person A record confirmation ${result.status}.`);
    if (result.status === 'invalid') process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
