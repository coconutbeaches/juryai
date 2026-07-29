import { execFileSync } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openAIResponsesEndpointIdentity,
  OpenAIResponsesClient,
  type RawStructuredExtractionClient,
} from '../extraction/openai-responses.js';
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
  runManifest?: string;
};

export type RunPersonAProvenanceCommandDependencies = {
  getEnvironment(name: string): string | undefined;
  now(): string;
  repositoryState(): PersonAProvenanceRepositoryState;
  createClient(apiKey: string, baseUrl?: string): RawStructuredExtractionClient;
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

async function assertNoSymlinkedOutputComponents(outputDir: string): Promise<void> {
  const artifactsRoot = resolve(PERSON_A_PROVENANCE_PROJECT_ROOT, 'artifacts');
  const fromArtifacts = relative(artifactsRoot, outputDir);
  const components = fromArtifacts.split(sep);
  const paths = [
    artifactsRoot,
    ...components.map((_, index) => resolve(artifactsRoot, ...components.slice(0, index + 1))),
  ];
  for (const path of paths) {
    try {
      const status = await lstat(path);
      if (status.isSymbolicLink()) {
        throw new Error('--output-dir must not contain a symbolic link.');
      }
      if (path !== outputDir && !status.isDirectory()) {
        throw new Error('--output-dir parent components must be directories.');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
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
    '--run-manifest',
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
  if (values.has('--run-manifest')) {
    parsed.runManifest = resolve(PERSON_A_PROVENANCE_PROJECT_ROOT, values.get('--run-manifest')!);
  }

  if (mode === 'live') {
    if (!parsed.submittedAt) throw new Error('--submitted-at is required in live mode.');
    if (parsed.rawResponse || parsed.requestMetadata || parsed.runManifest) {
      throw new Error('Live mode does not accept replay artifacts.');
    }
  } else {
    if (!parsed.rawResponse || !parsed.requestMetadata || !parsed.runManifest) {
      throw new Error(
        'Replay mode requires --raw-response, --request-metadata, and --run-manifest.',
      );
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

export function explicitRepositoryBranch(branch: string): string {
  return branch || '(detached HEAD)';
}

const defaultDependencies: RunPersonAProvenanceCommandDependencies = {
  getEnvironment: (name) => process.env[name],
  now: () => new Date().toISOString(),
  repositoryState: () => ({
    sha: git(['rev-parse', 'HEAD']),
    branch: explicitRepositoryBranch(git(['branch', '--show-current'])),
    clean: git(['status', '--porcelain=v1']).length === 0,
  }),
  createClient: (apiKey, baseUrl) => new OpenAIResponsesClient(apiKey, baseUrl),
};

export async function runPersonAProvenanceCommand(
  argv: string[],
  dependencies: RunPersonAProvenanceCommandDependencies = defaultDependencies,
): Promise<void> {
  const args = parsePersonAProvenanceCommandArgs(argv);
  await assertNoSymlinkedOutputComponents(args.outputDir);
  const repository = dependencies.repositoryState();
  if (args.mode === 'replay') {
    const result = await replayPersonAProvenance({
      caseId: args.caseId,
      outputDir: args.outputDir,
      rawResponsePath: args.rawResponse!,
      requestMetadataPath: args.requestMetadata!,
      sourceManifestPath: args.runManifest!,
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
  const baseUrl = dependencies.getEnvironment('OPENAI_BASE_URL');
  const endpointIdentity = openAIResponsesEndpointIdentity(baseUrl);
  const client = dependencies.createClient(apiKey, baseUrl);
  const result = await runLivePersonAProvenance({
    caseId: args.caseId,
    outputDir: args.outputDir,
    submittedAt: args.submittedAt!,
    requestTimestamp: args.requestTimestamp ?? dependencies.now(),
    model: args.model,
    reasoningEffort: args.reasoningEffort,
    providerEndpointSha256: endpointIdentity.sha256,
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
