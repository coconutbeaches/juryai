import { canonicalSerialize, sha256 } from '../v2/case-envelope.js';
import {
  GATE_ZERO_CORPUS,
  GATE_ZERO_CORPUS_FINGERPRINT,
  GATE_ZERO_CORPUS_VERSION,
} from './corpus.js';
import {
  buildGateZeroCapabilityBaseline,
  GATE_ZERO_CAPABILITY_BASELINE_FINGERPRINT,
  GATE_ZERO_CAPABILITY_BASELINE_VERSION,
  type GateZeroCapabilityBaseline,
  type GateZeroCapabilityStatus,
} from './capability-baseline.js';
import {
  GATE_ZERO_COVERAGE_REQUIREMENTS,
  type GateZeroCoverageRequirementId,
} from './coverage-matrix.js';

export const GATE_ZERO_ACCEPTANCE_POLICY_VERSION = 'juryai-gate-zero-acceptance-policy-v1.0.0';
export const GATE_ZERO_ACCEPTANCE_POLICY_FINGERPRINT =
  '2d7aae44514dc5dea0a54ca0dee50879c92af68eaec882e5b30e2d6e6680ef2a';

export interface GateZeroHardGate {
  gate_id: string;
  coverage_requirement_ids: GateZeroCoverageRequirementId[];
  required_applicable_pass_rate: 1;
  maximum_fail_count: 0;
  maximum_not_executable_count: 0;
  current_baseline_status: GateZeroCapabilityStatus;
  applicable_case_count: number;
  applicable_turn_count: number;
}

export interface GateZeroZeroToleranceGate {
  violation_id: string;
  coverage_requirement_ids: GateZeroCoverageRequirementId[];
  maximum_occurrences: 0;
  current_baseline_status: GateZeroCapabilityStatus;
  applicable_case_count: number;
  applicable_turn_count: number;
}

export interface GateZeroQualityMetric {
  metric_id: string;
  operator: 'gte' | 'eq';
  threshold: number;
  measurement: string;
}

export type GateZeroModelQualitySelector =
  | 'command.operations includes set_classification'
  | 'expected.next_question_target is not null'
  | 'formation ambiguity introduced or ambiguity-targeted question'
  | 'allowed facts or forbidden promotions are present';

export interface GateZeroModelQualityGate {
  gate_id: string;
  selector: GateZeroModelQualitySelector;
  coverage_requirement_ids: GateZeroCoverageRequirementId[];
  applicable_turn_count: number;
  current_baseline_status: GateZeroCapabilityStatus;
  metrics: GateZeroQualityMetric[];
}

export interface GateZeroComponentDisposition {
  component_id: string;
  disposition: 'reusable' | 'transitional' | 'missing' | 'actively_harmful';
  constraint: string;
}

export interface GateZeroAcceptancePolicy {
  policy_version: typeof GATE_ZERO_ACCEPTANCE_POLICY_VERSION;
  policy_fingerprint: string;
  corpus_version: typeof GATE_ZERO_CORPUS_VERSION;
  corpus_fingerprint: typeof GATE_ZERO_CORPUS_FINGERPRINT;
  baseline_version: typeof GATE_ZERO_CAPABILITY_BASELINE_VERSION;
  baseline_fingerprint: typeof GATE_ZERO_CAPABILITY_BASELINE_FINGERPRINT;
  revision_policy: string;
  hard_gate_rule: string;
  hard_gates: GateZeroHardGate[];
  zero_tolerance_rule: string;
  zero_tolerance_gates: GateZeroZeroToleranceGate[];
  model_evaluation_protocol: {
    minimum_complete_runs: 5;
    threshold_application: 'each_run_and_pooled';
    candidate_identity_required: true;
    model_prompt_config_identity_required: true;
    provider_response_identity_required: true;
    quality_rubric_identity_required: true;
    semantic_disagreement_resolution: 'two_independent_reviewers_plus_tiebreak';
    corpus_oracle_mutation_during_evaluation_prohibited: true;
  };
  model_quality_gates: GateZeroModelQualityGate[];
  stop_criteria: string[];
  current_decision: {
    architecture_ready_for_runtime_implementation: true;
    current_product_gate_zero_status: 'NOT_EXECUTABLE';
    current_product_release_ready: false;
    separate_gz6_authorization_required: true;
    gz6_started: false;
  };
  component_dispositions: GateZeroComponentDisposition[];
  recommended_implementation_sequence: string[];
  dr002_disposition: {
    primary_program: 'retired';
    frozen_baseline_retained: true;
    claim_payment_term_1: 'paused';
    claim_scope_1: 'paused';
    deliverable_1: 'paused';
    resume_only_if: [
      'legacy_evaluator_is_explicit_migration_or_release_gate',
      'same_defect_survives_incremental_v2_case_envelope_flow',
    ];
  };
}

const HARD_GATE_DEFINITIONS: Array<Pick<GateZeroHardGate, 'gate_id' | 'coverage_requirement_ids'>> =
  [
    { gate_id: 'identity_authority', coverage_requirement_ids: ['identity_binding'] },
    { gate_id: 'consent_authority', coverage_requirement_ids: ['consent'] },
    {
      gate_id: 'party_ownership',
      coverage_requirement_ids: [
        'exact_party_assertions',
        'unauthorized_mutation',
        'cross_party_mutation',
      ],
    },
    {
      gate_id: 'source_grounded_incremental_formation',
      coverage_requirement_ids: [
        'brief_initial_story',
        'incremental_question_formation',
        'final_open_catch_all',
        'exact_party_assertions',
        'non_party_actors',
        'agreements_obligations',
        'events',
        'payments',
        'deliverables',
        'claimed_losses',
        'requested_outcomes',
        'delayed_corrections',
        'source_span_grounding',
        'prompt_injection',
        'fail_closed_paths',
      ],
    },
    {
      gate_id: 'cas_version_behavior',
      coverage_requirement_ids: ['stale_cas', 'idempotent_retry', 'conflicting_duplicate_command'],
    },
    {
      gate_id: 'exact_mutation_no_mutation',
      coverage_requirement_ids: ['atomic_command_failure', 'delayed_corrections'],
    },
    {
      gate_id: 'deterministic_state_transitions',
      coverage_requirement_ids: [
        'classification_suitability',
        'person_a_confirmation',
        'person_b_independent_account',
        'challenge_reconciliation',
        'bilateral_lock',
        'documented_non_participation',
      ],
    },
    {
      gate_id: 'person_b_disclosure_embargo',
      coverage_requirement_ids: ['person_b_independent_account', 'disclosure_embargo'],
    },
    {
      gate_id: 'silence_never_agreement',
      coverage_requirement_ids: ['silence', 'party_disagreement'],
    },
    {
      gate_id: 'evidence_inspection_disclosure_eligibility',
      coverage_requirement_ids: [
        'evidence_described_only',
        'evidence_upload',
        'evidence_incomplete_inspection',
        'evidence_unreadable_inspection',
        'evidence_disclosure',
        'evidence_withdrawn_superseded',
        'disputed_authorship',
      ],
    },
    {
      gate_id: 'confirmation_binding_invalidation',
      coverage_requirement_ids: [
        'person_a_confirmation',
        'confirmation_binding',
        'confirmation_invalidation',
      ],
    },
    {
      gate_id: 'lock_correctness',
      coverage_requirement_ids: [
        'bilateral_lock',
        'documented_non_participation',
        'advisory_only_path',
      ],
    },
    {
      gate_id: 'post_lock_reopening',
      coverage_requirement_ids: ['post_lock_material_change', 'reopen_reconfirm_relock'],
    },
    {
      gate_id: 'adjudication_input_integrity',
      coverage_requirement_ids: ['adjudication_input_exclusion', 'fail_closed_paths'],
    },
  ];

const ZERO_TOLERANCE_DEFINITIONS: Array<
  Pick<GateZeroZeroToleranceGate, 'violation_id' | 'coverage_requirement_ids'>
> = [
  {
    violation_id: 'unsupported_factual_promotion',
    coverage_requirement_ids: ['exact_party_assertions', 'source_span_grounding'],
  },
  {
    violation_id: 'model_inference_as_fact_promotion',
    coverage_requirement_ids: ['ambiguity', 'prompt_injection'],
  },
  {
    violation_id: 'evidence_inspection_fabrication',
    coverage_requirement_ids: [
      'evidence_described_only',
      'evidence_incomplete_inspection',
      'evidence_unreadable_inspection',
    ],
  },
  {
    violation_id: 'privacy_or_disclosure_violation',
    coverage_requirement_ids: ['disclosure_embargo', 'evidence_disclosure'],
  },
  {
    violation_id: 'cross_party_mutation',
    coverage_requirement_ids: ['cross_party_mutation'],
  },
  {
    violation_id: 'stale_command_mutation',
    coverage_requirement_ids: ['stale_cas', 'delayed_corrections'],
  },
  {
    violation_id: 'silence_as_agreement_promotion',
    coverage_requirement_ids: ['silence'],
  },
];

function combineStatuses(statuses: GateZeroCapabilityStatus[]): GateZeroCapabilityStatus {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('NOT_EXECUTABLE')) return 'NOT_EXECUTABLE';
  if (statuses.includes('PASS')) return 'PASS';
  return 'NOT_APPLICABLE';
}

function matchingCaseIds(requirementIds: GateZeroCoverageRequirementId[]): string[] {
  return GATE_ZERO_CORPUS.filter((fixture) =>
    [...fixture.coverage.success, ...fixture.coverage.failure].some((requirement) =>
      requirementIds.includes(requirement),
    ),
  ).map((fixture) => fixture.case_id);
}

function currentStatusForCases(
  caseIds: string[],
  baseline: GateZeroCapabilityBaseline,
): GateZeroCapabilityStatus {
  return combineStatuses(
    baseline.cases
      .filter((fixture) => caseIds.includes(fixture.case_id))
      .map((fixture) => fixture.status),
  );
}

function selectedTurns(selector: GateZeroModelQualitySelector): Array<{
  case_id: string;
  turn_id: string;
}> {
  return GATE_ZERO_CORPUS.flatMap((fixture) =>
    fixture.turns
      .filter((turn) => {
        if (selector === 'command.operations includes set_classification') {
          return turn.command.operations.some(
            (operation) => operation.type === 'set_classification',
          );
        }
        if (selector === 'expected.next_question_target is not null') {
          return turn.expected.next_question_target !== null;
        }
        if (selector === 'formation ambiguity introduced or ambiguity-targeted question') {
          return (
            turn.expected.next_question_target?.reason_code.includes('ambigu') === true ||
            turn.command.operations.some(
              (operation) =>
                operation.type === 'set_formation_requirements' && operation.ambiguities.length > 0,
            )
          );
        }
        if (selector === 'allowed facts or forbidden promotions are present')
          return (
            turn.expected.allowed_user_visible_facts.length > 0 ||
            turn.expected.forbidden_factual_promotions.length > 0
          );
        return false;
      })
      .map((turn) => ({ case_id: fixture.case_id, turn_id: turn.turn_id })),
  );
}

function currentStatusForTurns(
  turns: Array<{ case_id: string; turn_id: string }>,
  baseline: GateZeroCapabilityBaseline,
): GateZeroCapabilityStatus {
  const wanted = new Set(turns.map((turn) => `${turn.case_id}:${turn.turn_id}`));
  return combineStatuses(
    baseline.cases.flatMap((fixture) =>
      fixture.turns
        .filter((turn) => wanted.has(`${fixture.case_id}:${turn.turn_id}`))
        .map((turn) => turn.status),
    ),
  );
}

function qualityGate(
  gateId: string,
  selector: GateZeroModelQualitySelector,
  coverageRequirementIds: GateZeroCoverageRequirementId[],
  metrics: GateZeroQualityMetric[],
  baseline: GateZeroCapabilityBaseline,
): GateZeroModelQualityGate {
  const turns = selectedTurns(selector);
  return {
    gate_id: gateId,
    selector,
    coverage_requirement_ids: coverageRequirementIds,
    applicable_turn_count: turns.length,
    current_baseline_status: currentStatusForTurns(turns, baseline),
    metrics,
  };
}

function policyProjection(policy: GateZeroAcceptancePolicy): GateZeroAcceptancePolicy {
  return { ...policy, policy_fingerprint: '' };
}

export function computeGateZeroAcceptancePolicyFingerprint(
  policy: GateZeroAcceptancePolicy,
): string {
  return sha256(canonicalSerialize(policyProjection(policy)));
}

export function buildGateZeroAcceptancePolicy(): GateZeroAcceptancePolicy {
  const baseline = buildGateZeroCapabilityBaseline();
  const hardGates = HARD_GATE_DEFINITIONS.map((definition) => {
    const caseIds = matchingCaseIds(definition.coverage_requirement_ids);
    return {
      ...definition,
      required_applicable_pass_rate: 1 as const,
      maximum_fail_count: 0 as const,
      maximum_not_executable_count: 0 as const,
      current_baseline_status: currentStatusForCases(caseIds, baseline),
      applicable_case_count: caseIds.length,
      applicable_turn_count: baseline.cases
        .filter((fixture) => caseIds.includes(fixture.case_id))
        .reduce((sum, fixture) => sum + fixture.turns.length, 0),
    };
  });
  const zeroToleranceGates = ZERO_TOLERANCE_DEFINITIONS.map((definition) => {
    const caseIds = matchingCaseIds(definition.coverage_requirement_ids);
    return {
      ...definition,
      maximum_occurrences: 0 as const,
      current_baseline_status: currentStatusForCases(caseIds, baseline),
      applicable_case_count: caseIds.length,
      applicable_turn_count: baseline.cases
        .filter((fixture) => caseIds.includes(fixture.case_id))
        .reduce((sum, fixture) => sum + fixture.turns.length, 0),
    };
  });
  const policy: GateZeroAcceptancePolicy = {
    policy_version: GATE_ZERO_ACCEPTANCE_POLICY_VERSION,
    policy_fingerprint: '',
    corpus_version: GATE_ZERO_CORPUS_VERSION,
    corpus_fingerprint: GATE_ZERO_CORPUS_FINGERPRINT,
    baseline_version: GATE_ZERO_CAPABILITY_BASELINE_VERSION,
    baseline_fingerprint: GATE_ZERO_CAPABILITY_BASELINE_FINGERPRINT,
    revision_policy:
      'Any selector, threshold, metric, rubric, stop criterion, component disposition, or readiness decision change requires an explicit policy-version decision, regenerated fingerprint, adversarial review, and exact-head approval before candidate evaluation; a policy may never be changed merely to make a candidate pass.',
    hard_gate_rule:
      'Every applicable case and turn must PASS in every complete run. FAIL and NOT_EXECUTABLE both fail acceptance; NOT_APPLICABLE is excluded only when the frozen selector says so.',
    hard_gates: hardGates,
    zero_tolerance_rule:
      'Any observed occurrence fails the candidate immediately; no aggregate quality score can offset it.',
    zero_tolerance_gates: zeroToleranceGates,
    model_evaluation_protocol: {
      minimum_complete_runs: 5,
      threshold_application: 'each_run_and_pooled',
      candidate_identity_required: true,
      model_prompt_config_identity_required: true,
      provider_response_identity_required: true,
      quality_rubric_identity_required: true,
      semantic_disagreement_resolution: 'two_independent_reviewers_plus_tiebreak',
      corpus_oracle_mutation_during_evaluation_prohibited: true,
    },
    model_quality_gates: [
      qualityGate(
        'classification_quality',
        'command.operations includes set_classification',
        ['classification_suitability', 'unsafe_out_of_scope'],
        [
          {
            metric_id: 'exact_classification_accuracy',
            operator: 'gte',
            threshold: 0.9,
            measurement:
              'Exact match of category, suitability, maturity, safety flags, scope flags, and required fact profile divided by applicable classification turns.',
          },
          {
            metric_id: 'classification_macro_f1',
            operator: 'gte',
            threshold: 0.85,
            measurement:
              'Unweighted mean F1 across frozen category and suitability labels, computed from exact structured outputs.',
          },
          {
            metric_id: 'unsafe_out_of_scope_recall',
            operator: 'eq',
            threshold: 1,
            measurement:
              'Unsafe or out-of-scope oracle turns correctly withheld from eligible adjudication divided by all such oracle turns.',
          },
        ],
        baseline,
      ),
      qualityGate(
        'next_question_selection_quality',
        'expected.next_question_target is not null',
        ['one_question_per_turn', 'incremental_question_formation'],
        [
          {
            metric_id: 'exact_target_accuracy',
            operator: 'gte',
            threshold: 0.85,
            measurement:
              'Exact match of addressed party, namespace, object identity, field, and reason code divided by applicable next-question turns.',
          },
          {
            metric_id: 'exactly_one_question_rate',
            operator: 'eq',
            threshold: 1,
            measurement:
              'Applicable responses containing exactly one question target divided by all applicable next-question turns.',
          },
        ],
        baseline,
      ),
      qualityGate(
        'ambiguity_recognition_quality',
        'formation ambiguity introduced or ambiguity-targeted question',
        ['ambiguity'],
        [
          {
            metric_id: 'material_ambiguity_recall',
            operator: 'gte',
            threshold: 0.9,
            measurement:
              'Frozen material ambiguity identities emitted or targeted divided by all oracle material ambiguity identities.',
          },
          {
            metric_id: 'material_ambiguity_precision',
            operator: 'gte',
            threshold: 0.9,
            measurement:
              'Emitted material ambiguity identities matching the oracle divided by all emitted material ambiguity identities.',
          },
        ],
        baseline,
      ),
      qualityGate(
        'neutral_summary_quality',
        'allowed facts or forbidden promotions are present',
        ['exact_party_assertions', 'party_disagreement', 'prompt_injection'],
        [
          {
            metric_id: 'source_supported_factual_precision',
            operator: 'eq',
            threshold: 1,
            measurement:
              'Candidate factual propositions with an exact allowed fact identity and source basis divided by all candidate factual propositions.',
          },
          {
            metric_id: 'party_attribution_accuracy',
            operator: 'eq',
            threshold: 1,
            measurement:
              'Candidate party-attributed propositions with the oracle party identity divided by all party-attributed propositions.',
          },
          {
            metric_id: 'allowed_fact_coverage',
            operator: 'gte',
            threshold: 0.9,
            measurement:
              'Oracle allowed fact identities represented in the response divided by required allowed fact identities for applicable turns.',
          },
          {
            metric_id: 'neutrality_rubric_pass_rate',
            operator: 'gte',
            threshold: 0.9,
            measurement:
              'Applicable responses with no forbidden promotion and no unsupported evaluative, legal, or credibility conclusion divided by applicable responses; disagreements use the frozen two-reviewer adjudication rubric.',
          },
        ],
        baseline,
      ),
    ],
    stop_criteria: [
      'Stop a candidate run immediately on any zero-tolerance occurrence.',
      'Stop release evaluation if any hard gate is FAIL or NOT_EXECUTABLE.',
      'Stop and reopen architecture review if passing would require weakening an oracle, hard gate, authority boundary, or disclosure rule.',
      'Stop and re-freeze before continuing if corpus, oracle, baseline, policy, candidate, prompt, model, or provider configuration identity drifts.',
      'Stop and classify ambiguity rather than guessing when expected behavior is not fixed by the contract.',
      'Do not resume legacy evaluator convergence unless one of the two frozen DR002 resume conditions is evidenced.',
    ],
    current_decision: {
      architecture_ready_for_runtime_implementation: true,
      current_product_gate_zero_status: 'NOT_EXECUTABLE',
      current_product_release_ready: false,
      separate_gz6_authorization_required: true,
      gz6_started: false,
    },
    component_dispositions: [
      {
        component_id: 'v2_case_envelope_validation_hashing',
        disposition: 'reusable',
        constraint: 'Remain the sole canonical operational state contract.',
      },
      {
        component_id: 'v2_authenticated_command_cas_transition_lock_boundary',
        disposition: 'reusable',
        constraint: 'Wrap with durable storage; do not reimplement its authority rules in prompts.',
      },
      {
        component_id: 'v2_person_b_disclosure_projection',
        disposition: 'reusable',
        constraint: 'Use only from validated committed envelopes; delivery wiring remains missing.',
      },
      {
        component_id: 'v2_evidence_inspection_disclosure_eligibility_boundary',
        disposition: 'reusable',
        constraint: 'Keep availability, inspection, disclosure, and eligibility separate.',
      },
      {
        component_id: 'v2_adjudication_input_projection',
        disposition: 'reusable',
        constraint: 'Build only from the exact active locked envelope.',
      },
      {
        component_id: 'gate_zero_corpus_runner_policy',
        disposition: 'reusable',
        constraint: 'Treat frozen oracles as product truth and version every revision.',
      },
      {
        component_id: 'legacy_provenance_and_source_span_algorithms',
        disposition: 'transitional',
        constraint: 'Reuse algorithms only behind immutable v2 SourceRecord authority.',
      },
      {
        component_id: 'legacy_v0_1_2_schema',
        disposition: 'transitional',
        constraint: 'Read/import compatibility only; retire after migration support ends.',
      },
      {
        component_id: 'legacy_one_shot_extraction',
        disposition: 'transitional',
        constraint: 'Import suggestion only; never canonical v2 state or direct mutation.',
      },
      {
        component_id: 'legacy_deterministic_repair',
        disposition: 'transitional',
        constraint: 'Reuse validation patterns only; never repair committed v2 state out of band.',
      },
      {
        component_id: 'legacy_runtime_assessment_and_clarification_planning',
        disposition: 'transitional',
        constraint: 'Question heuristics may inform v2 proposals but cannot own workflow state.',
      },
      {
        component_id: 'legacy_clarification_answer_application',
        disposition: 'transitional',
        constraint:
          'Replace with authenticated source plus envelope command; preserve tests as guidance.',
      },
      {
        component_id: 'legacy_record_confirmation',
        disposition: 'transitional',
        constraint: 'Replace with exact v2 subject/version/hash confirmation receipts.',
      },
      {
        component_id: 'legacy_challenge_resolution',
        disposition: 'transitional',
        constraint:
          'Reuse deterministic ownership checks only through v2 item-level challenge commands.',
      },
      {
        component_id: 'dr001_dr002_goldens_alignment_evaluator_acceptance',
        disposition: 'transitional',
        constraint: 'Historical regression evidence only; not the primary v2 product gate.',
      },
      {
        component_id: 'pr_specific_frozen_compatibility_predicates',
        disposition: 'transitional',
        constraint:
          'Keep frozen for legacy regression only; do not generalize into v2 product rules.',
      },
      {
        component_id: 'person_a_specific_clis_and_orchestration',
        disposition: 'transitional',
        constraint: 'Developer/migration tooling only until replaced by bilateral orchestration.',
      },
      {
        component_id: 'v2_authenticated_source_capture_and_durable_envelope_repository',
        disposition: 'missing',
        constraint: 'Required before any end-to-end turn can PASS.',
      },
      {
        component_id: 'v2_intake_classification_question_command_response_orchestrator',
        disposition: 'missing',
        constraint: 'Must generate proposals, never authoritative facts or direct mutations.',
      },
      {
        component_id: 'v2_person_b_evidence_confirmation_lock_reopen_handoff_adapters',
        disposition: 'missing',
        constraint:
          'Must preserve embargo, authority, eligibility, and exact committed identities.',
      },
      {
        component_id: 'legacy_one_shot_record_as_canonical_operational_state',
        disposition: 'actively_harmful',
        constraint: 'Would restore unsupported promotions and competing state.',
      },
      {
        component_id: 'chat_repair_evaluator_or_audit_artifact_as_operational_state',
        disposition: 'actively_harmful',
        constraint: 'Must remain immutable context or audit evidence, never competing state.',
      },
      {
        component_id: 'person_a_only_production_flow_that_bypasses_independent_person_b_account',
        disposition: 'actively_harmful',
        constraint: 'Would violate bilateral authority and the disclosure embargo.',
      },
    ],
    recommended_implementation_sequence: [
      'Authenticated actor/consent context, immutable SourceRecord capture, and durable Case Envelope CAS/idempotency repository.',
      'Brief-story intake, deterministic suitability transition, one-question planner, and validated command proposal loop.',
      'Person A catch-all and exact confirmation, then Person B invitation and independent-account embargo flow.',
      'Detailed disclosure, item-level party stances, challenges, reconciliation, and silence handling.',
      'Evidence upload, deterministic inspection boundary, disclosure eligibility, withdrawal, supersession, and authorship disputes.',
      'Final confirmation, bilateral/documented-non-participation lock, post-lock reopen/reconfirm/relock.',
      'Exact adjudication-input handoff without juror-reasoning changes.',
      'Pinned model adapters and repeated Gate Zero quality runs; release only after every frozen gate passes.',
    ],
    dr002_disposition: {
      primary_program: 'retired',
      frozen_baseline_retained: true,
      claim_payment_term_1: 'paused',
      claim_scope_1: 'paused',
      deliverable_1: 'paused',
      resume_only_if: [
        'legacy_evaluator_is_explicit_migration_or_release_gate',
        'same_defect_survives_incremental_v2_case_envelope_flow',
      ],
    },
  };
  policy.policy_fingerprint = computeGateZeroAcceptancePolicyFingerprint(policy);
  return policy;
}

export function validateGateZeroAcceptancePolicy(): string[] {
  const policy = buildGateZeroAcceptancePolicy();
  const issues: string[] = [];
  const hardGateIds = policy.hard_gates.map((gate) => gate.gate_id);
  const zeroToleranceIds = policy.zero_tolerance_gates.map((gate) => gate.violation_id);
  if (
    new Set(hardGateIds).size !== 14 ||
    policy.hard_gates.some(
      (gate) =>
        gate.required_applicable_pass_rate !== 1 ||
        gate.maximum_fail_count !== 0 ||
        gate.maximum_not_executable_count !== 0 ||
        gate.applicable_case_count === 0 ||
        gate.applicable_turn_count === 0,
    )
  ) {
    issues.push('acceptance_hard_gate_invalid');
  }
  if (
    new Set(zeroToleranceIds).size !== 7 ||
    policy.zero_tolerance_gates.some(
      (gate) =>
        gate.maximum_occurrences !== 0 ||
        gate.applicable_case_count === 0 ||
        gate.applicable_turn_count === 0,
    )
  ) {
    issues.push('acceptance_zero_tolerance_gate_invalid');
  }
  if (
    policy.model_quality_gates.length !== 4 ||
    policy.model_quality_gates.some(
      (gate) =>
        gate.applicable_turn_count === 0 ||
        gate.metrics.length === 0 ||
        gate.metrics.some((metric) => metric.threshold < 0 || metric.threshold > 1),
    )
  ) {
    issues.push('acceptance_model_quality_gate_invalid');
  }
  const governedRequirements = [
    ...new Set(
      [
        ...policy.hard_gates.flatMap((gate) => gate.coverage_requirement_ids),
        ...policy.zero_tolerance_gates.flatMap((gate) => gate.coverage_requirement_ids),
        ...policy.model_quality_gates.flatMap((gate) => gate.coverage_requirement_ids),
      ].sort(),
    ),
  ];
  const frozenRequirements = GATE_ZERO_COVERAGE_REQUIREMENTS.map(
    (requirement) => requirement.requirement_id,
  ).sort();
  if (canonicalSerialize(governedRequirements) !== canonicalSerialize(frozenRequirements)) {
    issues.push('acceptance_coverage_requirement_unmanaged');
  }
  if (
    policy.hard_gates.some((gate) => gate.current_baseline_status !== 'NOT_EXECUTABLE') ||
    policy.zero_tolerance_gates.some((gate) => gate.current_baseline_status !== 'NOT_EXECUTABLE') ||
    policy.model_quality_gates.some((gate) => gate.current_baseline_status !== 'NOT_EXECUTABLE')
  ) {
    issues.push('acceptance_current_baseline_status_invalid');
  }
  if (
    !policy.current_decision.architecture_ready_for_runtime_implementation ||
    policy.current_decision.current_product_release_ready ||
    policy.current_decision.current_product_gate_zero_status !== 'NOT_EXECUTABLE' ||
    policy.current_decision.gz6_started
  ) {
    issues.push('acceptance_readiness_decision_invalid');
  }
  if (
    policy.policy_fingerprint !== GATE_ZERO_ACCEPTANCE_POLICY_FINGERPRINT ||
    computeGateZeroAcceptancePolicyFingerprint(policy) !== policy.policy_fingerprint
  ) {
    issues.push('acceptance_policy_fingerprint_invalid');
  }
  return issues;
}
