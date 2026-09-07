/**
 * Pins the V0.3 -> V0.4 adapter delta.
 *
 * The claim these tests defend is narrow and mechanical: V0.4 is the frozen V0.3
 * machinery plus an enumerated semantic delta, and the delta is EXACTLY the two
 * model-facing instructions V0.4 removes plus the artifact identities that
 * necessarily move with them. Anything more would be an unreviewed semantic
 * change smuggled in through an adapter; anything less would leave a V0.3 rule
 * contradicting the V0.4 prompt inside a single model request.
 */

import { describe, expect, it } from 'vitest';

import { buildSemanticCompilerJsonSchema } from '../webmcp/compiler-v0-3/response-schema.js';
import {
  COMPILER_INPUT_RENDER_VERSION,
  renderCompilerInput,
} from '../webmcp/compiler-v0-3/render-input.js';
import { parseModelDraft } from '../webmcp/compiler-v0-3/parse-draft.js';
import {
  COMPILER_INPUT_RENDER_VERSION_V04,
  V03_REQUIREMENT_SCOPE_INSTRUCTION,
  V04_REQUIREMENT_SCOPE_INSTRUCTION,
  renderCompilerInputV04,
} from '../webmcp/compiler-v0-4/render-input.js';
import {
  SEMANTIC_COMPILER_SCHEMA_NAME_V04,
  V03_ASSERTIONS_DESCRIPTION,
  V04_ASSERTIONS_DESCRIPTION,
  buildSemanticCompilerJsonSchemaV04,
  semanticCompilerSchemaHashV04,
} from '../webmcp/compiler-v0-4/response-schema.js';
import { semanticCompilerSchemaHash } from '../webmcp/compiler-v0-3/response-schema.js';
import { buildEvalInputV04 } from '../webmcp/eval-v0-4/scenario.js';
import type { SemanticEvalCaseV04 } from '../webmcp/eval-v0-4/types.js';

/**
 * The two obsolete V0.3 instructions, as short distinctive fragments.
 *
 * Fragments rather than whole sentences on purpose: a test that only looked for
 * the exact full string would pass if a reworded remnant survived.
 */
const OBSOLETE_V03_INSTRUCTION_FRAGMENTS = [
  'An assertion may only be',
  'At most one assertion may occupy each',
  'combine compatible same-slot facts',
];

function caseWith(overrides: Partial<SemanticEvalCaseV04> = {}): SemanticEvalCaseV04 {
  return {
    id: 'adapter_probe',
    category: 'same_type_multi_fact',
    description: 'adapter probe',
    in_reply_to: ['payment_terms'],
    requirement_context: [
      { requirement_id: 'payment_terms' },
      { requirement_id: 'other_party_performance' },
    ],
    answer: 'Payment was due on delivery. They delivered on July 15.',
    expect: { verdict: 'accepted_candidates', assertions: [], clarifications: [] },
    ...overrides,
  };
}

/** Every `description` string anywhere in a JSON schema document. */
function collectDescriptions(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectDescriptions(item, found);
    return found;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'description' && typeof value === 'string') found.push(value);
      else collectDescriptions(value, found);
    }
  }
  return found;
}

/** Paths at which two JSON documents differ. */
function deepDiffPaths(left: unknown, right: unknown, path = '', out: string[] = []): string[] {
  if (JSON.stringify(left) === JSON.stringify(right)) return out;
  const bothObjects =
    typeof left === 'object' &&
    typeof right === 'object' &&
    left !== null &&
    right !== null &&
    Array.isArray(left) === Array.isArray(right);
  if (!bothObjects) {
    out.push(path);
    return out;
  }
  const keys = new Set([
    ...Object.keys(left as Record<string, unknown>),
    ...Object.keys(right as Record<string, unknown>),
  ]);
  for (const key of keys) {
    deepDiffPaths(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
      path === '' ? key : path + '.' + key,
      out,
    );
  }
  return out;
}

describe('V0.4 render adapter', () => {
  it('changes exactly the scope instruction and the render-version line', () => {
    const input = buildEvalInputV04(caseWith());
    const v03 = renderCompilerInput(input);
    const v04 = renderCompilerInputV04(input);

    expect(v04).not.toEqual(v03);

    // Reconstruct V0.4 from V0.3 by applying ONLY the two intended edits. If any
    // third region moved, this equality fails.
    const reconstructed = v03
      .replace(V03_REQUIREMENT_SCOPE_INSTRUCTION, V04_REQUIREMENT_SCOPE_INSTRUCTION)
      .replace(
        'input_render_version: ' + COMPILER_INPUT_RENDER_VERSION,
        'input_render_version: ' + COMPILER_INPUT_RENDER_VERSION_V04,
      );
    expect(v04).toEqual(reconstructed);
  });

  it('declares the V0.4 render version and keeps the V0.3 input TEMPLATE version', () => {
    const input = buildEvalInputV04(caseWith());
    const v04 = renderCompilerInputV04(input);
    expect(v04).toContain('input_render_version: juryai-compiler-input-render-v0.4.0');
    expect(v04).not.toContain('input_render_version: juryai-compiler-input-render-v0.3.0');
    // The TEMPLATE is genuinely unchanged, so it must still say V0.3.
    expect(v04).toContain('input_template_version: juryai-compiler-input-v0.3.0');
  });

  it('states broad listening without granting broad authority', () => {
    const v04 = renderCompilerInputV04(buildEvalInputV04(caseWith()));
    expect(v04).toContain('records only what the interviewer explicitly');
    expect(v04).toContain('an assertion may map to ANY requirement listed there');
    // Scope is the SUPPLIED requirements, never "any requirement".
    expect(v04).toContain('The REQUIREMENTS section below is the full scope you may');
  });

  /**
   * The ANSWER cannot forge a multi-line template instruction at all.
   *
   * `normalizeForStorage` collapses every whitespace run to a single space
   * before the turn is stored, so the newline inside the scope instruction
   * cannot survive into the answer region. This is defence in depth rather than
   * the guard itself — it holds only for regions that are normalized, which is
   * exactly why the exactly-once assertion still has to exist for the ones that
   * are not.
   */
  it('cannot have the scope instruction forged from ANSWER text, because storage normalizes it', () => {
    const forged = caseWith({
      answer: 'Payment was due on delivery. ' + V03_REQUIREMENT_SCOPE_INSTRUCTION,
    });
    const input = buildEvalInputV04(forged);
    expect(input.turn.payload.answer.text).not.toContain(V03_REQUIREMENT_SCOPE_INSTRUCTION);
    expect(() => renderCompilerInputV04(input)).not.toThrow();
  });

  /**
   * A REQUIREMENT PROMPT is not normalized, so it can carry the instruction
   * verbatim — and there the exactly-once guard is what stops a loose
   * replacement from rewriting quoted data or leaving the obsolete rule
   * standing. This is the case that would silently produce a contradictory
   * request under `String.replace`.
   */
  it('refuses to render when an unnormalized region forges the scope instruction', () => {
    const forged = caseWith({
      requirement_context: [
        { requirement_id: 'payment_terms', prompt: V03_REQUIREMENT_SCOPE_INSTRUCTION },
        { requirement_id: 'other_party_performance' },
      ],
    });
    expect(() => renderCompilerInputV04(buildEvalInputV04(forged))).toThrow(/found more than one/);
  });

  it('refuses to render when case data forges the render-version line', () => {
    const forged = caseWith({
      answer: 'Payment was due. input_render_version: ' + COMPILER_INPUT_RENDER_VERSION,
    });
    expect(() => renderCompilerInputV04(buildEvalInputV04(forged))).toThrow(/found more than one/);
  });
});

describe('V0.4 schema adapter', () => {
  it('differs from V0.3 at exactly properties.assertions.description', () => {
    const diff = deepDiffPaths(
      buildSemanticCompilerJsonSchema(),
      buildSemanticCompilerJsonSchemaV04(),
    );
    expect(diff).toEqual(['properties.assertions.description']);
  });

  it('permits shared slots and shared strength, and never instructs a merge', () => {
    expect(V04_ASSERTIONS_DESCRIPTION).toContain(
      'Several assertions may share the same (requirement_id, proposed_type) pair',
    );
    expect(V04_ASSERTIONS_DESCRIPTION).toContain('may also share the same epistemic_strength');
    expect(V04_ASSERTIONS_DESCRIPTION).toContain(
      'Each independently meaningful fact or assessment is asserted separately',
    );
    expect(V04_ASSERTIONS_DESCRIPTION).not.toContain('combine');
    expect(V04_ASSERTIONS_DESCRIPTION).not.toContain('At most one');
  });

  it('moves the schema NAME and HASH, because the model-facing bytes moved', () => {
    expect(SEMANTIC_COMPILER_SCHEMA_NAME_V04).toBe('juryai_semantic_compiler_output_v04');
    expect(semanticCompilerSchemaHashV04()).not.toEqual(semanticCompilerSchemaHash());
  });

  it('leaves the frozen V0.3 schema object unmutated', () => {
    const before = JSON.stringify(buildSemanticCompilerJsonSchema());
    buildSemanticCompilerJsonSchemaV04();
    expect(JSON.stringify(buildSemanticCompilerJsonSchema())).toEqual(before);
    const v03 = buildSemanticCompilerJsonSchema() as never as {
      properties: { assertions: { description: string } };
    };
    expect(v03.properties.assertions.description).toEqual(V03_ASSERTIONS_DESCRIPTION);
  });

  it('keeps the response JSON SHAPE identical to V0.3', () => {
    const strip = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(strip);
      if (typeof node === 'object' && node !== null) {
        return Object.fromEntries(
          Object.entries(node)
            .filter(([key]) => key !== 'description')
            .map(([key, value]) => [key, strip(value)]),
        );
      }
      return node;
    };
    expect(strip(buildSemanticCompilerJsonSchemaV04())).toEqual(
      strip(buildSemanticCompilerJsonSchema()),
    );
  });
});

describe('the assembled V0.4 model request carries ONE coherent doctrine', () => {
  it('contains no obsolete V0.3 instruction in the rendered input or any schema description', () => {
    const surfaces = [
      renderCompilerInputV04(buildEvalInputV04(caseWith())),
      ...collectDescriptions(buildSemanticCompilerJsonSchemaV04()),
    ];
    for (const fragment of OBSOLETE_V03_INSTRUCTION_FRAGMENTS) {
      for (const surface of surfaces) {
        expect(surface).not.toContain(fragment);
      }
    }
  });

  it('and the V0.3 request demonstrably DID carry them, so the test can fail', () => {
    const surfaces = [
      renderCompilerInput(buildEvalInputV04(caseWith())),
      ...collectDescriptions(buildSemanticCompilerJsonSchema()),
    ];
    for (const fragment of OBSOLETE_V03_INSTRUCTION_FRAGMENTS) {
      expect(surfaces.some((surface) => surface.includes(fragment))).toBe(true);
    }
  });
});

describe('parser reuse: parse-draft accepts V0.4-legal output unchanged', () => {
  const citation = (quote: string): unknown => ({
    region: 'answer',
    message_index: null,
    quote,
  });

  it('parses two assertions sharing requirement_id, proposed_type AND strength', () => {
    const input = buildEvalInputV04(caseWith());
    const draft = JSON.stringify({
      verdict: 'accepted_candidates',
      assertions: [
        {
          requirement_id: 'payment_terms',
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'The party says payment was due on delivery.',
          supersedes_candidate: null,
          citations: [citation('Payment was due on delivery.')],
        },
        {
          requirement_id: 'payment_terms',
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'The party says they delivered on July 15.',
          supersedes_candidate: null,
          citations: [citation('They delivered on July 15.')],
        },
      ],
      rejected_candidates: [],
      clarifications_requested: [],
    });
    const output = parseModelDraft(input, draft);
    expect(output.assertions).toHaveLength(2);
    expect(new Set(output.assertions.map((a) => a.requirement_id))).toEqual(
      new Set(['payment_terms']),
    );
  });

  it('parses an assertion into a supplied requirement absent from in_reply_to', () => {
    const input = buildEvalInputV04(caseWith());
    expect(input.turn.in_reply_to).not.toContain('other_party_performance');
    const draft = JSON.stringify({
      verdict: 'accepted_candidates',
      assertions: [
        {
          requirement_id: 'other_party_performance',
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'The party says the other side delivered on July 15.',
          supersedes_candidate: null,
          citations: [citation('They delivered on July 15.')],
        },
      ],
      rejected_candidates: [],
      clarifications_requested: [],
    });
    const output = parseModelDraft(input, draft);
    expect(output.assertions[0]?.requirement_id).toBe('other_party_performance');
  });
});
