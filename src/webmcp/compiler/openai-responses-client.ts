/**
 * OpenAI Responses transport for the semantic compiler.
 *
 * Chosen because the repository already speaks this API natively over `fetch`
 * with strict `json_schema` structured output (`src/extraction/openai-responses.ts`),
 * so this adds no new dependency, no SDK and no second provider convention.
 * That module is not reused directly: it is welded to the Person A prompt and
 * schema and cannot carry an `AbortSignal`, both of which are requirements
 * here. What IS reused is its endpoint-identity discipline.
 *
 * This file contains no JuryAI semantics. It sends the request it is handed,
 * forwards the caller's signal into the actual network call, and returns the
 * provider's structured-output text.
 */

import { createHash } from 'node:crypto';
import {
  SemanticModelError,
  SemanticModelRefusalError,
  type SemanticModelCallOptions,
  type SemanticModelClient,
  type SemanticModelErrorDiagnostics,
  type SemanticModelRequest,
  type SemanticModelResponse,
} from './model-client.js';

export const OPENAI_RESPONSES_PROVIDER_ID = 'openai.responses';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAiResponsesClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injected so tests drive the transport without a network. */
  fetchImpl?: typeof fetch;
}

/**
 * Endpoint identity, mirroring the existing extraction client's rules: HTTPS
 * only, no credentials, no query, no fragment. A proxy or a self-hosted
 * gateway is a different execution artefact and must be visible as one.
 */
export function openAiResponsesEndpoint(baseUrl = DEFAULT_OPENAI_BASE_URL): string {
  if (/[?#]/u.test(baseUrl)) {
    throw new TypeError('OPENAI_BASE_URL must not contain a query or fragment delimiter.');
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new TypeError('OPENAI_BASE_URL must be a valid absolute URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new TypeError('OPENAI_BASE_URL must use HTTPS.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError('OPENAI_BASE_URL must not contain credentials, a query, or a fragment.');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '') + '/responses';
  return parsed.toString();
}

function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * Model identity and usage as the provider reported them, from any payload that
 * parsed — successful or not. Read BEFORE any failure is raised, so a refused
 * or truncated completion can still report what it cost.
 */
export function responseDiagnostics(payload: unknown): SemanticModelErrorDiagnostics | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const object = payload as Record<string, unknown>;
  const usage =
    typeof object.usage === 'object' && object.usage !== null
      ? (object.usage as Record<string, unknown>)
      : null;
  return {
    reported_model: typeof object.model === 'string' ? object.model : null,
    usage: usage
      ? {
          input_tokens: integerOrNull(usage.input_tokens),
          output_tokens: integerOrNull(usage.output_tokens),
        }
      : null,
  };
}

/**
 * Reads the structured-output text out of a Responses payload. A refusal is
 * surfaced as its own error rather than as absent text, because "the model
 * declined" and "the model returned nothing" are different facts — and it
 * carries the payload's usage, because a refusal was still billed.
 */
export function readResponsesOutputText(
  payload: unknown,
  diagnostics: SemanticModelErrorDiagnostics | null = null,
): string | null {
  if (typeof payload !== 'object' || payload === null) {
    throw new SemanticModelError('Provider response was not a JSON object.');
  }
  const object = payload as Record<string, unknown>;

  const output = Array.isArray(object.output) ? object.output : [];
  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue;
    const message = item as Record<string, unknown>;
    if (message.type !== 'message') continue;
    const content = Array.isArray(message.content) ? message.content : [];
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue;
      const entry = part as Record<string, unknown>;
      if (entry.type === 'refusal') {
        // Provider refusal text is untrusted and may echo the submitted legal
        // case. It must not enter an exception message because runtime and eval
        // diagnostics legitimately record those messages.
        throw new SemanticModelRefusalError('Model refused the compile request.', diagnostics);
      }
    }
  }

  if (typeof object.output_text === 'string' && object.output_text.length > 0) {
    return object.output_text;
  }
  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue;
    const message = item as Record<string, unknown>;
    if (message.type !== 'message') continue;
    const content = Array.isArray(message.content) ? message.content : [];
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue;
      const entry = part as Record<string, unknown>;
      if (entry.type === 'output_text' && typeof entry.text === 'string') {
        return entry.text;
      }
    }
  }
  return null;
}

export class OpenAiResponsesSemanticModelClient implements SemanticModelClient {
  readonly provider_id = OPENAI_RESPONSES_PROVIDER_ID;
  readonly endpoint_sha256: string;
  readonly #endpoint: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAiResponsesClientOptions) {
    if (!options.apiKey) {
      throw new TypeError('An API key is required for the live semantic compiler transport.');
    }
    this.#apiKey = options.apiKey;
    this.#endpoint = openAiResponsesEndpoint(options.baseUrl);
    this.endpoint_sha256 = createHash('sha256').update(this.#endpoint, 'utf8').digest('hex');
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async generate(
    request: SemanticModelRequest,
    options: SemanticModelCallOptions = {},
  ): Promise<SemanticModelResponse> {
    // Checked before the request is built so an already-cancelled call never
    // bills a provider round trip.
    options.signal?.throwIfAborted();

    const body: Record<string, unknown> = {
      model: request.model,
      instructions: request.system,
      input: request.input,
      // Zero data retention on the provider side: the compile run is JuryAI's
      // audit record, and legal-case material must not accumulate elsewhere.
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: request.response_format.name,
          strict: request.response_format.strict,
          schema: request.response_format.schema,
        },
      },
    };
    if (!request.omit_sampling_params) {
      body.temperature = request.decoding.temperature;
      if (request.decoding.top_p !== null) body.top_p = request.decoding.top_p;
    }
    if (request.decoding.max_output_tokens !== null) {
      body.max_output_tokens = request.decoding.max_output_tokens;
    }
    // `seed` is deliberately not sent: the Responses endpoint has no such
    // parameter. It stays in compiler identity as DECLARED decoding intent.

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        redirect: 'manual',
        // The caller's signal reaches the socket, not just this function.
        signal: options.signal,
        headers: {
          Authorization: 'Bearer ' + this.#apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // A caller abort is re-thrown as itself. Flattening it into a provider
      // error would let a retry loop above treat cancellation as a hiccup.
      if (isAbortError(error, options.signal)) throw error;
      throw new SemanticModelError(
        'Provider request failed: ' + (error instanceof Error ? error.message : 'unknown error'),
        { transient: true },
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (isAbortError(error, options.signal)) throw error;
      throw new SemanticModelError(
        'Provider response body could not be read: ' +
          (error instanceof Error ? error.message : 'unknown error'),
        { transient: true },
      );
    }

    // The body is parsed BEFORE any failure is raised, so every error path can
    // carry whatever usage the provider reported. A refused or truncated
    // completion was still billed, and an error that drops its usage makes the
    // run look cheaper than it was.
    let payload: unknown = null;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
    const diagnostics = responseDiagnostics(payload);

    if (!response.ok) {
      // 408/409/429 and 5xx are the transport-level transient set. Everything
      // else — 400 schema rejection, 401, 403, 404 — is a configuration fault
      // that another identical request cannot fix.
      const transient =
        response.status === 408 ||
        response.status === 409 ||
        response.status === 429 ||
        response.status >= 500;
      throw new SemanticModelError('Provider returned HTTP ' + String(response.status) + '.', {
        transient,
        status: response.status,
        diagnostics,
      });
    }

    if (payload === null) {
      throw new SemanticModelError('Provider response body was not valid JSON.');
    }

    const object = payload as Record<string, unknown>;
    if (object.status === 'incomplete') {
      // Truncated structured output is not a shorter valid answer; it is not
      // an answer. The provider-controlled detail is deliberately omitted from
      // the logged exception for the same reason refusal text is omitted.
      throw new SemanticModelError('Provider response was incomplete.', {
        diagnostics,
      });
    }
    if (object.status !== 'completed') {
      // A gateway can return stale or partial output_text alongside a failed
      // status. Provider success must be positive before any text is trusted.
      throw new SemanticModelError('Provider response was not completed.', { diagnostics });
    }

    return {
      text: readResponsesOutputText(payload, diagnostics),
      reported_model: diagnostics?.reported_model ?? null,
      usage: diagnostics?.usage ?? null,
    };
  }
}

function isAbortError(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === 'AbortError';
}
