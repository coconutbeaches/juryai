import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRY_RUN_001_COMPATIBILITY_ALIASES,
  alignPersonAForCase,
} from '../alignment/person-a-alignment-corrected.js';
import { evaluatePersonAForCase } from '../evaluation/person-a-diff-corrected.js';
import { parsePersonAModelOutputFromRawResponse } from '../evaluation/person-a-span-diagnostics.js';
import { applyPersonACompletionStateCompatibility } from '../extraction/person-a-completion-state-compatibility.js';
import {
  assembleDryRun001ClA003CompatibilityProjection,
  assembleDryRun001CompletionStateCompatibilityProjection,
} from '../extraction/person-a-frozen-compatibility.js';
import { assemblePersonAExtraction, extractPersonA } from '../extraction/person-a-extractor.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';

type JsonObject = Record<string, any>;

const root = process.cwd();
const submittedAt = '2026-07-25T00:00:00Z';
const generatedAt = '2026-07-25T13:03:42.000Z';
const model = 'gpt-5.6-sol';
const targetIds = ['del_02_about', 'del_03_services', 'del_04_contact'];

async function json(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(resolve(root, path), 'utf8')) as JsonObject;
}

async function frozenInputs() {
  const [narrative, historicalExtraction, golden, rawResponse] = await Promise.all([
    readFile(resolve(root, 'src/fixtures/dry_run_001.person_a.txt'), 'utf8'),
    json('docs/dry-run-001/extraction.json'),
    json('docs/dry-run-001/golden-projection.json'),
    json('docs/dry-run-001/raw-response.json'),
  ]);
  return {
    narrative,
    historicalExtraction,
    golden,
    modelOutput: parsePersonAModelOutputFromRawResponse(rawResponse),
  };
}

function evaluate(extraction: JsonObject, golden: JsonObject, narrative: string) {
  const options = {
    aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
    contractVersion: 'calibrated_live_v2' as const,
  };
  const alignment = alignPersonAForCase(extraction, golden, options);
  return evaluatePersonAForCase(extraction, golden, alignment, {
    ...options,
    narrative,
  });
}

function exactSpan(narrative: string): JsonObject {
  return {
    submission_id: 'submission_test',
    quote: narrative,
    start_char: 0,
    end_char: narrative.length,
  };
}

function providerFixture(narrative: string, name = 'Booking page'): JsonObject {
  return {
    deliverable_assessments: [
      {
        deliverable_id: 'deliverable_test',
        name,
        completion_status_person_a: 'complete',
        source_claim_ids: ['claim_test'],
      },
    ],
    claims: [
      {
        claim_id: 'claim_test',
        source_spans: [exactSpan(narrative)],
      },
    ],
  };
}

function projectedStatus(narrative: string, name?: string): string {
  return applyPersonACompletionStateCompatibility(providerFixture(narrative, name), narrative)
    .deliverable_assessments[0].completion_status_person_a;
}

describe('Person A completion-state compatibility', () => {
  it('reproduces and corrects only the three exact frozen completion upgrades', async () => {
    const { narrative, historicalExtraction, golden, modelOutput } = await frozenInputs();
    const before = structuredClone(modelOutput);
    const historical = evaluate(historicalExtraction, golden, narrative);
    const pr14Projection = assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
      narrative,
      submittedAt,
      model,
      generatedAt,
    });
    const corrected = assembleDryRun001CompletionStateCompatibilityProjection(modelOutput, {
      narrative,
      submittedAt,
      model,
      generatedAt,
    });

    expect(historical.summary).toMatchObject({ critical: 1, major: 45, minor: 20 });
    expect(evaluate(pr14Projection, golden, narrative).summary).toMatchObject({
      critical: 0,
      major: 45,
      minor: 20,
    });
    expect(
      modelOutput.deliverable_assessments
        .filter((item: JsonObject) => targetIds.includes(item.deliverable_id))
        .map((item: JsonObject) => item.completion_status_person_a),
    ).toEqual(['complete', 'complete', 'complete']);
    expect(
      corrected.deliverable_assessments
        .filter((item: JsonObject) => targetIds.includes(item.deliverable_id))
        .map((item: JsonObject) => item.completion_status_person_a),
    ).toEqual(['substantially_complete', 'substantially_complete', 'substantially_complete']);
    const reverted = structuredClone(corrected);
    for (const deliverable of reverted.deliverable_assessments) {
      if (targetIds.includes(deliverable.deliverable_id)) {
        deliverable.completion_status_person_a = 'complete';
      }
    }
    expect(reverted).toEqual(pr14Projection);

    const correctedReport = evaluate(corrected, golden, narrative);
    expect(correctedReport.summary).toMatchObject({ critical: 0, major: 42, minor: 20 });
    expect(
      correctedReport.errors.some(
        (error) =>
          targetIds.includes(error.extracted_id ?? '') && error.code === 'completion_status',
      ),
    ).toBe(false);
    expect(
      correctedReport.errors.some(
        (error) => error.extracted_id === 'del_06_pricing' && error.code === 'scope_status',
      ),
    ).toBe(true);
    expect(correctedReport.errors.some((error) => error.golden_id === 'cl_a_013')).toBe(true);
    expect(validatePersonAExtraction(corrected, narrative).valid).toBe(true);
    expect(modelOutput).toEqual(before);
  });

  it('proves the exact provider source supports a provisional staging state, not final page completion', async () => {
    const { narrative, modelOutput } = await frozenInputs();
    const scopeClaim = modelOutput.claims.find(
      (claim: JsonObject) => claim.claim_id === 'claim_01_original_scope',
    );
    const stagingClaim = modelOutput.claims.find(
      (claim: JsonObject) => claim.claim_id === 'claim_06_staging_complete',
    );

    expect(scopeClaim.source_spans).toEqual([
      {
        submission_id: 'submission_01',
        quote:
          'The original job was a homepage, about page, services page, contact page, and mobile-responsive layout, with two revision rounds.',
        start_char: 579,
        end_char: 708,
      },
    ]);
    expect(stagingClaim.source_spans).toEqual([
      {
        submission_id: 'submission_01',
        quote: 'I sent what I considered a complete staging version on June 3.',
        start_char: 1033,
        end_char: 1095,
      },
    ]);
    for (const span of [...scopeClaim.source_spans, ...stagingClaim.source_spans]) {
      expect(narrative.slice(span.start_char, span.end_char)).toBe(span.quote);
    }
    expect(stagingClaim.source_spans[0].quote).toMatch(/\bcomplete staging version\b/iu);
    expect(stagingClaim.source_spans[0].quote).not.toMatch(
      /\b(?:about|services|contact) page (?:is|was) complete\b/iu,
    );
    expect(narrative.slice(1033, 1210)).toContain('gave me a list of changes');
    expect(narrative.slice(1033, 1210)).toContain('I made most of them');
  });

  it.each([
    ['partial', 'I partially completed the booking page.', 'partially_complete'],
    ['draft', 'I sent a complete draft of the booking page.', 'substantially_complete'],
    ['pending', 'The booking page is pending approval before completion.', 'unknown'],
    ['blocked', 'I was blocked from completing the booking page.', 'unknown'],
    [
      'awaiting approval',
      'The booking page is awaiting approval before it can be completed.',
      'unknown',
    ],
    ['abandoned', 'I abandoned the booking page before completion.', 'not_complete'],
    ['disputed', 'I dispute that the booking page is complete.', 'disputed'],
    ['hypothetical', 'The booking page might be completed next week.', 'unknown'],
    ['denied', 'I did not complete the booking page.', 'not_complete'],
    ['not started', 'I never started the booking page.', 'not_complete'],
    ['failed', 'I failed to complete the booking page.', 'not_complete'],
    ['unable', 'I was unable to complete the booking page.', 'not_complete'],
  ])('does not upgrade %s language to complete', (_label, narrative, expected) => {
    expect(projectedStatus(narrative)).toBe(expected);
  });

  it.each([
    ['The draft was not complete.', 'not_complete'],
    ['I did not complete the staging version.', 'not_complete'],
  ])('gives negation precedence over provisional language: %s', (narrative, expected) => {
    expect(projectedStatus(narrative)).toBe(expected);
  });

  it.each([
    [
      'I partially completed the homepage. I completed the booking page.',
      'Booking page',
      'complete',
    ],
    [
      'I completed the homepage. I partially completed the booking page.',
      'Booking page',
      'partially_complete',
    ],
  ])(
    'scopes mixed deliverable states to the named deliverable: %s',
    (narrative, name, expected) => {
      expect(projectedStatus(narrative, name)).toBe(expected);
    },
  );

  it.each(['Not all pages are complete.', 'Not every page is complete.'])(
    'does not preserve complete from negated aggregate language: %s',
    (narrative) => {
      expect(projectedStatus(narrative)).toBe('unknown');
    },
  );

  it.each([
    'The booking page is in scope. No pages are complete.',
    'The booking page is in scope. None of the pages are complete.',
    'The booking page was complete. No pages are complete now.',
  ])('recognizes aggregate language denying all completion: %s', (narrative) => {
    expect(projectedStatus(narrative)).toBe('not_complete');
  });

  it('does not let a non-universal aggregate override explicit named completion', () => {
    expect(projectedStatus('The booking page is complete. Not all pages are complete.')).toBe(
      'complete',
    );
  });

  it.each([
    'The booking page has yet to be completed.',
    'The booking page needs to be completed.',
    'The booking page remains to be completed.',
  ])('recognizes explicit yet-to-be-completed language: %s', (narrative) => {
    expect(projectedStatus(narrative)).toBe('not_complete');
  });

  it.each(['The booking page is incomplete.', 'The booking page is unfinished.'])(
    'recognizes standalone incomplete wording: %s',
    (narrative) => {
      expect(projectedStatus(narrative)).toBe('partially_complete');
    },
  );

  it.each([
    ['I completed the homepage, and I did not complete the booking page.', 'Homepage', 'complete'],
    [
      'I completed the homepage, and I did not complete the booking page.',
      'Booking page',
      'not_complete',
    ],
  ])('isolates coordinating completion clauses: %s', (narrative, name, expected) => {
    expect(projectedStatus(narrative, name)).toBe(expected);
  });

  it.each([
    ['The booking page was incomplete yesterday but is complete now.', 'complete'],
    ['The booking page was incomplete yesterday, now it is complete.', 'complete'],
    ['The booking page was incomplete yesterday, it is complete now.', 'complete'],
    ['The booking page was incomplete yesterday. I completed the booking page today.', 'complete'],
    ['The booking page was incomplete yesterday, but I finished it today.', 'complete'],
    ['The booking page was complete. It became incomplete after feedback.', 'partially_complete'],
    ["I don't deny that the booking page is complete.", 'complete'],
  ])(
    'preserves a supported completion after review-sensitive phrasing: %s',
    (narrative, expected) => {
      expect(projectedStatus(narrative)).toBe(expected);
    },
  );

  it('orders linked completion evidence by exact narrative position', () => {
    const earlier = 'The booking page was incomplete yesterday.';
    const later = 'I completed the booking page today.';
    const narrative = `${earlier} ${later}`;
    const fixture = providerFixture(narrative);
    fixture.deliverable_assessments[0].source_claim_ids = ['claim_later', 'claim_earlier'];
    fixture.claims = [
      {
        claim_id: 'claim_later',
        source_spans: [
          {
            submission_id: 'submission_test',
            quote: later,
            start_char: earlier.length + 1,
            end_char: narrative.length,
          },
        ],
      },
      {
        claim_id: 'claim_earlier',
        source_spans: [
          {
            submission_id: 'submission_test',
            quote: earlier,
            start_char: 0,
            end_char: earlier.length,
          },
        ],
      },
    ];

    expect(
      applyPersonACompletionStateCompatibility(fixture, narrative).deliverable_assessments[0]
        .completion_status_person_a,
    ).toBe('complete');
  });

  it('recognizes completion-first passive dispute language', () => {
    expect(projectedStatus('Completion of the booking page is disputed.')).toBe('disputed');
  });

  it('preserves uncertainty around possible incomplete states', () => {
    expect(projectedStatus('The booking page may be incomplete.')).toBe('unknown');
    expect(projectedStatus("I don't know whether the booking page is complete.")).toBe('unknown');
    expect(
      projectedStatus(
        "The booking page was complete, but I can't confirm whether it is complete now.",
      ),
    ).toBe('unknown');
  });

  it.each([
    'I completed the booking page.',
    'The booking page is complete and I delivered it.',
    'I finished and delivered the booking page.',
  ])('preserves a genuinely completed named deliverable: %s', (narrative) => {
    expect(projectedStatus(narrative)).toBe('complete');
  });

  it.each([
    'I completed every page in the website.',
    'I finished the entire project and delivered it.',
    'All deliverables are complete.',
  ])('preserves genuine aggregate completion: %s', (narrative) => {
    expect(projectedStatus(narrative)).toBe('complete');
  });

  it('ignores non-exact source spans and never mutates the provider input', () => {
    const narrative = 'I sent a complete draft of the booking page.';
    const fixture = providerFixture(narrative);
    fixture.claims[0].source_spans[0].end_char -= 1;
    const before = structuredClone(fixture);

    expect(
      applyPersonACompletionStateCompatibility(fixture, narrative).deliverable_assessments[0]
        .completion_status_person_a,
    ).toBe('complete');
    expect(fixture).toEqual(before);
  });

  it('rejects exact-looking source spans with an oversized end offset', () => {
    const narrative = 'I sent a complete draft of the booking page.';
    const fixture = providerFixture(narrative);
    fixture.claims[0].source_spans[0].end_char = narrative.length + 5;

    expect(
      applyPersonACompletionStateCompatibility(fixture, narrative).deliverable_assessments[0]
        .completion_status_person_a,
    ).toBe('complete');
  });

  it('leaves ordinary assembly and fresh extraction unchanged', async () => {
    const { narrative, modelOutput } = await frozenInputs();
    const assembled = assemblePersonAExtraction(modelOutput, {
      narrative,
      submittedAt,
      model,
      generatedAt,
    });
    const fresh = await extractPersonA({
      narrative,
      submittedAt,
      model,
      generatedAt,
      client: {
        generate: async () => ({
          output: structuredClone(modelOutput),
          rawResponse: { id: 'offline-test-response' },
        }),
      },
    });

    for (const extraction of [assembled, fresh.extraction]) {
      expect(
        extraction.deliverable_assessments
          .filter((item: JsonObject) => targetIds.includes(item.deliverable_id))
          .map((item: JsonObject) => item.completion_status_person_a),
      ).toEqual(['complete', 'complete', 'complete']);
    }
  });

  it('keeps PR #14 output byte-identical and the new projection deterministic', async () => {
    const { narrative, modelOutput } = await frozenInputs();
    const pr14 = assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
      narrative,
      submittedAt,
      model,
      generatedAt,
    });
    const first = assembleDryRun001CompletionStateCompatibilityProjection(modelOutput, {
      narrative,
      submittedAt,
      model,
      generatedAt,
    });
    const second = assembleDryRun001CompletionStateCompatibilityProjection(modelOutput, {
      narrative,
      submittedAt,
      model,
      generatedAt,
    });
    const hash = (value: JsonObject) =>
      createHash('sha256')
        .update(`${JSON.stringify(value, null, 2)}\n`)
        .digest('hex');

    expect(hash(pr14)).toBe('d607a8555c2bda66e8b12f80ac47f8bc880b82d90a5f23ca5d9cfd58a0af4c41');
    expect(hash(first)).toBe('04b927a7e54be2afccf36f32494afc563c1c7d2d6730611ee74d2c9a961775d3');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('keeps the correction independent of frozen identities, goldens, and evaluation code', async () => {
    const source = await readFile(
      resolve(root, 'src/extraction/person-a-completion-state-compatibility.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /\b(?:alex|maya|del_02|del_03|del_04|dry_run|golden-projection|fixtures)\b/iu,
    );
    expect(source).not.toMatch(/from\s+['"][^'"]*(?:alignment|evaluation|golden)[^'"]*['"]/iu);
    const extractorSource = await readFile(
      resolve(root, 'src/extraction/person-a-extractor.ts'),
      'utf8',
    );
    expect(extractorSource).not.toMatch(/completion-state-compatibility/iu);
  });
});
