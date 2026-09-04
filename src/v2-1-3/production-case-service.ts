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
import { initialRequirementSet } from './initial-requirements.js';
import {
  isLegacyCasePersistenceIdV213,
  isV213DisputePersistenceId,
} from './formation-persistence.js';
import {
  TRUSTED_SYSTEM_AUTHORITY_V213,
  type CaseEnvelopeV213,
  type FormationRequirementV213,
} from './case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV213,
  ceremonyCommandForV213,
  createInitialCaseEnvelopeV213,
} from './envelope-ceremony.js';
import type {
  CommitCeremonyResultV213,
  CommitControlledDisclosureInputV213,
  StoredFormationDisputeV213,
} from './formation-persistence.js';
import {
  createV213PartyCaseService,
  type FormationRelayRepositoryV213,
  type V213PartyCaseService,
} from './webmcp-application.js';

export interface ProductionFormationRepositoryV213 extends FormationRelayRepositoryV213 {
  createDispute(
    envelope: CaseEnvelopeV213,
  ): Promise<{ created: boolean; stored: StoredFormationDisputeV213 }>;
  commitControlledDisclosure(
    input: CommitControlledDisclosureInputV213,
  ): Promise<CommitCeremonyResultV213>;
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
): Omit<FormationRequirementV213, 'party_id'> {
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

export function createInitialProductionDisputeV213(input: {
  authenticated_subject_id: string;
  client_request_id: string;
  idempotency_secret: string;
}): CaseEnvelopeV213 {
  const digest = hmac(
    input.idempotency_secret,
    'juryai-v2.1.2-production-start',
    input.authenticated_subject_id,
    input.client_request_id,
  );
  const disputeId = `dispute_${digest}`;
  const definitions = initialRequirementSet();
  let envelope = createInitialCaseEnvelopeV213(disputeId, {
    party_a: definitions.map((definition) => formationRequirement('party_a', definition)),
    party_b: definitions.map((definition) => formationRequirement('party_b', definition)),
  });
  const bindingEventId = `binding_party_a_${hmac(input.idempotency_secret, 'binding', digest).slice(0, 32)}`;
  const bound = applyEnvelopeCeremonyCommandV213({
    envelope,
    command: ceremonyCommandForV213(envelope, `command_start_${digest.slice(0, 32)}`, {
      type: 'bind_party',
      party_slot: 'party_a',
      authenticated_subject_id: input.authenticated_subject_id,
      binding_event_id: bindingEventId,
    }),
    execution_authority: TRUSTED_SYSTEM_AUTHORITY_V213,
  });
  if (bound.status !== 'applied') throw new TypeError(bound.message);
  envelope = bound.envelope;
  return envelope;
}

function disclosureCommandId(stored: StoredFormationDisputeV213): string {
  return `command_disclosure_${stored.internal_envelope_hash.slice(0, 32)}`;
}

export async function attemptControlledDisclosureV213(
  repository: ProductionFormationRepositoryV213,
  stored: StoredFormationDisputeV213,
): Promise<StoredFormationDisputeV213> {
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

export interface ProductionCaseServiceV213 extends CaseServicePort {
  listActiveCaseIds(options?: ServiceCallOptions): Promise<string[]>;
}

export function createProductionCaseServiceV213(input: {
  authenticated_subject_id: string;
  repository: ProductionFormationRepositoryV213;
  compiler: SemanticCompilerPort;
  review_url: (disputeId: string) => string;
  idempotency_secret: string;
}): ProductionCaseServiceV213 {
  const partyService: V213PartyCaseService = createV213PartyCaseService(input);
  const refreshSuccessfulSubmit = async (
    result: SubmitTurnResult,
    options?: ServiceCallOptions,
  ): Promise<SubmitTurnResult> => {
    if (!result.ok) return result;
    const stored = await input.repository.findById(result.case.case_id);
    if (!stored) return serviceError('CASE_NOT_FOUND', 'No such case.');
    await attemptControlledDisclosureV213(input.repository, stored);
    const current = await partyService.getCaseState({ case_id: result.case.case_id }, options);
    return current.ok ? { ...result, case: current.case } : current;
  };

  return {
    listActiveCaseIds: (options) => partyService.listActiveCaseIds(options),
    startCase: async (command: StartCaseCommand, options): Promise<StartCaseResult> => {
      try {
        options?.signal?.throwIfAborted();
        const envelope = createInitialProductionDisputeV213({
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
