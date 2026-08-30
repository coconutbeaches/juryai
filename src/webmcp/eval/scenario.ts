/**
 * Builds the deterministic case state, source turn and `CompilerInput` for one
 * eval case.
 *
 * Everything server-owned is minted here exactly as the runtime mints it —
 * sequential ids, a stepping clock, real payload commitments, real request
 * fingerprints — so the state an eval compiles against is a state the
 * structural validator accepts. An eval that ran against a state the runtime
 * would have refused proves nothing about the runtime.
 *
 * The requirement set is the production opening set, not a bespoke one. The
 * expected-date / contractual-deadline split that half this corpus turns on is
 * a property of that set, and a corpus that invented its own requirements
 * could quietly grade against a distinction the product does not make.
 */

import {
  buildCompilerInput,
  type CompilerInput,
  type CompilerRegistryEntry,
} from '../core/compiler-contract.js';
import type { CaseState } from '../core/attestation.js';
import { computeRequestFingerprint } from '../core/idempotency.js';
import { livePropositions, type Proposition } from '../core/propositions.js';
import {
  computePayloadCommitment,
  createSpan,
  normalizePayload,
  type SourceTurnPayload,
  type SourceTurnRecord,
} from '../core/turns.js';
import { initialRequirementSet } from '../runtime/initial-requirements.js';
import { isoFrom, sequentialIdFactory, steppingClock } from '../runtime/ids.js';
import type { SemanticEvalCase } from './types.js';

const EVAL_PRINCIPAL = 'user_eval';
const EVAL_RELAYING_AGENT = 'juryai-eval-relay';
const EVAL_SOURCE_CHANNEL = 'webmcp_agent_relay' as const;
const EVAL_DISCLOSURE = 'juryai-disclosure-v0.2.0';
const EVAL_START_MS = Date.parse('2026-01-02T00:00:00.000Z');

export interface EvalScenario {
  case_id: string;
  /** State BEFORE the graded turn, already carrying any seeded propositions. */
  state: CaseState;
  /** The immutable turn under evaluation. */
  turn: SourceTurnRecord;
  input: CompilerInput;
  /** Case version the graded turn's propositions would be stamped with. */
  next_case_version: number;
}

function payloadOf(answer: string, context: readonly string[]): SourceTurnPayload {
  return normalizePayload({
    context: context.map((textValue) => ({ role: 'assistant' as const, text: textValue })),
    answer: { role: 'user', text: answer },
  });
}

export function buildEvalScenario(
  evalCase: SemanticEvalCase,
  compiler: CompilerRegistryEntry,
): EvalScenario {
  const ids = sequentialIdFactory(evalCase.id + '.');
  const clock = steppingClock(EVAL_START_MS, 1000);
  const caseId = ids.caseId();
  const requirements = initialRequirementSet();

  const turnLog: SourceTurnRecord[] = [];
  const propositions: Proposition[] = [];
  let caseVersion = 0;

  const makeTurn = (
    answer: string,
    context: readonly string[],
    inReplyTo: readonly string[],
    translationIndicated: boolean,
    sourceLanguage: string | null,
    compileRunId: string,
  ): SourceTurnRecord => {
    const payload = payloadOf(answer, context);
    const salt = 'eval_salt_' + String(turnLog.length + 1);
    const sorted = [...inReplyTo].sort();
    return {
      turn_id: ids.turnId(),
      case_id: caseId,
      case_version_before: caseVersion,
      received_at: isoFrom(clock.now()),
      principal_id: EVAL_PRINCIPAL,
      source_channel: EVAL_SOURCE_CHANNEL,
      relaying_agent: EVAL_RELAYING_AGENT,
      source_language: sourceLanguage,
      translation_indicated: translationIndicated,
      in_reply_to: sorted,
      client_turn_id: null,
      request_fingerprint: computeRequestFingerprint({
        principal_id: EVAL_PRINCIPAL,
        case_id: caseId,
        in_reply_to: sorted,
        payload,
      }),
      payload,
      payload_commitment_salt: salt,
      payload_commitment: computePayloadCommitment(payload, salt),
      compile_run_id: compileRunId,
    };
  };

  /* --- seeded history --------------------------------------------------- */
  if (evalCase.seed) {
    const seedRunId = ids.compileRunId();
    const seedTurn = makeTurn(
      evalCase.seed.answer,
      [],
      evalCase.seed.in_reply_to,
      false,
      null,
      seedRunId,
    );
    turnLog.push(seedTurn);
    caseVersion += 1;
    for (const seed of evalCase.seed.propositions) {
      const answerText = seedTurn.payload.answer.text;
      const start = answerText.indexOf(seed.quote);
      if (start < 0) {
        throw new TypeError(
          "Eval seed quote '" + seed.quote + "' does not occur in the seed turn answer.",
        );
      }
      propositions.push({
        proposition_id: seed.proposition_id,
        case_id: caseId,
        type: seed.type,
        epistemic_strength: seed.epistemic_strength,
        statement: seed.statement,
        in_reply_to: seed.requirement_id,
        derived_from_turn_ids: [seedTurn.turn_id],
        spans: [
          createSpan(
            seedTurn.turn_id,
            seedTurn.payload,
            'answer',
            null,
            start,
            start + seed.quote.length,
          ),
        ],
        source_channel: seedTurn.source_channel,
        relaying_agent: seedTurn.relaying_agent,
        supersedes: null,
        superseded_by: null,
        superseded_at_case_version: null,
        created_at_case_version: caseVersion,
        compile_run_id: seedRunId,
        compiler_version_id: compiler.compiler_version_id,
        evidence_ref_id: null,
      });
    }
  }

  /* --- the graded turn --------------------------------------------------- */
  const compileRunId = ids.compileRunId();
  const turn = makeTurn(
    evalCase.answer,
    evalCase.context ?? [],
    evalCase.in_reply_to,
    evalCase.translation_indicated ?? false,
    evalCase.source_language ?? null,
    compileRunId,
  );

  const state: CaseState = {
    case_id: caseId,
    case_version: caseVersion,
    principal_id: EVAL_PRINCIPAL,
    disclosure_version: EVAL_DISCLOSURE,
    disclosure_accepted_at: isoFrom(EVAL_START_MS),
    requirements,
    propositions,
    clarifications: [],
    evidence_references: [],
    turn_log: turnLog,
    attestations: [],
  };

  const input = buildCompilerInput({
    compile_run_id: compileRunId,
    compiler_version_id: compiler.compiler_version_id,
    state: { case_id: caseId, case_version: caseVersion },
    turn,
    requirements,
    livePropositions: livePropositions(propositions),
  });

  return { case_id: caseId, state, turn, input, next_case_version: caseVersion + 1 };
}

/** Ids the runtime would mint for propositions and clarifications on this turn. */
export function evalMutationIds(evalCase: SemanticEvalCase) {
  return sequentialIdFactory(evalCase.id + '.mut.');
}
