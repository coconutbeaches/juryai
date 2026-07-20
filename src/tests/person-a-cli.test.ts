import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseExtractPersonAArgs,
  runExtractPersonACommand,
  type ExtractPersonACommandDependencies,
} from '../commands/extract-person-a.js';
import { validPersonAExtraction } from './person-a-test-helpers.js';

function inertDependencies(calls: string[]): ExtractPersonACommandDependencies {
  return {
    getEnvironment(name) {
      calls.push(`environment:${name}`);
      return undefined;
    },
    createClient() {
      calls.push('client');
      throw new Error('client construction must not occur');
    },
    async extract() {
      calls.push('network');
      throw new Error('extraction must not occur');
    },
  };
}

describe('Person A extraction CLI', () => {
  it.each([
    {
      name: 'misspelled replay option',
      argv: ['--extracton', 'saved.json'],
      message: 'Unknown option: --extracton',
    },
    {
      name: 'unknown option',
      argv: ['--surprise', 'value'],
      message: 'Unknown option: --surprise',
    },
    {
      name: 'duplicate extraction',
      argv: ['--extraction', 'one.json', '--extraction', 'two.json'],
      message: 'Duplicate option: --extraction',
    },
    {
      name: 'missing extraction value',
      argv: ['--extraction'],
      message: 'Missing value for --extraction',
    },
    {
      name: 'boolean assignment',
      argv: ['--fail-on-critical=true'],
      message: 'Unknown option: --fail-on-critical=true',
    },
    {
      name: 'boolean value',
      argv: ['--fail-on-critical', 'false'],
      message: 'Boolean flag --fail-on-critical does not accept a value',
    },
    {
      name: 'positional argument',
      argv: ['saved.json'],
      message: 'Unexpected positional or short argument: saved.json',
    },
    {
      name: 'short flag',
      argv: ['-e', 'saved.json'],
      message: 'Unexpected positional or short argument: -e',
    },
    {
      name: 'short flag as a value',
      argv: ['--model', '-x'],
      message: 'Missing value for --model',
    },
  ])('rejects $name before credentials or live setup', async ({ argv, message }) => {
    const calls: string[] = [];

    await expect(runExtractPersonACommand(argv, inertDependencies(calls))).rejects.toThrow(message);
    expect(calls).toEqual([]);
  });

  it('parses a valid explicit replay without selecting the live path', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'juryai-cli-replay-'));
    const extraction = validPersonAExtraction();
    const input = resolve(directory, 'input.txt');
    const replay = resolve(directory, 'extraction.json');
    const output = resolve(directory, 'output');
    await Promise.all([
      writeFile(input, extraction.submission.raw_text),
      writeFile(replay, JSON.stringify(extraction)),
    ]);
    const calls: string[] = [];
    const dependencies = inertDependencies(calls);
    dependencies.getEnvironment = (name) => {
      calls.push(`environment:${name}`);
      return name === 'JURYAI_REASONING_EFFORT' ? 'medium' : undefined;
    };

    await runExtractPersonACommand(
      [
        '--input',
        input,
        '--extraction',
        replay,
        '--output-dir',
        output,
        '--submitted-at',
        '2026-07-19T12:00:00Z',
      ],
      dependencies,
    );

    expect(calls).toEqual(['environment:JURYAI_REASONING_EFFORT']);
    expect(JSON.parse(await readFile(resolve(output, 'extraction.json'), 'utf8'))).toEqual(
      extraction,
    );
  });

  it('reaches the injected live path only after valid parsing succeeds', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'juryai-cli-live-'));
    const extraction = validPersonAExtraction();
    const input = resolve(directory, 'input.txt');
    const output = resolve(directory, 'output');
    await writeFile(input, extraction.submission.raw_text);
    const calls: string[] = [];
    const dependencies: ExtractPersonACommandDependencies = {
      getEnvironment(name) {
        calls.push(`environment:${name}`);
        if (name === 'JURYAI_REASONING_EFFORT') return 'medium';
        if (name === 'OPENAI_API_KEY') return 'test-key';
        return undefined;
      },
      createClient(apiKey) {
        calls.push(`client:${apiKey}`);
        return {
          async generate() {
            throw new Error('the injected extractor should own this test path');
          },
        };
      },
      async extract(options) {
        calls.push(`extract:${options.model}`);
        return { extraction, modelOutput: {}, rawResponse: {} };
      },
    };

    await runExtractPersonACommand(
      ['--input', input, '--output-dir', output, '--model', 'gpt-5.6'],
      dependencies,
    );

    expect(calls).toEqual([
      'environment:JURYAI_REASONING_EFFORT',
      'environment:OPENAI_API_KEY',
      'environment:OPENAI_BASE_URL',
      'client:test-key',
      'extract:gpt-5.6',
    ]);
  });

  it('keeps valid parser defaults and flags deterministic', () => {
    expect(parseExtractPersonAArgs(['--fail-on-critical'])).toMatchObject({
      model: 'gpt-5.6',
      failOnCritical: true,
    });
  });
});
