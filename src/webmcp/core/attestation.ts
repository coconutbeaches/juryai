/**
 * Canonical case state, first-party rendering, and the append-only
 * attestation model.
 *
 * There is no `awaiting_confirmation` state. Review is a UI activity, not a
 * canonical case state. The snapshot is taken AT confirm time from current
 * state, and the confirm request carries the hash of the document the human
 * actually read. If anything changed between render and click, the hashes
 * disagree and confirmation fails safely.
 *
 * Attestations are an append-only collection keyed to a case version, and
 * lock status is DERIVED from it. That is what makes post-lock amendment a
 * natural extension rather than schema surgery on records that are themselves
 * legal artefacts.
 */

import {
  canonicalSerialize,
  isCanonicalId,
  isHash,
  issue,
  sha256,
  WEBMCP_CORE_SCHEMA_VERSION,
  WEBMCP_PROTOCOL_VERSION,
  wrapAgentFacingText,
  type CaseStateResponse,
  type CaseStatus,
  type ContractIssue,
  type EvidenceReference,
} from './types.js';
import { attributionFor, livePropositions, type Proposition } from './propositions.js';
import {
  deriveReadiness,
  type ClarificationRequest,
  type RequirementDefinition,
} from './requirements.js';
import { computeSourceTurnMetadataCommitment, type SourceTurnRecord } from './turns.js';
import {
  adoptionStatementForV1,
  renderCanonicalReadbackV1,
  verifyRenderCompletenessV1,
} from './readback.js';

export { verifyRenderCompleteness } from './readback.js';
export { adoptionStatementFor } from './readback.js';
export {
  adoptionStatementForV1,
  LEGACY_READBACK_RENDERER_VERSION,
  renderCanonicalReadbackV1,
  verifyRenderCompletenessV1,
} from './readback.js';
export {
  parseReadbackDocument,
  READBACK_FORMAT_VERSION,
  ReadbackParseError,
} from './readback-format.js';

export const ATTESTATION_CONTRACT_VERSION = 'juryai-webmcp-attestation-v0.3.0';
export const LEGACY_RENDER_TEMPLATE_VERSION = 'juryai-canonical-account-render-v0.2.0';
export const LEGACY_CANONICAL_STATE_PROJECTION_VERSION = 'juryai-canonical-state-projection-v1';
export const DEFAULT_CHALLENGE_TTL_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------------------ */
/* Canonical case state                                                      */
/* ------------------------------------------------------------------------ */

export interface CaseState {
  case_id: string;
  case_version: number;
  principal_id: string;
  /** Disclosure the principal accepted at case creation. Never backfillable. */
  disclosure_version: string;
  disclosure_accepted_at: string;
  requirements: RequirementDefinition[];
  propositions: Proposition[];
  clarifications: ClarificationRequest[];
  evidence_references: EvidenceReference[];
  turn_log: SourceTurnRecord[];
  attestations: AttestationRecord[];
}

export function canonicalStateProjectionV1(state: CaseState): unknown {
  return {
    case_id: state.case_id,
    case_version: state.case_version,
    principal_id: state.principal_id,
    disclosure_version: state.disclosure_version,
    disclosure_accepted_at: state.disclosure_accepted_at,
    requirements: state.requirements,
    propositions: state.propositions,
    clarifications: state.clarifications,
    evidence_references: state.evidence_references,
  };
}

/** Backward-compatible name for the frozen legacy projection. */
export const canonicalStateProjection = canonicalStateProjectionV1;

export function hashCanonicalStateV1(state: CaseState): string {
  return sha256(canonicalSerialize(canonicalStateProjectionV1(state)));
}

/** Backward-compatible name for the frozen legacy canonical hash. */
export const hashCanonicalState = hashCanonicalStateV1;

/**
 * Lock status is derived: the case is locked when its CURRENT version carries
 * an attestation. An amendment raises the version and the case returns to
 * draft until a human attests again; the earlier attestation stays valid and
 * visible forever.
 */
export function deriveCaseStatus(state: CaseState): CaseStatus {
  return state.attestations.some((attestation) => attestation.case_version === state.case_version)
    ? 'locked'
    : 'draft';
}

export function attestedVersions(state: CaseState): number[] {
  return [...new Set(state.attestations.map((attestation) => attestation.case_version))].sort(
    (a, b) => a - b,
  );
}

/* ------------------------------------------------------------------------ */
/* First-party render                                                        */
/* ------------------------------------------------------------------------ */

export interface RenderedAccount {
  render_template_version: string;
  case_id: string;
  case_version: number;
  document: string;
  document_hash: string;
}

/**
 * The rendering the human reads. It must show what is MISSING as well as what
 * is present: selective omission by the relay is the one corruption mode
 * nothing else in the architecture touches, and this is the only place a
 * human can catch it. Epistemic strength is surfaced for every proposition
 * because it is the most error-prone attribute the validator cannot check.
 */
export function renderCanonicalAccountV1(state: CaseState): RenderedAccount {
  return renderCanonicalReadbackV1(state);
}

/** Backward-compatible name for the frozen legacy account renderer. */
export const renderCanonicalAccount = renderCanonicalAccountV1;

/* ------------------------------------------------------------------------ */
/* Render challenge                                                          */
/* ------------------------------------------------------------------------ */

/**
 * A server-side nonce is issued at RENDER time and required in the confirm
 * request from day one, even though V0 only checks that it matches and has not
 * expired. That is what makes the WebAuthn upgrade "sign the challenge you are
 * already issuing" rather than a new flow with new state.
 */
export interface RenderChallenge {
  challenge: string;
  case_id: string;
  case_version: number;
  rendered_document_hash: string;
  render_template_version: string;
  attestation_contract_version: string;
  adoption_statement_hash: string;
  issued_at_ms: number;
  expires_at_ms: number;
}

export function issueRenderChallenge(
  state: CaseState,
  render: RenderedAccount,
  nonce: string,
  nowMs: number,
  ttlMs: number = DEFAULT_CHALLENGE_TTL_MS,
): RenderChallenge {
  if (render.case_id !== state.case_id || render.case_version !== state.case_version) {
    throw new TypeError('Render challenge state and document identities disagree.');
  }
  const statement = adoptionStatementForV1(state);
  return {
    challenge: nonce,
    case_id: state.case_id,
    case_version: render.case_version,
    rendered_document_hash: render.document_hash,
    render_template_version: render.render_template_version,
    attestation_contract_version: ATTESTATION_CONTRACT_VERSION,
    adoption_statement_hash: sha256(statement),
    issued_at_ms: nowMs,
    expires_at_ms: nowMs + ttlMs,
  };
}

/* ------------------------------------------------------------------------ */
/* Attestation records                                                       */
/* ------------------------------------------------------------------------ */

export type AssuranceLevel = 'ui_click' | 'email_oob' | 'webauthn_uv';

const ASSURANCE_BY_METHOD = new Map<string, AssuranceLevel>([
  ['first_party_ui_click', 'ui_click'],
  ['email_confirmation_link', 'email_oob'],
  ['webauthn_user_verification', 'webauthn_uv'],
]);

export function deriveAssuranceLevel(verificationMethod: string): AssuranceLevel {
  return ASSURANCE_BY_METHOD.get(verificationMethod) ?? 'ui_click';
}

export interface AuthenticatorRef {
  credential_id: string;
  aaguid: string | null;
  sign_count: number | null;
}

export interface AttestedEvidenceRef {
  evidence_ref_id: string;
  label: string;
  inspection_status: EvidenceReference['inspection_status'];
}

interface AttestationRecordBase {
  attestation_id: string;
  case_id: string;
  case_version: number;
  canonical_state_hash: string;
  rendered_document: string;
  rendered_document_hash: string;
  render_template_version: string;
  challenge: string;
  /** Open string, never a boolean "confirmed". */
  verification_method: string;
  assurance_level: AssuranceLevel;
  authenticator_ref: AuthenticatorRef | null;
  signature: string | null;
  signature_alg: string | null;
  source_turn_ids: string[];
  /** Salted commitments, so erasure never invalidates the attestation. */
  source_turn_commitments: string[];
  /** Deterministic commitments over explicit immutable source-time metadata. */
  source_turn_metadata_commitments: string[];
  evidence_refs: AttestedEvidenceRef[];
  unresolved_requirement_ids: string[];
  schema_version: string;
  protocol_version: string;
  compiler_version_ids: string[];
  structural_validator_version: string;
  principal_id: string;
  created_at: string;
  client_ip: string | null;
  user_agent: string | null;
}

/** Historical V0.2 records predate the adoption contract and must stay readable as-is. */
export interface LegacyAttestationRecordV02 extends AttestationRecordBase {
  attestation_contract_version?: never;
  adoption_statement?: never;
  adoption_statement_hash?: never;
}

/** Every attestation created by the current server has this complete V0.3 shape. */
export interface AttestationRecordV03 extends AttestationRecordBase {
  attestation_contract_version: string;
  adoption_statement: string;
  adoption_statement_hash: string;
}

export type AttestationRecord = LegacyAttestationRecordV02 | AttestationRecordV03;

const V03_ATTESTATION_FIELDS = [
  'attestation_contract_version',
  'adoption_statement',
  'adoption_statement_hash',
] as const;

function hasOwn(
  record: AttestationRecord,
  field: (typeof V03_ATTESTATION_FIELDS)[number],
): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

export function isLegacyAttestationRecordV02(
  record: AttestationRecord,
): record is LegacyAttestationRecordV02 {
  return (
    record.render_template_version === LEGACY_RENDER_TEMPLATE_VERSION &&
    V03_ATTESTATION_FIELDS.every((field) => !hasOwn(record, field))
  );
}

export function isAttestationRecordV03(record: AttestationRecord): record is AttestationRecordV03 {
  return V03_ATTESTATION_FIELDS.every((field) => hasOwn(record, field));
}

export interface AttestationAttempt {
  attestation_id: string;
  case_id: string;
  principal_id: string;
  challenge: string;
  rendered_document_hash: string;
  verification_method: string;
  authenticator_ref: AuthenticatorRef | null;
  signature: string | null;
  signature_alg: string | null;
  created_at: string;
  client_ip: string | null;
  user_agent: string | null;
}

export type AttestationVerification =
  | { kind: 'accepted'; record: AttestationRecordV03 }
  | { kind: 'rejected'; reason: AttestationRejection; issues: ContractIssue[] };

export type AttestationStructuralValidator = (state: CaseState) => {
  validator_version: string;
  ok: boolean;
  issues: ContractIssue[];
};

export type AttestationRejection =
  | 'challenge_unknown'
  | 'challenge_expired'
  | 'case_mismatch'
  | 'principal_mismatch'
  | 'state_changed'
  | 'render_changed'
  | 'contract_changed'
  | 'adoption_changed'
  | 'render_incomplete'
  | 'structurally_invalid'
  | 'not_ready'
  | 'already_locked';

/**
 * Verifies a confirmation attempt against CURRENT state. Any drift between
 * render and click fails closed and the human must review the updated account.
 * The real structural validator is a mandatory dependency so this module does
 * not duplicate its rules or create a runtime import cycle.
 */
export function verifyAttestationAttempt(
  state: CaseState,
  challenge: RenderChallenge,
  attempt: AttestationAttempt,
  nowMs: number,
  validateStructure: AttestationStructuralValidator,
): AttestationVerification {
  const reject = (
    reason: AttestationRejection,
    code: string,
    message: string,
  ): AttestationVerification => ({
    kind: 'rejected',
    reason,
    issues: [issue(code, 'attestation', message)],
  });

  if (attempt.challenge !== challenge.challenge) {
    return reject(
      'challenge_unknown',
      'attestation_challenge_unknown',
      'Challenge does not match.',
    );
  }
  if (nowMs > challenge.expires_at_ms) {
    return reject('challenge_expired', 'attestation_challenge_expired', 'Challenge has expired.');
  }
  if (challenge.case_id !== state.case_id || attempt.case_id !== state.case_id) {
    return reject('case_mismatch', 'attestation_case_mismatch', 'Challenge is for another case.');
  }
  if (attempt.principal_id !== state.principal_id) {
    return reject(
      'principal_mismatch',
      'attestation_principal_mismatch',
      'Attesting principal does not own this case.',
    );
  }
  if (deriveCaseStatus(state) === 'locked') {
    return reject(
      'already_locked',
      'attestation_already_locked',
      'The current case version is already attested.',
    );
  }
  if (challenge.case_version !== state.case_version) {
    return reject(
      'state_changed',
      'attestation_state_changed',
      'Case state changed after the account was rendered.',
    );
  }
  if (challenge.attestation_contract_version !== ATTESTATION_CONTRACT_VERSION) {
    return reject(
      'contract_changed',
      'attestation_contract_changed',
      'The attestation contract changed after the account was rendered.',
    );
  }
  const render = renderCanonicalAccountV1(state);
  if (
    render.document_hash !== challenge.rendered_document_hash ||
    render.document_hash !== attempt.rendered_document_hash
  ) {
    return reject(
      'render_changed',
      'attestation_render_changed',
      'The rendered account no longer matches what was confirmed.',
    );
  }
  const completeness = verifyRenderCompletenessV1(state, render.document);
  if (!completeness.ok) {
    return {
      kind: 'rejected',
      reason: 'render_incomplete',
      issues: [
        issue(
          'attestation_render_incomplete',
          'attestation',
          'The canonical read-back is incomplete and cannot be attested.',
        ),
        ...completeness.issues,
      ],
    };
  }
  const adoptionStatement = adoptionStatementForV1(state);
  const adoptionStatementHash = sha256(adoptionStatement);
  if (challenge.adoption_statement_hash !== adoptionStatementHash) {
    return reject(
      'adoption_changed',
      'attestation_adoption_changed',
      'The adoption statement changed after the account was rendered.',
    );
  }
  const structuralReport = validateStructure(state);
  if (!structuralReport.ok) {
    return {
      kind: 'rejected',
      reason: 'structurally_invalid',
      issues: [
        issue(
          'attestation_structurally_invalid',
          'attestation',
          'The case must pass structural validation before it can be attested.',
        ),
        ...structuralReport.issues,
      ],
    };
  }
  const readiness = deriveReadiness(state.requirements, state.propositions, state.clarifications);
  if (!readiness.ready) {
    return reject(
      'not_ready',
      'attestation_not_ready',
      'The case still has unresolved requirements or open clarifications.',
    );
  }

  const record: AttestationRecordV03 = {
    attestation_id: attempt.attestation_id,
    case_id: state.case_id,
    case_version: state.case_version,
    canonical_state_hash: hashCanonicalStateV1(state),
    rendered_document: render.document,
    rendered_document_hash: render.document_hash,
    render_template_version: render.render_template_version,
    attestation_contract_version: ATTESTATION_CONTRACT_VERSION,
    adoption_statement: adoptionStatement,
    adoption_statement_hash: adoptionStatementHash,
    challenge: attempt.challenge,
    verification_method: attempt.verification_method,
    assurance_level: deriveAssuranceLevel(attempt.verification_method),
    authenticator_ref: attempt.authenticator_ref,
    signature: attempt.signature,
    signature_alg: attempt.signature_alg,
    source_turn_ids: state.turn_log.map((turn) => turn.turn_id),
    source_turn_commitments: state.turn_log.map((turn) => turn.payload_commitment),
    source_turn_metadata_commitments: state.turn_log.map(computeSourceTurnMetadataCommitment),
    evidence_refs: state.evidence_references.map((reference) => ({
      evidence_ref_id: reference.evidence_ref_id,
      label: reference.label,
      inspection_status: reference.inspection_status,
    })),
    unresolved_requirement_ids: readiness.unresolved_requirement_ids,
    schema_version: WEBMCP_CORE_SCHEMA_VERSION,
    protocol_version: WEBMCP_PROTOCOL_VERSION,
    compiler_version_ids: [
      ...new Set(state.propositions.map((proposition) => proposition.compiler_version_id)),
    ].sort(),
    structural_validator_version: structuralReport.validator_version,
    principal_id: state.principal_id,
    created_at: attempt.created_at,
    client_ip: attempt.client_ip,
    user_agent: attempt.user_agent,
  };
  return { kind: 'accepted', record };
}

/** Append-only. Never overwrites, never regresses, never deduplicates away. */
export function appendAttestation(
  attestations: readonly AttestationRecord[],
  record: AttestationRecordV03,
): AttestationRecord[] {
  if (attestations.some((entry) => entry.attestation_id === record.attestation_id)) {
    throw new TypeError(
      "Attestations are append-only; '" + record.attestation_id + "' already exists.",
    );
  }
  if (attestations.some((entry) => entry.case_version === record.case_version)) {
    throw new TypeError('Case version ' + String(record.case_version) + ' is already attested.');
  }
  const highest = attestations.reduce((max, entry) => Math.max(max, entry.case_version), -1);
  if (record.case_version < highest) {
    throw new TypeError('Attestation case_version must not regress below an existing attestation.');
  }
  return [...attestations, record];
}

export function validateAttestationRecord(
  record: AttestationRecord,
  path: string,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!isCanonicalId(record.attestation_id)) {
    issues.push(
      issue(
        'attestation_id_invalid',
        path + '.attestation_id',
        'attestation_id is not a canonical id.',
      ),
    );
  }
  if (!isHash(record.canonical_state_hash)) {
    issues.push(
      issue(
        'attestation_state_hash_invalid',
        path + '.canonical_state_hash',
        'canonical_state_hash must be a sha256 hex digest.',
      ),
    );
  }
  if (sha256(record.rendered_document) !== record.rendered_document_hash) {
    issues.push(
      issue(
        'attestation_render_hash_mismatch',
        path + '.rendered_document_hash',
        'rendered_document_hash does not match the stored rendered_document.',
      ),
    );
  }
  const hasAnyV03Field = V03_ATTESTATION_FIELDS.some((field) => hasOwn(record, field));
  if (!hasAnyV03Field) {
    if (!isLegacyAttestationRecordV02(record)) {
      issues.push(
        issue(
          'attestation_legacy_shape_invalid',
          path + '.render_template_version',
          'An attestation without V0.3 adoption fields must be an exact historical V0.2 record.',
        ),
      );
    }
  } else if (!isAttestationRecordV03(record)) {
    issues.push(
      issue(
        'attestation_v03_shape_incomplete',
        path,
        'A V0.3 attestation must contain every contract and adoption field.',
      ),
    );
  } else {
    if (record.attestation_contract_version !== ATTESTATION_CONTRACT_VERSION) {
      issues.push(
        issue(
          'attestation_contract_version_invalid',
          path + '.attestation_contract_version',
          'attestation_contract_version is not the current durable contract.',
        ),
      );
    }
    if (
      typeof record.adoption_statement !== 'string' ||
      typeof record.adoption_statement_hash !== 'string' ||
      sha256(record.adoption_statement) !== record.adoption_statement_hash
    ) {
      issues.push(
        issue(
          'attestation_adoption_hash_mismatch',
          path + '.adoption_statement_hash',
          'adoption_statement_hash does not match the stored adoption_statement.',
        ),
      );
    }
  }
  if (record.challenge.trim().length === 0) {
    issues.push(
      issue(
        'attestation_challenge_missing',
        path + '.challenge',
        'A render-time challenge is required for every attestation.',
      ),
    );
  }
  if (record.verification_method.trim().length === 0) {
    issues.push(
      issue(
        'attestation_method_missing',
        path + '.verification_method',
        'verification_method must name how human presence was established.',
      ),
    );
  }
  if (
    record.source_turn_ids.length !== record.source_turn_commitments.length ||
    record.source_turn_ids.length !== record.source_turn_metadata_commitments.length
  ) {
    issues.push(
      issue(
        'attestation_commitment_arity',
        path + '.source_turn_commitments',
        'Every attested source turn must carry exactly one payload and metadata commitment.',
      ),
    );
  }
  for (const [index, commitment] of record.source_turn_metadata_commitments.entries()) {
    if (!isHash(commitment)) {
      issues.push(
        issue(
          'attestation_metadata_commitment_invalid',
          path + '.source_turn_metadata_commitments[' + String(index) + ']',
          'Source-turn metadata commitment must be a sha256 hex digest.',
        ),
      );
    }
  }
  return issues;
}

/* ------------------------------------------------------------------------ */
/* Response-slot projection                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Builds the agent-facing `get_case_state` response from canonical state.
 * Construction is by allowlist: nothing reaches the relay unless it is one of
 * the permitted slots. In particular there is no readiness score, no legal
 * assessment, no compiler internals and no adverse-fact detection logic.
 */
export function projectCaseState(
  state: CaseState,
  options: { review_url: string; warnings?: string[]; recent_interpretation_limit?: number },
): CaseStateResponse {
  const readiness = deriveReadiness(state.requirements, state.propositions, state.clarifications);
  const unresolved = new Set(readiness.unresolved_requirement_ids);
  const next = state.requirements
    .filter((definition) => unresolved.has(definition.requirement_id))
    .slice(0, 3)
    .map((definition) => ({
      requirement_id: definition.requirement_id,
      prompt: wrapAgentFacingText(definition.prompt),
    }));
  const live = livePropositions(state.propositions);
  const limit = options.recent_interpretation_limit ?? 5;
  const recent = live.slice(Math.max(0, live.length - limit)).map((proposition) => ({
    proposition_id: proposition.proposition_id,
    requirement_id: proposition.in_reply_to,
    statement: wrapAgentFacingText(proposition.statement),
    type: proposition.type,
    epistemic_strength: proposition.epistemic_strength,
    attribution: wrapAgentFacingText(attributionFor(proposition)),
  }));

  return {
    case_id: state.case_id,
    case_version: state.case_version,
    protocol_version: WEBMCP_PROTOCOL_VERSION,
    schema_version: WEBMCP_CORE_SCHEMA_VERSION,
    status: deriveCaseStatus(state),
    unresolved_requirement_count: readiness.unresolved_requirement_ids.length,
    next_requirements: next,
    open_clarifications: state.clarifications
      .filter((clarification) => clarification.resolved_at_case_version === null)
      .map((clarification) => ({
        clarification_id: clarification.clarification_id,
        requirement_id: clarification.requirement_id,
        prompt: wrapAgentFacingText(clarification.prompt),
      })),
    recent_interpretations: recent,
    evidence_references: state.evidence_references.map((reference) => ({
      evidence_ref_id: reference.evidence_ref_id,
      label: wrapAgentFacingText(reference.label),
      inspection_status: reference.inspection_status,
    })),
    warnings: (options.warnings ?? []).map(wrapAgentFacingText),
    review_url: options.review_url,
  };
}
