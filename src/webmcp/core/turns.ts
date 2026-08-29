/**
 * Source-turn schema, text normalisation and the span-addressing contract.
 *
 * Two normalisations exist and must never be confused:
 *  - `normalizeForStorage` produces the text that is STORED and that all spans
 *    index into. Deterministic, applied once, on receipt.
 *  - `normalizeForFingerprint` (see idempotency.ts) is strictly more
 *    aggressive and exists only for near-duplicate replay detection.
 *
 * Span addressing is defined over the STORED text so that substring equality
 * is a mechanically decidable property. This proves "this quotation exists
 * exactly in the material JuryAI received". It does NOT prove the material
 * came from the human's keyboard; that claim is not available at this
 * boundary and is never made.
 */

import {
  canonicalSerialize,
  isCanonicalId,
  issue,
  sha256,
  type ContractIssue,
  type SourceChannel,
} from './types.js';

export const TURN_SCHEMA_VERSION = 'juryai-webmcp-source-turn-v0.2.0';

/* ------------------------------------------------------------------------ */
/* Normalisation                                                             */
/* ------------------------------------------------------------------------ */

const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'gu');
const WHITESPACE_RUN = /\s+/gu;

/**
 * Canonical storage form: NFC, control characters removed, whitespace runs
 * collapsed to a single space, ends trimmed. Applied once on receipt; every
 * span offset in the system indexes the result of this function.
 */
export function normalizeForStorage(text: string): string {
  return text.normalize('NFC').replace(CONTROL_CHARS, '').replace(WHITESPACE_RUN, ' ').trim();
}

/* ------------------------------------------------------------------------ */
/* Relayed payload: explicit context + answer                                */
/* ------------------------------------------------------------------------ */

export interface RelayedContextMessage {
  role: 'assistant';
  text: string;
}

export interface RelayedAnswer {
  role: 'user';
  text: string;
}

export type RelayedMessage = RelayedContextMessage | RelayedAnswer;

/**
 * The answer is a named slot, never "the last user message in an array".
 * Nothing downstream is permitted to infer which utterance is the answer.
 */
export interface SourceTurnPayload {
  context: RelayedContextMessage[];
  answer: RelayedAnswer;
}

export const MAX_CONTEXT_MESSAGES = 6;

export function normalizePayload(payload: SourceTurnPayload): SourceTurnPayload {
  return {
    context: payload.context.map((message) => ({
      role: message.role,
      text: normalizeForStorage(message.text),
    })),
    answer: { role: payload.answer.role, text: normalizeForStorage(payload.answer.text) },
  };
}

export function validatePayloadShape(payload: SourceTurnPayload, path: string): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!Array.isArray(payload.context)) {
    issues.push(issue('turn_context_not_array', path + '.context', 'context must be an array.'));
  } else if (payload.context.length > MAX_CONTEXT_MESSAGES) {
    issues.push(
      issue(
        'turn_context_too_long',
        path + '.context',
        'context is bounded to ' +
          String(MAX_CONTEXT_MESSAGES) +
          ' messages; received ' +
          String(payload.context.length) +
          '.',
      ),
    );
  }
  if (Array.isArray(payload.context)) {
    for (const [index, message] of payload.context.entries()) {
      if (message.role !== 'assistant') {
        issues.push(
          issue(
            'turn_context_not_assistant',
            path + '.context[' + String(index) + '].role',
            "context messages must have role 'assistant'.",
          ),
        );
      }
    }
  }
  if (payload.answer.role !== 'user') {
    issues.push(
      issue('turn_answer_not_user', path + '.answer.role', "answer.role must be 'user'."),
    );
  }
  if (normalizeForStorage(payload.answer.text).length === 0) {
    issues.push(
      issue('turn_answer_empty', path + '.answer.text', 'answer.text must be non-empty.'),
    );
  }
  return issues;
}

/* ------------------------------------------------------------------------ */
/* Span addressing                                                           */
/* ------------------------------------------------------------------------ */

export type SpanRegion = 'answer' | 'context';

export interface TurnSpan {
  turn_id: string;
  region: SpanRegion;
  /** Required for region 'context'; must be null for region 'answer'. */
  message_index: number | null;
  encoding: 'utf16';
  start: number;
  end: number;
  quote: string;
}

export function resolveSpanText(payload: SourceTurnPayload, span: TurnSpan): string | null {
  if (span.region === 'answer') {
    return span.message_index === null ? payload.answer.text : null;
  }
  if (span.message_index === null) return null;
  const message = payload.context[span.message_index];
  return message ? message.text : null;
}

export interface SpanVerification {
  ok: boolean;
  issues: ContractIssue[];
}

/**
 * Mechanically verifies a quotation by UTF-16 substring equality against the
 * stored payload. This is the whole of what "span fidelity" claims.
 */
export function verifyTurnSpan(
  payload: SourceTurnPayload,
  span: TurnSpan,
  path: string,
): SpanVerification {
  const issues: ContractIssue[] = [];
  if (span.encoding !== 'utf16') {
    issues.push(
      issue('span_encoding_unsupported', path + '.encoding', "encoding must be 'utf16'."),
    );
  }
  if (span.region === 'answer' && span.message_index !== null) {
    issues.push(
      issue(
        'span_message_index_forbidden',
        path + '.message_index',
        "message_index must be null for region 'answer'.",
      ),
    );
  }
  if (span.region === 'context' && span.message_index === null) {
    issues.push(
      issue(
        'span_message_index_required',
        path + '.message_index',
        "message_index is required for region 'context'.",
      ),
    );
  }
  const text = resolveSpanText(payload, span);
  if (text === null) {
    issues.push(
      issue('span_region_unresolved', path, 'Span does not resolve to a stored message.'),
    );
    return { ok: false, issues };
  }
  if (
    !Number.isInteger(span.start) ||
    !Number.isInteger(span.end) ||
    span.start < 0 ||
    span.end < span.start ||
    span.end > text.length
  ) {
    issues.push(
      issue(
        'span_offsets_out_of_range',
        path,
        'Span [' +
          String(span.start) +
          ', ' +
          String(span.end) +
          ') is out of range for a ' +
          String(text.length) +
          '-unit message.',
      ),
    );
    return { ok: false, issues };
  }
  if (text.slice(span.start, span.end) !== span.quote) {
    issues.push(
      issue(
        'span_quote_mismatch',
        path + '.quote',
        'Quoted text is not an exact substring of the stored source at the given offsets.',
      ),
    );
  }
  return { ok: issues.length === 0, issues };
}

/** Builds a verified span, or throws. Server-side trusted construction only. */
export function createSpan(
  turnId: string,
  payload: SourceTurnPayload,
  region: SpanRegion,
  messageIndex: number | null,
  start: number,
  end: number,
): TurnSpan {
  const contextText = messageIndex === null ? undefined : payload.context[messageIndex]?.text;
  const text = region === 'answer' ? payload.answer.text : (contextText ?? null);
  if (text === null || text === undefined) {
    throw new TypeError('Span region does not resolve to a stored message.');
  }
  const span: TurnSpan = {
    turn_id: turnId,
    region,
    message_index: region === 'answer' ? null : messageIndex,
    encoding: 'utf16',
    start,
    end,
    quote: text.slice(start, end),
  };
  const verification = verifyTurnSpan(payload, span, 'span');
  if (!verification.ok) throw new TypeError(verification.issues[0]?.message ?? 'Invalid span.');
  return span;
}

/* ------------------------------------------------------------------------ */
/* Payload commitment (erasure-safe hashing)                                 */
/* ------------------------------------------------------------------------ */

/**
 * Attestations bind a salted commitment over the payload rather than a hash of
 * the plaintext. Erasing the plaintext (key deletion / redaction) then destroys
 * readability without destroying the attestation's verifiability.
 */
export function computePayloadCommitment(payload: SourceTurnPayload, salt: string): string {
  return sha256(salt + ':' + canonicalSerialize(payload));
}

export function verifyPayloadCommitment(
  payload: SourceTurnPayload,
  salt: string,
  commitment: string,
): boolean {
  return computePayloadCommitment(payload, salt) === commitment;
}

/* ------------------------------------------------------------------------ */
/* Source turn record + append-only log                                      */
/* ------------------------------------------------------------------------ */

export interface SourceTurnRecord {
  turn_id: string;
  case_id: string;
  case_version_before: number;
  /** Server clock. Never accepted from the relay. */
  received_at: string;
  principal_id: string;
  source_channel: SourceChannel;
  /** Self-reported by the relay. Recorded, never trusted. */
  relaying_agent: string | null;
  /** Self-reported language of the answer as relayed. */
  source_language: string | null;
  /** True when the relay indicated the answer was translated. */
  translation_indicated: boolean;
  in_reply_to: string[];
  /** Adapter-minted idempotency key. Never generated by the model. */
  client_turn_id: string | null;
  request_fingerprint: string;
  payload: SourceTurnPayload;
  payload_commitment_salt: string;
  payload_commitment: string;
  compile_run_id: string | null;
}

/**
 * Explicit immutable source-time metadata bound separately from the erasable
 * payload. Processing linkage and payload storage material are intentionally
 * outside this projection.
 */
export function sourceTurnMetadataProjection(turn: SourceTurnRecord) {
  return {
    turn_id: turn.turn_id,
    case_id: turn.case_id,
    case_version_before: turn.case_version_before,
    received_at: turn.received_at,
    principal_id: turn.principal_id,
    source_channel: turn.source_channel,
    relaying_agent: turn.relaying_agent,
    source_language: turn.source_language,
    translation_indicated: turn.translation_indicated,
    in_reply_to: turn.in_reply_to,
    client_turn_id: turn.client_turn_id,
    request_fingerprint: turn.request_fingerprint,
  };
}

export function computeSourceTurnMetadataCommitment(turn: SourceTurnRecord): string {
  return sha256(canonicalSerialize(sourceTurnMetadataProjection(turn)));
}

export type SourceTurnLog = readonly SourceTurnRecord[];

export function appendTurn(log: SourceTurnLog, record: SourceTurnRecord): SourceTurnRecord[] {
  if (log.some((entry) => entry.turn_id === record.turn_id)) {
    throw new TypeError(
      "Turn log is append-only; turn_id '" + record.turn_id + "' already exists.",
    );
  }
  if (
    record.client_turn_id !== null &&
    log.some((entry) => entry.client_turn_id === record.client_turn_id)
  ) {
    throw new TypeError(
      "client_turn_id '" + record.client_turn_id + "' is already recorded for this case.",
    );
  }
  return [...log, record];
}

/**
 * A translated answer has no span fidelity to anything the human actually
 * said, so it is recorded at a reduced provenance standing. This is a
 * statement about what we can prove, not a judgement about the user.
 */
export function turnCarriesSpanFidelity(record: SourceTurnRecord): boolean {
  return !record.translation_indicated;
}

export function validateSourceTurnRecord(record: SourceTurnRecord, path: string): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!isCanonicalId(record.turn_id)) {
    issues.push(issue('turn_id_invalid', path + '.turn_id', 'turn_id is not a canonical id.'));
  }
  if (!Number.isInteger(record.case_version_before) || record.case_version_before < 0) {
    issues.push(
      issue(
        'turn_case_version_invalid',
        path + '.case_version_before',
        'case_version_before must be a non-negative integer.',
      ),
    );
  }
  if (Number.isNaN(Date.parse(record.received_at))) {
    issues.push(
      issue('turn_received_at_invalid', path + '.received_at', 'received_at must be an ISO date.'),
    );
  }
  if (record.in_reply_to.length === 0) {
    issues.push(
      issue('turn_in_reply_to_empty', path + '.in_reply_to', 'in_reply_to must not be empty.'),
    );
  }
  const sorted = [...record.in_reply_to].sort();
  if (canonicalSerialize(record.in_reply_to) !== canonicalSerialize(sorted)) {
    issues.push(
      issue(
        'turn_in_reply_to_unsorted',
        path + '.in_reply_to',
        'in_reply_to must be stored in sorted order.',
      ),
    );
  }
  if (new Set(record.in_reply_to).size !== record.in_reply_to.length) {
    issues.push(
      issue(
        'turn_in_reply_to_duplicated',
        path + '.in_reply_to',
        'in_reply_to must not contain duplicates.',
      ),
    );
  }
  issues.push(...validatePayloadShape(record.payload, path + '.payload'));
  if (canonicalSerialize(record.payload) !== canonicalSerialize(normalizePayload(record.payload))) {
    issues.push(
      issue(
        'turn_payload_not_normalized',
        path + '.payload',
        'Stored payload must already be in canonical storage normalisation.',
      ),
    );
  }
  if (
    !verifyPayloadCommitment(
      record.payload,
      record.payload_commitment_salt,
      record.payload_commitment,
    )
  ) {
    issues.push(
      issue(
        'turn_commitment_mismatch',
        path + '.payload_commitment',
        'payload_commitment does not match the stored payload and salt.',
      ),
    );
  }
  return issues;
}
