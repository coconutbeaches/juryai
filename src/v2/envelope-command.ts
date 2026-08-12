import { isDeepStrictEqual } from 'node:util';
import {
  canonicalSerialize,
  cloneCanonical,
  deriveResolutionStatus,
  evidenceEligibility,
  hashCaseEnvelope,
  hashCaseRecord,
  sha256,
  validateCaseEnvelope,
  validateSourceReference,
  validateSubstantiveObjectShape,
  type AgreementObject,
  type AuthenticatedActor,
  type CaseEnvelope,
  type ClaimedLossObject,
  type ConfirmationReceipt,
  type DeliverableObject,
  type EventObject,
  type EvidenceObject,
  type JsonValue,
  type LockReceipt,
  type NonPartyActor,
  type ObjectAuthority,
  type PartyId,
  type PartyStance,
  type PaymentObject,
  type PositionObject,
  type RequestedOutcomeObject,
  type SourceRecord,
  type SourceReference,
  type SubstantiveNamespace,
  type WorkflowState,
} from './case-envelope.js';

export const ENVELOPE_COMMAND_VERSION = 'juryai-envelope-command-v2.0.0';

type SubstantiveObject =
  | NonPartyActor
  | AgreementObject
  | EventObject
  | PaymentObject
  | DeliverableObject
  | PositionObject
  | ClaimedLossObject
  | RequestedOutcomeObject
  | EvidenceObject;

export type TransitionEvent =
  | 'initial_story_received'
  | 'triage_eligible'
  | 'triage_unsuitable'
  | 'triage_unsafe'
  | 'person_a_record_ready'
  | 'person_a_confirmed'
  | 'person_b_invited'
  | 'non_participation_documented'
  | 'responses_complete'
  | 'reconciliation_complete'
  | 'final_confirmations_complete'
  | 'adjudication_started'
  | 'recommendation_resolved'
  | 'recommendation_unresolved'
  | 'case_withdrawn';

export interface AddObjectOperation {
  type: 'add_object';
  namespace: SubstantiveNamespace;
  object: SubstantiveObject;
}

export interface ReplaceOwnFieldOperation {
  type: 'replace_own_field';
  namespace: Exclude<SubstantiveNamespace, 'evidence'>;
  object_id: string;
  field: string;
  expected_prior_value: JsonValue;
  replacement_value: JsonValue;
}

export interface SetOwnStanceOperation {
  type: 'set_own_stance';
  namespace: SubstantiveNamespace;
  object_id: string;
  stance: PartyStance;
  response_event_id: string;
}

export interface RecordChallengeOperation {
  type: 'record_challenge';
  challenge_id: string;
  target_namespace: SubstantiveNamespace;
  target_object_id: string;
  target_field: string | null;
  source_references: SourceReference[];
}

export interface ResolveChallengeOperation {
  type: 'resolve_challenge';
  challenge_id: string;
  resolution: 'accepted' | 'rejected' | 'withdrawn';
  resolution_event_id: string;
  resolution_source_references: SourceReference[];
}

export interface SetClassificationOperation {
  type: 'set_classification';
  case_category: string;
  suitability: 'eligible' | 'ineligible';
  maturity: 'immature' | 'ready';
  safety_flags: string[];
  scope_flags: string[];
  required_fact_profile: string;
  authority: ObjectAuthority;
}

export interface SetFormationRequirementsOperation {
  type: 'set_formation_requirements';
  open_required_fields: string[];
  ambiguities: string[];
  uncertainties: string[];
  lock_prerequisites: string[];
  lock_blockers: string[];
}

export interface SetPartyParticipationOperation {
  type: 'set_party_participation';
  party_id: PartyId;
  participation_state: CaseEnvelope['parties'][PartyId]['participation_state'];
  invitation_event_id: string | null;
}

export interface SetPartyIdentityOperation {
  type: 'set_party_identity';
  party_id: PartyId;
  authenticated_subject_id: string;
  identity_assurance: 'authenticated' | 'verified';
  identity_event_id: string;
}

export interface RecordPartyConsentOperation {
  type: 'record_party_consent';
  party_id: PartyId;
  consent_status: 'pending' | 'granted' | 'declined';
  consent_event_id: string;
}

export interface SetNonParticipationRecordOperation {
  type: 'set_non_participation_record';
  notice_event_id: string;
  response_deadline: string;
  deadline_expired_event_id: string;
  correction_opportunity: 'expired' | 'exhausted';
}

export interface SetNonParticipationPolicyOperation {
  type: 'set_non_participation_policy';
  mode: 'prohibited' | 'advisory_only';
}

export interface RecordEvidenceUploadOperation {
  type: 'record_evidence_upload';
  evidence_id: string;
  content_hash: string;
}

export interface RecordEvidenceInspectionOperation {
  type: 'record_evidence_inspection';
  evidence_id: string;
  status: 'inspected_complete' | 'inspected_incomplete' | 'unreadable';
  result_id: string;
  result_version: string;
  result_hash: string;
  limitations: string[];
  source_reference: SourceReference;
}

export interface SetEvidenceVisibilityOperation {
  type: 'set_evidence_visibility';
  evidence_id: string;
  visibility: 'private' | 'eligible_for_disclosure' | 'disclosed_to_both' | 'withheld';
  disclosure_event_id: string;
}

export interface RecordIndependentAccountOperation {
  type: 'record_independent_account';
  source_reference: SourceReference;
  event_id: string;
}

export interface RecordDetailedDisclosureOperation {
  type: 'record_detailed_disclosure';
  event_id: string;
}

export interface RecordConfirmationOperation {
  type: 'record_confirmation';
  confirmation_id: string;
  confirmed_at: string;
  event_id: string;
}

export interface TransitionOperation {
  type: 'transition';
  event: TransitionEvent;
  event_id: string;
}

export interface LockOperation {
  type: 'lock';
  mode: 'bilateral' | 'documented_non_participation';
  lock_event_id: string;
  locked_at: string;
}

export interface ReopenMaterialChangeOperation {
  type: 'reopen_material_change';
  event_id: string;
  reason: string;
  occurred_at: string;
  source_references: SourceReference[];
}

export type EnvelopeOperation =
  | AddObjectOperation
  | ReplaceOwnFieldOperation
  | SetOwnStanceOperation
  | RecordChallengeOperation
  | ResolveChallengeOperation
  | SetClassificationOperation
  | SetFormationRequirementsOperation
  | SetPartyIdentityOperation
  | RecordPartyConsentOperation
  | SetPartyParticipationOperation
  | SetNonParticipationRecordOperation
  | SetNonParticipationPolicyOperation
  | RecordEvidenceUploadOperation
  | RecordEvidenceInspectionOperation
  | SetEvidenceVisibilityOperation
  | RecordIndependentAccountOperation
  | RecordDetailedDisclosureOperation
  | RecordConfirmationOperation
  | TransitionOperation
  | LockOperation
  | ReopenMaterialChangeOperation;

export interface EnvelopeCommand {
  command_version: typeof ENVELOPE_COMMAND_VERSION;
  command_id: string;
  authenticated_actor: AuthenticatedActor;
  case_id: string;
  base_envelope_version: number;
  base_envelope_hash: string;
  operations: EnvelopeOperation[];
  source_references: SourceReference[];
  confirmation_context: {
    confirmation_ids: string[];
  } | null;
}

export interface CommandLedgerEntry {
  command_hash: string;
  result_envelope_version: number;
  result_envelope_hash: string;
}

export type CommandLedger = Record<string, CommandLedgerEntry>;

export type CommandFailureReason =
  | 'invalid_command'
  | 'invalid_envelope'
  | 'duplicate_command_conflict'
  | 'authentication_mismatch'
  | 'case_mismatch'
  | 'stale_base_version'
  | 'stale_base_hash'
  | 'invalid_source_reference'
  | 'unauthorized_actor'
  | 'cross_party_mutation'
  | 'unknown_object'
  | 'duplicate_object'
  | 'invalid_operation'
  | 'operation_not_permitted_in_state'
  | 'stale_prior_value'
  | 'invalid_transition'
  | 'disclosure_embargo'
  | 'confirmation_binding_invalid'
  | 'lock_guard_failed'
  | 'locked_envelope'
  | 'atomic_command_rejected'
  | 'resulting_envelope_invalid';

export interface ApplyEnvelopeCommandResult {
  status: 'applied' | 'idempotent' | 'rejected';
  reason_code: CommandFailureReason | null;
  message: string;
  envelope: CaseEnvelope;
  ledger: CommandLedger;
  command_hash: string;
  prior_envelope_version: number;
  prior_envelope_hash: string;
  resulting_envelope_version: number;
  resulting_envelope_hash: string;
  material_record_changed: boolean;
}

export interface ApplyEnvelopeCommandInput {
  envelope: CaseEnvelope;
  command: EnvelopeCommand;
  authenticated_actor: AuthenticatedActor;
  source_registry: Record<string, SourceRecord>;
  ledger: CommandLedger;
}

export interface TransitionDefinition {
  event: TransitionEvent;
  from: WorkflowState[];
  to: WorkflowState;
  initiating_actor: 'system';
  guards: string[];
}

export interface OperationPermission {
  operation: EnvelopeOperation['type'];
  actor_types: AuthenticatedActor['actor_type'][];
  workflow_states: WorkflowState[];
  party_scope: 'own_material' | 'person_b_only' | 'none';
}

const FORMATION_EDIT_STATES: WorkflowState[] = [
  'person_a_formation',
  'person_a_confirmation',
  'person_b_independent_account',
  'disclosure_challenge',
  'reconciliation',
  'final_confirmation',
];

export const OPERATION_PERMISSIONS: readonly OperationPermission[] = [
  ...(['add_object', 'replace_own_field', 'set_own_stance'] as const).map((operation) => ({
    operation,
    actor_types: ['party'] as AuthenticatedActor['actor_type'][],
    workflow_states: FORMATION_EDIT_STATES,
    party_scope: 'own_material' as const,
  })),
  {
    operation: 'record_challenge',
    actor_types: ['party'],
    workflow_states: ['disclosure_challenge', 'reconciliation'],
    party_scope: 'own_material',
  },
  {
    operation: 'resolve_challenge',
    actor_types: ['party'],
    workflow_states: ['disclosure_challenge', 'reconciliation'],
    party_scope: 'own_material',
  },
  {
    operation: 'set_classification',
    actor_types: ['system'],
    workflow_states: ['triage'],
    party_scope: 'none',
  },
  {
    operation: 'set_formation_requirements',
    actor_types: ['system'],
    workflow_states: ['triage', ...FORMATION_EDIT_STATES],
    party_scope: 'none',
  },
  {
    operation: 'set_party_identity',
    actor_types: ['system'],
    workflow_states: [
      'initial_story',
      'triage',
      'person_a_formation',
      'person_a_confirmation',
      'awaiting_person_b',
      'person_b_independent_account',
    ],
    party_scope: 'none',
  },
  {
    operation: 'record_party_consent',
    actor_types: ['system'],
    workflow_states: [
      'initial_story',
      'triage',
      'person_a_formation',
      'person_a_confirmation',
      'awaiting_person_b',
      'person_b_independent_account',
      'disclosure_challenge',
      'reconciliation',
      'final_confirmation',
    ],
    party_scope: 'none',
  },
  {
    operation: 'set_party_participation',
    actor_types: ['system'],
    workflow_states: ['awaiting_person_b', 'person_b_independent_account', 'reconciliation'],
    party_scope: 'none',
  },
  {
    operation: 'set_non_participation_policy',
    actor_types: ['system'],
    workflow_states: ['initial_story', 'triage', 'person_a_formation', 'person_a_confirmation'],
    party_scope: 'none',
  },
  {
    operation: 'set_non_participation_record',
    actor_types: ['system'],
    workflow_states: ['person_b_independent_account'],
    party_scope: 'none',
  },
  {
    operation: 'record_evidence_upload',
    actor_types: ['system'],
    workflow_states: FORMATION_EDIT_STATES,
    party_scope: 'none',
  },
  {
    operation: 'record_evidence_inspection',
    actor_types: ['inspector'],
    workflow_states: FORMATION_EDIT_STATES,
    party_scope: 'none',
  },
  {
    operation: 'set_evidence_visibility',
    actor_types: ['system'],
    workflow_states: ['disclosure_challenge', 'reconciliation', 'final_confirmation'],
    party_scope: 'none',
  },
  {
    operation: 'record_independent_account',
    actor_types: ['party'],
    workflow_states: ['person_b_independent_account'],
    party_scope: 'person_b_only',
  },
  {
    operation: 'record_detailed_disclosure',
    actor_types: ['system'],
    workflow_states: ['person_b_independent_account', 'disclosure_challenge'],
    party_scope: 'none',
  },
  {
    operation: 'record_confirmation',
    actor_types: ['party'],
    workflow_states: ['person_a_confirmation', 'final_confirmation'],
    party_scope: 'own_material',
  },
  {
    operation: 'transition',
    actor_types: ['system'],
    workflow_states: [
      'initial_story',
      'triage',
      'person_a_formation',
      'person_a_confirmation',
      'awaiting_person_b',
      'person_b_independent_account',
      'disclosure_challenge',
      'reconciliation',
      'final_confirmation',
      'ready_for_lock',
      'locked',
      'deliberation',
    ],
    party_scope: 'none',
  },
  {
    operation: 'lock',
    actor_types: ['system'],
    workflow_states: ['ready_for_lock'],
    party_scope: 'none',
  },
  {
    operation: 'reopen_material_change',
    actor_types: ['system'],
    workflow_states: ['locked', 'deliberation'],
    party_scope: 'none',
  },
];

export const FORMATION_TRANSITIONS: readonly TransitionDefinition[] = [
  {
    event: 'initial_story_received',
    from: ['initial_story'],
    to: 'triage',
    initiating_actor: 'system',
    guards: ['source_reference_present'],
  },
  {
    event: 'triage_eligible',
    from: ['triage'],
    to: 'person_a_formation',
    initiating_actor: 'system',
    guards: ['eligibility_is_eligible', 'required_fact_profile_selected'],
  },
  {
    event: 'triage_unsuitable',
    from: ['triage'],
    to: 'unsuitable',
    initiating_actor: 'system',
    guards: ['eligibility_is_ineligible'],
  },
  {
    event: 'triage_unsafe',
    from: ['triage'],
    to: 'unsafe',
    initiating_actor: 'system',
    guards: ['safety_flag_present'],
  },
  {
    event: 'person_a_record_ready',
    from: ['person_a_formation'],
    to: 'person_a_confirmation',
    initiating_actor: 'system',
    guards: ['no_required_fields', 'no_lock_blockers'],
  },
  {
    event: 'person_a_confirmed',
    from: ['person_a_confirmation'],
    to: 'awaiting_person_b',
    initiating_actor: 'system',
    guards: ['current_person_a_confirmation'],
  },
  {
    event: 'person_b_invited',
    from: ['awaiting_person_b'],
    to: 'person_b_independent_account',
    initiating_actor: 'system',
    guards: ['person_b_invited', 'disclosure_embargoed'],
  },
  {
    event: 'non_participation_documented',
    from: ['person_b_independent_account'],
    to: 'final_confirmation',
    initiating_actor: 'system',
    guards: ['documented_non_participation_complete'],
  },
  {
    event: 'responses_complete',
    from: ['disclosure_challenge'],
    to: 'reconciliation',
    initiating_actor: 'system',
    guards: ['no_open_challenges'],
  },
  {
    event: 'reconciliation_complete',
    from: ['reconciliation'],
    to: 'final_confirmation',
    initiating_actor: 'system',
    guards: ['no_required_fields', 'no_lock_blockers'],
  },
  {
    event: 'final_confirmations_complete',
    from: ['final_confirmation'],
    to: 'ready_for_lock',
    initiating_actor: 'system',
    guards: ['lock_mode_confirmation_guard'],
  },
  {
    event: 'adjudication_started',
    from: ['locked'],
    to: 'deliberation',
    initiating_actor: 'system',
    guards: ['active_lock'],
  },
  {
    event: 'recommendation_resolved',
    from: ['deliberation'],
    to: 'resolved',
    initiating_actor: 'system',
    guards: ['active_lock'],
  },
  {
    event: 'recommendation_unresolved',
    from: ['deliberation'],
    to: 'unresolved',
    initiating_actor: 'system',
    guards: ['active_lock'],
  },
  {
    event: 'case_withdrawn',
    from: [
      'initial_story',
      'triage',
      'person_a_formation',
      'person_a_confirmation',
      'awaiting_person_b',
      'person_b_independent_account',
      'disclosure_challenge',
      'reconciliation',
      'final_confirmation',
      'ready_for_lock',
    ],
    to: 'withdrawn',
    initiating_actor: 'system',
    guards: [],
  },
] as const;

const materialOperationTypes = new Set<EnvelopeOperation['type']>([
  'add_object',
  'replace_own_field',
  'set_own_stance',
  'record_challenge',
  'resolve_challenge',
  'set_classification',
  'set_formation_requirements',
  'set_party_identity',
  'record_party_consent',
  'set_party_participation',
  'set_non_participation_record',
  'set_non_participation_policy',
  'record_evidence_upload',
  'record_evidence_inspection',
  'set_evidence_visibility',
  'record_independent_account',
  'record_detailed_disclosure',
  'reopen_material_change',
]);

const ownFieldPermissions: Readonly<
  Record<ReplaceOwnFieldOperation['namespace'], readonly string[]>
> = {
  actors: ['display_label', 'asserted_role'],
  agreements: ['description', 'conditions'],
  events: ['description', 'date'],
  payments: ['amount_minor', 'currency', 'payment_status', 'due_trigger'],
  deliverables: ['expected_scope', 'completion_positions', 'defect_positions'],
  positions: ['statement'],
  claimed_losses: [
    'loss_type',
    'amount_minor',
    'currency',
    'non_monetary_description',
    'causal_reference_ids',
    'supporting_evidence_ids',
  ],
  requested_outcomes: ['description', 'transfers', 'conditions', 'priority'],
};

const challengeFieldPermissions: Readonly<Record<SubstantiveNamespace, readonly string[]>> = {
  ...ownFieldPermissions,
  evidence: [
    'asserted_author_actor_id',
    'evidence_type',
    'availability',
    'authenticity_status',
    'decision_relevant',
  ],
};

function isSystem(actor: AuthenticatedActor): boolean {
  return actor.actor_type === 'system' && actor.party_id === null;
}

function objectId(namespace: SubstantiveNamespace, object: SubstantiveObject): string {
  const idFields: Record<SubstantiveNamespace, string> = {
    actors: 'actor_id',
    agreements: 'obligation_id',
    events: 'event_id',
    payments: 'payment_id',
    deliverables: 'deliverable_id',
    positions: 'position_id',
    claimed_losses: 'loss_id',
    requested_outcomes: 'outcome_id',
    evidence: 'evidence_id',
  };
  return String((object as unknown as Record<string, unknown>)[idFields[namespace]] ?? '');
}

function namespaceMap(
  envelope: CaseEnvelope,
  namespace: SubstantiveNamespace,
): Record<string, SubstantiveObject> {
  return envelope[namespace] as Record<string, SubstantiveObject>;
}

function ownMapValue<T>(map: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(map, id) ? map[id] : undefined;
}

function deduplicateSourceReferences(references: SourceReference[]): SourceReference[] {
  const byIdentity = new Map<string, SourceReference>();
  for (const reference of references) {
    byIdentity.set(canonicalSerialize(reference), cloneCanonical(reference));
  }
  return [...byIdentity.values()];
}

function partyMaterialSourceReferences(command: EnvelopeCommand): SourceReference[] {
  return deduplicateSourceReferences([
    ...command.source_references,
    ...command.operations.flatMap((operation) =>
      operation.type === 'resolve_challenge' ? operation.resolution_source_references : [],
    ),
  ]);
}

function rejected(
  input: ApplyEnvelopeCommandInput,
  commandHash: string,
  reason: CommandFailureReason,
  message: string,
): ApplyEnvelopeCommandResult {
  return {
    status: 'rejected',
    reason_code: reason,
    message,
    envelope: cloneCanonical(input.envelope),
    ledger: cloneCanonical(input.ledger),
    command_hash: commandHash,
    prior_envelope_version: input.envelope.control.envelope_version,
    prior_envelope_hash: input.envelope.control.envelope_hash,
    resulting_envelope_version: input.envelope.control.envelope_version,
    resulting_envelope_hash: input.envelope.control.envelope_hash,
    material_record_changed: false,
  };
}

const COMMAND_KEYS = [
  'authenticated_actor',
  'base_envelope_hash',
  'base_envelope_version',
  'case_id',
  'command_id',
  'command_version',
  'confirmation_context',
  'operations',
  'source_references',
] as const;
const COMMAND_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;

const OPERATION_KEYS: Record<EnvelopeOperation['type'], readonly string[]> = {
  add_object: ['namespace', 'object', 'type'],
  replace_own_field: [
    'expected_prior_value',
    'field',
    'namespace',
    'object_id',
    'replacement_value',
    'type',
  ],
  set_own_stance: ['namespace', 'object_id', 'response_event_id', 'stance', 'type'],
  record_challenge: [
    'challenge_id',
    'source_references',
    'target_field',
    'target_namespace',
    'target_object_id',
    'type',
  ],
  resolve_challenge: [
    'challenge_id',
    'resolution',
    'resolution_event_id',
    'resolution_source_references',
    'type',
  ],
  set_classification: [
    'authority',
    'case_category',
    'maturity',
    'required_fact_profile',
    'safety_flags',
    'scope_flags',
    'suitability',
    'type',
  ],
  set_formation_requirements: [
    'ambiguities',
    'lock_blockers',
    'lock_prerequisites',
    'open_required_fields',
    'type',
    'uncertainties',
  ],
  set_party_identity: [
    'authenticated_subject_id',
    'identity_assurance',
    'identity_event_id',
    'party_id',
    'type',
  ],
  record_party_consent: ['consent_event_id', 'consent_status', 'party_id', 'type'],
  set_party_participation: ['invitation_event_id', 'participation_state', 'party_id', 'type'],
  set_non_participation_record: [
    'correction_opportunity',
    'deadline_expired_event_id',
    'notice_event_id',
    'response_deadline',
    'type',
  ],
  set_non_participation_policy: ['mode', 'type'],
  record_evidence_upload: ['content_hash', 'evidence_id', 'type'],
  record_evidence_inspection: [
    'evidence_id',
    'limitations',
    'result_hash',
    'result_id',
    'result_version',
    'source_reference',
    'status',
    'type',
  ],
  set_evidence_visibility: ['disclosure_event_id', 'evidence_id', 'type', 'visibility'],
  record_independent_account: ['event_id', 'source_reference', 'type'],
  record_detailed_disclosure: ['event_id', 'type'],
  record_confirmation: ['confirmation_id', 'confirmed_at', 'event_id', 'type'],
  transition: ['event', 'event_id', 'type'],
  lock: ['lock_event_id', 'locked_at', 'mode', 'type'],
  reopen_material_change: ['event_id', 'occurred_at', 'reason', 'source_references', 'type'],
};

const substantiveNamespaces = new Set<SubstantiveNamespace>([
  'actors',
  'agreements',
  'events',
  'payments',
  'deliverables',
  'positions',
  'claimed_losses',
  'requested_outcomes',
  'evidence',
]);

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}

function commandStructureFailure(value: unknown): string | null {
  if (!exactKeys(value, COMMAND_KEYS))
    return 'Command must contain exactly the versioned contract keys.';
  const command = value as EnvelopeCommand;
  if (
    command.command_version !== ENVELOPE_COMMAND_VERSION ||
    !COMMAND_ID_PATTERN.test(command.command_id) ||
    !COMMAND_ID_PATTERN.test(command.case_id) ||
    !Number.isSafeInteger(command.base_envelope_version) ||
    command.base_envelope_version < 1 ||
    !/^[a-f0-9]{64}$/u.test(command.base_envelope_hash) ||
    !Array.isArray(command.operations) ||
    command.operations.length === 0 ||
    !Array.isArray(command.source_references) ||
    !exactKeys(command.authenticated_actor, [
      'actor_id',
      'actor_type',
      'authenticated_subject_id',
      'party_id',
    ]) ||
    !COMMAND_ID_PATTERN.test(command.authenticated_actor.actor_id) ||
    !COMMAND_ID_PATTERN.test(command.authenticated_actor.authenticated_subject_id) ||
    !['party', 'system', 'inspector', 'adjudicator'].includes(
      command.authenticated_actor.actor_type,
    ) ||
    ![null, 'party_a', 'party_b'].includes(command.authenticated_actor.party_id) ||
    (command.authenticated_actor.actor_type === 'party') !==
      (command.authenticated_actor.party_id !== null)
  ) {
    return 'Command identity, actor, CAS, operations, or source references are malformed.';
  }
  if (
    command.confirmation_context !== null &&
    (!exactKeys(command.confirmation_context, ['confirmation_ids']) ||
      !Array.isArray(command.confirmation_context.confirmation_ids))
  ) {
    return 'Confirmation context is malformed.';
  }
  for (const operation of command.operations) {
    if (
      !operation ||
      typeof operation !== 'object' ||
      !Object.hasOwn(OPERATION_KEYS, operation.type) ||
      !exactKeys(operation, OPERATION_KEYS[operation.type])
    ) {
      return 'Operation is absent from or malformed for the closed mutation vocabulary.';
    }
    if (
      ((operation.type === 'add_object' || operation.type === 'set_own_stance') &&
        !substantiveNamespaces.has(operation.namespace)) ||
      (operation.type === 'replace_own_field' &&
        (!substantiveNamespaces.has(operation.namespace) ||
          (operation.namespace as string) === 'evidence')) ||
      (operation.type === 'record_challenge' &&
        !substantiveNamespaces.has(operation.target_namespace))
    ) {
      return 'Operation namespace is absent from the closed substantive vocabulary.';
    }
  }
  return null;
}

function exactActor(left: AuthenticatedActor, right: AuthenticatedActor): boolean {
  return isDeepStrictEqual(left, right);
}

function sourceAuthorityFailure(
  operation: EnvelopeOperation,
  actor: AuthenticatedActor,
  registry: Record<string, SourceRecord>,
): string | null {
  const sourcesFor = (references: SourceReference[]): SourceRecord[] =>
    references
      .map((reference) => ownMapValue(registry, reference.source_id))
      .filter((source): source is SourceRecord => Boolean(source));
  if (operation.type === 'add_object') {
    const sources = sourcesFor(operation.object.authority.source_references);
    if (
      actor.actor_type === 'party' &&
      sources.some((source) => source.actor_id !== actor.actor_id)
    ) {
      return 'Party material must be grounded only in sources attributed to that party.';
    }
  }
  if (operation.type === 'record_independent_account') {
    const source = ownMapValue(registry, operation.source_reference.source_id);
    if (source?.source_type !== 'independent_account' || source.actor_id !== actor.actor_id) {
      return 'Person B independent account requires a Person B independent-account source.';
    }
  }
  if (operation.type === 'record_evidence_inspection') {
    const source = ownMapValue(registry, operation.source_reference.source_id);
    if (source?.source_type !== 'evidence_inspection' || source.actor_id !== actor.actor_id) {
      return 'Evidence inspection requires a source attributed to the authenticated inspector.';
    }
  }
  if (operation.type === 'record_challenge') {
    if (
      sourcesFor(operation.source_references).some((source) => source.actor_id !== actor.actor_id)
    ) {
      return 'A challenge must be grounded only in sources attributed to its challenging party.';
    }
  }
  if (operation.type === 'resolve_challenge') {
    if (
      sourcesFor(operation.resolution_source_references).some(
        (source) => source.actor_id !== actor.actor_id,
      )
    ) {
      return 'A challenge resolution must be grounded only in sources attributed to its owner.';
    }
  }
  return null;
}

function partyAuthorizationFailure(
  envelope: CaseEnvelope,
  actor: AuthenticatedActor,
): string | null {
  if (actor.actor_type !== 'party') return null;
  if (!actor.party_id) return 'Authenticated party actor lacks a canonical party binding.';
  const party = envelope.parties[actor.party_id];
  if (
    !party ||
    party.authenticated_subject_id !== actor.authenticated_subject_id ||
    party.authenticated_subject_id !== actor.actor_id ||
    party.identity_assurance === 'unverified'
  ) {
    return 'Party actor does not match the code-owned identity binding.';
  }
  if (party.consent_status !== 'granted' || !party.consent_event_id) {
    return 'Party has no current explicit consent binding.';
  }
  if (['non_participating', 'withdrawn'].includes(party.participation_state)) {
    return 'Party participation state does not authorize a canonical mutation.';
  }
  return null;
}

function currentConfirmation(envelope: CaseEnvelope, partyId: PartyId): ConfirmationReceipt | null {
  const receipt = envelope.formation.confirmations[partyId];
  return receipt &&
    receipt.bound_record_version === envelope.control.record_version &&
    receipt.bound_record_hash === envelope.control.record_hash
    ? receipt
    : null;
}

function allDecisionRelevantEvidenceEligible(envelope: CaseEnvelope): boolean {
  return Object.values(envelope.evidence).every(
    (evidence) =>
      !evidence.decision_relevant || evidence.adjudication_eligibility.status === 'eligible',
  );
}

function transitionGuardFailure(
  envelope: CaseEnvelope,
  definition: TransitionDefinition,
  command: EnvelopeCommand,
): string | null {
  for (const guard of definition.guards) {
    const passed = (() => {
      switch (guard) {
        case 'source_reference_present':
          return command.source_references.length > 0;
        case 'eligibility_is_eligible':
          return envelope.control.eligibility.status === 'eligible';
        case 'eligibility_is_ineligible':
          return envelope.control.eligibility.status === 'ineligible';
        case 'required_fact_profile_selected':
          return Boolean(envelope.classification.required_fact_profile);
        case 'safety_flag_present':
          return envelope.classification.safety_flags.length > 0;
        case 'no_required_fields':
          return envelope.formation.open_required_fields.length === 0;
        case 'no_lock_blockers':
          return envelope.formation.lock_blockers.length === 0;
        case 'current_person_a_confirmation':
          return currentConfirmation(envelope, 'party_a') !== null;
        case 'person_b_invited':
          return envelope.parties.party_b.participation_state === 'invited';
        case 'disclosure_embargoed':
          return envelope.formation.disclosure.detailed_a_framing === 'embargoed';
        case 'documented_non_participation_complete': {
          const record = envelope.formation.non_participation;
          return (
            envelope.control.protocol.non_participation_mode === 'advisory_only' &&
            envelope.parties.party_b.participation_state === 'non_participating' &&
            Boolean(
              record.invitation_event_id &&
              record.notice_event_id &&
              record.response_deadline &&
              record.deadline_expired_event_id &&
              ['expired', 'exhausted'].includes(record.correction_opportunity),
            )
          );
        }
        case 'no_open_challenges':
          return envelope.formation.challenges.every((challenge) => challenge.status !== 'open');
        case 'lock_mode_confirmation_guard':
          if (!currentConfirmation(envelope, 'party_a')) return false;
          if (
            currentConfirmation(envelope, 'party_b') &&
            envelope.formation.disclosure.person_b_independent_account_source_id &&
            envelope.formation.disclosure.detailed_a_framing === 'disclosed'
          ) {
            return true;
          }
          return (
            envelope.control.protocol.non_participation_mode === 'advisory_only' &&
            envelope.parties.party_b.participation_state === 'non_participating' &&
            Boolean(
              envelope.formation.non_participation.invitation_event_id &&
              envelope.formation.non_participation.notice_event_id &&
              envelope.formation.non_participation.response_deadline &&
              envelope.formation.non_participation.deadline_expired_event_id &&
              ['expired', 'exhausted'].includes(
                envelope.formation.non_participation.correction_opportunity,
              ),
            )
          );
        case 'active_lock':
          return envelope.control.lock.status === 'locked';
        default:
          return false;
      }
    })();
    if (!passed) return guard;
  }
  return null;
}

function validatePartyObjectAuthority(
  object: SubstantiveObject,
  actor: AuthenticatedActor,
  nextRecordVersion: number,
  commandId: string,
): string | null {
  if (actor.actor_type !== 'party' || !actor.party_id)
    return 'Only a party may introduce party material.';
  const authority = object.authority;
  if (
    authority.introduced_by.actor_id !== actor.actor_id ||
    authority.introduced_by.actor_type !== 'party' ||
    !['party_assertion', 'party_admission'].includes(authority.authority_kind)
  ) {
    return 'Party objects require matching attributed party authority.';
  }
  const own = authority.party_stances[actor.party_id].stance;
  const otherId: PartyId = actor.party_id === 'party_a' ? 'party_b' : 'party_a';
  if (
    own !== (authority.authority_kind === 'party_admission' ? 'admitted' : 'asserted') ||
    authority.party_stances[otherId].stance !== 'unresponded'
  ) {
    return 'New party material must preserve the introducing stance and the other party as unresponded.';
  }
  if ('position_kind' in object) {
    const expectedKind =
      object.position_kind === 'admission' ? 'party_admission' : 'party_assertion';
    if (authority.authority_kind !== expectedKind) {
      return 'Position kind and party authority kind must agree.';
    }
  }
  authority.introduced_in_record_version = nextRecordVersion;
  authority.last_material_record_version = nextRecordVersion;
  authority.last_material_command_id = commandId;
  authority.resolution_status = deriveResolutionStatus(authority.party_stances);
  authority.adjudication_eligible = true;
  return null;
}

function validateCurrencyAmount(object: SubstantiveObject): string | null {
  const candidate = object as PaymentObject | ClaimedLossObject;
  if ('amount_minor' in candidate) {
    if (
      candidate.amount_minor !== null &&
      (!Number.isSafeInteger(candidate.amount_minor) || candidate.amount_minor < 0)
    ) {
      return 'Monetary minor units must be a nonnegative safe integer or null.';
    }
    if (candidate.currency !== null && !/^[A-Z]{3}$/u.test(candidate.currency)) {
      return 'Currency must be an ISO-style three-letter uppercase code or null.';
    }
    if ((candidate.amount_minor === null) !== (candidate.currency === null)) {
      return 'Amount and currency must both be present or both be null.';
    }
  }
  return null;
}

function applyAddObject(
  envelope: CaseEnvelope,
  operation: AddObjectOperation,
  actor: AuthenticatedActor,
  nextRecordVersion: number,
  commandId: string,
): string | null {
  const shapeIssues = validateSubstantiveObjectShape(operation.namespace, operation.object);
  if (shapeIssues.length > 0) return shapeIssues[0]!.message;
  const map = namespaceMap(envelope, operation.namespace);
  const id = objectId(operation.namespace, operation.object);
  if (!COMMAND_ID_PATTERN.test(id)) return 'Object identity is missing or invalid.';
  if (Object.hasOwn(map, id)) return 'Object identity already exists.';
  const authorityFailure = validatePartyObjectAuthority(
    operation.object,
    actor,
    nextRecordVersion,
    commandId,
  );
  if (authorityFailure) return authorityFailure;
  const currencyFailure = validateCurrencyAmount(operation.object);
  if (currencyFailure) return currencyFailure;
  if (operation.namespace === 'positions') {
    const position = operation.object as PositionObject;
    if (position.party_id !== actor.party_id)
      return 'Position party must match the authenticated party.';
  }
  if (operation.namespace === 'claimed_losses') {
    const loss = operation.object as ClaimedLossObject;
    if (loss.claimant_party_id !== actor.party_id)
      return 'Claimed loss claimant must match the authenticated party.';
  }
  if (operation.namespace === 'requested_outcomes') {
    const outcome = operation.object as RequestedOutcomeObject;
    if (outcome.requesting_party_id !== actor.party_id) {
      return 'Requested outcome party must match the authenticated party.';
    }
  }
  if (operation.namespace === 'evidence') {
    const evidence = operation.object as EvidenceObject;
    if (
      evidence.submitted_by_party_id !== actor.party_id ||
      !['described_only', 'unavailable'].includes(evidence.availability) ||
      evidence.content_hash !== null ||
      evidence.inspection.status !== 'uninspected' ||
      evidence.visibility !== 'private'
    ) {
      return 'Party evidence introduction may only describe unavailable or unuploaded private evidence.';
    }
    evidence.authenticity_status = 'not_assessed';
    evidence.adjudication_eligibility = evidenceEligibility(evidence);
  }
  map[id] = cloneCanonical(operation.object);
  return null;
}

function applyReplaceOwnField(
  envelope: CaseEnvelope,
  operation: ReplaceOwnFieldOperation,
  actor: AuthenticatedActor,
  nextRecordVersion: number,
  commandId: string,
  sourceReferences: SourceReference[],
): { failure: string | null; reason?: CommandFailureReason } {
  if (actor.actor_type !== 'party' || !actor.party_id) {
    return {
      failure: 'Only a party may replace its own asserted fields.',
      reason: 'unauthorized_actor',
    };
  }
  const object = ownMapValue(namespaceMap(envelope, operation.namespace), operation.object_id);
  if (!object) return { failure: 'Target object does not exist.', reason: 'unknown_object' };
  if (object.authority.introduced_by.actor_id !== actor.actor_id) {
    return {
      failure: 'A party cannot mutate another party or system object.',
      reason: 'cross_party_mutation',
    };
  }
  if (sourceReferences.length === 0) {
    return {
      failure: 'An own-field correction requires exact party-attributed source grounding.',
      reason: 'invalid_source_reference',
    };
  }
  if (!ownFieldPermissions[operation.namespace].includes(operation.field)) {
    return {
      failure: 'Field is not in the closed own-party mutation vocabulary.',
      reason: 'invalid_operation',
    };
  }
  const record = object as unknown as Record<string, JsonValue>;
  if (!isDeepStrictEqual(record[operation.field], operation.expected_prior_value)) {
    return { failure: 'Expected prior value is stale.', reason: 'stale_prior_value' };
  }
  if (
    operation.namespace === 'deliverables' &&
    ['completion_positions', 'defect_positions'].includes(operation.field)
  ) {
    const replacement = operation.replacement_value;
    if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
      return {
        failure: 'Deliverable party-position replacement must be an object.',
        reason: 'invalid_operation',
      };
    }
    const prior = record[operation.field] as Record<string, JsonValue>;
    const next = replacement as Record<string, JsonValue>;
    const other: PartyId = actor.party_id === 'party_a' ? 'party_b' : 'party_a';
    if (!isDeepStrictEqual(prior[other], next[other])) {
      return {
        failure: 'A party cannot replace the other party position.',
        reason: 'cross_party_mutation',
      };
    }
  }
  record[operation.field] = cloneCanonical(operation.replacement_value);
  object.authority.last_material_record_version = nextRecordVersion;
  object.authority.last_material_command_id = commandId;
  object.authority.source_references = deduplicateSourceReferences([
    ...object.authority.source_references,
    ...sourceReferences,
  ]);
  return { failure: null };
}

function applySetOwnStance(
  envelope: CaseEnvelope,
  operation: SetOwnStanceOperation,
  actor: AuthenticatedActor,
  nextRecordVersion: number,
  commandId: string,
  sourceReferences: SourceReference[],
): string | null {
  if (actor.actor_type !== 'party' || !actor.party_id) return 'Only a party may set its stance.';
  const object = ownMapValue(namespaceMap(envelope, operation.namespace), operation.object_id);
  if (!object) return 'Target object does not exist.';
  if (sourceReferences.length === 0) return 'A stance update requires exact source grounding.';
  const ownsObject = object.authority.introduced_by.actor_id === actor.actor_id;
  const allowed = ownsObject
    ? ['asserted', 'admitted', 'withdrawn']
    : ['admitted', 'disputed', 'lacks_information', 'unresolved'];
  if (!allowed.includes(operation.stance))
    return 'Requested stance is not permitted for this party/object relationship.';
  object.authority.party_stances[actor.party_id] = {
    stance: operation.stance,
    response_event_id: operation.response_event_id,
  };
  object.authority.resolution_status = deriveResolutionStatus(object.authority.party_stances);
  object.authority.last_material_record_version = nextRecordVersion;
  object.authority.last_material_command_id = commandId;
  object.authority.source_references = deduplicateSourceReferences([
    ...object.authority.source_references,
    ...sourceReferences,
  ]);
  return null;
}

function lockGuardFailure(envelope: CaseEnvelope, mode: LockOperation['mode']): string | null {
  if (envelope.control.workflow_state !== 'ready_for_lock') return 'workflow_not_ready_for_lock';
  if (envelope.control.eligibility.status !== 'eligible') return 'case_not_eligible';
  const partyA = envelope.parties.party_a;
  if (
    !partyA.authenticated_subject_id ||
    partyA.identity_assurance === 'unverified' ||
    partyA.consent_status !== 'granted'
  ) {
    return 'person_a_identity_or_consent_invalid';
  }
  if (
    envelope.formation.open_required_fields.length > 0 ||
    envelope.formation.ambiguities.length > 0 ||
    envelope.formation.lock_prerequisites.length > 0 ||
    envelope.formation.lock_blockers.length > 0
  ) {
    return 'formation_blocker_present';
  }
  if (envelope.formation.challenges.some((challenge) => challenge.status === 'open')) {
    return 'open_challenge_present';
  }
  if (!allDecisionRelevantEvidenceEligible(envelope))
    return 'decision_relevant_evidence_ineligible';
  if (!currentConfirmation(envelope, 'party_a')) return 'person_a_confirmation_missing_or_stale';
  if (mode === 'bilateral') {
    const partyB = envelope.parties.party_b;
    if (
      !partyB.authenticated_subject_id ||
      partyB.identity_assurance === 'unverified' ||
      partyB.consent_status !== 'granted'
    ) {
      return 'person_b_identity_or_consent_invalid';
    }
    if (!currentConfirmation(envelope, 'party_b')) return 'person_b_confirmation_missing_or_stale';
    if (!envelope.formation.disclosure.person_b_independent_account_source_id) {
      return 'person_b_independent_account_missing';
    }
    if (envelope.formation.disclosure.detailed_a_framing !== 'disclosed') {
      return 'detailed_disclosure_incomplete';
    }
    return null;
  }
  if (envelope.control.protocol.non_participation_mode !== 'advisory_only') {
    return 'protocol_prohibits_non_participation';
  }
  if (envelope.parties.party_b.participation_state !== 'non_participating') {
    return 'person_b_not_documented_non_participating';
  }
  const nonParticipation = envelope.formation.non_participation;
  if (
    !nonParticipation.invitation_event_id ||
    !nonParticipation.notice_event_id ||
    !nonParticipation.response_deadline ||
    !nonParticipation.deadline_expired_event_id ||
    !['expired', 'exhausted'].includes(nonParticipation.correction_opportunity)
  ) {
    return 'non_participation_notice_or_deadline_incomplete';
  }
  return null;
}

function applyOperation(
  envelope: CaseEnvelope,
  operation: EnvelopeOperation,
  command: EnvelopeCommand,
  actor: AuthenticatedActor,
  nextRecordVersion: number,
): { failure: string | null; reason?: CommandFailureReason } {
  if (
    envelope.control.lock.status === 'locked' &&
    materialOperationTypes.has(operation.type) &&
    operation.type !== 'reopen_material_change'
  ) {
    return { failure: 'Locked envelopes cannot mutate in place.', reason: 'locked_envelope' };
  }
  const permission = OPERATION_PERMISSIONS.find((entry) => entry.operation === operation.type);
  if (!permission) {
    return { failure: 'Operation is not in the closed vocabulary.', reason: 'invalid_operation' };
  }
  if (
    !permission.actor_types.includes(actor.actor_type) ||
    (permission.party_scope === 'person_b_only' && actor.party_id !== 'party_b') ||
    (permission.party_scope === 'own_material' &&
      ['person_a_formation', 'person_a_confirmation'].includes(envelope.control.workflow_state) &&
      actor.party_id !== 'party_a') ||
    (permission.party_scope === 'own_material' &&
      envelope.control.workflow_state === 'person_b_independent_account' &&
      actor.party_id !== 'party_b') ||
    (operation.type === 'record_confirmation' &&
      envelope.control.workflow_state === 'person_a_confirmation' &&
      actor.party_id !== 'party_a')
  ) {
    return {
      failure: 'Operation is not permitted for this authenticated actor.',
      reason: 'unauthorized_actor',
    };
  }
  if (!permission.workflow_states.includes(envelope.control.workflow_state)) {
    return {
      failure: 'Operation is not permitted in the current workflow state.',
      reason: 'operation_not_permitted_in_state',
    };
  }
  switch (operation.type) {
    case 'add_object': {
      const failure = applyAddObject(
        envelope,
        operation,
        actor,
        nextRecordVersion,
        command.command_id,
      );
      return { failure, reason: failure ? 'invalid_operation' : undefined };
    }
    case 'replace_own_field':
      return applyReplaceOwnField(
        envelope,
        operation,
        actor,
        nextRecordVersion,
        command.command_id,
        partyMaterialSourceReferences(command),
      );
    case 'set_own_stance': {
      const failure = applySetOwnStance(
        envelope,
        operation,
        actor,
        nextRecordVersion,
        command.command_id,
        partyMaterialSourceReferences(command),
      );
      return { failure, reason: failure ? 'invalid_operation' : undefined };
    }
    case 'record_challenge': {
      if (actor.actor_type !== 'party' || !actor.party_id) {
        return {
          failure: 'Only an authenticated party may challenge an item.',
          reason: 'unauthorized_actor',
        };
      }
      if (
        envelope.formation.challenges.some(
          (challenge) => challenge.challenge_id === operation.challenge_id,
        )
      ) {
        return { failure: 'Challenge identity already exists.', reason: 'duplicate_object' };
      }
      const target = ownMapValue(
        namespaceMap(envelope, operation.target_namespace),
        operation.target_object_id,
      );
      if (!target) return { failure: 'Challenge target does not exist.', reason: 'unknown_object' };
      if (
        operation.target_field !== null &&
        !challengeFieldPermissions[operation.target_namespace].includes(operation.target_field)
      ) {
        return {
          failure: 'Challenge target field is absent from the closed field vocabulary.',
          reason: 'invalid_operation',
        };
      }
      if (target.authority.introduced_by.actor_id === actor.actor_id) {
        return { failure: 'A party cannot challenge its own object.', reason: 'invalid_operation' };
      }
      if (operation.source_references.length === 0) {
        return {
          failure: 'Challenge requires exact source grounding.',
          reason: 'invalid_operation',
        };
      }
      envelope.formation.challenges.push({
        challenge_id: operation.challenge_id,
        challenging_party_id: actor.party_id,
        target_namespace: operation.target_namespace,
        target_object_id: operation.target_object_id,
        target_field: operation.target_field,
        source_references: cloneCanonical(operation.source_references),
        status: 'open',
        resolution_event_id: null,
        resolution_source_references: [],
      });
      return { failure: null };
    }
    case 'resolve_challenge': {
      if (actor.actor_type !== 'party' || !actor.party_id) {
        return {
          failure: 'Only an authenticated party may resolve a challenge.',
          reason: 'unauthorized_actor',
        };
      }
      const challenge = envelope.formation.challenges.find(
        (candidate) => candidate.challenge_id === operation.challenge_id,
      );
      if (!challenge) return { failure: 'Challenge does not exist.', reason: 'unknown_object' };
      if (challenge.status !== 'open') {
        return { failure: 'Challenge is already closed.', reason: 'invalid_operation' };
      }
      const target = ownMapValue(
        namespaceMap(envelope, challenge.target_namespace),
        challenge.target_object_id,
      );
      if (!target) return { failure: 'Challenge target does not exist.', reason: 'unknown_object' };
      const challengerMayWithdraw =
        operation.resolution === 'withdrawn' && challenge.challenging_party_id === actor.party_id;
      const targetOwnerMayResolve =
        operation.resolution !== 'withdrawn' &&
        target.authority.introduced_by.actor_id === actor.actor_id;
      if (!challengerMayWithdraw && !targetOwnerMayResolve) {
        return {
          failure: 'Only the challenger may withdraw; only the target owner may accept or reject.',
          reason: 'cross_party_mutation',
        };
      }
      if (operation.resolution_source_references.length === 0) {
        return {
          failure: 'Challenge resolution requires exact source grounding.',
          reason: 'invalid_operation',
        };
      }
      if (operation.resolution === 'accepted') {
        const correctionPresent = command.operations.some(
          (candidate) =>
            (candidate.type === 'replace_own_field' &&
              candidate.namespace === challenge.target_namespace &&
              candidate.object_id === challenge.target_object_id &&
              candidate.field === challenge.target_field) ||
            (candidate.type === 'set_own_stance' &&
              candidate.namespace === challenge.target_namespace &&
              candidate.object_id === challenge.target_object_id),
        );
        if (!correctionPresent) {
          return {
            failure: 'Accepting a challenge requires an atomic target correction or stance update.',
            reason: 'invalid_operation',
          };
        }
      }
      challenge.status = operation.resolution;
      challenge.resolution_event_id = operation.resolution_event_id;
      challenge.resolution_source_references = cloneCanonical(
        operation.resolution_source_references,
      );
      return { failure: null };
    }
    case 'set_classification': {
      if (!isSystem(actor))
        return { failure: 'Classification is system-owned.', reason: 'unauthorized_actor' };
      if (
        operation.authority.introduced_by.actor_id !== actor.actor_id ||
        operation.authority.introduced_by.actor_type !== 'system' ||
        operation.authority.authority_kind !== 'system_observation'
      ) {
        return {
          failure: 'Classification requires matching deterministic system authority.',
          reason: 'invalid_operation',
        };
      }
      operation.authority.introduced_in_record_version = nextRecordVersion;
      operation.authority.last_material_record_version = nextRecordVersion;
      operation.authority.last_material_command_id = command.command_id;
      operation.authority.resolution_status = deriveResolutionStatus(
        operation.authority.party_stances,
      );
      operation.authority.adjudication_eligible = false;
      envelope.classification = {
        case_category: operation.case_category,
        suitability: operation.suitability,
        maturity: operation.maturity,
        safety_flags: cloneCanonical(operation.safety_flags),
        scope_flags: cloneCanonical(operation.scope_flags),
        required_fact_profile: operation.required_fact_profile,
        authority: cloneCanonical(operation.authority),
      };
      envelope.control.eligibility = {
        status: operation.suitability === 'eligible' ? 'eligible' : 'ineligible',
        reason_codes: cloneCanonical(operation.scope_flags),
      };
      return { failure: null };
    }
    case 'set_formation_requirements':
      if (!isSystem(actor))
        return {
          failure: 'Formation requirements are system-owned.',
          reason: 'unauthorized_actor',
        };
      envelope.formation.open_required_fields = cloneCanonical(operation.open_required_fields);
      envelope.formation.ambiguities = cloneCanonical(operation.ambiguities);
      envelope.formation.uncertainties = cloneCanonical(operation.uncertainties);
      envelope.formation.lock_prerequisites = cloneCanonical(operation.lock_prerequisites);
      envelope.formation.lock_blockers = cloneCanonical(operation.lock_blockers);
      return { failure: null };
    case 'set_party_identity': {
      if (!isSystem(actor)) {
        return { failure: 'Party identity is system-owned.', reason: 'unauthorized_actor' };
      }
      const party = envelope.parties[operation.party_id];
      if (operation.party_id === 'party_b' && party.participation_state === 'not_invited') {
        return {
          failure: 'Person B identity cannot be bound before an invitation.',
          reason: 'invalid_operation',
        };
      }
      if (
        party.authenticated_subject_id !== null &&
        party.authenticated_subject_id !== operation.authenticated_subject_id
      ) {
        return {
          failure: 'An existing party subject binding cannot be silently replaced.',
          reason: 'invalid_operation',
        };
      }
      party.authenticated_subject_id = operation.authenticated_subject_id;
      party.identity_assurance = operation.identity_assurance;
      party.identity_event_id = operation.identity_event_id;
      return { failure: null };
    }
    case 'record_party_consent': {
      if (!isSystem(actor)) {
        return { failure: 'Party consent is system-owned.', reason: 'unauthorized_actor' };
      }
      const party = envelope.parties[operation.party_id];
      if (operation.party_id === 'party_b' && party.participation_state === 'not_invited') {
        return {
          failure: 'Person B consent cannot be recorded before an invitation.',
          reason: 'invalid_operation',
        };
      }
      if (
        operation.consent_status === 'granted' &&
        (party.identity_assurance === 'unverified' || !party.authenticated_subject_id)
      ) {
        return {
          failure: 'Granted consent requires a prior code-owned identity binding.',
          reason: 'invalid_operation',
        };
      }
      party.consent_status = operation.consent_status;
      party.consent_event_id = operation.consent_event_id;
      return { failure: null };
    }
    case 'set_party_participation':
      if (!isSystem(actor))
        return { failure: 'Participation is system-owned.', reason: 'unauthorized_actor' };
      if (
        operation.party_id === 'party_a' &&
        !['active', 'withdrawn'].includes(operation.participation_state)
      ) {
        return {
          failure: 'Person A participation cannot use Person B invitation states.',
          reason: 'invalid_operation',
        };
      }
      if (operation.party_id === 'party_b') {
        const current = envelope.parties.party_b.participation_state;
        const allowed: Record<
          CaseEnvelope['parties']['party_b']['participation_state'],
          CaseEnvelope['parties']['party_b']['participation_state'][]
        > = {
          not_invited: ['invited', 'withdrawn'],
          invited: ['active', 'non_participating', 'withdrawn'],
          active: ['non_participating', 'withdrawn'],
          non_participating: ['active', 'withdrawn'],
          withdrawn: [],
        };
        if (!allowed[current].includes(operation.participation_state)) {
          return {
            failure: 'Person B participation transition is invalid.',
            reason: 'invalid_operation',
          };
        }
        if (operation.participation_state === 'invited' && !operation.invitation_event_id) {
          return {
            failure: 'Person B invitation requires an event identity.',
            reason: 'invalid_operation',
          };
        }
      }
      envelope.parties[operation.party_id].participation_state = operation.participation_state;
      if (operation.party_id === 'party_b' && operation.invitation_event_id) {
        envelope.formation.non_participation.invitation_event_id = operation.invitation_event_id;
      }
      return { failure: null };
    case 'set_non_participation_record':
      if (!isSystem(actor))
        return { failure: 'Non-participation is system-owned.', reason: 'unauthorized_actor' };
      if (!envelope.formation.non_participation.invitation_event_id) {
        return { failure: 'Invitation must be recorded first.', reason: 'invalid_operation' };
      }
      envelope.formation.non_participation = {
        ...envelope.formation.non_participation,
        notice_event_id: operation.notice_event_id,
        response_deadline: operation.response_deadline,
        deadline_expired_event_id: operation.deadline_expired_event_id,
        correction_opportunity: operation.correction_opportunity,
      };
      return { failure: null };
    case 'set_non_participation_policy':
      if (!isSystem(actor)) {
        return {
          failure: 'Non-participation policy is system-owned.',
          reason: 'unauthorized_actor',
        };
      }
      if (envelope.formation.non_participation.invitation_event_id !== null) {
        return {
          failure: 'Non-participation policy must be fixed before Person B is invited.',
          reason: 'invalid_operation',
        };
      }
      envelope.control.protocol.non_participation_mode = operation.mode;
      return { failure: null };
    case 'record_evidence_upload': {
      if (!isSystem(actor))
        return { failure: 'Evidence upload state is system-owned.', reason: 'unauthorized_actor' };
      const evidence = ownMapValue(envelope.evidence, operation.evidence_id);
      if (!evidence) return { failure: 'Evidence does not exist.', reason: 'unknown_object' };
      if (['withdrawn', 'superseded'].includes(evidence.availability)) {
        return {
          failure: 'Withdrawn or superseded evidence cannot be revived in place.',
          reason: 'invalid_operation',
        };
      }
      if (evidence.content_hash !== null || evidence.availability === 'uploaded') {
        return {
          failure: 'Evidence byte identity is immutable once an upload is recorded.',
          reason: 'invalid_operation',
        };
      }
      if (!/^[a-f0-9]{64}$/u.test(operation.content_hash)) {
        return {
          failure: 'Uploaded evidence requires a SHA-256 content hash.',
          reason: 'invalid_operation',
        };
      }
      evidence.availability = 'uploaded';
      evidence.content_hash = operation.content_hash;
      evidence.adjudication_eligibility = evidenceEligibility(evidence);
      evidence.authority.last_material_record_version = nextRecordVersion;
      evidence.authority.last_material_command_id = command.command_id;
      return { failure: null };
    }
    case 'record_evidence_inspection': {
      if (actor.actor_type !== 'inspector') {
        return {
          failure: 'Inspection requires an authenticated inspector.',
          reason: 'unauthorized_actor',
        };
      }
      const evidence = ownMapValue(envelope.evidence, operation.evidence_id);
      if (!evidence) return { failure: 'Evidence does not exist.', reason: 'unknown_object' };
      if (evidence.availability !== 'uploaded' || !evidence.content_hash) {
        return {
          failure: 'Only uploaded hash-bound evidence may be inspected.',
          reason: 'invalid_operation',
        };
      }
      evidence.inspection = {
        status: operation.status,
        result_id: operation.result_id,
        result_version: operation.result_version,
        result_hash: operation.result_hash,
        source_reference: cloneCanonical(operation.source_reference),
        limitations: cloneCanonical(operation.limitations),
      };
      evidence.adjudication_eligibility = evidenceEligibility(evidence);
      evidence.authority.last_material_record_version = nextRecordVersion;
      evidence.authority.last_material_command_id = command.command_id;
      return { failure: null };
    }
    case 'set_evidence_visibility': {
      if (!isSystem(actor))
        return { failure: 'Evidence visibility is system-owned.', reason: 'unauthorized_actor' };
      const evidence = ownMapValue(envelope.evidence, operation.evidence_id);
      if (!evidence) return { failure: 'Evidence does not exist.', reason: 'unknown_object' };
      evidence.visibility = operation.visibility;
      evidence.disclosure_event_ids.push(operation.disclosure_event_id);
      evidence.adjudication_eligibility = evidenceEligibility(evidence);
      evidence.authority.last_material_record_version = nextRecordVersion;
      evidence.authority.last_material_command_id = command.command_id;
      return { failure: null };
    }
    case 'record_independent_account':
      if (actor.actor_type !== 'party' || actor.party_id !== 'party_b') {
        return {
          failure: 'Only authenticated Person B may submit the independent account.',
          reason: 'unauthorized_actor',
        };
      }
      if (
        !['awaiting_person_b', 'person_b_independent_account'].includes(
          envelope.control.workflow_state,
        ) ||
        envelope.formation.disclosure.detailed_a_framing !== 'embargoed'
      ) {
        return {
          failure: 'Independent account must precede detailed disclosure.',
          reason: 'disclosure_embargo',
        };
      }
      envelope.formation.disclosure.person_b_independent_account_source_id =
        operation.source_reference.source_id;
      envelope.formation.disclosure.detailed_a_framing = 'permitted';
      envelope.parties.party_b.participation_state = 'active';
      envelope.control.workflow_state = 'disclosure_challenge';
      return { failure: null };
    case 'record_detailed_disclosure':
      if (!isSystem(actor))
        return { failure: 'Detailed disclosure is system-owned.', reason: 'unauthorized_actor' };
      if (
        !envelope.formation.disclosure.person_b_independent_account_source_id ||
        envelope.formation.disclosure.detailed_a_framing !== 'permitted'
      ) {
        return { failure: 'Detailed A framing remains embargoed.', reason: 'disclosure_embargo' };
      }
      envelope.formation.disclosure.detailed_a_framing = 'disclosed';
      envelope.formation.disclosure.disclosure_event_id = operation.event_id;
      return { failure: null };
    case 'record_confirmation': {
      if (actor.actor_type !== 'party' || !actor.party_id) {
        return {
          failure: 'Only an authenticated party may confirm.',
          reason: 'unauthorized_actor',
        };
      }
      if (
        envelope.formation.open_required_fields.length > 0 ||
        envelope.formation.lock_blockers.length > 0
      ) {
        return {
          failure: 'Open required fields or blockers prevent confirmation.',
          reason: 'confirmation_binding_invalid',
        };
      }
      envelope.formation.confirmations[actor.party_id] = {
        confirmation_id: operation.confirmation_id,
        party_id: actor.party_id,
        authenticated_subject_id: actor.authenticated_subject_id,
        bound_envelope_version: command.base_envelope_version,
        bound_envelope_hash: command.base_envelope_hash,
        bound_record_version: envelope.control.record_version,
        bound_record_hash: envelope.control.record_hash,
        scope: 'party_record',
        confirmed_at: operation.confirmed_at,
        event_id: operation.event_id,
      };
      return { failure: null };
    }
    case 'transition': {
      if (!isSystem(actor))
        return { failure: 'Transitions are system-owned.', reason: 'unauthorized_actor' };
      const definition = FORMATION_TRANSITIONS.find((entry) => entry.event === operation.event);
      if (!definition || !definition.from.includes(envelope.control.workflow_state)) {
        return {
          failure: 'Transition is not allowed from the current state.',
          reason: 'invalid_transition',
        };
      }
      const guardFailure = transitionGuardFailure(envelope, definition, command);
      if (guardFailure)
        return {
          failure: `Transition guard failed: ${guardFailure}.`,
          reason: 'invalid_transition',
        };
      envelope.control.workflow_state = definition.to;
      return { failure: null };
    }
    case 'lock': {
      if (!isSystem(actor))
        return { failure: 'Locking is system-owned.', reason: 'unauthorized_actor' };
      const guardFailure = lockGuardFailure(envelope, operation.mode);
      if (guardFailure)
        return { failure: `Lock guard failed: ${guardFailure}.`, reason: 'lock_guard_failed' };
      envelope.control.lock = {
        status: 'locked',
        mode: operation.mode,
        lock_event_id: operation.lock_event_id,
        locked_at: operation.locked_at,
        output_scope: operation.mode === 'bilateral' ? 'adjudication' : 'advisory_only',
      };
      envelope.control.workflow_state = 'locked';
      return { failure: null };
    }
    case 'reopen_material_change': {
      if (!isSystem(actor))
        return { failure: 'Reopening is system-owned.', reason: 'unauthorized_actor' };
      if (
        !['locked', 'deliberation'].includes(envelope.control.workflow_state) ||
        envelope.control.lock.status !== 'locked'
      ) {
        return {
          failure: 'Only a locked or deliberating case may reopen.',
          reason: 'invalid_transition',
        };
      }
      const priorLock: LockReceipt = {
        lock_event_id: envelope.control.lock.lock_event_id!,
        mode: envelope.control.lock.mode!,
        envelope_version: envelope.control.envelope_version,
        envelope_hash: envelope.control.envelope_hash,
        record_version: envelope.control.record_version,
        record_hash: envelope.control.record_hash,
        locked_at: envelope.control.lock.locked_at!,
        output_scope: envelope.control.lock.output_scope!,
      };
      envelope.formation.prior_locks.push(priorLock);
      envelope.formation.material_change_events.push({
        event_id: operation.event_id,
        reason: operation.reason,
        source_references: cloneCanonical(operation.source_references),
        occurred_at: operation.occurred_at,
      });
      envelope.formation.confirmations = { party_a: null, party_b: null };
      if (!envelope.formation.lock_blockers.includes('reconfirmation_required')) {
        envelope.formation.lock_blockers.push('reconfirmation_required');
      }
      envelope.control.lock = {
        status: 'unlocked',
        mode: null,
        lock_event_id: null,
        locked_at: null,
        output_scope: null,
      };
      envelope.control.workflow_state = 'reconciliation';
      return { failure: null };
    }
  }
}

export function applyEnvelopeCommand(input: ApplyEnvelopeCommandInput): ApplyEnvelopeCommandResult {
  let commandHash = '';
  try {
    commandHash = sha256(canonicalSerialize(input.command));
    canonicalSerialize(input.envelope);
    canonicalSerialize(input.ledger);
  } catch (error) {
    return rejected(
      input,
      commandHash,
      'invalid_command',
      error instanceof Error ? error.message : 'Command is not plain JSON.',
    );
  }
  const command = cloneCanonical(input.command);
  const structureFailure = commandStructureFailure(command);
  if (structureFailure) {
    return rejected(input, commandHash, 'invalid_command', structureFailure);
  }
  if (!exactActor(command.authenticated_actor, input.authenticated_actor)) {
    return rejected(
      input,
      commandHash,
      'authentication_mismatch',
      'Authenticated execution context does not match the command actor.',
    );
  }
  const inputEnvelopeIssues = validateCaseEnvelope(input.envelope);
  if (inputEnvelopeIssues.length > 0) {
    return rejected(
      input,
      commandHash,
      'invalid_envelope',
      `${inputEnvelopeIssues[0]!.code}: ${inputEnvelopeIssues[0]!.message}`,
    );
  }
  if (command.case_id !== input.envelope.control.case_id) {
    return rejected(
      input,
      commandHash,
      'case_mismatch',
      'Command case does not match the envelope.',
    );
  }
  const existing = ownMapValue(input.ledger, command.command_id);
  if (existing) {
    if (existing.command_hash !== commandHash) {
      return rejected(
        input,
        commandHash,
        'duplicate_command_conflict',
        'Command ID was already used with a different canonical payload.',
      );
    }
    return {
      status: 'idempotent',
      reason_code: null,
      message: 'Identical command retry produced no second mutation.',
      envelope: cloneCanonical(input.envelope),
      ledger: cloneCanonical(input.ledger),
      command_hash: commandHash,
      prior_envelope_version: input.envelope.control.envelope_version,
      prior_envelope_hash: input.envelope.control.envelope_hash,
      resulting_envelope_version: input.envelope.control.envelope_version,
      resulting_envelope_hash: input.envelope.control.envelope_hash,
      material_record_changed: false,
    };
  }
  const authorizationFailure = partyAuthorizationFailure(input.envelope, input.authenticated_actor);
  if (authorizationFailure) {
    return rejected(input, commandHash, 'unauthorized_actor', authorizationFailure);
  }
  if (command.base_envelope_version !== input.envelope.control.envelope_version) {
    return rejected(input, commandHash, 'stale_base_version', 'Command base version is stale.');
  }
  if (command.base_envelope_hash !== input.envelope.control.envelope_hash) {
    return rejected(input, commandHash, 'stale_base_hash', 'Command base hash is stale.');
  }
  const currentConfirmationIds = (['party_a', 'party_b'] as const)
    .map((partyId) => currentConfirmation(input.envelope, partyId)?.confirmation_id)
    .filter((confirmationId): confirmationId is string => Boolean(confirmationId))
    .sort();
  if (
    (command.confirmation_context !== null &&
      !isDeepStrictEqual(
        [...command.confirmation_context.confirmation_ids].sort(),
        currentConfirmationIds,
      )) ||
    (command.operations.some((operation) => operation.type === 'lock') &&
      command.confirmation_context === null)
  ) {
    return rejected(
      input,
      commandHash,
      'confirmation_binding_invalid',
      'Confirmation context must exactly bind the current receipt identities; lock commands require it.',
    );
  }
  const sourceReferences = [
    ...command.source_references,
    ...command.operations.flatMap((operation) => {
      if (operation.type === 'record_evidence_inspection') return [operation.source_reference];
      if (operation.type === 'record_independent_account') return [operation.source_reference];
      if (operation.type === 'record_challenge') return operation.source_references;
      if (operation.type === 'resolve_challenge') return operation.resolution_source_references;
      if (operation.type === 'reopen_material_change') return operation.source_references;
      if (operation.type === 'add_object') return operation.object.authority.source_references;
      if (operation.type === 'set_classification') return operation.authority.source_references;
      return [];
    }),
  ];
  if (
    sourceReferences.some(
      (reference) => validateSourceReference(reference, input.source_registry).length > 0,
    )
  ) {
    return rejected(
      input,
      commandHash,
      'invalid_source_reference',
      'At least one source reference is absent, stale, or not exact.',
    );
  }
  if (
    input.authenticated_actor.actor_type === 'party' &&
    command.source_references.some(
      (reference) =>
        ownMapValue(input.source_registry, reference.source_id)?.actor_id !==
        input.authenticated_actor.actor_id,
    )
  ) {
    return rejected(
      input,
      commandHash,
      'invalid_source_reference',
      'Party command sources must be attributed to the authenticated party.',
    );
  }
  for (const operation of command.operations) {
    const sourceFailure = sourceAuthorityFailure(
      operation,
      input.authenticated_actor,
      input.source_registry,
    );
    if (sourceFailure) {
      return rejected(input, commandHash, 'invalid_source_reference', sourceFailure);
    }
  }
  const materialChanged = command.operations.some((operation) =>
    materialOperationTypes.has(operation.type),
  );
  const nextRecordVersion = input.envelope.control.record_version + (materialChanged ? 1 : 0);
  const candidate = cloneCanonical(input.envelope);
  for (const operation of command.operations) {
    const applied = applyOperation(
      candidate,
      operation,
      command,
      input.authenticated_actor,
      nextRecordVersion,
    );
    if (applied.failure) {
      return rejected(
        input,
        commandHash,
        applied.reason ?? 'atomic_command_rejected',
        applied.failure,
      );
    }
  }
  if (materialChanged) {
    candidate.control.record_version = nextRecordVersion;
    candidate.formation.confirmations = { party_a: null, party_b: null };
    candidate.control.record_hash = hashCaseRecord(candidate);
  }
  candidate.control.envelope_version += 1;
  candidate.control.envelope_hash = hashCaseEnvelope(candidate);
  const resultingIssues = validateCaseEnvelope(candidate);
  if (resultingIssues.length > 0) {
    return rejected(
      input,
      commandHash,
      'resulting_envelope_invalid',
      `${resultingIssues[0]!.code}: ${resultingIssues[0]!.message}`,
    );
  }
  const nextLedger = cloneCanonical(input.ledger);
  nextLedger[command.command_id] = {
    command_hash: commandHash,
    result_envelope_version: candidate.control.envelope_version,
    result_envelope_hash: candidate.control.envelope_hash,
  };
  return {
    status: 'applied',
    reason_code: null,
    message: 'Command applied atomically.',
    envelope: candidate,
    ledger: nextLedger,
    command_hash: commandHash,
    prior_envelope_version: input.envelope.control.envelope_version,
    prior_envelope_hash: input.envelope.control.envelope_hash,
    resulting_envelope_version: candidate.control.envelope_version,
    resulting_envelope_hash: candidate.control.envelope_hash,
    material_record_changed: materialChanged,
  };
}

export function commandFor(
  envelope: CaseEnvelope,
  actor: AuthenticatedActor,
  commandId: string,
  operations: EnvelopeOperation[],
  sourceReferences: SourceReference[],
): EnvelopeCommand {
  const confirmationIds = (['party_a', 'party_b'] as const)
    .map((partyId) => currentConfirmation(envelope, partyId)?.confirmation_id)
    .filter((confirmationId): confirmationId is string => Boolean(confirmationId))
    .sort();
  return {
    command_version: ENVELOPE_COMMAND_VERSION,
    command_id: commandId,
    authenticated_actor: cloneCanonical(actor),
    case_id: envelope.control.case_id,
    base_envelope_version: envelope.control.envelope_version,
    base_envelope_hash: envelope.control.envelope_hash,
    operations: cloneCanonical(operations),
    source_references: cloneCanonical(sourceReferences),
    confirmation_context: operations.some((operation) => operation.type === 'lock')
      ? { confirmation_ids: confirmationIds }
      : null,
  };
}
