# JuryAI Extraction Lab

A deliberately small, local validation lab for JuryAI’s machine-readable case record and narrative extraction pipeline.

The repository now answers two measurable questions:

1. Can Dry Run 001 be encoded as strict JSON without inventing evidence?
2. Can a model reliably populate the Person A portion of that record from messy narrative input?

## Current scope

Included:

- JSON Schema Draft 2020-12 case-record schema v0.1.2
- complete Dry Run 001 golden JSON fixture
- verbatim Person A and Person B narratives
- Ajv schema validation and custom invariants
- Person A structured-output extractor using the OpenAI Responses API
- deterministic Person A projection from the full golden record
- semantic, one-to-one alignment that ignores IDs, array order, and exact prose
- critical/major/minor error classification
- recall, precision, human-edit-rate, and weighted-error-rate reporting
- regression tests for key epistemic failures

Not included:

- Person B extraction
- Supabase
- application state machine
- UI or invitation flow
- fact findings, deliberation, or recommendation generation

## Setup

```bash
npm install
```

For live extraction, set an API key locally. Never commit it:

```bash
export OPENAI_API_KEY="..."
```

Optional configuration:

```bash
export JURYAI_MODEL="gpt-5.1"
export JURYAI_REASONING_EFFORT="high"
```

## Run the Person A extractor

```bash
npm run extract:person-a
```

The default command reads `src/fixtures/dry_run_001.person_a.txt`, calls the configured model, validates the result, aligns it with the Person A golden projection, and writes:

```text
artifacts/person-a/latest/
  extraction.json
  golden-projection.json
  alignment.json
  report.json
  report.md
```

Use a different narrative or output folder:

```bash
npm run extract:person-a -- \
  --input path/to/narrative.txt \
  --submitted-at 2026-07-19T00:00:00Z \
  --output-dir artifacts/person-a/run-001
```

Evaluate an existing extraction without an API call:

```bash
npm run extract:person-a -- \
  --input src/fixtures/dry_run_001.person_a.txt \
  --extraction path/to/extraction.json
```

Add `--fail-on-critical` when a critical regression should produce a nonzero exit code.

## Person A extraction rules

The extractor fails closed when it:

- promotes a claim into a fact
- invents Person B’s position or counterclaims
- flattens approximate dates
- treats described evidence as uploaded or inspected
- assigns evidentiary strength before inspection
- loses exact narrative source spans
- introduces private settlement information
- creates legal conclusions, findings, deliberation, or recommendations

Source quotes must match `narrative.slice(start_char, end_char)` exactly.

## Semantic evaluation

Objects are blocked and matched by party, type, actor, date overlap, transfer direction, and semantic content. A Hungarian maximum-weight assignment enforces one-to-one matching. Generated IDs and array order do not contribute to similarity.

The report includes:

- aligned pairs, scores, and ambiguity margins
- unmatched golden objects as recall failures
- unmatched extracted objects as possible hallucinations or over-segmentation
- critical, major, and minor field-level differences
- recall and precision by object family
- human edit rate
- weighted error rate

## Validate the canonical fixture

```bash
npm run validate:golden
```

Expected result:

```text
✓ JSON Schema valid: .../dry_run_001.golden.json
✓ Custom invariants valid
```

## Run all checks

```bash
npm test
npm run typecheck
npm run validate:golden
npm run format:check
npm audit --audit-level=low
```

## Golden-fixture posture

Dry Run 001 remains intentionally pre-inspection. The contract, messages, recordings, and campaign record were described but not supplied. The canonical record therefore keeps them `described_only` or `unavailable`, leaves the record unlocked, keeps required questions pending, blocks deliberation, and keeps recommendation `null`.

A structurally convenient fictional verdict is a validation failure, not progress.

See [`src/alignment/alignment-contract.md`](src/alignment/alignment-contract.md) for the full comparison contract.
