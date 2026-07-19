import { describe, expect, it } from 'vitest';
import { extractResponseText } from '../extraction/openai-responses.js';

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
});
