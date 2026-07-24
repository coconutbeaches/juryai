import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    });
    (first.review_record.timeline as JsonObject[])[0]!.summary = 'changed';
    expect((amended.timeline as JsonObject[])[0]!.summary).not.toBe('changed');
  });

  it('changes package identity when material amended-record content changes', () => {
    const { plan, application } = context();
    const amended = structuredClone(application.amended_record!) as JsonObject;
    const original = buildPersonAConfirmationPackage({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: amended,
    });
    amended.timeline[0].summary = `${amended.timeline[0].summary} corrected`;
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

  it('accepts exact source-grounded conflict and rejects missing or incompatible grounding', () => {
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
});

describe('Person A confirmation fails closed', () => {
  it.each([
    [
      'stale package',
      (submission: JsonObject) => (submission.confirmation_package_id = '0'.repeat(64)),
    ],
    ['stale record', (submission: JsonObject) => (submission.amended_record_hash = '0'.repeat(64))],
    ['malformed hash', (submission: JsonObject) => (submission.amended_record_hash = 'bad')],
    ['not explicit', (submission: JsonObject) => (submission.explicit_confirmation = false)],
    ['both outcomes', (submission: JsonObject) => (submission.challenges = [])],
    ['neither outcome', (submission: JsonObject) => delete submission.outcome],
  ])('rejects %s', (_label, mutate) => {
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
  });

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
    expect(result.audit.challenges_accepted).toBe(0);
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
