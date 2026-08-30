/**
 * The provider seam.
 *
 * This module is deliberately the NARROWEST layer in the semantic compiler. A
 * provider client sends one request, receives one response, honours one
 * `AbortSignal`, and returns what the provider said. It owns no JuryAI
 * semantics whatsoever: not the prompt, not the input rendering, not the output
 * contract, not the grounding rules, not the compiler artefact.
 *
 * Everything above this seam — `ModelSemanticCompiler` — owns those, so a
 * provider or model can be swapped without rewriting a single JuryAI rule. If
 * this file ever starts to know what a proposition is, the boundary has been
 * lost.
 *
 * Two identity fields are published because compiler identity depends on them:
 * a run against a different provider, or against a different endpoint, is not
 * a run of the same artefact even when the model id string matches.
 */

import type { CompilerDecodingConfig } from '../core/compiler-contract.js';
import type { JsonValue } from '../core/types.js';

/** Provider-native structured-output request. Convenience, never authority. */
export interface SemanticModelResponseFormat {
  /** Schema name the provider echoes back. */
  name: string;
  /** JSON Schema, already reduced to the provider's strict subset. */
  schema: JsonValue;
  strict: boolean;
}

export interface SemanticModelRequest {
  model: string;
  /** JuryAI-owned system instructions. The client never edits or appends. */
  system: string;
  /** JuryAI-owned rendered compiler input. The client never edits or appends. */
  input: string;
  response_format: SemanticModelResponseFormat;
  decoding: CompilerDecodingConfig;
  /**
   * When true the transport omits sampling parameters entirely. Some model
   * families reject `temperature`/`top_p`; the declared decoding config is
   * still recorded in compiler identity either way, because what was DECLARED
   * is part of the artefact even when the endpoint refuses to accept it.
   */
  omit_sampling_params: boolean;
}

/**
 * Non-authoritative diagnostics. Reported so a live eval can print cost and
 * latency; never written to canonical state, never part of compiler identity.
 */
export interface SemanticModelUsage {
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface SemanticModelResponse {
  /**
   * The provider's structured-output text. `null` when the provider produced
   * no textual completion at all — which is a compiler failure, not something
   * to paper over with an invented string.
   */
  text: string | null;
  /** Model identity the provider reported for THIS completion, if it did. */
  reported_model: string | null;
  usage: SemanticModelUsage | null;
}

export interface SemanticModelCallOptions {
  signal?: AbortSignal;
}

export interface SemanticModelClient {
  /** Stable provider identity, e.g. 'openai.responses'. Enters config_hash. */
  readonly provider_id: string;
  /**
   * sha256 of the resolved endpoint, or null for a client with no network
   * endpoint. The URL itself is never published: it can carry deployment
   * detail, and a hash is enough to prove two runs addressed the same place.
   */
  readonly endpoint_sha256: string | null;
  generate(
    request: SemanticModelRequest,
    options?: SemanticModelCallOptions,
  ): Promise<SemanticModelResponse>;
}

/* ------------------------------------------------------------------------ */
/* Failure taxonomy                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Non-authoritative diagnostics the provider reported ALONGSIDE a failure.
 *
 * A refused or truncated completion is still a billed one, and a failure that
 * discards its usage makes a run look cheaper than it was — in the direction
 * that hides a misbehaving model. So the transport attaches whatever it managed
 * to read to the error, and the compiler records it.
 */
export interface SemanticModelErrorDiagnostics {
  reported_model: string | null;
  usage: SemanticModelUsage | null;
}

/**
 * A provider-side failure. `transient` is the ONLY thing that makes a bounded
 * retry legitimate; it is set by the transport from the actual transport
 * signal (network error, 429, 5xx), never guessed from a message string by a
 * caller.
 */
export class SemanticModelError extends Error {
  readonly transient: boolean;
  readonly status: number | null;
  /** Usage the provider reported for the failed call, where it reported any. */
  readonly diagnostics: SemanticModelErrorDiagnostics | null;

  constructor(
    message: string,
    options: {
      transient?: boolean;
      status?: number | null;
      diagnostics?: SemanticModelErrorDiagnostics | null;
    } = {},
  ) {
    super(message);
    this.name = 'SemanticModelError';
    this.transient = options.transient ?? false;
    this.status = options.status ?? null;
    this.diagnostics = options.diagnostics ?? null;
  }
}

/**
 * The model declined to answer. Never transient: resampling a refusal until it
 * stops refusing is exactly the "sample until something passes" policy this
 * compiler is not allowed to have.
 */
export class SemanticModelRefusalError extends SemanticModelError {
  constructor(message: string, diagnostics: SemanticModelErrorDiagnostics | null = null) {
    super(message, { transient: false, diagnostics });
    this.name = 'SemanticModelRefusalError';
  }
}

/**
 * The provider's response could not be shown to belong to the PINNED model the
 * compiler artefact claims executed.
 *
 * Never transient. A gateway that routed a pinned request elsewhere will keep
 * routing it elsewhere, and retrying until some attempt happens to report the
 * right model would be sampling for a provenance claim rather than verifying
 * one.
 */
export class SemanticModelIdentityError extends SemanticModelError {
  readonly configured_snapshot: string;
  readonly reported_model: string | null;

  constructor(configuredSnapshot: string, reportedModel: string | null) {
    // Both identifiers remain available as structured diagnostics below. The
    // message is deliberately value-free because provider-reported identity is
    // untrusted text and exception messages legitimately reach eval output.
    super('Provider response could not be attributed to the configured pinned model snapshot.', {
      transient: false,
    });
    this.name = 'SemanticModelIdentityError';
    this.configured_snapshot = configuredSnapshot;
    this.reported_model = reportedModel;
  }
}
