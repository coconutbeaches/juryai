import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { familyItems, type PersonAFamily } from '../alignment/person-a-alignment-corrected.js';
import { projectAmendments, type ClarificationAmendment } from './question-generator.js';
import type { NecessaryClarificationQuestion } from './question-necessity.js';
import type { PersonAEvaluationReport } from '../evaluation/person-a-diff-corrected.js';

type JsonObject = Record<string, any>;

export const CLARIFICATION_ROUND_VERSION = 'person-a-clarification-round-v0.1.0';

export type ClarificationGroundingReference = {
  source: 'golden_fixture' | 'person_a_narrative';
  object_id?: string;
  field?: string;
  submission_id?: string;
  quote?: string;
  start_char?: number;
  end_char?: number;
};

export type ClarificationAnswer = {
  amendment_id: string;
  question_id: string;
  target_object_id: string;
  field: string;
  response_text: string;
  prior_value: unknown;
  new_value: unknown;
  created_at: string;
  phase: 'post_lock_amendment';
  supersedes: string | null;
  grounding: ClarificationGroundingReference[];
  synthetic_golden_test_data: boolean;
  fully_resolves_question: boolean;
};

export type ClarificationRoundIssueCode =
  | 'answer_limit_exceeded'
  | 'duplicate_amendment_id'
  | 'duplicate_question_answer'
  | 'invalid_answer'
  | 'invalid_grounding'
  | 'malformed_timestamp'
  | 'missing_question'
  | 'stale_prior_value'
  | 'unsafe_or_unknown_field'
  | 'unsupported_new_value'
  | 'wrong_question_target';

export type ClarificationRoundIssue = {
  amendment_id: string | null;
  question_id: string | null;
  code: ClarificationRoundIssueCode;
  message: string;
};

export type ClarificationRoundAuditSummary = {
  version: typeof CLARIFICATION_ROUND_VERSION;
  answers_submitted: number;
  answers_applied: number;
  answers_rejected: number;
  questions_total: number;
  questions_answered: number;
  questions_unresolved: number;
  objects_changed: string[];
  synthetic_golden_test_answers_applied: number;
};

export type ClarificationRoundResult = {
  original: JsonObject;
  projected_effective_record: JsonObject;
  applied_amendments: ClarificationAmendment[];
  rejected_amendments: ClarificationRoundIssue[];
  unresolved_questions: NecessaryClarificationQuestion[];
  audit_summary: ClarificationRoundAuditSummary;
};

export type BeforeAfterSummary = {
  version: typeof CLARIFICATION_ROUND_VERSION;
  critical: { before: number; after: number };
  major: { before: number; after: number };
  minor: { before: number; after: number };
  human_edit_rate: { before: number; after: number };
  weighted_error_rate: { before: number; after: number };
  per_family: Record<
    PersonAFamily,
    {
      precision: { before: number; after: number };
      recall: { before: number; after: number };
    }
  >;
  questions_answered: number;
  questions_unresolved: number;
  objects_changed: string[];
  original_extraction_hash: string;
  clarified_extraction_hash: string;
};

const families: PersonAFamily[] = [
  'agreement_terms',
  'deliverables',
  'timeline',
  'claims',
  'evidence',
  'damages',
  'outcomes',
  'third_parties',
  'extraction_issues',
  'clarification_questions',
];

const familyIdFields: Record<PersonAFamily, string> = {
  agreement_terms: 'term_id',
  deliverables: 'deliverable_id',
  timeline: 'event_id',
  claims: 'claim_id',
  evidence: 'evidence_id',
  damages: 'damages_claim_id',
  outcomes: 'outcome_id',
  third_parties: 'third_party_id',
  extraction_issues: 'issue_id',
  clarification_questions: 'question_id',
};

const answerFields = new Set([
  'amendment_id',
  'question_id',
  'target_object_id',
  'field',
  'response_text',
  'prior_value',
  'new_value',
  'created_at',
  'phase',
  'supersedes',
  'grounding',
  'synthetic_golden_test_data',
  'fully_resolves_question',
]);

const unsafeFields = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'object_id',
  'source_spans',
  'submission_id',
  'raw_text',
  'content_hash',
  'metadata',
]);

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]+$/u.test(value) && value.length <= 160;
}

function lexicalCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(lexicalCompare)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashExtraction(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function isRfc3339Utc(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/u.exec(value);
  if (!match) return false;
  const milliseconds = (match[2] ?? '').padEnd(3, '0');
  const canonical = `${match[1]}.${milliseconds || '000'}Z`;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === canonical;
}

function issue(
  value: unknown,
  code: ClarificationRoundIssueCode,
  message: string,
): ClarificationRoundIssue {
  return {
    amendment_id: isRecord(value) && isIdentifier(value.amendment_id) ? value.amendment_id : null,
    question_id: isRecord(value) && isIdentifier(value.question_id) ? value.question_id : null,
    code,
    message,
  };
}

function compareIssues(left: ClarificationRoundIssue, right: ClarificationRoundIssue): number {
  return (
    lexicalCompare(left.amendment_id ?? '', right.amendment_id ?? '') ||
    lexicalCompare(left.question_id ?? '', right.question_id ?? '') ||
    lexicalCompare(left.code, right.code) ||
    lexicalCompare(left.message, right.message)
  );
}

function compareAmendments(left: ClarificationAmendment, right: ClarificationAmendment): number {
  return (
    Date.parse(left.created_at) - Date.parse(right.created_at) ||
    lexicalCompare(left.amendment_id, right.amendment_id)
  );
}

function buildObjectIndex(record: unknown): Map<string, JsonObject> {
  if (!isRecord(record)) throw new TypeError('record must be an object');
  const result = new Map<string, JsonObject>();
  for (const family of families) {
    const items = familyItems(record, family);
    if (!Array.isArray(items)) throw new TypeError(`${family} must be an array`);
    for (const item of items) {
      if (!isRecord(item)) throw new TypeError(`${family} item must be an object`);
      const id = item[familyIdFields[family]];
      if (!isIdentifier(id)) throw new TypeError(`${family} item has an invalid ID`);
      if (result.has(id)) throw new TypeError(`record contains duplicate object ID ${id}`);
      result.set(id, item);
    }
  }
  return result;
}

function validateQuestions(
  values: readonly unknown[],
): Map<string, NecessaryClarificationQuestion> {
  if (!Array.isArray(values)) throw new TypeError('questions must be an array');
  if (values.length > 6)
    throw new TypeError('a clarification round cannot contain more than six questions');
  const result = new Map<string, NecessaryClarificationQuestion>();
  values.forEach((value, index) => {
    if (
      !isRecord(value) ||
      !isIdentifier(value.question_id) ||
      !isIdentifier(value.target_object_id) ||
      !isIdentifier(value.field) ||
      !Array.isArray(value.resolves_object_ids)
    ) {
      throw new TypeError(`question[${index}] is malformed`);
    }
    if (result.has(value.question_id)) {
      throw new TypeError(`questions contain duplicate ID ${value.question_id}`);
    }
    result.set(value.question_id, value as NecessaryClarificationQuestion);
  });
  return result;
}

function parseAnswer(value: unknown): ClarificationAnswer | ClarificationRoundIssue {
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !answerFields.has(field)) ||
    !isIdentifier(value.amendment_id) ||
    !isIdentifier(value.question_id) ||
    !isIdentifier(value.target_object_id) ||
    !isIdentifier(value.field) ||
    typeof value.response_text !== 'string' ||
    value.response_text.trim().length === 0 ||
    value.response_text.length > 2000 ||
    value.phase !== 'post_lock_amendment' ||
    (value.supersedes !== null && !isIdentifier(value.supersedes)) ||
    !Array.isArray(value.grounding) ||
    typeof value.synthetic_golden_test_data !== 'boolean' ||
    typeof value.fully_resolves_question !== 'boolean'
  ) {
    return issue(value, 'invalid_answer', 'answer does not match the documented fixture contract');
  }
  if (typeof value.created_at !== 'string' || !isRfc3339Utc(value.created_at)) {
    return issue(value, 'malformed_timestamp', 'created_at must be a real RFC 3339 UTC timestamp');
  }
  return value as ClarificationAnswer;
}

function validateNarrativeGrounding(
  grounding: ClarificationGroundingReference,
  narrative: string,
): boolean {
  return (
    grounding.source === 'person_a_narrative' &&
    typeof grounding.submission_id === 'string' &&
    typeof grounding.quote === 'string' &&
    grounding.quote.length > 0 &&
    Number.isInteger(grounding.start_char) &&
    Number.isInteger(grounding.end_char) &&
    grounding.start_char! >= 0 &&
    grounding.end_char! - grounding.start_char! === grounding.quote.length &&
    narrative.slice(grounding.start_char, grounding.end_char) === grounding.quote
  );
}

function validateGoldenGrounding(
  grounding: ClarificationGroundingReference,
  goldenIndex: Map<string, JsonObject>,
  newValue: unknown,
): boolean {
  if (
    grounding.source !== 'golden_fixture' ||
    !isIdentifier(grounding.object_id) ||
    !isIdentifier(grounding.field)
  ) {
    return false;
  }
  const object = goldenIndex.get(grounding.object_id);
  return (
    object !== undefined &&
    Object.prototype.hasOwnProperty.call(object, grounding.field) &&
    isDeepStrictEqual(object[grounding.field], newValue)
  );
}

function permittedFields(question: NecessaryClarificationQuestion): Set<string> {
  switch (question.trigger) {
    case 'actor_attribution':
      return new Set(['actor_party_id', 'actor_third_party_id']);
    case 'causal_link':
      return new Set(['causal_theory']);
    case 'evidence_availability':
      return new Set(['availability_status']);
    case 'date_precision':
      return new Set(['date']);
    case 'merge_risk':
      return new Set(['claim_text', 'description', 'event_summary', 'name', 'scope_status']);
    case 'required_bucket_missing':
      return new Set([
        'claim_text',
        'completion_status_person_a',
        'description',
        'event_summary',
        'person_a_interpretation',
        'resolution_status',
        'scope_status',
        'wording',
      ]);
  }
}

function isUnsafeField(field: string, question: NecessaryClarificationQuestion): boolean {
  if (
    question.trigger === 'actor_attribution' &&
    (field === 'actor_party_id' || field === 'actor_third_party_id')
  ) {
    return false;
  }
  return (
    unsafeFields.has(field) ||
    field.endsWith('_id') ||
    field.endsWith('_ids') ||
    field.startsWith('source_')
  );
}

export function applyClarificationRound(options: {
  extraction: unknown;
  questions: readonly unknown[];
  answers: readonly unknown[];
  goldenFixture: unknown;
  narrative: string;
}): ClarificationRoundResult {
  if (!Array.isArray(options.answers)) throw new TypeError('answers must be an array');
  if (typeof options.narrative !== 'string') throw new TypeError('narrative must be a string');
  if (!isRecord(options.extraction)) throw new TypeError('extraction must be an object');

  const original = structuredClone(options.extraction);
  const originalSnapshot = stableJson(options.extraction);
  const projected = structuredClone(options.extraction);
  const questionIndex = validateQuestions(options.questions);
  const projectedIndex = buildObjectIndex(projected);
  const goldenIndex = buildObjectIndex(options.goldenFixture);
  const rejected: ClarificationRoundIssue[] = [];

  if (options.answers.length > 6) {
    options.answers.forEach((answer) =>
      rejected.push(
        issue(
          answer,
          'answer_limit_exceeded',
          'a clarification round cannot apply more than six answers',
        ),
      ),
    );
    return {
      original,
      projected_effective_record: projected,
      applied_amendments: [],
      rejected_amendments: rejected.sort(compareIssues),
      unresolved_questions: [...questionIndex.values()],
      audit_summary: {
        version: CLARIFICATION_ROUND_VERSION,
        answers_submitted: options.answers.length,
        answers_applied: 0,
        answers_rejected: options.answers.length,
        questions_total: questionIndex.size,
        questions_answered: 0,
        questions_unresolved: questionIndex.size,
        objects_changed: [],
        synthetic_golden_test_answers_applied: 0,
      },
    };
  }

  const amendmentCounts = new Map<string, number>();
  const questionCounts = new Map<string, number>();
  for (const answer of options.answers) {
    if (isRecord(answer) && isIdentifier(answer.amendment_id)) {
      amendmentCounts.set(answer.amendment_id, (amendmentCounts.get(answer.amendment_id) ?? 0) + 1);
    }
    if (isRecord(answer) && isIdentifier(answer.question_id)) {
      questionCounts.set(answer.question_id, (questionCounts.get(answer.question_id) ?? 0) + 1);
    }
  }

  const accepted = new Map<
    string,
    { answer: ClarificationAnswer; amendment: ClarificationAmendment }
  >();
  for (const rawAnswer of options.answers) {
    const parsed = parseAnswer(rawAnswer);
    if ('code' in parsed) {
      rejected.push(parsed);
      continue;
    }
    if ((amendmentCounts.get(parsed.amendment_id) ?? 0) > 1) {
      rejected.push(
        issue(parsed, 'duplicate_amendment_id', 'duplicate amendment IDs are not auditable'),
      );
      continue;
    }
    if ((questionCounts.get(parsed.question_id) ?? 0) > 1) {
      rejected.push(
        issue(parsed, 'duplicate_question_answer', 'a question may have only one answer per round'),
      );
      continue;
    }
    const question = questionIndex.get(parsed.question_id);
    if (!question) {
      rejected.push(issue(parsed, 'missing_question', 'answer references a missing question'));
      continue;
    }
    const permittedTargets = new Set([question.target_object_id, ...question.resolves_object_ids]);
    if (!permittedTargets.has(parsed.target_object_id)) {
      rejected.push(
        issue(parsed, 'wrong_question_target', 'answer target is not covered by the question'),
      );
      continue;
    }
    const target = projectedIndex.get(parsed.target_object_id);
    if (
      !target ||
      isUnsafeField(parsed.field, question) ||
      !permittedFields(question).has(parsed.field) ||
      !Object.prototype.hasOwnProperty.call(target, parsed.field)
    ) {
      rejected.push(
        issue(parsed, 'unsafe_or_unknown_field', 'answer field is unsafe or absent on its target'),
      );
      continue;
    }
    if (parsed.grounding.length === 0) {
      rejected.push(issue(parsed, 'invalid_grounding', 'answer must include grounding'));
      continue;
    }
    const groundingValid = parsed.grounding.every((grounding) => {
      if (!isRecord(grounding)) return false;
      if (grounding.source === 'person_a_narrative') {
        return validateNarrativeGrounding(grounding, options.narrative);
      }
      if (grounding.source === 'golden_fixture') {
        return (
          isIdentifier(grounding.object_id) &&
          isIdentifier(grounding.field) &&
          goldenIndex.has(grounding.object_id) &&
          Object.prototype.hasOwnProperty.call(
            goldenIndex.get(grounding.object_id)!,
            grounding.field,
          )
        );
      }
      return false;
    });
    if (!groundingValid) {
      rejected.push(issue(parsed, 'invalid_grounding', 'answer grounding is malformed or absent'));
      continue;
    }
    if (
      !parsed.grounding.some((grounding) =>
        validateGoldenGrounding(grounding, goldenIndex, parsed.new_value),
      )
    ) {
      rejected.push(
        issue(
          parsed,
          'unsupported_new_value',
          'new_value must exactly match a cited golden fixture field',
        ),
      );
      continue;
    }
    accepted.set(parsed.amendment_id, {
      answer: parsed,
      amendment: {
        amendment_id: parsed.amendment_id,
        target_object_id: parsed.target_object_id,
        field: parsed.field,
        prior_value: structuredClone(parsed.prior_value),
        new_value: structuredClone(parsed.new_value),
        response_text: parsed.response_text,
        created_at: parsed.created_at,
        phase: parsed.phase,
        supersedes: parsed.supersedes,
      },
    });
  }

  const byTarget = new Map<string, ClarificationAmendment[]>();
  for (const { amendment } of accepted.values()) {
    const group = byTarget.get(amendment.target_object_id) ?? [];
    group.push(amendment);
    byTarget.set(amendment.target_object_id, group);
  }

  const applied: ClarificationAmendment[] = [];
  for (const [targetId, amendments] of [...byTarget.entries()].sort(([left], [right]) =>
    lexicalCompare(left, right),
  )) {
    const target = projectedIndex.get(targetId)!;
    const projection = projectAmendments(
      { object_id: targetId, ...structuredClone(target) },
      amendments,
    );
    for (const projectionIssue of projection.rejected) {
      const entry = accepted.get(projectionIssue.amendment_id ?? '');
      rejected.push(
        issue(
          entry?.answer,
          projectionIssue.code === 'stale_prior_value'
            ? 'stale_prior_value'
            : projectionIssue.code === 'immutable_or_unknown_field'
              ? 'unsafe_or_unknown_field'
              : 'invalid_answer',
          projectionIssue.message,
        ),
      );
    }
    for (const amendment of projection.applied) {
      target[amendment.field] = structuredClone(amendment.new_value);
      applied.push(structuredClone(amendment));
    }
  }
  applied.sort(compareAmendments);

  const appliedIds = new Set(applied.map((amendment) => amendment.amendment_id));
  const resolvedQuestionIds = new Set(
    [...accepted.values()]
      .filter(({ answer }) => appliedIds.has(answer.amendment_id) && answer.fully_resolves_question)
      .map(({ answer }) => answer.question_id),
  );
  const unresolvedQuestions = [...questionIndex.values()].filter(
    (question) => !resolvedQuestionIds.has(question.question_id),
  );
  const objectsChanged = [...new Set(applied.map((amendment) => amendment.target_object_id))].sort(
    lexicalCompare,
  );

  if (stableJson(options.extraction) !== originalSnapshot) {
    throw new Error('clarification projection mutated the original extraction');
  }

  return {
    original,
    projected_effective_record: projected,
    applied_amendments: applied,
    rejected_amendments: rejected.sort(compareIssues),
    unresolved_questions: unresolvedQuestions,
    audit_summary: {
      version: CLARIFICATION_ROUND_VERSION,
      answers_submitted: options.answers.length,
      answers_applied: applied.length,
      answers_rejected: rejected.length,
      questions_total: questionIndex.size,
      questions_answered: questionIndex.size - unresolvedQuestions.length,
      questions_unresolved: unresolvedQuestions.length,
      objects_changed: objectsChanged,
      synthetic_golden_test_answers_applied: [...accepted.values()].filter(
        ({ answer }) => appliedIds.has(answer.amendment_id) && answer.synthetic_golden_test_data,
      ).length,
    },
  };
}

export function buildBeforeAfterSummary(
  before: PersonAEvaluationReport,
  after: PersonAEvaluationReport,
  round: ClarificationRoundResult,
): BeforeAfterSummary {
  const perFamily = {} as BeforeAfterSummary['per_family'];
  for (const family of families) {
    perFamily[family] = {
      precision: {
        before: before.metrics[family].precision,
        after: after.metrics[family].precision,
      },
      recall: {
        before: before.metrics[family].recall,
        after: after.metrics[family].recall,
      },
    };
  }
  return {
    version: CLARIFICATION_ROUND_VERSION,
    critical: { before: before.summary.critical, after: after.summary.critical },
    major: { before: before.summary.major, after: after.summary.major },
    minor: { before: before.summary.minor, after: after.summary.minor },
    human_edit_rate: {
      before: before.summary.human_edit_rate,
      after: after.summary.human_edit_rate,
    },
    weighted_error_rate: {
      before: before.summary.weighted_error_rate,
      after: after.summary.weighted_error_rate,
    },
    per_family: perFamily,
    questions_answered: round.audit_summary.questions_answered,
    questions_unresolved: round.audit_summary.questions_unresolved,
    objects_changed: round.audit_summary.objects_changed,
    original_extraction_hash: hashExtraction(round.original),
    clarified_extraction_hash: hashExtraction(round.projected_effective_record),
  };
}
