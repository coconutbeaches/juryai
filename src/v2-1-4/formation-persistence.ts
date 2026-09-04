import { cloneCanonical, type JsonValue } from '../v2/case-envelope.js';
import type {
  CanonicalSemanticPositionV214,
  CaseEnvelopeV214,
  FormationChallengeResponseV214,
  FormationChallengeV214,
  FormationClarificationV214,
  PartyIdV214,
  SourceTurnV214,
} from './case-envelope.js';
import type {
  ExternalRelaySubmissionFailureReasonV214,
  ExternalRelaySubmissionV214,
} from './external-relay-submission.js';
import type { CeremonyCommandFailureReasonV214 } from './envelope-ceremony.js';

export const FORMATION_PERSISTENCE_CONTRACT_VERSION_V214 = 'juryai-v2.1.4-formation-persistence-v1';
export const FORMATION_PERSISTENCE_SCHEMA_V214 = 'juryai_v21';

const LEGACY_CASE_ID_PATTERN = /^case_[A-Za-z0-9_.:-]+$/u;
const DISPUTE_ID_PATTERN = /^dispute_[A-Za-z0-9_.:-]+$/u;

function boundedIdentifier(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 && pattern.test(value);
}

export function isLegacyCasePersistenceIdV214(value: unknown): value is string {
  return boundedIdentifier(LEGACY_CASE_ID_PATTERN, value);
}

export function isV214DisputePersistenceId(value: unknown): value is string {
  return boundedIdentifier(DISPUTE_ID_PATTERN, value);
}

export function assertV214DisputePersistenceId(identifier: string): void {
  if (!isV214DisputePersistenceId(identifier)) {
    throw new TypeError('Only dispute_ identifiers may enter V2.1.4 formation persistence.');
  }
}

export interface StoredFormationDisputeV214 {
  envelope: CaseEnvelopeV214;
  internal_envelope_version: number;
  internal_envelope_hash: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface ActiveFormationContextV214 {
  dispute_id: string;
  party_id: PartyIdV214;
  internal_envelope_version: number;
  internal_envelope_hash: string;
  party_visible_version: number;
  party_projection_hash: string;
}

/** Opaque repository-issued capability after subject-to-party resolution. */
export interface FormationPartyPersistenceContextV214 extends ActiveFormationContextV214 {
  readonly authenticated_subject_id: string;
}

export interface FormationSourceAuditRecordV214 {
  dispute_id: string;
  party_id: PartyIdV214;
  source_id: string;
  source_turn_id: string;
  source_hash: string;
  recorded_at_ms: number;
}

export interface FormationSubmissionAuditRecordV214 {
  dispute_id: string;
  party_id: PartyIdV214;
  submission_id: string;
  client_turn_id: string;
  source_id: string;
  source_turn_id: string;
  base_internal_envelope_version: number;
  base_internal_envelope_hash: string;
  resulting_internal_envelope_version: number;
  resulting_internal_envelope_hash: string;
  resulting_party_visible_version: number;
  resulting_party_projection_hash: string;
  submission: ExternalRelaySubmissionV214;
  recorded_at_ms: number;
}

export interface FormationCompilerArtifactV214 {
  registry_entry: import('../webmcp/core-v0-3/compiler-contract.js').CompilerRegistryEntry;
  run: import('../webmcp/core-v0-3/compiler-contract.js').CompileRunRecord;
}

export interface FormationCompilerRunAuditRecordV214 {
  persistence_contract_version: typeof FORMATION_PERSISTENCE_CONTRACT_VERSION_V214;
  compiler_artifact: FormationCompilerArtifactV214;
  dispute_id: string;
  party_id: PartyIdV214;
  compiler_run_id: string;
  submission_id: string;
  compiler_version_id: string;
  input_hash: string;
  output_hash: string;
  recorded_at_ms: number;
}

export interface FormationReplayResponseV214 {
  persistence_contract_version: typeof FORMATION_PERSISTENCE_CONTRACT_VERSION_V214;
  dispute_id: string;
  party_id: PartyIdV214;
  submission_id: string;
  source_turn_id: string;
  accepted_position_ids: string[];
  superseded_position_ids: string[];
  opened_clarification_ids: string[];
  resolved_clarification_ids: string[];
  challenge_ids: string[];
  challenge_response_ids: string[];
  warnings: string[];
  resulting_internal_envelope_version: number;
  resulting_internal_envelope_hash: string;
  resulting_party_visible_version: number;
  resulting_party_projection_hash: string;
}

export interface FormationReplayRecordV214 {
  dispute_id: string;
  party_id: PartyIdV214;
  client_turn_id: string;
  request_fingerprint: string;
  response: FormationReplayResponseV214;
  recorded_at_ms: number;
}

export interface ResolvedFormationReplayObjectsV214 {
  source_turn: SourceTurnV214;
  accepted_positions: CanonicalSemanticPositionV214[];
  superseded_positions: CanonicalSemanticPositionV214[];
  opened_clarifications: FormationClarificationV214[];
  resolved_clarifications: FormationClarificationV214[];
  challenges: FormationChallengeV214[];
  challenge_responses: FormationChallengeResponseV214[];
}

/** Resolves the immutable canonical objects named by the stored logical receipt. */
export function resolveFormationReplayObjectsV214(
  envelope: CaseEnvelopeV214,
  response: FormationReplayResponseV214,
): ResolvedFormationReplayObjectsV214 {
  if (
    envelope.control.case_id !== response.dispute_id ||
    !['party_a', 'party_b'].includes(response.party_id)
  ) {
    throw new TypeError('Replay receipt does not belong to this canonical envelope.');
  }
  const party = response.party_id;
  const sourceTurn = envelope.source_turns[response.source_turn_id];
  const accepted = response.accepted_position_ids.map((id) => envelope.positions[id]);
  const superseded = response.superseded_position_ids.map((id) => envelope.positions[id]);
  const opened = response.opened_clarification_ids.map((id) => envelope.clarifications[id]);
  const resolved = response.resolved_clarification_ids.map((id) => envelope.clarifications[id]);
  const challenges = response.challenge_ids.map((id) => envelope.challenges[id]);
  const allResponses = Object.values(envelope.challenges)
    .map((challenge) => challenge.response)
    .filter((candidate): candidate is FormationChallengeResponseV214 => candidate !== null);
  const challengeResponses = response.challenge_response_ids.map((id) =>
    allResponses.find((candidate) => candidate.response_id === id),
  );
  if (
    !sourceTurn ||
    sourceTurn.attributed_party_id !== party ||
    accepted.some(
      (position) =>
        !position ||
        position.attributed_party_id !== party ||
        position.source_turn_id !== sourceTurn.turn_id,
    ) ||
    superseded.some((position) => !position || position.attributed_party_id !== party) ||
    opened.some((clarification) => !clarification || clarification.party_id !== party) ||
    resolved.some((clarification) => !clarification || clarification.party_id !== party) ||
    challenges.some((challenge) => !challenge || challenge.challenging_party_id !== party) ||
    challengeResponses.some((response) => !response || response.responding_party_id !== party)
  ) {
    throw new TypeError('Replay receipt does not resolve to its own party canonical objects.');
  }
  return {
    source_turn: cloneCanonical(sourceTurn),
    accepted_positions: cloneCanonical(accepted as CanonicalSemanticPositionV214[]),
    superseded_positions: cloneCanonical(superseded as CanonicalSemanticPositionV214[]),
    opened_clarifications: cloneCanonical(opened as FormationClarificationV214[]),
    resolved_clarifications: cloneCanonical(resolved as FormationClarificationV214[]),
    challenges: cloneCanonical(challenges as FormationChallengeV214[]),
    challenge_responses: cloneCanonical(challengeResponses as FormationChallengeResponseV214[]),
  };
}

export interface CommitExternalRelaySubmissionInputV214 {
  context: FormationPartyPersistenceContextV214;
  submission: ExternalRelaySubmissionV214;
  compiler_artifact: FormationCompilerArtifactV214;
  source_id: string;
  recorded_at_ms: number;
}

export type CommitExternalRelaySubmissionResultV214 =
  | {
      status: 'committed';
      replayed: false;
      hidden_state_rebased: boolean;
      stored: StoredFormationDisputeV214;
      response: FormationReplayResponseV214;
    }
  | {
      status: 'replayed';
      replayed: true;
      stored: StoredFormationDisputeV214;
      response: FormationReplayResponseV214;
    }
  | { status: 'idempotency_conflict'; replayed: false }
  | { status: 'conflict'; replayed: false; current: StoredFormationDisputeV214 | null }
  | { status: 'unauthorized'; replayed: false }
  | {
      status: 'domain_rejected';
      replayed: false;
      reason_code: ExternalRelaySubmissionFailureReasonV214;
      message: string;
    };

export interface CommitControlledDisclosureInputV214 {
  dispute_id: string;
  command_id: string;
  expected_internal_envelope_version: number;
  expected_internal_envelope_hash: string;
}

export type CommitControlledDisclosureResultV214 =
  | { status: 'committed'; stored: StoredFormationDisputeV214 }
  | { status: 'conflict'; current: StoredFormationDisputeV214 | null }
  | {
      status: 'domain_rejected';
      reason_code: CeremonyCommandFailureReasonV214;
      message: string;
    };

export type FormationReplayPayloadV214 = JsonValue;

export interface CommitDisclosureReviewAcknowledgmentInputV214 {
  dispute_id: string;
  authenticated_subject_id: string;
  expected_internal_envelope_version: number;
  expected_internal_envelope_hash: string;
  command_id: string;
  acknowledgment_id: string;
  event_id: string;
  acknowledged_at: string;
  recorded_at_ms: number;
}

export interface CommitFinalConfirmationInputV214 {
  dispute_id: string;
  expected_internal_envelope_version: number;
  expected_internal_envelope_hash: string;
  command_id: string;
}

export type CommitCeremonyResultV214 =
  | { status: 'committed'; stored: StoredFormationDisputeV214 }
  | { status: 'conflict'; current: StoredFormationDisputeV214 | null }
  | { status: 'unauthorized' }
  | {
      status: 'domain_rejected';
      reason_code: CeremonyCommandFailureReasonV214;
      message: string;
    };
