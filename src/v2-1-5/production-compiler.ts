import {
  OpenAiResponsesSemanticModelClient,
  DEFAULT_OPENAI_BASE_URL,
} from '../webmcp/compiler/openai-responses-client.js';
import { ModelSemanticCompilerV04 } from '../webmcp/compiler-v0-4/model-compiler.js';
import { assertQualifiedCompiler } from './compiler-contract.js';

/** Fixed qualified configuration; credentials do not affect semantic identity. */
export function createProductionCompilerV215(input: {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): ModelSemanticCompilerV04 {
  const apiKey = input.env.JURYAI_COMPILER_API_KEY ?? input.env.OPENAI_API_KEY;
  if (!apiKey) throw new TypeError('A semantic-compiler API key is required.');
  const compiler = new ModelSemanticCompilerV04({
    client: new OpenAiResponsesSemanticModelClient({
      apiKey,
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      fetchImpl: input.fetchImpl,
    }),
    model_id: 'gpt-5.6-sol',
    model_snapshot: null,
    decoding: { temperature: 0, top_p: null, max_output_tokens: 8192, seed: null },
    omit_sampling_params: true,
    retain_raw_output: false,
  });
  assertQualifiedCompiler(compiler.registryEntry);
  return compiler;
}
