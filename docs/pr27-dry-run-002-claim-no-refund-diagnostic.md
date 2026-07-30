# PR #27 Dry Run 002 `claim_no_refund_1` diagnostic

## Disposition

This PR is diagnostic only. It changes no runtime behavior, no golden, no prompt, no schema, and no
frozen artifact. The DR002 finding counts are unchanged:

```text
critical: 4   major: 15   minor: 15   total: 34
```

The selected finding is:

```text
critical|claims|unsupported_extra_object|claim_no_refund_1|
```

Root-cause classification: **evaluator defect**, confidence **high**.

## Candidate ranking

All four remaining criticals were read directly from the frozen source, extraction, golden,
alignment, and evaluation artifacts. Ranking is by evidence clarity and risk of drawing a false
conclusion, not by ease of repair.

| Rank | Finding                | Same-family golden | Span overlap | Selected |
| ---: | ---------------------- | ------------------ | -----------: | -------- |
|    1 | `claim_no_refund_1`    | `cl_002_remedy`    |     **1.00** | **yes**  |
|    2 | `claim_payment_term_1` | none               |         0.00 | no       |
|    3 | `claim_scope_1`        | none               |         0.00 | no       |
|    4 | `deliverable_1`        | family is empty    |          n/a | no       |

`claim_no_refund_1` is the only one of the four whose cited span is covered — exactly and
completely — by a same-family golden object that is already matched. That makes it the only
candidate whose severity can be diagnosed without first settling a benchmark-policy question.

**Why the others were not selected.**

- `claim_payment_term_1` cites `[58,200)`. The golden claims cover `[201,300)`, `[379,513)`, and
  `[514,625)` only, so span overlap against every golden claim is `0.00` and the
  `granularity_split` tier is structurally unreachable regardless of wording. A verbatim-wording
  counterfactual reaches only `source_grounded_extra_object`. The residual question — whether the
  S1 payment structure should exist as a golden claim, or only cross-family as
  `term_dry_run_002` — is a golden-policy judgment, not an isolable evaluator defect.
- `claim_scope_1` is in the same position and is coupled to it: both decompose the identical S1
  span, and both are further coupled to `deliverable_1` through `source_claim_ids`. Diagnosing one
  alone would understate the coupling; diagnosing them together would batch multiple criticals,
  which this PR forbids.
- `deliverable_1` has no same-family golden at all — `deliverable_assessments` is empty in the
  golden. Its grounding predicate depends transitively on claim alignment, so its severity is a
  cascade of the claim criticals rather than an independent condition. Restricting its
  `source_claim_ids` to the only matched claim leaves it critical. Highest risk of a false
  conclusion.

## Pipeline trace

| Stage           | Behavior                                                             | Diverges |
| --------------- | -------------------------------------------------------------------- | -------- |
| narrative       | `[514,625)` states the proposition verbatim                          | no       |
| extraction      | faithful decomposition; no added semantics                           | no       |
| validation      | schema and invariants pass                                           | no       |
| record assembly | frozen record fingerprint `2fc5491e…`                                | no       |
| golden          | `cl_002_remedy` is compound but faithful to the source sentence      | no       |
| alignment       | correctly leaves the object unmatched                                | no       |
| **evaluator**   | **labels a fully grounded decomposition a fabrication hard failure** | **yes**  |

The first divergence is the evaluator's severity classification.

### Source

The narrative slice `[514,625)` is:

> I am asking Priya to pay the remaining $900 after I deliver the last two chairs; I am not asking
> to refund her.

The extracted claim asserts `Jordan is not seeking to refund Priya.` and cites exactly that span.
The golden claim `cl_002_remedy` carries a `claim_text` that is **byte-identical to that same
slice**, and cites the identical span. The proposition therefore appears verbatim in both the
source and the golden.

### Extraction

The extraction decomposes one compound source sentence into a positive payment request
(`claim_balance_1`) and a negative no-refund position (`claim_no_refund_1`). Component analysis:

| Component        | Added | Support            |
| ---------------- | ----- | ------------------ |
| actor            | yes   | directly supported |
| action           | yes   | directly supported |
| object           | yes   | directly supported |
| remedy           | yes   | directly supported |
| refund rule      | yes   | directly supported |
| date             | no    | —                  |
| amount           | no    | —                  |
| condition        | no    | —                  |
| obligation       | no    | —                  |
| legal conclusion | no    | —                  |

No unsupported or inferential additions. Modality is preserved: source and extraction are both
negative present-tense assertions of Person A's own position. The difference from the golden is
structural decomposition, not contradiction.

### Alignment

Alignment is correct and required. `candidateScore` gates claims on exact `claim_type` equality.
The extracted `claim_type` is `refund`; no golden claim has that type, so no similarity value is
ever computed and no pairing is possible. `cl_002_remedy` is legitimately paired to
`claim_balance_1` at score `0.5107`. Forcing a second pair would break one-to-one alignment and
would hide a real granularity difference.

### Evaluator

The unmatched object falls through this cascade:

| Predicate                      | Result | Blocking conjunct                                                              |
| ------------------------------ | ------ | ------------------------------------------------------------------------------ |
| `isAgreementTermDecomposition` | n/a    | family is `claims`                                                             |
| `isMatchedGranularitySplit`    | false  | span overlap `1.00` ≥ `0.8` **passes**; similarity `0.3147` < `0.45` **fails** |
| `isSourceGroundedExtra`        | false  | similarity `0.3147` < `0.40`                                                   |
| fallthrough                    | —      | `critical unsupported_extra_object`                                            |

`granularity_split` is the evaluator's own designed destination for exactly this pattern — an
unmatched extracted object with high span overlap onto a matched same-family golden. It is blocked
by a single conjunct.

## Root cause

Both gates score `semanticSimilarity`, a symmetric Dice metric
(`0.65 · tokenDice + 0.35 · trigramDice`). Symmetric Dice measures **resemblance**, not
**entailment or containment**. Two independent, faithfulness-neutral factors depress it here:

1. **Length asymmetry.** The extracted claim normalizes to 7 tokens; the compound golden claim to 17. Even if every extracted token appeared verbatim in the golden, `tokenDice` could not exceed
   `2 · 7 / (7 + 17) = 0.5833`. A faithful _proper subset_ of a compound claim is structurally
   penalized for being a subset.
2. **Correct referent resolution.** The three extracted tokens absent from the golden are
   `jordan`, `seeking`, and `is`. The extraction resolved `I` → `Jordan` and `her` → `Priya` and
   used `seeking` for `asking`. The alias map covers `client` and `restorer` but not first- and
   third-person pronouns, so correct pronoun resolution _reduces_ the score.

The extraction is penalized for doing referent resolution correctly.

### Counterfactual

Replacing only `claim_text` with the source clause verbatim — `I am not asking to refund her.` —
and touching nothing else:

|                         | Before                              | After                     |
| ----------------------- | ----------------------------------- | ------------------------- |
| similarity              | `0.3147`                            | `0.5320`                  |
| finding                 | `critical…unsupported_extra_object` | `major…granularity_split` |
| claims alignment        | —                                   | **unchanged**             |
| finding entries changed | —                                   | **1**                     |
| total findings          | 34                                  | 34                        |

Surface wording is the only variable. The alignment, the `claim_type`, and both source spans are
untouched. This isolates the defect to the evaluator's classification layer.

## Competing explanations rejected

- **Legitimate unsupported or fabricated extraction.** Rejected. The proposition appears verbatim
  in the narrative and verbatim inside the golden claim text. Nothing is introduced beyond the
  source.
- **Alignment defect.** Rejected. Pairing is structurally impossible via the `claim_type` gate, and
  the existing pair is correct and higher-scoring.
- **Golden-policy defect.** Not proven. `cl_002_remedy` faithfully mirrors one source sentence.
  Whether a golden should decompose a compound remedy sentence is a benchmark-design question this
  PR deliberately does not adjudicate.
- **Extraction defect.** Rejected as the owner of the _critical_. The decomposition is a
  granularity difference for which the evaluator already defines a dedicated non-fatal tier. The
  defect under diagnosis is the severity misclassification, which the evaluator owns.

## Why no correction is included

The runtime-change gate is not met on one point: the evidence proves the defect but **does not
determine the correct replacement tier**.

- The generic evaluator path would yield `major granularity_split`.
- PR #26 established `minor agreement_term_decomposition` for the structurally analogous
  consolidated-golden case in the `agreement_terms` family.

Those two live precedents conflict for this object, and choosing between them is a policy decision
this PR has not evidenced. Correcting now would silently resolve that conflict inside a diagnostic
change. The evidence needed to settle it — whether a claims-family decomposition of a compound
matched golden is a review-worthy split or a benign representation difference — is not established
by this one case.

There is no requirement for PR #27 to reduce the critical count.

## Recommended PR #28

A narrowly scoped PR #28 should:

1. decide the claims-family tier for a faithful decomposition of a compound matched golden claim,
   stating the policy explicitly rather than inheriting it;
2. bind the correction fail-closed to the frozen fingerprints recorded in
   `src/fixtures/dry_run_002.pr27.claim-no-refund-diagnostic.json`;
3. preserve the unmatched object and the one-to-one alignment;
4. prove that exactly one finding entry changes, with ordering and total preserved; and
5. prove fail-closed behavior on contradiction, added amount, added condition, changed party,
   changed claim type, and golden or narrative drift.

It should not generalize to `claim_scope_1`, `claim_payment_term_1`, or `deliverable_1`, whose root
causes are golden-policy questions rather than evaluator defects.

## Verification

Two manifest-bound offline replays reproduced byte-identical extraction and validation. Because the
frozen request metadata binds the pre-PR-24 golden identity, extraction and validation replay at
the extraction source commit `c081c1e1`; alignment and evaluation are then re-derived from the
frozen extraction at the PR #27 locked base. Both layers are byte-identical across two independent
runs.

| Artifact                 | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| Extraction               | `496ce4938cc04ae65a72efc611e839158dfe7e5ee053d27dc21de96c77a8d076` |
| Validation               | `d3adea256203aaa11bba6b0b151a3b6659e2ed4031878c615b9474884dd733df` |
| Alignment (locked base)  | `ee015c6efb1fe1bb3ead8625cfddbf1057f11837d2ba5d360169b03312de09a6` |
| Evaluation (locked base) | `5a36da589608c2cbb0d44c791b73e4cfed0103c96e887bf65f4da6b140b302e3` |

Each replay recorded zero provider calls, zero retries, and `manually_edited: false`. No
model-backed extraction request was made at any point. Historical acceptance remains `0/3`,
hand-authored controls remain `3/3`, and the gate remains pass. Protected DR001 hashes are
unchanged. PR #26's `term_price_1` correction is unchanged.

The extracted, golden, and diagnostic fingerprints in this PR were computed independently and match
the values recorded in PR #25's fixture exactly.

The frozen extraction artifact is not tracked in the repository (`artifacts/` is gitignored), so the
records the diagnosis needs are embedded in
`src/fixtures/dry_run_002.pr27.claim-no-refund-diagnostic.json` and the focused test rebuilds the
projection from committed inputs alone — the same convention PR #25 and PR #26 use. The test asserts
that every embedded record fingerprints to the value PR #25 recorded independently, so an altered
embedded copy cannot pass. The projection reproduces all four `unsupported_extra_object` criticals
exactly; the full 34-finding inventory and the alignment and evaluation hashes are recorded evidence
from the offline replay described above.

## Limitations

- The diagnosis covers one frozen historical object. It does not establish a general policy for
  claim decomposition, and it does not adjudicate the other three DR002 criticals.
- The structural-ceiling argument is specific to the observed token counts. It shows the metric
  _cannot_ classify this case correctly, not that every sub-threshold score is a defect.
- `final_head_sha` is recorded as `null` by convention: a commit cannot contain its own hash. It is
  verified externally from the pull request head.
