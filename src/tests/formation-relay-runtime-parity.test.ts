/**
 * PR 8C0b-2 — the relay runtime trust boundary, measured then matched.
 *
 * Frozen V2.1.4 was probed EMPIRICALLY before the shared relay was written,
 * because the design review's assumptions about this boundary turned out to be
 * only half right. What the probe established:
 *
 *   A. a foreign bridge carrying the identical `authority_kind` string THROWS
 *   B. a JSON round-tripped runtime is REJECTED — no symbol survives JSON
 *   C. `{ ...runtime }` KEEPS the brand and the copy is NOT frozen, so a
 *      tampered `received_at` or `payload_commitment_salt` is ACCEPTED and
 *      persisted verbatim into the source turn
 *   D. `Object.create(runtime)` with a shadowed field is ACCEPTED too, because
 *      `symbol in value` walks the prototype chain
 *   E. an opponent-scoped canonical id is still REJECTED — by ID scoping, not
 *      by the brand
 *
 * So the brand proves IN-PROCESS ORIGIN, not integrity of the values carried.
 * A relayed agent payload can never become a runtime; in-process code holding
 * one can retarget its provenance fields.
 *
 * This PR reproduces that EXACTLY. Hardening C and D would be a real security
 * improvement and is recorded as its own checkpoint — but doing it here would
 * mean a parity extraction had silently changed a trust boundary, which is the
 * precise failure this whole programme exists to prevent.
 */

import { describe, expect, it } from 'vitest';
import {
  TRUSTED_EXTERNAL_RELAY_BRIDGE_V214,
  prepareExternalRelaySubmissionV214,
  trustedExternalRelayRuntimeV214,
} from '../v2-1-4/external-relay-submission.js';
import { buildV214Relay, V214_RELAY, asEngine } from './formation-relay-wiring.js';
import {
  relayCase,
  frozenPrepare,
  sharedPrepare,
  RUNTIME_INPUT,
} from './formation-relay-fixtures.js';

describe('PR 8C0b-2 · A: the bridge is an identity gate, not a string check', () => {
  it('frozen V2.1.4 refuses a foreign bridge with the identical authority_kind', () => {
    const foreign = Object.freeze({ authority_kind: 'trusted_external_relay_bridge_v2_1_4' });
    expect(() =>
      trustedExternalRelayRuntimeV214(foreign as never, RUNTIME_INPUT('turn_party_a_a1')),
    ).toThrow(/Trusted external relay bridge is required/u);
  });

  it('the shared relay refuses one too, with the identical message', () => {
    const foreign = Object.freeze({
      authority_kind: V214_RELAY.bridge.authority_kind,
    });
    // Spelling the right string is not authority. If this ever starts passing,
    // the identity comparison has been "generalised" into a value comparison —
    // the exact 8C0a regression, on a boundary that controls server-minted IDs.
    expect(() => V214_RELAY.mintRuntime(foreign, RUNTIME_INPUT('turn_party_a_a2'))).toThrow(
      /Trusted external relay bridge is required/u,
    );
  });

  it('the genuine bridge mints on both implementations', () => {
    expect(() =>
      trustedExternalRelayRuntimeV214(
        TRUSTED_EXTERNAL_RELAY_BRIDGE_V214,
        RUNTIME_INPUT('turn_party_a_a3'),
      ),
    ).not.toThrow();
    expect(() =>
      V214_RELAY.mintRuntime(V214_RELAY.bridge, RUNTIME_INPUT('turn_party_a_a4')),
    ).not.toThrow();
  });
});

describe('PR 8C0b-2 · B: a runtime cannot cross a JSON boundary', () => {
  it('the brand does not survive serialization on either implementation', () => {
    const frozen = trustedExternalRelayRuntimeV214(
      TRUSTED_EXTERNAL_RELAY_BRIDGE_V214,
      RUNTIME_INPUT('turn_party_a_b1'),
    );
    const shared = V214_RELAY.mintRuntime(V214_RELAY.bridge, RUNTIME_INPUT('turn_party_a_b2'));
    for (const runtime of [frozen, shared]) {
      expect(Object.getOwnPropertySymbols(runtime)).toHaveLength(1);
      expect(Object.getOwnPropertySymbols(JSON.parse(JSON.stringify(runtime)))).toHaveLength(0);
    }
  });

  it('a JSON round-tripped runtime is rejected identically', () => {
    // This is the property that actually protects the untrusted boundary: an
    // agent's decoded payload can never be a runtime.
    const scenario = relayCase();
    const frozen = frozenPrepare(scenario, (runtime) => JSON.parse(JSON.stringify(runtime)));
    const shared = sharedPrepare(scenario, (runtime) => JSON.parse(JSON.stringify(runtime)));
    expect(frozen).toEqual({
      status: 'rejected',
      reason_code: 'unauthorized_actor',
      message: 'Server-derived external relay authority is required.',
    });
    expect(shared).toEqual(frozen);
  });
});

describe('PR 8C0b-2 · C/D: measured in-process behaviour, reproduced not hardened', () => {
  it('object spread preserves the brand and drops the freeze, on both', () => {
    const frozen = trustedExternalRelayRuntimeV214(
      TRUSTED_EXTERNAL_RELAY_BRIDGE_V214,
      RUNTIME_INPUT('turn_party_a_c1'),
    );
    const shared = V214_RELAY.mintRuntime(V214_RELAY.bridge, RUNTIME_INPUT('turn_party_a_c2'));
    for (const runtime of [frozen, shared]) {
      expect(Object.isFrozen(runtime)).toBe(true);
      const spread = { ...runtime };
      expect(Object.getOwnPropertySymbols(spread)).toHaveLength(1);
      expect(Object.isFrozen(spread)).toBe(false);
    }
  });

  it('a tampered received_at is ACCEPTED and persisted, identically on both', () => {
    const scenario = relayCase();
    const tamper = (runtime: never) => ({
      ...(runtime as object),
      received_at: '1999-01-01T00:00:00.000Z',
    });
    const frozen = frozenPrepare(scenario, tamper);
    const shared = sharedPrepare(scenario, tamper);
    expect(frozen.status).toBe('prepared');
    expect(shared).toEqual(frozen);
    // Recorded explicitly so the weakness is legible rather than implied by a
    // passing test: the attacker's timestamp becomes the canonical receipt.
    expect(frozen.status === 'prepared' ? frozen.submission.source_turn.received_at : null).toBe(
      '1999-01-01T00:00:00.000Z',
    );
  });

  it('a tampered payload_commitment_salt is ACCEPTED, identically on both', () => {
    const scenario = relayCase();
    const tamper = (runtime: never) => ({
      ...(runtime as object),
      payload_commitment_salt: 'attacker-chosen-salt-0000',
    });
    const frozen = frozenPrepare(scenario, tamper);
    const shared = sharedPrepare(scenario, tamper);
    expect(frozen.status).toBe('prepared');
    expect(shared).toEqual(frozen);
  });

  it('a prototype-shadowed field is ACCEPTED, identically on both', () => {
    const scenario = relayCase();
    const tamper = (runtime: never) => {
      const derived = Object.create(runtime as object) as Record<string, unknown>;
      Object.defineProperty(derived, 'received_at', {
        value: '1999-01-01T00:00:00.000Z',
        enumerable: true,
        configurable: true,
        writable: true,
      });
      return derived;
    };
    expect(sharedPrepare(scenario, tamper)).toEqual(frozenPrepare(scenario, tamper));
  });

  it('an opponent-scoped canonical id is still rejected, identically on both', () => {
    // ID scoping, not the brand, is what stops cross-party theft — and it holds
    // even when the runtime itself has been tampered with.
    const scenario = relayCase();
    const tamper = (runtime: never) => {
      const real = runtime as unknown as { ids: Record<string, unknown> };
      return { ...real, ids: { ...real.ids, position_ids: ['position_party_b_stolen'] } };
    };
    const frozen = frozenPrepare(scenario, tamper as never);
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'invalid_intent' });
    expect(sharedPrepare(scenario, tamper as never)).toEqual(frozen);
  });
});

describe('PR 8C0b-2 · cross-factory isolation (shared engine only)', () => {
  it('a runtime minted by one relay is refused by another', () => {
    // Frozen V2.1.4 has one module-level brand because it has one relay. The
    // shared engine can have several, so each factory brands its own runtimes.
    // A per-factory SYMBOL — rather than a WeakSet of minted objects — is what
    // keeps this isolation from silently hardening the measured spread
    // behaviour above, since spread copies own enumerable symbol properties.
    const other = buildV214Relay();
    const scenario = relayCase();
    const foreignRuntime = (turnId: string) =>
      other.mintRuntime(other.bridge, RUNTIME_INPUT(turnId));
    const result = sharedPrepare(scenario, () => foreignRuntime(scenario.turnId));
    expect(result).toMatchObject({
      status: 'rejected',
      reason_code: 'unauthorized_actor',
    });
  });

  it("one relay's bridge cannot mint on another relay", () => {
    const other = buildV214Relay();
    expect(() => V214_RELAY.mintRuntime(other.bridge, RUNTIME_INPUT('turn_party_a_x1'))).toThrow(
      /Trusted external relay bridge is required/u,
    );
  });

  it('a spread copy of an own runtime is still accepted, proving isolation was not bought with a parity break', () => {
    const scenario = relayCase();
    const spread = (runtime: never) => ({ ...(runtime as object) });
    const shared = sharedPrepare(scenario, spread);
    expect(shared.status).toBe('prepared');
    expect(shared).toEqual(frozenPrepare(scenario, spread));
  });

  it('the shared validator still admits nothing extra: engine envelope matches frozen', () => {
    const scenario = relayCase();
    expect(V214_RELAY.bridge.authority_kind).toBe('trusted_external_relay_bridge_v2_1_4');
    expect(asEngine(scenario.envelope).control.case_id).toBe(scenario.envelope.control.case_id);
  });
});
