# Person A model-run provenance harness

## Purpose

The provenance harness preserves a Person A provider response before structured-output parsing,
assembly, validation, alignment, or evaluation. It supports case-specific live execution and
raw-only offline replay without changing extraction, normalization, alignment, or evaluator
behavior.

Dry Run 001 and Dry Run 002 are registered with byte-locked narrative and golden identities.
Unknown cases, incomplete definitions, fixture hash changes, and golden/narrative mismatches fail
before a provider call.

The legacy `extract:person-a` command remains the Dry Run 001 workflow. It rejects the Dry Run 002
narrative so that case cannot accidentally use the Dry Run 001 golden projection.

## Live sequence

Live mode requires a new output directory and a clean repository worktree:

```bash
npm run provenance:person-a -- \
  --mode live \
  --case-id dry_run_002 \
  --submitted-at 2026-01-01T00:00:00Z \
  --model gpt-5.6 \
  --reasoning-effort medium \
  --output-dir artifacts/person-a/dry-run-002-live
```

The command:

1. resolves and verifies the selected case;
2. writes request metadata and an initialized manifest;
3. invokes the provider once;
4. atomically writes the exact response body before parsing it;
5. parses and assembles without using the golden;
6. validates schema and invariants;
7. explicitly aligns and evaluates against the selected case golden;
8. writes validation, extraction, alignment, evaluation, and final manifest artifacts.

There is no retry or fallback path. A raw-write failure stops before parsing. A later failure keeps
the raw response and writes a structured, secret-free failure artifact and partial manifest.

`OPENAI_API_KEY` is the only credential variable recorded, and only its name is serialized. The
exact canonical Responses endpoint is bound as a SHA-256 identity so an `OPENAI_BASE_URL` override
cannot be confused with the default route, while the URL itself is not serialized. Base URLs with
credentials, query strings, or fragments fail closed. The key value and request authorization
headers are never part of an artifact.

## Offline replay

Replay takes the frozen raw response, request metadata, and source run manifest. The manifest
cryptographically binds the other two inputs so artifacts from separate runs cannot be mixed. It
does not read provider credentials and has no provider client:

```bash
npm run provenance:person-a -- \
  --mode replay \
  --case-id dry_run_002 \
  --raw-response artifacts/person-a/dry-run-002-live/dry_run_002.person_a.raw-response.json \
  --request-metadata artifacts/person-a/dry-run-002-live/dry_run_002.person_a.request.json \
  --run-manifest artifacts/person-a/dry-run-002-live/dry_run_002.person_a.run-manifest.json \
  --output-dir artifacts/person-a/dry-run-002-replay
```

Replay verifies the case, narrative, golden, prompt, schema, extractor, evaluation contract, and
request settings, then verifies the raw-response and request-metadata paths and SHA-256 identities
against the source manifest before reconstructing the extraction. A detached exact-SHA checkout is
recorded explicitly as `(detached HEAD)`. Derived artifacts use canonical JSON so their hashes
match the live run. For a completed source run, replay verifies every derived artifact path and
hash against the source manifest before persisting the derived outputs or declaring completion.
The replay manifest records zero provider calls and zero retries.

## Artifact and manifest behavior

Each run uses a new directory and the selected case's artifact prefix. Artifacts are created
without overwriting existing files. Raw responses use an atomic new-file write; manifests use
atomic replacement inside the run-specific directory as state advances.

The `person-a-provenance-run-v1` manifest records repository state, fixture identities, extraction
contract, provider request configuration, response identifiers, artifact paths and hashes,
provider-call and retry counts, manual-edit declaration, failure stage when applicable, and the
exact case-specific replay command.

Tests use fake provider responses and temporary directories. They never call OpenAI.
