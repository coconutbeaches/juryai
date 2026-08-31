import type { CaseRuntime } from '../runtime/index.js';
import { createRuntimeCaseService } from '../service/index.js';
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
  now?: () => Date;
  sessionTokenFactory?: SessionTokenFactory;
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
