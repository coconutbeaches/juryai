import { describe, expect, it } from 'vitest';
import {
  GATE_ZERO_CASE_PLANS,
  GATE_ZERO_COVERAGE_MATRIX_FINGERPRINT,
  GATE_ZERO_COVERAGE_MATRIX_VERSION,
  GATE_ZERO_COVERAGE_REQUIREMENTS,
  GATE_ZERO_PLANNED_CORPUS_SIZE,
  hashGateZeroCoverageMatrix,
  validateGateZeroCoverageMatrix,
} from '../gate-zero/coverage-matrix.js';

describe('Gate Zero GZ1 frozen coverage matrix', () => {
  it('freezes a 36-case matrix with an exact revision identity', () => {
    expect(GATE_ZERO_COVERAGE_MATRIX_VERSION).toBe('juryai-gate-zero-coverage-matrix-v1.0.0');
    expect(GATE_ZERO_PLANNED_CORPUS_SIZE).toBe(36);
    expect(GATE_ZERO_CASE_PLANS).toHaveLength(36);
    expect(GATE_ZERO_COVERAGE_REQUIREMENTS).toHaveLength(48);
    expect(hashGateZeroCoverageMatrix()).toBe(GATE_ZERO_COVERAGE_MATRIX_FINGERPRINT);
    expect(GATE_ZERO_COVERAGE_MATRIX_FINGERPRINT).toBe(
      'e92933c187df9abe988cc7b049d8353346ed3cb6211d9d1db0be5add81497387',
    );
    expect(validateGateZeroCoverageMatrix()).toEqual([]);
  });

  it('designates exactly ten varied cases for adversarial authoring before scale-out', () => {
    const initialTen = GATE_ZERO_CASE_PLANS.filter((casePlan) => casePlan.initial_ten);
    expect(initialTen.map((casePlan) => casePlan.case_id)).toEqual([
      'gz_case_001',
      'gz_case_002',
      'gz_case_003',
      'gz_case_004',
      'gz_case_005',
      'gz_case_006',
      'gz_case_007',
      'gz_case_008',
      'gz_case_009',
      'gz_case_010',
    ]);
    expect(new Set(initialTen.flatMap((casePlan) => casePlan.journey_phases)).size).toBeGreaterThan(
      8,
    );
    expect(initialTen.every((casePlan) => casePlan.failure_coverage.length > 0)).toBe(true);
  });

  it('requires explicit success and failure coverage for every authority and journey boundary', () => {
    for (const requirement of GATE_ZERO_COVERAGE_REQUIREMENTS) {
      expect(
        GATE_ZERO_CASE_PLANS.some((casePlan) =>
          casePlan.success_coverage.includes(requirement.requirement_id),
        ),
        `missing success coverage for ${requirement.requirement_id}`,
      ).toBe(true);
      expect(
        GATE_ZERO_CASE_PLANS.some((casePlan) =>
          casePlan.failure_coverage.includes(requirement.requirement_id),
        ),
        `missing failure coverage for ${requirement.requirement_id}`,
      ).toBe(true);
    }
  });

  it('plans complete journeys rather than extraction-only examples', () => {
    const coveredPhases = new Set(
      GATE_ZERO_CASE_PLANS.flatMap((casePlan) => casePlan.journey_phases),
    );
    expect([...coveredPhases].sort()).toEqual(
      [
        'adjudication_projection',
        'authority_setup',
        'disclosure_challenge',
        'evidence',
        'final_confirmation',
        'intake_triage',
        'lock',
        'person_a_confirmation',
        'person_a_formation',
        'person_b_independent_account',
        'post_lock',
      ].sort(),
    );
    expect(GATE_ZERO_CASE_PLANS.some((casePlan) => casePlan.planned_turns >= 14)).toBe(true);
    expect(GATE_ZERO_CASE_PLANS.every((casePlan) => casePlan.planned_turns >= 2)).toBe(true);
    expect(
      GATE_ZERO_CASE_PLANS.every(
        (casePlan) =>
          Number.isSafeInteger(casePlan.planned_turns) &&
          new Set(casePlan.journey_phases).size === casePlan.journey_phases.length &&
          new Set(casePlan.success_coverage).size === casePlan.success_coverage.length &&
          new Set(casePlan.failure_coverage).size === casePlan.failure_coverage.length,
      ),
    ).toBe(true);
  });
});
