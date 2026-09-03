import {
  INTENT_ASSURANCE_METHODS_V1,
  TRUSTED_HUMAN_HANDOFF_ISSUER_V1,
  TRUSTED_INTENT_ASSURANCE_STATE_RESOLVER_V1,
  TRUSTED_PROTECTED_ACTION_EXECUTOR_V1,
  consumeDurableIntentAssuranceEvidenceV1,
  createIntentAssuranceRuntimeV1,
  isResolvedIntentAssurancePolicyDecisionV1,
  protectedActionAuthorizationMatchesV1,
  resolveIntentAssuranceStateBindingV1,
  verifyDurableIntentAssuranceEvidenceV1,
  type HumanHandoffChallengeV1,
  type IntentAssuranceActionV1,
  type IntentAssuranceConsumptionV1,
  type IntentAssuranceMethodV1,
  type IntentAssuranceReceiptV1,
  type ObservedIntentAssuranceEvidenceV1,
  type ResolvedIntentAssurancePolicyDecisionV1,
} from '../intent-assurance/intent-assurance.js';
import { canonicalSerialize, cloneCanonical, type JsonValue } from '../v2/case-envelope.js';
import {
  ENVELOPE_COMMAND_VERSION_V211,
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  partyAuthorityV211,
  type CaseEnvelopeV211,
  type PartyIdV211,
} from './case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV211,
  ceremonyCommandForV211,
  type EnvelopeCeremonyCommandV211,
  type RecordPartyConfirmationOperationV211,
  type ReopenOwnFormationOperationV211,
} from './envelope-ceremony.js';
import {
  derivePartyConfirmationEligibilityV1,
  derivePartyReviewStateV1,
  validatePartyReviewStateV1,
  type PartyReviewStateV1,
} from './party-review-state.js';

export const PARTY_REVIEW_PROTECTED_ACTION_VERSION_V1 =
  'juryai-party-review-protected-action-v1.0.0';
export const PARTY_CONFIRMATION_ADOPTION_STATEMENT_V1 =
  'I adopt this exact account as my statement of the dispute.';

export type PartyReviewProtectedActionV1 = 'confirm_case_account' | 'reopen_confirmed_material';

type ProtectedCeremonyOperationV1 =
  RecordPartyConfirmationOperationV211 | ReopenOwnFormationOperationV211;

export interface PartyReviewProtectedActionPayloadV1 {
  protected_action_version: typeof PARTY_REVIEW_PROTECTED_ACTION_VERSION_V1;
  review_state_hash: string;
  party_readback_hash: string;
  ceremony_command: EnvelopeCeremonyCommandV211 & {
    operation: ProtectedCeremonyOperationV1;
  };
}

export interface PartyReviewActionIdsV1 {
  challenge_id: string;
  public_reference: string;
  command_id: string;
  confirmation_id?: string;
  confirmation_event_id?: string;
  reopen_event_id?: string;
}

export interface PreparePartyReviewChallengeInputV1 {
  envelope: CaseEnvelopeV211;
  authenticated_subject_id: string;
  requested_action: PartyReviewProtectedActionV1;
  current_policy_decision: ResolvedIntentAssurancePolicyDecisionV1;
  permitted_methods: IntentAssuranceMethodV1[];
  expires_in_seconds: number;
  issued_at: string;
  ids: PartyReviewActionIdsV1;
  reopen_reason?: string;
}

export type PreparePartyReviewChallengeResultV1 =
  | {
      status: 'prepared';
      party_id: PartyIdV211;
      review_state: PartyReviewStateV1;
      challenge: HumanHandoffChallengeV1;
      action_payload: PartyReviewProtectedActionPayloadV1;
    }
  | {
      status: 'rejected';
      reason_code: 'unavailable' | 'invalid_transition' | 'invalid_policy' | 'invalid_input';
      message: string;
    };

export type ExecutePartyReviewProtectedActionResultV1 =
  | {
      status: 'applied';
      party_id: PartyIdV211;
      envelope: CaseEnvelopeV211;
      challenge: HumanHandoffChallengeV1;
      receipt: IntentAssuranceReceiptV1;
      consumption: IntentAssuranceConsumptionV1;
      prior_review_state: PartyReviewStateV1;
      resulting_review_state: PartyReviewStateV1;
    }
  | {
      status: 'rejected';
      reason_code:
        | 'unavailable'
        | 'invalid_transition'
        | 'invalid_policy'
        | 'invalid_assurance'
        | 'payload_mismatch'
        | 'already_used'
        | 'state_changed';
      message: string;
    };

function partyForSubject(
  envelope: CaseEnvelopeV211,
  authenticatedSubjectId: string,
): PartyIdV211 | null {
  const parties = (['party_a', 'party_b'] as const).filter((partyId) => {
    const binding = envelope.parties[partyId];
    return (
      binding.identity_assurance === 'authenticated' &&
      binding.authenticated_subject_id === authenticatedSubjectId
    );
  });
  return parties.length === 1 ? parties[0]! : null;
}

function validIso(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function stateBinding(envelope: CaseEnvelopeV211, partyId: PartyIdV211) {
  const party = envelope.parties[partyId];
  const cursor = envelope.control.party_views[partyId];
  if (!party.authenticated_subject_id) return null;
  return resolveIntentAssuranceStateBindingV1(
    {
      authenticated_subject_id: party.authenticated_subject_id,
      dispute_id: envelope.control.case_id,
      party_id: partyId,
      party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
      party_projection_hash: cursor.party_projection_hash,
      party_visible_version: cursor.party_visible_version,
      formation_epoch: party.formation_epoch,
    },
    TRUSTED_INTENT_ASSURANCE_STATE_RESOLVER_V1,
  );
}

function operationFor(
  input: PreparePartyReviewChallengeInputV1,
  partyId: PartyIdV211,
): ProtectedCeremonyOperationV1 | null {
  if (input.requested_action === 'confirm_case_account') {
    if (!input.ids.confirmation_id || !input.ids.confirmation_event_id) return null;
    return {
      type: 'record_party_confirmation',
      confirmation_id: input.ids.confirmation_id,
      event_id: input.ids.confirmation_event_id,
      adoption_statement: PARTY_CONFIRMATION_ADOPTION_STATEMENT_V1,
      confirmed_at: input.issued_at,
    };
  }
  if (!input.ids.reopen_event_id || !input.reopen_reason?.trim()) return null;
  return {
    type: 'reopen_own_formation',
    event_id: input.ids.reopen_event_id,
    reason: input.reopen_reason,
    occurred_at: input.issued_at,
  };
}

export function validatePartyReviewProtectedActionPayloadV1(
  value: unknown,
  action?: PartyReviewProtectedActionV1,
): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(payload).sort()) !==
      JSON.stringify(
        [
          'ceremony_command',
          'party_readback_hash',
          'protected_action_version',
          'review_state_hash',
        ].sort(),
      ) ||
    payload.protected_action_version !== PARTY_REVIEW_PROTECTED_ACTION_VERSION_V1 ||
    typeof payload.review_state_hash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(payload.review_state_hash) ||
    typeof payload.party_readback_hash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(payload.party_readback_hash) ||
    typeof payload.ceremony_command !== 'object' ||
    payload.ceremony_command === null ||
    Array.isArray(payload.ceremony_command)
  ) {
    return false;
  }
  const command = payload.ceremony_command as Record<string, unknown>;
  if (
    command.command_version !== ENVELOPE_COMMAND_VERSION_V211 ||
    typeof command.operation !== 'object' ||
    command.operation === null ||
    Array.isArray(command.operation)
  ) {
    return false;
  }
  const operation = command.operation as Record<string, unknown>;
  if (action === 'confirm_case_account' && operation.type !== 'record_party_confirmation') {
    return false;
  }
  if (action === 'reopen_confirmed_material' && operation.type !== 'reopen_own_formation') {
    return false;
  }
  try {
    canonicalSerialize(payload as JsonValue);
  } catch {
    return false;
  }
  return true;
}

function policyMatchesAction(
  decision: ResolvedIntentAssurancePolicyDecisionV1,
  action: IntentAssuranceActionV1,
): boolean {
  return (
    isResolvedIntentAssurancePolicyDecisionV1(decision) &&
    decision.decision.requested_action === action
  );
}

export function preparePartyReviewChallengeV1(
  input: PreparePartyReviewChallengeInputV1,
): PreparePartyReviewChallengeResultV1 {
  const partyId = partyForSubject(input.envelope, input.authenticated_subject_id);
  if (!partyId) {
    return { status: 'rejected', reason_code: 'unavailable', message: 'Review is unavailable.' };
  }
  if (
    !policyMatchesAction(input.current_policy_decision, input.requested_action) ||
    !Array.isArray(input.permitted_methods) ||
    input.permitted_methods.length === 0 ||
    input.permitted_methods.some((method) => !INTENT_ASSURANCE_METHODS_V1.includes(method as never))
  ) {
    return {
      status: 'rejected',
      reason_code: 'invalid_policy',
      message: 'Server-resolved assurance policy is unavailable.',
    };
  }
  if (!validIso(input.issued_at)) {
    return {
      status: 'rejected',
      reason_code: 'invalid_input',
      message: 'Review action is invalid.',
    };
  }
  if (input.requested_action === 'confirm_case_account') {
    const eligibility = derivePartyConfirmationEligibilityV1(input.envelope, partyId);
    if (!eligibility.eligible) {
      return {
        status: 'rejected',
        reason_code: 'invalid_transition',
        message: 'Confirmation is not available for the current review state.',
      };
    }
  }
  const operation = operationFor(input, partyId);
  if (!operation) {
    return {
      status: 'rejected',
      reason_code: 'invalid_input',
      message: 'Review action is invalid.',
    };
  }
  const authority = partyAuthorityV211(input.envelope, partyId, 'first_party_human');
  const command = ceremonyCommandForV211(input.envelope, input.ids.command_id, operation);
  const dryRun = applyEnvelopeCeremonyCommandV211({
    envelope: input.envelope,
    command,
    execution_authority: authority,
  });
  if (dryRun.status !== 'applied') {
    return {
      status: 'rejected',
      reason_code: 'invalid_transition',
      message: 'Protected action is not available for the current review state.',
    };
  }
  const reviewState = derivePartyReviewStateV1(input.envelope, partyId);
  if (validatePartyReviewStateV1(reviewState).length > 0) {
    return {
      status: 'rejected',
      reason_code: 'invalid_transition',
      message: 'Canonical review state is invalid.',
    };
  }
  const actionPayload: PartyReviewProtectedActionPayloadV1 = {
    protected_action_version: PARTY_REVIEW_PROTECTED_ACTION_VERSION_V1,
    review_state_hash: reviewState.review_state_hash,
    party_readback_hash: reviewState.party_readback_hash,
    ceremony_command: command as PartyReviewProtectedActionPayloadV1['ceremony_command'],
  };
  const binding = stateBinding(input.envelope, partyId);
  if (
    !binding ||
    !validatePartyReviewProtectedActionPayloadV1(actionPayload, input.requested_action)
  ) {
    return {
      status: 'rejected',
      reason_code: 'invalid_transition',
      message: 'Canonical protected action is invalid.',
    };
  }
  const runtime = createIntentAssuranceRuntimeV1({
    now: () => input.issued_at,
    mint_challenge_id: () => input.ids.challenge_id,
    mint_receipt_id: () => 'assurance_receipt_issue_only',
    mint_consumption_id: () => 'assurance_consumption_issue_only',
    mint_public_reference: () => input.ids.public_reference,
  });
  const issued = runtime.issueChallenge(
    {
      state_binding: binding,
      requested_action: input.requested_action,
      action_payload: actionPayload as unknown as JsonValue,
      policy_decision: input.current_policy_decision,
      permitted_methods: [...input.permitted_methods],
      expires_in_seconds: input.expires_in_seconds,
    },
    TRUSTED_HUMAN_HANDOFF_ISSUER_V1,
  );
  if (issued.status !== 'issued') {
    return {
      status: 'rejected',
      reason_code: issued.reason_code === 'invalid_policy' ? 'invalid_policy' : 'invalid_input',
      message: 'Protected review challenge could not be issued.',
    };
  }
  return {
    status: 'prepared',
    party_id: partyId,
    review_state: reviewState,
    challenge: issued.challenge,
    action_payload: cloneCanonical(actionPayload),
  };
}

export function executePartyReviewProtectedActionV1(input: {
  envelope: CaseEnvelopeV211;
  authenticated_subject_id: string;
  challenge: HumanHandoffChallengeV1;
  action_payload: PartyReviewProtectedActionPayloadV1;
  expected_action: PartyReviewProtectedActionV1;
  current_policy_decision: ResolvedIntentAssurancePolicyDecisionV1;
  observed_evidence: ObservedIntentAssuranceEvidenceV1;
  completed_at: string;
  consumed_at: string;
  receipt_id: string;
  consumption_id: string;
}): ExecutePartyReviewProtectedActionResultV1 {
  const partyId = partyForSubject(input.envelope, input.authenticated_subject_id);
  if (!partyId || input.challenge.party_id !== partyId) {
    return { status: 'rejected', reason_code: 'unavailable', message: 'Review is unavailable.' };
  }
  if (
    !policyMatchesAction(input.current_policy_decision, input.expected_action) ||
    input.challenge.policy_version !== input.current_policy_decision.decision.policy_version ||
    input.challenge.policy_profile_id !== input.current_policy_decision.decision.profile_id ||
    input.challenge.required_minimum_assurance !==
      input.current_policy_decision.decision.required_minimum_assurance
  ) {
    return {
      status: 'rejected',
      reason_code: 'invalid_policy',
      message: 'Protected review policy changed.',
    };
  }
  if (!validatePartyReviewProtectedActionPayloadV1(input.action_payload, input.expected_action)) {
    return {
      status: 'rejected',
      reason_code: 'payload_mismatch',
      message: 'Protected review payload does not match the authorized action.',
    };
  }
  const priorReviewState = derivePartyReviewStateV1(input.envelope, partyId);
  if (
    input.action_payload.review_state_hash !== priorReviewState.review_state_hash ||
    input.action_payload.party_readback_hash !== priorReviewState.party_readback_hash
  ) {
    return {
      status: 'rejected',
      reason_code: 'state_changed',
      message: 'Protected review state changed.',
    };
  }
  if (input.expected_action === 'confirm_case_account') {
    const eligibility = derivePartyConfirmationEligibilityV1(input.envelope, partyId);
    if (!eligibility.eligible) {
      return {
        status: 'rejected',
        reason_code: 'invalid_transition',
        message: 'Confirmation is not available for the current review state.',
      };
    }
  }
  const binding = stateBinding(input.envelope, partyId);
  if (!binding) {
    return { status: 'rejected', reason_code: 'unavailable', message: 'Review is unavailable.' };
  }
  const verified = verifyDurableIntentAssuranceEvidenceV1({
    challenge: input.challenge,
    current_state_binding: binding,
    requested_action: input.expected_action,
    action_payload: input.action_payload as unknown as JsonValue,
    observed_evidence: input.observed_evidence,
    completed_at: input.completed_at,
  });
  if (verified.status !== 'verified') {
    return {
      status: 'rejected',
      reason_code:
        verified.reason_code === 'state_changed'
          ? 'state_changed'
          : verified.reason_code === 'payload_mismatch'
            ? 'payload_mismatch'
            : verified.reason_code === 'already_used'
              ? 'already_used'
              : 'invalid_assurance',
      message: 'Protected review assurance was rejected.',
    };
  }
  const consumed = consumeDurableIntentAssuranceEvidenceV1(
    {
      verified_evidence: verified.verified_evidence,
      receipt_id: input.receipt_id,
      consumption_id: input.consumption_id,
      consumed_at: input.consumed_at,
    },
    TRUSTED_PROTECTED_ACTION_EXECUTOR_V1,
  );
  if (
    consumed.status !== 'consumed' ||
    !protectedActionAuthorizationMatchesV1(
      consumed.status === 'consumed' ? consumed.authorization : null,
      binding,
      input.expected_action,
      input.action_payload as unknown as JsonValue,
    )
  ) {
    return {
      status: 'rejected',
      reason_code: 'invalid_assurance',
      message: 'Protected review assurance was rejected.',
    };
  }
  const applied = applyEnvelopeCeremonyCommandV211({
    envelope: input.envelope,
    command: input.action_payload.ceremony_command,
    execution_authority: partyAuthorityV211(input.envelope, partyId, 'first_party_human'),
  });
  if (applied.status !== 'applied') {
    return {
      status: 'rejected',
      reason_code:
        applied.reason_code === 'stale_base_hash' || applied.reason_code === 'stale_base_version'
          ? 'state_changed'
          : 'invalid_transition',
      message: 'Protected review action was rejected.',
    };
  }
  return {
    status: 'applied',
    party_id: partyId,
    envelope: applied.envelope,
    challenge: consumed.challenge,
    receipt: consumed.receipt,
    consumption: consumed.consumption,
    prior_review_state: priorReviewState,
    resulting_review_state: derivePartyReviewStateV1(applied.envelope, partyId),
  };
}

export interface PartyReviewPersistencePortV1 {
  getPartyReview(input: {
    dispute_id: string;
    authenticated_subject_id: string;
  }): Promise<PartyReviewStateV1 | null>;
  issuePartyReviewChallenge(input: {
    dispute_id: string;
    authenticated_subject_id: string;
    requested_action: PartyReviewProtectedActionV1;
    current_policy_decision: ResolvedIntentAssurancePolicyDecisionV1;
    permitted_methods: IntentAssuranceMethodV1[];
    expires_in_seconds: number;
    reopen_reason?: string;
  }): Promise<
    | { status: 'issued'; challenge: HumanHandoffChallengeV1; review_state: PartyReviewStateV1 }
    | { status: 'rejected'; reason_code: string; message: string }
  >;
  executePartyReviewAction(input: {
    dispute_id: string;
    authenticated_subject_id: string;
    challenge_id: string;
    expected_action: PartyReviewProtectedActionV1;
    current_policy_decision: ResolvedIntentAssurancePolicyDecisionV1;
    observed_evidence: ObservedIntentAssuranceEvidenceV1;
  }): Promise<
    | { status: 'applied'; review_state: PartyReviewStateV1 }
    | { status: 'rejected'; reason_code: string; message: string }
  >;
}

export interface PartyReviewApplicationV1 {
  getReview(caseId: string): Promise<PartyReviewStateV1 | null>;
  issueConfirmationChallenge(
    caseId: string,
  ): ReturnType<PartyReviewPersistencePortV1['issuePartyReviewChallenge']>;
  confirmCaseAccount(input: {
    case_id: string;
    challenge_id: string;
    observed_evidence: ObservedIntentAssuranceEvidenceV1;
  }): ReturnType<PartyReviewPersistencePortV1['executePartyReviewAction']>;
  issueReopenChallenge(input: {
    case_id: string;
    reason: string;
  }): ReturnType<PartyReviewPersistencePortV1['issuePartyReviewChallenge']>;
  reopenConfirmedMaterial(input: {
    case_id: string;
    challenge_id: string;
    observed_evidence: ObservedIntentAssuranceEvidenceV1;
  }): ReturnType<PartyReviewPersistencePortV1['executePartyReviewAction']>;
}

export function createPartyReviewApplicationV1(input: {
  authenticated_subject_id: string;
  repository: PartyReviewPersistencePortV1;
  resolve_policy: (action: PartyReviewProtectedActionV1) => ResolvedIntentAssurancePolicyDecisionV1;
  permitted_methods: (action: PartyReviewProtectedActionV1) => IntentAssuranceMethodV1[];
  challenge_ttl_seconds: number;
}): PartyReviewApplicationV1 {
  const policy = (action: PartyReviewProtectedActionV1) => input.resolve_policy(action);
  return {
    getReview: (caseId) =>
      input.repository.getPartyReview({
        dispute_id: caseId,
        authenticated_subject_id: input.authenticated_subject_id,
      }),
    issueConfirmationChallenge: (caseId) =>
      input.repository.issuePartyReviewChallenge({
        dispute_id: caseId,
        authenticated_subject_id: input.authenticated_subject_id,
        requested_action: 'confirm_case_account',
        current_policy_decision: policy('confirm_case_account'),
        permitted_methods: input.permitted_methods('confirm_case_account'),
        expires_in_seconds: input.challenge_ttl_seconds,
      }),
    confirmCaseAccount: (request) =>
      input.repository.executePartyReviewAction({
        dispute_id: request.case_id,
        authenticated_subject_id: input.authenticated_subject_id,
        challenge_id: request.challenge_id,
        expected_action: 'confirm_case_account',
        current_policy_decision: policy('confirm_case_account'),
        observed_evidence: request.observed_evidence,
      }),
    issueReopenChallenge: (request) =>
      input.repository.issuePartyReviewChallenge({
        dispute_id: request.case_id,
        authenticated_subject_id: input.authenticated_subject_id,
        requested_action: 'reopen_confirmed_material',
        current_policy_decision: policy('reopen_confirmed_material'),
        permitted_methods: input.permitted_methods('reopen_confirmed_material'),
        expires_in_seconds: input.challenge_ttl_seconds,
        reopen_reason: request.reason,
      }),
    reopenConfirmedMaterial: (request) =>
      input.repository.executePartyReviewAction({
        dispute_id: request.case_id,
        authenticated_subject_id: input.authenticated_subject_id,
        challenge_id: request.challenge_id,
        expected_action: 'reopen_confirmed_material',
        current_policy_decision: policy('reopen_confirmed_material'),
        observed_evidence: request.observed_evidence,
      }),
  };
}
