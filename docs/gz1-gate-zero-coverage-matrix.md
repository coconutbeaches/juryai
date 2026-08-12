# GZ1: Gate Zero Corpus Taxonomy, Coverage Matrix, and Turn Oracle

- Status: frozen design input for GZ2 case authoring
- Matrix version: `juryai-gate-zero-coverage-matrix-v1.0.0`
- Planned corpus size: **36 canonical cases**
- Matrix fingerprint: `e92933c187df9abe988cc7b049d8353346ed3cb6211d9d1db0be5add81497387`
- Turn oracle: `juryai-gate-zero-turn-oracle-v2.1.0`
- Authority boundary: merged GZ0 schema/protocol/command v2.0.0

GZ1 freezes what the corpus must test before any canonical case is authored. It is a product-journey
matrix, not an extraction benchmark and not an estimate of current v2 implementation completeness.
The executable source of truth is
[`src/gate-zero/coverage-matrix.ts`](../src/gate-zero/coverage-matrix.ts); this document explains its
decisions. Any matrix change must update the version or fingerprint in an explicit reviewed PR.

## Adversarial decisions

1. Every requirement has both a success oracle and a failure oracle. “Positive” does not mean a
   happy dispute outcome: for unsafe intake, silence, unreadable evidence, and non-participation, a
   successful result is the correct fail-closed state.
2. Coverage is planned across **36 cases**, within the required 30–40 range. Cases are selected for
   boundary pressure and complete-journey interactions, not ease of current execution.
3. The first ten cases deliberately cross authority, intake, CAS, party ownership, B embargo,
   evidence, confirmation, lock, reopen, and adjudication projection. GZ2 must review those ten
   before authoring cases 11–36.
4. A turn’s source universe is closed. Every immutable `SourceRecord` available at that turn is
   classified as visible or hidden, exactly once. Visible and embargoed Case Envelope context is
   separately identified by disjoint RFC 6901 JSON Pointers. A fact allowed in user-visible output
   may cite only visible sources.
5. The next-question oracle is a single nullable target, not a list. `null` means no question is
   expected on that turn. The field identifies party, namespace, optional object, field, and a
   stable reason code; it does not freeze model prose.
6. User-visible facts are typed and source-bound. Forbidden promotions separately name
   propositions that must not become objective fact, bilateral agreement, party admission,
   verified evidence, or disclosed context.
7. Exact command/result identities remain authoritative. A model-quality output cannot compensate
   for the wrong actor, source visibility, mutation, version/hash, transition, confirmation, lock,
   or factual authority.

## Frozen per-turn oracle

Each GZ2/GZ3 turn must populate all of the following:

| Area          | Required fields and meaning                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| Identity      | Stable `turn_id` and exact authenticated actor/execution context                                                  |
| Context       | Immutable source records, complete visible/hidden source partition, and disjoint visible/embargoed envelope paths |
| Base          | Exact envelope and material-record version/hash identities                                                        |
| Proposal      | One canonical command with closed operations and exact source references                                          |
| Authorization | Complete disjoint partition of every closed operation type into permitted or forbidden for this actor/state       |
| Mutation      | Applied/idempotent/rejected, exact no-mutation flag, version deltas, and resulting hashes                         |
| Authority     | Expected object-authority fragments and exact required source references                                          |
| Conversation  | Zero or one next-question target; no frozen natural-language question wording                                     |
| Output        | Typed allowed user-visible facts and forbidden factual promotions                                                 |
| Evidence      | Expected evidence lifecycle actions without implied authenticity                                                  |
| Confirmation  | Exact parties whose receipts must be invalidated                                                                  |
| Workflow      | Resulting state, lock status/mode/output scope, and typed failure reason                                          |

The validator rejects malformed plain-JSON shape; duplicate/overlapping visibility or operation
sets; unregistered, hash-invalid, or span-invalid sources; facts citing hidden sources; inconsistent
mutation/version/hash claims; missing/unexpected failure codes; and incoherent lock effects.

## Coverage taxonomy

The 48 requirements cover the complete formation and adjudication-input journey:

| Group                  | Frozen requirements                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authority/CAS          | identity binding, consent, stale CAS, idempotent retry, conflicting duplicate command, unauthorized mutation, cross-party mutation, atomic command failure, fail-closed paths |
| Intake/triage          | brief initial story, classification/suitability, unsafe/out-of-scope ejection                                                                                                 |
| Incremental formation  | one question per turn, incremental command formation, final open catch-all, exact party assertions, ambiguity, delayed corrections, UTF-16 source spans                       |
| Structured record      | non-party actors, agreements/obligations, events, payments, deliverables, claimed losses, requested outcomes                                                                  |
| Party journey          | Person A confirmation, Person B independent account, disclosure embargo, disagreement, item challenge/reconciliation, silence                                                 |
| Evidence               | described-only, upload, incomplete inspection, unreadable inspection, disclosure, withdrawal/supersession, disputed authorship                                                |
| Freeze/reopen          | confirmation binding/invalidation, bilateral lock, documented non-participation, advisory-only scope, post-lock material change, reopen/reconfirm/relock                      |
| Projection/adversarial | exact adjudication-input exclusions and prompt injection                                                                                                                      |

Every row in the executable requirement list defines the observable success and rejected/fail-closed
behavior. The matrix validator fails if either polarity has no planned case.

## Case matrix

| ID            | Turns | Primary journey and adversarial focus                                              |
| ------------- | ----: | ---------------------------------------------------------------------------------- |
| `gz_case_001` |     8 | Fresh identity/consent; reject fabricated A authority and pre-invitation B binding |
| `gz_case_002` |    12 | Brief story → triage → single questions → catch-all → A confirmation               |
| `gz_case_003` |     6 | Unsafe/out-of-scope terminal ejection; prohibit continued formation                |
| `gz_case_004` |    10 | Exact assertions, explicit ambiguity, UTF-16 grounding, delayed correction         |
| `gz_case_005` |     8 | Current CAS, stale command, idempotent retry, conflicting duplicate ID             |
| `gz_case_006` |     8 | Party ownership and all-or-nothing multi-operation failure                         |
| `gz_case_007` |    12 | A confirmation → B independent account under embargo → separate disclosure         |
| `gz_case_008` |    14 | Full evidence lifecycle under incomplete/unreadable/authorship uncertainty         |
| `gz_case_009` |    12 | Exact confirmations, material invalidation, bilateral lock guards                  |
| `gz_case_010` |    14 | Locked case → material reopen → reconfirm/relock → exact projection                |
| `gz_case_011` |    10 | Material third-party actor in an alleged agreement                                 |
| `gz_case_012` |    12 | Conditional obligation and disputed/approximate event timing                       |
| `gz_case_013` |    12 | Deposit, balance, payment status, and disputed due trigger                         |
| `gz_case_014` |    12 | Partial deliverable with incompatible completion/defect accounts                   |
| `gz_case_015` |    12 | Consequential claimed loss and ranked requested remedies                           |
| `gz_case_016` |    12 | Late correction after linked agreement/event/payment objects exist                 |
| `gz_case_017` |     8 | Unicode and surrogate-pair UTF-16 source-span boundary                             |
| `gz_case_018` |    10 | Highest-value question resists attractive but low-value detail                     |
| `gz_case_019` |    10 | Catch-all adds material actor/event and reopens requirements                       |
| `gz_case_020` |    10 | Accepted challenge requires atomic target correction                               |
| `gz_case_021` |    10 | Rejected challenge and lacks-information stance remain unresolved                  |
| `gz_case_022` |    10 | Silent B under protocol that prohibits non-participation locking                   |
| `gz_case_023` |    14 | Fully documented non-participation with advisory-only output                       |
| `gz_case_024` |    10 | Incomplete notice/deadline record blocks non-participation path                    |
| `gz_case_025` |    14 | Uploaded, complete-inspected, disclosed evidence reaches bilateral lock            |
| `gz_case_026` |    10 | Unreadable decision-relevant evidence blocks lock and summary fabrication          |
| `gz_case_027` |    14 | Superseded evidence and disputed asserted authorship                               |
| `gz_case_028` |    10 | Private evidence cannot leak through B view or summaries                           |
| `gz_case_029` |     8 | Control-only envelope event versus material confirmation binding                   |
| `gz_case_030` |    10 | Material evidence change clears both confirmations                                 |
| `gz_case_031` |    12 | Post-lock payment record forces explicit reopen and new lock                       |
| `gz_case_032` |    14 | Post-lock deliverable-scope correction and non-stale projection                    |
| `gz_case_033` |    10 | Projection excludes described evidence, hidden sources, and journals               |
| `gz_case_034` |    10 | Prompt injection in party narrative cannot alter authority/visibility              |
| `gz_case_035` |    10 | Prompt injection in evidence cannot self-authenticate or command runtime           |
| `gz_case_036` |    12 | Malformed nested state/commands/projections fail closed                            |

Cases 1–10 are the frozen GZ2 initial review set. Their numbering is an authoring order, not a
severity or product priority ranking.

## GZ2 authoring gate

GZ2 may begin only from this exact matrix identity. Each of cases 1–10 must contain ordered full-turn
oracles and pass:

- exact schema/oracle validation;
- execution against the GZ0 pure contract wherever the operation is executable;
- byte-exact no-mutation checks for rejected/idempotent turns;
- adversarial review of visibility, authority, factual promotion, and next-question target; and
- full cross-turn identity continuity for envelope, material record, confirmations, and locks.

If the first ten expose a genuine GZ0 ambiguity, the correction must be narrow, explicit, and
reviewed before cases 11–36. The oracle must not be weakened to match current implementation.

## Scope and revision policy

GZ1 does not author corpus cases, call a provider, run the legacy evaluator as a v2 gate, baseline
current capability, define GZ5 thresholds, or implement runtime behavior. It changes no DR001/DR002
golden, evaluator, threshold, compatibility predicate, dependency, database/schema, provider, UI,
deployment, or juror reasoning code.

The matrix is frozen by canonical serialization and SHA-256. A revision requires all of:

1. an explicit version/fingerprint change;
2. a stated product or contract reason;
3. success/failure coverage revalidation for every requirement;
4. review of impact on all already-authored cases and corpus fingerprint; and
5. exact-head PR review and merge evidence.

The known dependency audit remains tracked separately in GitHub Issue #29. No numeric capability
baseline is asserted in GZ1 because the current application cannot execute the proposed v2 journey.
