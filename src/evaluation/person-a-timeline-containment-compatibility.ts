import {
  alignDryRun001TimelineContainmentProjection,
  proveExactSourceTimelineContainment,
  type TimelineContainmentAlignment,
  type TimelineContainmentAuditEntry,
} from '../alignment/person-a-timeline-containment-compatibility.js';
import {
  alignPersonAForCase as alignPriorProjection,
  familyItems,
  requirePersonAEvaluationContractVersion,
  type PersonAAlignmentOptions,
  type PersonAFamily,
} from '../alignment/person-a-alignment-corrected.js';
import {
  evaluatePersonAForCase as evaluatePriorProjection,
  type PersonAEvaluationReport,
} from './person-a-diff-corrected.js';

type JsonObject = Record<string, any>;

export type TimelineContainmentEvaluationProjection = {
  version: 'dry-run-001-timeline-containment-evaluation-v1';
  prior_alignment: ReturnType<typeof alignPriorProjection>;
  prior_report: PersonAEvaluationReport;
  alignment: TimelineContainmentAlignment;
  report: PersonAEvaluationReport;
  audit: {
    transformation: TimelineContainmentAuditEntry;
    removed_findings: [
      {
        severity: 'major';
        family: 'timeline';
        code: 'missing_golden_object';
        golden_id: string;
      },
      {
        severity: 'major';
        family: 'timeline';
        code: 'source_grounded_extra_object';
        extracted_id: string;
      },
    ];
    added_findings: [];
  };
};

function errorKey(error: JsonObject): string {
  return JSON.stringify(error);
}

function sortedErrorKeys(errors: JsonObject[]): string[] {
  return errors.map(errorKey).sort();
}

function recalculateSummary(
  report: PersonAEvaluationReport,
  golden: JsonObject,
  alignment: TimelineContainmentAlignment,
): void {
  const editedObjects = new Set<string>();
  let goldenTotal = 0;
  for (const [family, familyAlignment] of Object.entries(alignment.families) as Array<
    [PersonAFamily, TimelineContainmentAlignment['families'][PersonAFamily]]
  >) {
    goldenTotal += familyItems(golden, family).length;
    for (const ambiguous of familyAlignment.ambiguous) {
      editedObjects.add(`${family}:ambiguous:${ambiguous.extracted_id}`);
    }
  }
  for (const error of report.errors) {
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
}

/**
 * Evaluate the explicit PR #17 alignment projection while preserving the
 * unchanged PR #16 report alongside it. The wrapper independently re-proves
 * the audited containment and fails if any finding beyond the selected
 * missing/extra pair would change.
 */
export function evaluateDryRun001TimelineContainmentProjection(
  extracted: JsonObject,
  golden: JsonObject,
  options: PersonAAlignmentOptions,
): TimelineContainmentEvaluationProjection {
  requirePersonAEvaluationContractVersion(options.contractVersion);
  if (options.contractVersion !== 'calibrated_live_v2') {
    throw new Error('Dry Run 001 timeline containment requires calibrated_live_v2.');
  }
  if (typeof options.narrative !== 'string' || options.narrative.length === 0) {
    throw new Error('Dry Run 001 timeline containment requires the exact narrative.');
  }

  const priorAlignment = alignPriorProjection(extracted, golden, options);
  const priorReport = evaluatePriorProjection(extracted, golden, priorAlignment, options);
  const alignment = alignDryRun001TimelineContainmentProjection(extracted, golden, options);
  const transformation = alignment.compatibility_audit.entries[0];
  const pair = alignment.families.timeline.pairs.find(
    (candidate) =>
      candidate.extracted_id === transformation.extracted_id &&
      candidate.golden_id === transformation.golden_id &&
      (candidate as typeof candidate & { recovery_reason?: string }).recovery_reason ===
        'exact_source_containment',
  );
  if (pair === undefined) {
    throw new Error('Dry Run 001 timeline containment audit does not identify its recovered pair.');
  }

  const extractedEvent = familyItems(extracted, 'timeline')[pair.extracted_index] ?? {};
  const goldenEvent = familyItems(golden, 'timeline')[pair.golden_index] ?? {};
  if (
    proveExactSourceTimelineContainment(
      extractedEvent,
      goldenEvent,
      options.narrative,
      options.aliases,
    ) === null
  ) {
    throw new Error('Dry Run 001 timeline containment audit failed independent verification.');
  }

  const missing = priorReport.errors.filter(
    (error) =>
      error.severity === 'major' &&
      error.family === 'timeline' &&
      error.code === 'missing_golden_object' &&
      error.golden_id === transformation.golden_id,
  );
  const extra = priorReport.errors.filter(
    (error) =>
      error.severity === 'major' &&
      error.family === 'timeline' &&
      error.code === 'source_grounded_extra_object' &&
      error.extracted_id === transformation.extracted_id,
  );
  if (missing.length !== 1 || extra.length !== 1) {
    throw new Error(
      'Dry Run 001 timeline containment requires exactly one prior missing and grounded-extra finding.',
    );
  }

  const report = evaluatePriorProjection(extracted, golden, alignment, options);
  const containmentMeaningErrors = report.errors.filter(
    (error) =>
      error.family === 'timeline' &&
      error.code === 'event_meaning' &&
      error.extracted_id === transformation.extracted_id &&
      error.golden_id === transformation.golden_id,
  );
  if (containmentMeaningErrors.length !== 1) {
    throw new Error(
      'Dry Run 001 timeline containment expected exactly one lexical event-meaning diagnostic.',
    );
  }
  report.errors = report.errors.filter((error) => error !== containmentMeaningErrors[0]);
  recalculateSummary(report, golden, alignment);

  const expectedErrors = priorReport.errors.filter(
    (error) => error !== missing[0] && error !== extra[0],
  );
  if (
    JSON.stringify(sortedErrorKeys(report.errors)) !==
    JSON.stringify(sortedErrorKeys(expectedErrors))
  ) {
    throw new Error(
      'Dry Run 001 timeline containment would change findings outside the selected pair.',
    );
  }

  return {
    version: 'dry-run-001-timeline-containment-evaluation-v1',
    prior_alignment: priorAlignment,
    prior_report: priorReport,
    alignment,
    report,
    audit: {
      transformation,
      removed_findings: [
        {
          severity: 'major',
          family: 'timeline',
          code: 'missing_golden_object',
          golden_id: transformation.golden_id,
        },
        {
          severity: 'major',
          family: 'timeline',
          code: 'source_grounded_extra_object',
          extracted_id: transformation.extracted_id,
        },
      ],
      added_findings: [],
    },
  };
}
