import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import { hashAdoptionStatementV211 } from '../v2-1-1/case-envelope.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V212,
  DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V212,
  DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V212,
  ENVELOPE_COMMAND_VERSION_V212,
  EXTERNAL_RELAY_SUBMISSION_VERSION_V211,
  FORMATION_PROTOCOL_VERSION_V212,
  FORMATION_READINESS_VERSION_V212,
  ID_PATTERN_V212,
  PARTY_CONFIRMATION_VERSION_V211,
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  PARTY_FORMATION_READBACK_VERSION_V211,
  PARTY_IDS_V212,
  cloneCaseEnvelopeV212,
  hashCaseEnvelopeV212,
  hashDisclosureReviewAcknowledgmentStatementV212,
  isAuthenticatedPartyAuthorityV212,
  isPartyScopedIdV212,
  isTrustedSystemAuthorityV212,
  type AuthenticatedPartyAuthorityV212,
  type CaseEnvelopeV212,
  type ExecutionAuthorityV212,
  type FormationRequirementV212,
  type PartyIdV212,
} from './case-envelope.js';
import { assertValidCaseEnvelopeV212, validateCaseEnvelopeV212 } from './contract-validator.js';
import {
  currentDisclosureReviewAcknowledgmentV212,
  disclosureReviewClosureCurrentV212,
} from './disclosure-review.js';
import {
  authoritativeFormationExplanatoryStateV212,
  deriveFormationReadinessV212,
} from './formation-readiness.js';
import { derivePartyIndependentFormationCompleteV212 } from './formation-requirements.js';
import {
  currentPartyConfirmationV212,
  hashPartyFormationProjectionV212,
  renderPartyFormationReadbackV212,
} from './party-projection.js';

export interface BindPartyOperationV212 {
  type: 'bind_party';
  party_slot: PartyIdV212;
  authenticated_subject_id: string;
  binding_event_id: string;
}

export interface OpenControlledDisclosureOperationV212 {
  type: 'open_controlled_disclosure';
}

export interface RecordDisclosureReviewAcknowledgmentOperationV212 {
  type: 'record_disclosure_review_acknowledgment';
  acknowledgment_id: string;
  event_id: string;
  acknowledged_at: string;
}

export interface EnterFinalConfirmationOperationV212 {
  type: 'enter_final_confirmation';
}

export interface RecordPartyConfirmationOperationV212 {
  type: 'record_party_confirmation';
  confirmation_id: string;
  event_id: string;
  adoption_statement: string;
  confirmed_at: string;
}

export interface ReopenOwnFormationOperationV212 {
  type: 'reopen_own_formation';
  event_id: string;
  reason: string;
  occurred_at: string;
}

export interface RedactSourceTurnOperationV212 {
  type: 'redact_source_turn';
  turn_id: string;
  redacted_at: string;
}

export interface SetEvidenceEligibilityOperationV212 {
  type: 'set_evidence_eligibility';
  evidence_id: string;
  eligibility: 'eligible' | 'ineligible' | 'not_required';
}

export interface MarkReadyForLockOperationV212 {
  type: 'mark_ready_for_lock';
}

export type EnvelopeCeremonyOperationV212 =
  | BindPartyOperationV212
  | OpenControlledDisclosureOperationV212
  | RecordDisclosureReviewAcknowledgmentOperationV212
  | EnterFinalConfirmationOperationV212
  | RecordPartyConfirmationOperationV212
  | ReopenOwnFormationOperationV212
  | RedactSourceTurnOperationV212
  | SetEvidenceEligibilityOperationV212
  | MarkReadyForLockOperationV212;

export interface EnvelopeCeremonyCommandV212 {
  command_version: typeof ENVELOPE_COMMAND_VERSION_V212;
  command_id: string;
  case_id: string;
  base_envelope_version: number;
  base_envelope_hash: string;
  operation: EnvelopeCeremonyOperationV212;
}

export type CeremonyCommandFailureReasonV212 =
  | 'invalid_command'
  | 'invalid_envelope'
  | 'case_mismatch'
  | 'stale_base_version'
  | 'stale_base_hash'
  | 'unauthorized_actor'
  | 'invalid_transition'
  | 'resulting_envelope_invalid';

export type ApplyEnvelopeCeremonyCommandResultV212 =
  | {
      status: 'applied';
      reason_code: null;
      message: string;
      envelope: CaseEnvelopeV212;
      prior_envelope_version: number;
      resulting_envelope_version: number;
      changed_visible_parties: PartyIdV212[];
    }
  | {
      status: 'rejected';
      reason_code: CeremonyCommandFailureReasonV212;
      message: string;
      envelope: CaseEnvelopeV212;
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

function ceremonyOperationShape(value: unknown): value is EnvelopeCeremonyOperationV212 {
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
    case 'record_disclosure_review_acknowledgment':
      return (
        hasExactKeys(value, ['acknowledged_at', 'acknowledgment_id', 'event_id', 'type']) &&
        typeof operation.acknowledged_at === 'string' &&
        typeof operation.acknowledgment_id === 'string' &&
        typeof operation.event_id === 'string'
      );
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
  envelope: CaseEnvelopeV212,
  reason: CeremonyCommandFailureReasonV212,
  message: string,
): ApplyEnvelopeCeremonyCommandResultV212 {
  return {
    status: 'rejected',
    reason_code: reason,
    message,
    envelope: cloneCaseEnvelopeV212(envelope),
    prior_envelope_version: envelope.control.envelope_version,
    resulting_envelope_version: envelope.control.envelope_version,
    changed_visible_parties: [],
  };
}

export function refreshPartyViewCursorsV212(
  before: CaseEnvelopeV212,
  candidate: CaseEnvelopeV212,
): PartyIdV212[] {
  const changed: PartyIdV212[] = [];
  for (const partyId of PARTY_IDS_V212) {
    const nextHash = hashPartyFormationProjectionV212(candidate, partyId);
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
  envelope: CaseEnvelopeV212,
  authority: ExecutionAuthorityV212,
): authority is AuthenticatedPartyAuthorityV212 {
  if (
    !isAuthenticatedPartyAuthorityV212(authority) ||
    authority.interaction_authority !== 'first_party_human'
  ) {
    return false;
  }
  const binding = envelope.parties[authority.party_id];
  return (
    binding.identity_assurance === 'authenticated' &&
    binding.authenticated_subject_id === authority.authenticated_subject_id
  );
}

function acknowledgmentIdentityAvailable(
  envelope: CaseEnvelopeV212,
  acknowledgmentId: string,
  eventId: string,
): boolean {
  const history = PARTY_IDS_V212.flatMap(
    (partyId) => envelope.formation.disclosure_review_acknowledgments[partyId],
  );
  return !history.some(
    (acknowledgment) =>
      acknowledgment.acknowledgment_id === acknowledgmentId || acknowledgment.event_id === eventId,
  );
}

function operationAuthorizationFailure(
  envelope: CaseEnvelopeV212,
  operation: EnvelopeCeremonyOperationV212,
  authority: ExecutionAuthorityV212,
): string | null {
  switch (operation.type) {
    case 'bind_party': {
      if (!isTrustedSystemAuthorityV212(authority)) return 'Trusted system authority is required.';
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
        !ID_PATTERN_V212.test(operation.authenticated_subject_id) ||
        !isPartyScopedIdV212('binding', operation.party_slot, operation.binding_event_id)
      ) {
        return 'Binding identifiers are invalid.';
      }
      return null;
    }
    case 'open_controlled_disclosure':
      if (!isTrustedSystemAuthorityV212(authority)) return 'Trusted system authority is required.';
      if (
        envelope.control.workflow_state !== 'independent_formation' ||
        envelope.control.disclosure_state !== 'embargoed' ||
        PARTY_IDS_V212.some(
          (partyId) =>
            envelope.parties[partyId].identity_assurance !== 'authenticated' ||
            !derivePartyIndependentFormationCompleteV212(envelope, partyId),
        )
      ) {
        return 'Controlled disclosure prerequisites are not satisfied.';
      }
      return null;
    case 'record_disclosure_review_acknowledgment':
      if (!partyAuthorityMatches(envelope, authority)) {
        return 'Explicit first-party human authority is required.';
      }
      if (
        envelope.control.workflow_state !== 'challenge_response' ||
        envelope.control.disclosure_state !== 'disclosed' ||
        !derivePartyIndependentFormationCompleteV212(envelope, authority.party_id) ||
        Object.values(envelope.challenges).some((challenge) => challenge.status === 'open') ||
        currentDisclosureReviewAcknowledgmentV212(envelope, authority.party_id) !== null ||
        !isPartyScopedIdV212('disclosure_ack', authority.party_id, operation.acknowledgment_id) ||
        !isPartyScopedIdV212('disclosure_ack_event', authority.party_id, operation.event_id) ||
        !acknowledgmentIdentityAvailable(
          envelope,
          operation.acknowledgment_id,
          operation.event_id,
        ) ||
        !validIso(operation.acknowledged_at)
      ) {
        return 'Disclosure-review acknowledgment is invalid or unavailable.';
      }
      return null;
    case 'enter_final_confirmation':
      if (!isTrustedSystemAuthorityV212(authority)) return 'Trusted system authority is required.';
      if (
        envelope.control.workflow_state !== 'challenge_response' ||
        envelope.control.disclosure_state !== 'disclosed' ||
        Object.values(envelope.challenges).some((challenge) => challenge.status === 'open') ||
        PARTY_IDS_V212.some(
          (partyId) => !derivePartyIndependentFormationCompleteV212(envelope, partyId),
        ) ||
        !disclosureReviewClosureCurrentV212(envelope)
      ) {
        return 'Final-confirmation prerequisites are not satisfied.';
      }
      return null;
    case 'record_party_confirmation':
      if (!partyAuthorityMatches(envelope, authority)) {
        return 'Explicit first-party human authority is required.';
      }
      if (envelope.control.workflow_state !== 'final_confirmation') {
        return 'Party confirmation is unavailable in this workflow state.';
      }
      if (
        !derivePartyIndependentFormationCompleteV212(envelope, authority.party_id) ||
        currentPartyConfirmationV212(envelope, authority.party_id) !== null ||
        !isPartyScopedIdV212('confirmation', authority.party_id, operation.confirmation_id) ||
        !isPartyScopedIdV212('confirmation_event', authority.party_id, operation.event_id) ||
        operation.adoption_statement.trim().length === 0 ||
        !validIso(operation.confirmed_at)
      ) {
        return 'Party confirmation data is invalid.';
      }
      return null;
    case 'reopen_own_formation': {
      if (!partyAuthorityMatches(envelope, authority)) {
        return 'Explicit first-party human authority is required.';
      }
      const party = envelope.parties[authority.party_id];
      if (
        party.edit_state !== 'confirmed' ||
        !isPartyScopedIdV212('reopen_event', authority.party_id, operation.event_id) ||
        operation.reason.trim().length === 0 ||
        !validIso(operation.occurred_at)
      ) {
        return 'Explicit reopen transition is invalid.';
      }
      return null;
    }
    case 'redact_source_turn':
      if (!isTrustedSystemAuthorityV212(authority)) return 'Trusted system authority is required.';
      if (!envelope.source_turns[operation.turn_id] || !validIso(operation.redacted_at)) {
        return 'Source turn redaction target is invalid.';
      }
      if (envelope.source_turns[operation.turn_id]!.payload === null) {
        return 'Source turn is already redacted.';
      }
      return null;
    case 'set_evidence_eligibility':
      if (!isTrustedSystemAuthorityV212(authority)) return 'Trusted system authority is required.';
      if (
        !envelope.evidence[operation.evidence_id] ||
        !['eligible', 'ineligible', 'not_required'].includes(operation.eligibility)
      ) {
        return 'Evidence eligibility transition is invalid.';
      }
      return null;
    case 'mark_ready_for_lock':
      if (!isTrustedSystemAuthorityV212(authority)) return 'Trusted system authority is required.';
      if (
        envelope.control.workflow_state !== 'final_confirmation' ||
        !deriveFormationReadinessV212(envelope).ready_for_bilateral_lock
      ) {
        return 'Derived bilateral readiness is not satisfied.';
      }
      return null;
  }
}

function applyOperation(
  envelope: CaseEnvelopeV212,
  operation: EnvelopeCeremonyOperationV212,
  authority: ExecutionAuthorityV212,
): void {
  const nextVersion = envelope.control.envelope_version + 1;
  switch (operation.type) {
    case 'bind_party':
      envelope.parties[operation.party_slot] = {
        ...envelope.parties[operation.party_slot],
        authenticated_subject_id: operation.authenticated_subject_id,
        identity_assurance: 'authenticated',
        binding_event_id: operation.binding_event_id,
      };
      return;
    case 'open_controlled_disclosure':
      envelope.control.disclosure_state = 'disclosed';
      envelope.control.workflow_state = 'challenge_response';
      return;
    case 'record_disclosure_review_acknowledgment': {
      const party = authority as AuthenticatedPartyAuthorityV212;
      const cursor = envelope.control.party_views[party.party_id];
      const readback = renderPartyFormationReadbackV212(envelope, party.party_id);
      envelope.formation.disclosure_review_acknowledgments[party.party_id].push({
        acknowledgment_version: DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V212,
        acknowledgment_id: operation.acknowledgment_id,
        event_id: operation.event_id,
        dispute_id: envelope.control.case_id,
        party_id: party.party_id,
        authenticated_subject_id: party.authenticated_subject_id,
        formation_epoch: envelope.parties[party.party_id].formation_epoch,
        party_projection_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
        party_projection_hash: cursor.party_projection_hash,
        party_visible_version: cursor.party_visible_version,
        party_readback_version: PARTY_FORMATION_READBACK_VERSION_V211,
        party_readback_hash: readback.document_hash,
        acknowledgment_statement_hash: hashDisclosureReviewAcknowledgmentStatementV212(
          DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V212,
        ),
        acknowledged_at: operation.acknowledged_at,
        acknowledged_at_envelope_version: nextVersion,
      });
      return;
    }
    case 'enter_final_confirmation':
      envelope.control.workflow_state = 'final_confirmation';
      return;
    case 'record_party_confirmation': {
      const party = authority as AuthenticatedPartyAuthorityV212;
      const readback = renderPartyFormationReadbackV212(envelope, party.party_id);
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
      const party = authority as AuthenticatedPartyAuthorityV212;
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

export function applyEnvelopeCeremonyCommandV212(input: {
  envelope: CaseEnvelopeV212;
  command: EnvelopeCeremonyCommandV212;
  execution_authority: ExecutionAuthorityV212;
}): ApplyEnvelopeCeremonyCommandResultV212 {
  const { envelope, command, execution_authority: authority } = input;
  try {
    canonicalSerialize(command);
  } catch {
    return rejected(envelope, 'invalid_command', 'Command must be plain canonical JSON.');
  }
  const inputIssues = validateCaseEnvelopeV212(envelope);
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
    command.command_version !== ENVELOPE_COMMAND_VERSION_V212 ||
    !ID_PATTERN_V212.test(command.command_id) ||
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
    return rejected(
      envelope,
      authorization.includes('authority') ? 'unauthorized_actor' : 'invalid_transition',
      authorization,
    );
  }
  const candidate = cloneCaseEnvelopeV212(envelope);
  applyOperation(candidate, command.operation, authority);
  candidate.control.envelope_version += 1;
  const changedVisibleParties = refreshPartyViewCursorsV212(envelope, candidate);
  candidate.formation.explanatory = authoritativeFormationExplanatoryStateV212(candidate);
  candidate.control.envelope_hash = hashCaseEnvelopeV212(candidate);
  const resultingIssues = validateCaseEnvelopeV212(candidate);
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
    message: 'V2.1.2 ceremony command applied atomically.',
    envelope: candidate,
    prior_envelope_version: envelope.control.envelope_version,
    resulting_envelope_version: candidate.control.envelope_version,
    changed_visible_parties: changedVisibleParties,
  };
}

export function ceremonyCommandForV212(
  envelope: CaseEnvelopeV212,
  commandId: string,
  operation: EnvelopeCeremonyOperationV212,
): EnvelopeCeremonyCommandV212 {
  return {
    command_version: ENVELOPE_COMMAND_VERSION_V212,
    command_id: commandId,
    case_id: envelope.control.case_id,
    base_envelope_version: envelope.control.envelope_version,
    base_envelope_hash: envelope.control.envelope_hash,
    operation: cloneCanonical(operation),
  };
}

export type InitialFormationRequirementsV212 = Record<
  PartyIdV212,
  Array<
    Omit<FormationRequirementV212, 'party_id'> & {
      party_id?: never;
    }
  >
>;

export function createInitialCaseEnvelopeV212(
  caseId: string,
  initialRequirements: InitialFormationRequirementsV212 = { party_a: [], party_b: [] },
): CaseEnvelopeV212 {
  if (!/^dispute_[A-Za-z0-9_.:-]+$/u.test(caseId) || caseId.length > 160) {
    throw new TypeError('V2.1.2 dispute id is invalid.');
  }
  const requirements: Record<string, FormationRequirementV212> = {};
  for (const partyId of PARTY_IDS_V212) {
    for (const entry of initialRequirements[partyId]) {
      if (!ID_PATTERN_V212.test(entry.requirement_id) || requirements[entry.requirement_id]) {
        throw new TypeError('Formation requirement IDs must be unique canonical identifiers.');
      }
      requirements[entry.requirement_id] = { ...cloneCanonical(entry), party_id: partyId };
    }
  }
  const envelope: CaseEnvelopeV212 = {
    control: {
      schema_version: CASE_ENVELOPE_SCHEMA_VERSION_V212,
      protocol_version: FORMATION_PROTOCOL_VERSION_V212,
      command_contract_version: ENVELOPE_COMMAND_VERSION_V212,
      external_submission_contract_version: EXTERNAL_RELAY_SUBMISSION_VERSION_V211,
      projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
      readiness_contract_version: FORMATION_READINESS_VERSION_V212,
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
      disclosure_review_acknowledgments: { party_a: [], party_b: [] },
      explanatory: { open_required_fields: [], lock_prerequisites: [], lock_blockers: [] },
    },
  };
  for (const partyId of PARTY_IDS_V212) {
    envelope.control.party_views[partyId].party_projection_hash = hashPartyFormationProjectionV212(
      envelope,
      partyId,
    );
  }
  envelope.formation.explanatory = authoritativeFormationExplanatoryStateV212(envelope);
  envelope.control.envelope_hash = hashCaseEnvelopeV212(envelope);
  assertValidCaseEnvelopeV212(envelope);
  return envelope;
}
