type JsonObject = Record<string, any>;

const DIRECT_DELAY_CAUSATION =
  /\b(?:caus(?:e|es|ed|ing)|contribut(?:e|es|ed|ing)|result(?:s|ed|ing))\b[^.]{0,96}\b(?:schedule\s+)?delay\b|\b(?:schedule\s+)?delay\b[^.]{0,96}\b(?:caus(?:e|es|ed|ing)|result(?:s|ed|ing)\s+from|came\s+from)\b/iu;
const NON_ASSERTED_CAUSATION =
  /\b(?:could|might|possibly|possible|perhaps|hypothetical(?:ly)?|speculat(?:e|es|ed|ing|ive)|unclear|uncertain|unknown|unresolved|ambiguous|unsure|whether|infer(?:s|red|ring)?|wonder(?:s|ed|ing)?)\b|\b(?:not|isn['’]t|wasn['’]t)\s+(?:clear|known|established|resolved)\b/iu;
const REPORTED_BELIEF =
  /\b(?:report(?:s|ed|ing)?|describ(?:e|es|ed|ing))\b[^.]{0,96}\b(?:belief|opinion|view)\b/iu;
const METADATA_ONLY = /\b(?:metadata|file\s*name|filename|label|index|keyword)\b/iu;
const CALENDAR_MAY_EVENT_NOUNS = new Set([
  'batch',
  'change',
  'changes',
  'content',
  'copy',
  'deadline',
  'deliverable',
  'deliverables',
  'delivery',
  'image',
  'images',
  'launch',
  'milestone',
  'request',
  'requests',
  'shipment',
  'work',
]);

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactSourceSpan(span: unknown, narrative: string): span is JsonObject {
  if (!isJsonObject(span)) return false;
  if (
    typeof span.quote !== 'string' ||
    span.quote.length === 0 ||
    !Number.isInteger(span.start_char) ||
    !Number.isInteger(span.end_char)
  ) {
    return false;
  }
  return (
    span.start_char >= 0 &&
    span.end_char >= span.start_char &&
    span.end_char <= narrative.length &&
    span.end_char - span.start_char === span.quote.length &&
    narrative.slice(span.start_char, span.end_char) === span.quote
  );
}

function hasModalMay(value: string): boolean {
  const tokens = value.match(/[\p{L}\p{N}]+/gu) ?? [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.toLocaleLowerCase() !== 'may') continue;
    const previous = tokens[index - 1]?.toLocaleLowerCase();
    const next = tokens[index + 1]?.toLocaleLowerCase();
    const followsCalendarDate =
      typeof next === 'string' &&
      (/^\d{4}$/u.test(next) || /^(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?$/u.test(next));
    const followsCalendarPreposition =
      previous != null &&
      ['after', 'around', 'before', 'by', 'during', 'in', 'since', 'through', 'until'].includes(
        previous,
      );
    if (
      followsCalendarDate ||
      followsCalendarPreposition ||
      (next != null && CALENDAR_MAY_EVENT_NOUNS.has(next))
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function deniesCausalRelation(value: string): boolean {
  const directNegation =
    /\b(?:did|does|do|is|are|was|were|has|have|had)\s+not\s+(?:directly\s+)?(?:caus(?:e|es|ed|ing)|contribut(?:e|es|ed|ing)|result(?:s|ed|ing))\b|\bnever\s+(?:directly\s+)?(?:caus(?:e|es|ed|ing)|contribut(?:e|es|ed|ing)|result(?:s|ed|ing))\b/iu;
  const passiveNegation =
    /\b(?:schedule\s+)?delay\b[^.]{0,48}\b(?:is|are|was|were)\s+not\s+(?:caus(?:e|ed)|attribut(?:e|ed))\b/iu;
  const reportedCausalClauseDenial =
    /\b(?:den(?:y|ies|ied|ying)|disput(?:e|es|ed|ing))\s+(?:the\s+(?:claim|view)\s+)?(?:that|whether)\b[^,.;]{0,96}\b(?:caus|contribut|result|delay)\w*/iu;
  const reportedDirectObjectDenial =
    /\b(?:den(?:y|ies|ied|ying)|disput(?:e|es|ed|ing))\s+(?:the\s+)?(?:(?:missing|late|delayed)\s+)?(?:content|delivery|shipment|files?)\s+(?:caus|contribut|result)\w*/iu;
  return (
    directNegation.test(value) ||
    passiveNegation.test(value) ||
    reportedCausalClauseDenial.test(value) ||
    reportedDirectObjectDenial.test(value)
  );
}

function isDirectClientDelayInterpretation(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  return (
    DIRECT_DELAY_CAUSATION.test(value) &&
    !NON_ASSERTED_CAUSATION.test(value) &&
    !hasModalMay(value) &&
    !deniesCausalRelation(value) &&
    !REPORTED_BELIEF.test(value) &&
    !METADATA_ONLY.test(value)
  );
}

function preservesSourceQualifications(eventSummary: string, spans: JsonObject[]): boolean {
  const sourceText = spans.map((span) => span.quote).join(' ');
  if (
    /\bI\s+(?:think|believe|suspect|estimate)\b/iu.test(sourceText) &&
    !/\b(?:think|believ|suspect|estimat)\w*\b/iu.test(eventSummary)
  ) {
    return false;
  }
  if (
    /\b(?:around|about|approximately)\b/iu.test(sourceText) &&
    !/\b(?:around|about|approximately|approximate)\b/iu.test(eventSummary)
  ) {
    return false;
  }
  return true;
}

function spanContains(claimSpan: unknown, eventSpan: JsonObject): boolean {
  return (
    isJsonObject(claimSpan) &&
    claimSpan.submission_id === eventSpan.submission_id &&
    Number.isInteger(claimSpan.start_char) &&
    Number.isInteger(claimSpan.end_char) &&
    claimSpan.start_char <= eventSpan.start_char &&
    claimSpan.end_char >= eventSpan.end_char
  );
}

function normalizeAssertedMeaning(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const ASSERTION_TOKEN_ALIASES: Record<string, string> = {
  batches: 'batch',
  changed: 'change',
  changing: 'change',
  changes: 'change',
  contents: 'content',
  copies: 'copy',
  deadline: 'schedule',
  deadlines: 'schedule',
  delivered: 'deliver',
  delivering: 'deliver',
  delivery: 'deliver',
  depended: 'depend',
  depending: 'depend',
  images: 'image',
  materials: 'material',
  requests: 'request',
  revised: 'revision',
  revising: 'revision',
  revisions: 'revision',
  sent: 'supply',
  send: 'supply',
  shipment: 'deliver',
  shipments: 'deliver',
  supplied: 'supply',
  supplies: 'supply',
  supplying: 'supply',
  timeline: 'schedule',
};

function assertedMeaningTokens(value: unknown): string[] {
  const normalized = normalizeAssertedMeaning(value);
  if (normalized == null || normalized.length === 0) return [];
  return normalized.split(' ').map((token) => ASSERTION_TOKEN_ALIASES[token] ?? token);
}

type CanonicalAssertedMeaning = {
  asserters: string[];
  actors: string[];
  incidents: string[];
  occurrencePolarity: string[];
  completionState: string[];
  objects: string[];
  effects: string[];
  temporal: string[];
  temporalRelations: string[];
  causalPolarity: string;
  qualifications: string[];
};

const MONTH_TOKENS = new Set([
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]);

type CanonicalRelationships = {
  asserters: string[];
  actors: string[];
};

const NAMED_ENTITY = String.raw`\p{Lu}[\p{L}\p{N}&.'’_-]*(?:\s+\p{Lu}[\p{L}\p{N}&.'’_-]*){0,2}`;
const REPORTING_VERBS = String.raw`says|asserts|thinks|treats|reports|attributes|considers|presents|acknowledges|disputes`;
const INCIDENT_VERBS = String.raw`deliver(?:s|ed|ing)?|send(?:s|ing)?|sent|suppl(?:y|ies|ied|ying)|request(?:s|ed|ing)?|revis(?:e|es|ed|ing)|chang(?:e|es|ed|ing)|caus(?:e|es|ed|ing)|contribut(?:e|es|ed|ing)`;
const INCIDENT_NOUNS = String.raw`delivery|shipment|content|copy|images?|materials?|files?|requests?|revisions?|changes?|scope`;

function normalizedEntity(value: string): string | null {
  return normalizeAssertedMeaning(value.replace(/['’]s$/iu, ''));
}

function addRelationshipMatches(target: Set<string>, value: string, pattern: RegExp): void {
  for (const match of value.matchAll(pattern)) {
    const normalized = normalizedEntity(match[1] ?? '');
    if (normalized != null && normalized.length > 1) target.add(normalized);
  }
}

function containsCanonicalEntity(value: string, entity: string): boolean {
  return ` ${value} `.includes(` ${entity} `);
}

function assertedRelationships(
  values: unknown[],
  expected: CanonicalRelationships = { asserters: [], actors: [] },
): CanonicalRelationships {
  // Typed party relationships gate recovery before this fallback runs. Text is
  // consulted only to compare named asserters and action subjects between an
  // already-typed event and an existing claim; capitalization alone is not an
  // entity signal.
  const asserters = new Set<string>();
  const actors = new Set<string>();
  const normalizedValues = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => ({
      raw: value,
      normalized: normalizeAssertedMeaning(value) ?? '',
    }));

  for (const expectedAsserter of expected.asserters) {
    if (
      normalizedValues.some(({ normalized }) =>
        containsCanonicalEntity(normalized, expectedAsserter),
      )
    ) {
      asserters.add(expectedAsserter);
    }
  }
  for (const expectedActor of expected.actors) {
    if (
      normalizedValues.some(({ normalized }) => containsCanonicalEntity(normalized, expectedActor))
    ) {
      actors.add(expectedActor);
    }
  }

  for (const { raw } of normalizedValues) {
    addRelationshipMatches(
      asserters,
      raw,
      new RegExp(String.raw`\b(${NAMED_ENTITY})\s+(?:${REPORTING_VERBS})\b`, 'gu'),
    );
    addRelationshipMatches(
      asserters,
      raw,
      new RegExp(String.raw`\baccording\s+to\s+(${NAMED_ENTITY})\b`, 'giu'),
    );
    addRelationshipMatches(
      asserters,
      raw,
      new RegExp(String.raw`\bbased\s+on\s+(${NAMED_ENTITY})['’]s\s+account\b`, 'giu'),
    );
    addRelationshipMatches(
      actors,
      raw,
      new RegExp(
        String.raw`\b(${NAMED_ENTITY})(?:['’]s)?\s+(?:(?:did\s+not|never|partially)\s+)?(?:${INCIDENT_VERBS})\b`,
        'gu',
      ),
    );
    addRelationshipMatches(
      actors,
      raw,
      new RegExp(
        String.raw`\b(${NAMED_ENTITY})['’]s\s+(?:(?:late|missing|partial|delayed)\s+)?(?:${INCIDENT_NOUNS})\b`,
        'gu',
      ),
    );
  }

  return {
    asserters: [...asserters].sort(),
    actors: [...actors].sort(),
  };
}

function canonicalAssertedMeaning(
  values: unknown[],
  effectFamily: 'client_delay',
  expectedRelationships: CanonicalRelationships = { asserters: [], actors: [] },
): CanonicalAssertedMeaning {
  const tokens = values.flatMap(assertedMeaningTokens);
  const tokenSet = new Set(tokens);
  const text = values.filter((value): value is string => typeof value === 'string').join(' ');
  const hasAny = (...candidates: string[]): boolean =>
    candidates.some((candidate) => tokenSet.has(candidate));
  const incidents = new Set<string>();
  const occurrencePolarity = new Set<string>();
  const completionState = new Set<string>();
  const objects = new Set<string>();
  const effects = new Set<string>([effectFamily]);
  const temporal = new Set<string>();
  const temporalRelations = new Set<string>();
  const qualifications = new Set<string>();

  const hasContentObject = hasAny(
    'batch',
    'content',
    'copy',
    'everything',
    'image',
    'material',
    'text',
  );
  const hasDeliveryObject = hasAny('deliver', 'supply');
  const hasScheduleMarker = hasAny('schedule');
  const neverDelivered =
    /\bnever\s+(?:deliver(?:ed)?|sen[dt]|suppl(?:y|ied)|arriv(?:e|ed))\b/iu.test(text);
  const notDeliveredByDeadline =
    /\b(?:did\s+not|didn['’]t|failed\s+to)\s+(?:deliver|send|supply)[^.]{0,64}\bby\b/iu.test(text);
  const partiallyDelivered =
    /\b(?:partially|partly|only\s+(?:part|some))\s+(?:deliver(?:ed)?|sen[dt]|suppl(?:y|ied))\b|\b(?:deliver(?:ed)?|sen[dt]|suppl(?:y|ied))\s+(?:partially|partly|only\s+(?:part|some))\b/iu.test(
      text,
    );
  const deliveryUnclear =
    /\b(?:unclear|uncertain|unknown|unresolved|ambiguous)\b[^.]{0,64}\b(?:deliver|send|supply|arrival)\w*/iu.test(
      text,
    );
  const deliveryDeniedOrDisputed =
    /\b(?:den(?:y|ies|ied|ying)|disput(?:e|es|ed|ing))\s+that\b[^.]{0,64}\b(?:deliver|send|supply|arriv)\w*/iu.test(
      text,
    );
  const deliveredLate =
    /\b(?:late|overdue)\s+(?:deliver|shipment|content|copy|image|material|batch)\w*|\b(?:deliver|send|supply|arriv)\w*\b[^.]{0,48}\b(?:late|overdue)\b|\b(?:deliver|send|supply|arriv)\w*\b[^.]{0,48}\bafter\s+(?:the\s+)?deadline\b/iu.test(
      text,
    );
  const deliveryMeaningPresent = hasContentObject || hasDeliveryObject;

  if (deliveryMeaningPresent) {
    // Incident occurrence polarity and completion state are intentionally
    // independent of causal polarity. A missing delivery can directly cause
    // delay without becoming a late-but-completed delivery.
    incidents.add('input_delivery');
    objects.add(hasContentObject ? 'content' : 'delivery');
    if (deliveryDeniedOrDisputed) {
      occurrencePolarity.add('delivery_denied_or_disputed');
      completionState.add('denied_or_disputed');
    } else if (deliveryUnclear) {
      occurrencePolarity.add('delivery_status_unclear');
      completionState.add('unclear');
    } else if (neverDelivered) {
      occurrencePolarity.add('never_delivered');
      completionState.add('never_completed');
    } else if (notDeliveredByDeadline) {
      occurrencePolarity.add('not_delivered_by_deadline');
      completionState.add('not_completed_by_deadline');
    } else if (partiallyDelivered) {
      occurrencePolarity.add('partially_delivered');
      completionState.add('partial');
    } else if (deliveredLate || hasAny('late', 'later', 'overdue')) {
      occurrencePolarity.add('delivered_late');
      completionState.add('completed_late');
    }
  }
  const hasScopeChange = hasAny('scope') && hasAny('add', 'added', 'change', 'request');
  if (hasScopeChange) {
    incidents.add('scope_change');
    objects.add('scope');
  }
  if (hasAny('revision', 'rework', 'repeat', 'repeated') || (hasAny('change') && !hasScopeChange)) {
    incidents.add('revision_change');
    if (hasContentObject) objects.add('content');
  }
  if (hasAny('code')) objects.add('code');

  if (hasAny('launch')) effects.add('launch');
  if (hasAny('balance', 'payment', 'price')) effects.add('payment');
  if (hasAny('campaign')) effects.add('campaign');
  if (hasAny('publication', 'published')) effects.add('publication');

  for (const token of tokens) {
    if (MONTH_TOKENS.has(token) || /^\d{1,4}$/u.test(token)) temporal.add(token);
  }
  for (const relation of ['by', 'after', 'in'] as const) {
    const pattern = new RegExp(
      String.raw`\b${relation}\s+(?:the\s+)?(${[...MONTH_TOKENS].join('|')}|\d{1,4})\b`,
      'giu',
    );
    for (const match of text.matchAll(pattern)) {
      temporalRelations.add(`${relation}:${match[1]?.toLocaleLowerCase()}`);
    }
  }
  if (neverDelivered) temporalRelations.add('never');
  if (hasAny('around', 'approximately', 'approximate', 'about')) {
    qualifications.add('approximate');
  }
  if (hasAny('alleged', 'allegedly', 'alleges')) qualifications.add('alleged');
  if (hasAny('believe', 'believes', 'believed', 'think', 'thinks', 'thought')) {
    qualifications.add('subjective');
  }
  if (hasAny('part', 'partly', 'partial', 'partially', 'somewhat')) {
    qualifications.add('partial');
  }
  if (hasAny('all', 'entire', 'entirely', 'sole', 'solely', 'whole')) {
    qualifications.add('total');
  }

  const sorted = (valuesToSort: Set<string>): string[] => [...valuesToSort].sort();
  const relationships = assertedRelationships(values, expectedRelationships);
  const causalPolarity = deniesCausalRelation(text)
    ? 'denied'
    : NON_ASSERTED_CAUSATION.test(text) || hasModalMay(text)
      ? 'uncertain_or_hypothetical'
      : 'asserted';
  return {
    asserters: relationships.asserters,
    actors: relationships.actors,
    incidents: sorted(incidents),
    occurrencePolarity: sorted(occurrencePolarity),
    completionState: sorted(completionState),
    objects: sorted(objects),
    effects: sorted(effects),
    temporal: sorted(temporal),
    temporalRelations: sorted(temporalRelations),
    causalPolarity,
    qualifications: sorted(qualifications),
  };
}

function claimHasEquivalentAssertedMeaning(claim: JsonObject, event: JsonObject): boolean {
  const candidateMeaning = canonicalAssertedMeaning(
    [event.event_summary, event.person_a_interpretation],
    'client_delay',
  );
  const claimMeaning = canonicalAssertedMeaning([claim.claim_text], 'client_delay', {
    asserters: candidateMeaning.asserters,
    actors: candidateMeaning.actors,
  });
  // Equivalence is bidirectional equality of the canonical causal representation.
  // Empty incident ontologies are never treated as proven matches.
  return (
    candidateMeaning.incidents.length > 0 &&
    JSON.stringify(candidateMeaning) === JSON.stringify(claimMeaning)
  );
}

function existingClaimCoversEvent(
  claim: JsonObject,
  event: JsonObject,
  spans: JsonObject[],
): boolean {
  // Existing-claim equivalence is independent of provider duplication and evidence:
  // typed relationships must match, canonical causal meaning must be equal in both
  // directions, and exact source spans must ground this specific source occurrence.
  if (
    claim.party_id !== 'party_a' ||
    claim.claim_type !== 'client_delay' ||
    claim.response_status !== 'unanswered' ||
    claim.materiality !== event.materiality ||
    claim.against_asserting_party_interest !== false ||
    !claimHasEquivalentAssertedMeaning(claim, event)
  ) {
    return false;
  }
  const claimSpans = Array.isArray(claim.source_spans) ? claim.source_spans : [];
  return spans.every((span) =>
    claimSpans.some((claimSpan: unknown) => spanContains(claimSpan, span)),
  );
}

function eventEvidenceIds(event: JsonObject): string[] {
  return [
    ...new Set(
      (Array.isArray(event.source_evidence_ids) ? event.source_evidence_ids : []).filter(
        (value: unknown): value is string => typeof value === 'string',
      ),
    ),
  ].sort();
}

function canonicalProviderRowValue(value: unknown, propertyName: string | null = null): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalProviderRowValue(item));
    return propertyName === 'source_evidence_ids'
      ? [...items].sort((left, right) => String(left).localeCompare(String(right)))
      : items;
  }
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalProviderRowValue(value[key], key)]),
  );
}

function exactProviderDuplicateKey(event: JsonObject): string {
  return JSON.stringify(canonicalProviderRowValue(event));
}

function consolidateExactDuplicateTimelineRows(timeline: unknown[]): unknown[] {
  // A reused canonical ID is not occurrence identity. We remove a later row only
  // when its complete provider structure is equal to the first row, normalizing
  // solely the order of source-evidence references. Different evidence
  // membership, dates, meanings, or source coordinates remain in the output so
  // canonical duplicate-ID validation continues to fail honestly.
  const retained: unknown[] = [];
  const exactRowsById = new Map<string, Set<string>>();
  for (const row of timeline) {
    if (!isJsonObject(row) || typeof row.event_id !== 'string') {
      retained.push(row);
      continue;
    }
    const exactKey = exactProviderDuplicateKey(row);
    const priorRows = exactRowsById.get(row.event_id);
    if (priorRows?.has(exactKey)) continue;
    if (priorRows == null) exactRowsById.set(row.event_id, new Set([exactKey]));
    else priorRows.add(exactKey);
    retained.push(row);
  }
  return retained;
}

function collectCanonicalIds(modelOutput: JsonObject): Set<string> {
  // Mirrors every canonical object-ID family registered by validate-person-a.ts.
  const ids = new Set<string>(['party_a', 'sub_a_extracted']);
  const register = (value: unknown): void => {
    if (typeof value === 'string') ids.add(value);
  };
  const each = (value: unknown, visit: (item: JsonObject) => void): void => {
    if (!Array.isArray(value)) return;
    value.forEach((item) => {
      if (isJsonObject(item)) visit(item);
    });
  };

  each(modelOutput.third_parties, (item) => register(item.third_party_id));
  each(modelOutput.agreement?.terms, (item) => register(item.term_id));
  each(modelOutput.deliverable_assessments, (item) => register(item.deliverable_id));
  each(modelOutput.timeline, (item) => register(item.event_id));
  each(modelOutput.claims, (item) => register(item.claim_id));
  each(modelOutput.evidence, (item) => {
    register(item.evidence_id);
    each(item.extracts, (extract) => register(extract.extract_id));
  });
  each(modelOutput.claim_evidence_links, (item) => register(item.link_id));
  each(modelOutput.damages_claims, (item) => register(item.damages_claim_id));
  each(modelOutput.desired_outcomes?.outcomes, (item) => register(item.outcome_id));
  each(modelOutput.extraction_issues, (item) => register(item.issue_id));
  each(modelOutput.clarification_questions, (item) => register(item.question_id));
  return ids;
}

function uniqueClaimId(eventId: string, ids: Set<string>): string {
  const stem = `claim_${eventId.replace(/[^a-zA-Z0-9_-]/gu, '_')}_client_delay`;
  if (!ids.has(stem)) return stem;
  let suffix = 2;
  while (ids.has(`${stem}_${suffix}`)) suffix += 1;
  return `${stem}_${suffix}`;
}

/**
 * Recover only a claim whose complete meaning is already present in typed model output.
 *
 * This is deliberately not a narrative parser. It requires a high-materiality Person A
 * assertion about Person B, a supported-unanswered occurrence, an explicit direct
 * schedule-delay interpretation, exact source slices, and no existing claim that already
 * covers those slices. The emitted claim copies the model's qualified event summary,
 * evidence references, materiality, and spans without importing golden data or inferring
 * objective occurrence.
 */
export function recoverGroundedClientDelayClaims(
  modelOutput: JsonObject,
  narrative: string,
): JsonObject {
  const normalized = structuredClone(modelOutput);
  const timeline = Array.isArray(normalized.timeline)
    ? consolidateExactDuplicateTimelineRows(normalized.timeline)
    : [];
  normalized.timeline = timeline;
  const claims: JsonObject[] = Array.isArray(normalized.claims) ? normalized.claims : [];
  const providerClaims = [...claims];
  const canonicalIds = collectCanonicalIds(normalized);
  normalized.claims = claims;

  for (const event of timeline) {
    if (!isJsonObject(event)) continue;
    if (
      typeof event.event_id !== 'string' ||
      typeof event.event_summary !== 'string' ||
      event.event_summary.length === 0 ||
      event.actor_party_id !== 'party_b' ||
      event.actor_third_party_id !== null ||
      !Array.isArray(event.asserted_by_party_ids) ||
      event.asserted_by_party_ids.length !== 1 ||
      event.asserted_by_party_ids[0] !== 'party_a' ||
      event.occurrence_status !== 'supported_unanswered' ||
      event.interpretation_status !== 'unclear' ||
      event.person_b_interpretation !== null ||
      event.materiality !== 'high' ||
      !isDirectClientDelayInterpretation(event.person_a_interpretation)
    ) {
      continue;
    }

    const spans = Array.isArray(event.source_spans) ? event.source_spans : [];
    if (
      spans.length === 0 ||
      !spans.every((span: unknown) => exactSourceSpan(span, narrative)) ||
      !preservesSourceQualifications(event.event_summary, spans)
    ) {
      continue;
    }
    const evidenceIds = eventEvidenceIds(event);
    if (providerClaims.some((claim) => existingClaimCoversEvent(claim, event, spans))) {
      continue;
    }

    const claimId = uniqueClaimId(event.event_id, canonicalIds);
    canonicalIds.add(claimId);
    const recoveredClaim = {
      claim_id: claimId,
      party_id: 'party_a',
      claim_text: event.event_summary,
      claim_type: 'client_delay',
      response_status: 'unanswered',
      materiality: event.materiality,
      support_level: evidenceIds.length > 0 ? 'not_assessed' : 'none',
      supporting_evidence_ids: evidenceIds,
      contradicting_evidence_ids: [],
      counterclaim_ids: [],
      requires_clarification:
        event.date?.start == null || event.date?.end == null || event.date?.precision === 'unknown',
      against_asserting_party_interest: false,
      source_spans: structuredClone(spans),
    };
    claims.push(recoveredClaim);
  }

  return normalized;
}
