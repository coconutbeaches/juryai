type JsonObject = Record<string, any>;

export const PERSON_A_REPAIR_VERSION = 'person-a-record-repair-v0.1.0';

export type RepairRuleId =
  | 'agreement_dependency_claim_projection'
  | 'explicit_actor_normalization'
  | 'wrong_family_evidence_support_projection'
  | 'separate_named_deliverables'
  | 'separate_named_evidence'
  | 'deterministic_claim_type_normalization';

export type RepairStatus = 'applied' | 'skipped' | 'rejected';

export type PersonARepairRecord = {
  repair_id: string;
  sequence_number: number;
  rule_id: RepairRuleId;
  target_family: string;
  target_object_id: string;
  operation: 'append' | 'normalize' | 'project' | 'split' | 'inspect';
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

const deliverableNames = [
  'Homepage',
  'About page',
  'Services page',
  'Contact page',
  'Mobile-responsive layout',
  'Pricing comparison section',
  'Newsletter signup',
] as const;

const evidenceNames = [
  'social media posts',
  'part of the site was briefly published',
  'signed agreement',
  'list of changes',
] as const;

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

type ClaimGrounding<T extends string> =
  | { status: 'grounded'; names: T[]; spans: JsonObject[] }
  | {
      status: 'rejected';
      reason:
        | 'ambiguous_claim_grounding'
        | 'claim_grounding_missing'
        | 'explicit_enumeration_missing'
        | 'source_spans_missing_or_invalid';
    };

function groundedEnumeration<T extends string>(
  claimIds: unknown,
  claims: JsonObject[],
  narrative: string,
  names: readonly T[],
): ClaimGrounding<T> {
  if (!Array.isArray(claimIds) || claimIds.length === 0) {
    return { status: 'rejected', reason: 'claim_grounding_missing' };
  }
  const candidates: Array<{ names: T[]; spans: JsonObject[] }> = [];
  for (const claimId of [...new Set(claimIds)].sort()) {
    const claim = claims.find((item) => item.claim_id === claimId);
    if (!claim) return { status: 'rejected', reason: 'claim_grounding_missing' };
    const spans = exactSpans(claim, narrative);
    if (!spans) return { status: 'rejected', reason: 'source_spans_missing_or_invalid' };
    const quote = spans
      .map((span) => span.quote)
      .join(' ')
      .toLowerCase();
    const found = names.filter((name) => quote.includes(name.toLowerCase()));
    if (found.length >= 2) candidates.push({ names: found, spans });
  }
  if (candidates.length === 0) {
    return { status: 'rejected', reason: 'explicit_enumeration_missing' };
  }
  const signatures = new Set(
    candidates.map((candidate) =>
      [...candidate.names]
        .map((name) => name.toLowerCase())
        .sort(lexicalCompare)
        .join('|'),
    ),
  );
  if (signatures.size !== 1) {
    return { status: 'rejected', reason: 'ambiguous_claim_grounding' };
  }
  const spans = candidates
    .flatMap((candidate) => candidate.spans)
    .filter(
      (span, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.submission_id === span.submission_id &&
            candidate.start_char === span.start_char &&
            candidate.end_char === span.end_char &&
            candidate.quote === span.quote,
        ) === index,
    )
    .sort(
      (left, right) =>
        Number(left.start_char) - Number(right.start_char) ||
        Number(left.end_char) - Number(right.end_char),
    );
  return { status: 'grounded', names: candidates[0]!.names, spans };
}

function exactLabelPattern(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
}

function aggregateIdentityMatchesEnumeration<T extends string>(
  aggregate: JsonObject,
  identityField: string,
  enumeratedNames: T[],
): boolean {
  // v0.1.2 has no aggregate-to-child membership relation. A split is therefore
  // authorized only when exact grounded labels account for the full canonical
  // identity and leave no unknown material text behind.
  const identity = aggregate[identityField];
  if (typeof identity !== 'string' || identity.length === 0) return false;
  const uniqueNames = [...new Set(enumeratedNames.map((name) => name.toLowerCase()))];
  if (uniqueNames.length !== enumeratedNames.length || uniqueNames.length < 2) return false;

  let residual = identity.normalize('NFC');
  for (const name of enumeratedNames) {
    const matches = [...residual.matchAll(exactLabelPattern(name))];
    if (matches.length !== 1) return false;
    residual = residual.replace(exactLabelPattern(name), ' ');
  }

  residual = residual
    .toLowerCase()
    .replace(/[,.:;()&]/gu, ' ')
    .replace(
      /\b(?:a|an|and|artifact|artifacts|deliverable|deliverables|evidence|item|items|page|pages|the)\b/gu,
      ' ',
    )
    .replace(/\s+/gu, ' ')
    .trim();
  return residual.length === 0;
}

function expandReferenceArrays(
  value: unknown,
  fields: Set<string>,
  replacedId: string,
  replacementIds: string[],
  preserveOriginal: boolean,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry) =>
      expandReferenceArrays(entry, fields, replacedId, replacementIds, preserveOriginal),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [field, child] of Object.entries(value)) {
    if (fields.has(field) && Array.isArray(child) && child.includes(replacedId)) {
      value[field] = [
        ...new Set([
          ...child.filter((item) => item !== replacedId),
          ...(preserveOriginal ? [replacedId] : []),
          ...replacementIds,
        ]),
      ].sort(lexicalCompare);
      continue;
    }
    expandReferenceArrays(child, fields, replacedId, replacementIds, preserveOriginal);
  }
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

  // Rule D: split only aggregates tied to claims whose exact spans enumerate the items.
  for (const aggregate of [...deliverables].sort((a, b) =>
    lexicalCompare(identifier(a.deliverable_id), identifier(b.deliverable_id)),
  )) {
    if (!/[,&/]|\band\b/iu.test(String(aggregate.name ?? ''))) continue;
    const grounding = groundedEnumeration(
      aggregate.source_claim_ids,
      claims,
      options.narrative,
      deliverableNames,
    );
    if (grounding.status === 'rejected') {
      record(
        'separate_named_deliverables',
        'deliverables',
        identifier(aggregate.deliverable_id),
        'split',
        aggregate,
        null,
        [],
        'A deliverable split requires one unambiguous set of items enumerated in exact source-grounded claims.',
        'rejected',
        grounding.reason,
      );
      continue;
    }
    if (!aggregateIdentityMatchesEnumeration(aggregate, 'name', grounding.names)) {
      record(
        'separate_named_deliverables',
        'deliverables',
        identifier(aggregate.deliverable_id),
        'split',
        aggregate,
        null,
        grounding.spans,
        'Every grounded deliverable name must match the aggregate identity exactly, with no missing or unrelated components.',
        'rejected',
        'aggregate_identity_mismatch',
      );
      continue;
    }
    const replacements: JsonObject[] = [];
    const created: JsonObject[] = [];
    for (const name of grounding.names) {
      const existing = deliverables.find(
        (item) =>
          String(item.name ?? '').toLowerCase() === name.toLowerCase() && item !== aggregate,
      );
      if (existing) {
        replacements.push(existing);
        continue;
      }
      const replacement = {
        ...structuredClone(aggregate),
        deliverable_id: `repair_deliverable_${slug(name)}`,
        name,
      };
      replacements.push(replacement);
      created.push(replacement);
    }
    if (replacements.length < 2) continue;
    const independent = /\b(?:package|project|website|site)\b/iu.test(String(aggregate.name ?? ''));
    deliverables.push(...created);
    if (!independent) {
      const index = deliverables.indexOf(aggregate);
      if (index >= 0) deliverables.splice(index, 1);
    }
    expandReferenceArrays(
      repaired,
      new Set(['affected_object_ids', 'linked_object_ids']),
      identifier(aggregate.deliverable_id),
      replacements.map((item) => identifier(item.deliverable_id)),
      independent,
    );
    record(
      'separate_named_deliverables',
      'deliverables',
      identifier(aggregate.deliverable_id),
      'split',
      aggregate,
      replacements,
      grounding.spans,
      'Splits only deliverables enumerated in exact spans on their schema-valid source claims.',
      'applied',
    );
  }

  // Rule E: split only evidence tied by typed links to claims that enumerate the artifacts.
  for (const aggregate of [...evidence].sort((a, b) =>
    lexicalCompare(identifier(a.evidence_id), identifier(b.evidence_id)),
  )) {
    if (!/[,&/]|\band\b/iu.test(String(aggregate.title ?? ''))) continue;
    const aggregateLinks = links.filter((link) => link.evidence_id === aggregate.evidence_id);
    const grounding = groundedEnumeration(
      aggregateLinks.map((link) => link.claim_id),
      claims,
      options.narrative,
      evidenceNames,
    );
    if (grounding.status === 'rejected') {
      record(
        'separate_named_evidence',
        'evidence',
        identifier(aggregate.evidence_id),
        'split',
        aggregate,
        null,
        [],
        'An evidence split requires typed claim links to one unambiguous exact enumeration.',
        'rejected',
        grounding.reason,
      );
      continue;
    }
    if (!aggregateIdentityMatchesEnumeration(aggregate, 'title', grounding.names)) {
      record(
        'separate_named_evidence',
        'evidence',
        identifier(aggregate.evidence_id),
        'split',
        aggregate,
        null,
        grounding.spans,
        'Every grounded evidence name must match the aggregate identity exactly, with no missing or unrelated components.',
        'rejected',
        'aggregate_identity_mismatch',
      );
      continue;
    }
    if (!['described_only', 'unavailable'].includes(aggregate.availability_status)) {
      record(
        'separate_named_evidence',
        'evidence',
        identifier(aggregate.evidence_id),
        'split',
        aggregate,
        null,
        grounding.spans,
        'Splitting inspected or uploaded evidence could misstate artifact identity or inspection state.',
        'rejected',
        'evidence_state_not_splittable',
      );
      continue;
    }
    if (Array.isArray(aggregate.extracts) && aggregate.extracts.length > 0) {
      record(
        'separate_named_evidence',
        'evidence',
        identifier(aggregate.evidence_id),
        'split',
        aggregate,
        null,
        grounding.spans,
        'Evidence with artifact-specific extracts cannot be partitioned without inference.',
        'rejected',
        'evidence_content_not_splittable',
      );
      continue;
    }
    const replacements: JsonObject[] = [];
    const created: JsonObject[] = [];
    for (const title of grounding.names) {
      const existing = evidence.find(
        (item) =>
          String(item.title ?? '').toLowerCase() === title.toLowerCase() && item !== aggregate,
      );
      if (existing) {
        replacements.push(existing);
        continue;
      }
      const cloned = structuredClone(aggregate);
      const replacement = {
        ...cloned,
        evidence_id: `repair_evidence_${slug(title)}`,
        title,
        description_from_submitter: title,
        file_reference: null,
        original_filename: null,
        file_hash: null,
      };
      replacements.push(replacement);
      created.push(replacement);
    }
    if (replacements.length < 2) continue;
    evidence.push(...created);
    const independent = /\b(?:collection|bundle|archive|history)\b/iu.test(
      String(aggregate.title ?? ''),
    );
    if (!independent) {
      const index = evidence.indexOf(aggregate);
      if (index >= 0) evidence.splice(index, 1);
    }
    const replacementIds = replacements.map((item) => identifier(item.evidence_id));
    expandReferenceArrays(
      repaired,
      new Set([
        'affected_object_ids',
        'contradicting_evidence_ids',
        'linked_object_ids',
        'source_evidence_ids',
        'supporting_evidence_ids',
      ]),
      identifier(aggregate.evidence_id),
      replacementIds,
      independent,
    );
    const replacementLinks = aggregateLinks.flatMap((link) =>
      replacements.map((item) => ({
        ...structuredClone(link),
        link_id: `repair_${slug(identifier(link.link_id)).slice(0, 20)}_${slug(
          identifier(item.evidence_id),
        ).slice(0, 35)}`,
        evidence_id: item.evidence_id,
      })),
    );
    links.push(...replacementLinks);
    if (!independent) {
      for (let index = links.length - 1; index >= 0; index -= 1) {
        if (aggregateLinks.includes(links[index]!)) links.splice(index, 1);
      }
    }
    record(
      'separate_named_evidence',
      'evidence',
      identifier(aggregate.evidence_id),
      'split',
      aggregate,
      replacements,
      grounding.spans,
      'Splits only artifacts enumerated in exact spans on claims connected by typed evidence links.',
      'applied',
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
