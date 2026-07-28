import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRY_RUN_001_COMPATIBILITY_ALIASES,
  alignPersonAForCase,
} from '../alignment/person-a-alignment-corrected.js';
import { evaluatePersonAForCase } from '../evaluation/person-a-diff-corrected.js';
import { parsePersonAModelOutputFromRawResponse } from '../evaluation/person-a-span-diagnostics.js';
import {
  assembleDryRun001ClA003CompatibilityProjection,
  assembleDryRun001CompletionStateCompatibilityProjection,
  assembleDryRun001DeterministicClaimTypeProjection,
} from '../extraction/person-a-frozen-compatibility.js';
import { assemblePersonAExtraction, extractPersonA } from '../extraction/person-a-extractor.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';
import { repairPersonAExtraction } from '../repair/person-a-record-repair.js';

type JsonObject = Record<string, any>;

const root = process.cwd();
const submittedAt = '2026-07-25T00:00:00Z';
const generatedAt = '2026-07-25T13:03:42.000Z';
const model = 'gpt-5.6-sol';
const expectedTypes = new Map([
  ['claim_02_payment_terms', 'agreement_term'],
  ['claim_04_content_dependency', 'delay'],
  ['claim_13_delay_causation', 'delay'],
]);

async function json(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(resolve(root, path), 'utf8')) as JsonObject;
}

async function frozenInputs() {
  const [narrative, golden, rawResponse] = await Promise.all([
    readFile(resolve(root, 'src/fixtures/dry_run_001.person_a.txt'), 'utf8'),
    json('docs/dry-run-001/golden-projection.json'),
    json('docs/dry-run-001/raw-response.json'),
  ]);
  return {
    narrative,
    golden,
    modelOutput: parsePersonAModelOutputFromRawResponse(rawResponse),
  };
}

function projectionOptions(narrative: string) {
  return { narrative, submittedAt, model, generatedAt };
}

function evaluate(extraction: JsonObject, golden: JsonObject, narrative: string) {
  const options = {
    aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
    contractVersion: 'calibrated_live_v2' as const,
  };
  const alignment = alignPersonAForCase(extraction, golden, options);
  return evaluatePersonAForCase(extraction, golden, alignment, {
    ...options,
    narrative,
  });
}

function hash(value: JsonObject): string {
  return createHash('sha256')
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest('hex');
}

describe('Dry Run 001 deterministic claim-type projection', () => {
  it('reproduces the three PR #15 claim-type failures before repair', async () => {
    const { narrative, golden, modelOutput } = await frozenInputs();
    const pr15 = assembleDryRun001CompletionStateCompatibilityProjection(
      modelOutput,
      projectionOptions(narrative),
    );
    const report = evaluate(pr15, golden, narrative);

    expect(report.summary).toMatchObject({ critical: 0, major: 41, minor: 20 });
    expect(
      report.errors
        .filter((error) => error.family === 'claims' && error.code === 'claim_type')
        .map((error) => [error.extracted_id, error.golden_id]),
    ).toEqual([
      ['claim_13_delay_causation', 'cl_a_012'],
      ['claim_02_payment_terms', 'cl_a_001'],
      ['claim_04_content_dependency', 'cl_a_002'],
    ]);
  });

  it('applies exactly the existing audited claim-type repairs', async () => {
    const { narrative, golden, modelOutput } = await frozenInputs();
    const pr15 = assembleDryRun001CompletionStateCompatibilityProjection(
      modelOutput,
      projectionOptions(narrative),
    );
    const repair = repairPersonAExtraction({ extraction: pr15, narrative });
    const projected = assembleDryRun001DeterministicClaimTypeProjection(
      modelOutput,
      projectionOptions(narrative),
    );

    expect(repair.applied_repairs).toHaveLength(3);
    expect(repair.rejected_repairs).toEqual([]);
    expect(
      repair.applied_repairs.map((item) => [
        item.rule_id,
        item.target_object_id,
        item.before,
        item.after,
      ]),
    ).toEqual([
      [
        'deterministic_claim_type_normalization',
        'claim_02_payment_terms',
        'payment',
        'agreement_term',
      ],
      [
        'deterministic_claim_type_normalization',
        'claim_04_content_dependency',
        'client_delay',
        'delay',
      ],
      [
        'deterministic_claim_type_normalization',
        'claim_13_delay_causation',
        'client_delay',
        'delay',
      ],
    ]);
    expect(projected).toEqual(repair.repaired_extraction);
    expect(validatePersonAExtraction(projected, narrative).valid).toBe(true);

    for (const [claimId, expectedType] of expectedTypes) {
      expect(
        projected.claims.find((claim: JsonObject) => claim.claim_id === claimId)?.claim_type,
      ).toBe(expectedType);
    }
    expect(evaluate(projected, golden, narrative).summary).toMatchObject({
      critical: 0,
      major: 38,
      minor: 20,
    });
  });

  it('changes only the three claim_type leaves from the PR #15 projection', async () => {
    const { narrative, modelOutput } = await frozenInputs();
    const before = assembleDryRun001CompletionStateCompatibilityProjection(
      modelOutput,
      projectionOptions(narrative),
    );
    const projected = assembleDryRun001DeterministicClaimTypeProjection(
      modelOutput,
      projectionOptions(narrative),
    );
    const reverted = structuredClone(projected);
    const originalTypes = new Map(
      before.claims.map((claim: JsonObject) => [claim.claim_id, claim.claim_type]),
    );

    for (const claim of reverted.claims) {
      if (expectedTypes.has(claim.claim_id)) claim.claim_type = originalTypes.get(claim.claim_id);
    }
    expect(reverted).toEqual(before);
  });

  it('fails closed if the repair compiler would apply another rule', async () => {
    const { narrative, modelOutput } = await frozenInputs();
    const altered = structuredClone(modelOutput);
    const agreementEvent = altered.timeline.find(
      (event: JsonObject) => event.event_id === 'event_01_agreement',
    );
    agreementEvent.actor_party_id = null;

    expect(() =>
      assembleDryRun001DeterministicClaimTypeProjection(altered, projectionOptions(narrative)),
    ).toThrow(/only deterministic_claim_type_normalization repairs/iu);
  });

  it('preserves earlier projections and deterministic output', async () => {
    const { narrative, modelOutput } = await frozenInputs();
    const pr14 = assembleDryRun001ClA003CompatibilityProjection(
      modelOutput,
      projectionOptions(narrative),
    );
    const pr15 = assembleDryRun001CompletionStateCompatibilityProjection(
      modelOutput,
      projectionOptions(narrative),
    );
    const first = assembleDryRun001DeterministicClaimTypeProjection(
      modelOutput,
      projectionOptions(narrative),
    );
    const second = assembleDryRun001DeterministicClaimTypeProjection(
      modelOutput,
      projectionOptions(narrative),
    );

    expect(hash(pr14)).toBe('d607a8555c2bda66e8b12f80ac47f8bc880b82d90a5f23ca5d9cfd58a0af4c41');
    expect(hash(pr15)).toBe('04b927a7e54be2afccf36f32494afc563c1c7d2d6730611ee74d2c9a961775d3');
    expect(hash(first)).toBe('b24bb43acb4ce29ac626c4b3d75362627500a4ca8449bea7e85c93e906ffbd0b');
    expect(hash(second)).toBe(hash(first));
  });

  it('leaves ordinary assembly, fresh extraction, and provider output unchanged', async () => {
    const { narrative, modelOutput } = await frozenInputs();
    const before = structuredClone(modelOutput);
    const assembled = assemblePersonAExtraction(modelOutput, projectionOptions(narrative));
    const fresh = await extractPersonA({
      ...projectionOptions(narrative),
      client: {
        generate: async () => ({
          output: structuredClone(modelOutput),
          rawResponse: { id: 'offline-test-response' },
        }),
      },
    });

    for (const extraction of [assembled, fresh.extraction]) {
      for (const [claimId] of expectedTypes) {
        expect(
          extraction.claims.find((claim: JsonObject) => claim.claim_id === claimId)?.claim_type,
        ).toBe(
          modelOutput.claims.find((claim: JsonObject) => claim.claim_id === claimId)?.claim_type,
        );
      }
    }
    expect(modelOutput).toEqual(before);
  });
});
