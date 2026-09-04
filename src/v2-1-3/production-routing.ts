import type { CaseServicePort, JuryAiServiceError } from '../webmcp/supported-public-contract.js';
import { invitationUnavailableResultV21 } from '../v2-1/invitation-service.js';
import type { ProductionCaseServiceV212 } from '../v2-1-2/production-case-service.js';
import type { ProductionFirstPartyServiceV212 } from '../v2-1-2/production-first-party.js';
import type { ProductionCaseServiceV213 } from './production-case-service.js';
import type { ProductionFirstPartyServiceV213 } from './production-first-party.js';
import {
  isLegacyCasePersistenceIdV211,
  isV211DisputePersistenceId,
} from '../v2-1-1/formation-persistence.js';

export type ProductionFormationVersion =
  'juryai-case-envelope-v2.1.2' | 'juryai-case-envelope-v2.1.3';
export type FormationVersionResolver = (
  disputeId: string,
) => Promise<ProductionFormationVersion | null>;
const missing = (): JuryAiServiceError => ({
  ok: false,
  error: { code: 'CASE_NOT_FOUND', message: 'No such case.', retryable: false },
});

/** An ID prefix selects a persistence family, never a semantic contract. */
export function createProductionVersionedCaseServiceV213(input: {
  enabled: boolean;
  legacy: CaseServicePort;
  v212: ProductionCaseServiceV212 | null;
  v213: ProductionCaseServiceV213 | null;
  resolveVersion: FormationVersionResolver;
  startCaseId: (clientRequestId: string) => string;
}): CaseServicePort {
  if (!input.enabled || !input.v213 || !input.v212) return input.legacy;
  const { v212, v213 } = input;
  const service = async (id: string): Promise<CaseServicePort | null> => {
    if (isLegacyCasePersistenceIdV211(id)) return input.legacy;
    if (!isV211DisputePersistenceId(id)) return null;
    const version = await input.resolveVersion(id);
    return version === 'juryai-case-envelope-v2.1.2'
      ? v212
      : version === 'juryai-case-envelope-v2.1.3'
        ? v213
        : null;
  };
  return {
    startCase: async (command, options) => {
      // Retry/lost-response identities are stable across a writer upgrade.
      const id = input.startCaseId(command.client_request_id);
      const existing = await service(id);
      return existing
        ? existing.getCaseState({ case_id: id }, options)
        : v213.startCase(command, options);
    },
    getCaseState: async (query, options) => {
      if (query.case_id !== undefined)
        return (await service(query.case_id))?.getCaseState(query, options) ?? missing();
      const [legacy, oldIds, newIds] = await Promise.all([
        input.legacy.getCaseState({}, options),
        v212.listActiveCaseIds(options),
        v213.listActiveCaseIds(options),
      ]);
      if (!legacy.ok && legacy.error.code !== 'CASE_NOT_FOUND') return legacy;
      const ids = [...oldIds, ...newIds];
      const total = ids.length + (legacy.ok ? 1 : 0);
      if (!total) return missing();
      if (total !== 1)
        return {
          ok: false,
          error: {
            code: 'CONFLICT',
            message: 'Multiple active cases exist; provide an explicit case_id.',
            retryable: false,
          },
        };
      return legacy.ok
        ? legacy
        : ((await service(ids[0]!))?.getCaseState({ case_id: ids[0]! }, options) ?? missing());
    },
    submitTurn: async (command, options) =>
      (await service(command.case_id))?.submitTurn(command, options) ?? missing(),
  };
}

export type ProductionFirstPartyService = {
  [K in keyof ProductionFirstPartyServiceV212]: (
    ...args: Parameters<ProductionFirstPartyServiceV212[K]>
  ) => Promise<
    Awaited<
      | ReturnType<ProductionFirstPartyServiceV212[K]>
      | ReturnType<ProductionFirstPartyServiceV213[K]>
    >
  >;
};

export function createVersionedFirstPartyService(input: {
  v212: ProductionFirstPartyServiceV212;
  v213: ProductionFirstPartyServiceV213;
  resolveVersion: FormationVersionResolver;
  resolveInvitationVersion: (token: string) => Promise<ProductionFormationVersion | null>;
}): ProductionFirstPartyService {
  const select = (version: ProductionFormationVersion | null) =>
    version === 'juryai-case-envelope-v2.1.2'
      ? input.v212
      : version === 'juryai-case-envelope-v2.1.3'
        ? input.v213
        : null;
  const service = async (id: string) => select(await input.resolveVersion(id));
  return {
    issueInvitation: async (request) =>
      (await service(request.dispute_id))?.issueInvitation(request) ??
      invitationUnavailableResultV21(),
    redeemInvitation: async (request) =>
      select(await input.resolveInvitationVersion(request.opaque_token))?.redeemInvitation(
        request,
      ) ?? invitationUnavailableResultV21(),
    getReview: async (id) => (await service(id))?.getReview(id) ?? null,
    getReviewPage: async (id) => (await service(id))?.getReviewPage(id) ?? null,
    acknowledgeDisclosureReview: async (id) =>
      (await service(id))?.acknowledgeDisclosureReview(id) ?? { status: 'unauthorized' },
    issueReviewChallenge: async (request) =>
      (await service(request.dispute_id))?.issueReviewChallenge(request) ?? {
        status: 'rejected',
        reason_code: 'unavailable',
        message: 'Review is unavailable.',
      },
    executeReviewAction: async (request) =>
      (await service(request.dispute_id))?.executeReviewAction(request) ?? {
        status: 'rejected',
        reason_code: 'unavailable',
        message: 'Review is unavailable.',
      },
  };
}
