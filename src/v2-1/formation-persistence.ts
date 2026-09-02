import type { JsonValue } from '../v2/case-envelope.js';
import type { CaseEnvelopeV21, PartyIdV21 } from './case-envelope.js';
import type { CommandFailureReasonV21, EnvelopeCommandV21 } from './envelope-command.js';

export const FORMATION_PERSISTENCE_CONTRACT_VERSION_V21 =
  'juryai-v2.1-dark-formation-persistence-v1';
export const FORMATION_PERSISTENCE_SCHEMA_V21 = 'juryai_v21';

const LEGACY_CASE_ID_PATTERN = /^case_[A-Za-z0-9_.:-]+$/u;
const DISPUTE_ID_PATTERN = /^dispute_[A-Za-z0-9_.:-]+$/u;

function boundedIdentifier(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 && pattern.test(value);
}

export function isLegacyCasePersistenceId(value: unknown): value is string {
  return boundedIdentifier(LEGACY_CASE_ID_PATTERN, value);
}

export function isV21DisputePersistenceId(value: unknown): value is string {
  return boundedIdentifier(DISPUTE_ID_PATTERN, value);
}

export type PersistenceFamilyV21 = 'legacy_p2' | 'v2_1_formation';

/**
 * Future mixed-version adapters must route by the closed identifier namespace,
 * never by database ordering or by attempting one repository after another.
 */
export function persistenceFamilyForIdV21(identifier: string): PersistenceFamilyV21 {
  if (isLegacyCasePersistenceId(identifier)) return 'legacy_p2';
  if (isV21DisputePersistenceId(identifier)) return 'v2_1_formation';
  throw new TypeError('Unknown JuryAI persistence identifier namespace.');
}

export function assertLegacyCasePersistenceId(identifier: string): void {
  if (persistenceFamilyForIdV21(identifier) !== 'legacy_p2') {
    throw new TypeError('V2.1 dispute identifiers cannot enter legacy P2 persistence.');
  }
}

export function assertV21DisputePersistenceId(identifier: string): void {
  if (persistenceFamilyForIdV21(identifier) !== 'v2_1_formation') {
    throw new TypeError('Legacy case identifiers cannot enter V2.1 formation persistence.');
  }
}

export interface StoredFormationDisputeV21 {
  envelope: CaseEnvelopeV21;
  internal_envelope_version: number;
  internal_envelope_hash: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface CreateFormationDisputeResultV21 {
  created: boolean;
  stored: StoredFormationDisputeV21;
}

export interface ActiveFormationContextV21 {
  dispute_id: string;
  party_id: PartyIdV21;
  internal_envelope_version: number;
  internal_envelope_hash: string;
  party_visible_version: number;
  party_projection_hash: string;
}

/**
 * Opaque capability issued only after the repository resolves an authenticated
 * subject against generated principal lookup columns. Runtime implementations
 * additionally reject objects they did not issue, even if cast through `unknown`.
 */
export interface FormationPartyPersistenceContextV21 extends ActiveFormationContextV21 {
  readonly authenticated_subject_id: string;
}

export interface FormationSourceAuditInputV21 {
  source_id: string;
}

export interface FormationSubmissionAuditInputV21 {
  submission_id: string;
}

export interface FormationCompilerRunAuditInputV21 {
  compiler_run_id: string;
  compiler_version_id: string;
  input_hash: string;
  output_hash: string;
}

export interface FormationAuditBundleInputV21 {
  recorded_at_ms: number;
  source?: FormationSourceAuditInputV21;
  submission?: FormationSubmissionAuditInputV21;
  compiler_run?: FormationCompilerRunAuditInputV21;
}

export interface FormationReplayResponseV21 {
  persistence_contract_version: typeof FORMATION_PERSISTENCE_CONTRACT_VERSION_V21;
  dispute_id: string;
  party_id: PartyIdV21;
  command_id: string;
  resulting_envelope_version: number;
  resulting_envelope_hash: string;
}

export interface CommitExternalRelayCommandInputV21 {
  context: FormationPartyPersistenceContextV21;
  command: EnvelopeCommandV21;
  client_turn_id: string;
  request_fingerprint: string;
  audit: FormationAuditBundleInputV21;
}

export type CommitExternalRelayCommandResultV21 =
  | {
      status: 'committed';
      replayed: false;
      stored: StoredFormationDisputeV21;
      response: FormationReplayResponseV21;
    }
  | {
      status: 'replayed';
      replayed: true;
      stored: StoredFormationDisputeV21;
      response: FormationReplayResponseV21;
    }
  | {
      status: 'conflict';
      replayed: false;
      current: StoredFormationDisputeV21 | null;
    }
  | {
      status: 'unauthorized';
      replayed: false;
    }
  | {
      status: 'domain_rejected';
      replayed: false;
      reason_code: CommandFailureReasonV21;
      message: string;
    };

export interface FormationReplayRecordV21 {
  dispute_id: string;
  party_id: PartyIdV21;
  client_turn_id: string;
  request_fingerprint: string;
  response: FormationReplayResponseV21;
  recorded_at_ms: number;
}

export interface FormationSourceAuditRecordV21 {
  dispute_id: string;
  party_id: PartyIdV21;
  source_id: string;
  source_turn_id: string;
  source_hash: string;
  recorded_at_ms: number;
}

export interface FormationCommandAuditRecordV21 {
  dispute_id: string;
  party_id: PartyIdV21;
  command_id: string;
  base_envelope_version: number;
  base_envelope_hash: string;
  resulting_envelope_version: number;
  resulting_envelope_hash: string;
  command: EnvelopeCommandV21;
  recorded_at_ms: number;
}

export interface FormationSubmissionAuditRecordV21 {
  dispute_id: string;
  party_id: PartyIdV21;
  submission_id: string;
  client_turn_id: string;
  source_id: string;
  command_id: string;
  recorded_at_ms: number;
}

export interface FormationCompilerRunAuditRecordV21 {
  dispute_id: string;
  party_id: PartyIdV21;
  compiler_run_id: string;
  submission_id: string;
  compiler_version_id: string;
  input_hash: string;
  output_hash: string;
  recorded_at_ms: number;
}

export type FormationReplayPayloadV21 = JsonValue;
