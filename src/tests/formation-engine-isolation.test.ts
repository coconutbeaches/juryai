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
import { V214_PARITY_SPEC, rawV214Spec } from './formation-v214-parity-spec.js';
import { createFormationValidator } from '../formation/validator.js';
import { createIssueCodes } from '../formation/issue-codes.js';

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

/**
 * Strips line and block comments so a guard reads what the code DOES, not what
 * its documentation says about it. Several engine files legitimately mention
 * `V2.1.4` while explaining why they must not contain it.
 */
function executableSource(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

describe('PR 8C0b-1: the issue-code prefix is never derived', () => {
  it('no engine file hardcodes a generation prefix or label', () => {
    const offenders = sourceFiles('src/formation').filter((file) =>
      /v2[._]?1[._]?4/iu.test(executableSource(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('no engine file reads generation_id at all', () => {
    // The only safe relationship between the generation id and the issue-code
    // prefix is none. If nothing reads the id, nothing can transform it.
    const offenders = sourceFiles('src/formation').filter(
      (file) =>
        file !== 'src/formation/generation-spec.ts' &&
        executableSource(file).includes('generation_id'),
    );
    expect(offenders).toEqual([]);
  });

  it('generation-spec.ts only declares generation_id, never transforms it', () => {
    const source = executableSource('src/formation/generation-spec.ts');
    for (const line of source.split('\n').filter((entry) => entry.includes('generation_id'))) {
      expect(line).not.toMatch(/\.(replace|replaceAll|split|slice|substring|match|concat)\(/u);
      expect(line).not.toMatch(/`/u);
    }
  });

  it('the vocabulary factory cannot see anything but the prefix', () => {
    // Structural, not incidental: `createIssueCodes` takes one parameter, so
    // there is no spec, identity or generation id in scope for it to transform.
    expect(createIssueCodes.length).toBe(1);
    const baseline = createIssueCodes(V214_PARITY_SPEC.contracts.contract_issue_code_prefix);
    const reprefixed = createIssueCodes('v299_');
    expect(baseline.envelope_hash_mismatch).toBe('v214_envelope_hash_mismatch');
    expect(reprefixed.envelope_hash_mismatch).toBe('v299_envelope_hash_mismatch');
  });

  it('a spec whose generation id changes still emits the frozen codes', () => {
    const spec = rawV214Spec();
    const validator = createFormationValidator({
      spec: { ...spec, identity: { ...spec.identity, generation_id: 'something-else-entirely' } },
    });
    const issues = validator.validate(null as never);
    expect(issues.map((entry) => entry.code)).toEqual(['v214_envelope_object']);
  });
});

describe('PR 8C0b-1: the shared validator stays out of production', () => {
  it.each(PRODUCTION_TREES)('no file under %s imports the shared validator', (tree) => {
    const offenders = sourceFiles(tree).filter((file) =>
      /from\s+['"][^'"]*\/formation\/(validator|issue-codes)\.js['"]/u.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('the shared validator imports no frozen generation', () => {
    expect(
      /from\s+['"][^'"]*\/v2-1-[1-9][^'"]*['"]/u.test(read('src/formation/validator.ts')),
    ).toBe(false);
  });

  it('the validator fixtures are test-only', () => {
    const offenders = [...PRODUCTION_TREES, 'src/formation', 'src/compatibility']
      .flatMap((tree) => sourceFiles(tree))
      .filter((file) => read(file).includes('formation-validator-fixtures'));
    expect(offenders).toEqual([]);
  });
});

describe('PR 8C0b-2: the shared relay stays out of production', () => {
  it.each(PRODUCTION_TREES)('no file under %s imports the shared relay', (tree) => {
    const offenders = sourceFiles(tree).filter((file) =>
      /from\s+['"][^'"]*\/formation\/relay-(submission|runtime)\.js['"]/u.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('the shared relay imports no frozen generation and no concrete validator', () => {
    for (const file of ['src/formation/relay-submission.ts', 'src/formation/relay-runtime.ts']) {
      expect(/from\s+['"][^'"]*\/v2-1-[1-9][^'"]*['"]/u.test(read(file))).toBe(false);
      expect(/from\s+['"][^'"]*contract-validator[^'"]*['"]/u.test(read(file))).toBe(false);
    }
  });

  it('the relay test wiring and fixtures are test-only', () => {
    const offenders = [...PRODUCTION_TREES, 'src/formation', 'src/compatibility']
      .flatMap((tree) => sourceFiles(tree))
      .filter(
        (file) =>
          read(file).includes('formation-relay-wiring') ||
          read(file).includes('formation-relay-fixtures'),
      );
    expect(offenders).toEqual([]);
  });

  it('the relay bridge is compared by identity, never by authority_kind alone', () => {
    // A structural guard on the highest-risk boundary in the engine. If the
    // `!==` disappears, the trust gate has become a forgeable string check —
    // the 8C0a regression, on the object that controls server-minted IDs.
    const source = executableSource('src/formation/relay-runtime.ts');
    expect(source).toMatch(/candidate\s*!==\s*bridge/u);
  });

  it('the runtime brand is a symbol, so it cannot be rebuilt from JSON', () => {
    const source = executableSource('src/formation/relay-runtime.ts');
    expect(source).toMatch(/Symbol\(/u);
    // A string- or boolean-keyed brand would survive `JSON.parse`, which is
    // exactly what must not happen across the untrusted agent boundary.
    expect(source).not.toMatch(/['"]__brand['"]/u);
  });
});
