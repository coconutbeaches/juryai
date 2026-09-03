import { cloneCanonical } from '../v2/case-envelope.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V211,
  ENVELOPE_COMMAND_VERSION_V211,
  FORMATION_PROTOCOL_VERSION_V211,
  FORMATION_READINESS_VERSION_V211,
  hashCaseEnvelopeV211,
  partyAuthorityV211,
  type CaseEnvelopeV211,
} from '../v2-1-1/case-envelope.js';
import {
  applyExternalRelaySubmissionV211,
  conflictTurnSummariesForPartyV211,
  prepareExternalRelaySubmissionV211,
  type ApplyExternalRelaySubmissionResultV211,
  type ExternalRelaySubmissionV211,
  type PrepareExternalRelaySubmissionResultV211,
} from '../v2-1-1/external-relay-submission.js';
import { authoritativeFormationExplanatoryStateV211 } from '../v2-1-1/formation-readiness.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V212,
  ENVELOPE_COMMAND_VERSION_V212,
  FORMATION_PROTOCOL_VERSION_V212,
  FORMATION_READINESS_VERSION_V212,
  cloneCaseEnvelopeV212,
  hashCaseEnvelopeV212,
  isAuthenticatedPartyAuthorityV212,
  type AuthenticatedPartyAuthorityV212,
  type CaseEnvelopeV212,
  type PartyIdV212,
} from './case-envelope.js';
import { assertValidCaseEnvelopeV212, validateCaseEnvelopeV212 } from './contract-validator.js';
import { authoritativeFormationExplanatoryStateV212 } from './formation-readiness.js';

export {
  TRUSTED_EXTERNAL_RELAY_BRIDGE_V211,
  trustedExternalRelayRuntimeV211,
  type ExternalRelayCompilerIdentityV211,
  type ExternalRelayEffectCandidateV211,
  type ExternalRelaySubmissionIntentV211,
  type ExternalRelaySubmissionV211,
  type TrustedExternalRelayRuntimeV211,
} from '../v2-1-1/external-relay-submission.js';

export type ApplyExternalRelaySubmissionResultV212 =
  | (Omit<Extract<ApplyExternalRelaySubmissionResultV211, { status: 'applied' }>, 'envelope'> & {
      envelope: CaseEnvelopeV212;
    })
  | (Omit<Extract<ApplyExternalRelaySubmissionResultV211, { status: 'rejected' }>, 'envelope'> & {
      envelope: CaseEnvelopeV212;
    });

export function frozenRelayExecutionViewV211(envelope: CaseEnvelopeV212): CaseEnvelopeV211 {
  const view = cloneCanonical(envelope) as unknown as CaseEnvelopeV211;
  delete (view.formation as unknown as Record<string, unknown>).disclosure_review_acknowledgments;
  view.control.schema_version = CASE_ENVELOPE_SCHEMA_VERSION_V211;
  view.control.protocol_version = FORMATION_PROTOCOL_VERSION_V211;
  view.control.command_contract_version = ENVELOPE_COMMAND_VERSION_V211;
  view.control.readiness_contract_version = FORMATION_READINESS_VERSION_V211;
  view.formation.explanatory = authoritativeFormationExplanatoryStateV211(view);
  view.control.envelope_hash = hashCaseEnvelopeV211(view);
  return view;
}

function restoreV212RelayResult(
  before: CaseEnvelopeV212,
  applied: Extract<ApplyExternalRelaySubmissionResultV211, { status: 'applied' }>,
): CaseEnvelopeV212 {
  const candidate = cloneCanonical(applied.envelope) as unknown as CaseEnvelopeV212;
  candidate.control.schema_version = CASE_ENVELOPE_SCHEMA_VERSION_V212;
  candidate.control.protocol_version = FORMATION_PROTOCOL_VERSION_V212;
  candidate.control.command_contract_version = ENVELOPE_COMMAND_VERSION_V212;
  candidate.control.readiness_contract_version = FORMATION_READINESS_VERSION_V212;
  candidate.formation.disclosure_review_acknowledgments = cloneCanonical(
    before.formation.disclosure_review_acknowledgments,
  );
  candidate.formation.explanatory = authoritativeFormationExplanatoryStateV212(candidate);
  candidate.control.envelope_hash = hashCaseEnvelopeV212(candidate);
  assertValidCaseEnvelopeV212(candidate);
  return candidate;
}

export function prepareExternalRelaySubmissionV212(
  input: Omit<
    Parameters<typeof prepareExternalRelaySubmissionV211>[0],
    'envelope' | 'execution_authority'
  > & {
    envelope: CaseEnvelopeV212;
    execution_authority: AuthenticatedPartyAuthorityV212;
  },
): PrepareExternalRelaySubmissionResultV211 {
  const issues = validateCaseEnvelopeV212(input.envelope);
  const authority = input.execution_authority;
  if (
    issues.length > 0 ||
    !isAuthenticatedPartyAuthorityV212(authority) ||
    authority.interaction_authority !== 'external_relay' ||
    input.envelope.parties[authority.party_id].authenticated_subject_id !==
      authority.authenticated_subject_id
  ) {
    return {
      status: 'rejected',
      reason_code: issues.length > 0 ? 'invalid_intent' : 'unauthorized_actor',
      message: issues[0]?.message ?? 'Server-derived external relay authority is required.',
    };
  }
  return prepareExternalRelaySubmissionV211({
    ...input,
    envelope: input.envelope as unknown as CaseEnvelopeV211,
    execution_authority: partyAuthorityV211(
      input.envelope as unknown as CaseEnvelopeV211,
      authority.party_id,
      'external_relay',
    ),
  });
}

export function rebaseExternalRelaySubmissionV212(
  submission: ExternalRelaySubmissionV211,
  current: CaseEnvelopeV212,
): ExternalRelaySubmissionV211 | null {
  const partyId = submission.source_turn.attributed_party_id;
  const cursor = current.control.party_views[partyId];
  if (
    current.control.case_id !== submission.dispute_id ||
    cursor.party_visible_version !== submission.base_party_visible_version ||
    cursor.party_projection_hash !== submission.base_party_projection_hash
  ) {
    return null;
  }
  return {
    ...cloneCanonical(submission),
    base_internal_envelope_version: current.control.envelope_version,
    base_internal_envelope_hash: current.control.envelope_hash,
  };
}

export function applyExternalRelaySubmissionV212(input: {
  envelope: CaseEnvelopeV212;
  submission: ExternalRelaySubmissionV211;
  execution_authority: AuthenticatedPartyAuthorityV212;
}): ApplyExternalRelaySubmissionResultV212 {
  const { envelope, submission, execution_authority: authority } = input;
  const inputIssues = validateCaseEnvelopeV212(envelope);
  if (inputIssues.length > 0) {
    return {
      status: 'rejected',
      reason_code: 'invalid_envelope',
      message: inputIssues[0]!.message,
      issues: inputIssues,
      envelope: cloneCaseEnvelopeV212(envelope),
      prior_envelope_version: envelope.control.envelope_version,
      resulting_envelope_version: envelope.control.envelope_version,
      changed_visible_parties: [],
    };
  }
  if (
    !isAuthenticatedPartyAuthorityV212(authority) ||
    authority.interaction_authority !== 'external_relay' ||
    authority.party_id !== submission.source_turn.attributed_party_id ||
    envelope.parties[authority.party_id].authenticated_subject_id !==
      authority.authenticated_subject_id
  ) {
    return {
      status: 'rejected',
      reason_code: 'unauthorized_actor',
      message: 'Authenticated relay authority is invalid.',
      issues: [],
      envelope: cloneCaseEnvelopeV212(envelope),
      prior_envelope_version: envelope.control.envelope_version,
      resulting_envelope_version: envelope.control.envelope_version,
      changed_visible_parties: [],
    };
  }
  if (
    submission.base_internal_envelope_version !== envelope.control.envelope_version ||
    submission.base_internal_envelope_hash !== envelope.control.envelope_hash
  ) {
    return {
      status: 'rejected',
      reason_code: 'stale_internal_state',
      message: 'Internal envelope state is stale.',
      issues: [],
      envelope: cloneCaseEnvelopeV212(envelope),
      prior_envelope_version: envelope.control.envelope_version,
      resulting_envelope_version: envelope.control.envelope_version,
      changed_visible_parties: [],
    };
  }

  const relayView = frozenRelayExecutionViewV211(envelope);
  const relaySubmission = {
    ...cloneCanonical(submission),
    base_internal_envelope_hash: relayView.control.envelope_hash,
  };
  const result = applyExternalRelaySubmissionV211({
    envelope: relayView,
    submission: relaySubmission,
    execution_authority: partyAuthorityV211(relayView, authority.party_id, 'external_relay'),
  });
  if (result.status === 'rejected') {
    return {
      ...result,
      envelope: cloneCaseEnvelopeV212(envelope),
    };
  }
  const candidate = restoreV212RelayResult(envelope, result);
  return {
    ...result,
    message: 'V2.1.2 external relay submission applied with frozen V2.1.1 relay semantics.',
    envelope: candidate,
  };
}

export function conflictTurnSummariesForPartyV212(
  envelope: CaseEnvelopeV212,
  partyId: PartyIdV212,
  limit = 3,
) {
  return conflictTurnSummariesForPartyV211(envelope as unknown as CaseEnvelopeV211, partyId, limit);
}
