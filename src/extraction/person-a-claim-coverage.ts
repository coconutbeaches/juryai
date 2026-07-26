type JsonObject = Record<string, any>;

const DIRECT_DELAY_CAUSATION =
  /\b(?:caus(?:e|es|ed|ing)|contribut(?:e|es|ed|ing)|result(?:s|ed|ing))\b[^.]{0,96}\b(?:schedule\s+)?delay\b|\b(?:schedule\s+)?delay\b[^.]{0,96}\b(?:caus(?:e|es|ed|ing)|result(?:s|ed|ing)\s+from|came\s+from)\b/iu;
const NON_ASSERTED_CAUSATION =
  /\b(?:could|might|possibly|possible|perhaps|hypothetical(?:ly)?|speculat(?:e|es|ed|ing|ive)|unclear|uncertain|unknown|unresolved|ambiguous|unsure|whether|infer(?:s|red|ring)?|wonder(?:s|ed|ing)?)\b|\b(?:not|isn['’]t|wasn['’]t)\s+(?:clear|known|established|resolved)\b/iu;
const DENIED_CAUSATION =
  /\b(?:den(?:y|ies|ied|ying)|disput(?:e|es|ed|ing)|did\s+not|does\s+not|do\s+not|was\s+not|were\s+not|never)\b[^.]{0,96}\b(?:caus|contribut|result|delay)\w*/iu;
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
    const next = tokens[index + 1]?.toLocaleLowerCase();
    const followsCalendarDate =
      typeof next === 'string' &&
      (/^\d{4}$/u.test(next) || /^(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?$/u.test(next));
    if (followsCalendarDate || (next != null && CALENDAR_MAY_EVENT_NOUNS.has(next))) {
      continue;
    }
    return true;
  }
  return false;
}

function isDirectClientDelayInterpretation(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  return (
    DIRECT_DELAY_CAUSATION.test(value) &&
    !NON_ASSERTED_CAUSATION.test(value) &&
    !hasModalMay(value) &&
    !DENIED_CAUSATION.test(value) &&
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
  actors: string[];
  incidents: string[];
  objects: string[];
  effects: string[];
  temporal: string[];
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

function assertedActorTokens(values: unknown[], expectedActors: string[] = []): string[] {
  const actors = new Set<string>();
  const normalizedTokens = new Set(values.flatMap(assertedMeaningTokens));
  for (const actor of expectedActors) {
    if (normalizedTokens.has(actor)) actors.add(actor);
  }
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const token of value.match(/\b\p{Lu}[\p{L}'’-]*\b/gu) ?? []) {
      const normalized = normalizeAssertedMeaning(token.replace(/['’]s$/iu, ''));
      if (
        normalized != null &&
        normalized.length > 1 &&
        !MONTH_TOKENS.has(normalized) &&
        !['delay', 'during', 'juryai', 'late', 'schedule', 'the'].includes(normalized)
      ) {
        actors.add(normalized);
      }
    }
  }
  return [...actors].sort();
}

function canonicalAssertedMeaning(
  values: unknown[],
  effectFamily: 'client_delay',
  expectedActors: string[] = [],
): CanonicalAssertedMeaning {
  const tokens = values.flatMap(assertedMeaningTokens);
  const tokenSet = new Set(tokens);
  const hasAny = (...candidates: string[]): boolean =>
    candidates.some((candidate) => tokenSet.has(candidate));
  const incidents = new Set<string>();
  const objects = new Set<string>();
  const effects = new Set<string>([effectFamily]);
  const temporal = new Set<string>();
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
  const hasExplicitLateMarker =
    hasAny('late', 'later', 'overdue') ||
    (hasAny('after') && hasScheduleMarker) ||
    (hasAny('not', 'never') &&
      hasDeliveryObject &&
      (hasScheduleMarker || tokens.some((token) => MONTH_TOKENS.has(token))));

  if ((hasContentObject || hasDeliveryObject) && hasExplicitLateMarker) {
    incidents.add('late_input');
    objects.add(hasContentObject ? 'content' : 'delivery');
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
  return {
    actors: assertedActorTokens(values, expectedActors),
    incidents: sorted(incidents),
    objects: sorted(objects),
    effects: sorted(effects),
    temporal: sorted(temporal),
    qualifications: sorted(qualifications),
  };
}

function claimHasEquivalentAssertedMeaning(claim: JsonObject, event: JsonObject): boolean {
  const candidateMeaning = canonicalAssertedMeaning(
    [event.event_summary, event.person_a_interpretation],
    'client_delay',
  );
  const claimMeaning = canonicalAssertedMeaning(
    [claim.claim_text],
    'client_delay',
    candidateMeaning.actors,
  );
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

function assertedEventMeaningKey(event: JsonObject): string {
  return JSON.stringify({
    event_summary: normalizeAssertedMeaning(event.event_summary),
    actor_party_id: event.actor_party_id,
    actor_third_party_id: event.actor_third_party_id,
    asserted_by_party_ids: [...event.asserted_by_party_ids].sort(),
    occurrence_status: event.occurrence_status,
    interpretation_status: event.interpretation_status,
    person_a_interpretation: normalizeAssertedMeaning(event.person_a_interpretation),
    person_b_interpretation: normalizeAssertedMeaning(event.person_b_interpretation),
    materiality: event.materiality,
  });
}

function occurrenceKey(event: JsonObject): string {
  return JSON.stringify({
    date: {
      start: event.date?.start,
      end: event.date?.end,
      precision: event.date?.precision,
      approximate: event.date?.approximate,
    },
  });
}

function sourceWordingKey(spans: JsonObject[]): string {
  const sourceWordings = spans
    .map((span) => ({
      submission_id: span.submission_id,
      quote: span.quote,
    }))
    .sort(
      (left, right) =>
        String(left.submission_id).localeCompare(String(right.submission_id)) ||
        String(left.quote).localeCompare(String(right.quote)),
    );
  return JSON.stringify(sourceWordings);
}

type RepresentedProviderEvent = {
  event: JsonObject;
  spans: JsonObject[];
  recoveredClaim: JsonObject | null;
};

function isProvenProviderDuplicate(
  represented: RepresentedProviderEvent,
  event: JsonObject,
  spans: JsonObject[],
): boolean {
  // Evidence and coordinates never prove duplication. Evidence may be unioned only
  // when the provider reused the same object identity and its complete normalized
  // assertion, typed occurrence, and exact source wording are unchanged.
  return (
    represented.event.event_id === event.event_id &&
    assertedEventMeaningKey(represented.event) === assertedEventMeaningKey(event) &&
    occurrenceKey(represented.event) === occurrenceKey(event) &&
    sourceWordingKey(represented.spans) === sourceWordingKey(spans)
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

function mergeRecoveredEvidence(claim: JsonObject, evidenceIds: string[]): void {
  const current = Array.isArray(claim.supporting_evidence_ids)
    ? claim.supporting_evidence_ids.filter(
        (value: unknown): value is string => typeof value === 'string',
      )
    : [];
  const merged = [...new Set([...current, ...evidenceIds])].sort();
  claim.supporting_evidence_ids = merged;
  claim.support_level = merged.length > 0 ? 'not_assessed' : 'none';
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
  const timeline = Array.isArray(normalized.timeline) ? normalized.timeline : [];
  const claims: JsonObject[] = Array.isArray(normalized.claims) ? normalized.claims : [];
  const providerClaims = [...claims];
  const canonicalIds = collectCanonicalIds(normalized);
  const representedEvents: RepresentedProviderEvent[] = [];
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
    const providerDuplicate = representedEvents.find((represented) =>
      isProvenProviderDuplicate(represented, event, spans),
    );
    if (providerDuplicate != null) {
      if (providerDuplicate.recoveredClaim != null) {
        mergeRecoveredEvidence(providerDuplicate.recoveredClaim, evidenceIds);
      }
      continue;
    }
    if (providerClaims.some((claim) => existingClaimCoversEvent(claim, event, spans))) {
      representedEvents.push({ event, spans, recoveredClaim: null });
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
    representedEvents.push({ event, spans, recoveredClaim });
    claims.push(recoveredClaim);
  }

  return normalized;
}
