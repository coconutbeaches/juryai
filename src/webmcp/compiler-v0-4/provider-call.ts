/**
 * The provider-call loop for the V0.4 compiler.
 *
 * WHY THIS IS SEPARATE, AND WHY IT IS NOT A CLONE OF V0.3. The V0.3
 * `ModelSemanticCompiler.compile` interleaves two unrelated concerns: the
 * SEMANTIC bindings (which prompt, which renderer, which schema, which
 * contract) and the OPERATIONAL transport policy (retry, abort, telemetry).
 * V0.4 changes only the first. Copying `model-compiler.ts` wholesale to change
 * four bindings would clone several hundred lines of operational code and
 * create a second place for the retry and telemetry rules to drift.
 *
 * So the operational half is isolated here, generation-neutral, and the V0.4
 * compiler supplies its own semantics. Production V0.3 is deliberately NOT
 * rewired to use this in this PR: repointing the live compiler's execution path
 * is a production change, and this slice is a runtime no-op. 8C2 may promote
 * this to a shared module once something other than the eval depends on it.
 *
 * The properties that make this correct are inherited from V0.3 on purpose:
 *
 *  - Telemetry is recorded on EVERY terminal path, not only success. A response
 *    that is billed and then rejected still cost a request, and diagnostics that
 *    drop those underreport usage exactly when a model is misbehaving.
 *  - Retries are for TRANSIENT TRANSPORT failures only. Never for malformed
 *    output, never for a refusal, never after the caller aborts. Resampling
 *    because the last completion failed to parse turns a fabricating model into
 *    a compiler that eventually gets lucky — which is precisely the failure mode
 *    a semantic eval exists to detect.
 *  - Abort is never flattened into a provider error, and attempts already billed
 *    before the abort are still recorded.
 */

import {
  SemanticModelError,
  type SemanticModelClient,
  type SemanticModelRequest,
  type SemanticModelResponse,
} from '../compiler/model-client.js';

/** Usage and identity accumulated across every attempt, billed or not. */
export interface ProviderCallDiagnostics {
  attempts: number;
  elapsed_ms: number;
  reported_model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface ProviderCallResult {
  response: SemanticModelResponse;
  diagnostics: ProviderCallDiagnostics;
}

export interface ProviderCallOptions {
  client: SemanticModelClient;
  request: SemanticModelRequest;
  maxTransientRetries: number;
  retryBackoffMs: number;
  signal?: AbortSignal | undefined;
  /**
   * Invoked exactly once on every terminal path, including failures, BEFORE the
   * error propagates. The caller records outcome-specific telemetry from it.
   */
  onTerminal: (
    diagnostics: ProviderCallDiagnostics,
    outcome: 'provider_failed' | 'cancelled',
  ) => void;
}

/** Rejects on abort rather than resolving late, so no wait outlives a cancel. */
async function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function callProvider(options: ProviderCallOptions): Promise<ProviderCallResult> {
  const { client, request, maxTransientRetries, retryBackoffMs, signal, onTerminal } = options;
  const startedAt = Date.now();

  let attempts = 0;
  let response: SemanticModelResponse | null = null;
  let lastError: unknown = null;
  let reportedModel: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let hasInputTokens = false;
  let hasOutputTokens = false;

  const accumulate = (
    diagnostics: {
      reported_model: string | null;
      usage: { input_tokens: number | null; output_tokens: number | null } | null;
    } | null,
  ): void => {
    if (diagnostics === null) return;
    if (diagnostics.reported_model !== null) reportedModel = diagnostics.reported_model;
    const usage = diagnostics.usage;
    if (usage?.input_tokens !== null && usage?.input_tokens !== undefined) {
      inputTokens += usage.input_tokens;
      hasInputTokens = true;
    }
    if (usage?.output_tokens !== null && usage?.output_tokens !== undefined) {
      outputTokens += usage.output_tokens;
      hasOutputTokens = true;
    }
  };

  const snapshot = (): ProviderCallDiagnostics => ({
    attempts,
    elapsed_ms: Date.now() - startedAt,
    reported_model: reportedModel,
    input_tokens: hasInputTokens ? inputTokens : null,
    output_tokens: hasOutputTokens ? outputTokens : null,
  });

  // Deliberately dumb: the SAME request, under the SAME caller signal, for
  // transient transport failures only. Never a different model, prompt, schema
  // or decoding between attempts.
  while (attempts <= maxTransientRetries) {
    signal?.throwIfAborted();
    attempts += 1;
    try {
      response = await client.generate(request, { signal });
      accumulate(response);
      break;
    } catch (error) {
      lastError = error;
      // Each attempt may already have been billed even when a later one
      // succeeds, so accumulate at the catch boundary.
      if (error instanceof SemanticModelError) accumulate(error.diagnostics);
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        onTerminal(snapshot(), 'cancelled');
        throw error;
      }
      const transient = error instanceof SemanticModelError && error.transient;
      if (!transient || attempts > maxTransientRetries) break;
      if (retryBackoffMs > 0) {
        try {
          await abortableDelay(retryBackoffMs, signal);
        } catch (aborted) {
          // Without this the function would leave via the delay's rejection and
          // never report the attempts the provider had already billed.
          onTerminal(snapshot(), 'cancelled');
          throw aborted;
        }
      }
    }
  }

  if (response === null) {
    onTerminal(snapshot(), 'provider_failed');
    throw lastError instanceof Error
      ? lastError
      : new SemanticModelError('Provider call failed with no diagnosable error.');
  }

  return { response, diagnostics: snapshot() };
}
