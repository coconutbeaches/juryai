type JsonObject = Record<string, any>;

const DIRECT_DELAY_CAUSATION =
  /\b(?:caus(?:e|es|ed|ing)|contribut(?:e|es|ed|ing)|result(?:s|ed|ing))\b[^.]{0,96}\b(?:schedule\s+)?delay\b|\b(?:schedule\s+)?delay\b[^.]{0,96}\b(?:caus(?:e|es|ed|ing)|result(?:s|ed|ing)\s+from|came\s+from)\b/iu;
const NON_ASSERTED_CAUSATION =
  /\b(?:could|might|possibly|possible|perhaps|hypothetical(?:ly)?|speculat(?:e|es|ed|ing|ive)|unclear|uncertain|unknown|unresolved|ambiguous|unsure|whether|infer(?:s|red|ring)?|wonder(?:s|ed|ing)?)\b|\bmay\b(?!\s+\d{1,2}\b)|\b(?:not|isn['’]t|wasn['’]t)\s+(?:clear|known|established|resolved)\b/iu;
const DENIED_CAUSATION =
  /\b(?:den(?:y|ies|ied|ying)|disput(?:e|es|ed|ing)|did\s+not|does\s+not|do\s+not|was\s+not|were\s+not|never)\b[^.]{0,96}\b(?:caus|contribut|result|delay)\w*/iu;
const REPORTED_BELIEF =
  /\b(?:report(?:s|ed|ing)?|describ(?:e|es|ed|ing))\b[^.]{0,96}\b(?:belief|opinion|view)\b/iu;
const METADATA_ONLY = /\b(?:metadata|file\s*name|filename|label|index|keyword)\b/iu;

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

function isDirectClientDelayInterpretation(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  return (
    DIRECT_DELAY_CAUSATION.test(value) &&
    !NON_ASSERTED_CAUSATION.test(value) &&
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

function evidenceSupportCompatible(claim: JsonObject, event: JsonObject): boolean {
  const claimEvidence = new Set(
    (Array.isArray(claim.supporting_evidence_ids) ? claim.supporting_evidence_ids : []).filter(
      (value: unknown): value is string => typeof value === 'string',
    ),
  );
  const eventEvidence = (
    Array.isArray(event.source_evidence_ids) ? event.source_evidence_ids : []
  ).filter((value: unknown): value is string => typeof value === 'string');
  if (eventEvidence.length === 0) return claimEvidence.size === 0;
  return eventEvidence.some((id: string) => claimEvidence.has(id));
}

function existingClaimCoversEvent(
  claim: JsonObject,
  event: JsonObject,
  spans: JsonObject[],
): boolean {
  if (
    claim.party_id !== 'party_a' ||
    claim.claim_type !== 'client_delay' ||
    claim.response_status !== 'unanswered' ||
    claim.materiality !== event.materiality ||
    claim.against_asserting_party_interest !== false ||
    !evidenceSupportCompatible(claim, event)
  ) {
    return false;
  }
  const claimSpans = Array.isArray(claim.source_spans) ? claim.source_spans : [];
  return spans.every((span) =>
    claimSpans.some((claimSpan: unknown) => spanContains(claimSpan, span)),
  );
}

function eventSemanticKey(event: JsonObject, spans: JsonObject[]): string {
  const evidenceIds = (Array.isArray(event.source_evidence_ids) ? event.source_evidence_ids : [])
    .filter((value: unknown): value is string => typeof value === 'string')
    .sort();
  const sourceSpans = spans
    .map((span) => ({
      submission_id: span.submission_id,
      start_char: span.start_char,
      end_char: span.end_char,
      quote: span.quote,
    }))
    .sort(
      (left, right) =>
        String(left.submission_id).localeCompare(String(right.submission_id)) ||
        left.start_char - right.start_char ||
        left.end_char - right.end_char ||
        String(left.quote).localeCompare(String(right.quote)),
    );
  return JSON.stringify({
    event_summary: event.event_summary,
    actor_party_id: event.actor_party_id,
    actor_third_party_id: event.actor_third_party_id,
    asserted_by_party_ids: event.asserted_by_party_ids,
    occurrence_status: event.occurrence_status,
    interpretation_status: event.interpretation_status,
    person_a_interpretation: event.person_a_interpretation,
    person_b_interpretation: event.person_b_interpretation,
    materiality: event.materiality,
    date: {
      start: event.date?.start,
      end: event.date?.end,
      precision: event.date?.precision,
      approximate: event.date?.approximate,
    },
    source_evidence_ids: evidenceIds,
    source_spans: sourceSpans,
  });
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
  const representedEvents = new Set<string>();
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
    const semanticKey = eventSemanticKey(event, spans);
    if (representedEvents.has(semanticKey)) continue;
    if (providerClaims.some((claim) => existingClaimCoversEvent(claim, event, spans))) {
      representedEvents.add(semanticKey);
      continue;
    }

    const supportingEvidenceIds = Array.isArray(event.source_evidence_ids)
      ? [
          ...new Set(
            event.source_evidence_ids.filter(
              (value: unknown): value is string => typeof value === 'string',
            ),
          ),
        ]
      : [];
    const claimId = uniqueClaimId(event.event_id, canonicalIds);
    canonicalIds.add(claimId);
    representedEvents.add(semanticKey);
    claims.push({
      claim_id: claimId,
      party_id: 'party_a',
      claim_text: event.event_summary,
      claim_type: 'client_delay',
      response_status: 'unanswered',
      materiality: event.materiality,
      support_level: supportingEvidenceIds.length > 0 ? 'not_assessed' : 'none',
      supporting_evidence_ids: supportingEvidenceIds,
      contradicting_evidence_ids: [],
      counterclaim_ids: [],
      requires_clarification:
        event.date?.start == null || event.date?.end == null || event.date?.precision === 'unknown',
      against_asserting_party_interest: false,
      source_spans: structuredClone(spans),
    });
  }

  return normalized;
}
