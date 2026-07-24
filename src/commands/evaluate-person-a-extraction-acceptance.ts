import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluatePersonAExtractionAcceptanceSuite,
  loadPersonAExtractionAcceptanceManifest,
  renderPersonAExtractionAcceptanceReport,
  serializePersonAExtractionAcceptance,
  type PersonAExtractionAcceptanceCase,
} from '../evaluation/person-a-extraction-acceptance.js';

export type EvaluatePersonAExtractionAcceptanceArgs = {
  manifestPath: string;
  format: 'json' | 'human';
  gate: boolean;
  help: boolean;
};

export type EvaluatePersonAExtractionAcceptanceDependencies = {
  loadManifest(path: string): Promise<PersonAExtractionAcceptanceCase[]>;
  writeStdout(value: string): void;
};

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const defaultManifestPath = resolve(
  projectRoot,
  'src/fixtures/person-a-extraction-acceptance.manifest.json',
);
const currentFile = fileURLToPath(import.meta.url);

export function parseEvaluatePersonAExtractionAcceptanceArgs(
  argv: string[],
): EvaluatePersonAExtractionAcceptanceArgs {
  const parsed: EvaluatePersonAExtractionAcceptanceArgs = {
    manifestPath: defaultManifestPath,
    format: 'json',
    gate: false,
    help: false,
  };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected positional or short argument: ${argument}`);
    }
    if (!['--manifest', '--format', '--gate', '--help'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (seen.has(argument)) throw new Error(`Duplicate option: ${argument}`);
    seen.add(argument);
    if (argument === '--gate' || argument === '--help') {
      parsed[argument === '--gate' ? 'gate' : 'help'] = true;
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        throw new Error(`Boolean flag ${argument} does not accept a value`);
      }
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('-')) {
      throw new Error(`Missing value for ${argument}`);
    }
    index += 1;
    if (argument === '--manifest') parsed.manifestPath = resolve(value);
    else if (value === 'json' || value === 'human') parsed.format = value;
    else throw new Error(`Unsupported --format value: ${value}`);
  }
  return parsed;
}

export async function runEvaluatePersonAExtractionAcceptanceCommand(
  argv: string[],
  dependencies: EvaluatePersonAExtractionAcceptanceDependencies = {
    loadManifest: loadPersonAExtractionAcceptanceManifest,
    writeStdout(value) {
      process.stdout.write(value);
    },
  },
): Promise<number> {
  const args = parseEvaluatePersonAExtractionAcceptanceArgs(argv);
  if (args.help) {
    dependencies.writeStdout(
      [
        'Usage: npm run evaluate:person-a-acceptance -- [options]',
        '',
        '  --manifest PATH   Corpus manifest (defaults to the tracked repository corpus)',
        '  --format FORMAT   json (default) or human',
        '  --gate            Exit 2 if an expected acceptance result is unmet',
        '  --help            Show this help',
        '',
      ].join('\n'),
    );
    return 0;
  }
  const cases = await dependencies.loadManifest(args.manifestPath);
  const suite = evaluatePersonAExtractionAcceptanceSuite(cases);
  dependencies.writeStdout(
    args.format === 'json'
      ? serializePersonAExtractionAcceptance(suite)
      : renderPersonAExtractionAcceptanceReport(suite),
  );
  return args.gate && !suite.gate_passed ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    process.exitCode = await runEvaluatePersonAExtractionAcceptanceCommand(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
