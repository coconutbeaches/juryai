import { describe, expect, it } from 'vitest';
import { alignPersonA } from '../alignment/person-a-alignment-corrected.js';
import { evaluatePersonA } from '../evaluation/person-a-diff-corrected.js';
import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';
import { validPersonAExtraction } from './person-a-test-helpers.js';

describe('Person A later-review epistemic regressions', () => {
  it('rejects metadata-verified authenticity for uninspected evidence', () => {
    const extraction = validPersonAExtraction();
    extraction.evidence[0].authenticity_status = 'metadata_consistent';

    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);

    expect(result.valid).toBe(false);
    expect(
      result.invariantErrors.some(
        (error) =>
          error.path === '$.evidence[0].authenticity_status' &&
          error.message.includes('cannot be marked metadata-consistent'),
      ),
    ).toBe(true);
  });

  it('rejects assessed support on a pre-inspection damages claim', () => {
    const extraction = validPersonAExtraction();
    expect(extraction.damages_claims.length).toBeGreaterThan(0);
    extraction.damages_claims[0].support_level = 'strong';

    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);

    expect(result.valid).toBe(false);
    expect(
      result.invariantErrors.some(
        (error) =>
          error.path === '$.damages_claims[0].support_level' &&
          error.message.includes('cannot receive an assessed damages support level'),
      ),
    ).toBe(true);
  });

  it('rejects agreed agreement wording or interpretation in Person A-only intake', () => {
    const extraction = validPersonAExtraction();
    extraction.agreement.terms[0].wording_status = 'agreed';
    extraction.agreement.terms[0].interpretation_status = 'agreed';

    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);

    expect(result.valid).toBe(false);
    expect(
      result.invariantErrors.some((error) => error.path === '$.agreement.terms[0].wording_status'),
    ).toBe(true);
    expect(
      result.invariantErrors.some(
        (error) => error.path === '$.agreement.terms[0].interpretation_status',
      ),
    ).toBe(true);
  });

  it('classifies a reversed outcome transfer once without unmatched duplicates', () => {
    const extraction = validPersonAExtraction();
    const golden = buildPersonAGoldenProjection();
    const transfer = extraction.desired_outcomes.outcomes[0].transfers[0];
    [transfer.from_party_id, transfer.to_party_id] = [transfer.to_party_id, transfer.from_party_id];

    const alignment = alignPersonA(extraction, golden);
    const report = evaluatePersonA(extraction, golden, alignment);

    expect(
      report.errors.filter(
        (error) => error.family === 'outcomes' && error.code === 'transfer_direction',
      ),
    ).toHaveLength(1);
    expect(
      report.errors.some(
        (error) =>
          error.family === 'outcomes' &&
          ['missing_golden_object', 'unsupported_extra_object'].includes(error.code),
      ),
    ).toBe(false);
  });

  it('classifies a quoted evidence author reversal as critical', () => {
    const extraction = validPersonAExtraction();
    const golden = buildPersonAGoldenProjection();
    const evidence = extraction.evidence.find((item: Record<string, any>) =>
      item.extracts.some((extract: Record<string, any>) => extract.author_party_id === 'party_b'),
    );
    expect(evidence).toBeTruthy();
    const quotedReply = evidence.extracts.find(
      (extract: Record<string, any>) => extract.author_party_id === 'party_b',
    );
    quotedReply.author_party_id = 'party_a';

    const alignment = alignPersonA(extraction, golden);
    const report = evaluatePersonA(extraction, golden, alignment);

    expect(
      report.errors.filter(
        (error) =>
          error.family === 'evidence' &&
          error.code === 'extract_author_reversed' &&
          error.severity === 'critical',
      ),
    ).toHaveLength(1);
  });

  it('rejects a non-filename narrative substring as original_filename', () => {
    const extraction = validPersonAExtraction();
    extraction.evidence[0].original_filename = 'contract';

    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);

    expect(result.valid).toBe(false);
    expect(
      result.invariantErrors.some(
        (error) =>
          error.path === '$.evidence[0].original_filename' &&
          error.message.includes('filename-shaped literal'),
      ),
    ).toBe(true);
  });

  it('rejects an evidence extract third-party author outside the registered family', () => {
    const extraction = validPersonAExtraction();
    const evidence = extraction.evidence.find((item: Record<string, any>) => item.extracts.length > 0);
    expect(evidence).toBeTruthy();
    evidence.extracts[0].author_party_id = null;
    evidence.extracts[0].author_third_party_id = extraction.claims[0].claim_id;

    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);

    expect(result.valid).toBe(false);
    expect(
      result.invariantErrors.some(
        (error) =>
          error.path.includes('.author_third_party_id') &&
          error.message.includes('registered third party'),
      ),
    ).toBe(true);
  });

  it('allows extraction issues and questions to target claim-evidence links', () => {
    const extraction = validPersonAExtraction();
    expect(extraction.claim_evidence_links.length).toBeGreaterThan(0);
    expect(extraction.extraction_issues.length).toBeGreaterThan(0);
    expect(extraction.clarification_questions.length).toBeGreaterThan(0);
    const linkId = extraction.claim_evidence_links[0].link_id;
    extraction.extraction_issues[0].affected_object_ids = [linkId];
    extraction.clarification_questions[0].linked_object_ids = [linkId];

    const result = validatePersonAExtraction(extraction, extraction.submission.raw_text);

    expect(
      result.invariantErrors.filter(
        (error) =>
          error.path.includes('.affected_object_ids[') || error.path.includes('.linked_object_ids['),
      ),
    ).toEqual([]);
  });
});
