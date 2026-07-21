import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  alignPersonA,
  familyItems,
  type PersonAFamily,
} from '../alignment/person-a-alignment-corrected.js';
import {
  applyClarificationRound,
  hashExtraction,
} from '../clarification/apply-clarification-round.js';
import { buildPersonAAssessmentResult } from '../clarification/build-assessments.js';
import {
  classifyQuestionNecessity,
  generateNecessaryClarificationQuestions,
} from '../clarification/question-necessity.js';
import {
  evaluatePersonA,
  type PersonAEvaluationReport,
} from '../evaluation/person-a-diff-corrected.js';
import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';
import {
  PERSON_A_REPAIR_VERSION,
  repairPersonAExtraction,
  type PersonARepairResult,
} from '../repair/person-a-record-repair.js';

type JsonObject = Record<string, any>;
type Args = {
  input: string;
  extraction: string;
  outputDir: string;
  clarifications?: string;
  answers?: string;
};

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFile, '../../..');
const fullReferencePath = resolve(projectRoot, 'src/fixtures/dry_run_001.golden.json');
const families: PersonAFamily[] = [
  'agreement_terms',
  'deliverables',
  'timeline',
  'claims',
  'evidence',
  'damages',
  'outcomes',
  'third_parties',
  'extraction_issues',
  'clarification_questions',
];

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArgs(argv: string[]): Args {
  const allowed = new Set(['input', 'extraction', 'output-dir', 'clarifications', 'answers']);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) throw new TypeError(`Unexpected argument: ${String(token)}`);
    const name = token.slice(2);
    if (!allowed.has(name)) throw new TypeError(`Unknown option: --${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new TypeError(`Missing value for --${name}`);
    if (values.has(name)) throw new TypeError(`Duplicate option: --${name}`);
    values.set(name, value);
    index += 1;
  }
  for (const required of ['input', 'extraction', 'output-dir']) {
    if (!values.has(required)) throw new TypeError(`Required option is missing: --${required}`);
  }
  if (values.has('clarifications') !== values.has('answers')) {
    throw new TypeError('--clarifications and --answers must be supplied together');
  }
  return {
    input: resolve(projectRoot, values.get('input')!),
    extraction: resolve(projectRoot, values.get('extraction')!),
    outputDir: resolve(projectRoot, values.get('output-dir')!),
    ...(values.has('clarifications')
      ? {
          clarifications: resolve(projectRoot, values.get('clarifications')!),
          answers: resolve(projectRoot, values.get('answers')!),
        }
      : {}),
  };
}

async function readJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Unable to read valid ${label} JSON at ${path}`, { cause: error });
  }
}

async function writeJson(directory: string, filename: string, value: unknown): Promise<void> {
  await writeFile(resolve(directory, filename), `${JSON.stringify(value, null, 2)}\n`);
}

function validate(record: JsonObject, narrative: string, label: string): void {
  const result = validatePersonAExtraction(record, narrative);
  if (!result.valid) {
    const messages = [...result.schemaErrors, ...result.invariantErrors].map(
      (error) => `${error.path}: ${error.message}`,
    );
    throw new Error(`${label} failed validation:\n${messages.join('\n')}`);
  }
}

function objectCounts(record: JsonObject): Record<PersonAFamily, number> {
  return Object.fromEntries(
    families.map((family) => [family, familyItems(record, family).length]),
  ) as Record<PersonAFamily, number>;
}

function stage(report: PersonAEvaluationReport): JsonObject {
  return {
    ...report.summary,
    per_family: Object.fromEntries(
      families.map((family) => [
        family,
        {
          precision: report.metrics[family].precision,
          recall: report.metrics[family].recall,
        },
      ]),
    ),
    unsupported_fact_count: report.errors.filter(
      (error) => error.code === 'unsupported_extra_object',
    ).length,
  };
}

function beforeAfter(
  original: JsonObject,
  repaired: JsonObject,
  before: PersonAEvaluationReport,
  after: PersonAEvaluationReport,
  repairs: PersonARepairResult,
): JsonObject {
  return {
    version: PERSON_A_REPAIR_VERSION,
    critical: { before: before.summary.critical, after: after.summary.critical },
    major: { before: before.summary.major, after: after.summary.major },
    minor: { before: before.summary.minor, after: after.summary.minor },
    human_edit_rate: {
      before: before.summary.human_edit_rate,
      after: after.summary.human_edit_rate,
    },
    weighted_error_rate: {
      before: before.summary.weighted_error_rate,
      after: after.summary.weighted_error_rate,
    },
    per_family: Object.fromEntries(
      families.map((family) => [
        family,
        {
          precision: {
            before: before.metrics[family].precision,
            after: after.metrics[family].precision,
          },
          recall: {
            before: before.metrics[family].recall,
            after: after.metrics[family].recall,
          },
        },
      ]),
    ),
    object_counts: { before: objectCounts(original), after: objectCounts(repaired) },
    repairs_applied_by_rule: repairs.audit_summary.repairs_applied_by_rule,
    repairs_skipped: repairs.audit_summary.repairs_skipped,
    repairs_rejected: repairs.audit_summary.repairs_rejected,
    original_extraction_hash: hashExtraction(original),
    repaired_extraction_hash: hashExtraction(repaired),
    unsupported_fact_count: {
      before: before.errors.filter((error) => error.code === 'unsupported_extra_object').length,
      after: after.errors.filter((error) => error.code === 'unsupported_extra_object').length,
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const narrative = await readFile(args.input, 'utf8');
  const extractionValue = await readJson(args.extraction, 'extraction');
  if (!isRecord(extractionValue)) throw new TypeError('extraction must be an object');
  validate(extractionValue, narrative, 'original extraction');

  const repairs = repairPersonAExtraction({ extraction: extractionValue, narrative });
  validate(repairs.repaired_extraction, narrative, 'repaired extraction');

  const reference = buildPersonAGoldenProjection();
  const originalAlignment = alignPersonA(extractionValue, reference);
  const originalReport = evaluatePersonA(extractionValue, reference, originalAlignment);
  const repairedAlignment = alignPersonA(repairs.repaired_extraction, reference);
  const repairedReport = evaluatePersonA(repairs.repaired_extraction, reference, repairedAlignment);
  const assessments = buildPersonAAssessmentResult(
    repairs.repaired_extraction,
    repairedReport,
    repairedAlignment,
  );
  const necessity = classifyQuestionNecessity(assessments.assessments, repairs.repaired_extraction);
  const repairedQuestions = generateNecessaryClarificationQuestions(necessity.question_candidates);

  await mkdir(args.outputDir, { recursive: true });
  await Promise.all([
    writeJson(args.outputDir, 'repaired-extraction.json', repairs.repaired_extraction),
    writeJson(args.outputDir, 'applied-repairs.json', repairs.applied_repairs),
    writeJson(args.outputDir, 'skipped-repairs.json', repairs.skipped_repairs),
    writeJson(args.outputDir, 'rejected-repairs.json', repairs.rejected_repairs),
    writeJson(args.outputDir, 'repair-audit.json', {
      ...repairs.audit_summary,
      repairs: [
        ...repairs.applied_repairs,
        ...repairs.skipped_repairs,
        ...repairs.rejected_repairs,
      ].sort((left, right) => left.sequence_number - right.sequence_number),
    }),
    writeJson(args.outputDir, 'alignment.json', repairedAlignment),
    writeJson(args.outputDir, 'report.json', repairedReport),
    writeJson(
      args.outputDir,
      'before-after-summary.json',
      beforeAfter(
        extractionValue,
        repairs.repaired_extraction,
        originalReport,
        repairedReport,
        repairs,
      ),
    ),
    writeJson(args.outputDir, 'repaired-clarifications.json', {
      generated_questions: repairedQuestions,
      question_count: repairedQuestions.length,
      suppressed_candidates: necessity.suppressed_candidates,
    }),
  ]);

  if (args.clarifications && args.answers) {
    const [clarifications, answers, fullReference] = await Promise.all([
      readJson(args.clarifications, 'clarifications'),
      readJson(args.answers, 'answers'),
      readJson(fullReferencePath, 'reference fixture'),
    ]);
    if (
      !isRecord(clarifications) ||
      !Array.isArray(clarifications.generated_questions) ||
      !isRecord(answers) ||
      !Array.isArray(answers.answers)
    ) {
      throw new TypeError('clarification chain artifacts are malformed');
    }
    const round = applyClarificationRound({
      extraction: repairs.repaired_extraction,
      questions: clarifications.generated_questions,
      answers: answers.answers,
      goldenFixture: fullReference,
      narrative,
    });
    validate(round.projected_effective_record, narrative, 'repaired and clarified extraction');
    const finalAlignment = alignPersonA(round.projected_effective_record, reference);
    const finalReport = evaluatePersonA(
      round.projected_effective_record,
      reference,
      finalAlignment,
    );
    await Promise.all([
      writeJson(
        args.outputDir,
        'repaired-clarified-extraction.json',
        round.projected_effective_record,
      ),
      writeJson(args.outputDir, 'repaired-clarified-alignment.json', finalAlignment),
      writeJson(args.outputDir, 'repaired-clarified-report.json', finalReport),
      writeJson(args.outputDir, 'clarification-amendments.json', round.applied_amendments),
      writeJson(args.outputDir, 'clarification-audit.json', {
        audit_summary: round.audit_summary,
        rejected_amendments: round.rejected_amendments,
        unresolved_questions: round.unresolved_questions,
      }),
      writeJson(args.outputDir, 'three-stage-summary.json', {
        version: PERSON_A_REPAIR_VERSION,
        original: stage(originalReport),
        repaired: stage(repairedReport),
        repaired_clarified: stage(finalReport),
        object_counts: {
          original: objectCounts(extractionValue),
          repaired: objectCounts(repairs.repaired_extraction),
          repaired_clarified: objectCounts(round.projected_effective_record),
        },
        hashes: {
          original: hashExtraction(extractionValue),
          repaired: hashExtraction(repairs.repaired_extraction),
          repaired_clarified: hashExtraction(round.projected_effective_record),
        },
      }),
    ]);
  }

  console.log(
    `✓ Applied ${repairs.applied_repairs.length} deterministic repairs; critical ${originalReport.summary.critical} → ${repairedReport.summary.critical}`,
  );
  console.log(`✓ Repair artifacts written to ${args.outputDir}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
