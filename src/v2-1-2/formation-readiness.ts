import { cloneCanonical } from '../v2/case-envelope.js';
import {
  FORMATION_READINESS_VERSION_V212,
  PARTY_IDS_V212,
  type CaseEnvelopeV212,
  type FormationExplanatoryStateV211,
  type PartyIdV212,
} from './case-envelope.js';
import { currentDisclosureReviewAcknowledgmentV212 } from './disclosure-review.js';
import {
  derivePartyIndependentFormationCompleteV212,
  evaluateFormationRequirementV212,
} from './formation-requirements.js';
import { currentPartyConfirmationV212 } from './party-projection.js';

export interface FormationReadinessV212 {
  readiness_version: typeof FORMATION_READINESS_VERSION_V212;
  ready_for_bilateral_lock: boolean;
  blockers: string[];
  open_required_fields: string[];
  independent_formation_prerequisites: string[];
  disclosure_prerequisites: string[];
  disclosure_review_prerequisites: string[];
  workflow_prerequisites: string[];
  open_required_challenges: string[];
  ineligible_required_evidence: string[];
  required_current_confirmations: PartyIdV212[];
  explanatory_consistency_issues: string[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function authoritativeReadinessParts(envelope: CaseEnvelopeV212) {
  const openRequiredFields = Object.values(envelope.requirements)
    .filter(
      (requirement) =>
        requirement.required &&
        evaluateFormationRequirementV212(envelope, requirement).status !== 'satisfied',
    )
    .map((requirement) => requirement.requirement_id)
    .sort();
  const independentFormationPrerequisites = PARTY_IDS_V212.filter(
    (partyId) => !derivePartyIndependentFormationCompleteV212(envelope, partyId),
  ).map((partyId) => `${partyId}_independent_formation_incomplete`);
  const disclosurePrerequisites =
    envelope.control.disclosure_state === 'disclosed' ? [] : ['controlled_disclosure_incomplete'];
  const disclosureReviewPrerequisites = PARTY_IDS_V212.filter(
    (partyId) => currentDisclosureReviewAcknowledgmentV212(envelope, partyId) === null,
  ).map((partyId) => `${partyId}_disclosure_review_acknowledgment_missing_or_stale`);
  const workflowPrerequisites = ['final_confirmation', 'ready_for_lock'].includes(
    envelope.control.workflow_state,
  )
    ? []
    : ['final_confirmation_state_required'];
  const openRequiredChallenges = Object.values(envelope.challenges)
    .filter((challenge) => challenge.status === 'open')
    .map((challenge) => challenge.challenge_id)
    .sort();
  const ineligibleRequiredEvidence = Object.values(envelope.evidence)
    .filter(
      (evidence) =>
        evidence.required_for_readiness &&
        !['eligible', 'not_required'].includes(evidence.eligibility),
    )
    .map((evidence) => evidence.evidence_id)
    .sort();
  const requiredCurrentConfirmations = PARTY_IDS_V212.filter(
    (partyId) => currentPartyConfirmationV212(envelope, partyId) === null,
  );
  const partyBindingBlockers = PARTY_IDS_V212.filter(
    (partyId) =>
      envelope.parties[partyId].identity_assurance !== 'authenticated' ||
      !envelope.parties[partyId].authenticated_subject_id,
  ).map((partyId) => `${partyId}_unbound`);
  const duplicatePrincipal =
    envelope.parties.party_a.authenticated_subject_id !== null &&
    envelope.parties.party_b.authenticated_subject_id !== null &&
    envelope.parties.party_a.authenticated_subject_id ===
      envelope.parties.party_b.authenticated_subject_id
      ? ['duplicate_authenticated_subject']
      : [];
  const authoritativeBlockers = sortedUnique([
    ...partyBindingBlockers,
    ...duplicatePrincipal,
    ...openRequiredFields.map((requirementId) => `required_field_open:${requirementId}`),
    ...independentFormationPrerequisites,
    ...disclosurePrerequisites,
    ...disclosureReviewPrerequisites,
    ...workflowPrerequisites,
    ...openRequiredChallenges.map((challengeId) => `required_challenge_open:${challengeId}`),
    ...ineligibleRequiredEvidence.map((evidenceId) => `required_evidence_ineligible:${evidenceId}`),
    ...requiredCurrentConfirmations.map((partyId) => `${partyId}_confirmation_missing_or_stale`),
  ]);
  return {
    authoritative_blockers: authoritativeBlockers,
    open_required_fields: openRequiredFields,
    independent_formation_prerequisites: independentFormationPrerequisites,
    disclosure_prerequisites: disclosurePrerequisites,
    disclosure_review_prerequisites: disclosureReviewPrerequisites,
    workflow_prerequisites: workflowPrerequisites,
    open_required_challenges: openRequiredChallenges,
    ineligible_required_evidence: ineligibleRequiredEvidence,
    required_current_confirmations: requiredCurrentConfirmations,
  };
}

export function authoritativeFormationExplanatoryStateV212(
  envelope: CaseEnvelopeV212,
): FormationExplanatoryStateV211 {
  const parts = authoritativeReadinessParts(envelope);
  return {
    open_required_fields: parts.open_required_fields,
    lock_prerequisites: sortedUnique([
      ...parts.independent_formation_prerequisites,
      ...parts.disclosure_prerequisites,
      ...parts.disclosure_review_prerequisites,
      ...parts.workflow_prerequisites,
      ...parts.required_current_confirmations.map(
        (partyId) => `${partyId}_current_confirmation_required`,
      ),
    ]),
    lock_blockers: parts.authoritative_blockers,
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

export function deriveFormationReadinessV212(envelope: CaseEnvelopeV212): FormationReadinessV212 {
  const parts = authoritativeReadinessParts(envelope);
  const expected = authoritativeFormationExplanatoryStateV212(envelope);
  const consistencyIssues: string[] = [];
  if (
    !sameStrings(envelope.formation.explanatory.open_required_fields, expected.open_required_fields)
  ) {
    consistencyIssues.push('open_required_fields_projection_mismatch');
  }
  if (
    !sameStrings(envelope.formation.explanatory.lock_prerequisites, expected.lock_prerequisites)
  ) {
    consistencyIssues.push('lock_prerequisites_projection_mismatch');
  }
  if (!sameStrings(envelope.formation.explanatory.lock_blockers, expected.lock_blockers)) {
    consistencyIssues.push('lock_blockers_projection_mismatch');
  }
  const blockers = sortedUnique([
    ...parts.authoritative_blockers,
    ...consistencyIssues.map((issue) => `explanatory_state_inconsistent:${issue}`),
  ]);
  return cloneCanonical({
    readiness_version: FORMATION_READINESS_VERSION_V212,
    ready_for_bilateral_lock: blockers.length === 0,
    blockers,
    open_required_fields: parts.open_required_fields,
    independent_formation_prerequisites: parts.independent_formation_prerequisites,
    disclosure_prerequisites: parts.disclosure_prerequisites,
    disclosure_review_prerequisites: parts.disclosure_review_prerequisites,
    workflow_prerequisites: parts.workflow_prerequisites,
    open_required_challenges: parts.open_required_challenges,
    ineligible_required_evidence: parts.ineligible_required_evidence,
    required_current_confirmations: parts.required_current_confirmations,
    explanatory_consistency_issues: consistencyIssues.sort(),
  });
}
