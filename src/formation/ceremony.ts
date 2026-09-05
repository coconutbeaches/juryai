/**
 * Generation-neutral ceremony engine.
 *
 * Extracted from the frozen V2.1.4 implementation. The algorithm bodies are
 * kept as close to that original as practical: the only intended differences
 * are that generation values come from an immutable GenerationSpec and that
 * envelope validation goes through an injected port instead of a direct import
 * of a generation's validator. Semantics are unchanged, which is what the
 * parity harness asserts byte-for-byte.
 */

import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import { hashAdoptionStatement } from './envelope.js';
import {
  HASH_PATTERN,
  ID_PATTERN,
  PARTY_IDS,
  cloneCaseEnvelope,
  hashCaseEnvelope,
  hashDisclosureReviewAcknowledgmentStatement,
  isAuthenticatedPartyAuthority,
  isPartyScopedId,
  isTrustedSystemAuthority,
  type AuthenticatedPartyAuthority,
  type CaseEnvelope,
  type ExecutionAuthority,
  type FormationRequirement,
  type PartyId,
} from './envelope.js';
import {
  assertValidGenerationSpec,
  type GenerationSpec,
  type ValidatedGenerationSpec,
} from './generation-spec.js';
import type { FormationEnvelopeValidator } from './validator-port.js';
import {
  currentDisclosureReviewAcknowledgment,
  disclosureReviewClosureCurrent,
} from './disclosure-review.js';
import { authoritativeFormationExplanatoryState, deriveFormationReadiness } from './readiness.js';
import { derivePartyIndependentFormationComplete } from './requirements.js';
import {
  currentPartyConfirmation,
  hashPartyFormationProjection,
  renderPartyFormationReadback,
} from './projection.js';

export interface BindPartyOperation {
  type: 'bind_party';
  party_slot: PartyId;
  authenticated_subject_id: string;
  binding_event_id: string;
}

export interface OpenControlledDisclosureOperation {
  type: 'open_controlled_disclosure';
}

export interface RecordDisclosureReviewAcknowledgmentOperation {
  type: 'record_disclosure_review_acknowledgment';
  acknowledgment_id: string;
  event_id: string;
  acknowledged_at: string;
}

export interface EnterFinalConfirmationOperation {
  type: 'enter_final_confirmation';
}

export interface RecordPartyConfirmationOperation {
  type: 'record_party_confirmation';
  confirmation_id: string;
  event_id: string;
  adoption_statement: string;
  confirmed_at: string;
}

export interface ReopenOwnFormationOperation {
  type: 'reopen_own_formation';
  event_id: string;
  reason: string;
  occurred_at: string;
}

export interface RedactSourceTurnOperation {
  type: 'redact_source_turn';
  turn_id: string;
  redacted_at: string;
}

export interface SetEvidenceEligibilityOperation {
  type: 'set_evidence_eligibility';
  evidence_id: string;
  eligibility: 'eligible' | 'ineligible' | 'not_required';
}

export interface MarkReadyForLockOperation {
  type: 'mark_ready_for_lock';
}

export type EnvelopeCeremonyOperation =
  | BindPartyOperation
  | OpenControlledDisclosureOperation
  | RecordDisclosureReviewAcknowledgmentOperation
  | EnterFinalConfirmationOperation
  | RecordPartyConfirmationOperation
  | ReopenOwnFormationOperation
  | RedactSourceTurnOperation
  | SetEvidenceEligibilityOperation
  | MarkReadyForLockOperation;

export interface EnvelopeCeremonyCommand {
  command_version: string;
  command_id: string;
  case_id: string;
  base_envelope_version: number;
  base_envelope_hash: string;
  operation: EnvelopeCeremonyOperation;
}

export type CeremonyCommandFailureReason =
  | 'invalid_command'
  | 'invalid_envelope'
  | 'case_mismatch'
  | 'stale_base_version'
  | 'stale_base_hash'
  | 'unauthorized_actor'
  | 'invalid_transition'
  | 'resulting_envelope_invalid';

export type ApplyEnvelopeCeremonyCommandResult =
  | {
      status: 'applied';
      reason_code: null;
      message: string;
      envelope: CaseEnvelope;
      prior_envelope_version: number;
      resulting_envelope_version: number;
      changed_visible_parties: PartyId[];
    }
  | {
      status: 'rejected';
      reason_code: CeremonyCommandFailureReason;
      message: string;
      envelope: CaseEnvelope;
      prior_envelope_version: number;
      resulting_envelope_version: number;
      changed_visible_parties: [];
    };

export type InitialFormationRequirements = Record<
  PartyId,
  Array<
    Omit<FormationRequirement, 'party_id'> & {
      party_id?: never;
    }
  >
>;

export function createFormationCeremony(input: {
  spec: GenerationSpec;
  validator: FormationEnvelopeValidator<CaseEnvelope>;
}) {
  // Validated once, at construction. There is no module-global current spec.
  const spec = assertValidGenerationSpec(input.spec);
  const validator = input.validator;

  function validIso(value: string): boolean {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  }

  function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
  }

  function ceremonyOperationShape(value: unknown): value is EnvelopeCeremonyOperation {
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
    envelope: CaseEnvelope,
    reason: CeremonyCommandFailureReason,
    message: string,
  ): ApplyEnvelopeCeremonyCommandResult {
    return {
      status: 'rejected',
      reason_code: reason,
      message,
      envelope: cloneCaseEnvelope(envelope),
      prior_envelope_version: envelope.control.envelope_version,
      resulting_envelope_version: envelope.control.envelope_version,
      changed_visible_parties: [],
    };
  }

  function refreshPartyViewCursors(before: CaseEnvelope, candidate: CaseEnvelope): PartyId[] {
    const changed: PartyId[] = [];
    for (const partyId of PARTY_IDS) {
      const nextHash = hashPartyFormationProjection(spec, candidate, partyId);
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
    envelope: CaseEnvelope,
    authority: ExecutionAuthority,
  ): authority is AuthenticatedPartyAuthority {
    if (
      !isAuthenticatedPartyAuthority(authority) ||
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
    envelope: CaseEnvelope,
    acknowledgmentId: string,
    eventId: string,
  ): boolean {
    const history = PARTY_IDS.flatMap(
      (partyId) => envelope.formation.disclosure_review_acknowledgments[partyId],
    );
    return !history.some(
      (acknowledgment) =>
        acknowledgment.acknowledgment_id === acknowledgmentId ||
        acknowledgment.event_id === eventId,
    );
  }

  function operationAuthorizationFailure(
    envelope: CaseEnvelope,
    operation: EnvelopeCeremonyOperation,
    authority: ExecutionAuthority,
  ): string | null {
    switch (operation.type) {
      case 'bind_party': {
        if (!isTrustedSystemAuthority(authority)) return 'Trusted system authority is required.';
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
          !ID_PATTERN.test(operation.authenticated_subject_id) ||
          !isPartyScopedId('binding', operation.party_slot, operation.binding_event_id)
        ) {
          return 'Binding identifiers are invalid.';
        }
        return null;
      }
      case 'open_controlled_disclosure':
        if (!isTrustedSystemAuthority(authority)) return 'Trusted system authority is required.';
        if (
          envelope.control.workflow_state !== 'independent_formation' ||
          envelope.control.disclosure_state !== 'embargoed' ||
          PARTY_IDS.some(
            (partyId) =>
              envelope.parties[partyId].identity_assurance !== 'authenticated' ||
              !derivePartyIndependentFormationComplete(envelope, partyId),
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
          !derivePartyIndependentFormationComplete(envelope, authority.party_id) ||
          Object.values(envelope.challenges).some((challenge) => challenge.status === 'open') ||
          currentDisclosureReviewAcknowledgment(spec, envelope, authority.party_id) !== null ||
          !isPartyScopedId('disclosure_ack', authority.party_id, operation.acknowledgment_id) ||
          !isPartyScopedId('disclosure_ack_event', authority.party_id, operation.event_id) ||
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
        if (!isTrustedSystemAuthority(authority)) return 'Trusted system authority is required.';
        if (
          envelope.control.workflow_state !== 'challenge_response' ||
          envelope.control.disclosure_state !== 'disclosed' ||
          Object.values(envelope.challenges).some((challenge) => challenge.status === 'open') ||
          PARTY_IDS.some(
            (partyId) => !derivePartyIndependentFormationComplete(envelope, partyId),
          ) ||
          !disclosureReviewClosureCurrent(spec, envelope)
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
          !derivePartyIndependentFormationComplete(envelope, authority.party_id) ||
          currentPartyConfirmation(spec, envelope, authority.party_id) !== null ||
          !isPartyScopedId('confirmation', authority.party_id, operation.confirmation_id) ||
          !isPartyScopedId('confirmation_event', authority.party_id, operation.event_id) ||
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
          !isPartyScopedId('reopen_event', authority.party_id, operation.event_id) ||
          operation.reason.trim().length === 0 ||
          !validIso(operation.occurred_at)
        ) {
          return 'Explicit reopen transition is invalid.';
        }
        return null;
      }
      case 'redact_source_turn':
        if (!isTrustedSystemAuthority(authority)) return 'Trusted system authority is required.';
        if (!envelope.source_turns[operation.turn_id] || !validIso(operation.redacted_at)) {
          return 'Source turn redaction target is invalid.';
        }
        if (envelope.source_turns[operation.turn_id]!.payload === null) {
          return 'Source turn is already redacted.';
        }
        return null;
      case 'set_evidence_eligibility':
        if (!isTrustedSystemAuthority(authority)) return 'Trusted system authority is required.';
        if (
          !envelope.evidence[operation.evidence_id] ||
          !['eligible', 'ineligible', 'not_required'].includes(operation.eligibility)
        ) {
          return 'Evidence eligibility transition is invalid.';
        }
        return null;
      case 'mark_ready_for_lock':
        if (!isTrustedSystemAuthority(authority)) return 'Trusted system authority is required.';
        if (
          envelope.control.workflow_state !== 'final_confirmation' ||
          !deriveFormationReadiness(spec, envelope).ready_for_bilateral_lock
        ) {
          return 'Derived bilateral readiness is not satisfied.';
        }
        return null;
    }
  }

  function applyOperation(
    envelope: CaseEnvelope,
    operation: EnvelopeCeremonyOperation,
    authority: ExecutionAuthority,
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
        const party = authority as AuthenticatedPartyAuthority;
        const cursor = envelope.control.party_views[party.party_id];
        const readback = renderPartyFormationReadback(spec, envelope, party.party_id);
        envelope.formation.disclosure_review_acknowledgments[party.party_id].push({
          acknowledgment_version: spec.contracts.disclosure_acknowledgment_version,
          acknowledgment_id: operation.acknowledgment_id,
          event_id: operation.event_id,
          dispute_id: envelope.control.case_id,
          party_id: party.party_id,
          authenticated_subject_id: party.authenticated_subject_id,
          formation_epoch: envelope.parties[party.party_id].formation_epoch,
          party_projection_version: spec.contracts.projection_version,
          party_projection_hash: cursor.party_projection_hash,
          party_visible_version: cursor.party_visible_version,
          party_readback_version: spec.contracts.readback_version,
          party_readback_hash: readback.document_hash,
          acknowledgment_statement_hash: hashDisclosureReviewAcknowledgmentStatement(
            spec.contracts.disclosure_acknowledgment_statement,
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
        const party = authority as AuthenticatedPartyAuthority;
        const readback = renderPartyFormationReadback(spec, envelope, party.party_id);
        const cursor = envelope.control.party_views[party.party_id];
        envelope.formation.confirmations[party.party_id].push({
          confirmation_version: spec.contracts.confirmation_version,
          confirmation_id: operation.confirmation_id,
          party_id: party.party_id,
          authenticated_subject_id: party.authenticated_subject_id,
          party_projection_version: spec.contracts.projection_version,
          party_projection_hash: cursor.party_projection_hash,
          party_visible_version: cursor.party_visible_version,
          party_readback_version: spec.contracts.readback_version,
          party_readback_hash: readback.document_hash,
          adoption_statement_hash: hashAdoptionStatement(operation.adoption_statement),
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
        const party = authority as AuthenticatedPartyAuthority;
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

  function applyEnvelopeCeremonyCommand(input: {
    envelope: CaseEnvelope;
    command: EnvelopeCeremonyCommand;
    execution_authority: ExecutionAuthority;
  }): ApplyEnvelopeCeremonyCommandResult {
    const { envelope, command, execution_authority: authority } = input;
    try {
      canonicalSerialize(command);
    } catch {
      return rejected(envelope, 'invalid_command', 'Command must be plain canonical JSON.');
    }
    const inputIssues = validator.validate(envelope);
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
      command.command_version !== spec.contracts.command_version ||
      !ID_PATTERN.test(command.command_id) ||
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
    const candidate = cloneCaseEnvelope(envelope);
    applyOperation(candidate, command.operation, authority);
    candidate.control.envelope_version += 1;
    const changedVisibleParties = refreshPartyViewCursors(envelope, candidate);
    candidate.formation.explanatory = authoritativeFormationExplanatoryState(spec, candidate);
    candidate.control.envelope_hash = hashCaseEnvelope(candidate);
    const resultingIssues = validator.validate(candidate);
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
      message: 'V2.1.4 ceremony command applied atomically.',
      envelope: candidate,
      prior_envelope_version: envelope.control.envelope_version,
      resulting_envelope_version: candidate.control.envelope_version,
      changed_visible_parties: changedVisibleParties,
    };
  }

  function ceremonyCommandFor(
    envelope: CaseEnvelope,
    commandId: string,
    operation: EnvelopeCeremonyOperation,
  ): EnvelopeCeremonyCommand {
    return {
      command_version: spec.contracts.command_version,
      command_id: commandId,
      case_id: envelope.control.case_id,
      base_envelope_version: envelope.control.envelope_version,
      base_envelope_hash: envelope.control.envelope_hash,
      operation: cloneCanonical(operation),
    };
  }

  function createInitialCaseEnvelope(
    caseId: string,
    initialRequirements: InitialFormationRequirements = { party_a: [], party_b: [] },
  ): CaseEnvelope {
    if (!/^dispute_[A-Za-z0-9_.:-]+$/u.test(caseId) || caseId.length > 160) {
      throw new TypeError('V2.1.4 dispute id is invalid.');
    }
    const requirements: Record<string, FormationRequirement> = {};
    for (const partyId of PARTY_IDS) {
      for (const entry of initialRequirements[partyId]) {
        if (!ID_PATTERN.test(entry.requirement_id) || requirements[entry.requirement_id]) {
          throw new TypeError('Formation requirement IDs must be unique canonical identifiers.');
        }
        requirements[entry.requirement_id] = { ...cloneCanonical(entry), party_id: partyId };
      }
    }
    const envelope: CaseEnvelope = {
      control: {
        schema_version: spec.identity.envelope_schema_version,
        protocol_version: spec.identity.formation_protocol_version,
        command_contract_version: spec.contracts.command_version,
        external_submission_contract_version: spec.contracts.external_relay_submission_version,
        projection_contract_version: spec.contracts.projection_version,
        readiness_contract_version: spec.contracts.readiness_version,
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
    for (const partyId of PARTY_IDS) {
      envelope.control.party_views[partyId].party_projection_hash = hashPartyFormationProjection(
        spec,
        envelope,
        partyId,
      );
    }
    envelope.formation.explanatory = authoritativeFormationExplanatoryState(spec, envelope);
    envelope.control.envelope_hash = hashCaseEnvelope(envelope);
    validator.assertValid(envelope);
    return envelope;
  }

  return {
    refreshPartyViewCursors,
    applyEnvelopeCeremonyCommand,
    ceremonyCommandFor,
    createInitialCaseEnvelope,
  };
}
