import {
  familyItems,
  type PersonAAlignment,
  type PersonAFamily,
} from '../alignment/person-a-alignment-corrected.js';
import type {
  ErrorSeverity,
  EvaluationError,
  PersonAEvaluationReport,
} from '../evaluation/person-a-diff.js';
import type { EpistemicAssessment, Materiality } from './question-generator.js';

type JsonObject = Record<string, any>;

export const PERSON_A_ASSESSMENT_ADAPTER_VERSION = 'person-a-assessments-v0.1.0';

export interface ExcludedInternalIssue {
  family: PersonAFamily;
  code: string;
  reason: string;
  extracted_id?: string;
  golden_id?: string;
}

export interface PersonAAssessmentBuildResult {
  assessments: EpistemicAssessment[];
  excluded_internal_issues: ExcludedInternalIssue[];
}

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

const familyIdKeys: Record<PersonAFamily, string> = {
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

const validSeverities = new Set<ErrorSeverity>(['critical', 'major', 'minor']);
const validMaterialities = new Set<Materiality>(['critical', 'high', 'medium', 'low']);
const validFamilies = new Set<PersonAFamily>(families);
const mergeFamilies = new Set<PersonAFamily>(['deliverables', 'timeline', 'claims', 'evidence']);

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is JsonObject {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (!/^[A-Za-z0-9_.:-]+$/u.test(value) || value.length > 160) {
    throw new TypeError(`${label} must be a stable identifier`);
  }
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

function assertIndex(value: unknown, label: string, length: number): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= length) {
    throw new TypeError(`${label} must reference an existing array index`);
  }
}

function assertNonnegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
}

function materialityFromSeverity(severity: ErrorSeverity): Materiality {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'major':
      return 'high';
    case 'minor':
      return 'low';
  }
}

function objectMateriality(item: JsonObject, fallback: Materiality): Materiality {
  for (const value of [item.materiality, item.relevance, item.severity]) {
    if (validMaterialities.has(value as Materiality)) return value as Materiality;
    if (value === 'major') return 'high';
    if (value === 'minor') return 'low';
  }
  return fallback;
}

function contextFragment(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\p{C}<>?]/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/[.!,:;]+$/u, '');
  if (!normalized) return null;
  if (normalized.length <= 160) return normalized;
  const clipped = normalized.slice(0, 160);
  const punctuationBoundary = Math.max(
    clipped.lastIndexOf('.'),
    clipped.lastIndexOf(','),
    clipped.lastIndexOf(';'),
  );
  if (punctuationBoundary >= 80) {
    return clipped.slice(0, punctuationBoundary).trimEnd();
  }
  const wordBoundary = clipped.lastIndexOf(' ');
  return (wordBoundary >= 80 ? clipped.slice(0, wordBoundary) : clipped)
    .trimEnd()
    .replace(/[.!,:;]+$/u, '');
}

function exactSourceContext(item: JsonObject): string | null {
  if (!Array.isArray(item.source_spans)) return null;
  for (const span of item.source_spans) {
    if (!isRecord(span)) continue;
    const context = contextFragment(span.quote);
    if (context) return context;
  }
  return null;
}

function objectLabel(family: PersonAFamily, item: JsonObject): string | null {
  const candidates: unknown[] = [];
  switch (family) {
    case 'agreement_terms':
      candidates.push(item.wording, item.person_a_interpretation);
      break;
    case 'deliverables':
      candidates.push(item.name);
      break;
    case 'timeline':
      candidates.push(item.event_summary);
      break;
    case 'claims':
      candidates.push(item.claim_text);
      break;
    case 'evidence':
      candidates.push(item.title, item.description_from_submitter);
      break;
    case 'damages':
      candidates.push(item.causal_theory, item.calculation_basis);
      break;
    case 'outcomes':
      candidates.push(item.rationale);
      break;
    case 'third_parties':
      candidates.push(item.name_or_label, item.role);
      break;
    case 'extraction_issues':
      candidates.push(item.description);
      break;
    case 'clarification_questions':
      candidates.push(item.question, item.reason);
      break;
  }
  for (const candidate of candidates) {
    const context = contextFragment(candidate);
    if (context) return context;
  }
  return null;
}

function groundedContext(family: PersonAFamily, item: JsonObject, fallback?: string): string {
  const labelFirst = ['deliverables', 'evidence', 'damages', 'extraction_issues'].includes(family);
  const context = labelFirst
    ? (objectLabel(family, item) ?? exactSourceContext(item) ?? contextFragment(fallback))
    : (exactSourceContext(item) ?? objectLabel(family, item) ?? contextFragment(fallback));
  if (!context) {
    throw new TypeError(
      `Cannot derive grounded question_context for ${family}/${String(item[familyIdKeys[family]])}`,
    );
  }
  return context;
}

function stableAssessmentKey(assessment: EpistemicAssessment): string {
  return JSON.stringify([
    assessment.target_object_id,
    assessment.target_family,
    assessment.field,
    assessment.trigger,
    assessment.materiality,
    assessment.actor_attribution ?? null,
    assessment.causal_link_status ?? null,
    assessment.merge_risk ?? null,
    assessment.evidence_availability ?? null,
    assessment.date_precision ?? null,
    assessment.question_context ?? null,
    [...(assessment.resolves_object_ids ?? [])].sort(),
  ]);
}

function stableIssueKey(issue: ExcludedInternalIssue): string {
  return JSON.stringify([
    issue.family,
    issue.code,
    issue.extracted_id ?? null,
    issue.golden_id ?? null,
    issue.reason,
  ]);
}

function validateExtraction(
  extractionValue: unknown,
): Record<PersonAFamily, { items: JsonObject[]; byId: Map<string, JsonObject> }> {
  assertRecord(extractionValue, 'extraction');
  const result = {} as Record<
    PersonAFamily,
    { items: JsonObject[]; byId: Map<string, JsonObject> }
  >;

  for (const family of families) {
    const items = familyItems(extractionValue, family);
    if (!Array.isArray(items)) throw new TypeError(`extraction ${family} must be an array`);
    const byId = new Map<string, JsonObject>();
    items.forEach((item, index) => {
      assertRecord(item, `extraction ${family}[${index}]`);
      const id = item[familyIdKeys[family]];
      assertIdentifier(id, `extraction ${family}[${index}].${familyIdKeys[family]}`);
      if (byId.has(id)) throw new TypeError(`extraction ${family} contains duplicate ID ${id}`);
      byId.set(id, item);
    });
    result[family] = { items, byId };
  }
  return result;
}

function validateReport(value: unknown): PersonAEvaluationReport {
  assertRecord(value, 'report');
  if (value.version !== 'person-a-evaluation-v0.1.0') {
    throw new TypeError('report.version is invalid');
  }
  if (value.schema_version !== '0.1.2') throw new TypeError('report.schema_version is invalid');
  assertRecord(value.summary, 'report.summary');
  for (const field of ['critical', 'major', 'minor', 'human_edit_rate', 'weighted_error_rate']) {
    assertFiniteNumber(value.summary[field], `report.summary.${field}`);
  }
  assertRecord(value.metrics, 'report.metrics');
  for (const family of families) {
    const metric = value.metrics[family];
    assertRecord(metric, `report.metrics.${family}`);
    for (const field of ['matched', 'golden_total', 'extracted_total', 'recall', 'precision']) {
      assertFiniteNumber(metric[field], `report.metrics.${family}.${field}`);
    }
  }
  assertArray(value.errors, 'report.errors');
  value.errors.forEach((error, index) => {
    assertRecord(error, `report.errors[${index}]`);
    if (!validSeverities.has(error.severity as ErrorSeverity)) {
      throw new TypeError(`report.errors[${index}].severity is invalid`);
    }
    if (!validFamilies.has(error.family as PersonAFamily)) {
      throw new TypeError(`report.errors[${index}].family is invalid`);
    }
    assertIdentifier(error.code, `report.errors[${index}].code`);
    assertString(error.message, `report.errors[${index}].message`);
    if (error.extracted_id !== undefined) {
      assertIdentifier(error.extracted_id, `report.errors[${index}].extracted_id`);
    }
    if (error.golden_id !== undefined) {
      assertIdentifier(error.golden_id, `report.errors[${index}].golden_id`);
    }
  });
  return value as PersonAEvaluationReport;
}

function validateAlignment(
  value: unknown,
  extractionIndex: Record<PersonAFamily, { items: JsonObject[]; byId: Map<string, JsonObject> }>,
): {
  alignment: PersonAAlignment;
  goldenIds: Record<PersonAFamily, Set<string>>;
} {
  assertRecord(value, 'alignment');
  if (value.version !== 'person-a-alignment-v0.1.0') {
    throw new TypeError('alignment.version is invalid');
  }
  assertRecord(value.families, 'alignment.families');
  const goldenIds = {} as Record<PersonAFamily, Set<string>>;

  for (const family of families) {
    const familyAlignment = value.families[family];
    assertRecord(familyAlignment, `alignment.families.${family}`);
    if (familyAlignment.family !== family) {
      throw new TypeError(`alignment.families.${family}.family is invalid`);
    }
    for (const key of ['pairs', 'ambiguous', 'unmatched_extracted', 'unmatched_golden']) {
      assertArray(familyAlignment[key], `alignment.families.${family}.${key}`);
    }
    const ids = new Set<string>();
    familyAlignment.pairs.forEach((pair: unknown, index: number) => {
      assertRecord(pair, `alignment.families.${family}.pairs[${index}]`);
      assertIndex(
        pair.extracted_index,
        `alignment.families.${family}.pairs[${index}].extracted_index`,
        extractionIndex[family].items.length,
      );
      assertIdentifier(
        pair.extracted_id,
        `alignment.families.${family}.pairs[${index}].extracted_id`,
      );
      assertIdentifier(pair.golden_id, `alignment.families.${family}.pairs[${index}].golden_id`);
      assertNonnegativeInteger(
        pair.golden_index,
        `alignment.families.${family}.pairs[${index}].golden_index`,
      );
      assertFiniteNumber(pair.score, `alignment.families.${family}.pairs[${index}].score`);
      assertFiniteNumber(pair.margin, `alignment.families.${family}.pairs[${index}].margin`);
      const actualId = extractionIndex[family].items[pair.extracted_index]?.[familyIdKeys[family]];
      if (actualId !== pair.extracted_id) {
        throw new TypeError(`alignment pair references the wrong ${family} extracted object`);
      }
      ids.add(pair.golden_id);
    });
    familyAlignment.ambiguous.forEach((entry: unknown, index: number) => {
      assertRecord(entry, `alignment.families.${family}.ambiguous[${index}]`);
      assertIndex(
        entry.extracted_index,
        `alignment.families.${family}.ambiguous[${index}].extracted_index`,
        extractionIndex[family].items.length,
      );
      assertIdentifier(
        entry.extracted_id,
        `alignment.families.${family}.ambiguous[${index}].extracted_id`,
      );
      const actualId = extractionIndex[family].items[entry.extracted_index]?.[familyIdKeys[family]];
      if (actualId !== entry.extracted_id) {
        throw new TypeError(`alignment ambiguity references the wrong ${family} object`);
      }
      assertArray(entry.candidates, `alignment.families.${family}.ambiguous[${index}].candidates`);
      entry.candidates.forEach((candidate: unknown, candidateIndex: number) => {
        assertRecord(
          candidate,
          `alignment.families.${family}.ambiguous[${index}].candidates[${candidateIndex}]`,
        );
        assertIdentifier(
          candidate.golden_id,
          `alignment.families.${family}.ambiguous[${index}].candidates[${candidateIndex}].golden_id`,
        );
        assertNonnegativeInteger(
          candidate.golden_index,
          `alignment.families.${family}.ambiguous[${index}].candidates[${candidateIndex}].golden_index`,
        );
        assertFiniteNumber(
          candidate.score,
          `alignment.families.${family}.ambiguous[${index}].candidates[${candidateIndex}].score`,
        );
        ids.add(candidate.golden_id);
      });
    });
    familyAlignment.unmatched_extracted.forEach((entry: unknown, index: number) => {
      assertRecord(entry, `alignment.families.${family}.unmatched_extracted[${index}]`);
      assertIndex(
        entry.index,
        `alignment.families.${family}.unmatched_extracted[${index}].index`,
        extractionIndex[family].items.length,
      );
      assertIdentifier(entry.id, `alignment.families.${family}.unmatched_extracted[${index}].id`);
      const actualId = extractionIndex[family].items[entry.index]?.[familyIdKeys[family]];
      if (actualId !== entry.id) {
        throw new TypeError(`alignment unmatched entry references the wrong ${family} object`);
      }
    });
    familyAlignment.unmatched_golden.forEach((entry: unknown, index: number) => {
      assertRecord(entry, `alignment.families.${family}.unmatched_golden[${index}]`);
      assertIdentifier(entry.id, `alignment.families.${family}.unmatched_golden[${index}].id`);
      assertNonnegativeInteger(
        entry.index,
        `alignment.families.${family}.unmatched_golden[${index}].index`,
      );
      ids.add(entry.id);
    });
    goldenIds[family] = ids;
  }

  return { alignment: value as PersonAAlignment, goldenIds };
}

function reportObject(
  error: EvaluationError,
  extractionIndex: Record<PersonAFamily, { items: JsonObject[]; byId: Map<string, JsonObject> }>,
  goldenIds: Record<PersonAFamily, Set<string>>,
): JsonObject | null {
  if (error.golden_id && !goldenIds[error.family].has(error.golden_id)) {
    throw new TypeError(
      `report ${error.family}/${error.code} references missing golden object ${error.golden_id}`,
    );
  }
  if (error.extracted_id) {
    const item = extractionIndex[error.family].byId.get(error.extracted_id);
    if (!item) {
      throw new TypeError(
        `report ${error.family}/${error.code} references missing extracted object ${error.extracted_id}`,
      );
    }
    return item;
  }
  return null;
}

function internalReason(error: EvaluationError): string {
  if (error.family === 'clarification_questions') {
    return 'Clarification-question alignment is evaluation bookkeeping, not a user fact gap.';
  }
  if (error.code === 'missing_golden_object') {
    return 'A missing golden alignment object is not sufficient evidence of missing user information.';
  }
  if (error.code === 'unsupported_extra_object') {
    return 'A fabrication hard failure must not be converted into a clarification question.';
  }
  return 'The discrepancy requires deterministic representation, validation, or evaluation handling.';
}

function buildResult(
  report: PersonAEvaluationReport,
  extractionIndex: Record<PersonAFamily, { items: JsonObject[]; byId: Map<string, JsonObject> }>,
  goldenIds: Record<PersonAFamily, Set<string>>,
): PersonAAssessmentBuildResult {
  const assessments: EpistemicAssessment[] = [];
  const excluded: ExcludedInternalIssue[] = [];

  const addAssessment = (assessment: EpistemicAssessment): void => {
    assessments.push(assessment);
  };

  for (const error of report.errors) {
    const item = reportObject(error, extractionIndex, goldenIds);
    const materiality = item
      ? objectMateriality(item, materialityFromSeverity(error.severity))
      : materialityFromSeverity(error.severity);
    const resolves = [error.extracted_id, error.golden_id].filter(
      (value): value is string => typeof value === 'string',
    );

    if (
      error.family === 'timeline' &&
      item &&
      ['actor_specificity', 'actor_reversed'].includes(error.code)
    ) {
      addAssessment({
        target_object_id: error.extracted_id!,
        target_family: 'timeline',
        field: 'actor_party_id',
        trigger: 'actor_attribution',
        materiality,
        actor_attribution:
          item.actor_party_id === null && item.actor_third_party_id === null
            ? 'unstated'
            : 'inferred',
        question_context: groundedContext('timeline', item, error.message),
        resolves_object_ids: resolves,
      });
      continue;
    }

    if (error.family === 'damages' && error.code === 'causal_theory' && item) {
      addAssessment({
        target_object_id: error.extracted_id!,
        target_family: 'damages',
        field: 'causal_theory',
        trigger: 'causal_link',
        materiality,
        causal_link_status: 'inferred',
        question_context: groundedContext('damages', item, error.message),
        resolves_object_ids: [
          ...resolves,
          ...(Array.isArray(item.source_claim_ids) ? item.source_claim_ids : []),
        ],
      });
      continue;
    }

    if (
      item &&
      mergeFamilies.has(error.family) &&
      ['granularity_split', 'source_grounded_extra_object'].includes(error.code)
    ) {
      addAssessment({
        target_object_id: error.extracted_id!,
        target_family: error.family,
        field: 'identity',
        trigger: 'merge_risk',
        materiality,
        merge_risk: error.code === 'granularity_split' ? 'possible_split' : 'possible_merge',
        question_context: groundedContext(error.family, item, error.message),
        resolves_object_ids: resolves,
      });
      continue;
    }

    const targetId = error.extracted_id ?? error.golden_id ?? `${error.family}:${error.code}`;
    addAssessment({
      target_object_id: targetId,
      target_family: error.family,
      field: error.code,
      trigger: 'internal_representation',
      materiality,
      resolves_object_ids: resolves,
    });
    excluded.push({
      family: error.family,
      code: error.code,
      reason: internalReason(error),
      ...(error.extracted_id ? { extracted_id: error.extracted_id } : {}),
      ...(error.golden_id ? { golden_id: error.golden_id } : {}),
    });
  }

  for (const evidence of extractionIndex.evidence.items) {
    const availability = evidence.availability_status;
    if (!['available', 'described_only', 'unavailable', 'unknown'].includes(availability)) {
      continue;
    }
    addAssessment({
      target_object_id: evidence.evidence_id,
      target_family: 'evidence',
      field: 'availability_status',
      trigger: 'evidence_availability',
      materiality: objectMateriality(evidence, 'medium'),
      evidence_availability: availability,
      ...(availability === 'described_only' || availability === 'unknown'
        ? { question_context: groundedContext('evidence', evidence) }
        : {}),
      resolves_object_ids: [evidence.evidence_id],
    });
  }

  for (const issue of extractionIndex.extraction_issues.items) {
    const affected = Array.isArray(issue.affected_object_ids)
      ? issue.affected_object_ids.filter(
          (value: unknown): value is string => typeof value === 'string',
        )
      : [];
    const materiality = objectMateriality(issue, 'medium');
    const context =
      issue.issue_type === 'other'
        ? (exactSourceContext(issue) ?? groundedContext('extraction_issues', issue))
        : groundedContext('extraction_issues', issue);

    if (issue.issue_type === 'ambiguous_date' && issue.resolution_status !== 'resolved') {
      addAssessment({
        target_object_id: issue.issue_id,
        target_family: 'timeline',
        field: 'date',
        trigger: 'date_precision',
        materiality,
        date_precision: 'unknown',
        question_context: context,
        resolves_object_ids: [issue.issue_id, ...affected],
      });
      continue;
    }
    if (issue.issue_type === 'ambiguous_scope' && issue.resolution_status !== 'resolved') {
      addAssessment({
        target_object_id: issue.issue_id,
        target_family: 'deliverables',
        field: 'identity',
        trigger: 'merge_risk',
        materiality,
        merge_risk: 'possible_merge',
        question_context: context,
        resolves_object_ids: [issue.issue_id, ...affected],
      });
      continue;
    }
    if (
      ['internal_tension', 'other'].includes(issue.issue_type) &&
      issue.resolution_status === 'clarification_requested'
    ) {
      addAssessment({
        target_object_id: issue.issue_id,
        target_family: issue.issue_type === 'internal_tension' ? 'completion' : 'agreement_term',
        field: 'required_information',
        trigger: 'required_bucket_missing',
        materiality,
        question_context: context,
        resolves_object_ids: [issue.issue_id, ...affected],
      });
    }
  }

  const uniqueAssessments = new Map<string, EpistemicAssessment>();
  for (const assessment of assessments) {
    uniqueAssessments.set(stableAssessmentKey(assessment), assessment);
  }
  const uniqueIssues = new Map<string, ExcludedInternalIssue>();
  for (const issue of excluded) uniqueIssues.set(stableIssueKey(issue), issue);

  return {
    assessments: [...uniqueAssessments.values()].sort((left, right) =>
      stableAssessmentKey(left) < stableAssessmentKey(right) ? -1 : 1,
    ),
    excluded_internal_issues: [...uniqueIssues.values()].sort((left, right) =>
      stableIssueKey(left) < stableIssueKey(right) ? -1 : 1,
    ),
  };
}

export function buildPersonAAssessmentResult(
  extractionValue: unknown,
  reportValue: unknown,
  alignmentValue: unknown,
): PersonAAssessmentBuildResult {
  const extractionIndex = validateExtraction(extractionValue);
  const report = validateReport(reportValue);
  const { goldenIds } = validateAlignment(alignmentValue, extractionIndex);

  for (const error of report.errors) {
    reportObject(error, extractionIndex, goldenIds);
  }

  return buildResult(report, extractionIndex, goldenIds);
}

export function buildPersonAAssessments(
  extractionValue: unknown,
  reportValue: unknown,
  alignmentValue: unknown,
): EpistemicAssessment[] {
  return buildPersonAAssessmentResult(extractionValue, reportValue, alignmentValue).assessments;
}
