import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRY_RUN_001_COMPATIBILITY_ALIASES,
  alignPersonAForCase,
} from '../alignment/person-a-alignment-corrected.js';
import { evaluatePersonAForCase } from '../evaluation/person-a-diff-corrected.js';
import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';
import { parsePersonAModelOutputFromRawResponse } from '../evaluation/person-a-span-diagnostics.js';
import { applyDryRun001ClA003CompatibilityRecovery } from '../extraction/person-a-dry-run-001-cl-a-003-compatibility-recovery.js';
import { assembleDryRun001ClA003CompatibilityProjection } from '../extraction/person-a-frozen-compatibility.js';
import {
  assemblePersonAExtraction,
  extractPersonA,
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

function existingClaim(
  narrative: string,
  overrides: JsonObject = {},
  quote = narrative,
): JsonObject {
  return {
    claim_id: 'claim_existing',
    party_id: 'party_a',
    claim_text: 'Alex says Maya delivered the material after the deadline.',
    claim_type: 'client_delay',
    response_status: 'unanswered',
    materiality: 'high',
    support_level: 'not_assessed',
    supporting_evidence_ids: ['ev_client_content'],
    contradicting_evidence_ids: [],
    counterclaim_ids: [],
    requires_clarification: false,
    against_asserting_party_interest: false,
    source_spans: [exactSpan(narrative, quote)],
    ...overrides,
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

    const coverageOnly = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
    expect(coverageOnly.timeline).toEqual(modelOutput.timeline);
    expect(coverageOnly.evidence).toEqual(modelOutput.evidence);

    const corrected = assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
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
    modelOutput.claims.push(existingClaim(narrative));

    const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
    expect(corrected.claims).toEqual(modelOutput.claims);
  });

  describe('review finding 1: explicit causal uncertainty', () => {
    it.each([
      'Alex says it is unclear whether the delivery contributed to delay.',
      'Alex says it is unknown whether the delivery caused delay.',
      'Alex says the delivery may have caused delay.',
      'Alex says the delivery might have contributed to delay.',
      'Alex says it remains unresolved whether the delivery caused delay.',
      'Alex says it is merely possible that the delivery caused delay.',
    ])('does not promote %s', (personAInterpretation) => {
      const narrative = 'Maya delivered the content after the deadline.';
      const modelOutput = candidateFixture(narrative, {
        person_a_interpretation: personAInterpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it('still promotes a direct asserted causal interpretation', () => {
      const narrative = 'Maya delivered the content late and it directly contributed to delay.';
      const modelOutput = candidateFixture(narrative);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });
  });

  describe('second review finding 1: calendar-month May', () => {
    it.each([
      'Alex says the May delivery caused schedule delay.',
      'Alex says the May 2024 delivery caused schedule delay.',
      'Alex says the May shipment contributed to the delay.',
    ])('promotes direct calendar-month causation in %s', (personAInterpretation) => {
      const narrative = 'Maya supplied project material during May.';
      const modelOutput = candidateFixture(narrative, {
        person_a_interpretation: personAInterpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it.each([
      'Alex says the delivery may cause delay.',
      'Alex says the delivery may have caused delay.',
      'Alex says it may be responsible for the delay.',
      'May have caused schedule delay.',
    ])('continues to reject modal uncertainty in %s', (personAInterpretation) => {
      const narrative = 'Maya supplied project material.';
      const modelOutput = candidateFixture(narrative, {
        person_a_interpretation: personAInterpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });
  });

  describe('review finding 2: typed semantic duplicate coverage', () => {
    it('does not let an unrelated deadline claim with a containing span suppress recovery', () => {
      const eventQuote = 'Maya delivered the content late and it directly contributed to delay.';
      const narrative = `The deadline was April 25. ${eventQuote}`;
      const modelOutput = candidateFixture(narrative, { quote: eventQuote });
      modelOutput.claims.push(
        existingClaim(narrative, {
          claim_text: 'Alex asserts that the deadline was April 25.',
          claim_type: 'delay',
          supporting_evidence_ids: ['ev_client_content'],
        }),
      );

      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
      expect(
        corrected.claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_candidate_client_delay',
        ),
      ).toHaveLength(1);
    });

    it.each(['payment', 'scope'])(
      'does not let an unrelated %s claim with a containing span suppress recovery',
      (claimType) => {
        const eventQuote = 'Maya delivered the content late and it directly contributed to delay.';
        const narrative = `The paragraph discusses terms. ${eventQuote}`;
        const modelOutput = candidateFixture(narrative, { quote: eventQuote });
        modelOutput.claims.push(
          existingClaim(narrative, {
            claim_text: `Alex makes a ${claimType} assertion.`,
            claim_type: claimType,
          }),
        );

        const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
        expect(
          corrected.claims.filter(
            (claim: JsonObject) => claim.claim_id === 'claim_event_candidate_client_delay',
          ),
        ).toHaveLength(1);
      },
    );

    it('suppresses a semantically compatible existing client-delay claim', () => {
      const narrative = 'Maya delivered the content late and it directly contributed to delay.';
      const modelOutput = candidateFixture(narrative);
      modelOutput.claims.push(existingClaim(narrative));

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual(
        modelOutput.claims,
      );
    });

    it('represents two structurally distinct qualifying events that share one source span', () => {
      const narrative =
        'Maya delivered the images late and continued changing text, and both events contributed to delay.';
      const modelOutput = candidateFixture(narrative, {
        event_id: 'event_images_late',
        event_summary: 'Alex says Maya delivered the images late.',
        person_a_interpretation:
          'Alex treats the late image delivery as directly contributing to schedule delay.',
      });
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_id: 'event_text_changes',
        event_summary: 'Alex says Maya continued changing the text.',
        person_a_interpretation:
          'Alex treats the continued text changes as directly contributing to schedule delay.',
      });

      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
      expect(corrected.claims.map((claim: JsonObject) => claim.claim_id)).toEqual([
        'claim_event_images_late_client_delay',
        'claim_event_text_changes_client_delay',
      ]);
    });

    it('does not duplicate structurally equivalent events', () => {
      const narrative = 'Maya delivered the content late and it directly contributed to delay.';
      const modelOutput = candidateFixture(narrative);
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_id: 'event_candidate',
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });
  });

  describe('second review finding 2: event identity excludes evidence support', () => {
    it('does not use a reused ID to merge otherwise ambiguous evidence support', () => {
      const narrative = 'Maya delivered the content late and it directly contributed to delay.';
      const modelOutput = candidateFixture(narrative, {
        source_evidence_ids: ['ev_client_content'],
      });
      modelOutput.evidence.push({ evidence_id: 'ev_follow_up' });
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_id: 'event_candidate',
        source_evidence_ids: ['ev_follow_up'],
      });

      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
      expect(corrected.claims).toHaveLength(2);
      expect(corrected.claims.map((claim: JsonObject) => claim.supporting_evidence_ids)).toEqual([
        ['ev_client_content'],
        ['ev_follow_up'],
      ]);
    });

    it('does not split one event when evidence IDs appear in different orders', () => {
      const narrative = 'Maya delivered the content late and it directly contributed to delay.';
      const modelOutput = candidateFixture(narrative, {
        source_evidence_ids: ['ev_follow_up', 'ev_client_content'],
      });
      modelOutput.evidence.push({ evidence_id: 'ev_follow_up' });
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_id: 'event_candidate',
        source_evidence_ids: ['ev_client_content', 'ev_follow_up'],
      });

      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
      expect(corrected.claims).toHaveLength(1);
      expect(corrected.claims[0].supporting_evidence_ids).toEqual([
        'ev_client_content',
        'ev_follow_up',
      ]);
    });

    it('still distinguishes events whose asserted meaning differs', () => {
      const narrative =
        'Maya delivered the images late and continued changing text, and both events contributed to delay.';
      const modelOutput = candidateFixture(narrative, {
        event_id: 'event_images_late',
        event_summary: 'Alex says Maya delivered the images late.',
        person_a_interpretation:
          'Alex treats the late image delivery as directly contributing to schedule delay.',
      });
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_id: 'event_text_changes',
        event_summary: 'Alex says Maya continued changing the text.',
        person_a_interpretation:
          'Alex treats the continued text changes as directly contributing to schedule delay.',
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        2,
      );
    });

    it('treats different exact source occurrences as distinct event identity', () => {
      const quote = 'Maya delivered the content late and it directly contributed to delay.';
      const narrative = `${quote}\nLater account: ${quote}`;
      const modelOutput = candidateFixture(narrative, { quote }, 0);
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_id: 'event_second_occurrence',
        source_spans: [exactSpan(narrative, quote, 1)],
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        2,
      );
    });

    it('treats materially different typed dates as distinct event identity', () => {
      const narrative = 'Maya delivered the content late and it directly contributed to delay.';
      const modelOutput = candidateFixture(narrative, {
        event_id: 'event_may_08',
        date: {
          start: '2024-05-08',
          end: '2024-05-08',
          precision: 'day',
          approximate: false,
        },
      });
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_id: 'event_may_09',
        date: {
          start: '2024-05-09',
          end: '2024-05-09',
          precision: 'day',
          approximate: false,
        },
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        2,
      );
    });
  });

  describe('second review finding 3: existing-claim meaning equivalence', () => {
    const paragraph =
      'Maya delivered the images late and continued changing text, and both events contributed to delay.';
    const imageSummary = 'Alex says Maya delivered the images late.';
    const textSummary = 'Alex says Maya continued changing the text.';

    function sharedParagraphEvents(): JsonObject {
      const modelOutput = candidateFixture(paragraph, {
        event_id: 'event_images_late',
        event_summary: imageSummary,
        person_a_interpretation:
          'Alex treats the late image delivery as directly contributing to schedule delay.',
      });
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_id: 'event_text_changes',
        event_summary: textSummary,
        person_a_interpretation:
          'Alex treats the continued text changes as directly contributing to schedule delay.',
      });
      return modelOutput;
    }

    it('lets two distinct events sharing one span and evidence coexist', () => {
      const corrected = applyDryRun001ClA003CompatibilityRecovery(
        sharedParagraphEvents(),
        paragraph,
      );
      expect(corrected.claims.map((claim: JsonObject) => claim.claim_text)).toEqual([
        imageSummary,
        textSummary,
      ]);
    });

    it('does not let a claim for event A suppress recovery of event B', () => {
      const modelOutput = sharedParagraphEvents();
      modelOutput.claims.push(existingClaim(paragraph, { claim_text: imageSummary }));

      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, paragraph);
      expect(corrected.claims.map((claim: JsonObject) => claim.claim_text)).toEqual([
        imageSummary,
        textSummary,
      ]);
    });

    it('suppresses a semantically equivalent existing claim', () => {
      const modelOutput = sharedParagraphEvents();
      modelOutput.timeline = [modelOutput.timeline[0]];
      modelOutput.claims.push(existingClaim(paragraph, { claim_text: imageSummary }));

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, paragraph).claims).toEqual(
        modelOutput.claims,
      );
    });

    it('normalizes harmless formatting when comparing existing claim meaning', () => {
      const modelOutput = sharedParagraphEvents();
      modelOutput.timeline = [modelOutput.timeline[0]];
      modelOutput.claims.push(
        existingClaim(paragraph, {
          claim_text: '  ALEX says: Maya delivered the images late!  ',
        }),
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, paragraph).claims).toEqual(
        modelOutput.claims,
      );
    });

    it.each([
      {
        dimension: 'delayed deliverable',
        eventSummary: imageSummary,
        claimText: 'Alex says Maya delivered the homepage code late.',
      },
      {
        dimension: 'actor',
        eventSummary: imageSummary,
        claimText: 'Alex says Jordan delivered the images late.',
      },
      {
        dimension: 'causal incident',
        eventSummary: imageSummary,
        claimText: 'Alex says Maya revised the images late.',
      },
      {
        dimension: 'date',
        eventSummary: 'Alex says Maya delivered the images late on May 8.',
        claimText: 'Alex says Maya delivered the images late on May 9.',
      },
      {
        dimension: 'asserted effect',
        eventSummary: 'Alex says Maya’s late image delivery delayed the launch.',
        claimText: 'Alex says Maya’s late image delivery delayed payment.',
      },
      {
        dimension: 'qualification',
        eventSummary: 'Alex says Maya allegedly delivered the images late.',
        claimText: 'Alex says Maya delivered the images late.',
      },
    ])('does not equate a materially different $dimension', ({ eventSummary, claimText }) => {
      const modelOutput = sharedParagraphEvents();
      modelOutput.timeline = [
        {
          ...modelOutput.timeline[0],
          event_summary: eventSummary,
        },
      ];
      modelOutput.claims.push(existingClaim(paragraph, { claim_text: claimText }));

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, paragraph).claims).toHaveLength(
        2,
      );
    });

    it('keeps one final claim for duplicate provider events plus one equivalent claim', () => {
      const modelOutput = sharedParagraphEvents();
      modelOutput.timeline = [
        modelOutput.timeline[0],
        {
          ...structuredClone(modelOutput.timeline[0]),
          event_id: 'event_images_duplicate',
        },
      ];
      modelOutput.claims.push(existingClaim(paragraph, { claim_text: imageSummary }));

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, paragraph).claims).toEqual(
        modelOutput.claims,
      );
    });
  });

  describe('third review finding 1: full asserted-meaning equivalence', () => {
    const narrative =
      'Maya delivered content late, revised images, and requested scope changes; Alex says these incidents caused delay.';

    function genericCausalEvent(personAInterpretation: string): JsonObject {
      return candidateFixture(narrative, {
        event_summary: 'Alex says Maya caused delay.',
        person_a_interpretation: personAInterpretation,
      });
    }

    it.each([
      {
        existing: 'Alex says Maya’s image revisions caused delay.',
        interpretation: 'Alex says Maya’s late delivery caused schedule delay.',
      },
      {
        existing: 'Alex says Maya’s scope changes caused delay.',
        interpretation: 'Alex says Maya’s late delivery caused schedule delay.',
      },
      {
        existing: 'Alex says Maya’s late delivery entirely caused schedule delay.',
        interpretation: 'Alex says Maya’s late delivery contributed only partly to schedule delay.',
      },
    ])(
      'does not suppress a distinct assertion represented by $existing',
      ({ existing, interpretation }) => {
        const modelOutput = genericCausalEvent(interpretation);
        modelOutput.claims.push(existingClaim(narrative, { claim_text: existing }));

        expect(
          applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims,
        ).toHaveLength(2);
      },
    );

    it('treats harmless formatting differences as equivalent', () => {
      const modelOutput = candidateFixture(narrative, {
        event_summary: 'Alex says Maya’s late delivery caused delay.',
        person_a_interpretation: 'Alex says Maya’s late delivery caused schedule delay.',
      });
      modelOutput.claims.push(
        existingClaim(narrative, {
          claim_text: '  alex says: maya’s late delivery caused delay! ',
        }),
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual(
        modelOutput.claims,
      );
    });

    it('suppresses a genuinely equivalent late-delivery claim', () => {
      const modelOutput = genericCausalEvent(
        'Alex says Maya’s late delivery caused schedule delay.',
      );
      modelOutput.claims.push(
        existingClaim(narrative, {
          claim_text: 'Alex says Maya’s late delivery caused delay.',
        }),
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual(
        modelOutput.claims,
      );
    });
  });

  describe('third review finding 2: conservative occurrence identity', () => {
    const narrative =
      'Maya delivered two requested content batches during the project, and Alex attributes delay to the deliveries.';

    function ambiguousEvents(): JsonObject {
      const modelOutput = candidateFixture(narrative, {
        event_id: 'event_batch_a',
        event_summary: 'Alex says Maya’s content delivery caused delay.',
        person_a_interpretation: 'Alex says the content delivery caused schedule delay.',
        source_evidence_ids: ['ev_batch_a'],
      });
      modelOutput.evidence = [{ evidence_id: 'ev_batch_a' }, { evidence_id: 'ev_batch_b' }];
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_id: 'event_batch_b',
        source_evidence_ids: ['ev_batch_b'],
      });
      return modelOutput;
    }

    it('preserves same-paragraph real incidents with distinct evidence support', () => {
      const corrected = applyDryRun001ClA003CompatibilityRecovery(ambiguousEvents(), narrative);
      expect(corrected.claims).toHaveLength(2);
      expect(corrected.claims.map((claim: JsonObject) => claim.supporting_evidence_ids)).toEqual([
        ['ev_batch_a'],
        ['ev_batch_b'],
      ]);
    });

    it('does not let identical typed dates force ambiguous incidents to merge', () => {
      const modelOutput = ambiguousEvents();
      for (const event of modelOutput.timeline) {
        event.date = {
          start: '2024-05-08',
          end: '2024-05-08',
          precision: 'day',
          approximate: false,
        };
      }

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        2,
      );
    });

    it('does not let unknown dates force ambiguous incidents to merge', () => {
      const corrected = applyDryRun001ClA003CompatibilityRecovery(ambiguousEvents(), narrative);
      expect(corrected.claims).toHaveLength(2);
    });

    it('does not merge different evidence support solely because provider identity is reused', () => {
      const modelOutput = ambiguousEvents();
      modelOutput.timeline[1].event_id = modelOutput.timeline[0].event_id;

      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
      expect(corrected.claims).toHaveLength(2);
      expect(corrected.claims.map((claim: JsonObject) => claim.supporting_evidence_ids)).toEqual([
        ['ev_batch_a'],
        ['ev_batch_b'],
      ]);
    });

    it('merges exact provider duplicates with reordered evidence deterministically', () => {
      const modelOutput = ambiguousEvents();
      modelOutput.timeline[0].source_evidence_ids = ['ev_batch_b', 'ev_batch_a'];
      modelOutput.timeline[1].event_id = modelOutput.timeline[0].event_id;
      modelOutput.timeline[1].source_evidence_ids = ['ev_batch_a', 'ev_batch_b'];

      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
      expect(corrected.claims).toHaveLength(1);
      expect(corrected.claims[0].supporting_evidence_ids).toEqual(['ev_batch_a', 'ev_batch_b']);
    });

    it('preserves ambiguous provider entries rather than treating matching text as proof', () => {
      const corrected = applyDryRun001ClA003CompatibilityRecovery(ambiguousEvents(), narrative);
      expect(corrected.claims.map((claim: JsonObject) => claim.claim_id)).toEqual([
        'claim_event_batch_a_client_delay',
        'claim_event_batch_b_client_delay',
      ]);
    });
  });

  describe('third review finding 3: copied source text', () => {
    const quote = 'Maya delivered the content late and it directly contributed to delay.';
    const narrative = `${quote}\n\nQuoted email:\n> ${quote}`;

    function repeatedCopyEvents(secondEventId: string): JsonObject {
      const modelOutput = candidateFixture(narrative, {
        event_id: 'event_copied_delivery',
        quote,
      });
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_id: secondEventId,
        source_spans: [exactSpan(narrative, quote, 1)],
      });
      return modelOutput;
    }

    it('preserves reused-ID rows grounded at different copies as an unresolved collision', () => {
      const corrected = applyDryRun001ClA003CompatibilityRecovery(
        repeatedCopyEvents('event_copied_delivery'),
        narrative,
      );
      expect(corrected.claims).toHaveLength(2);
      expect(corrected.claims.flatMap((claim: JsonObject) => claim.source_spans)).toEqual([
        exactSpan(narrative, quote, 0),
        exactSpan(narrative, quote, 1),
      ]);
      expect(
        corrected.claims
          .flatMap((claim: JsonObject) => claim.source_spans)
          .every(
            (span: JsonObject) => narrative.slice(span.start_char, span.end_char) === span.quote,
          ),
      ).toBe(true);
    });

    it('keeps genuinely repeated incidents distinct when typed dates differ', () => {
      const modelOutput = repeatedCopyEvents('event_copied_delivery');
      modelOutput.timeline[0].date = {
        start: '2024-05-08',
        end: '2024-05-08',
        precision: 'day',
        approximate: false,
      };
      modelOutput.timeline[1].date = {
        start: '2024-05-09',
        end: '2024-05-09',
        precision: 'day',
        approximate: false,
      };

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        2,
      );
    });

    it('preserves ambiguous repeated wording when provider identity differs', () => {
      const corrected = applyDryRun001ClA003CompatibilityRecovery(
        repeatedCopyEvents('event_second_delivery'),
        narrative,
      );
      expect(corrected.claims).toHaveLength(2);
      expect(corrected.claims.flatMap((claim: JsonObject) => claim.source_spans)).toEqual([
        exactSpan(narrative, quote, 0),
        exactSpan(narrative, quote, 1),
      ]);
    });
  });

  describe('fourth review finding 1: duplicate timeline IDs', () => {
    it('consolidates exact duplicate timeline rows before full assembly validation', async () => {
      const { narrative, modelOutput } = await frozenInputs();
      const sourceEvent = modelOutput.timeline.find(
        (event: JsonObject) => event.event_id === 'event_04_major_batch',
      );
      modelOutput.timeline.push(structuredClone(sourceEvent));

      const corrected = assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
        narrative,
        submittedAt,
        model,
        generatedAt,
      });
      expect(
        corrected.timeline.filter((event: JsonObject) => event.event_id === 'event_04_major_batch'),
      ).toHaveLength(1);
      expect(
        corrected.claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
      expect(validatePersonAExtraction(corrected, narrative).valid).toBe(true);
    });

    it('consolidates exact duplicate rows whose evidence IDs are merely reordered', async () => {
      const { narrative, modelOutput } = await frozenInputs();
      const sourceEvent = modelOutput.timeline.find(
        (event: JsonObject) => event.event_id === 'event_04_major_batch',
      );
      sourceEvent.source_evidence_ids = ['ev_03_client_content', 'ev_01_signed_agreement'];
      const duplicate = structuredClone(sourceEvent);
      duplicate.source_evidence_ids.reverse();
      modelOutput.timeline.push(duplicate);

      const corrected = assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
        narrative,
        submittedAt,
        model,
        generatedAt,
      });
      expect(
        corrected.timeline.filter((event: JsonObject) => event.event_id === 'event_04_major_batch'),
      ).toHaveLength(1);
      expect(
        corrected.claims.find(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        )?.supporting_evidence_ids,
      ).toEqual(['ev_01_signed_agreement', 'ev_03_client_content']);
      expect(validatePersonAExtraction(corrected, narrative).valid).toBe(true);
    });

    it.each([
      {
        label: 'materially different summary',
        mutate: (event: JsonObject) => {
          event.event_summary =
            'Alex says Maya’s later image revisions separately contributed to delay.';
          event.person_a_interpretation =
            'Alex treats the later image revisions as directly contributing to schedule delay.';
        },
      },
      {
        label: 'different date',
        mutate: (event: JsonObject) => {
          event.date = {
            start: '2024-05-09',
            end: '2024-05-09',
            precision: 'day',
            approximate: false,
          };
        },
      },
      {
        label: 'different source occurrence',
        mutate: (event: JsonObject, narrative: string) => {
          event.source_spans = [exactSpan(narrative, fullGoldenSupportingQuote)];
        },
      },
      {
        label: 'different evidence support',
        mutate: (event: JsonObject) => {
          event.source_evidence_ids = ['ev_01_signed_agreement'];
        },
      },
    ])('preserves honest validation failure for a reused ID with $label', async ({ mutate }) => {
      const { narrative, modelOutput } = await frozenInputs();
      const sourceEvent = modelOutput.timeline.find(
        (event: JsonObject) => event.event_id === 'event_04_major_batch',
      );
      const conflicting = structuredClone(sourceEvent);
      mutate(conflicting, narrative);
      modelOutput.timeline.push(conflicting);

      expect(() =>
        assemblePersonAExtraction(modelOutput, {
          narrative,
          submittedAt,
          model,
          generatedAt,
        }),
      ).toThrow(/duplicate|unique|event_04_major_batch/iu);
    });

    it('does not merge evidence or suppress recovery for an unresolved reused ID', () => {
      const narrative =
        'Maya delivered two requested content batches and Alex says each separately caused delay.';
      const modelOutput = candidateFixture(narrative, {
        event_id: 'event_reused',
        event_summary: 'Alex says Maya’s first content batch caused delay.',
        person_a_interpretation:
          'Alex says Maya’s first content batch directly caused schedule delay.',
        source_evidence_ids: ['ev_batch_a'],
      });
      modelOutput.evidence = [{ evidence_id: 'ev_batch_a' }, { evidence_id: 'ev_batch_b' }];
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_summary: 'Alex says Maya’s second content batch caused delay.',
        person_a_interpretation:
          'Alex says Maya’s second content batch directly caused schedule delay.',
        source_evidence_ids: ['ev_batch_b'],
      });

      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
      expect(corrected.timeline).toHaveLength(2);
      expect(corrected.claims).toHaveLength(2);
      expect(corrected.claims.map((claim: JsonObject) => claim.supporting_evidence_ids)).toEqual([
        ['ev_batch_a'],
        ['ev_batch_b'],
      ]);
    });
  });

  describe('fourth review finding 2: incident occurrence polarity', () => {
    const narrative =
      'Maya did not deliver by May, later delivered late in May, and only partially delivered another batch; Alex attributes delay to each incident.';

    function expectDistinctFromExisting(
      eventSummary: string,
      interpretation: string,
      claimText: string,
    ): void {
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
      });
      modelOutput.claims.push(existingClaim(narrative, { claim_text: claimText }));
      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        2,
      );
    }

    it('distinguishes not delivered by May from delivered late in May', () => {
      expectDistinctFromExisting(
        'Alex says Maya did not deliver the content by May.',
        'Alex says the content not being delivered by May caused schedule delay.',
        'Alex says Maya delivered the content late in May, causing schedule delay.',
      );
    });

    it('distinguishes never delivered from delivered late', () => {
      expectDistinctFromExisting(
        'Alex says Maya never delivered the content.',
        'Alex says the content never being delivered caused schedule delay.',
        'Alex says Maya delivered the content late, causing schedule delay.',
      );
    });

    it.each([
      'Alex says Maya delivered the content late, causing schedule delay.',
      'Alex says Maya did not deliver the content by May, causing schedule delay.',
    ])('distinguishes partial delivery from %s', (claimText) => {
      expectDistinctFromExisting(
        'Alex says Maya partially delivered the content.',
        'Alex says the partial content delivery caused schedule delay.',
        claimText,
      );
    });

    it.each([
      {
        eventSummary: 'Alex says Maya delivered the content after the deadline.',
        interpretation: 'Alex says Maya’s late content delivery caused schedule delay.',
        claimText: 'alex says maya delivered the content late, causing delay.',
      },
      {
        eventSummary: 'Alex says Maya did not deliver the content by May.',
        interpretation: 'Alex says the missing May delivery caused schedule delay.',
        claimText: 'alex says maya failed to deliver the content by may, causing delay.',
      },
    ])(
      'treats harmless $eventSummary paraphrasing as equivalent',
      ({ eventSummary, interpretation, claimText }) => {
        const modelOutput = candidateFixture(narrative, {
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        });
        modelOutput.claims.push(existingClaim(narrative, { claim_text: claimText }));

        expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual(
          modelOutput.claims,
        );
      },
    );

    it.each([
      {
        eventSummary: 'Alex says it is unclear whether Maya delivered the content.',
        interpretation:
          'Alex says the absence of confirmed delivery directly caused schedule delay.',
        claimText: 'Alex says Maya delivered the content late, causing schedule delay.',
      },
      {
        eventSummary: 'Alex says it is disputed that Maya delivered the content.',
        interpretation:
          'Alex says the absence of confirmed delivery directly caused schedule delay.',
        claimText: 'Alex says Maya delivered the content late, causing schedule delay.',
      },
    ])(
      'keeps $eventSummary distinct from a completed late delivery',
      ({ eventSummary, interpretation, claimText }) => {
        expectDistinctFromExisting(eventSummary, interpretation, claimText);
      },
    );

    it('preserves material temporal relations for otherwise late deliveries', () => {
      expectDistinctFromExisting(
        'Alex says Maya delivered the content after May.',
        'Alex says Maya’s delivery after May caused schedule delay.',
        'Alex says Maya delivered the content late in May, causing schedule delay.',
      );
    });
  });

  describe('fourth review finding 3: incident negation versus causal negation', () => {
    it.each([
      'Alex says Maya did not send the content, which caused schedule delay.',
      'Alex says the files were never delivered, resulting in delay.',
    ])('promotes a negated incident with direct causation in %s', (personAInterpretation) => {
      const narrative = personAInterpretation;
      const modelOutput = candidateFixture(narrative, {
        event_summary: personAInterpretation,
        person_a_interpretation: personAInterpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it.each([
      'Alex says Maya did not cause the delay.',
      'Alex says the missing content did not contribute to delay.',
      'Alex reports that Maya denied the missing content caused delay.',
      'Alex says Maya did not send the content; whether this caused delay is unclear.',
    ])('rejects non-asserted causal meaning in %s', (personAInterpretation) => {
      const narrative = personAInterpretation;
      const modelOutput = candidateFixture(narrative, {
        event_summary: personAInterpretation,
        person_a_interpretation: personAInterpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });
  });

  describe('fourth review finding 4: typed-first actor relationships', () => {
    const narrative =
      'According to Alex, Maya delivered the content late during May and caused schedule delay.';

    it.each([
      {
        eventSummary: 'According to Alex, Maya delivered the content late.',
        claimText: 'Alex says Maya delivered the content late.',
      },
      {
        eventSummary: 'Based on Alex’s account, Maya delivered the content late.',
        claimText: 'Alex says Maya delivered the content late.',
      },
      {
        eventSummary: 'During May, Alex says Maya delivered the content late.',
        claimText: 'Alex says Maya delivered the content late during May.',
      },
    ])(
      'does not create a fake actor from sentence-openers in $eventSummary',
      ({ eventSummary, claimText }) => {
        const modelOutput = candidateFixture(narrative, {
          event_summary: eventSummary,
          person_a_interpretation:
            'Alex says Maya’s late content delivery directly caused schedule delay.',
        });
        modelOutput.claims.push(existingClaim(narrative, { claim_text: claimText }));

        expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual(
          modelOutput.claims,
        );
      },
    );

    it('preserves actual actor distinctions', () => {
      const modelOutput = candidateFixture(narrative, {
        event_summary: 'According to Alex, Maya delivered the content late.',
        person_a_interpretation:
          'Alex says Maya’s late content delivery directly caused schedule delay.',
      });
      modelOutput.claims.push(
        existingClaim(narrative, {
          claim_text: 'Alex says Jordan delivered the content late.',
        }),
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        2,
      );
    });

    it('uses an explicit organization action-subject without adding the sentence-opener', () => {
      const modelOutput = candidateFixture(narrative, {
        event_summary: 'According to Alex, Acme LLC delivered the content late.',
        person_a_interpretation:
          'Alex says Acme LLC’s late content delivery directly caused schedule delay.',
      });
      modelOutput.claims.push(
        existingClaim(narrative, {
          claim_text: 'Alex says Acme LLC delivered the content late.',
        }),
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual(
        modelOutput.claims,
      );
    });
  });

  describe('fifth review finding 1: candidate-clause causal binding', () => {
    it.each([
      'Maya delivered late; a server outage caused the schedule delay.',
      'Maya delivered late — Alex’s revisions caused the schedule delay.',
      'Maya delivered late (a hosting failure caused the schedule delay).',
      'Maya delivered late. A server outage caused the schedule delay.',
      'Maya delivered late\nA server outage caused the schedule delay.',
      'Maya delivered late, and a server outage caused the schedule delay.',
    ])('does not borrow causation from another causal unit in %s', (interpretation) => {
      const narrative = interpretation;
      const modelOutput = candidateFixture(narrative, {
        event_summary: 'Alex says Maya delivered the content late.',
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      'Maya delivered late, causing schedule delay.',
      'Maya’s late delivery caused schedule delay.',
      'The schedule delay resulted from Maya’s late delivery.',
      'Maya did not send the files, which caused schedule delay.',
    ])('keeps direct same-unit causation in %s', (interpretation) => {
      const narrative = interpretation;
      const modelOutput = candidateFixture(narrative, {
        event_summary: interpretation,
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });
  });

  describe('fifth review finding 2: compositional delivery states', () => {
    const narrative =
      'Maya partially delivered content before, by, and after the deadline; Alex attributes different delay effects to those delivery states.';

    function withExistingClaim(
      eventSummary: string,
      interpretation: string,
      claimText: string,
    ): JsonObject {
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
      });
      modelOutput.claims.push(existingClaim(narrative, { claim_text: claimText }));
      return applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
    }

    it('preserves both partial and late state after the deadline', () => {
      const corrected = withExistingClaim(
        'Alex says Maya partially delivered the content after the deadline.',
        'Alex says Maya’s partial delivery after the deadline caused schedule delay.',
        'Alex says Maya partially delivered the content, causing schedule delay.',
      );
      expect(corrected.claims).toHaveLength(2);
    });

    it('does not equate a partial-and-late delivery with a late-only delivery', () => {
      const corrected = withExistingClaim(
        'Alex says Maya partially delivered the content after the deadline.',
        'Alex says Maya’s partial delivery after the deadline caused schedule delay.',
        'Alex says Maya delivered the content late, causing schedule delay.',
      );
      expect(corrected.claims).toHaveLength(2);
    });

    it('keeps partial delivery by the deadline partial without adding lateness', () => {
      const corrected = withExistingClaim(
        'Alex says Maya partially delivered the content by the deadline.',
        'Alex says Maya’s partial delivery by the deadline caused schedule delay.',
        'Alex says Maya delivered the content late, causing schedule delay.',
      );
      expect(corrected.claims).toHaveLength(2);
    });

    it.each([
      {
        eventSummary: 'Alex says Maya partially delivered the content before the deadline.',
        interpretation:
          'Alex says Maya’s partial delivery before the deadline caused schedule delay.',
        claimText:
          'Alex says Maya partially delivered the content by the deadline, causing schedule delay.',
      },
      {
        eventSummary: 'Alex says Maya partially delivered the content.',
        interpretation: 'Alex says Maya’s partial delivery caused schedule delay.',
        claimText:
          'Alex says Maya partially delivered the content by the deadline, causing schedule delay.',
      },
    ])(
      'preserves explicit temporal meaning in $eventSummary',
      ({ eventSummary, interpretation, claimText }) => {
        expect(withExistingClaim(eventSummary, interpretation, claimText).claims).toHaveLength(2);
      },
    );

    it.each([
      {
        label: 'late-only',
        eventSummary: 'Alex says Maya delivered the content late.',
        interpretation: 'Alex says Maya’s late delivery caused schedule delay.',
        claimText: 'Alex says Maya partially delivered the content, causing schedule delay.',
      },
      {
        label: 'partial-only',
        eventSummary: 'Alex says Maya partially delivered the content.',
        interpretation: 'Alex says Maya’s partial delivery caused schedule delay.',
        claimText: 'Alex says Maya delivered the content late, causing schedule delay.',
      },
    ])(
      'preserves the $label state independently',
      ({ eventSummary, interpretation, claimText }) => {
        expect(withExistingClaim(eventSummary, interpretation, claimText).claims).toHaveLength(2);
      },
    );

    it.each([
      {
        eventSummary: 'Alex says Maya partially delivered the content after the deadline.',
        interpretation: 'Alex says Maya’s partial late delivery caused schedule delay.',
        claimText:
          'alex says maya delivered only part of the content late, causing schedule delay.',
      },
      {
        eventSummary: 'Alex says Maya partially delivered the content by the deadline.',
        interpretation: 'Alex says Maya’s partial on-time delivery caused schedule delay.',
        claimText:
          'alex says maya delivered only part of the content by the deadline, causing schedule delay.',
      },
    ])(
      'treats harmless compositional paraphrasing as equivalent for $eventSummary',
      ({ eventSummary, interpretation, claimText }) => {
        const corrected = withExistingClaim(eventSummary, interpretation, claimText);
        expect(corrected.claims).toHaveLength(1);
        expect(corrected.claims[0].claim_id).toBe('claim_existing');
      },
    );
  });

  describe('fifth review finding 3: exact duplicate span ordering', () => {
    const firstQuote = 'Maya delivered the content late.';
    const secondQuote = 'Alex says the late delivery caused schedule delay.';
    const narrative = `${firstQuote}\n${secondQuote}`;

    function multiSpanDuplicate(): JsonObject {
      const modelOutput = candidateFixture(narrative, {
        event_summary: 'Alex says Maya delivered the content late.',
        person_a_interpretation: 'Alex says Maya’s late delivery directly caused schedule delay.',
        source_spans: [exactSpan(narrative, firstQuote), exactSpan(narrative, secondQuote)],
        source_evidence_ids: ['ev_client_content', 'ev_follow_up'],
      });
      modelOutput.evidence.push({ evidence_id: 'ev_follow_up' });
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        source_spans: structuredClone(modelOutput.timeline[0].source_spans).reverse(),
      });
      return modelOutput;
    }

    it('consolidates identical multi-span rows whose spans are reversed', () => {
      const corrected = applyDryRun001ClA003CompatibilityRecovery(multiSpanDuplicate(), narrative);
      expect(corrected.timeline).toHaveLength(1);
      expect(corrected.claims).toHaveLength(1);
      expect(corrected.timeline[0].source_spans).toEqual([
        exactSpan(narrative, firstQuote),
        exactSpan(narrative, secondQuote),
      ]);
    });

    it('consolidates reversed evidence and source-span ordering together', () => {
      const modelOutput = multiSpanDuplicate();
      modelOutput.timeline[1].source_evidence_ids.reverse();

      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
      expect(corrected.timeline).toHaveLength(1);
      expect(corrected.claims[0].supporting_evidence_ids).toEqual([
        'ev_client_content',
        'ev_follow_up',
      ]);
    });

    it('keeps a full assembled extraction valid after multi-span order consolidation', async () => {
      const { narrative: frozenNarrative, modelOutput } = await frozenInputs();
      const sourceEvent = modelOutput.timeline.find(
        (event: JsonObject) => event.event_id === 'event_04_major_batch',
      );
      const supportingEvent = modelOutput.timeline.find(
        (event: JsonObject) => event.event_id === 'event_03_content_late',
      );
      sourceEvent.source_spans.push(structuredClone(supportingEvent.source_spans[0]));
      const duplicate = structuredClone(sourceEvent);
      duplicate.source_spans.reverse();
      modelOutput.timeline.push(duplicate);

      const corrected = assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
        narrative: frozenNarrative,
        submittedAt,
        model,
        generatedAt,
      });
      expect(
        corrected.timeline.filter((event: JsonObject) => event.event_id === sourceEvent.event_id),
      ).toHaveLength(1);
      expect(validatePersonAExtraction(corrected, frozenNarrative).valid).toBe(true);
    });

    it.each([
      {
        label: 'different span membership',
        mutate: (span: JsonObject, event: JsonObject) => {
          event.source_spans = [span];
        },
      },
      {
        label: 'same coordinates with a different quote',
        mutate: (span: JsonObject) => {
          span.quote = `${span.quote} `;
        },
      },
      {
        label: 'same quote with different coordinates',
        mutate: (span: JsonObject) => {
          span.start_char += 1;
          span.end_char += 1;
        },
      },
      {
        label: 'different submission',
        mutate: (span: JsonObject) => {
          span.submission_id = 'submission_other';
        },
      },
    ])('does not consolidate rows with $label', ({ mutate }) => {
      const modelOutput = multiSpanDuplicate();
      const event = modelOutput.timeline[1];
      mutate(event.source_spans[0], event);

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).timeline,
      ).toHaveLength(2);
    });
  });

  describe('fifth review finding 4: authoritative typed asserters', () => {
    const narrative =
      'Alex attributes schedule delay to Maya’s late delivery, as reflected in project documents.';

    it.each([
      'The Project Plan reports that Maya’s late delivery caused schedule delay.',
      'The Contract states that Maya delivered late and caused schedule delay.',
      'The Email says Maya’s late delivery caused schedule delay.',
    ])('does not treat document language as an asserter in %s', (eventSummary) => {
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: eventSummary,
      });
      modelOutput.claims.push(
        existingClaim(narrative, {
          claim_text: 'Alex says Maya’s late delivery caused schedule delay.',
        }),
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual(
        modelOutput.claims,
      );
    });

    it('keeps typed party_a authoritative despite document-language noise', () => {
      const modelOutput = candidateFixture(narrative, {
        event_summary:
          'The Project Plan reports that Maya delivered late; Alex says this caused schedule delay.',
        person_a_interpretation: 'Alex says Maya’s late delivery directly caused schedule delay.',
      });
      modelOutput.claims.push(
        existingClaim(narrative, {
          claim_text: 'According to Alex, Maya’s late delivery caused schedule delay.',
        }),
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual(
        modelOutput.claims,
      );
    });

    it('resolves Alex’s email to typed party_a without treating email as an asserter', () => {
      const modelOutput = candidateFixture(narrative, {
        event_summary: 'Alex’s email states that Maya’s late delivery caused schedule delay.',
        person_a_interpretation: 'Alex says Maya’s late delivery directly caused schedule delay.',
      });
      modelOutput.claims.push(
        existingClaim(narrative, {
          claim_text: 'Alex says Maya’s late delivery caused schedule delay.',
        }),
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual(
        modelOutput.claims,
      );
    });

    it('keeps actual actors distinct under typed party_a', () => {
      const modelOutput = candidateFixture(narrative, {
        event_summary: 'The Email says Maya’s late delivery caused schedule delay.',
        person_a_interpretation: 'Alex says Maya’s late delivery directly caused schedule delay.',
      });
      modelOutput.claims.push(
        existingClaim(narrative, {
          claim_text: 'Alex says Jordan’s late delivery caused schedule delay.',
        }),
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        2,
      );
    });
  });

  describe('review finding 3: canonical generated-ID registry', () => {
    const stem = 'claim_event_candidate_client_delay';

    it.each([
      {
        label: 'timeline event',
        addCollision: (modelOutput: JsonObject) =>
          modelOutput.timeline.push({
            ...structuredClone(modelOutput.timeline[0]),
            event_id: stem,
          }),
      },
      {
        label: 'evidence',
        addCollision: (modelOutput: JsonObject) => modelOutput.evidence.push({ evidence_id: stem }),
      },
      {
        label: 'agreement term',
        addCollision: (modelOutput: JsonObject) => {
          modelOutput.agreement = { terms: [{ term_id: stem }] };
        },
      },
      {
        label: 'claim',
        addCollision: (modelOutput: JsonObject) =>
          modelOutput.claims.push(
            existingClaim('Maya delivered the content late and it directly contributed to delay.', {
              claim_id: stem,
              claim_type: 'payment',
              source_spans: [],
            }),
          ),
      },
    ])('suffixes past a collision with a $label ID', ({ addCollision }) => {
      const narrative = 'Maya delivered the content late and it directly contributed to delay.';
      const modelOutput = candidateFixture(narrative);
      addCollision(modelOutput);

      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
      expect(corrected.claims.some((claim: JsonObject) => claim.claim_id === `${stem}_2`)).toBe(
        true,
      );
    });

    it('advances deterministically through sequential cross-family collisions', () => {
      const narrative = 'Maya delivered the content late and it directly contributed to delay.';
      const modelOutput = candidateFixture(narrative);
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_id: stem,
      });
      modelOutput.evidence.push({ evidence_id: `${stem}_2` });
      modelOutput.agreement = { terms: [{ term_id: `${stem}_3` }] };
      modelOutput.claims.push(
        existingClaim(narrative, {
          claim_id: `${stem}_4`,
          claim_type: 'payment',
          source_spans: [],
        }),
      );

      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
      expect(corrected.claims.some((claim: JsonObject) => claim.claim_id === `${stem}_5`)).toBe(
        true,
      );
    });

    it('keeps a full assembled extraction valid when another family owns the stem', async () => {
      const { narrative, modelOutput } = await frozenInputs();
      const frozenStem = 'claim_event_04_major_batch_client_delay';
      modelOutput.clarification_questions[0].question_id = frozenStem;

      const corrected = assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
        narrative,
        submittedAt,
        model,
        generatedAt,
      });
      expect(
        corrected.claims.some((claim: JsonObject) => claim.claim_id === `${frozenStem}_2`),
      ).toBe(true);
      expect(validatePersonAExtraction(corrected, narrative).valid).toBe(true);
    });
  });

  describe('sixth review finding 1: frozen compatibility boundary', () => {
    it('keeps recovery unreachable from the production extractor module', async () => {
      const productionExtractor = await readFile(
        resolve(root, 'src/extraction/person-a-extractor.ts'),
        'utf8',
      );

      expect(productionExtractor).not.toMatch(
        /applyDryRun001ClA003CompatibilityRecovery|person-a-frozen-compatibility/u,
      );
    });

    it('leaves the frozen provider omission visible in ordinary production assembly', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      const assembled = assemblePersonAExtraction(modelOutput, {
        narrative,
        submittedAt,
        model,
        generatedAt,
      });

      expect(
        assembled.claims.some(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toBe(false);
    });

    it('does not promote the frozen omission through the fresh extraction entrypoint', async () => {
      const { narrative, modelOutput } = await frozenInputs();
      const generated = await extractPersonA({
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

      expect(
        generated.extraction.claims.some(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toBe(false);
      expect(generated.modelOutput).toEqual(modelOutput);
    });

    it('applies the compatibility projection only when explicitly invoked and does not mutate input', async () => {
      const { narrative, modelOutput } = await frozenInputs();
      const before = structuredClone(modelOutput);

      const projected = assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
        narrative,
        submittedAt,
        model,
        generatedAt,
      });
      const replayed = assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
        narrative,
        submittedAt,
        model,
        generatedAt,
      });

      expect(
        projected.claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(projected));
      expect(modelOutput).toEqual(before);
    });

    it('keeps exact duplicate provider timeline IDs as an honest production validation failure', async () => {
      const { narrative, modelOutput } = await frozenInputs();
      const sourceEvent = modelOutput.timeline.find(
        (event: JsonObject) => event.event_id === 'event_04_major_batch',
      );
      modelOutput.timeline.push(structuredClone(sourceEvent));

      expect(() =>
        assemblePersonAExtraction(modelOutput, {
          narrative,
          submittedAt,
          model,
          generatedAt,
        }),
      ).toThrow(/duplicate|unique|event_04_major_batch/iu);
    });
  });

  describe('sixth review finding 2: attached parenthetical causation', () => {
    it.each([
      'Maya’s late delivery (which caused schedule delay).',
      'Maya’s late delivery (which contributed to schedule delay).',
      'Maya’s late delivery (resulting in schedule delay).',
      'Maya’s late delivery (thereby causing schedule delay).',
    ])('binds an attached relative causal clause in %s', (interpretation) => {
      const narrative = interpretation;
      const modelOutput = candidateFixture(narrative, {
        event_summary: 'Alex says Maya delivered the content late.',
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it.each([
      'Maya delivered late (a server outage caused schedule delay).',
      'Maya delivered late (Alex’s revisions contributed to schedule delay).',
      'Maya delivered late and a server outage (which caused schedule delay).',
      'Maya delivered late ((which caused schedule delay).',
      'Maya delivered late (which caused schedule delay)).',
    ])('does not bind an independent or malformed parenthetical in %s', (interpretation) => {
      const narrative = interpretation;
      const modelOutput = candidateFixture(narrative, {
        event_summary: 'Alex says Maya delivered the content late.',
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });
  });

  describe('sixth review finding 3: coordinated-predicate subject continuity', () => {
    it.each([
      'Maya delivered the content late and caused schedule delay.',
      'Maya delivered the content late and directly caused schedule delay.',
      'Maya failed to deliver the content and caused schedule delay.',
      'Maya delivered the content late and contributed to schedule delay.',
      'Maya delivered the files late, contributing to schedule delay.',
      'Maya did not send the content and caused schedule delay.',
    ])('preserves a shared incident subject in %s', (interpretation) => {
      const narrative = interpretation;
      const modelOutput = candidateFixture(narrative, {
        event_summary: interpretation,
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it.each([
      'Maya delivered late, and the server outage caused schedule delay.',
      'Maya delivered late, but Alex’s revisions caused schedule delay.',
    ])(
      'does not carry the subject into a new-subject coordinated clause in %s',
      (interpretation) => {
        const narrative = interpretation;
        const modelOutput = candidateFixture(narrative, {
          event_summary: 'Alex says Maya delivered the content late.',
          person_a_interpretation: interpretation,
        });

        expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual(
          [],
        );
      },
    );
  });

  describe('sixth review finding 4: specific occurrence binding', () => {
    it.each([
      {
        label: 'May versus June delivery',
        eventSummary: 'Alex says Maya delivered the content late in June.',
        interpretation: 'Alex says Maya’s delivery of the content in May caused schedule delay.',
      },
      {
        label: 'first versus revised delivery',
        eventSummary: 'Alex says Maya’s first content delivery was late.',
        interpretation: 'Alex says Maya’s revised content delivery caused schedule delay.',
      },
      {
        label: 'partial versus later complete delivery',
        eventSummary: 'Alex says Maya partially delivered the content.',
        interpretation: 'Alex says Maya’s later complete delivery caused schedule delay.',
      },
      {
        label: 'missed May deadline versus late June submission',
        eventSummary: 'Alex says Maya did not deliver the content by May.',
        interpretation: 'Alex says Maya’s late June submission caused schedule delay.',
      },
      {
        label: 'same actor and object with conflicting dates',
        eventSummary: 'Alex says Maya delivered the content on May 8.',
        interpretation: 'Alex says Maya’s content delivery on May 9 caused schedule delay.',
      },
      {
        label: 'different deliverables',
        eventSummary: 'Alex says Maya delivered the content late.',
        interpretation: 'Alex says Maya’s image delivery caused schedule delay.',
      },
    ])(
      'rejects causation attached to another occurrence: $label',
      ({ eventSummary, interpretation }) => {
        const narrative = `${eventSummary} ${interpretation}`;
        const modelOutput = candidateFixture(narrative, {
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        });

        expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual(
          [],
        );
      },
    );

    it('rejects an interpretation that conflicts with the typed event date', () => {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const interpretation = 'Alex says Maya’s May content delivery caused schedule delay.';
      const narrative = `${eventSummary} ${interpretation}`;
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
        date: {
          start: '2024-06-08',
          end: '2024-06-08',
          precision: 'day',
          approximate: false,
        },
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      {
        label: 'equivalent dated paraphrase',
        eventSummary: 'Alex says Maya delivered the content late in May.',
        interpretation: 'Alex says Maya’s May content delivery caused schedule delay.',
      },
      {
        label: 'exact local incident without temporal data',
        eventSummary: 'Alex says Maya’s late content delivery affected the schedule.',
        interpretation: 'Alex says Maya’s late content delivery caused schedule delay.',
      },
    ])(
      'accepts causation bound to the same occurrence: $label',
      ({ eventSummary, interpretation }) => {
        const narrative = `${eventSummary} ${interpretation}`;
        const modelOutput = candidateFixture(narrative, {
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        });

        expect(
          applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims,
        ).toHaveLength(1);
      },
    );
  });

  describe('seventh review finding 1: parenthetical antecedent selection', () => {
    it.each([
      {
        label: 'named coordinated subject',
        interpretation:
          'Maya delivered the content late and Jordan’s content delivery (which caused schedule delay).',
      },
      {
        label: 'possessive named subject',
        interpretation:
          'Maya delivered the content late while Alex’s revisions (which caused schedule delay) continued.',
      },
      {
        label: 'typed different actor',
        interpretation:
          'Alex says Maya delivered the content late and Jordan’s delivery (which caused schedule delay) followed.',
      },
      {
        label: 'article-led new subject',
        interpretation:
          'Maya delivered the content late and a server outage (which caused schedule delay) followed.',
      },
      {
        label: 'named organization subject',
        interpretation:
          'Maya delivered the content late and Acme LLC’s migration (which caused schedule delay) followed.',
      },
    ])('does not attach causation from a $label', ({ interpretation }) => {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it('attaches a possessive relative clause to the same actor and incident', () => {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const interpretation = 'Maya’s late delivery (which caused schedule delay).';
      const narrative = `${eventSummary} ${interpretation}`;
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves a coordinated possessive antecedent for the same actor', () => {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const interpretation =
        'Maya delivered the content late and Maya’s late delivery (which caused schedule delay).';
      const narrative = `${eventSummary} ${interpretation}`;
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });
  });

  describe('seventh review finding 2: coordinated subjects with modifiers', () => {
    it.each([
      {
        label: 'named subject with a comma-delimited modifier',
        interpretation:
          'Maya delivered content late, and Jordan, after a long review, caused schedule delay.',
      },
      {
        label: 'article-led subject with a modifier',
        interpretation:
          'Maya delivered content late, but the server, following an outage, caused schedule delay.',
      },
      {
        label: 'possessive subject with a modifier',
        interpretation:
          'Maya delivered content late, and Jordan’s delivery, after review, caused schedule delay.',
      },
      {
        label: 'new subject after and',
        interpretation:
          'Maya delivered content late, and Jordan, unexpectedly, caused schedule delay.',
      },
      {
        label: 'new subject after but',
        interpretation:
          'Maya delivered content late, but Jordan, independently, caused schedule delay.',
      },
    ])('splits a $label', ({ interpretation }) => {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      'Maya delivered content late and directly caused schedule delay.',
      'Maya delivered content late and, as a result, caused schedule delay.',
      'Maya delivered content late and, after review, contributed to schedule delay.',
    ])('preserves shared-subject causation: %s', (interpretation) => {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });
  });

  describe('seventh review finding 3: fail-closed temporal conflicts', () => {
    it.each([
      {
        label: 'matching month plus conflicting typed date',
        eventSummary: 'Alex says Maya delivered the content late in May.',
        interpretation: 'Alex says Maya’s May content delivery caused schedule delay.',
        date: {
          start: '2024-06-08',
          end: '2024-06-08',
          precision: 'day',
          approximate: false,
        },
      },
      {
        label: 'matching year plus conflicting month',
        eventSummary: 'Alex says Maya delivered the content late in May 2024.',
        interpretation: 'Alex says Maya’s May 2024 content delivery caused schedule delay.',
        date: {
          start: '2024-06-08',
          end: '2024-06-08',
          precision: 'day',
          approximate: false,
        },
      },
      {
        label: 'exact typed date versus conflicting named period',
        eventSummary: 'Alex says Maya delivered the content late.',
        interpretation: 'Alex says Maya’s May 2024 content delivery caused schedule delay.',
        date: {
          start: '2024-06-08',
          end: '2024-06-08',
          precision: 'day',
          approximate: false,
        },
      },
    ])('rejects $label', ({ eventSummary, interpretation, date }) => {
      const narrative = `${eventSummary} ${interpretation}`;
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
        date,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      {
        label: 'compatible textual and typed dates',
        eventSummary: 'Alex says Maya delivered the content late in May.',
        interpretation: 'Alex says Maya’s May content delivery caused schedule delay.',
        date: {
          start: '2024-05-08',
          end: '2024-05-08',
          precision: 'day',
          approximate: false,
        },
      },
      {
        label: 'missing typed date with exact textual match',
        eventSummary: 'Alex says Maya delivered the content late in May.',
        interpretation: 'Alex says Maya’s May content delivery caused schedule delay.',
        date: {
          start: null,
          end: null,
          precision: 'unknown',
          approximate: false,
        },
      },
    ])('accepts $label', ({ eventSummary, interpretation, date }) => {
      const narrative = `${eventSummary} ${interpretation}`;
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
        date,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it.each([
      {
        label: 'conflicting deadline relations',
        eventSummary: 'Alex says Maya delivered the content before the deadline.',
        interpretation: 'Alex says Maya’s delivery after the deadline caused schedule delay.',
      },
      {
        label: 'conflicting ordinal qualifiers',
        eventSummary: 'Alex says Maya’s first content delivery was late.',
        interpretation: 'Alex says Maya’s revised content delivery caused schedule delay.',
      },
    ])('rejects $label', ({ eventSummary, interpretation }) => {
      const narrative = `${eventSummary} ${interpretation}`;
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });
  });

  describe('seventh review finding 4: frozen compatibility API boundary', () => {
    it('does not expose the generic recovery helper as a normal extraction API', async () => {
      const coverageSource = await readFile(
        resolve(root, 'src/extraction/person-a-dry-run-001-cl-a-003-compatibility-recovery.ts'),
        'utf8',
      );
      expect(coverageSource).not.toContain('recoverGroundedClientDelayClaims');
      expect(coverageSource).toContain('@internal');
      expect(coverageSource).toContain('applyDryRun001ClA003CompatibilityRecovery');
    });

    it('keeps normal production extraction disconnected from compatibility recovery', async () => {
      const extractorSource = await readFile(
        resolve(root, 'src/extraction/person-a-extractor.ts'),
        'utf8',
      );
      expect(extractorSource).not.toMatch(/claim-coverage|frozen-compatibility|compatibility/iu);
      expect(extractorSource).not.toContain('applyDryRun001ClA003CompatibilityRecovery');
    });

    it('exposes the explicit Dry Run 001 projection entrypoint', async () => {
      const compatibilitySource = await readFile(
        resolve(root, 'src/extraction/person-a-frozen-compatibility.ts'),
        'utf8',
      );
      expect(compatibilitySource).toContain(
        'export function assembleDryRun001ClA003CompatibilityProjection',
      );
    });

    it('allows only the frozen compatibility module to import the internal recovery', async () => {
      const extractionDirectory = resolve(root, 'src/extraction');
      const files = (await readdir(extractionDirectory)).filter(
        (file) =>
          file.endsWith('.ts') &&
          file !== 'person-a-dry-run-001-cl-a-003-compatibility-recovery.ts',
      );
      const importers: string[] = [];
      for (const file of files) {
        const source = await readFile(resolve(extractionDirectory, file), 'utf8');
        if (source.includes('applyDryRun001ClA003CompatibilityRecovery')) importers.push(file);
      }
      expect(importers).toEqual(['person-a-frozen-compatibility.ts']);
    });
  });

  it('preserves the selected occurrence when identical source text repeats', () => {
    const quote = 'Maya delivered the content late and it directly contributed to delay.';
    const narrative = `${quote}\nUnrelated separator.\n${quote}`;
    const modelOutput = candidateFixture(narrative, { quote }, 1);

    const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
    expect(corrected.claims).toHaveLength(1);
    expect(corrected.claims[0].source_spans[0]).toEqual(exactSpan(narrative, quote, 1));
  });

  it('does not recover a claim when the relevant event is absent', () => {
    const modelOutput = { timeline: [], claims: [], evidence: [] };
    expect(
      applyDryRun001ClA003CompatibilityRecovery(modelOutput, 'Nothing relevant occurred.').claims,
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

    const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);
    expect(corrected.claims).toEqual([]);
  });

  it('rejects a causal candidate whose source span is not an exact narrative slice', () => {
    const narrative = 'Maya delivered the content late and it directly contributed to delay.';
    const modelOutput = candidateFixture(narrative);
    modelOutput.timeline[0].source_spans[0].end_char -= 1;

    expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
  });

  it('does not upgrade agreed or disputed interpretation states into a Person A claim', () => {
    const narrative = 'Maya delivered the content late and it directly contributed to delay.';
    for (const interpretationStatus of ['agreed', 'disputed']) {
      const modelOutput = candidateFixture(narrative, {
        interpretation_status: interpretationStatus,
      });
      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    }
  });

  it('keeps compatibility claim coverage independent of case identities and comparison fixtures', async () => {
    const source = await readFile(
      resolve(root, 'src/extraction/person-a-dry-run-001-cl-a-003-compatibility-recovery.ts'),
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
