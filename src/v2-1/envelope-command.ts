import { canonicalSerialize, cloneCanonical, sha256 } from '../v2/case-envelope.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V21,
  ENVELOPE_COMMAND_VERSION_V21,
  FORMATION_PROTOCOL_VERSION_V21,
  FORMATION_READINESS_VERSION_V21,
  ID_PATTERN_V21,
  PARTY_CONFIRMATION_VERSION_V21,
  PARTY_FORMATION_PROJECTION_VERSION_V21,
  PARTY_FORMATION_READBACK_VERSION_V21,
  PARTY_IDS_V21,
  PARTY_MUTATION_INTENT_VERSION_V21,
  cloneCaseEnvelopeV21,
  hashAdoptionStatementV21,
  hashCaseEnvelopeV21,
  hashSourceTurnContentV21,
  isTrustedSystemAuthorityV21,
  otherPartyV21,
  type AuthenticatedPartyAuthorityV21,
  type CaseEnvelopeV21,
  type ExecutionAuthorityV21,
  type FormationRequirementV21,
  type PartyIdV21,
  type PartyInteractionAuthorityV21,
  type WorkflowStateV21,
} from './case-envelope.js';
import { assertValidCaseEnvelopeV21, validateCaseEnvelopeV21 } from './contract-validator.js';
import {
  authoritativeFormationExplanatoryStateV21,
  deriveFormationReadinessV21,
} from './formation-readiness.js';
import {
  currentPartyConfirmationV21,
  hashPartyFormationProjectionV21,
  renderPartyFormationReadbackV21,
} from './party-projection.js';

export interface SourceSpanInputV21 {
  start: number;
  end: number;
  quote: string;
}

export interface SourceTurnInputV21 {
  turn_id: string;
  content: string;
  spans: SourceSpanInputV21[];
}

export interface RecordOwnPositionOperationV21 {
  type: 'record_own_position';
  position_id: string;
  position_kind: 'assertion' | 'admission' | 'denial' | 'uncertainty';
  statement: string;
  resolution_status: 'disputed' | 'unresolved' | 'procedurally_resolved';
  source_turn: SourceTurnInputV21;
}

export interface ReplaceOwnPositionOperationV21 {
  type: 'replace_own_position';
  position_id: string;
  expected_statement: string;
  replacement_statement: string;
  source_turn: SourceTurnInputV21;
}

export interface ResolveOwnRequirementOperationV21 {
  type: 'resolve_own_requirement';
  requirement_id: string;
  resolution: 'resolved' | 'declined';
  response_summary: string;
}

export interface RecordOwnClarificationOperationV21 {
  type: 'record_own_clarification';
  clarification_id: string;
  question: string;
  answer: string;
}

export interface RecordOwnEvidenceReferenceOperationV21 {
  type: 'record_own_evidence_reference';
  evidence_id: string;
  description: string;
  required_for_readiness: boolean;
}

export interface MarkOwnIndependentFormationCompleteOperationV21 {
  type: 'mark_own_independent_formation_complete';
}

export interface RecordChallengeOperationV21 {
  type: 'record_challenge';
  challenge_id: string;
  target_position_id: string;
  statement: string;
}

export interface RespondToChallengeOperationV21 {
  type: 'respond_to_challenge';
  challenge_id: string;
  response_statement: string;
  replacement_statement: string | null;
  source_turn: SourceTurnInputV21 | null;
}

export interface RecordPartyConfirmationOperationV21 {
  type: 'record_party_confirmation';
  confirmation_id: string;
  adoption_statement: string;
  confirmed_at: string;
  event_id: string;
}

export interface ReopenOwnFormationOperationV21 {
  type: 'reopen_own_formation';
  event_id: string;
  reason: string;
  occurred_at: string;
}

export interface BindPartyOperationV21 {
  type: 'bind_party';
  party_slot: PartyIdV21;
  authenticated_subject_id: string;
  binding_event_id: string;
}

export interface RedactSourceTurnOperationV21 {
  type: 'redact_source_turn';
  turn_id: string;
  redacted_at: string;
}

export interface SetEvidenceEligibilityOperationV21 {
  type: 'set_evidence_eligibility';
  evidence_id: string;
  eligibility: 'eligible' | 'ineligible' | 'not_required';
}

export interface OpenControlledDisclosureOperationV21 {
  type: 'open_controlled_disclosure';
}

export interface EnterFinalConfirmationOperationV21 {
  type: 'enter_final_confirmation';
}

export interface MarkReadyForLockOperationV21 {
  type: 'mark_ready_for_lock';
}

export type EnvelopeOperationV21 =
  | RecordOwnPositionOperationV21
  | ReplaceOwnPositionOperationV21
  | ResolveOwnRequirementOperationV21
  | RecordOwnClarificationOperationV21
  | RecordOwnEvidenceReferenceOperationV21
  | MarkOwnIndependentFormationCompleteOperationV21
  | RecordChallengeOperationV21
  | RespondToChallengeOperationV21
  | RecordPartyConfirmationOperationV21
  | ReopenOwnFormationOperationV21
  | BindPartyOperationV21
  | RedactSourceTurnOperationV21
  | SetEvidenceEligibilityOperationV21
  | OpenControlledDisclosureOperationV21
  | EnterFinalConfirmationOperationV21
  | MarkReadyForLockOperationV21;

export const ENVELOPE_OPERATION_TYPES_V21 = Object.freeze([
  'record_own_position',
  'replace_own_position',
  'resolve_own_requirement',
  'record_own_clarification',
  'record_own_evidence_reference',
  'mark_own_independent_formation_complete',
  'record_challenge',
  'respond_to_challenge',
  'record_party_confirmation',
  'reopen_own_formation',
  'bind_party',
  'redact_source_turn',
  'set_evidence_eligibility',
  'open_controlled_disclosure',
  'enter_final_confirmation',
  'mark_ready_for_lock',
] as const satisfies readonly EnvelopeOperationV21['type'][]);

export type EnvelopeOperationTypeV21 = (typeof ENVELOPE_OPERATION_TYPES_V21)[number];

export type OperationTargetResolutionV21 =
  | 'stamp_actor_party_on_new_position'
  | 'existing_position_attributed_to_actor'
  | 'requirement_owned_by_actor'
  | 'stamp_actor_party_on_new_clarification'
  | 'stamp_actor_party_on_new_evidence'
  | 'actor_party_formation_state'
  | 'disclosed_opponent_position'
  | 'challenge_target_owned_by_actor'
  | 'actor_party_projection_confirmation'
  | 'actor_party_explicit_reopen'
  | 'trusted_system_party_binding'
  | 'trusted_system_source_turn'
  | 'trusted_system_evidence'
  | 'trusted_system_disclosure'
  | 'trusted_system_workflow_transition'
  | 'trusted_system_readiness_transition';

export interface OperationAuthorizationPolicyV21 {
  allowed_actor_types: readonly ('party' | 'system')[];
  allowed_party_authorities: readonly PartyInteractionAuthorityV21[];
  allowed_workflow_states: readonly WorkflowStateV21[];
  target_resolution: OperationTargetResolutionV21;
  affects_own_material_only: boolean;
  system_required: boolean;
  first_party_human_required: boolean;
  party_mutating: boolean;
  material_change: boolean;
  allowed_when_confirmed: boolean;
}

const PARTY_EDIT_STATES: readonly WorkflowStateV21[] = [
  'independent_formation',
  'challenge_response',
];
const ALL_STATES: readonly WorkflowStateV21[] = [
  'independent_formation',
  'challenge_response',
  'final_confirmation',
  'ready_for_lock',
];
const RELAY_OR_HUMAN: readonly PartyInteractionAuthorityV21[] = [
  'external_relay',
  'first_party_human',
];

function partyPolicy(
  target_resolution: OperationTargetResolutionV21,
  options: Partial<OperationAuthorizationPolicyV21> = {},
): OperationAuthorizationPolicyV21 {
  return {
    allowed_actor_types: ['party'],
    allowed_party_authorities: RELAY_OR_HUMAN,
    allowed_workflow_states: PARTY_EDIT_STATES,
    target_resolution,
    affects_own_material_only: true,
    system_required: false,
    first_party_human_required: false,
    party_mutating: true,
    material_change: true,
    allowed_when_confirmed: false,
    ...options,
  };
}

function systemPolicy(
  target_resolution: OperationTargetResolutionV21,
  states: readonly WorkflowStateV21[],
): OperationAuthorizationPolicyV21 {
  return {
    allowed_actor_types: ['system'],
    allowed_party_authorities: [],
    allowed_workflow_states: states,
    target_resolution,
    affects_own_material_only: false,
    system_required: true,
    first_party_human_required: false,
    party_mutating: false,
    material_change: false,
    allowed_when_confirmed: true,
  };
}

export const OPERATION_AUTHORIZATION_POLICIES_V21 = Object.freeze({
  record_own_position: partyPolicy('stamp_actor_party_on_new_position'),
  replace_own_position: partyPolicy('existing_position_attributed_to_actor'),
  resolve_own_requirement: partyPolicy('requirement_owned_by_actor'),
  record_own_clarification: partyPolicy('stamp_actor_party_on_new_clarification'),
  record_own_evidence_reference: partyPolicy('stamp_actor_party_on_new_evidence'),
  mark_own_independent_formation_complete: partyPolicy('actor_party_formation_state'),
  record_challenge: partyPolicy('disclosed_opponent_position', {
    allowed_workflow_states: ['challenge_response', 'final_confirmation'],
    material_change: false,
    allowed_when_confirmed: true,
  }),
  respond_to_challenge: partyPolicy('challenge_target_owned_by_actor', {
    allowed_workflow_states: ['challenge_response', 'final_confirmation'],
    material_change: false,
    allowed_when_confirmed: true,
  }),
  record_party_confirmation: partyPolicy('actor_party_projection_confirmation', {
    allowed_workflow_states: ['independent_formation', 'challenge_response', 'final_confirmation'],
    allowed_party_authorities: ['first_party_human'],
    affects_own_material_only: false,
    first_party_human_required: true,
    material_change: false,
    allowed_when_confirmed: true,
  }),
  reopen_own_formation: partyPolicy('actor_party_explicit_reopen', {
    allowed_workflow_states: ALL_STATES,
    allowed_party_authorities: ['first_party_human'],
    affects_own_material_only: false,
    first_party_human_required: true,
    material_change: false,
    allowed_when_confirmed: true,
  }),
  bind_party: systemPolicy('trusted_system_party_binding', ['independent_formation']),
  redact_source_turn: systemPolicy('trusted_system_source_turn', ALL_STATES),
  set_evidence_eligibility: systemPolicy('trusted_system_evidence', ALL_STATES),
  open_controlled_disclosure: systemPolicy('trusted_system_disclosure', ['independent_formation']),
  enter_final_confirmation: systemPolicy('trusted_system_workflow_transition', [
    'challenge_response',
  ]),
  mark_ready_for_lock: systemPolicy('trusted_system_readiness_transition', ['final_confirmation']),
}) satisfies Readonly<Record<EnvelopeOperationTypeV21, OperationAuthorizationPolicyV21>>;

export interface EnvelopeCommandV21 {
  command_version: typeof ENVELOPE_COMMAND_VERSION_V21;
  command_id: string;
  case_id: string;
  base_envelope_version: number;
  base_envelope_hash: string;
  operation: EnvelopeOperationV21;
}

/**
 * Request-facing semantic precondition. It contains no shared envelope version
 * or hash and no party/role field. A trusted adapter stamps internal CAS from
 * its latest authoritative envelope only after resolving party authority.
 */
export interface PartyMutationIntentV21 {
  intent_version: typeof PARTY_MUTATION_INTENT_VERSION_V21;
  command_id: string;
  expected_party_visible_version: number;
  expected_party_projection_hash: string;
  operation: EnvelopeOperationV21;
}

/** Internal adapter result; never serialize the prepared command to a party. */
export type PrepareInternalPartyEnvelopeCommandResultV21 =
  | { status: 'prepared'; command: EnvelopeCommandV21 }
  | {
      status: 'rejected';
      reason_code: 'invalid_party_intent' | 'unauthorized_actor' | 'party_projection_stale';
      message: string;
    };

export type CommandFailureReasonV21 =
  | 'invalid_command'
  | 'invalid_envelope'
  | 'case_mismatch'
  | 'stale_base_version'
  | 'stale_base_hash'
  | 'unauthorized_actor'
  | 'operation_not_permitted_in_state'
  | 'cross_party_mutation'
  | 'explicit_reopen_required'
  | 'invalid_operation'
  | 'confirmation_binding_invalid'
  | 'disclosure_prerequisite_failed'
  | 'readiness_blocked'
  | 'resulting_envelope_invalid';

/** Internal domain result. A relay adapter must return only a party-safe projection. */
export interface ApplyEnvelopeCommandResultV21 {
  status: 'applied' | 'rejected';
  reason_code: CommandFailureReasonV21 | null;
  message: string;
  envelope: CaseEnvelopeV21;
  prior_envelope_version: number;
  resulting_envelope_version: number;
  changed_visible_parties: PartyIdV21[];
}

export interface ApplyEnvelopeCommandInputV21 {
  envelope: CaseEnvelopeV21;
  command: EnvelopeCommandV21;
  execution_authority: ExecutionAuthorityV21;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

const OPERATION_KEYS: Readonly<Record<EnvelopeOperationTypeV21, readonly string[]>> = {
  record_own_position: [
    'position_id',
    'position_kind',
    'resolution_status',
    'source_turn',
    'statement',
    'type',
  ],
  replace_own_position: [
    'expected_statement',
    'position_id',
    'replacement_statement',
    'source_turn',
    'type',
  ],
  resolve_own_requirement: ['requirement_id', 'resolution', 'response_summary', 'type'],
  record_own_clarification: ['answer', 'clarification_id', 'question', 'type'],
  record_own_evidence_reference: ['description', 'evidence_id', 'required_for_readiness', 'type'],
  mark_own_independent_formation_complete: ['type'],
  record_challenge: ['challenge_id', 'statement', 'target_position_id', 'type'],
  respond_to_challenge: [
    'challenge_id',
    'replacement_statement',
    'response_statement',
    'source_turn',
    'type',
  ],
  record_party_confirmation: [
    'adoption_statement',
    'confirmation_id',
    'confirmed_at',
    'event_id',
    'type',
  ],
  reopen_own_formation: ['event_id', 'occurred_at', 'reason', 'type'],
  bind_party: ['authenticated_subject_id', 'binding_event_id', 'party_slot', 'type'],
  redact_source_turn: ['redacted_at', 'turn_id', 'type'],
  set_evidence_eligibility: ['eligibility', 'evidence_id', 'type'],
  open_controlled_disclosure: ['type'],
  enter_final_confirmation: ['type'],
  mark_ready_for_lock: ['type'],
};

function validText(value: unknown, maximum = 12_000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function sourceTurnInputFailure(source: unknown): string | null {
  if (
    !hasExactKeys(source, ['content', 'spans', 'turn_id']) ||
    !ID_PATTERN_V21.test(String(source.turn_id)) ||
    !validText(source.content) ||
    !Array.isArray(source.spans) ||
    source.spans.length === 0
  ) {
    return 'Source turn input is invalid.';
  }
  for (const span of source.spans) {
    if (
      !hasExactKeys(span, ['end', 'quote', 'start']) ||
      typeof span.start !== 'number' ||
      typeof span.end !== 'number' ||
      !Number.isSafeInteger(span.start) ||
      !Number.isSafeInteger(span.end) ||
      span.start < 0 ||
      span.end <= span.start ||
      span.end > source.content.length ||
      typeof span.quote !== 'string' ||
      source.content.slice(span.start, span.end) !== span.quote
    ) {
      return 'Source span must exactly match the supplied turn text.';
    }
  }
  return null;
}

function operationStructureFailure(operation: unknown): string | null {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    return 'Operation must be an object.';
  }
  const type = (operation as { type?: unknown }).type;
  if (typeof type !== 'string' || !ENVELOPE_OPERATION_TYPES_V21.includes(type as never)) {
    return 'Operation type is unsupported.';
  }
  const typed = operation as EnvelopeOperationV21;
  if (!hasExactKeys(typed, OPERATION_KEYS[typed.type])) {
    return 'Operation contains missing or caller-steerable fields.';
  }
  const identifiers = Object.entries(typed)
    .filter(([key]) => key.endsWith('_id') || key === 'party_slot')
    .map(([, value]) => value);
  if (
    identifiers.some(
      (identifier) => typeof identifier !== 'string' || !ID_PATTERN_V21.test(identifier),
    )
  ) {
    return 'Operation identifier is invalid.';
  }
  if ('source_turn' in typed && typed.source_turn !== null) {
    const failure = sourceTurnInputFailure(typed.source_turn);
    if (failure) return failure;
  }
  const textFields = [
    'statement',
    'expected_statement',
    'replacement_statement',
    'response_summary',
    'question',
    'answer',
    'description',
    'response_statement',
    'adoption_statement',
    'reason',
  ] as const;
  for (const field of textFields) {
    if (field in typed && typed[field] !== null && !validText(typed[field])) {
      return `Operation ${field} is invalid.`;
    }
  }
  const timestampFields = ['confirmed_at', 'occurred_at', 'redacted_at'] as const;
  for (const field of timestampFields) {
    if (field in typed && Number.isNaN(Date.parse(String(typed[field])))) {
      return `Operation ${field} is invalid.`;
    }
  }
  if (
    typed.type === 'record_own_position' &&
    (!['assertion', 'admission', 'denial', 'uncertainty'].includes(typed.position_kind) ||
      !['disputed', 'unresolved', 'procedurally_resolved'].includes(typed.resolution_status))
  ) {
    return 'Position kind or resolution status is invalid.';
  }
  if (
    typed.type === 'resolve_own_requirement' &&
    !['resolved', 'declined'].includes(typed.resolution)
  ) {
    return 'Requirement resolution is invalid.';
  }
  if (
    typed.type === 'record_own_evidence_reference' &&
    typeof typed.required_for_readiness !== 'boolean'
  ) {
    return 'Evidence readiness requirement must be boolean.';
  }
  if (
    typed.type === 'set_evidence_eligibility' &&
    !['eligible', 'ineligible', 'not_required'].includes(typed.eligibility)
  ) {
    return 'Evidence eligibility is invalid.';
  }
  if (
    typed.type === 'respond_to_challenge' &&
    (typed.replacement_statement === null) !== (typed.source_turn === null)
  ) {
    return 'A material challenge response requires a matching source turn.';
  }
  return null;
}

function commandStructureFailure(command: unknown): string | null {
  if (
    !hasExactKeys(command, [
      'base_envelope_hash',
      'base_envelope_version',
      'case_id',
      'command_id',
      'command_version',
      'operation',
    ]) ||
    command.command_version !== ENVELOPE_COMMAND_VERSION_V21 ||
    !ID_PATTERN_V21.test(String(command.command_id)) ||
    !ID_PATTERN_V21.test(String(command.case_id)) ||
    typeof command.base_envelope_version !== 'number' ||
    !Number.isSafeInteger(command.base_envelope_version) ||
    command.base_envelope_version < 1 ||
    !/^[a-f0-9]{64}$/u.test(String(command.base_envelope_hash))
  ) {
    return 'Command shape or version is invalid.';
  }
  return operationStructureFailure(command.operation);
}

function asPartyAuthority(authority: ExecutionAuthorityV21): AuthenticatedPartyAuthorityV21 | null {
  if (
    !hasExactKeys(authority, [
      'actor_type',
      'authenticated_subject_id',
      'interaction_authority',
      'party_id',
    ]) ||
    authority.actor_type !== 'party' ||
    !PARTY_IDS_V21.includes(authority.party_id as PartyIdV21) ||
    !ID_PATTERN_V21.test(String(authority.authenticated_subject_id)) ||
    !['external_relay', 'first_party_human'].includes(String(authority.interaction_authority))
  ) {
    return null;
  }
  return authority as unknown as AuthenticatedPartyAuthorityV21;
}

function materialOperation(operation: EnvelopeOperationV21): boolean {
  const policy = OPERATION_AUTHORIZATION_POLICIES_V21[operation.type];
  return (
    policy.material_change ||
    (operation.type === 'respond_to_challenge' && operation.replacement_statement !== null)
  );
}

function authorizationFailure(
  envelope: CaseEnvelopeV21,
  operation: EnvelopeOperationV21,
  authority: ExecutionAuthorityV21,
): { reason: CommandFailureReasonV21; message: string } | null {
  const policy = OPERATION_AUTHORIZATION_POLICIES_V21[operation.type];
  if (policy.system_required && !isTrustedSystemAuthorityV21(authority)) {
    return {
      reason: 'unauthorized_actor',
      message: 'This operation requires the non-serializable trusted system capability.',
    };
  }
  if (
    !policy.system_required &&
    (!asPartyAuthority(authority) || !policy.allowed_actor_types.includes('party'))
  ) {
    return { reason: 'unauthorized_actor', message: 'An authenticated party is required.' };
  }
  if (!policy.system_required) {
    const partyAuthority = asPartyAuthority(authority)!;
    const binding = envelope.parties[partyAuthority.party_id];
    if (
      binding.identity_assurance !== 'authenticated' ||
      binding.authenticated_subject_id !== partyAuthority.authenticated_subject_id
    ) {
      return {
        reason: 'unauthorized_actor',
        message: 'Execution authority does not match the canonical party binding.',
      };
    }
  }
  if (!policy.allowed_workflow_states.includes(envelope.control.workflow_state)) {
    return {
      reason: 'operation_not_permitted_in_state',
      message: `${operation.type} is unavailable in ${envelope.control.workflow_state}.`,
    };
  }
  if (policy.system_required) {
    if (!isTrustedSystemAuthorityV21(authority)) {
      return {
        reason: 'unauthorized_actor',
        message: 'This operation requires the non-serializable trusted system capability.',
      };
    }
  } else {
    const partyAuthority = asPartyAuthority(authority);
    if (!partyAuthority || !policy.allowed_actor_types.includes('party')) {
      return { reason: 'unauthorized_actor', message: 'An authenticated party is required.' };
    }
    const binding = envelope.parties[partyAuthority.party_id];
    if (
      binding.identity_assurance !== 'authenticated' ||
      binding.authenticated_subject_id !== partyAuthority.authenticated_subject_id
    ) {
      return {
        reason: 'unauthorized_actor',
        message: 'Execution authority does not match the canonical party binding.',
      };
    }
    if (!policy.allowed_party_authorities.includes(partyAuthority.interaction_authority)) {
      return {
        reason: 'unauthorized_actor',
        message: 'The interaction authority is insufficient for this operation.',
      };
    }
    if (
      policy.first_party_human_required &&
      partyAuthority.interaction_authority !== 'first_party_human'
    ) {
      return {
        reason: 'unauthorized_actor',
        message: 'Explicit first-party human authority is required.',
      };
    }
    if (
      binding.edit_state === 'confirmed' &&
      materialOperation(operation) &&
      !policy.allowed_when_confirmed
    ) {
      return {
        reason: 'explicit_reopen_required',
        message:
          'Confirmed material is quiescent until the same first party explicitly reopens it.',
      };
    }
    switch (operation.type) {
      case 'record_own_position':
        if (
          envelope.positions[operation.position_id] ||
          envelope.source_turns[operation.source_turn.turn_id]
        ) {
          return {
            reason: 'invalid_operation',
            message: 'Position or source turn already exists.',
          };
        }
        break;
      case 'replace_own_position': {
        const position = envelope.positions[operation.position_id];
        if (!position) return { reason: 'invalid_operation', message: 'Position is unavailable.' };
        if (position.attributed_party_id !== partyAuthority.party_id) {
          if (envelope.control.disclosure_state === 'embargoed') {
            return { reason: 'invalid_operation', message: 'Position is unavailable.' };
          }
          return {
            reason: 'cross_party_mutation',
            message: 'Position belongs to the other party.',
          };
        }
        if (position.statement !== operation.expected_statement) {
          return { reason: 'invalid_operation', message: 'Expected prior statement is stale.' };
        }
        if (envelope.source_turns[operation.source_turn.turn_id]) {
          return {
            reason: 'invalid_operation',
            message: 'Replacement source turn already exists.',
          };
        }
        break;
      }
      case 'resolve_own_requirement': {
        const requirement = envelope.requirements[operation.requirement_id];
        if (!requirement)
          return { reason: 'invalid_operation', message: 'Requirement is unavailable.' };
        if (requirement.party_id !== partyAuthority.party_id) {
          if (envelope.control.disclosure_state === 'embargoed') {
            return { reason: 'invalid_operation', message: 'Requirement is unavailable.' };
          }
          return {
            reason: 'cross_party_mutation',
            message: 'Requirement belongs to the other party.',
          };
        }
        break;
      }
      case 'record_own_clarification':
        if (envelope.clarifications[operation.clarification_id]) {
          return { reason: 'invalid_operation', message: 'Clarification already exists.' };
        }
        break;
      case 'record_own_evidence_reference':
        if (envelope.evidence[operation.evidence_id]) {
          return { reason: 'invalid_operation', message: 'Evidence reference already exists.' };
        }
        break;
      case 'mark_own_independent_formation_complete':
        if (
          Object.values(envelope.requirements).some(
            (requirement) =>
              requirement.party_id === partyAuthority.party_id &&
              requirement.required &&
              requirement.status === 'open',
          )
        ) {
          return { reason: 'invalid_operation', message: 'Required formation fields remain open.' };
        }
        break;
      case 'record_challenge': {
        const target = envelope.positions[operation.target_position_id];
        if (envelope.control.disclosure_state !== 'disclosed' || !target) {
          return { reason: 'invalid_operation', message: 'Challenge target is not disclosed.' };
        }
        if (target.attributed_party_id !== otherPartyV21(partyAuthority.party_id)) {
          return {
            reason: 'cross_party_mutation',
            message: 'A challenge must target disclosed opponent material.',
          };
        }
        if (envelope.challenges[operation.challenge_id]) {
          return { reason: 'invalid_operation', message: 'Challenge already exists.' };
        }
        break;
      }
      case 'respond_to_challenge': {
        const challenge = envelope.challenges[operation.challenge_id];
        if (!challenge || challenge.status !== 'open') {
          return { reason: 'invalid_operation', message: 'Open challenge does not exist.' };
        }
        if (challenge.target_party_id !== partyAuthority.party_id) {
          return {
            reason: 'cross_party_mutation',
            message: 'Only the party whose material is challenged may respond.',
          };
        }
        if (
          operation.replacement_statement !== null &&
          envelope.parties[partyAuthority.party_id].edit_state !== 'reopened'
        ) {
          return {
            reason: 'explicit_reopen_required',
            message: 'A material challenge response requires explicit first-party reopen.',
          };
        }
        break;
      }
      case 'record_party_confirmation':
        if (!binding.independent_formation_complete) {
          return {
            reason: 'confirmation_binding_invalid',
            message: 'Independent formation must be complete before confirmation.',
          };
        }
        if (
          Object.values(envelope.requirements).some(
            (requirement) =>
              requirement.party_id === partyAuthority.party_id &&
              requirement.required &&
              requirement.status === 'open',
          )
        ) {
          return {
            reason: 'confirmation_binding_invalid',
            message: 'The party still has an open required formation field.',
          };
        }
        if (currentPartyConfirmationV21(envelope, partyAuthority.party_id)) {
          return {
            reason: 'confirmation_binding_invalid',
            message: 'The party already has a current confirmation.',
          };
        }
        if (
          envelope.control.disclosure_state === 'disclosed' &&
          Object.values(envelope.challenges).some(
            (challenge) =>
              challenge.status === 'open' &&
              (challenge.challenging_party_id === partyAuthority.party_id ||
                challenge.target_party_id === partyAuthority.party_id),
          )
        ) {
          return {
            reason: 'confirmation_binding_invalid',
            message: 'Open challenges involving the party must be resolved before confirmation.',
          };
        }
        if (
          envelope.formation.confirmations[partyAuthority.party_id].some(
            (receipt) =>
              receipt.confirmation_id === operation.confirmation_id ||
              receipt.event_id === operation.event_id,
          )
        ) {
          return {
            reason: 'confirmation_binding_invalid',
            message: 'Confirmation or event identifier already exists.',
          };
        }
        break;
      case 'reopen_own_formation':
        if (
          binding.edit_state !== 'confirmed' ||
          envelope.formation.confirmations[partyAuthority.party_id].length === 0
        ) {
          return {
            reason: 'invalid_operation',
            message: 'Only a previously confirmed party may explicitly reopen.',
          };
        }
        if (
          envelope.formation.reopen_events.some((event) => event.event_id === operation.event_id)
        ) {
          return { reason: 'invalid_operation', message: 'Reopen event already exists.' };
        }
        break;
      default:
        break;
    }
  }
  if (isTrustedSystemAuthorityV21(authority)) {
    switch (operation.type) {
      case 'bind_party':
        if (envelope.parties[operation.party_slot].identity_assurance !== 'unbound') {
          return { reason: 'invalid_operation', message: 'Party slot is already bound.' };
        }
        break;
      case 'redact_source_turn':
        if (!envelope.source_turns[operation.turn_id]?.content) {
          return { reason: 'invalid_operation', message: 'Readable source turn does not exist.' };
        }
        break;
      case 'set_evidence_eligibility':
        if (!envelope.evidence[operation.evidence_id]) {
          return { reason: 'invalid_operation', message: 'Evidence reference does not exist.' };
        }
        break;
      case 'open_controlled_disclosure':
        if (
          envelope.control.disclosure_state !== 'embargoed' ||
          PARTY_IDS_V21.some(
            (partyId) =>
              !envelope.parties[partyId].authenticated_subject_id ||
              !envelope.parties[partyId].independent_formation_complete,
          )
        ) {
          return {
            reason: 'disclosure_prerequisite_failed',
            message: 'Both distinct bound parties must finish independent formation first.',
          };
        }
        break;
      case 'enter_final_confirmation':
        if (
          envelope.control.disclosure_state !== 'disclosed' ||
          Object.values(envelope.challenges).some((challenge) => challenge.status === 'open')
        ) {
          return {
            reason: 'invalid_operation',
            message: 'Controlled disclosure and procedural challenge closure are required.',
          };
        }
        break;
      case 'mark_ready_for_lock':
        if (!deriveFormationReadinessV21(envelope).ready_for_bilateral_lock) {
          return {
            reason: 'readiness_blocked',
            message: 'Authoritative derived readiness remains blocked.',
          };
        }
        break;
      default:
        break;
    }
  }
  return null;
}

function sourceTurnRecord(
  source: SourceTurnInputV21,
  partyId: PartyIdV21,
): CaseEnvelopeV21['source_turns'][string] {
  return {
    turn_id: source.turn_id,
    attributed_party_id: partyId,
    content: source.content,
    content_hash: hashSourceTurnContentV21(source.content),
    content_length: source.content.length,
    redacted_at: null,
  };
}

function spanCommitments(source: SourceTurnInputV21) {
  return source.spans.map((span) => ({
    start: span.start,
    end: span.end,
    quote_hash: sha256(span.quote),
  }));
}

function applyOperation(
  envelope: CaseEnvelopeV21,
  operation: EnvelopeOperationV21,
  authority: ExecutionAuthorityV21,
): void {
  const nextVersion = envelope.control.envelope_version + 1;
  const party = asPartyAuthority(authority);
  switch (operation.type) {
    case 'record_own_position': {
      const partyId = party!.party_id;
      envelope.source_turns[operation.source_turn.turn_id] = sourceTurnRecord(
        operation.source_turn,
        partyId,
      );
      envelope.positions[operation.position_id] = {
        position_id: operation.position_id,
        attributed_party_id: partyId,
        position_kind: operation.position_kind,
        statement: operation.statement,
        resolution_status: operation.resolution_status,
        source_turn_id: operation.source_turn.turn_id,
        source_span_commitments: spanCommitments(operation.source_turn),
        introduced_envelope_version: nextVersion,
        last_material_envelope_version: nextVersion,
      };
      return;
    }
    case 'replace_own_position': {
      const partyId = party!.party_id;
      const position = envelope.positions[operation.position_id]!;
      envelope.source_turns[operation.source_turn.turn_id] = sourceTurnRecord(
        operation.source_turn,
        partyId,
      );
      position.statement = operation.replacement_statement;
      position.source_turn_id = operation.source_turn.turn_id;
      position.source_span_commitments = spanCommitments(operation.source_turn);
      position.last_material_envelope_version = nextVersion;
      return;
    }
    case 'resolve_own_requirement': {
      const requirement = envelope.requirements[operation.requirement_id]!;
      requirement.status = operation.resolution;
      requirement.response_summary = operation.response_summary;
      return;
    }
    case 'record_own_clarification':
      envelope.clarifications[operation.clarification_id] = {
        clarification_id: operation.clarification_id,
        party_id: party!.party_id,
        question: operation.question,
        answer: operation.answer,
        status: 'resolved',
      };
      return;
    case 'record_own_evidence_reference':
      envelope.evidence[operation.evidence_id] = {
        evidence_id: operation.evidence_id,
        attributed_party_id: party!.party_id,
        description: operation.description,
        required_for_readiness: operation.required_for_readiness,
        eligibility: operation.required_for_readiness ? 'pending' : 'not_required',
      };
      return;
    case 'mark_own_independent_formation_complete':
      envelope.parties[party!.party_id].independent_formation_complete = true;
      return;
    case 'record_challenge': {
      const target = envelope.positions[operation.target_position_id]!;
      envelope.challenges[operation.challenge_id] = {
        challenge_id: operation.challenge_id,
        challenging_party_id: party!.party_id,
        target_party_id: target.attributed_party_id,
        target_position_id: operation.target_position_id,
        statement: operation.statement,
        status: 'open',
        response_statement: null,
        response_party_id: null,
      };
      return;
    }
    case 'respond_to_challenge': {
      const challenge = envelope.challenges[operation.challenge_id]!;
      challenge.status = 'resolved';
      challenge.response_statement = operation.response_statement;
      challenge.response_party_id = party!.party_id;
      if (operation.replacement_statement !== null && operation.source_turn !== null) {
        const position = envelope.positions[challenge.target_position_id]!;
        envelope.source_turns[operation.source_turn.turn_id] = sourceTurnRecord(
          operation.source_turn,
          party!.party_id,
        );
        position.statement = operation.replacement_statement;
        position.source_turn_id = operation.source_turn.turn_id;
        position.source_span_commitments = spanCommitments(operation.source_turn);
        position.last_material_envelope_version = nextVersion;
      }
      return;
    }
    case 'record_party_confirmation': {
      const partyId = party!.party_id;
      const readback = renderPartyFormationReadbackV21(envelope, partyId);
      envelope.formation.confirmations[partyId].push({
        confirmation_version: PARTY_CONFIRMATION_VERSION_V21,
        confirmation_id: operation.confirmation_id,
        party_id: partyId,
        authenticated_subject_id: party!.authenticated_subject_id,
        party_projection_version: PARTY_FORMATION_PROJECTION_VERSION_V21,
        party_projection_hash: readback.party_projection_hash,
        party_visible_version: envelope.control.party_views[partyId].party_visible_version,
        party_readback_version: PARTY_FORMATION_READBACK_VERSION_V21,
        party_readback_hash: readback.document_hash,
        adoption_statement_hash: hashAdoptionStatementV21(operation.adoption_statement),
        formation_epoch: envelope.parties[partyId].formation_epoch,
        shared_envelope_version: envelope.control.envelope_version,
        shared_envelope_hash: envelope.control.envelope_hash,
        confirmed_at: operation.confirmed_at,
        event_id: operation.event_id,
      });
      envelope.parties[partyId].edit_state = 'confirmed';
      return;
    }
    case 'reopen_own_formation': {
      const binding = envelope.parties[party!.party_id];
      const priorFormationEpoch = binding.formation_epoch;
      binding.edit_state = 'reopened';
      binding.formation_epoch += 1;
      envelope.formation.reopen_events.push({
        event_id: operation.event_id,
        party_id: party!.party_id,
        authenticated_subject_id: party!.authenticated_subject_id,
        prior_formation_epoch: priorFormationEpoch,
        resulting_formation_epoch: binding.formation_epoch,
        reason: operation.reason,
        occurred_at: operation.occurred_at,
      });
      envelope.control.workflow_state =
        envelope.control.disclosure_state === 'disclosed'
          ? 'challenge_response'
          : 'independent_formation';
      return;
    }
    case 'bind_party': {
      const binding = envelope.parties[operation.party_slot];
      binding.authenticated_subject_id = operation.authenticated_subject_id;
      binding.identity_assurance = 'authenticated';
      binding.binding_event_id = operation.binding_event_id;
      return;
    }
    case 'redact_source_turn':
      envelope.source_turns[operation.turn_id]!.content = null;
      envelope.source_turns[operation.turn_id]!.redacted_at = operation.redacted_at;
      return;
    case 'set_evidence_eligibility':
      envelope.evidence[operation.evidence_id]!.eligibility = operation.eligibility;
      return;
    case 'open_controlled_disclosure':
      envelope.control.disclosure_state = 'disclosed';
      envelope.control.workflow_state = 'challenge_response';
      return;
    case 'enter_final_confirmation':
      envelope.control.workflow_state = 'final_confirmation';
      return;
    case 'mark_ready_for_lock':
      envelope.control.workflow_state = 'ready_for_lock';
      return;
  }
}

function rejected(
  input: ApplyEnvelopeCommandInputV21,
  reason: CommandFailureReasonV21,
  message: string,
): ApplyEnvelopeCommandResultV21 {
  return {
    status: 'rejected',
    reason_code: reason,
    message,
    envelope: cloneCaseEnvelopeV21(input.envelope),
    prior_envelope_version: input.envelope.control.envelope_version,
    resulting_envelope_version: input.envelope.control.envelope_version,
    changed_visible_parties: [],
  };
}

function refreshPartyViewCursors(
  before: CaseEnvelopeV21,
  candidate: CaseEnvelopeV21,
): PartyIdV21[] {
  const changed: PartyIdV21[] = [];
  for (const partyId of PARTY_IDS_V21) {
    const nextHash = hashPartyFormationProjectionV21(candidate, partyId);
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

export function applyEnvelopeCommandV21(
  input: ApplyEnvelopeCommandInputV21,
): ApplyEnvelopeCommandResultV21 {
  try {
    canonicalSerialize(input.command);
  } catch (error) {
    return rejected(
      input,
      'invalid_command',
      error instanceof Error ? error.message : 'Command is not plain JSON.',
    );
  }
  const commandFailure = commandStructureFailure(input.command);
  if (commandFailure) return rejected(input, 'invalid_command', commandFailure);
  const inputIssues = validateCaseEnvelopeV21(input.envelope);
  if (inputIssues.length > 0) {
    return rejected(
      input,
      'invalid_envelope',
      `${inputIssues[0]!.code}: ${inputIssues[0]!.message}`,
    );
  }
  if (input.command.case_id !== input.envelope.control.case_id) {
    return rejected(input, 'case_mismatch', 'Command case does not match the envelope.');
  }
  if (input.command.base_envelope_version !== input.envelope.control.envelope_version) {
    return rejected(input, 'stale_base_version', 'Internal envelope version is stale.');
  }
  if (input.command.base_envelope_hash !== input.envelope.control.envelope_hash) {
    return rejected(input, 'stale_base_hash', 'Internal envelope hash is stale.');
  }
  const authorization = authorizationFailure(
    input.envelope,
    input.command.operation,
    input.execution_authority,
  );
  if (authorization) return rejected(input, authorization.reason, authorization.message);
  const candidate = cloneCaseEnvelopeV21(input.envelope);
  applyOperation(candidate, input.command.operation, input.execution_authority);
  candidate.control.envelope_version += 1;
  const changedVisibleParties = refreshPartyViewCursors(input.envelope, candidate);
  candidate.formation.explanatory = authoritativeFormationExplanatoryStateV21(candidate);
  if (
    candidate.control.workflow_state === 'ready_for_lock' &&
    !deriveFormationReadinessV21(candidate).ready_for_bilateral_lock
  ) {
    candidate.control.workflow_state = 'final_confirmation';
    candidate.formation.explanatory = authoritativeFormationExplanatoryStateV21(candidate);
  }
  candidate.control.envelope_hash = hashCaseEnvelopeV21(candidate);
  const resultingIssues = validateCaseEnvelopeV21(candidate);
  if (resultingIssues.length > 0) {
    return rejected(
      input,
      'resulting_envelope_invalid',
      `${resultingIssues[0]!.code}: ${resultingIssues[0]!.message}`,
    );
  }
  return {
    status: 'applied',
    reason_code: null,
    message: 'V2.1 domain command applied atomically.',
    envelope: candidate,
    prior_envelope_version: input.envelope.control.envelope_version,
    resulting_envelope_version: candidate.control.envelope_version,
    changed_visible_parties: changedVisibleParties,
  };
}

export function commandForV21(
  envelope: CaseEnvelopeV21,
  commandId: string,
  operation: EnvelopeOperationV21,
): EnvelopeCommandV21 {
  return {
    command_version: ENVELOPE_COMMAND_VERSION_V21,
    command_id: commandId,
    case_id: envelope.control.case_id,
    base_envelope_version: envelope.control.envelope_version,
    base_envelope_hash: envelope.control.envelope_hash,
    operation: cloneCanonical(operation),
  };
}

export function prepareInternalPartyEnvelopeCommandV21(input: {
  envelope: CaseEnvelopeV21;
  intent: PartyMutationIntentV21;
  execution_authority: AuthenticatedPartyAuthorityV21;
}): PrepareInternalPartyEnvelopeCommandResultV21 {
  const { envelope, intent, execution_authority: authority } = input;
  if (
    !hasExactKeys(intent, [
      'command_id',
      'expected_party_projection_hash',
      'expected_party_visible_version',
      'intent_version',
      'operation',
    ]) ||
    intent.intent_version !== PARTY_MUTATION_INTENT_VERSION_V21 ||
    !ID_PATTERN_V21.test(String(intent.command_id)) ||
    typeof intent.expected_party_visible_version !== 'number' ||
    !Number.isSafeInteger(intent.expected_party_visible_version) ||
    intent.expected_party_visible_version < 1 ||
    !/^[a-f0-9]{64}$/u.test(String(intent.expected_party_projection_hash)) ||
    operationStructureFailure(intent.operation)
  ) {
    return {
      status: 'rejected',
      reason_code: 'invalid_party_intent',
      message: 'Party mutation intent shape or operation is invalid.',
    };
  }
  const partyAuthority = asPartyAuthority(authority);
  if (!partyAuthority) {
    return {
      status: 'rejected',
      reason_code: 'unauthorized_actor',
      message: 'A server-derived authenticated party authority is required.',
    };
  }
  const binding = envelope.parties[partyAuthority.party_id];
  if (
    binding.identity_assurance !== 'authenticated' ||
    binding.authenticated_subject_id !== partyAuthority.authenticated_subject_id ||
    !OPERATION_AUTHORIZATION_POLICIES_V21[intent.operation.type].party_mutating
  ) {
    return {
      status: 'rejected',
      reason_code: 'unauthorized_actor',
      message: 'Party intent does not match an authorized canonical party operation.',
    };
  }
  const cursor = envelope.control.party_views[partyAuthority.party_id];
  if (
    cursor.party_visible_version !== intent.expected_party_visible_version ||
    cursor.party_projection_hash !== intent.expected_party_projection_hash
  ) {
    return {
      status: 'rejected',
      reason_code: 'party_projection_stale',
      message: 'The party-visible formation projection changed.',
    };
  }
  return {
    status: 'prepared',
    command: commandForV21(envelope, intent.command_id, intent.operation),
  };
}

export type InitialFormationRequirementsV21 = Record<
  PartyIdV21,
  Array<{ requirement_id: string; label: string; required?: boolean }>
>;

export function createInitialCaseEnvelopeV21(
  caseId: string,
  initialRequirements: InitialFormationRequirementsV21 = { party_a: [], party_b: [] },
): CaseEnvelopeV21 {
  if (!ID_PATTERN_V21.test(caseId)) throw new TypeError('Case ID is invalid.');
  const requirements: Record<string, FormationRequirementV21> = {};
  for (const partyId of PARTY_IDS_V21) {
    for (const entry of initialRequirements[partyId]) {
      if (!ID_PATTERN_V21.test(entry.requirement_id) || requirements[entry.requirement_id]) {
        throw new TypeError('Formation requirement IDs must be unique canonical identifiers.');
      }
      requirements[entry.requirement_id] = {
        requirement_id: entry.requirement_id,
        party_id: partyId,
        label: entry.label,
        required: entry.required ?? true,
        status: 'open',
        response_summary: null,
      };
    }
  }
  const envelope: CaseEnvelopeV21 = {
    control: {
      schema_version: CASE_ENVELOPE_SCHEMA_VERSION_V21,
      protocol_version: FORMATION_PROTOCOL_VERSION_V21,
      command_contract_version: ENVELOPE_COMMAND_VERSION_V21,
      projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V21,
      readiness_contract_version: FORMATION_READINESS_VERSION_V21,
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
        independent_formation_complete: false,
        edit_state: 'open',
        formation_epoch: 1,
      },
      party_b: {
        party_id: 'party_b',
        role: 'party_b',
        authenticated_subject_id: null,
        identity_assurance: 'unbound',
        binding_event_id: null,
        independent_formation_complete: false,
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
  for (const partyId of PARTY_IDS_V21) {
    envelope.control.party_views[partyId].party_projection_hash = hashPartyFormationProjectionV21(
      envelope,
      partyId,
    );
  }
  envelope.formation.explanatory = authoritativeFormationExplanatoryStateV21(envelope);
  envelope.control.envelope_hash = hashCaseEnvelopeV21(envelope);
  assertValidCaseEnvelopeV21(envelope);
  return envelope;
}
