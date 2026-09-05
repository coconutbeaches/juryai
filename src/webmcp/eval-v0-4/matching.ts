/**
 * Deterministic one-to-one matching between expected and actual assertions.
 *
 * Under V0.4 two expectations may share requirement, type and epistemic
 * strength, so "which expectation does this assertion satisfy" stops being a
 * lookup and becomes an assignment problem. Two properties are load-bearing:
 *
 *  - ONE-TO-ONE. An actual assertion satisfies at most one expectation, and an
 *    expectation is satisfied by at most one assertion. Without this a single
 *    merged assertion carrying both facts would satisfy both expectations and
 *    score green — which is exactly the failure the multi-live model exists to
 *    make visible.
 *  - ORDER-INDEPENDENT. Greedy first-match makes the verdict depend on array
 *    order whenever two same-slot expectations overlap in their constraints: a
 *    permissive expectation can consume the only assertion a stricter one could
 *    have used, and the run passes or fails according to how the fixture was
 *    typed. So this computes a MAXIMUM matching, and canonicalises the order of
 *    both sides first so the chosen matching is itself reproducible.
 *
 * The algorithm is Kuhn's augmenting-path method. Inputs here are a handful of
 * items, so its O(V·E) cost is irrelevant and its determinism is not.
 */

/** Compatibility oracle: may `actual` satisfy `expected`? */
export type Compatible = (expectedIndex: number, actualIndex: number) => boolean;

export interface MatchingResult {
  /** actualIndex for each expectation, or null when unmatched. */
  readonly assignment: readonly (number | null)[];
  /** Expectation indices with no compatible unclaimed assertion. */
  readonly unmatchedExpected: readonly number[];
  /** Actual indices not used by any expectation. */
  readonly unmatchedActual: readonly number[];
}

/**
 * Maximum bipartite matching over a canonical ordering of both sides.
 *
 * Callers pass indices already sorted into a canonical order; this function
 * then visits them in that order, so the same SET of expectations and
 * assertions always yields the same matching regardless of how the arrays were
 * written.
 */
export function matchOneToOne(
  expectedCount: number,
  actualCount: number,
  compatible: Compatible,
): MatchingResult {
  const assignedExpectedFor: (number | null)[] = Array.from({ length: actualCount }, () => null);

  const augment = (expectedIndex: number, visited: boolean[]): boolean => {
    for (let actualIndex = 0; actualIndex < actualCount; actualIndex += 1) {
      if (visited[actualIndex] || !compatible(expectedIndex, actualIndex)) continue;
      visited[actualIndex] = true;
      const holder = assignedExpectedFor[actualIndex];
      if (holder === null || holder === undefined || augment(holder, visited)) {
        assignedExpectedFor[actualIndex] = expectedIndex;
        return true;
      }
    }
    return false;
  };

  for (let expectedIndex = 0; expectedIndex < expectedCount; expectedIndex += 1) {
    augment(
      expectedIndex,
      Array.from({ length: actualCount }, () => false),
    );
  }

  const assignment: (number | null)[] = Array.from({ length: expectedCount }, () => null);
  for (let actualIndex = 0; actualIndex < actualCount; actualIndex += 1) {
    const expectedIndex = assignedExpectedFor[actualIndex];
    if (expectedIndex !== null && expectedIndex !== undefined) {
      assignment[expectedIndex] = actualIndex;
    }
  }

  return {
    assignment,
    unmatchedExpected: assignment
      .map((actualIndex, expectedIndex) => (actualIndex === null ? expectedIndex : -1))
      .filter((index) => index >= 0),
    unmatchedActual: assignedExpectedFor
      .map((expectedIndex, actualIndex) => (expectedIndex === null ? actualIndex : -1))
      .filter((index) => index >= 0),
  };
}
