import { cloneCanonical, type JsonValue } from '../v2/case-envelope.js';
import type {
  CanonicalSemanticPositionV211,
  CaseEnvelopeV211,
  FormationChallengeResponseV211,
  FormationChallengeV211,
  FormationClarificationV211,
  PartyIdV211,
  SourceTurnV211,
} from './case-envelope.js';
import type {
  ExternalRelaySubmissionFailureReasonV211,
  ExternalRelaySubmissionV211,
} from './external-relay-submission.js';

export const FORMATION_PERSISTENCE_CONTRACT_VERSION_V211 =
  'juryai-v2.1-dark-formation-persistence-v2';
export const FORMATION_PERSISTENCE_SCHEMA_V211 = 'juryai_v21';

const LEGACY_CASE_ID_PATTERN = /^case_[A-Za-z0-9_.:-]+$/u;
const DISPUTE_ID_PATTERN = /^dispute_[A-Za-z0-9_.:-]+$/u;

function boundedIdentifier(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 && pattern.test(value);
}

export function isLegacyCasePersistenceIdV211(value: unknown): value is string {
  return boundedIdentifier(LEGACY_CASE_ID_PATTERN, value);
}

export function isV211DisputePersistenceId(value: unknown): value is string {
  return boundedIdentifier(DISPUTE_ID_PATTERN, value);
}

export function assertV211DisputePersistenceId(identifier: string): void {
  if (!isV211DisputePersistenceId(identifier)) {
    throw new TypeError('Only dispute_ identifiers may enter V2.1.1 formation persistence.');
  }
}

export interface StoredFormationDisputeV211 {
  envelope: CaseEnvelopeV211;
  internal_envelope_version: number;
  internal_envelope_hash: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface ActiveFormationContextV211 {
  dispute_id: string;
  party_id: PartyIdV211;
  internal_envelope_version: number;
  internal_envelope_hash: string;
  party_visible_version: number;
  party_projection_hash: string;
}

/** Opaque repository-issued capability after subject-to-party resolution. */
export interface FormationPartyPersistenceContextV211 extends ActiveFormationContextV211 {
  readonly authenticated_subject_id: string;
}

export interface FormationSourceAuditRecordV211 {
  dispute_id: string;
  party_id: PartyIdV211;
  source_id: string;
  source_turn_id: string;
  source_hash: string;
  recorded_at_ms: number;
}

export interface FormationSubmissionAuditRecordV211 {
  dispute_id: string;
  party_id: PartyIdV211;
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
  submission: ExternalRelaySubmissionV211;
  recorded_at_ms: number;
}

export interface FormationCompilerRunAuditRecordV211 {
  dispute_id: string;
  party_id: PartyIdV211;
  compiler_run_id: string;
  submission_id: string;
  compiler_version_id: string;
  input_hash: string;
  output_hash: string;
  recorded_at_ms: number;
}

export interface FormationReplayResponseV211 {
  persistence_contract_version: typeof FORMATION_PERSISTENCE_CONTRACT_VERSION_V211;
  dispute_id: string;
  party_id: PartyIdV211;
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

export interface FormationReplayRecordV211 {
  dispute_id: string;
  party_id: PartyIdV211;
  client_turn_id: string;
  request_fingerprint: string;
  response: FormationReplayResponseV211;
  recorded_at_ms: number;
}

export interface ResolvedFormationReplayObjectsV211 {
  source_turn: SourceTurnV211;
  accepted_positions: CanonicalSemanticPositionV211[];
  superseded_positions: CanonicalSemanticPositionV211[];
  opened_clarifications: FormationClarificationV211[];
  resolved_clarifications: FormationClarificationV211[];
  challenges: FormationChallengeV211[];
  challenge_responses: FormationChallengeResponseV211[];
}

/** Resolves the immutable canonical objects named by the stored logical receipt. */
export function resolveFormationReplayObjectsV211(
  envelope: CaseEnvelopeV211,
  response: FormationReplayResponseV211,
): ResolvedFormationReplayObjectsV211 {
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
    .filter((candidate): candidate is FormationChallengeResponseV211 => candidate !== null);
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
    accepted_positions: cloneCanonical(accepted as CanonicalSemanticPositionV211[]),
    superseded_positions: cloneCanonical(superseded as CanonicalSemanticPositionV211[]),
    opened_clarifications: cloneCanonical(opened as FormationClarificationV211[]),
    resolved_clarifications: cloneCanonical(resolved as FormationClarificationV211[]),
    challenges: cloneCanonical(challenges as FormationChallengeV211[]),
    challenge_responses: cloneCanonical(challengeResponses as FormationChallengeResponseV211[]),
  };
}

export interface CommitExternalRelaySubmissionInputV211 {
  context: FormationPartyPersistenceContextV211;
  submission: ExternalRelaySubmissionV211;
  source_id: string;
  recorded_at_ms: number;
}

export type CommitExternalRelaySubmissionResultV211 =
  | {
      status: 'committed';
      replayed: false;
      hidden_state_rebased: boolean;
      stored: StoredFormationDisputeV211;
      response: FormationReplayResponseV211;
    }
  | {
      status: 'replayed';
      replayed: true;
      stored: StoredFormationDisputeV211;
      response: FormationReplayResponseV211;
    }
  | { status: 'idempotency_conflict'; replayed: false }
  | { status: 'conflict'; replayed: false; current: StoredFormationDisputeV211 | null }
  | { status: 'unauthorized'; replayed: false }
  | {
      status: 'domain_rejected';
      replayed: false;
      reason_code: ExternalRelaySubmissionFailureReasonV211;
      message: string;
    };

export type FormationReplayPayloadV211 = JsonValue;
