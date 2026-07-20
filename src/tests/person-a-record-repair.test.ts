import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alignPersonA } from '../alignment/person-a-alignment-corrected.js';
import { buildPersonAAssessmentResult } from '../clarification/build-assessments.js';
import {
  classifyQuestionNecessity,
  generateNecessaryClarificationQuestions,
} from '../clarification/question-necessity.js';
import { evaluatePersonA } from '../evaluation/person-a-diff-corrected.js';
import { repairPersonAExtraction } from '../repair/person-a-record-repair.js';
import { validPersonAExtraction } from './person-a-test-helpers.js';

function fixture() {
  const extraction = validPersonAExtraction();
  return { extraction, narrative: extraction.submission.raw_text as string };
}

function removeDependencyClaim(extraction: Record<string, any>) {
  extraction.claims = extraction.claims.filter(
    (claim: Record<string, any>) => claim.claim_id !== 'cl_a_002',
  );
}

function repair(extraction: Record<string, any>, narrative: string) {
  return repairPersonAExtraction({ extraction, narrative });
}

function publicationExtraFixture() {
  const reference = validPersonAExtraction();
  const extraction = structuredClone(reference);
  const claim = extraction.claims.find((item: Record<string, any>) => item.claim_id === 'cl_a_008');
  extraction.evidence.push({
    ...structuredClone(extraction.evidence[0]),
    evidence_id: 'ev_extra_publication',
    evidence_type: 'other',
    title: 'Alleged brief website publication',
    availability_status: 'unavailable',
    description_from_submitter:
      'Alex says that at least part of the site was briefly published but cannot prove its duration.',
    original_filename: null,
    file_reference: null,
    file_hash: null,
  });
  extraction.claim_evidence_links.push({
    link_id: 'link_extra_publication',
    claim_id: claim.claim_id,
    evidence_id: 'ev_extra_publication',
    relationship: 'supports',
    strength: 'not_assessed',
    decision_critical: false,
    explanation: 'The alleged publication supports the claimed use.',
  });
  return { extraction, reference, narrative: extraction.submission.raw_text as string };
}

describe('deterministic Person A record repair', () => {
  it('preserves the original extraction byte-equivalently', () => {
    const { extraction, narrative } = fixture();
    const before = JSON.stringify(extraction);

    repair(extraction, narrative);

    expect(JSON.stringify(extraction)).toBe(before);
  });

  it('projects an explicit agreement dependency into a missing combined claim', () => {
    const { extraction, narrative } = fixture();
    removeDependencyClaim(extraction);

    const result = repair(extraction, narrative);
    const created = result.repaired_extraction.claims.find(
      (claim: Record<string, any>) =>
        claim.claim_id === 'repair_claim_dependency_term_client_dependency',
    );

    expect(created).toMatchObject({
      claim_type: 'delay',
      party_id: 'party_a',
    });
    expect(created.claim_text).toContain('May 20');
    expect(created.claim_text).toContain('April 25');
    expect(created.source_spans[0].quote).toContain('timeline depended');
  });

  it('does not duplicate an equivalent existing dependency claim', () => {
    const { extraction, narrative } = fixture();

    const result = repair(extraction, narrative);

    expect(
      result.repaired_extraction.claims.filter(
        (claim: Record<string, any>) =>
          claim.claim_id === 'repair_claim_dependency_term_client_dependency',
      ),
    ).toHaveLength(0);
    expect(result.skipped_repairs).toContainEqual(
      expect.objectContaining({
        rule_id: 'agreement_dependency_claim_projection',
        rejection_reason: 'equivalent_object_exists',
      }),
    );
  });

  it('does not duplicate an exact deadline-and-dependency claim pair', () => {
    const { extraction, narrative } = fixture();
    const combined = extraction.claims.find(
      (claim: Record<string, any>) => claim.claim_id === 'cl_a_002',
    );
    extraction.claims = extraction.claims.filter(
      (claim: Record<string, any>) => claim.claim_id !== 'cl_a_002',
    );
    extraction.claims.push(
      {
        ...structuredClone(combined),
        claim_id: 'claim_deadline_split',
        claim_text: 'The intended launch was around May 20.',
      },
      {
        ...structuredClone(combined),
        claim_id: 'claim_dependency_split',
        claim_text: 'The timeline depended on Maya supplying final copy and images by April 25.',
      },
    );

    const result = repair(extraction, narrative);

    expect(
      result.repaired_extraction.claims.filter((claim: Record<string, any>) =>
        String(claim.claim_id).startsWith('repair_claim_dependency_'),
      ),
    ).toHaveLength(0);
    expect(result.skipped_repairs).toContainEqual(
      expect.objectContaining({
        rule_id: 'agreement_dependency_claim_projection',
        rejection_reason: 'equivalent_object_exists',
      }),
    );
  });

  it('repairs null attribution when the exact quote identifies Person A', () => {
    const { extraction, narrative } = fixture();
    const event = extraction.timeline.find(
      (item: Record<string, any>) => item.event_id === 'tl_agreement',
    );
    event.actor_party_id = null;

    const result = repair(extraction, narrative);
    const repairedEvent = result.repaired_extraction.timeline.find(
      (item: Record<string, any>) => item.event_id === 'tl_agreement',
    );

    expect(repairedEvent.actor_party_id).toBe('party_a');
    expect(result.applied_repairs).toContainEqual(
      expect.objectContaining({ rule_id: 'explicit_actor_normalization' }),
    );
  });

  it('rejects an ambiguous explicit actor mapping', () => {
    const { extraction, narrative } = fixture();
    const quote = 'My name is Alex Rivera and I’m a freelance web designer.';
    const start = narrative.indexOf(quote);
    extraction.third_parties.push({
      third_party_id: 'tp_duplicate_alex',
      name_or_label: 'Alex Rivera',
      role: 'designer',
      relationship_to_party_id: null,
      contacted_for_case: false,
      notes: null,
    });
    extraction.timeline.push({
      ...structuredClone(extraction.timeline[0]),
      event_id: 'event_ambiguous_actor',
      actor_party_id: null,
      actor_third_party_id: null,
      source_spans: [
        {
          submission_id: 'sub_a_extracted',
          quote,
          start_char: start,
          end_char: start + quote.length,
        },
      ],
    });

    const result = repair(extraction, narrative);

    expect(result.rejected_repairs).toContainEqual(
      expect.objectContaining({
        target_object_id: 'event_ambiguous_actor',
        rejection_reason: 'ambiguous_actor_mapping',
      }),
    );
  });

  it('does not repair a wrong actor without exact actor grounding', () => {
    const { extraction, narrative } = fixture();
    const event = extraction.timeline.find(
      (item: Record<string, any>) => item.event_id === 'tl_photo_delivery',
    );
    event.actor_party_id = 'party_b';

    const result = repair(extraction, narrative);
    const repairedEvent = result.repaired_extraction.timeline.find(
      (item: Record<string, any>) => item.event_id === 'tl_photo_delivery',
    );

    expect(repairedEvent.actor_party_id).toBe('party_b');
  });

  it('splits separately named deliverables with exact shared grounding', () => {
    const { extraction, narrative } = fixture();
    extraction.deliverable_assessments = extraction.deliverable_assessments.filter(
      (item: Record<string, any>) => !['del_homepage', 'del_about'].includes(item.deliverable_id),
    );
    const quote =
      'The original job was a homepage, about page, services page, contact page, and mobile-responsive layout, with two revision rounds.';
    const start = narrative.indexOf(quote);
    extraction.deliverable_assessments.push({
      ...structuredClone(extraction.deliverable_assessments[0]),
      deliverable_id: 'del_aggregate_pages',
      name: 'Homepage and About page',
      source_spans: [
        {
          submission_id: 'sub_a_extracted',
          quote,
          start_char: start,
          end_char: start + quote.length,
        },
      ],
    });

    const result = repair(extraction, narrative);
    const names = result.repaired_extraction.deliverable_assessments.map(
      (item: Record<string, any>) => item.name,
    );

    expect(names).toContain('Homepage');
    expect(names).toContain('About page');
    expect(names).not.toContain('Homepage and About page');
  });

  it('does not split an aggregate without explicit enumeration', () => {
    const { extraction, narrative } = fixture();
    const quote = 'I sent what I considered a complete staging version on June 3.';
    const start = narrative.indexOf(quote);
    extraction.deliverable_assessments.push({
      ...structuredClone(extraction.deliverable_assessments[0]),
      deliverable_id: 'del_unsupported_aggregate',
      name: 'Homepage and About page',
      source_spans: [
        {
          submission_id: 'sub_a_extracted',
          quote,
          start_char: start,
          end_char: start + quote.length,
        },
      ],
    });

    const result = repair(extraction, narrative);

    expect(result.rejected_repairs).toContainEqual(
      expect.objectContaining({
        target_object_id: 'del_unsupported_aggregate',
        rejection_reason: 'explicit_enumeration_missing',
      }),
    );
  });

  it('splits distinct evidence artifacts without changing availability state', () => {
    const { extraction, narrative } = fixture();
    const quote =
      'Maya also used images from the website in social media posts, and I believe at least part of the site was briefly published, although I cannot prove exactly what was live or for how long.';
    const start = narrative.indexOf(quote);
    extraction.evidence.push({
      ...structuredClone(extraction.evidence[0]),
      evidence_id: 'ev_aggregate_use',
      title: 'Social posts and website publication',
      availability_status: 'described_only',
      source_spans: [
        {
          submission_id: 'sub_a_extracted',
          quote,
          start_char: start,
          end_char: start + quote.length,
        },
      ],
    });

    const result = repair(extraction, narrative);
    const split = result.repaired_extraction.evidence.filter((item: Record<string, any>) =>
      String(item.evidence_id).startsWith('repair_evidence_'),
    );

    expect(split).toHaveLength(2);
    expect(
      split.every((item: Record<string, any>) => item.availability_status === 'described_only'),
    ).toBe(true);
    expect(split.every((item: Record<string, any>) => item.inspected_at === null)).toBe(true);
  });

  it('never fabricates filenames while splitting evidence', () => {
    const { extraction, narrative } = fixture();
    const quote =
      'Maya also used images from the website in social media posts, and I believe at least part of the site was briefly published, although I cannot prove exactly what was live or for how long.';
    const start = narrative.indexOf(quote);
    extraction.evidence.push({
      ...structuredClone(extraction.evidence[0]),
      evidence_id: 'ev_aggregate_no_filename',
      title: 'Social posts and website publication',
      original_filename: 'aggregate.zip',
      source_spans: [
        {
          submission_id: 'sub_a_extracted',
          quote,
          start_char: start,
          end_char: start + quote.length,
        },
      ],
    });

    const result = repair(extraction, narrative);
    const split = result.repaired_extraction.evidence.filter((item: Record<string, any>) =>
      String(item.evidence_id).startsWith('repair_evidence_'),
    );

    expect(split.every((item: Record<string, any>) => item.original_filename === null)).toBe(true);
    expect(split.every((item: Record<string, any>) => item.file_reference === null)).toBe(true);
  });

  it('preserves exact source spans on wrong-family dependency projection', () => {
    const { extraction, narrative } = fixture();
    removeDependencyClaim(extraction);
    const term = extraction.agreement.terms.find(
      (item: Record<string, any>) => item.term_type === 'client_dependency',
    );

    const result = repair(extraction, narrative);
    const created = result.repaired_extraction.claims.find((item: Record<string, any>) =>
      String(item.claim_id).startsWith('repair_claim_dependency_'),
    );

    const deadline = extraction.agreement.terms.find(
      (item: Record<string, any>) => item.term_type === 'deadline',
    );
    expect(created.source_spans).toEqual(
      expect.arrayContaining([...term.source_spans, ...deadline.source_spans]),
    );
  });

  it('keeps repair ordering stable across input order', () => {
    const first = fixture();
    removeDependencyClaim(first.extraction);
    const second = structuredClone(first);
    second.extraction.claims.reverse();
    second.extraction.timeline.reverse();
    second.extraction.agreement.terms.reverse();

    const forward = repair(first.extraction, first.narrative);
    const reverse = repair(second.extraction, second.narrative);

    expect(reverse.applied_repairs.map((item) => [item.rule_id, item.target_object_id])).toEqual(
      forward.applied_repairs.map((item) => [item.rule_id, item.target_object_id]),
    );
  });

  it('produces byte-identical repeated repair output', () => {
    const first = fixture();
    const second = fixture();

    expect(JSON.stringify(repair(second.extraction, second.narrative))).toBe(
      JSON.stringify(repair(first.extraction, first.narrative)),
    );
  });

  it('rejects dependency projection with malformed source spans', () => {
    const { extraction, narrative } = fixture();
    removeDependencyClaim(extraction);
    const term = extraction.agreement.terms.find(
      (item: Record<string, any>) => item.term_type === 'client_dependency',
    );
    term.source_spans[0].end_char += 1;

    const result = repair(extraction, narrative);

    expect(result.rejected_repairs).toContainEqual(
      expect.objectContaining({
        rule_id: 'agreement_dependency_claim_projection',
        rejection_reason: 'source_spans_missing_or_invalid',
      }),
    );
  });

  it('never promotes described-only evidence to inspected', () => {
    const { extraction, narrative } = fixture();
    const before = extraction.evidence.map((item: Record<string, any>) => ({
      id: item.evidence_id,
      availability: item.availability_status,
      inspected: item.inspected_at,
    }));

    const result = repair(extraction, narrative);

    for (const item of before) {
      const after = result.repaired_extraction.evidence.find(
        (candidate: Record<string, any>) => candidate.evidence_id === item.id,
      );
      expect(after.availability_status).toBe(item.availability);
      expect(after.inspected_at).toBe(item.inspected);
    }
  });

  it('cannot create unsupported facts without exact source spans', () => {
    const { extraction, narrative } = fixture();
    removeDependencyClaim(extraction);

    const result = repair(extraction, narrative);

    for (const applied of result.applied_repairs) {
      for (const span of applied.source_spans) {
        expect(narrative.slice(span.start_char, span.end_char)).toBe(span.quote);
      }
    }
  });

  it('does not import or reference the canonical comparison fixture at runtime', () => {
    const source = readFileSync(
      new URL('../repair/person-a-record-repair.ts', import.meta.url),
      'utf8',
    );

    expect(source.toLowerCase()).not.toContain('golden');
    expect(source).not.toContain('person-a-golden');
  });

  it('eliminates the current-style critical only when exact publication grounding exists', () => {
    const { extraction, reference, narrative } = publicationExtraFixture();
    const before = evaluatePersonA(extraction, reference, alignPersonA(extraction, reference));

    const result = repair(extraction, narrative);
    const after = evaluatePersonA(
      result.repaired_extraction,
      reference,
      alignPersonA(result.repaired_extraction, reference),
    );

    expect(before.summary.critical).toBe(1);
    expect(after.summary.critical).toBe(0);
    expect(
      result.repaired_extraction.claims.find(
        (item: Record<string, any>) => item.claim_id === 'cl_a_008',
      ).supporting_evidence_ids,
    ).toContain('ev_extra_publication');
  });

  it('does not increase necessary clarification questions after repair', () => {
    const { extraction, reference, narrative } = publicationExtraFixture();
    const beforeAlignment = alignPersonA(extraction, reference);
    const beforeReport = evaluatePersonA(extraction, reference, beforeAlignment);
    const beforeAssessments = buildPersonAAssessmentResult(
      extraction,
      beforeReport,
      beforeAlignment,
    );
    const beforeNecessity = classifyQuestionNecessity(beforeAssessments.assessments, extraction);
    const beforeQuestions = generateNecessaryClarificationQuestions(
      beforeNecessity.question_candidates,
    );

    const repaired = repair(extraction, narrative).repaired_extraction;
    const afterAlignment = alignPersonA(repaired, reference);
    const afterReport = evaluatePersonA(repaired, reference, afterAlignment);
    const afterAssessments = buildPersonAAssessmentResult(repaired, afterReport, afterAlignment);
    const afterNecessity = classifyQuestionNecessity(afterAssessments.assessments, repaired);
    const afterQuestions = generateNecessaryClarificationQuestions(
      afterNecessity.question_candidates,
    );

    expect(afterQuestions.length).toBeLessThanOrEqual(beforeQuestions.length);
  });

  it('never exposes repair-generated internal issues as clarification questions', () => {
    const { extraction, reference, narrative } = publicationExtraFixture();
    const repaired = repair(extraction, narrative).repaired_extraction;
    const alignment = alignPersonA(repaired, reference);
    const report = evaluatePersonA(repaired, reference, alignment);
    const assessments = buildPersonAAssessmentResult(repaired, report, alignment);
    const necessity = classifyQuestionNecessity(assessments.assessments, repaired);
    const questions = generateNecessaryClarificationQuestions(necessity.question_candidates);

    expect(
      questions.some((question) => String(question.trigger) === 'internal_representation'),
    ).toBe(false);
  });
});
