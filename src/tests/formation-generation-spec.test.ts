/**
 * PR 8C0a hardening — the validated-spec boundary.
 *
 * `readonly` on an interface is a compile-time claim with no runtime backing:
 * it does not stop a caller mutating the object the engine closed over, and it
 * does not stop a caller skipping validation entirely by passing a raw spec to
 * an exported helper. These tests pin the runtime half of the invariant:
 *
 *   explicit  ->  validated once  ->  immutable thereafter
 */

import { describe, expect, it } from 'vitest';
import {
  assertValidGenerationSpec,
  validateGenerationSpec,
  type GenerationSpec,
} from '../formation/generation-spec.js';
import { createFormationCeremony } from '../formation/ceremony.js';
import { projectPartyFormation } from '../formation/projection.js';
import { deriveFormationReadiness } from '../formation/readiness.js';
import { trustedSystemAuthority } from '../formation/envelope.js';
import {
  V214_PARITY_SPEC,
  rawV214Spec,
  v214ValidatorAdapter,
} from './formation-v214-parity-spec.js';
import {
  PRODUCTION_ENABLED_ENV_VAR,
  PRODUCTION_START_IDENTITY_DOMAIN,
} from '../compatibility/formation-constants.js';

/** Deeply mutable view, so tamper tests can attempt writes the type forbids. */
type DeepMutable<T> = { -readonly [K in keyof T]: T[K] extends object ? DeepMutable<T[K]> : T[K] };
type MutableSpec = DeepMutable<GenerationSpec>;
const mutable = (spec: GenerationSpec): MutableSpec => spec as MutableSpec;

const CASE_ID = 'dispute_spec_hardening_0001';
const INITIAL = {
  party_a: [
    {
      requirement_id: 'req_spec_a',
      label: 'req_spec_a',
      prompt: 'Prompt.',
      required: false,
      satisfying_types: ['narrative_fact'] as const,
      min_propositions: 0,
      max_propositions: null,
      adverse_fact_probe: false,
      reopened_from: null,
    },
  ],
  party_b: [],
};

describe('PR 8C0a: a malformed raw spec is rejected', () => {
  it.each([
    ['an empty contract value', (s: MutableSpec) => (s.contracts.command_version = '')],
    [
      'a compatibility constant in identity',
      (s: MutableSpec) => (s.identity.generation_id = PRODUCTION_START_IDENTITY_DOMAIN),
    ],
    [
      'a compatibility constant in a contract',
      (s: MutableSpec) => (s.contracts.persistence_version = PRODUCTION_ENABLED_ENV_VAR),
    ],
    [
      'a persisted pairing that disagrees with the contracts',
      (s: MutableSpec) =>
        (s.persistence.contract_pair.projection_version =
          'juryai-party-formation-projection-v2.1.3'),
    ],
    [
      'a decoder binding that disagrees with the review page contract',
      (s: MutableSpec) =>
        (s.decoding.review_page_version = 'juryai-v2.1.3-first-party-review-page-v1.0.0'),
    ],
  ])('rejects %s', (_label, corrupt) => {
    const raw = rawV214Spec();
    corrupt(mutable(raw));
    expect(validateGenerationSpec(raw).length).toBeGreaterThan(0);
    expect(() => assertValidGenerationSpec(raw)).toThrow(/GenerationSpec is invalid/u);
  });

  it('accepts the well-formed parity spec', () => {
    expect(validateGenerationSpec(rawV214Spec())).toEqual([]);
  });
});

describe('PR 8C0a: a validated spec is a deeply frozen defensive copy', () => {
  it('is frozen at every level, not just the top', () => {
    const spec = assertValidGenerationSpec(rawV214Spec());
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.identity)).toBe(true);
    expect(Object.isFrozen(spec.contracts)).toBe(true);
    expect(Object.isFrozen(spec.compiler)).toBe(true);
    expect(Object.isFrozen(spec.authority)).toBe(true);
    expect(Object.isFrozen(spec.persistence)).toBe(true);
    // The nested object one level below `persistence` matters most: a shallow
    // freeze would leave exactly this reachable.
    expect(Object.isFrozen(spec.persistence.contract_pair)).toBe(true);
    expect(Object.isFrozen(spec.decoding)).toBe(true);
    expect(Object.isFrozen(spec.requirements)).toBe(true);
    expect(Object.isFrozen(spec.policy)).toBe(true);
  });

  it('is a copy: it does not freeze the caller-supplied object', () => {
    const raw = rawV214Spec();
    const spec = assertValidGenerationSpec(raw);
    expect(spec).not.toBe(raw);
    expect(Object.isFrozen(raw)).toBe(false);
    expect(Object.isFrozen(raw.contracts)).toBe(false);
  });

  it('mutating the original after validation cannot alter the validated spec', () => {
    const raw = rawV214Spec();
    const spec = assertValidGenerationSpec(raw);
    mutable(raw).contracts.projection_version = 'juryai-party-formation-projection-v9.9.9';
    mutable(raw).persistence.contract_pair.command_version = 'juryai-envelope-command-v9.9.9';
    mutable(raw).identity.envelope_schema_version = 'juryai-case-envelope-v9.9.9';
    expect(spec.contracts.projection_version).toBe('juryai-party-formation-projection-v2.1.4');
    expect(spec.persistence.contract_pair.command_version).toBe('juryai-envelope-command-v2.1.4');
    expect(spec.identity.envelope_schema_version).toBe('juryai-case-envelope-v2.1.4');
  });

  it('nested contract values cannot be mutated on the validated object', () => {
    const spec = assertValidGenerationSpec(rawV214Spec());
    const before = spec.contracts.readback_version;
    // Frozen objects ignore writes in sloppy mode and throw in strict mode;
    // either way the value must not change.
    expect(() => {
      (spec.contracts as { readback_version: string }).readback_version = 'tampered';
    }).toThrow();
    expect(spec.contracts.readback_version).toBe(before);

    const pairBefore = spec.persistence.contract_pair.readiness_version;
    expect(() => {
      (spec.persistence.contract_pair as { readiness_version: string }).readiness_version =
        'tampered';
    }).toThrow();
    expect(spec.persistence.contract_pair.readiness_version).toBe(pairBefore);
  });

  it('the exported parity spec is itself validated and frozen', () => {
    expect(Object.isFrozen(V214_PARITY_SPEC)).toBe(true);
    expect(Object.isFrozen(V214_PARITY_SPEC.contracts)).toBe(true);
    expect(Object.isFrozen(V214_PARITY_SPEC.persistence.contract_pair)).toBe(true);
  });
});

describe('PR 8C0a: the engine cannot be re-aimed after construction', () => {
  it('mutating the constructor input does not change ceremony behaviour', () => {
    const raw = rawV214Spec();
    const engine = createFormationCeremony({ spec: raw, validator: v214ValidatorAdapter });
    const before = engine.createInitialCaseEnvelope(CASE_ID, INITIAL as never);
    expect(before.control.projection_contract_version).toBe(
      'juryai-party-formation-projection-v2.1.4',
    );

    // Tamper with the object the caller still holds a reference to.
    mutable(raw).contracts.projection_version = 'juryai-party-formation-projection-v9.9.9';
    mutable(raw).identity.envelope_schema_version = 'juryai-case-envelope-v9.9.9';
    mutable(raw).contracts.command_version = 'juryai-envelope-command-v9.9.9';

    const after = engine.createInitialCaseEnvelope(CASE_ID, INITIAL as never);
    expect(after.control.projection_contract_version).toBe(
      'juryai-party-formation-projection-v2.1.4',
    );
    expect(after.control.schema_version).toBe('juryai-case-envelope-v2.1.4');
    expect(after.control.command_contract_version).toBe('juryai-envelope-command-v2.1.4');
  });

  it('validates once at construction, so a malformed spec never builds an engine', () => {
    const raw = rawV214Spec();
    mutable(raw).contracts.confirmation_version = '';
    expect(() => createFormationCeremony({ spec: raw, validator: v214ValidatorAdapter })).toThrow(
      /GenerationSpec is invalid/u,
    );
  });

  it('a system authority built from a frozen spec still carries the right kind', () => {
    const authority = trustedSystemAuthority(V214_PARITY_SPEC);
    expect(authority.authority_kind).toBe('trusted_domain_system_v2_1_4');
  });
});

describe('PR 8C0a: the trusted system authority is bound to its generation', () => {
  const engine = createFormationCeremony({
    spec: V214_PARITY_SPEC,
    validator: v214ValidatorAdapter,
  });
  const bind = (authority: ReturnType<typeof trustedSystemAuthority>) => {
    const envelope = engine.createInitialCaseEnvelope(CASE_ID, INITIAL as never);
    return engine.applyEnvelopeCeremonyCommand({
      envelope,
      command: engine.ceremonyCommandFor(envelope, 'command_authority_check', {
        type: 'bind_party',
        party_slot: 'party_a',
        authenticated_subject_id: 'subject_authority_check',
        binding_event_id: 'binding_party_a_authority_check',
      } as never),
      execution_authority: authority,
    });
  };

  it('accepts an authority minted from this generation spec', () => {
    expect(bind(trustedSystemAuthority(V214_PARITY_SPEC)).status).toBe('applied');
  });

  it('refuses an authority carrying a different generation label', () => {
    // The brand alone must not be sufficient. Frozen V2.1.4 authorises by
    // singleton identity and so cannot be handed a foreign label at all; the
    // engine must not be weaker than the implementation it replaces.
    const foreign = trustedSystemAuthority({
      authority: { trusted_system_authority_kind: 'trusted_domain_system_v0_0_0' },
    });
    const result = bind(foreign);
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected rejection');
    expect(result.message).toBe('Trusted system authority is required.');
  });

  it('refuses an unbranded look-alike object', () => {
    const forged = {
      actor_type: 'system',
      authority_kind: 'trusted_domain_system_v2_1_4',
    } as unknown as ReturnType<typeof trustedSystemAuthority>;
    expect(bind(forged).status).toBe('rejected');
  });
});

describe('PR 8C0a: validation cannot be skipped by reshaping a validated spec', () => {
  const validEngine = createFormationCeremony({
    spec: V214_PARITY_SPEC,
    validator: v214ValidatorAdapter,
  });
  const validEnvelope = validEngine.createInitialCaseEnvelope(CASE_ID, INITIAL as never);

  it('a spread of a validated spec is not itself validated', () => {
    const tampered = {
      ...V214_PARITY_SPEC,
      contracts: { ...V214_PARITY_SPEC.contracts, command_version: 'tampered' },
    };
    // Runtime proof that the spread really is unvalidated and unfrozen...
    expect(Object.isFrozen(tampered)).toBe(false);
    expect(tampered.contracts.command_version).toBe('tampered');
    // ...and the type system refuses to let it reach a helper. A structural
    // symbol brand would survive the spread and let this compile.
    // @ts-expect-error a spread of a validated spec loses the nominal brand
    deriveFormationReadiness(tampered, validEnvelope);
  });

  it('rejects a spec whose accessors change between validation and copying', () => {
    // Validating the caller's object and cloning afterwards reads it twice; a
    // getter can answer the validator honestly and the clone dishonestly.
    let reads = 0;
    const raw = rawV214Spec();
    const contracts = { ...raw.contracts };
    Object.defineProperty(raw, 'contracts', {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1
          ? contracts
          : { ...contracts, command_version: 'tampered-after-validation' };
      },
    });
    const spec = assertValidGenerationSpec(raw);
    // Whatever the accessor did, the returned spec must be internally consistent.
    expect(spec.contracts.command_version).toBe(spec.persistence.contract_pair.command_version);
    expect(spec.contracts.command_version).toBe('juryai-envelope-command-v2.1.4');
  });
});

describe('PR 8C0a: caller-visible messages follow the generation', () => {
  it('uses the spec display label rather than a hardcoded V2.1.4', () => {
    const raw = rawV214Spec();
    mutable(raw).identity.display_label = 'V9.9.9';
    mutable(raw).identity.generation_id = 'v9.9.9';
    const other = createFormationCeremony({ spec: raw, validator: v214ValidatorAdapter });
    expect(() => other.createInitialCaseEnvelope('not_a_dispute', INITIAL as never)).toThrow(
      /^V9\.9\.9 dispute id is invalid\.$/u,
    );
    const engine = createFormationCeremony({
      spec: V214_PARITY_SPEC,
      validator: v214ValidatorAdapter,
    });
    expect(() => engine.createInitialCaseEnvelope('not_a_dispute', INITIAL as never)).toThrow(
      /^V2\.1\.4 dispute id is invalid\.$/u,
    );
  });
});

describe('PR 8C0a: engine helpers consume the validated boundary', () => {
  const engine = createFormationCeremony({
    spec: V214_PARITY_SPEC,
    validator: v214ValidatorAdapter,
  });
  const envelope = engine.createInitialCaseEnvelope(CASE_ID, INITIAL as never);

  it('accepts a validated spec', () => {
    expect(projectPartyFormation(V214_PARITY_SPEC, envelope, 'party_a').projection_version).toBe(
      'juryai-party-formation-projection-v2.1.4',
    );
    expect(deriveFormationReadiness(V214_PARITY_SPEC, envelope).readiness_version).toBe(
      'juryai-formation-readiness-v2.1.4',
    );
  });

  it('rejects an unvalidated raw spec at the type boundary', () => {
    const raw: GenerationSpec = rawV214Spec();
    // @ts-expect-error a raw GenerationSpec is not a ValidatedGenerationSpec
    projectPartyFormation(raw, envelope, 'party_a');
    // @ts-expect-error a raw GenerationSpec is not a ValidatedGenerationSpec
    deriveFormationReadiness(raw, envelope);
  });
});

/**
 * PR 8C0b-1 — the compiler-policy claim becomes load-bearing.
 *
 * `compiler.assertion_cardinality_policy` was documentation until now: nothing
 * checked it against the contract version the generation actually runs.
 * `juryai-webmcp-compiler-contract-v0.3.0` hardcodes single-slot cardinality
 * and refuses to validate any other contract version, so a spec pairing V0.3
 * with `multi_live` states something the running code contradicts — and the
 * spec is what a future generation would be built from.
 */
describe('PR 8C0b-1: a spec cannot claim compiler behaviour the contract does not implement', () => {
  it('the V2.1.4 parity spec pairs compiler V0.3 with single_live_per_slot', () => {
    expect(V214_PARITY_SPEC.compiler.contract_version).toBe(
      'juryai-webmcp-compiler-contract-v0.3.0',
    );
    expect(V214_PARITY_SPEC.compiler.assertion_cardinality_policy).toBe('single_live_per_slot');
  });

  it('rejects compiler V0.3 declared as multi_live', () => {
    const spec = rawV214Spec();
    const raw: GenerationSpec = {
      ...spec,
      compiler: { ...spec.compiler, assertion_cardinality_policy: 'multi_live' },
    };
    expect(validateGenerationSpec(raw)).toEqual([
      {
        path: 'spec.compiler.assertion_cardinality_policy',
        message:
          'Compiler contract "juryai-webmcp-compiler-contract-v0.3.0" implements "single_live_per_slot"; a spec cannot declare "multi_live".',
      },
    ]);
    expect(() => assertValidGenerationSpec(raw)).toThrow(/cannot declare "multi_live"/u);
  });

  it('rejects an unrecorded compiler contract rather than assuming it is compatible', () => {
    // Fail closed. Allowing unknown versions would let a typo in a contract
    // string buy an entirely unverified cardinality claim, which is exactly the
    // silent-inherit failure this spec design exists to prevent. 8C1's V0.4
    // must state its own behaviour to be usable.
    const spec = rawV214Spec();
    const raw: GenerationSpec = {
      ...spec,
      compiler: { ...spec.compiler, contract_version: 'juryai-webmcp-compiler-contract-v0.4.0' },
    };
    expect(validateGenerationSpec(raw)).toEqual([
      {
        path: 'spec.compiler.contract_version',
        message:
          'Compiler contract "juryai-webmcp-compiler-contract-v0.4.0" has no recorded assertion-cardinality behaviour, so the declared policy cannot be verified.',
      },
    ]);
  });

  it('a near-miss contract version is refused, not silently accepted', () => {
    const spec = rawV214Spec();
    expect(
      validateGenerationSpec({
        ...spec,
        compiler: {
          ...spec.compiler,
          contract_version: 'juryai-webmcp-compiler-contract-v0.3.0 ',
        },
      }),
    ).toHaveLength(1);
  });
});

describe('PR 8C0b-1: the issue-code prefix is part of the spec contract', () => {
  it('a spec missing the prefix does not compile, and an empty one is rejected', () => {
    const spec = rawV214Spec();
    expect(
      validateGenerationSpec({
        ...spec,
        contracts: { ...spec.contracts, contract_issue_code_prefix: '   ' },
      }),
    ).toEqual([{ path: 'spec.contracts.contract_issue_code_prefix', message: 'Value is empty.' }]);
  });

  it('the prefix survives the validated-copy boundary unchanged', () => {
    const validated = assertValidGenerationSpec(rawV214Spec());
    expect(validated.contracts.contract_issue_code_prefix).toBe('v214_');
    expect(Object.isFrozen(validated.contracts)).toBe(true);
  });
});
