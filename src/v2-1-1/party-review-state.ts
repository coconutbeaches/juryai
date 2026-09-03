import {
  canonicalSerialize,
  cloneCanonical,
  sha256,
  type ContractIssue,
  type JsonValue,
} from '../v2/case-envelope.js';
import {
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  PARTY_FORMATION_READBACK_VERSION_V211,
  type CaseEnvelopeV211,
  type PartyIdV211,
} from './case-envelope.js';
import { deriveFormationReadinessV211 } from './formation-readiness.js';
import {
  currentPartyConfirmationV211,
  projectPartyFormationV211,
  renderPartyFormationReadbackV211,
  type PartyFormationReadbackV211,
  type PartyScopedFormationProjectionV211,
} from './party-projection.js';

export const PARTY_REVIEW_STATE_VERSION_V1 = 'juryai-party-review-state-v1.0.0';

export interface PartyReviewStateV1 {
  review_state_version: typeof PARTY_REVIEW_STATE_VERSION_V1;
  dispute_id: string;
  party_id: PartyIdV211;
  formation_projection_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V211;
  party_projection_hash: string;
  party_visible_version: number;
  formation_readback_version: typeof PARTY_FORMATION_READBACK_VERSION_V211;
  party_readback_hash: string;
  formation_epoch: number;
  formation_projection: PartyScopedFormationProjectionV211;
  formation_readback: PartyFormationReadbackV211;
  own_confirmation_state: 'unconfirmed' | 'confirmed';
  shared_readiness: 'not_ready' | 'ready_for_lock';
  review_state_hash: string;
}

export interface PartyConfirmationEligibilityV1 {
  eligible: boolean;
  blockers: string[];
}

function reviewHashProjection(value: Omit<PartyReviewStateV1, 'review_state_hash'>): JsonValue {
  return cloneCanonical(value) as unknown as JsonValue;
}

export function hashPartyReviewStateV1(
  value: Omit<PartyReviewStateV1, 'review_state_hash'>,
): string {
  return sha256(canonicalSerialize(reviewHashProjection(value)));
}

export function derivePartyReviewStateV1(
  envelope: CaseEnvelopeV211,
  partyId: PartyIdV211,
): PartyReviewStateV1 {
  const formationProjection = projectPartyFormationV211(envelope, partyId);
  const formationReadback = renderPartyFormationReadbackV211(envelope, partyId);
  const cursor = envelope.control.party_views[partyId];
  const reviewWithoutHash: Omit<PartyReviewStateV1, 'review_state_hash'> = {
    review_state_version: PARTY_REVIEW_STATE_VERSION_V1,
    dispute_id: envelope.control.case_id,
    party_id: partyId,
    formation_projection_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
    party_projection_hash: cursor.party_projection_hash,
    party_visible_version: cursor.party_visible_version,
    formation_readback_version: PARTY_FORMATION_READBACK_VERSION_V211,
    party_readback_hash: formationReadback.document_hash,
    formation_epoch: envelope.parties[partyId].formation_epoch,
    formation_projection: formationProjection,
    formation_readback: formationReadback,
    own_confirmation_state:
      currentPartyConfirmationV211(envelope, partyId) === null ? 'unconfirmed' : 'confirmed',
    shared_readiness: deriveFormationReadinessV211(envelope).ready_for_bilateral_lock
      ? 'ready_for_lock'
      : 'not_ready',
  };
  return cloneCanonical({
    ...reviewWithoutHash,
    review_state_hash: hashPartyReviewStateV1(reviewWithoutHash),
  });
}

function issue(code: string, path: string, message: string): ContractIssue {
  return { code, path, message };
}

export function validatePartyReviewStateV1(value: unknown): ContractIssue[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [issue('party_review_state_object', '$', 'Party review state must be an object.')];
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    'dispute_id',
    'formation_epoch',
    'formation_projection',
    'formation_projection_version',
    'formation_readback',
    'formation_readback_version',
    'own_confirmation_state',
    'party_id',
    'party_projection_hash',
    'party_readback_hash',
    'party_visible_version',
    'review_state_hash',
    'review_state_version',
    'shared_readiness',
  ].sort();
  const issues: ContractIssue[] = [];
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)) {
    issues.push(
      issue('party_review_state_exact_keys', '$', 'Party review state keys are not canonical.'),
    );
    return issues;
  }
  if (record.review_state_version !== PARTY_REVIEW_STATE_VERSION_V1) {
    issues.push(
      issue(
        'party_review_state_version',
        '$.review_state_version',
        'Party review state version is invalid.',
      ),
    );
  }
  if (record.party_id !== 'party_a' && record.party_id !== 'party_b') {
    issues.push(
      issue('party_review_state_party', '$.party_id', 'Party review identity is invalid.'),
    );
  }
  if (
    record.formation_projection_version !== PARTY_FORMATION_PROJECTION_VERSION_V211 ||
    record.formation_readback_version !== PARTY_FORMATION_READBACK_VERSION_V211
  ) {
    issues.push(
      issue(
        'party_review_state_frozen_contract',
        '$.formation_projection_version',
        'Party review state must reference the frozen V2.1.1 formation contracts.',
      ),
    );
  }
  if (
    record.own_confirmation_state !== 'unconfirmed' &&
    record.own_confirmation_state !== 'confirmed'
  ) {
    issues.push(
      issue(
        'party_review_state_confirmation',
        '$.own_confirmation_state',
        'Own confirmation state is invalid.',
      ),
    );
  }
  if (record.shared_readiness !== 'not_ready' && record.shared_readiness !== 'ready_for_lock') {
    issues.push(
      issue(
        'party_review_state_readiness',
        '$.shared_readiness',
        'Shared readiness state is invalid.',
      ),
    );
  }
  if (
    typeof record.party_visible_version !== 'number' ||
    !Number.isSafeInteger(record.party_visible_version) ||
    record.party_visible_version < 1 ||
    typeof record.formation_epoch !== 'number' ||
    !Number.isSafeInteger(record.formation_epoch) ||
    record.formation_epoch < 1
  ) {
    issues.push(
      issue(
        'party_review_state_counter',
        '$.party_visible_version',
        'Review counters are invalid.',
      ),
    );
  }
  for (const [path, digest] of [
    ['$.party_projection_hash', record.party_projection_hash],
    ['$.party_readback_hash', record.party_readback_hash],
    ['$.review_state_hash', record.review_state_hash],
  ] as const) {
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) {
      issues.push(issue('party_review_state_hash', path, 'Review hash is invalid.'));
    }
  }
  try {
    const withoutHash = cloneCanonical(record) as Record<string, JsonValue>;
    delete withoutHash.review_state_hash;
    if (
      typeof record.review_state_hash === 'string' &&
      sha256(canonicalSerialize(withoutHash)) !== record.review_state_hash
    ) {
      issues.push(
        issue(
          'party_review_state_hash_mismatch',
          '$.review_state_hash',
          'Review state hash does not match canonical review state.',
        ),
      );
    }
    const projection = record.formation_projection as Record<string, unknown>;
    const readback = record.formation_readback as Record<string, unknown>;
    const projectionHash = sha256(canonicalSerialize(projection as JsonValue));
    const expectedReadbackDocument = canonicalSerialize({
      readback_version: PARTY_FORMATION_READBACK_VERSION_V211,
      party_id: record.party_id as JsonValue,
      adopted_formation: projection as JsonValue,
    });
    if (
      projection.projection_version !== record.formation_projection_version ||
      projection.party_id !== record.party_id ||
      projectionHash !== record.party_projection_hash ||
      readback.readback_version !== record.formation_readback_version ||
      readback.party_id !== record.party_id ||
      readback.party_projection_hash !== record.party_projection_hash ||
      readback.document !== expectedReadbackDocument ||
      readback.document_hash !== record.party_readback_hash ||
      typeof readback.document !== 'string' ||
      sha256(readback.document) !== record.party_readback_hash
    ) {
      issues.push(
        issue(
          'party_review_state_binding_mismatch',
          '$.formation_readback',
          'Review state does not bind one canonical party projection/read-back.',
        ),
      );
    }
  } catch {
    issues.push(
      issue('party_review_state_canonical', '$', 'Party review state must be canonical JSON.'),
    );
  }
  return issues;
}

export function derivePartyConfirmationEligibilityV1(
  envelope: CaseEnvelopeV211,
  partyId: PartyIdV211,
): PartyConfirmationEligibilityV1 {
  const readiness = deriveFormationReadinessV211(envelope);
  const blockers = readiness.blockers.filter(
    (blocker) => !/^party_(?:a|b)_confirmation_missing_or_stale$/u.test(blocker),
  );
  if (envelope.control.workflow_state !== 'final_confirmation') {
    blockers.push('final_confirmation_state_required');
  }
  if (currentPartyConfirmationV211(envelope, partyId) !== null) {
    blockers.push('own_confirmation_already_current');
  }
  return {
    eligible: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
  };
}
