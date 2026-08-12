import {
  SYSTEM_ACTOR,
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
} from '../v2/case-envelope.js';
import type { SetClassificationOperation } from '../v2/envelope-command.js';
import type { ExpectedUserVisibleFact, ForbiddenFactualPromotion } from '../v2/gate-zero-oracle.js';
import { CanonicalCaseAuthoringSession, type AuthoredTurnExpectation } from './canonical-case.js';

export const INSPECTOR_ACTOR: AuthenticatedActor = {
  actor_id: 'inspector_gate_zero',
  actor_type: 'inspector',
  party_id: null,
  authenticated_subject_id: 'inspector_gate_zero',
};

export function source(
  sourceId: string,
  sourceType: SourceRecord['source_type'],
  actorId: string | null,
  content: string,
): SourceRecord {
  return {
    source_id: sourceId,
    source_type: sourceType,
    actor_id: actorId,
    content,
    content_hash: hashSourceContent(content),
  };
}

export function exactReference(record: SourceRecord): SourceReference {
  return {
    source_id: record.source_id,
    source_hash: record.content_hash,
    span: {
      encoding: 'utf16',
      start: 0,
      end: record.content.length,
      quote: record.content,
    },
  };
}

export function sourceQuoteReference(
  record: SourceRecord,
  quote: string,
  occurrence = 0,
): SourceReference {
  let start = -1;
  let cursor = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    start = record.content.indexOf(quote, cursor);
    if (start < 0) throw new TypeError(`Quote is absent from ${record.source_id}: ${quote}`);
    cursor = start + quote.length;
  }
  return {
    source_id: record.source_id,
    source_hash: record.content_hash,
    span: { encoding: 'utf16', start, end: start + quote.length, quote },
  };
}

export function partyFact(
  factId: string,
  statement: string,
  partyId: PartyId,
  references: SourceReference[],
): ExpectedUserVisibleFact {
  return {
    fact_id: factId,
    statement,
    basis: 'party_attributed_assertion',
    party_attribution: partyId,
    source_references: references,
  };
}

export function systemFact(factId: string, statement: string): ExpectedUserVisibleFact {
  return {
    fact_id: factId,
    statement,
    basis: 'system_state',
    party_attribution: null,
    source_references: [],
  };
}

export function forbiddenPromotion(
  propositionId: string,
  proposition: string,
  prohibitedPromotion: ForbiddenFactualPromotion['prohibited_promotion'],
  reasonCode: string,
  references: SourceReference[],
): ForbiddenFactualPromotion {
  return {
    proposition_id: propositionId,
    proposition,
    prohibited_promotion: prohibitedPromotion,
    source_references: references,
    reason_code: reasonCode,
  };
}

export function expected(
  session: CanonicalCaseAuthoringSession,
  overrides: Partial<AuthoredTurnExpectation> &
    Pick<
      AuthoredTurnExpectation,
      'disposition' | 'envelope_version_delta' | 'record_version_delta'
    >,
): AuthoredTurnExpectation {
  const envelope = session.context.envelope;
  const invalidatedConfirmationParties =
    overrides.record_version_delta === 1
      ? (['party_a', 'party_b'] as const).filter(
          (partyId) => envelope.formation.confirmations[partyId] !== null,
        )
      : [];
  return {
    disposition: overrides.disposition,
    envelope_version_delta: overrides.envelope_version_delta,
    record_version_delta: overrides.record_version_delta,
    failure_reason: overrides.failure_reason === undefined ? null : overrides.failure_reason,
    workflow_state: overrides.workflow_state ?? envelope.control.workflow_state,
    lock_status: overrides.lock_status ?? envelope.control.lock.status,
    lock_mode: overrides.lock_mode === undefined ? envelope.control.lock.mode : overrides.lock_mode,
    output_scope:
      overrides.output_scope === undefined
        ? envelope.control.lock.output_scope
        : overrides.output_scope,
    authority: overrides.authority ?? [],
    evidence_actions: overrides.evidence_actions ?? [],
    invalidated_confirmation_parties: invalidatedConfirmationParties,
    required_source_references: overrides.required_source_references ?? [],
    next_question_target:
      overrides.next_question_target === undefined ? null : overrides.next_question_target,
    allowed_user_visible_facts: overrides.allowed_user_visible_facts ?? [],
    forbidden_factual_promotions: overrides.forbidden_factual_promotions ?? [],
  };
}

export function applied(
  session: CanonicalCaseAuthoringSession,
  recordVersionDelta: 0 | 1,
  overrides: Partial<AuthoredTurnExpectation> = {},
): AuthoredTurnExpectation {
  return expected(session, {
    disposition: 'applied',
    envelope_version_delta: 1,
    record_version_delta: recordVersionDelta,
    ...overrides,
  });
}

export function rejected(
  session: CanonicalCaseAuthoringSession,
  failureReason: NonNullable<AuthoredTurnExpectation['failure_reason']>,
  overrides: Partial<AuthoredTurnExpectation> = {},
): AuthoredTurnExpectation {
  return expected(session, {
    disposition: 'rejected',
    envelope_version_delta: 0,
    record_version_delta: 0,
    failure_reason: failureReason,
    ...overrides,
  });
}

export function idempotent(
  session: CanonicalCaseAuthoringSession,
  overrides: Partial<AuthoredTurnExpectation> = {},
): AuthoredTurnExpectation {
  return expected(session, {
    disposition: 'idempotent',
    envelope_version_delta: 0,
    record_version_delta: 0,
    ...overrides,
  });
}

export function rehashEnvelope(envelope: CaseEnvelope): CaseEnvelope {
  envelope.control.record_hash = hashCaseRecord(envelope);
  envelope.control.envelope_hash = hashCaseEnvelope(envelope);
  return envelope;
}

export function createBoundEnvelope(
  caseId: string,
  workflowState: CaseEnvelope['control']['workflow_state'] = 'person_a_formation',
): CaseEnvelope {
  const envelope = createInitialCaseEnvelope(caseId);
  envelope.parties.party_a = {
    ...envelope.parties.party_a,
    authenticated_subject_id: 'subject_party_a',
    identity_assurance: 'authenticated',
    identity_event_id: `event_${caseId}_identity_a`,
    consent_status: 'granted',
    consent_event_id: `event_${caseId}_consent_a`,
  };
  envelope.parties.party_b = {
    ...envelope.parties.party_b,
    authenticated_subject_id: 'subject_party_b',
    identity_assurance: 'authenticated',
    identity_event_id: `event_${caseId}_identity_b`,
    consent_status: 'granted',
    consent_event_id: `event_${caseId}_consent_b`,
    participation_state: 'active',
  };
  envelope.control.workflow_state = workflowState;
  return rehashEnvelope(envelope);
}

export function createBilateralReconciliationEnvelope(caseId: string): CaseEnvelope {
  const envelope = createBoundEnvelope(caseId, 'reconciliation');
  envelope.control.eligibility = { status: 'eligible', reason_codes: [] };
  envelope.classification.suitability = 'eligible';
  envelope.classification.maturity = 'ready';
  envelope.classification.required_fact_profile = 'commercial_delivery';
  envelope.formation.disclosure = {
    person_b_independent_account_source_id: `source_${caseId}_party_b_account`,
    detailed_a_framing: 'disclosed',
    disclosure_event_id: `event_${caseId}_disclosure`,
  };
  envelope.formation.open_required_fields = [];
  envelope.formation.lock_blockers = [];
  return rehashEnvelope(envelope);
}

export function partyAuthority(
  session: CanonicalCaseAuthoringSession,
  partyId: PartyId,
  commandId: string,
  references: SourceReference[],
): ObjectAuthority {
  const actor = partyActor(partyId, session.context.envelope);
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
    source_references: references,
    evidence_ids: [],
    party_stances: partyStances,
    resolution_status: deriveResolutionStatus(partyStances),
    adjudication_eligible: true,
    introduced_in_record_version: session.context.envelope.control.record_version + 1,
    last_material_record_version: session.context.envelope.control.record_version + 1,
    last_material_command_id: commandId,
  };
}

export function position(
  session: CanonicalCaseAuthoringSession,
  partyId: PartyId,
  positionId: string,
  commandId: string,
  statement: string,
  references: SourceReference[],
): PositionObject {
  return {
    position_id: positionId,
    party_id: partyId,
    position_kind: 'assertion',
    target: null,
    statement,
    authority: partyAuthority(session, partyId, commandId, references),
  };
}

export function describedEvidence(
  session: CanonicalCaseAuthoringSession,
  partyId: PartyId,
  evidenceId: string,
  commandId: string,
  references: SourceReference[],
  assertedAuthorActorId: string | null = null,
): EvidenceObject {
  return {
    evidence_id: evidenceId,
    submitted_by_party_id: partyId,
    asserted_author_actor_id: assertedAuthorActorId,
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
    authority: partyAuthority(session, partyId, commandId, references),
  };
}

export function classificationAuthority(
  session: CanonicalCaseAuthoringSession,
  commandId: string,
  references: SourceReference[],
): ObjectAuthority {
  const partyStances: ObjectAuthority['party_stances'] = {
    party_a: { stance: 'unresponded', response_event_id: null },
    party_b: { stance: 'unresponded', response_event_id: null },
  };
  return {
    introduced_by: { actor_id: SYSTEM_ACTOR.actor_id, actor_type: 'system' },
    authority_kind: 'system_observation',
    authority_detail: 'Deterministic Gate Zero classification',
    subject_actor_ids: [],
    source_references: references,
    evidence_ids: [],
    party_stances: partyStances,
    resolution_status: deriveResolutionStatus(partyStances),
    adjudication_eligible: false,
    introduced_in_record_version: session.context.envelope.control.record_version + 1,
    last_material_record_version: session.context.envelope.control.record_version + 1,
    last_material_command_id: commandId,
  };
}

export function classificationOperation(
  session: CanonicalCaseAuthoringSession,
  commandId: string,
  references: SourceReference[],
  input: Omit<SetClassificationOperation, 'type' | 'authority'>,
): SetClassificationOperation {
  return {
    type: 'set_classification',
    ...input,
    authority: classificationAuthority(session, commandId, references),
  };
}
