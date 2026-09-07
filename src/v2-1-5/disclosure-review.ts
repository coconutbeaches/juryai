import * as shared from '../formation/disclosure-review.js';
import { V215_SPEC } from './generation-spec.js';
type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never;
export const currentDisclosureReviewAcknowledgmentV215 = (
  ...args: Tail<Parameters<typeof shared.currentDisclosureReviewAcknowledgment>>
) => shared.currentDisclosureReviewAcknowledgment(V215_SPEC, ...args);
export const disclosureReviewClosureCurrentV215 = (
  ...args: Tail<Parameters<typeof shared.disclosureReviewClosureCurrent>>
) => shared.disclosureReviewClosureCurrent(V215_SPEC, ...args);
