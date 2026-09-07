# PR 8C2 design checkpoints

Baseline: `5c0291ba74024f65e484c2f707a45bbdbe3d1520` (current main verified before edits).
Inspected PRs #63–#71, the frozen V2.1.4 application/domain, shared engine,
V0.4 compiler/contract, production server, review decoding and persisted SQL pairings.

| Checkpoint                                   | Owning layer and decision                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broad listening                              | V2.1.5 application compile planner supplies all own formation requirements; explicit reply targets retain pacing/provenance. Challenge and response plans retain their authority-bearing target restrictions.                                                                                           |
| Multi-live / exact supersession / finite max | Existing shared relay and validator under explicitly declared policies. No semantic matching or deduplication.                                                                                                                                                                                          |
| Zero effect                                  | Application refuses before runtime preparation or repository commit; no source or replay key is persisted.                                                                                                                                                                                              |
| Replay / contention                          | Generation-specific application and PostgreSQL adapter retain replay-before-cursor checks, party-scoped identity, internal CAS, and rebase only with an unchanged party projection.                                                                                                                     |
| Requirement ownership                        | A content-addressed reference in the generation spec names the immutable V2.1.4 requirement artifact. Its canonical content hash is verified; initial creation and every envelope validation enforce the exact derived party definitions. There is one definition source, no independent editable copy. |
| Runtime provenance                           | Explicit future relay runtime policy: defensive deep copy/freeze plus factory-local WeakSet identity. Legacy brand policy remains available for unchanged V2.1.4 parity. Unknown policies throw.                                                                                                        |
| Compiler                                     | Dedicated V2.1.5 adapter uses qualified V0.4 artifacts, pins the full compiler identity, and reproduces V0.4 run validation at persistence. No prompt, corpus, holdout, or oracle edits; no live calls.                                                                                                 |
| Routing                                      | Explicit persisted schema dispatch adds V2.1.5; new starts retain the compatibility HMAC domain and rollout flag. Historical implementations remain selected for historical rows.                                                                                                                       |
| Review / disclosure / readiness              | New generation pairing with the shared ceremony/projection/readiness engine. Existing first-party assurance application and private persistence mechanics carried into the new generation.                                                                                                              |
| Solicited vs volunteered                     | Derivable only from the source reply targets and stored compiler context. No new canonical field or display semantics.                                                                                                                                                                                  |

Contract changes are explicit: envelope, protocol, command, projection, readback,
readiness, confirmation, disclosure acknowledgment, relay submission, persistence,
review page and protected-action pairing identify the new generation. The input
intent, party-review state shape, taxonomy, public tool protocol, HHC policy,
invitation contract, database schema and start/rollout compatibility constants do
not change. Semantic satisfaction remains coverage, not establishment of truth.

The V0.4 source comment saying it is not production is historical artifact text;
it will remain frozen. Activation reachability is asserted by new structural tests.
Historical isolation guards that assert _no future production imports at all_
must be narrowed to the historical trees, without weakening behavioral parity.

PR #68 records a provider-client quota classification defect, but current main
already rejects structured `insufficient_quota` and exhausted-credit responses as
non-transient. The PR narrative is stale; no client change is required here.
No deployment or live activation is authorized by this draft PR task.

The qualified production configuration is fixed: `gpt-5.6-sol`, snapshot `null`,
temperature `0`, top-p `null`, maximum output tokens `8192`, seed `null`, sampling
parameters omitted, raw output retention disabled, default OpenAI endpoint.
Generic historical compiler model/snapshot/base-URL environment overrides do not
alter V2.1.5. Only the existing API-key variables provide credentials. A changed
configuration requires a separately qualified compiler identity. The model alias
is moving; this PR proves the frozen artifact's wiring, not new model quality.

The requirement reference binds both the canonical definition source
(`09b001b76017d95da304fc4fd007658fb381699ce35ae9cbcf6291e21a081ff6`)
and its exact executed party mapping
(`8fb4837eab3c9c247816470619704c6a29c6da67b822c610ab7159fe6fea0b9c`).
The second check covers generated ownership, IDs, labels and required flags as
well as the source definitions and finite maximum policy. There is one definition
source; the second hash addresses its deterministic projection, not a second
editable definition set. Initialization fails if either binding changes; every
persisted envelope must match the bound mapping even after valid hash restamping.

| Contract                           | V2.1.5 identity / deliberate non-bump                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Envelope                           | `juryai-case-envelope-v2.1.5`                                                                                                             |
| Protocol                           | `juryai-formation-protocol-v2.1.5`                                                                                                        |
| Ceremony command                   | `juryai-envelope-command-v2.1.5`                                                                                                          |
| Projection                         | `juryai-party-formation-projection-v2.1.5`                                                                                                |
| Readback                           | `juryai-party-formation-readback-v2.1.5`                                                                                                  |
| Readiness                          | `juryai-formation-readiness-v2.1.5`                                                                                                       |
| Party confirmation                 | `juryai-party-confirmation-v2.1.5`                                                                                                        |
| Disclosure acknowledgment          | `juryai-disclosure-review-acknowledgment-v2.1.5`                                                                                          |
| External relay submission          | `juryai-external-relay-submission-v2.1.5`                                                                                                 |
| Persistence                        | `juryai-v2.1.5-formation-persistence-v1`                                                                                                  |
| First-party review page            | `juryai-v2.1.5-first-party-review-page-v1.0.0`                                                                                            |
| Protected action                   | `juryai-party-review-protected-action-v1.4.0`, paired only with the V2.1.5 command                                                        |
| Party review state                 | Unchanged `juryai-party-review-state-v1.2.0`; same fields/hashing, explicit new referenced formation contracts                            |
| Relay intent                       | Unchanged `juryai-external-relay-submission-intent-v2.1.1`; no new user authority or operation shape                                      |
| Requirements                       | Unchanged `juryai-p2-initial-requirements-v0.4.0`; exact existing content now bound by the two hashes above                               |
| Taxonomy / compiler input template | Unchanged V0.3 contracts; the qualified V0.4 artifact intentionally consumes them                                                         |
| Public tools                       | Unchanged supported public contracts and exactly `start_case`, `get_case_state`, `submit_turn`                                            |
| HHC, policy, invitations           | Existing intent-assurance V1 / invitation V2.1 contracts and `juryai-v2.1.2-production-party-review-hhc3` profile; no assurance downgrade |
| Rollout / start identity           | Unchanged `JURYAI_V212_PRODUCTION_ENABLED` and `juryai-v2.1.2-production-start`                                                           |
| Database schema                    | Unchanged `juryai_v21`; additive explicit constraint branches only, no row rewrite or grant change                                        |

The generation-specific application and private persistence adapters carry the
historical transaction and assurance mechanics into a separate tree; the domain
validator, relay, ceremony, projection and readiness implementations are shared.
This keeps historical imports and behavior frozen without reusing their compiler
validation or introducing generation-string-derived contract names.

The default historical PostgreSQL review reference (`PR6-` plus a full UUID)
violates the assurance contract's two bounded uppercase groups. Earlier PG
fixtures injected valid references, masking this production-path defect.
V2.1.5 uses a valid random uppercase 12-character suffix and exercises default
identity providers end to end. V2.1.1–V2.1.4 remain untouched; their default
reference defect needs a separately authorized historical compatibility fix.

Verification, including the migration-lock review repair:

- Full non-PostgreSQL suite: 100 files / 3,374 tests passed, including historical
  formation parity, lifecycle and V0.4 structural/contract suites unchanged.
- New V2.1.5 application/routing/guard coverage: 45 tests; PostgreSQL: 14 tests.
  The database suite exercises real transactions, a forced SQL CAS miss, hidden
  opponent rebase after compilation, audit/source/replay persistence refusal,
  identity-bound invitations, exact constraint readiness and first-party HHC.
- Ten historical PostgreSQL suites: 141 tests passed against separate fresh local
  databases with the same per-suite migration scope as CI. The V2.1.5 migration
  test also reapplies its DDL over historical data and proves that historical
  row content, `ctid` and `xmin` do not change. Local PostgreSQL is 14; CI is 16.
- Nine deliberate source mutations were rejected: zero-effect bypass, narrowed
  compile context, fingerprint bypass, legacy runtime selection, persisted
  definition-check bypass, V0.3 run validation, single-live policy, executed-hash
  bypass, and altered generated required flags. Eight produced assertion
  failures; the last failed closed during initialization on the exact binding.
  Each edited source was restored byte for byte before the final green suite.
- Typecheck, repository-wide Prettier check, CI test-file coverage, golden/schema
  validation, frozen Gate Zero corpus/baseline/policy checks, Person A acceptance,
  offline compiler replay and explicit-absence compiler replay all passed.
- Browser production build passed. Its 108,193-byte JS bundle includes the
  V2.1.5 review decoder and excludes the checked server/compiler/secret markers;
  SHA-256 `e46a99c9881bf50df57ff8eacc3ae7d1645306103873de5196b534fa8a94f867`.
  Dependency audit reports zero vulnerabilities.
- Frozen source-tree inventories and hashes pass. No live model call, deployed
  database migration, production canary or deployment was performed. Qualification
  remains historical evidence; draft publication does not establish live quality.

The Codex review of `935c3c63623906a849507f35cd2eb19d217dd4fc` identified
that replacement `CHECK` constraints scanned populated tables under retained
exclusive locks. The regression reproduced `AccessExclusiveLock` on that head.
The migration now stages temporary `NOT VALID` constraints while leaving the old
constraints enforced, validates in a separate migration/transaction, then performs
a short atomic drop/rename after checking that all three replacements validated.
Each phase uses a five-second lock-acquisition timeout. Run the three migration
files separately and in timestamp order before enabling the new application;
do not combine them into an outer transaction. The lock regression holds each
phase before commit and proves validation uses `ShareUpdateExclusiveLock`, with
concurrent SELECT and UPDATE lock acquisition allowed. Premature activation fails
without replacing any historical constraint; historical row identity is preserved.
This follows PostgreSQL's documented [ADD / VALIDATE CONSTRAINT lock behavior](https://www.postgresql.org/docs/current/sql-altertable.html).
The Supabase CLI's [per-file transaction batching](https://github.com/supabase/cli/blob/v2.75.0/pkg/migration/file.go)
was also inspected, which is why staging and validation use different files.
