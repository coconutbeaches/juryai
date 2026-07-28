# PR #19 scope — exact-contained total-price wording equivalence

## Locked base and defect

This change starts from merged PR #18 at
`8d1ee0cfedee5a2a5fc00480378f99b8882ff91d`.

It corrects exactly:

`major|agreement_terms|term_wording|term_07_price|term_price`

The locked baseline is `0 critical / 37 major / 19 minor` with 56 findings.
The intended result is `0 critical / 36 major / 19 minor`, removing only the
finding above. No alignment pair, other finding object, or severity may change.

## Proven records and source

The aligned extracted record is:

```json
{
  "term_id": "term_07_price",
  "term_type": "price",
  "wording": "The stated project price was $2,400.",
  "wording_status": "not_inspected",
  "interpretation_status": "unclear",
  "person_a_interpretation": null,
  "materiality": "high"
}
```

The aligned golden record is:

```json
{
  "term_id": "term_price",
  "term_type": "price",
  "wording": "for $2,400.",
  "wording_status": "not_inspected",
  "interpretation_status": "not_applicable",
  "person_a_interpretation": null,
  "materiality": "high"
}
```

The extracted source span at UTF-16 coordinates `57–167` is:

> In early April I agreed to build a five-page marketing website for Maya Chen’s consulting
> business for $2,400.

The golden span at `156–167` is:

> for $2,400.

Both quotes reproduce exactly from the narrative, the shorter occurrence is fully contained by the
longer occurrence, and each wording and source occurrence contains exactly one supported USD
literal equal to 240000 integer cents.

The extracted and golden record SHA-256 values are
`32128cc7496f01ea72169cf80c9a0a4e37e62f140ffcb6c39d41a9cb7971aba4` and
`67f96664a43937d58218cb91929a6a4e47d3a068c1fcd4a597a24bd080a20798`.
These hashes document the discovery evidence; the implementation does not use them.

## Root cause

Alignment already pairs `term_07_price` with `term_price`. The generic agreement-term wording
comparison scores the two strings at approximately `0.36`, below its `0.50` lexical threshold.
That lexical score does not recognize the exact structural identity of a total-price amount.

The correction is evaluation-only. It does not change the generic similarity function or
threshold, extraction, normalization, alignment, record IDs, golden data, schemas, or any frozen
compatibility projection.

## Structural acceptance predicate

The corrected evaluator removes an existing diagnostic only when all of these conditions hold:

1. evaluation uses `calibrated_live_v2`;
2. the diagnostic is exactly a Major `agreement_terms / term_wording` diagnostic;
3. it belongs to exactly one already-aligned agreement-term pair;
4. both aligned terms have exactly `term_type: "price"`;
5. each wording matches one of the deliberately small declarative total-price forms;
6. each wording contains exactly one supported `$` monetary literal;
7. both literals resolve to the same exact integer-cent value;
8. both records contain nonempty, dense, data-only source-span arrays;
9. every source span is a valid exact narrative slice;
10. a source span from each record contains the same sole amount; and
11. one exact source occurrence fully contains the other.

The predicate uses neither record IDs, fixed offsets, fixture names, narrative hashes, record
hashes, nor fuzzy thresholds.

## Explicit exclusions

The rule fails closed for deposit, balance, remaining-balance, installment, partial-payment,
conditional-payment, payment-trigger, refund, discount, credit, penalty, separate-fee, range,
minimum, maximum, approximate, and negated wording. It also rejects multiple amounts, mismatched
values, unsupported or mismatched currency formats, non-price terms, missing or malformed spans,
tampered quotes, noncontained occurrences, other diagnostic codes, non-calibrated evaluation,
proxies, accessors, non-plain objects, sparse arrays, and arrays with extra properties.

Only conventional `$2,400`-style USD literals needed by the existing corpus are supported. Unknown
or broader international formats do not match.

## Verification contract

Focused tests cover the exact positive case and every explicit exclusion above. They exercise the
predicate directly and the corrected evaluator, preserve all non-target diagnostics, and prove the
locked acceptance path retains the original diagnostic.

The final verification gate includes:

- focused evaluator semantics;
- PR #17 timeline and PR #18 claim compatibility regressions;
- relevant Person A extraction and evaluation tests;
- the full test suite;
- typecheck and repository formatting;
- CI test-matrix coverage;
- JSON Schema and custom invariants;
- Person A acceptance;
- dependency audit; and
- exact canonical evaluation with serialized finding and alignment comparison.

The narrative, raw response, golden projection, PR #18 extraction projection, PR #18 audit, and
alignment identities must remain unchanged. The final report identity changes only because the
single intended diagnostic and derived summary fields disappear.

Final local evidence:

- focused evaluator semantics: `75/75`;
- relevant extraction/evaluation set: `831/831` across 12 files;
- PR #17 timeline compatibility: `13/13`;
- PR #18 `cl_a_013` compatibility: `18/18`;
- Person A suite: `70/70`;
- full suite: `1361/1361` across 24 files;
- acceptance dependency isolation: `36/36`;
- typecheck, formatting, CI matrix coverage, JSON Schema, custom invariants, and acceptance: pass;
- historical acceptance: `0/3`; hand-authored controls: `3/3`; and
- dependency audit: zero vulnerabilities.

The final evaluation is `0 critical / 36 major / 19 minor`. Re-inserting only the removed
diagnostic and the locked baseline summary reproduces the exact baseline report SHA-256
`0a302f4ac5891060350dee3824b925a379271994cc1de9b9b45c3bfe91012e03`.
The final report SHA-256 is
`c7b3e7cc77d23cdad389b405b9bf253eaad65dbf8d8c2c8a8c940e70ec0ced09`;
the alignment remains
`d05eaaea6d4e783521e6bb7c8f3560b046ef1dc5ca8394ea54a8fe1623d9b45e`.

## Non-goals

This PR does not address party interpretations, agreement decomposition, deliverable state,
timeline actors or omissions, claim wording or decomposition, evidence identity, damages,
extraction-issue classification, clarification coverage, grounded extras, generic semantic
matching, generic currency normalization, prompts, extraction, model behavior, or benchmark data.
No model or API call is made.

## Rollback boundary

Rollback consists of reverting the corrected-evaluator predicate, its focused tests, the necessary
current-evaluator count assertions in the PR #17/PR #18 regression tests, and this document. No
stored extraction, projection, alignment, golden record, source artifact, schema, or model output
requires migration or rollback.
