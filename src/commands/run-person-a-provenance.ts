import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAIResponsesClient } from '../extraction/openai-responses.js';
import {
  replayPersonAProvenance,
  runLivePersonAProvenance,
  type PersonAProvenanceRepositoryState,
} from '../extraction/person-a-provenance.js';
import {
  PERSON_A_PROVENANCE_PROJECT_ROOT,
  type PersonAProvenanceCaseId,
} from '../extraction/person-a-provenance-cases.js';

type PersonAProvenanceCommandArgs = {
  mode: 'live' | 'replay';
  caseId: PersonAProvenanceCaseId;
  outputDir: string;
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high';
  submittedAt?: string;
  requestTimestamp?: string;
  rawResponse?: string;
  requestMetadata?: string;
};

export type RunPersonAProvenanceCommandDependencies = {
  getEnvironment(name: string): string | undefined;
  now(): string;
  repositoryState(): PersonAProvenanceRepositoryState;
  createClient(apiKey: string, baseUrl?: string): OpenAIResponsesClient;
};

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}.`);
  return value;
}

function resolveOutputDirectory(value: string): string {
  const outputDir = resolve(PERSON_A_PROVENANCE_PROJECT_ROOT, value);
  const artifactsRoot = resolve(PERSON_A_PROVENANCE_PROJECT_ROOT, 'artifacts');
  const fromArtifacts = relative(artifactsRoot, outputDir);
  if (
    fromArtifacts.length === 0 ||
    fromArtifacts === '..' ||
    fromArtifacts.startsWith(`..${sep}`) ||
    isAbsolute(fromArtifacts)
  ) {
    throw new Error('--output-dir must be a new directory below artifacts/.');
  }
  return outputDir;
}

export function parsePersonAProvenanceCommandArgs(argv: string[]): PersonAProvenanceCommandArgs {
  const values = new Map<string, string>();
  const supported = new Set([
    '--mode',
    '--case-id',
    '--output-dir',
    '--model',
    '--reasoning-effort',
    '--submitted-at',
    '--request-timestamp',
    '--raw-response',
    '--request-metadata',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!supported.has(option)) throw new Error(`Unknown option: ${option}`);
    if (values.has(option)) throw new Error(`Duplicate option: ${option}`);
    values.set(option, requireValue(argv, index, option));
    index += 1;
  }

  const mode = values.get('--mode');
  if (mode !== 'live' && mode !== 'replay') {
    throw new Error('--mode must be live or replay.');
  }
  const caseId = values.get('--case-id');
  if (caseId !== 'dry_run_001' && caseId !== 'dry_run_002') {
    throw new Error('--case-id must be dry_run_001 or dry_run_002.');
  }
  const outputDir = values.get('--output-dir');
  if (!outputDir) throw new Error('--output-dir is required.');
  const reasoningEffort = values.get('--reasoning-effort') ?? 'medium';
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new Error('--reasoning-effort must be low, medium, or high.');
  }

  const parsed: PersonAProvenanceCommandArgs = {
    mode,
    caseId,
    outputDir: resolveOutputDirectory(outputDir),
    model: values.get('--model') ?? 'gpt-5.6',
    reasoningEffort: reasoningEffort as 'low' | 'medium' | 'high',
  };
  if (values.has('--submitted-at')) parsed.submittedAt = values.get('--submitted-at');
  if (values.has('--request-timestamp')) {
    parsed.requestTimestamp = values.get('--request-timestamp');
  }
  if (values.has('--raw-response')) {
    parsed.rawResponse = resolve(PERSON_A_PROVENANCE_PROJECT_ROOT, values.get('--raw-response')!);
  }
  if (values.has('--request-metadata')) {
    parsed.requestMetadata = resolve(
      PERSON_A_PROVENANCE_PROJECT_ROOT,
      values.get('--request-metadata')!,
    );
  }

  if (mode === 'live') {
    if (!parsed.submittedAt) throw new Error('--submitted-at is required in live mode.');
    if (parsed.rawResponse || parsed.requestMetadata) {
      throw new Error('Live mode does not accept replay artifacts.');
    }
  } else {
    if (!parsed.rawResponse || !parsed.requestMetadata) {
      throw new Error('Replay mode requires --raw-response and --request-metadata.');
    }
    if (parsed.submittedAt || parsed.requestTimestamp) {
      throw new Error('Replay mode reads timestamps from frozen request metadata.');
    }
  }
  return parsed;
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: PERSON_A_PROVENANCE_PROJECT_ROOT,
    encoding: 'utf8',
  }).trim();
}

const defaultDependencies: RunPersonAProvenanceCommandDependencies = {
  getEnvironment: (name) => process.env[name],
  now: () => new Date().toISOString(),
  repositoryState: () => ({
    sha: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
    clean: git(['status', '--porcelain=v1']).length === 0,
  }),
  createClient: (apiKey, baseUrl) => new OpenAIResponsesClient(apiKey, baseUrl),
};

export async function runPersonAProvenanceCommand(
  argv: string[],
  dependencies: RunPersonAProvenanceCommandDependencies = defaultDependencies,
): Promise<void> {
  const args = parsePersonAProvenanceCommandArgs(argv);
  const repository = dependencies.repositoryState();
  if (args.mode === 'replay') {
    const result = await replayPersonAProvenance({
      caseId: args.caseId,
      outputDir: args.outputDir,
      rawResponsePath: args.rawResponse!,
      requestMetadataPath: args.requestMetadata!,
      repository,
    });
    process.stdout.write(`✓ Person A provenance replay completed: ${result.outputDir}\n`);
    return;
  }

  if (!repository.clean) {
    throw new Error('Live provenance execution requires a clean worktree.');
  }
  const apiKey = dependencies.getEnvironment('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for live provenance execution.');
  const client = dependencies.createClient(apiKey, dependencies.getEnvironment('OPENAI_BASE_URL'));
  const result = await runLivePersonAProvenance({
    caseId: args.caseId,
    outputDir: args.outputDir,
    submittedAt: args.submittedAt!,
    requestTimestamp: args.requestTimestamp ?? dependencies.now(),
    model: args.model,
    reasoningEffort: args.reasoningEffort,
    repository,
    client,
  });
  process.stdout.write(`✓ Person A provenance live run completed: ${result.outputDir}\n`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    await runPersonAProvenanceCommand(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
