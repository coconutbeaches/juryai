/**
 * The real, model-backed V0.4 semantic compiler.
 *
 * Same layering as V0.3 — all JuryAI semantics live here, the client below owns
 * only a network call — but bound to the V0.4 artefact:
 *
 *   prompt              juryai-semantic-compiler-prompt-v0.4.0
 *   contract            juryai-webmcp-compiler-contract-v0.4.0
 *   input render        juryai-compiler-input-render-v0.4.0
 *   response schema     juryai_semantic_compiler_output_v04
 *
 * and to the V0.3 pieces that genuinely did not move:
 *
 *   input template      juryai-compiler-input-v0.3.0
 *   taxonomy            juryai-p2-v0.3.0
 *   parser/grounding    compiler-v0-3/parse-draft.ts, unchanged
 *   CompilerInput/Output shapes, proposition and strength vocabularies
 *
 * IDENTITY IS HONEST OR IT IS NOTHING. `compiler_version_id` is derived from
 * the V0.4 prompt hash, a config hash over the V0.4 render/schema bindings, the
 * model id, the snapshot, the decoding config, the taxonomy and the V0.4
 * contract version. A moving provider alias with no immutable snapshot is
 * recorded as `model_snapshot: null` and reported that way; inventing a
 * snapshot would claim reproducibility this artefact does not have.
 *
 * The registry entry cannot accidentally carry V0.3 identity: `schema_version`
 * is the V0.4 contract constant, and a guard pins it.
 *
 * NOT PRODUCTION. Nothing in the production tree imports this module, and a
 * structural guard proves it. This compiler exists so the V0.4 doctrine can be
 * measured before anything is wired.
 */

import {
  compilerVersionId,
  type CompilerInput,
  type CompilerOutput,
  type CompilerRegistryEntry,
  type CompilerVersion,
} from '../core-v0-3/compiler-contract.js';
import { COMPILER_CONTRACT_VERSION_V04 } from '../core-v0-4/compiler-contract.js';
import { canonicalSerialize, sha256, type JsonValue } from '../core-v0-3/types.js';
import type { CompileOptions, SemanticCompilerPort } from '../runtime-v0-3/compiler-port.js';
import { validateCompilerOutputShape } from '../runtime-v0-3/compiler-output-shape.js';
import {
  SemanticModelIdentityError,
  type SemanticModelClient,
  type SemanticModelRequest,
} from '../compiler/model-client.js';
import {
  DEFAULT_COMPILER_TAXONOMY_VERSION,
  resolveModelCompilerOptions,
  type ModelCompileOutcome,
  type ModelCompileTelemetry,
  type ModelSemanticCompilerOptions,
  type ResolvedModelCompilerOptions,
} from '../compiler-v0-3/model-compiler.js';
import { parseModelDraft, SemanticCompilerOutputError } from '../compiler-v0-3/parse-draft.js';
import {
  SEMANTIC_COMPILER_PROMPT_VERSION_V04,
  SEMANTIC_COMPILER_SYSTEM_PROMPT_V04,
} from './prompt.js';
import {
  COMPILER_INPUT_RENDER_VERSION_V04,
  compilerInputRenderArtifactHashV04,
  renderCompilerInputV04,
} from './render-input.js';
import {
  SEMANTIC_COMPILER_SCHEMA_NAME_V04,
  buildSemanticCompilerJsonSchemaV04,
  semanticCompilerSchemaHashV04,
} from './response-schema.js';
import { callProvider } from './provider-call.js';

/** Unchanged from V0.3: the taxonomy genuinely did not move. */
export const COMPILER_INPUT_TEMPLATE_VERSION_V04 = 'juryai-compiler-input-v0.3.0';

/**
 * The V0.4 material execution config.
 *
 * Carries `output_schema_name` in addition to the V0.3 fields, because the
 * schema NAME is sent to the provider alongside the schema and is therefore
 * part of what the model was asked. V0.3 omitted it; leaving it out of a new
 * artefact's identity would understate the delta.
 */
export interface ModelCompilerConfigV04 {
  kind: 'model';
  provider_id: string;
  endpoint_sha256: string | null;
  prompt_version: string;
  response_format: 'json_schema_strict';
  output_schema_name: string;
  output_schema_hash: string;
  input_template_version: string;
  input_render_version: string;
  /**
   * The CONTENT hash of the model-facing render artefact.
   *
   * `input_render_version` above is a hand-maintained LABEL. Editing
   * `V04_REQUIREMENT_SCOPE_INSTRUCTION` without bumping it changed what the
   * model is told while `compiler_version_id` stayed byte-identical — an
   * identity collision found by bounded review and reproduced before this fix.
   *
   * Binding the artefact hash here makes the identity cryptographically commit
   * to the bytes rather than to a claim about them: any change to the
   * instruction text, the version line, or the substitution logic necessarily
   * moves `config_hash` and therefore `compiler_version_id`.
   */
  input_render_artifact_hash: string;
  sampling_params_sent: boolean;
  retains_raw_model_output: boolean;
}

export function modelCompilerConfigOfV04(
  resolved: ResolvedModelCompilerOptions,
): ModelCompilerConfigV04 {
  return {
    kind: 'model',
    provider_id: resolved.provider_id,
    endpoint_sha256: resolved.endpoint_sha256,
    prompt_version: SEMANTIC_COMPILER_PROMPT_VERSION_V04,
    response_format: 'json_schema_strict',
    output_schema_name: SEMANTIC_COMPILER_SCHEMA_NAME_V04,
    output_schema_hash: semanticCompilerSchemaHashV04(),
    input_template_version: COMPILER_INPUT_TEMPLATE_VERSION_V04,
    input_render_version: COMPILER_INPUT_RENDER_VERSION_V04,
    input_render_artifact_hash: compilerInputRenderArtifactHashV04(),
    sampling_params_sent: !resolved.omit_sampling_params,
    retains_raw_model_output: resolved.retain_raw_output,
  };
}

export function modelCompilerVersionOfV04(resolved: ResolvedModelCompilerOptions): CompilerVersion {
  return {
    prompt_hash: sha256(SEMANTIC_COMPILER_SYSTEM_PROMPT_V04),
    config_hash: sha256(
      canonicalSerialize(modelCompilerConfigOfV04(resolved) as unknown as JsonValue),
    ),
    model_id: resolved.model_id,
    model_snapshot: resolved.model_snapshot,
    decoding: { ...resolved.decoding },
    taxonomy_version: resolved.taxonomy_version,
    // THE V0.4 CONTRACT. Not V0.3. A guard pins this.
    schema_version: COMPILER_CONTRACT_VERSION_V04,
  };
}

export function modelCompilerRegistryEntryOfV04(
  resolved: ResolvedModelCompilerOptions,
): CompilerRegistryEntry {
  const version = modelCompilerVersionOfV04(resolved);
  return {
    compiler_version_id: compilerVersionId(version),
    version,
    prompt_text: SEMANTIC_COMPILER_SYSTEM_PROMPT_V04,
    config: modelCompilerConfigOfV04(resolved) as unknown as JsonValue,
    registered_at: resolved.registered_at,
  };
}

export function buildModelCompilerRegistryEntryV04(
  options: ModelSemanticCompilerOptions,
): CompilerRegistryEntry {
  return modelCompilerRegistryEntryOfV04(resolveModelCompilerOptions(options));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

export class ModelSemanticCompilerV04 implements SemanticCompilerPort {
  readonly registryEntry: CompilerRegistryEntry;
  /** Diagnostics only. Bounded so a long-lived compiler cannot grow forever. */
  readonly telemetry: ModelCompileTelemetry[] = [];

  readonly #client: SemanticModelClient;
  /** The ONLY source of material values after construction. */
  readonly #resolved: ResolvedModelCompilerOptions;
  readonly #telemetryLimit = 512;

  constructor(options: ModelSemanticCompilerOptions) {
    this.#client = options.client;
    // Reused from V0.3 unchanged: it detaches and deep-freezes the caller's
    // object so a later mutation cannot make the registered artefact untrue,
    // and it already refuses any taxonomy but the V0.3 one — which is exactly
    // what V0.4 wants, since the taxonomy did not move.
    this.#resolved = resolveModelCompilerOptions(options);
    if (this.#resolved.taxonomy_version !== DEFAULT_COMPILER_TAXONOMY_VERSION) {
      throw new TypeError('The V0.4 compiler requires the V0.3 proposition taxonomy.');
    }
    this.registryEntry = deepFreeze(modelCompilerRegistryEntryOfV04(this.#resolved));
  }

  get resolvedOptions(): ResolvedModelCompilerOptions {
    return this.#resolved;
  }

  async compile(input: CompilerInput, options: CompileOptions = {}): Promise<CompilerOutput> {
    const signal = options.signal;
    signal?.throwIfAborted();
    // The input must bind THIS artefact. Without the second check an eval could
    // report a green run against a compiler_version_id nothing actually
    // executed, which is the precise way a model eval becomes theatre.
    if (
      input.input_template_version !== COMPILER_INPUT_TEMPLATE_VERSION_V04 ||
      input.compiler_version_id !== this.registryEntry.compiler_version_id
    ) {
      throw new TypeError('Compiler input must bind the exact V0.4 artefact and input contract.');
    }

    const request: SemanticModelRequest = {
      model: this.#resolved.model_id,
      system: SEMANTIC_COMPILER_SYSTEM_PROMPT_V04,
      input: renderCompilerInputV04(input),
      response_format: {
        name: SEMANTIC_COMPILER_SCHEMA_NAME_V04,
        schema: buildSemanticCompilerJsonSchemaV04(),
        strict: true,
      },
      decoding: { ...this.#resolved.decoding },
      omit_sampling_params: this.#resolved.omit_sampling_params,
    };

    const record = (
      diagnostics: {
        attempts: number;
        elapsed_ms: number;
        reported_model: string | null;
        input_tokens: number | null;
        output_tokens: number | null;
      },
      outcome: ModelCompileOutcome,
    ): void => {
      this.telemetry.push({ compile_run_id: input.compile_run_id, ...diagnostics, outcome });
      if (this.telemetry.length > this.#telemetryLimit) this.telemetry.shift();
    };

    const { response, diagnostics } = await callProvider({
      client: this.#client,
      request,
      maxTransientRetries: this.#resolved.max_transient_retries,
      retryBackoffMs: this.#resolved.retry_backoff_ms,
      signal,
      onTerminal: (failed, outcome) => {
        record(failed, outcome);
      },
    });

    // Pinned-model provenance. Deliberately AFTER the retry loop and
    // non-transient, so a mismatch can never be resampled until some attempt
    // happens to report the right model. With no snapshot configured the
    // artefact makes no such claim and the reported model stays informational.
    const pinned = this.#resolved.model_snapshot;
    if (pinned !== null && response.reported_model !== pinned) {
      record(diagnostics, 'model_identity_rejected');
      throw new SemanticModelIdentityError(pinned, response.reported_model);
    }

    if (response.text === null) {
      record(diagnostics, 'no_output_text');
      throw new SemanticCompilerOutputError(
        'provider returned no structured output text',
        'model_draft',
      );
    }

    let output: CompilerOutput;
    try {
      // The V0.3 parser, reused unchanged. It enforces neither rule V0.4
      // removes — no one-per-slot cap, no in_reply_to restriction — and a
      // regression in `compiler-v0-4-adapters.test.ts` proves both V0.4-legal
      // shapes parse.
      output = parseModelDraft(input, response.text);
    } catch (error) {
      record(diagnostics, 'malformed_output');
      throw error;
    }
    if (this.#resolved.retain_raw_output) output.raw_model_output = response.text;

    const shapeIssues = validateCompilerOutputShape(output);
    if (shapeIssues.length > 0) {
      record(diagnostics, 'malformed_output');
      throw new SemanticCompilerOutputError(
        'assembled output failed its own shape check: ' + (shapeIssues[0]?.message ?? 'unknown'),
        shapeIssues[0]?.path ?? 'compiler_output',
      );
    }

    record(diagnostics, 'compiled');
    return output;
  }
}
