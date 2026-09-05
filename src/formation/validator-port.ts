/**
 * The engine's view of envelope validation.
 *
 * The shared ceremony depends on this interface only. Concrete validators are
 * generation-specific and are supplied by generation (or, in 8C0a, test-only
 * parity) wiring, so the dependency direction stays:
 *
 *   shared ceremony engine  ->  validator interface
 *   generation/test wiring  ->  concrete validator
 *
 * `src/formation/` must never import a frozen generation's validator. 8C0b
 * supplies the shared, spec-driven implementation of this port; until then the
 * only implementation is the test-only V2.1.4 adapter.
 */

import type { ContractIssue } from './envelope.js';

export interface FormationEnvelopeValidator<E> {
  /** Structural issues, empty when the envelope satisfies its contract. */
  validate(envelope: E): ContractIssue[];
  /** Throws when the envelope is invalid. Never returns a value. */
  assertValid(envelope: E): void;
}
