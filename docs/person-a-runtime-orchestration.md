# Person A runtime orchestration: repair and clarification planning

Status: design contract for the next implementation PR.

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

## Proposed pure API

The first implementation should expose a pure function with injected assessment logic:

```ts
type PersonARuntimePlanningInput = {
  extraction: unknown;
  narrative: string;
  buildRuntimeAssessments: (context: {
    original: PersonAExtraction;
    repaired: PersonAExtraction;
    repairAudit: PersonARepairResult;
    narrative: string;
  }) => EpistemicAssessment[];
};

type PersonARuntimePlanningResult = {
  original: PersonAExtraction;
  repaired: PersonAExtraction;
  repairAudit: PersonARepairResult;
  assessments: EpistemicAssessment[];
  necessity: QuestionNecessityResult;
  clarificationQuestions: NecessaryClarificationQuestion[];
};
```

The injected boundary keeps repair/planning orchestration testable while preventing accidental use of the golden-based laboratory adapter. A later reviewed change may provide the production assessment implementation.

## Fail-closed invariants

- Validate the original extraction before repair.
- Preserve the original extraction byte-equivalently.
- Validate the repaired extraction before assessment or question generation.
- Reject malformed, duplicate, context-free, or ungrounded assessments.
- Suppress `already_explicit`, `internal_representation`, and `insufficient_grounding` candidates.
- Generate at most six deterministic questions.
- Never convert a skipped repair audit entry directly into a human question.
- Keep aggregate deliverable and evidence splitting unsupported in schema v0.1.2.
- Never apply clarification answers automatically in the planning phase.
- Never read an API key or create an OpenAI client in offline planning.
- Never use the golden fixture, alignment, or evaluation modules in runtime code.

## Integration boundary

The existing extraction CLI should remain unchanged until the pure orchestrator and runtime assessment provider have independent deterministic tests. Runtime integration should then be explicit, opt-in, and occur only after extraction validation succeeds.

Suggested output artifacts:

- `original-extraction.json`;
- `repaired-extraction.json`;
- `repair-audit.json`;
- `epistemic-assessments.json`;
- `necessity-classification.json`;
- `clarification-plan.json`.

## Required tests for implementation

- Original extraction remains byte-identical.
- Invalid original or repaired records fail closed.
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
