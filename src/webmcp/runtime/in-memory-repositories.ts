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
  type CaseCreateResult,
  type CaseRepository,
  type CaseRuntimeStore,
  type CompileRunRepository,
  type CompilerRegistryRepository,
  type IdempotencyRepository,
  type StartCaseCommit,
  type StartCaseIdempotencyRecord,
  type StartCaseIdempotencyRepository,
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
  #startRequests: StartCaseIdempotencyRecord[] = [];
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
  };

  readonly startRequests: StartCaseIdempotencyRepository = {
    findByRequest: async (principalId, clientRequestId) => {
      const found = this.#findStartRequest(principalId, clientRequestId);
      return found ? structuredClone(found) : null;
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
   * The case and its start-request record land together. Both uniqueness rules
   * are decided HERE, at the write, not by the caller's earlier read: two
   * concurrent starts have both already read "no draft" by the time either
   * gets here.
   */
  async createCase(commit: StartCaseCommit): Promise<CaseCreateResult> {
    const { state, idempotency } = commit;
    // A retry of the same logical create replays its own case, even though
    // that case is now the principal's open draft.
    const prior = this.#findStartRequest(idempotency.principal_id, idempotency.client_request_id);
    if (prior) {
      return { ok: false, reason: 'start_request_replayed', stored: this.#read(prior.case_id) };
    }
    for (const slot of this.#cases.values()) {
      if (
        slot.state.principal_id === state.principal_id &&
        deriveCaseStatus(slot.state) === 'draft'
      ) {
        return {
          ok: false,
          reason: 'active_draft_exists',
          stored: this.#read(slot.state.case_id),
        };
      }
    }
    if (this.#cases.has(state.case_id)) {
      throw new TypeError("Case '" + state.case_id + "' already exists.");
    }
    this.#cases.set(state.case_id, { revision: 1, state: structuredClone(state) });
    this.#startRequests.push(structuredClone(idempotency));
    return { ok: true, stored: this.#read(state.case_id) as StoredCase };
  }

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

  #findStartRequest(
    principalId: string,
    clientRequestId: string,
  ): StartCaseIdempotencyRecord | undefined {
    return this.#startRequests.find(
      (record) =>
        record.principal_id === principalId && record.client_request_id === clientRequestId,
    );
  }

  #read(caseId: string): StoredCase | null {
    const slot = this.#cases.get(caseId);
    return slot ? { revision: slot.revision, state: structuredClone(slot.state) } : null;
  }
}
