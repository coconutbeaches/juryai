import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloneCanonical } from '../v2/case-envelope.js';
import { TRUSTED_SYSTEM_AUTHORITY_V211, type CaseEnvelopeV211 } from '../v2-1-1/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV211,
  ceremonyCommandForV211,
  createInitialCaseEnvelopeV211,
} from '../v2-1-1/envelope-ceremony.js';
import { PostgresFormationRepositoryV211 } from '../v2-1-1/postgres-formation-repository.js';
import {
  TRUSTED_SYSTEM_AUTHORITY_V212,
  partyAuthorityV212,
  type CaseEnvelopeV212,
  type PartyIdV212,
} from '../v2-1-2/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV212,
  ceremonyCommandForV212,
  createInitialCaseEnvelopeV212,
  type EnvelopeCeremonyOperationV212,
} from '../v2-1-2/envelope-ceremony.js';
import { PostgresDisclosureReviewRepositoryV212 } from '../v2-1-2/postgres-disclosure-review-repository.js';
import { projectRoot } from './test-helpers.js';

const DATABASE_URL = process.env.JURYAI_TEST_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'v2-1-2-disclosure-review-persistence.test.ts requires JURYAI_TEST_DATABASE_URL pointing to an isolated database.',
  );
}

const pool = new Pool({ connectionString: DATABASE_URL });
const storeA = new PostgresDisclosureReviewRepositoryV212({ connectionString: DATABASE_URL });
const storeB = new PostgresDisclosureReviewRepositoryV212({ connectionString: DATABASE_URL });
const legacyStore = new PostgresFormationRepositoryV211({ connectionString: DATABASE_URL });
let sequence = 0;

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}_${process.pid}_${sequence}`;
}

function ceremony(
  envelope: CaseEnvelopeV212,
  authority: Parameters<typeof applyEnvelopeCeremonyCommandV212>[0]['execution_authority'],
  operation: EnvelopeCeremonyOperationV212,
): CaseEnvelopeV212 {
  const result = applyEnvelopeCeremonyCommandV212({
    envelope,
    command: ceremonyCommandForV212(envelope, unique('command'), operation),
    execution_authority: authority,
  });
  if (result.status !== 'applied') throw new Error(`${result.reason_code}: ${result.message}`);
  return result.envelope;
}

function disclosedEnvelope(label: string): {
  envelope: CaseEnvelopeV212;
  subject_a: string;
  subject_b: string;
} {
  const subjectA = unique('subject_a');
  const subjectB = unique('subject_b');
  let envelope = createInitialCaseEnvelopeV212(unique(`dispute_${label}`));
  for (const [partyId, subject] of [
    ['party_a', subjectA],
    ['party_b', subjectB],
  ] as const) {
    envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
      type: 'bind_party',
      party_slot: partyId,
      authenticated_subject_id: subject,
      binding_event_id: unique(`binding_${partyId}`),
    });
  }
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
    type: 'open_controlled_disclosure',
  });
  return { envelope, subject_a: subjectA, subject_b: subjectB };
}

function acknowledgeDomain(envelope: CaseEnvelopeV212, partyId: PartyIdV212): CaseEnvelopeV212 {
  return ceremony(envelope, partyAuthorityV212(envelope, partyId, 'first_party_human'), {
    type: 'record_disclosure_review_acknowledgment',
    acknowledgment_id: unique(`disclosure_ack_${partyId}`),
    event_id: unique(`disclosure_ack_event_${partyId}`),
    acknowledged_at: new Date(
      Date.parse('2026-09-03T04:00:00.000Z') + sequence * 1_000,
    ).toISOString(),
  });
}

function v211Envelope(label: string): CaseEnvelopeV211 {
  let envelope = createInitialCaseEnvelopeV211(unique(`dispute_${label}`));
  for (const partyId of ['party_a', 'party_b'] as const) {
    const result = applyEnvelopeCeremonyCommandV211({
      envelope,
      command: ceremonyCommandForV211(envelope, unique('command_v211'), {
        type: 'bind_party',
        party_slot: partyId,
        authenticated_subject_id: unique(`subject_v211_${partyId}`),
        binding_event_id: unique(`binding_${partyId}`),
      }),
      execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
    });
    if (result.status !== 'applied') throw new Error(result.message);
    envelope = result.envelope;
  }
  return envelope;
}

beforeAll(async () => {
  await Promise.all([storeA.assertReady(), storeB.assertReady(), legacyStore.assertReady()]);
});

afterAll(async () => {
  await Promise.all([storeA.close(), storeB.close(), legacyStore.close(), pool.end()]);
});

describe('V2.1.2 disclosure-review persistence', () => {
  it('round-trips authoritative V2.1.2 while preserving V2.1.1 side-by-side isolation', async () => {
    const seeded = disclosedEnvelope('round_trip');
    const created = await storeA.createDispute(seeded.envelope);
    expect(created).toMatchObject({ created: true });
    expect(created.stored.envelope).toEqual(seeded.envelope);
    expect(await storeA.findById(seeded.envelope.control.case_id)).toEqual(created.stored);

    const legacy = v211Envelope('side_by_side');
    expect((await legacyStore.createDispute(legacy)).created).toBe(true);
    expect(await storeA.findById(legacy.control.case_id)).toBeNull();
    await expect(legacyStore.findById(seeded.envelope.control.case_id)).rejects.toThrow(
      /v211_contract_version|Expected juryai-case-envelope-v2\.1\.1/u,
    );
  });

  it('atomically records a subject-derived party acknowledgment and command audit', async () => {
    const seeded = disclosedEnvelope('ack_atomic');
    const created = await storeA.createDispute(seeded.envelope);
    const beforeCursor = seeded.envelope.control.party_views.party_a;
    const result = await storeA.commitDisclosureReviewAcknowledgment({
      dispute_id: seeded.envelope.control.case_id,
      authenticated_subject_id: seeded.subject_a,
      expected_internal_envelope_version: created.stored.internal_envelope_version,
      expected_internal_envelope_hash: created.stored.internal_envelope_hash,
      command_id: unique('command_ack'),
      acknowledgment_id: unique('disclosure_ack_party_a'),
      event_id: unique('disclosure_ack_event_party_a'),
      acknowledged_at: '2026-09-03T04:30:00.000Z',
      recorded_at_ms: Date.parse('2026-09-03T04:30:00.000Z'),
    });
    expect(result.status).toBe('committed');
    if (result.status !== 'committed') throw new Error(result.status);
    expect(result.stored.envelope.formation.disclosure_review_acknowledgments.party_a).toHaveLength(
      1,
    );
    expect(result.stored.envelope.formation.disclosure_review_acknowledgments.party_b).toEqual([]);
    expect(result.stored.envelope.control.party_views.party_a).toEqual(beforeCursor);
    const audit = await pool.query<{ record: Record<string, unknown> }>(
      `select record from juryai_v21.formation_commands
        where dispute_id = $1 and party_id = 'party_a'`,
      [seeded.envelope.control.case_id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.record).toMatchObject({
      persistence_contract_version: 'juryai-v2.1.2-disclosure-review-persistence-v1',
      party_id: 'party_a',
      operation_type: 'record_disclosure_review_acknowledgment',
    });
  });

  it('derives party identity from the authenticated subject and leaves unauthorized attempts empty', async () => {
    const seeded = disclosedEnvelope('subject_authority');
    const created = await storeA.createDispute(seeded.envelope);
    const result = await storeA.commitDisclosureReviewAcknowledgment({
      dispute_id: seeded.envelope.control.case_id,
      authenticated_subject_id: unique('subject_intruder'),
      expected_internal_envelope_version: created.stored.internal_envelope_version,
      expected_internal_envelope_hash: created.stored.internal_envelope_hash,
      command_id: unique('command_ack'),
      acknowledgment_id: unique('disclosure_ack_party_a'),
      event_id: unique('disclosure_ack_event_party_a'),
      acknowledged_at: '2026-09-03T04:31:00.000Z',
      recorded_at_ms: Date.parse('2026-09-03T04:31:00.000Z'),
    });
    expect(result).toEqual({ status: 'unauthorized' });
    const stored = await storeA.findById(seeded.envelope.control.case_id);
    expect(stored?.envelope).toEqual(seeded.envelope);
    const audit = await pool.query<{ count: number }>(
      `select count(*)::int count from juryai_v21.formation_commands where dispute_id = $1`,
      [seeded.envelope.control.case_id],
    );
    expect(audit.rows[0]?.count).toBe(0);
  });

  it('commits concurrent final-confirmation attempts exactly once with authoritative CAS', async () => {
    const seeded = disclosedEnvelope('concurrent_final');
    let envelope = acknowledgeDomain(seeded.envelope, 'party_a');
    envelope = acknowledgeDomain(envelope, 'party_b');
    const created = await storeA.createDispute(envelope);
    const expected = {
      dispute_id: envelope.control.case_id,
      expected_internal_envelope_version: created.stored.internal_envelope_version,
      expected_internal_envelope_hash: created.stored.internal_envelope_hash,
    };
    const [left, right] = await Promise.all([
      storeA.commitFinalConfirmation({ ...expected, command_id: unique('command_final') }),
      storeB.commitFinalConfirmation({ ...expected, command_id: unique('command_final') }),
    ]);
    expect([left.status, right.status].sort()).toEqual(['committed', 'conflict']);
    const stored = await storeA.findById(envelope.control.case_id);
    expect(stored?.envelope.control).toMatchObject({
      workflow_state: 'final_confirmation',
      envelope_version: envelope.control.envelope_version + 1,
    });
  });

  it('rejects mismatched contract pairs and incomplete V2.1.2 envelope shape at the database boundary', async () => {
    const seeded = disclosedEnvelope('db_contract_pair');
    const mismatched = cloneCanonical(seeded.envelope) as unknown as Record<string, unknown>;
    (mismatched.control as Record<string, unknown>).schema_version = 'juryai-case-envelope-v2.1.1';
    await expect(
      pool.query(`insert into juryai_v21.formation_disputes (envelope) values ($1::jsonb)`, [
        mismatched,
      ]),
    ).rejects.toThrow(/formation_disputes_contract_pair_v212/u);

    const incomplete = cloneCanonical(seeded.envelope) as unknown as Record<string, unknown>;
    delete (incomplete.formation as Record<string, unknown>).disclosure_review_acknowledgments;
    await expect(
      pool.query(`insert into juryai_v21.formation_disputes (envelope) values ($1::jsonb)`, [
        incomplete,
      ]),
    ).rejects.toThrow(/formation_disputes_contract_pair_v212/u);

    const missingCommandVersion = cloneCanonical(seeded.envelope) as unknown as Record<
      string,
      unknown
    >;
    delete (missingCommandVersion.control as Record<string, unknown>).command_contract_version;
    await expect(
      pool.query(`insert into juryai_v21.formation_disputes (envelope) values ($1::jsonb)`, [
        missingCommandVersion,
      ]),
    ).rejects.toThrow(/formation_disputes_contract_pair_v212/u);

    const rows = await pool.query<{ count: number }>(
      `select count(*)::int count from juryai_v21.formation_disputes
        where dispute_id = $1`,
      [seeded.envelope.control.case_id],
    );
    expect(rows.rows[0]?.count).toBe(0);
  });

  it('keeps the side-by-side migration conversion-free, private, and contract-paired', async () => {
    const migration = readFileSync(
      `${projectRoot}/supabase/migrations/20260903043758_v212_disclosure_review_closure.sql`,
      'utf8',
    );
    expect(migration).not.toMatch(/\bupdate\s+juryai_v21\.formation_disputes\b/iu);
    expect(migration).not.toMatch(/\bdelete\s+from\b/iu);
    expect(migration).not.toMatch(/\binsert\s+into\b/iu);
    expect(migration).toContain('juryai-case-envelope-v2.1.1');
    expect(migration).toContain('juryai-case-envelope-v2.1.2');
    expect(migration).toContain('juryai-party-formation-projection-v2.1.1');

    const catalog = await pool.query<{
      constraint_definition: string;
      rls_enabled: boolean;
      public_grants: number;
    }>(
      `select pg_get_constraintdef(con.oid) constraint_definition,
              class.relrowsecurity rls_enabled,
              (
                select count(*)::int from information_schema.role_table_grants grants
                 where grants.table_schema = 'juryai_v21'
                   and grants.table_name = 'formation_disputes'
                   and grants.grantee in ('PUBLIC', 'anon', 'authenticated')
              ) public_grants
         from pg_constraint con
         join pg_class class on class.oid = con.conrelid
         join pg_namespace namespace on namespace.oid = class.relnamespace
        where namespace.nspname = 'juryai_v21'
          and class.relname = 'formation_disputes'
          and con.conname = 'formation_disputes_contract_pair_v212'`,
    );
    expect(catalog.rows).toHaveLength(1);
    expect(catalog.rows[0]).toMatchObject({ rls_enabled: true, public_grants: 0 });
    expect(catalog.rows[0]?.constraint_definition).toContain('juryai-case-envelope-v2.1.2');
  });
});
