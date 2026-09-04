import { cloneCanonical, type JsonValue } from '../v2/case-envelope.js';
import type {
  CanonicalSemanticPositionV213,
  CaseEnvelopeV213,
  FormationChallengeResponseV213,
  FormationChallengeV213,
  FormationClarificationV213,
  PartyIdV213,
  SourceTurnV213,
} from './case-envelope.js';
import type {
  ExternalRelaySubmissionFailureReasonV213,
  ExternalRelaySubmissionV213,
} from './external-relay-submission.js';
import type { CeremonyCommandFailureReasonV213 } from './envelope-ceremony.js';

export const FORMATION_PERSISTENCE_CONTRACT_VERSION_V213 = 'juryai-v2.1.3-formation-persistence-v1';
export const FORMATION_PERSISTENCE_SCHEMA_V213 = 'juryai_v21';

const LEGACY_CASE_ID_PATTERN = /^case_[A-Za-z0-9_.:-]+$/u;
const DISPUTE_ID_PATTERN = /^dispute_[A-Za-z0-9_.:-]+$/u;

function boundedIdentifier(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 && pattern.test(value);
}

export function isLegacyCasePersistenceIdV213(value: unknown): value is string {
  return boundedIdentifier(LEGACY_CASE_ID_PATTERN, value);
}

export function isV213DisputePersistenceId(value: unknown): value is string {
  return boundedIdentifier(DISPUTE_ID_PATTERN, value);
}

export function assertV213DisputePersistenceId(identifier: string): void {
  if (!isV213DisputePersistenceId(identifier)) {
    throw new TypeError('Only dispute_ identifiers may enter V2.1.3 formation persistence.');
  }
}

export interface StoredFormationDisputeV213 {
  envelope: CaseEnvelopeV213;
  internal_envelope_version: number;
  internal_envelope_hash: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface ActiveFormationContextV213 {
  dispute_id: string;
  party_id: PartyIdV213;
  internal_envelope_version: number;
  internal_envelope_hash: string;
  party_visible_version: number;
  party_projection_hash: string;
}

/** Opaque repository-issued capability after subject-to-party resolution. */
export interface FormationPartyPersistenceContextV213 extends ActiveFormationContextV213 {
  readonly authenticated_subject_id: string;
}

export interface FormationSourceAuditRecordV213 {
  dispute_id: string;
  party_id: PartyIdV213;
  source_id: string;
  source_turn_id: string;
  source_hash: string;
  recorded_at_ms: number;
}

export interface FormationSubmissionAuditRecordV213 {
  dispute_id: string;
  party_id: PartyIdV213;
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
  submission: ExternalRelaySubmissionV213;
  recorded_at_ms: number;
}

export interface FormationCompilerArtifactV213 {
  registry_entry: import('../webmcp/core-v0-3/compiler-contract.js').CompilerRegistryEntry;
  run: import('../webmcp/core-v0-3/compiler-contract.js').CompileRunRecord;
}

export interface FormationCompilerRunAuditRecordV213 {
  persistence_contract_version: typeof FORMATION_PERSISTENCE_CONTRACT_VERSION_V213;
  compiler_artifact: FormationCompilerArtifactV213;
  dispute_id: string;
  party_id: PartyIdV213;
  compiler_run_id: string;
  submission_id: string;
  compiler_version_id: string;
  input_hash: string;
  output_hash: string;
  recorded_at_ms: number;
}

export interface FormationReplayResponseV213 {
  persistence_contract_version: typeof FORMATION_PERSISTENCE_CONTRACT_VERSION_V213;
  dispute_id: string;
  party_id: PartyIdV213;
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

export interface FormationReplayRecordV213 {
  dispute_id: string;
  party_id: PartyIdV213;
  client_turn_id: string;
  request_fingerprint: string;
  response: FormationReplayResponseV213;
  recorded_at_ms: number;
}

export interface ResolvedFormationReplayObjectsV213 {
  source_turn: SourceTurnV213;
  accepted_positions: CanonicalSemanticPositionV213[];
  superseded_positions: CanonicalSemanticPositionV213[];
  opened_clarifications: FormationClarificationV213[];
  resolved_clarifications: FormationClarificationV213[];
  challenges: FormationChallengeV213[];
  challenge_responses: FormationChallengeResponseV213[];
}

/** Resolves the immutable canonical objects named by the stored logical receipt. */
export function resolveFormationReplayObjectsV213(
  envelope: CaseEnvelopeV213,
  response: FormationReplayResponseV213,
): ResolvedFormationReplayObjectsV213 {
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
    .filter((candidate): candidate is FormationChallengeResponseV213 => candidate !== null);
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
    accepted_positions: cloneCanonical(accepted as CanonicalSemanticPositionV213[]),
    superseded_positions: cloneCanonical(superseded as CanonicalSemanticPositionV213[]),
    opened_clarifications: cloneCanonical(opened as FormationClarificationV213[]),
    resolved_clarifications: cloneCanonical(resolved as FormationClarificationV213[]),
    challenges: cloneCanonical(challenges as FormationChallengeV213[]),
    challenge_responses: cloneCanonical(challengeResponses as FormationChallengeResponseV213[]),
  };
}

export interface CommitExternalRelaySubmissionInputV213 {
  context: FormationPartyPersistenceContextV213;
  submission: ExternalRelaySubmissionV213;
  compiler_artifact: FormationCompilerArtifactV213;
  source_id: string;
  recorded_at_ms: number;
}

export type CommitExternalRelaySubmissionResultV213 =
  | {
      status: 'committed';
      replayed: false;
      hidden_state_rebased: boolean;
      stored: StoredFormationDisputeV213;
      response: FormationReplayResponseV213;
    }
  | {
      status: 'replayed';
      replayed: true;
      stored: StoredFormationDisputeV213;
      response: FormationReplayResponseV213;
    }
  | { status: 'idempotency_conflict'; replayed: false }
  | { status: 'conflict'; replayed: false; current: StoredFormationDisputeV213 | null }
  | { status: 'unauthorized'; replayed: false }
  | {
      status: 'domain_rejected';
      replayed: false;
      reason_code: ExternalRelaySubmissionFailureReasonV213;
      message: string;
    };

export interface CommitControlledDisclosureInputV213 {
  dispute_id: string;
  command_id: string;
  expected_internal_envelope_version: number;
  expected_internal_envelope_hash: string;
}

export type CommitControlledDisclosureResultV213 =
  | { status: 'committed'; stored: StoredFormationDisputeV213 }
  | { status: 'conflict'; current: StoredFormationDisputeV213 | null }
  | {
      status: 'domain_rejected';
      reason_code: CeremonyCommandFailureReasonV213;
      message: string;
    };

export type FormationReplayPayloadV213 = JsonValue;

export interface CommitDisclosureReviewAcknowledgmentInputV213 {
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

export interface CommitFinalConfirmationInputV213 {
  dispute_id: string;
  expected_internal_envelope_version: number;
  expected_internal_envelope_hash: string;
  command_id: string;
}

export type CommitCeremonyResultV213 =
  | { status: 'committed'; stored: StoredFormationDisputeV213 }
  | { status: 'conflict'; current: StoredFormationDisputeV213 | null }
  | { status: 'unauthorized' }
  | {
      status: 'domain_rejected';
      reason_code: CeremonyCommandFailureReasonV213;
      message: string;
    };
