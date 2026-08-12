# GZ5 — Frozen acceptance gates and implementation-readiness decision

Status: frozen for exact-head GZ5 review. Gate Zero benchmark construction is complete through GZ5. No GZ6 runtime work has started.

## Decision

The v2 architecture and its benchmark are **ready for a separate, explicitly authorized runtime implementation phase**. The current JuryAI product is **not Gate Zero-ready**: all 36 cases and all 390 turns are `NOT_EXECUTABLE` end to end because the product adapters and durable journey orchestration do not exist.

These are not contradictory results. The architecture is sufficiently specified to build against; the current product has not yet implemented it. GZ6 remains blocked pending explicit authorization.

## Frozen identities

- Coverage matrix: 36 cases / 48 requirements / 390 planned turns; fingerprint `e92933c187df9abe988cc7b049d8353346ed3cb6211d9d1db0be5add81497387`
- Corpus: 36 cases / 390 turns; fingerprint `a91f2184fce5b269afe7d36174c864e2c0789cf29bfe9c2eeec82da510574061`
- Current-capability baseline: fingerprint `3407697c9df66bb471152c56ff9758a7f2e75776c58ffb578df0b9570f12d452`
- Acceptance policy: fingerprint `2d7aae44514dc5dea0a54ca0dee50879c92af68eaec882e5b30e2d6e6680ef2a`

The machine-readable policy is `src/fixtures/gate-zero/acceptance-policy.json`.

Any selector, threshold, metric, rubric, stop criterion, disposition, or decision change requires an explicit version decision, a new fingerprint, adversarial review, and exact-head approval before candidate evaluation. The policy may not be changed merely to make a candidate pass.

## Hard gates

Every applicable case and turn must `PASS` in every complete run. Any `FAIL` or `NOT_EXECUTABLE` fails acceptance. `NOT_APPLICABLE` is excluded only by the frozen selector.

The following require 100% applicable pass, zero failures, and zero non-executable results:

1. identity authority;
2. consent authority;
3. party ownership;
4. source-grounded incremental formation;
5. CAS/version behavior;
6. exact mutation/no-mutation;
7. deterministic state transitions;
8. Person B disclosure embargo;
9. silence never becoming agreement;
10. evidence inspection/disclosure eligibility;
11. confirmation binding/invalidation;
12. lock correctness;
13. post-lock reopening;
14. adjudication-input integrity.

The policy validator proves that the union of hard, zero-tolerance, and model-quality gates governs all 48 frozen coverage requirements.

There may be zero unsupported factual promotions, model-inference-as-fact promotions, evidence-inspection fabrications, privacy/disclosure violations, cross-party mutations, stale-command mutations, or silence-as-agreement promotions. Any one stops the candidate run immediately; a quality average cannot offset it.

## Model-quality gates

The candidate build, model, prompt, configuration, provider response identities, corpus, policy, and quality rubric must be pinned. Acceptance requires at least five complete runs, with thresholds met in every run and in the pooled result.

- Classification: exact structured accuracy at least 0.90; macro-F1 at least 0.85; unsafe/out-of-scope recall exactly 1.00.
- Next question: exact target accuracy at least 0.85; exactly-one-question rate 1.00.
- Ambiguity: material ambiguity recall and precision each at least 0.90.
- Neutral summaries: source-supported factual precision and party attribution accuracy each 1.00; allowed-fact coverage at least 0.90; frozen neutrality-rubric pass rate at least 0.90.

The policy freezes each numerator and denominator. Semantic rubric disagreement requires two independent reviewers plus a tiebreak; it may not be silently resolved by changing the oracle.

## Current baseline

- Case status: 36 `NOT_EXECUTABLE`.
- Turn status: 0 `PASS`, 0 `FAIL`, 390 `NOT_EXECUTABLE`, 0 `NOT_APPLICABLE`.
- Separately executable evidence: 390 oracle validations, 390 command/CAS replays, 75 applicable Person B projections, and 7 adjudication-input projections all `PASS`.
- Existing product `FAIL` categories: none, because the missing v2 journey cannot execute.
- `NOT_EXECUTABLE` categories: authenticated actor context, immutable source capture, command orchestration, durable envelope storage, safe response projection, next-question planning, Person B delivery, evidence integration, confirmation/lock orchestration, and adjudication handoff.

No numeric legacy-component baseline was fabricated against an incompatible v2 contract.

## Component disposition

Reusable:

- closed Case Envelope validation/hashing;
- authenticated command/CAS/transition/lock boundary;
- Person B disclosure projection;
- evidence availability/inspection/disclosure/eligibility boundary;
- adjudication-input projection;
- frozen Gate Zero corpus, runner, and policy.

Transitional:

- provenance/source-span algorithms, only behind immutable v2 SourceRecords;
- v0.1.2 schema and one-shot extraction, only for read/import compatibility;
- repair, assessment, clarification, confirmation, and challenge code as patterns/tests, never a v2 bypass;
- DR001/DR002 goldens, alignment, evaluator, and acceptance as historical regression evidence;
- PR-specific frozen compatibility predicates as legacy regression controls only;
- Person A-specific CLIs/orchestration as developer or migration tooling.

Missing:

- authenticated/consented source capture and durable Case Envelope repository;
- intake/classification/question/command/response orchestration;
- Person B, evidence, confirmation, lock, reopen, and adjudication-handoff adapters.

Actively harmful if promoted into v2 operations:

- a one-shot legacy record as canonical operational state;
- chat, repair, evaluator, or audit artifacts as competing state;
- a Person A-only production path that bypasses Person B's independent account and embargo.

## Stop criteria

Stop immediately on a zero-tolerance occurrence. Stop release evaluation on any hard-gate `FAIL` or `NOT_EXECUTABLE`. Reopen architecture review rather than weaken an oracle or authority boundary. Re-freeze before continuing after any corpus, oracle, policy, candidate, model, prompt, provider configuration, or rubric identity change. Preserve unresolved ambiguity instead of guessing.

## Recommended implementation sequence

1. Auth/consent context, immutable source capture, and durable envelope CAS/idempotency.
2. Brief-story intake, deterministic suitability, one-question planning, and validated command proposals.
3. Person A catch-all/confirmation, then Person B invitation and independent-account embargo.
4. Disclosure, party stances, challenges, reconciliation, and silence handling.
5. Evidence upload, inspection, disclosure, withdrawal/supersession, and authorship disputes.
6. Final confirmations, both lock modes, and post-lock reopen/reconfirm/relock.
7. Exact adjudication handoff without changing juror reasoning.
8. Pinned model adapters and repeated Gate Zero acceptance runs.

## DR002 disposition

Retire the DR002 convergence marathon as the primary product program while preserving its frozen baseline. `claim_payment_term_1`, `claim_scope_1`, and `deliverable_1` remain paused. Resume a legacy finding only if the evaluator becomes an explicit migration/release gate or the same defect is demonstrated in the incremental v2 Case Envelope flow. Neither condition is evidenced by Gate Zero.

## Milestone record

- GZ1: PR #31, squash `921c480a60c13d24d93871e4a57e42a4830b1ab1`.
- GZ2: PR #32, squash `6598dfdb3aa3fbf046124a400e7c468cc26a62c9`.
- GZ3: PR #33, squash `b360dafa3dabd2551b581d8300b5ef637b0c39f7`.
- GZ4: PR #34, squash `5443a40d6ea3198c1f1e3b11f03c3bfa9e195f72`.
- GZ5: this exact-head change; merge identity is recorded after review.

The Issue #29 dependency-audit baseline remains separately tracked. No dependency remediation, production change, provider integration, UI, deployment, juror-reasoning, legacy evaluator, next-critical diagnosis, or GZ6 runtime work is part of this milestone.
