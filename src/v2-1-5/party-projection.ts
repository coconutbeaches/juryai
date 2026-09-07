import * as shared from '../formation/projection.js';
import { V215_SPEC } from './generation-spec.js';
type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never;
export const projectPartyFormationV215 = (
  ...args: Tail<Parameters<typeof shared.projectPartyFormation>>
) => shared.projectPartyFormation(V215_SPEC, ...args);
export const serializePartyFormationProjectionV215 = (
  ...args: Tail<Parameters<typeof shared.serializePartyFormationProjection>>
) => shared.serializePartyFormationProjection(V215_SPEC, ...args);
export const hashPartyFormationProjectionV215 = (
  ...args: Tail<Parameters<typeof shared.hashPartyFormationProjection>>
) => shared.hashPartyFormationProjection(V215_SPEC, ...args);
export const renderPartyFormationReadbackV215 = (
  ...args: Tail<Parameters<typeof shared.renderPartyFormationReadback>>
) => shared.renderPartyFormationReadback(V215_SPEC, ...args);
export const currentPartyConfirmationV215 = (
  ...args: Tail<Parameters<typeof shared.currentPartyConfirmation>>
) => shared.currentPartyConfirmation(V215_SPEC, ...args);
export type { PartyVisiblePosition as PartyVisiblePositionV215 } from '../formation/projection.js';
export type { PartyVisibleRequirement as PartyVisibleRequirementV215 } from '../formation/projection.js';
export type { PartyVisibleClarification as PartyVisibleClarificationV215 } from '../formation/projection.js';
export type { PartyVisibleChallengeResponse as PartyVisibleChallengeResponseV215 } from '../formation/projection.js';
export type { PartyVisibleChallenge as PartyVisibleChallengeV215 } from '../formation/projection.js';
export type { PartyScopedFormationProjection as PartyScopedFormationProjectionV215 } from '../formation/projection.js';
export type { PartyFormationReadback as PartyFormationReadbackV215 } from '../formation/projection.js';
