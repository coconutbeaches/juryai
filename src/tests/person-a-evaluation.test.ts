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
    extraction.clarification_questions = [
      {
        ...questions[0],
        question_id: 'generated_ambiguous_question',
        question: `${questions[0].question} ${questions[1].question}`,
        reason: `${questions[0].reason} ${questions[1].reason}`,
      },
    ];
    const alignment = alignPersonA(extraction, golden);
    const family = alignment.families.clarification_questions;
    expect(family.ambiguous).toHaveLength(1);
    expect(family.unmatched_extracted).toEqual([]);
    const ambiguousGolden = new Set(
      family.ambiguous.flatMap((item) => item.candidates.map((candidate) => candidate.golden_index)),
    );
    expect(family.unmatched_golden.some((item) => ambiguousGolden.has(item.index))).toBe(false);
    const report = evaluatePersonA(extraction, golden, alignment);
    expect(report.errors.filter((error) => error.code === 'ambiguous_alignment')).toHaveLength(1);
    expect(report.errors.some((error) => error.code === 'missing_golden_object')).toBe(false);
    expect(report.errors.some((error) => error.code === 'unsupported_extra_object')).toBe(false);
  });

  it('classifies a reversed timeline actor as one critical error', () => {
    const extraction = validPersonAExtraction();
    const event = extraction.timeline.find((item: Record<string, any>) => item.actor_party_id === 'party_b');
    expect(event).toBeTruthy();
    event.actor_party_id = 'party_a';
    const { report } = evaluate(extraction);
    expect(report.errors.filter((error) => error.code === 'actor_reversed')).toHaveLength(1);
    expect(report.errors.find((error) => error.code === 'actor_reversed')?.severity).toBe('critical');
    expect(report.errors.some((error) => error.code === 'missing_golden_object' && error.family === 'timeline')).toBe(false);
    expect(report.errors.some((error) => error.code === 'unsupported_extra_object' && error.family === 'timeline')).toBe(false);
  });

  it('counts multiple field errors on one object as one human edit', () => {
    const extraction = validPersonAExtraction();
    extraction.claims[0].against_asserting_party_interest = !extraction.claims[0].against_asserting_party_interest;
    extraction.claims[0].materiality = extraction.claims[0].materiality === 'high' ? 'low' : 'high';
    const { report, golden } = evaluate(extraction);
    const totalGolden = Object.values(report.metrics).reduce((sum, metric) => sum + metric.golden_total, 0);
    expect(report.summary.human_edit_rate).toBeCloseTo(1 / totalGolden);
    expect(golden.claims.length).toBeGreaterThan(0);
  });

  it('classifies a dropped against-interest admission as major', () => {
    const extraction = validPersonAExtraction();
    const admission = extraction.claims.find((claim: Record<string, any>) => claim.against_asserting_party_interest);
    admission.against_asserting_party_interest = false;
    const { report } = evaluate(extraction);
    expect(report.errors.some((error) => error.code === 'against_interest_flag' && error.severity === 'major')).toBe(true);
  });

  it('classifies a flattened approximate date as major', () => {
    const extraction = validPersonAExtraction();
    const event = extraction.timeline.find((item: Record<string, any>) => item.date.approximate && item.date.end);
    event.date.end = null;
    event.date.precision = 'day';
    event.date.approximate = false;
    const { report } = evaluate(extraction);
    expect(report.errors.some((error) => error.code === 'approximate_date_flattened')).toBe(true);
  });

  it('classifies inspected narrative evidence as critical', () => {
    const extraction = validPersonAExtraction();
    extraction.evidence[0].availability_status = 'inspected';
    const { report } = evaluate(extraction);
    expect(report.errors.some((error) => error.code === 'fabricated_inspection' && error.severity === 'critical')).toBe(true);
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
    const index = extraction.claims.findIndex((claim: Record<string, any>) => claim.materiality === 'high');
    extraction.claims.splice(index, 1);
    const { report } = evaluate(extraction);
    expect(report.errors.some((error) => error.code === 'missing_golden_object' && error.family === 'claims' && error.severity === 'critical')).toBe(true);
  });
});
