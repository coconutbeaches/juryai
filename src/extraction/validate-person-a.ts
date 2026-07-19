import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { personAExtractionSchema } from './person-a-schema.js';
import type { ValidationIssue } from '../validation/custom-invariants.js';

type JsonObject = Record<string, any>;

const array = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function add(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function findForbiddenKeys(value: unknown, issues: ValidationIssue[], path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findForbiddenKeys(entry, issues, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (/private[_-]?settlement|settlement[_-]?floor|reservation[_-]?price/i.test(key)) {
      add(issues, `${path}.${key}`, 'Private settlement fields are prohibited.');
    }
    findForbiddenKeys(child, issues, `${path}.${key}`);
  }
}

function collectIds(record: JsonObject, issues: ValidationIssue[]): Map<string, string> {
  const ids = new Map<string, string>();
  const register = (id: unknown, path: string): void => {
    if (typeof id !== 'string') return;
    const prior = ids.get(id);
    if (prior) add(issues, path, `Duplicate ID '${id}' already exists at ${prior}.`);
    else ids.set(id, path);
  };

  register(record.party?.party_id, '$.party.party_id');
  register(record.submission?.submission_id, '$.submission.submission_id');
  array(record.third_parties).forEach((item, index) =>
    register(item.third_party_id, `$.third_parties[${index}].third_party_id`),
  );
  array(record.agreement?.terms).forEach((item, index) =>
    register(item.term_id, `$.agreement.terms[${index}].term_id`),
  );
  array(record.deliverable_assessments).forEach((item, index) =>
    register(item.deliverable_id, `$.deliverable_assessments[${index}].deliverable_id`),
  );
  array(record.timeline).forEach((item, index) =>
    register(item.event_id, `$.timeline[${index}].event_id`),
  );
  array(record.claims).forEach((item, index) =>
    register(item.claim_id, `$.claims[${index}].claim_id`),
  );
  array(record.evidence).forEach((item, index) => {
    register(item.evidence_id, `$.evidence[${index}].evidence_id`);
    array(item.extracts).forEach((extract, extractIndex) =>
      register(extract.extract_id, `$.evidence[${index}].extracts[${extractIndex}].extract_id`),
    );
  });
  array(record.claim_evidence_links).forEach((item, index) =>
    register(item.link_id, `$.claim_evidence_links[${index}].link_id`),
  );
  array(record.damages_claims).forEach((item, index) =>
    register(item.damages_claim_id, `$.damages_claims[${index}].damages_claim_id`),
  );
  array(record.desired_outcomes?.outcomes).forEach((item, index) =>
    register(item.outcome_id, `$.desired_outcomes.outcomes[${index}].outcome_id`),
  );
  array(record.extraction_issues).forEach((item, index) =>
    register(item.issue_id, `$.extraction_issues[${index}].issue_id`),
  );
  array(record.clarification_questions).forEach((item, index) =>
    register(item.question_id, `$.clarification_questions[${index}].question_id`),
  );
  return ids;
}

function validateReferences(
  record: JsonObject,
  ids: Map<string, string>,
  issues: ValidationIssue[],
): void {
  const expect = (id: unknown, path: string): void => {
    if (typeof id === 'string' && !ids.has(id))
      add(issues, path, `Referenced ID '${id}' does not exist.`);
  };
  const each = (values: unknown, path: string): void =>
    array(values).forEach((id, index) => expect(id, `${path}[${index}]`));

  each(record.agreement?.source_evidence_ids, '$.agreement.source_evidence_ids');
  array(record.agreement?.terms).forEach((term, index) => {
    each(term.source_evidence_ids, `$.agreement.terms[${index}].source_evidence_ids`);
  });
  array(record.deliverable_assessments).forEach((item, index) => {
    each(item.source_claim_ids, `$.deliverable_assessments[${index}].source_claim_ids`);
    each(item.source_evidence_ids, `$.deliverable_assessments[${index}].source_evidence_ids`);
  });
  array(record.timeline).forEach((item, index) => {
    if (item.actor_third_party_id)
      expect(item.actor_third_party_id, `$.timeline[${index}].actor_third_party_id`);
    each(item.source_evidence_ids, `$.timeline[${index}].source_evidence_ids`);
  });
  array(record.claims).forEach((item, index) => {
    each(item.supporting_evidence_ids, `$.claims[${index}].supporting_evidence_ids`);
    each(item.contradicting_evidence_ids, `$.claims[${index}].contradicting_evidence_ids`);
    each(item.counterclaim_ids, `$.claims[${index}].counterclaim_ids`);
  });
  array(record.claim_evidence_links).forEach((item, index) => {
    expect(item.claim_id, `$.claim_evidence_links[${index}].claim_id`);
    expect(item.evidence_id, `$.claim_evidence_links[${index}].evidence_id`);
  });
  array(record.damages_claims).forEach((item, index) => {
    each(item.source_claim_ids, `$.damages_claims[${index}].source_claim_ids`);
    each(item.source_evidence_ids, `$.damages_claims[${index}].source_evidence_ids`);
  });
  array(record.extraction_issues).forEach((item, index) =>
    each(item.affected_object_ids, `$.extraction_issues[${index}].affected_object_ids`),
  );
  array(record.clarification_questions).forEach((item, index) => {
    each(item.linked_object_ids, `$.clarification_questions[${index}].linked_object_ids`);
    each(item.answer_evidence_ids, `$.clarification_questions[${index}].answer_evidence_ids`);
  });
}

function allSourceSpans(record: JsonObject): Array<{ span: JsonObject; path: string }> {
  const result: Array<{ span: JsonObject; path: string }> = [];
  const collect = (spans: unknown, path: string): void => {
    array(spans).forEach((span, index) => result.push({ span, path: `${path}[${index}]` }));
  };
  array(record.agreement?.terms).forEach((item, index) =>
    collect(item.source_spans, `$.agreement.terms[${index}].source_spans`),
  );
  array(record.timeline).forEach((item, index) =>
    collect(item.source_spans, `$.timeline[${index}].source_spans`),
  );
  array(record.claims).forEach((item, index) =>
    collect(item.source_spans, `$.claims[${index}].source_spans`),
  );
  array(record.extraction_issues).forEach((item, index) =>
    collect(item.source_spans, `$.extraction_issues[${index}].source_spans`),
  );
  return result;
}

export type PersonAValidationResult = {
  valid: boolean;
  schemaErrors: ValidationIssue[];
  invariantErrors: ValidationIssue[];
};

export function validatePersonAExtraction(
  record: unknown,
  narrative: string,
): PersonAValidationResult {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(personAExtractionSchema);
  const schemaValid = validate(record);
  const schemaErrors: ValidationIssue[] = (validate.errors ?? []).map((error: ErrorObject) => ({
    path: error.instancePath || '$',
    message: `${error.message ?? 'schema validation error'} (${JSON.stringify(error.params)})`,
  }));
  const invariantErrors: ValidationIssue[] = [];

  if (!schemaValid || !isObject(record)) {
    return { valid: false, schemaErrors, invariantErrors };
  }

  findForbiddenKeys(record, invariantErrors);
  const ids = collectIds(record, invariantErrors);
  validateReferences(record, ids, invariantErrors);

  if (record.party.party_id !== 'party_a' || record.party.role !== 'person_a') {
    add(invariantErrors, '$.party', 'The extraction may contain only Person A as party_a.');
  }
  if (record.submission.party_id !== 'party_a') {
    add(invariantErrors, '$.submission.party_id', 'The submission must belong to party_a.');
  }
  if (record.submission.raw_text !== narrative) {
    add(
      invariantErrors,
      '$.submission.raw_text',
      'The raw submission must preserve the narrative verbatim.',
    );
  }

  for (const { span, path } of allSourceSpans(record)) {
    if (span.submission_id !== record.submission.submission_id) {
      add(
        invariantErrors,
        `${path}.submission_id`,
        'Source spans must reference the Person A submission.',
      );
    }
    const actual = narrative.slice(span.start_char, span.end_char);
    if (actual !== span.quote) {
      add(
        invariantErrors,
        path,
        `Source span does not match the narrative. Expected narrative.slice(${span.start_char}, ${span.end_char}) to equal the quote.`,
      );
    }
  }

  array(record.agreement.terms).forEach((term, index) => {
    if (term.person_b_interpretation !== null) {
      add(
        invariantErrors,
        `$.agreement.terms[${index}].person_b_interpretation`,
        'Person B interpretation cannot be extracted from Person A narrative.',
      );
    }
  });

  array(record.timeline).forEach((event, index) => {
    if (event.person_b_interpretation !== null) {
      add(
        invariantErrors,
        `$.timeline[${index}].person_b_interpretation`,
        'Person B interpretation must be null.',
      );
    }
    if (event.asserted_by_party_ids.length !== 1 || event.asserted_by_party_ids[0] !== 'party_a') {
      add(
        invariantErrors,
        `$.timeline[${index}].asserted_by_party_ids`,
        'Person A extraction events must be asserted only by party_a.',
      );
    }
    if (
      !['supported_unanswered', 'unsupported_claim', 'unclear'].includes(event.occurrence_status)
    ) {
      add(
        invariantErrors,
        `$.timeline[${index}].occurrence_status`,
        'Single-party extraction cannot mark an occurrence agreed or disputed.',
      );
    }
  });

  const evidenceById = new Map(array(record.evidence).map((item) => [item.evidence_id, item]));
  array(record.claims).forEach((claim, index) => {
    if (claim.party_id !== 'party_a')
      add(invariantErrors, `$.claims[${index}].party_id`, 'Claims must be asserted by party_a.');
    if (claim.response_status !== 'unanswered')
      add(
        invariantErrors,
        `$.claims[${index}].response_status`,
        'Person B has not answered; response_status must be unanswered.',
      );
    if (claim.counterclaim_ids.length > 0)
      add(
        invariantErrors,
        `$.claims[${index}].counterclaim_ids`,
        'Person A extraction cannot invent Person B counterclaims.',
      );
    if (claim.support_level !== 'none' && claim.support_level !== 'not_assessed') {
      add(
        invariantErrors,
        `$.claims[${index}].support_level`,
        'Uninspected evidence cannot receive evidentiary support weight.',
      );
    }
  });

  array(record.evidence).forEach((evidence, index) => {
    const path = `$.evidence[${index}]`;
    if (evidence.submitted_by_party_id !== 'party_a')
      add(
        invariantErrors,
        `${path}.submitted_by_party_id`,
        'Evidence stubs must be submitted by party_a.',
      );
    if (!['described_only', 'unavailable'].includes(evidence.availability_status)) {
      add(
        invariantErrors,
        `${path}.availability_status`,
        'Narrative extraction may only create described_only or unavailable evidence.',
      );
    }
    for (const field of ['file_reference', 'file_hash', 'uploaded_at', 'inspected_at']) {
      if (evidence[field] !== null)
        add(
          invariantErrors,
          `${path}.${field}`,
          `${field} must be null before a file is supplied and inspected.`,
        );
    }
    array(evidence.extracts).forEach((extract, extractIndex) => {
      if (extract.author_status === 'verified_from_metadata') {
        add(
          invariantErrors,
          `${path}.extracts[${extractIndex}].author_status`,
          'Uninspected evidence cannot verify authorship from metadata.',
        );
      }
    });
  });

  array(record.claim_evidence_links).forEach((link, index) => {
    if (link.strength !== 'not_assessed')
      add(
        invariantErrors,
        `$.claim_evidence_links[${index}].strength`,
        'Uninspected evidence links must remain not_assessed.',
      );
    if (!evidenceById.has(link.evidence_id))
      add(
        invariantErrors,
        `$.claim_evidence_links[${index}].evidence_id`,
        'Evidence link endpoint is missing.',
      );
  });

  array(record.damages_claims).forEach((claim, index) => {
    if (claim.party_id !== 'party_a')
      add(
        invariantErrors,
        `$.damages_claims[${index}].party_id`,
        'Damages claims must belong to party_a.',
      );
  });
  if (record.desired_outcomes.party_id !== 'party_a') {
    add(invariantErrors, '$.desired_outcomes.party_id', 'Desired outcomes must belong to party_a.');
  }
  array(record.clarification_questions).forEach((question, index) => {
    if (question.target_party_id !== 'party_a')
      add(
        invariantErrors,
        `$.clarification_questions[${index}].target_party_id`,
        'Clarification questions must target party_a.',
      );
    if (
      question.status !== 'pending' ||
      question.answer !== null ||
      question.answer_evidence_ids.length > 0
    ) {
      add(
        invariantErrors,
        `$.clarification_questions[${index}]`,
        'New clarification questions must be pending and unanswered.',
      );
    }
  });

  return {
    valid: schemaErrors.length === 0 && invariantErrors.length === 0,
    schemaErrors,
    invariantErrors,
  };
}
