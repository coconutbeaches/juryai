import { describe, expect, it } from 'vitest';
import { alignPersonA } from '../alignment/person-a-alignment-corrected.js';
import { buildPersonAAssessmentResult } from '../clarification/build-assessments.js';
import {
  generateClarificationQuestions,
  projectAmendments,
  type ClarificationAmendment,
  type EpistemicAssessment,
} from '../clarification/question-generator.js';
import { evaluatePersonA } from '../evaluation/person-a-diff-corrected.js';
import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';
import { validPersonAExtraction } from './person-a-test-helpers.js';

const assessment = (overrides: Partial<EpistemicAssessment> = {}): EpistemicAssessment => ({
  target_object_id: 'event_001',
  target_family: 'timeline',
  field: 'actor_party_id',
  trigger: 'actor_attribution',
  materiality: 'high',
  actor_attribution: 'unstated',
  question_context: 'the photo delivery on 12 May',
  ...overrides,
});

const original = () => ({
  object_id: 'event_001',
  actor_party_id: null as string | null,
  summary: 'Photos arrived late.',
  date: null as string | null,
});

const amendment = (overrides: Partial<ClarificationAmendment> = {}): ClarificationAmendment => ({
  amendment_id: 'amd_001',
  target_object_id: 'event_001',
  field: 'actor_party_id',
  prior_value: null,
  new_value: 'party_b',
  response_text: 'Maya delivered the photos.',
  created_at: '2026-07-19T15:00:00Z',
  phase: 'post_lock_amendment',
  supersedes: null,
  ...overrides,
});

function adapterFixture() {
  const extraction = validPersonAExtraction();
  const golden = buildPersonAGoldenProjection();
  const alignment = alignPersonA(extraction, golden);
  const report = evaluatePersonA(extraction, golden, alignment);
  return { extraction, alignment, report };
}

function addReportError(
  report: ReturnType<typeof adapterFixture>['report'],
  error: {
    severity: 'critical' | 'major' | 'minor';
    family:
      | 'agreement_terms'
      | 'deliverables'
      | 'timeline'
      | 'claims'
      | 'evidence'
      | 'damages'
      | 'outcomes'
      | 'third_parties'
      | 'extraction_issues'
      | 'clarification_questions';
    code: string;
    message: string;
    extracted_id?: string;
    golden_id?: string;
  },
): void {
  report.errors.push(error);
}

describe('deterministic clarification question generation', () => {
  it('asks contextual questions for unstated and inferred actors', () => {
    const questions = generateClarificationQuestions([
      assessment(),
      assessment({
        target_object_id: 'event_002',
        actor_attribution: 'inferred',
        question_context: 'the revised design upload',
      }),
    ]);
    expect(questions.map((question) => question.question)).toEqual([
      'Who performed this action — the photo delivery on 12 May?',
      'Who performed this action — the revised design upload?',
    ]);
  });

  it('does not ask when actor attribution is explicit', () => {
    expect(
      generateClarificationQuestions([
        assessment({ actor_attribution: 'explicit', question_context: undefined }),
      ]),
    ).toEqual([]);
  });

  it('asks about inferred and unstated causation but not explicit or disputed causation', () => {
    const causal = (
      targetObjectId: string,
      status: 'explicit' | 'inferred' | 'disputed' | 'unstated',
    ): EpistemicAssessment =>
      assessment({
        target_object_id: targetObjectId,
        field: 'causal_link',
        trigger: 'causal_link',
        actor_attribution: undefined,
        causal_link_status: status,
        question_context: `the delay described in ${targetObjectId}`,
      });
    expect(
      generateClarificationQuestions([
        causal('claim_001', 'inferred'),
        causal('claim_002', 'unstated'),
        causal('claim_003', 'explicit'),
        causal('claim_004', 'disputed'),
      ]).map((question) => question.target_object_id),
    ).toEqual(['claim_001', 'claim_002']);
  });

  it('never turns internal representation bookkeeping into a user question', () => {
    expect(
      generateClarificationQuestions([
        assessment({
          trigger: 'internal_representation',
          field: 'duplicate_into_claims',
          question_context: '<internal claim-copy instruction>',
        }),
      ]),
    ).toEqual([]);
  });

  it('deduplicates differently phrased triggers for the same gap and keeps higher materiality', () => {
    const questions = generateClarificationQuestions([
      assessment({ materiality: 'medium' }),
      assessment({
        trigger: 'required_bucket_missing',
        materiality: 'critical',
        question_context: 'who delivered the photos',
      }),
    ]);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      trigger: 'required_bucket_missing',
      materiality: 'critical',
      question: 'What is the missing timeline information — who delivered the photos?',
    });
  });

  it('uses a deterministic weakness tie-breaker during same-materiality deduplication', () => {
    const actor = assessment();
    const causal = assessment({
      trigger: 'causal_link',
      actor_attribution: undefined,
      causal_link_status: 'inferred',
    });
    expect(generateClarificationQuestions([causal, actor])[0]!.trigger).toBe('actor_attribution');
    expect(generateClarificationQuestions([actor, causal])[0]!.trigger).toBe('actor_attribution');
  });

  it('produces stable ranking regardless of input order', () => {
    const inputs = [
      assessment({ target_object_id: 'event_003', materiality: 'medium' }),
      assessment({ target_object_id: 'event_001', materiality: 'critical' }),
      assessment({ target_object_id: 'event_002', materiality: 'high' }),
    ];
    const forward = generateClarificationQuestions(inputs);
    const reverse = generateClarificationQuestions([...inputs].reverse());
    expect(reverse).toEqual(forward);
    expect(forward.map((question) => question.target_object_id)).toEqual([
      'event_001',
      'event_002',
      'event_003',
    ]);
  });

  it('uses coverage only after materiality and weakness', () => {
    const questions = generateClarificationQuestions([
      assessment({
        target_object_id: 'date_critical',
        field: 'date',
        trigger: 'date_precision',
        materiality: 'critical',
        date_precision: 'unknown',
        resolves_object_ids: ['one', 'two', 'three', 'four'],
      }),
      assessment({
        target_object_id: 'actor_single',
        materiality: 'critical',
      }),
      assessment({
        target_object_id: 'actor_multi',
        materiality: 'critical',
        resolves_object_ids: ['actor_multi', 'claim_001', 'claim_002'],
      }),
    ]);
    expect(questions.map((question) => question.target_object_id)).toEqual([
      'actor_multi',
      'actor_single',
      'date_critical',
    ]);
  });

  it('caps every round at six even when a caller requests more', () => {
    const inputs = Array.from({ length: 10 }, (_, index) =>
      assessment({
        target_object_id: `event_${String(index + 1).padStart(3, '0')}`,
      }),
    );
    expect(generateClarificationQuestions(inputs)).toHaveLength(6);
    expect(generateClarificationQuestions(inputs, { maxQuestions: 99 })).toHaveLength(6);
  });

  it('allows a caller to request zero questions', () => {
    expect(generateClarificationQuestions([assessment()], { maxQuestions: 0 })).toEqual([]);
  });

  it('uses distinct deterministic copy for merge and split risks', () => {
    const questions = generateClarificationQuestions([
      assessment({
        target_object_id: 'deliverable_merge',
        field: 'identity',
        trigger: 'merge_risk',
        actor_attribution: undefined,
        merge_risk: 'possible_merge',
        question_context: 'the mobile and desktop mockups',
      }),
      assessment({
        target_object_id: 'deliverable_split',
        field: 'identity',
        trigger: 'merge_risk',
        actor_attribution: undefined,
        merge_risk: 'possible_split',
        question_context: 'the combined design package',
      }),
    ]);
    expect(questions.map((question) => question.question)).toEqual([
      'Are these separate items, or one combined item — the mobile and desktop mockups?',
      'Does this describe one item, or should it be split into separate items — the combined design package?',
    ]);
  });

  it('deduplicates merge and split risks deterministically in both input orders', () => {
    const possibleMerge = assessment({
      field: 'identity',
      trigger: 'merge_risk',
      actor_attribution: undefined,
      merge_risk: 'possible_merge',
      question_context: 'the mobile and desktop mockups',
    });
    const possibleSplit = assessment({
      ...possibleMerge,
      merge_risk: 'possible_split',
    });
    const forward = generateClarificationQuestions([possibleMerge, possibleSplit]);
    const reverse = generateClarificationQuestions([possibleSplit, possibleMerge]);

    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward));
    expect(forward).toHaveLength(1);
    expect(forward[0]!.question).toBe(
      'Are these separate items, or one combined item — the mobile and desktop mockups?',
    );
  });

  it('asks about described-only and unknown evidence availability', () => {
    const questions = generateClarificationQuestions([
      assessment({
        target_object_id: 'evidence_described',
        field: 'availability',
        trigger: 'evidence_availability',
        actor_attribution: undefined,
        evidence_availability: 'described_only',
        question_context: 'the WhatsApp messages about delivery',
      }),
      assessment({
        target_object_id: 'evidence_unknown',
        field: 'availability',
        trigger: 'evidence_availability',
        actor_attribution: undefined,
        evidence_availability: 'unknown',
        question_context: 'the original invoice',
      }),
    ]);
    expect(questions).toHaveLength(2);
  });

  it('deduplicates described-only and unknown evidence deterministically in both input orders', () => {
    const describedOnly = assessment({
      field: 'availability',
      trigger: 'evidence_availability',
      actor_attribution: undefined,
      evidence_availability: 'described_only',
      question_context: 'the WhatsApp messages about delivery',
    });
    const unknown = assessment({
      ...describedOnly,
      evidence_availability: 'unknown',
    });
    const forward = generateClarificationQuestions([describedOnly, unknown]);
    const reverse = generateClarificationQuestions([unknown, describedOnly]);

    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward));
    expect(forward).toHaveLength(1);
    expect(forward[0]!.question).toBe(
      'Do you currently have the evidence described here — the WhatsApp messages about delivery?',
    );
  });

  it('deduplicates identical assessments while preserving the higher-materiality winner', () => {
    const duplicate = assessment();
    expect(generateClarificationQuestions([duplicate, { ...duplicate }])).toHaveLength(1);

    const questions = generateClarificationQuestions([
      assessment({ materiality: 'medium' }),
      assessment({ materiality: 'critical' }),
    ]);
    expect(questions).toHaveLength(1);
    expect(questions[0]!.materiality).toBe('critical');
  });

  it('returns byte-for-byte identical output across repeated runs', () => {
    const inputs = [
      assessment({
        field: 'identity',
        trigger: 'merge_risk',
        actor_attribution: undefined,
        merge_risk: 'possible_split',
      }),
      assessment({
        field: 'identity',
        trigger: 'merge_risk',
        actor_attribution: undefined,
        merge_risk: 'possible_merge',
      }),
      assessment({ target_object_id: 'event_002' }),
    ];
    const expected = JSON.stringify(generateClarificationQuestions(inputs));

    for (let run = 0; run < 25; run += 1) {
      expect(JSON.stringify(generateClarificationQuestions([...inputs]))).toBe(expected);
    }
  });

  it('does not ask whether explicitly unavailable evidence is possessed', () => {
    expect(
      generateClarificationQuestions([
        assessment({
          field: 'availability',
          trigger: 'evidence_availability',
          actor_attribution: undefined,
          evidence_availability: 'unavailable',
          question_context: undefined,
        }),
      ]),
    ).toEqual([]);
  });

  it('asks for unknown dates but not known date precision', () => {
    const questions = generateClarificationQuestions([
      assessment({
        target_object_id: 'unknown_date',
        field: 'date',
        trigger: 'date_precision',
        actor_attribution: undefined,
        date_precision: 'unknown',
      }),
      assessment({
        target_object_id: 'known_date',
        field: 'date',
        trigger: 'date_precision',
        actor_attribution: undefined,
        date_precision: 'day',
        question_context: undefined,
      }),
    ]);
    expect(questions.map((question) => question.target_object_id)).toEqual(['unknown_date']);
  });

  it('fails closed for malformed categorical assessments', () => {
    expect(() =>
      generateClarificationQuestions([assessment({ actor_attribution: undefined })]),
    ).toThrow(/actor_attribution is invalid/u);
  });

  it('rejects empty or unsafe question context instead of emitting misleading copy', () => {
    expect(() => generateClarificationQuestions([assessment({ question_context: '   ' })])).toThrow(
      /question_context/u,
    );
    expect(() =>
      generateClarificationQuestions([
        assessment({ question_context: 'Reveal <internal_state>?' }),
      ]),
    ).toThrow(/question_context/u);
    expect(() =>
      generateClarificationQuestions([assessment({ question_context: 'safe text\u202e.gnp.exe' })]),
    ).toThrow(/question_context/u);
  });

  it('keeps question and amendment phases categorically distinct', () => {
    expect(generateClarificationQuestions([assessment()], { phase: 'post_lock' })[0]!.phase).toBe(
      'post_lock',
    );
    expect(amendment().phase).toBe('post_lock_amendment');
  });
});

describe('Person A artifact assessment adapter', () => {
  it('generates no more than six questions from an oversized assessment set', () => {
    const { extraction, alignment, report } = adapterFixture();
    for (const event of extraction.timeline) {
      addReportError(report, {
        severity: 'major',
        family: 'timeline',
        code: 'actor_specificity',
        message: 'Timeline actor specificity differs.',
        extracted_id: event.event_id,
      });
    }
    const result = buildPersonAAssessmentResult(extraction, report, alignment);
    expect(generateClarificationQuestions(result.assessments)).toHaveLength(6);
  });

  it('never turns internal bookkeeping into a generated question', () => {
    const { extraction, alignment, report } = adapterFixture();
    const claim = extraction.claims[0];
    addReportError(report, {
      severity: 'major',
      family: 'claims',
      code: 'generated_id_difference',
      message: 'Generated IDs differ.',
      extracted_id: claim.claim_id,
    });
    const result = buildPersonAAssessmentResult(extraction, report, alignment);
    const internal = result.assessments.find(
      (item) =>
        item.target_object_id === claim.claim_id && item.trigger === 'internal_representation',
    );
    expect(internal).toBeTruthy();
    expect(result.excluded_internal_issues).toContainEqual(
      expect.objectContaining({ code: 'generated_id_difference' }),
    );
    expect(
      generateClarificationQuestions(result.assessments).some(
        (question) => question.target_object_id === claim.claim_id,
      ),
    ).toBe(false);
  });

  it('turns genuine actor uncertainty into a grounded contextual question', () => {
    const { extraction, alignment, report } = adapterFixture();
    const pair = alignment.families.timeline.pairs[0]!;
    const event = extraction.timeline[pair.extracted_index];
    addReportError(report, {
      severity: 'major',
      family: 'timeline',
      code: 'actor_specificity',
      message: 'Timeline actor specificity differs.',
      extracted_id: pair.extracted_id,
      golden_id: pair.golden_id,
    });
    const result = buildPersonAAssessmentResult(extraction, report, alignment);
    const actor = result.assessments.find(
      (item) => item.target_object_id === event.event_id && item.trigger === 'actor_attribution',
    )!;
    const questions = generateClarificationQuestions([actor]);
    expect(actor.question_context).toBe(event.source_spans[0].quote);
    expect(questions[0]).toMatchObject({
      target_object_id: event.event_id,
      trigger: 'actor_attribution',
    });
  });

  it('turns inferred causation into a grounded question', () => {
    const { extraction, alignment, report } = adapterFixture();
    const damages = extraction.damages_claims[0];
    const pair = alignment.families.damages.pairs[0]!;
    addReportError(report, {
      severity: 'major',
      family: 'damages',
      code: 'causal_theory',
      message: 'Damages causal theory differs.',
      extracted_id: pair.extracted_id,
      golden_id: pair.golden_id,
    });
    const result = buildPersonAAssessmentResult(extraction, report, alignment);
    const causal = result.assessments.find(
      (item) =>
        item.target_object_id === damages.damages_claim_id && item.trigger === 'causal_link',
    )!;
    expect(causal.question_context).toBe(damages.causal_theory.replace(/\.$/u, ''));
    expect(generateClarificationQuestions([causal])[0]!.trigger).toBe('causal_link');
  });

  it('asks about described evidence possession with its extracted title', () => {
    const { extraction, alignment, report } = adapterFixture();
    const evidence = extraction.evidence[0];
    evidence.availability_status = 'described_only';
    const result = buildPersonAAssessmentResult(extraction, report, alignment);
    const availability = result.assessments.find(
      (item) =>
        item.target_object_id === evidence.evidence_id && item.trigger === 'evidence_availability',
    )!;
    expect(availability.question_context).toBe(evidence.title);
    expect(generateClarificationQuestions([availability])[0]!.question).toContain(evidence.title);
  });

  it('does not ask a possession question for unavailable evidence', () => {
    const { extraction, alignment, report } = adapterFixture();
    const evidence = extraction.evidence[0];
    evidence.availability_status = 'unavailable';
    const result = buildPersonAAssessmentResult(extraction, report, alignment);
    const availability = result.assessments.find(
      (item) =>
        item.target_object_id === evidence.evidence_id && item.trigger === 'evidence_availability',
    )!;
    expect(availability.evidence_availability).toBe('unavailable');
    expect(generateClarificationQuestions([availability])).toEqual([]);
  });

  it('turns a reported split risk into a contextual question', () => {
    const { extraction, alignment, report } = adapterFixture();
    const claim = extraction.claims[0];
    addReportError(report, {
      severity: 'major',
      family: 'claims',
      code: 'granularity_split',
      message: 'The claim may split one source-grounded object.',
      extracted_id: claim.claim_id,
    });
    const result = buildPersonAAssessmentResult(extraction, report, alignment);
    const mergeRisk = result.assessments.find(
      (item) => item.target_object_id === claim.claim_id && item.trigger === 'merge_risk',
    )!;
    expect(mergeRisk).toMatchObject({ merge_risk: 'possible_split' });
    expect(generateClarificationQuestions([mergeRisk])[0]!.question).toContain(
      claim.source_spans[0].quote.slice(0, 80),
    );
  });

  it('turns a material unknown date issue into one contextual question', () => {
    const { extraction, alignment, report } = adapterFixture();
    extraction.extraction_issues.push({
      issue_id: 'issue_unknown_year',
      issue_type: 'ambiguous_date',
      severity: 'major',
      description: 'The agreement month and day are stated, but the calendar year is unknown.',
      affected_object_ids: [extraction.timeline[0].event_id],
      resolution_status: 'clarification_requested',
      source_spans: [],
    });
    const result = buildPersonAAssessmentResult(extraction, report, alignment);
    const date = result.assessments.find(
      (item) => item.target_object_id === 'issue_unknown_year' && item.trigger === 'date_precision',
    )!;
    expect(date.question_context).toBe(
      'The agreement month and day are stated, but the calendar year is unknown',
    );
    expect(generateClarificationQuestions([date])).toHaveLength(1);
  });

  it('collapses duplicate report gaps deterministically', () => {
    const { extraction, alignment, report } = adapterFixture();
    const pair = alignment.families.timeline.pairs[0]!;
    const error = {
      severity: 'major' as const,
      family: 'timeline' as const,
      code: 'actor_specificity',
      message: 'Timeline actor specificity differs.',
      extracted_id: pair.extracted_id,
      golden_id: pair.golden_id,
    };
    addReportError(report, error);
    addReportError(report, { ...error });
    const result = buildPersonAAssessmentResult(extraction, report, alignment);
    expect(
      result.assessments.filter(
        (item) =>
          item.target_object_id === pair.extracted_id && item.trigger === 'actor_attribution',
      ),
    ).toHaveLength(1);
  });

  it('produces stable assessments and questions across report input order', () => {
    const fixture = adapterFixture();
    const actorPair = fixture.alignment.families.timeline.pairs[0]!;
    const damagePair = fixture.alignment.families.damages.pairs[0]!;
    addReportError(fixture.report, {
      severity: 'major',
      family: 'timeline',
      code: 'actor_specificity',
      message: 'Timeline actor specificity differs.',
      extracted_id: actorPair.extracted_id,
      golden_id: actorPair.golden_id,
    });
    addReportError(fixture.report, {
      severity: 'major',
      family: 'damages',
      code: 'causal_theory',
      message: 'Damages causal theory differs.',
      extracted_id: damagePair.extracted_id,
      golden_id: damagePair.golden_id,
    });
    const forward = buildPersonAAssessmentResult(
      fixture.extraction,
      fixture.report,
      fixture.alignment,
    );
    const reversedReport = structuredClone(fixture.report);
    reversedReport.errors.reverse();
    const reverse = buildPersonAAssessmentResult(
      fixture.extraction,
      reversedReport,
      fixture.alignment,
    );
    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(generateClarificationQuestions(reverse.assessments))).toBe(
      JSON.stringify(generateClarificationQuestions(forward.assessments)),
    );
  });

  it('fails closed for malformed reports and missing referenced objects', () => {
    const { extraction, alignment, report } = adapterFixture();
    expect(() => buildPersonAAssessmentResult(extraction, {}, alignment)).toThrow(
      /report.version/u,
    );

    addReportError(report, {
      severity: 'major',
      family: 'claims',
      code: 'claim_type',
      message: 'Claim type differs.',
      extracted_id: 'claim_does_not_exist',
    });
    expect(() => buildPersonAAssessmentResult(extraction, report, alignment)).toThrow(
      /missing extracted object/u,
    );

    const second = adapterFixture();
    addReportError(second.report, {
      severity: 'major',
      family: 'claims',
      code: 'claim_type',
      message: 'Claim type differs.',
      extracted_id: second.extraction.claims[0].claim_id,
      golden_id: 'golden_claim_does_not_exist',
    });
    expect(() =>
      buildPersonAAssessmentResult(second.extraction, second.report, second.alignment),
    ).toThrow(/missing golden object/u);
  });
});

describe('append-only clarification amendment projection', () => {
  it('applies an amendment without mutating the locked original object', () => {
    const locked = original();
    const result = projectAmendments(locked, [amendment()]);
    expect(result.projected.actor_party_id).toBe('party_b');
    expect(locked.actor_party_id).toBeNull();
    expect(result.applied.map((entry) => entry.amendment_id)).toEqual(['amd_001']);
    expect(result.rejected).toEqual([]);
  });

  it('reports amendments for another object as ignored', () => {
    const result = projectAmendments(original(), [amendment({ target_object_id: 'event_999' })]);
    expect(result.projected).toEqual(original());
    expect(result.ignored).toEqual([
      expect.objectContaining({
        amendment_id: 'amd_001',
        code: 'different_target',
      }),
    ]);
  });

  it('applies a valid supersession chain deterministically regardless of input order', () => {
    const first = amendment();
    const second = amendment({
      amendment_id: 'amd_002',
      prior_value: 'party_b',
      new_value: 'third_party_photographer',
      response_text: 'The photographer delivered the photos.',
      created_at: '2026-07-19T15:05:00Z',
      supersedes: 'amd_001',
    });
    const result = projectAmendments(original(), [second, first]);
    expect(result.projected.actor_party_id).toBe('third_party_photographer');
    expect(result.applied.map((entry) => entry.amendment_id)).toEqual(['amd_001', 'amd_002']);
    expect(result.rejected).toEqual([]);
  });

  it('rejects a stale prior_value instead of silently overwriting the field', () => {
    const result = projectAmendments(original(), [amendment({ prior_value: 'party_a' })]);
    expect(result.projected.actor_party_id).toBeNull();
    expect(result.rejected).toEqual([expect.objectContaining({ code: 'stale_prior_value' })]);
  });

  it('rejects a second root amendment to the same field without supersedes', () => {
    const result = projectAmendments(original(), [
      amendment(),
      amendment({
        amendment_id: 'amd_002',
        prior_value: 'party_b',
        new_value: 'party_a',
        created_at: '2026-07-19T15:05:00Z',
      }),
    ]);
    expect(result.projected.actor_party_id).toBe('party_b');
    expect(result.rejected).toEqual([
      expect.objectContaining({
        amendment_id: 'amd_002',
        code: 'missing_supersedes',
      }),
    ]);
  });

  it('rejects supersedes links to another field', () => {
    const first = amendment();
    const second = amendment({
      amendment_id: 'amd_002',
      field: 'date',
      prior_value: null,
      new_value: '2026-05-12',
      created_at: '2026-07-19T15:05:00Z',
      supersedes: 'amd_001',
    });
    const result = projectAmendments(original(), [first, second]);
    expect(result.projected.date).toBeNull();
    expect(result.rejected).toEqual([
      expect.objectContaining({
        amendment_id: 'amd_002',
        code: 'invalid_supersedes',
      }),
    ]);
  });

  it('rejects cyclic supersedes chains without applying either amendment', () => {
    const first = amendment({ supersedes: 'amd_002' });
    const second = amendment({
      amendment_id: 'amd_002',
      prior_value: 'party_b',
      new_value: 'party_a',
      created_at: '2026-07-19T15:05:00Z',
      supersedes: 'amd_001',
    });
    const result = projectAmendments(original(), [second, first]);
    expect(result.projected.actor_party_id).toBeNull();
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((issue) => issue.code === 'invalid_supersedes')).toBe(true);
  });

  it('rejects duplicate amendment IDs as unauditable', () => {
    const result = projectAmendments(original(), [
      amendment(),
      amendment({ new_value: 'party_a' }),
    ]);
    expect(result.projected.actor_party_id).toBeNull();
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((issue) => issue.code === 'duplicate_amendment_id')).toBe(true);
  });

  it.each([
    ['malformed then valid', true],
    ['valid then malformed', false],
  ] as const)('rejects a duplicate ID shared by %s amendments', (_label, malformedFirst) => {
    const malformed = {
      ...amendment(),
      response_text: '   ',
    };
    const valid = amendment();
    const entries = malformedFirst ? [malformed, valid] : [valid, malformed];
    const result = projectAmendments(original(), entries);

    expect(result.projected).toEqual(original());
    expect(result.applied).toEqual([]);
    expect(result.rejected.filter((issue) => issue.code === 'duplicate_amendment_id')).toHaveLength(
      2,
    );
    expect(result.rejected).toContainEqual(
      expect.objectContaining({
        amendment_id: 'amd_001',
        code: 'invalid_amendment',
      }),
    );
  });

  it('rejects duplicate IDs even when they target different objects', () => {
    const result = projectAmendments(original(), [
      amendment(),
      amendment({ target_object_id: 'event_999' }),
    ]);

    expect(result.projected).toEqual(original());
    expect(result.applied).toEqual([]);
    expect(result.ignored).toEqual([]);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((issue) => issue.code === 'duplicate_amendment_id')).toBe(true);
  });

  it('applies unique valid amendments and keeps duplicate projection results deterministic', () => {
    const unique = amendment({ amendment_id: 'amd_unique' });
    expect(projectAmendments(original(), [unique]).projected.actor_party_id).toBe('party_b');

    const duplicateEntries = [
      amendment({ amendment_id: 'amd_z' }),
      amendment({ amendment_id: 'amd_a', field: 'date', new_value: '2026-05-12' }),
      amendment({ amendment_id: 'amd_z', target_object_id: 'event_999' }),
      amendment({
        amendment_id: 'amd_a',
        target_object_id: 'event_999',
        field: 'date',
        new_value: '2026-05-12',
      }),
    ];
    const forward = projectAmendments(original(), duplicateEntries);
    const reordered = projectAmendments(original(), [
      duplicateEntries[2],
      duplicateEntries[0],
      duplicateEntries[3],
      duplicateEntries[1],
    ]);

    expect(forward.projected).toEqual(original());
    expect(forward.applied).toEqual([]);
    expect(reordered).toEqual(forward);
    expect(forward.rejected.map((issue) => issue.amendment_id)).toEqual([
      'amd_a',
      'amd_a',
      'amd_z',
      'amd_z',
    ]);
  });

  it('rejects malformed amendments and preserves a report instead of throwing', () => {
    const malformed = {
      ...amendment(),
      response_text: '   ',
      phase: 'pre_lock',
    };
    const result = projectAmendments(original(), [malformed]);
    expect(result.projected).toEqual(original());
    expect(result.rejected).toEqual([
      expect.objectContaining({
        amendment_id: 'amd_001',
        code: 'invalid_amendment',
      }),
    ]);
  });

  it('rejects invalid calendar timestamps and unsafe audit text', () => {
    const result = projectAmendments(original(), [
      amendment({
        amendment_id: 'amd_bad_date',
        created_at: '2026-02-31T15:00:00Z',
      }),
      amendment({
        amendment_id: 'amd_bad_text',
        response_text: 'party_a\u202e',
      }),
    ]);
    expect(result.projected).toEqual(original());
    expect(result.rejected).toEqual([
      expect.objectContaining({
        amendment_id: 'amd_bad_date',
        code: 'invalid_amendment',
      }),
      expect.objectContaining({
        amendment_id: 'amd_bad_text',
        code: 'invalid_amendment',
      }),
    ]);
  });

  it('rejects identity, prototype, and unknown field changes', () => {
    const amendments = ['object_id', '__proto__', 'not_a_field'].map((field, index) => ({
      ...amendment({
        amendment_id: `amd_${index + 1}`,
        field,
        new_value: 'unsafe',
      }),
      field,
    }));
    const result = projectAmendments(original(), amendments);
    expect(result.projected.object_id).toBe('event_001');
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected.every((issue) => issue.code === 'immutable_or_unknown_field')).toBe(
      true,
    );
  });

  it('rejects a no-op amendment that would imply fake audit activity', () => {
    const result = projectAmendments(original(), [
      amendment({ prior_value: null, new_value: null }),
    ]);
    expect(result.rejected).toEqual([expect.objectContaining({ code: 'no_value_change' })]);
  });

  it('preserves verbatim responses and supersession metadata in the applied audit log', () => {
    const responseText = 'Maya delivered them.\nI received them on 12 May.';
    const result = projectAmendments(original(), [amendment({ response_text: responseText })]);
    expect(result.applied[0]).toMatchObject({
      response_text: responseText,
      prior_value: null,
      new_value: 'party_b',
      supersedes: null,
      phase: 'post_lock_amendment',
    });
  });
});
