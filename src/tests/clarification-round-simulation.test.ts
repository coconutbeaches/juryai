import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alignPersonA } from '../alignment/person-a-alignment-corrected.js';
import {
  applyClarificationRound,
  buildBeforeAfterSummary,
  type ClarificationAnswer,
} from '../clarification/apply-clarification-round.js';
import type { NecessaryClarificationQuestion } from '../clarification/question-necessity.js';
import { evaluatePersonA } from '../evaluation/person-a-diff-corrected.js';
import { validPersonAExtraction } from './person-a-test-helpers.js';

function simulationFixture() {
  const extraction = validPersonAExtraction();
  const event = extraction.timeline[0];
  const goldenFixture = structuredClone(extraction);
  const goldenEvent = goldenFixture.timeline[0];
  goldenEvent.event_summary = 'Maya delivered the final photo batch on 12 May.';
  const question: NecessaryClarificationQuestion = {
    question_id: 'clarification_01',
    target_object_id: event.event_id,
    target_family: 'timeline',
    field: 'required_information',
    trigger: 'required_bucket_missing',
    materiality: 'high',
    question: 'Who delivered the final photo batch?',
    phase: 'pre_lock',
    resolves_object_ids: [event.event_id],
    necessity_classification: 'ask_human',
    grounding_references: [],
    contradiction_alternatives: [],
  };
  const answer: ClarificationAnswer = {
    amendment_id: 'clarification_amendment_01',
    question_id: question.question_id,
    target_object_id: event.event_id,
    field: 'event_summary',
    response_text: 'Maya delivered the final photo batch on 12 May.',
    prior_value: event.event_summary,
    new_value: goldenEvent.event_summary,
    created_at: '2026-07-19T13:01:00Z',
    phase: 'post_lock_amendment',
    supersedes: null,
    grounding: [
      {
        source: 'golden_fixture',
        object_id: goldenEvent.event_id,
        field: 'event_summary',
      },
    ],
    synthetic_golden_test_data: true,
    fully_resolves_question: true,
  };
  return {
    extraction,
    goldenFixture,
    narrative: extraction.submission.raw_text,
    question,
    answer,
  };
}

function runFixture(
  overrides: {
    answer?: Partial<ClarificationAnswer>;
    answers?: unknown[];
    questions?: NecessaryClarificationQuestion[];
  } = {},
) {
  const fixture = simulationFixture();
  const answer = { ...fixture.answer, ...overrides.answer };
  return {
    fixture,
    result: applyClarificationRound({
      extraction: fixture.extraction,
      questions: overrides.questions ?? [fixture.question],
      answers: overrides.answers ?? [answer],
      goldenFixture: fixture.goldenFixture,
      narrative: fixture.narrative,
    }),
  };
}

describe('offline clarification-round simulation', () => {
  it('keeps the committed synthetic answer fixture bounded and auditable', () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL('../fixtures/dry_run_001.person_a.clarification_answers.json', import.meta.url),
        'utf8',
      ),
    ) as { version: string; answers: ClarificationAnswer[] };

    expect(fixture.version).toBe('person-a-clarification-answers-v0.1.0');
    expect(fixture.answers.length).toBeGreaterThan(0);
    expect(fixture.answers.length).toBeLessThanOrEqual(6);
    expect(new Set(fixture.answers.map((answer) => answer.amendment_id)).size).toBe(
      fixture.answers.length,
    );
    expect(fixture.answers.every((answer) => answer.synthetic_golden_test_data)).toBe(true);
    expect(fixture.answers.every((answer) => answer.grounding.length > 0)).toBe(true);
  });

  it('preserves the original extraction byte-equivalently after projection', () => {
    const fixture = simulationFixture();
    const before = JSON.stringify(fixture.extraction);

    const result = applyClarificationRound({
      extraction: fixture.extraction,
      questions: [fixture.question],
      answers: [fixture.answer],
      goldenFixture: fixture.goldenFixture,
      narrative: fixture.narrative,
    });

    expect(JSON.stringify(fixture.extraction)).toBe(before);
    expect(JSON.stringify(result.original)).toBe(before);
  });

  it('changes only the intended field for a valid grounded amendment', () => {
    const { fixture, result } = runFixture();
    const expected = structuredClone(fixture.extraction);
    expected.timeline[0].event_summary = fixture.answer.new_value;

    expect(result.projected_effective_record).toEqual(expected);
    expect(result.applied_amendments).toHaveLength(1);
    expect(result.rejected_amendments).toEqual([]);
  });

  it('rejects a stale prior value', () => {
    const { result } = runFixture({ answer: { prior_value: 'stale summary' } });

    expect(result.applied_amendments).toEqual([]);
    expect(result.rejected_amendments).toContainEqual(
      expect.objectContaining({ code: 'stale_prior_value' }),
    );
  });

  it('rejects a wrong question and target pairing', () => {
    const fixture = simulationFixture();
    const other = fixture.extraction.claims[0];
    const result = applyClarificationRound({
      extraction: fixture.extraction,
      questions: [fixture.question],
      answers: [
        {
          ...fixture.answer,
          target_object_id: other.claim_id,
          field: 'claim_text',
          prior_value: other.claim_text,
        },
      ],
      goldenFixture: fixture.goldenFixture,
      narrative: fixture.narrative,
    });

    expect(result.applied_amendments).toEqual([]);
    expect(result.rejected_amendments).toContainEqual(
      expect.objectContaining({ code: 'wrong_question_target' }),
    );
  });

  it('rejects every duplicate amendment ID', () => {
    const fixture = simulationFixture();
    const duplicate = { ...fixture.answer };
    const result = applyClarificationRound({
      extraction: fixture.extraction,
      questions: [fixture.question],
      answers: [fixture.answer, duplicate],
      goldenFixture: fixture.goldenFixture,
      narrative: fixture.narrative,
    });

    expect(result.applied_amendments).toEqual([]);
    expect(result.rejected_amendments).toHaveLength(2);
    expect(result.rejected_amendments.every((item) => item.code === 'duplicate_amendment_id')).toBe(
      true,
    );
  });

  it('rejects an unsafe identity field', () => {
    const { result } = runFixture({
      answer: {
        field: 'event_id',
        prior_value: 'event_001',
        new_value: 'event_rewritten',
      },
    });

    expect(result.applied_amendments).toEqual([]);
    expect(result.rejected_amendments).toContainEqual(
      expect.objectContaining({ code: 'unsafe_or_unknown_field' }),
    );
  });

  it('rejects an unrelated field even when it exists on a covered target', () => {
    const { result } = runFixture({
      answer: {
        field: 'materiality',
        prior_value: 'high',
        new_value: 'medium',
      },
    });

    expect(result.applied_amendments).toEqual([]);
    expect(result.rejected_amendments).toContainEqual(
      expect.objectContaining({ code: 'unsafe_or_unknown_field' }),
    );
  });

  it('rejects an answer without grounding', () => {
    const { result } = runFixture({ answer: { grounding: [] } });

    expect(result.applied_amendments).toEqual([]);
    expect(result.rejected_amendments).toContainEqual(
      expect.objectContaining({ code: 'invalid_grounding' }),
    );
  });

  it('rejects a malformed timestamp', () => {
    const { result } = runFixture({ answer: { created_at: '2026-02-30T13:01:00Z' } });

    expect(result.applied_amendments).toEqual([]);
    expect(result.rejected_amendments).toContainEqual(
      expect.objectContaining({ code: 'malformed_timestamp' }),
    );
  });

  it('keeps partially answered and unanswered questions visible', () => {
    const { result } = runFixture({ answer: { fully_resolves_question: false } });

    expect(result.applied_amendments).toHaveLength(1);
    expect(result.unresolved_questions.map((question) => question.question_id)).toEqual([
      'clarification_01',
    ]);
    expect(result.audit_summary.questions_answered).toBe(0);
  });

  it('builds a deterministic before-and-after evaluation report', () => {
    const { fixture, result } = runFixture();
    const beforeAlignment = alignPersonA(fixture.extraction, fixture.goldenFixture);
    const before = evaluatePersonA(fixture.extraction, fixture.goldenFixture, beforeAlignment);
    const afterAlignment = alignPersonA(result.projected_effective_record, fixture.goldenFixture);
    const after = evaluatePersonA(
      result.projected_effective_record,
      fixture.goldenFixture,
      afterAlignment,
    );

    const first = buildBeforeAfterSummary(before, after, result);
    const second = buildBeforeAfterSummary(before, after, result);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.original_extraction_hash).not.toBe(first.clarified_extraction_hash);
  });

  it('produces byte-identical simulation results on repeated runs', () => {
    const first = runFixture().result;
    const second = runFixture().result;

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('never creates a fact that does not exactly match cited golden data', () => {
    const { result } = runFixture({ answer: { new_value: 'An unsupported new case fact.' } });

    expect(result.applied_amendments).toEqual([]);
    expect(result.rejected_amendments).toContainEqual(
      expect.objectContaining({ code: 'unsupported_new_value' }),
    );
  });

  it('applies no answers when a round exceeds the six-answer limit', () => {
    const fixture = simulationFixture();
    const answers = Array.from({ length: 7 }, (_, index) => ({
      ...fixture.answer,
      amendment_id: `clarification_amendment_${index + 1}`,
    }));
    const result = applyClarificationRound({
      extraction: fixture.extraction,
      questions: [fixture.question],
      answers,
      goldenFixture: fixture.goldenFixture,
      narrative: fixture.narrative,
    });

    expect(result.applied_amendments).toEqual([]);
    expect(result.rejected_amendments).toHaveLength(7);
    expect(result.rejected_amendments.every((item) => item.code === 'answer_limit_exceeded')).toBe(
      true,
    );
  });
});
