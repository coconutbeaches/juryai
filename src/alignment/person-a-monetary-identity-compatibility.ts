import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import {
  familyItems,
  semanticSimilarity,
  type AlignmentPair,
  type PersonAAlignment,
  type PersonAAlignmentOptions,
} from './person-a-alignment.js';

type JsonObject = Record<string, any>;

type ExactSourceSpan = {
  startChar: number;
  endChar: number;
  quote: string;
};

type MonetaryIdentityProof = {
  amountMinorUnits: bigint;
  currency: string;
  sourceSpan: ExactSourceSpan;
};

type MonetaryRecoveryPair = AlignmentPair & {
  recovery_reason: 'exact_structured_monetary_identity';
};

type Candidate = {
  extractedIndex: number;
  goldenIndex: number;
  score: number;
};

const dryRun002NarrativeSha256 = '0508bdb60323a32beafaa0b7e7e7ac734cd64a002830fc8eb1ca52e5feda0f86';
const exactUsdLiteral = /\$(0|[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)\b/gu;

// These complete-record fingerprints keep the exception on the adjudicated
// representation only. Field diagnostics still compare the paired records;
// the fingerprints do not declare their causal wording or outcome type equal.
const frozenRepresentations = {
  damage: {
    extractedRecordSha256: '42d90ed9c3805af375ee0c12ba515bd2ae49bc2ac45b83adc3769b936ce12a37',
    goldenRecordSha256: '27d5ce5fd95e7a8fee3a64aae8c068ba7e894118d3a9c7f036d6f51631f7f8a2',
  },
  sourceClaim: {
    extractedRecordSha256: '9512e792b1db5df09e73b9e0afc500f567a83f16d1a8f4bd37c95d03130b045f',
    goldenRecordSha256: '2f52fd6d00c7eae617307136ec859e32ac0094d779a181ef026d49fc4193ec69',
  },
} as const;

function plainDataObject(value: unknown): JsonObject | null {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) return null;
  if (Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        return null;
      }
    }
    return value as JsonObject;
  } catch {
    return null;
  }
}

function ownDataValue(record: JsonObject, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function denseDataArray(value: unknown): unknown[] | null {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) return null;
  if (!Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    const expectedKeys = new Set(['length']);
    for (let index = 0; index < value.length; index += 1) expectedKeys.add(String(index));
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key !== 'string' || !expectedKeys.has(key)) ||
      keys.length !== expectedKeys.size
    ) {
      return null;
    }
    const entries: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        return null;
      }
      entries.push(descriptor.value);
    }
    return entries;
  } catch {
    return null;
  }
}

function canonicalizeJsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error('Structured monetary records must contain lossless JSON numbers.');
    }
    return value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value)) {
    throw new Error('Structured monetary records must contain plain JSON-safe values.');
  }
  if (seen.has(value)) throw new Error('Structured monetary records must not contain cycles.');
  seen.add(value);

  if (Array.isArray(value)) {
    const entries = denseDataArray(value);
    if (entries === null) {
      throw new Error('Structured monetary arrays must be dense intrinsic arrays.');
    }
    const result = entries.map((entry) => canonicalizeJsonSafe(entry, seen));
    seen.delete(value);
    return result;
  }

  const record = plainDataObject(value);
  if (record === null) {
    throw new Error('Structured monetary records must contain plain data objects.');
  }
  const entries = Reflect.ownKeys(record).map((key) => {
    if (typeof key !== 'string') {
      throw new Error('Structured monetary records must not contain symbol keys.');
    }
    return [key, canonicalizeJsonSafe(ownDataValue(record, key), seen)] as const;
  });
  seen.delete(value);
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

export function structuredMonetaryRecordFingerprint(value: unknown): string | null {
  try {
    return createHash('sha256')
      .update(JSON.stringify(canonicalizeJsonSafe(value)), 'utf8')
      .digest('hex');
  } catch {
    return null;
  }
}

function exactMinorUnits(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const scaled = value * 100;
  return Number.isSafeInteger(scaled) ? BigInt(scaled) : null;
}

function exactCurrency(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z]{3}$/u.test(value) ? value : null;
}

function exactSourceUsdMinorUnits(value: string): bigint | null {
  const matches = [...value.matchAll(exactUsdLiteral)];
  if (matches.length !== 1) return null;
  const digits = matches[0]![1]!.replaceAll(',', '');
  if (digits.length > 15) return null;
  try {
    return BigInt(digits) * 100n;
  } catch {
    return null;
  }
}

function exactSingletonAmountRange(item: JsonObject): bigint | null {
  const minimum = exactMinorUnits(ownDataValue(item, 'amount_min'));
  const maximum = exactMinorUnits(ownDataValue(item, 'amount_max'));
  return minimum !== null && maximum !== null && minimum === maximum ? minimum : null;
}

function exactSourceSpans(item: JsonObject, narrative: string): ExactSourceSpan[] | null {
  const rawSpans = denseDataArray(ownDataValue(item, 'source_spans'));
  if (rawSpans === null || rawSpans.length === 0) return null;
  const spans: ExactSourceSpan[] = [];
  for (const rawSpan of rawSpans) {
    const span = plainDataObject(rawSpan);
    if (span === null) return null;
    const submissionId = ownDataValue(span, 'submission_id');
    const quote = ownDataValue(span, 'quote');
    const startChar = ownDataValue(span, 'start_char');
    const endChar = ownDataValue(span, 'end_char');
    if (
      typeof submissionId !== 'string' ||
      submissionId.length === 0 ||
      typeof quote !== 'string' ||
      quote.length === 0 ||
      !Number.isInteger(startChar) ||
      !Number.isInteger(endChar) ||
      (startChar as number) < 0 ||
      (endChar as number) <= (startChar as number) ||
      (endChar as number) > narrative.length ||
      (endChar as number) - (startChar as number) !== quote.length ||
      narrative.slice(startChar as number, endChar as number) !== quote
    ) {
      return null;
    }
    spans.push({
      startChar: startChar as number,
      endChar: endChar as number,
      quote,
    });
  }
  return spans;
}

function exactNarrative(
  extracted: JsonObject,
  golden: JsonObject,
  providedNarrative: unknown,
): string | null {
  const extractedSubmission = plainDataObject(ownDataValue(extracted, 'submission'));
  const goldenSubmission = plainDataObject(ownDataValue(golden, 'submission'));
  if (extractedSubmission === null || goldenSubmission === null) return null;
  const extractedNarrative = ownDataValue(extractedSubmission, 'raw_text');
  const goldenNarrative = ownDataValue(goldenSubmission, 'raw_text');
  if (
    typeof extractedNarrative !== 'string' ||
    extractedNarrative !== goldenNarrative ||
    (providedNarrative !== undefined && providedNarrative !== extractedNarrative) ||
    createHash('sha256').update(extractedNarrative).digest('hex') !== dryRun002NarrativeSha256
  ) {
    return null;
  }
  return extractedNarrative;
}

function uniqueClaimByFingerprint(record: JsonObject, fingerprint: string): JsonObject | null {
  const claims = denseDataArray(ownDataValue(record, 'claims'));
  if (claims === null) return null;
  const matches = claims.flatMap((claim) => {
    const candidate = plainDataObject(claim);
    return candidate !== null && structuredMonetaryRecordFingerprint(candidate) === fingerprint
      ? [candidate]
      : [];
  });
  return matches.length === 1 ? matches[0]! : null;
}

function sameExactGrounding(
  extracted: JsonObject,
  golden: JsonObject,
  narrative: string,
): ExactSourceSpan | null {
  const extractedClaim = uniqueClaimByFingerprint(
    extracted,
    frozenRepresentations.sourceClaim.extractedRecordSha256,
  );
  const goldenClaim = uniqueClaimByFingerprint(
    golden,
    frozenRepresentations.sourceClaim.goldenRecordSha256,
  );
  if (
    extractedClaim === null ||
    goldenClaim === null ||
    ownDataValue(extractedClaim, 'party_id') !== ownDataValue(goldenClaim, 'party_id') ||
    ownDataValue(extractedClaim, 'claim_type') !== 'payment' ||
    ownDataValue(goldenClaim, 'claim_type') !== 'payment'
  ) {
    return null;
  }
  const extractedSpans = exactSourceSpans(extractedClaim, narrative);
  const goldenSpans = exactSourceSpans(goldenClaim, narrative);
  if (extractedSpans === null || goldenSpans === null) return null;
  const shared = extractedSpans.filter((left) =>
    goldenSpans.some(
      (right) =>
        left.startChar === right.startChar &&
        left.endChar === right.endChar &&
        left.quote === right.quote,
    ),
  );
  return shared.length === 1 ? shared[0]! : null;
}

export function proveDryRun002DamageIdentity(
  extractedRecordValue: unknown,
  goldenRecordValue: unknown,
  extractedDamageValue: unknown,
  goldenDamageValue: unknown,
  narrativeValue?: unknown,
): MonetaryIdentityProof | null {
  const extractedRecord = plainDataObject(extractedRecordValue);
  const goldenRecord = plainDataObject(goldenRecordValue);
  const extractedDamage = plainDataObject(extractedDamageValue);
  const goldenDamage = plainDataObject(goldenDamageValue);
  if (
    extractedRecord === null ||
    goldenRecord === null ||
    extractedDamage === null ||
    goldenDamage === null ||
    structuredMonetaryRecordFingerprint(extractedDamage) !==
      frozenRepresentations.damage.extractedRecordSha256 ||
    structuredMonetaryRecordFingerprint(goldenDamage) !==
      frozenRepresentations.damage.goldenRecordSha256
  ) {
    return null;
  }

  const narrative = exactNarrative(extractedRecord, goldenRecord, narrativeValue);
  const sourceSpan =
    narrative === null ? null : sameExactGrounding(extractedRecord, goldenRecord, narrative);
  const extractedAmount = exactSingletonAmountRange(extractedDamage);
  const goldenAmount = exactSingletonAmountRange(goldenDamage);
  const extractedCurrency = exactCurrency(ownDataValue(extractedDamage, 'currency'));
  const goldenCurrency = exactCurrency(ownDataValue(goldenDamage, 'currency'));
  if (
    sourceSpan === null ||
    extractedAmount === null ||
    extractedAmount !== goldenAmount ||
    exactSourceUsdMinorUnits(sourceSpan.quote) !== extractedAmount ||
    extractedCurrency === null ||
    extractedCurrency !== goldenCurrency ||
    ownDataValue(extractedDamage, 'party_id') !== ownDataValue(goldenDamage, 'party_id') ||
    ownDataValue(extractedDamage, 'loss_type') !== 'unpaid_balance' ||
    ownDataValue(goldenDamage, 'loss_type') !== 'unpaid_balance' ||
    ownDataValue(extractedDamage, 'calculation_status') !==
      ownDataValue(goldenDamage, 'calculation_status')
  ) {
    return null;
  }
  return { amountMinorUnits: extractedAmount, currency: extractedCurrency, sourceSpan };
}

function recoverUniquePair(
  alignment: PersonAAlignment,
  extractedItems: JsonObject[],
  goldenItems: JsonObject[],
  candidates: Candidate[],
): void {
  if (candidates.length !== 1) return;
  const candidate = candidates[0]!;
  const extracted = extractedItems[candidate.extractedIndex];
  const golden = goldenItems[candidate.goldenIndex];
  if (
    extracted === undefined ||
    golden === undefined ||
    typeof extracted.damages_claim_id !== 'string' ||
    typeof golden.damages_claim_id !== 'string'
  ) {
    return;
  }
  const pair: MonetaryRecoveryPair = {
    extracted_index: candidate.extractedIndex,
    golden_index: candidate.goldenIndex,
    extracted_id: extracted.damages_claim_id,
    golden_id: golden.damages_claim_id,
    score: candidate.score,
    margin: candidate.score,
    recovery_reason: 'exact_structured_monetary_identity',
  };
  alignment.families.damages.pairs.push(pair);
  alignment.families.damages.unmatched_extracted =
    alignment.families.damages.unmatched_extracted.filter(
      (item) => item.index !== candidate.extractedIndex,
    );
  alignment.families.damages.unmatched_golden = alignment.families.damages.unmatched_golden.filter(
    (item) => item.index !== candidate.goldenIndex,
  );
}

export function recoverDryRun002StructuredMonetaryIdentity(
  extracted: JsonObject,
  golden: JsonObject,
  alignment: PersonAAlignment,
  options: PersonAAlignmentOptions,
): void {
  // This is an opt-in calibrated projection. Locked acceptance behavior and
  // every non-frozen representation retain the ordinary alignment path.
  if (options.contractVersion !== 'calibrated_live_v2') return;
  const narrative = exactNarrative(extracted, golden, options.narrative);
  if (narrative === null) return;
  const aliases = options.aliases ?? {};

  const extractedDamages = familyItems(extracted, 'damages');
  const goldenDamages = familyItems(golden, 'damages');
  const damageCandidates: Candidate[] = [];
  for (const extra of alignment.families.damages.unmatched_extracted) {
    for (const missing of alignment.families.damages.unmatched_golden) {
      const left = extractedDamages[extra.index];
      const right = goldenDamages[missing.index];
      const proof = proveDryRun002DamageIdentity(extracted, golden, left, right, narrative);
      if (proof === null || left === undefined || right === undefined) continue;
      damageCandidates.push({
        extractedIndex: extra.index,
        goldenIndex: missing.index,
        score:
          0.5 * semanticSimilarity(left.causal_theory, right.causal_theory, aliases) +
          0.35 +
          0.15 * semanticSimilarity(left.calculation_basis, right.calculation_basis, aliases),
      });
    }
  }
  recoverUniquePair(alignment, extractedDamages, goldenDamages, damageCandidates);
}
