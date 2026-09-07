import { cloneCanonical } from '../v2/case-envelope.js';
import {
  partyAuthorityV215,
  TRUSTED_SYSTEM_AUTHORITY_V215,
  type CaseEnvelopeV215,
  type PartyIdV215,
} from '../v2-1-5/case-envelope.js';
import {
  applyExternalRelaySubmissionV215,
  rebaseExternalRelaySubmissionV215,
} from '../v2-1-5/external-relay-submission.js';
import {
  applyEnvelopeCeremonyCommandV215,
  ceremonyCommandForV215,
} from '../v2-1-5/envelope-ceremony.js';
import {
  FORMATION_PERSISTENCE_CONTRACT_VERSION_V215,
  type ActiveFormationContextV215,
  type CommitControlledDisclosureInputV215,
  type CommitControlledDisclosureResultV215,
  type CommitExternalRelaySubmissionInputV215,
  type CommitExternalRelaySubmissionResultV215,
  type FormationPartyPersistenceContextV215,
  type FormationReplayRecordV215,
  type FormationReplayResponseV215,
  type StoredFormationDisputeV215,
} from '../v2-1-5/formation-persistence.js';
import type { FormationRelayRepositoryV215 } from '../v2-1-5/webmcp-application.js';
function replayResponse(
  envelope: CaseEnvelopeV215,
  partyId: PartyIdV215,
  submission: CommitExternalRelaySubmissionInputV215['submission'],
  applied: Extract<ReturnType<typeof applyExternalRelaySubmissionV215>, { status: 'applied' }>,
): FormationReplayResponseV215 {
  const cursor = envelope.control.party_views[partyId];
  return {
    persistence_contract_version: FORMATION_PERSISTENCE_CONTRACT_VERSION_V215,
    dispute_id: envelope.control.case_id,
    party_id: partyId,
    submission_id: submission.submission_id,
    source_turn_id: submission.source_turn.turn_id,
    accepted_position_ids: [...applied.result.accepted_position_ids],
    superseded_position_ids: [...applied.result.superseded_position_ids],
    opened_clarification_ids: [...applied.result.opened_clarification_ids],
    resolved_clarification_ids: [...applied.result.resolved_clarification_ids],
    challenge_ids: [...applied.result.challenge_ids],
    challenge_response_ids: [...applied.result.challenge_response_ids],
    warnings: [...applied.result.warnings],
    resulting_internal_envelope_version: envelope.control.envelope_version,
    resulting_internal_envelope_hash: envelope.control.envelope_hash,
    resulting_party_visible_version: cursor.party_visible_version,
    resulting_party_projection_hash: cursor.party_projection_hash,
  };
}

class MemoryFormationRepository implements FormationRelayRepositoryV215 {
  envelope: CaseEnvelopeV215;
  commitCalls = 0;
  lastCommit: CommitExternalRelaySubmissionInputV215 | null = null;
  beforeCommit: (() => Promise<void>) | null = null;
  readonly replays = new Map<string, FormationReplayRecordV215>();
  readonly issued = new WeakSet<object>();

  constructor(envelope: CaseEnvelopeV215) {
    this.envelope = cloneCanonical(envelope);
  }

  async createDispute(envelope: CaseEnvelopeV215) {
    if (envelope.control.case_id !== this.envelope.control.case_id)
      throw new Error('test identity mismatch');
    return { created: false, stored: this.stored() };
  }

  replace(envelope: CaseEnvelopeV215): void {
    this.envelope = cloneCanonical(envelope);
  }

  stored(): StoredFormationDisputeV215 {
    return {
      envelope: cloneCanonical(this.envelope),
      internal_envelope_version: this.envelope.control.envelope_version,
      internal_envelope_hash: this.envelope.control.envelope_hash,
      created_at_ms: 1,
      updated_at_ms: this.envelope.control.envelope_version,
    };
  }

  async findById(disputeId: string): Promise<StoredFormationDisputeV215 | null> {
    return disputeId === this.envelope.control.case_id ? this.stored() : null;
  }

  async listActiveContextsForPrincipal(subjectId: string): Promise<ActiveFormationContextV215[]> {
    const partyId = this.partyFor(subjectId);
    if (!partyId) return [];
    const cursor = this.envelope.control.party_views[partyId];
    return [
      {
        dispute_id: this.envelope.control.case_id,
        party_id: partyId,
        internal_envelope_version: this.envelope.control.envelope_version,
        internal_envelope_hash: this.envelope.control.envelope_hash,
        party_visible_version: cursor.party_visible_version,
        party_projection_hash: cursor.party_projection_hash,
      },
    ];
  }

  async resolvePartyContext(
    disputeId: string,
    subjectId: string,
  ): Promise<FormationPartyPersistenceContextV215 | null> {
    if (disputeId !== this.envelope.control.case_id) return null;
    const partyId = this.partyFor(subjectId);
    if (!partyId) return null;
    const cursor = this.envelope.control.party_views[partyId];
    const context = Object.freeze({
      dispute_id: disputeId,
      party_id: partyId,
      authenticated_subject_id: subjectId,
      internal_envelope_version: this.envelope.control.envelope_version,
      internal_envelope_hash: this.envelope.control.envelope_hash,
      party_visible_version: cursor.party_visible_version,
      party_projection_hash: cursor.party_projection_hash,
    });
    this.issued.add(context);
    return context;
  }

  async readReplayRecord(
    context: FormationPartyPersistenceContextV215,
    clientTurnId: string,
  ): Promise<FormationReplayRecordV215 | null> {
    if (!this.issued.has(context)) return null;
    return cloneCanonical(
      this.replays.get(`${context.dispute_id}|${context.party_id}|${clientTurnId}`) ?? null,
    );
  }

  async commitExternalRelaySubmission(
    input: CommitExternalRelaySubmissionInputV215,
  ): Promise<CommitExternalRelaySubmissionResultV215> {
    this.commitCalls++;
    this.lastCommit = input;
    if (this.beforeCommit) {
      const hook = this.beforeCommit;
      this.beforeCommit = null;
      await hook();
    }
    if (!this.issued.has(input.context)) return { status: 'unauthorized', replayed: false };
    const key = `${input.context.dispute_id}|${input.context.party_id}|${input.submission.source_turn.client_turn_id}`;
    const replay = this.replays.get(key);
    if (replay) {
      return replay.request_fingerprint === input.submission.source_turn.request_fingerprint
        ? {
            status: 'replayed',
            replayed: true,
            stored: this.stored(),
            response: cloneCanonical(replay.response),
          }
        : { status: 'idempotency_conflict', replayed: false };
    }
    let submission = input.submission;
    let rebased = false;
    if (
      submission.base_internal_envelope_version !== this.envelope.control.envelope_version ||
      submission.base_internal_envelope_hash !== this.envelope.control.envelope_hash
    ) {
      const next = rebaseExternalRelaySubmissionV215(submission, this.envelope);
      if (!next) return { status: 'conflict', replayed: false, current: this.stored() };
      submission = next;
      rebased = true;
    }
    const applied = applyExternalRelaySubmissionV215({
      envelope: this.envelope,
      submission,
      execution_authority: partyAuthorityV215(
        this.envelope,
        input.context.party_id,
        'external_relay',
      ),
    });
    if (applied.status === 'rejected') {
      return {
        status: 'domain_rejected',
        replayed: false,
        reason_code: applied.reason_code,
        message: applied.message,
      };
    }
    this.envelope = cloneCanonical(applied.envelope);
    const response = replayResponse(this.envelope, input.context.party_id, submission, applied);
    this.replays.set(key, {
      dispute_id: input.context.dispute_id,
      party_id: input.context.party_id,
      client_turn_id: submission.source_turn.client_turn_id,
      request_fingerprint: submission.source_turn.request_fingerprint,
      response,
      recorded_at_ms: input.recorded_at_ms,
    });
    return {
      status: 'committed',
      replayed: false,
      hidden_state_rebased: rebased,
      stored: this.stored(),
      response,
    };
  }

  async commitControlledDisclosure(
    input: CommitControlledDisclosureInputV215,
  ): Promise<CommitControlledDisclosureResultV215> {
    if (
      input.dispute_id !== this.envelope.control.case_id ||
      input.expected_internal_envelope_version !== this.envelope.control.envelope_version ||
      input.expected_internal_envelope_hash !== this.envelope.control.envelope_hash
    ) {
      return { status: 'conflict', current: this.stored() };
    }
    const applied = applyEnvelopeCeremonyCommandV215({
      envelope: this.envelope,
      command: ceremonyCommandForV215(this.envelope, input.command_id, {
        type: 'open_controlled_disclosure',
      }),
      execution_authority: TRUSTED_SYSTEM_AUTHORITY_V215,
    });
    if (applied.status === 'rejected') {
      return {
        status: 'domain_rejected',
        reason_code: applied.reason_code,
        message: applied.message,
      };
    }
    this.envelope = cloneCanonical(applied.envelope);
    return { status: 'committed', stored: this.stored() };
  }

  private partyFor(subjectId: string): PartyIdV215 | null {
    for (const partyId of ['party_a', 'party_b'] as const) {
      if (this.envelope.parties[partyId].authenticated_subject_id === subjectId) return partyId;
    }
    return null;
  }
}

export { MemoryFormationRepository };
