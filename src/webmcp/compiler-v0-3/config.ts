/**
 * Environment-driven construction of the live compiler.
 *
 * Secrets are read from the environment and never defaulted, never logged and
 * never written into the compiler artefact — the config records only a hash of
 * the endpoint, so the registry can prove two runs addressed the same place
 * without storing where that is.
 *
 * A missing key is a hard, explicit failure. Silently degrading to an offline
 * compiler when a live one was asked for would let an eval report success for
 * a run that never contacted a model.
 */

import {
  OpenAiResponsesSemanticModelClient,
  DEFAULT_OPENAI_BASE_URL,
} from '../compiler/openai-responses-client.js';
import {
  DEFAULT_COMPILER_DECODING,
  ModelSemanticCompiler,
  type ModelSemanticCompilerOptions,
} from './model-compiler.js';
import type { CompilerDecodingConfig } from '../core-v0-3/compiler-contract.js';

export const COMPILER_ENV = {
  apiKey: 'JURYAI_COMPILER_API_KEY',
  fallbackApiKey: 'OPENAI_API_KEY',
  baseUrl: 'JURYAI_COMPILER_BASE_URL',
  model: 'JURYAI_COMPILER_MODEL',
  snapshot: 'JURYAI_COMPILER_MODEL_SNAPSHOT',
  maxOutputTokens: 'JURYAI_COMPILER_MAX_OUTPUT_TOKENS',
  omitSampling: 'JURYAI_COMPILER_OMIT_SAMPLING_PARAMS',
  retainRaw: 'JURYAI_COMPILER_RETAIN_RAW_OUTPUT',
} as const;

export class CompilerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompilerConfigurationError';
  }
}

export type CompilerEnvironment = Record<string, string | undefined>;

function requireValue(env: CompilerEnvironment, names: readonly string[], what: string): string {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  throw new CompilerConfigurationError(
    what + ' is required; set ' + names.join(' or ') + ' in the environment.',
  );
}

function booleanFlag(env: CompilerEnvironment, name: string): boolean {
  const value = env[name];
  return value === '1' || value === 'true';
}

function positiveIntegerOr(
  env: CompilerEnvironment,
  name: string,
  fallback: number | null,
): number | null {
  const value = env[name];
  if (value === undefined || value.length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CompilerConfigurationError(name + ' must be a positive integer.');
  }
  return parsed;
}

export interface LiveCompilerOptions {
  env?: CompilerEnvironment;
  fetchImpl?: typeof fetch;
  decoding?: CompilerDecodingConfig;
  /** Extra options merged last, for callers that build the compiler directly. */
  overrides?: Partial<ModelSemanticCompilerOptions>;
}

/**
 * Builds the live model-backed compiler, or throws a configuration error that
 * says exactly what is missing.
 */
export function createLiveSemanticCompiler(
  options: LiveCompilerOptions = {},
): ModelSemanticCompiler {
  const env = options.env ?? process.env;
  const apiKey = requireValue(
    env,
    [COMPILER_ENV.apiKey, COMPILER_ENV.fallbackApiKey],
    'A semantic-compiler API key',
  );
  const modelId = requireValue(env, [COMPILER_ENV.model], 'A semantic-compiler model id');
  const baseUrl = env[COMPILER_ENV.baseUrl] ?? DEFAULT_OPENAI_BASE_URL;

  const client = new OpenAiResponsesSemanticModelClient({
    apiKey,
    baseUrl,
    fetchImpl: options.fetchImpl,
  });

  const decoding: CompilerDecodingConfig = options.decoding ?? {
    ...DEFAULT_COMPILER_DECODING,
    max_output_tokens: positiveIntegerOr(
      env,
      COMPILER_ENV.maxOutputTokens,
      DEFAULT_COMPILER_DECODING.max_output_tokens,
    ),
  };

  const snapshot = env[COMPILER_ENV.snapshot];
  return new ModelSemanticCompiler({
    client,
    model_id: modelId,
    // Only ever what the operator explicitly pinned. The model id is NOT
    // copied here: an alias wearing a snapshot field is a false claim of
    // reproducibility.
    model_snapshot: snapshot !== undefined && snapshot.length > 0 ? snapshot : null,
    decoding,
    omit_sampling_params: booleanFlag(env, COMPILER_ENV.omitSampling),
    retain_raw_output: booleanFlag(env, COMPILER_ENV.retainRaw),
    ...options.overrides,
  });
}
