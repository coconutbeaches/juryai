import type {
  AuthenticatedActor,
  CaseEnvelope,
  ObjectAuthority,
  SourceReference,
  WorkflowState,
} from './case-envelope.js';
import type {
  CommandFailureReason,
  EnvelopeCommand,
  EnvelopeOperation,
} from './envelope-command.js';

export const GATE_ZERO_ORACLE_VERSION = 'juryai-gate-zero-turn-oracle-v2.0.0';

export interface ExpectedEvidenceAction {
  evidence_id: string;
  action:
    'described' | 'uploaded' | 'inspected' | 'visibility_changed' | 'withdrawn' | 'superseded';
}

export interface GateZeroTurnOracle {
  oracle_version: typeof GATE_ZERO_ORACLE_VERSION;
  authenticated_actor: AuthenticatedActor;
  visible_source_ids: string[];
  hidden_source_ids: string[];
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
    authority_fragments: ObjectAuthority[];
    evidence_actions: ExpectedEvidenceAction[];
    invalidated_confirmation_parties: Array<'party_a' | 'party_b'>;
    workflow_state: WorkflowState;
    lock_status: CaseEnvelope['control']['lock']['status'];
    lock_mode: CaseEnvelope['control']['lock']['mode'];
    output_scope: CaseEnvelope['control']['lock']['output_scope'];
    failure_reason: CommandFailureReason | null;
    required_source_references: SourceReference[];
  };
}

function validateGateZeroTurnOracleUnchecked(oracle: GateZeroTurnOracle): string[] {
  const issues: string[] = [];
  if (oracle.oracle_version !== GATE_ZERO_ORACLE_VERSION) issues.push('oracle_version_invalid');
  if (
    oracle.expected.disposition === 'applied' &&
    (oracle.command.base_envelope_version !== oracle.base_envelope_version ||
      oracle.command.base_envelope_hash !== oracle.base_envelope_hash)
  ) {
    issues.push('oracle_base_binding_invalid');
  }
  const overlap = oracle.visible_source_ids.filter((sourceId) =>
    oracle.hidden_source_ids.includes(sourceId),
  );
  if (overlap.length > 0) issues.push('oracle_visibility_overlap');
  const operationOverlap = oracle.permitted_operation_types.filter((operation) =>
    oracle.forbidden_operation_types.includes(operation),
  );
  if (operationOverlap.length > 0) issues.push('oracle_operation_permission_overlap');
  if (
    oracle.expected.exact_no_mutation !== (oracle.expected.envelope_version_delta === 0) ||
    oracle.expected.exact_no_mutation !== (oracle.expected.disposition !== 'applied')
  ) {
    issues.push('oracle_mutation_expectation_invalid');
  }
  if (oracle.expected.disposition === 'rejected' && oracle.expected.failure_reason === null) {
    issues.push('oracle_failure_reason_missing');
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
    !/^[a-f0-9]{64}$/u.test(oracle.base_envelope_hash) ||
    !/^[a-f0-9]{64}$/u.test(oracle.base_record_hash) ||
    !/^[a-f0-9]{64}$/u.test(oracle.expected.resulting_envelope_hash) ||
    !/^[a-f0-9]{64}$/u.test(oracle.expected.resulting_record_hash)
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
    (oracle.expected.lock_status === 'unlocked' &&
      (oracle.expected.lock_mode !== null || oracle.expected.output_scope !== null)) ||
    (oracle.expected.lock_status === 'locked' &&
      (oracle.expected.lock_mode === null || oracle.expected.output_scope === null))
  ) {
    issues.push('oracle_lock_effect_invalid');
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
