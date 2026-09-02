import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalSerialize } from '../v2/case-envelope.js';
import { TRUSTED_SYSTEM_AUTHORITY_V211, type CaseEnvelopeV211 } from '../v2-1-1/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV211,
  ceremonyCommandForV211,
  createInitialCaseEnvelopeV211,
} from '../v2-1-1/envelope-ceremony.js';
import {
  INVITATION_ACCOUNT_COMMITMENT_VERSION_V21,
  TRUSTED_FIRST_PARTY_INVITATION_ACTION_V21,
  TRUSTED_INVITATION_AUTH_BRIDGE_V21,
  authenticatedInvitationPrincipalV21,
  commitIntendedInvitationAccountV21,
  hashOpaqueInvitationTokenV21,
  testOnlyInvitationFeatureAuthorityV21,
  type AuthenticatedInvitationPrincipalV21,
} from '../v2-1/invitation-contract.js';
import {
  invitationUnavailableResultV21,
  productionDisabledInvitationServiceV21,
  testOnlyInvitationServiceV21,
} from '../v2-1/invitation-service.js';
import { PostgresFormationInvitationRepositoryV211 } from '../v2-1-1/postgres-formation-invitation-repository.js';
import { PostgresFormationRepositoryV211 } from '../v2-1-1/postgres-formation-repository.js';

const DATABASE_URL = process.env.JURYAI_TEST_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'v2-1-1-invitation-persistence.test.ts requires JURYAI_TEST_DATABASE_URL pointing to an isolated database.',
  );
}

const SECRET = 'isolated-test-account-commitment-secret-0123456789';
const TTL_MS = 60_000;
const START_MS = Date.parse('2026-09-02T05:00:00.000Z');
let nowMs = START_MS;
let sequence = 0;

const pool = new Pool({ connectionString: DATABASE_URL });
const formationStore = new PostgresFormationRepositoryV211({ connectionString: DATABASE_URL });
const invitationStoreA = new PostgresFormationInvitationRepositoryV211({
  connectionString: DATABASE_URL,
  account_commitment_secret: SECRET,
  invitation_ttl_ms: TTL_MS,
  clock: () => nowMs,
});
const invitationStoreB = new PostgresFormationInvitationRepositoryV211({
  connectionString: DATABASE_URL,
  account_commitment_secret: SECRET,
  invitation_ttl_ms: TTL_MS,
  clock: () => nowMs,
});
const enabledServiceA = testOnlyInvitationServiceV21(invitationStoreA);
const enabledServiceB = testOnlyInvitationServiceV21(invitationStoreB);

beforeAll(async () => {
  await Promise.all([
    formationStore.assertReady(),
    invitationStoreA.assertReady(),
    invitationStoreB.assertReady(),
  ]);
});

afterAll(async () => {
  await Promise.all([
    formationStore.close(),
    invitationStoreA.close(),
    invitationStoreB.close(),
    pool.end(),
  ]);
});

function unique(label: string): string {
  sequence += 1;
  return `${label}_${process.pid}_${sequence}`;
}

function principal(subject: string, email: string): AuthenticatedInvitationPrincipalV21 {
  return authenticatedInvitationPrincipalV21(TRUSTED_INVITATION_AUTH_BRIDGE_V21, {
    authenticated_subject_id: subject,
    authenticated_email: email,
  });
}

function bind(
  envelope: CaseEnvelopeV211,
  party: 'party_a' | 'party_b',
  subject: string,
): CaseEnvelopeV211 {
  const result = applyEnvelopeCeremonyCommandV211({
    envelope,
    command: ceremonyCommandForV211(envelope, unique(`command_bind_${party}`), {
      type: 'bind_party',
      party_slot: party,
      authenticated_subject_id: subject,
      binding_event_id: unique(`binding_${party}`),
    }),
    execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
  });
  if (result.status !== 'applied') throw new Error(result.message);
  return result.envelope;
}

async function createUnboundDispute(label: string): Promise<{
  dispute_id: string;
  party_a_subject: string;
  party_a: AuthenticatedInvitationPrincipalV21;
  envelope: CaseEnvelopeV211;
}> {
  const disputeId = `dispute_${unique(label)}`;
  const partyASubject = unique(`subject_${label}_a`);
  const envelope = bind(createInitialCaseEnvelopeV211(disputeId), 'party_a', partyASubject);
  await formationStore.createDispute(envelope);
  return {
    dispute_id: disputeId,
    party_a_subject: partyASubject,
    party_a: principal(partyASubject, `${label}-a@example.com`),
    envelope,
  };
}

async function issueFor(
  dispute: Awaited<ReturnType<typeof createUnboundDispute>>,
  targetEmail = 'party-b@example.com',
) {
  const result = await enabledServiceA.issueInvitation({
    dispute_id: dispute.dispute_id,
    authenticated_principal: dispute.party_a,
    intended_account_email: targetEmail,
  });
  expect(result.status).toBe('issued');
  if (result.status !== 'issued') throw new Error('expected invitation issuance');
  return result;
}

async function invitationState(invitationId: string) {
  const result = await pool.query(
    `select invitation_id,
            dispute_id,
            target_party_id,
            issuer_party_id,
            issuer_principal_id,
            token_hash,
            intended_account_commitment_version,
            intended_account_commitment,
            consumed_at,
            redeemed_principal_id,
            redemption_event_id,
            redemption_envelope_version,
            redemption_envelope_hash,
            to_jsonb(formation_invitations)::text as persisted_text
       from juryai_v21.formation_invitations
      where invitation_id = $1`,
    [invitationId],
  );
  return result.rows[0];
}

describe('private invitation issuance and storage', () => {
  it('stores hash-only Party B bootstrap provenance and a server-secret account commitment', async () => {
    nowMs = START_MS;
    const dispute = await createUnboundDispute('hash_only');
    const invitation = await issueFor(dispute, ' Intended.B@Example.COM ');
    const row = await invitationState(invitation.invitation_id);

    expect(row).toMatchObject({
      dispute_id: dispute.dispute_id,
      target_party_id: 'party_b',
      issuer_party_id: 'party_a',
      issuer_principal_id: dispute.party_a_subject,
      token_hash: hashOpaqueInvitationTokenV21(invitation.opaque_token),
      intended_account_commitment_version: INVITATION_ACCOUNT_COMMITMENT_VERSION_V21,
      intended_account_commitment: commitIntendedInvitationAccountV21(
        'intended.b@example.com',
        SECRET,
      ),
      consumed_at: null,
    });
    expect(row.persisted_text).not.toContain(invitation.opaque_token);
    expect(invitation.csurl_path).toBe(`/join/${invitation.opaque_token}`);

    const columns = await pool.query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'juryai_v21' and table_name = 'formation_invitations'
        order by ordinal_position`,
    );
    expect(columns.rows.map((entry) => entry.column_name)).not.toContain('raw_token');
    expect(columns.rows.map((entry) => entry.column_name)).not.toContain('opaque_token');
  });

  it('derives issuer authority from Party A binding and refuses caller-shaped or wrong issuer contexts', async () => {
    const dispute = await createUnboundDispute('issuer_authority');
    const wrong = principal(unique('subject_wrong_issuer'), 'wrong-issuer@example.com');
    await expect(
      enabledServiceA.issueInvitation({
        dispute_id: dispute.dispute_id,
        authenticated_principal: wrong,
        intended_account_email: 'party-b@example.com',
      }),
    ).resolves.toEqual(invitationUnavailableResultV21());
    const count = await pool.query<{ count: number }>(
      `select count(*)::int as count
         from juryai_v21.formation_invitations where dispute_id = $1`,
      [dispute.dispute_id],
    );
    expect(count.rows[0]?.count).toBe(0);
  });

  it('enforces feature-off at service and transaction boundaries with zero mutation', async () => {
    const dispute = await createUnboundDispute('feature_off');
    const disabledService = productionDisabledInvitationServiceV21(invitationStoreA);
    const request = {
      dispute_id: dispute.dispute_id,
      authenticated_principal: dispute.party_a,
      intended_account_email: 'party-b@example.com',
    };
    await expect(disabledService.issueInvitation(request)).resolves.toEqual(
      invitationUnavailableResultV21(),
    );
    await expect(
      invitationStoreA.issueInvitation({
        ...request,
        feature_authority: null,
        first_party_authority: TRUSTED_FIRST_PARTY_INVITATION_ACTION_V21,
      }),
    ).resolves.toEqual(invitationUnavailableResultV21());
    await expect(
      invitationStoreA.issueInvitation({
        ...request,
        feature_authority: testOnlyInvitationFeatureAuthorityV21(),
        first_party_authority: null,
      }),
    ).resolves.toEqual(invitationUnavailableResultV21());
    const count = await pool.query<{ count: number }>(
      `select count(*)::int as count
         from juryai_v21.formation_invitations where dispute_id = $1`,
      [dispute.dispute_id],
    );
    expect(count.rows[0]?.count).toBe(0);
  });
});

describe('generic authenticated redemption', () => {
  it('makes unknown, malformed, wrong-account, self-redemption, and expired failures equivalent', async () => {
    nowMs = START_MS;
    const dispute = await createUnboundDispute('generic_failures');
    const invitation = await issueFor(dispute, 'eligible@example.com');
    const wrong = principal(unique('subject_wrong_account'), 'wrong@example.com');
    const responses = [
      await enabledServiceA.redeemInvitation({
        opaque_token: 'unknown-token',
        authenticated_principal: wrong,
      }),
      await enabledServiceA.redeemInvitation({
        opaque_token: 'x'.repeat(5_000),
        authenticated_principal: wrong,
      }),
      await enabledServiceA.redeemInvitation({
        opaque_token: invitation.opaque_token,
        authenticated_principal: wrong,
      }),
      await enabledServiceA.redeemInvitation({
        opaque_token: invitation.opaque_token,
        authenticated_principal: dispute.party_a,
      }),
    ];
    nowMs = START_MS + TTL_MS;
    responses.push(
      await enabledServiceA.redeemInvitation({
        opaque_token: invitation.opaque_token,
        authenticated_principal: principal(unique('subject_expired'), 'eligible@example.com'),
      }),
    );
    expect(responses).toEqual(responses.map(() => invitationUnavailableResultV21()));
    expect(
      (await formationStore.findById(dispute.dispute_id))?.envelope.parties.party_b,
    ).toMatchObject({
      identity_assurance: 'unbound',
      authenticated_subject_id: null,
    });
    expect((await invitationState(invitation.invitation_id)).consumed_at).toBeNull();
  });

  it('atomically binds the intended distinct Party B and makes the token single-use', async () => {
    nowMs = START_MS;
    const dispute = await createUnboundDispute('successful_redemption');
    const invitation = await issueFor(dispute, 'eligible@example.com');
    const partyBSubject = unique('subject_successful_b');
    const partyB = principal(partyBSubject, 'ELIGIBLE@example.com');
    const before = await formationStore.findById(dispute.dispute_id);

    await expect(
      enabledServiceA.redeemInvitation({
        opaque_token: invitation.opaque_token,
        authenticated_principal: partyB,
      }),
    ).resolves.toEqual({ status: 'redeemed' });

    const after = await formationStore.findById(dispute.dispute_id);
    expect(after?.internal_envelope_version).toBe((before?.internal_envelope_version ?? 0) + 1);
    expect(after?.envelope.parties.party_b).toMatchObject({
      party_id: 'party_b',
      identity_assurance: 'authenticated',
      authenticated_subject_id: partyBSubject,
    });
    const row = await invitationState(invitation.invitation_id);
    expect(row).toMatchObject({
      redeemed_principal_id: partyBSubject,
      redemption_envelope_version: String(after?.internal_envelope_version),
      redemption_envelope_hash: after?.internal_envelope_hash,
    });
    expect(row.redemption_event_id).toBe(after?.envelope.parties.party_b.binding_event_id);
    expect(row.consumed_at).not.toBeNull();
    const commands = await pool.query<{ record: Record<string, unknown> }>(
      `select record from juryai_v21.formation_commands
        where dispute_id = $1 and party_id = 'party_b'`,
      [dispute.dispute_id],
    );
    expect(commands.rows).toHaveLength(1);
    expect(commands.rows[0]?.record).toMatchObject({
      dispute_id: dispute.dispute_id,
      party_id: 'party_b',
      authority_type: 'trusted_domain_system_v2_1_1',
      base_envelope_version: before?.internal_envelope_version,
      resulting_envelope_version: after?.internal_envelope_version,
    });

    await expect(
      enabledServiceA.redeemInvitation({
        opaque_token: invitation.opaque_token,
        authenticated_principal: partyB,
      }),
    ).resolves.toEqual(invitationUnavailableResultV21());
    expect(await formationStore.findById(dispute.dispute_id)).toEqual(after);
  });

  it('allows exactly one concurrent eligible redemption and emits one binding event', async () => {
    nowMs = START_MS;
    const dispute = await createUnboundDispute('concurrent_redemption');
    const invitation = await issueFor(dispute, 'concurrent@example.com');
    const partyB = principal(unique('subject_concurrent_b'), 'concurrent@example.com');
    const results = await Promise.all([
      enabledServiceA.redeemInvitation({
        opaque_token: invitation.opaque_token,
        authenticated_principal: partyB,
      }),
      enabledServiceB.redeemInvitation({
        opaque_token: invitation.opaque_token,
        authenticated_principal: partyB,
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['redeemed', 'unavailable']);
    const row = await invitationState(invitation.invitation_id);
    expect(row.consumed_at).not.toBeNull();
    const envelope = (await formationStore.findById(dispute.dispute_id))?.envelope;
    expect(envelope?.parties.party_b.binding_event_id).toBe(row.redemption_event_id);
    expect(
      Object.values(envelope?.parties ?? {}).filter(
        (party) => party.authenticated_subject_id === partyB.authenticated_subject_id,
      ),
    ).toHaveLength(1);
  });

  it('rejects an invitation if Party B was independently bound before redemption', async () => {
    nowMs = START_MS;
    const dispute = await createUnboundDispute('already_bound');
    const invitation = await issueFor(dispute, 'intended@example.com');
    const independentlyBound = bind(
      (await formationStore.findById(dispute.dispute_id))!.envelope,
      'party_b',
      unique('subject_independently_bound'),
    );
    await pool.query(
      `update juryai_v21.formation_disputes set envelope = $1::jsonb where dispute_id = $2`,
      [canonicalSerialize(independentlyBound), dispute.dispute_id],
    );
    await expect(
      enabledServiceA.redeemInvitation({
        opaque_token: invitation.opaque_token,
        authenticated_principal: principal(unique('subject_intended'), 'intended@example.com'),
      }),
    ).resolves.toEqual(invitationUnavailableResultV21());
    expect((await invitationState(invitation.invitation_id)).consumed_at).toBeNull();
    expect((await formationStore.findById(dispute.dispute_id))?.envelope).toEqual(
      independentlyBound,
    );
  });
});

describe('redemption rollback, CAS, and database security', () => {
  it('rolls back the envelope when invitation consumption fails', async () => {
    nowMs = START_MS;
    const dispute = await createUnboundDispute('consumption_rollback');
    const invitation = await issueFor(dispute, 'rollback@example.com');
    const before = await formationStore.findById(dispute.dispute_id);
    await pool.query(`
      create function juryai_v21.test_reject_invitation_consumption()
      returns trigger language plpgsql as $$
      begin raise exception 'test invitation consumption failure' using errcode = '55000'; end;
      $$;
      create trigger test_reject_invitation_consumption
      before update on juryai_v21.formation_invitations
      for each row execute function juryai_v21.test_reject_invitation_consumption();
    `);
    try {
      await expect(
        enabledServiceA.redeemInvitation({
          opaque_token: invitation.opaque_token,
          authenticated_principal: principal(unique('subject_rollback_b'), 'rollback@example.com'),
        }),
      ).resolves.toEqual(invitationUnavailableResultV21());
    } finally {
      await pool.query(`
        drop trigger test_reject_invitation_consumption
          on juryai_v21.formation_invitations;
        drop function juryai_v21.test_reject_invitation_consumption();
      `);
    }
    expect(await formationStore.findById(dispute.dispute_id)).toEqual(before);
    expect((await invitationState(invitation.invitation_id)).consumed_at).toBeNull();
    expect(
      (
        await pool.query(`select 1 from juryai_v21.formation_commands where dispute_id = $1`, [
          dispute.dispute_id,
        ])
      ).rows,
    ).toEqual([]);
  });

  it('leaves zero partial writes when the authoritative envelope CAS updates no row', async () => {
    nowMs = START_MS;
    const dispute = await createUnboundDispute('stale_cas');
    const invitation = await issueFor(dispute, 'cas@example.com');
    const before = await formationStore.findById(dispute.dispute_id);
    await pool.query(`
      create function juryai_v21.test_skip_invitation_envelope_update()
      returns trigger language plpgsql as $$ begin return null; end; $$;
      create trigger test_skip_invitation_envelope_update
      before update on juryai_v21.formation_disputes
      for each row
      when (old.dispute_id = '${dispute.dispute_id}')
      execute function juryai_v21.test_skip_invitation_envelope_update();
    `);
    try {
      await expect(
        enabledServiceA.redeemInvitation({
          opaque_token: invitation.opaque_token,
          authenticated_principal: principal(unique('subject_cas_b'), 'cas@example.com'),
        }),
      ).resolves.toEqual(invitationUnavailableResultV21());
    } finally {
      await pool.query(`
        drop trigger test_skip_invitation_envelope_update
          on juryai_v21.formation_disputes;
        drop function juryai_v21.test_skip_invitation_envelope_update();
      `);
    }
    expect(await formationStore.findById(dispute.dispute_id)).toEqual(before);
    expect((await invitationState(invitation.invitation_id)).consumed_at).toBeNull();
  });

  it('keeps the invitation table private, RLS-protected, and transition-only', async () => {
    const table = await pool.query<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity
         from pg_class as c
         join pg_namespace as n on n.oid = c.relnamespace
        where n.nspname = 'juryai_v21' and c.relname = 'formation_invitations'`,
    );
    expect(table.rows).toEqual([{ relrowsecurity: true }]);
    const grants = await pool.query<{ count: number }>(
      `select count(*)::int as count
         from information_schema.table_privileges
        where table_schema = 'juryai_v21'
          and table_name = 'formation_invitations'
          and grantee in ('PUBLIC', 'anon', 'authenticated')`,
    );
    expect(grants.rows[0]?.count).toBe(0);
    const rolePrivileges = await pool.query<{
      anon_schema_usage: boolean;
      anon_select: boolean;
      authenticated_schema_usage: boolean;
      authenticated_select: boolean;
    }>(
      `select
         has_schema_privilege('anon', 'juryai_v21', 'usage') as anon_schema_usage,
         has_table_privilege(
           'anon',
           'juryai_v21.formation_invitations',
           'select'
         ) as anon_select,
         has_schema_privilege('authenticated', 'juryai_v21', 'usage')
           as authenticated_schema_usage,
         has_table_privilege(
           'authenticated',
           'juryai_v21.formation_invitations',
           'select'
         ) as authenticated_select`,
    );
    expect(rolePrivileges.rows[0]).toEqual({
      anon_schema_usage: false,
      anon_select: false,
      authenticated_schema_usage: false,
      authenticated_select: false,
    });

    const dispute = await createUnboundDispute('immutable_bootstrap');
    const invitation = await issueFor(dispute, 'immutable@example.com');
    await expect(
      pool.query(
        `update juryai_v21.formation_invitations
            set issuer_principal_id = $1
          where invitation_id = $2`,
        [unique('subject_tamper'), invitation.invitation_id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    expect((await invitationState(invitation.invitation_id)).issuer_principal_id).toBe(
      dispute.party_a_subject,
    );
  });

  it('rejects transaction-level redemption without the test-only feature capability', async () => {
    nowMs = START_MS;
    const dispute = await createUnboundDispute('transaction_off');
    const invitation = await issueFor(dispute, 'off@example.com');
    const partyB = principal(unique('subject_transaction_off_b'), 'off@example.com');
    await expect(
      invitationStoreA.redeemInvitation({
        opaque_token: invitation.opaque_token,
        authenticated_principal: partyB,
        feature_authority: null,
        first_party_authority: TRUSTED_FIRST_PARTY_INVITATION_ACTION_V21,
      }),
    ).resolves.toEqual(invitationUnavailableResultV21());
    expect((await invitationState(invitation.invitation_id)).consumed_at).toBeNull();
    expect(
      (await formationStore.findById(dispute.dispute_id))?.envelope.parties.party_b,
    ).toMatchObject({ identity_assurance: 'unbound', authenticated_subject_id: null });

    expect(testOnlyInvitationFeatureAuthorityV21().authority_kind).toBe(
      'test_only_invitation_feature',
    );
  });
});
