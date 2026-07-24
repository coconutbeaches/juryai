import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolvePersonAChallenges,
  type PersonAChallengeResolutionResult,
} from '../runtime/person-a-challenge-resolution.js';

export interface ResolvePersonAChallengesCommandArgs {
  confirmationResult: string;
  amendedRecord: string;
  request: string;
  recordVersion: number;
  createdAt?: string;
  output: string;
}

export interface ResolvePersonAChallengesCommandDependencies {
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  makeDirectory(path: string): Promise<void>;
  resolve: typeof resolvePersonAChallenges;
}

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFile, '../../..');

export function parseResolvePersonAChallengesArgs(
  argv: string[],
): ResolvePersonAChallengesCommandArgs {
  const required = new Set([
    'confirmation-result',
    'amended-record',
    'request',
    'record-version',
    'output',
  ]);
  const allowed = new Set([...required, 'created-at']);
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
  for (const name of required) {
    if (!values.has(name)) throw new TypeError(`Required option is missing: --${name}`);
  }
  const recordVersion = Number(values.get('record-version'));
  if (!Number.isSafeInteger(recordVersion) || recordVersion < 1) {
    throw new TypeError('--record-version must be a positive safe integer.');
  }
  return {
    confirmationResult: resolve(projectRoot, values.get('confirmation-result')!),
    amendedRecord: resolve(projectRoot, values.get('amended-record')!),
    request: resolve(projectRoot, values.get('request')!),
    recordVersion,
    ...(values.has('created-at') ? { createdAt: values.get('created-at')! } : {}),
    output: resolve(projectRoot, values.get('output')!),
  };
}

const defaultDependencies: ResolvePersonAChallengesCommandDependencies = {
  readText: (path) => readFile(path, 'utf8'),
  writeText: (path, contents) => writeFile(path, contents, { flag: 'wx' }),
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  resolve: resolvePersonAChallenges,
};

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new TypeError(`${label} must contain valid JSON.`, { cause: error });
  }
}

export async function runResolvePersonAChallengesCommand(
  argv: string[],
  dependencies: ResolvePersonAChallengesCommandDependencies = defaultDependencies,
): Promise<PersonAChallengeResolutionResult> {
  const args = parseResolvePersonAChallengesArgs(argv);
  const [confirmationResult, amendedRecord, request] = (
    await Promise.all([
      dependencies.readText(args.confirmationResult),
      dependencies.readText(args.amendedRecord),
      dependencies.readText(args.request),
    ])
  ).map((text, index) =>
    parseJson(text, ['Confirmation result', 'Amended record', 'Resolution request'][index]!),
  );
  const result = dependencies.resolve({
    confirmationResult,
    amendedRecord,
    currentRecordVersion: args.recordVersion,
    request,
    ...(args.createdAt ? { options: { createdAt: args.createdAt } } : {}),
  });
  await dependencies.makeDirectory(dirname(args.output));
  await dependencies.writeText(args.output, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    const result = await runResolvePersonAChallengesCommand(process.argv.slice(2));
    console.log(`Person A challenge resolution ${result.status}.`);
    if (result.status !== 'resolved') process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
