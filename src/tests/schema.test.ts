import { describe, expect, it } from 'vitest';
import { validateCaseRecord } from '../validation/validate-case-record.js';
import { clone, loadGolden } from './test-helpers.js';

describe('JuryAI JSON Schema', () => {
  it('accepts the canonical Dry Run 001 golden fixture', async () => {
    const result = await validateCaseRecord(await loadGolden());
    expect(result.schemaErrors).toEqual([]);
    expect(result.invariantErrors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects unknown enum values', async () => {
    const record = clone(await loadGolden());
    record.case.status = 'invented_state';
    const result = await validateCaseRecord(record);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.some((error) => error.path === '/case/status')).toBe(true);
  });

  it('rejects missing required fields', async () => {
    const record = clone(await loadGolden());
    delete record.case.currency;
    const result = await validateCaseRecord(record);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.some((error) => error.path === '/case')).toBe(true);
  });

  it('rejects unexpected properties where additionalProperties is false', async () => {
    const record = clone(await loadGolden());
    record.case.legal_conclusion = 'breach of contract';
    const result = await validateCaseRecord(record);
    expect(result.valid).toBe(false);
    expect(
      result.schemaErrors.some(
        (error) => error.path === '/case' && error.message.includes('additional properties'),
      ),
    ).toBe(true);
  });

  it('rejects numeric confidence fields', async () => {
    const record = clone(await loadGolden());
    record.claims[0].model_confidence = 0.91;
    const result = await validateCaseRecord(record);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.some((error) => error.path === '/claims/0')).toBe(true);
  });
});
