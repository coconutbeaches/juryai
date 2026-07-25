import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Independent guard: every test file on disk must be a CI matrix entry, and every
 * matrix entry must still exist.
 *
 * This runs from the always-required quality-gates job rather than from inside any
 * individual test suite. A guard hosted by a matrix suite cannot protect that suite:
 * removing the suite from the matrix would also stop the guard from running.
 */

export type TestMatrixCoverage = {
  missingFromMatrix: string[];
  staleMatrixEntries: string[];
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW_PATH = '.github/workflows/ci.yml';
const TESTS_DIRECTORY = 'src/tests';

/** Matrix entries, read as `- src/tests/<name>.test.ts` list items. */
export function parseMatrixTestFiles(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*-\s+(src\/tests\/[\w.-]+\.test\.ts)\s*$/gm)]
    .map((match) => match[1]!)
    .sort();
}

/** Test files on disk. Helper and non-test files are excluded by the suffix. */
export function listTestFilesOnDisk(testsDirectory: string): string[] {
  return readdirSync(testsDirectory)
    .filter((entry) => entry.endsWith('.test.ts'))
    .map((entry) => `${TESTS_DIRECTORY}/${entry}`)
    .sort();
}

export function compareTestMatrixCoverage(onDisk: string[], matrix: string[]): TestMatrixCoverage {
  const matrixSet = new Set(matrix);
  const diskSet = new Set(onDisk);
  return {
    missingFromMatrix: onDisk.filter((file) => !matrixSet.has(file)).sort(),
    staleMatrixEntries: matrix.filter((file) => !diskSet.has(file)).sort(),
  };
}

export function checkRepositoryTestMatrixCoverage(root = repositoryRoot): TestMatrixCoverage {
  const workflow = readFileSync(resolve(root, WORKFLOW_PATH), 'utf8');
  return compareTestMatrixCoverage(
    listTestFilesOnDisk(resolve(root, TESTS_DIRECTORY)),
    parseMatrixTestFiles(workflow),
  );
}

function main(): void {
  const { missingFromMatrix, staleMatrixEntries } = checkRepositoryTestMatrixCoverage();
  for (const file of missingFromMatrix) {
    process.stderr.write(`Test file is not run by the CI matrix: ${file}\n`);
  }
  for (const file of staleMatrixEntries) {
    process.stderr.write(`CI matrix entry no longer exists on disk: ${file}\n`);
  }
  if (missingFromMatrix.length > 0 || staleMatrixEntries.length > 0) {
    process.stderr.write(`Update ${WORKFLOW_PATH} so every test file runs exactly once.\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('✓ Every test file on disk is run by the CI matrix\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
