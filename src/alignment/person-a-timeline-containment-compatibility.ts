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

function assertsTimelineDependency(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /\b(?:depend(?:ed|ence|ency|ent|s)?|requir(?:e|ed|ement|es|ing)|must|needed\s+to|had\s+to)\b/iu.test(
      value,
    )
  );
}

function contradictsTimelineDependency(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /\b(?:miss(?:ed|ing)|fail(?:ed|ing)?\s+to|did\s+not|late|after\s+the\s+deadline|supersed(?:e|ed|es|ing)|replac(?:e|ed|es|ing)|waiv(?:e|ed|es|ing)|cancel(?:ed|ing|led|s)?|rescind(?:ed|ing|s)?|extend(?:ed|ing|s)?|postpon(?:e|ed|es|ing)|mov(?:e|ed|es|ing)\s+the\s+deadline)\b/iu.test(
      value,
    )
  );
}

const timelineClauseBoundary = /[;.!?](?:\s|$)|,\s+(?:although|but|whereas|while)\b/giu;

function timelineClauses(value: string): string[] {
  return value
    .split(timelineClauseBoundary)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

function dependencyGovernsSummaryDate(
  summary: unknown,
  materialTokens: string[],
  aliases: PersonASemanticAliases,
): boolean {
  if (typeof summary !== 'string' || contradictsTimelineDependency(summary)) return false;
  return timelineClauses(summary).some((clause) => {
    const tokens = new Set(materialTimelineTokens(clause, aliases));
    return (
      materialTokens.every((token) => tokens.has(token)) &&
      assertsTimelineDependency(clause) &&
      !contradictsTimelineDependency(clause)
    );
  });
}

function dependencyGovernsNestedLeaf(extractedSpan: ExactSpan, goldenSpan: ExactSpan): boolean {
  const leafStart = goldenSpan.start_char - extractedSpan.start_char;
  const leafEnd = goldenSpan.end_char - extractedSpan.start_char;
  if (leafStart < 0 || leafEnd > extractedSpan.quote.length || leafEnd <= leafStart) return false;

  let clauseStart = 0;
  const prefix = extractedSpan.quote.slice(0, leafStart);
  for (const boundary of prefix.matchAll(
    new RegExp(timelineClauseBoundary.source, timelineClauseBoundary.flags),
  )) {
    clauseStart = (boundary.index ?? 0) + boundary[0].length;
  }
  const containingClause = extractedSpan.quote.slice(clauseStart, leafEnd);
  return (
    assertsTimelineDependency(containingClause) &&
    !contradictsTimelineDependency(containingClause) &&
    !contradictsTimelineDependency(extractedSpan.quote)
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
        !dependencyGovernsSummaryDate(extracted.event_summary, materialTokens, aliases) ||
        !dependencyGovernsNestedLeaf(extractedSpan, goldenSpan) ||
        !assertsTimelineDependency(golden.person_a_interpretation) ||
        contradictsTimelineDependency(golden.person_a_interpretation)
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
      },
    ],
  };
  return alignment;
}
