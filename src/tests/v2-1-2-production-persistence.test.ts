import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  INTENT_ASSURANCE_ACTIONS_V1,
  INTENT_ASSURANCE_POLICY_VERSION_V1,
  TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
  TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
  observeIntentAssuranceEvidenceV1,
  resolveIntentAssurancePolicyDecisionV1,
  type HumanHandoffChallengeV1,
  type IntentAssuranceActionV1,
  type IntentAssuranceLevelV1,
} from '../intent-assurance/intent-assurance.js';
import { TRUSTED_SYSTEM_AUTHORITY_V211, type CaseEnvelopeV211 } from '../v2-1-1/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV211,
  ceremonyCommandForV211,
  createInitialCaseEnvelopeV211,
} from '../v2-1-1/envelope-ceremony.js';
import { createPartyReviewApplicationV1 } from '../v2-1-1/party-review-application.js';
import { PostgresFormationRepositoryV211 } from '../v2-1-1/postgres-formation-repository.js';
import {
  PostgresPartyReviewRepositoryV1,
  type PartyReviewIdentityKindV1,
} from '../v2-1-1/postgres-party-review-repository.js';
import {
  TRUSTED_SYSTEM_AUTHORITY_V212,
  partyAuthorityV212,
  type CaseEnvelopeV212,
  type FormationRequirementV212,
  type PartyIdV212,
} from '../v2-1-2/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV212,
  ceremonyCommandForV212,
  createInitialCaseEnvelopeV212,
  type EnvelopeCeremonyOperationV212,
} from '../v2-1-2/envelope-ceremony.js';
import { createPartyReviewApplicationV212 } from '../v2-1-2/party-review-application.js';
import {
  PostgresDisclosureReviewRepositoryV212,
  type PartyReviewIdentityKindV212,
} from '../v2-1-2/postgres-disclosure-review-repository.js';
import {
  PostgresFormationInvitationRepositoryV212,
  productionInvitationAuthorityV212,
} from '../v2-1-2/postgres-formation-invitation-repository.js';
import {
  createInitialProductionDisputeV212,
  createProductionCaseServiceV212,
} from '../v2-1-2/production-case-service.js';
import { ScriptedSemanticCompiler } from '../webmcp/runtime/scripted-compiler.js';
import { projectRoot } from './test-helpers.js';

const DATABASE_URL = process.env.JURYAI_TEST_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'v2-1-2-production-persistence.test.ts requires JURYAI_TEST_DATABASE_URL pointing to an isolated database.',
  );
}

const pool = new Pool({ connectionString: DATABASE_URL });
const formation = new PostgresDisclosureReviewRepositoryV212({ pool });
const legacyFormation = new PostgresFormationRepositoryV211({ pool });
const invitations = new PostgresFormationInvitationRepositoryV212({
  pool,
  account_commitment_secret: 'pr6-isolated-invitation-secret-with-32-bytes',
  clock: () => Date.parse('2026-09-03T08:30:00.000Z'),
});
let sequence = 0;
let clockMs = Date.parse('2026-09-03T08:00:00.000Z');

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}_${process.pid}_${sequence}`;
}

function now(): string {
  clockMs += 1_000;
  return new Date(clockMs).toISOString();
}

function ceremonyV212(
  envelope: CaseEnvelopeV212,
  authority: Parameters<typeof applyEnvelopeCeremonyCommandV212>[0]['execution_authority'],
  operation: EnvelopeCeremonyOperationV212,
): CaseEnvelopeV212 {
  const applied = applyEnvelopeCeremonyCommandV212({
    envelope,
    command: ceremonyCommandForV212(envelope, unique('command'), operation),
    execution_authority: authority,
  });
  if (applied.status !== 'applied') throw new Error(applied.message);
  return applied.envelope;
}

function bindBothV212(envelope: CaseEnvelopeV212) {
  const subjectA = unique('subject_a');
  const subjectB = unique('subject_b');
  envelope = ceremonyV212(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
    type: 'bind_party',
    party_slot: 'party_a',
    authenticated_subject_id: subjectA,
    binding_event_id: unique('binding_party_a'),
  });
  envelope = ceremonyV212(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
    type: 'bind_party',
    party_slot: 'party_b',
    authenticated_subject_id: subjectB,
    binding_event_id: unique('binding_party_b'),
  });
  return { envelope, subject_a: subjectA, subject_b: subjectB };
}

function finalEnvelopeV212(label: string) {
  const bound = bindBothV212(createInitialCaseEnvelopeV212(unique(`dispute_${label}`)));
  let envelope = ceremonyV212(bound.envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
    type: 'open_controlled_disclosure',
  });
  for (const partyId of ['party_a', 'party_b'] as const) {
    envelope = ceremonyV212(envelope, partyAuthorityV212(envelope, partyId, 'first_party_human'), {
      type: 'record_disclosure_review_acknowledgment',
      acknowledgment_id: unique(`disclosure_ack_${partyId}`),
      event_id: unique(`disclosure_ack_event_${partyId}`),
      acknowledged_at: now(),
    });
  }
  envelope = ceremonyV212(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
    type: 'enter_final_confirmation',
  });
  return { ...bound, envelope };
}

function finalEnvelopeV211(label: string) {
  let envelope: CaseEnvelopeV211 = createInitialCaseEnvelopeV211(unique(`dispute_${label}`));
  const subjects = { party_a: unique('legacy_subject_a'), party_b: unique('legacy_subject_b') };
  for (const partyId of ['party_a', 'party_b'] as const) {
    const bound = applyEnvelopeCeremonyCommandV211({
      envelope,
      command: ceremonyCommandForV211(envelope, unique('legacy_command'), {
        type: 'bind_party',
        party_slot: partyId,
        authenticated_subject_id: subjects[partyId],
        binding_event_id: unique(`binding_${partyId}`),
      }),
      execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
    });
    if (bound.status !== 'applied') throw new Error(bound.message);
    envelope = bound.envelope;
  }
  for (const operation of [
    { type: 'open_controlled_disclosure' as const },
    { type: 'enter_final_confirmation' as const },
  ]) {
    const applied = applyEnvelopeCeremonyCommandV211({
      envelope,
      command: ceremonyCommandForV211(envelope, unique('legacy_command'), operation),
      execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
    });
    if (applied.status !== 'applied') throw new Error(applied.message);
    envelope = applied.envelope;
  }
  return { envelope, subject_a: subjects.party_a };
}

function requirement(id: string): Omit<FormationRequirementV212, 'party_id'> {
  return {
    requirement_id: id,
    label: id,
    prompt: `Answer ${id}.`,
    required: true,
    satisfying_types: ['narrative_fact'],
    min_propositions: 1,
    max_propositions: null,
    adverse_fact_probe: false,
    reopened_from: null,
  };
}

function policy(action: 'confirm_case_account' | 'reopen_confirmed_material') {
  const result = resolveIntentAssurancePolicyDecisionV1(
    action,
    {
      policy_version: INTENT_ASSURANCE_POLICY_VERSION_V1,
      profile_id: 'profile_pr6_persistence_hhc3',
      minimum_assurance_by_action: Object.fromEntries(
        INTENT_ASSURANCE_ACTIONS_V1.map((candidate) => [candidate, 'HHC-3']),
      ) as Record<IntentAssuranceActionV1, IntentAssuranceLevelV1>,
    },
    TRUSTED_INTENT_ASSURANCE_POLICY_RESOLVER_V1,
  );
  if (!result) throw new Error('Policy must resolve.');
  return result;
}

function evidence(challenge: HumanHandoffChallengeV1) {
  const result = observeIntentAssuranceEvidenceV1(
    {
      method: 'first_party_ceremony',
      challenge_id: challenge.challenge_id,
      first_party_session_id: unique('first_party_session'),
      ceremony_event_id: unique('ceremony_event'),
      server_observed: true,
      observed_at: challenge.issued_at,
      evidence_reference: unique('evidence_reference'),
    },
    TRUSTED_FIRST_PARTY_CEREMONY_ADAPTER_V1,
  );
  if (!result) throw new Error('Evidence must be observed.');
  return result;
}

function idFactory() {
  return {
    next: (kind: PartyReviewIdentityKindV212, partyId: PartyIdV212) => {
      const prefix: Record<PartyReviewIdentityKindV212, string> = {
        challenge: 'handoff_challenge',
        command: `command_${partyId}`,
        confirmation: `confirmation_${partyId}`,
        confirmation_event: `confirmation_event_${partyId}`,
        reopen_event: `reopen_event_${partyId}`,
        receipt: 'assurance_receipt',
        consumption: 'assurance_consumption',
      };
      return unique(prefix[kind]);
    },
    public_reference: () => `PR6-${String(++sequence).padStart(4, '0')}`,
  };
}

function reviewStore() {
  return new PostgresDisclosureReviewRepositoryV212({
    pool,
    clock: { now },
    ids: idFactory(),
  });
}

function reviewApp(subject: string, store = reviewStore()) {
  return createPartyReviewApplicationV212({
    authenticated_subject_id: subject,
    repository: store,
    resolve_policy: policy,
    permitted_methods: () => ['first_party_ceremony'],
    challenge_ttl_seconds: 300,
  });
}

beforeAll(async () => {
  await Promise.all([
    formation.assertReady(),
    legacyFormation.assertReady(),
    invitations.assertReady(),
  ]);
});

afterAll(async () => {
  await Promise.all([formation.close(), legacyFormation.close(), invitations.close(), pool.end()]);
});

describe('authorized V2.1.2 assurance migration', () => {
  it('keeps a historical V1/V2.1.1 row byte-identical while accepting the additive exact pair', async () => {
    const legacy = finalEnvelopeV211('historical_assurance');
    await legacyFormation.createDispute(legacy.envelope);
    const legacyReviewStore = new PostgresPartyReviewRepositoryV1({
      pool,
      clock: { now },
      ids: {
        next: (kind: PartyReviewIdentityKindV1, partyId) => {
          const prefix: Record<PartyReviewIdentityKindV1, string> = {
            challenge: 'handoff_challenge',
            command: `command_${partyId}`,
            confirmation: `confirmation_${partyId}`,
            confirmation_event: `confirmation_event_${partyId}`,
            reopen_event: `reopen_event_${partyId}`,
            receipt: 'assurance_receipt',
            consumption: 'assurance_consumption',
          };
          return unique(prefix[kind]);
        },
        public_reference: () => `PR6-${String(++sequence).padStart(4, '0')}`,
      },
    });
    const legacyApp = createPartyReviewApplicationV1({
      authenticated_subject_id: legacy.subject_a,
      repository: legacyReviewStore,
      resolve_policy: policy,
      permitted_methods: () => ['first_party_ceremony'],
      challenge_ttl_seconds: 300,
    });
    const old = await legacyApp.issueConfirmationChallenge(legacy.envelope.control.case_id);
    expect(old.status).toBe('issued');
    if (old.status !== 'issued') throw new Error(old.message);
    const before = await pool.query<{
      ctid: string;
      xmin: string;
      record: string;
      action_payload: string;
    }>(
      `select ctid::text, xmin::text, record::text, action_payload::text
         from juryai_v21.formation_assurance_challenges where challenge_id = $1`,
      [old.challenge.challenge_id],
    );
    const migration = readFileSync(
      `${projectRoot}/supabase/migrations/20260903074232_v212_party_review_protected_action.sql`,
      'utf8',
    );
    await pool.query(migration);
    const after = await pool.query<{
      ctid: string;
      xmin: string;
      record: string;
      action_payload: string;
    }>(
      `select ctid::text, xmin::text, record::text, action_payload::text
         from juryai_v21.formation_assurance_challenges where challenge_id = $1`,
      [old.challenge.challenge_id],
    );
    expect(after.rows).toEqual(before.rows);

    const current = finalEnvelopeV212('new_assurance');
    await formation.createDispute(current.envelope);
    const issued = await reviewApp(current.subject_a).issueConfirmationChallenge(
      current.envelope.control.case_id,
    );
    expect(issued).toMatchObject({ status: 'issued' });
    const row = await pool.query<{ action_payload: Record<string, unknown> }>(
      `select action_payload from juryai_v21.formation_assurance_challenges
        where dispute_id = $1`,
      [current.envelope.control.case_id],
    );
    expect(row.rows[0]?.action_payload).toMatchObject({
      protected_action_version: 'juryai-party-review-protected-action-v1.1.0',
      ceremony_command: { command_version: 'juryai-envelope-command-v2.1.2' },
    });
    await legacyReviewStore.close();
  });

  it.each([
    ['juryai-party-review-protected-action-v1.0.0', 'juryai-envelope-command-v2.1.2'],
    ['juryai-party-review-protected-action-v1.1.0', 'juryai-envelope-command-v2.1.1'],
    ['juryai-party-review-protected-action-v9.9.9', 'juryai-envelope-command-v2.1.2'],
    ['juryai-party-review-protected-action-v1.1.0', 'juryai-envelope-command-v9.9.9'],
  ])(
    'rejects protected-action/command cross-pair %s + %s',
    async (protectedVersion, commandVersion) => {
      const source = await pool.query<{
        review_state_hash: string;
        action_payload: unknown;
        record: unknown;
      }>(
        `select review_state_hash, action_payload, record
         from juryai_v21.formation_assurance_challenges
        where action_payload ->> 'protected_action_version' = 'juryai-party-review-protected-action-v1.1.0'
        limit 1`,
      );
      expect(source.rows).toHaveLength(1);
      const row = source.rows[0]!;
      const action = structuredClone(row.action_payload) as Record<string, unknown>;
      action.protected_action_version = protectedVersion;
      (action.ceremony_command as Record<string, unknown>).command_version = commandVersion;
      const record = structuredClone(row.record) as Record<string, unknown>;
      record.challenge_id = unique('handoff_challenge_cross_pair');
      await expect(
        pool.query(
          `insert into juryai_v21.formation_assurance_challenges
          (review_state_hash, action_payload, record) values ($1, $2::jsonb, $3::jsonb)`,
          [row.review_state_hash, action, record],
        ),
      ).rejects.toThrow(/formation_assurance_challenges_payload_binding/u);
    },
  );

  it('contains only the authorized constraint replacement and exact paired alternatives', () => {
    const migration = readFileSync(
      `${projectRoot}/supabase/migrations/20260903074232_v212_party_review_protected_action.sql`,
      'utf8',
    );
    expect(migration).toContain('formation_assurance_challenges_payload_binding');
    expect(migration).toContain('juryai-party-review-protected-action-v1.0.0');
    expect(migration).toContain('juryai-envelope-command-v2.1.1');
    expect(migration).toContain('juryai-party-review-protected-action-v1.1.0');
    expect(migration).toContain('juryai-envelope-command-v2.1.2');
    expect(migration).not.toMatch(
      /\b(?:insert|update|delete|create table|alter table .* add column)\b/iu,
    );
  });
});

describe('V2.1.2 production PostgreSQL composition', () => {
  it('replays the current dispute after the same start request has already been mutated', async () => {
    const subject = unique('start_replay_subject');
    const clientRequestId = unique('start_replay_request');
    const compiler = new ScriptedSemanticCompiler((compilerInput) => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: compilerInput.turn.payload.answer.text,
          requirement_id: compilerInput.requirement_context[0]!.requirement_id,
          type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: compilerInput.turn.payload.answer.text,
        },
      ],
    }));
    const service = createProductionCaseServiceV212({
      authenticated_subject_id: subject,
      repository: formation,
      compiler,
      review_url: (id) => `https://juryai.test/cases/${id}/review`,
      idempotency_secret: 'pr6-start-replay-secret-with-at-least-32-bytes',
    });
    const first = await service.startCase({ client_request_id: clientRequestId });
    if (!first.ok) throw new Error(first.error.message);
    const requirementId = first.case.next_requirements[0]!.requirement_id;
    const submitted = await service.submitTurn({
      case_id: first.case.case_id,
      expected_case_version: first.case.case_version,
      in_reply_to: [requirementId],
      payload: { context: [], answer: { role: 'user', text: 'My independent account.' } },
      client_turn_id: unique('start_replay_turn'),
    });
    if (!submitted.ok) throw new Error(submitted.error.message);

    const replayed = await service.startCase({ client_request_id: clientRequestId });
    expect(replayed).toMatchObject({
      ok: true,
      case: {
        case_id: first.case.case_id,
        case_version: submitted.case.case_version,
      },
    });
    expect(replayed.ok && replayed.case.case_version).toBeGreaterThan(first.case.case_version);
  });

  it('rejects a deterministic dispute ID collision from a different creator binding', async () => {
    const owner = createInitialProductionDisputeV212({
      authenticated_subject_id: unique('start_owner'),
      client_request_id: unique('start_owner_request'),
      idempotency_secret: 'pr6-start-owner-secret-with-at-least-32-bytes',
    });
    await formation.createDispute(owner);
    const initialRequirements = Object.fromEntries(
      (['party_a', 'party_b'] as const).map((partyId) => [
        partyId,
        Object.values(owner.requirements)
          .filter((entry) => entry.party_id === partyId)
          .map(({ party_id: _partyId, ...entry }) => entry),
      ]),
    ) as Parameters<typeof createInitialCaseEnvelopeV212>[1];
    let collision = createInitialCaseEnvelopeV212(owner.control.case_id, initialRequirements);
    collision = ceremonyV212(collision, TRUSTED_SYSTEM_AUTHORITY_V212, {
      type: 'bind_party',
      party_slot: 'party_a',
      authenticated_subject_id: unique('different_start_owner'),
      binding_event_id: unique('binding_party_a'),
    });
    await expect(formation.createDispute(collision)).rejects.toThrow(
      /different V2\.1\.2 creation identity/u,
    );
  });

  it('atomically creates, relays both independent formations, and opens disclosure exactly once', async () => {
    const subjects = { party_a: unique('relay_subject_a'), party_b: unique('relay_subject_b') };
    let envelope = createInitialCaseEnvelopeV212(unique('dispute_relay'), {
      party_a: [requirement('req_party_a_story')],
      party_b: [requirement('req_party_b_story')],
    });
    envelope = ceremonyV212(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
      type: 'bind_party',
      party_slot: 'party_a',
      authenticated_subject_id: subjects.party_a,
      binding_event_id: unique('binding_party_a'),
    });
    envelope = ceremonyV212(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
      type: 'bind_party',
      party_slot: 'party_b',
      authenticated_subject_id: subjects.party_b,
      binding_event_id: unique('binding_party_b'),
    });
    const created = await formation.createDispute(envelope);
    expect(created.created).toBe(true);
    const compiler = new ScriptedSemanticCompiler((compilerInput) => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: compilerInput.turn.payload.answer.text,
          requirement_id: compilerInput.requirement_context[0]!.requirement_id,
          type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: compilerInput.turn.payload.answer.text,
        },
      ],
    }));
    for (const partyId of ['party_a', 'party_b'] as const) {
      const service = createProductionCaseServiceV212({
        authenticated_subject_id: subjects[partyId],
        repository: formation,
        compiler,
        review_url: (id) => `https://juryai.test/cases/${id}/review`,
        idempotency_secret: 'pr6-relay-server-secret-with-32-bytes',
      });
      const state = await service.getCaseState({ case_id: envelope.control.case_id });
      if (!state.ok) throw new Error(state.error.message);
      const requirementId = `req_${partyId}_story`;
      const submitted = await service.submitTurn({
        case_id: envelope.control.case_id,
        expected_case_version: state.case.case_version,
        in_reply_to: [requirementId],
        payload: {
          context: [],
          answer: { role: 'user', text: `Independent account from ${partyId}.` },
        },
        client_turn_id: 'same-client-turn-is-party-scoped',
      });
      expect(submitted.ok).toBe(true);
    }
    const stored = await formation.findById(envelope.control.case_id);
    expect(stored?.envelope.control).toMatchObject({
      disclosure_state: 'disclosed',
      workflow_state: 'challenge_response',
    });
    expect(stored?.envelope.formation.disclosure_review_acknowledgments).toEqual({
      party_a: [],
      party_b: [],
    });
    const replays = await pool.query<{ party_id: string }>(
      `select party_id from juryai_v21.formation_replays
        where dispute_id = $1 and client_turn_id = 'same-client-turn-is-party-scoped'
        order by party_id`,
      [envelope.control.case_id],
    );
    expect(replays.rows.map((row) => row.party_id)).toEqual(['party_a', 'party_b']);
  });

  it('binds an intended distinct Party B once and rejects possession, self-redemption, and replay generically', async () => {
    const subjectA = unique('invite_subject_a');
    let envelope = createInitialCaseEnvelopeV212(unique('dispute_invite'));
    envelope = ceremonyV212(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
      type: 'bind_party',
      party_slot: 'party_a',
      authenticated_subject_id: subjectA,
      binding_event_id: unique('binding_party_a'),
    });
    await formation.createDispute(envelope);
    const authority = productionInvitationAuthorityV212(true);
    const issued = await invitations.issueInvitation({
      authority,
      dispute_id: envelope.control.case_id,
      authenticated_subject_id: subjectA,
      intended_account_email: 'intended-b@example.com',
    });
    expect(issued.status).toBe('issued');
    if (issued.status !== 'issued') throw new Error('Invitation must issue.');
    await expect(
      invitations.redeemInvitation({
        authority,
        opaque_token: issued.opaque_token,
        authenticated_subject_id: unique('wrong_subject'),
        authenticated_email: 'wrong@example.com',
      }),
    ).resolves.toMatchObject({ status: 'unavailable' });
    await expect(
      invitations.redeemInvitation({
        authority,
        opaque_token: issued.opaque_token,
        authenticated_subject_id: subjectA,
        authenticated_email: 'intended-b@example.com',
      }),
    ).resolves.toMatchObject({ status: 'unavailable' });
    const subjectB = unique('invite_subject_b');
    await expect(
      invitations.redeemInvitation({
        authority,
        opaque_token: issued.opaque_token,
        authenticated_subject_id: subjectB,
        authenticated_email: 'intended-b@example.com',
      }),
    ).resolves.toEqual({ status: 'redeemed' });
    await expect(
      invitations.redeemInvitation({
        authority,
        opaque_token: issued.opaque_token,
        authenticated_subject_id: subjectB,
        authenticated_email: 'intended-b@example.com',
      }),
    ).resolves.toMatchObject({ status: 'unavailable' });
    expect(
      (await formation.findById(envelope.control.case_id))?.envelope.parties.party_b,
    ).toMatchObject({
      identity_assurance: 'authenticated',
      authenticated_subject_id: subjectB,
    });
  });

  it('CAS-closes disclosure review exactly once and leaves substantive P3 absent', async () => {
    const seeded = bindBothV212(createInitialCaseEnvelopeV212(unique('dispute_final_cas')));
    let envelope = ceremonyV212(seeded.envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
      type: 'open_controlled_disclosure',
    });
    for (const partyId of ['party_a', 'party_b'] as const) {
      envelope = ceremonyV212(
        envelope,
        partyAuthorityV212(envelope, partyId, 'first_party_human'),
        {
          type: 'record_disclosure_review_acknowledgment',
          acknowledgment_id: unique(`disclosure_ack_${partyId}`),
          event_id: unique(`disclosure_ack_event_${partyId}`),
          acknowledged_at: now(),
        },
      );
    }
    const created = await formation.createDispute(envelope);
    const input = {
      dispute_id: envelope.control.case_id,
      expected_internal_envelope_version: created.stored.internal_envelope_version,
      expected_internal_envelope_hash: created.stored.internal_envelope_hash,
    };
    const competing = new PostgresDisclosureReviewRepositoryV212({ pool });
    const [left, right] = await Promise.all([
      formation.commitFinalConfirmation({ ...input, command_id: unique('command_final') }),
      competing.commitFinalConfirmation({ ...input, command_id: unique('command_final') }),
    ]);
    expect([left.status, right.status].sort()).toEqual(['committed', 'conflict']);
    const stored = await formation.findById(envelope.control.case_id);
    expect(stored?.envelope.control.workflow_state).toBe('final_confirmation');
    expect(JSON.stringify(stored?.envelope)).not.toMatch(
      /adjudicat|verdict|juror|payment|escrow/iu,
    );
    await competing.close();
  });

  it('atomically assurance-binds exact V2.1.2 confirmation and reopen commands', async () => {
    const seeded = finalEnvelopeV212('confirm_reopen');
    await formation.createDispute(seeded.envelope);
    const app = reviewApp(seeded.subject_a);
    const confirmation = await app.issueConfirmationChallenge(seeded.envelope.control.case_id);
    expect(confirmation.status).toBe('issued');
    if (confirmation.status !== 'issued') throw new Error(confirmation.message);
    const protectedConfirmation = await pool.query<{ action_payload: Record<string, unknown> }>(
      `select action_payload from juryai_v21.formation_assurance_challenges
        where challenge_id = $1`,
      [confirmation.challenge.challenge_id],
    );
    expect(protectedConfirmation.rows[0]?.action_payload).toMatchObject({
      protected_action_version: 'juryai-party-review-protected-action-v1.1.0',
      ceremony_command: {
        command_version: 'juryai-envelope-command-v2.1.2',
        operation: { type: 'record_party_confirmation' },
      },
    });
    const confirmed = await app.confirmCaseAccount({
      case_id: seeded.envelope.control.case_id,
      challenge_id: confirmation.challenge.challenge_id,
      observed_evidence: evidence(confirmation.challenge),
    });
    expect(confirmed).toMatchObject({
      status: 'applied',
      review_state: { own_confirmation_state: 'confirmed' },
    });
    const reopen = await app.issueReopenChallenge({
      case_id: seeded.envelope.control.case_id,
      reason: 'I need to correct my own account.',
    });
    expect(reopen.status).toBe('issued');
    if (reopen.status !== 'issued') throw new Error(reopen.message);
    const protectedReopen = await pool.query<{ action_payload: Record<string, unknown> }>(
      `select action_payload from juryai_v21.formation_assurance_challenges
        where challenge_id = $1`,
      [reopen.challenge.challenge_id],
    );
    expect(protectedReopen.rows[0]?.action_payload).toMatchObject({
      protected_action_version: 'juryai-party-review-protected-action-v1.1.0',
      ceremony_command: {
        command_version: 'juryai-envelope-command-v2.1.2',
        operation: { type: 'reopen_own_formation' },
      },
    });
    const reopened = await app.reopenConfirmedMaterial({
      case_id: seeded.envelope.control.case_id,
      challenge_id: reopen.challenge.challenge_id,
      observed_evidence: evidence(reopen.challenge),
    });
    expect(reopened).toMatchObject({
      status: 'applied',
      review_state: { own_confirmation_state: 'unconfirmed' },
    });
    const stored = await formation.findById(seeded.envelope.control.case_id);
    expect(stored?.envelope.parties.party_a.formation_epoch).toBe(
      seeded.envelope.parties.party_a.formation_epoch + 1,
    );
  });

  it('rolls back envelope, challenge, receipt, and consumption together on durable identity collision', async () => {
    const collisionIds = {
      next: (kind: PartyReviewIdentityKindV212, partyId: PartyIdV212) => {
        if (kind === 'receipt') return 'assurance_receipt_forced_collision';
        if (kind === 'consumption') return unique('assurance_consumption');
        const prefix: Record<
          Exclude<PartyReviewIdentityKindV212, 'receipt' | 'consumption'>,
          string
        > = {
          challenge: 'handoff_challenge',
          command: `command_${partyId}`,
          confirmation: `confirmation_${partyId}`,
          confirmation_event: `confirmation_event_${partyId}`,
          reopen_event: `reopen_event_${partyId}`,
        };
        return unique(prefix[kind]);
      },
      public_reference: () => `PR6-${String(++sequence).padStart(4, '0')}`,
    };
    const collisionStore = new PostgresDisclosureReviewRepositoryV212({
      pool,
      clock: { now },
      ids: collisionIds,
    });
    const first = finalEnvelopeV212('rollback_first');
    const second = finalEnvelopeV212('rollback_second');
    await formation.createDispute(first.envelope);
    await formation.createDispute(second.envelope);
    for (const seeded of [first, second] as const) {
      const app = reviewApp(seeded.subject_a, collisionStore);
      const challenge = await app.issueConfirmationChallenge(seeded.envelope.control.case_id);
      if (challenge.status !== 'issued') throw new Error(challenge.message);
      if (seeded === first) {
        const result = await app.confirmCaseAccount({
          case_id: seeded.envelope.control.case_id,
          challenge_id: challenge.challenge.challenge_id,
          observed_evidence: evidence(challenge.challenge),
        });
        expect(result.status).toBe('applied');
      } else {
        await expect(
          app.confirmCaseAccount({
            case_id: seeded.envelope.control.case_id,
            challenge_id: challenge.challenge.challenge_id,
            observed_evidence: evidence(challenge.challenge),
          }),
        ).rejects.toThrow(/Protected review identity was already used/u);
        const stored = await formation.findById(seeded.envelope.control.case_id);
        expect(stored?.envelope).toEqual(seeded.envelope);
        const state = await pool.query<{ status: string; receipts: number; consumptions: number }>(
          `select c.status,
                  (select count(*)::int from juryai_v21.formation_assurance_receipts r
                    where r.challenge_id = c.challenge_id) receipts,
                  (select count(*)::int from juryai_v21.formation_assurance_consumptions x
                    where x.challenge_id = c.challenge_id) consumptions
             from juryai_v21.formation_assurance_challenges c where c.challenge_id = $1`,
          [challenge.challenge.challenge_id],
        );
        expect(state.rows[0]).toEqual({ status: 'pending', receipts: 0, consumptions: 0 });
      }
    }
    await collisionStore.close();
  });
});
