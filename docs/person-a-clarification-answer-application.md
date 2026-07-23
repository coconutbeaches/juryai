# Person A clarification answer application

This milestone adds a pure, offline boundary for applying answers to clarification questions that
were issued by a passed Person A runtime plan. It does not call a model, read credentials, persist
data, adjudicate facts, or add Person B, deliberation, or recommendation behavior.

## Public API

```ts
applyPersonAClarificationAnswers({
  baseline,
  runtimePlan,
  answers,
  options: {
    createdAt,
    expiredQuestionIds,
    alreadyAppliedQuestionIds,
  },
});
```

The original extraction embedded in the runtime plan and the repaired baseline are inspected into
detached plain JSON snapshots and never mutated. A successful answer produces an amendment and a
separate amended projection. Every amendment records the issued question, exact target family,
object and canonical applied field, prior value, submitted answer, normalized applied value, source
type, stable sequence, and an optional caller-injected timestamp. Validated answers preserve the
issued field and also record `normalized_applied_field` when canonical application uses a paired
schema field.

The answer batch is atomic and capped at six. Any malformed, stale, unsupported, duplicate,
expired, unknown, or already-applied answer rejects the entire batch. No partial projection or
partial amendment list is returned. Rejection audit strings are bounded, and output ordering is
deterministic. Known option keys with malformed value types also fail closed instead of being
treated as absent. Every field-specific rejection, including date-shape and date-grounding errors,
retains the exact answer and question IDs so atomic-batch audit results distinguish the offending
answer from otherwise valid answers rejected with the batch.

## Supported answer types

- actor attribution resolves only to `party_a`, `party_b`, or an existing third party. A question
  issued for the actor slot as `actor_party_id` is deterministically routed to
  `actor_third_party_id` when the answer is an existing third-party ID; the two actor fields remain
  mutually exclusive. A runtime plan cannot issue separate questions for both fields on the same
  timeline event because they are validated as one canonical actor slot;
- date precision preserves exact grounded month/day components and may add only the submitted
  calendar year. A uniquely grounded bare month is represented as the exact first-to-last-day
  interval for that month with `precision: month`; mismatched months, invented days, and ambiguous
  month grounding fail closed. When one exact source span contains multiple dates, only date
  mentions also present in the target event summary are eligible; unrelated dates in the same span
  cannot be applied to the event;
- evidence availability remains categorical and cannot imply upload, inspection, authenticity, or
  verification;
- causal answers are stored explicitly as Person A's asserted theory, not an adjudicated fact;
- nullable agreement interpretation may populate only `person_a_interpretation`;
- contradiction resolution must select or exactly restate one source-grounded alternative issued
  in the question.

Aggregate deliverable and evidence splitting remains unsupported in schema v0.1.2. The answer
boundary cannot create objects or apply merge-risk questions. A valid issued merge-risk question
may coexist in the runtime plan so that unrelated supported answers can still be applied; an answer
submitted for the merge-risk question itself is rejected.

## Offline command

```sh
npm run apply:person-a-clarifications -- \
  --runtime-plan artifacts/person-a/runtime-assessment-v1/runtime-plan.json \
  --answers src/fixtures/dry_run_001.person_a.runtime_answers.json \
  --output-dir artifacts/person-a/runtime-answer-v1
```

The strict command parses all options before file access and writes:

- `submitted-answers.json`
- `validated-answers.json`
- `amendments.json`
- `amended-person-a.json`
- `answer-application-audit.json`
- `runtime-answer-result.json`

This remains offline runtime infrastructure. Live extraction acceptance remains **0/3**.
