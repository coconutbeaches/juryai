import type { CaseRuntime, RuntimeCallOptions, RuntimeRequestContext } from '../runtime/index.js';
import type {
  CaseServicePort,
  GetCaseStateQuery,
  GetCaseStateResult,
  JuryAiServiceError,
  ServiceCallOptions,
  StartCaseCommand,
  StartCaseResult,
  SubmitTurnCommand,
  SubmitTurnResult,
} from '../tools/ports.js';

type RuntimeCaseOperations = Pick<CaseRuntime, 'startCase' | 'getCaseState' | 'submitTurn'>;

/** Trusted server/session boundary. No identity is accepted from WebMCP input. */
export interface TrustedRuntimeRequestContextProvider {
  getRuntimeRequestContext(
    options?: RuntimeCallOptions,
  ): RuntimeRequestContext | Promise<RuntimeRequestContext>;
}

export interface RuntimeCaseServiceDependencies {
  runtime: RuntimeCaseOperations;
  contextProvider: TrustedRuntimeRequestContextProvider;
}

function runtimeOptions(options?: ServiceCallOptions): RuntimeCallOptions {
  return options?.signal === undefined ? {} : { signal: options.signal };
}

async function requestContext(
  provider: TrustedRuntimeRequestContextProvider,
  options?: ServiceCallOptions,
): Promise<RuntimeRequestContext> {
  options?.signal?.throwIfAborted();
  const context = await provider.getRuntimeRequestContext(runtimeOptions(options));
  options?.signal?.throwIfAborted();
  return context;
}

function serviceFailure(error: JuryAiServiceError['error']): JuryAiServiceError {
  return { ok: false, error };
}

/**
 * Renames canonical runtime outcomes for the frozen CaseServicePort. It adds
 * no authorization, replay, conflict, semantic, validation, or persistence
 * decisions of its own.
 */
export function createRuntimeCaseService(
  dependencies: RuntimeCaseServiceDependencies,
): CaseServicePort {
  return {
    startCase: async (
      command: StartCaseCommand,
      options?: ServiceCallOptions,
    ): Promise<StartCaseResult> => {
      const context = await requestContext(dependencies.contextProvider, options);
      const outcome = await dependencies.runtime.startCase(context, command);
      options?.signal?.throwIfAborted();

      switch (outcome.kind) {
        case 'created':
          return { ok: true, case: outcome.case };
        case 'open_draft_exists':
          return {
            ok: false,
            error: {
              code: 'OPEN_DRAFT_EXISTS',
              message: 'An active draft already exists.',
              retryable: false,
            },
            case: outcome.case,
          };
        case 'failed':
          return serviceFailure(outcome.failure);
      }
    },

    getCaseState: async (
      query: GetCaseStateQuery,
      options?: ServiceCallOptions,
    ): Promise<GetCaseStateResult> => {
      const context = await requestContext(dependencies.contextProvider, options);
      const outcome = await dependencies.runtime.getCaseState(context, query);
      options?.signal?.throwIfAborted();

      switch (outcome.kind) {
        case 'ok':
          return { ok: true, case: outcome.case };
        case 'failed':
          return serviceFailure(outcome.failure);
      }
    },

    submitTurn: async (
      command: SubmitTurnCommand,
      options?: ServiceCallOptions,
    ): Promise<SubmitTurnResult> => {
      const context = await requestContext(dependencies.contextProvider, options);
      const outcome = await dependencies.runtime.submitTurn(
        context,
        command,
        runtimeOptions(options),
      );

      switch (outcome.kind) {
        case 'committed':
          return {
            ok: true,
            turn_id: outcome.turn_id,
            case: outcome.case,
            recorded: outcome.recorded,
            superseded: outcome.superseded_proposition_ids,
          };
        case 'replayed':
          return {
            ok: true,
            replayed: true,
            turn_id: outcome.turn_id,
            case: outcome.case,
            recorded: outcome.recorded,
            superseded: outcome.superseded_proposition_ids,
          };
        case 'version_conflict':
          return {
            ok: false,
            error: {
              code: 'VERSION_CONFLICT',
              message: 'The case changed before this turn could be recorded.',
              retryable: false,
            },
            current_case_version: outcome.current_case_version,
            recent_turns: outcome.recent_turns,
            likely_already_recorded: outcome.likely_already_recorded,
            case: outcome.case,
          };
        case 'failed':
          return serviceFailure(outcome.failure);
      }
    },
  };
}
