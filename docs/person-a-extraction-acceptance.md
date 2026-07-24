# Person A extraction acceptance corpus

## Purpose and status

This corpus is a deterministic, offline acceptance contract for Person A extraction. It replays
sanitized saved extraction JSON and hand-authored controls against case-specific golden
extractions. It is laboratory and CI infrastructure, not a production extractor, runtime
coordinator, or refreshed live-model test.

This work measures current extraction quality. It does not tune the prompt, alter extraction
behavior, change model selection, or make provider calls.

## Acceptance rule

A candidate is accepted only when all four conditions hold:

1. the Person A extraction JSON Schema is valid;
2. all custom Person A invariants are valid;
3. the corrected semantic evaluator reports zero critical errors; and
4. the corrected semantic evaluator reports zero major errors.

Minor errors remain visible but do not block acceptance in this version. Human edit rate also
remains visible and has no acceptance threshold.

Schema validation runs before invariants, and both run before semantic alignment. A structurally
invalid candidate never reaches semantic evaluation and cannot be rescued by favorable metrics.

## Acceptance and diagnostic metrics

Each candidate result contains schema and invariant validity, critical/major/minor totals, a
sorted failure-code histogram, recall, precision, edit rate, weighted error rate, status, and
sorted rejection reasons.

Recall and precision reuse the corrected evaluator's family matches:

- suite-candidate recall is total matched objects divided by total golden objects;
- suite-candidate precision is total matched objects divided by total extracted objects;
- recall is `1` when there are no golden objects;
- precision is `1` when neither side has objects, and `0` when extracted is empty but golden is
  not.

Edit rate is the corrected evaluator's count of golden objects needing human edits divided by
total golden objects. Weighted error rate is `(critical + 0.5 × major + 0.1 × minor) / total
golden objects`. Both are diagnostic only.

The failure-code histogram counts corrected evaluator errors by code. Keys are lexically sorted.
Exact historical raw counts are not frozen as the long-term acceptance contract; the stable
contract is rejection, historical 0/3, and broad failure classes.

## Provenance

Candidate provenance is a typed field:

- `historical_saved_output` is sanitized JSON captured from a historical model-backed extraction;
- `hand_authored_control` is a manually constructed control that proves the evaluator can accept
  a correct candidate.

Controls are reported separately and never contribute to historical model acceptance. The
tracked saved outputs reproduce a historical result of **0/3 accepted**. This is an offline
replay, not a newly executed live/model result.

Only extraction JSON is tracked. The corpus excludes raw Responses payloads, request IDs, token
usage, credentials, secrets, and unnecessary provider metadata. The v1 and v2 fixtures were
promoted from ignored local diagnostic extraction files after inspection; v3 was already a
tracked sanitized extraction fixture.

## Manifest

`src/fixtures/person-a-extraction-acceptance.manifest.json` has version
`person-a-extraction-acceptance-manifest-v1` and two arrays:

- `cases` declares a unique `case_id`, narrative file, golden extraction file, and optional
  semantic calibration;
- `candidates` declares `case_id`, unique candidate ID within that case, typed origin, extraction
  file, and expected `accepted` or `rejected` status.

Every file reference has `path` and `sha256`. Paths are relative to the manifest directory and
must be simple, normalized, non-absolute paths without traversal. The loader resolves both the
manifest and every fixture through the filesystem, then requires each fixture's canonical path
to remain inside the canonical manifest directory. Symlinks whose targets remain inside that
directory are allowed; final-component and intermediate-directory symlinks that escape it are
rejected with the stable `fixture_path_escape` error code. Boundary checks use path components,
so a sibling directory that merely shares the manifest directory's string prefix is not inside.
Lexically unsafe paths fail with `fixture_path_unsafe`.

SHA-256 is calculated over the exact raw file bytes, including the final newline, before UTF-8
decoding or JSON parsing. Narrative and JSON fixtures must then decode as valid UTF-8.

The loader fails closed on duplicate IDs, unknown cases, unsupported origins or statuses, missing
files, malformed or unsafe paths, malformed JSON, hash mismatches, malformed aliases, aliases
that target unknown identities, and aliases ambiguous with declared identities.

### Case-specific aliases

Semantic calibration declares canonical `identities` and one-token alias mappings. Aliases are
converted into a case-local map and supplied explicitly to alignment and diff evaluation. They
never become global synonyms and cannot leak between cases.

Existing single-case Dry Run 001 behavior remains backward compatible through the exported
`alignPersonA()` and `evaluatePersonA()` wrappers. Those wrappers deliberately apply the named
`DRY_RUN_001_COMPATIBILITY_ALIASES`. Corpus callers use `alignPersonAForCase()` and
`evaluatePersonAForCase()` with an explicit alias map.

## Public contract

`src/evaluation/person-a-extraction-acceptance.ts` exports:

- `PersonAExtractionAcceptanceCase`;
- `PersonAExtractionCandidate`;
- `PersonAExtractionAcceptanceResult`;
- `PersonAExtractionAcceptanceSuiteResult`;
- `evaluatePersonAExtractionAcceptanceCase()`;
- `evaluatePersonAExtractionAcceptanceSuite()`;
- `loadPersonAExtractionAcceptanceManifest()`;
- `serializePersonAExtractionAcceptance()`;
- `renderPersonAExtractionAcceptanceReport()`.

The suite contains every candidate result, aggregate totals, origin-specific totals, the
historical numerator and denominator, and a deterministic gate result.

The gate compares actual candidate statuses with explicit manifest expectations. This permits CI
to assert the honest current contract: controls pass and the three historical outputs remain
rejected. It does not weaken candidate acceptance.

## Determinism

Cases and candidates are sorted by ID before evaluation. Histogram keys, rejection reasons, and
gate failures are sorted. Canonical JSON recursively sorts object keys, uses two-space
indentation, and ends with one newline. Reports contain no generated timestamps.

Reversing either manifest array does not change canonical output. Repeated runs over identical
bytes produce byte-identical JSON.

The case fixture hash is SHA-256 over:

```text
<narrative SHA-256>\n<golden SHA-256>\n
```

Candidate, narrative, and golden hashes also remain separately visible.

## Commands

Machine-readable diagnostic report:

```bash
npm run evaluate:person-a-acceptance
```

Human-readable diagnostic report:

```bash
npm run evaluate:person-a-acceptance -- --format human
```

Use another manifest:

```bash
npm run evaluate:person-a-acceptance -- --manifest path/to/manifest.json
```

Run the CI gate:

```bash
npm run gate:person-a-acceptance
```

Diagnostic mode exits successfully when evaluation completes, even when candidates are rejected.
Gate mode exits `2` when an actual status differs from its expected status. Malformed arguments or
corpus input exit `1`.

The CLI validates every argument before corpus file I/O. It imports no OpenAI client, provider
invocation, environment-key reader, network client, persistence, Supabase, runtime orchestration,
or Person B code. The dependency-isolation test parses the evaluator and CLI's complete local
import graph with the repository's TypeScript compiler AST. It covers static imports,
`export ... from`, dynamic `import()`, CommonJS `require()`, `createRequire()`, `process.env`, and
`fetch()`. The graph must contain only the documented Node/Ajv dependencies and no forbidden
provider, runtime, persistence, Supabase, or Person B path. This is a static source-dependency and
forbidden-global check, not a universal runtime sandbox or a claim to detect deliberately
obfuscated code.

## Adding a synthetic case

1. Write a clearly synthetic, safe Person A narrative.
2. Create a valid hand-authored golden extraction with exact source spans and fixed metadata.
3. Add a `cases` entry with byte hashes and only the semantic identities/aliases required by that
   case.
4. Add a `hand_authored_control` candidate pointing to the golden extraction with expected status
   `accepted`.
5. Run schema, invariant, acceptance, determinism, and full test gates.

Synthetic cases remain Person A-only. Do not introduce Person B intake, shared-record
reconciliation, invitation, consent, or two-party merge semantics.

## Adding a sanitized saved replay

1. Start from extraction JSON only.
2. Remove raw provider responses, request IDs, usage data, secrets, credentials, and unnecessary
   provider metadata.
3. Confirm the narrative itself is approved and safe to track.
4. Add the JSON as a `historical_saved_output`; never label it as a control or live run.
5. Set the expected status from the unmodified evaluator result.
6. Recalculate exact byte hashes with:

   ```bash
   shasum -a 256 src/fixtures/<file>
   ```

7. Run the acceptance test and gate twice and compare canonical machine output byte-for-byte.

Never promote ignored raw response directories or provider payloads.

## CI

The acceptance test is its own test-matrix entry. The quality job runs the offline corpus gate in
addition to TypeScript, golden validation, formatting, and dependency audit. Existing jobs and
checks remain intact.

## Explicit exclusions

This acceptance infrastructure does not implement or modify prompts, extraction behavior, model
selection, provider ranking, live OpenAI calls, assessment calls, repair or clarification
expansion, lifecycle orchestration, session envelopes, persistence, Supabase, RLS, case state,
state transitions, Person B, invitations, consent, two-party merging, challenge resolution,
evidence inspection, juror prompts, deliberation, recommendations, UI, deployment, or Notion.
