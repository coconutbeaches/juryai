import { describe, expect, it } from 'vitest';
import {
  buildAdjudicationInput,
  hashAdjudicationInput,
  validateAdjudicationInput,
} from '../v2/adjudication-input.js';
import {
  SYSTEM_ACTOR,
  canonicalSerialize,
  cloneCanonical,
  createInitialCaseEnvelope,
  deriveResolutionStatus,
  hashCaseEnvelope,
  hashCaseRecord,
  partyActor,
  sha256,
  validateCaseEnvelope,
  type AuthenticatedActor,
  type JsonValue,
  type PartyStanceRecord,
} from '../v2/case-envelope.js';
import {
  createBilateralLockedFixture,
  createContractFixtureContext,
  describedEvidenceFixture,
  exactSourceReference,
  executeFixtureCommand,
  positionFixture,
} from '../v2/contract-fixtures.js';
import { applyEnvelopeCommand, commandFor, type EnvelopeCommand } from '../v2/envelope-command.js';
import {
  GATE_ZERO_ENVELOPE_OPERATION_TYPES,
  GATE_ZERO_ORACLE_VERSION,
  validateGateZeroTurnOracle,
  type GateZeroTurnOracle,
} from '../v2/gate-zero-oracle.js';
import { buildPersonBDisclosureView } from '../v2/person-b-disclosure.js';

function snapshot(value: unknown): string {
  return canonicalSerialize(value);
}

describe('v2 authenticated command and authority contract', () => {
  it('starts fresh party slots without fabricating identity or consent', () => {
    const envelope = createInitialCaseEnvelope('case_fresh_unbound');
    expect(envelope.parties).toEqual({
      party_a: {
        party_id: 'party_a',
        role: 'person_a',
        authenticated_subject_id: null,
        identity_assurance: 'unverified',
        identity_event_id: null,
        consent_status: 'not_requested',
        consent_event_id: null,
        participation_state: 'active',
      },
      party_b: {
        party_id: 'party_b',
        role: 'person_b',
        authenticated_subject_id: null,
        identity_assurance: 'unverified',
        identity_event_id: null,
        consent_status: 'not_requested',
        consent_event_id: null,
        participation_state: 'not_invited',
      },
    });
    expect(() => partyActor('party_a', envelope)).toThrow(/no authenticated subject/u);
    expect(() => partyActor('party_b', envelope)).toThrow(/no authenticated subject/u);
    expect(validateCaseEnvelope(envelope)).toEqual([]);
  });

  it('binds identity and consent only through system-owned commands', () => {
    const envelope = createInitialCaseEnvelope('case_bind_party');
    const prematureB = applyEnvelopeCommand({
      envelope,
      command: commandFor(
        envelope,
        SYSTEM_ACTOR,
        'command_bind_b_before_invitation',
        [
          {
            type: 'set_party_identity',
            party_id: 'party_b',
            authenticated_subject_id: 'subject_premature_b',
            identity_assurance: 'authenticated',
            identity_event_id: 'event_identity_premature_b',
          },
        ],
        [],
      ),
      authenticated_actor: SYSTEM_ACTOR,
      source_registry: {},
      ledger: {},
    });
    expect(prematureB).toMatchObject({ status: 'rejected', reason_code: 'invalid_operation' });
    const identity = applyEnvelopeCommand({
      envelope,
      command: commandFor(
        envelope,
        SYSTEM_ACTOR,
        'command_bind_a',
        [
          {
            type: 'set_party_identity',
            party_id: 'party_a',
            authenticated_subject_id: 'subject_bound_a',
            identity_assurance: 'authenticated',
            identity_event_id: 'event_identity_bound_a',
          },
        ],
        [],
      ),
      authenticated_actor: SYSTEM_ACTOR,
      source_registry: {},
      ledger: {},
    });
    expect(identity.status).toBe('applied');
    expect(identity.envelope.parties.party_a).toMatchObject({
      authenticated_subject_id: 'subject_bound_a',
      consent_status: 'not_requested',
    });
    const consent = applyEnvelopeCommand({
      envelope: identity.envelope,
      command: commandFor(
        identity.envelope,
        SYSTEM_ACTOR,
        'command_consent_a',
        [
          {
            type: 'record_party_consent',
            party_id: 'party_a',
            consent_status: 'granted',
            consent_event_id: 'event_consent_bound_a',
          },
        ],
        [],
      ),
      authenticated_actor: SYSTEM_ACTOR,
      source_registry: {},
      ledger: identity.ledger,
    });
    expect(consent.status).toBe('applied');
    expect(partyActor('party_a', consent.envelope)).toMatchObject({
      actor_id: 'subject_bound_a',
      authenticated_subject_id: 'subject_bound_a',
    });
    expect(validateCaseEnvelope(consent.envelope)).toEqual([]);
  });

  it('rejects malformed nested substantive objects before versioning state', () => {
    const context = createContractFixtureContext();
    const actor = partyActor('party_a', context.envelope);
    const malformed = positionFixture(
      context,
      'party_a',
      'position_malformed',
      'command_malformed_position',
    ) as unknown as Record<string, unknown>;
    delete malformed.statement;
    const before = snapshot(context.envelope);
    const result = executeFixtureCommand(context, actor, 'command_malformed_position', [
      {
        type: 'add_object',
        namespace: 'positions',
        object: malformed as never,
      },
    ]);
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'invalid_operation' });
    expect(snapshot(result.envelope)).toBe(before);
  });

  it('accepts an own-party assertion as exactly one atomic envelope and record version', () => {
    const context = createContractFixtureContext();
    expect(validateCaseEnvelope(context.envelope)).toEqual([]);
    const before = cloneCanonical(context.envelope);
    const actor = partyActor('party_a', context.envelope);
    const commandId = 'command_add_a_position';
    const result = executeFixtureCommand(context, actor, commandId, [
      {
        type: 'add_object',
        namespace: 'positions',
        object: positionFixture(context, 'party_a', 'position_a_delivery', commandId),
      },
    ]);
    expect(result.status).toBe('applied');
    expect(result.envelope.control.envelope_version).toBe(before.control.envelope_version + 1);
    expect(result.envelope.control.record_version).toBe(before.control.record_version + 1);
    expect(result.envelope.positions.position_a_delivery?.authority).toMatchObject({
      authority_kind: 'party_assertion',
      resolution_status: 'unresolved',
      introduced_by: { actor_id: actor.actor_id, actor_type: 'party' },
    });
    expect(validateCaseEnvelope(result.envelope)).toEqual([]);
  });

  it('never treats source grounding or model interpretation as objective authority', () => {
    const context = createContractFixtureContext();
    const actor = partyActor('party_a', context.envelope);
    const commandId = 'command_model_authority';
    const object = positionFixture(context, 'party_a', 'position_model_claim', commandId);
    object.authority.authority_kind = 'model_inference' as typeof object.authority.authority_kind;
    const before = snapshot(context.envelope);
    const result = executeFixtureCommand(context, actor, commandId, [
      { type: 'add_object', namespace: 'positions', object },
    ]);
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'invalid_operation' });
    expect(snapshot(result.envelope)).toBe(before);
  });

  it('rejects cross-party mutation without changing any byte of canonical state', () => {
    const context = createContractFixtureContext();
    context.envelope.control.workflow_state = 'reconciliation';
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    const actorB = partyActor('party_b', context.envelope);
    executeFixtureCommand(context, actorB, 'command_add_b_position', [
      {
        type: 'add_object',
        namespace: 'positions',
        object: positionFixture(
          context,
          'party_b',
          'position_b_delivery',
          'command_add_b_position',
        ),
      },
    ]);
    const before = snapshot(context.envelope);
    const actorA = partyActor('party_a', context.envelope);
    const result = executeFixtureCommand(context, actorA, 'command_a_edits_b', [
      {
        type: 'replace_own_field',
        namespace: 'positions',
        object_id: 'position_b_delivery',
        field: 'statement',
        expected_prior_value: 'There was no fixed delivery date.',
        replacement_value: 'Person A overwrote Person B.',
      },
    ]);
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'cross_party_mutation' });
    expect(snapshot(result.envelope)).toBe(before);
  });

  it('treats identity and explicit consent as code-owned party authorization preconditions', () => {
    const context = createContractFixtureContext();
    const actor = partyActor('party_a', context.envelope);
    context.envelope.parties.party_a.consent_status = 'declined';
    context.envelope.control.record_hash = hashCaseRecord(context.envelope);
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    const commandId = 'command_without_consent';
    const result = executeFixtureCommand(context, actor, commandId, [
      {
        type: 'add_object',
        namespace: 'positions',
        object: positionFixture(context, 'party_a', 'position_without_consent', commandId),
      },
    ]);
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'unauthorized_actor' });
    expect(result.envelope.positions.position_without_consent).toBeUndefined();
  });

  it('rejects stale version and wrong hash by CAS with exact no-mutation', () => {
    const context = createContractFixtureContext();
    const actor = partyActor('party_a', context.envelope);
    const operation = {
      type: 'add_object' as const,
      namespace: 'positions' as const,
      object: positionFixture(context, 'party_a', 'position_cas', 'command_stale_version'),
    };
    const staleVersion = commandFor(
      context.envelope,
      actor,
      'command_stale_version',
      [operation],
      [],
    );
    staleVersion.base_envelope_version += 1;
    const before = snapshot(context.envelope);
    const staleResult = applyEnvelopeCommand({
      envelope: context.envelope,
      command: staleVersion,
      authenticated_actor: actor,
      source_registry: context.source_registry,
      ledger: context.ledger,
    });
    expect(staleResult.reason_code).toBe('stale_base_version');
    expect(snapshot(staleResult.envelope)).toBe(before);

    const wrongHash = commandFor(context.envelope, actor, 'command_wrong_hash', [operation], []);
    wrongHash.base_envelope_hash = '0'.repeat(64);
    const wrongHashResult = applyEnvelopeCommand({
      envelope: context.envelope,
      command: wrongHash,
      authenticated_actor: actor,
      source_registry: context.source_registry,
      ledger: context.ledger,
    });
    expect(wrongHashResult.reason_code).toBe('stale_base_hash');
    expect(snapshot(wrongHashResult.envelope)).toBe(before);
  });

  it('makes identical retries idempotent and conflicting command IDs fail closed', () => {
    const context = createContractFixtureContext();
    const actor = partyActor('party_a', context.envelope);
    const commandId = 'command_retry';
    const command = commandFor(
      context.envelope,
      actor,
      commandId,
      [
        {
          type: 'add_object',
          namespace: 'positions',
          object: positionFixture(context, 'party_a', 'position_retry', commandId),
        },
      ],
      [],
    );
    const applied = applyEnvelopeCommand({
      envelope: context.envelope,
      command,
      authenticated_actor: actor,
      source_registry: context.source_registry,
      ledger: context.ledger,
    });
    expect(applied.status).toBe('applied');
    const idempotent = applyEnvelopeCommand({
      envelope: applied.envelope,
      command,
      authenticated_actor: actor,
      source_registry: context.source_registry,
      ledger: applied.ledger,
    });
    expect(idempotent).toMatchObject({
      status: 'idempotent',
      resulting_envelope_version: applied.resulting_envelope_version,
    });
    const mismatchedRetry = applyEnvelopeCommand({
      envelope: applied.envelope,
      command,
      authenticated_actor: SYSTEM_ACTOR,
      source_registry: context.source_registry,
      ledger: applied.ledger,
    });
    expect(mismatchedRetry.reason_code).toBe('authentication_mismatch');
    const conflicting = cloneCanonical(command);
    conflicting.operations = [
      {
        type: 'add_object',
        namespace: 'positions',
        object: positionFixture(context, 'party_a', 'position_conflict', commandId),
      },
    ];
    const conflictResult = applyEnvelopeCommand({
      envelope: applied.envelope,
      command: conflicting,
      authenticated_actor: actor,
      source_registry: context.source_registry,
      ledger: applied.ledger,
    });
    expect(conflictResult.reason_code).toBe('duplicate_command_conflict');
    expect(snapshot(conflictResult.envelope)).toBe(snapshot(applied.envelope));
  });

  it('rejects a partially invalid multi-operation command atomically', () => {
    const context = createContractFixtureContext();
    const actor = partyActor('party_a', context.envelope);
    const commandId = 'command_atomic_failure';
    const before = snapshot(context.envelope);
    const result = executeFixtureCommand(context, actor, commandId, [
      {
        type: 'add_object',
        namespace: 'positions',
        object: positionFixture(context, 'party_a', 'position_should_not_exist', commandId),
      },
      {
        type: 'replace_own_field',
        namespace: 'positions',
        object_id: 'missing_position',
        field: 'statement',
        expected_prior_value: 'old',
        replacement_value: 'new',
      },
    ]);
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'unknown_object' });
    expect(result.envelope.positions.position_should_not_exist).toBeUndefined();
    expect(snapshot(result.envelope)).toBe(before);
  });

  it('keeps silence unresolved and never derives bilateral agreement', () => {
    const stances: Record<'party_a' | 'party_b', PartyStanceRecord> = {
      party_a: { stance: 'asserted', response_event_id: 'event_a_asserted' },
      party_b: { stance: 'unresponded', response_event_id: null },
    };
    expect(deriveResolutionStatus(stances)).toBe('unresolved');
    stances.party_b = { stance: 'lacks_information', response_event_id: 'event_b_unknown' };
    expect(deriveResolutionStatus(stances)).toBe('unresolved');
  });

  it('rejects invalid source spans before applying any operation', () => {
    const context = createContractFixtureContext();
    const actor = partyActor('party_a', context.envelope);
    const commandId = 'command_bad_source';
    const object = positionFixture(context, 'party_a', 'position_bad_source', commandId);
    object.authority.source_references[0]!.span!.quote = 'not the source';
    const before = snapshot(context.envelope);
    const result = executeFixtureCommand(context, actor, commandId, [
      { type: 'add_object', namespace: 'positions', object },
    ]);
    expect(result.reason_code).toBe('invalid_source_reference');
    expect(snapshot(result.envelope)).toBe(before);
  });

  it('does not let one party attribute another party source as its own assertion', () => {
    const context = createContractFixtureContext();
    context.envelope.control.workflow_state = 'reconciliation';
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    const actor = partyActor('party_b', context.envelope);
    const object = positionFixture(
      context,
      'party_b',
      'position_b_using_a_source',
      'command_b_using_a_source',
    );
    object.authority.source_references = [
      exactSourceReference(context.source_registry.source_party_a_story!),
    ];
    const result = executeFixtureCommand(context, actor, 'command_b_using_a_source', [
      { type: 'add_object', namespace: 'positions', object },
    ]);
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'invalid_source_reference' });
  });

  it('fails closed instead of throwing for malformed envelope and command JSON', () => {
    expect(validateCaseEnvelope({ control: { record_hash: 'a'.repeat(64) } })[0]?.code).toBe(
      'envelope_shape_invalid',
    );
    const context = createContractFixtureContext();
    const actor = partyActor('party_a', context.envelope);
    const malformed = commandFor(
      context.envelope,
      actor,
      'command_extra_key',
      [
        {
          type: 'add_object',
          namespace: 'positions',
          object: positionFixture(context, 'party_a', 'position_extra_key', 'command_extra_key'),
        },
      ],
      [],
    ) as EnvelopeCommand & { hidden_model_rationale: string };
    malformed.hidden_model_rationale = 'must not be accepted';
    const result = applyEnvelopeCommand({
      envelope: context.envelope,
      command: malformed,
      authenticated_actor: actor,
      source_registry: context.source_registry,
      ledger: context.ledger,
    });
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'invalid_command' });

    const prototypeOperation = commandFor(
      context.envelope,
      actor,
      'command_prototype_operation',
      [{ type: '__proto__' } as never],
      [],
    );
    expect(
      applyEnvelopeCommand({
        envelope: context.envelope,
        command: prototypeOperation,
        authenticated_actor: actor,
        source_registry: context.source_registry,
        ledger: context.ledger,
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'invalid_command' });

    const injectedEnvelope = cloneCanonical(context.envelope) as typeof context.envelope & {
      chat_history: string[];
    };
    injectedEnvelope.chat_history = ['This must never become operational state.'];
    injectedEnvelope.control.envelope_hash = hashCaseEnvelope(injectedEnvelope);
    expect(validateCaseEnvelope(injectedEnvelope).map((issue) => issue.code)).toContain(
      'envelope_keys_invalid',
    );
  });
});

describe('v2 evidence, disclosure, confirmation, and transitions', () => {
  it('records item challenges and requires accepted corrections to apply atomically by the target owner', () => {
    const context = createContractFixtureContext();
    context.envelope.control.workflow_state = 'reconciliation';
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    const actorB = partyActor('party_b', context.envelope);
    executeFixtureCommand(context, actorB, 'command_b_challenge_target', [
      {
        type: 'add_object',
        namespace: 'positions',
        object: positionFixture(
          context,
          'party_b',
          'position_b_challenged',
          'command_b_challenge_target',
        ),
      },
    ]);
    const actorA = partyActor('party_a', context.envelope);
    const sourceA = exactSourceReference(context.source_registry.source_party_a_story!);
    const challenged = executeFixtureCommand(context, actorA, 'command_a_challenge', [
      {
        type: 'record_challenge',
        challenge_id: 'challenge_delivery_wording',
        target_namespace: 'positions',
        target_object_id: 'position_b_challenged',
        target_field: 'statement',
        source_references: [sourceA],
      },
    ]);
    expect(challenged.envelope.formation.challenges[0]).toMatchObject({
      challenging_party_id: 'party_a',
      status: 'open',
    });
    const prior = challenged.envelope.positions.position_b_challenged!.statement;
    const sourceB = exactSourceReference(context.source_registry.source_party_b_story!);
    const resolved = executeFixtureCommand(context, actorB, 'command_b_accept_challenge', [
      {
        type: 'resolve_challenge',
        challenge_id: 'challenge_delivery_wording',
        resolution: 'accepted',
        resolution_event_id: 'event_b_accepts_challenge',
        resolution_source_references: [sourceB],
      },
      {
        type: 'replace_own_field',
        namespace: 'positions',
        object_id: 'position_b_challenged',
        field: 'statement',
        expected_prior_value: prior,
        replacement_value: 'Person B clarifies that no written delivery date was fixed.',
      },
    ]);
    expect(resolved.status).toBe('applied');
    expect(resolved.envelope.formation.challenges[0]).toMatchObject({
      status: 'accepted',
      resolution_event_id: 'event_b_accepts_challenge',
    });
    expect(resolved.envelope.positions.position_b_challenged?.statement).toBe(
      'Person B clarifies that no written delivery date was fixed.',
    );
    expect(
      resolved.envelope.positions.position_b_challenged?.authority.source_references,
    ).toContainEqual(sourceB);
  });

  it('keeps described, uninspected, undisclosed evidence ineligible and hash identity non-authenticating', () => {
    const context = createContractFixtureContext();
    const actor = partyActor('party_a', context.envelope);
    const commandId = 'command_describe_evidence';
    const described = executeFixtureCommand(context, actor, commandId, [
      {
        type: 'add_object',
        namespace: 'evidence',
        object: describedEvidenceFixture(context, 'party_a', 'evidence_screenshot', commandId),
      },
    ]);
    expect(described.envelope.evidence.evidence_screenshot).toMatchObject({
      authenticity_status: 'not_assessed',
      adjudication_eligibility: {
        status: 'ineligible',
        reasons: ['not_disclosed_to_both', 'not_uploaded', 'uninspected'],
      },
    });
    const uploaded = executeFixtureCommand(context, SYSTEM_ACTOR, 'command_upload_evidence', [
      {
        type: 'record_evidence_upload',
        evidence_id: 'evidence_screenshot',
        content_hash: 'a'.repeat(64),
      },
    ]);
    expect(uploaded.envelope.evidence.evidence_screenshot).toMatchObject({
      content_hash: 'a'.repeat(64),
      authenticity_status: 'not_assessed',
      adjudication_eligibility: {
        status: 'ineligible',
        reasons: ['not_disclosed_to_both', 'uninspected'],
      },
    });
    const replacedUpload = executeFixtureCommand(
      context,
      SYSTEM_ACTOR,
      'command_replace_evidence_bytes',
      [
        {
          type: 'record_evidence_upload',
          evidence_id: 'evidence_screenshot',
          content_hash: 'f'.repeat(64),
        },
      ],
    );
    expect(replacedUpload).toMatchObject({ status: 'rejected', reason_code: 'invalid_operation' });
    expect(context.envelope.evidence.evidence_screenshot?.content_hash).toBe('a'.repeat(64));
    context.envelope.control.workflow_state = 'reconciliation';
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    const inspector: AuthenticatedActor = {
      actor_id: 'inspector_primary',
      actor_type: 'inspector',
      party_id: null,
      authenticated_subject_id: 'inspector_primary',
    };
    const inspectionSource = context.source_registry.source_inspection!;
    const inspected = executeFixtureCommand(context, inspector, 'command_inspect_evidence', [
      {
        type: 'record_evidence_inspection',
        evidence_id: 'evidence_screenshot',
        status: 'inspected_complete',
        result_id: 'inspection_screenshot',
        result_version: 'inspection-v1',
        result_hash: 'b'.repeat(64),
        limitations: [],
        source_reference: exactSourceReference(inspectionSource),
      },
    ]);
    expect(inspected.envelope.evidence.evidence_screenshot).toMatchObject({
      authenticity_status: 'not_assessed',
      authority: {
        authority_kind: 'party_assertion',
        introduced_by: { actor_id: actor.actor_id, actor_type: 'party' },
      },
      inspection: {
        status: 'inspected_complete',
        source_reference: exactSourceReference(inspectionSource),
      },
      adjudication_eligibility: {
        status: 'ineligible',
        reasons: ['not_disclosed_to_both'],
      },
    });
    const disclosed = executeFixtureCommand(context, SYSTEM_ACTOR, 'command_disclose_evidence', [
      {
        type: 'set_evidence_visibility',
        evidence_id: 'evidence_screenshot',
        visibility: 'disclosed_to_both',
        disclosure_event_id: 'event_evidence_disclosed',
      },
    ]);
    expect(disclosed.envelope.evidence.evidence_screenshot).toMatchObject({
      authenticity_status: 'not_assessed',
      adjudication_eligibility: { status: 'eligible', reasons: [] },
      disclosure_event_ids: ['event_evidence_disclosed'],
    });
  });

  it('does not revive withdrawn evidence in place', () => {
    const context = createContractFixtureContext();
    const commandId = 'command_describe_then_withdraw';
    executeFixtureCommand(context, partyActor('party_a', context.envelope), commandId, [
      {
        type: 'add_object',
        namespace: 'evidence',
        object: describedEvidenceFixture(context, 'party_a', 'evidence_withdrawn', commandId),
      },
    ]);
    context.envelope.evidence.evidence_withdrawn!.availability = 'withdrawn';
    context.envelope.evidence.evidence_withdrawn!.adjudication_eligibility = {
      status: 'ineligible',
      reasons: ['not_disclosed_to_both', 'uninspected', 'withdrawn_or_superseded'],
    };
    context.envelope.control.record_hash = hashCaseRecord(context.envelope);
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    const before = snapshot(context.envelope);
    const result = executeFixtureCommand(context, SYSTEM_ACTOR, 'command_revive_withdrawn', [
      {
        type: 'record_evidence_upload',
        evidence_id: 'evidence_withdrawn',
        content_hash: 'a'.repeat(64),
      },
    ]);
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'invalid_operation' });
    expect(snapshot(result.envelope)).toBe(before);
  });

  it('enforces the Person B independent-account embargo in executable state', () => {
    const context = createContractFixtureContext();
    executeFixtureCommand(context, partyActor('party_a', context.envelope), 'command_a_framing', [
      {
        type: 'add_object',
        namespace: 'positions',
        object: positionFixture(context, 'party_a', 'position_a_embargoed', 'command_a_framing'),
      },
    ]);
    context.envelope.control.workflow_state = 'person_b_independent_account';
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    const invitationView = buildPersonBDisclosureView(context.envelope);
    expect(invitationView.detailed_record).toBeNull();
    expect(invitationView).not.toHaveProperty('positions');
    const before = snapshot(context.envelope);
    const premature = executeFixtureCommand(context, SYSTEM_ACTOR, 'command_premature_disclosure', [
      { type: 'record_detailed_disclosure', event_id: 'event_disclosure_bad' },
    ]);
    expect(premature).toMatchObject({ status: 'rejected', reason_code: 'disclosure_embargo' });
    expect(snapshot(premature.envelope)).toBe(before);

    const actorB = partyActor('party_b', context.envelope);
    const source = context.source_registry.source_party_b_story!;
    const account = executeFixtureCommand(context, actorB, 'command_b_independent', [
      {
        type: 'record_independent_account',
        source_reference: exactSourceReference(source),
        event_id: 'event_b_independent',
      },
    ]);
    expect(account.envelope.formation.disclosure).toMatchObject({
      person_b_independent_account_source_id: source.source_id,
      detailed_a_framing: 'permitted',
    });
    expect(buildPersonBDisclosureView(context.envelope).detailed_record).toBeNull();
    const disclosed = executeFixtureCommand(context, SYSTEM_ACTOR, 'command_disclose_after_b', [
      { type: 'record_detailed_disclosure', event_id: 'event_disclosure_good' },
    ]);
    expect(disclosed.envelope.formation.disclosure.detailed_a_framing).toBe('disclosed');
    expect(
      buildPersonBDisclosureView(disclosed.envelope).detailed_record?.positions,
    ).toHaveProperty('position_a_embargoed');
  });

  it('binds confirmation to exact record identity and invalidates it after material mutation', () => {
    const context = createContractFixtureContext();
    context.envelope.control.workflow_state = 'person_a_confirmation';
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    const actor = partyActor('party_a', context.envelope);
    const confirmed = executeFixtureCommand(context, actor, 'command_confirm_a', [
      {
        type: 'record_confirmation',
        confirmation_id: 'confirmation_a_initial',
        confirmed_at: '2026-01-01T01:00:00.000Z',
        event_id: 'event_confirmation_a',
      },
    ]);
    expect(confirmed.envelope.formation.confirmations.party_a).toMatchObject({
      bound_record_version: confirmed.envelope.control.record_version,
      bound_record_hash: confirmed.envelope.control.record_hash,
      scope: 'party_record',
    });
    const commandId = 'command_material_after_confirmation';
    const changed = executeFixtureCommand(context, actor, commandId, [
      {
        type: 'add_object',
        namespace: 'positions',
        object: positionFixture(context, 'party_a', 'position_after_confirmation', commandId),
      },
    ]);
    expect(changed.envelope.formation.confirmations).toEqual({ party_a: null, party_b: null });
  });

  it('keeps transitions system-owned and rejects invalid state/event pairs', () => {
    const context = createContractFixtureContext();
    const party = partyActor('party_a', context.envelope);
    const unauthorized = executeFixtureCommand(context, party, 'command_party_transition', [
      { type: 'transition', event: 'initial_story_received', event_id: 'event_story' },
    ]);
    expect(unauthorized.reason_code).toBe('unauthorized_actor');
    const invalid = executeFixtureCommand(context, SYSTEM_ACTOR, 'command_invalid_transition', [
      { type: 'transition', event: 'adjudication_started', event_id: 'event_bad_start' },
    ]);
    expect(invalid.reason_code).toBe('invalid_transition');
  });

  it('cannot enter ready-for-lock on the bilateral path with only Person A confirmed', () => {
    const context = createContractFixtureContext();
    context.envelope.control.workflow_state = 'final_confirmation';
    context.envelope.formation.disclosure = {
      person_b_independent_account_source_id: 'source_party_b_story',
      detailed_a_framing: 'disclosed',
      disclosure_event_id: 'event_disclosure_complete',
    };
    context.envelope.control.record_hash = hashCaseRecord(context.envelope);
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    executeFixtureCommand(
      context,
      partyActor('party_a', context.envelope),
      'command_only_a_confirms',
      [
        {
          type: 'record_confirmation',
          confirmation_id: 'confirmation_only_a',
          confirmed_at: '2026-01-02T00:00:00.000Z',
          event_id: 'event_only_a_confirms',
        },
      ],
    );
    const result = executeFixtureCommand(context, SYSTEM_ACTOR, 'command_ready_without_b', [
      {
        type: 'transition',
        event: 'final_confirmations_complete',
        event_id: 'event_ready_without_b',
      },
    ]);
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'invalid_transition' });
  });
});

describe('v2 lock, reopening, adjudication projection, and Gate Zero oracle', () => {
  it('permits documented non-participation only as advisory-only after notice and deadline proof', () => {
    const context = createContractFixtureContext();
    context.envelope.control.eligibility = { status: 'eligible', reason_codes: [] };
    context.envelope.classification.suitability = 'eligible';
    context.envelope.classification.maturity = 'ready';
    context.envelope.classification.required_fact_profile = 'commercial_delivery';
    context.envelope.parties.party_b = {
      ...context.envelope.parties.party_b,
      authenticated_subject_id: null,
      identity_assurance: 'unverified',
      identity_event_id: null,
      consent_status: 'not_requested',
      consent_event_id: null,
      participation_state: 'not_invited',
    };
    context.envelope.control.record_hash = hashCaseRecord(context.envelope);
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    executeFixtureCommand(context, SYSTEM_ACTOR, 'command_advisory_policy', [
      { type: 'set_non_participation_policy', mode: 'advisory_only' },
    ]);
    context.envelope.control.workflow_state = 'awaiting_person_b';
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    executeFixtureCommand(context, SYSTEM_ACTOR, 'command_invite_b', [
      {
        type: 'set_party_participation',
        party_id: 'party_b',
        participation_state: 'invited',
        invitation_event_id: 'event_invitation_b',
      },
    ]);
    executeFixtureCommand(context, SYSTEM_ACTOR, 'command_enter_b_account', [
      { type: 'transition', event: 'person_b_invited', event_id: 'event_await_b' },
    ]);
    executeFixtureCommand(context, SYSTEM_ACTOR, 'command_document_no_b', [
      {
        type: 'set_party_participation',
        party_id: 'party_b',
        participation_state: 'non_participating',
        invitation_event_id: null,
      },
      {
        type: 'set_non_participation_record',
        notice_event_id: 'event_notice_b',
        response_deadline: '2026-01-10T00:00:00.000Z',
        deadline_expired_event_id: 'event_deadline_expired_b',
        correction_opportunity: 'expired',
      },
    ]);
    const finalConfirmation = executeFixtureCommand(
      context,
      SYSTEM_ACTOR,
      'command_nonparticipation_to_final',
      [
        {
          type: 'transition',
          event: 'non_participation_documented',
          event_id: 'event_nonparticipation_complete',
        },
      ],
    );
    expect(finalConfirmation.envelope.control.workflow_state).toBe('final_confirmation');
    const actorA = partyActor('party_a', context.envelope);
    executeFixtureCommand(context, actorA, 'command_confirm_advisory', [
      {
        type: 'record_confirmation',
        confirmation_id: 'confirmation_a_advisory',
        confirmed_at: '2026-01-11T00:00:00.000Z',
        event_id: 'event_confirmation_a_advisory',
      },
    ]);
    executeFixtureCommand(context, SYSTEM_ACTOR, 'command_advisory_ready', [
      {
        type: 'transition',
        event: 'final_confirmations_complete',
        event_id: 'event_advisory_ready',
      },
    ]);
    const locked = executeFixtureCommand(context, SYSTEM_ACTOR, 'command_advisory_lock', [
      {
        type: 'lock',
        mode: 'documented_non_participation',
        lock_event_id: 'event_advisory_lock',
        locked_at: '2026-01-12T00:00:00.000Z',
      },
    ]);
    expect(locked.status).toBe('applied');
    expect(locked.envelope.control.lock).toMatchObject({
      mode: 'documented_non_participation',
      output_scope: 'advisory_only',
    });
    expect(locked.envelope.formation.confirmations.party_b).toBeNull();
  });

  it('blocks in-place locked material mutation and requires explicit reopen with historical lock retention', () => {
    const context = createBilateralLockedFixture();
    const locked = cloneCanonical(context.envelope);
    const actor = partyActor('party_a', context.envelope);
    const commandId = 'command_locked_party_change';
    const rejected = executeFixtureCommand(context, actor, commandId, [
      {
        type: 'add_object',
        namespace: 'positions',
        object: positionFixture(context, 'party_a', 'position_locked_change', commandId),
      },
    ]);
    expect(rejected).toMatchObject({ status: 'rejected', reason_code: 'locked_envelope' });
    expect(snapshot(rejected.envelope)).toBe(snapshot(locked));

    const source = context.source_registry.source_material_change!;
    const reopened = executeFixtureCommand(context, SYSTEM_ACTOR, 'command_explicit_reopen', [
      {
        type: 'reopen_material_change',
        event_id: 'event_material_change',
        reason: 'New delivery-date source changes the record.',
        occurred_at: '2026-01-04T00:00:00.000Z',
        source_references: [exactSourceReference(source)],
      },
    ]);
    expect(reopened.envelope.control).toMatchObject({
      workflow_state: 'reconciliation',
      lock: { status: 'unlocked', mode: null },
      record_version: locked.control.record_version + 1,
    });
    expect(reopened.envelope.formation.prior_locks).toHaveLength(1);
    expect(reopened.envelope.formation.prior_locks[0]).toMatchObject({
      envelope_hash: locked.control.envelope_hash,
      record_hash: locked.control.record_hash,
      lock_event_id: locked.control.lock.lock_event_id,
    });
    expect(reopened.envelope.formation.confirmations).toEqual({ party_a: null, party_b: null });
    expect(reopened.envelope.formation.lock_blockers).toContain('reconfirmation_required');
    expect(() => buildAdjudicationInput(reopened.envelope)).toThrow(/locked state/u);
    context.envelope.control.workflow_state = 'ready_for_lock';
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    const relock = executeFixtureCommand(
      context,
      SYSTEM_ACTOR,
      'command_relock_without_confirmation',
      [
        {
          type: 'lock',
          mode: 'bilateral',
          lock_event_id: 'event_relock_bad',
          locked_at: '2026-01-05T00:00:00.000Z',
        },
      ],
    );
    expect(relock.reason_code).toBe('lock_guard_failed');
  });

  it('allows a system-owned non-material adjudication transition without reopening the record', () => {
    const context = createBilateralLockedFixture();
    const before = cloneCanonical(context.envelope);
    const result = executeFixtureCommand(context, SYSTEM_ACTOR, 'command_begin_adjudication', [
      {
        type: 'transition',
        event: 'adjudication_started',
        event_id: 'event_adjudication_started',
      },
    ]);
    expect(result.status).toBe('applied');
    expect(result.envelope.control).toMatchObject({
      workflow_state: 'deliberation',
      envelope_version: before.control.envelope_version + 1,
      record_version: before.control.record_version,
      record_hash: before.control.record_hash,
      lock: { status: 'locked', lock_event_id: before.control.lock.lock_event_id },
    });
  });

  it('requires lock commands to bind the exact current confirmation receipt IDs', () => {
    const context = createBilateralLockedFixture();
    const unlocked = cloneCanonical(context.envelope);
    unlocked.control.lock = {
      status: 'unlocked',
      mode: null,
      lock_event_id: null,
      locked_at: null,
      output_scope: null,
    };
    unlocked.control.workflow_state = 'ready_for_lock';
    unlocked.control.envelope_hash = hashCaseEnvelope(unlocked);
    const command = commandFor(
      unlocked,
      SYSTEM_ACTOR,
      'command_bad_confirmation_context',
      [
        {
          type: 'lock',
          mode: 'bilateral',
          lock_event_id: 'event_bad_confirmation_context',
          locked_at: '2026-01-03T01:00:00.000Z',
        },
      ],
      [],
    );
    command.confirmation_context = { confirmation_ids: ['confirmation_stale'] };
    const result = applyEnvelopeCommand({
      envelope: unlocked,
      command,
      authenticated_actor: SYSTEM_ACTOR,
      source_registry: context.source_registry,
      ledger: {},
    });
    expect(result.reason_code).toBe('confirmation_binding_invalid');
    expect(snapshot(result.envelope)).toBe(snapshot(unlocked));
  });

  it('treats every unresolved lock prerequisite as a deterministic lock blocker', () => {
    const context = createBilateralLockedFixture();
    context.envelope.control.lock = {
      status: 'unlocked',
      mode: null,
      lock_event_id: null,
      locked_at: null,
      output_scope: null,
    };
    context.envelope.control.workflow_state = 'ready_for_lock';
    context.envelope.formation.lock_prerequisites = ['inspect_evidence_receipt'];
    context.envelope.control.record_hash = hashCaseRecord(context.envelope);
    for (const partyId of ['party_a', 'party_b'] as const) {
      context.envelope.formation.confirmations[partyId]!.bound_record_hash =
        context.envelope.control.record_hash;
    }
    context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
    const result = executeFixtureCommand(context, SYSTEM_ACTOR, 'command_lock_with_prerequisite', [
      {
        type: 'lock',
        mode: 'bilateral',
        lock_event_id: 'event_lock_with_prerequisite',
        locked_at: '2026-01-03T02:00:00.000Z',
      },
    ]);
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'lock_guard_failed' });
  });

  it('constructs an exact locked/protocol-bound input and excludes arbitrary journals and ineligible evidence', () => {
    const context = createBilateralLockedFixture();
    const input = buildAdjudicationInput(context.envelope);
    expect(validateAdjudicationInput(input, context.envelope)).toEqual([]);
    expect(input).toMatchObject({
      locked_envelope: {
        envelope_version: context.envelope.control.envelope_version,
        envelope_hash: context.envelope.control.envelope_hash,
        lock_mode: 'bilateral',
      },
      protocol: { output_scope: 'adjudication' },
      excluded_evidence: [
        {
          evidence_id: 'evidence_background_unadmitted',
          reasons: ['not_disclosed_to_both', 'not_uploaded', 'uninspected'],
        },
      ],
    });
    expect(input).not.toHaveProperty('audit_journal');
    expect(input).not.toHaveProperty('chat_history');
    expect(input).not.toHaveProperty('model_rationale');

    const eligibleContext = createBilateralLockedFixture();
    const evidence = eligibleContext.envelope.evidence.evidence_background_unadmitted!;
    evidence.content_hash = 'c'.repeat(64);
    evidence.availability = 'uploaded';
    evidence.visibility = 'disclosed_to_both';
    evidence.disclosure_event_ids = ['event_background_disclosed'];
    evidence.inspection = {
      status: 'inspected_complete',
      result_id: 'inspection_background',
      result_version: 'inspection-v1',
      result_hash: 'd'.repeat(64),
      source_reference: exactSourceReference(eligibleContext.source_registry.source_inspection!),
      limitations: [],
    };
    evidence.authenticity_status = 'disputed';
    evidence.adjudication_eligibility = { status: 'eligible', reasons: [] };
    eligibleContext.envelope.control.record_hash = hashCaseRecord(eligibleContext.envelope);
    for (const partyId of ['party_a', 'party_b'] as const) {
      eligibleContext.envelope.formation.confirmations[partyId]!.bound_record_hash =
        eligibleContext.envelope.control.record_hash;
    }
    eligibleContext.envelope.control.envelope_hash = hashCaseEnvelope(eligibleContext.envelope);
    const eligibleInput = buildAdjudicationInput(eligibleContext.envelope);
    expect(eligibleInput.eligible_evidence[0]).toMatchObject({
      evidence_id: 'evidence_background_unadmitted',
      submitted_by_party_id: 'party_a',
      authenticity_status: 'disputed',
      authority: { authority_kind: 'party_assertion' },
    });

    const injected = cloneCanonical(input) as typeof input & { audit_journal: JsonValue };
    injected.audit_journal = [{ hidden: 'not admitted' }];
    injected.input_hash = hashAdjudicationInput(injected);
    expect(
      validateAdjudicationInput(injected, context.envelope).map((issue) => issue.code),
    ).toContain('adjudication_projection_invalid');

    const staleProtocol = cloneCanonical(input);
    staleProtocol.protocol.protocol_id = 'stale_protocol';
    staleProtocol.input_hash = hashAdjudicationInput(staleProtocol);
    expect(
      validateAdjudicationInput(staleProtocol, context.envelope).map((issue) => issue.code),
    ).toContain('adjudication_protocol_mismatch');
    expect(validateAdjudicationInput({} as never, context.envelope)[0]?.code).toBe(
      'adjudication_input_shape_invalid',
    );
  });

  it('freezes future per-turn oracle primitives without authoring the Gate Zero corpus', () => {
    const context = createContractFixtureContext();
    const actor = partyActor('party_a', context.envelope);
    const commandId = 'command_oracle_fixture';
    const command: EnvelopeCommand = commandFor(
      context.envelope,
      actor,
      commandId,
      [
        {
          type: 'add_object',
          namespace: 'positions',
          object: positionFixture(context, 'party_a', 'position_oracle', commandId),
        },
      ],
      [],
    );
    const applied = applyEnvelopeCommand({
      envelope: context.envelope,
      command,
      authenticated_actor: actor,
      source_registry: context.source_registry,
      ledger: context.ledger,
    });
    expect(applied.status).toBe('applied');
    const oracle: GateZeroTurnOracle = {
      oracle_version: GATE_ZERO_ORACLE_VERSION,
      turn_id: 'turn_oracle_fixture',
      authenticated_actor: actor,
      source_records: Object.values(context.source_registry).sort((left, right) =>
        left.source_id < right.source_id ? -1 : left.source_id > right.source_id ? 1 : 0,
      ),
      visible_source_ids: ['source_party_a_story'],
      hidden_source_ids: ['source_inspection', 'source_material_change', 'source_party_b_story'],
      visible_envelope_paths: [''],
      embargoed_envelope_paths: [],
      base_envelope_version: context.envelope.control.envelope_version,
      base_envelope_hash: context.envelope.control.envelope_hash,
      base_record_version: context.envelope.control.record_version,
      base_record_hash: context.envelope.control.record_hash,
      command,
      permitted_operation_types: ['add_object'],
      forbidden_operation_types: GATE_ZERO_ENVELOPE_OPERATION_TYPES.filter(
        (operation) => operation !== 'add_object',
      ),
      expected: {
        disposition: 'applied',
        exact_no_mutation: false,
        envelope_version_delta: 1,
        record_version_delta: 1,
        resulting_envelope_version: applied.envelope.control.envelope_version,
        resulting_envelope_hash: applied.envelope.control.envelope_hash,
        resulting_record_version: applied.envelope.control.record_version,
        resulting_record_hash: applied.envelope.control.record_hash,
        authority_fragments: [],
        evidence_actions: [],
        invalidated_confirmation_parties: [],
        workflow_state: 'person_a_formation',
        lock_status: 'unlocked',
        lock_mode: null,
        output_scope: null,
        failure_reason: null,
        required_source_references: [],
        next_question_target: {
          addressed_to_party: 'party_a',
          namespace: 'payments',
          object_id: null,
          field: 'due_trigger',
          reason_code: 'required_payment_due_trigger',
        },
        allowed_user_visible_facts: [
          {
            fact_id: 'fact_a_asserted_friday_delivery',
            statement: 'Person A says the agreed delivery date was Friday.',
            basis: 'party_attributed_assertion',
            party_attribution: 'party_a',
            source_references: [
              exactSourceReference(context.source_registry.source_party_a_story!),
            ],
          },
        ],
        forbidden_factual_promotions: [
          {
            proposition_id: 'proposition_friday_delivery_objective',
            proposition: 'The parties objectively agreed that delivery was due Friday.',
            prohibited_promotion: 'objective_fact',
            source_references: [
              exactSourceReference(context.source_registry.source_party_a_story!),
            ],
            reason_code: 'single_party_assertion_only',
          },
        ],
      },
    };
    expect(validateGateZeroTurnOracle(oracle)).toEqual([]);

    const hiddenFactOracle = cloneCanonical(oracle);
    hiddenFactOracle.expected.allowed_user_visible_facts[0]!.source_references = [
      exactSourceReference(context.source_registry.source_party_b_story!),
    ];
    expect(validateGateZeroTurnOracle(hiddenFactOracle)).toContain(
      'oracle_visible_fact_uses_hidden_source',
    );

    const tamperedSourceOracle = cloneCanonical(oracle);
    tamperedSourceOracle.source_records.find(
      (source) => source.source_id === 'source_party_a_story',
    )!.content += ' tampered';
    expect(validateGateZeroTurnOracle(tamperedSourceOracle)).toContain(
      'oracle_source_record_invalid',
    );

    const unclassifiedOperationOracle = cloneCanonical(oracle);
    unclassifiedOperationOracle.permitted_operation_types = [];
    expect(validateGateZeroTurnOracle(unclassifiedOperationOracle)).toContain(
      'oracle_command_operation_unclassified',
    );
    expect(validateGateZeroTurnOracle(unclassifiedOperationOracle)).toContain(
      'oracle_operation_permission_partition_invalid',
    );

    const forbiddenAppliedOperationOracle = cloneCanonical(oracle);
    forbiddenAppliedOperationOracle.permitted_operation_types = [];
    forbiddenAppliedOperationOracle.forbidden_operation_types.push('add_object');
    expect(validateGateZeroTurnOracle(forbiddenAppliedOperationOracle)).toContain(
      'oracle_applied_operation_not_permitted',
    );

    const embargoOverlapOracle = cloneCanonical(oracle);
    embargoOverlapOracle.embargoed_envelope_paths = ['/payments'];
    expect(validateGateZeroTurnOracle(embargoOverlapOracle)).toContain(
      'oracle_envelope_visibility_overlap',
    );

    const malformedVisibilityPathOracle = cloneCanonical(oracle);
    malformedVisibilityPathOracle.visible_envelope_paths = ['$.payments'];
    expect(validateGateZeroTurnOracle(malformedVisibilityPathOracle)).toContain(
      'oracle_envelope_visibility_path_invalid',
    );

    const actorMismatchOracle = cloneCanonical(oracle);
    actorMismatchOracle.command.authenticated_actor.authenticated_subject_id = 'different_subject';
    expect(validateGateZeroTurnOracle(actorMismatchOracle)).toContain(
      'oracle_command_actor_binding_invalid',
    );

    const invalidQuestionOracle = cloneCanonical(oracle);
    invalidQuestionOracle.expected.next_question_target!.field = '';
    expect(validateGateZeroTurnOracle(invalidQuestionOracle)).toContain(
      'oracle_next_question_target_invalid',
    );

    const malformedCommandOracle = cloneCanonical(oracle);
    delete (malformedCommandOracle.command as unknown as Record<string, unknown>).case_id;
    expect(validateGateZeroTurnOracle(malformedCommandOracle)).toContain(
      'oracle_command_shape_invalid',
    );

    const malformedAuthorityOracle = cloneCanonical(oracle);
    malformedAuthorityOracle.expected.authority_fragments = [
      { namespace: 'positions', object_id: 'position_oracle', authority: {} as never },
    ];
    expect(validateGateZeroTurnOracle(malformedAuthorityOracle)).toContain(
      'oracle_authority_fragment_invalid',
    );

    const emptyFactOracle = cloneCanonical(oracle);
    emptyFactOracle.expected.allowed_user_visible_facts[0]!.statement = '';
    expect(validateGateZeroTurnOracle(emptyFactOracle)).toContain('oracle_fact_shape_invalid');

    const ungroundedPromotionOracle = cloneCanonical(oracle);
    ungroundedPromotionOracle.expected.forbidden_factual_promotions[0]!.source_references = [];
    expect(validateGateZeroTurnOracle(ungroundedPromotionOracle)).toContain(
      'oracle_forbidden_promotion_source_missing',
    );

    const noncanonicalSetOrderOracle = cloneCanonical(oracle);
    noncanonicalSetOrderOracle.hidden_source_ids.reverse();
    expect(validateGateZeroTurnOracle(noncanonicalSetOrderOracle)).toContain(
      'oracle_set_order_invalid',
    );

    const staleOracle = cloneCanonical(oracle);
    staleOracle.command.base_envelope_version += 1;
    staleOracle.expected = {
      ...staleOracle.expected,
      disposition: 'rejected',
      exact_no_mutation: true,
      envelope_version_delta: 0,
      record_version_delta: 0,
      resulting_envelope_version: staleOracle.base_envelope_version,
      resulting_envelope_hash: staleOracle.base_envelope_hash,
      resulting_record_version: staleOracle.base_record_version,
      resulting_record_hash: staleOracle.base_record_hash,
      failure_reason: 'stale_base_version',
    };
    expect(validateGateZeroTurnOracle(staleOracle)).toEqual([]);
    expect(validateGateZeroTurnOracle({} as never)).toEqual(['oracle_shape_invalid']);
  });

  it('rejects non-plain or non-finite state from canonical hashing', () => {
    expect(() => canonicalSerialize({ amount: Number.NaN })).toThrow(/finite/u);
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, 'secret', { enumerable: true, get: () => 'hidden' });
    expect(() => canonicalSerialize(accessor)).toThrow(/accessor/u);
    const prototypeKey = JSON.parse('{"__proto__":{"polluted":true},"safe":true}') as JsonValue;
    expect(canonicalSerialize(prototypeKey)).toContain('"__proto__"');
    expect(canonicalSerialize(prototypeKey)).not.toBe(canonicalSerialize({ safe: true }));
  });

  it('defines sorted object keys while preserving semantic array order and exact Unicode', () => {
    expect(canonicalSerialize({ b: 2, a: 1 })).toBe(canonicalSerialize({ a: 1, b: 2 }));
    expect(sha256(canonicalSerialize({ operations: ['first', 'second'] }))).not.toBe(
      sha256(canonicalSerialize({ operations: ['second', 'first'] })),
    );
    expect(sha256(canonicalSerialize({ quote: '\u00e9' }))).not.toBe(
      sha256(canonicalSerialize({ quote: 'e\u0301' })),
    );
  });
});
