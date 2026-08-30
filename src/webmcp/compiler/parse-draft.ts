/**
 * Parses provider text into a `CompilerOutput`, or fails.
 *
 * The governing rule of this module is that it NEVER repairs. A field of the
 * wrong type, an unknown enum member, a citation that does not occur in the
 * stored turn — each is a failure of the compile run, not something to coerce,
 * drop or default. Normalising malformed provider data into a shape that looks
 * valid is how a fabricated proposition acquires a clean provenance trail.
 *
 * The provider's own strict-schema enforcement is treated as unproven here:
 * every property the schema claims to guarantee is re-checked, because the
 * only guarantee this pipeline is entitled to rely on is one it verified
 * itself.
 *
 * Grounding is resolved, not trusted. The model returns quotations; this
 * module locates each quotation in the STORED turn text and builds the span
 * with the core's own `createSpan`, which verifies substring equality at the
 * computed offsets. A quotation that does not occur exactly means the model
 * cited text the human did not write, and the whole run fails closed — for
 * rejected candidates too, so that "every span this compiler emits is
 * mechanically verified" holds without exception.
 */

import {
  type CompiledAssertion,
  type CompilerClarification,
  type CompilerInput,
  type CompilerOutput,
  type CompilerVerdict,
  type RejectedCandidate,
  type AmbiguityReason,
} from '../core/compiler-contract.js';
import {
  createSpan,
  type SourceTurnPayload,
  type SpanRegion,
  type TurnSpan,
} from '../core/turns.js';
import { isEpistemicStrength, isPropositionType } from '../core/types.js';

/** A compile run that could not be turned into a contract-shaped output. */
export class SemanticCompilerOutputError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(path + ': ' + message);
    this.name = 'SemanticCompilerOutputError';
    this.path = path;
  }
}

const VERDICTS = new Set<string>(['accepted_candidates', 'ambiguous', 'no_assertions']);
const AMBIGUITY_REASONS = new Set<string>([
  'answer_does_not_address_requirement',
  'multiple_incompatible_readings',
  'epistemic_strength_indeterminate',
  'contradicts_existing_proposition',
  'type_classification_indeterminate',
]);

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SemanticCompilerOutputError('expected an object', path);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new SemanticCompilerOutputError('expected an array', path);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new SemanticCompilerOutputError('expected a string', path);
  return value;
}

function nullableText(value: unknown, path: string): string | null {
  if (value === null) return null;
  return text(value, path);
}

/**
 * Resolves one model citation into a verified span.
 *
 * The FIRST exact occurrence is used. Multiple occurrences of the same
 * quotation are all equally true quotations of the stored text, so the choice
 * changes nothing a span asserts; picking deterministically keeps replay
 * stable.
 */
function resolveCitation(
  value: unknown,
  path: string,
  turnId: string,
  payload: SourceTurnPayload,
): TurnSpan {
  const citation = object(value, path);
  const region = text(citation.region, path + '.region');
  if (region !== 'answer' && region !== 'context') {
    throw new SemanticCompilerOutputError("region must be 'answer' or 'context'", path + '.region');
  }
  const quote = text(citation.quote, path + '.quote');
  if (quote.length === 0) {
    throw new SemanticCompilerOutputError('quotation is empty', path + '.quote');
  }

  const rawIndex = citation.message_index;
  let messageIndex: number | null;
  if (rawIndex === null) {
    messageIndex = null;
  } else if (typeof rawIndex === 'number' && Number.isInteger(rawIndex)) {
    messageIndex = rawIndex;
  } else {
    throw new SemanticCompilerOutputError(
      'message_index must be an integer or null',
      path + '.message_index',
    );
  }

  if (region === 'answer' && messageIndex !== null) {
    throw new SemanticCompilerOutputError(
      "message_index must be null for region 'answer'",
      path + '.message_index',
    );
  }
  if (region === 'context' && messageIndex === null) {
    throw new SemanticCompilerOutputError(
      "message_index is required for region 'context'",
      path + '.message_index',
    );
  }

  const source =
    region === 'answer' ? payload.answer.text : (payload.context[messageIndex ?? 0]?.text ?? null);
  if (source === null) {
    throw new SemanticCompilerOutputError(
      'citation names a message that does not exist on this turn',
      path,
    );
  }

  const start = source.indexOf(quote);
  if (start < 0) {
    // The model quoted something the stored turn does not contain. There is no
    // safe repair for this: it is the fabrication case.
    throw new SemanticCompilerOutputError(
      'quoted text does not occur in the stored ' + region + ' text',
      path + '.quote',
    );
  }

  return createSpan(
    turnId,
    payload,
    region as SpanRegion,
    messageIndex,
    start,
    start + quote.length,
  );
}

function resolveCitations(
  value: unknown,
  path: string,
  turnId: string,
  payload: SourceTurnPayload,
): TurnSpan[] {
  return array(value, path).map((entry, index) =>
    resolveCitation(entry, path + '[' + String(index) + ']', turnId, payload),
  );
}

/**
 * Turns one provider completion into a `CompilerOutput`.
 *
 * `compile_run_id` and `compiler_version_id` are copied from the INPUT and are
 * never read from the model's response: run and artefact identity are the
 * runtime's facts about this execution, not claims the model gets to make.
 */
export function parseModelDraft(input: CompilerInput, rawText: string): CompilerOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch (error) {
    throw new SemanticCompilerOutputError(
      'provider output was not valid JSON: ' +
        (error instanceof Error ? error.message : 'unknown error'),
      'model_draft',
    );
  }

  const draft = object(parsed, 'model_draft');

  const verdictValue = text(draft.verdict, 'model_draft.verdict');
  if (!VERDICTS.has(verdictValue)) {
    throw new SemanticCompilerOutputError('unknown verdict', 'model_draft.verdict');
  }
  const verdict = verdictValue as CompilerVerdict;

  const turnId = input.turn.turn_id;
  const payload = input.turn.payload;

  const assertions: CompiledAssertion[] = array(draft.assertions, 'model_draft.assertions').map(
    (entry, index) => {
      const at = 'model_draft.assertions[' + String(index) + ']';
      const item = object(entry, at);
      const proposedType = item.proposed_type;
      if (!isPropositionType(proposedType)) {
        throw new SemanticCompilerOutputError(
          'not a canonical proposition type',
          at + '.proposed_type',
        );
      }
      const strength = item.epistemic_strength;
      if (!isEpistemicStrength(strength)) {
        throw new SemanticCompilerOutputError(
          'not a canonical epistemic strength',
          at + '.epistemic_strength',
        );
      }
      return {
        // Server-side positional identity: the model never names an assertion.
        assertion_id: 'assert_' + String(index + 1),
        spans: resolveCitations(item.citations, at + '.citations', turnId, payload),
        proposed_type: proposedType,
        epistemic_strength: strength,
        requirement_id: text(item.requirement_id, at + '.requirement_id'),
        statement: text(item.statement, at + '.statement'),
        supersedes_candidate: nullableText(item.supersedes_candidate, at + '.supersedes_candidate'),
      };
    },
  );

  if (verdict === 'accepted_candidates' && assertions.length === 0) {
    throw new SemanticCompilerOutputError(
      'accepted_candidates must contain at least one candidate assertion',
      'model_draft.assertions',
    );
  }

  const rejected: RejectedCandidate[] = array(
    draft.rejected_candidates,
    'model_draft.rejected_candidates',
  ).map((entry, index) => {
    const at = 'model_draft.rejected_candidates[' + String(index) + ']';
    const item = object(entry, at);
    const proposedType = item.proposed_type;
    if (proposedType !== null && !isPropositionType(proposedType)) {
      throw new SemanticCompilerOutputError(
        'not a canonical proposition type or null',
        at + '.proposed_type',
      );
    }
    return {
      assertion_id: 'rejected_' + String(index + 1),
      reason: text(item.reason, at + '.reason'),
      proposed_type: proposedType,
      spans: resolveCitations(item.citations, at + '.citations', turnId, payload),
    };
  });

  const clarifications: CompilerClarification[] = array(
    draft.clarifications_requested,
    'model_draft.clarifications_requested',
  ).map((entry, index) => {
    const at = 'model_draft.clarifications_requested[' + String(index) + ']';
    const item = object(entry, at);
    const reason = text(item.reason, at + '.reason');
    if (!AMBIGUITY_REASONS.has(reason)) {
      throw new SemanticCompilerOutputError('not a canonical ambiguity reason', at + '.reason');
    }
    return {
      requirement_id: text(item.requirement_id, at + '.requirement_id'),
      reason: reason as AmbiguityReason,
      prompt: text(item.prompt, at + '.prompt'),
    };
  });

  return {
    compile_run_id: input.compile_run_id,
    compiler_version_id: input.compiler_version_id,
    verdict,
    assertions,
    rejected_candidates: rejected,
    clarifications_requested: clarifications,
    // Populated by the caller, which owns the retention policy for raw text.
    raw_model_output: null,
  };
}
