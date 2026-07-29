# PR #23 Dry Run 002 outcome action-order adjudication

## Decision

**Classification B — golden-policy defect.**

The source supports a requested USD 900 payment from Priya (`party_b`) to Jordan (`party_a`)
**after Jordan delivers the last two chairs**. The frozen model record preserves that direction
and ordering before and after assembly. The golden reverses the dependency by requiring Jordan to
deliver the chairs **after payment**.

The two records must remain unmatched in this PR. Aligning them would erase an identity-bearing
ordering conflict. The golden is not edited here, and no extraction, normalization, assembly,
alignment, evaluation, prompt, schema, threshold, or acceptance behavior changes.

The recommended next step is one coordinated golden/policy migration PR. That PR must decide how
the outcome schema and annotation policy represent a party's requested payment when the party's
own delivery is a temporal precondition, then correct the golden and any affected controls
together.

## Locked repository and replay provenance

| Item                             | Locked evidence                                                    |
| -------------------------------- | ------------------------------------------------------------------ |
| Remote                           | `https://github.com/coconutbeaches/juryai.git`                     |
| Authoritative base               | `f6f03c3f680a033a6b44e03fd2edb78cde07eb19`                         |
| Base tree / reviewed PR #22 tree | `c7a00653b1098632296a622920f86e74bc5627d4`                         |
| Squash parent                    | `e38184bd1debe938b2ce9e733160d4f6413e9035`                         |
| PR #22 state                     | merged                                                             |
| Post-merge CI                    | run `30446473000`, completed successfully, 27/27 jobs              |
| Live source repository SHA       | `c081c1e10427f11125a43976f74d1ce076d4a19c`                         |
| Raw response SHA-256             | `b6156e7754e28ee5ec9f3a5fa3ca89209b1f9d185b9aff76ba8c246ee5f4f171` |
| Request metadata SHA-256         | `798e6cdff6f4462cd57c2d7234f16abb1681b5aa17cd343b505eda127cbb1469` |
| Replayed extraction SHA-256      | `496ce4938cc04ae65a72efc611e839158dfe7e5ee053d27dc21de96c77a8d076` |
| Replay provider calls / retries  | `0 / 0`                                                            |

The provenance harness requires replay at the live source repository SHA. The raw response was
therefore replayed at detached `c081c1e...`; its byte-identical extraction was then passed to the
locked `f6f03c3...` alignment and evaluator. This is the only truthful way to combine the
source-bound raw replay with PR #22's deterministic alignment behavior. No credential was read and
no provider client or provider route was invoked.

The locked PR #22 result was reproduced:

| Artifact   | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| Alignment  | `391fd68260a3d8a78848c69d91a9c256c5d8ce041d47e7bed232b2c2b2af1fcb` |
| Evaluation | `1945cbc8599156dd15d3c31c0596bf99b6c9d6ef9e5604b33a57c33f79f3d5f7` |

The evaluation is `7 critical / 15 major / 14 minor / 36 total`.

## Exact source and records

The only narrative text quoted in this document is the target passage already approved for this
diagnostic:

> I am asking Priya to pay the remaining $900 after I deliver the last two chairs; I am not asking to refund her.

It is the exact UTF-16 slice `S5 [514,625)`.

### Frozen raw model outcome

The `output_text` JSON in the frozen provider response contains:

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

Its stable JSON SHA-256 is
`df2f03992d7e26ad48df83f0f4aa56e92c56b0001afd0b3c7a6e153c26051c73`.

### Assembled extracted outcome

The assembled `outcome_payment_1` is field-for-field identical to the raw model outcome. Its stable
JSON SHA-256 is also
`df2f03992d7e26ad48df83f0f4aa56e92c56b0001afd0b3c7a6e153c26051c73`.

### Golden outcome

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

### Same-source structured evidence

| Representation                       | Exact relevant meaning                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Extracted `term_payment_trigger_1`   | Remaining USD 900 is due after delivery; interpretation says Priya pays after Jordan delivers the last two chairs. |
| Extracted `claim_payment_term_1`     | USD 900 upfront and remaining USD 900 due after delivery.                                                          |
| Extracted `claim_balance_1`          | Jordan seeks the remaining USD 900 after delivering the last two chairs; exact S5 span.                            |
| Extracted `claim_no_refund_1`        | Jordan is not seeking to refund Priya; exact S5 span.                                                              |
| Extracted `damages_unpaid_balance_1` | USD 900 remains payable after Jordan delivers the last two chairs.                                                 |
| Extracted `issue_delivery_trigger_1` | The balance is due after delivery, but the contractual delivery milestone needs clarification; exact S5 span.      |
| Extracted `deliverable_1`            | Four chairs were collected and two remained to be finished.                                                        |
| Extracted `event_collection_1`       | Priya collected four chairs while Jordan kept two to finish.                                                       |
| Golden `term_dry_run_002`            | USD 900 paid upfront and USD 900 due after delivery.                                                               |
| Golden `tl_002_collection`           | Priya collected four chairs while Jordan retained two to finish.                                                   |
| Golden `cl_002_remedy`               | Verbatim S5 passage: payment after Jordan delivers the last two chairs.                                            |
| Golden `dam_dry_run_002`             | USD 900 unpaid balance, sourced from `cl_002_remedy`.                                                              |

Every related representation supports delivery before payment or, at minimum, payment conditional
on delivery. Only `out_dry_run_002.required_actions` says payment before delivery.

No tied evidence record, timeline event, or deliverable says the last two chairs are delivered only
after payment. The source does not support that interpretation.

## Action decomposition

Let:

- `D` = Jordan delivers the last two chairs.
- `P` = Priya pays Jordan the remaining USD 900.
- `R` = Jordan refunds Priya.

The source says:

1. requested transfer: `P`, from `party_b` to `party_a`, USD 900;
2. temporal condition: `D` precedes `P` (`D → P`);
3. explicit negation: no requested `R`.

The extracted outcome says `D → P` and `¬R`.

The golden outcome says `P → D` and therefore reverses the only explicit temporal relation.

This is not a harmless array-order or wording difference. The alignment contract ignores ordinary
array order, but it requires comparison of outcome required actions and treats a conditional
outcome flattened into an unconditional demand as major. Here the prose inside the required action
encodes opposite conditions.

## Transformation trace

1. **Provider response parsing.** The harness decodes the frozen raw bytes, locates the message
   `output_text`, parses its JSON, and returns the model object. The target record at this stage is
   the raw model outcome shown above.
2. **Assembly clone.** `assemblePersonAExtraction` takes a `structuredClone` of the model object.
3. **Source-span normalization.** Assembly rewrites source-span submission IDs and repairs uniquely
   locatable exact span offsets. Outcome records have no source-span field, so neither operation
   traverses or changes the target outcome.
4. **Root assembly.** Assembly adds the canonical party, submission, extractor, and metadata
   wrappers and assigns `normalizedModelOutput.desired_outcomes` directly.
5. **Schema and invariant validation.** The assembled record validates. Validation does not mutate
   it.
6. **Base outcome alignment.** Outcome candidates are hard-blocked unless `outcome_type` and first
   transfer direction are equal. This pair is blocked by `mixed` versus `payment` before its score
   can be used. Ignoring only that block yields `0.6150381198747963`, but that score cannot prove
   action equivalence.
7. **Corrected alignment recoveries.** The actor-reversal recovery applies to timeline events.
   Outcome transfer-reversal recovery requires equal outcome type, reversed transfer direction,
   equal amount, and semantic support; it does not apply here. PR #22's structured monetary
   compatibility recovery is damages-only and intentionally leaves this pair untouched.
8. **Evaluation.** Because there is no outcome pair, field comparison never runs. The evaluator
   emits one critical `missing_golden_object` and one critical `unsupported_extra_object`.

No deterministic stage reverses, flattens, or changes the extracted ordering. Classification A is
therefore rejected.

## Alignment identity and diagnostic behavior

Current outcome candidate identity uses:

- exact `outcome_type`;
- exact first-transfer direction;
- amount similarity;
- semantic similarity of all joined `required_actions`;
- rationale similarity;
- the `0.55` outcome threshold; and
- one-to-one assignment.

The current evaluator compares transfer direction, first-transfer amount, and priority after
alignment. It does **not** emit a required-action or action-order field diagnostic after alignment.
The generic semantic score is bag-like and is not an ordered-action graph.

Action order is identity-bearing for this pair because reversing `D → P` to `P → D` changes when
each obligation must occur and who bears first-performance risk. Equal amount, currency, parties,
priority, and source span do not make those obligations equivalent.

The unmatched state is therefore correct for the records as they exist. The two finding messages
are not precise: the golden payment objective was not wholly omitted, and the extracted payment
objective is source-grounded rather than fabricated. They obscure the golden's reversed order.
That is a real diagnostic limitation, but it is not repaired here because:

- the authoritative golden itself is source-inconsistent;
- the schema has no explicit condition or action-edge field;
- repository policy does not define when a self-performed payment condition makes an outcome
  `mixed` rather than `payment`; and
- adding a generic action-order parser or diagnostic pairing seam without that policy would be
  speculative and could change unrelated alignments or suppress risk.

This diagnostic limitation should be reconsidered only after the coordinated golden/policy
migration establishes a canonical representation.

## Schema and outcome-type adjudication

The outcome schema stores:

- an `outcome_type` enum;
- transfers;
- an array of free-text `required_actions`; and
- free-text rationale.

It has no explicit representation for prerequisites, temporal edges, conditions, alternative
branches, or negated actions. Although prose can preserve “after delivery,” the structure cannot
losslessly compare ordered or conditional multi-action outcomes. Array position is not a general
evaluation signal; only outcome priority is documented as ordered.

`mixed` versus `payment` is **not** an assembly artifact: the raw model emitted `mixed`, and assembly
preserved it. It is not proven to be a true semantic distinction either. The source asks for one
payment; Jordan's own delivery is its precondition, and “no refund” negates another remedy rather
than requests an additional action. `payment` is therefore a plausible primary type. The raw
model's `mixed` label reflects multiple represented actions under a schema and annotation policy
that do not state how to type conditional self-performance.

Accordingly, the type disagreement is best classified as a schema-limited annotation-policy
decision. The ordering disagreement is independent and dispositive: even if both records used
`payment`, the golden action would still contradict the source.

## Source interpretation

The passage supports **delivery first, then payment** as the temporal relation. More precisely, it
is a requested payment with delivery as a source-stated precondition. It does not support payment
first, then delivery. It is not merely an unordered exchange because “after I deliver” supplies a
strict relative order, even though the passage does not establish that either future action has
actually occurred.

## Rejected alternatives

### A. Extraction or assembly defect

Rejected. The raw model outcome and assembled outcome have the same fields and stable SHA-256.
Every linked extracted representation agrees with the source. No transformation touches the
outcome ordering.

### C. Legitimate non-equivalence

Rejected as the root-cause classification. The records are materially non-equivalent and must
remain unmatched, but this is not a case where two source-supported alternatives legitimately
differ. The golden's payment-before-delivery action is unsupported.

### D. Evaluator or alignment diagnostic defect

Rejected as the primary classification. The missing/extra labels are imprecise and the evaluator
lacks action-order visibility, but a diagnostic repair cannot make the golden source-grounded.
Implementing a new pairing or parser before policy adjudication would expand this PR beyond the
proven defect.

## Change and finding manifest

This PR changes one adjudication document and adds one test-only positive control. Production
behavior is unchanged.

| Item                    | Before                                                             | After               |
| ----------------------- | ------------------------------------------------------------------ | ------------------- |
| Outcome alignment pairs | none                                                               | none                |
| `outcome_payment_1`     | unmatched extracted                                                | unmatched extracted |
| `out_dry_run_002`       | unmatched golden                                                   | unmatched golden    |
| Target findings         | 2 critical missing/extra findings                                  | unchanged           |
| Full evaluation         | 7 critical / 15 major / 14 minor / 36 total                        | unchanged           |
| Alignment SHA-256       | `391fd68260a3d8a78848c69d91a9c256c5d8ce041d47e7bed232b2c2b2af1fcb` | unchanged           |
| Evaluation SHA-256      | `1945cbc8599156dd15d3c31c0596bf99b6c9d6ef9e5604b33a57c33f79f3d5f7` | unchanged           |
| Runtime behavior        | unchanged                                                          | unchanged           |

No finding disappears, appears, changes severity, changes record assignment, changes diagnostic
field, or changes ordering.

The tracked Dry Run 001 tree remains `572289fe56db78245efdefb43ce214b77cf5b566`.

## Existing regression coverage

PR #22's `person-a-monetary-identity-compatibility.test.ts` already locks:

- the exact extracted and golden outcome records;
- delivery-before-payment versus payment-before-delivery;
- equal USD 900 amount and transfer direction with reversed action order;
- `mixed` versus `payment`;
- deposit versus balance, refund versus payment, and unrelated same-amount records;
- mismatched currency and amount, approximate and ranged amounts;
- malformed, absent, and non-exact source spans;
- competing duplicates;
- proxies, accessors, stateful getters, non-plain objects, and sparse arrays;
- preservation of the full unmatched outcome difference without mutation; and
- no activation under the locked acceptance contract.

PR #23 adds one test-only positive control proving that harmless wording variation still aligns
when both records preserve the same conditional delivery-before-payment order. The adjacent
alignment and evaluator suites cover transfer/actor reversal, one-to-one assignment, ambiguity,
and unrelated finding preservation. The alignment contract documents a conditional outcome
flattened into an unconditional demand as a major error. Because this PR adds no executable
diagnostic or repair, it does not introduce a new structured-record traversal requiring a duplicate
adversarial test surface.

## Remaining risks

- The golden remains source-inconsistent until a coordinated migration changes it.
- `mixed` versus `payment` remains policy-ambiguous.
- The schema cannot represent or compare action prerequisites losslessly.
- The current missing/extra messages overstate recall/fabrication rather than naming the
  action-order conflict.
- A future generic order diagnostic could produce false equivalence if it relies on lexical
  overlap, array position, or matching monetary fields.

## Recommended next PR

Create one **coordinated golden/policy migration** PR. It should define the canonical representation
for payment conditional on the requesting party's own delivery, correct
`out_dry_run_002.required_actions` to preserve `D → P`, adjudicate `payment` versus `mixed`, update
affected controls together, and only then decide whether a field-specific non-alignment diagnostic
is still required.
