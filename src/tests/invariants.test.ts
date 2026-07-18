import { describe, expect, it } from 'vitest';
import { validateCustomInvariants } from '../validation/custom-invariants.js';
import { clone, loadGolden } from './test-helpers.js';

const hasMessage = (issues: ReturnType<typeof validateCustomInvariants>, text: string) =>
  issues.some((issue) => issue.message.includes(text));

describe('JuryAI custom invariants', () => {
  it('rejects orphaned references', async () => {
    const record = clone(await loadGolden());
    record.claim_evidence_links[0].evidence_id = 'ev_missing';
    const issues = validateCustomInvariants(record);
    expect(hasMessage(issues, "Referenced ID 'ev_missing' does not exist")).toBe(true);
  });

  it('rejects duplicate canonical IDs', async () => {
    const record = clone(await loadGolden());
    record.claims[1].claim_id = record.claims[0].claim_id;
    const issues = validateCustomInvariants(record);
    expect(hasMessage(issues, 'Duplicate canonical ID')).toBe(true);
  });

  it('rejects a recommendation while deliberation is ineligible', async () => {
    const record = clone(await loadGolden());
    record.recommendation = { recommendation_id: 'rec_invalid' };
    const issues = validateCustomInvariants(record);
    expect(hasMessage(issues, 'recommendation cannot exist while deliberation is ineligible')).toBe(
      true,
    );
  });

  it('rejects decision-critical findings that cite uninspected evidence', async () => {
    const record = clone(await loadGolden());
    record.fact_findings.findings.push({
      fact_id: 'fact_invalid',
      text: 'The contract definitely made May 20 a binding deadline.',
      status: 'supported',
      decision_critical: true,
      source_claim_ids: ['cl_b_002'],
      source_evidence_ids: ['ev_001'],
      limitations: [],
    });
    const issues = validateCustomInvariants(record);
    expect(hasMessage(issues, 'Decision-critical findings may cite only inspected evidence')).toBe(
      true,
    );
  });

  it('rejects private settlement-floor fields anywhere in the record', async () => {
    const record = clone(await loadGolden());
    record.desired_outcomes[0].private_settlement_floor = 800;
    const issues = validateCustomInvariants(record);
    expect(hasMessage(issues, 'Private settlement fields are prohibited')).toBe(true);
  });

  it('rejects incorrect financial-envelope calculations', async () => {
    const record = clone(await loadGolden());
    record.case.financial_envelope.gross_disputed_value = 1200;
    const issues = validateCustomInvariants(record);
    expect(hasMessage(issues, 'sum of maximum opposed-direction requests')).toBe(true);
  });

  it('rejects inconsistent schema versions', async () => {
    const record = clone(await loadGolden());
    record.audit.schema_version = '0.1';
    const issues = validateCustomInvariants(record);
    expect(hasMessage(issues, 'must equal root')).toBe(true);
  });

  it('rejects a completed comparison when either evidence item is uninspected', async () => {
    const record = clone(await loadGolden());
    record.evidence_evidence_links[0].comparison_status = 'completed';
    const issues = validateCustomInvariants(record);
    expect(hasMessage(issues, 'completed evidence comparison requires both evidence items')).toBe(
      true,
    );
  });

  it('rejects locking before confirmation or neutral opportunity exhaustion', async () => {
    const record = clone(await loadGolden());
    record.record_review.record_locked_at = '2026-07-18T13:00:00Z';
    record.record_review.record_hash = 'a'.repeat(64);
    const issues = validateCustomInvariants(record);
    expect(hasMessage(issues, 'locked record requires party confirmation')).toBe(true);
    expect(hasMessage(issues, 'required clarification questions remain pending')).toBe(true);
  });

  it('rejects inspection metadata on described-only evidence', async () => {
    const record = clone(await loadGolden());
    record.evidence[0].file_hash = 'b'.repeat(64);
    record.evidence[0].inspected_at = '2026-07-18T13:00:00Z';
    const issues = validateCustomInvariants(record);
    expect(hasMessage(issues, 'cannot carry inspection metadata')).toBe(true);
  });
});
