import { describe, expect, it } from 'vitest';
import {
  CaseRuntime,
  InMemoryCaseRuntimeStore,
  ScriptedSemanticCompiler,
  initialRequirementSet,
  recordingDiagnosticsSink,
  sequentialIdFactory,
  scriptedRegistryEntry,
  sequentialSaltFactory,
  steppingClock,
  type CaseRuntimeStore,
  type CompileOptions,
  type CompilerScript,
  type RuntimeRequestContext,
  type SemanticCompilerPort,
  type StoredCase,
  type SubmitTurnCommand,
  type SubmitTurnOutcome,
} from '../webmcp/runtime/index.js';
import {
  hashCanonicalState,
  projectCaseState,
  renderCanonicalAccount,
  type AttestationRecord,
  type CaseState,
} from '../webmcp/core/attestation.js';
import {
  assertNoForbiddenSlots,
  sha256,
  STRUCTURAL_VALIDATOR_VERSION,
  WEBMCP_CORE_SCHEMA_VERSION,
  WEBMCP_PROTOCOL_VERSION,
} from '../webmcp/core/types.js';
import { deriveReadiness } from '../webmcp/core/requirements.js';
import { computeRequestFingerprint } from '../webmcp/core/idempotency.js';
import {
  computePayloadCommitment,
  computeSourceTurnMetadataCommitment,
  normalizePayload,
  turnCarriesSpanFidelity,
  type SourceTurnPayload,
} from '../webmcp/core/turns.js';
import type { CompilerInput, CompilerOutput } from '../webmcp/core/compiler-contract.js';

/* ------------------------------------------------------------------------ */
/* Harness                                                                   */
/* ------------------------------------------------------------------------ */

const START_MS = Date.parse('2026-08-29T06:00:00.000Z');
const DISCLOSURE = 'juryai-disclosure-v0.2.0';

const ALICE: RuntimeRequestContext = {
  principal: { principal_id: 'user_alice' },
  relaying_agent: 'ChatGPT (gpt-x)',
};
const BOB: RuntimeRequestContext = {
  principal: { principal_id: 'user_bob' },
  relaying_agent: 'ChatGPT (gpt-x)',
};

function harness(
  options: {
    compiler?: SemanticCompilerPort;
    /** Wraps the store the runtime sees; assertions still read the inner one. */
    wrapStore?: (inner: InMemoryCaseRuntimeStore) => CaseRuntimeStore;
  } = {},
) {
  const store = new InMemoryCaseRuntimeStore();
  const scripted = new ScriptedSemanticCompiler();
  const compiler = options.compiler ?? scripted;
  const diagnostics = recordingDiagnosticsSink();
  const runtime = new CaseRuntime({
    store: options.wrapStore ? options.wrapStore(store) : store,
    compiler,
    clock: steppingClock(START_MS, 1000),
    ids: sequentialIdFactory(),
    salts: sequentialSaltFactory(),
    reviewUrl: (caseId) => 'https://juryai.test/cases/' + caseId,
    disclosure: { version: DISCLOSURE },
    diagnostics,
  });
  return { store, runtime, scripted, diagnostics };
}

function payload(answer: string, context: string[] = []): SourceTurnPayload {
  return normalizePayload({
    context: context.map((text) => ({ role: 'assistant' as const, text })),
    answer: { role: 'user', text: answer },
  });
}

async function startedCase(h: ReturnType<typeof harness>, who = ALICE) {
  const outcome = await h.runtime.startCase(who);
  if (outcome.kind !== 'created') throw new Error('expected a created case');
  return outcome.case.case_id;
}

async function loadState(h: ReturnType<typeof harness>, caseId: string): Promise<CaseState> {
  const stored = await h.store.cases.findById(caseId);
  if (!stored) throw new Error('case not found');
  return stored.state;
}

const EXPECTED_DATE_ANSWER = 'I expected it finished by April 25, and nobody ever said otherwise.';

const expectedDateScript: CompilerScript = () => ({
  verdict: 'accepted_candidates',
  assertions: [
    {
      quote: 'April 25',
      requirement_id: 'req_expected_date',
      type: 'target_date',
      epistemic_strength: 'recalled_uncertain',
      statement: 'The user expected the work to be finished by 25 April.',
    },
  ],
});

function submitCommand(
  overrides: Partial<SubmitTurnCommand> & { case_id: string },
): SubmitTurnCommand {
  return {
    expected_case_version: 0,
    in_reply_to: ['req_expected_date'],
    payload: payload(EXPECTED_DATE_ANSWER),
    client_turn_id: 'client_1',
    ...overrides,
  };
}

function committed(outcome: SubmitTurnOutcome) {
  if (outcome.kind !== 'committed') {
    throw new Error('expected a committed turn, got ' + outcome.kind);
  }
  return outcome;
}

/* ------------------------------------------------------------------------ */
/* start_case                                                                */
/* ------------------------------------------------------------------------ */

describe('startCase', () => {
  it('creates a version-0 draft carrying the canonical requirement set', async () => {
    const h = harness();
    const outcome = await h.runtime.startCase(ALICE);

    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') return;
    expect(outcome.case.case_version).toBe(0);
    expect(outcome.case.status).toBe('draft');
    expect(outcome.case.unresolved_requirement_count).toBe(initialRequirementSet().length);
    expect(outcome.case.review_url).toBe('https://juryai.test/cases/' + outcome.case.case_id);

    const state = await loadState(h, outcome.case.case_id);
    expect(state.requirements.map((r) => r.requirement_id)).toEqual(
      initialRequirementSet().map((r) => r.requirement_id),
    );
    expect(state.propositions).toEqual([]);
    expect(state.clarifications).toEqual([]);
    expect(state.evidence_references).toEqual([]);
    expect(state.turn_log).toEqual([]);
    expect(state.attestations).toEqual([]);
  });

  it('records the disclosure the principal accepted at creation', async () => {
    const h = harness();
    const caseId = await startedCase(h);
    const state = await loadState(h, caseId);

    expect(state.disclosure_version).toBe(DISCLOSURE);
    expect(state.disclosure_accepted_at).toBe(new Date(START_MS).toISOString());
    expect(state.principal_id).toBe('user_alice');
  });

  it('returns OPEN_DRAFT_EXISTS instead of silently resuming, and mutates nothing', async () => {
    const h = harness();
    const caseId = await startedCase(h);
    const before = await h.store.cases.findById(caseId);

    const second = await h.runtime.startCase(ALICE);
    expect(second.kind).toBe('open_draft_exists');
    if (second.kind !== 'open_draft_exists') return;
    expect(second.case.case_id).toBe(caseId);
    expect(second.case.case_version).toBe(0);

    const after = await h.store.cases.findById(caseId);
    expect(after?.revision).toBe(before?.revision);
    expect(after?.state).toEqual(before?.state);
  });

  it('keeps drafts per principal', async () => {
    const h = harness();
    const alice = await startedCase(h, ALICE);
    const bob = await startedCase(h, BOB);

    expect(bob).not.toBe(alice);
    expect((await loadState(h, bob)).principal_id).toBe('user_bob');
  });

  it('emits only permitted response slots', async () => {
    const h = harness();
    const outcome = await h.runtime.startCase(ALICE);
    if (outcome.kind !== 'created') throw new Error('expected creation');
    expect(assertNoForbiddenSlots(outcome.case as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('refuses to act without an authenticated principal', async () => {
    const h = harness();
    const outcome = await h.runtime.startCase({ principal: { principal_id: '  ' } });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('AUTH_REQUIRED');
  });
});

/* ------------------------------------------------------------------------ */
/* get_case_state                                                            */
/* ------------------------------------------------------------------------ */

describe('getCaseState', () => {
  it('returns exactly the canonical core projection', async () => {
    const h = harness();
    const caseId = await startedCase(h);
    const outcome = await h.runtime.getCaseState(ALICE, { case_id: caseId });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    const state = await loadState(h, caseId);
    expect(outcome.case).toEqual(
      projectCaseState(state, { review_url: 'https://juryai.test/cases/' + caseId, warnings: [] }),
    );
    expect(assertNoForbiddenSlots(outcome.case as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('recovers the authenticated principal active draft with no case id', async () => {
    const h = harness();
    const caseId = await startedCase(h);
    const outcome = await h.runtime.getCaseState(ALICE);

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.case.case_id).toBe(caseId);
  });

  it('reports a foreign case as not found rather than as forbidden', async () => {
    const h = harness();
    const caseId = await startedCase(h, ALICE);
    const outcome = await h.runtime.getCaseState(BOB, { case_id: caseId });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('CASE_NOT_FOUND');
  });

  it('reports no active draft as not found', async () => {
    const h = harness();
    const outcome = await h.runtime.getCaseState(ALICE);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('CASE_NOT_FOUND');
  });
});

/* ------------------------------------------------------------------------ */
/* submit_turn — happy path                                                  */
/* ------------------------------------------------------------------------ */

describe('submitTurn', () => {
  it('records a canonical proposition from accepted candidates and moves the version 0 -> 1', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);

    const outcome = committed(
      await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })),
    );
    expect(outcome.case.case_version).toBe(1);
    expect(outcome.accepted_proposition_ids).toHaveLength(1);
    expect(outcome.warnings).toEqual([]);

    const state = await loadState(h, caseId);
    expect(state.case_version).toBe(1);
    expect(state.turn_log).toHaveLength(1);
    expect(state.propositions).toHaveLength(1);

    const proposition = state.propositions[0]!;
    expect(proposition.type).toBe('target_date');
    expect(proposition.in_reply_to).toBe('req_expected_date');
    expect(proposition.created_at_case_version).toBe(1);
    expect(proposition.statement).toBe('The user expected the work to be finished by 25 April.');
    expect(proposition.derived_from_turn_ids).toEqual([state.turn_log[0]!.turn_id]);
    expect(proposition.spans.every((span) => span.turn_id === state.turn_log[0]!.turn_id)).toBe(
      true,
    );
    expect(proposition.spans.some((span) => span.region === 'answer')).toBe(true);
    expect(proposition.spans[0]!.quote).toBe('April 25');
    expect(proposition.compile_run_id).toBe(state.turn_log[0]!.compile_run_id);
    expect(proposition.compiler_version_id).toBe(h.scripted.registryEntry.compiler_version_id);
  });

  it('writes server-owned turn metadata and never accepts it from the caller', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId, source_language: 'de' }));

    const turn = (await loadState(h, caseId)).turn_log[0]!;
    expect(turn.principal_id).toBe('user_alice');
    expect(turn.case_version_before).toBe(0);
    expect(turn.received_at).toBe(new Date(START_MS + 2000).toISOString());
    expect(turn.payload_commitment).toBe(
      computePayloadCommitment(turn.payload, turn.payload_commitment_salt),
    );
    // Relay self-reports are recorded, not trusted, and not promoted.
    expect(turn.source_language).toBe('de');
    expect(turn.translation_indicated).toBe(false);
    expect(turn.relaying_agent).toBe('ChatGPT (gpt-x)');
  });

  it('keeps relayed provenance on the turn and on everything derived from it', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    const outcome = committed(
      await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })),
    );

    const state = await loadState(h, caseId);
    expect(state.turn_log[0]!.source_channel).toBe('webmcp_agent_relay');
    expect(state.propositions[0]!.source_channel).toBe('webmcp_agent_relay');
    expect(state.propositions[0]!.relaying_agent).toBe('ChatGPT (gpt-x)');
    expect(outcome.recorded[0]!.attribution).toContain('as relayed by ChatGPT (gpt-x)');
    expect(outcome.recorded[0]!.attribution).not.toContain('verbatim');
  });

  it('preserves the in_reply_to relationship, sorted and de-duplicated', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    await h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        in_reply_to: ['req_paid', 'req_expected_date', 'req_expected_date'],
      }),
    );

    const state = await loadState(h, caseId);
    expect(state.turn_log[0]!.in_reply_to).toEqual(['req_expected_date', 'req_paid']);
    expect(state.propositions[0]!.in_reply_to).toBe('req_expected_date');
  });

  it('rejects a turn answering a requirement the case does not have', async () => {
    const h = harness();
    const caseId = await startedCase(h);
    const outcome = await h.runtime.submitTurn(
      ALICE,
      submitCommand({ case_id: caseId, in_reply_to: ['req_invented'] }),
    );

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('INVALID_INPUT');
    expect((await loadState(h, caseId)).turn_log).toHaveLength(0);
  });

  it('refuses a foreign principal', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h, ALICE);
    const outcome = await h.runtime.submitTurn(BOB, submitCommand({ case_id: caseId }));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('CASE_NOT_FOUND');
    expect((await loadState(h, caseId)).turn_log).toHaveLength(0);
  });
});

describe('submitTurn input hardening', () => {
  it('rejects a malformed command instead of throwing', async () => {
    const h = harness();
    const caseId = await startedCase(h);

    const malformed = [
      { case_id: caseId, payload: undefined as unknown as SourceTurnPayload },
      { case_id: caseId, payload: { context: [], answer: {} } as unknown as SourceTurnPayload },
      { case_id: caseId, in_reply_to: 'req_paid' as unknown as string[] },
      { case_id: '' },
    ];
    for (const overrides of malformed) {
      const outcome = await h.runtime.submitTurn(ALICE, submitCommand(overrides));
      expect(outcome.kind).toBe('failed');
      if (outcome.kind !== 'failed') continue;
      expect(outcome.failure.code).toBe('INVALID_INPUT');
    }
    expect((await loadState(h, caseId)).turn_log).toHaveLength(0);
  });

  it('commits nothing when the compiler throws, and leaves the retry key fresh', async () => {
    const h = harness();
    h.scripted.setScript(() => {
      throw new Error('compiler unavailable');
    });
    const caseId = await startedCase(h);

    const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('INTERNAL_ERROR');
    expect(outcome.failure.retryable).toBe(true);
    expect(h.diagnostics.events.map((event) => event.kind)).toContain('compiler_threw');

    const state = await loadState(h, caseId);
    expect(state.turn_log).toHaveLength(0);
    expect(state.case_version).toBe(0);
    expect(await h.store.idempotency.listByCase(caseId)).toEqual([]);

    // The same client_turn_id is still usable, because nothing was recorded.
    h.scripted.setScript(expectedDateScript);
    const retry = committed(await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })));
    expect(retry.case.case_version).toBe(1);
  });

  it('says so when a relay reports the answer was translated', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);

    const outcome = committed(
      await h.runtime.submitTurn(
        ALICE,
        submitCommand({ case_id: caseId, source_language: 'de', translation_indicated: true }),
      ),
    );
    expect(outcome.warnings.join(' ')).toContain('translation');
    const turn = (await loadState(h, caseId)).turn_log[0]!;
    expect(turn.translation_indicated).toBe(true);
    expect(turnCarriesSpanFidelity(turn)).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* submit_turn — idempotency, CAS and recovery                               */
/* ------------------------------------------------------------------------ */

describe('submitTurn idempotency', () => {
  it('replays an identical client_turn_id without creating anything new', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    const first = committed(await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })));

    const replay = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));
    expect(replay.kind).toBe('replayed');
    if (replay.kind !== 'replayed') return;
    expect(replay.match).toBe('client_turn_id');
    expect(replay.turn_id).toBe(first.turn_id);
    expect(replay.accepted_proposition_ids).toEqual(first.accepted_proposition_ids);
    expect(replay.recorded_at_case_version).toBe(1);

    const state = await loadState(h, caseId);
    expect(state.case_version).toBe(1);
    expect(state.turn_log).toHaveLength(1);
    expect(state.propositions).toHaveLength(1);
    expect(await h.store.compileRuns.listByCase(caseId)).toHaveLength(1);
  });

  it('recovers a lost response: replay resolves BEFORE the version check', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);

    // 1-2. The turn commits; the caller never sees the response.
    const first = committed(await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })));

    // 3-4. The caller retries the identical request, still believing version 0.
    const retry = await h.runtime.submitTurn(
      ALICE,
      submitCommand({ case_id: caseId, expected_case_version: 0 }),
    );

    // 5-6. Idempotency wins over the stale CAS, and the prior result comes back.
    expect(retry.kind).toBe('replayed');
    if (retry.kind !== 'replayed') return;
    expect(retry.turn_id).toBe(first.turn_id);

    const state = await loadState(h, caseId);
    expect(state.turn_log).toHaveLength(1);
    expect(state.propositions).toHaveLength(1);
    expect(state.case_version).toBe(1);
  });

  it('catches a regenerated retry by fingerprint even when the version was refreshed', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    const first = committed(await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })));

    // The model regenerated the tool call: new client id, jittered punctuation,
    // context depth changed, and it refreshed expected_case_version first.
    const regenerated = await h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        client_turn_id: 'client_2',
        expected_case_version: 1,
        payload: payload('I expected it finished by April 25 — and nobody ever said otherwise!', [
          'Just to confirm the date?',
        ]),
      }),
    );

    expect(regenerated.kind).toBe('replayed');
    if (regenerated.kind !== 'replayed') return;
    expect(regenerated.match).toBe('fingerprint');
    expect(regenerated.turn_id).toBe(first.turn_id);

    const state = await loadState(h, caseId);
    expect(state.turn_log).toHaveLength(1);
    expect(state.propositions).toHaveLength(1);
  });

  it('excludes expected_case_version from the fingerprint', async () => {
    const base = {
      principal_id: 'user_alice',
      case_id: 'case_1',
      in_reply_to: ['req_expected_date'],
      payload: payload(EXPECTED_DATE_ANSWER),
    };
    expect(computeRequestFingerprint(base)).toBe(computeRequestFingerprint({ ...base }));
  });

  it('returns a self-describing version conflict for a genuinely new stale write', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    const stale = await h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        client_turn_id: 'client_2',
        expected_case_version: 0,
        in_reply_to: ['req_paid'],
        payload: payload('I paid the deposit on 1 March.'),
      }),
    );

    expect(stale.kind).toBe('version_conflict');
    if (stale.kind !== 'version_conflict') return;
    expect(stale.current_case_version).toBe(1);
    expect(stale.likely_already_recorded).toBe(false);
    expect(stale.recent_turns).toHaveLength(1);
    expect(stale.recent_turns[0]!.answer_excerpt).toContain('April 25');
    expect(stale.case.case_version).toBe(1);

    const state = await loadState(h, caseId);
    expect(state.turn_log).toHaveLength(1);
    expect(state.propositions).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ */
/* submit_turn — compiler verdicts                                           */
/* ------------------------------------------------------------------------ */

describe('submitTurn compiler verdicts', () => {
  it('opens a clarification for an ambiguous verdict and records no proposition', async () => {
    const h = harness();
    h.scripted.setScript(() => ({
      verdict: 'ambiguous',
      clarifications: [
        {
          requirement_id: 'req_expected_date',
          reason: 'multiple_incompatible_readings',
          prompt: 'Did you mean a date you hoped for, or one that was agreed?',
        },
      ],
    }));
    const caseId = await startedCase(h);

    const outcome = committed(
      await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })),
    );
    expect(outcome.accepted_proposition_ids).toEqual([]);
    expect(outcome.opened_clarification_ids).toHaveLength(1);
    expect(outcome.case.case_version).toBe(1);
    expect(outcome.case.open_clarifications).toHaveLength(1);
    expect(outcome.warnings[0]).toContain('clarification');

    const state = await loadState(h, caseId);
    expect(state.propositions).toEqual([]);
    expect(state.clarifications[0]!.opened_at_case_version).toBe(1);
    expect(state.clarifications[0]!.resolved_at_case_version).toBeNull();
  });

  it('fabricates nothing for a no_assertions verdict and does not move the version', async () => {
    const h = harness();
    h.scripted.setScript(() => ({ verdict: 'no_assertions' }));
    const caseId = await startedCase(h);

    const outcome = committed(
      await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })),
    );
    expect(outcome.accepted_proposition_ids).toEqual([]);
    expect(outcome.case.case_version).toBe(0);
    expect(outcome.warnings[0]).toContain('did not record');

    const state = await loadState(h, caseId);
    expect(state.case_version).toBe(0);
    expect(state.propositions).toEqual([]);
    expect(state.clarifications).toEqual([]);
    // The source turn is still history, and the compile run still happened.
    expect(state.turn_log).toHaveLength(1);
    expect(await h.store.compileRuns.listByCase(caseId)).toHaveLength(1);
  });

  it('resolves an open clarification once the requirement is answered canonically', async () => {
    const h = harness();
    h.scripted.setScript(() => ({
      verdict: 'ambiguous',
      clarifications: [
        {
          requirement_id: 'req_expected_date',
          reason: 'epistemic_strength_indeterminate',
          prompt: 'Was that a date you hoped for?',
        },
      ],
    }));
    const caseId = await startedCase(h);
    await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    h.scripted.setScript(expectedDateScript);
    const answer = committed(
      await h.runtime.submitTurn(
        ALICE,
        submitCommand({
          case_id: caseId,
          client_turn_id: 'client_2',
          expected_case_version: 1,
          payload: payload('Yes, April 25 was only what I hoped for.'),
        }),
      ),
    );

    expect(answer.case.open_clarifications).toEqual([]);
    const state = await loadState(h, caseId);
    expect(state.clarifications[0]!.resolved_at_case_version).toBe(2);
    expect(state.case_version).toBe(2);
  });

  it('rejects an assertion grounded only in relayed assistant context', async () => {
    const h = harness();
    h.scripted.setScript(() => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: 'April 25',
          region: 'context',
          message_index: 0,
          requirement_id: 'req_expected_date',
          type: 'target_date',
          epistemic_strength: 'asserted_confident',
          statement: 'The user expected completion by 25 April.',
        },
      ],
    }));
    const caseId = await startedCase(h);

    const outcome = await h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        payload: payload('That sounds about right.', ['Was April 25 the date?']),
      }),
    );

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('INTERNAL_ERROR');
    expect(h.diagnostics.events.map((event) => event.kind)).toContain(
      'compiler_contract_violation',
    );

    const state = await loadState(h, caseId);
    expect(state.turn_log).toHaveLength(0);
    expect(state.case_version).toBe(0);
  });

  it('refuses verified document content that no inspected evidence supports', async () => {
    const h = harness();
    h.scripted.setScript(() => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: 'April 25',
          requirement_id: 'req_expected_date',
          type: 'verified_document_content',
          epistemic_strength: 'asserted_confident',
          statement: 'The contract states 25 April.',
        },
      ],
    }));
    const caseId = await startedCase(h);

    const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));
    expect(outcome.kind).toBe('failed');
    const rejection = h.diagnostics.events.find((event) => event.kind === 'mutation_rejected');
    expect(rejection?.issues.map((entry) => entry.code)).toContain(
      'mutation_requires_inspected_evidence',
    );
    expect((await loadState(h, caseId)).propositions).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* submit_turn — structural validation before commit                         */
/* ------------------------------------------------------------------------ */

describe('structural validation gates the commit', () => {
  it('does not commit a state the validator rejects, and leaves the case retryable', async () => {
    const h = harness();
    // Contract-valid output whose type cannot satisfy the requirement it answers.
    h.scripted.setScript(() => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: 'April 25',
          requirement_id: 'req_expected_date',
          type: 'invoice',
          epistemic_strength: 'asserted_confident',
          statement: 'An invoice dated 25 April.',
        },
      ],
    }));
    const caseId = await startedCase(h);
    const before = await h.store.cases.findById(caseId);

    const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('INTERNAL_ERROR');
    // Nothing about the validator leaks to the caller.
    expect(JSON.stringify(outcome.failure)).not.toContain('proposition_type_role_mismatch');

    const event = h.diagnostics.events.find(
      (entry) => entry.kind === 'structural_validation_failed',
    );
    expect(event?.issues.map((entry) => entry.code)).toContain('proposition_type_role_mismatch');

    const after = await h.store.cases.findById(caseId);
    expect(after?.revision).toBe(before?.revision);
    expect(after?.state).toEqual(before?.state);

    // The compile run is kept as audit even though its result was refused.
    expect(await h.store.compileRuns.listByCase(caseId)).toHaveLength(1);

    // No idempotency record was written, so the same client_turn_id is fresh.
    h.scripted.setScript(expectedDateScript);
    const retry = committed(await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })));
    expect(retry.case.case_version).toBe(1);
  });

  it('refuses a second live statement of the same type without a supersession link', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    const outcome = await h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        client_turn_id: 'client_2',
        expected_case_version: 1,
        payload: payload('Actually it was April 25 at the latest, I am sure.'),
      }),
    );

    expect(outcome.kind).toBe('failed');
    const event = h.diagnostics.events.find(
      (entry) => entry.kind === 'structural_validation_failed',
    );
    expect(event?.issues.map((entry) => entry.code)).toContain('unresolved_contradiction');

    const state = await loadState(h, caseId);
    expect(state.case_version).toBe(1);
    expect(state.propositions).toHaveLength(1);
  });

  it('refuses two statements of one type against one requirement in a single run', async () => {
    const h = harness();
    h.scripted.setScript(() => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: 'April 25',
          requirement_id: 'req_expected_date',
          type: 'target_date',
          epistemic_strength: 'recalled_uncertain',
          statement: 'Expected by 25 April.',
        },
        {
          quote: 'May 2',
          requirement_id: 'req_expected_date',
          type: 'target_date',
          epistemic_strength: 'recalled_uncertain',
          statement: 'Expected by 2 May.',
        },
      ],
    }));
    const caseId = await startedCase(h);

    const outcome = await h.runtime.submitTurn(
      ALICE,
      submitCommand({ case_id: caseId, payload: payload('April 25, or maybe May 2.') }),
    );
    expect(outcome.kind).toBe('failed');
    const event = h.diagnostics.events.find((entry) => entry.kind === 'mutation_rejected');
    expect(event?.issues.map((entry) => entry.code)).toContain(
      'mutation_duplicate_requirement_type',
    );
    expect((await loadState(h, caseId)).propositions).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Correction flow                                                           */
/* ------------------------------------------------------------------------ */

describe('correction flow', () => {
  it('supersedes without deleting, and keeps the correction visible as history', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    const first = committed(await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })));
    const originalId = first.accepted_proposition_ids[0]!;

    h.scripted.setScript(() => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: 'May 2',
          requirement_id: 'req_expected_date',
          type: 'target_date',
          epistemic_strength: 'asserted_confident',
          statement: 'The user expected the work to be finished by 2 May.',
          supersedes_candidate: originalId,
        },
      ],
    }));
    const correction = committed(
      await h.runtime.submitTurn(
        ALICE,
        submitCommand({
          case_id: caseId,
          client_turn_id: 'client_2',
          expected_case_version: 1,
          payload: payload('Sorry, I had it wrong: it was May 2.'),
        }),
      ),
    );

    expect(correction.superseded_proposition_ids).toEqual([originalId]);
    expect(correction.case.case_version).toBe(2);

    const state = await loadState(h, caseId);
    expect(state.propositions).toHaveLength(2);
    const old = state.propositions.find((p) => p.proposition_id === originalId)!;
    const next = state.propositions.find((p) => p.proposition_id !== originalId)!;
    expect(old.superseded_by).toBe(next.proposition_id);
    expect(old.superseded_at_case_version).toBe(2);
    expect(next.supersedes).toBe(originalId);
    // Only the live statement is offered back to the relay.
    expect(correction.case.recent_interpretations).toHaveLength(1);
    expect(correction.case.recent_interpretations[0]!.proposition_id).toBe(next.proposition_id);
    // Both source turns remain in the log.
    expect(state.turn_log).toHaveLength(2);
  });

  it('refuses a supersession that names a proposition answering another requirement', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    const first = committed(await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })));

    h.scripted.setScript(() => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: '1 March',
          requirement_id: 'req_paid',
          type: 'payment',
          epistemic_strength: 'asserted_confident',
          statement: 'The user paid a deposit on 1 March.',
          supersedes_candidate: first.accepted_proposition_ids[0]!,
        },
      ],
    }));
    const outcome = await h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        client_turn_id: 'client_2',
        expected_case_version: 1,
        in_reply_to: ['req_paid'],
        payload: payload('I paid the deposit on 1 March.'),
      }),
    );

    expect(outcome.kind).toBe('failed');
    const event = h.diagnostics.events.find((entry) => entry.kind === 'mutation_rejected');
    expect(event?.issues.map((entry) => entry.code)).toContain(
      'mutation_supersedes_other_requirement',
    );
    expect((await loadState(h, caseId)).propositions).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ */
/* Locked case                                                               */
/* ------------------------------------------------------------------------ */

/**
 * A well-formed attestation over the given state. Attestation TRANSPORT is not
 * part of this branch, so the record is built here from the core's own render,
 * state hash and turn commitments rather than hand-rolled; what it is not is
 * readiness-complete, which no path under test reaches.
 */
function attestationFor(state: CaseState): AttestationRecord {
  const render = renderCanonicalAccount(state);
  const readiness = deriveReadiness(state.requirements, state.propositions, state.clarifications);
  return {
    attestation_id: 'att_' + state.case_id,
    case_id: state.case_id,
    case_version: state.case_version,
    canonical_state_hash: hashCanonicalState(state),
    rendered_document: render.document,
    rendered_document_hash: render.document_hash,
    render_template_version: render.render_template_version,
    challenge: 'challenge_' + state.case_id,
    verification_method: 'first_party_ui_click',
    assurance_level: 'ui_click',
    authenticator_ref: null,
    signature: null,
    signature_alg: null,
    source_turn_ids: state.turn_log.map((turn) => turn.turn_id),
    source_turn_commitments: state.turn_log.map((turn) => turn.payload_commitment),
    source_turn_metadata_commitments: state.turn_log.map(computeSourceTurnMetadataCommitment),
    evidence_refs: state.evidence_references.map((reference) => ({
      evidence_ref_id: reference.evidence_ref_id,
      label: reference.label,
      inspection_status: reference.inspection_status,
    })),
    unresolved_requirement_ids: readiness.unresolved_requirement_ids,
    schema_version: WEBMCP_CORE_SCHEMA_VERSION,
    protocol_version: WEBMCP_PROTOCOL_VERSION,
    compiler_version_ids: [
      ...new Set(state.propositions.map((proposition) => proposition.compiler_version_id)),
    ].sort(),
    structural_validator_version: STRUCTURAL_VALIDATOR_VERSION,
    principal_id: state.principal_id,
    created_at: new Date(START_MS).toISOString(),
    client_ip: null,
    user_agent: null,
  };
}

/**
 * Presents a chosen case as attested at its current version. The lock is
 * injected at the READ boundary because that is exactly what the store would
 * return once a human attested; faking it through a turn commit would require
 * inventing an idempotency record for a turn that never happened, which is the
 * very state these tests are about.
 */
function lockingStore(inner: InMemoryCaseRuntimeStore) {
  const locked = new Set<string>();
  const withLock = (stored: StoredCase | null): StoredCase | null => {
    if (!stored || !locked.has(stored.state.case_id)) return stored;
    return {
      revision: stored.revision,
      state: { ...stored.state, attestations: [attestationFor(stored.state)] },
    };
  };
  const store: CaseRuntimeStore = {
    compileRuns: inner.compileRuns,
    idempotency: inner.idempotency,
    compilerRegistry: inner.compilerRegistry,
    cases: {
      findById: async (caseId) => withLock(await inner.cases.findById(caseId)),
      findActiveDraftByPrincipal: async (principalId) => {
        const found = await inner.cases.findActiveDraftByPrincipal(principalId);
        return found && locked.has(found.state.case_id) ? null : found;
      },
      create: (state) => inner.cases.create(state),
    },
    commitTurn: (commit) => inner.commitTurn(commit),
  };
  return { store, lock: (caseId: string) => locked.add(caseId) };
}

describe('locked case versions', () => {
  it('refuses to mutate an attested current version, and is not an active draft', async () => {
    const h = harness();
    const draftId = await startedCase(h, ALICE);
    const template = await loadState(h, draftId);
    const base: CaseState = {
      ...template,
      case_id: 'case_locked',
      principal_id: 'user_bob',
      turn_log: [],
    };
    await h.store.cases.create({ ...base, attestations: [attestationFor(base)] });

    const outcome = await h.runtime.submitTurn(BOB, submitCommand({ case_id: 'case_locked' }));
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('CASE_LOCKED');
    expect((await loadState(h, 'case_locked')).turn_log).toHaveLength(0);

    // A locked case is not an open draft, so draft recovery does not find it.
    const active = await h.runtime.getCaseState(BOB);
    expect(active.kind).toBe('failed');
    if (active.kind !== 'failed') return;
    expect(active.failure.code).toBe('CASE_NOT_FOUND');

    // Alice's own draft is untouched by any of that.
    const alice = await h.runtime.getCaseState(ALICE);
    expect(alice.kind === 'ok' && alice.case.case_id).toBe(draftId);
  });
});

describe('replay survives the case being locked', () => {
  async function committedThenLocked() {
    let lockCase: (caseId: string) => void = () => {};
    const h = harness({
      wrapStore: (inner) => {
        const wrapper = lockingStore(inner);
        lockCase = wrapper.lock;
        return wrapper.store;
      },
    });
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    const first = committed(await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })));

    // The human reviews the account and attests version 1.
    lockCase(caseId);
    const before = (await h.store.cases.findById(caseId))!;
    return { h, caseId, first, before };
  }

  it('replays an exact client_turn_id retry after the version was attested', async () => {
    const { h, caseId, first, before } = await committedThenLocked();

    // The caller never saw the original response and retries the same request.
    const retry = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    expect(retry.kind).toBe('replayed');
    if (retry.kind !== 'replayed') return;
    expect(retry.match).toBe('client_turn_id');
    expect(retry.turn_id).toBe(first.turn_id);
    expect(retry.accepted_proposition_ids).toEqual(first.accepted_proposition_ids);
    expect(retry.recorded_at_case_version).toBe(1);

    const after = (await h.store.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
    expect(after.state.turn_log).toHaveLength(1);
    expect(after.state.propositions).toHaveLength(1);
    expect(after.state.case_version).toBe(1);
    expect(await h.store.compileRuns.listByCase(caseId)).toHaveLength(1);
    expect(await h.store.idempotency.listByCase(caseId)).toHaveLength(1);
  });

  it('replays a regenerated retry by fingerprint after the version was attested', async () => {
    const { h, caseId, first } = await committedThenLocked();

    const retry = await h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        client_turn_id: 'client_2',
        expected_case_version: 1,
        payload: payload('I expected it finished by April 25 — and nobody ever said otherwise!'),
      }),
    );

    expect(retry.kind).toBe('replayed');
    if (retry.kind !== 'replayed') return;
    expect(retry.match).toBe('fingerprint');
    expect(retry.turn_id).toBe(first.turn_id);
    expect((await loadState(h, caseId)).turn_log).toHaveLength(1);
  });

  it('still refuses a genuinely fresh write to a locked version', async () => {
    const { h, caseId, before } = await committedThenLocked();

    const fresh = await h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        client_turn_id: 'client_2',
        expected_case_version: 1,
        in_reply_to: ['req_paid'],
        payload: payload('I paid the deposit on 1 March.'),
      }),
    );

    expect(fresh.kind).toBe('failed');
    if (fresh.kind !== 'failed') return;
    expect(fresh.failure.code).toBe('CASE_LOCKED');

    const after = (await h.store.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state.turn_log).toHaveLength(1);
    expect(await h.store.compileRuns.listByCase(caseId)).toHaveLength(1);
  });

  it('reports a stale fresh write to a locked version as locked, not as a conflict', async () => {
    const { h, caseId } = await committedThenLocked();

    // Stale expected_case_version AND a new statement. Answering VERSION_CONFLICT
    // would invite a refresh-and-retry against a case that can never accept it.
    const stale = await h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        client_turn_id: 'client_2',
        expected_case_version: 0,
        in_reply_to: ['req_paid'],
        payload: payload('I paid the deposit on 1 March.'),
      }),
    );

    expect(stale.kind).toBe('failed');
    if (stale.kind !== 'failed') return;
    expect(stale.failure.code).toBe('CASE_LOCKED');
    expect((await loadState(h, caseId)).turn_log).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ */
/* Malformed compiler output                                                 */
/* ------------------------------------------------------------------------ */

/**
 * A provider adapter that returns an object the core contract check cannot even
 * inspect: the verdict claims accepted candidates, but the arrays the check
 * dereferences are simply absent. This is a different failure class from a
 * compiler that throws, and from one whose output merely fails the contract.
 */
class MalformedCompiler implements SemanticCompilerPort {
  readonly registryEntry = scriptedRegistryEntry();
  calls = 0;

  async compile(input: CompilerInput): Promise<CompilerOutput> {
    this.calls += 1;
    return {
      compile_run_id: input.compile_run_id,
      compiler_version_id: input.compiler_version_id,
      verdict: 'accepted_candidates',
      // assertions, rejected_candidates and clarifications_requested missing.
    } as unknown as CompilerOutput;
  }
}

describe('malformed compiler output is contained at the runtime boundary', () => {
  it('resolves to a safe failure instead of rejecting the submit promise', async () => {
    const compiler = new MalformedCompiler();
    const h = harness({ compiler });
    const caseId = await startedCase(h);
    const before = (await h.store.cases.findById(caseId))!;

    // Resolving at all is half the assertion: an uncaught throw here would
    // escape submitTurn and bypass the runtime's failure contract entirely.
    const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('INTERNAL_ERROR');
    expect(compiler.calls).toBe(1);

    // Nothing about the malformed object reaches the caller.
    const surfaced = JSON.stringify(outcome.failure);
    expect(surfaced).not.toContain('assertions');
    expect(surfaced).not.toContain('accepted_candidates');
    expect(surfaced).not.toContain('undefined');

    const event = h.diagnostics.events.find(
      (entry) => entry.kind === 'compiler_contract_violation',
    );
    expect(event).toBeDefined();
    expect(event?.turn_id).not.toBeNull();

    // No case mutation, no source turn, no idempotency record.
    const after = (await h.store.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
    expect(after.state.turn_log).toHaveLength(0);
    expect(after.state.case_version).toBe(0);
    expect(await h.store.idempotency.listByCase(caseId)).toEqual([]);
  });

  it('leaves the retry key fresh so a working compiler can still record the turn', async () => {
    const malformed = new MalformedCompiler();
    const h = harness({ compiler: malformed });
    const caseId = await startedCase(h);
    await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    // Same runtime, same client_turn_id, a compiler that now behaves.
    const working = new ScriptedSemanticCompiler(expectedDateScript);
    const recovered = harness({ compiler: working });
    const recoveredCase = await startedCase(recovered);
    const outcome = committed(
      await recovered.runtime.submitTurn(ALICE, submitCommand({ case_id: recoveredCase })),
    );
    expect(outcome.case.case_version).toBe(1);

    expect(await h.store.idempotency.listByCase(caseId)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Cancellation                                                              */
/* ------------------------------------------------------------------------ */

/** Blocks until the supplied signal aborts, so the mid-flight path is exact. */
class AbortAwareCompiler implements SemanticCompilerPort {
  readonly registryEntry = scriptedRegistryEntry();
  calls = 0;
  readonly started: Promise<void>;
  #markStarted!: () => void;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.#markStarted = resolve;
    });
  }

  async compile(_input: CompilerInput, options?: CompileOptions): Promise<CompilerOutput> {
    this.calls += 1;
    this.#markStarted();
    return new Promise<CompilerOutput>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => {
        // Deliberately NOT the signal reason: the runtime must surface the
        // cancellation, not whatever the provider happened to reject with.
        reject(new Error('provider stream closed'));
      });
    });
  }
}

describe('cancellation', () => {
  it('forwards the caller signal identity into the compiler call', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    const controller = new AbortController();

    const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }), {
      signal: controller.signal,
    });

    expect(outcome.kind).toBe('committed');
    expect(h.scripted.optionsSeen).toHaveLength(1);
    expect(h.scripted.optionsSeen[0]?.signal).toBe(controller.signal);
  });

  it('still works with no options supplied at all', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);

    const outcome = committed(
      await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })),
    );
    expect(outcome.case.case_version).toBe(1);
    expect(h.scripted.optionsSeen[0]?.signal).toBeUndefined();
  });

  it('propagates an abort mid-compile instead of returning INTERNAL_ERROR', async () => {
    const compiler = new AbortAwareCompiler();
    const h = harness({ compiler });
    const caseId = await startedCase(h);
    const before = (await h.store.cases.findById(caseId))!;
    const controller = new AbortController();
    const reason = new Error('the user navigated away');

    const pending = h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }), {
      signal: controller.signal,
    });
    await compiler.started;
    controller.abort(reason);

    // The abort stays an abort, and keeps the caller's own reason identity.
    await expect(pending).rejects.toBe(reason);
    expect(compiler.calls).toBe(1);

    // A cancelled execution is not retried internally, and commits nothing.
    const after = (await h.store.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
    expect(after.state.turn_log).toHaveLength(0);
    expect(await h.store.idempotency.listByCase(caseId)).toEqual([]);
    expect(await h.store.compileRuns.listByCase(caseId)).toEqual([]);
    expect(h.diagnostics.events.map((event) => event.kind)).not.toContain('compiler_threw');
  });

  it('does no work at all when the signal is already aborted', async () => {
    const compiler = new AbortAwareCompiler();
    const h = harness({ compiler });
    const caseId = await startedCase(h);
    const before = (await h.store.cases.findById(caseId))!;
    const controller = new AbortController();
    const reason = new Error('cancelled before dispatch');
    controller.abort(reason);

    await expect(
      h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }), {
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);

    expect(compiler.calls).toBe(0);
    const after = (await h.store.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state.turn_log).toHaveLength(0);
    expect(await h.store.idempotency.listByCase(caseId)).toEqual([]);
    expect(h.diagnostics.events).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Concurrency                                                               */
/* ------------------------------------------------------------------------ */

class GatedCompiler implements SemanticCompilerPort {
  readonly registryEntry;
  #inner: ScriptedSemanticCompiler;
  #release!: () => void;
  readonly gate: Promise<void>;

  constructor(script: CompilerScript) {
    this.#inner = new ScriptedSemanticCompiler(script);
    this.registryEntry = this.#inner.registryEntry;
    this.gate = new Promise<void>((resolve) => {
      this.#release = resolve;
    });
  }

  release(): void {
    this.#release();
  }

  async compile(input: CompilerInput): Promise<CompilerOutput> {
    await this.gate;
    return this.#inner.compile(input);
  }
}

describe('concurrent writers', () => {
  it('lets one write win and gives the other a version conflict, with no lost update', async () => {
    const compiler = new GatedCompiler((input) =>
      input.turn.in_reply_to.includes('req_paid')
        ? {
            verdict: 'accepted_candidates',
            assertions: [
              {
                quote: '1 March',
                requirement_id: 'req_paid',
                type: 'payment',
                epistemic_strength: 'asserted_confident',
                statement: 'The user paid a deposit on 1 March.',
              },
            ],
          }
        : {
            verdict: 'accepted_candidates',
            assertions: [
              {
                quote: 'April 25',
                requirement_id: 'req_expected_date',
                type: 'target_date',
                epistemic_strength: 'recalled_uncertain',
                statement: 'The user expected the work to be finished by 25 April.',
              },
            ],
          },
    );
    const h = harness({ compiler });
    const caseId = await startedCase(h);

    // Both are prepared against version 0 before either commits.
    const first = h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));
    const second = h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        client_turn_id: 'client_2',
        in_reply_to: ['req_paid'],
        payload: payload('I paid the deposit on 1 March.'),
      }),
    );
    compiler.release();
    const outcomes = await Promise.all([first, second]);

    const kinds = outcomes.map((outcome) => outcome.kind).sort();
    expect(kinds).toEqual(['committed', 'version_conflict']);

    const conflict = outcomes.find((outcome) => outcome.kind === 'version_conflict');
    expect(conflict?.kind === 'version_conflict' && conflict.current_case_version).toBe(1);
    expect(conflict?.kind === 'version_conflict' && conflict.likely_already_recorded).toBe(false);

    const state = await loadState(h, caseId);
    expect(state.case_version).toBe(1);
    expect(state.turn_log).toHaveLength(1);
    expect(state.propositions).toHaveLength(1);
  });

  it('refuses a compare-and-swap prepared against a superseded revision', async () => {
    const h = harness();
    const caseId = await startedCase(h);
    const stored = (await h.store.cases.findById(caseId))!;

    const commit = await h.store.commitTurn({
      case_id: caseId,
      expected_revision: stored.revision - 1,
      next_state: stored.state,
      idempotency: {
        case_id: caseId,
        request_fingerprint: 'b'.repeat(64),
        client_turn_id: 'client_x',
        turn_id: 'turn_x',
        recorded_at_ms: START_MS,
        response: {
          case_version: 0,
          turn_id: 'turn_x',
          accepted_proposition_ids: [],
          superseded_proposition_ids: [],
          opened_clarification_ids: [],
          warnings: [],
        },
      },
    });

    expect(commit.ok).toBe(false);
    expect(await h.store.idempotency.listByCase(caseId)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Compile-run history                                                       */
/* ------------------------------------------------------------------------ */

describe('compile-run history', () => {
  it('keeps a detached snapshot of what the compiler was given', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    const outcome = committed(
      await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })),
    );

    const runs = await h.store.compileRuns.listByCase(caseId);
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.turn_id).toBe(outcome.turn_id);
    expect(run.compiler_version_id).toBe(h.scripted.registryEntry.compiler_version_id);
    // Assembled against the pre-mutation version, not reconstructed after.
    expect(run.input.case_version).toBe(0);
    expect(run.input.existing_propositions).toEqual([]);
    expect(run.contract_issues).toEqual([]);

    // A later turn does not rewrite the earlier run's input snapshot.
    h.scripted.setScript(() => ({ verdict: 'no_assertions' }));
    await h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        client_turn_id: 'client_2',
        expected_case_version: 1,
        payload: payload('Nothing else comes to mind.'),
      }),
    );
    const after = await h.store.compileRuns.findById(run.compile_run_id);
    expect(after?.input.case_version).toBe(0);
    expect(after?.input.existing_propositions).toEqual([]);
  });

  it('registers the compiler artefact so a stored run can be re-executed', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    const entry = await h.store.compilerRegistry.findById(
      h.scripted.registryEntry.compiler_version_id,
    );
    expect(entry?.prompt_text).toBe(h.scripted.registryEntry.prompt_text);
    expect(entry?.version.prompt_hash).toBe(sha256(h.scripted.registryEntry.prompt_text));
  });
});
