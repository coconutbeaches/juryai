import { describe, expect, it, vi } from 'vitest';
import {
  createProductionVersionedCaseServiceV214,
  createVersionedFirstPartyService,
} from '../v2-1-4/production-routing.js';
import { createInitialProductionDisputeV214 } from '../v2-1-4/production-case-service.js';
import { createInitialProductionDisputeV212 } from '../v2-1-2/production-case-service.js';
import { derivePartyReviewStateV214 } from '../v2-1-4/party-review-state.js';
import { derivePartyReviewStateV212 } from '../v2-1-2/party-review-state.js';
import { decodeFormationReview } from '../webmcp/browser/supported-review-contract.js';
import { decodeFirstPartyReviewV212 } from '../webmcp/browser/v2-1-2-review-contract.js';
import { decodeFirstPartyReviewV214 } from '../webmcp/browser/v2-1-4-review-contract.js';
import { decodeCaseServiceResult } from '../webmcp/supported-public-contract.js';
import { createHttpCaseService } from '../webmcp/browser/http-case-service.js';
import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';
import { readFileSync } from 'node:fs';
import { projectRoot } from './test-helpers.js';

function state(id: string, current = false) {
  return {
    case_id: id,
    case_version: 1,
    protocol_version: `juryai-webmcp-protocol-v0.${current ? 3 : 2}.0`,
    schema_version: `juryai-webmcp-core-v0.${current ? 3 : 2}.0`,
    status: 'draft',
    unresolved_requirement_count: 0,
    next_requirements: [],
    open_clarifications: [],
    recent_interpretations: [],
    evidence_references: [],
    warnings: [],
    review_url: `https://juryai.test/cases/${id}/review`,
  } as const;
}
function service(id: string, current = false, active: string[] = []) {
  return {
    startCase: vi.fn(async () => ({ ok: true, case: state(id, current) })),
    getCaseState: vi.fn(async (q: { case_id?: string }) =>
      q.case_id || active.length
        ? { ok: true, case: state(q.case_id ?? active[0]!, current) }
        : {
            ok: false,
            error: { code: 'CASE_NOT_FOUND', message: 'No such case.', retryable: false },
          },
    ),
    submitTurn: vi.fn(async () => ({
      ok: true,
      case: state(id, current),
      turn_id: 'turn_1',
      recorded: [],
      superseded: [],
    })),
    listActiveCaseIds: vi.fn(async () => active),
  };
}
function setup(
  enabled = true,
  activeOld: string[] = [],
  activeNew: string[] = [],
  activePrior: string[] = [],
) {
  const legacy = service('case_legacy'),
    old = service('dispute_old', false, activeOld),
    prior = service('dispute_prior', true, activePrior),
    current = service('dispute_new', true, activeNew);
  const resolveVersion = vi.fn(async (id: string) =>
    id === 'dispute_old'
      ? 'juryai-case-envelope-v2.1.2'
      : id === 'dispute_prior'
        ? 'juryai-case-envelope-v2.1.3'
        : id === 'dispute_new'
          ? 'juryai-case-envelope-v2.1.4'
          : null,
  );
  const routed = createProductionVersionedCaseServiceV214({
    enabled,
    legacy: legacy as never,
    v212: old as never,
    v213: prior as never,
    v214: current as never,
    resolveVersion: resolveVersion as never,
    startCaseId: (request) =>
      request === 'old_retry'
        ? 'dispute_old'
        : request === 'prior_retry'
          ? 'dispute_prior'
          : 'dispute_fresh',
  });
  return { legacy, old, prior, current, routed, resolveVersion };
}
const start = {
  authenticated_subject_id: 'subject_a',
  client_request_id: 'same_request',
  idempotency_secret: 'isolated-regression-secret-0123456789',
};

describe('PR 7 authoritative production routing and browser integration', () => {
  it('creates V2.1.4 for new starts and keeps the stable historical start identity', async () => {
    const { routed, current, old } = setup();
    await routed.startCase({ client_request_id: 'fresh' });
    expect(current.startCase).toHaveBeenCalledOnce();
    expect(old.startCase).not.toHaveBeenCalled();
    const next = createInitialProductionDisputeV214(start),
      prior = createInitialProductionDisputeV212(start);
    expect(next.control.case_id).toBe(prior.control.case_id);
    expect(next.control.schema_version).toBe('juryai-case-envelope-v2.1.4');
    expect(prior.control.schema_version).toBe('juryai-case-envelope-v2.1.2');
  });
  it('a start retry after the writer upgrade reads the old case without writing either version', async () => {
    const { routed, current, old } = setup();
    await routed.startCase({ client_request_id: 'old_retry' });
    expect(old.getCaseState).toHaveBeenCalledWith({ case_id: 'dispute_old' }, undefined);
    expect(current.startCase).not.toHaveBeenCalled();
    expect(old.startCase).not.toHaveBeenCalled();
  });
  it.each(['dispute_old', 'dispute_new', 'case_legacy'])(
    'routes %s by its authoritative persisted contract',
    async (id) => {
      const { routed, current, old, legacy } = setup();
      await routed.getCaseState({ case_id: id });
      await routed.submitTurn({
        case_id: id,
        expected_case_version: 1,
        in_reply_to: ['req_1'],
        payload: { context: [], answer: { role: 'user', text: 'No invoice.' } },
        client_turn_id: 'client_1',
      });
      for (const [key, handler] of Object.entries({
        dispute_old: old,
        dispute_new: current,
        case_legacy: legacy,
      })) {
        expect(handler.getCaseState).toHaveBeenCalledTimes(key === id ? 1 : 0);
        expect(handler.submitTurn).toHaveBeenCalledTimes(key === id ? 1 : 0);
      }
    },
  );
  it('does not treat an unknown dispute prefix as the newest schema', async () => {
    const { routed, current, old } = setup();
    expect(await routed.getCaseState({ case_id: 'dispute_unknown' })).toMatchObject({
      ok: false,
      error: { code: 'CASE_NOT_FOUND' },
    });
    expect(current.getCaseState).not.toHaveBeenCalled();
    expect(old.getCaseState).not.toHaveBeenCalled();
  });
  it('retains the single fail-closed kill switch', async () => {
    const { routed, current, old, legacy, resolveVersion } = setup(false);
    await routed.startCase({ client_request_id: 'off' });
    expect(legacy.startCase).toHaveBeenCalledOnce();
    expect(current.startCase).not.toHaveBeenCalled();
    expect(old.startCase).not.toHaveBeenCalled();
    expect(resolveVersion).not.toHaveBeenCalled();
  });
  it('requires explicit identity when V2.1.2 and V2.1.4 contexts coexist', async () => {
    expect(
      await setup(true, ['dispute_old'], ['dispute_new']).routed.getCaseState({}),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
  it.each([['dispute_old'], ['dispute_new']])(
    'resumes the single authoritative context %s',
    async (id) => {
      const { routed } = setup(
        true,
        id === 'dispute_old' ? [id] : [],
        id === 'dispute_new' ? [id] : [],
      );
      expect(await routed.getCaseState({})).toMatchObject({ ok: true, case: { case_id: id } });
    },
  );
  it('decodes new absence output through the HTTP and three-tool boundary, not the old schema', async () => {
    const output = {
      ok: true,
      case: {
        ...state('dispute_new', true),
        recent_interpretations: [
          {
            proposition_id: 'position_1',
            requirement_id: 'req_1',
            statement: 'The party says no invoice was issued.',
            type: 'explicit_absence',
            epistemic_strength: 'asserted_confident',
            attribution: 'relayed',
          },
        ],
      },
    };
    expect(decodeCaseServiceResult('getCaseState', output)).toEqual(output);
    const malformed = structuredClone(output);
    malformed.case.schema_version = 'juryai-webmcp-core-v0.2.0' as never;
    malformed.case.protocol_version = 'juryai-webmcp-protocol-v0.2.0' as never;
    expect(() => decodeCaseServiceResult('getCaseState', malformed)).toThrow();
    const http = createHttpCaseService({
      expectedOrigin: 'https://juryai.test',
      fetchImpl: async () =>
        new Response(JSON.stringify(output), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    const tools = createJuryAiToolDefinitions(http);
    expect(tools.map((t) => t.name)).toEqual(['start_case', 'get_case_state', 'submit_turn']);
    expect(await tools[1]!.execute({ case_id: 'dispute_new' })).toMatchObject({
      kind: 'juryai_data',
      data: output,
    });
  });
  it('versions review/readback together and preserves historical decoding', () => {
    const page = (review: unknown, version: string) => ({
      review_page_version: `juryai-${version}-first-party-review-page-v1.0.0`,
      review,
      workflow_phase: 'independent_formation',
      disclosure_state: 'embargoed',
      own_disclosure_review: 'unavailable',
      can_acknowledge_disclosure_review: false,
      can_confirm: false,
      can_reopen: false,
      can_invite_party_b: true,
      waiting_for_other_party: true,
      disclosure_review_acknowledgment_statement:
        'I have reviewed the currently disclosed case material and have no further challenges to raise at this time.',
    });
    const old = page(
      derivePartyReviewStateV212(createInitialProductionDisputeV212(start), 'party_a'),
      'v2.1.2',
    );
    const current = page(
      derivePartyReviewStateV214(createInitialProductionDisputeV214(start), 'party_a'),
      'v2.1.4',
    );
    expect(decodeFormationReview(old)).toEqual(decodeFirstPartyReviewV212(old));
    expect(decodeFormationReview(current)).toEqual(decodeFirstPartyReviewV214(current));
    expect(() => decodeFirstPartyReviewV212(current)).toThrow();
    expect(() => decodeFirstPartyReviewV214(old)).toThrow();
  });
  it('routes first-party mutations and invitation redemption to persisted versions', async () => {
    const make = () => ({
      issueInvitation: vi.fn(async () => ({ status: 'issued' })),
      redeemInvitation: vi.fn(async () => ({ status: 'redeemed' })),
      getReview: vi.fn(async () => null),
      getReviewPage: vi.fn(async () => null),
      acknowledgeDisclosureReview: vi.fn(async () => ({ status: 'unauthorized' })),
      issueReviewChallenge: vi.fn(async () => ({ status: 'rejected' })),
      executeReviewAction: vi.fn(async () => ({ status: 'rejected' })),
    });
    const old = make(),
      prior = make(),
      current = make();
    const router = createVersionedFirstPartyService({
      v212: old as never,
      v213: prior as never,
      v214: current as never,
      resolveVersion: async (id) =>
        id === 'old'
          ? 'juryai-case-envelope-v2.1.2'
          : id === 'prior'
            ? 'juryai-case-envelope-v2.1.3'
            : id === 'new'
              ? 'juryai-case-envelope-v2.1.4'
              : null,
      resolveInvitationVersion: async (token) =>
        token === 'old-token' ? 'juryai-case-envelope-v2.1.2' : 'juryai-case-envelope-v2.1.4',
    });
    await router.executeReviewAction({
      dispute_id: 'old',
      action: 'confirm_case_account',
      challenge_id: 'challenge_1',
      first_party_session_id: 'session_1',
    });
    await router.issueReviewChallenge({ dispute_id: 'new', action: 'confirm_case_account' });
    await router.redeemInvitation({
      opaque_token: 'old-token',
      authenticated_email: 'test@example.test',
    });
    expect(old.executeReviewAction).toHaveBeenCalledOnce();
    expect(current.executeReviewAction).not.toHaveBeenCalled();
    expect(current.issueReviewChallenge).toHaveBeenCalledOnce();
    expect(old.redeemInvitation).toHaveBeenCalledOnce();
    expect(await router.getReview('unknown')).toBeNull();
  });
  it('leaves the failed live canary out of mutation code and SQL', () => {
    const id = 'dispute_8f298b3cb56cf05aee8888068e0836088f0867be1425a0e2528707087919448e';
    for (const path of [
      'src/webmcp/server/production.ts',
      'src/v2-1-4/production-case-service.ts',
      'src/v2-1-4/production-routing.ts',
      'supabase/migrations/20260904120000_v214_performance_formation_contract_pairs.sql',
    ])
      expect(readFileSync(`${projectRoot}/${path}`, 'utf8')).not.toContain(id);
  });
});
