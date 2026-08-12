# PR #28 Dry Run 002 `claim_no_refund_1` correction

## Scope and locked base

This PR corrects only the frozen DR002 finding:

```text
critical|claims|unsupported_extra_object|claim_no_refund_1|
```

The authoritative merged base is PR #27's squash commit:

```text
6a05a63361338453100611e59504bafa8853323e
```

The repository gate confirmed that local `main`, `origin/main`, and the fetched remote `main` all
equal that SHA with `0/0` divergence; PR #27 is merged at that exact squash commit; its 30
post-merge checks succeeded; the primary worktree was clean; and neither PR #28 nor its local or
remote branch existed before work began.

No extraction, alignment, prompt, schema, golden, acceptance threshold, similarity threshold,
dependency, package manifest, lockfile, or historical frozen artifact is changed.

## Baseline reproduction

Two fresh manifest-bound offline replays at the extraction source commit
`c081c1e10427f11125a43976f74d1ce076d4a19c` produced byte-identical extraction, validation,
source alignment, and source evaluation artifacts. The frozen extraction was then aligned and
evaluated twice at the locked PR #28 base. Both runs produced:

| Artifact               | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| Extraction             | `496ce4938cc04ae65a72efc611e839158dfe7e5ee053d27dc21de96c77a8d076` |
| Validation             | `d3adea256203aaa11bba6b0b151a3b6659e2ed4031878c615b9474884dd733df` |
| Locked-base alignment  | `ee015c6efb1fe1bb3ead8625cfddbf1057f11837d2ba5d360169b03312de09a6` |
| Locked-base evaluation | `5a36da589608c2cbb0d44c791b73e4cfed0103c96e887bf65f4da6b140b302e3` |
| Ordered finding set    | `318488482883a1d82e57ae4d6a9c7f901bc0a5152102a8e7b8e0c12b8feb3a16` |

Each replay recorded zero provider calls, zero retries, and `manually_edited: false`. The baseline
was byte-identical across the two runs:

```text
critical: 4   major: 15   minor: 15   total: 34
```

The complete frozen extraction is embedded in the committed PR #28 evidence fixture so the focused
test and CI do not depend on gitignored `artifacts/` content.

## Classification policy

### Decision

The replacement is:

```text
minor|claims|claim_remedy_decomposition|claim_no_refund_1|
```

`claim_remedy_decomposition` means a non-blocking representation difference for this frozen,
source-grounded no-refund proposition that is already covered by a broader matched golden remedy
claim. It is intentionally narrower than a generic claim-decomposition or refund policy.

### Why minor

The source sentence contains two independently articulated clauses: a positive request for the
remaining payment and a negative statement that no refund is requested. The extraction preserves
the second proposition as its own claim. PR #27 proved:

- the cited source span is exactly `[514,625)`;
- the golden `cl_002_remedy.claim_text` is byte-identical to that span;
- the extracted object adds no unsupported obligation, amount, date, condition, or legal
  conclusion;
- actor and object resolution are directly supported;
- negative present-tense modality is preserved;
- the difference is decomposition, not contradiction;
- alignment correctly keeps one-to-one identity by pairing `claim_balance_1` with
  `cl_002_remedy` and leaving `claim_no_refund_1` unmatched.

A major finding blocks acceptance and the existing `granularity_split` message says consolidation
is required. That is not the user-visible risk here: the separately represented no-refund position
is faithful, reviewable, and does not require a substantive human correction. Keeping the finding
as minor preserves visibility without treating a harmless representation choice as acceptance
blocking.

### Why this is not copied mechanically from PR #26

PR #26's `agreement_term_decomposition` decision relied in part on prompt rule 23, which explicitly
requires independently meaningful agreement components to remain separate. That rule does not
define claim granularity. This decision instead rests on the source's independent second clause,
byte-identical golden coverage, preserved modality, no added semantics, correct one-to-one
alignment, and low user-visible risk.

Rejected alternatives:

- **major `granularity_split`:** would falsely require consolidation and continue to block
  acceptance for a faithful proposition;
- **minor `agreement_term_decomposition`:** wrong family and wrong policy basis;
- **minor `claim_decomposition`:** too broad for one benchmarked remedy case;
- **minor `refund_decomposition`:** would imply a policy across refund claims that has not been
  benchmarked.

## Fail-closed correction

The correction runs only after ordinary evaluator behavior has produced the exact historical
critical. It requires all of the following:

- contract `calibrated_live_v2`;
- exact DR002 narrative SHA-256;
- exact complete frozen extraction fingerprint;
- exact complete golden fingerprint;
- exact complete alignment fingerprint;
- exact claims-family alignment fingerprint;
- exact historical diagnostic fingerprint;
- unique complete-record fingerprints for `claim_no_refund_1`, matched sibling
  `claim_balance_1`, and golden `cl_002_remedy`;
- exact indexes `8`, `7`, and `2` for those records;
- exact `claim_balance_1 → cl_002_remedy` pair fingerprint;
- exact unmatched `claim_no_refund_1` entry fingerprint;
- the target remains unpaired and unambiguous; and
- the golden remedy remains matched rather than unmatched.

Canonical fingerprints reject proxies, accessors, sparse arrays, symbols, and non-plain or
non-JSON-safe structures. Any evidence drift returns false and leaves the ordinary critical
unchanged. No similarity score, overlap threshold, alias bypass, fuzzy rule, or lexical containment
exception is added.

## Exact before and after

Before:

```text
critical|claims|unsupported_extra_object|claim_no_refund_1|
Extracted object has no supported golden match and is a fabrication hard failure.
```

After:

```text
minor|claims|claim_remedy_decomposition|claim_no_refund_1|
Separately represented source-grounded no-refund position is covered by a broader matched golden remedy claim.
```

| Severity | Before | After |
| -------- | -----: | ----: |
| Critical |      4 |     3 |
| Major    |     15 |    15 |
| Minor    |     15 |    16 |
| Total    |     34 |    34 |

Only ordered finding index 18 changes. The other 33 complete finding objects are byte-identical and
remain in the same order.

| Artifact            | Before SHA-256                                                     | After SHA-256                                                      |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Extraction          | `496ce4938cc04ae65a72efc611e839158dfe7e5ee053d27dc21de96c77a8d076` | `496ce4938cc04ae65a72efc611e839158dfe7e5ee053d27dc21de96c77a8d076` |
| Alignment           | `ee015c6efb1fe1bb3ead8625cfddbf1057f11837d2ba5d360169b03312de09a6` | `ee015c6efb1fe1bb3ead8625cfddbf1057f11837d2ba5d360169b03312de09a6` |
| Evaluation          | `5a36da589608c2cbb0d44c791b73e4cfed0103c96e887bf65f4da6b140b302e3` | `772c3ad282dcd29b982a69ee44951d797617fe6f63d8fac628c77f94fe3dd020` |
| Ordered finding set | `318488482883a1d82e57ae4d6a9c7f901bc0a5152102a8e7b8e0c12b8feb3a16` | `c78f92c6b6ac7d8dd2816c0cdd1ba7f42d7fa466f1730a6f58809694c71d094f` |

## Adversarial controls

Focused tests prove that the correction does not apply to:

1. the same textual pattern under a different case identity;
2. the same source span with different extracted meaning;
3. the same extraction text with changed golden evidence;
4. the same golden with changed alignment evidence;
5. the same similarity score in an unrelated claim;
6. a different refund claim in another fixture identity;
7. a structurally similar claim without source support;
8. a fabricated claim with lexical overlap;
9. the legitimate but still unsupported `claim_payment_term_1`; or
10. any evidence fingerprint drift.

Contract, narrative, proxy, and accessor drift also fail closed. These controls keep the ordinary
critical where applicable and never yield `claim_remedy_decomposition`.

## Protected behavior

The eight protected DR001 hashes are unchanged. The acceptance gate remains pass with historical
outputs `0/3` and hand-authored controls `3/3`; DR001 candidate counts remain unchanged. PR #26's
`term_price_1` remains:

```text
minor|agreement_terms|agreement_term_decomposition|term_price_1|
```

Extraction and alignment outputs are unchanged. The golden, prompt, schema, acceptance thresholds,
similarity thresholds, dependencies, package metadata, and lockfile are unchanged.

## Verification

- focused PR #26/#27/#28 tests: `50/50` passed;
- evaluator/alignment/DR002-related tests: `857/857` passed;
- full suite: `1490/1490` passed across 30 files;
- typecheck: passed;
- formatting check: passed;
- DR001 golden JSON Schema and custom invariants: passed;
- frozen and golden DR002 Person A extraction schema and custom invariants: passed with zero
  errors;
- CI test coverage guard: passed; every test file appears exactly once;
- acceptance gate: passed; historical `0/3`, controls `3/3`;
- `git diff --check`: passed;
- two fresh post-correction offline replays: byte-identical, zero provider calls, zero retries, and
  `manually_edited: false`;
- dependency audit: reports three current transitive advisories (`fast-uri`, `nanoid`, and
  `postcss`). The authoritative base produces the identical audit failure from byte-identical
  `package.json` and `package-lock.json`; dependency and lockfile changes are prohibited in this
  PR.

## Remaining DR002 criticals

The three remaining criticals are:

- `claim_payment_term_1`
- `claim_scope_1`
- `deliverable_1`

This PR neither diagnoses nor modifies them.

## Limitations

This compatibility correction recognizes one frozen historical case. It does not define a general
claims decomposition policy, refund policy, semantic-entailment rule, pronoun-normalization bypass,
or reusable escape hatch for unsupported claims. A future general policy requires a benchmarked
corpus and is explicitly outside PR #28.
