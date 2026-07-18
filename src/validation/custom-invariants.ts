export type ValidationIssue = {
  path: string;
  message: string;
};

type JsonObject = Record<string, any>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const array = (value: unknown): any[] => (Array.isArray(value) ? value : []);

function addIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function deepFindForbiddenKeys(value: unknown, issues: ValidationIssue[], path = '$'): void {
  const forbidden = [
    /private[_-]?settlement/i,
    /settlement[_-]?floor/i,
    /minimum[_-]?acceptable/i,
    /maximum[_-]?concession/i,
    /reservation[_-]?price/i,
  ];

  if (Array.isArray(value)) {
    value.forEach((entry, index) => deepFindForbiddenKeys(entry, issues, `${path}[${index}]`));
    return;
  }

  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (forbidden.some((pattern) => pattern.test(key))) {
      addIssue(issues, `${path}.${key}`, 'Private settlement fields are prohibited in v0.1.1.');
    }
    deepFindForbiddenKeys(child, issues, `${path}.${key}`);
  }
}

function collectIds(record: JsonObject, issues: ValidationIssue[]) {
  const ids = new Map<string, string>();
  const families = new Map<string, string>();

  const register = (id: unknown, family: string, path: string): void => {
    if (typeof id !== 'string') return;
    const previous = ids.get(id);
    if (previous) {
      addIssue(issues, path, `Duplicate canonical ID '${id}' already used at ${previous}.`);
      return;
    }
    ids.set(id, path);
    families.set(id, family);
  };

  register(record.case?.case_id, 'case', '$.case.case_id');
  array(record.parties).forEach((item, index) =>
    register(item.party_id, 'party', `$.parties[${index}].party_id`),
  );
  array(record.third_parties).forEach((item, index) =>
    register(item.third_party_id, 'third_party', `$.third_parties[${index}].third_party_id`),
  );
  array(record.submissions).forEach((item, index) =>
    register(item.submission_id, 'submission', `$.submissions[${index}].submission_id`),
  );
  array(record.agreement?.terms).forEach((item, index) =>
    register(item.term_id, 'agreement_term', `$.agreement.terms[${index}].term_id`),
  );
  array(record.deliverable_assessments).forEach((item, index) =>
    register(
      item.deliverable_id,
      'deliverable',
      `$.deliverable_assessments[${index}].deliverable_id`,
    ),
  );
  array(record.timeline).forEach((item, index) =>
    register(item.event_id, 'timeline_event', `$.timeline[${index}].event_id`),
  );
  array(record.claims).forEach((item, index) =>
    register(item.claim_id, 'claim', `$.claims[${index}].claim_id`),
  );
  array(record.evidence).forEach((item, index) => {
    register(item.evidence_id, 'evidence', `$.evidence[${index}].evidence_id`);
    array(item.extracts).forEach((extract, extractIndex) =>
      register(
        extract.extract_id,
        'evidence_extract',
        `$.evidence[${index}].extracts[${extractIndex}].extract_id`,
      ),
    );
  });
  array(record.claim_evidence_links).forEach((item, index) =>
    register(item.link_id, 'claim_evidence_link', `$.claim_evidence_links[${index}].link_id`),
  );
  array(record.evidence_evidence_links).forEach((item, index) =>
    register(item.link_id, 'evidence_evidence_link', `$.evidence_evidence_links[${index}].link_id`),
  );
  array(record.damages_claims).forEach((item, index) =>
    register(item.damages_claim_id, 'damages_claim', `$.damages_claims[${index}].damages_claim_id`),
  );
  array(record.desired_outcomes).forEach((partyOutcomes, partyIndex) =>
    array(partyOutcomes.outcomes).forEach((outcome, outcomeIndex) =>
      register(
        outcome.outcome_id,
        'outcome',
        `$.desired_outcomes[${partyIndex}].outcomes[${outcomeIndex}].outcome_id`,
      ),
    ),
  );
  array(record.resolution_attempts).forEach((item, index) =>
    register(item.attempt_id, 'resolution_attempt', `$.resolution_attempts[${index}].attempt_id`),
  );
  array(record.extraction_issues).forEach((item, index) =>
    register(item.issue_id, 'extraction_issue', `$.extraction_issues[${index}].issue_id`),
  );
  array(record.clarification_questions).forEach((item, index) =>
    register(
      item.question_id,
      'clarification_question',
      `$.clarification_questions[${index}].question_id`,
    ),
  );
  array(record.record_review?.person_a?.corrections).forEach((item, index) =>
    register(
      item.correction_id,
      'correction',
      `$.record_review.person_a.corrections[${index}].correction_id`,
    ),
  );
  array(record.record_review?.person_b?.corrections).forEach((item, index) =>
    register(
      item.correction_id,
      'correction',
      `$.record_review.person_b.corrections[${index}].correction_id`,
    ),
  );
  array(record.fact_findings?.findings).forEach((item, index) =>
    register(item.fact_id, 'fact_finding', `$.fact_findings.findings[${index}].fact_id`),
  );
  array(record.fact_findings?.unresolved_uncertainties).forEach((item, index) =>
    register(
      item.uncertainty_id,
      'uncertainty',
      `$.fact_findings.unresolved_uncertainties[${index}].uncertainty_id`,
    ),
  );
  if (record.recommendation) {
    register(
      record.recommendation.recommendation_id,
      'recommendation',
      '$.recommendation.recommendation_id',
    );
    register(
      record.recommendation.recommended_outcome?.outcome_id,
      'outcome',
      '$.recommendation.recommended_outcome.outcome_id',
    );
  }
  array(record.audit?.model_runs).forEach((item, index) =>
    register(item.run_id, 'model_run', `$.audit.model_runs[${index}].run_id`),
  );

  return { ids, families };
}

function validateReferences(
  record: JsonObject,
  issues: ValidationIssue[],
  ids: Map<string, string>,
  families: Map<string, string>,
): void {
  const expect = (id: unknown, family: string | string[], path: string): void => {
    if (typeof id !== 'string') return;
    if (!ids.has(id)) {
      addIssue(issues, path, `Referenced ID '${id}' does not exist.`);
      return;
    }
    const actual = families.get(id);
    const allowed = Array.isArray(family) ? family : [family];
    if (!actual || !allowed.includes(actual)) {
      addIssue(
        issues,
        path,
        `Referenced ID '${id}' belongs to '${actual ?? 'unknown'}', expected ${allowed.join(' or ')}.`,
      );
    }
  };

  const each = (values: unknown, family: string | string[], path: string): void => {
    array(values).forEach((id, index) => expect(id, family, `${path}[${index}]`));
  };

  const validateSourceSpans = (spans: unknown, path: string): void => {
    array(spans).forEach((item, index) =>
      expect(item.submission_id, 'submission', `${path}[${index}].submission_id`),
    );
  };

  each(record.agreement?.source_evidence_ids, 'evidence', '$.agreement.source_evidence_ids');
  array(record.agreement?.terms).forEach((term, index) => {
    each(term.source_evidence_ids, 'evidence', `$.agreement.terms[${index}].source_evidence_ids`);
    validateSourceSpans(term.source_spans, `$.agreement.terms[${index}].source_spans`);
  });

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
    validateSourceSpans(item.source_spans, `$.timeline[${index}].source_spans`);
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
    validateSourceSpans(item.source_spans, `$.claims[${index}].source_spans`);
  });

  array(record.evidence).forEach((item, index) => {
    expect(item.submitted_by_party_id, 'party', `$.evidence[${index}].submitted_by_party_id`);
    each(
      item.claimed_to_have_existed_by_party_ids,
      'party',
      `$.evidence[${index}].claimed_to_have_existed_by_party_ids`,
    );
    array(item.extracts).forEach((extract, extractIndex) => {
      if (extract.author_party_id)
        expect(
          extract.author_party_id,
          'party',
          `$.evidence[${index}].extracts[${extractIndex}].author_party_id`,
        );
      if (extract.author_third_party_id)
        expect(
          extract.author_third_party_id,
          'third_party',
          `$.evidence[${index}].extracts[${extractIndex}].author_third_party_id`,
        );
    });
  });

  array(record.claim_evidence_links).forEach((item, index) => {
    expect(item.claim_id, 'claim', `$.claim_evidence_links[${index}].claim_id`);
    expect(item.evidence_id, 'evidence', `$.claim_evidence_links[${index}].evidence_id`);
  });

  array(record.evidence_evidence_links).forEach((item, index) => {
    expect(
      item.from_evidence_id,
      'evidence',
      `$.evidence_evidence_links[${index}].from_evidence_id`,
    );
    expect(item.to_evidence_id, 'evidence', `$.evidence_evidence_links[${index}].to_evidence_id`);
  });

  array(record.damages_claims).forEach((item, index) => {
    expect(item.party_id, 'party', `$.damages_claims[${index}].party_id`);
    each(item.source_claim_ids, 'claim', `$.damages_claims[${index}].source_claim_ids`);
    each(item.source_evidence_ids, 'evidence', `$.damages_claims[${index}].source_evidence_ids`);
  });

  array(record.desired_outcomes).forEach((item, partyIndex) => {
    expect(item.party_id, 'party', `$.desired_outcomes[${partyIndex}].party_id`);
    array(item.outcomes).forEach((outcome, outcomeIndex) =>
      array(outcome.transfers).forEach((transfer, transferIndex) => {
        expect(
          transfer.from_party_id,
          'party',
          `$.desired_outcomes[${partyIndex}].outcomes[${outcomeIndex}].transfers[${transferIndex}].from_party_id`,
        );
        expect(
          transfer.to_party_id,
          'party',
          `$.desired_outcomes[${partyIndex}].outcomes[${outcomeIndex}].transfers[${transferIndex}].to_party_id`,
        );
      }),
    );
  });

  each(
    record.case?.financial_envelope?.derived_from_outcome_ids,
    'outcome',
    '$.case.financial_envelope.derived_from_outcome_ids',
  );

  array(record.resolution_attempts).forEach((item, index) => {
    expect(
      item.initiated_by_party_id,
      'party',
      `$.resolution_attempts[${index}].initiated_by_party_id`,
    );
    each(
      item.source_evidence_ids,
      'evidence',
      `$.resolution_attempts[${index}].source_evidence_ids`,
    );
  });

  array(record.extraction_issues).forEach((item, index) => {
    each(
      item.affected_object_ids,
      [
        'agreement_term',
        'deliverable',
        'timeline_event',
        'claim',
        'evidence',
        'claim_evidence_link',
        'evidence_evidence_link',
        'damages_claim',
        'outcome',
        'uncertainty',
      ],
      `$.extraction_issues[${index}].affected_object_ids`,
    );
    validateSourceSpans(item.source_spans, `$.extraction_issues[${index}].source_spans`);
  });

  array(record.clarification_questions).forEach((item, index) => {
    expect(item.target_party_id, 'party', `$.clarification_questions[${index}].target_party_id`);
    each(
      item.linked_object_ids,
      [
        'agreement_term',
        'deliverable',
        'timeline_event',
        'claim',
        'evidence',
        'claim_evidence_link',
        'evidence_evidence_link',
        'damages_claim',
        'outcome',
        'uncertainty',
      ],
      `$.clarification_questions[${index}].linked_object_ids`,
    );
    each(
      item.answer_evidence_ids,
      'evidence',
      `$.clarification_questions[${index}].answer_evidence_ids`,
    );
  });

  ['person_a', 'person_b'].forEach((key) =>
    array(record.record_review?.[key]?.corrections).forEach((item, index) =>
      expect(
        item.target_id,
        [
          'agreement_term',
          'deliverable',
          'timeline_event',
          'claim',
          'evidence',
          'damages_claim',
          'outcome',
          'uncertainty',
        ],
        `$.record_review.${key}.corrections[${index}].target_id`,
      ),
    ),
  );

  array(record.fact_findings?.findings).forEach((item, index) => {
    each(item.source_claim_ids, 'claim', `$.fact_findings.findings[${index}].source_claim_ids`);
    each(
      item.source_evidence_ids,
      'evidence',
      `$.fact_findings.findings[${index}].source_evidence_ids`,
    );
  });
  array(record.fact_findings?.unresolved_uncertainties).forEach((item, index) =>
    each(
      item.linked_object_ids,
      [
        'agreement_term',
        'deliverable',
        'timeline_event',
        'claim',
        'evidence',
        'damages_claim',
        'outcome',
      ],
      `$.fact_findings.unresolved_uncertainties[${index}].linked_object_ids`,
    ),
  );

  ['person_a', 'person_b'].forEach((key) => {
    each(
      record.steelman_positions?.[key]?.key_claim_ids,
      'claim',
      `$.steelman_positions.${key}.key_claim_ids`,
    );
    each(
      record.steelman_positions?.[key]?.key_evidence_ids,
      'evidence',
      `$.steelman_positions.${key}.key_evidence_ids`,
    );
  });

  each(
    record.deliberation_input?.material_fact_ids,
    'fact_finding',
    '$.deliberation_input.material_fact_ids',
  );
  each(
    record.deliberation_input?.material_dispute_ids,
    ['agreement_term', 'deliverable', 'timeline_event', 'claim', 'damages_claim'],
    '$.deliberation_input.material_dispute_ids',
  );
  each(
    record.deliberation_input?.relevant_evidence_ids,
    'evidence',
    '$.deliberation_input.relevant_evidence_ids',
  );
  each(
    record.deliberation_input?.uncertainty_ids,
    'uncertainty',
    '$.deliberation_input.uncertainty_ids',
  );
  each(
    record.deliberation_input?.public_outcome_ids,
    'outcome',
    '$.deliberation_input.public_outcome_ids',
  );

  if (record.recommendation) {
    each(
      record.recommendation.evidence_relied_on_ids,
      'evidence',
      '$.recommendation.evidence_relied_on_ids',
    );
    array(record.recommendation.evidence_not_relied_on).forEach((item, index) =>
      expect(
        item.evidence_id,
        'evidence',
        `$.recommendation.evidence_not_relied_on[${index}].evidence_id`,
      ),
    );
  }
}

function validateFinancialEnvelope(record: JsonObject, issues: ValidationIssue[]): void {
  const byParty = new Map<string, any[]>();
  array(record.desired_outcomes).forEach((entry) =>
    byParty.set(entry.party_id, array(entry.outcomes)),
  );

  const maxRequested = (requestingParty: string, from: string, to: string) => {
    let max = 0;
    let outcomeId: string | null = null;
    for (const outcome of byParty.get(requestingParty) ?? []) {
      for (const transfer of array(outcome.transfers)) {
        if (transfer.from_party_id === from && transfer.to_party_id === to) {
          const amount = Number(transfer.amount ?? 0);
          if (amount > max) {
            max = amount;
            outcomeId = outcome.outcome_id;
          }
        }
      }
    }
    return { max, outcomeId };
  };

  const a = maxRequested('party_a', 'party_b', 'party_a');
  const b = maxRequested('party_b', 'party_a', 'party_b');
  const envelope = record.case?.financial_envelope ?? {};

  if (envelope.person_a_requests_from_person_b_max !== a.max) {
    addIssue(
      issues,
      '$.case.financial_envelope.person_a_requests_from_person_b_max',
      `Expected ${a.max} derived from Person A outcomes.`,
    );
  }
  if (envelope.person_b_requests_from_person_a_max !== b.max) {
    addIssue(
      issues,
      '$.case.financial_envelope.person_b_requests_from_person_a_max',
      `Expected ${b.max} derived from Person B outcomes.`,
    );
  }
  if (envelope.gross_disputed_value !== a.max + b.max) {
    addIssue(
      issues,
      '$.case.financial_envelope.gross_disputed_value',
      `Expected ${a.max + b.max}, the sum of maximum opposed-direction requests.`,
    );
  }
  const requiredIds = [a.outcomeId, b.outcomeId].filter(Boolean) as string[];
  const actualIds = new Set(array(envelope.derived_from_outcome_ids));
  requiredIds.forEach((id) => {
    if (!actualIds.has(id)) {
      addIssue(
        issues,
        '$.case.financial_envelope.derived_from_outcome_ids',
        `Missing outcome '${id}' that determines the financial envelope.`,
      );
    }
  });
}

function validateEvidenceRules(record: JsonObject, issues: ValidationIssue[]): void {
  const evidenceById = new Map<string, any>();
  array(record.evidence).forEach((item) => evidenceById.set(item.evidence_id, item));

  array(record.evidence).forEach((item, index) => {
    const path = `$.evidence[${index}]`;
    if (item.availability_status === 'inspected') {
      if (!item.file_reference || !item.file_hash || !item.inspected_at) {
        addIssue(
          issues,
          path,
          'Inspected evidence requires file_reference, file_hash, and inspected_at.',
        );
      }
    } else if (item.file_hash || item.inspected_at) {
      addIssue(
        issues,
        path,
        `Evidence with availability_status '${item.availability_status}' cannot carry inspection metadata.`,
      );
    }
    if (item.availability_status === 'unavailable' && item.file_reference) {
      addIssue(
        issues,
        `${path}.file_reference`,
        'Unavailable evidence cannot have a file reference.',
      );
    }
  });

  array(record.evidence_evidence_links).forEach((link, index) => {
    if (link.comparison_status !== 'completed') return;
    const from = evidenceById.get(link.from_evidence_id);
    const to = evidenceById.get(link.to_evidence_id);
    if (from?.availability_status !== 'inspected' || to?.availability_status !== 'inspected') {
      addIssue(
        issues,
        `$.evidence_evidence_links[${index}].comparison_status`,
        'A completed evidence comparison requires both evidence items to be inspected.',
      );
    }
  });

  const uninspectedCriticalLinks = array(record.claim_evidence_links).filter((link) => {
    if (!link.decision_critical) return false;
    return evidenceById.get(link.evidence_id)?.availability_status !== 'inspected';
  });

  if (record.deliberation_input?.eligible_for_deliberation && uninspectedCriticalLinks.length > 0) {
    addIssue(
      issues,
      '$.deliberation_input.eligible_for_deliberation',
      'Deliberation cannot be eligible while decision-critical evidence is uninspected.',
    );
  }

  array(record.fact_findings?.findings).forEach((finding, index) => {
    if (!finding.decision_critical) return;
    array(finding.source_evidence_ids).forEach((evidenceId, evidenceIndex) => {
      if (evidenceById.get(evidenceId)?.availability_status !== 'inspected') {
        addIssue(
          issues,
          `$.fact_findings.findings[${index}].source_evidence_ids[${evidenceIndex}]`,
          'Decision-critical findings may cite only inspected evidence.',
        );
      }
    });
  });

  const reliedOn = record.recommendation?.evidence_relied_on_ids ?? [];
  array(reliedOn).forEach((evidenceId, index) => {
    const evidence = evidenceById.get(evidenceId);
    if (evidence?.availability_status !== 'inspected') {
      addIssue(
        issues,
        `$.recommendation.evidence_relied_on_ids[${index}]`,
        'A recommendation may rely only on inspected evidence.',
      );
    }
    if (evidence?.visibility !== 'shared_with_both_parties') {
      addIssue(
        issues,
        `$.recommendation.evidence_relied_on_ids[${index}]`,
        'A recommendation may not rely on party-private or withheld evidence.',
      );
    }
  });

  array(record.deliberation_input?.relevant_evidence_ids).forEach((evidenceId, index) => {
    const evidence = evidenceById.get(evidenceId);
    if (evidence?.visibility !== 'shared_with_both_parties') {
      addIssue(
        issues,
        `$.deliberation_input.relevant_evidence_ids[${index}]`,
        'Deliberation input may not contain party-private or withheld evidence.',
      );
    }
  });
}

function validateLockAndRecommendation(record: JsonObject, issues: ValidationIssue[]): void {
  const review = record.record_review ?? {};
  if (review.record_locked_at) {
    const statuses = ['confirmed', 'expired', 'exhausted'];
    for (const key of ['person_a', 'person_b']) {
      const partyReview = review[key] ?? {};
      if (!partyReview.confirmed && !statuses.includes(partyReview.correction_opportunity_status)) {
        addIssue(
          issues,
          `$.record_review.${key}`,
          'A locked record requires party confirmation or an expired/exhausted neutral correction opportunity.',
        );
      }
    }
    const pendingRequired = array(record.clarification_questions).some(
      (question) => question.priority === 'required' && question.status === 'pending',
    );
    if (pendingRequired) {
      addIssue(
        issues,
        '$.record_review.record_locked_at',
        'The record cannot lock while required clarification questions remain pending.',
      );
    }
  }

  if (!record.deliberation_input?.eligible_for_deliberation && record.recommendation !== null) {
    addIssue(
      issues,
      '$.recommendation',
      'A recommendation cannot exist while deliberation is ineligible.',
    );
  }

  if (record.deliberation_input?.private_party_information_present !== false) {
    addIssue(
      issues,
      '$.deliberation_input.private_party_information_present',
      'No decision-relevant party-private information may enter deliberation input.',
    );
  }
}

export function validateCustomInvariants(record: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isObject(record)) {
    return [{ path: '$', message: 'Case record must be a JSON object.' }];
  }

  deepFindForbiddenKeys(record, issues);

  if (record.schema_version !== record.audit?.schema_version) {
    addIssue(
      issues,
      '$.audit.schema_version',
      `Audit schema_version '${record.audit?.schema_version}' must equal root '${record.schema_version}'.`,
    );
  }
  if (record.record_review?.record_version !== record.record_version) {
    addIssue(
      issues,
      '$.record_review.record_version',
      'record_review.record_version must equal the root record_version.',
    );
  }

  const { ids, families } = collectIds(record, issues);
  validateReferences(record, issues, ids, families);
  validateFinancialEnvelope(record, issues);
  validateEvidenceRules(record, issues);
  validateLockAndRecommendation(record, issues);

  return issues;
}
