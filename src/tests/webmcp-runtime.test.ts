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
  type StartCaseCommand,
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
import {
  computeRequestFingerprint,
  precheckSubmit,
  type IdempotencyRecord,
} from '../webmcp/core/idempotency.js';
import {
  computePayloadCommitment,
  computeSourceTurnMetadataCommitment,
  normalizePayload,
  turnCarriesSpanFidelity,
  type SourceTurnPayload,
} from '../webmcp/core/turns.js';
import {
  compilerInputHash,
  type CompilerInput,
  type CompilerOutput,
} from '../webmcp/core/compiler-contract.js';

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

let startRequestCounter = 0;
function startCommand(clientRequestId?: string): StartCaseCommand {
  startRequestCounter += 1;
  return { client_request_id: clientRequestId ?? 'start_req_' + String(startRequestCounter) };
}

async function startedCase(h: ReturnType<typeof harness>, who = ALICE) {
  const outcome = await h.runtime.startCase(who, startCommand());
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
    const outcome = await h.runtime.startCase(ALICE, startCommand());

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

    const second = await h.runtime.startCase(ALICE, startCommand());
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
    const outcome = await h.runtime.startCase(ALICE, startCommand());
    if (outcome.kind !== 'created') throw new Error('expected creation');
    expect(assertNoForbiddenSlots(outcome.case as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('refuses to act without an authenticated principal', async () => {
    const h = harness();
    const outcome = await h.runtime.startCase(
      { principal: { principal_id: '  ' } },
      startCommand(),
    );
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
/* Provenance is part of heuristic replay identity                           */
/* ------------------------------------------------------------------------ */

const RELAY_ALICE: RuntimeRequestContext = {
  principal: { principal_id: 'user_alice' },
  relaying_agent: 'ChatGPT (gpt-x)',
};

describe('the heuristic fingerprint does not collapse separate source events', () => {
  /** Commits one relayed turn and returns the harness around it. */
  async function firstRelayedTurn() {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    const first = committed(
      await h.runtime.submitTurn(RELAY_ALICE, submitCommand({ case_id: caseId })),
    );
    return { h, caseId, first };
  }

  /**
   * The second submission records no new canonical statement, so these tests
   * isolate SOURCE-TURN identity from the separate collision rule that governs
   * two live statements of one type against one requirement.
   */
  function quietenCompiler(h: ReturnType<typeof harness>) {
    h.scripted.setScript(() => ({ verdict: 'no_assertions' }));
  }

  /** Same words, same requirements, new client id — the regenerated retry. */
  function regeneratedRetry(caseId: string): SubmitTurnCommand {
    return submitCommand({
      case_id: caseId,
      client_turn_id: 'client_2',
      expected_case_version: 1,
      payload: payload('I expected it finished by April 25 — and nobody ever said otherwise!'),
    });
  }

  it('still replays a regenerated retry when the provenance is identical', async () => {
    const { h, caseId, first } = await firstRelayedTurn();

    const retry = await h.runtime.submitTurn(RELAY_ALICE, regeneratedRetry(caseId));

    expect(retry.kind).toBe('replayed');
    if (retry.kind !== 'replayed') return;
    expect(retry.match).toBe('fingerprint');
    expect(retry.turn_id).toBe(first.turn_id);
    expect((await loadState(h, caseId)).turn_log).toHaveLength(1);
  });

  for (const [label, context] of [
    [
      'a different source channel',
      { ...RELAY_ALICE, source_channel: 'first_party_input' as const, relaying_agent: null },
    ],
    ['a different relaying agent', { ...RELAY_ALICE, relaying_agent: 'Claude' }],
    ['no relaying agent at all', { ...RELAY_ALICE, relaying_agent: null }],
  ] as const) {
    it('records a separate source turn for ' + label, async () => {
      const { h, caseId, first } = await firstRelayedTurn();
      quietenCompiler(h);

      const second = await h.runtime.submitTurn(context, regeneratedRetry(caseId));

      expect(second.kind).toBe('committed');
      if (second.kind !== 'committed') return;
      expect(second.turn_id).not.toBe(first.turn_id);

      // Both source events are in the immutable log, each with its own provenance.
      const state = await loadState(h, caseId);
      expect(state.turn_log).toHaveLength(2);
      expect(state.turn_log[0]!.source_channel).toBe('webmcp_agent_relay');
      expect(state.turn_log[0]!.relaying_agent).toBe('ChatGPT (gpt-x)');
      expect(state.turn_log[1]!.source_channel).toBe(
        context.source_channel ?? 'webmcp_agent_relay',
      );
      expect(state.turn_log[1]!.relaying_agent).toBe(context.relaying_agent);
      expect(await h.store.idempotency.listByCase(caseId)).toHaveLength(2);
    });
  }

  it('records a separate source turn when the answer is reported as translated', async () => {
    const { h, caseId, first } = await firstRelayedTurn();
    quietenCompiler(h);

    // Translated wording has no span fidelity to what the user actually said,
    // so it can never stand in for a turn that claimed it did.
    const translated = await h.runtime.submitTurn(RELAY_ALICE, {
      ...regeneratedRetry(caseId),
      translation_indicated: true,
    });

    expect(translated.kind).toBe('committed');
    if (translated.kind !== 'committed') return;
    expect(translated.turn_id).not.toBe(first.turn_id);
    expect(translated.warnings.join(' ')).toContain('translation');

    const state = await loadState(h, caseId);
    expect(state.turn_log).toHaveLength(2);
    expect(state.turn_log[0]!.translation_indicated).toBe(false);
    expect(state.turn_log[1]!.translation_indicated).toBe(true);
  });

  it('records a separate source turn for a materially different source language', async () => {
    const { h, caseId, first } = await firstRelayedTurn();
    quietenCompiler(h);

    const other = await h.runtime.submitTurn(RELAY_ALICE, {
      ...regeneratedRetry(caseId),
      source_language: 'de',
    });

    expect(other.kind).toBe('committed');
    if (other.kind !== 'committed') return;
    expect(other.turn_id).not.toBe(first.turn_id);
    const state = await loadState(h, caseId);
    expect(state.turn_log.map((turn) => turn.source_language)).toEqual([null, 'de']);
  });

  it('treats an omitted and an explicitly null relay claim as the same provenance', async () => {
    const { h, caseId, first } = await firstRelayedTurn();

    // The first turn omitted source_language entirely; this one sends null.
    const retry = await h.runtime.submitTurn(RELAY_ALICE, {
      ...regeneratedRetry(caseId),
      source_language: null,
    });

    expect(retry.kind).toBe('replayed');
    if (retry.kind !== 'replayed') return;
    expect(retry.turn_id).toBe(first.turn_id);
    expect((await loadState(h, caseId)).turn_log).toHaveLength(1);
  });

  it('keeps exact client_turn_id replay authoritative over any provenance drift', async () => {
    const { h, caseId, first } = await firstRelayedTurn();
    const before = (await h.store.cases.findById(caseId))!;
    const compileRunsBefore = await h.store.compileRuns.listByCase(caseId);

    // Same operation id, but every provenance field has drifted.
    const retry = await h.runtime.submitTurn(
      {
        principal: { principal_id: 'user_alice' },
        source_channel: 'first_party_input',
        relaying_agent: null,
      },
      submitCommand({
        case_id: caseId,
        expected_case_version: 1,
        source_language: 'de',
        translation_indicated: true,
      }),
    );

    expect(retry.kind).toBe('replayed');
    if (retry.kind !== 'replayed') return;
    expect(retry.match).toBe('client_turn_id');
    expect(retry.turn_id).toBe(first.turn_id);
    expect(retry.accepted_proposition_ids).toEqual(first.accepted_proposition_ids);

    const after = (await h.store.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
    expect(after.state.turn_log).toHaveLength(1);
    expect(after.state.propositions).toHaveLength(1);
    expect(await h.store.compileRuns.listByCase(caseId)).toEqual(compileRunsBefore);
    expect(await h.store.idempotency.listByCase(caseId)).toHaveLength(1);
    expect(h.scripted.calls).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ */
/* Deterministic input validation precedes registry access                   */
/* ------------------------------------------------------------------------ */

describe('unknown requirements are rejected without touching the registry', () => {
  async function caseWithFailPoints() {
    const inner = new InMemoryCaseRuntimeStore();
    const fail: FailPoints = {};
    const store = storeFailingAt(inner, fail);
    const compiler = new ScriptedSemanticCompiler(expectedDateScript);
    const h = runtimeOver(store, compiler);
    const started = await h.runtime.startCase(ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    return { inner, fail, compiler, h, caseId: started.case.case_id };
  }

  async function expectDeterministicRejection(
    label: 'healthy' | 'unavailable',
    registryUnavailable: boolean,
  ) {
    const { inner, fail, compiler, h, caseId } = await caseWithFailPoints();
    const before = (await inner.cases.findById(caseId))!;
    let registerCalls = 0;
    fail.registryRegister = () => {
      registerCalls += 1;
      return registryUnavailable ? new Error(DB_ERROR) : undefined;
    };

    const outcome = await h.runtime.submitTurn(
      ALICE,
      submitCommand({ case_id: caseId, in_reply_to: ['req_does_not_exist'] }),
    );

    expect(outcome.kind, label).toBe('failed');
    if (outcome.kind !== 'failed') return;
    // The same malformed request gets the same answer either way.
    expect(outcome.failure.code, label).toBe('INVALID_INPUT');
    expect(outcome.failure.retryable, label).toBe(false);

    // No registry work, no compiler, no writes of any kind.
    expect(registerCalls, label).toBe(0);
    expect(compiler.calls, label).toHaveLength(0);
    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision, label).toBe(before.revision);
    expect(after.state, label).toEqual(before.state);
    expect(after.state.turn_log, label).toHaveLength(0);
    expect(await inner.compileRuns.listByCase(caseId)).toEqual([]);
    expect(await inner.idempotency.listByCase(caseId)).toEqual([]);
  }

  it('rejects an unknown requirement while the registry is healthy', async () => {
    await expectDeterministicRejection('healthy', false);
  });

  it('gives the identical rejection while the registry is unavailable', async () => {
    await expectDeterministicRejection('unavailable', true);
  });

  it('still replays a committed turn ahead of present-day requirement validation', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const fail: FailPoints = {};
    const store = storeFailingAt(inner, fail);
    const first = runtimeOver(store, new ScriptedSemanticCompiler(expectedDateScript), 'p1_');
    const started = await first.runtime.startCase(ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;
    const commit = committed(
      await first.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })),
    );

    // Fresh process, registry down, a compiler that must never run.
    fail.registryRegister = () => new Error(DB_ERROR);
    const second = runtimeOver(store, new NeverCallCompiler(), 'p2_');
    const retry = await second.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    // Replay resolves from durable history, not reinterpreted as a fresh write.
    expect(retry.kind).toBe('replayed');
    if (retry.kind !== 'replayed') return;
    expect(retry.turn_id).toBe(commit.turn_id);
    expect(second.diagnostics.events).toEqual([]);
    expect((await inner.cases.findById(caseId))!.state.turn_log).toHaveLength(1);
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
function lockingStore(inner: CaseRuntimeStore) {
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
    },
    startRequests: inner.startRequests,
    createCase: (commit) => inner.createCase(commit),
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
    await h.store.createCase({
      state: { ...base, attestations: [attestationFor(base)] },
      idempotency: {
        principal_id: base.principal_id,
        client_request_id: 'start_req_locked',
        case_id: base.case_id,
        recorded_at_ms: START_MS,
      },
    });

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
/* Shared doubles for the fault-injection suites                             */
/* ------------------------------------------------------------------------ */

interface FailPoints {
  /** Returning undefined lets that particular call through. */
  casesFindById?: () => Error | undefined;
  casesFindActiveDraft?: () => Error | undefined;
  idempotencyList?: () => Error | undefined;
  startRequestsFind?: () => Error | undefined;
  registryRegister?: () => Error | undefined;
}

/** Mutable so a test can commit real work first and fail a later read. */
function storeFailingAt(inner: InMemoryCaseRuntimeStore, fail: FailPoints): CaseRuntimeStore {
  const boom = (make?: () => Error | undefined): void => {
    const error = make?.();
    if (error) throw error;
  };
  return {
    cases: {
      findById: async (caseId) => {
        boom(fail.casesFindById);
        return inner.cases.findById(caseId);
      },
      findActiveDraftByPrincipal: async (principalId) => {
        boom(fail.casesFindActiveDraft);
        return inner.cases.findActiveDraftByPrincipal(principalId);
      },
    },
    compileRuns: inner.compileRuns,
    idempotency: {
      listByCase: async (caseId) => {
        boom(fail.idempotencyList);
        return inner.idempotency.listByCase(caseId);
      },
    },
    startRequests: {
      findByRequest: async (principalId, clientRequestId) => {
        boom(fail.startRequestsFind);
        return inner.startRequests.findByRequest(principalId, clientRequestId);
      },
    },
    compilerRegistry: {
      register: async (entry) => {
        boom(fail.registryRegister);
        return inner.compilerRegistry.register(entry);
      },
      findById: (compilerVersionId) => inner.compilerRegistry.findById(compilerVersionId),
    },
    createCase: (commit) => inner.createCase(commit),
    commitTurn: (commit) => inner.commitTurn(commit),
  };
}

/** A second runtime instance over shared storage, i.e. a fresh process. */
function runtimeOver(store: CaseRuntimeStore, compiler: SemanticCompilerPort, prefix = 'p2_') {
  const diagnostics = recordingDiagnosticsSink();
  const runtime = new CaseRuntime({
    store,
    compiler,
    clock: steppingClock(START_MS + 60_000, 1000),
    ids: sequentialIdFactory(prefix),
    salts: sequentialSaltFactory(prefix + 'salt'),
    reviewUrl: (caseId) => 'https://juryai.test/cases/' + caseId,
    disclosure: { version: DISCLOSURE },
    diagnostics,
  });
  return { runtime, diagnostics };
}

const DB_ERROR = 'relation "public.cases" does not exist; pgcode 42P01 at Supabase pooler';

function assertOpaqueRetryableFailure(failureValue: { code: string; message: string }) {
  expect(failureValue.code).toBe('INTERNAL_ERROR');
  const surfaced = JSON.stringify(failureValue);
  expect(surfaced).not.toContain('relation');
  expect(surfaced).not.toContain('pgcode');
  expect(surfaced).not.toContain('Supabase');
  expect(surfaced).not.toContain('public.cases');
}

/* ------------------------------------------------------------------------ */
/* start_case idempotency                                                    */
/* ------------------------------------------------------------------------ */

describe('start_case idempotency', () => {
  it('replays the original created result when the create response was lost', async () => {
    const h = harness();
    const first = await h.runtime.startCase(ALICE, startCommand('request_1'));
    expect(first.kind).toBe('created');
    if (first.kind !== 'created') return;
    expect(first.replayed).toBe(false);

    const before = (await h.store.cases.findById(first.case.case_id))!;

    // The caller never saw the response and retries the same logical create.
    const retry = await h.runtime.startCase(ALICE, startCommand('request_1'));
    expect(retry.kind).toBe('created');
    if (retry.kind !== 'created') return;
    expect(retry.replayed).toBe(true);
    expect(retry.case.case_id).toBe(first.case.case_id);
    expect(retry.case.case_version).toBe(0);

    // No second case: the next id the factory would have minted is unused.
    expect(await h.store.cases.findById('case_2')).toBeNull();
    const after = (await h.store.cases.findById(first.case.case_id))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);

    // Exactly one start-request record, and none invented for other ids.
    const record = await h.store.startRequests.findByRequest('user_alice', 'request_1');
    expect(record?.case_id).toBe(first.case.case_id);
    expect(await h.store.startRequests.findByRequest('user_alice', 'request_2')).toBeNull();
  });

  it('still reports an open draft for a genuinely different request id', async () => {
    const h = harness();
    const first = await h.runtime.startCase(ALICE, startCommand('request_1'));
    if (first.kind !== 'created') throw new Error('expected creation');

    const second = await h.runtime.startCase(ALICE, startCommand('request_2'));
    expect(second.kind).toBe('open_draft_exists');
    if (second.kind !== 'open_draft_exists') return;
    expect(second.case.case_id).toBe(first.case.case_id);
  });

  it('converges two concurrent identical starts on one created case', async () => {
    const h = harness();
    const [a, b] = await Promise.all([
      h.runtime.startCase(ALICE, startCommand('request_1')),
      h.runtime.startCase(ALICE, startCommand('request_1')),
    ]);

    expect(a!.kind).toBe('created');
    expect(b!.kind).toBe('created');
    if (a!.kind !== 'created' || b!.kind !== 'created') return;
    expect(a!.case.case_id).toBe(b!.case.case_id);
    // Exactly one of them actually did the create.
    expect([a!.replayed, b!.replayed].sort()).toEqual([false, true]);

    const draft = await h.store.cases.findActiveDraftByPrincipal('user_alice');
    expect(draft?.state.case_id).toBe(a!.case.case_id);
    expect(draft?.revision).toBe(1);
  });

  it('lets only one of two concurrent different starts create the draft', async () => {
    const h = harness();
    const outcomes = await Promise.all([
      h.runtime.startCase(ALICE, startCommand('request_1')),
      h.runtime.startCase(ALICE, startCommand('request_2')),
    ]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      'created',
      'open_draft_exists',
    ]);
    const ids = new Set(
      outcomes.map((outcome) => (outcome.kind === 'failed' ? '' : outcome.case.case_id)),
    );
    expect(ids.size).toBe(1);

    const draft = await h.store.cases.findActiveDraftByPrincipal('user_alice');
    expect(draft).not.toBeNull();
    expect(await h.store.cases.findById('case_2')).toBeNull();
  });

  it('rejects a start with no request id', async () => {
    const h = harness();
    const outcome = await h.runtime.startCase(ALICE, { client_request_id: '' });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('INVALID_INPUT');
    expect(await h.store.cases.findActiveDraftByPrincipal('user_alice')).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* Mixed-freshness reads must never decide identity                          */
/* ------------------------------------------------------------------------ */

/** Suspends the FIRST start-request lookup so a second call can overtake it. */
function gatedStartRequestStore(inner: InMemoryCaseRuntimeStore) {
  let armed = false;
  let signalEntered: () => void = () => {};
  let releaseGate: () => void = () => {};
  let gate: Promise<void> = Promise.resolve();

  const store: CaseRuntimeStore = {
    cases: inner.cases,
    compileRuns: inner.compileRuns,
    idempotency: inner.idempotency,
    compilerRegistry: inner.compilerRegistry,
    startRequests: {
      findByRequest: async (principalId, clientRequestId) => {
        const result = await inner.startRequests.findByRequest(principalId, clientRequestId);
        if (armed) {
          armed = false;
          signalEntered();
          await gate;
        }
        return result;
      },
    },
    createCase: (commit) => inner.createCase(commit),
    commitTurn: (commit) => inner.commitTurn(commit),
  };

  const arm = () => {
    armed = true;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    return { entered, release: () => releaseGate() };
  };
  return { store, arm };
}

describe('start_case never classifies a draft from a non-atomic read', () => {
  it('replays created for a retry that observes the draft its own request made', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const gated = gatedStartRequestStore(inner);
    const h = runtimeOver(gated.store, new ScriptedSemanticCompiler());

    // Retry A looks up its request id and sees nothing, then stalls.
    const gate = gated.arm();
    const pendingA = h.runtime.startCase(ALICE, startCommand('request_1'));
    await gate.entered;

    // Original B completes the whole create atomically in the meantime.
    const resultB = await h.runtime.startCase(ALICE, startCommand('request_1'));
    expect(resultB.kind).toBe('created');
    if (resultB.kind !== 'created') return;
    expect(resultB.replayed).toBe(false);

    // A resumes and would previously have seen B's draft and answered
    // OPEN_DRAFT_EXISTS — a non-retryable error for its own successful create.
    gate.release();
    const resultA = await pendingA;

    expect(resultA.kind).toBe('created');
    if (resultA.kind !== 'created') return;
    expect(resultA.replayed).toBe(true);
    expect(resultA.case.case_id).toBe(resultB.case.case_id);
    expect(resultA.case.case_version).toBe(0);

    // Exactly one case, one start-request record, one revision.
    const stored = (await inner.cases.findById(resultB.case.case_id))!;
    expect(stored.revision).toBe(1);
    expect(await inner.cases.findById('p2_case_2')).toBeNull();
    const record = await inner.startRequests.findByRequest('user_alice', 'request_1');
    expect(record?.case_id).toBe(resultB.case.case_id);
    expect(await inner.startRequests.findByRequest('user_alice', 'request_2')).toBeNull();
  });

  it('still reports an open draft when it belongs to a different request', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const gated = gatedStartRequestStore(inner);
    const h = runtimeOver(gated.store, new ScriptedSemanticCompiler());

    const first = await h.runtime.startCase(ALICE, startCommand('request_1'));
    if (first.kind !== 'created') throw new Error('expected creation');

    // Same interleaving, different request id: the draft really is somebody
    // else's operation, so the answer is unchanged.
    const gate = gated.arm();
    const pending = h.runtime.startCase(ALICE, startCommand('request_2'));
    await gate.entered;
    gate.release();
    const second = await pending;

    expect(second.kind).toBe('open_draft_exists');
    if (second.kind !== 'open_draft_exists') return;
    expect(second.case.case_id).toBe(first.case.case_id);
    expect((await inner.cases.findById(first.case.case_id))!.revision).toBe(1);
  });
});

/* ------------------------------------------------------------------------ */
/* Case fresher than the replay store                                        */
/* ------------------------------------------------------------------------ */

/** Omits chosen turns' records from `listByCase`, and counts registry work. */
function laggingReplayStore(inner: CaseRuntimeStore) {
  const hidden = new Set<string>();
  let registerCalls = 0;
  const store: CaseRuntimeStore = {
    cases: inner.cases,
    compileRuns: inner.compileRuns,
    startRequests: inner.startRequests,
    idempotency: {
      listByCase: async (caseId) => {
        const records = await inner.idempotency.listByCase(caseId);
        return records.filter((record) => !hidden.has(record.turn_id));
      },
    },
    compilerRegistry: {
      register: async (entry) => {
        registerCalls += 1;
        return inner.compilerRegistry.register(entry);
      },
      findById: (id) => inner.compilerRegistry.findById(id),
    },
    createCase: (commit) => inner.createCase(commit),
    commitTurn: (commit) => inner.commitTurn(commit),
  };
  return {
    store,
    hide: (turnId: string) => hidden.add(turnId),
    reveal: (turnId: string) => hidden.delete(turnId),
    registerCalls: () => registerCalls,
  };
}

describe('a replay store lagging the case state fails closed', () => {
  /** Commits a turn that records nothing canonical, so case_version stays 0. */
  async function quietCommittedTurn() {
    const inner = new InMemoryCaseRuntimeStore();
    const lagging = laggingReplayStore(inner);
    const writer = runtimeOver(lagging.store, new ScriptedSemanticCompiler(), 'w_');
    const started = await writer.runtime.startCase(RELAY_ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;

    const original = committed(
      await writer.runtime.submitTurn(RELAY_ALICE, submitCommand({ case_id: caseId })),
    );
    const before = (await inner.cases.findById(caseId))!;
    // No canonical mutation, so the CAS cannot catch a duplicate on its own.
    expect(before.state.case_version).toBe(0);
    expect(before.state.turn_log).toHaveLength(1);
    return { inner, lagging, caseId, original, before };
  }

  /** Same content, same provenance, regenerated client id. */
  function regenerated(caseId: string): SubmitTurnCommand {
    return submitCommand({
      case_id: caseId,
      client_turn_id: 'client_2',
      expected_case_version: 0,
      payload: payload('I expected it finished by April 25 — and nobody ever said otherwise!'),
    });
  }

  it('refuses a regenerated retry whose replay record the store has not caught up to', async () => {
    const { inner, lagging, caseId, original, before } = await quietCommittedTurn();
    lagging.hide(original.turn_id);

    // A fresh runtime instance, so registry work is observable.
    const compiler = new ScriptedSemanticCompiler(expectedDateScript);
    const reader = runtimeOver(lagging.store, compiler, 'r_');
    const outcome = await reader.runtime.submitTurn(RELAY_ALICE, regenerated(caseId));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('INTERNAL_ERROR');
    expect(outcome.failure.retryable).toBe(true);
    expect(JSON.stringify(outcome.failure)).not.toContain('replay');

    const event = reader.diagnostics.events.find(
      (entry) => entry.kind === 'replay_store_inconsistent',
    );
    expect(event?.turn_id).toBe(original.turn_id);

    // No fresh work of any kind happened.
    expect(compiler.calls).toHaveLength(0);
    expect(lagging.registerCalls()).toBe(1); // the writer's registration only
    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
    expect(after.state.turn_log).toHaveLength(1);
    expect(after.state.propositions).toHaveLength(0);
    expect(after.state.case_version).toBe(0);
    expect(await inner.compileRuns.listByCase(caseId)).toHaveLength(1);
    expect(await inner.idempotency.listByCase(caseId)).toHaveLength(1);

    // Once storage converges the same retry resolves normally as a replay.
    lagging.reveal(original.turn_id);
    const converged = await reader.runtime.submitTurn(RELAY_ALICE, regenerated(caseId));
    expect(converged.kind).toBe('replayed');
  });

  it('refuses an exact client_turn_id retry whose record is missing, whatever the window', async () => {
    const { inner, lagging, caseId, original, before } = await quietCommittedTurn();
    lagging.hide(original.turn_id);

    const compiler = new ScriptedSemanticCompiler(expectedDateScript);
    // A clock far outside the heuristic window: exact operation identity is
    // not window-bounded, so this must still fail closed.
    const diagnostics = recordingDiagnosticsSink();
    const reader = new CaseRuntime({
      store: lagging.store,
      compiler,
      clock: steppingClock(START_MS + 3_600_000 * 24, 1000),
      ids: sequentialIdFactory('x_'),
      salts: sequentialSaltFactory('xsalt'),
      reviewUrl: (id) => 'https://juryai.test/cases/' + id,
      disclosure: { version: DISCLOSURE },
      diagnostics,
    });
    const outcome = await reader.submitTurn(RELAY_ALICE, submitCommand({ case_id: caseId }));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('INTERNAL_ERROR');
    expect(outcome.failure.retryable).toBe(true);
    // Refused HERE, by operation identity, rather than surviving to the
    // append-time client_turn_id uniqueness check: nothing is built first.
    expect(diagnostics.events.map((event) => event.kind)).toEqual(['replay_store_inconsistent']);
    expect(compiler.calls).toHaveLength(0);
    expect((await inner.cases.findById(caseId))!.revision).toBe(before.revision);
  });

  it('leaves a normal replay untouched when the record is present', async () => {
    const { inner, lagging, caseId, original } = await quietCommittedTurn();

    const reader = runtimeOver(lagging.store, new ScriptedSemanticCompiler(), 'r_');
    const outcome = await reader.runtime.submitTurn(RELAY_ALICE, regenerated(caseId));

    expect(outcome.kind).toBe('replayed');
    if (outcome.kind !== 'replayed') return;
    expect(outcome.turn_id).toBe(original.turn_id);
    expect((await inner.cases.findById(caseId))!.state.turn_log).toHaveLength(1);
  });

  it('does not flag a same-content turn submitted through a different channel', async () => {
    const { inner, lagging, caseId, original } = await quietCommittedTurn();
    lagging.hide(original.turn_id);

    // Different provenance is a distinct source event, so the missing record
    // is not this request's and the ordinary fresh path applies.
    const reader = runtimeOver(lagging.store, new ScriptedSemanticCompiler(), 'r_');
    const outcome = await reader.runtime.submitTurn(
      { ...RELAY_ALICE, source_channel: 'first_party_input', relaying_agent: null },
      regenerated(caseId),
    );

    expect(outcome.kind).toBe('committed');
    const state = (await inner.cases.findById(caseId))!.state;
    expect(state.turn_log).toHaveLength(2);
    expect(state.turn_log[1]!.source_channel).toBe('first_party_input');
  });

  it('does not block a same-content submission from outside the replay window', async () => {
    const { inner, lagging, caseId, original } = await quietCommittedTurn();
    lagging.hide(original.turn_id);

    // Old matching text is ordinary history. Treating it as inconsistency
    // would block a legitimate later submission forever.
    const reader = new CaseRuntime({
      store: lagging.store,
      compiler: new ScriptedSemanticCompiler(),
      clock: steppingClock(START_MS + 3_600_000 * 24, 1000),
      ids: sequentialIdFactory('y_'),
      salts: sequentialSaltFactory('ysalt'),
      reviewUrl: (id) => 'https://juryai.test/cases/' + id,
      disclosure: { version: DISCLOSURE },
    });
    const outcome = await reader.submitTurn(RELAY_ALICE, regenerated(caseId));

    expect(outcome.kind).toBe('committed');
    expect((await inner.cases.findById(caseId))!.state.turn_log).toHaveLength(2);
    expect(original.turn_id).toBeDefined();
  });
});

/* ------------------------------------------------------------------------ */
/* Replay does not depend on the compiler registry                           */
/* ------------------------------------------------------------------------ */

class NeverCallCompiler implements SemanticCompilerPort {
  readonly registryEntry = scriptedRegistryEntry();
  async compile(): Promise<CompilerOutput> {
    throw new Error('the compiler must not run for a replay');
  }
}

describe('replay resolves before compiler registration', () => {
  it('replays a committed turn while the compiler registry is unavailable', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const fail: FailPoints = {};
    const store = storeFailingAt(inner, fail);

    // Process 1: a working runtime commits the turn.
    const first = runtimeOver(store, new ScriptedSemanticCompiler(expectedDateScript), 'p1_');
    const started = await first.runtime.startCase(ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;
    const commit = await first.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));
    expect(commit.kind).toBe('committed');
    if (commit.kind !== 'committed') return;
    const before = (await inner.cases.findById(caseId))!;

    // Process 2: fresh instance, registry down, compiler that refuses to run.
    fail.registryRegister = () => new Error(DB_ERROR);
    const second = runtimeOver(store, new NeverCallCompiler(), 'p2_');
    const retry = await second.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    expect(retry.kind).toBe('replayed');
    if (retry.kind !== 'replayed') return;
    expect(retry.match).toBe('client_turn_id');
    expect(retry.turn_id).toBe(commit.turn_id);
    expect(retry.accepted_proposition_ids).toEqual(commit.accepted_proposition_ids);

    // The registry was never consulted, and nothing moved.
    expect(second.diagnostics.events).toEqual([]);
    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
    expect(await inner.compileRuns.listByCase(caseId)).toHaveLength(1);
  });

  it('still refuses a fresh write when the compiler registry is unavailable', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const fail: FailPoints = {};
    const store = storeFailingAt(inner, fail);
    const first = runtimeOver(store, new ScriptedSemanticCompiler(expectedDateScript), 'p1_');
    const started = await first.runtime.startCase(ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;
    const before = (await inner.cases.findById(caseId))!;

    fail.registryRegister = () => new Error(DB_ERROR);
    const second = runtimeOver(store, new ScriptedSemanticCompiler(expectedDateScript), 'p2_');
    const fresh = await second.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    expect(fresh.kind).toBe('failed');
    if (fresh.kind !== 'failed') return;
    assertOpaqueRetryableFailure(fresh.failure);
    expect(fresh.failure.retryable).toBe(true);
    expect(second.diagnostics.events.map((event) => event.kind)).toContain(
      'repository_unavailable',
    );

    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state.turn_log).toHaveLength(0);
    expect(await inner.idempotency.listByCase(caseId)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Compiler input isolation                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Behaves on the first call so the case has a live proposition, then writes
 * through every canonical object it was handed and reports no assertions.
 */
class HostileCompiler implements SemanticCompilerPort {
  readonly registryEntry = scriptedRegistryEntry();
  #inner = new ScriptedSemanticCompiler(expectedDateScript);
  calls = 0;

  async compile(input: CompilerInput, options?: CompileOptions): Promise<CompilerOutput> {
    this.calls += 1;
    if (this.calls === 1) return this.#inner.compile(input, options);

    const proposition = input.existing_propositions[0];
    if (proposition) proposition.statement = 'MUTATED BY THE ADAPTER';
    const requirement = input.requirement_context[0];
    if (requirement) requirement.prompt = 'MUTATED PROMPT';
    input.turn.payload.answer.text = 'MUTATED ANSWER';

    return {
      compile_run_id: input.compile_run_id,
      compiler_version_id: input.compiler_version_id,
      verdict: 'no_assertions',
      assertions: [],
      rejected_candidates: [],
      clarifications_requested: [],
      raw_model_output: null,
    };
  }
}

describe('the compiler cannot write through its input', () => {
  it('hands the adapter a detached copy, so a no_assertions run mutates nothing', async () => {
    const compiler = new HostileCompiler();
    const h = harness({ compiler });
    const caseId = await startedCase(h);
    await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    const seeded = await loadState(h, caseId);
    const originalStatement = seeded.propositions[0]!.statement;
    const originalPrompts = seeded.requirements.map((definition) => definition.prompt);
    const originalAnswer = seeded.turn_log[0]!.payload.answer.text;

    const outcome = await h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        client_turn_id: 'client_2',
        expected_case_version: 1,
        in_reply_to: ['req_paid'],
        payload: payload('Nothing else comes to mind about payments.'),
      }),
    );
    expect(outcome.kind).toBe('committed');
    expect(compiler.calls).toBe(2);

    const after = await loadState(h, caseId);
    // Canonical state carries only runtime-owned effects: the new turn.
    expect(after.propositions[0]!.statement).toBe(originalStatement);
    expect(after.requirements.map((definition) => definition.prompt)).toEqual(originalPrompts);
    expect(after.turn_log[0]!.payload.answer.text).toBe(originalAnswer);
    expect(after.turn_log[1]!.payload.answer.text).toBe(
      'Nothing else comes to mind about payments.',
    );
    // A no_assertions verdict moves no canonical version.
    expect(after.case_version).toBe(1);
    expect(after.propositions).toHaveLength(1);

    // Historical compile-run input is the pre-adapter input, not what the
    // adapter left behind.
    const runs = await h.store.compileRuns.listByCase(caseId);
    const hostileRun = runs.find((run) => run.turn_id === after.turn_log[1]!.turn_id)!;
    expect(hostileRun.input.existing_propositions[0]!.statement).toBe(originalStatement);
    expect(hostileRun.input.requirement_context[0]!.prompt).not.toBe('MUTATED PROMPT');
    expect(hostileRun.input.turn.payload.answer.text).toBe(
      'Nothing else comes to mind about payments.',
    );
    expect(hostileRun.input_hash).toBe(compilerInputHash(hostileRun.input));
  });
});

/* ------------------------------------------------------------------------ */
/* Malformed clarification prompts                                           */
/* ------------------------------------------------------------------------ */

describe('malformed clarification prompts never reach canonical state', () => {
  const ambiguousWithPrompt =
    (prompt: unknown): CompilerScript =>
    () => ({
      verdict: 'raw',
      output: {
        verdict: 'ambiguous',
        assertions: [],
        rejected_candidates: [],
        clarifications_requested: [
          {
            requirement_id: 'req_expected_date',
            reason: 'multiple_incompatible_readings',
            prompt: prompt as string,
          },
        ],
        raw_model_output: null,
      },
    });

  for (const [label, prompt] of [
    ['undefined', undefined],
    ['a number', 123],
    ['whitespace only', '   '],
    ['empty', ''],
  ] as const) {
    it('fails closed when the prompt is ' + label, async () => {
      const h = harness();
      h.scripted.setScript(ambiguousWithPrompt(prompt));
      const caseId = await startedCase(h);
      const before = (await h.store.cases.findById(caseId))!;

      const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

      expect(outcome.kind).toBe('failed');
      if (outcome.kind !== 'failed') return;
      expect(outcome.failure.code).toBe('INTERNAL_ERROR');
      // Nothing about the provider value is echoed back.
      const surfaced = JSON.stringify(outcome.failure);
      expect(surfaced).not.toContain('prompt');
      expect(surfaced).not.toContain('clarification');

      const event = h.diagnostics.events.find((entry) => entry.kind === 'mutation_rejected');
      expect(event?.issues.map((entry) => entry.code)).toContain(
        'mutation_clarification_prompt_invalid',
      );

      const after = (await h.store.cases.findById(caseId))!;
      expect(after.revision).toBe(before.revision);
      expect(after.state).toEqual(before.state);
      expect(after.state.clarifications).toEqual([]);
      expect(after.state.turn_log).toHaveLength(0);
      expect(await h.store.idempotency.listByCase(caseId)).toEqual([]);

      // The case is still readable, and the retry key is still fresh.
      const read = await h.runtime.getCaseState(ALICE, { case_id: caseId });
      expect(read.kind).toBe('ok');
      h.scripted.setScript(expectedDateScript);
      const retry = committed(
        await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })),
      );
      expect(retry.case.case_version).toBe(1);
    });
  }

  it('rejects a clarification naming a requirement the case does not have', async () => {
    const h = harness();
    h.scripted.setScript(() => ({
      verdict: 'raw',
      output: {
        verdict: 'ambiguous',
        assertions: [],
        rejected_candidates: [],
        clarifications_requested: [
          {
            requirement_id: 'req_not_on_this_case',
            reason: 'multiple_incompatible_readings',
            prompt: 'Which did you mean?',
          },
        ],
        raw_model_output: null,
      },
    }));
    const caseId = await startedCase(h);

    const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));
    expect(outcome.kind).toBe('failed');
    expect((await loadState(h, caseId)).clarifications).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* Replay is built from state consistent with the record it matched          */
/* ------------------------------------------------------------------------ */

/**
 * Stages what a specific `cases.findById` call returns, counted from the last
 * `resetReads()`. That is enough to reproduce every read-committed
 * interleaving this suite cares about: read 1 is a submit's initial case read,
 * read 2 is its replay refresh.
 */
function stagedReadStore(inner: InMemoryCaseRuntimeStore) {
  let reads = 0;
  const overrides = new Map<number, StoredCase | null>();
  const store: CaseRuntimeStore = {
    cases: {
      findById: async (caseId) => {
        reads += 1;
        if (overrides.has(reads)) return overrides.get(reads) ?? null;
        return inner.cases.findById(caseId);
      },
      findActiveDraftByPrincipal: (principalId) =>
        inner.cases.findActiveDraftByPrincipal(principalId),
    },
    compileRuns: inner.compileRuns,
    idempotency: inner.idempotency,
    startRequests: inner.startRequests,
    compilerRegistry: inner.compilerRegistry,
    createCase: (commit) => inner.createCase(commit),
    commitTurn: (commit) => inner.commitTurn(commit),
  };
  return {
    store,
    /** Restart read numbering, so a test stages only the call it cares about. */
    resetReads: () => {
      reads = 0;
      overrides.clear();
    },
    stageRead: (readNumber: number, value: StoredCase | null) => {
      overrides.set(readNumber, value);
    },
  };
}

describe('replay refreshes the case before describing the committed result', () => {
  /** Commits one turn and returns everything a replay test needs. */
  async function committedTurn() {
    const inner = new InMemoryCaseRuntimeStore();
    const staged = stagedReadStore(inner);
    const compiler = new ScriptedSemanticCompiler(expectedDateScript);
    const h = runtimeOver(staged.store, compiler);

    const started = await h.runtime.startCase(ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;

    // The duplicate request's view of the case, taken before the original commits.
    const preCommit = (await inner.cases.findById(caseId))!;
    expect(preCommit.state.case_version).toBe(0);

    const original = committed(
      await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })),
    );
    const afterCommit = (await inner.cases.findById(caseId))!;
    staged.resetReads();
    return { inner, staged, compiler, h, caseId, preCommit, original, afterCommit };
  }

  async function expectUnchanged(
    inner: InMemoryCaseRuntimeStore,
    caseId: string,
    baseline: StoredCase,
  ) {
    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision).toBe(baseline.revision);
    expect(after.state).toEqual(baseline.state);
    expect(await inner.idempotency.listByCase(caseId)).toHaveLength(1);
    expect(await inner.compileRuns.listByCase(caseId)).toHaveLength(1);
  }

  it('does not mix committed proposition ids with a pre-commit case snapshot', async () => {
    const { inner, staged, compiler, h, caseId, preCommit, original, afterCommit } =
      await committedTurn();

    // Read 1 is the duplicate's initial case read, taken before the commit;
    // the idempotency read that follows already sees the committed record.
    staged.stageRead(1, preCommit);
    const replay = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    expect(replay.kind).toBe('replayed');
    if (replay.kind !== 'replayed') return;
    // Built from the refreshed read, not from the version-0 snapshot it held.
    expect(replay.case.case_version).toBe(1);
    expect(replay.turn_id).toBe(original.turn_id);
    expect(replay.accepted_proposition_ids).toEqual(original.accepted_proposition_ids);
    expect(replay.recorded).toEqual(original.recorded);
    expect(replay.recorded).toHaveLength(1);

    // A replay is a read: no compiler, and no write of any kind.
    expect(compiler.calls).toHaveLength(1);
    await expectUnchanged(inner, caseId, afterCommit);
    expect(afterCommit.state.turn_log).toHaveLength(1);
    expect(afterCommit.state.propositions).toHaveLength(1);
  });

  it('contains a repository failure during the replay refresh', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const fail: FailPoints = {};
    const store = storeFailingAt(inner, fail);
    const compiler = new ScriptedSemanticCompiler(expectedDateScript);
    const h = runtimeOver(store, compiler);

    const started = await h.runtime.startCase(ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;
    await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));
    const before = (await inner.cases.findById(caseId))!;
    const compileCallsBefore = compiler.calls.length;

    // The retry's initial read succeeds; its replay refresh does not.
    let reads = 0;
    fail.casesFindById = () => {
      reads += 1;
      return reads >= 2 ? new Error(DB_ERROR) : undefined;
    };
    const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    assertOpaqueRetryableFailure(outcome.failure);
    expect(outcome.failure.retryable).toBe(true);
    const event = h.diagnostics.events.find(
      (entry) => entry.kind === 'repository_unavailable' && entry.message.includes('refresh'),
    );
    expect(event?.message).toContain(DB_ERROR);

    fail.casesFindById = undefined;
    expect(compiler.calls).toHaveLength(compileCallsBefore);
    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
  });

  it('fails closed when a replay record names a result the case cannot support', async () => {
    const { inner, staged, compiler, h, caseId, preCommit, afterCommit } = await committedTurn();
    const compileCallsBefore = compiler.calls.length;

    // Both the initial read AND the refresh see the pre-commit case, so the
    // durable record proves a commit the case cannot account for. Returning a
    // replay with an empty `recorded` would describe an outcome that does not
    // exist; inventing the entries would describe one that never did.
    staged.stageRead(1, preCommit);
    staged.stageRead(2, preCommit);
    const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    assertOpaqueRetryableFailure(outcome.failure);
    expect(outcome.failure.retryable).toBe(true);
    const event = h.diagnostics.events.find((entry) => entry.kind === 'replay_state_inconsistent');
    expect(event?.message).toContain('turn present=false');

    expect(compiler.calls).toHaveLength(compileCallsBefore);
    await expectUnchanged(inner, caseId, afterCommit);
  });

  it('treats a vanished refresh as inconsistent rather than as a missing case', async () => {
    const { inner, staged, compiler, h, caseId, afterCommit } = await committedTurn();
    const compileCallsBefore = compiler.calls.length;

    // The initial read succeeds and the durable record matches; the refresh
    // then lands on a replica that does not have the row yet.
    staged.stageRead(2, null);
    const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    // CASE_NOT_FOUND is non-retryable and would strand a caller whose write
    // demonstrably committed. This attempt already read and authorised the
    // case, so a vanished refresh is a disagreement between reads.
    expect(outcome.failure.code).toBe('INTERNAL_ERROR');
    expect(outcome.failure.retryable).toBe(true);
    const event = h.diagnostics.events.find((entry) => entry.kind === 'replay_state_inconsistent');
    expect(event?.message).toContain('returned no case');

    expect(compiler.calls).toHaveLength(compileCallsBefore);
    await expectUnchanged(inner, caseId, afterCommit);
  });

  it('treats a refreshed owner mismatch as inconsistent rather than as a missing case', async () => {
    const { inner, staged, compiler, h, caseId, afterCommit } = await committedTurn();
    const compileCallsBefore = compiler.calls.length;

    // principal_id is immutable, so a refresh reporting a different owner is
    // storage disagreeing with itself, never an authorisation answer.
    staged.stageRead(2, {
      revision: afterCommit.revision,
      state: { ...afterCommit.state, principal_id: 'user_bob' },
    });
    const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('INTERNAL_ERROR');
    expect(outcome.failure.retryable).toBe(true);
    const event = h.diagnostics.events.find((entry) => entry.kind === 'replay_state_inconsistent');
    expect(event?.message).toContain('different principal');

    expect(compiler.calls).toHaveLength(compileCallsBefore);
    await expectUnchanged(inner, caseId, afterCommit);
  });
});

/* ------------------------------------------------------------------------ */
/* Provenance survives the stale-read replay refresh                         */
/* ------------------------------------------------------------------------ */

describe('a stale case read cannot smuggle a different source event into a replay', () => {
  /**
   * Stages the exact interleaving: the duplicate reads a case in which turn T
   * is absent, the idempotency read already sees T's committed record, and the
   * content fingerprint matches. T is therefore provisionally eligible — its
   * provenance cannot be checked yet — and only becomes checkable when the
   * replay refresh returns the case containing it.
   */
  async function staleReadRacingCommittedTurn() {
    const inner = new InMemoryCaseRuntimeStore();
    const staged = stagedReadStore(inner);
    const compiler = new ScriptedSemanticCompiler(expectedDateScript);
    const h = runtimeOver(staged.store, compiler);

    const started = await h.runtime.startCase(RELAY_ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;

    const preCommit = (await inner.cases.findById(caseId))!;
    expect(preCommit.state.turn_log).toHaveLength(0);

    const original = committed(
      await h.runtime.submitTurn(RELAY_ALICE, submitCommand({ case_id: caseId })),
    );
    const afterCommit = (await inner.cases.findById(caseId))!;
    staged.resetReads();
    return { inner, staged, compiler, h, caseId, preCommit, original, afterCommit };
  }

  /** Same words and requirements, new client id, refreshed version. */
  function sameContentCommand(caseId: string): SubmitTurnCommand {
    return submitCommand({
      case_id: caseId,
      client_turn_id: 'client_2',
      expected_case_version: 1,
      payload: payload('I expected it finished by April 25 — and nobody ever said otherwise!'),
    });
  }

  it('still replays when the refreshed turn turns out to share provenance', async () => {
    const { inner, staged, h, caseId, preCommit, original, afterCommit } =
      await staleReadRacingCommittedTurn();

    // Read 1 is stale; read 2 (the refresh) sees the committed turn.
    staged.stageRead(1, preCommit);
    const replay = await h.runtime.submitTurn(RELAY_ALICE, sameContentCommand(caseId));

    expect(replay.kind).toBe('replayed');
    if (replay.kind !== 'replayed') return;
    expect(replay.match).toBe('fingerprint');
    expect(replay.turn_id).toBe(original.turn_id);
    expect(replay.case.case_version).toBe(1);

    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision).toBe(afterCommit.revision);
    expect(after.state.turn_log).toHaveLength(1);
    expect(await inner.idempotency.listByCase(caseId)).toHaveLength(1);
  });

  it('re-evaluates as a fresh source event when the refreshed provenance differs', async () => {
    const { inner, staged, compiler, h, caseId, preCommit, afterCommit } =
      await staleReadRacingCommittedTurn();
    const compileCallsBefore = compiler.calls.length;

    // Read 1 stale, so the record is admitted without a provenance check; the
    // refresh then reveals a turn relayed by a different agent. The retry's
    // reads start again from 1, and by then the case is genuinely current.
    staged.stageRead(1, preCommit);
    const outcome = await h.runtime.submitTurn(
      { ...RELAY_ALICE, relaying_agent: 'Claude' },
      // Stale expected version, so the correct fresh-state answer is easy to
      // name: this submission is not a replay and is not up to date either.
      { ...sameContentCommand(caseId), expected_case_version: 0 },
    );

    // Emphatically not a replay of somebody else's source event.
    expect(outcome.kind).toBe('version_conflict');
    if (outcome.kind !== 'version_conflict') return;
    expect(outcome.current_case_version).toBe(1);
    // A distinct source event has NOT already been recorded.
    expect(outcome.likely_already_recorded).toBe(false);
    // The recent-turn summaries stay complete, so the caller can compare.
    expect(outcome.recent_turns).toHaveLength(1);
    expect(outcome.recent_turns[0]!.answer_excerpt).toContain('April 25');

    // Nothing was committed and no compilation happened on the way here.
    expect(compiler.calls).toHaveLength(compileCallsBefore);
    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision).toBe(afterCommit.revision);
    expect(after.state.turn_log).toHaveLength(1);
    expect(await inner.idempotency.listByCase(caseId)).toHaveLength(1);
  });

  it('keeps exact client_turn_id replay unaffected by the refreshed provenance', async () => {
    const { inner, staged, h, caseId, preCommit, original, afterCommit } =
      await staleReadRacingCommittedTurn();

    // Same operation id, drifted provenance, stale first read: exact identity
    // outranks the heuristic and is never provenance-rechecked.
    staged.stageRead(1, preCommit);
    const replay = await h.runtime.submitTurn(
      { ...RELAY_ALICE, source_channel: 'first_party_input', relaying_agent: null },
      submitCommand({ case_id: caseId, expected_case_version: 1, source_language: 'de' }),
    );

    expect(replay.kind).toBe('replayed');
    if (replay.kind !== 'replayed') return;
    expect(replay.match).toBe('client_turn_id');
    expect(replay.turn_id).toBe(original.turn_id);

    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision).toBe(afterCommit.revision);
    expect(after.state.turn_log).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ */
/* Conflict likelihood is provenance-qualified                               */
/* ------------------------------------------------------------------------ */

describe('version conflicts do not claim a distinct source event already landed', () => {
  async function committedRelayedTurn() {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h, RELAY_ALICE);
    await h.runtime.submitTurn(RELAY_ALICE, submitCommand({ case_id: caseId }));
    return { h, caseId };
  }

  /** Same words, same requirements, new client id, deliberately stale version. */
  function staleSameContent(caseId: string): SubmitTurnCommand {
    return submitCommand({
      case_id: caseId,
      client_turn_id: 'client_2',
      expected_case_version: 0,
      payload: payload('I expected it finished by April 25 — and nobody ever said otherwise!'),
    });
  }

  async function conflictFor(
    context: RuntimeRequestContext,
    overrides: Partial<SubmitTurnCommand> = {},
  ) {
    const { h, caseId } = await committedRelayedTurn();
    // Outside the replay window, so the heuristic cannot answer and the
    // request reaches the version check as a genuinely new write.
    const outcome = await h.runtime.submitTurn(context, {
      ...staleSameContent(caseId),
      ...overrides,
    });
    return { h, caseId, outcome };
  }

  it('reports likely_already_recorded for the same content and same provenance', async () => {
    const { h, caseId } = await committedRelayedTurn();
    // A same-provenance duplicate is caught by replay inside the window, so
    // the conflict path is reached with the window closed.
    const narrow = new CaseRuntime({
      store: h.store,
      compiler: new ScriptedSemanticCompiler(expectedDateScript),
      clock: steppingClock(START_MS + 3_600_000 * 5, 1000),
      ids: sequentialIdFactory('w_'),
      salts: sequentialSaltFactory('wsalt'),
      reviewUrl: (id) => 'https://juryai.test/cases/' + id,
      disclosure: { version: DISCLOSURE },
    });
    const outcome = await narrow.submitTurn(RELAY_ALICE, staleSameContent(caseId));

    expect(outcome.kind).toBe('version_conflict');
    if (outcome.kind !== 'version_conflict') return;
    expect(outcome.likely_already_recorded).toBe(true);
    expect(outcome.recent_turns).toHaveLength(1);
  });

  for (const [label, context, overrides] of [
    [
      'a different source channel',
      { ...RELAY_ALICE, source_channel: 'first_party_input' as const, relaying_agent: null },
      {},
    ],
    ['a different relaying agent', { ...RELAY_ALICE, relaying_agent: 'Claude' }, {}],
    ['a different source language', RELAY_ALICE, { source_language: 'de' }],
    ['a translated answer', RELAY_ALICE, { translation_indicated: true }],
  ] as const) {
    it('reports likely_already_recorded=false for ' + label, async () => {
      const { outcome } = await conflictFor(context, overrides);

      expect(outcome.kind, label).toBe('version_conflict');
      if (outcome.kind !== 'version_conflict') return;
      expect(outcome.current_case_version, label).toBe(1);
      // This source event has not been recorded; telling the caller otherwise
      // invites it to drop the event.
      expect(outcome.likely_already_recorded, label).toBe(false);
      // Recent turns remain the complete same-principal history, unfiltered.
      expect(outcome.recent_turns, label).toHaveLength(1);
      expect(outcome.recent_turns[0]!.answer_excerpt, label).toContain('April 25');
    });
  }
});

/* ------------------------------------------------------------------------ */
/* Repository failure containment                                            */
/* ------------------------------------------------------------------------ */

describe('repository failures resolve as safe runtime failures', () => {
  it('contains a cases.findById failure during submitTurn', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const fail: FailPoints = {};
    const store = storeFailingAt(inner, fail);
    const h = runtimeOver(store, new ScriptedSemanticCompiler(expectedDateScript));
    const started = await h.runtime.startCase(ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;
    const before = (await inner.cases.findById(caseId))!;

    fail.casesFindById = () => new Error(DB_ERROR);
    const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    assertOpaqueRetryableFailure(outcome.failure);
    expect(outcome.failure.retryable).toBe(true);
    const event = h.diagnostics.events.find((entry) => entry.kind === 'repository_unavailable');
    expect(event?.message).toContain(DB_ERROR);

    fail.casesFindById = undefined;
    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state.turn_log).toHaveLength(0);
  });

  it('contains an idempotency.listByCase failure during submitTurn', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const fail: FailPoints = {};
    const store = storeFailingAt(inner, fail);
    const compiler = new ScriptedSemanticCompiler(expectedDateScript);
    const h = runtimeOver(store, compiler);
    const started = await h.runtime.startCase(ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;

    fail.idempotencyList = () => new Error(DB_ERROR);
    const outcome = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    assertOpaqueRetryableFailure(outcome.failure);
    expect(outcome.failure.retryable).toBe(true);
    // Never proceed without the replay store: that is how a lost-response
    // retry becomes a duplicate write.
    expect(compiler.calls).toHaveLength(0);
    expect((await inner.cases.findById(caseId))!.state.turn_log).toHaveLength(0);
  });

  it('contains a start-request read failure during startCase', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const fail: FailPoints = { startRequestsFind: () => new Error(DB_ERROR) };
    const store = storeFailingAt(inner, fail);
    const h = runtimeOver(store, new ScriptedSemanticCompiler());

    const outcome = await h.runtime.startCase(ALICE, startCommand('request_1'));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    assertOpaqueRetryableFailure(outcome.failure);
    expect(outcome.failure.retryable).toBe(true);
    expect(h.diagnostics.events.map((event) => event.kind)).toContain('repository_unavailable');

    fail.startRequestsFind = undefined;
    expect(await inner.cases.findActiveDraftByPrincipal('user_alice')).toBeNull();
  });

  it('contains a case read failure during getCaseState', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const fail: FailPoints = {};
    const store = storeFailingAt(inner, fail);
    const h = runtimeOver(store, new ScriptedSemanticCompiler());
    const started = await h.runtime.startCase(ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');

    fail.casesFindById = () => new Error(DB_ERROR);
    const byId = await h.runtime.getCaseState(ALICE, { case_id: started.case.case_id });
    expect(byId.kind).toBe('failed');
    if (byId.kind !== 'failed') return;
    // A storage blink must never be reported as CASE_NOT_FOUND.
    assertOpaqueRetryableFailure(byId.failure);
    expect(byId.failure.retryable).toBe(true);

    fail.casesFindById = undefined;
    fail.casesFindActiveDraft = () => new Error(DB_ERROR);
    const draft = await h.runtime.getCaseState(ALICE);
    expect(draft.kind).toBe('failed');
    if (draft.kind !== 'failed') return;
    assertOpaqueRetryableFailure(draft.failure);
    expect(
      h.diagnostics.events.filter((event) => event.kind === 'repository_unavailable'),
    ).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------------ */
/* The audited snapshot is what gets applied                                 */
/* ------------------------------------------------------------------------ */

/** Returns a valid output and keeps the reference, as a real adapter may. */
class RetainingCompiler implements SemanticCompilerPort {
  readonly registryEntry = scriptedRegistryEntry();
  readonly #inner = new ScriptedSemanticCompiler(expectedDateScript);
  lastOutput: CompilerOutput | null = null;

  async compile(input: CompilerInput, options?: CompileOptions): Promise<CompilerOutput> {
    const output = await this.#inner.compile(input, options);
    this.lastOutput = output;
    return output;
  }
}

/** Lets a test act while the runtime is suspended inside `compileRuns.append`. */
function gatedAppendStore(inner: InMemoryCaseRuntimeStore) {
  let armed = false;
  let signalEntered: () => void = () => {};
  let releaseGate: () => void = () => {};
  let gate: Promise<void> = Promise.resolve();

  const store: CaseRuntimeStore = {
    cases: inner.cases,
    idempotency: inner.idempotency,
    startRequests: inner.startRequests,
    compilerRegistry: inner.compilerRegistry,
    compileRuns: {
      append: async (record) => {
        if (armed) {
          armed = false;
          signalEntered();
          await gate;
        }
        return inner.compileRuns.append(record);
      },
      findById: (compileRunId) => inner.compileRuns.findById(compileRunId),
      listByCase: (caseId) => inner.compileRuns.listByCase(caseId),
    },
    createCase: (commit) => inner.createCase(commit),
    commitTurn: (commit) => inner.commitTurn(commit),
  };

  const arm = () => {
    armed = true;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    return { entered, release: () => releaseGate() };
  };
  return { store, arm };
}

describe('canonical mutation uses the audited compiler-output snapshot', () => {
  async function pausedInsideAppend() {
    const compiler = new RetainingCompiler();
    let arm!: () => { entered: Promise<void>; release: () => void };
    const h = harness({
      compiler,
      wrapStore: (inner) => {
        const gated = gatedAppendStore(inner);
        arm = gated.arm;
        return gated.store;
      },
    });
    const caseId = await startedCase(h);

    const gate = arm();
    const pending = h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));
    // The run record is built and validated by now; persistence is in flight.
    await gate.entered;
    return { h, caseId, compiler, pending, release: gate.release };
  }

  it('ignores an adapter that rewrites its output while the append is in flight', async () => {
    const { h, caseId, compiler, pending, release } = await pausedInsideAppend();

    const retained = compiler.lastOutput!;
    const auditedStatement = retained.assertions[0]!.statement;
    // Deliberately a mutation the validator would still accept, so the old
    // behaviour committed silently rather than erroring: the audit record and
    // canonical state would simply disagree about what the compiler said.
    retained.assertions[0]!.statement = 'MUTATED AFTER VALIDATION';
    retained.assertions[0]!.epistemic_strength = 'asserted_confident';
    release();

    const outcome = committed(await pending);
    expect(outcome.case.case_version).toBe(1);

    // The adapter really did change its own object.
    expect(retained.assertions[0]!.statement).toBe('MUTATED AFTER VALIDATION');

    const state = await loadState(h, caseId);
    const proposition = state.propositions[0]!;
    const runs = await h.store.compileRuns.listByCase(caseId);
    const audited = runs[0]!.output.assertions[0]!;

    // Canonical state is exactly what the compile-run record says it is.
    expect(proposition.statement).toBe(audited.statement);
    expect(proposition.type).toBe(audited.proposed_type);
    expect(proposition.epistemic_strength).toBe(audited.epistemic_strength);
    expect(proposition.in_reply_to).toBe(audited.requirement_id);

    // ... and that is the pre-mutation output, not the adapter's later edit.
    expect(audited.statement).toBe(auditedStatement);
    expect(proposition.statement).toBe(auditedStatement);
    expect(proposition.type).toBe('target_date');
    expect(proposition.epistemic_strength).toBe('recalled_uncertain');

    // The stored input snapshot is unaffected too.
    expect(runs[0]!.input_hash).toBe(compilerInputHash(runs[0]!.input));
    expect(runs[0]!.contract_issues).toEqual([]);
  });

  it('survives a structural late mutation that would otherwise throw', async () => {
    const { h, caseId, compiler, pending, release } = await pausedInsideAppend();

    // Removing the array the mutation layer iterates would previously escape
    // `submitTurn` as a rejected promise, outside the compiler boundary.
    const retained = compiler.lastOutput!;
    (retained as { assertions?: unknown }).assertions = undefined;
    (retained as { clarifications_requested?: unknown }).clarifications_requested = undefined;
    release();

    const outcome = committed(await pending);
    expect(outcome.accepted_proposition_ids).toHaveLength(1);

    const state = await loadState(h, caseId);
    expect(state.propositions).toHaveLength(1);
    expect(state.case_version).toBe(1);
    const runs = await h.store.compileRuns.listByCase(caseId);
    expect(runs[0]!.output.assertions).toHaveLength(1);
    expect(state.propositions[0]!.statement).toBe(runs[0]!.output.assertions[0]!.statement);
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
/* Inconsistency outranks the lock                                           */
/* ------------------------------------------------------------------------ */

describe('a lagging replay store is resolved before a locked case is refused', () => {
  /**
   * Commits one turn, then presents the case as attested while the replay
   * store lags behind it. `CASE_LOCKED` is non-retryable, so answering it to a
   * caller whose operation already committed would tell it to stop retrying
   * something that in fact succeeded.
   */
  async function lockedCaseWithLaggingStore() {
    const inner = new InMemoryCaseRuntimeStore();
    const locking = lockingStore(inner);
    const lagging = laggingReplayStore(locking.store);
    const writer = runtimeOver(
      lagging.store,
      new ScriptedSemanticCompiler(expectedDateScript),
      'w_',
    );

    const started = await writer.runtime.startCase(RELAY_ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;
    const original = committed(
      await writer.runtime.submitTurn(RELAY_ALICE, submitCommand({ case_id: caseId })),
    );

    const before = (await inner.cases.findById(caseId))!;
    locking.lock(caseId);
    lagging.hide(original.turn_id);
    const writerRegistrations = lagging.registerCalls();
    return { inner, lagging, caseId, original, before, writerRegistrations };
  }

  async function expectNothingHappened(
    inner: InMemoryCaseRuntimeStore,
    caseId: string,
    before: StoredCase,
    compiler: ScriptedSemanticCompiler,
  ) {
    expect(compiler.calls).toHaveLength(0);
    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
    expect(after.state.turn_log).toHaveLength(1);
    expect(after.state.propositions).toHaveLength(1);
    expect(after.state.case_version).toBe(1);
    expect(await inner.compileRuns.listByCase(caseId)).toHaveLength(1);
    expect(await inner.idempotency.listByCase(caseId)).toHaveLength(1);
  }

  it('answers a locked exact-id retry with retryable inconsistency, not CASE_LOCKED', async () => {
    const { inner, lagging, caseId, original, before, writerRegistrations } =
      await lockedCaseWithLaggingStore();

    const compiler = new ScriptedSemanticCompiler(expectedDateScript);
    const reader = runtimeOver(lagging.store, compiler, 'r_');
    const outcome = await reader.runtime.submitTurn(
      RELAY_ALICE,
      submitCommand({ case_id: caseId, expected_case_version: 1 }),
    );

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    // The caller's operation committed; telling it to stop is the one answer
    // that loses the result permanently.
    expect(outcome.failure.code).not.toBe('CASE_LOCKED');
    expect(outcome.failure.code).toBe('INTERNAL_ERROR');
    expect(outcome.failure.retryable).toBe(true);
    expect(reader.diagnostics.events.map((event) => event.kind)).toEqual([
      'replay_store_inconsistent',
    ]);
    expect(lagging.registerCalls()).toBe(writerRegistrations);
    await expectNothingHappened(inner, caseId, before, compiler);

    // Once the replicas converge the caller recovers its original result,
    // even though the case is still locked.
    lagging.reveal(original.turn_id);
    const recovered = await reader.runtime.submitTurn(
      RELAY_ALICE,
      submitCommand({ case_id: caseId, expected_case_version: 1 }),
    );
    expect(recovered.kind).toBe('replayed');
    if (recovered.kind !== 'replayed') return;
    expect(recovered.match).toBe('client_turn_id');
    expect(recovered.turn_id).toBe(original.turn_id);
    expect(recovered.case.status).toBe('locked');
  });

  it('answers a locked regenerated retry the same way, then fingerprint-replays', async () => {
    const { inner, lagging, caseId, original, before, writerRegistrations } =
      await lockedCaseWithLaggingStore();

    const regenerated = submitCommand({
      case_id: caseId,
      client_turn_id: 'client_2',
      expected_case_version: 1,
      payload: payload('I expected it finished by April 25 — and nobody ever said otherwise!'),
    });

    const compiler = new ScriptedSemanticCompiler(expectedDateScript);
    const reader = runtimeOver(lagging.store, compiler, 'r_');
    const outcome = await reader.runtime.submitTurn(RELAY_ALICE, regenerated);

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).not.toBe('CASE_LOCKED');
    expect(outcome.failure.code).toBe('INTERNAL_ERROR');
    expect(outcome.failure.retryable).toBe(true);
    expect(reader.diagnostics.events.map((event) => event.kind)).toEqual([
      'replay_store_inconsistent',
    ]);
    expect(lagging.registerCalls()).toBe(writerRegistrations);
    await expectNothingHappened(inner, caseId, before, compiler);

    lagging.reveal(original.turn_id);
    const recovered = await reader.runtime.submitTurn(RELAY_ALICE, regenerated);
    expect(recovered.kind).toBe('replayed');
    if (recovered.kind !== 'replayed') return;
    expect(recovered.match).toBe('fingerprint');
    expect(recovered.turn_id).toBe(original.turn_id);
  });

  it('still refuses a genuinely fresh write to a locked case', async () => {
    const { inner, lagging, caseId, before } = await lockedCaseWithLaggingStore();

    // No exact id in the log and no same-content/same-provenance turn, so
    // there is no replay identity to resolve and the lock stands.
    const compiler = new ScriptedSemanticCompiler(expectedDateScript);
    const reader = runtimeOver(lagging.store, compiler, 'r_');
    const outcome = await reader.runtime.submitTurn(
      RELAY_ALICE,
      submitCommand({
        case_id: caseId,
        client_turn_id: 'client_fresh',
        expected_case_version: 1,
        in_reply_to: ['req_paid'],
        payload: payload('I paid the deposit on 1 March.'),
      }),
    );

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.failure.code).toBe('CASE_LOCKED');
    expect(outcome.failure.retryable).toBe(false);
    expect(reader.diagnostics.events).toEqual([]);
    await expectNothingHappened(inner, caseId, before, compiler);
  });
});

/* ------------------------------------------------------------------------ */
/* Cancellation is re-checked after the compiler returns                     */
/* ------------------------------------------------------------------------ */

/**
 * A well-behaved-looking adapter that nonetheless ignores the advisory signal
 * and resolves valid output after the caller has already aborted. Real
 * adapters do this: they may not wire the signal through, may fail to abort a
 * provider request, or may simply win the race.
 */
class IgnoresAbortCompiler implements SemanticCompilerPort {
  readonly registryEntry = scriptedRegistryEntry();
  readonly #inner = new ScriptedSemanticCompiler(expectedDateScript);
  readonly started: Promise<void>;
  readonly #gate: Promise<void>;
  #markStarted: () => void = () => {};
  #open: () => void = () => {};
  calls = 0;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.#markStarted = resolve;
    });
    this.#gate = new Promise<void>((resolve) => {
      this.#open = resolve;
    });
  }

  release(): void {
    this.#open();
  }

  async compile(input: CompilerInput): Promise<CompilerOutput> {
    this.calls += 1;
    this.#markStarted();
    await this.#gate;
    return this.#inner.compile(input);
  }
}

describe('a compiler that ignores the abort cannot commit the cancelled turn', () => {
  it('rejects with the caller reason and persists nothing', async () => {
    const compiler = new IgnoresAbortCompiler();
    const h = harness({ compiler });
    const caseId = await startedCase(h);
    const before = (await h.store.cases.findById(caseId))!;
    const controller = new AbortController();
    const reason = new Error('the user closed the tab');

    const pending = h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }), {
      signal: controller.signal,
    });
    await compiler.started;
    controller.abort(reason);
    // The adapter resolves valid output anyway, a moment too late.
    compiler.release();

    await expect(pending).rejects.toBe(reason);
    expect(compiler.calls).toBe(1);

    const after = (await h.store.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
    expect(after.state.turn_log).toHaveLength(0);
    expect(after.state.propositions).toHaveLength(0);
    expect(after.state.case_version).toBe(0);
    expect(await h.store.compileRuns.listByCase(caseId)).toEqual([]);
    expect(await h.store.idempotency.listByCase(caseId)).toEqual([]);
    expect(h.diagnostics.events).toEqual([]);
  });

  it('leaves an uncancelled compile completely unchanged', async () => {
    const compiler = new IgnoresAbortCompiler();
    const h = harness({ compiler });
    const caseId = await startedCase(h);
    const controller = new AbortController();

    const pending = h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }), {
      signal: controller.signal,
    });
    await compiler.started;
    compiler.release();

    const outcome = committed(await pending);
    expect(outcome.case.case_version).toBe(1);
    expect((await loadState(h, caseId)).turn_log).toHaveLength(1);
  });
});

/**
 * Suspends `compileRuns.append` and records whether `commitTurn` was ever
 * reached, so a test can abort while the audit write is in flight.
 */
function gatedAuditAppendStore(inner: InMemoryCaseRuntimeStore) {
  let armed = false;
  let signalEntered: () => void = () => {};
  let releaseGate: () => void = () => {};
  let gate: Promise<void> = Promise.resolve();
  let commitCalls = 0;

  const store: CaseRuntimeStore = {
    cases: inner.cases,
    idempotency: inner.idempotency,
    startRequests: inner.startRequests,
    compilerRegistry: inner.compilerRegistry,
    compileRuns: {
      append: async (record) => {
        if (armed) {
          armed = false;
          signalEntered();
          await gate;
        }
        return inner.compileRuns.append(record);
      },
      findById: (id) => inner.compileRuns.findById(id),
      listByCase: (caseId) => inner.compileRuns.listByCase(caseId),
    },
    createCase: (commit) => inner.createCase(commit),
    commitTurn: (commit) => {
      commitCalls += 1;
      return inner.commitTurn(commit);
    },
  };

  const arm = () => {
    armed = true;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    return { entered, release: () => releaseGate() };
  };
  return { store, arm, commitCalls: () => commitCalls };
}

describe('cancellation is arbitrated again before the canonical commit starts', () => {
  it('refuses to commit when the abort lands while the audit append is in flight', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const gated = gatedAuditAppendStore(inner);
    const compiler = new ScriptedSemanticCompiler(expectedDateScript);
    const h = runtimeOver(gated.store, compiler);

    const started = await h.runtime.startCase(ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;
    const before = (await inner.cases.findById(caseId))!;

    const controller = new AbortController();
    const reason = new Error('the caller disconnected');
    const gate = gated.arm();

    // Compile succeeds and the first post-compile check passes; the abort
    // lands only once the audit append is already pending.
    const pending = h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }), {
      signal: controller.signal,
    });
    await gate.entered;
    controller.abort(reason);
    gate.release();

    await expect(pending).rejects.toBe(reason);

    // Nothing canonical happened, and the commit was never even attempted.
    expect(gated.commitCalls()).toBe(0);
    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
    expect(after.state.turn_log).toHaveLength(0);
    expect(after.state.propositions).toHaveLength(0);
    expect(after.state.case_version).toBe(0);
    expect(await inner.idempotency.listByCase(caseId)).toEqual([]);

    // The compile-run audit record legitimately stands: the compiler really
    // did execute, and the log is append-only. Deleting it to make the
    // cancellation look tidier would falsify the audit trail.
    const runs = await inner.compileRuns.listByCase(caseId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.output.assertions).toHaveLength(1);
    // ... and it describes a turn that never became canonical.
    expect(after.state.turn_log.map((turn) => turn.turn_id)).not.toContain(runs[0]!.turn_id);
  });

  it('commits normally when the same append gate is released without an abort', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const gated = gatedAuditAppendStore(inner);
    const h = runtimeOver(gated.store, new ScriptedSemanticCompiler(expectedDateScript));

    const started = await h.runtime.startCase(ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;

    const controller = new AbortController();
    const gate = gated.arm();
    const pending = h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }), {
      signal: controller.signal,
    });
    await gate.entered;
    gate.release();

    const outcome = committed(await pending);
    expect(outcome.case.case_version).toBe(1);
    expect(gated.commitCalls()).toBe(1);
    expect((await inner.cases.findById(caseId))!.state.turn_log).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ */
/* An empty operation id is not an identity                                  */
/* ------------------------------------------------------------------------ */

describe('client_turn_id must be null or a real id', () => {
  it('demonstrates why an empty key must never be stored as exact identity', () => {
    // The hazard, at the layer where it bites. If a blank key were ever
    // committed, core's exact-id match would replay it for ANY later
    // submission carrying the same blank key.
    const stored: IdempotencyRecord = {
      case_id: 'case_1',
      request_fingerprint: 'a'.repeat(64),
      client_turn_id: '',
      turn_id: 'turn_1',
      recorded_at_ms: START_MS,
      response: {
        case_version: 1,
        turn_id: 'turn_1',
        accepted_proposition_ids: ['prop_1'],
        superseded_proposition_ids: [],
        opened_clarification_ids: [],
        warnings: [],
      },
    };
    const unrelated = precheckSubmit(
      {
        case_id: 'case_1',
        principal_id: 'user_alice',
        expected_case_version: 1,
        // Entirely different answer, different requirement.
        in_reply_to: ['req_paid'],
        payload: payload('I paid the deposit on 1 March.'),
        client_turn_id: '',
      },
      { store: [stored], log: [], current_case_version: 1, now_ms: START_MS },
    );
    expect(unrelated.kind).toBe('replay');
    if (unrelated.kind !== 'replay') return;
    expect(unrelated.match).toBe('client_turn_id');
    // A real user answer would have been silently dropped and the earlier
    // result returned in its place. The runtime must never create this state.
  });

  it('refuses an empty id before touching storage, the registry or the compiler', async () => {
    const inner = new InMemoryCaseRuntimeStore();
    const lagging = laggingReplayStore(inner);
    const compiler = new ScriptedSemanticCompiler(expectedDateScript);
    const h = runtimeOver(lagging.store, compiler);
    const started = await h.runtime.startCase(ALICE, startCommand('request_1'));
    if (started.kind !== 'created') throw new Error('expected creation');
    const caseId = started.case.case_id;
    const before = (await inner.cases.findById(caseId))!;
    const registrationsBefore = lagging.registerCalls();

    for (const blank of ['', '   ']) {
      const outcome = await h.runtime.submitTurn(
        ALICE,
        submitCommand({ case_id: caseId, client_turn_id: blank }),
      );
      expect(outcome.kind).toBe('failed');
      if (outcome.kind !== 'failed') continue;
      expect(outcome.failure.code).toBe('INVALID_INPUT');
      expect(outcome.failure.retryable).toBe(false);
    }

    expect(compiler.calls).toHaveLength(0);
    expect(lagging.registerCalls()).toBe(registrationsBefore);
    const after = (await inner.cases.findById(caseId))!;
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
    expect(after.state.turn_log).toHaveLength(0);
    expect(await inner.compileRuns.listByCase(caseId)).toEqual([]);
    expect(await inner.idempotency.listByCase(caseId)).toEqual([]);
  });

  it('keeps null meaning "no exact identity", with the heuristic path intact', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);

    const first = committed(
      await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId, client_turn_id: null })),
    );
    // No exact identity, so a regenerated retry falls back to content +
    // provenance rather than matching on a key.
    const retry = await h.runtime.submitTurn(
      ALICE,
      submitCommand({
        case_id: caseId,
        client_turn_id: null,
        expected_case_version: 1,
        payload: payload('I expected it finished by April 25 — and nobody ever said otherwise!'),
      }),
    );
    expect(retry.kind).toBe('replayed');
    if (retry.kind !== 'replayed') return;
    expect(retry.match).toBe('fingerprint');
    expect(retry.turn_id).toBe(first.turn_id);
  });

  it('keeps exact lifetime replay for a valid id', async () => {
    const h = harness();
    h.scripted.setScript(expectedDateScript);
    const caseId = await startedCase(h);
    const first = committed(await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId })));

    const retry = await h.runtime.submitTurn(ALICE, submitCommand({ case_id: caseId }));
    expect(retry.kind).toBe('replayed');
    if (retry.kind !== 'replayed') return;
    expect(retry.match).toBe('client_turn_id');
    expect(retry.turn_id).toBe(first.turn_id);
  });

  it('applies the same rule to the start-case request id', async () => {
    const h = harness();
    for (const blank of ['', '   ']) {
      const outcome = await h.runtime.startCase(ALICE, { client_request_id: blank });
      expect(outcome.kind).toBe('failed');
      if (outcome.kind !== 'failed') continue;
      expect(outcome.failure.code).toBe('INVALID_INPUT');
    }
    expect(await h.store.cases.findActiveDraftByPrincipal('user_alice')).toBeNull();
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
