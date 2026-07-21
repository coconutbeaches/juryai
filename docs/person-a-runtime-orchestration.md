# Person A runtime orchestration: repair and clarification planning

Status: first runtime-safe planning milestone implemented in draft PR #5.

## Objective

Introduce one fail-closed runtime boundary that accepts a schema-valid Person A extraction and produces:

1. the unchanged original extraction;
2. the deterministically repaired effective extraction;
3. the repair audit;
4. runtime-safe epistemic assessments;
5. necessity classifications;
6. no more than six grounded clarification questions.

The intended sequence is:

```text
validated extraction
  -> deterministic repair
  -> validate repaired extraction
  -> runtime epistemic assessment
  -> necessity classification
  -> clarification planning
```

## Critical architecture boundary

The current `buildPersonAAssessmentResult()` adapter consumes semantic alignment and evaluation output derived from the golden projection. That adapter is suitable for the laboratory and saved-fixture evaluation, but it must not be called by production runtime orchestration.

Runtime assessment must use only the submitted narrative, the validated extraction, deterministic repair audit data, and explicitly configured runtime policy. Golden fixtures, alignment scores, evaluation severities, and expected object IDs are prohibited runtime inputs.

## Pure API

The first implementation should expose a pure function with injected assessment logic:

```ts
orchestratePersonAPlanning({
  extraction,
  narrative,
  assessmentProvider,
  options: { maxQuestions: 6 },
});
```

`RuntimeAssessmentProvider.assess()` receives only the original extraction, repaired extraction,
narrative, and deterministic repair audit. The returned result includes both records and hashes,
the complete repair result, raw/validated/rejected assessments, necessity classifications,
questions, suppressed candidates, unresolved material gaps, and stage-by-stage audit data.

Artifact hashes never stand in for absent artifacts. An absent repaired extraction has a `null`
hash. A repaired artifact that was produced but failed validation is retained with its actual hash
and `present_invalid` audit status. A valid artifact is `present_hashed`. Original hashes are
published only after original validation succeeds.

Each stage is categorized as `not_started`, `passed`, `skipped`, or `failed_closed`. The public
function returns structured audit context on data or provider failures instead of exposing a
partially trusted question plan.

The injected boundary keeps repair/planning orchestration testable while preventing accidental
use of the golden-based laboratory adapter. The checked-in static provider and assessment JSON
are offline test/CLI fixtures, not the final production assessment engine.

## Fail-closed invariants

- Validate the original extraction before repair.
- Preserve the original extraction byte-equivalently.
- Validate the repaired extraction before assessment or question generation.
- Reject malformed or duplicate assessments and suppress context-free or ungrounded candidates.
- Treat an assessment-provider batch atomically: one rejected item fails the whole assessment
  stage and no item in that response can produce a question.
- Inspect and snapshot the provider batch in one protected descriptor traversal before mapping,
  cloning, or serializing anything. It must be a plain, dense JSON array with no expando, symbol,
  accessor, inherited-enumerable, or unusual prototype state.
- Never invoke provider-owned methods, iterators, getters, or ordinary index/property reads.
  Protected own-key and descriptor captures must remain stable across two passes; inconsistent or
  throwing Proxy traps fail closed. Recursive descriptor values are copied into a new plain JSON
  tree, and every later stage operates only on that detached snapshot.
- Reject cycles, accessors, unusual prototypes, symbols, functions, bigint, `undefined`, sparse or
  extended arrays, and non-finite numbers before JSON serialization. Traversal is cycle-aware,
  capped at 64 levels and 10,000 visited values, and returns a bounded audit description.
- Bound provider-controlled containers to 100 assessments per batch, 1,000 values per nested
  array, and 200 own keys per object. Array density is checked from actual own descriptors by
  counting canonical numeric indices and comparing their count and endpoints with `length`; the
  validator never constructs an expected-key array proportional to attacker-controlled length.
- Enforce an explicit trigger, target-family, and field matrix with no wildcard fallback. The
  target object's resolved family and actual shape must agree with the assessment.
- Suppress `already_explicit`, `internal_representation`, and `insufficient_grounding` candidates.
- Generate at most six deterministic questions.
- Never convert a skipped repair audit entry directly into a human question.
- Keep aggregate deliverable and evidence splitting unsupported in schema v0.1.2.
- Never apply clarification answers automatically in the planning phase.
- Never read an API key or create an OpenAI client in offline planning.
- Never use the golden fixture, alignment, or evaluation modules in runtime code.

## Integration boundary

The existing extraction CLI should remain unchanged until the pure orchestrator and runtime assessment provider have independent deterministic tests. Runtime integration should then be explicit, opt-in, and occur only after extraction validation succeeds.

The strict offline command is:

```sh
npm run plan:person-a-runtime -- \
  --input src/fixtures/dry_run_001.person_a.txt \
  --extraction artifacts/person-a/live-run-1-v3/extraction.json \
  --assessments src/fixtures/dry_run_001.person_a.runtime_assessments.json \
  --output-dir artifacts/person-a/runtime-plan-v1
```

It writes deterministic output artifacts:

- `original-extraction.json`;
- `repaired-extraction.json`;
- `repair-audit.json`;
- `assessments.json`;
- `necessity-classifications.json`;
- `clarification-questions.json`;
- `suppressed-candidates.json`;
- `orchestration-audit.json`;
- `runtime-plan.json`.

Argument parsing completes before file reads. This command contains no environment-variable,
credential, OpenAI-client, or network setup.

## Dependency guard

The runtime orchestration test statically scans the runtime boundary and fails if it imports
evaluation, alignment, golden, saved-artifact, or OpenAI modules, or references environment/API
key setup. Family indexing needed by necessity classification is local to clarification logic and
does not import semantic alignment.

## Runtime assessment compatibility

The first milestone intentionally supports only reviewed schema v0.1.2 combinations:

- actor attribution: timeline actor fields and claim `party_id`;
- evidence availability: evidence `availability_status`;
- date precision: timeline `date`;
- causal link: damages `causal_theory`;
- merge risk: grounded extraction-issue `description` only;
- required missing information: selected agreement, claim, and extraction-issue fields;
- internal representation: an explicit list of existing label/content fields across supported
  families.

`required_information` is the only intentionally absent virtual field, and only for a grounded
extraction issue. Aggregate deliverable/evidence splitting remains unsupported; no compatibility
rule can turn an aggregate-split audit into a human question.

## Implemented verification coverage

- Original extraction remains byte-identical.
- Invalid original or repaired records fail closed.
- Absent artifacts have null hashes, while produced invalid repairs retain their real hashes.
- Cyclic and over-depth provider output fails closed without recursion overflow.
- Sparse, extended, accessor-backed, symbol-keyed, cyclic, and oversized provider batch arrays
  fail atomically before iteration, and huge declared lengths are rejected before proportional
  allocation.
- Throwing, changing, or revoked Proxy batches produce a bounded structured rejection. Valid Proxy
  wrappers can be accepted only through stable descriptor snapshots; neither `map` nor numeric
  index `get` traps are requested, and later provider mutation cannot change any result artifact.
- Wrong-family trigger/field combinations fail the assessment batch atomically.
- Golden/evaluation modules are absent from the runtime dependency graph.
- Assessment order does not change serialized output.
- Internal repair bookkeeping never becomes a question.
- Explicitly answered facts remain suppressed.
- True contradictions produce one grounded confirmation question.
- Question count never exceeds six.
- Offline planning reads no API key and constructs no OpenAI client.
- Repeated orchestration is byte-identical.

## Explicit limitation

PR #4 merged the extraction/evaluation/repair/clarification laboratory infrastructure. Live extraction acceptance remains **0/3**, so the extractor is not production-ready. This orchestration work does not change that gate by itself.
