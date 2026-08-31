/**
 * Offline `SemanticModelClient` implementations.
 *
 * These exist so the compiler's own semantics — prompt assembly, input
 * rendering, parsing, grounding, cancellation, retry policy — can be exercised
 * exactly, in CI, with no API key, no network and no paid call. They sit at
 * the PROVIDER seam, which means everything above them is the real compiler:
 * an offline run exercises the production code path and differs only in where
 * the bytes came from.
 *
 * What that does NOT establish is model quality. A replayed completion is a
 * fixture; it proves the pipeline handles that completion correctly and says
 * nothing about what a live model would have produced.
 */

import {
  SemanticModelError,
  type SemanticModelCallOptions,
  type SemanticModelClient,
  type SemanticModelRequest,
  type SemanticModelResponse,
} from './model-client.js';

export type ScriptedModelReply =
  | { kind: 'text'; text: string; reported_model?: string | null }
  /** Provider produced no textual completion at all. */
  | { kind: 'empty' }
  | { kind: 'error'; error: Error };

export type ScriptedModelScript = (
  request: SemanticModelRequest,
  attempt: number,
) => ScriptedModelReply;

export interface ScriptedModelClientOptions {
  provider_id?: string;
  endpoint_sha256?: string | null;
  /** Observed by cancellation tests: recorded on entry to `generate`. */
  onRequest?: (request: SemanticModelRequest, options: SemanticModelCallOptions) => void;
}

export class ScriptedSemanticModelClient implements SemanticModelClient {
  readonly provider_id: string;
  readonly endpoint_sha256: string | null;
  readonly requests: SemanticModelRequest[] = [];
  /** Abort state seen by each call, so signal propagation is observable. */
  readonly signalsSeen: (AbortSignal | undefined)[] = [];
  #script: ScriptedModelScript;
  #attempts = 0;
  readonly #onRequest: ScriptedModelClientOptions['onRequest'];

  constructor(script: ScriptedModelScript, options: ScriptedModelClientOptions = {}) {
    this.#script = script;
    this.provider_id = options.provider_id ?? 'juryai.replay';
    this.endpoint_sha256 = options.endpoint_sha256 ?? null;
    this.#onRequest = options.onRequest;
  }

  get attempts(): number {
    return this.#attempts;
  }

  setScript(script: ScriptedModelScript): void {
    this.#script = script;
    this.#attempts = 0;
  }

  async generate(
    request: SemanticModelRequest,
    options: SemanticModelCallOptions = {},
  ): Promise<SemanticModelResponse> {
    this.#attempts += 1;
    this.requests.push(request);
    this.signalsSeen.push(options.signal);
    this.#onRequest?.(request, options);
    // A real transport hands the signal to the socket; this one checks it at
    // the same point, so an aborted call never returns a completion.
    options.signal?.throwIfAborted();

    const reply = this.#script(request, this.#attempts);
    // A real transport rejects with the caller's abort reason when the socket
    // is aborted mid-flight, whatever the provider was about to send. Checking
    // again here models that, so cancellation tests exercise the same race a
    // network client would.
    options.signal?.throwIfAborted();
    if (reply.kind === 'error') throw reply.error;
    if (reply.kind === 'empty') {
      return { text: null, reported_model: null, usage: null };
    }
    return {
      text: reply.text,
      reported_model: reply.reported_model ?? null,
      usage: null,
    };
  }
}

/** Always returns the same completion. The common offline-eval case. */
export function fixedModelClient(
  text: string,
  options: ScriptedModelClientOptions = {},
): ScriptedSemanticModelClient {
  return new ScriptedSemanticModelClient(() => ({ kind: 'text', text }), options);
}

/**
 * Replays completions keyed by a caller-supplied key derived from the request.
 * Used by the offline eval so one client serves a whole corpus.
 */
export function replayModelClient(
  keyOf: (request: SemanticModelRequest) => string,
  completions: ReadonlyMap<string, string>,
  options: ScriptedModelClientOptions = {},
): ScriptedSemanticModelClient {
  return new ScriptedSemanticModelClient((request) => {
    const key = keyOf(request);
    const completion = completions.get(key);
    if (completion === undefined) {
      return {
        kind: 'error',
        error: new SemanticModelError('No replay completion recorded for key ' + key),
      };
    }
    return { kind: 'text', text: completion };
  }, options);
}
