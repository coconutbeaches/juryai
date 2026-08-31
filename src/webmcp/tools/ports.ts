import type { ConflictTurnSummary } from '../core/idempotency.js';
import type { CaseStateResponse, RecentInterpretationSlot } from '../core/types.js';
import type { SourceTurnPayload } from '../core/turns.js';

export type JuryAiErrorCode =
  | 'AUTH_REQUIRED'
  | 'CASE_NOT_FOUND'
  | 'CASE_LOCKED'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export interface JuryAiServiceError {
  ok: false;
  error: {
    code: JuryAiErrorCode;
    message: string;
    retryable: boolean;
  };
  case?: CaseStateResponse;
}

/** start_case never silently resumes an existing draft. */
export interface OpenDraftExistsResult {
  ok: false;
  error: {
    code: 'OPEN_DRAFT_EXISTS';
    message: string;
    retryable: false;
  };
  case: CaseStateResponse;
}

export interface StartCaseSuccess {
  ok: true;
  case: CaseStateResponse;
}

export interface GetCaseStateSuccess {
  ok: true;
  case: CaseStateResponse;
}

export interface SubmitTurnSuccess {
  ok: true;
  replayed?: boolean;
  turn_id: string;
  case: CaseStateResponse;
  recorded: RecentInterpretationSlot[];
  superseded: string[];
}

/** Stale writes preserve the canonical recovery context for lost-response retries. */
export interface VersionConflictResult {
  ok: false;
  error: {
    code: 'VERSION_CONFLICT';
    message: string;
    retryable: false;
  };
  current_case_version: number;
  recent_turns: ConflictTurnSummary[];
  likely_already_recorded: boolean;
  case: CaseStateResponse;
}

export type StartCaseResult = StartCaseSuccess | OpenDraftExistsResult | JuryAiServiceError;
export type GetCaseStateResult = GetCaseStateSuccess | JuryAiServiceError;
export type SubmitTurnResult = SubmitTurnSuccess | VersionConflictResult | JuryAiServiceError;

export interface StartCaseCommand {
  client_request_id: string;
}

export interface GetCaseStateQuery {
  case_id?: string;
}

export interface SubmitTurnCommand {
  case_id: string;
  expected_case_version: number;
  in_reply_to: string[];
  payload: SourceTurnPayload;
  source_language?: string;
  translation_indicated?: boolean;
  client_turn_id: string;
}

export interface ServiceCallOptions {
  signal?: AbortSignal;
}

/**
 * Browser/session authorization belongs behind this port. WebMCP inputs never
 * carry API keys, bearer tokens, user IDs, or other authentication material.
 */
export interface CaseServicePort {
  startCase(command: StartCaseCommand, options?: ServiceCallOptions): Promise<StartCaseResult>;
  getCaseState(query: GetCaseStateQuery, options?: ServiceCallOptions): Promise<GetCaseStateResult>;
  submitTurn(command: SubmitTurnCommand, options?: ServiceCallOptions): Promise<SubmitTurnResult>;
}
