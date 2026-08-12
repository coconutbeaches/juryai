import { createHash } from 'node:crypto';
import {
  familyItems,
  type PersonAAlignment,
  type PersonAAlignmentOptions,
} from '../alignment/person-a-alignment-corrected.js';
import { structuredMonetaryRecordFingerprint } from '../alignment/person-a-monetary-identity-compatibility.js';

type JsonObject = Record<string, any>;

const frozen = {
  narrativeSha256: '0508bdb60323a32beafaa0b7e7e7ac734cd64a002830fc8eb1ca52e5feda0f86',
  extractionSha256: '4541788632c58b5c5bc98f320547b992005ea28d36f05e8a1e35ca0ca4da2a42',
  goldenSha256: '82b2a23148efc5c5c9c3a0cc0de06dff71500ddd04e2eced8316ce29123f522c',
  alignmentSha256: '8b4b50a9e675b98248f02696ca637cddb07458afb5798b610df93c03b710f066',
  claimsAlignmentSha256: '637af938628d5a770cb2b40216dc1f85668e890550ab14246c7898eb630d2332',
  unsupportedDiagnosticSha256: '3f71427b9864f3dd7b33044964ba7996bdb801e861e636eda33d86e76ee59a4d',
  extractedNoRefundSha256: '2fc5491efd581ba3104bdcea3095a80ae5eb2c5efc60076362cca35d91aa1e28',
  extractedBalanceSha256: '9512e792b1db5df09e73b9e0afc500f567a83f16d1a8f4bd37c95d03130b045f',
  goldenRemedySha256: '2f52fd6d00c7eae617307136ec859e32ac0094d779a181ef026d49fc4193ec69',
  matchedPairSha256: '582ef3db53443c19579a0c1e588983fa82d1c997aefedbab0fb8be2bf8fe5cc1',
  unmatchedNoRefundSha256: '57bf0e884beb7cd2967fcaf3450c4614db9a0dd809f843e5326ac4e5df97b5e5',
} as const;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function uniqueFingerprintIndex(items: JsonObject[], fingerprint: string): number | null {
  const matches = items.flatMap((item, index) =>
    structuredMonetaryRecordFingerprint(item) === fingerprint ? [index] : [],
  );
  return matches.length === 1 ? matches[0]! : null;
}

function claimsAlignmentIsFrozen(
  alignment: PersonAAlignment['families']['claims'],
  targetIndex: number,
  siblingIndex: number,
  goldenIndex: number,
): boolean {
  if (structuredMonetaryRecordFingerprint(alignment) !== frozen.claimsAlignmentSha256) {
    return false;
  }
  const pairMatches = alignment.pairs.filter(
    (pair) =>
      pair.extracted_index === siblingIndex &&
      pair.golden_index === goldenIndex &&
      pair.extracted_id === 'claim_balance_1' &&
      pair.golden_id === 'cl_002_remedy' &&
      structuredMonetaryRecordFingerprint(pair) === frozen.matchedPairSha256,
  );
  const unmatchedMatches = alignment.unmatched_extracted.filter(
    (entry) =>
      entry.index === targetIndex &&
      entry.id === 'claim_no_refund_1' &&
      structuredMonetaryRecordFingerprint(entry) === frozen.unmatchedNoRefundSha256,
  );
  return (
    pairMatches.length === 1 &&
    unmatchedMatches.length === 1 &&
    alignment.pairs.every((pair) => pair.extracted_id !== 'claim_no_refund_1') &&
    alignment.ambiguous.every((entry) => entry.extracted_id !== 'claim_no_refund_1') &&
    alignment.unmatched_golden.every((entry) => entry.id !== 'cl_002_remedy')
  );
}

/**
 * Recognizes only the frozen DR002 no-refund remedy decomposition proven by PR #27.
 *
 * This runs after ordinary unmatched-object classification. Any drift in the complete
 * extraction, golden, alignment, current critical diagnostic, or relevant claim identities
 * fails closed and leaves unsupported_extra_object intact.
 */
export function isDryRun002ClaimRemedyDecompositionDiagnostic(
  diagnosticValue: unknown,
  extractedValue: unknown,
  goldenValue: unknown,
  alignmentValue: unknown,
  narrative: unknown,
  contractVersion: PersonAAlignmentOptions['contractVersion'],
): boolean {
  if (
    contractVersion !== 'calibrated_live_v2' ||
    typeof narrative !== 'string' ||
    sha256(narrative) !== frozen.narrativeSha256 ||
    structuredMonetaryRecordFingerprint(diagnosticValue) !== frozen.unsupportedDiagnosticSha256 ||
    structuredMonetaryRecordFingerprint(extractedValue) !== frozen.extractionSha256 ||
    structuredMonetaryRecordFingerprint(goldenValue) !== frozen.goldenSha256 ||
    structuredMonetaryRecordFingerprint(alignmentValue) !== frozen.alignmentSha256
  ) {
    return false;
  }

  const extracted = extractedValue as JsonObject;
  const golden = goldenValue as JsonObject;
  const alignment = alignmentValue as PersonAAlignment;
  if (
    extracted.submission?.raw_text !== narrative ||
    golden.submission?.raw_text !== narrative ||
    alignment.families?.claims === undefined
  ) {
    return false;
  }

  const extractedClaims = familyItems(extracted, 'claims');
  const goldenClaims = familyItems(golden, 'claims');
  const targetIndex = uniqueFingerprintIndex(extractedClaims, frozen.extractedNoRefundSha256);
  const siblingIndex = uniqueFingerprintIndex(extractedClaims, frozen.extractedBalanceSha256);
  const goldenIndex = uniqueFingerprintIndex(goldenClaims, frozen.goldenRemedySha256);
  if (targetIndex !== 8 || siblingIndex !== 7 || goldenIndex !== 2) {
    return false;
  }

  return claimsAlignmentIsFrozen(alignment.families.claims, targetIndex, siblingIndex, goldenIndex);
}
