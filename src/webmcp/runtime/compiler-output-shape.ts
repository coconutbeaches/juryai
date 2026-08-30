/**
 * Complete structural validation of an untrusted compiler response.
 *
 * The core's `validateCompilerOutput` is a CONTRACT check: it answers whether a
 * well-typed output is consistent with the input it was given — right run id,
 * right version id, verdict/assertion coherence, spans that actually resolve
 * against the stored turn. It assumes it was handed a `CompilerOutput`.
 *
 * At the adapter boundary nothing guarantees that. A provider can return a
 * value that clones fine and is shaped enough not to throw, while carrying
 * `rejected_candidates: null`, `raw_model_output: 123`, or a clarification
 * whose `reason` is a number. Those pass the contract check untouched, reach
 * the append-only `CompileRunRecord`, and permanently seat values outside the
 * declared schema in an audit log that later replay, evaluation and persistence
 * code is entitled to read at its advertised types.
 *
 * So this module answers the prior question — "is this a `CompilerOutput` at
 * all?" — for every field and every nested member. It is deliberately
 * STRUCTURAL only: shapes, types, enum membership, nullability. Whether the
 * compiler's reading of the answer is correct is a semantic question that stays
 * downstream, in the contract check and in mutation application.
 *
 * Core is frozen, so this lives in the runtime rather than overloading the
 * meaning of the core validator.
 */

import type {
  AmbiguityReason,
  CompilerOutput,
  CompilerVerdict,
} from '../core/compiler-contract.js';
import type { SpanRegion } from '../core/turns.js';
import {
  isEpistemicStrength,
  isPropositionType,
  issue,
  type ContractIssue,
} from '../core/types.js';

/*
 * Declared as exhaustive records rather than string lists: if core ever adds a
 * verdict, an ambiguity reason or a span region, these stop compiling instead
 * of silently admitting an unrecognised member. Core does not export runtime
 * lists for these, so the runtime owns them — but not the right to drift.
 */
const VERDICTS: Record<CompilerVerdict, true> = {
  accepted_candidates: true,
  ambiguous: true,
  no_assertions: true,
};

const AMBIGUITY_REASONS: Record<AmbiguityReason, true> = {
  answer_does_not_address_requirement: true,
  multiple_incompatible_readings: true,
  epistemic_strength_indeterminate: true,
  contradicts_existing_proposition: true,
  type_classification_indeterminate: true,
};

const SPAN_REGIONS: Record<SpanRegion, true> = {
  answer: true,
  context: true,
};

const VERDICT_NAMES = new Set<string>(Object.keys(VERDICTS));
const AMBIGUITY_REASON_NAMES = new Set<string>(Object.keys(AMBIGUITY_REASONS));
const SPAN_REGION_NAMES = new Set<string>(Object.keys(SPAN_REGIONS));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string, issues: ContractIssue[]): void {
  if (typeof value !== 'string') {
    issues.push(issue('compiler_shape_not_string', path, 'Expected a string.'));
  }
}

/** Offsets and indices are declared `number` and used as UTF-16 positions. */
function requireInteger(value: unknown, path: string, issues: ContractIssue[]): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    issues.push(issue('compiler_shape_not_integer', path, 'Expected an integer.'));
  }
}

function requireArray(value: unknown, path: string, issues: ContractIssue[]): value is unknown[] {
  if (!Array.isArray(value)) {
    issues.push(issue('compiler_shape_not_array', path, 'Expected an array.'));
    return false;
  }
  return true;
}

function validateSpan(value: unknown, path: string, issues: ContractIssue[]): void {
  if (!isPlainObject(value)) {
    issues.push(issue('compiler_shape_not_object', path, 'Expected a span object.'));
    return;
  }
  requireString(value.turn_id, path + '.turn_id', issues);
  if (typeof value.region !== 'string' || !SPAN_REGION_NAMES.has(value.region)) {
    issues.push(issue('compiler_shape_enum_unknown', path + '.region', 'Unknown span region.'));
  }
  if (value.message_index !== null) {
    requireInteger(value.message_index, path + '.message_index', issues);
  }
  if (value.encoding !== 'utf16') {
    issues.push(
      issue('compiler_shape_enum_unknown', path + '.encoding', "encoding must be 'utf16'."),
    );
  }
  requireInteger(value.start, path + '.start', issues);
  requireInteger(value.end, path + '.end', issues);
  requireString(value.quote, path + '.quote', issues);
}

function validateSpans(value: unknown, path: string, issues: ContractIssue[]): void {
  if (!requireArray(value, path, issues)) return;
  for (const [index, span] of value.entries()) {
    validateSpan(span, path + '[' + String(index) + ']', issues);
  }
}

function validateAssertion(value: unknown, path: string, issues: ContractIssue[]): void {
  if (!isPlainObject(value)) {
    issues.push(issue('compiler_shape_not_object', path, 'Expected an assertion object.'));
    return;
  }
  requireString(value.assertion_id, path + '.assertion_id', issues);
  validateSpans(value.spans, path + '.spans', issues);
  if (!isPropositionType(value.proposed_type)) {
    issues.push(
      issue(
        'compiler_shape_enum_unknown',
        path + '.proposed_type',
        'Not a canonical proposition type.',
      ),
    );
  }
  if (!isEpistemicStrength(value.epistemic_strength)) {
    issues.push(
      issue(
        'compiler_shape_enum_unknown',
        path + '.epistemic_strength',
        'Not a canonical epistemic strength.',
      ),
    );
  }
  requireString(value.requirement_id, path + '.requirement_id', issues);
  requireString(value.statement, path + '.statement', issues);
  if (value.supersedes_candidate !== null) {
    requireString(value.supersedes_candidate, path + '.supersedes_candidate', issues);
  }
}

function validateRejectedCandidate(value: unknown, path: string, issues: ContractIssue[]): void {
  if (!isPlainObject(value)) {
    issues.push(issue('compiler_shape_not_object', path, 'Expected a rejected-candidate object.'));
    return;
  }
  requireString(value.assertion_id, path + '.assertion_id', issues);
  requireString(value.reason, path + '.reason', issues);
  if (value.proposed_type !== null && !isPropositionType(value.proposed_type)) {
    issues.push(
      issue(
        'compiler_shape_enum_unknown',
        path + '.proposed_type',
        'Not a canonical proposition type or null.',
      ),
    );
  }
  validateSpans(value.spans, path + '.spans', issues);
}

function validateClarification(value: unknown, path: string, issues: ContractIssue[]): void {
  if (!isPlainObject(value)) {
    issues.push(issue('compiler_shape_not_object', path, 'Expected a clarification object.'));
    return;
  }
  requireString(value.requirement_id, path + '.requirement_id', issues);
  if (typeof value.reason !== 'string' || !AMBIGUITY_REASON_NAMES.has(value.reason)) {
    issues.push(
      issue('compiler_shape_enum_unknown', path + '.reason', 'Not a canonical ambiguity reason.'),
    );
  }
  requireString(value.prompt, path + '.prompt', issues);
}

/**
 * Every field of the declared `CompilerOutput`, and every nested member. An
 * empty result means the value is safe to persist as audit and to drive
 * mutation; anything else means it must not be recorded at all.
 */
export function validateCompilerOutputShape(
  value: unknown,
  path = 'compiler_output',
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!isPlainObject(value)) {
    issues.push(issue('compiler_shape_not_object', path, 'Compiler output is not an object.'));
    return issues;
  }

  requireString(value.compile_run_id, path + '.compile_run_id', issues);
  // Declared `string` here; that it MATCHES the registered artefact is the
  // core contract check's job, not this one's.
  requireString(value.compiler_version_id, path + '.compiler_version_id', issues);

  if (typeof value.verdict !== 'string' || !VERDICT_NAMES.has(value.verdict)) {
    issues.push(issue('compiler_shape_enum_unknown', path + '.verdict', 'Unknown verdict.'));
  }

  if (requireArray(value.assertions, path + '.assertions', issues)) {
    for (const [index, entry] of value.assertions.entries()) {
      validateAssertion(entry, path + '.assertions[' + String(index) + ']', issues);
    }
  }

  if (requireArray(value.rejected_candidates, path + '.rejected_candidates', issues)) {
    for (const [index, entry] of value.rejected_candidates.entries()) {
      validateRejectedCandidate(
        entry,
        path + '.rejected_candidates[' + String(index) + ']',
        issues,
      );
    }
  }

  if (requireArray(value.clarifications_requested, path + '.clarifications_requested', issues)) {
    for (const [index, entry] of value.clarifications_requested.entries()) {
      validateClarification(
        entry,
        path + '.clarifications_requested[' + String(index) + ']',
        issues,
      );
    }
  }

  if (value.raw_model_output !== null) {
    requireString(value.raw_model_output, path + '.raw_model_output', issues);
  }

  return issues;
}

/** Narrowing helper for call sites that have already collected the issues. */
export function isStructurallyValidCompilerOutput(value: unknown): value is CompilerOutput {
  return validateCompilerOutputShape(value).length === 0;
}
