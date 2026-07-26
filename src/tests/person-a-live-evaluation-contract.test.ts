import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRY_RUN_001_COMPATIBILITY_ALIASES,
  alignPersonAForCase,
  evidenceTypesCompatible,
  sourceSpanOverlap,
} from '../alignment/person-a-alignment-corrected.js';
import { evaluatePersonAForCase } from '../evaluation/person-a-diff-corrected.js';
import {
  diagnosePersonASourceSpans,
  parsePersonAModelOutputFromRawResponse,
} from '../evaluation/person-a-span-diagnostics.js';
import { assemblePersonAExtraction } from '../extraction/person-a-extractor.js';
import { clone } from './person-a-test-helpers.js';

type JsonObject = Record<string, any>;

const root = process.cwd();

async function json(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(resolve(root, path), 'utf8')) as JsonObject;
}

async function frozenRun() {
  const [narrative, extraction, golden, rawResponse] = await Promise.all([
    readFile(resolve(root, 'src/fixtures/dry_run_001.person_a.txt'), 'utf8'),
    json('docs/dry-run-001/extraction.json'),
    json('docs/dry-run-001/golden-projection.json'),
    json('docs/dry-run-001/raw-response.json'),
  ]);
  const alignment = alignPersonAForCase(extraction, golden, {
    aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
  });
  const report = evaluatePersonAForCase(extraction, golden, alignment, {
    aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
    narrative,
  });
  return { narrative, extraction, golden, rawResponse, alignment, report };
}

function emptyRecordWithEvidence(evidence: JsonObject[]): JsonObject {
  return { evidence };
}

describe('Dry Run 001 frozen live-evaluation contract', () => {
  it('classifies all seven grounded Rule 23 components without fabrication criticals', async () => {
    const { extraction, golden, report } = await frozenRun();
    const decompositions = report.errors.filter(
      (error) => error.code === 'agreement_term_decomposition',
    );
    expect(decompositions).toHaveLength(7);
    expect(decompositions.every((error) => error.severity === 'minor')).toBe(true);
    expect(
      report.errors.filter(
        (error) => error.family === 'agreement_terms' && error.code === 'unsupported_extra_object',
      ),
    ).toEqual([]);

    const extractedTerms = extraction.agreement.terms as JsonObject[];
    const goldenScope = (golden.agreement.terms as JsonObject[]).find(
      (term) => term.term_id === 'term_scope',
    )!;
    for (const id of [
      'term_01_homepage',
      'term_02_about_page',
      'term_03_services_page',
      'term_04_contact_page',
    ]) {
      const component = extractedTerms.find((term) => term.term_id === id)!;
      expect(sourceSpanOverlap(component, goldenScope)).toBe(1);
    }
  });

  it('uses the agreement-term grounded-surplus tier without excusing invention', async () => {
    const { extraction, golden, narrative } = await frozenRun();
    const grounded = clone(extraction) as JsonObject;
    const groundedTerm = (grounded.agreement.terms as JsonObject[]).find(
      (term) => term.term_id === 'term_12_pricing_section',
    )!;
    groundedTerm.term_type = 'other';
    const groundedAlignment = alignPersonAForCase(grounded, golden, {
      aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
    });
    const groundedReport = evaluatePersonAForCase(grounded, golden, groundedAlignment, {
      aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
      narrative,
    });
    expect(
      groundedReport.errors.find(
        (error) =>
          error.extracted_id === groundedTerm.term_id &&
          error.code === 'source_grounded_extra_object',
      ),
    ).toMatchObject({ severity: 'major' });

    const invented = clone(extraction) as JsonObject;
    const inventedTerm = (invented.agreement.terms as JsonObject[]).find(
      (term) => term.term_id === 'term_12_pricing_section',
    )!;
    inventedTerm.term_type = 'other';
    inventedTerm.wording = 'Maya accepted a criminal penalty clause.';
    inventedTerm.person_a_interpretation = 'Alex says the clause guarantees punitive damages.';
    const inventedAlignment = alignPersonAForCase(invented, golden, {
      aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
    });
    const inventedReport = evaluatePersonAForCase(invented, golden, inventedAlignment, {
      aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
      narrative,
    });
    expect(
      inventedReport.errors.find(
        (error) =>
          error.extracted_id === inventedTerm.term_id && error.code === 'unsupported_extra_object',
      ),
    ).toMatchObject({ severity: 'critical' });
  });

  it('scores observable evidence recall separately from the full golden diagnostic', async () => {
    const { report } = await frozenRun();
    expect(report.metrics.evidence).toMatchObject({
      matched: 3,
      golden_total: 3,
      extracted_total: 7,
      recall: 1,
    });
    expect(report.evidence_recall).toMatchObject({
      observability_basis: 'person_a_narrative',
      total_golden_evidence: 9,
      observable_golden_evidence: 3,
      unobservable_golden_evidence: 6,
      matched_observable_evidence: 3,
      observable_recall: 1,
      full_golden_matched_evidence: 4,
      full_golden_recall: 4 / 9,
    });
    expect(
      report.evidence_recall?.excluded_from_extractor_recall.map((item) => item.golden_id),
    ).toEqual(['ev_002', 'ev_003', 'ev_004', 'ev_006', 'ev_008', 'ev_009']);
    expect(
      report.evidence_recall?.excluded_from_extractor_recall.every((item) =>
        item.reason.includes('Person A narrative'),
      ),
    ).toBe(true);
  });

  it('normalizes only supported message representations before alignment', async () => {
    const { extraction, golden, alignment } = await frozenRun();
    expect(evidenceTypesCompatible('message_export', 'message_history')).toBe(true);
    expect(evidenceTypesCompatible('message_history', 'message_screenshot')).toBe(true);
    expect(evidenceTypesCompatible('message_history', 'contract')).toBe(false);
    expect(alignment.families.evidence.pairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          extracted_id: 'ev_02_whatsapp_requests',
          golden_id: 'ev_003',
        }),
        expect.objectContaining({
          extracted_id: 'ev_05_feedback_message',
          golden_id: 'ev_005',
        }),
      ]),
    );

    const unrelatedMessage = {
      ...clone(
        extraction.evidence.find(
          (item: JsonObject) => item.evidence_id === 'ev_05_feedback_message',
        ),
      ),
      title: 'Unrelated payroll chat',
      description_from_submitter: 'A conversation about staff scheduling and payroll.',
      extracts: [],
      provenance: { source_system: 'Slack' },
    };
    const targetMessage = clone(
      golden.evidence.find((item: JsonObject) => item.evidence_id === 'ev_005'),
    );
    const superficial = alignPersonAForCase(
      emptyRecordWithEvidence([unrelatedMessage]),
      emptyRecordWithEvidence([targetMessage]),
    );
    expect(superficial.families.evidence.pairs).toEqual([]);

    const incompatible = clone(unrelatedMessage);
    incompatible.evidence_type = 'contract';
    incompatible.title = targetMessage.title;
    incompatible.description_from_submitter = targetMessage.description_from_submitter;
    incompatible.extracts = clone(targetMessage.extracts);
    const blocked = alignPersonAForCase(
      emptyRecordWithEvidence([incompatible]),
      emptyRecordWithEvidence([targetMessage]),
    );
    expect(blocked.families.evidence.pairs).toEqual([]);
  });

  it('reproduces raw, repaired, and final span validity from frozen artifacts', async () => {
    const { narrative, extraction, rawResponse } = await frozenRun();
    const modelOutput = parsePersonAModelOutputFromRawResponse(rawResponse);
    const diagnostics = diagnosePersonASourceSpans({
      modelOutput,
      narrative,
      assembledExtraction: extraction,
    });
    expect(diagnostics.raw_model).toEqual({
      total_spans: 58,
      exact_spans: 48,
      failing_spans: 10,
      exact_accuracy: 48 / 58,
    });
    expect(diagnostics.assembler).toMatchObject({
      repaired_spans: 10,
      ambiguous_quote_spans: 0,
      missing_quote_spans: 0,
    });
    expect(diagnostics.assembled).toEqual({
      available: true,
      total_spans: 58,
      exact_spans: 58,
      failing_spans: 0,
      exact_accuracy: 1,
    });
    expect(diagnostics.final_invariants).toEqual({
      evaluated: true,
      schema_valid: true,
      invariants_valid: true,
      exact_source_slice_valid: true,
    });
  });

  it('characterizes repeated identical quote ambiguity without changing the assembler', async () => {
    const { narrative, rawResponse } = await frozenRun();
    const modelOutput = parsePersonAModelOutputFromRawResponse(rawResponse);
    const repeated = clone(modelOutput) as JsonObject;
    const span = repeated.claims[0].source_spans[0];
    const repeatedNarrative = `${narrative}\n${span.quote}`;
    span.start_char = 0;
    span.end_char = span.quote.length;
    const diagnostics = diagnosePersonASourceSpans({
      modelOutput: repeated,
      narrative: repeatedNarrative,
    });
    expect(
      diagnostics.spans.find((item) => item.path === '$.claims[0].source_spans[0]'),
    ).toMatchObject({
      raw_exact: false,
      quote_occurrences: 2,
      offsets_repaired: false,
      status: 'ambiguous_quote_not_repaired',
    });
    expect(() =>
      assemblePersonAExtraction(repeated, {
        narrative: repeatedNarrative,
        submittedAt: '2026-07-25T00:00:00Z',
        model: 'gpt-5.6-sol',
        generatedAt: '2026-07-25T00:00:00Z',
      }),
    ).toThrow(/Source span does not match/iu);
  });

  it('keeps genuine completion, scope, and cl_a_003 defects visible', async () => {
    const { report } = await frozenRun();
    for (const id of ['del_02_about', 'del_03_services', 'del_04_contact']) {
      expect(
        report.errors.find(
          (error) =>
            error.extracted_id === id &&
            error.code === 'completion_status' &&
            error.severity === 'major',
        ),
      ).toBeTruthy();
    }
    expect(
      report.errors.find(
        (error) =>
          error.extracted_id === 'del_06_pricing' &&
          error.code === 'scope_status' &&
          error.severity === 'major',
      ),
    ).toBeTruthy();
    expect(
      report.errors.find(
        (error) =>
          error.golden_id === 'cl_a_003' &&
          error.code === 'missing_golden_object' &&
          error.severity === 'critical',
      ),
    ).toBeTruthy();
    expect(report.summary).toMatchObject({ critical: 1, major: 44, minor: 20 });
  });
});
