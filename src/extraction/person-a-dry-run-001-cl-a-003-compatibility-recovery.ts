type JsonObject = Record<string, any>;

const NON_ASSERTED_CAUSATION =
  /\b(?:could|might|possibly|possible|perhaps|hypothetical(?:ly)?|speculat(?:e|es|ed|ing|ive)|unclear|uncertain|unknown|unresolved|ambiguous|unsure|whether|infer(?:s|red|ring)?|wonder(?:s|ed|ing)?)\b|\b(?:not|isn['’]t|wasn['’]t)\s+(?:clear|known|established|resolved)\b/iu;
const REPORTED_BELIEF =
  /\b(?:report(?:s|ed|ing)?|describ(?:e|es|ed|ing))\b[^.]{0,96}\b(?:belief|opinion|view)\b|\b(?:believ(?:e|es|ed|ing)|think(?:s|ing)?|thought|suspect(?:s|ed|ing)?)\b[^.;()—–\r\n]{0,128}\b(?:caus|contribut|result|delay)\w*/iu;
const NOUN_LED_BELIEF_ATTRIBUTION =
  /\b(?:in|from)\s+[^,.;()—–\r\n]{0,48}\b(?:opinion|view|perspective)\b|\b(?:opinion|view|perspective)\s+(?:(?:is|was)\s+)?that\b/iu;
const PROBABILISTIC_CAUSATION =
  /\b(?:probabl(?:e|y)|apparently|allegedly|presumably|reportedly|seemingly|likely|unlikely|potentially)\b/iu;
const METADATA_ONLY = /\b(?:metadata|file\s*name|filename|label|index|keyword)\b/iu;
const CALENDAR_MAY_NOUNS = new Set([
  'changes',
  'content',
  'deadline',
  'deliverable',
  'deliverables',
  'delivery',
  'images',
  'milestone',
  'requests',
  'shipment',
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
    const calendarDate =
      typeof next === 'string' &&
      (/^\d{4}$/u.test(next) || /^(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?$/u.test(next));
    const calendarIntroducer =
      previous != null &&
      [
        'a',
        'after',
        'an',
        'around',
        'before',
        'by',
        'during',
        'each',
        'early',
        'from',
        'in',
        'late',
        'last',
        'mid',
        'next',
        'on',
        'since',
        'the',
        'this',
        'through',
        'until',
      ].includes(previous);
    const clearCalendarNoun = next != null && CALENDAR_MAY_NOUNS.has(next);

    // Calendar syntax must be affirmative: a date, a calendar introducer, or
    // an unambiguously nominal complement such as plural "changes" or
    // "delivery". A base-form verb or unresolved role (including
    // sentence-initial "May have") fails closed as modal uncertainty.
    if (calendarDate || calendarIntroducer || clearCalendarNoun) continue;
    return true;
  }
  return false;
}

function deniesCausalRelation(value: string): boolean {
  const directNegation =
    /\b(?:(?:did|does|do|is|are|was|were|has|have|had|could|would|can)\s+not|(?:didn|doesn|isn|aren|wasn|weren|hasn|haven|hadn|couldn|wouldn|can)['’]t|cannot)\s+(?:have\s+)?(?:directly\s+)?(?:caus(?:e|es|ed|ing)|contribut(?:e|es|ed|ing)|result(?:s|ed|ing))\b|\b(?:never\s+(?:(?:managed|served)\s+to\s+)?|failed\s+to\s+|did\s+nothing\s+to\s+)(?:directly\s+)?(?:caus(?:e|es|ed|ing)|contribut(?:e|es|ed|ing)|result(?:s|ed|ing))\b/iu;
  const resultNegation =
    /\b(?:caus(?:e|es|ed|ing)|contribut(?:e|es|ed|ing)|result(?:s|ed|ing))\b[^,.;]{0,64}\b(?:no|zero)\s+(?:(?:actual|material|measurable|meaningful|schedule)\s+)*delay\b|\bwithout\s+(?:directly\s+)?caus(?:e|es|ed|ing)\s+(?:any\s+)?(?:schedule\s+)?delay\b/iu;
  const passiveNegation =
    /\b(?:schedule\s+)?delay\b[^.]{0,48}\b(?:is|are|was|were)\s+not\s+(?:caus(?:e|ed)|attribut(?:e|ed))\b/iu;
  const reportedCausalClauseDenial =
    /\b(?:den(?:y|ies|ied|ying)|disput(?:e|es|ed|ing))\s+(?:the\s+(?:claim|view)\s+)?(?:that|whether)\b[^,.;]{0,96}\b(?:caus|contribut|result|delay)\w*/iu;
  const reportedDirectObjectDenial =
    /\b(?:den(?:y|ies|ied|ying)|disput(?:e|es|ed|ing))\s+(?:the\s+)?(?:(?:missing|late|delayed)\s+)?(?:content|delivery|shipment|files?)\s+(?:caus|contribut|result)\w*/iu;
  return (
    directNegation.test(value) ||
    resultNegation.test(value) ||
    passiveNegation.test(value) ||
    reportedCausalClauseDenial.test(value) ||
    reportedDirectObjectDenial.test(value)
  );
}

function reportsCausalDenial(value: string): boolean {
  return (
    /\b(?:den(?:y|ies|ied|ying)|disput(?:e|es|ed|ing))\s+(?:the\s+(?:claim|view)\s+)?(?:that|whether)\b[^,.;]{0,96}\b(?:caus|contribut|result|delay)\w*/iu.test(
      value,
    ) ||
    /\b(?:den(?:y|ies|ied|ying)|disput(?:e|es|ed|ing))\s+(?:the\s+)?(?:(?:missing|late|delayed)\s+)?(?:content|delivery|shipment|files?)\s+(?:caus|contribut|result)\w*/iu.test(
      value,
    )
  );
}

const COORDINATOR = /\b(?:and|but|while|whereas)\b/giu;
const PROPER_SUBJECT = String.raw`\p{Lu}[\p{L}\p{N}&.'’_-]*(?:\s+\p{Lu}[\p{L}\p{N}&.'’_-]*){0,2}`;
const POSSESSIVE_SUBJECT_OWNER = String.raw`\p{Lu}[\p{L}\p{N}&._-]*(?:\s+\p{Lu}[\p{L}\p{N}&._-]*){0,2}`;
const CAUSAL_REPORTING_VERB = String.raw`(?:says?|said|states?|stated|claims?|claimed|asserts?|asserted|reports|reported|reporting|tells?|telling|told|writes?|writing|wrote|notes?|noted|noting|maintains?|maintained|maintaining)`;
const CAUSAL_REPORTING_ROLE = String.raw`(?:advisers?|advisors?|agents?|attorneys?|consultants?|counsels?|lawyers?|managers?|representatives?|spokespersons?)`;
const CAUSAL_REPORTING_CLAUSE_BOUNDARY = new RegExp(
  String.raw`,\s+(?:(?:${PROPER_SUBJECT})(?:['’]s)?|(?:her|his|their|our|my|your|its)\s+(?:(?:project|legal)\s+)?${CAUSAL_REPORTING_ROLE}|(?:the|an?|this|that)\s+[\p{L}\p{N}&.'’_-]+)\s+${CAUSAL_REPORTING_VERB}\b`,
  'iu',
);

function normalizedSubjectName(value: string): string | null {
  return normalizeAssertedMeaning(value.replace(/['’]s$/u, ''));
}

function hasForeignCausalReportingSubject(value: string, typedPartyADisplayName: unknown): boolean {
  const typedPartyA =
    typeof typedPartyADisplayName === 'string'
      ? normalizedSubjectName(typedPartyADisplayName)
      : null;
  const isTypedPartyA = (subject: string): boolean => {
    const reportingName = normalizedSubjectName(subject);
    if (typedPartyA == null || reportingName == null) return false;
    if (reportingName === typedPartyA) return true;
    if (!reportingName.endsWith(` ${typedPartyA}`)) return false;

    const prefix = reportingName.slice(0, -(typedPartyA.length + 1));
    return /^(?:(?:in|during|before|after|since|through|until)\s+(?:(?:early|mid|late|last|next)\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)|then|later|subsequently|finally|ultimately)$/iu.test(
      prefix,
    );
  };
  const causalRemainderAfter = (end: number): string => {
    const hardBounded = value.slice(end).split(/[.;()—–\r\n]/u, 1)[0] ?? '';
    const nextReporter = CAUSAL_REPORTING_CLAUSE_BOUNDARY.exec(hardBounded);
    return nextReporter?.index == null ? hardBounded : hardBounded.slice(0, nextReporter.index);
  };
  const remainderAssertsCausation = (end: number): boolean =>
    /\b(?:caus|contribut|result|delay)\w*\b/iu.test(causalRemainderAfter(end));
  const reportingSubject = new RegExp(
    String.raw`\b(${PROPER_SUBJECT})(?:['’]s)?\s+${CAUSAL_REPORTING_VERB}\b`,
    'gu',
  );

  for (const match of value.matchAll(reportingSubject)) {
    if (match.index == null || match[1] == null) continue;
    if (!remainderAssertsCausation(match.index + match[0].length)) continue;
    if (!isTypedPartyA(match[1])) return true;
  }

  const possessiveRoleReportingSubject = new RegExp(
    String.raw`\b${POSSESSIVE_SUBJECT_OWNER}['’]s\s+(?:(?:project|legal)\s+)?${CAUSAL_REPORTING_ROLE}\s+${CAUSAL_REPORTING_VERB}\b`,
    'gu',
  );
  for (const match of value.matchAll(possessiveRoleReportingSubject)) {
    if (match.index == null) continue;
    if (remainderAssertsCausation(match.index + match[0].length)) return true;
  }

  const possessiveDeterminerRoleReportingSubject = new RegExp(
    String.raw`\b(?:her|his|their|our|my|your|its)\s+(?:(?:project|legal)\s+)?${CAUSAL_REPORTING_ROLE}\s+${CAUSAL_REPORTING_VERB}\b`,
    'giu',
  );
  for (const match of value.matchAll(possessiveDeterminerRoleReportingSubject)) {
    if (match.index == null) continue;
    if (remainderAssertsCausation(match.index + match[0].length)) return true;
  }

  const articleLedReportingSubject = new RegExp(
    String.raw`\b((?:the|an?|this|that)\s+[\p{L}\p{N}&.'’_-]+(?:\s+[\p{L}\p{N}&.'’_-]+){0,3})\s+${CAUSAL_REPORTING_VERB}\b`,
    'giu',
  );
  for (const match of value.matchAll(articleLedReportingSubject)) {
    if (match.index == null || match[1] == null) continue;
    if (!remainderAssertsCausation(match.index + match[0].length)) continue;
    if (!isTypedPartyA(match[1])) return true;
  }

  for (const match of value.matchAll(/\baccording\s+to\s+/giu)) {
    if (match.index == null) continue;
    const attributionStart = match.index + match[0].length;
    if (!remainderAssertsCausation(attributionStart)) continue;
    const attribution = causalRemainderAfter(attributionStart);
    const namedSubject = new RegExp(String.raw`^(${PROPER_SUBJECT})(?:['’]s)?\b`, 'u').exec(
      attribution,
    );
    if (namedSubject?.[1] == null || !isTypedPartyA(namedSubject[1])) return true;
  }
  return false;
}

function candidateActorNames(event: JsonObject): string[] {
  return canonicalAssertedMeaning([event.event_summary], 'client_delay').actors;
}

function coordinatedAntecedentBelongsToCandidate(antecedent: string, event: JsonObject): boolean {
  const coordinators = [...antecedent.matchAll(COORDINATOR)];
  const lastCoordinator = coordinators.at(-1);
  if (lastCoordinator?.index == null) return true;

  const tail = antecedent
    .slice(lastCoordinator.index + lastCoordinator[0].length)
    .trim()
    .replace(/^,+\s*/u, '');
  if (/^(?:an?|the)\b/iu.test(tail)) return false;

  const namedSubject = new RegExp(String.raw`^(${PROPER_SUBJECT})(?:['’]s)?\b`, 'u').exec(tail);
  if (namedSubject?.[1] == null) return false;
  const normalizedSubject = normalizedSubjectName(namedSubject[1]);
  return (
    normalizedSubject != null &&
    candidateActorNames(event).some((actor) => actor === normalizedSubject)
  );
}

function preserveAttachedRelativeCausalParentheticals(value: string, event: JsonObject): string {
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
    // A relative causal parenthetical belongs to the immediately preceding
    // incident only. After a coordinator, article-led noun phrases and named
    // or possessive subjects attach only when the named subject is the typed
    // candidate actor; an unresolved antecedent is left detached.
    return coordinatedAntecedentBelongsToCandidate(antecedent, event)
      ? `${antecedent}, ${relative}`
      : full;
  });
}

function introducesDifferentCoordinatedSubject(followingText: string, event: JsonObject): boolean {
  const causalPredicate = /\b(?:caus|contribut|result)\w*\b/iu.exec(followingText);
  if (causalPredicate?.index == null) return false;
  if (
    /\b(?:confirm(?:s|ed|ing)?|establish(?:es|ed|ing)?|conclud(?:e|es|ed|ing)|finds?|found|report(?:s|ed|ing)?|stat(?:e|es|ed|ing))\s+that\s+it\b[^,.;]{0,32}\b(?:caus|contribut|result)\w*\b/iu.test(
      followingText,
    )
  ) {
    // Keep a reporting clause with an explicit "that it" anaphor beside its
    // antecedent. Certainty resets at the reporting predicate below, while
    // cause binding retains the incident that "it" identifies.
    return false;
  }
  const subjectAndModifiers = followingText
    .slice(0, causalPredicate.index)
    .trim()
    .replace(/^,+\s*/u, '');
  if (subjectAndModifiers.length === 0) return false;
  if (/^(?:an?|the)\b/iu.test(subjectAndModifiers)) return true;

  const namedSubject = new RegExp(String.raw`^(${PROPER_SUBJECT})(?:['’]s)?\b`, 'u').exec(
    subjectAndModifiers,
  );
  if (namedSubject?.[1] == null) return false;
  const normalizedSubject = normalizedSubjectName(namedSubject[1]);
  return (
    normalizedSubject == null ||
    !candidateActorNames(event).some((actor) => actor === normalizedSubject)
  );
}

function splitCoordinatedSubjects(value: string, event: JsonObject): string[] {
  const units: string[] = [];
  let unitStart = 0;
  for (const match of value.matchAll(COORDINATOR)) {
    if (match.index == null) continue;
    const afterCoordinator = match.index + match[0].length;
    if (!introducesDifferentCoordinatedSubject(value.slice(afterCoordinator), event)) continue;
    const preceding = value.slice(unitStart, match.index).replace(/,\s*$/u, '').trim();
    if (preceding.length > 0) units.push(preceding);
    unitStart = afterCoordinator;
  }
  const remainder = value.slice(unitStart).trim();
  if (remainder.length > 0) units.push(remainder);
  return units;
}

function preserveInterruptedCausalAttributions(value: string): string {
  const interruptedAttribution =
    /\b(believ(?:e|es|ed|ing)|think(?:s|ing)?|thought|suspect(?:s|ed|ing)?|den(?:y|ies|ied|ying)|disput(?:e|es|ed|ing))\b\s*(?:\([^()]{0,96}\)|[—–][^—–\r\n]{0,96}[—–])\s*((?:that|whether)\b)/giu;

  // Parentheses and paired dashes normally remain hard causal-unit boundaries.
  // For a bounded reporting/belief/denial interruption, remove only the
  // interrupting modifier so the governing predicate stays attached to its
  // "that/whether" causal complement. Independent later sentences still form
  // separate units and may be evaluated on their own.
  return value.replace(interruptedAttribution, '$1 $2');
}

function causalUnits(value: string, event: JsonObject): string[] {
  return preserveAttachedRelativeCausalParentheticals(
    preserveInterruptedCausalAttributions(value),
    event,
  )
    .split(/[.;()\r\n]|[—–]/u)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0)
    .flatMap((unit) => splitCoordinatedSubjects(unit, event))
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0);
}

function localForwardCause(prefix: string): string {
  const relativeClause = prefix.match(/^(.*?),\s*(?:which|thereby)\s*$/iu);
  if (relativeClause?.[1] != null) return relativeClause[1].trim();

  const participial = prefix.match(/^(.*?),\s*$/u);
  if (participial?.[1] != null) return participial[1].trim();

  const contrastiveNewSubject = prefix.match(
    /(?:^|,)\s*but\s+((?:\p{Lu}[\p{L}\p{N}.'’_-]*(?:['’]s)?|[Tt]he)\b.*)$/u,
  );
  if (contrastiveNewSubject?.[1] != null) return contrastiveNewSubject[1].trim();

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

type AssertedCausalRelation = {
  cause: string;
  direction: 'cause_to_delay' | 'delay_from_cause';
  excludedCauses: string[];
  predicateStart: number;
  predicateEnd: number;
  relationEnd: number;
};

function reverseCauseComplement(value: string): {
  positiveCause: string;
  excludedCauses: string[];
} {
  const exclusion =
    /(?:,\s*)?(?:but\s+not|and\s+not|not(?:\s+because\s+of)?|rather\s+than|instead\s+of)\b|[—–]\s*not\b|\(\s*not\b/iu.exec(
      value,
    );
  const contrastiveClause = /,\s*but\s+(?!not\b)/iu.exec(value);
  if (
    contrastiveClause?.index != null &&
    (exclusion?.index == null || contrastiveClause.index < exclusion.index)
  ) {
    return {
      positiveCause: value.slice(0, contrastiveClause.index).trim(),
      excludedCauses: [],
    };
  }
  if (exclusion?.index == null) {
    return { positiveCause: value.trim(), excludedCauses: [] };
  }
  const excludedRemainder = value.slice(exclusion.index + exclusion[0].length).trim();
  const positiveResumption = /,\s*but\s+(?!not\b)/iu.exec(excludedRemainder);
  const excludedCause =
    positiveResumption?.index == null
      ? excludedRemainder
      : excludedRemainder.slice(0, positiveResumption.index).trim();
  return {
    positiveCause: value
      .slice(0, exclusion.index)
      .replace(/[,—–\s]+$/gu, '')
      .trim(),
    excludedCauses: [excludedCause].filter((cause) => cause.length > 0),
  };
}

function assertedCausalRelations(unit: string): AssertedCausalRelation[] {
  const relations: AssertedCausalRelation[] = [];

  // Direction is part of the compatibility contract, independently of
  // polarity. Forward forms admit only predicates whose grammatical subject
  // is the cause and whose delay complement is the effect. In particular,
  // "resulted from" and passive "caused by" never enter this branch, and one
  // predicate cannot consume a later independent predicate's delay object.
  const forwardPredicates = [
    /\bcaus(?:e|es|ed|ing)\b(?!\s+(?:directly\s+)?by\b)(?:(?!\b(?:caus|contribut|result)\w*\b)[^.;()—–\r\n]){0,96}?\b(?:schedule\s+)?delay\b/giu,
    /\bcontribut(?:e|es|ed|ing)\b(?:(?!\b(?:caus|contribut|result)\w*\b)[^.;()—–\r\n]){0,24}?\bto\b(?:(?!\b(?:caus|contribut|result)\w*\b)[^.;()—–\r\n]){0,96}?\b(?:schedule\s+)?delay\b/giu,
    /\bresult(?:s|ed|ing)\s+in\b(?:(?!\b(?:caus|contribut|result)\w*\b)[^.;()—–\r\n]){0,96}?\b(?:schedule\s+)?delay\b/giu,
  ];
  for (const forward of forwardPredicates) {
    for (const match of unit.matchAll(forward)) {
      if (match.index == null) continue;
      const prefix = unit.slice(0, match.index);
      if (
        /^caus/iu.test(match[0]) &&
        /\b(?:is|are|was|were|be|been|being)\s+(?:directly\s+)?$/iu.test(prefix)
      ) {
        continue;
      }
      const cause = localForwardCause(prefix);
      if (cause.length > 0) {
        const predicateSurface = /^\p{L}+(?:\s+(?:directly|in|to))?/iu.exec(match[0])?.[0] ?? '';
        relations.push({
          cause,
          direction: 'cause_to_delay',
          excludedCauses: [],
          predicateStart: match.index,
          predicateEnd: match.index + predicateSurface.length,
          relationEnd: match.index + match[0].length,
        });
      }
    }
  }

  // Reverse surface forms are accepted only when delay is the grammatical
  // effect and the post-predicate complement is therefore the cause. The
  // lexical predicate is captured separately from the effect phrase so its
  // governing auxiliaries remain inside the certainty window.
  const reverse =
    /\b(?:(?:schedule\s+)?delay|(?:confirm(?:s|ed|ing)?|establish(?:es|ed|ing)?|conclud(?:e|es|ed|ing)|finds?|found|report(?:s|ed|ing)?|stat(?:e|es|ed|ing))\s+that\s+it)\b[^.;()—–\r\n]{0,64}?\b(result(?:s|ed|ing)\s+from|came\s+from|caused\s+by)\s+(.+?)(?=,\s*but\b|$)/giu;
  for (const match of unit.matchAll(reverse)) {
    if (match.index == null) continue;
    const predicateSurface = match[1] ?? '';
    const predicateOffset = match[0].indexOf(predicateSurface);
    if (predicateSurface.length === 0 || predicateOffset < 0) continue;
    const complement = reverseCauseComplement(match[2] ?? '');
    if (complement.positiveCause.length > 0) {
      relations.push({
        cause: complement.positiveCause,
        direction: 'delay_from_cause',
        excludedCauses: complement.excludedCauses,
        predicateStart: match.index + predicateOffset,
        predicateEnd: match.index + predicateOffset + predicateSurface.length,
        relationEnd: match.index + match[0].length,
      });
    }
  }
  return relations;
}

function causalRelationIsNegated(unit: string, relation: AssertedCausalRelation): boolean {
  const leftContext = unit.slice(
    Math.max(0, relation.predicateStart - 48),
    relation.predicateStart,
  );
  const localRelation = unit.slice(Math.max(0, relation.predicateStart - 24), relation.relationEnd);

  // Causal-polarity taxonomy is predicate-local:
  // 1. Incident negation is independent: "did not send, which caused delay"
  //    remains positive causation.
  // 2. Contracted/separate auxiliary negation governs only the immediately
  //    following causal predicate.
  // 3. "cannot/could not/would not" is modal impossibility, not uncertainty.
  // 4. "failed/did nothing/never managed to cause" is lexical causal failure.
  // 5. Limited non-zero effects are positive and are handled separately below.
  const causalNegationContext = leftContext.replace(
    /(\b(?:(?:did|does|do|is|are|was|were|has|have|had|could|would|can)\s+not|(?:didn|doesn|isn|aren|wasn|weren|hasn|haven|hadn|couldn|wouldn|can)['’]t|cannot))\s*,\s*(?:(?!\b(?:deliver|ship|send|sent|supply|submit|arriv)\w*\b)[^,.;()—–\r\n]){1,48}\s*,\s*$/iu,
    '$1 ',
  );
  const roleLimitedNegation =
    /\b(?:(?:is|are|was|were|did|does|do)\s+not|(?:isn|aren|wasn|weren|didn|doesn)['’]t)\s+(?:the\s+)?(?:main|only|primary|sole)\s*$/iu.test(
      causalNegationContext,
    );
  if (
    (!roleLimitedNegation &&
      /\b(?:(?:did|does|do|is|are|was|were|has|have|had|could|would|can)\s+not|(?:didn|doesn|isn|aren|wasn|weren|hasn|haven|hadn|couldn|wouldn|can)['’]t|cannot)\s+(?:(?!\b(?:and|but|however|yet|deliver|ship|send|sent|supply|submit|arriv)\w*\b)[^,.;()—–\r\n]){0,64}$/iu.test(
        causalNegationContext,
      )) ||
    /\b(?:never\s+(?:(?:managed|served)\s+to\s+)?|failed\s+to\s+|did\s+nothing\s+to\s+)(?:directly\s+)?$/iu.test(
      leftContext,
    ) ||
    /\bwithout\s+(?:directly\s+)?$/iu.test(leftContext)
  ) {
    return true;
  }

  // Nominal/copular denial is distinct from verbal predicate negation. The
  // noun "cause" is not affirmative when its local copula excludes causal
  // status. Role-limited wording ("not the only/primary cause") is deliberately
  // excluded here because it does not deny all causal contribution.
  if (
    /\b(?:is|are|was|were)\s+(?:not\s+(?:an?|the)|no)\s*$/iu.test(leftContext) ||
    /\b(?:did|does|do)\s+not\s+constitute\s+(?:an?|the)\s*$/iu.test(leftContext)
  ) {
    return true;
  }

  // Result polarity is clause-local. Bare "no/zero [qualified] delay" denies
  // any delay result; "not a major delay", "no more than two days", and
  // "only minor delay" remain limited positive assertions.
  return (
    /\b(?:caus(?:e|es|ed|ing)|contribut(?:e|es|ed|ing)|result(?:s|ed|ing))\b[^,.;]{0,64}\b(?:no|zero)\s+(?:(?:actual|material|measurable|meaningful|schedule)\s+)*delay\b/iu.test(
      localRelation,
    ) ||
    /\b(?:no|zero)\s+(?:(?:actual|material|measurable|meaningful|schedule)\s+)*delay\b[^,.;]{0,48}\b(?:result(?:s|ed|ing)\s+from|came\s+from|was\s+caused\s+by)\b/iu.test(
      localRelation,
    )
  );
}

function causalCertaintyContext(unit: string, relation: AssertedCausalRelation): string {
  const prefix = unit.slice(0, relation.predicateStart);
  const independentAssertionTransition =
    /\bbut\b|\band\b[^,.;]{0,64}\b(?:confirm(?:s|ed|ing)?|establish(?:es|ed|ing)?|conclud(?:e|es|ed|ing)|finds?|found|report(?:s|ed|ing)?|stat(?:e|es|ed|ing))\s+that\b/giu;
  let localStart = 0;
  for (const match of prefix.matchAll(independentAssertionTransition)) {
    localStart = (match.index ?? 0) + match[0].length;
  }
  return prefix.slice(localStart);
}

type CausalCertainty =
  | 'direct_asserted'
  | 'modal_possibility_or_capability'
  | 'conditional'
  | 'predicted_or_expected'
  | 'normative'
  | 'uncertain_or_speculative';

function causalRelationCertainty(unit: string, relation: AssertedCausalRelation): CausalCertainty {
  const context = causalCertaintyContext(unit, relation);
  const predicatePrefix = context.trimEnd();
  const coordinatedModal =
    /\b(can|could|may|might|would|should|must)\b[^,.;()]{0,96}\band(?:\s+(?:ultimately|actually|definitely|in\s+fact))?\s*$/iu
      .exec(predicatePrefix)?.[1]
      ?.toLocaleLowerCase();
  const governingModal =
    coordinatedModal === 'may' && !hasModalMay(context) ? undefined : coordinatedModal;

  // Certainty is classified for each causal predicate, never for the whole
  // interpretation:
  // 1. direct asserted causation is the only promotable category;
  // 2. can/could/may/might describe possibility or capability;
  // 3. would describes conditional causation;
  // 4. expected/likely/predicted/projected/will describe prediction;
  // 5. should/ought/must describe normative or inferred necessity; and
  // 6. predicate-local probability, appearance, or allegation qualifiers are
  //    not direct assertions; and
  // 7. unresolved, hypothetical, or speculative wording remains uncertain.
  //
  // Certainty binds to the stored lexical predicate span. Emphasis does not
  // reset modality: a shared-subject predicate after "and ultimately/actually/
  // definitely/in fact" inherits its governing auxiliary. Only a contrastive
  // clause or new reporting predicate creates an independent certainty context.
  if (
    ['can', 'could', 'may', 'might'].includes(governingModal ?? '') ||
    /\b(?:can|could|might)(?:\s+have)?(?:\s+been)?(?:\s+(?:directly|possibly|potentially))?\s*$/iu.test(
      predicatePrefix,
    ) ||
    hasModalMay(context)
  ) {
    return 'modal_possibility_or_capability';
  }
  if (
    governingModal === 'would' ||
    /\bwould(?:\s+have)?(?:\s+been)?(?:\s+(?:directly|possibly|potentially))?\s*$/iu.test(
      predicatePrefix,
    )
  ) {
    return 'conditional';
  }
  if (
    /\b(?:will(?:\s+have)?|(?:(?:is|are|was|were|be|been|being)\s+)?(?:expected|likely|predicted|projected|anticipated|forecast)(?:\s+to)?(?:\s+have)?(?:\s+been)?)(?:\s+(?:directly|probably|ultimately))?\s*$/iu.test(
      predicatePrefix,
    )
  ) {
    return 'predicted_or_expected';
  }
  if (
    ['should', 'must'].includes(governingModal ?? '') ||
    /\b(?:should|must)(?:\s+have)?(?:\s+directly)?\s*$|\bought\s+to(?:\s+have)?(?:\s+directly)?\s*$/iu.test(
      predicatePrefix,
    )
  ) {
    return 'normative';
  }
  // The context is already bounded to this clause and reset at independently
  // asserted transitions. Within that boundary, an explicit probability,
  // appearance, or allegation qualifier remains governing even when arbitrary
  // grammatical auxiliaries or modifiers intervene before the predicate.
  if (PROBABILISTIC_CAUSATION.test(context)) {
    return 'uncertain_or_speculative';
  }
  if (NON_ASSERTED_CAUSATION.test(context)) {
    return 'uncertain_or_speculative';
  }
  return 'direct_asserted';
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
  const candidateText = canonicalAssertedMeaning([event.event_summary], 'client_delay');
  const typedTemporalAnchors = temporalAnchors([event.date?.start, event.date?.end]);
  // Textual occurrence language and provider-typed dates are independent
  // identity signals. A named-period match cannot sanitize a contradictory
  // typed date, so an internally inconsistent candidate fails closed before
  // it is compared with the asserted cause.
  if (
    candidateText.temporalAnchors.length > 0 &&
    typedTemporalAnchors.length > 0 &&
    temporalAnchorCollectionsConflict(candidateText.temporalAnchors, typedTemporalAnchors)
  ) {
    return false;
  }
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

function isDirectClientDelayInterpretation(
  value: unknown,
  event: JsonObject,
  typedPartyADisplayName: unknown,
): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  return causalUnits(value, event).some((unit) => {
    const relations = assertedCausalRelations(unit);
    if (
      reportsCausalDenial(unit) ||
      REPORTED_BELIEF.test(unit) ||
      NOUN_LED_BELIEF_ATTRIBUTION.test(unit) ||
      hasForeignCausalReportingSubject(unit, typedPartyADisplayName) ||
      METADATA_ONLY.test(unit)
    ) {
      return false;
    }
    // Decision order is fixed: direction was established while extracting the
    // relation; then polarity and certainty are checked for that local
    // predicate. Delay magnitude never changes an uncertain relation into an
    // asserted one.
    return relations.some(
      (relation) =>
        !causalRelationIsNegated(unit, relation) &&
        causalRelationCertainty(unit, relation) === 'direct_asserted' &&
        causeBindsToCandidateIncident(relation.cause, event) &&
        !relation.excludedCauses.some((cause) => causeBindsToCandidateIncident(cause, event)),
    );
  });
}

type TemporalAlternativeKind = 'alternative' | 'conjunction' | 'range';

type TemporalAlternativeGroup = {
  anchors: string[];
  kind: TemporalAlternativeKind;
};

function temporalAlternativeKind(
  between: string | undefined,
  connector: string,
): TemporalAlternativeKind {
  if (between != null || /^[-–—]$/u.test(connector)) return 'range';
  if (connector.toLocaleLowerCase() === 'and') return 'conjunction';
  return 'alternative';
}

function temporalAlternativeGroups(value: string): TemporalAlternativeGroup[] {
  const groups: TemporalAlternativeGroup[] = [];
  const months = [...MONTH_TOKENS].join('|');
  const push = (anchors: string[], kind: TemporalAlternativeKind): void => {
    groups.push({ anchors: [...new Set(anchors)].sort(), kind });
  };

  const monthDays = new RegExp(
    String.raw`\b(?:(between)\s+|either\s+)?(${months})\s+(\d{1,2})(?:st|nd|rd|th)?\s*(or|and|\/|[-–—])\s*(?:(${months})\s+)?(\d{1,2})(?:st|nd|rd|th)?\b`,
    'giu',
  );
  for (const match of value.matchAll(monthDays)) {
    const firstMonth = MONTH_NUMBERS.get((match[2] ?? '').toLocaleLowerCase());
    const secondMonth = MONTH_NUMBERS.get((match[5] ?? match[2] ?? '').toLocaleLowerCase());
    if (firstMonth == null || secondMonth == null) continue;
    push(
      [
        temporalAnchorKey(null, firstMonth, String(Number(match[3])).padStart(2, '0')),
        temporalAnchorKey(null, secondMonth, String(Number(match[6])).padStart(2, '0')),
      ],
      temporalAlternativeKind(match[1], match[4] ?? ''),
    );
  }

  const namedPeriods = new RegExp(
    String.raw`\b(?:(between)\s+|either\s+)?(early|mid|late)\s+(${months})\s*(or|and|\/|[-–—])\s*(early|mid|late)\s+(${months})\b`,
    'giu',
  );
  for (const match of value.matchAll(namedPeriods)) {
    const firstMonth = MONTH_NUMBERS.get((match[3] ?? '').toLocaleLowerCase());
    const secondMonth = MONTH_NUMBERS.get((match[6] ?? '').toLocaleLowerCase());
    if (firstMonth == null || secondMonth == null) continue;
    push(
      [
        `period:${match[2]?.toLocaleLowerCase()}:${firstMonth}`,
        `period:${match[5]?.toLocaleLowerCase()}:${secondMonth}`,
      ],
      temporalAlternativeKind(match[1], match[4] ?? ''),
    );
  }

  const isoDates =
    /\b(?:(between)\s+|either\s+)?(\d{4}-\d{2}-\d{2})\s*(or|and|\/|[-–—])\s*(\d{4}-\d{2}-\d{2})\b/giu;
  for (const match of value.matchAll(isoDates)) {
    push([match[2] ?? '', match[4] ?? ''], temporalAlternativeKind(match[1], match[3] ?? ''));
  }

  const years = /\b(?:(between)\s+|either\s+)?(\d{4})\s*(or|and|\/|[-–—])\s*(\d{4})\b/giu;
  for (const match of value.matchAll(years)) {
    push(
      [`year:${match[2]}`, `year:${match[4]}`],
      temporalAlternativeKind(match[1], match[3] ?? ''),
    );
  }

  return groups;
}

function preservesAlternativeTemporalMeaning(sourceText: string, eventSummary: string): boolean {
  const sourceGroups = temporalAlternativeGroups(sourceText);
  if (sourceGroups.length === 0) return true;
  const summaryGroups = temporalAlternativeGroups(eventSummary);

  // Exact source spans are authoritative. A provider summary may normalize
  // punctuation or render an adjacent alternative as a bounded range, but it
  // must retain every anchor and may not turn a range into a point or "or"
  // into an additive "and".
  return sourceGroups.every((sourceGroup) =>
    summaryGroups.some((summaryGroup) => {
      if (JSON.stringify(sourceGroup.anchors) !== JSON.stringify(summaryGroup.anchors)) {
        return false;
      }
      if (sourceGroup.kind === 'alternative') {
        return summaryGroup.kind === 'alternative';
      }
      return sourceGroup.kind === summaryGroup.kind;
    }),
  );
}

type MaterialEpistemicQualification =
  | 'allegation'
  | 'appearance'
  | 'approximation'
  | 'belief'
  | 'denial_or_dispute'
  | 'inference'
  | 'modal_possibility'
  | 'probability_likely'
  | 'probability_unlikely'
  | 'suspicion'
  | 'uncertainty';

function materialEpistemicQualifications(value: string): Set<MaterialEpistemicQualification> {
  const qualifications = new Set<MaterialEpistemicQualification>();
  const add = (qualification: MaterialEpistemicQualification, pattern: RegExp): void => {
    if (pattern.test(value)) qualifications.add(qualification);
  };

  if (
    hasModalMay(value) ||
    /\b(?:might|could(?:\s+have)?|possibly|possible|perhaps)\b/iu.test(value)
  ) {
    qualifications.add('modal_possibility');
  }
  add('probability_likely', /\b(?:likely|probably|probable)\b/iu);
  add('probability_unlikely', /\b(?:unlikely|improbably|improbable)\b/iu);
  if (
    /\b(?:think|thinks|thought|believ(?:e|es|ed|ing))\b/iu.test(value) ||
    NOUN_LED_BELIEF_ATTRIBUTION.test(value)
  ) {
    qualifications.add('belief');
  }
  add('suspicion', /\b(?:suspect|suspects|suspected|suspecting|suspicion)\b/iu);
  add('inference', /\b(?:infer|infers|inferred|inferring|inference|deduc\w*|conclud\w*)\b/iu);
  add(
    'appearance',
    /\b(?:apparently|seemingly|appear|appears|appeared|appearing|seem|seems|seemed)\b/iu,
  );
  add(
    'approximation',
    /\b(?:around|about|approximately|approximate|estimated?|estimates|estimating)\b/iu,
  );
  add(
    'uncertainty',
    /\b(?:unclear|uncertain|unknown|unresolved|ambiguous|unsure|not\s+(?:clear|known|established|resolved))\b/iu,
  );
  add('allegation', /\b(?:allege|alleges|alleged|alleging|allegation|allegedly)\b/iu);
  add(
    'denial_or_dispute',
    /\b(?:deny|denies|denied|denying|denial|dispute|disputes|disputed|disputing|contest(?:s|ed|ing)?)\b/iu,
  );
  return qualifications;
}

function preservesEpistemicQualifications(sourceText: string, eventSummary: string): boolean {
  const sourceQualifications = materialEpistemicQualifications(sourceText);
  const summaryQualifications = materialEpistemicQualifications(eventSummary);

  // Exact source spans are authoritative. Wording may be normalized, and a
  // definite source may be summarized more cautiously, but every material
  // source category must survive. Categories are deliberately not collapsed
  // into one generic "uncertain" bucket: likely, possible, apparent, believed,
  // suspected, inferred, alleged, and disputed meanings are not interchangeable.
  return [...sourceQualifications].every((qualification) =>
    summaryQualifications.has(qualification),
  );
}

type DeliveryOccurrenceState = {
  delivered: boolean;
  late: boolean;
  partial: boolean;
  complete: boolean;
  notDelivered: boolean;
  notDeliveredByDeadline: boolean;
  neverDelivered: boolean;
  unclear: boolean;
  deniedOrDisputed: boolean;
};

function statesPlainNonDelivery(value: string): boolean {
  const active =
    /\b(?:did\s+not|didn['’]t|does\s+not|doesn['’]t|failed\s+to)\s+(?:deliver|ship|send|supply|submit)\b/iu;
  const passive =
    /\b(?:(?:is|are|was|were)\s+not|(?:isn|aren|wasn|weren)['’]t)\s+(?:delivered|shipped|sent|supplied|submitted)\b|\b(?:(?:has|have|had)\s+not|(?:hasn|haven|hadn)['’]t)\s+been\s+(?:delivered|shipped|sent|supplied|submitted)\b/iu;
  const noOccurrence =
    /\bno\s+(?:content\s+|file\s+|material\s+)?delivery\s+(?:occurred|happened|took\s+place)\b/iu;
  return active.test(value) || passive.test(value) || noOccurrence.test(value);
}

function statesNonDeliveryByDeadline(value: string): boolean {
  const deadlineAnchor =
    /\bby\s+(?:the\s+)?(?:deadline|due\s+date|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,4})\b/iu;
  return statesPlainNonDelivery(value) && deadlineAnchor.test(value);
}

function deliveryOccurrenceSegments(value: string): string[] {
  // Exact spans sometimes ground several explicitly separate occurrences. Keep
  // a composite state such as "partially delivered after the deadline" in one
  // segment, while separating provider wording that expressly moves to a later
  // or another occurrence.
  return value
    .split(
      /[.;\r\n]+|,\s*(?=(?:and\s+)?(?:later|then|subsequently|only\s+(?:part|some)|partially|partly)\b)/iu,
    )
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function deliveryOccurrenceState(value: string): DeliveryOccurrenceState | null {
  const deliveryTerm =
    /\b(?:deliver(?:y|ed|ing)?|shipment|sen[dt]|send(?:ing)?|suppl(?:y|ied|ying)|submit(?:ted|ting)?|arriv(?:al|e|ed|ing))\b/iu;
  if (!deliveryTerm.test(value)) return null;

  const deniedOrDisputed =
    /\b(?:den(?:y|ies|ied|ying)|disput(?:e|es|ed|ing)|contest(?:s|ed|ing)?)\s+(?:that|whether)\b[^.;]{0,80}\b(?:deliver|ship|send|sent|suppl|submit|arriv)\w*/iu.test(
      value,
    );
  const unclear =
    /\b(?:unclear|uncertain|unknown|unresolved|ambiguous|unsure|not\s+(?:clear|known|established|resolved))\b[^.;]{0,80}\b(?:whether\b[^.;]{0,48})?(?:deliver|ship|send|sent|suppl|submit|arriv)\w*/iu.test(
      value,
    );
  const neverDelivered =
    /\bnever\s+(?:been\s+)?(?:deliver(?:ed)?|shipp?ed|sen[dt]|suppl(?:y|ied)|submit(?:ted)?|arriv(?:e|ed))\b/iu.test(
      value,
    );
  const notDelivered = statesPlainNonDelivery(value);
  const notDeliveredByDeadline = statesNonDeliveryByDeadline(value);
  const partial =
    /\b(?:partially|partly|only\s+(?:part|some)(?:\s+of\b[^.;]{0,32})?)\b[^.;]{0,48}\b(?:deliver(?:ed)?|shipp?ed|sen[dt]|suppl(?:y|ied)|submit(?:ted)?|arriv(?:e|ed))\b|\b(?:deliver(?:ed)?|shipp?ed|sen[dt]|suppl(?:y|ied)|submit(?:ted)?|arriv(?:e|ed))\b[^.;]{0,48}\b(?:partially|partly|only\s+(?:part|some))\b/iu.test(
      value,
    );
  const late =
    /\b(?:late|overdue)\s+(?:deliver|delivery|shipment|content|copy|files?|images?|material|batch)\w*|\b(?:deliver|ship|send|sent|suppl|submit|arriv)\w*\b[^.;]{0,48}\b(?:late|overdue|after\s+(?:the\s+)?deadline)\b/iu.test(
      value,
    );
  const complete =
    /\b(?:complete|completed|full|fully)\s+(?:deliver|delivery|shipment|content|copy|files?|images?|material|batch)\w*|\b(?:deliver|delivery|shipment|ship|send|sent|suppl|submit|arriv)\w*\b[^.;]{0,40}\b(?:complete|completed|full|fully)\b/iu.test(
      value,
    );
  // Precedence is fail-closed: denied/disputed, unclear, never-delivered,
  // plain non-delivery, and deadline-qualified non-delivery all block
  // affirmative delivery. The deadline flag adds temporal detail to the plain
  // negative state; it is never required to establish non-delivery.
  const affirmativeDelivery = !(
    deniedOrDisputed ||
    unclear ||
    neverDelivered ||
    notDelivered ||
    notDeliveredByDeadline
  );

  return {
    delivered: affirmativeDelivery,
    late: affirmativeDelivery && late,
    partial: affirmativeDelivery && partial,
    complete: affirmativeDelivery && complete && !partial,
    notDelivered,
    notDeliveredByDeadline,
    neverDelivered,
    unclear,
    deniedOrDisputed,
  };
}

function deliveryOccurrenceProfiles(value: string): DeliveryOccurrenceState[] {
  return deliveryOccurrenceSegments(value)
    .map(deliveryOccurrenceState)
    .filter((state): state is DeliveryOccurrenceState => state != null);
}

function preservesDeliveryOccurrenceState(sourceText: string, eventSummary: string): boolean {
  const sourceProfiles = deliveryOccurrenceProfiles(sourceText);
  if (sourceProfiles.length === 0) return true;
  const summaryProfiles = deliveryOccurrenceProfiles(eventSummary);
  if (summaryProfiles.length === 0) {
    // A broad span may also ground a separately typed incident such as revisions
    // or scope changes. That is not a delivery-state normalization. Otherwise,
    // explicit source state plus missing summary state fails closed.
    const summaryMeaning = canonicalAssertedMeaning([eventSummary], 'client_delay');
    return summaryMeaning.incidents.some((incident) => incident !== 'input_delivery');
  }

  const summaryPreserves = (source: DeliveryOccurrenceState): boolean =>
    summaryProfiles.some(
      (summary) =>
        (!source.deniedOrDisputed || summary.deniedOrDisputed) &&
        (!source.unclear || summary.unclear) &&
        (!source.neverDelivered || summary.neverDelivered) &&
        (!source.notDelivered || summary.notDelivered) &&
        (!source.notDeliveredByDeadline || summary.notDeliveredByDeadline) &&
        (!source.partial || summary.partial) &&
        (!source.late || summary.late) &&
        (!source.complete || summary.complete) &&
        (!source.delivered || summary.delivered),
    );

  // Source occurrence polarity and completion are authoritative. An explicit
  // transition ("then", "later", or "subsequently") proves that separately
  // parsed profiles are separate occurrences, so every one must survive.
  // Without that signal, repeated prose may restate one occurrence (for
  // example, a narrative sentence followed by its causal interpretation), and
  // a compatible source profile is sufficient. Simultaneous properties within
  // one profile remain compositional in either case.
  const hasExplicitOccurrenceTransition =
    /(?:[,;.]|\band\b)\s*(?:and\s+)?(?:later|then|subsequently)\b/iu.test(sourceText);
  const sourcePolarities = new Set(
    sourceProfiles.map((profile) => {
      if (profile.neverDelivered || profile.notDelivered || profile.notDeliveredByDeadline) {
        return 'negative';
      }
      if (profile.unclear || profile.deniedOrDisputed) return 'qualified';
      return 'affirmative';
    }),
  );
  const hasDistinctOccurrencePolarity = sourcePolarities.size > 1;
  return hasExplicitOccurrenceTransition || hasDistinctOccurrencePolarity
    ? sourceProfiles.every(summaryPreserves)
    : sourceProfiles.some(summaryPreserves);
}

function sourceGroundsCandidateIncident(sourceText: string, eventSummary: string): boolean {
  const sourceMeaning = canonicalAssertedMeaning([sourceText], 'client_delay');
  const candidateMeaning = canonicalAssertedMeaning([eventSummary], 'client_delay');
  const groundedIncidents = new Set<string>();
  if (
    deliveryOccurrenceProfiles(sourceText).length > 0 ||
    /\b(?:late|missing|delayed|overdue)\s+(?:batch|content|copy|files?|images?|material|shipment)\b/iu.test(
      sourceText,
    )
  ) {
    groundedIncidents.add('input_delivery');
  }
  if (/\b(?:change|changes|changed|revision|revisions|rework|repeated)\b/iu.test(sourceText)) {
    groundedIncidents.add('revision_change');
  }
  if (
    /\b(?:scope|added|additional)\b[^.;]{0,48}\b(?:change|changes|request|requests)\b/iu.test(
      sourceText,
    )
  ) {
    groundedIncidents.add('scope_change');
  }

  // Exact coordinates establish provenance, not semantic support. This
  // compatibility repair additionally requires a source-local incident
  // predicate or qualified incident noun and the same typed incident family
  // as the provider event. A bare object keyword is not semantic grounding.
  return sourceMeaning.incidents.some(
    (incident) => groundedIncidents.has(incident) && candidateMeaning.incidents.includes(incident),
  );
}

function preservesSourceQualifications(eventSummary: string, spans: JsonObject[]): boolean {
  const sourceText = spans.map((span) => span.quote).join(' ');
  return (
    !NOUN_LED_BELIEF_ATTRIBUTION.test(sourceText) &&
    sourceGroundsCandidateIncident(sourceText, eventSummary) &&
    preservesEpistemicQualifications(sourceText, eventSummary) &&
    preservesAlternativeTemporalMeaning(sourceText, eventSummary) &&
    preservesDeliveryOccurrenceState(sourceText, eventSummary)
  );
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

function temporalAnchorPairConflicts(left: string, right: string): boolean {
  const rightParts = temporalAnchorParts(right);
  return temporalAnchorParts(left).some(
    (part, index) => part !== '*' && rightParts[index] !== '*' && part !== rightParts[index],
  );
}

function temporalAnchorCollectionsConflict(left: string[], right: string[]): boolean {
  const everyAnchorHasCompatibleMatch = (values: string[], candidates: string[]): boolean =>
    values.every((value) =>
      candidates.some((candidate) => !temporalAnchorPairConflicts(value, candidate)),
    );

  // Alternatives and ranges are sets, not cross-products. Matching May 8/May 9
  // collections are compatible even though their opposite endpoints differ,
  // while any unmatched reliable anchor remains a fail-closed contradiction.
  return !everyAnchorHasCompatibleMatch(left, right) || !everyAnchorHasCompatibleMatch(right, left);
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
    'not_delivered',
    'not_delivered_by_deadline',
    'never_completed',
    'not_completed',
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
    temporalAnchorCollectionsConflict(candidate.temporalAnchors, assertedCause.temporalAnchors)
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
  const notDelivered = statesPlainNonDelivery(text);
  const notDeliveredByDeadline = statesNonDeliveryByDeadline(text);
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
    } else if (notDelivered) {
      occurrencePolarity.add('not_delivered');
      completionState.add('not_completed');
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

function requireCompatibilityCanonicalArrays(modelOutput: JsonObject): void {
  // This projection may consolidate timeline rows and append one claim, so both
  // canonical arrays must already have their provider-schema container shape.
  // Check both before cloning or transforming anything. Nested row validity and
  // every other canonical field remain the responsibility of ordinary assembly
  // validation; this compatibility boundary never coerces malformed input.
  for (const field of ['timeline', 'claims'] as const) {
    if (!Array.isArray(modelOutput[field])) {
      throw new Error(
        `Dry Run 001 client-delay compatibility projection requires ${field} to be an array.`,
      );
    }
  }
}

/**
 * Internal pure transform used by the focused compatibility regression suite
 * and the explicit projection entrypoint. This case-specific name is
 * intentional: normal extraction and assembly must never call this helper.
 *
 * This is deliberately not a narrative parser. It requires a high-materiality Person A
 * assertion about Person B, a supported-unanswered occurrence, an explicit direct
 * schedule-delay interpretation, exact source slices, and no existing claim that already
 * covers those slices. The emitted claim copies the model's qualified event summary,
 * evidence references, materiality, and spans without importing golden data or inferring
 * objective occurrence.
 *
 * @internal
 */
export function applyDryRun001ClA003CompatibilityRecovery(
  modelOutput: JsonObject,
  narrative: string,
): JsonObject {
  requireCompatibilityCanonicalArrays(modelOutput);
  const normalized = structuredClone(modelOutput);
  const timeline = consolidateExactDuplicateTimelineRows(normalized.timeline);
  normalized.timeline = timeline;
  const claims: JsonObject[] = normalized.claims;
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
      !isDirectClientDelayInterpretation(
        event.person_a_interpretation,
        event,
        normalized.party_profile?.display_name,
      )
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
