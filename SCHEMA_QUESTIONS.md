# Schema Questions and Fail-Closed Decisions

This file records ambiguities encountered while converting Artifact 1 v0.1.1 into executable JSON Schema and a complete golden fixture.

## 1. Support level before evidence inspection

**Question:** Can a claim be labeled strong or moderate before the referenced files are inspected?

**Decision:** Use `not_assessed` for evidence-dependent claims. Narrative-only admissions may still be represented, but the evidence support level remains unassessed until the evidence-review stage.

**Reason:** Prevents evidence descriptions from receiving evidentiary weight.

## 2. Quoted extracts from uninspected screenshots

**Question:** May the record contain an `extract` when the file itself has not been uploaded?

**Decision:** Yes, but only as submitter-described quoted text with `author_status: asserted_by_submitter`. It cannot support a finding until the evidence becomes `inspected`.

**Reason:** The narrative itself contains the quote and attribution, which must be preserved without pretending the underlying screenshot was reviewed.

## 3. Agreement wording derived from two matching narratives

**Question:** Can `wording_status` be `agreed` when the contract is uninspected?

**Decision:** Yes when both parties independently agree on the same term, while `source_evidence_ids` still point to described-only evidence and open issues state that the document is uninspected.

**Reason:** Agreement between parties is a separate source of record content from documentary verification.

## 4. Current-state golden fixture

**Question:** Should the golden fixture model a fictional post-inspection case to exercise all schema fields?

**Decision:** No. It models the actual dry-run stage: both narratives exist, evidence is described or unavailable, clarification is pending, the record is unlocked, deliberation is ineligible, and recommendation is `null`.

**Reason:** Inventing evidence contents would defeat the purpose of the evidence-inspection invariant.

## 5. Evidence lists as source text

**Question:** Are the narrative evidence lists separate submissions with character spans?

**Decision:** No. The two raw party narratives are the canonical verbatim submissions. Evidence-list details are represented as evidence stubs. Fields sourced only from the listed evidence descriptions do not invent narrative spans.

**Reason:** Avoids manufacturing source positions in text that was not part of the raw narrative fixture.

## 6. Financial envelope

**Question:** How is the bidirectional financial envelope derived from ordered alternatives?

**Decision:**

- Person A request from Person B = largest transfer from B to A in Person A’s outcomes.
- Person B request from Person A = largest transfer from A to B in Person B’s outcomes.
- Gross disputed value = sum of those opposed-direction maxima.

The `derived_from_outcome_ids` array must include the outcomes producing those maxima.

## 7. Global ID uniqueness

**Question:** May different object families reuse the same ID string?

**Decision:** No. Custom validation enforces global canonical-ID uniqueness.

**Reason:** Simplifies source links, audit references, clarification links, and future semantic-alignment diagnostics.

## 8. Recommendation example stage

**Question:** Artifact 1 contains a post-inspection recommendation example while Dry Run 001 is pre-inspection.

**Decision:** Recommendation objects require `example_stage: post_inspection`; the golden fixture contains no recommendation.

## 9. Unavailable evidence links

**Question:** May a claim link to evidence that is unavailable?

**Decision:** Yes as a record of what the party says would support the claim, but the link cannot produce a supported finding, completed comparison, or recommendation reliance.

## 10. State machine implementation

**Question:** Should this repository implement transitions or Supabase tables?

**Decision:** No. The current scope is only executable schema, golden fixture, validation, tests, and the future alignment contract.
