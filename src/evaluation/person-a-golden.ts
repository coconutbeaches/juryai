import goldenRecord from '../fixtures/dry_run_001.golden.json';
import { PERSON_A_EXTRACTOR_VERSION, sha256 } from '../extraction/person-a-extractor.js';

type JsonObject = Record<string, any>;

const clone = <T>(value: T): T => structuredClone(value);
const array = (value: unknown): any[] => (Array.isArray(value) ? value : []);

function exactQuoteOffset(narrative: string, quote: string, preferredStart: number): number {
  const matches: number[] = [];
  let cursor = narrative.indexOf(quote);
  while (cursor >= 0) {
    matches.push(cursor);
    cursor = narrative.indexOf(quote, cursor + 1);
  }
  if (matches.length === 0) {
    throw new Error(`Golden source quote is not present verbatim in Person A narrative: ${quote}`);
  }
  return matches.reduce((best, candidate) =>
    Math.abs(candidate - preferredStart) < Math.abs(best - preferredStart) ? candidate : best,
  );
}

function normalizeSourceSpans(value: unknown, narrative: string, submissionId: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => normalizeSourceSpans(entry, narrative, submissionId));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as JsonObject;
  if (
    typeof object.submission_id === 'string' &&
    typeof object.quote === 'string' &&
    typeof object.start_char === 'number' &&
    typeof object.end_char === 'number'
  ) {
    const start = exactQuoteOffset(narrative, object.quote, object.start_char);
    object.submission_id = submissionId;
    object.start_char = start;
    object.end_char = start + object.quote.length;
    return;
  }
  Object.values(object).forEach((child) => normalizeSourceSpans(child, narrative, submissionId));
}

export function buildPersonAGoldenProjection(): JsonObject {
  const record = clone(goldenRecord) as JsonObject;
  const party = record.parties.find((item: JsonObject) => item.party_id === 'party_a');
  const submission = record.submissions.find((item: JsonObject) => item.party_id === 'party_a');
  if (!party || !submission)
    throw new Error('Dry Run 001 is missing Person A party or submission.');

  const thirdParties = record.third_parties.filter(
    (item: JsonObject) => item.relationship_to_party_id === 'party_a',
  );
  const thirdPartyIds = new Set(thirdParties.map((item: JsonObject) => item.third_party_id));
  const evidence = record.evidence.filter(
    (item: JsonObject) => item.submitted_by_party_id === 'party_a',
  );
  const evidenceIds = new Set(evidence.map((item: JsonObject) => item.evidence_id));
  const claims = record.claims
    .filter((item: JsonObject) => item.party_id === 'party_a')
    .map((item: JsonObject) => ({
      ...item,
      response_status: 'unanswered',
      supporting_evidence_ids: item.supporting_evidence_ids.filter((id: string) =>
        evidenceIds.has(id),
      ),
      contradicting_evidence_ids: item.contradicting_evidence_ids.filter((id: string) =>
        evidenceIds.has(id),
      ),
      counterclaim_ids: [],
    }));
  const claimIds = new Set(claims.map((item: JsonObject) => item.claim_id));

  const agreementTerms = record.agreement.terms
    .filter((term: JsonObject) =>
      array(term.source_spans).some((span) => span.submission_id === submission.submission_id),
    )
    .map((term: JsonObject) => ({
      ...term,
      wording_status: 'not_inspected',
      interpretation_status:
        term.interpretation_status === 'not_applicable' ? 'not_applicable' : 'unclear',
      person_b_interpretation: null,
      source_evidence_ids: term.source_evidence_ids.filter((id: string) => evidenceIds.has(id)),
      source_spans: term.source_spans.filter(
        (span: JsonObject) => span.submission_id === submission.submission_id,
      ),
    }));

  const deliverableAssessments = record.deliverable_assessments
    .filter((item: JsonObject) => item.source_claim_ids.some((id: string) => claimIds.has(id)))
    .map((item: JsonObject) => ({
      ...item,
      completion_status_person_b: 'unknown',
      source_claim_ids: item.source_claim_ids.filter((id: string) => claimIds.has(id)),
      source_evidence_ids: item.source_evidence_ids.filter((id: string) => evidenceIds.has(id)),
    }));

  const timeline = record.timeline
    .filter((item: JsonObject) =>
      array(item.source_spans).some((span) => span.submission_id === submission.submission_id),
    )
    .map((item: JsonObject) => ({
      ...item,
      actor_third_party_id:
        item.actor_third_party_id && thirdPartyIds.has(item.actor_third_party_id)
          ? item.actor_third_party_id
          : null,
      asserted_by_party_ids: ['party_a'],
      occurrence_status: 'supported_unanswered',
      interpretation_status: item.person_a_interpretation ? 'unclear' : 'not_applicable',
      person_b_interpretation: null,
      source_evidence_ids: item.source_evidence_ids.filter((id: string) => evidenceIds.has(id)),
      source_spans: item.source_spans.filter(
        (span: JsonObject) => span.submission_id === submission.submission_id,
      ),
    }));

  const claimEvidenceLinks = record.claim_evidence_links.filter(
    (item: JsonObject) => claimIds.has(item.claim_id) && evidenceIds.has(item.evidence_id),
  );
  const damagesClaims = record.damages_claims
    .filter((item: JsonObject) => item.party_id === 'party_a')
    .map((item: JsonObject) => ({
      ...item,
      source_claim_ids: item.source_claim_ids.filter((id: string) => claimIds.has(id)),
      source_evidence_ids: item.source_evidence_ids.filter((id: string) => evidenceIds.has(id)),
    }));
  const desiredOutcomes = record.desired_outcomes.find(
    (item: JsonObject) => item.party_id === 'party_a',
  );
  if (!desiredOutcomes) throw new Error('Dry Run 001 is missing Person A outcomes.');

  const knownIds = new Set<string>([
    'party_a',
    submission.submission_id,
    ...thirdPartyIds,
    ...evidenceIds,
    ...claimIds,
    ...agreementTerms.map((item: JsonObject) => item.term_id),
    ...deliverableAssessments.map((item: JsonObject) => item.deliverable_id),
    ...timeline.map((item: JsonObject) => item.event_id),
    ...claimEvidenceLinks.map((item: JsonObject) => item.link_id),
    ...damagesClaims.map((item: JsonObject) => item.damages_claim_id),
    ...desiredOutcomes.outcomes.map((item: JsonObject) => item.outcome_id),
  ]);

  const extractionIssues = record.extraction_issues
    .filter((item: JsonObject) =>
      array(item.source_spans).some((span) => span.submission_id === submission.submission_id),
    )
    .map((item: JsonObject) => ({
      ...item,
      affected_object_ids: item.affected_object_ids.filter((id: string) => knownIds.has(id)),
      source_spans: item.source_spans.filter(
        (span: JsonObject) => span.submission_id === submission.submission_id,
      ),
    }));
  extractionIssues.forEach((item: JsonObject) => knownIds.add(item.issue_id));

  const clarificationQuestions = record.clarification_questions
    .filter((item: JsonObject) => item.target_party_id === 'party_a')
    .map((item: JsonObject) => ({
      ...item,
      linked_object_ids: item.linked_object_ids.filter((id: string) => knownIds.has(id)),
      answer: null,
      answer_evidence_ids: [],
      status: 'pending',
    }));

  const projection: JsonObject = {
    schema_version: '0.1.2',
    extractor_version: PERSON_A_EXTRACTOR_VERSION,
    party,
    submission,
    third_parties: thirdParties,
    agreement: {
      ...record.agreement,
      source_evidence_ids: record.agreement.source_evidence_ids.filter((id: string) =>
        evidenceIds.has(id),
      ),
      terms: agreementTerms,
      open_issues: record.agreement.open_issues,
    },
    deliverable_assessments: deliverableAssessments,
    timeline,
    claims,
    evidence,
    claim_evidence_links: claimEvidenceLinks,
    damages_claims: damagesClaims,
    desired_outcomes: desiredOutcomes,
    extraction_issues: extractionIssues,
    clarification_questions: clarificationQuestions,
    metadata: {
      model: 'manual-golden-projection',
      prompt_version: PERSON_A_EXTRACTOR_VERSION,
      input_hash: sha256(submission.raw_text),
      generated_at: '2026-07-18T12:30:00Z',
    },
  };

  normalizeSourceSpans(projection, submission.raw_text, submission.submission_id);
  return projection;
}
