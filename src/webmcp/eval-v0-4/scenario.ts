/**
 * Builds the deterministic `CompilerInput` one V0.4 eval case is graded on.
 *
 * BOUNDED ON PURPOSE. This produces a compiler input and nothing else. It does
 * not push output through a runtime, and it does not reimplement the
 * application mapping from compiler effects to relay effects — the historical
 * runner does that through the V0.2-era `CaseState` boundary, which would be
 * false evidence if relabelled as V0.4 end-to-end.
 *
 * The future application mapping (wide requirement_context -> compiler V0.4 ->
 * relay effects -> shared domain -> persistence) belongs to 8C2. 8C1a already
 * proved the shared future DOMAIN semantics with deterministic A/B tests, and
 * this proves the COMPILER-OUTPUT oracle. Inventing a second production-like
 * mapper here to make the eval look more end-to-end would manufacture exactly
 * the confidence nobody should have.
 *
 * Every value is fixed: ids, timestamps, salts. The same case always produces
 * a byte-identical input, so a graded difference is a difference in the model's
 * output and never in the harness.
 */

import { computeRequestFingerprint } from '../core/idempotency.js';
import {
  computePayloadCommitment,
  normalizePayload,
  type SourceTurnPayload,
  type SourceTurnRecord,
} from '../core/turns.js';
import { buildCompilerInput, type CompilerInput } from '../core-v0-3/compiler-contract.js';
import type { RequirementDefinition } from '../core-v0-3/requirements.js';
import type { Proposition } from '../core-v0-3/propositions.js';
import { sha256 } from '../../v2/case-envelope.js';
import type { SemanticEvalCaseV04 } from './types.js';

const CASE_ID = 'case_eval_v04';
const PRINCIPAL = 'subject_eval_v04';
const RECEIVED_AT = '2026-09-05T00:00:00.000Z';
const SALT = 'eval-v04-salt-0123456789abcdef';

/** Deterministic per-case ids, so two cases never share a run identity. */
export const compileRunId = (caseId: string): string => `run_${caseId}`;
export const turnId = (caseId: string): string => `turn_${caseId}`;
export const compilerVersionId = (caseId: string): string => sha256(`eval-v04-compiler:${caseId}`);

const NON_ANSWER: RequirementDefinition['satisfying_types'] = [
  'non_recollection',
  'declined_to_answer',
];

function requirementDefinition(
  entry: SemanticEvalCaseV04['requirement_context'][number],
): RequirementDefinition {
  return {
    requirement_id: entry.requirement_id,
    prompt: entry.prompt ?? `Answer ${entry.requirement_id}.`,
    satisfying_types: [...(entry.satisfying_types ?? ['narrative_fact']), ...NON_ANSWER],
    min_propositions: 1,
    max_propositions: entry.max_propositions ?? null,
    adverse_fact_probe: false,
    reopened_from: null,
  };
}

function existingProposition(
  entry: NonNullable<SemanticEvalCaseV04['existing_propositions']>[number],
): Proposition {
  return {
    proposition_id: entry.proposition_id,
    in_reply_to: entry.requirement_id,
    type: entry.type,
    epistemic_strength: entry.epistemic_strength,
    statement: entry.statement,
    spans: [],
    supersedes: null,
    superseded_by: null,
  } as unknown as Proposition;
}

export function buildEvalInputV04(evalCase: SemanticEvalCaseV04): CompilerInput {
  /**
   * NORMALISED, exactly as production stores it.
   *
   * The relay normalises an intent payload before committing it, and every span
   * offset addresses that stored form. Building the eval turn from raw fixture
   * strings would show the model — and the span verifier — text production
   * would never compile, so any corpus case with repeated whitespace, tabs or
   * non-NFC characters would grade against a document that cannot exist.
   */
  const payload: SourceTurnPayload = normalizePayload({
    context: (evalCase.context ?? []).map((text) => ({ role: 'assistant', text })),
    answer: { role: 'user', text: evalCase.answer },
  });
  const inReplyTo = [...new Set(evalCase.in_reply_to)].sort();
  const turn: SourceTurnRecord = {
    turn_id: turnId(evalCase.id),
    case_id: CASE_ID,
    case_version_before: 0,
    received_at: RECEIVED_AT,
    principal_id: PRINCIPAL,
    source_channel: 'webmcp_agent_relay',
    relaying_agent: 'eval-v04',
    source_language: 'en',
    translation_indicated: false,
    // What the interviewer ASKED. Deliberately narrower than the requirement
    // context: pacing controls what is asked, not what the compiler may hear.
    in_reply_to: inReplyTo,
    client_turn_id: `client_${evalCase.id}`,
    request_fingerprint: computeRequestFingerprint({
      principal_id: PRINCIPAL,
      case_id: CASE_ID,
      in_reply_to: inReplyTo,
      payload,
    }),
    payload,
    payload_commitment_salt: SALT,
    payload_commitment: computePayloadCommitment(payload, SALT),
    compile_run_id: compileRunId(evalCase.id),
  };
  return buildCompilerInput({
    compile_run_id: compileRunId(evalCase.id),
    compiler_version_id: compilerVersionId(evalCase.id),
    state: { case_id: CASE_ID, case_version: 0 },
    turn,
    requirements: evalCase.requirement_context.map(requirementDefinition),
    livePropositions: (evalCase.existing_propositions ?? []).map(existingProposition),
  });
}
