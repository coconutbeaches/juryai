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
  /** Human-facing label used in caller-visible messages, e.g. `V2.1.4`. */
  readonly display_label: string;
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
  /**
   * Literal prefix on this generation's contract-issue codes, e.g. `v214_`.
   *
   * Stated, never computed. Deriving it from `identity.generation_id` would
   * make every diagnostic code depend on a string transformation, which is the
   * defect class this whole architecture exists to remove.
   */
  readonly contract_issue_code_prefix: string;
}

export interface GenerationRequirements {
  readonly initial_requirement_set_version: string;
}

/**
 * Which of a party's own requirements a semantic assertion may target.
 *
 * This is interview PACING versus PARSING SCOPE. `in_reply_to_only` ties what
 * can be recorded to what was explicitly asked. `all_own_requirements` lets a
 * volunteered answer land in any own requirement the compiler was given
 * context for — "ask narrowly, listen broadly" — while `in_reply_to` keeps its
 * meaning as what the turn claims to answer, so the provenance distinction
 * between a solicited and a volunteered statement survives.
 *
 * It is NOT derived from the compiler contract version. A generation may
 * legitimately run V0.4's cardinality while keeping strict targeting during a
 * staged rollout, and deriving one policy from another is the silent-inherit
 * pattern this spec design exists to prevent.
 */
export type AssertionRequirementScope =
  /** A requirement may be asserted into only if the source turn named it. */
  | 'in_reply_to_only'
  /** Any own requirement in the compiler-supplied context may be asserted into. */
  | 'all_own_requirements';

export interface GenerationPolicy {
  readonly proposition_cardinality: PropositionCardinalityPolicy;
  readonly assertion_requirement_scope: AssertionRequirementScope;
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
 * What each compiler contract ACTUALLY implements, as opposed to what a spec
 * claims about it.
 *
 * `juryai-webmcp-compiler-contract-v0.3.0` hardcodes
 * `enforceAssertionSlotCardinality = true` and refuses to validate any other
 * contract version, so a spec pairing V0.3 with `multi_live` would be a
 * statement the running code contradicts. Without this table
 * `compiler.assertion_cardinality_policy` is documentation, not a constraint.
 *
 * The map is CLOSED: an unrecognised contract version is rejected rather than
 * assumed compatible. A future contract (8C1's V0.4) must declare its own
 * behaviour here, which is the point — the alternative lets a typo in a
 * version string silently buy an unverified `multi_live` claim.
 */
const COMPILER_CONTRACT_ASSERTION_CARDINALITY: Readonly<
  Record<string, AssertionCardinalityPolicy>
> = Object.freeze({
  'juryai-webmcp-compiler-contract-v0.3.0': 'single_live_per_slot',
  'juryai-webmcp-compiler-contract-v0.4.0': 'multi_live',
});

/**
 * Which requirement scopes each compiler contract can actually serve.
 *
 * V0.3 emits `compiler_requirement_not_answered` whenever an assertion targets
 * a requirement outside `turn.in_reply_to`, so a generation pairing V0.3 with
 * `all_own_requirements` states a policy its compiler refuses to produce. V0.4
 * drops that admission rule, so it can serve either scope — the narrower
 * restriction then comes from the generation policy and the relay, not from
 * the contract.
 *
 * Closed, like the cardinality table: an unrecorded contract cannot be
 * verified and is rejected rather than assumed compatible.
 */
const COMPILER_CONTRACT_REQUIREMENT_SCOPES: Readonly<
  Record<string, readonly AssertionRequirementScope[]>
> = Object.freeze({
  'juryai-webmcp-compiler-contract-v0.3.0': Object.freeze(['in_reply_to_only'] as const),
  'juryai-webmcp-compiler-contract-v0.4.0': Object.freeze([
    'in_reply_to_only',
    'all_own_requirements',
  ] as const),
});

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
declare class ValidatedGenerationSpecBrand {
  // A TypeScript private member is nominal: an object literal — including one
  // produced by spreading a validated spec — can never satisfy it. A symbol-keyed
  // structural brand would survive `{ ...validated, contracts: tampered }` and let
  // an unvalidated, unfrozen object pass as validated.
  declare private readonly validatedGenerationSpec: true;
}
export type ValidatedGenerationSpec = GenerationSpec & ValidatedGenerationSpecBrand;

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

  const implemented = COMPILER_CONTRACT_ASSERTION_CARDINALITY[spec.compiler.contract_version];
  if (implemented === undefined) {
    issues.push({
      path: 'spec.compiler.contract_version',
      message: `Compiler contract "${spec.compiler.contract_version}" has no recorded assertion-cardinality behaviour, so the declared policy cannot be verified.`,
    });
  } else if (implemented !== spec.compiler.assertion_cardinality_policy) {
    issues.push({
      path: 'spec.compiler.assertion_cardinality_policy',
      message: `Compiler contract "${spec.compiler.contract_version}" implements "${implemented}"; a spec cannot declare "${spec.compiler.assertion_cardinality_policy}".`,
    });
  }

  const scopes = COMPILER_CONTRACT_REQUIREMENT_SCOPES[spec.compiler.contract_version];
  if (scopes === undefined) {
    issues.push({
      path: 'spec.compiler.contract_version',
      message: `Compiler contract "${spec.compiler.contract_version}" has no recorded requirement-scope support, so the declared policy cannot be verified.`,
    });
  } else if (!scopes.includes(spec.policy.assertion_requirement_scope)) {
    issues.push({
      path: 'spec.policy.assertion_requirement_scope',
      message: `Compiler contract "${spec.compiler.contract_version}" cannot serve requirement scope "${spec.policy.assertion_requirement_scope}".`,
    });
  }

  if (
    spec.policy.proposition_cardinality === 'multi_live' &&
    spec.compiler.assertion_cardinality_policy !== 'multi_live'
  ) {
    // A generation that admits multiple live propositions but runs a compiler
    // that may emit only one per slot cannot represent the material it claims
    // to accept. The mismatch is silent at runtime, so it is rejected here.
    issues.push({
      path: 'spec.policy.proposition_cardinality',
      message:
        'A multi_live generation requires a compiler whose assertion cardinality is also multi_live.',
    });
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
  // Clone FIRST, then validate the clone, then freeze and return that same
  // clone. Validating the caller's object and cloning afterwards reads it twice:
  // a getter could return a valid value to the validator and a different value
  // to structuredClone, yielding a frozen spec that was never actually valid.
  const copy = structuredClone(spec);
  const issues = validateGenerationSpec(copy);
  if (issues.length > 0) {
    throw new TypeError(
      `GenerationSpec is invalid: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    );
  }
  return deepFreeze(copy) as unknown as ValidatedGenerationSpec;
}
