/**
 * PR 8C0b-1 — the canary-derived duplicate-live-slot backstop.
 *
 * The frozen production regression case exposed a case-formation gap: a party
 * that has already recorded one narrative fact against a requirement cannot add
 * a second one. Three layers reject that, and the LAST of them is the validator
 * rule pinned here — the admission gate that refuses an envelope holding two
 * live positions in one slot even if every earlier layer were bypassed.
 *
 * That backstop is V2.1.4 semantics, not a defect to fix. 8C1 changes the
 * future generation's slot model; this suite proves the shared validator
 * reproduces the frozen behaviour byte for byte until then.
 *
 * The live dispute is NEVER read or mutated. The fixture is built in memory by
 * driving the frozen implementation, then given a second live position.
 */

import { describe, expect, it } from 'vitest';
import {
  assertValidCaseEnvelopeV214,
  validateCaseEnvelopeV214,
} from '../v2-1-4/contract-validator.js';
import { createFormationValidator } from '../formation/validator.js';
import type { CaseEnvelope } from '../formation/envelope.js';
import { V214_PARITY_SPEC, rawV214Spec } from './formation-v214-parity-spec.js';
import { independentFormationFixture, mutate, unique } from './formation-validator-fixtures.js';

const shared = createFormationValidator({ spec: rawV214Spec() });
const asEngineEnvelope = (envelope: unknown): CaseEnvelope => envelope as CaseEnvelope;

describe('PR 8C0b-1: duplicate live slot, canary-shaped fixture', () => {
  const { envelope, requirementA } = independentFormationFixture();

  it('the base fixture is valid on both implementations', () => {
    expect(validateCaseEnvelopeV214(envelope)).toEqual([]);
    expect(shared.validate(asEngineEnvelope(envelope))).toEqual([]);
  });

  /**
   * A second live narrative fact for the same party and requirement, copied
   * from the first so that provenance, spans and history all remain valid. The
   * ONLY thing wrong with this envelope is that the slot now holds two live
   * positions — which is exactly what the assertion below depends on.
   */
  const duplicated = mutate(envelope, (draft) => {
    const original = Object.values(draft.positions).find(
      (position) =>
        position.attributed_party_id === 'party_a' && position.requirement_id === requirementA,
    )!;
    const secondId = unique('position_party_a');
    draft.positions[secondId] = {
      ...structuredClone(original),
      position_id: secondId,
      statement: 'The contact form and the mobile presentation were also incomplete.',
    };
  });

  it('the fixture reaches the slot rule rather than failing on the stored hash', () => {
    // The hash was restamped, so `envelope_hash_mismatch` cannot be what this
    // fixture proves. Asserted explicitly because a stale-hash decoy is the
    // easiest way for a test like this to pass for the wrong reason.
    const frozen = validateCaseEnvelopeV214(duplicated);
    expect(frozen.map((entry) => entry.code)).not.toContain('v214_envelope_hash_mismatch');
    expect(duplicated.control.envelope_hash).not.toEqual(envelope.control.envelope_hash);
  });

  it('the frozen validator rejects with exactly one issue', () => {
    const slot = `party_a|${requirementA}|narrative_fact`;
    expect(validateCaseEnvelopeV214(duplicated)).toEqual([
      {
        code: 'v214_live_position_slot_duplicate',
        path: 'envelope.positions',
        message: `Duplicate live position slot ${slot}.`,
      },
    ]);
  });

  it('the shared validator produces an identical ContractIssue array', () => {
    expect(shared.validate(asEngineEnvelope(duplicated))).toEqual(
      validateCaseEnvelopeV214(duplicated),
    );
  });

  it('assertValid throws the identical message on both implementations', () => {
    const thrown = (run: () => void): string => {
      try {
        run();
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('Expected the validator to reject this envelope.');
    };
    const frozenMessage = thrown(() => assertValidCaseEnvelopeV214(duplicated));
    const sharedMessage = thrown(() => shared.assertValid(asEngineEnvelope(duplicated)));
    expect(sharedMessage).toBe(frozenMessage);
    expect(frozenMessage).toContain('v214_live_position_slot_duplicate');
  });

  it('a superseded second position in the same slot is accepted by both', () => {
    // The rule is about LIVE positions. A supersession chain puts two positions
    // in one slot legitimately, and a validator that rejected that would break
    // every correction. Pinning the negative case keeps the rule from being
    // over-tightened during extraction.
    const superseded = mutate(envelope, (draft) => {
      const original = Object.values(draft.positions).find(
        (position) =>
          position.attributed_party_id === 'party_a' && position.requirement_id === requirementA,
      )!;
      const secondId = unique('position_party_a');
      draft.positions[secondId] = {
        ...structuredClone(original),
        position_id: secondId,
        supersedes: original.position_id,
        introduced_envelope_version: draft.control.envelope_version,
        last_material_envelope_version: draft.control.envelope_version,
      };
      original.superseded_by = secondId;
      original.superseded_at_envelope_version = draft.control.envelope_version;
      original.last_material_envelope_version = draft.control.envelope_version;
    });
    // The hand-built chain leaves the stored projection hash stale, which both
    // validators report. What matters is that NEITHER reports the slot rule,
    // and that they report exactly the same thing.
    const frozen = validateCaseEnvelopeV214(superseded);
    expect(frozen.map((entry) => entry.code)).not.toContain('v214_live_position_slot_duplicate');
    expect(shared.validate(asEngineEnvelope(superseded))).toEqual(frozen);
  });
});

describe('PR 8C0b-1: the slot rule is policy-gated and fails closed', () => {
  it('the parity spec declares the frozen single-live policy', () => {
    expect(V214_PARITY_SPEC.policy.proposition_cardinality).toBe('single_live_per_slot');
  });

  it('a multi_live spec yields no validator at all', () => {
    // Fail closed at construction: refusing to build is the only outcome that
    // cannot end with a permissive validator wired into something.
    expect(() =>
      createFormationValidator({
        spec: { ...rawV214Spec(), policy: { proposition_cardinality: 'multi_live' } },
      }),
    ).toThrow(/not implemented/u);
  });

  it('multi_live is refused rather than silently skipping the slot rule', () => {
    let built = false;
    try {
      createFormationValidator({
        spec: { ...rawV214Spec(), policy: { proposition_cardinality: 'multi_live' } },
      });
      built = true;
    } catch {
      built = false;
    }
    expect(built).toBe(false);
  });
});
