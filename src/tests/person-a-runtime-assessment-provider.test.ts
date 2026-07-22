import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  parseAssessPersonARuntimeArgs,
  runAssessPersonARuntimeCommand,
  type AssessPersonARuntimeCommandDependencies,
} from '../commands/assess-person-a-runtime.js';
import {
  classifyQuestionNecessity,
  generateNecessaryClarificationQuestions,
} from '../clarification/question-necessity.js';
import {
  DETERMINISTIC_PERSON_A_RULE_IDS,
  assessDeterministicPersonAEpistemicGaps,
  createDeterministicPersonAAssessmentProvider,
  type DeterministicPersonAAssessmentConfig,
} from '../runtime/deterministic-person-a-assessment-provider.js';
import {
  MAX_RUNTIME_ASSESSMENT_BATCH_SIZE,
  orchestratePersonAPlanning,
  type RuntimeAssessmentContext,
} from '../runtime/person-a-runtime-orchestrator.js';
import { createStaticRuntimeAssessmentProvider } from '../runtime/static-assessment-provider.js';
import { validPersonAExtraction } from './person-a-test-helpers.js';

type JsonObject = Record<string, any>;

function exactSpan(narrative: string, quote: string) {
  const start = narrative.indexOf(quote);
  if (start < 0) throw new Error(`Missing test quote: ${quote}`);
  return {
    submission_id: 'sub_a_extracted',
    quote,
    start_char: start,
    end_char: start + quote.length,
  };
}

function baseContext(): RuntimeAssessmentContext {
  const extraction = validPersonAExtraction();
  const narrative = extraction.submission.raw_text as string;
  extraction.timeline = [];
  extraction.evidence = [];
  extraction.damages_claims = [];
  extraction.agreement.terms = [];
  extraction.extraction_issues = [];
  extraction.deliverable_assessments = [];
  return {
    original_extraction: structuredClone(extraction),
    repaired_extraction: extraction,
    narrative,
    repair_audit: {
      repaired_extraction: extraction,
      applied_repairs: [],
      skipped_repairs: [],
      rejected_repairs: [],
      audit_summary: {
        version: 'person-a-record-repair-v0.1.1',
        repairs_applied: 0,
        repairs_skipped: 0,
        repairs_rejected: 0,
        repairs_applied_by_rule: {},
        objects_changed: [],
      },
    },
  };
}

function addTimeline(
  context: RuntimeAssessmentContext,
  overrides: Partial<JsonObject> = {},
): JsonObject {
  const quote = 'I sent what I considered a complete staging version on June 3.';
  const item = {
    event_id: 'event_test',
    event_summary: 'A complete staging version was sent on June 3.',
    date: { start: null, end: null, precision: 'unknown', approximate: false },
    actor_party_id: null,
    actor_third_party_id: null,
    materiality: 'high',
    source_spans: [exactSpan(context.narrative, quote)],
    ...overrides,
  };
  context.repaired_extraction.timeline.push(item);
  return item;
}

function addEvidence(
  context: RuntimeAssessmentContext,
  overrides: Partial<JsonObject> = {},
): JsonObject {
  const item = {
    evidence_id: 'evidence_test',
    title: 'Post-staging change list',
    description_from_submitter: 'The submitter described a list of requested changes.',
    availability_status: 'described_only',
    inspection_status: null,
    ...overrides,
  };
  context.repaired_extraction.evidence.push(item);
  const claimId = `claim_for_${item.evidence_id}`;
  const quote = 'Maya replied that it “looked really good overall” but gave me a list of changes.';
  context.repaired_extraction.claims.push({
    claim_id: claimId,
    claim_text: 'Maya supplied a post-staging list of requested changes.',
    source_spans: [exactSpan(context.narrative, quote)],
  });
  context.repaired_extraction.claim_evidence_links.push({
    link_id: `link_for_${item.evidence_id}`,
    claim_id: claimId,
    evidence_id: item.evidence_id,
  });
  return item;
}

function addDamages(
  context: RuntimeAssessmentContext,
  overrides: Partial<JsonObject> = {},
): JsonObject {
  const claimId = 'claim_for_damages_test';
  const quote =
    'I want JuryAI to consider that much of the schedule delay came from late content, added requests, and repeated changes.';
  const item = {
    damages_claim_id: 'damages_test',
    causal_theory: 'The schedule delay may have resulted in the claimed loss.',
    source_claim_ids: [claimId],
    materiality: 'high',
    ...overrides,
  };
  context.repaired_extraction.claims.push({
    claim_id: claimId,
    claim_text: 'The submitter attributes schedule delay to late content and added requests.',
    source_spans: [exactSpan(context.narrative, quote)],
  });
  context.repaired_extraction.damages_claims.push(item);
  return item;
}

function addTerm(
  context: RuntimeAssessmentContext,
  overrides: Partial<JsonObject> = {},
): JsonObject {
  const quote = 'with the balance due when the project was completed.';
  const item = {
    term_id: 'term_test',
    wording: 'The balance was due when the project was completed.',
    person_a_interpretation: null,
    materiality: 'high',
    source_spans: [exactSpan(context.narrative, quote)],
    ...overrides,
  };
  context.repaired_extraction.agreement.terms.push(item);
  return item;
}

function addIssue(
  context: RuntimeAssessmentContext,
  overrides: Partial<JsonObject> = {},
): JsonObject {
  const complete = 'I sent what I considered a complete staging version on June 3.';
  const unfinished = 'I made most of them during the following week.';
  const item = {
    issue_id: 'issue_test',
    issue_type: 'internal_tension',
    severity: 'major',
    description:
      'The staging version was described as complete, but most rather than all changes were made later.',
    affected_object_ids: [],
    source_spans: [
      exactSpan(context.narrative, complete),
      exactSpan(context.narrative, unfinished),
    ],
    ...overrides,
  };
  context.repaired_extraction.extraction_issues.push(item);
  return item;
}

function addDateIssue(
  context: RuntimeAssessmentContext,
  first: string,
  second: string,
): JsonObject {
  context.narrative = `${context.narrative}\n${first}\n${second}`;
  const item = {
    issue_id: 'issue_date_test',
    issue_type: 'internal_tension',
    severity: 'major',
    description: 'Two statements inconsistently identify the same material event date.',
    affected_object_ids: [],
    source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
  };
  context.repaired_extraction.extraction_issues.push(item);
  return item;
}

function run(context: RuntimeAssessmentContext, config: DeterministicPersonAAssessmentConfig = {}) {
  return assessDeterministicPersonAEpistemicGaps(context, config);
}

function assertPlainJson(value: unknown): void {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  expect(typeof value).toBe('object');
  const object = value as object;
  expect([Object.prototype, Array.prototype]).toContain(Object.getPrototypeOf(object));
  if (Array.isArray(value)) value.forEach(assertPlainJson);
  else Object.values(value as JsonObject).forEach(assertPlainJson);
}

describe('deterministic Person A runtime assessment provider', () => {
  it('declares the stable, narrow production rule IDs', () => {
    expect(DETERMINISTIC_PERSON_A_RULE_IDS).toEqual([
      'runtime_actor_attribution_v1',
      'runtime_material_date_precision_v1',
      'runtime_evidence_availability_v1',
      'runtime_causal_link_v1',
      'runtime_nullable_interpretation_v1',
      'runtime_material_contradiction_v1',
      'runtime_internal_representation_v1',
    ]);
  });

  it('has no laboratory, model, secret, environment, network, or persistence dependency', () => {
    const sources = [
      'src/runtime/deterministic-person-a-assessment-provider.ts',
      'src/commands/assess-person-a-runtime.ts',
    ]
      .map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))
      .join('\n');
    expect(sources).not.toMatch(
      /from\s+['"][^'"]*(?:alignment|evaluation|golden|artifacts|openai|database|supabase)[^'"]*['"]/iu,
    );
    expect(sources).not.toMatch(
      /OPENAI_API_KEY|process\.env|new\s+OpenAI|fetch\s*\(|live-run-|expected_object|semantic_precision|semantic_recall|human_edit_rate|weighted_error/iu,
    );
  });

  it('returns deterministic detached plain JSON', () => {
    const context = baseContext();
    addEvidence(context);
    const provider = createDeterministicPersonAAssessmentProvider();
    const first = provider.assess(context);
    const firstAudit = provider.getLastAudit();
    const bytes = JSON.stringify({ first, firstAudit });
    context.repaired_extraction.evidence[0].title = 'mutated after assessment';
    expect(JSON.stringify({ first, firstAudit })).toBe(bytes);
    assertPlainJson(first);
    assertPlainJson(firstAudit);
    const repeated = run(baseContext());
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(run(baseContext())));
  });

  it('detects a material actor gap only for an actor-bearing grounded action', () => {
    const context = baseContext();
    const quote = 'some small text changes kept coming after that.';
    addTimeline(context, {
      event_summary: 'Small text changes kept coming after the last major content batch.',
      source_spans: [exactSpan(context.narrative, quote)],
    });
    const result = run(context);
    expect(result.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_object_id: 'event_test',
          trigger: 'actor_attribution',
          actor_attribution: 'unstated',
        }),
      ]),
    );
  });

  it('suppresses actor questions when the exact span states the actor', () => {
    const context = baseContext();
    addTimeline(context);
    const result = run(context);
    expect(result.assessments.some((item) => item.trigger === 'actor_attribution')).toBe(false);
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: 'actor_already_explicit_in_source' }),
      ]),
    );
  });

  it('does not treat a passive first-person recipient as the action actor', () => {
    const context = baseContext();
    const quote = 'I was sent the invoice.';
    context.narrative = `${context.narrative}\n${quote}`;
    addTimeline(context, {
      event_summary: 'The invoice was sent to the submitter.',
      source_spans: [exactSpan(context.narrative, quote)],
    });
    const result = run(context);
    expect(result.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_object_id: 'event_test',
          trigger: 'actor_attribution',
          actor_attribution: 'unstated',
        }),
      ]),
    );
  });

  it('detects one grouped materially unknown calendar year', () => {
    const context = baseContext();
    addTimeline(context, {
      event_summary: 'The contractual deadline was June 3, with no calendar year supplied.',
    });
    addTimeline(context, {
      event_id: 'event_test_2',
      event_summary: 'The balance was due after completion in June, with no year supplied.',
    });
    const result = run(context);
    const dates = result.assessments.filter((item) => item.trigger === 'date_precision');
    expect(dates).toHaveLength(1);
    expect(dates[0]?.date_precision).toBe('unknown');
    expect(dates[0]?.resolves_object_ids).toEqual(['event_test', 'event_test_2']);
  });

  it('suppresses a missing year that is not materially necessary', () => {
    const context = baseContext();
    addTimeline(context, {
      event_summary: 'A general status discussion happened in June.',
      materiality: 'medium',
    });
    const result = run(context);
    expect(result.assessments.some((item) => item.trigger === 'date_precision')).toBe(false);
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: 'missing_year_not_materially_necessary' }),
      ]),
    );
  });

  it('creates a bounded availability assessment for described-only evidence', () => {
    const context = baseContext();
    addEvidence(context);
    expect(run(context).assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_object_id: 'evidence_test',
          trigger: 'evidence_availability',
          evidence_availability: 'described_only',
          question_context: 'Post-staging change list',
        }),
      ]),
    );
    const emittedAudit = run(context).audit.rule_results.find(
      (item) => item.reason_code === 'current_evidence_availability_unknown',
    );
    expect(emittedAudit?.grounding_references).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'source_span' })]),
    );
  });

  it('fails closed when described evidence has no exact linked-claim grounding', () => {
    const context = baseContext();
    context.repaired_extraction.evidence.push({
      evidence_id: 'evidence_ungrounded',
      title: 'Unlinked artifact',
      description_from_submitter: 'An artifact was described.',
      availability_status: 'described_only',
      inspection_status: null,
    });
    const result = run(context);
    expect(result.assessments).toEqual([]);
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'rejected',
          reason_code: 'evidence_source_grounding_missing',
        }),
      ]),
    );
  });

  it('does not ask for unavailable evidence', () => {
    const context = baseContext();
    addEvidence(context, { availability_status: 'unavailable' });
    const result = run(context);
    expect(result.assessments).toEqual([]);
    expect(result.audit.rule_results[0]?.reason_code).toBe('evidence_explicitly_unavailable');
  });

  it('detects an inferred or unstated causal link', () => {
    const context = baseContext();
    addDamages(context, { causal_theory: 'The delay may have caused lost bookings.' });
    const result = run(context);
    expect(result.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trigger: 'causal_link',
          causal_link_status: 'inferred',
        }),
      ]),
    );
    const necessity = classifyQuestionNecessity(result.assessments, context.repaired_extraction);
    expect(necessity.question_candidates).toHaveLength(1);
  });

  it('fails closed when an inferred causal theory lacks exact referenced-claim grounding', () => {
    const context = baseContext();
    addDamages(context, { source_claim_ids: ['missing_claim'] });
    const result = run(context);
    expect(result.assessments).toEqual([]);
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'rejected',
          reason_code: 'causal_source_grounding_missing',
        }),
      ]),
    );
  });

  it('detects a disputed causal link only with two independently grounded claims', () => {
    const context = baseContext();
    const damages = addDamages(context, {
      causal_theory: 'The record identifies conflicting explanations for the schedule delay.',
    });
    const secondClaimId = 'claim_for_damages_alternative';
    const secondQuote =
      'She says I disappeared for two weeks. That is exaggerated. I was slower for part of one week because of a family issue, but I still replied to messages and told her what was happening.';
    context.repaired_extraction.claims.push({
      claim_id: secondClaimId,
      claim_text: 'The submitter identifies a family issue as another source of delay.',
      source_spans: [exactSpan(context.narrative, secondQuote)],
    });
    damages.source_claim_ids.push(secondClaimId);
    const result = run(context);
    expect(result.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trigger: 'causal_link', causal_link_status: 'disputed' }),
      ]),
    );
    const necessity = classifyQuestionNecessity(result.assessments, context.repaired_extraction);
    expect(necessity.question_candidates[0]?.classification).toBe('contradiction');
    expect(necessity.question_candidates[0]?.contradiction_alternatives).toHaveLength(2);
    const questions = generateNecessaryClarificationQuestions(necessity.question_candidates);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      target_object_id: 'damages_test',
      trigger: 'causal_link',
      necessity_classification: 'contradiction',
    });
    expect(questions[0]?.contradiction_alternatives).toHaveLength(2);
    for (const alternative of questions[0]!.contradiction_alternatives) {
      expect(questions[0]!.question).toContain(alternative.text.slice(0, 80));
      expect(alternative.grounding_references).toHaveLength(1);
    }
    expect(
      generateNecessaryClarificationQuestions([
        ...necessity.question_candidates,
        ...necessity.question_candidates,
      ]),
    ).toHaveLength(1);
    const mixedNecessity = classifyQuestionNecessity(
      [...result.assessments, { ...result.assessments[0]!, causal_link_status: 'inferred' }],
      context.repaired_extraction,
    );
    const mixedQuestions = generateNecessaryClarificationQuestions(
      mixedNecessity.question_candidates,
    );
    expect(mixedQuestions).toHaveLength(1);
    expect(mixedQuestions[0]?.necessity_classification).toBe('contradiction');
  });

  it.each([
    ['causal link not stated', 'unstated'],
    ['causal relationship is unclear', 'unstated'],
    ['cause unknown', 'unstated'],
    ['no causal explanation provided', 'unstated'],
    ['the delay may have caused the loss', 'inferred'],
  ] as const)('classifies grounded causal theory %j as %s', (causalTheory, expectedStatus) => {
    const context = baseContext();
    addDamages(context, { causal_theory: causalTheory });
    const result = run(context);
    expect(result.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trigger: 'causal_link',
          causal_link_status: expectedStatus,
        }),
      ]),
    );
    const necessity = classifyQuestionNecessity(result.assessments, context.repaired_extraction);
    expect(necessity.question_candidates).toHaveLength(1);
    expect(generateNecessaryClarificationQuestions(necessity.question_candidates)).toHaveLength(1);
  });

  it.each([
    'The lost bookings may have been caused by the delayed launch.',
    'The lost bookings could be caused by the delay.',
    'The loss might have resulted from the delayed launch.',
  ])('classifies passive-modal causal theory as inferred: %j', (causalTheory) => {
    const context = baseContext();
    addDamages(context, { causal_theory: causalTheory });
    const result = run(context);
    expect(result.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trigger: 'causal_link', causal_link_status: 'inferred' }),
      ]),
    );
    const necessity = classifyQuestionNecessity(result.assessments, context.repaired_extraction);
    expect(generateNecessaryClarificationQuestions(necessity.question_candidates)).toHaveLength(1);
  });

  it('fails closed on generic uncertainty unrelated to causation', () => {
    const context = baseContext();
    addDamages(context, { causal_theory: 'The schedule is unclear.' });
    const result = run(context);
    expect(result.assessments).toEqual([]);
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'rejected', reason_code: 'causal_status_ambiguous' }),
      ]),
    );
  });

  it('suppresses an explicit causal link', () => {
    const context = baseContext();
    addDamages(context, { causal_theory: 'The missed launch directly caused the claimed loss.' });
    const result = run(context);
    expect(result.assessments.some((item) => item.trigger === 'causal_link')).toBe(false);
    expect(result.audit.rule_results[0]?.reason_code).toBe('causal_link_explicit');
  });

  it.each([
    ['June 3, 2024', 'June 3, 2025', true],
    ['June 3, 2024', 'June 4, 2024', true],
    ['June 3, 2024', 'June 3, 2024', false],
    ['June 3', 'June 3, 2025', false],
    ['June 2024', 'June 2025', true],
    ['June 2024', 'June 3, 2024', false],
    ['3 June 2024', 'June 3, 2024', false],
    ['2024-06-03', '2025-06-03', true],
    ['03/06/2024', '06/03/2024', false],
  ] as const)(
    'normalizes material dates %j and %j without guessing',
    (firstDate, secondDate, expectedContradiction) => {
      const context = baseContext();
      addDateIssue(
        context,
        `The same event occurred on ${firstDate}.`,
        `The same event occurred on ${secondDate}.`,
      );
      const result = run(context);
      const contradictions = result.assessments.filter(
        (assessment) =>
          assessment.trigger === 'required_bucket_missing' &&
          assessment.target_object_id === 'issue_date_test',
      );
      expect(contradictions).toHaveLength(expectedContradiction ? 1 : 0);
      if (expectedContradiction) {
        const necessity = classifyQuestionNecessity(contradictions, context.repaired_extraction);
        const questions = generateNecessaryClarificationQuestions(necessity.question_candidates);
        expect(questions).toHaveLength(1);
        expect(questions[0]?.question).toContain(firstDate);
        expect(questions[0]?.question).toContain(secondDate);
        expect(questions[0]?.contradiction_alternatives).toHaveLength(2);
      }
    },
  );

  it('suppresses year clarification when the exact source already supplies a year', () => {
    const context = baseContext();
    const quote = 'The material deadline was June 3, 2024.';
    context.narrative = `${context.narrative}\n${quote}`;
    addTimeline(context, {
      event_summary: 'The material deadline was June 3, 2024.',
      source_spans: [exactSpan(context.narrative, quote)],
    });
    const result = run(context);
    expect(result.assessments.some((assessment) => assessment.trigger === 'date_precision')).toBe(
      false,
    );
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'runtime_material_date_precision_v1',
          status: 'suppressed',
          reason_code: 'calendar_year_explicit_in_source',
        }),
      ]),
    );
  });

  it('suppresses year clarification when the exact source supplies a month and year', () => {
    const context = baseContext();
    const quote = 'The material deadline was June 2024.';
    context.narrative = `${context.narrative}\n${quote}`;
    addTimeline(context, {
      event_summary: 'The material deadline was June 2024.',
      source_spans: [exactSpan(context.narrative, quote)],
    });
    const result = run(context);
    expect(result.assessments.some((assessment) => assessment.trigger === 'date_precision')).toBe(
      false,
    );
    const audit = result.audit.rule_results.find(
      (item) => item.reason_code === 'calendar_year_explicit_in_source',
    );
    expect(audit).toMatchObject({
      rule_id: 'runtime_material_date_precision_v1',
      status: 'suppressed',
      grounding_references: [
        expect.objectContaining({
          kind: 'source_span',
          object_id: 'event_test',
          quote_preview: quote,
        }),
      ],
    });
  });

  it('recognizes a comma-separated month and year without inventing a day', () => {
    const context = baseContext();
    const quote = 'The material deadline was June, 2024.';
    context.narrative = `${context.narrative}\n${quote}`;
    addTimeline(context, {
      event_summary: 'The material deadline was June, 2024.',
      source_spans: [exactSpan(context.narrative, quote)],
    });
    const result = run(context);
    expect(result.assessments.some((assessment) => assessment.trigger === 'date_precision')).toBe(
      false,
    );
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: 'calendar_year_explicit_in_source' }),
      ]),
    );
  });

  it('still asks for a materially necessary year when only the month is grounded', () => {
    const context = baseContext();
    const quote = 'The material deadline was in June.';
    context.narrative = `${context.narrative}\n${quote}`;
    addTimeline(context, {
      event_summary: 'The material deadline was in June.',
      source_spans: [exactSpan(context.narrative, quote)],
    });
    expect(run(context).assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_object_id: 'event_test',
          trigger: 'date_precision',
          date_precision: 'unknown',
        }),
      ]),
    );
  });

  it.each([
    'Payment may be due after review.',
    'The result may change after review.',
    'May be due after review.',
  ])('does not treat modal may as a calendar month in %j', (quote) => {
    const context = baseContext();
    context.narrative = `${context.narrative}\n${quote}`;
    addTimeline(context, {
      event_summary: quote,
      source_spans: [exactSpan(context.narrative, quote)],
    });
    const result = run(context);
    expect(result.assessments.some((assessment) => assessment.trigger === 'date_precision')).toBe(
      false,
    );
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: 'missing_year_not_materially_necessary' }),
      ]),
    );
  });

  it('recognizes an explicitly capitalized May month reference', () => {
    const context = baseContext();
    const quote = 'Payment was due in May.';
    context.narrative = `${context.narrative}\n${quote}`;
    addTimeline(context, {
      event_summary: quote,
      source_spans: [exactSpan(context.narrative, quote)],
    });
    expect(run(context).assessments).toEqual(
      expect.arrayContaining([expect.objectContaining({ trigger: 'date_precision' })]),
    );
  });

  it('recognizes The May deadline as a calendar-only month reference', () => {
    const context = baseContext();
    const quote = 'The May deadline remained material.';
    context.narrative = `${context.narrative}\n${quote}`;
    addTimeline(context, {
      event_summary: quote,
      source_spans: [exactSpan(context.narrative, quote)],
    });
    expect(run(context).assessments).toEqual(
      expect.arrayContaining([expect.objectContaining({ trigger: 'date_precision' })]),
    );
  });

  it.each(['Payment was due on May 3.', 'PAYMENT was DUE on May 3.'])(
    'recognizes a real May month-day in mixed prose: %j',
    (quote) => {
      const context = baseContext();
      context.narrative = `${context.narrative}\n${quote}`;
      addTimeline(context, {
        event_summary: quote,
        source_spans: [exactSpan(context.narrative, quote)],
      });
      expect(run(context).assessments).toEqual(
        expect.arrayContaining([expect.objectContaining({ trigger: 'date_precision' })]),
      );
    },
  );

  it('suppresses a calendar-year question for May 2024', () => {
    const context = baseContext();
    const quote = 'The material deadline was May 2024.';
    context.narrative = `${context.narrative}\n${quote}`;
    addTimeline(context, {
      event_summary: quote,
      source_spans: [exactSpan(context.narrative, quote)],
    });
    const result = run(context);
    expect(result.assessments.some((item) => item.trigger === 'date_precision')).toBe(false);
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason_code: 'calendar_year_explicit_in_source' }),
      ]),
    );
  });

  it('matches material date terms as whole words', () => {
    const context = baseContext();
    const quote = 'Ruby sent files on June 3.';
    context.narrative = `${context.narrative}\n${quote}`;
    addTimeline(context, {
      event_summary: 'Ruby sent files on June 3.',
      source_spans: [exactSpan(context.narrative, quote)],
    });
    const result = run(context);
    expect(result.assessments.some((assessment) => assessment.trigger === 'date_precision')).toBe(
      false,
    );
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'runtime_material_date_precision_v1',
          status: 'suppressed',
          reason_code: 'missing_year_not_materially_necessary',
        }),
      ]),
    );
  });

  it.each([
    ['The work is due June 3.', true],
    ['Payment was due on June 3.', true],
    ['Submit by June 3.', true],
    ['Standby until June 3.', false],
    ['The invoice was overdue since June 3.', false],
    ['Payment was due: June 3.', true],
    ['Payment was DUE June 3.', true],
    ['Ruby and Buddy exchanged files on June 3.', false],
  ] as const)('applies whole-token materiality to %j', (quote, expectedAssessment) => {
    const context = baseContext();
    context.narrative = `${context.narrative}\n${quote}`;
    addTimeline(context, {
      event_summary: quote,
      source_spans: [exactSpan(context.narrative, quote)],
    });
    expect(run(context).assessments.some((item) => item.trigger === 'date_precision')).toBe(
      expectedAssessment,
    );
  });

  it('matches configured multiword material terms only as complete phrases', () => {
    const matching = baseContext();
    const matchingQuote = 'The balance due date was June 3.';
    matching.narrative = `${matching.narrative}\n${matchingQuote}`;
    addTimeline(matching, {
      event_summary: matchingQuote,
      source_spans: [exactSpan(matching.narrative, matchingQuote)],
    });
    expect(
      run(matching, { materialDateTerms: ['balance due'] }).assessments.some(
        (item) => item.trigger === 'date_precision',
      ),
    ).toBe(true);

    const nonmatching = baseContext();
    const nonmatchingQuote = 'The balance was overdue on June 3.';
    nonmatching.narrative = `${nonmatching.narrative}\n${nonmatchingQuote}`;
    addTimeline(nonmatching, {
      event_summary: nonmatchingQuote,
      source_spans: [exactSpan(nonmatching.narrative, nonmatchingQuote)],
    });
    expect(
      run(nonmatching, { materialDateTerms: ['balance due'] }).assessments.some(
        (item) => item.trigger === 'date_precision',
      ),
    ).toBe(false);
  });

  it('detects a source-grounded nullable interpretation gap', () => {
    const context = baseContext();
    addTerm(context);
    expect(run(context).assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trigger: 'required_bucket_missing',
          target_family: 'agreement_terms',
          field: 'person_a_interpretation',
        }),
      ]),
    );
  });

  it('suppresses a populated interpretation', () => {
    const context = baseContext();
    addTerm(context, { person_a_interpretation: 'Completion triggered the balance.' });
    const result = run(context);
    expect(result.assessments).toEqual([]);
    expect(result.audit.rule_results[0]?.reason_code).toBe('interpretation_already_explicit');
  });

  it('produces one material contradiction with two independently grounded alternatives', () => {
    const context = baseContext();
    addIssue(context);
    const result = run(context);
    expect(result.assessments).toHaveLength(1);
    const necessity = classifyQuestionNecessity(result.assessments, context.repaired_extraction);
    expect(necessity.question_candidates).toHaveLength(1);
    expect(necessity.question_candidates[0]?.classification).toBe('contradiction');
    expect(
      necessity.question_candidates[0]?.contradiction_alternatives.length,
    ).toBeGreaterThanOrEqual(2);
    for (const alternative of necessity.question_candidates[0]!.contradiction_alternatives) {
      expect(alternative.grounding_references).toHaveLength(1);
    }
  });

  it('does not misclassify an ordinary qualification as a contradiction', () => {
    const context = baseContext();
    const first =
      'Maya replied that it “looked really good overall” but gave me a list of changes.';
    const second = 'I fixed the issues I could reproduce.';
    addIssue(context, {
      description: 'The positive overall reaction was qualified by ordinary requested changes.',
      source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
    });
    const result = run(context);
    expect(result.assessments).toEqual([]);
    expect(result.audit.rule_results[0]?.reason_code).toBe(
      'no_deterministic_material_contradiction',
    );
  });

  it('does not treat negative-only completion wording as a contradiction', () => {
    const context = baseContext();
    const first = 'The website was not even close to complete.';
    const second = 'The mobile layout remained incomplete.';
    context.narrative = `${context.narrative}\n${first}\n${second}`;
    addIssue(context, {
      description: 'Both statements describe unfinished work.',
      source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
    });
    const result = run(context);
    expect(result.assessments).toEqual([]);
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'suppressed',
          reason_code: 'no_deterministic_material_contradiction',
        }),
      ]),
    );
  });

  it('requires a separately grounded affirmative completion statement', () => {
    const context = baseContext();
    const first = 'The website was complete.';
    const second = 'The mobile layout remained unfinished.';
    context.narrative = `${context.narrative}\n${first}\n${second}`;
    addIssue(context, {
      description: 'The statements conflict about whether the work was complete.',
      source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
    });
    const result = run(context);
    expect(result.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_object_id: 'issue_test',
          trigger: 'required_bucket_missing',
        }),
      ]),
    );
  });

  it('does not treat negated unfinished wording as a completion contradiction', () => {
    const context = baseContext();
    const first = 'The website was complete.';
    const second = 'No issues remained.';
    context.narrative = `${context.narrative}\n${first}\n${second}`;
    addIssue(context, {
      description: 'Both statements describe completed work without remaining issues.',
      source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
    });
    const result = run(context);
    expect(result.assessments).toEqual([]);
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'suppressed',
          reason_code: 'no_deterministic_material_contradiction',
        }),
      ]),
    );
  });

  it('normalizes equivalent count words and numerals before conflict detection', () => {
    const context = baseContext();
    const first = 'The agreed scope included four deliverables.';
    const second = 'The agreed scope included 4 deliverables.';
    context.narrative = `${context.narrative}\n${first}\n${second}`;
    addIssue(context, {
      issue_type: 'ambiguous_scope',
      description: 'The deliverable count is written in two equivalent forms.',
      source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
    });
    expect(run(context).assessments).toEqual([]);
  });

  it('ignores date numbers and unrelated count units in scope conflict detection', () => {
    const context = baseContext();
    const first = 'The deadline was June 3.';
    const second = 'The agreed scope included five pages and two revision rounds.';
    context.narrative = `${context.narrative}\n${first}\n${second}`;
    addIssue(context, {
      issue_type: 'ambiguous_scope',
      description: 'The number references describe a date, pages, and revision rounds.',
      source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
    });
    expect(run(context).assessments).toEqual([]);
  });

  it('emits merge risk only for conflicting normalized counts of the same scope unit', () => {
    const context = baseContext();
    const first = 'The agreed scope included four deliverables.';
    const second = 'The agreed scope included 5 deliverables.';
    context.narrative = `${context.narrative}\n${first}\n${second}`;
    addIssue(context, {
      issue_type: 'ambiguous_scope',
      description: 'The deliverable count conflicts: four versus five.',
      source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
    });
    const result = run(context);
    expect(result.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trigger: 'merge_risk', merge_risk: 'possible_split' }),
      ]),
    );
    const necessity = classifyQuestionNecessity(result.assessments, context.repaired_extraction);
    expect(
      necessity.question_candidates[0]?.grounding_references.filter(
        (reference) => reference.kind === 'source_span',
      ),
    ).toHaveLength(2);
    expect(JSON.stringify(result)).toBe(JSON.stringify(run(structuredClone(context))));
  });

  it('does not compare equal item and page counts as the same scoped thing', () => {
    const context = baseContext();
    const first = 'The package included three items.';
    const second = 'The website included three pages.';
    context.narrative = `${context.narrative}\n${first}\n${second}`;
    addIssue(context, {
      issue_type: 'ambiguous_scope',
      description: 'The item and page counts describe different scoped things.',
      source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
    });
    expect(run(context).assessments).toEqual([]);
  });

  it('detects incompatible task counts only for the same grounded task scope', () => {
    const context = baseContext();
    const first = 'The migration included three tasks.';
    const second = 'The migration included five tasks.';
    context.narrative = `${context.narrative}\n${first}\n${second}`;
    addIssue(context, {
      issue_type: 'ambiguous_scope',
      description: 'The task count conflicts: three versus five.',
      source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
    });
    expect(run(context).assessments).toEqual(
      expect.arrayContaining([expect.objectContaining({ trigger: 'merge_risk' })]),
    );
  });

  it('does not compare task counts attached to different grounded targets', () => {
    const context = baseContext();
    const first = 'The design phase included three tasks.';
    const second = 'The deployment phase included five tasks.';
    context.narrative = `${context.narrative}\n${first}\n${second}`;
    addIssue(context, {
      issue_type: 'ambiguous_scope',
      description: 'The task counts refer to different target phases.',
      source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
    });
    expect(run(context).assessments).toEqual([]);
  });

  it('ignores monetary, percentage, address, and version numbers', () => {
    const context = baseContext();
    const first = 'Version 3.2 was sent to 12 Main Street after a $4,000 payment at 50 percent.';
    const second = 'The agreed scope included five deliverables.';
    context.narrative = `${context.narrative}\n${first}\n${second}`;
    addIssue(context, {
      issue_type: 'ambiguous_scope',
      description: 'The numeric references have unrelated semantic roles.',
      source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
    });
    expect(run(context).assessments).toEqual([]);
  });

  it('keeps aggregate-splitting repair audit strictly internal', () => {
    const context = baseContext();
    const aggregate = {
      deliverable_id: 'deliverable_aggregate',
      name: 'Homepage and about page',
    };
    context.repaired_extraction.deliverable_assessments.push(aggregate);
    context.repair_audit.skipped_repairs.push({
      repair_id: 'repair_aggregate',
      sequence_number: 1,
      rule_id: 'aggregate_split_unsupported_v0_1_2',
      target_family: 'deliverables',
      target_object_id: 'deliverable_aggregate',
      operation: 'inspect',
      before: aggregate,
      after: aggregate,
      source_spans: [],
      rationale: 'Aggregate preserved.',
      status: 'skipped',
      rejection_reason: 'aggregate_split_unsupported_v0_1_2',
    });
    const result = run(context);
    expect(result.assessments).toEqual(
      expect.arrayContaining([expect.objectContaining({ trigger: 'internal_representation' })]),
    );
    const necessity = classifyQuestionNecessity(result.assessments, context.repaired_extraction);
    expect(necessity.question_candidates).toEqual([]);
    expect(necessity.suppressed_candidates[0]?.classification).toBe('internal_representation');
  });

  it('fails closed on unknown and unsupported repair-audit targets', () => {
    const context = baseContext();
    context.repair_audit.skipped_repairs.push(
      {
        repair_id: 'repair_unknown',
        rule_id: 'aggregate_split_unsupported_v0_1_2',
        target_family: 'deliverables',
        target_object_id: 'missing_object',
      } as any,
      {
        repair_id: 'repair_unsupported',
        rule_id: 'aggregate_split_unsupported_v0_1_2',
        target_family: 'claims',
        target_object_id: 'missing_claim',
      } as any,
    );
    const result = run(context);
    expect(result.assessments).toEqual([]);
    expect(result.audit.rule_results.map((item) => item.reason_code)).toEqual([
      'unsupported_internal_target_field',
      'internal_target_not_resolved',
    ]);
    expect(result.audit.rule_results.every((item) => item.status === 'rejected')).toBe(true);
  });

  it('fails closed when a question-producing rule has a malformed source span', () => {
    const context = baseContext();
    addTimeline(context, {
      event_summary: 'Final files were transferred after payment.',
      source_spans: [
        {
          submission_id: 'sub_a_extracted',
          quote: 'wrong quote',
          start_char: 0,
          end_char: 11,
        },
      ],
    });
    const result = run(context);
    expect(result.assessments).toEqual([]);
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'rejected', reason_code: 'source_span_invalid' }),
      ]),
    );
  });

  it('never introduces ungrounded question context', () => {
    const context = baseContext();
    addEvidence(context);
    addTerm(context);
    addIssue(context);
    const result = run(context);
    const groundedText = JSON.stringify(context.repaired_extraction);
    for (const assessment of result.assessments) {
      if (!assessment.question_context) continue;
      expect(
        context.narrative.includes(assessment.question_context) ||
          groundedText.includes(assessment.question_context),
      ).toBe(true);
    }
  });

  it('never exceeds the orchestration assessment limit', () => {
    const context = baseContext();
    for (let index = 0; index < 150; index += 1) {
      addEvidence(context, {
        evidence_id: `evidence_${String(index).padStart(3, '0')}`,
        title: `Evidence record ${index}`,
      });
    }
    const result = run(context, { maximumEvidenceAvailabilityAssessments: 100 });
    expect(result.assessments.length).toBe(MAX_RUNTIME_ASSESSMENT_BATCH_SIZE);
    expect(result.audit.summary.assessments_emitted).toBe(MAX_RUNTIME_ASSESSMENT_BATCH_SIZE);
  });

  it('prioritizes critical materiality before applying the assessment cap', () => {
    const context = baseContext();
    addEvidence(context, { evidence_id: 'a_evidence_gap' });
    const first = 'The website was complete.';
    const second = 'The website remained unfinished.';
    context.narrative = `${context.narrative}\n${first}\n${second}`;
    addIssue(context, {
      issue_id: 'z_critical_gap',
      severity: 'critical',
      description: 'The completion descriptions conflict.',
      source_spans: [exactSpan(context.narrative, first), exactSpan(context.narrative, second)],
    });
    const result = run(context, { maximumAssessments: 1 });
    expect(result.assessments).toEqual([
      expect.objectContaining({ target_object_id: 'z_critical_gap', materiality: 'critical' }),
    ]);
    expect(result.audit.rule_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_object_id: 'a_evidence_gap',
          status: 'suppressed',
          reason_code: 'maximum_assessment_limit_reached',
        }),
      ]),
    );
  });

  it('uses trigger priority after materiality before applying the cap', () => {
    const context = baseContext();
    const actorQuote = 'some small text changes kept coming after that.';
    addTimeline(context, {
      event_id: 'a_actor_gap',
      event_summary: 'Small text changes kept coming after the last major content batch.',
      source_spans: [exactSpan(context.narrative, actorQuote)],
    });
    addTerm(context, { term_id: 'z_interpretation_gap' });
    const result = run(context, { maximumAssessments: 1 });
    expect(result.assessments).toEqual([
      expect.objectContaining({
        target_object_id: 'z_interpretation_gap',
        trigger: 'required_bucket_missing',
        materiality: 'high',
      }),
    ]);
  });

  it('accepts a zero assessment cap with the default evidence limit', () => {
    const context = baseContext();
    addEvidence(context);
    const result = run(context, { maximumAssessments: 0 });
    expect(result.assessments).toEqual([]);
    expect(result.audit.summary.assessments_emitted).toBe(0);
  });

  it('still rejects an explicit evidence limit above a zero assessment cap', () => {
    expect(() =>
      run(baseContext(), { maximumAssessments: 0, maximumEvidenceAvailabilityAssessments: 1 }),
    ).toThrow(/maximumEvidenceAvailabilityAssessments/u);
  });

  it.each([-1, 0.5])('rejects invalid explicit evidence caps: %s', (value) => {
    expect(() =>
      run(baseContext(), {
        maximumAssessments: 1,
        maximumEvidenceAvailabilityAssessments: value,
      }),
    ).toThrow(/maximumEvidenceAvailabilityAssessments/u);
  });

  it('is stable across semantically irrelevant family-array ordering', () => {
    const firstContext = baseContext();
    addEvidence(firstContext, { evidence_id: 'evidence_b', title: 'B evidence' });
    addEvidence(firstContext, { evidence_id: 'evidence_a', title: 'A evidence' });
    const secondContext = structuredClone(firstContext);
    secondContext.repaired_extraction.evidence.reverse();
    expect(JSON.stringify(run(firstContext))).toBe(JSON.stringify(run(secondContext)));
  });

  it('produces an orchestration-valid batch and no more than six questions', () => {
    const extraction = validPersonAExtraction();
    const narrative = extraction.submission.raw_text as string;
    const result = orchestratePersonAPlanning({
      extraction,
      narrative,
      assessmentProvider: createDeterministicPersonAAssessmentProvider(),
    });
    expect(result.audit_summary.final_status).toBe('passed');
    expect(result.rejected_assessments).toEqual([]);
    expect(result.question_count).toBeLessThanOrEqual(6);
  });

  it('produces a small useful saved-v3 plan without laboratory inputs', () => {
    const extraction = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'src/fixtures/dry_run_001.person_a.saved_v3.extraction.json'),
        'utf8',
      ),
    );
    const narrative = readFileSync(
      resolve(process.cwd(), 'src/fixtures/dry_run_001.person_a.txt'),
      'utf8',
    );
    const result = orchestratePersonAPlanning({
      extraction,
      narrative,
      assessmentProvider: createDeterministicPersonAAssessmentProvider(),
    });
    expect(result.audit_summary.final_status).toBe('passed');
    expect(result.validated_assessments.length).toBeGreaterThanOrEqual(2);
    expect(result.validated_assessments.length).toBeLessThanOrEqual(6);
    expect(result.question_count).toBe(result.generated_questions.length);
    expect(result.question_count).toBeLessThanOrEqual(6);
    expect(result.validated_assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trigger: 'evidence_availability' }),
        expect.objectContaining({ trigger: 'required_bucket_missing' }),
      ]),
    );
    expect(
      result.generated_questions.some((question) => question.trigger === 'actor_attribution'),
    ).toBe(false);
    expect(
      result.generated_questions
        .filter((question) => question.trigger === 'evidence_availability')
        .every((question) =>
          question.grounding_references.some((reference) => reference.kind === 'source_span'),
        ),
    ).toBe(true);
  });

  it('preserves atomic orchestration rejection for one malformed generated assessment', () => {
    const extraction = validPersonAExtraction();
    const narrative = extraction.submission.raw_text as string;
    const provider = createDeterministicPersonAAssessmentProvider();
    const result = orchestratePersonAPlanning({
      extraction,
      narrative,
      assessmentProvider: {
        assess: (context) => [
          ...provider.assess(context),
          { trigger: 'actor_attribution', target_object_id: 'missing' },
        ],
      },
    });
    expect(result.audit_summary.failure_stage).toBe('assessment');
    expect(result.generated_questions).toEqual([]);
    expect(result.stage_statuses.find((item) => item.stage === 'necessity')?.status).toBe(
      'skipped',
    );
  });

  it('keeps accepted explicit causal assessments suppressed by necessity', () => {
    const context = baseContext();
    addDamages(context, { causal_theory: 'The missed launch directly caused the loss.' });
    const assessment = {
      target_object_id: 'damages_test',
      target_family: 'damages',
      field: 'causal_theory',
      trigger: 'causal_link' as const,
      materiality: 'high' as const,
      causal_link_status: 'explicit' as const,
      question_context: 'The missed launch directly caused the loss.',
      resolves_object_ids: ['damages_test'],
    };
    const necessity = classifyQuestionNecessity([assessment], context.repaired_extraction);
    expect(necessity.question_candidates).toEqual([]);
    expect(necessity.suppressed_candidates[0]?.classification).toBe('already_explicit');
  });
});

describe('deterministic Person A runtime assessment CLI', () => {
  const args = [
    '--input',
    'input.txt',
    '--extraction',
    'extraction.json',
    '--output-dir',
    'output',
  ];

  it.each([
    ['unknown', [...args, '--assessments', 'unsafe.json'], 'Unknown option: --assessments'],
    ['duplicate', [...args, '--input', 'again.txt'], 'Duplicate option: --input'],
    ['missing', ['--input', '--extraction', 'x'], 'Missing value for --input'],
    ['short', ['-i', 'input.txt'], 'Unexpected positional or short argument: -i'],
  ])('rejects %s options before I/O', async (_label, argv, message) => {
    const readText = vi.fn<AssessPersonARuntimeCommandDependencies['readText']>();
    const orchestrate = vi.fn<AssessPersonARuntimeCommandDependencies['orchestrate']>();
    await expect(
      runAssessPersonARuntimeCommand(argv, {
        readText,
        writeText: vi.fn(),
        makeDirectory: vi.fn(),
        orchestrate,
      }),
    ).rejects.toThrow(message);
    expect(readText).not.toHaveBeenCalled();
    expect(orchestrate).not.toHaveBeenCalled();
  });

  it('parses the complete strict offline invocation', () => {
    expect(parseAssessPersonARuntimeArgs(args)).toMatchObject({
      input: expect.stringMatching(/input\.txt$/u),
      extraction: expect.stringMatching(/extraction\.json$/u),
      outputDir: expect.stringMatching(/output$/u),
    });
  });

  it('writes exactly the deterministic runtime-assessment artifacts', async () => {
    const extraction = validPersonAExtraction();
    const narrative = extraction.submission.raw_text as string;
    const writes = new Map<string, string>();
    const dependencies: AssessPersonARuntimeCommandDependencies = {
      readText: async (path) =>
        path.endsWith('input.txt') ? narrative : JSON.stringify(extraction),
      writeText: async (path, contents) => {
        writes.set(path, contents);
      },
      makeDirectory: async () => undefined,
      orchestrate: orchestratePersonAPlanning,
    };
    const first = await runAssessPersonARuntimeCommand(args, dependencies);
    const firstWrites = [...writes.entries()].sort();
    writes.clear();
    const second = await runAssessPersonARuntimeCommand(args, dependencies);
    expect(first.runtimePlan.audit_summary.final_status).toBe('passed');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect([...writes.entries()].sort()).toEqual(firstWrites);
    expect(firstWrites.map(([path]) => path.split('/').at(-1)).sort()).toEqual([
      'assessment-audit.json',
      'assessments.json',
      'clarification-questions.json',
      'necessity-classifications.json',
      'repaired-extraction.json',
      'runtime-plan.json',
      'suppressed-candidates.json',
    ]);
    expect(JSON.stringify(first)).not.toMatch(
      /OPENAI_API_KEY|process\.env|new\s+OpenAI|api[_-]?key/iu,
    );
  });

  it('uses only the deterministic provider, not the static fixture provider', () => {
    expect(createStaticRuntimeAssessmentProvider).toBeTypeOf('function');
    const commandSource = readFileSync(
      resolve(process.cwd(), 'src/commands/assess-person-a-runtime.ts'),
      'utf8',
    );
    expect(commandSource).not.toContain('static-assessment-provider');
  });
});
