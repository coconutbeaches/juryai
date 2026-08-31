import { parseReadbackDocument, type ParsedReadbackDocument } from '../core/readback-format.js';

export type ReviewBlockingReason =
  | 'already_locked'
  | 'readback_incomplete'
  | 'structurally_invalid'
  | 'unresolved_requirements'
  | 'open_clarifications';

export interface FirstPartyReview {
  case_id: string;
  case_version: number;
  status: 'draft' | 'locked';
  render_template_version: string;
  document: string;
  document_hash: string;
  attestation_contract_version: string;
  adoption_statement: string;
  adoption_statement_hash: string;
  attestable: boolean;
  blocking_reasons: ReviewBlockingReason[];
  challenge: string | null;
}

export interface ParsedFirstPartyReview extends FirstPartyReview {
  parsed_document: ParsedReadbackDocument;
}

function exactObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Review response must be an object.');
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !allowed.includes(key))) {
    throw new TypeError('Review response contains an unknown field.');
  }
  return object;
}

function string(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError('Review response string is invalid.');
  }
  return value;
}

function hash(value: unknown): string {
  const decoded = string(value, 64);
  if (!/^[a-f0-9]{64}$/u.test(decoded)) throw new TypeError('Review hash is invalid.');
  return decoded;
}

export function decodeFirstPartyReview(value: unknown): ParsedFirstPartyReview {
  const review = exactObject(value, [
    'case_id',
    'case_version',
    'status',
    'render_template_version',
    'document',
    'document_hash',
    'attestation_contract_version',
    'adoption_statement',
    'adoption_statement_hash',
    'attestable',
    'blocking_reasons',
    'challenge',
  ]);
  const caseId = string(review.case_id, 160);
  const caseVersion = review.case_version;
  if (!Number.isSafeInteger(caseVersion) || (caseVersion as number) < 0) {
    throw new TypeError('Review case version is invalid.');
  }
  if (review.status !== 'draft' && review.status !== 'locked') {
    throw new TypeError('Review status is invalid.');
  }
  if (typeof review.attestable !== 'boolean') throw new TypeError('Review attestable is invalid.');
  const reasons: readonly ReviewBlockingReason[] = [
    'already_locked',
    'readback_incomplete',
    'structurally_invalid',
    'unresolved_requirements',
    'open_clarifications',
  ];
  if (
    !Array.isArray(review.blocking_reasons) ||
    review.blocking_reasons.some((reason) => !reasons.includes(reason as ReviewBlockingReason))
  ) {
    throw new TypeError('Review blocking reasons are invalid.');
  }
  const challenge = review.challenge;
  if (
    challenge !== null &&
    (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(challenge))
  ) {
    throw new TypeError('Review challenge is invalid.');
  }
  if (review.attestable !== (challenge !== null)) {
    throw new TypeError('Review challenge and attestable state disagree.');
  }
  const document = string(review.document, 2_000_000);
  const parsed = parseReadbackDocument(document);
  const template = string(review.render_template_version, 200);
  if (
    parsed.case_id !== caseId ||
    parsed.case_version !== caseVersion ||
    parsed.template !== template
  ) {
    throw new TypeError('Review document identity does not match its envelope.');
  }
  return {
    case_id: caseId,
    case_version: caseVersion as number,
    status: review.status,
    render_template_version: template,
    document,
    document_hash: hash(review.document_hash),
    attestation_contract_version: string(review.attestation_contract_version, 200),
    adoption_statement: string(review.adoption_statement, 4_000),
    adoption_statement_hash: hash(review.adoption_statement_hash),
    attestable: review.attestable,
    blocking_reasons: [...review.blocking_reasons] as ReviewBlockingReason[],
    challenge,
    parsed_document: parsed,
  };
}
