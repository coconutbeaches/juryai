type JsonObject = Record<string, any>;

const DIRECT_DELAY_CAUSATION =
  /\b(?:caus(?:e|es|ed|ing)|contribut(?:e|es|ed|ing)|result(?:s|ed|ing))\b[^.]{0,96}\b(?:schedule\s+)?delay\b|\b(?:schedule\s+)?delay\b[^.]{0,96}\b(?:caus(?:e|es|ed|ing)|result(?:s|ed|ing)\s+from|came\s+from)\b/iu;
const NON_ASSERTED_CAUSATION =
  /\b(?:could|might|may|possibly|perhaps|hypothetical(?:ly)?|speculat(?:e|es|ed|ing|ive)|uncertain|unsure|infer(?:s|red|ring)?|wonder(?:s|ed|ing)?\s+whether)\b/iu;
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

function spanCoveredByExistingClaim(span: JsonObject, claims: JsonObject[]): boolean {
  return claims.some((claim) =>
    (Array.isArray(claim.source_spans) ? claim.source_spans : []).some(
      (claimSpan: unknown) =>
        isJsonObject(claimSpan) &&
        claimSpan.submission_id === span.submission_id &&
        Number.isInteger(claimSpan.start_char) &&
        Number.isInteger(claimSpan.end_char) &&
        claimSpan.start_char <= span.start_char &&
        claimSpan.end_char >= span.end_char,
    ),
  );
}

function uniqueClaimId(eventId: string, claims: JsonObject[]): string {
  const stem = `claim_${eventId.replace(/[^a-zA-Z0-9_-]/gu, '_')}_client_delay`;
  const ids = new Set(
    claims
      .map((claim) => claim.claim_id)
      .filter((value): value is string => typeof value === 'string'),
  );
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
      !preservesSourceQualifications(event.event_summary, spans) ||
      spans.every((span: JsonObject) => spanCoveredByExistingClaim(span, claims))
    ) {
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
    claims.push({
      claim_id: uniqueClaimId(event.event_id, claims),
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
