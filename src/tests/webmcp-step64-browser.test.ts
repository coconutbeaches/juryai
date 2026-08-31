import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BrowserShellController,
  type BrowserShellState,
  type BrowserShellView,
} from '../webmcp/browser/shell-controller.js';
import type { ParsedFirstPartyReview } from '../webmcp/browser/review-contract.js';
import type { CaseServicePort } from '../webmcp/public-contract.js';
import { PUBLIC_CASE_STATE } from './webmcp-browser-test-fixtures.js';

const ACCEPTED = {
  authenticated: true,
  disclosure: { required: false, version: 'server-owned-version' },
};

function document(caseVersion: number): string {
  return [
    'JURYAI CANONICAL READ-BACK',
    'format: juryai-readback-v0.3.0',
    'template: juryai-canonical-account-render-v0.3.0',
    'case: case_dr002',
    `version: ${caseVersion}`,
    '',
    '[REQUIREMENT req_account]',
    'prompt:',
    'What account are you giving JuryAI?',
    '.',
    'status: "satisfied"',
    'satisfying_types: ["narrative_fact"]',
    'min_propositions: 1',
    'max_propositions: null',
    'adverse_fact_probe: false',
    'reopened_from: null',
    '[/REQUIREMENT]',
    '',
    '[NON_ANSWER_RECAP]',
    'heading:',
    'Things you said you do not know, do not remember, or chose not to answer',
    '.',
    'proposition_ids: []',
    '[/NON_ANSWER_RECAP]',
    '',
  ].join('\n');
}

function review(
  version: number,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    case_id: 'case_dr002',
    case_version: version,
    status: 'draft',
    render_template_version: 'juryai-canonical-account-render-v0.3.0',
    document: document(version),
    document_hash: String(version).padStart(64, 'a').slice(-64),
    attestation_contract_version: 'juryai-webmcp-attestation-v0.3.0',
    adoption_statement: 'I have read this JuryAI account and adopt it.',
    adoption_statement_hash: 'b'.repeat(64),
    attestable: true,
    blocking_reasons: [],
    challenge: `${String(version).slice(-1)}${'C'.repeat(42)}`,
    ...overrides,
  };
}

function service(): CaseServicePort {
  return {
    startCase: async () => ({ ok: true, case: PUBLIC_CASE_STATE }),
    getCaseState: async () => ({ ok: true, case: PUBLIC_CASE_STATE }),
    submitTurn: async () => ({
      ok: true,
      turn_id: 'turn_1',
      case: PUBLIC_CASE_STATE,
      recorded: [],
      superseded: [],
    }),
  };
}

function stateView(states: BrowserShellState[]): BrowserShellView {
  return { render: (state) => states.push(state) };
}

function currentReview(states: BrowserShellState[]): ParsedFirstPartyReview {
  const current = states.at(-1);
  if (!current || !('review' in current)) throw new Error('expected current review');
  return current.review;
}

describe('Step 64 browser review lifecycle', () => {
  it('loads the complete review without WebMCP support', async () => {
    const states: BrowserShellState[] = [];
    const calls: string[] = [];
    const controller = new BrowserShellController({
      view: stateView(states),
      reviewCaseId: 'case_dr002',
      getModelContext: () => undefined,
      createCaseService: () => service(),
      fetchImpl: async (input) => {
        calls.push(String(input));
        return String(input) === '/api/juryai/bootstrap'
          ? Response.json(ACCEPTED)
          : Response.json(review(1));
      },
    });
    await controller.initialize();
    expect(calls).toEqual(['/api/juryai/bootstrap', '/api/juryai/cases/case_dr002/review']);
    expect(states.at(-1)).toMatchObject({ phase: 'review_ready', webMcp: 'unavailable' });
    expect(currentReview(states).document).toBe(document(1));
  });

  it('keeps exactly the same three WebMCP registrations in review mode', async () => {
    const names: string[] = [];
    const controller = new BrowserShellController({
      view: stateView([]),
      reviewCaseId: 'case_dr002',
      getModelContext: () => ({ registerTool: (tool) => void names.push(tool.name) }),
      createCaseService: () => service(),
      fetchImpl: async (input) =>
        Response.json(String(input) === '/api/juryai/bootstrap' ? ACCEPTED : review(1)),
    });
    await controller.initialize();
    expect(names).toEqual(['start_case', 'get_case_state', 'submit_turn']);
  });

  it('refreshes the whole document and discards the old challenge after correction', async () => {
    const states: BrowserShellState[] = [];
    let reviews = 0;
    let correctionBody: unknown;
    const controller = new BrowserShellController({
      view: stateView(states),
      reviewCaseId: 'case_dr002',
      getModelContext: () => undefined,
      createCaseService: () => service(),
      fetchImpl: async (input, init) => {
        if (String(input) === '/api/juryai/bootstrap') return Response.json(ACCEPTED);
        if (String(input).endsWith('/corrections')) {
          correctionBody = JSON.parse(String(init?.body));
          return Response.json({ ok: true });
        }
        reviews += 1;
        return Response.json(review(reviews));
      },
    });
    await controller.initialize();
    const before = currentReview(states);
    await controller.submitCorrection({
      expected_case_version: before.case_version,
      in_reply_to: ['req_account'],
      client_turn_id: 'client_browser_1',
      disposition: 'correct_meaning',
      target_proposition_id: 'prop_account',
      text: 'Corrected directly.',
      current_review: before,
      webMcp: 'unavailable',
    });
    expect(correctionBody).toEqual({
      expected_case_version: 1,
      in_reply_to: ['req_account'],
      client_turn_id: 'client_browser_1',
      disposition: 'correct_meaning',
      target_proposition_id: 'prop_account',
      text: 'Corrected directly.',
    });
    expect(currentReview(states).case_version).toBe(2);
    expect(currentReview(states).challenge).not.toBe(before.challenge);
    expect(currentReview(states).document).toBe(document(2));
  });

  it('treats stale attestation as a full-review refresh, not a generic error', async () => {
    const states: BrowserShellState[] = [];
    let reviews = 0;
    const controller = new BrowserShellController({
      view: stateView(states),
      reviewCaseId: 'case_dr002',
      getModelContext: () => undefined,
      createCaseService: () => service(),
      fetchImpl: async (input) => {
        if (String(input) === '/api/juryai/bootstrap') return Response.json(ACCEPTED);
        if (String(input).endsWith('/attestations')) {
          return Response.json({ error: { code: 'STALE_REVIEW' } }, { status: 409 });
        }
        reviews += 1;
        return Response.json(review(reviews));
      },
    });
    await controller.initialize();
    await controller.attest(currentReview(states), 'unavailable');
    expect(states.at(-1)).toMatchObject({
      phase: 'review_ready',
      message: expect.stringContaining('complete current account'),
    });
    expect(currentReview(states).case_version).toBe(2);
  });

  it('renders the locked phase after successful attestation', async () => {
    const states: BrowserShellState[] = [];
    let attested = false;
    const controller = new BrowserShellController({
      view: stateView(states),
      reviewCaseId: 'case_dr002',
      getModelContext: () => undefined,
      createCaseService: () => service(),
      fetchImpl: async (input) => {
        if (String(input) === '/api/juryai/bootstrap') return Response.json(ACCEPTED);
        if (String(input).endsWith('/attestations')) {
          attested = true;
          return Response.json({ ok: true });
        }
        return Response.json(
          attested
            ? review(1, {
                status: 'locked',
                attestable: false,
                blocking_reasons: ['already_locked'],
                challenge: null,
              })
            : review(1),
        );
      },
    });
    await controller.initialize();
    await controller.attest(currentReview(states), 'unavailable');
    expect(states.at(-1)).toMatchObject({ phase: 'locked' });
  });

  it('keeps the exact canonical document visibly rendered rather than slicing semantic values', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const entry = readFileSync(new URL('../webmcp/browser/entry.ts', import.meta.url), 'utf8');
    expect(html).toContain('<pre id="canonical-document"></pre>');
    expect(entry).toContain('canonicalDocument.textContent = state.review.document');
    expect(entry).toContain('currentCorrectionTarget = { propositionId: block.id, requirementId }');
    expect(entry).toContain('{ target_proposition_id: targetPropositionId }');
    expect(entry).not.toMatch(/Deadline:|amounts summary|key numbers/iu);
  });
});
