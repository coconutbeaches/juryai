import { applyDryRun001ClA003CompatibilityRecovery } from './person-a-dry-run-001-cl-a-003-compatibility-recovery.js';
import {
  assemblePersonAExtraction,
  type AssemblePersonAExtractionOptions,
} from './person-a-extractor.js';

type JsonObject = Record<string, any>;

/**
 * Build the corrected deterministic projection for the frozen Dry Run 001
 * cl_a_003 omission.
 *
 * The artifact boundary is explicit:
 * 1. the frozen provider response is immutable input;
 * 2. the historical assembled extraction is immutable and is not produced here;
 * 3. this function returns a corrected compatibility projection only; and
 * 4. future live extraction continues through extractPersonA and normal assembly,
 *    neither of which imports or invokes this module.
 *
 * The projection applies the narrowly bounded claim-family recovery and then
 * runs ordinary assembly and validation. It never rewrites either historical
 * artifact.
 */
export function assembleDryRun001ClA003CompatibilityProjection(
  frozenModelOutput: JsonObject,
  options: AssemblePersonAExtractionOptions,
): JsonObject {
  const projectedModelOutput = applyDryRun001ClA003CompatibilityRecovery(
    frozenModelOutput,
    options.narrative,
  );
  return assemblePersonAExtraction(projectedModelOutput, options);
}
