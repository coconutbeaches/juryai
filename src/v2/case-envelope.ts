import { createHash } from 'node:crypto';

export const CASE_ENVELOPE_SCHEMA_VERSION = 'juryai-case-envelope-v2.0.0';
export const CASE_ENVELOPE_PROTOCOL_VERSION = 'juryai-formation-protocol-v2.0.0';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PartyId = 'party_a' | 'party_b';
export type ActorType = 'party' | 'system' | 'inspector' | 'adjudicator';
export type WorkflowState =
  | 'initial_story'
  | 'triage'
  | 'person_a_formation'
  | 'person_a_confirmation'
  | 'awaiting_person_b'
  | 'person_b_independent_account'
  | 'disclosure_challenge'
  | 'reconciliation'
  | 'final_confirmation'
  | 'ready_for_lock'
  | 'locked'
  | 'deliberation'
  | 'resolved'
  | 'unresolved'
  | 'unsuitable'
  | 'unsafe'
  | 'withdrawn';

export type AuthorityKind =
  | 'party_assertion'
  | 'party_admission'
  | 'bilateral_agreement'
  | 'system_observation'
  | 'inspected_evidence_derived'
  | 'adjudicative_finding'
  | 'other_typed_authority';

export type PartyStance =
  | 'asserted'
  | 'admitted'
  | 'disputed'
  | 'unresolved'
  | 'lacks_information'
  | 'unresponded'
  | 'withdrawn';

export type ResolutionStatus = 'bilaterally_agreed' | 'disputed' | 'unresolved' | 'withdrawn';
export type SubstantiveNamespace =
  | 'agreements'
  | 'events'
  | 'payments'
  | 'deliverables'
  | 'positions'
  | 'claimed_losses'
  | 'requested_outcomes'
  | 'evidence';

export interface AuthenticatedActor {
  actor_id: string;
  actor_type: ActorType;
  party_id: PartyId | null;
  authenticated_subject_id: string;
}

export interface SourceSpan {
  encoding: 'utf16';
  start: number;
  end: number;
  quote: string;
}

export interface SourceReference {
  source_id: string;
  source_hash: string;
  span: SourceSpan | null;
}

export interface SourceRecord {
  source_id: string;
  source_type:
    | 'initial_story'
    | 'clarification_answer'
    | 'independent_account'
    | 'challenge'
    | 'evidence_inspection'
    | 'system_event'
    | 'authoritative_record';
  actor_id: string | null;
  content: string;
  content_hash: string;
}

export interface PartyStanceRecord {
  stance: PartyStance;
  response_event_id: string | null;
}

export interface ObjectAuthority {
  introduced_by: {
    actor_id: string;
    actor_type: ActorType;
  };
  authority_kind: AuthorityKind;
  authority_detail: string | null;
  subject_actor_ids: string[];
  source_references: SourceReference[];
  evidence_ids: string[];
  party_stances: Record<PartyId, PartyStanceRecord>;
  resolution_status: ResolutionStatus;
  adjudication_eligible: boolean;
  introduced_in_record_version: number;
  last_material_record_version: number;
  last_material_command_id: string;
}

export interface PartyRecord {
  party_id: PartyId;
  role: 'person_a' | 'person_b';
  authenticated_subject_id: string | null;
  identity_assurance: 'unverified' | 'authenticated' | 'verified';
  consent_status: 'not_requested' | 'pending' | 'granted' | 'declined';
  consent_event_id: string | null;
  participation_state:
    'not_invited' | 'invited' | 'active' | 'confirmed' | 'non_participating' | 'withdrawn';
}

export interface NonPartyActor {
  actor_id: string;
  display_label: string;
  asserted_role: string;
  identity_assurance: 'unverified' | 'verified';
}

export interface ClassificationRecord {
  case_category: string | null;
  suitability: 'undetermined' | 'eligible' | 'ineligible';
  maturity: 'undetermined' | 'immature' | 'ready';
  safety_flags: string[];
  scope_flags: string[];
  required_fact_profile: string | null;
  authority: ObjectAuthority;
}

export interface AgreementObject {
  obligation_id: string;
  obligation_type: string;
  obligor_actor_id: string | null;
  obligee_actor_id: string | null;
  description: string;
  conditions: string[];
  linked_event_ids: string[];
  linked_deliverable_ids: string[];
  linked_payment_ids: string[];
  authority: ObjectAuthority;
}

export interface DateValue {
  start: string | null;
  end: string | null;
  precision: 'day' | 'month' | 'year' | 'range' | 'unknown';
  approximate: boolean;
}

export interface EventObject {
  event_id: string;
  event_type:
    | 'delivery'
    | 'non_delivery'
    | 'communication'
    | 'cancellation'
    | 'refusal'
    | 'damage'
    | 'service_performed'
    | 'deadline_passage'
    | 'other';
  actor_ids: string[];
  date: DateValue;
  description: string;
  linked_obligation_ids: string[];
  linked_deliverable_ids: string[];
  linked_payment_ids: string[];
  authority: ObjectAuthority;
}

export interface PaymentObject {
  payment_id: string;
  amount_minor: number | null;
  currency: string | null;
  from_actor_id: string | null;
  to_actor_id: string | null;
  payment_status: 'unknown' | 'not_due' | 'due' | 'paid' | 'unpaid' | 'partly_paid' | 'disputed';
  due_trigger: string | null;
  linked_obligation_ids: string[];
  linked_event_ids: string[];
  linked_deliverable_ids: string[];
  authority: ObjectAuthority;
}

export interface DeliverableObject {
  deliverable_id: string;
  name: string;
  expected_scope: string;
  responsible_actor_id: string | null;
  completion_positions: Record<PartyId, string | null>;
  defect_positions: Record<PartyId, string[]>;
  linked_obligation_ids: string[];
  linked_event_ids: string[];
  linked_evidence_ids: string[];
  authority: ObjectAuthority;
}

export interface PositionObject {
  position_id: string;
  party_id: PartyId;
  position_kind: 'assertion' | 'admission' | 'denial' | 'uncertainty';
  target: {
    namespace: Exclude<SubstantiveNamespace, 'positions'>;
    object_id: string;
    field: string | null;
  } | null;
  statement: string;
  authority: ObjectAuthority;
}

export interface ClaimedLossObject {
  loss_id: string;
  claimant_party_id: PartyId;
  loss_type: string;
  amount_minor: number | null;
  currency: string | null;
  non_monetary_description: string | null;
  causal_reference_ids: string[];
  supporting_evidence_ids: string[];
  authority: ObjectAuthority;
}

export interface RequestedOutcomeObject {
  outcome_id: string;
  requesting_party_id: PartyId;
  outcome_type: string;
  description: string;
  transfers: Array<{
    from_actor_id: string;
    to_actor_id: string;
    amount_minor: number | null;
    currency: string | null;
  }>;
  conditions: string[];
  priority: number;
  authority: ObjectAuthority;
}

export interface EvidenceObject {
  evidence_id: string;
  submitted_by_party_id: PartyId;
  asserted_author_actor_id: string | null;
  evidence_type: string;
  content_hash: string | null;
  availability: 'described_only' | 'uploaded' | 'unavailable' | 'withdrawn' | 'superseded';
  visibility: 'private' | 'eligible_for_disclosure' | 'disclosed_to_both' | 'withheld';
  disclosure_event_ids: string[];
  inspection: {
    status: 'uninspected' | 'inspected_complete' | 'inspected_incomplete' | 'unreadable';
    result_id: string | null;
    result_version: string | null;
    result_hash: string | null;
    source_reference: SourceReference | null;
    limitations: string[];
  };
  authenticity_status: 'not_assessed' | 'not_assessable' | 'disputed';
  decision_relevant: boolean;
  adjudication_eligibility: {
    status: 'eligible' | 'ineligible';
    reasons: EvidenceIneligibilityReason[];
  };
  supersedes_evidence_id: string | null;
  authority: ObjectAuthority;
}

export type EvidenceIneligibilityReason =
  | 'not_uploaded'
  | 'uninspected'
  | 'inspection_incomplete'
  | 'unreadable'
  | 'not_disclosed_to_both'
  | 'withdrawn_or_superseded';

export interface ConfirmationReceipt {
  confirmation_id: string;
  party_id: PartyId;
  bound_envelope_version: number;
  bound_envelope_hash: string;
  bound_record_version: number;
  bound_record_hash: string;
  scope: 'party_record';
  confirmed_at: string;
  event_id: string;
}

export interface ChallengeRecord {
  challenge_id: string;
  challenging_party_id: PartyId;
  target_namespace: SubstantiveNamespace;
  target_object_id: string;
  target_field: string | null;
  source_references: SourceReference[];
  status: 'open' | 'accepted' | 'rejected' | 'withdrawn';
  resolution_event_id: string | null;
  resolution_source_references: SourceReference[];
}

export interface LockReceipt {
  lock_event_id: string;
  mode: 'bilateral' | 'documented_non_participation';
  envelope_version: number;
  envelope_hash: string;
  record_version: number;
  record_hash: string;
  locked_at: string;
  output_scope: 'adjudication' | 'advisory_only';
}

export interface FormationState {
  open_required_fields: string[];
  ambiguities: string[];
  uncertainties: string[];
  confirmations: Record<PartyId, ConfirmationReceipt | null>;
  challenges: ChallengeRecord[];
  disclosure: {
    person_b_independent_account_source_id: string | null;
    detailed_a_framing: 'embargoed' | 'permitted' | 'disclosed';
    disclosure_event_id: string | null;
  };
  non_participation: {
    invitation_event_id: string | null;
    notice_event_id: string | null;
    response_deadline: string | null;
    deadline_expired_event_id: string | null;
    correction_opportunity: 'not_started' | 'open' | 'expired' | 'exhausted';
  };
  lock_prerequisites: string[];
  lock_blockers: string[];
  prior_locks: LockReceipt[];
  material_change_events: Array<{
    event_id: string;
    reason: string;
    source_references: SourceReference[];
    occurred_at: string;
  }>;
}

export interface CaseEnvelope {
  control: {
    schema_version: typeof CASE_ENVELOPE_SCHEMA_VERSION;
    case_id: string;
    workflow_state: WorkflowState;
    envelope_version: number;
    envelope_hash: string;
    record_version: number;
    record_hash: string;
    protocol: {
      protocol_id: string;
      protocol_version: typeof CASE_ENVELOPE_PROTOCOL_VERSION;
      non_participation_mode: 'prohibited' | 'advisory_only';
    };
    deadlines: Record<string, string>;
    eligibility: {
      status: 'undetermined' | 'eligible' | 'ineligible';
      reason_codes: string[];
    };
    lock: {
      status: 'unlocked' | 'locked';
      mode: 'bilateral' | 'documented_non_participation' | null;
      lock_event_id: string | null;
      locked_at: string | null;
      output_scope: 'adjudication' | 'advisory_only' | null;
    };
  };
  parties: Record<PartyId, PartyRecord>;
  actors: Record<string, NonPartyActor>;
  classification: ClassificationRecord;
  agreements: Record<string, AgreementObject>;
  events: Record<string, EventObject>;
  payments: Record<string, PaymentObject>;
  deliverables: Record<string, DeliverableObject>;
  positions: Record<string, PositionObject>;
  claimed_losses: Record<string, ClaimedLossObject>;
  requested_outcomes: Record<string, RequestedOutcomeObject>;
  evidence: Record<string, EvidenceObject>;
  formation: FormationState;
}

export interface ContractIssue {
  code: string;
  path: string;
  message: string;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const authorityKinds = new Set<AuthorityKind>([
  'party_assertion',
  'party_admission',
  'bilateral_agreement',
  'system_observation',
  'inspected_evidence_derived',
  'adjudicative_finding',
  'other_typed_authority',
]);
const stances = new Set<PartyStance>([
  'asserted',
  'admitted',
  'disputed',
  'unresolved',
  'lacks_information',
  'unresponded',
  'withdrawn',
]);

interface CanonicalContext {
  active: WeakSet<object>;
  nodes: number;
}

function canonicalize(value: unknown, context: CanonicalContext, depth: number): JsonValue {
  if (depth > 64) throw new TypeError('JSON depth exceeds 64.');
  context.nodes += 1;
  if (context.nodes > 100_000) throw new TypeError('JSON value exceeds 100000 nodes.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw new TypeError('Value is not plain JSON.');
  if (context.active.has(value)) throw new TypeError('JSON value contains a cycle.');
  context.active.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) throw new TypeError('Arrays must use Array.prototype.');
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key === 'symbol'))
        throw new TypeError('Symbols are forbidden.');
      const stringKeys = keys.filter((key): key is string => typeof key === 'string');
      const numericKeys = stringKeys.filter((key) => /^(0|[1-9][0-9]*)$/u.test(key));
      if (
        stringKeys.some((key) => key !== 'length' && !numericKeys.includes(key)) ||
        numericKeys.length !== value.length
      ) {
        throw new TypeError('Arrays must be dense and have no custom properties.');
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor))
          throw new TypeError('Array accessors are forbidden.');
        result.push(canonicalize(descriptor.value, context, depth + 1));
      }
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Objects must be plain JSON objects.');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === 'symbol')) throw new TypeError('Symbols are forbidden.');
    const result: Record<string, JsonValue> = {};
    for (const key of (keys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError('Object accessors and non-enumerable fields are forbidden.');
      }
      result[key] = canonicalize(descriptor.value, context, depth + 1);
    }
    return result;
  } finally {
    context.active.delete(value);
  }
}

export function canonicalSerialize(value: unknown): string {
  return `${JSON.stringify(canonicalize(value, { active: new WeakSet(), nodes: 0 }, 0), null, 2)}\n`;
}

export function cloneCanonical<T>(value: T): T {
  return JSON.parse(canonicalSerialize(value)) as T;
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashSourceContent(content: string): string {
  return sha256(content);
}

function envelopeHashProjection(envelope: CaseEnvelope): JsonValue {
  const projection = cloneCanonical(envelope) as unknown as Record<string, JsonValue>;
  const control = projection.control as Record<string, JsonValue>;
  delete control.envelope_hash;
  return projection;
}

function recordHashProjection(envelope: CaseEnvelope): JsonValue {
  return {
    record_version: envelope.control.record_version,
    protocol: envelope.control.protocol,
    parties: envelope.parties,
    actors: envelope.actors,
    classification: envelope.classification,
    agreements: envelope.agreements,
    events: envelope.events,
    payments: envelope.payments,
    deliverables: envelope.deliverables,
    positions: envelope.positions,
    claimed_losses: envelope.claimed_losses,
    requested_outcomes: envelope.requested_outcomes,
    evidence: envelope.evidence,
    formation: {
      open_required_fields: envelope.formation.open_required_fields,
      ambiguities: envelope.formation.ambiguities,
      uncertainties: envelope.formation.uncertainties,
      challenges: envelope.formation.challenges,
      disclosure: envelope.formation.disclosure,
      non_participation: envelope.formation.non_participation,
      lock_prerequisites: envelope.formation.lock_prerequisites,
      lock_blockers: envelope.formation.lock_blockers,
      prior_locks: envelope.formation.prior_locks,
      material_change_events: envelope.formation.material_change_events,
    },
  } as unknown as JsonValue;
}

export function hashCaseEnvelope(envelope: CaseEnvelope): string {
  return sha256(canonicalSerialize(envelopeHashProjection(envelope)));
}

export function hashCaseRecord(envelope: CaseEnvelope): string {
  return sha256(canonicalSerialize(recordHashProjection(envelope)));
}

export function deriveResolutionStatus(
  partyStances: Record<PartyId, PartyStanceRecord>,
): ResolutionStatus {
  const values = [partyStances.party_a.stance, partyStances.party_b.stance];
  if (values.every((value) => value === 'withdrawn')) return 'withdrawn';
  if (values.includes('disputed')) return 'disputed';
  const partyAAdopts = ['asserted', 'admitted'].includes(partyStances.party_a.stance);
  const partyBAdopts = ['asserted', 'admitted'].includes(partyStances.party_b.stance);
  if (partyAAdopts && partyBAdopts) return 'bilaterally_agreed';
  return 'unresolved';
}

export function evidenceIneligibilityReasons(
  evidence: EvidenceObject,
): EvidenceIneligibilityReason[] {
  const reasons: EvidenceIneligibilityReason[] = [];
  if (['withdrawn', 'superseded'].includes(evidence.availability)) {
    reasons.push('withdrawn_or_superseded');
  } else if (evidence.availability !== 'uploaded') {
    reasons.push('not_uploaded');
  }
  if (evidence.inspection.status === 'uninspected') reasons.push('uninspected');
  if (evidence.inspection.status === 'inspected_incomplete') reasons.push('inspection_incomplete');
  if (evidence.inspection.status === 'unreadable') reasons.push('unreadable');
  if (evidence.visibility !== 'disclosed_to_both') reasons.push('not_disclosed_to_both');
  return [...new Set(reasons)].sort();
}

export function evidenceEligibility(
  evidence: EvidenceObject,
): EvidenceObject['adjudication_eligibility'] {
  const reasons = evidenceIneligibilityReasons(evidence);
  return { status: reasons.length === 0 ? 'eligible' : 'ineligible', reasons };
}

function authorityIssues(
  authority: unknown,
  path: string,
  parties: Record<PartyId, PartyRecord>,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const add = (code: string, suffix: string, message: string): void => {
    issues.push({ code, path: `${path}${suffix}`, message });
  };
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    add('authority_missing', '', 'Every substantive object requires authority metadata.');
    return issues;
  }
  const value = authority as ObjectAuthority;
  if (!value.introduced_by || !ID_PATTERN.test(value.introduced_by.actor_id ?? '')) {
    add(
      'authority_actor_invalid',
      '.introduced_by',
      'Authority requires a typed introducing actor.',
    );
  }
  if (!authorityKinds.has(value.authority_kind)) {
    add(
      'authority_kind_invalid',
      '.authority_kind',
      'Canonical authority cannot be an untyped or model-inference authority.',
    );
  }
  if (!Array.isArray(value.source_references) || value.source_references.length === 0) {
    add(
      'authority_source_missing',
      '.source_references',
      'Authority requires at least one source reference.',
    );
  } else {
    value.source_references.forEach((reference, index) => {
      if (
        !reference ||
        !ID_PATTERN.test(reference.source_id ?? '') ||
        !HASH_PATTERN.test(reference.source_hash ?? '')
      ) {
        add(
          'authority_source_invalid',
          `.source_references[${index}]`,
          'Source references require a valid ID and SHA-256 hash.',
        );
      }
      if (reference?.span) {
        const span = reference.span;
        if (
          span.encoding !== 'utf16' ||
          !Number.isInteger(span.start) ||
          !Number.isInteger(span.end) ||
          span.start < 0 ||
          span.end < span.start ||
          span.end - span.start !== span.quote.length
        ) {
          add(
            'authority_span_invalid',
            `.source_references[${index}].span`,
            'Source spans use exact UTF-16 offsets and quote length.',
          );
        }
      }
    });
  }
  for (const partyId of ['party_a', 'party_b'] as const) {
    const stance = value.party_stances?.[partyId];
    if (!stance || !stances.has(stance.stance)) {
      add('party_stance_invalid', `.party_stances.${partyId}`, 'Both party stances are required.');
    }
  }
  if (
    value.party_stances &&
    value.resolution_status !== deriveResolutionStatus(value.party_stances)
  ) {
    add(
      'resolution_status_invalid',
      '.resolution_status',
      'Resolution status must be derived from explicit party stances; silence is never agreement.',
    );
  }
  if (value.authority_kind === 'party_assertion' || value.authority_kind === 'party_admission') {
    const introducingParty = (['party_a', 'party_b'] as const).find(
      (partyId) => parties[partyId].authenticated_subject_id === value.introduced_by.actor_id,
    );
    if (!introducingParty) {
      add(
        'party_authority_unbound',
        '.introduced_by',
        'Party authority must bind to an authenticated party subject.',
      );
    }
  }
  if (
    !Number.isSafeInteger(value.introduced_in_record_version) ||
    !Number.isSafeInteger(value.last_material_record_version) ||
    value.introduced_in_record_version < 1 ||
    value.last_material_record_version < value.introduced_in_record_version ||
    !ID_PATTERN.test(value.last_material_command_id ?? '')
  ) {
    add(
      'authority_version_invalid',
      '',
      'Authority must identify the introducing and last material record versions and command.',
    );
  }
  return issues;
}

function mapObjectIssues<T extends { authority: ObjectAuthority }>(
  map: Record<string, T>,
  namespace: string,
  idField: keyof T,
  parties: Record<PartyId, PartyRecord>,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  for (const [id, object] of Object.entries(map)) {
    if (!ID_PATTERN.test(id) || object[idField] !== id) {
      issues.push({
        code: 'object_identity_invalid',
        path: `$.${namespace}.${id}`,
        message: 'Map key and object identity must be the same valid identifier.',
      });
    }
    issues.push(...authorityIssues(object.authority, `$.${namespace}.${id}.authority`, parties));
  }
  return issues;
}

export function validateSourceReference(
  reference: SourceReference,
  registry: Record<string, SourceRecord>,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const source = registry[reference.source_id];
  if (
    !source ||
    source.content_hash !== reference.source_hash ||
    hashSourceContent(source.content) !== source.content_hash
  ) {
    issues.push({
      code: 'source_reference_invalid',
      path: '$.source_references',
      message: 'Source reference is absent or does not match the registered content hash.',
    });
    return issues;
  }
  if (reference.span) {
    const { start, end, quote } = reference.span;
    if (
      reference.span.encoding !== 'utf16' ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > source.content.length ||
      end - start !== quote.length ||
      source.content.slice(start, end) !== quote
    ) {
      issues.push({
        code: 'source_span_invalid',
        path: '$.source_references.span',
        message: 'Source span must exactly match registered UTF-16 content.',
      });
    }
  }
  return issues;
}

function validateCaseEnvelopeUnchecked(value: unknown): ContractIssue[] {
  try {
    canonicalSerialize(value);
  } catch (error) {
    return [
      {
        code: 'envelope_not_plain_json',
        path: '$',
        message: error instanceof Error ? error.message : 'Envelope is not plain JSON.',
      },
    ];
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [{ code: 'envelope_invalid', path: '$', message: 'Envelope must be an object.' }];
  }
  const envelope = value as CaseEnvelope;
  const issues: ContractIssue[] = [];
  const add = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  if (envelope.control?.schema_version !== CASE_ENVELOPE_SCHEMA_VERSION) {
    add(
      'schema_version_invalid',
      '$.control.schema_version',
      'Unsupported Case Envelope schema version.',
    );
  }
  if (!ID_PATTERN.test(envelope.control?.case_id ?? '')) {
    add('case_id_invalid', '$.control.case_id', 'Case ID must be a bounded identifier.');
  }
  if (
    !Number.isSafeInteger(envelope.control?.envelope_version) ||
    envelope.control.envelope_version < 1 ||
    !Number.isSafeInteger(envelope.control?.record_version) ||
    envelope.control.record_version < 1
  ) {
    add(
      'version_invalid',
      '$.control',
      'Envelope and record versions must be positive safe integers.',
    );
  }
  if (
    !HASH_PATTERN.test(envelope.control?.record_hash ?? '') ||
    envelope.control.record_hash !== hashCaseRecord(envelope)
  ) {
    add(
      'record_hash_invalid',
      '$.control.record_hash',
      'Record hash must match canonical material state.',
    );
  }
  if (
    !HASH_PATTERN.test(envelope.control?.envelope_hash ?? '') ||
    envelope.control.envelope_hash !== hashCaseEnvelope(envelope)
  ) {
    add(
      'envelope_hash_invalid',
      '$.control.envelope_hash',
      'Envelope hash must match canonical complete state.',
    );
  }
  for (const partyId of ['party_a', 'party_b'] as const) {
    const party = envelope.parties?.[partyId];
    if (
      !party ||
      party.party_id !== partyId ||
      party.role !== (partyId === 'party_a' ? 'person_a' : 'person_b')
    ) {
      add('party_invalid', `$.parties.${partyId}`, 'Both canonical party records are required.');
    }
  }
  if (envelope.classification?.authority) {
    issues.push(
      ...authorityIssues(
        envelope.classification.authority,
        '$.classification.authority',
        envelope.parties,
      ),
    );
  } else {
    add(
      'authority_missing',
      '$.classification.authority',
      'Classification requires authority metadata.',
    );
  }
  issues.push(
    ...mapObjectIssues(envelope.agreements ?? {}, 'agreements', 'obligation_id', envelope.parties),
    ...mapObjectIssues(envelope.events ?? {}, 'events', 'event_id', envelope.parties),
    ...mapObjectIssues(envelope.payments ?? {}, 'payments', 'payment_id', envelope.parties),
    ...mapObjectIssues(
      envelope.deliverables ?? {},
      'deliverables',
      'deliverable_id',
      envelope.parties,
    ),
    ...mapObjectIssues(envelope.positions ?? {}, 'positions', 'position_id', envelope.parties),
    ...mapObjectIssues(
      envelope.claimed_losses ?? {},
      'claimed_losses',
      'loss_id',
      envelope.parties,
    ),
    ...mapObjectIssues(
      envelope.requested_outcomes ?? {},
      'requested_outcomes',
      'outcome_id',
      envelope.parties,
    ),
    ...mapObjectIssues(envelope.evidence ?? {}, 'evidence', 'evidence_id', envelope.parties),
  );
  for (const [evidenceId, evidence] of Object.entries(envelope.evidence ?? {})) {
    const expected = evidenceEligibility(evidence);
    if (canonicalSerialize(expected) !== canonicalSerialize(evidence.adjudication_eligibility)) {
      add(
        'evidence_eligibility_invalid',
        `$.evidence.${evidenceId}.adjudication_eligibility`,
        'Evidence eligibility must be derived from availability, inspection, and disclosure state.',
      );
    }
    if (evidence.content_hash !== null && !HASH_PATTERN.test(evidence.content_hash)) {
      add(
        'evidence_hash_invalid',
        `$.evidence.${evidenceId}.content_hash`,
        'Evidence hash must be SHA-256.',
      );
    }
    if (
      ['disclosed_to_both', 'withheld'].includes(evidence.visibility) &&
      (!Array.isArray(evidence.disclosure_event_ids) || evidence.disclosure_event_ids.length === 0)
    ) {
      add(
        'evidence_disclosure_event_missing',
        `$.evidence.${evidenceId}.disclosure_event_ids`,
        'A disclosure or withholding decision requires an auditable event identity.',
      );
    }
    if (
      evidence.inspection.status !== 'uninspected' &&
      (!evidence.inspection.result_id ||
        !evidence.inspection.result_version ||
        !HASH_PATTERN.test(evidence.inspection.result_hash ?? '') ||
        !evidence.inspection.source_reference)
    ) {
      add(
        'inspection_result_invalid',
        `$.evidence.${evidenceId}.inspection`,
        'Inspected evidence requires an immutable inspection-result identity, version, and hash.',
      );
    }
  }
  const validMoney = (amount: number | null, currency: string | null): boolean =>
    (amount === null && currency === null) ||
    (Number.isSafeInteger(amount) && (amount ?? -1) >= 0 && /^[A-Z]{3}$/u.test(currency ?? ''));
  for (const [paymentId, payment] of Object.entries(envelope.payments ?? {})) {
    if (!validMoney(payment.amount_minor, payment.currency)) {
      add(
        'payment_amount_invalid',
        `$.payments.${paymentId}`,
        'Payment amount and ISO currency must be supplied together using non-negative minor units.',
      );
    }
  }
  for (const [lossId, loss] of Object.entries(envelope.claimed_losses ?? {})) {
    if (!validMoney(loss.amount_minor, loss.currency)) {
      add(
        'claimed_loss_amount_invalid',
        `$.claimed_losses.${lossId}`,
        'Claimed-loss amount and ISO currency must be supplied together using non-negative minor units.',
      );
    }
  }
  for (const [outcomeId, outcome] of Object.entries(envelope.requested_outcomes ?? {})) {
    outcome.transfers.forEach((transfer, index) => {
      if (!validMoney(transfer.amount_minor, transfer.currency)) {
        add(
          'requested_outcome_amount_invalid',
          `$.requested_outcomes.${outcomeId}.transfers[${index}]`,
          'Requested transfer amount and ISO currency must be supplied together using non-negative minor units.',
        );
      }
    });
  }
  for (const [positionId, position] of Object.entries(envelope.positions ?? {})) {
    const actor = envelope.parties[position.party_id]?.authenticated_subject_id;
    if (
      ['party_assertion', 'party_admission'].includes(position.authority.authority_kind) &&
      actor !== position.authority.introduced_by.actor_id
    ) {
      add(
        'position_party_mismatch',
        `$.positions.${positionId}`,
        'A party position must be introduced by that authenticated party.',
      );
    }
  }
  for (const [index, challenge] of (envelope.formation?.challenges ?? []).entries()) {
    const target = (envelope[challenge.target_namespace] as Record<string, unknown> | undefined)?.[
      challenge.target_object_id
    ];
    if (!ID_PATTERN.test(challenge.challenge_id) || !target) {
      add(
        'challenge_target_invalid',
        `$.formation.challenges[${index}]`,
        'Challenge identity and target must resolve to a canonical substantive object.',
      );
    }
    if (!Array.isArray(challenge.source_references) || challenge.source_references.length === 0) {
      add(
        'challenge_source_missing',
        `$.formation.challenges[${index}].source_references`,
        'A challenge requires exact source grounding.',
      );
    }
    if (
      (challenge.status === 'open' &&
        (challenge.resolution_event_id !== null ||
          challenge.resolution_source_references.length > 0)) ||
      (challenge.status !== 'open' && !challenge.resolution_event_id)
    ) {
      add(
        'challenge_resolution_invalid',
        `$.formation.challenges[${index}]`,
        'Open challenges cannot have a resolution; closed challenges require a resolution event.',
      );
    }
  }
  for (const partyId of ['party_a', 'party_b'] as const) {
    const receipt = envelope.formation?.confirmations?.[partyId];
    if (
      receipt &&
      (receipt.party_id !== partyId ||
        receipt.bound_record_version !== envelope.control.record_version ||
        receipt.bound_record_hash !== envelope.control.record_hash ||
        !HASH_PATTERN.test(receipt.bound_envelope_hash))
    ) {
      add(
        'confirmation_stale',
        `$.formation.confirmations.${partyId}`,
        'Confirmation must remain bound to the current material record and an exact envelope snapshot.',
      );
    }
  }
  const disclosure = envelope.formation?.disclosure;
  if (
    disclosure?.person_b_independent_account_source_id === null &&
    disclosure.detailed_a_framing !== 'embargoed'
  ) {
    add(
      'disclosure_embargo_violated',
      '$.formation.disclosure',
      'Detailed Person A framing remains embargoed until Person B submits an independent account.',
    );
  }
  if (envelope.control.lock.status === 'locked') {
    if (
      envelope.control.workflow_state !== 'locked' &&
      !['locked', 'deliberation', 'resolved', 'unresolved'].includes(
        envelope.control.workflow_state,
      )
    ) {
      add(
        'lock_state_invalid',
        '$.control.workflow_state',
        'Locked envelopes must be locked or deliberating.',
      );
    }
    if (
      !envelope.control.lock.mode ||
      !envelope.control.lock.lock_event_id ||
      !envelope.control.lock.locked_at
    ) {
      add(
        'lock_identity_invalid',
        '$.control.lock',
        'Locked envelopes require mode and event identity.',
      );
    }
  } else if (
    envelope.control.lock.mode !== null ||
    envelope.control.lock.lock_event_id !== null ||
    envelope.control.lock.output_scope !== null
  ) {
    add(
      'unlock_state_invalid',
      '$.control.lock',
      'Unlocked envelopes cannot retain an active lock identity.',
    );
  }
  return issues;
}

export function validateCaseEnvelope(value: unknown): ContractIssue[] {
  try {
    return validateCaseEnvelopeUnchecked(value);
  } catch (error) {
    return [
      {
        code: 'envelope_shape_invalid',
        path: '$',
        message:
          error instanceof Error
            ? `Envelope validation failed closed: ${error.message}`
            : 'Envelope validation failed closed.',
      },
    ];
  }
}

export function createInitialCaseEnvelope(caseId: string): CaseEnvelope {
  const systemSourceContent = 'Case envelope initialized by deterministic system code.';
  const systemSourceHash = hashSourceContent(systemSourceContent);
  const systemAuthority: ObjectAuthority = {
    introduced_by: { actor_id: 'juryai_system', actor_type: 'system' },
    authority_kind: 'system_observation',
    authority_detail: 'initial classification placeholder',
    subject_actor_ids: [],
    source_references: [
      { source_id: 'source_system_initialization', source_hash: systemSourceHash, span: null },
    ],
    evidence_ids: [],
    party_stances: {
      party_a: { stance: 'unresponded', response_event_id: null },
      party_b: { stance: 'unresponded', response_event_id: null },
    },
    resolution_status: 'unresolved',
    adjudication_eligible: false,
    introduced_in_record_version: 1,
    last_material_record_version: 1,
    last_material_command_id: 'command_system_initialization',
  };
  const envelope: CaseEnvelope = {
    control: {
      schema_version: CASE_ENVELOPE_SCHEMA_VERSION,
      case_id: caseId,
      workflow_state: 'initial_story',
      envelope_version: 1,
      envelope_hash: '',
      record_version: 1,
      record_hash: '',
      protocol: {
        protocol_id: 'commercial_fairness_v2',
        protocol_version: CASE_ENVELOPE_PROTOCOL_VERSION,
        non_participation_mode: 'prohibited',
      },
      deadlines: {},
      eligibility: { status: 'undetermined', reason_codes: [] },
      lock: {
        status: 'unlocked',
        mode: null,
        lock_event_id: null,
        locked_at: null,
        output_scope: null,
      },
    },
    parties: {
      party_a: {
        party_id: 'party_a',
        role: 'person_a',
        authenticated_subject_id: 'subject_party_a',
        identity_assurance: 'authenticated',
        consent_status: 'granted',
        consent_event_id: 'event_consent_a',
        participation_state: 'active',
      },
      party_b: {
        party_id: 'party_b',
        role: 'person_b',
        authenticated_subject_id: 'subject_party_b',
        identity_assurance: 'authenticated',
        consent_status: 'granted',
        consent_event_id: 'event_consent_b',
        participation_state: 'not_invited',
      },
    },
    actors: {},
    classification: {
      case_category: null,
      suitability: 'undetermined',
      maturity: 'undetermined',
      safety_flags: [],
      scope_flags: [],
      required_fact_profile: null,
      authority: systemAuthority,
    },
    agreements: {},
    events: {},
    payments: {},
    deliverables: {},
    positions: {},
    claimed_losses: {},
    requested_outcomes: {},
    evidence: {},
    formation: {
      open_required_fields: [],
      ambiguities: [],
      uncertainties: [],
      confirmations: { party_a: null, party_b: null },
      challenges: [],
      disclosure: {
        person_b_independent_account_source_id: null,
        detailed_a_framing: 'embargoed',
        disclosure_event_id: null,
      },
      non_participation: {
        invitation_event_id: null,
        notice_event_id: null,
        response_deadline: null,
        deadline_expired_event_id: null,
        correction_opportunity: 'not_started',
      },
      lock_prerequisites: [],
      lock_blockers: [],
      prior_locks: [],
      material_change_events: [],
    },
  };
  envelope.control.record_hash = hashCaseRecord(envelope);
  envelope.control.envelope_hash = hashCaseEnvelope(envelope);
  return envelope;
}

export function partyActor(partyId: PartyId, envelope: CaseEnvelope): AuthenticatedActor {
  const party = envelope.parties[partyId];
  if (!party.authenticated_subject_id)
    throw new TypeError(`${partyId} has no authenticated subject.`);
  return {
    actor_id: party.authenticated_subject_id,
    actor_type: 'party',
    party_id: partyId,
    authenticated_subject_id: party.authenticated_subject_id,
  };
}

export const SYSTEM_ACTOR: AuthenticatedActor = {
  actor_id: 'juryai_system',
  actor_type: 'system',
  party_id: null,
  authenticated_subject_id: 'juryai_system',
};
