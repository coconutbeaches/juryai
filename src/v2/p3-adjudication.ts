import {
  hashAdjudicationInput,
  type AdjudicationInput,
} from './adjudication-input.js';

export const P3_JURY_SIZE = 7;

export type BailiffStatus = 'valid' | 'repaired' | 'disqualified';

export interface InitialSummaryDecision {
  juror_id: string;
  summary: string;
  recommended_outcome: string;
  confidence: number;
  evidence_references: string[];
}

export interface SecondarySummaryDecision extends InitialSummaryDecision {
  revised_after_peer_review: boolean;
}

export interface PeerScore {
  scorer_juror_id: string;
  target_juror_id: string;
  evidence_grounding: number;
  issue_coverage: number;
  reasoning_quality: number;
  fairness: number;
  counterargument_handling: number;
  uncertainty_honesty: number;
}

export interface ReasoningMatrixRow {
  juror_id: string;
  average_score: number;
  scores_received: PeerScore[];
}

export interface FinalJurorDecision {
  juror_id: string;
  final_vote: string;
  confidence: number;
  recommended_remedy: string;
  controlling_reasons: string[];
  key_evidence_references: string[];
  strongest_opposing_argument: string;
  response_to_opposing_argument: string;
  unresolved_uncertainties: string[];
  bailiff_status: BailiffStatus;
}

export interface OutcomeMatrix {
  qualified_juror_count: number;
  jurors: FinalJurorDecision[];
  vote_counts: Record<string, number>;
  vote_margin: number;
  majority_outcome: string | null;
  strongest_dissent: string | null;
}

export interface JudgeOutput {
  final_recommendation: string | null;
  vote_summary: string;
  majority_reasoning: string[];
  strongest_dissent: string | null;
}

export interface P3ModelAdapter {
  initialDecision(
    input: AdjudicationInput,
    jurorId: string,
  ): Promise<InitialSummaryDecision>;
  secondaryDecision(
    input: AdjudicationInput,
    jurorId: string,
    anonymizedInitials: InitialSummaryDecision[],
  ): Promise<SecondarySummaryDecision>;
  peerScores(
    input: AdjudicationInput,
    jurorId: string,
    anonymizedSecondaries: SecondarySummaryDecision[],
  ): Promise<PeerScore[]>;
  finalDecision(
    input: AdjudicationInput,
    jurorId: string,
    reasoningMatrix: ReasoningMatrixRow[],
  ): Promise<FinalJurorDecision>;
  repairDecision?(
    input: AdjudicationInput,
    jurorId: string,
    invalidDecision: FinalJurorDecision,
    issues: string[],
  ): Promise<FinalJurorDecision>;
}

export interface P3RunResult {
  input_hash: string;
  initial_summaries: InitialSummaryDecision[];
  secondary_summaries: SecondarySummaryDecision[];
  reasoning_matrix: ReasoningMatrixRow[];
  final_decisions: FinalJurorDecision[];
  outcome_matrix: OutcomeMatrix;
  judge_output: JudgeOutput;
}

function ensureLockedInput(input: AdjudicationInput): void {
  if (input.input_hash !== hashAdjudicationInput(input)) {
    throw new TypeError('P3 requires an exact locked AdjudicationInput hash.');
  }
  if (!input.locked_envelope.lock_event_id || !input.locked_envelope.envelope_hash) {
    throw new TypeError('P3 requires a locked envelope identity.');
  }
}

export function anonymizeSummaries<T extends { juror_id: string }>(summaries: T[]): T[] {
  return summaries.map((summary, index) => ({
    ...summary,
    juror_id: `Juror ${index + 1}`,
  }));
}

export function buildReasoningMatrix(
  secondarySummaries: SecondarySummaryDecision[],
  scores: PeerScore[],
): ReasoningMatrixRow[] {
  const byJuror = new Map<string, PeerScore[]>();
  for (const summary of secondarySummaries) byJuror.set(summary.juror_id, []);
  for (const score of scores) {
    if (byJuror.has(score.target_juror_id)) byJuror.get(score.target_juror_id)!.push(score);
  }
  return secondarySummaries.map((summary) => {
    const received = byJuror.get(summary.juror_id) ?? [];
    const flattened = received.flatMap((score) => [
      score.evidence_grounding,
      score.issue_coverage,
      score.reasoning_quality,
      score.fairness,
      score.counterargument_handling,
      score.uncertainty_honesty,
    ]);
    const average =
      flattened.length === 0
        ? 0
        : flattened.reduce((total, value) => total + value, 0) / flattened.length;
    return {
      juror_id: summary.juror_id,
      average_score: average,
      scores_received: received,
    };
  });
}

export function validateFinalJurorDecision(
  input: AdjudicationInput,
  decision: FinalJurorDecision,
): string[] {
  const issues: string[] = [];
  if (!decision.juror_id) issues.push('missing_juror_id');
  if (!decision.final_vote) issues.push('missing_final_vote');
  if (
    !Number.isFinite(decision.confidence) ||
    decision.confidence < 0 ||
    decision.confidence > 10
  ) {
    issues.push('invalid_confidence');
  }
  if (!decision.recommended_remedy) issues.push('missing_recommended_remedy');
  if (decision.controlling_reasons.length === 0) issues.push('missing_controlling_reasons');
  if (!decision.strongest_opposing_argument) issues.push('missing_opposing_argument');
  if (!decision.response_to_opposing_argument) issues.push('missing_opposing_response');

  const admitted = new Set(
    input.eligible_evidence.flatMap((evidence) => [
      evidence.evidence_id,
      evidence.inspection_result_id,
      evidence.inspection_source_reference.source_id,
      ...evidence.source_references.map((reference) => reference.source_id),
    ]),
  );
  for (const reference of decision.key_evidence_references) {
    if (!admitted.has(reference)) issues.push(`nonexistent_or_ineligible_evidence:${reference}`);
  }
  return issues;
}

export async function bailiffValidateWithOneRepair(
  input: AdjudicationInput,
  adapter: P3ModelAdapter,
  decision: FinalJurorDecision,
): Promise<FinalJurorDecision> {
  const issues = validateFinalJurorDecision(input, decision);
  if (issues.length === 0) return { ...decision, bailiff_status: 'valid' };
  if (!adapter.repairDecision) return { ...decision, bailiff_status: 'disqualified' };
  const repaired = await adapter.repairDecision(input, decision.juror_id, decision, issues);
  const repairedIssues = validateFinalJurorDecision(input, repaired);
  return {
    ...repaired,
    bailiff_status: repairedIssues.length === 0 ? 'repaired' : 'disqualified',
  };
}

export function buildOutcomeMatrix(finalDecisions: FinalJurorDecision[]): OutcomeMatrix {
  const qualified = finalDecisions.filter(
    (decision) => decision.bailiff_status !== 'disqualified',
  );
  const voteCounts: Record<string, number> = {};
  for (const decision of qualified) {
    voteCounts[decision.final_vote] = (voteCounts[decision.final_vote] ?? 0) + 1;
  }
  const ranked = Object.entries(voteCounts).sort((left, right) => right[1] - left[1]);
  const majorityOutcome = ranked[0]?.[0] ?? null;
  const top = ranked[0]?.[1] ?? 0;
  const second = ranked[1]?.[1] ?? 0;
  const dissent = qualified.find((decision) => decision.final_vote !== majorityOutcome) ?? null;
  return {
    qualified_juror_count: qualified.length,
    jurors: qualified,
    vote_counts: voteCounts,
    vote_margin: top - second,
    majority_outcome: majorityOutcome,
    strongest_dissent: dissent?.final_vote ?? null,
  };
}

export function judgeFinalize(outcome: OutcomeMatrix): JudgeOutput {
  const majority = outcome.majority_outcome;
  const majorityJurors = majority
    ? outcome.jurors.filter((decision) => decision.final_vote === majority)
    : [];
  const majorityReasoning = [
    ...new Set(majorityJurors.flatMap((decision) => decision.controlling_reasons)),
  ];
  return {
    final_recommendation: majority,
    vote_summary: Object.entries(outcome.vote_counts)
      .sort((left, right) => right[1] - left[1])
      .map(([vote, count]) => `${vote}: ${count}`)
      .join(', '),
    majority_reasoning: majorityReasoning,
    strongest_dissent: outcome.strongest_dissent,
  };
}

export async function runP3Adjudication(
  input: AdjudicationInput,
  adapters: Record<string, P3ModelAdapter>,
): Promise<P3RunResult> {
  ensureLockedInput(input);
  const jurorIds = Object.keys(adapters);
  if (jurorIds.length !== P3_JURY_SIZE) {
    throw new TypeError(`P3 MVP requires exactly ${P3_JURY_SIZE} jurors.`);
  }

  const initialSummaries = await Promise.all(
    jurorIds.map((jurorId) => adapters[jurorId]!.initialDecision(input, jurorId)),
  );
  const anonymizedInitials = anonymizeSummaries(initialSummaries);

  const secondarySummaries = await Promise.all(
    jurorIds.map((jurorId) =>
      adapters[jurorId]!.secondaryDecision(input, jurorId, anonymizedInitials),
    ),
  );
  const anonymizedSecondaries = anonymizeSummaries(secondarySummaries);

  const peerScoreBatches = await Promise.all(
    jurorIds.map((jurorId) =>
      adapters[jurorId]!.peerScores(input, jurorId, anonymizedSecondaries),
    ),
  );
  const reasoningMatrix = buildReasoningMatrix(secondarySummaries, peerScoreBatches.flat());

  const finalRaw = await Promise.all(
    jurorIds.map((jurorId) =>
      adapters[jurorId]!.finalDecision(input, jurorId, reasoningMatrix),
    ),
  );
  const finalDecisions = await Promise.all(
    finalRaw.map((decision) =>
      bailiffValidateWithOneRepair(input, adapters[decision.juror_id]!, decision),
    ),
  );

  const outcomeMatrix = buildOutcomeMatrix(finalDecisions);
  const judgeOutput = judgeFinalize(outcomeMatrix);
  return {
    input_hash: input.input_hash,
    initial_summaries: initialSummaries,
    secondary_summaries: secondarySummaries,
    reasoning_matrix: reasoningMatrix,
    final_decisions: finalDecisions,
    outcome_matrix: outcomeMatrix,
    judge_output: judgeOutput,
  };
}
