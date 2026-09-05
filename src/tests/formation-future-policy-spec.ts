/**
 * TEST-ONLY future policy spec.
 *
 * This is NOT V2.1.5 and NOT a generation. It exists solely to exercise the
 * future policy branches of the shared engine, and it is deliberately named
 * after the POLICY it selects rather than after a version number, so nothing
 * can mistake it for a production generation or start routing to it. 8C2 owns
 * the real generation manifest.
 *
 * `is_current_writer: false` and the isolation guards keep it unroutable: no
 * production module may import this file.
 *
 * Every value that does not participate in the policies under test is copied
 * from the V2.1.4 parity spec on purpose. A fixture that differed in ten ways
 * would make an A/B comparison prove nothing about which difference mattered.
 */

import { assertValidGenerationSpec, type GenerationSpec } from '../formation/generation-spec.js';
import { rawV214Spec } from './formation-v214-parity-spec.js';

const FUTURE_RAW: GenerationSpec = (() => {
  const base = rawV214Spec();
  return {
    ...base,
    identity: {
      ...base.identity,
      generation_id: 'future-multi-live-test-policy',
      display_label: 'Future (test policy)',
      // Never the writer. Nothing routes here.
      is_current_writer: false,
    },
    policy: {
      proposition_cardinality: 'multi_live',
      assertion_requirement_scope: 'all_own_requirements',
    },
    compiler: {
      ...base.compiler,
      contract_version: 'juryai-webmcp-compiler-contract-v0.4.0',
      assertion_cardinality_policy: 'multi_live',
    },
  };
})();

/** A fresh mutable copy, for tests that need raw input to tamper with. */
export function rawFutureSpec(): GenerationSpec {
  return structuredClone(FUTURE_RAW);
}

/** Validated, defensively copied and deeply frozen at module load. */
export const FUTURE_POLICY_SPEC = assertValidGenerationSpec(FUTURE_RAW);
