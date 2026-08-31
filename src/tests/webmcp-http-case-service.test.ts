import { describe, expect, it } from 'vitest';
import { createHttpCaseService } from '../webmcp/browser/http-case-service.js';
import type { SubmitTurnCommand } from '../webmcp/public-contract.js';
import { PUBLIC_CASE_STATE } from './webmcp-browser-test-fixtures.js';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function oneResponse(body: unknown, captures: RequestInit[] = []) {
  return async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    captures.push(init ?? {});
    return json(body);
  };
}

const SUBMIT: SubmitTurnCommand = {
  case_id: PUBLIC_CASE_STATE.case_id,
  expected_case_version: PUBLIC_CASE_STATE.case_version,
  in_reply_to: ['req_expected_date'],
  payload: { context: [], answer: { role: 'user', text: 'I expected April 25.' } },
  source_language: 'th',
  translation_indicated: true,
  client_turn_id: 'client_turn_1',
};

describe('browser HTTP CaseServicePort', () => {
  it('preserves start success and OPEN_DRAFT_EXISTS results', async () => {
    const created = createHttpCaseService({
      fetchImpl: oneResponse({ ok: true, case: PUBLIC_CASE_STATE }),
      expectedOrigin: 'https://juryai.test',
    });
    await expect(created.startCase({ client_request_id: 'request_1' })).resolves.toEqual({
      ok: true,
      case: PUBLIC_CASE_STATE,
    });

    const existing = createHttpCaseService({
      fetchImpl: oneResponse({
        ok: false,
        error: {
          code: 'OPEN_DRAFT_EXISTS',
          message: 'An active draft already exists.',
          retryable: false,
        },
        case: PUBLIC_CASE_STATE,
      }),
      expectedOrigin: 'https://juryai.test',
    });
    await expect(existing.startCase({ client_request_id: 'request_2' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'OPEN_DRAFT_EXISTS' },
      case: PUBLIC_CASE_STATE,
    });
  });

  it('discovers a case without a remembered case id and sends same-origin credentials', async () => {
    const captures: RequestInit[] = [];
    const service = createHttpCaseService({
      fetchImpl: oneResponse({ ok: true, case: PUBLIC_CASE_STATE }, captures),
      expectedOrigin: 'https://juryai.test',
    });
    await expect(service.getCaseState({})).resolves.toEqual({ ok: true, case: PUBLIC_CASE_STATE });
    expect(captures[0]).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(String(captures[0]!.body))).toEqual({
      operation: 'getCaseState',
      input: {},
    });
  });

  it('preserves committed and replayed submit results plus translation provenance', async () => {
    const captures: RequestInit[] = [];
    const committedBody = {
      ok: true,
      turn_id: 'turn_1',
      case: { ...PUBLIC_CASE_STATE, case_version: 4 },
      recorded: PUBLIC_CASE_STATE.recent_interpretations,
      superseded: [],
    };
    const committed = createHttpCaseService({
      fetchImpl: oneResponse(committedBody, captures),
      expectedOrigin: 'https://juryai.test',
    });
    await expect(committed.submitTurn(SUBMIT)).resolves.toEqual(committedBody);
    expect(JSON.parse(String(captures[0]!.body)).input).toMatchObject({
      source_language: 'th',
      translation_indicated: true,
      client_turn_id: 'client_turn_1',
    });

    const replayedBody = { ...committedBody, replayed: true };
    const replayed = createHttpCaseService({
      fetchImpl: oneResponse(replayedBody),
      expectedOrigin: 'https://juryai.test',
    });
    await expect(replayed.submitTurn(SUBMIT)).resolves.toEqual(replayedBody);
  });

  it('preserves VERSION_CONFLICT recovery fields', async () => {
    const conflict = {
      ok: false,
      error: {
        code: 'VERSION_CONFLICT',
        message: 'The case changed before this turn could be recorded.',
        retryable: false,
      },
      current_case_version: 4,
      recent_turns: [
        {
          turn_id: 'turn_1',
          in_reply_to: ['req_expected_date'],
          answer_excerpt: 'I expected April 25.',
          request_fingerprint: 'a'.repeat(64),
          client_turn_id: 'client_turn_1',
          received_at: '2026-08-31T06:00:00.000Z',
        },
      ],
      likely_already_recorded: true,
      case: { ...PUBLIC_CASE_STATE, case_version: 4 },
    };
    const service = createHttpCaseService({
      fetchImpl: oneResponse(conflict),
      expectedOrigin: 'https://juryai.test',
    });
    await expect(service.submitTurn(SUBMIT)).resolves.toEqual(conflict);
  });

  it('never infers translation from source_language alone', async () => {
    const captures: RequestInit[] = [];
    const service = createHttpCaseService({
      fetchImpl: oneResponse(
        {
          ok: true,
          turn_id: 'turn_2',
          case: { ...PUBLIC_CASE_STATE, case_version: 4 },
          recorded: [],
          superseded: [],
        },
        captures,
      ),
      expectedOrigin: 'https://juryai.test',
    });
    const command = { ...SUBMIT, source_language: 'th' };
    delete command.translation_indicated;
    await service.submitTurn(command);
    const sent = JSON.parse(String(captures[0]!.body)) as { input: Record<string, unknown> };
    expect(sent.input.source_language).toBe('th');
    expect(sent.input).not.toHaveProperty('translation_indicated');
  });

  it('forwards and composes AbortSignals without adding retries', async () => {
    let calls = 0;
    const lifetime = new AbortController();
    const call = new AbortController();
    const service = createHttpCaseService({
      expectedOrigin: 'https://juryai.test',
      lifetimeSignal: lifetime.signal,
      fetchImpl: async (_input, init) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      },
    });
    const pending = service.getCaseState({}, { signal: call.signal });
    lifetime.abort(new DOMException('Page hidden', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1);
  });

  it('rejects foreign review URLs and arbitrary response objects', async () => {
    const foreign = createHttpCaseService({
      fetchImpl: oneResponse({
        ok: true,
        case: { ...PUBLIC_CASE_STATE, review_url: 'https://attacker.test/review' },
      }),
      expectedOrigin: 'https://juryai.test',
    });
    await expect(foreign.getCaseState({})).rejects.toThrow(/foreign-origin/u);

    const leaked = createHttpCaseService({
      fetchImpl: oneResponse({
        ok: true,
        case: { ...PUBLIC_CASE_STATE, database_revision: 7 },
      }),
      expectedOrigin: 'https://juryai.test',
    });
    await expect(leaked.getCaseState({})).rejects.toThrow(/unknown field/u);
  });
});
