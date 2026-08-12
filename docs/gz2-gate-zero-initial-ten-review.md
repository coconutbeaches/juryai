# GZ2 — First ten canonical cases and adversarial review

Status: frozen for GZ2 review. This milestone authors and reviews the first ten cases only. It does not freeze the full corpus, establish a current-runtime baseline, or implement v2 runtime behavior.

## Executable scope

- Fixture contract: `juryai-gate-zero-case-fixture-v1.0.0`
- Coverage matrix: `juryai-gate-zero-coverage-matrix-v1.0.0`
- Turn oracle: `juryai-gate-zero-turn-oracle-v2.1.0`
- Cases: `gz_case_001` through `gz_case_010`
- Ordered turns: 104
- Provider calls required: zero

Each authored turn declares the actor, visible and embargoed context, immutable source registry, command, operation permission partition, exact mutation/no-mutation identity, authority fragments, evidence effects, confirmation invalidation, transition and lock effects, failure code, allowed facts, and forbidden factual promotions. The authoring session executes that declaration through the merged GZ0 pure command contract and fails immediately if the actual result differs.

## Adversarial review results

| Case | Primary boundary                    | Adversarial result                                                                                                                                                                                                                                           |
| ---- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 001  | Identity and consent                | Fresh parties are unbound; pending consent is inert; a party cannot self-verify; Person B cannot bind or consent before invitation.                                                                                                                          |
| 002  | Story through Person A confirmation | Brief story remains attributed; classification is code-owned; only one next target is exposed; silence cannot complete the catch-all; confirmation is explicit.                                                                                              |
| 003  | Unsafe triage                       | Party classification and guard-inconsistent ejection fail; unsafe terminal state rejects later formation.                                                                                                                                                    |
| 004  | Grounding and delayed correction    | An inexact UTF-16 span fails; ambiguity remains open; a later exact correction applies; a stale expected-prior value cannot overwrite it.                                                                                                                    |
| 005  | CAS and command identity            | Exact retry is idempotent; conflicting command identity, stale version, stale hash, and execution-actor mismatch are exact no-mutation.                                                                                                                      |
| 006  | Ownership and atomicity             | Each party may introduce its own assertion; cross-party edit/withdrawal fails; a valid first operation rolls back when the second operation is forbidden.                                                                                                    |
| 007  | Person B embargo                    | B is invited before binding, cannot act before consent, receives no detailed A material before an independent account, and receives detailed disclosure only afterward.                                                                                      |
| 008  | Evidence lifecycle                  | Description is not proof; bytes are immutable; incomplete/unreadable inspection stays ineligible; disclosure does not cure unreadability; authorship dispute, withdrawal, and supersession become canonical state.                                           |
| 009  | Confirmation and bilateral lock     | Material change invalidates confirmations; blockers prevent confirmation/transition; stale confirmation context and wrong lock mode fail; locked edits fail.                                                                                                 |
| 010  | Reopen and projection               | Locked mutation fails; inexact or absent reopen grounding fails; valid reopen retains the prior lock, requires correction and bilateral reconfirmation, then relocks; the exact projection excludes ineligible evidence and rejects audit-journal injection. |

## Narrow GZ0 contract corrections revealed by authoring

1. **Execution actor representation.** An `authentication_mismatch` oracle must preserve the command's claimed actor and the different authenticated execution actor. Ordinary actor mismatch remains invalid fixture structure.
2. **Expected failure inputs.** An inexact command source reference is valid oracle input only when `invalid_source_reference` is the expected result. Sources cited as expected facts, authority, or promotions must always remain exact.
3. **Evidence disposition vocabulary.** `withdrawn` and `superseded` existed in the envelope schema but no command could reach them. `set_own_evidence_availability` now permits only the submitting party, requires an exact party-attributed source, and requires an atomic same-party replacement for supersession.
4. **Authorship dispute state.** Recording an evidence-authorship challenge now sets the challenging party's canonical stance and the evidence `authenticity_status` to `disputed`; the challenge is not left only in a journal.
5. **Reopen grounding.** `reopen_material_change` now requires at least one exact source. Party-attributed sources remain valid because reopening is the safe action: it unlocks, retains the prior lock receipt, invalidates confirmations, and requires reconfirmation rather than promoting the assertion as fact.
6. **Projection oracle.** Case fixtures may freeze an exact deterministic adjudication input for a final locked envelope. This makes projection exclusion testable without inventing a chat or evaluator runtime.
7. **Permission and confirmation precision.** The permission partition now honors Person-B-only scope, and confirmation invalidation lists only receipts that actually existed before a material change.
8. **Closed fixture provenance.** Every source already referenced by a synthetic starting envelope is registered and exact; fixture classification cannot rely on an unsupported placeholder source.

No oracle was weakened to match current product behavior. These changes close unreachable or unrepresented states in the merged boundary contract and remain deterministic.

## Scale-out decision

The first ten now cover sufficiently different failure modes to proceed to GZ3. GZ3 may serialize and hash-freeze the complete 36-case corpus using the same authoring and validation contract. Any later ambiguity must be surfaced explicitly; observed current-runtime limitations must not be converted into expected corpus behavior.

## Protected boundaries

No legacy evaluator, DR001/DR002 golden, DR002 acceptance threshold, provider integration, database/schema, UI, deployment, or juror reasoning code is changed. No v2 conversational runtime is implemented.
