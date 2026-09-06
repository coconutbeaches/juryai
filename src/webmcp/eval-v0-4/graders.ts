/**
 * Deterministic V0.4 compiler-output grading.
 *
 * The universal gate is `validateCompilerOutputV04`, NOT the V0.3 or V0.2
 * validators. V0.4 suppresses exactly `compiler_assertion_slot_duplicate` and
 * `compiler_requirement_not_answered` and inherits every other rule, so gating
 * on any other contract would either reject the behaviour under test or admit
 * behaviour V0.4 forbids. A guard pins which validator this module imports.
 *
 * No English is interpreted here. Fixture literals are matched only because a
 * human case author declared exactly which load-bearing literal must appear.
 * Failure text is content-free so reports cannot relay model or case text.
 */

import { canonicalSerialize } from '../../v2/case-envelope.js';
import type { CompilerInput, CompilerOutput } from '../core-v0-3/compiler-contract.js';
import { validateCompilerOutputV04 } from '../core-v0-4/compiler-contract.js';
import { isPropositionType, propositionTypeDescriptor } from '../core-v0-3/types.js';
import { verifyTurnSpan } from '../core/turns.js';
import { matchOneToOne } from './matching.js';
import type {
  EvalFailureV04,
  ExpectedAssertionV04,
  ExpectedClarificationV04,
  GradeResultV04,
  SemanticEvalCaseV04,
} from './types.js';

type Assertion = CompilerOutput['assertions'][number];

const fold = (value: string): string => value.toLocaleLowerCase('en-US');

/**
 * Which rules are HARD BLOCKERS.
 *
 * Every entry describes the model asserting something the record cannot carry
 * — a fabrication, an ungrounded claim, a write outside the supplied context,
 * an invented or misdirected supersession, or a flattened epistemic strength.
 * Missing a supported proposition is an ordinary failure by comparison: thin,
 * not false. They are never averaged together.
 */
const HARD_BLOCKER_RULES: ReadonlySet<string> = new Set([
  'contract',
  'grounding.span_unverified',
  'grounding.span_foreign_turn',
  'grounding.no_answer_region',
  'evidence.requires_inspection',
  'fail_closed.ambiguous_with_assertions',
  'fail_closed.no_assertions_with_assertions',
  'assertions.undeclared_extra',
  'assertions.duplicate_payload',
  'assertions.wrong_supersession_target',
  'assertions.forbidden_supersession',
  'assertions.forbidden_type',
  'assertions.strength_flattened',
  'assertions.material_adverse_fact_missing',
  'output.forbidden_literal',
]);

function failure(rule: string, expectationId?: string): EvalFailureV04 {
  return {
    rule,
    severity: HARD_BLOCKER_RULES.has(rule) ? 'hard_blocker' : 'ordinary',
    ...(expectationId === undefined ? {} : { expectation_id: expectationId }),
  };
}

/** Checks that apply to every case, independent of its semantic expectation. */
export function gradeUniversalV04(
  input: CompilerInput,
  output: CompilerOutput,
  failures: EvalFailureV04[],
): void {
  // `src/webmcp/runtime/compiler-output-shape.ts` is deliberately NOT used
  // here. It validates proposition types against the V0.2-era `core/types.js`
  // vocabulary, which has no `explicit_absence` — so gating on it would reject
  // every assertion in an entire corpus family while reporting only a generic
  // "shape" failure. That is exactly the wrong-oracle problem this parallel
  // evaluator exists to avoid, and it is invisible unless you check which
  // vocabulary the validator actually speaks.
  //
  // The V0.4 contract validates types and strengths against the V0.3-derived
  // vocabulary, which is the one V0.4 speaks.
  // THE V0.4 gate. Not V0.3, not V0.2.
  for (const issue of validateCompilerOutputV04(input, output)) {
    failures.push(failure('contract'));
    void issue;
  }

  const spans = [
    ...output.assertions.flatMap((assertion) => assertion.spans),
    ...output.rejected_candidates.flatMap((candidate) => candidate.spans),
  ];
  for (const span of spans) {
    if (span.turn_id !== input.turn.turn_id) {
      failures.push(failure('grounding.span_foreign_turn'));
      continue;
    }
    if (!verifyTurnSpan(input.turn.payload, span, 'span').ok) {
      failures.push(failure('grounding.span_unverified'));
    }
  }

  for (const assertion of output.assertions) {
    if (!assertion.spans.some((span) => span.region === 'answer')) {
      // An assertion supported only by relayed assistant context is an
      // assertion about the relay's words, not the human's.
      failures.push(failure('grounding.no_answer_region'));
    }
    // Guarded: `propositionTypeDescriptor` THROWS on an unknown type, so an
    // unrecognised `proposed_type` would crash the grader rather than being
    // reported. The contract above already records it as an issue; a grader
    // that dies on bad input cannot report anything at all, which is the worst
    // possible failure mode for an oracle.
    if (
      isPropositionType(assertion.proposed_type) &&
      propositionTypeDescriptor(assertion.proposed_type).requires_inspected_evidence
    ) {
      failures.push(failure('evidence.requires_inspection'));
    }
  }

  if (output.verdict === 'ambiguous') {
    if (output.assertions.length > 0) {
      failures.push(failure('fail_closed.ambiguous_with_assertions'));
    }
    if (output.clarifications_requested.length === 0) {
      failures.push(failure('fail_closed.ambiguous_without_clarification'));
    }
  }
  if (output.verdict === 'no_assertions' && output.assertions.length > 0) {
    failures.push(failure('fail_closed.no_assertions_with_assertions'));
  }
  for (const clarification of output.clarifications_requested) {
    if (clarification.prompt.trim().length === 0) {
      failures.push(failure('clarifications.empty_prompt'));
    }
  }
}

/**
 * Whether one actual assertion could satisfy one expectation.
 *
 * Deterministic, fixture-authored properties only. Note what is NOT here:
 * nothing compares two statements to each other, and nothing decides whether
 * two readings "mean the same thing".
 */
function compatible(expected: ExpectedAssertionV04, actual: Assertion): boolean {
  if (actual.requirement_id !== expected.requirement_id) return false;
  if (actual.proposed_type !== expected.type) return false;
  if (
    expected.epistemic_strengths !== undefined &&
    !expected.epistemic_strengths.includes(actual.epistemic_strength)
  ) {
    return false;
  }
  if (expected.supersedes !== undefined && actual.supersedes_candidate !== expected.supersedes) {
    return false;
  }
  for (const literal of expected.statement_mentions ?? []) {
    if (!fold(actual.statement).includes(fold(literal))) return false;
  }
  return true;
}

/**
 * Canonical order for both sides, so the chosen maximum matching is
 * reproducible no matter how the fixture arrays or the model output were
 * ordered. Expectations sort by their eval-only id; assertions sort by their
 * full canonical serialization, which depends on content alone.
 */
function canonicalOrder<T>(items: readonly T[], key: (item: T) => string): number[] {
  return items
    .map((item, index) => ({ index, key: key(item) }))
    .sort((left, right) => left.key.localeCompare(right.key) || left.index - right.index)
    .map((entry) => entry.index);
}

function gradeAssertionSetV04(
  expected: readonly ExpectedAssertionV04[],
  output: CompilerOutput,
  failures: EvalFailureV04[],
): void {
  /**
   * Required expectations are offered an assertion BEFORE optional ones.
   *
   * Maximum matching maximises the COUNT of matches, and both assignments have
   * the same count when a required and an optional expectation compete for one
   * assertion — so an unweighted matcher could satisfy the optional one and
   * report the required one missing, with the winner decided by which
   * `expectation_id` happened to sort first. Augmenting paths never unmatch a
   * vertex once matched, so processing required first makes required
   * satisfaction take precedence, deterministically.
   */
  /**
   * EXACT-DUPLICATE assertions are rejected BEFORE matching.
   *
   * Two assertions identical in every canonical field, differing only by the
   * model-chosen `assertion_id`, cannot be two distinct facts — they carry the
   * same content. Without this the oracle reports a FALSE GREEN on its own
   * primary question: given two same-slot expectations requiring different
   * literals, a model that merges both propositions AND duplicates the merge
   * emits two identical assertions, each compatible with both expectations.
   * The matcher then finds a perfect assignment — no missing expectation and no
   * extra assertion — and the run passes while the model did exactly the
   * dangerous thing.
   *
   * This is NOT semantic deduplication. No similarity, no threshold, no
   * paraphrase equivalence: it is byte equality of the canonical payload with
   * the id removed. Two genuinely distinct propositions differ somewhere, or
   * they are not distinct.
   */
  const payloadKey = (assertion: Assertion): string => {
    const copy = { ...(assertion as unknown as Record<string, unknown>) };
    delete copy.assertion_id;
    return canonicalSerialize(copy as never);
  };
  const seenPayloads = new Set<string>();
  for (const assertion of output.assertions) {
    const key = payloadKey(assertion);
    if (seenPayloads.has(key)) failures.push(failure('assertions.duplicate_payload'));
    seenPayloads.add(key);
  }

  const expectedOrder = canonicalOrder(
    expected,
    (item) => `${(item.optional ?? false) ? '1' : '0'}|${item.expectation_id}`,
  );
  const actualOrder = canonicalOrder(output.assertions, (item) => canonicalSerialize(item));

  const result = matchOneToOne(expectedOrder.length, actualOrder.length, (e, a) =>
    compatible(expected[expectedOrder[e]!]!, output.assertions[actualOrder[a]!]!),
  );

  for (const expectedSlot of result.unmatchedExpected) {
    const item = expected[expectedOrder[expectedSlot]!]!;
    if (item.optional ?? false) continue;
    failures.push(
      failure(
        (item.material_adverse_fact ?? false)
          ? 'assertions.material_adverse_fact_missing'
          : 'assertions.required_missing',
        item.expectation_id,
      ),
    );
  }

  // CLOSED WORLD. Anything the model emitted that no expectation claimed is
  // over-extraction, and over-extraction in an evidence system is fabrication
  // whether or not the contract would have committed it.
  for (const _ of result.unmatchedActual) {
    failures.push(failure('assertions.undeclared_extra'));
    void _;
  }

  // Diagnose WHY a required expectation went unmatched, where the reason is
  // itself a blocker. Without this, a flattened strength or a swapped
  // supersession target would only ever read as "missing", and a hard failure
  // would be reported as an ordinary one.
  for (const expectedSlot of result.unmatchedExpected) {
    const item = expected[expectedOrder[expectedSlot]!]!;
    // An OPTIONAL expectation may be legitimately absent, so it produces no
    // missing failure — and must produce no mismatch diagnosis either. An
    // optional variant differing from a required one only in strength or
    // supersession target would otherwise emit a HARD BLOCKER precisely when
    // the model got the required reading right and correctly omitted the
    // alternative.
    if (item.optional ?? false) continue;
    // Report the reason by finding an assertion that satisfies EVERY constraint
    // except one. "No same-slot assertion carries the expected target" is too
    // weak: when two assertions swap their supersession targets, one of them
    // DOES carry it, and the swap would be reported only as a generic miss —
    // downgrading a hard blocker to an ordinary failure.
    const strengthOk = (assertion: Assertion): boolean =>
      item.epistemic_strengths === undefined ||
      item.epistemic_strengths.includes(assertion.epistemic_strength);
    const supersedesOk = (assertion: Assertion): boolean =>
      item.supersedes === undefined || assertion.supersedes_candidate === item.supersedes;
    const literalsOk = (assertion: Assertion): boolean =>
      (item.statement_mentions ?? []).every((literal) =>
        fold(assertion.statement).includes(fold(literal)),
      );

    /**
     * Diagnose only when the skipped constraint ACTUALLY DIFFERS.
     *
     * "Matches everything except X" is not enough on its own: when several
     * expectations are compatible with one assertion, an expectation can go
     * unmatched purely because one-to-one already assigned that assertion
     * elsewhere. The assertion then still satisfies X, and reporting a
     * mismatch on X would escalate an ordinary "merged or missing" failure
     * into a HARD BLOCKER. Severity inflation defeats the whole point of
     * separating blockers from ordinary failures — a blocker that fires on
     * correct-but-unassigned output stops meaning anything.
     */
    const differsOn = (
      skip: 'strength' | 'supersedes' | 'literals',
      violated: (assertion: Assertion) => boolean,
    ): boolean =>
      output.assertions.some(
        (assertion) =>
          assertion.requirement_id === item.requirement_id &&
          assertion.proposed_type === item.type &&
          (skip === 'strength' || strengthOk(assertion)) &&
          (skip === 'supersedes' || supersedesOk(assertion)) &&
          (skip === 'literals' || literalsOk(assertion)) &&
          violated(assertion),
      );

    if (
      item.epistemic_strengths !== undefined &&
      differsOn('strength', (assertion) => !strengthOk(assertion))
    ) {
      failures.push(failure('assertions.strength_flattened', item.expectation_id));
    }
    if (
      item.supersedes !== undefined &&
      differsOn('supersedes', (assertion) => !supersedesOk(assertion))
    ) {
      failures.push(failure('assertions.wrong_supersession_target', item.expectation_id));
    }
    if (
      (item.statement_mentions ?? []).length > 0 &&
      differsOn('literals', (assertion) => !literalsOk(assertion))
    ) {
      failures.push(failure('assertions.literal_missing', item.expectation_id));
    }
  }
}

function gradeClarificationSetV04(
  expected: readonly ExpectedClarificationV04[],
  output: CompilerOutput,
  failures: EvalFailureV04[],
): void {
  const key = (requirementId: string, reason: string): string => `${requirementId}|${reason}`;
  const expectedKeys = new Set(expected.map((item) => key(item.requirement_id, item.reason)));
  const counts = new Map<string, number>();
  for (const clarification of output.clarifications_requested) {
    const id = key(clarification.requirement_id, clarification.reason);
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!expectedKeys.has(id)) failures.push(failure('clarifications.undeclared'));
  }
  for (const id of expectedKeys) {
    const count = counts.get(id) ?? 0;
    if (count === 0) failures.push(failure('clarifications.required_missing'));
    else if (count > 1) failures.push(failure('clarifications.duplicated'));
  }
}

export function gradeExpectationV04(
  evalCase: SemanticEvalCaseV04,
  output: CompilerOutput,
  failures: EvalFailureV04[],
): void {
  const expected = evalCase.expect;
  if (output.verdict !== expected.verdict) failures.push(failure('verdict.mismatch'));

  gradeAssertionSetV04(expected.assertions, output, failures);
  gradeClarificationSetV04(expected.clarifications, output, failures);

  for (const forbiddenType of expected.forbidden_types ?? []) {
    if (output.assertions.some((assertion) => assertion.proposed_type === forbiddenType)) {
      failures.push(failure('assertions.forbidden_type'));
    }
  }
  if (
    (expected.forbid_supersession ?? false) &&
    output.assertions.some((assertion) => assertion.supersedes_candidate !== null)
  ) {
    failures.push(failure('assertions.forbidden_supersession'));
  }

  const surfaces = [
    ...output.assertions.map((assertion) => assertion.statement),
    ...output.clarifications_requested.map((clarification) => clarification.prompt),
  ];
  for (const literal of expected.statements_must_not_mention ?? []) {
    if (surfaces.some((surface) => fold(surface).includes(fold(literal)))) {
      failures.push(failure('output.forbidden_literal'));
    }
  }
}

export function gradeCompilerOutputV04(
  evalCase: SemanticEvalCaseV04,
  input: CompilerInput,
  output: CompilerOutput,
): GradeResultV04 {
  const failures: EvalFailureV04[] = [];
  gradeUniversalV04(input, output, failures);
  gradeExpectationV04(evalCase, output, failures);
  return {
    ok: failures.length === 0,
    failures,
    hard_blockers: failures.filter((entry) => entry.severity === 'hard_blocker'),
    ordinary_failures: failures.filter((entry) => entry.severity === 'ordinary'),
  };
}
