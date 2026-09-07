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
  discloseForChallenges,
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
  it.each(['paid', 'other_party_performance'])(
    'persists supported assertions despite a clarification for %s',
    async (clarificationRequirement) => {
      const f = await fixture();
      f.compiler.script = () => ({
        verdict: 'accepted_candidates',
        assertions: [assertion(req('other_party_performance'), 'They delivered late.')],
        clarifications: [
          {
            requirement_id: req(clarificationRequirement),
            reason: 'multiple_incompatible_readings',
            prompt: 'Which payment?',
          },
        ],
      });
      const command = await commandFor(f.service, f.id, 'They delivered late. I paid something.');
      const result = await f.service.submitTurn(command);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(await f.service.submitTurn(command)).toEqual({ ...result, replayed: true });
      expect(await counts(f.id)).toEqual([1, 1, 1, 1]);
      expect(Object.values((await repository.findById(f.id))!.envelope.clarifications)).toEqual([]);
      const audit = (
        await pool.query(
          'select record from juryai_v21.formation_compiler_runs where dispute_id=$1',
          [f.id],
        )
      ).rows[0].record;
      expect(audit.compiler_artifact.run.output.clarifications_requested).toHaveLength(1);
    },
  );

  it('persists compound challenge and response as single replay-safe actions with exact correction and spans', async () => {
    const f = await fixture();
    const d = await discloseForChallenges(repository, f.id);
    const challengeQuotes = ['I delivered on July 10.', 'I sent the receipt that day.'];
    d.bCompiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: challengeQuotes.map((quote) => assertion(d.target.requirement_id, quote)),
    });
    const challengeCommand = await commandFor(d.b, f.id, challengeQuotes.join(' '), [
      d.target.position_id,
    ]);
    const challenged = await d.b.submitTurn(challengeCommand);
    expect(challenged.ok, JSON.stringify(challenged)).toBe(true);
    expect(await d.b.submitTurn(challengeCommand)).toEqual({ ...challenged, replayed: true });
    const challenges = Object.values((await repository.findById(f.id))!.envelope.challenges);
    expect(challenges).toHaveLength(1);
    const challenge = challenges[0]!;
    expect(challenge.statement).toBe(challengeQuotes.join('\n'));
    const responseQuotes = ['I received it on July 16.', 'I think the package was delayed.'];
    d.aCompiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [
        assertion(d.target.requirement_id, responseQuotes[0]!, {
          supersedes_candidate: d.target.position_id,
        }),
        assertion(d.target.requirement_id, responseQuotes[1]!, {
          epistemic_strength: 'asserted_qualified',
        }),
      ],
    });
    const responseCommand = await commandFor(d.a, f.id, responseQuotes.join(' '), [
      challenge.challenge_id,
      d.target.requirement_id,
    ]);
    const responded = await d.a.submitTurn(responseCommand);
    expect(responded.ok, JSON.stringify(responded)).toBe(true);
    expect(await d.a.submitTurn(responseCommand)).toEqual({ ...responded, replayed: true });
    const envelope = (await repository.findById(f.id))!.envelope;
    const response = envelope.challenges[challenge.challenge_id]!.response!;
    expect(response.statement).toBe(responseQuotes.join('\n'));
    expect(
      response.source_span_commitments.map((span) =>
        responseCommand.payload.answer.text.slice(span.start, span.end),
      ),
    ).toEqual(responseQuotes);
    expect(envelope.positions[response.semantic_position_id!]!.statement).toBe(responseQuotes[0]);
    expect(envelope.positions[d.target.position_id]!.superseded_by).toBe(
      response.semantic_position_id,
    );
    expect(await counts(f.id)).toEqual([4, 4, 4, 4]);
    expect(d.aCompiler.calls).toHaveLength(2);
    expect(d.bCompiler.calls).toHaveLength(2);
  });

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

  it.each(['exception', 'cas_miss'] as const)(
    'second acknowledgment and finalization roll back together on %s and recover through retry',
    async (failure) => {
      const f = await fixture();
      await discloseForChallenges(repository, f.id);
      const first = (subject: string) =>
        createProductionFirstPartyServiceV215({
          enabled: true,
          authenticated_subject_id: subject,
          repository,
          invitations,
          invitation_authority: productionInvitationAuthorityV215(true),
        });
      const a = first(SUBJECT_A),
        b = first(SUBJECT_B);
      expect(await a.acknowledgeDisclosureReview(f.id)).toMatchObject({ status: 'committed' });
      const before = canonicalSerialize((await repository.findById(f.id))!.envelope);
      const commandCount = async () =>
        Number(
          (
            await pool.query(
              'select count(*) from juryai_v21.formation_commands where dispute_id=$1',
              [f.id],
            )
          ).rows[0].count,
        );
      const commandsBefore = await commandCount();
      await pool.query(`create function juryai_v21.v215_test_final_failure() returns trigger language plpgsql as $$ begin
        if old.dispute_id = '${f.id}' and new.envelope #>> '{control,workflow_state}' = 'final_confirmation' then
          ${failure === 'exception' ? "raise exception 'injected finalization failure';" : 'return null;'}
        end if; return new; end $$;
        create trigger v215_test_final_failure before update on juryai_v21.formation_disputes for each row execute function juryai_v21.v215_test_final_failure()`);
      try {
        if (failure === 'exception') {
          await expect(b.acknowledgeDisclosureReview(f.id)).rejects.toThrow(
            'injected finalization failure',
          );
        } else {
          expect(await b.acknowledgeDisclosureReview(f.id)).toMatchObject({ status: 'conflict' });
        }
      } finally {
        await pool.query(
          'drop trigger v215_test_final_failure on juryai_v21.formation_disputes; drop function juryai_v21.v215_test_final_failure()',
        );
      }
      expect(canonicalSerialize((await repository.findById(f.id))!.envelope)).toBe(before);
      expect(await commandCount()).toBe(commandsBefore);
      expect(await b.getReviewPage(f.id)).toMatchObject({
        workflow_phase: 'challenge_response',
        own_disclosure_review: 'open',
        can_acknowledge_disclosure_review: true,
        can_confirm: false,
      });
      expect(await b.acknowledgeDisclosureReview(f.id)).toMatchObject({ status: 'committed' });
      const completed = canonicalSerialize((await repository.findById(f.id))!.envelope);
      expect(await b.getReviewPage(f.id)).toMatchObject({
        workflow_phase: 'final_confirmation',
        can_confirm: true,
      });
      expect(await commandCount()).toBe(commandsBefore + 1);
      // A lost acknowledgment response never mints another human attestation.
      expect(await b.acknowledgeDisclosureReview(f.id)).toMatchObject({ status: 'committed' });
      expect(await first('unbound_subject').acknowledgeDisclosureReview(f.id)).toEqual({
        status: 'unauthorized',
      });
      expect(canonicalSerialize((await repository.findById(f.id))!.envelope)).toBe(completed);
      expect(await commandCount()).toBe(commandsBefore + 1);
    },
  );

  it('concurrent acknowledgment CAS loss retries into one atomic closure without duplicate attestations', async () => {
    const f = await fixture();
    await discloseForChallenges(repository, f.id);
    const services = [SUBJECT_A, SUBJECT_B].map((authenticated_subject_id) =>
      createProductionFirstPartyServiceV215({
        enabled: true,
        authenticated_subject_id,
        repository,
        invitations,
        invitation_authority: productionInvitationAuthorityV215(true),
      }),
    );
    const stored = (await repository.findById(f.id))!;
    const reads = vi
      .spyOn(repository, 'findById')
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce(stored);
    let results;
    try {
      results = await Promise.all(services.map((s) => s.acknowledgeDisclosureReview(f.id)));
    } finally {
      reads.mockRestore();
    }
    expect(results.map((r) => r.status).sort()).toEqual(['committed', 'conflict']);
    expect(
      await services[
        results.findIndex((r) => r.status === 'conflict')
      ]!.acknowledgeDisclosureReview(f.id),
    ).toMatchObject({ status: 'committed' });
    const final = (await repository.findById(f.id))!.envelope;
    expect(final.control.workflow_state).toBe('final_confirmation');
    for (const party of ['party_a', 'party_b'] as const) {
      expect(final.formation.disclosure_review_acknowledgments[party]).toHaveLength(1);
      expect(currentDisclosureReviewAcknowledgmentV215(final, party)).not.toBeNull();
    }
  });

  it('a stale acknowledgment is never replay evidence or authority to bypass an open challenge', async () => {
    const f = await fixture();
    const d = await discloseForChallenges(repository, f.id);
    const first = createProductionFirstPartyServiceV215({
      enabled: true,
      authenticated_subject_id: SUBJECT_A,
      repository,
      invitations,
      invitation_authority: productionInvitationAuthorityV215(true),
    });
    expect(await first.acknowledgeDisclosureReview(f.id)).toMatchObject({ status: 'committed' });
    d.bCompiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(d.target.requirement_id, 'I dispute that date.')],
    });
    expect(
      (
        await d.b.submitTurn(
          await commandFor(d.b, f.id, 'I dispute that date.', [d.target.position_id]),
        )
      ).ok,
    ).toBe(true);
    const before = (await repository.findById(f.id))!.envelope;
    expect(currentDisclosureReviewAcknowledgmentV215(before, 'party_a')).toBeNull();
    expect(await first.acknowledgeDisclosureReview(f.id)).toMatchObject({
      status: 'domain_rejected',
    });
    expect(canonicalSerialize((await repository.findById(f.id))!.envelope)).toBe(
      canonicalSerialize(before),
    );
    expect(await first.getReviewPage(f.id)).toMatchObject({ can_confirm: false });
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

describe('8C3 agent-mediated repair and first-party return-to-edit transactions', () => {
  const first = (subject: string) =>
    createProductionFirstPartyServiceV215({
      enabled: true,
      authenticated_subject_id: subject,
      repository,
      invitations,
      invitation_authority: productionInvitationAuthorityV215(true),
    });
  async function finalFixture() {
    const f = await fixture();
    const disclosed = await discloseForChallenges(repository, f.id);
    const a = first(SUBJECT_A),
      b = first(SUBJECT_B);
    expect(await a.acknowledgeDisclosureReview(f.id)).toMatchObject({ status: 'committed' });
    expect(await b.acknowledgeDisclosureReview(f.id)).toMatchObject({ status: 'committed' });
    const page = (await a.getReviewPage(f.id))!;
    expect(page.can_return_to_edit).toBe(true);
    return {
      ...f,
      ...disclosed,
      firstA: a,
      firstB: b,
      request: {
        dispute_id: f.id,
        review_state_hash: page.review.review_state_hash,
        client_request_id: unique('return'),
      },
    };
  }
  it('returns to edit exactly once, replays after lost response, then repairs through the relay and regenerates disclosure review', async () => {
    const f = await finalFixture();
    const before = (await repository.findById(f.id))!.envelope;
    const auditCounts = await counts(f.id);
    expect(await f.firstA.returnToEdit!(f.request)).toMatchObject({ status: 'committed' });
    const returned = (await repository.findById(f.id))!.envelope;
    expect(returned.control.envelope_version).toBe(before.control.envelope_version + 1);
    expect(returned.control.workflow_state).toBe('challenge_response');
    expect(returned.source_turns).toEqual(before.source_turns);
    expect(returned.formation.disclosure_review_acknowledgments).toEqual(
      before.formation.disclosure_review_acknowledgments,
    );
    expect(currentDisclosureReviewAcknowledgmentV215(returned, 'party_a')).toBeNull();
    expect(await f.firstA.returnToEdit!(f.request)).toMatchObject({ status: 'committed' });
    expect((await repository.findById(f.id))!.envelope).toEqual(returned);
    expect(
      await f.firstA.returnToEdit!({ ...f.request, review_state_hash: 'f'.repeat(64) }),
    ).toMatchObject({ status: 'conflict' });
    expect(await counts(f.id)).toEqual(auditCounts);
    const text = 'July 15 was wrong; they delivered on July 18. I paid another 500.';
    f.aCompiler.script = () => ({
      verdict: 'accepted_candidates',
      assertions: [
        assertion(f.target.requirement_id, 'July 15 was wrong; they delivered on July 18.', {
          supersedes_candidate: f.target.position_id,
        }),
        assertion(req('paid'), 'I paid another 500.', { type: 'payment' }),
      ],
    });
    const command = await commandFor(f.a, f.id, text, [
      f.target.requirement_id,
      f.target.position_id,
    ]);
    const result = await f.a.submitTurn(command);
    expect(result).toMatchObject({ ok: true, superseded: [f.target.position_id] });
    const compilerCalls = f.aCompiler.calls.length;
    expect(await f.a.submitTurn(command)).toMatchObject({ ok: true, replayed: true });
    expect(f.aCompiler.calls).toHaveLength(compilerCalls);
    expect(await f.firstA.acknowledgeDisclosureReview(f.id)).toMatchObject({ status: 'committed' });
    expect(await f.firstB.acknowledgeDisclosureReview(f.id)).toMatchObject({ status: 'committed' });
    expect((await repository.findById(f.id))!.envelope.control.workflow_state).toBe(
      'final_confirmation',
    );
    const commands = await pool.query(
      "select record from juryai_v21.formation_commands where dispute_id=$1 and record->>'operation_type'='return_unconfirmed_to_edit'",
      [f.id],
    );
    expect(commands.rows).toHaveLength(1);
    expect(commands.rows[0].record.resulting_envelope_version).toBe(
      commands.rows[0].record.base_envelope_version + 1,
    );
  });
  it.each(['skip_update', 'audit_error'])(
    'return-to-edit and epoch history roll back atomically on %s',
    async (fault) => {
      const f = await finalFixture();
      const before = (await repository.findById(f.id))!.envelope;
      const trigger = unique('pr8c3_fault');
      const relation = fault === 'skip_update' ? 'formation_disputes' : 'formation_commands';
      await pool.query(
        `create function juryai_v21.${trigger}() returns trigger language plpgsql as $$ begin if ${fault === 'skip_update' ? 'old.dispute_id' : "new.record->>'dispute_id'"} = '${f.id}' then ${fault === 'skip_update' ? 'return null;' : "raise exception '8C3 injected audit failure';"} end if; return new; end $$; create trigger ${trigger} before ${fault === 'skip_update' ? 'update' : 'insert'} on juryai_v21.${relation} for each row execute function juryai_v21.${trigger}()`,
      );
      try {
        if (fault === 'skip_update')
          expect(await f.firstA.returnToEdit!(f.request)).toMatchObject({ status: 'conflict' });
        else
          await expect(f.firstA.returnToEdit!(f.request)).rejects.toThrow(
            '8C3 injected audit failure',
          );
        expect((await repository.findById(f.id))!.envelope).toEqual(before);
        expect(
          (
            await pool.query(
              "select count(*)::int n from juryai_v21.formation_commands where dispute_id=$1 and record->>'operation_type'='return_unconfirmed_to_edit'",
              [f.id],
            )
          ).rows[0].n,
        ).toBe(0);
      } finally {
        await pool.query(
          `drop trigger ${trigger} on juryai_v21.${relation}; drop function juryai_v21.${trigger}()`,
        );
      }
      expect(await f.firstA.returnToEdit!(f.request)).toMatchObject({ status: 'committed' });
    },
  );
  it('unconfirmed return cannot bypass a newly confirmed binding even if the earlier review hash is supplied', async () => {
    const f = await finalFixture();
    const challenge = await f.firstA.issueReviewChallenge({
      dispute_id: f.id,
      action: 'confirm_case_account',
    });
    if (challenge.status !== 'issued') throw new Error('Confirmation challenge unavailable');
    expect(
      await f.firstA.executeReviewAction({
        dispute_id: f.id,
        action: 'confirm_case_account',
        challenge_id: challenge.challenge.challenge_id,
        first_party_session_id: unique('session'),
      }),
    ).toMatchObject({ status: 'applied' });
    const before = (await repository.findById(f.id))!.envelope;
    expect((await f.firstA.returnToEdit!(f.request)).status).not.toBe('committed');
    expect((await repository.findById(f.id))!.envelope).toEqual(before);
    expect(await f.firstA.getReviewPage(f.id)).toMatchObject({
      can_reopen: true,
      can_return_to_edit: false,
    });
  });
  it.each(['hidden opponent', 'competing correction'])(
    'compiled exact correction handles %s contention without reinterpreting',
    async (kind) => {
      const f = await fixture();
      const initial = 'They delivered on July 12.';
      f.compiler.script = () => ({
        verdict: 'accepted_candidates',
        assertions: [assertion(req('other_party_performance'), initial)],
      });
      expect(await f.service.submitTurn(await commandFor(f.service, f.id, initial))).toMatchObject({
        ok: true,
      });
      const old = Object.values((await repository.findById(f.id))!.envelope.positions)[0]!;
      const text = 'July 12 was wrong; it was July 15.';
      f.compiler.script = () => ({
        verdict: 'accepted_candidates',
        assertions: [
          assertion(old.requirement_id, text, { supersedes_candidate: old.position_id }),
        ],
      });
      const otherText =
        kind === 'hidden opponent'
          ? 'I delivered on July 14.'
          : 'The old date was wrong; it was July 16.';
      const otherParty = kind === 'hidden opponent' ? 'party_b' : 'party_a';
      const otherCompiler = new TestCompilerV215(() => ({
        verdict: 'accepted_candidates',
        assertions: [
          assertion(req('other_party_performance', otherParty), otherText, {
            supersedes_candidate: kind === 'competing correction' ? old.position_id : null,
          }),
        ],
      }));
      const other = serviceFor(repository, otherCompiler, otherParty);
      f.compiler.afterModel = async () => {
        expect(
          await other.submitTurn(
            await commandFor(
              other,
              f.id,
              otherText,
              kind === 'competing correction'
                ? [old.requirement_id, old.position_id]
                : [req('other_party_performance', otherParty)],
            ),
          ),
        ).toMatchObject({ ok: true });
      };
      const result = await f.service.submitTurn(
        await commandFor(f.service, f.id, text, [old.requirement_id, old.position_id]),
      );
      expect(result).toMatchObject(
        kind === 'hidden opponent'
          ? { ok: true, superseded: [old.position_id] }
          : { ok: false, error: { code: 'VERSION_CONFLICT' } },
      );
      expect(f.compiler.calls).toHaveLength(2);
      expect(otherCompiler.calls).toHaveLength(1);
      expect(await counts(f.id)).toEqual(Array(4).fill(kind === 'hidden opponent' ? 3 : 2));
    },
  );
});
