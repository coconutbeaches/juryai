# PR 7: additive explicit-absence semantics

Base: `f4a663f5d22c2f2ce6498cdd087a0b8be1f72810`.
No merge, deployment, production query, canary mutation, conversion or backfill.

## Architecture checkpoint

The defect is a missing canonical truth-state. The historical binding-deadline
requirement accepts only contractual_deadline, non_recollection and
declined_to_answer. A factual denial cannot honestly become any of these.

The complete dependency chain is:

`public PropositionType -> core proposition/requirement/compiler input-output -> compiler taxonomy/schema/prompt -> relay candidate/effect/submission -> canonical position/requirements -> party formation projection/readback -> confirmation and disclosure-review acknowledgment -> PartyReviewState -> protected action containing the exact ceremony command -> persistence contract-pair constraints -> production routing and browser decoders`.

V2.1.2 reuses V2.1.1 semantic validation, relay execution, projection/readback
and review receipts. Those adapters are unsuitable for the new vocabulary:
V2.1.3 executes its own domain directly, with no old-command authorization,
translation, relabeling, or historical-envelope execution view. The minimal
semantic change still crosses every serialized link above. The explicit new
modules intentionally isolate that contract generation instead of turning the
historical validators into configurable, mutable vocabularies.

## Semantic definition

`explicit_absence`: the attributed party affirmatively asserts that the fact,
obligation, event, amount, item or condition asked about does not exist, did not
occur, or is none/zero where that is a meaningful direct answer to the requirement.
This is a party-attributed factual assertion, not proof, adjudication, omission,
non-recollection or refusal. Qualification remains visible in epistemic strength.

The compiler must preserve the subject in its statement. Its new prompt forbids
inference from omission, assistant text, hypothetical negatives and an opponent's
unadopted denial. Full answer citations retain denial, uncertainty and attribution;
parser, compiler validator, relay and envelope validator enforce that provenance.
They do not pretend that substring equality proves a model's semantic interpretation.
The checked-in evaluation is provider-seam replay, not measured live-model accuracy.

## Contract decisions

| Surface                                              | Additive contract                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Browser/public core and protocol                     | `juryai-webmcp-core-v0.3.0`, `juryai-webmcp-protocol-v0.3.0`                                                              |
| Propositions / requirements                          | `juryai-webmcp-propositions-v0.3.0`, `juryai-webmcp-requirements-v0.3.0`                                                  |
| Compiler contract / input                            | `juryai-webmcp-compiler-contract-v0.3.0`, `juryai-compiler-input-v0.3.0`                                                  |
| Compiler taxonomy / prompt / renderer                | `juryai-p2-v0.3.0`, `juryai-semantic-compiler-prompt-v0.3.0`, `juryai-compiler-input-render-v0.3.0`                       |
| Initial requirement set                              | `juryai-p2-initial-requirements-v0.3.0`                                                                                   |
| Envelope / protocol / ceremony command               | `juryai-case-envelope-v2.1.3`, `juryai-formation-protocol-v2.1.3`, `juryai-envelope-command-v2.1.3`                       |
| Relay submission                                     | `juryai-external-relay-submission-v2.1.3`                                                                                 |
| Formation projection / readback                      | `juryai-party-formation-projection-v2.1.3`, `juryai-party-formation-readback-v2.1.3`                                      |
| Confirmation / disclosure acknowledgment / readiness | `juryai-party-confirmation-v2.1.3`, `juryai-disclosure-review-acknowledgment-v2.1.3`, `juryai-formation-readiness-v2.1.3` |
| Party review state                                   | `juryai-party-review-state-v1.1.0` (embeds versioned projection/readback)                                                 |
| Protected action                                     | `juryai-party-review-protected-action-v1.2.0`, bound only to V2.1.3 commands                                              |
| Review page                                          | `juryai-v2.1.3-first-party-review-page-v1.0.0`                                                                            |
| Persistence audit/replay                             | `juryai-v2.1.3-formation-persistence-v1`                                                                                  |

Historical public/core/compiler, V2.1.1 and V2.1.2 modules are byte-frozen against
the base manifest. Historical compiler artifacts remain reproducible with their
own modules. New compiler artifacts store their exact prompt, config/schema hash,
taxonomy and input version, using the existing append-only audit mechanism.

Reuse unchanged: generic intent-assurance V1, invitation V2.1 contract, source
turn payload/span format and hashing, non-coercible pairs, and relay _intent_
V2.1.1 (raw answer/version/hash only; no proposition vocabulary). No fourth tool.
No business authority table or column. No P1, P3 or email changes.

The HHC-3 policy profile ID is also reused: its minimum assurance levels did not
change. The model response-schema name is `juryai_semantic_compiler_output_v03`;
the new offline fixture/oracle version is `juryai-explicit-absence-eval-v1.0.0`.
The new compiler audit JSON adds the exact registry entry and original input/output
run snapshot under the new persistence contract, including source text, prompt and
config artifacts. It remains private, append-only and outside all public projections.
The repository verifies that the saved artifact reproduces the committed hashes.

## Requirement-set decisions

All ten initial questions admit a meaningful explicit none answer, for different
reasons: requested scope can be unsolicited; accepted scope can be denied;
binding deadline and expected date can each independently be absent; invoice,
payment and disputed balance can be zero/none; a respondent can seek no remedy;
the opponent may have offered no explanation; own performance can explicitly
deny _nonperformance_. These decisions are individually documented in
`EXPLICIT_ABSENCE_REQUIREMENT_DECISIONS_V213`; future sets must opt in explicitly.

Satisfaction remains exact requirement identity + type membership + cardinality.
No string matching, similarity or model readiness decision enters that evaluator.
Target dates cannot satisfy binding deadlines. Multiple absence propositions
still obey cardinality and same-slot collision rules.

## Persistence and production

One migration extends three exact paired constraints: envelope schema/protocol
(including projection/command/ack shape), schema/relay submission, and protected
action/command. No independent version IN-lists. Valid historical pairs stay valid;
cross-pairs and missing new pairing fields fail closed. Existing constraint names
remain for historical repository readiness checks.

The same single `JURYAI_V212_PRODUCTION_ENABLED` switch gates the current writer;
its name is cosmetic debt, deliberately not migrated. New starts write V2.1.3.
The deterministic start identity remains stable so retries of an already-created
V2.1.2 start resolve to that persisted case instead of making another dispute.
Explicit dispute reads/writes, first-party actions and invitation redemption
select their version from persisted schema. No prefix-to-newest routing.
Legacy `case_` traffic remains legacy; multiple active contexts fail closed.

The failed production canary
`dispute_8f298b3cb56cf05aee8888068e0836088f0867be1425a0e2528707087919448e`
remains untouched, historically readable and not retroactively completable.
The tests use only isolated synthetic disputes. A fresh live canary is deferred
until a separately authorized merge/deployment.

## Verification scope

The exact real-canary answer passes through the actual new compiler/parser using
a fixed provider response, then through the new application and relay. It resolves
only B's binding-deadline requirement, keeps the separate target date, creates no
clarification and reaches bilateral HHC-3 readiness through disclosure, challenge,
response, acknowledgments and final confirmations. This is a deterministic pipeline
regression, not a live provider or production canary.

The new replay corpus has 22 cases and 24 deliberate semantic mutation traps,
including both date-coercion directions, false absence, dropped uncertainty,
non-recollection, refusal, omission, opponent attribution and prompt injection.
The exact replay oracle runs only in evaluation; it is not readiness logic.
Malformed-output and provenance guards also run under the new contract.

The PostgreSQL tests run on nine independent local databases, mirroring CI's
separate migration stages. They check exact old and new protected-action pairings,
cross-pair rejection, row identity (`ctid`, `xmin`, JSON), current compiler artifact
reproduction/tamper rejection, authoritative version resolution, and existing
atomicity, invitation, idempotency and assurance behavior. CI uses PostgreSQL 16;
the local test server is PostgreSQL 14.18. No shared database is used.
