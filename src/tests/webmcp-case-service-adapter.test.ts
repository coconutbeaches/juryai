import { describe, expect, it } from 'vitest';
import { projectCaseState, type CaseState } from '../webmcp/core/attestation.js';
import type { ConflictTurnSummary } from '../webmcp/core/idempotency.js';
import type { RecentInterpretationSlot } from '../webmcp/core/types.js';
import type {
  GetCaseStateOutcome,
  RuntimeCallOptions,
  RuntimeRequestContext,
  StartCaseOutcome,
  SubmitTurnCommand as RuntimeSubmitTurnCommand,
  SubmitTurnOutcome,
} from '../webmcp/runtime/index.js';
import {
  createRuntimeCaseService,
  type RuntimeCaseServiceDependencies,
  type TrustedRuntimeRequestContextProvider,
} from '../webmcp/service/index.js';
import type { SubmitTurnCommand as ServiceSubmitTurnCommand } from '../webmcp/tools/ports.js';

const CANONICAL_STATE: CaseState = {
  case_id: 'case-1',
  case_version: 3,
  principal_id: 'principal-1',
  disclosure_version: 'disclosure-v1',
  disclosure_accepted_at: '2026-08-31T08:00:00.000Z',
  requirements: [
    {
      requirement_id: 'R24',
      prompt: 'What did you agree about the completion date?',
      satisfying_types: ['target_date'],
      min_propositions: 1,
      max_propositions: null,
      adverse_fact_probe: false,
      reopened_from: null,
    },
  ],
  propositions: [],
  clarifications: [],
  evidence_references: [],
  turn_log: [],
  attestations: [],
};

const CASE_STATE = projectCaseState(CANONICAL_STATE, {
  review_url: '/case/case-1/review',
  warnings: ['Review the relayed wording carefully.'],
});

const ALICE: RuntimeRequestContext = {
  principal: { principal_id: 'principal-1' },
  source_channel: 'webmcp_agent_relay',
  relaying_agent: 'ChatGPT (trusted session)',
};

const RECORDED: RecentInterpretationSlot[] = [
  {
    proposition_id: 'prop-1',
    requirement_id: 'R24',
    statement: 'The user expected completion by 25 April.',
    type: 'target_date',
    epistemic_strength: 'recalled_uncertain',
    attribution: 'Relayed by ChatGPT; recalled with uncertainty.',
  },
];

const RECENT_TURN: ConflictTurnSummary = {
  turn_id: 'turn-1',
  in_reply_to: ['R24'],
  answer_excerpt: 'I expected April 25.',
  request_fingerprint: 'a'.repeat(64),
  client_turn_id: 'client-turn-1',
  received_at: '2026-08-31T08:01:00.000Z',
};

const SUBMIT_COMMAND: ServiceSubmitTurnCommand = {
  case_id: 'case-1',
  expected_case_version: 3,
  in_reply_to: ['R24'],
  payload: { context: [], answer: { role: 'user', text: 'I expected April 25.' } },
  client_turn_id: 'client-turn-2',
};

type RuntimeOperations = RuntimeCaseServiceDependencies['runtime'];

function runtimeStub(overrides: Partial<RuntimeOperations> = {}): RuntimeOperations {
  return {
    startCase: async (): Promise<StartCaseOutcome> => ({
      kind: 'created',
      replayed: false,
      case: CASE_STATE,
    }),
    getCaseState: async (): Promise<GetCaseStateOutcome> => ({ kind: 'ok', case: CASE_STATE }),
    submitTurn: async (): Promise<SubmitTurnOutcome> => ({
      kind: 'committed',
      turn_id: 'turn-2',
      case: CASE_STATE,
      recorded: RECORDED,
      accepted_proposition_ids: ['prop-1'],
      superseded_proposition_ids: ['prop-old'],
      opened_clarification_ids: [],
      warnings: [],
    }),
    ...overrides,
  };
}

function contextProvider(
  getRuntimeRequestContext: TrustedRuntimeRequestContextProvider['getRuntimeRequestContext'] = () =>
    ALICE,
): TrustedRuntimeRequestContextProvider {
  return { getRuntimeRequestContext };
}

function service(
  runtime: RuntimeOperations,
  provider: TrustedRuntimeRequestContextProvider = contextProvider(),
) {
  return createRuntimeCaseService({ runtime, contextProvider: provider });
}

describe('Step 63 runtime CaseServicePort adapter', () => {
  it.each([false, true])(
    'maps created (runtime replayed=%s) to the same start success',
    async (replayed) => {
      const commands: unknown[] = [];
      const contexts: RuntimeRequestContext[] = [];
      const adapter = service(
        runtimeStub({
          startCase: async (context, command) => {
            contexts.push(context);
            commands.push(command);
            return { kind: 'created', replayed, case: CASE_STATE };
          },
        }),
      );

      const result = await adapter.startCase({ client_request_id: 'start-request-1' });

      expect(contexts).toEqual([ALICE]);
      expect(commands).toEqual([{ client_request_id: 'start-request-1' }]);
      expect(result).toEqual({ ok: true, case: CASE_STATE });
      expect(result).not.toHaveProperty('replayed');
    },
  );

  it('maps OPEN_DRAFT_EXISTS without silently resuming the unrelated draft', async () => {
    const result = await service(
      runtimeStub({
        startCase: async () => ({ kind: 'open_draft_exists', case: CASE_STATE }),
      }),
    ).startCase({ client_request_id: 'different-request' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'OPEN_DRAFT_EXISTS',
        message: 'An active draft already exists.',
        retryable: false,
      },
      case: CASE_STATE,
    });
  });

  it('maps runtime authentication failure into the safe service envelope', async () => {
    const failure = {
      code: 'AUTH_REQUIRED' as const,
      message: 'No authenticated principal.',
      retryable: false,
    };
    const result = await service(
      runtimeStub({ startCase: async () => ({ kind: 'failed', failure }) }),
    ).startCase({ client_request_id: 'start-request-1' });

    expect(result).toEqual({ ok: false, error: failure });
  });

  it.each([
    ['active draft', {}],
    ['explicit case', { case_id: 'case-1' }],
  ])('passes through the canonical state for %s lookup', async (_label, query) => {
    const queries: unknown[] = [];
    const adapter = service(
      runtimeStub({
        getCaseState: async (_context, runtimeQuery) => {
          queries.push(runtimeQuery);
          return { kind: 'ok', case: CASE_STATE };
        },
      }),
    );

    const result = await adapter.getCaseState(query);

    expect(queries).toEqual([query]);
    expect(result).toEqual({ ok: true, case: CASE_STATE });
    if (result.ok) expect(result.case).toBe(CASE_STATE);
  });

  it.each(['foreign case', 'nonexistent case'])(
    'preserves the non-disclosing CASE_NOT_FOUND result for a %s',
    async () => {
      const failure = {
        code: 'CASE_NOT_FOUND' as const,
        message: 'No such case.',
        retryable: false,
      };
      const result = await service(
        runtimeStub({ getCaseState: async () => ({ kind: 'failed', failure }) }),
      ).getCaseState({ case_id: 'case-unknown' });

      expect(result).toEqual({ ok: false, error: failure });
    },
  );

  it('maps committed semantic effects without exposing runtime-only fields', async () => {
    const outcome: SubmitTurnOutcome = {
      kind: 'committed',
      turn_id: 'turn-2',
      case: { ...CASE_STATE, case_version: 4 },
      recorded: RECORDED,
      accepted_proposition_ids: ['prop-1'],
      superseded_proposition_ids: ['prop-old'],
      opened_clarification_ids: ['clarification-internal'],
      warnings: ['runtime-internal-effect-field'],
    };
    const result = await service(runtimeStub({ submitTurn: async () => outcome })).submitTurn(
      SUBMIT_COMMAND,
    );

    expect(result).toEqual({
      ok: true,
      turn_id: 'turn-2',
      case: outcome.case,
      recorded: RECORDED,
      superseded: ['prop-old'],
    });
    expect(result).not.toHaveProperty('accepted_proposition_ids');
    expect(result).not.toHaveProperty('opened_clarification_ids');
    expect(result).not.toHaveProperty('warnings');
  });

  it('maps exact replay to the identical recorded effects with replayed=true', async () => {
    const outcome: SubmitTurnOutcome = {
      kind: 'replayed',
      match: 'client_turn_id',
      recorded_at_case_version: 4,
      turn_id: 'turn-2',
      case: { ...CASE_STATE, case_version: 4 },
      recorded: RECORDED,
      accepted_proposition_ids: ['prop-1'],
      superseded_proposition_ids: ['prop-old'],
      opened_clarification_ids: [],
      warnings: [],
    };
    const result = await service(runtimeStub({ submitTurn: async () => outcome })).submitTurn(
      SUBMIT_COMMAND,
    );

    expect(result).toEqual({
      ok: true,
      replayed: true,
      turn_id: 'turn-2',
      case: outcome.case,
      recorded: RECORDED,
      superseded: ['prop-old'],
    });
  });

  it('preserves the complete structured VERSION_CONFLICT recovery result', async () => {
    const outcome: SubmitTurnOutcome = {
      kind: 'version_conflict',
      current_case_version: 4,
      recent_turns: [RECENT_TURN],
      likely_already_recorded: true,
      case: { ...CASE_STATE, case_version: 4 },
    };
    const result = await service(runtimeStub({ submitTurn: async () => outcome })).submitTurn(
      SUBMIT_COMMAND,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VERSION_CONFLICT',
        message: 'The case changed before this turn could be recorded.',
        retryable: false,
      },
      current_case_version: 4,
      recent_turns: [RECENT_TURN],
      likely_already_recorded: true,
      case: outcome.case,
    });
  });

  it.each(['CASE_LOCKED', 'INVALID_INPUT'] as const)(
    'maps runtime %s directly into the safe service error envelope',
    async (code) => {
      const failure = { code, message: `Safe ${code} message.`, retryable: false };
      const result = await service(
        runtimeStub({ submitTurn: async () => ({ kind: 'failed', failure }) }),
      ).submitTurn(SUBMIT_COMMAND);

      expect(result).toEqual({ ok: false, error: failure });
    },
  );

  it('does no provider or runtime work when any service signal is already aborted', async () => {
    let providerCalls = 0;
    let runtimeCalls = 0;
    const provider = contextProvider(() => {
      providerCalls += 1;
      return ALICE;
    });
    const runtime = runtimeStub({
      startCase: async () => {
        runtimeCalls += 1;
        return { kind: 'created', replayed: false, case: CASE_STATE };
      },
      getCaseState: async () => {
        runtimeCalls += 1;
        return { kind: 'ok', case: CASE_STATE };
      },
      submitTurn: async () => {
        runtimeCalls += 1;
        return runtimeStub().submitTurn(ALICE, SUBMIT_COMMAND);
      },
    });
    const adapter = service(runtime, provider);
    const reason = new Error('caller cancelled');
    const controller = new AbortController();
    controller.abort(reason);

    await expect(
      adapter.startCase({ client_request_id: 'start-request-1' }, { signal: controller.signal }),
    ).rejects.toBe(reason);
    await expect(adapter.getCaseState({}, { signal: controller.signal })).rejects.toBe(reason);
    await expect(adapter.submitTurn(SUBMIT_COMMAND, { signal: controller.signal })).rejects.toBe(
      reason,
    );
    expect(providerCalls).toBe(0);
    expect(runtimeCalls).toBe(0);
  });

  it('rechecks cancellation after trusted context resolution and before runtime work', async () => {
    let runtimeCalls = 0;
    const controller = new AbortController();
    const adapter = service(
      runtimeStub({
        getCaseState: async () => {
          runtimeCalls += 1;
          return { kind: 'ok', case: CASE_STATE };
        },
      }),
      contextProvider(() => {
        controller.abort(new Error('cancelled during session lookup'));
        return ALICE;
      }),
    );

    await expect(adapter.getCaseState({}, { signal: controller.signal })).rejects.toThrow(
      'cancelled during session lookup',
    );
    expect(runtimeCalls).toBe(0);
  });

  it('passes AbortSignal to trusted context resolution and runtime submit unchanged', async () => {
    const providerOptions: Array<RuntimeCallOptions | undefined> = [];
    const runtimeOptions: Array<RuntimeCallOptions | undefined> = [];
    const adapter = service(
      runtimeStub({
        submitTurn: async (_context, _command, options) => {
          runtimeOptions.push(options);
          return runtimeStub().submitTurn(ALICE, SUBMIT_COMMAND);
        },
      }),
      contextProvider((options) => {
        providerOptions.push(options);
        return ALICE;
      }),
    );
    const controller = new AbortController();

    await adapter.submitTurn(SUBMIT_COMMAND, { signal: controller.signal });

    expect(providerOptions).toEqual([{ signal: controller.signal }]);
    expect(runtimeOptions).toEqual([{ signal: controller.signal }]);
  });

  it.each([
    ['omitted', { source_language: 'de' }, undefined],
    ['explicit true', { source_language: 'de', translation_indicated: true }, true],
    ['explicit false', { source_language: 'de', translation_indicated: false }, false],
  ] as const)(
    'passes translation provenance %s without inferring from source_language',
    async (_label, relayFields, expected) => {
      const commands: RuntimeSubmitTurnCommand[] = [];
      const adapter = service(
        runtimeStub({
          submitTurn: async (_context, command) => {
            commands.push(command);
            return runtimeStub().submitTurn(ALICE, SUBMIT_COMMAND);
          },
        }),
      );
      const command = { ...SUBMIT_COMMAND, ...relayFields };

      await adapter.submitTurn(command);

      expect(commands).toEqual([command]);
      expect(commands[0]?.translation_indicated).toBe(expected);
      expect(Object.prototype.hasOwnProperty.call(commands[0], 'translation_indicated')).toBe(
        expected !== undefined,
      );
    },
  );
});
