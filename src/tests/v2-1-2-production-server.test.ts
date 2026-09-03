import { describe, expect, it } from 'vitest';
import type { ProductionFirstPartyServiceV212 } from '../v2-1-2/production-first-party.js';
import type { JuryAiWebServerConfig } from '../webmcp/server/config.js';
import { JURYAI_P2_DISCLOSURE_VERSION } from '../webmcp/server/disclosure.js';
import { JuryAiWebServer } from '../webmcp/server/server.js';
import { hashSessionToken } from '../webmcp/server/session.js';
import type {
  WebSessionPersistence,
  WebSessionRecord,
} from '../webmcp/server/web-session-store.js';

const ORIGIN = 'https://juryai.test';
const SUBJECT = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL = `supabase:${SUBJECT}`;
const RAW_SESSION = 'S'.repeat(43);
const NOW = new Date('2026-09-03T09:00:00.000Z');
const CONFIG: JuryAiWebServerConfig = {
  publicOrigin: ORIGIN,
  databaseUrl: 'postgresql://unused',
  supabaseUrl: 'https://project.supabase.co',
  supabasePublishableKey: 'publishable',
  production: true,
  v212ProductionEnabled: true,
  invitationAccountCommitmentSecret: 'x'.repeat(32),
  cookie: { name: '__Host-juryai_session', secure: true },
};

class Sessions implements WebSessionPersistence {
  readonly records = new Map<string, WebSessionRecord>();
  constructor() {
    this.records.set(hashSessionToken(RAW_SESSION), {
      session_id_hash: hashSessionToken(RAW_SESSION),
      principal_id: PRINCIPAL,
      auth_provider: 'supabase',
      auth_subject: SUBJECT,
      created_at: new Date(NOW.getTime() - 1_000),
      expires_at: new Date(NOW.getTime() + 60_000),
      revoked_at: null,
    });
  }
  async createSession(record: WebSessionRecord): Promise<void> {
    this.records.set(record.session_id_hash, structuredClone(record));
  }
  async findActiveSession(hash: string): Promise<WebSessionRecord | null> {
    return structuredClone(this.records.get(hash) ?? null);
  }
  async revokeSession(): Promise<void> {}
  async hasDisclosureAcceptance(_principal: string, version: string): Promise<boolean> {
    return version === JURYAI_P2_DISCLOSURE_VERSION;
  }
  async acceptDisclosure(): Promise<void> {}
}

function post(path: string, body: unknown, cookie = true): Request {
  const headers = new Headers({ Origin: ORIGIN, 'Content-Type': 'application/json' });
  if (cookie) headers.set('Cookie', `__Host-juryai_session=${RAW_SESSION}`);
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    headers: { Cookie: `__Host-juryai_session=${RAW_SESSION}` },
  });
}

function firstParty(overrides: Partial<ProductionFirstPartyServiceV212> = {}) {
  const base = {
    issueInvitation: async () => ({
      status: 'issued' as const,
      invitation_id: 'invitation_1',
      opaque_token: 'opaque-token',
      csurl_path: '/join/opaque-token',
      expires_at: '2026-09-10T09:00:00.000Z',
    }),
    redeemInvitation: async () => ({ status: 'redeemed' as const }),
    getReview: async () => null,
    getReviewPage: async () => null,
    acknowledgeDisclosureReview: async () => ({ status: 'unauthorized' as const }),
    issueReviewChallenge: async () => ({
      status: 'rejected' as const,
      reason_code: 'unavailable',
      message: 'Review is unavailable.',
    }),
    executeReviewAction: async () => ({
      status: 'rejected' as const,
      reason_code: 'unavailable',
      message: 'Review is unavailable.',
    }),
    ...overrides,
  };
  return base as ProductionFirstPartyServiceV212;
}

function server(
  input: {
    service?: ProductionFirstPartyServiceV212;
    factory?: boolean;
    verifySubject?: string | null;
    subjects?: string[];
    sessions?: Sessions;
  } = {},
) {
  const sessions = input.sessions ?? new Sessions();
  return new JuryAiWebServer({
    config: CONFIG,
    persistence: sessions,
    authForRequest: () => ({
      requestEmailOtp: async () => undefined,
      verifyEmailOtp: async () => input.verifySubject ?? SUBJECT,
    }),
    runtime: async () => {
      throw new Error('Legacy runtime must not be reached.');
    },
    now: () => NOW,
    sessionTokenFactory: () => 'J'.repeat(43),
    v212FirstPartyForSubject:
      input.factory === false
        ? undefined
        : async (subject) => {
            input.subjects?.push(subject);
            return input.service ?? firstParty();
          },
  });
}

describe('PR 6 first-party HTTP authority boundary', () => {
  it('issues invitations only from an authenticated session and never accepts caller party authority', async () => {
    const subjects: string[] = [];
    const instance = server({ subjects });
    const issued = await instance.issueFormationInvitation(
      post('/api/juryai/cases/dispute_1/invitations', { email: 'party-b@example.com' }),
      'dispute_1',
    );
    expect(issued.status).toBe(201);
    expect(await issued.json()).toMatchObject({
      status: 'issued',
      csurl_path: '/join/opaque-token',
    });
    expect(subjects).toEqual([SUBJECT]);

    const injected = await instance.issueFormationInvitation(
      post('/api/juryai/cases/dispute_1/invitations', {
        email: 'party-b@example.com',
        party_id: 'party_b',
      }),
      'dispute_1',
    );
    expect(injected.status).toBe(400);
  });

  it('does not verify or consume an OTP when the server-side V2.1.2 factory is disabled', async () => {
    let verifications = 0;
    const instance = new JuryAiWebServer({
      config: { ...CONFIG, v212ProductionEnabled: false },
      persistence: new Sessions(),
      authForRequest: () => ({
        requestEmailOtp: async () => undefined,
        verifyEmailOtp: async () => {
          verifications += 1;
          return SUBJECT;
        },
      }),
      runtime: async () => {
        throw new Error('unused');
      },
      now: () => NOW,
    });
    const response = await instance.redeemFormationInvitation(
      post('/api/juryai/join/token', { email: 'party-b@example.com', otp: '123456' }, false),
      'token',
    );
    expect(response.status).toBe(404);
    expect(verifications).toBe(0);
  });

  it('combines verified intended-account authentication, redemption, and JuryAI session issuance', async () => {
    const sessions = new Sessions();
    const subjects: string[] = [];
    const response = await server({ sessions, subjects }).redeemFormationInvitation(
      post('/api/juryai/join/token', { email: 'party-b@example.com', otp: '123456' }, false),
      'token',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'redeemed' });
    expect(response.headers.get('Set-Cookie')).toContain('__Host-juryai_session=');
    expect(subjects).toEqual([SUBJECT]);
    expect(sessions.records.size).toBe(2);
  });

  it('rejects relay-shaped acknowledgment and protected-action authority injection', async () => {
    const instance = server();
    const relay = await instance.caseService(
      post('/api/juryai/case-service', {
        operation: 'acknowledgeReview',
        input: { case_id: 'dispute_1' },
      }),
    );
    expect(relay.status).toBe(400);

    const acknowledgment = await instance.acknowledgeDisclosureReview(
      post('/api/juryai/cases/dispute_1/disclosure-review', { party_id: 'party_b' }),
      'dispute_1',
    );
    expect(acknowledgment.status).toBe(400);

    const protectedAction = await instance.executePartyReviewAction(
      post('/api/juryai/cases/dispute_1/review-actions', {
        action: 'confirm_case_account',
        challenge_id: 'handoff_challenge_1',
        server_observed: true,
      }),
      'dispute_1',
    );
    expect(protectedAction.status).toBe(400);
  });

  it('serves a server-derived V2.1.2 party review without accepting a party selector', async () => {
    const reviewPage = {
      review_page_version: 'juryai-v2.1.2-first-party-review-page-v1.0.0' as const,
      review: {} as never,
      workflow_phase: 'challenge_response' as const,
      disclosure_state: 'disclosed' as const,
      own_disclosure_review: 'open' as const,
      can_acknowledge_disclosure_review: true,
      can_confirm: false,
      can_reopen: false,
      can_invite_party_b: false,
      waiting_for_other_party: false,
      disclosure_review_acknowledgment_statement:
        'I have reviewed the currently disclosed case material and have no further challenges to raise at this time.' as const,
    };
    const subjects: string[] = [];
    const instance = server({
      subjects,
      service: firstParty({ getReviewPage: async () => reviewPage }),
    });
    const response = await instance.reviewCase(
      get('/api/juryai/cases/dispute_1/review?party_id=party_b'),
      'dispute_1',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(reviewPage);
    expect(subjects).toEqual([SUBJECT]);
  });

  it('exposes only public ceremony reference data and never the protected command payload', async () => {
    const instance = server({
      service: firstParty({
        issueReviewChallenge: async () => ({
          status: 'issued',
          challenge: {
            challenge_id: 'handoff_challenge_1',
            requested_action: 'confirm_case_account',
            public_reference: 'PR6-0001',
            required_minimum_assurance: 'HHC-3',
            expires_at: '2026-09-03T09:05:00.000Z',
          } as never,
          review_state: {
            review_state_hash: 'a'.repeat(64),
            party_readback_hash: 'b'.repeat(64),
          } as never,
        }),
      }),
    });
    const response = await instance.issuePartyReviewChallenge(
      post('/api/juryai/cases/dispute_1/review-challenges', {
        action: 'confirm_case_account',
      }),
      'dispute_1',
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      challenge: {
        challenge_id: 'handoff_challenge_1',
        public_reference: 'PR6-0001',
        required_minimum_assurance: 'HHC-3',
      },
    });
    expect(JSON.stringify(body)).not.toContain('ceremony_command');
    expect(JSON.stringify(body)).not.toContain('internal_envelope');
  });
});
