import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../v2/case-envelope.js';
import {
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  TRUSTED_SYSTEM_AUTHORITY_V211,
  partyAuthorityV211,
  type CaseEnvelopeV211,
  type FormationRequirementV211,
  type PartyIdV211,
} from '../v2-1-1/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV211,
  ceremonyCommandForV211,
  createInitialCaseEnvelopeV211,
} from '../v2-1-1/envelope-ceremony.js';
import {
  TRUSTED_EXTERNAL_RELAY_BRIDGE_V211,
  prepareExternalRelaySubmissionV211,
  trustedExternalRelayRuntimeV211,
  type ExternalRelayEffectCandidateV211,
  type ExternalRelaySubmissionV211,
} from '../v2-1-1/external-relay-submission.js';
import type {
  CommitExternalRelaySubmissionInputV211,
  FormationPartyPersistenceContextV211,
} from '../v2-1-1/formation-persistence.js';
import { resolveFormationReplayObjectsV211 } from '../v2-1-1/formation-persistence.js';
import { PostgresFormationRepositoryV211 } from '../v2-1-1/postgres-formation-repository.js';
import type { SourceTurnPayload, TurnSpan } from '../webmcp/core/turns.js';

const DATABASE_URL = process.env.JURYAI_TEST_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'v2-1-1-persistence.test.ts requires JURYAI_TEST_DATABASE_URL pointing to an isolated database.',
  );
}

const pool = new Pool({ connectionString: DATABASE_URL });
const storeA = new PostgresFormationRepositoryV211({ connectionString: DATABASE_URL });
const storeB = new PostgresFormationRepositoryV211({ connectionString: DATABASE_URL });
let sequence = 0;

beforeAll(async () => {
  await Promise.all([storeA.assertReady(), storeB.assertReady()]);
});

afterAll(async () => {
  await Promise.all([storeA.close(), storeB.close(), pool.end()]);
});

function unique(label: string): string {
  sequence += 1;
  return `${label}_${process.pid}_${sequence}`;
}

function requirement(id: string): Omit<FormationRequirementV211, 'party_id'> {
  return {
    requirement_id: id,
    label: id,
    prompt: `Answer ${id}.`,
    required: true,
    satisfying_types: ['narrative_fact'],
    min_propositions: 1,
    max_propositions: null,
    adverse_fact_probe: false,
    reopened_from: null,
  };
}

function bind(envelope: CaseEnvelopeV211, partyId: PartyIdV211, subject: string): CaseEnvelopeV211 {
  const applied = applyEnvelopeCeremonyCommandV211({
    envelope,
    command: ceremonyCommandForV211(envelope, unique('ceremony_bind'), {
      type: 'bind_party',
      party_slot: partyId,
      authenticated_subject_id: subject,
      binding_event_id: unique(`binding_${partyId}`),
    }),
    execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
  });
  if (applied.status !== 'applied') throw new Error(applied.message);
  return applied.envelope;
}

function envelopeWithBoth(disputeId: string, subjectA: string, subjectB: string): CaseEnvelopeV211 {
  let envelope = createInitialCaseEnvelopeV211(disputeId, {
    party_a: [requirement('req_a_story'), requirement('req_a_second')],
    party_b: [requirement('req_b_story')],
  });
  envelope = bind(envelope, 'party_a', subjectA);
  return bind(envelope, 'party_b', subjectB);
}

function answerSpan(turnId: string, answer: string, quote = answer): TurnSpan {
  const start = answer.indexOf(quote);
  return {
    turn_id: turnId,
    region: 'answer',
    message_index: null,
    encoding: 'utf16',
    start,
    end: start + quote.length,
    quote,
  };
}

function prepare(input: {
  envelope: CaseEnvelopeV211;
  party_id: PartyIdV211;
  client_turn_id: string;
  payload: SourceTurnPayload;
  in_reply_to: string[];
  effects: (turnId: string) => ExternalRelayEffectCandidateV211[];
}): ExternalRelaySubmissionV211 {
  const turnId = unique(`turn_${input.party_id}`);
  const effects = input.effects(turnId);
  const result = prepareExternalRelaySubmissionV211({
    envelope: input.envelope,
    execution_authority: partyAuthorityV211(input.envelope, input.party_id, 'external_relay'),
    intent: {
      intent_version: 'juryai-external-relay-submission-intent-v2.1.1',
      expected_party_visible_version:
        input.envelope.control.party_views[input.party_id].party_visible_version,
      expected_party_projection_hash:
        input.envelope.control.party_views[input.party_id].party_projection_hash,
      client_turn_id: input.client_turn_id,
      in_reply_to: input.in_reply_to,
      payload: input.payload,
      source_language: 'en',
      translation_indicated: false,
    },
    runtime: trustedExternalRelayRuntimeV211(TRUSTED_EXTERNAL_RELAY_BRIDGE_V211, {
      source_channel: 'webmcp_agent_relay',
      relaying_agent: 'persistence-test-relay',
      received_at: new Date(
        Date.parse('2026-09-02T09:00:00.000Z') + sequence * 1_000,
      ).toISOString(),
      payload_commitment_salt: `persistence-salt-${unique('salt')}-0123456789`,
      ids: {
        submission_id: unique(`submission_${input.party_id}`),
        source_turn_id: turnId,
        position_ids: effects
          .filter((effect) => effect.type === 'semantic_assertion_candidate')
          .map(() => unique(`position_${input.party_id}`)),
        clarification_ids: effects
          .filter((effect) => effect.type === 'clarification_request')
          .map(() => unique(`clarification_${input.party_id}`)),
        challenge_ids: effects
          .filter((effect) => effect.type === 'challenge_candidate')
          .map(() => unique(`challenge_${input.party_id}`)),
        challenge_response_ids: effects
          .filter((effect) => effect.type === 'challenge_response_candidate')
          .map(() => unique(`challenge_response_${input.party_id}`)),
      },
    }),
    compiler_run: {
      compile_run_id: unique(`compile_run_${input.party_id}`),
      compiler_version_id: sha256('v211-persistence-compiler'),
      party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
      input_hash: sha256(`input-${sequence}`),
      output_hash: sha256(`output-${sequence}`),
    },
    effects,
  });
  if (result.status !== 'prepared') throw new Error(result.message);
  return result.submission;
}

function oneAssertion(
  envelope: CaseEnvelopeV211,
  partyId: PartyIdV211,
  clientTurnId: string,
  requirementId: string,
  answer: string,
): ExternalRelaySubmissionV211 {
  return prepare({
    envelope,
    party_id: partyId,
    client_turn_id: clientTurnId,
    payload: { context: [], answer: { role: 'user', text: answer } },
    in_reply_to: [requirementId],
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
    ],
  });
}

function commitInput(
  context: FormationPartyPersistenceContextV211,
  submission: ExternalRelaySubmissionV211,
): CommitExternalRelaySubmissionInputV211 {
  return {
    context,
    submission,
    source_id: unique(`source_${context.party_id}`),
    recorded_at_ms: Date.parse('2026-09-02T09:00:00.000Z') + sequence,
  };
}

async function createStored(label: string): Promise<{
  dispute_id: string;
  subject_a: string;
  subject_b: string;
  envelope: CaseEnvelopeV211;
}> {
  const disputeId = `dispute_${unique(label)}`;
  const subjectA = unique(`${label}_subject_a`);
  const subjectB = unique(`${label}_subject_b`);
  const envelope = envelopeWithBoth(disputeId, subjectA, subjectB);
  await storeA.createDispute(envelope);
  return { dispute_id: disputeId, subject_a: subjectA, subject_b: subjectB, envelope };
}

async function counts(disputeId: string): Promise<Record<string, number>> {
  const result = await pool.query<{ table_name: string; count: number }>(
    `select table_name, count from (
       select 'formation_sources' table_name, count(*)::int count from juryai_v21.formation_sources where dispute_id = $1
       union all select 'formation_commands', count(*)::int from juryai_v21.formation_commands where dispute_id = $1
       union all select 'formation_submissions', count(*)::int from juryai_v21.formation_submissions where dispute_id = $1
       union all select 'formation_compiler_runs', count(*)::int from juryai_v21.formation_compiler_runs where dispute_id = $1
       union all select 'formation_replays', count(*)::int from juryai_v21.formation_replays where dispute_id = $1
     ) counts`,
    [disputeId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.table_name, row.count]));
}

describe('V2.1.1 external submission persistence', () => {
  it('atomically stores one source, one logical submission, one compiler run, one replay, and N positions', async () => {
    const seeded = await createStored('multi_effect');
    const context = await storeA.resolvePartyContext(seeded.dispute_id, seeded.subject_a);
    if (!context) throw new Error('expected party A context');
    const answer = 'The work stopped, and the delivery was late.';
    const submission = prepare({
      envelope: seeded.envelope,
      party_id: 'party_a',
      client_turn_id: unique('shared_turn'),
      payload: { context: [], answer: { role: 'user', text: answer } },
      in_reply_to: ['req_a_second', 'req_a_story'],
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('assertion_one'),
          requirement_id: 'req_a_story',
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'The work stopped.',
          spans: [answerSpan(turnId, answer, 'work stopped')],
          supersedes_candidate: null,
        },
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('assertion_two'),
          requirement_id: 'req_a_second',
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: 'The delivery was late.',
          spans: [answerSpan(turnId, answer, 'delivery was late')],
          supersedes_candidate: null,
        },
      ],
    });
    const committed = await storeA.commitExternalRelaySubmission(commitInput(context, submission));
    expect(committed.status).toBe('committed');
    if (committed.status !== 'committed') return;
    expect(committed.response.accepted_position_ids).toHaveLength(2);
    expect(committed.response.source_turn_id).toBe(submission.source_turn.turn_id);
    expect(committed.response.resulting_internal_envelope_version).toBe(
      seeded.envelope.control.envelope_version + 1,
    );
    expect(
      new Set(
        committed.response.accepted_position_ids.map(
          (id) => committed.stored.envelope.positions[id]!.source_turn_id,
        ),
      ),
    ).toEqual(new Set([submission.source_turn.turn_id]));
    expect(await counts(seeded.dispute_id)).toEqual({
      formation_sources: 1,
      formation_commands: 0,
      formation_submissions: 1,
      formation_compiler_runs: 1,
      formation_replays: 1,
    });
  });

  it('replays the stored logical receipt deterministically and rejects fingerprint reuse', async () => {
    const seeded = await createStored('replay');
    const context = await storeA.resolvePartyContext(seeded.dispute_id, seeded.subject_a);
    if (!context) throw new Error('expected context');
    const submission = oneAssertion(
      seeded.envelope,
      'party_a',
      unique('client_replay'),
      'req_a_story',
      'The first replayed fact.',
    );
    const input = commitInput(context, submission);
    const first = await storeA.commitExternalRelaySubmission(input);
    expect(first.status).toBe('committed');
    const fresh = await storeA.resolvePartyContext(seeded.dispute_id, seeded.subject_a);
    if (!fresh || first.status !== 'committed') throw new Error('expected committed context');
    const replay = await storeA.commitExternalRelaySubmission({ ...input, context: fresh });
    expect(replay).toMatchObject({ status: 'replayed', response: first.response });
    const mismatched = {
      ...submission,
      source_turn: { ...submission.source_turn, request_fingerprint: sha256('other-request') },
    };
    expect(
      await storeA.commitExternalRelaySubmission({
        ...input,
        context: fresh,
        submission: mismatched,
      }),
    ).toEqual({ status: 'idempotency_conflict', replayed: false });

    const afterFirst = await storeA.findById(seeded.dispute_id);
    if (!afterFirst) throw new Error('expected stored first result');
    const firstPosition = first.response.accepted_position_ids[0]!;
    const replacementAnswer = 'The corrected replayed fact.';
    const replacement = prepare({
      envelope: afterFirst.envelope,
      party_id: 'party_a',
      client_turn_id: unique('client_replacement'),
      payload: { context: [], answer: { role: 'user', text: replacementAnswer } },
      in_reply_to: ['req_a_story'],
      effects: (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('compiler_replacement'),
          requirement_id: 'req_a_story',
          proposed_type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: replacementAnswer,
          spans: [answerSpan(turnId, replacementAnswer)],
          supersedes_candidate: firstPosition,
        },
      ],
    });
    const replacementContext = await storeA.resolvePartyContext(
      seeded.dispute_id,
      seeded.subject_a,
    );
    if (!replacementContext) throw new Error('expected replacement context');
    expect(
      await storeA.commitExternalRelaySubmission(commitInput(replacementContext, replacement)),
    ).toMatchObject({ status: 'committed' });
    const latestContext = await storeA.resolvePartyContext(seeded.dispute_id, seeded.subject_a);
    if (!latestContext) throw new Error('expected latest context');
    expect(await storeA.readReplay(latestContext, submission.source_turn.client_turn_id)).toEqual(
      first.response,
    );
    const finalStored = await storeA.findById(seeded.dispute_id);
    expect(finalStored?.envelope.positions[firstPosition]).toMatchObject({
      superseded_by:
        replacement.effects[0]?.type === 'semantic_assertion_candidate'
          ? replacement.effects[0].position_id
          : null,
    });
    if (!finalStored) throw new Error('expected final stored envelope');
    const resolvedReplay = resolveFormationReplayObjectsV211(finalStored.envelope, first.response);
    expect(resolvedReplay.accepted_positions).toHaveLength(1);
    expect(resolvedReplay.accepted_positions[0]).toMatchObject({
      position_id: firstPosition,
      statement: 'The first replayed fact.',
      superseded_by:
        replacement.effects[0]?.type === 'semantic_assertion_candidate'
          ? replacement.effects[0].position_id
          : null,
    });
    expect(await counts(seeded.dispute_id)).toMatchObject({
      formation_replays: 2,
      formation_sources: 2,
    });
  });

  it('keeps identical client_turn_id values independent across parties and never exposes cross-party replay', async () => {
    const seeded = await createStored('cross_party');
    const contextA = await storeA.resolvePartyContext(seeded.dispute_id, seeded.subject_a);
    const contextB = await storeB.resolvePartyContext(seeded.dispute_id, seeded.subject_b);
    if (!contextA || !contextB) throw new Error('expected both contexts');
    const clientTurn = unique('same_client_turn');
    const submissionA = oneAssertion(
      seeded.envelope,
      'party_a',
      clientTurn,
      'req_a_story',
      'A fact.',
    );
    const committedA = await storeA.commitExternalRelaySubmission(
      commitInput(contextA, submissionA),
    );
    expect(committedA.status).toBe('committed');
    expect(await storeB.readReplay(contextB, clientTurn)).toBeNull();
    const afterA = await storeB.findById(seeded.dispute_id);
    if (!afterA) throw new Error('expected stored dispute');
    const submissionB = oneAssertion(
      afterA.envelope,
      'party_b',
      clientTurn,
      'req_b_story',
      'B fact.',
    );
    const committedB = await storeB.commitExternalRelaySubmission(
      commitInput(contextB, submissionB),
    );
    expect(committedB.status).toBe('committed');
    const rows = await pool.query(
      `select party_id from juryai_v21.formation_replays where dispute_id = $1 and client_turn_id = $2 order by party_id`,
      [seeded.dispute_id, clientTurn],
    );
    expect(rows.rows).toEqual([{ party_id: 'party_a' }, { party_id: 'party_b' }]);
  });

  it('rebases a compiled bundle after hidden opponent movement without recompilation', async () => {
    const seeded = await createStored('hidden_rebase');
    const contextA = await storeA.resolvePartyContext(seeded.dispute_id, seeded.subject_a);
    const contextB = await storeB.resolvePartyContext(seeded.dispute_id, seeded.subject_b);
    if (!contextA || !contextB) throw new Error('expected contexts');
    const aSubmission = oneAssertion(
      seeded.envelope,
      'party_a',
      unique('turn_a'),
      'req_a_story',
      'A independent fact.',
    );
    const bSubmission = oneAssertion(
      seeded.envelope,
      'party_b',
      unique('turn_b'),
      'req_b_story',
      'B hidden fact.',
    );
    expect(
      await storeB.commitExternalRelaySubmission(commitInput(contextB, bSubmission)),
    ).toMatchObject({ status: 'committed' });
    const aResult = await storeA.commitExternalRelaySubmission(commitInput(contextA, aSubmission));
    expect(aResult).toMatchObject({ status: 'committed', hidden_state_rebased: true });
    if (aResult.status !== 'committed') return;
    expect(
      aResult.stored.envelope.source_turns[aSubmission.source_turn.turn_id]?.compile_run_id,
    ).toBe(aSubmission.compiler_run.compile_run_id);
  });

  it('fails visible contention safely and leaves no partial audit records for the loser', async () => {
    const seeded = await createStored('visible_conflict');
    const context = await storeA.resolvePartyContext(seeded.dispute_id, seeded.subject_a);
    if (!context) throw new Error('expected context');
    const first = oneAssertion(
      seeded.envelope,
      'party_a',
      unique('first'),
      'req_a_story',
      'First fact.',
    );
    const stale = oneAssertion(
      seeded.envelope,
      'party_a',
      unique('stale'),
      'req_a_second',
      'Stale fact.',
    );
    expect(await storeA.commitExternalRelaySubmission(commitInput(context, first))).toMatchObject({
      status: 'committed',
    });
    expect(await storeA.commitExternalRelaySubmission(commitInput(context, stale))).toMatchObject({
      status: 'conflict',
    });
    expect(await counts(seeded.dispute_id)).toMatchObject({
      formation_sources: 1,
      formation_submissions: 1,
      formation_compiler_runs: 1,
      formation_replays: 1,
    });
  });

  it('rolls back the envelope and every audit row when the last insert fails', async () => {
    const seeded = await createStored('atomic_failure');
    const context = await storeA.resolvePartyContext(seeded.dispute_id, seeded.subject_a);
    if (!context) throw new Error('expected context');
    const submission = oneAssertion(
      seeded.envelope,
      'party_a',
      unique('failure'),
      'req_a_story',
      'Atomic fact.',
    );
    const before = await storeA.findById(seeded.dispute_id);
    await pool.query(`
      create function juryai_v21.test_reject_v211_replay()
      returns trigger language plpgsql as $$ begin raise exception 'reject replay'; end; $$;
      create trigger test_reject_v211_replay before insert on juryai_v21.formation_replays
      for each row execute function juryai_v21.test_reject_v211_replay();
    `);
    try {
      await expect(
        storeA.commitExternalRelaySubmission(commitInput(context, submission)),
      ).rejects.toThrow(/reject replay/iu);
    } finally {
      await pool.query(`
        drop trigger test_reject_v211_replay on juryai_v21.formation_replays;
        drop function juryai_v21.test_reject_v211_replay();
      `);
    }
    expect(await storeA.findById(seeded.dispute_id)).toEqual(before);
    expect(await counts(seeded.dispute_id)).toEqual({
      formation_sources: 0,
      formation_commands: 0,
      formation_submissions: 0,
      formation_compiler_runs: 0,
      formation_replays: 0,
    });
  });
});

describe('V2.1.1 catalog and production-dark boundary', () => {
  it('preserves private/RLS storage, generated principals, and party-scoped replay uniqueness', async () => {
    const catalog = await pool.query<{
      table_name: string;
      rls: boolean;
    }>(
      `select c.relname table_name, c.relrowsecurity rls from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'juryai_v21' and c.relname like 'formation_%' and c.relkind = 'r'
       order by c.relname`,
    );
    expect(catalog.rows.every((row) => row.rls)).toBe(true);
    const grants = await pool.query(
      `select grantee from information_schema.table_privileges
       where table_schema = 'juryai_v21' and grantee in ('PUBLIC', 'anon', 'authenticated')`,
    );
    expect(grants.rows).toEqual([]);
    const definitions = await pool.query<{
      column_name: string;
      generation_expression: string | null;
    }>(
      `select column_name, generation_expression from information_schema.columns
       where table_schema = 'juryai_v21' and table_name = 'formation_disputes'
         and column_name in ('party_a_principal_id', 'party_b_principal_id') order by column_name`,
    );
    expect(
      definitions.rows.every((row) =>
        row.generation_expression?.includes('authenticated_subject_id'),
      ),
    ).toBe(true);
    const replayUnique = await pool.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) definition from pg_constraint
       where conname = 'formation_replays_party_turn_unique'`,
    );
    expect(replayUnique.rows[0]?.definition).toContain('dispute_id, party_id, client_turn_id');
  });

  it('keeps the migration conversion-free and guarded across every dark table', () => {
    const sql = readFileSync(
      'supabase/migrations/20260902091449_v211_external_relay_submission.sql',
      'utf8',
    );
    for (const table of [
      'formation_disputes',
      'formation_sources',
      'formation_commands',
      'formation_submissions',
      'formation_compiler_runs',
      'formation_replays',
      'formation_invitations',
    ]) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toContain('if row_count <> 0');
    expect(sql).toContain('refuses to reinterpret');
    expect(sql).not.toMatch(/\bupdate\s+juryai_v21\./iu);
    expect(sql).not.toMatch(/\binsert\s+into\s+juryai_v21\./iu);
    expect(sql).not.toContain('juryai_p2');
  });
});
