import { canonicalSerialize, sha256 } from '../v2/case-envelope.js';
import type { InitialFormationRequirements } from '../formation/ceremony.js';
import type { RequirementDefinition } from '../webmcp/core-v0-3/requirements.js';
import { initialRequirementSet as artifact } from '../v2-1-4/initial-requirements.js';
import { V215_SPEC } from './generation-spec.js';

/** One immutable definition source, addressed by its canonical content hash. */
export function assertRequirementArtifact(
  definitions: readonly RequirementDefinition[],
  expectedHash = V215_SPEC.requirements.artifact_hash,
): void {
  if (sha256(canonicalSerialize(definitions as never)) !== expectedHash) {
    throw new TypeError('Requirement artifact differs from the generation binding.');
  }
}

const definitions = artifact();
assertRequirementArtifact(definitions);

export function initialRequirementSet(): RequirementDefinition[] {
  return structuredClone(definitions);
}

export function initialFormationRequirements(): InitialFormationRequirements {
  const forParty = (party: 'party_a' | 'party_b') =>
    initialRequirementSet().map((definition) => ({
      ...definition,
      requirement_id: `req_${party}_${definition.requirement_id.replace(/^req_/u, '')}`,
      label: definition.requirement_id,
      required: true,
    }));
  return { party_a: forParty('party_a'), party_b: forParty('party_b') };
}

export function exactPersistedRequirements() {
  const initial = initialFormationRequirements();
  return Object.fromEntries(
    (['party_a', 'party_b'] as const).flatMap((party_id) =>
      initial[party_id].map((requirement) => [
        requirement.requirement_id,
        { ...requirement, party_id },
      ]),
    ),
  );
}

/** Bind the executed party mapping as well as its immutable definition source. */
export function assertPersistedRequirementArtifact(
  requirements: ReturnType<typeof exactPersistedRequirements>,
): void {
  if (sha256(canonicalSerialize(requirements)) !== V215_SPEC.requirements.persisted_artifact_hash) {
    throw new TypeError('Persisted requirement artifact differs from the generation binding.');
  }
}
