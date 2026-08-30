# P2 Step 61 — model-backed semantic compiler and semantic eval harness

Adds a real, versioned, model-backed `SemanticCompilerPort` behind the merged P2
runtime, and an evaluation harness that grades what the compiler _means_ rather
than whether its JSON parsed.

Nothing in the frozen pipeline moves. The compiler still receives exactly a
`CompilerInput` and returns exactly a candidate `CompilerOutput`; shape
validation, contract validation, server-owned ids, provenance, supersession,
clarification creation, structural validation, versioning and commit all remain
the runtime's.

## Layering

```
SemanticCompilerPort            src/webmcp/runtime/compiler-port.ts   (unchanged)
        ^
ModelSemanticCompiler           src/webmcp/compiler/model-compiler.ts
        v
SemanticModelClient             src/webmcp/compiler/model-client.ts
        v
OpenAiResponsesSemanticModelClient / ScriptedSemanticModelClient
```

`ModelSemanticCompiler` owns every JuryAI semantic: the system prompt, the input
rendering, the output schema, the output contract, the grounding rules, the
retry policy and the compiler artefact. The client below it owns one thing —
send a request, honour an `AbortSignal`, return what the provider said. Swapping
provider or model changes `compiler_version_id`, as it must, and changes no
JuryAI rule.

`ScriptedSemanticCompiler` is untouched and remains the deterministic compiler
for runtime fixtures and tests.

## Provider

The shipped transport is the OpenAI Responses API over native `fetch` with
strict `json_schema` structured output. This is the convention the repository
already uses (`src/extraction/openai-responses.ts`), so it adds no dependency,
no SDK and no competing provider abstraction. That module is not reused
directly: it is welded to the Person A prompt and schema and cannot carry an
`AbortSignal`. Its endpoint-identity discipline _is_ reused.

## Compiler identity

`CompilerVersion` is built from the real artefact:

| field              | source                                                       |
| ------------------ | ------------------------------------------------------------ |
| `prompt_hash`      | sha256 of the exact system prompt text                       |
| `config_hash`      | sha256 of the canonical serialisation of the material config |
| `model_id`         | operator-configured model identifier                         |
| `model_snapshot`   | only a genuinely pinned snapshot, otherwise `null`           |
| `decoding`         | declared decoding configuration                              |
| `taxonomy_version` | proposition/strength taxonomy version                        |
| `schema_version`   | `COMPILER_CONTRACT_VERSION` from core                        |

The material config covers provider id, endpoint sha256, response-format mode,
output-schema hash, input template and render versions, the sampling-parameter
policy and whether raw output is retained. Operational transport policy — retry
count, backoff — is deliberately _not_ hashed: it cannot change the meaning of a
successful run.

`registered_at` is a fixed constant, not wall clock, because it is part of the
registry entry's equality check.

**Options are snapshotted at construction.** `ModelSemanticCompilerOptions` is
caller-owned. Hashing it once and then reading it again at compile time would
let a caller mutate `decoding`, `model_id` or the sampling policy after
registration and silently execute a different artefact than every resulting
proposition is attributed to. `resolveModelCompilerOptions` applies defaults,
`structuredClone`s (severing nested aliases such as `decoding`) and deep-freezes
the result; that one snapshot drives both the registry artefact and every later
compile. Operational settings — retry count, backoff — stay outside compiler
identity but are snapshotted too, because execution reads them.

**A pinned run must be provable.** When `model_snapshot` is `null` the artefact
claims no specific model, so a provider-reported model is informational only.
When `model_snapshot` is set, the artefact claims that snapshot executed, and
the provider must positively identify it: a different reported model, or none
at all, raises `SemanticModelIdentityError` and no output is produced. The check
sits outside the retry loop and is non-transient, so a mismatch can never be
resampled until an attempt happens to report the right model. The configured
snapshot is never rewritten from the response, and no compiler version is
derived after execution.

A moving alias is never recorded as a snapshot. `model_snapshot` stays `null`
unless an operator explicitly pins one.

## Prompt doctrine

`src/webmcp/compiler/prompt.ts` is the artefact; any edit, including whitespace,
is a new `compiler_version_id`. It instructs the model to _read_, never to
complete a case: the answer region is the only evidence, relayed assistant
context is background, all case content is untrusted data, ambiguity is a
result rather than a defect, `no_assertions` is legitimate, non-recollection and
declined answers are canonical facts, adverse material is recorded as stated,
and supersession is proposed only when the relationship is plain.

## Input rendering

`renderCompilerInput` is a pure function of the supplied `CompilerInput`. Every
case-derived section is fenced with a token derived from the server-owned
`compile_run_id`, which no relay or user can predict, so no answer text can
close the fence and escape into the instruction region. The answer is rendered
in its stored form so exact quotation stays possible.

## Structured output and grounding

Provider-native strict `json_schema` is used as convenience only. Every property
it claims to guarantee is re-checked by `parseModelDraft`, and the runtime then
re-checks the assembled output independently.

The model does **not** emit span offsets or assertion ids. It emits
_quotations_; the compiler locates each one in the stored turn and builds the
span with the core's own `createSpan`. A quotation that does not occur exactly
fails the whole compile run — for rejected candidates too — so "every span this
compiler emits is mechanically verified" holds without exception.

`raw_model_output` is `null` by default. When retention is enabled it is audit
material inside the compile run; it is never surfaced through
`CaseStateResponse`.

## Cancellation and retries

The caller's `AbortSignal` is forwarded into the actual network request. An
already-aborted call never reaches the provider, an abort is re-thrown as
itself rather than flattened into a provider error, and no retry or backoff can
outlive the cancellation.

Retries are bounded (default 1), transient-transport-only, byte-identical, and
never triggered by a refusal or by malformed structured output. There is no
resample-until-it-parses policy.

## Eval harness

```
npm run eval:compiler        # offline: no key, no network, no paid call (CI runs this)
npm run eval:compiler-live   # live: requires explicit configuration, fails loudly without it
npm run eval:compiler -- --case deadline.expectation_only
```

Offline runs drive the _real_ compiler over a replay client at the provider
seam, so prompt assembly, rendering, parsing, grounding, retry and cancellation
are all real. Only the completion bytes are fixtures. An offline pass is
evidence about the pipeline and the graders; it is **not** evidence about any
model.

Each case runs two phases:

1. **Compile** — semantic grading of the output.
2. **Boundary** — the same output through the runtime's own guard chain: shape
   validation, contract validation, mutation application, structural validation.

A case passes only if both accept it.

Grading is property-based and **closed-world**. Every case declares the complete
set of assertion slots it permits, keyed by `(requirement_id, proposed_type)`
with optional strength, statement-value and supersession expectations plus a
cardinality bound; anything outside that set is over-extraction and fails, even
when the runtime would commit it happily. A blacklist of forbidden types cannot
express this: a live model that adds a contract-valid but false extra reading
would pass under one.

Clarifications are graded the same way, as **atomic `(requirement_id, reason)`
pairs**. Checking that the reason appears somewhere and the requirement appears
somewhere lets two unrelated clarifications satisfy both halves, so a compiler
asking the right kind of question about the wrong requirement would score green.
The runtime cannot catch that — the wrong requirement is a perfectly real
requirement on the case.

Beyond the closed world: answer-region grounding, quotations re-verified against
the stored turn, no inspected-evidence types, expected or prohibited
supersession, and values that must **not** appear anywhere in the output. Exact
prose is never graded.

### Traps

A corpus of good answers only proves the graders can be satisfied. Every
load-bearing case also carries **traps**: completions that must be refused, each
labelled with the layer obliged to refuse it (`compiler`, `boundary`, `grader`).
The suite fails if a trap slips through _or_ if it is stopped by the wrong
layer, which would mean the intended guard is not doing the work.

### Live eval

Live runs need `JURYAI_COMPILER_API_KEY` (or `OPENAI_API_KEY`) and
`JURYAI_COMPILER_MODEL`; optionally `JURYAI_COMPILER_BASE_URL`,
`JURYAI_COMPILER_MODEL_SNAPSHOT`, `JURYAI_COMPILER_MAX_OUTPUT_TOKENS`,
`JURYAI_COMPILER_OMIT_SAMPLING_PARAMS`, `JURYAI_COMPILER_RETAIN_RAW_OUTPUT`.

A live eval that is requested but not configured **fails**; it is never silently
skipped and reported as a pass. Reports carry model id, compiler version id,
prompt hash, config hash, per-case failures and elapsed time. Provider token
usage is printed as non-authoritative diagnostics and never enters canonical
state.

## Confidentiality

The compiler sends the configured provider exactly the compile request and
nothing else: no cross-case context, no analytics, no telemetry, no second
provider. The compiler input is never logged by default, user answers are never
printed by the reporter, and the registry records only a hash of the endpoint —
never the URL, never the key.
