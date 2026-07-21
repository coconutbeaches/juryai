# JuryAI schema v0.2 candidate: epistemic status and deterministic clarification

## Objective

Keep the first intake conversational while making every follow-up question deterministic, auditable, cheap, and regression-testable.

The first extraction pass is not required to manufacture a final perfect record. It must capture grounded facts, preserve uncertainty, and expose genuine epistemic gaps. A pure post-processing module then ranks at most six clarification questions.

## Design principles

1. Use categorical epistemic states, not floating-point confidence scores.
2. Ask the human only when the testimony itself lacks or ambiguously states a material fact.
3. Never ask the human to resolve JuryAI schema bookkeeping.
4. Generate no more than six questions per clarification round.
5. Lock Person A's confirmed record before inviting Person B.
6. After lock, preserve the original record and append amendments rather than mutating history.
7. Add expected clarification triggers to golden fixtures so question generation joins the regression gate.

## Candidate categorical fields

These fields are candidates for canonical schema v0.2. The current prototype keeps them in a sidecar `EpistemicAssessment` so PR #4 can validate the architecture without changing the v0.1.2 record contract.

### Actor attribution

```text
explicit | inferred | unstated
```

- `explicit`: the source directly identifies the actor.
- `inferred`: the actor is a reasonable inference but not directly stated.
- `unstated`: no actor can be attributed from the source.

This distinguishes a genuine party reversal from a null-versus-specified granularity difference.

### Causal link status

```text
explicit | inferred | disputed | unstated
```

- `explicit`: the party directly asserts the causal relationship.
- `inferred`: the relationship is plausible but not directly asserted.
- `disputed`: the source expressly contests the relationship.
- `unstated`: no causal relationship is supplied.

### Merge risk

```text
none | possible_merge | possible_split
```

This records when separately named deliverables, evidence artifacts, claims, or events may have been merged or split incorrectly.

## Trigger taxonomy

Runtime clarification triggers and evaluation errors should share one taxonomy wherever possible.

Human-question triggers:

- `actor_attribution`
- `causal_link`
- `merge_risk`
- `evidence_availability`
- `date_precision`
- `required_bucket_missing`

Non-question trigger:

- `internal_representation`

`internal_representation` covers deterministic bookkeeping such as duplicating a material agreement dependency into the claims family. These issues must be fixed in code or deterministic post-processing and must never become user questions.

## Ranking and budget

The pure generator validates every assessment before ranking questions by:

1. materiality;
2. weakness type;
3. number of objects resolved by one answer;
4. stable lexical key for deterministic output.

Every round is capped at six questions. The cap is an invariant, not a UI suggestion.

Questions are deduplicated by target object and field, not by wording or trigger.
When two triggers describe the same gap, the higher-ranked candidate wins using
the same materiality, weakness, coverage, and stable lexical ordering. The
ordering does not depend on input order or locale-sensitive sorting.

Every question-producing assessment supplies a short `question_context` value.
The generator accepts only bounded plain text and inserts it into
trigger-specific deterministic copy. It does not accept caller-authored
question text. This prevents empty, internal, or misleading hints from
bypassing the deterministic templates and gives the user enough context to
answer the question. The context itself must be derived from grounded testimony
or verified record fields; the sidecar does not infer or embellish it.

`unavailable` evidence does not generate a possession question. A question is
generated only for `described_only` or `unknown` availability.

## Clarification phases

### Pre-lock

Person A completes the primary clarification round before Person B is invited. The confirmed Person A record is then locked as the clean baseline.

Question phases are `pre_lock` and `post_lock`. Amendment records use the
separate literal `post_lock_amendment`; a question can never be mistaken for
an applied amendment.

### Post-lock amendment

Later contradictions, new evidence, or material facts append an amendment containing:

- amendment ID;
- target object and field;
- prior and new value;
- verbatim clarification response;
- timestamp;
- phase;
- superseded amendment ID when applicable.

The effective record can project the latest value, but the original object
remains unchanged. Projection consumes the complete append-only amendment log
for one object and returns:

- the projected copy;
- applied amendment audit entries;
- explicitly ignored entries for other objects;
- rejected entries with stable reason codes.

An amendment applies only when its ID is unique, its phase and timestamp are
valid, its top-level field exists and is mutable, its `prior_value` matches the
current projection, and its `supersedes` pointer names the latest applied
amendment for the same field. Malformed, stale, duplicate, cyclic, or
contradictory chains fail closed and remain visible in the rejection report.
The projection API does not silently repair an invalid audit trail.

## Golden-fixture extension

Future golden fixtures should add expected clarification triggers, for example:

```json
{
  "target_object_id": "tl_photo_delivery",
  "field": "actor_party_id",
  "trigger": "actor_attribution",
  "materiality": "high"
}
```

Regression tests should verify:

- required questions are generated;
- questions are not generated when the source is explicit;
- internal representation issues never become questions;
- duplicates collapse to one question;
- material questions outrank minor questions;
- no round exceeds six questions;
- append-only amendments preserve the original record.
- stale or malformed amendments are reported rather than applied;
- supersession chains remain consistent and auditable.

## Prototype

The initial pure-function prototype lives in:

```text
src/clarification/question-generator.ts
```

It does not call a model and does not modify the v0.1.2 extraction schema. This allows offline validation before deciding whether the candidate enums become required canonical v0.2 fields.

The sidecar is not wired into extraction or user-facing runtime flow. Its
assessment inputs and amendment log are still prototype contracts; durable
storage, authorization, record locking, and integration with extracted case
objects remain future work.
