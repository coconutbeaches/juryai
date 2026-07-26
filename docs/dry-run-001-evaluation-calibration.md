# Dry Run 001 — evaluation calibration replay

Status: **Rejected.** The corrected instrument still reports one critical and 44 major findings,
so the unchanged zero-critical/zero-major acceptance rule does not pass.

This is an offline replay of the exact artifacts preserved by PR #12. It made no model call and did
not rewrite the narrative, raw response, assembled extraction, historical alignment, historical
report, golden projection, or run manifest.

## Before and after

| Metric                                   | PR #12 historical evaluator |  Calibrated evaluator |
| ---------------------------------------- | --------------------------: | --------------------: |
| Critical                                 |                           8 |                     1 |
| Major                                    |                          53 |                    44 |
| Minor                                    |                          13 |                    20 |
| Human edit rate                          |                       74.5% |                 61.8% |
| Weighted error rate                      |                       65.1% |                 45.5% |
| Evidence recall reported by evaluator    |     2/9 (22.2%) full golden | 3/3 (100%) observable |
| Retrospective observable evidence recall |                 2/3 (66.7%) |            3/3 (100%) |
| Full-golden evidence diagnostic          |                 2/9 (22.2%) |           4/9 (44.4%) |

The retrospective pre-calibration observable value applies the new, fixed observability set to the
old tracked alignment. It was not a metric emitted by the PR #12 report.

## Findings removed or reclassified

- Seven `agreement_terms/unsupported_extra_object` criticals became seven non-blocking
  `agreement_term_decomposition` diagnostics. Four share the golden scope span exactly; the other
  three are separately named later-request components covered by the broader golden scope
  interpretation and exact narrative quotes.
- Seven `evidence/missing_golden_object` majors were removed from extractor-recall error scoring.
  Six golden objects are unobservable from the Person A narrative; one observable feedback message
  now aligns through the narrow message-representation compatibility rule.
- Two grounded extracted messages no longer appear as unmatched surplus evidence. They align to
  `message_export` or `message_screenshot` goldens only because their wording, quoted detail, or
  WhatsApp source also matches.

No generic semantic threshold changed.

## Evidence denominator

Total golden evidence remains nine. Three objects are observable from the frozen extractor input:
the signed agreement, the quoted feedback message, and the social-media post. All three match.

Six remain in the golden and full-golden diagnostic but are excluded from extractor recall:

| Golden ID | Missing from the Person A extractor input            |
| --------- | ---------------------------------------------------- |
| `ev_002`  | invoice, receipt, or another payment-record artifact |
| `ev_003`  | message export or saved message-history artifact     |
| `ev_004`  | email-thread artifact                                |
| `ev_006`  | project or version-history artifact                  |
| `ev_008`  | screen-recording artifact                            |
| `ev_009`  | video-call or video-recording artifact               |

The relevant scope is only `src/fixtures/dry_run_001.person_a.txt`. Nothing from Person B or the
richer full golden is borrowed into observability.

## Raw and assembled spans

| Stage                    | Exact | Failing | Accuracy |
| ------------------------ | ----: | ------: | -------: |
| Raw model output         | 48/58 |      10 |    82.8% |
| Post-assembly extraction | 58/58 |       0 |     100% |

The assembler relocated ten uniquely occurring quotes. Final schema and custom invariants pass,
including exact source-slice validity. The prompt, model schema, and relocation behavior are
unchanged. When identical quote text occurs more than once, the existing assembler refuses to
relocate it and final validation fails; the regression test records that ambiguity without fixing
it.

## Genuine extraction defects still visible

- `del_02_about`, `del_03_services`, and `del_04_contact` upgrade
  `substantially_complete` to `complete`.
- `del_06_pricing` collapses disputed scope to `added_later`.
- `cl_a_003` remains a critical recall miss.
- The other historical completion, claim, timeline, and field-level differences remain reported;
  this calibration does not claim they are fixed.

## Deterministic replay

No API key is read on this path because both saved inputs are explicit:

```bash
replay_dir="$(mktemp -d /tmp/juryai-dry-run-001-calibrated.XXXXXX)"
npm run extract:person-a -- \
  --input src/fixtures/dry_run_001.person_a.txt \
  --submitted-at 2026-07-25T00:00:00Z \
  --extraction docs/dry-run-001/extraction.json \
  --raw-response docs/dry-run-001/raw-response.json \
  --output-dir "$replay_dir"
```

The replay emits calibrated `alignment.json`, `report.json`, and `span-diagnostics.json` while
copying the already assembled extraction and golden projection into the temporary output. The
frozen regression suite asserts the exact counts above:

```bash
npx vitest run src/tests/person-a-live-evaluation-contract.test.ts
```

The acceptance corpus remains separately reproducible:

```bash
npm run gate:person-a-acceptance
npx tsx src/commands/evaluate-person-a-extraction-acceptance.ts | shasum -a 256
```

Dry Run 001 is not added to `src/fixtures/person-a-extraction-acceptance.manifest.json`; historical
model acceptance remains 0/3 and hand-authored controls remain 3/3.
