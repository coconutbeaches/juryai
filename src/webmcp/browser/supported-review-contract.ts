import {
  decodeFirstPartyReviewV212,
  type ParsedFirstPartyReviewV212,
} from './v2-1-2-review-contract.js';
import {
  decodeFirstPartyReviewV213,
  type ParsedFirstPartyReviewV213,
} from './v2-1-3-review-contract.js';
import {
  decodeFirstPartyReviewV214,
  type ParsedFirstPartyReviewV214,
} from './v2-1-4-review-contract.js';
export type ParsedFormationReview =
  ParsedFirstPartyReviewV212 | ParsedFirstPartyReviewV213 | ParsedFirstPartyReviewV214;

/**
 * Decoding dispatches on the page's own declared contract version, never on a
 * dispute-id prefix: the prefix names a persistence family, not a semantic
 * generation. A page whose version is unrecognised falls back to V2.1.2, which
 * then fails its own structural decode rather than being silently misread.
 */
export function decodeFormationReview(value: unknown): ParsedFormationReview {
  if (typeof value === 'object' && value !== null && 'review_page_version' in value) {
    if (value.review_page_version === 'juryai-v2.1.4-first-party-review-page-v1.0.0')
      return decodeFirstPartyReviewV214(value);
    if (value.review_page_version === 'juryai-v2.1.3-first-party-review-page-v1.0.0')
      return decodeFirstPartyReviewV213(value);
  }
  return decodeFirstPartyReviewV212(value);
}
