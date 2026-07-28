# PR #16 scope — Dry Run 001 deterministic claim-type normalization

## Ranked remaining defect inventory

1. **Selected: deterministic claim-type normalization gap (3 major findings).**
   `claim_02_payment_terms` is `payment` instead of `agreement_term`;
   `claim_04_content_dependency` and `claim_13_delay_causation` are `client_delay` instead of
   `delay`. The evaluator reports `claims/claim_type` for `cl_a_001`, `cl_a_002`, and `cl_a_012`.
   All three exact-source mappings already exist in the audited
   `deterministic_claim_type_normalization` repair rule, but the PR #15 frozen projection bypasses
   deterministic record repair. This is a projection/repair integration defect shared by all
   three failures and does not require new parsing or changed frozen semantics.
2. **Timeline representation and alignment (8 major findings).** `event_01_agreement` and
   `event_04_major_batch` have actor-specificity differences; `tl_content_due`,
   `tl_instagram_use`, and `tl_brief_publication` are unmatched; `event_02_content_deadline`,
   `event_03_content_late`, and `event_08_changes_made` are unmatched extras. Some source facts are
   already represented in other families, and the terse `tl_content_due` golden is contained in
   a broader extracted event. Correcting this class would require separate timeline-coverage and
   alignment-policy work.
3. **Remaining deliverable state differences (4 major findings).** `del_05_mobile` completion,
   both completion and scope for `del_06_pricing`, and `del_07_newsletter` completion differ from
   their goldens. The narrative applies “most” and scope uncertainty across several requests, but
   the golden assigns different per-item states. A correction would require resolving those
   frozen semantic distinctions first.
4. **Other evaluator/golden differences.** Agreement-term wording and Rule 24 interpretation,
   claim wording/flags, evidence identity and grounded extras, damages causation, extraction-issue
   type, and clarification coverage remain reported. They do not share the selected repair root
   cause and several are documented policy or representation disagreements.
5. **`cl_a_013` recall (1 minor finding).** The documentation admission is present in exact source
   spans on structured scope terms and an ambiguity issue but absent from claims. Recovering it
   would require a new claim-synthesis/parser direction, which is explicitly excluded from this
   PR.

## Selected defect class and concrete failures

The selected class is failure to apply the existing deterministic claim-type normalization to the
explicit frozen projection:

| Extracted ID                  | Golden ID  | Current        | Expected         | Exact repair invariant                                                             |
| ----------------------------- | ---------- | -------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `claim_02_payment_terms`      | `cl_a_001` | `payment`      | `agreement_term` | source contains deposit, balance due, and completion; claim states deposit and due |
| `claim_04_content_dependency` | `cl_a_002` | `client_delay` | `delay`          | source states the timeline dependency and April 25                                 |
| `claim_13_delay_causation`    | `cl_a_012` | `client_delay` | `delay`          | source states schedule delay and late content                                      |

The PR #15 projection reproduces `0 critical / 42 major / 20 minor`. Applying the existing repair
compiler produces exactly three audited changes, all under
`deterministic_claim_type_normalization`, and evaluates at
`0 critical / 39 major / 20 minor` with no added finding.

## Expected files

- `src/extraction/person-a-frozen-compatibility.ts`
- `src/tests/person-a-deterministic-claim-type-projection.test.ts`
- `.github/workflows/ci.yml`
- this scope note

## Invariants

- PR #14 remains `0/45/20` and byte-identical at its locked projection hash.
- PR #15 remains `0/42/20` and byte-identical at its locked projection hash.
- Ordinary assembly and fresh extraction remain unchanged.
- Frozen narrative, raw response, historical extraction, alignment, report, golden projection,
  manifest, prompt, evaluator, thresholds, and span relocation remain unchanged.
- Only the existing repair rule may be applied; any other applied repair fails closed.
- Raw provider output, prior projections, audited repair output, and evaluated projection remain
  distinguishable and deterministic.

## Exclusions

No parser extension, new normalization phrase, new repair rule, prompt rewrite, golden change,
evaluator change, Rule 24 change, evidence-policy change, span-relocation change, Person B work,
Dry Run 002/003 work, `cl_a_013` recovery, deliverable-state change, timeline change, speculative
hardening, deployment, or Notion update.
