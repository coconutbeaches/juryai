import {
  createV211PartyCaseService,
  type FormationRelayRepositoryV211,
  type V211PartyCaseService,
  type V211PartyCaseServiceDependencies,
} from '../v2-1-1/webmcp-application.js';
import type {
  CommitExternalRelaySubmissionInputV211,
  CommitExternalRelaySubmissionResultV211,
  StoredFormationDisputeV211,
} from '../v2-1-1/formation-persistence.js';
import { frozenRelayExecutionViewV211 } from './external-relay-submission.js';
import type {
  ActiveFormationContextV212,
  CommitExternalRelaySubmissionResultV212,
  FormationPartyPersistenceContextV212,
  FormationReplayRecordV212,
  StoredFormationDisputeV212,
} from './formation-persistence.js';

export interface FormationRelayRepositoryV212 {
  findById(disputeId: string): Promise<StoredFormationDisputeV212 | null>;
  listActiveContextsForPrincipal(subjectId: string): Promise<ActiveFormationContextV212[]>;
  resolvePartyContext(
    disputeId: string,
    subjectId: string,
  ): Promise<FormationPartyPersistenceContextV212 | null>;
  readReplayRecord(
    context: FormationPartyPersistenceContextV212,
    clientTurnId: string,
  ): Promise<FormationReplayRecordV212 | null>;
  commitExternalRelaySubmission(
    input: CommitExternalRelaySubmissionInputV211,
  ): Promise<CommitExternalRelaySubmissionResultV212>;
}

export type V212PartyCaseService = V211PartyCaseService;
export type V212PartyCaseServiceDependencies = Omit<
  V211PartyCaseServiceDependencies,
  'repository'
> & {
  repository: FormationRelayRepositoryV212;
};

function v211Stored(stored: StoredFormationDisputeV212): StoredFormationDisputeV211 {
  return {
    ...stored,
    envelope: frozenRelayExecutionViewV211(stored.envelope),
  };
}

function v211CommitResult(
  result: CommitExternalRelaySubmissionResultV212,
): CommitExternalRelaySubmissionResultV211 {
  switch (result.status) {
    case 'committed':
    case 'replayed':
      return { ...result, stored: v211Stored(result.stored) };
    case 'conflict':
      return { ...result, current: result.current ? v211Stored(result.current) : null };
    default:
      return result;
  }
}

/**
 * Deliberate compatibility adapter: compiler planning and the public twelve-slot
 * response run against a freshly derived frozen V2.1.1 relay view, while every
 * durable write is authorized and applied against the authoritative V2.1.2
 * envelope by the V2.1.2 repository.
 */
export function createV212PartyCaseService(
  dependencies: V212PartyCaseServiceDependencies,
): V212PartyCaseService {
  const repository: FormationRelayRepositoryV211 = {
    findById: async (disputeId) => {
      const stored = await dependencies.repository.findById(disputeId);
      return stored ? v211Stored(stored) : null;
    },
    listActiveContextsForPrincipal: (subjectId) =>
      dependencies.repository.listActiveContextsForPrincipal(subjectId),
    resolvePartyContext: (disputeId, subjectId) =>
      dependencies.repository.resolvePartyContext(disputeId, subjectId),
    readReplayRecord: (context, clientTurnId) =>
      dependencies.repository.readReplayRecord(context, clientTurnId),
    commitExternalRelaySubmission: async (input) =>
      v211CommitResult(await dependencies.repository.commitExternalRelaySubmission(input)),
  };
  return createV211PartyCaseService({ ...dependencies, repository });
}
