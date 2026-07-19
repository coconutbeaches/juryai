import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';

type JsonObject = Record<string, any>;

export const clone = <T>(value: T): T => structuredClone(value);

function remapSourceSpans(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(remapSourceSpans);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as JsonObject;
  if (
    typeof object.submission_id === 'string' &&
    typeof object.quote === 'string' &&
    typeof object.start_char === 'number'
  ) {
    object.submission_id = 'sub_a_extracted';
  }
  Object.values(object).forEach(remapSourceSpans);
}

export function validPersonAExtraction(): JsonObject {
  const extraction = clone(buildPersonAGoldenProjection());
  extraction.submission.submission_id = 'sub_a_extracted';
  extraction.metadata = {
    model: 'test-model',
    prompt_version: 'person-a-v0.1.0',
    input_hash: extraction.submission.content_hash,
    generated_at: '2026-07-19T00:00:00Z',
  };
  remapSourceSpans(extraction);
  return extraction;
}

export function modelOutputFromGolden(): JsonObject {
  const extraction = validPersonAExtraction();
  return {
    schema_version: '0.1.2',
    party_profile: {
      display_name: extraction.party.display_name,
      country: extraction.party.country,
      language: extraction.party.language,
    },
    third_parties: extraction.third_parties,
    agreement: extraction.agreement,
    deliverable_assessments: extraction.deliverable_assessments,
    timeline: extraction.timeline,
    claims: extraction.claims,
    evidence: extraction.evidence,
    claim_evidence_links: extraction.claim_evidence_links,
    damages_claims: extraction.damages_claims,
    desired_outcomes: extraction.desired_outcomes,
    extraction_issues: extraction.extraction_issues,
    clarification_questions: extraction.clarification_questions,
  };
}
