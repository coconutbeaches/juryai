import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRY_RUN_001_COMPATIBILITY_ALIASES,
  alignPersonAForCase,
  semanticSimilarity,
} from '../alignment/person-a-alignment-corrected.js';
import {
  alignDryRun001TimelineContainmentProjection,
  proveExactSourceTimelineContainment,
} from '../alignment/person-a-timeline-containment-compatibility.js';
import { evaluatePersonAForCase } from '../evaluation/person-a-diff-corrected.js';
import { evaluateDryRun001TimelineContainmentProjection } from '../evaluation/person-a-timeline-containment-compatibility.js';
import { parsePersonAModelOutputFromRawResponse } from '../evaluation/person-a-span-diagnostics.js';
import { assemblePersonAExtraction, extractPersonA } from '../extraction/person-a-extractor.js';
import {
  assembleDryRun001ClA003CompatibilityProjection,
  assembleDryRun001CompletionStateCompatibilityProjection,
  assembleDryRun001DeterministicClaimTypeProjection,
} from '../extraction/person-a-frozen-compatibility.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';

type JsonObject = Record<string, any>;

const root = process.cwd();
const options = {
  submittedAt: '2026-07-25T00:00:00Z',
  generatedAt: '2026-07-25T13:03:42.000Z',
  model: 'gpt-5.6-sol',
};

async function json(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(resolve(root, path), 'utf8')) as JsonObject;
}

async function frozenProjection() {
  const [narrative, golden, rawResponse, historicalExtraction] = await Promise.all([
    readFile(resolve(root, 'src/fixtures/dry_run_001.person_a.txt'), 'utf8'),
    json('docs/dry-run-001/golden-projection.json'),
    json('docs/dry-run-001/raw-response.json'),
    json('docs/dry-run-001/extraction.json'),
  ]);
  const modelOutput = parsePersonAModelOutputFromRawResponse(rawResponse);
  const pr14 = assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
    ...options,
    narrative,
  });
  const pr15 = assembleDryRun001CompletionStateCompatibilityProjection(modelOutput, {
    ...options,
    narrative,
  });
  const extraction = assembleDryRun001DeterministicClaimTypeProjection(modelOutput, {
    ...options,
    narrative,
  });
  const evaluationOptions = {
    aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
    contractVersion: 'calibrated_live_v2' as const,
    narrative,
  };
  const alignment = alignPersonAForCase(extraction, golden, evaluationOptions);
  const report = evaluatePersonAForCase(extraction, golden, alignment, evaluationOptions);
  const corrected = evaluateDryRun001TimelineContainmentProjection(
    extraction,
    golden,
    evaluationOptions,
  );
  return {
    extraction,
    golden,
    narrative,
    rawResponse,
    historicalExtraction,
    modelOutput,
    pr14,
    pr15,
    evaluationOptions,
    alignment,
    report,
    corrected,
  };
}

function hash(value: JsonObject): string {
  return createHash('sha256')
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest('hex');
}

function errorKey(error: JsonObject): string {
  return JSON.stringify(error);
}

function evaluate(extraction: JsonObject, golden: JsonObject, evaluationOptions: JsonObject) {
  const alignment = alignPersonAForCase(extraction, golden, evaluationOptions as any);
  return evaluatePersonAForCase(extraction, golden, alignment, evaluationOptions as any);
}

describe('Dry Run 001 exact-source timeline containment', () => {
  it('reproduces all eight exact PR #16 timeline findings before correction', async () => {
    const { report } = await frozenProjection();

    expect(report.summary).toMatchObject({ critical: 0, major: 39, minor: 20 });
    expect(
      report.errors
        .filter((error) => error.family === 'timeline')
        .map((error) => [error.severity, error.code, error.extracted_id, error.golden_id]),
    ).toEqual([
      ['major', 'actor_specificity', 'event_01_agreement', 'tl_agreement'],
      ['major', 'actor_specificity', 'event_04_major_batch', 'tl_photo_delivery'],
      ['major', 'missing_golden_object', undefined, 'tl_content_due'],
      ['major', 'missing_golden_object', undefined, 'tl_instagram_use'],
      ['major', 'missing_golden_object', undefined, 'tl_brief_publication'],
      ['major', 'source_grounded_extra_object', 'event_02_content_deadline', undefined],
      ['major', 'source_grounded_extra_object', 'event_03_content_late', undefined],
      ['major', 'source_grounded_extra_object', 'event_08_changes_made', undefined],
    ]);
  });

  it('proves the selected pair through exact nested narrative support', async () => {
    const { extraction, golden, narrative, modelOutput, historicalExtraction } =
      await frozenProjection();
    const extracted = extraction.timeline.find(
      (item: JsonObject) => item.event_id === 'event_02_content_deadline',
    );
    const expected = golden.timeline.find((item: JsonObject) => item.event_id === 'tl_content_due');
    const raw = modelOutput.timeline.find(
      (item: JsonObject) => item.event_id === 'event_02_content_deadline',
    );
    const historical = historicalExtraction.timeline.find(
      (item: JsonObject) => item.event_id === 'event_02_content_deadline',
    );

    expect(extracted).toBeTruthy();
    expect(expected).toBeTruthy();
    expect(raw.event_summary).toBe(extracted.event_summary);
    expect(historical.event_summary).toBe(extracted.event_summary);
    expect(extracted.source_spans).toEqual([
      {
        submission_id: 'sub_a_extracted',
        quote:
          'The intended launch was around May 20, although the contract also says the timeline depended on Maya supplying final copy and images by April 25.',
        start_char: 283,
        end_char: 428,
      },
    ]);
    expect(expected.source_spans).toEqual([
      {
        submission_id: 'sub_a_001',
        quote: 'by April 25.',
        start_char: 416,
        end_char: 428,
      },
    ]);
    for (const span of [...extracted.source_spans, ...expected.source_spans]) {
      expect(narrative.slice(span.start_char, span.end_char)).toBe(span.quote);
    }
    expect(extracted.source_spans[0].start_char).toBeLessThan(expected.source_spans[0].start_char);
    expect(extracted.source_spans[0].end_char).toBe(expected.source_spans[0].end_char);
    expect(extracted.actor_party_id).toBe(expected.actor_party_id);
    expect(extracted.actor_third_party_id).toBe(expected.actor_third_party_id);
    expect(extracted.date).toEqual(expected.date);
    expect(extracted.occurrence_status).toBe(expected.occurrence_status);
    expect(extracted.interpretation_status).toBe(expected.interpretation_status);
    expect(extracted.asserted_by_party_ids).toEqual(expected.asserted_by_party_ids);
    expect(extracted.materiality).toBe(expected.materiality);
    expect(
      semanticSimilarity(
        extracted.event_summary,
        expected.event_summary,
        DRY_RUN_001_COMPATIBILITY_ALIASES,
      ),
    ).toBeLessThan(0.3);

    expect(
      proveExactSourceTimelineContainment(
        extracted,
        expected,
        narrative,
        DRY_RUN_001_COMPATIBILITY_ALIASES,
      ),
    ).toEqual({
      extractedSpan: {
        start_char: 283,
        end_char: 428,
        quote:
          'The intended launch was around May 20, although the contract also says the timeline depended on Maya supplying final copy and images by April 25.',
      },
      goldenSpan: {
        start_char: 416,
        end_char: 428,
        quote: 'by April 25.',
      },
      materialTokens: ['25', 'april'],
    });
  });

  it('removes only the selected missing/extra pair and adds no finding', async () => {
    const { report, corrected } = await frozenProjection();
    const expectedErrors = report.errors.filter(
      (error) =>
        !(
          error.family === 'timeline' &&
          ((error.code === 'missing_golden_object' && error.golden_id === 'tl_content_due') ||
            (error.code === 'source_grounded_extra_object' &&
              error.extracted_id === 'event_02_content_deadline'))
        ),
    );

    expect(
      corrected.alignment.families.timeline.pairs.find(
        (pair) =>
          pair.extracted_id === 'event_02_content_deadline' && pair.golden_id === 'tl_content_due',
      ),
    ).toMatchObject({
      recovery_reason: 'exact_source_containment',
    });
    expect(corrected.audit.removed_findings).toEqual([
      {
        severity: 'major',
        family: 'timeline',
        code: 'missing_golden_object',
        golden_id: 'tl_content_due',
      },
      {
        severity: 'major',
        family: 'timeline',
        code: 'source_grounded_extra_object',
        extracted_id: 'event_02_content_deadline',
      },
    ]);
    expect(corrected.report.summary).toMatchObject({ critical: 0, major: 37, minor: 20 });
    expect(corrected.audit.added_findings).toEqual([]);
    expect(corrected.report.errors.map(errorKey).sort()).toEqual(
      expectedErrors.map(errorKey).sort(),
    );
    expect(
      corrected.report.errors
        .filter((error) => error.family === 'timeline')
        .map((error) => [error.code, error.extracted_id, error.golden_id]),
    ).toEqual([
      ['actor_specificity', 'event_01_agreement', 'tl_agreement'],
      ['actor_specificity', 'event_04_major_batch', 'tl_photo_delivery'],
      ['missing_golden_object', undefined, 'tl_instagram_use'],
      ['missing_golden_object', undefined, 'tl_brief_publication'],
      ['source_grounded_extra_object', 'event_03_content_late', undefined],
      ['source_grounded_extra_object', 'event_08_changes_made', undefined],
    ]);
  });

  it('preserves prior projection bytes and historical evaluation counts', async () => {
    const { pr14, pr15, extraction, golden, evaluationOptions } = await frozenProjection();

    expect(hash(pr14)).toBe('d607a8555c2bda66e8b12f80ac47f8bc880b82d90a5f23ca5d9cfd58a0af4c41');
    expect(hash(pr15)).toBe('04b927a7e54be2afccf36f32494afc563c1c7d2d6730611ee74d2c9a961775d3');
    expect(hash(extraction)).toBe(
      'b24bb43acb4ce29ac626c4b3d75362627500a4ca8449bea7e85c93e906ffbd0b',
    );
    expect(evaluate(pr14, golden, evaluationOptions).summary).toMatchObject({
      critical: 0,
      major: 45,
      minor: 20,
    });
    expect(evaluate(pr15, golden, evaluationOptions).summary).toMatchObject({
      critical: 0,
      major: 42,
      minor: 20,
    });
    expect(evaluate(extraction, golden, evaluationOptions).summary).toMatchObject({
      critical: 0,
      major: 39,
      minor: 20,
    });
  });

  it('is deterministic and leaves the validated extraction unchanged', async () => {
    const { extraction, golden, narrative, evaluationOptions } = await frozenProjection();
    const before = structuredClone(extraction);
    const first = evaluateDryRun001TimelineContainmentProjection(
      extraction,
      golden,
      evaluationOptions,
    );
    const second = evaluateDryRun001TimelineContainmentProjection(
      extraction,
      golden,
      evaluationOptions,
    );

    expect(first).toEqual(second);
    expect(hash(first)).toBe(hash(second));
    expect(extraction).toEqual(before);
    expect(validatePersonAExtraction(extraction, narrative).valid).toBe(true);
  });

  it('fails closed for unsupported near matches, malformed spans, and missing contract proof', async () => {
    const { extraction, golden, narrative, evaluationOptions } = await frozenProjection();
    const nearMatch = structuredClone(extraction);
    nearMatch.timeline.find(
      (item: JsonObject) => item.event_id === 'event_02_content_deadline',
    ).event_summary = 'Maya supplied final copy after the deadline.';
    expect(() =>
      alignDryRun001TimelineContainmentProjection(nearMatch, golden, evaluationOptions),
    ).toThrow(/exactly one mutually unique exact-source pair/iu);

    const malformedGolden = structuredClone(golden);
    malformedGolden.timeline.find(
      (item: JsonObject) => item.event_id === 'tl_content_due',
    ).source_spans[0].quote = 'by April 26.';
    expect(() =>
      alignDryRun001TimelineContainmentProjection(extraction, malformedGolden, evaluationOptions),
    ).toThrow(/exactly one mutually unique exact-source pair/iu);

    expect(() =>
      alignDryRun001TimelineContainmentProjection(extraction, golden, {
        aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
        contractVersion: 'calibrated_live_v2',
      }),
    ).toThrow(/requires the exact narrative/iu);
    expect(() =>
      alignDryRun001TimelineContainmentProjection(extraction, golden, {
        aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
        contractVersion: 'locked_acceptance_v1',
        narrative,
      }),
    ).toThrow(/requires calibrated_live_v2/iu);
  });

  it('rejects competing containment candidates instead of forcing an alignment', async () => {
    const { extraction, golden, evaluationOptions } = await frozenProjection();
    const ambiguousGolden = structuredClone(golden);
    const duplicate = structuredClone(
      ambiguousGolden.timeline.find((item: JsonObject) => item.event_id === 'tl_content_due'),
    );
    duplicate.event_id = 'tl_content_due_competing';
    ambiguousGolden.timeline.push(duplicate);

    expect(() =>
      alignDryRun001TimelineContainmentProjection(extraction, ambiguousGolden, evaluationOptions),
    ).toThrow(/exactly one mutually unique exact-source pair/iu);
  });

  it('keeps material actor differences and legitimate extracted extras visible', async () => {
    const { extraction, golden, narrative, corrected } = await frozenProjection();
    const selectedExtracted = extraction.timeline.find(
      (item: JsonObject) => item.event_id === 'event_02_content_deadline',
    );
    const selectedGolden = golden.timeline.find(
      (item: JsonObject) => item.event_id === 'tl_content_due',
    );
    const wrongActor = structuredClone(selectedExtracted);
    wrongActor.actor_party_id = 'party_a';
    expect(
      proveExactSourceTimelineContainment(
        wrongActor,
        selectedGolden,
        narrative,
        DRY_RUN_001_COMPATIBILITY_ALIASES,
      ),
    ).toBeNull();

    expect(corrected.report.errors.filter((error) => error.code === 'actor_specificity')).toEqual([
      expect.objectContaining({
        extracted_id: 'event_01_agreement',
        golden_id: 'tl_agreement',
      }),
      expect.objectContaining({
        extracted_id: 'event_04_major_batch',
        golden_id: 'tl_photo_delivery',
      }),
    ]);
    expect(
      corrected.report.errors.filter(
        (error) => error.family === 'timeline' && error.code === 'source_grounded_extra_object',
      ),
    ).toEqual([
      expect.objectContaining({ extracted_id: 'event_03_content_late' }),
      expect.objectContaining({ extracted_id: 'event_08_changes_made' }),
    ]);
  });

  it('does not convert cross-family representation into invented timeline objects', async () => {
    const { extraction, corrected } = await frozenProjection();
    expect(
      extraction.claims.find((claim: JsonObject) => claim.claim_id === 'claim_10_use')?.claim_text,
    ).toContain('used images from the website in social media posts');
    expect(
      extraction.claims.find((claim: JsonObject) => claim.claim_id === 'claim_10_use')?.claim_text,
    ).toContain('part of the site was briefly published');
    expect(extraction.timeline).toHaveLength(10);
    expect(
      corrected.report.errors.filter(
        (error) =>
          error.code === 'missing_golden_object' &&
          ['tl_instagram_use', 'tl_brief_publication'].includes(error.golden_id ?? ''),
      ),
    ).toHaveLength(2);
  });

  it('leaves ordinary assembly and fresh extraction isolated from PR #17 evaluation', async () => {
    const { modelOutput, extraction, golden, narrative, evaluationOptions } =
      await frozenProjection();
    const providerBefore = structuredClone(modelOutput);
    const assembledBefore = assemblePersonAExtraction(modelOutput, { ...options, narrative });

    evaluateDryRun001TimelineContainmentProjection(extraction, golden, evaluationOptions);
    const assembledAfter = assemblePersonAExtraction(modelOutput, { ...options, narrative });
    const fresh = await extractPersonA({
      ...options,
      narrative,
      client: {
        generate: async () => ({
          output: structuredClone(modelOutput),
          rawResponse: { id: 'offline-test-response' },
        }),
      },
    });

    expect(modelOutput).toEqual(providerBefore);
    expect(assembledAfter).toEqual(assembledBefore);
    expect(fresh.extraction).toEqual(assembledBefore);
  });
});
