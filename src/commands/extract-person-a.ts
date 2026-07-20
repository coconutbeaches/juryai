import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignPersonA } from '../alignment/person-a-alignment-corrected.js';
import { evaluatePersonA, reportMarkdown } from '../evaluation/person-a-diff-corrected.js';
import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';
import { extractPersonA } from '../extraction/person-a-extractor.js';
import {
  OpenAIResponsesClient,
  type StructuredExtractionClient,
} from '../extraction/openai-responses.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';

export type ExtractPersonACommandArgs = {
  input: string;
  submittedAt: string;
  model: string;
  outputDir: string;
  extraction?: string;
  failOnCritical: boolean;
};

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFile, '../../..');

export function parseExtractPersonAArgs(argv: string[]): ExtractPersonACommandArgs {
  const valueOptions = new Set(['input', 'submitted-at', 'model', 'output-dir', 'extraction']);
  const flagOptions = new Set(['fail-on-critical']);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) {
      throw new TypeError(`Unexpected positional or short argument: ${String(token)}`);
    }
    const name = token.slice(2);
    if (flagOptions.has(name)) {
      if (flags.has(name)) throw new TypeError(`Duplicate option: --${name}`);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('-')) {
        throw new TypeError(`Boolean flag --${name} does not accept a value`);
      }
      flags.add(name);
      continue;
    }
    if (!valueOptions.has(name)) throw new TypeError(`Unknown option: --${name}`);
    if (values.has(name)) throw new TypeError(`Duplicate option: --${name}`);
    const next = argv[index + 1];
    if (!next || next.startsWith('-')) throw new TypeError(`Missing value for --${name}`);
    values.set(name, next);
    index += 1;
  }
  return {
    input: resolve(projectRoot, values.get('input') ?? 'src/fixtures/dry_run_001.person_a.txt'),
    submittedAt: values.get('submitted-at') ?? '2026-07-18T12:00:00Z',
    model: values.get('model') ?? process.env.JURYAI_MODEL ?? 'gpt-5.6',
    outputDir: resolve(projectRoot, values.get('output-dir') ?? 'artifacts/person-a/latest'),
    ...(values.get('extraction')
      ? { extraction: resolve(projectRoot, values.get('extraction')!) }
      : {}),
    failOnCritical: flags.has('fail-on-critical'),
  };
}

export type ExtractPersonACommandDependencies = {
  getEnvironment: (name: string) => string | undefined;
  createClient: (apiKey: string, baseUrl?: string) => StructuredExtractionClient;
  extract: typeof extractPersonA;
};

const defaultDependencies: ExtractPersonACommandDependencies = {
  getEnvironment: (name) => process.env[name],
  createClient: (apiKey, baseUrl) => new OpenAIResponsesClient(apiKey, baseUrl),
  extract: extractPersonA,
};

export async function runExtractPersonACommand(
  argv: string[],
  dependencies: ExtractPersonACommandDependencies = defaultDependencies,
): Promise<void> {
  const args = parseExtractPersonAArgs(argv);
  const narrative = await readFile(args.input, 'utf8');
  const configuredReasoning = dependencies.getEnvironment('JURYAI_REASONING_EFFORT');
  if (
    configuredReasoning !== undefined &&
    !['low', 'medium', 'high'].includes(configuredReasoning)
  ) {
    throw new TypeError('JURYAI_REASONING_EFFORT must be low, medium, or high');
  }
  const reasoningEffort =
    (configuredReasoning as 'low' | 'medium' | 'high' | undefined) ?? 'medium';
  let extraction: Record<string, any>;
  let rawResponse: Record<string, any> | null = null;

  if (args.extraction) {
    extraction = JSON.parse(await readFile(args.extraction, 'utf8')) as Record<string, any>;
  } else {
    const apiKey = dependencies.getEnvironment('OPENAI_API_KEY');
    if (!apiKey)
      throw new Error(
        'OPENAI_API_KEY is required for live extraction. Use --extraction <file.json> to evaluate an existing output without an API call.',
      );
    const client = dependencies.createClient(
      apiKey,
      dependencies.getEnvironment('OPENAI_BASE_URL'),
    );
    const result = await dependencies.extract({
      narrative,
      submittedAt: args.submittedAt,
      model: args.model,
      client,
      reasoningEffort,
    });
    extraction = result.extraction;
    rawResponse = result.rawResponse;
  }

  const validation = validatePersonAExtraction(extraction, narrative);
  if (!validation.valid) {
    const errors = [...validation.schemaErrors, ...validation.invariantErrors]
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('\n');
    throw new Error(`Extraction is invalid:\n${errors}`);
  }

  const golden = buildPersonAGoldenProjection();
  const alignment = alignPersonA(extraction, golden);
  const report = evaluatePersonA(extraction, golden, alignment);
  await mkdir(args.outputDir, { recursive: true });
  const writes = [
    writeFile(
      resolve(args.outputDir, 'extraction.json'),
      `${JSON.stringify(extraction, null, 2)}\n`,
    ),
    writeFile(
      resolve(args.outputDir, 'golden-projection.json'),
      `${JSON.stringify(golden, null, 2)}\n`,
    ),
    writeFile(resolve(args.outputDir, 'alignment.json'), `${JSON.stringify(alignment, null, 2)}\n`),
    writeFile(resolve(args.outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(resolve(args.outputDir, 'report.md'), reportMarkdown(report)),
    writeFile(
      resolve(args.outputDir, 'request-metadata.json'),
      `${JSON.stringify(
        {
          requested_model: args.model,
          requested_reasoning_effort: reasoningEffort,
          store: false,
          submitted_at: args.submittedAt,
        },
        null,
        2,
      )}\n`,
    ),
  ];
  if (rawResponse) {
    writes.push(
      writeFile(
        resolve(args.outputDir, 'raw-response.json'),
        `${JSON.stringify(rawResponse, null, 2)}\n`,
      ),
    );
  }
  await Promise.all(writes);

  console.log('✓ Person A extraction valid against v0.1.2');
  console.log(`✓ Results written to ${args.outputDir}`);
  console.log(
    `Critical ${report.summary.critical} · Major ${report.summary.major} · Minor ${report.summary.minor} · Human edit rate ${(report.summary.human_edit_rate * 100).toFixed(1)}%`,
  );
  if (args.failOnCritical && report.summary.critical > 0) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    await runExtractPersonACommand(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
