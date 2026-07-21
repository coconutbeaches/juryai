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

export const PERSON_A_RUNTIME_ORCHESTRATION_VERSION = 'person-a-runtime-orchestration-v0.1.1';
export const MAX_RUNTIME_ASSESSMENT_JSON_DEPTH = 64;

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

interface JsonInspection {
  valid: boolean;
  reason: string | null;
}

function inspectJsonValue(
  value: unknown,
  depth = 0,
  active: WeakSet<object> = new WeakSet(),
): JsonInspection {
  if (depth > MAX_RUNTIME_ASSESSMENT_JSON_DEPTH) {
    return {
      valid: false,
      reason: `Assessment exceeds the maximum JSON depth of ${MAX_RUNTIME_ASSESSMENT_JSON_DEPTH}.`,
    };
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return { valid: true, reason: null };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { valid: true, reason: null }
      : { valid: false, reason: 'Assessment contains a non-finite number.' };
  }
  if (typeof value !== 'object') {
    return {
      valid: false,
      reason: `Assessment contains unsupported ${typeof value} data.`,
    };
  }
  if (active.has(value)) {
    return { valid: false, reason: 'Assessment contains a cyclic object or array.' };
  }
  let arrayValue: boolean;
  let prototype: object | null;
  try {
    arrayValue = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    return { valid: false, reason: 'Assessment object metadata cannot be safely inspected.' };
  }
  if (!arrayValue) {
    if (prototype !== Object.prototype && prototype !== null) {
      return { valid: false, reason: 'Assessment contains an object with an unusual prototype.' };
    }
  }
  let descriptors: PropertyDescriptorMap;
  let keys: (string | symbol)[];
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return { valid: false, reason: 'Assessment object properties cannot be safely inspected.' };
  }
  if (keys.some((key) => typeof key === 'symbol')) {
    return { valid: false, reason: 'Assessment contains a symbol-keyed property.' };
  }
  const stringKeys = keys as string[];
  if (arrayValue) {
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0) {
      return { valid: false, reason: 'Assessment array length cannot be safely inspected.' };
    }
    const expectedKeys = Array.from({ length }, (_, index) => String(index));
    const actualKeys = stringKeys.filter((key) => key !== 'length');
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      return { valid: false, reason: 'Assessment contains a sparse or extended array.' };
    }
  }
  active.add(value);
  try {
    for (const key of stringKeys) {
      if (arrayValue && key === 'length') continue;
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        return { valid: false, reason: 'Assessment contains an accessor or hidden property.' };
      }
      const child = inspectJsonValue(descriptor.value, depth + 1, active);
      if (!child.valid) return child;
    }
  } finally {
    active.delete(value);
  }
  return { valid: true, reason: null };
}

function rejectedAuditValue(value: unknown, reason: string): JsonObject {
  let valueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  let ownKeys: string[] = [];
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    try {
      ownKeys = Reflect.ownKeys(value)
        .map((key) => (typeof key === 'symbol' ? key.toString() : key))
        .sort(lexicalCompare)
        .slice(0, 20);
    } catch {
      valueType = 'uninspectable';
    }
  }
  return {
    audit_type: 'rejected_non_json_assessment',
    reason,
    value_type: valueType,
    own_keys: ownKeys,
  };
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
  if (!Array.isArray(providerOutput)) {
    const inspection = inspectJsonValue(providerOutput);
    rejectedAssessments = [
      {
        sequence_number: null,
        assessment: inspection.valid
          ? canonicalize(safeClone(providerOutput))
          : rejectedAuditValue(
              providerOutput,
              inspection.reason ?? 'Provider result is not valid JSON.',
            ),
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
  const preparedAssessments = providerOutput
    .map((value) => {
      const inspection = inspectJsonValue(value);
      return {
        original: value,
        inspection,
        audit: inspection.valid
          ? canonicalize(safeClone(value))
          : rejectedAuditValue(value, inspection.reason ?? 'Assessment is not valid JSON.'),
      };
    })
    .sort((left, right) => lexicalCompare(stableKey(left.audit), stableKey(right.audit)));
  rawAssessments = preparedAssessments.map((item) => item.audit);
  const objectIndex = buildObjectIndex(repaired);
  const acceptedKeys = new Set<string>();
  for (const [index, prepared] of preparedAssessments.entries()) {
    const value = prepared.audit;
    if (!prepared.inspection.valid) {
      rejectedAssessments.push(
        reject(
          index + 1,
          value,
          'assessment_not_json',
          prepared.inspection.reason ?? 'Assessment must contain JSON-compatible values only.',
        ),
      );
      continue;
    }
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
