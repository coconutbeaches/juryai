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

export interface GateZeroTurnOracle {
  oracle_version: typeof GATE_ZERO_ORACLE_VERSION;
  authenticated_actor: AuthenticatedActor;
  visible_source_ids: string[];
  hidden_source_ids: string[];
  base_envelope_version: number;
  base_envelope_hash: string;
  command: EnvelopeCommand;
  permitted_operation_types: EnvelopeOperation['type'][];
  forbidden_operation_types: EnvelopeOperation['type'][];
  expected: {
    disposition: 'applied' | 'idempotent' | 'rejected';
    exact_no_mutation: boolean;
    envelope_version_delta: 0 | 1;
    record_version_delta: 0 | 1;
    authority_fragments: ObjectAuthority[];
    evidence_actions: string[];
    invalidated_confirmation_parties: Array<'party_a' | 'party_b'>;
    workflow_state: WorkflowState;
    lock_status: CaseEnvelope['control']['lock']['status'];
    failure_reason: CommandFailureReason | null;
    required_source_references: SourceReference[];
  };
}

export function validateGateZeroTurnOracle(oracle: GateZeroTurnOracle): string[] {
  const issues: string[] = [];
  if (oracle.oracle_version !== GATE_ZERO_ORACLE_VERSION) issues.push('oracle_version_invalid');
  if (
    oracle.command.base_envelope_version !== oracle.base_envelope_version ||
    oracle.command.base_envelope_hash !== oracle.base_envelope_hash
  ) {
    issues.push('oracle_base_binding_invalid');
  }
  const overlap = oracle.visible_source_ids.filter((sourceId) =>
    oracle.hidden_source_ids.includes(sourceId),
  );
  if (overlap.length > 0) issues.push('oracle_visibility_overlap');
  if (oracle.expected.exact_no_mutation !== (oracle.expected.envelope_version_delta === 0)) {
    issues.push('oracle_mutation_expectation_invalid');
  }
  if (oracle.expected.disposition === 'rejected' && oracle.expected.failure_reason === null) {
    issues.push('oracle_failure_reason_missing');
  }
  return issues;
}
