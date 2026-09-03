import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HUMAN_HANDOFF_CHALLENGE_VERSION_V1,
  INTENT_ASSURANCE_ACTIONS_V1,
  INTENT_ASSURANCE_METHODS_V1,
  INTENT_ASSURANCE_POLICY_VERSION_V1,
  INTENT_ASSURANCE_RECEIPT_VERSION_V1,
  TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
  TRUSTED_HUMAN_HANDOFF_ISSUER_V1,
  TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
  TRUSTED_INTENT_ASSURANCE_STATE_RESOLVER_V1,
  TRUSTED_MCP_ELICITATION_ADAPTER_V1,
  TRUSTED_PLATFORM_APPROVAL_ADAPTER_V1,
  TRUSTED_PROTECTED_ACTION_EXECUTOR_V1,
  TRUSTED_RELAY_EXPRESSION_ADAPTER_V1,
  TRUSTED_WEBAUTHN_VERIFIER_ADAPTER_V1,
  assuranceLevelSatisfiesV1,
  canonicalFreshUserExpressionV1,
  createIntentAssuranceRuntimeV1,
  hashIntentAssuranceActionPayloadV1,
  intentAssuranceAxesForMethodV1,
  isProtectedActionAuthorizationV1,
  isTrustedIntentAssuranceAdapterAuthorityV1,
  isVerifiedIntentAssuranceReceiptV1,
  protectedActionAuthorizationMatchesV1,
  requiredIntentAssuranceV1,
  resolveIntentAssurancePolicyDecisionV1,
  resolveIntentAssuranceStateBindingV1,
  validateHumanHandoffChallengeV1,
  validateIntentAssuranceConsumptionV1,
  validateIntentAssuranceProtocolProfileV1,
  validateIntentAssuranceReceiptV1,
  type HumanHandoffChallengeV1,
  type IntentAssuranceActionV1,
  type IntentAssuranceEvidenceV1,
  type IntentAssuranceLevelV1,
  type IntentAssuranceMethodV1,
  type IntentAssuranceProtocolProfileV1,
  type IntentAssuranceRuntimeV1,
  type IntentAssuranceStateBindingV1,
  type SatisfyHumanHandoffChallengeResultV1,
  type TrustedIntentAssuranceAdapterAuthorityV1,
  type TrustedIntentAssuranceStateResolverAuthorityV1,
  type VerifiedIntentAssuranceReceiptV1,
} from '../intent-assurance/intent-assurance.js';
import { canonicalSerialize, cloneCanonical, type JsonValue } from '../v2/case-envelope.js';
import {
  PARTY_CONFIRMATION_VERSION_V211,
  PARTY_FORMATION_PROJECTION_VERSION_V211,
} from '../v2-1-1/case-envelope.js';
import type { CaseServicePort } from '../webmcp/public-contract.js';
import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const ACTION_PAYLOAD = {
  confirmation_version: PARTY_CONFIRMATION_VERSION_V211,
  confirmation_id: 'confirmation_party_a_1',
  adopt: true,
} as const;

const DEFAULT_LEVELS: Record<IntentAssuranceActionV1, IntentAssuranceLevelV1> = {
  join_dispute: 'HHC-1',
  confirm_case_account: 'HHC-3',
  reopen_confirmed_material: 'HHC-3',
  agree_binding_treatment: 'HHC-2',
  authorize_settlement: 'HHC-3',
  release_settlement_funds: 'HHC-4',
  test_only_protected_action: 'HHC-0',
};

function profile(
  overrides: Partial<Record<IntentAssuranceActionV1, IntentAssuranceLevelV1>> = {},
): IntentAssuranceProtocolProfileV1 {
  return {
    policy_version: INTENT_ASSURANCE_POLICY_VERSION_V1,
    profile_id: 'profile_standard_v1',
    minimum_assurance_by_action: { ...DEFAULT_LEVELS, ...overrides },
  };
}

function binding(
  overrides: Partial<IntentAssuranceStateBindingV1> = {},
): IntentAssuranceStateBindingV1 {
  return {
    authenticated_subject_id: 'subject_party_a',
    dispute_id: 'dispute_assurance_1',
    party_id: 'party_a',
    party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
    party_projection_hash: HASH_A,
    party_visible_version: 7,
    formation_epoch: 2,
    ...overrides,
  };
}

function resolvedBinding(overrides: Partial<IntentAssuranceStateBindingV1> = {}) {
  const resolved = resolveIntentAssuranceStateBindingV1(
    binding(overrides),
    TRUSTED_INTENT_ASSURANCE_STATE_RESOLVER_V1,
  );
  if (!resolved) throw new Error('test state binding must resolve');
  return resolved;
}

function harness() {
  let nowMilliseconds = Date.parse('2026-09-02T10:00:00.000Z');
  let sequence = 0;
  const runtime = createIntentAssuranceRuntimeV1({
    now: () => new Date(nowMilliseconds).toISOString(),
    mint_challenge_id: () => `handoff_challenge_${++sequence}`,
    mint_receipt_id: () => `assurance_receipt_${++sequence}`,
    mint_consumption_id: () => `assurance_consumption_${++sequence}`,
    mint_public_reference: () => `XYS-${String(++sequence).padStart(3, '0')}`,
  });
  return {
    runtime,
    now: () => new Date(nowMilliseconds).toISOString(),
    advance(seconds: number) {
      nowMilliseconds += seconds * 1_000;
    },
  };
}

function issueChallenge(
  runtime: IntentAssuranceRuntimeV1,
  options: {
    action?: IntentAssuranceActionV1;
    level?: IntentAssuranceLevelV1;
    methods?: IntentAssuranceMethodV1[];
    state?: IntentAssuranceStateBindingV1;
    payload?: JsonValue;
    expires?: number;
  } = {},
): HumanHandoffChallengeV1 {
  const action = options.action ?? 'confirm_case_account';
  const selectedProfile = profile(options.level ? { [action]: options.level } : undefined);
  const result = runtime.issueChallenge(
    {
      state_binding: resolveIntentAssuranceStateBindingV1(
        options.state ?? binding(),
        TRUSTED_INTENT_ASSURANCE_STATE_RESOLVER_V1,
      )!,
      requested_action: action,
      action_payload: options.payload ?? ACTION_PAYLOAD,
      policy_decision: resolveIntentAssurancePolicyDecisionV1(
        action,
        selectedProfile,
        TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
      )!,
      permitted_methods: options.methods ?? ['first_party_ceremony'],
      expires_in_seconds: options.expires ?? 300,
    },
    TRUSTED_HUMAN_HANDOFF_ISSUER_V1,
  );
  expect(result.status).toBe('issued');
  if (result.status !== 'issued') throw new Error(result.message);
  return result.challenge;
}

function evidence(
  method: IntentAssuranceMethodV1,
  challenge: HumanHandoffChallengeV1,
  observedAt: string,
): IntentAssuranceEvidenceV1 {
  switch (method) {
    case 'agent_assertion':
      return {
        method,
        challenge_id: challenge.challenge_id,
        assertion: 'The agent reports that the user wants this action.',
        agent_id: 'relay_agent_1',
        interaction_id: 'interaction_1',
        observed_at: observedAt,
        evidence_reference: 'evidence_agent_1',
      };
    case 'fresh_user_phrase':
      return {
        method,
        challenge_id: challenge.challenge_id,
        expression: canonicalFreshUserExpressionV1(challenge.public_reference),
        agent_id: 'relay_agent_1',
        interaction_id: 'interaction_1',
        observed_at: observedAt,
        evidence_reference: 'evidence_phrase_1',
      };
    case 'mcp_elicitation':
    case 'platform_native_approval':
      return {
        method,
        challenge_id: challenge.challenge_id,
        client_id: method === 'mcp_elicitation' ? 'mcp_client_1' : 'platform_client_1',
        approval_event_id: `approval_event_${method}`,
        client_claimed_explicit_approval: true,
        observed_at: observedAt,
        evidence_reference: `evidence_${method}`,
      };
    case 'first_party_ceremony':
      return {
        method,
        challenge_id: challenge.challenge_id,
        first_party_session_id: 'first_party_session_1',
        ceremony_event_id: 'ceremony_event_1',
        server_observed: true,
        observed_at: observedAt,
        evidence_reference: 'evidence_first_party_1',
      };
    case 'webauthn_user_verification':
      return {
        method,
        challenge_id: challenge.challenge_id,
        credential_id_hash: HASH_A,
        client_data_json_hash: HASH_B,
        authenticator_data_hash: HASH_C,
        signature_hash: 'd'.repeat(64),
        user_verified: true,
        observed_at: observedAt,
        evidence_reference: 'evidence_webauthn_1',
      };
  }
}

function satisfy(
  runtime: IntentAssuranceRuntimeV1,
  challenge: HumanHandoffChallengeV1,
  method: IntentAssuranceMethodV1,
  authority: TrustedIntentAssuranceAdapterAuthorityV1,
  observedAt: string,
  overrides: {
    action?: IntentAssuranceActionV1;
    payload?: JsonValue;
    state?: IntentAssuranceStateBindingV1;
    evidence?: IntentAssuranceEvidenceV1;
  } = {},
): SatisfyHumanHandoffChallengeResultV1 {
  return runtime.satisfyChallenge(
    {
      challenge,
      current_state_binding: resolveIntentAssuranceStateBindingV1(
        overrides.state ?? binding(),
        TRUSTED_INTENT_ASSURANCE_STATE_RESOLVER_V1,
      )!,
      requested_action: overrides.action ?? challenge.requested_action,
      action_payload: overrides.payload ?? ACTION_PAYLOAD,
      evidence: overrides.evidence ?? evidence(method, challenge, observedAt),
    },
    authority,
  );
}

describe('PR 4B human handoff and intent assurance contract', () => {
  it('versions every trust-bearing contract and evaluates policy deterministically', () => {
    expect(HUMAN_HANDOFF_CHALLENGE_VERSION_V1).toBe('juryai-human-handoff-challenge-v1.0.0');
    expect(INTENT_ASSURANCE_RECEIPT_VERSION_V1).toBe('juryai-intent-assurance-receipt-v1.0.0');
    expect(validateIntentAssuranceProtocolProfileV1(profile())).toEqual([]);
    expect(requiredIntentAssuranceV1('release_settlement_funds', profile())).toEqual({
      policy_version: INTENT_ASSURANCE_POLICY_VERSION_V1,
      profile_id: 'profile_standard_v1',
      requested_action: 'release_settlement_funds',
      required_minimum_assurance: 'HHC-4',
    });
    expect(assuranceLevelSatisfiesV1('HHC-3', 'HHC-4')).toBe(false);
  });

  it('requires a complete action policy without transport or dollar thresholds', () => {
    const malformed = cloneCanonical(profile()) as unknown as Record<string, unknown>;
    const actions = malformed.minimum_assurance_by_action as Record<string, unknown>;
    delete actions.join_dispute;
    expect(validateIntentAssuranceProtocolProfileV1(malformed).map((item) => item.code)).toContain(
      'intent_assurance_exact_keys',
    );
    expect(canonicalSerialize(profile())).not.toMatch(/amount|dollar|stripe|email/iu);
  });

  it('mints challenge IDs, references, timestamps, and payload commitments server-side', () => {
    const { runtime } = harness();
    const challenge = issueChallenge(runtime);
    expect(challenge.challenge_id).toMatch(/^handoff_challenge_/u);
    expect(challenge.public_reference).toMatch(/^XYS-/u);
    expect(challenge.action_payload_hash).toBe(
      hashIntentAssuranceActionPayloadV1('confirm_case_account', ACTION_PAYLOAD),
    );
    expect(validateHumanHandoffChallengeV1(challenge)).toEqual([]);
  });

  it('requires server-resolved subject, party, and projection state rather than request-shaped data', () => {
    const { runtime } = harness();
    const forgedResolver = {
      authority_kind: 'trusted_intent_assurance_state_resolver_v1',
    } as unknown as TrustedIntentAssuranceStateResolverAuthorityV1;
    expect(resolveIntentAssuranceStateBindingV1(binding(), forgedResolver)).toBeNull();
    expect(
      runtime.issueChallenge(
        {
          state_binding: binding() as never,
          requested_action: 'confirm_case_account',
          action_payload: ACTION_PAYLOAD,
          policy_decision: resolveIntentAssurancePolicyDecisionV1(
            'confirm_case_account',
            profile(),
            TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
          )!,
          permitted_methods: ['first_party_ceremony'],
          expires_in_seconds: 300,
        },
        TRUSTED_HUMAN_HANDOFF_ISSUER_V1,
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'untrusted_authority' });
  });

  it('requires a server-resolved protocol policy rather than a caller-selected assurance level', () => {
    const { runtime } = harness();
    expect(
      resolveIntentAssurancePolicyDecisionV1(
        'confirm_case_account',
        profile({ confirm_case_account: 'HHC-0' }),
        { authority_kind: 'trusted_intent_assurance_policy_resolver_v1' } as never,
      ),
    ).toBeNull();
    expect(
      runtime.issueChallenge(
        {
          state_binding: resolvedBinding(),
          requested_action: 'confirm_case_account',
          action_payload: ACTION_PAYLOAD,
          policy_decision: requiredIntentAssuranceV1(
            'confirm_case_account',
            profile({ confirm_case_account: 'HHC-0' }),
          ) as never,
          permitted_methods: ['agent_assertion'],
          expires_in_seconds: 300,
        },
        TRUSTED_HUMAN_HANDOFF_ISSUER_V1,
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'untrusted_authority' });
  });

  it('does not allow HHC-0 agent assertion to satisfy an HHC-1 challenge', () => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime, {
      action: 'join_dispute',
      level: 'HHC-1',
      methods: ['fresh_user_phrase'],
    });
    expect(
      satisfy(runtime, challenge, 'agent_assertion', TRUSTED_RELAY_EXPRESSION_ADAPTER_V1, now()),
    ).toMatchObject({ status: 'rejected', reason_code: 'method_not_permitted' });
  });

  it('represents HHC-0 as an agent assertion with no independent intent assurance', () => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime, {
      action: 'test_only_protected_action',
      level: 'HHC-0',
      methods: ['agent_assertion'],
    });
    expect(
      satisfy(runtime, challenge, 'agent_assertion', TRUSTED_RELAY_EXPRESSION_ADAPTER_V1, now(), {
        action: 'test_only_protected_action',
      }),
    ).toMatchObject({
      status: 'satisfied',
      receipt: {
        achieved_assurance: 'HHC-0',
        assurance_axes: {
          explicit_intent: 'not_established',
          physical_human_presence: 'not_proven',
          repudiation_resistance: 'none',
        },
      },
    });
  });

  it('binds HHC-1 fresh expression to the exact public challenge reference', () => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime, {
      action: 'join_dispute',
      level: 'HHC-1',
      methods: ['fresh_user_phrase'],
    });
    const wrong = evidence('fresh_user_phrase', challenge, now());
    if (wrong.method !== 'fresh_user_phrase') throw new Error('unexpected evidence');
    wrong.expression = 'I CONFIRM OTHER-999';
    expect(
      satisfy(runtime, challenge, 'fresh_user_phrase', TRUSTED_RELAY_EXPRESSION_ADAPTER_V1, now(), {
        evidence: wrong,
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'invalid_evidence' });
    expect(
      satisfy(runtime, challenge, 'fresh_user_phrase', TRUSTED_RELAY_EXPRESSION_ADAPTER_V1, now()),
    ).toMatchObject({ status: 'satisfied', receipt: { achieved_assurance: 'HHC-1' } });
  });

  it.each([
    ['agent_assertion', { assertion: 42 }],
    ['fresh_user_phrase', { expression: { supplied: 'by caller' } }],
  ] as const)('rejects non-string %s evidence without throwing', (method, malformedField) => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime, {
      action: method === 'agent_assertion' ? 'test_only_protected_action' : 'join_dispute',
      level: method === 'agent_assertion' ? 'HHC-0' : 'HHC-1',
      methods: [method],
    });
    const malformed = {
      ...evidence(method, challenge, now()),
      ...malformedField,
    } as unknown as IntentAssuranceEvidenceV1;
    expect(
      satisfy(runtime, challenge, method, TRUSTED_RELAY_EXPRESSION_ADAPTER_V1, now(), {
        action: challenge.requested_action,
        evidence: malformed,
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'invalid_evidence' });
  });

  it('records HHC-1 as fresh intent evidence without physical-human proof', () => {
    const axes = intentAssuranceAxesForMethodV1('fresh_user_phrase');
    expect(axes.explicit_intent).toBe('fresh_expression_observed');
    expect(axes.physical_human_presence).toBe('not_proven');
    expect(axes.repudiation_resistance).toBe('weak');
  });

  it.each([
    ['mcp_elicitation', TRUSTED_MCP_ELICITATION_ADAPTER_V1, 'mcp_client'],
    ['platform_native_approval', TRUSTED_PLATFORM_APPROVAL_ADAPTER_V1, 'platform_client'],
  ] as const)(
    'records %s as client-mediated intent without claiming human presence',
    (method, authority, channel) => {
      const { runtime, now } = harness();
      const challenge = issueChallenge(runtime, {
        action: 'agree_binding_treatment',
        level: 'HHC-2',
        methods: [method],
      });
      const result = satisfy(runtime, challenge, method, authority, now(), {
        action: 'agree_binding_treatment',
      });
      expect(result).toMatchObject({
        status: 'satisfied',
        receipt: {
          achieved_assurance: 'HHC-2',
          assurance_axes: {
            explicit_intent: 'client_mediated_approval',
            physical_human_presence: 'not_proven',
          },
          interaction_provenance: { channel, claim_source: 'client_claim' },
        },
      });
    },
  );

  it('allows HHC-3 only through the trusted first-party ceremony adapter', () => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime);
    const forged = {
      ...TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
    } as TrustedIntentAssuranceAdapterAuthorityV1;
    expect(satisfy(runtime, challenge, 'first_party_ceremony', forged, now())).toMatchObject({
      status: 'rejected',
      reason_code: 'untrusted_authority',
    });
    expect(
      satisfy(
        runtime,
        challenge,
        'first_party_ceremony',
        TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
        now(),
      ),
    ).toMatchObject({
      status: 'satisfied',
      receipt: {
        achieved_assurance: 'HHC-3',
        assurance_axes: {
          explicit_intent: 'first_party_ceremony_observed',
          physical_human_presence: 'not_proven',
          repudiation_resistance: 'server_verifiable',
        },
      },
    });
  });

  it('allows HHC-4 only through the trusted WebAuthn verifier boundary', () => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime, {
      action: 'release_settlement_funds',
      level: 'HHC-4',
      methods: ['webauthn_user_verification'],
    });
    expect(
      satisfy(
        runtime,
        challenge,
        'webauthn_user_verification',
        TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
        now(),
        {
          action: 'release_settlement_funds',
        },
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'method_not_permitted' });
    expect(
      satisfy(
        runtime,
        challenge,
        'webauthn_user_verification',
        TRUSTED_WEBAUTHN_VERIFIER_ADAPTER_V1,
        now(),
        {
          action: 'release_settlement_funds',
        },
      ),
    ).toMatchObject({
      status: 'satisfied',
      receipt: {
        achieved_assurance: 'HHC-4',
        assurance_axes: {
          account_control: 'credential_user_verified',
          physical_human_presence: 'authenticator_user_verification',
          repudiation_resistance: 'cryptographically_verifiable',
        },
      },
    });
  });

  it.each(['mcp_elicitation', 'first_party_ceremony', 'webauthn_user_verification'] as const)(
    'does not let external input self-assert trusted %s adapter authority',
    (method) => {
      const { runtime, now } = harness();
      const level =
        method === 'mcp_elicitation'
          ? 'HHC-2'
          : method === 'first_party_ceremony'
            ? 'HHC-3'
            : 'HHC-4';
      const challenge = issueChallenge(runtime, {
        action:
          method === 'mcp_elicitation'
            ? 'agree_binding_treatment'
            : method === 'webauthn_user_verification'
              ? 'release_settlement_funds'
              : 'confirm_case_account',
        level,
        methods: [method],
      });
      const fabricated = {
        authority_kind: 'trusted_intent_assurance_adapter_v1',
        adapter_id: 'caller_claimed_adapter',
        permitted_methods: [method],
      } as unknown as TrustedIntentAssuranceAdapterAuthorityV1;
      expect(isTrustedIntentAssuranceAdapterAuthorityV1(fabricated)).toBe(false);
      expect(
        satisfy(runtime, challenge, method, fabricated, now(), {
          action: challenge.requested_action,
        }),
      ).toMatchObject({ status: 'rejected', reason_code: 'untrusted_authority' });
    },
  );

  it('does not authorize a different action', () => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime);
    expect(
      satisfy(
        runtime,
        challenge,
        'first_party_ceremony',
        TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
        now(),
        {
          action: 'reopen_confirmed_material',
        },
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'action_mismatch' });
  });

  it('does not authorize a modified payload', () => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime);
    expect(
      satisfy(
        runtime,
        challenge,
        'first_party_ceremony',
        TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
        now(),
        {
          payload: {
            confirmation_version: PARTY_CONFIRMATION_VERSION_V211,
            confirmation_id: 'confirmation_party_a_changed',
            adopt: true,
          },
        },
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'payload_mismatch' });
  });

  it.each([
    ['projection hash', { party_projection_hash: HASH_B }],
    ['party-visible version', { party_visible_version: 8 }],
    ['formation epoch', { formation_epoch: 3 }],
    ['authenticated subject', { authenticated_subject_id: 'subject_party_b' }],
    ['party binding', { party_id: 'party_b' as const }],
    ['dispute', { dispute_id: 'dispute_assurance_2' }],
    [
      'projection contract',
      { party_projection_contract_version: 'juryai-party-formation-projection-v9.0.0' },
    ],
  ])('rejects without rebasing when %s changes', (_label, stateChange) => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime);
    expect(
      satisfy(
        runtime,
        challenge,
        'first_party_ceremony',
        TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
        now(),
        {
          state: binding(stateChange),
        },
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'state_changed' });
  });

  it('rejects an expired challenge', () => {
    const { runtime, now, advance } = harness();
    const challenge = issueChallenge(runtime, { expires: 1 });
    advance(2);
    expect(
      satisfy(
        runtime,
        challenge,
        'first_party_ceremony',
        TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
        now(),
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'expired' });
  });

  it('consumes a satisfied authorization exactly once and returns an unforgeable action grant', () => {
    const { runtime, now, advance } = harness();
    const challenge = issueChallenge(runtime);
    const satisfied = satisfy(
      runtime,
      challenge,
      'first_party_ceremony',
      TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
      now(),
    );
    expect(satisfied.status).toBe('satisfied');
    if (satisfied.status !== 'satisfied') throw new Error(satisfied.message);
    expect(isVerifiedIntentAssuranceReceiptV1(satisfied.verified_receipt)).toBe(true);
    advance(1);
    const consumed = runtime.consumeAuthorization(
      {
        challenge: satisfied.challenge,
        verified_receipt: satisfied.verified_receipt,
        current_state_binding: resolvedBinding(),
        requested_action: 'confirm_case_account',
        action_payload: ACTION_PAYLOAD,
      },
      TRUSTED_PROTECTED_ACTION_EXECUTOR_V1,
    );
    expect(consumed.status).toBe('consumed');
    if (consumed.status !== 'consumed') throw new Error(consumed.message);
    expect(validateIntentAssuranceConsumptionV1(consumed.consumption)).toEqual([]);
    expect(isProtectedActionAuthorizationV1(consumed.authorization)).toBe(true);
    expect(isProtectedActionAuthorizationV1({ ...consumed.authorization })).toBe(false);
    expect(
      protectedActionAuthorizationMatchesV1(
        consumed.authorization,
        resolvedBinding(),
        'confirm_case_account',
        ACTION_PAYLOAD,
      ),
    ).toBe(true);
    expect(
      protectedActionAuthorizationMatchesV1(
        consumed.authorization,
        resolvedBinding({ party_projection_hash: HASH_B }),
        'confirm_case_account',
        ACTION_PAYLOAD,
      ),
    ).toBe(false);
    expect(
      protectedActionAuthorizationMatchesV1(
        consumed.authorization,
        resolvedBinding(),
        'confirm_case_account',
        { ...ACTION_PAYLOAD, confirmation_id: 'confirmation_party_a_changed' },
      ),
    ).toBe(false);
    expect(
      protectedActionAuthorizationMatchesV1(
        { ...consumed.authorization },
        resolvedBinding(),
        'confirm_case_account',
        ACTION_PAYLOAD,
      ),
    ).toBe(false);
    expect(
      runtime.consumeAuthorization(
        {
          challenge: satisfied.challenge,
          verified_receipt: satisfied.verified_receipt,
          current_state_binding: resolvedBinding(),
          requested_action: 'confirm_case_account',
          action_payload: ACTION_PAYLOAD,
        },
        TRUSTED_PROTECTED_ACTION_EXECUTOR_V1,
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'already_used' });
    expect(
      runtime.consumeAuthorization(
        {
          challenge: consumed.challenge,
          verified_receipt: satisfied.verified_receipt,
          current_state_binding: resolvedBinding(),
          requested_action: 'confirm_case_account',
          action_payload: ACTION_PAYLOAD,
        },
        TRUSTED_PROTECTED_ACTION_EXECUTOR_V1,
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'already_used' });
  });

  it('atomically claims challenge satisfaction by id before a replay can mint another receipt', () => {
    const { runtime, now } = harness();
    const pending = issueChallenge(runtime);
    const first = satisfy(
      runtime,
      pending,
      'first_party_ceremony',
      TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
      now(),
    );
    expect(first.status).toBe('satisfied');
    expect(
      satisfy(
        runtime,
        pending,
        'first_party_ceremony',
        TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
        now(),
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'already_used' });
  });

  it('does not allow one challenge receipt to authorize another challenge', () => {
    const { runtime, now } = harness();
    const first = issueChallenge(runtime);
    const second = issueChallenge(runtime);
    const satisfied = satisfy(
      runtime,
      first,
      'first_party_ceremony',
      TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
      now(),
    );
    if (satisfied.status !== 'satisfied') throw new Error(satisfied.message);
    const secondSatisfied = cloneCanonical(second);
    secondSatisfied.status = 'satisfied';
    secondSatisfied.satisfied_at = satisfied.receipt.completed_at;
    secondSatisfied.satisfied_by_receipt_id = satisfied.receipt.receipt_id;
    expect(
      runtime.consumeAuthorization(
        {
          challenge: secondSatisfied,
          verified_receipt: satisfied.verified_receipt,
          current_state_binding: resolvedBinding(),
          requested_action: 'confirm_case_account',
          action_payload: ACTION_PAYLOAD,
        },
        TRUSTED_PROTECTED_ACTION_EXECUTOR_V1,
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'invalid_receipt' });
  });

  it.each([
    [
      'another party',
      { authenticated_subject_id: 'subject_party_b', party_id: 'party_b' as const },
    ],
    ['another dispute', { dispute_id: 'dispute_assurance_2' }],
  ])('does not reuse a satisfied receipt for %s', (_label, stateChange) => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime);
    const satisfied = satisfy(
      runtime,
      challenge,
      'first_party_ceremony',
      TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
      now(),
    );
    if (satisfied.status !== 'satisfied') throw new Error(satisfied.message);
    expect(
      runtime.consumeAuthorization(
        {
          challenge: satisfied.challenge,
          verified_receipt: satisfied.verified_receipt,
          current_state_binding: resolvedBinding(stateChange),
          requested_action: 'confirm_case_account',
          action_payload: ACTION_PAYLOAD,
        },
        TRUSTED_PROTECTED_ACTION_EXECUTOR_V1,
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'state_changed' });
  });

  it('rejects a canonically permitted method below the required assurance', () => {
    const { runtime } = harness();
    const issued = runtime.issueChallenge(
      {
        state_binding: resolvedBinding(),
        requested_action: 'join_dispute',
        action_payload: ACTION_PAYLOAD,
        policy_decision: resolveIntentAssurancePolicyDecisionV1(
          'join_dispute',
          profile(),
          TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
        )!,
        permitted_methods: ['agent_assertion'],
        expires_in_seconds: 300,
      },
      TRUSTED_HUMAN_HANDOFF_ISSUER_V1,
    );
    expect(issued).toMatchObject({ status: 'rejected', reason_code: 'invalid_challenge' });
  });

  it('keeps contactability, account control, intent, identity, presence, and repudiation distinct', () => {
    expect(Object.keys(intentAssuranceAxesForMethodV1('mcp_elicitation')).sort()).toEqual([
      'account_control',
      'contactability',
      'explicit_intent',
      'physical_human_presence',
      'real_world_identity_authority',
      'repudiation_resistance',
    ]);
    expect(intentAssuranceAxesForMethodV1('first_party_ceremony')).toMatchObject({
      contactability: 'not_assessed',
      real_world_identity_authority: 'not_assessed',
      physical_human_presence: 'not_proven',
    });
  });

  it('does not treat email or account assurance as explicit action intent', () => {
    expect(INTENT_ASSURANCE_METHODS_V1).not.toContain('email');
    expect(INTENT_ASSURANCE_METHODS_V1).not.toContain('otp');
    const axes = intentAssuranceAxesForMethodV1('agent_assertion');
    axes.contactability = 'verified_contact_channel';
    axes.account_control = 'authenticated_session_observed';
    expect(axes.explicit_intent).toBe('not_established');
  });

  it('rejects malformed receipt axes rather than accepting a claimed upgrade', () => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime, {
      action: 'join_dispute',
      level: 'HHC-1',
      methods: ['fresh_user_phrase'],
    });
    const result = satisfy(
      runtime,
      challenge,
      'fresh_user_phrase',
      TRUSTED_RELAY_EXPRESSION_ADAPTER_V1,
      now(),
      {
        action: 'join_dispute',
      },
    );
    if (result.status !== 'satisfied') throw new Error(result.message);
    const malformed = cloneCanonical(result.receipt);
    malformed.assurance_axes.physical_human_presence = 'authenticator_user_verification';
    expect(validateIntentAssuranceReceiptV1(malformed).map((item) => item.code)).toContain(
      'intent_assurance_receipt_axes',
    );
  });

  it('rejects receipt provenance or adapter identity that claims another method', () => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime);
    const result = satisfy(
      runtime,
      challenge,
      'first_party_ceremony',
      TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
      now(),
    );
    if (result.status !== 'satisfied') throw new Error(result.message);
    const badProvenance = cloneCanonical(result.receipt);
    badProvenance.interaction_provenance.channel = 'mcp_client';
    expect(validateIntentAssuranceReceiptV1(badProvenance).map((item) => item.code)).toContain(
      'intent_assurance_receipt_provenance_method',
    );
    const badAdapter = cloneCanonical(result.receipt);
    badAdapter.verifier_adapter_id = TRUSTED_MCP_ELICITATION_ADAPTER_V1.adapter_id;
    expect(validateIntentAssuranceReceiptV1(badAdapter).map((item) => item.code)).toContain(
      'intent_assurance_receipt_adapter_method',
    );
  });

  it('does not grant authority to a structurally valid raw or copied receipt', () => {
    const { runtime, now } = harness();
    const challenge = issueChallenge(runtime);
    const result = satisfy(
      runtime,
      challenge,
      'first_party_ceremony',
      TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
      now(),
    );
    if (result.status !== 'satisfied') throw new Error(result.message);
    expect(validateIntentAssuranceReceiptV1(result.receipt)).toEqual([]);
    expect(isVerifiedIntentAssuranceReceiptV1(result.receipt)).toBe(false);
    expect(isVerifiedIntentAssuranceReceiptV1({ ...result.verified_receipt })).toBe(false);
    expect(
      runtime.consumeAuthorization(
        {
          challenge: result.challenge,
          verified_receipt: result.receipt as unknown as VerifiedIntentAssuranceReceiptV1,
          current_state_binding: resolvedBinding(),
          requested_action: 'confirm_case_account',
          action_payload: ACTION_PAYLOAD,
        },
        TRUSTED_PROTECTED_ACTION_EXECUTOR_V1,
      ),
    ).toMatchObject({ status: 'rejected', reason_code: 'untrusted_authority' });
  });

  it('invalidates a pending or satisfied challenge and never rebases it', () => {
    const { runtime, now } = harness();
    const pending = issueChallenge(runtime);
    expect(
      runtime.invalidateChallenge(pending, 'state_changed', TRUSTED_HUMAN_HANDOFF_ISSUER_V1),
    ).toMatchObject({ status: 'invalidated', invalidation_reason: 'state_changed' });
    const another = issueChallenge(runtime);
    const satisfied = satisfy(
      runtime,
      another,
      'first_party_ceremony',
      TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
      now(),
    );
    if (satisfied.status !== 'satisfied') throw new Error(satisfied.message);
    const invalidated = runtime.invalidateChallenge(
      satisfied.challenge,
      'policy_changed',
      TRUSTED_HUMAN_HANDOFF_ISSUER_V1,
    );
    expect(invalidated).toMatchObject({
      status: 'invalidated',
      invalidation_reason: 'policy_changed',
    });
    expect(
      runtime.invalidateChallenge(invalidated!, 'cancelled', TRUSTED_HUMAN_HANDOFF_ISSUER_V1),
    ).toBeNull();
    expect(
      runtime.consumeAuthorization(
        {
          challenge: invalidated!,
          verified_receipt: satisfied.verified_receipt,
          current_state_binding: resolvedBinding(),
          requested_action: 'confirm_case_account',
          action_payload: ACTION_PAYLOAD,
        },
        TRUSTED_PROTECTED_ACTION_EXECUTOR_V1,
      ),
    ).toMatchObject({ status: 'rejected' });
  });

  it('keeps the existing V2.1.1 PartyConfirmation contract unchanged and gates its future exact payload externally', () => {
    expect(PARTY_CONFIRMATION_VERSION_V211).toBe('juryai-party-confirmation-v2.1.1');
    const source = readFileSync(resolve(process.cwd(), 'src/v2-1-1/case-envelope.ts'), 'utf8');
    expect(source).not.toMatch(/intent-assurance|HumanHandoff|HHC-/u);
    expect(hashIntentAssuranceActionPayloadV1('confirm_case_account', ACTION_PAYLOAD)).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });

  it('keeps PR 4B unreachable from production composition and preserves exactly three tools', () => {
    for (const path of [
      'src/webmcp/server/production.ts',
      'src/webmcp/server/server.ts',
      'src/webmcp/browser/entry.ts',
      'src/v2-1-1/webmcp-application.ts',
    ]) {
      expect(readFileSync(resolve(process.cwd(), path), 'utf8'), path).not.toMatch(
        /intent-assurance|human-handoff|HHC-/iu,
      );
    }
    const service: CaseServicePort = {
      startCase: async () => ({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: '', retryable: false },
      }),
      getCaseState: async () => ({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: '', retryable: false },
      }),
      submitTurn: async () => ({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: '', retryable: false },
      }),
    };
    expect(createJuryAiToolDefinitions(service).map((tool) => tool.name)).toEqual([
      'start_case',
      'get_case_state',
      'submit_turn',
    ]);
    expect(INTENT_ASSURANCE_ACTIONS_V1).not.toContain('human_confirmed');
  });
});
