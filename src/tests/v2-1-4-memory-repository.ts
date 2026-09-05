import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import {
  PARTY_FORMATION_PROJECTION_VERSION_V214,
  TRUSTED_SYSTEM_AUTHORITY_V214,
  hashCaseEnvelopeV214,
  partyAuthorityV214,
  type CaseEnvelopeV214,
  type FormationRequirementV214,
  type PartyIdV214,
} from '../v2-1-4/case-envelope.js';

import {
  applyEnvelopeCeremonyCommandV214,
  ceremonyCommandForV214,
  createInitialCaseEnvelopeV214,
  refreshPartyViewCursorsV214,
  type EnvelopeCeremonyOperationV214,
} from '../v2-1-4/envelope-ceremony.js';
import { validateCaseEnvelopeV214 } from '../v2-1-4/contract-validator.js';
import {
  applyExternalRelaySubmissionV214,
  rebaseExternalRelaySubmissionV214,
} from '../v2-1-4/external-relay-submission.js';
import {
  FORMATION_PERSISTENCE_CONTRACT_VERSION_V214,
  type ActiveFormationContextV214,
  type CommitControlledDisclosureInputV214,
  type CommitControlledDisclosureResultV214,
  type CommitExternalRelaySubmissionInputV214,
  type CommitExternalRelaySubmissionResultV214,
  type FormationPartyPersistenceContextV214,
  type FormationReplayRecordV214,
  type FormationReplayResponseV214,
  type StoredFormationDisputeV214,
} from '../v2-1-4/formation-persistence.js';
import {
  createV214PartyCaseService,
  projectPartyCaseStateV214,
  type FormationRelayRepositoryV214,
  type RelayApplicationIdsV214,
  type V214PartyCaseService,
} from '../v2-1-4/webmcp-application.js';
import { projectPartyFormationV214 } from '../v2-1-4/party-projection.js';
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

function requirement(id: string, required = true): Omit<FormationRequirementV214, 'party_id'> {
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
  envelope: CaseEnvelopeV214,
  authority: Parameters<typeof applyEnvelopeCeremonyCommandV214>[0]['execution_authority'],
  operation: EnvelopeCeremonyOperationV214,
): CaseEnvelopeV214 {
  const result = applyEnvelopeCeremonyCommandV214({
    envelope,
    command: ceremonyCommandForV214(envelope, unique('ceremony'), operation),
    execution_authority: authority,
  });
  if (result.status !== 'applied') throw new Error(result.message);
  return result.envelope;
}

function baseEnvelope(disputeId = unique('dispute_app')): CaseEnvelopeV214 {
  let envelope = createInitialCaseEnvelopeV214(disputeId, {
    party_a: [requirement('req_a'), requirement('req_a_optional', false)],
    party_b: [requirement('req_b'), requirement('req_b_optional', false)],
  });
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V214, {
    type: 'bind_party',
    party_slot: 'party_a',
    authenticated_subject_id: SUBJECT_A,
    binding_event_id: unique('binding_party_a'),
  });
  return ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V214, {
    type: 'bind_party',
    party_slot: 'party_b',
    authenticated_subject_id: SUBJECT_B,
    binding_event_id: unique('binding_party_b'),
  });
}

function replayResponse(
  envelope: CaseEnvelopeV214,
  partyId: PartyIdV214,
  submission: CommitExternalRelaySubmissionInputV214['submission'],
  applied: Extract<ReturnType<typeof applyExternalRelaySubmissionV214>, { status: 'applied' }>,
): FormationReplayResponseV214 {
  const cursor = envelope.control.party_views[partyId];
  return {
    persistence_contract_version: FORMATION_PERSISTENCE_CONTRACT_VERSION_V214,
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

class MemoryFormationRepository implements FormationRelayRepositoryV214 {
  envelope: CaseEnvelopeV214;
  readonly replays = new Map<string, FormationReplayRecordV214>();
  readonly issued = new WeakSet<object>();

  constructor(envelope: CaseEnvelopeV214) {
    this.envelope = cloneCanonical(envelope);
  }

  replace(envelope: CaseEnvelopeV214): void {
    this.envelope = cloneCanonical(envelope);
  }

  stored(): StoredFormationDisputeV214 {
    return {
      envelope: cloneCanonical(this.envelope),
      internal_envelope_version: this.envelope.control.envelope_version,
      internal_envelope_hash: this.envelope.control.envelope_hash,
      created_at_ms: 1,
      updated_at_ms: this.envelope.control.envelope_version,
    };
  }

  async findById(disputeId: string): Promise<StoredFormationDisputeV214 | null> {
    return disputeId === this.envelope.control.case_id ? this.stored() : null;
  }

  async listActiveContextsForPrincipal(subjectId: string): Promise<ActiveFormationContextV214[]> {
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
  ): Promise<FormationPartyPersistenceContextV214 | null> {
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
    context: FormationPartyPersistenceContextV214,
    clientTurnId: string,
  ): Promise<FormationReplayRecordV214 | null> {
    if (!this.issued.has(context)) return null;
    return cloneCanonical(
      this.replays.get(`${context.dispute_id}|${context.party_id}|${clientTurnId}`) ?? null,
    );
  }

  async commitExternalRelaySubmission(
    input: CommitExternalRelaySubmissionInputV214,
  ): Promise<CommitExternalRelaySubmissionResultV214> {
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
      const next = rebaseExternalRelaySubmissionV214(submission, this.envelope);
      if (!next) return { status: 'conflict', replayed: false, current: this.stored() };
      submission = next;
      rebased = true;
    }
    const applied = applyExternalRelaySubmissionV214({
      envelope: this.envelope,
      submission,
      execution_authority: partyAuthorityV214(
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
    input: CommitControlledDisclosureInputV214,
  ): Promise<CommitControlledDisclosureResultV214> {
    if (
      input.dispute_id !== this.envelope.control.case_id ||
      input.expected_internal_envelope_version !== this.envelope.control.envelope_version ||
      input.expected_internal_envelope_hash !== this.envelope.control.envelope_hash
    ) {
      return { status: 'conflict', current: this.stored() };
    }
    const applied = applyEnvelopeCeremonyCommandV214({
      envelope: this.envelope,
      command: ceremonyCommandForV214(this.envelope, input.command_id, {
        type: 'open_controlled_disclosure',
      }),
      execution_authority: TRUSTED_SYSTEM_AUTHORITY_V214,
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

  private partyFor(subjectId: string): PartyIdV214 | null {
    for (const partyId of ['party_a', 'party_b'] as const) {
      if (this.envelope.parties[partyId].authenticated_subject_id === subjectId) return partyId;
    }
    return null;
  }
}

export { MemoryFormationRepository };
