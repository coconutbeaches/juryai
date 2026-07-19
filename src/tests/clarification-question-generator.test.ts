import { describe, expect, it } from 'vitest';
import {
  generateClarificationQuestions,
  projectAmendments,
  type ClarificationAmendment,
  type EpistemicAssessment,
} from '../clarification/question-generator.js';

const assessment = (
  overrides: Partial<EpistemicAssessment> = {},
): EpistemicAssessment => ({
  target_object_id: 'event_001',
  target_family: 'timeline',
  field: 'actor_party_id',
  trigger: 'actor_attribution',
  materiality: 'high',
  actor_attribution: 'unstated',
  ...overrides,
});

describe('deterministic clarification question generation', () => {
  it('generates a question for a genuine epistemic gap', () => {
    const questions = generateClarificationQuestions([assessment()]);
    expect(questions).toHaveLength(1);
    expect(questions[0]!).toMatchObject({
      trigger: 'actor_attribution',
      question: 'Who performed this action?',
      phase: 'pre_lock',
    });
  });

  it('never asks the user to resolve internal representation bookkeeping', () => {
    const questions = generateClarificationQuestions([
      assessment({
        trigger: 'internal_representation',
        field: 'duplicate_into_claims',
      }),
    ]);
    expect(questions).toEqual([]);
  });

  it('does not ask when attribution is explicit', () => {
    expect(
      generateClarificationQuestions([
        assessment({ actor_attribution: 'explicit' }),
      ]),
    ).toEqual([]);
  });

  it('caps every clarification round at six questions', () => {
    const assessments = Array.from({ length: 10 }, (_, index) =>
      assessment({
        target_object_id: `event_${String(index + 1).padStart(3, '0')}`,
      }),
    );
    expect(generateClarificationQuestions(assessments)).toHaveLength(6);
    expect(generateClarificationQuestions(assessments, { maxQuestions: 99 })).toHaveLength(6);
  });

  it('prioritizes materiality, weakness, and multi-gap coverage deterministically', () => {
    const questions = generateClarificationQuestions([
      assessment({
        target_object_id: 'date_001',
        field: 'date',
        trigger: 'date_precision',
        materiality: 'high',
        date_precision: 'unknown',
      }),
      assessment({
        target_object_id: 'claim_001',
        field: 'causal_link',
        trigger: 'causal_link',
        materiality: 'critical',
        causal_link_status: 'inferred',
        resolves_object_ids: ['claim_001', 'event_002', 'damages_001'],
      }),
      assessment({
        target_object_id: 'event_001',
        materiality: 'critical',
      }),
    ]);
    expect(questions.map((question) => question.target_object_id)).toEqual([
      'event_001',
      'claim_001',
      'date_001',
    ]);
  });

  it('deduplicates the same clarification target', () => {
    const questions = generateClarificationQuestions([
      assessment({ materiality: 'medium' }),
      assessment({ materiality: 'critical' }),
    ]);
    expect(questions).toHaveLength(1);
    expect(questions[0]!.materiality).toBe('critical');
  });

  it('uses post-lock phase for later contradictions without mutating the source record', () => {
    const original = { object_id: 'event_001', actor_party_id: null, summary: 'Photos arrived late.' };
    const amendment: ClarificationAmendment = {
      amendment_id: 'amd_001',
      target_object_id: 'event_001',
      field: 'actor_party_id',
      prior_value: null,
      new_value: 'party_b',
      response_text: 'Maya delivered the photos.',
      created_at: '2026-07-19T15:00:00Z',
      phase: 'post_lock_amendment',
      supersedes: null,
    };
    const projected = projectAmendments(original, [amendment]);
    expect(projected.actor_party_id).toBe('party_b');
    expect(original.actor_party_id).toBeNull();
  });

  it('asks about inferred causation but not explicit causation', () => {
    const inferred = assessment({
      target_object_id: 'claim_002',
      field: 'causal_link',
      trigger: 'causal_link',
      causal_link_status: 'inferred',
    });
    const explicit = { ...inferred, target_object_id: 'claim_003', causal_link_status: 'explicit' as const };
    expect(generateClarificationQuestions([inferred, explicit])).toHaveLength(1);
  });
});
