import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '../v2/case-envelope.js';
import { MemoryFormationRepository } from './v2-1-5-memory-repository.js';
import {
  TestCompilerV215,
  assertion,
  baseEnvelope,
  commandFor,
  req,
  serviceFor,
} from './v2-1-5-test-helpers.js';
import { projectPartyFormationV215 } from '../v2-1-5/party-projection.js';
import { validateCaseEnvelopeV215 } from '../v2-1-5/contract-validator.js';

function fixture() {
  const repository = new MemoryFormationRepository(baseEnvelope());
  const compiler = new TestCompilerV215();
  const service = serviceFor(repository, compiler);
  return { repository, compiler, service, id: repository.envelope.control.case_id };
}

describe('V2.1.5 production application: broad listening, narrow authority', () => {
  it('one reply target captures performance, payment, agreement and remedy in one qualified compile pass', async () => {
    const f = fixture();
    const facts = [
      assertion(req('other_party_performance'), 'They delivered on July 15.'),
      assertion(req('paid'), 'I paid 90 euro.', { type: 'payment' }),
      assertion(req('scope_accepted'), 'We agreed they would paint the gate.', {
        type: 'accepted_scope',
      }),
      assertion(req('remedy_sought'), 'I want a refund.', { type: 'requested_remedy' }),
    ];
    f.compiler.script = () => ({ verdict: 'accepted_candidates', assertions: facts });
    const command = await commandFor(f.service, f.id, facts.map((f) => f.quote).join(' '));
    const result = await f.service.submitTurn(command);
    expect(result).toMatchObject({ ok: true, recorded: expect.any(Array) });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.recorded).toHaveLength(4);
    expect(f.compiler.calls).toHaveLength(1);
    expect(f.compiler.calls[0]!.requirement_context).toHaveLength(12);
    expect(
      f.compiler.calls[0]!.requirement_context.every((r) =>
        r.requirement_id.startsWith('req_party_a_'),
      ),
    ).toBe(true);
    expect(f.compiler.calls[0]!.turn.in_reply_to).toEqual([req('other_party_performance')]);
    const source = Object.values(f.repository.envelope.source_turns)[0]!;
    expect(source.in_reply_to).toEqual(command.in_reply_to);
    // Solicited versus volunteered is derivable; no new canonical metadata.
    expect(Object.keys(source)).not.toContain('solicited');
    expect(
      Object.values(f.repository.envelope.positions).filter(
        (p) => !source.in_reply_to.includes(p.requirement_id),
      ),
    ).toHaveLength(3);
    expect(validateCaseEnvelopeV215(f.repository.envelope)).toEqual([]);
  });

  it('the same widened context cannot write an opponent requirement', async () => {
    const f = fixture();
    const before = canonicalSerialize(f.repository.envelope);
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance', 'party_b'), 'They delivered late.')],
    });
    expect(
      await f.service.submitTurn(await commandFor(f.service, f.id, 'They delivered late.')),
    ).toMatchObject({ ok: false });
    expect(f.compiler.calls[0]!.requirement_context).toHaveLength(12);
    expect(canonicalSerialize(f.repository.envelope)).toBe(before);
    expect(f.repository.commitCalls).toBe(0);
  });

  it('mixed strengths survive as two same-slot propositions', async () => {
    const f = fixture();
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [
        assertion(req('other_party_performance'), 'The lateness I state as fact'),
        assertion(
          req('other_party_performance'),
          'that it contributed significantly is my own assessment.',
          { epistemic_strength: 'asserted_qualified' },
        ),
      ],
    });
    const result = await f.service.submitTurn(
      await commandFor(
        f.service,
        f.id,
        'The lateness I state as fact; that it contributed significantly is my own assessment.',
      ),
    );
    expect(result.ok).toBe(true);
    const positions = Object.values(f.repository.envelope.positions);
    expect(positions.map((p) => p.epistemic_strength).sort()).toEqual([
      'asserted_confident',
      'asserted_qualified',
    ]);
    expect(positions.every((p) => p.superseded_by === null)).toBe(true);
    expect(
      projectPartyFormationV215(f.repository.envelope, 'party_a').own_material.positions,
    ).toHaveLength(2);
  });

  it('distinct same-type facts and a contradicting addition remain independent live propositions', async () => {
    const f = fixture();
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [
        assertion(req('other_party_performance'), 'They delivered the gate.'),
        assertion(req('other_party_performance'), 'They painted the door.'),
      ],
    });
    expect(
      (
        await f.service.submitTurn(
          await commandFor(f.service, f.id, 'They delivered the gate. They painted the door.'),
        )
      ).ok,
    ).toBe(true);
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance'), 'They did not paint the door.')],
    });
    expect(
      (
        await f.service.submitTurn(
          await commandFor(f.service, f.id, 'They did not paint the door.'),
        )
      ).ok,
    ).toBe(true);
    expect(
      Object.values(f.repository.envelope.positions).filter((p) => p.superseded_by === null),
    ).toHaveLength(3);
  });

  it('exact own supersession may change explicit absence into a contractual deadline', async () => {
    const f = fixture();
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [
        assertion(req('binding_deadline'), 'No binding deadline was agreed.', {
          type: 'explicit_absence',
        }),
      ],
    });
    expect(
      (
        await f.service.submitTurn(
          await commandFor(f.service, f.id, 'No binding deadline was agreed.', [
            req('binding_deadline'),
          ]),
        )
      ).ok,
    ).toBe(true);
    const old = Object.values(f.repository.envelope.positions)[0]!;
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [
        assertion(req('binding_deadline'), 'Actually July 1 was the agreed deadline.', {
          type: 'contractual_deadline',
          supersedes_candidate: old.position_id,
        }),
      ],
    });
    const result = await f.service.submitTurn(
      await commandFor(f.service, f.id, 'Actually July 1 was the agreed deadline.', [
        req('binding_deadline'),
        old.position_id,
      ]),
    );
    expect(result).toMatchObject({ ok: true, superseded: [old.position_id] });
    const live = Object.values(f.repository.envelope.positions).filter(
      (p) => p.superseded_by === null,
    );
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      proposition_type: 'contractual_deadline',
      supersedes: old.position_id,
    });
  });

  it('zero effect refuses before persistence and leaves the same client identity reusable', async () => {
    const f = fixture();
    const before = canonicalSerialize(f.repository.envelope);
    const empty = await commandFor(f.service, f.id, 'That is all.', undefined, 'reusable-key');
    expect(await f.service.submitTurn(empty)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(canonicalSerialize(f.repository.envelope)).toBe(before);
    expect(f.repository.replays.size).toBe(0);
    expect(f.repository.commitCalls).toBe(0);
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance'), 'They delivered late.')],
    });
    expect(
      (
        await f.service.submitTurn({
          ...empty,
          payload: { context: [], answer: { role: 'user', text: 'They delivered late.' } },
        })
      ).ok,
    ).toBe(true);
    expect(f.repository.replays.size).toBe(1);
  });

  it('assistant context cannot ground canonical human assertions', async () => {
    const f = fixture();
    const before = canonicalSerialize(f.repository.envelope);
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [
        assertion(req('paid'), 'You paid 9000 euro.', { type: 'payment', region: 'context' }),
      ],
    });
    const command = await commandFor(f.service, f.id, 'I am not sure.');
    command.payload.context.push({ role: 'assistant', text: 'You paid 9000 euro.' });
    expect((await f.service.submitTurn(command)).ok).toBe(false);
    expect(canonicalSerialize(f.repository.envelope)).toBe(before);
    expect(f.repository.commitCalls).toBe(0);
  });

  it('lost-response replay precedes cursor conflict and changed fingerprint conflicts without recompiling', async () => {
    const f = fixture();
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance'), 'They delivered late.')],
    });
    const command = await commandFor(f.service, f.id, 'They delivered late.');
    const first = await f.service.submitTurn(command);
    const replay = await f.service.submitTurn(command);
    expect(first.ok).toBe(true);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(
      await f.service.submitTurn({
        ...command,
        payload: { context: [], answer: { role: 'user', text: 'Different content.' } },
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(f.compiler.calls).toHaveLength(1);
  });

  it('hidden opponent contention rebases the already compiled submission without changing its visible cursor', async () => {
    const f = fixture();
    const bCompiler = new TestCompilerV215(() => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance', 'party_b'), 'I delivered on Monday.')],
    }));
    const b = serviceFor(f.repository, bCompiler, 'party_b');
    const before = structuredClone(f.repository.envelope.control.party_views.party_a);
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance'), 'They delivered late.')],
    });
    f.compiler.beforeModel = async () => {
      expect(
        (
          await b.submitTurn(
            await commandFor(
              b,
              f.id,
              'I delivered on Monday.',
              [req('other_party_performance', 'party_b')],
              'same-party-independent-key',
            ),
          )
        ).ok,
      ).toBe(true);
      expect(f.repository.envelope.control.party_views.party_a).toEqual(before);
    };
    const command = await commandFor(
      f.service,
      f.id,
      'They delivered late.',
      undefined,
      'same-party-independent-key',
    );
    expect((await f.service.submitTurn(command)).ok).toBe(true);
    expect(f.compiler.calls).toHaveLength(1);
    expect(f.repository.lastCommit!.submission.base_party_visible_version).toBe(
      before.party_visible_version,
    );
    expect(f.repository.lastCommit!.submission.base_party_projection_hash).toBe(
      before.party_projection_hash,
    );
    expect(f.repository.replays.size).toBe(2);
  });

  it('visible concurrent changes produce VERSION_CONFLICT without rerunning the model', async () => {
    const f = fixture();
    const otherCompiler = new TestCompilerV215(() => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance'), 'They painted a door.')],
    }));
    const concurrent = serviceFor(f.repository, otherCompiler);
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance'), 'They delivered late.')],
    });
    f.compiler.beforeModel = async () => {
      expect(
        (await concurrent.submitTurn(await commandFor(concurrent, f.id, 'They painted a door.')))
          .ok,
      ).toBe(true);
    };
    expect(
      await f.service.submitTurn(await commandFor(f.service, f.id, 'They delivered late.')),
    ).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
    expect(f.compiler.calls).toHaveLength(1);
    expect(f.repository.replays.size).toBe(1);
  });
});
