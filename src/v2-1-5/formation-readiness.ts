import * as shared from '../formation/readiness.js';
import { V215_SPEC } from './generation-spec.js';
type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never;
export const authoritativeFormationExplanatoryStateV215 = (
  ...args: Tail<Parameters<typeof shared.authoritativeFormationExplanatoryState>>
) => shared.authoritativeFormationExplanatoryState(V215_SPEC, ...args);
export const deriveFormationReadinessV215 = (
  ...args: Tail<Parameters<typeof shared.deriveFormationReadiness>>
) => shared.deriveFormationReadiness(V215_SPEC, ...args);
export type { FormationReadiness as FormationReadinessV215 } from '../formation/readiness.js';
