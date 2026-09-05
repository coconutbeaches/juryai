/**
 * Compiler contract V0.4.
 *
 * V0.3 stays frozen and byte-identical; a hash manifest enforces that. V0.4 is
 * a NEW immutable contract that differs from V0.3 in exactly two admission
 * rules, both about how much a single compile run is allowed to say:
 *
 *  1. `compiler_assertion_slot_duplicate` is not enforced. Multiple assertions
 *     in one run may share `(requirement_id, proposed_type)` — and may share
 *     `epistemic_strength` too. Two distinct facts are two propositions; the
 *     V0.3 instruction to combine them existed only to satisfy a cardinality
 *     limit that the future generation does not have.
 *  2. `compiler_requirement_not_answered` is not enforced. An assertion may
 *     target any requirement present in `requirement_context`, whether or not
 *     the source turn named it in `in_reply_to`. This is the contract half of
 *     "ask narrowly, listen broadly": pacing controls what is ASKED, not what
 *     the compiler is allowed to HEAR.
 *
 * Everything else is unchanged, and deliberately so — which is why this module
 * DELEGATES to the frozen V0.3 rule set and then suppresses exactly those two
 * codes, rather than reimplementing three hundred lines of rules. Delegation
 * makes "V0.4 is V0.3 minus exactly these two rules" a mechanically true
 * statement instead of an aspiration, and it cannot drift: a reimplementation
 * that quietly dropped the grounding rule, the verdict rule or the
 * ambiguous-emits-nothing rule would look almost identical in review.
 * `formation-8c1a-guards` pins the suppressed set at exactly these two codes.
 *
 * WHAT V0.4 DOES NOT RELAX, because delegation keeps it: exact-quotation
 * grounding, ANSWER-region grounding, `compiler_requirement_unknown` (the
 * requirement must still be in the supplied context — this is what keeps an
 * opponent's requirements unreachable), run and version identity, the verdict
 * enum, ambiguous-emits-no-assertions, proposition types, epistemic strengths,
 * and `supersedes_candidate` naming one exact proposition.
 *
 * The input and output SHAPES are unchanged, so the input template version,
 * render version, response schema and taxonomy are NOT bumped. Only the
 * contract version moves, because only the semantics moved. In 8C1b the prompt
 * artefact moves too, for the same reason.
 */

import type { CompilerInput, CompilerOutput } from '../core-v0-3/compiler-contract.js';
import {
  COMPILER_CONTRACT_VERSION as COMPILER_CONTRACT_VERSION_V03,
  validateCompilerOutputForContractVersion as validateUnderV03,
} from '../core-v0-3/compiler-contract.js';
import { issue, type ContractIssue } from '../core-v0-3/types.js';

export const COMPILER_CONTRACT_VERSION_V04 = 'juryai-webmcp-compiler-contract-v0.4.0';

/**
 * The V0.3 admission rules V0.4 deliberately does not enforce.
 *
 * Each corresponds to exactly one emission site in the frozen contract, which
 * is what makes suppression-by-code exact rather than approximate. If a future
 * reader needs to know what V0.4 changed, this array is the answer.
 */
export const V04_SUPPRESSED_V03_ISSUE_CODES: readonly string[] = Object.freeze([
  'compiler_assertion_slot_duplicate',
  'compiler_requirement_not_answered',
]);

/**
 * Validates a compiler run under V0.4.
 *
 * Self-refuses any other contract version, mirroring V0.3. That symmetry is
 * load-bearing: the input template is byte-identical across the two contracts,
 * so nothing but the version check stops a stored V0.3 run from being
 * reinterpreted under V0.4's looser admission rules — which would silently
 * change the meaning of already-recorded evidence.
 */
export function validateCompilerOutputForContractVersionV04(
  input: CompilerInput,
  output: CompilerOutput,
  compilerContractVersion: string,
  path = 'compiler_output',
): ContractIssue[] {
  if (compilerContractVersion !== COMPILER_CONTRACT_VERSION_V04) {
    return [
      issue(
        'compiler_contract_version_mismatch',
        path,
        'V0.4 cannot validate or reinterpret a run recorded under a different compiler contract.',
      ),
    ];
  }
  return validateUnderV03(input, output, COMPILER_CONTRACT_VERSION_V03, path).filter(
    (raised) => !V04_SUPPRESSED_V03_ISSUE_CODES.includes(raised.code),
  );
}

/** Convenience wrapper for callers compiling under V0.4. */
export function validateCompilerOutputV04(
  input: CompilerInput,
  output: CompilerOutput,
  path = 'compiler_output',
): ContractIssue[] {
  return validateCompilerOutputForContractVersionV04(
    input,
    output,
    COMPILER_CONTRACT_VERSION_V04,
    path,
  );
}
