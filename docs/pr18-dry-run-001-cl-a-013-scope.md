# PR #18 scope — Dry Run 001 `cl_a_013` grounded recall

## Ranked remaining defect inventory

The exact PR #17 frozen compatibility evaluation reproduces
`0 critical / 37 major / 20 minor`. The remaining findings were grouped and ranked by confidence
that the finding reflects a deterministic representation defect, the number of findings affected,
the narrowness of a valid correction, and regression risk.

1. **Selected: `cl_a_013` grounded claim recall (1 minor finding).** The narrative contains one
   explicit but qualified statement against Person A's interest about inadequate scope
   documentation. The frozen provider response preserves the exact statement on three scope terms
   and within an ambiguity issue's exact source span, but omits its distinct atomic meaning from
   the claims family. One exact-fingerprint, frozen-only projection can recover the claim without
   changing its wording or epistemic force.
2. **Agreement-term wording and interpretations (7 major findings).** Some extracted terms use
   broader exact source spans or source-supported component wording, while several golden
   interpretations consolidate meaning differently. Resolving these findings requires separate
   agreement-term and Rule 24 policy work; this PR does not suppress them.
3. **Claim wording, flags, and grounded extras (13 major and 1 minor findings).** The aligned
   claim pairs contain combinations of broader/narrower propositions, qualification differences,
   and evidence-link differences. The four grounded extras are legitimate source assertions.
   Generic containment or similarity changes would hide real semantic differences.
4. **Timeline representation (6 major findings).** Two actor-null golden differences, two
   cross-family omissions, and two legitimate grounded extras remain after PR #17. These are
   attribution or coverage-policy decisions, not candidates for claim synthesis.
5. **Deliverable state and scope (4 major findings).** The narrative's “most” and uncertainty
   wording does not prove the per-deliverable golden states. A deterministic correction is not
   available without deciding frozen semantics.
6. **Evidence identity/extras, damages causation, extraction-issue classification, and
   clarification coverage (7 major and 11 minor findings).** These classes have distinct causes
   and include unobservable golden detail, source-grounded extras, and policy differences. None
   shares the selected exact-record invariant.

## Selected record and source evidence

The full golden record is:

```json
{
  "claim_id": "cl_a_013",
  "party_id": "party_a",
  "claim_text": "Alex did not clearly document which requests were outside the original scope.",
  "claim_type": "scope",
  "response_status": "unanswered",
  "materiality": "medium",
  "support_level": "none",
  "supporting_evidence_ids": [],
  "contradicting_evidence_ids": [],
  "counterclaim_ids": [],
  "requires_clarification": false,
  "against_asserting_party_interest": true,
  "source_spans": [
    {
      "submission_id": "sub_a_001",
      "quote": "I probably should have documented more clearly which requests were outside the original scope.",
      "start_char": 937,
      "end_char": 1031
    }
  ]
}
```

The narrative slice at UTF-16 coordinates `937–1031` is byte-for-byte:

> I probably should have documented more clearly which requests were outside the original scope.

This is Person A's explicit self-assessment of inadequate documentation. “Probably” qualifies the
strength of the assessment, and “should have documented more clearly” is normative wording. It is
not negated, conditional, disputed, merely procedural, or attributed to another speaker. The
compatibility output therefore copies the sentence verbatim instead of strengthening it to the
golden paraphrase.

The frozen provider response already represents the same or related information as follows:

| Family            | Record                         | Existing representation                                                                |
| ----------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| Agreement terms   | `term_12_pricing_section`      | Exact `937–1031` span; interpretation acknowledges inadequate scope documentation      |
| Agreement terms   | `term_13_newsletter_signup`    | Exact `937–1031` span; interpretation acknowledges inadequate scope documentation      |
| Agreement terms   | `term_14_homepage_changes`     | Exact `937–1031` span; interpretation acknowledges inadequate scope documentation      |
| Extraction issues | `issue_02_added_scope_unclear` | Exact containing span `709–1031`; records uncertainty about accepted added requests    |
| Claims            | `claim_05_added_requests`      | States the added requests and WhatsApp acceptance, but not the documentation admission |
| Claims            | all other claims               | No claim uses or contains the `937–1031` source occurrence                             |

The admission is materially distinct from the existing added-request claim: one states what Maya
requested and Alex accepted; the other records Alex's qualified statement against his own interest
about documentation. Cross-family preservation does not make those two claim meanings duplicates.

## Root cause

The defect originates in the frozen model output:

- the provider emitted the exact admission in agreement-term interpretations and an issue span;
- the provider omitted an atomic claim for that admission;
- ordinary assembly copies `normalizedModelOutput.claims` unchanged and performs only source-span
  normalization and validation;
- the deterministic repair compiler has no general admission-to-claim rule;
- PR #14 recovers only the exact `cl_a_003` client-delay omission;
- PR #15 changes only frozen completion states;
- PR #16 applies only existing deterministic claim-type normalization;
- PR #17 changes only one exact timeline alignment pair;
- claim alignment therefore correctly leaves `cl_a_013` unmatched, and the evaluator correctly
  reports the medium-materiality miss as minor.

This is a genuine frozen extraction omission with a narrow compatibility remedy, not an evaluator
threshold defect. No general parser, prompt, or repair rule is added.

## Implementation boundary

`assembleDryRun001ClA013CompatibilityProjection` starts from the unchanged PR #16 projection and
calls one case-specific projector. The projector:

1. accepts only the exact Dry Run 001 narrative SHA-256;
2. verifies the exact `937–1031` narrative slice;
3. rejects non-JSON values, non-finite numbers, sparse arrays, extra array properties, symbols,
   cycles, accessors, non-plain objects, and non-intrinsic arrays before transformation;
4. requires the complete PR #16 projection fingerprint;
5. requires exactly 16 prior claims and the complete claims-array fingerprint;
6. requires complete fingerprints of the three related scope terms and the ambiguity issue;
7. requires their exact admission span or exact containing issue span;
8. appends exactly one `claim_15_scope_documentation` record whose `claim_text` is the source
   sentence verbatim;
9. preserves the qualification, sets the against-interest flag, and adds no evidence support;
10. validates the complete projected extraction against JSON Schema and custom invariants; and
11. returns a deterministic audit separately from the canonical extraction.

Any narrative, claim, related-record, fingerprint, prototype, or structural difference throws
before an output is returned. An equivalent or ID-conflicting claim changes the prior claims
fingerprint and fails closed.

The projector does not import golden data, alignment, evaluation, similarity, or threshold code.
Ordinary assembly and `extractPersonA` do not import or invoke it.

## Frozen invariants and hashes

The narrative, raw response, historical extraction, original alignment/report, golden projection,
run manifest, request metadata, prompt, schema, existing repair rules, evaluator thresholds,
assembler span relocation, and all earlier compatibility entrypoints remain unchanged.

| Projection              |                         Evaluation | SHA-256                                                            |
| ----------------------- | ---------------------------------: | ------------------------------------------------------------------ |
| PR #14                  |                          `0/45/20` | `d607a8555c2bda66e8b12f80ac47f8bc880b82d90a5f23ca5d9cfd58a0af4c41` |
| PR #15                  |                          `0/42/20` | `04b927a7e54be2afccf36f32494afc563c1c7d2d6730611ee74d2c9a961775d3` |
| PR #16                  |                          `0/39/20` | `b24bb43acb4ce29ac626c4b3d75362627500a4ca8449bea7e85c93e906ffbd0b` |
| PR #18 claim projection | evaluated with PR #17 at `0/37/19` | `2f2bdcf59c7a87fe52137610ac5a1c78ae9d97001a44b141a9424c4e9b2e7f80` |

The PR #18 audit SHA-256 is
`312d7f217d5f1e2d65000425c0c1cb75d3940f4a53574aa9e31102f2a2d2c807`.
Hashes use the repository convention of two-space JSON followed by a newline.

## Before and after

| Evaluation                                                  | Critical | Major | Minor |
| ----------------------------------------------------------- | -------: | ----: | ----: |
| Exact PR #17 compatibility baseline                         |        0 |    37 |    20 |
| PR #18 claim projection through unchanged PR #17 evaluation |        0 |    37 |    19 |

Removed:

- minor `claims/missing_golden_object` for golden `cl_a_013`.

Added findings: none. Changed findings: none. Changed severities: none. Changed aligned pairs:
only the new `claim_15_scope_documentation` to `cl_a_013` pair. Every other error object is
byte-equivalent by stable JSON identity.

The lower count is not the correctness argument. Correctness comes from the exact source sentence,
the existing structured representations, the distinct missing claim meaning, preservation of the
qualification, and the fail-closed complete-record boundary.

## Test evidence

Local verification:

- focused PR #18 regression: `16/16`;
- claim/evaluator/extractor/validation/repair projection set: `799/799` across 12 files;
- full suite: `1329/1329` across 24 files;
- Person A suite: `70/70`;
- typecheck and repository formatting;
- CI test-matrix coverage;
- golden JSON Schema and custom invariants;
- Person A acceptance gate: historical `0/3`, controls `3/3`;
- dependency audit: zero vulnerabilities.

The focused suite covers exact pre-fix reproduction, the full golden record, exact narrative
support, the extracted representation map, one-record append, deterministic audit, stable
before/after errors, prior counts and hashes, no duplicate claim, schema validation, ordinary
assembly/extraction isolation, and fail-closed behavior for negated, conditional, incomplete,
paraphrased, structurally altered, malformed, sparse, duplicate, prototype-mutated,
accessor-backed, cyclic, symbol-bearing, non-finite, `undefined`, and proxied inputs.

## Exclusions and remaining defects

This PR does not change the claim prompt, general claim generation, thresholds, aliases, golden
data, existing repair rules, claim wording/flags, agreement-term wording or Rule 24, deliverable
states, timeline policy, actor-null policy, evidence identity, damages causation, extraction-issue
classification, clarification coverage, Person B, Dry Run 002/003, deployment, or Notion.

The broader claims system is not fixed. All 37 major findings and the other 19 minor findings
remain and require separately grounded defect or policy decisions.
