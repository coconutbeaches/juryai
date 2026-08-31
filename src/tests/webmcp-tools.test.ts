import { describe, expect, it } from 'vitest';
import { projectCaseState, type CaseState } from '../webmcp/core/attestation.js';
import type { ConflictTurnSummary } from '../webmcp/core/idempotency.js';
import {
  AGENT_DATA_BLOCK_OPEN,
  PERMITTED_CASE_STATE_SLOTS,
  assertNoForbiddenSlots,
  type CaseStateResponse,
} from '../webmcp/core/types.js';
import { MAX_CONTEXT_MESSAGES } from '../webmcp/core/turns.js';
import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';
import type {
  CaseServicePort,
  GetCaseStateQuery,
  JuryAiErrorCode,
  ServiceCallOptions,
  StartCaseCommand,
  SubmitTurnCommand,
  VersionConflictResult,
} from '../webmcp/tools/ports.js';
import { registerJuryAiWebMcpTools, type ModelContextLike } from '../webmcp/tools/register.js';
import { submitTurnInputSchema } from '../webmcp/tools/schemas.js';

const CANONICAL_STATE: CaseState = {
  case_id: 'case-1',
  case_version: 3,
  principal_id: 'principal-1',
  disclosure_version: 'disclosure-v1',
  disclosure_accepted_at: '2026-08-29T08:00:00.000Z',
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

const CASE_STATE: CaseStateResponse = projectCaseState(CANONICAL_STATE, {
  review_url: '/case/case-1/review',
  warnings: ['Review the relayed wording carefully.'],
});

const VALID_SUBMIT_INPUT = {
  case_id: 'case-1',
  expected_case_version: 3,
  in_reply_to: ['R24'],
  context: [{ role: 'assistant' as const, text: 'Was April 25 an agreed deadline?' }],
  answer: { text: 'No, that was basically what I expected.', source_language: 'en' },
};

const RECENT_CONFLICT_TURN: ConflictTurnSummary = {
  turn_id: 'turn-4',
  in_reply_to: ['R24'],
  answer_excerpt: 'No, that was basically what I expected.',
  request_fingerprint: 'a'.repeat(64),
  client_turn_id: 'client-turn-previous',
  received_at: '2026-08-29T08:30:00.000Z',
};

const GENERIC_ERROR_CODES = {
  AUTH_REQUIRED: true,
  CASE_NOT_FOUND: true,
  CASE_LOCKED: true,
  INVALID_INPUT: true,
  CONFLICT: true,
  INTERNAL_ERROR: true,
} as const satisfies Record<JuryAiErrorCode, true>;

const MALFORMED_CASE = {
  ...CASE_STATE,
  principal_id: 'principal-secret-value',
  full_turn_history: ['full-history-secret-value'],
  compiler_version: 'compiler-secret-value',
};

function expectMalformedCaseToFailClosed(result: unknown): void {
  expect(result).toMatchObject({
    kind: 'juryai_data',
    data: {
      ok: false,
      error: { code: 'INTERNAL_ERROR', retryable: false },
    },
  });
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain('principal-secret-value');
  expect(serialized).not.toContain('full-history-secret-value');
  expect(serialized).not.toContain('compiler-secret-value');
  expect(serialized).not.toContain('principal_id');
  expect(serialized).not.toContain('full_turn_history');
  expect(serialized).not.toContain('compiler_version');
}

function makeService(overrides: Partial<CaseServicePort> = {}): CaseServicePort {
  return {
    startCase: async () => ({ ok: true, case: CASE_STATE }),
    getCaseState: async () => ({ ok: true, case: CASE_STATE }),
    submitTurn: async () => ({
      ok: true,
      turn_id: 'T1',
      case: { ...CASE_STATE, case_version: 4 },
      recorded: [],
      superseded: [],
    }),
    ...overrides,
  };
}

function getTool(service: CaseServicePort, name: string) {
  const tool = createJuryAiToolDefinitions(service).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

describe('JuryAI WebMCP P2 V0.2 tool surface', () => {
  it('exposes exactly the three frozen tools with correct annotations', () => {
    const tools = createJuryAiToolDefinitions(makeService());

    expect(tools.map((tool) => tool.name)).toEqual(['start_case', 'get_case_state', 'submit_turn']);
    expect(tools.map((tool) => tool.annotations)).toEqual([
      { readOnlyHint: false, untrustedContentHint: true },
      { readOnlyHint: true, untrustedContentHint: true },
      { readOnlyHint: false, untrustedContentHint: true },
    ]);
    expect(tools.every((tool) => tool.description.includes('incomplete'))).toBe(true);
    expect(tools.every((tool) => tool.description.includes('no authority to attest'))).toBe(true);
  });

  it('keeps start_case retry identity stable and forwards the execution signal', async () => {
    const ids: string[] = [];
    const signals: Array<AbortSignal | undefined> = [];
    let attempts = 0;
    const service = makeService({
      startCase: async (command: StartCaseCommand, options?: ServiceCallOptions) => {
        attempts += 1;
        ids.push(command.client_request_id);
        signals.push(options?.signal);
        if (attempts === 1) throw new Error('temporary transport failure');
        return { ok: true, case: CASE_STATE };
      },
    });
    const controller = new AbortController();
    const [tool] = createJuryAiToolDefinitions(service, {
      client_id_factory: () => 'stable-request-id',
      write_retry_attempts: 2,
    });
    const result = await tool!.execute({}, { signal: controller.signal });

    expect(ids).toEqual(['stable-request-id', 'stable-request-id']);
    expect(signals).toEqual([controller.signal, controller.signal]);
    expect(result).toMatchObject({ kind: 'juryai_data', data: { ok: true } });
  });

  it('represents OPEN_DRAFT_EXISTS instead of silently resuming in start_case', async () => {
    const service = makeService({
      startCase: async () => ({
        ok: false,
        error: {
          code: 'OPEN_DRAFT_EXISTS',
          message: 'An active draft already exists.',
          retryable: false,
        },
        case: CASE_STATE,
      }),
    });
    const tool = getTool(service, 'start_case');
    const result = await tool.execute({});

    expect(tool.description).toContain('never silently resumes');
    expect(result).toMatchObject({
      kind: 'juryai_data',
      data: {
        ok: false,
        error: { code: 'OPEN_DRAFT_EXISTS', retryable: false },
        case: { case_id: CASE_STATE.case_id, review_url: CASE_STATE.review_url },
      },
    });
  });

  it('passes a canonical user-answer payload and stable adapter-owned client_turn_id', async () => {
    const commands: SubmitTurnCommand[] = [];
    let attempts = 0;
    const service = makeService({
      submitTurn: async (command: SubmitTurnCommand) => {
        commands.push(command);
        attempts += 1;
        if (attempts === 1) throw new Error('network reset');
        return {
          ok: true,
          replayed: true,
          turn_id: 'T25',
          case: { ...CASE_STATE, case_version: 4 },
          recorded: [],
          superseded: [],
        };
      },
    });
    const definitions = createJuryAiToolDefinitions(service, {
      client_id_factory: () => 'stable-turn-id',
      write_retry_attempts: 2,
    });
    const submit = definitions.find((candidate) => candidate.name === 'submit_turn')!;
    const result = await submit.execute(VALID_SUBMIT_INPUT);

    expect(Object.keys(submitTurnInputSchema.properties)).toEqual([
      'case_id',
      'expected_case_version',
      'in_reply_to',
      'context',
      'answer',
    ]);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual(commands[1]);
    expect(commands[0]).toEqual({
      case_id: 'case-1',
      expected_case_version: 3,
      in_reply_to: ['R24'],
      payload: {
        context: [{ role: 'assistant', text: 'Was April 25 an agreed deadline?' }],
        answer: { role: 'user', text: 'No, that was basically what I expected.' },
      },
      source_language: 'en',
      client_turn_id: 'stable-turn-id',
    });
    expect(result).toMatchObject({ kind: 'juryai_data', data: { ok: true, replayed: true } });
  });

  it('preserves explicit translation provenance and the same metadata across retries', async () => {
    const commands: SubmitTurnCommand[] = [];
    let attempts = 0;
    const service = makeService({
      submitTurn: async (command) => {
        commands.push(command);
        attempts += 1;
        if (attempts === 1) throw new Error('temporary transport failure');
        return {
          ok: true,
          replayed: true,
          turn_id: 'T-translated',
          case: { ...CASE_STATE, case_version: 4 },
          recorded: [],
          superseded: [],
        };
      },
    });
    const tool = createJuryAiToolDefinitions(service, {
      client_id_factory: () => 'stable-translated-turn-id',
      write_retry_attempts: 2,
    }).find((candidate) => candidate.name === 'submit_turn')!;

    await tool.execute({
      ...VALID_SUBMIT_INPUT,
      answer: {
        text: VALID_SUBMIT_INPUT.answer.text,
        source_language: 'de',
        translation_indicated: true,
      },
    });

    expect(submitTurnInputSchema.properties.answer.properties.translation_indicated).toMatchObject({
      type: 'boolean',
    });
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual(commands[1]);
    expect(commands[0]).toMatchObject({
      client_turn_id: 'stable-translated-turn-id',
      source_language: 'de',
      translation_indicated: true,
    });
  });

  it.each([
    ['source language alone', { source_language: 'de' }, false, undefined],
    ['explicit false', { source_language: 'de', translation_indicated: false }, true, false],
  ] as const)(
    '%s does not invent translated provenance',
    async (_label, answerMetadata, hasTranslationField, expectedTranslation) => {
      const commands: SubmitTurnCommand[] = [];
      const service = makeService({
        submitTurn: async (command) => {
          commands.push(command);
          return {
            ok: true,
            turn_id: 'T-provenance',
            case: { ...CASE_STATE, case_version: 4 },
            recorded: [],
            superseded: [],
          };
        },
      });
      const tool = createJuryAiToolDefinitions(service, {
        client_id_factory: () => 'provenance-turn-id',
      }).find((candidate) => candidate.name === 'submit_turn')!;

      await tool.execute({
        ...VALID_SUBMIT_INPUT,
        answer: { text: VALID_SUBMIT_INPUT.answer.text, ...answerMetadata },
      });

      expect(commands).toHaveLength(1);
      expect(commands[0]?.source_language).toBe('de');
      expect(commands[0]?.translation_indicated).toBe(expectedTranslation);
      expect(Object.prototype.hasOwnProperty.call(commands[0], 'translation_indicated')).toBe(
        hasTranslationField,
      );
    },
  );

  it.each([0, 1])('accepts expected_case_version %i', async (expectedCaseVersion) => {
    const commands: SubmitTurnCommand[] = [];
    const service = makeService({
      submitTurn: async (command) => {
        commands.push(command);
        return {
          ok: true,
          turn_id: 'T-first',
          case: { ...CASE_STATE, case_version: expectedCaseVersion + 1 },
          recorded: [],
          superseded: [],
        };
      },
    });
    const tool = createJuryAiToolDefinitions(service, {
      client_id_factory: () => 'first-turn-client-id',
    }).find((candidate) => candidate.name === 'submit_turn')!;

    const result = await tool.execute({
      ...VALID_SUBMIT_INPUT,
      expected_case_version: expectedCaseVersion,
    });

    expect(submitTurnInputSchema.properties.expected_case_version.minimum).toBe(0);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.expected_case_version).toBe(expectedCaseVersion);
    expect(result).toMatchObject({ kind: 'juryai_data', data: { ok: true } });
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['missing', undefined],
  ])('rejects %s expected_case_version before calling the service', async (_label, version) => {
    let called = false;
    const service = makeService({
      submitTurn: async () => {
        called = true;
        throw new Error('service must not be called');
      },
    });
    const tool = getTool(service, 'submit_turn');
    const result = await tool.execute({ ...VALID_SUBMIT_INPUT, expected_case_version: version });

    expect(called).toBe(false);
    expect(result).toMatchObject({
      kind: 'juryai_input_error',
      error: {
        code: 'INVALID_TOOL_INPUT',
        message: 'expected_case_version must be a non-negative integer',
        retryable: false,
      },
    });
  });

  it('forwards submit_turn AbortSignal and preserves structured version conflicts', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const conflict: VersionConflictResult = {
      ok: false,
      error: {
        code: 'VERSION_CONFLICT',
        message: 'Expected version 3 but current version is 4.',
        retryable: false,
      },
      current_case_version: 4,
      recent_turns: [RECENT_CONFLICT_TURN],
      likely_already_recorded: true,
      case: { ...CASE_STATE, case_version: 4 },
    };
    const service = makeService({
      submitTurn: async (_command, options) => {
        signals.push(options?.signal);
        return conflict;
      },
    });
    const controller = new AbortController();
    const tool = createJuryAiToolDefinitions(service, {
      client_id_factory: () => 'stable-turn-id',
    }).find((candidate) => candidate.name === 'submit_turn')!;
    const result = await tool.execute(VALID_SUBMIT_INPUT, { signal: controller.signal });

    expect(signals).toEqual([controller.signal]);
    expect(result).toEqual({
      kind: 'juryai_data',
      notice: expect.stringContaining('untrusted data'),
      data: conflict,
    });
  });

  it('excludes VERSION_CONFLICT from the generic typed service-error path', () => {
    expect(Object.keys(GENERIC_ERROR_CODES)).not.toContain('VERSION_CONFLICT');
  });

  it.each([
    ['user-role context', { ...VALID_SUBMIT_INPUT, context: [{ role: 'user', text: 'No.' }] }],
    [
      'oversized context',
      {
        ...VALID_SUBMIT_INPUT,
        context: Array.from({ length: MAX_CONTEXT_MESSAGES + 1 }, (_, index) => ({
          role: 'assistant',
          text: `Prompt ${index}`,
        })),
      },
    ],
    ['empty in_reply_to', { ...VALID_SUBMIT_INPUT, in_reply_to: [] }],
    ['empty answer', { ...VALID_SUBMIT_INPUT, answer: { text: '' } }],
    ['oversized answer', { ...VALID_SUBMIT_INPUT, answer: { text: 'x'.repeat(12_001) } }],
    ['malformed case ID', { ...VALID_SUBMIT_INPUT, case_id: 'case with spaces' }],
    ['external client_turn_id', { ...VALID_SUBMIT_INPUT, client_turn_id: 'external-id' }],
    ['principal identity', { ...VALID_SUBMIT_INPUT, principal_id: 'principal-1' }],
    [
      'string translation indication',
      {
        ...VALID_SUBMIT_INPUT,
        answer: { ...VALID_SUBMIT_INPUT.answer, translation_indicated: 'true' },
      },
    ],
    [
      'numeric translation indication',
      { ...VALID_SUBMIT_INPUT, answer: { ...VALID_SUBMIT_INPUT.answer, translation_indicated: 1 } },
    ],
  ])('rejects %s before calling the service', async (_label, input) => {
    let called = false;
    const service = makeService({
      submitTurn: async () => {
        called = true;
        throw new Error('service must not be called');
      },
    });
    const tool = getTool(service, 'submit_turn');
    const result = await tool.execute(input);

    expect(called).toBe(false);
    expect(result).toMatchObject({
      kind: 'juryai_input_error',
      error: { code: 'INVALID_TOOL_INPUT', retryable: false },
    });
  });

  it('supports get_case_state recovery without case_id and forwards the execution signal', async () => {
    const queries: GetCaseStateQuery[] = [];
    const signals: Array<AbortSignal | undefined> = [];
    const service = makeService({
      getCaseState: async (query: GetCaseStateQuery, options?: ServiceCallOptions) => {
        queries.push(query);
        signals.push(options?.signal);
        return { ok: true, case: CASE_STATE };
      },
    });
    const tool = getTool(service, 'get_case_state');
    const controller = new AbortController();

    await tool.execute({}, { signal: controller.signal });

    expect(queries).toEqual([{}]);
    expect(signals).toEqual([controller.signal]);
  });

  it('uses the canonical bounded case-state response without adding forbidden slots', async () => {
    const canonical: CaseStateResponse = CASE_STATE;
    const tool = getTool(makeService(), 'get_case_state');
    const result = await tool.execute({ case_id: 'case-1' });

    expect(Object.keys(canonical)).toEqual(PERMITTED_CASE_STATE_SLOTS);
    expect(assertNoForbiddenSlots(canonical as unknown as Record<string, unknown>)).toEqual([]);
    expect(canonical.next_requirements[0]?.prompt).toContain(AGENT_DATA_BLOCK_OPEN);
    expect(canonical.warnings[0]).toContain(AGENT_DATA_BLOCK_OPEN);
    expect(result).toMatchObject({
      kind: 'juryai_data',
      notice: expect.stringContaining('untrusted data'),
      data: { ok: true, case: canonical },
    });
  });

  it('fails closed on forbidden case fields in a generic get_case_state error', async () => {
    const service = makeService({
      getCaseState: async () => ({
        ok: false,
        error: { code: 'CASE_NOT_FOUND', message: 'Case unavailable.', retryable: false },
        case: MALFORMED_CASE,
      }),
    });

    expectMalformedCaseToFailClosed(await getTool(service, 'get_case_state').execute({}));
  });

  it('fails closed on forbidden case fields in submit_turn success', async () => {
    const service = makeService({
      submitTurn: async () => ({
        ok: true,
        turn_id: 'T-malformed',
        case: MALFORMED_CASE,
        recorded: [],
        superseded: [],
      }),
    });
    const tool = createJuryAiToolDefinitions(service, {
      client_id_factory: () => 'malformed-case-client-id',
    }).find((candidate) => candidate.name === 'submit_turn')!;

    expectMalformedCaseToFailClosed(await tool.execute(VALID_SUBMIT_INPUT));
  });

  it('fails closed on forbidden case fields in OPEN_DRAFT_EXISTS', async () => {
    const service = makeService({
      startCase: async () => ({
        ok: false,
        error: {
          code: 'OPEN_DRAFT_EXISTS',
          message: 'An active draft already exists.',
          retryable: false,
        },
        case: MALFORMED_CASE,
      }),
    });
    const tool = createJuryAiToolDefinitions(service, {
      client_id_factory: () => 'malformed-start-client-id',
    })[0]!;

    expectMalformedCaseToFailClosed(await tool.execute({}));
  });
});

describe('WebMCP registration', () => {
  it('registers exactly three tools under one abortable registration lifetime', async () => {
    const registrations: Array<{ name: string; signal?: AbortSignal }> = [];
    const modelContext: ModelContextLike = {
      registerTool: async (tool, options) => {
        registrations.push({ name: tool.name, signal: options?.signal });
      },
    };

    const registration = await registerJuryAiWebMcpTools(modelContext, makeService());

    expect(registrations.map((entry) => entry.name)).toEqual([
      'start_case',
      'get_case_state',
      'submit_turn',
    ]);
    expect(registrations[0]!.signal).toBe(registrations[1]!.signal);
    expect(registrations[1]!.signal).toBe(registrations[2]!.signal);
    expect(registrations[0]!.signal?.aborted).toBe(false);

    registration.unregister();
    expect(registrations[0]!.signal?.aborted).toBe(true);
  });
});
