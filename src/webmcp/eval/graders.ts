/**
 * Deterministic compiler-eval grading.
 *
 * This module deliberately does not interpret English. Language understanding
 * belongs to the semantic compiler model (and, later, live or human semantic
 * evaluation). These checks are limited to closed-world fixture metadata,
 * explicit fixture literals, source-span mechanics, and runtime contracts.
 * Failure text is content-free so eval reports cannot relay model or case text.
 */

import {
  validateCompilerOutput,
  type CompilerInput,
  type CompilerOutput,
} from '../core/compiler-contract.js';
import { verifyTurnSpan } from '../core/turns.js';
import { propositionTypeDescriptor } from '../core/types.js';
import { validateCompilerOutputShape } from '../runtime/compiler-output-shape.js';
import type { AllowedAssertion, ExpectedClarification, SemanticEvalCase } from './types.js';

export interface GradeResult {
  ok: boolean;
  failures: string[];
}

function foldLiteral(value: string): string {
  return value.toLocaleLowerCase('en-US');
}

function assertionSlotKey(requirementId: string, proposedType: string): string {
  return requirementId + '|' + proposedType;
}

function clarificationKey(requirementId: string, reason: string): string {
  return requirementId + '|' + reason;
}

/** Checks that apply to every case, independent of its semantic expectation. */
export function gradeUniversal(
  input: CompilerInput,
  output: CompilerOutput,
  failures: string[],
): void {
  for (const issue of validateCompilerOutputShape(output)) {
    failures.push('shape: ' + issue.code + ' at ' + issue.path);
  }
  for (const issue of validateCompilerOutput(input, output)) {
    failures.push('contract: ' + issue.code + ' at ' + issue.path);
  }

  const spans = [
    ...output.assertions.flatMap((assertion) => assertion.spans),
    ...output.rejected_candidates.flatMap((candidate) => candidate.spans),
  ];
  for (const span of spans) {
    if (span.turn_id !== input.turn.turn_id) {
      failures.push('grounding: span addresses an unavailable turn');
      continue;
    }
    if (!verifyTurnSpan(input.turn.payload, span, 'span').ok) {
      failures.push('grounding: span does not verify against stored source');
    }
  }

  for (const assertion of output.assertions) {
    if (!assertion.spans.some((span) => span.region === 'answer')) {
      failures.push('grounding: accepted assertion lacks answer-region support');
    }
    if (propositionTypeDescriptor(assertion.proposed_type).requires_inspected_evidence) {
      failures.push('evidence: accepted assertion requires unavailable inspected evidence');
    }
  }

  if (output.verdict === 'ambiguous') {
    if (output.assertions.length > 0) {
      failures.push('fail_closed: ambiguous output carried assertions');
    }
    if (output.clarifications_requested.length === 0) {
      failures.push('fail_closed: ambiguous output requested no clarification');
    }
  }
  if (output.verdict === 'no_assertions' && output.assertions.length > 0) {
    failures.push('fail_closed: no_assertions output carried assertions');
  }

  for (const clarification of output.clarifications_requested) {
    if (clarification.prompt.trim().length === 0) {
      failures.push('clarification: prompt is empty');
    }
  }
}

function gradeAssertionSet(
  slots: readonly AllowedAssertion[],
  output: CompilerOutput,
  failures: string[],
): void {
  const slotsByKey = new Map<string, AllowedAssertion>();
  for (const slot of slots) {
    slotsByKey.set(assertionSlotKey(slot.requirement_id, slot.type), slot);
  }

  const occupants = new Map<string, number>();
  for (const assertion of output.assertions) {
    const key = assertionSlotKey(assertion.requirement_id, assertion.proposed_type);
    const slot = slotsByKey.get(key);
    if (!slot) {
      failures.push('assertions: output occupied an undeclared slot');
      continue;
    }

    occupants.set(key, (occupants.get(key) ?? 0) + 1);

    if (
      slot.epistemic_strength !== undefined &&
      !slot.epistemic_strength.includes(assertion.epistemic_strength)
    ) {
      failures.push('assertions: slot used a disallowed epistemic strength');
    }
    if (slot.supersedes !== undefined && assertion.supersedes_candidate !== slot.supersedes) {
      failures.push('assertions: slot used an unexpected supersession target');
    }
    for (const literal of slot.statement_mentions ?? []) {
      if (!foldLiteral(assertion.statement).includes(foldLiteral(literal))) {
        failures.push('assertions: statement omitted an explicit required fixture literal');
      }
    }
  }

  for (const slot of slots) {
    const key = assertionSlotKey(slot.requirement_id, slot.type);
    const count = occupants.get(key) ?? 0;
    if (count > (slot.max ?? 1)) {
      failures.push('assertions: slot cardinality exceeded');
    }
    if (!(slot.optional ?? false) && count === 0) {
      failures.push('assertions: required slot is missing');
    }
  }
}

function gradeClarificationSet(
  expected: readonly ExpectedClarification[],
  output: CompilerOutput,
  failures: string[],
): void {
  const expectedKeys = new Set(
    expected.map((item) => clarificationKey(item.requirement_id, item.reason)),
  );
  const actualCounts = new Map<string, number>();

  for (const clarification of output.clarifications_requested) {
    const key = clarificationKey(clarification.requirement_id, clarification.reason);
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
    if (!expectedKeys.has(key)) {
      failures.push('clarifications: output contained an undeclared metadata pair');
    }
  }

  for (const key of expectedKeys) {
    const count = actualCounts.get(key) ?? 0;
    if (count === 0) {
      failures.push('clarifications: required metadata pair is missing');
    } else if (count > 1) {
      failures.push('clarifications: metadata pair is duplicated');
    }
  }
}

/** Checks the closed-world, case-authored deterministic expectation. */
export function gradeExpectation(
  evalCase: SemanticEvalCase,
  output: CompilerOutput,
  failures: string[],
): void {
  const expected = evalCase.expect;

  if (output.verdict !== expected.verdict) {
    failures.push('verdict: output did not match the expected verdict');
  }

  gradeAssertionSet(expected.assertions, output, failures);
  gradeClarificationSet(expected.clarifications, output, failures);

  for (const forbiddenType of expected.forbidden_types ?? []) {
    if (output.assertions.some((assertion) => assertion.proposed_type === forbiddenType)) {
      failures.push('assertions: output used an explicitly forbidden type');
    }
  }

  if (
    expected.forbid_supersession &&
    output.assertions.some((assertion) => assertion.supersedes_candidate !== null)
  ) {
    failures.push('assertions: output used forbidden supersession');
  }

  const literalSurfaces = [
    ...output.assertions.map((assertion) => assertion.statement),
    ...output.clarifications_requested.map((clarification) => clarification.prompt),
  ];
  for (const forbiddenLiteral of expected.statements_must_not_mention ?? []) {
    if (
      literalSurfaces.some((surface) =>
        foldLiteral(surface).includes(foldLiteral(forbiddenLiteral)),
      )
    ) {
      failures.push('output: used an explicit forbidden fixture literal');
    }
  }
}

export function gradeCompilerOutput(
  evalCase: SemanticEvalCase,
  input: CompilerInput,
  output: CompilerOutput,
): GradeResult {
  const failures: string[] = [];
  gradeUniversal(input, output, failures);
  gradeExpectation(evalCase, output, failures);
  return { ok: failures.length === 0, failures };
}
