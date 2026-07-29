import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  alignPersonAForCase,
  type PersonAAlignment,
} from '../alignment/person-a-alignment-corrected.js';
import {
  evaluatePersonAForCase,
  type PersonAEvaluationReport,
} from '../evaluation/person-a-diff-corrected.js';
import { parsePersonAModelOutputFromRawResponse } from '../evaluation/person-a-span-diagnostics.js';
import { buildOpenAIResponseSchema } from './person-a-schema.js';
import { PERSON_A_EXTRACTION_INSTRUCTIONS, PERSON_A_PROMPT_VERSION } from './person-a-prompt.js';
import {
  decodeRawOpenAIResponse,
  parseRawOpenAIResponse,
  type RawStructuredExtractionClient,
  type RawStructuredExtractionResult,
} from './openai-responses.js';
import { assemblePersonAExtraction, PERSON_A_EXTRACTOR_VERSION } from './person-a-extractor.js';
import {
  resolvePersonAProvenanceCase,
  type PersonAProvenanceCaseDefinition,
  type PersonAProvenanceCaseId,
  type ResolvedPersonAProvenanceCase,
} from './person-a-provenance-cases.js';
import { validatePersonAExtraction } from './validate-person-a-corrected.js';

type JsonObject = Record<string, any>;

export const PERSON_A_PROVENANCE_MANIFEST_VERSION = 'person-a-provenance-run-v1';
export const PERSON_A_PROVENANCE_REQUEST_VERSION = 'person-a-provenance-request-v1';

export type PersonAProvenanceFailureStage =
  | 'provider_call'
  | 'raw_persistence'
  | 'provider_response'
  | 'response_parse'
  | 'assembly'
  | 'schema_validation'
  | 'invariant_validation'
  | 'alignment'
  | 'evaluation'
  | 'artifact_persistence';

export type PersonAProvenanceRepositoryState = {
  sha: string;
  branch: string;
  clean: boolean;
};

export type PersonAProvenanceRequestMetadata = {
  version: typeof PERSON_A_PROVENANCE_REQUEST_VERSION;
  case_id: PersonAProvenanceCaseId;
  repository: PersonAProvenanceRepositoryState;
  provider: 'openai';
  provider_endpoint_sha256: string;
  requested_model: string;
  requested_reasoning_effort: 'low' | 'medium' | 'high';
  submitted_at: string;
  request_timestamp: string;
  credential_environment_variable: 'OPENAI_API_KEY';
  generation_parameters: {
    store: false;
    temperature: null;
    maximum_output_tokens: null;
  };
  structured_output: {
    type: 'json_schema';
    name: 'juryai_person_a_extraction';
    strict: true;
  };
  narrative: {
    path: string;
    sha256: string;
  };
  golden: {
    path: string;
    sha256: string;
  };
  prompt: {
    version: string;
    sha256: string;
  };
  response_schema: {
    schema_version: '0.1.2';
    sha256: string;
  };
  extractor_version: string;
  evaluation_contract: string;
};

export type PersonAProvenanceArtifactReference = {
  path: string;
  sha256: string;
};

export type PersonAProvenanceRunManifest = {
  version: typeof PERSON_A_PROVENANCE_MANIFEST_VERSION;
  mode: 'live' | 'replay';
  status: 'initialized' | 'raw_preserved' | 'completed' | 'failed';
  case_id: PersonAProvenanceCaseId;
  repository: PersonAProvenanceRepositoryState;
  case: {
    narrative: { path: string; sha256: string };
    golden: { path: string; sha256: string };
    artifact_prefix: string;
    evaluation_contract: string;
  };
  extraction_contract: {
    schema_version: '0.1.2';
    extractor_version: string;
    prompt_version: string;
    prompt_sha256: string;
    response_schema_sha256: string;
  };
  request: {
    provider: 'openai';
    provider_endpoint_sha256: string;
    requested_model: string;
    reasoning_effort: 'low' | 'medium' | 'high';
    submitted_at: string;
    request_timestamp: string;
    credential_environment_variable: 'OPENAI_API_KEY';
    generation_parameters: PersonAProvenanceRequestMetadata['generation_parameters'];
    structured_output: PersonAProvenanceRequestMetadata['structured_output'];
  };
  provider_response: {
    http_status: number | null;
    response_id: string | null;
    served_model: string | null;
    response_status: string | null;
    usage: JsonObject | null;
  };
  replay_source: {
    run_manifest: PersonAProvenanceArtifactReference;
  } | null;
  artifacts: {
    request_metadata: PersonAProvenanceArtifactReference | null;
    raw_response: PersonAProvenanceArtifactReference | null;
    validation: PersonAProvenanceArtifactReference | null;
    extraction: PersonAProvenanceArtifactReference | null;
    alignment: PersonAProvenanceArtifactReference | null;
    evaluation: PersonAProvenanceArtifactReference | null;
    failure: PersonAProvenanceArtifactReference | null;
  };
  failure: {
    stage: PersonAProvenanceFailureStage;
    error_name: string;
    message: string;
  } | null;
  provider_call_count: 0 | 1;
  retry_count: 0;
  manually_edited: false;
  offline_reproduction_command: string;
};

export interface PersonAProvenanceArtifactWriter {
  writeNew(path: string, contents: string | Uint8Array): Promise<void>;
  writeReplace(path: string, contents: string): Promise<void>;
}

export class AtomicPersonAProvenanceArtifactWriter implements PersonAProvenanceArtifactWriter {
  async writeNew(path: string, contents: string | Uint8Array): Promise<void> {
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async writeReplace(path: string, contents: string): Promise<void> {
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
    try {
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

export type RunLivePersonAProvenanceOptions = {
  caseId: PersonAProvenanceCaseId;
  outputDir: string;
  submittedAt: string;
  requestTimestamp: string;
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high';
  providerEndpointSha256: string;
  repository: PersonAProvenanceRepositoryState;
  client: RawStructuredExtractionClient;
  projectRoot?: string;
  cases?: Readonly<Record<string, PersonAProvenanceCaseDefinition | undefined>>;
  writer?: PersonAProvenanceArtifactWriter;
};

export type ReplayPersonAProvenanceOptions = {
  caseId: PersonAProvenanceCaseId;
  outputDir: string;
  rawResponsePath: string;
  requestMetadataPath: string;
  sourceManifestPath: string;
  repository: PersonAProvenanceRepositoryState;
  projectRoot?: string;
  cases?: Readonly<Record<string, PersonAProvenanceCaseDefinition | undefined>>;
  writer?: PersonAProvenanceArtifactWriter;
};

export type PersonAProvenanceRunResult = {
  manifest: PersonAProvenanceRunManifest;
  outputDir: string;
};

type ArtifactPaths = {
  requestMetadata: string;
  rawResponse: string;
  validation: string;
  extraction: string;
  alignment: string;
  evaluation: string;
  failure: string;
  manifest: string;
};

type DerivedArtifacts = {
  validation: JsonObject;
  extraction: JsonObject;
  alignment: PersonAAlignment;
  evaluation: PersonAEvaluationReport;
};

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as JsonObject)
      .sort()
      .map((key) => [key, stableValue((value as JsonObject)[key])]),
  );
}

export function serializePersonAProvenanceJson(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

const dateTimeValidator = (() => {
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  return ajv.compile({ type: 'string', format: 'date-time' });
})();

function responseSchemaSha256(): string {
  return sha256Text(JSON.stringify(stableValue(buildOpenAIResponseSchema())));
}

function assertIsoDateTime(value: string, label: string): void {
  if (!dateTimeValidator(value)) {
    throw new Error(`${label} must be an ISO 8601 date-time.`);
  }
}

function assertRepositoryState(
  repository: PersonAProvenanceRepositoryState | undefined,
  options: { requireClean: boolean },
): asserts repository is PersonAProvenanceRepositoryState {
  if (!repository || typeof repository !== 'object') {
    throw new Error('Repository state is required.');
  }
  if (!/^[a-f0-9]{40}$/u.test(repository.sha)) {
    throw new Error('Repository SHA must be a full lowercase Git commit SHA.');
  }
  if (!repository.branch) throw new Error('Repository branch is required.');
  if (typeof repository.clean !== 'boolean') {
    throw new Error('Repository clean state must be explicit.');
  }
  if (options.requireClean && !repository.clean) {
    throw new Error('Live provenance execution requires a clean worktree.');
  }
}

function artifactPaths(outputDir: string, prefix: string): ArtifactPaths {
  return {
    requestMetadata: resolve(outputDir, `${prefix}.request.json`),
    rawResponse: resolve(outputDir, `${prefix}.raw-response.json`),
    validation: resolve(outputDir, `${prefix}.validation.json`),
    extraction: resolve(outputDir, `${prefix}.extraction.json`),
    alignment: resolve(outputDir, `${prefix}.alignment.json`),
    evaluation: resolve(outputDir, `${prefix}.evaluation.json`),
    failure: resolve(outputDir, `${prefix}.failure.json`),
    manifest: resolve(outputDir, `${prefix}.run-manifest.json`),
  };
}

async function prepareOutputDirectory(outputDir: string): Promise<string> {
  const absolute = resolve(outputDir);
  await mkdir(dirname(absolute), { recursive: true });
  await mkdir(absolute);
  return absolute;
}

function artifactReference(
  path: string,
  contents: string | Uint8Array,
): PersonAProvenanceArtifactReference {
  return {
    path: basename(path),
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function reproductionCommand(
  caseId: PersonAProvenanceCaseId,
  inputs: {
    rawResponse: string;
    requestMetadata: string;
    runManifest: string;
  },
  outputDir: string,
): string {
  return [
    'npm run provenance:person-a -- --mode replay',
    `--case-id ${caseId}`,
    `--raw-response ${shellQuote(inputs.rawResponse)}`,
    `--request-metadata ${shellQuote(inputs.requestMetadata)}`,
    `--run-manifest ${shellQuote(inputs.runManifest)}`,
    `--output-dir ${shellQuote(`${outputDir}-replay`)}`,
  ].join(' ');
}

function createRequestMetadata(
  resolvedCase: ResolvedPersonAProvenanceCase,
  options: {
    repository: PersonAProvenanceRepositoryState;
    model: string;
    reasoningEffort: 'low' | 'medium' | 'high';
    providerEndpointSha256: string;
    submittedAt: string;
    requestTimestamp: string;
  },
): PersonAProvenanceRequestMetadata {
  return {
    version: PERSON_A_PROVENANCE_REQUEST_VERSION,
    case_id: resolvedCase.caseId,
    repository: options.repository,
    provider: 'openai',
    provider_endpoint_sha256: options.providerEndpointSha256,
    requested_model: options.model,
    requested_reasoning_effort: options.reasoningEffort,
    submitted_at: options.submittedAt,
    request_timestamp: options.requestTimestamp,
    credential_environment_variable: 'OPENAI_API_KEY',
    generation_parameters: {
      store: false,
      temperature: null,
      maximum_output_tokens: null,
    },
    structured_output: {
      type: 'json_schema',
      name: 'juryai_person_a_extraction',
      strict: true,
    },
    narrative: {
      path: resolvedCase.narrativePath,
      sha256: resolvedCase.narrativeSha256,
    },
    golden: {
      path: resolvedCase.goldenPath,
      sha256: resolvedCase.goldenSha256,
    },
    prompt: {
      version: PERSON_A_PROMPT_VERSION,
      sha256: sha256Text(PERSON_A_EXTRACTION_INSTRUCTIONS),
    },
    response_schema: {
      schema_version: '0.1.2',
      sha256: responseSchemaSha256(),
    },
    extractor_version: PERSON_A_EXTRACTOR_VERSION,
    evaluation_contract: resolvedCase.evaluationContract,
  };
}

function createManifest(
  mode: 'live' | 'replay',
  resolvedCase: ResolvedPersonAProvenanceCase,
  metadata: PersonAProvenanceRequestMetadata,
  paths: ArtifactPaths,
  outputDir: string,
  repository: PersonAProvenanceRepositoryState,
  replayInputs?: {
    rawResponse: string;
    requestMetadata: string;
    runManifest: string;
  },
): PersonAProvenanceRunManifest {
  return {
    version: PERSON_A_PROVENANCE_MANIFEST_VERSION,
    mode,
    status: 'initialized',
    case_id: resolvedCase.caseId,
    repository,
    case: {
      narrative: {
        path: resolvedCase.narrativePath,
        sha256: resolvedCase.narrativeSha256,
      },
      golden: {
        path: resolvedCase.goldenPath,
        sha256: resolvedCase.goldenSha256,
      },
      artifact_prefix: resolvedCase.artifactPrefix,
      evaluation_contract: resolvedCase.evaluationContract,
    },
    extraction_contract: {
      schema_version: '0.1.2',
      extractor_version: PERSON_A_EXTRACTOR_VERSION,
      prompt_version: PERSON_A_PROMPT_VERSION,
      prompt_sha256: metadata.prompt.sha256,
      response_schema_sha256: metadata.response_schema.sha256,
    },
    request: {
      provider: 'openai',
      provider_endpoint_sha256: metadata.provider_endpoint_sha256,
      requested_model: metadata.requested_model,
      reasoning_effort: metadata.requested_reasoning_effort,
      submitted_at: metadata.submitted_at,
      request_timestamp: metadata.request_timestamp,
      credential_environment_variable: 'OPENAI_API_KEY',
      generation_parameters: metadata.generation_parameters,
      structured_output: metadata.structured_output,
    },
    provider_response: {
      http_status: null,
      response_id: null,
      served_model: null,
      response_status: null,
      usage: null,
    },
    replay_source: null,
    artifacts: {
      request_metadata: null,
      raw_response: null,
      validation: null,
      extraction: null,
      alignment: null,
      evaluation: null,
      failure: null,
    },
    failure: null,
    provider_call_count: 0,
    retry_count: 0,
    manually_edited: false,
    offline_reproduction_command: reproductionCommand(
      resolvedCase.caseId,
      replayInputs ?? {
        rawResponse: paths.rawResponse,
        requestMetadata: paths.requestMetadata,
        runManifest: paths.manifest,
      },
      outputDir,
    ),
  };
}

function assertRequestMetadata(
  value: unknown,
  resolvedCase: ResolvedPersonAProvenanceCase,
): asserts value is PersonAProvenanceRequestMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request metadata must be a JSON object.');
  }
  const metadata = value as Partial<PersonAProvenanceRequestMetadata>;
  if (metadata.version !== PERSON_A_PROVENANCE_REQUEST_VERSION) {
    throw new Error('Unsupported Person A provenance request metadata version.');
  }
  if (metadata.case_id !== resolvedCase.caseId) {
    throw new Error('Request metadata case does not match the selected case.');
  }
  if (
    metadata.narrative?.path !== resolvedCase.narrativePath ||
    metadata.narrative.sha256 !== resolvedCase.narrativeSha256
  ) {
    throw new Error('Request metadata narrative identity does not match the selected case.');
  }
  if (
    metadata.golden?.path !== resolvedCase.goldenPath ||
    metadata.golden.sha256 !== resolvedCase.goldenSha256
  ) {
    throw new Error('Request metadata golden identity does not match the selected case.');
  }
  if (
    metadata.prompt?.version !== PERSON_A_PROMPT_VERSION ||
    metadata.prompt.sha256 !== sha256Text(PERSON_A_EXTRACTION_INSTRUCTIONS)
  ) {
    throw new Error('Request metadata prompt identity does not match the current extractor.');
  }
  if (
    metadata.response_schema?.schema_version !== '0.1.2' ||
    metadata.response_schema.sha256 !== responseSchemaSha256()
  ) {
    throw new Error('Request metadata response schema identity does not match the current schema.');
  }
  if (
    metadata.extractor_version !== PERSON_A_EXTRACTOR_VERSION ||
    metadata.evaluation_contract !== resolvedCase.evaluationContract
  ) {
    throw new Error('Request metadata extraction contract does not match the selected case.');
  }
  if (
    typeof metadata.requested_model !== 'string' ||
    !['low', 'medium', 'high'].includes(String(metadata.requested_reasoning_effort))
  ) {
    throw new Error('Request metadata model configuration is incomplete.');
  }
  if (
    metadata.provider !== 'openai' ||
    !/^[a-f0-9]{64}$/u.test(String(metadata.provider_endpoint_sha256)) ||
    metadata.credential_environment_variable !== 'OPENAI_API_KEY' ||
    metadata.generation_parameters?.store !== false ||
    metadata.generation_parameters.temperature !== null ||
    metadata.generation_parameters.maximum_output_tokens !== null
  ) {
    throw new Error('Request metadata provider configuration does not match the harness.');
  }
  if (
    metadata.structured_output?.type !== 'json_schema' ||
    metadata.structured_output.name !== 'juryai_person_a_extraction' ||
    metadata.structured_output.strict !== true
  ) {
    throw new Error('Request metadata structured-output configuration does not match the harness.');
  }
  assertRepositoryState(metadata.repository, { requireClean: false });
  assertIsoDateTime(String(metadata.submitted_at), 'Request metadata submitted_at');
  assertIsoDateTime(String(metadata.request_timestamp), 'Request metadata request_timestamp');
}

function assertSourceManifest(
  value: unknown,
  path: string,
  resolvedCase: ResolvedPersonAProvenanceCase,
  metadata: PersonAProvenanceRequestMetadata,
  rawBody: Uint8Array,
  rawResponsePath: string,
  metadataBody: string,
  requestMetadataPath: string,
): asserts value is PersonAProvenanceRunManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Source run manifest must be a JSON object.');
  }
  const source = value as Partial<PersonAProvenanceRunManifest>;
  if (source.version !== PERSON_A_PROVENANCE_MANIFEST_VERSION || source.mode !== 'live') {
    throw new Error('Replay requires a supported live source run manifest.');
  }
  if (!['raw_preserved', 'completed', 'failed'].includes(String(source.status))) {
    throw new Error('Source run manifest has not preserved a replayable raw response.');
  }
  const sourceHttpStatus = source.provider_response?.http_status;
  if (
    typeof sourceHttpStatus !== 'number' ||
    !Number.isInteger(sourceHttpStatus) ||
    sourceHttpStatus < 200 ||
    sourceHttpStatus >= 300
  ) {
    throw new Error('Replay requires a source run with a successful provider HTTP status.');
  }
  const expected = createManifest(
    'live',
    resolvedCase,
    metadata,
    artifactPaths(dirname(path), resolvedCase.artifactPrefix),
    dirname(path),
    metadata.repository,
  );
  for (const key of ['repository', 'case', 'extraction_contract', 'request'] as const) {
    if (JSON.stringify(stableValue(source[key])) !== JSON.stringify(stableValue(expected[key]))) {
      throw new Error(`Source run manifest ${key} does not match its request metadata.`);
    }
  }
  if (
    source.case_id !== resolvedCase.caseId ||
    source.manually_edited !== false ||
    source.provider_call_count !== 1 ||
    source.retry_count !== 0
  ) {
    throw new Error('Source run manifest execution identity is not replayable.');
  }
  const requestReference = source.artifacts?.request_metadata;
  const rawReference = source.artifacts?.raw_response;
  if (
    !requestReference ||
    requestReference.path !== basename(requestMetadataPath) ||
    requestReference.sha256 !== sha256Text(metadataBody)
  ) {
    throw new Error('Source run manifest does not bind the supplied request metadata.');
  }
  if (
    !rawReference ||
    rawReference.path !== basename(rawResponsePath) ||
    rawReference.sha256 !== createHash('sha256').update(rawBody).digest('hex')
  ) {
    throw new Error('Source run manifest does not bind the supplied raw response.');
  }
}

async function writeManifest(
  writer: PersonAProvenanceArtifactWriter,
  path: string,
  manifest: PersonAProvenanceRunManifest,
): Promise<void> {
  await writer.writeReplace(path, serializePersonAProvenanceJson(manifest));
}

async function recordFailure(options: {
  writer: PersonAProvenanceArtifactWriter;
  paths: ArtifactPaths;
  manifest: PersonAProvenanceRunManifest;
  stage: PersonAProvenanceFailureStage;
  error: unknown;
}): Promise<void> {
  const errorName = options.error instanceof Error ? options.error.name : 'Error';
  const failure = {
    version: 'person-a-provenance-failure-v1',
    case_id: options.manifest.case_id,
    stage: options.stage,
    error_name: errorName,
    message: `Person A provenance run failed during ${options.stage}.`,
    request_timestamp: options.manifest.request.request_timestamp,
  };
  const contents = serializePersonAProvenanceJson(failure);
  await options.writer.writeNew(options.paths.failure, contents);
  options.manifest.artifacts.failure = artifactReference(options.paths.failure, contents);
  options.manifest.status = 'failed';
  options.manifest.failure = {
    stage: options.stage,
    error_name: errorName,
    message: failure.message,
  };
  await writeManifest(options.writer, options.paths.manifest, options.manifest);
}

function providerMetadata(
  rawResponse: JsonObject,
  rawResult?: RawStructuredExtractionResult,
): PersonAProvenanceRunManifest['provider_response'] {
  return {
    http_status: rawResult?.status ?? null,
    response_id: typeof rawResponse.id === 'string' ? rawResponse.id : null,
    served_model: typeof rawResponse.model === 'string' ? rawResponse.model : null,
    response_status: typeof rawResponse.status === 'string' ? rawResponse.status : null,
    usage:
      rawResponse.usage && typeof rawResponse.usage === 'object'
        ? (structuredClone(rawResponse.usage) as JsonObject)
        : null,
  };
}

function deriveArtifacts(
  rawBody: Uint8Array,
  resolvedCase: ResolvedPersonAProvenanceCase,
  metadata: PersonAProvenanceRequestMetadata,
  onStage: (stage: PersonAProvenanceFailureStage) => void,
): DerivedArtifacts {
  onStage('response_parse');
  const rawResponse = parseRawOpenAIResponse(decodeRawOpenAIResponse(rawBody));
  const modelOutput = parsePersonAModelOutputFromRawResponse(rawResponse);

  onStage('assembly');
  const extraction = assemblePersonAExtraction(modelOutput, {
    narrative: resolvedCase.narrative,
    submittedAt: metadata.submitted_at,
    model: metadata.requested_model,
    generatedAt: metadata.request_timestamp,
  });

  const validationResult = validatePersonAExtraction(extraction, resolvedCase.narrative);
  onStage('schema_validation');
  if (validationResult.schemaErrors.length > 0) {
    throw new Error('Assembled extraction failed schema validation.');
  }
  onStage('invariant_validation');
  if (validationResult.invariantErrors.length > 0) {
    throw new Error('Assembled extraction failed invariant validation.');
  }
  const validation = {
    schema_valid: true,
    invariants_valid: true,
    schema_errors: [],
    invariant_errors: [],
  };

  onStage('alignment');
  const alignment = alignPersonAForCase(extraction, resolvedCase.golden, {
    aliases: resolvedCase.aliases,
    contractVersion: resolvedCase.evaluationContract,
  });
  onStage('evaluation');
  const evaluation = evaluatePersonAForCase(extraction, resolvedCase.golden, alignment, {
    aliases: resolvedCase.aliases,
    narrative: resolvedCase.narrative,
    contractVersion: resolvedCase.evaluationContract,
  });
  return { validation, extraction, alignment, evaluation };
}

async function persistDerivedArtifacts(options: {
  writer: PersonAProvenanceArtifactWriter;
  paths: ArtifactPaths;
  manifest: PersonAProvenanceRunManifest;
  derived: DerivedArtifacts;
}): Promise<void> {
  const outputs = [
    ['validation', options.paths.validation, options.derived.validation],
    ['extraction', options.paths.extraction, options.derived.extraction],
    ['alignment', options.paths.alignment, options.derived.alignment],
    ['evaluation', options.paths.evaluation, options.derived.evaluation],
  ] as const;
  for (const [key, path, value] of outputs) {
    const contents = serializePersonAProvenanceJson(value);
    await options.writer.writeNew(path, contents);
    options.manifest.artifacts[key] = artifactReference(path, contents);
  }
}

export async function runLivePersonAProvenance(
  options: RunLivePersonAProvenanceOptions,
): Promise<PersonAProvenanceRunResult> {
  assertRepositoryState(options.repository, { requireClean: true });
  assertIsoDateTime(options.submittedAt, 'submittedAt');
  assertIsoDateTime(options.requestTimestamp, 'requestTimestamp');
  if (!options.model) throw new Error('model is required.');
  if (!/^[a-f0-9]{64}$/u.test(options.providerEndpointSha256)) {
    throw new Error('providerEndpointSha256 must be a lowercase SHA-256 identity.');
  }
  const resolvedCase = await resolvePersonAProvenanceCase(options.caseId, {
    projectRoot: options.projectRoot,
    cases: options.cases,
  });
  const outputDir = await prepareOutputDirectory(options.outputDir);
  const paths = artifactPaths(outputDir, resolvedCase.artifactPrefix);
  const writer = options.writer ?? new AtomicPersonAProvenanceArtifactWriter();
  const metadata = createRequestMetadata(resolvedCase, {
    repository: options.repository,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    providerEndpointSha256: options.providerEndpointSha256,
    submittedAt: options.submittedAt,
    requestTimestamp: options.requestTimestamp,
  });
  const manifest = createManifest(
    'live',
    resolvedCase,
    metadata,
    paths,
    outputDir,
    options.repository,
  );
  const metadataContents = serializePersonAProvenanceJson(metadata);
  await writer.writeNew(paths.requestMetadata, metadataContents);
  manifest.artifacts.request_metadata = artifactReference(paths.requestMetadata, metadataContents);
  await writeManifest(writer, paths.manifest, manifest);

  let stage: PersonAProvenanceFailureStage = 'provider_call';
  try {
    manifest.provider_call_count = 1;
    const rawResult = await options.client.requestRaw({
      narrative: resolvedCase.narrative,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
    });

    stage = 'raw_persistence';
    await writer.writeNew(paths.rawResponse, rawResult.body);
    manifest.artifacts.raw_response = artifactReference(paths.rawResponse, rawResult.body);
    manifest.provider_response = providerMetadata({}, rawResult);
    manifest.status = 'raw_preserved';
    await writeManifest(writer, paths.manifest, manifest);

    stage = 'response_parse';
    const rawResponse = parseRawOpenAIResponse(decodeRawOpenAIResponse(rawResult.body));
    manifest.provider_response = providerMetadata(rawResponse, rawResult);
    await writeManifest(writer, paths.manifest, manifest);
    stage = 'provider_response';
    if (!rawResult.ok) throw new Error(`Provider returned HTTP ${rawResult.status}.`);

    const derived = deriveArtifacts(rawResult.body, resolvedCase, metadata, (next) => {
      stage = next;
    });
    stage = 'artifact_persistence';
    await persistDerivedArtifacts({ writer, paths, manifest, derived });
    manifest.status = 'completed';
    await writeManifest(writer, paths.manifest, manifest);
    return { manifest, outputDir };
  } catch (error) {
    await recordFailure({ writer, paths, manifest, stage, error }).catch(() => undefined);
    throw error;
  }
}

export async function replayPersonAProvenance(
  options: ReplayPersonAProvenanceOptions,
): Promise<PersonAProvenanceRunResult> {
  assertRepositoryState(options.repository, { requireClean: false });
  const resolvedCase = await resolvePersonAProvenanceCase(options.caseId, {
    projectRoot: options.projectRoot,
    cases: options.cases,
  });
  const [rawBody, metadataBody, sourceManifestBody] = await Promise.all([
    readFile(resolve(options.rawResponsePath)),
    readFile(resolve(options.requestMetadataPath), 'utf8'),
    readFile(resolve(options.sourceManifestPath), 'utf8'),
  ]);
  const parsedMetadata = JSON.parse(metadataBody) as unknown;
  assertRequestMetadata(parsedMetadata, resolvedCase);
  const metadata = parsedMetadata;
  if (metadata.repository.sha !== options.repository.sha) {
    throw new Error(
      `Replay repository SHA ${options.repository.sha} does not match frozen request SHA ${metadata.repository.sha}.`,
    );
  }
  const parsedSourceManifest = JSON.parse(sourceManifestBody) as unknown;
  assertSourceManifest(
    parsedSourceManifest,
    resolve(options.sourceManifestPath),
    resolvedCase,
    metadata,
    rawBody,
    resolve(options.rawResponsePath),
    metadataBody,
    resolve(options.requestMetadataPath),
  );
  const outputDir = await prepareOutputDirectory(options.outputDir);
  const paths = artifactPaths(outputDir, resolvedCase.artifactPrefix);
  const writer = options.writer ?? new AtomicPersonAProvenanceArtifactWriter();
  const manifest = createManifest(
    'replay',
    resolvedCase,
    metadata,
    paths,
    outputDir,
    options.repository,
    {
      rawResponse: resolve(options.rawResponsePath),
      requestMetadata: resolve(options.requestMetadataPath),
      runManifest: resolve(options.sourceManifestPath),
    },
  );
  manifest.replay_source = {
    run_manifest: artifactReference(resolve(options.sourceManifestPath), sourceManifestBody),
  };
  await writer.writeNew(paths.requestMetadata, metadataBody);
  manifest.artifacts.request_metadata = artifactReference(paths.requestMetadata, metadataBody);
  await writer.writeNew(paths.rawResponse, rawBody);
  manifest.artifacts.raw_response = artifactReference(paths.rawResponse, rawBody);
  manifest.status = 'raw_preserved';
  await writeManifest(writer, paths.manifest, manifest);

  let stage: PersonAProvenanceFailureStage = 'response_parse';
  try {
    const rawResponse = parseRawOpenAIResponse(decodeRawOpenAIResponse(rawBody));
    manifest.provider_response = providerMetadata(rawResponse);
    const derived = deriveArtifacts(rawBody, resolvedCase, metadata, (next) => {
      stage = next;
    });
    stage = 'artifact_persistence';
    await persistDerivedArtifacts({ writer, paths, manifest, derived });
    manifest.status = 'completed';
    await writeManifest(writer, paths.manifest, manifest);
    return { manifest, outputDir };
  } catch (error) {
    await recordFailure({ writer, paths, manifest, stage, error }).catch(() => undefined);
    throw error;
  }
}
