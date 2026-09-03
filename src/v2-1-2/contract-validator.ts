import { canonicalSerialize, cloneCanonical, type ContractIssue } from '../v2/case-envelope.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V211,
  ENVELOPE_COMMAND_VERSION_V211,
  FORMATION_PROTOCOL_VERSION_V211,
  FORMATION_READINESS_VERSION_V211,
  hashCaseEnvelopeV211,
  type CaseEnvelopeV211,
} from '../v2-1-1/case-envelope.js';
import { validateCaseEnvelopeV211 } from '../v2-1-1/contract-validator.js';
import { authoritativeFormationExplanatoryStateV211 } from '../v2-1-1/formation-readiness.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V212,
  DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V212,
  DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V212,
  ENVELOPE_COMMAND_VERSION_V212,
  EXTERNAL_RELAY_SUBMISSION_VERSION_V211,
  FORMATION_PROTOCOL_VERSION_V212,
  FORMATION_READINESS_VERSION_V212,
  HASH_PATTERN_V212,
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  PARTY_FORMATION_READBACK_VERSION_V211,
  PARTY_IDS_V212,
  hashCaseEnvelopeV212,
  hashDisclosureReviewAcknowledgmentStatementV212,
  isPartyScopedIdV212,
  type CaseEnvelopeV212,
  type PartyIdV212,
} from './case-envelope.js';
import {
  currentDisclosureReviewAcknowledgmentV212,
  disclosureReviewClosureCurrentV212,
} from './disclosure-review.js';
import { authoritativeFormationExplanatoryStateV212 } from './formation-readiness.js';

type UnknownRecord = Record<string, unknown>;

function issue(code: string, path: string, message: string): ContractIssue {
  return { code, path, message };
}

function object(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: UnknownRecord,
  expected: readonly string[],
  path: string,
  issues: ContractIssue[],
): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    issues.push(
      issue('v212_exact_keys', path, `Expected keys ${[...expected].sort().join(', ')}.`),
    );
  }
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function validIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function sortedUniqueStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string') &&
    new Set(value).size === value.length &&
    JSON.stringify(value) === JSON.stringify([...value].sort())
  );
}

/**
 * Validated V2.1.2 envelopes reuse the frozen V2.1.1 validator for all fields
 * whose semantics did not change. This transient view is never persisted and
 * cannot accept a V2.1.1 envelope as V2.1.2: V2.1.2 shape/version checks run
 * first and require canonical acknowledgment history.
 */
function frozenSemanticValidationViewV211(envelope: CaseEnvelopeV212): CaseEnvelopeV211 {
  const view = cloneCanonical(envelope) as unknown as CaseEnvelopeV211;
  const formation = view.formation as unknown as UnknownRecord;
  delete formation.disclosure_review_acknowledgments;
  view.control.schema_version = CASE_ENVELOPE_SCHEMA_VERSION_V211;
  view.control.protocol_version = FORMATION_PROTOCOL_VERSION_V211;
  view.control.command_contract_version = ENVELOPE_COMMAND_VERSION_V211;
  view.control.readiness_contract_version = FORMATION_READINESS_VERSION_V211;
  view.formation.explanatory = authoritativeFormationExplanatoryStateV211(view);
  view.control.envelope_hash = hashCaseEnvelopeV211(view);
  return view;
}

function validateAcknowledgmentHistory(envelope: CaseEnvelopeV212, issues: ContractIssue[]): void {
  const history = envelope.formation.disclosure_review_acknowledgments;
  if (!object(history)) {
    issues.push(
      issue(
        'v212_disclosure_acknowledgments',
        'envelope.formation.disclosure_review_acknowledgments',
        'Disclosure-review acknowledgment history must be party-scoped.',
      ),
    );
    return;
  }
  exactKeys(
    history,
    PARTY_IDS_V212,
    'envelope.formation.disclosure_review_acknowledgments',
    issues,
  );
  const acknowledgmentIds = new Set<string>();
  const eventIds = new Set<string>();
  const statementHash = hashDisclosureReviewAcknowledgmentStatementV212(
    DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V212,
  );
  for (const partyId of PARTY_IDS_V212) {
    const entries = history[partyId];
    if (!Array.isArray(entries)) {
      issues.push(
        issue(
          'v212_disclosure_acknowledgments',
          `envelope.formation.disclosure_review_acknowledgments.${partyId}`,
          'Acknowledgment history must be an array.',
        ),
      );
      continue;
    }
    let priorEnvelopeVersion = 0;
    for (const [index, raw] of entries.entries()) {
      const path = `envelope.formation.disclosure_review_acknowledgments.${partyId}[${index}]`;
      if (!object(raw)) {
        issues.push(issue('v212_disclosure_ack_object', path, 'Acknowledgment must be an object.'));
        continue;
      }
      exactKeys(
        raw,
        [
          'acknowledged_at',
          'acknowledged_at_envelope_version',
          'acknowledgment_id',
          'acknowledgment_statement_hash',
          'acknowledgment_version',
          'authenticated_subject_id',
          'dispute_id',
          'event_id',
          'formation_epoch',
          'party_id',
          'party_projection_hash',
          'party_projection_version',
          'party_readback_hash',
          'party_readback_version',
          'party_visible_version',
        ],
        path,
        issues,
      );
      const envelopeVersion = raw.acknowledged_at_envelope_version;
      const shapeValid =
        raw.acknowledgment_version === DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V212 &&
        raw.dispute_id === envelope.control.case_id &&
        raw.party_id === partyId &&
        typeof raw.acknowledgment_id === 'string' &&
        isPartyScopedIdV212('disclosure_ack', partyId, raw.acknowledgment_id) &&
        typeof raw.event_id === 'string' &&
        isPartyScopedIdV212('disclosure_ack_event', partyId, raw.event_id) &&
        raw.authenticated_subject_id === envelope.parties[partyId].authenticated_subject_id &&
        safeInteger(raw.formation_epoch, 1) &&
        raw.formation_epoch <= envelope.parties[partyId].formation_epoch &&
        raw.party_projection_version === PARTY_FORMATION_PROJECTION_VERSION_V211 &&
        typeof raw.party_projection_hash === 'string' &&
        HASH_PATTERN_V212.test(raw.party_projection_hash) &&
        safeInteger(raw.party_visible_version, 1) &&
        raw.party_visible_version <= envelope.control.party_views[partyId].party_visible_version &&
        raw.party_readback_version === PARTY_FORMATION_READBACK_VERSION_V211 &&
        typeof raw.party_readback_hash === 'string' &&
        HASH_PATTERN_V212.test(raw.party_readback_hash) &&
        raw.acknowledgment_statement_hash === statementHash &&
        validIso(raw.acknowledged_at) &&
        safeInteger(envelopeVersion, 2) &&
        envelopeVersion <= envelope.control.envelope_version &&
        envelopeVersion > priorEnvelopeVersion;
      const currentCommitBindingValid =
        envelopeVersion !== envelope.control.envelope_version ||
        currentDisclosureReviewAcknowledgmentV212(envelope, partyId)?.acknowledgment_id ===
          raw.acknowledgment_id;
      if (!shapeValid || !currentCommitBindingValid) {
        issues.push(
          issue(
            'v212_disclosure_ack_shape',
            path,
            'Disclosure-review acknowledgment shape or canonical binding is invalid.',
          ),
        );
      }
      if (
        acknowledgmentIds.has(String(raw.acknowledgment_id)) ||
        eventIds.has(String(raw.event_id))
      ) {
        issues.push(
          issue(
            'v212_disclosure_ack_id_collision',
            path,
            'Disclosure-review acknowledgment identities collide.',
          ),
        );
      }
      acknowledgmentIds.add(String(raw.acknowledgment_id));
      eventIds.add(String(raw.event_id));
      if (safeInteger(envelopeVersion, 2)) priorEnvelopeVersion = envelopeVersion;
    }
  }
}

export function validateCaseEnvelopeV212(value: unknown): ContractIssue[] {
  const issues: ContractIssue[] = [];
  try {
    canonicalSerialize(value as never);
  } catch {
    return [issue('v212_envelope_json', 'envelope', 'Envelope must be canonical JSON data.')];
  }
  if (!object(value)) {
    return [issue('v212_envelope_object', 'envelope', 'Envelope must be an object.')];
  }
  exactKeys(
    value,
    [
      'challenges',
      'clarifications',
      'control',
      'evidence',
      'formation',
      'parties',
      'positions',
      'requirements',
      'source_turns',
    ],
    'envelope',
    issues,
  );
  if (!object(value.control)) {
    return [...issues, issue('v212_control_object', 'envelope.control', 'Control is invalid.')];
  }
  exactKeys(
    value.control,
    [
      'case_id',
      'command_contract_version',
      'disclosure_state',
      'envelope_hash',
      'envelope_version',
      'external_submission_contract_version',
      'party_views',
      'projection_contract_version',
      'protocol_version',
      'readiness_contract_version',
      'schema_version',
      'workflow_state',
    ],
    'envelope.control',
    issues,
  );
  for (const [key, expected] of [
    ['schema_version', CASE_ENVELOPE_SCHEMA_VERSION_V212],
    ['protocol_version', FORMATION_PROTOCOL_VERSION_V212],
    ['command_contract_version', ENVELOPE_COMMAND_VERSION_V212],
    ['external_submission_contract_version', EXTERNAL_RELAY_SUBMISSION_VERSION_V211],
    ['projection_contract_version', PARTY_FORMATION_PROJECTION_VERSION_V211],
    ['readiness_contract_version', FORMATION_READINESS_VERSION_V212],
  ] as const) {
    if (value.control[key] !== expected) {
      issues.push(
        issue('v212_contract_version', `envelope.control.${key}`, `Expected ${expected}.`),
      );
    }
  }
  if (!object(value.formation)) {
    return [...issues, issue('v212_formation', 'envelope.formation', 'Formation is invalid.')];
  }
  exactKeys(
    value.formation,
    ['confirmations', 'disclosure_review_acknowledgments', 'explanatory', 'reopen_events'],
    'envelope.formation',
    issues,
  );

  const envelope = value as unknown as CaseEnvelopeV212;
  try {
    validateAcknowledgmentHistory(envelope, issues);
  } catch {
    issues.push(
      issue(
        'v212_disclosure_acknowledgments',
        'envelope.formation.disclosure_review_acknowledgments',
        'Disclosure-review acknowledgment history references malformed envelope state.',
      ),
    );
  }
  if (
    envelope.control.disclosure_state !== 'disclosed' &&
    object(envelope.formation.disclosure_review_acknowledgments) &&
    PARTY_IDS_V212.some(
      (partyId) =>
        Array.isArray(envelope.formation.disclosure_review_acknowledgments[partyId]) &&
        envelope.formation.disclosure_review_acknowledgments[partyId].length > 0,
    )
  ) {
    issues.push(
      issue(
        'v212_disclosure_ack_before_disclosure',
        'envelope.formation.disclosure_review_acknowledgments',
        'Disclosure-review acknowledgments require disclosed state.',
      ),
    );
  }

  if (issues.length === 0) {
    try {
      issues.push(...validateCaseEnvelopeV211(frozenSemanticValidationViewV211(envelope)));
    } catch {
      issues.push(
        issue(
          'v212_frozen_semantic_validation',
          'envelope',
          'Frozen V2.1.1 semantic fields are invalid.',
        ),
      );
    }
  }
  if (issues.length === 0) {
    const expectedExplanatory = authoritativeFormationExplanatoryStateV212(envelope);
    if (
      canonicalSerialize(envelope.formation.explanatory) !== canonicalSerialize(expectedExplanatory)
    ) {
      issues.push(
        issue(
          'v212_explanatory_mismatch',
          'envelope.formation.explanatory',
          'Stored explanatory state is stale.',
        ),
      );
    }
    if (
      ['final_confirmation', 'ready_for_lock'].includes(envelope.control.workflow_state) &&
      !disclosureReviewClosureCurrentV212(envelope)
    ) {
      issues.push(
        issue(
          'v212_disclosure_review_closure_missing',
          'envelope.control.workflow_state',
          'Final confirmation requires current acknowledgment from both parties.',
        ),
      );
    }
    if (envelope.control.envelope_hash !== hashCaseEnvelopeV212(envelope)) {
      issues.push(
        issue(
          'v212_envelope_hash_mismatch',
          'envelope.control.envelope_hash',
          'Envelope hash does not match canonical V2.1.2 state.',
        ),
      );
    }
  }
  return issues;
}

export function assertValidCaseEnvelopeV212(envelope: CaseEnvelopeV212): void {
  const issues = validateCaseEnvelopeV212(envelope);
  if (issues.length > 0) throw new TypeError(`${issues[0]!.code}: ${issues[0]!.message}`);
}
