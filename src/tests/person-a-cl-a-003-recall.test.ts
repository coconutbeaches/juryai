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
    party_profile: { display_name: 'Alex' },
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
        event_summary: personAInterpretation.replace('schedule delay', 'delay'),
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
        event_summary: 'Alex says Maya’s first content batch was delivered and caused delay.',
        person_a_interpretation:
          'Alex says Maya’s first content batch directly caused schedule delay.',
        source_evidence_ids: ['ev_batch_a'],
      });
      modelOutput.evidence = [{ evidence_id: 'ev_batch_a' }, { evidence_id: 'ev_batch_b' }];
      modelOutput.timeline.push({
        ...structuredClone(modelOutput.timeline[0]),
        event_summary: 'Alex says Maya’s second content batch was delivered and caused delay.',
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
      const groundedNarrative = `${narrative} ${eventSummary}`;
      const modelOutput = candidateFixture(groundedNarrative, {
        quote: eventSummary,
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
      });
      modelOutput.claims.push(existingClaim(groundedNarrative, { claim_text: claimText }));
      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, groundedNarrative).claims,
      ).toHaveLength(2);
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

  describe('eighth review finding 1: causal-result polarity', () => {
    it.each([
      'Maya’s late content delivery caused no schedule delay.',
      'Maya’s late content delivery resulted in no delay.',
      'Maya’s late content delivery contributed to zero delay.',
      'Maya’s late content delivery ended without causing delay.',
      'Maya’s late content delivery did not result in any delay.',
    ])('rejects a negated causal result: %s', (interpretation) => {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      'Maya’s late content delivery caused only a minor delay.',
      'Maya’s late content delivery caused no more than two days of delay.',
      'Maya’s late content delivery caused a delay, but not a major delay.',
      'Maya’s late content delivery did not cause a major delay, but caused a one-day delay.',
      'Maya supplied no images, but her late content delivery caused schedule delay.',
    ])('preserves limited positive causation: %s', (interpretation) => {
      const eventSummary = 'Alex says Maya’s late content delivery caused a limited delay.';
      const narrative = `${eventSummary} ${interpretation}`;
      const modelOutput = candidateFixture(narrative, {
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves the exact frozen cl_a_003 direct causal interpretation', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('eighth review finding 2: alternative temporal anchors', () => {
    function temporalAlternativeCandidate(
      source: string,
      eventSummary: string,
    ): { narrative: string; modelOutput: JsonObject } {
      const interpretation = 'Maya’s late content delivery caused schedule delay.';
      const narrative = `${source} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      {
        label: 'May 8 or May 9',
        source: 'I think Maya’s content arrived around May 8 or May 9.',
        summary: 'Alex thinks Maya’s content arrived around May 8 or May 9.',
      },
      {
        label: 'May 8/9',
        source: 'I think Maya’s content arrived around May 8/9.',
        summary: 'Alex thinks Maya’s content arrived around May 8 or May 9.',
      },
      {
        label: 'normalized adjacent-date range',
        source: 'I think Maya’s content arrived around May 8 or May 9.',
        summary: 'Alex thinks Maya’s content arrived around May 8–9.',
      },
      {
        label: 'named-period alternative',
        source: 'I think Maya’s content arrived in late May or early June.',
        summary: 'Alex thinks Maya’s content arrived in late May or early June.',
      },
      {
        label: 'bounded date range',
        source: 'Maya’s content arrived between May 8 and May 9.',
        summary: 'Alex says Maya’s content arrived May 8–9.',
      },
      {
        label: 'year alternative',
        source: 'Maya’s content arrived in 2024 or 2025.',
        summary: 'Alex says Maya’s content arrived in either 2024 or 2025.',
      },
      {
        label: 'approximate single date',
        source: 'I think Maya’s content arrived around May 8.',
        summary: 'Alex thinks Maya’s content arrived around May 8.',
      },
      {
        label: 'definite single date',
        source: 'Maya’s content arrived on May 8.',
        summary: 'Alex says Maya’s content arrived on May 8.',
      },
    ])('accepts preserved temporal meaning: $label', ({ source, summary }) => {
      const { narrative, modelOutput } = temporalAlternativeCandidate(source, summary);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it.each([
      {
        label: 'drops May 9 from an or alternative',
        source: 'I think Maya’s content arrived around May 8 or May 9.',
        summary: 'Alex thinks Maya’s content arrived around May 8.',
      },
      {
        label: 'changes or into and',
        source: 'I think Maya’s content arrived around May 8 or May 9.',
        summary: 'Alex thinks Maya’s content arrived around May 8 and May 9.',
      },
      {
        label: 'drops early June',
        source: 'I think Maya’s content arrived in late May or early June.',
        summary: 'Alex thinks Maya’s content arrived in late May.',
      },
      {
        label: 'reduces a date range to one point',
        source: 'Maya’s content arrived between May 8 and May 9.',
        summary: 'Alex says Maya’s content arrived on May 8.',
      },
      {
        label: 'drops 2025',
        source: 'Maya’s content arrived in 2024 or 2025.',
        summary: 'Alex says Maya’s content arrived in 2024.',
      },
    ])('rejects a summary that $label', ({ source, summary }) => {
      const { narrative, modelOutput } = temporalAlternativeCandidate(source, summary);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it('preserves the exact frozen May 8 or May 9 uncertainty', async () => {
      const { narrative, modelOutput } = await frozenInputs();
      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);

      expect(
        corrected.claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('ninth review finding 1: explicit causal direction', () => {
    function directionalCandidate(interpretation: string): {
      narrative: string;
      modelOutput: JsonObject;
    } {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      'Maya’s late delivery resulted from the schedule delay.',
      'Maya’s late delivery was caused by the schedule delay.',
    ])('rejects a candidate incident that is the causal effect: %s', (interpretation) => {
      const { narrative, modelOutput } = directionalCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      'The schedule delay resulted from Maya’s late delivery.',
      'The schedule delay was caused by Maya’s late delivery.',
      'Maya’s late delivery resulted in schedule delay.',
      'Maya’s late delivery contributed to schedule delay.',
    ])(
      'promotes only when the candidate incident occupies the causal role: %s',
      (interpretation) => {
        const { narrative, modelOutput } = directionalCandidate(interpretation);
        const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);

        expect(corrected.claims).toHaveLength(1);
        expect(corrected.claims[0].claim_text).toBe('Alex says Maya delivered the content late.');
      },
    );

    it('preserves the exact frozen cl_a_003 causal direction', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('ninth review finding 2: material epistemic qualifications', () => {
    function epistemicCandidate(
      source: string,
      eventSummary: string,
      interpretation = 'Maya’s late content delivery caused schedule delay.',
    ): { narrative: string; modelOutput: JsonObject } {
      const narrative = `${source} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      {
        label: 'drops modal might',
        source: 'Maya might have delivered the content late.',
        summary: 'Alex says Maya delivered the content late.',
      },
      {
        label: 'drops possibility',
        source: 'Maya possibly delivered the content late.',
        summary: 'Alex says Maya delivered the content late.',
      },
      {
        label: 'drops modal may from a causal statement',
        source: 'Maya’s late content delivery may have contributed to delay.',
        summary: 'Alex says Maya’s late content delivery contributed to delay.',
      },
      {
        label: 'drops appearance',
        source: 'Maya apparently delivered the content late.',
        summary: 'Alex says Maya delivered the content late.',
      },
      {
        label: 'drops probability',
        source: 'Maya likely delivered the content late.',
        summary: 'Alex says Maya delivered the content late.',
      },
      {
        label: 'drops perhaps',
        source: 'Perhaps Maya delivered the content late.',
        summary: 'Alex says Maya delivered the content late.',
      },
      {
        label: 'drops could have',
        source: 'Maya could have delivered the content late.',
        summary: 'Alex says Maya delivered the content late.',
      },
      {
        label: 'drops seeming appearance',
        source: 'Maya seemingly delivered the content late.',
        summary: 'Alex says Maya delivered the content late.',
      },
      {
        label: 'drops unlikely probability',
        source: 'Maya was unlikely to have delivered the content late.',
        summary: 'Alex says Maya delivered the content late.',
      },
      {
        label: 'drops an appearance construction',
        source: 'It appears that Maya delivered the content late.',
        summary: 'Alex says Maya delivered the content late.',
      },
      {
        label: 'recasts suspicion as generic belief',
        source: 'I suspect Maya delivered the content late.',
        summary: 'Alex thinks Maya delivered the content late.',
      },
      {
        label: 'recasts inference as generic belief',
        source: 'I infer that Maya delivered the content late.',
        summary: 'Alex thinks Maya delivered the content late.',
      },
      {
        label: 'drops an allegation',
        source: 'Maya allegedly delivered the content late.',
        summary: 'Alex says Maya delivered the content late.',
      },
      {
        label: 'drops an explicit dispute',
        source: 'Maya disputes that she delivered the content late.',
        summary: 'Alex says Maya delivered the content late.',
      },
    ])('rejects a summary that $label', ({ source, summary }) => {
      const { narrative, modelOutput } = epistemicCandidate(source, summary);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      {
        label: 'modal might',
        source: 'Maya might have delivered the content late.',
        summary: 'Alex says Maya might have delivered the content late.',
      },
      {
        label: 'possibility',
        source: 'Maya possibly delivered the content late.',
        summary: 'Alex says it is possible Maya delivered the content late.',
      },
      {
        label: 'first-person belief',
        source: 'I think Maya delivered the content late.',
        summary: 'Alex believes Maya delivered the content late.',
      },
      {
        label: 'approximation and alternatives',
        source: 'I think Maya delivered the content around May 8 or May 9.',
        summary: 'Alex thinks Maya delivered the content around May 8–9.',
      },
      {
        label: 'probability with normalized wording',
        source: 'Maya likely delivered the content late.',
        summary: 'Alex says Maya probably delivered the content late.',
      },
      {
        label: 'appearance with normalized wording',
        source: 'It appears that Maya delivered the content late.',
        summary: 'Alex says Maya seemingly delivered the content late.',
      },
    ])('accepts a summary preserving $label', ({ source, summary }) => {
      const { narrative, modelOutput } = epistemicCandidate(source, summary);
      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);

      expect(corrected.claims).toHaveLength(1);
      expect(corrected.claims[0].claim_text).toBe(summary);
    });

    it('allows a cautious summary of a definite source because it does not strengthen meaning', () => {
      const summary = 'Alex says Maya might have delivered the content late.';
      const { narrative, modelOutput } = epistemicCandidate(
        'Maya delivered the content late.',
        summary,
      );
      const corrected = applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative);

      expect(corrected.claims).toHaveLength(1);
      expect(corrected.claims[0].claim_text).toBe(summary);
    });

    it('preserves the exact frozen cl_a_003 belief, approximation, and alternatives', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('tenth review finding 1: modal May before event verbs', () => {
    function mayCandidate(
      source: string,
      eventSummary: string,
      interpretation: string,
    ): { narrative: string; modelOutput: JsonObject } {
      const narrative = `${source} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      {
        label: 'may change',
        source: 'Maya may change the content after the deadline.',
        summary: 'Alex says Maya changed the content after the deadline.',
        interpretation: 'Maya’s content change caused schedule delay.',
      },
      {
        label: 'may deliver',
        source: 'Maya may deliver the files late.',
        summary: 'Alex says Maya delivered the files late.',
        interpretation: 'Maya’s late file delivery caused schedule delay.',
      },
      {
        label: 'may have changed',
        source: 'Maya may have changed the scope.',
        summary: 'Alex says Maya changed the scope.',
        interpretation: 'Maya’s scope change caused schedule delay.',
      },
      {
        label: 'modal may plus calendar May',
        source: 'Maya may not deliver the files by May.',
        summary: 'Alex says Maya did not deliver the files by May.',
        interpretation: 'Maya’s missed May delivery caused schedule delay.',
      },
      {
        label: 'sentence-initial modal May',
        source: 'May have caused delay: Maya’s late file delivery.',
        summary: 'Alex says Maya’s late file delivery caused delay.',
        interpretation: 'Maya’s late file delivery caused schedule delay.',
      },
    ])(
      'requires a definite summary to preserve $label uncertainty',
      ({ source, summary, interpretation }) => {
        const { narrative, modelOutput } = mayCandidate(source, summary, interpretation);

        expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual(
          [],
        );
      },
    );

    it.each([
      {
        label: 'article-led May changes',
        source: 'The May changes caused delay.',
        summary: 'Alex says Maya made content changes in May.',
        interpretation: 'Maya’s May content changes caused schedule delay.',
      },
      {
        label: 'article-led singular May change',
        source: 'The May change caused delay.',
        summary: 'Alex says Maya made a content change in May.',
        interpretation: 'Maya’s May content change caused schedule delay.',
      },
      {
        label: 'bare May changes noun phrase',
        source: 'May changes caused delay.',
        summary: 'Alex says Maya made content changes in May.',
        interpretation: 'Maya’s May content changes caused schedule delay.',
      },
      {
        label: 'calendar-preposition May',
        source: 'Changes made in May caused delay.',
        summary: 'Alex says Maya made content changes in May.',
        interpretation: 'Maya’s content changes in May caused schedule delay.',
      },
      {
        label: 'May delivery noun phrase',
        source: 'The May delivery caused delay.',
        summary: 'Alex says Maya’s May delivery was late.',
        interpretation: 'Maya’s May delivery caused schedule delay.',
      },
    ])('allows definite calendar usage: $label', ({ source, summary, interpretation }) => {
      const { narrative, modelOutput } = mayCandidate(source, summary, interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('allows recovery when modal may is preserved in the summary', () => {
      const { narrative, modelOutput } = mayCandidate(
        'Maya may change the content after the deadline.',
        'Alex says Maya may change the content after the deadline.',
        'Maya’s content change caused schedule delay.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves the exact frozen cl_a_003 calendar references', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('tenth review finding 2: contrastively excluded reverse causes', () => {
    function reverseCauseCandidate(interpretation: string): {
      narrative: string;
      modelOutput: JsonObject;
    } {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      'The schedule delay resulted from bad weather, not Maya’s late delivery.',
      'The schedule delay resulted from bad weather rather than Maya’s late delivery.',
      'The schedule delay resulted from the outage instead of Maya’s revisions.',
      'The schedule delay resulted from bad weather but not Maya’s late delivery.',
      'The schedule delay resulted from bad weather and not Maya’s late delivery.',
      'The schedule delay resulted from bad weather, not because of Maya’s late delivery.',
      'The schedule delay resulted from bad weather (not Maya’s late delivery).',
      'The schedule delay resulted from bad weather, but Maya delivered the content late.',
      'The schedule delay was caused by the outage—not Maya’s delivery.',
      'The schedule delay did not result from Maya’s delivery.',
    ])('does not bind Maya from an excluded cause: %s', (interpretation) => {
      const { narrative, modelOutput } = reverseCauseCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      'The schedule delay resulted from bad weather and Maya’s late delivery.',
      'The schedule delay resulted mainly from bad weather, but Maya’s late delivery also contributed to delay.',
      'The schedule delay resulted from bad weather, not Maya’s revisions, but Maya’s late delivery also contributed to delay.',
    ])('retains a separately positive Maya cause: %s', (interpretation) => {
      const { narrative, modelOutput } = reverseCauseCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves the exact frozen cl_a_003 positive cause', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('eleventh review finding 1: contracted and equivalent causal negation', () => {
    function causalNegationCandidate(interpretation: string): {
      narrative: string;
      modelOutput: JsonObject;
    } {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          quote: eventSummary,
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      "Maya’s late delivery didn't cause schedule delay.",
      'Maya’s late delivery didn’t cause schedule delay.',
      'Maya’s late delivery doesn’t contribute to schedule delay.',
      'Maya’s late delivery isn’t causing schedule delay.',
      'Maya’s late delivery hasn’t caused schedule delay.',
      'Maya’s late delivery cannot have caused schedule delay.',
      'Maya’s late delivery cannot have contributed to schedule delay.',
      'Maya’s late delivery can’t cause schedule delay.',
      'Maya’s late delivery could not have caused schedule delay.',
      'Maya’s late delivery couldn’t have contributed to schedule delay.',
      'Maya’s late delivery wouldn’t cause schedule delay.',
      'Maya’s late delivery failed to cause schedule delay.',
      'Maya’s late delivery failed to contribute to schedule delay.',
      'Maya’s late delivery did nothing to cause schedule delay.',
      'Maya’s late delivery never managed to cause schedule delay.',
      'The schedule delay wasn’t caused by Maya’s late delivery.',
    ])('rejects local causal denial: %s', (interpretation) => {
      const { narrative, modelOutput } = causalNegationCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      'Maya’s late delivery wasn’t the only cause of schedule delay.',
      'Maya’s late delivery didn’t cause the entire delay, but contributed to one day of delay.',
    ])('preserves limited or independently positive causation: %s', (interpretation) => {
      const { narrative, modelOutput } = causalNegationCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('keeps incident negation distinct from positive causal polarity', () => {
      const eventSummary = 'Alex says Maya did not deliver the files.';
      const interpretation = 'Maya didn’t deliver the files, which caused schedule delay.';
      const narrative = `${eventSummary} ${interpretation}`;
      const modelOutput = candidateFixture(narrative, {
        quote: eventSummary,
        event_summary: eventSummary,
        person_a_interpretation: interpretation,
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves the exact frozen cl_a_003 positive causal predicate', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('eleventh review finding 2: source-summary occurrence state', () => {
    function sourceStateCandidate(
      source: string,
      eventSummary: string,
      interpretation: string,
    ): { narrative: string; modelOutput: JsonObject } {
      const narrative = `${source} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          quote: source,
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      {
        label: 'never delivered becomes delivered late',
        source: 'Maya never delivered the content.',
        summary: 'Alex says Maya delivered the content late.',
        interpretation: 'Maya’s late content delivery caused schedule delay.',
      },
      {
        label: 'missed May deadline becomes delivered in May',
        source: 'Maya did not deliver the content by May.',
        summary: 'Alex says Maya delivered the content in May.',
        interpretation: 'Maya’s May content delivery caused schedule delay.',
      },
      {
        label: 'partial delivery becomes full delivery',
        source: 'Maya partially delivered the content.',
        summary: 'Alex says Maya fully delivered the content.',
        interpretation: 'Maya’s full content delivery caused schedule delay.',
      },
      {
        label: 'unclear delivery becomes definite',
        source: 'It is unclear whether Maya delivered the content.',
        summary: 'Alex says Maya delivered the content.',
        interpretation: 'Maya’s content delivery caused schedule delay.',
      },
      {
        label: 'denied delivery becomes undisputed',
        source: 'Maya denied that she delivered the content.',
        summary: 'Alex says Maya delivered the content.',
        interpretation: 'Maya’s content delivery caused schedule delay.',
      },
      {
        label: 'explicit delivery state disappears',
        source: 'Maya delivered the content late.',
        summary: 'Alex says Maya’s content issue occurred.',
        interpretation: 'Maya’s late content delivery caused schedule delay.',
      },
    ])('rejects when $label', ({ source, summary, interpretation }) => {
      const { narrative, modelOutput } = sourceStateCandidate(source, summary, interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      {
        label: 'late submission normalization',
        source: 'Maya submitted the content after the deadline.',
        summary: 'Alex says Maya delivered the content late.',
        interpretation: 'Maya’s late content delivery caused schedule delay.',
      },
      {
        label: 'late delivery to after-deadline normalization',
        source: 'Maya delivered the content late.',
        summary: 'Alex says Maya submitted the content after the deadline.',
        interpretation: 'Maya’s late content delivery caused schedule delay.',
      },
      {
        label: 'missed-deadline normalization',
        source: 'Maya failed to submit the content by the deadline.',
        summary: 'Alex says Maya did not deliver the content by the deadline.',
        interpretation: 'Maya’s missing content delivery caused schedule delay.',
      },
      {
        label: 'partial-delivery normalization',
        source: 'Only part of the files were delivered by Maya.',
        summary: 'Alex says Maya partially delivered the files.',
        interpretation: 'Maya’s partial file delivery caused schedule delay.',
      },
      {
        label: 'cautious but completion-preserving summary',
        source: 'Maya delivered the content after the deadline.',
        summary: 'Alex says Maya appears to have delivered the content late.',
        interpretation: 'Maya’s late content delivery caused schedule delay.',
      },
    ])('allows compatible $label', ({ source, summary, interpretation }) => {
      const { narrative, modelOutput } = sourceStateCandidate(source, summary, interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves the exact frozen cl_a_003 occurrence state', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('twelfth review finding 1: plain non-delivery source state', () => {
    function plainNonDeliveryCandidate(
      source: string,
      summary: string,
    ): { narrative: string; modelOutput: JsonObject } {
      const interpretation = 'Maya’s missing content delivery caused schedule delay.';
      const narrative = `${source} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          quote: source,
          event_summary: summary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      'Maya did not deliver the content.',
      'Maya didn’t deliver the content.',
      'The content was not delivered by Maya.',
      'The content has not been submitted by Maya.',
      'Maya failed to send the content.',
      'No delivery occurred.',
    ])('rejects affirmative late-delivery summary for source: %s', (source) => {
      const { narrative, modelOutput } = plainNonDeliveryCandidate(
        source,
        'Alex says Maya delivered the content late.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      {
        source: 'Maya did not deliver the content.',
        summary: 'Alex says Maya partially delivered the content.',
      },
      {
        source: 'The content was not submitted by Maya.',
        summary: 'Alex says Maya submitted the content after the deadline.',
      },
      {
        source: 'No delivery occurred.',
        summary: 'Alex says Maya partially delivered the content.',
      },
    ])('rejects $summary when the source says $source', ({ source, summary }) => {
      const { narrative, modelOutput } = plainNonDeliveryCandidate(source, summary);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      {
        source: 'Maya failed to submit the content.',
        summary: 'Alex says Maya did not deliver the content.',
      },
      {
        source: 'The content was not supplied by Maya.',
        summary: 'Alex says Maya did not deliver the content.',
      },
      {
        source: 'Maya did not submit the content by May.',
        summary: 'Alex says Maya did not deliver the content by the May deadline.',
      },
    ])('allows compatible non-delivery normalization: $source', ({ source, summary }) => {
      const { narrative, modelOutput } = plainNonDeliveryCandidate(source, summary);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves the exact frozen cl_a_003 occurrence', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('twelfth review finding 2: nominal causal denial', () => {
    function nominalCausationCandidate(interpretation: string): {
      narrative: string;
      modelOutput: JsonObject;
    } {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          quote: eventSummary,
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      'Maya’s late delivery was not a cause of schedule delay.',
      'Maya’s late delivery was not the cause of the delay.',
      'Maya’s late delivery was no cause of schedule delay.',
      'Maya’s late delivery did not constitute a cause of schedule delay.',
      'Maya’s late delivery was not responsible for the delay.',
      'Maya’s late delivery played no causal role in the delay.',
      'Maya’s late delivery had no causal effect on the delay.',
    ])('rejects total nominal causal denial: %s', (interpretation) => {
      const { narrative, modelOutput } = nominalCausationCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      'Maya’s late delivery was not the only cause of schedule delay.',
      'Maya’s late delivery was a minor contributing cause of schedule delay.',
      'Maya’s late delivery was one cause among several causes of schedule delay.',
      'Maya’s late delivery was not the primary cause, but contributed to schedule delay.',
    ])('preserves limited positive nominal causation: %s', (interpretation) => {
      const { narrative, modelOutput } = nominalCausationCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('keeps a later independent positive predicate after nominal denial', () => {
      const { narrative, modelOutput } = nominalCausationCandidate(
        'Maya’s late delivery was not a cause of the whole delay, but definitely contributed to one day of delay.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves the exact frozen cl_a_003 causal assertion', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('twelfth review finding 3: causal certainty before delay magnitude', () => {
    function magnitudeCandidate(interpretation: string): {
      narrative: string;
      modelOutput: JsonObject;
    } {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          quote: eventSummary,
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      'Maya’s late delivery could have caused a minor schedule delay.',
      'Maya’s late delivery might have contributed to a small delay.',
      'Maya’s late delivery may have resulted in one day of delay.',
      'Maya’s late delivery possibly caused no more than two days of delay.',
      'Maya’s late delivery could have caused a minor delay, but no causal link was established.',
    ])('rejects modal causation regardless of magnitude: %s', (interpretation) => {
      const { narrative, modelOutput } = magnitudeCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      'Maya’s late delivery caused a minor schedule delay.',
      'Maya’s late delivery contributed to one day of delay.',
      'Maya’s late delivery resulted in only a small delay.',
      'Maya’s late delivery caused no more than two days of delay.',
      'Maya’s late delivery was not the primary cause but contributed to a minor delay.',
    ])('allows directly asserted limited magnitude: %s', (interpretation) => {
      const { narrative, modelOutput } = magnitudeCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('allows a definite predicate after an independently uncertain predicate', () => {
      const { narrative, modelOutput } = magnitudeCandidate(
        'Maya’s late delivery might not have caused the entire delay, but definitely contributed to one day of delay.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves the exact frozen cl_a_003 direct causal assertion', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('thirteenth review finding: malformed compatibility arrays', () => {
    const malformedArrays = [
      { field: 'timeline', label: 'missing', value: undefined, missing: true },
      { field: 'timeline', label: 'null', value: null, missing: false },
      {
        field: 'timeline',
        label: 'an object',
        value: { event_id: 'event_corrupt' },
        missing: false,
      },
      { field: 'timeline', label: 'a string', value: 'event_corrupt', missing: false },
      { field: 'claims', label: 'missing', value: undefined, missing: true },
      { field: 'claims', label: 'null', value: null, missing: false },
      {
        field: 'claims',
        label: 'an object',
        value: { claim_id: 'claim_corrupt' },
        missing: false,
      },
      { field: 'claims', label: 'a string', value: 'claim_corrupt', missing: false },
    ] as const;

    it.each(malformedArrays)(
      'fails before projection when $field is $label and preserves the original input',
      async ({ field, value, missing }) => {
        const { narrative, modelOutput } = await frozenInputs();
        if (missing) delete modelOutput[field];
        else modelOutput[field] = value;
        const before = JSON.stringify(modelOutput);

        expect(() =>
          assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
            narrative,
            submittedAt,
            model,
            generatedAt,
          }),
        ).toThrow(
          new RegExp(
            `Dry Run 001 client-delay compatibility projection requires ${field} to be an array`,
            'iu',
          ),
        );
        expect(JSON.stringify(modelOutput)).toBe(before);
        if (missing) expect(Object.hasOwn(modelOutput, field)).toBe(false);
        else expect(modelOutput[field]).toEqual(value);
      },
    );

    it('does not partially recover or consolidate malformed compatibility input', async () => {
      const { narrative, modelOutput } = await frozenInputs();
      const duplicate = structuredClone(modelOutput.timeline[0]);
      modelOutput.timeline.push(duplicate);
      modelOutput.claims = null;
      const before = JSON.stringify(modelOutput);

      expect(() => applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative)).toThrow(
        /Dry Run 001 client-delay compatibility projection requires claims to be an array/iu,
      );
      expect(JSON.stringify(modelOutput)).toBe(before);
      expect(modelOutput.timeline).toHaveLength((JSON.parse(before) as JsonObject).timeline.length);
      expect(modelOutput.claims).toBeNull();
    });

    it('still projects the valid frozen provider object to the corrected 0/45/20 result', async () => {
      const { narrative, golden, modelOutput } = await frozenInputs();

      const projected = assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
        narrative,
        submittedAt,
        model,
        generatedAt,
      });

      expect(evaluate(projected, golden, narrative).summary).toMatchObject({
        critical: 0,
        major: 45,
        minor: 20,
      });
    });
  });

  describe('fourteenth review finding: predicate-local causal certainty', () => {
    function certaintyCandidate(interpretation: string): {
      narrative: string;
      modelOutput: JsonObject;
    } {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          quote: eventSummary,
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      'Maya’s late delivery would cause schedule delay.',
      'Maya’s late delivery would contribute to schedule delay.',
      'Maya’s late delivery would result in schedule delay.',
      'Maya’s late delivery should cause schedule delay.',
      'Maya’s late delivery should contribute to schedule delay.',
      'Maya’s late delivery should result in schedule delay.',
      'Maya’s late delivery can cause schedule delay.',
      'Maya’s late delivery can contribute to schedule delay.',
      'Maya’s late delivery can result in schedule delay.',
      'Maya’s late delivery could cause a minor schedule delay.',
      'Maya’s late delivery could contribute to schedule delay.',
      'Maya’s late delivery could result in schedule delay.',
      'Maya’s late delivery is expected to cause schedule delay.',
      'Maya’s late delivery was expected to contribute to schedule delay.',
      'Maya’s late delivery is likely to result in schedule delay.',
      'Maya’s late delivery was likely to cause schedule delay.',
      'Maya’s late delivery is predicted to cause schedule delay.',
      'Maya’s late delivery was predicted to cause schedule delay.',
      'Maya’s late delivery is projected to cause schedule delay.',
      'Maya’s late delivery was projected to cause schedule delay.',
    ])('rejects non-asserted causal predicate: %s', (interpretation) => {
      const { narrative, modelOutput } = certaintyCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      'Maya’s late delivery caused schedule delay.',
      'Maya’s late delivery contributed to schedule delay.',
      'Maya’s late delivery resulted in schedule delay.',
      'The schedule delay resulted from Maya’s late delivery.',
    ])('allows directly asserted causal predicate: %s', (interpretation) => {
      const { narrative, modelOutput } = certaintyCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('allows only the independently definite predicate after a modal predicate', () => {
      const { narrative, modelOutput } = certaintyCandidate(
        'Maya’s late delivery could have caused more delay, but it definitely contributed to one day of delay.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it.each([
      'Maya’s late delivery was expected, and ultimately caused schedule delay.',
      'Maya’s late delivery was expected to cause delay, and ultimately caused one day of schedule delay.',
    ])('allows a separate direct predicate after a past expectation: %s', (interpretation) => {
      const { narrative, modelOutput } = certaintyCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('does not let unrelated capability language taint a separate direct predicate', () => {
      const { narrative, modelOutput } = certaintyCandidate(
        'Maya can explain the timeline, but Maya’s late delivery caused schedule delay.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves the exact frozen cl_a_003 direct causal assertion', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('fifteenth review finding 1: governing modals across coordinated predicates', () => {
    function coordinatedCertaintyCandidate(interpretation: string): {
      narrative: string;
      modelOutput: JsonObject;
    } {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          quote: eventSummary,
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      'Maya’s late delivery could worsen the schedule and ultimately cause delay.',
      'Maya’s late delivery would disrupt the work and actually contribute to schedule delay.',
      'Maya’s late delivery may affect the delivery and definitely result in schedule delay.',
      'Maya’s late delivery should delay the work and in fact cause schedule delay.',
      'Maya’s late delivery was the incident that may have caused schedule delay.',
      'Maya’s late delivery was the incident which may have contributed to schedule delay.',
    ])('inherits the governing modal across a coordinated predicate: %s', (interpretation) => {
      const { narrative, modelOutput } = coordinatedCertaintyCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it('allows a direct assertion after a contrastive clause with a new explicit subject', () => {
      const { narrative, modelOutput } = coordinatedCertaintyCandidate(
        'It could have caused more disruption, but Maya’s late delivery definitely caused one day of schedule delay.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('allows a new reporting clause that independently confirms causation', () => {
      const { narrative, modelOutput } = coordinatedCertaintyCandidate(
        'The delivery might have affected progress, and Alex later confirmed that it caused schedule delay.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('allows direct coordinated predicates without a governing modal', () => {
      const { narrative, modelOutput } = coordinatedCertaintyCandidate(
        'Maya’s late delivery caused schedule delay and ultimately resulted in further schedule delay.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves calendar-month May in a relative incident noun phrase', () => {
      const { narrative, modelOutput } = coordinatedCertaintyCandidate(
        'Maya’s late delivery was that May delivery which caused schedule delay.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves the exact frozen cl_a_003 direct causal assertion', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('fifteenth review finding 2: reverse-form causal certainty', () => {
    function reverseCertaintyCandidate(interpretation: string): {
      narrative: string;
      modelOutput: JsonObject;
    } {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          quote: eventSummary,
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      'Schedule delay could result from Maya’s late delivery.',
      'Schedule delay would result from Maya’s late delivery.',
      'Schedule delay may have resulted from Maya’s late delivery.',
      'Schedule delay was expected to result from Maya’s late delivery.',
      'Schedule delay could have been caused by Maya’s late delivery.',
      'Schedule delay was likely caused by Maya’s late delivery.',
    ])('rejects a modal or predicted reverse causal predicate: %s', (interpretation) => {
      const { narrative, modelOutput } = reverseCertaintyCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it.each([
      'Schedule delay resulted from Maya’s late delivery.',
      'Schedule delay was caused by Maya’s late delivery.',
      'The delay came from Maya’s late delivery.',
    ])('allows a directly asserted reverse causal predicate: %s', (interpretation) => {
      const { narrative, modelOutput } = reverseCertaintyCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('allows only an independently confirmed reverse relation after an uncertain one', () => {
      const { narrative, modelOutput } = reverseCertaintyCandidate(
        'The delay could have resulted from several causes, but the final report established that it resulted from Maya’s late delivery.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves the exact frozen cl_a_003 direct causal assertion', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('exact-head review finding: probabilistic causal assertions', () => {
    function probabilisticCertaintyCandidate(interpretation: string): {
      narrative: string;
      modelOutput: JsonObject;
    } {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          quote: eventSummary,
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      'Maya’s late delivery probably caused schedule delay.',
      'Maya’s late delivery probably directly caused schedule delay.',
      'Maya’s late delivery probably eventually caused schedule delay.',
      'Maya’s late delivery apparently caused schedule delay.',
      'Maya’s late delivery apparently directly contributed to schedule delay.',
      'Maya’s late delivery apparently eventually contributed to schedule delay.',
      'Maya’s late delivery allegedly caused schedule delay.',
      'Maya’s late delivery was unlikely to cause schedule delay.',
      'Maya’s late delivery was likely to have caused schedule delay.',
      'Schedule delay probably resulted from Maya’s late delivery.',
      'Schedule delay probably eventually resulted from Maya’s late delivery.',
      'Schedule delay was likely to have resulted from Maya’s late delivery.',
    ])('rejects a probabilistic or qualified causal predicate: %s', (interpretation) => {
      const { narrative, modelOutput } = probabilisticCertaintyCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it('does not confuse factual emphasis with probabilistic qualification', () => {
      const { narrative, modelOutput } = probabilisticCertaintyCandidate(
        'Maya’s late delivery actually caused schedule delay.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('preserves the exact frozen cl_a_003 direct causal assertion', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('exact-head review finding: direct belief-qualified causation', () => {
    function beliefQualifiedCandidate(interpretation: string): {
      narrative: string;
      modelOutput: JsonObject;
    } {
      const eventSummary = 'Alex says Maya delivered the content late.';
      const narrative = `${eventSummary} ${interpretation}`;
      return {
        narrative,
        modelOutput: candidateFixture(narrative, {
          quote: eventSummary,
          event_summary: eventSummary,
          person_a_interpretation: interpretation,
        }),
      };
    }

    it.each([
      'Maya believes her late delivery caused schedule delay.',
      'Maya thinks her late delivery contributed to schedule delay.',
      'Maya suspects her late delivery resulted in schedule delay.',
      'Alex reports that Maya believes her late delivery caused schedule delay.',
      'In Maya’s opinion, her late delivery caused schedule delay.',
      'In Maya’s view, her late delivery contributed to schedule delay.',
      'From Maya’s perspective, her late delivery resulted in schedule delay.',
      'Maya’s opinion is that her late delivery caused schedule delay.',
      'Maya’s view was that her late delivery contributed to schedule delay.',
      'It is Maya’s opinion that her late delivery caused schedule delay.',
      'It was Maya’s view that her late delivery resulted in schedule delay.',
      'Maya believes (based on her estimate) that her late delivery caused schedule delay.',
      'Maya denied (in writing) that her late delivery caused schedule delay.',
      'Maya believes — based on her estimate — that her late delivery caused schedule delay.',
      'Maya denied — in writing — that her late delivery caused schedule delay.',
      'Alex reports that Maya says her late delivery caused schedule delay.',
      'Maya says her late delivery caused schedule delay.',
    ])('rejects a belief-qualified causal clause: %s', (interpretation) => {
      const { narrative, modelOutput } = beliefQualifiedCandidate(interpretation);

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toEqual([]);
    });

    it('preserves a direct Person A causal assertion', () => {
      const { narrative, modelOutput } = beliefQualifiedCandidate(
        'Alex says Maya’s late delivery caused schedule delay.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('allows an independent direct assertion after a completed belief sentence', () => {
      const { narrative, modelOutput } = beliefQualifiedCandidate(
        'Maya believes the timing was unfortunate. Alex says Maya’s late delivery caused schedule delay.',
      );

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims).toHaveLength(
        1,
      );
    });

    it('rejects an unqualified summary that drops a noun-led source attribution', () => {
      const sourceText = 'In Maya’s opinion, her late delivery caused schedule delay.';
      const modelOutput = candidateFixture(sourceText, {
        quote: sourceText,
        event_summary: 'Maya delivered the content late.',
        person_a_interpretation: 'Maya’s late delivery caused schedule delay.',
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, sourceText).claims).toEqual([]);
    });

    it('rejects a summary that drops a possessive/copular source attribution', () => {
      const sourceText = 'Maya’s opinion is that her late delivery caused schedule delay.';
      const modelOutput = candidateFixture(sourceText, {
        quote: sourceText,
        event_summary: 'Maya delivered the content late.',
        person_a_interpretation: 'Maya’s late delivery caused schedule delay.',
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, sourceText).claims).toEqual([]);
    });

    it('does not promote a noun-led source attribution even when the summary preserves it', () => {
      const sourceText = 'In Maya’s opinion, her late delivery caused schedule delay.';
      const modelOutput = candidateFixture(sourceText, {
        quote: sourceText,
        event_summary: 'In Maya’s opinion, she delivered the content late.',
        person_a_interpretation: 'Maya’s late delivery caused schedule delay.',
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, sourceText).claims).toEqual([]);
    });

    it('preserves the exact frozen cl_a_003 direct causal assertion', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
    });
  });

  describe('exact-head review finding: preserve every grounded occurrence state', () => {
    const sourceText =
      'Maya partially delivered the content, then never delivered the remaining files.';

    it('rejects a summary that drops the later non-delivery occurrence', () => {
      const modelOutput = candidateFixture(sourceText, {
        quote: sourceText,
        event_summary: 'Maya partially delivered the content.',
        person_a_interpretation:
          'Maya’s partial delivery and later non-delivery caused schedule delay.',
      });

      expect(applyDryRun001ClA003CompatibilityRecovery(modelOutput, sourceText).claims).toEqual([]);
    });

    it('allows a summary that preserves both grounded occurrence profiles', () => {
      const modelOutput = candidateFixture(sourceText, {
        quote: sourceText,
        event_summary:
          'Maya partially delivered the content, then never delivered the remaining files.',
        person_a_interpretation:
          'Maya’s partial delivery and later non-delivery caused schedule delay.',
      });

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, sourceText).claims,
      ).toHaveLength(1);
    });

    it('preserves the exact frozen cl_a_003 occurrence state', async () => {
      const { narrative, modelOutput } = await frozenInputs();

      expect(
        applyDryRun001ClA003CompatibilityRecovery(modelOutput, narrative).claims.filter(
          (claim: JsonObject) => claim.claim_id === 'claim_event_04_major_batch_client_delay',
        ),
      ).toHaveLength(1);
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
