import { randomUUID } from 'node:crypto';
import {
  INTENT_ASSURANCE_ACTIONS_V1,
  INTENT_ASSURANCE_POLICY_VERSION_V1,
  TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
  TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
  observeIntentAssuranceEvidenceV1,
  resolveIntentAssurancePolicyDecisionV1,
  type HumanHandoffChallengeV1,
  type IntentAssuranceActionV1,
  type IntentAssuranceLevelV1,
  type IntentAssuranceProtocolProfileV1,
} from '../intent-assurance/intent-assurance.js';
import type { PartyReviewProtectedActionV1 } from '../v2-1-1/party-review-application.js';
import {
  DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V214,
  type CaseEnvelopeV214,
  type PartyIdV214,
} from './case-envelope.js';
import { disclosureReviewClosureCurrentV214 } from './disclosure-review.js';
import { currentDisclosureReviewAcknowledgmentV214 } from './disclosure-review.js';
import type {
  CommitCeremonyResultV214,
  CommitDisclosureReviewAcknowledgmentInputV214,
  CommitFinalConfirmationInputV214,
  StoredFormationDisputeV214,
} from './formation-persistence.js';
import {
  createPartyReviewApplicationV214,
  type PartyReviewApplicationV214,
  type PartyReviewPersistencePortV214,
} from './party-review-application.js';
import type { PartyReviewStateV214 } from './party-review-state.js';
import {
  derivePartyConfirmationEligibilityV214,
  derivePartyReviewStateV214,
} from './party-review-state.js';
import type {
  PostgresFormationInvitationRepositoryV214,
  TrustedProductionInvitationAuthorityV214,
} from './postgres-formation-invitation-repository.js';

export const PRODUCTION_PARTY_REVIEW_POLICY_PROFILE_ID_V214 =
  'juryai-v2.1.2-production-party-review-hhc3';
export const FIRST_PARTY_REVIEW_PAGE_VERSION_V214 = 'juryai-v2.1.4-first-party-review-page-v1.0.0';

const PRODUCTION_PARTY_REVIEW_POLICY_V214: IntentAssuranceProtocolProfileV1 = {
  policy_version: INTENT_ASSURANCE_POLICY_VERSION_V1,
  profile_id: PRODUCTION_PARTY_REVIEW_POLICY_PROFILE_ID_V214,
  minimum_assurance_by_action: Object.fromEntries(
    INTENT_ASSURANCE_ACTIONS_V1.map((action) => [action, 'HHC-3']),
  ) as Record<IntentAssuranceActionV1, IntentAssuranceLevelV1>,
};

export interface ProductionFirstPartyRepositoryV214 extends PartyReviewPersistencePortV214 {
  findById(disputeId: string): Promise<StoredFormationDisputeV214 | null>;
  commitDisclosureReviewAcknowledgment(
    input: CommitDisclosureReviewAcknowledgmentInputV214,
  ): Promise<CommitCeremonyResultV214>;
  commitFinalConfirmation(
    input: CommitFinalConfirmationInputV214,
  ): Promise<CommitCeremonyResultV214>;
}

export interface ProductionFirstPartyServiceV214 {
  issueInvitation(input: {
    dispute_id: string;
    intended_account_email: string;
  }): ReturnType<PostgresFormationInvitationRepositoryV214['issueInvitation']>;
  redeemInvitation(input: {
    opaque_token: string;
    authenticated_email: string;
  }): ReturnType<PostgresFormationInvitationRepositoryV214['redeemInvitation']>;
  getReview(disputeId: string): Promise<PartyReviewStateV214 | null>;
  getReviewPage(disputeId: string): Promise<ProductionFirstPartyReviewPageV214 | null>;
  acknowledgeDisclosureReview(disputeId: string): Promise<CommitCeremonyResultV214>;
  issueReviewChallenge(input: {
    dispute_id: string;
    action: PartyReviewProtectedActionV1;
    reopen_reason?: string;
  }): ReturnType<PartyReviewPersistencePortV214['issuePartyReviewChallenge']>;
  executeReviewAction(input: {
    dispute_id: string;
    action: PartyReviewProtectedActionV1;
    challenge_id: string;
    first_party_session_id: string;
  }): ReturnType<PartyReviewPersistencePortV214['executePartyReviewAction']>;
}

export interface ProductionFirstPartyReviewPageV214 {
  review_page_version: typeof FIRST_PARTY_REVIEW_PAGE_VERSION_V214;
  review: PartyReviewStateV214;
  workflow_phase: CaseEnvelopeV214['control']['workflow_state'];
  disclosure_state: CaseEnvelopeV214['control']['disclosure_state'];
  own_disclosure_review: 'open' | 'acknowledged' | 'unavailable';
  can_acknowledge_disclosure_review: boolean;
  can_confirm: boolean;
  can_reopen: boolean;
  can_invite_party_b: boolean;
  waiting_for_other_party: boolean;
  disclosure_review_acknowledgment_statement: typeof DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V214;
}

function partyForSubject(
  envelope: CaseEnvelopeV214,
  authenticatedSubjectId: string,
): PartyIdV214 | null {
  const matches = (['party_a', 'party_b'] as const).filter(
    (partyId) =>
      envelope.parties[partyId].identity_assurance === 'authenticated' &&
      envelope.parties[partyId].authenticated_subject_id === authenticatedSubjectId,
  );
  return matches.length === 1 ? matches[0]! : null;
}

function resolvedPolicy(action: PartyReviewProtectedActionV1) {
  const decision = resolveIntentAssurancePolicyDecisionV1(
    action,
    PRODUCTION_PARTY_REVIEW_POLICY_V214,
    TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
  );
  if (!decision) throw new TypeError('Production assurance policy could not be resolved.');
  return decision;
}

function observedFirstPartyCeremony(
  challengeId: string,
  firstPartySessionId: string,
  observedAt: string,
) {
  const evidence = observeIntentAssuranceEvidenceV1(
    {
      method: 'first_party_ceremony',
      challenge_id: challengeId,
      first_party_session_id: firstPartySessionId,
      ceremony_event_id: `ceremony_event_${randomUUID()}`,
      server_observed: true,
      observed_at: observedAt,
      evidence_reference: `ceremony_evidence_${randomUUID()}`,
    },
    TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
  );
  if (!evidence) throw new TypeError('First-party ceremony evidence could not be observed.');
  return evidence;
}

function unavailable(): CommitCeremonyResultV214 {
  return { status: 'unauthorized' };
}

export function createProductionFirstPartyServiceV214(input: {
  enabled: boolean;
  authenticated_subject_id: string;
  repository: ProductionFirstPartyRepositoryV214;
  invitations: PostgresFormationInvitationRepositoryV214;
  invitation_authority: TrustedProductionInvitationAuthorityV214 | null;
  clock?: { now: () => string };
}): ProductionFirstPartyServiceV214 {
  const now = input.clock?.now ?? (() => new Date().toISOString());
  const review: PartyReviewApplicationV214 = createPartyReviewApplicationV214({
    authenticated_subject_id: input.authenticated_subject_id,
    repository: input.repository,
    resolve_policy: resolvedPolicy,
    permitted_methods: () => ['first_party_ceremony'],
    challenge_ttl_seconds: 300,
  });
  return {
    issueInvitation: (request) =>
      input.invitations.issueInvitation({
        authority: input.enabled ? input.invitation_authority : null,
        dispute_id: request.dispute_id,
        authenticated_subject_id: input.authenticated_subject_id,
        intended_account_email: request.intended_account_email,
      }),
    redeemInvitation: (request) =>
      input.invitations.redeemInvitation({
        authority: input.enabled ? input.invitation_authority : null,
        opaque_token: request.opaque_token,
        authenticated_subject_id: input.authenticated_subject_id,
        authenticated_email: request.authenticated_email,
      }),
    getReview: (disputeId) => (input.enabled ? review.getReview(disputeId) : Promise.resolve(null)),
    getReviewPage: async (disputeId) => {
      if (!input.enabled) return null;
      const stored = await input.repository.findById(disputeId);
      if (!stored) return null;
      const party = partyForSubject(stored.envelope, input.authenticated_subject_id);
      if (!party) return null;
      const reviewState = derivePartyReviewStateV214(stored.envelope, party);
      const currentAcknowledgment = currentDisclosureReviewAcknowledgmentV214(
        stored.envelope,
        party,
      );
      const openChallenge = Object.values(stored.envelope.challenges).some(
        (challenge) => challenge.status === 'open',
      );
      const disclosureReviewAvailable =
        stored.envelope.control.disclosure_state === 'disclosed' &&
        stored.envelope.control.workflow_state === 'challenge_response' &&
        !openChallenge;
      return {
        review_page_version: FIRST_PARTY_REVIEW_PAGE_VERSION_V214,
        review: reviewState,
        workflow_phase: stored.envelope.control.workflow_state,
        disclosure_state: stored.envelope.control.disclosure_state,
        own_disclosure_review:
          stored.envelope.control.disclosure_state !== 'disclosed'
            ? 'unavailable'
            : currentAcknowledgment
              ? 'acknowledged'
              : 'open',
        can_acknowledge_disclosure_review:
          disclosureReviewAvailable && currentAcknowledgment === null,
        can_confirm: derivePartyConfirmationEligibilityV214(stored.envelope, party).eligible,
        can_reopen: reviewState.own_confirmation_state === 'confirmed',
        can_invite_party_b:
          party === 'party_a' &&
          stored.envelope.parties.party_b.identity_assurance === 'unbound' &&
          stored.envelope.control.workflow_state === 'independent_formation',
        waiting_for_other_party:
          party === 'party_a' && stored.envelope.parties.party_b.identity_assurance === 'unbound',
        disclosure_review_acknowledgment_statement: DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V214,
      };
    },
    acknowledgeDisclosureReview: async (disputeId) => {
      if (!input.enabled) return unavailable();
      const stored = await input.repository.findById(disputeId);
      if (!stored) return { status: 'conflict', current: null };
      const party = partyForSubject(stored.envelope, input.authenticated_subject_id);
      if (!party) return unavailable();
      const suffix = randomUUID();
      const acknowledgedAt = now();
      const acknowledged = await input.repository.commitDisclosureReviewAcknowledgment({
        dispute_id: disputeId,
        authenticated_subject_id: input.authenticated_subject_id,
        expected_internal_envelope_version: stored.internal_envelope_version,
        expected_internal_envelope_hash: stored.internal_envelope_hash,
        command_id: `command_disclosure_ack_${party}_${suffix}`,
        acknowledgment_id: `disclosure_ack_${party}_${suffix}`,
        event_id: `disclosure_ack_event_${party}_${suffix}`,
        acknowledged_at: acknowledgedAt,
        recorded_at_ms: Date.parse(acknowledgedAt),
      });
      if (acknowledged.status !== 'committed') return acknowledged;
      if (!disclosureReviewClosureCurrentV214(acknowledged.stored.envelope)) return acknowledged;
      const finalized = await input.repository.commitFinalConfirmation({
        dispute_id: disputeId,
        expected_internal_envelope_version: acknowledged.stored.internal_envelope_version,
        expected_internal_envelope_hash: acknowledged.stored.internal_envelope_hash,
        command_id: `command_final_confirmation_${suffix}`,
      });
      return finalized.status === 'conflict' &&
        finalized.current?.envelope.control.workflow_state === 'final_confirmation'
        ? { status: 'committed', stored: finalized.current }
        : finalized;
    },
    issueReviewChallenge: (request) => {
      if (!input.enabled) {
        return Promise.resolve({
          status: 'rejected' as const,
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        });
      }
      return request.action === 'confirm_case_account'
        ? review.issueConfirmationChallenge(request.dispute_id)
        : review.issueReopenChallenge({
            case_id: request.dispute_id,
            reason: request.reopen_reason ?? '',
          });
    },
    executeReviewAction: (request) => {
      if (!input.enabled) {
        return Promise.resolve({
          status: 'rejected' as const,
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        });
      }
      const observed = observedFirstPartyCeremony(
        request.challenge_id,
        request.first_party_session_id,
        now(),
      );
      return request.action === 'confirm_case_account'
        ? review.confirmCaseAccount({
            case_id: request.dispute_id,
            challenge_id: request.challenge_id,
            observed_evidence: observed,
          })
        : review.reopenConfirmedMaterial({
            case_id: request.dispute_id,
            challenge_id: request.challenge_id,
            observed_evidence: observed,
          });
    },
  };
}

export function disclosureReviewAcknowledgmentCopyV214(): string {
  return DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V214;
}

export function reviewChallengeForPublicResponseV214(challenge: HumanHandoffChallengeV1) {
  return {
    challenge_id: challenge.challenge_id,
    requested_action: challenge.requested_action,
    public_reference: challenge.public_reference,
    required_minimum_assurance: challenge.required_minimum_assurance,
    expires_at: challenge.expires_at,
  };
}
