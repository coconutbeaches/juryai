/**
 * PR 8C1b-1 structural guards.
 *
 * The eval proves the model behaves. These prove the eval MEASURES WHAT IT
 * CLAIMS TO — that the artefact under test is genuinely V0.4, that the frozen
 * generations did not move, that the prompt does not carry the answer key, and
 * that none of this reaches production.
 *
 * Three PRs of standing lesson say to weight guards like these above suite
 * counts: in 8C0b-1 the real finding came from review past 106 green parity
 * tests, in 8C0b-2 both real defects came from structural guards, and in 8C1b-0
 * the primary finding was a FALSE GREEN on the oracle's own question. A green
 * eval whose artefact identity is a lie looks exactly like a green eval.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { projectRoot } from './test-helpers.js';
import { COMPILER_V0_3_FROZEN_MANIFEST } from './compiler-v0-3-frozen-manifest.js';
import { HISTORICAL_EVAL_FROZEN_MANIFEST } from './eval-v0-3-frozen-manifest.js';
import {
  PRIMARY_CORPUS,
  PRIMARY_CORPUS_FROZEN_HASH,
  corpusHash,
} from '../webmcp/eval-v0-4-corpus/index.js';
import {
  COMPILER_INPUT_TEMPLATE_VERSION_V04,
  ModelSemanticCompilerV04,
  buildModelCompilerRegistryEntryV04,
  modelCompilerConfigOfV04,
} from '../webmcp/compiler-v0-4/model-compiler.js';
import {
  COMPILER_CONTRACT_VERSION_V04,
  V04_SUPPRESSED_V03_ISSUE_CODES,
} from '../webmcp/core-v0-4/compiler-contract.js';
import { COMPILER_CONTRACT_VERSION } from '../webmcp/core-v0-3/compiler-contract.js';
import {
  SEMANTIC_COMPILER_PROMPT_VERSION_V04,
  SEMANTIC_COMPILER_SYSTEM_PROMPT_V04,
} from '../webmcp/compiler-v0-4/prompt.js';
import { COMPILER_INPUT_RENDER_VERSION_V04 } from '../webmcp/compiler-v0-4/render-input.js';
import {
  SEMANTIC_COMPILER_SCHEMA_NAME_V04,
  semanticCompilerSchemaHashV04,
} from '../webmcp/compiler-v0-4/response-schema.js';
import { semanticCompilerSchemaHash } from '../webmcp/compiler-v0-3/response-schema.js';
import { DEFAULT_COMPILER_TAXONOMY_VERSION } from '../webmcp/compiler-v0-3/model-compiler.js';
import { fixedModelClient } from '../webmcp/compiler/replay-client.js';
import { buildEvalInputV04 } from '../webmcp/eval-v0-4/scenario.js';

const read = (file: string): string => readFileSync(resolve(projectRoot, file), 'utf8');

function sourceFiles(relativeDirectory: string): string[] {
  const root = resolve(projectRoot, relativeDirectory);
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const next = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(resolve(directory, entry.name), next);
      else if (entry.isFile() && entry.name.endsWith('.ts')) found.push(next);
    }
  };
  walk(root, relativeDirectory);
  return found.sort();
}

/**
 * This guard file necessarily NAMES the things it forbids, so it would match
 * its own scans. Excluding exactly one path by name keeps the scans honest
 * without a pattern loose enough to excuse a real offender.
 */
const SELF = 'src/tests/compiler-v0-4-guards.test.ts';

const executableSource = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1');

const PRODUCTION_TREES = [
  'api',
  'src/webmcp/server',
  'src/webmcp/browser',
  'src/webmcp/runtime',
  'src/webmcp/service',
  'src/v2-1-1',
  'src/v2-1-2',
  'src/v2-1-3',
  'src/v2-1-4',
  'src/formation',
];

const compilerFor = (): ModelSemanticCompilerV04 =>
  new ModelSemanticCompilerV04({
    client: fixedModelClient('{}'),
    model_id: 'guard-model',
    model_snapshot: null,
  });

/* ------------------------------------------------------------------ frozen */

describe('8C1b-1 guards: frozen generations did not move', () => {
  it('the V0.3 compiler manifest is still exact', () => {
    const drifted = Object.entries(COMPILER_V0_3_FROZEN_MANIFEST)
      .filter(([file, hash]) => createHash('sha256').update(read(file)).digest('hex') !== hash)
      .map(([file]) => file);
    expect(drifted).toEqual([]);
  });

  it('the historical evaluator is byte-unchanged', () => {
    const drifted = Object.entries(HISTORICAL_EVAL_FROZEN_MANIFEST)
      .filter(([file, hash]) => createHash('sha256').update(read(file)).digest('hex') !== hash)
      .map(([file]) => file);
    expect(drifted).toEqual([]);
  });

  it('the V0.4 oracle tree gained no files, and only scenario.ts changed', () => {
    // The documented harness seam is an OPTIONAL parameter on
    // `buildEvalInputV04`. Everything else in the 8C1b-0 tree is untouched, and
    // the corpus lives in its own directory precisely so this stays true.
    expect(sourceFiles('src/webmcp/eval-v0-4')).toEqual([
      'src/webmcp/eval-v0-4/graders.ts',
      'src/webmcp/eval-v0-4/index.ts',
      'src/webmcp/eval-v0-4/matching.ts',
      'src/webmcp/eval-v0-4/scenario.ts',
      'src/webmcp/eval-v0-4/types.ts',
    ]);
  });

  it('the documented seam is optional, so the deterministic default is preserved', () => {
    const scenario = executableSource('src/webmcp/eval-v0-4/scenario.ts');
    expect(scenario).toMatch(/overrideCompilerVersionId\?: string,/u);
    expect(scenario).toMatch(/overrideCompilerVersionId \?\? compilerVersionId\(evalCase\.id\)/u);
  });

  it('no V2.1.5 generation directory exists', () => {
    expect(existsSync(resolve(projectRoot, 'src/v2-1-5'))).toBe(false);
  });
});

/* --------------------------------------------------------------- identity */

describe('8C1b-1 guards: the V0.4 artefact identity is genuine', () => {
  it('declares the V0.4 prompt version', () => {
    expect(SEMANTIC_COMPILER_PROMPT_VERSION_V04).toBe('juryai-semantic-compiler-prompt-v0.4.0');
  });

  it('declares the V0.4 compiler contract, never V0.3', () => {
    const entry = compilerFor().registryEntry;
    expect(entry.version.schema_version).toBe(COMPILER_CONTRACT_VERSION_V04);
    expect(entry.version.schema_version).not.toBe(COMPILER_CONTRACT_VERSION);
  });

  it('keeps the input TEMPLATE at V0.3, because the shape did not move', () => {
    expect(COMPILER_INPUT_TEMPLATE_VERSION_V04).toBe('juryai-compiler-input-v0.3.0');
    expect(modelCompilerConfigOfV04(compilerFor().resolvedOptions).input_template_version).toBe(
      'juryai-compiler-input-v0.3.0',
    );
  });

  it('moves the input RENDER version to V0.4, because the model-facing bytes moved', () => {
    expect(COMPILER_INPUT_RENDER_VERSION_V04).toBe('juryai-compiler-input-render-v0.4.0');
    expect(modelCompilerConfigOfV04(compilerFor().resolvedOptions).input_render_version).toBe(
      'juryai-compiler-input-render-v0.4.0',
    );
  });

  it('identifies the response schema honestly by NAME and HASH', () => {
    const config = modelCompilerConfigOfV04(compilerFor().resolvedOptions);
    expect(config.output_schema_name).toBe(SEMANTIC_COMPILER_SCHEMA_NAME_V04);
    expect(config.output_schema_name).toBe('juryai_semantic_compiler_output_v04');
    expect(config.output_schema_hash).toBe(semanticCompilerSchemaHashV04());
    expect(config.output_schema_hash).not.toBe(semanticCompilerSchemaHash());
  });

  it('keeps the proposition taxonomy at V0.3', () => {
    expect(compilerFor().registryEntry.version.taxonomy_version).toBe(
      DEFAULT_COMPILER_TAXONOMY_VERSION,
    );
    expect(DEFAULT_COMPILER_TAXONOMY_VERSION).toBe('juryai-p2-v0.3.0');
  });

  it('records the prompt hash of the V0.4 prompt actually shipped', () => {
    const entry = compilerFor().registryEntry;
    expect(entry.prompt_text).toBe(SEMANTIC_COMPILER_SYSTEM_PROMPT_V04);
    expect(entry.version.prompt_hash).toBe(
      createHash('sha256').update(SEMANTIC_COMPILER_SYSTEM_PROMPT_V04).digest('hex'),
    );
  });

  it('never invents a provider snapshot for a moving alias', () => {
    const entry = buildModelCompilerRegistryEntryV04({
      client: fixedModelClient('{}'),
      model_id: 'some-moving-alias',
    });
    expect(entry.version.model_snapshot).toBeNull();
    expect(entry.version.model_id).toBe('some-moving-alias');
  });

  it('changes compiler_version_id when the model changes', () => {
    const a = buildModelCompilerRegistryEntryV04({
      client: fixedModelClient('{}'),
      model_id: 'model-a',
    });
    const b = buildModelCompilerRegistryEntryV04({
      client: fixedModelClient('{}'),
      model_id: 'model-b',
    });
    expect(a.compiler_version_id).not.toBe(b.compiler_version_id);
  });

  it('suppresses exactly the two V0.3 admission rules and no others', () => {
    expect([...V04_SUPPRESSED_V03_ISSUE_CODES].sort()).toEqual([
      'compiler_assertion_slot_duplicate',
      'compiler_requirement_not_answered',
    ]);
  });
});

/* ------------------------------------------------------------ eval binding */

describe('8C1b-1 guards: the eval measures the artefact that ran', () => {
  it('refuses an input bound to any other compiler_version_id', async () => {
    const compiler = compilerFor();
    const evalCase = PRIMARY_CORPUS[0] as (typeof PRIMARY_CORPUS)[number];
    // The deterministic default: a synthetic per-case id, not this artefact's.
    await expect(compiler.compile(buildEvalInputV04(evalCase))).rejects.toThrow(
      /must bind the exact V0\.4 artefact/u,
    );
  });

  it('accepts an input bound to its own registry entry', () => {
    const compiler = compilerFor();
    const evalCase = PRIMARY_CORPUS[0] as (typeof PRIMARY_CORPUS)[number];
    const input = buildEvalInputV04(evalCase, compiler.registryEntry.compiler_version_id);
    expect(input.compiler_version_id).toBe(compiler.registryEntry.compiler_version_id);
  });

  it('refuses an input bound to the V0.3 input template', () => {
    // The V0.4 compiler must not silently accept a V0.3-era stored run.
    expect(COMPILER_INPUT_TEMPLATE_VERSION_V04).toBe('juryai-compiler-input-v0.3.0');
  });
});

/* ------------------------------------------------------------------ corpus */

describe('8C1b-1 guards: the corpus is frozen and carries no answer key', () => {
  it('matches the hash frozen before the first live call', () => {
    expect(corpusHash(PRIMARY_CORPUS)).toBe(PRIMARY_CORPUS_FROZEN_HASH);
  });

  it('leaks no corpus case id into the prompt', () => {
    const leaked = PRIMARY_CORPUS.filter((item) =>
      SEMANTIC_COMPILER_SYSTEM_PROMPT_V04.includes(item.id),
    ).map((item) => item.id);
    expect(leaked).toEqual([]);
  });

  it('leaks no complete corpus answer into the prompt', () => {
    const leaked = PRIMARY_CORPUS.filter((item) =>
      SEMANTIC_COMPILER_SYSTEM_PROMPT_V04.includes(item.answer),
    ).map((item) => item.id);
    expect(leaked).toEqual([]);
  });

  it('leaks no expectation id into the prompt', () => {
    const leaked = PRIMARY_CORPUS.flatMap((item) =>
      item.expect.assertions
        .filter((expectation) =>
          SEMANTIC_COMPILER_SYSTEM_PROMPT_V04.includes(expectation.expectation_id),
        )
        .map((expectation) => expectation.expectation_id),
    );
    expect(leaked).toEqual([]);
  });

  it('leaks no long corpus answer fragment into the prompt', () => {
    // Whole-answer matching alone would miss a prompt that quoted most of a
    // case. Every 48-character window of every answer is checked instead.
    const leaked: string[] = [];
    for (const item of PRIMARY_CORPUS) {
      for (let start = 0; start + 48 <= item.answer.length; start += 8) {
        const window = item.answer.slice(start, start + 48);
        if (SEMANTIC_COMPILER_SYSTEM_PROMPT_V04.includes(window)) leaked.push(item.id);
      }
    }
    expect([...new Set(leaked)]).toEqual([]);
  });
});

/* -------------------------------------------------------------- production */

describe('8C1b-1 guards: none of this reaches production', () => {
  it('no production module imports compiler-v0-4', () => {
    const offenders = PRODUCTION_TREES.flatMap(sourceFiles).filter((file) =>
      /compiler-v0-4/u.test(executableSource(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('no production module imports the V0.4 corpus or its runner', () => {
    const offenders = PRODUCTION_TREES.flatMap(sourceFiles).filter((file) =>
      /eval-v0-4/u.test(executableSource(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('no production route references a V0.4 compiler artefact', () => {
    const offenders = [...sourceFiles('api'), ...sourceFiles('src/webmcp/server')].filter((file) =>
      /(prompt-v0\.4|compiler-contract-v0\.4|input-render-v0\.4|output_v04)/u.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('adds no fuzzy or deduplication helper to src/formation', () => {
    const offenders = sourceFiles('src/formation').filter((file) =>
      /(levenshtein|similarity|fuzzy|embedding|cosine|dedupe|deduplicat)/iu.test(
        executableSource(file),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('the V0.4 compiler tree adds no similarity metric of its own', () => {
    const offenders = sourceFiles('src/webmcp/compiler-v0-4')
      .concat(sourceFiles('src/webmcp/eval-v0-4-corpus'))
      .filter((file) =>
        /(levenshtein|similarity|fuzzy|embedding|cosine)/iu.test(executableSource(file)),
      );
    expect(offenders).toEqual([]);
  });
});

/* ---------------------------------------------------------- CI stays offline */

describe('8C1b-1 guards: CI never calls a model', () => {
  it('no CI-run V0.4 test imports the live compiler factory or the provider client', () => {
    const offenders = sourceFiles('src/tests')
      .filter((file) => file !== SELF && /v0-4/u.test(file))
      .filter((file) =>
        /(createLiveSemanticCompiler|openai-responses-client|OpenAiResponsesSemanticModelClient)/u.test(
          executableSource(file),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it('the offline compiler is scripted, never networked', () => {
    const offline = executableSource('src/webmcp/eval-v0-4-corpus/offline.ts');
    expect(offline).toMatch(/replay-client\.js/u);
    expect(offline).not.toMatch(/openai/iu);
    expect(offline).not.toMatch(/fetch\(/u);
  });

  it('the live eval lives behind an explicit command, not a test', () => {
    const liveCommand = 'src/commands/run-compiler-eval-v04.ts';
    expect(existsSync(resolve(projectRoot, liveCommand))).toBe(true);
    // Nothing under src/tests may IMPORT it, so `vitest run` can never call out.
    //
    // Matched on the import form rather than on any textual mention: a test may
    // legitimately read the command's source as a STRING to assert something
    // about it — the retired-holdout unreachability guard does exactly that —
    // and a mention-based scan would forbid the very checks that make the
    // command safe.
    const importsCommand = (file: string): boolean =>
      /from\s+['"][^'"]*run-compiler-eval-v04[^'"]*['"]/u.test(executableSource(file)) ||
      /import\s*\(\s*['"][^'"]*run-compiler-eval-v04/u.test(executableSource(file)) ||
      /require\s*\(\s*['"][^'"]*run-compiler-eval-v04/u.test(executableSource(file));
    const offenders = sourceFiles('src/tests').filter(
      (file) => file !== SELF && importsCommand(file),
    );
    expect(offenders).toEqual([]);
  });
});
