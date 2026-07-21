import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticRuntimeAssessmentProvider } from '../runtime/static-assessment-provider.js';
import {
  orchestratePersonAPlanning,
  type PersonARuntimePlanningResult,
} from '../runtime/person-a-runtime-orchestrator.js';

export interface PlanPersonARuntimeCommandArgs {
  input: string;
  extraction: string;
  assessments: string;
  outputDir: string;
}

export interface PlanPersonARuntimeCommandDependencies {
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  makeDirectory(path: string): Promise<void>;
  orchestrate: typeof orchestratePersonAPlanning;
}

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFile, '../../..');

export function parsePlanPersonARuntimeArgs(argv: string[]): PlanPersonARuntimeCommandArgs {
  const allowed = new Set(['input', 'extraction', 'assessments', 'output-dir']);
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
    assessments: resolve(projectRoot, values.get('assessments')!),
    outputDir: resolve(projectRoot, values.get('output-dir')!),
  };
}

const defaultDependencies: PlanPersonARuntimeCommandDependencies = {
  readText: (path) => readFile(path, 'utf8'),
  writeText: (path, contents) => writeFile(path, contents),
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  orchestrate: orchestratePersonAPlanning,
};

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new TypeError(`${label} must contain valid JSON.`, { cause: error });
  }
}

function deterministicJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function runPlanPersonARuntimeCommand(
  argv: string[],
  dependencies: PlanPersonARuntimeCommandDependencies = defaultDependencies,
): Promise<PersonARuntimePlanningResult> {
  const args = parsePlanPersonARuntimeArgs(argv);
  const [narrative, extractionText, assessmentText] = await Promise.all([
    dependencies.readText(args.input),
    dependencies.readText(args.extraction),
    dependencies.readText(args.assessments),
  ]);
  const extraction = parseJson(extractionText, 'Extraction');
  const parsedAssessmentInput = parseJson(assessmentText, 'Assessments');
  const assessments =
    parsedAssessmentInput &&
    typeof parsedAssessmentInput === 'object' &&
    !Array.isArray(parsedAssessmentInput) &&
    'assessments' in parsedAssessmentInput
      ? (parsedAssessmentInput as { assessments: unknown }).assessments
      : parsedAssessmentInput;
  const result = dependencies.orchestrate({
    extraction,
    narrative,
    assessmentProvider: createStaticRuntimeAssessmentProvider(assessments),
  });

  await dependencies.makeDirectory(args.outputDir);
  const artifacts: Record<string, unknown> = {
    'runtime-plan.json': result,
    'original-extraction.json': result.original_extraction,
    'repaired-extraction.json': result.repaired_extraction,
    'repair-audit.json': result.repair_result,
    'assessments.json': {
      raw_assessments: result.raw_assessments,
      validated_assessments: result.validated_assessments,
      rejected_assessments: result.rejected_assessments,
    },
    'necessity-classifications.json': result.necessity_classifications,
    'clarification-questions.json': result.generated_questions,
    'suppressed-candidates.json': result.suppressed_candidates,
    'orchestration-audit.json': {
      orchestration_version: result.orchestration_version,
      stage_statuses: result.stage_statuses,
      audit_summary: result.audit_summary,
    },
  };
  await Promise.all(
    Object.entries(artifacts).map(([filename, value]) =>
      dependencies.writeText(resolve(args.outputDir, filename), deterministicJson(value)),
    ),
  );
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    const result = await runPlanPersonARuntimeCommand(process.argv.slice(2));
    console.log(
      `Person A runtime planning ${result.audit_summary.final_status}: ${result.question_count} question(s).`,
    );
    if (result.audit_summary.final_status === 'failed_closed') process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
