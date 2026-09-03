/** Private PostgreSQL persistence for V2.1.2 formation and review commands. */

import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import {
  validateHumanHandoffChallengeV1,
  type HumanHandoffChallengeV1,
} from '../intent-assurance/intent-assurance.js';
import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import {
  HASH_PATTERN_V212,
  ID_PATTERN_V212,
  TRUSTED_SYSTEM_AUTHORITY_V212,
  partyAuthorityV212,
  type CaseEnvelopeV212,
  type PartyIdV212,
} from './case-envelope.js';
import { assertValidCaseEnvelopeV212 } from './contract-validator.js';
import { applyEnvelopeCeremonyCommandV212, ceremonyCommandForV212 } from './envelope-ceremony.js';
import {
  FORMATION_PERSISTENCE_CONTRACT_VERSION_V211,
  type FormationCompilerRunAuditRecordV211,
  type FormationReplayRecordV211,
  type FormationReplayResponseV211,
  type FormationSourceAuditRecordV211,
  type FormationSubmissionAuditRecordV211,
} from '../v2-1-1/formation-persistence.js';
import {
  applyExternalRelaySubmissionV212,
  rebaseExternalRelaySubmissionV212,
  type ExternalRelaySubmissionV211,
} from './external-relay-submission.js';
import {
  FORMATION_PERSISTENCE_CONTRACT_VERSION_V212,
  FORMATION_PERSISTENCE_SCHEMA_V212,
  type ActiveFormationContextV212,
  type CommitCeremonyResultV212,
  type CommitControlledDisclosureInputV212,
  type CommitDisclosureReviewAcknowledgmentInputV212,
  type CommitExternalRelaySubmissionInputV212,
  type CommitExternalRelaySubmissionResultV212,
  type CommitFinalConfirmationInputV212,
  type FormationPartyPersistenceContextV212,
  type StoredFormationDisputeV212,
} from './formation-persistence.js';
import {
  executePartyReviewProtectedActionV212,
  preparePartyReviewChallengeV212,
  validatePartyReviewProtectedActionPayloadV212,
  type PartyReviewPersistencePortV212,
  type PartyReviewProtectedActionPayloadV212,
} from './party-review-application.js';
import { derivePartyReviewStateV212 } from './party-review-state.js';

const SCHEMA = FORMATION_PERSISTENCE_SCHEMA_V212;

interface StoredFormationRow {
  envelope: unknown;
  internal_envelope_version: string | number;
  internal_envelope_hash: unknown;
  created_at_ms: string | number;
  updated_at_ms: string | number;
}

interface ContextRow extends StoredFormationRow {
  party_id: unknown;
}

interface ReplayRow {
  record: unknown;
}

interface ChallengeRow {
  record: unknown;
  action_payload: unknown;
  review_state_hash: unknown;
}

export interface PostgresDisclosureReviewRepositoryOptionsV212 extends PoolConfig {
  pool?: Pool;
  clock?: { now: () => string };
  ids?: {
    next: (kind: PartyReviewIdentityKindV212, partyId: PartyIdV212) => string;
    public_reference: () => string;
  };
}

export type PartyReviewIdentityKindV212 =
  | 'challenge'
  | 'command'
  | 'confirmation'
  | 'confirmation_event'
  | 'reopen_event'
  | 'receipt'
  | 'consumption';

function safeInteger(value: unknown, label: string, minimum = 0): number {
  const decoded = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  if (
    typeof decoded !== 'number' ||
    !Number.isSafeInteger(decoded) ||
    decoded < minimum ||
    decoded > Number.MAX_SAFE_INTEGER
  ) {
    throw new TypeError(`${label} is not a safe integer.`);
  }
  return decoded;
}

function canonicalId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN_V212.test(value)) {
    throw new TypeError(`${label} is not canonical.`);
  }
  return value;
}

function partyId(value: unknown): PartyIdV212 {
  if (value !== 'party_a' && value !== 'party_b') throw new TypeError('party_id is invalid.');
  return value;
}

function clientTurnId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 200 ||
    value.trim().length === 0
  ) {
    throw new TypeError('client_turn_id is invalid.');
  }
  return value;
}

function disputeId(value: unknown): string {
  const id = canonicalId(value, 'dispute_id');
  if (!id.startsWith('dispute_')) throw new TypeError('Only dispute_ identifiers are accepted.');
  return id;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN_V212.test(value)) {
    throw new TypeError(`${label} is not a SHA-256 digest.`);
  }
  return value;
}

function postgresCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null;
}

function recordedAtMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError('Repository clock did not produce a canonical timestamp.');
  }
  return parsed;
}

function decodeChallenge(value: unknown): HumanHandoffChallengeV1 {
  const challenge = cloneCanonical(value as HumanHandoffChallengeV1);
  if (validateHumanHandoffChallengeV1(challenge).length > 0) {
    throw new TypeError('Stored assurance challenge failed its canonical contract.');
  }
  return challenge;
}

function decodeActionPayload(value: unknown): PartyReviewProtectedActionPayloadV212 {
  const payload = cloneCanonical(value as PartyReviewProtectedActionPayloadV212);
  if (!validatePartyReviewProtectedActionPayloadV212(payload)) {
    throw new TypeError('Stored protected action payload failed its canonical contract.');
  }
  return payload;
}

function defaultReviewIdentity(kind: PartyReviewIdentityKindV212, party: PartyIdV212): string {
  const prefix: Record<PartyReviewIdentityKindV212, string> = {
    challenge: 'handoff_challenge',
    command: `command_${party}`,
    confirmation: `confirmation_${party}`,
    confirmation_event: `confirmation_event_${party}`,
    reopen_event: `reopen_event_${party}`,
    receipt: 'assurance_receipt',
    consumption: 'assurance_consumption',
  };
  return `${prefix[kind]}_${randomUUID()}`;
}

function reviewActionIds(
  options: NonNullable<PostgresDisclosureReviewRepositoryOptionsV212['ids']>,
  action: 'confirm_case_account' | 'reopen_confirmed_material',
  party: PartyIdV212,
) {
  const common = {
    challenge_id: options.next('challenge', party),
    public_reference: options.public_reference(),
    command_id: options.next('command', party),
  };
  return action === 'confirm_case_account'
    ? {
        ...common,
        confirmation_id: options.next('confirmation', party),
        confirmation_event_id: options.next('confirmation_event', party),
      }
    : { ...common, reopen_event_id: options.next('reopen_event', party) };
}

function encode(value: unknown): string {
  return canonicalSerialize(value as never);
}

function sameCreationIdentity(requested: CaseEnvelopeV212, stored: CaseEnvelopeV212): boolean {
  const bindingIdentity = (envelope: CaseEnvelopeV212, party: PartyIdV212) => {
    const binding = envelope.parties[party];
    return {
      party_id: binding.party_id,
      role: binding.role,
      authenticated_subject_id: binding.authenticated_subject_id,
      identity_assurance: binding.identity_assurance,
      binding_event_id: binding.binding_event_id,
    };
  };
  const requestedPartyB = bindingIdentity(requested, 'party_b');
  return (
    requested.control.case_id === stored.control.case_id &&
    encode(requested.requirements) === encode(stored.requirements) &&
    encode(bindingIdentity(requested, 'party_a')) === encode(bindingIdentity(stored, 'party_a')) &&
    (requestedPartyB.authenticated_subject_id === null ||
      encode(requestedPartyB) === encode(bindingIdentity(stored, 'party_b')))
  );
}

function decodeReplay(value: unknown): FormationReplayRecordV211 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Replay record is invalid.');
  }
  const record = cloneCanonical(value as FormationReplayRecordV211);
  clientTurnId(record.client_turn_id);
  const response = record.response as unknown;
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    throw new TypeError('Replay response is invalid.');
  }
  const responseRecord = response as unknown as Record<string, unknown>;
  const responseKeys = [
    'accepted_position_ids',
    'challenge_ids',
    'challenge_response_ids',
    'dispute_id',
    'opened_clarification_ids',
    'party_id',
    'persistence_contract_version',
    'resolved_clarification_ids',
    'resulting_internal_envelope_hash',
    'resulting_internal_envelope_version',
    'resulting_party_projection_hash',
    'resulting_party_visible_version',
    'source_turn_id',
    'submission_id',
    'superseded_position_ids',
    'warnings',
  ].sort();
  const idArray = (candidate: unknown): candidate is string[] =>
    Array.isArray(candidate) &&
    candidate.every((id) => typeof id === 'string' && ID_PATTERN_V212.test(id));
  if (
    Object.keys(record).sort().join(',') !==
      [
        'client_turn_id',
        'dispute_id',
        'party_id',
        'recorded_at_ms',
        'request_fingerprint',
        'response',
      ]
        .sort()
        .join(',') ||
    !record.dispute_id.startsWith('dispute_') ||
    !['party_a', 'party_b'].includes(record.party_id) ||
    !HASH_PATTERN_V212.test(record.request_fingerprint) ||
    !Number.isSafeInteger(record.recorded_at_ms) ||
    Object.keys(responseRecord).sort().join(',') !== responseKeys.join(',') ||
    record.response.persistence_contract_version !== FORMATION_PERSISTENCE_CONTRACT_VERSION_V211 ||
    record.response.dispute_id !== record.dispute_id ||
    record.response.party_id !== record.party_id ||
    !ID_PATTERN_V212.test(record.response.submission_id) ||
    !ID_PATTERN_V212.test(record.response.source_turn_id) ||
    !idArray(record.response.accepted_position_ids) ||
    !idArray(record.response.superseded_position_ids) ||
    !idArray(record.response.opened_clarification_ids) ||
    !idArray(record.response.resolved_clarification_ids) ||
    !idArray(record.response.challenge_ids) ||
    !idArray(record.response.challenge_response_ids) ||
    !Array.isArray(record.response.warnings) ||
    record.response.warnings.some((warning) => typeof warning !== 'string') ||
    !Number.isSafeInteger(record.response.resulting_internal_envelope_version) ||
    record.response.resulting_internal_envelope_version < 1 ||
    !HASH_PATTERN_V212.test(record.response.resulting_internal_envelope_hash) ||
    !Number.isSafeInteger(record.response.resulting_party_visible_version) ||
    record.response.resulting_party_visible_version < 1 ||
    !HASH_PATTERN_V212.test(record.response.resulting_party_projection_hash)
  ) {
    throw new TypeError('Replay record is invalid.');
  }
  canonicalSerialize(record as never);
  return record;
}

function replayResponse(
  submission: ExternalRelaySubmissionV211,
  envelope: CaseEnvelopeV212,
  party: PartyIdV212,
  result: {
    accepted_position_ids: string[];
    superseded_position_ids: string[];
    opened_clarification_ids: string[];
    resolved_clarification_ids: string[];
    challenge_ids: string[];
    challenge_response_ids: string[];
    warnings: string[];
  },
): FormationReplayResponseV211 {
  const cursor = envelope.control.party_views[party];
  return {
    persistence_contract_version: FORMATION_PERSISTENCE_CONTRACT_VERSION_V211,
    dispute_id: envelope.control.case_id,
    party_id: party,
    submission_id: submission.submission_id,
    source_turn_id: submission.source_turn.turn_id,
    accepted_position_ids: [...result.accepted_position_ids],
    superseded_position_ids: [...result.superseded_position_ids],
    opened_clarification_ids: [...result.opened_clarification_ids],
    resolved_clarification_ids: [...result.resolved_clarification_ids],
    challenge_ids: [...result.challenge_ids],
    challenge_response_ids: [...result.challenge_response_ids],
    warnings: [...result.warnings],
    resulting_internal_envelope_version: envelope.control.envelope_version,
    resulting_internal_envelope_hash: envelope.control.envelope_hash,
    resulting_party_visible_version: cursor.party_visible_version,
    resulting_party_projection_hash: cursor.party_projection_hash,
  };
}

function selectedFormationColumns(alias = ''): string {
  const prefix = alias.length > 0 ? `${alias}.` : '';
  return `${prefix}envelope,
          ${prefix}internal_envelope_version,
          ${prefix}internal_envelope_hash,
          (extract(epoch from ${prefix}created_at) * 1000)::bigint as created_at_ms,
          (extract(epoch from ${prefix}updated_at) * 1000)::bigint as updated_at_ms`;
}

function decodeStored(row: StoredFormationRow): StoredFormationDisputeV212 {
  const envelope = cloneCanonical(row.envelope as CaseEnvelopeV212);
  assertValidCaseEnvelopeV212(envelope);
  disputeId(envelope.control.case_id);
  const version = safeInteger(row.internal_envelope_version, 'internal_envelope_version', 1);
  const envelopeHash = hash(row.internal_envelope_hash, 'internal_envelope_hash');
  if (
    version !== envelope.control.envelope_version ||
    envelopeHash !== envelope.control.envelope_hash
  ) {
    throw new TypeError('Stored envelope identity disagrees with canonical V2.1.2 state.');
  }
  return {
    envelope,
    internal_envelope_version: version,
    internal_envelope_hash: envelopeHash,
    created_at_ms: safeInteger(row.created_at_ms, 'created_at_ms'),
    updated_at_ms: safeInteger(row.updated_at_ms, 'updated_at_ms'),
  };
}

function partyForSubject(envelope: CaseEnvelopeV212, subject: string): PartyIdV212 | null {
  const matches = (['party_a', 'party_b'] as const).filter((partyId) => {
    const binding = envelope.parties[partyId];
    return (
      binding.identity_assurance === 'authenticated' && binding.authenticated_subject_id === subject
    );
  });
  return matches.length === 1 ? matches[0]! : null;
}

export class PostgresDisclosureReviewRepositoryV212 {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #issuedContexts = new WeakSet<object>();
  readonly #clock: { now: () => string };
  readonly #ids: NonNullable<PostgresDisclosureReviewRepositoryOptionsV212['ids']>;

  constructor(options: PostgresDisclosureReviewRepositoryOptionsV212) {
    this.#clock = options.clock ?? { now: () => new Date().toISOString() };
    this.#ids =
      options.ids ??
      ({
        next: defaultReviewIdentity,
        public_reference: () => `PR6-${randomUUID()}`,
      } satisfies NonNullable<PostgresDisclosureReviewRepositoryOptionsV212['ids']>);
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
      `select to_regclass($1 || '.formation_disputes') is not null
              and exists (
                select 1 from pg_constraint
                 where conname = 'formation_disputes_contract_pair_v212'
                   and conrelid = to_regclass($1 || '.formation_disputes')
              )
              and exists (
                select 1 from pg_constraint
                 where conname = 'formation_assurance_challenges_payload_binding'
                   and conrelid = to_regclass($1 || '.formation_assurance_challenges')
                   and pg_get_constraintdef(oid) like '%juryai-party-review-protected-action-v1.1.0%'
                   and pg_get_constraintdef(oid) like '%juryai-envelope-command-v2.1.2%'
              ) as ready`,
      [SCHEMA],
    );
    if (result.rows[0]?.ready !== true) {
      throw new Error('V2.1.2 disclosure-review persistence migration is incomplete.');
    }
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  async getPartyReview(input: {
    dispute_id: string;
    authenticated_subject_id: string;
  }): ReturnType<PartyReviewPersistencePortV212['getPartyReview']> {
    const id = disputeId(input.dispute_id);
    const subject = canonicalId(input.authenticated_subject_id, 'authenticated_subject_id');
    const result = await this.#pool.query<{ envelope: unknown }>(
      `select envelope from ${SCHEMA}.formation_disputes
        where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2'
          and (party_a_principal_id = $2 or party_b_principal_id = $2)`,
      [id, subject],
    );
    const row = result.rows[0];
    if (!row) return null;
    const envelope = cloneCanonical(row.envelope as CaseEnvelopeV212);
    assertValidCaseEnvelopeV212(envelope);
    const party = partyForSubject(envelope, subject);
    return party ? derivePartyReviewStateV212(envelope, party) : null;
  }

  async issuePartyReviewChallenge(
    input: Parameters<PartyReviewPersistencePortV212['issuePartyReviewChallenge']>[0],
  ): ReturnType<PartyReviewPersistencePortV212['issuePartyReviewChallenge']> {
    const id = disputeId(input.dispute_id);
    const subject = canonicalId(input.authenticated_subject_id, 'authenticated_subject_id');
    return this.#transaction(async (client) => {
      const selected = await client.query<{ envelope: unknown }>(
        `select envelope from ${SCHEMA}.formation_disputes
          where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2' for update`,
        [id],
      );
      const row = selected.rows[0];
      if (!row) {
        return {
          status: 'rejected',
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        };
      }
      const envelope = cloneCanonical(row.envelope as CaseEnvelopeV212);
      assertValidCaseEnvelopeV212(envelope);
      const party = partyForSubject(envelope, subject);
      if (!party) {
        return {
          status: 'rejected',
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        };
      }
      const issuedAt = this.#clock.now();
      const prepared = preparePartyReviewChallengeV212({
        envelope,
        authenticated_subject_id: subject,
        requested_action: input.requested_action,
        current_policy_decision: input.current_policy_decision,
        permitted_methods: input.permitted_methods,
        expires_in_seconds: input.expires_in_seconds,
        issued_at: issuedAt,
        ids: reviewActionIds(this.#ids, input.requested_action, party),
        reopen_reason: input.reopen_reason,
      });
      if (prepared.status !== 'prepared') return prepared;
      const inserted = await client.query(
        `insert into ${SCHEMA}.formation_assurance_challenges
           (review_state_hash, action_payload, record)
         values ($1, $2::jsonb, $3::jsonb)
         on conflict (challenge_id) do nothing returning challenge_id`,
        [
          prepared.review_state.review_state_hash,
          encode(prepared.action_payload),
          encode(prepared.challenge),
        ],
      );
      return inserted.rows[0]
        ? {
            status: 'issued' as const,
            challenge: prepared.challenge,
            review_state: prepared.review_state,
          }
        : {
            status: 'rejected' as const,
            reason_code: 'unavailable',
            message: 'Review is unavailable.',
          };
    });
  }

  async executePartyReviewAction(
    input: Parameters<PartyReviewPersistencePortV212['executePartyReviewAction']>[0],
  ): ReturnType<PartyReviewPersistencePortV212['executePartyReviewAction']> {
    const id = disputeId(input.dispute_id);
    const subject = canonicalId(input.authenticated_subject_id, 'authenticated_subject_id');
    canonicalId(input.challenge_id, 'challenge_id');
    return this.#transaction(async (client) => {
      const selected = await client.query<StoredFormationRow>(
        `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
          where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2' for update`,
        [id],
      );
      const row = selected.rows[0];
      if (!row) {
        return {
          status: 'rejected',
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        };
      }
      const stored = decodeStored(row);
      const party = partyForSubject(stored.envelope, subject);
      if (!party) {
        return {
          status: 'rejected',
          reason_code: 'unavailable',
          message: 'Review is unavailable.',
        };
      }
      const challenges = await client.query<ChallengeRow>(
        `select record, action_payload, review_state_hash
           from ${SCHEMA}.formation_assurance_challenges
          where challenge_id = $1 and dispute_id = $2 and party_id = $3 for update`,
        [input.challenge_id, id, party],
      );
      const challengeRow = challenges.rows[0];
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
      const payload = decodeActionPayload(challengeRow.action_payload);
      if (challengeRow.review_state_hash !== payload.review_state_hash) {
        throw new TypeError('Stored challenge review binding is inconsistent.');
      }
      const now = this.#clock.now();
      const executed = executePartyReviewProtectedActionV212({
        envelope: stored.envelope,
        authenticated_subject_id: subject,
        challenge,
        action_payload: payload,
        expected_action: input.expected_action,
        current_policy_decision: input.current_policy_decision,
        observed_evidence: input.observed_evidence,
        completed_at: now,
        consumed_at: now,
        receipt_id: this.#ids.next('receipt', party),
        consumption_id: this.#ids.next('consumption', party),
      });
      if (executed.status !== 'applied') return executed;
      const updated = await client.query(
        `update ${SCHEMA}.formation_disputes
            set envelope = $1::jsonb, updated_at = clock_timestamp()
          where dispute_id = $2 and internal_envelope_version = $3 and internal_envelope_hash = $4
          returning dispute_id`,
        [
          encode(executed.envelope),
          id,
          stored.internal_envelope_version,
          stored.internal_envelope_hash,
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
        [encode(executed.challenge), challenge.challenge_id],
      );
      await client.query(
        `insert into ${SCHEMA}.formation_assurance_receipts (record) values ($1::jsonb)`,
        [encode(executed.receipt)],
      );
      await client.query(
        `insert into ${SCHEMA}.formation_assurance_consumptions (record) values ($1::jsonb)`,
        [encode(executed.consumption)],
      );
      const command = payload.ceremony_command;
      await client.query(`insert into ${SCHEMA}.formation_commands (record) values ($1::jsonb)`, [
        encode({
          persistence_contract_version: FORMATION_PERSISTENCE_CONTRACT_VERSION_V212,
          dispute_id: id,
          party_id: party,
          command_id: command.command_id,
          base_envelope_version: stored.internal_envelope_version,
          base_envelope_hash: stored.internal_envelope_hash,
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
        } as never),
      ]);
      return { status: 'applied', review_state: executed.resulting_review_state };
    });
  }

  async findById(idInput: string): Promise<StoredFormationDisputeV212 | null> {
    const id = disputeId(idInput);
    const result = await this.#pool.query(
      `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
        where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2'`,
      [id],
    );
    return result.rows[0] ? decodeStored(result.rows[0] as StoredFormationRow) : null;
  }

  async listActiveContextsForPrincipal(
    subjectInput: string,
  ): Promise<ActiveFormationContextV212[]> {
    const subject = canonicalId(subjectInput, 'authenticated_subject_id');
    const result = await this.#pool.query(
      `select ${selectedFormationColumns('dispute')},
              case when dispute.party_a_principal_id = $1 then 'party_a'
                   when dispute.party_b_principal_id = $1 then 'party_b' end as party_id
         from ${SCHEMA}.formation_disputes dispute
        where dispute.schema_version = 'juryai-case-envelope-v2.1.2'
          and (dispute.party_a_principal_id = $1 or dispute.party_b_principal_id = $1)
        order by dispute.dispute_id`,
      [subject],
    );
    return result.rows.map((raw) => {
      const row = raw as ContextRow;
      const stored = decodeStored(row);
      const party = partyId(row.party_id);
      if (partyForSubject(stored.envelope, subject) !== party) {
        throw new TypeError('Generated party lookup disagrees with canonical binding.');
      }
      const cursor = stored.envelope.control.party_views[party];
      return {
        dispute_id: stored.envelope.control.case_id,
        party_id: party,
        internal_envelope_version: stored.internal_envelope_version,
        internal_envelope_hash: stored.internal_envelope_hash,
        party_visible_version: cursor.party_visible_version,
        party_projection_hash: cursor.party_projection_hash,
      };
    });
  }

  async resolvePartyContext(
    idInput: string,
    subjectInput: string,
  ): Promise<FormationPartyPersistenceContextV212 | null> {
    const id = disputeId(idInput);
    const subject = canonicalId(subjectInput, 'authenticated_subject_id');
    const result = await this.#pool.query(
      `select ${selectedFormationColumns('dispute')},
              case when dispute.party_a_principal_id = $2 then 'party_a'
                   when dispute.party_b_principal_id = $2 then 'party_b' end as party_id
         from ${SCHEMA}.formation_disputes dispute
        where dispute.dispute_id = $1
          and dispute.schema_version = 'juryai-case-envelope-v2.1.2'
          and (dispute.party_a_principal_id = $2 or dispute.party_b_principal_id = $2)`,
      [id, subject],
    );
    const row = result.rows[0] as ContextRow | undefined;
    if (!row) return null;
    const stored = decodeStored(row);
    const party = partyId(row.party_id);
    if (partyForSubject(stored.envelope, subject) !== party) {
      throw new TypeError('Generated party lookup disagrees with canonical binding.');
    }
    const cursor = stored.envelope.control.party_views[party];
    const context: FormationPartyPersistenceContextV212 = Object.freeze({
      dispute_id: id,
      party_id: party,
      authenticated_subject_id: subject,
      internal_envelope_version: stored.internal_envelope_version,
      internal_envelope_hash: stored.internal_envelope_hash,
      party_visible_version: cursor.party_visible_version,
      party_projection_hash: cursor.party_projection_hash,
    });
    this.#issuedContexts.add(context);
    return context;
  }

  async readReplayRecord(
    context: FormationPartyPersistenceContextV212,
    turnInput: string,
  ): Promise<FormationReplayRecordV211 | null> {
    if (!this.#issuedContexts.has(context)) return null;
    const turn = clientTurnId(turnInput);
    const result = await this.#pool.query(
      `select replay.record
         from ${SCHEMA}.formation_replays replay
         join ${SCHEMA}.formation_disputes dispute using (dispute_id)
        where replay.dispute_id = $1 and replay.party_id = $2 and replay.client_turn_id = $3
          and dispute.schema_version = 'juryai-case-envelope-v2.1.2'
          and (($2 = 'party_a' and dispute.party_a_principal_id = $4)
            or ($2 = 'party_b' and dispute.party_b_principal_id = $4))`,
      [context.dispute_id, context.party_id, turn, context.authenticated_subject_id],
    );
    const row = result.rows[0] as ReplayRow | undefined;
    return row ? decodeReplay(row.record) : null;
  }

  /** Atomic canonical creation seam; production authority is held by server composition. */
  async createDispute(
    envelopeInput: CaseEnvelopeV212,
  ): Promise<{ created: boolean; stored: StoredFormationDisputeV212 }> {
    const envelope = cloneCanonical(envelopeInput);
    assertValidCaseEnvelopeV212(envelope);
    disputeId(envelope.control.case_id);
    return this.#transaction(async (client) => {
      const inserted = await client.query(
        `insert into ${SCHEMA}.formation_disputes (envelope) values ($1::jsonb)
         on conflict (dispute_id) do nothing returning ${selectedFormationColumns()}`,
        [encode(envelope)],
      );
      if (inserted.rows[0]) {
        return { created: true, stored: decodeStored(inserted.rows[0] as StoredFormationRow) };
      }
      const found = await client.query(
        `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
          where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2'`,
        [envelope.control.case_id],
      );
      const row = found.rows[0] as StoredFormationRow | undefined;
      if (!row) throw new TypeError('A different contract already uses this dispute id.');
      const stored = decodeStored(row);
      if (!sameCreationIdentity(envelope, stored.envelope)) {
        throw new TypeError('A different V2.1.2 creation identity already uses this dispute id.');
      }
      return { created: false, stored };
    });
  }

  async commitExternalRelaySubmission(
    input: CommitExternalRelaySubmissionInputV212,
  ): Promise<CommitExternalRelaySubmissionResultV212> {
    if (!this.#issuedContexts.has(input.context)) {
      return { status: 'unauthorized', replayed: false };
    }
    canonicalId(input.source_id, 'source_id');
    safeInteger(input.recorded_at_ms, 'recorded_at_ms');
    canonicalSerialize(input.submission as never);
    if (
      input.submission.dispute_id !== input.context.dispute_id ||
      input.submission.source_turn.attributed_party_id !== input.context.party_id
    ) {
      throw new TypeError('Submission identity disagrees with the resolved persistence context.');
    }

    return this.#transaction(async (client) => {
      const selected = await client.query(
        `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
          where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2' for update`,
        [input.context.dispute_id],
      );
      const row = selected.rows[0] as StoredFormationRow | undefined;
      if (!row) return { status: 'conflict', replayed: false, current: null };
      const current = decodeStored(row);
      const party = partyForSubject(current.envelope, input.context.authenticated_subject_id);
      if (party !== input.context.party_id) return { status: 'unauthorized', replayed: false };

      const replayResult = await client.query(
        `select record from ${SCHEMA}.formation_replays
          where dispute_id = $1 and party_id = $2 and client_turn_id = $3`,
        [input.context.dispute_id, party, input.submission.source_turn.client_turn_id],
      );
      const replayRow = replayResult.rows[0] as ReplayRow | undefined;
      if (replayRow) {
        const replay = decodeReplay(replayRow.record);
        if (replay.request_fingerprint !== input.submission.source_turn.request_fingerprint) {
          return { status: 'idempotency_conflict', replayed: false };
        }
        return { status: 'replayed', replayed: true, stored: current, response: replay.response };
      }

      let submission = input.submission;
      let hiddenStateRebased = false;
      if (
        submission.base_internal_envelope_version !== current.internal_envelope_version ||
        submission.base_internal_envelope_hash !== current.internal_envelope_hash
      ) {
        const rebased = rebaseExternalRelaySubmissionV212(submission, current.envelope);
        if (!rebased) return { status: 'conflict', replayed: false, current };
        submission = rebased;
        hiddenStateRebased = true;
      }

      const applied = applyExternalRelaySubmissionV212({
        envelope: current.envelope,
        submission,
        execution_authority: partyAuthorityV212(current.envelope, party, 'external_relay'),
      });
      if (applied.status === 'rejected') {
        return {
          status: 'domain_rejected',
          replayed: false,
          reason_code: applied.reason_code,
          message: applied.message,
        };
      }

      const updated = await client.query(
        `update ${SCHEMA}.formation_disputes
            set envelope = $1::jsonb, updated_at = clock_timestamp()
          where dispute_id = $2 and internal_envelope_version = $3 and internal_envelope_hash = $4
          returning ${selectedFormationColumns()}`,
        [
          encode(applied.envelope),
          current.envelope.control.case_id,
          current.internal_envelope_version,
          current.internal_envelope_hash,
        ],
      );
      const updatedRow = updated.rows[0] as StoredFormationRow | undefined;
      if (!updatedRow) return { status: 'conflict', replayed: false, current };

      const sourceRecord: FormationSourceAuditRecordV211 = {
        dispute_id: current.envelope.control.case_id,
        party_id: party,
        source_id: input.source_id,
        source_turn_id: submission.source_turn.turn_id,
        source_hash: submission.source_turn.payload_commitment,
        recorded_at_ms: input.recorded_at_ms,
      };
      await client.query(`insert into ${SCHEMA}.formation_sources (record) values ($1::jsonb)`, [
        encode(sourceRecord),
      ]);

      const cursor = applied.envelope.control.party_views[party];
      const submissionRecord: FormationSubmissionAuditRecordV211 = {
        dispute_id: current.envelope.control.case_id,
        party_id: party,
        submission_id: submission.submission_id,
        client_turn_id: submission.source_turn.client_turn_id,
        source_id: input.source_id,
        source_turn_id: submission.source_turn.turn_id,
        base_internal_envelope_version: current.internal_envelope_version,
        base_internal_envelope_hash: current.internal_envelope_hash,
        resulting_internal_envelope_version: applied.envelope.control.envelope_version,
        resulting_internal_envelope_hash: applied.envelope.control.envelope_hash,
        resulting_party_visible_version: cursor.party_visible_version,
        resulting_party_projection_hash: cursor.party_projection_hash,
        submission: cloneCanonical(submission),
        recorded_at_ms: input.recorded_at_ms,
      };
      await client.query(
        `insert into ${SCHEMA}.formation_submissions (record) values ($1::jsonb)`,
        [encode(submissionRecord)],
      );

      const compilerRecord: FormationCompilerRunAuditRecordV211 = {
        dispute_id: current.envelope.control.case_id,
        party_id: party,
        compiler_run_id: submission.compiler_run.compile_run_id,
        submission_id: submission.submission_id,
        compiler_version_id: submission.compiler_run.compiler_version_id,
        input_hash: submission.compiler_run.input_hash,
        output_hash: submission.compiler_run.output_hash,
        recorded_at_ms: input.recorded_at_ms,
      };
      await client.query(
        `insert into ${SCHEMA}.formation_compiler_runs (record) values ($1::jsonb)`,
        [encode(compilerRecord)],
      );

      const response = replayResponse(submission, applied.envelope, party, applied.result);
      const replayRecord: FormationReplayRecordV211 = {
        dispute_id: current.envelope.control.case_id,
        party_id: party,
        client_turn_id: submission.source_turn.client_turn_id,
        request_fingerprint: submission.source_turn.request_fingerprint,
        response,
        recorded_at_ms: input.recorded_at_ms,
      };
      await client.query(`insert into ${SCHEMA}.formation_replays (record) values ($1::jsonb)`, [
        encode(replayRecord),
      ]);

      return {
        status: 'committed',
        replayed: false,
        hidden_state_rebased: hiddenStateRebased,
        stored: decodeStored(updatedRow),
        response,
      };
    });
  }

  async commitControlledDisclosure(
    input: CommitControlledDisclosureInputV212,
  ): Promise<CommitCeremonyResultV212> {
    const id = disputeId(input.dispute_id);
    canonicalId(input.command_id, 'command_id');
    safeInteger(input.expected_internal_envelope_version, 'expected version', 1);
    hash(input.expected_internal_envelope_hash, 'expected hash');
    return this.#transaction(async (client) => {
      const selected = await client.query(
        `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
          where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2' for update`,
        [id],
      );
      const row = selected.rows[0] as StoredFormationRow | undefined;
      if (!row) return { status: 'conflict', current: null };
      const current = decodeStored(row);
      if (
        current.internal_envelope_version !== input.expected_internal_envelope_version ||
        current.internal_envelope_hash !== input.expected_internal_envelope_hash
      ) {
        return { status: 'conflict', current };
      }
      const applied = applyEnvelopeCeremonyCommandV212({
        envelope: current.envelope,
        command: ceremonyCommandForV212(current.envelope, input.command_id, {
          type: 'open_controlled_disclosure',
        }),
        execution_authority: TRUSTED_SYSTEM_AUTHORITY_V212,
      });
      if (applied.status === 'rejected') {
        return {
          status: 'domain_rejected',
          reason_code: applied.reason_code,
          message: applied.message,
        };
      }
      const updated = await client.query(
        `update ${SCHEMA}.formation_disputes
            set envelope = $1::jsonb, updated_at = clock_timestamp()
          where dispute_id = $2 and internal_envelope_version = $3 and internal_envelope_hash = $4
          returning ${selectedFormationColumns()}`,
        [
          encode(applied.envelope),
          id,
          current.internal_envelope_version,
          current.internal_envelope_hash,
        ],
      );
      const updatedRow = updated.rows[0] as StoredFormationRow | undefined;
      return updatedRow
        ? { status: 'committed', stored: decodeStored(updatedRow) }
        : { status: 'conflict', current };
    });
  }

  async commitDisclosureReviewAcknowledgment(
    input: CommitDisclosureReviewAcknowledgmentInputV212,
  ): Promise<CommitCeremonyResultV212> {
    const id = disputeId(input.dispute_id);
    const subject = canonicalId(input.authenticated_subject_id, 'authenticated_subject_id');
    canonicalId(input.command_id, 'command_id');
    canonicalId(input.acknowledgment_id, 'acknowledgment_id');
    canonicalId(input.event_id, 'event_id');
    safeInteger(input.expected_internal_envelope_version, 'expected version', 1);
    hash(input.expected_internal_envelope_hash, 'expected hash');
    safeInteger(input.recorded_at_ms, 'recorded_at_ms');

    return this.#transaction(async (client) => {
      const selected = await client.query(
        `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
          where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2' for update`,
        [id],
      );
      const row = selected.rows[0] as StoredFormationRow | undefined;
      if (!row) return { status: 'conflict', current: null };
      const current = decodeStored(row);
      if (
        current.internal_envelope_version !== input.expected_internal_envelope_version ||
        current.internal_envelope_hash !== input.expected_internal_envelope_hash
      ) {
        return { status: 'conflict', current };
      }
      const partyId = partyForSubject(current.envelope, subject);
      if (!partyId) return { status: 'unauthorized' };
      const command = ceremonyCommandForV212(current.envelope, input.command_id, {
        type: 'record_disclosure_review_acknowledgment',
        acknowledgment_id: input.acknowledgment_id,
        event_id: input.event_id,
        acknowledged_at: input.acknowledged_at,
      });
      const applied = applyEnvelopeCeremonyCommandV212({
        envelope: current.envelope,
        command,
        execution_authority: partyAuthorityV212(current.envelope, partyId, 'first_party_human'),
      });
      if (applied.status === 'rejected') {
        return {
          status: 'domain_rejected',
          reason_code: applied.reason_code,
          message: applied.message,
        };
      }
      const updated = await client.query(
        `update ${SCHEMA}.formation_disputes
            set envelope = $1::jsonb, updated_at = clock_timestamp()
          where dispute_id = $2
            and internal_envelope_version = $3
            and internal_envelope_hash = $4
          returning ${selectedFormationColumns()}`,
        [
          encode(applied.envelope),
          id,
          current.internal_envelope_version,
          current.internal_envelope_hash,
        ],
      );
      const updatedRow = updated.rows[0] as StoredFormationRow | undefined;
      if (!updatedRow) return { status: 'conflict', current };
      const commandRecord = {
        persistence_contract_version: FORMATION_PERSISTENCE_CONTRACT_VERSION_V212,
        dispute_id: id,
        party_id: partyId,
        command_id: input.command_id,
        base_envelope_version: current.internal_envelope_version,
        base_envelope_hash: current.internal_envelope_hash,
        resulting_envelope_version: applied.resulting_envelope_version,
        resulting_envelope_hash: applied.envelope.control.envelope_hash,
        operation_type: command.operation.type,
        event_id: input.event_id,
        recorded_at_ms: input.recorded_at_ms,
      };
      await client.query(`insert into ${SCHEMA}.formation_commands (record) values ($1::jsonb)`, [
        encode(commandRecord),
      ]);
      return { status: 'committed', stored: decodeStored(updatedRow) };
    });
  }

  async commitFinalConfirmation(
    input: CommitFinalConfirmationInputV212,
  ): Promise<CommitCeremonyResultV212> {
    const id = disputeId(input.dispute_id);
    canonicalId(input.command_id, 'command_id');
    safeInteger(input.expected_internal_envelope_version, 'expected version', 1);
    hash(input.expected_internal_envelope_hash, 'expected hash');
    return this.#transaction(async (client) => {
      const selected = await client.query(
        `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
          where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2' for update`,
        [id],
      );
      const row = selected.rows[0] as StoredFormationRow | undefined;
      if (!row) return { status: 'conflict', current: null };
      const current = decodeStored(row);
      if (
        current.internal_envelope_version !== input.expected_internal_envelope_version ||
        current.internal_envelope_hash !== input.expected_internal_envelope_hash
      ) {
        return { status: 'conflict', current };
      }
      const applied = applyEnvelopeCeremonyCommandV212({
        envelope: current.envelope,
        command: ceremonyCommandForV212(current.envelope, input.command_id, {
          type: 'enter_final_confirmation',
        }),
        execution_authority: TRUSTED_SYSTEM_AUTHORITY_V212,
      });
      if (applied.status === 'rejected') {
        return {
          status: 'domain_rejected',
          reason_code: applied.reason_code,
          message: applied.message,
        };
      }
      const updated = await client.query(
        `update ${SCHEMA}.formation_disputes
            set envelope = $1::jsonb, updated_at = clock_timestamp()
          where dispute_id = $2
            and internal_envelope_version = $3
            and internal_envelope_hash = $4
          returning ${selectedFormationColumns()}`,
        [
          encode(applied.envelope),
          id,
          current.internal_envelope_version,
          current.internal_envelope_hash,
        ],
      );
      const updatedRow = updated.rows[0] as StoredFormationRow | undefined;
      return updatedRow
        ? { status: 'committed', stored: decodeStored(updatedRow) }
        : { status: 'conflict', current };
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
