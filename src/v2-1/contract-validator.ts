import { canonicalSerialize } from '../v2/case-envelope.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V21,
  ENVELOPE_COMMAND_VERSION_V21,
  FORMATION_PROTOCOL_VERSION_V21,
  FORMATION_READINESS_VERSION_V21,
  HASH_PATTERN_V21,
  ID_PATTERN_V21,
  PARTY_CONFIRMATION_VERSION_V21,
  PARTY_FORMATION_PROJECTION_VERSION_V21,
  PARTY_FORMATION_READBACK_VERSION_V21,
  PARTY_IDS_V21,
  hashCaseEnvelopeV21,
  hashSourceTurnContentV21,
  type CaseEnvelopeV21,
  type ContractIssue,
  type PartyIdV21,
} from './case-envelope.js';
import { deriveFormationReadinessV21 } from './formation-readiness.js';
import { hashPartyFormationProjectionV21 } from './party-projection.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function isString(value: unknown, maximum = 12_000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isPartyId(value: unknown): value is PartyIdV21 {
  return value === 'party_a' || value === 'party_b';
}

function issue(code: string, path: string, message: string): ContractIssue {
  return { code, path, message };
}

function validateParty(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
  issues: ContractIssue[],
): void {
  const party = envelope.parties?.[partyId];
  const path = `$.parties.${partyId}`;
  if (
    !hasExactKeys(party, [
      'authenticated_subject_id',
      'binding_event_id',
      'edit_state',
      'formation_epoch',
      'identity_assurance',
      'independent_formation_complete',
      'party_id',
      'role',
    ]) ||
    party.party_id !== partyId ||
    party.role !== partyId ||
    !['unbound', 'authenticated'].includes(String(party.identity_assurance)) ||
    !['open', 'confirmed', 'reopened'].includes(String(party.edit_state)) ||
    typeof party.independent_formation_complete !== 'boolean' ||
    !Number.isSafeInteger(party.formation_epoch) ||
    party.formation_epoch < 1
  ) {
    issues.push(issue('party_shape_invalid', path, 'Party binding shape is invalid.'));
    return;
  }
  const unbound = party.identity_assurance === 'unbound';
  if (
    (unbound && (party.authenticated_subject_id !== null || party.binding_event_id !== null)) ||
    (!unbound &&
      (!ID_PATTERN_V21.test(party.authenticated_subject_id ?? '') ||
        !ID_PATTERN_V21.test(party.binding_event_id ?? '')))
  ) {
    issues.push(
      issue(
        'party_identity_binding_invalid',
        path,
        'Party identity is either genuinely unbound or bound to a subject and event.',
      ),
    );
  }
  if (unbound && (party.independent_formation_complete || party.edit_state !== 'open')) {
    issues.push(
      issue(
        'unbound_party_authority_invalid',
        path,
        'An unbound party cannot complete formation or hold confirmation state.',
      ),
    );
  }
}

function validateSourceTurns(envelope: CaseEnvelopeV21, issues: ContractIssue[]): void {
  if (!isRecord(envelope.source_turns)) {
    issues.push(
      issue('source_turns_shape_invalid', '$.source_turns', 'Source turns must be a map.'),
    );
    return;
  }
  for (const [turnId, turn] of Object.entries(envelope.source_turns)) {
    const path = `$.source_turns.${turnId}`;
    if (
      !hasExactKeys(turn, [
        'attributed_party_id',
        'content',
        'content_hash',
        'content_length',
        'redacted_at',
        'turn_id',
      ]) ||
      turn.turn_id !== turnId ||
      !ID_PATTERN_V21.test(turnId) ||
      !isPartyId(turn.attributed_party_id) ||
      !HASH_PATTERN_V21.test(turn.content_hash) ||
      !Number.isSafeInteger(turn.content_length) ||
      turn.content_length < 1 ||
      !isNullableString(turn.content) ||
      !isNullableString(turn.redacted_at)
    ) {
      issues.push(issue('source_turn_shape_invalid', path, 'Source turn shape is invalid.'));
      continue;
    }
    if (
      (turn.content !== null &&
        (turn.redacted_at !== null ||
          turn.content.length !== turn.content_length ||
          hashSourceTurnContentV21(turn.content) !== turn.content_hash)) ||
      (turn.content === null && !turn.redacted_at)
    ) {
      issues.push(
        issue(
          'source_turn_commitment_invalid',
          path,
          'Source payload and durable commitment state disagree.',
        ),
      );
    }
  }
}

function validatePositions(envelope: CaseEnvelopeV21, issues: ContractIssue[]): void {
  if (!isRecord(envelope.positions)) {
    issues.push(issue('positions_shape_invalid', '$.positions', 'Positions must be a map.'));
    return;
  }
  for (const [positionId, position] of Object.entries(envelope.positions)) {
    const path = `$.positions.${positionId}`;
    if (
      !hasExactKeys(position, [
        'attributed_party_id',
        'introduced_envelope_version',
        'last_material_envelope_version',
        'position_id',
        'position_kind',
        'resolution_status',
        'source_span_commitments',
        'source_turn_id',
        'statement',
      ]) ||
      position.position_id !== positionId ||
      !ID_PATTERN_V21.test(positionId) ||
      !isPartyId(position.attributed_party_id) ||
      !['assertion', 'admission', 'denial', 'uncertainty'].includes(position.position_kind) ||
      !['disputed', 'unresolved', 'procedurally_resolved'].includes(position.resolution_status) ||
      !isString(position.statement) ||
      !ID_PATTERN_V21.test(position.source_turn_id) ||
      !Number.isSafeInteger(position.introduced_envelope_version) ||
      !Number.isSafeInteger(position.last_material_envelope_version) ||
      position.introduced_envelope_version < 1 ||
      position.last_material_envelope_version < position.introduced_envelope_version ||
      position.last_material_envelope_version > envelope.control.envelope_version ||
      !Array.isArray(position.source_span_commitments)
    ) {
      issues.push(issue('position_shape_invalid', path, 'Canonical position shape is invalid.'));
      continue;
    }
    const sourceTurn = envelope.source_turns[position.source_turn_id];
    if (!sourceTurn || sourceTurn.attributed_party_id !== position.attributed_party_id) {
      issues.push(
        issue(
          'position_party_attribution_invalid',
          `${path}.attributed_party_id`,
          'Position attribution is canonical and must agree with its stamped source commitment.',
        ),
      );
    }
    for (const [index, span] of position.source_span_commitments.entries()) {
      if (
        !hasExactKeys(span, ['end', 'quote_hash', 'start']) ||
        !Number.isSafeInteger(span.start) ||
        !Number.isSafeInteger(span.end) ||
        span.start < 0 ||
        span.end <= span.start ||
        span.end > (sourceTurn?.content_length ?? -1) ||
        !HASH_PATTERN_V21.test(span.quote_hash) ||
        (sourceTurn?.content !== null &&
          sourceTurn?.content !== undefined &&
          hashSourceTurnContentV21(sourceTurn.content.slice(span.start, span.end)) !==
            span.quote_hash)
      ) {
        issues.push(
          issue(
            'position_source_span_commitment_invalid',
            `${path}.source_span_commitments[${index}]`,
            'Source span commitments require valid bounds and hashes.',
          ),
        );
      }
    }
  }
}

function validateFormationMaps(envelope: CaseEnvelopeV21, issues: ContractIssue[]): void {
  if (!isRecord(envelope.requirements)) {
    issues.push(
      issue('requirements_shape_invalid', '$.requirements', 'Requirements must be a map.'),
    );
  } else {
    for (const [id, requirement] of Object.entries(envelope.requirements)) {
      if (
        !hasExactKeys(requirement, [
          'label',
          'party_id',
          'required',
          'requirement_id',
          'response_summary',
          'status',
        ]) ||
        requirement.requirement_id !== id ||
        !ID_PATTERN_V21.test(id) ||
        !isPartyId(requirement.party_id) ||
        !isString(requirement.label, 1_000) ||
        typeof requirement.required !== 'boolean' ||
        !['open', 'resolved', 'declined'].includes(requirement.status) ||
        !isNullableString(requirement.response_summary)
      ) {
        issues.push(
          issue(
            'requirement_shape_invalid',
            `$.requirements.${id}`,
            'Requirement shape is invalid.',
          ),
        );
      }
    }
  }
  if (!isRecord(envelope.clarifications)) {
    issues.push(
      issue('clarifications_shape_invalid', '$.clarifications', 'Clarifications must be a map.'),
    );
  } else {
    for (const [id, clarification] of Object.entries(envelope.clarifications)) {
      if (
        !hasExactKeys(clarification, [
          'answer',
          'clarification_id',
          'party_id',
          'question',
          'status',
        ]) ||
        clarification.clarification_id !== id ||
        !ID_PATTERN_V21.test(id) ||
        !isPartyId(clarification.party_id) ||
        !isString(clarification.question, 4_000) ||
        !isString(clarification.answer, 12_000) ||
        !['open', 'resolved'].includes(clarification.status)
      ) {
        issues.push(
          issue(
            'clarification_shape_invalid',
            `$.clarifications.${id}`,
            'Clarification shape is invalid.',
          ),
        );
      }
    }
  }
  if (!isRecord(envelope.evidence)) {
    issues.push(issue('evidence_shape_invalid', '$.evidence', 'Evidence must be a map.'));
  } else {
    for (const [id, evidence] of Object.entries(envelope.evidence)) {
      if (
        !hasExactKeys(evidence, [
          'attributed_party_id',
          'description',
          'eligibility',
          'evidence_id',
          'required_for_readiness',
        ]) ||
        evidence.evidence_id !== id ||
        !ID_PATTERN_V21.test(id) ||
        !isPartyId(evidence.attributed_party_id) ||
        !isString(evidence.description, 4_000) ||
        typeof evidence.required_for_readiness !== 'boolean' ||
        !['pending', 'eligible', 'ineligible', 'not_required'].includes(evidence.eligibility)
      ) {
        issues.push(
          issue('evidence_shape_invalid', `$.evidence.${id}`, 'Evidence shape is invalid.'),
        );
      }
    }
  }
  if (!isRecord(envelope.challenges)) {
    issues.push(issue('challenges_shape_invalid', '$.challenges', 'Challenges must be a map.'));
  } else {
    for (const [id, challenge] of Object.entries(envelope.challenges)) {
      if (
        !hasExactKeys(challenge, [
          'challenge_id',
          'challenging_party_id',
          'response_party_id',
          'response_statement',
          'statement',
          'status',
          'target_party_id',
          'target_position_id',
        ]) ||
        challenge.challenge_id !== id ||
        !ID_PATTERN_V21.test(id) ||
        !isPartyId(challenge.challenging_party_id) ||
        !isPartyId(challenge.target_party_id) ||
        challenge.challenging_party_id === challenge.target_party_id ||
        !ID_PATTERN_V21.test(challenge.target_position_id) ||
        !isString(challenge.statement, 4_000) ||
        !['open', 'resolved', 'withdrawn'].includes(challenge.status) ||
        !isNullableString(challenge.response_statement) ||
        !(challenge.response_party_id === null || isPartyId(challenge.response_party_id))
      ) {
        issues.push(
          issue('challenge_shape_invalid', `$.challenges.${id}`, 'Challenge shape is invalid.'),
        );
        continue;
      }
      const target = envelope.positions[challenge.target_position_id];
      if (
        target &&
        (target.attributed_party_id !== challenge.target_party_id ||
          (challenge.response_party_id !== null &&
            challenge.response_party_id !== challenge.target_party_id))
      ) {
        issues.push(
          issue(
            'challenge_party_attribution_invalid',
            `$.challenges.${id}`,
            'Challenge target and response attribution must agree with canonical position ownership.',
          ),
        );
      } else if (!target) {
        issues.push(
          issue(
            'challenge_target_missing',
            `$.challenges.${id}.target_position_id`,
            'Challenge target must be a canonical position.',
          ),
        );
      }
      if (
        (challenge.status === 'open' &&
          (challenge.response_statement !== null || challenge.response_party_id !== null)) ||
        (challenge.status === 'resolved' &&
          (!isString(challenge.response_statement, 12_000) ||
            challenge.response_party_id !== challenge.target_party_id))
      ) {
        issues.push(
          issue(
            'challenge_resolution_invalid',
            `$.challenges.${id}`,
            'Challenge response fields must match the procedural status.',
          ),
        );
      }
    }
  }
}

function validateFormation(envelope: CaseEnvelopeV21, issues: ContractIssue[]): void {
  if (
    !hasExactKeys(envelope.formation, ['confirmations', 'explanatory', 'reopen_events']) ||
    !hasExactKeys(envelope.formation?.confirmations, ['party_a', 'party_b']) ||
    !hasExactKeys(envelope.formation?.explanatory, [
      'lock_blockers',
      'lock_prerequisites',
      'open_required_fields',
    ]) ||
    !isStringArray(envelope.formation?.explanatory?.open_required_fields) ||
    !isStringArray(envelope.formation?.explanatory?.lock_prerequisites) ||
    !isStringArray(envelope.formation?.explanatory?.lock_blockers)
  ) {
    issues.push(issue('formation_shape_invalid', '$.formation', 'Formation shape is invalid.'));
    return;
  }
  if (!Array.isArray(envelope.formation.reopen_events)) {
    issues.push(
      issue(
        'reopen_history_invalid',
        '$.formation.reopen_events',
        'Reopen history must be an array.',
      ),
    );
  } else {
    const eventIds = new Set<string>();
    for (const [index, event] of envelope.formation.reopen_events.entries()) {
      const path = `$.formation.reopen_events[${index}]`;
      if (!isRecord(event)) {
        issues.push(issue('reopen_event_invalid', path, 'Reopen event is invalid.'));
        continue;
      }
      if (
        !hasExactKeys(event, [
          'authenticated_subject_id',
          'event_id',
          'occurred_at',
          'party_id',
          'prior_formation_epoch',
          'reason',
          'resulting_formation_epoch',
        ]) ||
        !ID_PATTERN_V21.test(event.event_id) ||
        eventIds.has(event.event_id) ||
        !isPartyId(event.party_id) ||
        event.authenticated_subject_id !==
          envelope.parties[event.party_id]?.authenticated_subject_id ||
        !Number.isSafeInteger(event.prior_formation_epoch) ||
        event.prior_formation_epoch < 1 ||
        event.resulting_formation_epoch !== event.prior_formation_epoch + 1 ||
        !isString(event.reason, 4_000) ||
        Number.isNaN(Date.parse(event.occurred_at))
      ) {
        issues.push(issue('reopen_event_invalid', path, 'Reopen event is invalid.'));
      }
      if (typeof event.event_id === 'string') eventIds.add(event.event_id);
    }
  }
  const receiptIds = new Set<string>();
  const receiptEventIds = new Set<string>();
  for (const partyId of PARTY_IDS_V21) {
    const receipts = envelope.formation.confirmations[partyId];
    if (!Array.isArray(receipts)) {
      issues.push(
        issue(
          'confirmation_history_invalid',
          `$.formation.confirmations.${partyId}`,
          'Confirmation history must be an array.',
        ),
      );
      continue;
    }
    for (const [index, receipt] of receipts.entries()) {
      const path = `$.formation.confirmations.${partyId}[${index}]`;
      if (!isRecord(receipt)) {
        issues.push(
          issue('confirmation_receipt_invalid', path, 'Confirmation receipt is invalid.'),
        );
        continue;
      }
      if (
        !hasExactKeys(receipt, [
          'adoption_statement_hash',
          'authenticated_subject_id',
          'confirmation_id',
          'confirmation_version',
          'confirmed_at',
          'event_id',
          'formation_epoch',
          'party_id',
          'party_projection_hash',
          'party_projection_version',
          'party_readback_hash',
          'party_readback_version',
          'party_visible_version',
          'shared_envelope_hash',
          'shared_envelope_version',
        ]) ||
        receipt.confirmation_version !== PARTY_CONFIRMATION_VERSION_V21 ||
        receipt.party_id !== partyId ||
        receipt.authenticated_subject_id !== envelope.parties[partyId].authenticated_subject_id ||
        receipt.party_projection_version !== PARTY_FORMATION_PROJECTION_VERSION_V21 ||
        receipt.party_readback_version !== PARTY_FORMATION_READBACK_VERSION_V21 ||
        !ID_PATTERN_V21.test(receipt.confirmation_id) ||
        !ID_PATTERN_V21.test(receipt.event_id) ||
        receiptIds.has(receipt.confirmation_id) ||
        receiptEventIds.has(receipt.event_id) ||
        !HASH_PATTERN_V21.test(receipt.party_projection_hash) ||
        !HASH_PATTERN_V21.test(receipt.party_readback_hash) ||
        !HASH_PATTERN_V21.test(receipt.adoption_statement_hash) ||
        !HASH_PATTERN_V21.test(receipt.shared_envelope_hash) ||
        !Number.isSafeInteger(receipt.party_visible_version) ||
        receipt.party_visible_version < 1 ||
        !Number.isSafeInteger(receipt.formation_epoch) ||
        receipt.formation_epoch < 1 ||
        !Number.isSafeInteger(receipt.shared_envelope_version) ||
        receipt.shared_envelope_version < 1 ||
        Number.isNaN(Date.parse(receipt.confirmed_at))
      ) {
        issues.push(
          issue('confirmation_receipt_invalid', path, 'Confirmation receipt is invalid.'),
        );
      }
      if (typeof receipt.confirmation_id === 'string') receiptIds.add(receipt.confirmation_id);
      if (typeof receipt.event_id === 'string') receiptEventIds.add(receipt.event_id);
    }
    const party = envelope.parties[partyId];
    if (party.edit_state === 'confirmed' && receipts.length === 0) {
      issues.push(
        issue(
          'confirmed_party_receipt_missing',
          `$.parties.${partyId}.edit_state`,
          'Confirmed edit state requires a party-scoped confirmation receipt.',
        ),
      );
    }
  }
}

export function validateCaseEnvelopeV21(value: unknown): ContractIssue[] {
  try {
    canonicalSerialize(value);
  } catch (error) {
    return [
      issue(
        'envelope_not_plain_json',
        '$',
        error instanceof Error ? error.message : 'Envelope is not plain JSON.',
      ),
    ];
  }
  if (
    !hasExactKeys(value, [
      'challenges',
      'clarifications',
      'control',
      'evidence',
      'formation',
      'parties',
      'positions',
      'requirements',
      'source_turns',
    ])
  ) {
    return [
      issue(
        'envelope_keys_invalid',
        '$',
        'V2.1 Case Envelope requires exactly the closed formation namespaces.',
      ),
    ];
  }
  const envelope = value as unknown as CaseEnvelopeV21;
  const issues: ContractIssue[] = [];
  if (
    !hasExactKeys(envelope.control, [
      'case_id',
      'command_contract_version',
      'disclosure_state',
      'envelope_hash',
      'envelope_version',
      'party_views',
      'projection_contract_version',
      'protocol_version',
      'readiness_contract_version',
      'schema_version',
      'workflow_state',
    ]) ||
    envelope.control.schema_version !== CASE_ENVELOPE_SCHEMA_VERSION_V21 ||
    envelope.control.protocol_version !== FORMATION_PROTOCOL_VERSION_V21 ||
    envelope.control.command_contract_version !== ENVELOPE_COMMAND_VERSION_V21 ||
    envelope.control.projection_contract_version !== PARTY_FORMATION_PROJECTION_VERSION_V21 ||
    envelope.control.readiness_contract_version !== FORMATION_READINESS_VERSION_V21 ||
    !ID_PATTERN_V21.test(envelope.control.case_id) ||
    ![
      'independent_formation',
      'challenge_response',
      'final_confirmation',
      'ready_for_lock',
    ].includes(envelope.control.workflow_state) ||
    !['embargoed', 'disclosed'].includes(envelope.control.disclosure_state) ||
    !Number.isSafeInteger(envelope.control.envelope_version) ||
    envelope.control.envelope_version < 1 ||
    !HASH_PATTERN_V21.test(envelope.control.envelope_hash) ||
    !hasExactKeys(envelope.control.party_views, ['party_a', 'party_b'])
  ) {
    issues.push(issue('control_shape_invalid', '$.control', 'V2.1 control shape is invalid.'));
  }
  if (issues.length > 0) return issues;
  if (!hasExactKeys(envelope.parties, ['party_a', 'party_b'])) {
    issues.push(issue('parties_shape_invalid', '$.parties', 'Both party slots are required.'));
  } else {
    for (const partyId of PARTY_IDS_V21) validateParty(envelope, partyId, issues);
  }
  if (
    envelope.parties?.party_a?.authenticated_subject_id !== null &&
    envelope.parties?.party_b?.authenticated_subject_id !== null &&
    envelope.parties.party_a.authenticated_subject_id ===
      envelope.parties.party_b.authenticated_subject_id
  ) {
    issues.push(
      issue(
        'duplicate_authenticated_subject',
        '$.parties',
        'One authenticated subject cannot occupy both V2.1 party slots.',
      ),
    );
  }
  if (issues.length > 0) return issues;
  validateSourceTurns(envelope, issues);
  if (issues.length > 0) return issues;
  validatePositions(envelope, issues);
  if (issues.length > 0) return issues;
  validateFormationMaps(envelope, issues);
  if (issues.length > 0) return issues;
  validateFormation(envelope, issues);
  if (issues.length > 0) return issues;
  if (issues.length === 0) {
    for (const partyId of PARTY_IDS_V21) {
      const cursor = envelope.control.party_views[partyId];
      if (
        !hasExactKeys(cursor, ['party_projection_hash', 'party_visible_version']) ||
        !Number.isSafeInteger(cursor.party_visible_version) ||
        cursor.party_visible_version < 1 ||
        cursor.party_projection_hash !== hashPartyFormationProjectionV21(envelope, partyId)
      ) {
        issues.push(
          issue(
            'party_view_cursor_invalid',
            `$.control.party_views.${partyId}`,
            'Party-visible version/hash must match the current party-safe projection.',
          ),
        );
      }
    }
    const readiness = deriveFormationReadinessV21(envelope);
    if (
      envelope.control.workflow_state === 'ready_for_lock' &&
      !readiness.ready_for_bilateral_lock
    ) {
      issues.push(
        issue(
          'ready_for_lock_state_invalid',
          '$.control.workflow_state',
          'ready_for_lock requires current authoritative derived readiness.',
        ),
      );
    }
    if (readiness.explanatory_consistency_issues.length > 0) {
      issues.push(
        issue(
          'readiness_explanatory_projection_mismatch',
          '$.formation.explanatory',
          readiness.explanatory_consistency_issues.join(', '),
        ),
      );
    }
    if (envelope.control.envelope_hash !== hashCaseEnvelopeV21(envelope)) {
      issues.push(
        issue(
          'envelope_hash_invalid',
          '$.control.envelope_hash',
          'Envelope hash must match the complete canonical V2.1 state.',
        ),
      );
    }
  }
  return issues;
}

export function assertValidCaseEnvelopeV21(envelope: CaseEnvelopeV21): void {
  const issues = validateCaseEnvelopeV21(envelope);
  if (issues.length > 0) {
    throw new TypeError(`${issues[0]!.code}: ${issues[0]!.message}`);
  }
}
