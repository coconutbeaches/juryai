import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  parsePlanPersonARuntimeArgs,
  runPlanPersonARuntimeCommand,
  type PlanPersonARuntimeCommandDependencies,
} from '../commands/plan-person-a-runtime.js';
import type { EpistemicAssessment } from '../clarification/question-generator.js';
import { repairPersonAExtraction } from '../repair/person-a-record-repair.js';
import {
  MAX_RUNTIME_ASSESSMENT_BATCH_SIZE,
  MAX_RUNTIME_ASSESSMENT_JSON_NODES,
  MAX_RUNTIME_ASSESSMENT_NESTED_ARRAY_LENGTH,
  MAX_RUNTIME_ASSESSMENT_OBJECT_KEYS,
  orchestratePersonAPlanning,
  type RuntimeAssessmentContext,
  type RuntimeAssessmentProvider,
} from '../runtime/person-a-runtime-orchestrator.js';
import { createStaticRuntimeAssessmentProvider } from '../runtime/static-assessment-provider.js';
import { validPersonAExtraction } from './person-a-test-helpers.js';

type JsonObject = Record<string, any>;

function fixture() {
  const extraction = validPersonAExtraction();
  return { extraction, narrative: extraction.submission.raw_text as string };
}

function assessment(overrides: Partial<EpistemicAssessment> = {}): EpistemicAssessment {
  const result: EpistemicAssessment = {
    target_object_id: 'ev_001',
    target_family: 'evidence',
    field: 'availability_status',
    trigger: 'evidence_availability',
    materiality: 'high',
    evidence_availability: 'described_only',
    question_context: 'signed website agreement',
    resolves_object_ids: ['ev_001'],
    ...overrides,
  };
  for (const [key, value] of Object.entries(result)) {
    if (value === undefined) delete (result as JsonObject)[key];
  }
  return result;
}

function run(assessments: unknown = [assessment()]) {
  const { extraction, narrative } = fixture();
  return {
    extraction,
    narrative,
    result: orchestratePersonAPlanning({
      extraction,
      narrative,
      assessmentProvider: createStaticRuntimeAssessmentProvider(assessments),
    }),
  };
}

function runProviderOutput(providerOutput: unknown) {
  const { extraction, narrative } = fixture();
  return orchestratePersonAPlanning({
    extraction,
    narrative,
    assessmentProvider: { assess: () => providerOutput },
  });
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function addContradiction(extraction: JsonObject): string {
  const first = structuredClone(extraction.claims[0].source_spans[0]);
  const second = structuredClone(extraction.claims[1].source_spans[0]);
  extraction.extraction_issues.push({
    issue_id: 'issue_runtime_contradiction',
    issue_type: 'internal_tension',
    severity: 'major',
    description: 'Two exact statements conflict about material completion.',
    affected_object_ids: [extraction.claims[0].claim_id, extraction.claims[1].claim_id],
    resolution_status: 'open',
    source_spans: [first, second],
  });
  return 'issue_runtime_contradiction';
}

describe('Person A runtime orchestration', () => {
  it('produces a validated repaired record and grounded clarification plan', () => {
    const { result } = run();
    expect(result.audit_summary.final_status).toBe('passed');
    expect(result.audit_summary.original_valid).toBe(true);
    expect(result.audit_summary.repaired_valid).toBe(true);
    expect(result.question_count).toBe(1);
    expect(result.generated_questions[0]?.grounding_references.length).toBeGreaterThan(0);
    expect(result.stage_statuses.every((item) => item.status === 'passed')).toBe(true);
    expect(result.original_extraction_hash).toBe(hashJson(result.original_extraction));
    expect(result.repaired_extraction_hash).toBe(hashJson(result.repaired_extraction));
    expect(result.audit_summary.original_artifact_status).toBe('present_hashed');
    expect(result.audit_summary.repaired_artifact_status).toBe('present_hashed');
  });

  it('preserves the original extraction byte-equivalently and does not mutate provider data', () => {
    const { extraction, narrative } = fixture();
    const originalBytes = JSON.stringify(extraction);
    const assessments = [assessment()];
    const assessmentBytes = JSON.stringify(assessments);
    const result = orchestratePersonAPlanning({
      extraction,
      narrative,
      assessmentProvider: createStaticRuntimeAssessmentProvider(assessments),
    });
    expect(JSON.stringify(extraction)).toBe(originalBytes);
    expect(JSON.stringify(result.original_extraction)).toBe(originalBytes);
    expect(JSON.stringify(assessments)).toBe(assessmentBytes);
    expect(result.audit_summary.original_unchanged).toBe(true);
  });

  it('validates repaired output before assessment', () => {
    const { extraction, narrative } = fixture();
    const assess = vi.fn((_context: RuntimeAssessmentContext) => []);
    const result = orchestratePersonAPlanning(
      { extraction, narrative, assessmentProvider: { assess } },
      {
        validate: (record, text) => {
          if ((record as JsonObject).schema_version === 'broken') {
            return {
              valid: false,
              schemaErrors: [{ path: '$.schema_version', message: 'broken' }],
              invariantErrors: [],
            };
          }
          return { valid: true, schemaErrors: [], invariantErrors: [] };
        },
        repair: (options) => {
          const repaired = repairPersonAExtraction(options);
          repaired.repaired_extraction.schema_version = 'broken';
          return repaired;
        },
        classify: () => {
          throw new Error('classification must not run');
        },
        generate: () => {
          throw new Error('generation must not run');
        },
      },
    );
    expect(assess).not.toHaveBeenCalled();
    expect(result.audit_summary.failure_stage).toBe('repaired_validation');
    expect(result.stage_statuses.find((item) => item.stage === 'assessment')?.status).toBe(
      'skipped',
    );
    expect(result.repaired_extraction).not.toBeNull();
    expect(result.repaired_extraction_hash).toBe(hashJson(result.repaired_extraction));
    expect(result.audit_summary.repaired_artifact_status).toBe('present_invalid');
  });

  it('passes only runtime-safe inputs to the assessment provider', () => {
    const { extraction, narrative } = fixture();
    const assess = vi.fn((_context: RuntimeAssessmentContext) => []);
    orchestratePersonAPlanning({ extraction, narrative, assessmentProvider: { assess } });
    expect(assess).toHaveBeenCalledOnce();
    expect(Object.keys(assess.mock.calls[0]![0]).sort()).toEqual([
      'narrative',
      'original_extraction',
      'repair_audit',
      'repaired_extraction',
    ]);
  });

  it('fails closed with audit context when the provider throws', () => {
    const { extraction, narrative } = fixture();
    const provider: RuntimeAssessmentProvider = {
      assess: () => {
        throw new Error('deterministic provider failure');
      },
    };
    const result = orchestratePersonAPlanning({
      extraction,
      narrative,
      assessmentProvider: provider,
    });
    expect(result.audit_summary.failure_stage).toBe('assessment');
    expect(result.generated_questions).toEqual([]);
    expect(result.repair_result).not.toBeNull();
    expect(result.stage_statuses.find((item) => item.stage === 'assessment')?.errors[0]?.code).toBe(
      'assessment_provider_failed',
    );
  });

  it.each([
    {
      label: 'non-array',
      value: { assessment: assessment() },
      code: 'malformed_assessment_result',
    },
    {
      label: 'missing field',
      value: [{ target_object_id: 'ev_001' }],
      code: 'invalid_assessments',
    },
  ])('fails closed on malformed assessments: $label', ({ value, code }) => {
    const { result } = run(value);
    expect(result.audit_summary.failure_stage).toBe('assessment');
    expect(result.stage_statuses.find((item) => item.stage === 'assessment')?.errors[0]?.code).toBe(
      code,
    );
    expect(result.generated_questions).toEqual([]);
    expect(result.rejected_assessments.length).toBeGreaterThan(0);
  });

  it('fails closed instead of silently dropping non-JSON assessment data', () => {
    const candidate = { ...assessment(), unsupported: undefined };
    const { result } = run([candidate]);
    expect(result.rejected_assessments[0]?.code).toBe('assessment_not_json');
    expect(result.question_count).toBe(0);
  });

  it('rejects a directly self-referential assessment without throwing', () => {
    const candidate = assessment() as JsonObject;
    candidate.self = candidate;
    let result: ReturnType<typeof orchestratePersonAPlanning> | undefined;
    expect(() => {
      result = run([candidate]).result;
    }).not.toThrow();
    expect(result?.rejected_assessments[0]).toMatchObject({
      code: 'assessment_not_json',
      assessment: {
        audit_type: 'rejected_non_json_assessment',
        reason: 'Assessment contains a cyclic object or array.',
      },
    });
    expect(result?.question_count).toBe(0);
    expect(result?.audit_summary.failure_stage).toBe('assessment');
  });

  it('rejects mutually cyclic assessment objects without throwing', () => {
    const candidate = assessment() as JsonObject;
    const peer: JsonObject = { label: 'peer', candidate };
    candidate.peer = peer;
    expect(() => run([candidate])).not.toThrow();
    const { result } = run([candidate]);
    expect(result.rejected_assessments[0]?.code).toBe('assessment_not_json');
    expect(result.rejected_assessments[0]?.message).toContain('cyclic');
    expect(result.generated_questions).toEqual([]);
  });

  it('rejects a cyclic array without throwing', () => {
    const candidate = assessment() as JsonObject;
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    candidate.resolves_object_ids = cyclic;
    const { result } = run([candidate]);
    expect(result.rejected_assessments[0]?.code).toBe('assessment_not_json');
    expect(result.rejected_assessments[0]?.message).toContain('cyclic');
    expect(result.question_count).toBe(0);
  });

  it('rejects provider data beyond the bounded JSON depth without overflowing', () => {
    const { extraction, narrative } = fixture();
    const candidate = assessment() as JsonObject;
    let cursor: JsonObject = candidate;
    for (let depth = 0; depth < 70; depth += 1) {
      cursor.nested = {};
      cursor = cursor.nested;
    }
    const result = orchestratePersonAPlanning({
      extraction,
      narrative,
      assessmentProvider: { assess: () => [candidate] },
    });
    expect(result.rejected_assessments[0]?.code).toBe('assessment_not_json');
    expect(result.rejected_assessments[0]?.message).toContain('maximum JSON depth of 64');
    expect(result.question_count).toBe(0);
  });

  it('accepts ordinary nested JSON arrays in a valid assessment', () => {
    const candidate = assessment({ resolves_object_ids: ['ev_002', 'ev_001'] });
    const { result } = run([candidate]);
    expect(result.audit_summary.final_status).toBe('passed');
    expect(result.validated_assessments[0]?.resolves_object_ids).toEqual(['ev_001', 'ev_002']);
  });

  it.each([
    {
      label: 'function expando',
      build: () => {
        const batch = [assessment()] as unknown[] & JsonObject;
        batch.extra = () => undefined;
        return batch;
      },
    },
    {
      label: 'primitive expando',
      build: () => {
        const batch = [assessment()] as unknown[] & JsonObject;
        batch.extra = 'unexpected';
        return batch;
      },
    },
    {
      label: 'sparse slot',
      build: () => {
        const batch: unknown[] = [];
        batch.length = 2;
        batch[1] = assessment();
        return batch;
      },
    },
    {
      label: 'symbol key',
      build: () => {
        const batch = [assessment()] as unknown[] & JsonObject;
        batch[Symbol('unsafe') as any] = 'unexpected';
        return batch;
      },
    },
    {
      label: 'accessor property',
      build: () => {
        const batch = [assessment()];
        Object.defineProperty(batch, 'unsafe', {
          enumerable: true,
          get: () => {
            throw new Error('batch getter must not execute');
          },
        });
        return batch;
      },
    },
    {
      label: 'unusual prototype',
      build: () => {
        const batch = [assessment()];
        Object.setPrototypeOf(batch, Object.create(Array.prototype));
        return batch;
      },
    },
  ])('rejects a malformed top-level assessment batch: $label', ({ build }) => {
    let result: ReturnType<typeof orchestratePersonAPlanning> | undefined;
    expect(() => {
      result = runProviderOutput(build());
    }).not.toThrow();
    expect(result?.audit_summary.failure_stage).toBe('assessment');
    expect(result?.rejected_assessments[0]?.code).toBe('assessment_not_json');
    expect(result?.question_count).toBe(0);
    expect(result?.generated_questions).toEqual([]);
    expect(result?.necessity_classifications).toEqual([]);
    expect(result?.stage_statuses.find((item) => item.stage === 'necessity')?.status).toBe(
      'skipped',
    );
  });

  it('rejects a cyclic top-level batch without throwing', () => {
    const batch: unknown[] = [];
    batch.push(batch);
    expect(() => runProviderOutput(batch)).not.toThrow();
    const result = runProviderOutput(batch);
    expect(result.rejected_assessments[0]).toMatchObject({
      code: 'assessment_not_json',
      assessment: {
        audit_type: 'rejected_non_json_assessment',
        reason: 'Assessment contains a cyclic object or array.',
      },
    });
    expect(result.question_count).toBe(0);
  });

  it('accepts a dense plain JSON assessment batch', () => {
    const result = runProviderOutput([assessment()]);
    expect(result.audit_summary.final_status).toBe('passed');
    expect(result.rejected_assessments).toEqual([]);
    expect(result.question_count).toBe(1);
  });

  it('fails closed through descriptor inspection without requesting provider map', () => {
    let mapRequested = false;
    const batch = new Proxy([assessment()], {
      get: (target, key, receiver) => {
        if (key === 'map') {
          mapRequested = true;
          throw new Error('provider map must not be requested');
        }
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor: () => {
        throw new Error('descriptor trap failed');
      },
    });
    let result: ReturnType<typeof orchestratePersonAPlanning> | undefined;
    expect(() => {
      result = runProviderOutput(batch);
    }).not.toThrow();
    expect(mapRequested).toBe(false);
    expect(result?.rejected_assessments[0]?.code).toBe('assessment_not_json');
    expect(result?.question_count).toBe(0);
    expect(result?.stage_statuses.find((item) => item.stage === 'necessity')?.status).toBe(
      'skipped',
    );
  });

  it('never uses ordinary map or numeric-index access on a valid Proxy batch', () => {
    const requestedKeys: PropertyKey[] = [];
    const batch = new Proxy([assessment()], {
      get: (_target, key) => {
        requestedKeys.push(key);
        throw new Error(`ordinary provider access is forbidden: ${String(key)}`);
      },
    });
    const result = runProviderOutput(batch);
    expect(result.audit_summary.final_status).toBe('passed');
    expect(result.question_count).toBe(1);
    expect(requestedKeys).toEqual([]);
  });

  it('rejects a Proxy whose own-key report changes during snapshotting', () => {
    const target = [assessment()] as unknown[] & JsonObject;
    Object.defineProperty(target, 'extra', {
      value: 'changing shape',
      enumerable: true,
      configurable: true,
    });
    let ownKeyReads = 0;
    const batch = new Proxy(target, {
      ownKeys: (source) => {
        ownKeyReads += 1;
        return ownKeyReads === 1 ? ['0', 'length'] : Reflect.ownKeys(source);
      },
    });
    const result = runProviderOutput(batch);
    expect(result.rejected_assessments[0]?.message).toContain(
      'properties changed during inspection',
    );
    expect(result.question_count).toBe(0);
  });

  it('rejects a Proxy whose descriptors change during snapshotting', () => {
    const first = assessment();
    const second = assessment({ question_context: 'changed descriptor value' });
    const target = [first];
    let indexDescriptorReads = 0;
    const batch = new Proxy(target, {
      getOwnPropertyDescriptor: (source, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
        if (key !== '0' || !descriptor || !('value' in descriptor)) return descriptor;
        indexDescriptorReads += 1;
        return {
          ...descriptor,
          value: indexDescriptorReads === 1 ? first : second,
        };
      },
    });
    const result = runProviderOutput(batch);
    expect(result.rejected_assessments[0]?.message).toContain(
      'descriptors changed during inspection',
    );
    expect(result.question_count).toBe(0);
  });

  it('rejects a revoked Proxy with a bounded structured audit', () => {
    const revocable = Proxy.revocable([assessment()], {});
    revocable.revoke();
    let result: ReturnType<typeof orchestratePersonAPlanning> | undefined;
    expect(() => {
      result = runProviderOutput(revocable.proxy);
    }).not.toThrow();
    expect(result?.rejected_assessments[0]).toMatchObject({
      code: 'assessment_not_json',
      assessment: {
        audit_type: 'rejected_non_json_assessment',
        value_type: 'uninspectable',
        own_keys: [],
      },
    });
    expect(result?.question_count).toBe(0);
  });

  it('detaches a valid Proxy batch and every nested provider-owned value', () => {
    const candidate = assessment();
    const resolvesObjectIds = candidate.resolves_object_ids!;
    const proxiedCandidate = new Proxy(candidate as JsonObject, {
      get: (_target, key) => {
        throw new Error(`ordinary nested access is forbidden: ${String(key)}`);
      },
    });
    const target = [proxiedCandidate];
    const batch = new Proxy(target, {
      get: (_source, key) => {
        throw new Error(`ordinary batch access is forbidden: ${String(key)}`);
      },
    });
    const result = runProviderOutput(batch);
    expect(result.audit_summary.final_status).toBe('passed');
    expect(result.raw_assessments[0] === proxiedCandidate).toBe(false);
    expect((result.raw_assessments[0] as JsonObject).resolves_object_ids).not.toBe(
      resolvesObjectIds,
    );
    expect(result.validated_assessments[0]).not.toBe(candidate);

    const resultBytes = JSON.stringify(result);
    candidate.question_context = 'mutated after orchestration';
    resolvesObjectIds.push('ev_002');
    target.push(assessment({ target_object_id: 'ev_002' }));
    expect(JSON.stringify(result)).toBe(resultBytes);
  });

  it('does not retain references to a mutable plain provider batch', () => {
    const candidate = assessment();
    const batch = [candidate];
    const result = runProviderOutput(batch);
    const resultBytes = JSON.stringify(result);
    candidate.question_context = 'changed after return';
    candidate.resolves_object_ids?.push('ev_002');
    batch.push(assessment({ target_object_id: 'ev_002' }));
    expect(JSON.stringify(result)).toBe(resultBytes);
  });

  it('returns byte-identical output for repeated valid Proxy snapshots', () => {
    const execute = () =>
      runProviderOutput(
        new Proxy([assessment()], {
          get: (_target, key) => {
            throw new Error(`ordinary access is forbidden: ${String(key)}`);
          },
        }),
      );
    expect(JSON.stringify(execute())).toBe(JSON.stringify(execute()));
  });

  it('rejects a huge sparse batch length before proportional allocation', () => {
    const batch: unknown[] = [];
    batch.length = 2 ** 32 - 1;
    const result = runProviderOutput(batch);
    expect(result.rejected_assessments[0]?.message).toContain(
      `supported limit of ${MAX_RUNTIME_ASSESSMENT_BATCH_SIZE}`,
    );
    expect(result.question_count).toBe(0);
  });

  it('rejects a huge dense-like declared batch length before key materialization', () => {
    const batch: unknown[] = [];
    batch[2 ** 32 - 2] = assessment();
    const result = runProviderOutput(batch);
    expect(result.rejected_assessments[0]?.message).toContain(
      `supported limit of ${MAX_RUNTIME_ASSESSMENT_BATCH_SIZE}`,
    );
    expect(result.question_count).toBe(0);
  });

  it('accepts the maximum assessment batch size and rejects one above it', () => {
    const maximum = Array.from({ length: MAX_RUNTIME_ASSESSMENT_BATCH_SIZE }, (_, index) =>
      assessment({ question_context: `signed website agreement item ${index + 1}` }),
    );
    const accepted = runProviderOutput(maximum);
    expect(accepted.audit_summary.final_status).toBe('passed');
    expect(accepted.audit_summary.assessments_received).toBe(MAX_RUNTIME_ASSESSMENT_BATCH_SIZE);

    const rejected = runProviderOutput([...maximum, assessment()]);
    expect(rejected.rejected_assessments[0]?.message).toContain(
      `supported limit of ${MAX_RUNTIME_ASSESSMENT_BATCH_SIZE}`,
    );
    expect(rejected.question_count).toBe(0);
  });

  it('accepts the nested array limit and rejects one above it', () => {
    const maximum = assessment({
      resolves_object_ids: Array.from(
        { length: MAX_RUNTIME_ASSESSMENT_NESTED_ARRAY_LENGTH },
        () => 'ev_001',
      ),
    });
    const accepted = runProviderOutput([maximum]);
    expect(accepted.audit_summary.final_status).toBe('passed');

    const rejected = runProviderOutput([
      assessment({
        resolves_object_ids: Array.from(
          { length: MAX_RUNTIME_ASSESSMENT_NESTED_ARRAY_LENGTH + 1 },
          () => 'ev_001',
        ),
      }),
    ]);
    expect(rejected.rejected_assessments[0]?.message).toContain(
      `supported limit of ${MAX_RUNTIME_ASSESSMENT_NESTED_ARRAY_LENGTH}`,
    );
    expect(rejected.question_count).toBe(0);
  });

  it('enforces the bounded object own-key limit before semantic validation', () => {
    const candidate = assessment() as JsonObject;
    for (let index = 0; index < MAX_RUNTIME_ASSESSMENT_OBJECT_KEYS; index += 1) {
      candidate[`extra_${index}`] = index;
    }
    const result = runProviderOutput([candidate]);
    expect(result.rejected_assessments[0]?.message).toContain(
      `own-key limit of ${MAX_RUNTIME_ASSESSMENT_OBJECT_KEYS}`,
    );
    expect(
      (result.rejected_assessments[0]?.assessment as JsonObject).own_keys.length,
    ).toBeLessThanOrEqual(20);
    expect(result.question_count).toBe(0);
  });

  it('enforces the total provider JSON traversal budget', () => {
    const batch = Array.from({ length: MAX_RUNTIME_ASSESSMENT_BATCH_SIZE }, (_, index) =>
      assessment({
        question_context: `signed website agreement item ${index + 1}`,
        resolves_object_ids: Array.from({ length: 100 }, () => 'ev_001'),
      }),
    );
    const result = runProviderOutput(batch);
    expect(result.rejected_assessments[0]?.message).toContain(
      `maximum JSON traversal size of ${MAX_RUNTIME_ASSESSMENT_JSON_NODES}`,
    );
    expect(result.question_count).toBe(0);
  });

  it('returns byte-identical audit output for repeated oversized batches', () => {
    const build = () => {
      const batch: unknown[] = [];
      batch.length = MAX_RUNTIME_ASSESSMENT_BATCH_SIZE + 1;
      return runProviderOutput(batch);
    };
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it.each([
    ['getter', 'getter'],
    ['unusual prototype', 'prototype'],
    ['symbol key', 'symbol'],
    ['function', 'function'],
    ['bigint', 'bigint'],
    ['undefined', 'undefined'],
    ['NaN', 'nan'],
    ['Infinity', 'infinity'],
  ])('rejects non-JSON provider value: %s', (_label, variant) => {
    const candidate = assessment() as JsonObject;
    if (variant === 'getter') {
      Object.defineProperty(candidate, 'unsafe', {
        enumerable: true,
        get: () => {
          throw new Error('getter must not execute');
        },
      });
    } else if (variant === 'prototype') {
      Object.setPrototypeOf(candidate, { inherited: true });
    } else if (variant === 'symbol') {
      candidate[Symbol('unsafe') as any] = 'value';
    } else if (variant === 'function') candidate.unsafe = () => undefined;
    else if (variant === 'bigint') candidate.unsafe = 1n;
    else if (variant === 'undefined') candidate.unsafe = undefined;
    else if (variant === 'nan') candidate.unsafe = Number.NaN;
    else candidate.unsafe = Number.POSITIVE_INFINITY;
    const { extraction, narrative } = fixture();
    const result = orchestratePersonAPlanning({
      extraction,
      narrative,
      assessmentProvider: { assess: () => [candidate] },
    });
    expect(result.audit_summary.failure_stage).toBe('assessment');
    expect(result.rejected_assessments[0]?.code).toBe('assessment_not_json');
    expect(result.generated_questions).toEqual([]);
  });

  it('fails closed when an assessment references an unknown object', () => {
    const { result } = run([assessment({ target_object_id: 'ev_missing' })]);
    expect(result.rejected_assessments[0]?.code).toBe('unknown_target_object');
    expect(result.question_count).toBe(0);
  });

  it('fails closed on an unsupported assessment field', () => {
    const { result } = run([assessment({ field: 'uploaded_at' })]);
    expect(result.rejected_assessments[0]?.code).toBe('incompatible_assessment_target');
    expect(result.question_count).toBe(0);
  });

  it('rejects actor attribution on an evidence object', () => {
    const { result } = run([
      assessment({
        field: 'actor_party_id',
        trigger: 'actor_attribution',
        actor_attribution: 'unstated',
        evidence_availability: undefined,
      }),
    ]);
    expect(result.rejected_assessments[0]?.code).toBe('incompatible_assessment_target');
    expect(result.generated_questions).toEqual([]);
  });

  it('rejects evidence availability on a claim', () => {
    const { result } = run([
      assessment({
        target_object_id: 'cl_a_001',
        target_family: 'claims',
        resolves_object_ids: ['cl_a_001'],
      }),
    ]);
    expect(result.rejected_assessments[0]?.code).toBe('incompatible_assessment_target');
    expect(result.generated_questions).toEqual([]);
  });

  it('rejects date precision on an object without a date field', () => {
    const { result } = run([
      assessment({
        field: 'date',
        trigger: 'date_precision',
        date_precision: 'unknown',
        evidence_availability: undefined,
      }),
    ]);
    expect(result.rejected_assessments[0]?.code).toBe('incompatible_assessment_target');
    expect(result.generated_questions).toEqual([]);
  });

  it('rejects declared-family versus resolved-family mismatch', () => {
    const { result } = run([assessment({ target_family: 'claims' })]);
    expect(result.rejected_assessments[0]?.code).toBe('target_family_mismatch');
    expect(result.generated_questions).toEqual([]);
  });

  it('accepts actor attribution on a schema-supported timeline field', () => {
    const { result } = run([
      assessment({
        target_object_id: 'tl_agreement',
        target_family: 'timeline',
        field: 'actor_party_id',
        trigger: 'actor_attribution',
        actor_attribution: 'unstated',
        evidence_availability: undefined,
        question_context: 'the early-April agreement action',
        resolves_object_ids: ['tl_agreement'],
      }),
    ]);
    expect(result.audit_summary.final_status).toBe('passed');
    expect(result.validated_assessments).toHaveLength(1);
    expect(result.rejected_assessments).toEqual([]);
  });

  it('rejects a compatible field when the resolved target shape omits it', () => {
    const { extraction, narrative } = fixture();
    const candidate = assessment({
      target_object_id: 'tl_agreement',
      target_family: 'timeline',
      field: 'actor_party_id',
      trigger: 'actor_attribution',
      actor_attribution: 'unstated',
      evidence_availability: undefined,
      question_context: 'the early-April agreement action',
      resolves_object_ids: ['tl_agreement'],
    });
    const result = orchestratePersonAPlanning(
      {
        extraction,
        narrative,
        assessmentProvider: createStaticRuntimeAssessmentProvider([candidate]),
      },
      {
        validate: () => ({ valid: true, schemaErrors: [], invariantErrors: [] }),
        repair: (options) => {
          const repaired = repairPersonAExtraction(options);
          const event = repaired.repaired_extraction.timeline.find(
            (item: JsonObject) => item.event_id === 'tl_agreement',
          );
          delete event.actor_party_id;
          return repaired;
        },
        classify: vi.fn(),
        generate: vi.fn(),
      },
    );
    expect(result.rejected_assessments[0]?.code).toBe('assessment_field_missing');
    expect(result.generated_questions).toEqual([]);
  });

  it('accepts actor attribution on a schema-supported claim field', () => {
    const { result } = run([
      assessment({
        target_object_id: 'cl_a_001',
        target_family: 'claims',
        field: 'party_id',
        trigger: 'actor_attribution',
        actor_attribution: 'explicit',
        evidence_availability: undefined,
        question_context: 'the website agreement claim',
        resolves_object_ids: ['cl_a_001'],
      }),
    ]);
    expect(result.audit_summary.final_status).toBe('passed');
    expect(result.validated_assessments).toHaveLength(1);
    expect(result.suppressed_candidates[0]?.classification).toBe('already_explicit');
  });

  it('accepts evidence availability only on evidence availability_status', () => {
    const { result } = run([assessment()]);
    expect(result.audit_summary.final_status).toBe('passed');
    expect(result.validated_assessments).toHaveLength(1);
    expect(result.generated_questions).toHaveLength(1);
  });

  it('fails the entire assessment batch atomically when one candidate is invalid', () => {
    const valid = assessment();
    const invalid = assessment({
      target_object_id: 'cl_a_001',
      target_family: 'claims',
      resolves_object_ids: ['cl_a_001'],
    });
    const { result } = run([valid, invalid]);
    expect(result.audit_summary.failure_stage).toBe('assessment');
    expect(result.validated_assessments).toHaveLength(1);
    expect(result.rejected_assessments).toHaveLength(1);
    expect(result.generated_questions).toEqual([]);
    expect(result.necessity_classifications).toEqual([]);
    expect(result.stage_statuses.find((item) => item.stage === 'necessity')?.status).toBe(
      'skipped',
    );
  });

  it('fails closed on duplicate assessments', () => {
    const candidate = assessment();
    const { result } = run([candidate, structuredClone(candidate)]);
    expect(result.rejected_assessments[0]?.code).toBe('duplicate_assessment');
    expect(result.question_count).toBe(0);
  });

  it('suppresses an otherwise valid candidate with insufficient grounding', () => {
    const { result } = run([assessment({ question_context: undefined })]);
    expect(result.audit_summary.final_status).toBe('passed');
    expect(result.question_count).toBe(0);
    expect(result.suppressed_candidates[0]?.classification).toBe('insufficient_grounding');
  });

  it('never exposes internal representation work as a question', () => {
    const { result } = run([
      assessment({
        field: 'title',
        trigger: 'internal_representation',
        evidence_availability: undefined,
        question_context: undefined,
      }),
    ]);
    expect(result.question_count).toBe(0);
    expect(result.suppressed_candidates[0]?.classification).toBe('internal_representation');
  });

  it('suppresses facts whose evidence availability is already explicit', () => {
    const { result } = run([
      assessment({
        target_object_id: 'ev_009',
        evidence_availability: 'unavailable',
        question_context: 'two unrecorded video calls',
        resolves_object_ids: ['ev_009'],
      }),
    ]);
    expect(result.question_count).toBe(0);
    expect(result.suppressed_candidates[0]?.classification).toBe('already_explicit');
  });

  it('generates one contextual question for a grounded contradiction', () => {
    const { extraction, narrative } = fixture();
    const issueId = addContradiction(extraction);
    const result = orchestratePersonAPlanning({
      extraction,
      narrative,
      assessmentProvider: createStaticRuntimeAssessmentProvider([
        assessment({
          target_object_id: issueId,
          target_family: 'extraction_issues',
          field: 'required_information',
          trigger: 'required_bucket_missing',
          evidence_availability: undefined,
          question_context: 'what remained incomplete',
          resolves_object_ids: [issueId],
        }),
      ]),
    });
    expect(result.question_count).toBe(1);
    expect(result.generated_questions[0]?.necessity_classification).toBe('contradiction');
    expect(result.generated_questions[0]?.contradiction_alternatives).toHaveLength(2);
  });

  it('never generates more than six questions', () => {
    const candidates = Array.from({ length: 8 }, (_, index) =>
      assessment({
        target_object_id: `ev_00${index + 1}`,
        question_context: `evidence item ${index + 1}`,
        resolves_object_ids: [`ev_00${index + 1}`],
      }),
    );
    const { result } = run(candidates);
    expect(result.question_count).toBe(6);
    expect(result.unresolved_material_gaps).toHaveLength(8);
  });

  it('accepts a valid zero-question plan', () => {
    const { result } = run([]);
    expect(result.audit_summary.final_status).toBe('passed');
    expect(result.question_count).toBe(0);
    expect(result.generated_questions).toEqual([]);
  });

  it('fails closed if necessity classification cannot safely classify', () => {
    const { extraction, narrative } = fixture();
    const result = orchestratePersonAPlanning(
      {
        extraction,
        narrative,
        assessmentProvider: createStaticRuntimeAssessmentProvider([assessment()]),
      },
      {
        validate: () => ({ valid: true, schemaErrors: [], invariantErrors: [] }),
        repair: repairPersonAExtraction,
        classify: () => {
          throw new Error('unsafe classifier state');
        },
        generate: () => [],
      },
    );
    expect(result.audit_summary.failure_stage).toBe('necessity');
    expect(result.generated_questions).toEqual([]);
  });

  it('fails closed if generated question grounding is invalid', () => {
    const { extraction, narrative } = fixture();
    const result = orchestratePersonAPlanning(
      {
        extraction,
        narrative,
        assessmentProvider: createStaticRuntimeAssessmentProvider([assessment()]),
      },
      {
        validate: () => ({ valid: true, schemaErrors: [], invariantErrors: [] }),
        repair: repairPersonAExtraction,
        classify: (assessments) => ({
          necessity_classification: [
            {
              assessment: assessments[0]!,
              classification: 'ask_human',
              reason: 'test',
              grounding_references: [],
              contradiction_alternatives: [],
            },
          ],
          question_candidates: [
            {
              assessment: assessments[0]!,
              classification: 'ask_human',
              reason: 'test',
              grounding_references: [],
              contradiction_alternatives: [],
            },
          ],
          suppressed_candidates: [],
        }),
        generate: () => [
          {
            question_id: 'clarification_01',
            target_object_id: 'ev_001',
            target_family: 'evidence',
            field: 'availability_status',
            trigger: 'evidence_availability',
            materiality: 'high',
            question: 'Groundless question',
            phase: 'pre_lock',
            resolves_object_ids: ['ev_001'],
            necessity_classification: 'ask_human',
            grounding_references: [],
            contradiction_alternatives: [],
          },
        ],
      },
    );
    expect(result.audit_summary.failure_stage).toBe('clarification');
    expect(result.generated_questions).toEqual([]);
  });

  it('is stable across assessment input order and repeated execution', () => {
    const candidates = [
      assessment(),
      assessment({
        target_object_id: 'ev_002',
        question_context: 'deposit invoice and payment receipt',
        resolves_object_ids: ['ev_002'],
      }),
    ];
    const forward = run(candidates).result;
    const reverse = run([...candidates].reverse()).result;
    const repeated = run(candidates).result;
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reverse));
    expect(JSON.stringify(forward)).toBe(JSON.stringify(repeated));
  });

  it('keeps aggregate split audit records internal and preserves aggregate objects', () => {
    const { extraction, narrative } = fixture();
    const aggregate = extraction.deliverable_assessments[0];
    aggregate.name = 'Homepage and About page';
    const before = JSON.stringify(aggregate);
    const result = orchestratePersonAPlanning({
      extraction,
      narrative,
      assessmentProvider: createStaticRuntimeAssessmentProvider([]),
    });
    expect(
      result.repair_result?.skipped_repairs.some(
        (item) => item.rule_id === 'aggregate_split_unsupported_v0_1_2',
      ),
    ).toBe(true);
    expect(
      JSON.stringify(
        result.repaired_extraction?.deliverable_assessments.find(
          (item: JsonObject) => item.deliverable_id === aggregate.deliverable_id,
        ),
      ),
    ).toBe(before);
    expect(result.question_count).toBe(0);
  });

  it('prevents repair when the original extraction is invalid', () => {
    const { extraction, narrative } = fixture();
    extraction.schema_version = 'invalid';
    const repair = vi.fn(repairPersonAExtraction);
    const dependencies = {
      validate: () => ({
        valid: false,
        schemaErrors: [{ path: '$.schema_version', message: 'invalid' }],
        invariantErrors: [],
      }),
      repair,
      classify: vi.fn(),
      generate: vi.fn(),
    } as any;
    const result = orchestratePersonAPlanning(
      { extraction, narrative, assessmentProvider: createStaticRuntimeAssessmentProvider([]) },
      dependencies,
    );
    expect(repair).not.toHaveBeenCalled();
    expect(result.audit_summary.failure_stage).toBe('original_validation');
    expect(result.repaired_extraction).toBeNull();
    expect(result.repaired_extraction_hash).toBeNull();
    expect(result.original_extraction_hash).toBeNull();
    expect(result.audit_summary.original_artifact_status).toBe('present_invalid');
    expect(result.audit_summary.repaired_artifact_status).toBe('absent');
  });

  it('returns no fake repaired hash when repair throws', () => {
    const { extraction, narrative } = fixture();
    const result = orchestratePersonAPlanning(
      { extraction, narrative, assessmentProvider: createStaticRuntimeAssessmentProvider([]) },
      {
        validate: () => ({ valid: true, schemaErrors: [], invariantErrors: [] }),
        repair: () => {
          throw new Error('repair failed before artifact creation');
        },
        classify: vi.fn(),
        generate: vi.fn(),
      },
    );
    expect(result.audit_summary.failure_stage).toBe('repair');
    expect(result.original_extraction_hash).toBe(hashJson(result.original_extraction));
    expect(result.repaired_extraction).toBeNull();
    expect(result.repaired_extraction_hash).toBeNull();
    expect(result.audit_summary.original_artifact_status).toBe('present_hashed');
    expect(result.audit_summary.repaired_artifact_status).toBe('absent');
  });

  it('keeps result fields internally consistent across success and failure paths', () => {
    const successful = run().result;
    const failedAssessment = run([
      assessment({
        target_object_id: 'cl_a_001',
        target_family: 'claims',
        resolves_object_ids: ['cl_a_001'],
      }),
    ]).result;
    for (const result of [successful, failedAssessment]) {
      expect(result.question_count).toBe(result.generated_questions.length);
      expect(
        result.suppressed_candidates.every(
          (candidate) => typeof candidate.reason === 'string' && candidate.reason.length > 0,
        ),
      ).toBe(true);
      const failedIndex = result.stage_statuses.findIndex(
        (item) => item.status === 'failed_closed',
      );
      if (failedIndex >= 0) {
        expect(
          result.stage_statuses.slice(failedIndex + 1).every((item) => item.status === 'skipped'),
        ).toBe(true);
      }
    }
    expect(failedAssessment.audit_summary.failure_stage).toBe('assessment');
    expect(failedAssessment.generated_questions).toEqual([]);
    expect(failedAssessment.necessity_classifications).toEqual([]);
  });

  it('does not apply answers, amendments, or mutate persistent state', () => {
    const { result } = run();
    expect(JSON.stringify(result)).not.toMatch(/applied_amendment|clarification_answer|durable/iu);
    expect(result.generated_questions.every((question) => question.phase === 'pre_lock')).toBe(
      true,
    );
  });
});

describe('runtime dependency boundary', () => {
  it('contains no runtime imports of laboratory, artifact, or model modules', () => {
    const runtimeDirectory = resolve(process.cwd(), 'src/runtime');
    const sources = [
      ...readdirSync(runtimeDirectory)
        .filter((name) => name.endsWith('.ts'))
        .map((name) => readFileSync(resolve(runtimeDirectory, name), 'utf8')),
      readFileSync(resolve(process.cwd(), 'src/clarification/question-necessity.ts'), 'utf8'),
      readFileSync(resolve(process.cwd(), 'src/commands/plan-person-a-runtime.ts'), 'utf8'),
    ].join('\n');
    expect(sources).not.toMatch(
      /from\s+['"][^'"]*(?:evaluation|alignment|golden|artifacts|openai)[^'"]*['"]/iu,
    );
    expect(sources).not.toMatch(/['"](?:\.\.\/)*artifacts\/|live-run-[0-9]/iu);
    expect(sources).not.toMatch(/OPENAI_API_KEY|process\.env|new\s+OpenAI/iu);
  });
});

describe('offline runtime planning CLI', () => {
  const validArgs = [
    '--input',
    'input.txt',
    '--extraction',
    'extraction.json',
    '--assessments',
    'assessments.json',
    '--output-dir',
    'output',
  ];

  it.each([
    ['unknown', [...validArgs, '--extracton', 'wrong.json'], 'Unknown option: --extracton'],
    ['duplicate', [...validArgs, '--extraction', 'again.json'], 'Duplicate option: --extraction'],
    ['missing value', ['--input', '--extraction', 'value'], 'Missing value for --input'],
    ['positional', [...validArgs, 'extra'], 'Unexpected positional or short argument: extra'],
    ['short option', ['-i', 'input.txt'], 'Unexpected positional or short argument: -i'],
  ])('rejects %s arguments before any I/O or orchestration', async (_label, argv, message) => {
    const readText = vi.fn<PlanPersonARuntimeCommandDependencies['readText']>();
    const orchestrate = vi.fn<PlanPersonARuntimeCommandDependencies['orchestrate']>();
    await expect(
      runPlanPersonARuntimeCommand(argv, {
        readText,
        orchestrate,
        makeDirectory: vi.fn(),
        writeText: vi.fn(),
      }),
    ).rejects.toThrow(message);
    expect(readText).not.toHaveBeenCalled();
    expect(orchestrate).not.toHaveBeenCalled();
  });

  it('parses a complete invocation without environment or client setup', () => {
    expect(parsePlanPersonARuntimeArgs(validArgs)).toMatchObject({
      input: expect.stringMatching(/input\.txt$/u),
      extraction: expect.stringMatching(/extraction\.json$/u),
      assessments: expect.stringMatching(/assessments\.json$/u),
      outputDir: expect.stringMatching(/output$/u),
    });
  });

  it('writes deterministic offline artifacts without network or model setup', async () => {
    const { extraction, narrative } = fixture();
    const writes = new Map<string, string>();
    const dependencies: PlanPersonARuntimeCommandDependencies = {
      readText: async (path) => {
        if (path.endsWith('input.txt')) return narrative;
        if (path.endsWith('extraction.json')) return JSON.stringify(extraction);
        if (path.endsWith('assessments.json')) return JSON.stringify([assessment()]);
        throw new Error(`Unexpected read: ${path}`);
      },
      writeText: async (path, value) => {
        writes.set(path, value);
      },
      makeDirectory: async () => undefined,
      orchestrate: orchestratePersonAPlanning,
    };
    const first = await runPlanPersonARuntimeCommand(validArgs, dependencies);
    const firstWrites = [...writes.entries()].sort();
    writes.clear();
    const second = await runPlanPersonARuntimeCommand(validArgs, dependencies);
    expect(first.audit_summary.final_status).toBe('passed');
    expect(first.question_count).toBe(1);
    expect([...writes.entries()].sort()).toEqual(firstWrites);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(firstWrites.map(([path]) => path.split('/').at(-1))).toEqual(
      expect.arrayContaining([
        'runtime-plan.json',
        'original-extraction.json',
        'repaired-extraction.json',
        'repair-audit.json',
        'assessments.json',
        'necessity-classifications.json',
        'clarification-questions.json',
        'suppressed-candidates.json',
        'orchestration-audit.json',
      ]),
    );
  });
});
