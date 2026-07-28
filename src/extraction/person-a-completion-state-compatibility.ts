type JsonObject = Record<string, any>;

type CompletionStatus =
  | 'partially_complete'
  | 'substantially_complete'
  | 'complete'
  | 'not_complete'
  | 'disputed'
  | 'unknown';

type ExactSourceQuote = {
  quote: string;
  startChar: number;
};

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactSourceQuotes(value: unknown, narrative: string): ExactSourceQuote[] {
  if (!isJsonObject(value) || !Array.isArray(value.source_spans)) return [];
  return value.source_spans.flatMap((span: unknown) => {
    if (
      !isJsonObject(span) ||
      typeof span.quote !== 'string' ||
      !Number.isInteger(span.start_char) ||
      !Number.isInteger(span.end_char) ||
      span.start_char < 0 ||
      span.end_char < span.start_char ||
      span.end_char > narrative.length ||
      span.end_char - span.start_char !== span.quote.length ||
      narrative.slice(span.start_char, span.end_char) !== span.quote
    ) {
      return [];
    }
    return [{ quote: span.quote, startChar: span.start_char }];
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function hasCompletionLanguage(text: string): boolean {
  return /\b(?:complet(?:e|ed|ing|ion)|incomplete|done|finish(?:ed|ing)?|unfinished|finali[sz](?:e|ed|ing)|deliver(?:ed|ing|y)?)\b/iu.test(
    text,
  );
}

function isCoreferentialCompletionContinuation(clause: string): boolean {
  return (
    hasCompletionLanguage(clause) &&
    (/^(?:(?:it|this)\s+)?(?:is|was|has|had|will|would|can|could|may|might|became|becomes|remained|remains)\b/iu.test(
      clause,
    ) ||
      /^(?:i|we)\s+(?:(?:did|do|have|had|will|would|can|could|may|might)\s+)?(?:not\s+)?(?:complet(?:e|ed)|finish(?:ed)?|deliver(?:ed)?|finali[sz](?:e|ed))\s+(?:it|this)\b/iu.test(
        clause,
      ))
  );
}

function scopedCompletionText(deliverableName: string, quotes: string[]): string {
  const clauses = quotes.flatMap((quote) =>
    quote
      .split(
        /[.!?;\r\n]+|\s+(?:although|and|but|while)\s+|,\s+(?:currently|now|today)\s+|,\s+(?=(?:it|this)\s+(?:is|was|has|had|will|would|can|could|may|might|became|becomes|remained|remains)\b)/iu,
      )
      .map((clause) => clause.trim())
      .filter((clause) => clause.length > 0),
  );
  if (deliverableName.length === 0) return clauses.join(' ');
  const namePattern = new RegExp(`\\b${escapeRegex(deliverableName)}\\b`, 'iu');
  const namedCompletionClauses = clauses.flatMap((clause, index) => {
    if (!namePattern.test(clause) || !hasCompletionLanguage(clause)) return [];
    let scopedClause = clause;
    for (let next = index + 1; next < clauses.length; next += 1) {
      const nextClause = clauses[next];
      if (
        nextClause === undefined ||
        namePattern.test(nextClause) ||
        !isCoreferentialCompletionContinuation(nextClause)
      ) {
        break;
      }
      scopedClause = `${deliverableName} ${nextClause}`;
    }
    return [scopedClause];
  });
  return namedCompletionClauses[namedCompletionClauses.length - 1] ?? clauses.join(' ');
}

function removeNegatedReportingPrefixes(text: string): string {
  return text.replace(
    /\b(?:did\s+not|didn't|do\s+not|don't|does\s+not|doesn't|never)\s+(?:(?:actually|explicitly|necessarily|really)\s+)?(?:deny|dispute|contest)\s+(?:that\s+)?/giu,
    '',
  );
}

function sourceSupportedStatus(
  deliverableName: unknown,
  quotes: ExactSourceQuote[],
): CompletionStatus | null {
  if (quotes.length === 0) return null;
  const normalizedName =
    typeof deliverableName === 'string'
      ? deliverableName.trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
      : '';
  const normalizedQuotes = [...quotes]
    .sort((left, right) => left.startChar - right.startChar)
    .map(({ quote }) => quote.replace(/[’‘]/gu, "'").toLocaleLowerCase());
  const text = removeNegatedReportingPrefixes(
    scopedCompletionText(normalizedName, normalizedQuotes),
  );

  if (/\b(?:not\s+started|never\s+started|work\s+had\s+not\s+begun)\b/iu.test(text)) {
    return 'not_complete';
  }

  if (!hasCompletionLanguage(text)) return null;

  if (
    /\bnot\s+(?:all|each|every)\b[^.;]{0,64}\b(?:deliverables?|pages?|project|site|website)\b[^.;]{0,32}\b(?:complete|completed|done|finished)\b/iu.test(
      text,
    )
  ) {
    return 'unknown';
  }

  if (
    /\b(?:no|none\s+of\s+the)\s+(?:deliverables?|pages?)\b[^.;]{0,32}\b(?:complete|completed|done|finished)\b/iu.test(
      text,
    ) ||
    /\b(?:(?:has|have|had|is|was)\s+yet\s+to\s+be|(?:needs?|needed|requires?|required|remains?)\s+to\s+be)\s+(?:completed|finished|delivered|finali[sz]ed)\b/iu.test(
      text,
    )
  ) {
    return 'not_complete';
  }

  if (
    /\b(?:did\s+not|didn't|do\s+not|don't|has\s+not|hasn't|have\s+not|haven't|is\s+not|isn't|never|was\s+not|wasn't)\b[^.;]{0,48}\b(?:complet(?:e|ed|ing|ion)|done|finish(?:ed|ing)?|finali[sz](?:e|ed|ing)|deliver(?:ed|ing|y)?)\b/iu.test(
      text,
    ) ||
    /\b(?:deny|denies|denied|denying)\b[^.;]{0,56}\b(?:complete|completed|completion|done|finished)\b/iu.test(
      text,
    ) ||
    /\b(?:abandon(?:ed|ment)?|cancel(?:led|ed|lation)?|stopped)\b[^.;]{0,48}\b(?:before|without|prior\s+to)\b[^.;]{0,24}\b(?:complete|completed|completion|finish(?:ed)?)\b/iu.test(
      text,
    )
  ) {
    return 'not_complete';
  }

  if (
    /\b(?:dispute|disputes|disputed|disputing|contest|contests|contested|contesting)\b[^.;]{0,56}\b(?:complete|completed|completion|done|finished)\b/iu.test(
      text,
    ) ||
    /\b(?:complete|completed|completion|done|finished)\b[^.;]{0,56}\b(?:(?:is|was|remains?)\s+|(?:has|had)\s+been\s+)(?:disputed|contested)\b/iu.test(
      text,
    )
  ) {
    return 'disputed';
  }

  if (
    /\b(?:could|might|may|would|perhaps|possibly|hypothetically)\b[^.;]{0,48}\b(?:be\s+)?(?:incomplete|unfinished)\b/iu.test(
      text,
    )
  ) {
    return 'unknown';
  }

  if (
    /\b(?:partially|partly)\b/iu.test(text) ||
    /\b(?:incomplete|unfinished)\b/iu.test(text) ||
    /\bonly\s+(?:part|some)\b/iu.test(text)
  ) {
    return 'partially_complete';
  }

  if (
    /\b(?:substantially|mostly|largely|nearly|almost)\s+(?:complete|completed|done|finished)\b/iu.test(
      text,
    ) ||
    /\b(?:complete|completed)\s+(?:staging(?:\s+version)?|draft|prototype|mock[- ]?up|preview|beta)\b/iu.test(
      text,
    ) ||
    /\b(?:staging(?:\s+version)?|draft|prototype|mock[- ]?up|preview|beta)\b[^.;]{0,40}\b(?:complete|completed|done|finished)\b/iu.test(
      text,
    )
  ) {
    return 'substantially_complete';
  }

  if (
    /\b(?:pending|awaiting)\b[^.;]{0,48}\b(?:approval|completion|sign[- ]?off)\b/iu.test(text) ||
    /\b(?:blocked|prevented)\b[^.;]{0,48}\b(?:complet(?:e|ed|ing|ion)|finish(?:ed|ing)?)\b/iu.test(
      text,
    ) ||
    /\b(?:could|might|may|would|perhaps|possibly|hypothetically)\b[^.;]{0,48}\b(?:complete|completed|completion|done|finish(?:ed)?)\b/iu.test(
      text,
    ) ||
    /\b(?:will|plan(?:s|ned)?\s+to|intend(?:s|ed)?\s+to|expect(?:s|ed)?\s+to|hope(?:s|d)?\s+to)\b[^.;]{0,48}\b(?:complete|finish|finali[sz]e|deliver)\b/iu.test(
      text,
    )
  ) {
    return 'unknown';
  }

  const namesSpecificDeliverable =
    normalizedName.length > 0 &&
    new RegExp(`\\b${escapeRegex(normalizedName)}\\b`, 'iu').test(text);
  const namesAggregate =
    /\b(?:all|each|entire|every|whole)\b[^.;]{0,32}\b(?:deliverables?|pages?|project|site|website)\b|\b(?:entire|whole)\s+(?:project|site|website)\b/iu.test(
      text,
    );

  if (namesSpecificDeliverable || namesAggregate) return 'complete';
  return null;
}

function requireCanonicalArrays(modelOutput: JsonObject): void {
  for (const field of ['deliverable_assessments', 'claims'] as const) {
    if (!Array.isArray(modelOutput[field])) {
      throw new Error(
        `Person A completion-state compatibility projection requires ${field} to be an array.`,
      );
    }
  }
}

/**
 * Correct provider completion-state upgrades only when the provider's own
 * exact claim spans establish a narrower state. This pure compatibility
 * transform never reads golden data and is not part of ordinary extraction.
 */
export function applyPersonACompletionStateCompatibility(
  modelOutput: JsonObject,
  narrative: string,
): JsonObject {
  requireCanonicalArrays(modelOutput);
  const projected = structuredClone(modelOutput);
  const claimsById = new Map<string, JsonObject>(
    projected.claims.flatMap((claim: unknown) =>
      isJsonObject(claim) && typeof claim.claim_id === 'string'
        ? [[claim.claim_id, claim] as const]
        : [],
    ),
  );

  for (const deliverable of projected.deliverable_assessments) {
    if (
      !isJsonObject(deliverable) ||
      deliverable.completion_status_person_a !== 'complete' ||
      !Array.isArray(deliverable.source_claim_ids)
    ) {
      continue;
    }
    const quotes = deliverable.source_claim_ids.flatMap((claimId: unknown) =>
      typeof claimId === 'string' ? exactSourceQuotes(claimsById.get(claimId), narrative) : [],
    );
    const supported = sourceSupportedStatus(deliverable.name, quotes);
    if (supported !== null && supported !== 'complete') {
      deliverable.completion_status_person_a = supported;
    }
  }
  return projected;
}
