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

export function buildModelCompilerConfig(
  options: ModelSemanticCompilerOptions,
): ModelCompilerConfig {
  return {
    kind: 'model',
    provider_id: options.client.provider_id,
    endpoint_sha256: options.client.endpoint_sha256,
    response_format: 'json_schema_strict',
    output_schema_hash: semanticCompilerSchemaHash(),
    input_template_version: 'juryai-compiler-input-v0.2.0',
    input_render_version: COMPILER_INPUT_RENDER_VERSION,
    sampling_params_sent: !(options.omit_sampling_params ?? false),
    retains_raw_model_output: options.retain_raw_output ?? false,
  };
}

export function buildModelCompilerVersion(options: ModelSemanticCompilerOptions): CompilerVersion {
  return {
    prompt_hash: sha256(SEMANTIC_COMPILER_SYSTEM_PROMPT),
    config_hash: sha256(
      canonicalSerialize(buildModelCompilerConfig(options) as unknown as JsonValue),
    ),
    model_id: options.model_id,
    model_snapshot: options.model_snapshot ?? null,
    decoding: options.decoding ?? DEFAULT_COMPILER_DECODING,
    taxonomy_version: options.taxonomy_version ?? DEFAULT_COMPILER_TAXONOMY_VERSION,
    schema_version: COMPILER_CONTRACT_VERSION,
  };
}

export function buildModelCompilerRegistryEntry(
  options: ModelSemanticCompilerOptions,
): CompilerRegistryEntry {
  const version = buildModelCompilerVersion(options);
  return {
    compiler_version_id: compilerVersionId(version),
    version,
    prompt_text: SEMANTIC_COMPILER_SYSTEM_PROMPT,
    config: buildModelCompilerConfig(options) as unknown as JsonValue,
    registered_at: options.registered_at ?? MODEL_COMPILER_REGISTERED_AT,
  };
}

/** Non-authoritative per-run diagnostics for eval reporting. Never canonical. */
export interface ModelCompileTelemetry {
  compile_run_id: string;
  attempts: number;
  elapsed_ms: number;
  reported_model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export class ModelSemanticCompiler implements SemanticCompilerPort {
  readonly registryEntry: CompilerRegistryEntry;
  /** Diagnostics only. Bounded so a long-lived compiler cannot grow forever. */
  readonly telemetry: ModelCompileTelemetry[] = [];

  readonly #client: SemanticModelClient;
  readonly #options: ModelSemanticCompilerOptions;
  readonly #maxRetries: number;
  readonly #backoffMs: number;
  readonly #telemetryLimit = 256;

  constructor(options: ModelSemanticCompilerOptions) {
    this.#options = options;
    this.#client = options.client;
    this.#maxRetries = Math.max(0, Math.trunc(options.max_transient_retries ?? 1));
    this.#backoffMs = Math.max(0, Math.trunc(options.retry_backoff_ms ?? 0));
    this.registryEntry = buildModelCompilerRegistryEntry(options);
  }

  async compile(input: CompilerInput, options: CompileOptions = {}): Promise<CompilerOutput> {
    const signal = options.signal;
    signal?.throwIfAborted();

    const request: SemanticModelRequest = {
      model: this.#options.model_id,
      system: SEMANTIC_COMPILER_SYSTEM_PROMPT,
      input: renderCompilerInput(input),
      response_format: {
        name: SEMANTIC_COMPILER_SCHEMA_NAME,
        schema: buildSemanticCompilerJsonSchema(),
        strict: true,
      },
      decoding: this.#options.decoding ?? DEFAULT_COMPILER_DECODING,
      omit_sampling_params: this.#options.omit_sampling_params ?? false,
    };

    const startedAt = Date.now();
    let attempts = 0;
    let response: SemanticModelResponse | null = null;
    let lastError: unknown = null;

    // The retry loop is deliberately dumb: the SAME request, under the SAME
    // caller signal, for TRANSIENT transport failures only. It never changes
    // model, prompt, schema or decoding between attempts, and it never resamples
    // because the previous completion failed to parse — that policy would turn
    // a fabricating model into a compiler that eventually gets lucky.
    while (attempts <= this.#maxRetries) {
      signal?.throwIfAborted();
      attempts += 1;
      try {
        response = await this.#client.generate(request, { signal });
        break;
      } catch (error) {
        // Cancellation is never a retry condition, and is never flattened into
        // a provider error: the caller's abort leaves as the caller's abort.
        if (signal?.aborted) throw error;
        if (error instanceof Error && error.name === 'AbortError') throw error;
        lastError = error;
        const transient = error instanceof SemanticModelError && error.transient;
        if (!transient || attempts > this.#maxRetries) break;
        if (this.#backoffMs > 0) await abortableDelay(this.#backoffMs, signal);
      }
    }

    if (response === null) {
      throw lastError instanceof Error
        ? lastError
        : new SemanticModelError('Provider call failed with no diagnosable error.');
    }

    if (response.text === null) {
      // Provider-native structured output produced no completion. `null` is the
      // honest record of that; inventing a raw string would falsify the audit.
      throw new SemanticCompilerOutputError(
        'provider returned no structured output text',
        'model_draft',
      );
    }

    const output = parseModelDraft(input, response.text);
    if (this.#options.retain_raw_output ?? false) {
      output.raw_model_output = response.text;
    }

    // Self-check. This compiler assembled the value itself, so a shape issue
    // here is a bug in this class, not untrusted provider data — and the
    // runtime's own identical check is not weakened by it existing.
    const shapeIssues = validateCompilerOutputShape(output);
    if (shapeIssues.length > 0) {
      throw new SemanticCompilerOutputError(
        'assembled output failed its own shape check: ' + (shapeIssues[0]?.message ?? 'unknown'),
        shapeIssues[0]?.path ?? 'compiler_output',
      );
    }

    this.#recordTelemetry({
      compile_run_id: input.compile_run_id,
      attempts,
      elapsed_ms: Date.now() - startedAt,
      reported_model: response.reported_model,
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
    });

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
