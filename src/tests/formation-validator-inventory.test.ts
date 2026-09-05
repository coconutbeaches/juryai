/**
 * PR 8C0b-1 — issue-code inventory.
 *
 * Complete-array parity proves the rules that RUN behave identically. It
 * cannot prove that every rule survived the extraction: a rule quietly dropped
 * simply stops appearing in both the mutation that targeted it and the
 * comparison, and two validators agree that nothing is wrong.
 *
 * So the inventory is checked at the source level. The set of codes the frozen
 * validator can emit and the set the shared validator can emit must be equal —
 * neither a subset nor a superset. A dropped rule fails this suite even if no
 * test mutation happens to target it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRoot } from './test-helpers.js';
import {
  PREFIXED_ISSUE_CODE_SUFFIXES,
  UNPREFIXED_ISSUE_CODES,
  createIssueCodes,
} from '../formation/issue-codes.js';
import { V214_PARITY_SPEC } from './formation-v214-parity-spec.js';

const read = (file: string): string => readFileSync(resolve(projectRoot, file), 'utf8');

const FROZEN = 'src/v2-1-4/contract-validator.ts';
const SHARED = 'src/formation/validator.ts';
const PREFIX = 'v214_';

/** Codes the frozen validator passes to `issue(...)` as a string literal. */
function frozenCodes(): Set<string> {
  return new Set([...read(FROZEN).matchAll(/\bissue\(\s*'([a-z0-9_]+)'/gu)].map((m) => m[1]!));
}

/** Codes the shared validator passes to `issue(...)` via the code vocabulary. */
function sharedCodes(prefix: string): Set<string> {
  const unprefixed = new Set<string>(Object.keys(UNPREFIXED_ISSUE_CODES));
  return new Set(
    [...read(SHARED).matchAll(/\bissue\(\s*codes\.([a-z0-9_]+)/gu)].map((m) =>
      unprefixed.has(m[1]!) ? m[1]! : `${prefix}${m[1]!}`,
    ),
  );
}

const sorted = (values: Iterable<string>): string[] => [...values].sort();

describe('PR 8C0b-1: the shared validator emits exactly the frozen code set', () => {
  it('the frozen validator is the reference and is non-trivially large', () => {
    // A guard on the guard: if the extraction regex ever stopped matching, an
    // empty set would compare equal to an empty set and prove nothing.
    expect(frozenCodes().size).toBeGreaterThan(100);
  });

  it('no frozen code is missing from the shared validator', () => {
    const missing = sorted(frozenCodes()).filter((code) => !sharedCodes(PREFIX).has(code));
    expect(missing).toEqual([]);
  });

  it('the shared validator invents no code the frozen one cannot emit', () => {
    const extra = sorted(sharedCodes(PREFIX)).filter((code) => !frozenCodes().has(code));
    expect(extra).toEqual([]);
  });

  it('the sets are equal', () => {
    expect(sorted(sharedCodes(PREFIX))).toEqual(sorted(frozenCodes()));
  });

  it('the declared vocabulary matches the frozen code set exactly', () => {
    // No unused suffix, and none missing: the vocabulary is an inventory, not
    // a grab bag that silently accumulates dead entries.
    const declared = [
      ...Object.keys(UNPREFIXED_ISSUE_CODES),
      ...PREFIXED_ISSUE_CODE_SUFFIXES.map((suffix) => `${PREFIX}${suffix}`),
    ];
    expect(sorted(declared)).toEqual(sorted(frozenCodes()));
  });

  it('every declared suffix is actually used by the shared validator', () => {
    const used = sharedCodes(PREFIX);
    const unused = PREFIXED_ISSUE_CODE_SUFFIXES.filter((suffix) => !used.has(`${PREFIX}${suffix}`));
    expect(unused).toEqual([]);
  });
});

describe('PR 8C0b-1: the issue-code prefix is a spec literal, never a derivation', () => {
  it('the parity spec states the frozen prefix verbatim', () => {
    expect(V214_PARITY_SPEC.contracts.contract_issue_code_prefix).toBe(PREFIX);
  });

  it('binding the vocabulary to the spec prefix reproduces the frozen codes', () => {
    const codes = createIssueCodes(V214_PARITY_SPEC.contracts.contract_issue_code_prefix);
    expect(sorted(Object.values(codes))).toEqual(sorted(frozenCodes()));
  });

  it('a different prefix renames every generation-scoped code and nothing else', () => {
    const codes = createIssueCodes('v215_');
    expect(codes.live_position_slot_duplicate).toBe('v215_live_position_slot_duplicate');
    // The frozen validator does not prefix this one; nor may any generation.
    expect(codes.duplicate_authenticated_subject).toBe('duplicate_authenticated_subject');
  });

  it('the vocabulary is frozen so a caller cannot retarget a code', () => {
    const codes = createIssueCodes(PREFIX);
    expect(Object.isFrozen(codes)).toBe(true);
    expect(() => {
      (codes as unknown as Record<string, string>).envelope_hash_mismatch = 'anything';
    }).toThrow(TypeError);
  });
});
