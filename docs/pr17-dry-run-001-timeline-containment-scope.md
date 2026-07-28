# PR #17 scope — Dry Run 001 exact-source timeline containment

## Ranked remaining defect inventory

1. **Selected: terse exact-source timeline containment (2 major findings).**
   `event_02_content_deadline` and `tl_content_due` describe the same actor, occurrence, date
   representation, and April 25 content deadline. The golden summary is the verbatim leaf
   `by April 25.` at `416–428`; the extracted event preserves that leaf inside an exact broader
   source span at `283–428` and repeats both material tokens in its summary. The calibrated
   source-trace recovery nevertheless requires semantic similarity of at least `0.30`; this pair
   scores about `0.252`, so the evaluator reports one false missing plus one false grounded extra.
2. **Unresolved timeline-family coverage (2 major findings).** `tl_instagram_use` and
   `tl_brief_publication` are exact-source facts absent from the extracted timeline, but both are
   represented in `claim_10_use`, and publication uncertainty is also represented in
   `issue_03_publication_unproven`. Whether every such claim must also become a timeline event is a
   cross-family completeness policy decision. This PR does not synthesize records to satisfy the
   golden.
3. **Source-supported actor versus actor-null goldens (2 major findings).**
   `event_01_agreement` attributes Alex's first-person agreement to `party_a`;
   `event_04_major_batch` attributes the client-content delivery to `party_b`. Their aligned
   goldens leave actor null. Removing the extracted actors would discard source-supported
   specificity; globally accepting actor-null differences would hide material attribution
   mistakes.
4. **Legitimate source-grounded extracted extras (2 major findings).**
   `event_03_content_late` records the alleged failure to meet the deadline, which is distinct from
   the deadline itself. `event_08_changes_made` records Alex's later work following feedback, which
   is distinct from the feedback event. Both must remain visible under the evaluator's grounded
   surplus policy.
5. **Remaining non-timeline classes.** Deliverable state and scope semantics, agreement-term
   wording, Rule 24, claim wording and flags, evidence identity, damages causation,
   extraction-issue classification, clarification coverage, and `cl_a_013` recall remain outside
   this PR.

## Exact PR #16 reproduction

The exact frozen raw response was parsed and passed through the unchanged PR #14, PR #15, and
PR #16 projection chain with the calibrated alignment/evaluator contract. No model call occurred.

| Projection | Critical | Major | Minor | SHA-256                                                            |
| ---------- | -------: | ----: | ----: | ------------------------------------------------------------------ |
| PR #14     |        0 |    45 |    20 | `d607a8555c2bda66e8b12f80ac47f8bc880b82d90a5f23ca5d9cfd58a0af4c41` |
| PR #15     |        0 |    42 |    20 | `04b927a7e54be2afccf36f32494afc563c1c7d2d6730611ee74d2c9a961775d3` |
| PR #16     |        0 |    39 |    20 | `b24bb43acb4ce29ac626c4b3d75362627500a4ca8449bea7e85c93e906ffbd0b` |

## Individual timeline audit

All spans below are exact JavaScript UTF-16 slices of
`src/fixtures/dry_run_001.person_a.txt`.

| Evaluator path                                  | Extracted ID                | Golden ID              | Extracted value                                                                        | Golden value                                                   | Exact narrative span(s)                     | Current reason                                                                                                           | Elsewhere / classification                                                                                                                        |
| ----------------------------------------------- | --------------------------- | ---------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeline/actor_specificity` (major)            | `event_01_agreement`        | `tl_agreement`         | actor `party_a`; “In early April ... Alex says he agreed ...”                          | actor null; “In early April I agreed ...”                      | extracted `57–167`; golden `57–119`         | The calibrated actor-reversal recovery aligns the events, then field comparison reports one side null.                   | Price and agreement facts also occur in terms/claims. Source supports the extracted first-person actor; golden-policy disagreement, not selected. |
| `timeline/actor_specificity` (major)            | `event_04_major_batch`      | `tl_photo_delivery`    | actor `party_b`; “last major content batch arrived around May 8 or May 9 ...”          | actor null; terse matching arrival summary                     | extracted `466–577`; golden `466–524`       | Same occurrence aligns by exact source overlap, then actor specificity differs.                                          | `claim_event_04_major_batch_client_delay` contains the occurrence. Source-supported/golden-policy disagreement, not selected.                     |
| `timeline/missing_golden_object` (major)        | —                           | `tl_content_due`       | represented by broader `event_02_content_deadline`                                     | “by April 25.”, actor `party_b`                                | golden `416–428`; extracted event `283–428` | Exact source overlap is `1`, but semantic similarity is about `0.252`, below the `0.30` source-trace recovery threshold. | Terms `term_11_content_dependency` and claim `claim_04_content_dependency` also represent it. Selected alignment defect.                          |
| `timeline/missing_golden_object` (major)        | —                           | `tl_instagram_use`     | no extracted timeline object                                                           | “Maya also used images from the website in social media posts” | `1501–1561`                                 | No timeline candidate exists.                                                                                            | Represented in `claim_10_use`; unresolved extraction-representation/cross-family policy.                                                          |
| `timeline/missing_golden_object` (major)        | —                           | `tl_brief_publication` | no extracted timeline object                                                           | “I believe at least part of the site was briefly published”    | `1567–1624`                                 | No timeline candidate exists.                                                                                            | Represented with uncertainty in `claim_10_use` and `issue_03_publication_unproven`; unresolved extraction-representation/cross-family policy.     |
| `timeline/source_grounded_extra_object` (major) | `event_02_content_deadline` | —                      | “The contract allegedly required Maya to supply final copy and images by April 25 ...” | semantically contained golden `tl_content_due`                 | extracted `283–428`; golden leaf `416–428`  | The same threshold miss that leaves `tl_content_due` unmatched also leaves this grounded extracted event unmatched.      | Selected alignment defect; paired only through exact containment, not fuzzy matching.                                                             |
| `timeline/source_grounded_extra_object` (major) | `event_03_content_late`     | —                      | “Maya did not send everything by the April 25 deadline.”                               | no distinct golden event                                       | `429–465`                                   | Exact-source event has no golden match.                                                                                  | Represented in `claim_04_content_dependency`. Genuine distinct grounded extra; remains reported.                                                  |
| `timeline/source_grounded_extra_object` (major) | `event_08_changes_made`     | —                      | “Alex ... made most of Maya's listed changes during the week following her feedback.”  | no distinct golden event                                       | `1177–1223`                                 | Exact-source event has no golden match.                                                                                  | Represented in `claim_07_feedback_changes`. Genuine distinct grounded extra; remains reported.                                                    |

## Selected invariant and implementation

PR #17 does not lower the timeline threshold, add aliases, mutate the extraction, or change the
existing aligner/evaluator. It adds one explicit compatibility entrypoint over the unchanged PR #16
projection. The entrypoint:

1. starts from the unchanged calibrated PR #16 alignment;
2. considers only unmatched extracted/golden timeline objects;
3. requires identical actor, date, assertion, occurrence, interpretation, and materiality fields;
4. validates both source spans against the exact narrative;
5. requires the golden summary to equal a verbatim golden source leaf strictly nested in an exact
   extracted source span;
6. requires every material golden-summary token to remain in the extracted summary;
7. requires SHA-256 fingerprints of the complete audited PR #16 extracted and golden records,
   including IDs, evidence IDs, every source-span field, and the requirement that each record has
   exactly its one audited span; rejects non-finite numbers, `undefined`, sparse arrays, cycles,
   accessors, proxies, symbols, and other values that JSON serialization would lose;
8. requires exactly one mutually unique candidate and fails closed otherwise;
9. records both complete-record fingerprints, the exact spans, material tokens, IDs, and
   `exact_source_containment` reason;
10. independently re-proves the invariant during evaluation; and
11. rejects the projection if any finding other than the selected missing/extra pair changes.

This is a frozen-representation compatibility projection, not fuzzy matching or a new general
alignment heuristic. Any record-leaf, extra field, span, or offset change fails closed. One
extracted event still cannot satisfy multiple goldens, and one golden still cannot absorb multiple
extracted events.

## Expected files

- `src/alignment/person-a-timeline-containment-compatibility.ts`
- `src/evaluation/person-a-timeline-containment-compatibility.ts`
- `src/tests/person-a-timeline-source-containment.test.ts`
- `.github/workflows/ci.yml`
- this scope note

## Invariants and exclusions

- Narrative, raw response, historical extraction, original alignment/report, golden projection,
  manifest, prompt, schemas, thresholds, aliases, and assembler relocation remain unchanged.
- PR #14 remains `0/45/20`; PR #15 remains `0/42/20`; PR #16 remains `0/39/20`.
- The prior projection hashes above remain byte-identical.
- Ordinary alignment/evaluation, ordinary assembly, and fresh extraction do not invoke PR #17.
- No golden, prompt, model, claim-type rule, completion-state rule, or record is changed.
- Actor differences, legitimate extras, and unresolved cross-family omissions remain reported.
- Deliverables, Rule 24, claims, evidence, damages, issues, clarifications, `cl_a_013`, Person B,
  Dry Run 002/003, deployment, and Notion are excluded.

## Before and after

| Evaluation                               | Critical | Major | Minor |
| ---------------------------------------- | -------: | ----: | ----: |
| PR #16 unchanged                         |        0 |    39 |    20 |
| Explicit PR #17 compatibility evaluation |        0 |    37 |    20 |

Removed:

- major `timeline/missing_golden_object` for `tl_content_due`;
- major `timeline/source_grounded_extra_object` for `event_02_content_deadline`.

Added findings: none. Changed severities: none. Every previously passing comparison remains
unchanged. The other six timeline findings remain.

## Test evidence

The focused regression records the exact pre-fix eight-finding cluster, exact narrative support,
the only two removed findings, no added finding, prior hashes/counts, deterministic output, schema
validation, near-match and ambiguity rejection, actor preservation, legitimate extras, cross-family
exclusions, and ordinary extraction/assembly isolation. The test is registered in the explicit CI
matrix. Local verification passed:

- focused PR #17 regression: `13/13`;
- timeline/evaluator/extractor/validation/repair/projection set: `725/725`;
- full suite: `1313/1313` across 23 files;
- typecheck, formatting, CI matrix coverage, and golden schema/custom validation;
- Person A acceptance gate with historical outputs still `0/3` and controls `3/3`;
- dependency audit with zero vulnerabilities.

## Remaining known defects

The next timeline decision is whether exact-source use/publication claims must also be represented
as timeline events, followed separately by the actor-null golden policy. Neither should be resolved
by suppressing findings. Outside timeline, the ranked PR #16 inventory remains unchanged.
