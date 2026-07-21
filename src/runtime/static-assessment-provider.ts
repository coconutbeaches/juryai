import type { RuntimeAssessmentProvider } from './person-a-runtime-orchestrator.js';

/**
 * Offline fixture adapter for deterministic tests and CLI planning. It is not a
 * production assessment engine and deliberately performs no I/O or inference.
 */
export function createStaticRuntimeAssessmentProvider(
  assessments: unknown,
): RuntimeAssessmentProvider {
  const snapshot = structuredClone(assessments);
  return {
    assess: () => structuredClone(snapshot),
  };
}
