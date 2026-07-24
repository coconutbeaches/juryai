import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  parseApplyPersonAClarificationsArgs,
  runApplyPersonAClarificationsCommand,
  type ApplyPersonAClarificationsCommandDependencies,
} from '../commands/apply-person-a-clarification-answers.js';
import type { NecessaryClarificationQuestion } from '../clarification/question-necessity.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';
import {
  applyPersonAClarificationAnswers,
  hashPersonAClarificationArtifact,
  PERSON_A_CLARIFICATION_ANSWER_BATCH_VERSION,
  type PersonAClarificationAnswerApplicationInput,
  type SubmittedPersonAClarificationAnswer,
} from '../runtime/person-a-clarification-answer-application.js';
import {
  orchestratePersonAPlanning,
  PERSON_A_RUNTIME_ORCHESTRATION_VERSION,
} from '../runtime/person-a-runtime-orchestrator.js';
import { createStaticRuntimeAssessmentProvider } from '../runtime/static-assessment-provider.js';
import { validPersonAExtraction } from './person-a-test-helpers.js';

type JsonObject = Record<string, any>;

function sourceReference(objectId: string, span: JsonObject) {
  return {
    kind: 'source_span' as const,
    object_id: objectId,
    submission_id: span.submission_id,
    quote: span.quote,
    start_char: span.start_char,
    end_char: span.end_char,
  };
}

function extractedReference(
  objectId: string,
  field: string,
  value: string | number | boolean | null,
) {
  return {
    kind: 'extracted_object' as const,
    object_id: objectId,
    field,
    value,
  };
}

function question(
  overrides: Partial<NecessaryClarificationQuestion> &
    Pick<
      NecessaryClarificationQuestion,
      'target_object_id' | 'target_family' | 'field' | 'trigger' | 'grounding_references'
    >,
): NecessaryClarificationQuestion {
  return {
    question_id: 'clarification_01',
    materiality: 'high',
    question: 'Please clarify this grounded point.',
    phase: 'pre_lock',
    resolves_object_ids: [overrides.target_object_id],
    necessity_classification: 'ask_human',
    contradiction_alternatives: [],
    ...overrides,
  } as NecessaryClarificationQuestion;
}

function runtimePlan(
  record: JsonObject,
  questions: NecessaryClarificationQuestion[],
  suppressedCandidates: JsonObject[] = [],
): JsonObject {
  const original = structuredClone(record);
  const repaired = structuredClone(record);
  const hash = hashPersonAClarificationArtifact(record);
  return {
    orchestration_version: PERSON_A_RUNTIME_ORCHESTRATION_VERSION,
    original_extraction: original,
    repaired_extraction: repaired,
    original_extraction_hash: hash,
    repaired_extraction_hash: hash,
    generated_questions: questions,
    question_count: questions.length,
    suppressed_candidates: suppressedCandidates,
    audit_summary: { final_status: 'passed' },
  };
}

function answer(
  issued: NecessaryClarificationQuestion,
  record: JsonObject,
  submittedAnswer: unknown,
  overrides: Partial<SubmittedPersonAClarificationAnswer> = {},
): SubmittedPersonAClarificationAnswer {
  const target = findObject(record, issued.target_object_id);
  return {
    answer_id: 'answer_01',
    question_id: issued.question_id,
    target_object_id: issued.target_object_id,
    target_family: issued.target_family as SubmittedPersonAClarificationAnswer['target_family'],
    field: issued.field,
    prior_value: structuredClone(target[issued.field]),
    submitted_answer: structuredClone(
      submittedAnswer,
    ) as SubmittedPersonAClarificationAnswer['submitted_answer'],
    ...overrides,
  };
}

function findObject(record: JsonObject, objectId: string): JsonObject {
  const values = [
    ...(record.agreement?.terms ?? []),
    ...(record.deliverable_assessments ?? []),
    ...(record.timeline ?? []),
    ...(record.claims ?? []),
    ...(record.evidence ?? []),
    ...(record.damages_claims ?? []),
    ...(record.desired_outcomes?.outcomes ?? []),
    ...(record.third_parties ?? []),
    ...(record.extraction_issues ?? []),
    ...(record.clarification_questions ?? []),
  ];
  const result = values.find((item) => Object.values(item).some((value) => value === objectId));
  if (!result) throw new Error(`Missing test object ${objectId}`);
  return result;
}

function apply(
  record: JsonObject,
  issuedQuestions: NecessaryClarificationQuestion[],
  answers: unknown[],
  options: PersonAClarificationAnswerApplicationInput['options'] = {},
  suppressedCandidates: JsonObject[] = [],
) {
  const plan = runtimePlan(record, issuedQuestions, suppressedCandidates);
  return applyPersonAClarificationAnswers({
    baseline: plan.repaired_extraction,
    runtimePlan: plan,
    answers,
    options,
  });
}

function actorCase() {
  const record = validPersonAExtraction();
  const target = record.timeline[0];
  target.actor_party_id = null;
  target.actor_third_party_id = null;
  const issued = question({
    target_object_id: target.event_id,
    target_family: 'timeline',
    field: 'actor_party_id',
    trigger: 'actor_attribution',
    grounding_references: [sourceReference(target.event_id, target.source_spans[0])],
  });
  return { record, target, issued };
}

function dateCase() {
  const record = validPersonAExtraction();
  const target = record.timeline.find((item: JsonObject) =>
    item.source_spans.some((span: JsonObject) => /April 25/u.test(span.quote)),
  );
  target.date = { start: null, end: null, precision: 'unknown', approximate: false };
  const issued = question({
    target_object_id: target.event_id,
    target_family: 'timeline',
    field: 'date',
    trigger: 'date_precision',
    grounding_references: [
      sourceReference(
        target.event_id,
        target.source_spans.find((span: JsonObject) => /April 25/u.test(span.quote)),
      ),
    ],
  });
  return { record, target, issued };
}

function monthDateCase() {
  const record = validPersonAExtraction();
  const quote = 'The payment was due by June.';
  const narrative = `${record.submission.raw_text}\n${quote}`;
  const contentHash = createHash('sha256').update(narrative, 'utf8').digest('hex');
  record.submission.raw_text = narrative;
  record.submission.content_hash = contentHash;
  record.metadata.input_hash = contentHash;
  const target = record.timeline[0];
  target.event_summary = quote;
  target.date = { start: null, end: null, precision: 'unknown', approximate: false };
  target.source_spans = [
    {
      submission_id: record.submission.submission_id,
      quote,
      start_char: narrative.length - quote.length,
      end_char: narrative.length,
    },
  ];
  const issued = question({
    target_object_id: target.event_id,
    target_family: 'timeline',
    field: 'date',
    trigger: 'date_precision',
    grounding_references: [sourceReference(target.event_id, target.source_spans[0])],
  });
  return { record, target, issued };
}

function multiMentionDateCase() {
  const record = validPersonAExtraction();
  const quote = 'The launch was due on May 20, while final copy was due by April 25.';
  const narrative = `${record.submission.raw_text}\n${quote}`;
  const contentHash = createHash('sha256').update(narrative, 'utf8').digest('hex');
  record.submission.raw_text = narrative;
  record.submission.content_hash = contentHash;
  record.metadata.input_hash = contentHash;
  const target = record.timeline[0];
  target.event_summary = 'The launch was due on May 20.';
  target.date = { start: null, end: null, precision: 'unknown', approximate: false };
  target.source_spans = [
    {
      submission_id: record.submission.submission_id,
      quote,
      start_char: narrative.length - quote.length,
      end_char: narrative.length,
    },
  ];
  const issued = question({
    target_object_id: target.event_id,
    target_family: 'timeline',
    field: 'date',
    trigger: 'date_precision',
    grounding_references: [sourceReference(target.event_id, target.source_spans[0])],
  });
  return { record, target, issued };
}

function dateContextCase(eventSummary: string, quote: string) {
  const record = validPersonAExtraction();
  const narrative = `${record.submission.raw_text}\n${quote}`;
  const contentHash = createHash('sha256').update(narrative, 'utf8').digest('hex');
  record.submission.raw_text = narrative;
  record.submission.content_hash = contentHash;
  record.metadata.input_hash = contentHash;
  const target = record.timeline[0];
  target.event_summary = eventSummary;
  target.date = { start: null, end: null, precision: 'unknown', approximate: false };
  target.source_spans = [
    {
      submission_id: record.submission.submission_id,
      quote,
      start_char: narrative.length - quote.length,
      end_char: narrative.length,
    },
  ];
  const issued = question({
    target_object_id: target.event_id,
    target_family: 'timeline',
    field: 'date',
    trigger: 'date_precision',
    grounding_references: [sourceReference(target.event_id, target.source_spans[0])],
  });
  return { record, target, issued };
}

function evidenceCase() {
  const record = validPersonAExtraction();
  const target = record.evidence.find(
    (item: JsonObject) => item.availability_status === 'described_only',
  );
  const issued = question({
    target_object_id: target.evidence_id,
    target_family: 'evidence',
    field: 'availability_status',
    trigger: 'evidence_availability',
    grounding_references: [
      extractedReference(target.evidence_id, 'availability_status', target.availability_status),
    ],
  });
  return { record, target, issued };
}

function causalCase() {
  const record = validPersonAExtraction();
  const target = record.damages_claims[0];
  const issued = question({
    target_object_id: target.damages_claim_id,
    target_family: 'damages',
    field: 'causal_theory',
    trigger: 'causal_link',
    grounding_references: [
      extractedReference(target.damages_claim_id, 'causal_theory', target.causal_theory),
    ],
  });
  return { record, target, issued };
}

function interpretationCase() {
  const record = validPersonAExtraction();
  const target = record.agreement.terms[0];
  target.person_a_interpretation = null;
  const issued = question({
    target_object_id: target.term_id,
    target_family: 'agreement_terms',
    field: 'person_a_interpretation',
    trigger: 'required_bucket_missing',
    grounding_references: [extractedReference(target.term_id, 'person_a_interpretation', null)],
  });
  return { record, target, issued };
}

function contradictionCase() {
  const record = validPersonAExtraction();
  const target = record.extraction_issues[0];
  const secondGroundedSpan = record.timeline.find(
    (item: JsonObject) => item.source_spans[0]?.quote !== target.source_spans[0]?.quote,
  ).source_spans[0];
  target.source_spans.push(structuredClone(secondGroundedSpan));
  const alternatives = target.source_spans.slice(0, 2).map((span: JsonObject) => ({
    text: span.quote,
    grounding_references: [sourceReference(target.issue_id, span)],
  }));
  const issued = question({
    target_object_id: target.issue_id,
    target_family: 'extraction_issues',
    field: 'description',
    trigger: 'required_bucket_missing',
    necessity_classification: 'contradiction',
    grounding_references: alternatives.flatMap(
      (alternative: any) => alternative.grounding_references,
    ),
    contradiction_alternatives: alternatives,
  });
  return { record, target, issued, alternatives };
}

function requiredInformationQuestion(record: JsonObject, questionId = 'clarification_02') {
  const target = record.extraction_issues[0];
  return question({
    question_id: questionId,
    target_object_id: target.issue_id,
    target_family: 'extraction_issues',
    field: 'required_information',
    trigger: 'required_bucket_missing',
    grounding_references: [sourceReference(target.issue_id, target.source_spans[0])],
  });
}

function requiredInformationAnswer(
  issued: NecessaryClarificationQuestion,
  answerId = 'answer_02',
): SubmittedPersonAClarificationAnswer {
  return {
    answer_id: answerId,
    question_id: issued.question_id,
    target_object_id: issued.target_object_id,
    target_family: 'extraction_issues',
    field: 'required_information',
    prior_value: null,
    submitted_answer: 'The submitter supplied additional details.',
  };
}

describe('Person A clarification answer application', () => {
  it('preserves original and repaired baselines byte-for-byte', () => {
    const { record, issued } = actorCase();
    const plan = runtimePlan(record, [issued]);
    const originalBefore = JSON.stringify(plan.original_extraction);
    const baselineBefore = JSON.stringify(plan.repaired_extraction);
    const result = applyPersonAClarificationAnswers({
      baseline: plan.repaired_extraction,
      runtimePlan: plan,
      answers: [answer(issued, record, 'party_a')],
    });
    expect(JSON.stringify(plan.original_extraction)).toBe(originalBefore);
    expect(JSON.stringify(plan.repaired_extraction)).toBe(baselineBefore);
    expect(result.original_extraction_hash).toBe(hashPersonAClarificationArtifact(record));
    expect(result.repaired_baseline_hash).toBe(hashPersonAClarificationArtifact(record));
    expect(result.audit.original_extraction_unchanged).toBe(true);
    expect(result.audit.repaired_baseline_unchanged).toBe(true);
  });

  it('applies a valid actor answer to an existing party', () => {
    const { record, target, issued } = actorCase();
    const result = apply(record, [issued], [answer(issued, record, 'party_a')]);
    expect(result.audit.final_status).toBe('passed');
    expect(findObject(result.amended_record!, target.event_id).actor_party_id).toBe('party_a');
    expect(result.amendments[0]).toMatchObject({
      question_id: issued.question_id,
      target_family: 'timeline',
      field: 'actor_party_id',
      prior_value: null,
      submitted_answer: 'party_a',
      normalized_applied_value: 'party_a',
      source_type: 'person_a_clarification',
      amendment_sequence: 1,
      created_at: null,
    });
  });

  it('routes an issued actor-party question to the canonical third-party actor field', () => {
    const { record, target, issued } = actorCase();
    record.third_parties.push({
      third_party_id: 'third_party_acme',
      name_or_label: 'Acme Corp',
      role: 'invoice sender',
      relationship_to_party_id: null,
      contacted_for_case: false,
      notes: null,
    });
    const thirdPartyId = record.third_parties[0].third_party_id;
    const result = apply(record, [issued], [answer(issued, record, thirdPartyId)]);
    const amended = findObject(result.amended_record!, target.event_id);
    expect(result.audit.final_status).toBe('passed');
    expect(amended.actor_party_id).toBeNull();
    expect(amended.actor_third_party_id).toBe(thirdPartyId);
    expect(result.validated_answers[0]).toMatchObject({
      field: 'actor_party_id',
      normalized_applied_field: 'actor_third_party_id',
      normalized_applied_value: thirdPartyId,
    });
    expect(result.amendments[0]).toMatchObject({
      question_id: issued.question_id,
      field: 'actor_third_party_id',
      prior_value: null,
      submitted_answer: thirdPartyId,
      normalized_applied_value: thirdPartyId,
    });
  });

  it('rejects a third-party actor answer when the party actor slot is already populated', () => {
    const { record, target, issued } = actorCase();
    record.third_parties.push({
      third_party_id: 'third_party_acme',
      name_or_label: 'Acme Corp',
      role: 'invoice sender',
      relationship_to_party_id: null,
      contacted_for_case: false,
      notes: null,
    });
    target.actor_party_id = 'party_a';
    const thirdPartyQuestion = question({
      ...issued,
      field: 'actor_third_party_id',
    });
    const submitted = answer(thirdPartyQuestion, record, 'third_party_acme');
    const before = JSON.stringify(record);
    const first = apply(record, [thirdPartyQuestion], [submitted]);
    const second = apply(record, [thirdPartyQuestion], [submitted]);

    expect(first.audit.failure_stage).toBe('answer_validation');
    expect(first.rejected_answers).toEqual([
      expect.objectContaining({
        code: 'stale_prior_value',
        answer_id: submitted.answer_id,
        question_id: submitted.question_id,
        message: expect.stringContaining('paired actor field is already populated'),
      }),
    ]);
    expect(first.amendments).toEqual([]);
    expect(first.validated_answers).toEqual([]);
    expect(JSON.stringify(first.amended_record)).toBe(before);
    expect(findObject(first.amended_record!, target.event_id)).toMatchObject({
      actor_party_id: 'party_a',
      actor_third_party_id: null,
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('rejects a party actor answer when the third-party actor slot is already populated', () => {
    const { record, target, issued } = actorCase();
    record.third_parties.push({
      third_party_id: 'third_party_acme',
      name_or_label: 'Acme Corp',
      role: 'invoice sender',
      relationship_to_party_id: null,
      contacted_for_case: false,
      notes: null,
    });
    target.actor_third_party_id = 'third_party_acme';
    const submitted = answer(issued, record, 'party_a');
    const before = JSON.stringify(record);
    const result = apply(record, [issued], [submitted]);

    expect(result.audit.failure_stage).toBe('answer_validation');
    expect(result.rejected_answers).toEqual([
      expect.objectContaining({
        code: 'stale_prior_value',
        answer_id: submitted.answer_id,
        question_id: submitted.question_id,
        message: expect.stringContaining('paired actor field is already populated'),
      }),
    ]);
    expect(result.amendments).toEqual([]);
    expect(result.validated_answers).toEqual([]);
    expect(JSON.stringify(result.amended_record)).toBe(before);
    expect(findObject(result.amended_record!, target.event_id)).toMatchObject({
      actor_party_id: null,
      actor_third_party_id: 'third_party_acme',
    });
  });

  it('rejects a preexisting dual actor slot during amended-record validation', () => {
    const { record, target, issued } = actorCase();
    record.third_parties.push({
      third_party_id: 'third_party_acme',
      name_or_label: 'Acme Corp',
      role: 'invoice sender',
      relationship_to_party_id: null,
      contacted_for_case: false,
      notes: null,
    });
    target.actor_party_id = 'party_a';
    target.actor_third_party_id = 'third_party_acme';
    const before = JSON.stringify(record);
    const result = apply(record, [issued], []);

    expect(result.audit.failure_stage).toBe('amended_record_validation');
    expect(result.validation_errors).toEqual([
      expect.objectContaining({
        code: 'immutable_fact_conflict',
        message: expect.stringContaining(
          'cannot populate both actor_party_id and actor_third_party_id',
        ),
      }),
    ]);
    expect(result.amendments).toEqual([]);
    expect(result.validated_answers).toEqual([]);
    expect(JSON.stringify(result.amended_record)).toBe(before);
  });

  it('rejects paired actor-field questions for one timeline actor slot', () => {
    const { record, target, issued } = actorCase();
    record.third_parties.push({
      third_party_id: 'third_party_acme',
      name_or_label: 'Acme Corp',
      role: 'invoice sender',
      relationship_to_party_id: null,
      contacted_for_case: false,
      notes: null,
    });
    const thirdPartyQuestion = question({
      ...issued,
      question_id: 'clarification_02',
      field: 'actor_third_party_id',
    });
    const before = JSON.stringify(record);
    const result = apply(
      record,
      [issued, thirdPartyQuestion],
      [
        answer(issued, record, 'party_a'),
        answer(thirdPartyQuestion, record, 'third_party_acme', { answer_id: 'answer_02' }),
      ],
    );
    expect(result.audit.failure_stage).toBe('runtime_plan_validation');
    expect(result.rejected_answers[0]?.code).toBe('invalid_runtime_plan');
    expect(result.amendments).toEqual([]);
    expect(JSON.stringify(result.amended_record)).toBe(before);
    expect(target.actor_party_id).toBeNull();
    expect(target.actor_third_party_id).toBeNull();
  });

  it('applies a valid date answer without inventing grounded month/day components', () => {
    const { record, target, issued } = dateCase();
    const submitted = {
      start: '2026-04-25',
      end: null,
      precision: 'day',
      approximate: false,
    };
    const result = apply(record, [issued], [answer(issued, record, submitted)]);
    expect(result.audit.final_status).toBe('passed');
    expect(findObject(result.amended_record!, target.event_id).date).toEqual(submitted);
  });

  it('accepts only the date mention tied to the target event summary', () => {
    const { record, target, issued } = multiMentionDateCase();
    const correct = {
      start: '2026-05-20',
      end: null,
      precision: 'day',
      approximate: false,
    };
    const result = apply(record, [issued], [answer(issued, record, correct)]);
    expect(result.audit.final_status).toBe('passed');
    expect(findObject(result.amended_record!, target.event_id).date).toEqual(correct);
  });

  it('rejects an unrelated date mention from the same grounded span', () => {
    const { record, issued } = multiMentionDateCase();
    const unrelated = {
      start: '2026-04-25',
      end: null,
      precision: 'day',
      approximate: false,
    };
    const result = apply(record, [issued], [answer(issued, record, unrelated)]);
    expect(result.audit.failure_stage).toBe('answer_validation');
    expect(result.rejected_answers[0]?.code).toBe('invalid_date_precision');
    expect(result.amendments).toEqual([]);
  });

  it('allows month-only event context to select an exact grounded day', () => {
    const { record, target, issued } = dateContextCase(
      'The June deadline.',
      'The deadline was June 3.',
    );
    const submitted = {
      start: '2026-06-03',
      end: null,
      precision: 'day',
      approximate: false,
    };
    const result = apply(record, [issued], [answer(issued, record, submitted)]);
    expect(result.audit.final_status).toBe('passed');
    expect(findObject(result.amended_record!, target.event_id).date).toEqual(submitted);
  });

  it('allows year-month event context to select the same exact grounded date', () => {
    const { record, target, issued } = dateContextCase(
      'The June 2026 deadline.',
      'The deadline was June 3, 2026.',
    );
    const submitted = {
      start: '2026-06-03',
      end: null,
      precision: 'day',
      approximate: false,
    };
    const result = apply(record, [issued], [answer(issued, record, submitted)]);
    expect(result.audit.final_status).toBe('passed');
    expect(findObject(result.amended_record!, target.event_id).date).toEqual(submitted);
  });

  it('uses year-month context to constrain a grounded day with no source year', () => {
    const { record, target, issued } = dateContextCase(
      'The June 2026 deadline.',
      'The deadline was June 3.',
    );
    const valid = {
      start: '2026-06-03',
      end: null,
      precision: 'day',
      approximate: false,
    };
    const accepted = apply(record, [issued], [answer(issued, record, valid)]);
    const rejected = apply(
      record,
      [issued],
      [answer(issued, record, { ...valid, start: '2025-06-03' })],
    );
    expect(findObject(accepted.amended_record!, target.event_id).date).toEqual(valid);
    expect(rejected.rejected_answers[0]).toMatchObject({
      answer_id: 'answer_01',
      question_id: issued.question_id,
      code: 'invalid_date_precision',
    });
    expect(rejected.amendments).toEqual([]);
  });

  it.each([
    ['The July deadline.', 'The deadline was June 3.'],
    ['The June 4 deadline.', 'The deadline was June 3.'],
    ['The June 2025 deadline.', 'The deadline was June 3, 2026.'],
  ])('rejects context that conflicts with its grounded source date: %s', (eventSummary, quote) => {
    const { record, issued } = dateContextCase(eventSummary, quote);
    const before = JSON.stringify(record);
    const result = apply(
      record,
      [issued],
      [
        answer(issued, record, {
          start: '2026-06-03',
          end: null,
          precision: 'day',
          approximate: false,
        }),
      ],
    );
    expect(result.audit.failure_stage).toBe('answer_validation');
    expect(result.rejected_answers).toEqual([
      expect.objectContaining({
        answer_id: 'answer_01',
        question_id: issued.question_id,
        code: 'invalid_date_precision',
      }),
    ]);
    expect(result.amendments).toEqual([]);
    expect(JSON.stringify(result.amended_record)).toBe(before);
  });

  it('uses coarser context to exclude an unrelated date in the same source span', () => {
    const { record, target, issued } = dateContextCase(
      'The June deadline.',
      'The deadline was June 3, while the earlier copy date was April 25.',
    );
    const submitted = {
      start: '2026-06-03',
      end: null,
      precision: 'day',
      approximate: false,
    };
    const result = apply(record, [issued], [answer(issued, record, submitted)]);
    expect(result.audit.final_status).toBe('passed');
    expect(findObject(result.amended_record!, target.event_id).date).toEqual(submitted);
  });

  it('fails closed when month-only context leaves two grounded days possible', () => {
    const { record, issued } = dateContextCase(
      'The June deadlines.',
      'The first deadline was June 3 and the final deadline was June 7.',
    );
    const before = JSON.stringify(record);
    const result = apply(
      record,
      [issued],
      [
        answer(issued, record, {
          start: '2026-06-03',
          end: null,
          precision: 'day',
          approximate: false,
        }),
      ],
    );
    expect(result.audit.failure_stage).toBe('answer_validation');
    expect(result.rejected_answers[0]).toMatchObject({
      answer_id: 'answer_01',
      question_id: issued.question_id,
      code: 'invalid_date_precision',
    });
    expect(result.amendments).toEqual([]);
    expect(JSON.stringify(result.amended_record)).toBe(before);
  });

  it('applies a month-only date answer by adding only the supplied year', () => {
    const { record, target, issued } = monthDateCase();
    const submitted = {
      start: '2026-06-01',
      end: '2026-06-30',
      precision: 'month',
      approximate: true,
    };
    const result = apply(record, [issued], [answer(issued, record, submitted)]);
    expect(result.audit.final_status).toBe('passed');
    expect(findObject(result.amended_record!, target.event_id).date).toEqual(submitted);
  });

  it.each([
    {
      start: '2026-07-01',
      end: '2026-07-31',
      precision: 'month',
      approximate: true,
    },
    {
      start: '2026-06-02',
      end: '2026-06-30',
      precision: 'month',
      approximate: true,
    },
    {
      start: '2026-06-01',
      end: '2026-06-30',
      precision: 'month',
      approximate: false,
    },
  ])('rejects a month answer that changes grounded month semantics: %j', (submitted) => {
    const { record, issued } = monthDateCase();
    const result = apply(record, [issued], [answer(issued, record, submitted)]);
    expect(result.audit.failure_stage).toBe('answer_validation');
    expect(result.rejected_answers[0]?.code).toBe('invalid_date_precision');
    expect(result.amendments).toEqual([]);
  });

  it('applies a valid categorical evidence-availability answer without implying inspection', () => {
    const { record, target, issued } = evidenceCase();
    const result = apply(record, [issued], [answer(issued, record, 'unavailable')]);
    const amended = findObject(result.amended_record!, target.evidence_id);
    expect(result.audit.final_status).toBe('passed');
    expect(amended.availability_status).toBe('unavailable');
    expect(amended.file_reference).toBeNull();
    expect(amended.file_hash).toBeNull();
    expect(amended.inspected_at).toBeNull();
  });

  it('stores a valid causal answer as Person A’s asserted theory', () => {
    const { record, target, issued } = causalCase();
    const result = apply(
      record,
      [issued],
      [answer(issued, record, 'The delayed launch caused the claimed lost bookings')],
    );
    expect(findObject(result.amended_record!, target.damages_claim_id).causal_theory).toBe(
      'Person A states: The delayed launch caused the claimed lost bookings.',
    );
  });

  it.each([
    ['NASA delayed the launch', 'Person A states: NASA delayed the launch.'],
    ['Acme Corp withheld payment', 'Person A states: Acme Corp withheld payment.'],
    ['the delay caused lost bookings', 'Person A states: the delay caused lost bookings.'],
    ['  NASA   delayed   the launch...  ', 'Person A states: NASA delayed the launch.'],
    ['Acme Corp withheld payment?!', 'Person A states: Acme Corp withheld payment.'],
  ])(
    'preserves causal capitalization and normalizes safe formatting: %s',
    (submitted, expected) => {
      const { record, target, issued } = causalCase();
      const first = apply(record, [issued], [answer(issued, record, submitted)]);
      const second = apply(record, [issued], [answer(issued, record, submitted)]);
      expect(first.audit.final_status).toBe('passed');
      expect(findObject(first.amended_record!, target.damages_claim_id).causal_theory).toBe(
        expected,
      );
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    },
  );

  it('populates only the supported nullable Person A interpretation', () => {
    const { record, target, issued } = interpretationCase();
    const result = apply(
      record,
      [issued],
      [answer(issued, record, 'Completion meant the remaining balance became due.')],
    );
    expect(findObject(result.amended_record!, target.term_id).person_a_interpretation).toBe(
      'Completion meant the remaining balance became due.',
    );
  });

  it('resolves a contradiction only by selecting one grounded alternative', () => {
    const { record, target, issued, alternatives } = contradictionCase();
    const result = apply(record, [issued], [answer(issued, record, alternatives[1].text)]);
    expect(result.audit.final_status).toBe('passed');
    expect(findObject(result.amended_record!, target.issue_id).description).toBe(
      alternatives[1].text,
    );
  });

  it('rejects an unknown question ID', () => {
    const { record, issued } = actorCase();
    const invalid = answer(issued, record, 'party_a', { question_id: 'clarification_999' });
    expect(apply(record, [issued], [invalid]).rejected_answers[0]?.code).toBe('unknown_question');
  });

  it('rejects duplicate answer IDs and duplicate answers to one question', () => {
    const { record, issued } = actorCase();
    const first = answer(issued, record, 'party_a');
    const duplicate = { ...first };
    const result = apply(record, [issued], [first, duplicate]);
    expect(result.audit.final_status).toBe('failed_closed');
    expect(result.rejected_answers.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['duplicate_answer_id', 'duplicate_question_answer']),
    );
    expect(result.amendments).toEqual([]);
  });

  it('rejects expired and already-applied question IDs', () => {
    const { record, issued } = actorCase();
    const submitted = answer(issued, record, 'party_a');
    expect(
      apply(record, [issued], [submitted], {
        expiredQuestionIds: [issued.question_id],
      }).rejected_answers[0]?.code,
    ).toBe('expired_question');
    expect(
      apply(record, [issued], [submitted], {
        alreadyAppliedQuestionIds: [issued.question_id],
      }).rejected_answers[0]?.code,
    ).toBe('already_applied_question');
  });

  it('rejects an unsupported field or target family', () => {
    const { record, issued } = actorCase();
    const wrongField = answer(issued, record, 'party_a', { field: 'event_summary' });
    expect(apply(record, [issued], [wrongField]).rejected_answers[0]?.code).toBe(
      'unsupported_field',
    );
    const wrongFamily = answer(issued, record, 'party_a', { target_family: 'evidence' });
    expect(apply(record, [issued], [wrongFamily]).rejected_answers[0]?.code).toBe(
      'unsupported_target_family',
    );
  });

  it('rejects an answer for a suppressed candidate', () => {
    const { record, issued } = actorCase();
    const submitted = answer(issued, record, 'party_a', {
      question_id: 'clarification_suppressed',
    });
    const suppressed = [
      {
        assessment: {
          target_object_id: issued.target_object_id,
          field: issued.field,
        },
        classification: 'already_explicit',
      },
    ];
    expect(apply(record, [], [submitted], {}, suppressed).rejected_answers[0]?.code).toBe(
      'suppressed_candidate',
    );
  });

  it('rejects a third unsupported contradiction alternative', () => {
    const { record, issued } = contradictionCase();
    const result = apply(
      record,
      [issued],
      [answer(issued, record, 'A third account that was never grounded.')],
    );
    expect(result.rejected_answers[0]?.code).toBe('contradiction_alternative_unsupported');
  });

  it('rejects contradiction alternatives that are not exact owned source spans', () => {
    const { record, issued } = contradictionCase();
    const malformed = structuredClone(issued);
    malformed.contradiction_alternatives[0]!.grounding_references[0]!.object_id =
      record.timeline[0].event_id;
    const result = apply(
      record,
      [malformed],
      [answer(malformed, record, malformed.contradiction_alternatives[0]!.text)],
    );
    expect(result.audit.failure_stage).toBe('runtime_plan_validation');
    expect(result.rejected_answers[0]?.code).toBe('invalid_runtime_plan');
  });

  it('rejects undocumented application options', () => {
    const { record, issued } = actorCase();
    const result = apply(record, [issued], [answer(issued, record, 'party_a')], {
      unexpected: true,
    } as PersonAClarificationAnswerApplicationInput['options']);
    expect(result.audit.failure_stage).toBe('runtime_plan_validation');
    expect(result.rejected_answers[0]?.code).toBe('invalid_runtime_plan');
  });

  it.each([
    ['createdAt', null],
    ['expiredQuestionIds', 'clarification_01'],
    ['alreadyAppliedQuestionIds', 'clarification_01'],
  ])('rejects a malformed known application option: %s', (key, value) => {
    const { record, issued } = actorCase();
    const result = apply(record, [issued], [answer(issued, record, 'party_a')], {
      [key]: value,
    } as PersonAClarificationAnswerApplicationInput['options']);
    expect(result.audit.failure_stage).toBe('runtime_plan_validation');
    expect(result.rejected_answers[0]?.code).toBe('invalid_runtime_plan');
    expect(result.amendments).toEqual([]);
  });

  it('accepts an issued merge-risk question in the plan without enabling its application', () => {
    const { record, target: actorTarget, issued: actorQuestion } = actorCase();
    const issue = record.extraction_issues[0];
    const secondSpan = structuredClone(record.timeline[1].source_spans[0]);
    issue.source_spans.push(secondSpan);
    const alternatives = issue.source_spans.slice(0, 2).map((span: JsonObject) => ({
      text: span.quote,
      grounding_references: [sourceReference(issue.issue_id, span)],
    }));
    const mergeQuestion = question({
      question_id: 'clarification_02',
      target_object_id: issue.issue_id,
      target_family: 'extraction_issues',
      field: 'description',
      trigger: 'merge_risk',
      necessity_classification: 'contradiction',
      grounding_references: alternatives.flatMap(
        (alternative: JsonObject) => alternative.grounding_references,
      ),
      contradiction_alternatives: alternatives,
    });
    const supported = apply(
      record,
      [actorQuestion, mergeQuestion],
      [answer(actorQuestion, record, 'party_a')],
    );
    expect(supported.audit.final_status).toBe('passed');
    expect(findObject(supported.amended_record!, actorTarget.event_id).actor_party_id).toBe(
      'party_a',
    );
    const unsupported = apply(
      record,
      [actorQuestion, mergeQuestion],
      [answer(mergeQuestion, record, alternatives[0]!.text)],
    );
    expect(unsupported.audit.failure_stage).toBe('answer_validation');
    expect(unsupported.rejected_answers[0]?.code).toBe('unsupported_field');
    expect(unsupported.amendments).toEqual([]);
  });

  it('accepts an unanswered required-information question in a valid runtime plan', () => {
    const record = validPersonAExtraction();
    const requiredInformation = requiredInformationQuestion(record);
    const result = apply(record, [requiredInformation], []);
    expect(result.audit.final_status).toBe('passed');
    expect(
      result.stage_statuses.find((stage) => stage.stage === 'runtime_plan_validation'),
    ).toEqual(expect.objectContaining({ status: 'passed', errors: [] }));
    expect(result.amendments).toEqual([]);
  });

  it('applies a date answer when the same plan contains an unanswered required-information question', () => {
    const { record, target, issued } = dateCase();
    const requiredInformation = requiredInformationQuestion(record, 'clarification_02');
    const submitted = {
      start: '2026-04-25',
      end: null,
      precision: 'day',
      approximate: false,
    };
    const result = apply(
      record,
      [issued, requiredInformation],
      [answer(issued, record, submitted)],
    );
    expect(result.audit.final_status).toBe('passed');
    expect(findObject(result.amended_record!, target.event_id).date).toEqual(submitted);
  });

  it('applies an evidence answer when the same plan contains an unanswered required-information question', () => {
    const { record, target, issued } = evidenceCase();
    const requiredInformation = requiredInformationQuestion(record, 'clarification_02');
    const result = apply(
      record,
      [issued, requiredInformation],
      [answer(issued, record, 'unavailable')],
    );
    expect(result.audit.final_status).toBe('passed');
    expect(findObject(result.amended_record!, target.evidence_id).availability_status).toBe(
      'unavailable',
    );
  });

  it('rejects only a submitted required-information answer as unsupported', () => {
    const record = validPersonAExtraction();
    const requiredInformation = requiredInformationQuestion(record);
    const before = JSON.stringify(record);
    const result = apply(
      record,
      [requiredInformation],
      [requiredInformationAnswer(requiredInformation)],
    );
    expect(result.audit.failure_stage).toBe('answer_validation');
    expect(result.rejected_answers).toEqual([
      expect.objectContaining({
        answer_id: 'answer_02',
        question_id: requiredInformation.question_id,
        code: 'unsupported_field',
      }),
    ]);
    expect(result.amendments).toEqual([]);
    expect(JSON.stringify(result.amended_record)).toBe(before);
  });

  it('rejects a mixed batch atomically when a required-information answer is submitted', () => {
    const { record, issued } = evidenceCase();
    const requiredInformation = requiredInformationQuestion(record, 'clarification_02');
    const validEvidence = answer(issued, record, 'unavailable');
    const unsupported = requiredInformationAnswer(requiredInformation);
    const before = JSON.stringify(record);
    const result = apply(record, [issued, requiredInformation], [validEvidence, unsupported]);
    const repeated = apply(record, [issued, requiredInformation], [validEvidence, unsupported]);
    expect(result.audit.failure_stage).toBe('answer_validation');
    expect(result.rejected_answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          answer_id: validEvidence.answer_id,
          code: 'atomic_batch_rejected',
        }),
        expect.objectContaining({
          answer_id: unsupported.answer_id,
          code: 'unsupported_field',
        }),
      ]),
    );
    expect(result.amendments).toEqual([]);
    expect(JSON.stringify(result.amended_record)).toBe(before);
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(result));
  });

  it('still rejects genuinely incompatible required-information questions', () => {
    const { record, target, issued } = evidenceCase();
    const incompatible = question({
      question_id: 'clarification_02',
      target_object_id: target.evidence_id,
      target_family: 'evidence',
      field: 'required_information',
      trigger: 'required_bucket_missing',
      grounding_references: issued.grounding_references,
    });
    const result = apply(record, [incompatible], []);
    expect(result.audit.failure_stage).toBe('runtime_plan_validation');
    expect(result.rejected_answers[0]?.code).toBe('invalid_runtime_plan');
  });

  it('accepts the dry-run static-assessment fixture plan', () => {
    const extraction = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'src/fixtures/dry_run_001.person_a.saved_v3.extraction.json'),
        'utf8',
      ),
    );
    const assessmentFixture = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'src/fixtures/dry_run_001.person_a.runtime_assessments.json'),
        'utf8',
      ),
    );
    const plan = orchestratePersonAPlanning({
      extraction,
      narrative: extraction.submission.raw_text,
      assessmentProvider: createStaticRuntimeAssessmentProvider(assessmentFixture.assessments),
    });
    expect(
      plan.generated_questions.some(
        (candidate) =>
          candidate.target_family === 'extraction_issues' &&
          candidate.field === 'required_information',
      ),
    ).toBe(true);
    const result = applyPersonAClarificationAnswers({
      baseline: plan.repaired_extraction,
      runtimePlan: plan,
      answers: [],
    });
    expect(result.audit.final_status).toBe('passed');
    expect(
      result.stage_statuses.find((stage) => stage.stage === 'runtime_plan_validation'),
    ).toEqual(expect.objectContaining({ status: 'passed', errors: [] }));
  });

  it('fails closed on hostile top-level accessors without invoking them', () => {
    const getter = vi.fn(() => {
      throw new Error('must not run');
    });
    const input = {} as PersonAClarificationAnswerApplicationInput;
    Object.defineProperty(input, 'baseline', { enumerable: true, get: getter });
    const result = applyPersonAClarificationAnswers(input);
    expect(result.audit.failure_stage).toBe('input_snapshot');
    expect(result.rejected_answers[0]?.code).toBe('malformed_json');
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects malformed date precision and invented date components', () => {
    const { record, issued } = dateCase();
    const malformed = {
      start: '2026-04-26',
      end: null,
      precision: 'day',
      approximate: false,
    };
    expect(
      apply(record, [issued], [answer(issued, record, malformed)]).rejected_answers[0]?.code,
    ).toBe('invalid_date_precision');
  });

  it('attributes an invalid date to its exact answer in an atomic mixed batch', () => {
    const actor = actorCase();
    const date = dateCase();
    const record = actor.record;
    const dateTarget = record.timeline.find(
      (item: JsonObject) => item.event_id === date.target.event_id,
    );
    dateTarget.date = { start: null, end: null, precision: 'unknown', approximate: false };
    const dateQuestion = question({
      ...date.issued,
      question_id: 'clarification_02',
      grounding_references: [
        sourceReference(
          dateTarget.event_id,
          dateTarget.source_spans.find((span: JsonObject) => /April 25/u.test(span.quote)),
        ),
      ],
    });
    const validActor = answer(actor.issued, record, 'party_a');
    const invalidDate = answer(
      dateQuestion,
      record,
      {
        start: '2026-04-26',
        end: null,
        precision: 'day',
        approximate: false,
      },
      { answer_id: 'answer_02' },
    );
    const result = apply(record, [actor.issued, dateQuestion], [validActor, invalidDate]);
    expect(result.audit.failure_stage).toBe('answer_validation');
    expect(result.amendments).toEqual([]);
    expect(result.rejected_answers).toHaveLength(2);
    expect(
      result.rejected_answers.every(
        (rejection) => rejection.answer_id !== null && rejection.question_id !== null,
      ),
    ).toBe(true);
    expect(result.rejected_answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          answer_id: 'answer_01',
          question_id: actor.issued.question_id,
          code: 'atomic_batch_rejected',
        }),
        expect.objectContaining({
          answer_id: 'answer_02',
          question_id: dateQuestion.question_id,
          code: 'invalid_date_precision',
        }),
      ]),
    );
    expect(result.rejected_answers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ answer_id: 'answer_02', code: 'atomic_batch_rejected' }),
      ]),
    );
  });

  it('rejects an invalid actor reference', () => {
    const { record, issued } = actorCase();
    expect(
      apply(record, [issued], [answer(issued, record, 'party_c')]).rejected_answers[0]?.code,
    ).toBe('invalid_actor_reference');
  });

  it('rejects evidence answers that claim inspection or verification', () => {
    const { record, issued } = evidenceCase();
    expect(
      apply(record, [issued], [answer(issued, record, 'inspected')]).rejected_answers[0]?.code,
    ).toBe('invalid_evidence_availability');
  });

  it('rejects the whole batch atomically when one answer is invalid', () => {
    const actor = actorCase();
    const evidence = evidenceCase();
    const record = actor.record;
    const evidenceTarget = record.evidence.find(
      (item: JsonObject) => item.availability_status === 'described_only',
    );
    const evidenceQuestion = question({
      ...evidence.issued,
      question_id: 'clarification_02',
      target_object_id: evidenceTarget.evidence_id,
      grounding_references: [
        extractedReference(
          evidenceTarget.evidence_id,
          'availability_status',
          evidenceTarget.availability_status,
        ),
      ],
    });
    const valid = answer(actor.issued, record, 'party_a');
    const invalid = answer(evidenceQuestion, record, 'inspected', { answer_id: 'answer_02' });
    const before = JSON.stringify(record);
    const result = apply(record, [actor.issued, evidenceQuestion], [valid, invalid]);
    expect(result.audit.final_status).toBe('failed_closed');
    expect(result.amendments).toEqual([]);
    expect(result.validated_answers).toEqual([]);
    expect(result.amended_record_hash).toBe(result.repaired_baseline_hash);
    expect(JSON.stringify(result.amended_record)).toBe(before);
    expect(result.rejected_answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ answer_id: 'answer_01', code: 'atomic_batch_rejected' }),
        expect.objectContaining({ answer_id: 'answer_02', code: 'invalid_evidence_availability' }),
      ]),
    );
  });

  it('rejects stale prior values', () => {
    const { record, issued } = actorCase();
    const submitted = answer(issued, record, 'party_a', { prior_value: 'party_b' });
    expect(apply(record, [issued], [submitted]).rejected_answers[0]?.code).toBe(
      'stale_prior_value',
    );
  });

  it('returns an amended record that passes schema and invariants', () => {
    const { record, issued } = actorCase();
    const result = apply(record, [issued], [answer(issued, record, 'party_a')]);
    const validation = validatePersonAExtraction(
      result.amended_record,
      record.submission.raw_text as string,
    );
    expect(validation.valid).toBe(true);
    expect(result.amended_record_hash).not.toBe(result.repaired_baseline_hash);
  });

  it('produces byte-identical repeated output and detached JSON', () => {
    const { record, issued } = actorCase();
    const submitted = answer(issued, record, 'party_a');
    const first = apply(record, [issued], [submitted]);
    submitted.submitted_answer = 'party_b';
    record.timeline[0].actor_party_id = 'party_b';
    const secondCase = actorCase();
    const second = apply(
      secondCase.record,
      [secondCase.issued],
      [answer(secondCase.issued, secondCase.record, 'party_a')],
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(findObject(first.amended_record!, issued.target_object_id).actor_party_id).toBe(
      'party_a',
    );
  });

  it('rejects more than six answers', () => {
    const { record, issued } = actorCase();
    const answers = Array.from({ length: 7 }, (_, index) =>
      answer(issued, record, 'party_a', {
        answer_id: `answer_0${index + 1}`,
        question_id: `clarification_0${index + 1}`,
      }),
    );
    const result = apply(record, [issued], answers);
    expect(result.audit.final_status).toBe('failed_closed');
    expect(result.rejected_answers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'answer_limit_exceeded' })]),
    );
    expect(result.amendments).toEqual([]);
  });

  it('uses no prohibited runtime dependencies', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/runtime/person-a-clarification-answer-application.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /(?:golden|evaluation|alignment|openai|process\.env|fetch\(|axios|database|person_b|deliberation|recommendation)/iu,
    );
  });
});

describe('Person A clarification answer CLI', () => {
  const argv = [
    '--runtime-plan',
    'runtime-plan.json',
    '--answers',
    'answers.json',
    '--output-dir',
    'output',
  ];

  it('strictly rejects unknown, duplicate, missing, and short options before I/O', async () => {
    for (const invalid of [
      [...argv, '--network', 'yes'],
      [...argv, '--answers', 'again.json'],
      ['--runtime-plan'],
      ['-r', 'runtime-plan.json'],
    ]) {
      const readText = vi.fn<ApplyPersonAClarificationsCommandDependencies['readText']>();
      await expect(
        runApplyPersonAClarificationsCommand(invalid, {
          readText,
          writeText: vi.fn(),
          makeDirectory: vi.fn(),
          apply: vi.fn(),
        }),
      ).rejects.toThrow();
      expect(readText).not.toHaveBeenCalled();
    }
  });

  it('parses the documented offline invocation', () => {
    expect(parseApplyPersonAClarificationsArgs(argv)).toMatchObject({
      runtimePlan: expect.stringMatching(/runtime-plan\.json$/u),
      answers: expect.stringMatching(/answers\.json$/u),
      outputDir: expect.stringMatching(/output$/u),
    });
  });

  it('writes exactly six deterministic answer-application artifacts', async () => {
    const { record, issued } = actorCase();
    const plan = runtimePlan(record, [issued]);
    const batch = {
      version: PERSON_A_CLARIFICATION_ANSWER_BATCH_VERSION,
      answers: [answer(issued, record, 'party_a')],
      options: {},
    };
    const writes = new Map<string, string>();
    const result = await runApplyPersonAClarificationsCommand(argv, {
      readText: vi.fn(async (path: string) =>
        path.endsWith('runtime-plan.json') ? JSON.stringify(plan) : JSON.stringify(batch),
      ),
      writeText: vi.fn(async (path: string, contents: string) => {
        writes.set(path, contents);
      }),
      makeDirectory: vi.fn(async () => undefined),
      apply: applyPersonAClarificationAnswers,
    });
    expect(result.audit.final_status).toBe('passed');
    expect([...writes.keys()].map((path) => path.split('/').at(-1)).sort()).toEqual([
      'amended-person-a.json',
      'amendments.json',
      'answer-application-audit.json',
      'runtime-answer-result.json',
      'submitted-answers.json',
      'validated-answers.json',
    ]);
    for (const contents of writes.values()) expect(contents.endsWith('\n')).toBe(true);
  });
});
