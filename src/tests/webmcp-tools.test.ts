import { describe, expect, it, vi } from 'vitest';
import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';
import type {
  CaseServicePort,
  CaseStateSummary,
  GetCaseStateQuery,
  ServiceCallOptions,
  StartCaseCommand,
  SubmitTurnCommand,
} from '../webmcp/tools/ports.js';
import { registerJuryAiWebMcpTools, type ModelContextLike } from '../webmcp/tools/register.js';

const CASE_STATE: CaseStateSummary = {
  case_id: 'case-1',
  case_version: 3,
  protocol_version: 'P2-V0.2',
  status: 'draft',
  unresolved_requirement_count: 1,
  next_requirements: [
    {
      id: 'R24',
      kind: 'question',
      topic: 'deadline',
      prompt: 'What did you agree about the completion date?',
      response_slot_id: 'RS24',
    },
  ],
  open_clarifications: [],
  recent_interpretations: [],
  evidence: [],
  review_url: '/case/case-1/review',
};

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
  });

  it('keeps start_case retry identity stable across transport retries', async () => {
    const ids: string[] = [];
    let attempts = 0;
    const service = makeService({
      startCase: async (command: StartCaseCommand) => {
        attempts += 1;
        ids.push(command.client_request_id);
        if (attempts === 1) throw new Error('temporary transport failure');
        return { ok: true, case: CASE_STATE };
      },
    });

    const [tool] = createJuryAiToolDefinitions(service, {
      client_id_factory: () => 'stable-request-id',
      write_retry_attempts: 2,
    });
    const result = await tool!.execute({});

    expect(ids).toEqual(['stable-request-id', 'stable-request-id']);
    expect(result).toMatchObject({ kind: 'juryai_data', data: { ok: true } });
  });

  it('passes response slot, explicit answer, context, case version, and stable client_turn_id to submit_turn', async () => {
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

    const tool = createJuryAiToolDefinitions(service, {
      client_id_factory: () => 'stable-turn-id',
      write_retry_attempts: 2,
    }).find((candidate) => candidate.name === 'submit_turn')!;

    const result = await tool.execute({
      case_id: 'case-1',
      expected_case_version: 3,
      in_reply_to: ['R24'],
      response_slot_id: 'RS24',
      context: [{ role: 'assistant', text: 'Was April 25 an agreed deadline?' }],
      answer: { text: 'No, that was basically what I expected.', source_language: 'en' },
    });

    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual(commands[1]);
    expect(commands[0]).toEqual({
      case_id: 'case-1',
      expected_case_version: 3,
      in_reply_to: ['R24'],
      response_slot_id: 'RS24',
      context: [{ role: 'assistant', text: 'Was April 25 an agreed deadline?' }],
      answer: { text: 'No, that was basically what I expected.', source_language: 'en' },
      client_turn_id: 'stable-turn-id',
    });
    expect(result).toMatchObject({ kind: 'juryai_data', data: { ok: true, replayed: true } });
  });

  it('rejects malformed submit_turn input before calling the service', async () => {
    const submitTurn = vi.fn<CaseServicePort['submitTurn']>();
    const service = makeService({ submitTurn });
    const tool = getTool(service, 'submit_turn');

    const result = await tool.execute({
      case_id: 'case-1',
      expected_case_version: 3,
      in_reply_to: ['R24'],
      response_slot_id: 'RS24',
      context: [],
      answer: { text: '' },
    });

    expect(submitTurn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: 'juryai_input_error',
      error: { code: 'INVALID_TOOL_INPUT', retryable: false },
    });
  });

  it('supports get_case_state recovery without a case_id and forwards the execution signal', async () => {
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

  it('wraps returned case content as explicitly untrusted data', async () => {
    const tool = getTool(makeService(), 'get_case_state');
    const result = await tool.execute({ case_id: 'case-1' });

    expect(result).toMatchObject({
      kind: 'juryai_data',
      notice: expect.stringContaining('untrusted data'),
      data: { ok: true, case: { case_id: 'case-1' } },
    });
  });
});

describe('WebMCP registration', () => {
  it('registers all tools under one abortable registration lifetime', async () => {
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
