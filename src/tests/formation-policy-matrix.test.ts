/**
 * PR 8C1a — the deterministic A/B semantic matrix.
 *
 * Every row runs the SAME fixture and the SAME hand-built compiler effects
 * under both policies:
 *
 *   OLD     single_live_per_slot + in_reply_to_only   (V2.1.4 parity spec)
 *   FUTURE  multi_live + all_own_requirements          (test-only spec)
 *
 * No model is invoked. Compiler outputs are hand-built, so a row's outcome is
 * a property of the domain policy and nothing else.
 *
 * The OLD column is an INVARIANT, not an expectation to be updated: every 8C0
 * parity suite still runs unchanged, and any row here that had to be relaxed
 * to make new code green would be a regression wearing a matrix row's clothes.
 */

import { describe, expect, it } from 'vitest';
import { partyAuthorityV214 } from '../v2-1-4/case-envelope.js';
import { applyExternalRelaySubmissionV214 } from '../v2-1-4/external-relay-submission.js';
import { partyAuthority } from '../formation/envelope.js';
import { FUTURE_RELAY, asEngine } from './formation-relay-wiring.js';
import { createFormationValidator } from '../formation/validator.js';
import { rawV214Spec } from './formation-v214-parity-spec.js';
import { rawFutureSpec } from './formation-future-policy-spec.js';
import { mutate } from './formation-validator-fixtures.js';
import {
  answerSpan,
  boundEnvelope,
  bothPolicies,
  bytes,
  finiteRequirement,
  frozenPrepare,
  futureApply,
  futurePrepare,
  recordFact,
  recordFutureFact,
  relayCase,
  unique,
} from './formation-relay-fixtures.js';

const liveOwn = (
  envelope: {
    positions: Record<
      string,
      { attributed_party_id: string; requirement_id: string; superseded_by: string | null }
    >;
  },
  requirementId: string,
) =>
  Object.values(envelope.positions).filter(
    (position) =>
      position.attributed_party_id === 'party_a' &&
      position.requirement_id === requirementId &&
      position.superseded_by === null,
  );

const FACT_A = 'The site was delivered on 15 July, two weeks after the agreed date.';
const FACT_B = 'The contact form still did not work after delivery.';

describe('Row 1 — two distinct facts, same requirement, type and strength', () => {
  it('old rejects the second; future records both', () => {
    const requirementId = unique('req_other_party_performance');
    const answer = `${FACT_A} ${FACT_B}`;
    const scenario = relayCase({
      envelope: boundEnvelope({ party_a: [requirementId] }),
      requirementId,
      answer,
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: FACT_A,
          spans: [answerSpan(turnId, answer, FACT_A)],
          supersedes_candidate: null,
        },
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: FACT_B,
          spans: [answerSpan(turnId, answer, FACT_B)],
          supersedes_candidate: null,
        },
      ],
    });
    const { strict, future } = bothPolicies(scenario);
    expect(strict).toMatchObject({ status: 'rejected', reason_code: 'effect_rejected' });
    expect(future.status).toBe('applied');
    if (future.status !== 'applied') throw new Error('expected applied');
    expect(future.result.accepted_position_ids).toHaveLength(2);
    expect(liveOwn(future.envelope, requirementId)).toHaveLength(2);
  });
});

describe('Row 2 — same requirement and type, different epistemic strengths', () => {
  it('old rejects; future records both, strengths preserved', () => {
    const requirementId = unique('req_other_party_nonperformance');
    const answer =
      'The lateness I state as fact; that it contributed significantly is my own assessment.';
    const first = 'The lateness I state as fact';
    const second = 'that it contributed significantly is my own assessment';
    const scenario = relayCase({
      envelope: boundEnvelope({ party_a: [requirementId] }),
      requirementId,
      answer,
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: first,
          spans: [answerSpan(turnId, answer, first)],
          supersedes_candidate: null,
        },
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_qualified',
          statement: second,
          spans: [answerSpan(turnId, answer, second)],
          supersedes_candidate: null,
        },
      ],
    });
    const { strict, future } = bothPolicies(scenario);
    expect(strict.status).toBe('rejected');
    if (future.status !== 'applied') throw new Error('expected applied');
    const strengths = liveOwn(future.envelope, requirementId).map(
      (position) => (position as unknown as { epistemic_strength: string }).epistemic_strength,
    );
    // Row 15: the frozen canary sentence, now representable without flattening.
    expect(strengths.sort()).toEqual(['asserted_confident', 'asserted_qualified']);
  });
});

describe('Row 3 — two same-slot assertions in one compiler output', () => {
  it('old rejects with the frozen assertion-slot code; future accepts', () => {
    const requirementId = unique('req_other_party_performance');
    const answer = `${FACT_A} ${FACT_B}`;
    const scenario = relayCase({
      envelope: boundEnvelope({ party_a: [requirementId] }),
      requirementId,
      answer,
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: FACT_A,
          spans: [answerSpan(turnId, answer, FACT_A)],
          supersedes_candidate: null,
        },
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: FACT_B,
          spans: [answerSpan(turnId, answer, FACT_B)],
          supersedes_candidate: null,
        },
      ],
    });
    const { strict } = bothPolicies(scenario);
    if (strict.status !== 'rejected') throw new Error('expected rejected');
    expect(strict.issues[0]!.code).toBe('v214_assertion_slot_duplicate');
  });
});

describe('Row 4 — additive fact when the slot is already occupied', () => {
  it('old reports a live-slot collision; future appends', () => {
    const requirementId = unique('req_other_party_performance');
    let envelope = boundEnvelope({ party_a: [requirementId] });
    envelope = recordFact(envelope, 'party_a', requirementId, FACT_A);
    const scenario = relayCase({ envelope, requirementId, answer: FACT_B });
    const { strict, future } = bothPolicies(scenario);
    if (strict.status !== 'rejected') throw new Error('expected rejected');
    expect(strict.issues[0]!.code).toBe('v214_live_position_slot_collision');
    if (future.status !== 'applied') throw new Error('expected applied');
    expect(liveOwn(future.envelope, requirementId)).toHaveLength(2);
  });
});

describe('Row 5 — correcting one of three same-slot live propositions', () => {
  it('supersedes only the named target; siblings byte-identical', () => {
    const requirementId = unique('req_other_party_performance');
    let envelope = boundEnvelope({ party_a: [requirementId] });
    envelope = recordFutureFact(envelope, 'party_a', requirementId, 'First fact about delivery.');
    envelope = recordFutureFact(envelope, 'party_a', requirementId, 'Second fact about the form.');
    envelope = recordFutureFact(envelope, 'party_a', requirementId, 'Third fact about mobile.');
    const live = liveOwn(envelope, requirementId);
    expect(live).toHaveLength(3);
    const target = live[1]!;
    const siblings = [live[0]!, live[2]!].map((position) => bytes(position));

    const answer = 'Correcting the second: the form failed only on mobile.';
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
          supersedes_candidate: (target as unknown as { position_id: string }).position_id,
        },
      ],
    });
    const prepared = futurePrepare(scenario);
    if (prepared.status !== 'prepared') throw new Error(prepared.message);
    const applied = futureApply(scenario, prepared.submission);
    if (applied.status !== 'applied') throw new Error(`${applied.reason_code}: ${applied.message}`);
    expect(liveOwn(applied.envelope, requirementId)).toHaveLength(3);
    const after = applied.envelope.positions as unknown as Record<string, unknown>;
    expect(
      [live[0]!, live[2]!].map((position) =>
        bytes(after[(position as unknown as { position_id: string }).position_id]),
      ),
    ).toEqual(siblings);
  });
});

describe('Row 12 — volunteering into an opponent requirement', () => {
  it('is rejected under BOTH policies', () => {
    // The load-bearing negative: a wider PARSING scope must never become a
    // wider AUTHORITY. Ownership is unconditional in the relay.
    const reqA = unique('req_a_own');
    const reqB = unique('req_b_opponent');
    const envelope = boundEnvelope({ party_a: [reqA], party_b: [reqB] });
    const answer = 'A statement party A wants recorded against party B material.';
    const scenario = relayCase({
      envelope,
      requirementId: reqA,
      answer,
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
    const prepared = frozenPrepare(scenario);
    if (prepared.status !== 'prepared') throw new Error('expected prepared');
    const strict = applyExternalRelaySubmissionV214({
      envelope,
      submission: prepared.submission,
      execution_authority: partyAuthorityV214(envelope, 'party_a', 'external_relay'),
    });
    const future = FUTURE_RELAY.applyExternalRelaySubmission({
      envelope: asEngine(envelope),
      submission: structuredClone(prepared.submission) as never,
      execution_authority: partyAuthority(asEngine(envelope), 'party_a', 'external_relay'),
    });
    expect(strict).toMatchObject({ status: 'rejected', reason_code: 'effect_rejected' });
    expect(future).toMatchObject({ status: 'rejected', reason_code: 'effect_rejected' });
    if (future.status !== 'rejected') throw new Error('expected rejected');
    expect(future.issues[0]!.code).toBe('v214_assertion_requirement');
  });
});

describe('Rows 6 and 7 — finite max_propositions is the real cardinality bound', () => {
  const MAX = 3;

  function atCapacity() {
    const requirementId = unique('req_finite_max');
    let envelope = boundEnvelope({ party_a: [finiteRequirement(requirementId, MAX)] });
    for (const text of ['First delivery fact.', 'Second delivery fact.', 'Third delivery fact.']) {
      envelope = recordFutureFact(envelope, 'party_a', requirementId, text);
    }
    expect(liveOwn(envelope, requirementId)).toHaveLength(MAX);
    return { envelope, requirementId };
  }

  it('row 6 — a correction WHILE AT the maximum is accepted, live count stable', () => {
    // The load-bearing case. A naive `current_count >= max -> reject` pre-check
    // refuses every correction at the maximum; the rule must be evaluated over
    // the POST-APPLICATION state, where one position leaves the live set as
    // another enters.
    const { envelope, requirementId } = atCapacity();
    const target = liveOwn(envelope, requirementId)[1]!;
    const answer = 'Correcting the second delivery fact.';
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
          supersedes_candidate: (target as unknown as { position_id: string }).position_id,
        },
      ],
    });
    const prepared = futurePrepare(scenario);
    if (prepared.status !== 'prepared') throw new Error(prepared.message);
    const applied = futureApply(scenario, prepared.submission);
    expect(applied.status).toBe('applied');
    if (applied.status !== 'applied') throw new Error('expected applied');
    expect(liveOwn(applied.envelope, requirementId)).toHaveLength(MAX);
  });

  it('row 7 — an additive proposition BEYOND the maximum is rejected', () => {
    const { envelope, requirementId } = atCapacity();
    const scenario = relayCase({ envelope, requirementId, answer: 'A fourth delivery fact.' });
    const prepared = futurePrepare(scenario);
    if (prepared.status !== 'prepared') throw new Error(prepared.message);
    const applied = futureApply(scenario, prepared.submission);
    expect(applied).toMatchObject({
      status: 'rejected',
      reason_code: 'resulting_envelope_invalid',
    });
    if (applied.status !== 'rejected') throw new Error('expected rejected');
    expect(applied.issues.map((entry) => entry.code)).toContain(
      'v214_requirement_live_cardinality_exceeded',
    );
    // Rejected atomically: the envelope comes back untouched.
    expect(applied.resulting_envelope_version).toBe(envelope.control.envelope_version);
  });

  it('a superseded proposition does not consume capacity', () => {
    const { envelope, requirementId } = atCapacity();
    const target = liveOwn(envelope, requirementId)[0]!;
    const answer = 'Replacing the first delivery fact.';
    const corrected = recordFutureFact(envelope, 'party_a', requirementId, answer, {
      supersedes_candidate: (target as unknown as { position_id: string }).position_id,
    });
    expect(Object.keys(corrected.positions)).toHaveLength(MAX + 1);
    expect(liveOwn(corrected, requirementId)).toHaveLength(MAX);
  });

  it('a non-satisfying proposition type does not consume satisfying capacity', () => {
    // Capacity counts only positions whose type SATISFIES the requirement, the
    // same definition readiness uses. A disputed_balance under a narrative_fact
    // requirement is recorded but does not fill a slot.
    const requirementId = unique('req_finite_max');
    let envelope = boundEnvelope({ party_a: [finiteRequirement(requirementId, 1)] });
    envelope = recordFutureFact(envelope, 'party_a', requirementId, 'The satisfying fact.');
    const answer = 'A disputed balance of 2,000 remains outstanding.';
    const scenario = relayCase({
      envelope,
      requirementId,
      answer,
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'disputed_balance',
          epistemic_strength: 'asserted_confident',
          statement: answer,
          spans: [answerSpan(turnId, answer)],
          supersedes_candidate: null,
        },
      ],
    });
    const prepared = futurePrepare(scenario);
    if (prepared.status !== 'prepared') throw new Error(prepared.message);
    expect(futureApply(scenario, prepared.submission).status).toBe('applied');
  });

  it('max_propositions null remains unbounded', () => {
    const requirementId = unique('req_unbounded');
    let envelope = boundEnvelope({ party_a: [requirementId] });
    for (const text of ['One.', 'Two.', 'Three.', 'Four.', 'Five.']) {
      envelope = recordFutureFact(envelope, 'party_a', requirementId, `Fact ${text}`);
    }
    expect(liveOwn(envelope, requirementId)).toHaveLength(5);
  });
});

describe('Rows 10 and 11 — ask narrowly, listen broadly', () => {
  it('row 10 — asked A, volunteered own B: old rejects B, future records both', () => {
    const reqA = unique('req_payment_terms');
    const reqB = unique('req_other_party_performance');
    const answer =
      'Yes, payment was due on delivery. Also, they delivered on July 15 and the contact form still did not work.';
    const solicited = 'payment was due on delivery';
    const volunteered = 'they delivered on July 15';
    const scenario = relayCase({
      envelope: boundEnvelope({ party_a: [reqA, reqB] }),
      requirementId: reqA,
      answer,
      // in_reply_to names ONLY what was asked. Stuffing reqB in here would
      // destroy the provenance distinction the whole design protects.
      inReplyTo: [reqA],
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: reqA,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: solicited,
          spans: [answerSpan(turnId, answer, solicited)],
          supersedes_candidate: null,
        },
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: reqB,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: volunteered,
          spans: [answerSpan(turnId, answer, volunteered)],
          supersedes_candidate: null,
        },
      ],
    });
    const { strict, future } = bothPolicies(scenario);
    expect(strict).toMatchObject({ status: 'rejected', reason_code: 'effect_rejected' });
    if (strict.status !== 'rejected') throw new Error('expected rejected');
    expect(strict.issues[0]!.code).toBe('v214_assertion_requirement');
    if (future.status !== 'applied') throw new Error('expected applied');
    expect(future.result.accepted_position_ids).toHaveLength(2);
    // The stored turn still records only what was ASKED, so solicited and
    // volunteered material stay distinguishable without a schema change.
    expect(future.envelope.source_turns[scenario.turnId]!.in_reply_to).toEqual([reqA]);
  });

  it('row 11 — bulk testimony over many own requirements while in_reply_to names three', () => {
    const asked = [unique('req_ask_1'), unique('req_ask_2'), unique('req_ask_3')];
    const volunteered = Array.from({ length: 7 }, (_, index) => unique(`req_vol_${index}`));
    const all = [...asked, ...volunteered];
    const clauses = all.map((id, index) => `Point ${index} about ${id}`);
    const answer = clauses.join('. ') + '.';
    const scenario = relayCase({
      envelope: boundEnvelope({ party_a: all }),
      requirementId: asked[0]!,
      answer,
      inReplyTo: [...asked].sort(),
      effects: (turnId) =>
        all.map((id, index) => ({
          type: 'semantic_assertion_candidate' as const,
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: id,
          proposed_type: 'narrative_fact' as const,
          epistemic_strength: 'asserted_confident' as const,
          statement: clauses[index]!,
          spans: [answerSpan(turnId, answer, clauses[index]!)],
          supersedes_candidate: null,
        })),
    });
    const { strict, future } = bothPolicies(scenario);
    expect(strict.status).toBe('rejected');
    if (future.status !== 'applied') throw new Error('expected applied');
    expect(future.result.accepted_position_ids).toHaveLength(all.length);
    expect(future.envelope.source_turns[scenario.turnId]!.in_reply_to).toEqual([...asked].sort());
  });
});

describe('Rows 8 and 9 — restatement and transport identity', () => {
  it('row 8 — the domain applies no dedup: a restatement is recorded', () => {
    // Suppressing restatement is the COMPILER's job (8C1b prompt doctrine).
    // The domain must not second-guess it: silently discarding possibly
    // distinct testimony is the failure direction an evidence system cannot
    // afford, and a similarity threshold here would be a component deciding
    // which testimony is "the same".
    const requirementId = unique('req_other_party_performance');
    let envelope = boundEnvelope({ party_a: [requirementId] });
    envelope = recordFutureFact(envelope, 'party_a', requirementId, FACT_A);
    const after = recordFutureFact(envelope, 'party_a', requirementId, FACT_A);
    expect(liveOwn(after, requirementId)).toHaveLength(2);
  });

  it('row 9 — identical wording under a NEW transport identity is a new turn', () => {
    const requirementId = unique('req_other_party_performance');
    let envelope = boundEnvelope({ party_a: [requirementId] });
    envelope = recordFutureFact(envelope, 'party_a', requirementId, FACT_A);
    const before = Object.keys(envelope.source_turns).length;
    const after = recordFutureFact(envelope, 'party_a', requirementId, FACT_A);
    // Idempotency is keyed on transport identity, not on text. The domain is
    // not, and must not become, a semantic duplicate detector.
    expect(Object.keys(after.source_turns).length).toBe(before + 1);
  });
});

describe('Rows 16 and 17 — cross-type correction is deliberate, cross-type append is not', () => {
  it('row 16 — an exact correction may change proposition type', () => {
    // Decided rather than inherited: a party correcting "no binding deadline
    // was agreed" into "July 1 was the agreed deadline" is a real correction,
    // and refusing it would leave the original permanently uncorrectable.
    const requirementId = unique('req_binding_deadline');
    let envelope = boundEnvelope({ party_a: [requirementId] });
    const denial = 'The party says no binding deadline was agreed.';
    envelope = recordFutureFact(envelope, 'party_a', requirementId, denial, {
      proposed_type: 'non_recollection',
      epistemic_strength: 'non_recollection',
    });
    const target = liveOwn(envelope, requirementId)[0]!;
    const answer = 'Correcting that: July 1 was agreed as the binding deadline.';
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
          supersedes_candidate: (target as unknown as { position_id: string }).position_id,
        },
      ],
    });
    const prepared = futurePrepare(scenario);
    if (prepared.status !== 'prepared') throw new Error(prepared.message);
    const applied = futureApply(scenario, prepared.submission);
    expect(applied.status).toBe('applied');
    if (applied.status !== 'applied') throw new Error('expected applied');
    expect(liveOwn(applied.envelope, requirementId)).toHaveLength(1);
    expect(
      (
        applied.envelope.positions[
          (target as unknown as { position_id: string }).position_id
        ] as unknown as { superseded_by: string | null }
      ).superseded_by,
    ).not.toBeNull();
  });

  it('row 17 — a cross-type append without supersedes_candidate stays a separate proposition', () => {
    // Correction is never INFERRED from disagreement. Without an explicit
    // target, a contradicting statement is a second position, not a silent
    // replacement of the first.
    const requirementId = unique('req_binding_deadline');
    let envelope = boundEnvelope({ party_a: [requirementId] });
    envelope = recordFutureFact(envelope, 'party_a', requirementId, 'No deadline was agreed.', {
      proposed_type: 'non_recollection',
      epistemic_strength: 'non_recollection',
    });
    const after = recordFutureFact(
      envelope,
      'party_a',
      requirementId,
      'July 1 was agreed as the binding deadline.',
    );
    expect(liveOwn(after, requirementId)).toHaveLength(2);
  });
});

describe('Row 14 — explicit absence and a target date in one answer', () => {
  it('both are retained independently under both policies', () => {
    const requirementId = unique('req_other_party_performance');
    const answer =
      'July 1 was always a target date, not a binding contractual deadline. They delivered on July 15.';
    const absence = 'July 1 was always a target date, not a binding contractual deadline.';
    const fact = 'They delivered on July 15.';
    const scenario = relayCase({
      envelope: boundEnvelope({ party_a: [requirementId] }),
      requirementId,
      answer,
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'target_date',
          epistemic_strength: 'asserted_confident',
          statement: absence,
          spans: [answerSpan(turnId, answer, absence)],
          supersedes_candidate: null,
        },
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: fact,
          spans: [answerSpan(turnId, answer, fact)],
          supersedes_candidate: null,
        },
      ],
    });
    const { strict, future } = bothPolicies(scenario);
    // Different types are different slots, so this already worked under the
    // frozen policy. Pinned so the future branch is not credited with it.
    expect(strict.status).toBe('applied');
    expect(future.status).toBe('applied');
    if (future.status !== 'applied') throw new Error('expected applied');
    expect(liveOwn(future.envelope, requirementId)).toHaveLength(2);
  });
});

describe('PR 8C1a: the two policies agree on TOTALITY, not just on verdicts', () => {
  /**
   * Regression for a P2 found by the automatic review at `38f3e71`.
   *
   * The finite-cardinality rule originally ran over the raw envelope. With a
   * malformed position — `positions.foo = null` — and a finite requirement,
   * the counting helper dereferenced `null.superseded_by` and THREW, while the
   * strict policy returned issues for the same input. That is a totality
   * divergence introduced by the new rule, not inherited from frozen V2.1.4,
   * and it broke the `validate(unknown)` contract 8C0b-1 established.
   *
   * The rule now sits inside the validated block, alongside every other check
   * that reads the envelope as typed data.
   */
  it('a malformed position is reported, not thrown, under BOTH policies', () => {
    const requirementId = unique('req_finite_totality');
    let envelope = boundEnvelope({ party_a: [finiteRequirement(requirementId, 2)] });
    envelope = recordFutureFact(envelope, 'party_a', requirementId, 'A recorded fact.');
    const broken = mutate(envelope, (draft) => {
      (draft.positions as unknown as Record<string, unknown>).foo = null;
    });

    const strict = createFormationValidator({ spec: rawV214Spec() });
    const future = createFormationValidator({ spec: rawFutureSpec() });
    const outcome = (run: () => unknown): string => {
      try {
        run();
        return 'ISSUES';
      } catch (error) {
        return `THREW: ${(error as Error).message}`;
      }
    };
    expect(outcome(() => future.validate(broken))).toBe('ISSUES');
    expect(outcome(() => future.validate(broken))).toBe(outcome(() => strict.validate(broken)));
    expect(future.validate(broken).map((entry) => entry.code)).toContain('v214_position_object');
  });

  it('non-envelope input is still handled identically under both policies', () => {
    const strict = createFormationValidator({ spec: rawV214Spec() });
    const future = createFormationValidator({ spec: rawFutureSpec() });
    for (const value of [null, 'envelope', 42, []]) {
      expect(future.validate(value)).toEqual(strict.validate(value));
    }
  });
});
