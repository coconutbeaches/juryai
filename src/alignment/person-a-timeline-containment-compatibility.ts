import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import {
  alignPersonAForCase as alignPriorProjection,
  familyItems,
  normalizeMeaning,
  requirePersonAEvaluationContractVersion,
  semanticSimilarity,
  type AlignmentPair,
  type PersonAAlignment,
  type PersonAAlignmentOptions,
  type PersonASemanticAliases,
} from './person-a-alignment-corrected.js';

type JsonObject = Record<string, any>;

export type TimelineContainmentAuditEntry = {
  rule_id: 'exact_source_timeline_containment';
  extracted_id: string;
  golden_id: string;
  recovery_reason: 'exact_source_containment';
  extracted_span: {
    start_char: number;
    end_char: number;
    quote: string;
  };
  golden_span: {
    start_char: number;
    end_char: number;
    quote: string;
  };
  material_tokens: string[];
  extracted_record_sha256: string;
  golden_record_sha256: string;
};

export type TimelineContainmentAlignment = PersonAAlignment & {
  compatibility_audit: {
    version: 'dry-run-001-timeline-containment-v1';
    entries: [TimelineContainmentAuditEntry];
  };
};

type ExactSpan = {
  start_char: number;
  end_char: number;
  quote: string;
};

type ContainmentProof = {
  extractedSpan: ExactSpan;
  goldenSpan: ExactSpan;
  materialTokens: string[];
};

type Candidate = {
  extractedIndex: number;
  goldenIndex: number;
  proof: ContainmentProof;
  score: number;
};

const timelineContainmentFunctionWords = new Set([
  'a',
  'an',
  'and',
  'around',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
]);

function sameStringSet(left: unknown, right: unknown): boolean {
  const a = new Set(Array.isArray(left) ? left.filter((item) => typeof item === 'string') : []);
  const b = new Set(Array.isArray(right) ? right.filter((item) => typeof item === 'string') : []);
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function sameTimelineDate(left: JsonObject, right: JsonObject): boolean {
  return (
    left.date?.start === right.date?.start &&
    left.date?.end === right.date?.end &&
    left.date?.precision === right.date?.precision &&
    left.date?.approximate === right.date?.approximate
  );
}

function exactNarrativeSpans(item: JsonObject, narrative: string): ExactSpan[] {
  return Array.isArray(item.source_spans)
    ? item.source_spans.flatMap((span: JsonObject) =>
        typeof span?.quote === 'string' &&
        span.quote.length > 0 &&
        Number.isInteger(span.start_char) &&
        Number.isInteger(span.end_char) &&
        span.start_char >= 0 &&
        span.end_char > span.start_char &&
        narrative.slice(span.start_char, span.end_char) === span.quote
          ? [
              {
                start_char: span.start_char,
                end_char: span.end_char,
                quote: span.quote,
              },
            ]
          : [],
      )
    : [];
}

function materialTimelineTokens(value: unknown, aliases: PersonASemanticAliases): string[] {
  return [
    ...new Set(
      normalizeMeaning(value, aliases)
        .split(' ')
        .filter(
          (token) =>
            token.length > 0 &&
            !timelineContainmentFunctionWords.has(token) &&
            (token.length >= 3 || /^\d+$/u.test(token)),
        ),
    ),
  ].sort();
}

const dryRun001TimelineContainmentRepresentation = {
  extractedRecordSha256: '80e9d2509dedba61b8439527c324c28aebfb70e0dd8dca656cc7355fef5c7bfa',
  extractedSpan: {
    start_char: 283,
    end_char: 428,
    quote:
      'The intended launch was around May 20, although the contract also says the timeline depended on Maya supplying final copy and images by April 25.',
  },
  goldenRecordSha256: 'd2233b8f28b3c6eff750fd4c17f94c0730a6bf94d8d76d7856d906d8cf3afdc7',
  goldenSpan: {
    start_char: 416,
    end_char: 428,
    quote: 'by April 25.',
  },
} as const;

function canonicalizeJsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error('Frozen timeline records must contain lossless JSON numbers.');
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error('Frozen timeline records must contain JSON-safe values.');
  }
  if (utilTypes.isProxy(value)) {
    throw new Error('Frozen timeline records must not contain proxies.');
  }
  if (seen.has(value)) {
    throw new Error('Frozen timeline records must not contain cycles.');
  }
  seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new Error('Frozen timeline arrays must use the intrinsic Array prototype.');
    }
    const keys = Object.keys(value);
    if (
      keys.length !== value.length ||
      keys.some((key, index) => key !== String(index)) ||
      Reflect.ownKeys(value).length !== value.length + 1
    ) {
      throw new Error('Frozen timeline arrays must not be sparse or contain extra properties.');
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw new Error('Frozen timeline arrays must contain enumerable own data elements.');
      }
      result.push(canonicalizeJsonSafe(descriptor.value, seen));
    }
    seen.delete(value);
    return result;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Frozen timeline records must contain plain JSON objects.');
  }
  const entries: Array<[string, unknown]> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new Error('Frozen timeline records must not contain symbol keys.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new Error('Frozen timeline records must contain enumerable data properties.');
    }
    entries.push([key, canonicalizeJsonSafe(descriptor.value, seen)]);
  }
  seen.delete(value);
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function recordFingerprint(value: JsonObject): string | null {
  try {
    return createHash('sha256')
      .update(JSON.stringify(canonicalizeJsonSafe(value)), 'utf8')
      .digest('hex');
  } catch {
    return null;
  }
}

function matchesFrozenTimelineContainmentRepresentation(
  extracted: JsonObject,
  golden: JsonObject,
): boolean {
  return (
    recordFingerprint(extracted) ===
      dryRun001TimelineContainmentRepresentation.extractedRecordSha256 &&
    recordFingerprint(golden) === dryRun001TimelineContainmentRepresentation.goldenRecordSha256
  );
}

function sameExactSpan(
  left: ExactSpan,
  right: (typeof dryRun001TimelineContainmentRepresentation)['extractedSpan' | 'goldenSpan'],
): boolean {
  return (
    left.start_char === right.start_char &&
    left.end_char === right.end_char &&
    left.quote === right.quote
  );
}

/**
 * Prove exact containment without lowering semantic thresholds or using IDs.
 */
export function proveExactSourceTimelineContainment(
  extracted: JsonObject,
  golden: JsonObject,
  narrative: string,
  aliases: PersonASemanticAliases = {},
): ContainmentProof | null {
  if (
    !matchesFrozenTimelineContainmentRepresentation(extracted, golden) ||
    extracted.actor_party_id !== golden.actor_party_id ||
    extracted.actor_third_party_id !== golden.actor_third_party_id ||
    extracted.occurrence_status !== golden.occurrence_status ||
    extracted.interpretation_status !== golden.interpretation_status ||
    extracted.materiality !== golden.materiality ||
    !sameTimelineDate(extracted, golden) ||
    !sameStringSet(extracted.asserted_by_party_ids, golden.asserted_by_party_ids)
  ) {
    return null;
  }

  const extractedSpans = exactNarrativeSpans(extracted, narrative);
  const goldenSpans = exactNarrativeSpans(golden, narrative);
  const normalizedGoldenSummary = normalizeMeaning(golden.event_summary, aliases);
  const materialTokens = materialTimelineTokens(golden.event_summary, aliases);
  if (materialTokens.length < 2) return null;

  const extractedTokens = new Set(materialTimelineTokens(extracted.event_summary, aliases));
  if (!materialTokens.every((token) => extractedTokens.has(token))) return null;

  for (const goldenSpan of goldenSpans) {
    if (normalizeMeaning(goldenSpan.quote, aliases) !== normalizedGoldenSummary) continue;
    for (const extractedSpan of extractedSpans) {
      const nested =
        goldenSpan.start_char >= extractedSpan.start_char &&
        goldenSpan.end_char <= extractedSpan.end_char &&
        (goldenSpan.start_char > extractedSpan.start_char ||
          goldenSpan.end_char < extractedSpan.end_char);
      if (!nested) continue;
      if (
        !sameExactSpan(extractedSpan, dryRun001TimelineContainmentRepresentation.extractedSpan) ||
        !sameExactSpan(goldenSpan, dryRun001TimelineContainmentRepresentation.goldenSpan)
      ) {
        return null;
      }
      return { extractedSpan, goldenSpan, materialTokens };
    }
  }
  return null;
}

/**
 * Build the explicit PR #17 alignment projection from the unchanged PR #16
 * extraction. Exactly one mutually unique containment must be proven; zero,
 * multiple, or competing candidates fail closed.
 */
export function alignDryRun001TimelineContainmentProjection(
  extracted: JsonObject,
  golden: JsonObject,
  options: PersonAAlignmentOptions,
): TimelineContainmentAlignment {
  requirePersonAEvaluationContractVersion(options.contractVersion);
  if (options.contractVersion !== 'calibrated_live_v2') {
    throw new Error('Dry Run 001 timeline containment requires calibrated_live_v2.');
  }
  if (typeof options.narrative !== 'string' || options.narrative.length === 0) {
    throw new Error('Dry Run 001 timeline containment requires the exact narrative.');
  }

  const aliases = options.aliases ?? {};
  const prior = alignPriorProjection(extracted, golden, options);
  const extractedItems = familyItems(extracted, 'timeline');
  const goldenItems = familyItems(golden, 'timeline');
  const candidates: Candidate[] = [];

  for (const extra of prior.families.timeline.unmatched_extracted) {
    for (const missing of prior.families.timeline.unmatched_golden) {
      const left = extractedItems[extra.index] ?? {};
      const right = goldenItems[missing.index] ?? {};
      const proof = proveExactSourceTimelineContainment(left, right, options.narrative, aliases);
      if (proof === null) continue;
      candidates.push({
        extractedIndex: extra.index,
        goldenIndex: missing.index,
        proof,
        score: 0.9 + 0.1 * semanticSimilarity(left.event_summary, right.event_summary, aliases),
      });
    }
  }

  const extractedCounts = new Map<number, number>();
  const goldenCounts = new Map<number, number>();
  for (const candidate of candidates) {
    extractedCounts.set(
      candidate.extractedIndex,
      (extractedCounts.get(candidate.extractedIndex) ?? 0) + 1,
    );
    goldenCounts.set(candidate.goldenIndex, (goldenCounts.get(candidate.goldenIndex) ?? 0) + 1);
  }
  const mutuallyUnique = candidates.filter(
    (candidate) =>
      extractedCounts.get(candidate.extractedIndex) === 1 &&
      goldenCounts.get(candidate.goldenIndex) === 1,
  );
  if (candidates.length !== 1 || mutuallyUnique.length !== 1) {
    throw new Error(
      'Dry Run 001 timeline containment requires exactly one mutually unique exact-source pair.',
    );
  }

  const candidate = mutuallyUnique[0]!;
  const left = extractedItems[candidate.extractedIndex] ?? {};
  const right = goldenItems[candidate.goldenIndex] ?? {};
  if (typeof left.event_id !== 'string' || typeof right.event_id !== 'string') {
    throw new Error('Dry Run 001 timeline containment requires stable event identifiers.');
  }

  const alignment = structuredClone(prior) as TimelineContainmentAlignment;
  const pair: AlignmentPair & {
    recovery_reason: 'exact_source_containment';
  } = {
    extracted_index: candidate.extractedIndex,
    golden_index: candidate.goldenIndex,
    extracted_id: left.event_id,
    golden_id: right.event_id,
    score: candidate.score,
    margin: candidate.score,
    recovery_reason: 'exact_source_containment',
  };
  alignment.families.timeline.pairs.push(pair);
  alignment.families.timeline.unmatched_extracted =
    alignment.families.timeline.unmatched_extracted.filter(
      (item) => item.index !== candidate.extractedIndex,
    );
  alignment.families.timeline.unmatched_golden =
    alignment.families.timeline.unmatched_golden.filter(
      (item) => item.index !== candidate.goldenIndex,
    );
  alignment.compatibility_audit = {
    version: 'dry-run-001-timeline-containment-v1',
    entries: [
      {
        rule_id: 'exact_source_timeline_containment',
        extracted_id: left.event_id,
        golden_id: right.event_id,
        recovery_reason: 'exact_source_containment',
        extracted_span: candidate.proof.extractedSpan,
        golden_span: candidate.proof.goldenSpan,
        material_tokens: candidate.proof.materialTokens,
        extracted_record_sha256: dryRun001TimelineContainmentRepresentation.extractedRecordSha256,
        golden_record_sha256: dryRun001TimelineContainmentRepresentation.goldenRecordSha256,
      },
    ],
  };
  return alignment;
}
