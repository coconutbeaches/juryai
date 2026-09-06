/**
 * PR 8C1b-0 structural guards.
 *
 * The oracle's own tests prove it grades correctly. These prove it grades
 * through the right CONTRACT and stays out of production — properties no
 * fixture can demonstrate, and exactly where the wrong-oracle failure hides.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRoot } from './test-helpers.js';
import { COMPILER_V0_3_FROZEN_MANIFEST } from './compiler-v0-3-frozen-manifest.js';
import { HISTORICAL_EVAL_FROZEN_MANIFEST } from './eval-v0-3-frozen-manifest.js';

const read = (file: string): string => readFileSync(resolve(projectRoot, file), 'utf8');

function sourceFiles(relativeDirectory: string): string[] {
  const root = resolve(projectRoot, relativeDirectory);
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const next = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(resolve(directory, entry.name), next);
      else if (entry.isFile() && entry.name.endsWith('.ts')) found.push(next);
    }
  };
  walk(root, relativeDirectory);
  return found.sort();
}

const executableSource = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1');

const PRODUCTION_TREES = [
  'api',
  'src/webmcp/server',
  'src/webmcp/browser',
  'src/v2-1-1',
  'src/v2-1-2',
  'src/v2-1-3',
  'src/v2-1-4',
];

describe('8C1b-0 guards: frozen trees', () => {
  it('the V0.3 compiler manifest is still exact', () => {
    const drifted = Object.entries(COMPILER_V0_3_FROZEN_MANIFEST)
      .filter(([file, hash]) => createHash('sha256').update(read(file)).digest('hex') !== hash)
      .map(([file]) => file);
    expect(drifted).toEqual([]);
  });

  it('the historical evaluator is byte-unchanged', () => {
    const drifted = Object.entries(HISTORICAL_EVAL_FROZEN_MANIFEST)
      .filter(([file, hash]) => createHash('sha256').update(read(file)).digest('hex') !== hash)
      .map(([file]) => file);
    expect(drifted).toEqual([]);
  });

  it('the historical eval manifest still covers that tree', () => {
    expect(sourceFiles('src/webmcp/eval')).toEqual(
      Object.keys(HISTORICAL_EVAL_FROZEN_MANIFEST).sort(),
    );
  });

  it('no V2 generation directory exists', () => {
    expect(existsSync(resolve(projectRoot, 'src/v2-1-5'))).toBe(false);
  });
});

describe('8C1b-0 guards: the V0.4 oracle uses the V0.4 contract', () => {
  const grader = 'src/webmcp/eval-v0-4/graders.ts';

  it('imports validateCompilerOutputV04', () => {
    expect(executableSource(grader)).toMatch(
      /import \{ validateCompilerOutputV04 \} from '\.\.\/core-v0-4\/compiler-contract\.js';/u,
    );
  });

  it('does not use any other contract validator as its gate', () => {
    const source = executableSource(grader);
    // A VALUE import of another validator would be a second gate; the type-only
    // import of CompilerInput/CompilerOutput from core-v0-3 is the shared shape
    // vocabulary and is fine.
    expect(source).not.toMatch(/\bvalidateCompilerOutput\b(?!V04)/u);
    expect(source).not.toMatch(/validateCompilerOutputForContractVersion\b(?!V04)/u);
  });

  it('does not gate on the V0.2-era shape validator', () => {
    // It speaks the V0.2 vocabulary, which has no `explicit_absence`, so it
    // would reject an entire corpus family under a generic "shape" failure.
    expect(executableSource(grader)).not.toContain('compiler-output-shape');
  });

  it('the whole V0.4 eval layer imports no V0.2-era contract', () => {
    const offenders = sourceFiles('src/webmcp/eval-v0-4').filter((file) =>
      /from\s+['"]\.\.\/core\/compiler-contract\.js['"]/u.test(executableSource(file)),
    );
    expect(offenders).toEqual([]);
  });
});

describe('8C1b-0 guards: expectation identity is not requirement+type', () => {
  it('every expected assertion carries its own expectation_id', () => {
    expect(read('src/webmcp/eval-v0-4/types.ts')).toMatch(/expectation_id: string;/u);
  });

  it('no Map or Set is keyed on requirement+type in the V0.4 grader', () => {
    // The historical grader collapses two same-slot expectations into one Map
    // entry, which is the defect this layer exists to avoid. Assertion matching
    // must go through the one-to-one matcher instead.
    const source = executableSource('src/webmcp/eval-v0-4/graders.ts');
    expect(source).not.toMatch(/assertionSlotKey/u);
    expect(source).toContain('matchOneToOne');
    // The only keyed collection permitted is the clarification one, which is
    // genuinely an atomic (requirement, reason) pair.
    const keyed = source.split('\n').filter((line) => /new Map<|new Set\(/u.test(line));
    for (const line of keyed) {
      expect(line).not.toMatch(/requirement_id.*proposed_type/u);
    }
  });
});

describe('8C1b-0 guards: no fuzzy matching, no model calls', () => {
  const FORBIDDEN = [
    /\blevenshtein\b/iu,
    /\bedit_?distance\b/iu,
    /\bembedding/iu,
    /\bcosine\b/iu,
    /\bsimilarity\b/iu,
    /\bfuzzy\b/iu,
    /\bparaphrase\b/iu,
  ];

  it.each(FORBIDDEN.map((pattern) => [String(pattern), pattern] as const))(
    'the V0.4 eval layer contains no %s',
    (_label, pattern) => {
      const offenders = sourceFiles('src/webmcp/eval-v0-4').filter((file) =>
        pattern.test(executableSource(file)),
      );
      expect(offenders).toEqual([]);
    },
  );

  /**
   * Checked as IMPORTS rather than as bare identifiers. A guard that greps for
   * the word "openai" trips on its own source — a false positive that teaches
   * you to loosen the guard, and a loosened guard catches nothing.
   */
  const importsOf = (file: string): string[] =>
    [...executableSource(file).matchAll(/from\s+['"]([^'"]+)['"]/gu)].map((match) => match[1]!);

  // A model client lives INSIDE a compiler package (`compiler-v0-3/...`) or is
  // a provider SDK. `./compiler-v0-3-frozen-manifest.js` is a hash list, not a
  // client, so the trailing slash matters.
  const MODEL_CLIENT_IMPORT = /compiler-v0-[0-9]+\/|model-compiler|openai|anthropic|node:https?/u;

  it('the V0.4 eval layer imports no model client or provider', () => {
    const offenders = sourceFiles('src/webmcp/eval-v0-4').filter((file) =>
      importsOf(file).some((specifier) => MODEL_CLIENT_IMPORT.test(specifier)),
    );
    expect(offenders).toEqual([]);
  });

  it('the oracle self-tests import no model client either', () => {
    for (const file of [
      'src/tests/eval-v0-4-oracle.test.ts',
      'src/tests/eval-v0-4-guards.test.ts',
    ]) {
      expect(importsOf(file).filter((specifier) => MODEL_CLIENT_IMPORT.test(specifier))).toEqual(
        [],
      );
    }
  });
});

describe('8C1b-0 guards: nothing production reaches the V0.4 oracle', () => {
  it.each(PRODUCTION_TREES)('no file under %s imports eval-v0-4', (tree) => {
    const offenders = sourceFiles(tree).filter((file) => read(file).includes('eval-v0-4'));
    expect(offenders).toEqual([]);
  });

  it.each(PRODUCTION_TREES)('no file under %s references compiler contract V0.4', (tree) => {
    const offenders = sourceFiles(tree).filter((file) =>
      /core-v0-4|contract-v0\.4\.0/u.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('the historical evaluator does not import the V0.4 layer', () => {
    const offenders = sourceFiles('src/webmcp/eval').filter((file) =>
      read(file).includes('eval-v0-4'),
    );
    expect(offenders).toEqual([]);
  });
});
