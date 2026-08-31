/**
 * Persistence boundary for the P2 runtime.
 *
 * Phase 1 ships only in-memory implementations, but the interfaces are shaped
 * for a Postgres/Supabase adapter, so the concurrency assumptions are written
 * down here rather than discovered later:
 *
 *  - A stored case carries a `revision` that is SEPARATE from `case_version`.
 *    `case_version` is a canonical, semantic number that only moves when the
 *    canonical projection changes; `revision` is a storage counter that moves
 *    on every write. Using `case_version` for concurrency control would let a
 *    turn that recorded nothing canonical (a `no_assertions` compile) be lost
 *    by a concurrent writer whose CAS still matched.
 *
 *  - Creating a case writes canonical state AND its start-request record; and
 *    committing a turn writes canonical case state AND the idempotency record.
 *    Those two writes must land together or not at all: a committed turn
 *    without its idempotency record turns the next retry into a duplicate
 *    write. `commitTurn` exists so that requirement is a method signature
 *    rather than a comment. A SQL adapter implements it in one transaction.
 *
 *  - Compile runs are append-only audit data in their own store. They are
 *    deliberately NOT reachable only through mutable case state: reconstructing
 *    "what the compiler saw" from current state is not the same claim as
 *    "what the compiler was given", and the difference is the whole reason the
 *    run record keeps a detached input snapshot.
 */

import type { CompileRunRecord, CompilerRegistryEntry } from '../core/compiler-contract.js';
import type { IdempotencyRecord } from '../core/idempotency.js';
import type { CaseState } from '../core/attestation.js';

export interface StoredCase {
  /** Storage revision, bumped on every write. Never exposed to the relay. */
  revision: number;
  state: CaseState;
}

export interface CaseRepository {
  findById(caseId: string): Promise<StoredCase | null>;
  /**
   * The principal's single open draft, if one exists. "Active draft" means a
   * case whose CURRENT version carries no attestation; lock status is derived
   * from the attestation collection and never stored as a column of its own.
   */
  findActiveDraftByPrincipal(principalId: string): Promise<StoredCase | null>;
}

/**
 * Durable identity of a `start_case` operation, so a retry of the same logical
 * create replays its original result instead of colliding with the draft it
 * itself produced. `client_request_id` is adapter-issued transport metadata and
 * deliberately lives here rather than in canonical `CaseState`.
 */
export interface StartCaseIdempotencyRecord {
  principal_id: string;
  client_request_id: string;
  case_id: string;
  recorded_at_ms: number;
}

export interface StartCaseIdempotencyRepository {
  findByRequest(
    principalId: string,
    clientRequestId: string,
  ): Promise<StartCaseIdempotencyRecord | null>;
}

/**
 * One start-request identity decision, read from one storage snapshot.
 * `stored` is allowed to be null so a faulty/custom adapter cannot smuggle an
 * orphaned request record through the type boundary unnoticed.
 */
export interface StartCaseReplaySnapshot {
  request: StartCaseIdempotencyRecord;
  stored: StoredCase | null;
}

/** Case state and every replay record used by one submit decision. */
export interface SubmitSnapshot {
  stored: StoredCase | null;
  idempotency: IdempotencyRecord[];
}

export interface StartCaseCommit {
  state: CaseState;
  idempotency: StartCaseIdempotencyRecord;
}

export type CaseCreateResult =
  | { ok: true; stored: StoredCase }
  /**
   * This exact (principal, client_request_id) already created a case. The
   * caller replays that case as its own `created` result.
   */
  | { ok: false; reason: 'start_request_replayed'; stored: StoredCase | null }
  /**
   * A DIFFERENT request already opened this principal's draft. Storage owns
   * this rule rather than a runtime read-then-write, because two concurrent
   * `start_case` calls both read "no draft" before either writes. A SQL
   * adapter enforces it with a unique partial index.
   */
  | { ok: false; reason: 'active_draft_exists'; stored: StoredCase | null };

export interface CompileRunRepository {
  /** Append-only. Rejects a second write under the same compile_run_id. */
  append(record: CompileRunRecord): Promise<void>;
  findById(compileRunId: string): Promise<CompileRunRecord | null>;
  listByCase(caseId: string): Promise<CompileRunRecord[]>;
}

export interface IdempotencyRepository {
  listByCase(caseId: string): Promise<IdempotencyRecord[]>;
}

export interface CompilerRegistryRepository {
  register(entry: CompilerRegistryEntry): Promise<void>;
  findById(compilerVersionId: string): Promise<CompilerRegistryEntry | null>;
}

export interface TurnCommit {
  case_id: string;
  /** Storage revision the mutation was prepared against. */
  expected_revision: number;
  next_state: CaseState;
  idempotency: IdempotencyRecord;
}

export type TurnCommitResult =
  | { ok: true; stored: StoredCase }
  | { ok: false; reason: 'revision_conflict'; current: StoredCase | null };

/**
 * The composed store the runtime depends on. Sub-repositories stay separately
 * addressable so a future adapter can back them with different tables, while
 * `commitTurn` keeps the one cross-store atomicity requirement explicit.
 */
export interface CaseRuntimeStore {
  readonly cases: CaseRepository;
  readonly compileRuns: CompileRunRepository;
  readonly idempotency: IdempotencyRepository;
  readonly startRequests: StartCaseIdempotencyRepository;
  readonly compilerRegistry: CompilerRegistryRepository;
  /**
   * Reads the start-request record and the case it names from one snapshot.
   * Optional only for compatibility with fault-injection/custom Phase-1
   * stores; production adapters and the in-memory reference implementation
   * implement it. The runtime retains its guarded legacy path as
   * defense-in-depth for older or deliberately faulty adapters.
   */
  readStartSnapshot?(
    principalId: string,
    clientRequestId: string,
  ): Promise<StartCaseReplaySnapshot | null>;
  /**
   * Reads case state and replay data from one snapshot. A PostgreSQL adapter
   * implements this as one SQL statement, so one MVCC snapshot—not runtime
   * timing—guarantees that operation identity is decided coherently.
   */
  readSubmitSnapshot?(caseId: string): Promise<SubmitSnapshot>;
  /**
   * Atomic: writes the new case AND its start-request record together. Split
   * into two writes, a crash between them recreates exactly the lost-response
   * ambiguity the record exists to remove — the case exists, nothing records
   * which request made it, and the retry looks like a second create.
   */
  createCase(commit: StartCaseCommit): Promise<CaseCreateResult>;
  commitTurn(commit: TurnCommit): Promise<TurnCommitResult>;
}
