import type { ProductionCaseServiceV215 } from './production-case-service.js';
import type { ProductionFirstPartyServiceV215 } from './production-first-party.js';
import type { CaseServicePort, JuryAiServiceError } from '../webmcp/supported-public-contract.js';
import { invitationUnavailableResultV21 } from '../v2-1/invitation-service.js';
import type { ProductionCaseServiceV212 } from '../v2-1-2/production-case-service.js';
import type { ProductionFirstPartyServiceV212 } from '../v2-1-2/production-first-party.js';
import type { ProductionCaseServiceV213 } from '../v2-1-3/production-case-service.js';
import type { ProductionFirstPartyServiceV213 } from '../v2-1-3/production-first-party.js';
import type { ProductionCaseServiceV214 } from '../v2-1-4/production-case-service.js';
import type { ProductionFirstPartyServiceV214 } from '../v2-1-4/production-first-party.js';
import {
  isLegacyCasePersistenceIdV211,
  isV211DisputePersistenceId,
} from '../v2-1-1/formation-persistence.js';

/**
 * Every generation that can still be READ in production. V2.1.5 is the current
 * writer; V2.1.2, V2.1.3 and V2.1.4 stay readable and writable exactly as persisted,
 * because a dispute's semantics are fixed when it is created and never migrate.
 */
export type ProductionFormationVersion =
  | 'juryai-case-envelope-v2.1.2'
  | 'juryai-case-envelope-v2.1.3'
  | 'juryai-case-envelope-v2.1.4'
  | 'juryai-case-envelope-v2.1.5';
export type FormationVersionResolver = (
  disputeId: string,
) => Promise<ProductionFormationVersion | null>;
const missing = (): JuryAiServiceError => ({
  ok: false,
  error: { code: 'CASE_NOT_FOUND', message: 'No such case.', retryable: false },
});

/** An ID prefix selects a persistence family, never a semantic contract. */
export function createProductionVersionedCaseServiceV215(input: {
  enabled: boolean;
  legacy: CaseServicePort;
  v212: ProductionCaseServiceV212 | null;
  v213: ProductionCaseServiceV213 | null;
  v214: ProductionCaseServiceV214 | null;
  v215: ProductionCaseServiceV215 | null;
  resolveVersion: FormationVersionResolver;
  startCaseId: (clientRequestId: string) => string;
}): CaseServicePort {
  if (!input.enabled || !input.v215 || !input.v214 || !input.v213 || !input.v212)
    return input.legacy;
  const { v212, v213, v214, v215 } = input;
  const service = async (id: string): Promise<CaseServicePort | null> => {
    if (isLegacyCasePersistenceIdV211(id)) return input.legacy;
    if (!isV211DisputePersistenceId(id)) return null;
    const version = await input.resolveVersion(id);
    return version === 'juryai-case-envelope-v2.1.2'
      ? v212
      : version === 'juryai-case-envelope-v2.1.3'
        ? v213
        : version === 'juryai-case-envelope-v2.1.4'
          ? v214
          : version === 'juryai-case-envelope-v2.1.5'
            ? v215
            : null;
  };
  return {
    startCase: async (command, options) => {
      // Retry/lost-response identities are stable across a writer upgrade: the
      // deterministic id is derived from an unchanged domain string, so a retry
      // of a start that already created a V2.1.2, V2.1.3 or V2.1.4 dispute resolves to
      // THAT dispute in its own generation rather than creating a V2.1.5 twin.
      const id = input.startCaseId(command.client_request_id);
      const existing = await service(id);
      return existing
        ? existing.getCaseState({ case_id: id }, options)
        : v215.startCase(command, options);
    },
    getCaseState: async (query, options) => {
      if (
        query.own_position_cursor &&
        (query.case_id === undefined ||
          (await input.resolveVersion(query.case_id)) !== 'juryai-case-envelope-v2.1.5')
      )
        return {
          ok: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Repair pagination requires a V2.1.5 case.',
            retryable: false,
          },
        };
      if (query.case_id !== undefined)
        return (await service(query.case_id))?.getCaseState(query, options) ?? missing();
      const [legacy, v212Ids, v213Ids, v214Ids, v215Ids] = await Promise.all([
        input.legacy.getCaseState({}, options),
        v212.listActiveCaseIds(options),
        v213.listActiveCaseIds(options),
        v214.listActiveCaseIds(options),
        v215.listActiveCaseIds(options),
      ]);
      if (!legacy.ok && legacy.error.code !== 'CASE_NOT_FOUND') return legacy;
      const ids = [...v212Ids, ...v213Ids, ...v214Ids, ...v215Ids];
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
  returnToEdit?: ProductionFirstPartyServiceV215['returnToEdit'];
} & {
  [K in keyof ProductionFirstPartyServiceV212]: (
    ...args: Parameters<ProductionFirstPartyServiceV212[K]>
  ) => Promise<
    Awaited<
      | ReturnType<ProductionFirstPartyServiceV212[K]>
      | ReturnType<ProductionFirstPartyServiceV213[K]>
      | ReturnType<ProductionFirstPartyServiceV214[K]>
      | ReturnType<ProductionFirstPartyServiceV215[K]>
    >
  >;
};

export function createVersionedFirstPartyService(input: {
  v212: ProductionFirstPartyServiceV212;
  v213: ProductionFirstPartyServiceV213;
  v214: ProductionFirstPartyServiceV214;
  v215: ProductionFirstPartyServiceV215;
  resolveVersion: FormationVersionResolver;
  resolveInvitationVersion: (token: string) => Promise<ProductionFormationVersion | null>;
}): ProductionFirstPartyService {
  const select = (version: ProductionFormationVersion | null) =>
    version === 'juryai-case-envelope-v2.1.2'
      ? input.v212
      : version === 'juryai-case-envelope-v2.1.3'
        ? input.v213
        : version === 'juryai-case-envelope-v2.1.4'
          ? input.v214
          : version === 'juryai-case-envelope-v2.1.5'
            ? input.v215
            : null;
  const service = async (id: string) => select(await input.resolveVersion(id));
  return {
    returnToEdit: async (request) =>
      (await input.resolveVersion(request.dispute_id)) === 'juryai-case-envelope-v2.1.5'
        ? (input.v215.returnToEdit?.(request) ?? { status: 'unauthorized' })
        : { status: 'unauthorized' },
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
