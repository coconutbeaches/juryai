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
  unsupportedDiagnosticSha256: 'd5013941b000a20e9931e80bfc88b5717428c0954cfad1fd69eff4e0182e3020',
  extractedPriceTermSha256: 'ff6234474986c1e5f12e7795e28fdf3d4a46285aa0e45d128799784adc6618ec',
  extractedScopeTermSha256: '4777f3b6da8675168096211a5957cb95aecb0ee05b647d2f330341654dc0ee10',
  goldenConsolidatedTermSha256: 'e436b07d1c65e47a46152fa2691be91d272d93b70204506a0fed4175a19197f4',
  agreementAlignmentSha256: 'ccc69ef0a97751016c8f224e2cecc77b3c33d7d2b8216ce848a153a15ef46c97',
  matchedPairSha256: '39302e2ce67a22b766973ab8ab241ebd52f9fa1c36b406c70fc97f4d5543d30c',
  unmatchedPriceSha256: 'b6519aa38eb2a95b4022a276783e89b76915e89740a47038cc460e549f68b13a',
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

function relevantAlignmentIsFrozen(
  alignment: PersonAAlignment['families']['agreement_terms'],
  extractedPriceIndex: number,
  extractedScopeIndex: number,
  goldenIndex: number,
): boolean {
  if (structuredMonetaryRecordFingerprint(alignment) !== frozen.agreementAlignmentSha256) {
    return false;
  }
  const pairMatches = alignment.pairs.filter(
    (pair) =>
      pair.extracted_index === extractedScopeIndex &&
      pair.golden_index === goldenIndex &&
      pair.extracted_id === 'term_scope_1' &&
      pair.golden_id === 'term_dry_run_002' &&
      structuredMonetaryRecordFingerprint(pair) === frozen.matchedPairSha256,
  );
  const unmatchedMatches = alignment.unmatched_extracted.filter(
    (entry) =>
      entry.index === extractedPriceIndex &&
      entry.id === 'term_price_1' &&
      structuredMonetaryRecordFingerprint(entry) === frozen.unmatchedPriceSha256,
  );
  return (
    pairMatches.length === 1 &&
    unmatchedMatches.length === 1 &&
    alignment.pairs.every((pair) => pair.extracted_id !== 'term_price_1') &&
    alignment.ambiguous.every((entry) => entry.extracted_id !== 'term_price_1') &&
    alignment.unmatched_golden.every((entry) => entry.id !== 'term_dry_run_002')
  );
}

/**
 * Recognizes only the frozen DR002 price-component diagnostic proven by PR #25.
 *
 * This runs after ordinary unmatched-object classification. Any drift in the
 * current critical diagnostic, narrative, complete records, or relevant
 * alignment identity fails closed and leaves unsupported_extra_object intact.
 */
export function isDryRun002AgreementTermDecompositionDiagnostic(
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
    structuredMonetaryRecordFingerprint(extractedValue) === null ||
    structuredMonetaryRecordFingerprint(goldenValue) === null ||
    structuredMonetaryRecordFingerprint(alignmentValue) === null
  ) {
    return false;
  }

  const extracted = extractedValue as JsonObject;
  const golden = goldenValue as JsonObject;
  const alignment = alignmentValue as PersonAAlignment;
  if (
    extracted.submission?.raw_text !== narrative ||
    golden.submission?.raw_text !== narrative ||
    alignment.families?.agreement_terms === undefined
  ) {
    return false;
  }

  const extractedTerms = familyItems(extracted, 'agreement_terms');
  const goldenTerms = familyItems(golden, 'agreement_terms');
  const extractedPriceIndex = uniqueFingerprintIndex(
    extractedTerms,
    frozen.extractedPriceTermSha256,
  );
  const extractedScopeIndex = uniqueFingerprintIndex(
    extractedTerms,
    frozen.extractedScopeTermSha256,
  );
  const goldenIndex = uniqueFingerprintIndex(goldenTerms, frozen.goldenConsolidatedTermSha256);
  if (
    extractedPriceIndex === null ||
    extractedScopeIndex === null ||
    goldenIndex === null ||
    extractedPriceIndex !== 1 ||
    extractedScopeIndex !== 0 ||
    goldenIndex !== 0
  ) {
    return false;
  }

  return relevantAlignmentIsFrozen(
    alignment.families.agreement_terms,
    extractedPriceIndex,
    extractedScopeIndex,
    goldenIndex,
  );
}
