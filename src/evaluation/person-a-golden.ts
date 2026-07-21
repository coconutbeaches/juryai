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
  if (matches.length === 0)
    throw new Error(`Golden source quote is not present in Person A narrative: ${quote}`);
  return matches.reduce((best, candidate) =>
    Math.abs(candidate - preferredStart) < Math.abs(best - preferredStart) ? candidate : best,
  );
}

function personASpans(item: JsonObject, submissionId: string): JsonObject[] {
  return array(item.source_spans)
    .filter((span) => span.submission_id === submissionId)
    .map((span) => ({
      submission_id: submissionId,
      quote: span.quote,
      start_char: span.start_char,
      end_char: span.end_char,
    }));
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

function quoteSummary(spans: JsonObject[]): string {
  return spans.map((span) => span.quote).join(' ');
}

function personAOnlyDate(date: JsonObject, spans: JsonObject[]): JsonObject {
  if (/\b(?:19|20)\d{2}\b/.test(quoteSummary(spans))) return clone(date);
  return {
    start: null,
    end: null,
    precision: 'unknown',
    approximate: false,
  };
}

export function buildPersonAGoldenProjection(): JsonObject {
  const record = clone(goldenRecord) as JsonObject;
  const party = record.parties.find((item: JsonObject) => item.party_id === 'party_a');
  const submission = record.submissions.find((item: JsonObject) => item.party_id === 'party_a');
  if (!party || !submission)
    throw new Error('Dry Run 001 is missing Person A party or submission.');

  const thirdParties = record.third_parties
    .filter((item: JsonObject) => item.relationship_to_party_id === 'party_a')
    .map((item: JsonObject) => ({
      third_party_id: item.third_party_id,
      name_or_label: item.name_or_label,
      role: item.role,
      relationship_to_party_id: item.relationship_to_party_id,
      contacted_for_case: item.contacted_for_case,
      notes: item.notes,
    }));
  const thirdPartyIds = new Set(thirdParties.map((item: JsonObject) => item.third_party_id));

  const evidence = record.evidence
    .filter((item: JsonObject) => item.submitted_by_party_id === 'party_a')
    .map((item: JsonObject) => clone(item));
  const evidenceIds = new Set(evidence.map((item: JsonObject) => item.evidence_id));

  const claims = record.claims
    .filter((item: JsonObject) => item.party_id === 'party_a')
    .map((item: JsonObject) => ({
      claim_id: item.claim_id,
      party_id: 'party_a',
      claim_text: item.claim_text,
      claim_type: item.claim_type,
      response_status: 'unanswered',
      materiality: item.materiality,
      support_level: item.support_level,
      supporting_evidence_ids: item.supporting_evidence_ids.filter((id: string) =>
        evidenceIds.has(id),
      ),
      contradicting_evidence_ids: item.contradicting_evidence_ids.filter((id: string) =>
        evidenceIds.has(id),
      ),
      counterclaim_ids: [],
      requires_clarification: item.requires_clarification,
      against_asserting_party_interest: item.against_asserting_party_interest,
      source_spans: personASpans(item, submission.submission_id),
    }));
  const claimIds = new Set(claims.map((item: JsonObject) => item.claim_id));

  const agreementTerms = record.agreement.terms
    .map((term: JsonObject) => ({ term, spans: personASpans(term, submission.submission_id) }))
    .filter(({ spans }: { spans: JsonObject[] }) => spans.length > 0)
    .map(({ term, spans }: { term: JsonObject; spans: JsonObject[] }) => ({
      term_id: term.term_id,
      term_type: term.term_type,
      wording: quoteSummary(spans),
      wording_status: 'not_inspected',
      interpretation_status: term.person_a_interpretation ? 'unclear' : 'not_applicable',
      person_a_interpretation: term.person_a_interpretation,
      person_b_interpretation: null,
      source_evidence_ids: term.source_evidence_ids.filter((id: string) => evidenceIds.has(id)),
      materiality: term.materiality,
      source_spans: spans,
    }));

  const deliverableAssessments = record.deliverable_assessments
    .filter((item: JsonObject) => item.source_claim_ids.some((id: string) => claimIds.has(id)))
    .map((item: JsonObject) => ({
      deliverable_id: item.deliverable_id,
      name: item.name,
      scope_status: item.scope_status,
      completion_status_person_a: item.completion_status_person_a,
      completion_status_person_b: 'unknown',
      use_status: 'unknown',
      alleged_defects: [],
      repair_attempts: array(item.repair_attempts).filter(
        (attempt) => typeof attempt === 'string' && /^Alex\b/i.test(attempt),
      ),
      source_claim_ids: item.source_claim_ids.filter((id: string) => claimIds.has(id)),
      source_evidence_ids: item.source_evidence_ids.filter((id: string) => evidenceIds.has(id)),
      materiality: item.materiality,
    }));

  const timeline = record.timeline
    .map((item: JsonObject) => ({ item, spans: personASpans(item, submission.submission_id) }))
    .filter(({ spans }: { spans: JsonObject[] }) => spans.length > 0)
    .map(({ item, spans }: { item: JsonObject; spans: JsonObject[] }) => ({
      event_id: item.event_id,
      date: personAOnlyDate(item.date, spans),
      event_summary: quoteSummary(spans),
      actor_party_id: item.actor_party_id,
      actor_third_party_id:
        item.actor_third_party_id && thirdPartyIds.has(item.actor_third_party_id)
          ? item.actor_third_party_id
          : null,
      asserted_by_party_ids: ['party_a'],
      occurrence_status: 'supported_unanswered',
      interpretation_status: item.person_a_interpretation ? 'unclear' : 'not_applicable',
      person_a_interpretation: item.person_a_interpretation,
      person_b_interpretation: null,
      source_evidence_ids: item.source_evidence_ids.filter((id: string) => evidenceIds.has(id)),
      source_spans: spans,
      materiality: item.materiality,
    }));

  const claimEvidenceLinks = record.claim_evidence_links
    .filter((item: JsonObject) => claimIds.has(item.claim_id) && evidenceIds.has(item.evidence_id))
    .map((item: JsonObject) => ({
      link_id: item.link_id,
      claim_id: item.claim_id,
      evidence_id: item.evidence_id,
      relationship: item.relationship,
      strength: 'not_assessed',
      decision_critical: item.decision_critical,
      explanation: item.explanation,
    }));

  const damagesClaims = record.damages_claims
    .filter((item: JsonObject) => item.party_id === 'party_a')
    .map((item: JsonObject) => ({
      damages_claim_id: item.damages_claim_id,
      party_id: 'party_a',
      loss_type: item.loss_type,
      amount_min: item.amount_min,
      amount_max: item.amount_max,
      currency: item.currency,
      causal_theory: item.causal_theory,
      calculation_basis: item.calculation_basis,
      calculation_status: item.calculation_status,
      support_level: item.support_level,
      source_claim_ids: item.source_claim_ids.filter((id: string) => claimIds.has(id)),
      source_evidence_ids: item.source_evidence_ids.filter((id: string) => evidenceIds.has(id)),
      requires_clarification: item.requires_clarification,
    }));

  const desiredSource = record.desired_outcomes.find(
    (item: JsonObject) => item.party_id === 'party_a',
  );
  if (!desiredSource) throw new Error('Dry Run 001 is missing Person A outcomes.');
  const desiredOutcomes = {
    party_id: 'party_a',
    outcomes: desiredSource.outcomes.map((item: JsonObject) => clone(item)),
  };

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
    .map((item: JsonObject) => ({ item, spans: personASpans(item, submission.submission_id) }))
    .filter(({ spans }: { spans: JsonObject[] }) => spans.length > 0)
    .map(({ item, spans }: { item: JsonObject; spans: JsonObject[] }) => ({
      issue_id: item.issue_id,
      issue_type: item.issue_type,
      severity: item.severity,
      description: quoteSummary(spans),
      affected_object_ids: item.affected_object_ids.filter((id: string) => knownIds.has(id)),
      resolution_status: item.resolution_status,
      source_spans: spans,
    }));
  extractionIssues.forEach((item: JsonObject) => knownIds.add(item.issue_id));

  const clarificationQuestions = record.clarification_questions
    .filter((item: JsonObject) => item.target_party_id === 'party_a')
    .map((item: JsonObject) => ({
      question_id: item.question_id,
      target_party_id: 'party_a',
      question: item.question,
      reason: item.reason,
      linked_object_ids: item.linked_object_ids.filter((id: string) => knownIds.has(id)),
      priority: item.priority,
      answer: null,
      answer_evidence_ids: [],
      status: 'pending',
    }));

  const projection: JsonObject = {
    schema_version: '0.1.2',
    extractor_version: PERSON_A_EXTRACTOR_VERSION,
    party: clone(party),
    submission: clone(submission),
    third_parties: thirdParties,
    agreement: {
      agreement_exists: record.agreement.agreement_exists,
      agreement_form: record.agreement.agreement_form,
      agreement_summary:
        'Alex describes a written agreement for a five-page website priced at $2,400 with a $1,200 deposit and balance due on completion.',
      source_evidence_ids: record.agreement.source_evidence_ids.filter((id: string) =>
        evidenceIds.has(id),
      ),
      terms: agreementTerms,
      open_issues: [
        'The described contract has not been uploaded or inspected.',
        'Completion and acceptance remain unclear from Person A narrative alone.',
      ],
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
