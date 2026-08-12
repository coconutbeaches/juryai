# GZ3 — Complete hash-frozen Gate Zero corpus

Status: frozen for exact-head GZ3 review. This milestone completes corpus authoring and integrity validation. It does not baseline the current JuryAI runtime, set acceptance thresholds, or implement v2 runtime behavior.

## Frozen identity

- Corpus version: `juryai-gate-zero-corpus-v1.0.0`
- Cases: 36
- Ordered turns: 390
- Case fixture version: `juryai-gate-zero-case-fixture-v1.0.0`
- Turn oracle version: `juryai-gate-zero-turn-oracle-v2.1.0`
- Coverage matrix version: `juryai-gate-zero-coverage-matrix-v1.0.0`
- Corpus fingerprint: `a91f2184fce5b269afe7d36174c864e2c0789cf29bfe9c2eeec82da510574061`

The canonical manifest is `src/fixtures/gate-zero/manifest.json`. Each case is a canonical JSON file under `src/fixtures/gate-zero/cases/` and has its own SHA-256 identity in the manifest. The validator regenerates every byte from the authored TypeScript fixtures, replays the contract validators, and fails on any file, ordering, version, count, plan, hash, or fingerprint drift. It requires no network or provider call.

## Coverage completion

The complete corpus preserves the GZ1 order and exact turn counts. Cases 001–010 remain the adversarially reviewed initial set. Cases 011–036 add:

- non-party actor identity and conditional obligation/event timing;
- deposit/balance separation, deliverable disagreement, claimed losses, and ranked requested outcomes;
- linked delayed corrections, Unicode source spans, and highest-value single-question behavior;
- catch-all additions and accepted/rejected/lacks-information challenge paths;
- prohibited and advisory-only non-participation, including incomplete procedure failures;
- complete, unreadable, superseded, disputed-authorship, and private evidence paths;
- control-only confirmation preservation and material evidence invalidation;
- post-lock payment/scope changes, prior-lock retention, reconfirmation, relock, and fresh projection;
- projection exclusion, narrative/evidence prompt injection, malformed commands, stale CAS, and fail-closed projection boundaries.

## Contract corrections revealed during scale-out

1. Non-participation procedure commands now reject empty event identities or an invalid deadline before state mutation.
2. Withdrawn or superseded evidence remains retained and explicitly ineligible, but is deterministically removed from the active decision-relevant set so an obsolete version cannot permanently block a valid replacement from lock.
3. The per-turn oracle may represent a malformed command exactly when `invalid_command` is the expected result, and a wrong case identity exactly when `case_mismatch` is expected. Ordinary malformed/mismatched fixtures remain invalid.

## Revision policy

Any case or oracle byte change requires an explicit corpus-version decision, regenerated per-case SHA-256 identities, a new corpus fingerprint, adversarial review, and exact-head approval. A test failure may not be converted into expected behavior merely to preserve a fingerprint.

## Protected boundaries

No legacy evaluator, DR001/DR002 golden, DR002 acceptance threshold, provider integration, production database/schema, UI, deployment, juror reasoning, or v2 conversational runtime is changed. GZ4 capability classification has not started.
