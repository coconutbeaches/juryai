# Person A deterministic runtime assessment

The runtime assessment provider is a pure, offline implementation of the `RuntimeAssessmentProvider` boundary. It consumes only the submitted narrative, validated original and repaired Person A extractions, and the deterministic repair audit. It does not import evaluation, alignment, golden projections, saved-run paths, model clients, credentials, environment variables, persistence, Person B, deliberation, or recommendation code.

## Public API

- `createDeterministicPersonAAssessmentProvider(config?)`
- `new DeterministicPersonAAssessmentProvider(config?)`
- `assessDeterministicPersonAEpistemicGaps(context, config?)`

The provider returns detached plain JSON in deterministic order. The orchestration boundary still validates the full assessment batch atomically. One malformed assessment rejects the batch and prevents necessity classification and question generation.

## Rules

The stable rules are:

- `runtime_actor_attribution_v1`: asks only for a material actor-bearing timeline action when neither the object nor its exact source span identifies an actor.
- `runtime_material_date_precision_v1`: groups materially necessary missing calendar years for deadlines, sequence, liability, or comparable timing.
- `runtime_evidence_availability_v1`: asks only about `described_only` or unknown evidence with an exact grounded claim link; it never promotes availability or inspection state.
- `runtime_causal_link_v1`: exposes only unstated or explicitly hedged causal theories on supported damages objects.
- `runtime_nullable_interpretation_v1`: exposes a source-grounded null `person_a_interpretation`; it does not treat required wording or claim text as a missing bucket.
- `runtime_material_contradiction_v1`: emits only bounded contradictions supported by independently exact source spans, without a credibility judgment.
- `runtime_internal_representation_v1`: maps aggregate-splitting repair audit entries to suppressed internal work.

Every rule records emitted, suppressed, and rejected candidates with a deterministic reason code and bounded grounding references. The provider is capped at 100 assessments, and the existing planner remains capped at six questions.

## Aggregate limitation

Aggregate deliverable and evidence splitting remains intentionally unsupported in canonical schema v0.1.2. The provider never creates or deletes child objects and never infers aggregate membership. The repair audit may produce an `internal_representation` assessment, which the necessity classifier suppresses from users.

## Offline command

```sh
npm run assess:person-a-runtime -- \
  --input src/fixtures/dry_run_001.person_a.txt \
  --extraction artifacts/person-a/live-run-1-v3/extraction.json \
  --output-dir artifacts/person-a/runtime-assessment-v1
```

The strict CLI validates, repairs, assesses, classifies necessity, and plans clarification without loading credentials or constructing a network client. It writes:

- `repaired-extraction.json`
- `assessments.json`
- `necessity-classifications.json`
- `clarification-questions.json`
- `suppressed-candidates.json`
- `assessment-audit.json`
- `runtime-plan.json`

This is planning infrastructure, not a live extraction acceptance result. The live acceptance gate remains separate.
