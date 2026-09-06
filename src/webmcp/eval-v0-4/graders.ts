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
import type { PropositionType } from '../core-v0-3/types.js';
import { verifyTurnSpan } from '../core/turns.js';
import { matchOneToOne } from './matching.js';
import { expectationAlternatives } from './types.js';
import type {
  EvalFailureV04,
  ExpectedAssertionV04,
  ExpectedClarificationV04,
  GradeResultV04,
  SemanticEvalCaseV04,
  SemanticExpectationV04,
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
  return statementLiteralsOk(expected, actual);
}

/**
 * Every literal constraint on one assertion's statement.
 *
 * Three exact, fixture-authored checks and nothing else — no similarity, no
 * threshold, no paraphrase judgement:
 *
 *  - `statement_mentions`: ALL must appear.
 *  - `statement_mentions_any_of`: ANY ONE all-of group must be satisfied,
 *    which is how a value with several legitimate surface forms is expressed
 *    without pinning one arbitrarily.
 *  - `statement_must_not_mention`: NONE may appear, scoped to this assertion.
 */
function statementLiteralsOk(expected: ExpectedAssertionV04, actual: Assertion): boolean {
  const statement = fold(actual.statement);
  for (const literal of expected.statement_mentions ?? []) {
    if (!statement.includes(fold(literal))) return false;
  }
  const groups = expected.statement_mentions_any_of;
  if (groups !== undefined) {
    // BOTH degenerate forms are fixture-authoring errors that would otherwise
    // produce a FALSE GREEN: `[]` skips the constraint entirely, and `[[]]`
    // succeeds vacuously because `every` on an empty array is true. Either way
    // an arbitrary statement satisfies an expectation that claims to declare a
    // finite set of permitted forms. Refused loudly, exactly as an empty
    // `any_of` and an empty clarification reason set are.
    if (groups.length === 0) {
      throw new TypeError(
        'statement_mentions_any_of must declare at least one alternative literal group.',
      );
    }
    for (const group of groups) {
      if (group.length === 0) {
        throw new TypeError(
          'A statement_mentions_any_of group must declare at least one literal; an empty group is satisfied by any statement.',
        );
      }
    }
    const anyGroupSatisfied = groups.some((group) =>
      group.every((literal) => statement.includes(fold(literal))),
    );
    if (!anyGroupSatisfied) return false;
  }
  for (const forbidden of expected.statement_must_not_mention ?? []) {
    if (statement.includes(fold(forbidden))) return false;
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
    const literalsOk = (assertion: Assertion): boolean => statementLiteralsOk(item, assertion);

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
    const hasLiteralConstraint =
      (item.statement_mentions ?? []).length > 0 ||
      (item.statement_mentions_any_of ?? []).length > 0 ||
      (item.statement_must_not_mention ?? []).length > 0;
    if (hasLiteralConstraint && differsOn('literals', (assertion) => !literalsOk(assertion))) {
      failures.push(failure('assertions.literal_missing', item.expectation_id));
    }
  }
}

/** The reasons a fixture declares acceptable for one expected clarification. */
function acceptableReasons(expected: ExpectedClarificationV04): readonly string[] {
  const declared = expected.reasons ?? [expected.reason];
  if (declared.length === 0) {
    // An empty set accepts nothing, so the expectation could only ever be
    // reported missing. That is an authoring mistake, not a grading result.
    throw new TypeError('An expected clarification must declare at least one acceptable reason.');
  }
  return declared;
}

/**
 * Grades clarifications closed-world and ONE-TO-ONE.
 *
 * Previously this compared a Set of `requirement|reason` keys. That could not
 * express a doctrinally equivalent pair of reasons, and it also COLLAPSED two
 * identical expectations into one key — so a single clarification satisfied
 * both, which is the same false-green shape the assertion matcher was rebuilt
 * to prevent in 8C1b-0. Both are fixed here by matching the two sides the way
 * assertions are matched.
 *
 * Behaviour for single-reason fixtures is otherwise unchanged: an unaccepted
 * clarification is `undeclared` once per occurrence, a repeated accepted pair
 * is `duplicated` once, and an expectation nothing satisfies is
 * `required_missing`.
 */
function gradeClarificationSetV04(
  expected: readonly ExpectedClarificationV04[],
  output: CompilerOutput,
  failures: EvalFailureV04[],
): void {
  type Clarification = CompilerOutput['clarifications_requested'][number];
  const accepts = (item: ExpectedClarificationV04, actual: Clarification): boolean =>
    actual.requirement_id === item.requirement_id &&
    acceptableReasons(item).includes(actual.reason);

  // Collapse exact repeats so a duplicate cannot occupy a second matching slot.
  const seen = new Map<string, { clarification: Clarification; count: number }>();
  for (const clarification of output.clarifications_requested) {
    const id = `${clarification.requirement_id}|${clarification.reason}`;
    const entry = seen.get(id);
    if (entry === undefined) seen.set(id, { clarification, count: 1 });
    else entry.count += 1;
  }
  const distinct = [...seen.values()];

  const acceptedBySome = (clarification: Clarification): boolean =>
    expected.some((item) => accepts(item, clarification));

  for (const entry of distinct) {
    if (!acceptedBySome(entry.clarification)) {
      // Reported per occurrence, as before.
      for (let index = 0; index < entry.count; index += 1) {
        failures.push(failure('clarifications.undeclared'));
      }
    } else if (entry.count > 1) {
      failures.push(failure('clarifications.duplicated'));
    }
  }

  const candidates = distinct.filter((entry) => acceptedBySome(entry.clarification));
  const expectedOrder = canonicalOrder(
    expected,
    (item) => `${item.requirement_id}|${[...acceptableReasons(item)].sort().join(',')}`,
  );
  const actualOrder = canonicalOrder(
    candidates,
    (entry) => `${entry.clarification.requirement_id}|${entry.clarification.reason}`,
  );
  const result = matchOneToOne(expectedOrder.length, actualOrder.length, (e, a) =>
    accepts(expected[expectedOrder[e]!]!, candidates[actualOrder[a]!]!.clarification),
  );

  for (const _ of result.unmatchedExpected) {
    failures.push(failure('clarifications.required_missing'));
    void _;
  }
  // An accepted clarification no expectation could claim is still over-asking.
  // Unreachable for single-reason fixtures, where only one pair can match.
  for (const _ of result.unmatchedActual) {
    failures.push(failure('clarifications.undeclared'));
    void _;
  }
}

/**
 * Grades output against ONE complete expectation shape, closed-world.
 *
 * Exported so a caller can grade a single alternative in isolation; nothing
 * here knows that alternatives exist.
 */
/** The SHAPE half: verdict, assertions, clarifications. */
function gradeOutputShapeV04(
  expected: SemanticExpectationV04,
  output: CompilerOutput,
  failures: EvalFailureV04[],
): void {
  if (output.verdict !== expected.verdict) failures.push(failure('verdict.mismatch'));
  gradeAssertionSetV04(expected.assertions, output, failures);
  gradeClarificationSetV04(expected.clarifications, output, failures);
}

/**
 * The CASE-WIDE INVARIANT half: forbidden types, forbidden supersession,
 * forbidden literals.
 *
 * These are not descriptions of a particular output shape. They say "whatever
 * shape the output takes, it must not do this" — so under alternatives they are
 * evaluated ONCE over the union, never per branch. A branch that merely omits
 * one must not be able to excuse it.
 */
function gradeCaseInvariantsV04(
  invariants: {
    forbidden_types?: readonly PropositionType[];
    forbid_supersession?: boolean;
    statements_must_not_mention?: readonly string[];
  },
  output: CompilerOutput,
  failures: EvalFailureV04[],
): void {
  for (const forbiddenType of invariants.forbidden_types ?? []) {
    if (output.assertions.some((assertion) => assertion.proposed_type === forbiddenType)) {
      failures.push(failure('assertions.forbidden_type'));
    }
  }
  if (
    (invariants.forbid_supersession ?? false) &&
    output.assertions.some((assertion) => assertion.supersedes_candidate !== null)
  ) {
    failures.push(failure('assertions.forbidden_supersession'));
  }
  const surfaces = [
    ...output.assertions.map((assertion) => assertion.statement),
    ...output.clarifications_requested.map((clarification) => clarification.prompt),
  ];
  for (const literal of invariants.statements_must_not_mention ?? []) {
    if (surfaces.some((surface) => fold(surface).includes(fold(literal)))) {
      failures.push(failure('output.forbidden_literal'));
    }
  }
}

/**
 * Grades output against ONE complete expectation shape, closed-world.
 *
 * Shape first, then invariants — the original check order, preserved exactly so
 * single-expectation fixtures report failures in the sequence they always did.
 */
export function gradeAgainstExpectationV04(
  expected: SemanticExpectationV04,
  output: CompilerOutput,
  failures: EvalFailureV04[],
): void {
  gradeOutputShapeV04(expected, output, failures);
  gradeCaseInvariantsV04(expected, output, failures);
}

/**
 * Grades output against a case's expectation, which may declare ALTERNATIVES.
 *
 * The case passes iff at least one COMPLETE alternative passes. Fields are
 * never mixed across alternatives, so a hybrid the doctrine does not license —
 * `ambiguous` carrying an assertion, or a verdict from one branch with a
 * clarification from another — satisfies no branch and fails.
 *
 * DIAGNOSTICS WHEN NOTHING PASSES. Concatenating every branch's failures would
 * manufacture hard blockers from branches the output was never trying to
 * satisfy. So:
 *
 *  - A failure is reported as a HARD BLOCKER only when that rule fires under
 *    EVERY declared alternative. Such a failure is branch-independent: no
 *    permitted shape excuses it, which is exactly what "safety" should mean
 *    here. Fabrication, foreign-scope writes, laundering, invalid supersession
 *    and forbidden types therefore cannot be washed out by adding a branch that
 *    happens not to check them — they are only excused if a branch genuinely
 *    permits the output, and then that branch passes outright.
 *  - Remaining detail comes from ONE deterministically chosen best-matching
 *    alternative: fewest hard failures, then fewest total, then declaration
 *    order. Those are branch-contingent, so they are reported at ordinary
 *    severity with their rule names preserved.
 *
 * Universal checks are not run here at all; they run once, in
 * `gradeCompilerOutputV04`, and always apply.
 */
/**
 * Grades output against a case's expectation, which may declare ALTERNATIVES.
 *
 * The case passes iff at least one COMPLETE alternative shape passes AND the
 * case-wide invariants hold. Fields are never mixed across alternatives, so a
 * hybrid the doctrine does not license satisfies no branch and fails.
 *
 * CASE-WIDE INVARIANTS ARE NOT PART OF THE ALTERNATION, and that is the
 * correction a bounded review forced. Previously each branch carried its own
 * `forbidden_types` / `forbid_supersession` / `statements_must_not_mention`, so
 * adding a STRICT SUBSET branch — one permitting the same shape but declaring
 * no guard — let an output violating that guard satisfy the unguarded branch
 * completely and return GREEN. An invalid supersession or a declared
 * counterexample could be washed all the way out by a branch that simply did
 * not look. Reproduced before fixing: a single guarded expectation correctly
 * failed, and the same expectation plus an unguarded twin passed with zero
 * failures.
 *
 * So the invariants are UNIONED across every alternative and evaluated ONCE,
 * outside the alternation. A branch can never weaken them, only add to them.
 *
 * DIAGNOSTICS WHEN NO SHAPE MATCHES. Concatenating every branch's failures
 * would manufacture hard blockers from branches the output never tried to
 * satisfy. So a shape failure is HARD only when its rule fires under EVERY
 * alternative — branch-independent — and the remaining detail comes from one
 * deterministically chosen best-matching alternative, reported at ordinary
 * severity because another declared shape does not object to it.
 *
 * Universal, contract and grounding checks are not run here at all; they run
 * once in `gradeCompilerOutputV04` and always apply.
 */
export function gradeExpectationV04(
  evalCase: SemanticEvalCaseV04,
  output: CompilerOutput,
  failures: EvalFailureV04[],
): void {
  const alternatives = expectationAlternatives(evalCase.expect);

  // SINGLE EXPECTATION: the original path, byte for byte. Routing it through
  // the alternation machinery re-ordered failures by severity, which changed
  // reported output for mixed-severity cases even though `ok` was unaffected.
  if (alternatives.length === 1) {
    gradeAgainstExpectationV04(alternatives[0] as SemanticExpectationV04, output, failures);
    return;
  }

  assertAlternativesCoherent(alternatives);

  // Union of the case-wide invariants, applied once and unconditionally.
  gradeCaseInvariantsV04(
    {
      forbidden_types: [...new Set(alternatives.flatMap((item) => item.forbidden_types ?? []))],
      forbid_supersession: alternatives.some((item) => item.forbid_supersession ?? false),
      statements_must_not_mention: [
        ...new Set(alternatives.flatMap((item) => item.statements_must_not_mention ?? [])),
      ],
    },
    output,
    failures,
  );

  const graded = alternatives.map((alternative) => {
    const branch: EvalFailureV04[] = [];
    gradeOutputShapeV04(alternative, output, branch);
    return branch;
  });

  // Any alternative shape satisfied completely means the shape expectation is
  // met. Invariant failures above still stand on their own.
  if (graded.some((branch) => branch.length === 0)) return;

  const hardRulesIn = (branch: readonly EvalFailureV04[]): Set<string> =>
    new Set(branch.filter((entry) => entry.severity === 'hard_blocker').map((entry) => entry.rule));

  let universalHardRules = hardRulesIn(graded[0] as EvalFailureV04[]);
  for (const branch of graded.slice(1)) {
    const rules = hardRulesIn(branch);
    universalHardRules = new Set([...universalHardRules].filter((rule) => rules.has(rule)));
  }

  const best = graded.reduce((chosen, branch) => {
    const hard = (entries: readonly EvalFailureV04[]): number =>
      entries.filter((entry) => entry.severity === 'hard_blocker').length;
    if (hard(branch) !== hard(chosen)) return hard(branch) < hard(chosen) ? branch : chosen;
    return branch.length < chosen.length ? branch : chosen;
  }, graded[0] as EvalFailureV04[]);

  const reportedHard = new Set<string>();
  for (const entry of best) {
    if (entry.severity === 'hard_blocker' && universalHardRules.has(entry.rule)) {
      failures.push(entry);
      reportedHard.add(entry.rule);
    }
  }
  for (const rule of universalHardRules) {
    if (!reportedHard.has(rule)) failures.push(failure(rule));
  }
  for (const entry of best) {
    if (entry.severity === 'hard_blocker' && universalHardRules.has(entry.rule)) continue;
    failures.push({ ...entry, severity: 'ordinary' });
  }
}

/**
 * Refuses incoherent alternatives.
 *
 * Because invariants are unioned, an alternative that FORBIDS what another
 * alternative REQUIRES would make that second branch unsatisfiable — silently,
 * and for a reason no failure message would explain. That is a fixture-authoring
 * error, so it is refused rather than graded.
 */
function assertAlternativesCoherent(alternatives: readonly SemanticExpectationV04[]): void {
  const forbiddenTypes = new Set(alternatives.flatMap((item) => item.forbidden_types ?? []));
  const forbiddenLiterals = alternatives.flatMap((item) => item.statements_must_not_mention ?? []);
  for (const alternative of alternatives) {
    for (const expectation of alternative.assertions) {
      if (forbiddenTypes.has(expectation.type)) {
        throw new TypeError(
          `Alternative expects proposition type '${expectation.type}' while another alternative forbids it.`,
        );
      }
      for (const literal of expectation.statement_mentions ?? []) {
        if (forbiddenLiterals.some((forbidden) => fold(forbidden) === fold(literal))) {
          throw new TypeError(
            `Alternative requires the literal '${literal}' while another alternative forbids it.`,
          );
        }
      }
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
