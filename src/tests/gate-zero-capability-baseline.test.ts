import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, cloneCanonical, sha256 } from '../v2/case-envelope.js';
import {
  GATE_ZERO_CAPABILITY_BASELINE_FINGERPRINT,
  GATE_ZERO_CAPABILITY_BASELINE_VERSION,
  GATE_ZERO_CAPABILITY_STATUSES,
  buildGateZeroCapabilityBaseline,
  runGateZeroCaseCapability,
  validateGateZeroCapabilityBaseline,
} from '../gate-zero/capability-baseline.js';
import { GATE_ZERO_CORPUS } from '../gate-zero/corpus.js';

describe('Gate Zero GZ4 honest current-capability baseline', () => {
  it('classifies every frozen turn with the closed four-status vocabulary', () => {
    const baseline = buildGateZeroCapabilityBaseline();
    expect(GATE_ZERO_CAPABILITY_BASELINE_VERSION).toBe(
      'juryai-gate-zero-capability-baseline-v1.0.0',
    );
    expect(GATE_ZERO_CAPABILITY_STATUSES).toEqual([
      'PASS',
      'FAIL',
      'NOT_EXECUTABLE',
      'NOT_APPLICABLE',
    ]);
    expect(baseline.turn_count).toBe(390);
    expect(baseline.status_counts).toEqual({
      PASS: 0,
      FAIL: 0,
      NOT_EXECUTABLE: 390,
      NOT_APPLICABLE: 0,
    });
    expect(validateGateZeroCapabilityBaseline()).toEqual([]);
  });

  it('does not convert authored commands into a false end-to-end PASS', () => {
    const baseline = buildGateZeroCapabilityBaseline();
    for (const fixture of baseline.cases) {
      expect(fixture.status, fixture.case_id).toBe('NOT_EXECUTABLE');
      for (const turn of fixture.turns) {
        expect(turn.status, turn.turn_id).toBe('NOT_EXECUTABLE');
        expect(turn.reason_code, turn.turn_id).toBe('current_v2_end_to_end_runtime_absent');
        expect(turn.missing_capability_ids.length, turn.turn_id).toBeGreaterThan(0);
        expect(turn.contract_evidence.oracle_validation, turn.turn_id).toBe('PASS');
        expect(turn.contract_evidence.command_boundary_replay, turn.turn_id).toBe('PASS');
        expect(turn.contract_evidence.issue_codes, turn.turn_id).toEqual([]);
      }
    }
  });

  it('retains executable GZ0 evidence separately from product capability', () => {
    const baseline = buildGateZeroCapabilityBaseline();
    expect(baseline.executable_contract_counts).toEqual({
      oracle_validation: { PASS: 390, FAIL: 0, NOT_EXECUTABLE: 0, NOT_APPLICABLE: 0 },
      command_boundary_replay: { PASS: 390, FAIL: 0, NOT_EXECUTABLE: 0, NOT_APPLICABLE: 0 },
      person_b_disclosure_projection: {
        PASS: 75,
        FAIL: 0,
        NOT_EXECUTABLE: 0,
        NOT_APPLICABLE: 315,
      },
      adjudication_input_projection: {
        PASS: 7,
        FAIL: 0,
        NOT_EXECUTABLE: 0,
        NOT_APPLICABLE: 383,
      },
    });
  });

  it('reports FAIL rather than hiding an executable oracle mismatch', () => {
    const fixture = cloneCanonical(GATE_ZERO_CORPUS[0]!);
    fixture.turns[0]!.expected.resulting_envelope_hash = '0'.repeat(64);
    const result = runGateZeroCaseCapability(fixture);
    expect(result.status).toBe('FAIL');
    expect(result.turns[0]).toMatchObject({
      status: 'FAIL',
      reason_code: 'executable_contract_mismatch',
    });
    expect(result.turns[0]!.contract_evidence.issue_codes).toContain(
      'command_boundary:envelope_hash',
    );
  });

  it('preserves exact case and turn identity in corpus order', () => {
    const baseline = buildGateZeroCapabilityBaseline();
    expect(baseline.cases.map((fixture) => fixture.case_id)).toEqual(
      GATE_ZERO_CORPUS.map((fixture) => fixture.case_id),
    );
    for (const [index, fixture] of baseline.cases.entries()) {
      expect(fixture.turns.map((turn) => turn.turn_id)).toEqual(
        GATE_ZERO_CORPUS[index]!.turns.map((turn) => turn.turn_id),
      );
    }
  });

  it('marks legacy evaluator acceptance as inapplicable, not as a v2 failure', () => {
    const baseline = buildGateZeroCapabilityBaseline();
    const evaluator = baseline.component_results.find(
      (component) => component.component_id === 'legacy_dr001_dr002_evaluator_acceptance',
    );
    expect(evaluator?.status).toBe('NOT_APPLICABLE');
    expect(
      baseline.component_results.find(
        (component) => component.component_id === 'v2_end_to_end_journey_runtime',
      )?.status,
    ).toBe('NOT_EXECUTABLE');
  });

  it('freezes the exact baseline bytes and fingerprint', async () => {
    const baseline = buildGateZeroCapabilityBaseline();
    const bytes = await readFile(
      resolve(process.cwd(), 'src/fixtures/gate-zero/current-capability-baseline.json'),
      'utf8',
    );
    expect(baseline.baseline_fingerprint).toBe(GATE_ZERO_CAPABILITY_BASELINE_FINGERPRINT);
    expect(GATE_ZERO_CAPABILITY_BASELINE_FINGERPRINT).toBe(
      '3407697c9df66bb471152c56ff9758a7f2e75776c58ffb578df0b9570f12d452',
    );
    expect(bytes).toBe(canonicalSerialize(baseline));
    expect(sha256(bytes)).toBe('fcaa1a5eb69fd1e6e016dd220f9d810867e7e83aa36f73f3a19e5c60d0075ec5');
  });
});
