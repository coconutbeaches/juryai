import { describe, expect, it } from 'vitest';
import type { CaseRuntime, RuntimeRequestContext } from '../webmcp/runtime/index.js';
import {
  JURYAI_P2_DISCLOSURE_COPY,
  JURYAI_P2_DISCLOSURE_VERSION,
  JuryAiWebServer,
  authenticateWebSession,
  createSupabaseAuthGateway,
  hashSessionToken,
  loadJuryAiWebServerConfig,
  type JuryAiWebServerConfig,
  type SupabaseAuthClientLike,
  type SupabaseAuthGateway,
  type WebSessionPersistence,
  type WebSessionRecord,
} from '../webmcp/server/index.js';
import { PUBLIC_CASE_STATE } from './webmcp-browser-test-fixtures.js';

const NOW = new Date('2026-08-31T06:00:00.000Z');
const SUBJECT = '11111111-1111-4111-8111-111111111111';
const RAW_TOKEN = 'A'.repeat(43);

const CONFIG: JuryAiWebServerConfig = {
  publicOrigin: 'https://juryai.test',
  databaseUrl: 'postgresql://unused',
  supabaseUrl: 'https://project.supabase.co',
  supabasePublishableKey: 'publishable-key-not-for-browser',
  production: true,
  cookie: { name: '__Host-juryai_session', secure: true },
};

class FakeWebStore implements WebSessionPersistence {
  readonly sessions = new Map<string, WebSessionRecord>();
  readonly accepted = new Set<string>();
  createCalls = 0;
  acceptanceInsertAttempts = 0;

  async createSession(record: WebSessionRecord): Promise<void> {
    this.createCalls += 1;
    this.sessions.set(record.session_id_hash, structuredClone(record));
  }

  async findActiveSession(hash: string, now: Date): Promise<WebSessionRecord | null> {
    const session = this.sessions.get(hash);
    if (!session || session.revoked_at !== null || session.expires_at <= now) return null;
    return structuredClone(session);
  }

  async revokeSession(hash: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(hash);
    if (session && session.revoked_at === null) session.revoked_at = new Date(revokedAt);
  }

  async hasDisclosureAcceptance(principal: string, version: string): Promise<boolean> {
    return this.accepted.has(`${principal}\u0000${version}`);
  }

  async acceptDisclosure(principal: string, version: string): Promise<void> {
    this.acceptanceInsertAttempts += 1;
    this.accepted.add(`${principal}\u0000${version}`);
  }
}

function auth(subject: string | null = SUBJECT): SupabaseAuthGateway {
  return {
    requestEmailOtp: async () => undefined,
    verifyEmailOtp: async () => subject,
  };
}

function runtime(captured: RuntimeRequestContext[] = []) {
  return {
    startCase: async (context: RuntimeRequestContext) => {
      captured.push(context);
      return { kind: 'created' as const, replayed: false, case: PUBLIC_CASE_STATE };
    },
    getCaseState: async (context: RuntimeRequestContext) => {
      captured.push(context);
      return { kind: 'ok' as const, case: PUBLIC_CASE_STATE };
    },
    submitTurn: async (context: RuntimeRequestContext) => {
      captured.push(context);
      return {
        kind: 'committed' as const,
        turn_id: 'turn_1',
        case: PUBLIC_CASE_STATE,
        recorded: [],
        superseded_proposition_ids: [],
      };
    },
  } as unknown as Pick<CaseRuntime, 'startCase' | 'getCaseState' | 'submitTurn'>;
}

function server(
  store: FakeWebStore,
  overrides: {
    gateway?: SupabaseAuthGateway;
    captured?: RuntimeRequestContext[];
  } = {},
): JuryAiWebServer {
  return new JuryAiWebServer({
    config: CONFIG,
    persistence: store,
    authForRequest: () => overrides.gateway ?? auth(),
    runtime: () => runtime(overrides.captured),
    now: () => NOW,
    sessionTokenFactory: () => RAW_TOKEN,
  });
}

function post(path: string, body: unknown, cookie?: string, origin = CONFIG.publicOrigin): Request {
  const headers = new Headers({
    Origin: origin,
    'Content-Type': 'application/json',
  });
  if (cookie) headers.set('Cookie', cookie);
  return new Request(`${CONFIG.publicOrigin}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function get(path: string, cookie?: string): Request {
  const headers = new Headers();
  if (cookie) headers.set('Cookie', cookie);
  return new Request(`${CONFIG.publicOrigin}${path}`, { headers });
}

function rawCookie(response: Response): string {
  return response.headers.get('Set-Cookie')!.split(';', 1)[0]!;
}

async function signIn(instance: JuryAiWebServer): Promise<{ response: Response; cookie: string }> {
  const response = await instance.verifyOtp(
    post('/api/juryai/auth/verify-otp', { email: 'invited@example.com', otp: '123456' }),
  );
  return { response, cookie: rawCookie(response) };
}

describe('Supabase identity proof boundary', () => {
  it('requests invite-only OTP with shouldCreateUser:false and verifies a six-digit email token', async () => {
    const calls: unknown[] = [];
    const client: SupabaseAuthClientLike = {
      auth: {
        signInWithOtp: async (input) => {
          calls.push(input);
          return { error: null };
        },
        verifyOtp: async (input) => {
          calls.push(input);
          return {
            data: {
              user: { id: SUBJECT },
              session: { access_token: 'supabase-access', refresh_token: 'supabase-refresh' },
            },
            error: null,
          };
        },
      },
    };
    const gateway = createSupabaseAuthGateway(client);
    await gateway.requestEmailOtp('invited@example.com');
    await expect(gateway.verifyEmailOtp('invited@example.com', '123456')).resolves.toBe(SUBJECT);
    expect(calls).toEqual([
      {
        email: 'invited@example.com',
        options: { shouldCreateUser: false },
      },
      { email: 'invited@example.com', token: '123456', type: 'email' },
    ]);
  });

  it('returns one generic OTP-request response and safely rejects malformed email', async () => {
    const store = new FakeWebStore();
    let requests = 0;
    const instance = server(store, {
      gateway: {
        requestEmailOtp: async () => {
          requests += 1;
          throw new Error('provider intentionally hidden');
        },
        verifyEmailOtp: async () => null,
      },
    });
    const generic = await instance.requestOtp(
      post('/api/juryai/auth/request-otp', { email: 'unknown@example.com' }),
    );
    expect(generic.status).toBe(202);
    expect(await generic.json()).toEqual({ ok: true });
    expect(requests).toBe(1);

    const malformed = await instance.requestOtp(
      post('/api/juryai/auth/request-otp', { email: 'not-an-email' }),
    );
    expect(malformed.status).toBe(400);
    expect(requests).toBe(1);
  });
});

describe('opaque JuryAI session boundary', () => {
  it('creates only a hashed seven-day session and never returns Supabase material', async () => {
    const store = new FakeWebStore();
    const { response, cookie } = await signIn(server(store));
    expect(response.status).toBe(200);
    expect(await response.clone().json()).toEqual({ ok: true });
    const serialized = await response.text();
    expect(serialized).not.toMatch(/access|refresh|supabase|principal|subject/iu);

    expect(cookie).toBe(`__Host-juryai_session=${RAW_TOKEN}`);
    expect(store.createCalls).toBe(1);
    const stored = [...store.sessions.values()][0]!;
    expect(stored.session_id_hash).toBe(hashSessionToken(RAW_TOKEN));
    expect(stored.session_id_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain(RAW_TOKEN);
    expect(stored.expires_at.getTime() - stored.created_at.getTime()).toBe(
      7 * 24 * 60 * 60 * 1_000,
    );

    const setCookie = response.headers.get('Set-Cookie')!;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Domain=');
  });

  it('creates no session for an invalid OTP', async () => {
    const store = new FakeWebStore();
    const response = await server(store, { gateway: auth(null) }).verifyOtp(
      post('/api/juryai/auth/verify-otp', { email: 'invited@example.com', otp: '000000' }),
    );
    expect(response.status).toBe(401);
    expect(store.createCalls).toBe(0);
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('rejects expired and revoked sessions and does not slide expiry', async () => {
    const store = new FakeWebStore();
    const instance = server(store);
    const { cookie } = await signIn(instance);
    const stored = [...store.sessions.values()][0]!;
    const originalExpiry = stored.expires_at.getTime();

    stored.expires_at = new Date(NOW.getTime() - 1);
    expect(await (await instance.bootstrap(get('/api/juryai/bootstrap', cookie))).json()).toEqual({
      authenticated: false,
    });

    stored.expires_at = new Date(originalExpiry);
    stored.revoked_at = new Date(NOW);
    expect(await (await instance.bootstrap(get('/api/juryai/bootstrap', cookie))).json()).toEqual({
      authenticated: false,
    });
    expect(stored.expires_at.getTime()).toBe(originalExpiry);
  });

  it('revokes and expires logout idempotently', async () => {
    const store = new FakeWebStore();
    const instance = server(store);
    const { cookie } = await signIn(instance);
    const first = await instance.logout(post('/api/juryai/auth/logout', {}, cookie));
    expect(first.status).toBe(200);
    expect(first.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect([...store.sessions.values()][0]!.revoked_at).toEqual(NOW);

    const second = await instance.logout(post('/api/juryai/auth/logout', {}, cookie));
    expect(second.status).toBe(200);
    expect([...store.sessions.values()][0]!.revoked_at).toEqual(NOW);
  });

  it('uses a visibly separate localhost-only insecure cookie and fails closed in production', () => {
    const base = {
      JURYAI_PERSISTENCE_ADAPTER: 'postgres',
      JURYAI_DATABASE_URL: 'postgresql://test',
      JURYAI_SUPABASE_URL: 'https://project.supabase.co',
      JURYAI_SUPABASE_PUBLISHABLE_KEY: 'publishable',
    };
    expect(
      loadJuryAiWebServerConfig({
        ...base,
        NODE_ENV: 'development',
        JURYAI_PUBLIC_ORIGIN: 'http://localhost:5173',
      }).cookie,
    ).toEqual({ name: 'juryai_session_dev', secure: false });
    expect(() =>
      loadJuryAiWebServerConfig({
        ...base,
        NODE_ENV: 'production',
        JURYAI_PUBLIC_ORIGIN: 'http://localhost:5173',
      }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      loadJuryAiWebServerConfig({
        ...base,
        NODE_ENV: 'development',
        JURYAI_PUBLIC_ORIGIN: 'http://juryai.test',
      }),
    ).toThrow(/loopback/u);
  });
});

describe('disclosure, principal, and same-origin gates', () => {
  it('serves the frozen server-owned disclosure and records duplicate acceptance idempotently', async () => {
    const store = new FakeWebStore();
    const instance = server(store);
    const { cookie } = await signIn(instance);
    const before = await instance.bootstrap(get('/api/juryai/bootstrap', cookie));
    expect(await before.json()).toEqual({
      authenticated: true,
      disclosure: {
        required: true,
        version: JURYAI_P2_DISCLOSURE_VERSION,
        copy: JURYAI_P2_DISCLOSURE_COPY,
      },
    });

    const suppliedVersion = await instance.acceptDisclosure(
      post('/api/juryai/disclosure', { version: 'attacker-version' }, cookie),
    );
    expect(suppliedVersion.status).toBe(400);

    expect(
      (await instance.acceptDisclosure(post('/api/juryai/disclosure', {}, cookie))).status,
    ).toBe(200);
    expect(
      (await instance.acceptDisclosure(post('/api/juryai/disclosure', {}, cookie))).status,
    ).toBe(200);
    expect(store.accepted.size).toBe(1);
    expect(store.acceptanceInsertAttempts).toBe(2);
  });

  it('fails case service closed before disclosure and derives the exact principal from session storage', async () => {
    const store = new FakeWebStore();
    const captured: RuntimeRequestContext[] = [];
    const instance = server(store, { captured });
    const { cookie } = await signIn(instance);

    const gated = await instance.caseService(
      post(
        '/api/juryai/case-service',
        { operation: 'startCase', input: { client_request_id: 'request_1' } },
        cookie,
      ),
    );
    expect(gated.status).toBe(403);
    expect(captured).toHaveLength(0);

    await instance.acceptDisclosure(post('/api/juryai/disclosure', {}, cookie));
    const injected = await instance.caseService(
      post(
        '/api/juryai/case-service',
        {
          operation: 'startCase',
          input: { client_request_id: 'request_1', principal_id: 'supabase:attacker' },
        },
        cookie,
      ),
    );
    expect(injected.status).toBe(400);

    const valid = await instance.caseService(
      post(
        '/api/juryai/case-service',
        { operation: 'startCase', input: { client_request_id: 'request_1' } },
        cookie,
      ),
    );
    expect(valid.status).toBe(200);
    expect(captured).toEqual([
      {
        principal: { principal_id: `supabase:${SUBJECT}` },
        source_channel: 'webmcp_agent_relay',
        relaying_agent: null,
      },
    ]);
    expect(await valid.json()).not.toHaveProperty('principal_id');
  });

  it('rejects foreign Origin on every POST and emits private no-store without CORS wildcard', async () => {
    const store = new FakeWebStore();
    const instance = server(store);
    for (const [operation, request] of [
      ['request otp', instance.requestOtp.bind(instance)],
      ['verify otp', instance.verifyOtp.bind(instance)],
      ['logout', instance.logout.bind(instance)],
      ['disclosure', instance.acceptDisclosure.bind(instance)],
      ['case service', instance.caseService.bind(instance)],
    ] as const) {
      const response = await request(
        post('/api/juryai/test', {}, undefined, 'https://foreign.test'),
      );
      expect(response.status, operation).toBe(403);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(response.headers.get('Content-Security-Policy')).not.toContain('unsafe-eval');
    }
  });

  it('authenticates only an unexpired, unrevoked hashed cookie lookup', async () => {
    const store = new FakeWebStore();
    await signIn(server(store));
    const session = await authenticateWebSession(
      store,
      `__Host-juryai_session=${RAW_TOKEN}`,
      CONFIG.cookie,
      NOW,
    );
    expect(session?.principal_id).toBe(`supabase:${SUBJECT}`);
    expect(
      await authenticateWebSession(
        store,
        `__Host-juryai_session=${RAW_TOKEN}; __Host-juryai_session=${RAW_TOKEN}`,
        CONFIG.cookie,
        NOW,
      ),
    ).toBeNull();
  });
});
