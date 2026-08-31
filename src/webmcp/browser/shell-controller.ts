import type { CaseServicePort } from '../public-contract.js';
import {
  registerJuryAiWebMcpTools,
  type JuryAiToolRegistration,
  type ModelContextLike,
} from '../tools/register.js';
import { createHttpCaseService, HttpCaseServiceError } from './http-case-service.js';

export type BrowserShellState =
  | { phase: 'loading' }
  | { phase: 'signed_out'; message?: string }
  | { phase: 'otp_requested'; message: string }
  | { phase: 'disclosure'; copy: string }
  | {
      phase: 'ready';
      webMcp: 'available' | 'unavailable' | 'registration_failed';
      activeDraftReviewUrl: string | null;
      message?: string;
    }
  | { phase: 'error'; message: string };

export interface BrowserShellView {
  render(state: BrowserShellState): void;
}

export interface BrowserShellControllerOptions {
  view: BrowserShellView;
  fetchImpl?: typeof fetch;
  expectedOrigin?: string;
  getModelContext: () => ModelContextLike | undefined;
  registerTools?: typeof registerJuryAiWebMcpTools;
  createCaseService?: (options: {
    signal: AbortSignal;
    onUnauthorized: () => void;
  }) => CaseServicePort;
}

interface BootstrapSignedOut {
  authenticated: false;
}

interface BootstrapAuthenticated {
  authenticated: true;
  disclosure:
    { required: false; version: string } | { required: true; version: string; copy: string };
}

type BootstrapResponse = BootstrapSignedOut | BootstrapAuthenticated;

class BrowserApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('JuryAI browser request failed.');
    this.status = status;
  }
}

function exactObject(
  value: unknown,
  label: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !allowed.includes(key))) {
    throw new TypeError(`${label} contains an unknown field`);
  }
  return object;
}

function nonEmptyString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} must be a bounded string`);
  }
  return value;
}

export function decodeBootstrapResponse(value: unknown): BootstrapResponse {
  const response = exactObject(value, 'bootstrap', ['authenticated', 'disclosure']);
  if (response.authenticated === false) {
    if (Object.prototype.hasOwnProperty.call(response, 'disclosure')) {
      throw new TypeError('Signed-out bootstrap must not expose disclosure state');
    }
    return { authenticated: false };
  }
  if (response.authenticated !== true) throw new TypeError('bootstrap authentication is invalid');
  const disclosure = exactObject(response.disclosure, 'disclosure', [
    'required',
    'version',
    'copy',
  ]);
  const version = nonEmptyString(disclosure.version, 'disclosure.version', 200);
  if (disclosure.required === false) {
    if (Object.prototype.hasOwnProperty.call(disclosure, 'copy')) {
      throw new TypeError('Accepted disclosure bootstrap must not include copy');
    }
    return { authenticated: true, disclosure: { required: false, version } };
  }
  if (disclosure.required !== true) throw new TypeError('disclosure.required is invalid');
  return {
    authenticated: true,
    disclosure: {
      required: true,
      version,
      copy: nonEmptyString(disclosure.copy, 'disclosure.copy', 8_000),
    },
  };
}

export class BrowserShellController {
  readonly #options: BrowserShellControllerOptions;
  readonly #fetch: typeof fetch;
  readonly #registerTools: typeof registerJuryAiWebMcpTools;
  #pageController: AbortController | null = null;
  #registration: JuryAiToolRegistration | null = null;
  readonly #actionControllers = new Set<AbortController>();
  #generation = 0;

  constructor(options: BrowserShellControllerOptions) {
    this.#options = options;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#registerTools = options.registerTools ?? registerJuryAiWebMcpTools;
  }

  async #json(request: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
    const response = await this.#fetch(request, {
      ...init,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
    if (!response.ok) throw new BrowserApiError(response.status);
    return response.json() as Promise<unknown>;
  }

  async #post(path: string, body: unknown): Promise<void> {
    const controller = new AbortController();
    this.#actionControllers.add(controller);
    try {
      await this.#json(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      this.#actionControllers.delete(controller);
    }
  }

  #isCurrent(generation: number): boolean {
    return generation === this.#generation && this.#pageController?.signal.aborted === false;
  }

  #invalidate(generation: number): void {
    if (!this.#isCurrent(generation)) return;
    this.teardown();
    this.#options.view.render({
      phase: 'signed_out',
      message: 'Your JuryAI session ended. Sign in again to continue.',
    });
  }

  async initialize(): Promise<void> {
    this.teardown();
    const controller = new AbortController();
    this.#pageController = controller;
    const generation = this.#generation;
    this.#options.view.render({ phase: 'loading' });

    try {
      const bootstrap = decodeBootstrapResponse(
        await this.#json('/api/juryai/bootstrap', { signal: controller.signal }),
      );
      if (!this.#isCurrent(generation)) return;
      if (!bootstrap.authenticated) {
        this.#options.view.render({ phase: 'signed_out' });
        return;
      }
      if (bootstrap.disclosure.required) {
        this.#options.view.render({ phase: 'disclosure', copy: bootstrap.disclosure.copy });
        return;
      }

      const service =
        this.#options.createCaseService?.({
          signal: controller.signal,
          onUnauthorized: () => this.#invalidate(generation),
        }) ??
        createHttpCaseService({
          fetchImpl: this.#fetch,
          expectedOrigin: this.#options.expectedOrigin,
          lifetimeSignal: controller.signal,
          onUnauthorized: () => this.#invalidate(generation),
        });

      let activeDraftReviewUrl: string | null = null;
      let message: string | undefined;
      const active = await service.getCaseState({}, { signal: controller.signal });
      if (!this.#isCurrent(generation)) return;
      if (active.ok) activeDraftReviewUrl = active.case.review_url;
      else if (active.error.code !== 'CASE_NOT_FOUND')
        message = 'Current draft status is unavailable.';

      const modelContext = this.#options.getModelContext();
      if (modelContext === undefined) {
        this.#options.view.render({
          phase: 'ready',
          webMcp: 'unavailable',
          activeDraftReviewUrl,
          message,
        });
        return;
      }

      try {
        const registration = await this.#registerTools(modelContext, service, {
          signal: controller.signal,
        });
        if (!this.#isCurrent(generation)) {
          registration.unregister();
          return;
        }
        this.#registration = registration;
        this.#options.view.render({
          phase: 'ready',
          webMcp: 'available',
          activeDraftReviewUrl,
          message,
        });
      } catch (error) {
        if (!this.#isCurrent(generation)) return;
        this.#options.view.render({
          phase: 'ready',
          webMcp: 'registration_failed',
          activeDraftReviewUrl,
          message: error instanceof Error ? 'AI integration could not be registered.' : message,
        });
      }
    } catch (error) {
      if (!this.#isCurrent(generation)) return;
      if (
        (error instanceof BrowserApiError || error instanceof HttpCaseServiceError) &&
        error.status === 401
      ) {
        this.#invalidate(generation);
        return;
      }
      this.#options.view.render({
        phase: 'error',
        message: 'JuryAI could not initialize. Please try again.',
      });
    }
  }

  async requestOtp(email: string): Promise<void> {
    try {
      await this.#post('/api/juryai/auth/request-otp', { email });
      this.#options.view.render({
        phase: 'otp_requested',
        message: 'If this invited address can sign in, a six-digit code has been sent.',
      });
    } catch {
      this.#options.view.render({ phase: 'signed_out', message: 'The code request failed.' });
    }
  }

  async verifyOtp(email: string, otp: string): Promise<void> {
    try {
      await this.#post('/api/juryai/auth/verify-otp', { email, otp });
      await this.initialize();
    } catch (error) {
      this.#options.view.render({
        phase: 'signed_out',
        message:
          error instanceof BrowserApiError && error.status === 401
            ? 'The email or verification code is invalid.'
            : 'The verification request failed.',
      });
    }
  }

  async acceptDisclosure(): Promise<void> {
    try {
      await this.#post('/api/juryai/disclosure', {});
      await this.initialize();
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 401) {
        this.teardown();
        this.#options.view.render({ phase: 'signed_out', message: 'Sign in again to continue.' });
        return;
      }
      this.#options.view.render({ phase: 'error', message: 'Disclosure acceptance failed.' });
    }
  }

  async logout(): Promise<void> {
    this.teardown();
    try {
      await this.#post('/api/juryai/auth/logout', {});
      await this.initialize();
    } catch {
      await this.initialize();
    }
  }

  teardown(): void {
    this.#generation += 1;
    this.#registration?.unregister();
    this.#registration = null;
    this.#pageController?.abort();
    this.#pageController = null;
    for (const controller of this.#actionControllers) controller.abort();
    this.#actionControllers.clear();
  }

  async pageShow(persisted: boolean): Promise<void> {
    if (persisted) await this.initialize();
  }
}
