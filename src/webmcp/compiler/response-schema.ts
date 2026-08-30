/**
 * The provider-native structured-output schema.
 *
 * This is CONVENIENCE. It narrows what the model can emit and removes a whole
 * class of parse failures; it is not a validation layer and nothing downstream
 * is relaxed because it exists. `parseModelDraft` re-checks every field the
 * schema claims to guarantee, and the runtime then re-checks the assembled
 * output against the core contract independently of both.
 *
 * Two deliberate omissions from what the model may emit:
 *
 *  - No `assertion_id`. Ids are minted by the compiler, positionally, so a
 *    model cannot collide two assertions or reuse an id it saw in the input.
 *  - No span OFFSETS. The model returns QUOTATIONS; this compiler resolves
 *    them into UTF-16 spans against the stored turn. Asking a language model
 *    for character arithmetic and then trusting it is how ungrounded spans get
 *    built. A quotation either occurs exactly in the stored text or the compile
 *    fails.
 *
 * Written for the strict JSON Schema subset: every object closed with
 * `additionalProperties: false`, every declared property listed in `required`,
 * optionality expressed only as an explicit null union.
 */

import {
  EPISTEMIC_STRENGTHS,
  PROPOSITION_TYPES,
  sha256,
  canonicalSerialize,
} from '../core/types.js';
import type { JsonValue } from '../core/types.js';

export const SEMANTIC_COMPILER_SCHEMA_NAME = 'juryai_semantic_compiler_output';

const AMBIGUITY_REASONS = [
  'answer_does_not_address_requirement',
  'multiple_incompatible_readings',
  'epistemic_strength_indeterminate',
  'contradicts_existing_proposition',
  'type_classification_indeterminate',
] as const;

function citationSchema(): JsonValue {
  return {
    type: 'array',
    description:
      'Exact quotations from the supplied turn. Offsets are computed by JuryAI, not by you.',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['region', 'message_index', 'quote'],
      properties: {
        region: {
          type: 'string',
          enum: ['answer', 'context'],
          description: "'answer' is the human's words; 'context' is relayed assistant text.",
        },
        message_index: {
          type: ['integer', 'null'],
          description: "Zero-based context message index; must be null when region is 'answer'.",
        },
        quote: {
          type: 'string',
          description: 'A character-for-character substring of the cited text.',
        },
      },
    },
  } as JsonValue;
}

export function buildSemanticCompilerJsonSchema(): JsonValue {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'assertions', 'rejected_candidates', 'clarifications_requested'],
    properties: {
      verdict: {
        type: 'string',
        enum: ['accepted_candidates', 'ambiguous', 'no_assertions'],
      },
      assertions: {
        type: 'array',
        description: 'Must be empty unless verdict is accepted_candidates.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'requirement_id',
            'proposed_type',
            'epistemic_strength',
            'statement',
            'supersedes_candidate',
            'citations',
          ],
          properties: {
            requirement_id: { type: 'string' },
            proposed_type: { type: 'string', enum: [...PROPOSITION_TYPES] },
            epistemic_strength: { type: 'string', enum: [...EPISTEMIC_STRENGTHS] },
            statement: { type: 'string' },
            supersedes_candidate: {
              type: ['string', 'null'],
              description:
                'An existing proposition_id this assertion replaces, or null. Never guess.',
            },
            citations: citationSchema(),
          },
        },
      },
      rejected_candidates: {
        type: 'array',
        description: 'Readings you considered and discarded. Audit material.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['reason', 'proposed_type', 'citations'],
          properties: {
            reason: { type: 'string' },
            proposed_type: { type: ['string', 'null'], enum: [...PROPOSITION_TYPES, null] },
            citations: citationSchema(),
          },
        },
      },
      clarifications_requested: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['requirement_id', 'reason', 'prompt'],
          properties: {
            requirement_id: { type: 'string' },
            reason: { type: 'string', enum: [...AMBIGUITY_REASONS] },
            prompt: {
              type: 'string',
              description: 'One specific question that would resolve the ambiguity.',
            },
          },
        },
      },
    },
  } as JsonValue;
}

/** Enters `config_hash`: a different output schema is a different compiler. */
export function semanticCompilerSchemaHash(): string {
  return sha256(canonicalSerialize(buildSemanticCompilerJsonSchema()));
}
