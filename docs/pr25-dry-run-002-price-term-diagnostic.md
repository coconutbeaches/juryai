# PR #25 Dry Run 002 price-term diagnostic

## Decision

**Classification D — evaluator defect. Diagnostic-only PR.**

The selected finding is:

`critical|agreement_terms|unsupported_extra_object|term_price_1|`

The frozen `term_price_1` is an exact-source-grounded USD 1,800 price component required by Person
A prompt rule 23. The tracked golden contains the same USD 1,800 price inside the broader
`term_dry_run_002`, which is already paired to `term_scope_1`. Leaving `term_price_1` unmatched is
truthful. Calling it a fabrication hard failure is not.

A wording-only counterfactual preserves the complete agreement-term alignment while changing only
the selected diagnostic from critical `unsupported_extra_object` to minor
`agreement_term_decomposition`. This isolates the error to evaluator source-grounding logic rather
than extraction, golden content, or alignment.

PR #25 does not implement the correction. Any correction would filter or re-tier an existing
critical, which this PR explicitly forbids, and the final tier still requires a deliberate choice
between minor decomposition and major grounded extra. A separately scoped corrective PR should
make that decision and prove a one-finding delta.

The machine-checkable evidence is
`src/fixtures/dry_run_002.pr25.critical-diagnostic.json`. Its test validates fixture hashes, UTF-16
source slices, record and finding fingerprints, the five-critical projection, the selected
counterfactual, replay determinism, acceptance, and protected Dry Run 001 hashes. This document is
explanatory; the structured artifact is authoritative.

## Locked identities and baseline

| Item                           | Identity                                                           |
| ------------------------------ | ------------------------------------------------------------------ |
| Required base                  | `14d21cc89d916586be8dccb2a30577d46279a146`                         |
| Frozen live-source commit      | `c081c1e10427f11125a43976f74d1ce076d4a19c`                         |
| Case / contract                | `dry_run_002` / `calibrated_live_v2`                               |
| Narrative SHA-256              | `0508bdb60323a32beafaa0b7e7e7ac734cd64a002830fc8eb1ca52e5feda0f86` |
| Current golden SHA-256         | `c56a61eb606c5efbcc8fdd5f364d70a889c9c84b7092784daf2f2b814f265567` |
| Raw response SHA-256           | `b6156e7754e28ee5ec9f3a5fa3ca89209b1f9d185b9aff76ba8c246ee5f4f171` |
| Request metadata SHA-256       | `798e6cdff6f4462cd57c2d7234f16abb1681b5aa17cd343b505eda127cbb1469` |
| Frozen extraction SHA-256      | `496ce4938cc04ae65a72efc611e839158dfe7e5ee053d27dc21de96c77a8d076` |
| Locked-base alignment SHA-256  | `ee015c6efb1fe1bb3ead8625cfddbf1057f11837d2ba5d360169b03312de09a6` |
| Locked-base evaluation SHA-256 | `dba69c1f95e2da4d885aec4f28cea77fa62401e4d7c2de193bbc06d620b660f6` |
| Acceptance SHA-256             | `a81553ce546d46c9fee379a18177400840a0aeb43e163060a033023d921677c3` |
| Evaluation                     | `5 critical / 15 major / 14 minor / 34 total`                      |
| Acceptance                     | pass                                                               |
| Historical / controls          | `0/3` / `3/3`                                                      |

The provenance harness binds the frozen response to `c081c1e…`, so canonical replay runs at that
detached commit. The byte-identical extraction is then evaluated at the locked PR #25 base. Both
clean replays produced extraction SHA-256
`496ce4938cc04ae65a72efc611e839158dfe7e5ee053d27dc21de96c77a8d076`,
validation SHA-256 `d3adea256203aaa11bba6b0b151a3b6659e2ed4031878c615b9474884dd733df`,
zero provider calls, zero retries, and `manually_edited: false`.

## Complete five-critical inventory

| Rank | Stable identity                                                       | Source                                                                 | Same-family golden / alignment                                                          | Root-cause candidate          | Confidence / coupling                                |
| ---: | --------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------- |
|    1 | `critical\|agreement_terms\|unsupported_extra_object\|term_price_1\|` | S1 `[58,200)` contains exact USD 1,800; record `ff623447…`             | No available golden match; broader `term_dry_run_002` is paired to `term_scope_1`       | Evaluator defect              | High; coupled only to the broader-term decomposition |
|    2 | `critical\|claims\|unsupported_extra_object\|claim_payment_term_1\|`  | S1 `[58,200)` states USD 900 upfront and USD 900 due after delivery    | No same-family S1 golden claim; payment structure is cross-family in `term_dry_run_002` | Legitimate unmatched / policy | High; coupled to Rule 26 and payment claims          |
|    3 | `critical\|claims\|unsupported_extra_object\|claim_scope_1\|`         | S1 `[58,200)` states restoration scope and price                       | No same-family scope claim; cross-family in `term_dry_run_002`                          | Legitimate unmatched / policy | High; coupled to `term_scope_1` and `deliverable_1`  |
|    4 | `critical\|claims\|unsupported_extra_object\|claim_no_refund_1\|`     | S5 `[514,625)` explicitly says no refund is requested                  | `cl_002_remedy` combines payment and no-refund and is paired to `claim_balance_1`       | Legitimate unmatched / policy | Medium; coupled to claim-granularity policy          |
|    5 | `critical\|deliverables\|unsupported_extra_object\|deliverable_1\|`   | S1–S4 expressly describe the chairs, state, defects, and retained work | Golden deliverables family is empty                                                     | Legitimate unmatched / policy | High grounding, broad coupling to claim alignment    |

Missing and extra findings were not collapsed into pairs. All five current criticals are independent
unmatched extracted objects. None has a same-family unmatched golden partner.

## Ranking method

Each candidate was scored from 1–5 on the ten required criteria: direct source evidence, confidence
current behavior is wrong, layer distinguishability, correction narrowness, low regression risk,
no control/DR001 effect, low policy judgment, deterministic tooling support, absence of intentional
preservation, and truthful evaluation improvement.

| Rank | Candidate              | Score / 50 | Decisive consideration                                                              |
| ---: | ---------------------- | ---------: | ----------------------------------------------------------------------------------- |
|    1 | `term_price_1`         |         43 | Exact amount, Rule 23, same-span broader golden, unchanged-alignment counterfactual |
|    2 | `claim_payment_term_1` |         33 | Strong source and Rule 26, but generic claim policy has broader blast radius        |
|    3 | `claim_scope_1`        |         32 | Strong source, but neutral-term versus dispute-claim policy is ambiguous            |
|    4 | `claim_no_refund_1`    |         28 | Explicit text, but negative-remedy claim granularity is unresolved                  |
|    5 | `deliverable_1`        |         25 | Grounded object, but evaluator outcome is coupled to multiple claim alignments      |

Prior adjudication intentionally preserved all five. That reduces implementation candidacy but
does not override the newly isolated evidence that the selected evaluator message is false.

## Selected finding trace

### 1. Source

Repository-standard UTF-16 slice S1 `[58,200)` is:

> On about March 12, 2026, I agreed with Priya Nair to restore six dining chairs for $1,800, with
> $900 paid upfront and $900 due after delivery.

The slice is exact in `src/fixtures/dry_run_002.person_a.txt`.

### 2. Frozen model response

The raw model record has:

- ID/type: `term_price_1` / `price`
- wording: `The total price was $1,800.`
- S1 source span
- fingerprint: `1d15aaccc17b7a7dab14c15700b75077f61206a676abe815fa9ca5933a80e3aa`

### 3. Normalized extraction

Assembly changes only the source-span submission ID from `submission_1` to `sub_a_extracted`.
The normalized record fingerprint is
`ff6234474986c1e5f12e7795e28fdf3d4a46285aa0e45d128799784adc6618ec`.
The amount, type, wording, materiality, and exact source slice are unchanged.

### 4. Golden

The golden has no separately identified price term. `term_dry_run_002` is a consolidated `scope`
term containing the exact S1 sentence and USD 1,800 amount. Its fingerprint is
`e436b07d1c65e47a46152fa2691be91d272d93b70204506a0fed4175a19197f4`.

### 5. Alignment

`term_scope_1` pairs to `term_dry_run_002` with score and margin `0.7709499661933739`.
`term_price_1`, `term_deposit_1`, and `term_payment_trigger_1` remain unmatched extracted; there is
no unmatched golden term. This is correct one-to-one alignment and should remain unchanged.

### 6. Evaluator

The evaluator emits:

```json
{
  "severity": "critical",
  "family": "agreement_terms",
  "code": "unsupported_extra_object",
  "message": "Extracted object has no supported golden match and is a fabrication hard failure.",
  "extracted_id": "term_price_1"
}
```

Finding fingerprint:
`d5013941b000a20e9931e80bfc88b5717428c0954cfad1fd69eff4e0182e3020`.

The evaluator requires at least two distinctive shared wording/source tokens before it recognizes
an unmatched agreement term as grounded. The concise normalized wording shares the exact amount
but not two qualifying lexical tokens with S1. Replacing only the wording with
`Restore six dining chairs for $1,800.` leaves alignment byte-structurally equal and produces minor
`agreement_term_decomposition`. The source, type, amount, span, golden, and all other findings stay
fixed.

### 7. Acceptance

The selected finding does not change the locked acceptance result. The gate remains pass with
historical saved outputs `0/3` and hand-authored controls `3/3`.

## Explicit classification answers

- The frozen extraction is source-grounded.
- The golden is source-grounded.
- The extracted price component and consolidated golden scope term are not the same granularity,
  but they are structurally compatible and contain the same price fact.
- The mismatch is granularity plus evaluator normalization, not identity, party, amount, ordering,
  causation, or unsupported extra content.
- Alignment faithfully preserves the one-to-one broader-term match and should not change.
- The evaluator faithfully applies its implementation but violates its documented source-grounding
  distinction by calling exact-source price evidence a fabrication.
- Changing alignment would consume one golden object twice or displace `term_scope_1`; it is not the
  correct repair.
- Changing the golden would migrate benchmark policy from one consolidated term to Rule 23
  decomposition.
- Changing frozen extraction wording requires provider-backed regeneration and is forbidden.
- The unmatched price component should remain visible. The fabrication-hard-failure classification
  should not.

## Scope and non-goals

Files added:

- `src/fixtures/dry_run_002.pr25.critical-diagnostic.json`
- `src/tests/person-a-dr002-critical-diagnostic.test.ts`
- `docs/pr25-dry-run-002-price-term-diagnostic.md`

CI-only integration:

- `.github/workflows/ci.yml` lists the new test exactly once in the existing test matrix.

Deliberately unchanged:

- prompts and schemas
- extractor, assembly, normalization, alignment, and evaluator runtime
- all Dry Run 001 artifacts and fixtures
- Dry Run 002 narrative, golden, provenance registration, and frozen outputs
- acceptance thresholds and manifest
- dependencies and lockfile

This PR does not suppress, filter, re-tier, align, remove, or add any finding. It makes no provider
call and does not start the corrective PR.

## Reproduction

With the frozen run artifacts available, replay twice from a clean detached checkout at the
manifest-bound source SHA:

```bash
npm run provenance:person-a -- \
  --mode replay \
  --case-id dry_run_002 \
  --raw-response <frozen-run-dir>/dry_run_002.person_a.raw-response.json \
  --request-metadata <frozen-run-dir>/dry_run_002.person_a.request.json \
  --run-manifest <frozen-run-dir>/dry_run_002.person_a.run-manifest.json \
  --output-dir artifacts/person-a/pr25-replay-1
```

Repeat with a new `pr25-replay-2` output directory, then verify the derived artifact hashes recorded
above. At the locked base, run:

```bash
node --import tsx ./node_modules/vitest/vitest.mjs run \
  src/tests/person-a-dr002-critical-diagnostic.test.ts
node --import tsx src/commands/evaluate-person-a-extraction-acceptance.ts \
  --gate --format human
```
