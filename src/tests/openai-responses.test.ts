import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractResponseText, OpenAIResponsesClient } from '../extraction/openai-responses.js';
import { buildOpenAIResponseSchema } from '../extraction/person-a-schema.js';

type SchemaNode = Record<string, unknown>;

function collectSchemaNodes(value: unknown, path = '#'): Array<{ node: SchemaNode; path: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectSchemaNodes(entry, `${path}/${index}`));
  }
  if (!value || typeof value !== 'object') return [];

  const node = value as SchemaNode;
  return [
    { node, path },
    ...Object.entries(node).flatMap(([key, child]) =>
      collectSchemaNodes(child, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`),
    ),
  ];
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OpenAI Responses parsing', () => {
  it('uses explicit matching types for every const in the recursively assembled schema', () => {
    const issues = collectSchemaNodes(buildOpenAIResponseSchema()).flatMap(({ node, path }) => {
      if (!Object.hasOwn(node, 'const')) return [];
      const declaredTypes = Array.isArray(node.type) ? node.type : [node.type];
      const actualType = jsonTypeOf(node.const);
      const compatibleTypes = actualType === 'integer' ? ['integer', 'number'] : [actualType];
      return compatibleTypes.some((type) => declaredTypes.includes(type))
        ? []
        : [`${path}: const is ${actualType}`];
    });

    expect(issues).toEqual([]);
  });

  it('preserves canonical date formats in the recursively assembled schema', () => {
    expect(buildOpenAIResponseSchema()).toMatchObject({
      $defs: {
        dateValue: {
          properties: {
            start: { format: 'date' },
            end: { format: 'date' },
          },
        },
        isoDateTimeOrNull: { format: 'date-time' },
      },
    });
  });

  it('constrains Person A agreement statuses and documents exact UTF-16 source spans', () => {
    expect(buildOpenAIResponseSchema()).toMatchObject({
      $defs: {
        agreementTerm: {
          properties: {
            wording_status: {
              type: 'string',
              const: 'not_inspected',
            },
            interpretation_status: {
              type: 'string',
              enum: ['unclear', 'not_applicable'],
            },
          },
        },
        sourceSpan: {
          description: expect.stringContaining('UTF-16'),
          properties: {
            quote: {
              description: expect.stringContaining('exact contiguous substring'),
            },
            start_char: {
              description: expect.stringContaining('UTF-16'),
            },
            end_char: {
              description: expect.stringContaining('start_char + quote.length'),
            },
          },
        },
      },
    });
  });

  it('meets documented strict Structured Outputs object requirements', () => {
    const schema = buildOpenAIResponseSchema();
    const issues = collectSchemaNodes(schema).flatMap(({ node, path }) => {
      if (node.type !== 'object') return [];
      const properties =
        node.properties && typeof node.properties === 'object'
          ? Object.keys(node.properties as SchemaNode)
          : [];
      const required = Array.isArray(node.required) ? node.required : [];
      const missingRequired = properties.filter((property) => !required.includes(property));
      return [
        ...(node.additionalProperties === false
          ? []
          : [`${path}: additionalProperties must be false`]),
        ...(missingRequired.length === 0
          ? []
          : [`${path}: missing required ${missingRequired.join(', ')}`]),
      ];
    });

    expect(schema.type).toBe('object');
    expect(schema).not.toHaveProperty('anyOf');
    expect(issues).toEqual([]);
  });

  it('omits unsupported composition keywords from the recursively assembled schema', () => {
    const unsupported = new Set([
      'allOf',
      'not',
      'dependentRequired',
      'dependentSchemas',
      'if',
      'then',
      'else',
    ]);
    const issues = collectSchemaNodes(buildOpenAIResponseSchema()).flatMap(({ node, path }) =>
      Object.keys(node)
        .filter((key) => unsupported.has(key))
        .map((key) => `${path}/${key}`),
    );

    expect(issues).toEqual([]);
  });

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
      expect(body.instructions).toContain('UTF-16 code-unit indices');
      expect(body.instructions).toContain('end_char = start_char + quote.length');
      expect(body.instructions).toContain('wording_status not_inspected');
      expect(body.instructions).toContain('interpretation_status unclear or not_applicable');
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
      vi.fn(
        async () =>
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
