import {
  CASE_ENVELOPE_PROTOCOL_VERSION,
  canonicalSerialize,
  cloneCanonical,
  evidenceEligibility,
  hashCaseEnvelope,
  sha256,
  validateCaseEnvelope,
  type CaseEnvelope,
  type ClaimedLossObject,
  type ContractIssue,
  type EvidenceObject,
  type JsonValue,
  type PartyId,
  type RequestedOutcomeObject,
  type SourceReference,
  type SubstantiveNamespace,
} from './case-envelope.js';

export const ADJUDICATION_INPUT_VERSION = 'juryai-adjudication-input-v2.0.0';

export type AdjudicationObject =
  | CaseEnvelope['actors'][string]
  | CaseEnvelope['agreements'][string]
  | CaseEnvelope['events'][string]
  | CaseEnvelope['payments'][string]
  | CaseEnvelope['deliverables'][string]
  | CaseEnvelope['positions'][string];

export interface AdjudicationObjectReference {
  namespace: Exclude<SubstantiveNamespace, 'claimed_losses' | 'requested_outcomes' | 'evidence'>;
  object: AdjudicationObject;
}

export interface EligibleEvidenceReference {
  evidence_id: string;
  submitted_by_party_id: PartyId;
  asserted_author_actor_id: string | null;
  authenticity_status: EvidenceObject['authenticity_status'];
  authority: EvidenceObject['authority'];
  content_hash: string;
  inspection_result_id: string;
  inspection_result_version: string;
  inspection_result_hash: string;
  inspection_source_reference: SourceReference;
  source_references: SourceReference[];
}

export interface ExcludedEvidenceReference {
  evidence_id: string;
  reasons: EvidenceObject['adjudication_eligibility']['reasons'];
}

export interface AdjudicationInput {
  input_version: typeof ADJUDICATION_INPUT_VERSION;
  input_hash: string;
  locked_envelope: {
    case_id: string;
    envelope_version: number;
    envelope_hash: string;
    record_version: number;
    record_hash: string;
    lock_event_id: string;
    lock_mode: 'bilateral' | 'documented_non_participation';
  };
  protocol: {
    protocol_id: string;
    protocol_version: typeof CASE_ENVELOPE_PROTOCOL_VERSION;
    output_scope: 'adjudication' | 'advisory_only';
  };
  participation: Record<PartyId, CaseEnvelope['parties'][PartyId]['participation_state']>;
  objects: AdjudicationObjectReference[];
  unresolved_disputes: Array<{
    namespace: SubstantiveNamespace;
    object_id: string;
    resolution_status: 'disputed' | 'unresolved';
  }>;
  claimed_losses: ClaimedLossObject[];
  requested_outcomes: RequestedOutcomeObject[];
  eligible_evidence: EligibleEvidenceReference[];
  excluded_evidence: ExcludedEvidenceReference[];
  uncertainties: string[];
  admitted_source_references: SourceReference[];
}

function projectionForHash(input: AdjudicationInput): JsonValue {
  return { ...input, input_hash: '' } as unknown as JsonValue;
}

export function hashAdjudicationInput(input: AdjudicationInput): string {
  return sha256(canonicalSerialize(projectionForHash(input)));
}

function sortedValues<T>(map: Record<string, T>): T[] {
  return Object.keys(map)
    .sort()
    .map((key) => cloneCanonical(map[key]!));
}

function objectId(namespace: SubstantiveNamespace, object: { [key: string]: unknown }): string {
  const key: Record<SubstantiveNamespace, string> = {
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
  return String(object[key[namespace]]);
}

export function buildAdjudicationInput(envelope: CaseEnvelope): AdjudicationInput {
  if (
    validateCaseEnvelope(envelope).length > 0 ||
    envelope.control.lock.status !== 'locked' ||
    envelope.control.workflow_state !== 'locked' ||
    !envelope.control.lock.mode ||
    !envelope.control.lock.lock_event_id ||
    !envelope.control.lock.output_scope ||
    envelope.control.envelope_hash !== hashCaseEnvelope(envelope)
  ) {
    throw new TypeError(
      'Adjudication input requires an exact, valid envelope in the locked state.',
    );
  }
  const objects: AdjudicationObjectReference[] = [];
  const unresolvedDisputes: AdjudicationInput['unresolved_disputes'] = [];
  const admittedSourceReferences: SourceReference[] = [];
  const objectNamespaces = [
    'actors',
    'agreements',
    'events',
    'payments',
    'deliverables',
    'positions',
  ] as const;
  for (const namespace of objectNamespaces) {
    const namespaceObjects = envelope[namespace] as Record<string, AdjudicationObject>;
    for (const object of sortedValues(namespaceObjects)) {
      if (!object.authority.adjudication_eligible) continue;
      objects.push({ namespace, object: cloneCanonical(object) });
      admittedSourceReferences.push(...cloneCanonical(object.authority.source_references));
      if (['disputed', 'unresolved'].includes(object.authority.resolution_status)) {
        unresolvedDisputes.push({
          namespace,
          object_id: objectId(namespace, object as unknown as { [key: string]: unknown }),
          resolution_status: object.authority.resolution_status as 'disputed' | 'unresolved',
        });
      }
    }
  }
  const claimedLosses = sortedValues(envelope.claimed_losses).filter(
    (loss) => loss.authority.adjudication_eligible,
  );
  const requestedOutcomes = sortedValues(envelope.requested_outcomes).filter(
    (outcome) => outcome.authority.adjudication_eligible,
  );
  for (const object of [...claimedLosses, ...requestedOutcomes]) {
    admittedSourceReferences.push(...cloneCanonical(object.authority.source_references));
  }
  for (const [namespace, material] of [
    ['claimed_losses', claimedLosses],
    ['requested_outcomes', requestedOutcomes],
  ] as const) {
    for (const object of material) {
      if (['disputed', 'unresolved'].includes(object.authority.resolution_status)) {
        unresolvedDisputes.push({
          namespace,
          object_id: objectId(namespace, object as unknown as { [key: string]: unknown }),
          resolution_status: object.authority.resolution_status as 'disputed' | 'unresolved',
        });
      }
    }
  }
  const eligibleEvidence: EligibleEvidenceReference[] = [];
  const excludedEvidence: ExcludedEvidenceReference[] = [];
  for (const evidence of sortedValues(envelope.evidence)) {
    const eligibility = evidenceEligibility(evidence);
    if (eligibility.status === 'eligible') {
      if (
        !evidence.content_hash ||
        !evidence.inspection.result_id ||
        !evidence.inspection.result_version ||
        !evidence.inspection.result_hash ||
        !evidence.inspection.source_reference
      ) {
        throw new TypeError(
          `Eligible evidence ${evidence.evidence_id} lacks immutable identities.`,
        );
      }
      eligibleEvidence.push({
        evidence_id: evidence.evidence_id,
        submitted_by_party_id: evidence.submitted_by_party_id,
        asserted_author_actor_id: evidence.asserted_author_actor_id,
        authenticity_status: evidence.authenticity_status,
        authority: cloneCanonical(evidence.authority),
        content_hash: evidence.content_hash,
        inspection_result_id: evidence.inspection.result_id,
        inspection_result_version: evidence.inspection.result_version,
        inspection_result_hash: evidence.inspection.result_hash,
        inspection_source_reference: cloneCanonical(evidence.inspection.source_reference),
        source_references: cloneCanonical(evidence.authority.source_references),
      });
      admittedSourceReferences.push(...cloneCanonical(evidence.authority.source_references));
      admittedSourceReferences.push(cloneCanonical(evidence.inspection.source_reference));
    } else {
      excludedEvidence.push({ evidence_id: evidence.evidence_id, reasons: eligibility.reasons });
    }
  }
  const deduplicatedSources = new Map<string, SourceReference>();
  for (const reference of admittedSourceReferences) {
    deduplicatedSources.set(canonicalSerialize(reference as unknown as JsonValue), reference);
  }
  const input: AdjudicationInput = {
    input_version: ADJUDICATION_INPUT_VERSION,
    input_hash: '',
    locked_envelope: {
      case_id: envelope.control.case_id,
      envelope_version: envelope.control.envelope_version,
      envelope_hash: envelope.control.envelope_hash,
      record_version: envelope.control.record_version,
      record_hash: envelope.control.record_hash,
      lock_event_id: envelope.control.lock.lock_event_id,
      lock_mode: envelope.control.lock.mode,
    },
    protocol: {
      protocol_id: envelope.control.protocol.protocol_id,
      protocol_version: envelope.control.protocol.protocol_version,
      output_scope: envelope.control.lock.output_scope,
    },
    participation: {
      party_a: envelope.parties.party_a.participation_state,
      party_b: envelope.parties.party_b.participation_state,
    },
    objects,
    unresolved_disputes: unresolvedDisputes,
    claimed_losses: claimedLosses,
    requested_outcomes: requestedOutcomes,
    eligible_evidence: eligibleEvidence,
    excluded_evidence: excludedEvidence,
    uncertainties: cloneCanonical(envelope.formation.uncertainties),
    admitted_source_references: [...deduplicatedSources.values()].sort((left, right) =>
      canonicalSerialize(left as unknown as JsonValue).localeCompare(
        canonicalSerialize(right as unknown as JsonValue),
      ),
    ),
  };
  input.input_hash = hashAdjudicationInput(input);
  return input;
}

function validateAdjudicationInputUnchecked(
  input: AdjudicationInput,
  envelope: CaseEnvelope,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const add = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  if (
    input.input_version !== ADJUDICATION_INPUT_VERSION ||
    input.input_hash !== hashAdjudicationInput(input)
  ) {
    add(
      'adjudication_input_hash_invalid',
      '$',
      'Adjudication input identity or canonical hash is invalid.',
    );
  }
  if (
    envelope.control.lock.status !== 'locked' ||
    envelope.control.workflow_state !== 'locked' ||
    input.locked_envelope.case_id !== envelope.control.case_id ||
    input.locked_envelope.envelope_version !== envelope.control.envelope_version ||
    input.locked_envelope.envelope_hash !== envelope.control.envelope_hash ||
    input.locked_envelope.record_version !== envelope.control.record_version ||
    input.locked_envelope.record_hash !== envelope.control.record_hash ||
    input.locked_envelope.lock_event_id !== envelope.control.lock.lock_event_id ||
    input.locked_envelope.lock_mode !== envelope.control.lock.mode
  ) {
    add(
      'adjudication_input_stale',
      '$.locked_envelope',
      'Input must bind the active locked envelope exactly.',
    );
  }
  if (
    input.protocol.protocol_id !== envelope.control.protocol.protocol_id ||
    input.protocol.protocol_version !== envelope.control.protocol.protocol_version ||
    input.protocol.output_scope !== envelope.control.lock.output_scope
  ) {
    add(
      'adjudication_protocol_mismatch',
      '$.protocol',
      'Input must bind the active protocol and lock output scope.',
    );
  }
  let expected: AdjudicationInput | null = null;
  try {
    expected = buildAdjudicationInput(envelope);
  } catch {
    add(
      'adjudication_envelope_invalid',
      '$.locked_envelope',
      'Envelope is not eligible for input construction.',
    );
  }
  if (expected && canonicalSerialize(input) !== canonicalSerialize(expected)) {
    add(
      'adjudication_projection_invalid',
      '$',
      'Input contains omitted canonical material, stale material, or material outside the deliberate projection.',
    );
  }
  return issues;
}

export function validateAdjudicationInput(
  input: AdjudicationInput,
  envelope: CaseEnvelope,
): ContractIssue[] {
  try {
    return validateAdjudicationInputUnchecked(input, envelope);
  } catch (error) {
    return [
      {
        code: 'adjudication_input_shape_invalid',
        path: '$',
        message:
          error instanceof Error
            ? `Adjudication input validation failed closed: ${error.message}`
            : 'Adjudication input validation failed closed.',
      },
    ];
  }
}
