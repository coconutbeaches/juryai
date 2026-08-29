/**
 * Deterministic in-memory implementations of the runtime persistence
 * boundary. These exist to prove the state-transition pipeline end to end
 * without a database; they are not a cache in front of one.
 *
 * Every read returns a structural clone and every write stores a structural
 * clone, so a caller that mutates what it was handed cannot reach back into
 * stored state. A SQL adapter gets that property from serialisation; an
 * in-memory one has to do it on purpose or the tests quietly stop testing
 * immutability.
 */

import { deriveCaseStatus, type CaseState } from '../core/attestation.js';
import {
  registerCompilerVersion,
  type CompileRunRecord,
  type CompilerRegistry,
  type CompilerRegistryEntry,
} from '../core/compiler-contract.js';
import { recordIdempotency, type IdempotencyRecord } from '../core/idempotency.js';
import {
  ActiveDraftExistsError,
  type CaseRepository,
  type CaseRuntimeStore,
  type CompileRunRepository,
  type CompilerRegistryRepository,
  type IdempotencyRepository,
  type StoredCase,
  type TurnCommit,
  type TurnCommitResult,
} from './repositories.js';

interface CaseSlot {
  revision: number;
  state: CaseState;
}

export class InMemoryCaseRuntimeStore implements CaseRuntimeStore {
  readonly #cases = new Map<string, CaseSlot>();
  #idempotency: IdempotencyRecord[] = [];
  readonly #compileRuns = new Map<string, CompileRunRecord>();
  #registry: CompilerRegistry = [];

  readonly cases: CaseRepository = {
    findById: async (caseId) => this.#read(caseId),
    findActiveDraftByPrincipal: async (principalId) => {
      for (const [caseId, slot] of this.#cases) {
        if (slot.state.principal_id !== principalId) continue;
        if (deriveCaseStatus(slot.state) !== 'draft') continue;
        return this.#read(caseId);
      }
      return null;
    },
    create: async (state) => {
      if (this.#cases.has(state.case_id)) {
        throw new TypeError("Case '" + state.case_id + "' already exists.");
      }
      for (const slot of this.#cases.values()) {
        if (
          slot.state.principal_id === state.principal_id &&
          deriveCaseStatus(slot.state) === 'draft'
        ) {
          throw new ActiveDraftExistsError(state.principal_id);
        }
      }
      this.#cases.set(state.case_id, { revision: 1, state: structuredClone(state) });
      return this.#read(state.case_id) as StoredCase;
    },
  };

  readonly compileRuns: CompileRunRepository = {
    append: async (record) => {
      if (this.#compileRuns.has(record.compile_run_id)) {
        throw new TypeError(
          "Compile runs are append-only; '" + record.compile_run_id + "' already exists.",
        );
      }
      this.#compileRuns.set(record.compile_run_id, structuredClone(record));
    },
    findById: async (compileRunId) => {
      const found = this.#compileRuns.get(compileRunId);
      return found ? structuredClone(found) : null;
    },
    listByCase: async (caseId) =>
      [...this.#compileRuns.values()]
        .filter((record) => record.case_id === caseId)
        .map((record) => structuredClone(record)),
  };

  readonly idempotency: IdempotencyRepository = {
    listByCase: async (caseId) =>
      this.#idempotency
        .filter((record) => record.case_id === caseId)
        .map((record) => structuredClone(record)),
  };

  readonly compilerRegistry: CompilerRegistryRepository = {
    register: async (entry: CompilerRegistryEntry) => {
      // Core enforces artefact/hash agreement and rejects a conflicting rebind.
      this.#registry = registerCompilerVersion(this.#registry, structuredClone(entry));
    },
    findById: async (compilerVersionId) => {
      const found = this.#registry.find((entry) => entry.compiler_version_id === compilerVersionId);
      return found ? structuredClone(found) : null;
    },
  };

  /**
   * Canonical state and the idempotency record land together. The revision
   * check is the compare-and-swap: a mutation prepared against a revision that
   * has since moved is refused rather than overwriting the winner.
   */
  async commitTurn(commit: TurnCommit): Promise<TurnCommitResult> {
    const slot = this.#cases.get(commit.case_id);
    if (!slot || slot.revision !== commit.expected_revision) {
      return { ok: false, reason: 'revision_conflict', current: this.#read(commit.case_id) };
    }
    // Throws on a duplicate client_turn_id or turn_id, by core contract.
    const nextIdempotency = recordIdempotency(
      this.#idempotency,
      structuredClone(commit.idempotency),
    );
    this.#cases.set(commit.case_id, {
      revision: slot.revision + 1,
      state: structuredClone(commit.next_state),
    });
    this.#idempotency = nextIdempotency;
    return { ok: true, stored: this.#read(commit.case_id) as StoredCase };
  }

  #read(caseId: string): StoredCase | null {
    const slot = this.#cases.get(caseId);
    return slot ? { revision: slot.revision, state: structuredClone(slot.state) } : null;
  }
}
