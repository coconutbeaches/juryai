import type { CaseEnvelopeV212 } from './case-envelope.js';
import type {
  ActiveFormationContextV211,
  CommitExternalRelaySubmissionInputV211,
  FormationPartyPersistenceContextV211,
  FormationReplayRecordV211,
  FormationReplayResponseV211,
} from '../v2-1-1/formation-persistence.js';
import type { ExternalRelaySubmissionFailureReasonV211 } from '../v2-1-1/external-relay-submission.js';
import type { CeremonyCommandFailureReasonV212 } from './envelope-ceremony.js';

export const FORMATION_PERSISTENCE_CONTRACT_VERSION_V212 =
  'juryai-v2.1.2-disclosure-review-persistence-v1';
export const FORMATION_PERSISTENCE_SCHEMA_V212 = 'juryai_v21';

export interface StoredFormationDisputeV212 {
  envelope: CaseEnvelopeV212;
  internal_envelope_version: number;
  internal_envelope_hash: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export type ActiveFormationContextV212 = ActiveFormationContextV211;
export type FormationPartyPersistenceContextV212 = FormationPartyPersistenceContextV211;
export type FormationReplayRecordV212 = FormationReplayRecordV211;
export type FormationReplayResponseV212 = FormationReplayResponseV211;
export type CommitExternalRelaySubmissionInputV212 = CommitExternalRelaySubmissionInputV211;

export type CommitExternalRelaySubmissionResultV212 =
  | {
      status: 'committed';
      replayed: false;
      hidden_state_rebased: boolean;
      stored: StoredFormationDisputeV212;
      response: FormationReplayResponseV212;
    }
  | {
      status: 'replayed';
      replayed: true;
      stored: StoredFormationDisputeV212;
      response: FormationReplayResponseV212;
    }
  | { status: 'idempotency_conflict'; replayed: false }
  | { status: 'conflict'; replayed: false; current: StoredFormationDisputeV212 | null }
  | { status: 'unauthorized'; replayed: false }
  | {
      status: 'domain_rejected';
      replayed: false;
      reason_code: ExternalRelaySubmissionFailureReasonV211;
      message: string;
    };

export interface CommitControlledDisclosureInputV212 {
  dispute_id: string;
  command_id: string;
  expected_internal_envelope_version: number;
  expected_internal_envelope_hash: string;
}

export interface CommitDisclosureReviewAcknowledgmentInputV212 {
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

export interface CommitFinalConfirmationInputV212 {
  dispute_id: string;
  expected_internal_envelope_version: number;
  expected_internal_envelope_hash: string;
  command_id: string;
}

export type CommitCeremonyResultV212 =
  | { status: 'committed'; stored: StoredFormationDisputeV212 }
  | { status: 'conflict'; current: StoredFormationDisputeV212 | null }
  | { status: 'unauthorized' }
  | {
      status: 'domain_rejected';
      reason_code: CeremonyCommandFailureReasonV212;
      message: string;
    };
