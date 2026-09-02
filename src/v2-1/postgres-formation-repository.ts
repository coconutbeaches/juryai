/**
 * Private PostgreSQL persistence for dark V2.1 formation disputes.
 *
 * This module is intentionally not imported by a production route, WebMCP
 * adapter, browser bundle, invitation flow, or participant service. It stores
 * one authoritative CaseEnvelope and append-only audit records only.
 */

import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import {
  HASH_PATTERN_V21,
  ID_PATTERN_V21,
  partyAuthorityV21,
  type CaseEnvelopeV21,
  type PartyIdV21,
} from './case-envelope.js';
import { assertValidCaseEnvelopeV21 } from './contract-validator.js';
import { applyEnvelopeCommandV21, type EnvelopeCommandV21 } from './envelope-command.js';
import {
  FORMATION_PERSISTENCE_CONTRACT_VERSION_V21,
  FORMATION_PERSISTENCE_SCHEMA_V21,
  assertV21DisputePersistenceId,
  type ActiveFormationContextV21,
  type CommitExternalRelayCommandInputV21,
  type CommitExternalRelayCommandResultV21,
  type CreateFormationDisputeResultV21,
  type FormationCommandAuditRecordV21,
  type FormationCompilerRunAuditRecordV21,
  type FormationPartyPersistenceContextV21,
  type FormationReplayRecordV21,
  type FormationReplayResponseV21,
  type FormationSourceAuditRecordV21,
  type FormationSubmissionAuditRecordV21,
  type StoredFormationDisputeV21,
} from './formation-persistence.js';

const SCHEMA = FORMATION_PERSISTENCE_SCHEMA_V21;
const JS_MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const MAX_CLIENT_TURN_ID_LENGTH = 200;

interface StoredFormationRow {
  envelope: unknown;
  internal_envelope_version: string | number;
  internal_envelope_hash: unknown;
  created_at_ms: string | number;
  updated_at_ms: string | number;
}

interface ContextRow extends StoredFormationRow {
  party_id: unknown;
}

interface ReplayRow {
  record: unknown;
}

export interface PostgresFormationRepositoryOptionsV21 extends PoolConfig {
  pool?: Pool;
}

function postgresCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null;
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  const number = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < minimum ||
    number > JS_MAX_SAFE_INTEGER
  ) {
    throw new TypeError(`${label} is not a safe integer.`);
  }
  return number;
}

function string(value: unknown, label: string, maximum = 160): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function canonicalId(value: unknown, label: string): string {
  const decoded = string(value, label);
  if (!ID_PATTERN_V21.test(decoded)) throw new TypeError(`${label} is not canonical.`);
  return decoded;
}

function decodeClientTurnId(value: unknown): string {
  const decoded = string(value, 'client_turn_id', MAX_CLIENT_TURN_ID_LENGTH);
  if (decoded.trim().length === 0) throw new TypeError('client_turn_id must not be blank.');
  return decoded;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN_V21.test(value)) {
    throw new TypeError(`${label} is not a SHA-256 digest.`);
  }
  return value;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  ) {
    throw new TypeError(`${label} has an invalid shape.`);
  }
  return value as Record<string, unknown>;
}

function decodeEnvelope(value: unknown): CaseEnvelopeV21 {
  const envelope = cloneCanonical(value as CaseEnvelopeV21);
  assertValidCaseEnvelopeV21(envelope);
  assertV21DisputePersistenceId(envelope.control.case_id);
  return envelope;
}

function decodeStoredFormation(row: StoredFormationRow): StoredFormationDisputeV21 {
  const envelope = decodeEnvelope(row.envelope);
  const version = safeInteger(row.internal_envelope_version, 'internal_envelope_version', 1);
  const envelopeHash = hash(row.internal_envelope_hash, 'internal_envelope_hash');
  if (
    version !== envelope.control.envelope_version ||
    envelopeHash !== envelope.control.envelope_hash
  ) {
    throw new TypeError('Stored generated envelope identity disagrees with canonical state.');
  }
  return {
    envelope,
    internal_envelope_version: version,
    internal_envelope_hash: envelopeHash,
    created_at_ms: safeInteger(row.created_at_ms, 'created_at_ms'),
    updated_at_ms: safeInteger(row.updated_at_ms, 'updated_at_ms'),
  };
}

function partyId(value: unknown): PartyIdV21 {
  if (value !== 'party_a' && value !== 'party_b') {
    throw new TypeError('Stored party id is invalid.');
  }
  return value;
}

function replayResponse(value: unknown): FormationReplayResponseV21 {
  const record = exactObject(
    value,
    [
      'command_id',
      'dispute_id',
      'party_id',
      'persistence_contract_version',
      'resulting_envelope_hash',
      'resulting_envelope_version',
    ],
    'Formation replay response',
  );
  if (record.persistence_contract_version !== FORMATION_PERSISTENCE_CONTRACT_VERSION_V21) {
    throw new TypeError('Formation replay response contract version is invalid.');
  }
  const disputeId = string(record.dispute_id, 'replay dispute id');
  assertV21DisputePersistenceId(disputeId);
  return {
    persistence_contract_version: FORMATION_PERSISTENCE_CONTRACT_VERSION_V21,
    dispute_id: disputeId,
    party_id: partyId(record.party_id),
    command_id: canonicalId(record.command_id, 'replay command id'),
    resulting_envelope_version: safeInteger(
      record.resulting_envelope_version,
      'replay resulting envelope version',
      1,
    ),
    resulting_envelope_hash: hash(record.resulting_envelope_hash, 'replay resulting envelope hash'),
  };
}

function decodeReplayRecord(value: unknown): FormationReplayRecordV21 {
  const record = exactObject(
    value,
    [
      'client_turn_id',
      'dispute_id',
      'party_id',
      'recorded_at_ms',
      'request_fingerprint',
      'response',
    ],
    'Formation replay record',
  );
  const disputeId = string(record.dispute_id, 'replay dispute id');
  assertV21DisputePersistenceId(disputeId);
  const decodedParty = partyId(record.party_id);
  const response = replayResponse(record.response);
  if (response.dispute_id !== disputeId || response.party_id !== decodedParty) {
    throw new TypeError('Formation replay response identity disagrees with its record.');
  }
  return {
    dispute_id: disputeId,
    party_id: decodedParty,
    client_turn_id: decodeClientTurnId(record.client_turn_id),
    request_fingerprint: hash(record.request_fingerprint, 'replay request fingerprint'),
    response,
    recorded_at_ms: safeInteger(record.recorded_at_ms, 'replay recorded_at_ms'),
  };
}

function encodeJson(value: unknown): string {
  return canonicalSerialize(value);
}

function selectedFormationColumns(alias = ''): string {
  const prefix = alias.length > 0 ? `${alias}.` : '';
  return `${prefix}envelope,
          ${prefix}internal_envelope_version,
          ${prefix}internal_envelope_hash,
          (extract(epoch from ${prefix}created_at) * 1000)::bigint as created_at_ms,
          (extract(epoch from ${prefix}updated_at) * 1000)::bigint as updated_at_ms`;
}

function partyForSubject(envelope: CaseEnvelopeV21, subjectId: string): PartyIdV21 | null {
  const matches = (['party_a', 'party_b'] as const).filter(
    (candidate) =>
      envelope.parties[candidate].identity_assurance === 'authenticated' &&
      envelope.parties[candidate].authenticated_subject_id === subjectId,
  );
  return matches.length === 1 ? matches[0]! : null;
}

function validateAuditInput(input: CommitExternalRelayCommandInputV21): void {
  decodeClientTurnId(input.client_turn_id);
  hash(input.request_fingerprint, 'request_fingerprint');
  safeInteger(input.audit.recorded_at_ms, 'recorded_at_ms');
  if (input.audit.submission && !input.audit.source) {
    throw new TypeError('A formation submission audit requires its source audit.');
  }
  if (input.audit.compiler_run && !input.audit.submission) {
    throw new TypeError('A compiler-run audit requires its submission audit.');
  }
  if (input.audit.source) {
    canonicalId(input.audit.source.source_id, 'source_id');
  }
  if (input.audit.submission) {
    canonicalId(input.audit.submission.submission_id, 'submission_id');
  }
  if (input.audit.compiler_run) {
    canonicalId(input.audit.compiler_run.compiler_run_id, 'compiler_run_id');
    hash(input.audit.compiler_run.compiler_version_id, 'compiler_version_id');
    hash(input.audit.compiler_run.input_hash, 'compiler input hash');
    hash(input.audit.compiler_run.output_hash, 'compiler output hash');
  }
}

function commandSourceTurnId(command: EnvelopeCommandV21): string | null {
  switch (command.operation.type) {
    case 'record_own_position':
    case 'replace_own_position':
      return command.operation.source_turn.turn_id;
    case 'respond_to_challenge':
      return command.operation.source_turn?.turn_id ?? null;
    default:
      return null;
  }
}

export class PostgresFormationRepositoryV21 {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #issuedContexts = new WeakSet<object>();

  constructor(options: PostgresFormationRepositoryOptionsV21) {
    if (options.pool) {
      this.#pool = options.pool;
      this.#ownsPool = false;
      return;
    }
    const { pool: _pool, ...config } = options;
    this.#pool = new Pool(config);
    this.#ownsPool = true;
  }

  async assertReady(): Promise<void> {
    const result = await this.#pool.query<{ missing: string[] }>(
      `select array_remove(array[
                case when to_regnamespace($1) is null then $1 end,
                case when to_regclass($1 || '.formation_disputes') is null
                  then 'formation_disputes' end,
                case when to_regclass($1 || '.formation_sources') is null
                  then 'formation_sources' end,
                case when to_regclass($1 || '.formation_commands') is null
                  then 'formation_commands' end,
                case when to_regclass($1 || '.formation_submissions') is null
                  then 'formation_submissions' end,
                case when to_regclass($1 || '.formation_compiler_runs') is null
                  then 'formation_compiler_runs' end,
                case when to_regclass($1 || '.formation_replays') is null
                  then 'formation_replays' end
              ], null) as missing`,
      [SCHEMA],
    );
    const missing = result.rows[0]?.missing ?? [SCHEMA];
    if (missing.length > 0) {
      throw new Error(`V2.1 formation persistence migration is incomplete: ${missing.join(', ')}.`);
    }
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  async findById(disputeId: string): Promise<StoredFormationDisputeV21 | null> {
    assertV21DisputePersistenceId(disputeId);
    const result = await this.#pool.query(
      `select ${selectedFormationColumns()}
         from ${SCHEMA}.formation_disputes
        where dispute_id = $1`,
      [disputeId],
    );
    return result.rows[0] ? decodeStoredFormation(result.rows[0] as StoredFormationRow) : null;
  }

  async createDispute(envelopeInput: CaseEnvelopeV21): Promise<CreateFormationDisputeResultV21> {
    const envelope = decodeEnvelope(envelopeInput);
    return this.#transaction(async (client) => {
      const inserted = await client.query(
        `insert into ${SCHEMA}.formation_disputes (envelope)
         values ($1::jsonb)
         on conflict (dispute_id) do nothing
         returning ${selectedFormationColumns()}`,
        [encodeJson(envelope)],
      );
      if (inserted.rows[0]) {
        return {
          created: true,
          stored: decodeStoredFormation(inserted.rows[0] as StoredFormationRow),
        };
      }
      const existing = await client.query(
        `select ${selectedFormationColumns()}
           from ${SCHEMA}.formation_disputes
          where dispute_id = $1`,
        [envelope.control.case_id],
      );
      const row = existing.rows[0] as StoredFormationRow | undefined;
      if (!row) throw new Error('Formation dispute conflict could not be read back.');
      const stored = decodeStoredFormation(row);
      if (canonicalSerialize(stored.envelope) !== canonicalSerialize(envelope)) {
        throw new TypeError('A different canonical envelope already uses this dispute id.');
      }
      return { created: false, stored };
    });
  }

  /** Returns every eligible context in deterministic id order; never one "latest" row. */
  async listActiveContextsForPrincipal(
    authenticatedSubjectId: string,
  ): Promise<ActiveFormationContextV21[]> {
    const subjectId = canonicalId(authenticatedSubjectId, 'authenticated subject id');
    const result = await this.#pool.query(
      `select ${selectedFormationColumns('dispute')},
              case
                when dispute.party_a_principal_id = $1 then 'party_a'
                when dispute.party_b_principal_id = $1 then 'party_b'
              end as party_id
         from ${SCHEMA}.formation_disputes as dispute
        where dispute.party_a_principal_id = $1 or dispute.party_b_principal_id = $1
        order by dispute.dispute_id`,
      [subjectId],
    );
    return result.rows.map((raw) => {
      const row = raw as ContextRow;
      const stored = decodeStoredFormation(row);
      const resolvedParty = partyId(row.party_id);
      if (partyForSubject(stored.envelope, subjectId) !== resolvedParty) {
        throw new TypeError('Generated principal lookup disagrees with canonical party binding.');
      }
      const cursor = stored.envelope.control.party_views[resolvedParty];
      return {
        dispute_id: stored.envelope.control.case_id,
        party_id: resolvedParty,
        internal_envelope_version: stored.internal_envelope_version,
        internal_envelope_hash: stored.internal_envelope_hash,
        party_visible_version: cursor.party_visible_version,
        party_projection_hash: cursor.party_projection_hash,
      };
    });
  }

  async resolvePartyContext(
    disputeId: string,
    authenticatedSubjectId: string,
  ): Promise<FormationPartyPersistenceContextV21 | null> {
    assertV21DisputePersistenceId(disputeId);
    const subjectId = canonicalId(authenticatedSubjectId, 'authenticated subject id');
    const result = await this.#pool.query(
      `select ${selectedFormationColumns('dispute')},
              case
                when dispute.party_a_principal_id = $2 then 'party_a'
                when dispute.party_b_principal_id = $2 then 'party_b'
              end as party_id
         from ${SCHEMA}.formation_disputes as dispute
        where dispute.dispute_id = $1
          and (dispute.party_a_principal_id = $2 or dispute.party_b_principal_id = $2)`,
      [disputeId, subjectId],
    );
    const row = result.rows[0] as ContextRow | undefined;
    if (!row) return null;
    const stored = decodeStoredFormation(row);
    const resolvedParty = partyId(row.party_id);
    if (partyForSubject(stored.envelope, subjectId) !== resolvedParty) {
      throw new TypeError('Generated principal lookup disagrees with canonical party binding.');
    }
    const cursor = stored.envelope.control.party_views[resolvedParty];
    const context: FormationPartyPersistenceContextV21 = Object.freeze({
      dispute_id: disputeId,
      party_id: resolvedParty,
      authenticated_subject_id: subjectId,
      internal_envelope_version: stored.internal_envelope_version,
      internal_envelope_hash: stored.internal_envelope_hash,
      party_visible_version: cursor.party_visible_version,
      party_projection_hash: cursor.party_projection_hash,
    });
    this.#issuedContexts.add(context);
    return context;
  }

  async readReplay(
    context: FormationPartyPersistenceContextV21,
    clientTurnId: string,
  ): Promise<FormationReplayResponseV21 | null> {
    if (!this.#issuedContexts.has(context)) return null;
    const turnId = decodeClientTurnId(clientTurnId);
    const result = await this.#pool.query(
      `select replay.record
         from ${SCHEMA}.formation_replays as replay
         join ${SCHEMA}.formation_disputes as dispute using (dispute_id)
        where replay.dispute_id = $1
          and replay.party_id = $2
          and replay.client_turn_id = $3
          and (
            ($2 = 'party_a' and dispute.party_a_principal_id = $4)
            or ($2 = 'party_b' and dispute.party_b_principal_id = $4)
          )`,
      [context.dispute_id, context.party_id, turnId, context.authenticated_subject_id],
    );
    const row = result.rows[0] as ReplayRow | undefined;
    return row ? decodeReplayRecord(row.record).response : null;
  }

  async commitExternalRelayCommand(
    input: CommitExternalRelayCommandInputV21,
  ): Promise<CommitExternalRelayCommandResultV21> {
    if (!this.#issuedContexts.has(input.context)) {
      return { status: 'unauthorized', replayed: false };
    }
    assertV21DisputePersistenceId(input.context.dispute_id);
    validateAuditInput(input);
    canonicalSerialize(input.command);
    const expectedSourceTurnId = commandSourceTurnId(input.command);
    if ((input.audit.source !== undefined) !== (expectedSourceTurnId !== null)) {
      throw new TypeError('Source audit presence must match the command source turn.');
    }

    return this.#transaction(async (client) => {
      const selected = await client.query(
        `select ${selectedFormationColumns()}
           from ${SCHEMA}.formation_disputes
          where dispute_id = $1
          for update`,
        [input.context.dispute_id],
      );
      const row = selected.rows[0] as StoredFormationRow | undefined;
      if (!row) return { status: 'conflict', replayed: false, current: null };
      const current = decodeStoredFormation(row);
      const resolvedParty = partyForSubject(
        current.envelope,
        input.context.authenticated_subject_id,
      );
      if (resolvedParty !== input.context.party_id) {
        return { status: 'unauthorized', replayed: false };
      }

      const replay = await client.query(
        `select record
           from ${SCHEMA}.formation_replays
          where dispute_id = $1 and party_id = $2 and client_turn_id = $3`,
        [input.context.dispute_id, resolvedParty, input.client_turn_id],
      );
      const replayRow = replay.rows[0] as ReplayRow | undefined;
      if (replayRow) {
        return {
          status: 'replayed',
          replayed: true,
          stored: current,
          response: decodeReplayRecord(replayRow.record).response,
        };
      }

      if (
        current.internal_envelope_version !== input.context.internal_envelope_version ||
        current.internal_envelope_hash !== input.context.internal_envelope_hash ||
        input.command.base_envelope_version !== input.context.internal_envelope_version ||
        input.command.base_envelope_hash !== input.context.internal_envelope_hash
      ) {
        return { status: 'conflict', replayed: false, current };
      }

      const applied = applyEnvelopeCommandV21({
        envelope: current.envelope,
        command: input.command,
        execution_authority: partyAuthorityV21(current.envelope, resolvedParty, 'external_relay'),
      });
      if (applied.status === 'rejected') {
        return {
          status: 'domain_rejected',
          replayed: false,
          reason_code: applied.reason_code!,
          message: applied.message,
        };
      }

      const sourceTurn = input.audit.source
        ? applied.envelope.source_turns[expectedSourceTurnId!]
        : undefined;
      if (input.audit.source && (!sourceTurn || sourceTurn.attributed_party_id !== resolvedParty)) {
        throw new TypeError('Source audit does not name a resulting own-party source turn.');
      }

      const updated = await client.query(
        `update ${SCHEMA}.formation_disputes
            set envelope = $1::jsonb, updated_at = clock_timestamp()
          where dispute_id = $2
            and internal_envelope_version = $3
            and internal_envelope_hash = $4
          returning ${selectedFormationColumns()}`,
        [
          encodeJson(applied.envelope),
          input.context.dispute_id,
          input.context.internal_envelope_version,
          input.context.internal_envelope_hash,
        ],
      );
      const updatedRow = updated.rows[0] as StoredFormationRow | undefined;
      if (!updatedRow) {
        return { status: 'conflict', replayed: false, current };
      }

      const recordedAtMs = input.audit.recorded_at_ms;
      let sourceRecord: FormationSourceAuditRecordV21 | null = null;
      if (input.audit.source && sourceTurn) {
        sourceRecord = {
          dispute_id: input.context.dispute_id,
          party_id: resolvedParty,
          source_id: input.audit.source.source_id,
          source_turn_id: expectedSourceTurnId!,
          source_hash: sourceTurn.content_hash,
          recorded_at_ms: recordedAtMs,
        };
        await client.query(`insert into ${SCHEMA}.formation_sources (record) values ($1::jsonb)`, [
          encodeJson(sourceRecord),
        ]);
      }

      const commandRecord: FormationCommandAuditRecordV21 = {
        dispute_id: input.context.dispute_id,
        party_id: resolvedParty,
        command_id: input.command.command_id,
        base_envelope_version: input.command.base_envelope_version,
        base_envelope_hash: input.command.base_envelope_hash,
        resulting_envelope_version: applied.envelope.control.envelope_version,
        resulting_envelope_hash: applied.envelope.control.envelope_hash,
        command: cloneCanonical(input.command),
        recorded_at_ms: recordedAtMs,
      };
      await client.query(`insert into ${SCHEMA}.formation_commands (record) values ($1::jsonb)`, [
        encodeJson(commandRecord),
      ]);

      let submissionRecord: FormationSubmissionAuditRecordV21 | null = null;
      if (input.audit.submission && sourceRecord) {
        submissionRecord = {
          dispute_id: input.context.dispute_id,
          party_id: resolvedParty,
          submission_id: input.audit.submission.submission_id,
          client_turn_id: input.client_turn_id,
          source_id: sourceRecord.source_id,
          command_id: commandRecord.command_id,
          recorded_at_ms: recordedAtMs,
        };
        await client.query(
          `insert into ${SCHEMA}.formation_submissions (record) values ($1::jsonb)`,
          [encodeJson(submissionRecord)],
        );
      }

      if (input.audit.compiler_run && submissionRecord) {
        const compilerRecord: FormationCompilerRunAuditRecordV21 = {
          dispute_id: input.context.dispute_id,
          party_id: resolvedParty,
          compiler_run_id: input.audit.compiler_run.compiler_run_id,
          submission_id: submissionRecord.submission_id,
          compiler_version_id: input.audit.compiler_run.compiler_version_id,
          input_hash: input.audit.compiler_run.input_hash,
          output_hash: input.audit.compiler_run.output_hash,
          recorded_at_ms: recordedAtMs,
        };
        await client.query(
          `insert into ${SCHEMA}.formation_compiler_runs (record) values ($1::jsonb)`,
          [encodeJson(compilerRecord)],
        );
      }

      const response: FormationReplayResponseV21 = {
        persistence_contract_version: FORMATION_PERSISTENCE_CONTRACT_VERSION_V21,
        dispute_id: input.context.dispute_id,
        party_id: resolvedParty,
        command_id: input.command.command_id,
        resulting_envelope_version: applied.envelope.control.envelope_version,
        resulting_envelope_hash: applied.envelope.control.envelope_hash,
      };
      const replayRecord: FormationReplayRecordV21 = {
        dispute_id: input.context.dispute_id,
        party_id: resolvedParty,
        client_turn_id: input.client_turn_id,
        request_fingerprint: input.request_fingerprint,
        response,
        recorded_at_ms: recordedAtMs,
      };
      await client.query(`insert into ${SCHEMA}.formation_replays (record) values ($1::jsonb)`, [
        encodeJson(replayRecord),
      ]);

      return {
        status: 'committed',
        replayed: false,
        stored: decodeStoredFormation(updatedRow),
        response,
      };
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
      if (postgresCode(error) === '23505') {
        throw new TypeError('V2.1 formation audit identity already exists in this scope.');
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
