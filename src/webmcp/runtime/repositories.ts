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
 *  - Committing a turn writes canonical case state AND the idempotency record.
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

/**
 * Raised when a second active draft would be created for a principal. The
 * uniqueness rule lives in storage, not in a runtime read-then-write, because
 * two concurrent `start_case` calls both read "no draft" before either writes.
 * A SQL adapter enforces it with a unique partial index.
 */
export class ActiveDraftExistsError extends Error {
  readonly principal_id: string;

  constructor(principalId: string) {
    super('Principal already has an active draft case.');
    this.name = 'ActiveDraftExistsError';
    this.principal_id = principalId;
  }
}

export interface CaseRepository {
  findById(caseId: string): Promise<StoredCase | null>;
  /**
   * The principal's single open draft, if one exists. "Active draft" means a
   * case whose CURRENT version carries no attestation; lock status is derived
   * from the attestation collection and never stored as a column of its own.
   */
  findActiveDraftByPrincipal(principalId: string): Promise<StoredCase | null>;
  /** Throws `ActiveDraftExistsError` rather than creating a second draft. */
  create(state: CaseState): Promise<StoredCase>;
}

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
  readonly compilerRegistry: CompilerRegistryRepository;
  commitTurn(commit: TurnCommit): Promise<TurnCommitResult>;
}
