import { V215_SPEC } from './generation-spec.js';
import { cloneCanonical, type JsonValue } from '../v2/case-envelope.js';
import type {
  CanonicalSemanticPositionV215,
  CaseEnvelopeV215,
  FormationChallengeResponseV215,
  FormationChallengeV215,
  FormationClarificationV215,
  PartyIdV215,
  SourceTurnV215,
} from './case-envelope.js';
import type {
  ExternalRelaySubmissionFailureReasonV215,
  ExternalRelaySubmissionV215,
} from './external-relay-submission.js';
import type { CeremonyCommandFailureReasonV215 } from './envelope-ceremony.js';

export const FORMATION_PERSISTENCE_CONTRACT_VERSION_V215 = V215_SPEC.contracts.persistence_version;
export const FORMATION_PERSISTENCE_SCHEMA_V215 = 'juryai_v21';

const LEGACY_CASE_ID_PATTERN = /^case_[A-Za-z0-9_.:-]+$/u;
const DISPUTE_ID_PATTERN = /^dispute_[A-Za-z0-9_.:-]+$/u;

function boundedIdentifier(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 && pattern.test(value);
}

export function isLegacyCasePersistenceIdV215(value: unknown): value is string {
  return boundedIdentifier(LEGACY_CASE_ID_PATTERN, value);
}

export function isV215DisputePersistenceId(value: unknown): value is string {
  return boundedIdentifier(DISPUTE_ID_PATTERN, value);
}

export function assertV215DisputePersistenceId(identifier: string): void {
  if (!isV215DisputePersistenceId(identifier)) {
    throw new TypeError('Only dispute_ identifiers may enter V2.1.5 formation persistence.');
  }
}

export interface StoredFormationDisputeV215 {
  envelope: CaseEnvelopeV215;
  internal_envelope_version: number;
  internal_envelope_hash: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface ActiveFormationContextV215 {
  dispute_id: string;
  party_id: PartyIdV215;
  internal_envelope_version: number;
  internal_envelope_hash: string;
  party_visible_version: number;
  party_projection_hash: string;
}

/** Opaque repository-issued capability after subject-to-party resolution. */
export interface FormationPartyPersistenceContextV215 extends ActiveFormationContextV215 {
  readonly authenticated_subject_id: string;
}

export interface FormationSourceAuditRecordV215 {
  dispute_id: string;
  party_id: PartyIdV215;
  source_id: string;
  source_turn_id: string;
  source_hash: string;
  recorded_at_ms: number;
}

export interface FormationSubmissionAuditRecordV215 {
  dispute_id: string;
  party_id: PartyIdV215;
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
  submission: ExternalRelaySubmissionV215;
  recorded_at_ms: number;
}

export interface FormationCompilerArtifactV215 {
  registry_entry: import('../webmcp/core-v0-3/compiler-contract.js').CompilerRegistryEntry;
  run: import('../webmcp/core-v0-3/compiler-contract.js').CompileRunRecord;
}

export interface FormationCompilerRunAuditRecordV215 {
  persistence_contract_version: typeof FORMATION_PERSISTENCE_CONTRACT_VERSION_V215;
  compiler_artifact: FormationCompilerArtifactV215;
  dispute_id: string;
  party_id: PartyIdV215;
  compiler_run_id: string;
  submission_id: string;
  compiler_version_id: string;
  input_hash: string;
  output_hash: string;
  recorded_at_ms: number;
}

export interface FormationReplayResponseV215 {
  persistence_contract_version: typeof FORMATION_PERSISTENCE_CONTRACT_VERSION_V215;
  dispute_id: string;
  party_id: PartyIdV215;
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

export interface FormationReplayRecordV215 {
  dispute_id: string;
  party_id: PartyIdV215;
  client_turn_id: string;
  request_fingerprint: string;
  response: FormationReplayResponseV215;
  recorded_at_ms: number;
}

export interface ResolvedFormationReplayObjectsV215 {
  source_turn: SourceTurnV215;
  accepted_positions: CanonicalSemanticPositionV215[];
  superseded_positions: CanonicalSemanticPositionV215[];
  opened_clarifications: FormationClarificationV215[];
  resolved_clarifications: FormationClarificationV215[];
  challenges: FormationChallengeV215[];
  challenge_responses: FormationChallengeResponseV215[];
}

/** Resolves the immutable canonical objects named by the stored logical receipt. */
export function resolveFormationReplayObjectsV215(
  envelope: CaseEnvelopeV215,
  response: FormationReplayResponseV215,
): ResolvedFormationReplayObjectsV215 {
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
    .filter((candidate): candidate is FormationChallengeResponseV215 => candidate !== null);
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
    accepted_positions: cloneCanonical(accepted as CanonicalSemanticPositionV215[]),
    superseded_positions: cloneCanonical(superseded as CanonicalSemanticPositionV215[]),
    opened_clarifications: cloneCanonical(opened as FormationClarificationV215[]),
    resolved_clarifications: cloneCanonical(resolved as FormationClarificationV215[]),
    challenges: cloneCanonical(challenges as FormationChallengeV215[]),
    challenge_responses: cloneCanonical(challengeResponses as FormationChallengeResponseV215[]),
  };
}

export interface CommitExternalRelaySubmissionInputV215 {
  context: FormationPartyPersistenceContextV215;
  submission: ExternalRelaySubmissionV215;
  compiler_artifact: FormationCompilerArtifactV215;
  source_id: string;
  recorded_at_ms: number;
}

export type CommitExternalRelaySubmissionResultV215 =
  | {
      status: 'committed';
      replayed: false;
      hidden_state_rebased: boolean;
      stored: StoredFormationDisputeV215;
      response: FormationReplayResponseV215;
    }
  | {
      status: 'replayed';
      replayed: true;
      stored: StoredFormationDisputeV215;
      response: FormationReplayResponseV215;
    }
  | { status: 'idempotency_conflict'; replayed: false }
  | { status: 'conflict'; replayed: false; current: StoredFormationDisputeV215 | null }
  | { status: 'unauthorized'; replayed: false }
  | {
      status: 'domain_rejected';
      replayed: false;
      reason_code: ExternalRelaySubmissionFailureReasonV215;
      message: string;
    };

export interface CommitControlledDisclosureInputV215 {
  dispute_id: string;
  command_id: string;
  expected_internal_envelope_version: number;
  expected_internal_envelope_hash: string;
}

export type CommitControlledDisclosureResultV215 =
  | { status: 'committed'; stored: StoredFormationDisputeV215 }
  | { status: 'conflict'; current: StoredFormationDisputeV215 | null }
  | {
      status: 'domain_rejected';
      reason_code: CeremonyCommandFailureReasonV215;
      message: string;
    };

export type FormationReplayPayloadV215 = JsonValue;

export interface CommitDisclosureReviewAcknowledgmentInputV215 {
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

export interface CommitFinalConfirmationInputV215 {
  dispute_id: string;
  expected_internal_envelope_version: number;
  expected_internal_envelope_hash: string;
  command_id: string;
}

export type CommitCeremonyResultV215 =
  | { status: 'committed'; stored: StoredFormationDisputeV215 }
  | { status: 'conflict'; current: StoredFormationDisputeV215 | null }
  | { status: 'unauthorized' }
  | {
      status: 'domain_rejected';
      reason_code: CeremonyCommandFailureReasonV215;
      message: string;
    };
