/**
 * A deterministic semantic compiler for development, fixtures and tests.
 *
 * This is NOT a model integration and must never be mistaken for one. It
 * exists so the runtime pipeline — idempotency, mutation application,
 * structural validation, versioning, commit — can be exercised exactly, with
 * no network, no sampling and no hidden state. A real adapter replaces this
 * object and nothing else: it implements the same port, registers the same
 * kind of artefact, and is subject to the same contract check.
 *
 * Scripted assertions cite spans by QUOTE. The compiler locates the quote in
 * the stored answer text and builds the span with the core's own constructor,
 * so a script that quotes something the user did not say fails loudly here
 * rather than producing an ungrounded proposition.
 */

import {
  COMPILER_CONTRACT_VERSION,
  compilerVersionId,
  type CompilerInput,
  type CompilerOutput,
  type CompilerRegistryEntry,
  type CompilerVersion,
  type AmbiguityReason,
  type CompiledAssertion,
} from '../core-v0-3/compiler-contract.js';
import { createSpan, type SpanRegion } from '../core/turns.js';
import {
  sha256,
  canonicalSerialize,
  type EpistemicStrength,
  type PropositionType,
} from '../core-v0-3/types.js';
import type { CompileOptions, SemanticCompilerPort } from './compiler-port.js';

export interface ScriptedAssertion {
  /** Exact substring of the stored answer (or context message) to cite. */
  quote: string;
  region?: SpanRegion;
  message_index?: number;
  requirement_id: string;
  type: PropositionType;
  epistemic_strength: EpistemicStrength;
  statement: string;
  supersedes_candidate?: string | null;
}

export interface ScriptedClarification {
  requirement_id: string;
  reason: AmbiguityReason;
  prompt: string;
}

export type ScriptedResult =
  | {
      verdict: 'accepted_candidates';
      assertions: ScriptedAssertion[];
      clarifications?: ScriptedClarification[];
    }
  | { verdict: 'ambiguous'; clarifications: ScriptedClarification[] }
  | { verdict: 'no_assertions'; clarifications?: ScriptedClarification[] }
  /** Escape hatch for testing fail-closed paths: emitted verbatim. */
  | { verdict: 'raw'; output: Omit<CompilerOutput, 'compile_run_id' | 'compiler_version_id'> };

export type CompilerScript = (input: CompilerInput) => ScriptedResult;

const SCRIPTED_PROMPT = 'juryai scripted compiler: deterministic, no model call.';

const SCRIPTED_CONFIG = { kind: 'scripted', deterministic: true } as const;

export function scriptedCompilerVersion(taxonomyVersion = 'juryai-p2-v0.3.0'): CompilerVersion {
  return {
    prompt_hash: sha256(SCRIPTED_PROMPT),
    config_hash: sha256(canonicalSerialize(SCRIPTED_CONFIG)),
    model_id: 'scripted-deterministic',
    // Recorded honestly as absent rather than invented.
    model_snapshot: null,
    decoding: { temperature: 0, top_p: null, max_output_tokens: null, seed: 0 },
    taxonomy_version: taxonomyVersion,
    schema_version: COMPILER_CONTRACT_VERSION,
  };
}

export function scriptedRegistryEntry(
  registeredAt = '2026-01-01T00:00:00.000Z',
): CompilerRegistryEntry {
  const version = scriptedCompilerVersion();
  return {
    compiler_version_id: compilerVersionId(version),
    version,
    prompt_text: SCRIPTED_PROMPT,
    config: { ...SCRIPTED_CONFIG },
    registered_at: registeredAt,
  };
}

export class ScriptedSemanticCompiler implements SemanticCompilerPort {
  readonly registryEntry: CompilerRegistryEntry;
  readonly calls: CompilerInput[] = [];
  /** Execution context seen per call, so signal propagation is observable. */
  readonly optionsSeen: (CompileOptions | undefined)[] = [];
  #script: CompilerScript;

  constructor(script: CompilerScript = () => ({ verdict: 'no_assertions' })) {
    this.#script = script;
    this.registryEntry = scriptedRegistryEntry();
  }

  setScript(script: CompilerScript): void {
    this.#script = script;
  }

  async compile(input: CompilerInput, options?: CompileOptions): Promise<CompilerOutput> {
    this.calls.push(structuredClone(input));
    this.optionsSeen.push(options);
    const scripted = this.#script(input);
    const base = {
      compile_run_id: input.compile_run_id,
      compiler_version_id: input.compiler_version_id,
    };

    if (scripted.verdict === 'raw') {
      return { ...base, ...scripted.output };
    }
    if (scripted.verdict === 'ambiguous') {
      return {
        ...base,
        verdict: 'ambiguous',
        assertions: [],
        rejected_candidates: [],
        clarifications_requested: scripted.clarifications,
        raw_model_output: null,
      };
    }
    if (scripted.verdict === 'no_assertions') {
      return {
        ...base,
        verdict: 'no_assertions',
        assertions: [],
        rejected_candidates: [],
        clarifications_requested: scripted.clarifications ?? [],
        raw_model_output: null,
      };
    }

    const assertions: CompiledAssertion[] = scripted.assertions.map((assertion, index) => {
      const region: SpanRegion = assertion.region ?? 'answer';
      const messageIndex = region === 'answer' ? null : (assertion.message_index ?? 0);
      const text =
        region === 'answer'
          ? input.turn.payload.answer.text
          : (input.turn.payload.context[messageIndex ?? 0]?.text ?? '');
      const start = text.indexOf(assertion.quote);
      if (start < 0) {
        throw new TypeError(
          "Scripted quote '" + assertion.quote + "' does not occur in the stored turn text.",
        );
      }
      return {
        assertion_id: 'assert_' + String(index + 1),
        spans: [
          createSpan(
            input.turn.turn_id,
            input.turn.payload,
            region,
            messageIndex,
            start,
            start + assertion.quote.length,
          ),
        ],
        proposed_type: assertion.type,
        epistemic_strength: assertion.epistemic_strength,
        requirement_id: assertion.requirement_id,
        statement: assertion.statement,
        supersedes_candidate: assertion.supersedes_candidate ?? null,
      };
    });

    return {
      ...base,
      verdict: 'accepted_candidates',
      assertions,
      rejected_candidates: [],
      clarifications_requested: scripted.clarifications ?? [],
      raw_model_output: null,
    };
  }
}
