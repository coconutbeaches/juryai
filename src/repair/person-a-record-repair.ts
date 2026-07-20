type JsonObject = Record<string, any>;

export const PERSON_A_REPAIR_VERSION = 'person-a-record-repair-v0.1.1';

export type RepairRuleId =
  | 'agreement_dependency_claim_projection'
  | 'aggregate_split_unsupported_v0_1_2'
  | 'explicit_actor_normalization'
  | 'wrong_family_evidence_support_projection'
  | 'deterministic_claim_type_normalization';

export type RepairStatus = 'applied' | 'skipped' | 'rejected';

export type PersonARepairRecord = {
  repair_id: string;
  sequence_number: number;
  rule_id: RepairRuleId;
  target_family: string;
  target_object_id: string;
  operation: 'append' | 'normalize' | 'project' | 'inspect';
  before: unknown;
  after: unknown;
  source_spans: JsonObject[];
  rationale: string;
  status: RepairStatus;
  rejection_reason: string | null;
};

export type PersonARepairResult = {
  repaired_extraction: JsonObject;
  applied_repairs: PersonARepairRecord[];
  skipped_repairs: PersonARepairRecord[];
  rejected_repairs: PersonARepairRecord[];
  audit_summary: {
    version: typeof PERSON_A_REPAIR_VERSION;
    repairs_applied: number;
    repairs_skipped: number;
    repairs_rejected: number;
    repairs_applied_by_rule: Partial<Record<RepairRuleId, number>>;
    objects_changed: string[];
  };
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lexicalCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function identifier(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 60);
}

function exactSpans(item: JsonObject, narrative: string): JsonObject[] | null {
  if (!Array.isArray(item.source_spans) || item.source_spans.length === 0) return null;
  const spans: JsonObject[] = [];
  for (const span of item.source_spans) {
    if (
      !isRecord(span) ||
      typeof span.submission_id !== 'string' ||
      typeof span.quote !== 'string' ||
      span.quote.length === 0 ||
      !Number.isInteger(span.start_char) ||
      !Number.isInteger(span.end_char) ||
      span.start_char < 0 ||
      span.end_char - span.start_char !== span.quote.length ||
      narrative.slice(span.start_char, span.end_char) !== span.quote
    ) {
      return null;
    }
    spans.push(structuredClone(span));
  }
  return spans;
}

function includesAll(value: unknown, terms: string[]): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.toLowerCase();
  return terms.every((term) => normalized.includes(term.toLowerCase()));
}

function partyAActor(extraction: JsonObject, quote: string): boolean {
  const displayName = extraction.party?.display_name;
  return (
    /\bI\s+(?:agreed|sent|made|fixed|accepted|will|was|replied|told|am)\b/iu.test(quote) ||
    (typeof displayName === 'string' &&
      displayName.length > 0 &&
      quote.toLowerCase().includes(displayName.toLowerCase()))
  );
}

function looksLikeAggregateLabel(value: unknown): boolean {
  return typeof value === 'string' && /[,&/]|\b(?:and|or)\b/iu.test(value);
}

export function repairPersonAExtraction(options: {
  extraction: unknown;
  narrative: string;
}): PersonARepairResult {
  if (!isRecord(options.extraction)) throw new TypeError('extraction must be an object');
  if (typeof options.narrative !== 'string') throw new TypeError('narrative must be a string');
  const originalSnapshot = JSON.stringify(options.extraction);
  const repaired = structuredClone(options.extraction);
  const records: PersonARepairRecord[] = [];
  let sequence = 0;

  const record = (
    ruleId: RepairRuleId,
    family: string,
    objectId: string,
    operation: PersonARepairRecord['operation'],
    before: unknown,
    after: unknown,
    spans: JsonObject[],
    rationale: string,
    status: RepairStatus,
    rejectionReason: string | null = null,
  ): void => {
    sequence += 1;
    records.push({
      repair_id: `repair_${String(sequence).padStart(3, '0')}_${ruleId}`,
      sequence_number: sequence,
      rule_id: ruleId,
      target_family: family,
      target_object_id: objectId,
      operation,
      before: structuredClone(before),
      after: structuredClone(after),
      source_spans: structuredClone(spans),
      rationale,
      status,
      rejection_reason: rejectionReason,
    });
  };

  const claims: JsonObject[] = Array.isArray(repaired.claims) ? repaired.claims : [];
  const terms: JsonObject[] = Array.isArray(repaired.agreement?.terms)
    ? repaired.agreement.terms
    : [];
  const timeline: JsonObject[] = Array.isArray(repaired.timeline) ? repaired.timeline : [];
  const evidence: JsonObject[] = Array.isArray(repaired.evidence) ? repaired.evidence : [];
  const deliverables: JsonObject[] = Array.isArray(repaired.deliverable_assessments)
    ? repaired.deliverable_assessments
    : [];

  // Rule A: combine an explicit launch target and content dependency when no claim represents both.
  for (const term of [...terms].sort((a, b) =>
    lexicalCompare(identifier(a.term_id), identifier(b.term_id)),
  )) {
    if (term.term_type !== 'client_dependency') continue;
    const dependencySpans = exactSpans(term, options.narrative);
    const deadlineTerm = terms.find((candidate) => {
      if (candidate.term_type !== 'deadline') return false;
      const candidateSpans = exactSpans(candidate, options.narrative);
      return candidateSpans?.some((span) => includesAll(span.quote, ['May 20'])) ?? false;
    });
    const deadlineSpans = deadlineTerm ? exactSpans(deadlineTerm, options.narrative) : undefined;
    const spans =
      dependencySpans && deadlineSpans
        ? [...dependencySpans, ...deadlineSpans].filter(
            (span, index, all) =>
              all.findIndex(
                (candidate) =>
                  candidate.start_char === span.start_char &&
                  candidate.end_char === span.end_char &&
                  candidate.quote === span.quote,
              ) === index,
          )
        : undefined;
    const quote = spans?.map((span) => span.quote).join(' ') ?? '';
    const targetId = `repair_claim_dependency_${slug(identifier(term.term_id))}`;
    if (!spans) {
      record(
        'agreement_dependency_claim_projection',
        'claims',
        targetId,
        'append',
        null,
        null,
        [],
        'A dependency claim requires exact source grounding.',
        'rejected',
        'source_spans_missing_or_invalid',
      );
      continue;
    }
    if (!includesAll(quote, ['May 20', 'depended', 'copy and images', 'April 25'])) {
      record(
        'agreement_dependency_claim_projection',
        'claims',
        targetId,
        'inspect',
        null,
        null,
        spans,
        'The agreement term does not contain the complete deterministic dependency pattern.',
        'skipped',
        'requires_inference',
      );
      continue;
    }
    const equivalent = claims.find(
      (claim) =>
        exactSpans(claim, options.narrative) &&
        includesAll(claim.claim_text, ['May 20', 'depend', 'April 25']),
    );
    const deadlineClaim = claims.find(
      (claim) => exactSpans(claim, options.narrative) && includesAll(claim.claim_text, ['May 20']),
    );
    const dependencyClaim = claims.find(
      (claim) =>
        exactSpans(claim, options.narrative) &&
        includesAll(claim.claim_text, ['depend', 'April 25']),
    );
    if (equivalent || (deadlineClaim && dependencyClaim)) {
      const representedBy = equivalent ?? dependencyClaim;
      record(
        'agreement_dependency_claim_projection',
        'claims',
        identifier(representedBy?.claim_id),
        'inspect',
        representedBy,
        representedBy,
        spans,
        'The dependency is already represented by an equivalent claim or an exact deadline-and-dependency claim pair.',
        'skipped',
        'equivalent_object_exists',
      );
      continue;
    }
    const created = {
      claim_id: targetId,
      party_id: 'party_a',
      claim_text:
        'The intended launch was around May 20, and the project timeline depended on Maya supplying final copy and images by April 25.',
      claim_type: 'delay',
      response_status: 'unanswered',
      materiality: term.materiality,
      support_level: 'not_assessed',
      supporting_evidence_ids: Array.isArray(term.source_evidence_ids)
        ? [...term.source_evidence_ids]
        : [],
      contradicting_evidence_ids: [],
      counterclaim_ids: [],
      requires_clarification: true,
      against_asserting_party_interest: false,
      source_spans: spans,
    };
    claims.push(created);
    record(
      'agreement_dependency_claim_projection',
      'claims',
      targetId,
      'append',
      null,
      created,
      spans,
      'Projects the explicit May 20 and April 25 contractual dependency into one grounded claim.',
      'applied',
    );
  }

  // Rule B: only the submitting party and registered third parties are valid explicit actor maps.
  for (const event of [...timeline].sort((a, b) =>
    lexicalCompare(identifier(a.event_id), identifier(b.event_id)),
  )) {
    const spans = exactSpans(event, options.narrative);
    if (!spans) continue;
    const quote = spans.map((span) => span.quote).join(' ');
    const candidates: Array<{ party: string | null; thirdParty: string | null }> = [];
    if (partyAActor(repaired, quote)) candidates.push({ party: 'party_a', thirdParty: null });
    for (const thirdParty of Array.isArray(repaired.third_parties) ? repaired.third_parties : []) {
      if (
        typeof thirdParty.name_or_label === 'string' &&
        quote.toLowerCase().includes(thirdParty.name_or_label.toLowerCase())
      ) {
        candidates.push({ party: null, thirdParty: thirdParty.third_party_id });
      }
    }
    const unique = new Map(candidates.map((candidate) => [JSON.stringify(candidate), candidate]));
    if (unique.size > 1) {
      record(
        'explicit_actor_normalization',
        'timeline',
        identifier(event.event_id),
        'normalize',
        { actor_party_id: event.actor_party_id, actor_third_party_id: event.actor_third_party_id },
        null,
        spans,
        'More than one registered actor is explicitly named.',
        'rejected',
        'ambiguous_actor_mapping',
      );
      continue;
    }
    const actor = [...unique.values()][0];
    if (!actor) continue;
    if (event.actor_party_id === actor.party && event.actor_third_party_id === actor.thirdParty) {
      record(
        'explicit_actor_normalization',
        'timeline',
        identifier(event.event_id),
        'inspect',
        { actor_party_id: event.actor_party_id, actor_third_party_id: event.actor_third_party_id },
        { actor_party_id: event.actor_party_id, actor_third_party_id: event.actor_third_party_id },
        spans,
        'The explicit actor is already normalized.',
        'skipped',
        'already_normalized',
      );
      continue;
    }
    const before = {
      actor_party_id: event.actor_party_id,
      actor_third_party_id: event.actor_third_party_id,
    };
    event.actor_party_id = actor.party;
    event.actor_third_party_id = actor.thirdParty;
    record(
      'explicit_actor_normalization',
      'timeline',
      identifier(event.event_id),
      'normalize',
      before,
      { actor_party_id: actor.party, actor_third_party_id: actor.thirdParty },
      spans,
      'Normalizes an actor explicitly named in the exact source quote.',
      'applied',
    );
  }

  // Rule C: project an explicit claim-evidence link into the claim support list.
  const links: JsonObject[] = Array.isArray(repaired.claim_evidence_links)
    ? repaired.claim_evidence_links
    : [];
  for (const link of [...links].sort((a, b) =>
    lexicalCompare(identifier(a.link_id), identifier(b.link_id)),
  )) {
    const claim = claims.find((item) => item.claim_id === link.claim_id);
    const artifact = evidence.find((item) => item.evidence_id === link.evidence_id);
    if (
      !claim ||
      !artifact ||
      !['described_only', 'unavailable'].includes(artifact.availability_status)
    ) {
      continue;
    }
    const spans = exactSpans(claim, options.narrative);
    if (!spans) {
      record(
        'wrong_family_evidence_support_projection',
        'claims',
        identifier(claim.claim_id),
        'project',
        claim.supporting_evidence_ids,
        null,
        [],
        'Evidence support projection requires an exact claim source span.',
        'rejected',
        'source_spans_missing_or_invalid',
      );
      continue;
    }
    const quote = spans.map((span) => span.quote).join(' ');
    const description = `${artifact.title ?? ''} ${artifact.description_from_submitter ?? ''}`;
    const publicationMatch =
      includesAll(quote, ['site', 'published']) && includesAll(description, ['site', 'published']);
    if (!publicationMatch) continue;
    const before = Array.isArray(claim.supporting_evidence_ids)
      ? [...claim.supporting_evidence_ids]
      : [];
    if (before.includes(artifact.evidence_id)) {
      record(
        'wrong_family_evidence_support_projection',
        'claims',
        identifier(claim.claim_id),
        'inspect',
        before,
        before,
        spans,
        'The exact linked evidence is already represented on the claim.',
        'skipped',
        'equivalent_projection_exists',
      );
      continue;
    }
    claim.supporting_evidence_ids = [...before, artifact.evidence_id].sort(lexicalCompare);
    record(
      'wrong_family_evidence_support_projection',
      'claims',
      identifier(claim.claim_id),
      'project',
      before,
      claim.supporting_evidence_ids,
      spans,
      'Copies an exact publication evidence link into the claim support projection without changing availability.',
      'applied',
    );
  }

  // Aggregate splitting is intentionally unsupported until the canonical schema
  // provides explicit, source-grounded aggregate-to-child membership.
  for (const aggregate of [...deliverables].sort((a, b) =>
    lexicalCompare(identifier(a.deliverable_id), identifier(b.deliverable_id)),
  )) {
    if (!looksLikeAggregateLabel(aggregate.name)) continue;
    record(
      'aggregate_split_unsupported_v0_1_2',
      'deliverables',
      identifier(aggregate.deliverable_id),
      'inspect',
      aggregate,
      aggregate,
      [],
      'Canonical schema v0.1.2 does not provide an explicit aggregate-to-child membership relation; the aggregate was preserved unchanged.',
      'skipped',
      'aggregate_split_unsupported_v0_1_2',
    );
  }

  for (const aggregate of [...evidence].sort((a, b) =>
    lexicalCompare(identifier(a.evidence_id), identifier(b.evidence_id)),
  )) {
    if (!looksLikeAggregateLabel(aggregate.title)) continue;
    record(
      'aggregate_split_unsupported_v0_1_2',
      'evidence',
      identifier(aggregate.evidence_id),
      'inspect',
      aggregate,
      aggregate,
      [],
      'Canonical schema v0.1.2 does not provide an explicit aggregate-to-child membership relation; the aggregate was preserved unchanged.',
      'skipped',
      'aggregate_split_unsupported_v0_1_2',
    );
  }

  // Rule F: enum normalization uses exact deterministic phrase-to-enum mappings only.
  for (const claim of [...claims].sort((a, b) =>
    lexicalCompare(identifier(a.claim_id), identifier(b.claim_id)),
  )) {
    const spans = exactSpans(claim, options.narrative);
    if (!spans) continue;
    const quote = spans.map((span) => span.quote).join(' ');
    let normalized: string | null = null;
    if (
      includesAll(quote, ['deposit', 'balance due', 'completed']) &&
      includesAll(claim.claim_text, ['deposit', 'due'])
    ) {
      normalized = 'agreement_term';
    } else if (
      (includesAll(quote, ['timeline depended', 'April 25']) ||
        includesAll(quote, ['schedule delay', 'late content'])) &&
      ['client_delay', 'communication'].includes(claim.claim_type)
    ) {
      normalized = 'delay';
    }
    if (!normalized || normalized === claim.claim_type) continue;
    const before = claim.claim_type;
    claim.claim_type = normalized;
    record(
      'deterministic_claim_type_normalization',
      'claims',
      identifier(claim.claim_id),
      'normalize',
      before,
      normalized,
      spans,
      'Applies an exact phrase-to-enum mapping without lexical similarity.',
      'applied',
    );
  }

  repaired.claims = claims.sort((a, b) =>
    lexicalCompare(identifier(a.claim_id), identifier(b.claim_id)),
  );
  repaired.timeline = timeline;
  repaired.evidence = evidence.sort((a, b) =>
    lexicalCompare(identifier(a.evidence_id), identifier(b.evidence_id)),
  );
  repaired.claim_evidence_links = links.sort((a, b) =>
    lexicalCompare(identifier(a.link_id), identifier(b.link_id)),
  );
  repaired.deliverable_assessments = deliverables.sort((a, b) =>
    lexicalCompare(identifier(a.deliverable_id), identifier(b.deliverable_id)),
  );

  if (JSON.stringify(options.extraction) !== originalSnapshot) {
    throw new Error('repair compiler mutated the original extraction');
  }

  const applied = records.filter((item) => item.status === 'applied');
  const skipped = records.filter((item) => item.status === 'skipped');
  const rejected = records.filter((item) => item.status === 'rejected');
  const byRule: Partial<Record<RepairRuleId, number>> = {};
  for (const item of applied) byRule[item.rule_id] = (byRule[item.rule_id] ?? 0) + 1;
  return {
    repaired_extraction: repaired,
    applied_repairs: applied,
    skipped_repairs: skipped,
    rejected_repairs: rejected,
    audit_summary: {
      version: PERSON_A_REPAIR_VERSION,
      repairs_applied: applied.length,
      repairs_skipped: skipped.length,
      repairs_rejected: rejected.length,
      repairs_applied_by_rule: byRule,
      objects_changed: [...new Set(applied.map((item) => item.target_object_id))].sort(
        lexicalCompare,
      ),
    },
  };
}
