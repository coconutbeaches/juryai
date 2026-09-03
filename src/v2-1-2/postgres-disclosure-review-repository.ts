/** Private PostgreSQL persistence for production-dark V2.1.2 closure commands. */

import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import {
  HASH_PATTERN_V212,
  ID_PATTERN_V212,
  TRUSTED_SYSTEM_AUTHORITY_V212,
  partyAuthorityV212,
  type CaseEnvelopeV212,
  type PartyIdV212,
} from './case-envelope.js';
import { assertValidCaseEnvelopeV212 } from './contract-validator.js';
import { applyEnvelopeCeremonyCommandV212, ceremonyCommandForV212 } from './envelope-ceremony.js';
import {
  FORMATION_PERSISTENCE_CONTRACT_VERSION_V212,
  FORMATION_PERSISTENCE_SCHEMA_V212,
  type CommitCeremonyResultV212,
  type CommitDisclosureReviewAcknowledgmentInputV212,
  type CommitFinalConfirmationInputV212,
  type StoredFormationDisputeV212,
} from './formation-persistence.js';

const SCHEMA = FORMATION_PERSISTENCE_SCHEMA_V212;

interface StoredFormationRow {
  envelope: unknown;
  internal_envelope_version: string | number;
  internal_envelope_hash: unknown;
  created_at_ms: string | number;
  updated_at_ms: string | number;
}

export interface PostgresDisclosureReviewRepositoryOptionsV212 extends PoolConfig {
  pool?: Pool;
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  const decoded = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  if (
    typeof decoded !== 'number' ||
    !Number.isSafeInteger(decoded) ||
    decoded < minimum ||
    decoded > Number.MAX_SAFE_INTEGER
  ) {
    throw new TypeError(`${label} is not a safe integer.`);
  }
  return decoded;
}

function canonicalId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN_V212.test(value)) {
    throw new TypeError(`${label} is not canonical.`);
  }
  return value;
}

function disputeId(value: unknown): string {
  const id = canonicalId(value, 'dispute_id');
  if (!id.startsWith('dispute_')) throw new TypeError('Only dispute_ identifiers are accepted.');
  return id;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN_V212.test(value)) {
    throw new TypeError(`${label} is not a SHA-256 digest.`);
  }
  return value;
}

function encode(value: unknown): string {
  return canonicalSerialize(value as never);
}

function selectedFormationColumns(alias = ''): string {
  const prefix = alias.length > 0 ? `${alias}.` : '';
  return `${prefix}envelope,
          ${prefix}internal_envelope_version,
          ${prefix}internal_envelope_hash,
          (extract(epoch from ${prefix}created_at) * 1000)::bigint as created_at_ms,
          (extract(epoch from ${prefix}updated_at) * 1000)::bigint as updated_at_ms`;
}

function decodeStored(row: StoredFormationRow): StoredFormationDisputeV212 {
  const envelope = cloneCanonical(row.envelope as CaseEnvelopeV212);
  assertValidCaseEnvelopeV212(envelope);
  disputeId(envelope.control.case_id);
  const version = safeInteger(row.internal_envelope_version, 'internal_envelope_version', 1);
  const envelopeHash = hash(row.internal_envelope_hash, 'internal_envelope_hash');
  if (
    version !== envelope.control.envelope_version ||
    envelopeHash !== envelope.control.envelope_hash
  ) {
    throw new TypeError('Stored envelope identity disagrees with canonical V2.1.2 state.');
  }
  return {
    envelope,
    internal_envelope_version: version,
    internal_envelope_hash: envelopeHash,
    created_at_ms: safeInteger(row.created_at_ms, 'created_at_ms'),
    updated_at_ms: safeInteger(row.updated_at_ms, 'updated_at_ms'),
  };
}

function partyForSubject(envelope: CaseEnvelopeV212, subject: string): PartyIdV212 | null {
  const matches = (['party_a', 'party_b'] as const).filter((partyId) => {
    const binding = envelope.parties[partyId];
    return (
      binding.identity_assurance === 'authenticated' && binding.authenticated_subject_id === subject
    );
  });
  return matches.length === 1 ? matches[0]! : null;
}

export class PostgresDisclosureReviewRepositoryV212 {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;

  constructor(options: PostgresDisclosureReviewRepositoryOptionsV212) {
    if (options.pool) {
      this.#pool = options.pool;
      this.#ownsPool = false;
    } else {
      const { pool: _pool, ...config } = options;
      this.#pool = new Pool(config);
      this.#ownsPool = true;
    }
  }

  async assertReady(): Promise<void> {
    const result = await this.#pool.query<{ ready: boolean }>(
      `select to_regclass($1 || '.formation_disputes') is not null
              and exists (
                select 1 from pg_constraint
                 where conname = 'formation_disputes_contract_pair_v212'
                   and conrelid = to_regclass($1 || '.formation_disputes')
              ) as ready`,
      [SCHEMA],
    );
    if (result.rows[0]?.ready !== true) {
      throw new Error('V2.1.2 disclosure-review persistence migration is incomplete.');
    }
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  async findById(idInput: string): Promise<StoredFormationDisputeV212 | null> {
    const id = disputeId(idInput);
    const result = await this.#pool.query(
      `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
        where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2'`,
      [id],
    );
    return result.rows[0] ? decodeStored(result.rows[0] as StoredFormationRow) : null;
  }

  /** Test/bootstrap-only dark persistence seam. No production module imports it. */
  async createDispute(
    envelopeInput: CaseEnvelopeV212,
  ): Promise<{ created: boolean; stored: StoredFormationDisputeV212 }> {
    const envelope = cloneCanonical(envelopeInput);
    assertValidCaseEnvelopeV212(envelope);
    disputeId(envelope.control.case_id);
    return this.#transaction(async (client) => {
      const inserted = await client.query(
        `insert into ${SCHEMA}.formation_disputes (envelope) values ($1::jsonb)
         on conflict (dispute_id) do nothing returning ${selectedFormationColumns()}`,
        [encode(envelope)],
      );
      if (inserted.rows[0]) {
        return { created: true, stored: decodeStored(inserted.rows[0] as StoredFormationRow) };
      }
      const found = await client.query(
        `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
          where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2'`,
        [envelope.control.case_id],
      );
      const row = found.rows[0] as StoredFormationRow | undefined;
      if (!row) throw new TypeError('A different contract already uses this dispute id.');
      const stored = decodeStored(row);
      if (encode(stored.envelope) !== encode(envelope)) {
        throw new TypeError('A different V2.1.2 envelope already uses this dispute id.');
      }
      return { created: false, stored };
    });
  }

  async commitDisclosureReviewAcknowledgment(
    input: CommitDisclosureReviewAcknowledgmentInputV212,
  ): Promise<CommitCeremonyResultV212> {
    const id = disputeId(input.dispute_id);
    const subject = canonicalId(input.authenticated_subject_id, 'authenticated_subject_id');
    canonicalId(input.command_id, 'command_id');
    canonicalId(input.acknowledgment_id, 'acknowledgment_id');
    canonicalId(input.event_id, 'event_id');
    safeInteger(input.expected_internal_envelope_version, 'expected version', 1);
    hash(input.expected_internal_envelope_hash, 'expected hash');
    safeInteger(input.recorded_at_ms, 'recorded_at_ms');

    return this.#transaction(async (client) => {
      const selected = await client.query(
        `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
          where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2' for update`,
        [id],
      );
      const row = selected.rows[0] as StoredFormationRow | undefined;
      if (!row) return { status: 'conflict', current: null };
      const current = decodeStored(row);
      if (
        current.internal_envelope_version !== input.expected_internal_envelope_version ||
        current.internal_envelope_hash !== input.expected_internal_envelope_hash
      ) {
        return { status: 'conflict', current };
      }
      const partyId = partyForSubject(current.envelope, subject);
      if (!partyId) return { status: 'unauthorized' };
      const command = ceremonyCommandForV212(current.envelope, input.command_id, {
        type: 'record_disclosure_review_acknowledgment',
        acknowledgment_id: input.acknowledgment_id,
        event_id: input.event_id,
        acknowledged_at: input.acknowledged_at,
      });
      const applied = applyEnvelopeCeremonyCommandV212({
        envelope: current.envelope,
        command,
        execution_authority: partyAuthorityV212(current.envelope, partyId, 'first_party_human'),
      });
      if (applied.status === 'rejected') {
        return {
          status: 'domain_rejected',
          reason_code: applied.reason_code,
          message: applied.message,
        };
      }
      const updated = await client.query(
        `update ${SCHEMA}.formation_disputes
            set envelope = $1::jsonb, updated_at = clock_timestamp()
          where dispute_id = $2
            and internal_envelope_version = $3
            and internal_envelope_hash = $4
          returning ${selectedFormationColumns()}`,
        [
          encode(applied.envelope),
          id,
          current.internal_envelope_version,
          current.internal_envelope_hash,
        ],
      );
      const updatedRow = updated.rows[0] as StoredFormationRow | undefined;
      if (!updatedRow) return { status: 'conflict', current };
      const commandRecord = {
        persistence_contract_version: FORMATION_PERSISTENCE_CONTRACT_VERSION_V212,
        dispute_id: id,
        party_id: partyId,
        command_id: input.command_id,
        base_envelope_version: current.internal_envelope_version,
        base_envelope_hash: current.internal_envelope_hash,
        resulting_envelope_version: applied.resulting_envelope_version,
        resulting_envelope_hash: applied.envelope.control.envelope_hash,
        operation_type: command.operation.type,
        event_id: input.event_id,
        recorded_at_ms: input.recorded_at_ms,
      };
      await client.query(`insert into ${SCHEMA}.formation_commands (record) values ($1::jsonb)`, [
        encode(commandRecord),
      ]);
      return { status: 'committed', stored: decodeStored(updatedRow) };
    });
  }

  async commitFinalConfirmation(
    input: CommitFinalConfirmationInputV212,
  ): Promise<CommitCeremonyResultV212> {
    const id = disputeId(input.dispute_id);
    canonicalId(input.command_id, 'command_id');
    safeInteger(input.expected_internal_envelope_version, 'expected version', 1);
    hash(input.expected_internal_envelope_hash, 'expected hash');
    return this.#transaction(async (client) => {
      const selected = await client.query(
        `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
          where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2' for update`,
        [id],
      );
      const row = selected.rows[0] as StoredFormationRow | undefined;
      if (!row) return { status: 'conflict', current: null };
      const current = decodeStored(row);
      if (
        current.internal_envelope_version !== input.expected_internal_envelope_version ||
        current.internal_envelope_hash !== input.expected_internal_envelope_hash
      ) {
        return { status: 'conflict', current };
      }
      const applied = applyEnvelopeCeremonyCommandV212({
        envelope: current.envelope,
        command: ceremonyCommandForV212(current.envelope, input.command_id, {
          type: 'enter_final_confirmation',
        }),
        execution_authority: TRUSTED_SYSTEM_AUTHORITY_V212,
      });
      if (applied.status === 'rejected') {
        return {
          status: 'domain_rejected',
          reason_code: applied.reason_code,
          message: applied.message,
        };
      }
      const updated = await client.query(
        `update ${SCHEMA}.formation_disputes
            set envelope = $1::jsonb, updated_at = clock_timestamp()
          where dispute_id = $2
            and internal_envelope_version = $3
            and internal_envelope_hash = $4
          returning ${selectedFormationColumns()}`,
        [
          encode(applied.envelope),
          id,
          current.internal_envelope_version,
          current.internal_envelope_hash,
        ],
      );
      const updatedRow = updated.rows[0] as StoredFormationRow | undefined;
      return updatedRow
        ? { status: 'committed', stored: decodeStored(updatedRow) }
        : { status: 'conflict', current };
    });
  }

  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
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
}
