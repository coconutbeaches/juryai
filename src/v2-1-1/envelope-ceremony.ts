import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V211,
  ENVELOPE_COMMAND_VERSION_V211,
  EXTERNAL_RELAY_SUBMISSION_VERSION_V211,
  FORMATION_PROTOCOL_VERSION_V211,
  FORMATION_READINESS_VERSION_V211,
  ID_PATTERN_V211,
  PARTY_CONFIRMATION_VERSION_V211,
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  PARTY_FORMATION_READBACK_VERSION_V211,
  PARTY_IDS_V211,
  cloneCaseEnvelopeV211,
  hashAdoptionStatementV211,
  hashCaseEnvelopeV211,
  isAuthenticatedPartyAuthorityV211,
  isPartyScopedIdV211,
  isTrustedSystemAuthorityV211,
  type AuthenticatedPartyAuthorityV211,
  type CaseEnvelopeV211,
  type ExecutionAuthorityV211,
  type FormationRequirementV211,
  type PartyIdV211,
} from './case-envelope.js';
import { assertValidCaseEnvelopeV211, validateCaseEnvelopeV211 } from './contract-validator.js';
import {
  authoritativeFormationExplanatoryStateV211,
  deriveFormationReadinessV211,
} from './formation-readiness.js';
import { derivePartyIndependentFormationCompleteV211 } from './formation-requirements.js';
import {
  currentPartyConfirmationV211,
  hashPartyFormationProjectionV211,
  renderPartyFormationReadbackV211,
} from './party-projection.js';

export interface BindPartyOperationV211 {
  type: 'bind_party';
  party_slot: PartyIdV211;
  authenticated_subject_id: string;
  binding_event_id: string;
}

export interface OpenControlledDisclosureOperationV211 {
  type: 'open_controlled_disclosure';
}

export interface EnterFinalConfirmationOperationV211 {
  type: 'enter_final_confirmation';
}

export interface RecordPartyConfirmationOperationV211 {
  type: 'record_party_confirmation';
  confirmation_id: string;
  event_id: string;
  adoption_statement: string;
  confirmed_at: string;
}

export interface ReopenOwnFormationOperationV211 {
  type: 'reopen_own_formation';
  event_id: string;
  reason: string;
  occurred_at: string;
}

export interface RedactSourceTurnOperationV211 {
  type: 'redact_source_turn';
  turn_id: string;
  redacted_at: string;
}

export interface SetEvidenceEligibilityOperationV211 {
  type: 'set_evidence_eligibility';
  evidence_id: string;
  eligibility: 'eligible' | 'ineligible' | 'not_required';
}

export interface MarkReadyForLockOperationV211 {
  type: 'mark_ready_for_lock';
}

export type EnvelopeCeremonyOperationV211 =
  | BindPartyOperationV211
  | OpenControlledDisclosureOperationV211
  | EnterFinalConfirmationOperationV211
  | RecordPartyConfirmationOperationV211
  | ReopenOwnFormationOperationV211
  | RedactSourceTurnOperationV211
  | SetEvidenceEligibilityOperationV211
  | MarkReadyForLockOperationV211;

export interface EnvelopeCeremonyCommandV211 {
  command_version: typeof ENVELOPE_COMMAND_VERSION_V211;
  command_id: string;
  case_id: string;
  base_envelope_version: number;
  base_envelope_hash: string;
  operation: EnvelopeCeremonyOperationV211;
}

export type CeremonyCommandFailureReasonV211 =
  | 'invalid_command'
  | 'invalid_envelope'
  | 'case_mismatch'
  | 'stale_base_version'
  | 'stale_base_hash'
  | 'unauthorized_actor'
  | 'invalid_transition'
  | 'resulting_envelope_invalid';

export type ApplyEnvelopeCeremonyCommandResultV211 =
  | {
      status: 'applied';
      reason_code: null;
      message: string;
      envelope: CaseEnvelopeV211;
      prior_envelope_version: number;
      resulting_envelope_version: number;
      changed_visible_parties: PartyIdV211[];
    }
  | {
      status: 'rejected';
      reason_code: CeremonyCommandFailureReasonV211;
      message: string;
      envelope: CaseEnvelopeV211;
      prior_envelope_version: number;
      resulting_envelope_version: number;
      changed_visible_parties: [];
    };

function validIso(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function ceremonyOperationShape(value: unknown): value is EnvelopeCeremonyOperationV211 {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const operation = value as Record<string, unknown>;
  switch (operation.type) {
    case 'bind_party':
      return (
        hasExactKeys(value, [
          'authenticated_subject_id',
          'binding_event_id',
          'party_slot',
          'type',
        ]) &&
        ['party_a', 'party_b'].includes(String(operation.party_slot)) &&
        typeof operation.authenticated_subject_id === 'string' &&
        typeof operation.binding_event_id === 'string'
      );
    case 'open_controlled_disclosure':
    case 'enter_final_confirmation':
    case 'mark_ready_for_lock':
      return hasExactKeys(value, ['type']);
    case 'record_party_confirmation':
      return (
        hasExactKeys(value, [
          'adoption_statement',
          'confirmation_id',
          'confirmed_at',
          'event_id',
          'type',
        ]) &&
        typeof operation.adoption_statement === 'string' &&
        typeof operation.confirmation_id === 'string' &&
        typeof operation.confirmed_at === 'string' &&
        typeof operation.event_id === 'string'
      );
    case 'reopen_own_formation':
      return (
        hasExactKeys(value, ['event_id', 'occurred_at', 'reason', 'type']) &&
        typeof operation.event_id === 'string' &&
        typeof operation.occurred_at === 'string' &&
        typeof operation.reason === 'string'
      );
    case 'redact_source_turn':
      return (
        hasExactKeys(value, ['redacted_at', 'turn_id', 'type']) &&
        typeof operation.redacted_at === 'string' &&
        typeof operation.turn_id === 'string'
      );
    case 'set_evidence_eligibility':
      return (
        hasExactKeys(value, ['eligibility', 'evidence_id', 'type']) &&
        typeof operation.evidence_id === 'string' &&
        ['eligible', 'ineligible', 'not_required'].includes(String(operation.eligibility))
      );
    default:
      return false;
  }
}

function rejected(
  envelope: CaseEnvelopeV211,
  reason: CeremonyCommandFailureReasonV211,
  message: string,
): ApplyEnvelopeCeremonyCommandResultV211 {
  return {
    status: 'rejected',
    reason_code: reason,
    message,
    envelope: cloneCaseEnvelopeV211(envelope),
    prior_envelope_version: envelope.control.envelope_version,
    resulting_envelope_version: envelope.control.envelope_version,
    changed_visible_parties: [],
  };
}

export function refreshPartyViewCursorsV211(
  before: CaseEnvelopeV211,
  candidate: CaseEnvelopeV211,
): PartyIdV211[] {
  const changed: PartyIdV211[] = [];
  for (const partyId of PARTY_IDS_V211) {
    const nextHash = hashPartyFormationProjectionV211(candidate, partyId);
    const previous = before.control.party_views[partyId];
    candidate.control.party_views[partyId] = {
      party_projection_hash: nextHash,
      party_visible_version:
        previous.party_projection_hash === nextHash
          ? previous.party_visible_version
          : previous.party_visible_version + 1,
    };
    if (previous.party_projection_hash !== nextHash) changed.push(partyId);
  }
  return changed;
}

function partyAuthorityMatches(
  envelope: CaseEnvelopeV211,
  authority: ExecutionAuthorityV211,
  requiredInteraction: 'first_party_human',
): authority is AuthenticatedPartyAuthorityV211 {
  if (
    !isAuthenticatedPartyAuthorityV211(authority) ||
    authority.interaction_authority !== requiredInteraction
  ) {
    return false;
  }
  const binding = envelope.parties[authority.party_id];
  return (
    binding.identity_assurance === 'authenticated' &&
    binding.authenticated_subject_id === authority.authenticated_subject_id
  );
}

function operationAuthorizationFailure(
  envelope: CaseEnvelopeV211,
  operation: EnvelopeCeremonyOperationV211,
  authority: ExecutionAuthorityV211,
): string | null {
  switch (operation.type) {
    case 'bind_party': {
      if (!isTrustedSystemAuthorityV211(authority)) return 'Trusted system authority is required.';
      const target = envelope.parties[operation.party_slot];
      if (
        target.identity_assurance !== 'unbound' ||
        target.authenticated_subject_id !== null ||
        target.binding_event_id !== null
      ) {
        return 'Party slot is not genuinely unbound.';
      }
      const other = envelope.parties[operation.party_slot === 'party_a' ? 'party_b' : 'party_a'];
      if (other.authenticated_subject_id === operation.authenticated_subject_id) {
        return 'Authenticated subjects must be distinct.';
      }
      if (
        !ID_PATTERN_V211.test(operation.authenticated_subject_id) ||
        !operation.binding_event_id.startsWith(`binding_${operation.party_slot}_`) ||
        !ID_PATTERN_V211.test(operation.binding_event_id)
      ) {
        return 'Binding identifiers are invalid.';
      }
      return null;
    }
    case 'open_controlled_disclosure':
      if (!isTrustedSystemAuthorityV211(authority)) return 'Trusted system authority is required.';
      if (
        envelope.control.workflow_state !== 'independent_formation' ||
        envelope.control.disclosure_state !== 'embargoed' ||
        PARTY_IDS_V211.some(
          (partyId) =>
            envelope.parties[partyId].identity_assurance !== 'authenticated' ||
            !derivePartyIndependentFormationCompleteV211(envelope, partyId),
        )
      ) {
        return 'Controlled disclosure prerequisites are not satisfied.';
      }
      return null;
    case 'enter_final_confirmation':
      if (!isTrustedSystemAuthorityV211(authority)) return 'Trusted system authority is required.';
      if (
        envelope.control.workflow_state !== 'challenge_response' ||
        envelope.control.disclosure_state !== 'disclosed' ||
        Object.values(envelope.challenges).some((challenge) => challenge.status === 'open') ||
        PARTY_IDS_V211.some(
          (partyId) => !derivePartyIndependentFormationCompleteV211(envelope, partyId),
        )
      ) {
        return 'Final-confirmation prerequisites are not satisfied.';
      }
      return null;
    case 'record_party_confirmation': {
      if (!partyAuthorityMatches(envelope, authority, 'first_party_human')) {
        return 'Explicit first-party human authority is required.';
      }
      if (envelope.control.workflow_state !== 'final_confirmation') {
        return 'Party confirmation is unavailable in this workflow state.';
      }
      if (
        !derivePartyIndependentFormationCompleteV211(envelope, authority.party_id) ||
        currentPartyConfirmationV211(envelope, authority.party_id) !== null
      ) {
        return 'Party confirmation is not current or is already recorded.';
      }
      if (
        !isPartyScopedIdV211('confirmation', authority.party_id, operation.confirmation_id) ||
        !isPartyScopedIdV211('confirmation_event', authority.party_id, operation.event_id) ||
        operation.adoption_statement.trim().length === 0 ||
        !validIso(operation.confirmed_at)
      ) {
        return 'Party confirmation data is invalid.';
      }
      return null;
    }
    case 'reopen_own_formation': {
      if (!partyAuthorityMatches(envelope, authority, 'first_party_human')) {
        return 'Explicit first-party human authority is required.';
      }
      const party = envelope.parties[authority.party_id];
      if (
        party.edit_state !== 'confirmed' ||
        !isPartyScopedIdV211('reopen_event', authority.party_id, operation.event_id) ||
        operation.reason.trim().length === 0 ||
        !validIso(operation.occurred_at)
      ) {
        return 'Explicit reopen transition is invalid.';
      }
      return null;
    }
    case 'redact_source_turn':
      if (!isTrustedSystemAuthorityV211(authority)) return 'Trusted system authority is required.';
      if (!envelope.source_turns[operation.turn_id] || !validIso(operation.redacted_at)) {
        return 'Source turn redaction target is invalid.';
      }
      if (envelope.source_turns[operation.turn_id]!.payload === null) {
        return 'Source turn is already redacted.';
      }
      return null;
    case 'set_evidence_eligibility':
      if (!isTrustedSystemAuthorityV211(authority)) return 'Trusted system authority is required.';
      if (
        !envelope.evidence[operation.evidence_id] ||
        !['eligible', 'ineligible', 'not_required'].includes(operation.eligibility)
      ) {
        return 'Evidence eligibility transition is invalid.';
      }
      return null;
    case 'mark_ready_for_lock':
      if (!isTrustedSystemAuthorityV211(authority)) return 'Trusted system authority is required.';
      if (
        envelope.control.workflow_state !== 'final_confirmation' ||
        !deriveFormationReadinessV211(envelope).ready_for_bilateral_lock
      ) {
        return 'Derived bilateral readiness is not satisfied.';
      }
      return null;
  }
}

function applyOperation(
  envelope: CaseEnvelopeV211,
  operation: EnvelopeCeremonyOperationV211,
  authority: ExecutionAuthorityV211,
): void {
  const nextVersion = envelope.control.envelope_version + 1;
  switch (operation.type) {
    case 'bind_party': {
      envelope.parties[operation.party_slot] = {
        ...envelope.parties[operation.party_slot],
        authenticated_subject_id: operation.authenticated_subject_id,
        identity_assurance: 'authenticated',
        binding_event_id: operation.binding_event_id,
      };
      return;
    }
    case 'open_controlled_disclosure':
      envelope.control.disclosure_state = 'disclosed';
      envelope.control.workflow_state = 'challenge_response';
      return;
    case 'enter_final_confirmation':
      envelope.control.workflow_state = 'final_confirmation';
      return;
    case 'record_party_confirmation': {
      const party = authority as AuthenticatedPartyAuthorityV211;
      const readback = renderPartyFormationReadbackV211(envelope, party.party_id);
      const cursor = envelope.control.party_views[party.party_id];
      envelope.formation.confirmations[party.party_id].push({
        confirmation_version: PARTY_CONFIRMATION_VERSION_V211,
        confirmation_id: operation.confirmation_id,
        party_id: party.party_id,
        authenticated_subject_id: party.authenticated_subject_id,
        party_projection_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
        party_projection_hash: cursor.party_projection_hash,
        party_visible_version: cursor.party_visible_version,
        party_readback_version: PARTY_FORMATION_READBACK_VERSION_V211,
        party_readback_hash: readback.document_hash,
        adoption_statement_hash: hashAdoptionStatementV211(operation.adoption_statement),
        formation_epoch: envelope.parties[party.party_id].formation_epoch,
        shared_envelope_version: envelope.control.envelope_version,
        shared_envelope_hash: envelope.control.envelope_hash,
        confirmed_at: operation.confirmed_at,
        event_id: operation.event_id,
      });
      envelope.parties[party.party_id].edit_state = 'confirmed';
      return;
    }
    case 'reopen_own_formation': {
      const party = authority as AuthenticatedPartyAuthorityV211;
      const binding = envelope.parties[party.party_id];
      envelope.formation.reopen_events.push({
        event_id: operation.event_id,
        party_id: party.party_id,
        authenticated_subject_id: party.authenticated_subject_id,
        prior_formation_epoch: binding.formation_epoch,
        resulting_formation_epoch: binding.formation_epoch + 1,
        reason: operation.reason,
        occurred_at: operation.occurred_at,
      });
      binding.formation_epoch += 1;
      binding.edit_state = 'reopened';
      envelope.control.workflow_state =
        envelope.control.disclosure_state === 'disclosed'
          ? 'challenge_response'
          : 'independent_formation';
      return;
    }
    case 'redact_source_turn': {
      const source = envelope.source_turns[operation.turn_id]!;
      source.payload = null;
      source.redacted_at = operation.redacted_at;
      source.redacted_at_envelope_version = nextVersion;
      return;
    }
    case 'set_evidence_eligibility':
      envelope.evidence[operation.evidence_id]!.eligibility = operation.eligibility;
      return;
    case 'mark_ready_for_lock':
      envelope.control.workflow_state = 'ready_for_lock';
      return;
  }
}

export function applyEnvelopeCeremonyCommandV211(input: {
  envelope: CaseEnvelopeV211;
  command: EnvelopeCeremonyCommandV211;
  execution_authority: ExecutionAuthorityV211;
}): ApplyEnvelopeCeremonyCommandResultV211 {
  const { envelope, command, execution_authority: authority } = input;
  try {
    canonicalSerialize(command);
  } catch {
    return rejected(envelope, 'invalid_command', 'Command must be plain canonical JSON.');
  }
  const inputIssues = validateCaseEnvelopeV211(envelope);
  if (inputIssues.length > 0) {
    return rejected(
      envelope,
      'invalid_envelope',
      `${inputIssues[0]!.code}: ${inputIssues[0]!.message}`,
    );
  }
  if (
    !hasExactKeys(command, [
      'base_envelope_hash',
      'base_envelope_version',
      'case_id',
      'command_id',
      'command_version',
      'operation',
    ]) ||
    command.command_version !== ENVELOPE_COMMAND_VERSION_V211 ||
    !ID_PATTERN_V211.test(command.command_id) ||
    !ceremonyOperationShape(command.operation)
  ) {
    return rejected(envelope, 'invalid_command', 'Command shape or version is invalid.');
  }
  if (command.case_id !== envelope.control.case_id) {
    return rejected(envelope, 'case_mismatch', 'Command dispute does not match the envelope.');
  }
  if (command.base_envelope_version !== envelope.control.envelope_version) {
    return rejected(envelope, 'stale_base_version', 'Internal envelope version is stale.');
  }
  if (command.base_envelope_hash !== envelope.control.envelope_hash) {
    return rejected(envelope, 'stale_base_hash', 'Internal envelope hash is stale.');
  }
  const authorization = operationAuthorizationFailure(envelope, command.operation, authority);
  if (authorization) {
    const unauthorized = authorization.includes('authority');
    return rejected(
      envelope,
      unauthorized ? 'unauthorized_actor' : 'invalid_transition',
      authorization,
    );
  }
  const candidate = cloneCaseEnvelopeV211(envelope);
  applyOperation(candidate, command.operation, authority);
  candidate.control.envelope_version += 1;
  const changedVisibleParties = refreshPartyViewCursorsV211(envelope, candidate);
  candidate.formation.explanatory = authoritativeFormationExplanatoryStateV211(candidate);
  candidate.control.envelope_hash = hashCaseEnvelopeV211(candidate);
  const resultingIssues = validateCaseEnvelopeV211(candidate);
  if (resultingIssues.length > 0) {
    return rejected(
      envelope,
      'resulting_envelope_invalid',
      `${resultingIssues[0]!.code}: ${resultingIssues[0]!.message}`,
    );
  }
  return {
    status: 'applied',
    reason_code: null,
    message: 'V2.1.1 ceremony command applied atomically.',
    envelope: candidate,
    prior_envelope_version: envelope.control.envelope_version,
    resulting_envelope_version: candidate.control.envelope_version,
    changed_visible_parties: changedVisibleParties,
  };
}

export function ceremonyCommandForV211(
  envelope: CaseEnvelopeV211,
  commandId: string,
  operation: EnvelopeCeremonyOperationV211,
): EnvelopeCeremonyCommandV211 {
  return {
    command_version: ENVELOPE_COMMAND_VERSION_V211,
    command_id: commandId,
    case_id: envelope.control.case_id,
    base_envelope_version: envelope.control.envelope_version,
    base_envelope_hash: envelope.control.envelope_hash,
    operation: cloneCanonical(operation),
  };
}

export type InitialFormationRequirementsV211 = Record<
  PartyIdV211,
  Array<
    Omit<FormationRequirementV211, 'party_id'> & {
      party_id?: never;
    }
  >
>;

export function createInitialCaseEnvelopeV211(
  caseId: string,
  initialRequirements: InitialFormationRequirementsV211 = { party_a: [], party_b: [] },
): CaseEnvelopeV211 {
  if (!/^dispute_[A-Za-z0-9_.:-]+$/u.test(caseId) || caseId.length > 160) {
    throw new TypeError('V2.1.1 dispute id is invalid.');
  }
  const requirements: Record<string, FormationRequirementV211> = {};
  for (const partyId of PARTY_IDS_V211) {
    for (const entry of initialRequirements[partyId]) {
      if (!ID_PATTERN_V211.test(entry.requirement_id) || requirements[entry.requirement_id]) {
        throw new TypeError('Formation requirement IDs must be unique canonical identifiers.');
      }
      requirements[entry.requirement_id] = { ...cloneCanonical(entry), party_id: partyId };
    }
  }
  const envelope: CaseEnvelopeV211 = {
    control: {
      schema_version: CASE_ENVELOPE_SCHEMA_VERSION_V211,
      protocol_version: FORMATION_PROTOCOL_VERSION_V211,
      command_contract_version: ENVELOPE_COMMAND_VERSION_V211,
      external_submission_contract_version: EXTERNAL_RELAY_SUBMISSION_VERSION_V211,
      projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
      readiness_contract_version: FORMATION_READINESS_VERSION_V211,
      case_id: caseId,
      workflow_state: 'independent_formation',
      envelope_version: 1,
      envelope_hash: '0'.repeat(64),
      disclosure_state: 'embargoed',
      party_views: {
        party_a: { party_visible_version: 1, party_projection_hash: '0'.repeat(64) },
        party_b: { party_visible_version: 1, party_projection_hash: '0'.repeat(64) },
      },
    },
    parties: {
      party_a: {
        party_id: 'party_a',
        role: 'party_a',
        authenticated_subject_id: null,
        identity_assurance: 'unbound',
        binding_event_id: null,
        edit_state: 'open',
        formation_epoch: 1,
      },
      party_b: {
        party_id: 'party_b',
        role: 'party_b',
        authenticated_subject_id: null,
        identity_assurance: 'unbound',
        binding_event_id: null,
        edit_state: 'open',
        formation_epoch: 1,
      },
    },
    source_turns: {},
    positions: {},
    requirements,
    clarifications: {},
    evidence: {},
    challenges: {},
    formation: {
      confirmations: { party_a: [], party_b: [] },
      reopen_events: [],
      explanatory: { open_required_fields: [], lock_prerequisites: [], lock_blockers: [] },
    },
  };
  for (const partyId of PARTY_IDS_V211) {
    envelope.control.party_views[partyId].party_projection_hash = hashPartyFormationProjectionV211(
      envelope,
      partyId,
    );
  }
  envelope.formation.explanatory = authoritativeFormationExplanatoryStateV211(envelope);
  envelope.control.envelope_hash = hashCaseEnvelopeV211(envelope);
  assertValidCaseEnvelopeV211(envelope);
  return envelope;
}
