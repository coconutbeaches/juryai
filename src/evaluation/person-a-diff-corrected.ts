import {
  evaluatePersonA as evaluateBase,
  reportMarkdown,
  type PersonAEvaluationReport,
} from './person-a-diff.js';
import {
  familyItems,
  semanticSimilarity,
  sourceSpanOverlap,
  type PersonAAlignment,
  type PersonAFamily,
} from '../alignment/person-a-alignment-corrected.js';

type JsonObject = Record<string, any>;

function familyMeaning(family: PersonAFamily, item: JsonObject): unknown {
  switch (family) {
    case 'agreement_terms':
      return `${item.wording ?? ''} ${item.person_a_interpretation ?? ''}`;
    case 'timeline':
      return item.event_summary;
    case 'claims':
      return item.claim_text;
    case 'extraction_issues':
      return item.description;
    default:
      return '';
  }
}

function isMatchedGranularitySplit(
  family: PersonAFamily,
  extractedItem: JsonObject,
  goldenItems: JsonObject[],
  alignment: PersonAAlignment['families'][PersonAFamily],
): boolean {
  if (!['agreement_terms', 'timeline', 'claims', 'extraction_issues'].includes(family)) {
    return false;
  }

  return alignment.pairs.some((pair) => {
    const goldenItem = goldenItems[pair.golden_index] ?? {};
    if (family === 'claims' && extractedItem.party_id !== goldenItem.party_id) {
      return false;
    }
    return (
      sourceSpanOverlap(extractedItem, goldenItem) >= 0.8 &&
      semanticSimilarity(familyMeaning(family, extractedItem), familyMeaning(family, goldenItem)) >=
        0.45
    );
  });
}

function hasQuotedMeaning(family: PersonAFamily, item: JsonObject): boolean {
  const quotes = Array.isArray(item.source_spans)
    ? item.source_spans
        .map((span: JsonObject) => span?.quote)
        .filter((quote: unknown): quote is string => typeof quote === 'string' && quote.length > 0)
        .join(' ')
    : '';
  return quotes.length > 0 && semanticSimilarity(familyMeaning(family, item), quotes) >= 0.4;
}

function meaningTokens(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 0)
    : [];
}

function claimSupportsDeliverableName(item: JsonObject, claim: JsonObject): boolean {
  const nameTokens = meaningTokens(item.name);
  if (nameTokens.length === 0) return false;
  const quotes = Array.isArray(claim.source_spans)
    ? claim.source_spans
        .map((span: JsonObject) => span?.quote)
        .filter((quote: unknown): quote is string => typeof quote === 'string')
        .join(' ')
    : '';
  const support = new Set(meaningTokens(`${claim.claim_text ?? ''} ${quotes}`));
  const covered = nameTokens.filter((token) => support.has(token)).length;
  return covered / nameTokens.length >= 0.5;
}

function isSourceGroundedExtra(
  family: PersonAFamily,
  item: JsonObject,
  extracted: JsonObject,
  alignment: PersonAAlignment,
): boolean {
  if (family === 'claims') return item.party_id === 'party_a' && hasQuotedMeaning(family, item);
  if (family === 'timeline') return hasQuotedMeaning(family, item);
  if (family === 'deliverables') {
    const claimIds = Array.isArray(item.source_claim_ids) ? item.source_claim_ids : [];
    if (claimIds.length === 0) return false;
    const claims = familyItems(extracted, 'claims');
    const matchedExtractedClaimIds = new Set(
      alignment.families.claims.pairs.map((pair) => pair.extracted_id),
    );
    return claimIds.some((claimId) => {
      const claim = claims.find((candidate) => candidate.claim_id === claimId);
      return (
        claim !== undefined &&
        matchedExtractedClaimIds.has(claimId) &&
        hasQuotedMeaning('claims', claim) &&
        claimSupportsDeliverableName(item, claim)
      );
    });
  }
  if (
    family !== 'evidence' ||
    item.submitted_by_party_id !== 'party_a' ||
    !['described_only', 'unavailable'].includes(item.availability_status) ||
    typeof item.evidence_id !== 'string'
  ) {
    return false;
  }
  const claims = familyItems(extracted, 'claims');
  return claims.some(
    (claim) =>
      Array.isArray(claim.supporting_evidence_ids) &&
      claim.supporting_evidence_ids.includes(item.evidence_id) &&
      hasQuotedMeaning('claims', claim),
  );
}

function compareEvidenceExtractAuthors(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
  report: PersonAEvaluationReport,
): void {
  const extractedItems = familyItems(extracted, 'evidence');
  const goldenItems = familyItems(golden, 'evidence');

  for (const pair of alignment.families.evidence.pairs) {
    const extractedEvidence = extractedItems[pair.extracted_index] ?? {};
    const goldenEvidence = goldenItems[pair.golden_index] ?? {};
    const extractedExtracts = Array.isArray(extractedEvidence.extracts)
      ? extractedEvidence.extracts
      : [];
    const goldenExtracts = Array.isArray(goldenEvidence.extracts) ? goldenEvidence.extracts : [];
    let authorReversed = false;

    for (const goldenExtract of goldenExtracts) {
      let best: JsonObject | null = null;
      let bestScore = 0;
      for (const extractedExtract of extractedExtracts) {
        const score = semanticSimilarity(extractedExtract.text, goldenExtract.text);
        if (score > bestScore) {
          bestScore = score;
          best = extractedExtract;
        }
      }
      if (
        best &&
        bestScore >= 0.6 &&
        (best.author_party_id !== goldenExtract.author_party_id ||
          best.author_third_party_id !== goldenExtract.author_third_party_id)
      ) {
        authorReversed = true;
        break;
      }
    }

    if (authorReversed) {
      report.errors.push({
        severity: 'critical',
        family: 'evidence',
        code: 'extract_author_reversed',
        message: 'A quoted evidence extract was attributed to the wrong author.',
        extracted_id: pair.extracted_id,
        golden_id: pair.golden_id,
      });
    }
  }
}

export function evaluatePersonA(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
): PersonAEvaluationReport {
  const report = evaluateBase(extracted, golden, alignment);
  compareEvidenceExtractAuthors(extracted, golden, alignment, report);

  const editedObjects = new Set<string>();
  let goldenTotal = 0;

  for (const [family, familyAlignment] of Object.entries(alignment.families) as Array<
    [PersonAFamily, PersonAAlignment['families'][PersonAFamily]]
  >) {
    const goldenItems = familyItems(golden, family);
    const extractedItems = familyItems(extracted, family);
    goldenTotal += goldenItems.length;

    const ambiguousMatches = familyAlignment.ambiguous.length;
    const matched = familyAlignment.pairs.length + ambiguousMatches;
    report.metrics[family] = {
      matched,
      golden_total: goldenItems.length,
      extracted_total: extractedItems.length,
      recall: goldenItems.length === 0 ? 1 : Math.min(1, matched / goldenItems.length),
      precision:
        extractedItems.length === 0
          ? goldenItems.length === 0
            ? 1
            : 0
          : Math.min(1, matched / extractedItems.length),
    };

    for (const ambiguous of familyAlignment.ambiguous) {
      editedObjects.add(`${family}:ambiguous:${ambiguous.extracted_id}`);
    }
  }

  for (const error of report.errors) {
    if (error.code === 'unmatched_extracted_object') {
      const familyAlignment = alignment.families[error.family];
      const extractedItems = familyItems(extracted, error.family);
      const goldenItems = familyItems(golden, error.family);
      const unmatched = familyAlignment.unmatched_extracted.find(
        (item) => item.id === error.extracted_id,
      );
      const extractedItem = unmatched ? (extractedItems[unmatched.index] ?? {}) : {};

      if (
        unmatched &&
        isMatchedGranularitySplit(error.family, extractedItem, goldenItems, familyAlignment)
      ) {
        error.severity = 'major';
        error.code = 'granularity_split';
        error.message =
          'Extracted object splits a source-grounded golden object and requires consolidation.';
      } else if (isSourceGroundedExtra(error.family, extractedItem, extracted, alignment)) {
        error.severity = 'major';
        error.code = 'source_grounded_extra_object';
        error.message =
          'Extracted object is grounded in an exact source quote but has no golden match and requires review for granularity or unsupported inference.';
      } else if (!['clarification_questions', 'extraction_issues'].includes(error.family)) {
        error.severity = 'critical';
        error.code = 'unsupported_extra_object';
        error.message =
          'Extracted object has no supported golden match and is a fabrication hard failure.';
      }
    }
    if (error.golden_id) editedObjects.add(`${error.family}:${error.golden_id}`);
    else if (error.code === 'ambiguous_alignment' && error.extracted_id) {
      editedObjects.add(`${error.family}:ambiguous:${error.extracted_id}`);
    }
  }

  report.summary.critical = report.errors.filter((error) => error.severity === 'critical').length;
  report.summary.major = report.errors.filter((error) => error.severity === 'major').length;
  report.summary.minor = report.errors.filter((error) => error.severity === 'minor').length;
  report.summary.human_edit_rate = goldenTotal === 0 ? 0 : editedObjects.size / goldenTotal;
  const weighted =
    report.summary.critical + report.summary.major * 0.5 + report.summary.minor * 0.1;
  report.summary.weighted_error_rate = goldenTotal === 0 ? 0 : weighted / goldenTotal;
  return report;
}

export { reportMarkdown };
export type { PersonAEvaluationReport } from './person-a-diff.js';
