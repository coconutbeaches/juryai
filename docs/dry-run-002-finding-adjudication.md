# Dry Run 002 finding adjudication

Status: **read-only adjudication complete**. This document does not change extraction,
normalization, assembly, alignment, evaluation, prompts, schemas, goldens, replay, provenance, or
CI behavior.

## Locked base and reproduced baseline

The repository gate passed before this branch was created:

| Gate            | Observed                                       |
| --------------- | ---------------------------------------------- |
| origin          | `https://github.com/coconutbeaches/juryai.git` |
| starting branch | `main`                                         |
| local `HEAD`    | `c081c1e10427f11125a43976f74d1ce076d4a19c`     |
| `origin/main`   | `c081c1e10427f11125a43976f74d1ce076d4a19c`     |
| ahead / behind  | `0 / 0`                                        |
| worktree        | clean                                          |

The completed live run was made from that clean `main` SHA. It requested `gpt-5.6` at medium
reasoning effort with `store: false`; the served model was `gpt-5.6-sol`. The run manifest records
one provider call, zero retries, no manual edits, successful validation, and a completed response.

The frozen response was replayed offline on this branch. Replay made zero provider calls and
reproduced byte-identical derived artifacts:

| Artifact   | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| validation | `d3adea256203aaa11bba6b0b151a3b6659e2ed4031878c615b9474884dd733df` |
| extraction | `496ce4938cc04ae65a72efc611e839158dfe7e5ee053d27dc21de96c77a8d076` |
| alignment  | `888da6ccd55ce012fec72f42c8a020c70b69ef31003b809ff9e2e3a6360b1eff` |
| evaluation | `32080c0c21b67a4d04e3561e39ede60c7c09b59cfc4b872dc2bd78fe2e121330` |

The authoritative evaluation therefore remains exactly:

| Critical | Major | Minor | Total |
| -------: | ----: | ----: | ----: |
|        8 |    15 |    14 |    37 |

The raw provider response was inspected locally only to exclude an assembler origin. Assembly made
the expected envelope conversion and rewrote 22 source-span submission IDs; it did not change any
finding-bearing term, timeline, claim, evidence, deliverable, damage, outcome, issue, or question
meaning. The raw response and all replay artifacts remain ignored and are not committed.

## Source-span ledger

All five extraction spans passed exact JavaScript UTF-16 slice validation. Short quotes are
included because every classification below must be source-grounded; the full narrative is not
duplicated here.

| Label | Exact span   | Quoted source text                                                                                                                               |
| ----- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1    | `[58, 200)`  | `On about March 12, 2026, I agreed with Priya Nair to restore six dining chairs for $1,800, with $900 paid upfront and $900 due after delivery.` |
| S2    | `[201, 300)` | `Priya messaged, “They look ready for the hotel lobby,” but said one cushion still needed stitching.`                                            |
| S3    | `[301, 378)` | `Around April 2, 2026, Priya collected four chairs while I kept two to finish.`                                                                  |
| S4    | `[379, 513)` | `Priya later alleged that I scratched all six chairs, but I only observed a mark on one chair and I have not inspected her photographs.`         |
| S5    | `[514, 625)` | `I am asking Priya to pay the remaining $900 after I deliver the last two chairs; I am not asking to refund her.`                                |

## Classification summary

Each evaluation finding receives exactly one allowed classification.

| Classification                    | Findings |
| --------------------------------- | -------: |
| Genuine extraction defect         |        0 |
| Genuine normalization defect      |        0 |
| Genuine assembler defect          |        0 |
| Alignment defect                  |        4 |
| Evaluator defect                  |        0 |
| Golden policy disagreement        |       16 |
| Legitimate grounded extra         |       17 |
| Unsupported model hallucination   |        0 |
| Ambiguous — insufficient evidence |        0 |
| **Total**                         |   **37** |

“Golden policy disagreement” means that the hand-authored v0.1.3 control chooses a different
representation policy from the live v0.1.4 instructions. It does not mean that the frozen golden
should be edited in this PR. “Legitimate grounded extra” means the object is supported by an exact
source slice but the golden does not contain a separately alignable object in that family.

## Finding inventory

The JSON references point to the exact finding-relevant projections in the evidence ledger below.
`null` means that the relevant family has no separate object; a cross-family representation is
identified where one exists.

| Finding                                                                          | Severity | Classification             | Confidence | Source span | Root cause                                                                                                                                                                                                           | Recommended action                                                                                |
| -------------------------------------------------------------------------------- | -------- | -------------------------- | ---------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `agreement_terms/term_wording/term_scope_1→term_dry_run_002`                     | major    | Golden policy disagreement | High       | S1          | E-AGR splits scope from G-AGR’s consolidated term, as prompt rule 23 requires. Comparing the component wording to the whole sentence is not an extraction error.                                                     | Preserve baseline; include in any coordinated v0.1.4 control migration.                           |
| `agreement_terms/party_interpretation/term_scope_1→term_dry_run_002`             | major    | Golden policy disagreement | High       | S1          | Prompt rule 24 requires a separately represented neutral scope component to keep `person_a_interpretation: null`; G-AGR carries a consolidated restatement.                                                          | Preserve baseline; decide the golden interpretation policy before migration.                      |
| `agreement_terms/unsupported_extra_object/term_price_1`                          | critical | Legitimate grounded extra  | High       | S1          | Exact `$1,800` price component required by rule 23; G-AGR contains it only inside one `scope` object.                                                                                                                | Do not change extraction; migrate the control contract only as a coordinated policy change.       |
| `agreement_terms/agreement_term_decomposition/term_deposit_1`                    | minor    | Legitimate grounded extra  | High       | S1          | Exact `$900 paid upfront` component required by rule 23.                                                                                                                                                             | No extraction fix.                                                                                |
| `agreement_terms/agreement_term_decomposition/term_payment_trigger_1`            | minor    | Legitimate grounded extra  | High       | S1, S5      | Exact `$900 due after delivery` component, plus Jordan’s asserted consequence, required by rules 23–24.                                                                                                              | No extraction fix.                                                                                |
| `deliverables/unsupported_extra_object/deliverable_1`                            | critical | Legitimate grounded extra  | High       | S1–S4       | E-DEL represents the expressly named chair-restoration deliverable and its partial state; the golden family is empty. Its critical severity results because evaluator grounding depends on an already-aligned claim. | Do not remove it; consider evaluator severity policy only after the control contract is settled.  |
| `timeline/actor_specificity/event_agreement_1→tl_002_agreement`                  | major    | Golden policy disagreement | High       | S1          | An agreement is bilateral. E-TL leaves the single actor null while G-TL assigns `party_a`; both retain `asserted_by_party_ids: ["party_a"]`.                                                                         | Decide bilateral-event actor policy; do not force a model change from this control alone.         |
| `timeline/source_grounded_extra_object/event_message_1`                          | major    | Legitimate grounded extra  | High       | S2          | The message is an explicit material occurrence; the golden represents it only as a claim and evidence extract.                                                                                                       | No extraction fix.                                                                                |
| `timeline/source_grounded_extra_object/event_scratch_allegation_1`               | major    | Legitimate grounded extra  | High       | S4          | The later allegation is an explicit material occurrence; the golden represents it only as a claim.                                                                                                                   | No extraction fix.                                                                                |
| `claims/claim_meaning_distorted/claim_balance_1→cl_002_remedy`                   | major    | Golden policy disagreement | High       | S5          | E-CL isolates the positive payment request; G-CL-REMEDY combines payment and no-refund positions.                                                                                                                    | Set claim granularity policy before changing either side.                                         |
| `claims/claim_type/claim_message_1→cl_002_quote`                                 | major    | Golden policy disagreement | Medium     | S2          | The mixed message both suggests readiness and identifies unfinished stitching. `communication` and golden `acceptance` are defensible taxonomy choices; the prompt does not resolve the tie.                         | Define claim-type policy; do not tune the prompt from one control.                                |
| `claims/claim_meaning_distorted/claim_mark_1→cl_002_allegation`                  | major    | Golden policy disagreement | High       | S4          | E-CL separates Priya’s six-chair allegation from Jordan’s one-mark observation; G-CL-ALLEGATION combines them.                                                                                                       | Preserve epistemic separation unless a coordinated claim-granularity policy says otherwise.       |
| `claims/against_interest_flag/claim_mark_1→cl_002_allegation`                    | major    | Golden policy disagreement | High       | S4          | Jordan’s observation of a mark is an admission against Jordan’s interest under prompt rule 11; the combined golden claim is flagged false.                                                                           | Retain the extracted flag; revise policy only through a control migration.                        |
| `claims/unsupported_extra_object/claim_scope_1`                                  | critical | Legitimate grounded extra  | High       | S1          | The asserted scope is exact-source-grounded and materially relied on; the golden carries it only as an agreement term.                                                                                               | No extraction fix.                                                                                |
| `claims/unsupported_extra_object/claim_payment_term_1`                           | critical | Legitimate grounded extra  | High       | S1, S5      | The asserted payment trigger is relied on for entitlement and rules 22/26 require a claim as well as a term.                                                                                                         | No extraction fix.                                                                                |
| `claims/granularity_split/claim_cushion_1`                                       | major    | Legitimate grounded extra  | High       | S2          | The unfinished cushion is a distinct, against-interest completion assertion within the broad golden quote claim.                                                                                                     | No extraction fix.                                                                                |
| `claims/source_grounded_extra_object/claim_partial_completion_1`                 | major    | Legitimate grounded extra  | High       | S3          | Four collected and two retained to finish is an explicit, material completion admission; the golden carries it only as timeline content.                                                                             | No extraction fix.                                                                                |
| `claims/granularity_split/claim_scratch_allegation_1`                            | major    | Legitimate grounded extra  | High       | S4          | Separating Priya’s allegation from Jordan’s own observation preserves speaker and epistemic force.                                                                                                                   | No extraction fix.                                                                                |
| `claims/unsupported_extra_object/claim_no_refund_1`                              | critical | Legitimate grounded extra  | Medium     | S5          | The no-refund position is explicit and appears inside G-CL-REMEDY, but its separate representation is not governed by a claim-granularity rule.                                                                      | Decide whether negative remedy positions are independent claims before changing extraction.       |
| `evidence/evidence_identity/evidence_message_1→ev_dry_run_002`                   | major    | Golden policy disagreement | High       | S2, S4      | Prompt rules 23/27 require one object per artifact. E-EV splits the message from photographs; G-EV aggregates both under one title.                                                                                  | Keep the split; coordinate any golden/evaluator migration.                                        |
| `evidence/source_grounded_extra_object/evidence_photos_1`                        | major    | Legitimate grounded extra  | High       | S4          | Photographs are an explicitly described separate artifact and remain uninspected.                                                                                                                                    | No extraction fix.                                                                                |
| `damages/missing_golden_object/dam_dry_run_002`                                  | major    | Alignment defect           | High       | S5          | E-DAM and G-DAM have the same party, loss type, USD 900 range, and calculation status. Lexical causation/basis similarity yields `0.4237`, below the `0.55` gate.                                                    | PR #22: recover exact structured monetary identity, then compare fields.                          |
| `damages/unsupported_extra_object/damages_unpaid_balance_1`                      | critical | Alignment defect           | High       | S5          | Same failed pair as the preceding finding; this is not a second damage or a hallucination.                                                                                                                           | PR #22: replace the false missing/extra pair with a field-specific causal-theory diagnostic.      |
| `outcomes/missing_golden_object/out_dry_run_002`                                 | critical | Alignment defect           | High       | S5          | E-OUT and G-OUT share party, priority, transfer direction, USD 900 amount, and payment objective. Exact `outcome_type` equality blocks comparison (`mixed` versus `payment`).                                        | PR #22: recover same-transfer outcome identity and surface the type/policy difference explicitly. |
| `outcomes/unsupported_extra_object/outcome_payment_1`                            | critical | Alignment defect           | High       | S5          | Same failed pair as the preceding finding; ignoring the type gate gives a `0.6150` score, above the `0.55` outcome threshold.                                                                                        | PR #22: replace the false missing/extra pair with a paired outcome-type diagnostic.               |
| `extraction_issues/unmatched_extracted_object/issue_agreement_form_1`            | minor    | Legitimate grounded extra  | High       | S1          | The narrative does not state the agreement form or identify a terms artifact; the golden issues family is empty.                                                                                                     | No extraction fix.                                                                                |
| `extraction_issues/unmatched_extracted_object/issue_delivery_trigger_1`          | minor    | Legitimate grounded extra  | High       | S1, S5      | “After delivery” is not expressly defined as all six versus the final two; the golden issues family is empty.                                                                                                        | No extraction fix.                                                                                |
| `extraction_issues/unmatched_extracted_object/issue_completion_1`                | minor    | Legitimate grounded extra  | High       | S2, S3      | Current completion/delivery status is unstated; the golden issues family is empty.                                                                                                                                   | No extraction fix.                                                                                |
| `extraction_issues/unmatched_extracted_object/issue_photos_1`                    | minor    | Legitimate grounded extra  | High       | S4          | Jordan has not inspected the photographs, so their contents cannot be assessed; the golden issues family is empty.                                                                                                   | No extraction fix.                                                                                |
| `clarification_questions/missing_golden_object/q_dry_run_002_1`                  | minor    | Golden policy disagreement | High       | S2          | G-Q is a synthetic placeholder, not a material natural-language expectation. E-Q asks for the message date and complete thread.                                                                                      | Replace placeholders only in a coordinated control-fixture migration.                             |
| `clarification_questions/missing_golden_object/q_dry_run_002_2`                  | minor    | Golden policy disagreement | High       | S4          | G-Q is a synthetic placeholder. E-Q asks about the observed mark and photograph availability.                                                                                                                        | Replace placeholders only in a coordinated control-fixture migration.                             |
| `clarification_questions/missing_golden_object/q_dry_run_002_3`                  | minor    | Golden policy disagreement | High       | S5          | G-Q is a synthetic placeholder. E-Q asks about the ambiguous delivery trigger and current completion.                                                                                                                | Replace placeholders only in a coordinated control-fixture migration.                             |
| `clarification_questions/unmatched_extracted_object/question_agreement_form_1`   | minor    | Golden policy disagreement | High       | S1          | Material v0.1.4 question cannot semantically align to a synthetic placeholder.                                                                                                                                       | No extraction fix.                                                                                |
| `clarification_questions/unmatched_extracted_object/question_delivery_trigger_1` | minor    | Golden policy disagreement | High       | S1, S5      | Material v0.1.4 question cannot semantically align to a synthetic placeholder.                                                                                                                                       | No extraction fix.                                                                                |
| `clarification_questions/unmatched_extracted_object/question_completion_1`       | minor    | Golden policy disagreement | High       | S2, S3      | Material v0.1.4 question cannot semantically align to a synthetic placeholder.                                                                                                                                       | No extraction fix.                                                                                |
| `clarification_questions/unmatched_extracted_object/question_defects_1`          | minor    | Golden policy disagreement | High       | S4          | Material v0.1.4 question cannot semantically align to a synthetic placeholder.                                                                                                                                       | No extraction fix.                                                                                |
| `clarification_questions/unmatched_extracted_object/question_message_1`          | minor    | Golden policy disagreement | High       | S2          | Material v0.1.4 question cannot semantically align to a synthetic placeholder.                                                                                                                                       | No extraction fix.                                                                                |

## Exact JSON evidence ledger

These are exact JSON projections from the frozen extraction and tracked golden. The projections
retain the IDs and every field needed to establish the diagnosed semantic difference; omitted
fields are identical or not relevant to the finding. Coordinate-only `source_span` and
`source_spans` values are adjudication annotations copied exactly from the corresponding objects;
all other displayed keys and values are exact artifact fields. An empty array is the exact
family-level golden value.

### Agreement terms — E-AGR and G-AGR

Extracted:

```json
[
  {
    "term_id": "term_scope_1",
    "term_type": "scope",
    "wording": "Restore six dining chairs.",
    "person_a_interpretation": null,
    "source_span": [58, 200]
  },
  {
    "term_id": "term_price_1",
    "term_type": "price",
    "wording": "The total price was $1,800.",
    "person_a_interpretation": null,
    "source_span": [58, 200]
  },
  {
    "term_id": "term_deposit_1",
    "term_type": "deposit",
    "wording": "$900 was paid upfront.",
    "person_a_interpretation": null,
    "source_span": [58, 200]
  },
  {
    "term_id": "term_payment_trigger_1",
    "term_type": "payment_trigger",
    "wording": "The remaining $900 was due after delivery.",
    "person_a_interpretation": "Jordan's position is that Priya must pay the remaining $900 after Jordan delivers the last two chairs.",
    "source_spans": [
      [58, 200],
      [514, 625]
    ]
  }
]
```

Golden:

```json
[
  {
    "term_id": "term_dry_run_002",
    "term_type": "scope",
    "wording": "On about March 12, 2026, I agreed with Priya Nair to restore six dining chairs for $1,800, with $900 paid upfront and $900 due after delivery.",
    "person_a_interpretation": "On about March 12, 2026, I agreed with Priya Nair to restore six dining chairs for $1,800, with $900 paid upfront and $900 due after delivery.",
    "source_span": [58, 200]
  }
]
```

### Deliverables — E-DEL and G-DEL

Extracted:

```json
[
  {
    "deliverable_id": "deliverable_1",
    "name": "Restoration of six dining chairs",
    "scope_status": "included",
    "completion_status_person_a": "partially_complete",
    "completion_status_person_b": "unknown",
    "alleged_defects": [
      "Priya allegedly claimed that all six chairs were scratched.",
      "Jordan observed a mark on one chair.",
      "One cushion still needed stitching."
    ],
    "repair_attempts": ["Jordan kept two chairs to finish them."]
  }
]
```

Golden:

```json
[]
```

### Timeline — E-TL and G-TL

Extracted:

```json
[
  {
    "event_id": "event_agreement_1",
    "actor_party_id": null,
    "asserted_by_party_ids": ["party_a"],
    "event_summary": "On about March 12, 2026, Jordan says Jordan and Priya agreed to restoration of six dining chairs for $1,800, with $900 upfront and $900 due after delivery.",
    "source_span": [58, 200]
  },
  {
    "event_id": "event_message_1",
    "actor_party_id": "party_b",
    "asserted_by_party_ids": ["party_a"],
    "event_summary": "Priya messaged that the chairs looked ready for the hotel lobby but said one cushion still needed stitching.",
    "source_span": [201, 300]
  },
  {
    "event_id": "event_scratch_allegation_1",
    "actor_party_id": "party_b",
    "asserted_by_party_ids": ["party_a"],
    "event_summary": "After the collection, Priya allegedly claimed that Jordan scratched all six chairs; Jordan says Jordan observed only a mark on one chair and has not inspected Priya's photographs.",
    "source_span": [379, 513]
  }
]
```

Golden:

```json
[
  {
    "event_id": "tl_002_agreement",
    "actor_party_id": "party_a",
    "asserted_by_party_ids": ["party_a"],
    "event_summary": "On about March 12, 2026, I agreed with Priya Nair to restore six dining chairs for $1,800, with $900 paid upfront and $900 due after delivery.",
    "source_span": [58, 200]
  }
]
```

The golden timeline contains no separate message or scratch-allegation event.

### Claims — E-CL and G-CL

Extracted:

```json
[
  {
    "claim_id": "claim_scope_1",
    "claim_type": "scope",
    "claim_text": "Jordan asserts that the agreed scope was restoration of six dining chairs for $1,800.",
    "against_asserting_party_interest": false,
    "source_span": [58, 200]
  },
  {
    "claim_id": "claim_payment_term_1",
    "claim_type": "payment",
    "claim_text": "Jordan asserts that $900 was paid upfront and the remaining $900 is due after delivery.",
    "against_asserting_party_interest": false,
    "source_span": [58, 200]
  },
  {
    "claim_id": "claim_message_1",
    "claim_type": "communication",
    "claim_text": "Jordan reports that Priya messaged, “They look ready for the hotel lobby,” while also saying one cushion still needed stitching.",
    "against_asserting_party_interest": false,
    "source_span": [201, 300]
  },
  {
    "claim_id": "claim_cushion_1",
    "claim_type": "completion",
    "claim_text": "Jordan acknowledges that one cushion still needed stitching when Priya sent the described message.",
    "against_asserting_party_interest": true,
    "source_span": [201, 300]
  },
  {
    "claim_id": "claim_partial_completion_1",
    "claim_type": "completion",
    "claim_text": "Jordan asserts that Priya collected four chairs around April 2, 2026, while Jordan retained two chairs to finish.",
    "against_asserting_party_interest": true,
    "source_span": [301, 378]
  },
  {
    "claim_id": "claim_scratch_allegation_1",
    "claim_type": "defect",
    "claim_text": "Jordan reports that Priya later alleged Jordan had scratched all six chairs.",
    "against_asserting_party_interest": false,
    "source_span": [379, 513]
  },
  {
    "claim_id": "claim_mark_1",
    "claim_type": "defect",
    "claim_text": "Jordan says Jordan observed a mark on one chair, rather than scratches on all six chairs.",
    "against_asserting_party_interest": true,
    "source_span": [379, 513]
  },
  {
    "claim_id": "claim_balance_1",
    "claim_type": "payment",
    "claim_text": "Jordan seeks payment of the remaining $900 after delivering the last two chairs.",
    "against_asserting_party_interest": false,
    "source_span": [514, 625]
  },
  {
    "claim_id": "claim_no_refund_1",
    "claim_type": "refund",
    "claim_text": "Jordan is not seeking to refund Priya.",
    "against_asserting_party_interest": false,
    "source_span": [514, 625]
  }
]
```

Golden:

```json
[
  {
    "claim_id": "cl_002_quote",
    "claim_type": "acceptance",
    "claim_text": "Priya messaged, “They look ready for the hotel lobby,” but said one cushion still needed stitching.",
    "against_asserting_party_interest": false,
    "source_span": [201, 300]
  },
  {
    "claim_id": "cl_002_allegation",
    "claim_type": "defect",
    "claim_text": "Priya later alleged that I scratched all six chairs, but I only observed a mark on one chair and I have not inspected her photographs.",
    "against_asserting_party_interest": false,
    "source_span": [379, 513]
  },
  {
    "claim_id": "cl_002_remedy",
    "claim_type": "payment",
    "claim_text": "I am asking Priya to pay the remaining $900 after I deliver the last two chairs; I am not asking to refund her.",
    "against_asserting_party_interest": false,
    "source_span": [514, 625]
  }
]
```

The golden claims family contains no separate scope, payment-term, partial-completion, cushion,
scratch-allegation, mark-observation, or no-refund object beyond the consolidated records above.

### Evidence — E-EV and G-EV

Extracted:

```json
[
  {
    "evidence_id": "evidence_message_1",
    "evidence_type": "message_export",
    "title": "Priya's message about the chairs and cushion",
    "availability_status": "described_only",
    "description_from_submitter": "Jordan describes a message from Priya stating, “They look ready for the hotel lobby,” and saying that one cushion still needed stitching.",
    "completeness_status": "fragment"
  },
  {
    "evidence_id": "evidence_photos_1",
    "evidence_type": "other",
    "title": "Priya's photographs concerning the chairs",
    "availability_status": "described_only",
    "description_from_submitter": "Jordan says Priya has photographs associated with her allegation that all six chairs were scratched, but Jordan has not inspected them.",
    "completeness_status": "unavailable"
  }
]
```

Golden:

```json
[
  {
    "evidence_id": "ev_dry_run_002",
    "evidence_type": "message_export",
    "title": "Described message and photographs",
    "availability_status": "described_only",
    "description_from_submitter": "Jordan describes a message from Priya and photographs that Jordan has not inspected.",
    "completeness_status": "appears_complete"
  }
]
```

### Damages — E-DAM and G-DAM

Extracted:

```json
{
  "damages_claim_id": "damages_unpaid_balance_1",
  "party_id": "party_a",
  "loss_type": "unpaid_balance",
  "amount_min": 900,
  "amount_max": 900,
  "currency": "USD",
  "causal_theory": "Jordan asserts that $900 remains payable under the agreement after Jordan delivers the last two chairs.",
  "calculation_basis": "$1,800 total price minus the asserted $900 upfront payment equals a $900 remaining balance.",
  "calculation_status": "partially_documented",
  "support_level": "none",
  "requires_clarification": true
}
```

Golden:

```json
{
  "damages_claim_id": "dam_dry_run_002",
  "party_id": "party_a",
  "loss_type": "unpaid_balance",
  "amount_min": 900,
  "amount_max": 900,
  "currency": "USD",
  "causal_theory": "The project was completed or substantially completed, triggering the remaining balance.",
  "calculation_basis": "Person A requests 900 USD.",
  "calculation_status": "partially_documented",
  "support_level": "not_assessed",
  "requires_clarification": true
}
```

Both objects derive from S5. The exact damage alignment score is `0.4237076922733582`; the current
threshold is `0.55`.

### Outcomes — E-OUT and G-OUT

Extracted:

```json
{
  "outcome_id": "outcome_payment_1",
  "priority": 1,
  "outcome_type": "mixed",
  "transfers": [
    {
      "from_party_id": "party_b",
      "to_party_id": "party_a",
      "amount": 900,
      "currency": "USD"
    }
  ],
  "required_actions": [
    "Jordan delivers the last two chairs.",
    "Priya pays Jordan the remaining $900 after delivery.",
    "No refund is made by Jordan."
  ],
  "rationale": "Jordan seeks the asserted remaining contract balance after delivering the last two chairs and expressly states that no refund is sought."
}
```

Golden:

```json
{
  "outcome_id": "out_dry_run_002",
  "priority": 1,
  "outcome_type": "payment",
  "transfers": [
    {
      "from_party_id": "party_b",
      "to_party_id": "party_a",
      "amount": 900,
      "currency": "USD"
    }
  ],
  "required_actions": ["Jordan delivers the final two chairs after payment."],
  "rationale": "Jordan requests the unpaid balance and does not request a refund."
}
```

Both objects derive from S5 and represent the same requested transfer. Exact outcome-type equality
currently blocks alignment. If the type gate alone is ignored, the existing scorer yields
`0.6150381198747963`, above the `0.55` threshold. The paired representation still has a real
`mixed` versus `payment` policy difference, and the golden action order (“after payment”) differs
from the source’s “pay ... after I deliver”; those differences should be surfaced after identity
recovery, not expressed as two fabricated objects.

### Extraction issues — E-ISS and G-ISS

Extracted:

```json
[
  {
    "issue_id": "issue_agreement_form_1",
    "issue_type": "missing_evidence",
    "description": "Jordan asserts an agreement but does not state whether it was oral, written, or made through messages, and no artifact establishing its terms is identified.",
    "source_span": [58, 200]
  },
  {
    "issue_id": "issue_delivery_trigger_1",
    "issue_type": "ambiguous_scope",
    "description": "The narrative says the remaining balance was due after delivery and that Jordan seeks payment after delivering the last two chairs, but it does not expressly define the contractual delivery milestone.",
    "source_span": [514, 625]
  },
  {
    "issue_id": "issue_completion_1",
    "issue_type": "missing_evidence",
    "description": "Jordan says two chairs were retained to finish but does not state whether they have since been completed, offered for delivery, or delivered.",
    "source_span": [301, 378]
  },
  {
    "issue_id": "issue_photos_1",
    "issue_type": "missing_evidence",
    "description": "Priya's photographs have not been inspected, so the alleged condition of the six chairs and the relationship between the photographs and Jordan's observation of one mark cannot be assessed.",
    "source_span": [379, 513]
  }
]
```

Golden:

```json
[]
```

### Clarification questions — E-Q and G-Q

Extracted:

```json
[
  {
    "question_id": "question_agreement_form_1",
    "priority": "required",
    "question": "Was the chair-restoration agreement oral, written, or made through messages, and do you have any contract, message, invoice, or payment record showing the scope, price, upfront payment, and payment trigger?",
    "source_basis": ["S1"]
  },
  {
    "question_id": "question_delivery_trigger_1",
    "priority": "required",
    "question": "What did “$900 due after delivery” mean under your agreement: delivery of all six chairs, delivery of the final two chairs, or another milestone?",
    "source_basis": ["S1", "S5"]
  },
  {
    "question_id": "question_completion_1",
    "priority": "required",
    "question": "Have the final two chairs and the cushion stitching now been completed, offered for delivery, or delivered? If so, on what date?",
    "source_basis": ["S2", "S3"]
  },
  {
    "question_id": "question_defects_1",
    "priority": "important",
    "question": "Which chair had the mark you observed, when did you observe it, and have Priya's photographs since been provided to you or made available for inspection?",
    "source_basis": ["S4"]
  },
  {
    "question_id": "question_message_1",
    "priority": "important",
    "question": "When did Priya send the quoted message, and do you have the complete message thread with visible sender, recipient, and timestamp information?",
    "source_basis": ["S2"]
  }
]
```

`source_basis` is an adjudication annotation; all other displayed values are exact extraction
fields. Golden:

```json
[
  {
    "question_id": "q_dry_run_002_1",
    "priority": "required",
    "question": "Synthetic clarification 1 for dry_run_002.",
    "reason": "The synthetic acceptance fixture preserves an explicit unresolved detail.",
    "linked_object_ids": ["cl_002_quote"]
  },
  {
    "question_id": "q_dry_run_002_2",
    "priority": "required",
    "question": "Synthetic clarification 2 for dry_run_002.",
    "reason": "The synthetic acceptance fixture preserves an explicit unresolved detail.",
    "linked_object_ids": ["cl_002_allegation"]
  },
  {
    "question_id": "q_dry_run_002_3",
    "priority": "required",
    "question": "Synthetic clarification 3 for dry_run_002.",
    "reason": "The synthetic acceptance fixture preserves an explicit unresolved detail.",
    "linked_object_ids": ["cl_002_remedy"]
  }
]
```

## Cluster report

| Cluster                 | Findings explained | Adjudication                                                                                                                                                                                                                                 |
| ----------------------- | -----------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agreement terms         |                  5 | One semantic disagreement: v0.1.4 rule 23 decomposes scope, price, deposit, and payment trigger while the v0.1.3 control keeps one consolidated scope term.                                                                                  |
| Claims                  |                 10 | Four shared decisions: clause decomposition; term-to-claim duplication required by rules 22/26; communication-versus-acceptance taxonomy; and epistemic separation of allegation, observation, admissions, payment, and no-refund positions. |
| Timeline                |                  3 | One bilateral-actor policy difference and two explicit source-grounded events omitted from the golden timeline.                                                                                                                              |
| Evidence                |                  2 | Rule 23 artifact identity: the extraction separates the message and photographs while the golden aggregates them.                                                                                                                            |
| Deliverables            |                  1 | The golden family is empty despite an explicit restoration deliverable and partial completion facts.                                                                                                                                         |
| Damages                 |                  2 | One damage represented twice by a failed lexical alignment gate.                                                                                                                                                                             |
| Outcomes                |                  2 | One requested transfer represented twice because `outcome_type` is a hard identity key.                                                                                                                                                      |
| Extraction issues       |                  4 | Four material uncertainties are source-grounded; the golden issues family is empty.                                                                                                                                                          |
| Clarification questions |                  8 | Five material live questions cannot align to three synthetic control placeholders.                                                                                                                                                           |
| **Total**               |             **37** | No cluster supplies evidence of hallucination or an extraction/normalization/assembler defect.                                                                                                                                               |

## Ranked implementation candidates

| Rank | Candidate                                                                                                                                                                                                                                                                                                                                                                                                                   | Expected findings removed                                                                                                                                                                                            | Regression risk                                                                                              | Complexity | Confidence |
| ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------- | ---------- |
|    1 | **Structured monetary-object identity recovery for damages and outcomes.** Pair a unique damage only when party, loss type, currency, and exact amount/range agree; pair a unique outcome across `payment`/`mixed` only when party, priority, transfer direction, currency, and exact amount agree and ordinary semantic scoring still passes. Add field-specific causal-theory and outcome-type diagnostics after pairing. | Removes the four false unpaired findings (3 critical, 1 major); expected replacements are one damages causal-theory major and one outcome-type major, for a net reduction of 2 without waiving semantic differences. | Low–medium if predicates are exact, unique, and fail closed.                                                 | Medium     | **High**   |
|    2 | Coordinated v0.1.4 control-contract migration for term, claim, evidence, deliverable, timeline, issue, and clarification granularity.                                                                                                                                                                                                                                                                                       | Potentially addresses 33 findings, but the exact number is policy-dependent rather than implementation-proven.                                                                                                       | High: requires golden, evaluator, and acceptance-policy decisions and changes the frozen benchmark contract. | High       | Medium     |
|    3 | General evaluator re-tiering for source-grounded deliverables and cross-family extras.                                                                                                                                                                                                                                                                                                                                      | Removes 0 findings; it would only change severity or diagnostic wording.                                                                                                                                             | Medium: broad grounding predicates can hide real unsupported objects.                                        | Medium     | Medium     |
|    4 | Prompt, extraction, normalization, or assembler changes.                                                                                                                                                                                                                                                                                                                                                                    | 0 evidence-backed findings.                                                                                                                                                                                          | High: would optimize behavior against control-policy mismatches and risk regressions.                        | Unknown    | Low        |

## Recommendation for PR #22

Open exactly one next implementation PR: **structured monetary-object identity recovery for
damages and outcomes**.

PR #22 should be alignment/evaluator-only. It should:

1. reproduce the exact four existing unpaired findings;
2. recover only unique, exact structured identities;
3. keep ordinary semantic scoring as an additional outcome gate;
4. emit a paired damages causal-theory diagnostic instead of a missing/extra pair;
5. emit a paired outcome-type diagnostic instead of a missing/extra pair;
6. prove transfer direction and amount checks remain unchanged;
7. fail closed for amount, currency, party, loss type, priority, direction, multiplicity, or
   semantic-score differences; and
8. leave all other 33 findings byte-equivalent.

This recommendation is not based on score improvement. It is based on deterministic identity:
there is one USD 900 unpaid-balance damage and one party-B-to-party-A USD 900 requested transfer on
each side. The current alignment expresses each as two objects and prevents field-level
adjudication.

No extraction implementation PR is justified by this run. The broader v0.1.4/control mismatch
requires an explicit benchmark-policy decision before any golden, evaluator, or prompt migration.

## Remaining uncertainty

- `communication` versus `acceptance` for the mixed message is under-specified.
- The prompt does not say whether an explicit negative remedy position should be a separate claim,
  so `claim_no_refund_1` is medium-confidence legitimate granularity rather than a proven defect.
- A bilateral agreement event has no documented single-actor convention.
- `mixed` versus `payment` is a real outcome-type policy difference; PR #22 should expose it, not
  silently select one.
- The golden damages causal theory says completion triggered the balance, while S3 and S5 describe
  two chairs still to be finished and payment after delivery. Identity is certain; which causal
  wording the benchmark should require is a later policy adjudication.

## Inert boundary

This PR changes documentation only. It does not commit the raw provider response, extraction,
alignment, validation, evaluation, request metadata, run manifest, narrative, or any generated
replay output. It does not make an API/model call, alter the baseline, or implement PR #22.
