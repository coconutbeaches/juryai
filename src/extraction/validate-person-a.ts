import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { personAExtractionSchema } from './person-a-schema.js';
import type { ValidationIssue } from '../validation/custom-invariants.js';

type JsonObject = Record<string, any>;
type IdFamily =
  | 'party'
  | 'third_party'
  | 'submission'
  | 'agreement_term'
  | 'deliverable'
  | 'timeline'
  | 'claim'
  | 'evidence'
  | 'evidence_extract'
  | 'claim_evidence_link'
  | 'damages'
  | 'outcome'
  | 'extraction_issue'
  | 'clarification_question';

type IdRegistry = Record<IdFamily, Set<string>>;

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

function emptyRegistry(): IdRegistry {
  return {
    party: new Set(['party_a', 'party_b']),
    third_party: new Set(),
    submission: new Set(),
    agreement_term: new Set(),
    deliverable: new Set(),
    timeline: new Set(),
    claim: new Set(),
    evidence: new Set(),
    evidence_extract: new Set(),
    claim_evidence_link: new Set(),
    damages: new Set(),
    outcome: new Set(),
    extraction_issue: new Set(),
    clarification_question: new Set(),
  };
}

function collectIds(record: JsonObject, issues: ValidationIssue[]): IdRegistry {
  const registry = emptyRegistry();
  const all = new Map<string, string>();
  const register = (family: IdFamily, id: unknown, path: string): void => {
    if (typeof id !== 'string') return;
    const prior = all.get(id);
    if (prior) add(issues, path, `Duplicate ID '${id}' already exists at ${prior}.`);
    else {
      all.set(id, path);
      registry[family].add(id);
    }
  };

  register('party', record.party?.party_id, '$.party.party_id');
  register('submission', record.submission?.submission_id, '$.submission.submission_id');
  array(record.third_parties).forEach((item, index) =>
    register('third_party', item.third_party_id, `$.third_parties[${index}].third_party_id`),
  );
  array(record.agreement?.terms).forEach((item, index) =>
    register('agreement_term', item.term_id, `$.agreement.terms[${index}].term_id`),
  );
  array(record.deliverable_assessments).forEach((item, index) =>
    register(
      'deliverable',
      item.deliverable_id,
      `$.deliverable_assessments[${index}].deliverable_id`,
    ),
  );
  array(record.timeline).forEach((item, index) =>
    register('timeline', item.event_id, `$.timeline[${index}].event_id`),
  );
  array(record.claims).forEach((item, index) =>
    register('claim', item.claim_id, `$.claims[${index}].claim_id`),
  );
  array(record.evidence).forEach((item, index) => {
    register('evidence', item.evidence_id, `$.evidence[${index}].evidence_id`);
    array(item.extracts).forEach((extract, extractIndex) =>
      register(
        'evidence_extract',
        extract.extract_id,
        `$.evidence[${index}].extracts[${extractIndex}].extract_id`,
      ),
    );
  });
  array(record.claim_evidence_links).forEach((item, index) =>
    register('claim_evidence_link', item.link_id, `$.claim_evidence_links[${index}].link_id`),
  );
  array(record.damages_claims).forEach((item, index) =>
    register('damages', item.damages_claim_id, `$.damages_claims[${index}].damages_claim_id`),
  );
  array(record.desired_outcomes?.outcomes).forEach((item, index) =>
    register('outcome', item.outcome_id, `$.desired_outcomes.outcomes[${index}].outcome_id`),
  );
  array(record.extraction_issues).forEach((item, index) =>
    register('extraction_issue', item.issue_id, `$.extraction_issues[${index}].issue_id`),
  );
  array(record.clarification_questions).forEach((item, index) =>
    register(
      'clarification_question',
      item.question_id,
      `$.clarification_questions[${index}].question_id`,
    ),
  );
  return registry;
}

function validateReferences(record: JsonObject, ids: IdRegistry, issues: ValidationIssue[]): void {
  const expect = (id: unknown, family: IdFamily | IdFamily[], path: string): void => {
    if (typeof id !== 'string') return;
    const families = Array.isArray(family) ? family : [family];
    if (!families.some((candidate) => ids[candidate].has(id))) {
      add(issues, path, `Referenced ID '${id}' must belong to ${families.join(' or ')}.`);
    }
  };
  const each = (values: unknown, family: IdFamily | IdFamily[], path: string): void =>
    array(values).forEach((id, index) => expect(id, family, `${path}[${index}]`));

  each(record.agreement?.source_evidence_ids, 'evidence', '$.agreement.source_evidence_ids');
  array(record.agreement?.terms).forEach((term, index) =>
    each(term.source_evidence_ids, 'evidence', `$.agreement.terms[${index}].source_evidence_ids`),
  );
  array(record.deliverable_assessments).forEach((item, index) => {
    each(item.source_claim_ids, 'claim', `$.deliverable_assessments[${index}].source_claim_ids`);
    each(
      item.source_evidence_ids,
      'evidence',
      `$.deliverable_assessments[${index}].source_evidence_ids`,
    );
  });
  array(record.timeline).forEach((item, index) => {
    if (item.actor_party_id)
      expect(item.actor_party_id, 'party', `$.timeline[${index}].actor_party_id`);
    if (item.actor_third_party_id)
      expect(item.actor_third_party_id, 'third_party', `$.timeline[${index}].actor_third_party_id`);
    each(item.asserted_by_party_ids, 'party', `$.timeline[${index}].asserted_by_party_ids`);
    each(item.source_evidence_ids, 'evidence', `$.timeline[${index}].source_evidence_ids`);
  });
  array(record.claims).forEach((item, index) => {
    expect(item.party_id, 'party', `$.claims[${index}].party_id`);
    each(item.supporting_evidence_ids, 'evidence', `$.claims[${index}].supporting_evidence_ids`);
    each(
      item.contradicting_evidence_ids,
      'evidence',
      `$.claims[${index}].contradicting_evidence_ids`,
    );
    each(item.counterclaim_ids, 'claim', `$.claims[${index}].counterclaim_ids`);
  });
  array(record.claim_evidence_links).forEach((item, index) => {
    expect(item.claim_id, 'claim', `$.claim_evidence_links[${index}].claim_id`);
    expect(item.evidence_id, 'evidence', `$.claim_evidence_links[${index}].evidence_id`);
  });
  array(record.damages_claims).forEach((item, index) => {
    expect(item.party_id, 'party', `$.damages_claims[${index}].party_id`);
    each(item.source_claim_ids, 'claim', `$.damages_claims[${index}].source_claim_ids`);
    each(item.source_evidence_ids, 'evidence', `$.damages_claims[${index}].source_evidence_ids`);
  });
  const linkable: IdFamily[] = [
    'agreement_term',
    'deliverable',
    'timeline',
    'claim',
    'evidence',
    'damages',
    'outcome',
    'extraction_issue',
  ];
  array(record.extraction_issues).forEach((item, index) =>
    each(item.affected_object_ids, linkable, `$.extraction_issues[${index}].affected_object_ids`),
  );
  array(record.clarification_questions).forEach((item, index) => {
    expect(item.target_party_id, 'party', `$.clarification_questions[${index}].target_party_id`);
    each(item.linked_object_ids, linkable, `$.clarification_questions[${index}].linked_object_ids`);
    each(
      item.answer_evidence_ids,
      'evidence',
      `$.clarification_questions[${index}].answer_evidence_ids`,
    );
  });
}

function tracedObjects(record: JsonObject): Array<{ spans: unknown; path: string }> {
  return [
    ...array(record.agreement?.terms).map((item, index) => ({
      spans: item.source_spans,
      path: `$.agreement.terms[${index}].source_spans`,
    })),
    ...array(record.timeline).map((item, index) => ({
      spans: item.source_spans,
      path: `$.timeline[${index}].source_spans`,
    })),
    ...array(record.claims).map((item, index) => ({
      spans: item.source_spans,
      path: `$.claims[${index}].source_spans`,
    })),
    ...array(record.extraction_issues).map((item, index) => ({
      spans: item.source_spans,
      path: `$.extraction_issues[${index}].source_spans`,
    })),
  ];
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
  if (!schemaValid || !isObject(record)) return { valid: false, schemaErrors, invariantErrors };

  findForbiddenKeys(record, invariantErrors);
  const ids = collectIds(record, invariantErrors);
  validateReferences(record, ids, invariantErrors);

  if (record.party.party_id !== 'party_a' || record.party.role !== 'person_a')
    add(invariantErrors, '$.party', 'The extraction may contain only Person A as party_a.');
  if (record.submission.party_id !== 'party_a')
    add(invariantErrors, '$.submission.party_id', 'The submission must belong to party_a.');
  if (record.submission.raw_text !== narrative)
    add(
      invariantErrors,
      '$.submission.raw_text',
      'The raw submission must preserve the narrative verbatim.',
    );

  const expectedHash = createHash('sha256').update(narrative, 'utf8').digest('hex');
  if (record.submission.content_hash !== expectedHash)
    add(
      invariantErrors,
      '$.submission.content_hash',
      'The submission content_hash must equal sha256(narrative).',
    );
  if (record.metadata.input_hash !== expectedHash)
    add(
      invariantErrors,
      '$.metadata.input_hash',
      'The metadata input_hash must equal sha256(narrative).',
    );

  for (const traced of tracedObjects(record)) {
    const spans = array(traced.spans);
    if (spans.length === 0)
      add(
        invariantErrors,
        traced.path,
        'Narrative-derived objects require at least one source span.',
      );
    spans.forEach((span, index) => {
      const path = `${traced.path}[${index}]`;
      if (span.submission_id !== record.submission.submission_id)
        add(
          invariantErrors,
          `${path}.submission_id`,
          'Source spans must reference the Person A submission.',
        );
      if (narrative.slice(span.start_char, span.end_char) !== span.quote)
        add(
          invariantErrors,
          path,
          `Source span does not match narrative.slice(${span.start_char}, ${span.end_char}).`,
        );
    });
  }

  array(record.agreement.terms).forEach((term, index) => {
    if (term.person_b_interpretation !== null)
      add(
        invariantErrors,
        `$.agreement.terms[${index}].person_b_interpretation`,
        'Person B interpretation cannot be extracted from Person A narrative.',
      );
  });
  array(record.timeline).forEach((event, index) => {
    if (event.person_b_interpretation !== null)
      add(
        invariantErrors,
        `$.timeline[${index}].person_b_interpretation`,
        'Person B interpretation must be null.',
      );
    if (
      event.asserted_by_party_ids.length !== 1 ||
      event.asserted_by_party_ids[0] !== 'party_a'
    )
      add(
        invariantErrors,
        `$.timeline[${index}].asserted_by_party_ids`,
        'Person A extraction events must be asserted only by party_a.',
      );
    if (!['supported_unanswered', 'unsupported_claim', 'unclear'].includes(event.occurrence_status))
      add(
        invariantErrors,
        `$.timeline[${index}].occurrence_status`,
        'Single-party extraction cannot mark an occurrence agreed or disputed.',
      );
  });

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
    if (!['none', 'not_assessed'].includes(claim.support_level))
      add(
        invariantErrors,
        `$.claims[${index}].support_level`,
        'Uninspected evidence cannot receive evidentiary support weight.',
      );
  });

  array(record.evidence).forEach((evidence, index) => {
    const path = `$.evidence[${index}]`;
    if (evidence.submitted_by_party_id !== 'party_a')
      add(invariantErrors, `${path}.submitted_by_party_id`, 'Evidence stubs must be submitted by party_a.');
    if (!['described_only', 'unavailable'].includes(evidence.availability_status))
      add(
        invariantErrors,
        `${path}.availability_status`,
        'Narrative extraction may only create described_only or unavailable evidence.',
      );
    for (const field of ['file_reference', 'file_hash', 'uploaded_at', 'inspected_at']) {
      if (evidence[field] !== null)
        add(
          invariantErrors,
          `${path}.${field}`,
          `${field} must be null before a file is supplied and inspected.`,
        );
    }
    if (evidence.original_filename !== null && !narrative.includes(evidence.original_filename))
      add(
        invariantErrors,
        `${path}.original_filename`,
        'original_filename must be null unless the exact filename appears in the narrative.',
      );
    array(evidence.extracts).forEach((extract, extractIndex) => {
      if (extract.author_status === 'verified_from_metadata')
        add(
          invariantErrors,
          `${path}.extracts[${extractIndex}].author_status`,
          'Uninspected evidence cannot verify authorship from metadata.',
        );
    });
  });

  array(record.claim_evidence_links).forEach((link, index) => {
    if (link.strength !== 'not_assessed')
      add(
        invariantErrors,
        `$.claim_evidence_links[${index}].strength`,
        'Uninspected evidence links must remain not_assessed.',
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
  if (record.desired_outcomes.party_id !== 'party_a')
    add(invariantErrors, '$.desired_outcomes.party_id', 'Desired outcomes must belong to party_a.');
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
    )
      add(
        invariantErrors,
        `$.clarification_questions[${index}]`,
        'New clarification questions must be pending and unanswered.',
      );
  });

  return {
    valid: schemaErrors.length === 0 && invariantErrors.length === 0,
    schemaErrors,
    invariantErrors,
  };
}
