import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractResponseText, OpenAIResponsesClient } from '../extraction/openai-responses.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OpenAI Responses parsing', () => {
  it('reads structured output text from a message item', () => {
    const text = extractResponseText({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: '{"schema_version":"0.1.2"}' }],
        },
      ],
    });
    expect(text).toBe('{"schema_version":"0.1.2"}');
  });

  it('surfaces model refusals', () => {
    expect(() =>
      extractResponseText({
        output: [
          {
            type: 'message',
            content: [{ type: 'refusal', refusal: 'Cannot comply' }],
          },
        ],
      }),
    ).toThrow(/refused/i);
  });

  it('fails closed when no output text exists', () => {
    expect(() => extractResponseText({ output: [] })).toThrow(/did not contain/i);
  });

  it('sends GPT-5.6 medium unchanged and preserves the raw response', async () => {
    const structuredOutput = { schema_version: '0.1.2', claims: [] };
    const payload = {
      id: 'resp_test',
      model: 'gpt-5.6',
      usage: { input_tokens: 10, output_tokens: 20 },
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(structuredOutput) }],
        },
      ],
    };
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, any>;
      expect(body.model).toBe('gpt-5.6');
      expect(body.reasoning).toEqual({ effort: 'medium' });
      expect(body.store).toBe(false);
      expect(body.text.format.type).toBe('json_schema');
      expect(body.text.format.strict).toBe(true);
      return {
        ok: true,
        status: 200,
        json: async () => payload,
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAIResponsesClient('test-key', 'https://example.test/v1');
    const result = await client.generate({
      narrative: 'Synthetic narrative',
      model: 'gpt-5.6',
      reasoningEffort: 'medium',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.output).toEqual(structuredOutput);
    expect(result.rawResponse).toEqual(payload);
  });

  it('fails loudly when the configured model is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: false,
          status: 400,
          json: async () => ({ error: { message: 'Model gpt-5.6 is not available.' } }),
        }) as Response,
      ),
    );
    const client = new OpenAIResponsesClient('test-key', 'https://example.test/v1');

    await expect(
      client.generate({
        narrative: 'Synthetic narrative',
        model: 'gpt-5.6',
        reasoningEffort: 'medium',
      }),
    ).rejects.toThrow(/400.*gpt-5\.6.*not available/i);
  });
});
