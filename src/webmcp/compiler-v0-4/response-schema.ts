/**
 * The V0.4 provider-native structured-output schema.
 *
 * Same pattern as the renderer and as compiler contract V0.4: frozen V0.3
 * machinery plus one explicit, enumerated delta. The delta is exactly one
 * field — `properties.assertions.description` — and a deep-diff test pins that.
 *
 * WHY. The frozen V0.3 schema carries this MODEL-FACING description:
 *
 *     "... At most one assertion may occupy each (requirement_id,
 *      proposed_type) pair; combine compatible same-slot facts into one
 *      assertion with multiple exact citations."
 *
 * That is the second of the two semantic rules V0.4 removes — the contract half
 * is `compiler_assertion_slot_duplicate`, already suppressed by `core-v0-4`.
 * Provider structured-output schemas are sent to the model verbatim, DESCRIPTIONS
 * INCLUDED (`compiler/openai-responses-client.ts` passes `schema` straight
 * through), so this text is an instruction, not a comment. Shipping it beneath a
 * V0.4 prompt that says "decompose independent propositions" would put a rule and
 * its exact negation in one request.
 *
 * The schema is byte-frozen by `compiler-v0-3-frozen-manifest.ts`, so it cannot
 * be edited in place.
 *
 * STRUCTURAL SHAPE vs ARTIFACT BYTES — not the same claim, and the distinction
 * is the whole point of this module. The JSON response SHAPE is unchanged: same
 * properties, same types, same enums, same `required`, same
 * `additionalProperties: false`, same proposition-type and epistemic-strength
 * vocabularies. What changes is the model-facing description text, which changes
 * the artifact's bytes — so `output_schema_hash` MUST change and the schema NAME
 * moves to a V0.4 identity. Pretending the hash could stay still would falsify
 * the registry entry.
 *
 * NAVIGATED, NOT STRINGIFIED. The substitution walks to the exact field and
 * asserts its current value equals the frozen V0.3 text. A stringify-and-replace
 * over the whole document could match inside some unrelated description that
 * happened to share wording, and would not notice if V0.3 moved.
 */

import { canonicalSerialize, sha256 } from '../core-v0-3/types.js';
import type { JsonValue } from '../core-v0-3/types.js';
import { buildSemanticCompilerJsonSchema } from '../compiler-v0-3/response-schema.js';

export const SEMANTIC_COMPILER_SCHEMA_NAME_V04 = 'juryai_semantic_compiler_output_v04';

/** The exact frozen V0.3 description this adapter expects to find and replace. */
export const V03_ASSERTIONS_DESCRIPTION =
  'Must be empty unless verdict is accepted_candidates. At most one assertion may occupy each (requirement_id, proposed_type) pair; combine compatible same-slot facts into one assertion with multiple exact citations.';

/**
 * The V0.4 description.
 *
 * Permits shared `(requirement_id, proposed_type)` and shared
 * `epistemic_strength`, and carries NO instruction to merge same-slot material.
 * It also does not instruct the model to split: over-splitting one proposition
 * into fragments is its own failure, and the doctrine that draws that line lives
 * in the system prompt rather than in a schema field.
 */
export const V04_ASSERTIONS_DESCRIPTION =
  'Must be empty unless verdict is accepted_candidates. Several assertions may share the same (requirement_id, proposed_type) pair, and may also share the same epistemic_strength. Each independently meaningful fact or assessment is asserted separately, with its own exact citations.';

/**
 * Builds the V0.4 schema by cloning the V0.3 schema and replacing exactly one
 * description. Throws rather than guessing if the frozen schema has moved.
 */
export function buildSemanticCompilerJsonSchemaV04(): JsonValue {
  const schema = structuredClone(buildSemanticCompilerJsonSchema()) as Record<string, unknown>;

  const properties = schema.properties as Record<string, unknown> | undefined;
  const assertions = properties?.assertions as Record<string, unknown> | undefined;
  if (assertions === undefined) {
    throw new TypeError(
      'V0.4 schema adapter: the V0.3 schema has no properties.assertions node; refusing to build.',
    );
  }
  if (assertions.description !== V03_ASSERTIONS_DESCRIPTION) {
    throw new TypeError(
      'V0.4 schema adapter: properties.assertions.description is not the expected frozen V0.3 text. The frozen V0.3 schema has changed; refusing to build.',
    );
  }
  assertions.description = V04_ASSERTIONS_DESCRIPTION;
  return schema as JsonValue;
}

/**
 * Enters `config_hash`. Necessarily differs from the V0.3 hash: the model reads
 * these bytes, so a different description is a different compiler.
 */
export function semanticCompilerSchemaHashV04(): string {
  return sha256(canonicalSerialize(buildSemanticCompilerJsonSchemaV04()));
}
