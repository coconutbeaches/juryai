# GZ0: v2 Formation and Adjudication Boundary Contract

- Status: frozen executable contract for Gate Zero corpus design
- Schema: `juryai-case-envelope-v2.0.0`
- Protocol: `juryai-formation-protocol-v2.0.0`
- Command: `juryai-envelope-command-v2.0.0`
- Adjudication input: `juryai-adjudication-input-v2.0.0`

This document implements the accepted JuryAI Architecture Revision v2 boundary. It does not
implement conversational intake, a Person B model path, juror reasoning, persistence, UI, or the
30–40-case Gate Zero corpus.

## Boundary

The intended product journey is:

```text
brief story → triage → incremental Person A formation → A confirmation
→ Person B independent account → disclosure/challenge → reconciliation
→ final confirmation → lock → deterministic adjudication input → adjudication
```

Models may propose commands. A proposal has no authority merely because it is structured or
source-grounded. Only deterministic code at the authenticated command boundary may commit a new
canonical envelope version. Source grounding proves what a source says; it does not establish that
the assertion is true.

The Case Envelope is the only operational state. Raw narratives and evidence bytes remain immutable
source material. Command ledgers are idempotency/audit context, not a second envelope. Chat history,
model rationale, rejected candidates, evaluator artifacts, and audit journals are not operational
state and are not adjudication input.

## Canonical namespaces

| Namespace            | Purpose                                                                                                                          | Why it is canonical                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `control`            | Case identity, workflow, envelope/record versions and hashes, protocol, eligibility, deadlines, active lock                      | Code-owned transition, CAS, release, and lock guards          |
| `parties`            | Stable A/B identity binding, assurance, consent, participation                                                                   | Authorization and fairness guards                             |
| `actors`             | Material non-party actors                                                                                                        | Avoids falsely assigning every actor to A or B                |
| `classification`     | Category, suitability, maturity, safety/scope flags, required-fact profile                                                       | Deterministic triage and formation requirements               |
| `agreements`         | Typed obligations and material terms                                                                                             | Agreement is not a catch-all event container                  |
| `events`             | Material occurrences, including disputed occurrences                                                                             | Occurrence assertions remain authority-qualified              |
| `payments`           | Minor-unit amount/currency, direction, status, due trigger, links                                                                | Separates money identity from obligations and events          |
| `deliverables`       | Expected scope plus each party's completion/defect positions                                                                     | Preserves incompatible accounts                               |
| `positions`          | Atomic assertions, admissions, denials, and uncertainty                                                                          | Does not overwrite another party's account                    |
| `claimed_losses`     | Monetary or permitted non-monetary claimed loss and causal/support links                                                         | A claimed loss is not an established loss                     |
| `requested_outcomes` | Requested remedies/transfers/actions                                                                                             | A request is not a finding of entitlement                     |
| `evidence`           | Identity, availability, disclosure, inspection, authenticity-not-assessed, eligibility                                           | Keeps inspection, authenticity, and adjudicative use distinct |
| `formation`          | Requirements, ambiguities, uncertainty, confirmations, challenges, disclosure, non-participation, lock history, material changes | Small state needed to form and freeze a fair record           |

`envelope_version` identifies every accepted canonical command result, including control-only
changes. `record_version` changes only for material formation/record changes. The separate hashes let
confirmations remain bound to a material record while still recording the exact envelope snapshot
the party reviewed.

## Authority and party positions

Every substantive object carries `ObjectAuthority`:

- authenticated introducing actor and typed authority;
- exact immutable source identities and optional UTF-16 spans;
- subject actors and evidence links;
- an explicit stance for each party;
- deterministically derived resolution status;
- adjudication eligibility; and
- introducing and last-material-change record/command identities.

The authority vocabulary is closed: party assertion, party admission, bilateral agreement,
system observation, inspected-evidence-derived, adjudicative finding, or another explicitly typed
authority. There is deliberately no `model_inference` authority.

Party stance is one of asserted, admitted, disputed, unresolved, lacks information, unresponded, or
withdrawn. `bilaterally_agreed` is derived only when both parties explicitly adopt the proposition.
Unresponded, lacks-information, and silence remain unresolved. A's confirmation cannot establish B's
intent.

## Authenticated command and CAS contract

Every mutation uses `EnvelopeCommand` with a command ID, exact authenticated actor, case ID, base
envelope version/hash, closed operations, source references, and optional confirmation context.

Deterministic outcomes:

| Condition                                    | Outcome                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| Valid command                                | Entire operation set applies; exactly one envelope version and hash result |
| Material valid command                       | Also increments record version/hash; clears coarse party confirmations     |
| Stale version or wrong base hash             | Typed rejection; exact no-mutation                                         |
| Identical retry of command ID                | Idempotent; no second version                                              |
| Same command ID, different canonical payload | `duplicate_command_conflict`; exact no-mutation                            |
| Actor/execution-context mismatch             | `authentication_mismatch`; exact no-mutation                               |
| Unauthorized or cross-party change           | Typed rejection; exact no-mutation                                         |
| Missing, stale, or inexact source reference  | `invalid_source_reference`; exact no-mutation                              |
| One invalid operation in a set               | Entire command rejected; no partial application                            |
| Material operation against active lock       | `locked_envelope`; explicit reopen required                                |

Canonical serialization accepts only bounded plain JSON: no cycles, accessors, symbols, sparse or
custom arrays, non-finite numbers, or non-plain prototypes. Hashes are SHA-256 over deterministic
sorted-key projections. The in-memory ledger proves retry semantics; it is not canonical case state.

The mutation vocabulary is closed and domain-specific rather than generic JSON Patch. It permits
adding a typed party object, replacing allowlisted fields on one's own object with an expected-prior
value, setting one's own stance, and explicit system/inspector operations for classification,
formation, participation, evidence, disclosure, confirmation, transition, lock, and reopen.

Party object writes are allowed only in that party's formation phase or shared
disclosure/reconciliation/final-confirmation phases. Classification, workflow, participation,
eligibility, evidence inspection, visibility, protocol policy, and locks are code-owned. Inspection
requires an authenticated inspector. `OPERATION_PERMISSIONS` is executable and is checked before
operation dispatch.

## Formation transitions

Only the system may initiate a transition, and each transition has deterministic guards.

| Event                                 | From                         | To                    | Principal guards                                     |
| ------------------------------------- | ---------------------------- | --------------------- | ---------------------------------------------------- |
| `initial_story_received`              | initial story                | triage                | source present                                       |
| `triage_eligible`                     | triage                       | A formation           | eligible; fact profile selected                      |
| `triage_unsuitable` / `triage_unsafe` | triage                       | terminal ejection     | ineligible or safety flag                            |
| `person_a_record_ready`               | A formation                  | A confirmation        | no required fields/blockers                          |
| `person_a_confirmed`                  | A confirmation               | awaiting B            | current A confirmation                               |
| `person_b_invited`                    | awaiting B                   | B independent account | invitation recorded; embargo active                  |
| `non_participation_documented`        | B independent account        | final confirmation    | advisory protocol, notice/deadline/opportunity proof |
| `responses_complete`                  | disclosure/challenge         | reconciliation        | no open challenges                                   |
| `reconciliation_complete`             | reconciliation               | final confirmation    | no required fields/blockers                          |
| `final_confirmations_complete`        | final confirmation           | ready for lock        | current required confirmation                        |
| lock operation                        | ready for lock               | locked                | mode-specific guards and evidence readiness          |
| `adjudication_started`                | locked                       | deliberation          | active lock                                          |
| recommendation outcome                | deliberation                 | resolved/unresolved   | active lock                                          |
| `case_withdrawn`                      | non-terminal formation state | withdrawn             | system event                                         |

An invalid actor, state/event pair, or failed guard produces a typed no-mutation result. A model does
not select or apply transitions.

## Person B embargo

Before B's independent account, detailed A framing is `embargoed`. The invitation layer may expose
only the minimal case context needed to request participation; the deliberate visible/hidden source
sets are represented in the Gate Zero oracle primitive. A `record_detailed_disclosure` operation
before a source-bound B independent-account event fails with `disclosure_embargo`.

The authenticated B account records its source identity, changes detailed A framing to `permitted`,
and enters disclosure/challenge. A separate system disclosure event changes it to `disclosed`. This
makes premature disclosure testable and auditable without treating UI prose as the guard.

## Evidence

Evidence byte identity, availability, visibility, inspection, authenticity, and adjudication
eligibility are independent dimensions. Uploading records a content hash but leaves authenticity
`not_assessed`. Inspection records immutable result ID/version/hash and limitations but is not an
authentication service. Disclosure or withholding records event identities.

Decision-relevant evidence is eligible only when uploaded, inspected without an unreadable result,
and disclosed to both parties. Described-only, withdrawn/superseded, uninspected, unreadable, or
undisclosed evidence remains explicitly excluded. The lock guard rejects any ineligible
decision-relevant evidence.

## Confirmation, lock, and material change

Confirmation is coarse at the party-record boundary for v2. A receipt records party, exact reviewed
envelope version/hash, current material record version/hash, timestamp, and event. Any material
command clears both coarse confirmations. Control-only commands do not change the material hash.

Two lock modes exist:

- `bilateral`: both current confirmations, B independent account, completed detailed disclosure,
  no formation blockers, and ready evidence. Output scope is `adjudication`.
- `documented_non_participation`: available only when the active protocol explicitly permits
  `advisory_only`, A has currently confirmed, B is explicitly non-participating, and invitation,
  notice, response deadline, deadline-expiry, and correction-opportunity records are complete.
  Silence is never converted to agreement, and output scope cannot claim bilateral adjudication.

A material change cannot edit a locked envelope. A system-owned `reopen_material_change` operation
records the source-bound trigger, preserves the complete old lock receipt, increments the material
record, clears confirmations, installs `reconfirmation_required`, unlocks, and returns to
reconciliation. Adjudication can resume only after blocker resolution, reconfirmation, and a new lock.

## Exact adjudication input

`buildAdjudicationInput` accepts only an exact envelope in `locked` state with a valid active lock.
Its deterministic projection includes:

- exact locked case/envelope/record/lock identities;
- active protocol identity and output scope;
- participation state and lock mode;
- adjudication-eligible structured objects with authority/status;
- unresolved/disputed object identities;
- eligible evidence content and inspection identities;
- excluded evidence identities plus deterministic exclusion reasons;
- claimed losses, requested outcomes, uncertainties; and
- deduplicated exact source references deliberately admitted by included objects/evidence.

It cannot include chat history, audit journals, hidden model rationale, rejected proposals,
undisclosed evidence content, stale envelope material, or arbitrary source material. Validation
rebuilds the projection from the exact locked envelope; adding even hash-bound arbitrary journal data
fails the projection check.

## Gate Zero oracle primitive

`GateZeroTurnOracle` freezes the fields GZ1 needs per turn: authenticated actor, visible and hidden
source IDs, exact base version/hash, command, permitted/forbidden operation types, exact
mutation/no-mutation and version deltas, expected authority/evidence/confirmation/transition/lock
effects, source requirements, and typed failure reason. This PR includes only adversarial contract
fixtures. GZ1 owns the 30–40-case end-to-end corpus and measurable journey gates.

## Relationship to the current repository

Classification is about the existing executable component, not whether a similarly named v0 field
can be reused conceptually.

| Current component                                           | Classification | v2 treatment                                                                                                                   |
| ----------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Triage/case-state fields in v0.1.2                          | Transitional   | Keep useful state names as migration evidence; v2 transition table and guards become operational authority                     |
| v0.1.2 Case Record schema                                   | Transitional   | Do not migrate production here; split formation state from adjudication/recommendation/audit concerns                          |
| One-shot Person A extraction                                | Transitional   | Historical/migration input only; incremental command formation replaces it as the product path                                 |
| Provenance and exact source spans                           | Keep           | Reuse immutable source hash and exact UTF-16 span principle on every substantive authority                                     |
| Deterministic repair                                        | Simplify       | Keep deterministic validation/normalization; do not make broad post-extraction repair a competing v2 state path                |
| Runtime assessment and clarification planning               | Transitional   | Useful question-selection evidence; not an implemented v2 conversational runtime                                               |
| Clarification-answer application                            | Transitional   | Preserve atomic fail-closed lessons; v2 commands/CAS replace the concrete A-only record application                            |
| Person A record confirmation                                | Simplify       | Keep exact hash binding; use coarse party-record receipts for both parties instead of A-specific packages as canonical state   |
| Challenge resolution                                        | Simplify       | Keep atomic expected-prior/source-bound corrections; move to item stance/reconciliation commands rather than a parallel record |
| Evidence inspection/readiness boundaries                    | Keep           | Preserve uninspected/non-shared exclusion and deterministic readiness; add explicit visibility and inspection-result identity  |
| DR001/DR002 goldens, alignment, evaluator, acceptance suite | Transitional   | Historical regression/migration evidence only; unchanged in GZ0                                                                |
| PR-specific frozen compatibility predicates                 | Remove later   | Preserve unchanged while legacy evaluation exists; retire with that path unless a v2 release-gate need is proved               |
| Person A-specific CLIs and orchestration                    | Transitional   | Useful harnesses during migration, not the two-party v2 state machine; retire after a proven replacement                       |
| Complete Person B formation path                            | New in v2      | Independent-account embargo, two-party positions, disclosure/reconciliation, confirmations, and locks                          |
| Canonical command/CAS and adjudication projection           | New in v2      | Sole mutation boundary and sole Level 3 input boundary                                                                         |

DR001 and DR002 remain untouched historical evidence. The frozen DR002 result remains 3 critical / 15
major / 16 minor / 34 total. The convergence marathon remains deferred with a presumption toward
retirement as the primary product program. It should resume only if Gate Zero proves the legacy
evaluator is required as a v2 migration/release gate or the same defect survives incremental v2
formation.

## Scope guard

GZ0 adds pure TypeScript contracts, validators, commands, fixtures, tests, this mapping, and one CI
matrix entry. It does not change the v0.1.2 schema, extraction, evaluator, alignment, DR goldens,
acceptance thresholds, frozen compatibility predicates, any remaining critical, dependencies,
database schema, provider, UI, deployment, or juror/recommendation reasoning.
