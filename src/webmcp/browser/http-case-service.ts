import {
  decodeCaseServiceResult,
  type CaseServiceOperation,
  type CaseServicePort,
  type CaseStateResponse,
  type GetCaseStateQuery,
  type GetCaseStateResult,
  type ServiceCallOptions,
  type StartCaseCommand,
  type StartCaseResult,
  type SubmitTurnCommand,
  type SubmitTurnResult,
} from '../public-contract.js';

export interface HttpCaseServiceOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  expectedOrigin?: string;
  onUnauthorized?: () => void;
  lifetimeSignal?: AbortSignal;
}

export class HttpCaseServiceError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(status === 401 ? 'JuryAI session is no longer authenticated.' : 'JuryAI request failed.');
    this.name = 'HttpCaseServiceError';
    this.status = status;
  }
}

function assertSameOriginReviewUrl(state: CaseStateResponse, expectedOrigin: string): void {
  let review: URL;
  try {
    review = new URL(state.review_url, expectedOrigin);
  } catch {
    throw new TypeError('JuryAI returned an invalid review URL.');
  }
  if (review.origin !== expectedOrigin) {
    throw new TypeError('JuryAI returned a foreign-origin review URL.');
  }
}

function validateReviewUrl(result: unknown, expectedOrigin: string): void {
  if (typeof result !== 'object' || result === null || !('case' in result)) return;
  assertSameOriginReviewUrl((result as { case: CaseStateResponse }).case, expectedOrigin);
}

export function createHttpCaseService(options: HttpCaseServiceOptions = {}): CaseServicePort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? '/api/juryai/case-service';
  const expectedOrigin = options.expectedOrigin ?? globalThis.location.origin;

  const requestSignal = (callSignal?: AbortSignal): AbortSignal | undefined => {
    if (callSignal === undefined) return options.lifetimeSignal;
    if (options.lifetimeSignal === undefined || options.lifetimeSignal === callSignal) {
      return callSignal;
    }
    return AbortSignal.any([options.lifetimeSignal, callSignal]);
  };

  async function call(
    operation: 'startCase',
    input: StartCaseCommand,
    callOptions?: ServiceCallOptions,
  ): Promise<StartCaseResult>;
  async function call(
    operation: 'getCaseState',
    input: GetCaseStateQuery,
    callOptions?: ServiceCallOptions,
  ): Promise<GetCaseStateResult>;
  async function call(
    operation: 'submitTurn',
    input: SubmitTurnCommand,
    callOptions?: ServiceCallOptions,
  ): Promise<SubmitTurnResult>;
  async function call(
    operation: CaseServiceOperation,
    input: StartCaseCommand | GetCaseStateQuery | SubmitTurnCommand,
    callOptions?: ServiceCallOptions,
  ): Promise<StartCaseResult | GetCaseStateResult | SubmitTurnResult> {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, input }),
      signal: requestSignal(callOptions?.signal),
    });
    if (!response.ok) {
      if (response.status === 401) options.onUnauthorized?.();
      throw new HttpCaseServiceError(response.status);
    }

    const body = (await response.json()) as unknown;
    let decoded: StartCaseResult | GetCaseStateResult | SubmitTurnResult;
    switch (operation) {
      case 'startCase':
        decoded = decodeCaseServiceResult('startCase', body);
        break;
      case 'getCaseState':
        decoded = decodeCaseServiceResult('getCaseState', body);
        break;
      case 'submitTurn':
        decoded = decodeCaseServiceResult('submitTurn', body);
        break;
    }
    validateReviewUrl(decoded, expectedOrigin);
    return decoded;
  }

  return {
    startCase: (command, callOptions) => call('startCase', command, callOptions),
    getCaseState: (query, callOptions) => call('getCaseState', query, callOptions),
    submitTurn: (command, callOptions) => call('submitTurn', command, callOptions),
  };
}
