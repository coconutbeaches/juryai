/**
 * Envelope fixtures for the PR 8C0b-1 shared-validator suites.
 *
 * Fixtures are built by driving the FROZEN V2.1.4 implementation, so every
 * envelope the parity tests compare is one production could actually have
 * produced. Hand-assembling envelopes would let a fixture drift into a shape
 * neither validator was written for, and parity between two validators on an
 * impossible envelope proves nothing about either.
 *
 * Nothing here reads or mutates any live dispute. The canary-derived fixture is
 * shaped from the known scenario and built entirely in memory.
 */

import { cloneCanonical } from '../v2/case-envelope.js';
import {
  TRUSTED_SYSTEM_AUTHORITY_V214,
  hashCaseEnvelopeV214,
  type CaseEnvelopeV214,
} from '../v2-1-4/case-envelope.js';
import { createInitialCaseEnvelopeV214 } from '../v2-1-4/envelope-ceremony.js';
import {
  acknowledge,
  addChallenge,
  answerSpan,
  bindBoth,
  ceremony,
  requirement,
  submit,
  unique,
} from './v2-1-4-test-helpers.js';

export { unique };

export interface FormationFixture {
  envelope: CaseEnvelopeV214;
  requirementA: string;
  requirementB: string;
}

/** A narrative fact recorded by one party against one of its own requirements. */
function recordFact(
  envelope: CaseEnvelopeV214,
  partyId: 'party_a' | 'party_b',
  requirementId: string,
  answer: string,
): CaseEnvelopeV214 {
  return submit(
    envelope,
    partyId,
    { context: [], answer: { role: 'user', text: answer } },
    [requirementId],
    (turnId) => [
      {
        type: 'semantic_assertion_candidate',
        compiler_assertion_id: unique('compiler_assertion'),
        requirement_id: requirementId,
        proposed_type: 'narrative_fact',
        epistemic_strength: 'asserted_confident',
        statement: answer,
        spans: [answerSpan(turnId, answer)],
        supersedes_candidate: null,
      },
    ],
  );
}

/**
 * An embargoed envelope holding one live position per party. This is the shape
 * most validator rules operate on, and the base for the canary fixture.
 */
export function independentFormationFixture(): FormationFixture {
  const requirementA = unique('req_a_performance');
  const requirementB = unique('req_b_performance');
  let envelope = bindBoth(
    createInitialCaseEnvelopeV214(unique('dispute_validator_parity'), {
      party_a: [requirement(requirementA)],
      party_b: [requirement(requirementB)],
    }),
  );
  envelope = recordFact(
    envelope,
    'party_a',
    requirementA,
    'The site was delivered on 15 July, two weeks after the agreed date.',
  );
  envelope = recordFact(
    envelope,
    'party_b',
    requirementB,
    'The content needed to build the pages arrived one week late.',
  );
  return { envelope, requirementA, requirementB };
}

/**
 * A disclosed envelope carrying a challenge and both disclosure-review
 * acknowledgments, so the challenge, acknowledgment and disclosure-ordering
 * rules are reachable.
 */
export function disclosedChallengeFixture(): FormationFixture {
  const base = independentFormationFixture();
  let envelope = ceremony(base.envelope, TRUSTED_SYSTEM_AUTHORITY_V214, {
    type: 'open_controlled_disclosure',
  });
  const targetPositionId = Object.values(envelope.positions).find(
    (position) => position.attributed_party_id === 'party_a',
  )!.position_id;
  envelope = addChallenge(envelope, targetPositionId);
  return { ...base, envelope };
}

/** Same, with both parties' disclosure review current. */
export function acknowledgedFixture(): FormationFixture {
  const base = independentFormationFixture();
  let envelope = ceremony(base.envelope, TRUSTED_SYSTEM_AUTHORITY_V214, {
    type: 'open_controlled_disclosure',
  });
  envelope = acknowledge(envelope, 'party_a');
  envelope = acknowledge(envelope, 'party_b');
  return { ...base, envelope };
}

/**
 * Applies a mutation to a deep copy and RESTAMPS the canonical envelope hash.
 *
 * Restamping is what makes a fixture prove the rule it targets. Without it a
 * mutated envelope fails on `envelope_hash_mismatch`, and a test asserting only
 * "both validators rejected" passes while proving nothing about the rule under
 * test. The late consistency block is skipped once any earlier issue exists, so
 * restamping never hides a defect — it only removes a decoy.
 */
export function mutate(
  envelope: CaseEnvelopeV214,
  change: (draft: CaseEnvelopeV214) => void,
): CaseEnvelopeV214 {
  const draft = cloneCanonical(envelope);
  change(draft);
  draft.control.envelope_hash = hashCaseEnvelopeV214(draft);
  return draft;
}

/** Applies a mutation WITHOUT restamping, for rules about the stored hash. */
export function mutateWithoutRestamp(
  envelope: CaseEnvelopeV214,
  change: (draft: CaseEnvelopeV214) => void,
): CaseEnvelopeV214 {
  const draft = cloneCanonical(envelope);
  change(draft);
  return draft;
}
