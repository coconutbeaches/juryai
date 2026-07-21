import {
  alignPersonA as alignBase,
  familyItems,
  semanticSimilarity,
  type AlignmentPair,
  type PersonAAlignment,
} from './person-a-alignment.js';

type JsonObject = Record<string, any>;

type RecoveryCandidate = {
  extractedIndex: number;
  goldenIndex: number;
  score: number;
};

function dateOverlap(a: JsonObject, b: JsonObject): number {
  const aStart = Date.parse(a?.start);
  const aEnd = Date.parse(a?.end ?? a?.start);
  const bStart = Date.parse(b?.start);
  const bEnd = Date.parse(b?.end ?? b?.start);
  if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) return 0;
  return aStart <= bEnd && bStart <= aEnd ? 1 : 0;
}

function transferDirection(item: JsonObject): string {
  const transfer = item.transfers?.[0];
  return transfer ? `${transfer.from_party_id}->${transfer.to_party_id}` : 'none';
}

function transferAmount(item: JsonObject): number | null {
  const amount = item.transfers?.[0]?.amount;
  return typeof amount === 'number' ? amount : null;
}

function joinStrings(value: unknown): string {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').join(' ') : '';
}

export function sourceSpanOverlap(a: JsonObject, b: JsonObject): number {
  const left = Array.isArray(a?.source_spans) ? a.source_spans : [];
  const right = Array.isArray(b?.source_spans) ? b.source_spans : [];
  let best = 0;

  for (const leftSpan of left) {
    for (const rightSpan of right) {
      const leftStart = leftSpan?.start_char;
      const leftEnd = leftSpan?.end_char;
      const rightStart = rightSpan?.start_char;
      const rightEnd = rightSpan?.end_char;
      if (![leftStart, leftEnd, rightStart, rightEnd].every((value) => typeof value === 'number')) {
        continue;
      }
      const shorterLength = Math.min(leftEnd - leftStart, rightEnd - rightStart);
      if (shorterLength <= 0) continue;
      const intersection = Math.max(
        0,
        Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart),
      );
      best = Math.max(best, intersection / shorterLength);
    }
  }

  return best;
}

function sourceSpanDistance(a: JsonObject, b: JsonObject): number {
  const left = Array.isArray(a?.source_spans) ? a.source_spans : [];
  const right = Array.isArray(b?.source_spans) ? b.source_spans : [];
  let best = Number.POSITIVE_INFINITY;

  for (const leftSpan of left) {
    for (const rightSpan of right) {
      const leftStart = leftSpan?.start_char;
      const leftEnd = leftSpan?.end_char;
      const rightStart = rightSpan?.start_char;
      const rightEnd = rightSpan?.end_char;
      if (![leftStart, leftEnd, rightStart, rightEnd].every((value) => typeof value === 'number')) {
        continue;
      }
      if (leftEnd >= rightStart && rightEnd >= leftStart) return 0;
      best = Math.min(best, Math.max(leftStart, rightStart) - Math.min(leftEnd, rightEnd));
    }
  }

  return best;
}

function calendarMonthDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[1]}-${match[2]}` : null;
}

function removeAmbiguousDuplicates(alignment: PersonAAlignment): void {
  for (const family of Object.values(alignment.families)) {
    const extracted = new Set(family.ambiguous.map((item) => item.extracted_index));
    const golden = new Set(
      family.ambiguous.flatMap((item) =>
        item.candidates.map((candidate) => candidate.golden_index),
      ),
    );
    family.unmatched_extracted = family.unmatched_extracted.filter(
      (item) => !extracted.has(item.index),
    );
    family.unmatched_golden = family.unmatched_golden.filter((item) => !golden.has(item.index));
  }
}

function applyRecoveredPairs(
  family: PersonAAlignment['families'][keyof PersonAAlignment['families']],
  extractedItems: JsonObject[],
  goldenItems: JsonObject[],
  candidates: RecoveryCandidate[],
  idKey: string,
  fallbackPrefix: string,
): void {
  candidates.sort((a, b) => b.score - a.score);
  const usedExtracted = new Set<number>();
  const usedGolden = new Set<number>();
  const recovered: AlignmentPair[] = [];

  for (const candidate of candidates) {
    if (usedExtracted.has(candidate.extractedIndex) || usedGolden.has(candidate.goldenIndex)) {
      continue;
    }
    usedExtracted.add(candidate.extractedIndex);
    usedGolden.add(candidate.goldenIndex);
    const left = extractedItems[candidate.extractedIndex] ?? {};
    const right = goldenItems[candidate.goldenIndex] ?? {};
    recovered.push({
      extracted_index: candidate.extractedIndex,
      golden_index: candidate.goldenIndex,
      extracted_id: left[idKey] ?? `${fallbackPrefix}_${candidate.extractedIndex}`,
      golden_id: right[idKey] ?? `${fallbackPrefix}_${candidate.goldenIndex}`,
      score: candidate.score,
      margin: candidate.score,
    });
  }

  family.pairs.push(...recovered);
  family.unmatched_extracted = family.unmatched_extracted.filter(
    (item) => !usedExtracted.has(item.index),
  );
  family.unmatched_golden = family.unmatched_golden.filter((item) => !usedGolden.has(item.index));
}

function recoverSourceTracePairs(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
): void {
  const configurations: Array<{
    family: 'agreement_terms' | 'timeline' | 'claims' | 'extraction_issues';
    idKey: string;
    text: (item: JsonObject) => unknown;
    isCompatible: (left: JsonObject, right: JsonObject) => boolean;
    minimumSemanticScore: number;
  }> = [
    {
      family: 'agreement_terms',
      idKey: 'term_id',
      text: (item) => `${item.wording ?? ''} ${item.person_a_interpretation ?? ''}`,
      isCompatible: (left, right) => left.term_type === right.term_type,
      minimumSemanticScore: 0,
    },
    {
      family: 'timeline',
      idKey: 'event_id',
      text: (item) => item.event_summary,
      isCompatible: () => true,
      minimumSemanticScore: 0.3,
    },
    {
      family: 'claims',
      idKey: 'claim_id',
      text: (item) => item.claim_text,
      isCompatible: (left, right) => left.party_id === right.party_id,
      minimumSemanticScore: 0.35,
    },
    {
      family: 'extraction_issues',
      idKey: 'issue_id',
      text: (item) => item.description,
      isCompatible: () => true,
      minimumSemanticScore: 0,
    },
  ];

  for (const configuration of configurations) {
    const family = alignment.families[configuration.family];
    const extractedItems = familyItems(extracted, configuration.family);
    const goldenItems = familyItems(golden, configuration.family);
    const candidates: RecoveryCandidate[] = [];

    for (const extra of family.unmatched_extracted) {
      for (const missing of family.unmatched_golden) {
        const left = extractedItems[extra.index] ?? {};
        const right = goldenItems[missing.index] ?? {};
        if (!configuration.isCompatible(left, right)) continue;
        const traceScore = sourceSpanOverlap(left, right);
        if (traceScore < 0.8) continue;
        const semanticScore = semanticSimilarity(
          configuration.text(left),
          configuration.text(right),
        );
        if (semanticScore < configuration.minimumSemanticScore) continue;
        candidates.push({
          extractedIndex: extra.index,
          goldenIndex: missing.index,
          score: 0.7 * traceScore + 0.3 * semanticScore,
        });
      }
    }

    applyRecoveredPairs(
      family,
      extractedItems,
      goldenItems,
      candidates,
      configuration.idKey,
      configuration.family,
    );
  }
}

function normalizedName(value: unknown): string {
  return typeof value === 'string'
    ? value
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
    : '';
}

function recoverContainedDeliverableNames(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
): void {
  const family = alignment.families.deliverables;
  const extractedItems = familyItems(extracted, 'deliverables');
  const goldenItems = familyItems(golden, 'deliverables');
  const candidates: RecoveryCandidate[] = [];

  for (const extra of family.unmatched_extracted) {
    for (const missing of family.unmatched_golden) {
      const left = extractedItems[extra.index] ?? {};
      const right = goldenItems[missing.index] ?? {};
      const extractedName = normalizedName(left.name);
      const goldenName = normalizedName(right.name);
      if (goldenName.length < 8 || !extractedName.includes(goldenName)) continue;
      candidates.push({
        extractedIndex: extra.index,
        goldenIndex: missing.index,
        score: 0.85,
      });
    }
  }

  applyRecoveredPairs(
    family,
    extractedItems,
    goldenItems,
    candidates,
    'deliverable_id',
    'deliverable',
  );
}

function numericTokens(value: unknown): Set<string> {
  if (typeof value !== 'string') return new Set();
  return new Set(value.match(/\d[\d,]*(?:\.\d+)?/g) ?? []);
}

function recoverUniqueClaimFacts(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
): void {
  const family = alignment.families.claims;
  const extractedItems = familyItems(extracted, 'claims');
  const goldenItems = familyItems(golden, 'claims');
  const candidates: RecoveryCandidate[] = [];

  for (const extra of family.unmatched_extracted) {
    const left = extractedItems[extra.index] ?? {};
    const leftNumbers = numericTokens(left.claim_text);
    const compatibleGolden = family.unmatched_golden.filter((missing) => {
      const right = goldenItems[missing.index] ?? {};
      const rightNumbers = numericTokens(right.claim_text);
      return (
        left.party_id === right.party_id &&
        left.claim_type === right.claim_type &&
        [...leftNumbers].some((value) => rightNumbers.has(value)) &&
        semanticSimilarity(left.claim_text, right.claim_text) >= 0.38
      );
    });
    const compatibleExtracted = family.unmatched_extracted.filter((other) => {
      const item = extractedItems[other.index] ?? {};
      const itemNumbers = numericTokens(item.claim_text);
      return (
        item.party_id === left.party_id &&
        item.claim_type === left.claim_type &&
        [...leftNumbers].some((value) => itemNumbers.has(value))
      );
    });
    if (compatibleGolden.length !== 1 || compatibleExtracted.length !== 1) continue;
    const missing = compatibleGolden[0]!;
    candidates.push({
      extractedIndex: extra.index,
      goldenIndex: missing.index,
      score: semanticSimilarity(left.claim_text, goldenItems[missing.index]?.claim_text),
    });
  }

  applyRecoveredPairs(family, extractedItems, goldenItems, candidates, 'claim_id', 'claim');
}

function recoverAdjacentTimelineDates(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
): void {
  const family = alignment.families.timeline;
  const extractedItems = familyItems(extracted, 'timeline');
  const goldenItems = familyItems(golden, 'timeline');
  const candidates: RecoveryCandidate[] = [];

  for (const extra of family.unmatched_extracted) {
    for (const missing of family.unmatched_golden) {
      const left = extractedItems[extra.index] ?? {};
      const right = goldenItems[missing.index] ?? {};
      if (sourceSpanDistance(left, right) > 1) continue;
      if (
        left.actor_party_id !== right.actor_party_id ||
        left.actor_third_party_id !== right.actor_third_party_id
      ) {
        continue;
      }
      const leftMonthDay = calendarMonthDay(left.date?.start);
      const rightMonthDay = calendarMonthDay(right.date?.start);
      if (!leftMonthDay || leftMonthDay !== rightMonthDay) continue;
      candidates.push({
        extractedIndex: extra.index,
        goldenIndex: missing.index,
        score: 0.75 + 0.25 * semanticSimilarity(left.event_summary, right.event_summary),
      });
    }
  }

  applyRecoveredPairs(family, extractedItems, goldenItems, candidates, 'event_id', 'timeline');
}

function recoverUniqueEvidenceBlocks(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
): void {
  const family = alignment.families.evidence;
  const extractedItems = familyItems(extracted, 'evidence');
  const goldenItems = familyItems(golden, 'evidence');
  const candidates: RecoveryCandidate[] = [];

  for (const extra of family.unmatched_extracted) {
    const left = extractedItems[extra.index] ?? {};
    const compatibleGolden = family.unmatched_golden.filter((missing) => {
      const right = goldenItems[missing.index] ?? {};
      return (
        left.submitted_by_party_id === right.submitted_by_party_id &&
        left.evidence_type === right.evidence_type
      );
    });
    const compatibleExtracted = family.unmatched_extracted.filter((other) => {
      const item = extractedItems[other.index] ?? {};
      return (
        item.submitted_by_party_id === left.submitted_by_party_id &&
        item.evidence_type === left.evidence_type
      );
    });
    if (compatibleGolden.length !== 1 || compatibleExtracted.length !== 1) continue;
    const missing = compatibleGolden[0]!;
    const right = goldenItems[missing.index] ?? {};
    const sameSourceSystem =
      typeof left.source_system === 'string' &&
      left.source_system.length > 0 &&
      left.source_system === right.source_system;
    candidates.push({
      extractedIndex: extra.index,
      goldenIndex: missing.index,
      score: sameSourceSystem ? 0.8 : 0.55,
    });
  }

  applyRecoveredPairs(family, extractedItems, goldenItems, candidates, 'evidence_id', 'evidence');
}

function recoverActorReversals(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
): void {
  const family = alignment.families.timeline;
  const extractedItems = familyItems(extracted, 'timeline');
  const goldenItems = familyItems(golden, 'timeline');
  const candidates: RecoveryCandidate[] = [];

  for (const extra of family.unmatched_extracted) {
    for (const missing of family.unmatched_golden) {
      const left = extractedItems[extra.index] ?? {};
      const right = goldenItems[missing.index] ?? {};
      const actorsDiffer =
        left.actor_party_id !== right.actor_party_id ||
        left.actor_third_party_id !== right.actor_third_party_id;
      if (!actorsDiffer || dateOverlap(left.date, right.date) === 0) continue;
      const score = semanticSimilarity(left.event_summary, right.event_summary);
      if (score >= 0.65) {
        candidates.push({ extractedIndex: extra.index, goldenIndex: missing.index, score });
      }
    }
  }

  applyRecoveredPairs(family, extractedItems, goldenItems, candidates, 'event_id', 'timeline');
}

function recoverOutcomeTransferReversals(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
): void {
  const family = alignment.families.outcomes;
  const extractedItems = familyItems(extracted, 'outcomes');
  const goldenItems = familyItems(golden, 'outcomes');
  const candidates: RecoveryCandidate[] = [];

  for (const extra of family.unmatched_extracted) {
    for (const missing of family.unmatched_golden) {
      const left = extractedItems[extra.index] ?? {};
      const right = goldenItems[missing.index] ?? {};
      if (left.outcome_type !== right.outcome_type) continue;
      if (transferDirection(left) === transferDirection(right)) continue;
      if (transferAmount(left) !== transferAmount(right)) continue;

      const rationaleScore = semanticSimilarity(left.rationale, right.rationale);
      const actionsScore = semanticSimilarity(
        joinStrings(left.required_actions),
        joinStrings(right.required_actions),
      );
      const score = 0.65 * rationaleScore + 0.35 * actionsScore;
      if (score >= 0.55) {
        candidates.push({ extractedIndex: extra.index, goldenIndex: missing.index, score });
      }
    }
  }

  applyRecoveredPairs(family, extractedItems, goldenItems, candidates, 'outcome_id', 'outcome');
}

export function alignPersonA(extracted: JsonObject, golden: JsonObject): PersonAAlignment {
  const alignment = alignBase(extracted, golden);
  removeAmbiguousDuplicates(alignment);
  recoverSourceTracePairs(extracted, golden, alignment);
  recoverContainedDeliverableNames(extracted, golden, alignment);
  recoverUniqueClaimFacts(extracted, golden, alignment);
  recoverAdjacentTimelineDates(extracted, golden, alignment);
  recoverUniqueEvidenceBlocks(extracted, golden, alignment);
  recoverActorReversals(extracted, golden, alignment);
  recoverOutcomeTransferReversals(extracted, golden, alignment);
  return alignment;
}

export { familyItems, semanticSimilarity } from './person-a-alignment.js';
export type {
  AlignmentPair,
  AmbiguousAlignment,
  FamilyAlignment,
  PersonAFamily,
  PersonAAlignment,
} from './person-a-alignment.js';
