import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRY_RUN_001_COMPATIBILITY_ALIASES,
  alignPersonAForCase,
  evidenceIdentityCorrespondence,
  evidenceTypesCompatible,
  semanticSimilarity,
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
    contractVersion: 'calibrated_live_v2',
  });
  const report = evaluatePersonAForCase(extraction, golden, alignment, {
    aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
    narrative,
    contractVersion: 'calibrated_live_v2',
  });
  return { narrative, extraction, golden, rawResponse, alignment, report };
}

function emptyRecordWithEvidence(evidence: JsonObject[]): JsonObject {
  return { evidence };
}

function exactSpan(narrative: string, quote = narrative): JsonObject {
  const start = narrative.indexOf(quote);
  if (start < 0) throw new Error('Test quote must occur in its narrative.');
  return {
    start_char: start,
    end_char: start + quote.length,
    quote,
  };
}

function agreementSurplusReport(
  term: JsonObject,
  narrative: string,
): ReturnType<typeof evaluatePersonAForCase> {
  const candidate = { agreement: { terms: [term] } };
  const golden = { agreement: { terms: [] } };
  const alignment = alignPersonAForCase(candidate, golden, calibratedAlignmentOptions);
  return evaluatePersonAForCase(candidate, golden, alignment, {
    ...calibratedAlignmentOptions,
    narrative,
  });
}

function expectAgreementSurplus(
  term: JsonObject,
  narrative: string,
  expected: { code: string; severity: string },
): void {
  const report = agreementSurplusReport(term, narrative);
  expect(report.errors.find((error) => error.extracted_id === term.term_id)).toMatchObject(
    expected,
  );
}

const calibratedAlignmentOptions = {
  aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
  contractVersion: 'calibrated_live_v2' as const,
};

describe('Dry Run 001 frozen live-evaluation contract', () => {
  it('rejects omitted contract-version selection at runtime', async () => {
    const { extraction, golden, alignment } = await frozenRun();
    expect(() =>
      alignPersonAForCase(extraction, golden, {} as typeof calibratedAlignmentOptions),
    ).toThrow(/explicit contractVersion/u);
    expect(() =>
      evaluatePersonAForCase(
        extraction,
        golden,
        alignment,
        {} as typeof calibratedAlignmentOptions,
      ),
    ).toThrow(/explicit contractVersion/u);
  });

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

  it('keeps span- and token-piggybacked agreement inventions critical', async () => {
    const { extraction, golden, narrative } = await frozenRun();
    const probes = [
      {
        id: 'term_02_about_page',
        wording: 'The homepage carries a $500 per day penalty clause.',
        interpretation: 'Maya owes Alex $500 for every day of delay.',
      },
      {
        id: 'term_13_newsletter_signup',
        wording: 'The newsletter clause requires Maya to indemnify Alex.',
        interpretation: 'Maya accepted unlimited indemnification liability.',
      },
      {
        id: 'term_02_about_page',
        wording: 'Maya waived all delay claims.',
        interpretation: 'Maya permanently surrendered every remedy for delay.',
        spansFrom: 'term_06_revision_limit',
      },
      {
        id: 'term_02_about_page',
        wording: 'All disputes require binding arbitration in Singapore.',
        interpretation: 'Maya waived court proceedings.',
      },
    ];

    for (const probe of probes) {
      const candidate = clone(extraction) as JsonObject;
      const term = (candidate.agreement.terms as JsonObject[]).find(
        (item) => item.term_id === probe.id,
      )!;
      term.wording = probe.wording;
      term.person_a_interpretation = probe.interpretation;
      if (probe.spansFrom) {
        term.source_spans = clone(
          (candidate.agreement.terms as JsonObject[]).find(
            (item) => item.term_id === probe.spansFrom,
          )!.source_spans,
        );
      }
      const alignment = alignPersonAForCase(candidate, golden, calibratedAlignmentOptions);
      const report = evaluatePersonAForCase(candidate, golden, alignment, {
        ...calibratedAlignmentOptions,
        narrative,
      });
      expect(
        report.errors.find(
          (error) => error.extracted_id === probe.id && error.code === 'unsupported_extra_object',
        ),
        probe.wording,
      ).toMatchObject({ severity: 'critical' });
    }
  });

  it('requires assertion and category support for agreement-term surplus', async () => {
    const { extraction, narrative } = await frozenRun();
    const source = clone(
      (extraction.agreement.terms as JsonObject[]).find(
        (term) => term.term_id === 'term_13_newsletter_signup',
      ),
    );
    const cases = [
      {
        label: 'supported',
        termType: 'scope',
        wording: 'Maya later requested a newsletter signup.',
        interpretation: null,
        expectedCode: 'source_grounded_extra_object',
        expectedSeverity: 'major',
      },
      {
        label: 'mislabeled',
        termType: 'deadline',
        wording: 'Maya later requested a newsletter signup.',
        interpretation: null,
        expectedCode: 'unsupported_extra_object',
        expectedSeverity: 'critical',
      },
      {
        label: 'stronger',
        termType: 'scope',
        wording: 'The newsletter signup carried a $500 daily penalty.',
        interpretation: 'Maya owed Alex a penalty for every day of delay.',
        expectedCode: 'unsupported_extra_object',
        expectedSeverity: 'critical',
      },
      {
        label: 'unsupported',
        termType: 'scope',
        wording: 'The parties agreed to binding arbitration.',
        interpretation: null,
        expectedCode: 'unsupported_extra_object',
        expectedSeverity: 'critical',
      },
    ];

    for (const probe of cases) {
      const term = {
        ...clone(source),
        term_id: `surplus_${probe.label}`,
        term_type: probe.termType,
        wording: probe.wording,
        person_a_interpretation: probe.interpretation,
      };
      const candidate = { agreement: { terms: [term] } };
      const golden = { agreement: { terms: [] } };
      const alignment = alignPersonAForCase(candidate, golden, calibratedAlignmentOptions);
      const report = evaluatePersonAForCase(candidate, golden, alignment, {
        ...calibratedAlignmentOptions,
        narrative,
      });
      expect(
        report.errors.find((error) => error.extracted_id === term.term_id),
        probe.label,
      ).toMatchObject({
        code: probe.expectedCode,
        severity: probe.expectedSeverity,
      });
    }
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
      full_golden_matched_evidence: 3,
      full_golden_recall: 3 / 9,
    });
    expect(
      report.evidence_recall?.excluded_from_extractor_recall.map((item) => item.golden_id),
    ).toEqual(['ev_002', 'ev_003', 'ev_004', 'ev_006', 'ev_008', 'ev_009']);
    expect(
      report.evidence_recall?.excluded_from_extractor_recall.every((item) =>
        item.reason.includes('Person A narrative'),
      ),
    ).toBe(true);
    expect(report.evidence_recall?.matched_unobservable_evidence).toEqual([]);
    expect(report.evidence_recall?.representation_differences).toEqual([
      expect.objectContaining({
        extracted_id: 'ev_05_feedback_message',
        golden_id: 'ev_005',
        extracted_type: 'message_history',
        golden_type: 'message_screenshot',
        basis: 'quoted_content',
      }),
    ]);
  });

  it('normalizes only supported message representations before alignment', async () => {
    const { extraction, golden, alignment } = await frozenRun();
    expect(evidenceTypesCompatible('message_export', 'message_history')).toBe(true);
    expect(evidenceTypesCompatible('message_history', 'message_screenshot')).toBe(true);
    expect(evidenceTypesCompatible('message_history', 'contract')).toBe(false);
    expect(
      alignment.families.evidence.pairs.find(
        (pair) => pair.extracted_id === 'ev_02_whatsapp_requests',
      ),
    ).toBeUndefined();
    expect(alignment.families.evidence.pairs).toContainEqual(
      expect.objectContaining({
        extracted_id: 'ev_05_feedback_message',
        golden_id: 'ev_005',
      }),
    );

    const targetExport = clone(
      golden.evidence.find((item: JsonObject) => item.evidence_id === 'ev_003'),
    );
    const carSale = {
      ...clone(
        extraction.evidence.find(
          (item: JsonObject) => item.evidence_id === 'ev_02_whatsapp_requests',
        ),
      ),
      evidence_id: 'ev_car_sale',
      title: 'WhatsApp messages about an unrelated car sale',
      description_from_submitter: 'Alex says Maya discussed selling a car over WhatsApp.',
      extracts: [],
      provenance: { source_system: 'WhatsApp', export_method: null },
    };
    const sameSystemAndPeople = {
      ...clone(carSale),
      evidence_id: 'ev_shared_people',
      title: 'WhatsApp messages between Alex and Maya',
      description_from_submitter: 'Alex and Maya discussed an unrelated personal matter.',
    };
    const sameTypeTarget = {
      ...clone(targetExport),
      evidence_type: 'message_history',
    };
    for (const unrelated of [carSale, sameSystemAndPeople]) {
      for (const target of [targetExport, sameTypeTarget]) {
        const superficial = alignPersonAForCase(
          emptyRecordWithEvidence([unrelated]),
          emptyRecordWithEvidence([target]),
          calibratedAlignmentOptions,
        );
        expect(
          superficial.families.evidence.pairs,
          `${unrelated.evidence_id}/${target.evidence_type}`,
        ).toEqual([]);
      }
    }

    const targetMessage = clone(
      golden.evidence.find((item: JsonObject) => item.evidence_id === 'ev_005'),
    );
    const incompatible = clone(carSale);
    incompatible.evidence_type = 'contract';
    incompatible.title = targetMessage.title;
    incompatible.description_from_submitter = targetMessage.description_from_submitter;
    incompatible.extracts = clone(targetMessage.extracts);
    const blocked = alignPersonAForCase(
      emptyRecordWithEvidence([incompatible]),
      emptyRecordWithEvidence([targetMessage]),
      calibratedAlignmentOptions,
    );
    expect(blocked.families.evidence.pairs).toEqual([]);
  });

  it('requires semantic similarity after quoted-content token and coverage gates', () => {
    const extractedText = 'pricing deadline chairs invoice';
    const unrelatedText = 'pricing deadline automobile title engine tires registration seller';
    const extracted = {
      evidence_id: 'ev_quote_negative',
      evidence_type: 'message_history',
      title: 'Saved project message history',
      provenance: { source_system: 'WhatsApp', export_method: 'manual export' },
      extracts: [{ text: extractedText }],
    };
    const unrelated = {
      evidence_id: 'ev_quote_unrelated',
      evidence_type: 'message_screenshot',
      title: 'Screenshot of a different record',
      provenance: { source_system: 'WhatsApp', export_method: 'screenshot' },
      extracts: [
        {
          text: unrelatedText,
        },
      ],
    };
    const corresponding = {
      ...clone(unrelated),
      evidence_id: 'ev_quote_positive',
      extracts: [{ text: 'pricing deadline chairs invoice approved' }],
    };

    const quotedSimilarity = semanticSimilarity(
      extractedText,
      unrelatedText,
      DRY_RUN_001_COMPATIBILITY_ALIASES,
    );
    expect(quotedSimilarity).toBeGreaterThan(0.3);
    expect(quotedSimilarity).toBeLessThan(0.35);
    expect(
      evidenceIdentityCorrespondence(extracted, unrelated, DRY_RUN_001_COMPATIBILITY_ALIASES),
    ).toEqual({ matches: false, basis: null, strength: 0 });
    expect(
      evidenceIdentityCorrespondence(extracted, corresponding, DRY_RUN_001_COMPATIBILITY_ALIASES),
    ).toMatchObject({ matches: true, basis: 'quoted_content' });
  });

  it('requires semantic similarity after message-artifact identity gates', () => {
    const extracted = {
      evidence_id: 'ev_artifact_negative',
      evidence_type: 'message_export',
      title: 'Project launch approval archive',
      description_from_submitter: 'Project launch approval archive.',
      provenance: { source_system: 'WhatsApp', export_method: 'native export' },
      extracts: [],
    };
    const unrelated = {
      evidence_id: 'ev_artifact_unrelated',
      evidence_type: 'message_history',
      title: 'Project launch vehicle registration seller mileage',
      description_from_submitter: 'Project launch vehicle registration seller mileage.',
      provenance: { source_system: 'WhatsApp', export_method: 'downloaded history' },
      extracts: [],
    };
    const corresponding = {
      ...clone(unrelated),
      evidence_id: 'ev_artifact_positive',
      title: 'Project launch approval archive history',
      description_from_submitter: 'Saved project launch approval archive history.',
    };

    const artifactSimilarity = semanticSimilarity(
      extracted.title,
      unrelated.title,
      DRY_RUN_001_COMPATIBILITY_ALIASES,
    );
    expect(artifactSimilarity).toBeGreaterThan(0.35);
    expect(artifactSimilarity).toBeLessThan(0.45);
    expect(
      evidenceIdentityCorrespondence(extracted, unrelated, DRY_RUN_001_COMPATIBILITY_ALIASES),
    ).toEqual({ matches: false, basis: null, strength: 0 });
    expect(
      evidenceIdentityCorrespondence(extracted, corresponding, DRY_RUN_001_COMPATIBILITY_ALIASES),
    ).toMatchObject({ matches: true, basis: 'artifact_identity' });
  });

  it('requires substantial narrative coverage for a source-grounded agreement surplus', () => {
    const narrative = 'Maya requested a newsletter signup for the website.';
    const weak = {
      term_id: 'term_coverage_negative',
      term_type: 'scope',
      wording: 'Newsletter signup imposed weekly approval.',
      person_a_interpretation: null,
      source_spans: [exactSpan(narrative)],
    };
    const supported = {
      ...clone(weak),
      term_id: 'term_coverage_positive',
      wording: 'Maya requested a newsletter signup.',
    };

    expectAgreementSurplus(weak, narrative, {
      code: 'unsupported_extra_object',
      severity: 'critical',
    });
    expectAgreementSurplus(supported, narrative, {
      code: 'source_grounded_extra_object',
      severity: 'major',
    });
  });

  it('requires at least two source-supported agreement tokens', () => {
    const narrative = 'Maya requested a newsletter signup for the website.';
    const oneSharedToken = {
      term_id: 'term_shared_token_negative',
      term_type: 'scope',
      wording: 'Newsletter obligation.',
      person_a_interpretation: null,
      source_spans: [exactSpan(narrative)],
    };

    expectAgreementSurplus(oneSharedToken, narrative, {
      code: 'unsupported_extra_object',
      severity: 'critical',
    });
  });

  it('requires every asserted material legal concept to appear in the narrative', () => {
    const narrative = 'Maya requested a newsletter signup for the website.';
    const inventedLegalConsequence = {
      term_id: 'term_legal_negative',
      term_type: 'scope',
      wording: 'Maya requested newsletter signup website indemnification.',
      person_a_interpretation: null,
      source_spans: [exactSpan(narrative)],
    };
    const supportedNarrative = `${narrative} Maya also accepted indemnification.`;

    expectAgreementSurplus(inventedLegalConsequence, narrative, {
      code: 'unsupported_extra_object',
      severity: 'critical',
    });
    expectAgreementSurplus(
      {
        ...clone(inventedLegalConsequence),
        term_id: 'term_legal_positive',
      },
      supportedNarrative,
      {
        code: 'source_grounded_extra_object',
        severity: 'major',
      },
    );
  });

  it('requires source-span offsets to identify the exact quoted narrative slice', () => {
    const narrative = 'Maya requested a newsletter signup for the website.';
    const quote = 'Maya requested a newsletter signup';
    const validSpan = exactSpan(narrative, quote);
    const invalidOffsets = {
      term_id: 'term_slice_negative',
      term_type: 'scope',
      wording: 'Maya requested a newsletter signup.',
      person_a_interpretation: null,
      source_spans: [
        {
          ...validSpan,
          start_char: validSpan.start_char + 1,
          end_char: validSpan.end_char + 1,
        },
      ],
    };

    expectAgreementSurplus(invalidOffsets, narrative, {
      code: 'unsupported_extra_object',
      severity: 'critical',
    });
    expectAgreementSurplus(
      {
        ...clone(invalidOffsets),
        term_id: 'term_slice_positive',
        source_spans: [validSpan],
      },
      narrative,
      {
        code: 'source_grounded_extra_object',
        severity: 'major',
      },
    );
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
    expect(report.summary).toMatchObject({ critical: 1, major: 45, minor: 20 });
  });
});
