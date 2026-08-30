/**
 * PostgreSQL-backed P2 persistence.
 *
 * Canonical records are stored as JSONB. Scalar columns in the migration are
 * generated from those records, so indexes and constraints cannot become a
 * second mutable semantic model. All multi-statement writes use one checked-
 * out client; all identity-decision reads are one SQL statement and therefore
 * one PostgreSQL MVCC snapshot.
 */

import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { validateCaseState } from '../core/structural-validator.js';
import type { CaseState } from '../core/attestation.js';
import {
  compilerInputHash,
  registerCompilerVersion,
  validateCompilerOutput,
  type CompileRunRecord,
  type CompilerRegistryEntry,
} from '../core/compiler-contract.js';
import type { IdempotencyRecord } from '../core/idempotency.js';
import { canonicalSerialize } from '../core/types.js';
import { validateSourceTurnRecord } from '../core/turns.js';
import { InMemoryCaseRuntimeStore } from './in-memory-repositories.js';
import {
  type CaseCreateResult,
  type CaseRepository,
  type CaseRuntimeStore,
  type CompileRunRepository,
  type CompilerRegistryRepository,
  type IdempotencyRepository,
  type StartCaseCommit,
  type StartCaseIdempotencyRecord,
  type StartCaseIdempotencyRepository,
  type StartCaseReplaySnapshot,
  type StoredCase,
  type SubmitSnapshot,
  type TurnCommit,
  type TurnCommitResult,
} from './repositories.js';

const SCHEMA = 'juryai_p2';
const JS_MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

interface StoredCaseRow {
  revision: string | number;
  state: unknown;
}

interface JsonRecordRow {
  record: unknown;
}

interface JsonEntryRow {
  entry: unknown;
}

interface SubmitSnapshotRow extends StoredCaseRow {
  idempotency: unknown;
}

interface StartSnapshotRow extends StoredCaseRow {
  request: unknown;
}

export interface PostgresStoreOptions extends PoolConfig {
  /** Existing pools are useful for application lifecycle ownership and tests. */
  pool?: Pool;
}

export class PostgresCaseRuntimeStore implements CaseRuntimeStore {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;

  constructor(options: PostgresStoreOptions) {
    if (options.pool) {
      this.#pool = options.pool;
      this.#ownsPool = false;
      return;
    }
    const { pool: _pool, ...config } = options;
    this.#pool = new Pool(config);
    this.#ownsPool = true;
  }

  /** Fails clearly at startup when the migration/configuration is absent. */
  async assertReady(): Promise<void> {
    const result = await this.#pool.query<{ missing: string[] }>(
      `select array_remove(array[
                case when to_regnamespace($1) is null then $1 end,
                case when to_regclass($1 || '.cases') is null then 'cases' end,
                case when to_regclass($1 || '.start_case_idempotency') is null
                  then 'start_case_idempotency' end,
                case when to_regclass($1 || '.submit_idempotency') is null
                  then 'submit_idempotency' end,
                case when to_regclass($1 || '.compile_runs') is null then 'compile_runs' end,
                case when to_regclass($1 || '.compiler_registry') is null
                  then 'compiler_registry' end
              ], null) as missing`,
      [SCHEMA],
    );
    const missing = result.rows[0]?.missing ?? [SCHEMA];
    if (missing.length > 0) {
      throw new Error(
        `JuryAI PostgreSQL persistence is selected but its migration is incomplete; missing: ${missing.join(', ')}.`,
      );
    }
  }

  /** Closes only a pool this adapter created itself. */
  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  readonly cases: CaseRepository = {
    findById: async (caseId) => {
      const result = await this.#pool.query(
        `select revision, state from ${SCHEMA}.cases where case_id = $1`,
        [caseId],
      );
      return result.rows[0] ? decodeStoredCase(result.rows[0] as StoredCaseRow) : null;
    },
    findActiveDraftByPrincipal: async (principalId) => {
      const result = await this.#pool.query(
        `select revision, state
           from ${SCHEMA}.cases as c
          where c.principal_id = $1
            and not exists (
              select 1
                from jsonb_array_elements(c.state -> 'attestations') as attestation
               where attestation -> 'case_version' = c.state -> 'case_version'
            )
          order by c.case_id
          limit 1`,
        [principalId],
      );
      return result.rows[0] ? decodeStoredCase(result.rows[0] as StoredCaseRow) : null;
    },
  };

  readonly startRequests: StartCaseIdempotencyRepository = {
    findByRequest: async (principalId, clientRequestId) => {
      const result = await this.#pool.query(
        `select record
           from ${SCHEMA}.start_case_idempotency
          where principal_id = $1 and client_request_id = $2`,
        [principalId, clientRequestId],
      );
      return result.rows[0] ? decodeStartRequest((result.rows[0] as JsonRecordRow).record) : null;
    },
  };

  readonly idempotency: IdempotencyRepository = {
    listByCase: async (caseId) => {
      const result = await this.#pool.query(
        `select record
           from ${SCHEMA}.submit_idempotency
          where case_id = $1
          order by storage_sequence`,
        [caseId],
      );
      return result.rows.map((row) => decodeIdempotency((row as JsonRecordRow).record));
    },
  };

  readonly compileRuns: CompileRunRepository = {
    append: async (record) => {
      const detached = decodeCompileRun(structuredClone(record));
      try {
        await this.#pool.query(`insert into ${SCHEMA}.compile_runs (record) values ($1::jsonb)`, [
          encodeJson(detached),
        ]);
      } catch (error) {
        if (postgresCode(error) === '23505') {
          throw new TypeError(
            `Compile runs are append-only; '${record.compile_run_id}' already exists.`,
          );
        }
        throw error;
      }
    },
    findById: async (compileRunId) => {
      const result = await this.#pool.query(
        `select record from ${SCHEMA}.compile_runs where compile_run_id = $1`,
        [compileRunId],
      );
      return result.rows[0] ? decodeCompileRun((result.rows[0] as JsonRecordRow).record) : null;
    },
    listByCase: async (caseId) => {
      const result = await this.#pool.query(
        `select record
           from ${SCHEMA}.compile_runs
          where case_id = $1
          order by storage_sequence`,
        [caseId],
      );
      return result.rows.map((row) => decodeCompileRun((row as JsonRecordRow).record));
    },
  };

  readonly compilerRegistry: CompilerRegistryRepository = {
    register: async (entry) => {
      const detached = decodeCompilerRegistryEntry(structuredClone(entry));
      await this.#transaction(async (client) => {
        const inserted = await client.query(
          `insert into ${SCHEMA}.compiler_registry (entry)
           values ($1::jsonb)
           on conflict (compiler_version_id) do nothing
           returning entry`,
          [encodeJson(detached)],
        );
        if (inserted.rowCount === 1) return;

        const existing = await client.query(
          `select entry
             from ${SCHEMA}.compiler_registry
            where compiler_version_id = $1`,
          [detached.compiler_version_id],
        );
        const row = existing.rows[0] as JsonEntryRow | undefined;
        if (!row) throw new Error('Compiler registry conflict could not be read back.');
        const stored = decodeCompilerRegistryEntry(row.entry);
        if (canonicalSerialize(stored) !== canonicalSerialize(detached)) {
          throw new TypeError(
            'A different artefact is already registered under this compiler_version_id.',
          );
        }
      });
    },
    findById: async (compilerVersionId) => {
      const result = await this.#pool.query(
        `select entry
           from ${SCHEMA}.compiler_registry
          where compiler_version_id = $1`,
        [compilerVersionId],
      );
      return result.rows[0]
        ? decodeCompilerRegistryEntry((result.rows[0] as JsonEntryRow).entry)
        : null;
    },
  };

  async readStartSnapshot(
    principalId: string,
    clientRequestId: string,
  ): Promise<StartCaseReplaySnapshot | null> {
    // One statement means the request identity and its case share one MVCC
    // snapshot. LEFT JOIN preserves a detectable orphan if a faulty database
    // has disabled the foreign key.
    const result = await this.#pool.query(
      `select request.record as request, cases.revision, cases.state
         from ${SCHEMA}.start_case_idempotency as request
         left join ${SCHEMA}.cases as cases on cases.case_id = request.case_id
        where request.principal_id = $1 and request.client_request_id = $2`,
      [principalId, clientRequestId],
    );
    const row = result.rows[0] as StartSnapshotRow | undefined;
    if (!row) return null;
    return {
      request: decodeStartRequest(row.request),
      stored: row.state === null ? null : decodeStoredCase(row),
    };
  }

  async readSubmitSnapshot(caseId: string): Promise<SubmitSnapshot> {
    // This is intentionally one SQL statement. PostgreSQL assigns one MVCC
    // snapshot to it, so a submit decision cannot combine pre-commit case
    // state with post-commit replay data, or vice versa.
    const result = await this.#pool.query(
      `select cases.revision,
              cases.state,
              coalesce(
                jsonb_agg(replay.record order by replay.storage_sequence)
                  filter (where replay.turn_id is not null),
                '[]'::jsonb
              ) as idempotency
         from ${SCHEMA}.cases as cases
         left join ${SCHEMA}.submit_idempotency as replay on replay.case_id = cases.case_id
        where cases.case_id = $1
        group by cases.case_id, cases.revision, cases.state`,
      [caseId],
    );
    const row = result.rows[0] as SubmitSnapshotRow | undefined;
    if (!row) return { stored: null, idempotency: [] };
    if (!Array.isArray(row.idempotency)) {
      throw new TypeError('Stored submit snapshot idempotency is not an array.');
    }
    return {
      stored: decodeStoredCase(row),
      idempotency: row.idempotency.map(decodeIdempotency),
    };
  }

  async createCase(commit: StartCaseCommit): Promise<CaseCreateResult> {
    const state = decodeCaseState(structuredClone(commit.state));
    const request = decodeStartRequest(structuredClone(commit.idempotency));
    if (state.case_id !== request.case_id || state.principal_id !== request.principal_id) {
      throw new TypeError('Start-case state and idempotency identities do not match.');
    }

    return this.#transaction(async (client) => {
      // Serialize starts for one principal. Hash collisions only serialize
      // unrelated principals; they cannot weaken correctness.
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        state.principal_id,
      ]);

      const replay = await client.query(
        `select request.record as request, cases.revision, cases.state
           from ${SCHEMA}.start_case_idempotency as request
           left join ${SCHEMA}.cases as cases on cases.case_id = request.case_id
          where request.principal_id = $1 and request.client_request_id = $2`,
        [request.principal_id, request.client_request_id],
      );
      const replayRow = replay.rows[0] as StartSnapshotRow | undefined;
      if (replayRow) {
        return {
          ok: false,
          reason: 'start_request_replayed',
          stored: replayRow.state === null ? null : decodeStoredCase(replayRow),
        };
      }

      // Draft status is derived directly from canonical JSON. There is no
      // mutable status column that can drift from the current attestation.
      const active = await client.query(
        `select c.revision, c.state
           from ${SCHEMA}.cases as c
          where c.principal_id = $1
            and not exists (
              select 1
                from jsonb_array_elements(c.state -> 'attestations') as attestation
               where attestation -> 'case_version' = c.state -> 'case_version'
            )
          order by c.case_id
          limit 1`,
        [state.principal_id],
      );
      const activeRow = active.rows[0] as StoredCaseRow | undefined;
      if (activeRow) {
        return {
          ok: false,
          reason: 'active_draft_exists',
          stored: decodeStoredCase(activeRow),
        };
      }

      const inserted = await client.query(
        `insert into ${SCHEMA}.cases (state) values ($1::jsonb) returning revision, state`,
        [encodeJson(state)],
      );
      await client.query(
        `insert into ${SCHEMA}.start_case_idempotency (record) values ($1::jsonb)`,
        [encodeJson(request)],
      );
      return { ok: true, stored: decodeStoredCase(inserted.rows[0] as StoredCaseRow) };
    });
  }

  async commitTurn(commit: TurnCommit): Promise<TurnCommitResult> {
    if (!Number.isSafeInteger(commit.expected_revision) || commit.expected_revision < 1) {
      throw new TypeError('expected_revision must be a positive safe integer.');
    }
    const state = decodeCaseState(structuredClone(commit.next_state));
    const idempotency = decodeIdempotency(structuredClone(commit.idempotency));
    if (
      commit.case_id !== state.case_id ||
      commit.case_id !== idempotency.case_id ||
      idempotency.turn_id !== idempotency.response.turn_id
    ) {
      throw new TypeError('Turn state and idempotency identities do not match.');
    }

    return this.#transaction(async (client) => {
      const updated = await client.query(
        `update ${SCHEMA}.cases
            set state = $1::jsonb, revision = revision + 1
          where case_id = $2 and revision = $3
          returning revision, state`,
        [encodeJson(state), commit.case_id, commit.expected_revision],
      );
      const updatedRow = updated.rows[0] as StoredCaseRow | undefined;
      if (!updatedRow) {
        const current = await client.query(
          `select revision, state from ${SCHEMA}.cases where case_id = $1`,
          [commit.case_id],
        );
        const currentRow = current.rows[0] as StoredCaseRow | undefined;
        return {
          ok: false,
          reason: 'revision_conflict',
          current: currentRow ? decodeStoredCase(currentRow) : null,
        };
      }

      // If this insert fails, the surrounding transaction rolls the case
      // update back. A canonical turn can never exist without replay data.
      await client.query(`insert into ${SCHEMA}.submit_idempotency (record) values ($1::jsonb)`, [
        encodeJson(idempotency),
      ]);
      return { ok: true, stored: decodeStoredCase(updatedRow) };
    });
  }

  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    let began = false;
    let releaseError: Error | undefined;
    try {
      await client.query('begin');
      began = true;
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      if (began) {
        try {
          await client.query('rollback');
        } catch (rollbackError) {
          // Preserve the original database error. The pool discards a broken
          // connection; a rollback failure must not replace the causal error.
          releaseError =
            rollbackError instanceof Error
              ? rollbackError
              : new Error('PostgreSQL rollback failed with a non-Error value.');
        }
      }
      throw error;
    } finally {
      // A failed rollback leaves transaction/session state uncertain. Passing
      // the error makes pg destroy this client instead of pooling it again.
      client.release(releaseError);
    }
  }
}

export type RuntimePersistenceEnvironment = Record<string, string | undefined>;

/**
 * Explicit adapter selection for application startup. Absence is an error;
 * production never silently degrades to process-local memory.
 */
export function caseRuntimeStoreFromEnvironment(
  environment: RuntimePersistenceEnvironment,
): CaseRuntimeStore {
  const adapter = environment.JURYAI_PERSISTENCE_ADAPTER;
  if (adapter === 'memory') return new InMemoryCaseRuntimeStore();
  if (adapter === 'postgres') {
    const connectionString = environment.JURYAI_DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'JURYAI_PERSISTENCE_ADAPTER=postgres requires JURYAI_DATABASE_URL; no fallback was used.',
      );
    }
    return new PostgresCaseRuntimeStore({ connectionString });
  }
  throw new Error(
    "JURYAI_PERSISTENCE_ADAPTER must explicitly be 'postgres' or 'memory'; no fallback was used.",
  );
}

function decodeStoredCase(row: StoredCaseRow): StoredCase {
  const revision =
    typeof row.revision === 'number'
      ? row.revision
      : typeof row.revision === 'string'
        ? Number(row.revision)
        : Number.NaN;
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new TypeError('Stored case revision is not a positive safe integer.');
  }
  return { revision, state: decodeCaseState(row.state) };
}

function decodeCaseState(value: unknown): CaseState {
  const detached = structuredClone(value) as CaseState;
  let report;
  try {
    report = validateCaseState(detached);
  } catch (error) {
    throw malformed('case state', error);
  }
  if (!report.ok) {
    throw new TypeError(
      `Stored case state is malformed at ${report.issues[0]?.path ?? 'unknown path'}.`,
    );
  }
  return detached;
}

function decodeStartRequest(value: unknown): StartCaseIdempotencyRecord {
  const record = exactObject(value, 'start-case idempotency', [
    'principal_id',
    'client_request_id',
    'case_id',
    'recorded_at_ms',
  ]);
  return {
    principal_id: requiredString(record.principal_id, 'principal_id'),
    client_request_id: requiredString(record.client_request_id, 'client_request_id'),
    case_id: requiredString(record.case_id, 'case_id'),
    recorded_at_ms: safeNonnegativeInteger(record.recorded_at_ms, 'recorded_at_ms'),
  };
}

function decodeIdempotency(value: unknown): IdempotencyRecord {
  const record = exactObject(value, 'submit idempotency', [
    'case_id',
    'request_fingerprint',
    'client_turn_id',
    'turn_id',
    'recorded_at_ms',
    'response',
  ]);
  const response = exactObject(record.response, 'submit idempotency response', [
    'case_version',
    'turn_id',
    'accepted_proposition_ids',
    'superseded_proposition_ids',
    'opened_clarification_ids',
    'warnings',
  ]);
  const decoded: IdempotencyRecord = {
    case_id: requiredString(record.case_id, 'case_id'),
    request_fingerprint: requiredString(record.request_fingerprint, 'request_fingerprint'),
    client_turn_id: nullableString(record.client_turn_id, 'client_turn_id'),
    turn_id: requiredString(record.turn_id, 'turn_id'),
    recorded_at_ms: safeNonnegativeInteger(record.recorded_at_ms, 'recorded_at_ms'),
    response: {
      case_version: safeNonnegativeInteger(response.case_version, 'response.case_version'),
      turn_id: requiredString(response.turn_id, 'response.turn_id'),
      accepted_proposition_ids: stringArray(
        response.accepted_proposition_ids,
        'response.accepted_proposition_ids',
      ),
      superseded_proposition_ids: stringArray(
        response.superseded_proposition_ids,
        'response.superseded_proposition_ids',
      ),
      opened_clarification_ids: stringArray(
        response.opened_clarification_ids,
        'response.opened_clarification_ids',
      ),
      warnings: stringArray(response.warnings, 'response.warnings', true),
    },
  };
  if (decoded.turn_id !== decoded.response.turn_id) {
    throw new TypeError('Stored submit idempotency response names a different turn.');
  }
  return decoded;
}

function decodeCompilerRegistryEntry(value: unknown): CompilerRegistryEntry {
  const detached = structuredClone(value) as CompilerRegistryEntry;
  try {
    // Core is the sole authority for compiler artefact identity. This validates
    // without replacing or normalising the stored historical object.
    registerCompilerVersion([], detached);
    validTimestamp(detached.registered_at, 'registered_at');
  } catch (error) {
    throw malformed('compiler registry entry', error);
  }
  return detached;
}

function decodeCompileRun(value: unknown): CompileRunRecord {
  const record = exactObject(value, 'compile run', [
    'compile_run_id',
    'case_id',
    'turn_id',
    'compiler_version_id',
    'input',
    'input_hash',
    'input_template_version',
    'output',
    'contract_issues',
    'started_at',
    'finished_at',
  ]) as unknown as CompileRunRecord;
  const detached = structuredClone(record);
  try {
    if (
      requiredString(detached.compile_run_id, 'compile_run_id') !== detached.input.compile_run_id ||
      requiredString(detached.case_id, 'case_id') !== detached.input.case_id ||
      requiredString(detached.turn_id, 'turn_id') !== detached.input.turn.turn_id ||
      requiredString(detached.compiler_version_id, 'compiler_version_id') !==
        detached.input.compiler_version_id ||
      detached.input_template_version !== detached.input.input_template_version ||
      detached.output.compile_run_id !== detached.compile_run_id ||
      detached.output.compiler_version_id !== detached.compiler_version_id
    ) {
      throw new TypeError('Compile-run identities disagree.');
    }
    validTimestamp(detached.started_at, 'started_at');
    validTimestamp(detached.finished_at, 'finished_at');
    const turnIssues = validateSourceTurnRecord(detached.input.turn, 'input.turn');
    if (turnIssues.length > 0) {
      throw new TypeError(
        `Compile-run input turn is malformed at ${turnIssues[0]?.path ?? 'unknown path'}.`,
      );
    }
    if (compilerInputHash(detached.input) !== detached.input_hash) {
      throw new TypeError('Compile-run input_hash does not match its stored input.');
    }
    const issues = validateCompilerOutput(detached.input, detached.output);
    if (canonicalSerialize(issues) !== canonicalSerialize(detached.contract_issues)) {
      throw new TypeError('Compile-run contract issues do not match its stored input/output.');
    }
  } catch (error) {
    throw malformed('compile run', error);
  }
  return detached;
}

function exactObject(
  value: unknown,
  label: string,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Stored ${label} is not an object.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (canonicalSerialize(actual) !== canonicalSerialize(expected)) {
    throw new TypeError(`Stored ${label} has an unexpected shape.`);
  }
  return record;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Stored ${path} is not a non-empty string.`);
  }
  return value;
}

function validTimestamp(value: unknown, path: string): string {
  const timestamp = requiredString(value, path);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError(`Stored ${path} is not a valid timestamp.`);
  }
  return timestamp;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return requiredString(value, path);
}

function safeNonnegativeInteger(value: unknown, path: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > JS_MAX_SAFE_INTEGER
  ) {
    throw new TypeError(`Stored ${path} is not a non-negative safe integer.`);
  }
  return value;
}

function stringArray(value: unknown, path: string, allowEmptyStrings = false): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || (!allowEmptyStrings && item.length === 0))
  ) {
    throw new TypeError(`Stored ${path} is not a string array.`);
  }
  return [...value];
}

function encodeJson(value: unknown): string {
  return JSON.stringify(value);
}

function malformed(label: string, cause: unknown): TypeError {
  return new TypeError(
    `Stored ${label} is malformed: ${cause instanceof Error ? cause.message : 'invalid value'}`,
  );
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
