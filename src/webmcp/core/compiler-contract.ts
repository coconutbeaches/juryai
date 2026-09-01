/**
 * Semantic compiler input/output contracts. This module deliberately contains
 * NO model call — it defines the shapes, the version pinning and the contract
 * check that any compiler implementation must pass.
 *
 * Two things here protect the future:
 *  - The output carries the DECOMPOSED shape (assertions with spans, type and
 *    strength) even when a single pass produced it, so decomposing the
 *    implementation later is not a schema migration across locked cases.
 *  - The registry stores the compiler ARTEFACT, not just its hash. A version
 *    hash proves which compiler ran; it does not let you re-run it, and
 *    without re-running it semantic regression testing is theatre.
 */

import {
  canonicalSerialize,
  isPropositionType,
  isEpistemicStrength,
  issue,
  sha256,
  type ContractIssue,
  type EpistemicStrength,
  type JsonValue,
  type PropositionType,
} from './types.js';
import { verifyTurnSpan, type SourceTurnRecord, type TurnSpan } from './turns.js';
import type { Proposition } from './propositions.js';
import type { RequirementDefinition } from './requirements.js';

export const COMPILER_CONTRACT_VERSION = 'juryai-webmcp-compiler-contract-v0.2.1';

const COMPILER_CONTRACTS_WITHOUT_ASSERTION_SLOT_CARDINALITY = new Set([
  'juryai-webmcp-compiler-contract-v0.2.0',
]);

/* ------------------------------------------------------------------------ */
/* Compiler identity                                                         */
/* ------------------------------------------------------------------------ */

export interface CompilerDecodingConfig {
  temperature: number;
  top_p: number | null;
  max_output_tokens: number | null;
  seed: number | null;
}

export interface CompilerVersion {
  prompt_hash: string;
  config_hash: string;
  model_id: string;
  /** Provider snapshot where knowable; null is recorded honestly, not faked. */
  model_snapshot: string | null;
  decoding: CompilerDecodingConfig;
  taxonomy_version: string;
  schema_version: string;
}

export function compilerVersionId(version: CompilerVersion): string {
  return sha256(canonicalSerialize(version));
}

export interface CompilerRegistryEntry {
  compiler_version_id: string;
  version: CompilerVersion;
  /** The actual prompt text, so an old run can be reproduced. */
  prompt_text: string;
  config: JsonValue;
  registered_at: string;
}

export type CompilerRegistry = readonly CompilerRegistryEntry[];

export function registerCompilerVersion(
  registry: CompilerRegistry,
  entry: CompilerRegistryEntry,
): CompilerRegistryEntry[] {
  if (entry.version.prompt_hash !== sha256(entry.prompt_text)) {
    throw new TypeError('prompt_hash does not match the stored prompt artefact.');
  }
  if (entry.version.config_hash !== sha256(canonicalSerialize(entry.config))) {
    throw new TypeError('config_hash does not match the stored config artefact.');
  }
  const expected = compilerVersionId(entry.version);
  if (entry.compiler_version_id !== expected) {
    throw new TypeError('compiler_version_id does not match the canonical hash of its version.');
  }
  const existing = registry.find((item) => item.compiler_version_id === entry.compiler_version_id);
  if (existing) {
    if (canonicalSerialize(existing) !== canonicalSerialize(entry)) {
      throw new TypeError(
        'A different artefact is already registered under this compiler_version_id.',
      );
    }
    return [...registry];
  }
  return [...registry, entry];
}

/* ------------------------------------------------------------------------ */
/* Compiler input                                                            */
/* ------------------------------------------------------------------------ */

export const COMPILER_INPUT_TEMPLATE_VERSION = 'juryai-compiler-input-v0.2.0';

export interface CompilerInput {
  compile_run_id: string;
  input_template_version: string;
  compiler_version_id: string;
  case_id: string;
  /** State the run was assembled against; required to reproduce the run. */
  case_version: number;
  turn: SourceTurnRecord;
  requirement_context: RequirementDefinition[];
  /** Live propositions, so collision candidates can be surfaced. */
  existing_propositions: Proposition[];
}

/** Deterministic assembly, so a stored run can be replayed exactly. */
export function buildCompilerInput(args: {
  compile_run_id: string;
  compiler_version_id: string;
  state: { case_id: string; case_version: number };
  turn: SourceTurnRecord;
  requirements: readonly RequirementDefinition[];
  livePropositions: readonly Proposition[];
}): CompilerInput {
  return {
    compile_run_id: args.compile_run_id,
    input_template_version: COMPILER_INPUT_TEMPLATE_VERSION,
    compiler_version_id: args.compiler_version_id,
    case_id: args.state.case_id,
    case_version: args.state.case_version,
    turn: args.turn,
    requirement_context: [...args.requirements].sort((a, b) =>
      a.requirement_id.localeCompare(b.requirement_id),
    ),
    existing_propositions: [...args.livePropositions].sort((a, b) =>
      a.proposition_id.localeCompare(b.proposition_id),
    ),
  };
}

export function compilerInputHash(input: CompilerInput): string {
  return sha256(canonicalSerialize(input));
}

/* ------------------------------------------------------------------------ */
/* Compiler output                                                           */
/* ------------------------------------------------------------------------ */

export type CompilerVerdict = 'accepted_candidates' | 'ambiguous' | 'no_assertions';

const COMPILER_VERDICTS: readonly CompilerVerdict[] = [
  'accepted_candidates',
  'ambiguous',
  'no_assertions',
];

export type AmbiguityReason =
  | 'answer_does_not_address_requirement'
  | 'multiple_incompatible_readings'
  | 'epistemic_strength_indeterminate'
  | 'contradicts_existing_proposition'
  | 'type_classification_indeterminate';

export interface CompiledAssertion {
  assertion_id: string;
  spans: TurnSpan[];
  proposed_type: PropositionType;
  epistemic_strength: EpistemicStrength;
  requirement_id: string;
  /** JuryAI canonical wording proposed for the record. */
  statement: string;
  /** Proposed only. Supersession is applied by the server, never the model. */
  supersedes_candidate: string | null;
}

export interface RejectedCandidate {
  assertion_id: string;
  reason: string;
  proposed_type: PropositionType | null;
  spans: TurnSpan[];
}

export interface CompilerClarification {
  requirement_id: string;
  reason: AmbiguityReason;
  prompt: string;
}

export interface CompilerOutput {
  compile_run_id: string;
  compiler_version_id: string;
  verdict: CompilerVerdict;
  assertions: CompiledAssertion[];
  /** What the compiler proposed and discarded. Without this, "the compiler
   *  never proposed X" is indistinguishable from "the validator killed X". */
  rejected_candidates: RejectedCandidate[];
  clarifications_requested: CompilerClarification[];
  raw_model_output: string | null;
}

/**
 * The contract check every compiler implementation must pass. Fail-closed is
 * enforced mechanically here: an ambiguous verdict may not also emit
 * assertions, and it must say what it wants clarified.
 */
export function validateCompilerOutput(
  input: CompilerInput,
  output: CompilerOutput,
  path = 'compiler_output',
): ContractIssue[] {
  return validateCompilerOutputForContractVersion(input, output, COMPILER_CONTRACT_VERSION, path);
}

/** Revalidates an immutable run under the contract version its compiler recorded. */
export function validateCompilerOutputForContractVersion(
  input: CompilerInput,
  output: CompilerOutput,
  compilerContractVersion: string,
  path = 'compiler_output',
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const enforceAssertionSlotCardinality =
    !COMPILER_CONTRACTS_WITHOUT_ASSERTION_SLOT_CARDINALITY.has(compilerContractVersion);

  if (output.compile_run_id !== input.compile_run_id) {
    issues.push(
      issue(
        'compiler_run_id_mismatch',
        path + '.compile_run_id',
        'Output compile_run_id does not match its input.',
      ),
    );
  }
  if (output.compiler_version_id !== input.compiler_version_id) {
    issues.push(
      issue(
        'compiler_version_mismatch',
        path + '.compiler_version_id',
        'Output compiler_version_id does not match its input.',
      ),
    );
  }
  if (!COMPILER_VERDICTS.includes(output.verdict)) {
    issues.push(
      issue(
        'compiler_verdict_unknown',
        path + '.verdict',
        'verdict is not a recognized compiler verdict.',
      ),
    );
  }
  if (output.verdict === 'ambiguous') {
    if (output.assertions.length > 0) {
      issues.push(
        issue(
          'compiler_ambiguous_with_assertions',
          path + '.assertions',
          'An ambiguous verdict must fail closed and emit no assertions.',
        ),
      );
    }
    if (output.clarifications_requested.length === 0) {
      issues.push(
        issue(
          'compiler_ambiguous_without_clarification',
          path + '.clarifications_requested',
          'An ambiguous verdict must request at least one clarification.',
        ),
      );
    }
  }
  if (output.verdict === 'no_assertions' && output.assertions.length > 0) {
    issues.push(
      issue(
        'compiler_no_assertions_conflict',
        path + '.assertions',
        "Verdict 'no_assertions' must not carry assertions.",
      ),
    );
  }

  const requirementIds = new Set(
    input.requirement_context.map((definition) => definition.requirement_id),
  );
  const propositionIds = new Set(
    input.existing_propositions.map((proposition) => proposition.proposition_id),
  );
  const seen = new Set<string>();
  const seenSlots = new Set<string>();

  for (const [index, assertion] of output.assertions.entries()) {
    const at = path + '.assertions[' + String(index) + ']';
    if (seen.has(assertion.assertion_id)) {
      issues.push(
        issue('compiler_assertion_id_duplicate', at + '.assertion_id', 'Duplicate assertion_id.'),
      );
    }
    seen.add(assertion.assertion_id);

    const knownType = isPropositionType(assertion.proposed_type);
    if (!knownType) {
      issues.push(
        issue(
          'compiler_type_unknown',
          at + '.proposed_type',
          'proposed_type is not a canonical proposition type.',
        ),
      );
    }
    if (knownType && enforceAssertionSlotCardinality) {
      const slot = assertion.requirement_id + '|' + assertion.proposed_type;
      if (seenSlots.has(slot)) {
        issues.push(
          issue(
            'compiler_assertion_slot_duplicate',
            at,
            "A compile run may emit at most one '" +
              assertion.proposed_type +
              "' assertion for requirement '" +
              assertion.requirement_id +
              "'. Compatible facts must be combined into one assertion with multiple exact spans.",
          ),
        );
      }
      seenSlots.add(slot);
    }
    if (!isEpistemicStrength(assertion.epistemic_strength)) {
      issues.push(
        issue(
          'compiler_strength_unknown',
          at + '.epistemic_strength',
          'epistemic_strength is not in the canonical enum.',
        ),
      );
    }
    if (!requirementIds.has(assertion.requirement_id)) {
      issues.push(
        issue(
          'compiler_requirement_unknown',
          at + '.requirement_id',
          "Assertion maps to requirement '" +
            assertion.requirement_id +
            "' which is not in the supplied context.",
        ),
      );
    }
    if (!input.turn.in_reply_to.includes(assertion.requirement_id)) {
      issues.push(
        issue(
          'compiler_requirement_not_answered',
          at + '.requirement_id',
          'Assertion maps to a requirement the source turn did not claim to answer.',
        ),
      );
    }
    if (assertion.statement.trim().length === 0) {
      issues.push(
        issue('compiler_statement_empty', at + '.statement', 'statement must not be empty.'),
      );
    }
    if (
      assertion.supersedes_candidate !== null &&
      !propositionIds.has(assertion.supersedes_candidate)
    ) {
      issues.push(
        issue(
          'compiler_supersedes_unknown',
          at + '.supersedes_candidate',
          'supersedes_candidate does not name a live proposition in the input.',
        ),
      );
    }
    if (assertion.spans.length === 0) {
      issues.push(
        issue(
          'compiler_assertion_spans_missing',
          at + '.spans',
          'An accepted assertion must cite at least one exact source span.',
        ),
      );
    }
    if (!assertion.spans.some((span) => span.region === 'answer')) {
      issues.push(
        issue(
          'compiler_assertion_answer_span_missing',
          at + '.spans',
          'An accepted assertion must cite at least one span from the answer region.',
        ),
      );
    }
    for (const [spanIndex, span] of assertion.spans.entries()) {
      const spanPath = at + '.spans[' + String(spanIndex) + ']';
      if (span.turn_id !== input.turn.turn_id) {
        issues.push(
          issue(
            'compiler_span_foreign_turn',
            spanPath + '.turn_id',
            'A span must address the turn supplied to this compile run.',
          ),
        );
        continue;
      }
      issues.push(...verifyTurnSpan(input.turn.payload, span, spanPath).issues);
    }
  }

  for (const [index, clarification] of output.clarifications_requested.entries()) {
    const at = path + '.clarifications_requested[' + String(index) + ']';
    if (!requirementIds.has(clarification.requirement_id)) {
      issues.push(
        issue(
          'compiler_clarification_requirement_unknown',
          at + '.requirement_id',
          'Clarification names a requirement outside the supplied context.',
        ),
      );
    }
  }

  return issues;
}

/* ------------------------------------------------------------------------ */
/* Compile run record                                                        */
/* ------------------------------------------------------------------------ */

/** Stored for every run so historical semantics stay reproducible. */
export interface CompileRunRecord {
  compile_run_id: string;
  case_id: string;
  turn_id: string;
  compiler_version_id: string;
  /** Detached historical snapshot of exactly what the compiler received. */
  input: CompilerInput;
  input_hash: string;
  input_template_version: string;
  output: CompilerOutput;
  contract_issues: ContractIssue[];
  started_at: string;
  finished_at: string;
}

export function buildCompileRunRecord(
  input: CompilerInput,
  output: CompilerOutput,
  timing: { started_at: string; finished_at: string },
): CompileRunRecord {
  const inputSnapshot = structuredClone(input);
  const outputSnapshot = structuredClone(output);
  return {
    compile_run_id: input.compile_run_id,
    case_id: input.case_id,
    turn_id: input.turn.turn_id,
    compiler_version_id: input.compiler_version_id,
    input: inputSnapshot,
    input_hash: compilerInputHash(inputSnapshot),
    input_template_version: input.input_template_version,
    output: outputSnapshot,
    contract_issues: validateCompilerOutput(inputSnapshot, outputSnapshot),
    started_at: timing.started_at,
    finished_at: timing.finished_at,
  };
}
