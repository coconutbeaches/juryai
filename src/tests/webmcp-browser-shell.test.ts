import { describe, expect, it } from 'vitest';
import {
  BrowserShellController,
  decodeBootstrapResponse,
  type BrowserShellState,
  type BrowserShellView,
  wireBrowserShellHotLifecycle,
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

  it('binds the default browser fetch receiver before requesting signed-out bootstrap', async () => {
    const states: BrowserShellState[] = [];
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = function (this: unknown, input): Promise<Response> {
        if (this !== globalThis) throw new TypeError('Illegal invocation');
        expect(String(input)).toBe('/api/juryai/bootstrap');
        return Promise.resolve(Response.json({ authenticated: false }));
      } as typeof fetch;

      const controller = new BrowserShellController({
        view: view(states),
        getModelContext: () => undefined,
      });
      await controller.initialize();
    } finally {
      globalThis.fetch = originalFetch;
    }

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

  it('does not resurrect a torn-down page when logout settles after pagehide', async () => {
    const logoutResponse = deferred<Response>();
    const logoutStarted = deferred<void>();
    let logoutSignal: AbortSignal | undefined;
    let bootstraps = 0;
    let services = 0;
    let registrations = 0;
    let unregisters = 0;
    const controller = new BrowserShellController({
      view: view([]),
      fetchImpl: async (input, init) => {
        if (String(input) === '/api/juryai/bootstrap') {
          bootstraps += 1;
          return Response.json(ACCEPTED);
        }
        expect(String(input)).toBe('/api/juryai/auth/logout');
        logoutSignal = init?.signal ?? undefined;
        logoutStarted.resolve();
        return logoutResponse.promise;
      },
      getModelContext: () => ({ registerTool: () => undefined }),
      createCaseService: () => {
        services += 1;
        return service();
      },
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
    const pendingLogout = controller.logout();
    await logoutStarted.promise;
    controller.teardown();
    expect(logoutSignal?.aborted).toBe(true);
    logoutResponse.reject(new DOMException('Page hidden', 'AbortError'));
    await pendingLogout;

    expect({ bootstraps, services, registrations, unregisters }).toEqual({
      bootstraps: 1,
      services: 1,
      registrations: 1,
      unregisters: 1,
    });

    await controller.pageShow(true);
    expect({ bootstraps, services, registrations, unregisters }).toEqual({
      bootstraps: 2,
      services: 2,
      registrations: 2,
      unregisters: 1,
    });
  });

  it('reinitializes exactly once after successful logout on an active page', async () => {
    let bootstraps = 0;
    let services = 0;
    let registrations = 0;
    let unregisters = 0;
    const controller = new BrowserShellController({
      view: view([]),
      fetchImpl: async (input) => {
        if (String(input) === '/api/juryai/bootstrap') {
          bootstraps += 1;
          return Response.json(ACCEPTED);
        }
        expect(String(input)).toBe('/api/juryai/auth/logout');
        return Response.json({});
      },
      getModelContext: () => ({ registerTool: () => undefined }),
      createCaseService: () => {
        services += 1;
        return service();
      },
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
    await controller.logout();

    expect({ bootstraps, services, registrations, unregisters }).toEqual({
      bootstraps: 2,
      services: 2,
      registrations: 2,
      unregisters: 1,
    });
  });

  it('reinitializes exactly once after failed logout on an active page', async () => {
    let bootstraps = 0;
    let services = 0;
    let registrations = 0;
    let unregisters = 0;
    const controller = new BrowserShellController({
      view: view([]),
      fetchImpl: async (input) => {
        if (String(input) === '/api/juryai/bootstrap') {
          bootstraps += 1;
          return Response.json(ACCEPTED);
        }
        expect(String(input)).toBe('/api/juryai/auth/logout');
        throw new TypeError('Network unavailable');
      },
      getModelContext: () => ({ registerTool: () => undefined }),
      createCaseService: () => {
        services += 1;
        return service();
      },
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
    await controller.logout();

    expect({ bootstraps, services, registrations, unregisters }).toEqual({
      bootstraps: 2,
      services: 2,
      registrations: 2,
      unregisters: 1,
    });
  });

  it('disposes only the old controller during a self-accepted HMR cycle', async () => {
    let activeRegistrations = 0;
    let oldBootstraps = 0;
    let newBootstraps = 0;
    let oldTeardowns = 0;
    let oldUnregisters = 0;
    let oldAcceptCallback: (() => void) | undefined;
    let oldDispose: (() => void) | undefined;
    let survivingToolNames: readonly string[] = [];
    const registration = (isOld: boolean) => async () => {
      activeRegistrations += 1;
      const toolNames = ['start_case', 'get_case_state', 'submit_turn'] as const;
      if (!isOld) survivingToolNames = toolNames;
      return {
        tool_names: toolNames,
        unregister: () => {
          activeRegistrations -= 1;
          if (isOld) oldUnregisters += 1;
        },
      };
    };
    const oldController = new BrowserShellController({
      view: view([]),
      fetchImpl: async () => {
        oldBootstraps += 1;
        return Response.json(ACCEPTED);
      },
      getModelContext: () => ({ registerTool: () => undefined }),
      createCaseService: () => service(),
      registerTools: registration(true),
    });

    wireBrowserShellHotLifecycle(
      {
        accept: (callback?: () => void) => {
          oldAcceptCallback = callback;
        },
        dispose: (callback) => {
          oldDispose = callback;
        },
      },
      {
        teardown: () => {
          oldTeardowns += 1;
          oldController.teardown();
        },
      },
    );
    await oldController.initialize();
    expect(activeRegistrations).toBe(1);

    oldDispose?.();
    expect(oldTeardowns).toBe(1);
    expect(oldUnregisters).toBe(1);
    expect(activeRegistrations).toBe(0);

    const newController = new BrowserShellController({
      view: view([]),
      fetchImpl: async () => {
        newBootstraps += 1;
        return Response.json(ACCEPTED);
      },
      getModelContext: () => ({ registerTool: () => undefined }),
      createCaseService: () => service(),
      registerTools: registration(false),
    });
    await newController.initialize();
    oldAcceptCallback?.();

    expect(oldAcceptCallback).toBeUndefined();
    expect(oldBootstraps).toBe(1);
    expect(newBootstraps).toBe(1);
    expect(activeRegistrations).toBe(1);
    expect(survivingToolNames).toEqual(['start_case', 'get_case_state', 'submit_turn']);
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
