/**
 * The real, model-backed `SemanticCompilerPort`.
 *
 * Layering, and why it is this way round:
 *
 *   SemanticCompilerPort            <- the runtime's boundary (frozen)
 *          ^
 *   ModelSemanticCompiler           <- ALL JuryAI semantics live here
 *          v
 *   SemanticModelClient             <- send bytes, receive bytes, honour abort
 *
 * This class owns the prompt, the input rendering, the output schema, the
 * output contract, the grounding rules and the compiler artefact. The client
 * below it owns a network call. Swapping provider or model therefore changes
 * `compiler_version_id` — as it must, since the artefact that ran is different
 * — but changes no JuryAI rule.
 *
 * It owns none of the runtime's responsibilities: no id minting for canonical
 * objects, no provenance, no supersession application, no clarification
 * creation, no versioning, no commit. It receives a `CompilerInput` and
 * returns a candidate `CompilerOutput`. Nothing else.
 */

import {
  COMPILER_CONTRACT_VERSION,
  compilerVersionId,
  type CompilerDecodingConfig,
  type CompilerInput,
  type CompilerOutput,
  type CompilerRegistryEntry,
  type CompilerVersion,
} from '../core/compiler-contract.js';
import { canonicalSerialize, sha256, type JsonValue } from '../core/types.js';
import type { CompileOptions, SemanticCompilerPort } from '../runtime/compiler-port.js';
import { validateCompilerOutputShape } from '../runtime/compiler-output-shape.js';
import {
  SemanticModelError,
  SemanticModelIdentityError,
  type SemanticModelClient,
  type SemanticModelRequest,
  type SemanticModelResponse,
} from './model-client.js';
import { SEMANTIC_COMPILER_SYSTEM_PROMPT } from './prompt.js';
import { COMPILER_INPUT_RENDER_VERSION, renderCompilerInput } from './render-input.js';
import {
  buildSemanticCompilerJsonSchema,
  SEMANTIC_COMPILER_SCHEMA_NAME,
  semanticCompilerSchemaHash,
} from './response-schema.js';
import { parseModelDraft, SemanticCompilerOutputError } from './parse-draft.js';

export const DEFAULT_COMPILER_TAXONOMY_VERSION = 'juryai-p2-v0.2.0';

/**
 * Fixed on purpose. `registered_at` is part of the registry entry's equality
 * check, so a wall-clock value would make two processes registering the SAME
 * artefact look like two different artefacts under one version id.
 */
export const MODEL_COMPILER_REGISTERED_AT = '2026-01-01T00:00:00.000Z';

/**
 * Hard ceilings on the operational retry settings.
 *
 * `Math.trunc`/`Math.max` preserve `Infinity`, so an unvalidated
 * `max_transient_retries` could make the retry loop unable to exhaust while a
 * provider kept returning transient errors — unbounded paid requests from a
 * single compile, and a documented bound that is not one. `NaN` fails the
 * other way and silently skips the provider entirely. Both are refused at
 * construction rather than clamped, because either is a misconfiguration the
 * operator needs to see.
 */
export const MAX_TRANSIENT_RETRIES_CEILING = 5;
export const MAX_RETRY_BACKOFF_MS_CEILING = 60_000;

export const DEFAULT_COMPILER_DECODING: CompilerDecodingConfig = {
  temperature: 0,
  top_p: null,
  max_output_tokens: 8192,
  // Declared intent only; the Responses endpoint takes no seed and the
  // transport sends none. Recorded rather than pretended away.
  seed: null,
};

export interface ModelSemanticCompilerOptions {
  client: SemanticModelClient;
  /** Provider model identifier, e.g. a dated snapshot or a family alias. */
  model_id: string;
  /**
   * A genuinely pinned provider snapshot, or null. A moving alias is NOT a
   * snapshot: recording one here would claim reproducibility the artefact does
   * not have. When the model id itself is already an immutable snapshot, pass
   * it here too; otherwise leave it null.
   */
  model_snapshot?: string | null;
  decoding?: CompilerDecodingConfig;
  taxonomy_version?: string;
  /** Set for model families that reject `temperature`/`top_p`. */
  omit_sampling_params?: boolean;
  /**
   * Retain the provider's raw completion text in `raw_model_output`. This is
   * AUDIT material: the runtime never surfaces it through `CaseStateResponse`.
   * Default false, so raw legal-case text is not duplicated into the compile
   * run unless an operator asks for it.
   */
  retain_raw_output?: boolean;
  /**
   * Bounded retries for TRANSIENT transport failures only. Never for malformed
   * output, never for a refusal, never after the caller aborts. Default 1.
   */
  max_transient_retries?: number;
  /** Abortable pause between transient retries. Default 0. */
  retry_backoff_ms?: number;
  registered_at?: string;
}

/**
 * The material execution artefact, minus prompt and decoding (which live in
 * `CompilerVersion` directly). Anything that changes what the model can be
 * asked or can answer belongs here; operational transport policy — retry
 * count, backoff, timeouts — deliberately does not, because it cannot change
 * the meaning of a successful run.
 */
export interface ModelCompilerConfig {
  kind: 'model';
  provider_id: string;
  endpoint_sha256: string | null;
  response_format: 'json_schema_strict';
  output_schema_hash: string;
  input_template_version: string;
  input_render_version: string;
  sampling_params_sent: boolean;
  retains_raw_model_output: boolean;
}

/**
 * The compiler's own copy of every value that decides its identity and drives
 * its execution.
 *
 * `ModelSemanticCompilerOptions` is a CALLER-OWNED object. Hashing it at
 * construction and then reading it again at compile time would let a caller
 * mutate `decoding`, `model_id` or the sampling policy after registration and
 * silently execute a different artefact than the one every resulting
 * proposition is attributed to. That is compiler-provenance corruption, and it
 * is unfixable after the fact because the audit trail is internally consistent
 * and wrong.
 *
 * So the options are resolved and DETACHED exactly once, and this snapshot is
 * the single source for both the registry artefact and every later compile.
 * Nothing downstream ever reads the caller's object again.
 */
export interface ResolvedModelCompilerOptions {
  readonly model_id: string;
  readonly model_snapshot: string | null;
  readonly decoding: CompilerDecodingConfig;
  readonly taxonomy_version: string;
  readonly omit_sampling_params: boolean;
  readonly retain_raw_output: boolean;
  readonly registered_at: string;
  /** Operational, outside compiler identity — but still snapshotted, because
   *  execution reads it and a caller must not be able to change it later. */
  readonly max_transient_retries: number;
  readonly retry_backoff_ms: number;
  /** Provider identity, read from the client once. Enters `config_hash`. */
  readonly provider_id: string;
  readonly endpoint_sha256: string | null;
}

/**
 * A retry setting must be a finite, non-negative integer within its ceiling.
 * Anything else — `Infinity`, `NaN`, a negative, a fraction, an absurd finite
 * value — is refused loudly here rather than normalised into behaviour the
 * caller did not ask for.
 */
function boundedSetting(
  value: number | undefined,
  fallback: number,
  ceiling: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0 || value > ceiling) {
    throw new TypeError(
      name + ' must be an integer between 0 and ' + String(ceiling) + '; received ' + String(value),
    );
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/**
 * Applies defaults and severs every alias to the caller's object.
 *
 * `structuredClone` is what makes this correct rather than superficially
 * correct: a spread would copy the top level and keep `decoding` pointing at
 * the caller's own nested object, which is the easiest version of this bug to
 * write and the hardest to notice. The result is then deep-frozen so a later
 * mutation is a loud failure inside this module rather than a quiet one.
 */
export function resolveModelCompilerOptions(
  options: ModelSemanticCompilerOptions,
): ResolvedModelCompilerOptions {
  return deepFreeze(
    structuredClone({
      model_id: options.model_id,
      model_snapshot: options.model_snapshot ?? null,
      decoding: options.decoding ?? DEFAULT_COMPILER_DECODING,
      taxonomy_version: options.taxonomy_version ?? DEFAULT_COMPILER_TAXONOMY_VERSION,
      omit_sampling_params: options.omit_sampling_params ?? false,
      retain_raw_output: options.retain_raw_output ?? false,
      registered_at: options.registered_at ?? MODEL_COMPILER_REGISTERED_AT,
      max_transient_retries: boundedSetting(
        options.max_transient_retries,
        1,
        MAX_TRANSIENT_RETRIES_CEILING,
        'max_transient_retries',
      ),
      retry_backoff_ms: boundedSetting(
        options.retry_backoff_ms,
        0,
        MAX_RETRY_BACKOFF_MS_CEILING,
        'retry_backoff_ms',
      ),
      provider_id: options.client.provider_id,
      endpoint_sha256: options.client.endpoint_sha256,
    }),
  );
}

export function modelCompilerConfigOf(resolved: ResolvedModelCompilerOptions): ModelCompilerConfig {
  return {
    kind: 'model',
    provider_id: resolved.provider_id,
    endpoint_sha256: resolved.endpoint_sha256,
    response_format: 'json_schema_strict',
    output_schema_hash: semanticCompilerSchemaHash(),
    input_template_version: 'juryai-compiler-input-v0.2.0',
    input_render_version: COMPILER_INPUT_RENDER_VERSION,
    sampling_params_sent: !resolved.omit_sampling_params,
    retains_raw_model_output: resolved.retain_raw_output,
  };
}

export function modelCompilerVersionOf(resolved: ResolvedModelCompilerOptions): CompilerVersion {
  return {
    prompt_hash: sha256(SEMANTIC_COMPILER_SYSTEM_PROMPT),
    config_hash: sha256(
      canonicalSerialize(modelCompilerConfigOf(resolved) as unknown as JsonValue),
    ),
    model_id: resolved.model_id,
    model_snapshot: resolved.model_snapshot,
    // Already detached and frozen; cloned again so the registry entry does not
    // alias the compiler's own snapshot either.
    decoding: { ...resolved.decoding },
    taxonomy_version: resolved.taxonomy_version,
    schema_version: COMPILER_CONTRACT_VERSION,
  };
}

export function modelCompilerRegistryEntryOf(
  resolved: ResolvedModelCompilerOptions,
): CompilerRegistryEntry {
  const version = modelCompilerVersionOf(resolved);
  return {
    compiler_version_id: compilerVersionId(version),
    version,
    prompt_text: SEMANTIC_COMPILER_SYSTEM_PROMPT,
    config: modelCompilerConfigOf(resolved) as unknown as JsonValue,
    registered_at: resolved.registered_at,
  };
}

/* Convenience wrappers over the resolved forms, for callers holding raw
 * options. They resolve first, so they can never observe a different artefact
 * than the compiler itself would build from the same options. */

export function buildModelCompilerConfig(
  options: ModelSemanticCompilerOptions,
): ModelCompilerConfig {
  return modelCompilerConfigOf(resolveModelCompilerOptions(options));
}

export function buildModelCompilerVersion(options: ModelSemanticCompilerOptions): CompilerVersion {
  return modelCompilerVersionOf(resolveModelCompilerOptions(options));
}

export function buildModelCompilerRegistryEntry(
  options: ModelSemanticCompilerOptions,
): CompilerRegistryEntry {
  return modelCompilerRegistryEntryOf(resolveModelCompilerOptions(options));
}

/**
 * What happened to a compile run after the provider was called.
 *
 * Recorded for every run that reached the provider, not only successful ones:
 * a response that is billed and then rejected — wrong pinned model, no
 * completion text, malformed JSON — still cost a request, and diagnostics that
 * drop those underreport usage precisely when a model is misbehaving, which is
 * when the numbers matter most.
 */
export type ModelCompileOutcome =
  | 'compiled'
  | 'provider_failed'
  | 'model_identity_rejected'
  | 'no_output_text'
  | 'malformed_output'
  | 'cancelled';

/** Non-authoritative per-run diagnostics for eval reporting. Never canonical. */
export interface ModelCompileTelemetry {
  compile_run_id: string;
  attempts: number;
  elapsed_ms: number;
  reported_model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  outcome: ModelCompileOutcome;
}

export class ModelSemanticCompiler implements SemanticCompilerPort {
  readonly registryEntry: CompilerRegistryEntry;
  /** Diagnostics only. Bounded so a long-lived compiler cannot grow forever. */
  readonly telemetry: ModelCompileTelemetry[] = [];

  readonly #client: SemanticModelClient;
  /** The ONLY source of material values after construction. */
  readonly #resolved: ResolvedModelCompilerOptions;
  readonly #telemetryLimit = 256;

  constructor(options: ModelSemanticCompilerOptions) {
    // The client is a live transport and is held by reference on purpose; its
    // IDENTITY strings are snapshotted into `#resolved` so a client that later
    // renames itself cannot make the registered artefact untrue.
    this.#client = options.client;
    this.#resolved = resolveModelCompilerOptions(options);
    // Identity and execution are derived from the same snapshot, so the
    // artefact this compiler registers is by construction the artefact it runs.
    this.registryEntry = deepFreeze(modelCompilerRegistryEntryOf(this.#resolved));
  }

  /** The detached material snapshot this compiler will actually execute. */
  get resolvedOptions(): ResolvedModelCompilerOptions {
    return this.#resolved;
  }

  async compile(input: CompilerInput, options: CompileOptions = {}): Promise<CompilerOutput> {
    const signal = options.signal;
    signal?.throwIfAborted();

    const request: SemanticModelRequest = {
      model: this.#resolved.model_id,
      system: SEMANTIC_COMPILER_SYSTEM_PROMPT,
      input: renderCompilerInput(input),
      response_format: {
        name: SEMANTIC_COMPILER_SCHEMA_NAME,
        schema: buildSemanticCompilerJsonSchema(),
        strict: true,
      },
      // A fresh copy per request: the transport is given a value it may hold
      // without ever reaching the compiler's own frozen snapshot.
      decoding: { ...this.#resolved.decoding },
      omit_sampling_params: this.#resolved.omit_sampling_params,
    };

    const startedAt = Date.now();
    let attempts = 0;
    let response: SemanticModelResponse | null = null;
    let lastError: unknown = null;

    // Every terminal path below records exactly once, so provider-call counts
    // and token totals describe the whole run rather than only its successes.
    const record = (
      outcome: ModelCompileOutcome,
      seen: SemanticModelResponse | null = null,
    ): void => {
      // With no response in hand, fall back to whatever the failed call itself
      // reported. A refusal, a truncated completion or an HTTP error can all
      // carry real usage, and dropping it understates the run in the direction
      // that hides a misbehaving model.
      const failed = lastError instanceof SemanticModelError ? lastError.diagnostics : null;
      this.#recordTelemetry({
        compile_run_id: input.compile_run_id,
        attempts,
        elapsed_ms: Date.now() - startedAt,
        reported_model: seen?.reported_model ?? failed?.reported_model ?? null,
        input_tokens: seen?.usage?.input_tokens ?? failed?.usage?.input_tokens ?? null,
        output_tokens: seen?.usage?.output_tokens ?? failed?.usage?.output_tokens ?? null,
        outcome,
      });
    };

    // The retry loop is deliberately dumb: the SAME request, under the SAME
    // caller signal, for TRANSIENT transport failures only. It never changes
    // model, prompt, schema or decoding between attempts, and it never resamples
    // because the previous completion failed to parse — that policy would turn
    // a fabricating model into a compiler that eventually gets lucky.
    while (attempts <= this.#resolved.max_transient_retries) {
      signal?.throwIfAborted();
      attempts += 1;
      try {
        response = await this.#client.generate(request, { signal });
        break;
      } catch (error) {
        // Cancellation is never a retry condition, and is never flattened into
        // a provider error: the caller's abort leaves as the caller's abort.
        // The attempts it already billed are still recorded.
        if (signal?.aborted) {
          record('cancelled');
          throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          record('cancelled');
          throw error;
        }
        lastError = error;
        const transient = error instanceof SemanticModelError && error.transient;
        if (!transient || attempts > this.#resolved.max_transient_retries) break;
        const backoff = this.#resolved.retry_backoff_ms;
        if (backoff > 0) {
          try {
            await abortableDelay(backoff, signal);
          } catch (aborted) {
            // `abortableDelay` rejects with the caller's abort reason from
            // inside this handler, which would otherwise leave `compile()`
            // without passing any `record(...)` — losing the telemetry for
            // attempts the provider had already billed.
            record('cancelled');
            throw aborted;
          }
        }
      }
    }

    if (response === null) {
      record('provider_failed');
      throw lastError instanceof Error
        ? lastError
        : new SemanticModelError('Provider call failed with no diagnosable error.');
    }

    // Pinned-model provenance. When the artefact claims a specific snapshot
    // executed, the provider must POSITIVELY identify that snapshot for this
    // response; otherwise the registry and every proposition derived from the
    // run would attribute it to a model we cannot show it came from. A gateway
    // silently routing elsewhere is exactly the case this catches.
    //
    // Deliberately AFTER the retry loop and non-transient, so a mismatch can
    // never be resampled until some attempt happens to report the right model.
    // The configured snapshot is never rewritten from the response, and no new
    // compiler version is derived after the fact: the artefact is fixed before
    // execution and the response has to belong to it.
    //
    // With no snapshot configured the artefact makes no such claim, so a
    // reported model stays purely informational and is only recorded as
    // telemetry.
    const pinned = this.#resolved.model_snapshot;
    if (pinned !== null && response.reported_model !== pinned) {
      record('model_identity_rejected', response);
      throw new SemanticModelIdentityError(pinned, response.reported_model);
    }

    if (response.text === null) {
      // Provider-native structured output produced no completion. `null` is the
      // honest record of that; inventing a raw string would falsify the audit.
      record('no_output_text', response);
      throw new SemanticCompilerOutputError(
        'provider returned no structured output text',
        'model_draft',
      );
    }

    let output: CompilerOutput;
    try {
      output = parseModelDraft(input, response.text);
    } catch (error) {
      record('malformed_output', response);
      throw error;
    }
    if (this.#resolved.retain_raw_output) {
      output.raw_model_output = response.text;
    }

    // Self-check. This compiler assembled the value itself, so a shape issue
    // here is a bug in this class, not untrusted provider data — and the
    // runtime's own identical check is not weakened by it existing.
    const shapeIssues = validateCompilerOutputShape(output);
    if (shapeIssues.length > 0) {
      record('malformed_output', response);
      throw new SemanticCompilerOutputError(
        'assembled output failed its own shape check: ' + (shapeIssues[0]?.message ?? 'unknown'),
        shapeIssues[0]?.path ?? 'compiler_output',
      );
    }

    record('compiled', response);

    return output;
  }

  #recordTelemetry(entry: ModelCompileTelemetry): void {
    this.telemetry.push(entry);
    if (this.telemetry.length > this.#telemetryLimit) this.telemetry.shift();
  }
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
