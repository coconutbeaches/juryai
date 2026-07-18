import { describe, expect, it } from 'vitest';
import { validateCaseRecordFile } from '../validation/validate-case-record.js';
import { projectRoot } from './test-helpers.js';
import { resolve } from 'node:path';

describe('Dry Run 001 golden fixture command path', () => {
  it('validates with zero JSON Schema or invariant errors', async () => {
    const result = await validateCaseRecordFile(
      resolve(projectRoot, 'src/fixtures/dry_run_001.golden.json'),
    );
    expect(result).toEqual({ valid: true, schemaErrors: [], invariantErrors: [] });
  });
});
