import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CaseRuntime } from '../runtime/index.js';
import type { CaseRuntimeStore } from '../runtime/index.js';
import { createRuntimeCaseService } from '../service/index.js';
import {
  ATTESTATION_CONTRACT_VERSION,
  adoptionStatementForV1,
  appendAttestation,
  deriveCaseStatus,
  issueRenderChallenge,
  renderCanonicalAccountV1,
  verifyAttestationAttempt,
  verifyRenderCompletenessV1,
  type AttestationAttempt,
  type RenderChallenge,
} from '../core/attestation.js';
import { validateCaseState } from '../core/structural-validator.js';
import { deriveReadiness } from '../core/requirements.js';
import { isCanonicalId, isHash, sha256 } from '../core/types.js';
import {
  decodeCaseServiceHttpRequest,
  decodeCaseServiceResult,
  type CaseServiceHttpRequest,
} from '../public-contract.js';
import type { JuryAiWebServerConfig } from './config.js';
import { JURYAI_P2_DISCLOSURE_COPY, JURYAI_P2_DISCLOSURE_VERSION } from './disclosure.js';
import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireMethod,
  requireSameOrigin,
} from './http.js';
import {
  authenticateWebSession,
  expiredSessionCookie,
  hashSessionToken,
  issueWebSession,
  firstPartyRuntimeContextProvider,
  readSessionCookie,
  sessionCookie,
  sessionRuntimeContextProvider,
  type SessionTokenFactory,
} from './session.js';
import type { SupabaseAuthGateway } from './supabase-auth.js';
import type { WebSessionPersistence, WebSessionRecord } from './web-session-store.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const OTP_PATTERN = /^\d{6}$/u;

type RuntimeCaseOperations = Pick<CaseRuntime, 'startCase' | 'getCaseState' | 'submitTurn'>;

export interface JuryAiWebServerDependencies {
  config: JuryAiWebServerConfig;
  persistence: WebSessionPersistence;
  authForRequest: () => SupabaseAuthGateway;
  runtime: () => RuntimeCaseOperations | Promise<RuntimeCaseOperations>;
  caseStore?: () => CaseRuntimeStore | Promise<CaseRuntimeStore>;
  now?: () => Date;
  sessionTokenFactory?: SessionTokenFactory;
  challengeTokenFactory?: () => string;
  attestationIdFactory?: () => string;
}

const CORRECTION_DISPOSITIONS = [
  'correct_meaning',
  'add_information',
  'change_answer',
  'dont_remember',
  'decline_to_answer',
  'resolve_clarification',
] as const;

type CorrectionDisposition = (typeof CORRECTION_DISPOSITIONS)[number];

function isReplacementDisposition(
  disposition: CorrectionDisposition,
): disposition is 'correct_meaning' | 'change_answer' {
  return disposition === 'correct_meaning' || disposition === 'change_answer';
}

function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Request body must be an object.');
  }
  const decoded = value as Record<string, unknown>;
  if (Object.keys(decoded).some((key) => !allowed.includes(key))) {
    throw new TypeError('Request body contains an unknown field.');
  }
  return decoded;
}

function email(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Email is invalid.');
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    throw new TypeError('Email is invalid.');
  }
  return normalized;
}

function otp(value: unknown): string {
  if (typeof value !== 'string' || !OTP_PATTERN.test(value)) {
    throw new TypeError('The verification code must contain six digits.');
  }
  return value;
}

interface CorrectionInput {
  expected_case_version: number;
  in_reply_to: string[];
  client_turn_id: string;
  disposition: CorrectionDisposition;
  target_proposition_id: string | null;
  text: string;
}

function correctionInput(value: unknown): CorrectionInput {
  const body = record(value, [
    'expected_case_version',
    'in_reply_to',
    'client_turn_id',
    'disposition',
    'target_proposition_id',
    'text',
    // Explicitly listed nowhere: identity/provenance fields therefore fail.
  ]);
  if (
    !Number.isSafeInteger(body.expected_case_version) ||
    (body.expected_case_version as number) < 0
  ) {
    throw new TypeError('expected_case_version is invalid.');
  }
  if (
    !Array.isArray(body.in_reply_to) ||
    body.in_reply_to.length === 0 ||
    body.in_reply_to.length > 10 ||
    body.in_reply_to.some((id) => !isCanonicalId(id)) ||
    new Set(body.in_reply_to).size !== body.in_reply_to.length
  ) {
    throw new TypeError('in_reply_to is invalid.');
  }
  if (
    typeof body.client_turn_id !== 'string' ||
    body.client_turn_id.length === 0 ||
    body.client_turn_id.length > 200
  ) {
    throw new TypeError('client_turn_id is invalid.');
  }
  if (!CORRECTION_DISPOSITIONS.includes(body.disposition as CorrectionDisposition)) {
    throw new TypeError('disposition is invalid.');
  }
  const disposition = body.disposition as CorrectionDisposition;
  const replacement = isReplacementDisposition(disposition);
  if (
    replacement &&
    (!isCanonicalId(body.target_proposition_id) || (body.in_reply_to as unknown[]).length !== 1)
  ) {
    throw new TypeError('A replacement correction requires one target proposition.');
  }
  if (!replacement && body.target_proposition_id !== undefined) {
    throw new TypeError('This correction disposition does not accept a target proposition.');
  }
  let text: string;
  if (disposition === 'dont_remember') {
    if (body.text !== undefined) throw new TypeError('dont_remember does not accept text.');
    text = "I don't remember.";
  } else if (disposition === 'decline_to_answer') {
    if (body.text !== undefined) throw new TypeError('decline_to_answer does not accept text.');
    text = 'I choose not to answer this.';
  } else {
    if (
      typeof body.text !== 'string' ||
      body.text.trim().length === 0 ||
      body.text.length > 12_000
    ) {
      throw new TypeError('Correction text is invalid.');
    }
    text = body.text;
  }
  const decoded: CorrectionInput = {
    expected_case_version: body.expected_case_version as number,
    in_reply_to: [...body.in_reply_to] as string[],
    client_turn_id: body.client_turn_id,
    disposition,
    target_proposition_id: replacement ? (body.target_proposition_id as string) : null,
    text,
  };
  textualizeCorrection(decoded);
  return decoded;
}

function textualizeCorrection(input: CorrectionInput): string {
  if (isReplacementDisposition(input.disposition) && input.target_proposition_id === null) {
    throw new TypeError('A replacement correction requires a target proposition.');
  }
  const answer =
    input.disposition === 'correct_meaning'
      ? `Correction to proposition ${input.target_proposition_id}: ${input.text}`
      : input.disposition === 'change_answer'
        ? `Changed answer replacing proposition ${input.target_proposition_id}: ${input.text}`
        : input.text;
  if (answer.length > 12_000) throw new TypeError('Correction answer is too long.');
  return answer;
}

function attestationInput(value: unknown): { challenge: string; rendered_document_hash: string } {
  const body = record(value, ['challenge', 'rendered_document_hash']);
  if (typeof body.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(body.challenge)) {
    throw new TypeError('challenge is invalid.');
  }
  if (!isHash(body.rendered_document_hash)) {
    throw new TypeError('rendered_document_hash is invalid.');
  }
  return { challenge: body.challenge, rendered_document_hash: body.rendered_document_hash };
}

export class JuryAiWebServer {
  readonly #dependencies: JuryAiWebServerDependencies;

  constructor(dependencies: JuryAiWebServerDependencies) {
    this.#dependencies = dependencies;
  }

  #now(): Date {
    return new Date((this.#dependencies.now ?? (() => new Date()))());
  }

  async #session(request: Request): Promise<WebSessionRecord | null> {
    return authenticateWebSession(
      this.#dependencies.persistence,
      request.headers.get('Cookie'),
      this.#dependencies.config.cookie,
      this.#now(),
    );
  }

  #postBoundary(request: Request): Response | null {
    return (
      requireMethod(request, 'POST') ??
      requireSameOrigin(request, this.#dependencies.config.publicOrigin)
    );
  }

  async #authorizedSession(request: Request): Promise<WebSessionRecord | Response> {
    let session: WebSessionRecord | null;
    try {
      session = await this.#session(request);
    } catch {
      return errorResponse(500, 'SESSION_UNAVAILABLE', 'The JuryAI session could not be checked.');
    }
    if (session === null) return errorResponse(401, 'AUTH_REQUIRED', 'Authentication is required.');
    try {
      const accepted = await this.#dependencies.persistence.hasDisclosureAcceptance(
        session.principal_id,
        JURYAI_P2_DISCLOSURE_VERSION,
      );
      return accepted
        ? session
        : errorResponse(403, 'DISCLOSURE_REQUIRED', 'Disclosure acceptance is required.');
    } catch {
      return errorResponse(500, 'SESSION_UNAVAILABLE', 'Disclosure status could not be checked.');
    }
  }

  async #caseStore(): Promise<CaseRuntimeStore> {
    if (!this.#dependencies.caseStore) {
      throw new Error('Step 64 case persistence is unavailable.');
    }
    const store = await this.#dependencies.caseStore();
    if (!store.renderChallenges || !store.issueRenderChallenge || !store.commitAttestation) {
      throw new Error('Step 64 persistence primitives are unavailable.');
    }
    return store;
  }

  async requestOtp(request: Request): Promise<Response> {
    const rejected = this.#postBoundary(request);
    if (rejected) return rejected;

    let address: string;
    try {
      const body = record(await readJsonBody(request, 2_048), ['email']);
      address = email(body.email);
    } catch {
      return errorResponse(400, 'INVALID_INPUT', 'Enter a valid email address.');
    }

    // Deliberately identical for registered, unregistered, rate-limited, and
    // provider-rejected addresses. This endpoint is not an account oracle.
    try {
      await this.#dependencies.authForRequest().requestEmailOtp(address);
    } catch {
      // The generic accepted response is intentional; no address is logged.
    }
    return jsonResponse({ ok: true }, 202);
  }

  async verifyOtp(request: Request): Promise<Response> {
    const rejected = this.#postBoundary(request);
    if (rejected) return rejected;

    let address: string;
    let token: string;
    try {
      const body = record(await readJsonBody(request, 4_096), ['email', 'otp']);
      address = email(body.email);
      token = otp(body.otp);
    } catch {
      return errorResponse(400, 'INVALID_INPUT', 'Email and six-digit code are required.');
    }

    let authSubject: string | null;
    try {
      authSubject = await this.#dependencies.authForRequest().verifyEmailOtp(address, token);
    } catch {
      authSubject = null;
    }
    if (authSubject === null) {
      return errorResponse(401, 'INVALID_OTP', 'The email or verification code is invalid.');
    }

    try {
      const issued = await issueWebSession(
        this.#dependencies.persistence,
        authSubject,
        this.#now(),
        this.#dependencies.sessionTokenFactory,
      );
      return jsonResponse({ ok: true }, 200, {
        'Set-Cookie': sessionCookie(
          issued.rawToken,
          issued.record.expires_at,
          this.#dependencies.config.cookie,
        ),
      });
    } catch {
      return errorResponse(500, 'SESSION_UNAVAILABLE', 'A JuryAI session could not be created.');
    }
  }

  async logout(request: Request): Promise<Response> {
    const rejected = this.#postBoundary(request);
    if (rejected) return rejected;

    const rawToken = readSessionCookie(
      request.headers.get('Cookie'),
      this.#dependencies.config.cookie.name,
    );
    if (rawToken !== null) {
      try {
        await this.#dependencies.persistence.revokeSession(hashSessionToken(rawToken), this.#now());
      } catch {
        return errorResponse(
          500,
          'SESSION_UNAVAILABLE',
          'The JuryAI session could not be revoked.',
        );
      }
    }
    return jsonResponse({ ok: true }, 200, {
      'Set-Cookie': expiredSessionCookie(this.#dependencies.config.cookie),
    });
  }

  async bootstrap(request: Request): Promise<Response> {
    const rejected = requireMethod(request, 'GET');
    if (rejected) return rejected;

    let session: WebSessionRecord | null;
    try {
      session = await this.#session(request);
    } catch {
      return errorResponse(500, 'SESSION_UNAVAILABLE', 'The JuryAI session could not be checked.');
    }
    if (session === null) return jsonResponse({ authenticated: false });

    let accepted: boolean;
    try {
      accepted = await this.#dependencies.persistence.hasDisclosureAcceptance(
        session.principal_id,
        JURYAI_P2_DISCLOSURE_VERSION,
      );
    } catch {
      return errorResponse(500, 'SESSION_UNAVAILABLE', 'Disclosure status could not be checked.');
    }
    return jsonResponse({
      authenticated: true,
      disclosure: accepted
        ? { required: false, version: JURYAI_P2_DISCLOSURE_VERSION }
        : {
            required: true,
            version: JURYAI_P2_DISCLOSURE_VERSION,
            copy: JURYAI_P2_DISCLOSURE_COPY,
          },
    });
  }

  async acceptDisclosure(request: Request): Promise<Response> {
    const rejected = this.#postBoundary(request);
    if (rejected) return rejected;

    try {
      const body = record(await readJsonBody(request, 1_024), []);
      if (Object.keys(body).length !== 0) throw new TypeError('Disclosure body must be empty.');
    } catch {
      return errorResponse(400, 'INVALID_INPUT', 'Disclosure acceptance takes no arguments.');
    }

    let session: WebSessionRecord | null;
    try {
      session = await this.#session(request);
    } catch {
      return errorResponse(500, 'SESSION_UNAVAILABLE', 'The JuryAI session could not be checked.');
    }
    if (session === null) return errorResponse(401, 'AUTH_REQUIRED', 'Authentication is required.');

    try {
      await this.#dependencies.persistence.acceptDisclosure(
        session.principal_id,
        JURYAI_P2_DISCLOSURE_VERSION,
        this.#now(),
      );
      return jsonResponse({ ok: true });
    } catch {
      return errorResponse(
        500,
        'DISCLOSURE_UNAVAILABLE',
        'Disclosure acceptance could not be recorded.',
      );
    }
  }

  async reviewCase(request: Request, caseId: string): Promise<Response> {
    const rejected = requireMethod(request, 'GET');
    if (rejected) return rejected;
    if (!isCanonicalId(caseId)) return errorResponse(404, 'CASE_NOT_FOUND', 'No such case.');
    const authorized = await this.#authorizedSession(request);
    if (authorized instanceof Response) return authorized;

    try {
      const store = await this.#caseStore();
      const stored = await store.cases.findById(caseId);
      if (!stored || stored.state.principal_id !== authorized.principal_id) {
        return errorResponse(404, 'CASE_NOT_FOUND', 'No such case.');
      }
      const render = renderCanonicalAccountV1(stored.state);
      const completeness = verifyRenderCompletenessV1(stored.state, render.document);
      const structural = validateCaseState(stored.state);
      const readiness = deriveReadiness(
        stored.state.requirements,
        stored.state.propositions,
        stored.state.clarifications,
      );
      const status = deriveCaseStatus(stored.state);
      const blockingReasons: string[] = [];
      if (status === 'locked') blockingReasons.push('already_locked');
      if (!completeness.ok) blockingReasons.push('readback_incomplete');
      if (!structural.ok) blockingReasons.push('structurally_invalid');
      if (readiness.unresolved_requirement_ids.length > 0) {
        blockingReasons.push('unresolved_requirements');
      }
      if (readiness.open_clarification_ids.length > 0) {
        blockingReasons.push('open_clarifications');
      }
      const adoptionStatement = adoptionStatementForV1(stored.state);
      const adoptionStatementHash = sha256(adoptionStatement);
      const attestable = blockingReasons.length === 0;
      let rawChallenge: string | null = null;
      if (attestable) {
        rawChallenge = (
          this.#dependencies.challengeTokenFactory ?? (() => randomBytes(32).toString('base64url'))
        )();
        if (!/^[A-Za-z0-9_-]{43}$/u.test(rawChallenge)) {
          throw new TypeError('Challenge factory did not return 32 base64url bytes.');
        }
        const nowMs = this.#now().getTime();
        const challenge = issueRenderChallenge(stored.state, render, rawChallenge, nowMs);
        if (challenge.adoption_statement_hash !== adoptionStatementHash) {
          throw new Error('Adoption statement binding disagrees with the canonical render.');
        }
        await store.issueRenderChallenge!({
          challenge_hash: sha256(rawChallenge),
          principal_id: authorized.principal_id,
          case_id: caseId,
          case_version: challenge.case_version,
          rendered_document_hash: challenge.rendered_document_hash,
          render_template_version: challenge.render_template_version,
          attestation_contract_version: challenge.attestation_contract_version,
          adoption_statement_hash: challenge.adoption_statement_hash,
          issued_at_ms: challenge.issued_at_ms,
          expires_at_ms: challenge.expires_at_ms,
          consumed_at_ms: null,
          attestation_id: null,
        });
      }
      return jsonResponse({
        case_id: caseId,
        case_version: stored.state.case_version,
        status,
        render_template_version: render.render_template_version,
        document: render.document,
        document_hash: render.document_hash,
        attestation_contract_version: ATTESTATION_CONTRACT_VERSION,
        adoption_statement: adoptionStatement,
        adoption_statement_hash: adoptionStatementHash,
        attestable,
        blocking_reasons: blockingReasons,
        challenge: rawChallenge,
      });
    } catch {
      return errorResponse(
        500,
        'REVIEW_UNAVAILABLE',
        'The case review is temporarily unavailable.',
      );
    }
  }

  async correctCase(request: Request, caseId: string): Promise<Response> {
    const rejected = this.#postBoundary(request);
    if (rejected) return rejected;
    if (!isCanonicalId(caseId)) return errorResponse(404, 'CASE_NOT_FOUND', 'No such case.');
    const authorized = await this.#authorizedSession(request);
    if (authorized instanceof Response) return authorized;
    let input: CorrectionInput;
    try {
      input = correctionInput(await readJsonBody(request));
    } catch {
      return errorResponse(400, 'INVALID_INPUT', 'The first-party correction is invalid.');
    }

    try {
      const store = await this.#caseStore();
      const stored = await store.cases.findById(caseId);
      if (!stored || stored.state.principal_id !== authorized.principal_id) {
        return errorResponse(404, 'CASE_NOT_FOUND', 'No such case.');
      }
      if (
        input.target_proposition_id !== null &&
        stored.state.case_version === input.expected_case_version &&
        deriveCaseStatus(stored.state) !== 'locked'
      ) {
        const target = stored.state.propositions.find(
          (proposition) => proposition.proposition_id === input.target_proposition_id,
        );
        if (
          !target ||
          target.superseded_by !== null ||
          input.in_reply_to.length !== 1 ||
          input.in_reply_to[0] !== target.in_reply_to
        ) {
          return errorResponse(
            400,
            'INVALID_INPUT',
            'The first-party correction target is invalid.',
          );
        }
      }
      const answer = textualizeCorrection(input);
      const runtime = await this.#dependencies.runtime();
      const service = createRuntimeCaseService({
        runtime,
        contextProvider: firstPartyRuntimeContextProvider(authorized),
      });
      const result = await service.submitTurn(
        {
          case_id: caseId,
          expected_case_version: input.expected_case_version,
          in_reply_to: input.in_reply_to,
          payload: { context: [], answer: { role: 'user', text: answer } },
          client_turn_id: input.client_turn_id,
          translation_indicated: false,
        },
        { signal: request.signal },
      );
      if (result.ok) return jsonResponse(result);
      const code = result.error.code;
      const status =
        code === 'CASE_NOT_FOUND'
          ? 404
          : code === 'VERSION_CONFLICT' || code === 'CASE_LOCKED'
            ? 409
            : code === 'INVALID_INPUT'
              ? 400
              : 500;
      return jsonResponse(result, status);
    } catch {
      return errorResponse(
        500,
        'INTERNAL_ERROR',
        'The correction service is temporarily unavailable.',
      );
    }
  }

  async attestCase(request: Request, caseId: string): Promise<Response> {
    const rejected = this.#postBoundary(request);
    if (rejected) return rejected;
    if (!isCanonicalId(caseId)) return errorResponse(404, 'CASE_NOT_FOUND', 'No such case.');
    const authorized = await this.#authorizedSession(request);
    if (authorized instanceof Response) return authorized;
    let input: { challenge: string; rendered_document_hash: string };
    try {
      input = attestationInput(await readJsonBody(request, 2_048));
    } catch {
      return errorResponse(400, 'INVALID_INPUT', 'The attestation request is invalid.');
    }

    try {
      const store = await this.#caseStore();
      const challengeHash = createHash('sha256').update(input.challenge, 'utf8').digest('hex');
      const persisted = await store.renderChallenges!.findByHash(challengeHash);
      const stored = await store.cases.findById(caseId);
      if (
        !persisted ||
        !stored ||
        persisted.case_id !== caseId ||
        persisted.principal_id !== authorized.principal_id ||
        stored.state.principal_id !== authorized.principal_id
      ) {
        return errorResponse(404, 'CASE_NOT_FOUND', 'No such case or review challenge.');
      }
      if (persisted.rendered_document_hash !== input.rendered_document_hash) {
        return errorResponse(409, 'STALE_REVIEW', 'The reviewed account no longer matches.');
      }
      if (persisted.consumed_at_ms !== null) {
        const original = stored.state.attestations.find(
          (entry) => entry.attestation_id === persisted.attestation_id,
        );
        if (
          original &&
          original.challenge === input.challenge &&
          original.principal_id === authorized.principal_id &&
          original.rendered_document_hash === persisted.rendered_document_hash &&
          original.attestation_contract_version === persisted.attestation_contract_version &&
          original.adoption_statement_hash === persisted.adoption_statement_hash
        ) {
          return jsonResponse({
            ok: true,
            replayed: true,
            attestation_id: original.attestation_id,
            case_id: caseId,
            case_version: original.case_version,
            status: 'locked',
            rendered_document_hash: original.rendered_document_hash,
          });
        }
        return errorResponse(409, 'CASE_LOCKED', 'This case is already locked.');
      }
      const nowMs = this.#now().getTime();
      if (nowMs > persisted.expires_at_ms) {
        return errorResponse(
          409,
          'REVIEW_EXPIRED',
          'This review challenge expired. Reload the complete review.',
        );
      }
      const challenge: RenderChallenge = {
        challenge: input.challenge,
        case_id: persisted.case_id,
        case_version: persisted.case_version,
        rendered_document_hash: persisted.rendered_document_hash,
        render_template_version: persisted.render_template_version,
        attestation_contract_version: persisted.attestation_contract_version,
        adoption_statement_hash: persisted.adoption_statement_hash,
        issued_at_ms: persisted.issued_at_ms,
        expires_at_ms: persisted.expires_at_ms,
      };
      const attestationId = this.#dependencies.attestationIdFactory?.() ?? `att_${randomUUID()}`;
      if (!isCanonicalId(attestationId)) throw new TypeError('Attestation id is invalid.');
      const attempt: AttestationAttempt = {
        attestation_id: attestationId,
        case_id: caseId,
        principal_id: authorized.principal_id,
        challenge: input.challenge,
        rendered_document_hash: input.rendered_document_hash,
        verification_method: 'first_party_ui_click',
        authenticator_ref: null,
        signature: null,
        signature_alg: null,
        created_at: new Date(nowMs).toISOString(),
        client_ip: request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim() || null,
        user_agent: request.headers.get('User-Agent')?.slice(0, 1_000) ?? null,
      };
      const verification = verifyAttestationAttempt(
        stored.state,
        challenge,
        attempt,
        nowMs,
        validateCaseState,
      );
      if (verification.kind === 'rejected') {
        const code = verification.reason === 'already_locked' ? 'CASE_LOCKED' : 'STALE_REVIEW';
        return errorResponse(409, code, 'The complete current account must be reviewed again.');
      }
      const nextState = {
        ...stored.state,
        attestations: appendAttestation(stored.state.attestations, verification.record),
      };
      const report = validateCaseState(nextState);
      if (!report.ok) {
        return errorResponse(409, 'ATTESTATION_BLOCKED', 'This case cannot be attested yet.');
      }
      const committed = await store.commitAttestation!({
        challenge_hash: challengeHash,
        principal_id: authorized.principal_id,
        case_id: caseId,
        expected_revision: stored.revision,
        next_state: nextState,
        attestation_id: attestationId,
        consumed_at_ms: nowMs,
      });
      if (!committed.ok) {
        return errorResponse(
          409,
          committed.reason === 'revision_conflict' ? 'STALE_REVIEW' : 'CASE_LOCKED',
          'The complete current account must be reviewed again.',
        );
      }
      const committedAttestationId = committed.challenge.attestation_id;
      if (committedAttestationId === null)
        throw new Error('Consumed challenge lacks attestation id.');
      const record = committed.stored.state.attestations.find(
        (entry) => entry.attestation_id === committedAttestationId,
      );
      if (!record) throw new Error('Committed attestation cannot be read back.');
      return jsonResponse({
        ok: true,
        replayed: committed.replayed,
        attestation_id: record.attestation_id,
        case_id: caseId,
        case_version: record.case_version,
        status: 'locked',
        rendered_document_hash: record.rendered_document_hash,
      });
    } catch {
      return errorResponse(
        500,
        'INTERNAL_ERROR',
        'The attestation service is temporarily unavailable.',
      );
    }
  }

  async caseService(request: Request): Promise<Response> {
    const rejected = this.#postBoundary(request);
    if (rejected) return rejected;

    let session: WebSessionRecord | null;
    try {
      session = await this.#session(request);
    } catch {
      return errorResponse(500, 'SESSION_UNAVAILABLE', 'The JuryAI session could not be checked.');
    }
    if (session === null) return errorResponse(401, 'AUTH_REQUIRED', 'Authentication is required.');

    try {
      const accepted = await this.#dependencies.persistence.hasDisclosureAcceptance(
        session.principal_id,
        JURYAI_P2_DISCLOSURE_VERSION,
      );
      if (!accepted) {
        return errorResponse(403, 'DISCLOSURE_REQUIRED', 'Disclosure acceptance is required.');
      }
    } catch {
      return errorResponse(500, 'SESSION_UNAVAILABLE', 'Disclosure status could not be checked.');
    }

    let envelope: CaseServiceHttpRequest;
    try {
      envelope = decodeCaseServiceHttpRequest(await readJsonBody(request));
    } catch {
      return errorResponse(400, 'INVALID_INPUT', 'The case-service request is invalid.');
    }

    try {
      const runtime = await this.#dependencies.runtime();
      const service = createRuntimeCaseService({
        runtime,
        contextProvider: sessionRuntimeContextProvider(session),
      });
      switch (envelope.operation) {
        case 'startCase': {
          const result = await service.startCase(envelope.input, { signal: request.signal });
          return jsonResponse(decodeCaseServiceResult('startCase', result));
        }
        case 'getCaseState': {
          const result = await service.getCaseState(envelope.input, { signal: request.signal });
          return jsonResponse(decodeCaseServiceResult('getCaseState', result));
        }
        case 'submitTurn': {
          const result = await service.submitTurn(envelope.input, { signal: request.signal });
          return jsonResponse(decodeCaseServiceResult('submitTurn', result));
        }
      }
    } catch {
      return errorResponse(500, 'INTERNAL_ERROR', 'The case service is temporarily unavailable.');
    }
  }
}
