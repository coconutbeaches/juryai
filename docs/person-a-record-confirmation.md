# Person A record confirmation

This boundary turns a passed Person A runtime plan and successful clarification-answer application
into a stable review package, then records either explicit confirmation or precise challenges. It
is pure, deterministic, offline, and append-only. It does not edit the amended record.

Confirmation is separate from amendment because they answer different questions. Clarification
answers add a validated amendment and project it into a new record. Confirmation says whether
Person A accepts that complete projection as presented. A challenge records an objection for a
future correction or resolution boundary; it never performs that correction.

## Review package and identity binding

`buildPersonAConfirmationPackage()` includes:

- SHA-256 identities for the immutable original extraction, repaired record, successful
  clarification-answer application, and final amended record;
- the canonical record/schema version;
- reviewable party, actor, agreement, deliverable, event/date, claim, evidence, damages,
  requested-outcome, and canonical extraction-issue sections;
- append-only clarification amendments and unresolved material uncertainty sidecars;
- an explicit provenance legend distinguishing supplied facts, extracted structured content,
  amendments, unresolved uncertainty, and schema-labelled inference.

Raw submissions, model metadata, repair internals, stage audits, hidden reasoning, fixtures, and
evaluation data are not placed in the review package. Source quotes appear only through the
canonical review objects' existing source spans or evidence extracts.

The package ID hashes the complete canonicalized package body. Identical JSON inputs produce a
byte-identical package. Any material review content or identity change produces a different package
ID.

## Submission contract

Every submission uses version `person-a-record-confirmation-submission-v0.1.0` and binds to both the
exact package ID and amended-record hash.

Confirmed:

```json
{
  "version": "person-a-record-confirmation-submission-v0.1.0",
  "outcome": "confirmed",
  "confirmation_package_id": "<sha256>",
  "amended_record_hash": "<sha256>",
  "explicit_confirmation": true
}
```

Challenged:

```json
{
  "version": "person-a-record-confirmation-submission-v0.1.0",
  "outcome": "challenged",
  "confirmation_package_id": "<sha256>",
  "amended_record_hash": "<sha256>",
  "challenges": [
    {
      "challenge_id": "pach_<24 lowercase hex characters>",
      "target_object_id": "<canonical object ID>",
      "target_path": "/evidence/0/availability_status",
      "category": "incorrect_evidence_association_or_status",
      "explanation": "This evidence is available to me.",
      "expected_prior_value": "unavailable"
    }
  ]
}
```

Challenge IDs are derived from the canonical challenge content with
`derivePersonAChallengeId()`. Paths use JSON Pointer against the amended record and must be within
the object named by `target_object_id`. `expected_prior_value` must exactly equal the current value,
which makes field-level stale submissions fail closed.

Supported categories are `incorrect_value`, `missing_material_information`,
`wrong_actor_attribution`, `wrong_date_event_association`, `unsupported_assertion`,
`omitted_uncertainty`, `incorrect_evidence_association_or_status`,
`incorrect_requested_remedy`, `duplication`, and `contradiction_with_supplied_source`.

`contradiction_with_supplied_source` requires an exact existing source-span or extracted-object
grounding reference compatible with the challenged target. Optional grounding on another category
is validated by the same rule. Challenges cannot target submission text, runtime or audit
metadata, clarification internals, fixtures, alignment, or evaluation data.

## Atomic and privacy-safe failure

Confirmed and challenged forms are mutually exclusive. Unknown fields, malformed hashes, stale
bindings, unknown object IDs, invalid paths, stale values, unsupported categories, malformed
grounding, duplicate challenge IDs, and duplicate target/category pairs reject the complete
submission. One invalid challenge means zero accepted challenges. Diagnostics are machine-readable,
bounded to 20 entries, and each message is bounded to 240 characters.

Only challenge IDs that match the exact `pach_` plus 24-lowercase-hex contract may appear in
diagnostics. Malformed, oversized, or Unicode IDs are rejected without echoing attacker-controlled
identifier text.

Inputs are inspected into detached plain-JSON snapshots. Accessors, symbols, custom prototypes,
cycles, sparse or extended arrays, excessive nesting, and oversized batches fail closed. The
original extraction, repaired record, answer-application result, and amended record remain
unchanged.

## Offline command

```sh
npm run confirm:person-a-record -- \
  --runtime-plan artifacts/person-a/runtime-plan/runtime-plan.json \
  --answer-application artifacts/person-a/runtime-answer/runtime-answer-result.json \
  --amended-record artifacts/person-a/runtime-answer/amended-person-a.json \
  --submission src/fixtures/dry_run_001.person_a.confirmation.json \
  --output artifacts/person-a/confirmation/confirmation-result.json
```

The command reads only the four explicit local input paths, writes one deterministic JSON result,
uses exclusive creation so it cannot unexpectedly overwrite an existing output, and exits non-zero
for malformed or invalid input. It performs no network request and no OpenAI API call.

Dry Run 001 includes both explicit-confirmation and structured-challenge submissions. Their hashes
bind to the existing saved extraction, deterministic runtime assessments, and successful
clarification-answer fixture.

## Explicit exclusions

This milestone adds no Person B intake, persistence, database or case-state transition,
deliberation, recommendation generation, user interface, deployment, or live model call. Live
extraction acceptance remains **0/3**.
