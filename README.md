# JuryAI Extraction Lab

A deliberately small, local validation lab for JuryAI’s first machine-readable case record.

This repository currently answers one question:

> Can the manually validated Dry Run 001 dispute be encoded as strict JSON without inventing evidence, and can a validator enforce the project’s epistemic rules?

## Current scope

Included:

- JSON Schema Draft 2020-12 case-record schema
- complete Dry Run 001 golden JSON fixture
- verbatim Person A and Person B narratives
- Ajv schema validation
- custom cross-object invariants
- malformed-fixture tests
- semantic-alignment contract for the future extractor regression harness

Not included:

- model calls
- Person A extractor
- semantic alignment implementation
- Supabase
- application state machine
- UI
- invitations
- recommendations

## Files

```text
src/
  schemas/
    juryai-case-record-v0.1.2.schema.json
  fixtures/
    dry_run_001.person_a.txt
    dry_run_001.person_b.txt
    dry_run_001.golden.json
  validation/
    validate-case-record.ts
    custom-invariants.ts
  alignment/
    alignment-contract.md
  tests/
    schema.test.ts
    invariants.test.ts
    golden-fixture.test.ts
SCHEMA_QUESTIONS.md
```

## Setup

```bash
npm install
```

## Validate the golden fixture

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
```

## Validation layers

### JSON Schema

The Draft 2020-12 schema enforces:

- required canonical sections
- strict object shapes
- exact enums
- categorical confidence only
- evidence availability and provenance structures
- separate occurrence and interpretation
- separate submitter and quoted-message author
- ordered public outcomes with bidirectional transfers
- no private settlement fields in defined object shapes

### Custom invariants

Code enforces rules that JSON Schema cannot express cleanly:

- global ID uniqueness
- valid cross-object references and object families
- financial envelope derivation
- no completed evidence comparison before inspection
- no decision-critical finding from uninspected evidence
- no recommendation while deliberation is ineligible
- no record lock before confirmation or neutral correction-opportunity exhaustion
- no party-private evidence in deliberation
- consistent schema and record versions
- no private settlement fields anywhere in the tree

## Golden-fixture posture

Dry Run 001 is intentionally pre-inspection.

The actual contract, messages, recordings, and campaign record were described but not supplied. The fixture therefore keeps them `described_only` or `unavailable`, leaves the record unlocked, keeps required questions pending, sets deliberation eligibility to `false`, and sets recommendation to `null`.

A structurally convenient fictional verdict would be a validation failure, not progress.

## Future extractor evaluation

The future comparison harness must align objects by semantic content before comparing fields. It must not align by generated ID, array order, or exact wording. See [`src/alignment/alignment-contract.md`](src/alignment/alignment-contract.md).
