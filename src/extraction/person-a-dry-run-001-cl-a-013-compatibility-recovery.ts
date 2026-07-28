import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { validatePersonAExtraction } from './validate-person-a-corrected.js';

type JsonObject = Record<string, any>;

const EXPECTED_NARRATIVE_SHA256 =
  '2cdb00b4b2b28c1813a979be5cf22f1ac51a30282abea9e144df491549c4fcc7';
const EXPECTED_PRIOR_PROJECTION_SHA256 =
  'f46a43391795d5f8e0a8360992ce74135547f887cc5cba512f6e81d11a1f311d';
const EXPECTED_PRIOR_SERIALIZATION_SHA256 =
  'a50cfa97b53d2511869839f73bf1f2daf26747fa9d0567efa79c6e09a3182797';
const EXPECTED_CLAIMS_SHA256 = '89d594d55df3c6f4719c57f4f55af8478375cc91ff306b8ae17e790811daa0d0';
const EXPECTED_RELATED_RECORD_SHA256 = {
  term_12_pricing_section: '7f7689fb72897171a538f657f268aabbe7e9cae796eddbc927e1991f0e00607f',
  term_13_newsletter_signup: 'bb04990438bc33af37edde239849b112e77162948b5024e56c89a02acf6c29a6',
  term_14_homepage_changes: 'a4e033c40f0fb9666690edee69e490d1974714b098da0f1fd60d36991787c2c2',
  issue_02_added_scope_unclear: 'e6f4774cb7e9192957d060a7bbffd3ea0d3f5940b7ac8d5a58c90446858e0617',
} as const;
const EXPECTED_CLAIM_COUNT = 16;
const SOURCE_QUOTE =
  'I probably should have documented more clearly which requests were outside the original scope.';
const SOURCE_SPAN = {
  submission_id: 'sub_a_extracted',
  quote: SOURCE_QUOTE,
  start_char: 937,
  end_char: 1031,
} as const;
const RELATED_TERM_IDS = [
  'term_12_pricing_section',
  'term_13_newsletter_signup',
  'term_14_homepage_changes',
] as const;
const RELATED_ISSUE_ID = 'issue_02_added_scope_unclear';
const RECOVERED_CLAIM_ID = 'claim_15_scope_documentation';

export type DryRun001ClA013CompatibilityProjection = {
  version: 'dry-run-001-cl-a-013-compatibility-v1';
  extraction: JsonObject;
  audit: {
    operation: 'append';
    target_family: 'claims';
    created_claim_id: typeof RECOVERED_CLAIM_ID;
    narrative_sha256: typeof EXPECTED_NARRATIVE_SHA256;
    prior_projection_sha256: typeof EXPECTED_PRIOR_PROJECTION_SHA256;
    prior_serialization_sha256: typeof EXPECTED_PRIOR_SERIALIZATION_SHA256;
    prior_claims_sha256: typeof EXPECTED_CLAIMS_SHA256;
    related_record_sha256: typeof EXPECTED_RELATED_RECORD_SHA256;
    source_span: typeof SOURCE_SPAN;
    source_record_ids: [
      (typeof RELATED_TERM_IDS)[0],
      (typeof RELATED_TERM_IDS)[1],
      (typeof RELATED_TERM_IDS)[2],
      typeof RELATED_ISSUE_ID,
    ];
    before: null;
    after: JsonObject;
    rationale: string;
  };
};

function fail(message: string): never {
  throw new Error(`Dry Run 001 cl_a_013 compatibility projection ${message}`);
}

function canonicalizeJsonSafe(
  value: unknown,
  path = '$',
  ancestors = new WeakSet<object>(),
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint' ||
    (typeof value === 'number' && !Number.isFinite(value))
  ) {
    fail(`rejects non-JSON value at ${path}.`);
  }
  if (typeof value !== 'object') fail(`rejects unsupported value at ${path}.`);

  const object = value as object;
  if (utilTypes.isProxy(object)) fail(`rejects proxied input at ${path}.`);
  if (ancestors.has(object)) fail(`rejects cyclic input at ${path}.`);
  ancestors.add(object);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        fail(`requires an intrinsic array prototype at ${path}.`);
      }
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key === 'symbol')) {
        fail(`rejects symbol keys at ${path}.`);
      }
      const expectedKeys = new Set(['length']);
      for (let index = 0; index < value.length; index += 1) {
        expectedKeys.add(String(index));
      }
      if (
        ownKeys.length !== expectedKeys.size ||
        ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
      ) {
        fail(`requires a dense array without extra properties at ${path}.`);
      }
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail(`rejects sparse array at ${path}.`);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !('value' in descriptor)) {
          fail(`rejects accessor-backed array entry at ${path}[${index}].`);
        }
        result.push(canonicalizeJsonSafe(descriptor.value, `${path}[${index}]`, ancestors));
      }
      return result;
    }

    if (Object.getPrototypeOf(value) !== Object.prototype) {
      fail(`requires a plain object prototype at ${path}.`);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === 'symbol')) {
      fail(`rejects symbol keys at ${path}.`);
    }
    const entries: Array<[string, unknown]> = [];
    for (const key of (keys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
        fail(`rejects non-data property at ${path}.${key}.`);
      }
      entries.push([key, canonicalizeJsonSafe(descriptor.value, `${path}.${key}`, ancestors)]);
    }
    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(object);
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeJsonSafe(value)), 'utf8')
    .digest('hex');
}

function serializationFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function uniqueRecord(
  items: unknown,
  idField: string,
  expectedId: string,
  family: string,
): JsonObject {
  if (!Array.isArray(items)) fail(`requires ${family} to be an array.`);
  const matches = items.filter(
    (item): item is JsonObject =>
      item !== null &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      (item as JsonObject)[idField] === expectedId,
  );
  if (matches.length !== 1) {
    fail(`requires exactly one ${family} record '${expectedId}'.`);
  }
  return matches[0]!;
}

function requireExactSourceSpan(record: JsonObject, allowContainingSpan: boolean): void {
  if (!Array.isArray(record.source_spans)) fail('requires exact source-span arrays.');
  const matched = record.source_spans.some((span: unknown) => {
    if (span === null || typeof span !== 'object' || Array.isArray(span)) return false;
    const candidate = span as JsonObject;
    if (
      candidate.submission_id !== SOURCE_SPAN.submission_id ||
      typeof candidate.quote !== 'string' ||
      !Number.isInteger(candidate.start_char) ||
      !Number.isInteger(candidate.end_char)
    ) {
      return false;
    }
    if (allowContainingSpan) {
      return (
        candidate.start_char <= SOURCE_SPAN.start_char &&
        candidate.end_char >= SOURCE_SPAN.end_char &&
        candidate.quote.includes(SOURCE_QUOTE)
      );
    }
    return (
      candidate.quote === SOURCE_QUOTE &&
      candidate.start_char === SOURCE_SPAN.start_char &&
      candidate.end_char === SOURCE_SPAN.end_char
    );
  });
  if (!matched) fail('requires the exact audited documentation-admission source span.');
}

function requireFingerprint(value: unknown, expected: string, label: string): void {
  if (fingerprint(value) !== expected) fail(`requires the exact ${label} fingerprint.`);
}

function recoveredClaim(): JsonObject {
  return {
    claim_id: RECOVERED_CLAIM_ID,
    party_id: 'party_a',
    claim_text: SOURCE_QUOTE,
    claim_type: 'scope',
    response_status: 'unanswered',
    materiality: 'medium',
    support_level: 'none',
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
    counterclaim_ids: [],
    requires_clarification: false,
    against_asserting_party_interest: true,
    source_spans: [{ ...SOURCE_SPAN }],
  };
}

/**
 * Append the one grounded documentation admission omitted by the frozen Dry
 * Run 001 provider response. This is an exact-record compatibility boundary,
 * not a narrative parser or a general claim-synthesis rule.
 */
export function projectDryRun001ClA013CompatibilityRecovery(
  priorProjection: JsonObject,
  narrative: string,
): DryRun001ClA013CompatibilityProjection {
  if (typeof narrative !== 'string') fail('requires the exact narrative.');
  if (createHash('sha256').update(narrative, 'utf8').digest('hex') !== EXPECTED_NARRATIVE_SHA256) {
    fail('requires the exact narrative fingerprint.');
  }
  if (narrative.slice(SOURCE_SPAN.start_char, SOURCE_SPAN.end_char) !== SOURCE_SPAN.quote) {
    fail('requires the exact narrative source slice.');
  }

  requireFingerprint(priorProjection, EXPECTED_PRIOR_PROJECTION_SHA256, 'PR #16 projection');
  if (serializationFingerprint(priorProjection) !== EXPECTED_PRIOR_SERIALIZATION_SHA256) {
    fail('requires the exact PR #16 projection serialization.');
  }
  if (!Array.isArray(priorProjection.claims)) fail('requires claims to be an array.');
  if (priorProjection.claims.length !== EXPECTED_CLAIM_COUNT) {
    fail(`requires exactly ${EXPECTED_CLAIM_COUNT} prior claims.`);
  }
  requireFingerprint(priorProjection.claims, EXPECTED_CLAIMS_SHA256, 'prior claims');

  for (const termId of RELATED_TERM_IDS) {
    const term = uniqueRecord(
      priorProjection.agreement?.terms,
      'term_id',
      termId,
      'agreement terms',
    );
    requireFingerprint(term, EXPECTED_RELATED_RECORD_SHA256[termId], termId);
    requireExactSourceSpan(term, false);
  }
  const issue = uniqueRecord(
    priorProjection.extraction_issues,
    'issue_id',
    RELATED_ISSUE_ID,
    'extraction issues',
  );
  requireFingerprint(issue, EXPECTED_RELATED_RECORD_SHA256[RELATED_ISSUE_ID], RELATED_ISSUE_ID);
  requireExactSourceSpan(issue, true);

  const claim = recoveredClaim();
  const extraction = structuredClone(priorProjection);
  extraction.claims.push(structuredClone(claim));
  const validation = validatePersonAExtraction(extraction, narrative);
  if (!validation.valid) {
    fail(
      `created an invalid extraction: ${[...validation.schemaErrors, ...validation.invariantErrors]
        .map((item) => `${item.path}: ${item.message}`)
        .join('; ')}`,
    );
  }

  return {
    version: 'dry-run-001-cl-a-013-compatibility-v1',
    extraction,
    audit: {
      operation: 'append',
      target_family: 'claims',
      created_claim_id: RECOVERED_CLAIM_ID,
      narrative_sha256: EXPECTED_NARRATIVE_SHA256,
      prior_projection_sha256: EXPECTED_PRIOR_PROJECTION_SHA256,
      prior_serialization_sha256: EXPECTED_PRIOR_SERIALIZATION_SHA256,
      prior_claims_sha256: EXPECTED_CLAIMS_SHA256,
      related_record_sha256: { ...EXPECTED_RELATED_RECORD_SHA256 },
      source_span: { ...SOURCE_SPAN },
      source_record_ids: [
        'term_12_pricing_section',
        'term_13_newsletter_signup',
        'term_14_homepage_changes',
        'issue_02_added_scope_unclear',
      ],
      before: null,
      after: structuredClone(claim),
      rationale:
        'Projects the frozen provider response’s exact, qualified documentation admission into the claims family without changing its wording or epistemic force.',
    },
  };
}
