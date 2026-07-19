import { buildOpenAIResponseSchema } from './person-a-schema.js';
import { PERSON_A_EXTRACTION_INSTRUCTIONS } from './person-a-prompt.js';

type JsonObject = Record<string, any>;

export type StructuredExtractionRequest = {
  narrative: string;
  model: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
};

export interface StructuredExtractionClient {
  generate(request: StructuredExtractionRequest): Promise<JsonObject>;
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

export class OpenAIResponsesClient implements StructuredExtractionClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for live extraction.');
  }

  async generate(request: StructuredExtractionRequest): Promise<JsonObject> {
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        instructions: PERSON_A_EXTRACTION_INSTRUCTIONS,
        input: request.narrative,
        reasoning: { effort: request.reasoningEffort ?? 'high' },
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

    const payload = (await response.json()) as JsonObject;
    if (!response.ok) {
      const message = payload.error?.message ?? JSON.stringify(payload);
      throw new Error(`OpenAI Responses API failed (${response.status}): ${message}`);
    }

    const text = extractResponseText(payload);
    try {
      return JSON.parse(text) as JsonObject;
    } catch (error) {
      throw new Error(
        `OpenAI structured output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
