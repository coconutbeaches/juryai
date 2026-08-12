import { createHash } from 'node:crypto';
import {
  canonicalSerialize,
  cloneCanonical,
  validateCaseEnvelope,
  type CaseEnvelope,
  type EvidenceObject,
  type SourceRecord,
} from '../v2/case-envelope.js';
import { buildAdjudicationInput } from '../v2/adjudication-input.js';
import { applyEnvelopeCommand, type CommandLedger } from '../v2/envelope-command.js';
import { validateGateZeroTurnOracle } from '../v2/gate-zero-oracle.js';
import { buildPersonBDisclosureView } from '../v2/person-b-disclosure.js';
import {
  GATE_ZERO_CORPUS,
  GATE_ZERO_CORPUS_FINGERPRINT,
  GATE_ZERO_CORPUS_VERSION,
} from './corpus.js';
import type { GateZeroCanonicalCase } from './canonical-case.js';

export const GATE_ZERO_CAPABILITY_BASELINE_VERSION = 'juryai-gate-zero-capability-baseline-v1.0.0';
export const GATE_ZERO_BASELINE_IMPLEMENTATION_COMMIT = 'b360dafa3dabd2551b581d8300b5ef637b0c39f7';
export const GATE_ZERO_CAPABILITY_BASELINE_FINGERPRINT =
  '3407697c9df66bb471152c56ff9758a7f2e75776c58ffb578df0b9570f12d452';

export const GATE_ZERO_CAPABILITY_STATUSES = [
  'PASS',
  'FAIL',
  'NOT_EXECUTABLE',
  'NOT_APPLICABLE',
] as const;
export type GateZeroCapabilityStatus = (typeof GATE_ZERO_CAPABILITY_STATUSES)[number];

export const GATE_ZERO_MISSING_CAPABILITY_IDS = [
  'adjudication_handoff_adapter',
  'authenticated_actor_context_adapter',
  'confirmation_lock_orchestrator',
  'durable_case_envelope_store',
  'evidence_service_integration',
  'journey_command_orchestrator',
  'next_question_planner',
  'person_b_disclosure_delivery',
  'source_record_capture_adapter',
  'user_visible_response_adapter',
] as const;
export type GateZeroMissingCapabilityId = (typeof GATE_ZERO_MISSING_CAPABILITY_IDS)[number];

export interface GateZeroContractEvidence {
  oracle_validation: GateZeroCapabilityStatus;
  command_boundary_replay: GateZeroCapabilityStatus;
  person_b_disclosure_projection: GateZeroCapabilityStatus;
  adjudication_input_projection: GateZeroCapabilityStatus;
  issue_codes: string[];
}

export interface GateZeroTurnCapabilityResult {
  case_id: string;
  turn_id: string;
  status: GateZeroCapabilityStatus;
  reason_code: 'current_v2_end_to_end_runtime_absent' | 'executable_contract_mismatch';
  missing_capability_ids: GateZeroMissingCapabilityId[];
  contract_evidence: GateZeroContractEvidence;
}

export interface GateZeroCaseCapabilityResult {
  case_id: string;
  status: GateZeroCapabilityStatus;
  status_counts: Record<GateZeroCapabilityStatus, number>;
  turns: GateZeroTurnCapabilityResult[];
}

export interface GateZeroComponentCapabilityResult {
  component_id: string;
  status: GateZeroCapabilityStatus;
  boundary: string;
  evidence: string[];
}

export interface GateZeroCapabilityBaseline {
  baseline_version: typeof GATE_ZERO_CAPABILITY_BASELINE_VERSION;
  baseline_fingerprint: string;
  implementation_commit: typeof GATE_ZERO_BASELINE_IMPLEMENTATION_COMMIT;
  corpus_version: typeof GATE_ZERO_CORPUS_VERSION;
  corpus_fingerprint: typeof GATE_ZERO_CORPUS_FINGERPRINT;
  subject: 'current_juryai_v2_end_to_end_product_journey';
  classification_rule: string;
  status_vocabulary: readonly GateZeroCapabilityStatus[];
  turn_count: number;
  status_counts: Record<GateZeroCapabilityStatus, number>;
  missing_capability_counts: Record<GateZeroMissingCapabilityId, number>;
  executable_contract_counts: {
    oracle_validation: Record<GateZeroCapabilityStatus, number>;
    command_boundary_replay: Record<GateZeroCapabilityStatus, number>;
    person_b_disclosure_projection: Record<GateZeroCapabilityStatus, number>;
    adjudication_input_projection: Record<GateZeroCapabilityStatus, number>;
  };
  component_results: GateZeroComponentCapabilityResult[];
  cases: GateZeroCaseCapabilityResult[];
}

function emptyStatusCounts(): Record<GateZeroCapabilityStatus, number> {
  return { PASS: 0, FAIL: 0, NOT_EXECUTABLE: 0, NOT_APPLICABLE: 0 };
}

function authorityAt(envelope: CaseEnvelope, namespace: string, objectId: string): unknown {
  if (namespace === 'classification') return envelope.classification.authority;
  const collection = envelope[namespace as keyof CaseEnvelope];
  if (!collection || typeof collection !== 'object' || Array.isArray(collection)) return undefined;
  const object = (collection as Record<string, { authority?: unknown }>)[objectId];
  return object?.authority;
}

function evidenceActionMatches(
  before: CaseEnvelope,
  after: CaseEnvelope,
  evidenceId: string,
  action: string,
): boolean {
  const prior = before.evidence[evidenceId];
  const current = after.evidence[evidenceId];
  if (!current) return false;
  if (action === 'described')
    return prior === undefined && current.availability === 'described_only';
  if (action === 'uploaded')
    return prior?.content_hash !== current.content_hash && current.availability === 'uploaded';
  if (action === 'inspected')
    return (
      prior?.inspection.result_hash !== current.inspection.result_hash &&
      current.inspection.status !== 'uninspected'
    );
  if (action === 'visibility_changed')
    return (
      prior?.visibility !== current.visibility ||
      canonicalSerialize(prior?.disclosure_event_ids ?? []) !==
        canonicalSerialize(current.disclosure_event_ids)
    );
  if (action === 'withdrawn') return current.availability === 'withdrawn';
  if (action === 'superseded') return current.availability === 'superseded';
  return false;
}

function personBProjectionMatches(envelope: CaseEnvelope): boolean {
  try {
    const view = buildPersonBDisclosureView(envelope);
    const disclosed = envelope.formation.disclosure.detailed_a_framing === 'disclosed';
    if ((view.detailed_record !== null) !== disclosed) return false;
    if (!view.detailed_record) return true;
    return Object.values(view.detailed_record.evidence).every(
      (evidence: EvidenceObject) => evidence.visibility === 'disclosed_to_both',
    );
  } catch {
    return false;
  }
}

function isPersonBProjectionApplicable(fixture: GateZeroCanonicalCase, turnIndex: number): boolean {
  const turn = fixture.turns[turnIndex]!;
  return (
    turn.authenticated_actor.party_id === 'party_b' ||
    turn.hidden_source_ids.length > 0 ||
    turn.embargoed_envelope_paths.length > 0 ||
    turn.command.operations.some((operation) =>
      ['record_independent_account', 'record_detailed_disclosure'].includes(operation.type),
    )
  );
}

function missingCapabilities(
  fixture: GateZeroCanonicalCase,
  turnIndex: number,
): GateZeroMissingCapabilityId[] {
  const turn = fixture.turns[turnIndex]!;
  const missing = new Set<GateZeroMissingCapabilityId>([
    'authenticated_actor_context_adapter',
    'durable_case_envelope_store',
    'journey_command_orchestrator',
    'source_record_capture_adapter',
    'user_visible_response_adapter',
  ]);
  if (turn.expected.next_question_target !== null) missing.add('next_question_planner');
  if (isPersonBProjectionApplicable(fixture, turnIndex)) {
    missing.add('person_b_disclosure_delivery');
  }
  if (
    turn.expected.evidence_actions.length > 0 ||
    turn.command.operations.some((operation) => operation.type.includes('evidence'))
  ) {
    missing.add('evidence_service_integration');
  }
  if (
    turn.expected.invalidated_confirmation_parties.length > 0 ||
    turn.command.operations.some((operation) =>
      ['record_confirmation', 'lock', 'reopen_material_change'].includes(operation.type),
    )
  ) {
    missing.add('confirmation_lock_orchestrator');
  }
  if (turnIndex === fixture.turns.length - 1 && fixture.expected_adjudication_input !== null) {
    missing.add('adjudication_handoff_adapter');
  }
  return [...missing].sort();
}

export function runGateZeroCaseCapability(
  fixture: GateZeroCanonicalCase,
): GateZeroCaseCapabilityResult {
  let envelope = cloneCanonical(fixture.initial_envelope);
  let ledger: CommandLedger = {};
  const turns: GateZeroTurnCapabilityResult[] = [];
  for (const [turnIndex, turn] of fixture.turns.entries()) {
    const issues: string[] = [];
    const oracleIssues = validateGateZeroTurnOracle(turn);
    const oracleStatus: GateZeroCapabilityStatus = oracleIssues.length === 0 ? 'PASS' : 'FAIL';
    issues.push(...oracleIssues.map((issue) => `oracle:${issue}`));
    const before = cloneCanonical(envelope);
    const sourceRegistry: Record<string, SourceRecord> = Object.fromEntries(
      turn.source_records.map((source) => [source.source_id, source]),
    );
    const result = applyEnvelopeCommand({
      envelope,
      command: turn.command,
      authenticated_actor: turn.authenticated_actor,
      source_registry: sourceRegistry,
      ledger,
    });
    const expected = turn.expected;
    const invalidated = (['party_a', 'party_b'] as const).filter(
      (partyId) =>
        before.formation.confirmations[partyId] !== null &&
        result.envelope.formation.confirmations[partyId] === null,
    );
    const commandChecks: Array<[string, boolean]> = [
      ['disposition', result.status === expected.disposition],
      ['failure_reason', result.reason_code === expected.failure_reason],
      [
        'envelope_version',
        result.envelope.control.envelope_version === expected.resulting_envelope_version,
      ],
      ['envelope_hash', result.envelope.control.envelope_hash === expected.resulting_envelope_hash],
      [
        'record_version',
        result.envelope.control.record_version === expected.resulting_record_version,
      ],
      ['record_hash', result.envelope.control.record_hash === expected.resulting_record_hash],
      ['workflow_state', result.envelope.control.workflow_state === expected.workflow_state],
      ['lock_status', result.envelope.control.lock.status === expected.lock_status],
      ['lock_mode', result.envelope.control.lock.mode === expected.lock_mode],
      ['output_scope', result.envelope.control.lock.output_scope === expected.output_scope],
      [
        'exact_no_mutation',
        !expected.exact_no_mutation ||
          canonicalSerialize(before) === canonicalSerialize(result.envelope),
      ],
      [
        'confirmation_invalidation',
        canonicalSerialize(invalidated) ===
          canonicalSerialize(expected.invalidated_confirmation_parties),
      ],
      ['envelope_validation', validateCaseEnvelope(result.envelope).length === 0],
      [
        'authority_fragments',
        expected.authority_fragments.every(
          (fragment) =>
            canonicalSerialize(
              authorityAt(result.envelope, fragment.namespace, fragment.object_id),
            ) === canonicalSerialize(fragment.authority),
        ),
      ],
      [
        'evidence_actions',
        expected.evidence_actions.every((action) =>
          evidenceActionMatches(before, result.envelope, action.evidence_id, action.action),
        ),
      ],
    ];
    for (const [check, passed] of commandChecks) {
      if (!passed) issues.push(`command_boundary:${check}`);
    }
    const commandStatus: GateZeroCapabilityStatus = commandChecks.every(([, passed]) => passed)
      ? 'PASS'
      : 'FAIL';
    const disclosureApplicable = isPersonBProjectionApplicable(fixture, turnIndex);
    const disclosureStatus: GateZeroCapabilityStatus = disclosureApplicable
      ? personBProjectionMatches(result.envelope)
        ? 'PASS'
        : 'FAIL'
      : 'NOT_APPLICABLE';
    if (disclosureStatus === 'FAIL') issues.push('person_b_disclosure:projection_mismatch');
    const projectionApplicable =
      turnIndex === fixture.turns.length - 1 && fixture.expected_adjudication_input !== null;
    let adjudicationStatus: GateZeroCapabilityStatus = 'NOT_APPLICABLE';
    if (projectionApplicable) {
      try {
        adjudicationStatus =
          canonicalSerialize(buildAdjudicationInput(result.envelope)) ===
          canonicalSerialize(fixture.expected_adjudication_input)
            ? 'PASS'
            : 'FAIL';
      } catch {
        adjudicationStatus = 'FAIL';
      }
      if (adjudicationStatus === 'FAIL') issues.push('adjudication_input:projection_mismatch');
    }
    const executableFailure = [
      oracleStatus,
      commandStatus,
      disclosureStatus,
      adjudicationStatus,
    ].includes('FAIL');
    const missing = missingCapabilities(fixture, turnIndex);
    turns.push({
      case_id: fixture.case_id,
      turn_id: turn.turn_id,
      status: executableFailure ? 'FAIL' : 'NOT_EXECUTABLE',
      reason_code: executableFailure
        ? 'executable_contract_mismatch'
        : 'current_v2_end_to_end_runtime_absent',
      missing_capability_ids: missing,
      contract_evidence: {
        oracle_validation: oracleStatus,
        command_boundary_replay: commandStatus,
        person_b_disclosure_projection: disclosureStatus,
        adjudication_input_projection: adjudicationStatus,
        issue_codes: issues.sort(),
      },
    });
    envelope = result.envelope;
    ledger = result.ledger;
  }
  const statusCounts = emptyStatusCounts();
  for (const turn of turns) statusCounts[turn.status] += 1;
  const status: GateZeroCapabilityStatus =
    statusCounts.FAIL > 0
      ? 'FAIL'
      : statusCounts.NOT_EXECUTABLE > 0
        ? 'NOT_EXECUTABLE'
        : statusCounts.PASS > 0
          ? 'PASS'
          : 'NOT_APPLICABLE';
  return { case_id: fixture.case_id, status, status_counts: statusCounts, turns };
}

function increment(
  counts: Record<GateZeroCapabilityStatus, number>,
  status: GateZeroCapabilityStatus,
): void {
  counts[status] += 1;
}

function baselineProjection(baseline: GateZeroCapabilityBaseline): GateZeroCapabilityBaseline {
  return { ...baseline, baseline_fingerprint: '' };
}

export function computeGateZeroCapabilityBaselineFingerprint(
  baseline: GateZeroCapabilityBaseline,
): string {
  return createHash('sha256')
    .update(canonicalSerialize(baselineProjection(baseline)))
    .digest('hex');
}

export function buildGateZeroCapabilityBaseline(): GateZeroCapabilityBaseline {
  const cases = GATE_ZERO_CORPUS.map(runGateZeroCaseCapability);
  const turns = cases.flatMap((fixture) => fixture.turns);
  const statusCounts = emptyStatusCounts();
  const missingCounts = Object.fromEntries(
    GATE_ZERO_MISSING_CAPABILITY_IDS.map((capability) => [capability, 0]),
  ) as Record<GateZeroMissingCapabilityId, number>;
  const evidenceCounts = {
    oracle_validation: emptyStatusCounts(),
    command_boundary_replay: emptyStatusCounts(),
    person_b_disclosure_projection: emptyStatusCounts(),
    adjudication_input_projection: emptyStatusCounts(),
  };
  for (const turn of turns) {
    increment(statusCounts, turn.status);
    for (const capability of turn.missing_capability_ids) missingCounts[capability] += 1;
    increment(evidenceCounts.oracle_validation, turn.contract_evidence.oracle_validation);
    increment(
      evidenceCounts.command_boundary_replay,
      turn.contract_evidence.command_boundary_replay,
    );
    increment(
      evidenceCounts.person_b_disclosure_projection,
      turn.contract_evidence.person_b_disclosure_projection,
    );
    increment(
      evidenceCounts.adjudication_input_projection,
      turn.contract_evidence.adjudication_input_projection,
    );
  }
  const baseline: GateZeroCapabilityBaseline = {
    baseline_version: GATE_ZERO_CAPABILITY_BASELINE_VERSION,
    baseline_fingerprint: '',
    implementation_commit: GATE_ZERO_BASELINE_IMPLEMENTATION_COMMIT,
    corpus_version: GATE_ZERO_CORPUS_VERSION,
    corpus_fingerprint: GATE_ZERO_CORPUS_FINGERPRINT,
    subject: 'current_juryai_v2_end_to_end_product_journey',
    classification_rule:
      'FAIL if an executable current contract boundary disagrees with the oracle; otherwise NOT_EXECUTABLE while any required product adapter is absent; PASS only when the complete turn executes and matches; NOT_APPLICABLE only when a classified capability does not apply.',
    status_vocabulary: GATE_ZERO_CAPABILITY_STATUSES,
    turn_count: turns.length,
    status_counts: statusCounts,
    missing_capability_counts: missingCounts,
    executable_contract_counts: evidenceCounts,
    component_results: [
      {
        component_id: 'v2_case_envelope_contract',
        status: 'PASS',
        boundary: 'Closed envelope shape, authority, provenance, hashes, and invariants.',
        evidence: ['src/v2/case-envelope.ts', '390 resulting envelopes validate exactly'],
      },
      {
        component_id: 'v2_authenticated_command_boundary',
        status: 'PASS',
        boundary:
          'Pure command authorization, CAS, idempotency, mutation, transition, and lock rules.',
        evidence: ['src/v2/envelope-command.ts', '390 frozen commands replay exactly'],
      },
      {
        component_id: 'v2_person_b_disclosure_projection',
        status: 'PASS',
        boundary: 'Pure embargo/disclosure view projection from an already committed envelope.',
        evidence: ['src/v2/person-b-disclosure.ts'],
      },
      {
        component_id: 'v2_adjudication_input_projection',
        status: 'PASS',
        boundary: 'Pure projection from an already valid and locked envelope.',
        evidence: ['src/v2/adjudication-input.ts'],
      },
      {
        component_id: 'v2_end_to_end_journey_runtime',
        status: 'NOT_EXECUTABLE',
        boundary:
          'Raw party turn through authentication, source capture, command proposal, durable CAS commit, and response.',
        evidence: ['No v2 journey adapter or durable Case Envelope repository exists.'],
      },
      {
        component_id: 'legacy_v0_1_2_case_record_schema',
        status: 'NOT_EXECUTABLE',
        boundary: 'Cannot consume or emit the v2 Case Envelope command/oracle contract.',
        evidence: ['src/schemas/juryai-case-record-v0.1.2.schema.json'],
      },
      {
        component_id: 'legacy_person_a_extraction_and_runtime_pipeline',
        status: 'NOT_EXECUTABLE',
        boundary:
          'Person A one-shot CaseRecord pipeline is not an adapter for the bilateral incremental v2 journey.',
        evidence: ['src/extraction', 'src/runtime'],
      },
      {
        component_id: 'legacy_dr001_dr002_evaluator_acceptance',
        status: 'NOT_APPLICABLE',
        boundary:
          'Frozen legacy extraction evaluation; no evidence makes it a v2 migration or release gate.',
        evidence: ['src/evaluation', 'src/fixtures/dry_run_001.golden.json'],
      },
    ],
    cases,
  };
  baseline.baseline_fingerprint = computeGateZeroCapabilityBaselineFingerprint(baseline);
  return baseline;
}

export function validateGateZeroCapabilityBaseline(): string[] {
  const baseline = buildGateZeroCapabilityBaseline();
  const issues: string[] = [];
  if (baseline.turn_count !== 390) issues.push('baseline_turn_count_invalid');
  if (
    baseline.status_counts.PASS !== 0 ||
    baseline.status_counts.FAIL !== 0 ||
    baseline.status_counts.NOT_EXECUTABLE !== 390 ||
    baseline.status_counts.NOT_APPLICABLE !== 0
  ) {
    issues.push('baseline_status_counts_invalid');
  }
  if (
    baseline.executable_contract_counts.oracle_validation.PASS !== 390 ||
    baseline.executable_contract_counts.command_boundary_replay.PASS !== 390
  ) {
    issues.push('baseline_contract_replay_invalid');
  }
  if (
    baseline.cases.some((fixture) =>
      fixture.turns.some((turn) => turn.contract_evidence.issue_codes.length > 0),
    )
  ) {
    issues.push('baseline_executable_contract_issue');
  }
  if (
    baseline.baseline_fingerprint !== GATE_ZERO_CAPABILITY_BASELINE_FINGERPRINT ||
    computeGateZeroCapabilityBaselineFingerprint(baseline) !== baseline.baseline_fingerprint
  ) {
    issues.push('baseline_fingerprint_invalid');
  }
  return issues;
}
