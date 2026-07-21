import { describe, expect, it } from 'vitest';
import { alignPersonA, familyItems } from '../alignment/person-a-alignment-corrected.js';
import { evaluatePersonA } from '../evaluation/person-a-diff-corrected.js';
import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';
import { clone, validPersonAExtraction } from './person-a-test-helpers.js';

function evaluate(extraction = validPersonAExtraction()) {
  const golden = buildPersonAGoldenProjection();
  const alignment = alignPersonA(extraction, golden);
  return { alignment, report: evaluatePersonA(extraction, golden, alignment), golden };
}

describe('Person A semantic alignment and classified diff', () => {
  it('aligns the golden projection without relying on IDs or array order', () => {
    const extraction = validPersonAExtraction();
    extraction.claims.reverse();
    extraction.evidence.reverse();
    extraction.claims.forEach((claim: Record<string, any>, index: number) => {
      claim.claim_id = `generated_claim_${index}`;
    });
    extraction.evidence.forEach((evidence: Record<string, any>, index: number) => {
      evidence.evidence_id = `generated_evidence_${index}`;
    });
    const golden = buildPersonAGoldenProjection();
    const alignment = alignPersonA(extraction, golden);
    expect(alignment.families.claims.pairs).toHaveLength(familyItems(golden, 'claims').length);
    expect(alignment.families.evidence.pairs).toHaveLength(familyItems(golden, 'evidence').length);
  });

  it('reports a clean deterministic projection', () => {
    const { report } = evaluate();
    expect(report.summary.critical).toBe(0);
    expect(report.summary.major).toBe(0);
  });

  it('counts an ambiguous object once without unmatched duplicates', () => {
    const extraction = validPersonAExtraction();
    const golden = buildPersonAGoldenProjection();
    const questions = golden.clarification_questions;
    expect(questions.length).toBeGreaterThanOrEqual(2);
    questions[1] = {
      ...questions[0],
      question_id: 'golden_duplicate_question',
    };
    extraction.clarification_questions = [
      {
        ...questions[0],
        question_id: 'generated_ambiguous_question',
      },
    ];
    const alignment = alignPersonA(extraction, golden);
    const family = alignment.families.clarification_questions;
    expect(family.ambiguous).toHaveLength(1);
    expect(family.unmatched_extracted).toEqual([]);
    const ambiguousGoldenIndexes = new Set(
      family.ambiguous.flatMap((item) =>
        item.candidates.map((candidate) => candidate.golden_index),
      ),
    );
    const ambiguousGoldenIds = new Set(
      family.ambiguous.flatMap((item) => item.candidates.map((candidate) => candidate.golden_id)),
    );
    expect(family.unmatched_golden.some((item) => ambiguousGoldenIndexes.has(item.index))).toBe(
      false,
    );
    const report = evaluatePersonA(extraction, golden, alignment);
    expect(report.errors.filter((error) => error.code === 'ambiguous_alignment')).toHaveLength(1);
    expect(
      report.errors.some(
        (error) =>
          error.code === 'missing_golden_object' &&
          typeof error.golden_id === 'string' &&
          ambiguousGoldenIds.has(error.golden_id),
      ),
    ).toBe(false);
    expect(
      report.errors.some(
        (error) =>
          error.code === 'unsupported_extra_object' &&
          error.extracted_id === 'generated_ambiguous_question',
      ),
    ).toBe(false);
  });

  it('classifies a reversed timeline actor as one critical error', () => {
    const extraction = validPersonAExtraction();
    const event = extraction.timeline.find(
      (item: Record<string, any>) => item.actor_party_id === 'party_b',
    );
    expect(event).toBeTruthy();
    event.actor_party_id = 'party_a';
    const { report } = evaluate(extraction);
    expect(report.errors.filter((error) => error.code === 'actor_reversed')).toHaveLength(1);
    expect(report.errors.find((error) => error.code === 'actor_reversed')?.severity).toBe(
      'critical',
    );
    expect(
      report.errors.some(
        (error) => error.code === 'missing_golden_object' && error.family === 'timeline',
      ),
    ).toBe(false);
    expect(
      report.errors.some(
        (error) => error.code === 'unsupported_extra_object' && error.family === 'timeline',
      ),
    ).toBe(false);
  });

  it('uses an exact source trace to classify wrong timeline dates and actors once', () => {
    const extraction = validPersonAExtraction();
    const event = extraction.timeline.find(
      (item: Record<string, any>) => item.actor_party_id === 'party_a',
    );
    expect(event).toBeTruthy();
    const eventId = event.event_id;
    event.date.start = '2010-04-01';
    event.date.end = '2010-04-10';
    event.date.precision = 'range';
    event.date.approximate = true;
    event.actor_party_id = 'party_b';
    const { report } = evaluate(extraction);
    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === eventId &&
          error.code === 'date_range' &&
          error.severity === 'major',
      ),
    ).toBe(true);
    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === eventId &&
          error.code === 'actor_reversed' &&
          error.severity === 'critical',
      ),
    ).toBe(true);
    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === eventId &&
          ['missing_golden_object', 'unsupported_extra_object'].includes(error.code),
      ),
    ).toBe(false);
  });

  it('uses an exact source trace to report a claim-type error without missing/extra duplicates', () => {
    const extraction = validPersonAExtraction();
    const claim = extraction.claims[0];
    const claimId = claim.claim_id;
    claim.claim_type = 'delay';
    const { report } = evaluate(extraction);
    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === claimId &&
          error.code === 'claim_type' &&
          error.severity === 'major',
      ),
    ).toBe(true);
    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === claimId &&
          ['missing_golden_object', 'unsupported_extra_object'].includes(error.code),
      ),
    ).toBe(false);
  });

  it('classifies a source-grounded duplicate claim as a granularity split', () => {
    const extraction = validPersonAExtraction();
    const duplicate = clone(extraction.claims[0]);
    duplicate.claim_id = 'generated_split_claim';
    extraction.claims.push(duplicate);
    const { report } = evaluate(extraction);

    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === duplicate.claim_id &&
          error.code === 'granularity_split' &&
          error.severity === 'major',
      ),
    ).toBe(true);
    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === duplicate.claim_id && error.code === 'unsupported_extra_object',
      ),
    ).toBe(false);
  });

  it('does not call an additional clarification question a fabrication', () => {
    const extraction = validPersonAExtraction();
    const question = clone(extraction.clarification_questions[0]);
    question.question_id = 'generated_additional_question';
    question.question = 'Which year did these events occur?';
    question.reason = 'The narrative does not state a calendar year.';
    extraction.clarification_questions.push(question);
    const { report } = evaluate(extraction);

    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === question.question_id &&
          error.code === 'unmatched_extracted_object' &&
          error.severity === 'minor',
      ),
    ).toBe(true);
    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === question.question_id && error.code === 'unsupported_extra_object',
      ),
    ).toBe(false);
  });

  it('keeps a genuinely unsupported high-materiality claim critical', () => {
    const extraction = validPersonAExtraction();
    const fabricated = clone(extraction.claims[0]);
    fabricated.claim_id = 'generated_unsupported_claim';
    fabricated.claim_text = 'Party B admitted destroying an unrelated business.';
    fabricated.materiality = 'high';
    extraction.claims.push(fabricated);
    const { report } = evaluate(extraction);

    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === fabricated.claim_id &&
          error.code === 'unsupported_extra_object' &&
          error.severity === 'critical',
      ),
    ).toBe(true);
  });

  it('does not call an unmatched exact-quote claim a fabrication', () => {
    const extraction = validPersonAExtraction();
    const grounded = clone(extraction.claims[0]);
    grounded.claim_id = 'generated_source_grounded_claim';
    grounded.claim_text =
      'Maya refuses to pay the remaining $1,200 and has said she may seek return of the deposit.';
    grounded.claim_type = 'payment';
    grounded.materiality = 'high';
    grounded.source_spans = [
      {
        submission_id: 'sub_a_001',
        quote:
          'Maya now refuses to pay the remaining $1,200 and has also said she may ask for the deposit back.',
        start_char: 1690,
        end_char: 1786,
      },
    ];
    extraction.claims.push(grounded);
    const { report } = evaluate(extraction);

    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === grounded.claim_id &&
          error.code === 'source_grounded_extra_object' &&
          error.severity === 'major',
      ),
    ).toBe(true);
    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === grounded.claim_id && error.code === 'unsupported_extra_object',
      ),
    ).toBe(false);
  });

  it('aligns a unique same-party payment claim that shares the exact amount', () => {
    const extraction = validPersonAExtraction();
    const payment = extraction.claims.find(
      (claim: Record<string, any>) => claim.claim_id === 'cl_a_010',
    );
    expect(payment).toBeTruthy();
    payment.claim_text =
      'Maya refuses to pay the remaining $1,200 and has said she may seek return of the deposit.';
    payment.source_spans = [
      {
        submission_id: 'sub_a_001',
        quote:
          'Maya now refuses to pay the remaining $1,200 and has also said she may ask for the deposit back.',
        start_char: 1690,
        end_char: 1786,
      },
    ];
    const { alignment, report } = evaluate(extraction);

    expect(
      alignment.families.claims.pairs.some((pair) => pair.extracted_id === payment.claim_id),
    ).toBe(true);
    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === payment.claim_id &&
          ['missing_golden_object', 'unsupported_extra_object'].includes(error.code),
      ),
    ).toBe(false);
  });

  it('does not source-recover a claim with the asserting party reversed', () => {
    const extraction = validPersonAExtraction();
    const claim = extraction.claims[0];
    const claimId = claim.claim_id;
    claim.party_id = 'party_b';
    const { alignment, report } = evaluate(extraction);

    expect(alignment.families.claims.pairs.some((pair) => pair.extracted_id === claimId)).toBe(
      false,
    );
    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === claimId &&
          error.code === 'unsupported_extra_object' &&
          error.severity === 'critical',
      ),
    ).toBe(true);
  });

  it('does not call described evidence referenced by an exact-quote claim a fabrication', () => {
    const extraction = validPersonAExtraction();
    const evidence = clone(extraction.evidence[0]);
    evidence.evidence_id = 'generated_source_grounded_evidence';
    evidence.title = 'Aggregated described communications';
    extraction.evidence.push(evidence);
    extraction.claims[0].supporting_evidence_ids.push(evidence.evidence_id);
    const { report } = evaluate(extraction);

    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === evidence.evidence_id &&
          error.code === 'source_grounded_extra_object' &&
          error.severity === 'major',
      ),
    ).toBe(true);
    expect(
      report.errors.some(
        (error) =>
          error.extracted_id === evidence.evidence_id && error.code === 'unsupported_extra_object',
      ),
    ).toBe(false);
  });

  it('counts multiple field errors on one object as one human edit', () => {
    const extraction = validPersonAExtraction();
    extraction.claims[0].against_asserting_party_interest =
      !extraction.claims[0].against_asserting_party_interest;
    extraction.claims[0].materiality = extraction.claims[0].materiality === 'high' ? 'low' : 'high';
    const { report, golden } = evaluate(extraction);
    const totalGolden = Object.values(report.metrics).reduce(
      (sum, metric) => sum + metric.golden_total,
      0,
    );
    expect(report.summary.human_edit_rate).toBeCloseTo(1 / totalGolden);
    expect(golden.claims.length).toBeGreaterThan(0);
  });

  it('classifies a dropped against-interest admission as major', () => {
    const extraction = validPersonAExtraction();
    const admission = extraction.claims.find(
      (claim: Record<string, any>) => claim.against_asserting_party_interest,
    );
    admission.against_asserting_party_interest = false;
    const { report } = evaluate(extraction);
    expect(
      report.errors.some(
        (error) => error.code === 'against_interest_flag' && error.severity === 'major',
      ),
    ).toBe(true);
  });

  it('classifies a flattened approximate date as major', () => {
    const extraction = validPersonAExtraction();
    const golden = buildPersonAGoldenProjection();
    extraction.timeline[0].date = {
      start: '2026-04-01',
      end: null,
      precision: 'day',
      approximate: false,
    };
    golden.timeline[0].date = {
      start: '2026-04-01',
      end: '2026-04-10',
      precision: 'range',
      approximate: true,
    };
    const alignment = alignPersonA(extraction, golden);
    const report = evaluatePersonA(extraction, golden, alignment);
    expect(report.errors.some((error) => error.code === 'approximate_date_flattened')).toBe(true);
  });

  it('classifies inspected narrative evidence as critical', () => {
    const extraction = validPersonAExtraction();
    extraction.evidence[0].availability_status = 'inspected';
    const { report } = evaluate(extraction);
    expect(
      report.errors.some(
        (error) => error.code === 'fabricated_inspection' && error.severity === 'critical',
      ),
    ).toBe(true);
  });

  it('classifies a reversed requested transfer as critical', () => {
    const extraction = clone(validPersonAExtraction());
    const transfer = extraction.desired_outcomes.outcomes[0].transfers[0];
    [transfer.from_party_id, transfer.to_party_id] = [transfer.to_party_id, transfer.from_party_id];
    const { report } = evaluate(extraction);
    expect(report.summary.critical).toBeGreaterThan(0);
  });

  it('classifies an omitted high-materiality claim as critical', () => {
    const extraction = validPersonAExtraction();
    const index = extraction.claims.findIndex(
      (claim: Record<string, any>) => claim.materiality === 'high',
    );
    extraction.claims.splice(index, 1);
    const { report } = evaluate(extraction);
    expect(
      report.errors.some(
        (error) =>
          error.code === 'missing_golden_object' &&
          error.family === 'claims' &&
          error.severity === 'critical',
      ),
    ).toBe(true);
  });

  it('classifies a specified actor against a null golden actor as major, not critical', () => {
    const extraction = validPersonAExtraction();
    const event = extraction.timeline.find(
      (item: Record<string, any>) =>
        item.actor_party_id === null && item.actor_third_party_id === null,
    );
    expect(event).toBeTruthy();
    event.actor_party_id = 'party_a';
    const { report } = evaluate(extraction);
    const specificity = report.errors.filter((error) => error.code === 'actor_specificity');
    expect(specificity).toHaveLength(1);
    expect(specificity[0]?.severity).toBe('major');
    expect(report.errors.some((error) => error.code === 'actor_reversed')).toBe(false);
    expect(report.summary.critical).toBe(0);
  });

  it('classifies an extra deliverable grounded in a matched quoted claim as major', () => {
    const extraction = validPersonAExtraction();
    const groundedClaim = extraction.claims.find(
      (claim: Record<string, any>) => claim.claim_id === 'cl_a_004',
    );
    expect(groundedClaim).toBeTruthy();
    expect(Array.isArray(groundedClaim.source_spans)).toBe(true);
    extraction.deliverable_assessments.push({
      ...clone(extraction.deliverable_assessments[0]),
      deliverable_id: 'del_extra_split',
      name: 'Added homepage design changes',
      scope_status: 'added_later',
      source_claim_ids: [groundedClaim.claim_id],
      source_evidence_ids: [],
    });
    const { report } = evaluate(extraction);
    const extras = report.errors.filter(
      (error) => error.family === 'deliverables' && error.extracted_id === 'del_extra_split',
    );
    expect(extras).toHaveLength(1);
    expect(extras[0]?.code).toBe('source_grounded_extra_object');
    expect(extras[0]?.severity).toBe('major');
    expect(report.summary.critical).toBe(0);
  });

  it('keeps a genuinely unsupported extra deliverable critical', () => {
    const extraction = validPersonAExtraction();
    extraction.deliverable_assessments.push({
      ...clone(extraction.deliverable_assessments[0]),
      deliverable_id: 'del_fabricated',
      name: 'Search engine optimization package',
      scope_status: 'included',
      source_claim_ids: ['claim_that_does_not_exist'],
      source_evidence_ids: [],
    });
    const { report } = evaluate(extraction);
    const extras = report.errors.filter(
      (error) => error.family === 'deliverables' && error.extracted_id === 'del_fabricated',
    );
    expect(extras).toHaveLength(1);
    expect(extras[0]?.code).toBe('unsupported_extra_object');
    expect(extras[0]?.severity).toBe('critical');
  });

  it('keeps an unrelated extra deliverable critical even when it cites a real matched claim', () => {
    const extraction = validPersonAExtraction();
    const groundedClaim = extraction.claims.find(
      (claim: Record<string, any>) => claim.claim_id === 'cl_a_004',
    );
    expect(groundedClaim).toBeTruthy();
    extraction.deliverable_assessments.push({
      ...clone(extraction.deliverable_assessments[0]),
      deliverable_id: 'del_laundered',
      name: 'Search engine optimization retainer',
      scope_status: 'included',
      source_claim_ids: [groundedClaim.claim_id],
      source_evidence_ids: [],
    });
    const { report } = evaluate(extraction);
    const extras = report.errors.filter(
      (error) => error.family === 'deliverables' && error.extracted_id === 'del_laundered',
    );
    expect(extras).toHaveLength(1);
    expect(extras[0]?.code).toBe('unsupported_extra_object');
    expect(extras[0]?.severity).toBe('critical');
  });
});
