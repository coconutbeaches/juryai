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
  RELAY_ISSUE_CODE_SUFFIXES,
  UNPREFIXED_ISSUE_CODES,
  VALIDATOR_ISSUE_CODE_SUFFIXES,
  createIssueCodes,
} from '../formation/issue-codes.js';
import { V214_PARITY_SPEC } from './formation-v214-parity-spec.js';

const read = (file: string): string => readFileSync(resolve(projectRoot, file), 'utf8');

const FROZEN = 'src/v2-1-4/contract-validator.ts';
const SHARED = 'src/formation/validator.ts';
const FROZEN_RELAY = 'src/v2-1-4/external-relay-submission.ts';
const SHARED_RELAY = 'src/formation/relay-submission.ts';
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

/**
 * The relay writes its codes as an object literal `code:` field rather than
 * through `issue(...)`, so it needs its own extractor.
 */
function frozenRelayCodes(): Set<string> {
  return new Set(
    [...read(FROZEN_RELAY).matchAll(/\bcode:\s*'(v214_[a-z0-9_]+)'/gu)].map((m) => m[1]!),
  );
}

function sharedRelayCodes(prefix: string): Set<string> {
  return new Set(
    [...read(SHARED_RELAY).matchAll(/\bcode:\s*codes\.([a-z0-9_]+)/gu)].map(
      (m) => `${prefix}${m[1]!}`,
    ),
  );
}

const sorted = (values: Iterable<string>): string[] => [...values].sort();

/**
 * PR 8C1a adds exactly one code to the validator scope. It is declared here so
 * the "shared validator emits exactly the frozen set" assertions below stay
 * exact statements rather than being loosened into approximations.
 */
const V8C1A_NEW_VALIDATOR_CODES = ['v214_requirement_live_cardinality_exceeded'] as const;

describe('PR 8C1a: the inventory delta is exactly one new code', () => {
  it('the shared validator emits the frozen set plus the multi_live cardinality code', () => {
    const shared = sharedCodes(PREFIX);
    const added = sorted(shared).filter((code) => !frozenCodes().has(code));
    expect(added).toEqual([...V8C1A_NEW_VALIDATOR_CODES]);
  });

  it('no frozen code disappeared', () => {
    const missing = sorted(frozenCodes()).filter((code) => !sharedCodes(PREFIX).has(code));
    expect(missing).toEqual([]);
  });

  it('the relay emits no new code, because it does not enforce cardinality', () => {
    // The relay validates its post-application candidate through the shared
    // validator, so a second effect-local implementation would create two
    // subtly different meanings of `max_propositions`. The inventory describes
    // reality: the new code belongs to the validator scope only.
    const relay = sharedRelayCodes(PREFIX);
    expect(sorted(relay).filter((code) => !frozenRelayCodes().has(code))).toEqual([]);
    expect(relay.has('v214_requirement_live_cardinality_exceeded')).toBe(false);
  });
});

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

  it('the shared validator invents no code beyond the declared 8C1a addition', () => {
    const extra = sorted(sharedCodes(PREFIX)).filter(
      (code) =>
        !frozenCodes().has(code) &&
        !(V8C1A_NEW_VALIDATOR_CODES as readonly string[]).includes(code),
    );
    expect(extra).toEqual([]);
  });

  it('the sets are equal once the declared addition is accounted for', () => {
    expect(sorted(sharedCodes(PREFIX))).toEqual(
      sorted([...frozenCodes(), ...V8C1A_NEW_VALIDATOR_CODES]),
    );
  });

  it('the declared validator vocabulary matches the frozen code set plus the addition', () => {
    // No unused suffix, and none missing: each scope is an inventory, not a
    // grab bag that silently accumulates dead entries. Scoped to the validator
    // because the relay contributes its own suffixes in 8C0b-2.
    const declared = [
      ...Object.keys(UNPREFIXED_ISSUE_CODES),
      ...VALIDATOR_ISSUE_CODE_SUFFIXES.map((suffix) => `${PREFIX}${suffix}`),
    ];
    expect(sorted(declared)).toEqual(sorted([...frozenCodes(), ...V8C1A_NEW_VALIDATOR_CODES]));
  });

  it('every declared validator suffix is actually used by the shared validator', () => {
    const used = sharedCodes(PREFIX);
    const unused = VALIDATOR_ISSUE_CODE_SUFFIXES.filter(
      (suffix) => !used.has(`${PREFIX}${suffix}`),
    );
    expect(unused).toEqual([]);
  });
});

describe('PR 8C0b-1: the issue-code prefix is a spec literal, never a derivation', () => {
  it('the parity spec states the frozen prefix verbatim', () => {
    expect(V214_PARITY_SPEC.contracts.contract_issue_code_prefix).toBe(PREFIX);
  });

  it('binding the vocabulary to the spec prefix reproduces the frozen codes', () => {
    const codes = createIssueCodes(V214_PARITY_SPEC.contracts.contract_issue_code_prefix);
    const union = new Set([...frozenCodes(), ...frozenRelayCodes(), ...V8C1A_NEW_VALIDATOR_CODES]);
    expect(sorted(Object.values(codes))).toEqual(sorted(union));
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

describe('PR 8C0b-2: the shared relay emits exactly the frozen relay code set', () => {
  it('the frozen relay is the reference and is non-trivially large', () => {
    // A guard on the guard: an extractor that stopped matching would compare
    // two empty sets and prove nothing.
    expect(frozenRelayCodes().size).toBeGreaterThanOrEqual(9);
  });

  it('no frozen relay code is missing from the shared relay', () => {
    const missing = sorted(frozenRelayCodes()).filter(
      (code) => !sharedRelayCodes(PREFIX).has(code),
    );
    expect(missing).toEqual([]);
  });

  it('the shared relay invents no code the frozen one cannot emit', () => {
    const extra = sorted(sharedRelayCodes(PREFIX)).filter((code) => !frozenRelayCodes().has(code));
    expect(extra).toEqual([]);
  });

  it('the relay vocabulary matches the frozen relay code set exactly', () => {
    const declared = RELAY_ISSUE_CODE_SUFFIXES.map((suffix) => `${PREFIX}${suffix}`);
    expect(sorted(declared)).toEqual(sorted(frozenRelayCodes()));
  });

  it('the combined vocabulary is the union of both frozen scopes, de-duplicated', () => {
    // `explicit_absence_source` is emitted by BOTH frozen modules with
    // different messages, so the union must contain it exactly once.
    const union = new Set([...frozenCodes(), ...frozenRelayCodes(), ...V8C1A_NEW_VALIDATOR_CODES]);
    const declared = [
      ...Object.keys(UNPREFIXED_ISSUE_CODES),
      ...PREFIXED_ISSUE_CODE_SUFFIXES.map((suffix) => `${PREFIX}${suffix}`),
    ];
    expect(sorted(declared)).toEqual(sorted(union));
    expect(new Set(declared).size).toBe(declared.length);
    expect(VALIDATOR_ISSUE_CODE_SUFFIXES).toContain('explicit_absence_source');
    expect(RELAY_ISSUE_CODE_SUFFIXES).toContain('explicit_absence_source');
  });

  it('every declared relay suffix is actually used by the shared relay', () => {
    const used = sharedRelayCodes(PREFIX);
    const unused = RELAY_ISSUE_CODE_SUFFIXES.filter((suffix) => !used.has(`${PREFIX}${suffix}`));
    expect(unused).toEqual([]);
  });
});
