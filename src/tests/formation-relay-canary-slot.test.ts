/**
 * PR 8C0b-2 — the canary-derived slot behaviour, reproduced not repaired.
 *
 * The frozen production regression case exposed a case-formation gap: a party
 * that has already recorded one narrative fact against a requirement cannot
 * add a second, and a compile run cannot emit two assertions for the same
 * slot. Three layers reject that. 8C0b-1 pinned the validator backstop
 * (`v214_live_position_slot_duplicate`); this suite pins the two RELAY layers
 * that fire first in practice.
 *
 * These are frozen V2.1.4 semantics, not defects to fix here. 8C1 owns the
 * change, and reproducing them exactly is what makes 8C1's change reviewable
 * as a deliberate decision rather than an accident of extraction.
 *
 * The live dispute is NEVER read or mutated. Every fixture is built in memory
 * by driving the frozen implementation.
 */

import { describe, expect, it } from 'vitest';
import {
  answerSpan,
  bothApply,
  boundEnvelope,
  bytes,
  recordFact,
  relayCase,
  unique,
} from './formation-relay-fixtures.js';

describe('PR 8C0b-2 · a second live fact in an occupied slot', () => {
  it('is rejected with v214_live_position_slot_collision, identically on both', () => {
    const requirementId = unique('req_other_party_performance');
    let envelope = boundEnvelope({ party_a: [requirementId] });
    envelope = recordFact(
      envelope,
      'party_a',
      requirementId,
      'The site was delivered on 15 July, two weeks after the agreed date.',
    );

    const answer = 'The contact form and the mobile presentation were also incomplete.';
    const scenario = relayCase({ envelope, requirementId, answer });
    const { frozen, shared } = bothApply(scenario);

    expect(frozen).toMatchObject({
      status: 'rejected',
      reason_code: 'effect_rejected',
      message: 'Live position slot already exists.',
    });
    if (frozen.status !== 'rejected') throw new Error('expected rejected');
    expect(frozen.issues).toEqual([
      {
        code: 'v214_live_position_slot_collision',
        path: 'submission.effects[0]',
        message: 'Live position slot already exists.',
      },
    ]);
    expect(bytes(shared)).toBe(bytes(frozen));
    // The envelope must come back untouched, at the same version.
    expect(frozen.resulting_envelope_version).toBe(envelope.control.envelope_version);
    expect(bytes(frozen.envelope)).toBe(bytes(envelope));
  });

  it('is accepted when it supersedes the position already in the slot', () => {
    // The rule is about LIVE positions. Correction still works, and a relay
    // that rejected this would break every supersession — worth pinning so the
    // frozen rule cannot be over-tightened during extraction.
    const requirementId = unique('req_other_party_performance');
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
});

describe('PR 8C0b-2 · two assertions for one slot in a single submission', () => {
  it('is rejected with v214_assertion_slot_duplicate, identically on both', () => {
    const requirementId = unique('req_other_party_performance');
    const envelope = boundEnvelope({ party_a: [requirementId] });
    const answer = 'Delivery was late and the contact form was incomplete.';
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
          statement: 'Delivery was late',
          spans: [answerSpan(turnId, answer, 'Delivery was late')],
          supersedes_candidate: null,
        },
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'the contact form was incomplete',
          spans: [answerSpan(turnId, answer, 'the contact form was incomplete')],
          supersedes_candidate: null,
        },
      ],
    });
    const { frozen, shared } = bothApply(scenario);
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'effect_rejected' });
    if (frozen.status !== 'rejected') throw new Error('expected rejected');
    expect(frozen.issues).toEqual([
      {
        code: 'v214_assertion_slot_duplicate',
        path: 'submission.effects[1]',
        message: 'Compiler assertion slot is duplicated.',
      },
    ]);
    expect(bytes(shared)).toBe(bytes(frozen));
  });
});

describe('PR 8C0b-2 · the mixed-strength case, preserved exactly as V2.1.4 decides it', () => {
  /**
   * The canary sentence:
   *
   *   "The lateness I state as fact; that it contributed significantly is my
   *   own assessment."
   *
   * One answer carrying one fact and one assessment about the same
   * requirement. Under V2.1.4 the two clauses cannot both be recorded when
   * they share a proposition type, because the slot is keyed on
   * `(party, requirement, proposition_type)` and takes no account of
   * epistemic strength.
   *
   * 8C1 OWNS CHANGING THIS. Pinning the current outcome here is deliberate:
   * without it, 8C1 would have no baseline to show what its semantics actually
   * changed.
   */
  const SENTENCE =
    'The lateness I state as fact; that it contributed significantly is my own assessment.';

  it('same type, differing strength: the second is refused on the slot rule', () => {
    const requirementId = unique('req_other_party_nonperformance');
    const envelope = boundEnvelope({ party_a: [requirementId] });
    const scenario = relayCase({
      envelope,
      requirementId,
      answer: SENTENCE,
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'The lateness I state as fact',
          spans: [answerSpan(turnId, SENTENCE, 'The lateness I state as fact')],
          supersedes_candidate: null,
        },
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_qualified',
          statement: 'that it contributed significantly is my own assessment',
          spans: [
            answerSpan(turnId, SENTENCE, 'that it contributed significantly is my own assessment'),
          ],
          supersedes_candidate: null,
        },
      ],
    });
    const { frozen, shared } = bothApply(scenario);
    // Epistemic strength is NOT part of the slot key, so differing strength
    // does not rescue the second assertion.
    expect(frozen).toMatchObject({ status: 'rejected', reason_code: 'effect_rejected' });
    if (frozen.status !== 'rejected') throw new Error('expected rejected');
    expect(frozen.issues[0]!.code).toBe('v214_assertion_slot_duplicate');
    expect(bytes(shared)).toBe(bytes(frozen));
  });

  it('differing proposition types are accepted, showing where the limit actually bites', () => {
    // The same sentence succeeds when the two clauses land in different slots.
    // The limitation is one-live-per-(requirement, type), not one-per-answer —
    // stating that precisely keeps 8C1 aimed at the real constraint.
    const requirementId = unique('req_other_party_nonperformance');
    const envelope = boundEnvelope({ party_a: [requirementId] });
    const scenario = relayCase({
      envelope,
      requirementId,
      answer: SENTENCE,
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'The lateness I state as fact',
          spans: [answerSpan(turnId, SENTENCE, 'The lateness I state as fact')],
          supersedes_candidate: null,
        },
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_assertion'),
          requirement_id: requirementId,
          proposed_type: 'disputed_balance',
          epistemic_strength: 'asserted_qualified',
          statement: 'that it contributed significantly is my own assessment',
          spans: [
            answerSpan(turnId, SENTENCE, 'that it contributed significantly is my own assessment'),
          ],
          supersedes_candidate: null,
        },
      ],
    });
    const { frozen, shared } = bothApply(scenario);
    expect(bytes(shared)).toBe(bytes(frozen));
    expect(frozen.status).toBe('applied');
    if (frozen.status !== 'applied') throw new Error('expected applied');
    expect(frozen.result.accepted_position_ids).toHaveLength(2);
  });
});
