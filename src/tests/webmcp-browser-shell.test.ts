import { describe, expect, it } from 'vitest';
import {
  BrowserShellController,
  decodeBootstrapResponse,
  type BrowserShellState,
  type BrowserShellView,
} from '../webmcp/browser/shell-controller.js';
import type { CaseServicePort } from '../webmcp/public-contract.js';
import { PUBLIC_CASE_STATE } from './webmcp-browser-test-fixtures.js';

function bootstrap(body: unknown): typeof fetch {
  return async (input) => {
    expect(String(input)).toBe('/api/juryai/bootstrap');
    return Response.json(body);
  };
}

function view(states: BrowserShellState[]): BrowserShellView {
  return { render: (state) => states.push(state) };
}

function service(onGet?: () => void): CaseServicePort {
  return {
    startCase: async () => ({ ok: true, case: PUBLIC_CASE_STATE }),
    getCaseState: async (query) => {
      onGet?.();
      expect(query).toEqual({});
      return { ok: true, case: PUBLIC_CASE_STATE };
    },
    submitTurn: async () => ({
      ok: true,
      turn_id: 'turn_1',
      case: PUBLIC_CASE_STATE,
      recorded: [],
      superseded: [],
    }),
  };
}

const ACCEPTED = {
  authenticated: true,
  disclosure: { required: false, version: 'server-owned-version' },
};

describe('frameworkless browser shell lifecycle', () => {
  it('runtime-decodes minimal bootstrap identity and rejects principal leakage', () => {
    expect(decodeBootstrapResponse({ authenticated: false })).toEqual({ authenticated: false });
    expect(() =>
      decodeBootstrapResponse({ authenticated: false, principal_id: 'supabase:secret' }),
    ).toThrow(/unknown field/u);
  });

  it('does not create a case port or register tools before authentication', async () => {
    const states: BrowserShellState[] = [];
    const controller = new BrowserShellController({
      view: view(states),
      fetchImpl: bootstrap({ authenticated: false }),
      getModelContext: () => ({ registerTool: () => undefined }),
      createCaseService: () => {
        throw new Error('case service must not exist');
      },
    });
    await controller.initialize();
    expect(states.at(-1)).toEqual({ phase: 'signed_out' });
  });

  it('does not create a case port or register tools before disclosure acceptance', async () => {
    const states: BrowserShellState[] = [];
    const controller = new BrowserShellController({
      view: view(states),
      fetchImpl: bootstrap({
        authenticated: true,
        disclosure: { required: true, version: 'server-owned-version', copy: 'Disclosure copy.' },
      }),
      getModelContext: () => ({ registerTool: () => undefined }),
      createCaseService: () => {
        throw new Error('case service must not exist');
      },
    });
    await controller.initialize();
    expect(states.at(-1)).toEqual({ phase: 'disclosure', copy: 'Disclosure copy.' });
  });

  it('discovers the active draft independently and stays useful without document.modelContext', async () => {
    const states: BrowserShellState[] = [];
    let discovered = 0;
    const controller = new BrowserShellController({
      view: view(states),
      fetchImpl: bootstrap(ACCEPTED),
      getModelContext: () => undefined,
      createCaseService: () => service(() => (discovered += 1)),
    });
    await controller.initialize();
    expect(discovered).toBe(1);
    expect(states.at(-1)).toEqual({
      phase: 'ready',
      webMcp: 'unavailable',
      activeDraftReviewUrl: PUBLIC_CASE_STATE.review_url,
      message: undefined,
    });
  });

  it('reuses the existing helper to register exactly the three frozen tools once', async () => {
    const events: string[] = [];
    const names: string[] = [];
    const controller = new BrowserShellController({
      view: view([]),
      fetchImpl: bootstrap(ACCEPTED),
      getModelContext: () => ({
        registerTool: (tool) => {
          events.push('register');
          names.push(tool.name);
        },
      }),
      createCaseService: () => service(() => events.push('discover')),
    });
    await controller.initialize();
    expect(events[0]).toBe('discover');
    expect(names).toEqual(['start_case', 'get_case_state', 'submit_turn']);
  });

  it('unregisters and aborts on teardown and session invalidation', async () => {
    const states: BrowserShellState[] = [];
    let unregisters = 0;
    let invalidate: (() => void) | undefined;
    const controller = new BrowserShellController({
      view: view(states),
      fetchImpl: bootstrap(ACCEPTED),
      getModelContext: () => ({ registerTool: () => undefined }),
      createCaseService: (options) => {
        invalidate = options.onUnauthorized;
        return service();
      },
      registerTools: async () => ({
        tool_names: ['start_case', 'get_case_state', 'submit_turn'],
        unregister: () => {
          unregisters += 1;
        },
      }),
    });
    await controller.initialize();
    invalidate?.();
    expect(unregisters).toBe(1);
    expect(states.at(-1)).toMatchObject({ phase: 'signed_out' });

    await controller.initialize();
    controller.teardown();
    expect(unregisters).toBe(2);
  });

  it('aborts outstanding auth requests during page teardown', async () => {
    const observedSignals: AbortSignal[] = [];
    const controller = new BrowserShellController({
      view: view([]),
      fetchImpl: async (_input, init) => {
        if (init?.signal) observedSignals.push(init.signal);
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Page hidden', 'AbortError')),
            { once: true },
          );
        });
      },
      getModelContext: () => undefined,
    });
    const pending = controller.requestOtp('invited@example.com');
    await Promise.resolve();
    controller.teardown();
    await pending;
    expect(observedSignals[0]?.aborted).toBe(true);
  });

  it('creates a fresh registration after BFCache restoration and hot reinitialization', async () => {
    let registrations = 0;
    let unregisters = 0;
    const controller = new BrowserShellController({
      view: view([]),
      fetchImpl: bootstrap(ACCEPTED),
      getModelContext: () => ({ registerTool: () => undefined }),
      createCaseService: () => service(),
      registerTools: async () => {
        registrations += 1;
        return {
          tool_names: ['start_case', 'get_case_state', 'submit_turn'],
          unregister: () => {
            unregisters += 1;
          },
        };
      },
    });

    await controller.initialize();
    await controller.pageShow(true);
    await controller.initialize();
    expect(registrations).toBe(3);
    expect(unregisters).toBe(2);
  });
});
