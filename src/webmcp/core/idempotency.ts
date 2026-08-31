/**
 * Idempotency and concurrency for `submit_turn`.
 *
 * Layered, in the order the server must apply them:
 *
 *  1. `client_turn_id` — an adapter-minted UUID. The WebMCP execute callback
 *     is our own JavaScript running in our own origin, so it mints the id at
 *     entry and owns its retry loop; every transport-level retry reuses it.
 *     This is a true unique key and is honoured for the life of the case.
 *
 *  2. Normalised request fingerprint — catches a model-level re-invocation
 *     where the tool call was regenerated rather than re-sent, so the bytes
 *     jitter (punctuation, whitespace, context depth). Heuristic, therefore
 *     bounded by a replay window.
 *
 *  3. Optimistic case-version CAS — rejects a genuinely new write prepared
 *     against stale state. The rejection is SELF-DESCRIBING: it carries the
 *     current version and recent turn summaries so the caller compares rather
 *     than infers whether its previous write landed.
 *
 * `expected_case_version` is deliberately NOT part of the fingerprint. Adding
 * it reopens a duplicate-write hole on the most likely recovery path
 * (refresh, then retry): the retry would carry the refreshed version, miss the
 * fingerprint, pass the CAS check, and record the same statement twice.
 */

import { canonicalSerialize, issue, sha256, type ContractIssue } from './types.js';
import { normalizeForStorage, type SourceTurnPayload, type SourceTurnRecord } from './turns.js';
import type { ConflictTurnSummary } from '../public-contract.js';

export type { ConflictTurnSummary };

export const IDEMPOTENCY_CONTRACT_VERSION = 'juryai-webmcp-idempotency-v0.2.0';

/** Default replay window for the heuristic fingerprint match. */
export const DEFAULT_FINGERPRINT_REPLAY_WINDOW_MS = 60 * 60 * 1000;

/** Maximum characters of a user answer echoed back in a conflict response. */
export const CONFLICT_EXCERPT_LENGTH = 200;

const PUNCTUATION = new RegExp(
  '[\\u0021-\\u002F\\u003A-\\u0040\\u005B-\\u0060\\u007B-\\u007E\\u2018\\u2019\\u201C\\u201D\\u2013\\u2014\\u2026]',
  'gu',
);

/**
 * Strictly more aggressive than storage normalisation, and used ONLY for
 * near-duplicate replay detection. Never for storage, never for spans.
 */
export function normalizeForFingerprint(text: string): string {
  return normalizeForStorage(text)
    .toLowerCase()
    .replace(PUNCTUATION, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export interface FingerprintInput {
  principal_id: string;
  case_id: string;
  in_reply_to: readonly string[];
  payload: SourceTurnPayload;
}

/**
 * Fingerprint over identity, case, requirement set and the aggressively
 * normalised answer. Context messages are excluded: a regenerated tool call
 * frequently carries a different number of preceding turns while answering the
 * same question with the same words.
 */
export function computeRequestFingerprint(input: FingerprintInput): string {
  const projection = {
    principal_id: input.principal_id,
    case_id: input.case_id,
    in_reply_to: [...input.in_reply_to].sort(),
    answer: normalizeForFingerprint(input.payload.answer.text),
  };
  return sha256(canonicalSerialize(projection));
}

/* ------------------------------------------------------------------------ */
/* Replay store                                                              */
/* ------------------------------------------------------------------------ */

export interface StoredSubmitResponse {
  case_version: number;
  turn_id: string;
  accepted_proposition_ids: string[];
  superseded_proposition_ids: string[];
  opened_clarification_ids: string[];
  warnings: string[];
}

export interface IdempotencyRecord {
  case_id: string;
  request_fingerprint: string;
  client_turn_id: string | null;
  turn_id: string;
  recorded_at_ms: number;
  response: StoredSubmitResponse;
}

/**
 * The map is retained for the whole case lifetime because it is audit data.
 * Replay SEMANTICS are what the window bounds, not retention.
 */
export type IdempotencyStore = readonly IdempotencyRecord[];

export function recordIdempotency(
  store: IdempotencyStore,
  record: IdempotencyRecord,
): IdempotencyRecord[] {
  if (
    record.client_turn_id !== null &&
    store.some(
      (entry) => entry.case_id === record.case_id && entry.client_turn_id === record.client_turn_id,
    )
  ) {
    throw new TypeError(
      "client_turn_id '" + record.client_turn_id + "' already has a recorded response.",
    );
  }
  if (store.some((entry) => entry.turn_id === record.turn_id)) {
    throw new TypeError("turn_id '" + record.turn_id + "' already has a recorded response.");
  }
  return [...store, record];
}

export type ReplayMatch = 'client_turn_id' | 'fingerprint';

export type IdempotencyOutcome =
  { kind: 'replay'; match: ReplayMatch; record: IdempotencyRecord } | { kind: 'fresh' };

export interface IdempotencyLookup {
  case_id: string;
  client_turn_id: string | null;
  request_fingerprint: string;
}

export function resolveIdempotency(
  store: IdempotencyStore,
  lookup: IdempotencyLookup,
  nowMs: number,
  windowMs: number = DEFAULT_FINGERPRINT_REPLAY_WINDOW_MS,
): IdempotencyOutcome {
  if (lookup.client_turn_id !== null) {
    const exact = store.find(
      (entry) => entry.case_id === lookup.case_id && entry.client_turn_id === lookup.client_turn_id,
    );
    // A true unique key: same id means the same operation, without a window.
    if (exact) return { kind: 'replay', match: 'client_turn_id', record: exact };
  }
  const candidates = store.filter(
    (entry) =>
      entry.case_id === lookup.case_id &&
      entry.request_fingerprint === lookup.request_fingerprint &&
      nowMs - entry.recorded_at_ms <= windowMs,
  );
  const latest = candidates[candidates.length - 1];
  if (latest) return { kind: 'replay', match: 'fingerprint', record: latest };
  return { kind: 'fresh' };
}

/* ------------------------------------------------------------------------ */
/* Self-describing version conflict                                          */
/* ------------------------------------------------------------------------ */

export function summarizeTurnForConflict(record: SourceTurnRecord): ConflictTurnSummary {
  const text = record.payload.answer.text;
  const excerpt =
    text.length > CONFLICT_EXCERPT_LENGTH ? text.slice(0, CONFLICT_EXCERPT_LENGTH) + '...' : text;
  return {
    turn_id: record.turn_id,
    in_reply_to: [...record.in_reply_to],
    answer_excerpt: excerpt,
    request_fingerprint: record.request_fingerprint,
    client_turn_id: record.client_turn_id,
    received_at: record.received_at,
  };
}

export interface SubmitRequest {
  case_id: string;
  principal_id: string;
  expected_case_version: number;
  in_reply_to: readonly string[];
  payload: SourceTurnPayload;
  client_turn_id: string | null;
}

export type SubmitPrecheck =
  | { kind: 'replay'; match: ReplayMatch; record: IdempotencyRecord }
  | {
      kind: 'version_conflict';
      current_case_version: number;
      /**
       * Recent turns by the same principal on this case, so the caller can
       * compare its own payload rather than infer whether its write landed.
       */
      recent_turns: ConflictTurnSummary[];
      /**
       * True when a recent turn carries this request's fingerprint outside the
       * replay window. Server-computed; the caller does not have to guess.
       */
      likely_already_recorded: boolean;
    }
  | { kind: 'proceed'; request_fingerprint: string };

export interface PrecheckContext {
  store: IdempotencyStore;
  log: readonly SourceTurnRecord[];
  current_case_version: number;
  now_ms: number;
  window_ms?: number;
  recent_turn_limit?: number;
}

/**
 * Idempotency lookup happens BEFORE version validation. "Have I already done
 * this?" is logically prior to "is this valid against current state?";
 * reversing the order makes every lost-response retry fail.
 */
export function precheckSubmit(request: SubmitRequest, context: PrecheckContext): SubmitPrecheck {
  const fingerprint = computeRequestFingerprint({
    principal_id: request.principal_id,
    case_id: request.case_id,
    in_reply_to: request.in_reply_to,
    payload: request.payload,
  });

  const outcome = resolveIdempotency(
    context.store,
    {
      case_id: request.case_id,
      client_turn_id: request.client_turn_id,
      request_fingerprint: fingerprint,
    },
    context.now_ms,
    context.window_ms ?? DEFAULT_FINGERPRINT_REPLAY_WINDOW_MS,
  );
  if (outcome.kind === 'replay') {
    return { kind: 'replay', match: outcome.match, record: outcome.record };
  }

  if (request.expected_case_version !== context.current_case_version) {
    const limit = context.recent_turn_limit ?? 3;
    const mine = context.log.filter(
      (entry) => entry.case_id === request.case_id && entry.principal_id === request.principal_id,
    );
    const recent = mine.slice(Math.max(0, mine.length - limit));
    return {
      kind: 'version_conflict',
      current_case_version: context.current_case_version,
      recent_turns: recent.map(summarizeTurnForConflict),
      likely_already_recorded: mine.some((entry) => entry.request_fingerprint === fingerprint),
    };
  }

  return { kind: 'proceed', request_fingerprint: fingerprint };
}

export function validateSubmitRequest(request: SubmitRequest, path: string): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!Number.isInteger(request.expected_case_version) || request.expected_case_version < 0) {
    issues.push(
      issue(
        'submit_expected_version_invalid',
        path + '.expected_case_version',
        'expected_case_version must be a non-negative integer.',
      ),
    );
  }
  if (request.in_reply_to.length === 0) {
    issues.push(
      issue(
        'submit_in_reply_to_empty',
        path + '.in_reply_to',
        'submit_turn must answer at least one requirement.',
      ),
    );
  }
  return issues;
}
