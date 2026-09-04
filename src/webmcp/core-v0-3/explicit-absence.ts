import type { EpistemicStrength } from './types.js';
import type { TurnSpan } from '../core/turns.js';

export const EXPLICIT_ABSENCE_DEFINITION =
  'The attributed party affirmatively asserts that the fact, obligation, event, amount, item, or condition asked about does not exist, did not occur, or is none/zero where that is a meaningful direct answer to the requirement.';

/** Mechanical provenance guard, not a semantic classifier or readiness judgment.
 * Keeping the whole answer prevents selecting only a date/positive fragment
 * while dropping denial, uncertainty or attribution. Semantic support remains
 * the versioned compiler's responsibility and is evaluated separately.
 */
export function hasExplicitAbsenceSource(
  answer: string,
  spans: readonly TurnSpan[],
  strength: EpistemicStrength,
): boolean {
  return (
    answer.trim().length > 0 &&
    strength !== 'non_recollection' &&
    strength !== 'declined' &&
    spans.some(
      (span) =>
        span.region === 'answer' &&
        span.message_index === null &&
        span.start === 0 &&
        span.end === answer.length &&
        span.quote === answer,
    )
  );
}
