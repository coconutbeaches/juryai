/**
 * Transport-independent runtime outcomes.
 *
 * These are deliberately NOT HTTP or WebMCP shapes. They say what happened in
 * canonical terms and carry the canonical `CaseStateResponse` the core built;
 * a transport adapter renames and serialises, and adds nothing.
 *
 * Two rules the shapes enforce structurally:
 *
 *  - A failure that leaves this module is already safe to hand to an untrusted
 *    relay. Validator issues, compiler internals and stack detail never ride on
 *    it; they go to the diagnostics sink instead, which is a server-side
 *    dependency the transport does not own.
 *  - A version conflict is never flattened to "409". It carries the current
 *    version, recent turn summaries and the server's own judgement on whether
 *    the caller's write likely already landed, because the caller's real
 *    question after a lost response is "did my last write happen?" and it
 *    cannot answer that by guessing.
 */

import { attributionFor, type Proposition } from '../core/propositions.js';
import {
  wrapAgentFacingText,
  type CaseStateResponse,
  type ContractIssue,
  type RecentInterpretationSlot,
} from '../core/types.js';
import type { ConflictTurnSummary, ReplayMatch } from '../core/idempotency.js';

export type RuntimeFailureCode =
  'AUTH_REQUIRED' | 'CASE_NOT_FOUND' | 'CASE_LOCKED' | 'INVALID_INPUT' | 'INTERNAL_ERROR';

export interface RuntimeFailure {
  code: RuntimeFailureCode;
  /** Safe to relay. Never names a validator rule, a compiler or a principal. */
  message: string;
  retryable: boolean;
}

export function failure(
  code: RuntimeFailureCode,
  message: string,
  retryable = false,
): RuntimeFailure {
  return { code, message, retryable };
}

/* ------------------------------------------------------------------------ */
/* Diagnostics: server-side only, never part of a returned outcome.          */
/* ------------------------------------------------------------------------ */

export type RuntimeDiagnosticKind =
  | 'compiler_threw'
  | 'compiler_contract_violation'
  | 'mutation_rejected'
  | 'structural_validation_failed'
  | 'source_turn_invalid'
  | 'case_creation_failed'
  | 'repository_unavailable'
  | 'replay_state_inconsistent'
  | 'commit_contention_exhausted';

export interface RuntimeDiagnosticEvent {
  kind: RuntimeDiagnosticKind;
  /** Null when the failure happened before a case was identified. */
  case_id: string | null;
  turn_id: string | null;
  compile_run_id: string | null;
  message: string;
  issues: ContractIssue[];
}

export interface RuntimeDiagnosticsSink {
  record(event: RuntimeDiagnosticEvent): void;
}

export const noopDiagnosticsSink: RuntimeDiagnosticsSink = { record: () => {} };

/** Collects events in order. For tests and local development. */
export function recordingDiagnosticsSink(): RuntimeDiagnosticsSink & {
  events: RuntimeDiagnosticEvent[];
} {
  const events: RuntimeDiagnosticEvent[] = [];
  return { events, record: (event) => void events.push(event) };
}

/* ------------------------------------------------------------------------ */
/* Outcomes                                                                  */
/* ------------------------------------------------------------------------ */

export type StartCaseOutcome =
  /**
   * `replayed` marks the second and later results of ONE logical create. A
   * retried `start_case` returns the case its own first attempt made, rather
   * than an error describing that draft as somebody else's.
   */
  | { kind: 'created'; replayed: boolean; case: CaseStateResponse }
  /** Never a silent resume. The existing draft is returned so work continues. */
  | { kind: 'open_draft_exists'; case: CaseStateResponse }
  | { kind: 'failed'; failure: RuntimeFailure };

export type GetCaseStateOutcome =
  { kind: 'ok'; case: CaseStateResponse } | { kind: 'failed'; failure: RuntimeFailure };

export interface SubmitTurnEffects {
  turn_id: string;
  case: CaseStateResponse;
  recorded: RecentInterpretationSlot[];
  accepted_proposition_ids: string[];
  superseded_proposition_ids: string[];
  opened_clarification_ids: string[];
  warnings: string[];
}

export type SubmitTurnOutcome =
  | ({ kind: 'committed' } & SubmitTurnEffects)
  /**
   * The prior logical result of a turn already recorded. No new source turn,
   * no new compile run, no new proposition, no version movement.
   */
  | ({ kind: 'replayed'; match: ReplayMatch; recorded_at_case_version: number } & SubmitTurnEffects)
  | {
      kind: 'version_conflict';
      current_case_version: number;
      recent_turns: ConflictTurnSummary[];
      likely_already_recorded: boolean;
      case: CaseStateResponse;
    }
  | { kind: 'failed'; failure: RuntimeFailure };

/**
 * Agent-facing view of one recorded proposition, built from core primitives so
 * the wording, attribution and data-block wrapping match `projectCaseState`
 * exactly rather than being a second, drifting rendering.
 */
export function interpretationSlot(proposition: Proposition): RecentInterpretationSlot {
  return {
    proposition_id: proposition.proposition_id,
    requirement_id: proposition.in_reply_to,
    statement: wrapAgentFacingText(proposition.statement),
    type: proposition.type,
    epistemic_strength: proposition.epistemic_strength,
    attribution: wrapAgentFacingText(attributionFor(proposition)),
  };
}
