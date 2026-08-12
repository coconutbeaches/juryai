# GZ4 — Deterministic runner and honest current-capability baseline

Status: frozen for exact-head GZ4 review. This milestone measures the current implementation at GZ3 merge `b360dafa3dabd2551b581d8300b5ef637b0c39f7`. It does not implement a v2 journey runtime.

## Baseline identity

- Baseline version: `juryai-gate-zero-capability-baseline-v1.0.0`
- Corpus: `juryai-gate-zero-corpus-v1.0.0`
- Corpus fingerprint: `a91f2184fce5b269afe7d36174c864e2c0789cf29bfe9c2eeec82da510574061`
- Baseline fingerprint: `3407697c9df66bb471152c56ff9758a7f2e75776c58ffb578df0b9570f12d452`
- Cases / turns: 36 / 390
- Provider calls: zero

The canonical baseline is `src/fixtures/gate-zero/current-capability-baseline.json`. The runner regenerates it from the frozen corpus, replays every executable GZ0 boundary, and rejects byte or fingerprint drift.

## Classification rule

Every turn receives exactly one of `PASS`, `FAIL`, `NOT_EXECUTABLE`, or `NOT_APPLICABLE`.

1. `FAIL` if an executable current contract boundary disagrees with the oracle.
2. Otherwise `NOT_EXECUTABLE` while any product capability needed for the complete turn is absent.
3. `PASS` only when the complete product turn executes and matches every applicable oracle boundary.
4. `NOT_APPLICABLE` only when the classified capability genuinely does not apply.

Authored canonical commands are benchmark inputs. Replaying them through a pure function proves the command boundary; it does not prove that JuryAI can authenticate the real actor, capture immutable source records, propose the command, commit it durably, select the next question, or deliver the safe response.

## Current result

| Status         | Turns |
| -------------- | ----: |
| PASS           |     0 |
| FAIL           |     0 |
| NOT_EXECUTABLE |   390 |
| NOT_APPLICABLE |     0 |

All 36 cases are therefore `NOT_EXECUTABLE` end to end.

This is deliberately not presented as a percentage of v2 completeness.

Executable contract evidence remains green and separate:

- oracle validation: 390 `PASS`;
- authenticated command/CAS replay: 390 `PASS`;
- applicable Person B disclosure projections: 75 `PASS`;
- applicable adjudication-input projections: 7 `PASS`.

## Missing end-to-end capability categories

- authenticated actor context adapter: 390 turns;
- immutable source-record capture adapter: 390;
- journey command orchestrator: 390;
- durable Case Envelope store with CAS/idempotency: 390;
- safe user-visible response adapter: 390;
- Person B disclosure delivery: 75;
- confirmation/lock orchestrator: 60;
- evidence service integration: 57;
- next-question planner: 22;
- adjudication handoff adapter: 7.

Counts overlap because a turn can require multiple absent capabilities.

## Component interpretation

The closed Case Envelope, pure authenticated command boundary, Person B disclosure projection, and adjudication-input projection are executable and reusable. The v0.1.2 schema and Person A one-shot/runtime pipeline cannot execute the v2 turn contract. The frozen DR001/DR002 evaluator is `NOT_APPLICABLE` to the v2 release decision because no migration-gate evidence was found; it is not counted as a v2 failure.

The benchmark does not run legacy extraction against an incompatible input and call the mismatch a failure. It also does not infer that green pure-function replay means an end-to-end runtime exists.

## Commands

- `npm run freeze:gate-zero-baseline` explicitly rewrites the canonical baseline.
- `npm run validate:gate-zero-baseline` regenerates and compares it byte for byte.
- `npm run baseline:gate-zero -- --json` emits the complete canonical result without provider calls.

GZ5 must freeze acceptance gates and the implementation-readiness decision before any runtime work starts.
