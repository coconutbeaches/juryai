import { describe, expect, it, vi } from 'vitest';
import { JuryAiWebServer } from '../webmcp/server/server.js';
import { hashSessionToken } from '../webmcp/server/session.js';
import type { ProductionFirstPartyService } from '../v2-1-5/production-routing.js';

const origin = 'https://juryai.test';
const token = 'S'.repeat(43);
const subject = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-09-07T06:00:00Z');
const body = { review_state_hash: 'a'.repeat(64), client_request_id: 'return_test' };
function fixture() {
  const returnToEdit = vi.fn(async () => ({ status: 'committed' }));
  const factory = vi.fn(async () => ({ returnToEdit }) as unknown as ProductionFirstPartyService);
  const runtime = vi.fn(async () => {
    throw new Error('No semantic runtime permitted for a control event.');
  });
  const server = new JuryAiWebServer({
    config: {
      publicOrigin: origin,
      databaseUrl: 'postgresql://unused',
      supabaseUrl: 'https://project.supabase.co',
      supabasePublishableKey: 'publishable',
      production: true,
      v212ProductionEnabled: true,
      cookie: { name: '__Host-juryai_session', secure: true },
    },
    persistence: {
      findActiveSession: async (hash) =>
        hash === hashSessionToken(token)
          ? {
              session_id_hash: hash,
              principal_id: `supabase:${subject}`,
              auth_provider: 'supabase',
              auth_subject: subject,
              created_at: new Date(now.getTime() - 1000),
              expires_at: new Date(now.getTime() + 60000),
              revoked_at: null,
            }
          : null,
      createSession: async () => {},
      revokeSession: async () => {},
      hasDisclosureAcceptance: async () => true,
      acceptDisclosure: async () => {},
    },
    authForRequest: () => ({
      requestEmailOtp: async () => {},
      verifyEmailOtp: async () => subject,
    }),
    runtime,
    now: () => now,
    v212FirstPartyForSubject: factory,
  });
  return { server, returnToEdit, factory, runtime };
}
function request(
  input: unknown = body,
  options: { cookie?: boolean; origin?: string; method?: string } = {},
) {
  return new Request(`${origin}/api/juryai/cases/dispute_test/return-to-edit`, {
    method: options.method ?? 'POST',
    headers: {
      Origin: options.origin ?? origin,
      'Content-Type': 'application/json',
      ...(options.cookie === false ? {} : { Cookie: `__Host-juryai_session=${token}` }),
    },
    ...(options.method === 'GET' ? {} : { body: JSON.stringify(input) }),
  });
}
describe('V2.1.5 non-testimonial control HTTP boundary', () => {
  it('derives identity from session and forwards only review binding and retry identity', async () => {
    const f = fixture();
    expect((await f.server.returnUnconfirmedToEdit(request(), 'dispute_test')).status).toBe(200);
    expect(f.factory).toHaveBeenCalledWith(subject);
    expect(f.returnToEdit).toHaveBeenCalledWith({ dispute_id: 'dispute_test', ...body });
    expect(f.runtime).not.toHaveBeenCalled();
  });
  it.each([
    'no session',
    'foreign origin',
    'GET',
    'party injection',
    'testimony',
    'missing binding',
  ])('rejects %s without reaching authority or model execution', async (kind) => {
    const f = fixture();
    const input =
      kind === 'party injection'
        ? { ...body, party_id: 'party_b' }
        : kind === 'testimony'
          ? { ...body, text: 'Replace my account.' }
          : kind === 'missing binding'
            ? { client_request_id: body.client_request_id }
            : body;
    const response = await f.server.returnUnconfirmedToEdit(
      request(input, {
        cookie: kind !== 'no session',
        origin: kind === 'foreign origin' ? 'https://attacker.test' : origin,
        method: kind === 'GET' ? 'GET' : 'POST',
      }),
      'dispute_test',
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(f.returnToEdit).not.toHaveBeenCalled();
    expect(f.runtime).not.toHaveBeenCalled();
  });
  it('does not register return-to-edit as a public case-service operation', async () => {
    const f = fixture();
    const response = await f.server.caseService(
      request({ operation: 'returnToEdit', input: { case_id: 'dispute_test', ...body } }),
    );
    expect(response.status).toBe(400);
    expect(f.returnToEdit).not.toHaveBeenCalled();
  });
});
