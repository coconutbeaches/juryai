# P2 PostgreSQL persistence

Step 62 replaces process-local production persistence with a direct PostgreSQL
adapter while retaining `InMemoryCaseRuntimeStore` for deterministic tests.
`CaseState` remains the only semantic case model.

## Configuration

Application startup must explicitly select an adapter:

```text
JURYAI_PERSISTENCE_ADAPTER=postgres
JURYAI_DATABASE_URL=postgresql://...
```

`caseRuntimeStoreFromEnvironment` throws if selection is absent, unknown, or
`postgres` has no connection string. It never silently falls back to memory.
`JURYAI_PERSISTENCE_ADAPTER=memory` is an explicit local/test choice only.

The backend uses `pg` and a PostgreSQL connection string. A persistent server
may use a direct connection or session-mode pooler. Transaction-mode poolers
are also compatible because every transaction checks out one connection and
does not depend on session state after commit.

## Migration and schema

The forward-only migration is:

```text
supabase/migrations/20260830081816_p2_persistent_repositories.sql
```

It creates the private `juryai_p2` schema and these tables:

- `cases`
- `start_case_idempotency`
- `submit_idempotency`
- `compile_runs`
- `compiler_registry`

Canonical records are JSONB. Stable identities and indexed lookup fields are
generated columns derived from the JSONB record; they cannot drift through an
independent update. `cases.revision` and append-order identity columns are
storage metadata, not semantic state.

The migration enables RLS on every table, revokes all schema/table/function
access from `PUBLIC`, creates no `anon` or `authenticated` policy, and exposes
no public function or Data API path. The trusted backend database role is the
repository path. Append-only triggers reject updates and deletes to compiler
registry, compile runs, and both idempotency stores.

## Transaction and snapshot guarantees

`readSubmitSnapshot(caseId)` uses one `SELECT` that joins the case and ordered
submit-idempotency records. PostgreSQL assigns one MVCC snapshot to the whole
statement. A submit identity decision therefore cannot combine old case state
with new replay data or new case state with old replay data.

`readStartSnapshot(principalId, clientRequestId)` likewise joins one start
identity to its case in one statement.

`createCase` uses one transaction and a transaction-scoped advisory lock keyed
by principal. Under that lock it checks exact request replay first, derives
active-draft status directly from canonical `state.attestations` and
`state.case_version`, then inserts the case and start identity together. There
is no mutable status projection.

`commitTurn` uses one transaction. Its `UPDATE` matches `case_id` plus the
expected storage `revision`, increments revision on every state write, and then
inserts the submit-idempotency record. Any insert failure rolls the case update
back. A CAS miss returns the current case as a modeled `revision_conflict`.

## Supported query shapes and indexes

- Case lookup by `case_id` primary key.
- Active draft scan by generated `principal_id`; status is derived from
  canonical JSON inside the query.
- Exact start replay by `(principal_id, client_request_id)` primary key.
- Submit history by `case_id` in append order.
- Exact submit identity by unique `(case_id, client_turn_id)` when non-null.
- Fingerprint candidates by `(case_id, request_fingerprint, recorded_at_ms)`;
  the fingerprint is deliberately not unique.
- Compile-run lookup by primary `compile_run_id`, plus case, turn, and compiler
  indexes.
- Compiler registry lookup by primary `compiler_version_id`.

## Local integration test

Apply the migration to an isolated PostgreSQL database and run:

```bash
JURYAI_TEST_DATABASE_URL=postgresql://... npm run test:persistence
```

CI provisions PostgreSQL 16 with no paid service or external credentials,
applies the migration, and runs `src/tests/webmcp-persistence.test.ts`.
