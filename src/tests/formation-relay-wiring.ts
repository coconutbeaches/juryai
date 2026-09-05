/**
 * TEST-ONLY wiring of the shared relay for the V2.1.4 parity spec.
 *
 * Assembles the three collaborators the relay factory needs — the once-
 * validated spec, the shared validator merged in 8C0b-1, and the ceremony's
 * party-cursor refresh — so every parity suite drives the same instance and no
 * suite can accidentally construct a differently-wired relay.
 *
 * Nothing outside `src/tests/` may import this; `formation-engine-isolation`
 * enforces that, and also enforces that no production module reaches the
 * shared relay at all in 8C0b-2.
 */

import { createFormationCeremony } from '../formation/ceremony.js';
import { createFormationValidator } from '../formation/validator.js';
import { createFormationRelay } from '../formation/relay-submission.js';
import type { CaseEnvelope } from '../formation/envelope.js';
import type { CaseEnvelopeV214 } from '../v2-1-4/case-envelope.js';
import { rawV214Spec } from './formation-v214-parity-spec.js';
import { rawFutureSpec } from './formation-future-policy-spec.js';

/** Builds an independent relay instance from the V2.1.4-compatible spec. */
export function buildV214Relay() {
  const validator = createFormationValidator({ spec: rawV214Spec() });
  const ceremony = createFormationCeremony({ spec: rawV214Spec(), validator });
  return createFormationRelay({
    spec: rawV214Spec(),
    validator,
    cursors: ceremony.refreshPartyViewCursors,
  });
}

/** Builds an independent relay instance from the TEST-ONLY future spec. */
export function buildFutureRelay() {
  const validator = createFormationValidator({ spec: rawFutureSpec() });
  const ceremony = createFormationCeremony({ spec: rawFutureSpec(), validator });
  return createFormationRelay({
    spec: rawFutureSpec(),
    validator,
    cursors: ceremony.refreshPartyViewCursors,
  });
}

/** The instance every parity suite shares. */
export const V214_RELAY = buildV214Relay();

/**
 * The future-policy instance the A/B matrix drives. Same wiring, same
 * collaborators, different policy — so a difference in outcome can only come
 * from the policy.
 */
export const FUTURE_RELAY = buildFutureRelay();

/**
 * The engine's `CaseEnvelope` differs from `CaseEnvelopeV214` only in that
 * literal-typed version fields are widened to `string`; the runtime shape is
 * identical, which the parity comparisons then prove byte-for-byte.
 */
export const asEngine = (envelope: CaseEnvelopeV214): CaseEnvelope =>
  envelope as unknown as CaseEnvelope;
