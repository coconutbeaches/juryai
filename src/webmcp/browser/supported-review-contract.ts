import {
  decodeFirstPartyReviewV212,
  type ParsedFirstPartyReviewV212,
} from './v2-1-2-review-contract.js';
import {
  decodeFirstPartyReviewV213,
  type ParsedFirstPartyReviewV213,
} from './v2-1-3-review-contract.js';
export type ParsedFormationReview = ParsedFirstPartyReviewV212 | ParsedFirstPartyReviewV213;
export function decodeFormationReview(value: unknown): ParsedFormationReview {
  if (
    typeof value === 'object' &&
    value !== null &&
    'review_page_version' in value &&
    value.review_page_version === 'juryai-v2.1.3-first-party-review-page-v1.0.0'
  )
    return decodeFirstPartyReviewV213(value);
  return decodeFirstPartyReviewV212(value);
}
