import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  decodeCaseServiceHttpRequest,
  decodeCaseStateResponse,
} from '../webmcp/public-contract.js';
import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';
import { PUBLIC_CASE_STATE } from './webmcp-browser-test-fixtures.js';

describe('browser-safe JuryAI public contract', () => {
  it('runtime-decodes the full canonical case allowlist and rejects server internals', () => {
    expect(decodeCaseStateResponse(PUBLIC_CASE_STATE)).toEqual(PUBLIC_CASE_STATE);
    expect(() =>
      decodeCaseStateResponse({ ...PUBLIC_CASE_STATE, principal_id: 'supabase:secret' }),
    ).toThrow(/unknown field/u);
    expect(() =>
      decodeCaseStateResponse({
        ...PUBLIC_CASE_STATE,
        recent_interpretations: [
          { ...PUBLIC_CASE_STATE.recent_interpretations[0], type: 'payment' },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      decodeCaseStateResponse({
        ...PUBLIC_CASE_STATE,
        recent_interpretations: [
          { ...PUBLIC_CASE_STATE.recent_interpretations[0], epistemic_strength: 'certain' },
        ],
      }),
    ).toThrow(/epistemic/u);
  });

  it('allows only the three CaseServicePort operations and no identity fields', () => {
    expect(
      decodeCaseServiceHttpRequest({
        operation: 'getCaseState',
        input: {},
      }),
    ).toEqual({ operation: 'getCaseState', input: {} });
    expect(() => decodeCaseServiceHttpRequest({ operation: 'attestCase', input: {} })).toThrow(
      /not permitted/u,
    );
    expect(() =>
      decodeCaseServiceHttpRequest({
        operation: 'startCase',
        input: { client_request_id: 'request_1', principal_id: 'supabase:attacker' },
      }),
    ).toThrow(/unknown field/u);
  });

  it('builds the real browser graph without Node, Supabase, or server secrets', async () => {
    const result = await build({
      logLevel: 'silent',
      build: { write: false },
    });
    const results = Array.isArray(result) ? result : [result];
    const outputs = results.flatMap((entry) => ('output' in entry ? entry.output : []));
    const javascript = outputs
      .filter((entry) => entry.type === 'chunk')
      .map((entry) => ('code' in entry ? entry.code : ''))
      .join('\n');

    for (const forbidden of [
      'node:',
      '@supabase/supabase-js',
      'JURYAI_DATABASE_URL',
      'JURYAI_COMPILER_API_KEY',
      'JURYAI_SUPABASE_PUBLISHABLE_KEY',
      'service_role',
      'principal_id',
      'createHash',
      'randomBytes',
    ]) {
      expect(javascript).not.toContain(forbidden);
    }
    expect(javascript).toContain('start_case');
    expect(javascript).toContain('get_case_state');
    expect(javascript).toContain('submit_turn');
    const service = {
      startCase: async () => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: '', retryable: false },
      }),
      getCaseState: async () => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: '', retryable: false },
      }),
      submitTurn: async () => ({
        ok: false as const,
        error: { code: 'INTERNAL_ERROR' as const, message: '', retryable: false },
      }),
    };
    expect(createJuryAiToolDefinitions(service).map((tool) => tool.name)).toEqual([
      'start_case',
      'get_case_state',
      'submit_turn',
    ]);
  });
});
