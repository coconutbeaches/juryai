/**
 * PR 8C0b-2 — what a relay may and may not do to the opponent's material.
 *
 * A blanket "the relay never mutates opponent material" assertion would be
 * FALSE, and a test that asserted it would have to be weakened until it passed
 * — at which point it would stop catching anything. Frozen V2.1.4 legitimately
 * writes across the party boundary in exactly two places:
 *
 *   - a challenge sets the challenged position's `resolution_status` to
 *     `disputed`;
 *   - a challenge response sets it to `procedurally_resolved`;
 *
 * each also moving that position's `last_material_envelope_version`.
 *
 * So the rule is an ALLOWLIST: those fields may move on that one position, and
 * nothing else opponent-owned may change at all. Any additional delta fails.
 */

import { describe, expect, it } from 'vitest';
import type { CaseEnvelopeV214, PartyIdV214 } from '../v2-1-4/case-envelope.js';
import {
  answerSpan,
  bothApply,
  boundEnvelope,
  bytes,
  disclose,
  recordFact,
  relayCase,
  unique,
} from './formation-relay-fixtures.js';

/** Every object in the envelope attributed to `partyId`, canonically ordered. */
function opponentSlice(envelope: CaseEnvelopeV214, partyId: PartyIdV214) {
  const owned = <T extends { attributed_party_id?: PartyIdV214; party_id?: PartyIdV214 }>(
    record: Record<string, T>,
  ) =>
    Object.fromEntries(
      Object.entries(record)
        .filter(([, value]) => (value.attributed_party_id ?? value.party_id) === partyId)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
  return {
    party: envelope.parties[partyId],
    positions: owned(envelope.positions),
    requirements: owned(envelope.requirements),
    clarifications: owned(envelope.clarifications),
    source_turns: owned(envelope.source_turns),
    evidence: owned(envelope.evidence),
    confirmations: envelope.formation.confirmations[partyId],
    acknowledgments: envelope.formation.disclosure_review_acknowledgments[partyId],
  };
}

function twoPartyDisclosed() {
  const reqA = unique('req_a_allow');
  const reqB = unique('req_b_allow');
  let envelope = boundEnvelope({ party_a: [reqA], party_b: [reqB] });
  envelope = recordFact(envelope, 'party_a', reqA, 'Party A account of the delivery.');
  envelope = recordFact(envelope, 'party_b', reqB, 'Party B account of the content.');
  return { reqA, reqB, envelope: disclose(envelope) };
}

describe('PR 8C0b-2 · A: an ordinary own-party submission touches nothing of the opponent', () => {
  it('leaves every opponent-owned object byte-identical', () => {
    const reqA = unique('req_a_own');
    const reqB = unique('req_b_own');
    let envelope = boundEnvelope({ party_a: [reqA], party_b: [reqB] });
    envelope = recordFact(envelope, 'party_b', reqB, 'Party B account, recorded first.');
    const before = opponentSlice(envelope, 'party_b');

    const scenario = relayCase({ envelope, requirementId: reqA });
    const { frozen, shared } = bothApply(scenario);
    if (frozen.status !== 'applied') throw new Error('expected applied');
    expect(bytes(shared)).toBe(bytes(frozen));
    expect(bytes(opponentSlice(frozen.envelope, 'party_b'))).toBe(bytes(before));
  });

  it("does not move the opponent's party-visible cursor while embargoed", () => {
    const reqA = unique('req_a_cursor');
    const reqB = unique('req_b_cursor');
    let envelope = boundEnvelope({ party_a: [reqA], party_b: [reqB] });
    envelope = recordFact(envelope, 'party_b', reqB, 'Party B account.');
    const cursorBefore = bytes(envelope.control.party_views.party_b);

    const scenario = relayCase({ envelope, requirementId: reqA });
    const { frozen } = bothApply(scenario);
    if (frozen.status !== 'applied') throw new Error('expected applied');
    expect(bytes(frozen.envelope.control.party_views.party_b)).toBe(cursorBefore);
    expect(frozen.changed_visible_parties).toEqual(['party_a']);
  });
});

describe('PR 8C0b-2 · B: a challenge may move exactly two fields, on exactly one position', () => {
  it('marks the challenged position disputed and nothing else', () => {
    const { reqA, reqB, envelope } = twoPartyDisclosed();
    const target = Object.values(envelope.positions).find(
      (position) => position.attributed_party_id === 'party_a',
    )!.position_id;
    const before = opponentSlice(envelope, 'party_a');

    const statement = 'Party B challenges that account.';
    const scenario = relayCase({
      envelope,
      partyId: 'party_b',
      requirementId: reqB,
      answer: statement,
      inReplyTo: [target],
      effects: (turnId) => [
        {
          type: 'challenge_candidate',
          target_position_id: target,
          statement,
          spans: [answerSpan(turnId, statement)],
        },
      ],
      positionCount: 0,
    });
    const { frozen, shared } = bothApply(scenario);
    if (frozen.status !== 'applied') throw new Error('expected applied');
    expect(bytes(shared)).toBe(bytes(frozen));

    const after = opponentSlice(frozen.envelope, 'party_a');
    // Apply the allowlist to `before`, then require EXACT equality. Anything
    // the relay changed beyond the allowlist shows up as a mismatch rather
    // than being quietly tolerated by a loose assertion.
    const expected = structuredClone(before);
    expected.positions[target]!.resolution_status = 'disputed';
    expected.positions[target]!.last_material_envelope_version =
      frozen.envelope.control.envelope_version;
    expect(bytes(after)).toBe(bytes(expected));
    void reqA;
  });
});

describe('PR 8C0b-2 · C: a challenge response may move the same two fields only', () => {
  it('marks the challenged position procedurally_resolved and nothing else', () => {
    const { reqA, reqB, envelope } = twoPartyDisclosed();
    const target = Object.values(envelope.positions).find(
      (position) => position.attributed_party_id === 'party_a',
    )!.position_id;

    const challengeStatement = 'Party B challenges that account.';
    const challenge = relayCase({
      envelope,
      partyId: 'party_b',
      requirementId: reqB,
      answer: challengeStatement,
      inReplyTo: [target],
      effects: (turnId) => [
        {
          type: 'challenge_candidate',
          target_position_id: target,
          statement: challengeStatement,
          spans: [answerSpan(turnId, challengeStatement)],
        },
      ],
      positionCount: 0,
    });
    const challenged = bothApply(challenge);
    if (challenged.frozen.status !== 'applied') throw new Error('expected applied');
    const withChallenge = challenged.frozen.envelope;
    const challengeId = Object.values(withChallenge.challenges)[0]!.challenge_id;

    // Now party A responds. Party B is the opponent from A's perspective, so
    // B's material must be untouched, while A's own challenged position moves.
    const opponentBefore = opponentSlice(withChallenge, 'party_b');
    const responseStatement = 'Party A stands by the account.';
    const response = relayCase({
      envelope: withChallenge,
      partyId: 'party_a',
      requirementId: reqA,
      answer: responseStatement,
      inReplyTo: [challengeId],
      effects: (turnId) => [
        {
          type: 'challenge_response_candidate',
          challenge_id: challengeId,
          statement: responseStatement,
          spans: [answerSpan(turnId, responseStatement)],
          semantic_correction: null,
        },
      ],
      positionCount: 0,
    });
    const { frozen, shared } = bothApply(response);
    if (frozen.status !== 'applied') throw new Error('expected applied');
    expect(bytes(shared)).toBe(bytes(frozen));

    expect(frozen.envelope.positions[target]!.resolution_status).toBe('procedurally_resolved');
    expect(frozen.envelope.positions[target]!.last_material_envelope_version).toBe(
      frozen.envelope.control.envelope_version,
    );
    // Party B owns no position that this response may touch.
    expect(bytes(opponentSlice(frozen.envelope, 'party_b'))).toBe(bytes(opponentBefore));
  });
});
