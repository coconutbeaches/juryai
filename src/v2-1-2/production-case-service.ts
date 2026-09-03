import { createHmac } from 'node:crypto';
import type { SemanticCompilerPort } from '../webmcp/runtime/compiler-port.js';
import type {
  CaseServicePort,
  GetCaseStateResult,
  JuryAiServiceError,
  ServiceCallOptions,
  StartCaseCommand,
  StartCaseResult,
  SubmitTurnResult,
} from '../webmcp/public-contract.js';
import { initialRequirementSet } from '../webmcp/runtime/initial-requirements.js';
import {
  isLegacyCasePersistenceIdV211,
  isV211DisputePersistenceId,
} from '../v2-1-1/formation-persistence.js';
import {
  TRUSTED_SYSTEM_AUTHORITY_V212,
  type CaseEnvelopeV212,
  type FormationRequirementV212,
} from './case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV212,
  ceremonyCommandForV212,
  createInitialCaseEnvelopeV212,
} from './envelope-ceremony.js';
import type {
  CommitCeremonyResultV212,
  CommitControlledDisclosureInputV212,
  StoredFormationDisputeV212,
} from './formation-persistence.js';
import {
  createV212PartyCaseService,
  type FormationRelayRepositoryV212,
  type V212PartyCaseService,
} from './webmcp-application.js';

export interface ProductionFormationRepositoryV212 extends FormationRelayRepositoryV212 {
  createDispute(
    envelope: CaseEnvelopeV212,
  ): Promise<{ created: boolean; stored: StoredFormationDisputeV212 }>;
  commitControlledDisclosure(
    input: CommitControlledDisclosureInputV212,
  ): Promise<CommitCeremonyResultV212>;
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

function formationRequirement(
  party: 'party_a' | 'party_b',
  definition: ReturnType<typeof initialRequirementSet>[number],
): Omit<FormationRequirementV212, 'party_id'> {
  return {
    requirement_id: `req_${party}_${definition.requirement_id.replace(/^req_/u, '')}`,
    label: definition.requirement_id,
    prompt: definition.prompt,
    required: true,
    satisfying_types: [...definition.satisfying_types],
    min_propositions: definition.min_propositions,
    max_propositions: definition.max_propositions,
    adverse_fact_probe: definition.adverse_fact_probe,
    reopened_from: definition.reopened_from,
  };
}

export function createInitialProductionDisputeV212(input: {
  authenticated_subject_id: string;
  client_request_id: string;
  idempotency_secret: string;
}): CaseEnvelopeV212 {
  const digest = hmac(
    input.idempotency_secret,
    'juryai-v2.1.2-production-start',
    input.authenticated_subject_id,
    input.client_request_id,
  );
  const disputeId = `dispute_${digest}`;
  const definitions = initialRequirementSet();
  let envelope = createInitialCaseEnvelopeV212(disputeId, {
    party_a: definitions.map((definition) => formationRequirement('party_a', definition)),
    party_b: definitions.map((definition) => formationRequirement('party_b', definition)),
  });
  const bindingEventId = `binding_party_a_${hmac(input.idempotency_secret, 'binding', digest).slice(0, 32)}`;
  const bound = applyEnvelopeCeremonyCommandV212({
    envelope,
    command: ceremonyCommandForV212(envelope, `command_start_${digest.slice(0, 32)}`, {
      type: 'bind_party',
      party_slot: 'party_a',
      authenticated_subject_id: input.authenticated_subject_id,
      binding_event_id: bindingEventId,
    }),
    execution_authority: TRUSTED_SYSTEM_AUTHORITY_V212,
  });
  if (bound.status !== 'applied') throw new TypeError(bound.message);
  envelope = bound.envelope;
  return envelope;
}

function disclosureCommandId(stored: StoredFormationDisputeV212): string {
  return `command_disclosure_${stored.internal_envelope_hash.slice(0, 32)}`;
}

export async function attemptControlledDisclosureV212(
  repository: ProductionFormationRepositoryV212,
  stored: StoredFormationDisputeV212,
): Promise<StoredFormationDisputeV212> {
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

export interface ProductionCaseServiceV212 extends CaseServicePort {
  listActiveCaseIds(options?: ServiceCallOptions): Promise<string[]>;
}

export function createProductionCaseServiceV212(input: {
  authenticated_subject_id: string;
  repository: ProductionFormationRepositoryV212;
  compiler: SemanticCompilerPort;
  review_url: (disputeId: string) => string;
  idempotency_secret: string;
}): ProductionCaseServiceV212 {
  const partyService: V212PartyCaseService = createV212PartyCaseService(input);
  const refreshSuccessfulSubmit = async (
    result: SubmitTurnResult,
    options?: ServiceCallOptions,
  ): Promise<SubmitTurnResult> => {
    if (!result.ok) return result;
    const stored = await input.repository.findById(result.case.case_id);
    if (!stored) return serviceError('CASE_NOT_FOUND', 'No such case.');
    await attemptControlledDisclosureV212(input.repository, stored);
    const current = await partyService.getCaseState({ case_id: result.case.case_id }, options);
    return current.ok ? { ...result, case: current.case } : current;
  };

  return {
    listActiveCaseIds: (options) => partyService.listActiveCaseIds(options),
    startCase: async (command: StartCaseCommand, options): Promise<StartCaseResult> => {
      try {
        options?.signal?.throwIfAborted();
        const envelope = createInitialProductionDisputeV212({
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

function noSuchCase(): JuryAiServiceError {
  return serviceError('CASE_NOT_FOUND', 'No such case.');
}

function ambiguousActiveContext(): JuryAiServiceError {
  return serviceError('CONFLICT', 'Multiple active cases exist; provide an explicit case_id.');
}

export function createProductionVersionedCaseServiceV212(input: {
  enabled: boolean;
  legacy: CaseServicePort;
  v212: ProductionCaseServiceV212 | null;
}): CaseServicePort {
  if (!input.enabled || !input.v212) return input.legacy;
  const v212 = input.v212;
  return {
    startCase: (command, options) => v212.startCase(command, options),
    getCaseState: async (query, options): Promise<GetCaseStateResult> => {
      if (query.case_id !== undefined) {
        if (isLegacyCasePersistenceIdV211(query.case_id)) {
          return input.legacy.getCaseState(query, options);
        }
        if (isV211DisputePersistenceId(query.case_id)) {
          return v212.getCaseState(query, options);
        }
        return noSuchCase();
      }
      const [legacy, v212Ids] = await Promise.all([
        input.legacy.getCaseState({}, options),
        v212.listActiveCaseIds(options),
      ]);
      if (!legacy.ok && legacy.error.code !== 'CASE_NOT_FOUND') return legacy;
      const total = (legacy.ok ? 1 : 0) + v212Ids.length;
      if (total === 0) return noSuchCase();
      if (total !== 1) return ambiguousActiveContext();
      return legacy.ok ? legacy : v212.getCaseState({ case_id: v212Ids[0]! }, options);
    },
    submitTurn: (command, options) => {
      if (isLegacyCasePersistenceIdV211(command.case_id)) {
        return input.legacy.submitTurn(command, options);
      }
      if (isV211DisputePersistenceId(command.case_id)) {
        return v212.submitTurn(command, options);
      }
      return Promise.resolve(noSuchCase());
    },
  };
}
