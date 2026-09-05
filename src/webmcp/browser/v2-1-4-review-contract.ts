import type { PartyReviewStateV214 } from '../../v2-1-4/party-review-state.js';
import {
  EPISTEMIC_STRENGTHS,
  HASH_PATTERN,
  ID_PATTERN,
  PROPOSITION_TYPES,
} from '../public-contract-v0-3.js';

export interface ParsedFirstPartyReviewV214 {
  review_page_version: 'juryai-v2.1.4-first-party-review-page-v1.0.0';
  review: PartyReviewStateV214;
  workflow_phase:
    'independent_formation' | 'challenge_response' | 'final_confirmation' | 'ready_for_lock';
  disclosure_state: 'embargoed' | 'disclosed';
  own_disclosure_review: 'open' | 'acknowledged' | 'unavailable';
  can_acknowledge_disclosure_review: boolean;
  can_confirm: boolean;
  can_reopen: boolean;
  can_invite_party_b: boolean;
  waiting_for_other_party: boolean;
  disclosure_review_acknowledgment_statement: string;
}

export interface ParsedInvitationRedemptionV214 {
  status: 'redeemed';
  review_path: string;
}

function exactObject(
  value: unknown,
  label: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length !== allowed.length ||
    Object.keys(object).some((key) => !allowed.includes(key))
  ) {
    throw new TypeError(`${label} keys are invalid.`);
  }
  return object;
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

export function decodeInvitationRedemptionV214(value: unknown): ParsedInvitationRedemptionV214 {
  const response = exactObject(value, 'invitation redemption', ['review_path', 'status']);
  if (response.status !== 'redeemed') {
    throw new TypeError('Invitation redemption status is invalid.');
  }
  const reviewPath = boundedString(response.review_path, 'invitation review path', 256);
  if (!/^\/cases\/dispute_[A-Za-z0-9_.:-]+\/review$/u.test(reviewPath)) {
    throw new TypeError('Invitation review path is invalid.');
  }
  return { status: 'redeemed', review_path: reviewPath };
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} is invalid.`);
  return value;
}

function canonicalId(value: unknown, label: string, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
}

function digest(value: unknown, label: string): void {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
}

function safeInteger(value: unknown, label: string, minimum = 0): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} is invalid.`);
  }
}

function boundedArray(value: unknown, label: string, maximum = 10_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function party(value: unknown, label: string): void {
  if (value !== 'party_a' && value !== 'party_b') throw new TypeError(`${label} is invalid.`);
}

function validateSourceSpan(value: unknown): void {
  const span = exactObject(value, 'source span', [
    'encoding',
    'end',
    'message_index',
    'quote_hash',
    'region',
    'start',
    'turn_id',
  ]);
  canonicalId(span.turn_id, 'source span turn_id');
  if (span.region !== 'answer' && span.region !== 'context') {
    throw new TypeError('source span region is invalid.');
  }
  if (span.message_index !== null) safeInteger(span.message_index, 'source span message_index');
  if (span.encoding !== 'utf16') throw new TypeError('source span encoding is invalid.');
  safeInteger(span.start, 'source span start');
  safeInteger(span.end, 'source span end');
  if ((span.end as number) <= (span.start as number)) {
    throw new TypeError('source span range is invalid.');
  }
  digest(span.quote_hash, 'source span quote_hash');
}

function validatePosition(value: unknown, expectedParty?: 'party_a' | 'party_b'): void {
  const position = exactObject(value, 'visible position', [
    'attributed_party_id',
    'epistemic_strength',
    'evidence_ref_id',
    'position_id',
    'proposition_type',
    'requirement_id',
    'resolution_status',
    'source_span_commitments',
    'source_turn_id',
    'statement',
    'superseded_by',
    'supersedes',
  ]);
  canonicalId(position.position_id, 'visible position id');
  party(position.attributed_party_id, 'visible position party');
  if (expectedParty && position.attributed_party_id !== expectedParty) {
    throw new TypeError('visible position party binding is invalid.');
  }
  canonicalId(position.requirement_id, 'visible position requirement');
  if (!PROPOSITION_TYPES.includes(position.proposition_type as never)) {
    throw new TypeError('visible position proposition type is invalid.');
  }
  if (!EPISTEMIC_STRENGTHS.includes(position.epistemic_strength as never)) {
    throw new TypeError('visible position epistemic strength is invalid.');
  }
  boundedString(position.statement, 'visible position statement', 50_000);
  if (
    !['disputed', 'unresolved', 'procedurally_resolved'].includes(
      String(position.resolution_status),
    )
  ) {
    throw new TypeError('visible position resolution status is invalid.');
  }
  canonicalId(position.source_turn_id, 'visible position source turn');
  for (const span of boundedArray(position.source_span_commitments, 'visible position spans')) {
    validateSourceSpan(span);
  }
  canonicalId(position.supersedes, 'visible position supersedes', true);
  canonicalId(position.superseded_by, 'visible position superseded_by', true);
  canonicalId(position.evidence_ref_id, 'visible position evidence_ref_id', true);
}

function validateRequirement(value: unknown, expectedParty: 'party_a' | 'party_b'): void {
  const requirement = exactObject(value, 'visible requirement', [
    'adverse_fact_probe',
    'label',
    'max_propositions',
    'min_propositions',
    'non_satisfying_position_ids',
    'party_id',
    'prompt',
    'reopened_from',
    'required',
    'requirement_id',
    'satisfying_position_ids',
    'satisfying_types',
    'status',
  ]);
  canonicalId(requirement.requirement_id, 'visible requirement id');
  party(requirement.party_id, 'visible requirement party');
  if (requirement.party_id !== expectedParty) {
    throw new TypeError('visible requirement party binding is invalid.');
  }
  boundedString(requirement.label, 'visible requirement label', 4_000);
  boundedString(requirement.prompt, 'visible requirement prompt', 12_000);
  boolean(requirement.required, 'visible requirement required');
  for (const type of boundedArray(requirement.satisfying_types, 'visible satisfying types', 20)) {
    if (!PROPOSITION_TYPES.includes(type as never)) {
      throw new TypeError('visible requirement satisfying type is invalid.');
    }
  }
  safeInteger(requirement.min_propositions, 'visible requirement minimum');
  if (requirement.max_propositions !== null) {
    safeInteger(requirement.max_propositions, 'visible requirement maximum');
  }
  boolean(requirement.adverse_fact_probe, 'visible requirement adverse probe');
  canonicalId(requirement.reopened_from, 'visible requirement reopened_from', true);
  if (
    !['unsatisfied', 'satisfied', 'blocked_by_clarification'].includes(String(requirement.status))
  ) {
    throw new TypeError('visible requirement status is invalid.');
  }
  for (const id of boundedArray(requirement.satisfying_position_ids, 'satisfying positions')) {
    canonicalId(id, 'satisfying position id');
  }
  for (const id of boundedArray(
    requirement.non_satisfying_position_ids,
    'non-satisfying positions',
  )) {
    canonicalId(id, 'non-satisfying position id');
  }
}

function validateClarification(value: unknown, expectedParty: 'party_a' | 'party_b'): void {
  const clarification = exactObject(value, 'visible clarification', [
    'clarification_id',
    'party_id',
    'prompt',
    'reason',
    'reopened_as',
    'requirement_id',
    'status',
  ]);
  canonicalId(clarification.clarification_id, 'visible clarification id');
  party(clarification.party_id, 'visible clarification party');
  if (clarification.party_id !== expectedParty) {
    throw new TypeError('visible clarification party binding is invalid.');
  }
  canonicalId(clarification.requirement_id, 'visible clarification requirement');
  boundedString(clarification.reason, 'visible clarification reason', 4_000);
  boundedString(clarification.prompt, 'visible clarification prompt', 12_000);
  if (clarification.status !== 'open' && clarification.status !== 'resolved') {
    throw new TypeError('visible clarification status is invalid.');
  }
  canonicalId(clarification.reopened_as, 'visible clarification reopened_as', true);
}

function validateEvidence(value: unknown, expectedParty: 'party_a' | 'party_b'): void {
  const evidence = exactObject(value, 'visible evidence', [
    'attributed_party_id',
    'description',
    'eligibility',
    'evidence_id',
    'required_for_readiness',
  ]);
  canonicalId(evidence.evidence_id, 'visible evidence id');
  party(evidence.attributed_party_id, 'visible evidence party');
  if (evidence.attributed_party_id !== expectedParty) {
    throw new TypeError('visible evidence party binding is invalid.');
  }
  boundedString(evidence.description, 'visible evidence description', 12_000);
  boolean(evidence.required_for_readiness, 'visible evidence readiness');
  if (
    !['pending', 'eligible', 'ineligible', 'not_required'].includes(String(evidence.eligibility))
  ) {
    throw new TypeError('visible evidence eligibility is invalid.');
  }
}

function validateChallengeResponse(value: unknown, expectedParty: 'party_a' | 'party_b'): void {
  const response = exactObject(value, 'visible challenge response', [
    'responding_party_id',
    'response_id',
    'semantic_position_id',
    'source_span_commitments',
    'source_turn_id',
    'statement',
  ]);
  canonicalId(response.response_id, 'visible challenge response id');
  party(response.responding_party_id, 'visible challenge response party');
  if (response.responding_party_id !== expectedParty) {
    throw new TypeError('visible challenge response party binding is invalid.');
  }
  boundedString(response.statement, 'visible challenge response statement', 50_000);
  canonicalId(response.source_turn_id, 'visible challenge response source turn');
  for (const span of boundedArray(response.source_span_commitments, 'challenge response spans')) {
    validateSourceSpan(span);
  }
  canonicalId(response.semantic_position_id, 'challenge response position', true);
}

function validateChallenge(value: unknown, requestingParty: 'party_a' | 'party_b'): void {
  const challenge = exactObject(value, 'visible challenge', [
    'challenge_id',
    'challenging_party_id',
    'response',
    'source_span_commitments',
    'source_turn_id',
    'statement',
    'status',
    'target_party_id',
    'target_position_id',
  ]);
  canonicalId(challenge.challenge_id, 'visible challenge id');
  party(challenge.challenging_party_id, 'visible challenging party');
  party(challenge.target_party_id, 'visible target party');
  if (
    challenge.challenging_party_id === challenge.target_party_id ||
    (challenge.challenging_party_id !== requestingParty &&
      challenge.target_party_id !== requestingParty)
  ) {
    throw new TypeError('visible challenge party binding is invalid.');
  }
  canonicalId(challenge.target_position_id, 'visible challenge target position');
  boundedString(challenge.statement, 'visible challenge statement', 50_000);
  canonicalId(challenge.source_turn_id, 'visible challenge source turn');
  for (const span of boundedArray(challenge.source_span_commitments, 'visible challenge spans')) {
    validateSourceSpan(span);
  }
  if (!['open', 'resolved', 'withdrawn'].includes(String(challenge.status))) {
    throw new TypeError('visible challenge status is invalid.');
  }
  if (challenge.response !== null) {
    validateChallengeResponse(
      challenge.response,
      challenge.target_party_id as 'party_a' | 'party_b',
    );
  }
}

function validateFormationProjection(
  projection: Record<string, unknown>,
  requestingParty: 'party_a' | 'party_b',
): void {
  if (projection.projection_version !== 'juryai-party-formation-projection-v2.1.4') {
    throw new TypeError('formation projection version is invalid.');
  }
  canonicalId(projection.case_id, 'formation projection case id');
  if (!(projection.case_id as string).startsWith('dispute_')) {
    throw new TypeError('formation projection case id is invalid.');
  }
  if (projection.party_id !== requestingParty) {
    throw new TypeError('formation projection party binding is invalid.');
  }
  safeInteger(projection.formation_epoch, 'formation projection epoch', 1);
  if (
    projection.visible_phase !== 'independent_formation' &&
    projection.visible_phase !== 'disclosed_review'
  ) {
    throw new TypeError('formation projection phase is invalid.');
  }
  const ownIdentity = exactObject(projection.own_identity, 'own identity', [
    'authenticated_subject_id',
    'identity_assurance',
  ]);
  canonicalId(ownIdentity.authenticated_subject_id, 'own authenticated subject', true);
  if (
    ownIdentity.identity_assurance !== 'unbound' &&
    ownIdentity.identity_assurance !== 'authenticated'
  ) {
    throw new TypeError('own identity assurance is invalid.');
  }
  const ownProgress = exactObject(projection.own_progress, 'own progress', [
    'independent_formation_complete',
    'last_reopen_event',
  ]);
  boolean(ownProgress.independent_formation_complete, 'own formation completion');
  if (ownProgress.last_reopen_event !== null) {
    const event = exactObject(ownProgress.last_reopen_event, 'last reopen event', [
      'event_id',
      'occurred_at',
      'prior_formation_epoch',
      'reason',
      'resulting_formation_epoch',
    ]);
    canonicalId(event.event_id, 'last reopen event id');
    safeInteger(event.prior_formation_epoch, 'prior formation epoch', 1);
    safeInteger(event.resulting_formation_epoch, 'resulting formation epoch', 1);
    boundedString(event.reason, 'last reopen reason', 2_000);
    boundedString(event.occurred_at, 'last reopen timestamp', 100);
  }
  const ownMaterial = exactObject(projection.own_material, 'own material', [
    'clarifications',
    'evidence',
    'positions',
    'requirements',
  ]);
  for (const position of boundedArray(ownMaterial.positions, 'own positions')) {
    validatePosition(position, requestingParty);
  }
  for (const requirement of boundedArray(ownMaterial.requirements, 'own requirements')) {
    validateRequirement(requirement, requestingParty);
  }
  for (const clarification of boundedArray(ownMaterial.clarifications, 'own clarifications')) {
    validateClarification(clarification, requestingParty);
  }
  for (const evidence of boundedArray(ownMaterial.evidence, 'own evidence')) {
    validateEvidence(evidence, requestingParty);
  }
  for (const challenge of boundedArray(projection.visible_challenges, 'visible challenges')) {
    validateChallenge(challenge, requestingParty);
  }
  if (projection.opponent_material !== null) {
    const opponent = exactObject(projection.opponent_material, 'opponent material', [
      'evidence',
      'party_id',
      'positions',
    ]);
    party(opponent.party_id, 'opponent party');
    if (opponent.party_id === requestingParty) {
      throw new TypeError('opponent party binding is invalid.');
    }
    for (const position of boundedArray(opponent.positions, 'opponent positions')) {
      validatePosition(position, opponent.party_id as 'party_a' | 'party_b');
    }
    for (const evidence of boundedArray(opponent.evidence, 'opponent evidence')) {
      validateEvidence(evidence, opponent.party_id as 'party_a' | 'party_b');
    }
  }
  for (const warning of boundedArray(projection.warnings, 'projection warnings', 1_000)) {
    boundedString(warning, 'projection warning', 4_000);
  }
}

export function decodeFirstPartyReviewV214(value: unknown): ParsedFirstPartyReviewV214 {
  const page = exactObject(value, 'V2.1.4 review page', [
    'can_acknowledge_disclosure_review',
    'can_confirm',
    'can_invite_party_b',
    'can_reopen',
    'disclosure_review_acknowledgment_statement',
    'disclosure_state',
    'own_disclosure_review',
    'review',
    'review_page_version',
    'waiting_for_other_party',
    'workflow_phase',
  ]);
  if (page.review_page_version !== 'juryai-v2.1.4-first-party-review-page-v1.0.0') {
    throw new TypeError('V2.1.4 review page version is invalid.');
  }
  const review = exactObject(page.review, 'V2.1.4 review', [
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
  ]);
  const projection = exactObject(review.formation_projection, 'formation projection', [
    'case_id',
    'formation_epoch',
    'opponent_material',
    'own_identity',
    'own_material',
    'own_progress',
    'party_id',
    'projection_version',
    'visible_challenges',
    'visible_phase',
    'warnings',
  ]);
  const readback = exactObject(review.formation_readback, 'formation read-back', [
    'document',
    'document_hash',
    'party_id',
    'party_projection_hash',
    'readback_version',
  ]);
  const workflow = page.workflow_phase;
  if (
    ![
      'independent_formation',
      'challenge_response',
      'final_confirmation',
      'ready_for_lock',
    ].includes(String(workflow))
  ) {
    throw new TypeError('V2.1.4 workflow phase is invalid.');
  }
  if (page.disclosure_state !== 'embargoed' && page.disclosure_state !== 'disclosed') {
    throw new TypeError('V2.1.4 disclosure state is invalid.');
  }
  if (!['open', 'acknowledged', 'unavailable'].includes(String(page.own_disclosure_review))) {
    throw new TypeError('V2.1.4 disclosure review state is invalid.');
  }
  if (review.party_id !== 'party_a' && review.party_id !== 'party_b') {
    throw new TypeError('V2.1.4 party identity is invalid.');
  }
  validateFormationProjection(projection, review.party_id);
  if (
    review.own_confirmation_state !== 'unconfirmed' &&
    review.own_confirmation_state !== 'confirmed'
  ) {
    throw new TypeError('V2.1.4 confirmation state is invalid.');
  }
  if (review.shared_readiness !== 'not_ready' && review.shared_readiness !== 'ready_for_lock') {
    throw new TypeError('V2.1.4 shared readiness is invalid.');
  }
  if (
    review.review_state_version !== 'juryai-party-review-state-v1.2.0' ||
    review.formation_projection_version !== 'juryai-party-formation-projection-v2.1.4' ||
    review.formation_readback_version !== 'juryai-party-formation-readback-v2.1.4' ||
    projection.party_id !== review.party_id ||
    projection.case_id !== review.dispute_id ||
    readback.party_id !== review.party_id ||
    readback.readback_version !== 'juryai-party-formation-readback-v2.1.4' ||
    readback.document_hash !== review.party_readback_hash ||
    readback.party_projection_hash !== review.party_projection_hash
  ) {
    throw new TypeError('V2.1.4 frozen review binding is invalid.');
  }
  if (
    !Number.isSafeInteger(review.party_visible_version) ||
    (review.party_visible_version as number) < 1 ||
    !Number.isSafeInteger(review.formation_epoch) ||
    (review.formation_epoch as number) < 1
  ) {
    throw new TypeError('V2.1.4 review counters are invalid.');
  }
  for (const hashValue of [
    review.party_projection_hash,
    review.party_readback_hash,
    review.review_state_hash,
    readback.document_hash,
  ]) {
    digest(hashValue, 'V2.1.4 review hash');
  }
  boundedString(readback.document, 'formation read-back document', 2_000_000);
  boundedString(
    page.disclosure_review_acknowledgment_statement,
    'disclosure review acknowledgment statement',
    4_000,
  );
  return {
    review_page_version: page.review_page_version,
    review: review as unknown as PartyReviewStateV214,
    workflow_phase: workflow as ParsedFirstPartyReviewV214['workflow_phase'],
    disclosure_state: page.disclosure_state,
    own_disclosure_review:
      page.own_disclosure_review as ParsedFirstPartyReviewV214['own_disclosure_review'],
    can_acknowledge_disclosure_review: boolean(
      page.can_acknowledge_disclosure_review,
      'can_acknowledge_disclosure_review',
    ),
    can_confirm: boolean(page.can_confirm, 'can_confirm'),
    can_reopen: boolean(page.can_reopen, 'can_reopen'),
    can_invite_party_b: boolean(page.can_invite_party_b, 'can_invite_party_b'),
    waiting_for_other_party: boolean(page.waiting_for_other_party, 'waiting_for_other_party'),
    disclosure_review_acknowledgment_statement:
      page.disclosure_review_acknowledgment_statement as string,
  };
}
