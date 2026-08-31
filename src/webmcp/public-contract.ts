/**
 * Browser-safe JuryAI P2 transport contract.
 *
 * This module is the single owner of values and DTOs that cross the browser
 * boundary. It deliberately has no imports so a Vite build cannot reach Node
 * built-ins, persistence, compiler code, or server credentials through it.
 */

export const WEBMCP_CORE_SCHEMA_VERSION = 'juryai-webmcp-core-v0.2.0';
export const WEBMCP_PROTOCOL_VERSION = 'juryai-webmcp-protocol-v0.2.0';

export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;
export const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export const MAX_CONTEXT_MESSAGES = 6;
export const MAX_CONTEXT_TEXT_LENGTH = 4_000;
export const MAX_ANSWER_TEXT_LENGTH = 12_000;
export const MAX_LANGUAGE_LENGTH = 64;
export const MAX_CLIENT_OPERATION_ID_LENGTH = 200;

export type CaseStatus = 'draft' | 'locked';

export type PropositionType =
  | 'target_date'
  | 'contractual_deadline'
  | 'invoice'
  | 'payment'
  | 'requested_scope'
  | 'accepted_scope'
  | 'disputed_balance'
  | 'established_debt'
  | 'requested_remedy'
  | 'established_entitlement'
  | 'recalled_document_content'
  | 'verified_document_content'
  | 'narrative_fact'
  | 'non_recollection'
  | 'declined_to_answer';

export const PROPOSITION_TYPES: readonly PropositionType[] = [
  'target_date',
  'contractual_deadline',
  'invoice',
  'payment',
  'requested_scope',
  'accepted_scope',
  'disputed_balance',
  'established_debt',
  'requested_remedy',
  'established_entitlement',
  'recalled_document_content',
  'verified_document_content',
  'narrative_fact',
  'non_recollection',
  'declined_to_answer',
];

export type EpistemicStrength =
  | 'asserted_confident'
  | 'asserted_qualified'
  | 'recalled_uncertain'
  | 'non_recollection'
  | 'disputed_by_user'
  | 'declined';

export const EPISTEMIC_STRENGTHS: readonly EpistemicStrength[] = [
  'asserted_confident',
  'asserted_qualified',
  'recalled_uncertain',
  'non_recollection',
  'disputed_by_user',
  'declined',
];

export type EvidenceInspectionStatus = 'uninspected' | 'inspected';

export interface RelayedContextMessage {
  role: 'assistant';
  text: string;
}

export interface RelayedAnswer {
  role: 'user';
  text: string;
}

export type RelayedMessage = RelayedContextMessage | RelayedAnswer;

export interface SourceTurnPayload {
  context: RelayedContextMessage[];
  answer: RelayedAnswer;
}

/** The only keys a case-state response may expose across a transport. */
export const PERMITTED_CASE_STATE_SLOTS = [
  'case_id',
  'case_version',
  'protocol_version',
  'schema_version',
  'status',
  'unresolved_requirement_count',
  'next_requirements',
  'open_clarifications',
  'recent_interpretations',
  'evidence_references',
  'warnings',
  'review_url',
] as const;

export type PermittedCaseStateSlot = (typeof PERMITTED_CASE_STATE_SLOTS)[number];

export interface NextRequirementSlot {
  requirement_id: string;
  prompt: string;
}

export interface OpenClarificationSlot {
  clarification_id: string;
  requirement_id: string;
  prompt: string;
}

export interface RecentInterpretationSlot {
  proposition_id: string;
  requirement_id: string;
  statement: string;
  type: PropositionType;
  epistemic_strength: EpistemicStrength;
  attribution: string;
}

export interface EvidenceReferenceSlot {
  evidence_ref_id: string;
  label: string;
  inspection_status: EvidenceInspectionStatus;
}

export interface CaseStateResponse {
  case_id: string;
  case_version: number;
  protocol_version: string;
  schema_version: string;
  status: CaseStatus;
  unresolved_requirement_count: number;
  next_requirements: NextRequirementSlot[];
  open_clarifications: OpenClarificationSlot[];
  recent_interpretations: RecentInterpretationSlot[];
  evidence_references: EvidenceReferenceSlot[];
  warnings: string[];
  review_url: string;
}

export interface ConflictTurnSummary {
  turn_id: string;
  in_reply_to: string[];
  answer_excerpt: string;
  request_fingerprint: string;
  client_turn_id: string | null;
  received_at: string;
}

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

export interface CaseServicePort {
  startCase(command: StartCaseCommand, options?: ServiceCallOptions): Promise<StartCaseResult>;
  getCaseState(query: GetCaseStateQuery, options?: ServiceCallOptions): Promise<GetCaseStateResult>;
  submitTurn(command: SubmitTurnCommand, options?: ServiceCallOptions): Promise<SubmitTurnResult>;
}

export type CaseServiceOperation = 'startCase' | 'getCaseState' | 'submitTurn';

export type CaseServiceHttpRequest =
  | { operation: 'startCase'; input: StartCaseCommand }
  | { operation: 'getCaseState'; input: GetCaseStateQuery }
  | { operation: 'submitTurn'; input: SubmitTurnCommand };

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonObject;
}

function exactObject(
  value: unknown,
  label: string,
  allowed: readonly string[],
  required: readonly string[],
): JsonObject {
  const decoded = object(value, label);
  if (Object.keys(decoded).some((key) => !allowed.includes(key))) {
    throw new TypeError(`${label} contains an unknown field`);
  }
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(decoded, key))) {
    throw new TypeError(`${label} is missing a required field`);
  }
  return decoded;
}

function string(value: unknown, label: string, maximum = 4_000): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function canonicalId(value: unknown, label: string): string {
  const decoded = string(value, label, 160);
  if (!ID_PATTERN.test(decoded)) throw new TypeError(`${label} must be a canonical JuryAI ID`);
  return decoded;
}

function operationId(value: unknown, label: string): string {
  const decoded = string(value, label, MAX_CLIENT_OPERATION_ID_LENGTH);
  if (decoded.trim().length === 0) throw new TypeError(`${label} must not be blank`);
  return decoded;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function stringArray(
  value: unknown,
  label: string,
  maximumItems: number,
  item: (value: unknown, label: string) => string = string,
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  return value.map((entry, index) => item(entry, `${label}[${index}]`));
}

function decodeContext(value: unknown): RelayedContextMessage[] {
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_MESSAGES) {
    throw new TypeError('payload.context must be a bounded array');
  }
  return value.map((entry, index) => {
    const message = exactObject(
      entry,
      `payload.context[${index}]`,
      ['role', 'text'],
      ['role', 'text'],
    );
    if (message.role !== 'assistant') {
      throw new TypeError(`payload.context[${index}].role must be assistant`);
    }
    return {
      role: 'assistant',
      text: string(message.text, `payload.context[${index}].text`, MAX_CONTEXT_TEXT_LENGTH),
    };
  });
}

function decodePayload(value: unknown): SourceTurnPayload {
  const payload = exactObject(value, 'payload', ['context', 'answer'], ['context', 'answer']);
  const answer = exactObject(payload.answer, 'payload.answer', ['role', 'text'], ['role', 'text']);
  if (answer.role !== 'user') throw new TypeError('payload.answer.role must be user');
  return {
    context: decodeContext(payload.context),
    answer: {
      role: 'user',
      text: string(answer.text, 'payload.answer.text', MAX_ANSWER_TEXT_LENGTH),
    },
  };
}

export function decodeStartCaseCommand(value: unknown): StartCaseCommand {
  const command = exactObject(
    value,
    'startCase input',
    ['client_request_id'],
    ['client_request_id'],
  );
  return { client_request_id: operationId(command.client_request_id, 'client_request_id') };
}

export function decodeGetCaseStateQuery(value: unknown): GetCaseStateQuery {
  const query = exactObject(value, 'getCaseState input', ['case_id'], []);
  return query.case_id === undefined ? {} : { case_id: canonicalId(query.case_id, 'case_id') };
}

export function decodeSubmitTurnCommand(value: unknown): SubmitTurnCommand {
  const command = exactObject(
    value,
    'submitTurn input',
    [
      'case_id',
      'expected_case_version',
      'in_reply_to',
      'payload',
      'source_language',
      'translation_indicated',
      'client_turn_id',
    ],
    ['case_id', 'expected_case_version', 'in_reply_to', 'payload', 'client_turn_id'],
  );
  const inReplyTo = stringArray(command.in_reply_to, 'in_reply_to', 10, canonicalId);
  if (inReplyTo.length === 0 || new Set(inReplyTo).size !== inReplyTo.length) {
    throw new TypeError('in_reply_to must contain unique requirement IDs');
  }
  if (
    command.translation_indicated !== undefined &&
    typeof command.translation_indicated !== 'boolean'
  ) {
    throw new TypeError('translation_indicated must be a boolean');
  }
  const sourceLanguage =
    command.source_language === undefined
      ? undefined
      : string(command.source_language, 'source_language', MAX_LANGUAGE_LENGTH);
  if (sourceLanguage !== undefined && sourceLanguage.length < 2) {
    throw new TypeError('source_language must have at least two characters');
  }
  return {
    case_id: canonicalId(command.case_id, 'case_id'),
    expected_case_version: nonNegativeInteger(
      command.expected_case_version,
      'expected_case_version',
    ),
    in_reply_to: inReplyTo,
    payload: decodePayload(command.payload),
    ...(sourceLanguage === undefined ? {} : { source_language: sourceLanguage }),
    ...(command.translation_indicated === undefined
      ? {}
      : { translation_indicated: command.translation_indicated }),
    client_turn_id: operationId(command.client_turn_id, 'client_turn_id'),
  };
}

export function decodeCaseServiceHttpRequest(value: unknown): CaseServiceHttpRequest {
  const request = exactObject(
    value,
    'case-service request',
    ['operation', 'input'],
    ['operation', 'input'],
  );
  switch (request.operation) {
    case 'startCase':
      return { operation: 'startCase', input: decodeStartCaseCommand(request.input) };
    case 'getCaseState':
      return { operation: 'getCaseState', input: decodeGetCaseStateQuery(request.input) };
    case 'submitTurn':
      return { operation: 'submitTurn', input: decodeSubmitTurnCommand(request.input) };
    default:
      throw new TypeError('case-service operation is not permitted');
  }
}

function decodeNextRequirement(value: unknown, index: number): NextRequirementSlot {
  const slot = exactObject(
    value,
    `next_requirements[${index}]`,
    ['requirement_id', 'prompt'],
    ['requirement_id', 'prompt'],
  );
  return {
    requirement_id: canonicalId(slot.requirement_id, 'requirement_id'),
    prompt: string(slot.prompt, 'prompt', 12_000),
  };
}

function decodeOpenClarification(value: unknown, index: number): OpenClarificationSlot {
  const slot = exactObject(
    value,
    `open_clarifications[${index}]`,
    ['clarification_id', 'requirement_id', 'prompt'],
    ['clarification_id', 'requirement_id', 'prompt'],
  );
  return {
    clarification_id: canonicalId(slot.clarification_id, 'clarification_id'),
    requirement_id: canonicalId(slot.requirement_id, 'requirement_id'),
    prompt: string(slot.prompt, 'prompt', 12_000),
  };
}

function decodeInterpretation(value: unknown, index: number): RecentInterpretationSlot {
  const slot = exactObject(
    value,
    `recent_interpretations[${index}]`,
    ['proposition_id', 'requirement_id', 'statement', 'type', 'epistemic_strength', 'attribution'],
    ['proposition_id', 'requirement_id', 'statement', 'type', 'epistemic_strength', 'attribution'],
  );
  if (!PROPOSITION_TYPES.includes(slot.type as PropositionType)) {
    throw new TypeError('interpretation type is not canonical');
  }
  if (!EPISTEMIC_STRENGTHS.includes(slot.epistemic_strength as EpistemicStrength)) {
    throw new TypeError('interpretation epistemic strength is not canonical');
  }
  return {
    proposition_id: canonicalId(slot.proposition_id, 'proposition_id'),
    requirement_id: canonicalId(slot.requirement_id, 'requirement_id'),
    statement: string(slot.statement, 'statement', 12_000),
    type: slot.type as PropositionType,
    epistemic_strength: slot.epistemic_strength as EpistemicStrength,
    attribution: string(slot.attribution, 'attribution', 4_000),
  };
}

function decodeEvidence(value: unknown, index: number): EvidenceReferenceSlot {
  const slot = exactObject(
    value,
    `evidence_references[${index}]`,
    ['evidence_ref_id', 'label', 'inspection_status'],
    ['evidence_ref_id', 'label', 'inspection_status'],
  );
  if (slot.inspection_status !== 'uninspected' && slot.inspection_status !== 'inspected') {
    throw new TypeError('evidence inspection status is not canonical');
  }
  return {
    evidence_ref_id: canonicalId(slot.evidence_ref_id, 'evidence_ref_id'),
    label: string(slot.label, 'label', 4_000),
    inspection_status: slot.inspection_status,
  };
}

function boundedArray<T>(
  value: unknown,
  label: string,
  decoder: (value: unknown, index: number) => T,
  maximumItems = 1_000,
): T[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  return value.map(decoder);
}

export function decodeCaseStateResponse(value: unknown): CaseStateResponse {
  const state = exactObject(value, 'case', PERMITTED_CASE_STATE_SLOTS, PERMITTED_CASE_STATE_SLOTS);
  if (state.protocol_version !== WEBMCP_PROTOCOL_VERSION) {
    throw new TypeError('case protocol_version is not supported');
  }
  if (state.schema_version !== WEBMCP_CORE_SCHEMA_VERSION) {
    throw new TypeError('case schema_version is not supported');
  }
  if (state.status !== 'draft' && state.status !== 'locked') {
    throw new TypeError('case status is not canonical');
  }
  return {
    case_id: canonicalId(state.case_id, 'case_id'),
    case_version: nonNegativeInteger(state.case_version, 'case_version'),
    protocol_version: state.protocol_version,
    schema_version: state.schema_version,
    status: state.status,
    unresolved_requirement_count: nonNegativeInteger(
      state.unresolved_requirement_count,
      'unresolved_requirement_count',
    ),
    next_requirements: boundedArray(
      state.next_requirements,
      'next_requirements',
      decodeNextRequirement,
    ),
    open_clarifications: boundedArray(
      state.open_clarifications,
      'open_clarifications',
      decodeOpenClarification,
    ),
    recent_interpretations: boundedArray(
      state.recent_interpretations,
      'recent_interpretations',
      decodeInterpretation,
    ),
    evidence_references: boundedArray(
      state.evidence_references,
      'evidence_references',
      decodeEvidence,
    ),
    warnings: stringArray(state.warnings, 'warnings', 100, (entry, label) =>
      string(entry, label, 4_000),
    ),
    review_url: string(state.review_url, 'review_url', 2_048),
  };
}

function decodeError(value: unknown): JuryAiServiceError['error'] {
  const error = exactObject(
    value,
    'service error',
    ['code', 'message', 'retryable'],
    ['code', 'message', 'retryable'],
  );
  const codes: readonly JuryAiErrorCode[] = [
    'AUTH_REQUIRED',
    'CASE_NOT_FOUND',
    'CASE_LOCKED',
    'INVALID_INPUT',
    'CONFLICT',
    'INTERNAL_ERROR',
  ];
  if (!codes.includes(error.code as JuryAiErrorCode) || typeof error.retryable !== 'boolean') {
    throw new TypeError('service error is malformed');
  }
  return {
    code: error.code as JuryAiErrorCode,
    message: string(error.message, 'error.message', 1_000),
    retryable: error.retryable,
  };
}

function decodeGenericFailure(value: JsonObject): JuryAiServiceError {
  const decoded = exactObject(value, 'service failure', ['ok', 'error', 'case'], ['ok', 'error']);
  if (decoded.ok !== false) throw new TypeError('service failure ok must be false');
  return {
    ok: false,
    error: decodeError(decoded.error),
    ...(decoded.case === undefined ? {} : { case: decodeCaseStateResponse(decoded.case) }),
  };
}

function decodeStartCaseResult(value: unknown): StartCaseResult {
  const result = object(value, 'startCase result');
  if (result.ok === true) {
    const success = exactObject(result, 'startCase result', ['ok', 'case'], ['ok', 'case']);
    return { ok: true, case: decodeCaseStateResponse(success.case) };
  }
  const error = object(result.error, 'startCase error');
  if (error.code === 'OPEN_DRAFT_EXISTS') {
    const failure = exactObject(
      result,
      'startCase result',
      ['ok', 'error', 'case'],
      ['ok', 'error', 'case'],
    );
    if (failure.ok !== false) throw new TypeError('OPEN_DRAFT_EXISTS ok must be false');
    const openDraftError = exactObject(
      failure.error,
      'startCase error',
      ['code', 'message', 'retryable'],
      ['code', 'message', 'retryable'],
    );
    if (openDraftError.code !== 'OPEN_DRAFT_EXISTS' || openDraftError.retryable !== false)
      throw new TypeError('OPEN_DRAFT_EXISTS is not retryable');
    return {
      ok: false,
      error: {
        code: 'OPEN_DRAFT_EXISTS',
        message: string(openDraftError.message, 'error.message', 1_000),
        retryable: false,
      },
      case: decodeCaseStateResponse(failure.case),
    };
  }
  return decodeGenericFailure(result);
}

function decodeGetCaseStateResult(value: unknown): GetCaseStateResult {
  const result = object(value, 'getCaseState result');
  if (result.ok === true) {
    const success = exactObject(result, 'getCaseState result', ['ok', 'case'], ['ok', 'case']);
    return { ok: true, case: decodeCaseStateResponse(success.case) };
  }
  return decodeGenericFailure(result);
}

function decodeConflictTurn(value: unknown, index: number): ConflictTurnSummary {
  const turn = exactObject(
    value,
    `recent_turns[${index}]`,
    [
      'turn_id',
      'in_reply_to',
      'answer_excerpt',
      'request_fingerprint',
      'client_turn_id',
      'received_at',
    ],
    [
      'turn_id',
      'in_reply_to',
      'answer_excerpt',
      'request_fingerprint',
      'client_turn_id',
      'received_at',
    ],
  );
  const fingerprint = string(turn.request_fingerprint, 'request_fingerprint', 64);
  if (!HASH_PATTERN.test(fingerprint)) throw new TypeError('request_fingerprint must be SHA-256');
  if (turn.client_turn_id !== null && typeof turn.client_turn_id !== 'string') {
    throw new TypeError('client_turn_id must be a string or null');
  }
  const receivedAt = string(turn.received_at, 'received_at', 64);
  if (Number.isNaN(Date.parse(receivedAt))) throw new TypeError('received_at must be an ISO date');
  return {
    turn_id: canonicalId(turn.turn_id, 'turn_id'),
    in_reply_to: stringArray(turn.in_reply_to, 'in_reply_to', 10, canonicalId),
    answer_excerpt: string(turn.answer_excerpt, 'answer_excerpt', 1_000),
    request_fingerprint: fingerprint,
    client_turn_id: turn.client_turn_id,
    received_at: receivedAt,
  };
}

function decodeSubmitTurnResult(value: unknown): SubmitTurnResult {
  const result = object(value, 'submitTurn result');
  if (result.ok === true) {
    const success = exactObject(
      result,
      'submitTurn result',
      ['ok', 'replayed', 'turn_id', 'case', 'recorded', 'superseded'],
      ['ok', 'turn_id', 'case', 'recorded', 'superseded'],
    );
    if (success.replayed !== undefined && typeof success.replayed !== 'boolean') {
      throw new TypeError('replayed must be a boolean');
    }
    return {
      ok: true,
      ...(success.replayed === undefined ? {} : { replayed: success.replayed }),
      turn_id: canonicalId(success.turn_id, 'turn_id'),
      case: decodeCaseStateResponse(success.case),
      recorded: boundedArray(success.recorded, 'recorded', decodeInterpretation),
      superseded: stringArray(success.superseded, 'superseded', 1_000, canonicalId),
    };
  }
  const error = object(result.error, 'submitTurn error');
  if (error.code === 'VERSION_CONFLICT') {
    const conflict = exactObject(
      result,
      'submitTurn result',
      ['ok', 'error', 'current_case_version', 'recent_turns', 'likely_already_recorded', 'case'],
      ['ok', 'error', 'current_case_version', 'recent_turns', 'likely_already_recorded', 'case'],
    );
    if (conflict.ok !== false) throw new TypeError('VERSION_CONFLICT ok must be false');
    const conflictError = exactObject(
      conflict.error,
      'submitTurn error',
      ['code', 'message', 'retryable'],
      ['code', 'message', 'retryable'],
    );
    if (
      conflictError.code !== 'VERSION_CONFLICT' ||
      conflictError.retryable !== false ||
      typeof conflict.likely_already_recorded !== 'boolean'
    ) {
      throw new TypeError('VERSION_CONFLICT is malformed');
    }
    return {
      ok: false,
      error: {
        code: 'VERSION_CONFLICT',
        message: string(conflictError.message, 'error.message', 1_000),
        retryable: false,
      },
      current_case_version: nonNegativeInteger(
        conflict.current_case_version,
        'current_case_version',
      ),
      recent_turns: boundedArray(conflict.recent_turns, 'recent_turns', decodeConflictTurn, 100),
      likely_already_recorded: conflict.likely_already_recorded,
      case: decodeCaseStateResponse(conflict.case),
    };
  }
  return decodeGenericFailure(result);
}

export function decodeCaseServiceResult(operation: 'startCase', value: unknown): StartCaseResult;
export function decodeCaseServiceResult(
  operation: 'getCaseState',
  value: unknown,
): GetCaseStateResult;
export function decodeCaseServiceResult(operation: 'submitTurn', value: unknown): SubmitTurnResult;
export function decodeCaseServiceResult(
  operation: CaseServiceOperation,
  value: unknown,
): StartCaseResult | GetCaseStateResult | SubmitTurnResult {
  switch (operation) {
    case 'startCase':
      return decodeStartCaseResult(value);
    case 'getCaseState':
      return decodeGetCaseStateResult(value);
    case 'submitTurn':
      return decodeSubmitTurnResult(value);
  }
}
