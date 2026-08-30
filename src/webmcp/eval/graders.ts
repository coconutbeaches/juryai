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
 * is present or absent, never the sentence around it. Failure messages must
 * likewise describe the rule without copying model-produced case content.
 */

import {
  validateCompilerOutput,
  type CompilerInput,
  type CompilerOutput,
} from '../core/compiler-contract.js';
import { verifyTurnSpan } from '../core/turns.js';
import { propositionTypeDescriptor, type PropositionType } from '../core/types.js';
import { validateCompilerOutputShape } from '../runtime/compiler-output-shape.js';
import type { AllowedAssertion, ExpectedClarification, SemanticEvalCase } from './types.js';

export interface GradeResult {
  ok: boolean;
  failures: string[];
}

function fold(text: string): string {
  return text.toLowerCase();
}

interface WordToken {
  raw: string;
  folded: string;
  start: number;
  end: number;
}

function wordTokens(text: string): WordToken[] {
  return [...text.matchAll(/\p{L}+(?:['’]\p{L}+)*/gu)].map((match) => ({
    raw: match[0],
    folded: fold(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function words(text: string): string[] {
  return wordTokens(text).map((token) => token.folded);
}

const ENTITY_NEUTRAL_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'by',
  'for',
  'from',
  'he',
  'her',
  'him',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'other',
  'parties',
  'party',
  'she',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'to',
  'user',
  'was',
  'were',
]);

const ENTITY_ROLE_LABELS = new Set([
  'builder',
  'buyer',
  'client',
  'company',
  'contractor',
  'customer',
  'installer',
  'recipient',
  'seller',
  'supplier',
  'vendor',
]);

const ENTITY_INTRODUCERS: Partial<Record<PropositionType, ReadonlySet<string>>> = {
  payment: new Set(['paid', 'pay', 'to']),
  invoice: new Set(['by', 'from']),
  requested_scope: new Set(['asked', 'hired', 'told']),
  accepted_scope: new Set(['by', 'with']),
  requested_remedy: new Set(['asked', 'from', 'to']),
  disputed_balance: new Set(['against', 'by', 'from', 'to']),
};

function isSentenceInitial(text: string, tokens: readonly WordToken[], index: number): boolean {
  if (index === 0) return true;
  return /[.!?]\s*$/u.test(text.slice(tokens[index - 1]!.end, tokens[index]!.start));
}

/**
 * Detects name-shaped additions without treating every paraphrase as an
 * entity. Uncited title-case words away from a sentence boundary are
 * name-shaped; lowercased names are caught when they occupy a proposition's
 * party/recipient position (for example, after "paid" or payment "to").
 * Ordinary uncited verbs such as "completed" remain legitimate canonical
 * paraphrase rather than becoming a global vocabulary maintenance problem.
 */
function addsUnsupportedEntityToken(
  type: PropositionType,
  statement: string,
  answerCitations: string,
): boolean {
  const cited = new Set(words(answerCitations));
  const tokens = wordTokens(statement);
  const introducers = ENTITY_INTRODUCERS[type] ?? new Set<string>();
  for (const [index, token] of tokens.entries()) {
    if (cited.has(token.folded) || ENTITY_NEUTRAL_WORDS.has(token.folded)) continue;
    if (POLARITY_PREDICATES[type]?.has(token.folded) ?? false) continue;
    if (/^\p{Lu}/u.test(token.raw) && !isSentenceInitial(statement, tokens, index)) return true;
    const previous = tokens[index - 1]?.folded;
    if (previous !== undefined && introducers.has(previous)) return true;
    if (previous !== undefined && ENTITY_ROLE_LABELS.has(previous)) {
      let beforeRoleIndex = index - 2;
      while (
        beforeRoleIndex >= 0 &&
        ['a', 'an', 'the'].includes(tokens[beforeRoleIndex]?.folded ?? '')
      ) {
        beforeRoleIndex -= 1;
      }
      const beforeRole = tokens[beforeRoleIndex]?.folded;
      if (beforeRole !== undefined && introducers.has(beforeRole)) return true;
    }
    if (previous === 'named' || previous === 'called' || previous === 'met') return true;
  }
  return false;
}

const NEGATION_WORDS = new Set([
  "aren't",
  "can't",
  'cannot',
  "didn't",
  "doesn't",
  'failed',
  'fails',
  'failure',
  "hadn't",
  "hasn't",
  "haven't",
  "isn't",
  'never',
  'no',
  'not',
  'refused',
  'refuses',
  'unable',
  "wasn't",
  "weren't",
  "won't",
  'without',
]);

const EXPLICIT_NEGATION_WORDS = new Set([
  "aren't",
  "can't",
  'cannot',
  "didn't",
  "doesn't",
  "hadn't",
  "hasn't",
  "haven't",
  "isn't",
  'never',
  'no',
  'not',
  "wasn't",
  "weren't",
  "won't",
]);

const POLARITY_PREDICATES: Partial<Record<PropositionType, ReadonlySet<string>>> = {
  requested_scope: new Set(['ask', 'asked', 'request', 'requested', 'want', 'wanted']),
  accepted_scope: new Set([
    'accept',
    'accepted',
    'agree',
    'agreed',
    'approve',
    'approved',
    'sign',
    'signed',
  ]),
  invoice: new Set(['bill', 'billed', 'invoice', 'invoiced', 'issue', 'issued']),
  payment: new Set([
    'complete',
    'completed',
    'made',
    'pay',
    'paid',
    'transfer',
    'transferred',
    'transferring',
  ]),
  disputed_balance: new Set(['contest', 'contested', 'dispute', 'disputed', 'disputes']),
  requested_remedy: new Set([
    'ask',
    'asked',
    'asks',
    'request',
    'requested',
    'seek',
    'seeks',
    'want',
    'wants',
  ]),
  target_date: new Set(['expect', 'expected']),
  contractual_deadline: new Set(['agree', 'agreed']),
};

const NARRATIVE_POLARITY_FAMILIES: readonly ReadonlySet<string>[] = [
  new Set(['claim', 'claimed', 'claims']),
  new Set(['say', 'said', 'says']),
  new Set(['state', 'stated', 'states']),
  new Set(['chargeable']),
];

function tokenIsNegated(tokens: readonly WordToken[], index: number): boolean {
  return tokens
    .slice(Math.max(0, index - 3), index)
    .some((candidate) => NEGATION_WORDS.has(candidate.folded));
}

function predicatePolarities(text: string, predicates: ReadonlySet<string>): ReadonlySet<boolean> {
  const tokens = wordTokens(text);
  const polarities = new Set<boolean>();
  for (const [index, token] of tokens.entries()) {
    if (predicates.has(token.folded)) polarities.add(tokenIsNegated(tokens, index));
  }
  return polarities;
}

function reversesAssertionPolarity(
  type: PropositionType,
  statement: string,
  answerCitations: string,
): boolean {
  if (type === 'narrative_fact') {
    const statementWords = words(statement);
    const citationWords = words(answerCitations);
    if (
      statementWords.some((word) => EXPLICIT_NEGATION_WORDS.has(word)) &&
      !citationWords.some((word) => NEGATION_WORDS.has(word) || word === 'nothing')
    ) {
      return true;
    }
    for (const family of NARRATIVE_POLARITY_FAMILIES) {
      const statementPolarities = predicatePolarities(statement, family);
      const citationPolarities = predicatePolarities(answerCitations, family);
      if (statementPolarities.size === 0 || citationPolarities.size === 0) continue;
      if ([...statementPolarities].some((polarity) => !citationPolarities.has(polarity))) {
        return true;
      }
    }
    return false;
  }
  const predicates = POLARITY_PREDICATES[type];
  if (predicates === undefined) return false;
  const tokens = wordTokens(statement);
  for (const [index, token] of tokens.entries()) {
    if (!predicates.has(token.folded)) continue;
    if (tokenIsNegated(tokens, index)) return true;
  }
  return false;
}

/**
 * Fact-shaped tokens that canonical prose may not add unless its exact answer
 * citations contain them. This is intentionally narrower than general lexical
 * overlap: prose may paraphrase, but numeric values, currencies and calendar
 * terms are audit facts rather than style. Entity-shaped words are handled
 * separately so casing is never mistaken for evidence that a word is a name.
 */
function factMarkers(text: string): string[] {
  const markers = new Set<string>();
  for (const match of text.matchAll(/\p{Sc}/gu)) markers.add(match[0]);
  for (const match of text.matchAll(/\b\d[\d,.]*\b/gu)) markers.add(match[0]);
  for (const match of text.matchAll(
    /\b(?:pounds?|dollars?|euros?|gbp|usd|eur|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/giu,
  )) {
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
    failures.push('shape: ' + issue.code + ' at ' + issue.path);
  }
  for (const issue of validateCompilerOutput(input, output)) {
    failures.push('contract: ' + issue.code + ' at ' + issue.path);
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
      failures.push('clarification: empty prompt');
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
          ' proposed a type/requirement pairing this case does not permit',
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
      problems.push('unexpected supersession target');
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
    if (
      factMarkers(assertion.statement).some(
        (marker) => !fold(answerCitations).includes(fold(marker)),
      )
    ) {
      problems.push('statement adds an unsupported fact-shaped token');
    }
    if (addsUnsupportedEntityToken(assertion.proposed_type, assertion.statement, answerCitations)) {
      problems.push('statement adds an unsupported entity-shaped token');
    }
    if (reversesAssertionPolarity(assertion.proposed_type, assertion.statement, answerCitations)) {
      problems.push('statement reverses the expected assertion polarity');
    }
    if (problems.length === 0) {
      conforming.add(key);
    } else {
      failures.push(
        'mismatch: ' +
          describeSlot(slot) +
          ' did not match its expected properties (' +
          problems.join(', ') +
          ')',
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
      failures.push("clarification: unexpected '" + clarification.reason + "' requirement pairing");
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
