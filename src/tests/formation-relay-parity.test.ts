/**
 * PR 8C0b-2 — complete-output parity between the frozen V2.1.4 relay and the
 * shared, spec-driven relay.
 *
 * Both implementations receive the SAME envelope, the SAME server-minted
 * identifiers, the SAME receipt time and salt, and the SAME compiler effects.
 * Results are compared with `canonicalSerialize` over the WHOLE result object —
 * status, reason code, message, issues, returned envelope, versions, hashes and
 * changed-party list — with no normalisation, no sorting and no field
 * allowlist. The single exception is the opponent-mutation allowlist, which
 * exists because the frozen semantics genuinely permit two cross-party writes.
 */

import { describe, expect, it } from 'vitest';
import {
  answerSpan,
  bothApply,
  bothRebase,
  boundEnvelope,
  bytes,
  disclose,
  frozenPrepare,
  recordFact,
  relayCase,
  sharedPrepare,
  unique,
} from './formation-relay-fixtures.js';

describe('PR 8C0b-2: prepare produces byte-identical submissions', () => {
  it('for a single narrative fact', () => {
    const scenario = relayCase();
    const frozen = frozenPrepare(scenario);
    expect(frozen.status).toBe('prepared');
    expect(bytes(sharedPrepare(scenario))).toBe(bytes(frozen));
  });

  it('including the derived fingerprint, commitment and payload layout', () => {
    const scenario = relayCase();
    const frozen = frozenPrepare(scenario);
    if (frozen.status !== 'prepared') throw new Error('expected prepared');
    const turn = frozen.submission.source_turn;
    // Named explicitly: these four are computed, not copied, so a divergence
    // here would be a real derivation bug rather than a plumbing difference.
    expect(turn.request_fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(turn.payload_commitment).toMatch(/^[a-f0-9]{64}$/u);
    expect(turn.payload_layout.answer_utf16_length).toBe(scenario.payload.answer.text.length);
    expect(bytes(sharedPrepare(scenario))).toBe(bytes(frozen));
  });

  it('for a clarification request', () => {
    const requirementId = unique('req_a_clarify');
    const envelope = boundEnvelope({ party_a: [requirementId] });
    const scenario = relayCase({
      envelope,
      requirementId,
      effects: () => [
        {
          type: 'clarification_request',
          requirement_id: requirementId,
          reason: 'multiple_incompatible_readings',
          prompt: 'Which delivery date do you mean?',
        },
      ],
      positionCount: 0,
    });
    expect(bytes(sharedPrepare(scenario))).toBe(bytes(frozenPrepare(scenario)));
  });

  it('for a multi-effect submission', () => {
    const a = unique('req_a_one');
    const b = unique('req_a_two');
    const envelope = boundEnvelope({ party_a: [a, b] });
    const scenario = relayCase({
      envelope,
      requirementId: a,
      inReplyTo: [a, b].sort(),
      answer: 'Delivery was late and the contact form was incomplete.',
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: a,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'Delivery was late',
          spans: [
            answerSpan(
              turnId,
              'Delivery was late and the contact form was incomplete.',
              'Delivery was late',
            ),
          ],
          supersedes_candidate: null,
        },
        {
          type: 'clarification_request',
          requirement_id: b,
          reason: 'answer_does_not_address_requirement',
          prompt: 'What exactly was incomplete?',
        },
      ],
    });
    expect(bytes(sharedPrepare(scenario))).toBe(bytes(frozenPrepare(scenario)));
  });
});

describe('PR 8C0b-2: apply produces byte-identical envelopes', () => {
  it('for a first narrative fact', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario);
    expect(frozen.status).toBe('applied');
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('moves the canonical hash, version and party cursor identically', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario);
    if (frozen.status !== 'applied' || shared.status !== 'applied')
      throw new Error('expected applied');
    expect(frozen.resulting_envelope_version).toBe(scenario.envelope.control.envelope_version + 1);
    expect(shared.resulting_envelope_version).toBe(frozen.resulting_envelope_version);
    expect(shared.envelope.control.envelope_hash).toBe(frozen.envelope.control.envelope_hash);
    expect(bytes(shared.changed_visible_parties)).toBe(bytes(frozen.changed_visible_parties));
    expect(bytes(shared.envelope.control.party_views)).toBe(
      bytes(frozen.envelope.control.party_views),
    );
    expect(bytes(shared.envelope.formation.explanatory)).toBe(
      bytes(frozen.envelope.formation.explanatory),
    );
  });

  it('for a supersession of an existing live position', () => {
    const requirementId = unique('req_a_supersede');
    let envelope = boundEnvelope({ party_a: [requirementId] });
    envelope = recordFact(envelope, 'party_a', requirementId, 'Delivered on 15 July.');
    const target = Object.values(envelope.positions)[0]!.position_id;
    const answer = 'Delivered on 16 July, correcting my earlier statement.';
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
          supersedes_candidate: target,
        },
      ],
    });
    const { frozen, shared } = bothApply(scenario);
    expect(frozen.status).toBe('applied');
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('for a challenge and its response, across disclosure', () => {
    const reqA = unique('req_a_story');
    const reqB = unique('req_b_story');
    let envelope = boundEnvelope({ party_a: [reqA], party_b: [reqB] });
    envelope = recordFact(envelope, 'party_a', reqA, 'The work was not completed.');
    envelope = recordFact(envelope, 'party_b', reqB, 'The content arrived late.');
    envelope = disclose(envelope);
    const target = Object.values(envelope.positions).find(
      (position) => position.attributed_party_id === 'party_a',
    )!.position_id;

    const challengeAnswer = 'Party B challenges that account.';
    const challenge = relayCase({
      envelope,
      partyId: 'party_b',
      requirementId: reqB,
      answer: challengeAnswer,
      inReplyTo: [target],
      effects: (turnId) => [
        {
          type: 'challenge_candidate',
          target_position_id: target,
          statement: challengeAnswer,
          spans: [answerSpan(turnId, challengeAnswer)],
        },
      ],
      positionCount: 0,
    });
    const challengeResult = bothApply(challenge);
    expect(challengeResult.frozen.status).toBe('applied');
    expect(bytes(challengeResult.shared)).toBe(bytes(challengeResult.frozen));

    const challenged =
      challengeResult.frozen.status === 'applied' ? challengeResult.frozen.envelope : envelope;
    const challengeId = Object.values(challenged.challenges).find(
      (entry) => entry.status === 'open',
    )!.challenge_id;
    const responseAnswer = 'Party A stands by the account.';
    const response = relayCase({
      envelope: challenged,
      partyId: 'party_a',
      requirementId: reqA,
      answer: responseAnswer,
      inReplyTo: [challengeId],
      effects: (turnId) => [
        {
          type: 'challenge_response_candidate',
          challenge_id: challengeId,
          statement: responseAnswer,
          spans: [answerSpan(turnId, responseAnswer)],
          semantic_correction: null,
        },
      ],
      positionCount: 0,
    });
    const responseResult = bothApply(response);
    expect(responseResult.frozen.status).toBe('applied');
    expect(bytes(responseResult.shared)).toBe(bytes(responseResult.frozen));
  });
});

describe('PR 8C0b-2: rebase matches frozen behaviour exactly', () => {
  it('accepts and rewrites only the internal base version and hash', () => {
    const requirementId = unique('req_a_rebase');
    const envelope = boundEnvelope({ party_a: [requirementId], party_b: [unique('req_b_rebase')] });
    const scenario = relayCase({ envelope, requirementId });
    // Hidden opponent progress: party B moves, so the internal envelope
    // advances while party A's visible cursor does not.
    const moved = recordFact(
      envelope,
      'party_b',
      Object.values(envelope.requirements).find((r) => r.party_id === 'party_b')!.requirement_id,
      'Party B records its own account.',
    );
    const { frozen, shared } = bothRebase(scenario, moved);
    expect(frozen).not.toBeNull();
    expect(bytes(shared)).toBe(bytes(frozen));
    expect(frozen!.base_internal_envelope_version).toBe(moved.control.envelope_version);
    // The party-visible cursor must NOT be rewritten: rebasing it would leak
    // that the opponent had moved.
    expect(frozen!.base_party_visible_version).toBe(
      envelope.control.party_views.party_a.party_visible_version,
    );
    expect(frozen!.base_party_projection_hash).toBe(
      envelope.control.party_views.party_a.party_projection_hash,
    );
  });

  it('refuses when the party-visible cursor itself moved', () => {
    const requirementId = unique('req_a_rebase_refuse');
    const envelope = boundEnvelope({ party_a: [requirementId] });
    const scenario = relayCase({ envelope, requirementId });
    const moved = recordFact(envelope, 'party_a', requirementId, 'Party A records something else.');
    const { frozen, shared } = bothRebase(scenario, moved);
    expect(frozen).toBeNull();
    expect(shared).toBeNull();
  });

  it('refuses across a different dispute', () => {
    const requirementId = unique('req_a_rebase_other');
    const envelope = boundEnvelope({ party_a: [requirementId] });
    const scenario = relayCase({ envelope, requirementId });
    const other = boundEnvelope({ party_a: [unique('req_a_other')] });
    const { frozen, shared } = bothRebase(scenario, other);
    expect(frozen).toBeNull();
    expect(shared).toBeNull();
  });
});

describe('PR 8C0b-2: the zero-effect domain behaviour is inherited, not fixed', () => {
  it('both relay domains ACCEPT a submission with no effects', () => {
    // The PR 8A guard that refuses this lives in the APPLICATION layer
    // (src/v2-1-4/webmcp-application.ts), not here. The domain writes a source
    // turn and bumps the version. Pinning that keeps the shared relay honest:
    // it inherits the gap rather than quietly closing it, and 8C2 must restore
    // the guard when it wires production — zero canonical effects must yield
    // INVALID_INPUT, no persistence, and an unconsumed client_turn_id.
    const requirementId = unique('req_a_zero');
    const envelope = boundEnvelope({ party_a: [requirementId] });
    const scenario = relayCase({ envelope, requirementId, effects: () => [], positionCount: 0 });
    const frozenPrepared = frozenPrepare(scenario);
    expect(frozenPrepared.status).toBe('prepared');
    expect(bytes(sharedPrepare(scenario))).toBe(bytes(frozenPrepared));

    const { frozen, shared } = bothApply(scenario);
    expect(frozen.status).toBe('applied');
    expect(bytes(shared)).toBe(bytes(frozen));
    if (frozen.status === 'applied') {
      expect(Object.keys(frozen.envelope.source_turns)).toHaveLength(1);
      expect(frozen.envelope.control.envelope_version).toBe(envelope.control.envelope_version + 1);
      expect(frozen.result.accepted_position_ids).toEqual([]);
    }
  });
});

describe('PR 8C0b-2: the shared relay reads its generation from the spec', () => {
  it('stamps the spec submission version rather than a hardcoded literal', () => {
    const scenario = relayCase();
    const shared = sharedPrepare(scenario);
    if (shared.status !== 'prepared') throw new Error('expected prepared');
    expect(shared.submission.submission_version).toBe('juryai-external-relay-submission-v2.1.4');
  });

  it('rejects a submission whose version does not match the spec', () => {
    const scenario = relayCase();
    const { frozen, shared } = bothApply(scenario, (submission) => {
      submission.submission_version = 'juryai-external-relay-submission-v9.9.9';
    });
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'invalid_submission' });
    expect(bytes(shared)).toBe(bytes(frozen));
  });
});
