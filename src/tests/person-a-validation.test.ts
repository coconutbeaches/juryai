import { describe, expect, it } from 'vitest';
import { assemblePersonAExtraction } from '../extraction/person-a-extractor.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';
import { modelOutputFromGolden, validPersonAExtraction, clone } from './person-a-test-helpers.js';

function validateGoldenProjection() {
  const extraction = validPersonAExtraction();
  return {
    extraction,
    result: validatePersonAExtraction(extraction, extraction.submission.raw_text),
  };
}

const isReferenceError = (message: string): boolean =>
  /Referenced ID|Duplicate ID|must belong to/i.test(message);
const isSourceSpanError = (message: string): boolean => /source span/i.test(message);

function referenceErrorsAt(prefixes: string[]) {
  const { result } = validateGoldenProjection();
  return result.invariantErrors.filter(
    (error) =>
      isReferenceError(error.message) && prefixes.some((prefix) => error.path.startsWith(prefix)),
  );
}

function recursiveText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(recursiveText).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(recursiveText).join(' ');
  return '';
}

function assemblyOptions(narrative: string) {
  return {
    narrative,
    submittedAt: '2026-07-18T12:00:00Z',
    model: 'test-model',
    generatedAt: '2026-07-19T00:00:00Z',
  };
}

describe('Person A extraction validation', () => {
  it('golden projection has no schema or invariant errors', () => {
    const { result } = validateGoldenProjection();
    expect(result.schemaErrors).toEqual([]);
    expect(result.invariantErrors).toEqual([]);
  });

  it('golden projection does not retain Maya-only semantic content', () => {
    const extraction = validPersonAExtraction();
    const text = recursiveText({
      agreement: extraction.agreement,
      deliverables: extraction.deliverable_assessments,
      timeline: extraction.timeline,
    }).toLowerCase();
    expect(text).not.toContain('may 12');
    expect(text).not.toContain('menu didn’t open');
    expect(text).not.toContain("menu didn't open");
    expect(text).not.toContain('two pages overlapped');
    expect(text).not.toContain('mobile is a mess');
  });

  it('does not import a Person B-only third-party actor', () => {
    const extraction = validPersonAExtraction();
    const photoDelivery = extraction.timeline.find(
      (event: Record<string, any>) => event.event_id === 'tl_photo_delivery',
    );
    expect(photoDelivery.actor_third_party_id).toBeNull();
    expect(
      extraction.third_parties.some(
        (thirdParty: Record<string, any>) => thirdParty.third_party_id === 'tp_maya_assistant',
      ),
    ).toBe(false);
  });

  it('normalizes arbitrary model submission IDs before validation', () => {
    const modelOutput = modelOutputFromGolden();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      const object = value as Record<string, any>;
      if ('submission_id' in object && 'quote' in object)
        object.submission_id = 'model_submission_917';
      Object.values(object).forEach(visit);
    };
    visit(modelOutput);
    const narrative = validPersonAExtraction().submission.raw_text;
    const extraction = assemblePersonAExtraction(modelOutput, {
      narrative,
      submittedAt: '2026-07-18T12:00:00Z',
      model: 'test-model',
      generatedAt: '2026-07-19T00:00:00Z',
    });
    const spanIds: string[] = [];
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(collect);
      if (!value || typeof value !== 'object') return;
      const object = value as Record<string, any>;
      if ('submission_id' in object && 'quote' in object) spanIds.push(object.submission_id);
      Object.values(object).forEach(collect);
    };
    collect(extraction);
    expect(new Set(spanIds)).toEqual(new Set(['sub_a_extracted']));
  });

  it('normalizes inaccurate offsets for one unique exact quote', () => {
    const modelOutput = modelOutputFromGolden();
    const narrative = validPersonAExtraction().submission.raw_text;
    const span = modelOutput.claims[0].source_spans[0];
    const expectedStart = narrative.indexOf(span.quote);
    expect(expectedStart).toBeGreaterThanOrEqual(0);
    expect(narrative.indexOf(span.quote, expectedStart + 1)).toBe(-1);
    span.start_char = 0;
    span.end_char = span.quote.length;

    const extraction = assemblePersonAExtraction(modelOutput, assemblyOptions(narrative));
    const normalized = extraction.claims[0].source_spans[0];

    expect(normalized.quote).toBe(span.quote);
    expect(normalized.start_char).toBe(expectedStart);
    expect(normalized.end_char).toBe(expectedStart + span.quote.length);
    expect(narrative.slice(normalized.start_char, normalized.end_char)).toBe(normalized.quote);
  });

  it('fails closed instead of normalizing a repeated exact quote ambiguously', () => {
    const modelOutput = modelOutputFromGolden();
    const baseNarrative = validPersonAExtraction().submission.raw_text;
    const span = modelOutput.claims[0].source_spans[0];
    const narrative = `${baseNarrative}\n${span.quote}`;
    span.start_char = 0;
    span.end_char = span.quote.length;

    expect(() => assemblePersonAExtraction(modelOutput, assemblyOptions(narrative))).toThrow(
      /Source span does not match/,
    );
  });

  it('fails closed instead of normalizing a quote absent from the narrative', () => {
    const modelOutput = modelOutputFromGolden();
    const narrative = validPersonAExtraction().submission.raw_text;
    const span = modelOutput.claims[0].source_spans[0];
    span.quote = `${span.quote} [not in narrative]`;
    span.end_char = span.start_char + span.quote.length;

    expect(() => assemblePersonAExtraction(modelOutput, assemblyOptions(narrative))).toThrow(
      /Source span does not match/,
    );
  });

  it('does not silently coerce invalid agreement wording status', () => {
    const modelOutput = modelOutputFromGolden();
    const narrative = validPersonAExtraction().submission.raw_text;
    modelOutput.agreement.terms[0].wording_status = 'agreed';

    expect(() => assemblePersonAExtraction(modelOutput, assemblyOptions(narrative))).toThrow(
      /wording_status/,
    );
    expect(modelOutput.agreement.terms[0].wording_status).toBe('agreed');
  });

  it('keeps invalid bilateral agreement interpretation fail-closed', () => {
    const modelOutput = modelOutputFromGolden();
    const narrative = validPersonAExtraction().submission.raw_text;
    modelOutput.agreement.terms[0].interpretation_status = 'disputed';

    expect(() => assemblePersonAExtraction(modelOutput, assemblyOptions(narrative))).toThrow(
      /interpretation_status/,
    );
    expect(modelOutput.agreement.terms[0].interpretation_status).toBe('disputed');
  });

  it('assembles a compliant Person A model object successfully', () => {
    const modelOutput = modelOutputFromGolden();
    const narrative = validPersonAExtraction().submission.raw_text;
    const extraction = assemblePersonAExtraction(modelOutput, assemblyOptions(narrative));
    const result = validatePersonAExtraction(extraction, narrative);

    expect(result.valid).toBe(true);
    expect(result.schemaErrors).toEqual([]);
    expect(result.invariantErrors).toEqual([]);
    expect(extraction.extractor_version).toBe('person-a-v0.1.3');
    expect(extraction.metadata.prompt_version).toBe('person-a-v0.1.3');
  });

  it('requires non-empty source spans in the schema', () => {
    const extraction = validPersonAExtraction();
    extraction.timeline[0].source_spans = [];
    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);
    expect(result.valid).toBe(false);
    expect(
      result.schemaErrors.some((error) => error.path.includes('/timeline/0/source_spans')),
    ).toBe(true);
  });

  it('rejects an existing ID from the wrong reference family', () => {
    const extraction = validPersonAExtraction();
    extraction.claim_evidence_links[0].evidence_id = extraction.claims[0].claim_id;
    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);
    expect(result.valid).toBe(false);
    expect(
      result.invariantErrors.some(
        (error) =>
          error.path.includes('claim_evidence_links[0].evidence_id') &&
          error.message.includes('must belong to evidence'),
      ),
    ).toBe(true);
  });

  it('rejects a fabricated original filename', () => {
    const extraction = validPersonAExtraction();
    extraction.evidence[0].original_filename = 'contract.pdf';
    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);
    expect(result.valid).toBe(false);
    expect(
      result.invariantErrors.some(
        (error) =>
          error.path.includes('original_filename') &&
          error.message.includes('exact filename appears'),
      ),
    ).toBe(true);
  });

  it('rejects stale narrative hashes on replay', () => {
    const extraction = validPersonAExtraction();
    extraction.metadata.input_hash = 'a'.repeat(64);
    extraction.submission.content_hash = 'b'.repeat(64);
    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);
    expect(result.valid).toBe(false);
    expect(
      result.invariantErrors.filter((error) => error.message.includes('sha256(narrative)')),
    ).toHaveLength(2);
  });

  it('golden agreement and deliverables have no reference errors', () => {
    expect(referenceErrorsAt(['$.agreement', '$.deliverable_assessments'])).toEqual([]);
  });

  it('golden timeline has no reference errors', () => {
    expect(referenceErrorsAt(['$.timeline'])).toEqual([]);
  });

  it('golden claims and evidence links have no reference errors', () => {
    expect(referenceErrorsAt(['$.claims', '$.claim_evidence_links'])).toEqual([]);
  });

  it('golden damages, issues, and questions have no reference errors', () => {
    expect(
      referenceErrorsAt(['$.damages_claims', '$.extraction_issues', '$.clarification_questions']),
    ).toEqual([]);
  });

  it('golden projection has exact source spans', () => {
    const { result } = validateGoldenProjection();
    expect(result.invariantErrors.filter((error) => isSourceSpanError(error.message))).toEqual([]);
  });

  it('rejects narrative evidence promoted to inspected', () => {
    const extraction = validPersonAExtraction();
    extraction.evidence[0].availability_status = 'inspected';
    extraction.evidence[0].file_reference = 'storage/evidence.pdf';
    extraction.evidence[0].file_hash = 'a'.repeat(64);
    extraction.evidence[0].inspected_at = '2026-07-19T00:00:00Z';
    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);
    expect(result.valid).toBe(false);
  });

  it('rejects a source quote whose offsets do not match the narrative', () => {
    const extraction = validPersonAExtraction();
    extraction.claims[0].source_spans[0].start_char += 1;
    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);
    expect(result.valid).toBe(false);
    expect(result.invariantErrors.some((error) => error.message.includes('Source span'))).toBe(
      true,
    );
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
