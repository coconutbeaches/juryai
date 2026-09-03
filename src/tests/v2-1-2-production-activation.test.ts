import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  CaseServicePort,
  CaseStateResponse,
  GetCaseStateResult,
} from '../webmcp/public-contract.js';
import { v212ProductionEnabled } from '../webmcp/server/config.js';
import {
  createInitialProductionDisputeV212,
  createProductionVersionedCaseServiceV212,
  type ProductionCaseServiceV212,
} from '../v2-1-2/production-case-service.js';
import {
  PARTY_REVIEW_PROTECTED_ACTION_VERSION_V212,
  validatePartyReviewProtectedActionPayloadV212,
} from '../v2-1-2/party-review-application.js';
import { ENVELOPE_COMMAND_VERSION_V212 } from '../v2-1-2/case-envelope.js';
import { derivePartyReviewStateV212 } from '../v2-1-2/party-review-state.js';
import { decodeFirstPartyReviewV212 } from '../webmcp/browser/v2-1-2-review-contract.js';

function publicCase(caseId: string, version = 1): CaseStateResponse {
  return {
    case_id: caseId,
    case_version: version,
    protocol_version: 'juryai-webmcp-protocol-v0.2.0',
    schema_version: 'juryai-case-state-v0.2.0',
    status: 'draft',
    unresolved_requirement_count: 0,
    next_requirements: [],
    open_clarifications: [],
    recent_interpretations: [],
    evidence_references: [],
    warnings: [],
    review_url: `https://juryai.test/cases/${caseId}/review`,
  };
}

function service(label: 'legacy' | 'v212', active: string[] = []) {
  const calls: string[] = [];
  const base: CaseServicePort = {
    startCase: async () => {
      calls.push(`${label}:start`);
      return { ok: true, case: publicCase(label === 'legacy' ? 'case_legacy' : 'dispute_v212') };
    },
    getCaseState: async (query): Promise<GetCaseStateResult> => {
      calls.push(`${label}:get:${query.case_id ?? 'active'}`);
      const id = query.case_id ?? active[0];
      return id
        ? { ok: true, case: publicCase(id) }
        : {
            ok: false,
            error: { code: 'CASE_NOT_FOUND', message: 'No such case.', retryable: false },
          };
    },
    submitTurn: async (command) => {
      calls.push(`${label}:submit:${command.case_id}`);
      return {
        ok: true,
        turn_id: 'turn_1',
        case: publicCase(command.case_id, command.expected_case_version + 1),
        recorded: [],
        superseded: [],
      };
    },
  };
  return {
    calls,
    service:
      label === 'v212' ? Object.assign(base, { listActiveCaseIds: async () => [...active] }) : base,
  };
}

describe('PR 6 production activation boundary', () => {
  it.each([undefined, '', 'TRUE', 'True', '1', 'yes', ' false ', 'true '])(
    'fails closed for switch value %s',
    (value) => {
      expect(v212ProductionEnabled({ JURYAI_V212_PRODUCTION_ENABLED: value })).toBe(false);
    },
  );

  it('enables only the exact server-side true value', () => {
    expect(v212ProductionEnabled({ JURYAI_V212_PRODUCTION_ENABLED: 'true' })).toBe(true);
  });

  it('keeps switch-off start_case and explicit case_ routing on the frozen legacy service', async () => {
    const legacy = service('legacy');
    const v212 = service('v212');
    const routed = createProductionVersionedCaseServiceV212({
      enabled: false,
      legacy: legacy.service,
      v212: v212.service as ProductionCaseServiceV212,
    });
    await routed.startCase({ client_request_id: 'start_1' });
    await routed.getCaseState({ case_id: 'case_legacy' });
    expect(legacy.calls).toEqual(['legacy:start', 'legacy:get:case_legacy']);
    expect(v212.calls).toEqual([]);
  });

  it('routes enabled start_case and dispute_ traffic only to V2.1.2, while case_ stays legacy', async () => {
    const legacy = service('legacy');
    const v212 = service('v212');
    const routed = createProductionVersionedCaseServiceV212({
      enabled: true,
      legacy: legacy.service,
      v212: v212.service as ProductionCaseServiceV212,
    });
    await routed.startCase({ client_request_id: 'start_1' });
    await routed.getCaseState({ case_id: 'dispute_v212' });
    await routed.getCaseState({ case_id: 'case_legacy' });
    expect(v212.calls).toEqual(['v212:start', 'v212:get:dispute_v212']);
    expect(legacy.calls).toEqual(['legacy:get:case_legacy']);
  });

  it('fails ambiguous no-ID lookup rather than selecting by order', async () => {
    const legacy = service('legacy', ['case_legacy']);
    const v212 = service('v212', ['dispute_a', 'dispute_b']);
    const routed = createProductionVersionedCaseServiceV212({
      enabled: true,
      legacy: legacy.service,
      v212: v212.service as ProductionCaseServiceV212,
    });
    await expect(routed.getCaseState({})).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(v212.calls).toEqual([]);
  });

  it('constructs a canonical V2.1.2 dispute with creator as A and genuinely unbound B', () => {
    const envelope = createInitialProductionDisputeV212({
      authenticated_subject_id: 'subject_party_a',
      client_request_id: 'client_start_1',
      idempotency_secret: 'server-only-secret-with-at-least-32-bytes',
    });
    expect(envelope.control).toMatchObject({
      schema_version: 'juryai-case-envelope-v2.1.2',
      command_contract_version: ENVELOPE_COMMAND_VERSION_V212,
      workflow_state: 'independent_formation',
      disclosure_state: 'embargoed',
    });
    expect(envelope.control.case_id).toMatch(/^dispute_[a-f0-9]{64}$/u);
    expect(envelope.parties.party_a).toMatchObject({
      identity_assurance: 'authenticated',
      authenticated_subject_id: 'subject_party_a',
    });
    expect(envelope.parties.party_b).toMatchObject({
      identity_assurance: 'unbound',
      authenticated_subject_id: null,
    });
    expect(envelope.control.party_views.party_a.party_visible_version).toBeGreaterThan(0);
    expect(envelope.control.party_views.party_b.party_visible_version).toBeGreaterThan(0);
  });

  it('keeps the protected-action contract additive and exactly V2.1.2 command-bound', () => {
    expect(PARTY_REVIEW_PROTECTED_ACTION_VERSION_V212).toBe(
      'juryai-party-review-protected-action-v1.1.0',
    );
    expect(
      validatePartyReviewProtectedActionPayloadV212({
        protected_action_version: PARTY_REVIEW_PROTECTED_ACTION_VERSION_V212,
        review_state_hash: 'a'.repeat(64),
        party_readback_hash: 'b'.repeat(64),
        ceremony_command: {
          command_version: 'juryai-envelope-command-v2.1.1',
          command_id: 'command_party_a_wrong',
          base_envelope_version: 1,
          base_envelope_hash: 'c'.repeat(64),
          operation: { type: 'record_party_confirmation' },
        },
      }),
    ).toBe(false);
  });

  it('decodes only the server-derived party-safe review page and preserves frozen read-back bytes', () => {
    const envelope = createInitialProductionDisputeV212({
      authenticated_subject_id: 'subject_party_a_review',
      client_request_id: 'client_start_review',
      idempotency_secret: 'server-only-secret-with-at-least-32-bytes',
    });
    const review = derivePartyReviewStateV212(envelope, 'party_a');
    const page = {
      review_page_version: 'juryai-v2.1.2-first-party-review-page-v1.0.0',
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
    };
    expect(decodeFirstPartyReviewV212(page).review.formation_readback.document).toBe(
      review.formation_readback.document,
    );
    expect(() => decodeFirstPartyReviewV212({ ...page, party_id: 'party_b' })).toThrow(
      /keys are invalid/u,
    );
    const nestedLeak = structuredClone(page) as typeof page & {
      review: typeof review & {
        formation_projection: typeof review.formation_projection & {
          own_material: typeof review.formation_projection.own_material & {
            internal_envelope_hash: string;
          };
        };
      };
    };
    nestedLeak.review.formation_projection.own_material.internal_envelope_hash = 'a'.repeat(64);
    expect(() => decodeFirstPartyReviewV212(nestedLeak)).toThrow(/own material keys are invalid/u);
  });

  it('keeps exactly three document.modelContext tools and introduces no navigator surface or rollout cohorts', () => {
    const registration = readFileSync('src/webmcp/tools/register.ts', 'utf8');
    const browserEntry = readFileSync('src/webmcp/browser/entry.ts', 'utf8');
    const production = readFileSync('src/webmcp/server/production.ts', 'utf8');
    expect(registration).toContain("tool_names: ['start_case', 'get_case_state', 'submit_turn']");
    expect(browserEntry).toContain('document as Document');
    expect(browserEntry).not.toContain('navigator.modelContext');
    expect(browserEntry).toContain('pageActionController.abort()');
    expect(browserEntry).toContain('if (actionSignal.aborted) return;');
    expect(production).not.toMatch(/allowlist|cohort|shadow rollout/iu);
  });

  it('contains no P3, payment, escrow, identity-upgrade, or WebAuthn activation dependency', () => {
    const source = [
      readFileSync('src/webmcp/server/production.ts', 'utf8'),
      readFileSync('src/v2-1-2/production-first-party.ts', 'utf8'),
      readFileSync('src/v2-1-2/production-case-service.ts', 'utf8'),
    ].join('\n');
    expect(source).not.toMatch(/stripe|escrow|release_funds|jury model|webauthn|gmail/iu);
  });
});
