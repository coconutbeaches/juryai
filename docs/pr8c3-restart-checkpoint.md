# 8C3 restart checkpoint

Baseline: `57980807e02c8db3a2553766b5963b2c36a75ec2`.
Branch: `feat/pr8c3-agent-mediated-add-correct`.

## Restart and preflight

The previous first-party add/correct worktree and its incomplete edits are
preserved separately. This worktree starts from the exact merged baseline;
no implementation from the stopped run has been copied or cherry-picked.

On 2026-09-07, GitHub main still matched the baseline, Actions run
`34087871166` was completed/success, and the exact-head Supabase Preview check
was completed/success. A read-only production snapshot for Supabase project
`uxqhgjgkorgsoxwnkxne` passed all three validated V2.1.5 constraint checks
and the retained V2.1.4 checks. There were zero V2.1.5 disputes.

The Exact-Head Workflow and both P2 authority pages were fetched again. The
updated P2 page (2026-09-07T06:10:04.453Z) explicitly makes 8C3 agent-mediated.

## Governing boundary

Substantive additions and corrections use the existing `submit_turn` relay.
Sources remain `webmcp_agent_relay`. JuryAI will have no V2.1.5 testimony
textbox. First-party UI controls are limited to independent review and
non-testimonial authority/ceremony actions. No synthetic answer prefixes,
fourth tool, compiler changes, production actions, or live model calls.

## Baseline audit findings

1. **Routing can already express an exact correction bound.**
   `planCompile` in `src/v2-1-5/webmcp-application.ts` accepts an own requirement
   together with an own live position ID. The source retains routing separately
   from the answer, while the compiler receives the full own requirement context.
   The implementation must additionally enforce at most one own target and reject
   a supersession outside that bound. No new `submit_turn` field appears necessary.
2. **Semantic intent already belongs to frozen V0.4 interpretation.**
   `src/webmcp/compiler-v0-4/prompt.ts` requires explicit answer-level correction
   for `supersedes_candidate`, treats restatement as zero effect, and defaults
   new material to append. Target metadata must never manufacture that semantic
   decision. Server admission must independently constrain its maximum target.
3. **Current target discovery is incomplete.**
   `projectPartyCaseStateV215` returns only the last five live positions, including
   disclosed opponent positions. `get_case_state` has no current-position lookup
   or pagination. An older own proposition can be unavailable to a fresh agent.
   A bounded V2.1.5 state extension needs a complete discovery path, strict response
   decoding and historical dispatch isolation; silently increasing the recent
   window does not guarantee discovery.
4. **The unconfirmed final-confirmation dead-end remains.**
   Relay mutation permits only independent formation or challenge response.
   Protected reopen requires the party binding to be confirmed. A distinct
   first-party, non-testimonial return-to-edit action is needed for an unconfirmed
   party in final confirmation. A workflow-only state change is insufficient:
   workflow is excluded from party projection, so existing acknowledgments would
   remain current. Its epoch/receipt invalidation and retry/CAS design must be
   explicit before implementation. Existing confirmed-material HHC3 reopen must
   remain separate and intact.

## Implementation decisions

The complete instruction has now been received.

- Reuse `submit_turn.in_reply_to`: own requirement(s) for ADD, or one exact own
  requirement plus one exact own live position for bounded CORRECT. Existing
  challenge/response routing keeps its distinct authority. Reject multiple own
  correction targets and supersessions outside the selected bound. V0.4 proposes
  correction only from explicit answer meaning; routing never forces replacement.
- Add a versioned V2.1.5 state response with a bounded `own_repair_targets` page
  (50 current own positions) and a version-bound continuation cursor. An optional
  cursor on `get_case_state` retrieves the next page; stale cursors fail closed.
  Current own requirement IDs/prompts are included so ADD remains possible after
  coverage is complete. Historical request/response decoders remain authoritative
  for historical generations. No `submit_turn` schema field is added.
- Keep original answer bytes, assistant-only context, exact grounding, qualified
  compiler identity and append-only submission audits. Existing party-scoped
  fingerprints already bind routing IDs. Replay precedes version/model checks;
  rebase must revalidate live target under the transaction lock without recompiling.
- Add a distinct V2.1.5 `return_unconfirmed_to_edit` ceremony, available only to the
  authenticated own party in disclosed final confirmation whose binding is not
  confirmed. A first-party button records this non-testimonial intent. It increments
  the own formation epoch, appends a first-party epoch event, moves to challenge
  response and naturally stales own acknowledgment. It never writes source testimony.
  The existing epoch-event structure and command audit faithfully retain this action.
- Return-to-edit uses a party-scoped stable request key and review-state binding;
  replay happens under the row lock before stale-state checks. A single +1 command
  and its audit commit atomically. Protected confirmed-material HHC3 reopen remains
  unchanged, and its availability follows binding edit state even if its receipt
  has become stale. Subsequent semantic repair remains exclusively agent-mediated.
- No migration is required. Existing JSON command/submission audits, epoch history,
  replay/CAS and source provenance structures suffice. No production action, model
  call or merge is authorized. Verify historical byte/behavior parity and the
  unchanged three-tool surface before the required read-only red team and review.

## Local verification before pre-review red team

- Non-PostgreSQL suite: 102 files, 3,413 passing tests, including frozen compiler
  replays, historical generation guards, and the real browser graph boundary.
- Isolated PostgreSQL 14: V2.1.5 27 passing; V2.1.4 22 passing;
  V2.1.3 17 passing; V2.1.2 production/disclosure 19 passing. Each historical
  generation used its own database and matching migration boundary.
- Typecheck, repository formatting, browser build, CI test coverage, and
  production dependency audit pass (zero audit vulnerabilities).
- Historical V2.1.2–V2.1.4 directories, frozen V0.4 compiler directory, and all
  migration files are byte-identical to the baseline. Shared machinery uses
  explicit V2.1.5 wiring; historical constructors retain their existing behavior.
- Own target pages preserve complete statements within the existing 50,000-character
  V2.1.5 independent-review bound. A regression distinguishes two statements whose
  first 12,000 characters match. The recent-five preview remains unchanged.
- No production writes, migration, model call, application deployment, or merge.
