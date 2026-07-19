import { describe, expect, it } from 'vitest';
import { alignPersonA, familyItems } from '../alignment/person-a-alignment.js';
import { evaluatePersonA } from '../evaluation/person-a-diff.js';
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

  it('classifies a dropped against-interest admission as major', () => {
    const extraction = validPersonAExtraction();
    const admission = extraction.claims.find(
      (claim: Record<string, any>) => claim.against_asserting_party_interest,
    );
    admission.against_asserting_party_interest = false;
    const { report } = evaluate(extraction);
    expect(report.errors.some((error) => error.code === 'against_interest_flag' && error.severity === 'major')).toBe(true);
  });

  it('classifies a flattened approximate date as major', () => {
    const extraction = validPersonAExtraction();
    const event = extraction.timeline.find(
      (item: Record<string, any>) => item.date.approximate && item.date.end,
    );
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
    expect(report.errors.some((error) => error.code === 'missing_golden_object' && error.severity === 'critical')).toBe(true);
    expect(report.errors.some((error) => error.code === 'unmatched_extracted_object' && error.severity === 'critical')).toBe(true);
  });

  it('classifies an omitted high-materiality claim as critical', () => {
    const extraction = validPersonAExtraction();
    const index = extraction.claims.findIndex(
      (claim: Record<string, any>) => claim.materiality === 'high',
    );
    extraction.claims.splice(index, 1);
    const { report } = evaluate(extraction);
    expect(report.errors.some((error) => error.code === 'missing_golden_object' && error.family === 'claims' && error.severity === 'critical')).toBe(true);
  });
});
