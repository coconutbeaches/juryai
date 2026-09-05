/**
 * The trusted-relay trust boundary, extracted from frozen V2.1.4.
 *
 * This is the single most security-sensitive object in the relay path: a
 * runtime carries the server-derived receipt time, the payload commitment salt
 * and every server-minted canonical identifier. Whatever can mint one can
 * choose those values.
 *
 * PR 8C0a produced a High-severity regression by "generalising" exactly this
 * kind of gate — a singleton identity comparison became a branded-string
 * comparison, and a fabricated authority bound a party. The rules below exist
 * so that cannot recur:
 *
 *  1. The bridge is a per-factory FROZEN SINGLETON compared with `!==`.
 *     `authority_kind` is checked as defence in depth and NEVER as a
 *     replacement — a string comparison is forgeable by construction.
 *  2. The runtime brand is a SYMBOL, so it cannot be reconstructed from JSON.
 *     This is what stops an untrusted agent's decoded payload from becoming a
 *     runtime, and it is the property the parity tests pin.
 *
 * MEASURED, INHERITED BEHAVIOUR — see `formation-relay-runtime-parity.test.ts`.
 * Frozen V2.1.4 was probed empirically before this extraction was written:
 *
 *  - a foreign bridge carrying the identical `authority_kind` string THROWS;
 *  - a JSON round-tripped runtime is REJECTED (no symbol survives);
 *  - `{ ...runtime }` KEEPS the brand, and the copy is NOT frozen, so a
 *    tampered `received_at` or `payload_commitment_salt` is ACCEPTED and
 *    persisted;
 *  - `Object.create(runtime)` with a shadowed field is likewise ACCEPTED,
 *    because `symbol in value` walks the prototype chain;
 *  - an opponent-scoped identifier is still REJECTED, by ID scoping rather
 *    than by the brand.
 *
 * So the brand proves IN-PROCESS ORIGIN, not integrity of the values carried.
 * That is weaker than it looks, and this PR reproduces it EXACTLY rather than
 * hardening it: a parity extraction that silently tightened a trust boundary
 * would be an unannounced semantic change, and the whole point of this PR is
 * that the shared engine behaves as V2.1.4 does. The hardening is recorded as
 * its own checkpoint.
 */

import type { SourceChannel } from '../webmcp/core-v0-3/types.js';
import type { ValidatedGenerationSpec } from './generation-spec.js';

export interface ExternalRelayCanonicalIds {
  submission_id: string;
  source_turn_id: string;
  position_ids: string[];
  clarification_ids: string[];
  challenge_ids: string[];
  challenge_response_ids: string[];
}

export interface TrustedExternalRelayBridge {
  readonly authority_kind: string;
}

export interface TrustedExternalRelayRuntime {
  readonly source_channel: SourceChannel;
  readonly relaying_agent: string | null;
  readonly received_at: string;
  readonly payload_commitment_salt: string;
  readonly ids: ExternalRelayCanonicalIds;
}

export type RelayRuntimeInput = Omit<TrustedExternalRelayRuntime, never>;

export interface RelayRuntimeMinter {
  /** The only object this factory will mint a runtime from. */
  readonly bridge: TrustedExternalRelayBridge;
  mintRuntime(
    bridge: TrustedExternalRelayBridge,
    input: RelayRuntimeInput,
  ): TrustedExternalRelayRuntime;
  isOwnRuntime(value: unknown): value is TrustedExternalRelayRuntime;
}

/**
 * Builds the runtime minter for one relay factory.
 *
 * The brand symbol is created PER FACTORY rather than per module. Frozen
 * V2.1.4 has one module-level brand because it has exactly one relay; the
 * shared engine can have several, and a runtime minted for one generation must
 * not be usable by another.
 *
 * A per-factory symbol achieves that while preserving parity, because a
 * symbol-keyed own enumerable property is still copied by object spread — so
 * the measured spread behaviour above is unchanged. A WeakSet of minted
 * objects would also isolate factories, but it would REJECT the spread copy
 * that frozen V2.1.4 accepts, i.e. it would silently harden the boundary.
 * Isolation must not be bought with a parity break.
 */
export function createRelayRuntimeMinter(spec: ValidatedGenerationSpec): RelayRuntimeMinter {
  // Uniqueness comes from `Symbol()` itself, never from the generation id.
  // Interpolating the id would make the brand look derived from it, which is
  // the relationship the isolation guards exist to forbid.
  const brand: unique symbol = Symbol('juryai-formation-relay-runtime') as symbol as never;

  const bridge: TrustedExternalRelayBridge = Object.freeze({
    authority_kind: spec.authority.trusted_external_relay_bridge_kind,
  });

  return {
    bridge,
    mintRuntime(candidate, input) {
      // IDENTITY FIRST. This comparison is the actual gate; everything after
      // it is redundancy. Replacing it with a value check would make the
      // boundary forgeable by any caller that can spell the right string.
      if (candidate !== bridge) {
        throw new TypeError('Trusted external relay bridge is required.');
      }
      // Defence in depth only. Unreachable unless `bridge` itself was built
      // wrong; kept so a future refactor that loosens the identity check still
      // fails closed rather than silently opening.
      if (candidate.authority_kind !== spec.authority.trusted_external_relay_bridge_kind) {
        throw new TypeError('Trusted external relay bridge is required.');
      }
      return Object.freeze({ ...input, [brand]: true as const });
    },
    isOwnRuntime(value): value is TrustedExternalRelayRuntime {
      return (
        typeof value === 'object' &&
        value !== null &&
        brand in value &&
        (value as Record<symbol, unknown>)[brand] === true
      );
    },
  };
}
