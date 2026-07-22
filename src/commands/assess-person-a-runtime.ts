import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDeterministicPersonAAssessmentProvider,
  type DeterministicPersonAAssessmentAudit,
} from '../runtime/deterministic-person-a-assessment-provider.js';
import {
  orchestratePersonAPlanning,
  type PersonARuntimePlanningResult,
} from '../runtime/person-a-runtime-orchestrator.js';

export interface AssessPersonARuntimeCommandArgs {
  input: string;
  extraction: string;
  outputDir: string;
}

export interface AssessPersonARuntimeCommandDependencies {
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  makeDirectory(path: string): Promise<void>;
  orchestrate: typeof orchestratePersonAPlanning;
}

export interface AssessPersonARuntimeCommandResult {
  runtimePlan: PersonARuntimePlanningResult;
  assessmentAudit: DeterministicPersonAAssessmentAudit | null;
}

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFile, '../../..');

export function parseAssessPersonARuntimeArgs(argv: string[]): AssessPersonARuntimeCommandArgs {
  const allowed = new Set(['input', 'extraction', 'output-dir']);
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
    input: resolve(projectRoot, values.get('input')!),
    extraction: resolve(projectRoot, values.get('extraction')!),
    outputDir: resolve(projectRoot, values.get('output-dir')!),
  };
}

const defaultDependencies: AssessPersonARuntimeCommandDependencies = {
  readText: (path) => readFile(path, 'utf8'),
  writeText: (path, contents) => writeFile(path, contents),
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  orchestrate: orchestratePersonAPlanning,
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new TypeError('Extraction must contain valid JSON.', { cause: error });
  }
}

function deterministicJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function runAssessPersonARuntimeCommand(
  argv: string[],
  dependencies: AssessPersonARuntimeCommandDependencies = defaultDependencies,
): Promise<AssessPersonARuntimeCommandResult> {
  const args = parseAssessPersonARuntimeArgs(argv);
  const [narrative, extractionText] = await Promise.all([
    dependencies.readText(args.input),
    dependencies.readText(args.extraction),
  ]);
  const extraction = parseJson(extractionText);
  const provider = createDeterministicPersonAAssessmentProvider();
  const runtimePlan = dependencies.orchestrate({
    extraction,
    narrative,
    assessmentProvider: provider,
  });
  const assessmentAudit = provider.getLastAudit();

  await dependencies.makeDirectory(args.outputDir);
  const artifacts: Record<string, unknown> = {
    'repaired-extraction.json': runtimePlan.repaired_extraction,
    'assessments.json': {
      validated_assessments: runtimePlan.validated_assessments,
      rejected_assessments: runtimePlan.rejected_assessments,
    },
    'necessity-classifications.json': runtimePlan.necessity_classifications,
    'clarification-questions.json': runtimePlan.generated_questions,
    'suppressed-candidates.json': runtimePlan.suppressed_candidates,
    'assessment-audit.json': assessmentAudit,
    'runtime-plan.json': runtimePlan,
  };
  await Promise.all(
    Object.entries(artifacts).map(([filename, value]) =>
      dependencies.writeText(resolve(args.outputDir, filename), deterministicJson(value)),
    ),
  );
  return { runtimePlan, assessmentAudit };
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    const result = await runAssessPersonARuntimeCommand(process.argv.slice(2));
    console.log(
      `Person A deterministic runtime assessment ${result.runtimePlan.audit_summary.final_status}: ${result.runtimePlan.validated_assessments.length} assessment(s), ${result.runtimePlan.question_count} question(s).`,
    );
    if (result.runtimePlan.audit_summary.final_status === 'failed_closed') process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
