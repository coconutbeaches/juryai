import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseResolvePersonAChallengesArgs,
  runResolvePersonAChallengesCommand,
  type ResolvePersonAChallengesCommandDependencies,
} from '../commands/resolve-person-a-challenges.js';
import {
  applyPersonAClarificationAnswers,
  hashPersonAClarificationArtifact,
  type JsonValue,
  type PersonAClarificationAnswerApplicationResult,
} from '../runtime/person-a-clarification-answer-application.js';
import {
  derivePersonAChallengeResolutionId,
  derivePersonAChallengeSetHash,
  PERSON_A_CHALLENGE_RESOLUTION_REQUEST_VERSION,
  resolvePersonAChallenges,
  type PersonAChallengeResolutionInput,
  type PersonAChallengeResolutionProposal,
  type PersonAChallengeResolutionRequest,
} from '../runtime/person-a-challenge-resolution.js';
import {
  buildPersonAConfirmationPackage,
  confirmPersonARecord,
  derivePersonAChallengeId,
  hashPersonAConfirmationArtifact,
  PERSON_A_CONFIRMATION_SUBMISSION_VERSION,
  type PersonARecordChallenge,
  type PersonARecordConfirmationResult,
} from '../runtime/person-a-record-confirmation.js';
import {
  orchestratePersonAPlanning,
  type PersonARuntimePlanningResult,
} from '../runtime/person-a-runtime-orchestrator.js';
import { createStaticRuntimeAssessmentProvider } from '../runtime/static-assessment-provider.js';
import { validPersonAExtraction } from './person-a-test-helpers.js';

type JsonObject = Record<string, any>;

interface ResolutionContext {
  plan: PersonARuntimePlanningResult;
  application: PersonAClarificationAnswerApplicationResult;
  record: JsonObject;
  challenges: PersonARecordChallenge[];
  confirmationResult: PersonARecordConfirmationResult;
}

function challenge(
  record: JsonObject,
  targetObjectId: string,
  targetPath: string,
  category: PersonARecordChallenge['category'],
  explanation: string,
  expectedPriorValue: JsonValue,
): PersonARecordChallenge {
  const body = {
    target_object_id: targetObjectId,
    target_path: targetPath,
    category,
    explanation,
    expected_prior_value: structuredClone(expectedPriorValue),
  };
  return {
    challenge_id: derivePersonAChallengeId(body),
    ...body,
  } as PersonARecordChallenge;
}

function context(twoChallenges = false): ResolutionContext {
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
  const amended = application.amended_record as JsonObject;
  const challenges = [
    challenge(
      amended,
      amended.timeline[0].event_id,
      '/timeline/0/event_summary',
      'incorrect_value',
      'The summary should use narrower wording.',
      amended.timeline[0].event_summary,
    ),
  ];
  if (twoChallenges) {
    challenges.push(
      challenge(
        amended,
        amended.evidence[0].evidence_id,
        '/evidence/0/availability_status',
        'incorrect_evidence_association_or_status',
        'The described contract is currently unavailable.',
        amended.evidence[0].availability_status,
      ),
    );
  }
  const confirmationPackage = buildPersonAConfirmationPackage({
    runtimePlan: plan,
    answerApplication: application,
    amendedRecord: amended,
  });
  const submission = {
    version: PERSON_A_CONFIRMATION_SUBMISSION_VERSION,
    outcome: 'challenged',
    confirmation_package_id: confirmationPackage.package_id,
    amended_record_hash: application.amended_record_hash!,
    challenges,
  };
  const confirmationResult = confirmPersonARecord({
    runtimePlan: plan,
    answerApplication: application,
    amendedRecord: amended,
    submission,
  });
  expect(confirmationResult.status).toBe('challenged');
  return {
    plan,
    application,
    record: amended,
    challenges: confirmationResult.challenges,
    confirmationResult,
  };
}

function sourceGrounding(record: JsonObject, challengeValue: PersonARecordChallenge) {
  const event = record.timeline.find(
    (item: JsonObject) => item.event_id === challengeValue.target_object_id,
  );
  const span = event.source_spans[0];
  return {
    kind: 'source_span' as const,
    object_id: event.event_id,
    submission_id: span.submission_id,
    quote: span.quote,
    start_char: span.start_char,
    end_char: span.end_char,
  };
}

function acceptedProposal(
  value: ResolutionContext,
  challengeValue = value.challenges.find((item) => item.target_path.startsWith('/timeline/'))!,
  replacementValue: JsonValue = `${value.record.timeline[0].event_summary} (corrected)`,
): PersonAChallengeResolutionProposal {
  const body = {
    challenge_id: challengeValue.challenge_id,
    outcome: 'accepted' as const,
    target_object_id: challengeValue.target_object_id,
    target_path: challengeValue.target_path,
    expected_prior_value: structuredClone(challengeValue.expected_prior_value),
    replacement_value: structuredClone(replacementValue),
    grounding_reference: sourceGrounding(value.record, challengeValue),
  };
  return {
    resolution_id: derivePersonAChallengeResolutionId(body),
    ...body,
  };
}

function rejectedProposal(
  challengeValue: PersonARecordChallenge,
): PersonAChallengeResolutionProposal {
  const body = {
    challenge_id: challengeValue.challenge_id,
    outcome: 'rejected' as const,
    target_object_id: challengeValue.target_object_id,
    target_path: challengeValue.target_path,
    expected_prior_value: structuredClone(challengeValue.expected_prior_value),
    rejection_reason_code: 'current_value_supported' as const,
  };
  return {
    resolution_id: derivePersonAChallengeResolutionId(body),
    ...body,
  };
}

function request(
  value: ResolutionContext,
  resolutions: PersonAChallengeResolutionProposal[],
): PersonAChallengeResolutionRequest {
  return {
    version: PERSON_A_CHALLENGE_RESOLUTION_REQUEST_VERSION,
    confirmation_package_id: value.confirmationResult.confirmation_package_id!,
    challenged_confirmation_submission_id: value.confirmationResult.confirmation_submission_id!,
    amended_record_hash: value.confirmationResult.amended_record_hash!,
    challenge_set_hash: derivePersonAChallengeSetHash(value.challenges),
    expected_record_version: 1,
    resolutions,
  };
}

function input(
  value: ResolutionContext,
  resolutions: PersonAChallengeResolutionProposal[],
): PersonAChallengeResolutionInput {
  return {
    confirmationResult: value.confirmationResult,
    amendedRecord: value.record,
    currentRecordVersion: 1,
    request: request(value, resolutions),
  };
}

function reidentifyResolution(value: JsonObject): void {
  const body = { ...value };
  delete body.resolution_id;
  value.resolution_id = derivePersonAChallengeResolutionId(body as any);
}

function contextWithSingleChallenge(
  value: ResolutionContext,
  challengeValue: PersonARecordChallenge,
): ResolutionContext {
  const confirmationPackage = buildPersonAConfirmationPackage({
    runtimePlan: value.plan,
    answerApplication: value.application,
    amendedRecord: value.record,
  });
  const confirmationResult = confirmPersonARecord({
    runtimePlan: value.plan,
    answerApplication: value.application,
    amendedRecord: value.record,
    submission: {
      version: PERSON_A_CONFIRMATION_SUBMISSION_VERSION,
      outcome: 'challenged',
      confirmation_package_id: confirmationPackage.package_id,
      amended_record_hash: value.application.amended_record_hash!,
      challenges: [challengeValue],
    },
  });
  expect(confirmationResult.status).toBe('challenged');
  return {
    ...value,
    challenges: confirmationResult.challenges,
    confirmationResult,
  };
}

describe('Person A challenge resolution success', () => {
  it('applies one accepted field correction as an append-only versioned amendment', () => {
    const value = context();
    const proposal = acceptedProposal(value);
    const before = JSON.stringify(value);
    const result = resolvePersonAChallenges(input(value, [proposal]));
    expect(result.status).toBe('resolved');
    expect((result.revised_record as JsonObject).timeline[0].event_summary).toBe(
      proposal.outcome === 'accepted' ? proposal.replacement_value : undefined,
    );
    expect(result.parent_record).toEqual(value.record);
    expect(result.parent_record_hash).toBe(hashPersonAClarificationArtifact(value.record));
    expect(result.revised_record_hash).not.toBe(result.parent_record_hash);
    expect(result.version_transition).toMatchObject({
      prior_record_version: 1,
      resulting_record_version: 2,
    });
    expect(result.correction_amendments).toHaveLength(1);
    expect(result.correction_amendments[0]).toMatchObject({
      challenge_id: proposal.challenge_id,
      resolution_id: proposal.resolution_id,
      amendment_sequence: 1,
      source_type: 'person_a_challenge_resolution',
      parent_record_hash: result.parent_record_hash,
      resulting_record_hash: result.revised_record_hash,
      prior_record_version: 1,
      resulting_record_version: 2,
      created_at: null,
    });
    expect(result.confirmation_required).toBe(true);
    expect(result.confirmed).toBe(false);
    expect(result.record_locked).toBe(false);
    expect(result.confirmation_handoff?.revised_record_hash).toBe(result.revised_record_hash);
    expect(JSON.stringify(value)).toBe(before);
  });

  it('resolves an explicit rejection without changing the record or version', () => {
    const value = context();
    const proposal = rejectedProposal(value.challenges[0]!);
    const result = resolvePersonAChallenges(input(value, [proposal]));
    expect(result.status).toBe('resolved');
    expect(result.revised_record).toEqual(value.record);
    expect(result.revised_record_hash).toBe(result.parent_record_hash);
    expect(result.version_transition).toMatchObject({
      prior_record_version: 1,
      resulting_record_version: 1,
    });
    expect(result.correction_amendments).toEqual([]);
    expect(result.rejected_resolutions).toEqual([
      expect.objectContaining({
        challenge_id: proposal.challenge_id,
        rejection_reason_code: 'current_value_supported',
      }),
    ]);
    expect(result.confirmation_required).toBe(true);
    expect(result.confirmed).toBe(false);
  });

  it('applies a mixed accepted and rejected complete batch deterministically', () => {
    const value = context(true);
    const timelineChallenge = value.challenges.find((item) =>
      item.target_path.startsWith('/timeline/'),
    )!;
    const evidenceChallenge = value.challenges.find((item) =>
      item.target_path.startsWith('/evidence/'),
    )!;
    const accepted = acceptedProposal(value, timelineChallenge);
    const rejected = rejectedProposal(evidenceChallenge);
    const first = resolvePersonAChallenges(input(value, [accepted, rejected]));
    const second = resolvePersonAChallenges(input(value, [rejected, accepted]));
    expect(first.status).toBe('resolved');
    expect(first.audit).toMatchObject({
      resolutions_accepted: 1,
      resolutions_rejected: 1,
      amendments_created: 1,
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('uses only an injected timestamp and keeps it out of record hashes', () => {
    const value = context();
    const baseInput = input(value, [acceptedProposal(value)]);
    const first = resolvePersonAChallenges({
      ...baseInput,
      options: { createdAt: '2026-07-24T12:00:00Z' },
    });
    const second = resolvePersonAChallenges({
      ...baseInput,
      options: { createdAt: '2026-07-24T13:00:00Z' },
    });
    expect(first.correction_amendments[0]!.created_at).toBe('2026-07-24T12:00:00Z');
    expect(first.revised_record_hash).toBe(second.revised_record_hash);
    expect(first.resolution_batch_id).toBe(second.resolution_batch_id);
  });

  it('permits a schema-valid actor reference correction without changing object identity', () => {
    const value = context();
    const actorChallenge = challenge(
      value.record,
      value.record.timeline[0].event_id,
      '/timeline/0/actor_party_id',
      'wrong_actor_attribution',
      'The other party performed this event.',
      value.record.timeline[0].actor_party_id,
    );
    const actorContext = contextWithSingleChallenge(value, actorChallenge);
    const result = resolvePersonAChallenges(
      input(actorContext, [acceptedProposal(actorContext, actorContext.challenges[0]!, 'party_b')]),
    );
    expect(result.status).toBe('resolved');
    expect((result.revised_record as JsonObject).timeline[0].actor_party_id).toBe('party_b');
    expect((result.revised_record as JsonObject).timeline[0].event_id).toBe(
      value.record.timeline[0].event_id,
    );
  });

  it('accepts the checked Dry Run 001 challenge-resolution fixture', () => {
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
    const confirmationResult = confirmPersonARecord({
      runtimePlan: plan,
      answerApplication: application,
      amendedRecord: application.amended_record,
      submission: load('dry_run_001.person_a.challenges.json'),
    });
    const result = resolvePersonAChallenges({
      confirmationResult,
      amendedRecord: application.amended_record,
      currentRecordVersion: 1,
      request: load('dry_run_001.person_a.challenge_resolutions.json'),
    });
    expect(result.status).toBe('resolved');
    expect(result.audit).toMatchObject({
      resolutions_accepted: 1,
      amendments_created: 1,
    });
    expect((result.revised_record as JsonObject).evidence[0].availability_status).toBe(
      'described_only',
    );
  });
});

describe('Person A challenge resolution atomic failures', () => {
  it.each([
    [
      'wrong package',
      (requestValue: JsonObject) => (requestValue.confirmation_package_id = '0'.repeat(64)),
      'stale_package',
    ],
    [
      'wrong submission',
      (requestValue: JsonObject) =>
        (requestValue.challenged_confirmation_submission_id = '0'.repeat(64)),
      'stale_confirmation_submission',
    ],
    [
      'wrong record',
      (requestValue: JsonObject) => (requestValue.amended_record_hash = '0'.repeat(64)),
      'stale_record',
    ],
    [
      'wrong challenge set',
      (requestValue: JsonObject) => (requestValue.challenge_set_hash = '0'.repeat(64)),
      'stale_challenge_set',
    ],
    [
      'wrong version',
      (requestValue: JsonObject) => (requestValue.expected_record_version = 2),
      'stale_record_version',
    ],
  ])('fails closed for %s binding', (_label, mutate, code) => {
    const value = context();
    const candidate = input(value, [acceptedProposal(value)]) as JsonObject;
    mutate(candidate.request);
    const result = resolvePersonAChallenges(candidate as PersonAChallengeResolutionInput);
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.map((entry) => entry.code)).toContain(code);
    expect(result.revised_record).toBeNull();
    expect(result.correction_amendments).toEqual([]);
  });

  it.each([
    ['missing', (resolutions: JsonObject[]) => resolutions.splice(0, 1), 'missing_resolution'],
    [
      'unknown',
      (resolutions: JsonObject[]) => {
        resolutions[0]!.challenge_id = 'pach_000000000000000000000000';
        reidentifyResolution(resolutions[0]!);
      },
      'unknown_challenge',
    ],
    [
      'duplicate resolution ID',
      (resolutions: JsonObject[]) => resolutions.push(structuredClone(resolutions[0]!)),
      'duplicate_resolution_id',
    ],
    [
      'target mismatch',
      (resolutions: JsonObject[]) => {
        resolutions[0]!.target_object_id = 'event_unknown';
        reidentifyResolution(resolutions[0]!);
      },
      'target_mismatch',
    ],
    [
      'stale prior',
      (resolutions: JsonObject[]) => {
        resolutions[0]!.expected_prior_value = 'stale';
        reidentifyResolution(resolutions[0]!);
      },
      'stale_prior_value',
    ],
    [
      'ungrounded',
      (resolutions: JsonObject[]) => {
        resolutions[0]!.grounding_reference = {
          ...resolutions[0]!.grounding_reference,
          quote: 'not an exact span',
        };
        reidentifyResolution(resolutions[0]!);
      },
      'invalid_grounding',
    ],
  ])('atomically rejects a %s resolution', (_label, mutate, code) => {
    const value = context();
    const candidate = input(value, [acceptedProposal(value)]) as JsonObject;
    mutate(candidate.request.resolutions);
    const result = resolvePersonAChallenges(candidate as PersonAChallengeResolutionInput);
    expect(result.status).not.toBe('resolved');
    expect(result.diagnostics.map((entry) => entry.code)).toContain(code);
    expect(result.diagnostics.map((entry) => entry.code)).toContain('atomic_batch_rejected');
    expect(result.revised_record).toBeNull();
    expect(result.correction_amendments).toEqual([]);
  });

  it('rejects an incomplete mixed batch rather than partially applying it', () => {
    const value = context(true);
    const result = resolvePersonAChallenges(input(value, [acceptedProposal(value)]));
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.map((entry) => entry.code)).toContain('missing_resolution');
    expect(result.revised_record).toBeNull();
  });

  it('rejects a caller-forged duplicate challenge set as internally inconsistent', () => {
    const value = context();
    const confirmationResult = structuredClone(value.confirmationResult);
    confirmationResult.challenges.push(structuredClone(confirmationResult.challenges[0]!));
    confirmationResult.audit.challenges_submitted = 2;
    confirmationResult.audit.challenges_accepted = 2;
    confirmationResult.confirmation_submission_id = hashPersonAConfirmationArtifact({
      version: PERSON_A_CONFIRMATION_SUBMISSION_VERSION,
      outcome: 'challenged',
      confirmation_package_id: confirmationResult.confirmation_package_id,
      amended_record_hash: confirmationResult.amended_record_hash,
      challenges: confirmationResult.challenges,
    } as unknown as JsonValue);
    const forged = {
      ...value,
      challenges: confirmationResult.challenges,
      confirmationResult,
    };
    const result = resolvePersonAChallenges(input(forged, [acceptedProposal(forged)]));
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.map((entry) => entry.code)).toContain('invalid_confirmation_result');
    expect(result.revised_record).toBeNull();
  });

  it.each([
    ['nested field', '/timeline/0/date/precision', 'exact'],
    ['collection replacement', '/timeline/0/source_spans', []],
    ['identity mutation', '/timeline/0/event_id', 'event_changed'],
  ])('fails closed for unsupported %s mutation', (_label, targetPath, replacement) => {
    const value = context();
    const segments = targetPath.slice(1).split('/');
    let prior: any = value.record;
    for (const segment of segments)
      prior = prior[Number.isInteger(Number(segment)) ? Number(segment) : segment];
    const customChallenge = challenge(
      value.record,
      value.record.timeline[0].event_id,
      targetPath,
      'incorrect_value',
      'This exact challenged representation requires a different value.',
      prior,
    );
    const custom = contextWithSingleChallenge(value, customChallenge);
    const candidate = acceptedProposal(custom, custom.challenges[0]!, replacement as JsonValue);
    const result = resolvePersonAChallenges(input(custom, [candidate]));
    expect(result.status).toBe('unsupported');
    expect(result.revised_record).toBeNull();
    expect(
      result.diagnostics.some((entry) =>
        ['unsupported_mutation_shape', 'immutable_identity_mutation'].includes(entry.code),
      ),
    ).toBe(true);
  });

  it.each(['create_object', 'delete_object', 'insert_array_item', 'split', 'merge', 'move'])(
    'rejects a proposal attempting unsupported %s instructions',
    (instruction) => {
      const value = context();
      const proposal = acceptedProposal(value) as JsonObject;
      proposal[instruction] = true;
      reidentifyResolution(proposal);
      const result = resolvePersonAChallenges(
        input(value, [proposal as PersonAChallengeResolutionProposal]),
      );
      expect(result.status).toBe('invalid');
      expect(result.diagnostics.map((entry) => entry.code)).toContain('invalid_resolution');
      expect(result.revised_record).toBeNull();
    },
  );

  it('fails typed unsupported for an accepted duplication challenge', () => {
    const value = context();
    const duplicated = challenge(
      value.record,
      value.record.timeline[0].event_id,
      '/timeline/0/event_summary',
      'duplication',
      'This representation duplicates another event.',
      value.record.timeline[0].event_summary,
    );
    const duplicateContext = contextWithSingleChallenge(value, duplicated);
    const result = resolvePersonAChallenges(
      input(duplicateContext, [acceptedProposal(duplicateContext)]),
    );
    expect(result.status).toBe('unsupported');
    expect(result.diagnostics.map((entry) => entry.code)).toContain('unsupported_mutation_shape');
  });
});

describe('Person A challenge resolution determinism and preservation', () => {
  it('is byte-identical for reordered challenges, reordered proposals, and repeated runs', () => {
    const value = context(true);
    const timelineChallenge = value.challenges.find((item) =>
      item.target_path.startsWith('/timeline/'),
    )!;
    const evidenceChallenge = value.challenges.find((item) =>
      item.target_path.startsWith('/evidence/'),
    )!;
    const accepted = acceptedProposal(value, timelineChallenge);
    const rejected = rejectedProposal(evidenceChallenge);
    const firstInput = input(value, [accepted, rejected]);
    const reorderedConfirmation = structuredClone(value.confirmationResult);
    reorderedConfirmation.challenges.reverse();
    const secondInput = {
      ...input(value, [rejected, accepted]),
      confirmationResult: reorderedConfirmation,
    };
    const first = resolvePersonAChallenges(firstInput);
    const repeated = resolvePersonAChallenges(structuredClone(firstInput));
    const reordered = resolvePersonAChallenges(secondInput);
    expect(JSON.stringify(first)).toBe(JSON.stringify(repeated));
    expect(JSON.stringify(first)).toBe(JSON.stringify(reordered));
  });

  it('preserves prior artifacts and unrelated canonical objects', () => {
    const value = context();
    const prior = {
      application: JSON.stringify(value.application),
      package: JSON.stringify(value.confirmationResult.confirmation_package),
      challenges: JSON.stringify(value.confirmationResult.challenges),
      claims: JSON.stringify(value.record.claims),
      evidence: JSON.stringify(value.record.evidence),
    };
    const result = resolvePersonAChallenges(input(value, [acceptedProposal(value)]));
    expect(result.status).toBe('resolved');
    expect(JSON.stringify(value.application)).toBe(prior.application);
    expect(JSON.stringify(value.confirmationResult.confirmation_package)).toBe(prior.package);
    expect(JSON.stringify(value.confirmationResult.challenges)).toBe(prior.challenges);
    expect(JSON.stringify(result.revised_record!.claims)).toBe(prior.claims);
    expect(JSON.stringify(result.revised_record!.evidence)).toBe(prior.evidence);
    expect(result.audit).toMatchObject({
      caller_input_unchanged: true,
      parent_record_unchanged: true,
      confirmation_package_unchanged: true,
      challenged_submission_unchanged: true,
    });
  });

  it('requires a fresh PR #8 package and never carries the old package forward', () => {
    const value = context();
    const result = resolvePersonAChallenges(input(value, [acceptedProposal(value)]));
    expect(result.status).toBe('resolved');
    const newPackage = buildPersonAConfirmationPackage({
      runtimePlan: value.plan,
      answerApplication: value.application,
      amendedRecord: result.revised_record!,
      revision: result.confirmation_handoff!,
    });
    expect(newPackage.package_id).not.toBe(value.confirmationResult.confirmation_package_id);
    const oldPackageAttempt = confirmPersonARecord({
      runtimePlan: value.plan,
      answerApplication: value.application,
      amendedRecord: result.revised_record,
      revision: result.confirmation_handoff,
      submission: {
        version: PERSON_A_CONFIRMATION_SUBMISSION_VERSION,
        outcome: 'confirmed',
        confirmation_package_id: value.confirmationResult.confirmation_package_id!,
        amended_record_hash: result.revised_record_hash!,
        explicit_confirmation: true,
      },
    });
    expect(oldPackageAttempt.status).toBe('invalid');
    expect(oldPackageAttempt.diagnostics.map((entry) => entry.code)).toContain('stale_package');
    const freshConfirmation = confirmPersonARecord({
      runtimePlan: value.plan,
      answerApplication: value.application,
      amendedRecord: result.revised_record,
      revision: result.confirmation_handoff,
      submission: {
        version: PERSON_A_CONFIRMATION_SUBMISSION_VERSION,
        outcome: 'confirmed',
        confirmation_package_id: newPackage.package_id,
        amended_record_hash: result.revised_record_hash!,
        explicit_confirmation: true,
      },
    });
    expect(freshConfirmation.status).toBe('confirmed');
  });

  it('rejects a forged revision handoff that does not replay to the revised record', () => {
    const value = context();
    const result = resolvePersonAChallenges(input(value, [acceptedProposal(value)]));
    const forged = structuredClone(result.confirmation_handoff!) as JsonObject;
    forged.correction_amendments[0].replacement_value = 'forged replacement';
    const amendment = forged.correction_amendments[0];
    const amendmentIdentity = {
      challenge_id: amendment.challenge_id,
      resolution_id: amendment.resolution_id,
      target_object_id: amendment.target_object_id,
      target_path: amendment.target_path,
      prior_value: amendment.prior_value,
      replacement_value: amendment.replacement_value,
      grounding_reference: amendment.grounding_reference,
      parent_record_hash: amendment.parent_record_hash,
      prior_record_version: amendment.prior_record_version,
      resulting_record_version: amendment.resulting_record_version,
    };
    amendment.amendment_id = `paca_corr_${hashPersonAConfirmationArtifact(amendmentIdentity).slice(0, 24)}`;
    const { handoff_id: _ignored, ...handoffBody } = forged;
    forged.handoff_id = hashPersonAConfirmationArtifact(handoffBody);
    const packageValue = buildPersonAConfirmationPackage({
      runtimePlan: value.plan,
      answerApplication: value.application,
      amendedRecord: result.revised_record!,
      revision: forged as any,
    });
    const confirmation = confirmPersonARecord({
      runtimePlan: value.plan,
      answerApplication: value.application,
      amendedRecord: result.revised_record,
      revision: forged,
      submission: {
        version: PERSON_A_CONFIRMATION_SUBMISSION_VERSION,
        outcome: 'confirmed',
        confirmation_package_id: packageValue.package_id,
        amended_record_hash: result.revised_record_hash!,
        explicit_confirmation: true,
      },
    });
    expect(confirmation.status).toBe('invalid');
    expect(confirmation.diagnostics.map((entry) => entry.code)).toContain(
      'invalid_answer_application',
    );
  });

  it('fails closed on accessor-backed input without invoking the accessor', () => {
    const value = context();
    const candidate = input(value, [acceptedProposal(value)]) as JsonObject;
    let invoked = false;
    Object.defineProperty(candidate.request, 'version', {
      enumerable: true,
      get() {
        invoked = true;
        return PERSON_A_CHALLENGE_RESOLUTION_REQUEST_VERSION;
      },
    });
    const result = resolvePersonAChallenges(candidate as PersonAChallengeResolutionInput);
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.map((entry) => entry.code)).toContain('invalid_input');
    expect(invoked).toBe(false);
  });

  it('has no runtime dependency on network, OpenAI, golden, evaluation, or alignment modules', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/runtime/person-a-challenge-resolution.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"].*(?:golden|evaluation|alignment|openai)/iu);
    expect(source).not.toMatch(/\bfetch\s*\(|OPENAI_API_KEY|process\.env|https?:\/\//u);
  });
});

describe('Person A challenge resolution CLI', () => {
  it('strictly parses documented local inputs and an optional injected timestamp', () => {
    expect(
      parseResolvePersonAChallengesArgs([
        '--confirmation-result',
        'confirmation.json',
        '--amended-record',
        'record.json',
        '--request',
        'request.json',
        '--record-version',
        '1',
        '--created-at',
        '2026-07-24T12:00:00Z',
        '--output',
        'output.json',
      ]),
    ).toMatchObject({
      recordVersion: 1,
      createdAt: '2026-07-24T12:00:00Z',
    });
    expect(() =>
      parseResolvePersonAChallengesArgs([
        '--confirmation-result',
        'confirmation.json',
        '--amended-record',
        'record.json',
        '--request',
        'request.json',
        '--record-version',
        '1',
        '--output',
        'output.json',
        '--unknown',
        'value',
      ]),
    ).toThrow('Unknown option');
  });

  it('writes canonical deterministic output and reports invalid and unsupported batches', async () => {
    const value = context();
    const validInput = input(value, [acceptedProposal(value)]);
    const writes: string[] = [];
    let requestJson: unknown = validInput.request;
    const dependencies: ResolvePersonAChallengesCommandDependencies = {
      readText: async (path) => {
        if (path.endsWith('confirmation.json'))
          return JSON.stringify(validInput.confirmationResult);
        if (path.endsWith('record.json')) return JSON.stringify(validInput.amendedRecord);
        return JSON.stringify(requestJson);
      },
      writeText: async (_path, contents) => {
        writes.push(contents);
      },
      makeDirectory: async () => undefined,
      resolve: resolvePersonAChallenges,
    };
    const argv = [
      '--confirmation-result',
      'confirmation.json',
      '--amended-record',
      'record.json',
      '--request',
      'request.json',
      '--record-version',
      '1',
      '--output',
      'output.json',
    ];
    const first = await runResolvePersonAChallengesCommand(argv, dependencies);
    const second = await runResolvePersonAChallengesCommand(argv, dependencies);
    expect(first.status).toBe('resolved');
    expect(writes[0]).toBe(writes[1]);

    requestJson = { malformed: true };
    const malformed = await runResolvePersonAChallengesCommand(argv, dependencies);
    expect(malformed.status).toBe('invalid');

    const duplicateContext = context();
    const proposal = acceptedProposal(duplicateContext) as JsonObject;
    proposal.replacement_value = [proposal.replacement_value];
    const body = { ...proposal };
    delete body.resolution_id;
    proposal.resolution_id = derivePersonAChallengeResolutionId(body as any);
    requestJson = request(duplicateContext, [proposal as PersonAChallengeResolutionProposal]);
    const unsupported = await runResolvePersonAChallengesCommand(argv, {
      ...dependencies,
      readText: async (path) => {
        if (path.endsWith('confirmation.json'))
          return JSON.stringify(duplicateContext.confirmationResult);
        if (path.endsWith('record.json')) return JSON.stringify(duplicateContext.record);
        return JSON.stringify(requestJson);
      },
    });
    expect(unsupported.status).toBe('unsupported');
  });

  it('exits correctly for valid, malformed, and unsupported local files', () => {
    const value = context();
    const validRequest = request(value, [acceptedProposal(value)]);
    const unsupportedProposal = acceptedProposal(value) as JsonObject;
    unsupportedProposal.replacement_value = [unsupportedProposal.replacement_value];
    reidentifyResolution(unsupportedProposal);
    const unsupportedRequest = request(value, [
      unsupportedProposal as PersonAChallengeResolutionProposal,
    ]);
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'juryai-resolution-cli-'));
    try {
      const confirmationPath = join(temporaryDirectory, 'confirmation.json');
      const recordPath = join(temporaryDirectory, 'record.json');
      const requestPath = join(temporaryDirectory, 'request.json');
      writeFileSync(confirmationPath, JSON.stringify(value.confirmationResult));
      writeFileSync(recordPath, JSON.stringify(value.record));
      const run = (requestValue: unknown, outputName: string) => {
        writeFileSync(requestPath, JSON.stringify(requestValue));
        return spawnSync(
          process.execPath,
          [
            '--import',
            'tsx',
            resolve(process.cwd(), 'src/commands/resolve-person-a-challenges.ts'),
            '--confirmation-result',
            confirmationPath,
            '--amended-record',
            recordPath,
            '--request',
            requestPath,
            '--record-version',
            '1',
            '--output',
            join(temporaryDirectory, outputName),
          ],
          { cwd: process.cwd(), encoding: 'utf8' },
        );
      };
      const valid = run(validRequest, 'valid.json');
      const malformed = run({ malformed: true }, 'malformed.json');
      const unsupported = run(unsupportedRequest, 'unsupported.json');
      expect([valid.status, malformed.status, unsupported.status]).toEqual([0, 2, 2]);
      expect(JSON.parse(readFileSync(join(temporaryDirectory, 'valid.json'), 'utf8')).status).toBe(
        'resolved',
      );
      expect(
        JSON.parse(readFileSync(join(temporaryDirectory, 'malformed.json'), 'utf8')).status,
      ).toBe('invalid');
      expect(
        JSON.parse(readFileSync(join(temporaryDirectory, 'unsupported.json'), 'utf8')).status,
      ).toBe('unsupported');
      expect(valid.stderr).not.toMatch(/Error:|at \S+ \(/u);
      expect(malformed.stderr).not.toMatch(/Error:|at \S+ \(/u);
      expect(unsupported.stderr).not.toMatch(/Error:|at \S+ \(/u);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
