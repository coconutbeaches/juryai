import { describe, expect, it } from 'vitest';
import { assemblePersonAExtraction } from '../extraction/person-a-extractor.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a.js';
import { modelOutputFromGolden, validPersonAExtraction, clone } from './person-a-test-helpers.js';

function validateGoldenProjection() {
  const extraction = validPersonAExtraction();
  return {
    extraction,
    result: validatePersonAExtraction(extraction, extraction.submission.raw_text),
  };
}

const isReferenceError = (message: string): boolean =>
  /Referenced ID|Duplicate ID|endpoint is missing/i.test(message);
const isSourceSpanError = (message: string): boolean => /Source span/i.test(message);

describe('Person A extraction validation', () => {
  it('golden projection has no schema errors', () => {
    const { result } = validateGoldenProjection();
    expect(result.schemaErrors).toEqual([]);
  });

  it('golden projection has no reference errors', () => {
    const { result } = validateGoldenProjection();
    expect(result.invariantErrors.filter((error) => isReferenceError(error.message))).toEqual([]);
  });

  it('golden projection has exact source spans', () => {
    const { result } = validateGoldenProjection();
    expect(result.invariantErrors.filter((error) => isSourceSpanError(error.message))).toEqual([]);
  });

  it('golden projection has no remaining scope invariant errors', () => {
    const { result } = validateGoldenProjection();
    expect(
      result.invariantErrors.filter(
        (error) => !isReferenceError(error.message) && !isSourceSpanError(error.message),
      ),
    ).toEqual([]);
  });

  it('assembles deterministic submission metadata around model output', () => {
    const modelOutput = modelOutputFromGolden();
    const narrative = validPersonAExtraction().submission.raw_text;
    const extraction = assemblePersonAExtraction(modelOutput, {
      narrative,
      submittedAt: '2026-07-18T12:00:00Z',
      model: 'test-model',
      generatedAt: '2026-07-19T00:00:00Z',
    });
    expect(extraction.party.party_id).toBe('party_a');
    expect(extraction.submission.submission_id).toBe('sub_a_extracted');
    expect(extraction.submission.raw_text).toBe(narrative);
  });

  it('rejects narrative evidence promoted to inspected', () => {
    const extraction = validPersonAExtraction();
    extraction.evidence[0].availability_status = 'inspected';
    extraction.evidence[0].file_reference = 'storage/evidence.pdf';
    extraction.evidence[0].file_hash = 'a'.repeat(64);
    extraction.evidence[0].inspected_at = '2026-07-19T00:00:00Z';
    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);
    expect(result.valid).toBe(false);
    expect(
      result.invariantErrors.some((error) => error.message.includes('described_only or unavailable')),
    ).toBe(true);
  });

  it('rejects a source quote whose offsets do not match the narrative', () => {
    const extraction = validPersonAExtraction();
    extraction.claims[0].source_spans[0].start_char += 1;
    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);
    expect(result.valid).toBe(false);
    expect(result.invariantErrors.some((error) => error.message.includes('Source span'))).toBe(true);
  });

  it('rejects Person B interpretation and answered claim state', () => {
    const extraction = clone(validPersonAExtraction());
    extraction.agreement.terms[0].person_b_interpretation = 'Invented response';
    extraction.claims[0].response_status = 'disputed';
    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);
    expect(result.valid).toBe(false);
    expect(result.invariantErrors.length).toBeGreaterThanOrEqual(2);
  });
});
