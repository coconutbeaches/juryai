import { describe, expect, it } from 'vitest';
import { MemoryFormationRepository } from './v2-1-5-memory-repository.js';
import {
  TestCompilerV215,
  assertion,
  baseEnvelope,
  commandFor,
  serviceFor,
  req,
  unique,
  ceremony,
} from './v2-1-5-test-helpers.js';
import {
  decodeCaseServiceResult,
  decodeCaseServiceHttpRequest,
} from '../webmcp/supported-public-contract.js';
import {
  decodeRepairCaseStateV215,
  type RepairCaseStateV215,
} from '../webmcp/repair-state-v215.js';
import { parseGetCaseStateToolInput, parseSubmitTurnToolInput } from '../webmcp/tools/schemas.js';
import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';
import { repairAuthorityFailure } from '../v2-1-5/repair-authority.js';
import { partyAuthorityV215, TRUSTED_SYSTEM_AUTHORITY_V215 } from '../v2-1-5/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV215,
  ceremonyCommandForV215,
} from '../v2-1-5/envelope-ceremony.js';
import { currentDisclosureReviewAcknowledgmentV215 } from '../v2-1-5/disclosure-review.js';
import { derivePartyReviewStateV215 } from '../v2-1-5/party-review-state.js';
import { discloseForChallenges } from './v2-1-5-test-helpers.js';

function fixture() {
  const repository = new MemoryFormationRepository(baseEnvelope());
  const compiler = new TestCompilerV215();
  const service = serviceFor(repository, compiler);
  return { repository, compiler, service, id: repository.envelope.control.case_id };
}
async function seed(f: ReturnType<typeof fixture>, text = 'They delivered on July 12.') {
  f.compiler.script = () => ({
    verdict: 'accepted_candidates',
    assertions: [assertion(req('other_party_performance'), text)],
  });
  const result = await f.service.submitTurn(await commandFor(f.service, f.id, text));
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return Object.values(f.repository.envelope.positions).find((p) => p.statement === text)!;
}

describe('8C3 agent-mediated repair dual gate', () => {
  it('appends a contradictory same-slot fact when no semantic correction is proposed', async () => {
    const f = fixture();
    const old = await seed(f);
    await seed(f, 'They delivered on July 15.');
    expect(Object.values(f.repository.envelope.positions)).toHaveLength(2);
    expect(f.repository.envelope.positions[old.position_id]!.superseded_by).toBeNull();
  });
  it.each(['unrelated fact', 'restatement'])(
    'a supplied target does not manufacture correction intent: %s',
    async (kind) => {
      const f = fixture();
      const old = await seed(f);
      const text = kind === 'restatement' ? old.statement : 'I paid another 500 on July 4.';
      f.compiler.script = () =>
        kind === 'restatement'
          ? { verdict: 'no_assertions' }
          : {
              verdict: 'accepted_candidates',
              assertions: [assertion(req('paid'), text, { type: 'payment' })],
            };
      const before = f.repository.commitCalls;
      const result = await f.service.submitTurn(
        await commandFor(f.service, f.id, text, [old.requirement_id, old.position_id]),
      );
      expect(result.ok).toBe(kind !== 'restatement');
      expect(f.repository.envelope.positions[old.position_id]!.superseded_by).toBeNull();
      if (kind === 'restatement') {
        expect(result).toMatchObject({ error: { code: 'INVALID_INPUT' } });
        expect(f.repository.commitCalls).toBe(before);
      }
    },
  );
  it('keeps exact correction and volunteered own facts, with truthful source and untouched text', async () => {
    const f = fixture();
    const old = await seed(f);
    const correction = 'July 12 was wrong; they delivered on July 15.';
    const payment = 'I paid another 500 on July 4.';
    const text = `${correction} ${payment}`;
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [
        assertion(old.requirement_id, correction, { supersedes_candidate: old.position_id }),
        assertion(req('paid'), payment, { type: 'payment' }),
      ],
    });
    const command = await commandFor(f.service, f.id, text, [old.requirement_id, old.position_id]);
    const result = await f.service.submitTurn(command);
    expect(result).toMatchObject({ ok: true, superseded: [old.position_id] });
    const source = f.repository.lastCommit!.submission.source_turn;
    expect(source.source_channel).toBe('webmcp_agent_relay');
    expect(source.payload).toEqual(command.payload);
    expect(source.in_reply_to).toEqual([...command.in_reply_to].sort());
    expect(f.compiler.calls.at(-1)!.turn.in_reply_to).toEqual([old.requirement_id]);
    expect(f.compiler.calls.at(-1)!.requirement_context.length).toBeGreaterThan(1);
    expect(f.repository.lastCommit!.submission.effects).toHaveLength(2);
    const calls = f.compiler.calls.length;
    expect(await f.service.submitTurn(command)).toMatchObject({ ok: true, replayed: true });
    expect(f.compiler.calls).toHaveLength(calls);
    const changedTarget = { ...command, in_reply_to: [old.requirement_id] };
    expect(await f.service.submitTurn(changedTarget)).toMatchObject({
      error: { code: 'CONFLICT' },
    });
    expect(f.compiler.calls).toHaveLength(calls);
  });
  it.each(['missing', 'different', 'multiple'])(
    'rejects %s supersession authority without consuming the key',
    async (kind) => {
      const f = fixture();
      const old = await seed(f);
      const other = await seed(f, 'They delivered a second parcel.');
      const text = 'The first date was wrong; it was July 15.';
      f.compiler.script = () => ({
        verdict: 'accepted_candidates',
        assertions: [
          assertion(old.requirement_id, text, {
            supersedes_candidate: kind === 'different' ? other.position_id : old.position_id,
          }),
          ...(kind === 'multiple'
            ? [assertion(old.requirement_id, text, { supersedes_candidate: other.position_id })]
            : []),
        ],
      });
      const command = await commandFor(
        f.service,
        f.id,
        text,
        kind === 'missing' ? [old.requirement_id] : [old.requirement_id, old.position_id],
      );
      const before = structuredClone(f.repository.envelope),
        commits = f.repository.commitCalls;
      expect(await f.service.submitTurn(command)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_INPUT' },
      });
      expect(f.repository.envelope).toEqual(before);
      expect(f.repository.commitCalls).toBe(commits);
      f.compiler.script = () => ({ verdict: 'no_assertions' });
      expect(await f.service.submitTurn(command)).toMatchObject({
        error: { code: 'INVALID_INPUT' },
      });
      expect(f.compiler.calls).toHaveLength(4);
    },
  );
  it.each(['two own targets', 'wrong requirement', 'opponent target', 'unknown target'])(
    'rejects %s before compiler execution',
    async (kind) => {
      const f = fixture();
      const old = await seed(f);
      const other = await seed(f, 'A separate delivery.');
      const targets =
        kind === 'two own targets'
          ? [old.requirement_id, old.position_id, other.position_id]
          : kind === 'wrong requirement'
            ? [req('paid'), old.position_id]
            : kind === 'opponent target'
              ? [req('other_party_performance', 'party_b'), old.position_id]
              : [old.requirement_id, 'position_party_a_missing'];
      const calls = f.compiler.calls.length;
      expect(
        await f.service.submitTurn(
          await commandFor(f.service, f.id, 'That date was wrong.', targets),
        ),
      ).toMatchObject({ ok: false });
      expect(f.compiler.calls).toHaveLength(calls);
    },
  );
  it('a new key cannot correct a now-superseded target', async () => {
    const f = fixture();
    const old = await seed(f);
    const text = 'The old date was wrong; July 15 is correct.';
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(old.requirement_id, text, { supersedes_candidate: old.position_id })],
    });
    expect(
      await f.service.submitTurn(
        await commandFor(f.service, f.id, text, [old.requirement_id, old.position_id]),
      ),
    ).toMatchObject({ ok: true });
    const calls = f.compiler.calls.length;
    expect(
      await f.service.submitTurn(
        await commandFor(f.service, f.id, text, [old.requirement_id, old.position_id]),
      ),
    ).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(f.compiler.calls).toHaveLength(calls);
  });
  it('enforces the same target bound at domain admission after compilation', async () => {
    const f = fixture();
    const old = await seed(f);
    const other = await seed(f, 'A second parcel.');
    expect(
      repairAuthorityFailure(
        f.repository.envelope,
        'party_a',
        [old.requirement_id, old.position_id],
        [
          {
            type: 'semantic_assertion_candidate',
            compiler_assertion_id: 'assertion_test',
            requirement_id: old.requirement_id,
            proposed_type: 'narrative_fact',
            epistemic_strength: 'asserted_confident',
            statement: 'Wrong target.',
            spans: [],
            supersedes_candidate: other.position_id,
          },
        ],
      ),
    ).not.toBeNull();
  });
  it('never grounds a correction in assistant context or target metadata', async () => {
    const f = fixture();
    const old = await seed(f);
    for (const region of ['context', 'answer'] as const) {
      f.compiler.script = () => ({
        verdict: 'accepted_candidates',
        assertions: [
          assertion(old.requirement_id, old.position_id, {
            supersedes_candidate: old.position_id,
            region,
            message_index: 0,
          }),
        ],
      });
      const command = await commandFor(f.service, f.id, 'I am not changing anything.', [
        old.requirement_id,
        old.position_id,
      ]);
      command.payload.context = [{ role: 'assistant', text: old.position_id }];
      const before = structuredClone(f.repository.envelope);
      expect(await f.service.submitTurn(command)).toMatchObject({ ok: false });
      expect(f.repository.envelope).toEqual(before);
    }
  });
});

describe('complete bounded own-target discovery', () => {
  it('retains distinguishing tails of long own statements through the HTTP boundary', async () => {
    const f = fixture();
    const prefix = 'The delivery details were recorded. '.repeat(380);
    // Canonical compiler output can be longer than the recent-position preview.
    const first = await seed(f, `${prefix}It arrived on July 12.`);
    const second = await seed(f, `${prefix}It arrived on July 15.`);
    const result = decodeCaseServiceResult(
      'getCaseState',
      await f.service.getCaseState({ case_id: f.id }),
    );
    if (!result.ok) throw new Error('Missing own targets');
    const page = decodeRepairCaseStateV215(result.case).own_repair_targets.positions;
    expect(page.find((p) => p.proposition_id === first.position_id)!.statement).toContain(
      'It arrived on July 12.',
    );
    expect(page.find((p) => p.proposition_id === second.position_id)!.statement).toContain(
      'It arrived on July 15.',
    );
    expect(page.every((p) => !p.statement.includes('[truncated]'))).toBe(true);
  });
  it('retrieves older own targets across pages through the actual tool and HTTP decoders', async () => {
    const f = fixture();
    const facts = Array.from({ length: 55 }, (_, n) => `Parcel ${n} arrived.`);
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: facts.map((text) => assertion(req('other_party_performance'), text)),
    });
    expect(
      await f.service.submitTurn(await commandFor(f.service, f.id, facts.join(' '))),
    ).toMatchObject({ ok: true });
    const first = await f.service.getCaseState({ case_id: f.id });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const state = decodeRepairCaseStateV215(first.case);
    expect(state.recent_interpretations).toHaveLength(5);
    expect(state.own_repair_targets.positions).toHaveLength(50);
    const query = parseGetCaseStateToolInput({
      case_id: f.id,
      own_position_cursor: state.own_repair_targets.next_cursor,
    });
    expect(decodeCaseServiceHttpRequest({ operation: 'getCaseState', input: query })).toEqual({
      operation: 'getCaseState',
      input: query,
    });
    const tool = createJuryAiToolDefinitions({
      ...f.service,
      startCase: async () => {
        throw new Error('Start is not part of this repair test.');
      },
    }).find((t) => t.name === 'get_case_state')!;
    const result = (await tool.execute(query)) as { data: { ok: true; case: RepairCaseStateV215 } };
    expect(result.data.ok).toBe(true);
    const decoded = decodeCaseServiceResult('getCaseState', result.data);
    if (!decoded.ok) throw new Error('Invalid page');
    const second = decodeRepairCaseStateV215(decoded.case);
    expect(second.own_repair_targets.positions).toHaveLength(5);
    expect(second.own_repair_targets.next_cursor).toBeNull();
    expect(
      new Set(
        [...state.own_repair_targets.positions, ...second.own_repair_targets.positions].map(
          (p) => p.proposition_id,
        ),
      ).size,
    ).toBe(55);
    await seed(f, 'Another event.');
    expect(await f.service.getCaseState(query)).toMatchObject({ error: { code: 'CONFLICT' } });
  });
  it('rejects malformed cursor/control additions and retains the three-tool contract', () => {
    expect(() =>
      parseGetCaseStateToolInput({
        own_position_cursor: { party_visible_version: 1, after_position_id: 'position_party_a_x' },
      }),
    ).toThrow();
    expect(() =>
      parseGetCaseStateToolInput({
        case_id: 'dispute_x',
        own_position_cursor: { party_visible_version: -1, after_position_id: 'position_party_a_x' },
      }),
    ).toThrow();
    expect(() =>
      parseSubmitTurnToolInput({
        case_id: 'dispute_x',
        expected_case_version: 1,
        in_reply_to: ['req_party_a_paid'],
        context: [],
        answer: { text: 'I paid.' },
        correction_authorized: true,
      }),
    ).toThrow();
    expect(createJuryAiToolDefinitions({} as never).map((t) => t.name)).toEqual([
      'start_case',
      'get_case_state',
      'submit_turn',
    ]);
  });
});

describe('first-party non-testimonial return to edit', () => {
  async function finalFixture() {
    const f = fixture();
    await discloseForChallenges(f.repository, f.id);
    let envelope = f.repository.envelope;
    for (const party of ['party_a', 'party_b'] as const)
      envelope = ceremony(
        envelope,
        {
          type: 'record_disclosure_review_acknowledgment',
          acknowledgment_id: unique(`disclosure_ack_${party}`),
          event_id: unique(`disclosure_ack_event_${party}`),
          acknowledged_at: new Date().toISOString(),
        },
        party,
      );
    envelope = ceremony(envelope, { type: 'enter_final_confirmation' });
    return { ...f, envelope };
  }
  it('changes only the unconfirmed epoch/workflow, retaining source and receipt history', async () => {
    const f = await finalFixture();
    const before = f.envelope;
    const after = ceremony(
      before,
      {
        type: 'return_unconfirmed_to_edit',
        event_id: unique('reopen_event_party_a'),
        occurred_at: new Date().toISOString(),
      },
      'party_a',
    );
    expect(after.control.workflow_state).toBe('challenge_response');
    expect(after.parties.party_a.formation_epoch).toBe(before.parties.party_a.formation_epoch + 1);
    expect(currentDisclosureReviewAcknowledgmentV215(after, 'party_a')).toBeNull();
    expect(after.formation.disclosure_review_acknowledgments).toEqual(
      before.formation.disclosure_review_acknowledgments,
    );
    expect(after.source_turns).toEqual(before.source_turns);
    expect(after.positions).toEqual(before.positions);
    expect(derivePartyReviewStateV215(after, 'party_a').review_state_hash).not.toBe(
      derivePartyReviewStateV215(before, 'party_a').review_state_hash,
    );
  });
  it.each(['external_relay', 'system', 'confirmed'])(
    'refuses return-to-edit from %s authority/state',
    async (kind) => {
      const f = await finalFixture();
      const envelope =
        kind === 'confirmed'
          ? ceremony(
              f.envelope,
              {
                type: 'record_party_confirmation',
                confirmation_id: unique('confirmation_party_a'),
                event_id: unique('confirmation_event_party_a'),
                adoption_statement: 'I confirm my account.',
                confirmed_at: new Date().toISOString(),
              },
              'party_a',
            )
          : f.envelope;
      const result = applyEnvelopeCeremonyCommandV215({
        envelope,
        command: ceremonyCommandForV215(envelope, unique('command'), {
          type: 'return_unconfirmed_to_edit',
          event_id: unique('reopen_event_party_a'),
          occurred_at: new Date().toISOString(),
        }),
        execution_authority:
          kind === 'system'
            ? TRUSTED_SYSTEM_AUTHORITY_V215
            : partyAuthorityV215(
                envelope,
                'party_a',
                kind === 'external_relay' ? 'external_relay' : 'first_party_human',
              ),
      });
      expect(result.status).toBe('rejected');
      expect(result.envelope).toEqual(envelope);
    },
  );
});
