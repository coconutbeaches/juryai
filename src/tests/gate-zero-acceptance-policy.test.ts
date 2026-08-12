import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, sha256 } from '../v2/case-envelope.js';
import {
  GATE_ZERO_ACCEPTANCE_POLICY_FINGERPRINT,
  GATE_ZERO_ACCEPTANCE_POLICY_VERSION,
  buildGateZeroAcceptancePolicy,
  validateGateZeroAcceptancePolicy,
} from '../gate-zero/acceptance-policy.js';
import { GATE_ZERO_COVERAGE_REQUIREMENTS } from '../gate-zero/coverage-matrix.js';

describe('Gate Zero GZ5 frozen acceptance and readiness policy', () => {
  it('freezes every hard authority and safety gate at 100 percent', () => {
    const policy = buildGateZeroAcceptancePolicy();
    expect(policy.hard_gates.map((gate) => gate.gate_id)).toEqual([
      'identity_authority',
      'consent_authority',
      'party_ownership',
      'source_grounded_incremental_formation',
      'cas_version_behavior',
      'exact_mutation_no_mutation',
      'deterministic_state_transitions',
      'person_b_disclosure_embargo',
      'silence_never_agreement',
      'evidence_inspection_disclosure_eligibility',
      'confirmation_binding_invalidation',
      'lock_correctness',
      'post_lock_reopening',
      'adjudication_input_integrity',
    ]);
    for (const gate of policy.hard_gates) {
      expect(gate.required_applicable_pass_rate, gate.gate_id).toBe(1);
      expect(gate.maximum_fail_count, gate.gate_id).toBe(0);
      expect(gate.maximum_not_executable_count, gate.gate_id).toBe(0);
      expect(gate.current_baseline_status, gate.gate_id).toBe('NOT_EXECUTABLE');
      expect(gate.applicable_case_count, gate.gate_id).toBeGreaterThan(0);
      expect(gate.applicable_turn_count, gate.gate_id).toBeGreaterThan(0);
    }
  });

  it('governs all 48 frozen coverage requirements', () => {
    const policy = buildGateZeroAcceptancePolicy();
    const governed = [
      ...new Set(
        [
          ...policy.hard_gates.flatMap((gate) => gate.coverage_requirement_ids),
          ...policy.zero_tolerance_gates.flatMap((gate) => gate.coverage_requirement_ids),
          ...policy.model_quality_gates.flatMap((gate) => gate.coverage_requirement_ids),
        ].sort(),
      ),
    ];
    expect(governed).toEqual(
      GATE_ZERO_COVERAGE_REQUIREMENTS.map((requirement) => requirement.requirement_id).sort(),
    );
    expect(governed).toHaveLength(48);
  });

  it('makes all seven prohibited outcomes zero-tolerance', () => {
    const policy = buildGateZeroAcceptancePolicy();
    expect(policy.zero_tolerance_gates.map((gate) => gate.violation_id)).toEqual([
      'unsupported_factual_promotion',
      'model_inference_as_fact_promotion',
      'evidence_inspection_fabrication',
      'privacy_or_disclosure_violation',
      'cross_party_mutation',
      'stale_command_mutation',
      'silence_as_agreement_promotion',
    ]);
    for (const gate of policy.zero_tolerance_gates) {
      expect(gate.maximum_occurrences, gate.violation_id).toBe(0);
      expect(gate.current_baseline_status, gate.violation_id).toBe('NOT_EXECUTABLE');
    }
  });

  it('keeps model-quality thresholds separate and measurable', () => {
    const policy = buildGateZeroAcceptancePolicy();
    expect(policy.model_evaluation_protocol).toEqual({
      minimum_complete_runs: 5,
      threshold_application: 'each_run_and_pooled',
      candidate_identity_required: true,
      model_prompt_config_identity_required: true,
      provider_response_identity_required: true,
      quality_rubric_identity_required: true,
      semantic_disagreement_resolution: 'two_independent_reviewers_plus_tiebreak',
      corpus_oracle_mutation_during_evaluation_prohibited: true,
    });
    expect(policy.model_quality_gates.map((gate) => gate.gate_id)).toEqual([
      'classification_quality',
      'next_question_selection_quality',
      'ambiguity_recognition_quality',
      'neutral_summary_quality',
    ]);
    expect(policy.model_quality_gates.map((gate) => gate.applicable_turn_count)).toEqual([
      3, 22, 46, 71,
    ]);
    for (const gate of policy.model_quality_gates) {
      expect(gate.current_baseline_status, gate.gate_id).toBe('NOT_EXECUTABLE');
      expect(
        gate.metrics.every((metric) => metric.measurement.length > 0),
        gate.gate_id,
      ).toBe(true);
    }
  });

  it('decides architecture readiness without claiming product readiness', () => {
    const policy = buildGateZeroAcceptancePolicy();
    expect(policy.current_decision).toEqual({
      architecture_ready_for_runtime_implementation: true,
      current_product_gate_zero_status: 'NOT_EXECUTABLE',
      current_product_release_ready: false,
      separate_gz6_authorization_required: true,
      gz6_started: false,
    });
  });

  it('classifies existing and missing components without preserving competing state', () => {
    const policy = buildGateZeroAcceptancePolicy();
    const counts = Object.fromEntries(
      ['reusable', 'transitional', 'missing', 'actively_harmful'].map((disposition) => [
        disposition,
        policy.component_dispositions.filter((component) => component.disposition === disposition)
          .length,
      ]),
    );
    expect(counts).toEqual({ reusable: 6, transitional: 11, missing: 3, actively_harmful: 3 });
  });

  it('retires DR002 as the primary program and keeps all three criticals paused', () => {
    const policy = buildGateZeroAcceptancePolicy();
    expect(policy.dr002_disposition).toEqual({
      primary_program: 'retired',
      frozen_baseline_retained: true,
      claim_payment_term_1: 'paused',
      claim_scope_1: 'paused',
      deliverable_1: 'paused',
      resume_only_if: [
        'legacy_evaluator_is_explicit_migration_or_release_gate',
        'same_defect_survives_incremental_v2_case_envelope_flow',
      ],
    });
  });

  it('freezes exact policy bytes and fingerprint', async () => {
    const policy = buildGateZeroAcceptancePolicy();
    const bytes = await readFile(
      resolve(process.cwd(), 'src/fixtures/gate-zero/acceptance-policy.json'),
      'utf8',
    );
    expect(GATE_ZERO_ACCEPTANCE_POLICY_VERSION).toBe('juryai-gate-zero-acceptance-policy-v1.0.0');
    expect(policy.policy_fingerprint).toBe(GATE_ZERO_ACCEPTANCE_POLICY_FINGERPRINT);
    expect(GATE_ZERO_ACCEPTANCE_POLICY_FINGERPRINT).toBe(
      '2d7aae44514dc5dea0a54ca0dee50879c92af68eaec882e5b30e2d6e6680ef2a',
    );
    expect(bytes).toBe(canonicalSerialize(policy));
    expect(sha256(bytes)).toBe('f1ddaf9e8fece4f0c29934699d694ef56628b428f7d086dcc87d72540bbbb139');
    expect(validateGateZeroAcceptancePolicy()).toEqual([]);
  });
});
