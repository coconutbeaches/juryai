import { createHash } from 'node:crypto';
import type { EpistemicAssessment, Materiality } from '../clarification/question-generator.js';
import {
  MAX_RUNTIME_ASSESSMENT_BATCH_SIZE,
  type RuntimeAssessmentContext,
  type RuntimeAssessmentProvider,
} from './person-a-runtime-orchestrator.js';

type JsonObject = Record<string, any>;

export const DETERMINISTIC_PERSON_A_ASSESSMENT_VERSION = 'deterministic-person-a-assessment-v0.1.4';

export const DETERMINISTIC_PERSON_A_RULE_IDS = [
  'runtime_actor_attribution_v1',
  'runtime_material_date_precision_v1',
  'runtime_evidence_availability_v1',
  'runtime_causal_link_v1',
  'runtime_nullable_interpretation_v1',
  'runtime_material_contradiction_v1',
  'runtime_internal_representation_v1',
] as const;

export type DeterministicPersonARuleId = (typeof DETERMINISTIC_PERSON_A_RULE_IDS)[number];
export type DeterministicAssessmentRuleStatus = 'emitted' | 'suppressed' | 'rejected';

export interface DeterministicPersonAAssessmentConfig {
  maximumAssessments?: number;
  maximumEvidenceAvailabilityAssessments?: number;
  materialDateTerms?: readonly string[];
  completionTerms?: readonly string[];
  unfinishedTerms?: readonly string[];
}

export type AssessmentGroundingReference =
  | {
      kind: 'source_span';
      object_id: string;
      submission_id: string;
      start_char: number;
      end_char: number;
      quote_preview: string;
      quote_sha256: string;
    }
  | {
      kind: 'extracted_object';
      object_id: string;
      field: string;
      value_preview: string;
    }
  | {
      kind: 'repair_audit';
      repair_id: string;
      rule_id: string;
      target_object_id: string;
    };

export interface DeterministicAssessmentRuleAudit {
  sequence_number: number;
  rule_id: DeterministicPersonARuleId;
  status: DeterministicAssessmentRuleStatus;
  reason_code: string;
  target_family: string;
  target_object_id: string;
  field: string;
  question_context: string | null;
  grounding_references: AssessmentGroundingReference[];
}

export interface DeterministicPersonAAssessmentAudit {
  version: typeof DETERMINISTIC_PERSON_A_ASSESSMENT_VERSION;
  rule_results: DeterministicAssessmentRuleAudit[];
  summary: {
    assessments_emitted: number;
    candidates_suppressed: number;
    candidates_rejected: number;
    emitted_by_rule: Partial<Record<DeterministicPersonARuleId, number>>;
  };
}

export interface DeterministicPersonAAssessmentResult {
  assessments: EpistemicAssessment[];
  audit: DeterministicPersonAAssessmentAudit;
}

interface ExactSourceSpan {
  submission_id: string;
  quote: string;
  start_char: number;
  end_char: number;
}

interface Candidate {
  assessment: EpistemicAssessment;
  audit: Omit<DeterministicAssessmentRuleAudit, 'sequence_number' | 'status'>;
}

interface AuditDraft extends Omit<DeterministicAssessmentRuleAudit, 'sequence_number'> {}

const DEFAULT_MATERIAL_DATE_TERMS = [
  'agreed',
  'before',
  'after',
  'by',
  'complete',
  'completed',
  'completion',
  'deadline',
  'depended',
  'due',
  'launch',
  'liability',
  'limitation',
  'sequence',
] as const;
const DEFAULT_COMPLETION_TERMS = ['complete', 'completed', 'finished'] as const;
const DEFAULT_UNFINISHED_TERMS = [
  'incomplete',
  'issues',
  'most',
  'not complete',
  'remaining',
  'unfinished',
] as const;
const MAX_CONTEXT_LENGTH = 160;
const MAX_AUDIT_PREVIEW_LENGTH = 160;
const ACTIVE_ACTOR_VERB_PATTERN =
  'accepted|accepting|asked|asking|came|coming|changed|changing|communicated|communicating|delivered|delivering|fixed|fixing|gave|giving|made|making|paid|paying|published|publishing|replied|replying|requested|requesting|said|saying|sent|sending|supplied|supplying|transferred|transferring|used|using';
const ACTIVE_ACTOR_MODIFIER_PATTERN =
  '(?:(?:also|eventually|later|personally|still|then)\\s+){0,3}(?:(?:had|has|have)\\s+)?';

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function truncateUtf16(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value;
  let prefix = value.slice(0, maximumLength - 1);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) prefix = prefix.slice(0, -1);
  return `${prefix}…`;
}

function boundedText(value: unknown, maximumLength = MAX_CONTEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/[<>?\p{C}]/gu, '');
  if (normalized.length === 0) return null;
  return truncateUtf16(normalized, maximumLength);
}

function identifier(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stableAssessmentKey(value: EpistemicAssessment): string {
  return JSON.stringify([
    value.target_object_id,
    value.target_family,
    value.field,
    value.trigger,
    value.materiality,
    value.actor_attribution ?? null,
    value.causal_link_status ?? null,
    value.merge_risk ?? null,
    value.evidence_availability ?? null,
    value.date_precision ?? null,
    value.question_context ?? null,
    value.resolves_object_ids ?? [],
  ]);
}

function stableAuditKey(value: AuditDraft): string {
  return JSON.stringify([
    value.rule_id,
    value.target_family,
    value.target_object_id,
    value.field,
    value.status,
    value.reason_code,
    value.question_context,
    value.grounding_references,
  ]);
}

function validateTermConfiguration(value: readonly string[], label: string): string[] {
  const normalized = value.map((term) => boundedText(term, 80));
  if (normalized.some((term) => term === null)) {
    throw new TypeError(`${label} must contain only bounded non-empty strings.`);
  }
  return [...new Set(normalized as string[])].sort(lexicalCompare);
}

function normalizedConfig(
  config: DeterministicPersonAAssessmentConfig,
): Required<DeterministicPersonAAssessmentConfig> {
  const maximumAssessments = config.maximumAssessments ?? MAX_RUNTIME_ASSESSMENT_BATCH_SIZE;
  const maximumEvidenceAvailabilityAssessments = config.maximumEvidenceAvailabilityAssessments ?? 1;
  if (
    !Number.isInteger(maximumAssessments) ||
    maximumAssessments < 0 ||
    maximumAssessments > MAX_RUNTIME_ASSESSMENT_BATCH_SIZE
  ) {
    throw new TypeError(
      `maximumAssessments must be an integer from 0 through ${MAX_RUNTIME_ASSESSMENT_BATCH_SIZE}.`,
    );
  }
  if (
    !Number.isInteger(maximumEvidenceAvailabilityAssessments) ||
    maximumEvidenceAvailabilityAssessments < 0 ||
    maximumEvidenceAvailabilityAssessments > maximumAssessments
  ) {
    throw new TypeError(
      'maximumEvidenceAvailabilityAssessments must be a non-negative integer within the assessment limit.',
    );
  }
  return {
    maximumAssessments,
    maximumEvidenceAvailabilityAssessments,
    materialDateTerms: validateTermConfiguration(
      config.materialDateTerms ?? DEFAULT_MATERIAL_DATE_TERMS,
      'materialDateTerms',
    ),
    completionTerms: validateTermConfiguration(
      config.completionTerms ?? DEFAULT_COMPLETION_TERMS,
      'completionTerms',
    ),
    unfinishedTerms: validateTermConfiguration(
      config.unfinishedTerms ?? DEFAULT_UNFINISHED_TERMS,
      'unfinishedTerms',
    ),
  };
}

function exactSourceSpans(
  item: JsonObject,
  narrative: string,
): { valid: true; spans: ExactSourceSpan[] } | { valid: false; reason: string } {
  if (!Array.isArray(item.source_spans) || item.source_spans.length === 0) {
    return { valid: false, reason: 'source_spans_missing' };
  }
  const spans: ExactSourceSpan[] = [];
  for (const span of item.source_spans) {
    if (
      !isRecord(span) ||
      typeof span.submission_id !== 'string' ||
      typeof span.quote !== 'string' ||
      span.quote.length === 0 ||
      !Number.isInteger(span.start_char) ||
      !Number.isInteger(span.end_char) ||
      span.start_char < 0 ||
      span.end_char - span.start_char !== span.quote.length ||
      narrative.slice(span.start_char, span.end_char) !== span.quote
    ) {
      return { valid: false, reason: 'source_span_invalid' };
    }
    spans.push({
      submission_id: span.submission_id,
      quote: span.quote,
      start_char: span.start_char,
      end_char: span.end_char,
    });
  }
  spans.sort(
    (left, right) =>
      left.start_char - right.start_char ||
      left.end_char - right.end_char ||
      lexicalCompare(left.quote, right.quote),
  );
  return { valid: true, spans };
}

function sourceGrounding(
  objectId: string,
  spans: readonly ExactSourceSpan[],
): AssessmentGroundingReference[] {
  return spans.map((span) => ({
    kind: 'source_span',
    object_id: objectId,
    submission_id: span.submission_id,
    start_char: span.start_char,
    end_char: span.end_char,
    quote_preview: truncateUtf16(span.quote, MAX_AUDIT_PREVIEW_LENGTH),
    quote_sha256: createHash('sha256').update(span.quote, 'utf8').digest('hex'),
  }));
}

function objectGrounding(
  objectId: string,
  field: string,
  value: unknown,
): AssessmentGroundingReference[] {
  const preview = boundedText(
    value === null || ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : null,
    MAX_AUDIT_PREVIEW_LENGTH,
  );
  return preview
    ? [{ kind: 'extracted_object', object_id: objectId, field, value_preview: preview }]
    : [];
}

function materiality(value: unknown, fallback: Materiality = 'medium'): Materiality {
  if (value === 'critical') return 'critical';
  if (value === 'high' || value === 'major') return 'high';
  if (value === 'medium' || value === 'minor') return 'medium';
  if (value === 'low') return 'low';
  return fallback;
}

function familyItems(record: JsonObject, family: string): JsonObject[] {
  let values: unknown[] = [];
  switch (family) {
    case 'agreement_terms':
      values = Array.isArray(record.agreement?.terms) ? record.agreement.terms : [];
      break;
    case 'deliverables':
      values = Array.isArray(record.deliverable_assessments) ? record.deliverable_assessments : [];
      break;
    case 'damages':
      values = Array.isArray(record.damages_claims) ? record.damages_claims : [];
      break;
    default:
      values = Array.isArray(record[family]) ? record[family] : [];
  }
  return values.filter(isRecord);
}

function buildObjectIndex(record: JsonObject): Map<string, { family: string; item: JsonObject }> {
  const idFields: Record<string, string> = {
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
  const result = new Map<string, { family: string; item: JsonObject }>();
  for (const [family, idField] of Object.entries(idFields)) {
    for (const item of familyItems(record, family)) {
      const id = identifier(item[idField]);
      if (id) result.set(id, { family, item });
    }
  }
  return result;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function containsWholeTerm(text: string, terms: readonly string[]): boolean {
  return terms.some((term) =>
    new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegularExpression(term)}(?![\\p{L}\\p{N}_])`,
      'iu',
    ).test(text),
  );
}

function hasAffirmativeTerm(text: string, terms: readonly string[]): boolean {
  for (const term of terms) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegularExpression(term)}(?![\\p{L}\\p{N}_])`,
      'giu',
    );
    for (const match of text.matchAll(pattern)) {
      const prefix = text
        .slice(Math.max(0, (match.index ?? 0) - 48), match.index)
        .toLocaleLowerCase('en-US')
        .replace(/[-–—]/gu, ' ');
      if (
        /(?:\bnot|\bnever|\bno|\bwithout|\bneither|\bnothing|\bnone|\bwasn't|\bwasn’t|\bisn't|\bisn’t|\baren't|\baren’t|\bwas not|\bis not|\bare not|\bdid not|\bhas not|\bhave not|\bhad not|\bfar from|\bless than)\s+(?:[\p{L}\p{N}_]+\s+){0,5}$/iu.test(
          prefix,
        )
      ) {
        continue;
      }
      return true;
    }
  }
  return false;
}

function explicitActorInSource(quote: string, extraction: JsonObject): boolean {
  if (
    new RegExp(
      `\\bI\\s+${ACTIVE_ACTOR_MODIFIER_PATTERN}(?:${ACTIVE_ACTOR_VERB_PATTERN})\\b`,
      'iu',
    ).test(quote)
  ) {
    return true;
  }
  const registeredNames = [
    extraction.party?.display_name,
    ...familyItems(extraction, 'third_parties').map((item) => item.name_or_label),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (
    registeredNames.some((name) => {
      const actor = escapeRegularExpression(name.trim());
      return new RegExp(
        `(?<![\\p{L}\\p{N}_])${actor}\\s+${ACTIVE_ACTOR_MODIFIER_PATTERN}(?:${ACTIVE_ACTOR_VERB_PATTERN})\\b`,
        'iu',
      ).test(quote);
    })
  ) {
    return true;
  }
  return new RegExp(
    `\\b[\\p{Lu}][\\p{L}'’.-]+(?:\\s+[\\p{Lu}][\\p{L}'’.-]+)?\\s+${ACTIVE_ACTOR_MODIFIER_PATTERN}(?:${ACTIVE_ACTOR_VERB_PATTERN})\\b`,
    'u',
  ).test(quote);
}

function referencedClaimGrounding(
  claimIds: readonly string[],
  narrative: string,
  objectIndex: ReadonlyMap<string, { family: string; item: JsonObject }>,
): AssessmentGroundingReference[] {
  const grounding: AssessmentGroundingReference[] = [];
  for (const claimId of [...new Set(claimIds)].sort(lexicalCompare)) {
    const claim = objectIndex.get(claimId)?.item;
    if (!claim || objectIndex.get(claimId)?.family !== 'claims') continue;
    const spans = exactSourceSpans(claim, narrative);
    if (spans.valid) grounding.push(...sourceGrounding(claimId, spans.spans));
  }
  return grounding;
}

function evidenceClaimGrounding(
  extraction: JsonObject,
  evidenceId: string,
  narrative: string,
  objectIndex: ReadonlyMap<string, { family: string; item: JsonObject }>,
): AssessmentGroundingReference[] {
  if (!Array.isArray(extraction.claim_evidence_links)) return [];
  const claimIds = extraction.claim_evidence_links
    .filter(
      (link: unknown): link is JsonObject =>
        isRecord(link) && link.evidence_id === evidenceId && typeof link.claim_id === 'string',
    )
    .map((link: JsonObject) => identifier(link.claim_id));
  return referencedClaimGrounding(claimIds, narrative, objectIndex);
}

function dateIsMaterial(
  item: JsonObject,
  spans: readonly ExactSourceSpan[],
  terms: readonly string[],
) {
  if (!['critical', 'high'].includes(materiality(item.materiality, 'low'))) return false;
  const text = `${String(item.event_summary ?? '')} ${spans.map((span) => span.quote).join(' ')}`;
  const containsCalendarReference =
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b(?:\s+\d{1,2})?/iu.test(
      text,
    );
  return containsCalendarReference && containsWholeTerm(text, terms);
}

function completionConflict(
  spans: readonly ExactSourceSpan[],
  completionTerms: readonly string[],
  unfinishedTerms: readonly string[],
): boolean {
  const affirmativeCompletion = (text: string): boolean => {
    if (hasAffirmativeTerm(text, unfinishedTerms)) return false;
    return hasAffirmativeTerm(text, completionTerms);
  };
  const completedSpanIndexes = spans.flatMap((span, index) =>
    affirmativeCompletion(span.quote) ? [index] : [],
  );
  const unfinishedSpanIndexes = spans.flatMap((span, index) =>
    hasAffirmativeTerm(span.quote, unfinishedTerms) ? [index] : [],
  );
  return completedSpanIndexes.some((completedIndex) =>
    unfinishedSpanIndexes.some((unfinishedIndex) => unfinishedIndex !== completedIndex),
  );
}

function explicitCountConflict(item: JsonObject, spans: readonly ExactSourceSpan[]): boolean {
  const description = String(item.description ?? '');
  if (!/\b(?:but|conflict|count|number|versus)\b/iu.test(description)) return false;
  const values = new Set<string>();
  const numberPattern = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/giu;
  for (const span of spans) {
    for (const match of span.quote.matchAll(numberPattern)) values.add(match[0].toLowerCase());
  }
  return values.size >= 2;
}

interface NormalizedDateMention {
  precision: 'full_date' | 'month_day' | 'month_year';
  year: number | null;
  month: number;
  day: number | null;
  token: string;
}

const MONTH_NUMBERS: Readonly<Record<string, number>> = {
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
const MONTH_PATTERN =
  'January|February|March|April|May|June|July|August|September|October|November|December';

function normalizedDateMention(
  year: number | null,
  month: number,
  day: number | null,
): NormalizedDateMention | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  if (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999)) return null;
  if (day === null) {
    if (year === null) return null;
    return {
      precision: 'month_year',
      year,
      month,
      day,
      token: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`,
    };
  }
  if (!Number.isInteger(day) || day < 1) return null;
  const validationYear = year ?? 2000;
  const date = new Date(Date.UTC(validationYear, month - 1, day));
  if (
    date.getUTCFullYear() !== validationYear ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return {
    precision: year === null ? 'month_day' : 'full_date',
    year,
    month,
    day,
    token: `${year === null ? 'XXXX' : String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

function extractNormalizedDateMentions(text: string): NormalizedDateMention[] {
  const mentions = new Map<string, NormalizedDateMention>();
  const add = (year: number | null, month: number, day: number | null): void => {
    const normalized = normalizedDateMention(year, month, day);
    if (normalized) mentions.set(normalized.token, normalized);
  };
  for (const match of text.matchAll(
    new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?\\b`, 'giu'),
  )) {
    add(
      match[3] === undefined ? null : Number(match[3]),
      MONTH_NUMBERS[match[1]!.toLowerCase()]!,
      Number(match[2]),
    );
  }
  for (const match of text.matchAll(
    new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_PATTERN})(?:\\s+(\\d{4}))?\\b`, 'giu'),
  )) {
    add(
      match[3] === undefined ? null : Number(match[3]),
      MONTH_NUMBERS[match[2]!.toLowerCase()]!,
      Number(match[1]),
    );
  }
  for (const match of text.matchAll(
    new RegExp(`\\b(${MONTH_PATTERN})\\s*,?\\s+(\\d{4})\\b`, 'giu'),
  )) {
    add(Number(match[2]), MONTH_NUMBERS[match[1]!.toLowerCase()]!, null);
  }
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/gu)) {
    add(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  return [...mentions.values()].sort((left, right) => lexicalCompare(left.token, right.token));
}

function explicitDateConflict(item: JsonObject, spans: readonly ExactSourceSpan[]): boolean {
  if (
    !/\b(?:conflict|different|inconsisten(?:t|tly|cy))\b/iu.test(String(item.description ?? ''))
  ) {
    return false;
  }
  const datesBySpan = spans.map((span) => extractNormalizedDateMentions(span.quote));
  if (datesBySpan.length < 2 || datesBySpan.some((dates) => dates.length !== 1)) return false;
  const dates = datesBySpan.map((values) => values[0]!);
  if (new Set(dates.map((date) => date.precision)).size !== 1) return false;
  const monthDays = new Set(dates.map((date) => `${date.month}-${date.day}`));
  if (monthDays.size > 1) return true;
  if (dates[0]!.precision === 'month_day') return false;
  return new Set(dates.map((date) => date.year)).size > 1;
}

type CausalTheoryStatus = 'explicit' | 'inferred' | 'disputed' | 'unstated' | 'ambiguous';

function classifyCausalTheory(theory: string): CausalTheoryStatus {
  const normalized = theory
    .trim()
    .replace(/[.!,:;]+$/u, '')
    .toLowerCase();
  const disputed =
    /\b(?:conflicting|contradictory|disputed|inconsistent)\s+(?:causal\s+)?(?:causes?|explanations?|theories?|accounts?)\b/u.test(
      normalized,
    ) ||
    /\b(?:causal\s+)?(?:causes?|explanations?|theories?|accounts?)\s+(?:are|remain)\s+(?:conflicting|contradictory|disputed|inconsistent)\b/u.test(
      normalized,
    );
  if (disputed) return 'disputed';

  const exactAbsence = /^(?:unknown|unstated|unclear|not stated|not established)$/u.test(
    normalized,
  );
  const causalAbsence =
    /\b(?:causal\s+(?:link|relationship|connection|explanation|theory)|cause)\s+(?:is\s+|was\s+)?(?:not\s+stated|unstated|unclear|unknown|not\s+established|not\s+provided)\b/u.test(
      normalized,
    ) ||
    /\bno\s+causal\s+(?:link|relationship|connection|explanation|theory)\s+(?:is\s+|was\s+)?(?:stated|provided|established)\b/u.test(
      normalized,
    );
  if (exactAbsence || causalAbsence) return 'unstated';

  const inferred =
    /\b(?:may|might|could|possibly)\s+(?:have\s+)?(?:directly\s+)?(?:cause|caused|contribute|contributed|lead|led|result|resulted)\b/u.test(
      normalized,
    ) ||
    /\b(?:appears|believe|believes|believed|suggests)\b[^.]{0,120}\b(?:cause|caused|causal|contribute|contributed|lead|led|result|resulted)\b/u.test(
      normalized,
    );
  if (inferred) return 'inferred';

  if (/\b(?:unclear|unknown|unstated|not\s+stated|not\s+established)\b/u.test(normalized)) {
    return 'ambiguous';
  }
  return 'explicit';
}

function detachedPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function assessDeterministicPersonAEpistemicGaps(
  context: RuntimeAssessmentContext,
  config: DeterministicPersonAAssessmentConfig = {},
): DeterministicPersonAAssessmentResult {
  if (!isRecord(context.original_extraction) || !isRecord(context.repaired_extraction)) {
    throw new TypeError('original_extraction and repaired_extraction must be objects.');
  }
  if (typeof context.narrative !== 'string') throw new TypeError('narrative must be a string.');
  if (!isRecord(context.repair_audit)) throw new TypeError('repair_audit must be an object.');

  const policy = normalizedConfig(config);
  const extraction = detachedPlainJson(context.repaired_extraction);
  const repairAudit = detachedPlainJson(context.repair_audit);
  const objectIndex = buildObjectIndex(extraction);
  const candidates: Candidate[] = [];
  const auditDrafts: AuditDraft[] = [];

  const record = (
    ruleId: DeterministicPersonARuleId,
    status: DeterministicAssessmentRuleStatus,
    reasonCode: string,
    family: string,
    objectId: string,
    field: string,
    questionContext: string | null,
    groundingReferences: AssessmentGroundingReference[],
  ): void => {
    auditDrafts.push({
      rule_id: ruleId,
      status,
      reason_code: reasonCode,
      target_family: family,
      target_object_id: objectId,
      field,
      question_context: questionContext,
      grounding_references: groundingReferences,
    });
  };

  const emit = (
    ruleId: DeterministicPersonARuleId,
    assessment: EpistemicAssessment,
    reasonCode: string,
    groundingReferences: AssessmentGroundingReference[],
  ): void => {
    candidates.push({
      assessment,
      audit: {
        rule_id: ruleId,
        reason_code: reasonCode,
        target_family: assessment.target_family,
        target_object_id: assessment.target_object_id,
        field: assessment.field,
        question_context: assessment.question_context ?? null,
        grounding_references: groundingReferences,
      },
    });
  };

  for (const item of familyItems(extraction, 'timeline').sort((left, right) =>
    lexicalCompare(identifier(left.event_id), identifier(right.event_id)),
  )) {
    const objectId = identifier(item.event_id);
    if (item.actor_party_id !== null || item.actor_third_party_id !== null) {
      record(
        'runtime_actor_attribution_v1',
        'suppressed',
        'actor_already_explicit_in_record',
        'timeline',
        objectId,
        'actor_party_id',
        null,
        objectGrounding(objectId, 'event_summary', item.event_summary),
      );
      continue;
    }
    const spans = exactSourceSpans(item, context.narrative);
    if (!spans.valid) {
      record(
        'runtime_actor_attribution_v1',
        'rejected',
        spans.reason,
        'timeline',
        objectId,
        'actor_party_id',
        null,
        [],
      );
      continue;
    }
    const quote = spans.spans.map((span) => span.quote).join(' ');
    const actorBearingAction =
      /\b(?:accepted|asked|came|changed|communicated|coming|delivered|fixed|made|paid|published|replied|requested|sent|supplied|transferred|used)\b/iu.test(
        `${String(item.event_summary ?? '')} ${quote}`,
      );
    if (
      !actorBearingAction ||
      !['critical', 'high'].includes(materiality(item.materiality, 'low'))
    ) {
      record(
        'runtime_actor_attribution_v1',
        'suppressed',
        'no_material_actor_bearing_action',
        'timeline',
        objectId,
        'actor_party_id',
        null,
        sourceGrounding(objectId, spans.spans),
      );
      continue;
    }
    if (explicitActorInSource(quote, extraction)) {
      record(
        'runtime_actor_attribution_v1',
        'suppressed',
        'actor_already_explicit_in_source',
        'timeline',
        objectId,
        'actor_party_id',
        null,
        sourceGrounding(objectId, spans.spans),
      );
      continue;
    }
    const questionContext = boundedText(item.event_summary) ?? boundedText(spans.spans[0]?.quote);
    if (!questionContext) {
      record(
        'runtime_actor_attribution_v1',
        'rejected',
        'question_context_not_grounded',
        'timeline',
        objectId,
        'actor_party_id',
        null,
        sourceGrounding(objectId, spans.spans),
      );
      continue;
    }
    emit(
      'runtime_actor_attribution_v1',
      {
        target_object_id: objectId,
        target_family: 'timeline',
        field: 'actor_party_id',
        trigger: 'actor_attribution',
        materiality: materiality(item.materiality),
        actor_attribution: /\b(?:he|she|they)\b/iu.test(quote) ? 'inferred' : 'unstated',
        question_context: questionContext,
        resolves_object_ids: [objectId],
      },
      'material_actor_unstated',
      sourceGrounding(objectId, spans.spans),
    );
  }

  const materialDateCandidates: {
    item: JsonObject;
    spans: ExactSourceSpan[];
    context: string;
  }[] = [];
  for (const item of familyItems(extraction, 'timeline').sort((left, right) =>
    lexicalCompare(identifier(left.event_id), identifier(right.event_id)),
  )) {
    const date = item.date;
    if (
      !isRecord(date) ||
      date.precision !== 'unknown' ||
      date.start !== null ||
      date.end !== null
    ) {
      continue;
    }
    const objectId = identifier(item.event_id);
    const spans = exactSourceSpans(item, context.narrative);
    if (!spans.valid) {
      record(
        'runtime_material_date_precision_v1',
        'rejected',
        spans.reason,
        'timeline',
        objectId,
        'date',
        null,
        [],
      );
      continue;
    }
    const explicitSourceDates = spans.spans.flatMap((span) =>
      extractNormalizedDateMentions(span.quote),
    );
    if (explicitSourceDates.length > 0 && explicitSourceDates.every((date) => date.year !== null)) {
      record(
        'runtime_material_date_precision_v1',
        'suppressed',
        'calendar_year_explicit_in_source',
        'timeline',
        objectId,
        'date',
        null,
        sourceGrounding(objectId, spans.spans),
      );
      continue;
    }
    if (explicitSourceDates.some((date) => date.year !== null)) {
      record(
        'runtime_material_date_precision_v1',
        'rejected',
        'mixed_year_precision_in_source',
        'timeline',
        objectId,
        'date',
        null,
        sourceGrounding(objectId, spans.spans),
      );
      continue;
    }
    if (!dateIsMaterial(item, spans.spans, policy.materialDateTerms)) {
      record(
        'runtime_material_date_precision_v1',
        'suppressed',
        'missing_year_not_materially_necessary',
        'timeline',
        objectId,
        'date',
        null,
        sourceGrounding(objectId, spans.spans),
      );
      continue;
    }
    const questionContext = boundedText(item.event_summary) ?? boundedText(spans.spans[0]?.quote);
    if (!questionContext) {
      record(
        'runtime_material_date_precision_v1',
        'rejected',
        'question_context_not_grounded',
        'timeline',
        objectId,
        'date',
        null,
        sourceGrounding(objectId, spans.spans),
      );
      continue;
    }
    materialDateCandidates.push({ item, spans: spans.spans, context: questionContext });
  }
  materialDateCandidates.sort((left, right) => {
    const leftText = `${left.item.event_summary ?? ''} ${left.spans.map((span) => span.quote).join(' ')}`;
    const rightText = `${right.item.event_summary ?? ''} ${right.spans.map((span) => span.quote).join(' ')}`;
    const deadlineRank = (text: string) => (/\b(?:deadline|due|launch|by)\b/iu.test(text) ? 0 : 1);
    return (
      deadlineRank(leftText) - deadlineRank(rightText) ||
      left.spans[0]!.start_char - right.spans[0]!.start_char ||
      lexicalCompare(identifier(left.item.event_id), identifier(right.item.event_id))
    );
  });
  const selectedDate = materialDateCandidates[0];
  if (selectedDate) {
    const objectId = identifier(selectedDate.item.event_id);
    emit(
      'runtime_material_date_precision_v1',
      {
        target_object_id: objectId,
        target_family: 'timeline',
        field: 'date',
        trigger: 'date_precision',
        materiality: materiality(selectedDate.item.materiality),
        date_precision: 'unknown',
        question_context: selectedDate.context,
        resolves_object_ids: materialDateCandidates
          .map(({ item }) => identifier(item.event_id))
          .filter(Boolean)
          .sort(lexicalCompare),
      },
      'material_calendar_year_absent',
      sourceGrounding(objectId, selectedDate.spans),
    );
    for (const candidate of materialDateCandidates.slice(1)) {
      const candidateId = identifier(candidate.item.event_id);
      record(
        'runtime_material_date_precision_v1',
        'suppressed',
        'covered_by_grouped_material_date_assessment',
        'timeline',
        candidateId,
        'date',
        candidate.context,
        sourceGrounding(candidateId, candidate.spans),
      );
    }
  }

  const evidenceCandidates: {
    item: JsonObject;
    context: string;
    priority: number;
    grounding: AssessmentGroundingReference[];
  }[] = [];
  const issueEvidenceIds = new Set(
    familyItems(extraction, 'extraction_issues')
      .filter((item) => ['critical', 'major'].includes(String(item.severity)))
      .flatMap((item) =>
        Array.isArray(item.affected_object_ids)
          ? item.affected_object_ids.filter(
              (value: unknown): value is string =>
                typeof value === 'string' && objectIndex.has(value),
            )
          : [],
      ),
  );
  for (const item of familyItems(extraction, 'evidence').sort((left, right) =>
    lexicalCompare(identifier(left.evidence_id), identifier(right.evidence_id)),
  )) {
    const objectId = identifier(item.evidence_id);
    const status = item.availability_status;
    const contextText = boundedText(item.title) ?? boundedText(item.description_from_submitter);
    const objectReferences = objectGrounding(
      objectId,
      typeof item.title === 'string' ? 'title' : 'description_from_submitter',
      item.title ?? item.description_from_submitter,
    );
    const sourceReferences = evidenceClaimGrounding(
      extraction,
      objectId,
      context.narrative,
      objectIndex,
    );
    const grounding = [...sourceReferences, ...objectReferences];
    if (status === 'unavailable') {
      record(
        'runtime_evidence_availability_v1',
        'suppressed',
        'evidence_explicitly_unavailable',
        'evidence',
        objectId,
        'availability_status',
        contextText,
        grounding,
      );
      continue;
    }
    if (status === 'available') {
      record(
        'runtime_evidence_availability_v1',
        'suppressed',
        'evidence_explicitly_available',
        'evidence',
        objectId,
        'availability_status',
        contextText,
        grounding,
      );
      continue;
    }
    if (!['described_only', 'unknown'].includes(String(status))) continue;
    if (
      /\b(?:is|was|are|were)\s+(?:attached|uploaded|available)\b/iu.test(
        String(item.description_from_submitter ?? ''),
      )
    ) {
      record(
        'runtime_evidence_availability_v1',
        'suppressed',
        'availability_already_explicit_in_description',
        'evidence',
        objectId,
        'availability_status',
        contextText,
        grounding,
      );
      continue;
    }
    if (!contextText || objectReferences.length === 0 || sourceReferences.length === 0) {
      record(
        'runtime_evidence_availability_v1',
        'rejected',
        sourceReferences.length === 0
          ? 'evidence_source_grounding_missing'
          : 'question_context_not_grounded',
        'evidence',
        objectId,
        'availability_status',
        null,
        grounding,
      );
      continue;
    }
    evidenceCandidates.push({
      item,
      context: contextText,
      priority: issueEvidenceIds.has(objectId) ? 0 : 1,
      grounding,
    });
  }
  evidenceCandidates.sort(
    (left, right) =>
      left.priority - right.priority ||
      lexicalCompare(identifier(left.item.evidence_id), identifier(right.item.evidence_id)),
  );
  for (const [index, candidate] of evidenceCandidates.entries()) {
    const objectId = identifier(candidate.item.evidence_id);
    const grounding = candidate.grounding;
    if (index >= policy.maximumEvidenceAvailabilityAssessments) {
      record(
        'runtime_evidence_availability_v1',
        'suppressed',
        'bounded_evidence_assessment_limit',
        'evidence',
        objectId,
        'availability_status',
        candidate.context,
        grounding,
      );
      continue;
    }
    emit(
      'runtime_evidence_availability_v1',
      {
        target_object_id: objectId,
        target_family: 'evidence',
        field: 'availability_status',
        trigger: 'evidence_availability',
        materiality: issueEvidenceIds.has(objectId) ? 'high' : 'medium',
        evidence_availability: candidate.item.availability_status,
        question_context: candidate.context,
        resolves_object_ids: [objectId],
      },
      'current_evidence_availability_unknown',
      grounding,
    );
  }

  for (const item of familyItems(extraction, 'damages').sort((left, right) =>
    lexicalCompare(identifier(left.damages_claim_id), identifier(right.damages_claim_id)),
  )) {
    const objectId = identifier(item.damages_claim_id);
    const theory = boundedText(item.causal_theory);
    const sourceReferences = referencedClaimGrounding(
      Array.isArray(item.source_claim_ids)
        ? item.source_claim_ids.filter(
            (value: unknown): value is string => typeof value === 'string',
          )
        : [],
      context.narrative,
      objectIndex,
    );
    const grounding = [
      ...sourceReferences,
      ...objectGrounding(objectId, 'causal_theory', item.causal_theory),
    ];
    if (!theory || sourceReferences.length === 0) {
      record(
        'runtime_causal_link_v1',
        'rejected',
        sourceReferences.length === 0
          ? 'causal_source_grounding_missing'
          : 'causal_context_not_grounded',
        'damages',
        objectId,
        'causal_theory',
        null,
        grounding,
      );
      continue;
    }
    const causalStatus = classifyCausalTheory(theory);
    if (causalStatus === 'ambiguous') {
      record(
        'runtime_causal_link_v1',
        'rejected',
        'causal_status_ambiguous',
        'damages',
        objectId,
        'causal_theory',
        theory,
        grounding,
      );
      continue;
    }
    const groundedClaimCount = new Set(
      sourceReferences
        .filter(
          (
            reference,
          ): reference is Extract<AssessmentGroundingReference, { kind: 'source_span' }> =>
            reference.kind === 'source_span',
        )
        .map((reference) => reference.object_id),
    ).size;
    if (causalStatus === 'disputed' && groundedClaimCount < 2) {
      record(
        'runtime_causal_link_v1',
        'rejected',
        'causal_contradiction_requires_two_grounded_claims',
        'damages',
        objectId,
        'causal_theory',
        theory,
        grounding,
      );
      continue;
    }
    if (causalStatus === 'explicit') {
      record(
        'runtime_causal_link_v1',
        'suppressed',
        'causal_link_explicit',
        'damages',
        objectId,
        'causal_theory',
        theory,
        grounding,
      );
      continue;
    }
    emit(
      'runtime_causal_link_v1',
      {
        target_object_id: objectId,
        target_family: 'damages',
        field: 'causal_theory',
        trigger: 'causal_link',
        materiality: materiality(item.materiality, 'high'),
        causal_link_status: causalStatus,
        question_context: theory,
        resolves_object_ids: [objectId],
      },
      causalStatus === 'disputed'
        ? 'causal_link_disputed'
        : causalStatus === 'unstated'
          ? 'causal_link_unstated'
          : 'causal_link_inferred',
      grounding,
    );
  }

  for (const item of familyItems(extraction, 'agreement_terms').sort((left, right) =>
    lexicalCompare(identifier(left.term_id), identifier(right.term_id)),
  )) {
    const objectId = identifier(item.term_id);
    const interpretation = boundedText(item.person_a_interpretation);
    if (interpretation) {
      record(
        'runtime_nullable_interpretation_v1',
        'suppressed',
        'interpretation_already_explicit',
        'agreement_terms',
        objectId,
        'person_a_interpretation',
        null,
        objectGrounding(objectId, 'person_a_interpretation', item.person_a_interpretation),
      );
      continue;
    }
    const spans = exactSourceSpans(item, context.narrative);
    if (!spans.valid) {
      record(
        'runtime_nullable_interpretation_v1',
        'rejected',
        spans.reason,
        'agreement_terms',
        objectId,
        'person_a_interpretation',
        null,
        [],
      );
      continue;
    }
    const questionContext = boundedText(item.wording) ?? boundedText(spans.spans[0]?.quote);
    if (!questionContext) {
      record(
        'runtime_nullable_interpretation_v1',
        'rejected',
        'question_context_not_grounded',
        'agreement_terms',
        objectId,
        'person_a_interpretation',
        null,
        sourceGrounding(objectId, spans.spans),
      );
      continue;
    }
    emit(
      'runtime_nullable_interpretation_v1',
      {
        target_object_id: objectId,
        target_family: 'agreement_terms',
        field: 'person_a_interpretation',
        trigger: 'required_bucket_missing',
        materiality: materiality(item.materiality),
        question_context: questionContext,
        resolves_object_ids: [objectId],
      },
      'nullable_interpretation_absent',
      sourceGrounding(objectId, spans.spans),
    );
  }

  for (const item of familyItems(extraction, 'extraction_issues').sort((left, right) =>
    lexicalCompare(identifier(left.issue_id), identifier(right.issue_id)),
  )) {
    if (!['critical', 'major'].includes(String(item.severity))) continue;
    const objectId = identifier(item.issue_id);
    const spans = exactSourceSpans(item, context.narrative);
    if (!spans.valid) {
      record(
        'runtime_material_contradiction_v1',
        'rejected',
        spans.reason,
        'extraction_issues',
        objectId,
        'description',
        null,
        [],
      );
      continue;
    }
    const contextText = boundedText(item.description);
    const isCompletionConflict = completionConflict(
      spans.spans,
      policy.completionTerms,
      policy.unfinishedTerms,
    );
    const isCountConflict = explicitCountConflict(item, spans.spans);
    const isDateConflict = explicitDateConflict(item, spans.spans);
    if (!contextText || (!isCompletionConflict && !isCountConflict && !isDateConflict)) {
      record(
        'runtime_material_contradiction_v1',
        'suppressed',
        'no_deterministic_material_contradiction',
        'extraction_issues',
        objectId,
        'description',
        contextText,
        sourceGrounding(objectId, spans.spans),
      );
      continue;
    }
    const affectedObjectIds = Array.isArray(item.affected_object_ids)
      ? item.affected_object_ids.filter(
          (value: unknown): value is string => typeof value === 'string' && objectIndex.has(value),
        )
      : [];
    const resolvesObjectIds = [...new Set([objectId, ...affectedObjectIds])].sort(lexicalCompare);
    if (item.issue_type === 'ambiguous_scope' && isCountConflict) {
      emit(
        'runtime_material_contradiction_v1',
        {
          target_object_id: objectId,
          target_family: 'extraction_issues',
          field: 'description',
          trigger: 'merge_risk',
          materiality: materiality(item.severity),
          merge_risk: 'possible_split',
          question_context: contextText,
          resolves_object_ids: resolvesObjectIds,
        },
        'explicit_count_contradiction',
        sourceGrounding(objectId, spans.spans),
      );
    } else if (item.issue_type === 'internal_tension') {
      emit(
        'runtime_material_contradiction_v1',
        {
          target_object_id: objectId,
          target_family: 'extraction_issues',
          field: 'description',
          trigger: 'required_bucket_missing',
          materiality: materiality(item.severity),
          question_context: contextText,
          resolves_object_ids: resolvesObjectIds,
        },
        isCompletionConflict
          ? 'explicit_completion_contradiction'
          : isDateConflict
            ? 'explicit_date_contradiction'
            : 'explicit_material_contradiction',
        sourceGrounding(objectId, spans.spans),
      );
    } else {
      record(
        'runtime_material_contradiction_v1',
        'suppressed',
        'unsupported_contradiction_family',
        'extraction_issues',
        objectId,
        'description',
        contextText,
        sourceGrounding(objectId, spans.spans),
      );
    }
  }

  const internalFieldByFamily: Record<string, string> = {
    deliverables: 'name',
    evidence: 'title',
  };
  const repairRecords = [
    ...(Array.isArray(repairAudit.applied_repairs) ? repairAudit.applied_repairs : []),
    ...(Array.isArray(repairAudit.skipped_repairs) ? repairAudit.skipped_repairs : []),
    ...(Array.isArray(repairAudit.rejected_repairs) ? repairAudit.rejected_repairs : []),
  ]
    .filter(isRecord)
    .sort((left, right) => lexicalCompare(identifier(left.repair_id), identifier(right.repair_id)));
  for (const repair of repairRecords) {
    if (repair.rule_id !== 'aggregate_split_unsupported_v0_1_2') continue;
    const family = identifier(repair.target_family);
    const objectId = identifier(repair.target_object_id);
    const field = internalFieldByFamily[family];
    const target = objectIndex.get(objectId);
    const grounding: AssessmentGroundingReference[] = [
      {
        kind: 'repair_audit',
        repair_id: identifier(repair.repair_id),
        rule_id: identifier(repair.rule_id),
        target_object_id: objectId,
      },
    ];
    if (!field) {
      record(
        'runtime_internal_representation_v1',
        'rejected',
        'unsupported_internal_target_field',
        family,
        objectId,
        '',
        null,
        grounding,
      );
      continue;
    }
    if (!target || target.family !== family || !Object.hasOwn(target.item, field)) {
      record(
        'runtime_internal_representation_v1',
        'rejected',
        'internal_target_not_resolved',
        family,
        objectId,
        field,
        null,
        grounding,
      );
      continue;
    }
    emit(
      'runtime_internal_representation_v1',
      {
        target_object_id: objectId,
        target_family: family,
        field,
        trigger: 'internal_representation',
        materiality: 'low',
        resolves_object_ids: [objectId],
      },
      'aggregate_split_unsupported_v0_1_2',
      grounding,
    );
  }

  const sortedCandidates = candidates.sort((left, right) =>
    lexicalCompare(stableAssessmentKey(left.assessment), stableAssessmentKey(right.assessment)),
  );
  const uniqueCandidates = sortedCandidates.filter(
    (candidate, index, all) =>
      index === 0 ||
      stableAssessmentKey(candidate.assessment) !== stableAssessmentKey(all[index - 1]!.assessment),
  );
  const selected = uniqueCandidates.slice(0, policy.maximumAssessments);
  const selectedKeys = new Set(
    selected.map((candidate) => stableAssessmentKey(candidate.assessment)),
  );
  for (const candidate of uniqueCandidates) {
    const selectedCandidate = selectedKeys.has(stableAssessmentKey(candidate.assessment));
    auditDrafts.push({
      ...candidate.audit,
      status: selectedCandidate ? 'emitted' : 'suppressed',
      reason_code: selectedCandidate
        ? candidate.audit.reason_code
        : 'maximum_assessment_limit_reached',
    });
  }
  const ruleResults = auditDrafts
    .sort((left, right) => lexicalCompare(stableAuditKey(left), stableAuditKey(right)))
    .map((item, index) => ({ sequence_number: index + 1, ...item }));
  const emittedByRule: Partial<Record<DeterministicPersonARuleId, number>> = {};
  for (const item of ruleResults.filter((entry) => entry.status === 'emitted')) {
    emittedByRule[item.rule_id] = (emittedByRule[item.rule_id] ?? 0) + 1;
  }
  return detachedPlainJson({
    assessments: selected.map((candidate) => candidate.assessment),
    audit: {
      version: DETERMINISTIC_PERSON_A_ASSESSMENT_VERSION,
      rule_results: ruleResults,
      summary: {
        assessments_emitted: selected.length,
        candidates_suppressed: ruleResults.filter((item) => item.status === 'suppressed').length,
        candidates_rejected: ruleResults.filter((item) => item.status === 'rejected').length,
        emitted_by_rule: emittedByRule,
      },
    },
  });
}

export class DeterministicPersonAAssessmentProvider implements RuntimeAssessmentProvider {
  readonly #config: DeterministicPersonAAssessmentConfig;
  #lastAudit: DeterministicPersonAAssessmentAudit | null = null;

  constructor(config: DeterministicPersonAAssessmentConfig = {}) {
    this.#config = detachedPlainJson(config);
    normalizedConfig(this.#config);
  }

  assess(context: RuntimeAssessmentContext): EpistemicAssessment[] {
    const result = assessDeterministicPersonAEpistemicGaps(context, this.#config);
    this.#lastAudit = detachedPlainJson(result.audit);
    return detachedPlainJson(result.assessments);
  }

  getLastAudit(): DeterministicPersonAAssessmentAudit | null {
    return this.#lastAudit === null ? null : detachedPlainJson(this.#lastAudit);
  }
}

export function createDeterministicPersonAAssessmentProvider(
  config: DeterministicPersonAAssessmentConfig = {},
): DeterministicPersonAAssessmentProvider {
  return new DeterministicPersonAAssessmentProvider(config);
}
