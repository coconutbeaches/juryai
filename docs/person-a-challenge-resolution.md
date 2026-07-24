# Person A challenge resolution

This boundary resolves a complete challenged Person A confirmation submission through an
explicitly injected offline decision batch. It validates and applies authorized decisions; it
does not decide whether a challenge is correct.

## Resolution authority

The caller supplies one proposal for every challenge in the exact PR #8 challenged confirmation
result. The runtime does not call a model, ask Person A a question, inspect evidence, infer a
replacement, or consult a network service.

Each request binds to:

- the exact confirmation package ID;
- the exact challenged confirmation submission ID;
- the exact parent amended-record hash;
- a canonical hash of the complete challenge set;
- the caller's current runtime record version;
- each challenge ID, object ID, target path, and expected prior value.

Missing, stale, duplicate, foreign, or malformed bindings reject the complete batch.

## Accepted and rejected outcomes

`accepted` means the challenge is accepted and the proposal supplies one exact replacement for the
existing directly challenged field. It also supplies exact target-compatible grounding. The
replacement must change the value and the complete projected Person A record must pass schema and
custom-invariant validation.

`rejected` means the challenge is rejected under one explicit reason code. It carries no
replacement or mutation fields, creates no correction amendment, and leaves the challenged value
unchanged. Rejection resolves the challenge only for this batch; it is not confirmation.

Partial resolution is unsupported.

## Field-replacement-only boundary

An accepted correction may replace one existing direct field on the exact challenged canonical
object. Scalar values and already-supported canonical field objects are permitted when the revised
record validates.

This milestone rejects:

- object or array creation and deletion;
- insertion or deletion of array elements;
- collection replacement;
- object splitting, merging, or moving;
- identity or reference-field changes;
- accepted duplication challenges;
- missing-information corrections that require a new object;
- any nested mutation that is not replacement of the directly challenged field.

Unsupported accepted corrections fail the complete batch with typed diagnostics. They are never
silently skipped or partially applied.

## Append-only provenance and versioning

Every accepted correction creates a deterministic `paca_corr_…` amendment containing:

- challenge and resolution identities;
- exact object and path;
- prior and replacement values;
- normalized grounding;
- deterministic sequence;
- parent and resulting record hashes;
- prior and resulting runtime record versions;
- an injected validated timestamp, or `null`.

Prior extraction, repair, clarification, confirmation, challenge, and record artifacts are never
rewritten. One or more accepted corrections increment the runtime record version once for the
atomic batch. An all-rejected batch preserves both content hash and version.

The version transition lives in the runtime resolution sidecar because the Person A extraction
schema does not embed a record-version field. No canonical case-record schema change is required.

## Atomicity and determinism

The runtime snapshots bounded plain JSON into detached objects before validation. Accessors,
symbols, unusual prototypes, aliases, cycles, sparse arrays, excessive depth, and oversized input
fail closed.

All resolutions are validated before projection. One invalid or unsupported resolution returns no
revised record and no amendments. Challenge and proposal order do not affect validation,
resolution IDs, amendment IDs, amendment order, hashes, or serialized output.

The output is pure and deterministic. Wall-clock time is never read. A timestamp appears only when
the caller injects a valid RFC 3339 UTC value, and it does not affect the revised record hash.

## Mandatory reconfirmation

A passed resolution result contains a `PersonAConfirmationRevision` handoff. PR #8 uses that
handoff to:

- validate the parent and revised record identities;
- include correction amendments in the new review package;
- generate a new confirmation-package identity from the revised record;
- require a fresh explicit `confirmed` or `challenged` submission.

The old package cannot confirm the revised result. Even an all-rejected batch requires a fresh
confirmation package. Resolution never sets `record_locked_at`, marks a record confirmed, invites
Person B, persists data, or advances a case state.

## Offline command

```sh
npm run resolve:person-a-challenges -- \
  --confirmation-result artifacts/person-a/confirmation/challenged-result.json \
  --amended-record artifacts/person-a/runtime-answer/amended-person-a.json \
  --request src/fixtures/dry_run_001.person_a.challenge_resolutions.json \
  --record-version 1 \
  --output artifacts/person-a/challenge-resolution/result.json
```

`--created-at` is optional and must be an explicitly injected RFC 3339 UTC timestamp. The command
reads only the listed local files, writes one output with exclusive creation, exits nonzero for
invalid or unsupported batches, and performs no network or OpenAI request.

## Explicit exclusions

This boundary adds no model-generated proposals, live extraction, Person B intake, persistence,
Supabase, RLS, case-state transition, evidence adjudication, shared two-party correction, record
lock, deliberation, recommendation, UI, deployment, or production-readiness claim. Live extraction
acceptance remains **0/3**.
