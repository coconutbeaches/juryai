import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  parseConfirmPersonARecordArgs,
  runConfirmPersonARecordCommand,
  type ConfirmPersonARecordCommandDependencies,
} from '../commands/confirm-person-a-record.js';
import {
  applyPersonAClarificationAnswers,
  hashPersonAClarificationArtifact,
  type PersonAClarificationAnswerApplicationResult,
} from '../runtime/person-a-clarification-answer-application.js';
import {
  buildPersonAConfirmationPackage,
  confirmPersonARecord,
  derivePersonAChallengeId,
  PERSON_A_CONFIRMATION_SUBMISSION_VERSION,
  type PersonARecordChallenge,
} from '../runtime/person-a-record-confirmation.js';
import {
  orchestratePersonAPlanning,
  type PersonARuntimePlanningResult,
} from '../runtime/person-a-runtime-orchestrator.js';
import { createStaticRuntimeAssessmentProvider } from '../runtime/static-assessment-provider.js';
import { validPersonAExtraction } from './person-a-test-helpers.js';

type JsonObject = Record<string, any>;

function context(): {
  record: JsonObject;
  plan: PersonARuntimePlanningResult;
  application: PersonAClarificationAnswerApplicationResult;
} {
  const record = validPersonAExtraction();
  const plan = orchestratePersonAPlanning({
    extraction: record,
    narrative: record.submission.raw_text,
    assessmentProvider: createStaticRuntimeAssessmentProvider([]),
  });
  expect(plan.audit_summary.final_status).toBe('passed');
  const application = applyPersonAClarificationAnswers({
    baseline: plan.repaired_extraction,
    runtimePlan: plan,
    answers: [],
  });
  expect(application.audit.final_status).toBe('passed');
  return { record, plan, application };
}

function confirmedSubmission(
  plan: PersonARuntimePlanningResult,
  application: PersonAClarificationAnswerApplicationResult,
) {
  const amended = application.amended_record!;
  const confirmationPackage = buildPersonAConfirmationPackage({
    runtimePlan: plan,
    answerApplication: application,
    amendedRecord: amended,
  });
  return {
    version: PERSON_A_CONFIRMATION_SUBMISSION_VERSION,
    outcome: 'confirmed',
    confirmation_package_id: confirmationPackage.package_id,
    amended_record_hash: application.amended_record_hash!,
    explicit_confirmation: true,
  } as const;
}

function challenge(
  application: PersonAClarificationAnswerApplicationResult,
  overrides: Partial<Omit<PersonARecordChallenge, 'challenge_id'>> = {},
): PersonARecordChallenge {
  const amended = application.amended_record as JsonObject;
  const body = {
    target_object_id: amended.timeline[0].event_id,
    target_path: '/timeline/0/event_summary',
    category: 'incorrect_value' as const,
    explanation: 'This summary attributes more certainty than I supplied.',
    expected_prior_value: amended.timeline[0].event_summary,
    ...overrides,
  };
  return { challenge_id: derivePersonAChallengeId(body), ...body };
}

function challengedSubmission(
  plan: PersonARuntimePlanningResult,
  application: PersonAClarificationAnswerApplicationResult,
  challenges: PersonARecordChallenge[],
) {
  const confirmed = confirmedSubmission(plan, application);
  const { explicit_confirmation: _ignored, ...binding } = confirmed;
  return { ...binding, outcome: 'challenged' as const, challenges };
}

function challengeWithRawGrounding(
  application: PersonAClarificationAnswerApplicationResult,
  groundingReference: unknown,
  overrides: Partial<Omit<PersonARecordChallenge, 'challenge_id' | 'grounding_reference'>> = {},
): PersonARecordChallenge {
  const base = challenge(application, overrides);
  const { challenge_id: _ignored, ...baseBody } = base;
  const body = { ...baseBody, grounding_reference: groundingReference };
  return {
    challenge_id: derivePersonAChallengeId(
      body as unknown as Omit<PersonARecordChallenge, 'challenge_id'>,
    ),
    ...body,
  } as unknown as PersonARecordChallenge;
}

describe('Person A confirmation package', () => {
  it('is deterministic, detached, reviewable, and exactly bound to all record identities', () => {
    const { plan, application } = context();
    const amended = application.amended_record!;
    const first = buildPersonAConfirmationPackage({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: amended,
    });
    const second = buildPersonAConfirmationPackage({
      runtimePlan: structuredClone(plan),
      answerApplication: structuredClone(application),
      amendedRecord: structuredClone(amended),
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.identities).toMatchObject({
      original_extraction_hash: application.original_extraction_hash,
      repaired_record_hash: application.repaired_baseline_hash,
      amended_record_hash: application.amended_record_hash,
    });
    expect(first.review_record).toMatchObject({
      timeline: amended.timeline,
      evidence: amended.evidence,
      desired_outcomes: amended.desired_outcomes,
      extraction_issues: amended.extraction_issues,
    });
    (first.review_record.extraction_issues as JsonObject[])[0]!.description = 'changed';
    expect((amended.extraction_issues as JsonObject[])[0]!.description).not.toBe('changed');
    const packageDescription = (second.review_record.extraction_issues as JsonObject[])[0]!
      .description;
    (amended.extraction_issues as JsonObject[])[0]!.description = 'source changed later';
    expect((second.review_record.extraction_issues as JsonObject[])[0]!.description).toBe(
      packageDescription,
    );
  });

  it('changes package identity when a material extraction issue changes', () => {
    const { plan, application } = context();
    const amended = structuredClone(application.amended_record!) as JsonObject;
    const original = buildPersonAConfirmationPackage({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: amended,
    });
    amended.extraction_issues[0].description = `${amended.extraction_issues[0].description} Corrected by Person A.`;
    const changedApplication = structuredClone(application);
    changedApplication.amended_record = amended;
    changedApplication.amended_record_hash = hashPersonAClarificationArtifact(amended);
    const changed = buildPersonAConfirmationPackage({
      runtimePlan: plan,
      answerApplication: changedApplication,
      amendedRecord: amended,
    });
    expect(changed.package_id).not.toBe(original.package_id);
  });

  it('has no production dependency on golden, evaluation, alignment, network, or OpenAI modules', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/runtime/person-a-record-confirmation.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"].*(?:golden|evaluation|alignment|openai)/iu);
    expect(source).not.toMatch(/\bfetch\s*\(|OPENAI_API_KEY|https?:\/\//u);
  });
});

describe('Person A confirmation and challenge outcomes', () => {
  it('accepts only explicit confirmation of the exact current package and record', () => {
    const { record, plan, application } = context();
    const before = [JSON.stringify(record), JSON.stringify(plan), JSON.stringify(application)];
    const first = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: application.amended_record,
      submission: confirmedSubmission(plan, application),
    });
    const second = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: application.amended_record,
      submission: confirmedSubmission(plan, application),
    });
    expect(first.status).toBe('confirmed');
    expect(first.challenges).toEqual([]);
    expect(first.audit).toMatchObject({
      package_binding_valid: true,
      record_binding_valid: true,
      amended_record_valid: true,
      original_input_unchanged: true,
      repaired_input_unchanged: true,
      amended_input_unchanged: true,
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect([JSON.stringify(record), JSON.stringify(plan), JSON.stringify(application)]).toEqual(
      before,
    );
  });

  it.each([
    ['actor', '/timeline/0/actor_party_id', 'wrong_actor_attribution'],
    ['date', '/timeline/0/date', 'wrong_date_event_association'],
    ['uncertainty', '/timeline/0/event_summary', 'omitted_uncertainty'],
    ['evidence', '/evidence/0/availability_status', 'incorrect_evidence_association_or_status'],
    ['missing information', '/extraction_issues/0/description', 'missing_material_information'],
    ['remedy', '/desired_outcomes/outcomes/0/rationale', 'incorrect_requested_remedy'],
  ])('accepts an exact %s challenge', (_label, path, category) => {
    const { plan, application } = context();
    const amended = application.amended_record as JsonObject;
    const segments = path.slice(1).split('/');
    let value: any = amended;
    for (const segment of segments)
      value = value[Number.isInteger(Number(segment)) ? Number(segment) : segment];
    const family = path.startsWith('/evidence/')
      ? amended.evidence
      : path.startsWith('/extraction_issues/')
        ? amended.extraction_issues
        : path.startsWith('/desired_outcomes/')
          ? amended.desired_outcomes.outcomes
          : amended.timeline;
    const target = family[0];
    const targetId = target.event_id ?? target.evidence_id ?? target.issue_id ?? target.outcome_id;
    const item = challenge(application, {
      target_object_id: targetId,
      target_path: path,
      category: category as PersonARecordChallenge['category'],
      expected_prior_value: structuredClone(value),
    });
    const result = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: application.amended_record,
      submission: challengedSubmission(plan, application, [item]),
    });
    expect(result.status).toBe('challenged');
    expect(result.challenges).toEqual([item]);
    expect(result.audit).toMatchObject({
      package_binding_valid: true,
      record_binding_valid: true,
    });
  });

  it('accepts multiple challenges atomically and normalizes their order deterministically', () => {
    const { plan, application } = context();
    const amended = application.amended_record as JsonObject;
    const first = challenge(application);
    const evidenceBody = {
      target_object_id: amended.evidence[0].evidence_id,
      target_path: '/evidence/0/availability_status',
      category: 'incorrect_evidence_association_or_status' as const,
      explanation: 'The availability status is not accurate.',
      expected_prior_value: amended.evidence[0].availability_status,
    };
    const second = { challenge_id: derivePersonAChallengeId(evidenceBody), ...evidenceBody };
    const result = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: application.amended_record,
      submission: challengedSubmission(plan, application, [first, second].reverse()),
    });
    expect(result.status).toBe('challenged');
    expect(result.challenges.map((item) => item.target_path)).toEqual([
      '/evidence/0/availability_status',
      '/timeline/0/event_summary',
    ]);
  });

  it('normalizes an exact source-span grounding into a detached canonical challenge', () => {
    const { plan, application } = context();
    const amended = application.amended_record as JsonObject;
    const target = amended.timeline[0];
    const span = target.source_spans[0];
    const grounding = {
      kind: 'source_span' as const,
      object_id: target.event_id,
      submission_id: span.submission_id,
      quote: span.quote,
      start_char: span.start_char,
      end_char: span.end_char,
    };
    const valid = challenge(application, {
      category: 'contradiction_with_supplied_source',
      grounding_reference: grounding,
    });
    const accepted = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: application.amended_record,
      submission: challengedSubmission(plan, application, [valid]),
    });
    expect(accepted.status).toBe('challenged');
    expect(Object.keys(accepted.challenges[0]!.grounding_reference!)).toEqual([
      'kind',
      'object_id',
      'submission_id',
      'quote',
      'start_char',
      'end_char',
    ]);
    expect(accepted.challenges[0]!.grounding_reference).toEqual(grounding);
    expect(accepted.challenges[0]!.grounding_reference).not.toBe(grounding);
    const acceptedBeforeMutation = JSON.stringify(accepted);
    const repeated = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: application.amended_record,
      submission: challengedSubmission(plan, application, [valid]),
    });
    expect(JSON.stringify(repeated)).toBe(acceptedBeforeMutation);
    grounding.quote = 'mutated after confirmation';
    expect(JSON.stringify(accepted)).toBe(acceptedBeforeMutation);
    const { challenge_id: _ignored, ...normalizedBody } = accepted.challenges[0]!;
    expect(accepted.challenges[0]!.challenge_id).toBe(derivePersonAChallengeId(normalizedBody));
  });

  it('rejects missing or target-incompatible source grounding', () => {
    const { plan, application } = context();
    const amended = application.amended_record as JsonObject;
    const target = amended.timeline[0];
    const span = target.source_spans[0];
    const grounding = {
      kind: 'source_span' as const,
      object_id: target.event_id,
      submission_id: span.submission_id,
      quote: span.quote,
      start_char: span.start_char,
      end_char: span.end_char,
    };
    const valid = challenge(application, {
      category: 'contradiction_with_supplied_source',
      grounding_reference: grounding,
    });
    for (const broken of [
      { ...valid, grounding_reference: undefined },
      { ...valid, grounding_reference: { ...grounding, object_id: 'unknown' } },
    ]) {
      const rejected = confirmPersonARecord({
        runtimePlan: plan,
        answerApplication: application,
        amendedRecord: application.amended_record,
        submission: challengedSubmission(plan, application, [broken as PersonARecordChallenge]),
      });
      expect(rejected.status).toBe('invalid');
      expect(rejected.challenges).toEqual([]);
    }
  });

  it.each([
    ['string', 'timeline', 0, 'event_id', 'event_summary'],
    ['number', 'desired_outcomes.outcomes', 0, 'outcome_id', 'priority'],
    ['boolean', 'claims', 0, 'claim_id', 'requires_clarification'],
    ['null', 'timeline', 0, 'event_id', 'actor_third_party_id'],
  ])(
    'accepts and normalizes a canonical extracted-object %s primitive',
    (_label, familyPath, index, idField, field) => {
      const { plan, application } = context();
      const amended = application.amended_record as JsonObject;
      const parts = familyPath.split('.');
      let family: JsonObject = amended;
      for (const part of parts) family = family[part];
      const target = family[index];
      const familyPointer = `/${parts.join('/')}`;
      const grounding = {
        kind: 'extracted_object' as const,
        object_id: target[idField],
        field,
        value: target[field],
      };
      const item = challenge(application, {
        target_object_id: target[idField],
        target_path: `${familyPointer}/${index}/${field}`,
        expected_prior_value: target[field],
        grounding_reference: grounding,
      });
      const input = {
        runtimePlan: plan,
        answerApplication: application,
        amendedRecord: application.amended_record,
        submission: challengedSubmission(plan, application, [item]),
      };
      const first = confirmPersonARecord(input);
      const second = confirmPersonARecord(input);
      expect(first.status).toBe('challenged');
      expect(first.challenges[0]!.grounding_reference).toEqual(grounding);
      expect(Object.keys(first.challenges[0]!.grounding_reference!)).toEqual([
        'kind',
        'object_id',
        'field',
        'value',
      ]);
      const { challenge_id: _ignored, ...normalizedBody } = first.challenges[0]!;
      expect(first.challenges[0]!.challenge_id).toBe(derivePersonAChallengeId(normalizedBody));
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    },
  );
});

describe('Person A confirmation fails closed', () => {
  it.each([
    [
      'missing application.amendments',
      (_plan: JsonObject, application: JsonObject) => delete application.amendments,
    ],
    [
      'non-array application.amendments',
      (_plan: JsonObject, application: JsonObject) => (application.amendments = {}),
    ],
    [
      'missing runtimePlan.unresolved_material_gaps',
      (plan: JsonObject) => delete plan.unresolved_material_gaps,
    ],
    [
      'non-array runtimePlan.unresolved_material_gaps',
      (plan: JsonObject) => (plan.unresolved_material_gaps = 'invalid'),
    ],
    [
      'missing runtimePlan.suppressed_candidates',
      (plan: JsonObject) => delete plan.suppressed_candidates,
    ],
    [
      'non-array runtimePlan.suppressed_candidates',
      (plan: JsonObject) => (plan.suppressed_candidates = null),
    ],
  ])('rejects %s before package construction', (_label, mutate) => {
    const { plan, application } = context();
    const submission = confirmedSubmission(plan, application);
    const malformedPlan = structuredClone(plan) as unknown as JsonObject;
    const malformedApplication = structuredClone(application) as unknown as JsonObject;
    mutate(malformedPlan, malformedApplication);
    const input = {
      runtimePlan: malformedPlan,
      answerApplication: malformedApplication,
      amendedRecord: application.amended_record,
      submission,
    };
    const first = confirmPersonARecord(input);
    const second = confirmPersonARecord(input);
    expect(first).toEqual(
      expect.objectContaining({
        status: 'invalid',
        confirmation_package: null,
        confirmation_package_id: null,
        challenges: [],
      }),
    );
    expect(first.diagnostics).toEqual([expect.objectContaining({ code: 'invalid_package_input' })]);
    expect(first.audit.challenges_accepted).toBe(0);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('rejects structurally unsafe upstream arrays through the invalid-result path', () => {
    const variants: {
      name: string;
      build(): { value: unknown[]; reads?: () => number };
    }[] = [
      {
        name: 'sparse',
        build: () => ({ value: new Array(1) }),
      },
      {
        name: 'accessor-backed',
        build: () => {
          let reads = 0;
          const value: unknown[] = [];
          Object.defineProperty(value, '0', {
            enumerable: true,
            get: () => {
              reads += 1;
              return {};
            },
          });
          return { value, reads: () => reads };
        },
      },
      {
        name: 'cyclic',
        build: () => {
          const value: unknown[] = [];
          value.push(value);
          return { value };
        },
      },
      {
        name: 'custom-prototype',
        build: () => {
          const value: unknown[] = [];
          Object.setPrototypeOf(value, null);
          return { value };
        },
      },
    ];
    for (const variant of variants) {
      const { plan, application } = context();
      const malformed = structuredClone(application) as unknown as JsonObject;
      const built = variant.build();
      malformed.amendments = built.value;
      const run = () =>
        confirmPersonARecord({
          runtimePlan: plan,
          answerApplication: malformed,
          amendedRecord: application.amended_record,
          submission: confirmedSubmission(plan, application),
        });
      const first = run();
      const second = run();
      expect(first.status, variant.name).toBe('invalid');
      expect(first.confirmation_package, variant.name).toBeNull();
      expect(first.challenges, variant.name).toEqual([]);
      expect(first.audit.challenges_accepted, variant.name).toBe(0);
      expect(JSON.stringify(first), variant.name).toBe(JSON.stringify(second));
      expect(built.reads?.() ?? 0, variant.name).toBe(0);
    }
  });

  it.each([
    [
      'stale package',
      (submission: JsonObject) => (submission.confirmation_package_id = '0'.repeat(64)),
      false,
      false,
    ],
    [
      'stale record',
      (submission: JsonObject) => (submission.amended_record_hash = '0'.repeat(64)),
      true,
      false,
    ],
    [
      'malformed hash',
      (submission: JsonObject) => (submission.amended_record_hash = 'bad'),
      false,
      false,
    ],
    [
      'not explicit',
      (submission: JsonObject) => (submission.explicit_confirmation = false),
      true,
      true,
    ],
    ['both outcomes', (submission: JsonObject) => (submission.challenges = []), true, true],
    ['neither outcome', (submission: JsonObject) => delete submission.outcome, true, true],
  ])(
    'rejects %s with the binding stages proven before failure',
    (_label, mutate, packageBindingValid, recordBindingValid) => {
      const { plan, application } = context();
      const submission: JsonObject = structuredClone(confirmedSubmission(plan, application));
      mutate(submission);
      const result = confirmPersonARecord({
        runtimePlan: plan,
        answerApplication: application,
        amendedRecord: application.amended_record,
        submission,
      });
      expect(result.status).toBe('invalid');
      expect(result.challenges).toEqual([]);
      expect(result.audit).toMatchObject({
        package_binding_valid: packageBindingValid,
        record_binding_valid: recordBindingValid,
      });
    },
  );

  it.each([
    ['unknown target', { target_object_id: 'unknown' }],
    ['invalid path', { target_path: '/timeline/999/summary' }],
    ['forbidden path', { target_path: '/metadata/model' }],
    ['unsupported category', { category: 'general_dissatisfaction' }],
    ['stale value', { expected_prior_value: 'stale' }],
    ['malformed id', { challenge_id: 'challenge_1' }],
  ])('rejects %s with atomic zero acceptance', (_label, patch) => {
    const { plan, application } = context();
    const good = challenge(application);
    const bad = { ...good, ...patch };
    if (!('challenge_id' in patch)) {
      const { challenge_id: _ignored, ...body } = bad;
      bad.challenge_id = derivePersonAChallengeId(
        body as Omit<PersonARecordChallenge, 'challenge_id'>,
      );
    }
    const result = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: application.amended_record,
      submission: challengedSubmission(plan, application, [good, bad as PersonARecordChallenge]),
    });
    expect(result.status).toBe('invalid');
    expect(result.challenges).toEqual([]);
    expect(result.audit).toMatchObject({
      package_binding_valid: true,
      record_binding_valid: true,
      challenges_accepted: 0,
    });
  });

  it('fails closed for an unknown extraction-issue ID or path', () => {
    const { plan, application } = context();
    const amended = application.amended_record as JsonObject;
    const valid = challenge(application, {
      target_object_id: amended.extraction_issues[0].issue_id,
      target_path: '/extraction_issues/0/description',
      category: 'missing_material_information',
      expected_prior_value: amended.extraction_issues[0].description,
    });
    for (const patch of [
      { target_object_id: 'issue_unknown' },
      { target_path: '/extraction_issues/999/description' },
    ]) {
      const invalid = { ...valid, ...patch };
      const { challenge_id: _ignored, ...body } = invalid;
      invalid.challenge_id = derivePersonAChallengeId(body);
      const result = confirmPersonARecord({
        runtimePlan: plan,
        answerApplication: application,
        amendedRecord: application.amended_record,
        submission: challengedSubmission(plan, application, [invalid]),
      });
      expect(result.status).toBe('invalid');
      expect(result.challenges).toEqual([]);
      expect(result.audit.challenges_accepted).toBe(0);
    }
  });

  it('atomically rejects non-canonical or nested grounding payloads', () => {
    const { plan, application } = context();
    const amended = application.amended_record as JsonObject;
    const timeline = amended.timeline[0];
    const span = timeline.source_spans[0];
    const canonicalSource = {
      kind: 'source_span' as const,
      object_id: timeline.event_id,
      submission_id: span.submission_id,
      quote: span.quote,
      start_char: span.start_char,
      end_char: span.end_char,
    };
    const canonicalExtracted = {
      kind: 'extracted_object' as const,
      object_id: timeline.event_id,
      field: 'event_summary',
      value: timeline.event_summary,
    };
    const valid = challenge(application, {
      category: 'contradiction_with_supplied_source',
      grounding_reference: canonicalSource,
    });
    const oversizedNestedValue = 'x'.repeat(500_000);
    const malformed = [
      challengeWithRawGrounding(
        application,
        { ...canonicalSource, extra_key: 'unsupported' },
        { category: 'contradiction_with_supplied_source' },
      ),
      challengeWithRawGrounding(
        application,
        { ...canonicalSource, metadata: { nested: { value: 'unsupported' } } },
        { category: 'contradiction_with_supplied_source' },
      ),
      challengeWithRawGrounding(application, {
        ...canonicalExtracted,
        extra_key: true,
      }),
      challengeWithRawGrounding(
        application,
        {
          kind: 'extracted_object',
          object_id: timeline.event_id,
          field: 'date',
          value: timeline.date,
        },
        {
          target_path: '/timeline/0/date',
          expected_prior_value: timeline.date,
        },
      ),
      challengeWithRawGrounding(
        application,
        {
          kind: 'extracted_object',
          object_id: timeline.event_id,
          field: 'asserted_by_party_ids',
          value: timeline.asserted_by_party_ids,
        },
        {
          target_path: '/timeline/0/asserted_by_party_ids',
          expected_prior_value: timeline.asserted_by_party_ids,
        },
      ),
      challengeWithRawGrounding(
        application,
        {
          ...canonicalSource,
          metadata: { payload: oversizedNestedValue },
        },
        { category: 'contradiction_with_supplied_source' },
      ),
      challengeWithRawGrounding(application, {
        ...canonicalExtracted,
        field: 'actor_party_id',
        value: timeline.actor_party_id,
      }),
    ];
    for (const invalid of malformed) {
      const input = {
        runtimePlan: plan,
        answerApplication: application,
        amendedRecord: application.amended_record,
        submission: challengedSubmission(plan, application, [valid, invalid]),
      };
      const first = confirmPersonARecord(input);
      const second = confirmPersonARecord(input);
      const serialized = JSON.stringify(first);
      expect(first.status).toBe('invalid');
      expect(first.challenges).toEqual([]);
      expect(first.audit).toMatchObject({
        package_binding_valid: true,
        record_binding_valid: true,
        challenges_accepted: 0,
      });
      expect(JSON.stringify(first.diagnostics).length).toBeLessThan(2_000);
      expect(serialized.includes(oversizedNestedValue)).toBe(false);
      expect(serialized).toBe(JSON.stringify(second));
    }
    const nonJsonGrounding = challengeWithRawGrounding(application, {
      ...canonicalExtracted,
      value: Number.NaN,
    });
    const nonJsonResult = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: application.amended_record,
      submission: challengedSubmission(plan, application, [nonJsonGrounding]),
    });
    expect(nonJsonResult.status).toBe('invalid');
    expect(nonJsonResult.diagnostics).toEqual([expect.objectContaining({ code: 'invalid_input' })]);
    expect(nonJsonResult.audit).toMatchObject({
      package_binding_valid: false,
      record_binding_valid: false,
      challenges_accepted: 0,
    });
  });

  it('rejects unsafe grounding object shapes without invoking accessors', () => {
    const variants: {
      name: string;
      build(base: JsonObject): { grounding: JsonObject; reads?: () => number };
    }[] = [
      {
        name: 'custom prototype',
        build: (base) => {
          Object.setPrototypeOf(base, { custom: true });
          return { grounding: base };
        },
      },
      {
        name: 'accessor',
        build: (base) => {
          let reads = 0;
          Object.defineProperty(base, 'metadata', {
            enumerable: true,
            get: () => {
              reads += 1;
              return 'unsupported';
            },
          });
          return { grounding: base, reads: () => reads };
        },
      },
      {
        name: 'cycle',
        build: (base) => {
          base.metadata = base;
          return { grounding: base };
        },
      },
      {
        name: 'sparse nested array',
        build: (base) => {
          base.metadata = new Array(1);
          return { grounding: base };
        },
      },
    ];
    for (const variant of variants) {
      const { plan, application } = context();
      const amended = application.amended_record as JsonObject;
      const target = amended.timeline[0];
      const built = variant.build({
        kind: 'extracted_object',
        object_id: target.event_id,
        field: 'event_summary',
        value: target.event_summary,
      });
      const submitted = challenge(application);
      (submitted as unknown as JsonObject).grounding_reference = built.grounding;
      const result = confirmPersonARecord({
        runtimePlan: plan,
        answerApplication: application,
        amendedRecord: application.amended_record,
        submission: challengedSubmission(plan, application, [submitted]),
      });
      expect(result.status, variant.name).toBe('invalid');
      expect(result.challenges, variant.name).toEqual([]);
      expect(built.reads?.() ?? 0, variant.name).toBe(0);
    }
  });

  it.each([
    ['extremely large', 'x'.repeat(1_000_000)],
    ['valid prefix with excessive length', `pach_${'a'.repeat(100_000)}`],
    ['Unicode', 'pach_éééééééééééééééééééééééé'],
  ])('bounds diagnostics for an %s malformed challenge ID', (_label, malformedId) => {
    const { plan, application } = context();
    const malformed = { ...challenge(application), challenge_id: malformedId };
    const submission = challengedSubmission(plan, application, [challenge(application), malformed]);
    const input = {
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: application.amended_record,
      submission,
    };
    const first = confirmPersonARecord(input);
    const second = confirmPersonARecord(input);
    const serialized = JSON.stringify(first);
    expect(first.status).toBe('invalid');
    expect(first.challenges).toEqual([]);
    expect(first.audit.challenges_accepted).toBe(0);
    expect(first.diagnostics.every((item) => item.challenge_id === null)).toBe(true);
    expect(JSON.stringify(first.diagnostics).length).toBeLessThan(2_000);
    expect(serialized.includes(malformedId)).toBe(false);
    expect(serialized.length).toBeLessThan(250_000);
    expect(serialized).toBe(JSON.stringify(second));
  });

  it('retains an exactly valid challenge ID in applicable diagnostics', () => {
    const { plan, application } = context();
    const invalid = challenge(application, { target_object_id: 'unknown_target' });
    const result = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: application.amended_record,
      submission: challengedSubmission(plan, application, [invalid]),
    });
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.some((item) => item.challenge_id === invalid.challenge_id)).toBe(
      true,
    );
  });

  it('rejects duplicate IDs, duplicate target/category, empty challenges, and oversized audit input', () => {
    const { plan, application } = context();
    const good = challenge(application);
    for (const challenges of [[], [good, good], Array.from({ length: 51 }, () => good)]) {
      const result = confirmPersonARecord({
        runtimePlan: plan,
        answerApplication: application,
        amendedRecord: application.amended_record,
        submission: challengedSubmission(plan, application, challenges),
      });
      expect(result.status).toBe('invalid');
      expect(result.challenges).toEqual([]);
      expect(result.diagnostics.length).toBeLessThanOrEqual(20);
      expect(result.audit).toMatchObject({
        package_binding_valid: true,
        record_binding_valid: true,
        challenges_accepted: 0,
      });
    }
  });

  it('rejects a malformed application or amended record without partial state', () => {
    const { plan, application } = context();
    const submission = confirmedSubmission(plan, application);
    const brokenApplication = structuredClone(application);
    brokenApplication.audit.final_status = 'failed_closed';
    const first = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: brokenApplication,
      amendedRecord: application.amended_record,
      submission,
    });
    const brokenRecord = structuredClone(application.amended_record) as JsonObject;
    brokenRecord.schema_version = 'unknown';
    const second = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: brokenRecord,
      submission,
    });
    expect([first.status, second.status]).toEqual(['invalid', 'invalid']);
  });

  it('rejects accessor-backed and aliased input snapshots without invoking accessors', () => {
    const { plan, application } = context();
    let reads = 0;
    const submission = structuredClone(confirmedSubmission(plan, application)) as JsonObject;
    Object.defineProperty(submission, 'explicit_confirmation', {
      enumerable: true,
      get: () => {
        reads += 1;
        return true;
      },
    });
    const result = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: application.amended_record,
      submission,
    });
    expect(result.status).toBe('invalid');
    expect(reads).toBe(0);
    expect(result.challenges).toEqual([]);
  });
});

describe('Person A confirmation CLI', () => {
  const argv = [
    '--runtime-plan',
    'runtime-plan.json',
    '--answer-application',
    'answer-application.json',
    '--amended-record',
    'amended-record.json',
    '--submission',
    'confirmation.json',
    '--output',
    'output/confirmation-result.json',
  ];

  it('strictly parses only the documented explicit local paths', async () => {
    expect(parseConfirmPersonARecordArgs(argv)).toMatchObject({
      runtimePlan: expect.stringMatching(/runtime-plan\.json$/u),
      output: expect.stringMatching(/confirmation-result\.json$/u),
    });
    const readText = vi.fn();
    await expect(
      runConfirmPersonARecordCommand([...argv, '--network', 'yes'], {
        readText,
        writeText: vi.fn(),
        makeDirectory: vi.fn(),
        confirm: vi.fn(),
      }),
    ).rejects.toThrow(/Unknown option/u);
    expect(readText).not.toHaveBeenCalled();
  });

  it('writes one deterministic result and never overwrites by default', async () => {
    const { plan, application } = context();
    const values = [
      plan,
      application,
      application.amended_record,
      confirmedSubmission(plan, application),
    ].map((value) => JSON.stringify(value));
    let readIndex = 0;
    const writes = new Map<string, string>();
    const dependencies: ConfirmPersonARecordCommandDependencies = {
      readText: vi.fn(async () => values[readIndex++]!),
      writeText: vi.fn(async (path, contents) => {
        writes.set(path, contents);
      }),
      makeDirectory: vi.fn(async () => undefined),
      confirm: confirmPersonARecord,
    };
    const result = await runConfirmPersonARecordCommand(argv, dependencies);
    expect(result.status).toBe('confirmed');
    expect(writes.size).toBe(1);
    expect([...writes.values()][0]).toBe(`${JSON.stringify(result, null, 2)}\n`);
  });

  it('writes byte-identical failure JSON and exits non-zero for malformed upstream input', () => {
    const { plan, application } = context();
    const malformedApplication = structuredClone(application) as unknown as JsonObject;
    delete malformedApplication.amendments;
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'juryai-confirmation-cli-'));
    try {
      const paths = {
        plan: join(temporaryDirectory, 'runtime-plan.json'),
        application: join(temporaryDirectory, 'answer-application.json'),
        amended: join(temporaryDirectory, 'amended-record.json'),
        submission: join(temporaryDirectory, 'submission.json'),
        first: join(temporaryDirectory, 'failure-1.json'),
        second: join(temporaryDirectory, 'failure-2.json'),
      };
      writeFileSync(paths.plan, JSON.stringify(plan));
      writeFileSync(paths.application, JSON.stringify(malformedApplication));
      writeFileSync(paths.amended, JSON.stringify(application.amended_record));
      writeFileSync(paths.submission, JSON.stringify(confirmedSubmission(plan, application)));
      const run = (output: string) =>
        spawnSync(
          process.execPath,
          [
            '--import',
            'tsx',
            resolve(process.cwd(), 'src/commands/confirm-person-a-record.ts'),
            '--runtime-plan',
            paths.plan,
            '--answer-application',
            paths.application,
            '--amended-record',
            paths.amended,
            '--submission',
            paths.submission,
            '--output',
            output,
          ],
          { cwd: process.cwd(), encoding: 'utf8' },
        );
      const firstRun = run(paths.first);
      const secondRun = run(paths.second);
      expect([firstRun.status, secondRun.status]).toEqual([2, 2]);
      const first = readFileSync(paths.first, 'utf8');
      const second = readFileSync(paths.second, 'utf8');
      expect(first).toBe(second);
      const result = JSON.parse(first);
      expect(result).toMatchObject({
        status: 'invalid',
        confirmation_package: null,
        confirmation_package_id: null,
        challenges: [],
        diagnostics: [{ code: 'invalid_package_input' }],
        audit: { challenges_accepted: 0, final_status: 'failed_closed' },
      });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('accepts both checked Dry Run 001 confirmation fixtures', () => {
    const load = (name: string) =>
      JSON.parse(readFileSync(resolve(process.cwd(), 'src/fixtures', name), 'utf8'));
    const extraction = load('dry_run_001.person_a.saved_v3.extraction.json');
    const assessments = load('dry_run_001.person_a.runtime_assessments.json').assessments;
    const answerBatch = load('dry_run_001.person_a.runtime_answers.json');
    const plan = orchestratePersonAPlanning({
      extraction,
      narrative: readFileSync(
        resolve(process.cwd(), 'src/fixtures/dry_run_001.person_a.txt'),
        'utf8',
      ),
      assessmentProvider: createStaticRuntimeAssessmentProvider(assessments),
    });
    const application = applyPersonAClarificationAnswers({
      baseline: plan.repaired_extraction,
      runtimePlan: plan,
      answers: answerBatch.answers,
      options: {},
    });
    for (const name of [
      'dry_run_001.person_a.confirmation.json',
      'dry_run_001.person_a.challenges.json',
    ]) {
      const result = confirmPersonARecord({
        runtimePlan: plan,
        answerApplication: application,
        amendedRecord: application.amended_record,
        submission: load(name),
      });
      expect(result.status).not.toBe('invalid');
    }
  });
});
