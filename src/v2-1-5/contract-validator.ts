import { canonicalSerialize } from '../v2/case-envelope.js';
import { createFormationValidator, type FormationValidator } from '../formation/validator.js';
import { V215_SPEC } from './generation-spec.js';
import {
  exactPersistedRequirements,
  assertPersistedRequirementArtifact,
} from './initial-requirements.js';

const shared = createFormationValidator({ spec: V215_SPEC });
const requirements = exactPersistedRequirements();
assertPersistedRequirementArtifact(requirements);
const boundRequirements = canonicalSerialize(requirements);

/** The persisted schema selects this exact requirement artifact on every read/write. */
export const validator: FormationValidator = {
  validate(envelope) {
    const issues = shared.validate(envelope);
    if (
      issues.length === 0 &&
      canonicalSerialize((envelope as { requirements: never }).requirements) !== boundRequirements
    ) {
      issues.push({
        code: 'v215_requirement_artifact_mismatch',
        path: 'envelope.requirements',
        message: 'Persisted requirements differ from the generation artifact.',
      });
    }
    return issues;
  },
  assertValid(envelope) {
    const issues = this.validate(envelope);
    if (issues.length) throw new TypeError(issues.map((issue) => issue.code).join(', '));
  },
};
export const validateCaseEnvelopeV215 = validator.validate.bind(validator);
export const assertValidCaseEnvelopeV215 = validator.assertValid.bind(validator);
