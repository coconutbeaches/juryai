import {
  canonicalSerialize,
  cloneCanonical,
  hashSourceContent,
  validateCaseEnvelope,
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
} from '../v2/case-envelope.js';
import {
  applyEnvelopeCommand,
  commandFor,
  OPERATION_PERMISSIONS,
  type CommandFailureReason,
  type CommandLedger,
  type EnvelopeCommand,
  type EnvelopeOperation,
} from '../v2/envelope-command.js';
import {
  GATE_ZERO_ENVELOPE_OPERATION_TYPES,
  GATE_ZERO_ORACLE_VERSION,
  validateGateZeroTurnOracle,
  type ExpectedEvidenceAction,
  type ExpectedNextQuestionTarget,
  type ExpectedUserVisibleFact,
  type ForbiddenFactualPromotion,
  type GateZeroTurnOracle,
} from '../v2/gate-zero-oracle.js';
import { buildAdjudicationInput, type AdjudicationInput } from '../v2/adjudication-input.js';
import {
  GATE_ZERO_COVERAGE_MATRIX_VERSION,
  GATE_ZERO_CASE_PLANS,
  type GateZeroCoverageRequirementId,
} from './coverage-matrix.js';

export const GATE_ZERO_CASE_FIXTURE_VERSION = 'juryai-gate-zero-case-fixture-v1.0.0';

export interface GateZeroCanonicalCase {
  fixture_version: typeof GATE_ZERO_CASE_FIXTURE_VERSION;
  matrix_version: typeof GATE_ZERO_COVERAGE_MATRIX_VERSION;
  oracle_version: typeof GATE_ZERO_ORACLE_VERSION;
  case_id: string;
  title: string;
  coverage: {
    success: GateZeroCoverageRequirementId[];
    failure: GateZeroCoverageRequirementId[];
  };
  initial_envelope: CaseEnvelope;
  turns: GateZeroTurnOracle[];
  final_envelope: CaseEnvelope;
  expected_adjudication_input: AdjudicationInput | null;
}

export interface AuthorityExpectation {
  namespace: SubstantiveNamespace | 'classification';
  object_id: string;
  authority_kind: ObjectAuthority['authority_kind'];
  introduced_by_actor_id: string;
  resolution_status: ObjectAuthority['resolution_status'];
  party_stances: Record<PartyId, ObjectAuthority['party_stances'][PartyId]['stance']>;
}

export interface AuthoredTurnExpectation {
  disposition: 'applied' | 'idempotent' | 'rejected';
  envelope_version_delta: 0 | 1;
  record_version_delta: 0 | 1;
  failure_reason: CommandFailureReason | null;
  workflow_state: WorkflowState;
  lock_status: CaseEnvelope['control']['lock']['status'];
  lock_mode: CaseEnvelope['control']['lock']['mode'];
  output_scope: CaseEnvelope['control']['lock']['output_scope'];
  authority: AuthorityExpectation[];
  evidence_actions: ExpectedEvidenceAction[];
  invalidated_confirmation_parties: PartyId[];
  required_source_references: SourceReference[];
  next_question_target: ExpectedNextQuestionTarget | null;
  allowed_user_visible_facts: ExpectedUserVisibleFact[];
  forbidden_factual_promotions: ForbiddenFactualPromotion[];
}

export interface CanonicalCaseAuthoringContext {
  envelope: CaseEnvelope;
  ledger: CommandLedger;
  source_registry: Record<string, SourceRecord>;
  saved_commands: Record<string, EnvelopeCommand>;
}

export interface AuthoredTurnInput {
  turn_id: string;
  authenticated_actor: AuthenticatedActor;
  execution_actor?: AuthenticatedActor;
  introduced_sources?: SourceRecord[];
  visible_source_ids?: string[];
  visible_envelope_paths?: string[];
  embargoed_envelope_paths?: string[];
  command_id?: string;
  operations?: EnvelopeOperation[];
  command_source_references?: SourceReference[];
  command_factory?: (context: CanonicalCaseAuthoringContext) => EnvelopeCommand;
  save_command_as?: string;
  expected: AuthoredTurnExpectation;
}

function assertAuthored(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(`Gate Zero authoring mismatch: ${message}`);
}

function authorityAt(
  envelope: CaseEnvelope,
  namespace: SubstantiveNamespace | 'classification',
  objectId: string,
): ObjectAuthority {
  if (namespace === 'classification') {
    assertAuthored(
      objectId === 'classification',
      'classification authority identity must be fixed',
    );
    return envelope.classification.authority;
  }
  const object = envelope[namespace][objectId as never] as { authority?: unknown } | undefined;
  assertAuthored(Boolean(object), `${namespace}.${objectId} must exist after the turn`);
  assertAuthored(
    validateObjectAuthorityShape(object?.authority),
    `${namespace}.${objectId} authority`,
  );
  return cloneCanonical(object.authority);
}

function sorted<T extends string>(values: readonly T[]): T[] {
  return [...values].sort();
}

function permittedOperations(
  envelope: CaseEnvelope,
  actor: AuthenticatedActor,
): EnvelopeOperation['type'][] {
  return sorted(
    OPERATION_PERMISSIONS.filter(
      (permission) =>
        permission.actor_types.includes(actor.actor_type) &&
        permission.workflow_states.includes(envelope.control.workflow_state) &&
        (permission.party_scope !== 'person_b_only' || actor.party_id === 'party_b'),
    ).map((permission) => permission.operation),
  );
}

export class CanonicalCaseAuthoringSession {
  readonly initial_envelope: CaseEnvelope;
  readonly turns: GateZeroTurnOracle[] = [];
  readonly context: CanonicalCaseAuthoringContext;

  constructor(initialEnvelope: CaseEnvelope, initialSources: SourceRecord[] = []) {
    assertAuthored(validateCaseEnvelope(initialEnvelope).length === 0, 'initial envelope invalid');
    this.initial_envelope = cloneCanonical(initialEnvelope);
    this.context = {
      envelope: cloneCanonical(initialEnvelope),
      ledger: {},
      source_registry: {},
      saved_commands: {},
    };
    this.addSources([
      {
        source_id: 'source_system_initialization',
        source_type: 'system_event',
        actor_id: 'juryai_system',
        content: 'Case envelope initialized by deterministic system code.',
        content_hash: hashSourceContent('Case envelope initialized by deterministic system code.'),
      },
      ...initialSources,
    ]);
    this.assertEnvelopeSourcesResolvable(this.context.envelope);
  }

  private addSources(sources: SourceRecord[]): void {
    for (const source of sources) {
      assertAuthored(
        !Object.hasOwn(this.context.source_registry, source.source_id),
        `duplicate source ${source.source_id}`,
      );
      this.context.source_registry[source.source_id] = cloneCanonical(source);
    }
  }

  private assertEnvelopeSourcesResolvable(envelope: CaseEnvelope): void {
    const authorities = [
      envelope.classification.authority,
      ...(
        [
          'actors',
          'agreements',
          'events',
          'payments',
          'deliverables',
          'positions',
          'claimed_losses',
          'requested_outcomes',
          'evidence',
        ] as const
      ).flatMap((namespace) =>
        Object.values(envelope[namespace]).map((object) => object.authority),
      ),
    ];
    const references = [
      ...authorities.flatMap((authority) => authority.source_references),
      ...Object.values(envelope.evidence).flatMap((evidence) =>
        evidence.inspection.source_reference ? [evidence.inspection.source_reference] : [],
      ),
      ...envelope.formation.challenges.flatMap((challenge) => [
        ...challenge.source_references,
        ...challenge.resolution_source_references,
      ]),
      ...envelope.formation.material_change_events.flatMap((event) => event.source_references),
    ];
    for (const reference of references) {
      assertAuthored(
        validateSourceReference(reference, this.context.source_registry).length === 0,
        `envelope source ${reference.source_id} must be registered`,
      );
    }
    const independentAccountSourceId =
      envelope.formation.disclosure.person_b_independent_account_source_id;
    if (independentAccountSourceId) {
      const independentAccountSource = this.context.source_registry[independentAccountSourceId];
      assertAuthored(
        independentAccountSource?.source_type === 'independent_account' &&
          independentAccountSource.actor_id === envelope.parties.party_b.authenticated_subject_id,
        `independent account source ${independentAccountSourceId} must be registered`,
      );
    }
  }

  turn(input: AuthoredTurnInput): GateZeroTurnOracle {
    this.addSources(input.introduced_sources ?? []);
    const before = cloneCanonical(this.context.envelope);
    const executionActor = input.execution_actor ?? input.authenticated_actor;
    const command = input.command_factory
      ? input.command_factory(this.context)
      : commandFor(
          before,
          input.authenticated_actor,
          input.command_id ?? `command_${input.turn_id}`,
          input.operations ?? [],
          input.command_source_references ?? [],
        );
    if (input.save_command_as) {
      assertAuthored(
        !Object.hasOwn(this.context.saved_commands, input.save_command_as),
        `duplicate saved command ${input.save_command_as}`,
      );
      this.context.saved_commands[input.save_command_as] = cloneCanonical(command);
    }
    const result = applyEnvelopeCommand({
      envelope: before,
      command,
      authenticated_actor: executionActor,
      source_registry: this.context.source_registry,
      ledger: this.context.ledger,
    });
    const expected = input.expected;
    assertAuthored(result.status === expected.disposition, `${input.turn_id} disposition`);
    assertAuthored(
      result.reason_code === expected.failure_reason,
      `${input.turn_id} failure reason: expected ${expected.failure_reason}, received ${result.reason_code}`,
    );
    assertAuthored(
      result.envelope.control.envelope_version - before.control.envelope_version ===
        expected.envelope_version_delta,
      `${input.turn_id} envelope version delta`,
    );
    assertAuthored(
      result.envelope.control.record_version - before.control.record_version ===
        expected.record_version_delta,
      `${input.turn_id} record version delta`,
    );
    assertAuthored(
      result.envelope.control.workflow_state === expected.workflow_state,
      `${input.turn_id} workflow state`,
    );
    assertAuthored(
      result.envelope.control.lock.status === expected.lock_status &&
        result.envelope.control.lock.mode === expected.lock_mode &&
        result.envelope.control.lock.output_scope === expected.output_scope,
      `${input.turn_id} lock effect`,
    );
    const actuallyInvalidated = (['party_a', 'party_b'] as const).filter(
      (partyId) =>
        before.formation.confirmations[partyId] !== null &&
        result.envelope.formation.confirmations[partyId] === null,
    );
    assertAuthored(
      canonicalSerialize(actuallyInvalidated) ===
        canonicalSerialize(expected.invalidated_confirmation_parties),
      `${input.turn_id} confirmation invalidation`,
    );

    const authority_fragments = expected.authority
      .map((authorityExpectation) => {
        const authority = authorityAt(
          result.envelope,
          authorityExpectation.namespace,
          authorityExpectation.object_id,
        );
        assertAuthored(
          authority.authority_kind === authorityExpectation.authority_kind &&
            authority.introduced_by.actor_id === authorityExpectation.introduced_by_actor_id &&
            authority.resolution_status === authorityExpectation.resolution_status &&
            authority.party_stances.party_a.stance === authorityExpectation.party_stances.party_a &&
            authority.party_stances.party_b.stance === authorityExpectation.party_stances.party_b,
          `${input.turn_id} authority ${authorityExpectation.namespace}.${authorityExpectation.object_id}`,
        );
        return {
          namespace: authorityExpectation.namespace,
          object_id: authorityExpectation.object_id,
          authority,
        };
      })
      .sort((left, right) => {
        const leftId = `${left.namespace}:${left.object_id}`;
        const rightId = `${right.namespace}:${right.object_id}`;
        return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
      });

    const source_records = Object.values(this.context.source_registry).sort((left, right) =>
      left.source_id < right.source_id ? -1 : left.source_id > right.source_id ? 1 : 0,
    );
    const visible_source_ids = sorted(
      input.visible_source_ids ?? source_records.map((source) => source.source_id),
    );
    assertAuthored(
      visible_source_ids.every((sourceId) => Object.hasOwn(this.context.source_registry, sourceId)),
      `${input.turn_id} visible source must exist`,
    );
    const hidden_source_ids = sorted(
      source_records
        .map((source) => source.source_id)
        .filter((sourceId) => !visible_source_ids.includes(sourceId)),
    );
    const permitted_operation_types = permittedOperations(before, executionActor);
    const forbidden_operation_types = GATE_ZERO_ENVELOPE_OPERATION_TYPES.filter(
      (operation) => !permitted_operation_types.includes(operation),
    );
    const oracle: GateZeroTurnOracle = {
      oracle_version: GATE_ZERO_ORACLE_VERSION,
      turn_id: input.turn_id,
      authenticated_actor: cloneCanonical(executionActor),
      source_records,
      visible_source_ids,
      hidden_source_ids,
      visible_envelope_paths: sorted(input.visible_envelope_paths ?? ['']),
      embargoed_envelope_paths: sorted(input.embargoed_envelope_paths ?? []),
      base_envelope_version: before.control.envelope_version,
      base_envelope_hash: before.control.envelope_hash,
      base_record_version: before.control.record_version,
      base_record_hash: before.control.record_hash,
      command: cloneCanonical(command),
      permitted_operation_types,
      forbidden_operation_types,
      expected: {
        disposition: expected.disposition,
        exact_no_mutation: expected.disposition !== 'applied',
        envelope_version_delta: expected.envelope_version_delta,
        record_version_delta: expected.record_version_delta,
        resulting_envelope_version: result.envelope.control.envelope_version,
        resulting_envelope_hash: result.envelope.control.envelope_hash,
        resulting_record_version: result.envelope.control.record_version,
        resulting_record_hash: result.envelope.control.record_hash,
        authority_fragments,
        evidence_actions: cloneCanonical(expected.evidence_actions),
        invalidated_confirmation_parties: sorted(expected.invalidated_confirmation_parties),
        workflow_state: expected.workflow_state,
        lock_status: expected.lock_status,
        lock_mode: expected.lock_mode,
        output_scope: expected.output_scope,
        failure_reason: expected.failure_reason,
        required_source_references: cloneCanonical(expected.required_source_references),
        next_question_target: cloneCanonical(expected.next_question_target),
        allowed_user_visible_facts: cloneCanonical(expected.allowed_user_visible_facts).sort(
          (left, right) =>
            left.fact_id < right.fact_id ? -1 : left.fact_id > right.fact_id ? 1 : 0,
        ),
        forbidden_factual_promotions: cloneCanonical(expected.forbidden_factual_promotions).sort(
          (left, right) =>
            left.proposition_id < right.proposition_id
              ? -1
              : left.proposition_id > right.proposition_id
                ? 1
                : 0,
        ),
      },
    };
    const oracleIssues = validateGateZeroTurnOracle(oracle);
    assertAuthored(
      oracleIssues.length === 0,
      `${input.turn_id} oracle: ${oracleIssues.join(', ')}`,
    );
    this.assertEnvelopeSourcesResolvable(result.envelope);
    this.context.envelope = cloneCanonical(result.envelope);
    this.context.ledger = cloneCanonical(result.ledger);
    this.turns.push(cloneCanonical(oracle));
    return oracle;
  }

  finish(caseId: string, includeAdjudicationInput = false): GateZeroCanonicalCase {
    const plan = GATE_ZERO_CASE_PLANS.find((candidate) => candidate.case_id === caseId);
    assertAuthored(Boolean(plan?.initial_ten), `${caseId} must be an initial-ten plan`);
    assertAuthored(this.turns.length === plan!.planned_turns, `${caseId} turn count`);
    return {
      fixture_version: GATE_ZERO_CASE_FIXTURE_VERSION,
      matrix_version: GATE_ZERO_COVERAGE_MATRIX_VERSION,
      oracle_version: GATE_ZERO_ORACLE_VERSION,
      case_id: plan!.case_id,
      title: plan!.title,
      coverage: {
        success: cloneCanonical(plan!.success_coverage),
        failure: cloneCanonical(plan!.failure_coverage),
      },
      initial_envelope: cloneCanonical(this.initial_envelope),
      turns: cloneCanonical(this.turns),
      final_envelope: cloneCanonical(this.context.envelope),
      expected_adjudication_input: includeAdjudicationInput
        ? buildAdjudicationInput(this.context.envelope)
        : null,
    };
  }
}

export function validateGateZeroCanonicalCase(fixture: GateZeroCanonicalCase): string[] {
  const issues: string[] = [];
  try {
    canonicalSerialize(fixture);
  } catch {
    return ['case_fixture_not_plain_json'];
  }
  const plan = GATE_ZERO_CASE_PLANS.find((candidate) => candidate.case_id === fixture.case_id);
  const exactTopLevelKeys = [
    'case_id',
    'coverage',
    'expected_adjudication_input',
    'final_envelope',
    'fixture_version',
    'initial_envelope',
    'matrix_version',
    'oracle_version',
    'title',
    'turns',
  ];
  if (
    JSON.stringify(Object.keys(fixture).sort()) !== JSON.stringify(exactTopLevelKeys) ||
    JSON.stringify(Object.keys(fixture.coverage).sort()) !== JSON.stringify(['failure', 'success'])
  ) {
    issues.push('case_fixture_shape_invalid');
  }
  if (!plan?.initial_ten) issues.push('case_fixture_plan_invalid');
  if (
    fixture.fixture_version !== GATE_ZERO_CASE_FIXTURE_VERSION ||
    fixture.matrix_version !== GATE_ZERO_COVERAGE_MATRIX_VERSION ||
    fixture.oracle_version !== GATE_ZERO_ORACLE_VERSION
  ) {
    issues.push('case_fixture_version_invalid');
  }
  if (plan && fixture.turns.length !== plan.planned_turns)
    issues.push('case_fixture_turn_count_invalid');
  if (
    plan &&
    (fixture.title !== plan.title ||
      canonicalSerialize(fixture.coverage.success) !== canonicalSerialize(plan.success_coverage) ||
      canonicalSerialize(fixture.coverage.failure) !== canonicalSerialize(plan.failure_coverage))
  ) {
    issues.push('case_fixture_plan_drift');
  }
  if (validateCaseEnvelope(fixture.initial_envelope).length > 0) {
    issues.push('case_fixture_initial_envelope_invalid');
  }
  if (validateCaseEnvelope(fixture.final_envelope).length > 0) {
    issues.push('case_fixture_final_envelope_invalid');
  }
  if (fixture.expected_adjudication_input !== null) {
    try {
      if (
        canonicalSerialize(fixture.expected_adjudication_input) !==
        canonicalSerialize(buildAdjudicationInput(fixture.final_envelope))
      ) {
        issues.push('case_fixture_adjudication_projection_invalid');
      }
    } catch {
      issues.push('case_fixture_adjudication_projection_invalid');
    }
  }
  if (new Set(fixture.turns.map((turn) => turn.turn_id)).size !== fixture.turns.length) {
    issues.push('case_fixture_turn_id_duplicate');
  }
  for (const [index, turn] of fixture.turns.entries()) {
    if (validateGateZeroTurnOracle(turn).length > 0)
      issues.push(`case_fixture_turn_invalid:${index}`);
    const prior = index === 0 ? fixture.initial_envelope : fixture.turns[index - 1]!.expected;
    if (
      turn.command.case_id !== fixture.case_id ||
      turn.oracle_version !== fixture.oracle_version ||
      turn.base_envelope_version !==
        ('control' in prior ? prior.control.envelope_version : prior.resulting_envelope_version) ||
      turn.base_envelope_hash !==
        ('control' in prior ? prior.control.envelope_hash : prior.resulting_envelope_hash) ||
      turn.base_record_version !==
        ('control' in prior ? prior.control.record_version : prior.resulting_record_version) ||
      turn.base_record_hash !==
        ('control' in prior ? prior.control.record_hash : prior.resulting_record_hash)
    ) {
      issues.push(`case_fixture_turn_chain_invalid:${index}`);
    }
    if (index > 0) {
      const priorSources = fixture.turns[index - 1]!.source_records;
      const currentSourcesById = new Map(
        turn.source_records.map((source) => [source.source_id, source]),
      );
      if (
        priorSources.some(
          (source) =>
            canonicalSerialize(source) !==
            canonicalSerialize(currentSourcesById.get(source.source_id)),
        )
      ) {
        issues.push(`case_fixture_source_history_invalid:${index}`);
      }
    }
  }
  const last = fixture.turns.at(-1)?.expected;
  if (
    last &&
    (last.resulting_envelope_version !== fixture.final_envelope.control.envelope_version ||
      last.resulting_envelope_hash !== fixture.final_envelope.control.envelope_hash ||
      last.resulting_record_version !== fixture.final_envelope.control.record_version ||
      last.resulting_record_hash !== fixture.final_envelope.control.record_hash)
  ) {
    issues.push('case_fixture_final_identity_invalid');
  }
  return issues;
}
