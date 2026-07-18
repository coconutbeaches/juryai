# JuryAI Semantic Alignment Contract

## Purpose

This contract defines how a future automated extraction output is compared with the manually authored golden record.

> Extracted and golden objects must not be aligned by generated ID, array order, or exact prose.

A recursive JSON diff is useful only after semantically corresponding objects have been aligned. Using it before alignment will produce mostly noise because model-generated IDs, ordering, and wording are not stable.

## Comparison pipeline

1. Validate both records against the same canonical schema and custom invariants.
2. Normalize only comparison-safe surface differences:
   - Unicode normalization
   - whitespace
   - case where semantically irrelevant
   - currency formatting
   - stable date representation
3. Generate candidates using deterministic blocking attributes.
4. Score candidate pairs using semantic and structured features.
5. Perform one-to-one assignment within each object family.
6. Mark ambiguous matches rather than forcing an alignment.
7. Compare fields only after alignment.
8. Classify mismatches as critical, major, or minor.
9. Report unmatched golden objects as possible recall failures.
10. Report unmatched extracted objects as possible hallucinations or over-segmentation.

## General matching rules

- IDs are opaque and never contribute to similarity.
- Array order is ignored unless the field is explicitly ordered, such as outcome priority.
- Exact prose match is neither required nor sufficient.
- Party identity, object type, direction of transfer, and date overlap are high-value blocking features.
- A candidate blocked out by deterministic rules cannot be rescued by broad semantic similarity unless the block itself is marked uncertain.
- One extracted object may not satisfy multiple golden objects without an explicit split/merge finding.
- One golden object may not absorb multiple extracted objects without an explicit split/merge finding.
- Low-confidence or tied alignments are reported as ambiguous and require review.

## Similarity and assignment

Recommended starting approach:

1. Compute deterministic feature agreement.
2. Compute semantic similarity over normalized meaning fields.
3. Combine them into a family-specific score.
4. Reject pairs below a family threshold.
5. Use maximum-weight bipartite matching for one-to-one assignment.
6. Require a minimum margin between the best and second-best candidate. A close tie is ambiguous.

Initial thresholds must be calibrated on golden fixtures rather than treated as universal constants. Store the threshold configuration and alignment version with every regression result.

## Claims

### Candidate blocking

Required blocking attributes:

- asserting party
- claim type, or a documented compatible-type mapping

Optional narrowing attributes:

- referenced deliverable
- direction of payment
- named counterparty

### Semantic inputs

- claim meaning
- subject
- asserted action or omission
- amount or range
- referenced deliverable
- referenced agreement term
- approximate date or period

### Comparison after alignment

- party
- type
- response status
- materiality
- support level
- supporting and contradicting evidence relationships
- counterclaim relationships
- clarification requirement
- against-interest flag
- source trace coverage

A paraphrase is acceptable. Reversing who did what is critical.

## Timeline events

### Candidate blocking

- actor, including unknown actor
- overlapping date or range

When the date is unknown, use event family and semantic action as the block and lower alignment confidence.

### Semantic inputs

- occurrence meaning
- affected deliverable
- communication or transaction type
- related claims
- related evidence

### Comparison after alignment

- date start and end
- precision
- approximate flag
- occurrence status
- interpretation status
- each party’s interpretation
- actor
- materiality

Flattening an approximate range into an exact date is a major error. Merging occurrence with one party’s interpretation can be critical when it changes the record’s neutrality.

## Evidence

### Candidate blocking

- submitter
- evidence type
- source system when known

### Semantic inputs

- title
- submitter description
- approximate creation date
- quoted extract
- provenance
- referenced event or claim

### Comparison after alignment

- availability status
- completeness status
- authenticity status
- visibility
- source-system provenance
- author versus submitter
- author status
- limitations
- extract text

Treating described-only evidence as inspected evidence is critical. Treating the submitter as the quoted speaker is critical when the quoted statement is material.

## Agreement terms

### Candidate blocking

- term type

### Semantic inputs

- wording
- subject matter
- party interpretations
- source evidence

### Comparison after alignment

- wording status
- interpretation status
- each party’s interpretation
- materiality
- source trace

Collapsing agreed wording and disputed interpretation is a critical epistemic error.

## Deliverable assessments

### Candidate blocking

- normalized deliverable name or scope identity

### Semantic inputs

- claimed completion
- alleged defects
- use status
- repair attempts
- related scope terms

### Comparison after alignment

- scope status
- each party’s completion position
- use status
- defects
- repair attempts
- materiality

## Damages claims

### Candidate blocking

- asserting party
- loss type

### Semantic inputs

- amount or range
- causal theory
- calculation basis
- related claim

### Comparison after alignment

- amount minimum and maximum
- currency
- causation theory
- calculation status
- support level
- clarification requirement

Inventing a precise amount from a vague estimate is major or critical depending on whether it affects the remedy.

## Requested outcomes

### Candidate blocking

- requesting party
- outcome type
- transfer direction

### Semantic inputs

- amount
- required actions
- priority
- rationale

### Comparison after alignment

- transfer from/to parties
- amount
- currency
- ordered priority
- required actions

A reversed transfer direction is critical. A different generated outcome ID is irrelevant.

## Third parties

### Semantic inputs

- normalized name or label
- role
- relationship to party
- associated event or evidence

Third parties may be aligned without exact names when one or both records use role labels such as “client’s assistant.”

## Evidence-to-evidence relationships

Align relationship objects only after their endpoint evidence objects have been aligned.

Compare:

- relationship type
- comparison status
- explanation meaning

Marking a comparison complete while an endpoint remains uninspected is critical and should already fail custom validation.

## Error classification

### Critical

Examples:

- invented material claim
- missed material claim that could change the outcome
- claim promoted to agreed fact without basis
- party or transfer direction reversed
- described or unavailable evidence treated as inspected
- occurrence and interpretation collapsed in a way that favors a party
- speaker identity incorrectly asserted as verified
- private settlement information introduced
- recommendation eligibility incorrectly allowed

### Major

Examples:

- material date range flattened
- against-interest admission dropped
- material evidence relationship missed
- contested agreement term omitted
- damages amount or causal theory materially distorted
- conditional outcome flattened into one unconditional demand
- decision-relevant third party omitted

### Minor

Examples:

- harmless wording difference
- low-materiality event omitted
- nonmaterial ordering difference
- equivalent category choice under a documented compatibility map
- stylistic summary variance

## Alignment output contract

Every run should produce:

- aligned pairs with scores and reasons
- ambiguous candidate sets
- unmatched golden objects
- unmatched extracted objects
- field-level differences after alignment
- error classification
- aggregate recall and precision by object family
- configuration version
- schema version
- extractor model and prompt version
- raw-input hash
- golden-fixture hash

## What is explicitly prohibited

- matching primarily by generated ID
- matching by array index
- exact-string equality as the primary matcher
- declaring success because the JSON is structurally valid
- silently forcing low-confidence alignments
- scoring all field differences equally
- using a single overall percentage without object-family diagnostics
