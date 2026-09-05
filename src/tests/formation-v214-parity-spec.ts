/**
 * TEST-ONLY V2.1.4 compatibility spec and validator adapter.
 *
 * This is a PARITY ORACLE, not a runtime. Production continues to route every
 * V2.1.4 dispute through the frozen `src/v2-1-4/` implementation, and nothing
 * outside `src/tests/` may import this file. `formation-engine-isolation.test.ts`
 * enforces that, and also enforces that no production module imports
 * `src/formation/` at all in 8C0a.
 *
 * Its only job is to let the shared engine be driven with exactly the values
 * V2.1.4 uses, so the two implementations can be compared byte-for-byte. If the
 * engine ever needs a value that is not stated here, that is the signal a
 * generation value is still hardcoded somewhere in the engine.
 *
 * This file is also the ONLY place permitted to adapt the frozen V2.1.4
 * contract validator to the engine's validator port — the engine itself must
 * never import a frozen generation's validator.
 */

import {
  assertValidCaseEnvelopeV214,
  validateCaseEnvelopeV214,
} from '../v2-1-4/contract-validator.js';
import type { CaseEnvelopeV214 } from '../v2-1-4/case-envelope.js';
import type { CaseEnvelope } from '../formation/envelope.js';
import type { FormationEnvelopeValidator } from '../formation/validator-port.js';
import { assertValidGenerationSpec, type GenerationSpec } from '../formation/generation-spec.js';

/**
 * Every value is written as a literal rather than imported from `src/v2-1-4/`.
 * A literal makes an accidental drift between engine and frozen generation show
 * up as a parity failure; importing the constants would hide exactly the class
 * of mistake this PR exists to catch.
 */
export const V214_PARITY_SPEC: GenerationSpec = assertValidGenerationSpec({
  identity: {
    generation_id: 'v2.1.4',
    envelope_schema_version: 'juryai-case-envelope-v2.1.4',
    formation_protocol_version: 'juryai-formation-protocol-v2.1.4',
    // The parity oracle never writes production cases.
    is_current_writer: false,
  },
  contracts: {
    command_version: 'juryai-envelope-command-v2.1.4',
    projection_version: 'juryai-party-formation-projection-v2.1.4',
    readback_version: 'juryai-party-formation-readback-v2.1.4',
    readiness_version: 'juryai-formation-readiness-v2.1.4',
    confirmation_version: 'juryai-party-confirmation-v2.1.4',
    disclosure_acknowledgment_version: 'juryai-disclosure-review-acknowledgment-v2.1.4',
    disclosure_acknowledgment_statement:
      'I have reviewed the currently disclosed case material and have no further challenges to raise at this time.',
    external_relay_submission_version: 'juryai-external-relay-submission-v2.1.4',
    external_relay_submission_intent_version: 'juryai-external-relay-submission-intent-v2.1.1',
    persistence_version: 'juryai-v2.1.4-formation-persistence-v1',
    review_page_version: 'juryai-v2.1.4-first-party-review-page-v1.0.0',
    protected_action_version: 'juryai-party-review-protected-action-v1.3.0',
    party_review_state_version: 'juryai-party-review-state-v1.2.0',
  },
  requirements: {
    // Unchanged from V2.1.4: the multi-proposition work is generation and
    // compiler policy, not a change to any requirement definition.
    initial_requirement_set_version: 'juryai-p2-initial-requirements-v0.4.0',
  },
  policy: {
    proposition_cardinality: 'single_live_per_slot',
  },
  compiler: {
    contract_version: 'juryai-webmcp-compiler-contract-v0.3.0',
    taxonomy_version: 'juryai-p2-v0.3.0',
    assertion_cardinality_policy: 'single_live_per_slot',
  },
  authority: {
    trusted_system_authority_kind: 'trusted_domain_system_v2_1_4',
    trusted_external_relay_bridge_kind: 'trusted_external_relay_bridge_v2_1_4',
    production_invitation_authority_kind: 'trusted_v2_1_4_production_invitation',
  },
  persistence: {
    contract_pair: {
      envelope_schema_version: 'juryai-case-envelope-v2.1.4',
      formation_protocol_version: 'juryai-formation-protocol-v2.1.4',
      command_version: 'juryai-envelope-command-v2.1.4',
      readiness_version: 'juryai-formation-readiness-v2.1.4',
      projection_version: 'juryai-party-formation-projection-v2.1.4',
      external_relay_submission_version: 'juryai-external-relay-submission-v2.1.4',
    },
  },
  decoding: {
    review_page_version: 'juryai-v2.1.4-first-party-review-page-v1.0.0',
  },
});

/**
 * Adapts the frozen V2.1.4 validator to the engine's port. The structural cast
 * is sound because the engine's `CaseEnvelope` differs from `CaseEnvelopeV214`
 * only in that literal-typed version fields are widened to `string`; the
 * runtime shape is identical, which the parity tests then prove.
 */
export const v214ValidatorAdapter: FormationEnvelopeValidator<CaseEnvelope> = {
  validate: (envelope) => validateCaseEnvelopeV214(envelope as unknown as CaseEnvelopeV214),
  assertValid: (envelope) => {
    assertValidCaseEnvelopeV214(envelope as unknown as CaseEnvelopeV214);
  },
};
