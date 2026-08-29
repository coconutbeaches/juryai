export type CaseLifecycleStatus = 'draft' | 'locked';

export type JuryAiErrorCode =
  | 'AUTH_REQUIRED'
  | 'OPEN_DRAFT_EXISTS'
  | 'CASE_NOT_FOUND'
  | 'CASE_LOCKED'
  | 'VERSION_CONFLICT'
  | 'RESPONSE_SLOT_CONSUMED'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export interface RequirementSummary {
  id: string;
  kind: 'question' | 'clarification';
  topic?: string;
  prompt: string;
  response_slot_id: string;
}

export interface CanonicalInterpretationSummary {
  id: string;
  text: string;
}

export interface EvidenceReferenceSummary {
  id: string;
  label: string;
  inspection_status: 'uninspected' | 'uploaded' | 'extracted' | 'inspected';
}

export interface CaseStateSummary {
  case_id: string;
  case_version: number;
  protocol_version: string;
  status: CaseLifecycleStatus;
  unresolved_requirement_count: number;
  next_requirements: RequirementSummary[];
  open_clarifications: RequirementSummary[];
  recent_interpretations: CanonicalInterpretationSummary[];
  evidence: EvidenceReferenceSummary[];
  review_url: string;
}

export interface JuryAiServiceError {
  ok: false;
  error: {
    code: JuryAiErrorCode;
    message: string;
    retryable: boolean;
  };
  case?: CaseStateSummary;
}

export interface StartCaseSuccess {
  ok: true;
  case: CaseStateSummary;
}

export interface GetCaseStateSuccess {
  ok: true;
  case: CaseStateSummary;
}

export interface SubmitTurnSuccess {
  ok: true;
  replayed?: boolean;
  turn_id: string;
  case: CaseStateSummary;
  recorded: CanonicalInterpretationSummary[];
  superseded: string[];
}

export type StartCaseResult = StartCaseSuccess | JuryAiServiceError;
export type GetCaseStateResult = GetCaseStateSuccess | JuryAiServiceError;
export type SubmitTurnResult = SubmitTurnSuccess | JuryAiServiceError;

export interface RelayedContextMessage {
  role: 'assistant' | 'user';
  text: string;
}

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
  response_slot_id: string;
  context: RelayedContextMessage[];
  answer: {
    text: string;
    source_language?: string;
  };
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
