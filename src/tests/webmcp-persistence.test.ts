import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CaseRuntime,
  PostgresCaseRuntimeStore,
  ScriptedSemanticCompiler,
  caseRuntimeStoreFromEnvironment,
  sequentialIdFactory,
  sequentialSaltFactory,
  steppingClock,
  type CaseRuntimeStore,
  type CompilerScript,
  type RuntimeRequestContext,
  type SemanticCompilerPort,
  type SubmitTurnCommand,
} from '../webmcp/runtime/index.js';
import {
  hashCanonicalState,
  renderCanonicalAccount,
  type AttestationRecord,
  type CaseState,
} from '../webmcp/core/attestation.js';
import { deriveReadiness } from '../webmcp/core/requirements.js';
import { computeRequestFingerprint, type IdempotencyRecord } from '../webmcp/core/idempotency.js';
import {
  computePayloadCommitment,
  computeSourceTurnMetadataCommitment,
  normalizePayload,
  type SourceTurnPayload,
  type SourceTurnRecord,
} from '../webmcp/core/turns.js';
import {
  STRUCTURAL_VALIDATOR_VERSION,
  WEBMCP_CORE_SCHEMA_VERSION,
  WEBMCP_PROTOCOL_VERSION,
} from '../webmcp/core/types.js';
import type { CompilerInput, CompilerOutput } from '../webmcp/core/compiler-contract.js';
import { createRuntimeCaseService } from '../webmcp/service/index.js';

const DATABASE_URL = process.env.JURYAI_TEST_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'webmcp-persistence.test.ts requires JURYAI_TEST_DATABASE_URL pointing to an isolated database.',
  );
}

const START_MS = Date.parse('2026-08-30T08:00:00.000Z');
const DISCLOSURE = 'juryai-disclosure-v0.2.0';
const pool = new Pool({ connectionString: DATABASE_URL });
const storeA = new PostgresCaseRuntimeStore({ connectionString: DATABASE_URL });
const storeB = new PostgresCaseRuntimeStore({ connectionString: DATABASE_URL });
let sequence = 0;

beforeAll(async () => {
  await storeA.assertReady();
  await storeB.assertReady();
});

afterAll(async () => {
  await Promise.all([storeA.close(), storeB.close(), pool.end()]);
});

function unique(label: string): string {
  sequence += 1;
  return `${label}_${process.pid}_${sequence}`;
}

function principal(label: string): RuntimeRequestContext {
  return {
    principal: { principal_id: unique(`principal_${label}`) },
    source_channel: 'webmcp_agent_relay',
    relaying_agent: 'ChatGPT (persistent integration)',
  };
}

function payload(answer: string): SourceTurnPayload {
  return normalizePayload({ context: [], answer: { role: 'user', text: answer } });
}

const ANSWER = 'I expected it finished by April 25, and nobody ever said otherwise.';

const acceptedScript: CompilerScript = () => ({
  verdict: 'accepted_candidates',
  assertions: [
    {
      quote: 'April 25',
      requirement_id: 'req_expected_date',
      type: 'target_date',
      epistemic_strength: 'recalled_uncertain',
      statement: 'The user expected the work to be finished by 25 April.',
    },
  ],
});

function runtime(
  store: CaseRuntimeStore,
  compiler: SemanticCompilerPort = new ScriptedSemanticCompiler(acceptedScript),
  prefix = unique('runtime') + '_',
  startMs = START_MS,
) {
  return new CaseRuntime({
    store,
    compiler,
    clock: steppingClock(startMs, 1000),
    ids: sequentialIdFactory(prefix),
    salts: sequentialSaltFactory(prefix + 'salt'),
    reviewUrl: (caseId) => `https://juryai.test/cases/${caseId}`,
    disclosure: { version: DISCLOSURE },
  });
}

function runtimeService(instance: CaseRuntime, who: RuntimeRequestContext) {
  return createRuntimeCaseService({
    runtime: instance,
    contextProvider: {
      getRuntimeRequestContext: () => who,
    },
  });
}

async function startCase(
  instance: CaseRuntime,
  who: RuntimeRequestContext,
  requestId = unique('start_request'),
) {
  const result = await instance.startCase(who, { client_request_id: requestId });
  if (result.kind !== 'created') throw new Error(`expected created, got ${result.kind}`);
  return result;
}

function submit(caseId: string, overrides: Partial<SubmitTurnCommand> = {}): SubmitTurnCommand {
  return {
    case_id: caseId,
    expected_case_version: 0,
    in_reply_to: ['req_expected_date'],
    payload: payload(ANSWER),
    client_turn_id: unique('client_turn'),
    ...overrides,
  };
}

async function rawTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

describe('PostgreSQL record round trips and configuration', () => {
  it('round-trips every persistent record through a fresh adapter instance', async () => {
    const who = principal('roundtrip');
    const writerCompiler = new ScriptedSemanticCompiler(acceptedScript);
    const writer = runtime(storeA, writerCompiler);
    const requestId = unique('roundtrip_start');
    const started = await startCase(writer, who, requestId);
    const caseBefore = await storeA.cases.findById(started.case.case_id);
    const expectedStartRecord = await storeA.startRequests.findByRequest(
      who.principal.principal_id,
      requestId,
    );

    const committed = await writer.submitTurn(who, submit(started.case.case_id));
    expect(committed.kind).toBe('committed');
    if (committed.kind !== 'committed') return;

    const reader = new PostgresCaseRuntimeStore({ connectionString: DATABASE_URL });
    try {
      expect(await reader.cases.findById(started.case.case_id)).toEqual(
        await storeA.cases.findById(started.case.case_id),
      );
      expect(caseBefore?.state.case_version).toBe(0);
      expect(
        await reader.startRequests.findByRequest(
          expectedStartRecord!.principal_id,
          expectedStartRecord!.client_request_id,
        ),
      ).toEqual(expectedStartRecord);

      const replay = await reader.idempotency.listByCase(started.case.case_id);
      const runs = await reader.compileRuns.listByCase(started.case.case_id);
      const registry = await reader.compilerRegistry.findById(
        writerCompiler.registryEntry.compiler_version_id,
      );
      expect(replay).toHaveLength(1);
      expect(await reader.compileRuns.findById(runs[0]!.compile_run_id)).toEqual(runs[0]);
      expect(registry).toEqual(writerCompiler.registryEntry);
    } finally {
      await reader.close();
    }
  });

  it('requires an explicit adapter and never falls back from postgres', () => {
    expect(() => caseRuntimeStoreFromEnvironment({})).toThrow(/explicitly/u);
    expect(() =>
      caseRuntimeStoreFromEnvironment({ JURYAI_PERSISTENCE_ADAPTER: 'postgres' }),
    ).toThrow(/requires JURYAI_DATABASE_URL/u);
    expect(
      caseRuntimeStoreFromEnvironment({ JURYAI_PERSISTENCE_ADAPTER: 'memory' }),
    ).toBeInstanceOf(Object);
  });

  it('fails loudly on malformed stored canonical state instead of repairing it', async () => {
    const who = principal('malformed');
    const started = await startCase(runtime(storeA), who);
    const before = await storeA.cases.findById(started.case.case_id);
    await pool.query(`update juryai_p2.cases set state = state - 'turn_log' where case_id = $1`, [
      started.case.case_id,
    ]);
    await expect(storeB.cases.findById(started.case.case_id)).rejects.toThrow(/malformed/u);
    await pool.query(`update juryai_p2.cases set state = $1::jsonb where case_id = $2`, [
      JSON.stringify(before!.state),
      started.case.case_id,
    ]);
  });

  it('keeps every persistence table private, RLS-enabled, and policy-free', async () => {
    const tables = await pool.query(
      `select c.relname, c.relrowsecurity
         from pg_class as c
         join pg_namespace as n on n.oid = c.relnamespace
        where n.nspname = 'juryai_p2' and c.relkind = 'r'
        order by c.relname`,
    );
    expect(tables.rows).toEqual([
      { relname: 'cases', relrowsecurity: true },
      { relname: 'compile_runs', relrowsecurity: true },
      { relname: 'compiler_registry', relrowsecurity: true },
      { relname: 'start_case_idempotency', relrowsecurity: true },
      { relname: 'submit_idempotency', relrowsecurity: true },
    ]);
    const policies = await pool.query(
      `select count(*)::int as count from pg_policies where schemaname = 'juryai_p2'`,
    );
    expect(policies.rows[0]!.count).toBe(0);
    const publicGrants = await pool.query(
      `select count(*)::int as count
         from information_schema.role_table_grants
        where table_schema = 'juryai_p2' and grantee = 'PUBLIC'`,
    );
    expect(publicGrants.rows[0]!.count).toBe(0);
  });
});

describe('atomic start_case persistence', () => {
  it('replays a lost start response from a second runtime and adapter', async () => {
    const who = principal('start_replay');
    const requestId = unique('same_start');
    const first = await startCase(runtime(storeA), who, requestId);
    const retry = await runtime(storeB).startCase(who, { client_request_id: requestId });
    expect(retry.kind).toBe('created');
    if (retry.kind !== 'created') return;
    expect(retry.replayed).toBe(true);
    expect(retry.case.case_id).toBe(first.case.case_id);
  });

  it('converges concurrent identical starts on one case', async () => {
    const who = principal('same_start_concurrency');
    const requestId = unique('concurrent_same_start');
    const [first, second] = await Promise.all([
      runtime(storeA).startCase(who, { client_request_id: requestId }),
      runtime(storeB).startCase(who, { client_request_id: requestId }),
    ]);
    expect(first.kind).toBe('created');
    expect(second.kind).toBe('created');
    if (first.kind !== 'created' || second.kind !== 'created') return;
    expect(first.case.case_id).toBe(second.case.case_id);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    const count = await pool.query(
      'select count(*)::int as count from juryai_p2.cases where principal_id = $1',
      [who.principal.principal_id],
    );
    expect(count.rows[0]!.count).toBe(1);
  });

  it('converges concurrent different starts on one active draft', async () => {
    const who = principal('different_start_concurrency');
    const [first, second] = await Promise.all([
      runtime(storeA).startCase(who, { client_request_id: unique('start_a') }),
      runtime(storeB).startCase(who, { client_request_id: unique('start_b') }),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(['created', 'open_draft_exists']);
    const count = await pool.query(
      'select count(*)::int as count from juryai_p2.cases where principal_id = $1',
      [who.principal.principal_id],
    );
    expect(count.rows[0]!.count).toBe(1);
  });

  it('rolls back case creation when the start-record insert fails', async () => {
    const who = principal('atomic_start_failure');
    const writer = runtime(storeA);
    const requestId = unique('reject_start');
    await installRejectingTrigger(
      'start_case_idempotency',
      'client_request_id',
      requestId,
      'test_reject_start_insert',
    );
    try {
      const outcome = await writer.startCase(who, { client_request_id: requestId });
      expect(outcome.kind).toBe('failed');
      const count = await pool.query(
        'select count(*)::int as count from juryai_p2.cases where principal_id = $1',
        [who.principal.principal_id],
      );
      expect(count.rows[0]!.count).toBe(0);
    } finally {
      await removeRejectingTrigger('start_case_idempotency', 'test_reject_start_insert');
    }
  });
});

describe('persistent replay and CAS across runtime instances', () => {
  it('replays an exact lost submit response without registration or compilation', async () => {
    const who = principal('exact_replay');
    const firstCompiler = new ScriptedSemanticCompiler(acceptedScript);
    const writer = runtime(storeA, firstCompiler);
    const started = await startCase(writer, who);
    const command = submit(started.case.case_id, { client_turn_id: unique('exact_turn') });
    const first = await writer.submitTurn(who, command);
    expect(first.kind).toBe('committed');

    const unavailableCompiler = new ScriptedSemanticCompiler(() => {
      throw new Error('compiler must not be called for exact replay');
    });
    const retry = await runtime(storeB, unavailableCompiler, unique('restart') + '_').submitTurn(
      who,
      command,
    );
    expect(retry.kind).toBe('replayed');
    if (retry.kind !== 'replayed') return;
    expect(retry.match).toBe('client_turn_id');
    expect(unavailableCompiler.calls).toHaveLength(0);
  });

  it('preserves fingerprint hierarchy, provenance controls, windowing, and exact lifetime replay', async () => {
    const who = principal('fingerprint');
    const writer = runtime(storeA);
    const started = await startCase(writer, who);
    const exactId = unique('exact_fingerprint_control');
    const first = await writer.submitTurn(
      who,
      submit(started.case.case_id, { client_turn_id: exactId }),
    );
    expect(first.kind).toBe('committed');

    const replayCompiler = new ScriptedSemanticCompiler(() => ({ verdict: 'no_assertions' }));
    const regenerated = await runtime(storeB, replayCompiler).submitTurn(
      who,
      submit(started.case.case_id, {
        client_turn_id: unique('regenerated'),
        expected_case_version: 1,
        payload: payload('I expected it finished by April 25 — and nobody ever said otherwise!'),
      }),
    );
    expect(regenerated.kind).toBe('replayed');
    if (regenerated.kind === 'replayed') expect(regenerated.match).toBe('fingerprint');
    expect(replayCompiler.calls).toHaveLength(0);

    const otherProvenance = {
      ...who,
      source_channel: 'first_party_input' as const,
      relaying_agent: null,
    };
    const distinctCompiler = new ScriptedSemanticCompiler(() => ({ verdict: 'no_assertions' }));
    const distinct = await runtime(storeB, distinctCompiler).submitTurn(
      otherProvenance,
      submit(started.case.case_id, {
        client_turn_id: unique('different_provenance'),
        expected_case_version: 1,
      }),
    );
    expect(distinct.kind).toBe('committed');
    expect(distinctCompiler.calls).toHaveLength(1);

    const outsideCompiler = new ScriptedSemanticCompiler(() => ({ verdict: 'no_assertions' }));
    const outside = await runtime(
      storeB,
      outsideCompiler,
      unique('outside_window') + '_',
      START_MS + 2 * 60 * 60 * 1000,
    ).submitTurn(
      who,
      submit(started.case.case_id, {
        client_turn_id: unique('outside_window_turn'),
        expected_case_version: 1,
      }),
    );
    expect(outside.kind).toBe('committed');
    expect(outsideCompiler.calls).toHaveLength(1);

    const exactAfterDrift = await runtime(
      storeB,
      new ScriptedSemanticCompiler(() => {
        throw new Error('exact replay must not compile');
      }),
      unique('exact_lifetime') + '_',
      START_MS + 24 * 60 * 60 * 1000,
    ).submitTurn(otherProvenance, submit(started.case.case_id, { client_turn_id: exactId }));
    expect(exactAfterDrift.kind).toBe('replayed');
    if (exactAfterDrift.kind === 'replayed') expect(exactAfterDrift.match).toBe('client_turn_id');
  });

  it('increments storage revision for no_assertions while case_version stays fixed', async () => {
    const who = principal('no_assertions');
    const quiet = new ScriptedSemanticCompiler(() => ({ verdict: 'no_assertions' }));
    const instance = runtime(storeA, quiet);
    const started = await startCase(instance, who);
    const before = await storeA.cases.findById(started.case.case_id);
    const result = await instance.submitTurn(who, submit(started.case.case_id));
    expect(result.kind).toBe('committed');
    const after = await storeB.cases.findById(started.case.case_id);
    expect(after?.state.case_version).toBe(0);
    expect(after?.revision).toBe(before!.revision + 1);
    expect(after?.state.turn_log).toHaveLength(1);
    expect(await storeB.idempotency.listByCase(started.case.case_id)).toHaveLength(1);
  });

  it('converges concurrent identical submits after one CAS loss without duplicate mutation', async () => {
    const who = principal('submit_contention');
    const starter = runtime(storeA);
    const started = await startCase(starter, who);
    const gate = new TwoPartyCompilerGate(acceptedScript);
    const exactId = unique('concurrent_exact');
    const command = submit(started.case.case_id, { client_turn_id: exactId });
    const [first, second] = await Promise.all([
      runtime(storeA, gate.compiler, unique('writer_a') + '_').submitTurn(who, command),
      runtime(storeB, gate.compiler, unique('writer_b') + '_').submitTurn(who, command),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(['committed', 'replayed']);
    const stored = await storeA.cases.findById(started.case.case_id);
    expect(stored?.state.turn_log).toHaveLength(1);
    expect(stored?.state.propositions).toHaveLength(1);
    expect(await storeB.idempotency.listByCase(started.case.case_id)).toHaveLength(1);
    // Both compiler executions genuinely happened before the CAS winner was
    // known, so both immutable audit runs remain.
    expect(await storeB.compileRuns.listByCase(started.case.case_id)).toHaveLength(2);
  });

  it('rolls back canonical state when submit-idempotency insertion fails', async () => {
    const who = principal('atomic_turn_failure');
    const writer = runtime(storeA);
    const started = await startCase(writer, who);
    const before = await storeA.cases.findById(started.case.case_id);
    const clientTurnId = unique('reject_submit');
    await installRejectingTrigger(
      'submit_idempotency',
      'client_turn_id',
      clientTurnId,
      'test_reject_submit_insert',
    );
    try {
      const result = await writer.submitTurn(
        who,
        submit(started.case.case_id, { client_turn_id: clientTurnId }),
      );
      expect(result.kind).toBe('failed');
      const after = await storeB.cases.findById(started.case.case_id);
      expect(after).toEqual(before);
      expect(await storeB.idempotency.listByCase(started.case.case_id)).toEqual([]);
    } finally {
      await removeRejectingTrigger('submit_idempotency', 'test_reject_submit_insert');
    }
  });

  it('replays an exact id after a later attestation locks the current version', async () => {
    const who = principal('locked_replay');
    const completionCompiler = new ScriptedSemanticCompiler((input) => ({
      verdict: 'accepted_candidates',
      assertions: input.turn.in_reply_to.map((requirementId) => ({
        quote: 'do not recall',
        requirement_id: requirementId,
        type: 'non_recollection',
        epistemic_strength: 'non_recollection',
        statement: `The user does not recall an answer for ${requirementId}.`,
      })),
    }));
    const writer = runtime(storeA, completionCompiler);
    const started = await startCase(writer, who);
    const exactId = unique('locked_exact');
    const draft = (await storeA.cases.findById(started.case.case_id))!;
    const command = submit(started.case.case_id, {
      client_turn_id: exactId,
      in_reply_to: draft.state.requirements.map((requirement) => requirement.requirement_id),
      payload: payload('I do not recall any of those details.'),
    });
    const first = await writer.submitTurn(who, command);
    expect(first.kind).toBe('committed');
    const stored = (await storeA.cases.findById(started.case.case_id))!;
    const locked = { ...stored.state, attestations: [attestationFor(stored.state)] };
    await pool.query(
      'update juryai_p2.cases set state = $1::jsonb, revision = revision + 1 where case_id = $2',
      [JSON.stringify(locked), started.case.case_id],
    );

    const compiler = new ScriptedSemanticCompiler(() => {
      throw new Error('locked exact replay must not compile');
    });
    const retry = await runtime(storeB, compiler).submitTurn(who, command);
    expect(retry.kind).toBe('replayed');
    expect(compiler.calls).toHaveLength(0);
  });
});

describe('Step 63 CaseServicePort PostgreSQL integration', () => {
  it('connects two service/runtime instances with durable replay, provenance, and conflict recovery', async () => {
    const who = principal('service_adapter');
    const instanceA = runtime(storeA);
    const quietCompiler = new ScriptedSemanticCompiler(() => ({ verdict: 'no_assertions' }));
    const instanceB = runtime(storeB, quietCompiler, unique('service_b') + '_');
    const serviceA = runtimeService(instanceA, who);
    const serviceB = runtimeService(instanceB, who);

    const started = await serviceA.startCase({
      client_request_id: unique('service_start_request'),
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const readFromB = await serviceB.getCaseState({ case_id: started.case.case_id });
    expect(readFromB).toEqual({ ok: true, case: started.case });

    const sourceLanguageOnly = {
      case_id: started.case.case_id,
      expected_case_version: 0,
      in_reply_to: ['req_expected_date'],
      payload: payload(ANSWER),
      source_language: 'de',
      client_turn_id: unique('language_only_turn'),
    };
    const first = await serviceA.submitTurn(sourceLanguageOnly);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const storedAfterFirst = await storeB.cases.findById(started.case.case_id);
    expect(storedAfterFirst?.state.turn_log).toHaveLength(1);
    expect(storedAfterFirst?.state.turn_log[0]).toMatchObject({
      source_language: 'de',
      translation_indicated: false,
    });

    const translated = {
      case_id: started.case.case_id,
      expected_case_version: first.case.case_version,
      in_reply_to: ['req_expected_date'],
      payload: payload('The relayed translation says I still expected April 25.'),
      source_language: 'de',
      translation_indicated: true,
      client_turn_id: unique('translated_turn'),
    };
    const second = await serviceB.submitTurn(translated);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const replay = await serviceA.submitTurn(translated);
    expect(replay).toEqual({ ...second, replayed: true });

    const storedAfterReplay = await storeA.cases.findById(started.case.case_id);
    expect(
      storedAfterReplay?.state.turn_log.map((turn) => ({
        source_language: turn.source_language,
        translation_indicated: turn.translation_indicated,
      })),
    ).toEqual([
      { source_language: 'de', translation_indicated: false },
      { source_language: 'de', translation_indicated: true },
    ]);
    expect(await storeB.idempotency.listByCase(started.case.case_id)).toHaveLength(2);
    expect(await storeB.compileRuns.listByCase(started.case.case_id)).toHaveLength(2);

    const beforeConflict = await storeA.cases.findById(started.case.case_id);
    const conflict = await serviceB.submitTurn({
      case_id: started.case.case_id,
      expected_case_version: 0,
      in_reply_to: ['req_expected_date'],
      payload: payload('This is a distinct stale answer about a different date.'),
      client_turn_id: unique('stale_service_turn'),
    });
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: 'VERSION_CONFLICT', retryable: false },
      current_case_version: first.case.case_version,
      likely_already_recorded: false,
      case: { case_id: started.case.case_id, case_version: first.case.case_version },
    });
    expect(await storeB.cases.findById(started.case.case_id)).toEqual(beforeConflict);
    expect(await storeB.idempotency.listByCase(started.case.case_id)).toHaveLength(2);
  });
});

describe('snapshot primitives and append-only history', () => {
  it('observes submit case and replay data as old+old or new+new around an uncommitted transaction', async () => {
    const who = principal('submit_snapshot');
    const started = await startCase(runtime(storeA), who);
    const before = (await storeA.cases.findById(started.case.case_id))!;
    const prepared = quietTurn(before.state, who, unique('snapshot_turn'));
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        'update juryai_p2.cases set state = $1::jsonb, revision = revision + 1 where case_id = $2',
        [JSON.stringify(prepared.state), started.case.case_id],
      );
      await client.query('insert into juryai_p2.submit_idempotency (record) values ($1::jsonb)', [
        JSON.stringify(prepared.idempotency),
      ]);

      const oldSnapshot = await storeB.readSubmitSnapshot(started.case.case_id);
      expect(oldSnapshot.stored?.revision).toBe(before.revision);
      expect(oldSnapshot.idempotency).toHaveLength(0);

      await client.query('commit');
      const newSnapshot = await storeB.readSubmitSnapshot(started.case.case_id);
      expect(newSnapshot.stored?.revision).toBe(before.revision + 1);
      expect(newSnapshot.idempotency).toEqual([prepared.idempotency]);
      expect(newSnapshot.stored?.state.turn_log).toHaveLength(1);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  it('observes start identity and case together across a transaction boundary', async () => {
    const who = principal('start_snapshot');
    const template = await startCase(runtime(storeA), who, unique('template_start'));
    const templateState = (await storeA.cases.findById(template.case.case_id))!.state;
    const anotherWho = principal('start_snapshot_target');
    const caseId = unique('snapshot_case');
    const requestId = unique('snapshot_start_request');
    const state = {
      ...templateState,
      case_id: caseId,
      principal_id: anotherWho.principal.principal_id,
    };
    const request = {
      principal_id: anotherWho.principal.principal_id,
      client_request_id: requestId,
      case_id: caseId,
      recorded_at_ms: START_MS,
    };
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('insert into juryai_p2.cases (state) values ($1::jsonb)', [
        JSON.stringify(state),
      ]);
      await client.query(
        'insert into juryai_p2.start_case_idempotency (record) values ($1::jsonb)',
        [JSON.stringify(request)],
      );
      expect(
        await storeB.readStartSnapshot(anotherWho.principal.principal_id, requestId),
      ).toBeNull();
      await client.query('commit');
      const snapshot = await storeB.readStartSnapshot(anotherWho.principal.principal_id, requestId);
      expect(snapshot?.request).toEqual(request);
      expect(snapshot?.stored?.state).toEqual(state);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  it('rejects compiler registry rebinding and preserves the original artefact', async () => {
    const original = new ScriptedSemanticCompiler().registryEntry;
    await storeA.compilerRegistry.register(original);
    const conflicting = structuredClone(original);
    conflicting.prompt_text = 'different prompt under the same identity';
    await expect(storeB.compilerRegistry.register(conflicting)).rejects.toThrow();
    expect(await storeA.compilerRegistry.findById(original.compiler_version_id)).toEqual(original);
  });

  it('rejects a duplicate compile_run_id and leaves the original unchanged', async () => {
    const who = principal('append_only_run');
    const compiler = new ScriptedSemanticCompiler(acceptedScript);
    const instance = runtime(storeA, compiler);
    const started = await startCase(instance, who);
    await instance.submitTurn(who, submit(started.case.case_id));
    const original = (await storeA.compileRuns.listByCase(started.case.case_id))[0]!;
    const conflicting = structuredClone(original);
    conflicting.started_at = new Date(START_MS + 99_000).toISOString();
    await expect(storeB.compileRuns.append(conflicting)).rejects.toThrow(/append-only/u);
    expect(await storeA.compileRuns.findById(original.compile_run_id)).toEqual(original);

    await expect(
      pool.query('update juryai_p2.compile_runs set record = record where compile_run_id = $1', [
        original.compile_run_id,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
  });
});

class TwoPartyCompilerGate {
  readonly compiler: SemanticCompilerPort;

  constructor(script: CompilerScript) {
    const inner = new ScriptedSemanticCompiler(script);
    let arrivals = 0;
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.compiler = {
      registryEntry: inner.registryEntry,
      compile: async (input: CompilerInput): Promise<CompilerOutput> => {
        arrivals += 1;
        if (arrivals === 2) release();
        await barrier;
        return inner.compile(input);
      },
    };
  }
}

function attestationFor(state: CaseState): AttestationRecord {
  const render = renderCanonicalAccount(state);
  const readiness = deriveReadiness(state.requirements, state.propositions, state.clarifications);
  return {
    attestation_id: unique('attestation'),
    case_id: state.case_id,
    case_version: state.case_version,
    canonical_state_hash: hashCanonicalState(state),
    rendered_document: render.document,
    rendered_document_hash: render.document_hash,
    render_template_version: render.render_template_version,
    challenge: unique('challenge'),
    verification_method: 'first_party_ui_click',
    assurance_level: 'ui_click',
    authenticator_ref: null,
    signature: null,
    signature_alg: null,
    source_turn_ids: state.turn_log.map((turn) => turn.turn_id),
    source_turn_commitments: state.turn_log.map((turn) => turn.payload_commitment),
    source_turn_metadata_commitments: state.turn_log.map(computeSourceTurnMetadataCommitment),
    evidence_refs: state.evidence_references.map((reference) => ({
      evidence_ref_id: reference.evidence_ref_id,
      label: reference.label,
      inspection_status: reference.inspection_status,
    })),
    unresolved_requirement_ids: readiness.unresolved_requirement_ids,
    schema_version: WEBMCP_CORE_SCHEMA_VERSION,
    protocol_version: WEBMCP_PROTOCOL_VERSION,
    compiler_version_ids: [
      ...new Set(state.propositions.map((proposition) => proposition.compiler_version_id)),
    ].sort(),
    structural_validator_version: STRUCTURAL_VALIDATOR_VERSION,
    principal_id: state.principal_id,
    created_at: new Date(START_MS).toISOString(),
    client_ip: null,
    user_agent: null,
  };
}

function quietTurn(
  state: CaseState,
  who: RuntimeRequestContext,
  turnId: string,
): { state: CaseState; idempotency: IdempotencyRecord } {
  const answer = payload('Nothing else comes to mind.');
  const fingerprint = computeRequestFingerprint({
    principal_id: who.principal.principal_id,
    case_id: state.case_id,
    in_reply_to: ['req_expected_date'],
    payload: answer,
  });
  const turn: SourceTurnRecord = {
    turn_id: turnId,
    case_id: state.case_id,
    case_version_before: state.case_version,
    received_at: new Date(START_MS).toISOString(),
    principal_id: who.principal.principal_id,
    source_channel: 'webmcp_agent_relay',
    relaying_agent: 'ChatGPT (persistent integration)',
    source_language: null,
    translation_indicated: false,
    in_reply_to: ['req_expected_date'],
    client_turn_id: unique('snapshot_client_turn'),
    request_fingerprint: fingerprint,
    payload: answer,
    payload_commitment_salt: unique('snapshot_salt'),
    payload_commitment: '',
    compile_run_id: unique('snapshot_compile_run'),
  };
  turn.payload_commitment = computePayloadCommitment(turn.payload, turn.payload_commitment_salt);
  const nextState = { ...state, turn_log: [...state.turn_log, turn] };
  return {
    state: nextState,
    idempotency: {
      case_id: state.case_id,
      request_fingerprint: fingerprint,
      client_turn_id: turn.client_turn_id,
      turn_id: turn.turn_id,
      recorded_at_ms: START_MS,
      response: {
        case_version: state.case_version,
        turn_id: turn.turn_id,
        accepted_proposition_ids: [],
        superseded_proposition_ids: [],
        opened_clarification_ids: [],
        warnings: ['JuryAI did not record a canonical statement from that answer.'],
      },
    },
  };
}

async function installRejectingTrigger(
  table: 'start_case_idempotency' | 'submit_idempotency',
  column: 'client_request_id' | 'client_turn_id',
  value: string,
  triggerName: string,
): Promise<void> {
  const functionName = `${triggerName}_fn`;
  await pool.query(
    `create function juryai_p2.${functionName}()
     returns trigger language plpgsql security invoker
     set search_path = pg_catalog, pg_temp
     as $$ begin raise exception 'forced integration failure' using errcode = 'P0001'; end $$`,
  );
  await pool.query(
    `create trigger ${triggerName}
     before insert on juryai_p2.${table}
     for each row when (new.record ->> '${column}' = '${value.replaceAll("'", "''")}')
     execute function juryai_p2.${functionName}()`,
  );
}

async function removeRejectingTrigger(
  table: 'start_case_idempotency' | 'submit_idempotency',
  triggerName: string,
): Promise<void> {
  await pool.query(`drop trigger ${triggerName} on juryai_p2.${table}`);
  await pool.query(`drop function juryai_p2.${triggerName}_fn()`);
}
