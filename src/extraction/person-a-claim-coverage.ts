type JsonObject = Record<string, any>;

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

function preserveAttachedRelativeCausalParentheticals(value: string): string {
  let depth = 0;
  for (const character of value) {
    if (character === '(') {
      depth += 1;
      if (depth > 1) return value;
    } else if (character === ')') {
      depth -= 1;
      if (depth < 0) return value;
    }
  }
  if (depth !== 0) return value;

  const attachedRelative =
    /([^.;()\r\n—–]+?)\s*\(\s*((?:which\s+(?:caus\w*|contribut\w*)|resulting\s+in|thereby\s+causing)\b[^()]*)\)/giu;
  return value.replace(attachedRelative, (full, antecedent: string, relative: string) => {
    const coordinatedNewSubject =
      /\b(?:and|but|while|whereas)\s+(?:an?|the)\s+[\p{L}\p{N}'’_-]+(?:\s+[\p{L}\p{N}'’_-]+){0,5}\s*$/iu;
    return coordinatedNewSubject.test(antecedent) ? full : `${antecedent}, ${relative}`;
  });
}

function causalUnits(value: string): string[] {
  const coordinatedSubjectBoundary =
    /(?:,\s*)?\b(?:and|but|while|whereas)\b\s+(?!(?:directly|also|separately|then|together)\s+(?:caus|contribut|result)\w*\b)(?=(?:an?|the|[\p{L}\p{N}'’_-]+)(?:\s+[\p{L}\p{N}'’_-]+){0,5}\s+(?:caus|contribut|result)\w*\b)/giu;
  return preserveAttachedRelativeCausalParentheticals(value)
    .replace(coordinatedSubjectBoundary, '\n')
    .split(/[.;()\r\n]|[—–]/u)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0);
}

function localForwardCause(prefix: string): string {
  const relativeClause = prefix.match(/^(.*?),\s*(?:which|thereby)\s*$/iu);
  if (relativeClause?.[1] != null) return relativeClause[1].trim();

  const participial = prefix.match(/^(.*?),\s*$/u);
  if (participial?.[1] != null) return participial[1].trim();

  const connectors = /\b(?:although|because|while|whereas)\b/giu;
  let localStart = 0;
  for (const match of prefix.matchAll(connectors)) {
    localStart = (match.index ?? 0) + match[0].length;
  }
  return prefix
    .slice(localStart)
    .replace(/\b(?:and|but)\s*$/iu, '')
    .trim();
}

function assertedCausePhrases(unit: string): string[] {
  const causes: string[] = [];
  const forward =
    /\b(?:caus(?:e|es|ed|ing)|contribut(?:e|es|ed|ing)|result(?:s|ed|ing))\b[^.;()—–\r\n]{0,96}\b(?:schedule\s+)?delay\b/giu;
  for (const match of unit.matchAll(forward)) {
    const cause = localForwardCause(unit.slice(0, match.index));
    if (cause.length > 0) causes.push(cause);
  }

  const reverse =
    /\b(?:schedule\s+)?delay\b[^.;()—–\r\n]{0,48}\b(?:result(?:s|ed|ing)\s+from|came\s+from|was\s+caused\s+by)\s+(.+)$/giu;
  for (const match of unit.matchAll(reverse)) {
    const cause = match[1]?.trim();
    if (cause != null && cause.length > 0) causes.push(cause);
  }
  return causes;
}

function overlaps(values: string[], candidates: string[]): boolean {
  const candidateSet = new Set(candidates);
  return values.some((value) => candidateSet.has(value));
}

function specificIncidentObjects(values: unknown[]): string[] {
  const text = values.filter((value): value is string => typeof value === 'string').join(' ');
  const objects = new Set<string>();
  const patterns: Array<[string, RegExp]> = [
    ['batch', /\bbatch(?:es)?\b/iu],
    ['content', /\b(?:content|copy|material|text)\b/iu],
    ['files', /\bfiles?\b/iu],
    ['images', /\bimages?\b/iu],
  ];
  for (const [object, pattern] of patterns) {
    if (pattern.test(text)) objects.add(object);
  }
  return [...objects].sort();
}

function causeBindsToCandidateIncident(cause: string, event: JsonObject): boolean {
  // A causal predicate is usable only when its local cause phrase names a
  // recognized incident and is compatible with this specific provider event.
  // Broad family, actor, or source overlap cannot override a conflicting
  // occurrence state, object, calendar anchor, deadline relation, or occurrence
  // qualifier. Missing cause detail is tolerated only when no known field
  // conflicts; the causal predicate has already been confined to its local unit.
  const candidate = canonicalAssertedMeaning(
    [event.event_summary, event.date?.start, event.date?.end],
    'client_delay',
  );
  const assertedCause = canonicalAssertedMeaning([cause], 'client_delay');
  if (assertedCause.incidents.length === 0) return false;
  if (
    candidate.incidents.length > 0 &&
    JSON.stringify(candidate.incidents) !== JSON.stringify(assertedCause.incidents)
  ) {
    return false;
  }
  if (
    candidate.actors.length > 0 &&
    assertedCause.actors.length > 0 &&
    !overlaps(candidate.actors, assertedCause.actors)
  ) {
    return false;
  }
  const candidateSpecificObjects = candidate.objects.filter((object) => object !== 'delivery');
  const causeSpecificObjects = assertedCause.objects.filter((object) => object !== 'delivery');
  if (
    candidateSpecificObjects.length > 0 &&
    causeSpecificObjects.length > 0 &&
    !overlaps(candidateSpecificObjects, causeSpecificObjects)
  ) {
    return false;
  }
  const candidateOccurrenceObjects = specificIncidentObjects([event.event_summary]);
  const causeOccurrenceObjects = specificIncidentObjects([cause]);
  if (
    candidateOccurrenceObjects.length > 0 &&
    causeOccurrenceObjects.length > 0 &&
    !overlaps(candidateOccurrenceObjects, causeOccurrenceObjects)
  ) {
    return false;
  }
  if (hasConflictingOccurrenceState(candidate, assertedCause)) return false;
  if (hasConflictingTemporalIdentity(candidate, assertedCause)) return false;
  if (
    candidate.occurrenceQualifiers.length > 0 &&
    assertedCause.occurrenceQualifiers.length > 0 &&
    !overlaps(candidate.occurrenceQualifiers, assertedCause.occurrenceQualifiers)
  ) {
    return false;
  }
  return true;
}

function isDirectClientDelayInterpretation(value: unknown, event: JsonObject): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  return causalUnits(value).some((unit) => {
    if (
      NON_ASSERTED_CAUSATION.test(unit) ||
      hasModalMay(unit) ||
      deniesCausalRelation(unit) ||
      REPORTED_BELIEF.test(unit) ||
      METADATA_ONLY.test(unit)
    ) {
      return false;
    }
    return assertedCausePhrases(unit).some((cause) => causeBindsToCandidateIncident(cause, event));
  });
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
  temporalAnchors: string[];
  temporalRelations: string[];
  occurrenceQualifiers: string[];
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

const MONTH_NUMBERS = new Map(
  [...MONTH_TOKENS].map((month, index) => [month, String(index + 1).padStart(2, '0')]),
);

function temporalAnchorKey(year: string | null, month: string | null, day: string | null): string {
  return `${year ?? '*'}-${month ?? '*'}-${day ?? '*'}`;
}

function temporalAnchors(values: unknown[]): string[] {
  const anchors = new Set<string>();
  const text = values.filter((value): value is string => typeof value === 'string').join(' ');

  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/gu)) {
    anchors.add(temporalAnchorKey(match[1] ?? null, match[2] ?? null, match[3] ?? null));
  }

  const months = [...MONTH_TOKENS].join('|');
  const monthPattern = new RegExp(
    String.raw`\b(${months})(?:\s+(\d{1,4})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?)?\b`,
    'giu',
  );
  for (const match of text.matchAll(monthPattern)) {
    const month = MONTH_NUMBERS.get((match[1] ?? '').toLocaleLowerCase()) ?? null;
    const firstNumber = match[2] ?? null;
    const trailingYear = match[3] ?? null;
    const firstNumeric = firstNumber == null ? null : Number(firstNumber);
    const year = trailingYear ?? (firstNumeric != null && firstNumeric > 31 ? firstNumber : null);
    const day =
      firstNumeric != null && firstNumeric >= 1 && firstNumeric <= 31 ? firstNumber : null;
    anchors.add(
      temporalAnchorKey(year, month, day == null ? null : String(Number(day)).padStart(2, '0')),
    );
  }

  return [...anchors].sort();
}

function temporalAnchorParts(anchor: string): [string, string, string] {
  const [year = '*', month = '*', day = '*'] = anchor.split('-');
  return [year, month, day];
}

function temporalAnchorPairCompatible(left: string, right: string): boolean {
  return temporalAnchorParts(left).every(
    (part, index) =>
      part === '*' ||
      temporalAnchorParts(right)[index] === '*' ||
      part === temporalAnchorParts(right)[index],
  );
}

function hasConflictingOccurrenceState(
  candidate: CanonicalAssertedMeaning,
  assertedCause: CanonicalAssertedMeaning,
): boolean {
  const candidateStates = new Set([...candidate.occurrencePolarity, ...candidate.completionState]);
  const causeStates = new Set([
    ...assertedCause.occurrencePolarity,
    ...assertedCause.completionState,
  ]);
  if (candidateStates.size === 0 || causeStates.size === 0) return false;

  const hasAnyState = (states: Set<string>, names: string[]): boolean =>
    names.some((name) => states.has(name));
  const deliveredStates = [
    'partially_delivered',
    'delivered_late',
    'partial',
    'completed_late',
    'complete',
  ];
  const nonDeliveryStates = [
    'never_delivered',
    'not_delivered_by_deadline',
    'never_completed',
    'not_completed_by_deadline',
  ];
  const unresolvedStates = [
    'delivery_denied_or_disputed',
    'delivery_status_unclear',
    'denied_or_disputed',
    'unclear',
  ];

  if (
    (hasAnyState(candidateStates, nonDeliveryStates) &&
      hasAnyState(causeStates, deliveredStates)) ||
    (hasAnyState(causeStates, nonDeliveryStates) && hasAnyState(candidateStates, deliveredStates))
  ) {
    return true;
  }
  if (
    (candidateStates.has('partial') && causeStates.has('complete')) ||
    (causeStates.has('partial') && candidateStates.has('complete'))
  ) {
    return true;
  }
  return (
    (hasAnyState(candidateStates, unresolvedStates) &&
      hasAnyState(causeStates, [...deliveredStates, ...nonDeliveryStates])) ||
    (hasAnyState(causeStates, unresolvedStates) &&
      hasAnyState(candidateStates, [...deliveredStates, ...nonDeliveryStates]))
  );
}

function hasConflictingTemporalIdentity(
  candidate: CanonicalAssertedMeaning,
  assertedCause: CanonicalAssertedMeaning,
): boolean {
  if (
    candidate.temporalAnchors.length > 0 &&
    assertedCause.temporalAnchors.length > 0 &&
    !candidate.temporalAnchors.some((candidateAnchor) =>
      assertedCause.temporalAnchors.some((causeAnchor) =>
        temporalAnchorPairCompatible(candidateAnchor, causeAnchor),
      ),
    )
  ) {
    return true;
  }

  const candidateRelations = new Set(candidate.temporalRelations);
  const causeRelations = new Set(assertedCause.temporalRelations);
  const candidateDeadline = candidateRelations.has('before_deadline')
    ? 'before'
    : candidateRelations.has('by_deadline')
      ? 'by'
      : candidateRelations.has('after_deadline')
        ? 'after'
        : null;
  const causeDeadline = causeRelations.has('before_deadline')
    ? 'before'
    : causeRelations.has('by_deadline')
      ? 'by'
      : causeRelations.has('after_deadline')
        ? 'after'
        : null;
  if (candidateDeadline != null && causeDeadline != null && candidateDeadline !== causeDeadline) {
    return true;
  }

  const namedRelations = (relations: Set<string>): Map<string, Set<string>> => {
    const byAnchor = new Map<string, Set<string>>();
    for (const relation of relations) {
      const match = /^(by|after|in):(.+)$/u.exec(relation);
      if (match == null) continue;
      const [, kind, anchor] = match;
      const kinds = byAnchor.get(anchor ?? '') ?? new Set<string>();
      kinds.add(kind ?? '');
      byAnchor.set(anchor ?? '', kinds);
    }
    return byAnchor;
  };
  const candidateNamed = namedRelations(candidateRelations);
  const causeNamed = namedRelations(causeRelations);
  for (const [anchor, candidateKinds] of candidateNamed) {
    const causeKinds = causeNamed.get(anchor);
    if (causeKinds != null && ![...candidateKinds].some((kind) => causeKinds.has(kind))) {
      return true;
    }
  }
  return false;
}

type CanonicalRelationships = {
  asserters: string[];
  actors: string[];
};

const NAMED_ENTITY = String.raw`\p{Lu}[\p{L}\p{N}&.'’_-]*(?:\s+\p{Lu}[\p{L}\p{N}&.'’_-]*){0,2}`;
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
  // Typed party relationships are authoritative. When they are present, text
  // cannot add document titles or other free-text asserters. This recovery path
  // requires a typed asserter, so it does not guess one when typing is absent.
  // Known actor names are resolved next; action grammar is used only as a
  // bounded fallback, and capitalization alone is never an entity signal.
  const asserters = new Set<string>();
  const actors = new Set<string>();
  const normalizedValues = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => ({
      raw: value,
      normalized: normalizeAssertedMeaning(value) ?? '',
    }));

  expected.asserters.forEach((asserter) => asserters.add(asserter));
  for (const expectedActor of expected.actors) {
    if (
      normalizedValues.some(({ normalized }) => containsCanonicalEntity(normalized, expectedActor))
    ) {
      actors.add(expectedActor);
    }
  }

  for (const { raw } of normalizedValues) {
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
  const occurrenceQualifiers = new Set<string>();
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
  const neverDelivered =
    /\bnever\s+(?:deliver(?:ed)?|sen[dt]|suppl(?:y|ied)|arriv(?:e|ed))\b/iu.test(text);
  const notDeliveredByDeadline =
    /\b(?:did\s+not|didn['’]t|failed\s+to)\s+(?:deliver|send|supply)[^.]{0,64}\bby\b/iu.test(text);
  const partiallyDelivered =
    /\b(?:partially|partly|only\s+(?:part|some))\s+(?:deliver(?:ed)?|sen[dt]|suppl(?:y|ied))\b|\b(?:deliver(?:ed)?|sen[dt]|suppl(?:y|ied))\s+(?:partially|partly|only\s+(?:part|some)(?:\s+of)?)\b/iu.test(
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
  const deliveryComplete =
    /\b(?:complete|completed|full|fully)\s+(?:deliver|delivery|shipment|content|copy|image|material|batch)\w*|\b(?:deliver|delivery|shipment)\w*\b[^.]{0,32}\b(?:complete|completed|full|fully)\b/iu.test(
      text,
    );
  const deliveryMeaningPresent = hasContentObject || hasDeliveryObject;

  if (deliveryMeaningPresent) {
    // Incident occurrence polarity and completion state are intentionally
    // independent of causal polarity. Mutually compatible delivered states such
    // as partial and late accumulate compositionally; non-delivery, uncertainty,
    // and denial remain distinct from completed delivery states.
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
    } else {
      if (partiallyDelivered) {
        occurrencePolarity.add('partially_delivered');
        completionState.add('partial');
      }
      if (deliveredLate || hasAny('late', 'overdue')) {
        occurrencePolarity.add('delivered_late');
        completionState.add('completed_late');
      }
      if (deliveryComplete && !partiallyDelivered) completionState.add('complete');
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
  for (const qualifier of ['first', 'second', 'third', 'initial', 'original', 'revised', 'final']) {
    if (hasAny(qualifier)) occurrenceQualifiers.add(qualifier);
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
  if (/\bbefore\s+(?:the\s+)?deadline\b/iu.test(text)) {
    temporalRelations.add('before_deadline');
  }
  if (/\bby\s+(?:the\s+)?deadline\b|\bon\s+time\b/iu.test(text)) {
    temporalRelations.add('by_deadline');
  }
  if (/\bafter\s+(?:the\s+)?deadline\b/iu.test(text) || occurrencePolarity.has('delivered_late')) {
    temporalRelations.add('after_deadline');
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
    temporalAnchors: temporalAnchors(values),
    temporalRelations: sorted(temporalRelations),
    occurrenceQualifiers: sorted(occurrenceQualifiers),
    causalPolarity,
    qualifications: sorted(qualifications),
  };
}

function claimHasEquivalentAssertedMeaning(claim: JsonObject, event: JsonObject): boolean {
  const candidateMeaning = canonicalAssertedMeaning(
    [event.event_summary, event.person_a_interpretation],
    'client_delay',
    {
      asserters: Array.isArray(event.asserted_by_party_ids)
        ? event.asserted_by_party_ids.filter(
            (value: unknown): value is string => typeof value === 'string',
          )
        : [],
      actors: [],
    },
  );
  const claimMeaning = canonicalAssertedMeaning([claim.claim_text], 'client_delay', {
    asserters: typeof claim.party_id === 'string' ? [claim.party_id] : [],
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
    if (propertyName === 'source_evidence_ids') {
      return [...items].sort((left, right) => String(left).localeCompare(String(right)));
    }
    if (propertyName === 'source_spans') {
      return [...items].sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
    }
    return items;
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
  // when its complete provider structure is equal to the first row. Evidence IDs
  // and complete source-span identities are order-insensitive for this comparison
  // only; membership and every span field remain significant. The retained row is
  // not reordered. Different evidence, dates, meanings, or grounding remain in
  // the output so canonical duplicate-ID validation continues to fail honestly.
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
      !isDirectClientDelayInterpretation(event.person_a_interpretation, event)
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
