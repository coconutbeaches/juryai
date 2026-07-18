import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { validateCustomInvariants, type ValidationIssue } from './custom-invariants.js';

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFile, '../../..');
const schemaPath = resolve(projectRoot, 'src/schemas/juryai-case-record-v0.1.1.schema.json');

export type ValidationResult = {
  valid: boolean;
  schemaErrors: ValidationIssue[];
  invariantErrors: ValidationIssue[];
};

export async function validateCaseRecord(record: unknown): Promise<ValidationResult> {
  const schemaRaw = await readFile(schemaPath, 'utf8');
  const schema = JSON.parse(schemaRaw) as object;

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const schemaValid = validate(record);
  const schemaErrors: ValidationIssue[] = (validate.errors ?? []).map((error: ErrorObject) => ({
    path: error.instancePath || '$',
    message: `${error.message ?? 'schema validation error'}${
      error.params ? ` (${JSON.stringify(error.params)})` : ''
    }`,
  }));
  const invariantErrors = schemaValid ? validateCustomInvariants(record) : [];

  return {
    valid: Boolean(schemaValid) && invariantErrors.length === 0,
    schemaErrors,
    invariantErrors,
  };
}

export async function validateCaseRecordFile(filePath: string): Promise<ValidationResult> {
  const recordRaw = await readFile(filePath, 'utf8');
  return validateCaseRecord(JSON.parse(recordRaw) as unknown);
}

function printIssues(title: string, issues: ValidationIssue[]): void {
  if (issues.length === 0) return;
  console.error(`\n${title}:`);
  for (const issue of issues) {
    console.error(`- ${issue.path}: ${issue.message}`);
  }
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: tsx src/validation/validate-case-record.ts <record.json>');
    process.exitCode = 2;
    return;
  }

  const resolved = resolve(process.cwd(), target);
  try {
    const result = await validateCaseRecordFile(resolved);
    if (!result.valid) {
      console.error(`Validation failed for ${resolved}`);
      printIssues('JSON Schema errors', result.schemaErrors);
      printIssues('Custom invariant errors', result.invariantErrors);
      process.exitCode = 1;
      return;
    }
    console.log(`✓ JSON Schema valid: ${resolved}`);
    console.log('✓ Custom invariants valid');
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  await main();
}
