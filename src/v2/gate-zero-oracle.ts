import {
  canonicalSerialize,
  hashSourceContent,
  validateObjectAuthorityShape,
  validateSourceReference,
  type AuthenticatedActor,
  type CaseEnvelope,
  type ObjectAuthority,
  type PartyId,
  type SourceRecord,
  type SourceReference,
  type SubstantiveNamespace,
  type WorkflowState,
} from './case-envelope.js';
import {
  COMMAND_FAILURE_REASONS,
  OPERATION_PERMISSIONS,
  validateEnvelopeCommandStructure,
  type CommandFailureReason,
  type EnvelopeCommand,
  type EnvelopeOperation,
} from './envelope-command.js';

export const GATE_ZERO_ORACLE_VERSION = 'juryai-gate-zero-turn-oracle-v2.1.0';
export const GATE_ZERO_ENVELOPE_OPERATION_TYPES: readonly EnvelopeOperation['type'][] =
  Object.freeze(
    [...new Set(OPERATION_PERMISSIONS.map((permission) => permission.operation))].sort(),
  );

export interface ExpectedEvidenceAction {
  evidence_id: string;
  action:
    'described' | 'uploaded' | 'inspected' | 'visibility_changed' | 'withdrawn' | 'superseded';
}

export interface ExpectedNextQuestionTarget {
  addressed_to_party: PartyId;
  namespace: SubstantiveNamespace | 'classification' | 'formation';
  object_id: string | null;
  field: string;
  reason_code: string;
}

export interface ExpectedUserVisibleFact {
  fact_id: string;
  statement: string;
  basis: 'source_quote' | 'party_attributed_assertion' | 'system_state' | 'inspected_evidence';
  party_attribution: PartyId | null;
  source_references: SourceReference[];
}

export interface ForbiddenFactualPromotion {
  proposition_id: string;
  proposition: string;
  prohibited_promotion:
    | 'objective_fact'
    | 'bilateral_agreement'
    | 'party_admission'
    | 'verified_evidence'
    | 'disclosed_context';
  source_references: SourceReference[];
  reason_code: string;
}

export interface ExpectedAuthorityFragment {
  namespace: SubstantiveNamespace | 'classification';
  object_id: string;
  authority: ObjectAuthority;
}

export interface GateZeroTurnOracle {
  oracle_version: typeof GATE_ZERO_ORACLE_VERSION;
  turn_id: string;
  authenticated_actor: AuthenticatedActor;
  source_records: SourceRecord[];
  visible_source_ids: string[];
  hidden_source_ids: string[];
  visible_envelope_paths: string[];
  embargoed_envelope_paths: string[];
  base_envelope_version: number;
  base_envelope_hash: string;
  base_record_version: number;
  base_record_hash: string;
  command: EnvelopeCommand;
  permitted_operation_types: EnvelopeOperation['type'][];
  forbidden_operation_types: EnvelopeOperation['type'][];
  expected: {
    disposition: 'applied' | 'idempotent' | 'rejected';
    exact_no_mutation: boolean;
    envelope_version_delta: 0 | 1;
    record_version_delta: 0 | 1;
    resulting_envelope_version: number;
    resulting_envelope_hash: string;
    resulting_record_version: number;
    resulting_record_hash: string;
    authority_fragments: ExpectedAuthorityFragment[];
    evidence_actions: ExpectedEvidenceAction[];
    invalidated_confirmation_parties: PartyId[];
    workflow_state: WorkflowState;
    lock_status: CaseEnvelope['control']['lock']['status'];
    lock_mode: CaseEnvelope['control']['lock']['mode'];
    output_scope: CaseEnvelope['control']['lock']['output_scope'];
    failure_reason: CommandFailureReason | null;
    required_source_references: SourceReference[];
    next_question_target: ExpectedNextQuestionTarget | null;
    allowed_user_visible_facts: ExpectedUserVisibleFact[];
    forbidden_factual_promotions: ForbiddenFactualPromotion[];
  };
}

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;
const PARTY_IDS = new Set<PartyId>(['party_a', 'party_b']);
const ACTOR_TYPES = new Set(['party', 'system', 'inspector', 'adjudicator']);
const SOURCE_TYPES = new Set<SourceRecord['source_type']>([
  'initial_story',
  'clarification_answer',
  'independent_account',
  'challenge',
  'evidence_inspection',
  'system_event',
  'authoritative_record',
]);
const WORKFLOW_STATES = new Set<WorkflowState>([
  'initial_story',
  'triage',
  'person_a_formation',
  'person_a_confirmation',
  'awaiting_person_b',
  'person_b_independent_account',
  'disclosure_challenge',
  'reconciliation',
  'final_confirmation',
  'ready_for_lock',
  'locked',
  'deliberation',
  'resolved',
  'unresolved',
  'unsuitable',
  'unsafe',
  'withdrawn',
]);
const QUESTION_NAMESPACES = new Set([
  'classification',
  'formation',
  'actors',
  'agreements',
  'events',
  'payments',
  'deliverables',
  'positions',
  'claimed_losses',
  'requested_outcomes',
  'evidence',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function lexicallySorted(values: readonly string[]): boolean {
  return JSON.stringify(values) === JSON.stringify([...values].sort());
}

function validateGateZeroTurnOracleUnchecked(oracle: GateZeroTurnOracle): string[] {
  const issues: string[] = [];
  try {
    canonicalSerialize(oracle);
  } catch {
    return ['oracle_shape_invalid'];
  }
  if (
    !hasExactKeys(oracle, [
      'authenticated_actor',
      'base_envelope_hash',
      'base_envelope_version',
      'base_record_hash',
      'base_record_version',
      'command',
      'embargoed_envelope_paths',
      'expected',
      'forbidden_operation_types',
      'hidden_source_ids',
      'oracle_version',
      'permitted_operation_types',
      'source_records',
      'turn_id',
      'visible_envelope_paths',
      'visible_source_ids',
    ]) ||
    !hasExactKeys(oracle.expected, [
      'allowed_user_visible_facts',
      'authority_fragments',
      'disposition',
      'envelope_version_delta',
      'evidence_actions',
      'exact_no_mutation',
      'failure_reason',
      'forbidden_factual_promotions',
      'invalidated_confirmation_parties',
      'lock_mode',
      'lock_status',
      'next_question_target',
      'output_scope',
      'record_version_delta',
      'required_source_references',
      'resulting_envelope_hash',
      'resulting_envelope_version',
      'resulting_record_hash',
      'resulting_record_version',
      'workflow_state',
    ])
  ) {
    return ['oracle_shape_invalid'];
  }
  if (oracle.oracle_version !== GATE_ZERO_ORACLE_VERSION) issues.push('oracle_version_invalid');
  if (!ID_PATTERN.test(oracle.turn_id)) issues.push('oracle_turn_id_invalid');
  if (
    !hasExactKeys(oracle.authenticated_actor, [
      'actor_id',
      'actor_type',
      'authenticated_subject_id',
      'party_id',
    ]) ||
    !ID_PATTERN.test(oracle.authenticated_actor.actor_id) ||
    !ID_PATTERN.test(oracle.authenticated_actor.authenticated_subject_id) ||
    !ACTOR_TYPES.has(oracle.authenticated_actor.actor_type) ||
    (oracle.authenticated_actor.actor_type === 'party'
      ? !PARTY_IDS.has(oracle.authenticated_actor.party_id as PartyId)
      : oracle.authenticated_actor.party_id !== null)
  ) {
    issues.push('oracle_authenticated_actor_invalid');
  }
  if (
    canonicalSerialize(oracle.authenticated_actor) !==
    canonicalSerialize(oracle.command.authenticated_actor)
  ) {
    issues.push('oracle_command_actor_binding_invalid');
  }
  if (validateEnvelopeCommandStructure(oracle.command) !== null) {
    issues.push('oracle_command_shape_invalid');
  }
  if (
    oracle.expected.disposition === 'applied' &&
    (oracle.command.base_envelope_version !== oracle.base_envelope_version ||
      oracle.command.base_envelope_hash !== oracle.base_envelope_hash)
  ) {
    issues.push('oracle_base_binding_invalid');
  }

  const registry: Record<string, SourceRecord> = {};
  let sourceRecordInvalid = false;
  for (const source of oracle.source_records) {
    if (
      !hasExactKeys(source, ['actor_id', 'content', 'content_hash', 'source_id', 'source_type']) ||
      !ID_PATTERN.test(source.source_id) ||
      !SOURCE_TYPES.has(source.source_type) ||
      (source.actor_id !== null && !ID_PATTERN.test(source.actor_id)) ||
      typeof source.content !== 'string' ||
      !HASH_PATTERN.test(source.content_hash) ||
      hashSourceContent(source.content) !== source.content_hash ||
      Object.hasOwn(registry, source.source_id)
    ) {
      sourceRecordInvalid = true;
      continue;
    }
    registry[source.source_id] = source;
  }
  if (sourceRecordInvalid) issues.push('oracle_source_record_invalid');
  if (!lexicallySorted(oracle.source_records.map((source) => source.source_id))) {
    issues.push('oracle_set_order_invalid');
  }

  const visible = oracle.visible_source_ids;
  const hidden = oracle.hidden_source_ids;
  if (!unique(visible) || !unique(hidden)) issues.push('oracle_visibility_duplicate');
  if (!lexicallySorted(visible) || !lexicallySorted(hidden)) {
    issues.push('oracle_set_order_invalid');
  }
  if (visible.some((sourceId) => hidden.includes(sourceId))) {
    issues.push('oracle_visibility_overlap');
  }
  const classifiedSourceIds = [...visible, ...hidden].sort();
  const registeredSourceIds = Object.keys(registry).sort();
  if (JSON.stringify(classifiedSourceIds) !== JSON.stringify(registeredSourceIds)) {
    issues.push('oracle_visibility_partition_invalid');
  }
  const visiblePaths = oracle.visible_envelope_paths;
  const embargoedPaths = oracle.embargoed_envelope_paths;
  const pathValid = (path: string): boolean =>
    path === '' || /^(?:\/(?:[^~/]|~[01])*)+$/u.test(path);
  const pathsOverlap = (left: string, right: string): boolean =>
    left === right ||
    left === '' ||
    right === '' ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`);
  if (
    !unique(visiblePaths) ||
    !unique(embargoedPaths) ||
    [...visiblePaths, ...embargoedPaths].some((path) => !pathValid(path))
  ) {
    issues.push('oracle_envelope_visibility_path_invalid');
  }
  if (!lexicallySorted(visiblePaths) || !lexicallySorted(embargoedPaths)) {
    issues.push('oracle_set_order_invalid');
  }
  if (
    visiblePaths.some((visiblePath) =>
      embargoedPaths.some((path) => pathsOverlap(visiblePath, path)),
    )
  ) {
    issues.push('oracle_envelope_visibility_overlap');
  }

  const operationOverlap = oracle.permitted_operation_types.filter((operation) =>
    oracle.forbidden_operation_types.includes(operation),
  );
  if (!unique(oracle.permitted_operation_types) || !unique(oracle.forbidden_operation_types)) {
    issues.push('oracle_operation_permission_duplicate');
  }
  if (
    !lexicallySorted(oracle.permitted_operation_types) ||
    !lexicallySorted(oracle.forbidden_operation_types)
  ) {
    issues.push('oracle_set_order_invalid');
  }
  if (operationOverlap.length > 0) issues.push('oracle_operation_permission_overlap');
  const classifiedOperationTypes = new Set([
    ...oracle.permitted_operation_types,
    ...oracle.forbidden_operation_types,
  ]);
  if (
    JSON.stringify([...classifiedOperationTypes].sort()) !==
    JSON.stringify(GATE_ZERO_ENVELOPE_OPERATION_TYPES)
  ) {
    issues.push('oracle_operation_permission_partition_invalid');
  }
  const commandOperationTypes = oracle.command.operations.map((operation) => operation.type);
  if (commandOperationTypes.some((operation) => !classifiedOperationTypes.has(operation))) {
    issues.push('oracle_command_operation_unclassified');
  }
  if (
    oracle.expected.disposition === 'applied' &&
    commandOperationTypes.some((operation) => !oracle.permitted_operation_types.includes(operation))
  ) {
    issues.push('oracle_applied_operation_not_permitted');
  }
  if (
    oracle.expected.exact_no_mutation !== (oracle.expected.envelope_version_delta === 0) ||
    oracle.expected.exact_no_mutation !== (oracle.expected.disposition !== 'applied')
  ) {
    issues.push('oracle_mutation_expectation_invalid');
  }
  if (oracle.expected.record_version_delta > oracle.expected.envelope_version_delta) {
    issues.push('oracle_record_mutation_expectation_invalid');
  }
  if (
    !['applied', 'idempotent', 'rejected'].includes(oracle.expected.disposition) ||
    typeof oracle.expected.exact_no_mutation !== 'boolean' ||
    ![0, 1].includes(oracle.expected.envelope_version_delta) ||
    ![0, 1].includes(oracle.expected.record_version_delta) ||
    !Number.isSafeInteger(oracle.base_envelope_version) ||
    !Number.isSafeInteger(oracle.base_record_version) ||
    !Number.isSafeInteger(oracle.expected.resulting_envelope_version) ||
    !Number.isSafeInteger(oracle.expected.resulting_record_version) ||
    oracle.base_envelope_version < 1 ||
    oracle.base_record_version < 1
  ) {
    issues.push('oracle_version_expectation_invalid');
  }
  if (oracle.expected.disposition === 'rejected' && oracle.expected.failure_reason === null) {
    issues.push('oracle_failure_reason_missing');
  }
  if (oracle.expected.disposition !== 'rejected' && oracle.expected.failure_reason !== null) {
    issues.push('oracle_unexpected_failure_reason');
  }
  if (
    oracle.expected.failure_reason !== null &&
    !COMMAND_FAILURE_REASONS.includes(oracle.expected.failure_reason)
  ) {
    issues.push('oracle_failure_reason_invalid');
  }
  if (
    oracle.expected.resulting_envelope_version !==
      oracle.base_envelope_version + oracle.expected.envelope_version_delta ||
    oracle.expected.resulting_record_version !==
      oracle.base_record_version + oracle.expected.record_version_delta
  ) {
    issues.push('oracle_resulting_version_invalid');
  }
  if (
    !HASH_PATTERN.test(oracle.base_envelope_hash) ||
    !HASH_PATTERN.test(oracle.base_record_hash) ||
    !HASH_PATTERN.test(oracle.expected.resulting_envelope_hash) ||
    !HASH_PATTERN.test(oracle.expected.resulting_record_hash)
  ) {
    issues.push('oracle_hash_invalid');
  }
  if (
    oracle.expected.exact_no_mutation &&
    (oracle.expected.resulting_envelope_hash !== oracle.base_envelope_hash ||
      oracle.expected.resulting_record_hash !== oracle.base_record_hash)
  ) {
    issues.push('oracle_no_mutation_identity_invalid');
  }
  if (
    !oracle.expected.exact_no_mutation &&
    oracle.expected.resulting_envelope_hash === oracle.base_envelope_hash
  ) {
    issues.push('oracle_envelope_mutation_identity_invalid');
  }
  if (
    oracle.expected.record_version_delta === 0 &&
    oracle.expected.resulting_record_hash !== oracle.base_record_hash
  ) {
    issues.push('oracle_record_identity_invalid');
  }
  if (
    oracle.expected.record_version_delta === 1 &&
    oracle.expected.resulting_record_hash === oracle.base_record_hash
  ) {
    issues.push('oracle_record_mutation_identity_invalid');
  }
  if (
    (oracle.expected.lock_status === 'unlocked' &&
      (oracle.expected.lock_mode !== null || oracle.expected.output_scope !== null)) ||
    (oracle.expected.lock_status === 'locked' &&
      (oracle.expected.lock_mode === null || oracle.expected.output_scope === null))
  ) {
    issues.push('oracle_lock_effect_invalid');
  }
  if (
    !WORKFLOW_STATES.has(oracle.expected.workflow_state) ||
    !['unlocked', 'locked'].includes(oracle.expected.lock_status) ||
    ![null, 'bilateral', 'documented_non_participation'].includes(oracle.expected.lock_mode) ||
    ![null, 'adjudication', 'advisory_only'].includes(oracle.expected.output_scope)
  ) {
    issues.push('oracle_workflow_effect_invalid');
  }
  if (
    oracle.expected.authority_fragments.some(
      (fragment) =>
        !hasExactKeys(fragment, ['authority', 'namespace', 'object_id']) ||
        !QUESTION_NAMESPACES.has(fragment.namespace) ||
        !ID_PATTERN.test(fragment.object_id) ||
        !validateObjectAuthorityShape(fragment.authority),
    )
  ) {
    issues.push('oracle_authority_fragment_invalid');
  }
  if (
    !lexicallySorted(
      oracle.expected.authority_fragments.map(
        (fragment) => `${fragment.namespace}:${fragment.object_id}`,
      ),
    )
  ) {
    issues.push('oracle_set_order_invalid');
  }
  if (
    !unique(oracle.expected.invalidated_confirmation_parties) ||
    oracle.expected.invalidated_confirmation_parties.some((partyId) => !PARTY_IDS.has(partyId))
  ) {
    issues.push('oracle_confirmation_invalidation_invalid');
  }
  if (!lexicallySorted(oracle.expected.invalidated_confirmation_parties)) {
    issues.push('oracle_set_order_invalid');
  }
  const evidenceActionIds = oracle.expected.evidence_actions.map(
    (action) => `${action.evidence_id}:${action.action}`,
  );
  if (
    !unique(evidenceActionIds) ||
    oracle.expected.evidence_actions.some(
      (action) =>
        !hasExactKeys(action, ['action', 'evidence_id']) ||
        !ID_PATTERN.test(action.evidence_id) ||
        ![
          'described',
          'uploaded',
          'inspected',
          'visibility_changed',
          'withdrawn',
          'superseded',
        ].includes(action.action),
    )
  ) {
    issues.push('oracle_evidence_action_invalid');
  }

  const referencedSources = [
    ...oracle.command.source_references,
    ...oracle.expected.required_source_references,
    ...oracle.expected.authority_fragments.flatMap((fragment) =>
      validateObjectAuthorityShape(fragment.authority) ? fragment.authority.source_references : [],
    ),
    ...oracle.expected.allowed_user_visible_facts.flatMap((fact) => fact.source_references),
    ...oracle.expected.forbidden_factual_promotions.flatMap(
      (promotion) => promotion.source_references,
    ),
  ];
  if (
    referencedSources.some((reference) => validateSourceReference(reference, registry).length > 0)
  ) {
    issues.push('oracle_source_reference_invalid');
  }
  if (
    oracle.expected.allowed_user_visible_facts.some((fact) =>
      fact.source_references.some(
        (reference) => !oracle.visible_source_ids.includes(reference.source_id),
      ),
    )
  ) {
    issues.push('oracle_visible_fact_uses_hidden_source');
  }
  if (
    !unique(oracle.expected.allowed_user_visible_facts.map((fact) => fact.fact_id)) ||
    !unique(
      oracle.expected.forbidden_factual_promotions.map((promotion) => promotion.proposition_id),
    )
  ) {
    issues.push('oracle_fact_identity_duplicate');
  }
  if (
    !lexicallySorted(oracle.expected.allowed_user_visible_facts.map((fact) => fact.fact_id)) ||
    !lexicallySorted(
      oracle.expected.forbidden_factual_promotions.map((promotion) => promotion.proposition_id),
    )
  ) {
    issues.push('oracle_set_order_invalid');
  }
  if (
    oracle.expected.allowed_user_visible_facts.some(
      (fact) =>
        !hasExactKeys(fact, [
          'basis',
          'fact_id',
          'party_attribution',
          'source_references',
          'statement',
        ]) ||
        !ID_PATTERN.test(fact.fact_id) ||
        typeof fact.statement !== 'string' ||
        fact.statement.length === 0 ||
        ![
          'source_quote',
          'party_attributed_assertion',
          'system_state',
          'inspected_evidence',
        ].includes(fact.basis) ||
        (fact.party_attribution !== null && !PARTY_IDS.has(fact.party_attribution)) ||
        !Array.isArray(fact.source_references),
    ) ||
    oracle.expected.forbidden_factual_promotions.some(
      (promotion) =>
        !hasExactKeys(promotion, [
          'prohibited_promotion',
          'proposition',
          'proposition_id',
          'reason_code',
          'source_references',
        ]) ||
        !ID_PATTERN.test(promotion.proposition_id) ||
        typeof promotion.proposition !== 'string' ||
        promotion.proposition.length === 0 ||
        !ID_PATTERN.test(promotion.reason_code) ||
        ![
          'objective_fact',
          'bilateral_agreement',
          'party_admission',
          'verified_evidence',
          'disclosed_context',
        ].includes(promotion.prohibited_promotion) ||
        !Array.isArray(promotion.source_references),
    )
  ) {
    issues.push('oracle_fact_shape_invalid');
  }
  if (
    oracle.expected.allowed_user_visible_facts.some(
      (fact) =>
        (fact.basis === 'party_attributed_assertion' && fact.party_attribution === null) ||
        (fact.basis !== 'system_state' && fact.source_references.length === 0),
    )
  ) {
    issues.push('oracle_party_attribution_missing');
  }
  if (
    oracle.expected.forbidden_factual_promotions.some(
      (promotion) => promotion.source_references.length === 0,
    )
  ) {
    issues.push('oracle_forbidden_promotion_source_missing');
  }
  if (
    oracle.expected.next_question_target !== null &&
    (!hasExactKeys(oracle.expected.next_question_target, [
      'addressed_to_party',
      'field',
      'namespace',
      'object_id',
      'reason_code',
    ]) ||
      !PARTY_IDS.has(oracle.expected.next_question_target.addressed_to_party) ||
      !QUESTION_NAMESPACES.has(oracle.expected.next_question_target.namespace) ||
      (oracle.expected.next_question_target.object_id !== null &&
        !ID_PATTERN.test(oracle.expected.next_question_target.object_id)) ||
      !ID_PATTERN.test(oracle.expected.next_question_target.reason_code) ||
      oracle.expected.next_question_target.field.length === 0)
  ) {
    issues.push('oracle_next_question_target_invalid');
  }
  return issues;
}

export function validateGateZeroTurnOracle(oracle: GateZeroTurnOracle): string[] {
  try {
    return validateGateZeroTurnOracleUnchecked(oracle);
  } catch {
    return ['oracle_shape_invalid'];
  }
}
