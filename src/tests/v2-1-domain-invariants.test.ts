import { describe, expect, it } from 'vitest';
import {
  CASE_ENVELOPE_PROTOCOL_VERSION,
  CASE_ENVELOPE_SCHEMA_VERSION,
  canonicalSerialize,
  cloneCanonical,
} from '../v2/case-envelope.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V21,
  ENVELOPE_COMMAND_VERSION_V21,
  FORMATION_PROTOCOL_VERSION_V21,
  FORMATION_READINESS_VERSION_V21,
  PARTY_CONFIRMATION_VERSION_V21,
  PARTY_FORMATION_PROJECTION_VERSION_V21,
  PARTY_FORMATION_READBACK_VERSION_V21,
  PARTY_MUTATION_INTENT_VERSION_V21,
  TRUSTED_SYSTEM_AUTHORITY_V21,
  hashCaseEnvelopeV21,
  partyAuthorityV21,
  type AuthenticatedPartyAuthorityV21,
  type CaseEnvelopeV21,
  type ExecutionAuthorityV21,
  type PartyIdV21,
} from '../v2-1/case-envelope.js';
import { validateCaseEnvelopeV21 } from '../v2-1/contract-validator.js';
import {
  ENVELOPE_OPERATION_TYPES_V21,
  OPERATION_AUTHORIZATION_POLICIES_V21,
  applyEnvelopeCommandV21,
  commandForV21,
  createInitialCaseEnvelopeV21,
  prepareInternalPartyEnvelopeCommandV21,
  type ApplyEnvelopeCommandResultV21,
  type EnvelopeOperationV21,
  type InitialFormationRequirementsV21,
  type RecordOwnPositionOperationV21,
} from '../v2-1/envelope-command.js';
import {
  authoritativeFormationExplanatoryStateV21,
  deriveFormationReadinessV21,
} from '../v2-1/formation-readiness.js';
import {
  currentPartyConfirmationV21,
  hashPartyFormationProjectionV21,
  projectPartyFormationV21,
  serializePartyFormationProjectionV21,
} from '../v2-1/party-projection.js';

const NOW = '2026-09-01T00:00:00.000Z';
let commandSequence = 0;

function nextCommandId(prefix: string): string {
  commandSequence += 1;
  return `${prefix}_${commandSequence}`;
}

function execute(
  envelope: CaseEnvelopeV21,
  authority: ExecutionAuthorityV21,
  operation: EnvelopeOperationV21,
): ApplyEnvelopeCommandResultV21 {
  return applyEnvelopeCommandV21({
    envelope,
    command: commandForV21(envelope, nextCommandId('command'), operation),
    execution_authority: authority,
  });
}

function apply(
  envelope: CaseEnvelopeV21,
  authority: ExecutionAuthorityV21,
  operation: EnvelopeOperationV21,
): CaseEnvelopeV21 {
  const result = execute(envelope, authority, operation);
  expect(result.status, result.message).toBe('applied');
  expect(result.resulting_envelope_version).toBe(result.prior_envelope_version + 1);
  expect(validateCaseEnvelopeV21(result.envelope)).toEqual([]);
  return result.envelope;
}

function bindParty(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
  subjectId = `subject_${partyId}`,
): CaseEnvelopeV21 {
  return apply(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
    type: 'bind_party',
    party_slot: partyId,
    authenticated_subject_id: subjectId,
    binding_event_id: `binding_${partyId}_${commandSequence + 1}`,
  });
}

function boundEnvelope(
  requirements: InitialFormationRequirementsV21 = { party_a: [], party_b: [] },
): CaseEnvelopeV21 {
  let envelope = createInitialCaseEnvelopeV21('case_v21_invariant_test', requirements);
  envelope = bindParty(envelope, 'party_a');
  envelope = bindParty(envelope, 'party_b');
  return envelope;
}

function actor(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
  interaction: 'external_relay' | 'first_party_human' = 'external_relay',
): AuthenticatedPartyAuthorityV21 {
  return partyAuthorityV21(envelope, partyId, interaction);
}

function positionOperation(
  partyId: PartyIdV21,
  suffix: string,
  statement = `${partyId} says the contract remains disputed.`,
): RecordOwnPositionOperationV21 {
  return {
    type: 'record_own_position',
    position_id: `position_${partyId}_${suffix}`,
    position_kind: 'assertion',
    statement,
    resolution_status: 'disputed',
    source_turn: {
      turn_id: `turn_${partyId}_${suffix}`,
      content: statement,
      spans: [{ start: 0, end: statement.length, quote: statement }],
    },
  };
}

function completeFormation(envelope: CaseEnvelopeV21, partyId: PartyIdV21): CaseEnvelopeV21 {
  return apply(envelope, actor(envelope, partyId), {
    type: 'mark_own_independent_formation_complete',
  });
}

function confirmParty(envelope: CaseEnvelopeV21, partyId: PartyIdV21): CaseEnvelopeV21 {
  return apply(envelope, actor(envelope, partyId, 'first_party_human'), {
    type: 'record_party_confirmation',
    confirmation_id: `confirmation_${partyId}_${commandSequence + 1}`,
    event_id: `confirmation_event_${partyId}_${commandSequence + 1}`,
    adoption_statement: `I adopt my ${partyId} account.`,
    confirmed_at: NOW,
  });
}

function resolveRequiredFields(envelope: CaseEnvelopeV21, partyId: PartyIdV21): CaseEnvelopeV21 {
  let current = envelope;
  for (const requirement of Object.values(envelope.requirements).filter(
    (candidate) => candidate.party_id === partyId && candidate.required,
  )) {
    current = apply(current, actor(current, partyId), {
      type: 'resolve_own_requirement',
      requirement_id: requirement.requirement_id,
      resolution: 'resolved',
      response_summary: `${partyId} supplied the required account.`,
    });
  }
  return current;
}

function synchronizeFixture(envelope: CaseEnvelopeV21): void {
  for (const partyId of ['party_a', 'party_b'] as const) {
    envelope.control.party_views[partyId].party_projection_hash = hashPartyFormationProjectionV21(
      envelope,
      partyId,
    );
  }
  envelope.formation.explanatory = authoritativeFormationExplanatoryStateV21(envelope);
  envelope.control.envelope_hash = hashCaseEnvelopeV21(envelope);
}

describe('V2.1 explicit contract versions and principal binding', () => {
  it('introduces new version identifiers without silently changing V2.0 identifiers', () => {
    expect(CASE_ENVELOPE_SCHEMA_VERSION).toBe('juryai-case-envelope-v2.0.0');
    expect(CASE_ENVELOPE_PROTOCOL_VERSION).toBe('juryai-formation-protocol-v2.0.0');
    expect(CASE_ENVELOPE_SCHEMA_VERSION_V21).toBe('juryai-case-envelope-v2.1.0');
    expect(FORMATION_PROTOCOL_VERSION_V21).toBe('juryai-formation-protocol-v2.1.0');
    expect(ENVELOPE_COMMAND_VERSION_V21).toBe('juryai-envelope-command-v2.1.0');
    expect(PARTY_MUTATION_INTENT_VERSION_V21).toBe('juryai-party-mutation-intent-v2.1.0');
    expect(PARTY_FORMATION_PROJECTION_VERSION_V21).toBe('juryai-party-formation-projection-v2.1.0');
    expect(PARTY_FORMATION_READBACK_VERSION_V21).toBe('juryai-party-formation-readback-v2.1.0');
    expect(FORMATION_READINESS_VERSION_V21).toBe('juryai-formation-readiness-v2.1.0');
    expect(PARTY_CONFIRMATION_VERSION_V21).toBe('juryai-party-confirmation-v2.1.0');
  });

  it('allows A bound/B null and distinct bindings, but rejects duplicate subjects atomically', () => {
    let envelope = createInitialCaseEnvelopeV21('case_distinct_principals');
    envelope = bindParty(envelope, 'party_a', 'subject_one');
    expect(envelope.parties.party_b.authenticated_subject_id).toBeNull();
    expect(validateCaseEnvelopeV21(envelope)).toEqual([]);

    const before = canonicalSerialize(envelope);
    const duplicate = execute(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'bind_party',
      party_slot: 'party_b',
      authenticated_subject_id: 'subject_one',
      binding_event_id: 'binding_duplicate_subject',
    });
    expect(duplicate).toMatchObject({
      status: 'rejected',
      reason_code: 'resulting_envelope_invalid',
    });
    expect(canonicalSerialize(duplicate.envelope)).toBe(before);
    expect(duplicate.resulting_envelope_version).toBe(envelope.control.envelope_version);

    envelope = bindParty(envelope, 'party_b', 'subject_two');
    expect(validateCaseEnvelopeV21(envelope)).toEqual([]);

    const tampered = cloneCanonical(envelope);
    tampered.parties.party_b.authenticated_subject_id = 'subject_one';
    synchronizeFixture(tampered);
    expect(validateCaseEnvelopeV21(tampered).map((issue) => issue.code)).toContain(
      'duplicate_authenticated_subject',
    );
  });

  it('keeps an unbound B slot authority-free', () => {
    const envelope = bindParty(createInitialCaseEnvelopeV21('case_unbound_b_authority'), 'party_a');
    expect(() => actor(envelope, 'party_b')).toThrow(/no authenticated subject binding/u);
    const forgedB: AuthenticatedPartyAuthorityV21 = {
      actor_type: 'party',
      party_id: 'party_b',
      authenticated_subject_id: 'subject_not_bound',
      interaction_authority: 'first_party_human',
    };
    const result = execute(envelope, forgedB, positionOperation('party_b', 'forged'));
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'unauthorized_actor' });
  });

  it('fails closed on malformed runtime-decoded nested state and command identifiers', () => {
    const malformedEnvelope = {
      ...createInitialCaseEnvelopeV21('case_malformed_runtime'),
      control: null,
    };
    expect(() => validateCaseEnvelopeV21(malformedEnvelope)).not.toThrow();
    expect(validateCaseEnvelopeV21(malformedEnvelope)[0]?.code).toBe('control_shape_invalid');
    const validForCommand = createInitialCaseEnvelopeV21('case_malformed_rejection');
    const validCommand = commandForV21(
      validForCommand,
      nextCommandId('command_malformed_envelope'),
      { type: 'open_controlled_disclosure' },
    );
    let malformedRejection: ApplyEnvelopeCommandResultV21 | undefined;
    expect(() => {
      malformedRejection = applyEnvelopeCommandV21({
        envelope: malformedEnvelope as never,
        command: validCommand,
        execution_authority: TRUSTED_SYSTEM_AUTHORITY_V21,
      });
    }).not.toThrow();
    expect(malformedRejection).toMatchObject({
      status: 'rejected',
      reason_code: 'invalid_envelope',
      prior_envelope_version: 0,
      resulting_envelope_version: 0,
    });

    const nestedCases = [
      () => {
        const candidate = createInitialCaseEnvelopeV21('case_malformed_source');
        candidate.source_turns = { malformed: null as never };
        return candidate;
      },
      () => {
        const candidate = createInitialCaseEnvelopeV21('case_malformed_challenge');
        candidate.challenges = { malformed: null as never };
        return candidate;
      },
      () => {
        const candidate = createInitialCaseEnvelopeV21('case_malformed_receipt');
        candidate.formation.confirmations.party_a = [null as never];
        return candidate;
      },
      () => {
        const candidate = createInitialCaseEnvelopeV21('case_malformed_reopen');
        candidate.formation.reopen_events = [null as never];
        return candidate;
      },
    ];
    for (const nestedCase of nestedCases) {
      expect(() => validateCaseEnvelopeV21(nestedCase())).not.toThrow();
      expect(validateCaseEnvelopeV21(nestedCase()).length).toBeGreaterThan(0);
    }

    const envelope = boundEnvelope();
    const malformedCommand = commandForV21(
      envelope,
      nextCommandId('command_numeric_identifier'),
      positionOperation('party_a', 'numeric_identifier'),
    );
    (malformedCommand.operation as unknown as Record<string, unknown>).position_id = 7;
    const result = applyEnvelopeCommandV21({
      envelope,
      command: malformedCommand,
      execution_authority: actor(envelope, 'party_a'),
    });
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'invalid_command' });

    const invalidPartySlot = commandForV21(envelope, nextCommandId('command_invalid_party_slot'), {
      type: 'bind_party',
      party_slot: 'party_c',
      authenticated_subject_id: 'subject_invalid_slot',
      binding_event_id: 'binding_invalid_slot',
    } as never);
    expect(() =>
      applyEnvelopeCommandV21({
        envelope,
        command: invalidPartySlot,
        execution_authority: TRUSTED_SYSTEM_AUTHORITY_V21,
      }),
    ).not.toThrow();
    expect(
      applyEnvelopeCommandV21({
        envelope,
        command: invalidPartySlot,
        execution_authority: TRUSTED_SYSTEM_AUTHORITY_V21,
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'invalid_command' });

    const numericTimestamp = commandForV21(envelope, nextCommandId('command_numeric_timestamp'), {
      type: 'record_party_confirmation',
      confirmation_id: 'confirmation_party_a_numeric_time',
      adoption_statement: 'I adopt this account.',
      confirmed_at: 0,
      event_id: 'confirmation_event_party_a_numeric_time',
    } as never);
    expect(
      applyEnvelopeCommandV21({
        envelope,
        command: numericTimestamp,
        execution_authority: actor(envelope, 'party_a', 'first_party_human'),
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'invalid_command' });
  });
});

describe('V2.1 symmetric privacy and party-visible versioning', () => {
  it('keeps hidden B material byte-invisible to A and hidden A material byte-invisible to B', () => {
    let envelope = boundEnvelope({
      party_a: [{ requirement_id: 'requirement_a_account', label: 'A account' }],
      party_b: [{ requirement_id: 'requirement_b_account', label: 'B account' }],
    });
    const aBefore = serializePartyFormationProjectionV21(envelope, 'party_a');
    const aCursorBefore = cloneCanonical(envelope.control.party_views.party_a);
    const bVersionBefore = envelope.control.party_views.party_b.party_visible_version;

    envelope = apply(envelope, actor(envelope, 'party_b'), positionOperation('party_b', 'hidden'));
    envelope = apply(envelope, actor(envelope, 'party_b'), {
      type: 'record_own_clarification',
      clarification_id: 'clarification_party_b_hidden',
      question: 'What does B say?',
      answer: 'B supplies a private answer.',
    });
    envelope = apply(envelope, actor(envelope, 'party_b'), {
      type: 'record_own_evidence_reference',
      evidence_id: 'evidence_party_b_hidden',
      description: 'B private evidence reference',
      required_for_readiness: true,
    });
    envelope = resolveRequiredFields(envelope, 'party_b');

    expect(serializePartyFormationProjectionV21(envelope, 'party_a')).toBe(aBefore);
    expect(envelope.control.party_views.party_a).toEqual(aCursorBefore);
    expect(envelope.control.party_views.party_b.party_visible_version).toBeGreaterThan(
      bVersionBefore,
    );
    expect(projectPartyFormationV21(envelope, 'party_a').opponent_material).toBeNull();

    const bBefore = serializePartyFormationProjectionV21(envelope, 'party_b');
    const bCursorBefore = cloneCanonical(envelope.control.party_views.party_b);
    envelope = apply(envelope, actor(envelope, 'party_a'), positionOperation('party_a', 'hidden'));
    envelope = resolveRequiredFields(envelope, 'party_a');
    expect(serializePartyFormationProjectionV21(envelope, 'party_b')).toBe(bBefore);
    expect(envelope.control.party_views.party_b).toEqual(bCursorBefore);
  });

  it('increments only changed party views, then disclosure increments each newly affected view once', () => {
    let envelope = boundEnvelope();
    const initialA = envelope.control.party_views.party_a.party_visible_version;
    const initialB = envelope.control.party_views.party_b.party_visible_version;
    const aEdit = execute(
      envelope,
      actor(envelope, 'party_a'),
      positionOperation('party_a', 'view'),
    );
    expect(aEdit.status).toBe('applied');
    expect(aEdit.changed_visible_parties).toEqual(['party_a']);
    envelope = aEdit.envelope;
    expect(envelope.control.party_views.party_a.party_visible_version).toBe(initialA + 1);
    expect(envelope.control.party_views.party_b.party_visible_version).toBe(initialB);

    envelope = apply(envelope, actor(envelope, 'party_b'), positionOperation('party_b', 'view'));
    envelope = completeFormation(envelope, 'party_a');
    envelope = completeFormation(envelope, 'party_b');
    const beforeDisclosure = cloneCanonical(envelope.control.party_views);
    const disclosed = execute(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'open_controlled_disclosure',
    });
    expect(disclosed.status).toBe('applied');
    expect(disclosed.changed_visible_parties).toEqual(['party_a', 'party_b']);
    expect(disclosed.envelope.control.party_views.party_a.party_visible_version).toBe(
      beforeDisclosure.party_a.party_visible_version + 1,
    );
    expect(disclosed.envelope.control.party_views.party_b.party_visible_version).toBe(
      beforeDisclosure.party_b.party_visible_version + 1,
    );
    expect(
      projectPartyFormationV21(disclosed.envelope, 'party_a').opponent_material?.positions,
    ).toHaveLength(1);
    expect(
      projectPartyFormationV21(disclosed.envelope, 'party_b').opponent_material?.positions,
    ).toHaveLength(1);
  });

  it('never allows caller-controlled or decreasing party-visible versions', () => {
    let envelope = boundEnvelope();
    const previous = cloneCanonical(envelope.control.party_views);
    const injected = commandForV21(envelope, nextCommandId('command_injected_version'), {
      ...positionOperation('party_a', 'injected_version'),
      party_visible_version: 0,
    } as unknown as EnvelopeOperationV21);
    const rejected = applyEnvelopeCommandV21({
      envelope,
      command: injected,
      execution_authority: actor(envelope, 'party_a'),
    });
    expect(rejected).toMatchObject({ status: 'rejected', reason_code: 'invalid_command' });
    expect(rejected.envelope.control.party_views).toEqual(previous);

    for (const partyId of ['party_a', 'party_b'] as const) {
      const before = envelope.control.party_views[partyId].party_visible_version;
      envelope = apply(envelope, actor(envelope, partyId), positionOperation(partyId, 'monotonic'));
      expect(envelope.control.party_views[partyId].party_visible_version).toBeGreaterThanOrEqual(
        before,
      );
    }
  });

  it('binds party intent to the party view while preserving server-owned envelope CAS', () => {
    let envelope = boundEnvelope();
    const aCursor = cloneCanonical(envelope.control.party_views.party_a);
    const intent = {
      intent_version: PARTY_MUTATION_INTENT_VERSION_V21,
      command_id: nextCommandId('command_party_intent'),
      expected_party_visible_version: aCursor.party_visible_version,
      expected_party_projection_hash: aCursor.party_projection_hash,
      operation: positionOperation('party_a', 'intent_after_hidden_b'),
    } as const;
    expect(intent).not.toHaveProperty('base_envelope_version');
    expect(intent).not.toHaveProperty('base_envelope_hash');
    expect(intent).not.toHaveProperty('party_id');

    envelope = apply(
      envelope,
      actor(envelope, 'party_b'),
      positionOperation('party_b', 'hidden_before_a_intent'),
    );
    expect(envelope.control.party_views.party_a).toEqual(aCursor);
    const prepared = prepareInternalPartyEnvelopeCommandV21({
      envelope,
      intent,
      execution_authority: actor(envelope, 'party_a'),
    });
    expect(prepared.status).toBe('prepared');
    if (prepared.status !== 'prepared') throw new Error(prepared.message);
    expect(prepared.command.base_envelope_version).toBe(envelope.control.envelope_version);
    const applied = applyEnvelopeCommandV21({
      envelope,
      command: prepared.command,
      execution_authority: actor(envelope, 'party_a'),
    });
    expect(applied.status).toBe('applied');

    const staleAIntent = {
      ...intent,
      command_id: nextCommandId('command_stale_a_intent'),
    };
    const stale = prepareInternalPartyEnvelopeCommandV21({
      envelope: applied.envelope,
      intent: staleAIntent,
      execution_authority: actor(applied.envelope, 'party_a'),
    });
    expect(stale).toMatchObject({
      status: 'rejected',
      reason_code: 'party_projection_stale',
    });
    expect(Object.keys(stale).sort()).toEqual(['message', 'reason_code', 'status']);
  });
});

describe('V2.1 durable party attribution and derived readiness', () => {
  it('stamps attribution from authority, rejects model injection, and preserves it after turn erasure', () => {
    let envelope = boundEnvelope();
    const malicious = commandForV21(envelope, nextCommandId('command_party_injection'), {
      ...positionOperation('party_a', 'injected_party'),
      attributed_party_id: 'party_b',
    } as unknown as EnvelopeOperationV21);
    const injection = applyEnvelopeCommandV21({
      envelope,
      command: malicious,
      execution_authority: actor(envelope, 'party_a'),
    });
    expect(injection).toMatchObject({ status: 'rejected', reason_code: 'invalid_command' });

    envelope = apply(envelope, actor(envelope, 'party_a'), positionOperation('party_a', 'durable'));
    const beforeAttribution = envelope.positions.position_party_a_durable?.attributed_party_id;
    envelope = apply(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'redact_source_turn',
      turn_id: 'turn_party_a_durable',
      redacted_at: NOW,
    });
    expect(envelope.source_turns.turn_party_a_durable).toMatchObject({
      content: null,
      attributed_party_id: 'party_a',
    });
    expect(envelope.positions.position_party_a_durable?.attributed_party_id).toBe(
      beforeAttribution,
    );
    expect(validateCaseEnvelopeV21(envelope)).toEqual([]);
  });

  it('derives blockers from canonical state and fails closed on falsely empty explanatory arrays', () => {
    const envelope = createInitialCaseEnvelopeV21('case_corrupt_blockers', {
      party_a: [{ requirement_id: 'requirement_a_open', label: 'A required account' }],
      party_b: [],
    });
    const corrupt = cloneCanonical(envelope);
    corrupt.formation.explanatory = {
      open_required_fields: [],
      lock_prerequisites: [],
      lock_blockers: [],
    };
    corrupt.control.envelope_hash = hashCaseEnvelopeV21(corrupt);
    const readiness = deriveFormationReadinessV21(corrupt);
    expect(readiness.ready_for_bilateral_lock).toBe(false);
    expect(readiness.blockers).toContain('required_field_open:requirement_a_open');
    expect(readiness.blockers).toContain(
      'explanatory_state_inconsistent:lock_blockers_projection_mismatch',
    );
    expect(validateCaseEnvelopeV21(corrupt).map((candidate) => candidate.code)).toContain(
      'readiness_explanatory_projection_mismatch',
    );
    const lockAttempt = execute(corrupt, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'mark_ready_for_lock',
    });
    expect(lockAttempt).toMatchObject({ status: 'rejected', reason_code: 'invalid_envelope' });
    expect(canonicalSerialize(lockAttempt.envelope)).toBe(canonicalSerialize(corrupt));
  });
});

describe('V2.1 quiescence, explicit reopen, and confirmation currency', () => {
  it('rejects silent edits after confirmation and requires a visible first-party reopen', () => {
    let envelope = boundEnvelope();
    envelope = completeFormation(envelope, 'party_a');
    envelope = confirmParty(envelope, 'party_a');
    const numericReceiptTimestamp = cloneCanonical(envelope);
    (
      numericReceiptTimestamp.formation.confirmations.party_a[0] as unknown as {
        confirmed_at: unknown;
      }
    ).confirmed_at = 0;
    synchronizeFixture(numericReceiptTimestamp);
    expect(validateCaseEnvelopeV21(numericReceiptTimestamp).map((issue) => issue.code)).toContain(
      'confirmation_receipt_invalid',
    );
    const confirmedProjection = serializePartyFormationProjectionV21(envelope, 'party_a');
    expect(currentPartyConfirmationV21(envelope, 'party_a')).not.toBeNull();

    const silentEdit = execute(
      envelope,
      actor(envelope, 'party_a'),
      positionOperation('party_a', 'after_confirm'),
    );
    expect(silentEdit).toMatchObject({
      status: 'rejected',
      reason_code: 'explicit_reopen_required',
    });
    expect(serializePartyFormationProjectionV21(silentEdit.envelope, 'party_a')).toBe(
      confirmedProjection,
    );

    const relayReopen = execute(envelope, actor(envelope, 'party_a'), {
      type: 'reopen_own_formation',
      event_id: 'reopen_event_relay_denied',
      reason: 'I need to correct my account.',
      occurred_at: NOW,
    });
    expect(relayReopen).toMatchObject({ status: 'rejected', reason_code: 'unauthorized_actor' });

    envelope = apply(envelope, actor(envelope, 'party_a', 'first_party_human'), {
      type: 'reopen_own_formation',
      event_id: 'reopen_event_human',
      reason: 'I need to correct my account.',
      occurred_at: NOW,
    });
    expect(envelope.parties.party_a).toMatchObject({ edit_state: 'reopened', formation_epoch: 2 });
    expect(currentPartyConfirmationV21(envelope, 'party_a')).toBeNull();
    expect(
      projectPartyFormationV21(envelope, 'party_a').own_progress.last_reopen_event,
    ).toMatchObject({ event_id: 'reopen_event_human', resulting_formation_epoch: 2 });
    const numericReopenTimestamp = cloneCanonical(envelope);
    (
      numericReopenTimestamp.formation.reopen_events[0] as unknown as {
        occurred_at: unknown;
      }
    ).occurred_at = 0;
    synchronizeFixture(numericReopenTimestamp);
    expect(validateCaseEnvelopeV21(numericReopenTimestamp).map((issue) => issue.code)).toContain(
      'reopen_event_invalid',
    );

    envelope = apply(
      envelope,
      actor(envelope, 'party_a'),
      positionOperation('party_a', 'after_reopen'),
    );
    envelope = confirmParty(envelope, 'party_a');
    expect(currentPartyConfirmationV21(envelope, 'party_a')).not.toBeNull();
  });

  it('does not allow final_confirmation to remain a general-purpose add-object state', () => {
    let envelope = boundEnvelope();
    envelope = apply(
      envelope,
      actor(envelope, 'party_b'),
      positionOperation('party_b', 'final_challenge_target'),
    );
    envelope = completeFormation(envelope, 'party_a');
    envelope = completeFormation(envelope, 'party_b');
    envelope = apply(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'open_controlled_disclosure',
    });
    envelope = apply(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'enter_final_confirmation',
    });
    envelope = apply(envelope, actor(envelope, 'party_a'), {
      type: 'record_challenge',
      challenge_id: 'challenge_during_final_confirmation',
      target_position_id: 'position_party_b_final_challenge_target',
      statement: 'A requires a procedural response before reconfirming.',
    });
    const result = execute(
      envelope,
      actor(envelope, 'party_a'),
      positionOperation('party_a', 'final_state'),
    );
    expect(result).toMatchObject({
      status: 'rejected',
      reason_code: 'operation_not_permitted_in_state',
    });
    envelope = apply(envelope, actor(envelope, 'party_b'), {
      type: 'respond_to_challenge',
      challenge_id: 'challenge_during_final_confirmation',
      response_statement: 'B supplies the required procedural response.',
      replacement_statement: null,
      source_turn: null,
    });
    expect(envelope.challenges.challenge_during_final_confirmation?.status).toBe('resolved');
  });

  it.each([
    ['party_a', 'party_b'],
    ['party_b', 'party_a'],
  ] as const)(
    'keeps %s confirmation current when %s changes hidden private material',
    (confirmedParty, editingParty) => {
      let envelope = boundEnvelope();
      envelope = completeFormation(envelope, confirmedParty);
      envelope = confirmParty(envelope, confirmedParty);
      const projectionBefore = serializePartyFormationProjectionV21(envelope, confirmedParty);
      const confirmedCursor = cloneCanonical(envelope.control.party_views[confirmedParty]);
      const receipt = currentPartyConfirmationV21(envelope, confirmedParty);

      envelope = apply(
        envelope,
        actor(envelope, editingParty),
        positionOperation(editingParty, `private_after_${confirmedParty}`),
      );
      expect(serializePartyFormationProjectionV21(envelope, confirmedParty)).toBe(projectionBefore);
      expect(envelope.control.party_views[confirmedParty]).toEqual(confirmedCursor);
      expect(currentPartyConfirmationV21(envelope, confirmedParty)).toEqual(receipt);
      expect(envelope.control.party_views[editingParty].party_projection_hash).not.toBe(
        confirmedCursor.party_projection_hash,
      );
      expect(currentPartyConfirmationV21(envelope, editingParty)).toBeNull();
    },
  );

  it('invalidates a confirmation only when controlled disclosure changes that party projection', () => {
    let envelope = boundEnvelope();
    envelope = apply(envelope, actor(envelope, 'party_b'), positionOperation('party_b', 'embargo'));
    envelope = completeFormation(envelope, 'party_a');
    envelope = confirmParty(envelope, 'party_a');
    envelope = completeFormation(envelope, 'party_b');
    const aHashBefore = envelope.control.party_views.party_a.party_projection_hash;
    const aVersionBefore = envelope.control.party_views.party_a.party_visible_version;
    expect(currentPartyConfirmationV21(envelope, 'party_a')).not.toBeNull();

    envelope = apply(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'open_controlled_disclosure',
    });
    expect(envelope.control.party_views.party_a.party_projection_hash).not.toBe(aHashBefore);
    expect(envelope.control.party_views.party_a.party_visible_version).toBe(aVersionBefore + 1);
    expect(currentPartyConfirmationV21(envelope, 'party_a')).toBeNull();
    expect(envelope.parties.party_a.edit_state).toBe('confirmed');
    expect(deriveFormationReadinessV21(envelope).required_current_confirmations).toContain(
      'party_a',
    );
  });
});

describe('V2.1 operation-specific authorization', () => {
  it('declares an exhaustive ownership/target policy for every party-mutating operation', () => {
    expect(Object.keys(OPERATION_AUTHORIZATION_POLICIES_V21).sort()).toEqual(
      [...ENVELOPE_OPERATION_TYPES_V21].sort(),
    );
    for (const operationType of ENVELOPE_OPERATION_TYPES_V21) {
      const policy = OPERATION_AUTHORIZATION_POLICIES_V21[operationType];
      expect(policy.target_resolution).not.toBe('own_material');
      if (policy.party_mutating) {
        expect(policy.allowed_actor_types).toContain('party');
        expect(policy.system_required).toBe(false);
        expect(policy.target_resolution).toBeTruthy();
      } else {
        expect(policy.allowed_actor_types).toEqual(['system']);
        expect(policy.system_required).toBe(true);
      }
    }
  });

  it('rejects cross-party mutation for every existing-resource party operation', () => {
    let envelope = boundEnvelope({
      party_a: [{ requirement_id: 'requirement_a_owned', label: 'A owns this field' }],
      party_b: [{ requirement_id: 'requirement_b_owned', label: 'B owns this field' }],
    });
    envelope = apply(envelope, actor(envelope, 'party_b'), positionOperation('party_b', 'owned'));
    const position = envelope.positions.position_party_b_owned!;

    const replace = execute(envelope, actor(envelope, 'party_a'), {
      type: 'replace_own_position',
      position_id: position.position_id,
      expected_statement: position.statement,
      replacement_statement: 'A cannot replace B material.',
      source_turn: {
        turn_id: 'turn_party_a_cross_party_replace',
        content: 'A cannot replace B material.',
        spans: [{ start: 0, end: 28, quote: 'A cannot replace B material.' }],
      },
    });
    expect(replace.reason_code).toBe('invalid_operation');

    const requirement = execute(envelope, actor(envelope, 'party_a'), {
      type: 'resolve_own_requirement',
      requirement_id: 'requirement_b_owned',
      resolution: 'resolved',
      response_summary: 'A cannot resolve B field.',
    });
    expect(requirement.reason_code).toBe('invalid_operation');

    envelope = resolveRequiredFields(envelope, 'party_a');
    envelope = resolveRequiredFields(envelope, 'party_b');
    envelope = completeFormation(envelope, 'party_a');
    envelope = completeFormation(envelope, 'party_b');
    envelope = apply(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'open_controlled_disclosure',
    });
    const disclosedCrossPartyReplace = execute(envelope, actor(envelope, 'party_a'), {
      type: 'replace_own_position',
      position_id: position.position_id,
      expected_statement: position.statement,
      replacement_statement: 'A still cannot replace disclosed B material.',
      source_turn: {
        turn_id: 'turn_party_a_disclosed_cross_party_replace',
        content: 'A still cannot replace disclosed B material.',
        spans: [
          {
            start: 0,
            end: 44,
            quote: 'A still cannot replace disclosed B material.',
          },
        ],
      },
    });
    expect(disclosedCrossPartyReplace.reason_code).toBe('cross_party_mutation');
    const challengeOwn = execute(envelope, actor(envelope, 'party_b'), {
      type: 'record_challenge',
      challenge_id: 'challenge_wrong_target',
      target_position_id: position.position_id,
      statement: 'B cannot challenge its own position.',
    });
    expect(challengeOwn.reason_code).toBe('cross_party_mutation');

    envelope = apply(envelope, actor(envelope, 'party_a'), {
      type: 'record_challenge',
      challenge_id: 'challenge_a_to_b',
      target_position_id: position.position_id,
      statement: 'A disputes B position.',
    });
    const wrongResponder = execute(envelope, actor(envelope, 'party_a'), {
      type: 'respond_to_challenge',
      challenge_id: 'challenge_a_to_b',
      response_statement: 'A cannot answer for B.',
      replacement_statement: null,
      source_turn: null,
    });
    expect(wrongResponder.reason_code).toBe('cross_party_mutation');
  });

  it('makes hidden opponent-owned IDs indistinguishable from absent IDs in both directions', () => {
    let envelope = boundEnvelope({
      party_a: [{ requirement_id: 'requirement_a_private', label: 'A private field' }],
      party_b: [{ requirement_id: 'requirement_b_private', label: 'B private field' }],
    });
    envelope = apply(envelope, actor(envelope, 'party_a'), positionOperation('party_a', 'private'));
    envelope = apply(envelope, actor(envelope, 'party_b'), positionOperation('party_b', 'private'));

    for (const [requestingParty, opponentParty] of [
      ['party_a', 'party_b'],
      ['party_b', 'party_a'],
    ] as const) {
      const hiddenPosition = envelope.positions[`position_${opponentParty}_private`]!;
      const hiddenReplace = execute(envelope, actor(envelope, requestingParty), {
        type: 'replace_own_position',
        position_id: hiddenPosition.position_id,
        expected_statement: hiddenPosition.statement,
        replacement_statement: 'Unavailable replacement.',
        source_turn: {
          turn_id: `turn_${requestingParty}_hidden_oracle`,
          content: 'Unavailable replacement.',
          spans: [{ start: 0, end: 24, quote: 'Unavailable replacement.' }],
        },
      });
      const absentReplace = execute(envelope, actor(envelope, requestingParty), {
        type: 'replace_own_position',
        position_id: `position_absent_for_${requestingParty}`,
        expected_statement: hiddenPosition.statement,
        replacement_statement: 'Unavailable replacement.',
        source_turn: {
          turn_id: `turn_${requestingParty}_absent_oracle`,
          content: 'Unavailable replacement.',
          spans: [{ start: 0, end: 24, quote: 'Unavailable replacement.' }],
        },
      });
      expect({ reason: hiddenReplace.reason_code, message: hiddenReplace.message }).toEqual({
        reason: absentReplace.reason_code,
        message: absentReplace.message,
      });

      const hiddenRequirement = execute(envelope, actor(envelope, requestingParty), {
        type: 'resolve_own_requirement',
        requirement_id: `requirement_${opponentParty === 'party_a' ? 'a' : 'b'}_private`,
        resolution: 'resolved',
        response_summary: 'Unavailable field.',
      });
      const absentRequirement = execute(envelope, actor(envelope, requestingParty), {
        type: 'resolve_own_requirement',
        requirement_id: `requirement_absent_for_${requestingParty}`,
        resolution: 'resolved',
        response_summary: 'Unavailable field.',
      });
      expect({ reason: hiddenRequirement.reason_code, message: hiddenRequirement.message }).toEqual(
        { reason: absentRequirement.reason_code, message: absentRequirement.message },
      );
    }
  });

  it('prevents hidden-ID collision probes across every party-created material namespace', () => {
    let envelope = boundEnvelope();
    for (const partyId of ['party_a', 'party_b'] as const) {
      envelope = apply(
        envelope,
        actor(envelope, partyId),
        positionOperation(partyId, 'collision_probe'),
      );
      envelope = apply(envelope, actor(envelope, partyId), {
        type: 'record_own_clarification',
        clarification_id: `clarification_${partyId}_collision_probe`,
        question: `${partyId} private question?`,
        answer: `${partyId} private answer.`,
      });
      envelope = apply(envelope, actor(envelope, partyId), {
        type: 'record_own_evidence_reference',
        evidence_id: `evidence_${partyId}_collision_probe`,
        description: `${partyId} private evidence.`,
        required_for_readiness: false,
      });
    }

    const externalOutcome = (result: ApplyEnvelopeCommandResultV21) => ({
      reason: result.reason_code,
      message: result.message,
    });
    for (const [requestingParty, opponentParty] of [
      ['party_a', 'party_b'],
      ['party_b', 'party_a'],
    ] as const) {
      const positionCollision = positionOperation(requestingParty, 'position_collision');
      positionCollision.position_id = `position_${opponentParty}_collision_probe`;
      const positionAbsent = positionOperation(requestingParty, 'position_absent');
      positionAbsent.position_id = `position_${opponentParty}_absent_probe`;
      expect(
        externalOutcome(execute(envelope, actor(envelope, requestingParty), positionCollision)),
      ).toEqual(
        externalOutcome(execute(envelope, actor(envelope, requestingParty), positionAbsent)),
      );

      const sourceCollision = positionOperation(requestingParty, 'source_collision');
      sourceCollision.source_turn.turn_id = `turn_${opponentParty}_collision_probe`;
      const sourceAbsent = positionOperation(requestingParty, 'source_absent');
      sourceAbsent.source_turn.turn_id = `turn_${opponentParty}_absent_probe`;
      expect(
        externalOutcome(execute(envelope, actor(envelope, requestingParty), sourceCollision)),
      ).toEqual(externalOutcome(execute(envelope, actor(envelope, requestingParty), sourceAbsent)));

      const clarification = (identifier: string): EnvelopeOperationV21 => ({
        type: 'record_own_clarification',
        clarification_id: identifier,
        question: 'Private probe question?',
        answer: 'Private probe answer.',
      });
      expect(
        externalOutcome(
          execute(
            envelope,
            actor(envelope, requestingParty),
            clarification(`clarification_${opponentParty}_collision_probe`),
          ),
        ),
      ).toEqual(
        externalOutcome(
          execute(
            envelope,
            actor(envelope, requestingParty),
            clarification(`clarification_${opponentParty}_absent_probe`),
          ),
        ),
      );

      const evidence = (identifier: string): EnvelopeOperationV21 => ({
        type: 'record_own_evidence_reference',
        evidence_id: identifier,
        description: 'Private evidence probe.',
        required_for_readiness: false,
      });
      expect(
        externalOutcome(
          execute(
            envelope,
            actor(envelope, requestingParty),
            evidence(`evidence_${opponentParty}_collision_probe`),
          ),
        ),
      ).toEqual(
        externalOutcome(
          execute(
            envelope,
            actor(envelope, requestingParty),
            evidence(`evidence_${opponentParty}_absent_probe`),
          ),
        ),
      );
    }
  });

  it('rejects every party-mutating operation when the claimed party is unbound', () => {
    const envelope = bindParty(
      createInitialCaseEnvelopeV21('case_exhaustive_unbound_party', {
        party_a: [{ requirement_id: 'requirement_a_exhaustive', label: 'A field' }],
        party_b: [],
      }),
      'party_a',
    );
    const forgedB: AuthenticatedPartyAuthorityV21 = {
      actor_type: 'party',
      party_id: 'party_b',
      authenticated_subject_id: 'subject_forged_b',
      interaction_authority: 'first_party_human',
    };
    const negativeOperations: EnvelopeOperationV21[] = [
      positionOperation('party_b', 'unbound'),
      {
        type: 'replace_own_position',
        position_id: 'position_missing',
        expected_statement: 'Expected statement.',
        replacement_statement: 'Replacement statement.',
        source_turn: {
          turn_id: 'turn_replacement_unbound',
          content: 'Replacement statement.',
          spans: [{ start: 0, end: 22, quote: 'Replacement statement.' }],
        },
      },
      {
        type: 'resolve_own_requirement',
        requirement_id: 'requirement_a_exhaustive',
        resolution: 'resolved',
        response_summary: 'Forged B cannot resolve A field.',
      },
      {
        type: 'record_own_clarification',
        clarification_id: 'clarification_unbound',
        question: 'Question?',
        answer: 'Answer.',
      },
      {
        type: 'record_own_evidence_reference',
        evidence_id: 'evidence_unbound',
        description: 'Evidence.',
        required_for_readiness: false,
      },
      { type: 'mark_own_independent_formation_complete' },
      {
        type: 'record_challenge',
        challenge_id: 'challenge_unbound',
        target_position_id: 'position_missing',
        statement: 'Challenge.',
      },
      {
        type: 'respond_to_challenge',
        challenge_id: 'challenge_missing',
        response_statement: 'Response.',
        replacement_statement: null,
        source_turn: null,
      },
      {
        type: 'record_party_confirmation',
        confirmation_id: 'confirmation_unbound',
        adoption_statement: 'I adopt this account.',
        confirmed_at: NOW,
        event_id: 'confirmation_event_unbound',
      },
      {
        type: 'reopen_own_formation',
        event_id: 'reopen_unbound',
        reason: 'Correction required.',
        occurred_at: NOW,
      },
    ];
    const coveredTypes = negativeOperations.map((operation) => operation.type).sort();
    const partyMutatingTypes = ENVELOPE_OPERATION_TYPES_V21.filter(
      (operationType) => OPERATION_AUTHORIZATION_POLICIES_V21[operationType].party_mutating,
    ).sort();
    expect(coveredTypes).toEqual(partyMutatingTypes);
    for (const operation of negativeOperations) {
      expect(execute(envelope, forgedB, operation).reason_code, operation.type).toBe(
        'unauthorized_actor',
      );
    }
  });

  it('rejects party and serialized forged-system authority for every system operation', () => {
    const envelope = boundEnvelope();
    const party = actor(envelope, 'party_a', 'first_party_human');
    const forgedSystem = {
      actor_type: 'system',
      authority_kind: 'trusted_domain_system',
    } as unknown as ExecutionAuthorityV21;
    const systemOperations: EnvelopeOperationV21[] = [
      {
        type: 'bind_party',
        party_slot: 'party_a',
        authenticated_subject_id: 'subject_other',
        binding_event_id: 'binding_other',
      },
      { type: 'redact_source_turn', turn_id: 'turn_missing', redacted_at: NOW },
      {
        type: 'set_evidence_eligibility',
        evidence_id: 'evidence_missing',
        eligibility: 'eligible',
      },
      { type: 'open_controlled_disclosure' },
      { type: 'enter_final_confirmation' },
      { type: 'mark_ready_for_lock' },
    ];
    for (const operation of systemOperations) {
      expect(execute(envelope, party, operation).reason_code).toBe('unauthorized_actor');
      expect(execute(envelope, forgedSystem, operation).reason_code).toBe('unauthorized_actor');
    }
    const requestSteered = commandForV21(envelope, nextCommandId('command_request_system'), {
      type: 'open_controlled_disclosure',
    }) as unknown as Record<string, unknown>;
    requestSteered.actor_type = 'system';
    const result = applyEnvelopeCommandV21({
      envelope,
      command: requestSteered as never,
      execution_authority: party,
    });
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'invalid_command' });
  });
});

describe('V2.1 procedural bilateral readiness', () => {
  it('allows two current party confirmations and readiness while substantive positions disagree', () => {
    let envelope = boundEnvelope();
    envelope = apply(
      envelope,
      actor(envelope, 'party_a'),
      positionOperation('party_a', 'disagreement', 'A says the work was incomplete.'),
    );
    envelope = apply(
      envelope,
      actor(envelope, 'party_b'),
      positionOperation('party_b', 'disagreement', 'B says the work was complete.'),
    );
    envelope = apply(envelope, actor(envelope, 'party_a'), {
      type: 'record_own_evidence_reference',
      evidence_id: 'evidence_party_a_required',
      description: 'A required evidence reference.',
      required_for_readiness: true,
    });
    envelope = apply(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'set_evidence_eligibility',
      evidence_id: 'evidence_party_a_required',
      eligibility: 'eligible',
    });
    envelope = completeFormation(envelope, 'party_a');
    envelope = completeFormation(envelope, 'party_b');
    envelope = apply(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'open_controlled_disclosure',
    });
    envelope = apply(envelope, actor(envelope, 'party_a'), {
      type: 'record_challenge',
      challenge_id: 'challenge_disagreement',
      target_position_id: 'position_party_b_disagreement',
      statement: 'A challenges B completion account.',
    });
    envelope = apply(envelope, actor(envelope, 'party_b'), {
      type: 'respond_to_challenge',
      challenge_id: 'challenge_disagreement',
      response_statement: 'B maintains the work was complete.',
      replacement_statement: null,
      source_turn: null,
    });
    envelope = apply(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'enter_final_confirmation',
    });
    envelope = confirmParty(envelope, 'party_a');
    envelope = confirmParty(envelope, 'party_b');

    const readiness = deriveFormationReadinessV21(envelope);
    expect(readiness).toMatchObject({ ready_for_bilateral_lock: true, blockers: [] });
    expect(Object.values(envelope.positions).map((position) => position.resolution_status)).toEqual(
      ['disputed', 'disputed'],
    );
    expect(canonicalSerialize(envelope)).not.toContain('bilaterally_agreed');

    envelope = apply(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'mark_ready_for_lock',
    });
    expect(envelope.control.workflow_state).toBe('ready_for_lock');
    expect(currentPartyConfirmationV21(envelope, 'party_a')).not.toBeNull();
    expect(currentPartyConfirmationV21(envelope, 'party_b')).not.toBeNull();

    const invalidReadyFixture = cloneCanonical(envelope);
    invalidReadyFixture.evidence.evidence_party_a_required!.eligibility = 'ineligible';
    synchronizeFixture(invalidReadyFixture);
    expect(validateCaseEnvelopeV21(invalidReadyFixture).map((issue) => issue.code)).toContain(
      'ready_for_lock_state_invalid',
    );

    envelope = apply(envelope, TRUSTED_SYSTEM_AUTHORITY_V21, {
      type: 'set_evidence_eligibility',
      evidence_id: 'evidence_party_a_required',
      eligibility: 'ineligible',
    });
    expect(envelope.control.workflow_state).toBe('final_confirmation');
    expect(deriveFormationReadinessV21(envelope).ready_for_bilateral_lock).toBe(false);
    expect(currentPartyConfirmationV21(envelope, 'party_a')).toBeNull();
    expect(currentPartyConfirmationV21(envelope, 'party_b')).toBeNull();
  });
});
