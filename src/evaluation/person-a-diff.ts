import {
  DRY_RUN_001_COMPATIBILITY_ALIASES,
  evidenceIdentityCorrespondence,
  evidenceTypesCompatible,
  familyItems,
  requirePersonAEvaluationContractVersion,
  semanticSimilarity,
  type PersonAAlignmentOptions,
  type PersonAAlignment,
  type PersonAFamily,
  type PersonASemanticAliases,
} from '../alignment/person-a-alignment.js';

type JsonObject = Record<string, any>;
export type ErrorSeverity = 'critical' | 'major' | 'minor';

export type EvaluationError = {
  severity: ErrorSeverity;
  family: PersonAFamily;
  code: string;
  message: string;
  extracted_id?: string;
  golden_id?: string;
};

export type FamilyMetrics = {
  matched: number;
  golden_total: number;
  extracted_total: number;
  recall: number;
  precision: number;
};

export type PersonAEvaluationReport = {
  version: 'person-a-evaluation-v0.1.0';
  schema_version: '0.1.2';
  summary: {
    critical: number;
    major: number;
    minor: number;
    human_edit_rate: number;
    weighted_error_rate: number;
  };
  metrics: Record<PersonAFamily, FamilyMetrics>;
  evidence_recall?: EvidenceRecallDiagnostics;
  errors: EvaluationError[];
};

export type EvidenceRecallDiagnostics = {
  observability_basis: 'person_a_narrative' | 'unavailable';
  total_golden_evidence: number;
  observable_golden_evidence: number;
  unobservable_golden_evidence: number;
  matched_observable_evidence: number;
  observable_recall: number | null;
  full_golden_matched_evidence: number;
  full_golden_recall: number;
  matched_unobservable_evidence: Array<{
    extracted_id: string;
    golden_id: string;
    reason: string;
  }>;
  representation_differences: Array<{
    extracted_id: string;
    golden_id: string;
    extracted_type: string;
    golden_type: string;
    basis: 'quoted_content' | 'artifact_identity';
    reason: string;
  }>;
  excluded_from_extractor_recall: Array<{
    golden_id: string;
    reason: string;
  }>;
};

const equalSet = (a: unknown, b: unknown): boolean => {
  const left = new Set(Array.isArray(a) ? a : []);
  const right = new Set(Array.isArray(b) ? b : []);
  return left.size === right.size && [...left].every((value) => right.has(value));
};

function add(
  errors: EvaluationError[],
  severity: ErrorSeverity,
  family: PersonAFamily,
  code: string,
  message: string,
  extractedId?: string,
  goldenId?: string,
): void {
  errors.push({
    severity,
    family,
    code,
    message,
    ...(extractedId ? { extracted_id: extractedId } : {}),
    ...(goldenId ? { golden_id: goldenId } : {}),
  });
}

function transferDirection(item: JsonObject): string {
  const transfer = item.transfers?.[0];
  return transfer ? `${transfer.from_party_id}->${transfer.to_party_id}` : 'none';
}

function sourceCoverage(item: JsonObject): number {
  const spans = Array.isArray(item.source_spans) ? item.source_spans : [];
  return spans.length;
}

function comparePair(
  family: PersonAFamily,
  extracted: JsonObject,
  golden: JsonObject,
  extractedId: string,
  goldenId: string,
  errors: EvaluationError[],
  aliases: PersonASemanticAliases,
  contractVersion: PersonAAlignmentOptions['contractVersion'],
): void {
  const similarity = (left: unknown, right: unknown): number =>
    semanticSimilarity(left, right, aliases);
  switch (family) {
    case 'claims':
      if (extracted.claim_type !== golden.claim_type)
        add(errors, 'major', family, 'claim_type', 'Claim type differs.', extractedId, goldenId);
      if (similarity(extracted.claim_text, golden.claim_text) < 0.55)
        add(
          errors,
          'major',
          family,
          'claim_meaning_distorted',
          'Aligned claim meaning differs materially.',
          extractedId,
          goldenId,
        );
      if (extracted.against_asserting_party_interest !== golden.against_asserting_party_interest)
        add(
          errors,
          'major',
          family,
          'against_interest_flag',
          'Against-interest admission flag differs.',
          extractedId,
          goldenId,
        );
      if (extracted.materiality !== golden.materiality)
        add(
          errors,
          'minor',
          family,
          'materiality',
          'Claim materiality differs.',
          extractedId,
          goldenId,
        );
      if (sourceCoverage(extracted) === 0 && sourceCoverage(golden) > 0)
        add(
          errors,
          'major',
          family,
          'source_trace_missing',
          'Claim lost its narrative source trace.',
          extractedId,
          goldenId,
        );
      break;
    case 'timeline': {
      const extractedDate = extracted.date ?? {};
      const goldenDate = golden.date ?? {};
      if (goldenDate.approximate && !extractedDate.approximate)
        add(
          errors,
          'major',
          family,
          'approximate_date_flattened',
          'Approximate date was flattened into an exact date.',
          extractedId,
          goldenId,
        );
      if (extractedDate.start !== goldenDate.start || extractedDate.end !== goldenDate.end)
        add(
          errors,
          'major',
          family,
          'date_range',
          'Timeline date or range differs.',
          extractedId,
          goldenId,
        );
      if (
        extracted.actor_party_id !== golden.actor_party_id ||
        extracted.actor_third_party_id !== golden.actor_third_party_id
      ) {
        const extractedHasActor =
          extracted.actor_party_id != null || extracted.actor_third_party_id != null;
        const goldenHasActor = golden.actor_party_id != null || golden.actor_third_party_id != null;
        if (extractedHasActor && goldenHasActor)
          add(
            errors,
            'critical',
            family,
            'actor_reversed',
            'Timeline actor is attributed to the wrong party.',
            extractedId,
            goldenId,
          );
        else
          add(
            errors,
            'major',
            family,
            'actor_specificity',
            'Timeline actor specificity differs from golden (one side has no attributed actor).',
            extractedId,
            goldenId,
          );
      }
      if (similarity(extracted.event_summary, golden.event_summary) < 0.5)
        add(
          errors,
          'major',
          family,
          'event_meaning',
          'Timeline event meaning differs materially.',
          extractedId,
          goldenId,
        );
      break;
    }
    case 'evidence':
      if (extracted.submitted_by_party_id !== golden.submitted_by_party_id)
        add(
          errors,
          'critical',
          family,
          'submitter_reversed',
          'Evidence submitter differs.',
          extractedId,
          goldenId,
        );
      if (!['described_only', 'unavailable'].includes(extracted.availability_status))
        add(
          errors,
          'critical',
          family,
          'fabricated_inspection',
          'Narrative-only evidence was treated as uploaded or inspected.',
          extractedId,
          goldenId,
        );
      if (
        contractVersion === 'locked_acceptance_v1'
          ? extracted.evidence_type !== golden.evidence_type
          : !evidenceTypesCompatible(extracted.evidence_type, golden.evidence_type)
      )
        add(
          errors,
          'major',
          family,
          'evidence_type',
          'Evidence types belong to incompatible categories.',
          extractedId,
          goldenId,
        );
      const identityCorrespondence = evidenceIdentityCorrespondence(extracted, golden, aliases);
      const compatibleRepresentationSupport =
        contractVersion !== 'locked_acceptance_v1' &&
        extracted.evidence_type !== golden.evidence_type &&
        evidenceTypesCompatible(extracted.evidence_type, golden.evidence_type) &&
        identityCorrespondence.matches;
      if (similarity(extracted.title, golden.title) < 0.45 && !compatibleRepresentationSupport)
        add(
          errors,
          'major',
          family,
          'evidence_identity',
          'Evidence identity differs materially.',
          extractedId,
          goldenId,
        );
      break;
    case 'agreement_terms':
      if (similarity(extracted.wording, golden.wording) < 0.5)
        add(
          errors,
          'major',
          family,
          'term_wording',
          'Agreement-term wording differs materially.',
          extractedId,
          goldenId,
        );
      if (similarity(extracted.person_a_interpretation, golden.person_a_interpretation) < 0.45)
        add(
          errors,
          'major',
          family,
          'party_interpretation',
          'Person A interpretation was lost or distorted.',
          extractedId,
          goldenId,
        );
      break;
    case 'deliverables':
      if (extracted.scope_status !== golden.scope_status)
        add(
          errors,
          'major',
          family,
          'scope_status',
          'Deliverable scope status differs.',
          extractedId,
          goldenId,
        );
      if (extracted.completion_status_person_a !== golden.completion_status_person_a)
        add(
          errors,
          'major',
          family,
          'completion_status',
          'Person A completion position differs.',
          extractedId,
          goldenId,
        );
      if (similarity(extracted.name, golden.name) < 0.45)
        add(
          errors,
          'major',
          family,
          'deliverable_identity',
          'Deliverable identity differs.',
          extractedId,
          goldenId,
        );
      break;
    case 'damages':
      if (extracted.amount_min !== golden.amount_min || extracted.amount_max !== golden.amount_max)
        add(
          errors,
          'major',
          family,
          'damages_amount',
          'Damages amount or range differs.',
          extractedId,
          goldenId,
        );
      if (similarity(extracted.causal_theory, golden.causal_theory) < 0.45)
        add(
          errors,
          'major',
          family,
          'causal_theory',
          'Damages causal theory differs.',
          extractedId,
          goldenId,
        );
      break;
    case 'outcomes':
      if (
        contractVersion === 'calibrated_live_v2' &&
        extracted.outcome_type !== golden.outcome_type
      )
        add(
          errors,
          'major',
          family,
          'outcome_type',
          'Requested-outcome type differs.',
          extractedId,
          goldenId,
        );
      if (transferDirection(extracted) !== transferDirection(golden))
        add(
          errors,
          'critical',
          family,
          'transfer_direction',
          'Requested transfer direction is reversed.',
          extractedId,
          goldenId,
        );
      if (extracted.transfers?.[0]?.amount !== golden.transfers?.[0]?.amount)
        add(
          errors,
          'critical',
          family,
          'outcome_amount',
          'Requested transfer amount differs.',
          extractedId,
          goldenId,
        );
      if (extracted.priority !== golden.priority)
        add(
          errors,
          'major',
          family,
          'outcome_priority',
          'Requested-outcome priority differs.',
          extractedId,
          goldenId,
        );
      break;
    case 'third_parties':
      if (similarity(extracted.role, golden.role) < 0.4)
        add(
          errors,
          'major',
          family,
          'third_party_role',
          'Third-party role differs.',
          extractedId,
          goldenId,
        );
      break;
    case 'extraction_issues':
      if (extracted.issue_type !== golden.issue_type)
        add(
          errors,
          'major',
          family,
          'issue_type',
          'Extraction-issue type differs.',
          extractedId,
          goldenId,
        );
      if (extracted.severity !== golden.severity)
        add(
          errors,
          'minor',
          family,
          'issue_severity',
          'Extraction-issue severity differs.',
          extractedId,
          goldenId,
        );
      break;
    case 'clarification_questions':
      if (similarity(extracted.question, golden.question) < 0.45)
        add(
          errors,
          'major',
          family,
          'question_materiality',
          'Clarification question does not cover the same material gap.',
          extractedId,
          goldenId,
        );
      break;
  }
}

function missingSeverity(family: PersonAFamily, item: JsonObject): ErrorSeverity {
  if (family === 'claims' && item.materiality === 'high') return 'critical';
  if (family === 'outcomes') return 'critical';
  if (['agreement_terms', 'timeline', 'evidence', 'deliverables', 'damages'].includes(family))
    return 'major';
  return 'minor';
}

function extraSeverity(family: PersonAFamily, item: JsonObject): ErrorSeverity {
  if (family === 'claims' && item.materiality === 'high') return 'critical';
  if (family === 'outcomes') return 'critical';
  if (['evidence', 'damages'].includes(family)) return 'major';
  return 'minor';
}

export function evaluatePersonAForCase(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
  options: PersonAAlignmentOptions,
): PersonAEvaluationReport {
  requirePersonAEvaluationContractVersion(options.contractVersion);
  const errors: EvaluationError[] = [];
  const metrics = {} as Record<PersonAFamily, FamilyMetrics>;
  let goldenObjectTotal = 0;
  const editedGoldenObjects = new Set<string>();

  for (const [family, familyAlignment] of Object.entries(alignment.families) as Array<
    [PersonAFamily, PersonAAlignment['families'][PersonAFamily]]
  >) {
    const extractedItems = familyItems(extracted, family);
    const goldenItems = familyItems(golden, family);
    goldenObjectTotal += goldenItems.length;
    metrics[family] = {
      matched: familyAlignment.pairs.length,
      golden_total: goldenItems.length,
      extracted_total: extractedItems.length,
      recall: goldenItems.length === 0 ? 1 : familyAlignment.pairs.length / goldenItems.length,
      precision:
        extractedItems.length === 0
          ? goldenItems.length === 0
            ? 1
            : 0
          : familyAlignment.pairs.length / extractedItems.length,
    };

    for (const pair of familyAlignment.pairs) {
      const before = errors.length;
      comparePair(
        family,
        extractedItems[pair.extracted_index] ?? {},
        goldenItems[pair.golden_index] ?? {},
        pair.extracted_id,
        pair.golden_id,
        errors,
        options.aliases ?? {},
        options.contractVersion,
      );
      if (errors.slice(before).some((error) => error.severity !== 'minor')) {
        editedGoldenObjects.add(`${family}:${pair.golden_id}`);
      }
    }
    for (const ambiguous of familyAlignment.ambiguous) {
      add(
        errors,
        'major',
        family,
        'ambiguous_alignment',
        'Semantic alignment was ambiguous and requires human review.',
        ambiguous.extracted_id,
      );
    }
    for (const missing of familyAlignment.unmatched_golden) {
      const item = goldenItems[missing.index] ?? {};
      const severity = missingSeverity(family, item);
      add(
        errors,
        severity,
        family,
        'missing_golden_object',
        'Golden object was not extracted.',
        undefined,
        missing.id,
      );
      if (severity !== 'minor') editedGoldenObjects.add(`${family}:${missing.id}`);
    }
    for (const extra of familyAlignment.unmatched_extracted) {
      const item = extractedItems[extra.index] ?? {};
      add(
        errors,
        extraSeverity(family, item),
        family,
        'unmatched_extracted_object',
        'Extracted object has no golden semantic match and may be hallucinated or over-segmented.',
        extra.id,
      );
    }
  }

  const critical = errors.filter((error) => error.severity === 'critical').length;
  const major = errors.filter((error) => error.severity === 'major').length;
  const minor = errors.filter((error) => error.severity === 'minor').length;
  const weighted = critical + major * 0.5 + minor * 0.1;

  return {
    version: 'person-a-evaluation-v0.1.0',
    schema_version: '0.1.2',
    summary: {
      critical,
      major,
      minor,
      human_edit_rate: goldenObjectTotal === 0 ? 0 : editedGoldenObjects.size / goldenObjectTotal,
      weighted_error_rate: goldenObjectTotal === 0 ? 0 : weighted / goldenObjectTotal,
    },
    metrics,
    errors,
  };
}

export function evaluatePersonA(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
): PersonAEvaluationReport {
  return evaluatePersonAForCase(extracted, golden, alignment, {
    aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
    contractVersion: 'calibrated_live_v2',
  });
}

export function reportMarkdown(report: PersonAEvaluationReport): string {
  const lines = [
    '# JuryAI Person A Extraction Report',
    '',
    `- Critical: **${report.summary.critical}**`,
    `- Major: **${report.summary.major}**`,
    `- Minor: **${report.summary.minor}**`,
    `- Human edit rate: **${(report.summary.human_edit_rate * 100).toFixed(1)}%**`,
    `- Weighted error rate: **${(report.summary.weighted_error_rate * 100).toFixed(1)}%**`,
    '',
    '## Family metrics',
    '',
    '| Family | Matched | Golden | Extracted | Recall | Precision |',
    '|---|---:|---:|---:|---:|---:|',
  ];
  for (const [family, metric] of Object.entries(report.metrics)) {
    lines.push(
      `| ${family} | ${metric.matched} | ${metric.golden_total} | ${metric.extracted_total} | ${(metric.recall * 100).toFixed(1)}% | ${(metric.precision * 100).toFixed(1)}% |`,
    );
  }
  if (report.evidence_recall) {
    const evidence = report.evidence_recall;
    lines.push(
      '',
      '## Evidence recall observability',
      '',
      `- Basis: **${evidence.observability_basis}**`,
      `- Total golden evidence: **${evidence.total_golden_evidence}**`,
      `- Observable golden evidence: **${evidence.observable_golden_evidence}**`,
      `- Unobservable golden evidence: **${evidence.unobservable_golden_evidence}**`,
      `- Matched observable evidence: **${evidence.matched_observable_evidence}**`,
      `- Observable recall: **${evidence.observable_recall === null ? 'not available' : `${(evidence.observable_recall * 100).toFixed(1)}%`}**`,
      `- Full-golden diagnostic: **${evidence.full_golden_matched_evidence}/${evidence.total_golden_evidence} (${(evidence.full_golden_recall * 100).toFixed(1)}%)**`,
    );
    if (evidence.excluded_from_extractor_recall.length > 0) {
      lines.push(
        '',
        ...evidence.excluded_from_extractor_recall.map(
          (entry) => `- \`${entry.golden_id}\`: ${entry.reason}`,
        ),
      );
    }
    if (evidence.matched_unobservable_evidence.length > 0) {
      lines.push(
        '',
        '### Valid full-golden matches excluded from observable recall',
        '',
        ...evidence.matched_unobservable_evidence.map(
          (entry) => `- \`${entry.extracted_id}\` → \`${entry.golden_id}\`: ${entry.reason}`,
        ),
      );
    }
    if (evidence.representation_differences.length > 0) {
      lines.push(
        '',
        '### Informational evidence-representation differences',
        '',
        ...evidence.representation_differences.map(
          (entry) =>
            `- \`${entry.extracted_id}\` (${entry.extracted_type}) → \`${entry.golden_id}\` (${entry.golden_type}): ${entry.reason}`,
        ),
      );
    }
  }
  lines.push('', '## Classified differences', '');
  if (report.errors.length === 0) lines.push('No classified differences.');
  else
    report.errors.forEach((error) =>
      lines.push(
        `- **${error.severity.toUpperCase()}** \`${error.family}/${error.code}\`: ${error.message}`,
      ),
    );
  return `${lines.join('\n')}\n`;
}
