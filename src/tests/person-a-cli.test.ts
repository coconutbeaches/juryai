import { readFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseExtractPersonAArgs,
  runExtractPersonACommand,
  type ExtractPersonACommandDependencies,
} from '../commands/extract-person-a.js';
import { validPersonAExtraction } from './person-a-test-helpers.js';
import {
  checkRepositoryTestMatrixCoverage,
  compareTestMatrixCoverage,
  listTestFilesOnDisk,
  parseMatrixTestFiles,
} from '../commands/check-ci-test-coverage.js';

function inertDependencies(calls: string[]): ExtractPersonACommandDependencies {
  return {
    getEnvironment(name) {
      calls.push(`environment:${name}`);
      return undefined;
    },
    createClient() {
      calls.push('client');
      throw new Error('client construction must not occur');
    },
    async extract() {
      calls.push('network');
      throw new Error('extraction must not occur');
    },
  };
}

describe('Person A extraction CLI', () => {
  it.each([
    {
      name: 'misspelled replay option',
      argv: ['--extracton', 'saved.json'],
      message: 'Unknown option: --extracton',
    },
    {
      name: 'unknown option',
      argv: ['--surprise', 'value'],
      message: 'Unknown option: --surprise',
    },
    {
      name: 'duplicate extraction',
      argv: ['--extraction', 'one.json', '--extraction', 'two.json'],
      message: 'Duplicate option: --extraction',
    },
    {
      name: 'missing extraction value',
      argv: ['--extraction'],
      message: 'Missing value for --extraction',
    },
    {
      name: 'boolean assignment',
      argv: ['--fail-on-critical=true'],
      message: 'Unknown option: --fail-on-critical=true',
    },
    {
      name: 'boolean value',
      argv: ['--fail-on-critical', 'false'],
      message: 'Boolean flag --fail-on-critical does not accept a value',
    },
    {
      name: 'positional argument',
      argv: ['saved.json'],
      message: 'Unexpected positional or short argument: saved.json',
    },
    {
      name: 'short flag',
      argv: ['-e', 'saved.json'],
      message: 'Unexpected positional or short argument: -e',
    },
    {
      name: 'short flag as a value',
      argv: ['--model', '-x'],
      message: 'Missing value for --model',
    },
  ])('rejects $name before credentials or live setup', async ({ argv, message }) => {
    const calls: string[] = [];

    await expect(runExtractPersonACommand(argv, inertDependencies(calls))).rejects.toThrow(message);
    expect(calls).toEqual([]);
  });

  it('parses a valid explicit replay without selecting the live path', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'juryai-cli-replay-'));
    const extraction = validPersonAExtraction();
    const input = resolve(directory, 'input.txt');
    const replay = resolve(directory, 'extraction.json');
    const output = resolve(directory, 'output');
    await Promise.all([
      writeFile(input, extraction.submission.raw_text),
      writeFile(replay, JSON.stringify(extraction)),
    ]);
    const calls: string[] = [];
    const dependencies = inertDependencies(calls);
    dependencies.getEnvironment = (name) => {
      calls.push(`environment:${name}`);
      return name === 'JURYAI_REASONING_EFFORT' ? 'medium' : undefined;
    };

    await runExtractPersonACommand(
      [
        '--input',
        input,
        '--extraction',
        replay,
        '--output-dir',
        output,
        '--submitted-at',
        '2026-07-19T12:00:00Z',
      ],
      dependencies,
    );

    expect(calls).toEqual(['environment:JURYAI_REASONING_EFFORT']);
    expect(JSON.parse(await readFile(resolve(output, 'extraction.json'), 'utf8'))).toEqual(
      extraction,
    );
  });

  it('replays a saved raw response for span diagnostics without selecting the live path', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'juryai-cli-raw-replay-'));
    const output = resolve(directory, 'output');
    const calls: string[] = [];
    const dependencies = inertDependencies(calls);
    dependencies.getEnvironment = (name) => {
      calls.push(`environment:${name}`);
      return name === 'JURYAI_REASONING_EFFORT' ? 'medium' : undefined;
    };

    await runExtractPersonACommand(
      [
        '--input',
        resolve(process.cwd(), 'src/fixtures/dry_run_001.person_a.txt'),
        '--extraction',
        resolve(process.cwd(), 'docs/dry-run-001/extraction.json'),
        '--raw-response',
        resolve(process.cwd(), 'docs/dry-run-001/raw-response.json'),
        '--output-dir',
        output,
        '--submitted-at',
        '2026-07-25T00:00:00Z',
      ],
      dependencies,
    );

    expect(calls).toEqual(['environment:JURYAI_REASONING_EFFORT']);
    const diagnostics = JSON.parse(
      await readFile(resolve(output, 'span-diagnostics.json'), 'utf8'),
    );
    expect(diagnostics).toMatchObject({
      raw_model: { total_spans: 58, exact_spans: 48, failing_spans: 10 },
      assembler: { repaired_spans: 10 },
      assembled: { total_spans: 58, exact_spans: 58, failing_spans: 0 },
      final_invariants: { invariants_valid: true, exact_source_slice_valid: true },
    });
  });

  it('reaches the injected live path only after valid parsing succeeds', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'juryai-cli-live-'));
    const extraction = validPersonAExtraction();
    const input = resolve(directory, 'input.txt');
    const output = resolve(directory, 'output');
    await writeFile(input, extraction.submission.raw_text);
    const calls: string[] = [];
    const dependencies: ExtractPersonACommandDependencies = {
      getEnvironment(name) {
        calls.push(`environment:${name}`);
        if (name === 'JURYAI_REASONING_EFFORT') return 'medium';
        if (name === 'OPENAI_API_KEY') return 'test-key';
        return undefined;
      },
      createClient(apiKey) {
        calls.push(`client:${apiKey}`);
        return {
          async generate() {
            throw new Error('the injected extractor should own this test path');
          },
        };
      },
      async extract(options) {
        calls.push(`extract:${options.model}`);
        return { extraction, modelOutput: {}, rawResponse: {} };
      },
    };

    await runExtractPersonACommand(
      ['--input', input, '--output-dir', output, '--model', 'gpt-5.6'],
      dependencies,
    );

    expect(calls).toEqual([
      'environment:JURYAI_REASONING_EFFORT',
      'environment:OPENAI_API_KEY',
      'environment:OPENAI_BASE_URL',
      'client:test-key',
      'extract:gpt-5.6',
    ]);
  });

  it('keeps valid parser defaults and flags deterministic', () => {
    expect(parseExtractPersonAArgs(['--fail-on-critical'])).toMatchObject({
      model: 'gpt-5.6',
      failOnCritical: true,
    });
  });
});

describe('CI test-matrix coverage guard', () => {
  // The guard is hosted by the always-required quality-gates job, not by a matrix
  // suite: a guard living inside a matrix suite cannot detect its own omission.
  it('reports the repository as fully covered', () => {
    expect(checkRepositoryTestMatrixCoverage()).toEqual({
      missingFromMatrix: [],
      staleMatrixEntries: [],
    });
  });

  it('parses matrix entries and ignores helper or non-test files', () => {
    const workflow = [
      '        test_file:',
      '          - src/tests/alpha.test.ts',
      '          - src/tests/beta.test.ts',
      '      - name: Some step',
    ].join('\n');
    expect(parseMatrixTestFiles(workflow)).toEqual([
      'src/tests/alpha.test.ts',
      'src/tests/beta.test.ts',
    ]);
    expect(listTestFilesOnDisk(resolve(import.meta.dirname))).not.toContain(
      'src/tests/person-a-test-helpers.ts',
    );
  });

  describe('discovers test suites at any depth', () => {
    // A temporary tree is used so no permanent fake suites are added to src/tests.
    const temporaryRoots = new Set<string>();

    afterEach(async () => {
      await Promise.all(
        [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })),
      );
      temporaryRoots.clear();
    });

    const withTree = async <T>(callback: (root: string) => Promise<T> | T): Promise<T> => {
      const root = await mkdtemp(resolve(tmpdir(), 'ci-coverage-'));
      temporaryRoots.add(root);
      try {
        await mkdir(resolve(root, 'evaluation/deep'), { recursive: true });
        await writeFile(resolve(root, 'top.test.ts'), '');
        await writeFile(resolve(root, 'evaluation/nested.test.ts'), '');
        await writeFile(resolve(root, 'evaluation/deep/deeper.test.ts'), '');
        await writeFile(resolve(root, 'person-a-test-helpers.ts'), '');
        await writeFile(resolve(root, 'fixture.json'), '{}');
        await writeFile(resolve(root, 'notes.md'), '');
        return await callback(root);
      } finally {
        await rm(root, { recursive: true, force: true });
        temporaryRoots.delete(root);
      }
    };

    it('finds top-level, nested, and multiply nested suites and ignores everything else', async () => {
      await withTree((root) => {
        expect(listTestFilesOnDisk(root)).toEqual([
          'src/tests/evaluation/deep/deeper.test.ts',
          'src/tests/evaluation/nested.test.ts',
          'src/tests/top.test.ts',
        ]);
      });
    });

    it('emits POSIX repository-relative paths regardless of host platform', async () => {
      await withTree((root) => {
        for (const file of listTestFilesOnDisk(root)) {
          expect(file.startsWith('src/tests/')).toBe(true);
          expect(file).not.toContain('\\');
        }
      });
    });

    it('accepts valid nested paths with plus and Unicode filename characters', () => {
      const workflow = [
        '        test_file:',
        '          - src/tests/top.test.ts',
        '          - src/tests/evaluation/deep/deeper.test.ts',
        '          - src/tests/evaluation/cache+http.test.ts',
        '          - src/tests/評価/抽出.test.ts',
      ].join('\n');
      expect(parseMatrixTestFiles(workflow)).toEqual([
        'src/tests/evaluation/cache+http.test.ts',
        'src/tests/evaluation/deep/deeper.test.ts',
        'src/tests/top.test.ts',
        'src/tests/評価/抽出.test.ts',
      ]);
    });

    it('rejects unsafe, outside-directory, malformed, and non-test matrix values', () => {
      const workflow = [
        '        test_file:',
        '          - /src/tests/absolute.test.ts',
        '          - C:/src/tests/windows-absolute.test.ts',
        '          - src/tests//empty.test.ts',
        '          - src/tests/./same.test.ts',
        '          - src/tests/../escape.test.ts',
        '          - tests/outside.test.ts',
        '          - src/other/outside.test.ts',
        '          - src/tests/.test.ts',
        '          - src/tests/helper.ts',
        '          - src/tests/not-a-test.ts',
      ].join('\n');
      expect(parseMatrixTestFiles(workflow)).toEqual([]);
    });

    it('reports a nested suite missing from the matrix', () => {
      expect(
        compareTestMatrixCoverage(
          ['src/tests/top.test.ts', 'src/tests/evaluation/nested.test.ts'],
          ['src/tests/top.test.ts'],
        ).missingFromMatrix,
      ).toEqual(['src/tests/evaluation/nested.test.ts']);
    });

    it('reports a stale nested matrix entry', () => {
      expect(
        compareTestMatrixCoverage(
          ['src/tests/top.test.ts'],
          ['src/tests/top.test.ts', 'src/tests/evaluation/removed.test.ts'],
        ).staleMatrixEntries,
      ).toEqual(['src/tests/evaluation/removed.test.ts']);
    });

    it('removes a temporary tree after a successful callback', async () => {
      let root = '';
      await withTree(async (temporaryRoot) => {
        root = temporaryRoot;
        await expect(access(root)).resolves.toBeUndefined();
      });
      await expect(access(root)).rejects.toThrow();
    });

    it('removes a temporary tree after a thrown callback', async () => {
      let root = '';
      await expect(
        withTree((temporaryRoot) => {
          root = temporaryRoot;
          throw new Error('deliberate callback failure');
        }),
      ).rejects.toThrow('deliberate callback failure');
      await expect(access(root)).rejects.toThrow();
    });
  });

  it('fails when the semantic suite is dropped from the matrix', () => {
    const onDisk = ['src/tests/a.test.ts', 'src/tests/person-a-field-semantics.test.ts'];
    const matrix = ['src/tests/a.test.ts'];
    expect(compareTestMatrixCoverage(onDisk, matrix)).toEqual({
      missingFromMatrix: ['src/tests/person-a-field-semantics.test.ts'],
      staleMatrixEntries: [],
    });
  });

  it('fails when the matrix lists a file that no longer exists', () => {
    expect(
      compareTestMatrixCoverage(
        ['src/tests/a.test.ts'],
        ['src/tests/a.test.ts', 'src/tests/removed.test.ts'],
      ),
    ).toEqual({ missingFromMatrix: [], staleMatrixEntries: ['src/tests/removed.test.ts'] });
  });

  it('is invoked by the required quality-gates job', () => {
    const workflow = readFileSync(
      resolve(import.meta.dirname, '../../.github/workflows/ci.yml'),
      'utf8',
    );
    const qualityJob = workflow.slice(workflow.indexOf('Quality gates'));
    expect(qualityJob).toContain('npm run check:ci-test-coverage');
    // And the semantic suite is still separately present in the matrix.
    expect(parseMatrixTestFiles(workflow)).toContain('src/tests/person-a-field-semantics.test.ts');
  });
});
