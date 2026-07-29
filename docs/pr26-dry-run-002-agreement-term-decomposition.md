# PR #26 Dry Run 002 agreement-term decomposition correction

## Defect and disposition

PR #25 proved one evaluator defect:

`critical|agreement_terms|unsupported_extra_object|term_price_1|`

The frozen `term_price_1` is not fabricated. Its complete record says only that the total price was
USD 1,800, and its exact S1 span `[58,200)` contains that amount. The already matched golden
`term_dry_run_002` consolidates the same restoration scope, USD 1,800 price, deposit, and delivery
payment terms into one agreement term.

Alignment is correct: `term_scope_1` remains paired to `term_dry_run_002`, while `term_price_1`
remains an unmatched separately named component. Reusing the golden for a second pair would weaken
one-to-one alignment. Splitting or rewriting the golden would change benchmark policy. Regenerating
the extraction would replace frozen model evidence. None of those changes is justified.

PR #26 keeps the finding and its extracted identity, but changes its classification to:

`minor|agreement_terms|agreement_term_decomposition|term_price_1|`

This is a minor representation difference only for the verified frozen DR002 case. This PR does not
claim that every agreement-term decomposition is minor.

## Root cause

The generic calibrated evaluator requires at least two distinctive wording/source tokens and
65-percent wording coverage before an unmatched agreement term is treated as source-grounded.
`The total price was $1,800.` shares the exact amount with S1 but not two qualifying lexical tokens,
so the generic path falls through to critical `unsupported_extra_object`. PR #25's wording-only
counterfactual kept alignment unchanged and changed only this diagnostic, isolating the defect to
the evaluator classification layer.

## Correction mechanism

The correction runs only after ordinary classification has produced the exact historical critical.
It then requires every frozen identity and structural invariant:

- `calibrated_live_v2`;
- the exact DR002 narrative SHA-256 and identical extracted/golden `raw_text`;
- the complete historical diagnostic fingerprint;
- complete fingerprints for `term_price_1`, matched `term_scope_1`, and golden
  `term_dry_run_002`;
- the exact S1 UTF-16 span and quote;
- the complete agreement-term alignment fingerprint;
- the exact `term_scope_1 → term_dry_run_002` indexes, IDs, score, margin, and pair fingerprint;
- `term_price_1` at its frozen index, unmatched, unpaired, and unambiguous;
- `term_dry_run_002` matched rather than unmatched; and
- the exact price-only record, which adds no actor, date, obligation, installment, refund, delivery,
  payment, condition, or legal meaning absent from the consolidated golden.

The compatibility predicate first rejects proxies, accessors, sparse arrays, non-plain objects, and
non-JSON-safe structure through canonical fingerprinting. Missing, duplicated, ambiguous, mutated,
or contradictory evidence returns false and leaves the critical unchanged.

A generic unmatched-object exemption would be unsafe: the other DR002 criticals concern
cross-family claim policy, negative-remedy granularity, or an empty golden deliverables family.
They do not have the same proven same-family consolidated representation.

## Before and after

| Severity | Before | After |
| -------- | -----: | ----: |
| Critical |      5 |     4 |
| Major    |     15 |    15 |
| Minor    |     14 |    15 |
| Total    |     34 |    34 |

Only one ordered finding entry changes:

| Before                                                                | After                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `critical\|agreement_terms\|unsupported_extra_object\|term_price_1\|` | `minor\|agreement_terms\|agreement_term_decomposition\|term_price_1\|` |

The other four critical findings remain:

- `critical|deliverables|unsupported_extra_object|deliverable_1|`
- `critical|claims|unsupported_extra_object|claim_scope_1|`
- `critical|claims|unsupported_extra_object|claim_payment_term_1|`
- `critical|claims|unsupported_extra_object|claim_no_refund_1|`

The complete ordered 34-finding after-inventory, before/after hashes, protected DR001 hashes,
acceptance result, replay hashes, fingerprints, invariants, and negative inventory are bound in
`src/fixtures/dry_run_002.pr26.decomposition-correction.json`.

## Fail-closed negatives

The correction remains critical for different amounts or currencies; installment, refund, timing,
delivery, or payment conditions; unsupported or unrelated source spans; a missing or changed
golden; a missing or changed matched pair; any record or alignment fingerprint drift; contradiction;
semantic similarity without full containment; another family; and the four other DR002 critical
objects. Proxy and accessor mutations are also rejected.

## Regression and replay evidence

Two manifest-bound offline replays at the frozen source commit produced byte-identical extraction
and validation artifacts. Re-evaluating each frozen extraction at the PR #26 code produced
byte-identical alignment, evaluation, and ordered finding sets:

| Artifact    | SHA-256                                                            |
| ----------- | ------------------------------------------------------------------ |
| Extraction  | `496ce4938cc04ae65a72efc611e839158dfe7e5ee053d27dc21de96c77a8d076` |
| Validation  | `d3adea256203aaa11bba6b0b151a3b6659e2ed4031878c615b9474884dd733df` |
| Alignment   | `ee015c6efb1fe1bb3ead8625cfddbf1057f11837d2ba5d360169b03312de09a6` |
| Evaluation  | `5a36da589608c2cbb0d44c791b73e4cfed0103c96e887bf65f4da6b140b302e3` |
| Finding set | `56d1f0a1e372b029e609285037bec2ba09e8b9d37543feca028c2249b7fe1694` |

Each replay recorded zero provider calls, zero retries, and `manually_edited: false`. Historical
acceptance remains `0/3`, hand-authored controls remain `3/3`, and the gate remains pass. Protected
DR001 narrative, golden, extraction, alignment, evaluation, raw response, golden projection, and
run manifest hashes remain unchanged.

## Limitations

This is intentionally a frozen compatibility rule. A future generic representation policy would
need separate evidence across multiple cases and adversarial semantics. This PR neither supplies nor
implies that broader policy, and it does not adjudicate the remaining DR002 unmatched objects.
