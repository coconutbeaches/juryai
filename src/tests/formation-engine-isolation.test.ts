/**
 * PR 8C0a isolation guards.
 *
 * The engine exists but production must not depend on it yet. These are
 * structural checks over the source tree rather than behavioural tests,
 * because the property being protected — "nothing in production reaches the
 * new code" — cannot be observed by running the product.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRoot } from './test-helpers.js';
import {
  FORMATION_COMPATIBILITY_CONSTANTS,
  PRODUCTION_ENABLED_ENV_VAR,
  PRODUCTION_START_IDENTITY_DOMAIN,
} from '../compatibility/formation-constants.js';
import { V214_PARITY_SPEC } from './formation-v214-parity-spec.js';

/** Every `.ts` file under a directory, recursively, as repo-relative paths. */
function sourceFiles(relativeDirectory: string): string[] {
  const root = resolve(projectRoot, relativeDirectory);
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

const read = (file: string): string => readFileSync(resolve(projectRoot, file), 'utf8');

/** Directories that must not reach the new engine in 8C0a. */
const PRODUCTION_TREES = [
  'api',
  'src/webmcp/server',
  'src/webmcp/browser',
  'src/v2-1-1',
  'src/v2-1-2',
  'src/v2-1-3',
  'src/v2-1-4',
];

describe('PR 8C0a: production does not depend on the shared engine', () => {
  it.each(PRODUCTION_TREES)('no file under %s imports src/formation/', (tree) => {
    const offenders = sourceFiles(tree).filter((file) => {
      const text = read(file);
      return /from\s+['"][^'"]*\/formation\/[^'"]*['"]/u.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it.each(PRODUCTION_TREES)('no file under %s imports src/compatibility/', (tree) => {
    const offenders = sourceFiles(tree).filter((file) =>
      /from\s+['"][^'"]*\/compatibility\/[^'"]*['"]/u.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('the test-only V2.1.4 parity spec is imported only from src/tests/', () => {
    const offenders = [...PRODUCTION_TREES, 'src/formation', 'src/compatibility']
      .flatMap((tree) => sourceFiles(tree))
      .filter((file) => read(file).includes('formation-v214-parity-spec'));
    expect(offenders).toEqual([]);
  });

  it('the engine never imports a frozen generation implementation', () => {
    const offenders = sourceFiles('src/formation').filter((file) =>
      /from\s+['"][^'"]*\/v2-1-[1-9][^'"]*['"]/u.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('the engine never imports a contract validator directly', () => {
    const offenders = sourceFiles('src/formation').filter((file) =>
      /from\s+['"][^'"]*contract-validator[^'"]*['"]/u.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });
});

describe('PR 8C0a: compatibility constants stay outside the engine', () => {
  it.each(FORMATION_COMPATIBILITY_CONSTANTS)(
    'no file under src/formation/ redeclares %s',
    (constant) => {
      const offenders = sourceFiles('src/formation').filter((file) =>
        read(file).includes(constant),
      );
      expect(offenders).toEqual([]);
    },
  );

  it('no GenerationSpec embeds a compatibility constant', () => {
    const serialized = JSON.stringify(V214_PARITY_SPEC);
    for (const constant of FORMATION_COMPATIBILITY_CONSTANTS) {
      expect(serialized).not.toContain(constant);
    }
  });

  it('a future spec cannot silently redefine one: construction rejects it', async () => {
    const { assertValidGenerationSpec } = await import('../formation/generation-spec.js');
    for (const constant of [PRODUCTION_START_IDENTITY_DOMAIN, PRODUCTION_ENABLED_ENV_VAR]) {
      expect(() =>
        assertValidGenerationSpec({
          ...V214_PARITY_SPEC,
          identity: { ...V214_PARITY_SPEC.identity, generation_id: constant },
        }),
      ).toThrow(/compatibility constant/u);
    }
  });

  it('the compatibility module is the single declaration site', () => {
    // Only the module itself and this guard may contain the literals.
    const allowed = new Set([
      'src/compatibility/formation-constants.ts',
      'src/tests/formation-engine-isolation.test.ts',
    ]);
    const offenders = [...sourceFiles('src/formation'), ...sourceFiles('src/compatibility')].filter(
      (file) =>
        !allowed.has(file) &&
        FORMATION_COMPATIBILITY_CONSTANTS.some((constant) => read(file).includes(constant)),
    );
    expect(offenders).toEqual([]);
  });
});
