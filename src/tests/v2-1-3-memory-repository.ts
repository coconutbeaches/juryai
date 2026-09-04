import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import {
  PARTY_FORMATION_PROJECTION_VERSION_V213,
  TRUSTED_SYSTEM_AUTHORITY_V213,
  hashCaseEnvelopeV213,
  partyAuthorityV213,
  type CaseEnvelopeV213,
  type FormationRequirementV213,
  type PartyIdV213,
} from '../v2-1-3/case-envelope.js';

import {
  applyEnvelopeCeremonyCommandV213,
  ceremonyCommandForV213,
  createInitialCaseEnvelopeV213,
  refreshPartyViewCursorsV213,
  type EnvelopeCeremonyOperationV213,
} from '../v2-1-3/envelope-ceremony.js';
import { validateCaseEnvelopeV213 } from '../v2-1-3/contract-validator.js';
import {
  applyExternalRelaySubmissionV213,
  rebaseExternalRelaySubmissionV213,
} from '../v2-1-3/external-relay-submission.js';
import {
  FORMATION_PERSISTENCE_CONTRACT_VERSION_V213,
  type ActiveFormationContextV213,
  type CommitControlledDisclosureInputV213,
  type CommitControlledDisclosureResultV213,
  type CommitExternalRelaySubmissionInputV213,
  type CommitExternalRelaySubmissionResultV213,
  type FormationPartyPersistenceContextV213,
  type FormationReplayRecordV213,
  type FormationReplayResponseV213,
  type StoredFormationDisputeV213,
} from '../v2-1-3/formation-persistence.js';
import {
  createV213PartyCaseService,
  projectPartyCaseStateV213,
  type FormationRelayRepositoryV213,
  type RelayApplicationIdsV213,
  type V213PartyCaseService,
} from '../v2-1-3/webmcp-application.js';
import { projectPartyFormationV213 } from '../v2-1-3/party-projection.js';
import {
  PERMITTED_CASE_STATE_SLOTS,
  decodeCaseStateResponse,
  decodeCaseServiceResult,
  type CaseServicePort,
} from '../webmcp/public-contract-v0-3.js';
import type { CompilerInput, CompilerOutput } from '../webmcp/core-v0-3/compiler-contract.js';
import type { CompileOptions, SemanticCompilerPort } from '../webmcp/runtime-v0-3/compiler-port.js';
import {
  ScriptedSemanticCompiler,
  type CompilerScript,
} from '../webmcp/runtime-v0-3/scripted-compiler.js';

import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';

const SUBJECT_A = 'subject_party_a';
const SUBJECT_B = 'subject_party_b';
let sequence = 0;

function unique(label: string): string {
  sequence += 1;
  return `${label}_${sequence}`;
}

function requirement(id: string, required = true): Omit<FormationRequirementV213, 'party_id'> {
  return {
    requirement_id: id,
    label: id,
    prompt: `Please answer ${id}.`,
    required,
    satisfying_types: ['narrative_fact'],
    min_propositions: 1,
    max_propositions: null,
    adverse_fact_probe: false,
    reopened_from: null,
  };
}

function ceremony(
  envelope: CaseEnvelopeV213,
  authority: Parameters<typeof applyEnvelopeCeremonyCommandV213>[0]['execution_authority'],
  operation: EnvelopeCeremonyOperationV213,
): CaseEnvelopeV213 {
  const result = applyEnvelopeCeremonyCommandV213({
    envelope,
    command: ceremonyCommandForV213(envelope, unique('ceremony'), operation),
    execution_authority: authority,
  });
  if (result.status !== 'applied') throw new Error(result.message);
  return result.envelope;
}

function baseEnvelope(disputeId = unique('dispute_app')): CaseEnvelopeV213 {
  let envelope = createInitialCaseEnvelopeV213(disputeId, {
    party_a: [requirement('req_a'), requirement('req_a_optional', false)],
    party_b: [requirement('req_b'), requirement('req_b_optional', false)],
  });
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V213, {
    type: 'bind_party',
    party_slot: 'party_a',
    authenticated_subject_id: SUBJECT_A,
    binding_event_id: unique('binding_party_a'),
  });
  return ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V213, {
    type: 'bind_party',
    party_slot: 'party_b',
    authenticated_subject_id: SUBJECT_B,
    binding_event_id: unique('binding_party_b'),
  });
}

function replayResponse(
  envelope: CaseEnvelopeV213,
  partyId: PartyIdV213,
  submission: CommitExternalRelaySubmissionInputV213['submission'],
  applied: Extract<ReturnType<typeof applyExternalRelaySubmissionV213>, { status: 'applied' }>,
): FormationReplayResponseV213 {
  const cursor = envelope.control.party_views[partyId];
  return {
    persistence_contract_version: FORMATION_PERSISTENCE_CONTRACT_VERSION_V213,
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

class MemoryFormationRepository implements FormationRelayRepositoryV213 {
  envelope: CaseEnvelopeV213;
  readonly replays = new Map<string, FormationReplayRecordV213>();
  readonly issued = new WeakSet<object>();

  constructor(envelope: CaseEnvelopeV213) {
    this.envelope = cloneCanonical(envelope);
  }

  replace(envelope: CaseEnvelopeV213): void {
    this.envelope = cloneCanonical(envelope);
  }

  stored(): StoredFormationDisputeV213 {
    return {
      envelope: cloneCanonical(this.envelope),
      internal_envelope_version: this.envelope.control.envelope_version,
      internal_envelope_hash: this.envelope.control.envelope_hash,
      created_at_ms: 1,
      updated_at_ms: this.envelope.control.envelope_version,
    };
  }

  async findById(disputeId: string): Promise<StoredFormationDisputeV213 | null> {
    return disputeId === this.envelope.control.case_id ? this.stored() : null;
  }

  async listActiveContextsForPrincipal(subjectId: string): Promise<ActiveFormationContextV213[]> {
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
  ): Promise<FormationPartyPersistenceContextV213 | null> {
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
    context: FormationPartyPersistenceContextV213,
    clientTurnId: string,
  ): Promise<FormationReplayRecordV213 | null> {
    if (!this.issued.has(context)) return null;
    return cloneCanonical(
      this.replays.get(`${context.dispute_id}|${context.party_id}|${clientTurnId}`) ?? null,
    );
  }

  async commitExternalRelaySubmission(
    input: CommitExternalRelaySubmissionInputV213,
  ): Promise<CommitExternalRelaySubmissionResultV213> {
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
      const next = rebaseExternalRelaySubmissionV213(submission, this.envelope);
      if (!next) return { status: 'conflict', replayed: false, current: this.stored() };
      submission = next;
      rebased = true;
    }
    const applied = applyExternalRelaySubmissionV213({
      envelope: this.envelope,
      submission,
      execution_authority: partyAuthorityV213(
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
    input: CommitControlledDisclosureInputV213,
  ): Promise<CommitControlledDisclosureResultV213> {
    if (
      input.dispute_id !== this.envelope.control.case_id ||
      input.expected_internal_envelope_version !== this.envelope.control.envelope_version ||
      input.expected_internal_envelope_hash !== this.envelope.control.envelope_hash
    ) {
      return { status: 'conflict', current: this.stored() };
    }
    const applied = applyEnvelopeCeremonyCommandV213({
      envelope: this.envelope,
      command: ceremonyCommandForV213(this.envelope, input.command_id, {
        type: 'open_controlled_disclosure',
      }),
      execution_authority: TRUSTED_SYSTEM_AUTHORITY_V213,
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

  private partyFor(subjectId: string): PartyIdV213 | null {
    for (const partyId of ['party_a', 'party_b'] as const) {
      if (this.envelope.parties[partyId].authenticated_subject_id === subjectId) return partyId;
    }
    return null;
  }
}

export { MemoryFormationRepository };
