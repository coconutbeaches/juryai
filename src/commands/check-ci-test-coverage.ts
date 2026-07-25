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

/**
 * Matrix entries, read as `- src/tests/<path>.test.ts` list items.
 *
 * Nested paths are accepted, but each segment is restricted to word characters,
 * dots, and dashes, and relative segments are rejected, so the parser stays tight.
 */
export function parseMatrixTestFiles(workflow: string): string[] {
  const entry = /^\s*-\s+(src\/tests\/(?:[\w.-]+\/)*[\w.-]+\.test\.ts)\s*$/gm;
  return [...workflow.matchAll(entry)]
    .map((match) => match[1]!)
    .filter((file) => !file.split('/').some((segment) => segment === '.' || segment === '..'))
    .sort();
}

/**
 * Every `.test.ts` file under the tests directory, at any depth, as normalized
 * repository-relative POSIX paths (`src/tests/evaluation/new.test.ts`).
 *
 * Paths are rebuilt from directory-entry names rather than from platform paths, so
 * output is identical on macOS, Linux, and Windows. Helper and non-test files are
 * excluded by the suffix; symlinked directories are not traversed, which also
 * removes any risk of a cycle.
 */
export function listTestFilesOnDisk(testsDirectory: string): string[] {
  const found: string[] = [];
  const walk = (directory: string, segments: string[]): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const nextSegments = [...segments, entry.name];
      if (entry.isDirectory()) {
        walk(resolve(directory, entry.name), nextSegments);
      } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        found.push([TESTS_DIRECTORY, ...nextSegments].join('/'));
      }
    }
  };
  walk(testsDirectory, []);
  return found.sort();
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
