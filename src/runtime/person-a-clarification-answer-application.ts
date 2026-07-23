import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  GroundingReference,
  NecessaryClarificationQuestion,
} from '../clarification/question-necessity.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';
import {
  PERSON_A_RUNTIME_ORCHESTRATION_VERSION,
  type PersonARuntimePlanningResult,
} from './person-a-runtime-orchestrator.js';

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export const PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION =
  'person-a-clarification-answer-application-v0.1.4';
export const PERSON_A_CLARIFICATION_ANSWER_BATCH_VERSION =
  'person-a-clarification-answer-batch-v0.1.0';
export const MAX_PERSON_A_CLARIFICATION_ANSWERS = 6;
export const MAX_PERSON_A_CLARIFICATION_ANSWER_TEXT_LENGTH = 2_000;
export const MAX_PERSON_A_CLARIFICATION_AUDIT_TEXT_LENGTH = 240;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_ARRAY_LENGTH = 5_000;
const MAX_JSON_OBJECT_KEYS = 250;
const MAX_JSON_NODES = 100_000;
const MAX_JSON_STRING_LENGTH = 1_000_000;

export type PersonAClarificationTargetFamily =
  | 'agreement_terms'
  | 'deliverables'
  | 'timeline'
  | 'claims'
  | 'evidence'
  | 'damages'
  | 'outcomes'
  | 'third_parties'
  | 'extraction_issues'
  | 'clarification_questions';

export interface SubmittedPersonAClarificationAnswer {
  answer_id: string;
  question_id: string;
  target_object_id: string;
  target_family: PersonAClarificationTargetFamily;
  field: string;
  prior_value: JsonValue;
  submitted_answer: JsonValue;
}

export interface ValidatedPersonAClarificationAnswer extends SubmittedPersonAClarificationAnswer {
  normalized_applied_field: string;
  normalized_applied_value: JsonValue;
}

export interface PersonAClarificationAmendment {
  amendment_id: string;
  amendment_sequence: number;
  question_id: string;
  target_object_id: string;
  target_family: PersonAClarificationTargetFamily;
  field: string;
  prior_value: JsonValue;
  submitted_answer: JsonValue;
  normalized_applied_value: JsonValue;
  source_type: 'person_a_clarification';
  created_at: string | null;
}

export type PersonAAnswerApplicationStageName =
  | 'input_snapshot'
  | 'runtime_plan_validation'
  | 'answer_validation'
  | 'amendment_projection'
  | 'amended_record_validation';

export type PersonAAnswerApplicationStageStatus =
  'not_started' | 'passed' | 'skipped' | 'failed_closed';

export interface PersonAAnswerApplicationStageResult {
  stage: PersonAAnswerApplicationStageName;
  status: PersonAAnswerApplicationStageStatus;
  errors: PersonAAnswerApplicationError[];
}

export type PersonAAnswerApplicationIssueCode =
  | 'already_applied_question'
  | 'answer_limit_exceeded'
  | 'atomic_batch_rejected'
  | 'contradiction_alternative_unsupported'
  | 'duplicate_answer_id'
  | 'duplicate_question_answer'
  | 'expired_question'
  | 'immutable_fact_conflict'
  | 'invalid_actor_reference'
  | 'invalid_answer'
  | 'invalid_causal_theory'
  | 'invalid_date_precision'
  | 'invalid_evidence_availability'
  | 'invalid_runtime_plan'
  | 'malformed_json'
  | 'no_value_change'
  | 'stale_prior_value'
  | 'suppressed_candidate'
  | 'unknown_question'
  | 'unsupported_field'
  | 'unsupported_target_family';

export interface PersonAAnswerApplicationError {
  code: PersonAAnswerApplicationIssueCode;
  message: string;
  answer_id: string | null;
  question_id: string | null;
}

export interface PersonAClarificationAnswerApplicationOptions {
  createdAt?: string;
  expiredQuestionIds?: readonly string[];
  alreadyAppliedQuestionIds?: readonly string[];
}

export interface PersonAClarificationAnswerApplicationInput {
  baseline: unknown;
  runtimePlan: unknown;
  answers: unknown;
  options?: PersonAClarificationAnswerApplicationOptions;
}

export interface PersonAClarificationAnswerApplicationAudit {
  version: typeof PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION;
  final_status: 'passed' | 'failed_closed';
  failure_stage: PersonAAnswerApplicationStageName | null;
  answers_submitted: number;
  answers_validated: number;
  answers_rejected: number;
  amendments_created: number;
  objects_changed: string[];
  original_extraction_unchanged: boolean;
  repaired_baseline_unchanged: boolean;
  created_at_injected: boolean;
  maximum_answers: typeof MAX_PERSON_A_CLARIFICATION_ANSWERS;
}

export interface PersonAClarificationAnswerApplicationResult {
  application_version: typeof PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION;
  original_extraction_hash: string | null;
  repaired_baseline_hash: string | null;
  amended_record: JsonObject | null;
  amended_record_hash: string | null;
  submitted_answers: JsonValue[];
  validated_answers: ValidatedPersonAClarificationAnswer[];
  amendments: PersonAClarificationAmendment[];
  rejected_answers: PersonAAnswerApplicationError[];
  stage_statuses: PersonAAnswerApplicationStageResult[];
  validation_errors: PersonAAnswerApplicationError[];
  audit: PersonAClarificationAnswerApplicationAudit;
}

interface IndexedObject {
  family: PersonAClarificationTargetFamily;
  item: JsonObject;
}

interface SnapshotContext {
  active: WeakSet<object>;
  nodes: number;
}

type SnapshotResult = { valid: true; clone: JsonValue } | { valid: false; reason: string };

const families: readonly PersonAClarificationTargetFamily[] = [
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

const familyIdFields: Record<PersonAClarificationTargetFamily, string> = {
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

const answerKeys = new Set([
  'answer_id',
  'question_id',
  'target_object_id',
  'target_family',
  'field',
  'prior_value',
  'submitted_answer',
]);

const optionKeys = new Set(['createdAt', 'expiredQuestionIds', 'alreadyAppliedQuestionIds']);
const applicationInputKeys = new Set(['baseline', 'runtimePlan', 'answers', 'options']);

const supportedFields: Readonly<
  Record<
    NecessaryClarificationQuestion['trigger'],
    readonly { family: PersonAClarificationTargetFamily; field: string }[]
  >
> = {
  actor_attribution: [
    { family: 'timeline', field: 'actor_party_id' },
    { family: 'timeline', field: 'actor_third_party_id' },
  ],
  date_precision: [{ family: 'timeline', field: 'date' }],
  evidence_availability: [{ family: 'evidence', field: 'availability_status' }],
  causal_link: [{ family: 'damages', field: 'causal_theory' }],
  required_bucket_missing: [
    { family: 'agreement_terms', field: 'person_a_interpretation' },
    { family: 'extraction_issues', field: 'description' },
  ],
  merge_risk: [{ family: 'extraction_issues', field: 'description' }],
};

const monthNumbers: Readonly<Record<string, number>> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};
const monthPattern =
  'January|February|March|April|May|June|July|August|September|October|November|December';

function lexicalCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function truncateText(
  value: string,
  maximum = MAX_PERSON_A_CLARIFICATION_AUDIT_TEXT_LENGTH,
): string {
  if (value.length <= maximum) return value;
  let prefix = value.slice(0, maximum - 1);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) prefix = prefix.slice(0, -1);
  return `${prefix}…`;
}

function safeMessage(error: unknown): string {
  try {
    return truncateText(error instanceof Error ? error.message : String(error));
  } catch {
    return 'Input could not be safely inspected.';
  }
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u.test(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAnswerApplicationError(
  value: JsonValue | PersonAAnswerApplicationError,
): value is PersonAAnswerApplicationError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

function snapshotJson(
  value: unknown,
  depth = 0,
  context: SnapshotContext = { active: new WeakSet(), nodes: 0 },
): SnapshotResult {
  context.nodes += 1;
  if (context.nodes > MAX_JSON_NODES) {
    return { valid: false, reason: `JSON input exceeds ${MAX_JSON_NODES} values.` };
  }
  if (depth > MAX_JSON_DEPTH) {
    return { valid: false, reason: `JSON input exceeds depth ${MAX_JSON_DEPTH}.` };
  }
  if (value === null || typeof value === 'boolean') return { valid: true, clone: value };
  if (typeof value === 'string') {
    return value.length <= MAX_JSON_STRING_LENGTH
      ? { valid: true, clone: value }
      : { valid: false, reason: `JSON string exceeds ${MAX_JSON_STRING_LENGTH} characters.` };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { valid: true, clone: value }
      : { valid: false, reason: 'JSON numbers must be finite.' };
  }
  if (typeof value !== 'object' || value === undefined) {
    return { valid: false, reason: `Unsupported JSON value type: ${typeof value}.` };
  }
  if (context.active.has(value))
    return { valid: false, reason: 'Cyclic JSON input is unsupported.' };

  let arrayValue: boolean;
  let prototype: object | null;
  let keys: (string | symbol)[];
  try {
    arrayValue = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    return { valid: false, reason: safeMessage(error) };
  }
  if (
    arrayValue
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) {
    return { valid: false, reason: 'JSON input must use plain object and array prototypes.' };
  }
  if (keys.some((key) => typeof key === 'symbol')) {
    return { valid: false, reason: 'Symbol-keyed JSON input is unsupported.' };
  }
  const stringKeys = keys as string[];
  if (!arrayValue && stringKeys.length > MAX_JSON_OBJECT_KEYS) {
    return { valid: false, reason: `JSON object exceeds ${MAX_JSON_OBJECT_KEYS} own keys.` };
  }

  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  } catch (error) {
    return { valid: false, reason: safeMessage(error) };
  }
  const descriptorKeys = Object.keys(descriptors);
  if (
    descriptorKeys.length !== stringKeys.length ||
    descriptorKeys.some((key) => !stringKeys.includes(key))
  ) {
    return { valid: false, reason: 'JSON input shape changed during inspection.' };
  }
  if (Object.values(descriptors).some((descriptor) => !('value' in descriptor))) {
    return { valid: false, reason: 'Accessor-backed JSON properties are unsupported.' };
  }

  context.active.add(value);
  try {
    if (arrayValue) {
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || !('value' in lengthDescriptor)) {
        return { valid: false, reason: 'Array length descriptor is invalid.' };
      }
      const length = lengthDescriptor.value;
      if (!Number.isInteger(length) || length < 0 || length > MAX_JSON_ARRAY_LENGTH) {
        return { valid: false, reason: `JSON array exceeds ${MAX_JSON_ARRAY_LENGTH} entries.` };
      }
      const numericKeys = stringKeys.filter((key) => key !== 'length');
      if (
        numericKeys.length !== length ||
        numericKeys.some((key) => !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length)
      ) {
        return { valid: false, reason: 'JSON arrays must be dense and unextended.' };
      }
      const clone: JsonValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor)) {
          return { valid: false, reason: 'JSON arrays must not contain holes.' };
        }
        const child = snapshotJson(descriptor.value, depth + 1, context);
        if (!child.valid) return child;
        clone.push(child.clone);
      }
      return { valid: true, clone };
    }

    const clone: JsonObject = {};
    for (const key of stringKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return { valid: false, reason: 'JSON object properties must be enumerable data values.' };
      }
      const child = snapshotJson(descriptor.value, depth + 1, context);
      if (!child.valid) return child;
      Object.defineProperty(clone, key, {
        value: child.clone,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return { valid: true, clone };
  } finally {
    context.active.delete(value);
  }
}

function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort(lexicalCompare)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashPersonAClarificationArtifact(value: JsonValue): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function boundedError(
  code: PersonAAnswerApplicationIssueCode,
  message: string,
  answer?: Partial<SubmittedPersonAClarificationAnswer>,
): PersonAAnswerApplicationError {
  return {
    code,
    message: truncateText(message),
    answer_id: isIdentifier(answer?.answer_id) ? answer.answer_id : null,
    question_id: isIdentifier(answer?.question_id) ? answer.question_id : null,
  };
}

function compareErrors(
  left: PersonAAnswerApplicationError,
  right: PersonAAnswerApplicationError,
): number {
  return (
    lexicalCompare(left.question_id ?? '', right.question_id ?? '') ||
    lexicalCompare(left.answer_id ?? '', right.answer_id ?? '') ||
    lexicalCompare(left.code, right.code) ||
    lexicalCompare(left.message, right.message)
  );
}

function familyItems(record: JsonObject, family: PersonAClarificationTargetFamily): JsonValue[] {
  switch (family) {
    case 'agreement_terms': {
      const agreement = record.agreement;
      return isJsonObject(agreement) && Array.isArray(agreement.terms) ? agreement.terms : [];
    }
    case 'deliverables':
      return Array.isArray(record.deliverable_assessments) ? record.deliverable_assessments : [];
    case 'timeline':
    case 'claims':
    case 'evidence':
    case 'third_parties':
    case 'extraction_issues':
    case 'clarification_questions':
      return Array.isArray(record[family]) ? record[family] : [];
    case 'damages':
      return Array.isArray(record.damages_claims) ? record.damages_claims : [];
    case 'outcomes': {
      const desiredOutcomes = record.desired_outcomes;
      return isJsonObject(desiredOutcomes) && Array.isArray(desiredOutcomes.outcomes)
        ? desiredOutcomes.outcomes
        : [];
    }
  }
}

function buildObjectIndex(record: JsonObject): Map<string, IndexedObject> {
  const index = new Map<string, IndexedObject>();
  for (const family of families) {
    for (const value of familyItems(record, family)) {
      if (!isJsonObject(value)) throw new TypeError(`${family} must contain only objects.`);
      const id = value[familyIdFields[family]];
      if (!isIdentifier(id)) throw new TypeError(`${family} contains an invalid object ID.`);
      if (index.has(id)) throw new TypeError(`Duplicate object ID: ${id}.`);
      index.set(id, { family, item: value });
    }
  }
  return index;
}

function isRfc3339Utc(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/u.exec(value);
  if (!match) return false;
  const milliseconds = (match[2] ?? '').padEnd(3, '0');
  const parsed = new Date(value);
  return (
    Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString() === `${match[1]}.${milliseconds || '000'}Z`
  );
}

function parseIdSet(value: unknown, label: string): Set<string> {
  if (value === undefined) return new Set();
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const result = new Set<string>();
  for (const item of value) {
    if (!isIdentifier(item)) throw new TypeError(`${label} contains an invalid identifier.`);
    if (result.has(item)) throw new TypeError(`${label} contains duplicate identifiers.`);
    result.add(item);
  }
  return result;
}

function exactSourceGrounding(
  reference: GroundingReference,
  objectIndex: ReadonlyMap<string, IndexedObject>,
  narrative: string,
): boolean {
  if (reference.kind === 'source_span') {
    const indexed = objectIndex.get(reference.object_id);
    const ownedSpans = indexed?.item.source_spans;
    return (
      indexed !== undefined &&
      Array.isArray(ownedSpans) &&
      ownedSpans.some(
        (span) =>
          isJsonObject(span) &&
          span.submission_id === reference.submission_id &&
          span.quote === reference.quote &&
          span.start_char === reference.start_char &&
          span.end_char === reference.end_char,
      ) &&
      Number.isInteger(reference.start_char) &&
      Number.isInteger(reference.end_char) &&
      reference.start_char >= 0 &&
      reference.end_char - reference.start_char === reference.quote.length &&
      narrative.slice(reference.start_char, reference.end_char) === reference.quote
    );
  }
  const indexed = objectIndex.get(reference.object_id);
  return (
    indexed !== undefined &&
    Object.prototype.hasOwnProperty.call(indexed.item, reference.field) &&
    isDeepStrictEqual(indexed.item[reference.field], reference.value)
  );
}

function canonicalQuestionTargetField(
  targetFamily: string,
  trigger: string,
  field: string,
): string {
  return targetFamily === 'timeline' &&
    trigger === 'actor_attribution' &&
    ['actor_party_id', 'actor_third_party_id'].includes(field)
    ? 'actor_slot'
    : field;
}

function validateQuestions(
  runtimePlan: JsonObject,
  objectIndex: ReadonlyMap<string, IndexedObject>,
  narrative: string,
): NecessaryClarificationQuestion[] {
  const values = runtimePlan.generated_questions;
  if (!Array.isArray(values) || values.length > MAX_PERSON_A_CLARIFICATION_ANSWERS) {
    throw new TypeError('Runtime plan generated_questions must be an array of at most six items.');
  }
  if (runtimePlan.question_count !== values.length) {
    throw new TypeError('Runtime plan question_count is inconsistent with generated_questions.');
  }
  const ids = new Set<string>();
  const targetFields = new Set<string>();
  return values.map((value, index) => {
    if (
      !isJsonObject(value) ||
      !isIdentifier(value.question_id) ||
      !isIdentifier(value.target_object_id) ||
      typeof value.target_family !== 'string' ||
      !families.includes(value.target_family as PersonAClarificationTargetFamily) ||
      !isIdentifier(value.field) ||
      typeof value.trigger !== 'string' ||
      ![
        'actor_attribution',
        'causal_link',
        'merge_risk',
        'evidence_availability',
        'date_precision',
        'required_bucket_missing',
      ].includes(value.trigger) ||
      !['ask_human', 'contradiction'].includes(String(value.necessity_classification)) ||
      !Array.isArray(value.grounding_references) ||
      value.grounding_references.length === 0 ||
      !Array.isArray(value.contradiction_alternatives)
    ) {
      throw new TypeError(`Runtime question ${index} is malformed.`);
    }
    if (ids.has(value.question_id))
      throw new TypeError(`Duplicate question ID ${value.question_id}.`);
    ids.add(value.question_id);
    const targetFieldKey = `${value.target_object_id}|${canonicalQuestionTargetField(
      value.target_family,
      value.trigger,
      value.field,
    )}`;
    if (targetFields.has(targetFieldKey)) {
      throw new TypeError(`Runtime plan repeats target field ${targetFieldKey}.`);
    }
    targetFields.add(targetFieldKey);
    const indexed = objectIndex.get(value.target_object_id);
    if (!indexed || indexed.family !== value.target_family) {
      throw new TypeError(`Runtime question ${value.question_id} targets the wrong family.`);
    }
    const rule = supportedFields[value.trigger as NecessaryClarificationQuestion['trigger']];
    if (!rule.some((entry) => entry.family === indexed.family && entry.field === value.field)) {
      throw new TypeError(`Runtime question ${value.question_id} targets an unsupported field.`);
    }
    const grounding = value.grounding_references as unknown as GroundingReference[];
    if (!grounding.every((reference) => exactSourceGrounding(reference, objectIndex, narrative))) {
      throw new TypeError(`Runtime question ${value.question_id} has invalid grounding.`);
    }
    if (value.necessity_classification === 'contradiction') {
      const alternatives = value.contradiction_alternatives as unknown[];
      if (alternatives.length < 2) {
        throw new TypeError(`Contradiction question ${value.question_id} needs two alternatives.`);
      }
      for (const alternative of alternatives) {
        const alternativeObject = alternative as JsonObject;
        const alternativeGrounding = alternativeObject.grounding_references as unknown as
          GroundingReference[] | undefined;
        if (
          !isJsonObject(alternative as JsonValue) ||
          typeof alternativeObject.text !== 'string' ||
          !Array.isArray(alternativeGrounding) ||
          alternativeGrounding.length === 0 ||
          !alternativeGrounding.every(
            (reference) =>
              reference.kind === 'source_span' &&
              reference.quote === alternativeObject.text &&
              exactSourceGrounding(reference, objectIndex, narrative),
          )
        ) {
          throw new TypeError(
            `Contradiction question ${value.question_id} has malformed alternatives.`,
          );
        }
      }
    }
    return value as unknown as NecessaryClarificationQuestion;
  });
}

function parseAnswer(value: JsonValue, index: number): SubmittedPersonAClarificationAnswer {
  if (!isJsonObject(value) || Object.keys(value).some((key) => !answerKeys.has(key))) {
    throw new TypeError(`Answer ${index} must be a plain object with only documented fields.`);
  }
  if (
    !isIdentifier(value.answer_id) ||
    !isIdentifier(value.question_id) ||
    !isIdentifier(value.target_object_id) ||
    typeof value.target_family !== 'string' ||
    !families.includes(value.target_family as PersonAClarificationTargetFamily) ||
    !isIdentifier(value.field) ||
    !Object.prototype.hasOwnProperty.call(value, 'prior_value') ||
    !Object.prototype.hasOwnProperty.call(value, 'submitted_answer')
  ) {
    throw new TypeError(`Answer ${index} does not match the documented answer contract.`);
  }
  return value as unknown as SubmittedPersonAClarificationAnswer;
}

function sourceTexts(question: NecessaryClarificationQuestion): string[] {
  return question.grounding_references.flatMap((reference) =>
    reference.kind === 'source_span' ? [reference.quote] : [],
  );
}

interface DateMention {
  year: number | null;
  month: number;
  day: number | null;
}

function dateMentionsFromTexts(texts: readonly string[]): DateMention[] {
  const result: DateMention[] = [];
  const add = (year: number | null, month: number, day: number | null): void => {
    if (day === null) {
      if (
        Number.isInteger(month) &&
        month >= 1 &&
        month <= 12 &&
        (year === null || (Number.isInteger(year) && year >= 1 && year <= 9999))
      ) {
        result.push({ year, month, day });
      }
      return;
    }
    const validationYear = year ?? 2000;
    const date = new Date(Date.UTC(validationYear, month - 1, day));
    if (
      date.getUTCFullYear() === validationYear &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      result.push({ year, month, day });
    }
  };
  for (const text of texts) {
    for (const match of text.matchAll(
      new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?\\b`, 'giu'),
    )) {
      add(
        match[3] === undefined ? null : Number(match[3]),
        monthNumbers[match[1]!.toLowerCase()]!,
        Number(match[2]),
      );
    }
    for (const match of text.matchAll(
      new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})(?:\\s+(\\d{4}))?\\b`, 'giu'),
    )) {
      add(
        match[3] === undefined ? null : Number(match[3]),
        monthNumbers[match[2]!.toLowerCase()]!,
        Number(match[1]),
      );
    }
    for (const match of text.matchAll(
      new RegExp(
        `\\b(?:in|during|by|before|after|since|until|through|around)\\s+(${monthPattern})\\b(?!\\s*,?\\s*\\d)`,
        'giu',
      ),
    )) {
      add(null, monthNumbers[match[1]!.toLowerCase()]!, null);
    }
    for (const match of text.matchAll(
      new RegExp(
        `\\b(${monthPattern})\\s+(?:completion|date|deadline|launch|payment|period|schedule|timeline)\\b`,
        'giu',
      ),
    )) {
      add(null, monthNumbers[match[1]!.toLowerCase()]!, null);
    }
  }
  return [
    ...new Map(
      result.map((mention) => [
        `${mention.year ?? 'XXXX'}-${mention.month}-${mention.day ?? 'XX'}`,
        mention,
      ]),
    ).values(),
  ];
}

function targetDateMentions(
  question: NecessaryClarificationQuestion,
  target: JsonObject,
): DateMention[] {
  const sourceMentions = dateMentionsFromTexts(sourceTexts(question));
  const eventSummary = target.event_summary;
  const contextMentions =
    typeof eventSummary === 'string' ? dateMentionsFromTexts([eventSummary]) : [];
  if (contextMentions.length === 0) return sourceMentions;
  return sourceMentions.filter((sourceMention) =>
    contextMentions.some(
      (contextMention) =>
        contextMention.month === sourceMention.month &&
        contextMention.day === sourceMention.day &&
        (contextMention.year === null ||
          sourceMention.year === null ||
          contextMention.year === sourceMention.year),
    ),
  );
}

function parseIsoDate(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? { year, month, day }
    : null;
}

function normalizeDateAnswer(
  submitted: JsonValue,
  question: NecessaryClarificationQuestion,
  target: JsonObject,
): JsonValue | PersonAAnswerApplicationError {
  if (
    !isJsonObject(submitted) ||
    Object.keys(submitted).sort(lexicalCompare).join('|') !==
      ['approximate', 'end', 'precision', 'start'].sort(lexicalCompare).join('|') ||
    typeof submitted.approximate !== 'boolean' ||
    !['day', 'month', 'range'].includes(String(submitted.precision))
  ) {
    return boundedError(
      'invalid_date_precision',
      'Date answers must provide a source-grounded day, month, or range without extra fields.',
    );
  }
  const start = parseIsoDate(submitted.start);
  const end = submitted.end === null ? null : parseIsoDate(submitted.end);
  if (!start || (submitted.end !== null && !end)) {
    return boundedError('invalid_date_precision', 'Date answers must use real ISO calendar dates.');
  }
  const mentions = targetDateMentions(question, target);
  const matches = (date: { year: number; month: number; day: number }, mention: DateMention) =>
    mention.day !== null &&
    date.month === mention.month &&
    date.day === mention.day &&
    (mention.year === null || date.year === mention.year);
  if (submitted.precision === 'day') {
    const groundedDays = mentions.filter((mention) => mention.day !== null);
    if (
      end !== null ||
      submitted.approximate !== false ||
      groundedDays.length !== 1 ||
      !groundedDays.some((mention) => matches(start, mention))
    ) {
      return boundedError(
        'invalid_date_precision',
        'A day answer must preserve the exact grounded month and day and may add only the supplied year.',
      );
    }
  } else if (submitted.precision === 'month') {
    const groundedMonths = [
      ...new Map(
        mentions
          .filter((mention) => mention.day === null)
          .map((mention) => [`${mention.year ?? 'XXXX'}-${mention.month}`, mention]),
      ).values(),
    ];
    const groundedMonth = groundedMonths[0];
    const lastDay = new Date(Date.UTC(start.year, start.month, 0)).getUTCDate();
    if (
      end === null ||
      submitted.approximate !== true ||
      groundedMonths.length !== 1 ||
      groundedMonth === undefined ||
      start.month !== groundedMonth.month ||
      start.day !== 1 ||
      end.year !== start.year ||
      end.month !== start.month ||
      end.day !== lastDay ||
      (groundedMonth.year !== null && start.year !== groundedMonth.year)
    ) {
      return boundedError(
        'invalid_date_precision',
        'A month answer must preserve one grounded month as its exact first-to-last-day interval and may add only the supplied year.',
      );
    }
  } else if (
    end === null ||
    submitted.approximate !== true ||
    mentions.filter((mention) => mention.day !== null).length !== 2 ||
    !mentions.some((mention) => matches(start, mention)) ||
    !mentions.some((mention) => matches(end, mention)) ||
    start.year !== end.year ||
    String(submitted.start) > String(submitted.end)
  ) {
    return boundedError(
      'invalid_date_precision',
      'A range answer must preserve two grounded endpoints in one supplied year.',
    );
  }
  return submitted;
}

function normalizeAnswer(
  answer: SubmittedPersonAClarificationAnswer,
  question: NecessaryClarificationQuestion,
  objectIndex: ReadonlyMap<string, IndexedObject>,
): JsonValue | PersonAAnswerApplicationError {
  if (question.trigger === 'merge_risk') {
    return boundedError(
      'unsupported_field',
      'Aggregate splitting remains unsupported in schema v0.1.2.',
      answer,
    );
  }
  if (question.necessity_classification === 'contradiction') {
    if (typeof answer.submitted_answer !== 'string') {
      return boundedError(
        'contradiction_alternative_unsupported',
        'Contradiction answers must select one exact grounded alternative.',
        answer,
      );
    }
    const selected = question.contradiction_alternatives.find(
      (alternative) => alternative.text === answer.submitted_answer,
    );
    if (!selected) {
      return boundedError(
        'contradiction_alternative_unsupported',
        'Contradiction answers cannot introduce a third unsupported account.',
        answer,
      );
    }
    return question.trigger === 'causal_link'
      ? `Person A adopts this grounded account: ${selected.text}`
      : selected.text;
  }

  switch (question.trigger) {
    case 'actor_attribution': {
      if (typeof answer.submitted_answer !== 'string') {
        return boundedError('invalid_actor_reference', 'Actor answers must be stable IDs.', answer);
      }
      if (answer.field === 'actor_party_id') {
        const thirdParty = objectIndex.get(answer.submitted_answer);
        if (
          !['party_a', 'party_b'].includes(answer.submitted_answer) &&
          (!thirdParty || thirdParty.family !== 'third_parties')
        ) {
          return boundedError(
            'invalid_actor_reference',
            'Actor answers must resolve to party_a, party_b, or an existing third party.',
            answer,
          );
        }
      } else {
        const thirdParty = objectIndex.get(answer.submitted_answer);
        if (!thirdParty || thirdParty.family !== 'third_parties') {
          return boundedError(
            'invalid_actor_reference',
            'actor_third_party_id must resolve to an existing third party.',
            answer,
          );
        }
      }
      return answer.submitted_answer;
    }
    case 'date_precision': {
      const target = objectIndex.get(answer.target_object_id);
      return target
        ? normalizeDateAnswer(answer.submitted_answer, question, target.item)
        : boundedError(
            'unsupported_target_family',
            'Date clarification target is unavailable.',
            answer,
          );
    }
    case 'evidence_availability':
      return ['described_only', 'unavailable'].includes(String(answer.submitted_answer))
        ? answer.submitted_answer
        : boundedError(
            'invalid_evidence_availability',
            'Evidence clarification may only remain described_only or become unavailable; it cannot imply inspection or verification.',
            answer,
          );
    case 'causal_link': {
      if (
        typeof answer.submitted_answer !== 'string' ||
        answer.submitted_answer.trim().length === 0 ||
        answer.submitted_answer.length > MAX_PERSON_A_CLARIFICATION_ANSWER_TEXT_LENGTH ||
        /\b(?:adjudicated|court found|proved|verified as fact)\b/iu.test(answer.submitted_answer)
      ) {
        return boundedError(
          'invalid_causal_theory',
          'Causal answers must be bounded Person A assertions, not adjudicated facts.',
          answer,
        );
      }
      const text = answer.submitted_answer.trim().replace(/\s+/gu, ' ').replace(/[.]+$/u, '');
      return `Person A states that ${text[0]!.toLowerCase()}${text.slice(1)}.`;
    }
    case 'required_bucket_missing':
      if (
        question.target_family !== 'agreement_terms' ||
        question.field !== 'person_a_interpretation' ||
        typeof answer.submitted_answer !== 'string' ||
        answer.submitted_answer.trim().length === 0 ||
        answer.submitted_answer.length > MAX_PERSON_A_CLARIFICATION_ANSWER_TEXT_LENGTH
      ) {
        return boundedError(
          'unsupported_field',
          'Non-contradiction required-bucket answers may populate only nullable Person A interpretations.',
          answer,
        );
      }
      return answer.submitted_answer.trim().replace(/\s+/gu, ' ');
  }
}

function stageResults(): PersonAAnswerApplicationStageResult[] {
  return [
    'input_snapshot',
    'runtime_plan_validation',
    'answer_validation',
    'amendment_projection',
    'amended_record_validation',
  ].map((stage) => ({
    stage: stage as PersonAAnswerApplicationStageName,
    status: 'not_started',
    errors: [],
  }));
}

function markStage(
  stages: PersonAAnswerApplicationStageResult[],
  stage: PersonAAnswerApplicationStageName,
  status: PersonAAnswerApplicationStageStatus,
  errors: PersonAAnswerApplicationError[] = [],
): void {
  const entry = stages.find((candidate) => candidate.stage === stage)!;
  entry.status = status;
  entry.errors = errors;
}

function skipLaterStages(
  stages: PersonAAnswerApplicationStageResult[],
  failedStage: PersonAAnswerApplicationStageName,
): void {
  const failedIndex = stages.findIndex((stage) => stage.stage === failedStage);
  for (const stage of stages.slice(failedIndex + 1)) stage.status = 'skipped';
}

function emptyAudit(
  failureStage: PersonAAnswerApplicationStageName | null,
  answersSubmitted: number,
  options: PersonAClarificationAnswerApplicationOptions,
): PersonAClarificationAnswerApplicationAudit {
  return {
    version: PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION,
    final_status: failureStage === null ? 'passed' : 'failed_closed',
    failure_stage: failureStage,
    answers_submitted: answersSubmitted,
    answers_validated: 0,
    answers_rejected: 0,
    amendments_created: 0,
    objects_changed: [],
    original_extraction_unchanged: true,
    repaired_baseline_unchanged: true,
    created_at_injected: options.createdAt !== undefined,
    maximum_answers: MAX_PERSON_A_CLARIFICATION_ANSWERS,
  };
}

export function applyPersonAClarificationAnswers(
  input: PersonAClarificationAnswerApplicationInput,
): PersonAClarificationAnswerApplicationResult {
  const stages = stageResults();
  const inputSnapshot = snapshotJson(input);
  if (!inputSnapshot.valid || !isJsonObject(inputSnapshot.clone)) {
    const error = boundedError(
      'malformed_json',
      inputSnapshot.valid ? 'Application input must be a JSON object.' : inputSnapshot.reason,
    );
    markStage(stages, 'input_snapshot', 'failed_closed', [error]);
    skipLaterStages(stages, 'input_snapshot');
    const audit = emptyAudit('input_snapshot', 0, {});
    audit.answers_rejected = 1;
    return {
      application_version: PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION,
      original_extraction_hash: null,
      repaired_baseline_hash: null,
      amended_record: null,
      amended_record_hash: null,
      submitted_answers: [],
      validated_answers: [],
      amendments: [],
      rejected_answers: [error],
      stage_statuses: stages,
      validation_errors: [],
      audit,
    };
  }
  markStage(stages, 'input_snapshot', 'passed');

  const snapshot = inputSnapshot.clone;
  if (
    Object.keys(snapshot).some((key) => !applicationInputKeys.has(key)) ||
    !Object.prototype.hasOwnProperty.call(snapshot, 'baseline') ||
    !Object.prototype.hasOwnProperty.call(snapshot, 'runtimePlan') ||
    !Object.prototype.hasOwnProperty.call(snapshot, 'answers')
  ) {
    const error = boundedError(
      'malformed_json',
      'Application input must contain only baseline, runtimePlan, answers, and optional options.',
    );
    markStage(stages, 'input_snapshot', 'failed_closed', [error]);
    skipLaterStages(stages, 'input_snapshot');
    const audit = emptyAudit('input_snapshot', 0, {});
    audit.answers_rejected = 1;
    return {
      application_version: PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION,
      original_extraction_hash: null,
      repaired_baseline_hash: null,
      amended_record: null,
      amended_record_hash: null,
      submitted_answers: [],
      validated_answers: [],
      amendments: [],
      rejected_answers: [error],
      stage_statuses: stages,
      validation_errors: [],
      audit,
    };
  }
  const baseline = snapshot.baseline;
  const runtimePlan = snapshot.runtimePlan;
  const answerValues = snapshot.answers;
  const optionsValue = snapshot.options ?? {};
  const options: PersonAClarificationAnswerApplicationOptions = {};
  const submittedAnswers = Array.isArray(answerValues) ? answerValues : [];
  let baselineObject: JsonObject | null = isJsonObject(baseline) ? baseline : null;
  let runtimePlanObject: JsonObject | null = isJsonObject(runtimePlan) ? runtimePlan : null;
  let originalHash: string | null = null;
  let repairedHash: string | null = baselineObject
    ? hashPersonAClarificationArtifact(baselineObject)
    : null;
  let originalSnapshot: JsonValue | null = null;
  let baselineSnapshot: JsonValue | null = baselineObject;
  let questions: NecessaryClarificationQuestion[] = [];
  let objectIndex = new Map<string, IndexedObject>();
  let narrative = '';

  try {
    if (
      !baselineObject ||
      !runtimePlanObject ||
      !Array.isArray(answerValues) ||
      !isJsonObject(optionsValue)
    ) {
      throw new TypeError(
        'baseline, runtimePlan, answers, and options must be JSON objects/arrays.',
      );
    }
    if (Object.keys(optionsValue).some((key) => !optionKeys.has(key))) {
      throw new TypeError('options contains an unsupported field.');
    }
    if (Object.prototype.hasOwnProperty.call(optionsValue, 'createdAt')) {
      if (typeof optionsValue.createdAt !== 'string') {
        throw new TypeError('options.createdAt must be a string when provided.');
      }
      options.createdAt = optionsValue.createdAt;
    }
    if (Object.prototype.hasOwnProperty.call(optionsValue, 'expiredQuestionIds')) {
      if (!Array.isArray(optionsValue.expiredQuestionIds)) {
        throw new TypeError('options.expiredQuestionIds must be an array when provided.');
      }
      options.expiredQuestionIds = optionsValue.expiredQuestionIds as string[];
    }
    if (Object.prototype.hasOwnProperty.call(optionsValue, 'alreadyAppliedQuestionIds')) {
      if (!Array.isArray(optionsValue.alreadyAppliedQuestionIds)) {
        throw new TypeError('options.alreadyAppliedQuestionIds must be an array when provided.');
      }
      options.alreadyAppliedQuestionIds = optionsValue.alreadyAppliedQuestionIds as string[];
    }
    if (options.createdAt !== undefined && !isRfc3339Utc(options.createdAt)) {
      throw new TypeError('options.createdAt must be a real RFC 3339 UTC timestamp.');
    }
    parseIdSet(options.expiredQuestionIds, 'expiredQuestionIds');
    parseIdSet(options.alreadyAppliedQuestionIds, 'alreadyAppliedQuestionIds');
    if (
      runtimePlanObject.orchestration_version !== PERSON_A_RUNTIME_ORCHESTRATION_VERSION ||
      !isJsonObject(runtimePlanObject.audit_summary) ||
      runtimePlanObject.audit_summary.final_status !== 'passed' ||
      !isJsonObject(runtimePlanObject.original_extraction) ||
      !isJsonObject(runtimePlanObject.repaired_extraction) ||
      runtimePlanObject.repaired_extraction_hash !== repairedHash ||
      !isDeepStrictEqual(runtimePlanObject.repaired_extraction, baselineObject)
    ) {
      throw new TypeError('Runtime plan and repaired baseline are inconsistent or not passed.');
    }
    originalSnapshot = runtimePlanObject.original_extraction;
    originalHash = hashPersonAClarificationArtifact(originalSnapshot);
    if (runtimePlanObject.original_extraction_hash !== originalHash) {
      throw new TypeError('Runtime plan original extraction hash is inconsistent.');
    }
    const submission = baselineObject.submission;
    narrative =
      isJsonObject(submission) && typeof submission.raw_text === 'string'
        ? submission.raw_text
        : '';
    if (narrative.length === 0) throw new TypeError('Repaired baseline narrative is absent.');
    const originalValidation = validatePersonAExtraction(originalSnapshot, narrative);
    const baselineValidation = validatePersonAExtraction(baselineObject, narrative);
    if (!originalValidation.valid || !baselineValidation.valid) {
      throw new TypeError('Runtime plan contains an invalid original or repaired extraction.');
    }
    objectIndex = buildObjectIndex(baselineObject);
    questions = validateQuestions(runtimePlanObject, objectIndex, narrative);
  } catch (error) {
    const failure = boundedError('invalid_runtime_plan', safeMessage(error));
    markStage(stages, 'runtime_plan_validation', 'failed_closed', [failure]);
    skipLaterStages(stages, 'runtime_plan_validation');
    const audit = emptyAudit('runtime_plan_validation', submittedAnswers.length, options);
    audit.answers_rejected = submittedAnswers.length;
    return {
      application_version: PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION,
      original_extraction_hash: originalHash,
      repaired_baseline_hash: repairedHash,
      amended_record: baselineObject,
      amended_record_hash: repairedHash,
      submitted_answers: submittedAnswers,
      validated_answers: [],
      amendments: [],
      rejected_answers: [failure],
      stage_statuses: stages,
      validation_errors: [],
      audit,
    };
  }
  markStage(stages, 'runtime_plan_validation', 'passed');

  const questionIndex = new Map(questions.map((question) => [question.question_id, question]));
  const expired = parseIdSet(options.expiredQuestionIds, 'expiredQuestionIds');
  const alreadyApplied = parseIdSet(options.alreadyAppliedQuestionIds, 'alreadyAppliedQuestionIds');
  const errors: PersonAAnswerApplicationError[] = [];
  const parsed: SubmittedPersonAClarificationAnswer[] = [];
  if (submittedAnswers.length > MAX_PERSON_A_CLARIFICATION_ANSWERS) {
    errors.push(
      boundedError(
        'answer_limit_exceeded',
        `At most ${MAX_PERSON_A_CLARIFICATION_ANSWERS} clarification answers may be submitted.`,
      ),
    );
  }
  for (let index = 0; index < submittedAnswers.length; index += 1) {
    try {
      parsed.push(parseAnswer(submittedAnswers[index]!, index));
    } catch (error) {
      errors.push(boundedError('invalid_answer', safeMessage(error)));
    }
  }
  const answerCounts = new Map<string, number>();
  const questionCounts = new Map<string, number>();
  for (const answer of parsed) {
    answerCounts.set(answer.answer_id, (answerCounts.get(answer.answer_id) ?? 0) + 1);
    questionCounts.set(answer.question_id, (questionCounts.get(answer.question_id) ?? 0) + 1);
  }
  const normalized = new Map<string, { field: string; value: JsonValue }>();
  const normalizedTargetSlots = new Set<string>();
  for (const answer of parsed) {
    let duplicate = false;
    if ((answerCounts.get(answer.answer_id) ?? 0) > 1) {
      errors.push(
        boundedError('duplicate_answer_id', 'Duplicate answer IDs are rejected.', answer),
      );
      duplicate = true;
    }
    if ((questionCounts.get(answer.question_id) ?? 0) > 1) {
      errors.push(
        boundedError(
          'duplicate_question_answer',
          'Each issued question may be answered only once per batch.',
          answer,
        ),
      );
      duplicate = true;
    }
    if (duplicate) continue;
    const question = questionIndex.get(answer.question_id);
    if (!question) {
      const suppressed = Array.isArray(runtimePlanObject!.suppressed_candidates)
        ? runtimePlanObject!.suppressed_candidates.some((candidate) => {
            if (!isJsonObject(candidate)) return false;
            const assessment = candidate.assessment;
            return (
              isJsonObject(assessment) &&
              assessment.target_object_id === answer.target_object_id &&
              assessment.field === answer.field
            );
          })
        : false;
      errors.push(
        boundedError(
          suppressed ? 'suppressed_candidate' : 'unknown_question',
          suppressed
            ? 'Suppressed clarification candidates are not issued questions.'
            : 'Answer references an unknown question ID.',
          answer,
        ),
      );
      continue;
    }
    if (expired.has(answer.question_id)) {
      errors.push(boundedError('expired_question', 'Question has expired.', answer));
      continue;
    }
    if (alreadyApplied.has(answer.question_id)) {
      errors.push(
        boundedError('already_applied_question', 'Question was already applied.', answer),
      );
      continue;
    }
    if (answer.target_family !== question.target_family) {
      errors.push(
        boundedError('unsupported_target_family', 'Answer target family does not match.', answer),
      );
      continue;
    }
    if (answer.target_object_id !== question.target_object_id || answer.field !== question.field) {
      errors.push(
        boundedError('unsupported_field', 'Answer must resolve the issued target field.', answer),
      );
      continue;
    }
    const target = objectIndex.get(answer.target_object_id);
    if (!target || target.family !== answer.target_family) {
      errors.push(
        boundedError('unsupported_target_family', 'Answer target object is unavailable.', answer),
      );
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(target.item, answer.field)) {
      errors.push(
        boundedError('unsupported_field', 'Answer field is absent on its target.', answer),
      );
      continue;
    }
    if (!isDeepStrictEqual(target.item[answer.field], answer.prior_value)) {
      errors.push(boundedError('stale_prior_value', 'Answer prior value is stale.', answer));
      continue;
    }
    const normalizedValue = normalizeAnswer(answer, question, objectIndex);
    if (isAnswerApplicationError(normalizedValue)) {
      errors.push(normalizedValue);
      continue;
    }
    const normalizedField =
      question.trigger === 'actor_attribution' &&
      answer.field === 'actor_party_id' &&
      typeof normalizedValue === 'string' &&
      !['party_a', 'party_b'].includes(normalizedValue)
        ? 'actor_third_party_id'
        : answer.field;
    if (!Object.prototype.hasOwnProperty.call(target.item, normalizedField)) {
      errors.push(
        boundedError(
          'unsupported_field',
          'Normalized answer field is absent on its target.',
          answer,
        ),
      );
      continue;
    }
    if (!isDeepStrictEqual(target.item[normalizedField], answer.prior_value)) {
      errors.push(
        boundedError('stale_prior_value', 'Normalized answer prior value is stale.', answer),
      );
      continue;
    }
    if (isDeepStrictEqual(answer.prior_value, normalizedValue)) {
      errors.push(
        boundedError('no_value_change', 'Answer would not change the target field.', answer),
      );
      continue;
    }
    const normalizedTargetSlot = `${answer.target_object_id}|${canonicalQuestionTargetField(
      answer.target_family,
      question.trigger,
      normalizedField,
    )}`;
    if (normalizedTargetSlots.has(normalizedTargetSlot)) {
      errors.push(
        boundedError(
          'duplicate_question_answer',
          'Clarification answers repeat one canonical target slot.',
          answer,
        ),
      );
      continue;
    }
    normalizedTargetSlots.add(normalizedTargetSlot);
    normalized.set(answer.answer_id, {
      field: normalizedField,
      value: normalizedValue as JsonValue,
    });
  }

  if (errors.length > 0) {
    const erroredIds = new Set(errors.map((error) => error.answer_id).filter(Boolean));
    for (const answer of parsed) {
      if (!erroredIds.has(answer.answer_id)) {
        errors.push(
          boundedError(
            'atomic_batch_rejected',
            'A different answer failed validation, so the entire batch was rejected.',
            answer,
          ),
        );
      }
    }
    errors.sort(compareErrors);
    markStage(stages, 'answer_validation', 'failed_closed', errors);
    skipLaterStages(stages, 'answer_validation');
    const audit = emptyAudit('answer_validation', submittedAnswers.length, options);
    audit.answers_rejected = submittedAnswers.length;
    return {
      application_version: PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION,
      original_extraction_hash: originalHash,
      repaired_baseline_hash: repairedHash,
      amended_record: baselineObject,
      amended_record_hash: repairedHash,
      submitted_answers: submittedAnswers,
      validated_answers: [],
      amendments: [],
      rejected_answers: errors,
      stage_statuses: stages,
      validation_errors: [],
      audit,
    };
  }

  const questionOrder = new Map(questions.map((question, index) => [question.question_id, index]));
  const validatedAnswers = parsed
    .map((answer) => {
      const applied = normalized.get(answer.answer_id)!;
      return {
        ...answer,
        normalized_applied_field: applied.field,
        normalized_applied_value: applied.value,
      };
    })
    .sort(
      (left, right) =>
        (questionOrder.get(left.question_id) ?? Number.MAX_SAFE_INTEGER) -
          (questionOrder.get(right.question_id) ?? Number.MAX_SAFE_INTEGER) ||
        lexicalCompare(left.answer_id, right.answer_id),
    );
  markStage(stages, 'answer_validation', 'passed');

  const amendedRecord = snapshotJson(baselineObject);
  if (!amendedRecord.valid || !isJsonObject(amendedRecord.clone)) {
    const error = boundedError('malformed_json', 'Repaired baseline could not be projected.');
    markStage(stages, 'amendment_projection', 'failed_closed', [error]);
    skipLaterStages(stages, 'amendment_projection');
    const audit = emptyAudit('amendment_projection', submittedAnswers.length, options);
    audit.answers_rejected = submittedAnswers.length;
    return {
      application_version: PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION,
      original_extraction_hash: originalHash,
      repaired_baseline_hash: repairedHash,
      amended_record: baselineObject,
      amended_record_hash: repairedHash,
      submitted_answers: submittedAnswers,
      validated_answers: [],
      amendments: [],
      rejected_answers: [error],
      stage_statuses: stages,
      validation_errors: [],
      audit,
    };
  }
  const projected = amendedRecord.clone;
  const projectedIndex = buildObjectIndex(projected);
  const amendments: PersonAClarificationAmendment[] = [];
  for (const [index, answer] of validatedAnswers.entries()) {
    const sequence = index + 1;
    const amendmentId = `paca_${createHash('sha256')
      .update(
        stableJson([
          answer.question_id,
          answer.target_object_id,
          answer.normalized_applied_field,
          answer.normalized_applied_value,
        ]),
        'utf8',
      )
      .digest('hex')
      .slice(0, 20)}`;
    const amendment: PersonAClarificationAmendment = {
      amendment_id: amendmentId,
      amendment_sequence: sequence,
      question_id: answer.question_id,
      target_object_id: answer.target_object_id,
      target_family: answer.target_family,
      field: answer.normalized_applied_field,
      prior_value: projectedIndex.get(answer.target_object_id)!.item[
        answer.normalized_applied_field
      ]!,
      submitted_answer: answer.submitted_answer,
      normalized_applied_value: answer.normalized_applied_value,
      source_type: 'person_a_clarification',
      created_at: options.createdAt ?? null,
    };
    projectedIndex.get(answer.target_object_id)!.item[answer.normalized_applied_field] =
      answer.normalized_applied_value;
    amendments.push(amendment);
  }
  markStage(stages, 'amendment_projection', 'passed');

  const validation = validatePersonAExtraction(projected, narrative);
  if (!validation.valid) {
    const validationErrors = [...validation.schemaErrors, ...validation.invariantErrors]
      .slice(0, 20)
      .map((entry) => boundedError('immutable_fact_conflict', `${entry.path}: ${entry.message}`));
    markStage(stages, 'amended_record_validation', 'failed_closed', validationErrors);
    const audit = emptyAudit('amended_record_validation', submittedAnswers.length, options);
    audit.answers_rejected = submittedAnswers.length;
    return {
      application_version: PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION,
      original_extraction_hash: originalHash,
      repaired_baseline_hash: repairedHash,
      amended_record: baselineObject,
      amended_record_hash: repairedHash,
      submitted_answers: submittedAnswers,
      validated_answers: [],
      amendments: [],
      rejected_answers: validatedAnswers.map((answer) =>
        boundedError(
          'atomic_batch_rejected',
          'Amended record validation failed, so no amendment was applied.',
          answer,
        ),
      ),
      stage_statuses: stages,
      validation_errors: validationErrors,
      audit,
    };
  }
  markStage(stages, 'amended_record_validation', 'passed');

  const originalUnchanged = isDeepStrictEqual(
    originalSnapshot,
    runtimePlanObject!.original_extraction,
  );
  const baselineUnchanged = isDeepStrictEqual(baselineSnapshot, baselineObject);
  const objectsChanged = [
    ...new Set(amendments.map((amendment) => amendment.target_object_id)),
  ].sort(lexicalCompare);
  const audit = emptyAudit(null, submittedAnswers.length, options);
  audit.answers_validated = validatedAnswers.length;
  audit.amendments_created = amendments.length;
  audit.objects_changed = objectsChanged;
  audit.original_extraction_unchanged = originalUnchanged;
  audit.repaired_baseline_unchanged = baselineUnchanged;
  const amendedHash = hashPersonAClarificationArtifact(projected);
  return {
    application_version: PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION,
    original_extraction_hash: originalHash,
    repaired_baseline_hash: repairedHash,
    amended_record: projected,
    amended_record_hash: amendedHash,
    submitted_answers: submittedAnswers,
    validated_answers: validatedAnswers,
    amendments,
    rejected_answers: [],
    stage_statuses: stages,
    validation_errors: [],
    audit,
  };
}

export type { PersonARuntimePlanningResult };
