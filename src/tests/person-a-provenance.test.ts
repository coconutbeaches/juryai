import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';
import {
  AtomicPersonAProvenanceArtifactWriter,
  replayPersonAProvenance,
  runLivePersonAProvenance,
  type PersonAProvenanceArtifactWriter,
  type PersonAProvenanceRepositoryState,
} from '../extraction/person-a-provenance.js';
import {
  PERSON_A_PROVENANCE_CASES,
  PERSON_A_PROVENANCE_PROJECT_ROOT,
  resolvePersonAProvenanceCase,
  type PersonAProvenanceCaseDefinition,
  type PersonAProvenanceCaseId,
} from '../extraction/person-a-provenance-cases.js';
import type {
  RawStructuredExtractionClient,
  RawStructuredExtractionResult,
} from '../extraction/openai-responses.js';
import {
  runExtractPersonACommand,
  type ExtractPersonACommandDependencies,
} from '../commands/extract-person-a.js';
import {
  parsePersonAProvenanceCommandArgs,
  runPersonAProvenanceCommand,
  type RunPersonAProvenanceCommandDependencies,
} from '../commands/run-person-a-provenance.js';

type JsonObject = Record<string, any>;

const repository: PersonAProvenanceRepositoryState = {
  sha: '1e083051a948bf285b59adcc6d4a5a555a031ebd',
  branch: 'codex/dry-run-002-provenance-harness',
  clean: true,
};
const submittedAt = '2026-01-01T00:00:00Z';
const requestTimestamp = '2026-07-29T05:00:00.000Z';
const cleanupDirectories: string[] = [];

async function temporaryDirectory(label: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), `juryai-${label}-`));
  cleanupDirectories.push(root);
  return resolve(root, 'run');
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    cleanupDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function modelOutputFromExtraction(extraction: JsonObject): JsonObject {
  return {
    schema_version: '0.1.2',
    party_profile: {
      display_name: extraction.party.display_name,
      country: extraction.party.country,
      language: extraction.party.language,
    },
    third_parties: structuredClone(extraction.third_parties),
    agreement: structuredClone(extraction.agreement),
    deliverable_assessments: structuredClone(extraction.deliverable_assessments),
    timeline: structuredClone(extraction.timeline),
    claims: structuredClone(extraction.claims),
    evidence: structuredClone(extraction.evidence),
    claim_evidence_links: structuredClone(extraction.claim_evidence_links),
    damages_claims: structuredClone(extraction.damages_claims),
    desired_outcomes: structuredClone(extraction.desired_outcomes),
    extraction_issues: structuredClone(extraction.extraction_issues),
    clarification_questions: structuredClone(extraction.clarification_questions),
  };
}

async function successfulRawBody(caseId: PersonAProvenanceCaseId): Promise<string> {
  const selected = await resolvePersonAProvenanceCase(caseId);
  return JSON.stringify({
    id: `resp_fake_${caseId}`,
    model: 'gpt-5.6',
    status: 'completed',
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      total_tokens: 300,
    },
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify(modelOutputFromExtraction(selected.golden)),
          },
        ],
      },
    ],
  });
}

class FakeRawClient implements RawStructuredExtractionClient {
  calls = 0;

  constructor(private readonly result: RawStructuredExtractionResult | Error) {}

  async requestRaw(): Promise<RawStructuredExtractionResult> {
    this.calls += 1;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

function clientForBody(body: string): FakeRawClient {
  return new FakeRawClient({ status: 200, ok: true, body });
}

async function runLive(
  label: string,
  client: RawStructuredExtractionClient,
  overrides: Partial<Parameters<typeof runLivePersonAProvenance>[0]> = {},
) {
  const outputDir = await temporaryDirectory(label);
  return runLivePersonAProvenance({
    caseId: 'dry_run_002',
    outputDir,
    submittedAt,
    requestTimestamp,
    model: 'gpt-5.6',
    reasoningEffort: 'medium',
    repository,
    client,
    ...overrides,
  });
}

async function json(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, 'utf8')) as JsonObject;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function artifactPath(outputDir: string, suffix: string): string {
  return resolve(outputDir, `dry_run_002.person_a.${suffix}.json`);
}

async function allFileContents(directory: string): Promise<string> {
  const files = await readdir(directory);
  return (await Promise.all(files.map((file) => readFile(resolve(directory, file), 'utf8')))).join(
    '\n',
  );
}

describe('Person A provenance case resolution', () => {
  it('resolves Dry Run 002 to its exact narrative, golden, aliases, and identities', async () => {
    const selected = await resolvePersonAProvenanceCase('dry_run_002');
    expect(selected).toMatchObject({
      narrativePath: 'src/fixtures/dry_run_002.person_a.txt',
      narrativeSha256: '0508bdb60323a32beafaa0b7e7e7ac734cd64a002830fc8eb1ca52e5feda0f86',
      goldenPath: 'src/fixtures/dry_run_002.person_a.golden.extraction.json',
      goldenSha256: '67c85bc005b377a064d1bd18c59570dff50cdc10ae9ac9480331da41a934165c',
      aliases: { client: 'priya', restorer: 'jordan' },
      evaluationContract: 'calibrated_live_v2',
      artifactPrefix: 'dry_run_002.person_a',
    });
    expect(selected.golden.submission.raw_text).toBe(selected.narrative);
  });

  it('keeps Dry Run 001 golden behavior exact', async () => {
    const selected = await resolvePersonAProvenanceCase('dry_run_001');
    expect(selected.golden).toEqual(buildPersonAGoldenProjection());
  });

  it('fails an unknown case before provider invocation', async () => {
    const client = clientForBody(await successfulRawBody('dry_run_002'));
    await expect(
      runLive('unknown-case', client, { caseId: 'unknown' as PersonAProvenanceCaseId }),
    ).rejects.toThrow(/unknown.*case/i);
    expect(client.calls).toBe(0);
  });

  it('fails incomplete case metadata before provider invocation', async () => {
    const client = clientForBody(await successfulRawBody('dry_run_002'));
    const incomplete = {
      ...PERSON_A_PROVENANCE_CASES.dry_run_002,
      goldenSha256: '',
    } as PersonAProvenanceCaseDefinition;
    await expect(
      runLive('incomplete-case', client, {
        cases: { dry_run_002: incomplete },
      }),
    ).rejects.toThrow(/missing goldenSha256/i);
    expect(client.calls).toBe(0);
  });

  it('fails missing semantic calibration before provider invocation', async () => {
    const client = clientForBody(await successfulRawBody('dry_run_002'));
    const incomplete = {
      ...PERSON_A_PROVENANCE_CASES.dry_run_002,
      aliases: undefined,
    } as unknown as PersonAProvenanceCaseDefinition;
    await expect(
      runLive('incomplete-aliases', client, {
        cases: { dry_run_002: incomplete },
      }),
    ).rejects.toThrow(/missing aliases/i);
    expect(client.calls).toBe(0);
  });

  it('blocks the legacy command from evaluating Dry Run 002 against Dry Run 001', async () => {
    const calls: string[] = [];
    const dependencies: ExtractPersonACommandDependencies = {
      getEnvironment(name) {
        calls.push(`environment:${name}`);
        return undefined;
      },
      createClient() {
        calls.push('client');
        throw new Error('must not create a provider client');
      },
      async extract() {
        calls.push('extract');
        throw new Error('must not invoke extraction');
      },
    };
    await expect(
      runExtractPersonACommand(
        [
          '--input',
          'src/fixtures/dry_run_002.person_a.txt',
          '--output-dir',
          'artifacts/legacy-dry-run-002',
        ],
        dependencies,
      ),
    ).rejects.toThrow(/must use npm run provenance:person-a/i);
    expect(calls).toEqual([]);
  });

  it('blocks an identical Dry Run 002 copy in the legacy command', async () => {
    const selected = await resolvePersonAProvenanceCase('dry_run_002');
    const copiedRoot = await mkdtemp(resolve(tmpdir(), 'juryai-dry-run-002-copy-'));
    cleanupDirectories.push(copiedRoot);
    const copiedNarrative = resolve(copiedRoot, 'renamed-input.txt');
    await writeFile(copiedNarrative, selected.narrative);
    const calls: string[] = [];
    const dependencies: ExtractPersonACommandDependencies = {
      getEnvironment(name) {
        calls.push(`environment:${name}`);
        return undefined;
      },
      createClient() {
        calls.push('client');
        throw new Error('must not create a provider client');
      },
      async extract() {
        calls.push('extract');
        throw new Error('must not invoke extraction');
      },
    };

    await expect(
      runExtractPersonACommand(
        ['--input', copiedNarrative, '--output-dir', resolve(copiedRoot, 'legacy-output')],
        dependencies,
      ),
    ).rejects.toThrow(/must use npm run provenance:person-a/i);
    expect(calls).toEqual([]);
  });

  it('blocks a symlink to Dry Run 002 in the legacy command', async () => {
    const selected = await resolvePersonAProvenanceCase('dry_run_002');
    const linkedRoot = await mkdtemp(resolve(tmpdir(), 'juryai-dry-run-002-link-'));
    cleanupDirectories.push(linkedRoot);
    const linkedNarrative = resolve(linkedRoot, 'renamed-input.txt');
    await symlink(selected.narrativeAbsolutePath, linkedNarrative);
    const calls: string[] = [];
    const dependencies: ExtractPersonACommandDependencies = {
      getEnvironment(name) {
        calls.push(`environment:${name}`);
        return undefined;
      },
      createClient() {
        calls.push('client');
        throw new Error('must not create a provider client');
      },
      async extract() {
        calls.push('extract');
        throw new Error('must not invoke extraction');
      },
    };

    await expect(
      runExtractPersonACommand(
        ['--input', linkedNarrative, '--output-dir', resolve(linkedRoot, 'legacy-output')],
        dependencies,
      ),
    ).rejects.toThrow(/must use npm run provenance:person-a/i);
    expect(calls).toEqual([]);
  });

  it('requires live repository provenance to be clean before provider invocation', async () => {
    const client = clientForBody(await successfulRawBody('dry_run_002'));
    await expect(
      runLive('dirty-repository', client, {
        repository: { ...repository, clean: false },
      }),
    ).rejects.toThrow(/clean worktree/i);
    expect(client.calls).toBe(0);
  });

  it('constrains CLI output directories to the ignored artifacts tree', () => {
    expect(() =>
      parsePersonAProvenanceCommandArgs([
        '--mode',
        'live',
        '--case-id',
        'dry_run_002',
        '--submitted-at',
        submittedAt,
        '--output-dir',
        'src/fixtures/new-run',
      ]),
    ).toThrow(/below artifacts/i);
    expect(
      parsePersonAProvenanceCommandArgs([
        '--mode',
        'live',
        '--case-id',
        'dry_run_002',
        '--submitted-at',
        submittedAt,
        '--output-dir',
        'artifacts/person-a/dry-run-002-live',
      ]).outputDir,
    ).toContain('/artifacts/person-a/dry-run-002-live');
  });

  it('rejects symlinked output components before credentials or provider setup', async () => {
    const artifactsRoot = resolve(PERSON_A_PROVENANCE_PROJECT_ROOT, 'artifacts');
    await mkdir(artifactsRoot, { recursive: true });
    const linkedRoot = await mkdtemp(resolve(artifactsRoot, 'provenance-output-link-'));
    const outsideRoot = await mkdtemp(resolve(tmpdir(), 'juryai-provenance-output-outside-'));
    cleanupDirectories.push(linkedRoot, outsideRoot);
    await symlink(outsideRoot, resolve(linkedRoot, 'escape'));
    const calls: string[] = [];
    const dependencies: RunPersonAProvenanceCommandDependencies = {
      getEnvironment(name) {
        calls.push(`environment:${name}`);
        return undefined;
      },
      now() {
        calls.push('now');
        return requestTimestamp;
      },
      repositoryState() {
        calls.push('repository');
        return repository;
      },
      createClient() {
        calls.push('client');
        throw new Error('must not create a provider client');
      },
    };

    await expect(
      runPersonAProvenanceCommand(
        [
          '--mode',
          'live',
          '--case-id',
          'dry_run_002',
          '--submitted-at',
          submittedAt,
          '--output-dir',
          resolve(linkedRoot, 'escape', 'run'),
        ],
        dependencies,
      ),
    ).rejects.toThrow(/symbolic link/i);
    expect(calls).toEqual([]);
  });
});

describe('Person A provenance raw-first and call-count guarantees', () => {
  it('persists the untouched raw response before structured parsing', async () => {
    const body = '{"not valid after this point":';
    const client = clientForBody(body);
    const outputDir = await temporaryDirectory('invalid-json');
    await expect(
      runLivePersonAProvenance({
        caseId: 'dry_run_002',
        outputDir,
        submittedAt,
        requestTimestamp,
        model: 'gpt-5.6',
        reasoningEffort: 'medium',
        repository,
        client,
      }),
    ).rejects.toThrow(/not valid JSON/i);
    expect(await readFile(artifactPath(outputDir, 'raw-response'), 'utf8')).toBe(body);
    const manifest = await json(artifactPath(outputDir, 'run-manifest'));
    expect(manifest).toMatchObject({
      status: 'failed',
      provider_call_count: 1,
      retry_count: 0,
      failure: { stage: 'response_parse' },
      artifacts: {
        raw_response: {
          path: 'dry_run_002.person_a.raw-response.json',
        },
      },
    });
    expect(client.calls).toBe(1);
  });

  it('records a known HTTP status when a provider error body is not JSON', async () => {
    const body = '<html>Bad gateway</html>';
    const client = new FakeRawClient({ status: 502, ok: false, body });
    const outputDir = await temporaryDirectory('non-json-http-failure');
    await expect(
      runLivePersonAProvenance({
        caseId: 'dry_run_002',
        outputDir,
        submittedAt,
        requestTimestamp,
        model: 'gpt-5.6',
        reasoningEffort: 'medium',
        repository,
        client,
      }),
    ).rejects.toThrow(/not valid JSON/i);
    expect(await readFile(artifactPath(outputDir, 'raw-response'), 'utf8')).toBe(body);
    expect(await json(artifactPath(outputDir, 'run-manifest'))).toMatchObject({
      status: 'failed',
      provider_response: { http_status: 502 },
      failure: { stage: 'response_parse' },
      provider_call_count: 1,
      retry_count: 0,
    });
    expect(client.calls).toBe(1);
  });

  it('keeps raw evidence when assembly fails and never retries', async () => {
    const body = JSON.stringify({
      id: 'resp_assembly_failure',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: '{}' }],
        },
      ],
    });
    const client = clientForBody(body);
    const outputDir = await temporaryDirectory('assembly-failure');
    await expect(
      runLivePersonAProvenance({
        caseId: 'dry_run_002',
        outputDir,
        submittedAt,
        requestTimestamp,
        model: 'gpt-5.6',
        reasoningEffort: 'medium',
        repository,
        client,
      }),
    ).rejects.toThrow();
    expect(await readFile(artifactPath(outputDir, 'raw-response'), 'utf8')).toBe(body);
    expect(await json(artifactPath(outputDir, 'run-manifest'))).toMatchObject({
      status: 'failed',
      provider_call_count: 1,
      retry_count: 0,
      failure: { stage: 'assembly' },
    });
    expect(client.calls).toBe(1);
  });

  it('preserves a non-success provider body before failing without retry', async () => {
    const body = JSON.stringify({
      error: { type: 'invalid_request_error', message: 'Synthetic provider failure.' },
    });
    const client = new FakeRawClient({ status: 400, ok: false, body });
    const outputDir = await temporaryDirectory('provider-http-failure');
    await expect(
      runLivePersonAProvenance({
        caseId: 'dry_run_002',
        outputDir,
        submittedAt,
        requestTimestamp,
        model: 'gpt-5.6',
        reasoningEffort: 'medium',
        repository,
        client,
      }),
    ).rejects.toThrow(/HTTP 400/i);
    expect(await readFile(artifactPath(outputDir, 'raw-response'), 'utf8')).toBe(body);
    expect(await json(artifactPath(outputDir, 'run-manifest'))).toMatchObject({
      status: 'failed',
      provider_response: { http_status: 400 },
      failure: { stage: 'provider_response' },
      provider_call_count: 1,
      retry_count: 0,
    });
    expect(client.calls).toBe(1);
  });

  it('stops before parsing when atomic raw persistence fails', async () => {
    const body = await successfulRawBody('dry_run_002');
    const client = clientForBody(body);
    const delegate = new AtomicPersonAProvenanceArtifactWriter();
    const writes: string[] = [];
    const writer: PersonAProvenanceArtifactWriter = {
      async writeNew(path, contents) {
        writes.push(path);
        if (path.endsWith('.raw-response.json')) throw new Error('simulated raw write failure');
        await delegate.writeNew(path, contents);
      },
      writeReplace: (path, contents) => delegate.writeReplace(path, contents),
    };
    const outputDir = await temporaryDirectory('raw-write-failure');
    await expect(
      runLivePersonAProvenance({
        caseId: 'dry_run_002',
        outputDir,
        submittedAt,
        requestTimestamp,
        model: 'gpt-5.6',
        reasoningEffort: 'medium',
        repository,
        client,
        writer,
      }),
    ).rejects.toThrow(/raw write failure/i);
    expect(writes.some((path) => path.endsWith('.extraction.json'))).toBe(false);
    expect(writes.some((path) => path.endsWith('.alignment.json'))).toBe(false);
    expect(writes.some((path) => path.endsWith('.evaluation.json'))).toBe(false);
    expect(await json(artifactPath(outputDir, 'run-manifest'))).toMatchObject({
      status: 'failed',
      failure: { stage: 'raw_persistence' },
      provider_call_count: 1,
      retry_count: 0,
    });
    expect(client.calls).toBe(1);
  });

  it('records provider failures without serializing a secret-bearing error message', async () => {
    const secret = 'forbidden-test-secret-value';
    const client = new FakeRawClient(new Error(`network failed with ${secret}`));
    const outputDir = await temporaryDirectory('provider-failure');
    await expect(
      runLivePersonAProvenance({
        caseId: 'dry_run_002',
        outputDir,
        submittedAt,
        requestTimestamp,
        model: 'gpt-5.6',
        reasoningEffort: 'medium',
        repository,
        client,
      }),
    ).rejects.toThrow();
    expect(await allFileContents(outputDir)).not.toContain(secret);
    expect(await json(artifactPath(outputDir, 'run-manifest'))).toMatchObject({
      status: 'failed',
      failure: {
        stage: 'provider_call',
        message: 'Person A provenance run failed during provider_call.',
      },
      provider_call_count: 1,
      retry_count: 0,
    });
  });

  it('prevents output-directory reuse before a provider call', async () => {
    const client = clientForBody(await successfulRawBody('dry_run_002'));
    const outputDir = await temporaryDirectory('collision');
    await writeFile(outputDir, 'occupied');
    await expect(
      runLivePersonAProvenance({
        caseId: 'dry_run_002',
        outputDir,
        submittedAt,
        requestTimestamp,
        model: 'gpt-5.6',
        reasoningEffort: 'medium',
        repository,
        client,
      }),
    ).rejects.toThrow();
    expect(client.calls).toBe(0);
    await unlink(outputDir);
  });
});

describe('Person A provenance local live simulation and raw-only replay', () => {
  it('completes one fake live call against the Dry Run 002 golden with a full manifest', async () => {
    const body = await successfulRawBody('dry_run_002');
    const client = clientForBody(body);
    const result = await runLive('successful-live', client);
    expect(client.calls).toBe(1);
    expect(result.manifest).toMatchObject({
      version: 'person-a-provenance-run-v1',
      mode: 'live',
      status: 'completed',
      case_id: 'dry_run_002',
      case: {
        golden: {
          path: 'src/fixtures/dry_run_002.person_a.golden.extraction.json',
          sha256: '67c85bc005b377a064d1bd18c59570dff50cdc10ae9ac9480331da41a934165c',
        },
        evaluation_contract: 'calibrated_live_v2',
      },
      extraction_contract: {
        schema_version: '0.1.2',
        extractor_version: 'person-a-v0.1.4',
        prompt_version: 'person-a-v0.1.4',
        prompt_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        response_schema_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      provider_response: {
        response_id: 'resp_fake_dry_run_002',
        served_model: 'gpt-5.6',
        response_status: 'completed',
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          total_tokens: 300,
        },
      },
      provider_call_count: 1,
      retry_count: 0,
      manually_edited: false,
      artifacts: {
        request_metadata: expect.objectContaining({ sha256: expect.any(String) }),
        raw_response: expect.objectContaining({ sha256: expect.any(String) }),
        validation: expect.objectContaining({ sha256: expect.any(String) }),
        extraction: expect.objectContaining({ sha256: expect.any(String) }),
        alignment: expect.objectContaining({ sha256: expect.any(String) }),
        evaluation: expect.objectContaining({ sha256: expect.any(String) }),
        failure: null,
      },
    });
    expect(result.manifest.offline_reproduction_command).toContain('--case-id dry_run_002');
    expect(await readFile(artifactPath(result.outputDir, 'raw-response'), 'utf8')).toBe(body);
    for (const reference of Object.values(result.manifest.artifacts)) {
      if (!reference) continue;
      const contents = await readFile(resolve(result.outputDir, reference.path), 'utf8');
      expect(sha256(contents)).toBe(reference.sha256);
    }
  });

  it('replays from raw and request metadata with zero provider calls and identical hashes', async () => {
    const body = await successfulRawBody('dry_run_002');
    const client = clientForBody(body);
    const live = await runLive('live-for-replay', client);
    const expectedHashes = {
      validation: live.manifest.artifacts.validation!.sha256,
      extraction: live.manifest.artifacts.extraction!.sha256,
      alignment: live.manifest.artifacts.alignment!.sha256,
      evaluation: live.manifest.artifacts.evaluation!.sha256,
    };

    for (const suffix of ['validation', 'extraction', 'alignment', 'evaluation']) {
      await unlink(artifactPath(live.outputDir, suffix));
    }
    const fetchMock = vi.fn(() => {
      throw new Error('offline replay must not use fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    const replayOutput = await temporaryDirectory('raw-only-replay');
    const replay = await replayPersonAProvenance({
      caseId: 'dry_run_002',
      outputDir: replayOutput,
      rawResponsePath: artifactPath(live.outputDir, 'raw-response'),
      requestMetadataPath: artifactPath(live.outputDir, 'request'),
      repository,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replay.manifest).toMatchObject({
      mode: 'replay',
      status: 'completed',
      provider_call_count: 0,
      retry_count: 0,
    });
    expect({
      validation: replay.manifest.artifacts.validation!.sha256,
      extraction: replay.manifest.artifacts.extraction!.sha256,
      alignment: replay.manifest.artifacts.alignment!.sha256,
      evaluation: replay.manifest.artifacts.evaluation!.sha256,
    }).toEqual(expectedHashes);
    expect(replay.manifest.artifacts.raw_response!.sha256).toBe(
      live.manifest.artifacts.raw_response!.sha256,
    );
  });

  it('fails replay when frozen metadata names another golden identity', async () => {
    const body = await successfulRawBody('dry_run_002');
    const client = clientForBody(body);
    const live = await runLive('mismatched-metadata-source', client);
    const metadataPath = artifactPath(live.outputDir, 'request');
    const metadata = await json(metadataPath);
    metadata.golden.sha256 = PERSON_A_PROVENANCE_CASES.dry_run_001.goldenSha256;
    const mismatched = resolve(live.outputDir, 'mismatched-request.json');
    await writeFile(mismatched, `${JSON.stringify(metadata)}\n`);
    await expect(
      replayPersonAProvenance({
        caseId: 'dry_run_002',
        outputDir: await temporaryDirectory('mismatched-metadata-replay'),
        rawResponsePath: artifactPath(live.outputDir, 'raw-response'),
        requestMetadataPath: mismatched,
        repository,
      }),
    ).rejects.toThrow(/golden identity/i);
  });

  it('fails replay when frozen provider settings do not match the harness', async () => {
    const body = await successfulRawBody('dry_run_002');
    const client = clientForBody(body);
    const live = await runLive('mismatched-provider-source', client);
    const metadataPath = artifactPath(live.outputDir, 'request');
    const metadata = await json(metadataPath);
    metadata.generation_parameters.store = true;
    const mismatched = resolve(live.outputDir, 'mismatched-provider-request.json');
    await writeFile(mismatched, `${JSON.stringify(metadata)}\n`);
    await expect(
      replayPersonAProvenance({
        caseId: 'dry_run_002',
        outputDir: await temporaryDirectory('mismatched-provider-replay'),
        rawResponsePath: artifactPath(live.outputDir, 'raw-response'),
        requestMetadataPath: mismatched,
        repository,
      }),
    ).rejects.toThrow(/provider configuration/i);
  });

  it('fails replay under a different repository SHA', async () => {
    const body = await successfulRawBody('dry_run_002');
    const client = clientForBody(body);
    const live = await runLive('repository-mismatch-source', client);
    await expect(
      replayPersonAProvenance({
        caseId: 'dry_run_002',
        outputDir: await temporaryDirectory('repository-mismatch-replay'),
        rawResponsePath: artifactPath(live.outputDir, 'raw-response'),
        requestMetadataPath: artifactPath(live.outputDir, 'request'),
        repository: {
          ...repository,
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      }),
    ).rejects.toThrow(/does not match frozen request SHA/i);
  });

  it('keeps credential values out of every successful artifact', async () => {
    const body = await successfulRawBody('dry_run_002');
    const client = clientForBody(body);
    const result = await runLive('secret-review', client);
    const contents = await allFileContents(result.outputDir);
    expect(contents).toContain('OPENAI_API_KEY');
    expect(contents).not.toContain('sk-proj-');
    expect(contents).not.toContain('Authorization');
    expect(contents).not.toContain('Bearer ');
  });
});
