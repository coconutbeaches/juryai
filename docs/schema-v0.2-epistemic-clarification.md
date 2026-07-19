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

The pure generator ranks questions by:

1. materiality;
2. weakness type;
3. number of objects resolved by one answer;
4. stable lexical key for deterministic output.

Every round is capped at six questions. The cap is an invariant, not a UI suggestion.

## Clarification phases

### Pre-lock

Person A completes the primary clarification round before Person B is invited. The confirmed Person A record is then locked as the clean baseline.

### Post-lock amendment

Later contradictions, new evidence, or material facts append an amendment containing:

- amendment ID;
- target object and field;
- prior and new value;
- verbatim clarification response;
- timestamp;
- phase;
- superseded amendment ID when applicable.

The effective record can project the latest value, but the original object remains unchanged.

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

## Prototype

The initial pure-function prototype lives in:

```text
src/clarification/question-generator.ts
```

It does not call a model and does not modify the v0.1.2 extraction schema. This allows offline validation before deciding whether the candidate enums become required canonical v0.2 fields.
