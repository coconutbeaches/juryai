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
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'gbp',
  'had',
  'has',
  'he',
  'her',
  'him',
  'have',
  'in',
  'is',
  'it',
  'its',
  'may',
  'might',
  'must',
  'of',
  'on',
  'or',
  'other',
  'parties',
  'party',
  'she',
  'shall',
  'should',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'to',
  'user',
  'usd',
  'was',
  'were',
  'will',
  'would',
  'eur',
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
  payment: new Set(['by', 'for', 'paid', 'pay', 'to']),
  invoice: new Set(['by', 'from']),
  requested_scope: new Set(['asked', 'hired', 'told']),
  accepted_scope: new Set(['by', 'with']),
  requested_remedy: new Set(['asked', 'from', 'to']),
  disputed_balance: new Set(['against', 'by', 'from', 'to']),
};

const SENTENCE_INITIAL_NON_ENTITY_WORDS = new Set([
  'account',
  'accordingly',
  'actually',
  'additionally',
  'agreement',
  'amount',
  'balance',
  'bill',
  'charge',
  'completion',
  'consequently',
  'conversely',
  'date',
  'deadline',
  'fact',
  'finally',
  'fortunately',
  'funds',
  'generally',
  'however',
  'importantly',
  'indeed',
  'invoice',
  'money',
  'moreover',
  'nevertheless',
  'notably',
  'obviously',
  'overall',
  'perhaps',
  'payment',
  'position',
  'quote',
  'relief',
  'remedy',
  'remittance',
  'request',
  'scope',
  'sum',
  'therefore',
  'thus',
  'transfer',
  'ultimately',
  'unfortunately',
  'work',
]);

function isSentenceInitial(text: string, tokens: readonly WordToken[], index: number): boolean {
  if (index === 0) return true;
  return /[.!?]\s*$/u.test(text.slice(tokens[index - 1]!.end, tokens[index]!.start));
}

function isSubjectPosition(text: string, tokens: readonly WordToken[], index: number): boolean {
  if (isSentenceInitial(text, tokens, index)) return true;
  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
    const previous = tokens[previousIndex]!;
    const followingGap = text.slice(previous.end, tokens[previousIndex + 1]!.start);
    if (/[.!?;:]/u.test(followingGap)) return true;
    if (['and', 'but', 'or', 'then', 'while', 'whereas', 'yet'].includes(previous.folded)) {
      return true;
    }
    if (
      !SENTENCE_INITIAL_NON_ENTITY_WORDS.has(previous.folded) &&
      !['a', 'an', 'the'].includes(previous.folded)
    ) {
      return false;
    }
  }
  return true;
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
    const sentenceInitial = isSentenceInitial(statement, tokens, index);
    if (/^\p{Lu}/u.test(token.raw) && !sentenceInitial) return true;
    if (
      isSubjectPosition(statement, tokens, index) &&
      !SENTENCE_INITIAL_NON_ENTITY_WORDS.has(token.folded)
    ) {
      return true;
    }
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

const NARRATIVE_NEGATING_REPORTING_VERBS = new Set([
  'challenge',
  'challenged',
  'challenges',
  'contradict',
  'contradicted',
  'contradicts',
  'deny',
  'denied',
  'denies',
  'disavow',
  'disavowed',
  'disavows',
  'disagree',
  'disagreed',
  'disagrees',
  'dismiss',
  'dismissed',
  'dismisses',
  'oppose',
  'opposed',
  'opposes',
  'reject',
  'rejected',
  'rejects',
  'repudiate',
  'repudiated',
  'repudiates',
  'refute',
  'refuted',
  'refutes',
]);

const POLARITY_PREDICATES: Partial<Record<PropositionType, ReadonlySet<string>>> = {
  requested_scope: new Set([
    'ask',
    'asked',
    'commission',
    'commissioned',
    'engage',
    'engaged',
    'instruct',
    'instructed',
    'request',
    'requested',
    'solicit',
    'solicited',
    'want',
    'wanted',
  ]),
  accepted_scope: new Set([
    'accept',
    'accepted',
    'agree',
    'agreed',
    'assent',
    'assented',
    'approve',
    'approved',
    'authorize',
    'authorized',
    'consent',
    'consented',
    'endorse',
    'endorsed',
    'execute',
    'executed',
    'sign',
    'signed',
  ]),
  invoice: new Set([
    'bill',
    'billed',
    'charge',
    'charged',
    'invoice',
    'invoiced',
    'issue',
    'issued',
  ]),
  payment: new Set([
    'complete',
    'completed',
    'made',
    'pay',
    'paid',
    'remit',
    'remitted',
    'settle',
    'settled',
    'succeed',
    'succeeded',
    'successful',
    'successfully',
    'tender',
    'tendered',
    'transfer',
    'transferred',
    'transferring',
  ]),
  disputed_balance: new Set([
    'challenge',
    'challenged',
    'contest',
    'contested',
    'deny',
    'denied',
    'dispute',
    'disputed',
    'disputes',
    'object',
    'objected',
  ]),
  requested_remedy: new Set([
    'ask',
    'asked',
    'asks',
    'request',
    'requested',
    'demand',
    'demanded',
    'pursue',
    'pursued',
    'seek',
    'seeks',
    'want',
    'wants',
  ]),
  target_date: new Set([
    'anticipate',
    'anticipated',
    'expect',
    'expected',
    'hope',
    'hoped',
    'plan',
    'planned',
  ]),
  contractual_deadline: new Set(['agree', 'agreed', 'commit', 'committed', 'promise', 'promised']),
};

const LEXICAL_POLARITY_REVERSERS: Partial<Record<PropositionType, ReadonlySet<string>>> = {
  requested_scope: new Set([
    'canceled',
    'cancelled',
    'declined',
    'refused',
    'rejected',
    'withdrawn',
    'withdrew',
  ]),
  accepted_scope: new Set([
    'canceled',
    'cancelled',
    'declined',
    'refused',
    'rejected',
    'repudiated',
    'rescinded',
    'unsigned',
    'withdrawn',
    'withdrew',
  ]),
  invoice: new Set([
    'canceled',
    'cancelled',
    'retracted',
    'unbilled',
    'uninvoiced',
    'voided',
    'waived',
    'withdrawn',
  ]),
  disputed_balance: new Set([
    'accepted',
    'acknowledged',
    'admitted',
    'agreed',
    'conceded',
    'settled',
    'undisputed',
  ]),
  requested_remedy: new Set([
    'abandoned',
    'declined',
    'rejected',
    'renounced',
    'waived',
    'withdrawn',
    'withdrew',
  ]),
  target_date: new Set(['abandoned', 'canceled', 'cancelled', 'excluded', 'rejected']),
  contractual_deadline: new Set([
    'canceled',
    'cancelled',
    'declined',
    'refused',
    'rejected',
    'rescinded',
    'waived',
  ]),
};

const PAYMENT_LEXICAL_REVERSERS = new Set([
  'attempt',
  'attempted',
  'attempting',
  'cancelled',
  'canceled',
  'defaulted',
  'failed',
  'refused',
  'reversed',
  'unmade',
  'unpaid',
  'unsuccessful',
  'withheld',
  'withhold',
  'withholding',
]);

const PAYMENT_COMPLETION_MARKERS = new Set([
  'complete',
  'completed',
  'made',
  'pay',
  'paid',
  'remit',
  'remitted',
  'settle',
  'settled',
  'succeed',
  'succeeded',
  'successful',
  'successfully',
  'tender',
  'tendered',
  'transferred',
]);

const NARRATIVE_POLARITY_FAMILIES: readonly ReadonlySet<string>[] = [
  new Set([
    'claim',
    'claimed',
    'claims',
    'contend',
    'contended',
    'contends',
    'maintain',
    'maintained',
    'maintains',
    'say',
    'said',
    'says',
    'state',
    'stated',
    'states',
  ]),
  new Set([
    'charge',
    'chargeable',
    'due',
    'owe',
    'owed',
    'owing',
    'payable',
    'recover',
    'recoverability',
    'recoverable',
  ]),
];

const NEGATION_CLAUSE_BOUNDARIES = new Set([
  'although',
  'and',
  'but',
  'however',
  'or',
  'though',
  'yet',
]);

function semanticClauses(text: string): string[] {
  return text
    .split(
      /[!?;:]+|\.(?=\s|$)|,\s*(?:although|and|because|but|despite|however|notwithstanding|or|since|then|though|while|whereas|yet)\b|\b(?:although|and|because|but|despite|however|notwithstanding|or|since|then|though|while|whereas|yet)\b|\bin\s+spite\s+of\b/iu,
    )
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

function hasExplicitNegation(text: string): boolean {
  const tokens = wordTokens(text);
  return tokens.some(
    (token, index) =>
      EXPLICIT_NEGATION_WORDS.has(token.folded) &&
      !(token.folded === 'not' && tokens[index + 1]?.folded === 'only'),
  );
}

function hasNarrativeNegation(text: string): boolean {
  return (
    hasExplicitNegation(text) ||
    words(text).some((word) => NARRATIVE_NEGATING_REPORTING_VERBS.has(word))
  );
}

function discriminativeFactMarkers(text: string): ReadonlySet<string> {
  return new Set(factMarkers(text).filter((marker) => /^\d/u.test(marker)));
}

function narrativeNegationLacksCitedSupport(statement: string, answerCitations: string): boolean {
  const citedClauses = semanticClauses(answerCitations);
  for (const statementClause of semanticClauses(statement)) {
    if (!hasNarrativeNegation(statementClause)) continue;
    const statementMarkers = discriminativeFactMarkers(statementClause);
    const statementFamilies = NARRATIVE_POLARITY_FAMILIES.filter((family) =>
      words(statementClause).some((word) => family.has(word)),
    );
    const relevantCitations = citedClauses.filter((citationClause) => {
      const citationMarkers = discriminativeFactMarkers(citationClause);
      if (
        statementMarkers.size > 0 &&
        [...statementMarkers].every((marker) => citationMarkers.has(marker))
      ) {
        return true;
      }
      const citationWords = words(citationClause);
      return statementFamilies.some((family) => citationWords.some((word) => family.has(word)));
    });
    if (
      relevantCitations.length === 0 ||
      !relevantCitations.some((citationClause) => hasNarrativeNegation(citationClause))
    ) {
      return true;
    }
  }
  return false;
}

function tokenIsNegated(text: string, tokens: readonly WordToken[], index: number): boolean {
  let rightStart = tokens[index]!.start;
  for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = tokens[candidateIndex]!;
    if (/[.!?;:]/u.test(text.slice(candidate.end, rightStart))) return false;
    if (NEGATION_CLAUSE_BOUNDARIES.has(candidate.folded)) return false;
    if (
      NEGATION_WORDS.has(candidate.folded) &&
      !(candidate.folded === 'not' && tokens[candidateIndex + 1]?.folded === 'only')
    ) {
      return true;
    }
    rightStart = candidate.start;
  }
  return false;
}

function predicatePolarities(text: string, predicates: ReadonlySet<string>): ReadonlySet<boolean> {
  const tokens = wordTokens(text);
  const polarities = new Set<boolean>();
  for (const [index, token] of tokens.entries()) {
    if (predicates.has(token.folded)) polarities.add(tokenIsNegated(text, tokens, index));
  }
  return polarities;
}

function paymentClauseReversesAssertion(statement: string): boolean {
  const clauses = semanticClauses(statement).map((clause) => {
    const clauseWords = words(clause);
    let lastReversal = -1;
    let lastSuccess = -1;
    for (const [index, word] of clauseWords.entries()) {
      if (PAYMENT_LEXICAL_REVERSERS.has(word)) lastReversal = index;
      if (PAYMENT_COMPLETION_MARKERS.has(word)) lastSuccess = index;
    }
    return {
      markers: discriminativeFactMarkers(clause),
      reversed: lastReversal >= 0 && lastReversal > lastSuccess,
      successful: lastSuccess >= 0 && lastSuccess > lastReversal,
    };
  });

  for (const [index, clause] of clauses.entries()) {
    if (!clause.reversed) continue;
    const laterMatchingSuccess = clauses
      .slice(index + 1)
      .some(
        (later) =>
          later.successful &&
          clause.markers.size > 0 &&
          [...clause.markers].every((marker) => later.markers.has(marker)),
      );
    if (!laterMatchingSuccess) return true;
  }
  return false;
}

function reversesAssertionPolarity(
  type: PropositionType,
  statement: string,
  answerCitations: string,
): boolean {
  const statementWords = words(statement);
  if (type === 'payment') {
    if (paymentClauseReversesAssertion(statement)) return true;
  } else if (statementWords.some((word) => LEXICAL_POLARITY_REVERSERS[type]?.has(word) ?? false)) {
    return true;
  }
  if (type === 'narrative_fact') {
    if (narrativeNegationLacksCitedSupport(statement, answerCitations)) {
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
    if (tokenIsNegated(statement, tokens, index)) return true;
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
function normalizeFactMarker(marker: string): string {
  const normalized = fold(marker);
  if (/^\d/iu.test(normalized)) return normalized.replaceAll(',', '');
  if (['£', 'gbp', 'pound', 'pounds'].includes(normalized)) return 'currency:gbp';
  if (['$', 'usd', 'dollar', 'dollars'].includes(normalized)) return 'currency:usd';
  if (['€', 'eur', 'euro', 'euros'].includes(normalized)) return 'currency:eur';
  return normalized;
}

const SMALL_NUMBER_WORDS = new Map<string, number>([
  ['zero', 0],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['thirteen', 13],
  ['fourteen', 14],
  ['fifteen', 15],
  ['sixteen', 16],
  ['seventeen', 17],
  ['eighteen', 18],
  ['nineteen', 19],
  ['twenty', 20],
  ['thirty', 30],
  ['forty', 40],
  ['fifty', 50],
  ['sixty', 60],
  ['seventy', 70],
  ['eighty', 80],
  ['ninety', 90],
]);

const LARGE_NUMBER_WORDS = new Map<string, number>([
  ['thousand', 1_000],
  ['million', 1_000_000],
  ['billion', 1_000_000_000],
]);

const ORDINAL_NUMBER_WORDS = new Map<string, number>([
  ['first', 1],
  ['second', 2],
  ['third', 3],
  ['fourth', 4],
  ['fifth', 5],
  ['sixth', 6],
  ['seventh', 7],
  ['eighth', 8],
  ['ninth', 9],
  ['tenth', 10],
  ['eleventh', 11],
  ['twelfth', 12],
  ['thirteenth', 13],
  ['fourteenth', 14],
  ['fifteenth', 15],
  ['sixteenth', 16],
  ['seventeenth', 17],
  ['eighteenth', 18],
  ['nineteenth', 19],
  ['twentieth', 20],
  ['hundredth', 100],
  ['thousandth', 1_000],
]);

const QUANTITY_WORD_MARKERS = new Map<string, string>([
  ['half', 'fraction:1/2'],
  ['halves', 'fraction:1/2'],
  ['quarter', 'fraction:1/4'],
  ['quarters', 'fraction:1/4'],
  ['double', 'multiplier:2'],
  ['twice', 'multiplier:2'],
  ['triple', 'multiplier:3'],
  ['thrice', 'multiplier:3'],
  ['dozen', 'quantity:12'],
]);

function numberWordMarkers(text: string): string[] {
  const tokens = words(text);
  const markers: string[] = [];
  let current = 0;
  let total = 0;
  let active = false;
  const flush = (): void => {
    if (!active) return;
    markers.push(String(total + current));
    current = 0;
    total = 0;
    active = false;
  };

  for (const [index, token] of tokens.entries()) {
    const small = SMALL_NUMBER_WORDS.get(token);
    if (small !== undefined) {
      current += small;
      active = true;
      continue;
    }
    if (token === 'hundred') {
      current = Math.max(current, 1) * 100;
      active = true;
      continue;
    }
    const scale = LARGE_NUMBER_WORDS.get(token);
    if (scale !== undefined) {
      total += Math.max(current, 1) * scale;
      current = 0;
      active = true;
      continue;
    }
    if (token === 'and' && active && SMALL_NUMBER_WORDS.has(tokens[index + 1] ?? '')) continue;
    flush();
  }
  flush();
  return markers;
}

function factMarkers(text: string): string[] {
  const markers: string[] = [...numberWordMarkers(text)];
  for (const word of words(text)) {
    const ordinal = ORDINAL_NUMBER_WORDS.get(word);
    if (ordinal !== undefined) markers.push(`ordinal:${ordinal}`);
    const quantity = QUANTITY_WORD_MARKERS.get(word);
    if (quantity !== undefined) markers.push(quantity);
  }
  for (const match of text.matchAll(/\b(\d+)(?:st|nd|rd|th)\b/giu)) {
    markers.push(`ordinal:${Number(match[1])}`);
  }
  for (const match of text.matchAll(/\p{Sc}/gu)) markers.push(normalizeFactMarker(match[0]));
  for (const match of text.matchAll(/\b\d[\d,.]*\b/gu)) {
    markers.push(normalizeFactMarker(match[0]));
  }
  for (const match of text.matchAll(
    /\b(?:pounds?|dollars?|euros?|gbp|usd|eur|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/giu,
  )) {
    markers.push(normalizeFactMarker(match[0]));
  }
  return markers;
}

function addsUnsupportedFactMarker(statement: string, answerCitations: string): boolean {
  const available = new Map<string, number>();
  for (const marker of factMarkers(answerCitations)) {
    available.set(marker, (available.get(marker) ?? 0) + 1);
  }
  for (const marker of factMarkers(statement)) {
    const remaining = available.get(marker) ?? 0;
    if (remaining === 0) return true;
    available.set(marker, remaining - 1);
  }
  return false;
}

function answerCitationUnionText(
  spans: readonly {
    turn_id: string;
    start: number;
    end: number;
    quote: string;
  }[],
): string {
  const sorted = [...spans].sort(
    (left, right) =>
      left.turn_id.localeCompare(right.turn_id) || left.start - right.start || right.end - left.end,
  );
  const parts: string[] = [];
  let activeTurn = '';
  let coveredEnd = -1;
  for (const span of sorted) {
    if (span.turn_id !== activeTurn || span.start > coveredEnd) {
      parts.push(span.quote);
      activeTurn = span.turn_id;
      coveredEnd = span.end;
      continue;
    }
    if (span.end > coveredEnd) {
      parts[parts.length - 1] += span.quote.slice(coveredEnd - span.start);
      coveredEnd = span.end;
    }
  }
  return parts.join(' ');
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
    const answerCitations = answerCitationUnionText(
      assertion.spans.filter((span) => span.region === 'answer'),
    );
    for (const alternatives of slot.citation_must_mention) {
      if (!alternatives.some((term) => fold(answerCitations).includes(fold(term)))) {
        problems.push("citation does not support topic '" + alternatives.join('|') + "'");
      }
    }
    if (addsUnsupportedFactMarker(assertion.statement, answerCitations)) {
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
