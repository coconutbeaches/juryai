/**
 * PR 8C0b-2 — adversarial trust-boundary tests for the shared relay.
 *
 * Byte parity on the happy path cannot see a weakened `!==`. Every check below
 * targets one boundary the extraction could have loosened, and asserts that
 * BOTH implementations refuse in exactly the same way — reason code, message
 * and issues. A test that only asserted "the shared relay refuses" would keep
 * passing if the shared relay refused for a different, weaker reason.
 *
 * The bridge/runtime boundary itself is covered in
 * `formation-relay-runtime-parity.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { cloneCanonical, sha256 } from '../v2/case-envelope.js';
import { partyAuthorityV214 } from '../v2-1-4/case-envelope.js';
import { applyExternalRelaySubmissionV214 } from '../v2-1-4/external-relay-submission.js';
import { partyAuthority } from '../formation/envelope.js';
import { V214_RELAY, asEngine } from './formation-relay-wiring.js';
import {
  answerSpan,
  bothApply,
  boundEnvelope,
  bytes,
  disclose,
  frozenPrepare,
  recordFact,
  relayCase,
  sharedPrepare,
  unique,
} from './formation-relay-fixtures.js';

const twoPartyCase = () => {
  const reqA = unique('req_a_adv');
  const reqB = unique('req_b_adv');
  return { reqA, reqB, envelope: boundEnvelope({ party_a: [reqA], party_b: [reqB] }) };
};

describe('PR 8C0b-2 · identity and binding', () => {
  it('5. a substituted authenticated subject is rejected', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      (submission.source_turn as Record<string, unknown>).authenticated_subject_id_at_receipt =
        'someone-else';
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'unauthorized_actor' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('6. a flipped attributed_party_id is rejected', () => {
    const { reqA, envelope } = twoPartyCase();
    const scenario = relayCase({ envelope, requirementId: reqA });
    const { frozen, shared } = bothApply(scenario, (submission) => {
      (submission.source_turn as Record<string, unknown>).attributed_party_id = 'party_b';
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'unauthorized_actor' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('7. a mismatched submission.dispute_id is rejected', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      submission.dispute_id = 'dispute_somewhere_else';
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'case_mismatch' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('8. a mismatched source_turn.dispute_id is rejected, separately', () => {
    // Checked separately because the frozen code compares BOTH fields; a single
    // combined check would let one of them drift.
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      (submission.source_turn as Record<string, unknown>).dispute_id = 'dispute_somewhere_else';
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'case_mismatch' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('9. first_party_human authority is refused on the relay path', () => {
    // An external agent must never acquire first-party standing. This is the
    // boundary that keeps a relay from attesting, confirming or locking.
    const scenario = relayCase();
    const prepared = frozenPrepare(scenario);
    if (prepared.status !== 'prepared') throw new Error('expected prepared');
    const frozen = applyExternalRelaySubmissionV214({
      envelope: scenario.envelope,
      submission: cloneCanonical(prepared.submission),
      execution_authority: partyAuthorityV214(scenario.envelope, 'party_a', 'first_party_human'),
    });
    const shared = V214_RELAY.applyExternalRelaySubmission({
      envelope: asEngine(scenario.envelope),
      submission: cloneCanonical(prepared.submission) as never,
      execution_authority: partyAuthority(
        asEngine(scenario.envelope),
        'party_a',
        'first_party_human',
      ),
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'unauthorized_actor' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('prepare also refuses first_party_human authority', () => {
    const scenario = relayCase();
    const frozen = frozenPrepare(scenario);
    expect(frozen.status).toBe('prepared');
    const shared = V214_RELAY.prepareExternalRelaySubmission({
      envelope: asEngine(scenario.envelope),
      execution_authority: partyAuthority(
        asEngine(scenario.envelope),
        'party_a',
        'first_party_human',
      ),
      intent: {
        intent_version: 'juryai-external-relay-submission-intent-v2.1.1',
        expected_party_visible_version:
          scenario.envelope.control.party_views.party_a.party_visible_version,
        expected_party_projection_hash:
          scenario.envelope.control.party_views.party_a.party_projection_hash,
        client_turn_id: scenario.clientTurnId,
        in_reply_to: scenario.inReplyTo,
        payload: scenario.payload,
        source_language: 'en',
        translation_indicated: false,
      } as never,
      runtime: V214_RELAY.mintRuntime(V214_RELAY.bridge, {
        source_channel: 'webmcp_agent_relay',
        relaying_agent: 'parity-relay',
        received_at: scenario.receivedAt,
        payload_commitment_salt: scenario.salt,
        ids: cloneCanonical(scenario.ids),
      }) as never,
      compiler_run: scenario.compilerRun as never,
      effects: cloneCanonical(scenario.effects) as never,
    });
    expect(shared).toMatchObject({ status: 'rejected', reason_code: 'unauthorized_actor' });
  });
});

describe('PR 8C0b-2 · ownership and direction', () => {
  it('10. an assertion against an opponent-owned requirement is rejected', () => {
    const { reqA, reqB, envelope } = twoPartyCase();
    const answer = 'Party A asserts something about party B material.';
    const scenario = relayCase({
      envelope,
      requirementId: reqA,
      answer,
      inReplyTo: [reqB],
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: reqB,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: answer,
          spans: [answerSpan(turnId, answer)],
          supersedes_candidate: null,
        },
      ],
    });
    // The reply target itself is already invisible to party A pre-disclosure,
    // so prepare refuses before apply is ever reached; both must agree on that.
    const frozen = frozenPrepare(scenario);
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'invalid_intent' });
    expect(bytes(sharedPrepare(scenario))).toBe(bytes(frozen));
  });

  it('10b. an opponent requirement reached through apply is rejected by ownership', () => {
    const { reqA, reqB, envelope } = twoPartyCase();
    const scenario = relayCase({ envelope, requirementId: reqA });
    const { frozen, shared } = bothApply(scenario, (submission) => {
      const effects = submission.effects as Record<string, unknown>[];
      effects[0]!.requirement_id = reqB;
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'effect_rejected' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('11. superseding an opponent-owned position is rejected', () => {
    const { reqA, reqB } = twoPartyCase();
    let envelope = boundEnvelope({ party_a: [reqA], party_b: [reqB] });
    envelope = recordFact(envelope, 'party_b', reqB, 'Party B account.');
    const opponentPosition = Object.values(envelope.positions).find(
      (position) => position.attributed_party_id === 'party_b',
    )!.position_id;
    const scenario = relayCase({ envelope, requirementId: reqA });
    const { frozen, shared } = bothApply(scenario, (submission) => {
      const effects = submission.effects as Record<string, unknown>[];
      effects[0]!.supersedes_candidate = opponentPosition;
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'effect_rejected' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('12. challenging your own position is rejected', () => {
    const { reqA, reqB } = twoPartyCase();
    let envelope = boundEnvelope({ party_a: [reqA], party_b: [reqB] });
    envelope = recordFact(envelope, 'party_a', reqA, 'Party A account.');
    envelope = recordFact(envelope, 'party_b', reqB, 'Party B account.');
    envelope = disclose(envelope);
    const own = Object.values(envelope.positions).find(
      (position) => position.attributed_party_id === 'party_a',
    )!.position_id;
    const statement = 'Party A challenges its own position.';
    const scenario = relayCase({
      envelope,
      partyId: 'party_a',
      requirementId: reqA,
      answer: statement,
      inReplyTo: [own],
      effects: (turnId) => [
        {
          type: 'challenge_candidate',
          target_position_id: own,
          statement,
          spans: [answerSpan(turnId, statement)],
        },
      ],
      positionCount: 0,
    });
    const { frozen, shared } = bothApply(scenario);
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'effect_rejected' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('13. responding to a challenge addressed to the opponent is rejected', () => {
    const { reqA, reqB } = twoPartyCase();
    let envelope = boundEnvelope({ party_a: [reqA], party_b: [reqB] });
    envelope = recordFact(envelope, 'party_a', reqA, 'Party A account.');
    envelope = recordFact(envelope, 'party_b', reqB, 'Party B account.');
    envelope = disclose(envelope);
    const targetA = Object.values(envelope.positions).find(
      (position) => position.attributed_party_id === 'party_a',
    )!.position_id;
    const challengeStatement = 'Party B challenges that.';
    const challenge = relayCase({
      envelope,
      partyId: 'party_b',
      requirementId: reqB,
      answer: challengeStatement,
      inReplyTo: [targetA],
      effects: (turnId) => [
        {
          type: 'challenge_candidate',
          target_position_id: targetA,
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

    // Party B answers a challenge that is directed AT party A.
    const statement = 'Party B answers its own challenge.';
    const wrongWay = relayCase({
      envelope: withChallenge,
      partyId: 'party_b',
      requirementId: reqB,
      answer: statement,
      inReplyTo: [challengeId],
      effects: (turnId) => [
        {
          type: 'challenge_response_candidate',
          challenge_id: challengeId,
          statement,
          spans: [answerSpan(turnId, statement)],
          semantic_correction: null,
        },
      ],
      positionCount: 0,
    });
    const { frozen, shared } = bothApply(wrongWay);
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'effect_rejected' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('14. pre-disclosure enumeration of an opponent position is rejected', () => {
    const { reqA, reqB } = twoPartyCase();
    let envelope = boundEnvelope({ party_a: [reqA], party_b: [reqB] });
    envelope = recordFact(envelope, 'party_b', reqB, 'Party B account, still embargoed.');
    const hidden = Object.values(envelope.positions).find(
      (position) => position.attributed_party_id === 'party_b',
    )!.position_id;
    // Party A names a position it must not be able to see. Rejecting this is
    // what stops an agent probing for the opponent's identifiers.
    const scenario = relayCase({ envelope, requirementId: reqA, inReplyTo: [reqA, hidden].sort() });
    const frozen = frozenPrepare(scenario);
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'invalid_intent' });
    expect(bytes(sharedPrepare(scenario))).toBe(bytes(frozen));
  });
});

describe('PR 8C0b-2 · identifiers and provenance', () => {
  it('15. an opponent-scoped canonical id is rejected', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      const effects = submission.effects as Record<string, unknown>[];
      effects[0]!.position_id = 'position_party_b_smuggled';
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'effect_rejected' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('16. duplicate canonical identities within one submission are rejected', () => {
    const requirementId = unique('req_a_dupe_id');
    const envelope = boundEnvelope({ party_a: [requirementId] });
    const answer = 'Two effects, one identity.';
    const scenario = relayCase({
      envelope,
      requirementId,
      answer,
      effects: (turnId) => [
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
        {
          type: 'clarification_request',
          requirement_id: requirementId,
          reason: 'multiple_incompatible_readings',
          prompt: 'Which delivery?',
        },
      ],
    });
    const { frozen, shared } = bothApply(scenario, (submission) => {
      const effects = submission.effects as Record<string, unknown>[];
      effects[1]!.clarification_id = effects[0]!.position_id;
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'invalid_submission' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('17. a forged span quote is rejected on span fidelity', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      const effects = submission.effects as Record<string, unknown>[];
      const spans = effects[0]!.spans as Record<string, unknown>[];
      spans[0]!.quote = 'text that is not in the answer at all';
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'span_fidelity_failed' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('17b. a span citing a different turn is rejected', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      const effects = submission.effects as Record<string, unknown>[];
      const spans = effects[0]!.spans as Record<string, unknown>[];
      spans[0]!.turn_id = 'turn_party_a_elsewhere';
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'span_fidelity_failed' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('18. a compile run that does not match the source turn is rejected', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      (submission.compiler_run as Record<string, unknown>).compile_run_id = 'run_somewhere_else';
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'invalid_submission' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('18b. a compiler provenance hash that is not a hash is rejected', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      (submission.compiler_run as Record<string, unknown>).output_hash = 'not-a-hash';
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'invalid_submission' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('19. a stale base envelope version is rejected', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      submission.base_internal_envelope_version =
        (submission.base_internal_envelope_version as number) + 1;
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'stale_internal_state' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('20. a mismatched base envelope hash is rejected, separately from the version', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      submission.base_internal_envelope_hash = sha256('a different envelope');
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'stale_internal_state' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('21. a stale party-visible cursor is rejected', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      submission.base_party_projection_hash = sha256('a stale projection');
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'party_projection_stale' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('21b. a source turn claiming a different visible version is rejected', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      (submission.source_turn as Record<string, unknown>).party_visible_version_before = 99;
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'party_projection_stale' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('a non-relay source channel is refused and is NOT a spec knob', () => {
    // Deliberately not configurable: a future generation must not be able to
    // widen the trust model by changing a string in its spec.
    const scenario = relayCase();
    const tamper = (runtime: never) => ({
      ...(runtime as object),
      source_channel: 'first_party_web',
    });
    const frozen = frozenPrepare(scenario, tamper);
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'invalid_intent' });
    expect(bytes(sharedPrepare(scenario, tamper))).toBe(bytes(frozen));
  });

  it('the resulting envelope is validated before it is returned', () => {
    // Injecting a permissive validator must not make the relay's own checks
    // disappear: the relay may not delegate its security to the port.
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      (submission.source_turn as Record<string, unknown>).client_turn_id = '   ';
    });
    expect(frozen.status).toBe('rejected');
    expect(bytes(shared)).toBe(bytes(frozen));
  });
});
