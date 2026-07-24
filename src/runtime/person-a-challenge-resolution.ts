import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { GroundingReference } from '../clarification/question-necessity.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';
import {
  hashPersonAClarificationArtifact,
  type JsonValue,
} from './person-a-clarification-answer-application.js';
import {
  derivePersonAChallengeId,
  hashPersonAConfirmationArtifact,
  PERSON_A_CONFIRMATION_REVISION_VERSION,
  PERSON_A_CONFIRMATION_SUBMISSION_VERSION,
  type PersonAConfirmationRevision,
  type PersonARecordChallenge,
  type PersonARecordConfirmationResult,
} from './person-a-record-confirmation.js';

type JsonObject = { [key: string]: JsonValue };

export const PERSON_A_CHALLENGE_RESOLUTION_VERSION = 'person-a-challenge-resolution-v0.1.0';
export const PERSON_A_CHALLENGE_RESOLUTION_REQUEST_VERSION =
  'person-a-challenge-resolution-request-v0.1.0';
export const MAX_PERSON_A_CHALLENGE_RESOLUTIONS = 50;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const RESOLUTION_ID_PATTERN = /^pacr_[a-f0-9]{24}$/u;
const AMENDMENT_ID_PATTERN = /^paca_corr_[a-f0-9]{24}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;
const MAX_INPUT_NODES = 100_000;
const MAX_INPUT_DEPTH = 64;
const MAX_INPUT_STRING_LENGTH = 1_000_000;
const MAX_DIAGNOSTICS = 20;
const MAX_DIAGNOSTIC_LENGTH = 240;

export type PersonAChallengeResolutionOutcome = 'accepted' | 'rejected';
export type PersonAChallengeRejectionReasonCode =
  | 'challenge_not_supported'
  | 'current_value_supported'
  | 'grounding_insufficient'
  | 'authorized_no_change';

export interface PersonAAcceptedChallengeResolution {
  resolution_id: string;
  challenge_id: string;
  outcome: 'accepted';
  target_object_id: string;
  target_path: string;
  expected_prior_value: JsonValue;
  replacement_value: JsonValue;
  grounding_reference: GroundingReference;
}

export interface PersonARejectedChallengeResolution {
  resolution_id: string;
  challenge_id: string;
  outcome: 'rejected';
  target_object_id: string;
  target_path: string;
  expected_prior_value: JsonValue;
  rejection_reason_code: PersonAChallengeRejectionReasonCode;
}

export type PersonAChallengeResolutionProposal =
  PersonAAcceptedChallengeResolution | PersonARejectedChallengeResolution;

export interface PersonAChallengeResolutionRequest {
  version: typeof PERSON_A_CHALLENGE_RESOLUTION_REQUEST_VERSION;
  confirmation_package_id: string;
  challenged_confirmation_submission_id: string;
  amended_record_hash: string;
  challenge_set_hash: string;
  expected_record_version: number;
  resolutions: PersonAChallengeResolutionProposal[];
}

export interface PersonAChallengeCorrectionAmendment {
  amendment_id: string;
  amendment_sequence: number;
  challenge_id: string;
  resolution_id: string;
  target_object_id: string;
  target_path: string;
  prior_value: JsonValue;
  replacement_value: JsonValue;
  grounding_reference: GroundingReference;
  source_type: 'person_a_challenge_resolution';
  created_at: string | null;
  parent_record_hash: string;
  resulting_record_hash: string;
  prior_record_version: number;
  resulting_record_version: number;
}

export interface PersonARejectedChallengeResolutionRecord {
  resolution_id: string;
  challenge_id: string;
  target_object_id: string;
  target_path: string;
  rejection_reason_code: PersonAChallengeRejectionReasonCode;
}

export type PersonAChallengeResolutionIssueCode =
  | 'invalid_input'
  | 'invalid_confirmation_result'
  | 'invalid_record'
  | 'invalid_request'
  | 'stale_package'
  | 'stale_confirmation_submission'
  | 'stale_record'
  | 'stale_record_version'
  | 'stale_challenge_set'
  | 'invalid_resolution'
  | 'unknown_challenge'
  | 'missing_resolution'
  | 'duplicate_resolution_id'
  | 'duplicate_challenge_resolution'
  | 'duplicate_target'
  | 'target_mismatch'
  | 'stale_prior_value'
  | 'invalid_grounding'
  | 'unsupported_resolution'
  | 'unsupported_mutation_shape'
  | 'immutable_identity_mutation'
  | 'invalid_revised_record'
  | 'atomic_batch_rejected';

export interface PersonAChallengeResolutionDiagnostic {
  code: PersonAChallengeResolutionIssueCode;
  message: string;
  challenge_id: string | null;
  resolution_id: string | null;
}

export interface PersonAChallengeResolutionVersionTransition {
  prior_record_version: number;
  resulting_record_version: number;
  parent_record_hash: string;
  resulting_record_hash: string;
}

export interface PersonAChallengeResolutionResult {
  resolution_version: typeof PERSON_A_CHALLENGE_RESOLUTION_VERSION;
  status: 'resolved' | 'invalid' | 'unsupported';
  resolution_result_id: string | null;
  resolution_batch_id: string | null;
  prior_confirmation_package_id: string | null;
  challenged_confirmation_submission_id: string | null;
  challenge_set_hash: string | null;
  parent_record: JsonObject | null;
  parent_record_hash: string | null;
  revised_record: JsonObject | null;
  revised_record_hash: string | null;
  correction_amendments: PersonAChallengeCorrectionAmendment[];
  rejected_resolutions: PersonARejectedChallengeResolutionRecord[];
  diagnostics: PersonAChallengeResolutionDiagnostic[];
  version_transition: PersonAChallengeResolutionVersionTransition | null;
  confirmation_handoff: PersonAConfirmationRevision | null;
  confirmation_required: true;
  confirmed: false;
  record_locked: false;
  audit: {
    final_status: 'passed' | 'failed_closed';
    failure_stage:
      | 'input_snapshot'
      | 'confirmation_binding'
      | 'batch_validation'
      | 'record_projection'
      | 'record_validation'
      | null;
    challenges_submitted: number;
    resolutions_submitted: number;
    resolutions_accepted: number;
    resolutions_rejected: number;
    amendments_created: number;
    caller_input_unchanged: boolean;
    parent_record_unchanged: boolean;
    confirmation_package_unchanged: boolean;
    challenged_submission_unchanged: boolean;
    created_at_injected: boolean;
  };
}

export interface PersonAChallengeResolutionInput {
  confirmationResult: unknown;
  amendedRecord: unknown;
  currentRecordVersion: unknown;
  request: unknown;
  options?: {
    createdAt?: string;
  };
}

interface IndexedObject {
  item: JsonObject;
  path: string;
  identityField: string;
}

interface SnapshotContext {
  active: WeakSet<object>;
  seen: WeakSet<object>;
  nodes: number;
}

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

const immutableFieldNames = new Set(['schema_version', 'extractor_version', 'content_hash']);

const rejectionReasons = new Set<PersonAChallengeRejectionReasonCode>([
  'challenge_not_supported',
  'current_value_supported',
  'grounding_insufficient',
  'authorized_no_change',
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lexicalCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(lexicalCompare)
      .map((key) => [key, canonicalize(value[key]!)]),
  );
}

function stableJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

function hashStable(value: JsonValue): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function snapshotJson(
  value: unknown,
  depth = 0,
  context: SnapshotContext = {
    active: new WeakSet<object>(),
    seen: new WeakSet<object>(),
    nodes: 0,
  },
): JsonValue {
  context.nodes += 1;
  if (context.nodes > MAX_INPUT_NODES || depth > MAX_INPUT_DEPTH) {
    throw new TypeError('Resolution input exceeds bounded JSON limits.');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_INPUT_STRING_LENGTH) {
      throw new TypeError('Resolution input string exceeds the bounded JSON limit.');
    }
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === undefined) {
    throw new TypeError('Resolution input contains a non-JSON value.');
  }
  if (context.active.has(value)) throw new TypeError('Cyclic resolution input is unsupported.');
  if (context.seen.has(value)) throw new TypeError('Aliased resolution input is unsupported.');
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
  ) {
    throw new TypeError('Resolution input must use plain JSON prototypes.');
  }
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    keys.some((key) => typeof key === 'symbol') ||
    Object.values(descriptors).some((descriptor) => !('value' in descriptor))
  ) {
    throw new TypeError('Accessor or symbol-backed resolution input is unsupported.');
  }
  context.active.add(value);
  context.seen.add(value);
  try {
    if (isArray) {
      const length = value.length;
      const stringKeys = Object.keys(value);
      if (
        length > 5_000 ||
        keys.length !== length + 1 ||
        stringKeys.length !== length ||
        stringKeys.some((key) => !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length)
      ) {
        throw new TypeError('Resolution arrays must be bounded, dense, and unextended.');
      }
      return Array.from({ length }, (_, index) =>
        snapshotJson(descriptors[String(index)]!.value, depth + 1, context),
      );
    }
    const stringKeys = Object.keys(value);
    if (stringKeys.length > 250 || stringKeys.length !== keys.length) {
      throw new TypeError('Resolution objects contain unsupported keys.');
    }
    const result: JsonObject = {};
    for (const key of stringKeys) {
      const descriptor = descriptors[key]!;
      if (descriptor.enumerable !== true) {
        throw new TypeError('Resolution object properties must be enumerable.');
      }
      result[key] = snapshotJson(descriptor.value, depth + 1, context);
    }
    return result;
  } finally {
    context.active.delete(value);
  }
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

function validRecordVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function hasExactKeys(value: JsonObject, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(lexicalCompare);
  const wanted = [...expected].sort(lexicalCompare);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function bounded(value: string): string {
  if (value.length <= MAX_DIAGNOSTIC_LENGTH) return value;
  return `${value.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

function diagnostic(
  code: PersonAChallengeResolutionIssueCode,
  message: string,
  challengeId: string | null = null,
  resolutionId: string | null = null,
): PersonAChallengeResolutionDiagnostic {
  return {
    code,
    message: bounded(message),
    challenge_id: challengeId,
    resolution_id: resolutionId,
  };
}

function compareDiagnostics(
  left: PersonAChallengeResolutionDiagnostic,
  right: PersonAChallengeResolutionDiagnostic,
): number {
  return (
    lexicalCompare(left.challenge_id ?? '', right.challenge_id ?? '') ||
    lexicalCompare(left.resolution_id ?? '', right.resolution_id ?? '') ||
    lexicalCompare(left.code, right.code) ||
    lexicalCompare(left.message, right.message)
  );
}

function compareChallenges(left: PersonARecordChallenge, right: PersonARecordChallenge): number {
  return (
    lexicalCompare(left.target_path, right.target_path) ||
    lexicalCompare(left.category, right.category) ||
    lexicalCompare(left.challenge_id, right.challenge_id)
  );
}

function compareResolutions(
  left: PersonAChallengeResolutionProposal,
  right: PersonAChallengeResolutionProposal,
): number {
  return (
    lexicalCompare(left.target_path, right.target_path) ||
    lexicalCompare(left.challenge_id, right.challenge_id) ||
    lexicalCompare(left.resolution_id, right.resolution_id)
  );
}

export function derivePersonAChallengeSetHash(
  challenges: readonly PersonARecordChallenge[],
): string {
  return hashPersonAConfirmationArtifact(
    [...challenges].sort(compareChallenges) as unknown as JsonValue,
  );
}

export function derivePersonAChallengeResolutionId(
  resolution: Omit<PersonAChallengeResolutionProposal, 'resolution_id'>,
): string {
  return `pacr_${hashStable(resolution as unknown as JsonValue).slice(0, 24)}`;
}

function objectAtPath(root: JsonObject, dottedPath: string): unknown {
  let current: unknown = root;
  for (const segment of dottedPath.split('.')) {
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function buildObjectIndex(record: JsonObject): Map<string, IndexedObject> {
  const index = new Map<string, IndexedObject>();
  const party = record.party;
  if (isObject(party) && typeof party.party_id === 'string') {
    index.set(party.party_id, {
      item: party,
      path: '/party',
      identityField: 'party_id',
    });
  }
  for (const [familyPath, idField] of familyDescriptors) {
    const items = objectAtPath(record, familyPath);
    if (!Array.isArray(items)) continue;
    items.forEach((value, itemIndex) => {
      if (!isObject(value) || typeof value[idField] !== 'string') return;
      index.set(value[idField], {
        item: value,
        path: `/${familyPath.replaceAll('.', '/')}/${itemIndex}`,
        identityField: idField,
      });
    });
  }
  return index;
}

function decodePointerSegment(value: string): string | null {
  if (/~(?![01])/u.test(value)) return null;
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

function directTargetField(targetPath: string, objectPath: string): string | null {
  if (!targetPath.startsWith(`${objectPath}/`)) return null;
  const suffix = targetPath.slice(objectPath.length + 1);
  if (suffix.length === 0 || suffix.includes('/') || suffix.length > 160) return null;
  return decodePointerSegment(suffix);
}

function pointerValue(root: JsonValue, pointer: string): { found: boolean; value?: JsonValue } {
  if (!pointer.startsWith('/') || pointer === '/' || pointer.length > 500) {
    return { found: false };
  }
  const encoded = pointer.slice(1).split('/');
  const parts = encoded.map(decodePointerSegment);
  if (parts.some((part) => part === null || part.length === 0)) return { found: false };
  let current: JsonValue = root;
  for (const part of parts as string[]) {
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

function pathIsWithinObject(targetPath: string, objectPath: string): boolean {
  return targetPath === objectPath || targetPath.startsWith(`${objectPath}/`);
}

function isGroundingPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.length <= MAX_INPUT_STRING_LENGTH)
  );
}

function normalizeGrounding(
  value: unknown,
  target: IndexedObject,
  targetObjectId: string,
  targetPath: string,
  priorValue: JsonValue,
): GroundingReference | null {
  if (!isObject(value) || value.object_id !== targetObjectId) return null;
  if (value.kind === 'source_span') {
    if (
      !hasExactKeys(value, [
        'kind',
        'object_id',
        'submission_id',
        'quote',
        'start_char',
        'end_char',
      ]) ||
      typeof value.object_id !== 'string' ||
      !IDENTIFIER_PATTERN.test(value.object_id) ||
      typeof value.submission_id !== 'string' ||
      !IDENTIFIER_PATTERN.test(value.submission_id) ||
      typeof value.quote !== 'string' ||
      value.quote.length === 0 ||
      !Number.isSafeInteger(value.start_char) ||
      !Number.isSafeInteger(value.end_char) ||
      (value.start_char as number) < 0 ||
      (value.end_char as number) <= (value.start_char as number) ||
      (value.end_char as number) !== (value.start_char as number) + value.quote.length ||
      !Array.isArray(target.item.source_spans) ||
      !target.item.source_spans.some(
        (span) =>
          isObject(span) &&
          span.submission_id === value.submission_id &&
          span.quote === value.quote &&
          span.start_char === value.start_char &&
          span.end_char === value.end_char,
      )
    ) {
      return null;
    }
    return {
      kind: 'source_span',
      object_id: value.object_id,
      submission_id: value.submission_id,
      quote: value.quote,
      start_char: value.start_char as number,
      end_char: value.end_char as number,
    };
  }
  if (value.kind === 'extracted_object') {
    const field = directTargetField(targetPath, target.path);
    if (
      !field ||
      !hasExactKeys(value, ['kind', 'object_id', 'field', 'value']) ||
      typeof value.object_id !== 'string' ||
      !IDENTIFIER_PATTERN.test(value.object_id) ||
      value.field !== field ||
      !isGroundingPrimitive(value.value) ||
      !isDeepStrictEqual(value.value, priorValue) ||
      !isDeepStrictEqual(target.item[field], priorValue)
    ) {
      return null;
    }
    return {
      kind: 'extracted_object',
      object_id: value.object_id,
      field,
      value: value.value,
    };
  }
  return null;
}

function isRfc3339Utc(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return false;
  }
  const normalizedInput = value.includes('.') ? value.replace(/\.0+Z$/u, 'Z') : value;
  const normalizedDate = new Date(value).toISOString().replace('.000Z', 'Z');
  return normalizedDate === normalizedInput;
}

function confirmationPackageBody(packageValue: JsonObject): JsonValue | null {
  if (!validHash(packageValue.package_id)) return null;
  const body = cloneJson(packageValue);
  delete body.package_id;
  return body;
}

function reviewRecordMatches(record: JsonObject, packageValue: JsonObject): boolean {
  const review = packageValue.review_record;
  return (
    isObject(review) &&
    isDeepStrictEqual(review.party, record.party) &&
    isDeepStrictEqual(review.third_parties, record.third_parties) &&
    isDeepStrictEqual(review.agreement, record.agreement) &&
    isDeepStrictEqual(review.deliverable_assessments, record.deliverable_assessments) &&
    isDeepStrictEqual(review.timeline, record.timeline) &&
    isDeepStrictEqual(review.claims, record.claims) &&
    isDeepStrictEqual(review.evidence, record.evidence) &&
    isDeepStrictEqual(review.claim_evidence_links, record.claim_evidence_links) &&
    isDeepStrictEqual(review.damages_claims, record.damages_claims) &&
    isDeepStrictEqual(review.desired_outcomes, record.desired_outcomes) &&
    isDeepStrictEqual(review.extraction_issues, record.extraction_issues)
  );
}

function invalidResult(
  status: 'invalid' | 'unsupported',
  stage: PersonAChallengeResolutionResult['audit']['failure_stage'],
  errors: PersonAChallengeResolutionDiagnostic[],
  counts: {
    challenges?: number;
    resolutions?: number;
    createdAtInjected?: boolean;
  } = {},
): PersonAChallengeResolutionResult {
  const sorted = [...errors].sort(compareDiagnostics).slice(0, MAX_DIAGNOSTICS);
  return {
    resolution_version: PERSON_A_CHALLENGE_RESOLUTION_VERSION,
    status,
    resolution_result_id: null,
    resolution_batch_id: null,
    prior_confirmation_package_id: null,
    challenged_confirmation_submission_id: null,
    challenge_set_hash: null,
    parent_record: null,
    parent_record_hash: null,
    revised_record: null,
    revised_record_hash: null,
    correction_amendments: [],
    rejected_resolutions: [],
    diagnostics: sorted,
    version_transition: null,
    confirmation_handoff: null,
    confirmation_required: true,
    confirmed: false,
    record_locked: false,
    audit: {
      final_status: 'failed_closed',
      failure_stage: stage,
      challenges_submitted: counts.challenges ?? 0,
      resolutions_submitted: counts.resolutions ?? 0,
      resolutions_accepted: 0,
      resolutions_rejected: 0,
      amendments_created: 0,
      caller_input_unchanged: true,
      parent_record_unchanged: true,
      confirmation_package_unchanged: true,
      challenged_submission_unchanged: true,
      created_at_injected: counts.createdAtInjected ?? false,
    },
  };
}

function parseResolution(
  value: JsonValue,
): PersonAChallengeResolutionProposal | PersonAChallengeResolutionDiagnostic {
  if (!isObject(value)) {
    return diagnostic('invalid_resolution', 'Each resolution must be an object.');
  }
  const resolutionId =
    typeof value.resolution_id === 'string' && RESOLUTION_ID_PATTERN.test(value.resolution_id)
      ? value.resolution_id
      : null;
  const challengeId =
    typeof value.challenge_id === 'string' && /^pach_[a-f0-9]{24}$/u.test(value.challenge_id)
      ? value.challenge_id
      : null;
  const commonValid =
    resolutionId !== null &&
    challengeId !== null &&
    typeof value.target_object_id === 'string' &&
    IDENTIFIER_PATTERN.test(value.target_object_id) &&
    typeof value.target_path === 'string' &&
    value.target_path.length <= 500 &&
    Object.prototype.hasOwnProperty.call(value, 'expected_prior_value');
  if (!commonValid) {
    return diagnostic(
      'invalid_resolution',
      'Resolution identity, challenge binding, target, path, or prior value is malformed.',
      challengeId,
      resolutionId,
    );
  }
  if (value.outcome === 'accepted') {
    if (
      !hasExactKeys(value, [
        'resolution_id',
        'challenge_id',
        'outcome',
        'target_object_id',
        'target_path',
        'expected_prior_value',
        'replacement_value',
        'grounding_reference',
      ])
    ) {
      return diagnostic(
        'invalid_resolution',
        'Accepted resolution must contain only the exact accepted fields.',
        challengeId,
        resolutionId,
      );
    }
  } else if (value.outcome === 'rejected') {
    if (
      !hasExactKeys(value, [
        'resolution_id',
        'challenge_id',
        'outcome',
        'target_object_id',
        'target_path',
        'expected_prior_value',
        'rejection_reason_code',
      ]) ||
      typeof value.rejection_reason_code !== 'string' ||
      !rejectionReasons.has(value.rejection_reason_code as PersonAChallengeRejectionReasonCode)
    ) {
      return diagnostic(
        'invalid_resolution',
        'Rejected resolution requires an explicit supported reason and no mutation.',
        challengeId,
        resolutionId,
      );
    }
  } else {
    return diagnostic(
      'invalid_resolution',
      'Resolution outcome must be accepted or rejected.',
      challengeId,
      resolutionId,
    );
  }
  const candidate = value as unknown as PersonAChallengeResolutionProposal;
  const { resolution_id: _ignored, ...body } = candidate;
  if (derivePersonAChallengeResolutionId(body) !== candidate.resolution_id) {
    return diagnostic(
      'invalid_resolution',
      'Resolution ID does not match its canonical content.',
      candidate.challenge_id,
      candidate.resolution_id,
    );
  }
  return candidate;
}

export function resolvePersonAChallenges(
  input: PersonAChallengeResolutionInput,
): PersonAChallengeResolutionResult {
  let snapshot: JsonObject;
  try {
    const value = snapshotJson(input);
    if (!isObject(value)) throw new TypeError('Resolution input must be an object.');
    snapshot = value;
  } catch (error) {
    return invalidResult('invalid', 'input_snapshot', [
      diagnostic(
        'invalid_input',
        error instanceof Error ? error.message : 'Resolution input is malformed.',
      ),
    ]);
  }
  const inputSnapshotJson = stableJson(snapshot);
  if (
    Object.keys(snapshot).some(
      (key) =>
        ![
          'confirmationResult',
          'amendedRecord',
          'currentRecordVersion',
          'request',
          'options',
        ].includes(key),
    ) ||
    !isObject(snapshot.confirmationResult) ||
    !isObject(snapshot.amendedRecord) ||
    !validRecordVersion(snapshot.currentRecordVersion) ||
    !isObject(snapshot.request) ||
    (snapshot.options !== undefined && !isObject(snapshot.options))
  ) {
    return invalidResult('invalid', 'input_snapshot', [
      diagnostic('invalid_input', 'Resolution input fields are malformed or unsupported.'),
    ]);
  }
  const confirmationResult =
    snapshot.confirmationResult as unknown as PersonARecordConfirmationResult;
  const amendedRecord = snapshot.amendedRecord;
  const currentRecordVersion = snapshot.currentRecordVersion;
  const requestValue = snapshot.request;
  const options = (snapshot.options ?? {}) as JsonObject;
  if (
    Object.keys(options).some((key) => key !== 'createdAt') ||
    (options.createdAt !== undefined &&
      (typeof options.createdAt !== 'string' || !isRfc3339Utc(options.createdAt)))
  ) {
    return invalidResult('invalid', 'input_snapshot', [
      diagnostic('invalid_input', 'options.createdAt must be an injected RFC 3339 UTC timestamp.'),
    ]);
  }
  const createdAt = typeof options.createdAt === 'string' ? options.createdAt : null;
  const recordHash = hashPersonAClarificationArtifact(amendedRecord);
  const narrative = isObject(amendedRecord.submission)
    ? amendedRecord.submission.raw_text
    : undefined;
  const recordValidation =
    typeof narrative === 'string'
      ? validatePersonAExtraction(amendedRecord, narrative)
      : { valid: false };
  if (!recordValidation.valid) {
    return invalidResult('invalid', 'confirmation_binding', [
      diagnostic('invalid_record', 'Parent Person A record is not schema and invariant valid.'),
    ]);
  }

  const packageValue = confirmationResult.confirmation_package;
  const packageBody = isObject(packageValue) ? confirmationPackageBody(packageValue) : null;
  const challenges = Array.isArray(confirmationResult.challenges)
    ? confirmationResult.challenges
    : [];
  const normalizedChallenges = [...challenges].sort(compareChallenges);
  const reconstructedSubmission: JsonValue = {
    version: PERSON_A_CONFIRMATION_SUBMISSION_VERSION,
    outcome: 'challenged',
    confirmation_package_id: confirmationResult.confirmation_package_id,
    amended_record_hash: confirmationResult.amended_record_hash,
    challenges: normalizedChallenges as unknown as JsonValue,
  };
  const challengeSetHash =
    normalizedChallenges.length > 0 ? derivePersonAChallengeSetHash(normalizedChallenges) : null;
  const packageIdentities = isObject(packageValue) ? packageValue.identities : null;
  const confirmationErrors: PersonAChallengeResolutionDiagnostic[] = [];
  if (
    confirmationResult.status !== 'challenged' ||
    confirmationResult.audit?.final_status !== 'passed' ||
    confirmationResult.audit.package_binding_valid !== true ||
    confirmationResult.audit.record_binding_valid !== true ||
    confirmationResult.audit.amended_record_valid !== true ||
    confirmationResult.audit.challenges_submitted !== normalizedChallenges.length ||
    confirmationResult.audit.challenges_accepted !== normalizedChallenges.length ||
    !isObject(packageValue) ||
    !packageBody ||
    packageValue.package_id !== hashPersonAConfirmationArtifact(packageBody) ||
    confirmationResult.confirmation_package_id !== packageValue.package_id ||
    !validHash(confirmationResult.confirmation_submission_id) ||
    confirmationResult.confirmation_submission_id !==
      hashPersonAConfirmationArtifact(reconstructedSubmission) ||
    confirmationResult.amended_record_hash !== recordHash ||
    !isObject(packageIdentities) ||
    packageIdentities.amended_record_hash !== recordHash ||
    !reviewRecordMatches(amendedRecord, packageValue) ||
    normalizedChallenges.length === 0 ||
    normalizedChallenges.length > MAX_PERSON_A_CHALLENGE_RESOLUTIONS
  ) {
    confirmationErrors.push(
      diagnostic(
        'invalid_confirmation_result',
        'PR #8 challenged confirmation result is not passed, canonical, complete, and record-bound.',
      ),
    );
  }
  const objectIndex = buildObjectIndex(amendedRecord);
  const challengeIdCounts = new Map<string, number>();
  const challengeTargetCounts = new Map<string, number>();
  for (const challenge of normalizedChallenges) {
    challengeIdCounts.set(
      challenge.challenge_id,
      (challengeIdCounts.get(challenge.challenge_id) ?? 0) + 1,
    );
    const targetKey = `${challenge.target_path}|${challenge.category}`;
    challengeTargetCounts.set(targetKey, (challengeTargetCounts.get(targetKey) ?? 0) + 1);
  }
  for (const challenge of normalizedChallenges) {
    const target = objectIndex.get(challenge.target_object_id);
    const resolved = pointerValue(amendedRecord, challenge.target_path);
    const challengeBody = { ...challenge } as Partial<PersonARecordChallenge>;
    delete challengeBody.challenge_id;
    if (
      derivePersonAChallengeId(challengeBody as Omit<PersonARecordChallenge, 'challenge_id'>) !==
        challenge.challenge_id ||
      !target ||
      !pathIsWithinObject(challenge.target_path, target.path) ||
      !resolved.found ||
      !isDeepStrictEqual(resolved.value, challenge.expected_prior_value) ||
      (challengeIdCounts.get(challenge.challenge_id) ?? 0) !== 1 ||
      (challengeTargetCounts.get(`${challenge.target_path}|${challenge.category}`) ?? 0) !== 1
    ) {
      confirmationErrors.push(
        diagnostic(
          'invalid_confirmation_result',
          'Challenged confirmation contains a stale or internally inconsistent challenge.',
          challenge.challenge_id,
        ),
      );
    }
  }
  if (confirmationErrors.length > 0) {
    return invalidResult('invalid', 'confirmation_binding', confirmationErrors, {
      challenges: normalizedChallenges.length,
      createdAtInjected: createdAt !== null,
    });
  }

  if (
    !hasExactKeys(requestValue, [
      'version',
      'confirmation_package_id',
      'challenged_confirmation_submission_id',
      'amended_record_hash',
      'challenge_set_hash',
      'expected_record_version',
      'resolutions',
    ]) ||
    requestValue.version !== PERSON_A_CHALLENGE_RESOLUTION_REQUEST_VERSION ||
    !validHash(requestValue.confirmation_package_id) ||
    !validHash(requestValue.challenged_confirmation_submission_id) ||
    !validHash(requestValue.amended_record_hash) ||
    !validHash(requestValue.challenge_set_hash) ||
    !validRecordVersion(requestValue.expected_record_version) ||
    !Array.isArray(requestValue.resolutions) ||
    requestValue.resolutions.length > MAX_PERSON_A_CHALLENGE_RESOLUTIONS
  ) {
    return invalidResult(
      'invalid',
      'batch_validation',
      [diagnostic('invalid_request', 'Challenge-resolution request contract is malformed.')],
      {
        challenges: normalizedChallenges.length,
        resolutions: Array.isArray(requestValue.resolutions) ? requestValue.resolutions.length : 0,
        createdAtInjected: createdAt !== null,
      },
    );
  }
  const bindingErrors: PersonAChallengeResolutionDiagnostic[] = [];
  if (requestValue.confirmation_package_id !== confirmationResult.confirmation_package_id) {
    bindingErrors.push(diagnostic('stale_package', 'Confirmation package binding is stale.'));
  }
  if (
    requestValue.challenged_confirmation_submission_id !==
    confirmationResult.confirmation_submission_id
  ) {
    bindingErrors.push(
      diagnostic('stale_confirmation_submission', 'Challenged submission binding is stale.'),
    );
  }
  if (requestValue.amended_record_hash !== recordHash) {
    bindingErrors.push(diagnostic('stale_record', 'Parent record binding is stale.'));
  }
  if (requestValue.challenge_set_hash !== challengeSetHash) {
    bindingErrors.push(diagnostic('stale_challenge_set', 'Challenge-set binding is stale.'));
  }
  if (requestValue.expected_record_version !== currentRecordVersion) {
    bindingErrors.push(diagnostic('stale_record_version', 'Expected record version is stale.'));
  }
  if (bindingErrors.length > 0) {
    return invalidResult('invalid', 'batch_validation', bindingErrors, {
      challenges: normalizedChallenges.length,
      resolutions: requestValue.resolutions.length,
      createdAtInjected: createdAt !== null,
    });
  }

  const errors: PersonAChallengeResolutionDiagnostic[] = [];
  const parsed: PersonAChallengeResolutionProposal[] = [];
  for (const value of requestValue.resolutions) {
    const parsedValue = parseResolution(value);
    if ('code' in parsedValue) errors.push(parsedValue);
    else parsed.push(parsedValue);
  }
  const resolutionIdCounts = new Map<string, number>();
  const resolutionChallengeIdCounts = new Map<string, number>();
  const targetCounts = new Map<string, number>();
  for (const resolution of parsed) {
    resolutionIdCounts.set(
      resolution.resolution_id,
      (resolutionIdCounts.get(resolution.resolution_id) ?? 0) + 1,
    );
    resolutionChallengeIdCounts.set(
      resolution.challenge_id,
      (resolutionChallengeIdCounts.get(resolution.challenge_id) ?? 0) + 1,
    );
    const targetKey = `${resolution.target_object_id}|${resolution.target_path}`;
    targetCounts.set(targetKey, (targetCounts.get(targetKey) ?? 0) + 1);
  }
  const challengeIndex = new Map(
    normalizedChallenges.map((challenge) => [challenge.challenge_id, challenge]),
  );
  for (const resolution of parsed) {
    if ((resolutionIdCounts.get(resolution.resolution_id) ?? 0) > 1) {
      errors.push(
        diagnostic(
          'duplicate_resolution_id',
          'Duplicate resolution IDs are rejected.',
          resolution.challenge_id,
          resolution.resolution_id,
        ),
      );
    }
    if ((resolutionChallengeIdCounts.get(resolution.challenge_id) ?? 0) > 1) {
      errors.push(
        diagnostic(
          'duplicate_challenge_resolution',
          'Each challenge must have exactly one resolution.',
          resolution.challenge_id,
          resolution.resolution_id,
        ),
      );
    }
    if ((targetCounts.get(`${resolution.target_object_id}|${resolution.target_path}`) ?? 0) > 1) {
      errors.push(
        diagnostic(
          'duplicate_target',
          'Duplicate resolution targets are rejected.',
          resolution.challenge_id,
          resolution.resolution_id,
        ),
      );
    }
    const challenge = challengeIndex.get(resolution.challenge_id);
    if (!challenge) {
      errors.push(
        diagnostic(
          'unknown_challenge',
          'Resolution refers to a challenge outside the bound challenge set.',
          resolution.challenge_id,
          resolution.resolution_id,
        ),
      );
      continue;
    }
    if (
      resolution.target_object_id !== challenge.target_object_id ||
      resolution.target_path !== challenge.target_path
    ) {
      errors.push(
        diagnostic(
          'target_mismatch',
          'Resolution target does not match the bound challenge.',
          challenge.challenge_id,
          resolution.resolution_id,
        ),
      );
    }
    if (!isDeepStrictEqual(resolution.expected_prior_value, challenge.expected_prior_value)) {
      errors.push(
        diagnostic(
          'stale_prior_value',
          'Resolution expected prior value does not match the challenge.',
          challenge.challenge_id,
          resolution.resolution_id,
        ),
      );
    }
    if (resolution.outcome === 'accepted') {
      const target = objectIndex.get(challenge.target_object_id);
      const field = target ? directTargetField(challenge.target_path, target.path) : null;
      if (!target || !field || !Object.prototype.hasOwnProperty.call(target.item, field)) {
        errors.push(
          diagnostic(
            'unsupported_mutation_shape',
            'Accepted resolution must replace one existing direct object field.',
            challenge.challenge_id,
            resolution.resolution_id,
          ),
        );
      } else {
        if (immutableFieldNames.has(field) || field === target.identityField) {
          errors.push(
            diagnostic(
              'immutable_identity_mutation',
              'Accepted resolution cannot change an immutable identity or reference field.',
              challenge.challenge_id,
              resolution.resolution_id,
            ),
          );
        }
        if (
          Array.isArray(target.item[field]) ||
          Array.isArray(resolution.replacement_value) ||
          challenge.category === 'duplication'
        ) {
          errors.push(
            diagnostic(
              'unsupported_mutation_shape',
              'Collection, duplication, insertion, deletion, split, merge, or move correction is unsupported.',
              challenge.challenge_id,
              resolution.resolution_id,
            ),
          );
        }
        if (isDeepStrictEqual(resolution.replacement_value, resolution.expected_prior_value)) {
          errors.push(
            diagnostic(
              'unsupported_resolution',
              'Accepted resolution must supply a changed replacement value.',
              challenge.challenge_id,
              resolution.resolution_id,
            ),
          );
        }
        const grounding = normalizeGrounding(
          resolution.grounding_reference,
          target,
          challenge.target_object_id,
          challenge.target_path,
          challenge.expected_prior_value,
        );
        if (!grounding) {
          errors.push(
            diagnostic(
              'invalid_grounding',
              'Accepted resolution grounding is not exact and target-compatible.',
              challenge.challenge_id,
              resolution.resolution_id,
            ),
          );
        } else {
          resolution.grounding_reference = grounding;
        }
      }
    }
  }
  for (const challenge of normalizedChallenges) {
    if ((resolutionChallengeIdCounts.get(challenge.challenge_id) ?? 0) === 0) {
      errors.push(
        diagnostic(
          'missing_resolution',
          'Every challenge must be resolved exactly once.',
          challenge.challenge_id,
        ),
      );
    }
  }
  if (errors.length > 0) {
    errors.push(
      diagnostic(
        'atomic_batch_rejected',
        'At least one resolution failed, so no revised record or amendment was produced.',
      ),
    );
    const unsupported = errors.some((error) =>
      [
        'unsupported_resolution',
        'unsupported_mutation_shape',
        'immutable_identity_mutation',
      ].includes(error.code),
    );
    return invalidResult(unsupported ? 'unsupported' : 'invalid', 'batch_validation', errors, {
      challenges: normalizedChallenges.length,
      resolutions: requestValue.resolutions.length,
      createdAtInjected: createdAt !== null,
    });
  }

  const normalizedResolutions = [...parsed].sort(compareResolutions);
  const resolutionBatchBody: JsonValue = {
    version: requestValue.version,
    confirmation_package_id: requestValue.confirmation_package_id,
    challenged_confirmation_submission_id: requestValue.challenged_confirmation_submission_id,
    amended_record_hash: requestValue.amended_record_hash,
    challenge_set_hash: requestValue.challenge_set_hash,
    expected_record_version: requestValue.expected_record_version,
    resolutions: normalizedResolutions as unknown as JsonValue,
  };
  const resolutionBatchId = hashStable(resolutionBatchBody);
  const revisedRecord = cloneJson(amendedRecord);
  const revisedIndex = buildObjectIndex(revisedRecord);
  const accepted = normalizedResolutions.filter(
    (resolution): resolution is PersonAAcceptedChallengeResolution =>
      resolution.outcome === 'accepted',
  );
  const rejected = normalizedResolutions.filter(
    (resolution): resolution is PersonARejectedChallengeResolution =>
      resolution.outcome === 'rejected',
  );
  for (const resolution of accepted) {
    const target = revisedIndex.get(resolution.target_object_id)!;
    const field = directTargetField(resolution.target_path, target.path)!;
    target.item[field] = cloneJson(resolution.replacement_value);
  }
  const revisedHash = hashPersonAClarificationArtifact(revisedRecord);
  const resultingVersion = currentRecordVersion + (accepted.length > 0 ? 1 : 0);
  const amendments: PersonAChallengeCorrectionAmendment[] = accepted.map((resolution, index) => {
    const body = {
      challenge_id: resolution.challenge_id,
      resolution_id: resolution.resolution_id,
      target_object_id: resolution.target_object_id,
      target_path: resolution.target_path,
      prior_value: resolution.expected_prior_value,
      replacement_value: resolution.replacement_value,
      grounding_reference: resolution.grounding_reference,
      parent_record_hash: recordHash,
      prior_record_version: currentRecordVersion,
      resulting_record_version: resultingVersion,
    };
    const amendmentId = `paca_corr_${hashStable(body as unknown as JsonValue).slice(0, 24)}`;
    if (!AMENDMENT_ID_PATTERN.test(amendmentId)) {
      throw new TypeError('Internal correction amendment identity is malformed.');
    }
    return {
      amendment_id: amendmentId,
      amendment_sequence: index + 1,
      challenge_id: resolution.challenge_id,
      resolution_id: resolution.resolution_id,
      target_object_id: resolution.target_object_id,
      target_path: resolution.target_path,
      prior_value: cloneJson(resolution.expected_prior_value),
      replacement_value: cloneJson(resolution.replacement_value),
      grounding_reference: cloneJson(
        resolution.grounding_reference as unknown as JsonValue,
      ) as unknown as GroundingReference,
      source_type: 'person_a_challenge_resolution',
      created_at: createdAt,
      parent_record_hash: recordHash,
      resulting_record_hash: revisedHash,
      prior_record_version: currentRecordVersion,
      resulting_record_version: resultingVersion,
    };
  });
  const revisedNarrative = isObject(revisedRecord.submission)
    ? revisedRecord.submission.raw_text
    : undefined;
  const revisedValidation =
    typeof revisedNarrative === 'string'
      ? validatePersonAExtraction(revisedRecord, revisedNarrative)
      : { valid: false };
  if (!revisedValidation.valid) {
    return invalidResult(
      'invalid',
      'record_validation',
      [
        diagnostic(
          'invalid_revised_record',
          'Accepted corrections produced a record that failed canonical Person A validation.',
        ),
        diagnostic(
          'atomic_batch_rejected',
          'Revised record validation failed, so no revised record or amendment was produced.',
        ),
      ],
      {
        challenges: normalizedChallenges.length,
        resolutions: normalizedResolutions.length,
        createdAtInjected: createdAt !== null,
      },
    );
  }
  const rejectedRecords: PersonARejectedChallengeResolutionRecord[] = rejected.map(
    (resolution) => ({
      resolution_id: resolution.resolution_id,
      challenge_id: resolution.challenge_id,
      target_object_id: resolution.target_object_id,
      target_path: resolution.target_path,
      rejection_reason_code: resolution.rejection_reason_code,
    }),
  );
  const versionTransition: PersonAChallengeResolutionVersionTransition = {
    prior_record_version: currentRecordVersion,
    resulting_record_version: resultingVersion,
    parent_record_hash: recordHash,
    resulting_record_hash: revisedHash,
  };
  const resultIdentityBody: JsonValue = {
    resolution_version: PERSON_A_CHALLENGE_RESOLUTION_VERSION,
    resolution_batch_id: resolutionBatchId,
    prior_confirmation_package_id: confirmationResult.confirmation_package_id!,
    challenged_confirmation_submission_id: confirmationResult.confirmation_submission_id!,
    challenge_set_hash: challengeSetHash!,
    correction_amendments: amendments as unknown as JsonValue,
    rejected_resolutions: rejectedRecords as unknown as JsonValue,
    version_transition: versionTransition as unknown as JsonValue,
  };
  const resolutionResultId = hashStable(resultIdentityBody);
  const handoffBody: Omit<PersonAConfirmationRevision, 'handoff_id'> = {
    revision_version: PERSON_A_CONFIRMATION_REVISION_VERSION,
    prior_confirmation_package_id: confirmationResult.confirmation_package_id!,
    challenged_confirmation_submission_id: confirmationResult.confirmation_submission_id!,
    parent_amended_record_hash: recordHash,
    revised_record_hash: revisedHash,
    prior_record_version: currentRecordVersion,
    resulting_record_version: resultingVersion,
    resolution_batch_id: resolutionBatchId,
    correction_amendments: amendments as unknown as JsonValue[],
    confirmation_required: true,
  };
  const confirmationHandoff: PersonAConfirmationRevision = {
    ...handoffBody,
    handoff_id: hashPersonAConfirmationArtifact(handoffBody as unknown as JsonValue),
  };
  let originalUnchanged = false;
  try {
    originalUnchanged = stableJson(snapshotJson(input)) === inputSnapshotJson;
  } catch {
    originalUnchanged = false;
  }
  return {
    resolution_version: PERSON_A_CHALLENGE_RESOLUTION_VERSION,
    status: 'resolved',
    resolution_result_id: resolutionResultId,
    resolution_batch_id: resolutionBatchId,
    prior_confirmation_package_id: confirmationResult.confirmation_package_id!,
    challenged_confirmation_submission_id: confirmationResult.confirmation_submission_id!,
    challenge_set_hash: challengeSetHash!,
    parent_record: cloneJson(amendedRecord),
    parent_record_hash: recordHash,
    revised_record: revisedRecord,
    revised_record_hash: revisedHash,
    correction_amendments: amendments,
    rejected_resolutions: rejectedRecords,
    diagnostics: [],
    version_transition: versionTransition,
    confirmation_handoff: confirmationHandoff,
    confirmation_required: true,
    confirmed: false,
    record_locked: false,
    audit: {
      final_status: 'passed',
      failure_stage: null,
      challenges_submitted: normalizedChallenges.length,
      resolutions_submitted: normalizedResolutions.length,
      resolutions_accepted: accepted.length,
      resolutions_rejected: rejected.length,
      amendments_created: amendments.length,
      caller_input_unchanged: originalUnchanged,
      parent_record_unchanged: true,
      confirmation_package_unchanged: true,
      challenged_submission_unchanged: true,
      created_at_injected: createdAt !== null,
    },
  };
}
