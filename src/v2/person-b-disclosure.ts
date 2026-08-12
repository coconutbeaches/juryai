import {
  cloneCanonical,
  validateCaseEnvelope,
  type CaseEnvelope,
  type EvidenceObject,
} from './case-envelope.js';

export const PERSON_B_DISCLOSURE_VIEW_VERSION = 'juryai-person-b-disclosure-view-v2.0.0';

export interface PersonBDisclosureView {
  view_version: typeof PERSON_B_DISCLOSURE_VIEW_VERSION;
  case_id: string;
  envelope_version: number;
  envelope_hash: string;
  classification: Pick<
    CaseEnvelope['classification'],
    'case_category' | 'suitability' | 'maturity'
  >;
  person_b: CaseEnvelope['parties']['party_b'];
  invitation_event_id: string | null;
  disclosure_state: CaseEnvelope['formation']['disclosure'];
  detailed_record: null | {
    actors: CaseEnvelope['actors'];
    agreements: CaseEnvelope['agreements'];
    events: CaseEnvelope['events'];
    payments: CaseEnvelope['payments'];
    deliverables: CaseEnvelope['deliverables'];
    positions: CaseEnvelope['positions'];
    claimed_losses: CaseEnvelope['claimed_losses'];
    requested_outcomes: CaseEnvelope['requested_outcomes'];
    evidence: Record<string, EvidenceObject>;
  };
}

/**
 * Builds the only v2 record view that may be shown to Person B. Before the
 * independent account and the separate disclosure event, detailed A framing
 * is structurally absent rather than merely hidden by prompt instructions.
 */
export function buildPersonBDisclosureView(envelope: CaseEnvelope): PersonBDisclosureView {
  if (validateCaseEnvelope(envelope).length > 0) {
    throw new TypeError('Person B disclosure requires an exact valid Case Envelope.');
  }
  const disclosed = envelope.formation.disclosure.detailed_a_framing === 'disclosed';
  const evidence = Object.fromEntries(
    Object.entries(envelope.evidence)
      .filter(([, item]) => item.visibility === 'disclosed_to_both')
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return cloneCanonical({
    view_version: PERSON_B_DISCLOSURE_VIEW_VERSION,
    case_id: envelope.control.case_id,
    envelope_version: envelope.control.envelope_version,
    envelope_hash: envelope.control.envelope_hash,
    classification: {
      case_category: envelope.classification.case_category,
      suitability: envelope.classification.suitability,
      maturity: envelope.classification.maturity,
    },
    person_b: envelope.parties.party_b,
    invitation_event_id: envelope.formation.non_participation.invitation_event_id,
    disclosure_state: envelope.formation.disclosure,
    detailed_record: disclosed
      ? {
          actors: envelope.actors,
          agreements: envelope.agreements,
          events: envelope.events,
          payments: envelope.payments,
          deliverables: envelope.deliverables,
          positions: envelope.positions,
          claimed_losses: envelope.claimed_losses,
          requested_outcomes: envelope.requested_outcomes,
          evidence,
        }
      : null,
  });
}
