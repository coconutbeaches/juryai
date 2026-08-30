/**
 * Semantic grading.
 *
 * "The JSON parsed" is not a result. Every grader here asks a question about
 * MEANING or about SAFETY, and the universal graders run on every case in the
 * corpus regardless of what that case was written to probe — so a compiler
 * cannot pass a fabrication case by being careful only where the fixture
 * happened to look.
 *
 * Grading is property-based. Canonical wording belongs to the compiler; what
 * it may and may not put in that wording does not. Where a value is
 * load-bearing (a date, an amount, an obligation) the grader asserts the value
 * is present or absent, never the sentence around it.
 */

import {
  validateCompilerOutput,
  type CompilerInput,
  type CompilerOutput,
} from '../core/compiler-contract.js';
import { verifyTurnSpan } from '../core/turns.js';
import { propositionTypeDescriptor } from '../core/types.js';
import { validateCompilerOutputShape } from '../runtime/compiler-output-shape.js';
import type { SemanticEvalCase } from './types.js';

export interface GradeResult {
  ok: boolean;
  failures: string[];
}

function fold(text: string): string {
  return text.toLowerCase();
}

/**
 * Graders that apply to EVERY case. These encode the compiler's standing
 * obligations rather than any one scenario's expectations.
 */
export function gradeUniversal(
  input: CompilerInput,
  output: CompilerOutput,
  failures: string[],
): void {
  // 1. The structural and contract layers the runtime will apply anyway. An
  //    eval that skipped them could report a semantic pass for output the
  //    runtime would have thrown away.
  for (const issue of validateCompilerOutputShape(output)) {
    failures.push('shape: ' + issue.path + ' ' + issue.message);
  }
  for (const issue of validateCompilerOutput(input, output)) {
    failures.push('contract: ' + issue.path + ' ' + issue.message);
  }

  // 2. Every quotation must be exact in the supplied turn, re-verified here
  //    rather than assumed from the compiler's own bookkeeping.
  const allSpans = [
    ...output.assertions.flatMap((assertion) => assertion.spans),
    ...output.rejected_candidates.flatMap((candidate) => candidate.spans),
  ];
  for (const span of allSpans) {
    if (span.turn_id !== input.turn.turn_id) {
      failures.push('grounding: span addresses a turn outside this compile run');
      continue;
    }
    const verification = verifyTurnSpan(input.turn.payload, span, 'span');
    if (!verification.ok) {
      failures.push('grounding: quoted text is not exact in the stored turn');
    }
  }

  // 3. Answer-region grounding. An assertion supported only by relayed
  //    assistant context is an assertion about the relay, not the human.
  for (const assertion of output.assertions) {
    if (!assertion.spans.some((span) => span.region === 'answer')) {
      failures.push(
        'grounding: assertion ' + assertion.assertion_id + ' has no answer-region span',
      );
    }
  }

  // 4. Nothing relayed through WebMCP has been inspected, so no assertion may
  //    claim a type that requires inspected evidence.
  for (const assertion of output.assertions) {
    if (propositionTypeDescriptor(assertion.proposed_type).requires_inspected_evidence) {
      failures.push(
        'evidence: assertion ' +
          assertion.assertion_id +
          " claims type '" +
          assertion.proposed_type +
          "' which requires inspected evidence",
      );
    }
  }

  // 5. Fail-closed shape: ambiguity carries no assertions and says what it
  //    needs; no_assertions carries none either.
  if (output.verdict === 'ambiguous') {
    if (output.assertions.length > 0) failures.push('fail_closed: ambiguous carried assertions');
    if (output.clarifications_requested.length === 0) {
      failures.push('fail_closed: ambiguous requested no clarification');
    }
  }
  if (output.verdict === 'no_assertions' && output.assertions.length > 0) {
    failures.push('fail_closed: no_assertions carried assertions');
  }

  // 6. A clarification with an empty prompt is a clarification that cannot be
  //    put to a human.
  for (const clarification of output.clarifications_requested) {
    if (clarification.prompt.trim().length === 0) {
      failures.push('clarification: empty prompt for ' + clarification.requirement_id);
    }
  }
}

/** Case-specific semantic expectations. */
export function gradeExpectation(
  evalCase: SemanticEvalCase,
  output: CompilerOutput,
  failures: string[],
): void {
  const expect = evalCase.expect;

  if (output.verdict !== expect.verdict) {
    failures.push('verdict: expected ' + expect.verdict + ', got ' + output.verdict);
  }

  if (expect.max_assertions !== undefined && output.assertions.length > expect.max_assertions) {
    failures.push(
      'assertions: expected at most ' +
        String(expect.max_assertions) +
        ', got ' +
        String(output.assertions.length),
    );
  }

  for (const required of expect.required_assertions ?? []) {
    const candidates = output.assertions.filter(
      (assertion) =>
        assertion.requirement_id === required.requirement_id &&
        assertion.proposed_type === required.type,
    );
    if (candidates.length === 0) {
      failures.push(
        "missing: no '" + required.type + "' assertion against " + required.requirement_id,
      );
      continue;
    }
    const matched = candidates.filter((assertion) => {
      if (
        required.epistemic_strength &&
        !required.epistemic_strength.includes(assertion.epistemic_strength)
      ) {
        return false;
      }
      if (
        required.supersedes !== undefined &&
        assertion.supersedes_candidate !== required.supersedes
      ) {
        return false;
      }
      for (const mention of required.statement_mentions ?? []) {
        if (!fold(assertion.statement).includes(fold(mention))) return false;
      }
      return true;
    });
    if (matched.length === 0) {
      const actual = candidates[0]!;
      failures.push(
        "mismatch: '" +
          required.type +
          "' assertion against " +
          required.requirement_id +
          ' did not match its expected properties (strength=' +
          actual.epistemic_strength +
          ', supersedes=' +
          String(actual.supersedes_candidate) +
          ", statement='" +
          actual.statement +
          "')",
      );
    }
  }

  for (const type of expect.forbidden_types ?? []) {
    if (output.assertions.some((assertion) => assertion.proposed_type === type)) {
      failures.push("forbidden: asserted type '" + type + "'");
    }
  }

  for (const pair of expect.forbidden_requirement_types ?? []) {
    if (
      output.assertions.some(
        (assertion) =>
          assertion.requirement_id === pair.requirement_id && assertion.proposed_type === pair.type,
      )
    ) {
      failures.push("forbidden: asserted '" + pair.type + "' against " + pair.requirement_id);
    }
  }

  for (const requirementId of expect.requirements_without_assertions ?? []) {
    if (output.assertions.some((assertion) => assertion.requirement_id === requirementId)) {
      failures.push('forbidden: asserted anything against ' + requirementId);
    }
  }

  if (expect.forbid_supersession) {
    for (const assertion of output.assertions) {
      if (assertion.supersedes_candidate !== null) {
        failures.push(
          'forbidden: assertion ' +
            assertion.assertion_id +
            ' proposed a supersession where the relationship is not determinate',
        );
      }
    }
  }

  // Fabrication resistance. Checked across statements AND clarification
  // prompts: a value the human never gave is no less invented for appearing in
  // a question put back to them.
  const surfaces = [
    ...output.assertions.map((assertion) => assertion.statement),
    ...output.clarifications_requested.map((clarification) => clarification.prompt),
  ];
  for (const forbidden of expect.statements_must_not_mention ?? []) {
    for (const surface of surfaces) {
      if (fold(surface).includes(fold(forbidden))) {
        failures.push(
          "fabrication: output mentions '" + forbidden + "', which the answer never gave",
        );
        break;
      }
    }
  }

  for (const reason of expect.clarification_reasons ?? []) {
    if (!output.clarifications_requested.some((clarification) => clarification.reason === reason)) {
      failures.push("clarification: expected a clarification with reason '" + reason + "'");
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
