import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloneCanonical, sha256 } from '../v2/case-envelope.js';
import {
  TRUSTED_SYSTEM_AUTHORITY_V21,
  hashCaseEnvelopeV21,
  type CaseEnvelopeV21,
  type PartyIdV21,
} from '../v2-1/case-envelope.js';
import { validateCaseEnvelopeV21 } from '../v2-1/contract-validator.js';
import {
  applyEnvelopeCommandV21,
  commandForV21,
  createInitialCaseEnvelopeV21,
  type BindPartyOperationV21,
  type EnvelopeCommandV21,
} from '../v2-1/envelope-command.js';
import {
  assertLegacyCasePersistenceId,
  type CommitExternalRelayCommandInputV21,
  type FormationPartyPersistenceContextV21,
  type StoredFormationDisputeV21,
} from '../v2-1/formation-persistence.js';
import { PostgresFormationRepositoryV21 } from '../v2-1/postgres-formation-repository.js';

const DATABASE_URL = process.env.JURYAI_TEST_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'v2-1-persistence.test.ts requires JURYAI_TEST_DATABASE_URL pointing to an isolated database.',
  );
}

const pool = new Pool({ connectionString: DATABASE_URL });
const storeA = new PostgresFormationRepositoryV21({ connectionString: DATABASE_URL });
const storeB = new PostgresFormationRepositoryV21({ connectionString: DATABASE_URL });
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

function disputeId(label: string): string {
  return `dispute_${unique(label)}`;
}

function applyBinding(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
  subjectId: string,
): CaseEnvelopeV21 {
  const operation: BindPartyOperationV21 = {
    type: 'bind_party',
    party_slot: partyId,
    authenticated_subject_id: subjectId,
    binding_event_id: unique(`binding_${partyId}`),
  };
  const result = applyEnvelopeCommandV21({
    envelope,
    command: commandForV21(envelope, unique('bind_command'), operation),
    execution_authority: TRUSTED_SYSTEM_AUTHORITY_V21,
  });
  if (result.status !== 'applied') throw new Error(result.message);
  return result.envelope;
}

function envelopeWithBindings(input: {
  dispute_id: string;
  party_a: string | null;
  party_b: string | null;
}): CaseEnvelopeV21 {
  let envelope = createInitialCaseEnvelopeV21(input.dispute_id);
  if (input.party_a) envelope = applyBinding(envelope, 'party_a', input.party_a);
  if (input.party_b) envelope = applyBinding(envelope, 'party_b', input.party_b);
  return envelope;
}

function positionCommand(
  envelope: CaseEnvelopeV21,
  partyId: PartyIdV21,
  suffix: string,
): EnvelopeCommandV21 {
  const statement = `${partyId} records persistence statement ${suffix}.`;
  return commandForV21(envelope, unique(`command_${suffix}`), {
    type: 'record_own_position',
    position_id: unique(`position_${partyId}_${suffix}`),
    position_kind: 'assertion',
    statement,
    resolution_status: 'disputed',
    source_turn: {
      turn_id: unique(`turn_${partyId}_${suffix}`),
      content: statement,
      spans: [{ start: 0, end: statement.length, quote: statement }],
    },
  });
}

function commitInput(
  context: FormationPartyPersistenceContextV21,
  command: EnvelopeCommandV21,
  clientTurnId: string,
  suffix: string,
): CommitExternalRelayCommandInputV21 {
  if (command.operation.type !== 'record_own_position') {
    throw new Error('test commit helper requires a position operation');
  }
  return {
    context,
    command,
    client_turn_id: clientTurnId,
    request_fingerprint: sha256(`request:${suffix}`),
    audit: {
      recorded_at_ms: Date.parse('2026-09-02T00:00:00.000Z') + sequence,
      source: {
        source_id: unique(`source_${context.party_id}_${suffix}`),
      },
      submission: { submission_id: unique(`submission_${context.party_id}_${suffix}`) },
      compiler_run: {
        compiler_run_id: unique(`compiler_run_${context.party_id}_${suffix}`),
        compiler_version_id: sha256(`compiler:${suffix}`),
        input_hash: sha256(`input:${suffix}`),
        output_hash: sha256(`output:${suffix}`),
      },
    },
  };
}

async function storedAndContext(
  store: PostgresFormationRepositoryV21,
  targetDisputeId: string,
  subjectId: string,
): Promise<{
  stored: StoredFormationDisputeV21;
  context: FormationPartyPersistenceContextV21;
}> {
  const stored = await store.findById(targetDisputeId);
  const context = await store.resolvePartyContext(targetDisputeId, subjectId);
  if (!stored || !context) throw new Error('expected persisted bound formation context');
  expect(stored.internal_envelope_version).toBe(context.internal_envelope_version);
  expect(stored.internal_envelope_hash).toBe(context.internal_envelope_hash);
  return { stored, context };
}

async function auditCounts(targetDisputeId: string): Promise<Record<string, number>> {
  const result = await pool.query<{ table_name: string; count: number }>(
    `select table_name, count
       from (
         select 'formation_sources' as table_name, count(*)::int as count
           from juryai_v21.formation_sources where dispute_id = $1
         union all
         select 'formation_commands', count(*)::int
           from juryai_v21.formation_commands where dispute_id = $1
         union all
         select 'formation_submissions', count(*)::int
           from juryai_v21.formation_submissions where dispute_id = $1
         union all
         select 'formation_compiler_runs', count(*)::int
           from juryai_v21.formation_compiler_runs where dispute_id = $1
         union all
         select 'formation_replays', count(*)::int
           from juryai_v21.formation_replays where dispute_id = $1
       ) as counts`,
    [targetDisputeId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.table_name, row.count]));
}

describe('V2.1 authoritative dark persistence', () => {
  it('round-trips the authoritative envelope with Party B genuinely null', async () => {
    const id = disputeId('roundtrip_unbound_b');
    const envelope = envelopeWithBindings({
      dispute_id: id,
      party_a: unique('subject_roundtrip_a'),
      party_b: null,
    });
    const created = await storeA.createDispute(envelope);
    expect(created.created).toBe(true);
    expect(created.stored.envelope).toEqual(envelope);
    expect(created.stored.envelope.parties.party_b).toMatchObject({
      authenticated_subject_id: null,
      identity_assurance: 'unbound',
      binding_event_id: null,
    });
    expect(await storeB.findById(id)).toEqual(created.stored);

    const lookup = await pool.query(
      `select dispute_id, schema_version, protocol_version,
              internal_envelope_version, internal_envelope_hash,
              party_a_principal_id, party_b_principal_id
         from juryai_v21.formation_disputes where dispute_id = $1`,
      [id],
    );
    expect(lookup.rows[0]).toMatchObject({
      dispute_id: id,
      schema_version: 'juryai-case-envelope-v2.1.0',
      protocol_version: 'juryai-formation-protocol-v2.1.0',
      party_a_principal_id: envelope.parties.party_a.authenticated_subject_id,
      party_b_principal_id: null,
    });
  });

  it('rejects duplicate A/B principals in both the canonical and database boundaries', async () => {
    const id = disputeId('duplicate_principal');
    const envelope = envelopeWithBindings({
      dispute_id: id,
      party_a: unique('subject_duplicate_a'),
      party_b: unique('subject_duplicate_b'),
    });
    const tampered = cloneCanonical(envelope);
    tampered.parties.party_b.authenticated_subject_id =
      tampered.parties.party_a.authenticated_subject_id;
    tampered.control.envelope_hash = hashCaseEnvelopeV21(tampered);
    expect(validateCaseEnvelopeV21(tampered).map((issue) => issue.code)).toContain(
      'duplicate_authenticated_subject',
    );
    await expect(storeA.createDispute(tampered)).rejects.toThrow(
      /duplicate_authenticated_subject/iu,
    );
    await expect(
      pool.query(`insert into juryai_v21.formation_disputes (envelope) values ($1::jsonb)`, [
        JSON.stringify(tampered),
      ]),
    ).rejects.toMatchObject({ constraint: 'formation_disputes_distinct_principals' });
  });

  it('allows the same principal in multiple disputes and returns every active context', async () => {
    const shared = unique('subject_multi_dispute');
    const first = envelopeWithBindings({
      dispute_id: disputeId('multi_x'),
      party_a: shared,
      party_b: null,
    });
    const second = envelopeWithBindings({
      dispute_id: disputeId('multi_y'),
      party_a: unique('subject_multi_other'),
      party_b: shared,
    });
    await storeA.createDispute(first);
    await storeA.createDispute(second);

    const contexts = await storeB.listActiveContextsForPrincipal(shared);
    expect(contexts.map(({ dispute_id, party_id }) => ({ dispute_id, party_id }))).toEqual(
      [
        { dispute_id: first.control.case_id, party_id: 'party_a' },
        { dispute_id: second.control.case_id, party_id: 'party_b' },
      ].sort((left, right) => left.dispute_id.localeCompare(right.dispute_id)),
    );
    expect('findActiveDraftByPrincipal' in storeB).toBe(false);
    expect('findLatestActiveContext' in storeB).toBe(false);
  });
});

describe('party-scoped replay and authoritative CAS', () => {
  it('allows A and B to use the same client_turn_id without collision or replay leakage', async () => {
    const id = disputeId('cross_party_turn');
    const subjectA = unique('subject_cross_party_a');
    const subjectB = unique('subject_cross_party_b');
    await storeA.createDispute(
      envelopeWithBindings({ dispute_id: id, party_a: subjectA, party_b: subjectB }),
    );
    const sharedTurnId = unique('client_turn_shared');

    const a = await storedAndContext(storeA, id, subjectA);
    const inputA = commitInput(
      a.context,
      positionCommand(a.stored.envelope, 'party_a', 'shared_a'),
      sharedTurnId,
      'shared_a',
    );
    const committedA = await storeA.commitExternalRelayCommand(inputA);
    expect(committedA.status).toBe('committed');

    const bBefore = await storedAndContext(storeB, id, subjectB);
    expect(await storeB.readReplay(bBefore.context, sharedTurnId)).toBeNull();
    const inputB = commitInput(
      bBefore.context,
      positionCommand(bBefore.stored.envelope, 'party_b', 'shared_b'),
      sharedTurnId,
      'shared_b',
    );
    const committedB = await storeB.commitExternalRelayCommand(inputB);
    expect(committedB.status).toBe('committed');
    if (committedA.status !== 'committed' || committedB.status !== 'committed') return;
    expect(committedA.response.party_id).toBe('party_a');
    expect(committedB.response.party_id).toBe('party_b');
    expect(committedB.response).not.toEqual(committedA.response);

    const rows = await pool.query(
      `select party_id, client_turn_id
         from juryai_v21.formation_replays
        where dispute_id = $1 and client_turn_id = $2
        order by party_id`,
      [id, sharedTurnId],
    );
    expect(rows.rows).toEqual([
      { party_id: 'party_a', client_turn_id: sharedTurnId },
      { party_id: 'party_b', client_turn_id: sharedTurnId },
    ]);
  });

  it('replays a same-party lost response deterministically before stale-CAS handling', async () => {
    const id = disputeId('same_party_replay');
    const subject = unique('subject_same_party_replay');
    await storeA.createDispute(
      envelopeWithBindings({ dispute_id: id, party_a: subject, party_b: null }),
    );
    const initial = await storedAndContext(storeA, id, subject);
    const turnId = unique('client_turn_replay');
    const input = commitInput(
      initial.context,
      positionCommand(initial.stored.envelope, 'party_a', 'same_party'),
      turnId,
      'same_party',
    );
    const first = await storeA.commitExternalRelayCommand(input);
    expect(first.status).toBe('committed');

    const freshContext = await storeA.resolvePartyContext(id, subject);
    if (!freshContext) throw new Error('expected fresh same-party context');
    const replayed = await storeA.commitExternalRelayCommand({ ...input, context: freshContext });
    expect(replayed.status).toBe('replayed');
    if (first.status !== 'committed' || replayed.status !== 'replayed') return;
    expect(replayed.response).toEqual(first.response);
    expect(await auditCounts(id)).toEqual({
      formation_sources: 1,
      formation_commands: 1,
      formation_submissions: 1,
      formation_compiler_runs: 1,
      formation_replays: 1,
    });
  });

  it('treats client_turn_id as an opaque operation id while deriving the audited source turn', async () => {
    const id = disputeId('opaque_client_turn');
    const subject = unique('subject_opaque_client_turn');
    await storeA.createDispute(
      envelopeWithBindings({ dispute_id: id, party_a: subject, party_b: null }),
    );
    const prepared = await storedAndContext(storeA, id, subject);
    const opaqueTurnId = '9 relay operation with spaces';
    const command = positionCommand(prepared.stored.envelope, 'party_a', 'opaque_client_turn');
    if (command.operation.type !== 'record_own_position') {
      throw new Error('expected position command');
    }
    const input = commitInput(prepared.context, command, opaqueTurnId, 'opaque_client_turn');
    expect((await storeA.commitExternalRelayCommand(input)).status).toBe('committed');

    const records = await pool.query<{ client_turn_id: string; source_turn_id: string }>(
      `select submission.client_turn_id, source.source_turn_id
         from juryai_v21.formation_submissions as submission
         join juryai_v21.formation_sources as source
           using (dispute_id, party_id, source_id)
        where submission.dispute_id = $1`,
      [id],
    );
    expect(records.rows).toEqual([
      {
        client_turn_id: opaqueTurnId,
        source_turn_id: command.operation.source_turn.turn_id,
      },
    ]);
  });

  it('rejects forged persistence contexts without exposing a replay oracle', async () => {
    const id = disputeId('forged_context');
    const subject = unique('subject_forged_context');
    await storeA.createDispute(
      envelopeWithBindings({ dispute_id: id, party_a: subject, party_b: null }),
    );
    const issued = await storedAndContext(storeA, id, subject);
    const input = commitInput(
      issued.context,
      positionCommand(issued.stored.envelope, 'party_a', 'forged'),
      unique('client_turn_forged'),
      'forged',
    );
    const forged = { ...issued.context } as FormationPartyPersistenceContextV21;
    expect(await storeA.readReplay(forged, input.client_turn_id)).toBeNull();
    await expect(storeA.commitExternalRelayCommand({ ...input, context: forged })).resolves.toEqual(
      {
        status: 'unauthorized',
        replayed: false,
      },
    );
    expect(await auditCounts(id)).toEqual({
      formation_sources: 0,
      formation_commands: 0,
      formation_submissions: 0,
      formation_compiler_runs: 0,
      formation_replays: 0,
    });
  });

  it('leaves zero partial records when a stale authoritative CAS loses', async () => {
    const id = disputeId('stale_cas');
    const subject = unique('subject_stale_cas');
    await storeA.createDispute(
      envelopeWithBindings({ dispute_id: id, party_a: subject, party_b: null }),
    );
    const first = await storedAndContext(storeA, id, subject);
    const stale = await storedAndContext(storeB, id, subject);
    const firstInput = commitInput(
      first.context,
      positionCommand(first.stored.envelope, 'party_a', 'cas_winner'),
      unique('client_turn_cas_winner'),
      'cas_winner',
    );
    const staleInput = commitInput(
      stale.context,
      positionCommand(stale.stored.envelope, 'party_a', 'cas_loser'),
      unique('client_turn_cas_loser'),
      'cas_loser',
    );
    expect((await storeA.commitExternalRelayCommand(firstInput)).status).toBe('committed');
    const loser = await storeB.commitExternalRelayCommand(staleInput);
    expect(loser.status).toBe('conflict');

    const losingRows = await pool.query<{ count: number }>(
      `select count(*)::int as count
         from juryai_v21.formation_commands
        where dispute_id = $1 and command_id = $2`,
      [id, staleInput.command.command_id],
    );
    expect(losingRows.rows[0]?.count).toBe(0);
    expect((await storeA.findById(id))?.internal_envelope_version).toBe(
      first.stored.internal_envelope_version + 1,
    );
  });

  it('serializes real concurrent stale writers so only one can mutate', async () => {
    const id = disputeId('concurrent_cas');
    const subject = unique('subject_concurrent_cas');
    await storeA.createDispute(
      envelopeWithBindings({ dispute_id: id, party_a: subject, party_b: null }),
    );
    const fromA = await storedAndContext(storeA, id, subject);
    const fromB = await storedAndContext(storeB, id, subject);
    const inputA = commitInput(
      fromA.context,
      positionCommand(fromA.stored.envelope, 'party_a', 'concurrent_a'),
      unique('client_turn_concurrent_a'),
      'concurrent_a',
    );
    const inputB = commitInput(
      fromB.context,
      positionCommand(fromB.stored.envelope, 'party_a', 'concurrent_b'),
      unique('client_turn_concurrent_b'),
      'concurrent_b',
    );
    const outcomes = await Promise.all([
      storeA.commitExternalRelayCommand(inputA),
      storeB.commitExternalRelayCommand(inputB),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['committed', 'conflict']);
    expect((await storeA.findById(id))?.internal_envelope_version).toBe(
      fromA.stored.internal_envelope_version + 1,
    );
    expect(await auditCounts(id)).toEqual({
      formation_sources: 1,
      formation_commands: 1,
      formation_submissions: 1,
      formation_compiler_runs: 1,
      formation_replays: 1,
    });
  });
});

describe('atomic audit history and database security', () => {
  it('commits envelope, source, command, submission, compiler run, and replay atomically', async () => {
    const id = disputeId('atomic_success');
    const subject = unique('subject_atomic_success');
    await storeA.createDispute(
      envelopeWithBindings({ dispute_id: id, party_a: subject, party_b: null }),
    );
    const prepared = await storedAndContext(storeA, id, subject);
    const input = commitInput(
      prepared.context,
      positionCommand(prepared.stored.envelope, 'party_a', 'atomic_success'),
      unique('client_turn_atomic_success'),
      'atomic_success',
    );
    const result = await storeA.commitExternalRelayCommand(input);
    expect(result.status).toBe('committed');
    expect(await auditCounts(id)).toEqual({
      formation_sources: 1,
      formation_commands: 1,
      formation_submissions: 1,
      formation_compiler_runs: 1,
      formation_replays: 1,
    });
    const stored = await storeB.findById(id);
    expect(stored?.internal_envelope_version).toBe(prepared.stored.internal_envelope_version + 1);
    expect(stored?.envelope.control.envelope_hash).toBe(stored?.internal_envelope_hash);
  });

  it('rolls back every record when a later audit insert fails', async () => {
    const id = disputeId('atomic_rollback');
    const subject = unique('subject_atomic_rollback');
    await storeA.createDispute(
      envelopeWithBindings({ dispute_id: id, party_a: subject, party_b: null }),
    );
    const prepared = await storedAndContext(storeA, id, subject);
    const input = commitInput(
      prepared.context,
      positionCommand(prepared.stored.envelope, 'party_a', 'atomic_rollback'),
      unique('client_turn_atomic_rollback'),
      'atomic_rollback',
    );
    await pool.query(`
      create function juryai_v21.test_reject_compiler_run()
      returns trigger language plpgsql as $$
      begin raise exception 'test compiler failure' using errcode = '55000'; end;
      $$;
      create trigger test_reject_compiler_run
      before insert on juryai_v21.formation_compiler_runs
      for each row execute function juryai_v21.test_reject_compiler_run();
    `);
    try {
      await expect(storeA.commitExternalRelayCommand(input)).rejects.toThrow(/compiler failure/iu);
    } finally {
      await pool.query(`
        drop trigger test_reject_compiler_run on juryai_v21.formation_compiler_runs;
        drop function juryai_v21.test_reject_compiler_run();
      `);
    }
    expect(await storeB.findById(id)).toEqual(prepared.stored);
    expect(await auditCounts(id)).toEqual({
      formation_sources: 0,
      formation_commands: 0,
      formation_submissions: 0,
      formation_compiler_runs: 0,
      formation_replays: 0,
    });
  });

  it('keeps audit/history rows append-only', async () => {
    const id = disputeId('append_only');
    const subject = unique('subject_append_only');
    await storeA.createDispute(
      envelopeWithBindings({ dispute_id: id, party_a: subject, party_b: null }),
    );
    const prepared = await storedAndContext(storeA, id, subject);
    const input = commitInput(
      prepared.context,
      positionCommand(prepared.stored.envelope, 'party_a', 'append_only'),
      unique('client_turn_append_only'),
      'append_only',
    );
    expect((await storeA.commitExternalRelayCommand(input)).status).toBe('committed');
    await expect(
      pool.query(
        `update juryai_v21.formation_commands
            set record = record
          where dispute_id = $1 and party_id = 'party_a' and command_id = $2`,
        [id, input.command.command_id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('keeps every V2.1 table private with RLS and no browser-role grants', async () => {
    const expectedTables = [
      'formation_commands',
      'formation_compiler_runs',
      'formation_disputes',
      'formation_replays',
      'formation_sources',
      'formation_submissions',
    ];
    const tables = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class as c
         join pg_namespace as n on n.oid = c.relnamespace
        where n.nspname = 'juryai_v21' and c.relkind = 'r'
        order by c.relname`,
    );
    expect(tables.rows).toEqual(
      expectedTables.map((relname) => ({ relname, relrowsecurity: true })),
    );
    const grants = await pool.query<{ count: number }>(
      `select count(*)::int as count
         from information_schema.role_table_grants
        where table_schema = 'juryai_v21'
          and grantee in ('PUBLIC', 'anon', 'authenticated')`,
    );
    expect(grants.rows[0]?.count).toBe(0);
  });

  it('rejects legacy ids at the V2 repository and disputes at the mixed legacy boundary', async () => {
    await expect(storeA.findById('case_legacy')).rejects.toThrow(/legacy/iu);
    expect(() => assertLegacyCasePersistenceId('dispute_new')).toThrow(/V2\.1/iu);
  });
});
