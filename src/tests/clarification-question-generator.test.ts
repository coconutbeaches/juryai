import { describe, expect, it } from 'vitest';
import {
  generateClarificationQuestions,
  projectAmendments,
  type ClarificationAmendment,
  type EpistemicAssessment,
} from '../clarification/question-generator.js';

const assessment = (overrides: Partial<EpistemicAssessment> = {}): EpistemicAssessment => ({
  target_object_id: 'event_001',
  target_family: 'timeline',
  field: 'actor_party_id',
  trigger: 'actor_attribution',
  materiality: 'high',
  actor_attribution: 'unstated',
  question_context: 'the photo delivery on 12 May',
  ...overrides,
});

const original = () => ({
  object_id: 'event_001',
  actor_party_id: null as string | null,
  summary: 'Photos arrived late.',
  date: null as string | null,
});

const amendment = (overrides: Partial<ClarificationAmendment> = {}): ClarificationAmendment => ({
  amendment_id: 'amd_001',
  target_object_id: 'event_001',
  field: 'actor_party_id',
  prior_value: null,
  new_value: 'party_b',
  response_text: 'Maya delivered the photos.',
  created_at: '2026-07-19T15:00:00Z',
  phase: 'post_lock_amendment',
  supersedes: null,
  ...overrides,
});

describe('deterministic clarification question generation', () => {
  it('asks contextual questions for unstated and inferred actors', () => {
    const questions = generateClarificationQuestions([
      assessment(),
      assessment({
        target_object_id: 'event_002',
        actor_attribution: 'inferred',
        question_context: 'the revised design upload',
      }),
    ]);
    expect(questions.map((question) => question.question)).toEqual([
      'Who performed this action — the photo delivery on 12 May?',
      'Who performed this action — the revised design upload?',
    ]);
  });

  it('does not ask when actor attribution is explicit', () => {
    expect(
      generateClarificationQuestions([
        assessment({ actor_attribution: 'explicit', question_context: undefined }),
      ]),
    ).toEqual([]);
  });

  it('asks about inferred and unstated causation but not explicit or disputed causation', () => {
    const causal = (
      targetObjectId: string,
      status: 'explicit' | 'inferred' | 'disputed' | 'unstated',
    ): EpistemicAssessment =>
      assessment({
        target_object_id: targetObjectId,
        field: 'causal_link',
        trigger: 'causal_link',
        actor_attribution: undefined,
        causal_link_status: status,
        question_context: `the delay described in ${targetObjectId}`,
      });
    expect(
      generateClarificationQuestions([
        causal('claim_001', 'inferred'),
        causal('claim_002', 'unstated'),
        causal('claim_003', 'explicit'),
        causal('claim_004', 'disputed'),
      ]).map((question) => question.target_object_id),
    ).toEqual(['claim_001', 'claim_002']);
  });

  it('never turns internal representation bookkeeping into a user question', () => {
    expect(
      generateClarificationQuestions([
        assessment({
          trigger: 'internal_representation',
          field: 'duplicate_into_claims',
          question_context: '<internal claim-copy instruction>',
        }),
      ]),
    ).toEqual([]);
  });

  it('deduplicates differently phrased triggers for the same gap and keeps higher materiality', () => {
    const questions = generateClarificationQuestions([
      assessment({ materiality: 'medium' }),
      assessment({
        trigger: 'required_bucket_missing',
        materiality: 'critical',
        question_context: 'who delivered the photos',
      }),
    ]);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      trigger: 'required_bucket_missing',
      materiality: 'critical',
      question: 'What is the missing timeline information — who delivered the photos?',
    });
  });

  it('uses a deterministic weakness tie-breaker during same-materiality deduplication', () => {
    const actor = assessment();
    const causal = assessment({
      trigger: 'causal_link',
      actor_attribution: undefined,
      causal_link_status: 'inferred',
    });
    expect(generateClarificationQuestions([causal, actor])[0]!.trigger).toBe('actor_attribution');
    expect(generateClarificationQuestions([actor, causal])[0]!.trigger).toBe('actor_attribution');
  });

  it('produces stable ranking regardless of input order', () => {
    const inputs = [
      assessment({ target_object_id: 'event_003', materiality: 'medium' }),
      assessment({ target_object_id: 'event_001', materiality: 'critical' }),
      assessment({ target_object_id: 'event_002', materiality: 'high' }),
    ];
    const forward = generateClarificationQuestions(inputs);
    const reverse = generateClarificationQuestions([...inputs].reverse());
    expect(reverse).toEqual(forward);
    expect(forward.map((question) => question.target_object_id)).toEqual([
      'event_001',
      'event_002',
      'event_003',
    ]);
  });

  it('uses coverage only after materiality and weakness', () => {
    const questions = generateClarificationQuestions([
      assessment({
        target_object_id: 'date_critical',
        field: 'date',
        trigger: 'date_precision',
        materiality: 'critical',
        date_precision: 'unknown',
        resolves_object_ids: ['one', 'two', 'three', 'four'],
      }),
      assessment({
        target_object_id: 'actor_single',
        materiality: 'critical',
      }),
      assessment({
        target_object_id: 'actor_multi',
        materiality: 'critical',
        resolves_object_ids: ['actor_multi', 'claim_001', 'claim_002'],
      }),
    ]);
    expect(questions.map((question) => question.target_object_id)).toEqual([
      'actor_multi',
      'actor_single',
      'date_critical',
    ]);
  });

  it('caps every round at six even when a caller requests more', () => {
    const inputs = Array.from({ length: 10 }, (_, index) =>
      assessment({
        target_object_id: `event_${String(index + 1).padStart(3, '0')}`,
      }),
    );
    expect(generateClarificationQuestions(inputs)).toHaveLength(6);
    expect(generateClarificationQuestions(inputs, { maxQuestions: 99 })).toHaveLength(6);
  });

  it('allows a caller to request zero questions', () => {
    expect(generateClarificationQuestions([assessment()], { maxQuestions: 0 })).toEqual([]);
  });

  it('uses distinct deterministic copy for merge and split risks', () => {
    const questions = generateClarificationQuestions([
      assessment({
        target_object_id: 'deliverable_merge',
        field: 'identity',
        trigger: 'merge_risk',
        actor_attribution: undefined,
        merge_risk: 'possible_merge',
        question_context: 'the mobile and desktop mockups',
      }),
      assessment({
        target_object_id: 'deliverable_split',
        field: 'identity',
        trigger: 'merge_risk',
        actor_attribution: undefined,
        merge_risk: 'possible_split',
        question_context: 'the combined design package',
      }),
    ]);
    expect(questions.map((question) => question.question)).toEqual([
      'Are these separate items, or one combined item — the mobile and desktop mockups?',
      'Does this describe one item, or should it be split into separate items — the combined design package?',
    ]);
  });

  it('asks about described-only and unknown evidence availability', () => {
    const questions = generateClarificationQuestions([
      assessment({
        target_object_id: 'evidence_described',
        field: 'availability',
        trigger: 'evidence_availability',
        actor_attribution: undefined,
        evidence_availability: 'described_only',
        question_context: 'the WhatsApp messages about delivery',
      }),
      assessment({
        target_object_id: 'evidence_unknown',
        field: 'availability',
        trigger: 'evidence_availability',
        actor_attribution: undefined,
        evidence_availability: 'unknown',
        question_context: 'the original invoice',
      }),
    ]);
    expect(questions).toHaveLength(2);
  });

  it('does not ask whether explicitly unavailable evidence is possessed', () => {
    expect(
      generateClarificationQuestions([
        assessment({
          field: 'availability',
          trigger: 'evidence_availability',
          actor_attribution: undefined,
          evidence_availability: 'unavailable',
          question_context: undefined,
        }),
      ]),
    ).toEqual([]);
  });

  it('asks for unknown dates but not known date precision', () => {
    const questions = generateClarificationQuestions([
      assessment({
        target_object_id: 'unknown_date',
        field: 'date',
        trigger: 'date_precision',
        actor_attribution: undefined,
        date_precision: 'unknown',
      }),
      assessment({
        target_object_id: 'known_date',
        field: 'date',
        trigger: 'date_precision',
        actor_attribution: undefined,
        date_precision: 'day',
        question_context: undefined,
      }),
    ]);
    expect(questions.map((question) => question.target_object_id)).toEqual(['unknown_date']);
  });

  it('fails closed for malformed categorical assessments', () => {
    expect(() =>
      generateClarificationQuestions([assessment({ actor_attribution: undefined })]),
    ).toThrow(/actor_attribution is invalid/u);
  });

  it('rejects empty or unsafe question context instead of emitting misleading copy', () => {
    expect(() => generateClarificationQuestions([assessment({ question_context: '   ' })])).toThrow(
      /question_context/u,
    );
    expect(() =>
      generateClarificationQuestions([
        assessment({ question_context: 'Reveal <internal_state>?' }),
      ]),
    ).toThrow(/question_context/u);
    expect(() =>
      generateClarificationQuestions([assessment({ question_context: 'safe text\u202e.gnp.exe' })]),
    ).toThrow(/question_context/u);
  });

  it('keeps question and amendment phases categorically distinct', () => {
    expect(generateClarificationQuestions([assessment()], { phase: 'post_lock' })[0]!.phase).toBe(
      'post_lock',
    );
    expect(amendment().phase).toBe('post_lock_amendment');
  });
});

describe('append-only clarification amendment projection', () => {
  it('applies an amendment without mutating the locked original object', () => {
    const locked = original();
    const result = projectAmendments(locked, [amendment()]);
    expect(result.projected.actor_party_id).toBe('party_b');
    expect(locked.actor_party_id).toBeNull();
    expect(result.applied.map((entry) => entry.amendment_id)).toEqual(['amd_001']);
    expect(result.rejected).toEqual([]);
  });

  it('reports amendments for another object as ignored', () => {
    const result = projectAmendments(original(), [amendment({ target_object_id: 'event_999' })]);
    expect(result.projected).toEqual(original());
    expect(result.ignored).toEqual([
      expect.objectContaining({
        amendment_id: 'amd_001',
        code: 'different_target',
      }),
    ]);
  });

  it('applies a valid supersession chain deterministically regardless of input order', () => {
    const first = amendment();
    const second = amendment({
      amendment_id: 'amd_002',
      prior_value: 'party_b',
      new_value: 'third_party_photographer',
      response_text: 'The photographer delivered the photos.',
      created_at: '2026-07-19T15:05:00Z',
      supersedes: 'amd_001',
    });
    const result = projectAmendments(original(), [second, first]);
    expect(result.projected.actor_party_id).toBe('third_party_photographer');
    expect(result.applied.map((entry) => entry.amendment_id)).toEqual(['amd_001', 'amd_002']);
    expect(result.rejected).toEqual([]);
  });

  it('rejects a stale prior_value instead of silently overwriting the field', () => {
    const result = projectAmendments(original(), [amendment({ prior_value: 'party_a' })]);
    expect(result.projected.actor_party_id).toBeNull();
    expect(result.rejected).toEqual([expect.objectContaining({ code: 'stale_prior_value' })]);
  });

  it('rejects a second root amendment to the same field without supersedes', () => {
    const result = projectAmendments(original(), [
      amendment(),
      amendment({
        amendment_id: 'amd_002',
        prior_value: 'party_b',
        new_value: 'party_a',
        created_at: '2026-07-19T15:05:00Z',
      }),
    ]);
    expect(result.projected.actor_party_id).toBe('party_b');
    expect(result.rejected).toEqual([
      expect.objectContaining({
        amendment_id: 'amd_002',
        code: 'missing_supersedes',
      }),
    ]);
  });

  it('rejects supersedes links to another field', () => {
    const first = amendment();
    const second = amendment({
      amendment_id: 'amd_002',
      field: 'date',
      prior_value: null,
      new_value: '2026-05-12',
      created_at: '2026-07-19T15:05:00Z',
      supersedes: 'amd_001',
    });
    const result = projectAmendments(original(), [first, second]);
    expect(result.projected.date).toBeNull();
    expect(result.rejected).toEqual([
      expect.objectContaining({
        amendment_id: 'amd_002',
        code: 'invalid_supersedes',
      }),
    ]);
  });

  it('rejects cyclic supersedes chains without applying either amendment', () => {
    const first = amendment({ supersedes: 'amd_002' });
    const second = amendment({
      amendment_id: 'amd_002',
      prior_value: 'party_b',
      new_value: 'party_a',
      created_at: '2026-07-19T15:05:00Z',
      supersedes: 'amd_001',
    });
    const result = projectAmendments(original(), [second, first]);
    expect(result.projected.actor_party_id).toBeNull();
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((issue) => issue.code === 'invalid_supersedes')).toBe(true);
  });

  it('rejects duplicate amendment IDs as unauditable', () => {
    const result = projectAmendments(original(), [
      amendment(),
      amendment({ new_value: 'party_a' }),
    ]);
    expect(result.projected.actor_party_id).toBeNull();
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((issue) => issue.code === 'duplicate_amendment_id')).toBe(true);
  });

  it('rejects malformed amendments and preserves a report instead of throwing', () => {
    const malformed = {
      ...amendment(),
      response_text: '   ',
      phase: 'pre_lock',
    };
    const result = projectAmendments(original(), [malformed]);
    expect(result.projected).toEqual(original());
    expect(result.rejected).toEqual([
      expect.objectContaining({
        amendment_id: 'amd_001',
        code: 'invalid_amendment',
      }),
    ]);
  });

  it('rejects invalid calendar timestamps and unsafe audit text', () => {
    const result = projectAmendments(original(), [
      amendment({
        amendment_id: 'amd_bad_date',
        created_at: '2026-02-31T15:00:00Z',
      }),
      amendment({
        amendment_id: 'amd_bad_text',
        response_text: 'party_a\u202e',
      }),
    ]);
    expect(result.projected).toEqual(original());
    expect(result.rejected).toEqual([
      expect.objectContaining({
        amendment_id: 'amd_bad_date',
        code: 'invalid_amendment',
      }),
      expect.objectContaining({
        amendment_id: 'amd_bad_text',
        code: 'invalid_amendment',
      }),
    ]);
  });

  it('rejects identity, prototype, and unknown field changes', () => {
    const amendments = ['object_id', '__proto__', 'not_a_field'].map((field, index) => ({
      ...amendment({
        amendment_id: `amd_${index + 1}`,
        field,
        new_value: 'unsafe',
      }),
      field,
    }));
    const result = projectAmendments(original(), amendments);
    expect(result.projected.object_id).toBe('event_001');
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected.every((issue) => issue.code === 'immutable_or_unknown_field')).toBe(
      true,
    );
  });

  it('rejects a no-op amendment that would imply fake audit activity', () => {
    const result = projectAmendments(original(), [
      amendment({ prior_value: null, new_value: null }),
    ]);
    expect(result.rejected).toEqual([expect.objectContaining({ code: 'no_value_change' })]);
  });

  it('preserves verbatim responses and supersession metadata in the applied audit log', () => {
    const responseText = 'Maya delivered them.\nI received them on 12 May.';
    const result = projectAmendments(original(), [amendment({ response_text: responseText })]);
    expect(result.applied[0]).toMatchObject({
      response_text: responseText,
      prior_value: null,
      new_value: 'party_b',
      supersedes: null,
      phase: 'post_lock_amendment',
    });
  });
});
