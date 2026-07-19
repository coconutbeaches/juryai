import {
  evaluatePersonA as evaluateBase,
  reportMarkdown,
  type PersonAEvaluationReport,
} from './person-a-diff.js';
import {
  familyItems,
  semanticSimilarity,
  type PersonAAlignment,
  type PersonAFamily,
} from '../alignment/person-a-alignment-corrected.js';

type JsonObject = Record<string, any>;

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
      error.severity = 'critical';
      error.code = 'unsupported_extra_object';
      error.message =
        'Extracted object has no supported golden match and is a fabrication hard failure.';
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
