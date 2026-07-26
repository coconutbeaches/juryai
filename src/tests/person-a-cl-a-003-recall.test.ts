import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRY_RUN_001_COMPATIBILITY_ALIASES,
  alignPersonAForCase,
} from '../alignment/person-a-alignment-corrected.js';
import { evaluatePersonAForCase } from '../evaluation/person-a-diff-corrected.js';
import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';
import { parsePersonAModelOutputFromRawResponse } from '../evaluation/person-a-span-diagnostics.js';
import { recoverGroundedClientDelayClaims } from '../extraction/person-a-claim-coverage.js';
import {
  assemblePersonAExtraction,
  PERSON_A_EXTRACTOR_VERSION,
} from '../extraction/person-a-extractor.js';
import { PERSON_A_PROMPT_VERSION } from '../extraction/person-a-prompt.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';

type JsonObject = Record<string, any>;

const root = process.cwd();
const submittedAt = '2026-07-25T00:00:00Z';
const generatedAt = '2026-07-25T13:03:42.000Z';
const model = 'gpt-5.6-sol';
const fullGoldenSupportingQuote =
  'She did not send everything by then. I think the last major batch arrived around May 8 or May 9, but some small text changes kept coming after that.';
const eventSupportingQuote =
  'I think the last major batch arrived around May 8 or May 9, but some small text changes kept coming after that.';

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

function exactSpan(narrative: string, quote: string, occurrence = 0): JsonObject {
  let start = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    start = narrative.indexOf(quote, start + 1);
  }
  if (start < 0) throw new Error('Test quote occurrence was not found.');
  return {
    submission_id: 'submission_01',
    quote,
    start_char: start,
    end_char: start + quote.length,
  };
}

function candidateFixture(
  narrative: string,
  overrides: JsonObject = {},
  occurrence = 0,
): JsonObject {
  const quote = overrides.quote ?? narrative;
  const event: JsonObject = {
    event_id: 'event_candidate',
    date: {
      start: null,
      end: null,
      precision: 'unknown',
      approximate: false,
    },
    event_summary: 'Alex says Maya delivered the material after the deadline.',
    actor_party_id: 'party_b',
    actor_third_party_id: null,
    asserted_by_party_ids: ['party_a'],
    occurrence_status: 'supported_unanswered',
    interpretation_status: 'unclear',
    person_a_interpretation:
      'Alex treats Maya’s late delivery as directly contributing to the schedule delay.',
    person_b_interpretation: null,
    source_evidence_ids: ['ev_client_content'],
    source_spans: [exactSpan(narrative, quote, occurrence)],
    materiality: 'high',
    ...overrides,
  };
  delete event.quote;
  return {
    timeline: [event],
    claims: [],
    evidence: [{ evidence_id: 'ev_client_content' }],
  };
}

describe('cl_a_003 Person A recall coverage', () => {
  it('recovers the omitted grounded client-delay claim from the exact frozen model output', async () => {
    const { narrative, historicalExtraction, golden, modelOutput } = await frozenInputs();
    expect(narrative.slice(429, 577)).toBe(fullGoldenSupportingQuote);

    const sourceEvent = modelOutput.timeline.find(
      (event: JsonObject) => event.event_id === 'event_04_major_batch',
    );
    expect(sourceEvent).toMatchObject({
      actor_party_id: 'party_b',
      asserted_by_party_ids: ['party_a'],
      occurrence_status: 'supported_unanswered',
      person_a_interpretation:
        'Alex treats the timing of the major batch and later text changes as contributing to delay.',
      source_evidence_ids: ['ev_03_client_content'],
      materiality: 'high',
    });
    expect(sourceEvent.source_spans).toEqual([
      {
        submission_id: 'submission_01',
        quote: eventSupportingQuote,
        start_char: 466,
        end_char: 577,
      },
    ]);
    expect(
      modelOutput.claims.some((claim: JsonObject) =>
        claim.source_spans.some((span: JsonObject) => span.start_char === 466),
      ),
    ).toBe(false);

    const coverageOnly = recoverGroundedClientDelayClaims(modelOutput, narrative);
    expect(coverageOnly.timeline).toEqual(modelOutput.timeline);
    expect(coverageOnly.evidence).toEqual(modelOutput.evidence);

    const corrected = assemblePersonAExtraction(modelOutput, {
      narrative,
      submittedAt,
      model,
      generatedAt,
    });
    const recovered = corrected.claims.filter(
      (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toEqual({
      claim_id: 'claim_event_04_major_batch_client_delay',
      party_id: 'party_a',
      claim_text: sourceEvent.event_summary,
      claim_type: 'client_delay',
      response_status: 'unanswered',
      materiality: 'high',
      support_level: 'not_assessed',
      supporting_evidence_ids: ['ev_03_client_content'],
      contradicting_evidence_ids: [],
      counterclaim_ids: [],
      requires_clarification: true,
      against_asserting_party_interest: false,
      source_spans: [
        {
          submission_id: 'sub_a_extracted',
          quote: eventSupportingQuote,
          start_char: 466,
          end_char: 577,
        },
      ],
    });
    expect(recovered[0].claim_text).toMatch(/\bthinks\b.*\bsays\b/u);
    expect(narrative.slice(466, 577)).toBe(recovered[0].source_spans[0].quote);
    expect(validatePersonAExtraction(corrected, narrative).valid).toBe(true);
    expect(PERSON_A_PROMPT_VERSION).toBe('person-a-v0.1.4');
    expect(PERSON_A_EXTRACTOR_VERSION).toBe('person-a-v0.1.4');

    const historicalReport = evaluate(historicalExtraction, golden, narrative);
    expect(historicalReport.summary).toMatchObject({ critical: 1, major: 45, minor: 20 });
    expect(historicalReport.errors.find((error) => error.golden_id === 'cl_a_003')).toMatchObject({
      severity: 'critical',
      family: 'claims',
      code: 'missing_golden_object',
    });

    const correctedReport = evaluate(corrected, golden, narrative);
    expect(correctedReport.summary).toMatchObject({ critical: 0, major: 45, minor: 20 });
    expect(correctedReport.errors.some((error) => error.golden_id === 'cl_a_003')).toBe(false);
    expect(correctedReport.errors.some((error) => error.golden_id === 'cl_a_013')).toBe(true);
  });

  it('does not duplicate an event already covered by a claim source span', () => {
    const narrative = 'Maya delivered the content late and it directly contributed to delay.';
    const modelOutput = candidateFixture(narrative);
    modelOutput.claims.push({
      claim_id: 'claim_existing',
      source_spans: [exactSpan(narrative, narrative)],
    });

    const corrected = recoverGroundedClientDelayClaims(modelOutput, narrative);
    expect(corrected.claims).toEqual(modelOutput.claims);
  });

  it('preserves the selected occurrence when identical source text repeats', () => {
    const quote = 'Maya delivered the content late and it directly contributed to delay.';
    const narrative = `${quote}\nUnrelated separator.\n${quote}`;
    const modelOutput = candidateFixture(narrative, { quote }, 1);

    const corrected = recoverGroundedClientDelayClaims(modelOutput, narrative);
    expect(corrected.claims).toHaveLength(1);
    expect(corrected.claims[0].source_spans[0]).toEqual(exactSpan(narrative, quote, 1));
  });

  it('does not recover a claim when the relevant event is absent', () => {
    const modelOutput = { timeline: [], claims: [], evidence: [] };
    expect(
      recoverGroundedClientDelayClaims(modelOutput, 'Nothing relevant occurred.').claims,
    ).toEqual([]);
  });

  it.each([
    {
      label: 'hypothetical language',
      narrative: 'If the delivery were late, it could contribute to delay.',
      event_summary: 'Alex describes a hypothetical late delivery.',
      person_a_interpretation: 'Alex says a late delivery could contribute to delay.',
      occurrence_status: 'unclear',
    },
    {
      label: 'another person’s belief',
      narrative: 'Maya believes the delivery contributed to delay.',
      event_summary: 'Alex reports Maya’s belief about delay.',
      person_a_interpretation: 'Alex reports Maya’s belief that the delivery contributed to delay.',
    },
    {
      label: 'uncertainty or speculation',
      narrative: 'I wonder whether the delivery might have contributed to delay.',
      event_summary: 'Alex wonders whether the delivery affected delay.',
      person_a_interpretation:
        'Alex is uncertain whether the delivery might have contributed to delay.',
      occurrence_status: 'unclear',
    },
    {
      label: 'evidence metadata',
      narrative: 'The file metadata uses the label delivery delay.',
      event_summary: 'Alex reports an evidence metadata label.',
      person_a_interpretation: 'Alex notes that evidence metadata uses the label delivery delay.',
    },
    {
      label: 'explicit denial',
      narrative: 'The delivery did not contribute to delay.',
      event_summary: 'Alex denies delivery causation.',
      person_a_interpretation: 'Alex denies that the delivery contributed to delay.',
      occurrence_status: 'disputed',
    },
    {
      label: 'related keywords without the underlying meaning',
      narrative: 'Delivery and delay appear as separate index keywords.',
      event_summary: 'Alex lists delivery and delay as index keywords.',
      person_a_interpretation: 'Alex mentions delivery and delay as separate topics.',
    },
    {
      label: 'an inference',
      narrative: 'I infer that the delivery contributed to delay.',
      event_summary: 'Alex infers that the delivery contributed to delay.',
      person_a_interpretation: 'Alex infers that the delivery contributed to delay.',
    },
    {
      label: 'a materially strengthened summary',
      narrative: 'I think the delivery arrived around May 8.',
      event_summary: 'Maya delivered the content on May 8.',
      person_a_interpretation:
        'Alex treats Maya’s late delivery as directly contributing to the schedule delay.',
    },
  ])('does not recover a client-delay claim for $label', (control) => {
    const { narrative, ...overrides } = control;
    delete (overrides as JsonObject).label;
    const modelOutput = candidateFixture(narrative, overrides);

    const corrected = recoverGroundedClientDelayClaims(modelOutput, narrative);
    expect(corrected.claims).toEqual([]);
  });

  it('rejects a causal candidate whose source span is not an exact narrative slice', () => {
    const narrative = 'Maya delivered the content late and it directly contributed to delay.';
    const modelOutput = candidateFixture(narrative);
    modelOutput.timeline[0].source_spans[0].end_char -= 1;

    expect(recoverGroundedClientDelayClaims(modelOutput, narrative).claims).toEqual([]);
  });

  it('does not upgrade agreed or disputed interpretation states into a Person A claim', () => {
    const narrative = 'Maya delivered the content late and it directly contributed to delay.';
    for (const interpretationStatus of ['agreed', 'disputed']) {
      const modelOutput = candidateFixture(narrative, {
        interpretation_status: interpretationStatus,
      });
      expect(recoverGroundedClientDelayClaims(modelOutput, narrative).claims).toEqual([]);
    }
  });

  it('keeps runtime claim coverage independent of case identities and comparison fixtures', async () => {
    const source = await readFile(
      resolve(root, 'src/extraction/person-a-claim-coverage.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /\b(?:alex|maya|cl_a_003|event_04|dry_run|golden-projection|fixtures)\b/iu,
    );
  });

  it('keeps the historical golden projection on its original version provenance', () => {
    const projection = buildPersonAGoldenProjection();
    expect(projection.extractor_version).toBe('person-a-v0.1.3');
    expect(projection.metadata.prompt_version).toBe('person-a-v0.1.3');
  });
});
