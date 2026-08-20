import { describe, expect, it } from 'vitest';
import { buildAdjudicationInput } from '../v2/adjudication-input.js';
import { createBilateralLockedFixture } from '../v2/contract-fixtures.js';
import {
  P3_JURY_SIZE,
  runP3Adjudication,
  type FinalJurorDecision,
  type InitialSummaryDecision,
  type P3ModelAdapter,
  type PeerScore,
  type SecondarySummaryDecision,
} from '../v2/p3-adjudication.js';

class MockJuror implements P3ModelAdapter {
  constructor(
    private readonly jurorId: string,
    private readonly vote: string,
    private readonly injectBadEvidence = false,
  ) {}

  async initialDecision(): Promise<InitialSummaryDecision> {
    return {
      juror_id: this.jurorId,
      summary: `${this.jurorId} initial view`,
      recommended_outcome: this.vote,
      confidence: 7,
      evidence_references: [],
    };
  }

  async secondaryDecision(
    _input: Parameters<P3ModelAdapter['secondaryDecision']>[0],
    _jurorId: string,
    anonymizedInitials: InitialSummaryDecision[],
  ): Promise<SecondarySummaryDecision> {
    expect(anonymizedInitials).toHaveLength(P3_JURY_SIZE);
    expect(
      anonymizedInitials.every((summary) => /^Juror \d+$/.test(summary.juror_id)),
    ).toBe(true);
    return {
      juror_id: this.jurorId,
      summary: `${this.jurorId} secondary view`,
      recommended_outcome: this.vote,
      confidence: 8,
      evidence_references: [],
      revised_after_peer_review: true,
    };
  }

  async peerScores(
    _input: Parameters<P3ModelAdapter['peerScores']>[0],
    _jurorId: string,
    anonymizedSecondaries: SecondarySummaryDecision[],
  ): Promise<PeerScore[]> {
    expect(
      anonymizedSecondaries.every((summary) => /^Juror \d+$/.test(summary.juror_id)),
    ).toBe(true);
    return anonymizedSecondaries.map((summary) => ({
      scorer_juror_id: this.jurorId,
      target_juror_id: summary.juror_id,
      evidence_grounding: 8,
      issue_coverage: 8,
      reasoning_quality: 8,
      fairness: 8,
      counterargument_handling: 8,
      uncertainty_honesty: 8,
    }));
  }

  async finalDecision(): Promise<FinalJurorDecision> {
    return {
      juror_id: this.jurorId,
      final_vote: this.vote,
      confidence: 8,
      recommended_remedy: this.vote,
      controlling_reasons: [`Reason from ${this.jurorId}`],
      key_evidence_references: this.injectBadEvidence ? ['missing-evidence'] : [],
      strongest_opposing_argument: 'Opposing view',
      response_to_opposing_argument: 'Response',
      unresolved_uncertainties: [],
      bailiff_status: 'valid',
    };
  }

  async repairDecision(
    _input: Parameters<NonNullable<P3ModelAdapter['repairDecision']>>[0],
    _jurorId: string,
    invalidDecision: FinalJurorDecision,
  ): Promise<FinalJurorDecision> {
    return {
      ...invalidDecision,
      key_evidence_references: [],
      bailiff_status: 'repaired',
    };
  }
}

describe('P3 adjudication MVP', () => {
  it('runs independent -> peer review -> scoring -> bailiff -> judge deterministically', async () => {
    const fixture = createBilateralLockedFixture();
    const input = buildAdjudicationInput(fixture.envelope);

    const adapters: Record<string, P3ModelAdapter> = {};
    for (let index = 0; index < P3_JURY_SIZE; index += 1) {
      const jurorId = `juror-${index + 1}`;
      adapters[jurorId] = new MockJuror(
        jurorId,
        index < 5 ? 'refund_40_percent' : 'no_remedy',
        index === 0,
      );
    }

    const result = await runP3Adjudication(input, adapters);

    expect(result.initial_summaries).toHaveLength(P3_JURY_SIZE);
    expect(result.secondary_summaries).toHaveLength(P3_JURY_SIZE);
    expect(result.reasoning_matrix).toHaveLength(P3_JURY_SIZE);
    expect(result.final_decisions).toHaveLength(P3_JURY_SIZE);
    expect(result.final_decisions[0]?.bailiff_status).toBe('repaired');
    expect(result.outcome_matrix.qualified_juror_count).toBe(P3_JURY_SIZE);
    expect(result.outcome_matrix.vote_counts.refund_40_percent).toBe(5);
    expect(result.outcome_matrix.vote_counts.no_remedy).toBe(2);
    expect(result.outcome_matrix.vote_margin).toBe(3);
    expect(result.judge_output.final_recommendation).toBe('refund_40_percent');
    expect(result.judge_output.vote_summary).toContain('refund_40_percent: 5');
  });

  it('rejects a non-seven-member jury', async () => {
    const fixture = createBilateralLockedFixture();
    const input = buildAdjudicationInput(fixture.envelope);
    await expect(
      runP3Adjudication(input, {
        only: new MockJuror('only', 'no_remedy'),
      }),
    ).rejects.toThrow('exactly 7 jurors');
  });
});
