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
  family.unmatched_golden = family.unmatched_golden.filter(
    (item) => !usedGolden.has(item.index),
  );
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

  applyRecoveredPairs(
    family,
    extractedItems,
    goldenItems,
    candidates,
    'event_id',
    'timeline',
  );
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

  applyRecoveredPairs(
    family,
    extractedItems,
    goldenItems,
    candidates,
    'outcome_id',
    'outcome',
  );
}

export function alignPersonA(extracted: JsonObject, golden: JsonObject): PersonAAlignment {
  const alignment = alignBase(extracted, golden);
  removeAmbiguousDuplicates(alignment);
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
