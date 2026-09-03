import type { CaseEnvelopeV211, PartyIdV211 } from '../v2-1-1/case-envelope.js';
import {
  currentPartyConfirmationV211,
  hashPartyFormationProjectionV211,
  projectPartyFormationV211,
  renderPartyFormationReadbackV211,
  serializePartyFormationProjectionV211,
} from '../v2-1-1/party-projection.js';
import type { CaseEnvelopeV212, PartyIdV212 } from './case-envelope.js';

/**
 * Disclosure-review history is intentionally absent from the frozen semantic
 * formation projection/read-back. This read-only structural view keeps their
 * V2.1.1 bytes, hashes, and visible-version semantics unchanged.
 */
function frozenProjectionViewV211(envelope: CaseEnvelopeV212): CaseEnvelopeV211 {
  return envelope as unknown as CaseEnvelopeV211;
}

export function projectPartyFormationV212(envelope: CaseEnvelopeV212, partyId: PartyIdV212) {
  return projectPartyFormationV211(frozenProjectionViewV211(envelope), partyId as PartyIdV211);
}

export function serializePartyFormationProjectionV212(
  envelope: CaseEnvelopeV212,
  partyId: PartyIdV212,
): string {
  return serializePartyFormationProjectionV211(
    frozenProjectionViewV211(envelope),
    partyId as PartyIdV211,
  );
}

export function hashPartyFormationProjectionV212(
  envelope: CaseEnvelopeV212,
  partyId: PartyIdV212,
): string {
  return hashPartyFormationProjectionV211(
    frozenProjectionViewV211(envelope),
    partyId as PartyIdV211,
  );
}

export function renderPartyFormationReadbackV212(envelope: CaseEnvelopeV212, partyId: PartyIdV212) {
  return renderPartyFormationReadbackV211(
    frozenProjectionViewV211(envelope),
    partyId as PartyIdV211,
  );
}

export function currentPartyConfirmationV212(envelope: CaseEnvelopeV212, partyId: PartyIdV212) {
  return currentPartyConfirmationV211(frozenProjectionViewV211(envelope), partyId as PartyIdV211);
}

export type {
  PartyFormationReadbackV211,
  PartyScopedFormationProjectionV211,
} from '../v2-1-1/party-projection.js';
