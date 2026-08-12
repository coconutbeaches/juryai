import {
  SYSTEM_ACTOR,
  cloneCanonical,
  createInitialCaseEnvelope,
  deriveResolutionStatus,
  hashCaseEnvelope,
  hashCaseRecord,
  hashSourceContent,
  partyActor,
  type AuthenticatedActor,
  type CaseEnvelope,
  type EvidenceObject,
  type ObjectAuthority,
  type PartyId,
  type PositionObject,
  type SourceRecord,
  type SourceReference,
} from './case-envelope.js';
import {
  applyEnvelopeCommand,
  commandFor,
  type ApplyEnvelopeCommandResult,
  type CommandLedger,
  type EnvelopeOperation,
} from './envelope-command.js';

export interface ContractFixtureContext {
  envelope: CaseEnvelope;
  ledger: CommandLedger;
  source_registry: Record<string, SourceRecord>;
}

export function sourceRecord(sourceId: string, content: string): SourceRecord {
  return {
    source_id: sourceId,
    source_type:
      sourceId === 'source_inspection'
        ? 'evidence_inspection'
        : sourceId === 'source_party_b_story'
          ? 'independent_account'
          : 'initial_story',
    actor_id:
      sourceId === 'source_inspection'
        ? 'inspector_primary'
        : sourceId.includes('party_b')
          ? 'subject_party_b'
          : 'subject_party_a',
    content,
    content_hash: hashSourceContent(content),
  };
}

export function exactSourceReference(source: SourceRecord): SourceReference {
  return {
    source_id: source.source_id,
    source_hash: source.content_hash,
    span: {
      encoding: 'utf16',
      start: 0,
      end: source.content.length,
      quote: source.content,
    },
  };
}

export function createContractFixtureContext(): ContractFixtureContext {
  const envelope = createInitialCaseEnvelope('case_gz0_contract');
  envelope.parties.party_a = {
    ...envelope.parties.party_a,
    authenticated_subject_id: 'subject_party_a',
    identity_assurance: 'authenticated',
    identity_event_id: 'event_identity_a',
    consent_status: 'granted',
    consent_event_id: 'event_consent_a',
  };
  envelope.parties.party_b = {
    ...envelope.parties.party_b,
    authenticated_subject_id: 'subject_party_b',
    identity_assurance: 'authenticated',
    identity_event_id: 'event_identity_b',
    consent_status: 'granted',
    consent_event_id: 'event_consent_b',
    participation_state: 'active',
  };
  envelope.control.workflow_state = 'person_a_formation';
  envelope.control.record_hash = hashCaseRecord(envelope);
  envelope.control.envelope_hash = hashCaseEnvelope(envelope);
  const sources = [
    sourceRecord('source_party_a_story', 'Person A says the agreed delivery date was Friday.'),
    sourceRecord('source_party_b_story', 'Person B says no fixed delivery date was agreed.'),
    sourceRecord('source_material_change', 'A later message changes the claimed delivery date.'),
    sourceRecord('source_inspection', 'Inspector read the complete uploaded screenshot bytes.'),
  ];
  return {
    envelope,
    ledger: {},
    source_registry: Object.fromEntries(sources.map((source) => [source.source_id, source])),
  };
}

export function partyAuthority(
  context: ContractFixtureContext,
  partyId: PartyId,
  commandId: string,
  sourceId = partyId === 'party_a' ? 'source_party_a_story' : 'source_party_b_story',
): ObjectAuthority {
  const actor = partyActor(partyId, context.envelope);
  const source = context.source_registry[sourceId]!;
  const partyStances: ObjectAuthority['party_stances'] = {
    party_a: {
      stance: partyId === 'party_a' ? 'asserted' : 'unresponded',
      response_event_id: null,
    },
    party_b: {
      stance: partyId === 'party_b' ? 'asserted' : 'unresponded',
      response_event_id: null,
    },
  };
  return {
    introduced_by: { actor_id: actor.actor_id, actor_type: 'party' },
    authority_kind: 'party_assertion',
    authority_detail: `Authenticated ${partyId} assertion`,
    subject_actor_ids: [actor.actor_id],
    source_references: [exactSourceReference(source)],
    evidence_ids: [],
    party_stances: partyStances,
    resolution_status: deriveResolutionStatus(partyStances),
    adjudication_eligible: true,
    introduced_in_record_version: context.envelope.control.record_version + 1,
    last_material_record_version: context.envelope.control.record_version + 1,
    last_material_command_id: commandId,
  };
}

export function positionFixture(
  context: ContractFixtureContext,
  partyId: PartyId,
  positionId: string,
  commandId: string,
): PositionObject {
  return {
    position_id: positionId,
    party_id: partyId,
    position_kind: 'assertion',
    target: null,
    statement:
      partyId === 'party_a' ? 'The delivery date was Friday.' : 'There was no fixed delivery date.',
    authority: partyAuthority(context, partyId, commandId),
  };
}

export function describedEvidenceFixture(
  context: ContractFixtureContext,
  partyId: PartyId,
  evidenceId: string,
  commandId: string,
): EvidenceObject {
  return {
    evidence_id: evidenceId,
    submitted_by_party_id: partyId,
    asserted_author_actor_id: null,
    evidence_type: 'screenshot',
    content_hash: null,
    availability: 'described_only',
    visibility: 'private',
    disclosure_event_ids: [],
    inspection: {
      status: 'uninspected',
      result_id: null,
      result_version: null,
      result_hash: null,
      source_reference: null,
      limitations: [],
    },
    authenticity_status: 'not_assessed',
    decision_relevant: true,
    adjudication_eligibility: {
      status: 'ineligible',
      reasons: ['not_disclosed_to_both', 'not_uploaded', 'uninspected'],
    },
    supersedes_evidence_id: null,
    authority: partyAuthority(context, partyId, commandId),
  };
}

export function executeFixtureCommand(
  context: ContractFixtureContext,
  actor: AuthenticatedActor,
  commandId: string,
  operations: EnvelopeOperation[],
  sourceReferences: SourceReference[] = [],
): ApplyEnvelopeCommandResult {
  const result = applyEnvelopeCommand({
    envelope: context.envelope,
    command: commandFor(context.envelope, actor, commandId, operations, sourceReferences),
    authenticated_actor: actor,
    source_registry: context.source_registry,
    ledger: context.ledger,
  });
  if (result.status !== 'rejected') {
    context.envelope = result.envelope;
    context.ledger = result.ledger;
  }
  return result;
}

export function createBilateralLockedFixture(): ContractFixtureContext {
  const context = createContractFixtureContext();
  const backgroundEvidence = describedEvidenceFixture(
    context,
    'party_a',
    'evidence_background_unadmitted',
    'command_add_background_evidence',
  );
  backgroundEvidence.decision_relevant = false;
  executeFixtureCommand(
    context,
    partyActor('party_a', context.envelope),
    'command_add_background_evidence',
    [{ type: 'add_object', namespace: 'evidence', object: backgroundEvidence }],
  );
  context.envelope.control.workflow_state = 'ready_for_lock';
  context.envelope.control.eligibility = { status: 'eligible', reason_codes: [] };
  context.envelope.classification.suitability = 'eligible';
  context.envelope.classification.maturity = 'ready';
  context.envelope.classification.required_fact_profile = 'commercial_delivery';
  context.envelope.formation.disclosure = {
    person_b_independent_account_source_id: 'source_party_b_story',
    detailed_a_framing: 'disclosed',
    disclosure_event_id: 'event_disclosure_complete',
  };
  context.envelope.control.record_hash = hashCaseRecord(context.envelope);
  context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
  const boundSnapshotHash = context.envelope.control.envelope_hash;
  for (const partyId of ['party_a', 'party_b'] as const) {
    context.envelope.formation.confirmations[partyId] = {
      confirmation_id: `confirmation_${partyId}`,
      party_id: partyId,
      authenticated_subject_id: context.envelope.parties[partyId].authenticated_subject_id!,
      bound_envelope_version: context.envelope.control.envelope_version,
      bound_envelope_hash: boundSnapshotHash,
      bound_record_version: context.envelope.control.record_version,
      bound_record_hash: context.envelope.control.record_hash,
      scope: 'party_record',
      confirmed_at: '2026-01-02T00:00:00.000Z',
      event_id: `event_confirmation_${partyId}`,
    };
  }
  context.envelope.control.envelope_hash = hashCaseEnvelope(context.envelope);
  const lockResult = executeFixtureCommand(context, SYSTEM_ACTOR, 'command_lock_bilateral', [
    {
      type: 'lock',
      mode: 'bilateral',
      lock_event_id: 'event_lock_bilateral',
      locked_at: '2026-01-03T00:00:00.000Z',
    },
  ]);
  if (lockResult.status !== 'applied') {
    throw new TypeError(`Bilateral fixture failed to lock: ${lockResult.message}`);
  }
  return cloneCanonical(context);
}
