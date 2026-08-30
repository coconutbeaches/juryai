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
import type { AllowedAssertion, ExpectedClarification, SemanticEvalCase } from './types.js';

export interface GradeResult {
  ok: boolean;
  failures: string[];
}

function fold(text: string): string {
  return text.toLowerCase();
}

/**
 * Fact-shaped tokens that canonical prose may not add unless its exact answer
 * citations contain them. This is intentionally narrower than general lexical
 * overlap: prose may paraphrase, but names, numeric values, currencies and
 * calendar terms are audit facts rather than style.
 */
function factMarkers(text: string): string[] {
  const markers = new Set<string>();
  for (const match of text.matchAll(/\b\d[\d,.]*\b/gu)) markers.add(match[0]);
  for (const match of text.matchAll(
    /\b(?:pounds?|dollars?|euros?|gbp|usd|eur|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/giu,
  )) {
    markers.add(match[0]);
  }
  for (const match of text.matchAll(/\b[A-Z][A-Za-z'-]*\b/gu)) {
    if (['The', 'A', 'An', 'There', 'That', 'It', 'I', 'We'].includes(match[0])) continue;
    markers.add(match[0]);
  }
  return [...markers];
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

  gradeAssertionSet(expect.assertions, output, failures);
  gradeClarificationSet(expect.clarifications, output, failures);

  for (const type of expect.forbidden_types ?? []) {
    if (output.assertions.some((assertion) => assertion.proposed_type === type)) {
      failures.push("forbidden: asserted type '" + type + "'");
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
}

function slotKey(requirementId: string, type: string): string {
  return requirementId + '|' + type;
}

function describeSlot(slot: AllowedAssertion): string {
  return "'" + slot.type + "' against " + slot.requirement_id;
}

/**
 * Closed-world grading of the accepted assertions.
 *
 * Three questions, in order, because they fail for different reasons and the
 * message has to say which: is this reading PERMITTED at all, does it look the
 * way the slot requires, and did the compiler produce every reading it should
 * have?
 *
 * The first question is the one the runtime cannot ask. A contract-valid extra
 * assertion — say a `non_recollection` alongside a real `payment` for the same
 * requirement — is structurally fine, so the runtime commits it. Only a
 * semantic expectation knows the person did in fact remember.
 */
function gradeAssertionSet(
  slots: readonly AllowedAssertion[],
  output: CompilerOutput,
  failures: string[],
): void {
  const byKey = new Map<string, AllowedAssertion>();
  for (const slot of slots) byKey.set(slotKey(slot.requirement_id, slot.type), slot);

  const occupants = new Map<string, number>();
  const conforming = new Set<string>();

  for (const assertion of output.assertions) {
    const key = slotKey(assertion.requirement_id, assertion.proposed_type);
    const slot = byKey.get(key);
    if (!slot) {
      failures.push(
        'over-extraction: assertion ' +
          assertion.assertion_id +
          " proposed '" +
          assertion.proposed_type +
          "' against " +
          assertion.requirement_id +
          ', which this case does not permit',
      );
      continue;
    }

    occupants.set(key, (occupants.get(key) ?? 0) + 1);

    const problems: string[] = [];
    if (
      slot.epistemic_strength &&
      !slot.epistemic_strength.includes(assertion.epistemic_strength)
    ) {
      problems.push('strength=' + assertion.epistemic_strength);
    }
    if (slot.supersedes !== undefined && assertion.supersedes_candidate !== slot.supersedes) {
      problems.push('supersedes=' + String(assertion.supersedes_candidate));
    }
    for (const mention of slot.statement_mentions ?? []) {
      if (!fold(assertion.statement).includes(fold(mention))) {
        problems.push("statement omits '" + mention + "'");
      }
    }
    const answerCitations = assertion.spans
      .filter((span) => span.region === 'answer')
      .map((span) => span.quote)
      .join(' ');
    for (const alternatives of slot.citation_must_mention) {
      if (!alternatives.some((term) => fold(answerCitations).includes(fold(term)))) {
        problems.push("citation does not support topic '" + alternatives.join('|') + "'");
      }
    }
    for (const marker of factMarkers(assertion.statement)) {
      if (!fold(answerCitations).includes(fold(marker))) {
        problems.push("statement adds unsupported fact '" + marker + "'");
      }
    }
    if (problems.length === 0) {
      conforming.add(key);
    } else {
      failures.push(
        'mismatch: ' +
          describeSlot(slot) +
          ' did not match its expected properties (' +
          problems.join(', ') +
          "; statement='" +
          assertion.statement +
          "')",
      );
    }
  }

  for (const slot of slots) {
    const key = slotKey(slot.requirement_id, slot.type);
    const count = occupants.get(key) ?? 0;
    const max = slot.max ?? 1;
    if (count > max) {
      failures.push(
        'cardinality: ' +
          describeSlot(slot) +
          ' permits at most ' +
          String(max) +
          ' assertion(s), got ' +
          String(count),
      );
    }
    if (!(slot.optional ?? false) && !conforming.has(key)) {
      // Only reported when nothing conforming filled the slot; a mismatch has
      // already been reported above and does not need saying twice.
      if (count === 0) failures.push('missing: no ' + describeSlot(slot));
    }
  }
}

/**
 * Closed-world grading of the clarifications, matched as atomic pairs.
 *
 * The requirement and the reason must appear on the SAME clarification object.
 * A compiler that asks for the right kind of clarification about the wrong
 * requirement is asking the person the wrong question, and the runtime cannot
 * tell — the wrong requirement is a perfectly real requirement on the case.
 */
function gradeClarificationSet(
  expected: readonly ExpectedClarification[],
  output: CompilerOutput,
  failures: string[],
): void {
  for (const pair of expected) {
    const metadataMatches = output.clarifications_requested.filter(
      (clarification) =>
        clarification.requirement_id === pair.requirement_id &&
        clarification.reason === pair.reason,
    );
    if (metadataMatches.length === 0) {
      failures.push(
        "clarification: expected reason '" +
          pair.reason +
          "' on requirement " +
          pair.requirement_id +
          ', and no single clarification carried both',
      );
      continue;
    }

    if (metadataMatches.length > 1) {
      failures.push(
        'clarification: duplicate clarification metadata for ' +
          pair.requirement_id +
          " with reason '" +
          pair.reason +
          "'",
      );
    }

    for (const clarification of metadataMatches) {
      const promptMatches = pair.prompt_must_mention.every((alternatives) =>
        alternatives.some((term) => fold(clarification.prompt).includes(fold(term))),
      );
      if (!promptMatches) {
        failures.push(
          'clarification: prompt for ' +
            pair.requirement_id +
            " carried the expected reason '" +
            pair.reason +
            "' but did not ask about every required topic",
        );
      }
    }
  }

  for (const clarification of output.clarifications_requested) {
    const permitted = expected.some(
      (pair) =>
        pair.requirement_id === clarification.requirement_id &&
        pair.reason === clarification.reason,
    );
    if (!permitted) {
      failures.push(
        "clarification: unexpected '" +
          clarification.reason +
          "' clarification on " +
          clarification.requirement_id,
      );
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
