import {
  evaluatePersonAForCase as evaluateBase,
  reportMarkdown,
  type PersonAEvaluationReport,
} from './person-a-diff.js';
import {
  DRY_RUN_001_COMPATIBILITY_ALIASES,
  evidenceIdentityCorrespondence,
  familyItems,
  normalizeMeaning,
  semanticSimilarity,
  sourceSpanOverlap,
  type PersonAAlignmentOptions,
  type PersonAAlignment,
  type PersonAFamily,
  type PersonASemanticAliases,
} from '../alignment/person-a-alignment-corrected.js';
import type { EvidenceRecallDiagnostics } from './person-a-diff.js';

type JsonObject = Record<string, any>;

const agreementTermFunctionWords = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'been',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'his',
  'i',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'says',
  'she',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'through',
  'to',
  'was',
  'were',
  'when',
  'which',
  'while',
  'with',
]);

const agreementTokenAliases: Record<string, string> = {
  accepted: 'accept',
  accepts: 'accept',
  added: 'addition',
  additions: 'addition',
  asked: 'request',
  changes: 'change',
  changed: 'change',
  contributed: 'contribute',
  contributor: 'contribute',
  documented: 'document',
  documenting: 'document',
  requested: 'request',
  requests: 'request',
  rounds: 'round',
};

const materialLegalConcepts = new Set([
  'arbitration',
  'damages',
  'indemnification',
  'indemnify',
  'interest',
  'liability',
  'liable',
  'penalty',
  'remedy',
  'surrender',
  'terminate',
  'termination',
  'waive',
  'waiver',
  'warranty',
]);

function distinctiveTermTokens(value: unknown, aliases: PersonASemanticAliases): Set<string> {
  const identityTokens = new Set([
    ...Object.keys(aliases).map((token) => token.toLocaleLowerCase()),
    ...Object.values(aliases).map((token) => token.toLocaleLowerCase()),
  ]);
  return new Set(
    normalizeMeaning(value, aliases)
      .split(' ')
      .map((token) => agreementTokenAliases[token] ?? token)
      .filter(
        (token) =>
          token.length >= 2 && !agreementTermFunctionWords.has(token) && !identityTokens.has(token),
      ),
  );
}

function exactSourceQuotes(item: JsonObject, narrative: string | undefined): string[] {
  if (narrative === undefined) return [];
  return Array.isArray(item.source_spans)
    ? item.source_spans
        .filter(
          (span: JsonObject) =>
            typeof span?.quote === 'string' &&
            Number.isInteger(span?.start_char) &&
            Number.isInteger(span?.end_char) &&
            narrative.slice(span.start_char, span.end_char) === span.quote,
        )
        .map((span: JsonObject) => span.quote as string)
    : [];
}

function sharedTokenCount(left: Set<string>, right: Set<string>): number {
  return [...left].filter((token) => right.has(token)).length;
}

function agreementTermTypeSupported(
  item: JsonObject,
  quotes: string[],
  aliases: PersonASemanticAliases,
): boolean {
  const text = `${item.wording ?? ''} ${quotes.join(' ')}`;
  const tokens = distinctiveTermTokens(text, aliases);
  const hasAny = (...values: string[]): boolean => values.some((value) => tokens.has(value));
  switch (item.term_type) {
    case 'scope':
      return hasAny(
        'change',
        'design',
        'homepage',
        'included',
        'job',
        'layout',
        'newsletter',
        'page',
        'request',
        'scope',
        'section',
        'services',
        'signup',
        'website',
      );
    case 'price':
      return /\$\s*\d/u.test(text) || hasAny('cost', 'fee', 'price', 'rate');
    case 'deposit':
      return hasAny('deposit', 'upfront');
    case 'payment_trigger':
      return hasAny('balance', 'due', 'paid', 'payment');
    case 'deadline':
      return hasAny('deadline', 'launch', 'timeline');
    case 'client_dependency':
      return hasAny('access', 'content', 'copy', 'depend', 'images', 'supply');
    case 'revision_limit':
      return hasAny('limit', 'revision', 'round');
    case 'credentials':
      return hasAny('administrator', 'credential', 'credentials', 'source');
    default:
      return false;
  }
}

function termAssertionSupportedByNarrative(
  item: JsonObject,
  aliases: PersonASemanticAliases,
  narrative: string | undefined,
): boolean {
  const quotes = exactSourceQuotes(item, narrative);
  if (quotes.length === 0) return false;
  const wordingTokens = distinctiveTermTokens(item.wording, aliases);
  const quoteTokens = distinctiveTermTokens(quotes.join(' '), aliases);
  const shared = sharedTokenCount(wordingTokens, quoteTokens);
  const coverage = wordingTokens.size === 0 ? 0 : shared / wordingTokens.size;
  if (wordingTokens.size < 2 || shared < 2 || coverage < 0.65) return false;
  if (!agreementTermTypeSupported(item, quotes, aliases)) return false;

  const assertedLegalConcepts = [
    ...distinctiveTermTokens(
      `${item.wording ?? ''} ${item.person_a_interpretation ?? ''}`,
      aliases,
    ),
  ].filter((token) => materialLegalConcepts.has(token));
  const narrativeTokens = distinctiveTermTokens(narrative, aliases);
  return assertedLegalConcepts.every((token) => narrativeTokens.has(token));
}

function termCorrespondsToBroaderGolden(
  extractedItem: JsonObject,
  goldenItem: JsonObject,
  aliases: PersonASemanticAliases,
): boolean {
  if (!agreementTermCategoriesCompatible(extractedItem.term_type, goldenItem.term_type)) {
    return false;
  }
  const extractedTokens = distinctiveTermTokens(extractedItem.wording, aliases);
  const goldenTokens = distinctiveTermTokens(
    `${goldenItem.wording ?? ''} ${goldenItem.person_a_interpretation ?? ''}`,
    aliases,
  );
  return sharedTokenCount(extractedTokens, goldenTokens) >= 2;
}

const scopeComponentTermTypes = new Set([
  'scope',
  'price',
  'deposit',
  'payment_trigger',
  'deadline',
  'client_dependency',
  'revision_limit',
  'credentials',
]);

function agreementTermCategoriesCompatible(extractedType: unknown, goldenType: unknown): boolean {
  return (
    extractedType === goldenType ||
    (goldenType === 'scope' &&
      typeof extractedType === 'string' &&
      scopeComponentTermTypes.has(extractedType))
  );
}

function isAgreementTermDecomposition(
  extractedItem: JsonObject,
  goldenItems: JsonObject[],
  alignment: PersonAAlignment['families']['agreement_terms'],
  aliases: PersonASemanticAliases,
  narrative: string | undefined,
): boolean {
  if (!termAssertionSupportedByNarrative(extractedItem, aliases, narrative)) return false;
  return alignment.pairs.some((pair) => {
    const goldenItem = goldenItems[pair.golden_index] ?? {};
    return (
      agreementTermCategoriesCompatible(extractedItem.term_type, goldenItem.term_type) &&
      termCorrespondsToBroaderGolden(extractedItem, goldenItem, aliases)
    );
  });
}

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
  aliases: PersonASemanticAliases,
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
      semanticSimilarity(
        familyMeaning(family, extractedItem),
        familyMeaning(family, goldenItem),
        aliases,
      ) >= 0.45
    );
  });
}

function hasQuotedMeaning(
  family: PersonAFamily,
  item: JsonObject,
  aliases: PersonASemanticAliases,
): boolean {
  const quotes = Array.isArray(item.source_spans)
    ? item.source_spans
        .map((span: JsonObject) => span?.quote)
        .filter((quote: unknown): quote is string => typeof quote === 'string' && quote.length > 0)
        .join(' ')
    : '';
  return (
    quotes.length > 0 && semanticSimilarity(familyMeaning(family, item), quotes, aliases) >= 0.4
  );
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
  aliases: PersonASemanticAliases,
  allowAgreementTermCalibration: boolean,
  narrative: string | undefined,
): boolean {
  if (family === 'agreement_terms') {
    return (
      allowAgreementTermCalibration && termAssertionSupportedByNarrative(item, aliases, narrative)
    );
  }
  if (family === 'claims')
    return item.party_id === 'party_a' && hasQuotedMeaning(family, item, aliases);
  if (family === 'timeline') return hasQuotedMeaning(family, item, aliases);
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
        hasQuotedMeaning('claims', claim, aliases) &&
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
      hasQuotedMeaning('claims', claim, aliases),
  );
}

type EvidenceObservabilityRule = {
  label: string;
  phrases: string[];
};

const evidenceObservabilityRules: Record<string, EvidenceObservabilityRule> = {
  contract: {
    label: 'a contract or signed agreement artifact',
    phrases: ['signed agreement', 'agreement is attached', 'contract is attached'],
  },
  payment_record: {
    label: 'a payment-record artifact',
    phrases: ['invoice', 'receipt', 'payment record', 'bank statement', 'transaction record'],
  },
  message_export: {
    label: 'a message export or saved message-history artifact',
    phrases: [
      'message export',
      'whatsapp export',
      'chat export',
      'exported messages',
      'message history',
    ],
  },
  message_history: {
    label: 'a saved message-history artifact',
    phrases: ['message history', 'saved messages', 'chat history'],
  },
  message_screenshot: {
    label: 'a message screenshot artifact',
    phrases: ['screenshot', 'screen shot'],
  },
  email_thread: {
    label: 'an email-thread artifact',
    phrases: ['email', 'e mail', 'mail thread'],
  },
  project_history: {
    label: 'a project or version-history artifact',
    phrases: ['version history', 'project history', 'design history', 'history export'],
  },
  social_media_post: {
    label: 'a social-media post artifact',
    phrases: ['social media post', 'instagram post', 'facebook post'],
  },
  screen_recording: {
    label: 'a screen-recording artifact',
    phrases: ['screen recording', 'recording', 'video capture'],
  },
  video: {
    label: 'a video-call or video-recording artifact',
    phrases: ['video call', 'video recording', 'zoom call'],
  },
};

function normalizedPhrase(value: unknown): string {
  return meaningTokens(value).join(' ');
}

function containsPhrase(narrative: string, phrase: string): boolean {
  return normalizedPhrase(narrative).includes(normalizedPhrase(phrase));
}

function extractHasObservableQuote(item: JsonObject, narrative: string): boolean {
  const normalizedNarrative = normalizedPhrase(narrative);
  const narrativeTokens = new Set(meaningTokens(narrative));
  const extracts = Array.isArray(item.extracts) ? item.extracts : [];
  return extracts.some((extract: JsonObject) => {
    const normalizedExtract = normalizedPhrase(extract?.text);
    if (normalizedExtract.length === 0) return false;
    if (normalizedNarrative.includes(normalizedExtract)) return true;
    const tokens = meaningTokens(extract?.text).filter((token) => token.length >= 4);
    const shared = tokens.filter((token) => narrativeTokens.has(token)).length;
    return tokens.length >= 2 && shared / tokens.length >= 0.5;
  });
}

export function classifyGoldenEvidenceObservability(
  item: JsonObject,
  narrative: string,
): { observable: boolean; reason: string } {
  if (extractHasObservableQuote(item, narrative)) {
    return {
      observable: true,
      reason: 'A quoted evidence detail is stated in the Person A narrative.',
    };
  }
  const rule = evidenceObservabilityRules[item.evidence_type];
  if (rule && rule.phrases.some((phrase) => containsPhrase(narrative, phrase))) {
    return {
      observable: true,
      reason: `The Person A narrative describes ${rule.label}.`,
    };
  }
  const label = rule?.label ?? `an artifact of type '${String(item.evidence_type)}'`;
  return {
    observable: false,
    reason: `Excluded from extractor recall because the Person A narrative does not describe ${label}.`,
  };
}

function evidenceRecallDiagnostics(
  extractedItems: JsonObject[],
  goldenItems: JsonObject[],
  alignment: PersonAAlignment['families']['evidence'],
  aliases: PersonASemanticAliases,
  narrative: string | undefined,
): EvidenceRecallDiagnostics {
  const fullMatched = new Set(alignment.pairs.map((pair) => pair.golden_index));
  const fullMatchedCount = fullMatched.size;
  const representationDifferences: EvidenceRecallDiagnostics['representation_differences'] =
    alignment.pairs.flatMap((pair) => {
      const extracted = extractedItems[pair.extracted_index] ?? {};
      const golden = goldenItems[pair.golden_index] ?? {};
      if (
        typeof extracted.evidence_type !== 'string' ||
        typeof golden.evidence_type !== 'string' ||
        extracted.evidence_type === golden.evidence_type
      ) {
        return [];
      }
      const correspondence = evidenceIdentityCorrespondence(extracted, golden, aliases);
      if (!correspondence.matches || correspondence.basis === null) return [];
      return [
        {
          extracted_id: pair.extracted_id,
          golden_id: pair.golden_id,
          extracted_type: extracted.evidence_type,
          golden_type: golden.evidence_type,
          basis: correspondence.basis,
          reason:
            correspondence.basis === 'quoted_content'
              ? 'Substantively corresponding quoted message content identifies the same evidence despite different representations.'
              : 'Substantively corresponding artifact identity identifies the same message record despite different representations.',
        },
      ];
    });
  if (narrative === undefined) {
    return {
      observability_basis: 'unavailable',
      total_golden_evidence: goldenItems.length,
      observable_golden_evidence: 0,
      unobservable_golden_evidence: 0,
      matched_observable_evidence: 0,
      observable_recall: null,
      full_golden_matched_evidence: fullMatchedCount,
      full_golden_recall: goldenItems.length === 0 ? 1 : fullMatchedCount / goldenItems.length,
      matched_unobservable_evidence: [],
      representation_differences: representationDifferences,
      excluded_from_extractor_recall: [],
    };
  }

  const observableIndexes = new Set<number>();
  const excluded: EvidenceRecallDiagnostics['excluded_from_extractor_recall'] = [];
  goldenItems.forEach((item, index) => {
    const classification = classifyGoldenEvidenceObservability(item, narrative);
    const goldenId = typeof item.evidence_id === 'string' ? item.evidence_id : `evidence_${index}`;
    if (classification.observable) observableIndexes.add(index);
    else excluded.push({ golden_id: goldenId, reason: classification.reason });
  });
  const matchedObservable = [...observableIndexes].filter((index) => fullMatched.has(index)).length;
  const matchedUnobservable: EvidenceRecallDiagnostics['matched_unobservable_evidence'] =
    alignment.pairs.flatMap((pair) =>
      observableIndexes.has(pair.golden_index)
        ? []
        : [
            {
              extracted_id: pair.extracted_id,
              golden_id: pair.golden_id,
              reason:
                'Counted only in the full-golden diagnostic because substantive artifact identity aligned; it remains excluded from observable extractor recall.',
            },
          ],
    );
  return {
    observability_basis: 'person_a_narrative',
    total_golden_evidence: goldenItems.length,
    observable_golden_evidence: observableIndexes.size,
    unobservable_golden_evidence: goldenItems.length - observableIndexes.size,
    matched_observable_evidence: matchedObservable,
    observable_recall:
      observableIndexes.size === 0 ? 1 : matchedObservable / observableIndexes.size,
    full_golden_matched_evidence: fullMatchedCount,
    full_golden_recall: goldenItems.length === 0 ? 1 : fullMatchedCount / goldenItems.length,
    matched_unobservable_evidence: matchedUnobservable,
    representation_differences: representationDifferences,
    excluded_from_extractor_recall: excluded,
  };
}

function compareEvidenceExtractAuthors(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
  report: PersonAEvaluationReport,
  aliases: PersonASemanticAliases,
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
        const score = semanticSimilarity(extractedExtract.text, goldenExtract.text, aliases);
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

export function evaluatePersonAForCase(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
  options: PersonAAlignmentOptions,
): PersonAEvaluationReport {
  const aliases = options.aliases ?? {};
  const calibrated = options.contractVersion === 'calibrated_live_v2';
  const report = evaluateBase(extracted, golden, alignment, options);
  const extractedEvidence = familyItems(extracted, 'evidence');
  const goldenEvidence = familyItems(golden, 'evidence');
  const narrative =
    options.narrative ??
    (typeof extracted.submission?.raw_text === 'string'
      ? extracted.submission.raw_text
      : undefined);
  const evidenceRecall = evidenceRecallDiagnostics(
    extractedEvidence,
    goldenEvidence,
    alignment.families.evidence,
    aliases,
    calibrated ? narrative : undefined,
  );
  const unobservableGoldenIds = new Set(
    evidenceRecall.excluded_from_extractor_recall.map((entry) => entry.golden_id),
  );
  if (calibrated) {
    report.errors = report.errors.filter(
      (error) =>
        !(
          error.family === 'evidence' &&
          error.code === 'missing_golden_object' &&
          typeof error.golden_id === 'string' &&
          unobservableGoldenIds.has(error.golden_id)
        ),
    );
    report.evidence_recall = evidenceRecall;
  }
  compareEvidenceExtractAuthors(extracted, golden, alignment, report, aliases);

  const editedObjects = new Set<string>();
  let goldenTotal = 0;

  for (const [family, familyAlignment] of Object.entries(alignment.families) as Array<
    [PersonAFamily, PersonAAlignment['families'][PersonAFamily]]
  >) {
    const goldenItems = familyItems(golden, family);
    const extractedItems = familyItems(extracted, family);
    goldenTotal += goldenItems.length;

    const ambiguousMatches = familyAlignment.ambiguous.length;
    const matched =
      family === 'evidence' && evidenceRecall.observability_basis === 'person_a_narrative'
        ? evidenceRecall.matched_observable_evidence
        : familyAlignment.pairs.length + ambiguousMatches;
    const goldenMetricTotal =
      family === 'evidence' && evidenceRecall.observability_basis === 'person_a_narrative'
        ? evidenceRecall.observable_golden_evidence
        : goldenItems.length;
    report.metrics[family] = {
      matched,
      golden_total: goldenMetricTotal,
      extracted_total: extractedItems.length,
      recall: goldenMetricTotal === 0 ? 1 : Math.min(1, matched / goldenMetricTotal),
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
        calibrated &&
        error.family === 'agreement_terms' &&
        isAgreementTermDecomposition(
          extractedItem,
          goldenItems,
          familyAlignment,
          aliases,
          narrative,
        )
      ) {
        error.severity = 'minor';
        error.code = 'agreement_term_decomposition';
        error.message =
          'Separately named source-grounded agreement component is covered by a broader compatible golden term.';
      } else if (
        unmatched &&
        isMatchedGranularitySplit(
          error.family,
          extractedItem,
          goldenItems,
          familyAlignment,
          aliases,
        )
      ) {
        error.severity = 'major';
        error.code = 'granularity_split';
        error.message =
          'Extracted object splits a source-grounded golden object and requires consolidation.';
      } else if (
        isSourceGroundedExtra(
          error.family,
          extractedItem,
          extracted,
          alignment,
          aliases,
          calibrated,
          narrative,
        )
      ) {
        error.severity = 'major';
        error.code = 'source_grounded_extra_object';
        error.message =
          error.family === 'agreement_terms'
            ? 'Extracted assertion and category are supported by exact source slices but have no golden match and require review for granularity or a golden omission.'
            : 'Extracted object is source-grounded but has no golden match and requires review for granularity or unsupported inference.';
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

export function evaluatePersonA(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
): PersonAEvaluationReport {
  return evaluatePersonAForCase(extracted, golden, alignment, {
    aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
    contractVersion: 'calibrated_live_v2',
    ...(typeof extracted.submission?.raw_text === 'string'
      ? { narrative: extracted.submission.raw_text }
      : {}),
  });
}

export { reportMarkdown };
export type { PersonAEvaluationReport } from './person-a-diff.js';
