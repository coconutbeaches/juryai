/**
 * The V0.4 input renderer.
 *
 * V0.4 = frozen V0.3 machinery + an explicit, enumerated semantic delta. This
 * module DELEGATES to `compiler-v0-3/render-input.ts` and rewrites exactly two
 * regions of its output. It is deliberately not a copy: a copied renderer would
 * silently keep working if V0.3 changed underneath it, and the two generations
 * would drift apart with nothing to notice.
 *
 * WHY THIS MODULE HAS TO EXIST AT ALL. The frozen V0.3 renderer emits a
 * MODEL-FACING sentence directly above the REQUIREMENTS fence:
 *
 *     "The requirements this turn claims to answer. An assertion may only be
 *      mapped to a requirement listed under answers_requirement_ids above."
 *
 * That is one of exactly two semantic rules V0.4 removes — the contract half of
 * it is `compiler_requirement_not_answered`, which `core-v0-4` already
 * suppresses. Reusing the V0.3 renderer unchanged would put that instruction in
 * the same request as a V0.4 system prompt saying the opposite, and a live eval
 * over a self-contradictory request measures how a model resolves a
 * contradiction, not whether V0.4 doctrine works. A green run would not be
 * evidence, and a red run would be misread as a model limitation.
 *
 * The renderer is byte-frozen by `compiler-v0-3-frozen-manifest.ts` and
 * production V0.3 depends on it, so the sentence cannot be edited in place.
 *
 * FAIL CLOSED, NOT BEST EFFORT. Every substitution asserts its target occurs
 * EXACTLY ONCE and refuses to render otherwise. Zero occurrences means V0.3
 * moved and this adapter's assumptions are stale. Two occurrences means the
 * second one is in untrusted case data — a relay or a human wrote the template's
 * own instruction text into an answer — and a loose replacement would either
 * rewrite quoted evidence or leave the obsolete instruction standing. Both are
 * refusals here rather than a silently wrong prompt.
 *
 * The input TEMPLATE version, the `CompilerInput`/`CompilerOutput` shapes, the
 * proposition taxonomy and the epistemic-strength vocabulary are all unchanged.
 * Only the render ARTIFACT moves, because only the render artifact's bytes move.
 */

import type { CompilerInput } from '../core-v0-3/compiler-contract.js';
import { sha256 } from '../core-v0-3/types.js';
import {
  COMPILER_INPUT_RENDER_VERSION,
  renderCompilerInput,
} from '../compiler-v0-3/render-input.js';

export const COMPILER_INPUT_RENDER_VERSION_V04 = 'juryai-compiler-input-render-v0.4.0';

/**
 * The exact V0.3 requirement-scope instruction, as the frozen renderer joins it.
 *
 * Held as one literal spanning the line break rather than as two fragments, so
 * this constant either matches the frozen renderer's real output or fails.
 */
export const V03_REQUIREMENT_SCOPE_INSTRUCTION =
  'The requirements this turn claims to answer. An assertion may only be\n' +
  'mapped to a requirement listed under answers_requirement_ids above.';

/**
 * "Ask narrowly, listen broadly" — the render half.
 *
 * Broad LISTENING, not broad AUTHORITY: the scope widens to the requirements
 * actually supplied in this request and no further. The asked/volunteered
 * distinction is preserved as provenance rather than deleted, because
 * `in_reply_to` still records what the interviewer chose to ask.
 */
export const V04_REQUIREMENT_SCOPE_INSTRUCTION =
  'answers_requirement_ids above records only what the interviewer explicitly\n' +
  'asked in this turn. The REQUIREMENTS section below is the full scope you may\n' +
  'interpret: an assertion may map to ANY requirement listed there, whether or\n' +
  'not it was explicitly asked. The distinction still carries provenance meaning\n' +
  '— an explicitly asked requirement and a volunteered one are different kinds of\n' +
  'answer — but it does not narrow what you are permitted to read.';

const V03_RENDER_VERSION_LINE = 'input_render_version: ' + COMPILER_INPUT_RENDER_VERSION;
const V04_RENDER_VERSION_LINE = 'input_render_version: ' + COMPILER_INPUT_RENDER_VERSION_V04;

/**
 * Substitutes one region, refusing anything but a single unambiguous target.
 *
 * `String.replace` with a string pattern silently rewrites only the FIRST
 * occurrence and reports nothing when there are none, which is the wrong
 * behaviour on every count here.
 */
function replaceExactlyOnce(
  haystack: string,
  needle: string,
  replacement: string,
  what: string,
): string {
  const first = haystack.indexOf(needle);
  if (first < 0) {
    throw new TypeError(
      'V0.4 render adapter: expected exactly one ' +
        what +
        ' in the V0.3 rendered input, found none. The frozen V0.3 renderer has changed; refusing to render.',
    );
  }
  if (haystack.indexOf(needle, first + needle.length) >= 0) {
    throw new TypeError(
      'V0.4 render adapter: expected exactly one ' +
        what +
        ' in the V0.3 rendered input, found more than one. A second occurrence can only come from untrusted case data; refusing to render.',
    );
  }
  return haystack.slice(0, first) + replacement + haystack.slice(first + needle.length);
}

/** The V0.4 delta, applied to whatever the frozen V0.3 renderer produced. */
function applyV04RenderDelta(v03Rendered: string): string {
  const scoped = replaceExactlyOnce(
    v03Rendered,
    V03_REQUIREMENT_SCOPE_INSTRUCTION,
    V04_REQUIREMENT_SCOPE_INSTRUCTION,
    'V0.3 requirement-scope instruction',
  );
  return replaceExactlyOnce(
    scoped,
    V03_RENDER_VERSION_LINE,
    V04_RENDER_VERSION_LINE,
    'V0.3 input_render_version line',
  );
}

/**
 * Renders the V0.4 model-facing input.
 *
 * Pure and deterministic, exactly as the V0.3 renderer is: the same
 * `CompilerInput` always produces byte-identical text, so a graded difference is
 * a difference in the model and never in the harness.
 */
export function renderCompilerInputV04(input: CompilerInput): string {
  return applyV04RenderDelta(renderCompilerInput(input));
}

/**
 * A fixed probe carrying both substitution targets and nothing else.
 *
 * Deliberately built from the V0.3 constants rather than from a `CompilerInput`:
 * the artefact hash must depend on the DELTA this module applies, and building
 * a synthetic compiler input here would drag eval-shaped machinery into a module
 * the production tree may one day import.
 */
const RENDER_ARTIFACT_PROBE = [V03_RENDER_VERSION_LINE, '', V03_REQUIREMENT_SCOPE_INSTRUCTION].join(
  '\n',
);

/**
 * The content hash of the V0.4 render ARTEFACT — the actual model-facing bytes
 * this adapter produces, not the version label that claims to describe them.
 *
 * WHY THIS EXISTS. `input_render_version` is a hand-maintained string. Editing
 * `V04_REQUIREMENT_SCOPE_INSTRUCTION` without bumping it changes what the model
 * is told while `config_hash` and `compiler_version_id` stay identical — an
 * identity collision, and precisely the provenance failure every other part of
 * this slice is built to prevent. The adapter delta tests cannot catch it
 * either, because they derive their expectations from the same constants.
 *
 * A structural guard pins this hash to a literal, so any change to the
 * instruction text, the version line, or the substitution logic itself is a
 * loud CI failure rather than a silent one. That mirrors how the frozen V0.3
 * renderer is protected — by a hash manifest rather than by config content —
 * and deliberately leaves `compiler_version_id` unchanged, so the artefact that
 * was live-evaluated remains the artefact that ships. Folding this hash into
 * `config_hash` instead would be stronger still, and is recorded as a follow-up
 * because it would change an identity that has already been measured.
 */
export function compilerInputRenderArtifactHashV04(): string {
  return renderArtifactHashForInstruction(V04_REQUIREMENT_SCOPE_INSTRUCTION);
}

/**
 * The artefact hash the compiler WOULD have if the scope instruction were
 * different. Exported so an identity test can mutate the model-facing bytes and
 * observe `compiler_version_id` move, without editing this module and without
 * putting an injection seam into the production identity path — the shipped
 * compiler always hashes `V04_REQUIREMENT_SCOPE_INSTRUCTION` itself.
 */
export function renderArtifactHashForInstruction(instruction: string): string {
  const probe = [V03_RENDER_VERSION_LINE, '', V03_REQUIREMENT_SCOPE_INSTRUCTION].join('\n');
  const scoped = replaceExactlyOnce(
    probe,
    V03_REQUIREMENT_SCOPE_INSTRUCTION,
    instruction,
    'V0.3 requirement-scope instruction',
  );
  return sha256(
    replaceExactlyOnce(
      scoped,
      V03_RENDER_VERSION_LINE,
      V04_RENDER_VERSION_LINE,
      'V0.3 input_render_version line',
    ),
  );
}
