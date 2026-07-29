import { createHash } from 'node:crypto';
import { buildOpenAIResponseSchema } from './person-a-schema.js';
import { PERSON_A_EXTRACTION_INSTRUCTIONS } from './person-a-prompt.js';

type JsonObject = Record<string, any>;

export type StructuredExtractionRequest = {
  narrative: string;
  model: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
};

export type StructuredExtractionResult = {
  output: JsonObject;
  rawResponse: JsonObject;
};

export type RawStructuredExtractionResult = {
  status: number;
  ok: boolean;
  body: Uint8Array;
};

export interface StructuredExtractionClient {
  generate(request: StructuredExtractionRequest): Promise<StructuredExtractionResult>;
}

export interface RawStructuredExtractionClient {
  requestRaw(request: StructuredExtractionRequest): Promise<RawStructuredExtractionResult>;
}

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export type OpenAIResponsesEndpointIdentity = {
  endpoint: string;
  sha256: string;
};

export function openAIResponsesEndpointIdentity(
  baseUrl = DEFAULT_OPENAI_BASE_URL,
): OpenAIResponsesEndpointIdentity {
  if (/[?#]/u.test(baseUrl)) {
    throw new Error('OPENAI_BASE_URL must not contain a query or fragment delimiter.');
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('OPENAI_BASE_URL must be a valid absolute URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('OPENAI_BASE_URL must use HTTPS.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('OPENAI_BASE_URL must not contain credentials, a query, or a fragment.');
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, '')}/responses`;
  const endpoint = parsed.toString();
  return {
    endpoint,
    sha256: createHash('sha256').update(endpoint, 'utf8').digest('hex'),
  };
}

export function decodeRawOpenAIResponse(body: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new Error('OpenAI response body was not valid UTF-8.');
  }
}

export function parseRawOpenAIResponse(body: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (error) {
    throw new Error(
      `OpenAI response body was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OpenAI response was not a JSON object.');
  }
  return parsed as JsonObject;
}

export function extractResponseText(response: unknown): string {
  if (!response || typeof response !== 'object') {
    throw new Error('OpenAI response was not a JSON object.');
  }
  const object = response as JsonObject;
  if (typeof object.output_text === 'string' && object.output_text.length > 0) {
    return object.output_text;
  }

  for (const item of Array.isArray(object.output) ? object.output : []) {
    if (item?.type !== 'message') continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content?.type === 'refusal') {
        throw new Error(
          `OpenAI refused the extraction request: ${content.refusal ?? 'unknown reason'}`,
        );
      }
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }

  throw new Error('OpenAI response did not contain structured output text.');
}

export class OpenAIResponsesClient
  implements StructuredExtractionClient, RawStructuredExtractionClient
{
  private readonly endpoint: string;

  constructor(
    private readonly apiKey: string,
    baseUrl = DEFAULT_OPENAI_BASE_URL,
  ) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for live extraction.');
    this.endpoint = openAIResponsesEndpointIdentity(baseUrl).endpoint;
  }

  async requestRaw(request: StructuredExtractionRequest): Promise<RawStructuredExtractionResult> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        instructions: PERSON_A_EXTRACTION_INSTRUCTIONS,
        input: request.narrative,
        reasoning: { effort: request.reasoningEffort ?? 'medium' },
        store: false,
        text: {
          format: {
            type: 'json_schema',
            name: 'juryai_person_a_extraction',
            description: 'Person A-derived JuryAI v0.1.2 case-record objects.',
            strict: true,
            schema: buildOpenAIResponseSchema(),
          },
        },
      }),
    });

    return {
      status: response.status,
      ok: response.ok,
      body: new Uint8Array(await response.arrayBuffer()),
    };
  }

  async generate(request: StructuredExtractionRequest): Promise<StructuredExtractionResult> {
    const raw = await this.requestRaw(request);
    const payload = parseRawOpenAIResponse(decodeRawOpenAIResponse(raw.body));
    if (!raw.ok) {
      const message = payload.error?.message ?? JSON.stringify(payload);
      throw new Error(`OpenAI Responses API failed (${raw.status}): ${message}`);
    }

    const text = extractResponseText(payload);
    try {
      return {
        output: JSON.parse(text) as JsonObject,
        rawResponse: payload,
      };
    } catch (error) {
      throw new Error(
        `OpenAI structured output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
