import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  INTENT_ASSURANCE_ACTIONS_V1,
  INTENT_ASSURANCE_POLICY_VERSION_V1,
  TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
  TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
  observeIntentAssuranceEvidenceV1,
  resolveIntentAssurancePolicyDecisionV1,
  type HumanHandoffChallengeV1,
  type IntentAssuranceActionV1,
  type IntentAssuranceLevelV1,
  type IntentAssuranceProtocolProfileV1,
} from '../intent-assurance/intent-assurance.js';
import { canonicalSerialize } from '../v2/case-envelope.js';
import {
  TRUSTED_SYSTEM_AUTHORITY_V211,
  partyAuthorityV211,
  type CaseEnvelopeV211,
  type PartyIdV211,
} from '../v2-1-1/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV211,
  ceremonyCommandForV211,
  createInitialCaseEnvelopeV211,
  type EnvelopeCeremonyOperationV211,
} from '../v2-1-1/envelope-ceremony.js';
import {
  createPartyReviewApplicationV1,
  type PartyReviewApplicationV1,
  type PartyReviewProtectedActionV1,
} from '../v2-1-1/party-review-application.js';
import { derivePartyReviewStateV1 } from '../v2-1-1/party-review-state.js';
import { PostgresFormationRepositoryV211 } from '../v2-1-1/postgres-formation-repository.js';
import {
  PostgresPartyReviewRepositoryV1,
  type PartyReviewIdentityKindV1,
} from '../v2-1-1/postgres-party-review-repository.js';

const DATABASE_URL = process.env.JURYAI_TEST_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'v2-1-1-party-review-persistence.test.ts requires JURYAI_TEST_DATABASE_URL pointing to an isolated database.',
  );
}

const pool = new Pool({ connectionString: DATABASE_URL });
const formationStore = new PostgresFormationRepositoryV211({ pool });
let sequence = 0;
let nowMs = Date.parse('2026-09-03T02:00:00.000Z');

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence}`;
}

function repository(): PostgresPartyReviewRepositoryV1 {
  return new PostgresPartyReviewRepositoryV1({
    pool,
    clock: {
      now: () => {
        nowMs += 1_000;
        return new Date(nowMs).toISOString();
      },
    },
    ids: {
      next: (kind: PartyReviewIdentityKindV1, partyId: PartyIdV211) => {
        const prefix: Record<PartyReviewIdentityKindV1, string> = {
          challenge: 'handoff_challenge',
          command: `command_${partyId}`,
          confirmation: `confirmation_${partyId}`,
          confirmation_event: `confirmation_event_${partyId}`,
          reopen_event: `reopen_event_${partyId}`,
          receipt: 'assurance_receipt',
          consumption: 'assurance_consumption',
        };
        return unique(prefix[kind]);
      },
      public_reference: () => `DB5-${String(++sequence).padStart(4, '0')}`,
    },
  });
}

const reviewStoreA = repository();
const reviewStoreB = repository();

function ceremony(
  envelope: CaseEnvelopeV211,
  authority: Parameters<typeof applyEnvelopeCeremonyCommandV211>[0]['execution_authority'],
  operation: EnvelopeCeremonyOperationV211,
): CaseEnvelopeV211 {
  const result = applyEnvelopeCeremonyCommandV211({
    envelope,
    command: ceremonyCommandForV211(envelope, unique('ceremony'), operation),
    execution_authority: authority,
  });
  if (result.status !== 'applied') throw new Error(`${result.reason_code}: ${result.message}`);
  return result.envelope;
}

async function seed(label: string) {
  const subjectA = unique('subject_a');
  const subjectB = unique('subject_b');
  let envelope = createInitialCaseEnvelopeV211(unique(`dispute_${label}`), {
    party_a: [],
    party_b: [],
  });
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
    type: 'bind_party',
    party_slot: 'party_a',
    authenticated_subject_id: subjectA,
    binding_event_id: unique('binding_party_a'),
  });
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
    type: 'bind_party',
    party_slot: 'party_b',
    authenticated_subject_id: subjectB,
    binding_event_id: unique('binding_party_b'),
  });
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
    type: 'open_controlled_disclosure',
  });
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V211, {
    type: 'enter_final_confirmation',
  });
  await formationStore.createDispute(envelope);
  return {
    dispute_id: envelope.control.case_id,
    subject_a: subjectA,
    subject_b: subjectB,
    envelope,
  };
}

function profile(action: PartyReviewProtectedActionV1): IntentAssuranceProtocolProfileV1 {
  return {
    policy_version: INTENT_ASSURANCE_POLICY_VERSION_V1,
    profile_id: 'profile_pr5_persistence_hhc3',
    minimum_assurance_by_action: Object.fromEntries(
      INTENT_ASSURANCE_ACTIONS_V1.map((candidate) => [candidate, 'HHC-3']),
    ) as Record<IntentAssuranceActionV1, IntentAssuranceLevelV1>,
  };
}

function resolvedPolicy(action: PartyReviewProtectedActionV1) {
  const result = resolveIntentAssurancePolicyDecisionV1(
    action,
    profile(action),
    TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
  );
  if (!result) throw new Error('test policy must resolve');
  return result;
}

function application(subject: string, store = reviewStoreA): PartyReviewApplicationV1 {
  return createPartyReviewApplicationV1({
    authenticated_subject_id: subject,
    repository: store,
    resolve_policy: resolvedPolicy,
    permitted_methods: () => ['first_party_ceremony'],
    challenge_ttl_seconds: 300,
  });
}

function evidence(challenge: HumanHandoffChallengeV1) {
  const observed = observeIntentAssuranceEvidenceV1(
    {
      method: 'first_party_ceremony',
      challenge_id: challenge.challenge_id,
      first_party_session_id: unique('first_party_session'),
      ceremony_event_id: unique('ceremony_event'),
      server_observed: true,
      observed_at: challenge.issued_at,
      evidence_reference: unique('evidence_reference'),
    },
    TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
  );
  if (!observed) throw new Error('test evidence must be trusted');
  return observed;
}

async function issueConfirmation(app: PartyReviewApplicationV1, disputeId: string) {
  const issued = await app.issueConfirmationChallenge(disputeId);
  if (issued.status !== 'issued') throw new Error(`${issued.reason_code}: ${issued.message}`);
  return issued.challenge;
}

async function assuranceCounts(disputeId: string) {
  const result = await pool.query<{ name: string; count: number }>(
    `select name, count from (
       select 'challenges' name, count(*)::int count
         from juryai_v21.formation_assurance_challenges where dispute_id = $1
       union all select 'receipts', count(*)::int
         from juryai_v21.formation_assurance_receipts where dispute_id = $1
       union all select 'consumptions', count(*)::int
         from juryai_v21.formation_assurance_consumptions where dispute_id = $1
       union all select 'commands', count(*)::int
         from juryai_v21.formation_commands where dispute_id = $1
     ) counts`,
    [disputeId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.name, row.count]));
}

beforeAll(async () => {
  await formationStore.assertReady();
  await reviewStoreA.assertReady();
});

afterAll(async () => {
  await pool.end();
});

describe('PR 5 durable first-party review persistence', () => {
  it('atomically consumes assurance and records exactly one canonical confirmation and audit chain', async () => {
    const seeded = await seed('atomic_confirmation');
    const app = application(seeded.subject_a);
    const challenge = await issueConfirmation(app, seeded.dispute_id);
    const before = await app.getReview(seeded.dispute_id);
    const result = await app.confirmCaseAccount({
      case_id: seeded.dispute_id,
      challenge_id: challenge.challenge_id,
      observed_evidence: evidence(challenge),
    });
    expect(result).toMatchObject({
      status: 'applied',
      review_state: { own_confirmation_state: 'confirmed', shared_readiness: 'not_ready' },
    });
    const stored = await formationStore.findById(seeded.dispute_id);
    expect(stored?.internal_envelope_version).toBe(seeded.envelope.control.envelope_version + 1);
    expect(stored?.envelope.formation.confirmations.party_a).toHaveLength(1);
    expect(stored?.envelope.formation.confirmations.party_b).toHaveLength(0);
    expect(await assuranceCounts(seeded.dispute_id)).toEqual({
      challenges: 1,
      receipts: 1,
      consumptions: 1,
      commands: 1,
    });
    const audit = await pool.query<{
      challenge: unknown;
      receipt: unknown;
      consumption: unknown;
      command: unknown;
    }>(
      `select c.record challenge, r.record receipt, x.record consumption, m.record command
         from juryai_v21.formation_assurance_challenges c
         join juryai_v21.formation_assurance_receipts r using (challenge_id, dispute_id, party_id)
         join juryai_v21.formation_assurance_consumptions x
           using (challenge_id, dispute_id, party_id)
         join juryai_v21.formation_commands m
           on m.dispute_id = c.dispute_id and m.party_id = c.party_id
        where c.challenge_id = $1`,
      [challenge.challenge_id],
    );
    expect(audit.rows[0]).toMatchObject({
      challenge: { status: 'consumed', requested_action: 'confirm_case_account' },
      receipt: { authorization_status: 'consumed', achieved_assurance: 'HHC-3' },
      consumption: { requested_action: 'confirm_case_account' },
      command: {
        assurance_challenge_id: challenge.challenge_id,
        assurance_method: 'first_party_ceremony',
      },
    });
    expect(result.status === 'applied' ? result.review_state.review_state_hash : null).not.toBe(
      before?.review_state_hash,
    );
  });

  it('serializes concurrent satisfaction/confirmation attempts to one receipt and one transition', async () => {
    const seeded = await seed('concurrent_confirmation');
    const appA = application(seeded.subject_a, reviewStoreA);
    const appB = application(seeded.subject_a, reviewStoreB);
    const challenge = await issueConfirmation(appA, seeded.dispute_id);
    const observed = evidence(challenge);
    const [left, right] = await Promise.all([
      appA.confirmCaseAccount({
        case_id: seeded.dispute_id,
        challenge_id: challenge.challenge_id,
        observed_evidence: observed,
      }),
      appB.confirmCaseAccount({
        case_id: seeded.dispute_id,
        challenge_id: challenge.challenge_id,
        observed_evidence: observed,
      }),
    ]);
    expect([left.status, right.status].sort()).toEqual(['applied', 'rejected']);
    expect([left, right].find((result) => result.status === 'rejected')).toMatchObject({
      reason_code: 'already_used',
    });
    expect(await assuranceCounts(seeded.dispute_id)).toEqual({
      challenges: 1,
      receipts: 1,
      consumptions: 1,
      commands: 1,
    });
    const stored = await formationStore.findById(seeded.dispute_id);
    expect(stored?.envelope.formation.confirmations.party_a).toHaveLength(1);
    const replay = await appA.confirmCaseAccount({
      case_id: seeded.dispute_id,
      challenge_id: challenge.challenge_id,
      observed_evidence: observed,
    });
    expect(replay).toMatchObject({ status: 'rejected', reason_code: 'already_used' });
  });

  it('rolls back challenge consumption, receipt, command, and envelope together on a late failure', async () => {
    const seeded = await seed('rollback');
    const app = application(seeded.subject_a);
    const challenge = await issueConfirmation(app, seeded.dispute_id);
    const before = await formationStore.findById(seeded.dispute_id);
    await pool.query(
      `create function juryai_v21.test_pr5_reject_command()
       returns trigger language plpgsql security invoker
       set search_path = pg_catalog, pg_temp as $$
       begin
         if new.record ->> 'dispute_id' = '${seeded.dispute_id}' then
           raise exception 'intentional PR5 rollback probe' using errcode = '55000';
         end if;
         return new;
       end $$`,
    );
    await pool.query(
      `create trigger test_pr5_reject_command before insert on juryai_v21.formation_commands
       for each row execute function juryai_v21.test_pr5_reject_command()`,
    );
    try {
      await expect(
        app.confirmCaseAccount({
          case_id: seeded.dispute_id,
          challenge_id: challenge.challenge_id,
          observed_evidence: evidence(challenge),
        }),
      ).rejects.toThrow(/rollback probe/iu);
    } finally {
      await pool.query('drop trigger test_pr5_reject_command on juryai_v21.formation_commands');
      await pool.query('drop function juryai_v21.test_pr5_reject_command()');
    }
    expect(await formationStore.findById(seeded.dispute_id)).toEqual(before);
    expect(await assuranceCounts(seeded.dispute_id)).toEqual({
      challenges: 1,
      receipts: 0,
      consumptions: 0,
      commands: 0,
    });
    const status = await pool.query<{ status: string }>(
      `select status from juryai_v21.formation_assurance_challenges where challenge_id = $1`,
      [challenge.challenge_id],
    );
    expect(status.rows[0]?.status).toBe('pending');
  });

  it('keeps challenge existence and replay isolated across parties and disputes', async () => {
    const first = await seed('cross_scope_first');
    const second = await seed('cross_scope_second');
    const owner = application(first.subject_a);
    const challenge = await issueConfirmation(owner, first.dispute_id);
    const observed = evidence(challenge);
    const wrongParty = await application(first.subject_b).confirmCaseAccount({
      case_id: first.dispute_id,
      challenge_id: challenge.challenge_id,
      observed_evidence: observed,
    });
    const wrongDispute = await application(second.subject_a).confirmCaseAccount({
      case_id: second.dispute_id,
      challenge_id: challenge.challenge_id,
      observed_evidence: observed,
    });
    expect(wrongParty).toEqual({
      status: 'rejected',
      reason_code: 'unavailable',
      message: 'Review is unavailable.',
    });
    expect(wrongDispute).toEqual(wrongParty);
    expect(await assuranceCounts(first.dispute_id)).toEqual({
      challenges: 1,
      receipts: 0,
      consumptions: 0,
      commands: 0,
    });
  });

  it('keeps hidden confirmation activity out of the opponent review and frozen projection cursor', async () => {
    const seeded = await seed('privacy');
    const a = application(seeded.subject_a);
    const b = application(seeded.subject_b);
    const bBefore = await b.getReview(seeded.dispute_id);
    const challenge = await issueConfirmation(a, seeded.dispute_id);
    await a.confirmCaseAccount({
      case_id: seeded.dispute_id,
      challenge_id: challenge.challenge_id,
      observed_evidence: evidence(challenge),
    });
    const bAfter = await b.getReview(seeded.dispute_id);
    expect(bAfter).toEqual(bBefore);
    expect(canonicalSerialize(bAfter)).not.toMatch(/confirmation_party_a|assurance_receipt/iu);
  });

  it('persists bilateral readiness symmetrically and assurance-gated reopen removes it', async () => {
    const seeded = await seed('bilateral_reopen');
    const a = application(seeded.subject_a);
    const b = application(seeded.subject_b);
    for (const app of [a, b]) {
      const challenge = await issueConfirmation(app, seeded.dispute_id);
      const confirmedResult = await app.confirmCaseAccount({
        case_id: seeded.dispute_id,
        challenge_id: challenge.challenge_id,
        observed_evidence: evidence(challenge),
      });
      expect(confirmedResult.status).toBe('applied');
    }
    expect(await a.getReview(seeded.dispute_id)).toMatchObject({
      own_confirmation_state: 'confirmed',
      shared_readiness: 'ready_for_lock',
    });
    expect(await b.getReview(seeded.dispute_id)).toMatchObject({
      own_confirmation_state: 'confirmed',
      shared_readiness: 'ready_for_lock',
    });
    const before = await formationStore.findById(seeded.dispute_id);
    const issued = await a.issueReopenChallenge({
      case_id: seeded.dispute_id,
      reason: 'I need to correct my own canonical account.',
    });
    if (issued.status !== 'issued') throw new Error(issued.message);
    const reopened = await a.reopenConfirmedMaterial({
      case_id: seeded.dispute_id,
      challenge_id: issued.challenge.challenge_id,
      observed_evidence: evidence(issued.challenge),
    });
    expect(reopened).toMatchObject({
      status: 'applied',
      review_state: { own_confirmation_state: 'unconfirmed', shared_readiness: 'not_ready' },
    });
    const after = await formationStore.findById(seeded.dispute_id);
    expect(after?.envelope.parties.party_a.formation_epoch).toBe(
      (before?.envelope.parties.party_a.formation_epoch ?? 0) + 1,
    );
    expect(after?.envelope.parties.party_a.edit_state).toBe('reopened');
    expect(after?.envelope.parties.party_b).toEqual(before?.envelope.parties.party_b);
    expect(derivePartyReviewStateV1(after!.envelope, 'party_b').shared_readiness).toBe('not_ready');
  });

  it('enforces private RLS/revocation, lifecycle, and one-receipt/one-consumption constraints', async () => {
    const catalog = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'juryai_v21'
          and c.relname in (
            'formation_assurance_challenges',
            'formation_assurance_receipts',
            'formation_assurance_consumptions'
          )
        order by c.relname`,
    );
    expect(catalog.rows).toHaveLength(3);
    expect(catalog.rows).toEqual(
      catalog.rows.map((row) => ({
        ...row,
        relrowsecurity: true,
      })),
    );
    const grants = await pool.query<{ count: number }>(
      `select count(*)::int as count
         from information_schema.table_privileges
        where table_schema = 'juryai_v21'
          and table_name in (
            'formation_assurance_challenges',
            'formation_assurance_receipts',
            'formation_assurance_consumptions'
          )
          and grantee in ('PUBLIC', 'anon', 'authenticated')`,
    );
    expect(grants.rows[0]?.count).toBe(0);
    const constraints = await pool.query<{ conname: string }>(
      `select conname from pg_constraint
        where connamespace = 'juryai_v21'::regnamespace
          and conname in (
            'formation_assurance_challenges_receipt_fk',
            'formation_assurance_challenges_consumption_fk',
            'formation_assurance_receipts_one_per_challenge',
            'formation_assurance_receipts_consumption_fk',
            'formation_assurance_consumptions_one_per_challenge',
            'formation_assurance_consumptions_one_per_receipt'
          ) order by conname`,
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      'formation_assurance_challenges_consumption_fk',
      'formation_assurance_challenges_receipt_fk',
      'formation_assurance_consumptions_one_per_challenge',
      'formation_assurance_consumptions_one_per_receipt',
      'formation_assurance_receipts_consumption_fk',
      'formation_assurance_receipts_one_per_challenge',
    ]);

    const seeded = await seed('database_guards');
    const app = application(seeded.subject_a);
    const challenge = await issueConfirmation(app, seeded.dispute_id);
    await app.confirmCaseAccount({
      case_id: seeded.dispute_id,
      challenge_id: challenge.challenge_id,
      observed_evidence: evidence(challenge),
    });
    await expect(
      pool.query(
        `update juryai_v21.formation_assurance_challenges
            set action_payload = action_payload || '{"tampered":true}'::jsonb
          where challenge_id = $1`,
        [challenge.challenge_id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    for (const table of ['formation_assurance_receipts', 'formation_assurance_consumptions']) {
      await expect(
        pool.query(
          `update juryai_v21.${table}
              set record = record || '{"tampered":true}'::jsonb
            where challenge_id = $1`,
          [challenge.challenge_id],
        ),
      ).rejects.toMatchObject({ code: '55000' });
    }
  });
});
