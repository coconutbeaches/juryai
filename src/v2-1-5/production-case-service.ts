import { PRODUCTION_START_IDENTITY_DOMAIN } from '../compatibility/formation-constants.js';
import { createHmac } from 'node:crypto';
import type { SemanticCompilerPort } from '../webmcp/runtime-v0-3/compiler-port.js';
import type {
  CaseServicePort,
  GetCaseStateResult,
  JuryAiServiceError,
  ServiceCallOptions,
  StartCaseCommand,
  StartCaseResult,
  SubmitTurnResult,
} from '../webmcp/public-contract-v0-3.js';
import {
  isLegacyCasePersistenceIdV215,
  isV215DisputePersistenceId,
} from './formation-persistence.js';
import { TRUSTED_SYSTEM_AUTHORITY_V215, type CaseEnvelopeV215 } from './case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV215,
  ceremonyCommandForV215,
  createInitialCaseEnvelopeV215,
} from './envelope-ceremony.js';
import type {
  CommitCeremonyResultV215,
  CommitControlledDisclosureInputV215,
  StoredFormationDisputeV215,
} from './formation-persistence.js';
import {
  createV215PartyCaseService,
  type FormationRelayRepositoryV215,
  type V215PartyCaseService,
} from './webmcp-application.js';

export interface ProductionFormationRepositoryV215 extends FormationRelayRepositoryV215 {
  createDispute(
    envelope: CaseEnvelopeV215,
  ): Promise<{ created: boolean; stored: StoredFormationDisputeV215 }>;
  commitControlledDisclosure(
    input: CommitControlledDisclosureInputV215,
  ): Promise<CommitCeremonyResultV215>;
}

function serviceError(
  code: JuryAiServiceError['error']['code'],
  message: string,
  retryable = false,
): JuryAiServiceError {
  return { ok: false, error: { code, message, retryable } };
}

function hmac(secret: string, ...parts: string[]): string {
  const digest = createHmac('sha256', Buffer.from(secret, 'utf8'));
  for (const part of parts) digest.update('\0').update(part);
  return digest.digest('hex');
}

export function createInitialProductionDisputeV215(input: {
  authenticated_subject_id: string;
  client_request_id: string;
  idempotency_secret: string;
}): CaseEnvelopeV215 {
  const digest = hmac(
    input.idempotency_secret,
    PRODUCTION_START_IDENTITY_DOMAIN,
    input.authenticated_subject_id,
    input.client_request_id,
  );
  const disputeId = `dispute_${digest}`;
  let envelope = createInitialCaseEnvelopeV215(disputeId);
  const bindingEventId = `binding_party_a_${hmac(input.idempotency_secret, 'binding', digest).slice(0, 32)}`;
  const bound = applyEnvelopeCeremonyCommandV215({
    envelope,
    command: ceremonyCommandForV215(envelope, `command_start_${digest.slice(0, 32)}`, {
      type: 'bind_party',
      party_slot: 'party_a',
      authenticated_subject_id: input.authenticated_subject_id,
      binding_event_id: bindingEventId,
    }),
    execution_authority: TRUSTED_SYSTEM_AUTHORITY_V215,
  });
  if (bound.status !== 'applied') throw new TypeError(bound.message);
  envelope = bound.envelope;
  return envelope;
}

function disclosureCommandId(stored: StoredFormationDisputeV215): string {
  return `command_disclosure_${stored.internal_envelope_hash.slice(0, 32)}`;
}

export async function attemptControlledDisclosureV215(
  repository: ProductionFormationRepositoryV215,
  stored: StoredFormationDisputeV215,
): Promise<StoredFormationDisputeV215> {
  if (
    stored.envelope.control.disclosure_state === 'disclosed' ||
    stored.envelope.control.workflow_state !== 'independent_formation'
  ) {
    return stored;
  }
  const result = await repository.commitControlledDisclosure({
    dispute_id: stored.envelope.control.case_id,
    command_id: disclosureCommandId(stored),
    expected_internal_envelope_version: stored.internal_envelope_version,
    expected_internal_envelope_hash: stored.internal_envelope_hash,
  });
  if (result.status === 'committed') return result.stored;
  if (result.status === 'conflict' && result.current) return result.current;
  return stored;
}

export interface ProductionCaseServiceV215 extends CaseServicePort {
  listActiveCaseIds(options?: ServiceCallOptions): Promise<string[]>;
}

export function createProductionCaseServiceV215(input: {
  authenticated_subject_id: string;
  repository: ProductionFormationRepositoryV215;
  compiler: SemanticCompilerPort;
  review_url: (disputeId: string) => string;
  idempotency_secret: string;
}): ProductionCaseServiceV215 {
  const partyService: V215PartyCaseService = createV215PartyCaseService(input);
  const refreshSuccessfulSubmit = async (
    result: SubmitTurnResult,
    options?: ServiceCallOptions,
  ): Promise<SubmitTurnResult> => {
    if (!result.ok) return result;
    const stored = await input.repository.findById(result.case.case_id);
    if (!stored) return serviceError('CASE_NOT_FOUND', 'No such case.');
    await attemptControlledDisclosureV215(input.repository, stored);
    const current = await partyService.getCaseState({ case_id: result.case.case_id }, options);
    return current.ok ? { ...result, case: current.case } : current;
  };

  return {
    listActiveCaseIds: (options) => partyService.listActiveCaseIds(options),
    startCase: async (command: StartCaseCommand, options): Promise<StartCaseResult> => {
      try {
        options?.signal?.throwIfAborted();
        const envelope = createInitialProductionDisputeV215({
          authenticated_subject_id: input.authenticated_subject_id,
          client_request_id: command.client_request_id,
          idempotency_secret: input.idempotency_secret,
        });
        await input.repository.createDispute(envelope);
        options?.signal?.throwIfAborted();
        return partyService.getCaseState({ case_id: envelope.control.case_id }, options);
      } catch (error) {
        if (options?.signal?.aborted) throw error;
        return serviceError('INTERNAL_ERROR', 'A new dispute could not be created.', true);
      }
    },
    getCaseState: (query, options) => partyService.getCaseState(query, options),
    submitTurn: async (command, options) =>
      refreshSuccessfulSubmit(await partyService.submitTurn(command, options), options),
  };
}
