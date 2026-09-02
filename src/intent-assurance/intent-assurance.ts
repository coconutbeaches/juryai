import {
  canonicalSerialize,
  cloneCanonical,
  sha256,
  type ContractIssue,
  type JsonValue,
} from '../v2/case-envelope.js';

export const HUMAN_HANDOFF_CHALLENGE_VERSION_V1 = 'juryai-human-handoff-challenge-v1.0.0';
export const INTENT_ASSURANCE_RECEIPT_VERSION_V1 = 'juryai-intent-assurance-receipt-v1.0.0';
export const INTENT_ASSURANCE_POLICY_VERSION_V1 = 'juryai-intent-assurance-policy-v1.0.0';
export const INTENT_ASSURANCE_CONSUMPTION_VERSION_V1 = 'juryai-intent-assurance-consumption-v1.0.0';

export const INTENT_ASSURANCE_LEVELS_V1 = ['HHC-0', 'HHC-1', 'HHC-2', 'HHC-3', 'HHC-4'] as const;
export type IntentAssuranceLevelV1 = (typeof INTENT_ASSURANCE_LEVELS_V1)[number];

export const INTENT_ASSURANCE_METHODS_V1 = [
  'agent_assertion',
  'fresh_user_phrase',
  'mcp_elicitation',
  'platform_native_approval',
  'first_party_ceremony',
  'webauthn_user_verification',
] as const;
export type IntentAssuranceMethodV1 = (typeof INTENT_ASSURANCE_METHODS_V1)[number];

export const INTENT_ASSURANCE_ACTIONS_V1 = [
  'join_dispute',
  'confirm_case_account',
  'reopen_confirmed_material',
  'agree_binding_treatment',
  'authorize_settlement',
  'release_settlement_funds',
  'test_only_protected_action',
] as const;
export type IntentAssuranceActionV1 = (typeof INTENT_ASSURANCE_ACTIONS_V1)[number];
export type IntentAssurancePartyIdV1 = 'party_a' | 'party_b';

export interface IntentAssuranceAxesV1 {
  contactability: 'not_assessed' | 'contact_channel_observed' | 'verified_contact_channel';
  account_control:
    | 'not_assessed'
    | 'authenticated_session_observed'
    | 'first_party_session_observed'
    | 'credential_user_verified';
  explicit_intent:
    | 'not_established'
    | 'fresh_expression_observed'
    | 'client_mediated_approval'
    | 'first_party_ceremony_observed'
    | 'cryptographic_challenge_approval';
  real_world_identity_authority:
    'not_assessed' | 'identity_evidence_observed' | 'identity_verified';
  physical_human_presence:
    'not_proven' | 'authenticator_user_presence' | 'authenticator_user_verification';
  repudiation_resistance:
    'none' | 'weak' | 'client_recorded' | 'server_verifiable' | 'cryptographically_verifiable';
}

export interface IntentAssuranceProtocolProfileV1 {
  policy_version: typeof INTENT_ASSURANCE_POLICY_VERSION_V1;
  profile_id: string;
  minimum_assurance_by_action: Record<IntentAssuranceActionV1, IntentAssuranceLevelV1>;
}

export interface IntentAssurancePolicyDecisionV1 {
  policy_version: typeof INTENT_ASSURANCE_POLICY_VERSION_V1;
  profile_id: string;
  requested_action: IntentAssuranceActionV1;
  required_minimum_assurance: IntentAssuranceLevelV1;
}

export interface IntentAssuranceStateBindingV1 {
  authenticated_subject_id: string;
  dispute_id: string;
  party_id: IntentAssurancePartyIdV1;
  party_projection_contract_version: string;
  party_projection_hash: string;
  party_visible_version: number;
  formation_epoch: number | null;
}

export type HumanHandoffChallengeStatusV1 = 'pending' | 'satisfied' | 'consumed' | 'invalidated';
export type HumanHandoffInvalidationReasonV1 =
  | 'state_changed'
  | 'party_binding_changed'
  | 'superseded'
  | 'expired'
  | 'cancelled'
  | 'policy_changed';

export interface HumanHandoffChallengeV1 {
  challenge_version: typeof HUMAN_HANDOFF_CHALLENGE_VERSION_V1;
  challenge_id: string;
  authenticated_subject_id: string;
  dispute_id: string;
  party_id: IntentAssurancePartyIdV1;
  requested_action: IntentAssuranceActionV1;
  action_payload_hash: string;
  policy_version: typeof INTENT_ASSURANCE_POLICY_VERSION_V1;
  policy_profile_id: string;
  party_projection_contract_version: string;
  party_projection_hash: string;
  party_visible_version: number;
  formation_epoch: number | null;
  required_minimum_assurance: IntentAssuranceLevelV1;
  permitted_methods: IntentAssuranceMethodV1[];
  public_reference: string;
  expected_fresh_expression_hash: string | null;
  issued_at: string;
  expires_at: string;
  status: HumanHandoffChallengeStatusV1;
  satisfied_at: string | null;
  satisfied_by_receipt_id: string | null;
  consumed_at: string | null;
  consumed_by_consumption_id: string | null;
  invalidated_at: string | null;
  invalidation_reason: HumanHandoffInvalidationReasonV1 | null;
}

export interface IntentAssuranceInteractionProvenanceV1 {
  channel: 'agent_relay' | 'mcp_client' | 'platform_client' | 'freejury_first_party' | 'webauthn';
  claim_source:
    'agent_claim' | 'client_claim' | 'juryai_server_observation' | 'trusted_webauthn_verifier';
  interaction_id: string;
  host_id: string | null;
  host_provenance:
    'unverified' | 'client_asserted' | 'server_observed' | 'cryptographically_verified';
}

export interface IntentAssuranceReceiptV1 {
  receipt_version: typeof INTENT_ASSURANCE_RECEIPT_VERSION_V1;
  receipt_id: string;
  challenge_version: typeof HUMAN_HANDOFF_CHALLENGE_VERSION_V1;
  challenge_id: string;
  authenticated_subject_id: string;
  dispute_id: string;
  party_id: IntentAssurancePartyIdV1;
  requested_action: IntentAssuranceActionV1;
  action_payload_hash: string;
  policy_version: typeof INTENT_ASSURANCE_POLICY_VERSION_V1;
  policy_profile_id: string;
  party_projection_contract_version: string;
  party_projection_hash: string;
  party_visible_version: number;
  formation_epoch: number | null;
  method: IntentAssuranceMethodV1;
  achieved_assurance: IntentAssuranceLevelV1;
  required_minimum_assurance: IntentAssuranceLevelV1;
  assurance_axes: IntentAssuranceAxesV1;
  interaction_provenance: IntentAssuranceInteractionProvenanceV1;
  verifier_adapter_id: string;
  evidence_reference: string;
  evidence_commitment: string;
  challenge_issued_at: string;
  completed_at: string;
  authorization_status: 'available' | 'consumed';
  consumed_at: string | null;
  consumption_id: string | null;
}

export interface IntentAssuranceConsumptionV1 {
  consumption_version: typeof INTENT_ASSURANCE_CONSUMPTION_VERSION_V1;
  consumption_id: string;
  receipt_id: string;
  challenge_id: string;
  authenticated_subject_id: string;
  dispute_id: string;
  party_id: IntentAssurancePartyIdV1;
  requested_action: IntentAssuranceActionV1;
  action_payload_hash: string;
  party_projection_contract_version: string;
  party_projection_hash: string;
  party_visible_version: number;
  formation_epoch: number | null;
  consumed_at: string;
}

const ISSUER_AUTHORITY_BRAND_V1: unique symbol = Symbol('juryai-intent-assurance-issuer-v1');
const STATE_RESOLVER_AUTHORITY_BRAND_V1: unique symbol = Symbol(
  'juryai-intent-assurance-state-resolver-v1',
);
const POLICY_RESOLVER_AUTHORITY_BRAND_V1: unique symbol = Symbol(
  'juryai-intent-assurance-policy-resolver-v1',
);
const RESOLVED_STATE_BINDING_BRAND_V1: unique symbol = Symbol(
  'juryai-resolved-intent-assurance-state-v1',
);
const RESOLVED_POLICY_DECISION_BRAND_V1: unique symbol = Symbol(
  'juryai-resolved-intent-assurance-policy-v1',
);
const ADAPTER_AUTHORITY_BRAND_V1: unique symbol = Symbol('juryai-intent-assurance-adapter-v1');
const EXECUTOR_AUTHORITY_BRAND_V1: unique symbol = Symbol('juryai-intent-assurance-executor-v1');
const VERIFIED_RECEIPT_BRAND_V1: unique symbol = Symbol('juryai-verified-assurance-receipt-v1');
const PROTECTED_AUTHORIZATION_BRAND_V1: unique symbol = Symbol(
  'juryai-protected-action-authorization-v1',
);

export interface TrustedHumanHandoffIssuerAuthorityV1 {
  readonly authority_kind: 'trusted_handoff_challenge_issuer_v1';
  readonly [ISSUER_AUTHORITY_BRAND_V1]: true;
}

export interface TrustedIntentAssuranceStateResolverAuthorityV1 {
  readonly authority_kind: 'trusted_intent_assurance_state_resolver_v1';
  readonly [STATE_RESOLVER_AUTHORITY_BRAND_V1]: true;
}

export interface TrustedIntentAssurancePolicyResolverAuthorityV1 {
  readonly authority_kind: 'trusted_intent_assurance_policy_resolver_v1';
  readonly [POLICY_RESOLVER_AUTHORITY_BRAND_V1]: true;
}

export interface ResolvedIntentAssuranceStateBindingV1 {
  /** Server-resolved state; never construct this wrapper from request fields. */
  readonly binding: IntentAssuranceStateBindingV1;
  readonly [RESOLVED_STATE_BINDING_BRAND_V1]: true;
}

export interface ResolvedIntentAssurancePolicyDecisionV1 {
  /** Server-resolved protocol policy; never accept a request-shaped decision here. */
  readonly decision: IntentAssurancePolicyDecisionV1;
  readonly [RESOLVED_POLICY_DECISION_BRAND_V1]: true;
}

export interface TrustedIntentAssuranceAdapterAuthorityV1 {
  readonly authority_kind: 'trusted_intent_assurance_adapter_v1';
  readonly adapter_id: string;
  readonly permitted_methods: readonly IntentAssuranceMethodV1[];
  readonly [ADAPTER_AUTHORITY_BRAND_V1]: true;
}

export interface TrustedProtectedActionExecutorAuthorityV1 {
  readonly authority_kind: 'trusted_protected_action_executor_v1';
  readonly [EXECUTOR_AUTHORITY_BRAND_V1]: true;
}

export const TRUSTED_HUMAN_HANDOFF_ISSUER_V1: TrustedHumanHandoffIssuerAuthorityV1 = Object.freeze({
  authority_kind: 'trusted_handoff_challenge_issuer_v1',
  [ISSUER_AUTHORITY_BRAND_V1]: true as const,
});

export const TRUSTED_INTENT_ASSURANCE_STATE_RESOLVER_V1: TrustedIntentAssuranceStateResolverAuthorityV1 =
  Object.freeze({
    authority_kind: 'trusted_intent_assurance_state_resolver_v1',
    [STATE_RESOLVER_AUTHORITY_BRAND_V1]: true as const,
  });

export const TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1: TrustedIntentAssurancePolicyResolverAuthorityV1 =
  Object.freeze({
    authority_kind: 'trusted_intent_assurance_policy_resolver_v1',
    [POLICY_RESOLVER_AUTHORITY_BRAND_V1]: true as const,
  });

function adapterAuthority(
  adapterId: string,
  methods: readonly IntentAssuranceMethodV1[],
): TrustedIntentAssuranceAdapterAuthorityV1 {
  return Object.freeze({
    authority_kind: 'trusted_intent_assurance_adapter_v1',
    adapter_id: adapterId,
    permitted_methods: Object.freeze([...methods]),
    [ADAPTER_AUTHORITY_BRAND_V1]: true as const,
  });
}

export const TRUSTED_RELAY_EXPRESSION_ADAPTER_V1 = adapterAuthority(
  'juryai-relay-expression-adapter-v1',
  ['agent_assertion', 'fresh_user_phrase'],
);
export const TRUSTED_MCP_ELICITATION_ADAPTER_V1 = adapterAuthority(
  'juryai-mcp-elicitation-adapter-v1',
  ['mcp_elicitation'],
);
export const TRUSTED_PLATFORM_APPROVAL_ADAPTER_V1 = adapterAuthority(
  'juryai-platform-approval-adapter-v1',
  ['platform_native_approval'],
);
export const TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1 = adapterAuthority(
  'juryai-first-party-ceremony-adapter-v1',
  ['first_party_ceremony'],
);
export const TRUSTED_WEBAUTHN_VERIFIER_ADAPTER_V1 = adapterAuthority(
  'juryai-webauthn-verifier-adapter-v1',
  ['webauthn_user_verification'],
);

const TRUSTED_ADAPTER_AUTHORITIES = new Set<TrustedIntentAssuranceAdapterAuthorityV1>([
  TRUSTED_RELAY_EXPRESSION_ADAPTER_V1,
  TRUSTED_MCP_ELICITATION_ADAPTER_V1,
  TRUSTED_PLATFORM_APPROVAL_ADAPTER_V1,
  TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
  TRUSTED_WEBAUTHN_VERIFIER_ADAPTER_V1,
]);

export const TRUSTED_PROTECTED_ACTION_EXECUTOR_V1: TrustedProtectedActionExecutorAuthorityV1 =
  Object.freeze({
    authority_kind: 'trusted_protected_action_executor_v1',
    [EXECUTOR_AUTHORITY_BRAND_V1]: true as const,
  });

export function isTrustedIntentAssuranceAdapterAuthorityV1(
  authority: unknown,
): authority is TrustedIntentAssuranceAdapterAuthorityV1 {
  return TRUSTED_ADAPTER_AUTHORITIES.has(authority as TrustedIntentAssuranceAdapterAuthorityV1);
}

export type AgentAssertionEvidenceV1 = {
  method: 'agent_assertion';
  challenge_id: string;
  assertion: string;
  agent_id: string;
  interaction_id: string;
  observed_at: string;
  evidence_reference: string;
};

export type FreshUserPhraseEvidenceV1 = {
  method: 'fresh_user_phrase';
  challenge_id: string;
  expression: string;
  agent_id: string;
  interaction_id: string;
  observed_at: string;
  evidence_reference: string;
};

export type ClientMediatedApprovalEvidenceV1 = {
  method: 'mcp_elicitation' | 'platform_native_approval';
  challenge_id: string;
  client_id: string;
  approval_event_id: string;
  client_claimed_explicit_approval: true;
  observed_at: string;
  evidence_reference: string;
};

export type FirstPartyCeremonyEvidenceV1 = {
  method: 'first_party_ceremony';
  challenge_id: string;
  first_party_session_id: string;
  ceremony_event_id: string;
  server_observed: true;
  observed_at: string;
  evidence_reference: string;
};

export type WebAuthnUserVerificationEvidenceV1 = {
  method: 'webauthn_user_verification';
  challenge_id: string;
  credential_id_hash: string;
  client_data_json_hash: string;
  authenticator_data_hash: string;
  signature_hash: string;
  user_verified: true;
  observed_at: string;
  evidence_reference: string;
};

export type IntentAssuranceEvidenceV1 =
  | AgentAssertionEvidenceV1
  | FreshUserPhraseEvidenceV1
  | ClientMediatedApprovalEvidenceV1
  | FirstPartyCeremonyEvidenceV1
  | WebAuthnUserVerificationEvidenceV1;

export interface VerifiedIntentAssuranceReceiptV1 {
  /** Runtime authority wrapper; the serializable receipt alone is never authorization. */
  readonly receipt: IntentAssuranceReceiptV1;
  readonly [VERIFIED_RECEIPT_BRAND_V1]: true;
}

export interface ProtectedActionAuthorizationV1 {
  /** Ephemeral grant for the one protected action named by the consumed receipt. */
  readonly consumption: IntentAssuranceConsumptionV1;
  readonly [PROTECTED_AUTHORIZATION_BRAND_V1]: true;
}

const verifiedReceiptObjects = new WeakSet<object>();
const consumedVerifiedReceiptObjects = new WeakSet<object>();
const protectedAuthorizationObjects = new WeakSet<object>();
const resolvedStateBindingObjects = new WeakSet<object>();
const resolvedPolicyDecisionObjects = new WeakSet<object>();

const LEVEL_RANK: Record<IntentAssuranceLevelV1, number> = {
  'HHC-0': 0,
  'HHC-1': 1,
  'HHC-2': 2,
  'HHC-3': 3,
  'HHC-4': 4,
};

const METHOD_LEVEL: Record<IntentAssuranceMethodV1, IntentAssuranceLevelV1> = {
  agent_assertion: 'HHC-0',
  fresh_user_phrase: 'HHC-1',
  mcp_elicitation: 'HHC-2',
  platform_native_approval: 'HHC-2',
  first_party_ceremony: 'HHC-3',
  webauthn_user_verification: 'HHC-4',
};

const AXES_BY_METHOD: Record<IntentAssuranceMethodV1, IntentAssuranceAxesV1> = {
  agent_assertion: {
    contactability: 'not_assessed',
    account_control: 'not_assessed',
    explicit_intent: 'not_established',
    real_world_identity_authority: 'not_assessed',
    physical_human_presence: 'not_proven',
    repudiation_resistance: 'none',
  },
  fresh_user_phrase: {
    contactability: 'not_assessed',
    account_control: 'authenticated_session_observed',
    explicit_intent: 'fresh_expression_observed',
    real_world_identity_authority: 'not_assessed',
    physical_human_presence: 'not_proven',
    repudiation_resistance: 'weak',
  },
  mcp_elicitation: {
    contactability: 'not_assessed',
    account_control: 'authenticated_session_observed',
    explicit_intent: 'client_mediated_approval',
    real_world_identity_authority: 'not_assessed',
    physical_human_presence: 'not_proven',
    repudiation_resistance: 'client_recorded',
  },
  platform_native_approval: {
    contactability: 'not_assessed',
    account_control: 'authenticated_session_observed',
    explicit_intent: 'client_mediated_approval',
    real_world_identity_authority: 'not_assessed',
    physical_human_presence: 'not_proven',
    repudiation_resistance: 'client_recorded',
  },
  first_party_ceremony: {
    contactability: 'not_assessed',
    account_control: 'first_party_session_observed',
    explicit_intent: 'first_party_ceremony_observed',
    real_world_identity_authority: 'not_assessed',
    physical_human_presence: 'not_proven',
    repudiation_resistance: 'server_verifiable',
  },
  webauthn_user_verification: {
    contactability: 'not_assessed',
    account_control: 'credential_user_verified',
    explicit_intent: 'cryptographic_challenge_approval',
    real_world_identity_authority: 'not_assessed',
    physical_human_presence: 'authenticator_user_verification',
    repudiation_resistance: 'cryptographically_verifiable',
  },
};

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const PUBLIC_REFERENCE_PATTERN = /^[A-Z0-9]{3,12}(?:-[A-Z0-9]{3,12})?$/u;
const MAX_CHALLENGE_TTL_SECONDS = 7 * 24 * 60 * 60;

function issue(code: string, path: string, message: string): ContractIssue {
  return { code, path, message };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
  issues: ContractIssue[],
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    issues.push(issue('intent_assurance_exact_keys', path, `Expected keys ${wanted.join(', ')}.`));
  }
}

function validIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

function cloneAxes(method: IntentAssuranceMethodV1): IntentAssuranceAxesV1 {
  return cloneCanonical(AXES_BY_METHOD[method]);
}

export function intentAssuranceMethodLevelV1(
  method: IntentAssuranceMethodV1,
): IntentAssuranceLevelV1 {
  return METHOD_LEVEL[method];
}

export function intentAssuranceAxesForMethodV1(
  method: IntentAssuranceMethodV1,
): IntentAssuranceAxesV1 {
  return cloneAxes(method);
}

export function assuranceLevelSatisfiesV1(
  achieved: IntentAssuranceLevelV1,
  required: IntentAssuranceLevelV1,
): boolean {
  return LEVEL_RANK[achieved] >= LEVEL_RANK[required];
}

export function validateIntentAssuranceProtocolProfileV1(value: unknown): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!object(value)) {
    return [issue('intent_assurance_profile_object', '$', 'Policy profile must be an object.')];
  }
  exactKeys(value, ['minimum_assurance_by_action', 'policy_version', 'profile_id'], '$', issues);
  if (value.policy_version !== INTENT_ASSURANCE_POLICY_VERSION_V1) {
    issues.push(
      issue('intent_assurance_policy_version', '$.policy_version', 'Policy version is invalid.'),
    );
  }
  if (!validId(value.profile_id)) {
    issues.push(issue('intent_assurance_profile_id', '$.profile_id', 'Profile id is invalid.'));
  }
  if (!object(value.minimum_assurance_by_action)) {
    issues.push(
      issue(
        'intent_assurance_profile_actions',
        '$.minimum_assurance_by_action',
        'Action policy must be an object.',
      ),
    );
  } else {
    exactKeys(
      value.minimum_assurance_by_action,
      INTENT_ASSURANCE_ACTIONS_V1,
      '$.minimum_assurance_by_action',
      issues,
    );
    for (const action of INTENT_ASSURANCE_ACTIONS_V1) {
      if (
        !INTENT_ASSURANCE_LEVELS_V1.includes(value.minimum_assurance_by_action[action] as never)
      ) {
        issues.push(
          issue(
            'intent_assurance_profile_level',
            `$.minimum_assurance_by_action.${action}`,
            'Required assurance level is invalid.',
          ),
        );
      }
    }
  }
  return issues;
}

export function validateIntentAssurancePolicyDecisionV1(value: unknown): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!object(value)) {
    return [
      issue('intent_assurance_policy_decision_object', '$', 'Policy decision must be an object.'),
    ];
  }
  exactKeys(
    value,
    ['policy_version', 'profile_id', 'requested_action', 'required_minimum_assurance'],
    '$',
    issues,
  );
  if (value.policy_version !== INTENT_ASSURANCE_POLICY_VERSION_V1) {
    issues.push(
      issue(
        'intent_assurance_policy_decision_version',
        '$.policy_version',
        'Policy decision version is invalid.',
      ),
    );
  }
  if (!validId(value.profile_id)) {
    issues.push(
      issue(
        'intent_assurance_policy_decision_profile',
        '$.profile_id',
        'Policy decision profile is invalid.',
      ),
    );
  }
  if (!INTENT_ASSURANCE_ACTIONS_V1.includes(value.requested_action as never)) {
    issues.push(
      issue(
        'intent_assurance_policy_decision_action',
        '$.requested_action',
        'Policy decision action is invalid.',
      ),
    );
  }
  if (!INTENT_ASSURANCE_LEVELS_V1.includes(value.required_minimum_assurance as never)) {
    issues.push(
      issue(
        'intent_assurance_policy_decision_level',
        '$.required_minimum_assurance',
        'Policy decision level is invalid.',
      ),
    );
  }
  return issues;
}

export function requiredIntentAssuranceV1(
  action: IntentAssuranceActionV1,
  profile: IntentAssuranceProtocolProfileV1,
): IntentAssurancePolicyDecisionV1 {
  const issues = validateIntentAssuranceProtocolProfileV1(profile);
  if (issues.length > 0 || !INTENT_ASSURANCE_ACTIONS_V1.includes(action)) {
    throw new TypeError(issues[0]?.message ?? 'Requested action is invalid.');
  }
  return cloneCanonical({
    policy_version: INTENT_ASSURANCE_POLICY_VERSION_V1,
    profile_id: profile.profile_id,
    requested_action: action,
    required_minimum_assurance: profile.minimum_assurance_by_action[action],
  });
}

export function resolveIntentAssurancePolicyDecisionV1(
  action: IntentAssuranceActionV1,
  profile: IntentAssuranceProtocolProfileV1,
  authority: TrustedIntentAssurancePolicyResolverAuthorityV1,
): ResolvedIntentAssurancePolicyDecisionV1 | null {
  if (authority !== TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1) return null;
  let decision: IntentAssurancePolicyDecisionV1;
  try {
    decision = requiredIntentAssuranceV1(action, profile);
  } catch {
    return null;
  }
  const resolved = Object.freeze({
    decision: deepFreeze(cloneCanonical(decision)),
    [RESOLVED_POLICY_DECISION_BRAND_V1]: true as const,
  });
  resolvedPolicyDecisionObjects.add(resolved);
  return resolved;
}

export function isResolvedIntentAssurancePolicyDecisionV1(
  value: unknown,
): value is ResolvedIntentAssurancePolicyDecisionV1 {
  return object(value) && resolvedPolicyDecisionObjects.has(value);
}

export function hashIntentAssuranceActionPayloadV1(
  action: IntentAssuranceActionV1,
  payload: JsonValue,
): string {
  return sha256(
    canonicalSerialize({
      contract_version: HUMAN_HANDOFF_CHALLENGE_VERSION_V1,
      requested_action: action,
      payload,
    }),
  );
}

export function canonicalFreshUserExpressionV1(publicReference: string): string {
  if (!PUBLIC_REFERENCE_PATTERN.test(publicReference)) {
    throw new TypeError('Public challenge reference is invalid.');
  }
  return `I CONFIRM ${publicReference}`;
}

export function validateIntentAssuranceStateBindingV1(value: unknown, path = '$'): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!object(value)) {
    return [issue('intent_assurance_binding_object', path, 'State binding must be an object.')];
  }
  exactKeys(
    value,
    [
      'authenticated_subject_id',
      'dispute_id',
      'formation_epoch',
      'party_id',
      'party_projection_contract_version',
      'party_projection_hash',
      'party_visible_version',
    ],
    path,
    issues,
  );
  if (!validId(value.authenticated_subject_id))
    issues.push(
      issue(
        'intent_assurance_binding_subject',
        `${path}.authenticated_subject_id`,
        'Authenticated subject is invalid.',
      ),
    );
  if (!validId(value.dispute_id) || !String(value.dispute_id).startsWith('dispute_'))
    issues.push(
      issue('intent_assurance_binding_dispute', `${path}.dispute_id`, 'Dispute id is invalid.'),
    );
  if (!['party_a', 'party_b'].includes(String(value.party_id)))
    issues.push(
      issue('intent_assurance_binding_party', `${path}.party_id`, 'Party id is invalid.'),
    );
  if (!validId(value.party_projection_contract_version))
    issues.push(
      issue(
        'intent_assurance_binding_projection_version',
        `${path}.party_projection_contract_version`,
        'Projection contract version is invalid.',
      ),
    );
  if (!validHash(value.party_projection_hash))
    issues.push(
      issue(
        'intent_assurance_binding_projection_hash',
        `${path}.party_projection_hash`,
        'Projection hash is invalid.',
      ),
    );
  if (!safeInteger(value.party_visible_version))
    issues.push(
      issue(
        'intent_assurance_binding_visible_version',
        `${path}.party_visible_version`,
        'Party-visible version is invalid.',
      ),
    );
  if (value.formation_epoch !== null && !safeInteger(value.formation_epoch))
    issues.push(
      issue(
        'intent_assurance_binding_epoch',
        `${path}.formation_epoch`,
        'Formation epoch is invalid.',
      ),
    );
  return issues;
}

export function resolveIntentAssuranceStateBindingV1(
  binding: IntentAssuranceStateBindingV1,
  authority: TrustedIntentAssuranceStateResolverAuthorityV1,
): ResolvedIntentAssuranceStateBindingV1 | null {
  if (
    authority !== TRUSTED_INTENT_ASSURANCE_STATE_RESOLVER_V1 ||
    validateIntentAssuranceStateBindingV1(binding).length > 0
  ) {
    return null;
  }
  const resolved = Object.freeze({
    binding: deepFreeze(cloneCanonical(binding)),
    [RESOLVED_STATE_BINDING_BRAND_V1]: true as const,
  });
  resolvedStateBindingObjects.add(resolved);
  return resolved;
}

export function isResolvedIntentAssuranceStateBindingV1(
  value: unknown,
): value is ResolvedIntentAssuranceStateBindingV1 {
  return object(value) && resolvedStateBindingObjects.has(value);
}

const CHALLENGE_KEYS = [
  'action_payload_hash',
  'authenticated_subject_id',
  'challenge_id',
  'challenge_version',
  'consumed_at',
  'consumed_by_consumption_id',
  'dispute_id',
  'expected_fresh_expression_hash',
  'expires_at',
  'formation_epoch',
  'invalidated_at',
  'invalidation_reason',
  'issued_at',
  'party_id',
  'party_projection_contract_version',
  'party_projection_hash',
  'party_visible_version',
  'permitted_methods',
  'policy_profile_id',
  'policy_version',
  'public_reference',
  'requested_action',
  'required_minimum_assurance',
  'satisfied_at',
  'satisfied_by_receipt_id',
  'status',
] as const;

export function validateHumanHandoffChallengeV1(value: unknown): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!object(value))
    return [issue('human_handoff_challenge_object', '$', 'Challenge must be an object.')];
  exactKeys(value, CHALLENGE_KEYS, '$', issues);
  if (value.challenge_version !== HUMAN_HANDOFF_CHALLENGE_VERSION_V1)
    issues.push(
      issue(
        'human_handoff_challenge_version',
        '$.challenge_version',
        'Challenge version is invalid.',
      ),
    );
  if (!validId(value.challenge_id) || !String(value.challenge_id).startsWith('handoff_challenge_'))
    issues.push(issue('human_handoff_challenge_id', '$.challenge_id', 'Challenge id is invalid.'));
  const binding = {
    authenticated_subject_id: value.authenticated_subject_id,
    dispute_id: value.dispute_id,
    party_id: value.party_id,
    party_projection_contract_version: value.party_projection_contract_version,
    party_projection_hash: value.party_projection_hash,
    party_visible_version: value.party_visible_version,
    formation_epoch: value.formation_epoch,
  };
  issues.push(...validateIntentAssuranceStateBindingV1(binding, '$'));
  if (!INTENT_ASSURANCE_ACTIONS_V1.includes(value.requested_action as never))
    issues.push(
      issue('human_handoff_challenge_action', '$.requested_action', 'Requested action is invalid.'),
    );
  if (!validHash(value.action_payload_hash))
    issues.push(
      issue(
        'human_handoff_challenge_payload_hash',
        '$.action_payload_hash',
        'Action payload hash is invalid.',
      ),
    );
  if (
    value.policy_version !== INTENT_ASSURANCE_POLICY_VERSION_V1 ||
    !validId(value.policy_profile_id)
  )
    issues.push(
      issue('human_handoff_challenge_policy', '$.policy_version', 'Policy binding is invalid.'),
    );
  if (!INTENT_ASSURANCE_LEVELS_V1.includes(value.required_minimum_assurance as never))
    issues.push(
      issue(
        'human_handoff_challenge_level',
        '$.required_minimum_assurance',
        'Required assurance is invalid.',
      ),
    );
  if (
    !Array.isArray(value.permitted_methods) ||
    value.permitted_methods.length === 0 ||
    value.permitted_methods.some(
      (method) => !INTENT_ASSURANCE_METHODS_V1.includes(method as never),
    ) ||
    new Set(value.permitted_methods).size !== value.permitted_methods.length ||
    JSON.stringify(value.permitted_methods) !== JSON.stringify([...value.permitted_methods].sort())
  ) {
    issues.push(
      issue(
        'human_handoff_challenge_methods',
        '$.permitted_methods',
        'Permitted methods must be non-empty, unique, and sorted.',
      ),
    );
  } else if (
    INTENT_ASSURANCE_LEVELS_V1.includes(value.required_minimum_assurance as never) &&
    value.permitted_methods.some(
      (method) =>
        !assuranceLevelSatisfiesV1(
          METHOD_LEVEL[method as IntentAssuranceMethodV1],
          value.required_minimum_assurance as IntentAssuranceLevelV1,
        ),
    )
  ) {
    issues.push(
      issue(
        'human_handoff_challenge_method_downgrade',
        '$.permitted_methods',
        'A permitted method is below the required assurance.',
      ),
    );
  }
  if (!PUBLIC_REFERENCE_PATTERN.test(String(value.public_reference)))
    issues.push(
      issue(
        'human_handoff_challenge_reference',
        '$.public_reference',
        'Public reference is invalid.',
      ),
    );
  const expectsPhrase =
    Array.isArray(value.permitted_methods) && value.permitted_methods.includes('fresh_user_phrase');
  if (
    (expectsPhrase && !validHash(value.expected_fresh_expression_hash)) ||
    (!expectsPhrase && value.expected_fresh_expression_hash !== null) ||
    (expectsPhrase &&
      PUBLIC_REFERENCE_PATTERN.test(String(value.public_reference)) &&
      value.expected_fresh_expression_hash !==
        sha256(canonicalFreshUserExpressionV1(String(value.public_reference))))
  )
    issues.push(
      issue(
        'human_handoff_challenge_expression_hash',
        '$.expected_fresh_expression_hash',
        'Fresh-expression commitment is inconsistent.',
      ),
    );
  if (
    !validIso(value.issued_at) ||
    !validIso(value.expires_at) ||
    (validIso(value.issued_at) &&
      validIso(value.expires_at) &&
      Date.parse(value.expires_at) <= Date.parse(value.issued_at))
  )
    issues.push(
      issue('human_handoff_challenge_time', '$.issued_at', 'Challenge time window is invalid.'),
    );
  if (!['pending', 'satisfied', 'consumed', 'invalidated'].includes(String(value.status)))
    issues.push(
      issue('human_handoff_challenge_status', '$.status', 'Challenge status is invalid.'),
    );
  const satisfiedPair = validIso(value.satisfied_at) && validId(value.satisfied_by_receipt_id);
  const consumedPair = validIso(value.consumed_at) && validId(value.consumed_by_consumption_id);
  const invalidatedPair =
    validIso(value.invalidated_at) &&
    [
      'state_changed',
      'party_binding_changed',
      'superseded',
      'expired',
      'cancelled',
      'policy_changed',
    ].includes(String(value.invalidation_reason));
  if (
    validIso(value.issued_at) &&
    validIso(value.expires_at) &&
    Date.parse(value.expires_at) - Date.parse(value.issued_at) > MAX_CHALLENGE_TTL_SECONDS * 1_000
  )
    issues.push(
      issue(
        'human_handoff_challenge_ttl',
        '$.expires_at',
        'Challenge lifetime exceeds the contract maximum.',
      ),
    );
  if (
    satisfiedPair &&
    validIso(value.issued_at) &&
    validIso(value.expires_at) &&
    (Date.parse(value.satisfied_at as string) < Date.parse(value.issued_at) ||
      Date.parse(value.satisfied_at as string) > Date.parse(value.expires_at))
  )
    issues.push(
      issue(
        'human_handoff_challenge_satisfied_time',
        '$.satisfied_at',
        'Challenge satisfaction time is outside its validity window.',
      ),
    );
  if (
    consumedPair &&
    satisfiedPair &&
    Date.parse(value.consumed_at as string) < Date.parse(value.satisfied_at as string)
  )
    issues.push(
      issue(
        'human_handoff_challenge_consumed_time',
        '$.consumed_at',
        'Challenge consumption precedes satisfaction.',
      ),
    );
  if (
    invalidatedPair &&
    validIso(value.issued_at) &&
    Date.parse(value.invalidated_at as string) < Date.parse(value.issued_at)
  )
    issues.push(
      issue(
        'human_handoff_challenge_invalidated_time',
        '$.invalidated_at',
        'Challenge invalidation precedes issuance.',
      ),
    );
  if (
    value.status === 'pending' &&
    (value.satisfied_at !== null ||
      value.satisfied_by_receipt_id !== null ||
      value.consumed_at !== null ||
      value.consumed_by_consumption_id !== null ||
      value.invalidated_at !== null ||
      value.invalidation_reason !== null)
  )
    issues.push(
      issue(
        'human_handoff_challenge_pending_state',
        '$.status',
        'Pending challenge carries terminal state.',
      ),
    );
  if (
    value.status === 'satisfied' &&
    (!satisfiedPair ||
      value.consumed_at !== null ||
      value.consumed_by_consumption_id !== null ||
      value.invalidated_at !== null ||
      value.invalidation_reason !== null)
  )
    issues.push(
      issue(
        'human_handoff_challenge_satisfied_state',
        '$.status',
        'Satisfied challenge lifecycle is inconsistent.',
      ),
    );
  if (
    value.status === 'consumed' &&
    (!satisfiedPair ||
      !consumedPair ||
      value.invalidated_at !== null ||
      value.invalidation_reason !== null)
  )
    issues.push(
      issue(
        'human_handoff_challenge_consumed_state',
        '$.status',
        'Consumed challenge lifecycle is inconsistent.',
      ),
    );
  if (
    value.status === 'invalidated' &&
    (!invalidatedPair ||
      value.consumed_at !== null ||
      value.consumed_by_consumption_id !== null ||
      (value.satisfied_at === null) !== (value.satisfied_by_receipt_id === null))
  )
    issues.push(
      issue(
        'human_handoff_challenge_invalidated_state',
        '$.status',
        'Invalidated challenge lifecycle is inconsistent.',
      ),
    );
  return issues;
}

const RECEIPT_KEYS = [
  'achieved_assurance',
  'action_payload_hash',
  'assurance_axes',
  'authenticated_subject_id',
  'authorization_status',
  'challenge_id',
  'challenge_issued_at',
  'challenge_version',
  'completed_at',
  'consumed_at',
  'consumption_id',
  'dispute_id',
  'evidence_commitment',
  'evidence_reference',
  'formation_epoch',
  'interaction_provenance',
  'method',
  'party_id',
  'policy_profile_id',
  'policy_version',
  'party_projection_contract_version',
  'party_projection_hash',
  'party_visible_version',
  'receipt_id',
  'receipt_version',
  'requested_action',
  'required_minimum_assurance',
  'verifier_adapter_id',
] as const;

export function validateIntentAssuranceReceiptV1(value: unknown): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!object(value))
    return [issue('intent_assurance_receipt_object', '$', 'Receipt must be an object.')];
  exactKeys(value, RECEIPT_KEYS, '$', issues);
  if (
    value.receipt_version !== INTENT_ASSURANCE_RECEIPT_VERSION_V1 ||
    value.challenge_version !== HUMAN_HANDOFF_CHALLENGE_VERSION_V1
  )
    issues.push(
      issue(
        'intent_assurance_receipt_version',
        '$.receipt_version',
        'Receipt contract version is invalid.',
      ),
    );
  if (
    !validId(value.receipt_id) ||
    !String(value.receipt_id).startsWith('assurance_receipt_') ||
    !validId(value.challenge_id)
  )
    issues.push(
      issue('intent_assurance_receipt_id', '$.receipt_id', 'Receipt identifiers are invalid.'),
    );
  const binding = {
    authenticated_subject_id: value.authenticated_subject_id,
    dispute_id: value.dispute_id,
    party_id: value.party_id,
    party_projection_contract_version: value.party_projection_contract_version,
    party_projection_hash: value.party_projection_hash,
    party_visible_version: value.party_visible_version,
    formation_epoch: value.formation_epoch,
  };
  issues.push(...validateIntentAssuranceStateBindingV1(binding, '$'));
  if (
    !INTENT_ASSURANCE_ACTIONS_V1.includes(value.requested_action as never) ||
    !validHash(value.action_payload_hash)
  )
    issues.push(
      issue(
        'intent_assurance_receipt_action',
        '$.requested_action',
        'Receipt action binding is invalid.',
      ),
    );
  if (
    value.policy_version !== INTENT_ASSURANCE_POLICY_VERSION_V1 ||
    !validId(value.policy_profile_id)
  )
    issues.push(
      issue(
        'intent_assurance_receipt_policy',
        '$.policy_version',
        'Receipt policy binding is invalid.',
      ),
    );
  if (
    !INTENT_ASSURANCE_METHODS_V1.includes(value.method as never) ||
    !INTENT_ASSURANCE_LEVELS_V1.includes(value.achieved_assurance as never) ||
    !INTENT_ASSURANCE_LEVELS_V1.includes(value.required_minimum_assurance as never)
  ) {
    issues.push(
      issue('intent_assurance_receipt_level', '$.method', 'Receipt method or level is invalid.'),
    );
  } else {
    const method = value.method as IntentAssuranceMethodV1;
    if (
      METHOD_LEVEL[method] !== value.achieved_assurance ||
      !assuranceLevelSatisfiesV1(
        value.achieved_assurance as IntentAssuranceLevelV1,
        value.required_minimum_assurance as IntentAssuranceLevelV1,
      )
    )
      issues.push(
        issue(
          'intent_assurance_receipt_level_mismatch',
          '$.achieved_assurance',
          'Receipt assurance does not match method or required minimum.',
        ),
      );
    let axesMatch = false;
    try {
      axesMatch =
        object(value.assurance_axes) &&
        canonicalSerialize(value.assurance_axes) === canonicalSerialize(AXES_BY_METHOD[method]);
    } catch {
      axesMatch = false;
    }
    if (!axesMatch)
      issues.push(
        issue(
          'intent_assurance_receipt_axes',
          '$.assurance_axes',
          'Assurance axes do not match the observed method.',
        ),
      );
  }
  if (!object(value.interaction_provenance)) {
    issues.push(
      issue(
        'intent_assurance_receipt_provenance',
        '$.interaction_provenance',
        'Interaction provenance is invalid.',
      ),
    );
  } else {
    exactKeys(
      value.interaction_provenance,
      ['channel', 'claim_source', 'host_id', 'host_provenance', 'interaction_id'],
      '$.interaction_provenance',
      issues,
    );
    if (
      ![
        'agent_relay',
        'mcp_client',
        'platform_client',
        'freejury_first_party',
        'webauthn',
      ].includes(String(value.interaction_provenance.channel)) ||
      ![
        'agent_claim',
        'client_claim',
        'juryai_server_observation',
        'trusted_webauthn_verifier',
      ].includes(String(value.interaction_provenance.claim_source)) ||
      !validId(value.interaction_provenance.interaction_id) ||
      (value.interaction_provenance.host_id !== null &&
        !validId(value.interaction_provenance.host_id)) ||
      !['unverified', 'client_asserted', 'server_observed', 'cryptographically_verified'].includes(
        String(value.interaction_provenance.host_provenance),
      )
    )
      issues.push(
        issue(
          'intent_assurance_receipt_provenance_value',
          '$.interaction_provenance',
          'Interaction provenance values are invalid.',
        ),
      );
    if (
      INTENT_ASSURANCE_METHODS_V1.includes(value.method as never) &&
      !provenanceMatchesMethod(
        value.method as IntentAssuranceMethodV1,
        value.interaction_provenance,
      )
    )
      issues.push(
        issue(
          'intent_assurance_receipt_provenance_method',
          '$.interaction_provenance',
          'Interaction provenance does not match the assurance method.',
        ),
      );
  }
  if (
    !validId(value.verifier_adapter_id) ||
    !validId(value.evidence_reference) ||
    !validHash(value.evidence_commitment)
  )
    issues.push(
      issue(
        'intent_assurance_receipt_evidence',
        '$.evidence_commitment',
        'Verifier evidence binding is invalid.',
      ),
    );
  if (
    INTENT_ASSURANCE_METHODS_V1.includes(value.method as never) &&
    value.verifier_adapter_id !== adapterIdForMethod(value.method as IntentAssuranceMethodV1)
  )
    issues.push(
      issue(
        'intent_assurance_receipt_adapter_method',
        '$.verifier_adapter_id',
        'Verifier adapter does not match the assurance method.',
      ),
    );
  if (
    !validIso(value.challenge_issued_at) ||
    !validIso(value.completed_at) ||
    (validIso(value.challenge_issued_at) &&
      validIso(value.completed_at) &&
      Date.parse(value.completed_at) < Date.parse(value.challenge_issued_at))
  )
    issues.push(
      issue('intent_assurance_receipt_time', '$.completed_at', 'Receipt timestamps are invalid.'),
    );
  if (value.authorization_status === 'available') {
    if (value.consumed_at !== null || value.consumption_id !== null)
      issues.push(
        issue(
          'intent_assurance_receipt_available_state',
          '$.authorization_status',
          'Available receipt carries consumption state.',
        ),
      );
  } else if (value.authorization_status === 'consumed') {
    if (!validIso(value.consumed_at) || !validId(value.consumption_id))
      issues.push(
        issue(
          'intent_assurance_receipt_consumed_state',
          '$.authorization_status',
          'Consumed receipt lacks consumption state.',
        ),
      );
  } else {
    issues.push(
      issue(
        'intent_assurance_receipt_status',
        '$.authorization_status',
        'Receipt status is invalid.',
      ),
    );
  }
  return issues;
}

const CONSUMPTION_KEYS = [
  'action_payload_hash',
  'authenticated_subject_id',
  'challenge_id',
  'consumed_at',
  'consumption_id',
  'consumption_version',
  'dispute_id',
  'formation_epoch',
  'party_id',
  'party_projection_contract_version',
  'party_projection_hash',
  'party_visible_version',
  'receipt_id',
  'requested_action',
] as const;

export function validateIntentAssuranceConsumptionV1(value: unknown): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!object(value)) {
    return [
      issue(
        'intent_assurance_consumption_object',
        '$',
        'Authorization consumption must be an object.',
      ),
    ];
  }
  exactKeys(value, CONSUMPTION_KEYS, '$', issues);
  if (value.consumption_version !== INTENT_ASSURANCE_CONSUMPTION_VERSION_V1) {
    issues.push(
      issue(
        'intent_assurance_consumption_version',
        '$.consumption_version',
        'Consumption version is invalid.',
      ),
    );
  }
  if (
    !validId(value.consumption_id) ||
    !String(value.consumption_id).startsWith('assurance_consumption_') ||
    !validId(value.receipt_id) ||
    !validId(value.challenge_id)
  ) {
    issues.push(
      issue(
        'intent_assurance_consumption_id',
        '$.consumption_id',
        'Consumption identifiers are invalid.',
      ),
    );
  }
  if (
    !validId(value.authenticated_subject_id) ||
    !validId(value.dispute_id) ||
    !String(value.dispute_id).startsWith('dispute_') ||
    !['party_a', 'party_b'].includes(String(value.party_id))
  ) {
    issues.push(
      issue(
        'intent_assurance_consumption_party',
        '$.authenticated_subject_id',
        'Consumption party binding is invalid.',
      ),
    );
  }
  if (
    !INTENT_ASSURANCE_ACTIONS_V1.includes(value.requested_action as never) ||
    !validHash(value.action_payload_hash)
  ) {
    issues.push(
      issue(
        'intent_assurance_consumption_action',
        '$.requested_action',
        'Consumption action binding is invalid.',
      ),
    );
  }
  if (
    !validHash(value.party_projection_hash) ||
    !validId(value.party_projection_contract_version) ||
    !safeInteger(value.party_visible_version) ||
    (value.formation_epoch !== null && !safeInteger(value.formation_epoch)) ||
    !validIso(value.consumed_at)
  ) {
    issues.push(
      issue(
        'intent_assurance_consumption_state',
        '$.party_projection_hash',
        'Consumption state binding is invalid.',
      ),
    );
  }
  return issues;
}

function sameBinding(
  challenge: HumanHandoffChallengeV1,
  current: IntentAssuranceStateBindingV1,
): boolean {
  return (
    challenge.authenticated_subject_id === current.authenticated_subject_id &&
    challenge.dispute_id === current.dispute_id &&
    challenge.party_id === current.party_id &&
    challenge.party_projection_contract_version === current.party_projection_contract_version &&
    challenge.party_projection_hash === current.party_projection_hash &&
    challenge.party_visible_version === current.party_visible_version &&
    challenge.formation_epoch === current.formation_epoch
  );
}

export type IntentAssuranceRejectionReasonV1 =
  | 'untrusted_authority'
  | 'invalid_policy'
  | 'invalid_binding'
  | 'invalid_challenge'
  | 'invalid_receipt'
  | 'invalid_evidence'
  | 'action_mismatch'
  | 'payload_mismatch'
  | 'state_changed'
  | 'expired'
  | 'already_used'
  | 'method_not_permitted'
  | 'insufficient_assurance';

type RejectionV1 = {
  status: 'rejected';
  reason_code: IntentAssuranceRejectionReasonV1;
  message: string;
};

function rejection(reason: IntentAssuranceRejectionReasonV1, message: string): RejectionV1 {
  return { status: 'rejected', reason_code: reason, message };
}

function validateChallengeForAction(
  challenge: HumanHandoffChallengeV1,
  currentBinding: IntentAssuranceStateBindingV1,
  action: IntentAssuranceActionV1,
  payload: JsonValue,
  now: string,
  requiredStatus: 'pending' | 'satisfied',
): RejectionV1 | null {
  if (validateHumanHandoffChallengeV1(challenge).length > 0)
    return rejection('invalid_challenge', 'Challenge contract is invalid.');
  if (validateIntentAssuranceStateBindingV1(currentBinding).length > 0)
    return rejection('invalid_binding', 'Current state binding is invalid.');
  if (challenge.status !== requiredStatus)
    return rejection('already_used', 'Challenge is not in the required one-time state.');
  if (challenge.requested_action !== action)
    return rejection('action_mismatch', 'Challenge does not authorize this action.');
  let payloadHash: string;
  try {
    payloadHash = hashIntentAssuranceActionPayloadV1(action, payload);
  } catch {
    return rejection('payload_mismatch', 'Protected action payload is not canonical JSON.');
  }
  if (challenge.action_payload_hash !== payloadHash)
    return rejection('payload_mismatch', 'Challenge does not authorize this payload.');
  if (!sameBinding(challenge, currentBinding))
    return rejection('state_changed', 'Challenge-bound visible state or party binding changed.');
  if (!validIso(now) || Date.parse(now) > Date.parse(challenge.expires_at))
    return rejection('expired', 'Challenge expired.');
  return null;
}

function evidenceKeys(method: IntentAssuranceMethodV1): readonly string[] {
  switch (method) {
    case 'agent_assertion':
      return [
        'agent_id',
        'assertion',
        'challenge_id',
        'evidence_reference',
        'interaction_id',
        'method',
        'observed_at',
      ];
    case 'fresh_user_phrase':
      return [
        'agent_id',
        'challenge_id',
        'evidence_reference',
        'expression',
        'interaction_id',
        'method',
        'observed_at',
      ];
    case 'mcp_elicitation':
    case 'platform_native_approval':
      return [
        'approval_event_id',
        'challenge_id',
        'client_claimed_explicit_approval',
        'client_id',
        'evidence_reference',
        'method',
        'observed_at',
      ];
    case 'first_party_ceremony':
      return [
        'ceremony_event_id',
        'challenge_id',
        'evidence_reference',
        'first_party_session_id',
        'method',
        'observed_at',
        'server_observed',
      ];
    case 'webauthn_user_verification':
      return [
        'authenticator_data_hash',
        'challenge_id',
        'client_data_json_hash',
        'credential_id_hash',
        'evidence_reference',
        'method',
        'observed_at',
        'signature_hash',
        'user_verified',
      ];
  }
}

function validateEvidence(
  evidence: IntentAssuranceEvidenceV1,
  challenge: HumanHandoffChallengeV1,
  now: string,
): boolean {
  if (!object(evidence) || !INTENT_ASSURANCE_METHODS_V1.includes(evidence.method as never))
    return false;
  const keys: ContractIssue[] = [];
  exactKeys(evidence, evidenceKeys(evidence.method), '$', keys);
  if (
    keys.length > 0 ||
    evidence.challenge_id !== challenge.challenge_id ||
    !validIso(evidence.observed_at) ||
    Date.parse(evidence.observed_at) < Date.parse(challenge.issued_at) ||
    Date.parse(evidence.observed_at) > Date.parse(now) ||
    !validId(evidence.evidence_reference)
  )
    return false;
  switch (evidence.method) {
    case 'agent_assertion':
      return (
        evidence.assertion.trim().length > 0 &&
        validId(evidence.agent_id) &&
        validId(evidence.interaction_id)
      );
    case 'fresh_user_phrase':
      return (
        validId(evidence.agent_id) &&
        validId(evidence.interaction_id) &&
        challenge.expected_fresh_expression_hash !== null &&
        sha256(evidence.expression) === challenge.expected_fresh_expression_hash
      );
    case 'mcp_elicitation':
    case 'platform_native_approval':
      return (
        evidence.client_claimed_explicit_approval === true &&
        validId(evidence.client_id) &&
        validId(evidence.approval_event_id)
      );
    case 'first_party_ceremony':
      return (
        evidence.server_observed === true &&
        validId(evidence.first_party_session_id) &&
        validId(evidence.ceremony_event_id)
      );
    case 'webauthn_user_verification':
      return (
        evidence.user_verified === true &&
        validHash(evidence.credential_id_hash) &&
        validHash(evidence.client_data_json_hash) &&
        validHash(evidence.authenticator_data_hash) &&
        validHash(evidence.signature_hash)
      );
  }
}

function provenanceForEvidence(
  evidence: IntentAssuranceEvidenceV1,
): IntentAssuranceInteractionProvenanceV1 {
  switch (evidence.method) {
    case 'agent_assertion':
    case 'fresh_user_phrase':
      return {
        channel: 'agent_relay',
        claim_source: 'agent_claim',
        interaction_id: evidence.interaction_id,
        host_id: evidence.agent_id,
        host_provenance: 'unverified',
      };
    case 'mcp_elicitation':
      return {
        channel: 'mcp_client',
        claim_source: 'client_claim',
        interaction_id: evidence.approval_event_id,
        host_id: evidence.client_id,
        host_provenance: 'client_asserted',
      };
    case 'platform_native_approval':
      return {
        channel: 'platform_client',
        claim_source: 'client_claim',
        interaction_id: evidence.approval_event_id,
        host_id: evidence.client_id,
        host_provenance: 'client_asserted',
      };
    case 'first_party_ceremony':
      return {
        channel: 'freejury_first_party',
        claim_source: 'juryai_server_observation',
        interaction_id: evidence.ceremony_event_id,
        host_id: evidence.first_party_session_id,
        host_provenance: 'server_observed',
      };
    case 'webauthn_user_verification':
      return {
        channel: 'webauthn',
        claim_source: 'trusted_webauthn_verifier',
        interaction_id: evidence.evidence_reference,
        host_id: null,
        host_provenance: 'cryptographically_verified',
      };
  }
}

function adapterIdForMethod(method: IntentAssuranceMethodV1): string {
  switch (method) {
    case 'agent_assertion':
    case 'fresh_user_phrase':
      return TRUSTED_RELAY_EXPRESSION_ADAPTER_V1.adapter_id;
    case 'mcp_elicitation':
      return TRUSTED_MCP_ELICITATION_ADAPTER_V1.adapter_id;
    case 'platform_native_approval':
      return TRUSTED_PLATFORM_APPROVAL_ADAPTER_V1.adapter_id;
    case 'first_party_ceremony':
      return TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1.adapter_id;
    case 'webauthn_user_verification':
      return TRUSTED_WEBAUTHN_VERIFIER_ADAPTER_V1.adapter_id;
  }
}

function provenanceMatchesMethod(
  method: IntentAssuranceMethodV1,
  provenance: Record<string, unknown>,
): boolean {
  switch (method) {
    case 'agent_assertion':
    case 'fresh_user_phrase':
      return (
        provenance.channel === 'agent_relay' &&
        provenance.claim_source === 'agent_claim' &&
        provenance.host_provenance === 'unverified' &&
        provenance.host_id !== null
      );
    case 'mcp_elicitation':
      return (
        provenance.channel === 'mcp_client' &&
        provenance.claim_source === 'client_claim' &&
        provenance.host_provenance === 'client_asserted' &&
        provenance.host_id !== null
      );
    case 'platform_native_approval':
      return (
        provenance.channel === 'platform_client' &&
        provenance.claim_source === 'client_claim' &&
        provenance.host_provenance === 'client_asserted' &&
        provenance.host_id !== null
      );
    case 'first_party_ceremony':
      return (
        provenance.channel === 'freejury_first_party' &&
        provenance.claim_source === 'juryai_server_observation' &&
        provenance.host_provenance === 'server_observed' &&
        provenance.host_id !== null
      );
    case 'webauthn_user_verification':
      return (
        provenance.channel === 'webauthn' &&
        provenance.claim_source === 'trusted_webauthn_verifier' &&
        provenance.host_provenance === 'cryptographically_verified' &&
        provenance.host_id === null
      );
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function verifiedReceipt(receipt: IntentAssuranceReceiptV1): VerifiedIntentAssuranceReceiptV1 {
  const value = Object.freeze({
    receipt: deepFreeze(cloneCanonical(receipt)),
    [VERIFIED_RECEIPT_BRAND_V1]: true as const,
  });
  verifiedReceiptObjects.add(value);
  return value;
}

export function isVerifiedIntentAssuranceReceiptV1(
  value: unknown,
): value is VerifiedIntentAssuranceReceiptV1 {
  return object(value) && verifiedReceiptObjects.has(value);
}

export function isProtectedActionAuthorizationV1(
  value: unknown,
): value is ProtectedActionAuthorizationV1 {
  return object(value) && protectedAuthorizationObjects.has(value);
}

export function protectedActionAuthorizationMatchesV1(
  authorization: unknown,
  currentStateBinding: ResolvedIntentAssuranceStateBindingV1,
  requestedAction: IntentAssuranceActionV1,
  actionPayload: JsonValue,
): boolean {
  if (
    !isProtectedActionAuthorizationV1(authorization) ||
    !isResolvedIntentAssuranceStateBindingV1(currentStateBinding)
  ) {
    return false;
  }
  let actionPayloadHash: string;
  try {
    actionPayloadHash = hashIntentAssuranceActionPayloadV1(requestedAction, actionPayload);
  } catch {
    return false;
  }
  const consumption = authorization.consumption;
  const current = currentStateBinding.binding;
  return (
    validateIntentAssuranceConsumptionV1(consumption).length === 0 &&
    consumption.authenticated_subject_id === current.authenticated_subject_id &&
    consumption.dispute_id === current.dispute_id &&
    consumption.party_id === current.party_id &&
    consumption.party_projection_contract_version === current.party_projection_contract_version &&
    consumption.party_projection_hash === current.party_projection_hash &&
    consumption.party_visible_version === current.party_visible_version &&
    consumption.formation_epoch === current.formation_epoch &&
    consumption.requested_action === requestedAction &&
    consumption.action_payload_hash === actionPayloadHash
  );
}

function receiptMatchesChallenge(
  receipt: IntentAssuranceReceiptV1,
  challenge: HumanHandoffChallengeV1,
): boolean {
  return (
    receipt.challenge_id === challenge.challenge_id &&
    receipt.authenticated_subject_id === challenge.authenticated_subject_id &&
    receipt.dispute_id === challenge.dispute_id &&
    receipt.party_id === challenge.party_id &&
    receipt.requested_action === challenge.requested_action &&
    receipt.action_payload_hash === challenge.action_payload_hash &&
    receipt.policy_version === challenge.policy_version &&
    receipt.policy_profile_id === challenge.policy_profile_id &&
    receipt.party_projection_contract_version === challenge.party_projection_contract_version &&
    receipt.party_projection_hash === challenge.party_projection_hash &&
    receipt.party_visible_version === challenge.party_visible_version &&
    receipt.formation_epoch === challenge.formation_epoch &&
    receipt.required_minimum_assurance === challenge.required_minimum_assurance &&
    receipt.challenge_issued_at === challenge.issued_at &&
    challenge.permitted_methods.includes(receipt.method) &&
    Date.parse(receipt.completed_at) <= Date.parse(challenge.expires_at) &&
    challenge.satisfied_by_receipt_id === receipt.receipt_id &&
    challenge.satisfied_at === receipt.completed_at
  );
}

function consumptionMatchesReceiptAndChallenge(
  consumption: IntentAssuranceConsumptionV1,
  receipt: IntentAssuranceReceiptV1,
  challenge: HumanHandoffChallengeV1,
): boolean {
  return (
    consumption.consumption_id === receipt.consumption_id &&
    consumption.consumption_id === challenge.consumed_by_consumption_id &&
    consumption.receipt_id === receipt.receipt_id &&
    consumption.challenge_id === challenge.challenge_id &&
    consumption.authenticated_subject_id === receipt.authenticated_subject_id &&
    consumption.dispute_id === receipt.dispute_id &&
    consumption.party_id === receipt.party_id &&
    consumption.requested_action === receipt.requested_action &&
    consumption.action_payload_hash === receipt.action_payload_hash &&
    consumption.party_projection_contract_version === receipt.party_projection_contract_version &&
    consumption.party_projection_hash === receipt.party_projection_hash &&
    consumption.party_visible_version === receipt.party_visible_version &&
    consumption.formation_epoch === receipt.formation_epoch &&
    consumption.consumed_at === receipt.consumed_at &&
    consumption.consumed_at === challenge.consumed_at
  );
}

export interface IntentAssuranceRuntimeDependenciesV1 {
  now: () => string;
  mint_challenge_id: () => string;
  mint_receipt_id: () => string;
  mint_consumption_id: () => string;
  mint_public_reference: () => string;
}

export interface IssueHumanHandoffChallengeInputV1 {
  state_binding: ResolvedIntentAssuranceStateBindingV1;
  requested_action: IntentAssuranceActionV1;
  action_payload: JsonValue;
  policy_decision: ResolvedIntentAssurancePolicyDecisionV1;
  permitted_methods: IntentAssuranceMethodV1[];
  expires_in_seconds: number;
}

export type IssueHumanHandoffChallengeResultV1 =
  { status: 'issued'; challenge: HumanHandoffChallengeV1 } | RejectionV1;

export type SatisfyHumanHandoffChallengeResultV1 =
  | {
      status: 'satisfied';
      challenge: HumanHandoffChallengeV1;
      receipt: IntentAssuranceReceiptV1;
      verified_receipt: VerifiedIntentAssuranceReceiptV1;
    }
  | RejectionV1;

export type ConsumeIntentAssuranceResultV1 =
  | {
      status: 'consumed';
      challenge: HumanHandoffChallengeV1;
      receipt: IntentAssuranceReceiptV1;
      consumption: IntentAssuranceConsumptionV1;
      authorization: ProtectedActionAuthorizationV1;
    }
  | RejectionV1;

export interface IntentAssuranceRuntimeV1 {
  issueChallenge: (
    input: IssueHumanHandoffChallengeInputV1,
    authority: TrustedHumanHandoffIssuerAuthorityV1,
  ) => IssueHumanHandoffChallengeResultV1;
  satisfyChallenge: (
    input: {
      challenge: HumanHandoffChallengeV1;
      current_state_binding: ResolvedIntentAssuranceStateBindingV1;
      requested_action: IntentAssuranceActionV1;
      action_payload: JsonValue;
      evidence: IntentAssuranceEvidenceV1;
    },
    authority: TrustedIntentAssuranceAdapterAuthorityV1,
  ) => SatisfyHumanHandoffChallengeResultV1;
  consumeAuthorization: (
    input: {
      challenge: HumanHandoffChallengeV1;
      verified_receipt: VerifiedIntentAssuranceReceiptV1;
      current_state_binding: ResolvedIntentAssuranceStateBindingV1;
      requested_action: IntentAssuranceActionV1;
      action_payload: JsonValue;
    },
    authority: TrustedProtectedActionExecutorAuthorityV1,
  ) => ConsumeIntentAssuranceResultV1;
  invalidateChallenge: (
    challenge: HumanHandoffChallengeV1,
    reason: HumanHandoffInvalidationReasonV1,
    authority: TrustedHumanHandoffIssuerAuthorityV1,
  ) => HumanHandoffChallengeV1 | null;
}

export function createIntentAssuranceRuntimeV1(
  dependencies: IntentAssuranceRuntimeDependenciesV1,
): IntentAssuranceRuntimeV1 {
  return {
    issueChallenge(input, authority) {
      if (authority !== TRUSTED_HUMAN_HANDOFF_ISSUER_V1)
        return rejection('untrusted_authority', 'Trusted challenge issuer authority is required.');
      if (!isResolvedIntentAssuranceStateBindingV1(input.state_binding))
        return rejection('untrusted_authority', 'Server-resolved state binding is required.');
      const stateBinding = input.state_binding.binding;
      if (!isResolvedIntentAssurancePolicyDecisionV1(input.policy_decision))
        return rejection('untrusted_authority', 'Server-resolved assurance policy is required.');
      const policyDecision = input.policy_decision.decision;
      if (
        validateIntentAssurancePolicyDecisionV1(policyDecision).length > 0 ||
        policyDecision.requested_action !== input.requested_action ||
        !INTENT_ASSURANCE_LEVELS_V1.includes(policyDecision.required_minimum_assurance)
      )
        return rejection('invalid_policy', 'Policy decision is invalid or names another action.');
      if (
        !safeInteger(input.expires_in_seconds, 1) ||
        input.expires_in_seconds > MAX_CHALLENGE_TTL_SECONDS
      )
        return rejection('invalid_challenge', 'Challenge lifetime is invalid.');
      if (
        !Array.isArray(input.permitted_methods) ||
        input.permitted_methods.length === 0 ||
        input.permitted_methods.some(
          (method) => !INTENT_ASSURANCE_METHODS_V1.includes(method as never),
        ) ||
        new Set(input.permitted_methods).size !== input.permitted_methods.length
      )
        return rejection('invalid_challenge', 'Permitted assurance methods are invalid.');
      try {
        canonicalSerialize(input.action_payload);
      } catch {
        return rejection('invalid_challenge', 'Action payload must be canonical JSON.');
      }
      const now = dependencies.now();
      const challengeId = dependencies.mint_challenge_id();
      const publicReference = dependencies.mint_public_reference();
      if (
        !validIso(now) ||
        !validId(challengeId) ||
        !challengeId.startsWith('handoff_challenge_') ||
        !PUBLIC_REFERENCE_PATTERN.test(publicReference)
      )
        return rejection('invalid_challenge', 'Challenge issuer produced invalid metadata.');
      const methods = [...new Set(input.permitted_methods)].sort() as IntentAssuranceMethodV1[];
      const challenge: HumanHandoffChallengeV1 = {
        challenge_version: HUMAN_HANDOFF_CHALLENGE_VERSION_V1,
        challenge_id: challengeId,
        ...cloneCanonical(stateBinding),
        requested_action: input.requested_action,
        action_payload_hash: hashIntentAssuranceActionPayloadV1(
          input.requested_action,
          input.action_payload,
        ),
        policy_version: INTENT_ASSURANCE_POLICY_VERSION_V1,
        policy_profile_id: policyDecision.profile_id,
        required_minimum_assurance: policyDecision.required_minimum_assurance,
        permitted_methods: methods,
        public_reference: publicReference,
        expected_fresh_expression_hash: methods.includes('fresh_user_phrase')
          ? sha256(canonicalFreshUserExpressionV1(publicReference))
          : null,
        issued_at: now,
        expires_at: new Date(Date.parse(now) + input.expires_in_seconds * 1000).toISOString(),
        status: 'pending',
        satisfied_at: null,
        satisfied_by_receipt_id: null,
        consumed_at: null,
        consumed_by_consumption_id: null,
        invalidated_at: null,
        invalidation_reason: null,
      };
      return validateHumanHandoffChallengeV1(challenge).length === 0
        ? { status: 'issued', challenge: cloneCanonical(challenge) }
        : rejection('invalid_challenge', 'Minted challenge failed its canonical contract.');
    },

    satisfyChallenge(input, authority) {
      if (!isTrustedIntentAssuranceAdapterAuthorityV1(authority))
        return rejection('untrusted_authority', 'Trusted assurance adapter authority is required.');
      if (!isResolvedIntentAssuranceStateBindingV1(input.current_state_binding))
        return rejection('untrusted_authority', 'Server-resolved current state is required.');
      const now = dependencies.now();
      const precheck = validateChallengeForAction(
        input.challenge,
        input.current_state_binding.binding,
        input.requested_action,
        input.action_payload,
        now,
        'pending',
      );
      if (precheck) return precheck;
      if (
        !object(input.evidence) ||
        !INTENT_ASSURANCE_METHODS_V1.includes(input.evidence.method as never)
      )
        return rejection('invalid_evidence', 'Assurance evidence shape is invalid.');
      if (
        !input.challenge.permitted_methods.includes(input.evidence.method) ||
        !authority.permitted_methods.includes(input.evidence.method)
      )
        return rejection(
          'method_not_permitted',
          'Assurance method is not permitted for this challenge or adapter.',
        );
      if (!validateEvidence(input.evidence, input.challenge, now))
        return rejection(
          'invalid_evidence',
          'Assurance evidence is invalid or not fresh for this challenge.',
        );
      const achieved = METHOD_LEVEL[input.evidence.method];
      if (!assuranceLevelSatisfiesV1(achieved, input.challenge.required_minimum_assurance))
        return rejection(
          'insufficient_assurance',
          'Achieved assurance is below the required minimum.',
        );
      const receiptId = dependencies.mint_receipt_id();
      const receipt: IntentAssuranceReceiptV1 = {
        receipt_version: INTENT_ASSURANCE_RECEIPT_VERSION_V1,
        receipt_id: receiptId,
        challenge_version: input.challenge.challenge_version,
        challenge_id: input.challenge.challenge_id,
        authenticated_subject_id: input.challenge.authenticated_subject_id,
        dispute_id: input.challenge.dispute_id,
        party_id: input.challenge.party_id,
        requested_action: input.challenge.requested_action,
        action_payload_hash: input.challenge.action_payload_hash,
        policy_version: input.challenge.policy_version,
        policy_profile_id: input.challenge.policy_profile_id,
        party_projection_contract_version: input.challenge.party_projection_contract_version,
        party_projection_hash: input.challenge.party_projection_hash,
        party_visible_version: input.challenge.party_visible_version,
        formation_epoch: input.challenge.formation_epoch,
        method: input.evidence.method,
        achieved_assurance: achieved,
        required_minimum_assurance: input.challenge.required_minimum_assurance,
        assurance_axes: cloneAxes(input.evidence.method),
        interaction_provenance: provenanceForEvidence(input.evidence),
        verifier_adapter_id: authority.adapter_id,
        evidence_reference: input.evidence.evidence_reference,
        evidence_commitment: sha256(canonicalSerialize(input.evidence)),
        challenge_issued_at: input.challenge.issued_at,
        completed_at: now,
        authorization_status: 'available',
        consumed_at: null,
        consumption_id: null,
      };
      if (validateIntentAssuranceReceiptV1(receipt).length > 0)
        return rejection('invalid_receipt', 'Minted receipt failed its canonical contract.');
      const challenge = cloneCanonical(input.challenge);
      challenge.status = 'satisfied';
      challenge.satisfied_at = now;
      challenge.satisfied_by_receipt_id = receiptId;
      if (
        validateHumanHandoffChallengeV1(challenge).length > 0 ||
        !receiptMatchesChallenge(receipt, challenge)
      )
        return rejection('invalid_receipt', 'Receipt does not bind exactly to its challenge.');
      return {
        status: 'satisfied',
        challenge,
        receipt: cloneCanonical(receipt),
        verified_receipt: verifiedReceipt(receipt),
      };
    },

    consumeAuthorization(input, authority) {
      // PR 5 persistence must save both returned consumed states and its protected
      // action in one transaction. Persisting only one side grants no authority.
      if (authority !== TRUSTED_PROTECTED_ACTION_EXECUTOR_V1)
        return rejection(
          'untrusted_authority',
          'Trusted protected-action executor authority is required.',
        );
      if (!isVerifiedIntentAssuranceReceiptV1(input.verified_receipt))
        return rejection('untrusted_authority', 'A verified adapter receipt is required.');
      if (!isResolvedIntentAssuranceStateBindingV1(input.current_state_binding))
        return rejection('untrusted_authority', 'Server-resolved current state is required.');
      if (consumedVerifiedReceiptObjects.has(input.verified_receipt))
        return rejection('already_used', 'Assurance receipt has already been consumed.');
      const receipt = input.verified_receipt.receipt;
      if (
        validateIntentAssuranceReceiptV1(receipt).length > 0 ||
        !receiptMatchesChallenge(receipt, input.challenge)
      )
        return rejection('invalid_receipt', 'Receipt is invalid or belongs to another challenge.');
      const now = dependencies.now();
      const precheck = validateChallengeForAction(
        input.challenge,
        input.current_state_binding.binding,
        input.requested_action,
        input.action_payload,
        now,
        'satisfied',
      );
      if (precheck) return precheck;
      if (receipt.authorization_status !== 'available')
        return rejection('already_used', 'Assurance receipt has already been consumed.');
      const consumptionId = dependencies.mint_consumption_id();
      if (!validId(consumptionId) || !consumptionId.startsWith('assurance_consumption_'))
        return rejection('invalid_receipt', 'Minted consumption id is invalid.');
      const challenge = cloneCanonical(input.challenge);
      challenge.status = 'consumed';
      challenge.consumed_at = now;
      challenge.consumed_by_consumption_id = consumptionId;
      const consumedReceipt = cloneCanonical(receipt);
      consumedReceipt.authorization_status = 'consumed';
      consumedReceipt.consumed_at = now;
      consumedReceipt.consumption_id = consumptionId;
      const consumption: IntentAssuranceConsumptionV1 = {
        consumption_version: INTENT_ASSURANCE_CONSUMPTION_VERSION_V1,
        consumption_id: consumptionId,
        receipt_id: receipt.receipt_id,
        challenge_id: challenge.challenge_id,
        authenticated_subject_id: challenge.authenticated_subject_id,
        dispute_id: challenge.dispute_id,
        party_id: challenge.party_id,
        requested_action: challenge.requested_action,
        action_payload_hash: challenge.action_payload_hash,
        party_projection_contract_version: challenge.party_projection_contract_version,
        party_projection_hash: challenge.party_projection_hash,
        party_visible_version: challenge.party_visible_version,
        formation_epoch: challenge.formation_epoch,
        consumed_at: now,
      };
      if (
        validateHumanHandoffChallengeV1(challenge).length > 0 ||
        validateIntentAssuranceReceiptV1(consumedReceipt).length > 0 ||
        validateIntentAssuranceConsumptionV1(consumption).length > 0 ||
        !consumptionMatchesReceiptAndChallenge(consumption, consumedReceipt, challenge)
      )
        return rejection(
          'invalid_receipt',
          'Consumed authorization failed its canonical contract.',
        );
      const authorization = Object.freeze({
        consumption: deepFreeze(cloneCanonical(consumption)),
        [PROTECTED_AUTHORIZATION_BRAND_V1]: true as const,
      });
      consumedVerifiedReceiptObjects.add(input.verified_receipt);
      protectedAuthorizationObjects.add(authorization);
      return {
        status: 'consumed',
        challenge,
        receipt: consumedReceipt,
        consumption,
        authorization,
      };
    },

    invalidateChallenge(challenge, reason, authority) {
      if (
        authority !== TRUSTED_HUMAN_HANDOFF_ISSUER_V1 ||
        validateHumanHandoffChallengeV1(challenge).length > 0 ||
        !['pending', 'satisfied'].includes(challenge.status) ||
        ![
          'state_changed',
          'party_binding_changed',
          'superseded',
          'expired',
          'cancelled',
          'policy_changed',
        ].includes(reason)
      )
        return null;
      const invalidated = cloneCanonical(challenge);
      invalidated.status = 'invalidated';
      invalidated.invalidated_at = dependencies.now();
      invalidated.invalidation_reason = reason;
      return validateHumanHandoffChallengeV1(invalidated).length === 0 ? invalidated : null;
    },
  };
}
