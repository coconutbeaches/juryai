# Dry Run 001 — live extraction and evaluation

Status: **Rejected.** Dry Run 001 does not pass the acceptance gate.

This document records one live Person A extraction executed against untouched live evidence under
the rules locked by PR #11 (`person-a-v0.1.4`), the unmodified evaluator, and the unmodified
golden. No prompt, schema, golden, evaluator threshold, or manifest was changed before, during, or
after the run. The failure is recorded first and attributed second.

## 1. Case selection

Dry Run 001, Person A. It is the case PR #11 named as the fresh-run target, and the only case not
excluded by the prompt v0.1.4 compatibility boundary in
[`person-a-extraction-acceptance.md`](person-a-extraction-acceptance.md).

## 2. Evidence preservation

The source narrative was read and submitted byte-for-byte. It was not edited, normalized, or
re-encoded for this run.

| Field            | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Path             | `src/fixtures/dry_run_001.person_a.txt`                            |
| SHA-256          | `2cdb00b4b2b28c1813a979be5cf22f1ac51a30282abea9e144df491549c4fcc7` |
| Modified for run | no                                                                 |

The extractor independently recorded `metadata.input_hash` as the same digest, so the extraction is
provably derived from the tracked evidence.

## 3. Extraction run

| Field                       | Value                                           |
| --------------------------- | ----------------------------------------------- |
| Requested model             | `gpt-5.6`                                       |
| **Served model**            | **`gpt-5.6-sol`**                               |
| Reasoning effort            | `medium`                                        |
| `store`                     | `false`                                         |
| Prompt / extractor / schema | `person-a-v0.1.4` / `person-a-v0.1.3` / `0.1.2` |
| Response status             | `completed`, not truncated                      |

The requested and served model identifiers differ. That is provenance worth tracking, not a
failure: the run must be read as a `gpt-5.6-sol` result.

## 4. Schema and invariant validation

Passed. The extraction is valid against case-record schema v0.1.2 and all custom Person A
invariants, including exact `narrative.slice(start_char, end_char)` source-span equality.

## 5. Evaluation result

| Metric              | Value |
| ------------------- | ----- |
| Critical            | 8     |
| Major               | 53    |
| Minor               | 13    |
| Human edit rate     | 74.5% |
| Weighted error rate | 0.651 |

Acceptance requires zero critical and zero major errors. **Rejected.**

Family recall / precision:

| Family                  | Recall | Precision |
| ----------------------- | ------ | --------- |
| agreement_terms         | 1.00   | 0.53      |
| deliverables            | 1.00   | 1.00      |
| timeline                | 0.70   | 0.70      |
| claims                  | 0.85   | 0.73      |
| evidence                | 0.22   | 0.29      |
| damages / outcomes      | 1.00   | 1.00      |
| clarification_questions | 0.25   | 0.17      |

### Against the locked historical baseline

The PR #10/#11 corpus remains untouched by this run — the acceptance gate still reports historical
0/3, controls 3/3, canonical SHA-256
`a8c74e78ac9d209d4127f8efb3217004f3e3e1cd7cc6a3e1a9f367af442d070b`, verified after the run. That
makes the historical saved outputs a valid comparison point:

| Candidate             | Prompt     | Critical |  Major |  Minor |
| --------------------- | ---------- | -------: | -----: | -----: |
| `historical_saved_v1` | pre-v0.1.4 |        1 |     54 |     18 |
| `historical_saved_v2` | pre-v0.1.4 |        1 |     56 |     15 |
| `historical_saved_v3` | pre-v0.1.4 |        1 |     56 |     18 |
| **this live run**     | **v0.1.4** |    **8** | **53** | **13** |

Majors and minors improved slightly. Criticals went from 1 to 8. Every one of the seven added
criticals is a rule 23 agreement-term decomposition (Finding A) — that is, the v0.1.4 rule PR #11
introduced is what converted a passing-shaped behaviour into fabrication hard failures under an
evaluator that was never updated to match. The regression is in the contract, not the model.

## 6. Failure attribution

The headline numbers are dominated by rubric drift, not by extraction quality. The two causes are
separated below, and neither was resolved by adjusting a rule.

### 6.1 Evaluator and golden are inconsistent with the rules PR #11 locked

**Finding A — rule 23 decomposition is scored as fabrication (7 of 8 criticals).**

Rule 23 requires a separate agreement term for each separately named, independently operative
component and forbids collapsing them. The narrative separately names a homepage, about page,
services page, contact page, and mobile-responsive layout. The model emitted them as five `scope`
terms. The golden retains one consolidated `term_scope`. Seven surplus terms were labelled
`unsupported_extra_object` — "fabrication hard failure".

They are not fabrications. `term_01_homepage` through `term_04_contact_page` cite the golden's own
span, character-for-character:

```text
start_char 579, end_char 708
"The original job was a homepage, about page, services page, contact page, and
 mobile-responsive layout, with two revision rounds."
```

Source-span overlap with the golden term is **1.00**. The objects are branded fabrication because
of two evaluator mechanics, both in `src/evaluation/person-a-diff-corrected.ts`:

- `isMatchedGranularitySplit` additionally requires semantic similarity ≥ 0.45. A decomposed
  fragment ("The original job included a homepage.") scores 0.28–0.32 against the full consolidated
  sentence, so the granularity path never fires.
- `isSourceGroundedExtra` has no `agreement_terms` branch at all. Every agreement term that misses
  the granularity test therefore falls through to critical, with no source-grounded major tier
  available — the tier that exists for claims, timeline, deliverables, and evidence.

This is the identical mismatch that `person-a-extraction-acceptance.md` already documents for Dry
Runs 002 and 003. That document asserts Dry Run 001 was exempt. **It is not.** The exemption should
never have been case-scoped.

**Finding B — 7 of 9 golden evidence objects are unreachable from the narrative.**

Evidence recall of 0.22 does not measure extraction. The golden Person A projection requires
evidence whose defining details appear nowhere in the Person A narrative:

| Golden object                                | Detail required                                  | Occurrences in narrative |
| -------------------------------------------- | ------------------------------------------------ | ------------------------ |
| `ev_002` deposit invoice and payment receipt | "invoice", "receipt"                             | 0                        |
| `ev_003` WhatsApp export                     | "it may be incomplete because he changed phones" | 0                        |
| `ev_006` design/version history export       | "version history"                                | 0                        |
| `ev_008` June 8 mobile recording             | "recording"                                      | 0                        |
| `ev_009` two unrecorded video calls          | "video call"                                     | 0                        |

Those strings occur only in the full golden case record (`dry_run_001.golden.json`) — not in the
Person A narrative and not in the Person B narrative. The golden was authored from a richer intake
than the input the extractor is given. No golden evidence object carries `source_spans` (0/9),
unlike claims (13/13), timeline (10/10), and agreement terms (8/8), so the gap is invisible to
span-grounding checks.

Prompt rule 27 forbids creating an evidence object without an explicitly described artifact. The
golden penalizes the model for obeying it. The rubric is internally contradictory, and the evidence
family is currently unmeasurable.

**Finding C — `evidence_type` is a hard blocking key over an underdetermined enum.**

Alignment returns `null` on any `evidence_type` mismatch, before similarity is computed, and the
`recoverUniqueEvidenceBlocks` fallback re-applies the same equality test. All seven unmatched
golden evidence objects are type-blocked. The schema enum offers undisambiguated near-synonyms —
`message_export`, `message_history`, `message_screenshot`; `deliverable`, `other` — with no
definitions telling an extractor which to choose. The model chose `message_history` where the
golden chose `message_export`. Both readings are defensible; only one can ever match.

**Finding D — rule 24 compliance is scored as interpretation loss (5 majors).**

Rule 24 requires `person_a_interpretation` to be stated expressly as Person A's position, never as
established fact. The golden encodes the pre-v0.1.4 style:

- golden: `"May 20 was an intended launch dependent on timely content."`
- extracted: `"Alex characterizes May 20 as an intended target that was linked to Maya's timely
delivery of final copy and images."`

The extraction is the rule-compliant form. The evaluator reports "Person A interpretation was lost
or distorted."

### 6.2 Genuine `person-a-v0.1.4` extraction defects

These are real and are not excused by the above.

1. **Rule 25 violated — completion status.** All six deliverable completion positions differ from
   golden, in three distinct ways:
   - `del_02_about`, `del_03_services`, `del_04_contact` emitted as `complete`. Rule 25 states
     explicitly: never upgrade `substantially_complete` to `complete`. The narrative supports
     `substantially_complete` — Alex sent what _he considered_ complete, then "made most of" a
     further list of changes.
   - `del_06_pricing`, `del_07_newsletter` emitted as `unknown` against golden
     `partially_complete`. Rule 25 forbids `unknown` where Person A states a position.
   - `del_05_mobile` emitted as `partially_complete` against golden `substantially_complete` — a
     downgrade, which rule 25 does not name; defensible from "There were some mobile issues" and
     worth a rule decision rather than assuming extraction error.
2. **Rule 25 violated — disputed scope collapsed.** `del_06_pricing` was emitted as `added_later`
   where the narrative shows dispute ("I probably should have documented more clearly which
   requests were outside the original scope"). Golden: `disputed`. 1 major.
3. **Critical recall miss — `cl_a_003`.** The late-content claim ("the last major batch arrived
   around May 8 or May 9") was not emitted as a claim. The narrative states it plainly and rules 22
   and 26 require a relied-upon material assertion to appear as a claim. This is the one critical
   that belongs to extraction.
4. **Recall miss — `cl_a_013`,** the against-interest admission about failing to document scope.
5. **Timeline recall misses** — `tl_content_due`, `tl_instagram_use`, `tl_brief_publication`.

Rules 24 and 27 appear to work as intended. Rule 25 does not yet hold on live output.

## 7. Uncertainty representation

Passed, and this is the strongest part of the run. The model did not guess. It emitted five
extraction issues (missing calendar year, unidentified accepted requests, unprovable publication,
unidentified mobile defects, undated slow period) and six clarification questions split into
`required` and `important`. It recorded the unprovable publication belief as an extraction issue
rather than promoting it to evidence, which is exactly what rule 27 demands.

## 8. Acceptance gate

| Gate condition                                    | Result                                 |
| ------------------------------------------------- | -------------------------------------- |
| Extraction completes from untouched live evidence | pass                                   |
| Output validates against current schema           | pass                                   |
| Every material claim traceable to evidence        | pass — all source spans verified exact |
| Uncertainty represented rather than guessed       | pass                                   |
| No evaluator rule relaxed after seeing the answer | pass — nothing was changed             |
| Complete run reproducible from saved artifacts    | pass — verified byte-identical         |
| Zero critical / zero major                        | **fail — 8 / 53**                      |

**Decision: Reject, and open a narrowly scoped fix PR.**

The rejection is recorded honestly rather than resolved. Accepting with documented limitations was
rejected as an option: 7 of 8 criticals are false fabrication labels and the evidence family is
unmeasurable, so the instrument is mis-calibrated — and there are genuine rule 25 and recall
defects, so the extraction is not passing either. Neither half can be waived.

## 9. Reproducing this run

Artifacts are tracked in [`dry-run-001/`](dry-run-001/): the sanitized extraction, the evaluator
report, the alignment, and a run manifest with byte hashes. Raw Responses payloads, response IDs,
token usage, and credentials are excluded.

Re-evaluation requires no API call and reproduces the report byte-for-byte:

```bash
npm run extract:person-a -- \
  --input src/fixtures/dry_run_001.person_a.txt \
  --submitted-at 2026-07-25T00:00:00Z \
  --extraction docs/dry-run-001/extraction.json \
  --output-dir artifacts/person-a/dry-run-001-replay
```

The extraction is deliberately **not** registered in the acceptance manifest. Its typed origin enum
admits only `historical_saved_output` and `hand_authored_control`; a fresh live run is neither, and
labelling it as either would misrepresent it. Adding a `live_run` origin is fix-PR scope.

## 10. Scope for the fix PR

Ordered by blocking severity. Each must be decided on principle and must not be tuned until this
run passes.

1. **Resolve the rule 23 / consolidated-golden contradiction for Dry Run 001** (Finding A). Either
   the golden decomposes its scope term or rule 23 changes. The prompt-v0.1.4 compatibility
   boundary must be widened to include Dry Run 001, since the exemption is not case-specific.
2. **Give `agreement_terms` a source-grounded major tier** (Finding A). An object quoting the
   golden's own span at 1.00 overlap must never be classifiable as fabrication.
3. **Decide whether the Dry Run 001 golden is derivable from its narrative** (Finding B). Either
   restate the golden to what Person A's narrative supports, or record the evidence family as
   formally unmeasurable and exclude it from acceptance until the intake is aligned.
4. **Disambiguate the `evidence_type` enum and soften the hard block** (Finding C). Define the
   near-synonyms, or treat type as a weighted signal rather than a blocking key.
5. **Re-cut golden `person_a_interpretation` wording into rule 24 form** (Finding D).
6. **Then, separately, address the genuine rule 25 and recall defects** (§6.2) — after the
   measurement contract is trustworthy, never in the same change.

Items 1–5 repair the measurement instrument. Item 6 is the only one that touches extraction
quality, and it cannot be evaluated honestly until 1–5 land.
