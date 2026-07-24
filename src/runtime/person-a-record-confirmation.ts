import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  ExtractedObjectGroundingReference,
  GroundingReference,
  SourceSpanGroundingReference,
} from '../clarification/question-necessity.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';
import {
  PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION,
  hashPersonAClarificationArtifact,
  type JsonValue,
  type PersonAClarificationAnswerApplicationResult,
} from './person-a-clarification-answer-application.js';
import {
  PERSON_A_RUNTIME_ORCHESTRATION_VERSION,
  type PersonARuntimePlanningResult,
} from './person-a-runtime-orchestrator.js';

type JsonObject = { [key: string]: JsonValue };

export const PERSON_A_CONFIRMATION_VERSION = 'person-a-record-confirmation-v0.1.0';
export const PERSON_A_CONFIRMATION_SUBMISSION_VERSION =
  'person-a-record-confirmation-submission-v0.1.0';
export const MAX_PERSON_A_CONFIRMATION_CHALLENGES = 50;
export const MAX_PERSON_A_CONFIRMATION_EXPLANATION_LENGTH = 2_000;
export const MAX_PERSON_A_CONFIRMATION_DIAGNOSTICS = 20;
const MAX_DIAGNOSTIC_LENGTH = 240;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const CHALLENGE_ID_PATTERN = /^pach_[a-f0-9]{24}$/u;
const MAX_INPUT_NODES = 100_000;
const MAX_INPUT_DEPTH = 64;
const MAX_INPUT_STRING_LENGTH = 1_000_000;
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;

export type PersonAChallengeCategory =
  | 'incorrect_value'
  | 'missing_material_information'
  | 'wrong_actor_attribution'
  | 'wrong_date_event_association'
  | 'unsupported_assertion'
  | 'omitted_uncertainty'
  | 'incorrect_evidence_association_or_status'
  | 'incorrect_requested_remedy'
  | 'duplication'
  | 'contradiction_with_supplied_source';

export interface PersonARecordChallenge {
  challenge_id: string;
  target_object_id: string;
  target_path: string;
  category: PersonAChallengeCategory;
  explanation: string;
  expected_prior_value: JsonValue;
  grounding_reference?: GroundingReference;
}

export interface PersonAConfirmedSubmission {
  version: typeof PERSON_A_CONFIRMATION_SUBMISSION_VERSION;
  outcome: 'confirmed';
  confirmation_package_id: string;
  amended_record_hash: string;
  explicit_confirmation: true;
}

export interface PersonAChallengedSubmission {
  version: typeof PERSON_A_CONFIRMATION_SUBMISSION_VERSION;
  outcome: 'challenged';
  confirmation_package_id: string;
  amended_record_hash: string;
  challenges: PersonARecordChallenge[];
}

export type PersonAConfirmationSubmission =
  PersonAConfirmedSubmission | PersonAChallengedSubmission;

export interface PersonAConfirmationPackage {
  package_version: typeof PERSON_A_CONFIRMATION_VERSION;
  package_id: string;
  record_schema_version: string;
  identities: {
    original_extraction_hash: string;
    repaired_record_hash: string;
    clarification_answer_application_hash: string;
    amended_record_hash: string;
    correction_resolution_handoff_hash?: string;
  };
  provenance_legend: {
    supplied_facts: string;
    extracted_structured_content: string;
    amendments: string;
    unresolved_uncertainty: string;
    inference: string;
  };
  review_record: {
    party: JsonValue;
    third_parties: JsonValue;
    agreement: JsonValue;
    deliverable_assessments: JsonValue;
    timeline: JsonValue;
    claims: JsonValue;
    evidence: JsonValue;
    claim_evidence_links: JsonValue;
    damages_claims: JsonValue;
    desired_outcomes: JsonValue;
    extraction_issues: JsonValue;
  };
  amendments: JsonValue[];
  correction_amendments?: JsonValue[];
  unresolved_uncertainties: JsonValue[];
}

export const PERSON_A_CONFIRMATION_REVISION_VERSION = 'person-a-confirmation-revision-v0.1.0';

export interface PersonAConfirmationRevision {
  revision_version: typeof PERSON_A_CONFIRMATION_REVISION_VERSION;
  handoff_id: string;
  prior_confirmation_package_id: string;
  challenged_confirmation_submission_id: string;
  parent_amended_record_hash: string;
  revised_record_hash: string;
  prior_record_version: number;
  resulting_record_version: number;
  resolution_batch_id: string;
  correction_amendments: JsonValue[];
  confirmation_required: true;
}

export type PersonAConfirmationIssueCode =
  | 'invalid_input'
  | 'invalid_runtime_plan'
  | 'invalid_answer_application'
  | 'invalid_amended_record'
  | 'invalid_package_input'
  | 'stale_package'
  | 'stale_amended_record'
  | 'invalid_submission'
  | 'invalid_challenge'
  | 'duplicate_challenge_id'
  | 'duplicate_challenge_target'
  | 'unknown_target'
  | 'invalid_target_path'
  | 'forbidden_target'
  | 'stale_prior_value'
  | 'invalid_grounding'
  | 'atomic_submission_rejected';

export interface PersonAConfirmationDiagnostic {
  code: PersonAConfirmationIssueCode;
  message: string;
  challenge_id: string | null;
}

export interface PersonARecordConfirmationResult {
  confirmation_version: typeof PERSON_A_CONFIRMATION_VERSION;
  status: 'confirmed' | 'challenged' | 'invalid';
  confirmation_package: PersonAConfirmationPackage | null;
  confirmation_package_id: string | null;
  amended_record_hash: string | null;
  confirmation_submission_id: string | null;
  challenges: PersonARecordChallenge[];
  diagnostics: PersonAConfirmationDiagnostic[];
  audit: {
    runtime_plan_hash: string | null;
    answer_application_hash: string | null;
    amended_record_hash: string | null;
    package_binding_valid: boolean;
    record_binding_valid: boolean;
    amended_record_valid: boolean;
    original_input_unchanged: boolean;
    repaired_input_unchanged: boolean;
    amended_input_unchanged: boolean;
    challenges_submitted: number;
    challenges_accepted: number;
    final_status: 'passed' | 'failed_closed';
  };
}

export interface PersonARecordConfirmationInput {
  runtimePlan: unknown;
  answerApplication: unknown;
  amendedRecord: unknown;
  submission: unknown;
  revision?: unknown;
}

const categories = new Set<PersonAChallengeCategory>([
  'incorrect_value',
  'missing_material_information',
  'wrong_actor_attribution',
  'wrong_date_event_association',
  'unsupported_assertion',
  'omitted_uncertainty',
  'incorrect_evidence_association_or_status',
  'incorrect_requested_remedy',
  'duplication',
  'contradiction_with_supplied_source',
]);

const familyDescriptors = [
  ['agreement.terms', 'term_id'],
  ['deliverable_assessments', 'deliverable_id'],
  ['timeline', 'event_id'],
  ['claims', 'claim_id'],
  ['evidence', 'evidence_id'],
  ['claim_evidence_links', 'link_id'],
  ['damages_claims', 'damages_claim_id'],
  ['desired_outcomes.outcomes', 'outcome_id'],
  ['third_parties', 'third_party_id'],
  ['extraction_issues', 'issue_id'],
] as const;

const forbiddenPathSegments = new Set([
  'metadata',
  'submission',
  'raw_text',
  'clarification_questions',
  'repair_result',
  'stage_statuses',
  'audit',
  'golden',
  'evaluation',
  'alignment',
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key]!)]),
  );
}

function stableJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

function hash(value: JsonValue): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

export function hashPersonAConfirmationArtifact(value: JsonValue): string {
  return hash(value);
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function snapshotJson(
  value: unknown,
  depth = 0,
  context: { active: WeakSet<object>; nodes: number } = {
    active: new WeakSet<object>(),
    nodes: 0,
  },
): JsonValue {
  context.nodes += 1;
  if (context.nodes > MAX_INPUT_NODES || depth > MAX_INPUT_DEPTH) {
    throw new TypeError('Confirmation input exceeds bounded JSON limits.');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_INPUT_STRING_LENGTH) {
      throw new TypeError('Confirmation input string exceeds the bounded JSON limit.');
    }
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === undefined) {
    throw new TypeError('Confirmation input contains a non-JSON value.');
  }
  if (context.active.has(value)) throw new TypeError('Cyclic confirmation input is unsupported.');
  const arrayValue = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    arrayValue
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) {
    throw new TypeError('Confirmation input must use plain JSON prototypes.');
  }
  const ownKeys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    ownKeys.some((key) => typeof key === 'symbol') ||
    Object.values(descriptors).some((descriptor) => !('value' in descriptor))
  ) {
    throw new TypeError('Accessor or symbol-backed confirmation input is unsupported.');
  }
  context.active.add(value);
  try {
    if (arrayValue) {
      const length = (value as unknown[]).length;
      const keys = Object.keys(value);
      if (
        length > 5_000 ||
        ownKeys.length !== length + 1 ||
        keys.length !== length ||
        keys.some((key) => !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length)
      ) {
        throw new TypeError('Confirmation arrays must be bounded, dense, and unextended.');
      }
      return Array.from({ length }, (_, index) =>
        snapshotJson(descriptors[String(index)]!.value, depth + 1, context),
      );
    }
    const keys = Object.keys(value);
    if (keys.length > 250 || keys.length !== ownKeys.length) {
      throw new TypeError('Confirmation objects contain unsupported keys.');
    }
    const result: JsonObject = {};
    for (const key of keys) {
      const descriptor = descriptors[key]!;
      if (descriptor.enumerable !== true) {
        throw new TypeError('Confirmation object properties must be enumerable.');
      }
      result[key] = snapshotJson(descriptor.value, depth + 1, context);
    }
    return result;
  } finally {
    context.active.delete(value);
  }
}

function bounded(message: string): string {
  if (message.length <= MAX_DIAGNOSTIC_LENGTH) return message;
  return `${message.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

function diagnostic(
  code: PersonAConfirmationIssueCode,
  message: string,
  challengeId: string | null = null,
): PersonAConfirmationDiagnostic {
  return { code, message: bounded(message), challenge_id: challengeId };
}

function objectAtPath(root: JsonObject, dottedPath: string): unknown {
  let current: unknown = root;
  for (const segment of dottedPath.split('.')) {
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function buildObjectIndex(record: JsonObject): Map<string, { item: JsonObject; path: string }> {
  const index = new Map<string, { item: JsonObject; path: string }>();
  const party = record.party;
  if (isObject(party) && typeof party.party_id === 'string') {
    index.set(party.party_id, { item: party, path: '/party' });
  }
  for (const [familyPath, idField] of familyDescriptors) {
    const items = objectAtPath(record, familyPath);
    if (!Array.isArray(items)) continue;
    items.forEach((value, itemIndex) => {
      if (!isObject(value) || typeof value[idField] !== 'string') return;
      index.set(value[idField], {
        item: value,
        path: `/${familyPath.replaceAll('.', '/')}/${itemIndex}`,
      });
    });
  }
  return index;
}

function parsePointer(pointer: string): string[] | null {
  if (!pointer.startsWith('/') || pointer === '/' || pointer.length > 500) return null;
  const parts = pointer
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (parts.some((part) => part.length === 0 || /~(?![01])/u.test(part))) return null;
  return parts;
}

function pointerValue(root: JsonValue, pointer: string): { found: boolean; value?: JsonValue } {
  const parts = parsePointer(pointer);
  if (!parts) return { found: false };
  let current: JsonValue = root;
  for (const part of parts) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(part) || Number(part) >= current.length) {
        return { found: false };
      }
      current = current[Number(part)]!;
    } else if (isObject(current) && Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part]!;
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

function pathIsWithinObject(pointer: string, objectPath: string): boolean {
  return pointer === objectPath || pointer.startsWith(`${objectPath}/`);
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

function challengePayload(challenge: Omit<PersonARecordChallenge, 'challenge_id'>): JsonValue {
  return challenge as unknown as JsonValue;
}

export function derivePersonAChallengeId(
  challenge: Omit<PersonARecordChallenge, 'challenge_id'>,
): string {
  return `pach_${hash(challengePayload(challenge)).slice(0, 24)}`;
}

function applicationIdentity(application: PersonAClarificationAnswerApplicationResult): string {
  return hash(application as unknown as JsonValue);
}

function packageInputDiagnostic(
  runtimePlan: PersonARuntimePlanningResult,
  application: PersonAClarificationAnswerApplicationResult,
): PersonAConfirmationDiagnostic | null {
  const requiredArrays: readonly [string, unknown][] = [
    ['application.amendments', application.amendments],
    ['runtime_plan.unresolved_material_gaps', runtimePlan.unresolved_material_gaps],
    ['runtime_plan.suppressed_candidates', runtimePlan.suppressed_candidates],
  ];
  for (const [name, value] of requiredArrays) {
    if (!Array.isArray(value) || value.some((item) => !isObject(item))) {
      return diagnostic(
        'invalid_package_input',
        `Confirmation package prerequisite ${name} must be an array of objects.`,
      );
    }
  }
  return null;
}

function packageWithoutId(
  runtimePlan: PersonARuntimePlanningResult,
  application: PersonAClarificationAnswerApplicationResult,
  amendedRecord: JsonObject,
  revision?: PersonAConfirmationRevision,
): Omit<PersonAConfirmationPackage, 'package_id'> {
  const identities: PersonAConfirmationPackage['identities'] = {
    original_extraction_hash: application.original_extraction_hash!,
    repaired_record_hash: application.repaired_baseline_hash!,
    clarification_answer_application_hash: applicationIdentity(application),
    amended_record_hash: hashPersonAClarificationArtifact(amendedRecord),
  };
  if (revision) identities.correction_resolution_handoff_hash = revision.handoff_id;
  return {
    package_version: PERSON_A_CONFIRMATION_VERSION,
    record_schema_version: String(amendedRecord.schema_version),
    identities,
    provenance_legend: {
      supplied_facts:
        'Verbatim supplied material appears only in source_spans and evidence extracts.',
      extracted_structured_content:
        'Review-record fields are structured content extracted or deterministically repaired from Person A material.',
      amendments:
        'Amendments are append-only Person A clarification answers and do not replace their audit history.',
      unresolved_uncertainty:
        'Unresolved uncertainties remain sidecar assessments or suppressed clarification candidates.',
      inference:
        'Inference is shown only where the canonical record or assessment explicitly labels it.',
    },
    review_record: {
      party: cloneJson(amendedRecord.party!),
      third_parties: cloneJson(amendedRecord.third_parties!),
      agreement: cloneJson(amendedRecord.agreement!),
      deliverable_assessments: cloneJson(amendedRecord.deliverable_assessments!),
      timeline: cloneJson(amendedRecord.timeline!),
      claims: cloneJson(amendedRecord.claims!),
      evidence: cloneJson(amendedRecord.evidence!),
      claim_evidence_links: cloneJson(amendedRecord.claim_evidence_links!),
      damages_claims: cloneJson(amendedRecord.damages_claims!),
      desired_outcomes: cloneJson(amendedRecord.desired_outcomes!),
      extraction_issues: cloneJson(amendedRecord.extraction_issues!),
    },
    amendments: cloneJson(application.amendments as unknown as JsonValue[]),
    ...(revision ? { correction_amendments: cloneJson(revision.correction_amendments) } : {}),
    unresolved_uncertainties: cloneJson([
      ...runtimePlan.unresolved_material_gaps,
      ...runtimePlan.suppressed_candidates.filter(
        (candidate) => candidate.classification !== 'already_explicit',
      ),
    ] as unknown as JsonValue[]),
  };
}

export function buildPersonAConfirmationPackage(input: {
  runtimePlan: PersonARuntimePlanningResult;
  answerApplication: PersonAClarificationAnswerApplicationResult;
  amendedRecord: JsonObject;
  revision?: PersonAConfirmationRevision;
}): PersonAConfirmationPackage {
  const body = packageWithoutId(
    input.runtimePlan,
    input.answerApplication,
    input.amendedRecord,
    input.revision,
  );
  return { ...body, package_id: hash(body as unknown as JsonValue) };
}

function hasExactKeys(value: JsonObject, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  return (
    actual.length === canonicalExpected.length &&
    actual.every((key, index) => key === canonicalExpected[index])
  );
}

function isGroundingPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.length <= MAX_INPUT_STRING_LENGTH) ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function normalizeGrounding(
  grounding: unknown,
  target: JsonObject,
  targetObjectId: string,
  targetObjectPath: string,
  challengedPath: string,
  expectedPriorValue: JsonValue,
): GroundingReference | null {
  if (
    !isObject(grounding) ||
    Object.getPrototypeOf(grounding) !== Object.prototype ||
    grounding.object_id !== targetObjectId
  ) {
    return null;
  }
  if (grounding.kind === 'source_span') {
    const startChar = grounding.start_char;
    const endChar = grounding.end_char;
    if (
      !hasExactKeys(grounding, [
        'kind',
        'object_id',
        'submission_id',
        'quote',
        'start_char',
        'end_char',
      ]) ||
      typeof grounding.object_id !== 'string' ||
      !IDENTIFIER_PATTERN.test(grounding.object_id) ||
      typeof grounding.submission_id !== 'string' ||
      !IDENTIFIER_PATTERN.test(grounding.submission_id) ||
      typeof grounding.quote !== 'string' ||
      grounding.quote.length === 0 ||
      grounding.quote.length > MAX_INPUT_STRING_LENGTH ||
      typeof startChar !== 'number' ||
      typeof endChar !== 'number' ||
      !Number.isSafeInteger(startChar) ||
      !Number.isSafeInteger(endChar) ||
      startChar < 0 ||
      endChar <= startChar ||
      endChar !== startChar + grounding.quote.length
    ) {
      return null;
    }
    const compatible =
      Array.isArray(target.source_spans) &&
      target.source_spans.some(
        (span) =>
          isObject(span) &&
          span.submission_id === grounding.submission_id &&
          span.quote === grounding.quote &&
          span.start_char === startChar &&
          span.end_char === endChar,
      );
    if (!compatible) return null;
    const normalized: SourceSpanGroundingReference = {
      kind: 'source_span',
      object_id: grounding.object_id,
      submission_id: grounding.submission_id,
      quote: grounding.quote,
      start_char: startChar,
      end_char: endChar,
    };
    return normalized;
  }
  if (grounding.kind === 'extracted_object') {
    if (
      !hasExactKeys(grounding, ['kind', 'object_id', 'field', 'value']) ||
      typeof grounding.object_id !== 'string' ||
      !IDENTIFIER_PATTERN.test(grounding.object_id) ||
      typeof grounding.field !== 'string' ||
      !IDENTIFIER_PATTERN.test(grounding.field) ||
      !isGroundingPrimitive(grounding.value) ||
      challengedPath !== `${targetObjectPath}/${grounding.field}` ||
      !Object.prototype.hasOwnProperty.call(target, grounding.field) ||
      !isDeepStrictEqual(target[grounding.field], grounding.value) ||
      !isDeepStrictEqual(expectedPriorValue, grounding.value)
    ) {
      return null;
    }
    const normalized: ExtractedObjectGroundingReference = {
      kind: 'extracted_object',
      object_id: grounding.object_id,
      field: grounding.field,
      value: grounding.value,
    };
    return normalized;
  }
  return null;
}

function parseChallenge(
  value: unknown,
  amendedRecord: JsonObject,
  objectIndex: Map<string, { item: JsonObject; path: string }>,
): { challenge?: PersonARecordChallenge; errors: PersonAConfirmationDiagnostic[] } {
  const errors: PersonAConfirmationDiagnostic[] = [];
  if (!isObject(value)) {
    return { errors: [diagnostic('invalid_challenge', 'Challenge must be an object.')] };
  }
  const submittedId = typeof value.challenge_id === 'string' ? value.challenge_id : null;
  const id = submittedId !== null && CHALLENGE_ID_PATTERN.test(submittedId) ? submittedId : null;
  const allowed = new Set([
    'challenge_id',
    'target_object_id',
    'target_path',
    'category',
    'explanation',
    'expected_prior_value',
    'grounding_reference',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    errors.push(diagnostic('invalid_challenge', 'Challenge contains unsupported fields.', id));
  }
  if (id === null) {
    errors.push(diagnostic('invalid_challenge', 'Challenge ID is malformed.', id));
  }
  const targetObjectId = typeof value.target_object_id === 'string' ? value.target_object_id : '';
  const target = objectIndex.get(targetObjectId);
  if (!target) errors.push(diagnostic('unknown_target', 'Target object ID is unknown.', id));
  const targetPath = typeof value.target_path === 'string' ? value.target_path : '';
  const parts = parsePointer(targetPath);
  if (!parts || !target || !pathIsWithinObject(targetPath, target.path)) {
    errors.push(
      diagnostic('invalid_target_path', 'Target path does not identify the target object.', id),
    );
  }
  if (parts?.some((part) => forbiddenPathSegments.has(part))) {
    errors.push(
      diagnostic('forbidden_target', 'Target path refers to non-reviewable metadata.', id),
    );
  }
  const resolved = pointerValue(amendedRecord, targetPath);
  if (!resolved.found) {
    errors.push(diagnostic('invalid_target_path', 'Target path does not exist.', id));
  } else if (!isDeepStrictEqual(resolved.value, value.expected_prior_value)) {
    errors.push(diagnostic('stale_prior_value', 'Expected prior value is stale.', id));
  }
  if (
    typeof value.category !== 'string' ||
    !categories.has(value.category as PersonAChallengeCategory)
  ) {
    errors.push(diagnostic('invalid_challenge', 'Challenge category is unsupported.', id));
  }
  if (
    typeof value.explanation !== 'string' ||
    value.explanation.trim() !== value.explanation ||
    value.explanation.length === 0 ||
    value.explanation.length > MAX_PERSON_A_CONFIRMATION_EXPLANATION_LENGTH
  ) {
    errors.push(diagnostic('invalid_challenge', 'Challenge explanation is malformed.', id));
  }
  const needsGrounding = value.category === 'contradiction_with_supplied_source';
  const normalizedGrounding =
    value.grounding_reference !== undefined && target && resolved.found
      ? normalizeGrounding(
          value.grounding_reference,
          target.item,
          targetObjectId,
          target.path,
          targetPath,
          resolved.value!,
        )
      : null;
  if (
    (needsGrounding && value.grounding_reference === undefined) ||
    (value.grounding_reference !== undefined && normalizedGrounding === null)
  ) {
    errors.push(
      diagnostic(
        'invalid_grounding',
        needsGrounding
          ? 'Source-conflict challenge requires exact target-compatible grounding.'
          : 'Challenge grounding is not target-compatible.',
        id,
      ),
    );
  }
  if (errors.length > 0) return { errors };
  const challenge: PersonARecordChallenge = {
    challenge_id: id!,
    target_object_id: targetObjectId,
    target_path: targetPath,
    category: value.category as PersonAChallengeCategory,
    explanation: value.explanation as string,
    expected_prior_value: cloneJson(resolved.value!),
    ...(normalizedGrounding === null ? {} : { grounding_reference: normalizedGrounding }),
  };
  const { challenge_id: _ignored, ...payload } = challenge;
  if (challenge.challenge_id !== derivePersonAChallengeId(payload)) {
    return {
      errors: [
        diagnostic(
          'invalid_challenge',
          'Challenge ID does not match its deterministic content hash.',
          id,
        ),
      ],
    };
  }
  return { challenge, errors: [] };
}

interface ConfirmationBindingState {
  packageBindingValid: boolean;
  recordBindingValid: boolean;
}

function invalidResult(
  diagnostics: PersonAConfirmationDiagnostic[],
  packageValue: PersonAConfirmationPackage | null,
  runtimePlanHash: string | null,
  applicationHash: string | null,
  amendedHash: string | null,
  bindingState: ConfirmationBindingState,
  unchanged: [boolean, boolean, boolean],
  challengesSubmitted = 0,
  amendedRecordValid = false,
): PersonARecordConfirmationResult {
  return {
    confirmation_version: PERSON_A_CONFIRMATION_VERSION,
    status: 'invalid',
    confirmation_package: packageValue,
    confirmation_package_id: packageValue?.package_id ?? null,
    amended_record_hash: amendedHash,
    confirmation_submission_id: null,
    challenges: [],
    diagnostics: diagnostics.slice(0, MAX_PERSON_A_CONFIRMATION_DIAGNOSTICS),
    audit: {
      runtime_plan_hash: runtimePlanHash,
      answer_application_hash: applicationHash,
      amended_record_hash: amendedHash,
      package_binding_valid: bindingState.packageBindingValid,
      record_binding_valid: bindingState.recordBindingValid,
      amended_record_valid: amendedRecordValid,
      original_input_unchanged: unchanged[0],
      repaired_input_unchanged: unchanged[1],
      amended_input_unchanged: unchanged[2],
      challenges_submitted: challengesSubmitted,
      challenges_accepted: 0,
      final_status: 'failed_closed',
    },
  };
}

function validPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function normalizeConfirmationRevision(value: unknown): PersonAConfirmationRevision | null {
  if (!isObject(value)) return null;
  const expectedKeys = [
    'revision_version',
    'handoff_id',
    'prior_confirmation_package_id',
    'challenged_confirmation_submission_id',
    'parent_amended_record_hash',
    'revised_record_hash',
    'prior_record_version',
    'resulting_record_version',
    'resolution_batch_id',
    'correction_amendments',
    'confirmation_required',
  ];
  if (
    !hasExactKeys(value, expectedKeys) ||
    value.revision_version !== PERSON_A_CONFIRMATION_REVISION_VERSION ||
    !validHash(value.handoff_id) ||
    !validHash(value.prior_confirmation_package_id) ||
    !validHash(value.challenged_confirmation_submission_id) ||
    !validHash(value.parent_amended_record_hash) ||
    !validHash(value.revised_record_hash) ||
    !validPositiveSafeInteger(value.prior_record_version) ||
    !validPositiveSafeInteger(value.resulting_record_version) ||
    !validHash(value.resolution_batch_id) ||
    !Array.isArray(value.correction_amendments) ||
    value.correction_amendments.some((amendment) => !isObject(amendment)) ||
    value.confirmation_required !== true
  ) {
    return null;
  }
  const { handoff_id: _ignored, ...body } = value;
  if (hash(body as unknown as JsonValue) !== value.handoff_id) return null;
  return value as unknown as PersonAConfirmationRevision;
}

function directObjectField(targetPath: string, objectPath: string): string | null {
  if (!targetPath.startsWith(`${objectPath}/`)) return null;
  const encoded = targetPath.slice(objectPath.length + 1);
  if (encoded.length === 0 || encoded.includes('/') || /~(?![01])/u.test(encoded)) return null;
  return encoded.replaceAll('~1', '/').replaceAll('~0', '~');
}

function revisionReplaysExactly(
  revision: PersonAConfirmationRevision,
  parentRecord: JsonObject,
  revisedRecord: JsonObject,
): boolean {
  if (
    revision.parent_amended_record_hash !== hashPersonAClarificationArtifact(parentRecord) ||
    revision.revised_record_hash !== hashPersonAClarificationArtifact(revisedRecord)
  ) {
    return false;
  }
  const projected = cloneJson(parentRecord);
  const index = buildObjectIndex(projected);
  const seenAmendments = new Set<string>();
  const seenTargets = new Set<string>();
  for (const [indexValue, raw] of revision.correction_amendments.entries()) {
    if (
      !isObject(raw) ||
      !hasExactKeys(raw, [
        'amendment_id',
        'amendment_sequence',
        'challenge_id',
        'resolution_id',
        'target_object_id',
        'target_path',
        'prior_value',
        'replacement_value',
        'grounding_reference',
        'source_type',
        'created_at',
        'parent_record_hash',
        'resulting_record_hash',
        'prior_record_version',
        'resulting_record_version',
      ]) ||
      typeof raw.amendment_id !== 'string' ||
      !/^paca_corr_[a-f0-9]{24}$/u.test(raw.amendment_id) ||
      raw.amendment_sequence !== indexValue + 1 ||
      typeof raw.challenge_id !== 'string' ||
      !CHALLENGE_ID_PATTERN.test(raw.challenge_id) ||
      typeof raw.resolution_id !== 'string' ||
      !/^pacr_[a-f0-9]{24}$/u.test(raw.resolution_id) ||
      typeof raw.target_object_id !== 'string' ||
      typeof raw.target_path !== 'string' ||
      !isObject(raw.grounding_reference) ||
      raw.source_type !== 'person_a_challenge_resolution' ||
      (raw.created_at !== null && typeof raw.created_at !== 'string') ||
      raw.parent_record_hash !== revision.parent_amended_record_hash ||
      raw.resulting_record_hash !== revision.revised_record_hash ||
      raw.prior_record_version !== revision.prior_record_version ||
      raw.resulting_record_version !== revision.resulting_record_version ||
      seenAmendments.has(raw.amendment_id) ||
      seenTargets.has(`${raw.target_object_id}|${raw.target_path}`)
    ) {
      return false;
    }
    const identityBody: JsonValue = {
      challenge_id: raw.challenge_id,
      resolution_id: raw.resolution_id,
      target_object_id: raw.target_object_id,
      target_path: raw.target_path,
      prior_value: raw.prior_value!,
      replacement_value: raw.replacement_value!,
      grounding_reference: raw.grounding_reference,
      parent_record_hash: raw.parent_record_hash,
      prior_record_version: raw.prior_record_version,
      resulting_record_version: raw.resulting_record_version,
    };
    if (`paca_corr_${hash(identityBody).slice(0, 24)}` !== raw.amendment_id) return false;
    const target = index.get(raw.target_object_id);
    const field = target ? directObjectField(raw.target_path, target.path) : null;
    if (
      !target ||
      !field ||
      !Object.prototype.hasOwnProperty.call(target.item, field) ||
      !isDeepStrictEqual(target.item[field], raw.prior_value)
    ) {
      return false;
    }
    target.item[field] = cloneJson(raw.replacement_value!);
    seenAmendments.add(raw.amendment_id);
    seenTargets.add(`${raw.target_object_id}|${raw.target_path}`);
  }
  return isDeepStrictEqual(projected, revisedRecord);
}

export function confirmPersonARecord(
  input: PersonARecordConfirmationInput,
): PersonARecordConfirmationResult {
  const unprovenBindings: ConfirmationBindingState = {
    packageBindingValid: false,
    recordBindingValid: false,
  };
  let runtimePlan: PersonARuntimePlanningResult;
  let application: PersonAClarificationAnswerApplicationResult;
  let amendedRecord: JsonObject;
  let submission: JsonObject;
  let revision: PersonAConfirmationRevision | undefined;
  try {
    runtimePlan = snapshotJson(input.runtimePlan) as unknown as PersonARuntimePlanningResult;
    application = snapshotJson(
      input.answerApplication,
    ) as unknown as PersonAClarificationAnswerApplicationResult;
    amendedRecord = snapshotJson(input.amendedRecord) as JsonObject;
    submission = snapshotJson(input.submission) as JsonObject;
    if (input.revision !== undefined) {
      const revisionSnapshot = snapshotJson(input.revision);
      revision = normalizeConfirmationRevision(revisionSnapshot) ?? undefined;
      if (!revision) throw new TypeError('Confirmation revision is malformed.');
    }
    if (![runtimePlan, application, amendedRecord, submission].every(isObject)) {
      throw new TypeError('All confirmation inputs must be plain JSON objects.');
    }
  } catch {
    return invalidResult(
      [diagnostic('invalid_input', 'Confirmation inputs must be detached JSON values.')],
      null,
      null,
      null,
      null,
      unprovenBindings,
      [true, true, true],
    );
  }

  const originalBefore = stableJson(runtimePlan.original_extraction as JsonValue);
  const repairedBefore = stableJson(runtimePlan.repaired_extraction as JsonValue);
  const amendedBefore = stableJson(amendedRecord);
  const runtimePlanHash = hash(runtimePlan as unknown as JsonValue);
  const answerApplicationHash = hash(application as unknown as JsonValue);
  const amendedHash = hashPersonAClarificationArtifact(amendedRecord);
  const unchanged = (): [boolean, boolean, boolean] => [
    stableJson(runtimePlan.original_extraction as JsonValue) === originalBefore,
    stableJson(runtimePlan.repaired_extraction as JsonValue) === repairedBefore,
    stableJson(amendedRecord) === amendedBefore,
  ];
  if (
    runtimePlan.orchestration_version !== PERSON_A_RUNTIME_ORCHESTRATION_VERSION ||
    runtimePlan.audit_summary?.final_status !== 'passed' ||
    !isObject(runtimePlan.original_extraction) ||
    !isObject(runtimePlan.repaired_extraction) ||
    runtimePlan.original_extraction_hash !==
      hashPersonAClarificationArtifact(runtimePlan.original_extraction as JsonValue) ||
    runtimePlan.repaired_extraction_hash !==
      hashPersonAClarificationArtifact(runtimePlan.repaired_extraction as JsonValue)
  ) {
    return invalidResult(
      [diagnostic('invalid_runtime_plan', 'Runtime plan is not a valid passed plan.')],
      null,
      runtimePlanHash,
      answerApplicationHash,
      amendedHash,
      unprovenBindings,
      unchanged(),
    );
  }
  const applicationRecordHash = isObject(application.amended_record)
    ? hashPersonAClarificationArtifact(application.amended_record as JsonValue)
    : null;
  const applicationIsInvalid =
    application.application_version !== PERSON_A_CLARIFICATION_ANSWER_APPLICATION_VERSION ||
    application.audit?.final_status !== 'passed' ||
    application.original_extraction_hash !== runtimePlan.original_extraction_hash ||
    application.repaired_baseline_hash !== runtimePlan.repaired_extraction_hash ||
    application.amended_record_hash !== applicationRecordHash;
  const revisionIsValid =
    revision !== undefined &&
    revision.parent_amended_record_hash === application.amended_record_hash &&
    revision.revised_record_hash === amendedHash &&
    isObject(application.amended_record) &&
    revisionReplaysExactly(revision, application.amended_record, amendedRecord) &&
    revision.resulting_record_version >= revision.prior_record_version &&
    (revision.correction_amendments.length > 0
      ? revision.resulting_record_version === revision.prior_record_version + 1
      : revision.resulting_record_version === revision.prior_record_version);
  const directRecordIsValid =
    revision === undefined &&
    application.amended_record_hash === amendedHash &&
    isDeepStrictEqual(application.amended_record, amendedRecord);
  if (applicationIsInvalid || (!directRecordIsValid && !revisionIsValid)) {
    return invalidResult(
      [
        diagnostic(
          'invalid_answer_application',
          'Answer application is not passed or does not bind to the runtime plan and amended record.',
        ),
      ],
      null,
      runtimePlanHash,
      answerApplicationHash,
      amendedHash,
      unprovenBindings,
      unchanged(),
    );
  }
  const narrative = isObject(amendedRecord.submission)
    ? amendedRecord.submission.raw_text
    : undefined;
  const recordValidation =
    typeof narrative === 'string'
      ? validatePersonAExtraction(amendedRecord, narrative)
      : { valid: false };
  if (!recordValidation.valid) {
    return invalidResult(
      [diagnostic('invalid_amended_record', 'Amended record is not schema and invariant valid.')],
      null,
      runtimePlanHash,
      answerApplicationHash,
      amendedHash,
      unprovenBindings,
      unchanged(),
    );
  }

  const invalidPackageInput = packageInputDiagnostic(runtimePlan, application);
  if (invalidPackageInput) {
    return invalidResult(
      [invalidPackageInput],
      null,
      runtimePlanHash,
      answerApplicationHash,
      amendedHash,
      unprovenBindings,
      unchanged(),
      0,
      true,
    );
  }

  const confirmationPackage = buildPersonAConfirmationPackage({
    runtimePlan,
    answerApplication: application,
    amendedRecord,
    revision,
  });
  if (
    submission.version !== PERSON_A_CONFIRMATION_SUBMISSION_VERSION ||
    !validHash(submission.confirmation_package_id) ||
    !validHash(submission.amended_record_hash)
  ) {
    return invalidResult(
      [diagnostic('invalid_submission', 'Confirmation submission contract is malformed.')],
      confirmationPackage,
      runtimePlanHash,
      answerApplicationHash,
      amendedHash,
      unprovenBindings,
      unchanged(),
      0,
      true,
    );
  }
  if (submission.confirmation_package_id !== confirmationPackage.package_id) {
    return invalidResult(
      [diagnostic('stale_package', 'Confirmation package identity is stale or different.')],
      confirmationPackage,
      runtimePlanHash,
      answerApplicationHash,
      amendedHash,
      unprovenBindings,
      unchanged(),
      0,
      true,
    );
  }
  const packageBound: ConfirmationBindingState = {
    packageBindingValid: true,
    recordBindingValid: false,
  };
  if (submission.amended_record_hash !== amendedHash) {
    return invalidResult(
      [diagnostic('stale_amended_record', 'Amended record identity is stale or different.')],
      confirmationPackage,
      runtimePlanHash,
      answerApplicationHash,
      amendedHash,
      packageBound,
      unchanged(),
      0,
      true,
    );
  }
  const fullyBound: ConfirmationBindingState = {
    packageBindingValid: true,
    recordBindingValid: true,
  };

  const commonKeys = new Set([
    'version',
    'outcome',
    'confirmation_package_id',
    'amended_record_hash',
  ]);
  let status: 'confirmed' | 'challenged';
  let challenges: PersonARecordChallenge[] = [];
  if (submission.outcome === 'confirmed') {
    const allowed = new Set([...commonKeys, 'explicit_confirmation']);
    if (
      submission.explicit_confirmation !== true ||
      Object.keys(submission).some((key) => !allowed.has(key))
    ) {
      return invalidResult(
        [diagnostic('invalid_submission', 'Confirmation must be explicit and exclusive.')],
        confirmationPackage,
        runtimePlanHash,
        answerApplicationHash,
        amendedHash,
        fullyBound,
        unchanged(),
        0,
        true,
      );
    }
    status = 'confirmed';
  } else if (submission.outcome === 'challenged') {
    const allowed = new Set([...commonKeys, 'challenges']);
    if (
      !Array.isArray(submission.challenges) ||
      submission.challenges.length === 0 ||
      submission.challenges.length > MAX_PERSON_A_CONFIRMATION_CHALLENGES ||
      Object.keys(submission).some((key) => !allowed.has(key))
    ) {
      return invalidResult(
        [diagnostic('invalid_submission', 'Challenge submission contract is malformed.')],
        confirmationPackage,
        runtimePlanHash,
        answerApplicationHash,
        amendedHash,
        fullyBound,
        unchanged(),
        Array.isArray(submission.challenges) ? submission.challenges.length : 0,
        true,
      );
    }
    const objectIndex = buildObjectIndex(amendedRecord);
    const parsed = submission.challenges.map((challenge) =>
      parseChallenge(challenge, amendedRecord, objectIndex),
    );
    const errors = parsed.flatMap((result) => result.errors);
    const candidates = parsed.flatMap((result) => (result.challenge ? [result.challenge] : []));
    const idCounts = new Map<string, number>();
    const targetCounts = new Map<string, number>();
    for (const challenge of candidates) {
      idCounts.set(challenge.challenge_id, (idCounts.get(challenge.challenge_id) ?? 0) + 1);
      const targetKey = `${challenge.target_path}|${challenge.category}`;
      targetCounts.set(targetKey, (targetCounts.get(targetKey) ?? 0) + 1);
    }
    for (const challenge of candidates) {
      if ((idCounts.get(challenge.challenge_id) ?? 0) > 1) {
        errors.push(
          diagnostic(
            'duplicate_challenge_id',
            'Duplicate challenge IDs are rejected.',
            challenge.challenge_id,
          ),
        );
      }
      if ((targetCounts.get(`${challenge.target_path}|${challenge.category}`) ?? 0) > 1) {
        errors.push(
          diagnostic(
            'duplicate_challenge_target',
            'Duplicate target and category challenges are rejected.',
            challenge.challenge_id,
          ),
        );
      }
    }
    if (errors.length > 0) {
      errors.push(
        diagnostic(
          'atomic_submission_rejected',
          'At least one challenge failed, so no challenge was accepted.',
        ),
      );
      errors.sort(
        (left, right) =>
          String(left.challenge_id).localeCompare(String(right.challenge_id)) ||
          left.code.localeCompare(right.code),
      );
      return invalidResult(
        errors,
        confirmationPackage,
        runtimePlanHash,
        answerApplicationHash,
        amendedHash,
        fullyBound,
        unchanged(),
        submission.challenges.length,
        true,
      );
    }
    challenges = candidates.sort(
      (left, right) =>
        left.target_path.localeCompare(right.target_path) ||
        left.category.localeCompare(right.category) ||
        left.challenge_id.localeCompare(right.challenge_id),
    );
    status = 'challenged';
  } else {
    return invalidResult(
      [diagnostic('invalid_submission', 'Outcome must be confirmed or challenged.')],
      confirmationPackage,
      runtimePlanHash,
      answerApplicationHash,
      amendedHash,
      fullyBound,
      unchanged(),
      0,
      true,
    );
  }

  const normalizedSubmission: JsonValue =
    status === 'confirmed'
      ? (submission as JsonValue)
      : ({
          ...submission,
          challenges,
        } as unknown as JsonValue);
  const finalUnchanged = unchanged();
  return {
    confirmation_version: PERSON_A_CONFIRMATION_VERSION,
    status,
    confirmation_package: confirmationPackage,
    confirmation_package_id: confirmationPackage.package_id,
    amended_record_hash: amendedHash,
    confirmation_submission_id: hash(normalizedSubmission),
    challenges,
    diagnostics: [],
    audit: {
      runtime_plan_hash: runtimePlanHash,
      answer_application_hash: answerApplicationHash,
      amended_record_hash: amendedHash,
      package_binding_valid: fullyBound.packageBindingValid,
      record_binding_valid: fullyBound.recordBindingValid,
      amended_record_valid: true,
      original_input_unchanged: finalUnchanged[0],
      repaired_input_unchanged: finalUnchanged[1],
      amended_input_unchanged: finalUnchanged[2],
      challenges_submitted: challenges.length,
      challenges_accepted: challenges.length,
      final_status: 'passed',
    },
  };
}
