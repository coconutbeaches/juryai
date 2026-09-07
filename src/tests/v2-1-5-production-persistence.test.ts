import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { projectRoot } from './test-helpers.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostgresDisclosureReviewRepositoryV215 } from '../v2-1-5/postgres-disclosure-review-repository.js';
import {
  PostgresFormationInvitationRepositoryV215,
  productionInvitationAuthorityV215,
} from '../v2-1-5/postgres-formation-invitation-repository.js';
import { createProductionFirstPartyServiceV215 } from '../v2-1-5/production-first-party.js';
import {
  createInitialProductionDisputeV215,
  createProductionCaseServiceV215,
} from '../v2-1-5/production-case-service.js';
import { createInitialProductionDisputeV214 } from '../v2-1-4/production-case-service.js';
import { PostgresDisclosureReviewRepositoryV214 } from '../v2-1-4/postgres-disclosure-review-repository.js';
import { createProductionVersionedCaseServiceV215 } from '../v2-1-5/production-routing.js';
import { postgresContractResolution } from '../v2-1-5/postgres-contract-resolution.js';
import { decodeFormationReview } from '../webmcp/browser/supported-review-contract.js';
import { deriveFormationReadinessV215 } from '../v2-1-5/formation-readiness.js';
import { currentDisclosureReviewAcknowledgmentV215 } from '../v2-1-5/disclosure-review.js';
import { hashCaseEnvelopeV215, partyAuthorityV215 } from '../v2-1-5/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV215,
  ceremonyCommandForV215,
  refreshPartyViewCursorsV215,
} from '../v2-1-5/envelope-ceremony.js';
import { canonicalSerialize } from '../v2/case-envelope.js';
import {
  TestCompilerV215,
  assertion,
  baseEnvelope,
  ceremony,
  commandFor,
  req,
  serviceFor,
  SUBJECT_A,
  SUBJECT_B,
  unique,
} from './v2-1-5-test-helpers.js';

const url = process.env.JURYAI_TEST_DATABASE_URL;
if (!url) throw new Error('V2.1.5 persistence tests require an isolated JURYAI_TEST_DATABASE_URL.');
const pool = new Pool({ connectionString: url });
const repository = new PostgresDisclosureReviewRepositoryV215({ pool });
const invitations = new PostgresFormationInvitationRepositoryV215({
  pool,
  account_commitment_secret: 'isolated-v215-invitation-secret-with-32-bytes',
});
const contractMigrations = readdirSync(`${projectRoot}/supabase/migrations`)
  .filter((name) =>
    /^\d+_v215_(shared_formation|validate|activate)_contract_pairs\.sql$/u.test(name),
  )
  .sort()
  .map((name) => readFileSync(`${projectRoot}/supabase/migrations/${name}`, 'utf8'));
beforeAll(async () => {
  await repository.assertReady();
  await invitations.assertReady();
});
afterAll(async () => {
  await pool.end();
});

async function fixture() {
  const envelope = baseEnvelope();
  await repository.createDispute(envelope);
  const compiler = new TestCompilerV215();
  const service = serviceFor(repository, compiler);
  return { envelope, compiler, service, id: envelope.control.case_id };
}
async function counts(id: string) {
  return Promise.all(
    [
      'formation_sources',
      'formation_submissions',
      'formation_compiler_runs',
      'formation_replays',
    ].map(async (table) =>
      Number(
        (await pool.query(`select count(*) from juryai_v21.${table} where dispute_id = $1`, [id]))
          .rows[0].count,
      ),
    ),
  );
}

describe('V2.1.5 production application and PostgreSQL boundary', () => {
  it('persists multi-live and broad scope under the exact qualified artifact; replay precedes stale cursor and fingerprint conflicts', async () => {
    const f = await fixture();
    const facts = [
      assertion(req('other_party_performance'), 'They delivered the gate.'),
      assertion(req('other_party_performance'), 'They painted the door.'),
      assertion(req('paid'), 'I paid 90 euro.', { type: 'payment' }),
    ];
    f.compiler.script = () => ({ verdict: 'accepted_candidates', assertions: facts });
    const command = await commandFor(f.service, f.id, facts.map((a) => a.quote).join(' '));
    const result = await f.service.submitTurn(command);
    expect(result).toMatchObject({ ok: true, recorded: expect.any(Array) });
    expect(await f.service.submitTurn(command)).toEqual({ ...result, replayed: true });
    expect(
      await f.service.submitTurn({
        ...command,
        payload: { context: [], answer: { role: 'user', text: 'Different content.' } },
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(f.compiler.calls).toHaveLength(1);
    expect(await counts(f.id)).toEqual([1, 1, 1, 1]);
    const stored = (await repository.findById(f.id))!;
    expect(
      Object.values(stored.envelope.positions).filter((p) => p.superseded_by === null),
    ).toHaveLength(3);
    const audit = (
      await pool.query(
        'select record from juryai_v21.formation_compiler_runs where dispute_id = $1',
        [f.id],
      )
    ).rows[0].record;
    expect(audit.compiler_version_id).toBe(f.compiler.registryEntry.compiler_version_id);
    expect(audit.compiler_artifact.registry_entry.version.schema_version).toBe(
      'juryai-webmcp-compiler-contract-v0.4.0',
    );
    expect(audit.compiler_artifact.run.input.requirement_context).toHaveLength(12);
    expect(audit.compiler_artifact.run.contract_issues).toEqual([]);
  });

  it('zero effect persists no source, run, submission, or replay and the same client key can be retried meaningfully', async () => {
    const f = await fixture();
    const before = canonicalSerialize((await repository.findById(f.id))!);
    const command = await commandFor(
      f.service,
      f.id,
      'That is all.',
      undefined,
      'zero-effect-retry',
    );
    expect(await f.service.submitTurn(command)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(await counts(f.id)).toEqual([0, 0, 0, 0]);
    expect(canonicalSerialize((await repository.findById(f.id))!)).toBe(before);
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance'), 'They delivered late.')],
    });
    expect(
      (
        await f.service.submitTurn({
          ...command,
          payload: { context: [], answer: { role: 'user', text: 'They delivered late.' } },
        })
      ).ok,
    ).toBe(true);
    expect(await counts(f.id)).toEqual([1, 1, 1, 1]);
  });

  it.each(['opponent', 'context'] as const)(
    'refuses %s authority laundering before canonical persistence',
    async (attack) => {
      const f = await fixture();
      f.compiler.script = () => ({
        verdict: 'accepted_candidates',
        assertions: [
          assertion(
            req('other_party_performance', attack === 'opponent' ? 'party_b' : 'party_a'),
            'They delivered late.',
            attack === 'context' ? { region: 'context' } : {},
          ),
        ],
      });
      const command = await commandFor(
        f.service,
        f.id,
        attack === 'context' ? 'I am not sure.' : 'They delivered late.',
      );
      command.payload.context.push({ role: 'assistant', text: 'They delivered late.' });
      expect((await f.service.submitTurn(command)).ok).toBe(false);
      expect(await counts(f.id)).toEqual([0, 0, 0, 0]);
    },
  );

  it('rebases hidden opponent contention without model retry, keeps the original visible cursor, and scopes replay keys by party', async () => {
    const f = await fixture();
    const bCompiler = new TestCompilerV215(() => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance', 'party_b'), 'I delivered early.')],
    }));
    const b = serviceFor(repository, bCompiler, 'party_b');
    const before = f.envelope.control.party_views.party_a;
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance'), 'They delivered late.')],
    });
    f.compiler.afterModel = async () => {
      expect(
        (
          await b.submitTurn(
            await commandFor(
              b,
              f.id,
              'I delivered early.',
              [req('other_party_performance', 'party_b')],
              'shared-client-key',
            ),
          )
        ).ok,
      ).toBe(true);
      expect((await repository.findById(f.id))!.envelope.control.party_views.party_a).toEqual(
        before,
      );
    };
    const committed = vi.spyOn(repository, 'commitExternalRelaySubmission');
    const command = await commandFor(
      f.service,
      f.id,
      'They delivered late.',
      undefined,
      'shared-client-key',
    );
    const result = await f.service.submitTurn(command);
    expect(result.ok).toBe(true);
    expect(await committed.mock.results.at(-1)!.value).toMatchObject({
      status: 'committed',
      hidden_state_rebased: true,
    });
    committed.mockRestore();
    expect(f.compiler.calls).toHaveLength(1);
    const audit = (
      await pool.query(
        "select record from juryai_v21.formation_compiler_runs where dispute_id = $1 and party_id = 'party_a'",
        [f.id],
      )
    ).rows[0].record;
    expect(audit.compiler_artifact.run.input.case_version).toBe(before.party_visible_version);
    const submission = (
      await pool.query(
        "select record from juryai_v21.formation_submissions where dispute_id = $1 and party_id = 'party_a'",
        [f.id],
      )
    ).rows[0].record.submission;
    expect(submission.base_party_visible_version).toBe(before.party_visible_version);
    expect(submission.base_party_projection_hash).toBe(before.party_projection_hash);
    expect(await counts(f.id)).toEqual([2, 2, 2, 2]);
    expect(await f.service.submitTurn(command)).toEqual({ ...result, replayed: true });
  });

  it('visible contention maps to VERSION_CONFLICT without a second model call or partial audit writes', async () => {
    const f = await fixture();
    const otherCompiler = new TestCompilerV215(() => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance'), 'They painted a door.')],
    }));
    const other = serviceFor(repository, otherCompiler);
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance'), 'They delivered late.')],
    });
    f.compiler.beforeModel = async () => {
      expect(
        (await other.submitTurn(await commandFor(other, f.id, 'They painted a door.'))).ok,
      ).toBe(true);
    };
    expect(
      await f.service.submitTurn(await commandFor(f.service, f.id, 'They delivered late.')),
    ).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
    expect(f.compiler.calls).toHaveLength(1);
    expect(await counts(f.id)).toEqual([1, 1, 1, 1]);
  });

  it('an actual zero-row internal CAS maps to VERSION_CONFLICT and rolls back audit persistence', async () => {
    const f = await fixture();
    f.compiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance'), 'They delivered late.')],
    });
    // A local trigger simulates a lost CAS at the exact UPDATE, after model compilation.
    await pool.query(`create function juryai_v21.v215_test_skip_update() returns trigger language plpgsql as $$ begin if old.dispute_id = '${f.id}' then return null; end if; return new; end $$;
      create trigger v215_test_skip_update before update on juryai_v21.formation_disputes for each row execute function juryai_v21.v215_test_skip_update()`);
    try {
      expect(
        await f.service.submitTurn(await commandFor(f.service, f.id, 'They delivered late.')),
      ).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
      expect(await counts(f.id)).toEqual([0, 0, 0, 0]);
      expect(f.compiler.calls).toHaveLength(1);
    } finally {
      await pool.query(
        'drop trigger v215_test_skip_update on juryai_v21.formation_disputes; drop function juryai_v21.v215_test_skip_update()',
      );
    }
  });

  it('stored requirement content cannot be changed while retaining the generation claim', async () => {
    const f = await fixture();
    const altered = structuredClone(f.envelope);
    altered.requirements[req('paid')]!.max_propositions = 1;
    refreshPartyViewCursorsV215(f.envelope, altered);
    altered.control.envelope_hash = hashCaseEnvelopeV215(altered);
    await expect(repository.createDispute(altered)).rejects.toThrow(/artifact/);
    await pool.query(
      'update juryai_v21.formation_disputes set envelope = $1::jsonb where dispute_id = $2',
      [JSON.stringify(altered), f.id],
    );
    try {
      await expect(repository.findById(f.id)).rejects.toThrow(/artifact/);
    } finally {
      await pool.query(
        'update juryai_v21.formation_disputes set envelope = $1::jsonb where dispute_id = $2',
        [JSON.stringify(f.envelope), f.id],
      );
    }
  });

  it('validates replacement constraints without retaining an exclusive lock that blocks reads or writes', async () => {
    await fixture(); // Exercise populated formation tables, not only empty-schema DDL.
    const migration = await pool.connect();
    const traffic = await pool.connect();
    const constraints = async () =>
      (
        await migration.query<{ oid: string; convalidated: boolean }>(
          `select oid::text, convalidated from pg_constraint
          where conrelid in ('juryai_v21.formation_disputes'::regclass,
                             'juryai_v21.formation_assurance_challenges'::regclass)`,
        )
      ).rows;
    let validated = 0;
    try {
      await traffic.query("set lock_timeout = '250ms'");
      for (const sql of contractMigrations) {
        const before = new Map((await constraints()).map((c) => [c.oid, c.convalidated]));
        expect(sql).toMatch(/commit;\s*$/iu);
        // Hold each migration immediately before COMMIT to inspect the exact
        // table locks acquired during its validation scan, without timing races.
        await migration.query(sql.replace(/commit;\s*$/iu, ''));
        const newlyValidated = (await constraints()).filter(
          (c) => c.convalidated && before.get(c.oid) !== true,
        );
        if (newlyValidated.length) {
          validated += newlyValidated.length;
          const locks = (
            await migration.query<{ mode: string }>(
              `select mode from pg_locks where pid = pg_backend_pid() and granted
              and relation in ('juryai_v21.formation_disputes'::regclass,
                               'juryai_v21.formation_assurance_challenges'::regclass)`,
            )
          ).rows.map((row) => row.mode);
          expect(locks).not.toContain('AccessExclusiveLock');
          expect(locks).toContain('ShareUpdateExclusiveLock');
          for (const table of ['formation_disputes', 'formation_assurance_challenges']) {
            await traffic.query(`select 1 from juryai_v21.${table} limit 1`);
            await traffic.query(`update juryai_v21.${table} set dispute_id = default where false`);
          }
        }
        await migration.query('commit');
      }
      expect(validated).toBe(3);
      expect(
        (
          await migration.query(
            "select conname from pg_constraint where connamespace = 'juryai_v21'::regnamespace and conname like '%v215_stage'",
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await migration.query('rollback');
      await migration.query(`alter table juryai_v21.formation_disputes
        drop constraint if exists formation_disputes_external_submission_v215_stage,
        drop constraint if exists formation_disputes_contract_pair_v215_stage`);
      await migration.query(`alter table juryai_v21.formation_assurance_challenges
        drop constraint if exists formation_assurance_challenges_payload_binding_v215_stage`);
      await traffic.query('reset lock_timeout');
      migration.release();
      traffic.release();
    }
  });

  it('refuses premature activation and retains the old constraints until all replacements validate', async () => {
    const client = await pool.connect();
    const names = [
      'formation_disputes_external_submission_v211',
      'formation_disputes_contract_pair_v212',
      'formation_assurance_challenges_payload_binding',
    ];
    const snapshot = async () =>
      (
        await client.query(
          `select oid::text, conname, convalidated, pg_get_constraintdef(oid) as definition
        from pg_constraint where connamespace = 'juryai_v21'::regnamespace
          and conname = any($1::text[]) order by conname`,
          [names],
        )
      ).rows;
    const before = await snapshot();
    expect(contractMigrations).toHaveLength(3);
    try {
      await client.query(contractMigrations[0]!);
      expect(await snapshot()).toEqual(before);
      await expect(client.query(contractMigrations[2]!)).rejects.toMatchObject({
        code: '55000',
        message: 'V2.1.5 staged constraints must all be validated before activation',
      });
      await client.query('rollback');
      expect(await snapshot()).toEqual(before);
    } finally {
      await client.query('rollback');
      await client.query(contractMigrations[1]!);
      await client.query(contractMigrations[2]!);
      client.release();
    }
    await repository.assertReady();
    await invitations.assertReady();
  });

  it('adds exact SQL pairs, resolves historical rows historically, and creates new starts as V2.1.5', async () => {
    const start = {
      authenticated_subject_id: SUBJECT_A,
      client_request_id: unique('stable-start'),
      idempotency_secret: 'isolated-v215-start-secret',
    };
    const old = createInitialProductionDisputeV214(start);
    await new PostgresDisclosureReviewRepositoryV214({ pool }).createDispute(old);
    const snapshot = () =>
      pool.query(
        'select ctid::text, xmin::text, envelope::text from juryai_v21.formation_disputes where dispute_id = $1',
        [old.control.case_id],
      );
    const before = await snapshot();
    for (const sql of contractMigrations) await pool.query(sql);
    expect((await snapshot()).rows).toEqual(before.rows);
    const resolver = postgresContractResolution(pool);
    expect(await resolver.resolveVersion(old.control.case_id)).toBe('juryai-case-envelope-v2.1.4');
    expect(createInitialProductionDisputeV215(start).control.case_id).toBe(old.control.case_id);
    const compiler = new TestCompilerV215();
    const service = createProductionCaseServiceV215({
      authenticated_subject_id: SUBJECT_A,
      repository,
      compiler,
      review_url: (id) => `https://juryai.test/${id}`,
      idempotency_secret: start.idempotency_secret,
    });
    const result = await service.startCase({ client_request_id: unique('new-start') });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(await resolver.resolveVersion(result.case.case_id)).toBe('juryai-case-envelope-v2.1.5');
    const bad = structuredClone((await repository.findById(result.case.case_id))!.envelope);
    bad.control.command_contract_version = 'juryai-envelope-command-v2.1.4';
    bad.control.envelope_hash = hashCaseEnvelopeV215(bad);
    await expect(
      pool.query(
        'update juryai_v21.formation_disputes set envelope = $1::jsonb where dispute_id = $2',
        [JSON.stringify(bad), result.case.case_id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('invitation possession grants no identity authority; only the intended distinct account can bind Party B once', async () => {
    const envelope = createInitialProductionDisputeV215({
      authenticated_subject_id: SUBJECT_A,
      client_request_id: unique('invite'),
      idempotency_secret: 'isolated-invitation-start-secret',
    });
    await repository.createDispute(envelope);
    const authority = productionInvitationAuthorityV215(true);
    const issued = await invitations.issueInvitation({
      authority,
      dispute_id: envelope.control.case_id,
      authenticated_subject_id: SUBJECT_A,
      intended_account_email: 'intended@example.test',
    });
    expect(issued.status).toBe('issued');
    if (issued.status !== 'issued') throw new Error('Invitation not issued');
    expect(
      await postgresContractResolution(pool).resolveInvitationVersion(issued.opaque_token),
    ).toBe('juryai-case-envelope-v2.1.5');
    for (const [subject, email] of [
      [SUBJECT_B, 'wrong@example.test'],
      [SUBJECT_A, 'intended@example.test'],
    ]) {
      expect(
        await invitations.redeemInvitation({
          authority,
          opaque_token: issued.opaque_token,
          authenticated_subject_id: subject!,
          authenticated_email: email!,
        }),
      ).toMatchObject({ status: 'unavailable' });
    }
    const redeem = {
      authority,
      opaque_token: issued.opaque_token,
      authenticated_subject_id: SUBJECT_B,
      authenticated_email: 'intended@example.test',
    };
    expect(await invitations.redeemInvitation(redeem)).toEqual({
      status: 'redeemed',
      dispute_id: envelope.control.case_id,
    });
    expect(await invitations.redeemInvitation(redeem)).toMatchObject({ status: 'unavailable' });
    expect(
      (await repository.findById(envelope.control.case_id))!.envelope.parties.party_b
        .authenticated_subject_id,
    ).toBe(SUBJECT_B);
  });

  it('readiness rejects a cross-paired V2.1.5 constraint even with all historical branches present', async () => {
    const name = 'formation_disputes_contract_pair_v212';
    const original = (
      await pool.query(
        'select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1',
        [name],
      )
    ).rows[0].def as string;
    const crossed = original.replace(
      'juryai-envelope-command-v2.1.5',
      'juryai-envelope-command-v2.1.4',
    );
    await pool.query(
      `alter table juryai_v21.formation_disputes drop constraint ${name}, add constraint ${name} ${crossed} not valid`,
    );
    try {
      await expect(repository.assertReady()).rejects.toThrow(/incomplete/);
      await expect(invitations.assertReady()).rejects.toThrow(/unavailable/);
    } finally {
      await pool.query(
        `alter table juryai_v21.formation_disputes drop constraint ${name}, add constraint ${name} ${original}`,
      );
    }
    await expect(repository.assertReady()).resolves.toBeUndefined();
  });

  it('formation, disclosure, current review acknowledgment, protected confirmation, reopen and bilateral readiness compose', async () => {
    const f = await fixture();
    const fill = (input: Parameters<TestCompilerV215['script']>[0]) => ({
      verdict: 'accepted_candidates' as const,
      assertions: input.requirement_context.map((r) =>
        r.requirement_id.endsWith('_other_party_performance')
          ? assertion(r.requirement_id, input.turn.payload.answer.text.split(' I decline')[0]!)
          : assertion(r.requirement_id, 'I decline to answer other questions.', {
              type: 'declined_to_answer',
            }),
      ),
    });
    f.compiler.script = fill;
    const b = serviceFor(repository, new TestCompilerV215(fill), 'party_b');
    expect(
      (
        await f.service.submitTurn(
          await commandFor(
            f.service,
            f.id,
            'They delivered late. I decline to answer other questions.',
          ),
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await b.submitTurn(
          await commandFor(b, f.id, 'I delivered on time. I decline to answer other questions.', [
            req('paid', 'party_b'),
          ]),
        )
      ).ok,
    ).toBe(true);
    let stored = (await repository.findById(f.id))!;
    expect(
      await repository.commitControlledDisclosure({
        dispute_id: f.id,
        command_id: unique('disclosure'),
        expected_internal_envelope_version: stored.internal_envelope_version,
        expected_internal_envelope_hash: stored.internal_envelope_hash,
      }),
    ).toMatchObject({ status: 'committed' });
    const first = (subject: string) =>
      createProductionFirstPartyServiceV215({
        enabled: true,
        authenticated_subject_id: subject,
        repository,
        invitations,
        invitation_authority: productionInvitationAuthorityV215(true),
      });
    const aFirst = first(SUBJECT_A),
      bFirst = first(SUBJECT_B);
    expect(decodeFormationReview(await aFirst.getReviewPage(f.id)).review_page_version).toBe(
      'juryai-v2.1.5-first-party-review-page-v1.0.0',
    );
    expect(await aFirst.acknowledgeDisclosureReview(f.id)).toMatchObject({ status: 'committed' });
    expect(await bFirst.acknowledgeDisclosureReview(f.id)).toMatchObject({ status: 'committed' });
    stored = (await repository.findById(f.id))!;
    expect(stored.envelope.control.workflow_state).toBe('final_confirmation');
    expect(currentDisclosureReviewAcknowledgmentV215(stored.envelope, 'party_a')).not.toBeNull();
    for (const [party, firstParty] of [
      ['party_a', aFirst],
      ['party_b', bFirst],
    ] as const) {
      const challenge = await firstParty.issueReviewChallenge({
        dispute_id: f.id,
        action: 'confirm_case_account',
      });
      if (challenge.status !== 'issued') throw new Error(JSON.stringify(challenge));
      expect(
        await firstParty.executeReviewAction({
          dispute_id: f.id,
          action: 'confirm_case_account',
          challenge_id: challenge.challenge.challenge_id,
          first_party_session_id: unique('session'),
        }),
      ).toMatchObject({ status: 'applied' });
      if (party === 'party_a') {
        const interim = (await repository.findById(f.id))!.envelope;
        expect(interim.parties.party_b.edit_state).toBe('open');
        expect(deriveFormationReadinessV215(interim).ready_for_bilateral_lock).toBe(false);
      }
    }
    stored = (await repository.findById(f.id))!;
    expect(deriveFormationReadinessV215(stored.envelope).ready_for_bilateral_lock).toBe(true);
    const locked = ceremony(stored.envelope, { type: 'mark_ready_for_lock' });
    expect(locked.control.workflow_state).toBe('ready_for_lock');
    expect(
      Object.values(locked.positions)
        .filter((p) => p.proposition_type === 'narrative_fact')
        .map((p) => p.statement)
        .sort(),
    ).toEqual(['I delivered on time.', 'They delivered late.']);
    const forbidden = applyEnvelopeCeremonyCommandV215({
      envelope: stored.envelope,
      command: ceremonyCommandForV215(stored.envelope, unique('relay_lock'), {
        type: 'mark_ready_for_lock',
      }),
      execution_authority: partyAuthorityV215(stored.envelope, 'party_a', 'external_relay'),
    });
    expect(forbidden.status).toBe('rejected');
    const reopen = await aFirst.issueReviewChallenge({
      dispute_id: f.id,
      action: 'reopen_confirmed_material',
      reopen_reason: 'I need to correct my account.',
    });
    expect(reopen.status).toBe('issued');
    if (reopen.status !== 'issued') throw new Error('reopen not issued');
    expect(
      await aFirst.executeReviewAction({
        dispute_id: f.id,
        action: 'reopen_confirmed_material',
        challenge_id: reopen.challenge.challenge_id,
        first_party_session_id: unique('session'),
      }),
    ).toMatchObject({ status: 'applied' });
    stored = (await repository.findById(f.id))!;
    expect(currentDisclosureReviewAcknowledgmentV215(stored.envelope, 'party_a')).toBeNull();
    expect(deriveFormationReadinessV215(stored.envelope).ready_for_bilateral_lock).toBe(false);
  });
});
