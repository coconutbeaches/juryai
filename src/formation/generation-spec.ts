/**
 * A GenerationSpec is the complete, explicit description of one formation
 * generation. The shared engine reads every generation-specific value from
 * here and hardcodes none of them.
 *
 * Two rules make this safe, and both are deliberate:
 *
 *  - No optional contract fields and no defaults. A generation must state
 *    every value it uses, so forgetting to bump one is a compile error rather
 *    than a silent inherit. Silent inherits are exactly how a version literal
 *    survives a generation boundary unnoticed.
 *  - No compatibility constants. Values that must NOT move per generation live
 *    in `src/compatibility/formation-constants.ts`. Putting one here would
 *    invite a future generation to regenerate it.
 *
 * Compiler behaviour is stated explicitly rather than inferred from the
 * generation identity: a generation names its compiler contract version and
 * its assertion cardinality policy directly.
 */

import { FORMATION_COMPATIBILITY_CONSTANTS } from '../compatibility/formation-constants.js';

export type PropositionCardinalityPolicy =
  /** At most one live position per (party, requirement, proposition_type). */
  | 'single_live_per_slot'
  /**
   * Multiple live positions per requirement, including identical type and
   * strength. Declared here so specs can be typed against it; NOT implemented
   * in the engine yet.
   */
  | 'multi_live';

export type AssertionCardinalityPolicy =
  /** A compile run may emit at most one assertion per (requirement, type). */
  | 'single_live_per_slot'
  /** A compile run may emit several assertions for one requirement and type. */
  | 'multi_live';

export interface GenerationIdentity {
  readonly generation_id: string;
  readonly envelope_schema_version: string;
  readonly formation_protocol_version: string;
  /** True only for the generation that new starts are written as. */
  readonly is_current_writer: boolean;
}

export interface GenerationContracts {
  readonly command_version: string;
  readonly projection_version: string;
  readonly readback_version: string;
  readonly readiness_version: string;
  readonly confirmation_version: string;
  readonly disclosure_acknowledgment_version: string;
  readonly disclosure_acknowledgment_statement: string;
  readonly external_relay_submission_version: string;
  readonly external_relay_submission_intent_version: string;
  readonly persistence_version: string;
  readonly review_page_version: string;
  readonly protected_action_version: string;
  readonly party_review_state_version: string;
}

export interface GenerationRequirements {
  readonly initial_requirement_set_version: string;
}

export interface GenerationPolicy {
  readonly proposition_cardinality: PropositionCardinalityPolicy;
}

export interface GenerationCompiler {
  readonly contract_version: string;
  readonly taxonomy_version: string;
  readonly assertion_cardinality_policy: AssertionCardinalityPolicy;
}

export interface GenerationAuthority {
  readonly trusted_system_authority_kind: string;
  readonly trusted_external_relay_bridge_kind: string;
  readonly production_invitation_authority_kind: string;
}

export interface GenerationPersistence {
  /** Exact tuple the contract-pair migration and readiness probes assert. */
  readonly contract_pair: {
    readonly envelope_schema_version: string;
    readonly formation_protocol_version: string;
    readonly command_version: string;
    readonly readiness_version: string;
    readonly projection_version: string;
    readonly external_relay_submission_version: string;
  };
}

export interface GenerationDecoding {
  readonly review_page_version: string;
}

export interface GenerationSpec {
  readonly identity: GenerationIdentity;
  readonly contracts: GenerationContracts;
  readonly requirements: GenerationRequirements;
  readonly policy: GenerationPolicy;
  readonly compiler: GenerationCompiler;
  readonly authority: GenerationAuthority;
  readonly persistence: GenerationPersistence;
  readonly decoding: GenerationDecoding;
}

/**
 * Values a spec must never contain, sourced from the single declaration site.
 * The compatibility module owns these; duplicating the literals here would
 * create exactly the second declaration site that drifts.
 */
const FORBIDDEN_SPEC_VALUES: readonly string[] = FORMATION_COMPATIBILITY_CONSTANTS;

/**
 * A spec that has been validated, defensively copied, and deeply frozen.
 *
 * The brand is phantom — declared, never assigned — so a validated spec stays
 * ordinary JSON at runtime while being unforgeable in the type system. The only
 * way to obtain one is `assertValidGenerationSpec`, which is what makes
 * "validated once, immutable thereafter" an invariant the compiler enforces
 * rather than a convention the caller is trusted to follow.
 */
declare const VALIDATED_GENERATION_SPEC: unique symbol;
export type ValidatedGenerationSpec = GenerationSpec & {
  readonly [VALIDATED_GENERATION_SPEC]: true;
};

/** Recursively freezes in place. Applied to a copy, never to caller input. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

export interface GenerationSpecIssue {
  readonly path: string;
  readonly message: string;
}

function walk(value: unknown, path: string, issues: GenerationSpecIssue[]): void {
  if (typeof value === 'string') {
    if (value.trim().length === 0) issues.push({ path, message: 'Value is empty.' });
    if (FORBIDDEN_SPEC_VALUES.includes(value)) {
      issues.push({
        path,
        message: `Cross-generation compatibility constant "${value}" must not appear in a GenerationSpec.`,
      });
    }
    return;
  }
  if (typeof value === 'boolean') return;
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) walk(nested, `${path}.${key}`, issues);
    return;
  }
  issues.push({ path, message: 'Unsupported value in a GenerationSpec.' });
}

/**
 * Structural validation. Catches empty values, forbidden compatibility
 * constants, and a persistence contract_pair that disagrees with the contracts
 * it is supposed to mirror — the disagreement that would make a readiness
 * probe assert a pairing the code never writes.
 */
export function validateGenerationSpec(spec: GenerationSpec): GenerationSpecIssue[] {
  const issues: GenerationSpecIssue[] = [];
  walk(spec, 'spec', issues);

  const pair = spec.persistence.contract_pair;
  const mirrored: [keyof typeof pair, string, string][] = [
    [
      'envelope_schema_version',
      pair.envelope_schema_version,
      spec.identity.envelope_schema_version,
    ],
    [
      'formation_protocol_version',
      pair.formation_protocol_version,
      spec.identity.formation_protocol_version,
    ],
    ['command_version', pair.command_version, spec.contracts.command_version],
    ['readiness_version', pair.readiness_version, spec.contracts.readiness_version],
    ['projection_version', pair.projection_version, spec.contracts.projection_version],
    [
      'external_relay_submission_version',
      pair.external_relay_submission_version,
      spec.contracts.external_relay_submission_version,
    ],
  ];
  for (const [key, actual, expected] of mirrored) {
    if (actual !== expected) {
      issues.push({
        path: `spec.persistence.contract_pair.${String(key)}`,
        message: `Persisted pairing "${actual}" disagrees with the contract this generation writes ("${expected}").`,
      });
    }
  }

  if (spec.decoding.review_page_version !== spec.contracts.review_page_version) {
    issues.push({
      path: 'spec.decoding.review_page_version',
      message: 'Review decoder binding disagrees with the review page contract.',
    });
  }
  return issues;
}

/**
 * Validate, defensively copy, then deeply freeze.
 *
 * The copy matters as much as the freeze: freezing the caller's own object
 * would still leave the engine holding a reference the caller can reason about
 * and, worse, would mutate the caller's input as a side effect of validation.
 * Copying first means a later mutation of the original cannot reach anything
 * the engine closed over.
 */
export function assertValidGenerationSpec(spec: GenerationSpec): ValidatedGenerationSpec {
  const issues = validateGenerationSpec(spec);
  if (issues.length > 0) {
    throw new TypeError(
      `GenerationSpec is invalid: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    );
  }
  return deepFreeze(structuredClone(spec)) as ValidatedGenerationSpec;
}
