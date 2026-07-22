import { createHash } from 'node:crypto';
import {
  type ClarificationTriggerKind,
  type EpistemicAssessment,
} from '../clarification/question-generator.js';
import {
  classifyQuestionNecessity,
  generateNecessaryClarificationQuestions,
  type ClassifiedClarificationCandidate,
  type NecessaryClarificationQuestion,
} from '../clarification/question-necessity.js';
import {
  validatePersonAExtraction,
  type PersonAValidationResult,
} from '../extraction/validate-person-a-corrected.js';
import {
  repairPersonAExtraction,
  type PersonARepairResult,
} from '../repair/person-a-record-repair.js';

type JsonObject = Record<string, any>;

export const PERSON_A_RUNTIME_ORCHESTRATION_VERSION = 'person-a-runtime-orchestration-v0.1.4';
export const MAX_RUNTIME_ASSESSMENT_JSON_DEPTH = 64;
export const MAX_RUNTIME_ASSESSMENT_BATCH_SIZE = 100;
export const MAX_RUNTIME_ASSESSMENT_NESTED_ARRAY_LENGTH = 1_000;
export const MAX_RUNTIME_ASSESSMENT_OBJECT_KEYS = 200;
export const MAX_RUNTIME_ASSESSMENT_JSON_NODES = 10_000;
const MAX_RUNTIME_REJECTED_AUDIT_KEYS = 20;
export const MAX_RUNTIME_REJECTED_AUDIT_KEY_LENGTH = 160;

export type RuntimeStageStatus = 'not_started' | 'passed' | 'skipped' | 'failed_closed';
export type RuntimeArtifactStatus = 'absent' | 'present_hashed' | 'present_invalid';
export type RuntimeStageName =
  | 'original_validation'
  | 'repair'
  | 'repaired_validation'
  | 'assessment'
  | 'necessity'
  | 'clarification';

export interface RuntimeAssessmentContext {
  original_extraction: JsonObject;
  repaired_extraction: JsonObject;
  narrative: string;
  repair_audit: PersonARepairResult;
}

export interface RuntimeAssessmentProvider {
  assess(input: RuntimeAssessmentContext): unknown;
}

export interface RuntimeStageResult {
  stage: RuntimeStageName;
  status: RuntimeStageStatus;
  errors: RuntimePlanningError[];
}

export interface RuntimePlanningError {
  stage: RuntimeStageName;
  code: string;
  message: string;
}

export interface RejectedRuntimeAssessment {
  sequence_number: number | null;
  assessment: unknown;
  code: string;
  message: string;
}

export interface PersonARuntimePlanningInput {
  extraction: unknown;
  narrative: string;
  assessmentProvider: RuntimeAssessmentProvider;
  options?: { maxQuestions?: number };
}

export interface PersonARuntimePlanningResult {
  orchestration_version: typeof PERSON_A_RUNTIME_ORCHESTRATION_VERSION;
  original_extraction: unknown;
  repaired_extraction: JsonObject | null;
  original_extraction_hash: string | null;
  repaired_extraction_hash: string | null;
  repair_result: PersonARepairResult | null;
  raw_assessments: unknown[];
  validated_assessments: EpistemicAssessment[];
  rejected_assessments: RejectedRuntimeAssessment[];
  necessity_classifications: ClassifiedClarificationCandidate[];
  generated_questions: NecessaryClarificationQuestion[];
  suppressed_candidates: ClassifiedClarificationCandidate[];
  question_count: number;
  unresolved_material_gaps: ClassifiedClarificationCandidate[];
  stage_statuses: RuntimeStageResult[];
  audit_summary: {
    final_status: 'passed' | 'failed_closed';
    failure_stage: RuntimeStageName | null;
    original_valid: boolean;
    repaired_valid: boolean;
    original_unchanged: boolean;
    original_artifact_status: RuntimeArtifactStatus;
    repaired_artifact_status: RuntimeArtifactStatus;
    assessments_received: number;
    assessments_validated: number;
    assessments_rejected: number;
    questions_generated: number;
    candidates_suppressed: number;
  };
}

export interface PersonARuntimeOrchestratorDependencies {
  validate: typeof validatePersonAExtraction;
  repair: typeof repairPersonAExtraction;
  classify: typeof classifyQuestionNecessity;
  generate: typeof generateNecessaryClarificationQuestions;
}

const defaultDependencies: PersonARuntimeOrchestratorDependencies = {
  validate: validatePersonAExtraction,
  repair: repairPersonAExtraction,
  classify: classifyQuestionNecessity,
  generate: generateNecessaryClarificationQuestions,
};

const families = [
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
] as const;
type RuntimeFamily = (typeof families)[number];

interface IndexedRuntimeObject {
  family: RuntimeFamily;
  item: JsonObject;
}

const familyIdFields: Record<RuntimeFamily, string> = {
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

const assessmentKeys = new Set([
  'target_object_id',
  'target_family',
  'field',
  'trigger',
  'materiality',
  'actor_attribution',
  'causal_link_status',
  'merge_risk',
  'evidence_availability',
  'date_precision',
  'question_context',
  'resolves_object_ids',
]);
const triggers = new Set<ClarificationTriggerKind>([
  'actor_attribution',
  'causal_link',
  'merge_risk',
  'evidence_availability',
  'date_precision',
  'required_bucket_missing',
  'internal_representation',
]);
const materialities = new Set(['critical', 'high', 'medium', 'low']);
const triggerStates: Partial<Record<ClarificationTriggerKind, [string, Set<string>]>> = {
  actor_attribution: ['actor_attribution', new Set(['explicit', 'inferred', 'unstated'])],
  causal_link: ['causal_link_status', new Set(['explicit', 'inferred', 'disputed', 'unstated'])],
  merge_risk: ['merge_risk', new Set(['none', 'possible_merge', 'possible_split'])],
  evidence_availability: [
    'evidence_availability',
    new Set(['available', 'described_only', 'unavailable', 'unknown']),
  ],
  date_precision: ['date_precision', new Set(['day', 'month', 'year', 'range', 'unknown'])],
};
const stateKeys = new Set([
  'actor_attribution',
  'causal_link_status',
  'merge_risk',
  'evidence_availability',
  'date_precision',
]);
interface AssessmentCompatibilityRule {
  family: RuntimeFamily;
  field: string;
  allow_missing_field?: boolean;
}

const assessmentCompatibility: Record<
  ClarificationTriggerKind,
  readonly AssessmentCompatibilityRule[]
> = {
  actor_attribution: [
    { family: 'timeline', field: 'actor_party_id' },
    { family: 'timeline', field: 'actor_third_party_id' },
    { family: 'claims', field: 'party_id' },
  ],
  causal_link: [{ family: 'damages', field: 'causal_theory' }],
  merge_risk: [{ family: 'extraction_issues', field: 'description' }],
  evidence_availability: [{ family: 'evidence', field: 'availability_status' }],
  date_precision: [{ family: 'timeline', field: 'date' }],
  required_bucket_missing: [
    { family: 'agreement_terms', field: 'wording' },
    { family: 'agreement_terms', field: 'person_a_interpretation' },
    { family: 'claims', field: 'claim_text' },
    { family: 'extraction_issues', field: 'description' },
    {
      family: 'extraction_issues',
      field: 'required_information',
      allow_missing_field: true,
    },
  ],
  internal_representation: [
    { family: 'agreement_terms', field: 'wording' },
    { family: 'deliverables', field: 'name' },
    { family: 'timeline', field: 'event_summary' },
    { family: 'claims', field: 'claim_text' },
    { family: 'evidence', field: 'title' },
    { family: 'evidence', field: 'availability_status' },
    { family: 'damages', field: 'causal_theory' },
    { family: 'outcomes', field: 'rationale' },
    { family: 'third_parties', field: 'name_or_label' },
    { family: 'extraction_issues', field: 'description' },
    { family: 'clarification_questions', field: 'question' },
  ],
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(lexicalCompare)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function stableKey(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function safeClone(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : (JSON.parse(serialized) as unknown);
  } catch {
    return null;
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface SafeAuditDescription extends JsonObject {
  audit_type: 'rejected_non_json_assessment';
  reason: string;
  value_type: string;
  own_keys: string[];
}

type JsonSnapshotInspection =
  | {
      valid: true;
      clone: JsonValue;
      reason: null;
      auditDescription: null;
    }
  | {
      valid: false;
      clone?: never;
      reason: string;
      auditDescription: SafeAuditDescription;
    };

interface JsonInspectionOptions {
  rootArrayLengthLimit: number;
}

interface JsonInspectionContext {
  active: WeakSet<object>;
  nodesVisited: number;
}

const nestedJsonInspectionOptions: JsonInspectionOptions = {
  rootArrayLengthLimit: MAX_RUNTIME_ASSESSMENT_NESTED_ARRAY_LENGTH,
};

function canonicalArrayIndex(key: string): number | null {
  if (key === '0') return 0;
  if (!/^[1-9]\d*$/u.test(key)) return null;
  const index = Number(key);
  return Number.isSafeInteger(index) && String(index) === key ? index : null;
}

function prototypeHasEnumerableProperties(prototype: object): boolean {
  try {
    let current: object | null = prototype;
    while (current !== null) {
      if (
        Reflect.ownKeys(current).some(
          (key) => Object.getOwnPropertyDescriptor(current, key)?.enumerable === true,
        )
      ) {
        return true;
      }
      current = Object.getPrototypeOf(current);
    }
    return false;
  } catch {
    return true;
  }
}

function truncateAuditText(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value;
  const ellipsis = '…';
  let prefix = value.slice(0, maximumLength - ellipsis.length);
  const lastCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) prefix = prefix.slice(0, -1);
  return `${prefix}${ellipsis}`;
}

function renderAuditKey(key: string | symbol): string {
  if (typeof key === 'string') {
    return truncateAuditText(key, MAX_RUNTIME_REJECTED_AUDIT_KEY_LENGTH);
  }
  let description: string | undefined;
  try {
    description = key.description;
  } catch {
    return 'Symbol(uninspectable)';
  }
  if (description === undefined) return 'Symbol()';
  const wrapperLength = 'Symbol()'.length;
  const boundedDescription = truncateAuditText(
    description,
    MAX_RUNTIME_REJECTED_AUDIT_KEY_LENGTH - wrapperLength,
  );
  return `Symbol(${boundedDescription})`;
}

function boundedAuditKeys(keys: readonly (string | symbol)[]): string[] {
  return keys.slice(0, MAX_RUNTIME_REJECTED_AUDIT_KEYS).map(renderAuditKey).sort(lexicalCompare);
}

function snapshotFailure(
  reason: string,
  valueType: string,
  keys: readonly (string | symbol)[] = [],
): JsonSnapshotInspection {
  return {
    valid: false,
    reason,
    auditDescription: {
      audit_type: 'rejected_non_json_assessment',
      reason,
      value_type: valueType,
      own_keys: boundedAuditKeys(keys),
    },
  };
}

function samePropertyKeys(
  left: readonly (string | symbol)[],
  right: readonly (string | symbol)[],
): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function samePropertyDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (!left || !right) return left === right;
  if (
    left.configurable !== right.configurable ||
    left.enumerable !== right.enumerable ||
    'value' in left !== 'value' in right
  ) {
    return false;
  }
  if ('value' in left && 'value' in right) {
    return left.writable === right.writable && Object.is(left.value, right.value);
  }
  return left.get === right.get && left.set === right.set;
}

function captureDescriptorMap(
  value: object,
  keys: readonly (string | symbol)[],
): Map<string | symbol, PropertyDescriptor> | null {
  const descriptors = new Map<string | symbol, PropertyDescriptor>();
  try {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) return null;
      descriptors.set(key, descriptor);
    }
  } catch {
    return null;
  }
  return descriptors;
}

function defineSnapshotProperty(target: object, key: string, value: JsonValue): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function inspectAndCloneJsonValue(
  value: unknown,
  options: JsonInspectionOptions = nestedJsonInspectionOptions,
  depth = 0,
  context: JsonInspectionContext = { active: new WeakSet(), nodesVisited: 0 },
): JsonSnapshotInspection {
  context.nodesVisited += 1;
  if (context.nodesVisited > MAX_RUNTIME_ASSESSMENT_JSON_NODES) {
    return snapshotFailure(
      `Assessment exceeds the maximum JSON traversal size of ${MAX_RUNTIME_ASSESSMENT_JSON_NODES} values.`,
      typeof value,
    );
  }
  if (depth > MAX_RUNTIME_ASSESSMENT_JSON_DEPTH) {
    return snapshotFailure(
      `Assessment exceeds the maximum JSON depth of ${MAX_RUNTIME_ASSESSMENT_JSON_DEPTH}.`,
      typeof value,
    );
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return { valid: true, clone: value, reason: null, auditDescription: null };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { valid: true, clone: value, reason: null, auditDescription: null }
      : snapshotFailure('Assessment contains a non-finite number.', 'number');
  }
  if (typeof value !== 'object') {
    return snapshotFailure(`Assessment contains unsupported ${typeof value} data.`, typeof value);
  }
  if (context.active.has(value)) {
    return snapshotFailure('Assessment contains a cyclic object or array.', 'object');
  }
  let arrayValue: boolean;
  let prototype: object | null;
  try {
    arrayValue = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    return snapshotFailure(
      'Assessment object metadata cannot be safely inspected.',
      'uninspectable',
    );
  }
  const valueType = arrayValue ? 'array' : 'object';
  if (
    (arrayValue && prototype !== Array.prototype) ||
    (!arrayValue && prototype !== Object.prototype && prototype !== null)
  ) {
    return snapshotFailure('Assessment contains an object with an unusual prototype.', valueType);
  }
  if (prototype !== null && prototypeHasEnumerableProperties(prototype)) {
    return snapshotFailure('Assessment contains inherited enumerable properties.', valueType);
  }
  let initialLengthDescriptor: PropertyDescriptor | undefined;
  if (arrayValue) {
    try {
      initialLengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    } catch {
      return snapshotFailure('Assessment array length cannot be safely inspected.', valueType);
    }
    if (
      !initialLengthDescriptor ||
      !('value' in initialLengthDescriptor) ||
      initialLengthDescriptor.enumerable ||
      !Number.isSafeInteger(initialLengthDescriptor.value) ||
      initialLengthDescriptor.value < 0
    ) {
      return snapshotFailure('Assessment array length cannot be safely inspected.', valueType);
    }
    const arrayLengthLimit =
      depth === 0 ? options.rootArrayLengthLimit : MAX_RUNTIME_ASSESSMENT_NESTED_ARRAY_LENGTH;
    if (initialLengthDescriptor.value > arrayLengthLimit) {
      return snapshotFailure(
        `Assessment array length exceeds the supported limit of ${arrayLengthLimit}.`,
        valueType,
      );
    }
  }
  let keysBefore: (string | symbol)[];
  try {
    keysBefore = Reflect.ownKeys(value);
  } catch {
    return snapshotFailure(
      'Assessment object properties cannot be safely inspected.',
      'uninspectable',
    );
  }
  if (keysBefore.some((key) => typeof key === 'symbol')) {
    return snapshotFailure('Assessment contains a symbol-keyed property.', valueType, keysBefore);
  }
  const stringKeys = keysBefore as string[];
  if (!arrayValue && stringKeys.length > MAX_RUNTIME_ASSESSMENT_OBJECT_KEYS) {
    return snapshotFailure(
      `Assessment object exceeds the supported own-key limit of ${MAX_RUNTIME_ASSESSMENT_OBJECT_KEYS}.`,
      valueType,
      keysBefore,
    );
  }
  if (arrayValue) {
    const length = initialLengthDescriptor!.value as number;
    let indexCount = 0;
    let minimumIndex = Number.POSITIVE_INFINITY;
    let maximumIndex = Number.NEGATIVE_INFINITY;
    for (const key of stringKeys) {
      if (key === 'length') continue;
      const index = canonicalArrayIndex(key);
      if (index === null || index >= length) {
        return snapshotFailure(
          'Assessment contains a sparse or extended array.',
          valueType,
          keysBefore,
        );
      }
      indexCount += 1;
      minimumIndex = Math.min(minimumIndex, index);
      maximumIndex = Math.max(maximumIndex, index);
    }
    if (
      indexCount !== length ||
      (length > 0 && (minimumIndex !== 0 || maximumIndex !== length - 1))
    ) {
      return snapshotFailure(
        'Assessment contains a sparse or extended array.',
        valueType,
        keysBefore,
      );
    }
  }
  const firstDescriptors = captureDescriptorMap(value, keysBefore);
  let keysMiddle: (string | symbol)[];
  if (!firstDescriptors) {
    return snapshotFailure(
      'Assessment property descriptors cannot be safely inspected.',
      valueType,
      keysBefore,
    );
  }
  try {
    keysMiddle = Reflect.ownKeys(value);
  } catch {
    return snapshotFailure(
      'Assessment object properties changed during inspection.',
      valueType,
      keysBefore,
    );
  }
  if (!samePropertyKeys(keysBefore, keysMiddle)) {
    return snapshotFailure(
      'Assessment object properties changed during inspection.',
      valueType,
      keysBefore,
    );
  }
  const secondDescriptors = captureDescriptorMap(value, keysMiddle);
  let keysAfter: (string | symbol)[];
  if (!secondDescriptors) {
    return snapshotFailure(
      'Assessment property descriptors changed during inspection.',
      valueType,
      keysBefore,
    );
  }
  try {
    keysAfter = Reflect.ownKeys(value);
  } catch {
    return snapshotFailure(
      'Assessment object properties changed during inspection.',
      valueType,
      keysBefore,
    );
  }
  if (
    !samePropertyKeys(keysBefore, keysAfter) ||
    stringKeys.some(
      (key) => !samePropertyDescriptor(firstDescriptors.get(key), secondDescriptors.get(key)),
    )
  ) {
    return snapshotFailure(
      'Assessment property descriptors changed during inspection.',
      valueType,
      keysBefore,
    );
  }
  if (
    arrayValue &&
    !samePropertyDescriptor(initialLengthDescriptor, secondDescriptors.get('length'))
  ) {
    return snapshotFailure(
      'Assessment array length changed during inspection.',
      valueType,
      keysBefore,
    );
  }
  const clone: JsonValue = arrayValue
    ? new Array(initialLengthDescriptor!.value as number)
    : prototype === null
      ? Object.create(null)
      : {};
  context.active.add(value);
  try {
    for (const key of stringKeys) {
      if (arrayValue && key === 'length') continue;
      const descriptor = secondDescriptors.get(key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        return snapshotFailure(
          'Assessment contains an accessor or hidden property.',
          valueType,
          keysBefore,
        );
      }
      const child = inspectAndCloneJsonValue(descriptor.value, options, depth + 1, context);
      if (!child.valid) return child;
      defineSnapshotProperty(clone as object, key, child.clone);
    }
  } finally {
    context.active.delete(value);
  }
  return { valid: true, clone, reason: null, auditDescription: null };
}

function extractionHash(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? null
      : createHash('sha256').update(serialized, 'utf8').digest('hex');
  } catch {
    return null;
  }
}

function familyItems(record: JsonObject, family: RuntimeFamily): unknown[] {
  switch (family) {
    case 'agreement_terms':
      return Array.isArray(record.agreement?.terms) ? record.agreement.terms : [];
    case 'deliverables':
      return Array.isArray(record.deliverable_assessments) ? record.deliverable_assessments : [];
    case 'timeline':
    case 'claims':
    case 'evidence':
    case 'extraction_issues':
    case 'clarification_questions':
      return Array.isArray(record[family]) ? record[family] : [];
    case 'damages':
      return Array.isArray(record.damages_claims) ? record.damages_claims : [];
    case 'outcomes':
      return Array.isArray(record.desired_outcomes?.outcomes)
        ? record.desired_outcomes.outcomes
        : [];
    case 'third_parties':
      return Array.isArray(record.third_parties) ? record.third_parties : [];
  }
}

function buildObjectIndex(record: JsonObject): Map<string, IndexedRuntimeObject> {
  const result = new Map<string, IndexedRuntimeObject>();
  for (const family of families) {
    const idField = familyIdFields[family];
    for (const item of familyItems(record, family)) {
      if (isRecord(item) && typeof item[idField] === 'string') {
        result.set(item[idField], { family, item });
      }
    }
  }
  return result;
}

function validationErrors(result: PersonAValidationResult): string[] {
  return [...result.schemaErrors, ...result.invariantErrors].map(
    (issue) => `${issue.path}: ${issue.message}`,
  );
}

function reject(
  sequence: number,
  assessment: unknown,
  code: string,
  message: string,
): RejectedRuntimeAssessment {
  return {
    sequence_number: sequence,
    assessment: canonicalize(safeClone(assessment)),
    code,
    message,
  };
}

function validateAssessment(
  value: unknown,
  sequence: number,
  objectIndex: Map<string, IndexedRuntimeObject>,
): EpistemicAssessment | RejectedRuntimeAssessment {
  if (!isRecord(value))
    return reject(sequence, value, 'assessment_not_object', 'Assessment must be an object.');
  const unknownKey = Object.keys(value).find((key) => !assessmentKeys.has(key));
  if (unknownKey) {
    return reject(
      sequence,
      value,
      'unsupported_assessment_property',
      `Unsupported assessment property: ${unknownKey}.`,
    );
  }
  for (const field of ['target_object_id', 'target_family', 'field', 'trigger', 'materiality']) {
    if (
      typeof value[field] !== 'string' ||
      value[field].length === 0 ||
      value[field].length > 160
    ) {
      return reject(
        sequence,
        value,
        'invalid_required_field',
        `${field} must be a non-empty bounded string.`,
      );
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value.target_object_id)) {
    return reject(
      sequence,
      value,
      'invalid_target_object_id',
      'target_object_id has an unsafe format.',
    );
  }
  if (!families.includes(value.target_family as RuntimeFamily)) {
    return reject(
      sequence,
      value,
      'unsupported_target_family',
      'target_family is not runtime-supported.',
    );
  }
  if (!triggers.has(value.trigger as ClarificationTriggerKind)) {
    return reject(sequence, value, 'unsupported_trigger', 'trigger is not supported.');
  }
  if (!materialities.has(value.materiality)) {
    return reject(sequence, value, 'invalid_materiality', 'materiality must be categorical.');
  }
  const target = objectIndex.get(value.target_object_id);
  if (!target) {
    return reject(
      sequence,
      value,
      'unknown_target_object',
      'Assessment target does not exist in the repaired extraction.',
    );
  }
  if (target.family !== value.target_family) {
    return reject(
      sequence,
      value,
      'target_family_mismatch',
      'Assessment target_family does not match the target object.',
    );
  }
  const trigger = value.trigger as ClarificationTriggerKind;
  const compatibility = assessmentCompatibility[trigger].find(
    (rule) => rule.family === target.family && rule.field === value.field,
  );
  if (!compatibility) {
    return reject(
      sequence,
      value,
      'incompatible_assessment_target',
      `${trigger} cannot assess ${target.family}.${value.field}.`,
    );
  }
  if (!Object.hasOwn(target.item, value.field) && !compatibility.allow_missing_field) {
    return reject(
      sequence,
      value,
      'assessment_field_missing',
      `Target object ${value.target_object_id} does not contain ${value.field}.`,
    );
  }
  const expectedState = triggerStates[trigger];
  if (expectedState) {
    const [stateField, allowed] = expectedState;
    if (typeof value[stateField] !== 'string' || !allowed.has(value[stateField])) {
      return reject(
        sequence,
        value,
        'invalid_trigger_state',
        `${stateField} is required and must use an allowed categorical value.`,
      );
    }
    const conflictingState = [...stateKeys].find(
      (stateKey) => stateKey !== stateField && value[stateKey] !== undefined,
    );
    if (conflictingState) {
      return reject(
        sequence,
        value,
        'conflicting_trigger_state',
        `Unexpected ${conflictingState} for ${trigger}.`,
      );
    }
  } else if ([...stateKeys].some((stateKey) => value[stateKey] !== undefined)) {
    return reject(
      sequence,
      value,
      'unexpected_trigger_state',
      `${trigger} does not accept a categorical trigger state.`,
    );
  }
  if (value.question_context !== undefined) {
    if (
      typeof value.question_context !== 'string' ||
      value.question_context.trim().length === 0 ||
      value.question_context.length > 160 ||
      /[\p{C}<>?]/u.test(value.question_context)
    ) {
      return reject(
        sequence,
        value,
        'invalid_question_context',
        'question_context must be bounded and safe.',
      );
    }
  }
  if (value.resolves_object_ids !== undefined) {
    if (
      !Array.isArray(value.resolves_object_ids) ||
      value.resolves_object_ids.some(
        (id: unknown) => typeof id !== 'string' || !objectIndex.has(id),
      )
    ) {
      return reject(
        sequence,
        value,
        'invalid_resolved_object',
        'Every resolves_object_id must reference an extracted object.',
      );
    }
  }
  const normalized = structuredClone(value) as unknown as EpistemicAssessment;
  if (normalized.question_context) normalized.question_context = normalized.question_context.trim();
  if (normalized.resolves_object_ids) {
    normalized.resolves_object_ids = [...new Set(normalized.resolves_object_ids)].sort(
      lexicalCompare,
    );
  }
  return normalized;
}

function initialStages(): RuntimeStageResult[] {
  return [
    'original_validation',
    'repair',
    'repaired_validation',
    'assessment',
    'necessity',
    'clarification',
  ].map((stage) => ({ stage: stage as RuntimeStageName, status: 'not_started', errors: [] }));
}

export function orchestratePersonAPlanning(
  input: PersonARuntimePlanningInput,
  dependencies: PersonARuntimeOrchestratorDependencies = defaultDependencies,
): PersonARuntimePlanningResult {
  const stages = initialStages();
  const originalSnapshot = safeClone(input.extraction);
  const originalSerialized = JSON.stringify(originalSnapshot);
  let repaired: JsonObject | null = null;
  let repairResult: PersonARepairResult | null = null;
  let rawAssessments: unknown[] = [];
  let validatedAssessments: EpistemicAssessment[] = [];
  let rejectedAssessments: RejectedRuntimeAssessment[] = [];
  let classifications: ClassifiedClarificationCandidate[] = [];
  let generatedQuestions: NecessaryClarificationQuestion[] = [];
  let suppressedCandidates: ClassifiedClarificationCandidate[] = [];
  let unresolvedMaterialGaps: ClassifiedClarificationCandidate[] = [];
  let originalValid = false;
  let repairedValid = false;
  let originalUnchanged = true;

  const stage = (name: RuntimeStageName): RuntimeStageResult =>
    stages.find((item) => item.stage === name)!;
  const fail = (name: RuntimeStageName, code: string, message: string): void => {
    const current = stage(name);
    current.status = 'failed_closed';
    current.errors.push({ stage: name, code, message });
    let skip = false;
    for (const item of stages) {
      if (item.stage === name) skip = true;
      else if (skip && item.status === 'not_started') item.status = 'skipped';
    }
  };

  const finish = (): PersonARuntimePlanningResult => {
    const failedStage = stages.find((item) => item.status === 'failed_closed')?.stage ?? null;
    const originalHash = originalValid ? extractionHash(originalSnapshot) : null;
    const repairedHash = repaired === null ? null : extractionHash(repaired);
    const originalArtifactStatus: RuntimeArtifactStatus =
      originalSnapshot === null
        ? 'absent'
        : originalValid && originalHash !== null
          ? 'present_hashed'
          : 'present_invalid';
    const repairedArtifactStatus: RuntimeArtifactStatus =
      repaired === null
        ? 'absent'
        : repairedValid && repairedHash !== null
          ? 'present_hashed'
          : 'present_invalid';
    return {
      orchestration_version: PERSON_A_RUNTIME_ORCHESTRATION_VERSION,
      original_extraction: originalSnapshot,
      repaired_extraction: repaired,
      original_extraction_hash: originalHash,
      repaired_extraction_hash: repairedHash,
      repair_result: repairResult,
      raw_assessments: rawAssessments,
      validated_assessments: validatedAssessments,
      rejected_assessments: rejectedAssessments,
      necessity_classifications: classifications,
      generated_questions: generatedQuestions,
      suppressed_candidates: suppressedCandidates,
      question_count: generatedQuestions.length,
      unresolved_material_gaps: unresolvedMaterialGaps,
      stage_statuses: stages,
      audit_summary: {
        final_status: failedStage ? 'failed_closed' : 'passed',
        failure_stage: failedStage,
        original_valid: originalValid,
        repaired_valid: repairedValid,
        original_unchanged: originalUnchanged,
        original_artifact_status: originalArtifactStatus,
        repaired_artifact_status: repairedArtifactStatus,
        assessments_received: rawAssessments.length,
        assessments_validated: validatedAssessments.length,
        assessments_rejected: rejectedAssessments.length,
        questions_generated: generatedQuestions.length,
        candidates_suppressed: suppressedCandidates.length,
      },
    };
  };

  if (typeof input.narrative !== 'string') {
    fail('original_validation', 'invalid_narrative', 'narrative must be a string.');
    return finish();
  }
  let originalValidation: PersonAValidationResult;
  try {
    originalValidation = dependencies.validate(input.extraction, input.narrative);
  } catch (error) {
    fail(
      'original_validation',
      'original_validation_failed',
      error instanceof Error ? error.message : String(error),
    );
    return finish();
  }
  if (!originalValidation.valid) {
    fail(
      'original_validation',
      'invalid_original_extraction',
      validationErrors(originalValidation).join('\n'),
    );
    return finish();
  }
  originalValid = true;
  stage('original_validation').status = 'passed';

  try {
    repairResult = dependencies.repair({
      extraction: input.extraction,
      narrative: input.narrative,
    });
    repaired = structuredClone(repairResult.repaired_extraction);
  } catch (error) {
    repairResult = null;
    repaired = null;
    originalUnchanged = JSON.stringify(input.extraction) === originalSerialized;
    fail('repair', 'repair_failed', error instanceof Error ? error.message : String(error));
    return finish();
  }
  originalUnchanged = JSON.stringify(input.extraction) === originalSerialized;
  if (!originalUnchanged) {
    fail('repair', 'original_mutated', 'Repair changed the original extraction.');
    return finish();
  }
  stage('repair').status = 'passed';

  let repairedValidation: PersonAValidationResult;
  try {
    repairedValidation = dependencies.validate(repaired, input.narrative);
  } catch (error) {
    fail(
      'repaired_validation',
      'repaired_validation_failed',
      error instanceof Error ? error.message : String(error),
    );
    return finish();
  }
  if (!repairedValidation.valid) {
    fail(
      'repaired_validation',
      'invalid_repaired_extraction',
      validationErrors(repairedValidation).join('\n'),
    );
    return finish();
  }
  repairedValid = true;
  stage('repaired_validation').status = 'passed';

  let providerOutput: unknown;
  try {
    providerOutput = input.assessmentProvider.assess({
      original_extraction: structuredClone(originalSnapshot) as JsonObject,
      repaired_extraction: structuredClone(repaired),
      narrative: input.narrative,
      repair_audit: structuredClone(repairResult),
    });
  } catch (error) {
    fail(
      'assessment',
      'assessment_provider_failed',
      error instanceof Error ? error.message : String(error),
    );
    return finish();
  }
  const providerSnapshot = inspectAndCloneJsonValue(providerOutput, {
    rootArrayLengthLimit: MAX_RUNTIME_ASSESSMENT_BATCH_SIZE,
  });
  if (!providerSnapshot.valid) {
    rawAssessments = [providerSnapshot.auditDescription];
    rejectedAssessments = [
      {
        sequence_number: null,
        assessment: providerSnapshot.auditDescription,
        code: 'assessment_not_json',
        message: providerSnapshot.reason,
      },
    ];
    fail('assessment', 'invalid_assessments', 'The runtime assessment batch was rejected.');
    return finish();
  }
  const detachedProviderOutput = providerSnapshot.clone;
  if (!Array.isArray(detachedProviderOutput)) {
    rejectedAssessments = [
      {
        sequence_number: null,
        assessment: canonicalize(detachedProviderOutput),
        code: 'assessment_result_not_array',
        message: 'Assessment provider must return an array.',
      },
    ];
    fail(
      'assessment',
      'malformed_assessment_result',
      'Assessment provider returned malformed data.',
    );
    return finish();
  }
  const preparedAssessments = detachedProviderOutput
    .map((value) => {
      return {
        audit: canonicalize(value),
      };
    })
    .sort((left, right) => lexicalCompare(stableKey(left.audit), stableKey(right.audit)));
  rawAssessments = preparedAssessments.map((item) => item.audit);
  const objectIndex = buildObjectIndex(repaired);
  const acceptedKeys = new Set<string>();
  for (const [index, prepared] of preparedAssessments.entries()) {
    const value = prepared.audit;
    const checked = validateAssessment(value, index + 1, objectIndex);
    if ('code' in checked) rejectedAssessments.push(checked);
    else {
      const key = stableKey(checked);
      if (acceptedKeys.has(key)) {
        rejectedAssessments.push(
          reject(
            index + 1,
            value,
            'duplicate_assessment',
            'Duplicate runtime assessments are not accepted.',
          ),
        );
      } else {
        acceptedKeys.add(key);
        validatedAssessments.push(checked);
      }
    }
  }
  validatedAssessments.sort((left, right) => lexicalCompare(stableKey(left), stableKey(right)));
  rejectedAssessments.sort((left, right) => lexicalCompare(stableKey(left), stableKey(right)));
  if (rejectedAssessments.length > 0) {
    fail('assessment', 'invalid_assessments', 'One or more runtime assessments were rejected.');
    return finish();
  }
  stage('assessment').status = 'passed';

  try {
    const necessity = dependencies.classify(validatedAssessments, repaired);
    if (
      !Array.isArray(necessity.necessity_classification) ||
      !Array.isArray(necessity.question_candidates) ||
      !Array.isArray(necessity.suppressed_candidates) ||
      necessity.necessity_classification.some(
        (candidate) => typeof candidate.reason !== 'string' || candidate.reason.trim().length === 0,
      ) ||
      necessity.suppressed_candidates.some(
        (candidate) => typeof candidate.reason !== 'string' || candidate.reason.trim().length === 0,
      )
    ) {
      throw new Error('Necessity classification returned incomplete candidate audit data.');
    }
    classifications = necessity.necessity_classification;
    suppressedCandidates = necessity.suppressed_candidates;
    unresolvedMaterialGaps = necessity.question_candidates;
  } catch (error) {
    classifications = [];
    suppressedCandidates = [];
    unresolvedMaterialGaps = [];
    fail(
      'necessity',
      'necessity_classification_failed',
      error instanceof Error ? error.message : String(error),
    );
    return finish();
  }
  stage('necessity').status = 'passed';

  const requestedMaximum = input.options?.maxQuestions ?? 6;
  if (!Number.isInteger(requestedMaximum) || requestedMaximum < 0 || requestedMaximum > 6) {
    fail(
      'clarification',
      'invalid_question_limit',
      'maxQuestions must be an integer from 0 through 6.',
    );
    return finish();
  }
  try {
    generatedQuestions = dependencies.generate(unresolvedMaterialGaps, {
      maxQuestions: requestedMaximum,
    });
    if (
      generatedQuestions.some(
        (question) =>
          question.grounding_references.length === 0 ||
          (question.necessity_classification === 'contradiction' &&
            question.contradiction_alternatives.length < 2),
      )
    ) {
      generatedQuestions = [];
      fail(
        'clarification',
        'invalid_question_grounding',
        'Generated question grounding is incomplete.',
      );
      return finish();
    }
  } catch (error) {
    generatedQuestions = [];
    fail(
      'clarification',
      'clarification_generation_failed',
      error instanceof Error ? error.message : String(error),
    );
    return finish();
  }
  stage('clarification').status = 'passed';
  return finish();
}
