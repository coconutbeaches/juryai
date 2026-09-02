import {
  isLegacyCasePersistenceIdV211,
  isV211DisputePersistenceId,
} from './formation-persistence.js';
import type { V211PartyCaseService } from './webmcp-application.js';
import type {
  CaseServicePort,
  GetCaseStateResult,
  JuryAiServiceError,
  ServiceCallOptions,
} from '../webmcp/public-contract.js';

export interface DarkVersionedCaseServiceDependencies {
  legacy: CaseServicePort;
  v211: V211PartyCaseService;
}

function noSuchCase(): JuryAiServiceError {
  return {
    ok: false,
    error: { code: 'CASE_NOT_FOUND', message: 'No such case.', retryable: false },
  };
}

function ambiguousActiveContext(): JuryAiServiceError {
  return {
    ok: false,
    error: {
      code: 'CONFLICT',
      message: 'Multiple active cases exist; provide an explicit case_id.',
      retryable: false,
    },
  };
}

/**
 * Testable mixed-version router. Production deliberately does not import or
 * instantiate this module while V2.1.1 remains dark.
 */
export function createDarkVersionedCaseService(
  dependencies: DarkVersionedCaseServiceDependencies,
): CaseServicePort {
  return {
    startCase: (command, options) => dependencies.legacy.startCase(command, options),
    getCaseState: async (query, options): Promise<GetCaseStateResult> => {
      if (query.case_id !== undefined) {
        if (isLegacyCasePersistenceIdV211(query.case_id)) {
          return dependencies.legacy.getCaseState(query, options);
        }
        if (isV211DisputePersistenceId(query.case_id)) {
          return dependencies.v211.getCaseState(query, options);
        }
        return noSuchCase();
      }

      const [legacy, v211Ids] = await Promise.all([
        dependencies.legacy.getCaseState({}, options),
        dependencies.v211.listActiveCaseIds(options),
      ]);
      const legacyFound = legacy.ok;
      if (!legacyFound && legacy.error.code !== 'CASE_NOT_FOUND') return legacy;
      const total = (legacyFound ? 1 : 0) + v211Ids.length;
      if (total === 0) return noSuchCase();
      if (total !== 1) return ambiguousActiveContext();
      return legacyFound
        ? legacy
        : dependencies.v211.getCaseState({ case_id: v211Ids[0]! }, options);
    },
    submitTurn: (command, options?: ServiceCallOptions) => {
      if (isLegacyCasePersistenceIdV211(command.case_id)) {
        return dependencies.legacy.submitTurn(command, options);
      }
      if (isV211DisputePersistenceId(command.case_id)) {
        return dependencies.v211.submitTurn(command, options);
      }
      return Promise.resolve(noSuchCase());
    },
  };
}
