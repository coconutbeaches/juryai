import { isDeepStrictEqual } from 'node:util';

export type AttributionStatus = 'explicit' | 'inferred' | 'unstated';
export type CausalLinkStatus = 'explicit' | 'inferred' | 'disputed' | 'unstated';
export type MergeRisk = 'none' | 'possible_merge' | 'possible_split';
export type Materiality = 'critical' | 'high' | 'medium' | 'low';
export type ClarificationQuestionPhase = 'pre_lock' | 'post_lock';
export type ClarificationAmendmentPhase = 'post_lock_amendment';

export type ClarificationTriggerKind =
  | 'actor_attribution'
  | 'causal_link'
  | 'merge_risk'
  | 'evidence_availability'
  | 'date_precision'
  | 'required_bucket_missing'
  | 'internal_representation';

export interface EpistemicAssessment {
  target_object_id: string;
  target_family: string;
  field: string;
  trigger: ClarificationTriggerKind;
  materiality: Materiality;
  actor_attribution?: AttributionStatus;
  causal_link_status?: CausalLinkStatus;
  merge_risk?: MergeRisk;
  evidence_availability?: 'available' | 'described_only' | 'unavailable' | 'unknown';
  date_precision?: 'day' | 'month' | 'year' | 'range' | 'unknown';
  question_context?: string;
  resolves_object_ids?: string[];
}

export interface GeneratedClarificationQuestion {
  question_id: string;
  target_object_id: string;
  target_family: string;
  field: string;
  trigger: Exclude<ClarificationTriggerKind, 'internal_representation'>;
  materiality: Materiality;
  question: string;
  phase: ClarificationQuestionPhase;
  resolves_object_ids: string[];
}

export interface ClarificationAmendment {
  amendment_id: string;
  target_object_id: string;
  field: string;
  prior_value: unknown;
  new_value: unknown;
  response_text: string;
  created_at: string;
  phase: ClarificationAmendmentPhase;
  supersedes: string | null;
}

export type AmendmentIssueCode =
  | 'different_target'
  | 'duplicate_amendment_id'
  | 'immutable_or_unknown_field'
  | 'invalid_amendment'
  | 'invalid_supersedes'
  | 'missing_supersedes'
  | 'no_value_change'
  | 'stale_prior_value';

export interface AmendmentProjectionIssue {
  amendment_id: string | null;
  code: AmendmentIssueCode;
  message: string;
}

export interface AmendmentProjectionResult<T> {
  projected: T;
  applied: ClarificationAmendment[];
  ignored: AmendmentProjectionIssue[];
  rejected: AmendmentProjectionIssue[];
}

const materialityRank: Record<Materiality, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const weaknessRank: Record<ClarificationTriggerKind, number> = {
  required_bucket_missing: 6,
  actor_attribution: 5,
  causal_link: 4,
  merge_risk: 3,
  evidence_availability: 2,
  date_precision: 1,
  internal_representation: 0,
};

const materialities = new Set<Materiality>(['critical', 'high', 'medium', 'low']);
const triggerKinds = new Set<ClarificationTriggerKind>([
  'actor_attribution',
  'causal_link',
  'merge_risk',
  'evidence_availability',
  'date_precision',
  'required_bucket_missing',
  'internal_representation',
]);
const attributionStatuses = new Set<AttributionStatus>(['explicit', 'inferred', 'unstated']);
const causalStatuses = new Set<CausalLinkStatus>(['explicit', 'inferred', 'disputed', 'unstated']);
const mergeRisks = new Set<MergeRisk>(['none', 'possible_merge', 'possible_split']);
const evidenceStatuses = new Set(['available', 'described_only', 'unavailable', 'unknown']);
const datePrecisions = new Set(['day', 'month', 'year', 'range', 'unknown']);
const amendmentFields = new Set([
  'amendment_id',
  'target_object_id',
  'field',
  'prior_value',
  'new_value',
  'response_text',
  'created_at',
  'phase',
  'supersedes',
]);
const forbiddenAmendmentFields = new Set(['__proto__', 'constructor', 'prototype', 'object_id']);

interface PreparedAssessment {
  assessment: EpistemicAssessment;
  context: string;
  dedupeKey: string;
  stableKey: string;
  resolvesObjectIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lexicalCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeQuestionContext(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('question_context must be supplied for every generated question');
  }
  const normalized = value
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/[.!,:;]+$/u, '');
  if (normalized.length === 0 || normalized.length > 160 || /[\p{C}<>?]/u.test(normalized)) {
    throw new TypeError('question_context must be safe plain text between 1 and 160 characters');
  }
  return normalized;
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]+$/u.test(value) || value.length > 160) {
    throw new TypeError(`${label} must be a non-empty stable identifier`);
  }
}

function assertAssessment(value: unknown, index: number): asserts value is EpistemicAssessment {
  if (!isRecord(value)) {
    throw new TypeError(`assessment[${index}] must be an object`);
  }
  assertIdentifier(value.target_object_id, `assessment[${index}].target_object_id`);
  assertIdentifier(value.target_family, `assessment[${index}].target_family`);
  assertIdentifier(value.field, `assessment[${index}].field`);
  if (!triggerKinds.has(value.trigger as ClarificationTriggerKind)) {
    throw new TypeError(`assessment[${index}].trigger is invalid`);
  }
  if (!materialities.has(value.materiality as Materiality)) {
    throw new TypeError(`assessment[${index}].materiality is invalid`);
  }
  if (value.resolves_object_ids !== undefined) {
    if (!Array.isArray(value.resolves_object_ids)) {
      throw new TypeError(`assessment[${index}].resolves_object_ids must be an array`);
    }
    value.resolves_object_ids.forEach((objectId, objectIndex) =>
      assertIdentifier(objectId, `assessment[${index}].resolves_object_ids[${objectIndex}]`),
    );
  }

  switch (value.trigger) {
    case 'actor_attribution':
      if (!attributionStatuses.has(value.actor_attribution as AttributionStatus)) {
        throw new TypeError(`assessment[${index}].actor_attribution is invalid`);
      }
      break;
    case 'causal_link':
      if (!causalStatuses.has(value.causal_link_status as CausalLinkStatus)) {
        throw new TypeError(`assessment[${index}].causal_link_status is invalid`);
      }
      break;
    case 'merge_risk':
      if (!mergeRisks.has(value.merge_risk as MergeRisk)) {
        throw new TypeError(`assessment[${index}].merge_risk is invalid`);
      }
      break;
    case 'evidence_availability':
      if (!evidenceStatuses.has(value.evidence_availability as string)) {
        throw new TypeError(`assessment[${index}].evidence_availability is invalid`);
      }
      break;
    case 'date_precision':
      if (!datePrecisions.has(value.date_precision as string)) {
        throw new TypeError(`assessment[${index}].date_precision is invalid`);
      }
      break;
    case 'required_bucket_missing':
    case 'internal_representation':
      break;
  }
}

function needsHumanClarification(assessment: EpistemicAssessment): boolean {
  switch (assessment.trigger) {
    case 'internal_representation':
      return false;
    case 'actor_attribution':
      return assessment.actor_attribution !== 'explicit';
    case 'causal_link':
      return (
        assessment.causal_link_status === 'inferred' || assessment.causal_link_status === 'unstated'
      );
    case 'merge_risk':
      return assessment.merge_risk !== 'none';
    case 'evidence_availability':
      return (
        assessment.evidence_availability === 'described_only' ||
        assessment.evidence_availability === 'unknown'
      );
    case 'date_precision':
      return assessment.date_precision === 'unknown';
    case 'required_bucket_missing':
      return true;
  }
}

function normalizedCoverage(assessment: EpistemicAssessment): string[] {
  return [
    ...new Set([assessment.target_object_id, ...(assessment.resolves_object_ids ?? [])]),
  ].sort(lexicalCompare);
}

function prepareAssessment(assessment: EpistemicAssessment): PreparedAssessment {
  const resolvesObjectIds = normalizedCoverage(assessment);
  const context = normalizeQuestionContext(assessment.question_context);
  return {
    assessment,
    context,
    dedupeKey: `${assessment.target_object_id}|${assessment.field}`,
    stableKey: JSON.stringify([
      assessment.target_object_id,
      assessment.target_family,
      assessment.field,
      assessment.trigger,
      context,
      resolvesObjectIds,
    ]),
    resolvesObjectIds,
  };
}

function comparePrepared(left: PreparedAssessment, right: PreparedAssessment): number {
  const materiality =
    materialityRank[right.assessment.materiality] - materialityRank[left.assessment.materiality];
  if (materiality !== 0) return materiality;
  const weakness = weaknessRank[right.assessment.trigger] - weaknessRank[left.assessment.trigger];
  if (weakness !== 0) return weakness;
  const coverage = right.resolvesObjectIds.length - left.resolvesObjectIds.length;
  if (coverage !== 0) return coverage;
  return lexicalCompare(left.stableKey, right.stableKey);
}

function questionText(prepared: PreparedAssessment): string {
  const { assessment, context } = prepared;
  switch (assessment.trigger) {
    case 'actor_attribution':
      return `Who performed this action — ${context}?`;
    case 'causal_link':
      return `Did this event cause the claimed delay or loss — ${context}?`;
    case 'merge_risk':
      return assessment.merge_risk === 'possible_split'
        ? `Does this describe one item, or should it be split into separate items — ${context}?`
        : `Are these separate items, or one combined item — ${context}?`;
    case 'evidence_availability':
      return assessment.evidence_availability === 'described_only'
        ? `Do you currently have the evidence described here — ${context}?`
        : `Is this evidence available to you — ${context}?`;
    case 'date_precision':
      return `Approximately when did this happen — ${context}?`;
    case 'required_bucket_missing':
      return `What is the missing ${assessment.target_family.replaceAll('_', ' ')} information — ${context}?`;
    case 'internal_representation':
      throw new Error('Internal representation triggers must never become user questions.');
  }
}

export function generateClarificationQuestions(
  assessments: readonly EpistemicAssessment[],
  options: { maxQuestions?: number; phase?: ClarificationQuestionPhase } = {},
): GeneratedClarificationQuestion[] {
  if (!Array.isArray(assessments)) {
    throw new TypeError('assessments must be an array');
  }
  const requestedMaximum = options.maxQuestions ?? 6;
  if (!Number.isInteger(requestedMaximum) || requestedMaximum < 0) {
    throw new TypeError('maxQuestions must be a non-negative integer');
  }
  const maxQuestions = Math.min(requestedMaximum, 6);
  const phase = options.phase ?? 'pre_lock';
  if (phase !== 'pre_lock' && phase !== 'post_lock') {
    throw new TypeError('phase must be pre_lock or post_lock');
  }

  const unique = new Map<string, PreparedAssessment>();
  assessments.forEach((assessment, index) => {
    assertAssessment(assessment, index);
    if (!needsHumanClarification(assessment)) return;
    const prepared = prepareAssessment(assessment);
    const existing = unique.get(prepared.dedupeKey);
    if (!existing || comparePrepared(prepared, existing) < 0) {
      unique.set(prepared.dedupeKey, prepared);
    }
  });

  return [...unique.values()]
    .sort(comparePrepared)
    .slice(0, maxQuestions)
    .map((prepared, index) => ({
      question_id: `clarification_${String(index + 1).padStart(2, '0')}`,
      target_object_id: prepared.assessment.target_object_id,
      target_family: prepared.assessment.target_family,
      field: prepared.assessment.field,
      trigger: prepared.assessment.trigger as Exclude<
        ClarificationTriggerKind,
        'internal_representation'
      >,
      materiality: prepared.assessment.materiality,
      question: questionText(prepared),
      phase,
      resolves_object_ids: prepared.resolvesObjectIds,
    }));
}

function isJsonValue(value: unknown, ancestors = new Set<unknown>()): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== 'object' || value === null || ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Object.entries(value).every(
        ([key, entry]) => !forbiddenAmendmentFields.has(key) && isJsonValue(entry, ancestors),
      );
  ancestors.delete(value);
  return valid;
}

function isRfc3339Utc(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/u.exec(value);
  if (!match) return false;
  const milliseconds = (match[2] ?? '').padEnd(3, '0');
  const canonicalInput = `${match[1]}.${milliseconds || '000'}Z`;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === canonicalInput;
}

function amendmentIssue(
  amendmentId: string | null,
  code: AmendmentIssueCode,
  message: string,
): AmendmentProjectionIssue {
  return { amendment_id: amendmentId, code, message };
}

function validateAmendment(
  value: unknown,
  index: number,
): { amendment?: ClarificationAmendment; issue?: AmendmentProjectionIssue } {
  const fallbackId =
    isRecord(value) && typeof value.amendment_id === 'string' ? value.amendment_id : null;
  if (!isRecord(value) || Object.keys(value).some((key) => !amendmentFields.has(key))) {
    return {
      issue: amendmentIssue(
        fallbackId,
        'invalid_amendment',
        `amendment[${index}] must contain only the documented fields`,
      ),
    };
  }
  try {
    assertIdentifier(value.amendment_id, `amendment[${index}].amendment_id`);
    assertIdentifier(value.target_object_id, `amendment[${index}].target_object_id`);
  } catch (error) {
    return {
      issue: amendmentIssue(
        fallbackId,
        'invalid_amendment',
        error instanceof Error ? error.message : `amendment[${index}] is invalid`,
      ),
    };
  }
  if (
    typeof value.field !== 'string' ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value.field) ||
    forbiddenAmendmentFields.has(value.field)
  ) {
    return {
      issue: amendmentIssue(
        value.amendment_id,
        'immutable_or_unknown_field',
        'field must be a safe mutable top-level field',
      ),
    };
  }
  if (
    typeof value.response_text !== 'string' ||
    value.response_text.trim().length === 0 ||
    value.response_text.length > 10_000 ||
    /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(
      value.response_text,
    )
  ) {
    return {
      issue: amendmentIssue(
        value.amendment_id,
        'invalid_amendment',
        'response_text must be non-empty auditable text',
      ),
    };
  }
  let supersedesIsValid = value.supersedes === null;
  if (typeof value.supersedes === 'string' && value.supersedes !== value.amendment_id) {
    try {
      assertIdentifier(value.supersedes, `amendment[${index}].supersedes`);
      supersedesIsValid = true;
    } catch {
      supersedesIsValid = false;
    }
  }
  if (
    typeof value.created_at !== 'string' ||
    !isRfc3339Utc(value.created_at) ||
    value.phase !== 'post_lock_amendment' ||
    !supersedesIsValid ||
    !isJsonValue(value.prior_value) ||
    !isJsonValue(value.new_value)
  ) {
    return {
      issue: amendmentIssue(
        value.amendment_id,
        'invalid_amendment',
        'amendment timestamp, phase, supersedes, or values are invalid',
      ),
    };
  }
  if (isDeepStrictEqual(value.prior_value, value.new_value)) {
    return {
      issue: amendmentIssue(
        value.amendment_id,
        'no_value_change',
        'an amendment must change the field value',
      ),
    };
  }
  return { amendment: value as unknown as ClarificationAmendment };
}

function compareAmendments(left: ClarificationAmendment, right: ClarificationAmendment): number {
  const timestamp = Date.parse(left.created_at) - Date.parse(right.created_at);
  return timestamp || lexicalCompare(left.amendment_id, right.amendment_id);
}

function compareIssues(left: AmendmentProjectionIssue, right: AmendmentProjectionIssue): number {
  return (
    lexicalCompare(left.amendment_id ?? '', right.amendment_id ?? '') ||
    lexicalCompare(left.code, right.code) ||
    lexicalCompare(left.message, right.message)
  );
}

export function projectAmendments<T extends Record<string, unknown>>(
  original: T,
  amendments: readonly unknown[],
): AmendmentProjectionResult<T> {
  if (!isRecord(original)) {
    throw new TypeError('original must be an object');
  }
  if (!Object.prototype.hasOwnProperty.call(original, 'object_id')) {
    throw new TypeError('original.object_id must be an own property');
  }
  assertIdentifier(original.object_id, 'original.object_id');
  if (!Array.isArray(amendments)) {
    throw new TypeError('amendments must be an array');
  }

  const projected = structuredClone(original);
  const writable = projected as Record<string, unknown>;
  const rejected: AmendmentProjectionIssue[] = [];
  const ignored: AmendmentProjectionIssue[] = [];
  const valid: ClarificationAmendment[] = [];

  amendments.forEach((value, index) => {
    const result = validateAmendment(value, index);
    if (result.issue) rejected.push(result.issue);
    if (result.amendment) valid.push(result.amendment);
  });

  const idCounts = new Map<string, number>();
  valid.forEach((amendment) =>
    idCounts.set(amendment.amendment_id, (idCounts.get(amendment.amendment_id) ?? 0) + 1),
  );
  const candidates = valid
    .filter((amendment) => {
      if ((idCounts.get(amendment.amendment_id) ?? 0) > 1) {
        rejected.push(
          amendmentIssue(
            amendment.amendment_id,
            'duplicate_amendment_id',
            'duplicate amendment IDs are not auditable',
          ),
        );
        return false;
      }
      if (amendment.target_object_id !== original.object_id) {
        ignored.push(
          amendmentIssue(
            amendment.amendment_id,
            'different_target',
            `amendment targets ${amendment.target_object_id}, not ${original.object_id}`,
          ),
        );
        return false;
      }
      if (!Object.prototype.hasOwnProperty.call(original, amendment.field)) {
        rejected.push(
          amendmentIssue(
            amendment.amendment_id,
            'immutable_or_unknown_field',
            `field ${amendment.field} is not a mutable field on the original object`,
          ),
        );
        return false;
      }
      return true;
    })
    .sort(compareAmendments);

  const candidateIds = new Set(candidates.map((amendment) => amendment.amendment_id));
  const pending = [...candidates];
  const applied: ClarificationAmendment[] = [];
  const appliedById = new Map<string, ClarificationAmendment>();
  const latestByField = new Map<string, ClarificationAmendment>();

  while (pending.length > 0) {
    let madeProgress = false;
    for (let index = 0; index < pending.length;) {
      const amendment = pending[index]!;
      if (
        amendment.supersedes !== null &&
        candidateIds.has(amendment.supersedes) &&
        !appliedById.has(amendment.supersedes)
      ) {
        index += 1;
        continue;
      }

      pending.splice(index, 1);
      madeProgress = true;
      const latest = latestByField.get(amendment.field);
      const superseded =
        amendment.supersedes === null ? undefined : appliedById.get(amendment.supersedes);

      if (
        amendment.supersedes !== null &&
        (!superseded ||
          superseded.field !== amendment.field ||
          Date.parse(amendment.created_at) < Date.parse(superseded.created_at))
      ) {
        rejected.push(
          amendmentIssue(
            amendment.amendment_id,
            'invalid_supersedes',
            'supersedes must reference an earlier applied amendment for the same field',
          ),
        );
        continue;
      }
      if (latest && amendment.supersedes === null) {
        rejected.push(
          amendmentIssue(
            amendment.amendment_id,
            'missing_supersedes',
            `a later amendment to ${amendment.field} must supersede ${latest.amendment_id}`,
          ),
        );
        continue;
      }
      if (latest && amendment.supersedes !== latest.amendment_id) {
        rejected.push(
          amendmentIssue(
            amendment.amendment_id,
            'invalid_supersedes',
            `supersedes must reference the latest amendment ${latest.amendment_id}`,
          ),
        );
        continue;
      }
      if (!isDeepStrictEqual(writable[amendment.field], amendment.prior_value)) {
        rejected.push(
          amendmentIssue(
            amendment.amendment_id,
            'stale_prior_value',
            `prior_value does not match the current projected ${amendment.field}`,
          ),
        );
        continue;
      }

      writable[amendment.field] = structuredClone(amendment.new_value);
      const auditCopy = structuredClone(amendment);
      applied.push(auditCopy);
      appliedById.set(amendment.amendment_id, auditCopy);
      latestByField.set(amendment.field, auditCopy);
    }
    if (!madeProgress) {
      pending
        .splice(0)
        .forEach((amendment) =>
          rejected.push(
            amendmentIssue(
              amendment.amendment_id,
              'invalid_supersedes',
              'supersedes chain is cyclic, missing, or depends on a rejected amendment',
            ),
          ),
        );
    }
  }

  return {
    projected,
    applied,
    ignored: ignored.sort(compareIssues),
    rejected: rejected.sort(compareIssues),
  };
}
