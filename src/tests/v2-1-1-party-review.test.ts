import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INTENT_ASSURANCE_ACTIONS_V1,
  INTENT_ASSURANCE_POLICY_VERSION_V1,
  TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
  TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
  TRUSTED_INTENT_ASSURANCE_STATE_RESOLVER_V1,
  hashIntentAssuranceActionPayloadV1,
  observeIntentAssuranceEvidenceV1,
  protectedActionAuthorizationMatchesV1,
  resolveIntentAssurancePolicyDecisionV1,
  resolveIntentAssuranceStateBindingV1,
  type HumanHandoffChallengeV1,
  type IntentAssuranceActionV1,
  type IntentAssuranceLevelV1,
  type IntentAssuranceProtocolProfileV1,
  type ObservedIntentAssuranceEvidenceV1,
} from '../intent-assurance/intent-assurance.js';
import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import {
  PARTY_CONFIRMATION_VERSION_V211,
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  PARTY_FORMATION_READBACK_VERSION_V211,
  TRUSTED_SYSTEM_AUTHORITY_V211,
  hashCaseEnvelopeV211,
  partyAuthorityV211,
  type CaseEnvelopeV211,
  type PartyIdV211,
} from '../v2-1-1/case-envelope.js';
import { validateCaseEnvelopeV211 } from '../v2-1-1/contract-validator.js';
import {
  applyEnvelopeCeremonyCommandV211,
  ceremonyCommandForV211,
  createInitialCaseEnvelopeV211,
  refreshPartyViewCursorsV211,
  type EnvelopeCeremonyOperationV211,
} from '../v2-1-1/envelope-ceremony.js';
import {
  authoritativeFormationExplanatoryStateV211,
  deriveFormationReadinessV211,
} from '../v2-1-1/formation-readiness.js';
import {
  PARTY_CONFIRMATION_ADOPTION_STATEMENT_V1,
  PARTY_REVIEW_PROTECTED_ACTION_VERSION_V1,
  createPartyReviewApplicationV1,
  executePartyReviewProtectedActionV1,
  preparePartyReviewChallengeV1,
  type PartyReviewPersistencePortV1,
  type PartyReviewProtectedActionV1,
} from '../v2-1-1/party-review-application.js';
import {
  PARTY_REVIEW_STATE_VERSION_V1,
  derivePartyReviewStateV1,
  validatePartyReviewStateV1,
} from '../v2-1-1/party-review-state.js';
import {
  currentPartyConfirmationV211,
  projectPartyFormationV211,
  renderPartyFormationReadbackV211,
} from '../v2-1-1/party-projection.js';
import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';

const SUBJECT_A = 'subject_party_a';
const SUBJECT_B = 'subject_party_b';
let sequence = 0;

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence}`;
}

function sourceFilesBelow(directory: string): string[] {
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
    }
  };
  visit(resolve(directory));
  return files.sort();
}

function ceremony(
  envelope: CaseEnvelopeV211,
  authority: Parameters<typeof applyEnvelopeCeremonyCommandV211>[0]['execution_authority'],
  operation: EnvelopeCeremonyOperationV211,
): CaseEnvelopeV211 {
  const result = applyEnvelopeCeremonyCommandV211({
    envelope,
    command: ceremonyCommandForV211(envelope, unique('ceremony_command'), operation),
    execution_authority: authority,
  });
  if (result.status !== 'applied') throw new Error(`${result.reason_code}: ${result.message}`);
  return result.envelope;
}

function boundEnvelope(disclosed = true): CaseEnvelopeV211 {
  let envelope = createInitialCaseEnvelopeV211(unique('dispute_party_review'), {
    party_a: [],
    party_b: [],
  });
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
    type: 'bind_party',
    party_slot: 'party_a',
    authenticated_subject_id: SUBJECT_A,
    binding_event_id: unique('binding_party_a'),
  });
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
    type: 'bind_party',
    party_slot: 'party_b',
    authenticated_subject_id: SUBJECT_B,
    binding_event_id: unique('binding_party_b'),
  });
  if (!disclosed) return envelope;
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
    type: 'open_controlled_disclosure',
  });
  return ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
    type: 'enter_final_confirmation',
  });
}

function profile(
  action: PartyReviewProtectedActionV1,
  minimum: IntentAssuranceLevelV1 = 'HHC-3',
): IntentAssuranceProtocolProfileV1 {
  const levels = Object.fromEntries(
    INTENT_ASSURANCE_ACTIONS_V1.map((item) => [item, 'HHC-3']),
  ) as Record<IntentAssuranceActionV1, IntentAssuranceLevelV1>;
  levels[action] = minimum;
  return {
    policy_version: INTENT_ASSURANCE_POLICY_VERSION_V1,
    profile_id: `profile_${action}_${minimum.replace('-', '_')}`,
    minimum_assurance_by_action: levels,
  };
}

function policy(action: PartyReviewProtectedActionV1, minimum: IntentAssuranceLevelV1 = 'HHC-3') {
  const decision = resolveIntentAssurancePolicyDecisionV1(
    action,
    profile(action, minimum),
    TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
  );
  if (!decision) throw new Error('test policy must resolve');
  return decision;
}

function prepare(
  envelope: CaseEnvelopeV211,
  partyId: PartyIdV211,
  action: PartyReviewProtectedActionV1 = 'confirm_case_account',
  options: { minimum?: IntentAssuranceLevelV1; reopen_reason?: string } = {},
) {
  const result = preparePartyReviewChallengeV1({
    envelope,
    authenticated_subject_id: partyId === 'party_a' ? SUBJECT_A : SUBJECT_B,
    requested_action: action,
    current_policy_decision: policy(action, options.minimum),
    permitted_methods:
      options.minimum === 'HHC-4' ? ['webauthn_user_verification'] : ['first_party_ceremony'],
    expires_in_seconds: 300,
    issued_at: '2026-09-03T01:00:00.000Z',
    ids: {
      challenge_id: unique('handoff_challenge'),
      public_reference: `PR5-${String(sequence).padStart(3, '0')}`,
      command_id: unique(`command_${partyId}`),
      confirmation_id: unique(`confirmation_${partyId}`),
      confirmation_event_id: unique(`confirmation_event_${partyId}`),
      reopen_event_id: unique(`reopen_event_${partyId}`),
    },
    reopen_reason: options.reopen_reason,
  });
  if (result.status !== 'prepared') throw new Error(`${result.reason_code}: ${result.message}`);
  return result;
}

function observed(challenge: HumanHandoffChallengeV1): ObservedIntentAssuranceEvidenceV1 {
  const result = observeIntentAssuranceEvidenceV1(
    {
      method: 'first_party_ceremony',
      challenge_id: challenge.challenge_id,
      first_party_session_id: 'first_party_session_pr5',
      ceremony_event_id: unique('first_party_ceremony'),
      server_observed: true,
      observed_at: '2026-09-03T01:00:01.000Z',
      evidence_reference: unique('evidence_first_party'),
    },
    TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
  );
  if (!result) throw new Error('test evidence must be server-observed');
  return result;
}

function execute(
  envelope: CaseEnvelopeV211,
  prepared: ReturnType<typeof prepare>,
  partyId: PartyIdV211,
) {
  return executePartyReviewProtectedActionV1({
    envelope,
    authenticated_subject_id: partyId === 'party_a' ? SUBJECT_A : SUBJECT_B,
    challenge: prepared.challenge,
    action_payload: prepared.action_payload,
    expected_action: prepared.challenge.requested_action as PartyReviewProtectedActionV1,
    current_policy_decision: policy(
      prepared.challenge.requested_action as PartyReviewProtectedActionV1,
    ),
    observed_evidence: observed(prepared.challenge),
    completed_at: '2026-09-03T01:00:01.000Z',
    consumed_at: '2026-09-03T01:00:01.000Z',
    receipt_id: unique('assurance_receipt'),
    consumption_id: unique('assurance_consumption'),
  });
}

function confirmed(envelope: CaseEnvelopeV211, partyId: PartyIdV211): CaseEnvelopeV211 {
  const result = execute(envelope, prepare(envelope, partyId), partyId);
  if (result.status !== 'applied') throw new Error(`${result.reason_code}: ${result.message}`);
  return result.envelope;
}

describe('PR 5 party review state and assurance-gated ceremonies', () => {
  it('derives an exact versioned first-party review from the frozen formation projection/read-back', () => {
    const envelope = boundEnvelope();
    const review = derivePartyReviewStateV1(envelope, 'party_a');
    expect(review.review_state_version).toBe(PARTY_REVIEW_STATE_VERSION_V1);
    expect(review.formation_projection_version).toBe(PARTY_FORMATION_PROJECTION_VERSION_V211);
    expect(review.formation_readback_version).toBe(PARTY_FORMATION_READBACK_VERSION_V211);
    expect(review.formation_projection).toEqual(projectPartyFormationV211(envelope, 'party_a'));
    expect(review.formation_readback).toEqual(
      renderPartyFormationReadbackV211(envelope, 'party_a'),
    );
    expect(review).not.toHaveProperty('internal_envelope_version');
    expect(review).not.toHaveProperty('internal_envelope_hash');
    expect(validatePartyReviewStateV1(review)).toEqual([]);
    expect(validatePartyReviewStateV1({ ...review, review_state_hash: '0'.repeat(64) })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'party_review_state_hash_mismatch' }),
      ]),
    );
    const tamperedProjection = cloneCanonical(review);
    tamperedProjection.formation_projection.warnings.push('tampered_review_warning');
    expect(validatePartyReviewStateV1(tamperedProjection)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'party_review_state_binding_mismatch' }),
      ]),
    );
  });

  it('preserves the symmetric pre-disclosure embargo and only shows contract-authorized material', () => {
    const envelope = boundEnvelope(false);
    const a = derivePartyReviewStateV1(envelope, 'party_a');
    const b = derivePartyReviewStateV1(envelope, 'party_b');
    expect(a.formation_projection.opponent_material).toBeNull();
    expect(b.formation_projection.opponent_material).toBeNull();
    expect(canonicalSerialize(a)).not.toContain(SUBJECT_B);
    expect(canonicalSerialize(b)).not.toContain(SUBJECT_A);
  });

  it('binds confirmation to the exact V2.1.1 command, review hash, read-back, party, and epoch', () => {
    const envelope = boundEnvelope();
    const prepared = prepare(envelope, 'party_a');
    expect(prepared.action_payload.protected_action_version).toBe(
      PARTY_REVIEW_PROTECTED_ACTION_VERSION_V1,
    );
    expect(prepared.action_payload.review_state_hash).toBe(prepared.review_state.review_state_hash);
    expect(prepared.action_payload.party_readback_hash).toBe(
      prepared.review_state.party_readback_hash,
    );
    expect(prepared.action_payload.ceremony_command.operation).toEqual({
      type: 'record_party_confirmation',
      confirmation_id: expect.stringMatching(/^confirmation_party_a_/u),
      event_id: expect.stringMatching(/^confirmation_event_party_a_/u),
      adoption_statement: PARTY_CONFIRMATION_ADOPTION_STATEMENT_V1,
      confirmed_at: '2026-09-03T01:00:00.000Z',
    });
    expect(prepared.challenge.party_id).toBe('party_a');
    expect(prepared.challenge.formation_epoch).toBe(envelope.parties.party_a.formation_epoch);
    expect(prepared.challenge.action_payload_hash).toBe(
      hashIntentAssuranceActionPayloadV1('confirm_case_account', prepared.action_payload as never),
    );
  });

  it('fails closed for changed payload, projection/version/epoch, subject, party, or dispute', () => {
    const envelope = boundEnvelope();
    const prepared = prepare(envelope, 'party_a');
    const modified = cloneCanonical(prepared.action_payload);
    if (modified.ceremony_command.operation.type !== 'record_party_confirmation') throw new Error();
    modified.ceremony_command.operation.adoption_statement = 'Different statement.';
    expect(
      executePartyReviewProtectedActionV1({
        envelope,
        authenticated_subject_id: SUBJECT_A,
        challenge: prepared.challenge,
        action_payload: modified,
        expected_action: 'confirm_case_account',
        current_policy_decision: policy('confirm_case_account'),
        observed_evidence: observed(prepared.challenge),
        completed_at: '2026-09-03T01:00:01.000Z',
        consumed_at: '2026-09-03T01:00:01.000Z',
        receipt_id: unique('assurance_receipt'),
        consumption_id: unique('assurance_consumption'),
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'payload_mismatch' });
    expect(
      executePartyReviewProtectedActionV1({
        envelope,
        authenticated_subject_id: SUBJECT_B,
        challenge: prepared.challenge,
        action_payload: prepared.action_payload,
        expected_action: 'confirm_case_account',
        current_policy_decision: policy('confirm_case_account'),
        observed_evidence: observed(prepared.challenge),
        completed_at: '2026-09-03T01:00:01.000Z',
        consumed_at: '2026-09-03T01:00:01.000Z',
        receipt_id: unique('assurance_receipt'),
        consumption_id: unique('assurance_consumption'),
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'unavailable' });

    const before = cloneCanonical(envelope);
    const changed = cloneCanonical(envelope);
    changed.evidence.evidence_party_a_visibility = {
      evidence_id: 'evidence_party_a_visibility',
      attributed_party_id: 'party_a',
      description: 'A newly visible item.',
      required_for_readiness: false,
      eligibility: 'pending',
    };
    refreshPartyViewCursorsV211(before, changed);
    changed.formation.explanatory = authoritativeFormationExplanatoryStateV211(changed);
    changed.control.envelope_hash = hashCaseEnvelopeV211(changed);
    expect(validateCaseEnvelopeV211(changed)).toEqual([]);
    const changedReview = derivePartyReviewStateV1(changed, 'party_a');
    expect(changedReview.party_visible_version).toBe(
      prepared.review_state.party_visible_version + 1,
    );
    expect(changedReview.party_readback_hash).not.toBe(prepared.review_state.party_readback_hash);
    expect(execute(changed, prepared, 'party_a')).toMatchObject({
      status: 'rejected',
      reason_code: 'state_changed',
    });
    expect(execute(boundEnvelope(), prepared, 'party_a')).toMatchObject({
      status: 'rejected',
      reason_code: 'state_changed',
    });
  });

  it('requires server-owned first-party authority and the policy-required assurance level', () => {
    const envelope = boundEnvelope();
    const relay = applyEnvelopeCeremonyCommandV211({
      envelope,
      command: ceremonyCommandForV211(envelope, unique('relay_cannot_confirm'), {
        type: 'record_party_confirmation',
        confirmation_id: unique('confirmation_party_a'),
        event_id: unique('confirmation_event_party_a'),
        adoption_statement: PARTY_CONFIRMATION_ADOPTION_STATEMENT_V1,
        confirmed_at: '2026-09-03T01:00:00.000Z',
      }),
      execution_authority: partyAuthorityV211(envelope, 'party_a', 'external_relay'),
    });
    expect(relay).toMatchObject({ status: 'rejected', reason_code: 'unauthorized_actor' });
    const hhc4 = prepare(envelope, 'party_a', 'confirm_case_account', { minimum: 'HHC-4' });
    expect(
      executePartyReviewProtectedActionV1({
        envelope,
        authenticated_subject_id: SUBJECT_A,
        challenge: hhc4.challenge,
        action_payload: hhc4.action_payload,
        expected_action: 'confirm_case_account',
        current_policy_decision: policy('confirm_case_account', 'HHC-4'),
        observed_evidence: observed(hhc4.challenge),
        completed_at: '2026-09-03T01:00:01.000Z',
        consumed_at: '2026-09-03T01:00:01.000Z',
        receipt_id: unique('assurance_receipt'),
        consumption_id: unique('assurance_consumption'),
      }),
    ).toMatchObject({
      status: 'rejected',
      reason_code: 'invalid_assurance',
    });
  });

  it('changes only A review state on A confirmation while B formation/review bytes remain stable', () => {
    const envelope = boundEnvelope();
    const aBefore = derivePartyReviewStateV1(envelope, 'party_a');
    const bBefore = derivePartyReviewStateV1(envelope, 'party_b');
    const bProjectionBefore = canonicalSerialize(projectPartyFormationV211(envelope, 'party_b'));
    const bCursorBefore = cloneCanonical(envelope.control.party_views.party_b);
    const result = execute(envelope, prepare(envelope, 'party_a'), 'party_a');
    if (result.status !== 'applied') throw new Error(result.message);
    expect(result.envelope.control.envelope_version).toBe(envelope.control.envelope_version + 1);
    expect(result.resulting_review_state.own_confirmation_state).toBe('confirmed');
    expect(result.resulting_review_state.review_state_hash).not.toBe(aBefore.review_state_hash);
    expect(derivePartyReviewStateV1(result.envelope, 'party_b')).toEqual(bBefore);
    expect(canonicalSerialize(projectPartyFormationV211(result.envelope, 'party_b'))).toBe(
      bProjectionBefore,
    );
    expect(result.envelope.control.party_views.party_b).toEqual(bCursorBefore);
    expect(result.resulting_review_state.shared_readiness).toBe('not_ready');
    expect(currentPartyConfirmationV211(result.envelope, 'party_a')).not.toBeNull();
    expect(currentPartyConfirmationV211(result.envelope, 'party_b')).toBeNull();
  });

  it('makes bilateral readiness shared through review-state hashes without changing frozen projections', () => {
    const oneConfirmed = confirmed(boundEnvelope(), 'party_a');
    const aBefore = derivePartyReviewStateV1(oneConfirmed, 'party_a');
    const bBefore = derivePartyReviewStateV1(oneConfirmed, 'party_b');
    const projectionsBefore = {
      party_a: canonicalSerialize(projectPartyFormationV211(oneConfirmed, 'party_a')),
      party_b: canonicalSerialize(projectPartyFormationV211(oneConfirmed, 'party_b')),
      cursors: cloneCanonical(oneConfirmed.control.party_views),
    };
    const bothConfirmed = confirmed(oneConfirmed, 'party_b');
    const aAfter = derivePartyReviewStateV1(bothConfirmed, 'party_a');
    const bAfter = derivePartyReviewStateV1(bothConfirmed, 'party_b');
    expect(aBefore.shared_readiness).toBe('not_ready');
    expect(bBefore.shared_readiness).toBe('not_ready');
    expect(aAfter.shared_readiness).toBe('ready_for_lock');
    expect(bAfter.shared_readiness).toBe('ready_for_lock');
    expect(aAfter.review_state_hash).not.toBe(aBefore.review_state_hash);
    expect(bAfter.review_state_hash).not.toBe(bBefore.review_state_hash);
    expect(canonicalSerialize(projectPartyFormationV211(bothConfirmed, 'party_a'))).toBe(
      projectionsBefore.party_a,
    );
    expect(canonicalSerialize(projectPartyFormationV211(bothConfirmed, 'party_b'))).toBe(
      projectionsBefore.party_b,
    );
    expect(bothConfirmed.control.party_views).toEqual(projectionsBefore.cursors);
    expect(currentPartyConfirmationV211(bothConfirmed, 'party_a')).not.toBeNull();
    expect(currentPartyConfirmationV211(bothConfirmed, 'party_b')).not.toBeNull();
    expect(canonicalSerialize(aAfter)).not.toMatch(/confirmation_party_b|confirmed_at/iu);
  });

  it('keeps either single-party confirmation non-ready and does not lock the envelope', () => {
    for (const partyId of ['party_a', 'party_b'] as const) {
      const oneConfirmed = confirmed(boundEnvelope(), partyId);
      const otherPartyId = partyId === 'party_a' ? 'party_b' : 'party_a';
      expect(oneConfirmed.control.workflow_state).toBe('final_confirmation');
      expect(derivePartyReviewStateV1(oneConfirmed, partyId)).toMatchObject({
        own_confirmation_state: 'confirmed',
        shared_readiness: 'not_ready',
      });
      expect(derivePartyReviewStateV1(oneConfirmed, otherPartyId)).toMatchObject({
        own_confirmation_state: 'unconfirmed',
        shared_readiness: 'not_ready',
      });
    }
  });

  it('does not let two confirmation rows bypass an authoritative readiness blocker', () => {
    let envelope = confirmed(confirmed(boundEnvelope(), 'party_a'), 'party_b');
    const before = cloneCanonical(envelope);
    envelope.evidence.evidence_party_a_required = {
      evidence_id: 'evidence_party_a_required',
      attributed_party_id: 'party_a',
      description: 'Required evidence.',
      required_for_readiness: true,
      eligibility: 'pending',
    };
    refreshPartyViewCursorsV211(before, envelope);
    envelope.formation.explanatory = authoritativeFormationExplanatoryStateV211(envelope);
    envelope.control.envelope_hash = hashCaseEnvelopeV211(envelope);
    expect(validateCaseEnvelopeV211(envelope)).toEqual([]);
    expect(envelope.formation.confirmations.party_a).toHaveLength(1);
    expect(envelope.formation.confirmations.party_b).toHaveLength(1);
    expect(deriveFormationReadinessV211(envelope)).toMatchObject({
      ready_for_bilateral_lock: false,
      ineligible_required_evidence: ['evidence_party_a_required'],
    });
  });

  it('requires assurance for reopen, changes only own canonical authority, and invalidates readiness', () => {
    const ready = confirmed(confirmed(boundEnvelope(), 'party_a'), 'party_b');
    const aBefore = derivePartyReviewStateV1(ready, 'party_a');
    const bBefore = derivePartyReviewStateV1(ready, 'party_b');
    const oldEpoch = ready.parties.party_a.formation_epoch;
    const prepared = prepare(ready, 'party_a', 'reopen_confirmed_material', {
      reopen_reason: 'I need to correct my own account.',
    });
    expect(prepared.action_payload.ceremony_command.operation).toEqual({
      type: 'reopen_own_formation',
      event_id: expect.stringMatching(/^reopen_event_party_a_/u),
      reason: 'I need to correct my own account.',
      occurred_at: '2026-09-03T01:00:00.000Z',
    });
    const reopened = execute(ready, prepared, 'party_a');
    if (reopened.status !== 'applied') throw new Error(reopened.message);
    expect(reopened.envelope.parties.party_a).toMatchObject({
      edit_state: 'reopened',
      formation_epoch: oldEpoch + 1,
    });
    expect(reopened.envelope.parties.party_b).toEqual(ready.parties.party_b);
    expect(currentPartyConfirmationV211(reopened.envelope, 'party_a')).toBeNull();
    expect(currentPartyConfirmationV211(reopened.envelope, 'party_b')).not.toBeNull();
    expect(reopened.resulting_review_state.shared_readiness).toBe('not_ready');
    expect(reopened.resulting_review_state.review_state_hash).not.toBe(aBefore.review_state_hash);
    expect(derivePartyReviewStateV1(reopened.envelope, 'party_b').review_state_hash).not.toBe(
      bBefore.review_state_hash,
    );
    expect(execute(reopened.envelope, prepared, 'party_a')).toMatchObject({
      status: 'rejected',
      reason_code: 'state_changed',
    });
  });

  it('never treats a serialized assurance receipt as executable runtime authority', () => {
    const envelope = boundEnvelope();
    const prepared = prepare(envelope, 'party_a');
    const result = execute(envelope, prepared, 'party_a');
    if (result.status !== 'applied') throw new Error(result.message);
    const cursor = envelope.control.party_views.party_a;
    const binding = resolveIntentAssuranceStateBindingV1(
      {
        authenticated_subject_id: SUBJECT_A,
        dispute_id: envelope.control.case_id,
        party_id: 'party_a',
        party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
        party_projection_hash: cursor.party_projection_hash,
        party_visible_version: cursor.party_visible_version,
        formation_epoch: envelope.parties.party_a.formation_epoch,
      },
      TRUSTED_INTENT_ASSURANCE_STATE_RESOLVER_V1,
    )!;
    expect(
      protectedActionAuthorizationMatchesV1(
        result.receipt,
        binding,
        'confirm_case_account',
        prepared.action_payload as never,
      ),
    ).toBe(false);
    expect(result.receipt.receipt_version).toBe('juryai-intent-assurance-receipt-v1.0.0');
    expect(result.receipt.authorization_status).toBe('consumed');
    expect(result.consumption.challenge_id).toBe(result.challenge.challenge_id);
    expect(currentPartyConfirmationV211(result.envelope, 'party_a')?.confirmation_version).toBe(
      PARTY_CONFIRMATION_VERSION_V211,
    );
    expect(
      executePartyReviewProtectedActionV1({
        envelope,
        authenticated_subject_id: SUBJECT_A,
        challenge: result.challenge,
        action_payload: prepared.action_payload,
        expected_action: 'confirm_case_account',
        current_policy_decision: policy('confirm_case_account'),
        observed_evidence: observed(prepared.challenge),
        completed_at: '2026-09-03T01:00:01.000Z',
        consumed_at: '2026-09-03T01:00:01.000Z',
        receipt_id: unique('assurance_receipt'),
        consumption_id: unique('assurance_consumption'),
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'already_used' });
  });

  it('binds authenticated subject in the first-party application and exposes no caller party field', async () => {
    const calls: unknown[] = [];
    const repository: PartyReviewPersistencePortV1 = {
      async getPartyReview(input) {
        calls.push(input);
        return null;
      },
      async issuePartyReviewChallenge(input) {
        calls.push(input);
        return {
          status: 'rejected',
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        };
      },
      async executePartyReviewAction(input) {
        calls.push(input);
        return {
          status: 'rejected',
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        };
      },
    };
    const application = createPartyReviewApplicationV1({
      authenticated_subject_id: SUBJECT_A,
      repository,
      resolve_policy: (action) => policy(action),
      permitted_methods: () => ['first_party_ceremony'],
      challenge_ttl_seconds: 300,
    });
    await application.getReview('dispute_application');
    await application.issueConfirmationChallenge('dispute_application');
    expect(calls).toEqual(
      expect.arrayContaining([expect.objectContaining({ authenticated_subject_id: SUBJECT_A })]),
    );
    expect(
      calls.every(
        (call) =>
          typeof call === 'object' &&
          call !== null &&
          !Object.prototype.hasOwnProperty.call(call, 'party_id'),
      ),
    ).toBe(true);
  });

  it('keeps the production composition dark and the public WebMCP surface at exactly three tools', () => {
    const productionFiles = [...sourceFilesBelow('api'), ...sourceFilesBelow('src/webmcp/server')]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(productionFiles).not.toMatch(
      /party-review|PostgresPartyReviewRepository|formation_assurance/iu,
    );
    const tools = createJuryAiToolDefinitions({
      async startCase() {
        throw new Error('not called');
      },
      async getCaseState() {
        throw new Error('not called');
      },
      async submitTurn() {
        throw new Error('not called');
      },
    });
    expect(tools.map((tool) => tool.name)).toEqual(['start_case', 'get_case_state', 'submit_turn']);
  });
});
