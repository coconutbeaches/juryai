import { describe, expect, it, vi } from 'vitest';
import {
  createProductionVersionedCaseServiceV215,
  createVersionedFirstPartyService,
  type ProductionFormationVersion,
} from '../v2-1-5/production-routing.js';
import { postgresContractResolution } from '../v2-1-5/postgres-contract-resolution.js';
import { createInitialProductionDisputeV215 } from '../v2-1-5/production-case-service.js';
import { createInitialProductionDisputeV214 } from '../v2-1-4/production-case-service.js';
import { createInitialProductionDisputeV213 } from '../v2-1-3/production-case-service.js';
import { createInitialProductionDisputeV212 } from '../v2-1-2/production-case-service.js';
import { createV214PartyCaseService } from '../v2-1-4/webmcp-application.js';
import { TestCompilerV215 } from './v2-1-5-test-helpers.js';
import { decodeFormationReview } from '../webmcp/browser/supported-review-contract.js';

function stub() {
  return {
    startCase: vi.fn(async () => ({
      ok: false,
      error: { code: 'CASE_NOT_FOUND', message: '', retryable: false },
    })),
    getCaseState: vi.fn(async () => ({
      ok: false,
      error: { code: 'CASE_NOT_FOUND', message: '', retryable: false },
    })),
    submitTurn: vi.fn(async () => ({
      ok: false,
      error: { code: 'CASE_NOT_FOUND', message: '', retryable: false },
    })),
    listActiveCaseIds: vi.fn(async () => [] as string[]),
  };
}
const versions = [
  'juryai-case-envelope-v2.1.2',
  'juryai-case-envelope-v2.1.3',
  'juryai-case-envelope-v2.1.4',
  'juryai-case-envelope-v2.1.5',
] as const;
function fixture(version: ProductionFormationVersion | null, enabled = true) {
  const services = versions.map(() => stub()),
    legacy = stub();
  const resolveVersion = vi.fn(async () => version);
  const routed = createProductionVersionedCaseServiceV215({
    enabled,
    legacy: legacy as never,
    v212: services[0] as never,
    v213: services[1] as never,
    v214: services[2] as never,
    v215: services[3] as never,
    resolveVersion,
    startCaseId: () => 'dispute_stable',
  });
  return { services, legacy, routed, resolveVersion };
}

describe('V2.1.5 authoritative generation routing', () => {
  it.each(versions)(
    'persisted %s selects exactly its historical/current implementation',
    async (version) => {
      const f = fixture(version);
      await f.routed.getCaseState({ case_id: 'dispute_same_prefix' });
      await f.routed.submitTurn({
        case_id: 'dispute_same_prefix',
        expected_case_version: 1,
        client_turn_id: 'client',
        in_reply_to: [],
        payload: { context: [], answer: { role: 'user', text: 'Answer.' } },
      });
      for (let i = 0; i < versions.length; i++) {
        expect(f.services[i]!.getCaseState).toHaveBeenCalledTimes(versions[i] === version ? 1 : 0);
        expect(f.services[i]!.submitTurn).toHaveBeenCalledTimes(versions[i] === version ? 1 : 0);
      }
    },
  );

  it('new starts use V2.1.5 while the compatibility HMAC identity stays stable across all production generations', async () => {
    const f = fixture(null);
    await f.routed.startCase({ client_request_id: 'new' });
    expect(f.services[3]!.startCase).toHaveBeenCalledOnce();
    const request = {
      authenticated_subject_id: 'subject_a',
      client_request_id: 'stable',
      idempotency_secret: 'isolated-idempotency-secret',
    };
    const envelopes = [
      createInitialProductionDisputeV212,
      createInitialProductionDisputeV213,
      createInitialProductionDisputeV214,
      createInitialProductionDisputeV215,
    ].map((create) => create(request));
    expect(new Set(envelopes.map((e) => e.control.case_id)).size).toBe(1);
    expect(envelopes.map((e) => e.control.schema_version)).toEqual(versions);
  });

  it.each(versions)(
    'retrying a start already persisted as %s never creates a new-generation twin',
    async (version) => {
      const f = fixture(version);
      await f.routed.startCase({ client_request_id: 'lost-start-response' });
      for (const s of f.services) expect(s.startCase).not.toHaveBeenCalled();
      expect(f.services[versions.indexOf(version)]!.getCaseState).toHaveBeenCalledWith(
        { case_id: 'dispute_stable' },
        undefined,
      );
    },
  );

  it('unknown/malformed generations and review contracts fail closed', async () => {
    for (const version of [null, 'juryai-case-envelope-v9', {}, 'juryai-case-envelope-v2.1.5 ']) {
      const f = fixture(version as never);
      expect(await f.routed.getCaseState({ case_id: 'dispute_unknown' })).toMatchObject({
        ok: false,
        error: { code: 'CASE_NOT_FOUND' },
      });
      for (const s of f.services) expect(s.getCaseState).not.toHaveBeenCalled();
    }
    const pool = { query: async () => ({ rows: [{ schema_version: 'unknown' }] }) };
    await expect(
      postgresContractResolution(pool as never).resolveVersion('dispute_unknown'),
    ).rejects.toThrow(/Unknown/);
    expect(() => decodeFormationReview({ review_page_version: 'unknown' })).toThrow();
  });

  it('retains the compatibility kill switch and cannot inject V0.4 into the historical V2.1.4 service', async () => {
    const f = fixture(null, false);
    await f.routed.startCase({ client_request_id: 'disabled' });
    expect(f.legacy.startCase).toHaveBeenCalledOnce();
    expect(f.resolveVersion).not.toHaveBeenCalled();
    expect(() => createV214PartyCaseService({ compiler: new TestCompilerV215() } as never)).toThrow(
      /V0.3/,
    );
  });

  it.each(versions)(
    'first-party review and invitation redemption route by persisted %s',
    async (version) => {
      const services = versions.map(() => ({
        getReviewPage: vi.fn(async () => null),
        redeemInvitation: vi.fn(async () => null),
      }));
      const service = createVersionedFirstPartyService({
        v212: services[0] as never,
        v213: services[1] as never,
        v214: services[2] as never,
        v215: services[3] as never,
        resolveVersion: async () => version,
        resolveInvitationVersion: async () => version,
      });
      await service.getReviewPage('dispute_any');
      await service.redeemInvitation({
        opaque_token: 'opaque-token',
        authenticated_email: 'synthetic@example.test',
      });
      services.forEach((s, i) => {
        expect(s.getReviewPage).toHaveBeenCalledTimes(versions[i] === version ? 1 : 0);
        expect(s.redeemInvitation).toHaveBeenCalledTimes(versions[i] === version ? 1 : 0);
      });
    },
  );
});
