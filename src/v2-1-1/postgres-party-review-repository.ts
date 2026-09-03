/** Private PostgreSQL repository for production-dark first-party review ceremonies. */

import { Pool, type PoolClient, type PoolConfig } from 'pg';
import {
  validateHumanHandoffChallengeV1,
  type HumanHandoffChallengeV1,
} from '../intent-assurance/intent-assurance.js';
import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import { ID_PATTERN_V211, type CaseEnvelopeV211, type PartyIdV211 } from './case-envelope.js';
import { assertValidCaseEnvelopeV211 } from './contract-validator.js';
import { assertV211DisputePersistenceId } from './formation-persistence.js';
import {
  executePartyReviewProtectedActionV1,
  preparePartyReviewChallengeV1,
  validatePartyReviewProtectedActionPayloadV1,
  type PartyReviewActionIdsV1,
  type PartyReviewPersistencePortV1,
  type PartyReviewProtectedActionPayloadV1,
} from './party-review-application.js';
import { derivePartyReviewStateV1 } from './party-review-state.js';

const SCHEMA = 'juryai_v21';

export type PartyReviewIdentityKindV1 =
  | 'challenge'
  | 'command'
  | 'confirmation'
  | 'confirmation_event'
  | 'reopen_event'
  | 'receipt'
  | 'consumption';

export interface PostgresPartyReviewRepositoryOptionsV1 extends PoolConfig {
  pool?: Pool;
  clock: { now: () => string };
  ids: {
    next: (kind: PartyReviewIdentityKindV1, partyId: PartyIdV211) => string;
    public_reference: () => string;
  };
}

interface ChallengeRow {
  record: unknown;
  action_payload: unknown;
  review_state_hash: unknown;
}

function postgresCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null;
}

function decodeEnvelope(value: unknown): CaseEnvelopeV211 {
  const envelope = cloneCanonical(value as CaseEnvelopeV211);
  assertValidCaseEnvelopeV211(envelope);
  assertV211DisputePersistenceId(envelope.control.case_id);
  return envelope;
}

function decodeChallenge(value: unknown): HumanHandoffChallengeV1 {
  const challenge = cloneCanonical(value as HumanHandoffChallengeV1);
  if (validateHumanHandoffChallengeV1(challenge).length > 0) {
    throw new TypeError('Stored assurance challenge failed its canonical contract.');
  }
  return challenge;
}

function decodeActionPayload(value: unknown): PartyReviewProtectedActionPayloadV1 {
  const payload = cloneCanonical(value as PartyReviewProtectedActionPayloadV1);
  if (!validatePartyReviewProtectedActionPayloadV1(payload)) {
    throw new TypeError('Stored protected action payload failed its canonical contract.');
  }
  return payload;
}

function partyForSubject(envelope: CaseEnvelopeV211, subject: string): PartyIdV211 | null {
  const matches = (['party_a', 'party_b'] as const).filter((partyId) => {
    const binding = envelope.parties[partyId];
    return (
      binding.identity_assurance === 'authenticated' && binding.authenticated_subject_id === subject
    );
  });
  return matches.length === 1 ? matches[0]! : null;
}

function validSubject(value: string): boolean {
  return ID_PATTERN_V211.test(value);
}

function recordedAtMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError('Repository clock did not produce a canonical timestamp.');
  }
  return parsed;
}

function actionIds(
  options: PostgresPartyReviewRepositoryOptionsV1['ids'],
  action: 'confirm_case_account' | 'reopen_confirmed_material',
  partyId: PartyIdV211,
): PartyReviewActionIdsV1 {
  const common = {
    challenge_id: options.next('challenge', partyId),
    public_reference: options.public_reference(),
    command_id: options.next('command', partyId),
  };
  return action === 'confirm_case_account'
    ? {
        ...common,
        confirmation_id: options.next('confirmation', partyId),
        confirmation_event_id: options.next('confirmation_event', partyId),
      }
    : { ...common, reopen_event_id: options.next('reopen_event', partyId) };
}

export class PostgresPartyReviewRepositoryV1 implements PartyReviewPersistencePortV1 {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #clock: PostgresPartyReviewRepositoryOptionsV1['clock'];
  readonly #ids: PostgresPartyReviewRepositoryOptionsV1['ids'];

  constructor(options: PostgresPartyReviewRepositoryOptionsV1) {
    this.#clock = options.clock;
    this.#ids = options.ids;
    if (options.pool) {
      this.#pool = options.pool;
      this.#ownsPool = false;
    } else {
      const { pool: _pool, clock: _clock, ids: _ids, ...config } = options;
      this.#pool = new Pool(config);
      this.#ownsPool = true;
    }
  }

  async assertReady(): Promise<void> {
    const result = await this.#pool.query<{ ready: boolean }>(
      `select to_regclass($1 || '.formation_assurance_challenges') is not null
              and to_regclass($1 || '.formation_assurance_receipts') is not null
              and to_regclass($1 || '.formation_assurance_consumptions') is not null as ready`,
      [SCHEMA],
    );
    if (result.rows[0]?.ready !== true) {
      throw new Error('V2.1.1 party-review assurance migration is incomplete.');
    }
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  async getPartyReview(input: { dispute_id: string; authenticated_subject_id: string }) {
    assertV211DisputePersistenceId(input.dispute_id);
    if (!validSubject(input.authenticated_subject_id)) return null;
    const result = await this.#pool.query<{ envelope: unknown }>(
      `select envelope from ${SCHEMA}.formation_disputes
        where dispute_id = $1
          and (party_a_principal_id = $2 or party_b_principal_id = $2)`,
      [input.dispute_id, input.authenticated_subject_id],
    );
    const row = result.rows[0];
    if (!row) return null;
    const envelope = decodeEnvelope(row.envelope);
    const partyId = partyForSubject(envelope, input.authenticated_subject_id);
    return partyId ? derivePartyReviewStateV1(envelope, partyId) : null;
  }

  async issuePartyReviewChallenge(
    input: Parameters<PartyReviewPersistencePortV1['issuePartyReviewChallenge']>[0],
  ): ReturnType<PartyReviewPersistencePortV1['issuePartyReviewChallenge']> {
    assertV211DisputePersistenceId(input.dispute_id);
    if (!validSubject(input.authenticated_subject_id)) {
      return { status: 'rejected', reason_code: 'unavailable', message: 'Review is unavailable.' };
    }
    return this.#transaction(async (client) => {
      const selected = await client.query<{ envelope: unknown }>(
        `select envelope from ${SCHEMA}.formation_disputes where dispute_id = $1 for update`,
        [input.dispute_id],
      );
      const row = selected.rows[0];
      if (!row) {
        return {
          status: 'rejected',
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        };
      }
      const envelope = decodeEnvelope(row.envelope);
      const partyId = partyForSubject(envelope, input.authenticated_subject_id);
      if (!partyId) {
        return {
          status: 'rejected',
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        };
      }
      const issuedAt = this.#clock.now();
      const prepared = preparePartyReviewChallengeV1({
        envelope,
        authenticated_subject_id: input.authenticated_subject_id,
        requested_action: input.requested_action,
        current_policy_decision: input.current_policy_decision,
        permitted_methods: input.permitted_methods,
        expires_in_seconds: input.expires_in_seconds,
        issued_at: issuedAt,
        ids: actionIds(this.#ids, input.requested_action, partyId),
        reopen_reason: input.reopen_reason,
      });
      if (prepared.status !== 'prepared') return prepared;
      const inserted = await client.query(
        `insert into ${SCHEMA}.formation_assurance_challenges
           (review_state_hash, action_payload, record)
         values ($1, $2::jsonb, $3::jsonb)
         on conflict (challenge_id) do nothing
         returning challenge_id`,
        [
          prepared.review_state.review_state_hash,
          canonicalSerialize(prepared.action_payload),
          canonicalSerialize(prepared.challenge),
        ],
      );
      if (!inserted.rows[0]) {
        return {
          status: 'rejected',
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        };
      }
      return {
        status: 'issued',
        challenge: prepared.challenge,
        review_state: prepared.review_state,
      };
    });
  }

  async executePartyReviewAction(
    input: Parameters<PartyReviewPersistencePortV1['executePartyReviewAction']>[0],
  ): ReturnType<PartyReviewPersistencePortV1['executePartyReviewAction']> {
    assertV211DisputePersistenceId(input.dispute_id);
    if (
      !validSubject(input.authenticated_subject_id) ||
      !ID_PATTERN_V211.test(input.challenge_id)
    ) {
      return { status: 'rejected', reason_code: 'unavailable', message: 'Review is unavailable.' };
    }
    return this.#transaction(async (client) => {
      const selected = await client.query<{
        envelope: unknown;
        internal_envelope_version: string;
        internal_envelope_hash: string;
      }>(
        `select envelope, internal_envelope_version, internal_envelope_hash
           from ${SCHEMA}.formation_disputes
          where dispute_id = $1 for update`,
        [input.dispute_id],
      );
      const row = selected.rows[0];
      if (!row) {
        return {
          status: 'rejected',
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        };
      }
      const envelope = decodeEnvelope(row.envelope);
      const partyId = partyForSubject(envelope, input.authenticated_subject_id);
      if (!partyId) {
        return {
          status: 'rejected',
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        };
      }
      const challengeResult = await client.query<ChallengeRow>(
        `select record, action_payload, review_state_hash
           from ${SCHEMA}.formation_assurance_challenges
          where challenge_id = $1 and dispute_id = $2 and party_id = $3
          for update`,
        [input.challenge_id, input.dispute_id, partyId],
      );
      const challengeRow = challengeResult.rows[0];
      if (!challengeRow) {
        return {
          status: 'rejected',
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        };
      }
      const challenge = decodeChallenge(challengeRow.record);
      if (challenge.status !== 'pending') {
        return {
          status: 'rejected',
          reason_code: 'already_used',
          message: 'Protected review challenge is unavailable.',
        };
      }
      const actionPayload = decodeActionPayload(challengeRow.action_payload);
      if (challengeRow.review_state_hash !== actionPayload.review_state_hash) {
        throw new TypeError('Stored challenge review binding is inconsistent.');
      }
      const now = this.#clock.now();
      const receiptId = this.#ids.next('receipt', partyId);
      const consumptionId = this.#ids.next('consumption', partyId);
      const executed = executePartyReviewProtectedActionV1({
        envelope,
        authenticated_subject_id: input.authenticated_subject_id,
        challenge,
        action_payload: actionPayload,
        expected_action: input.expected_action,
        current_policy_decision: input.current_policy_decision,
        observed_evidence: input.observed_evidence,
        completed_at: now,
        consumed_at: now,
        receipt_id: receiptId,
        consumption_id: consumptionId,
      });
      if (executed.status !== 'applied') return executed;

      const updated = await client.query(
        `update ${SCHEMA}.formation_disputes
            set envelope = $1::jsonb, updated_at = clock_timestamp()
          where dispute_id = $2
            and internal_envelope_version = $3
            and internal_envelope_hash = $4
          returning dispute_id`,
        [
          canonicalSerialize(executed.envelope),
          input.dispute_id,
          envelope.control.envelope_version,
          envelope.control.envelope_hash,
        ],
      );
      if (!updated.rows[0]) {
        return {
          status: 'rejected',
          reason_code: 'state_changed',
          message: 'Protected review state changed.',
        };
      }
      await client.query(
        `update ${SCHEMA}.formation_assurance_challenges
            set record = $1::jsonb, updated_at = clock_timestamp()
          where challenge_id = $2 and status = 'pending'`,
        [canonicalSerialize(executed.challenge), challenge.challenge_id],
      );
      await client.query(
        `insert into ${SCHEMA}.formation_assurance_receipts (record) values ($1::jsonb)`,
        [canonicalSerialize(executed.receipt)],
      );
      await client.query(
        `insert into ${SCHEMA}.formation_assurance_consumptions (record) values ($1::jsonb)`,
        [canonicalSerialize(executed.consumption)],
      );
      const command = actionPayload.ceremony_command;
      const commandAudit = {
        dispute_id: input.dispute_id,
        party_id: partyId,
        command_id: command.command_id,
        base_envelope_version: envelope.control.envelope_version,
        base_envelope_hash: envelope.control.envelope_hash,
        resulting_envelope_version: executed.envelope.control.envelope_version,
        resulting_envelope_hash: executed.envelope.control.envelope_hash,
        operation: cloneCanonical(command.operation),
        assurance_challenge_id: executed.challenge.challenge_id,
        assurance_receipt_id: executed.receipt.receipt_id,
        assurance_consumption_id: executed.consumption.consumption_id,
        assurance_policy_version: executed.challenge.policy_version,
        assurance_policy_profile_id: executed.challenge.policy_profile_id,
        assurance_method: executed.receipt.method,
        achieved_assurance: executed.receipt.achieved_assurance,
        required_minimum_assurance: executed.receipt.required_minimum_assurance,
        assurance_axes: cloneCanonical(executed.receipt.assurance_axes),
        prior_review_state_hash: executed.prior_review_state.review_state_hash,
        resulting_review_state_hash: executed.resulting_review_state.review_state_hash,
        recorded_at_ms: recordedAtMs(now),
      };
      await client.query(`insert into ${SCHEMA}.formation_commands (record) values ($1::jsonb)`, [
        canonicalSerialize(commandAudit),
      ]);
      return { status: 'applied', review_state: executed.resulting_review_state };
    });
  }

  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('begin');
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      if (postgresCode(error) === '23505') {
        throw new TypeError('Protected review identity was already used.');
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
