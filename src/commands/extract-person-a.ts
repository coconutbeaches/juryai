import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignPersonA } from '../alignment/person-a-alignment-corrected.js';
import { evaluatePersonA, reportMarkdown } from '../evaluation/person-a-diff-corrected.js';
import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';
import { extractPersonA } from '../extraction/person-a-extractor.js';
import { OpenAIResponsesClient } from '../extraction/openai-responses.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';

type Args = {
  input: string;
  submittedAt: string;
  model: string;
  outputDir: string;
  extraction?: string;
  failOnCritical: boolean;
};

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFile, '../../..');

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) flags.add(name);
    else {
      values.set(name, next);
      index += 1;
    }
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const narrative = await readFile(args.input, 'utf8');
  let extraction: Record<string, any>;

  if (args.extraction) {
    extraction = JSON.parse(await readFile(args.extraction, 'utf8')) as Record<string, any>;
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
      throw new Error(
        'OPENAI_API_KEY is required for live extraction. Use --extraction <file.json> to evaluate an existing output without an API call.',
      );
    const client = new OpenAIResponsesClient(apiKey, process.env.OPENAI_BASE_URL);
    const result = await extractPersonA({
      narrative,
      submittedAt: args.submittedAt,
      model: args.model,
      client,
      reasoningEffort:
        (process.env.JURYAI_REASONING_EFFORT as 'low' | 'medium' | 'high' | undefined) ?? 'medium',
    });
    extraction = result.extraction;
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
  await Promise.all([
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
  ]);

  console.log('✓ Person A extraction valid against v0.1.2');
  console.log(`✓ Results written to ${args.outputDir}`);
  console.log(
    `Critical ${report.summary.critical} · Major ${report.summary.major} · Minor ${report.summary.minor} · Human edit rate ${(report.summary.human_edit_rate * 100).toFixed(1)}%`,
  );
  if (args.failOnCritical && report.summary.critical > 0) process.exitCode = 2;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
