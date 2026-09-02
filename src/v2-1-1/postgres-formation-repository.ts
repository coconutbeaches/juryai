/** Private PostgreSQL persistence for production-dark V2.1.1 disputes. */

import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import {
  HASH_PATTERN_V211,
  ID_PATTERN_V211,
  isPartyScopedIdV211,
  partyAuthorityV211,
  type CaseEnvelopeV211,
  type PartyIdV211,
} from './case-envelope.js';
import { assertValidCaseEnvelopeV211 } from './contract-validator.js';
import {
  applyExternalRelaySubmissionV211,
  rebaseExternalRelaySubmissionV211,
  type ExternalRelaySubmissionV211,
} from './external-relay-submission.js';
import {
  FORMATION_PERSISTENCE_CONTRACT_VERSION_V211,
  FORMATION_PERSISTENCE_SCHEMA_V211,
  assertV211DisputePersistenceId,
  type ActiveFormationContextV211,
  type CommitExternalRelaySubmissionInputV211,
  type CommitExternalRelaySubmissionResultV211,
  type CommitControlledDisclosureInputV211,
  type CommitControlledDisclosureResultV211,
  type FormationCompilerRunAuditRecordV211,
  type FormationPartyPersistenceContextV211,
  type FormationReplayRecordV211,
  type FormationReplayResponseV211,
  type FormationSourceAuditRecordV211,
  type FormationSubmissionAuditRecordV211,
  type StoredFormationDisputeV211,
} from './formation-persistence.js';
import { applyEnvelopeCeremonyCommandV211, ceremonyCommandForV211 } from './envelope-ceremony.js';
import { TRUSTED_SYSTEM_AUTHORITY_V211 } from './case-envelope.js';

const SCHEMA = FORMATION_PERSISTENCE_SCHEMA_V211;
const MAX_CLIENT_TURN_ID_LENGTH = 200;

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

export interface PostgresFormationRepositoryOptionsV211 extends PoolConfig {
  pool?: Pool;
}

function postgresCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null;
}

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

function boundedString(value: unknown, label: string, maximum = 160): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function canonicalId(value: unknown, label: string): string {
  const decoded = boundedString(value, label);
  if (!ID_PATTERN_V211.test(decoded)) throw new TypeError(`${label} is not canonical.`);
  return decoded;
}

function clientTurnId(value: unknown): string {
  const decoded = boundedString(value, 'client_turn_id', MAX_CLIENT_TURN_ID_LENGTH);
  if (decoded.trim().length === 0) throw new TypeError('client_turn_id must not be blank.');
  return decoded;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN_V211.test(value)) {
    throw new TypeError(`${label} is not a SHA-256 digest.`);
  }
  return value;
}

function partyId(value: unknown): PartyIdV211 {
  if (value !== 'party_a' && value !== 'party_b') throw new TypeError('Party id is invalid.');
  return value;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  ) {
    throw new TypeError(`${label} has an invalid shape.`);
  }
  return value as Record<string, unknown>;
}

function decodeEnvelope(value: unknown): CaseEnvelopeV211 {
  const envelope = cloneCanonical(value as CaseEnvelopeV211);
  assertValidCaseEnvelopeV211(envelope);
  assertV211DisputePersistenceId(envelope.control.case_id);
  return envelope;
}

function decodeStored(row: StoredFormationRow): StoredFormationDisputeV211 {
  const envelope = decodeEnvelope(row.envelope);
  const version = safeInteger(row.internal_envelope_version, 'internal_envelope_version', 1);
  const envelopeHash = hash(row.internal_envelope_hash, 'internal_envelope_hash');
  if (
    version !== envelope.control.envelope_version ||
    envelopeHash !== envelope.control.envelope_hash
  ) {
    throw new TypeError('Stored envelope identity disagrees with canonical V2.1.1 state.');
  }
  return {
    envelope,
    internal_envelope_version: version,
    internal_envelope_hash: envelopeHash,
    created_at_ms: safeInteger(row.created_at_ms, 'created_at_ms'),
    updated_at_ms: safeInteger(row.updated_at_ms, 'updated_at_ms'),
  };
}

function partyForSubject(envelope: CaseEnvelopeV211, subjectId: string): PartyIdV211 | null {
  const matches = (['party_a', 'party_b'] as const).filter((candidate) => {
    const binding = envelope.parties[candidate];
    return (
      binding.identity_assurance === 'authenticated' &&
      binding.authenticated_subject_id === subjectId
    );
  });
  return matches.length === 1 ? matches[0]! : null;
}

function selectedFormationColumns(alias = ''): string {
  const prefix = alias.length > 0 ? `${alias}.` : '';
  return `${prefix}envelope,
          ${prefix}internal_envelope_version,
          ${prefix}internal_envelope_hash,
          (extract(epoch from ${prefix}created_at) * 1000)::bigint as created_at_ms,
          (extract(epoch from ${prefix}updated_at) * 1000)::bigint as updated_at_ms`;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
  return value.map((entry, index) => canonicalId(entry, `${label}[${index}]`));
}

function scopedIdArray(
  value: unknown,
  label: string,
  kind: Parameters<typeof isPartyScopedIdV211>[0],
  party: PartyIdV211,
): string[] {
  const decoded = stringArray(value, label);
  if (
    new Set(decoded).size !== decoded.length ||
    !decoded.every((identifier) => isPartyScopedIdV211(kind, party, identifier))
  ) {
    throw new TypeError(`${label} is not a unique party-scoped identity list.`);
  }
  return decoded;
}

function replayResponse(value: unknown): FormationReplayResponseV211 {
  const record = exactObject(
    value,
    [
      'accepted_position_ids',
      'challenge_ids',
      'challenge_response_ids',
      'dispute_id',
      'opened_clarification_ids',
      'party_id',
      'persistence_contract_version',
      'resulting_internal_envelope_hash',
      'resulting_internal_envelope_version',
      'resulting_party_projection_hash',
      'resulting_party_visible_version',
      'resolved_clarification_ids',
      'source_turn_id',
      'submission_id',
      'superseded_position_ids',
      'warnings',
    ],
    'V2.1.1 replay response',
  );
  if (record.persistence_contract_version !== FORMATION_PERSISTENCE_CONTRACT_VERSION_V211) {
    throw new TypeError('Replay persistence contract version is invalid.');
  }
  const disputeId = boundedString(record.dispute_id, 'replay dispute id');
  assertV211DisputePersistenceId(disputeId);
  const decodedParty = partyId(record.party_id);
  if (
    !Array.isArray(record.warnings) ||
    !record.warnings.every((warning) => typeof warning === 'string')
  ) {
    throw new TypeError('Replay warnings are invalid.');
  }
  return {
    persistence_contract_version: FORMATION_PERSISTENCE_CONTRACT_VERSION_V211,
    dispute_id: disputeId,
    party_id: decodedParty,
    submission_id: (() => {
      const identifier = canonicalId(record.submission_id, 'replay submission id');
      if (!identifier.startsWith(`submission_${decodedParty}_`)) {
        throw new TypeError('Replay submission id is not party-scoped.');
      }
      return identifier;
    })(),
    source_turn_id: (() => {
      const identifier = canonicalId(record.source_turn_id, 'replay source turn id');
      if (!isPartyScopedIdV211('turn', decodedParty, identifier)) {
        throw new TypeError('Replay source turn id is not party-scoped.');
      }
      return identifier;
    })(),
    accepted_position_ids: scopedIdArray(
      record.accepted_position_ids,
      'accepted_position_ids',
      'position',
      decodedParty,
    ),
    superseded_position_ids: scopedIdArray(
      record.superseded_position_ids,
      'superseded_position_ids',
      'position',
      decodedParty,
    ),
    opened_clarification_ids: scopedIdArray(
      record.opened_clarification_ids,
      'opened_clarification_ids',
      'clarification',
      decodedParty,
    ),
    resolved_clarification_ids: scopedIdArray(
      record.resolved_clarification_ids,
      'resolved_clarification_ids',
      'clarification',
      decodedParty,
    ),
    challenge_ids: scopedIdArray(record.challenge_ids, 'challenge_ids', 'challenge', decodedParty),
    challenge_response_ids: scopedIdArray(
      record.challenge_response_ids,
      'challenge_response_ids',
      'challenge_response',
      decodedParty,
    ),
    warnings: [...record.warnings],
    resulting_internal_envelope_version: safeInteger(
      record.resulting_internal_envelope_version,
      'resulting internal envelope version',
      1,
    ),
    resulting_internal_envelope_hash: hash(
      record.resulting_internal_envelope_hash,
      'resulting internal envelope hash',
    ),
    resulting_party_visible_version: safeInteger(
      record.resulting_party_visible_version,
      'resulting party visible version',
      1,
    ),
    resulting_party_projection_hash: hash(
      record.resulting_party_projection_hash,
      'resulting party projection hash',
    ),
  };
}

function decodeReplay(value: unknown): FormationReplayRecordV211 {
  const record = exactObject(
    value,
    [
      'client_turn_id',
      'dispute_id',
      'party_id',
      'recorded_at_ms',
      'request_fingerprint',
      'response',
    ],
    'V2.1.1 replay record',
  );
  const response = replayResponse(record.response);
  const decodedParty = partyId(record.party_id);
  const disputeId = boundedString(record.dispute_id, 'replay dispute id');
  if (response.party_id !== decodedParty || response.dispute_id !== disputeId) {
    throw new TypeError('Replay response identity disagrees with its record.');
  }
  return {
    dispute_id: disputeId,
    party_id: decodedParty,
    client_turn_id: clientTurnId(record.client_turn_id),
    request_fingerprint: hash(record.request_fingerprint, 'request fingerprint'),
    response,
    recorded_at_ms: safeInteger(record.recorded_at_ms, 'recorded_at_ms'),
  };
}

function encode(value: unknown): string {
  return canonicalSerialize(value);
}

function validateCommitInput(input: CommitExternalRelaySubmissionInputV211): void {
  canonicalId(input.source_id, 'source_id');
  safeInteger(input.recorded_at_ms, 'recorded_at_ms');
  canonicalSerialize(input.submission);
  if (
    input.submission.dispute_id !== input.context.dispute_id ||
    input.submission.source_turn.attributed_party_id !== input.context.party_id
  ) {
    throw new TypeError('Submission identity disagrees with the resolved persistence context.');
  }
}

function makeReplayResponse(
  submission: ExternalRelaySubmissionV211,
  envelope: CaseEnvelopeV211,
  party: PartyIdV211,
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

export class PostgresFormationRepositoryV211 {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #issuedContexts = new WeakSet<object>();

  constructor(options: PostgresFormationRepositoryOptionsV211) {
    if (options.pool) {
      this.#pool = options.pool;
      this.#ownsPool = false;
    } else {
      const { pool: _pool, ...config } = options;
      this.#pool = new Pool(config);
      this.#ownsPool = true;
    }
  }

  async assertReady(): Promise<void> {
    const result = await this.#pool.query<{ ready: boolean }>(
      `select to_regnamespace($1) is not null
              and to_regclass($1 || '.formation_disputes') is not null
              and to_regclass($1 || '.formation_sources') is not null
              and to_regclass($1 || '.formation_submissions') is not null
              and to_regclass($1 || '.formation_compiler_runs') is not null
              and to_regclass($1 || '.formation_replays') is not null
              and exists (
                select 1 from information_schema.columns
                 where table_schema = $1 and table_name = 'formation_disputes'
                   and column_name = 'external_submission_contract_version'
              ) as ready`,
      [SCHEMA],
    );
    if (result.rows[0]?.ready !== true) {
      throw new Error('V2.1.1 formation persistence migration is incomplete.');
    }
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  async findById(disputeId: string): Promise<StoredFormationDisputeV211 | null> {
    assertV211DisputePersistenceId(disputeId);
    const result = await this.#pool.query(
      `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes where dispute_id = $1`,
      [disputeId],
    );
    return result.rows[0] ? decodeStored(result.rows[0] as StoredFormationRow) : null;
  }

  /** Test/bootstrap-only dark persistence seam. No production module imports it. */
  async createDispute(
    envelopeInput: CaseEnvelopeV211,
  ): Promise<{ created: boolean; stored: StoredFormationDisputeV211 }> {
    const envelope = decodeEnvelope(envelopeInput);
    return this.#transaction(async (client) => {
      const inserted = await client.query(
        `insert into ${SCHEMA}.formation_disputes (envelope) values ($1::jsonb)
         on conflict (dispute_id) do nothing returning ${selectedFormationColumns()}`,
        [encode(envelope)],
      );
      if (inserted.rows[0])
        return { created: true, stored: decodeStored(inserted.rows[0] as StoredFormationRow) };
      const found = await client.query(
        `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes where dispute_id = $1`,
        [envelope.control.case_id],
      );
      const row = found.rows[0] as StoredFormationRow | undefined;
      if (!row) throw new Error('Formation dispute conflict could not be read back.');
      const stored = decodeStored(row);
      if (encode(stored.envelope) !== encode(envelope)) {
        throw new TypeError('A different V2.1.1 envelope already uses this dispute id.');
      }
      return { created: false, stored };
    });
  }

  async listActiveContextsForPrincipal(
    subjectInput: string,
  ): Promise<ActiveFormationContextV211[]> {
    const subjectId = canonicalId(subjectInput, 'authenticated subject id');
    const result = await this.#pool.query(
      `select ${selectedFormationColumns('dispute')},
              case when dispute.party_a_principal_id = $1 then 'party_a'
                   when dispute.party_b_principal_id = $1 then 'party_b' end as party_id
         from ${SCHEMA}.formation_disputes as dispute
        where dispute.party_a_principal_id = $1 or dispute.party_b_principal_id = $1
        order by dispute.dispute_id`,
      [subjectId],
    );
    return result.rows.map((raw) => {
      const row = raw as ContextRow;
      const stored = decodeStored(row);
      const party = partyId(row.party_id);
      if (partyForSubject(stored.envelope, subjectId) !== party) {
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
    disputeId: string,
    subjectInput: string,
  ): Promise<FormationPartyPersistenceContextV211 | null> {
    assertV211DisputePersistenceId(disputeId);
    const subjectId = canonicalId(subjectInput, 'authenticated subject id');
    const result = await this.#pool.query(
      `select ${selectedFormationColumns('dispute')},
              case when dispute.party_a_principal_id = $2 then 'party_a'
                   when dispute.party_b_principal_id = $2 then 'party_b' end as party_id
         from ${SCHEMA}.formation_disputes as dispute
        where dispute.dispute_id = $1
          and (dispute.party_a_principal_id = $2 or dispute.party_b_principal_id = $2)`,
      [disputeId, subjectId],
    );
    const row = result.rows[0] as ContextRow | undefined;
    if (!row) return null;
    const stored = decodeStored(row);
    const party = partyId(row.party_id);
    if (partyForSubject(stored.envelope, subjectId) !== party) {
      throw new TypeError('Generated party lookup disagrees with canonical binding.');
    }
    const cursor = stored.envelope.control.party_views[party];
    const context: FormationPartyPersistenceContextV211 = Object.freeze({
      dispute_id: disputeId,
      party_id: party,
      authenticated_subject_id: subjectId,
      internal_envelope_version: stored.internal_envelope_version,
      internal_envelope_hash: stored.internal_envelope_hash,
      party_visible_version: cursor.party_visible_version,
      party_projection_hash: cursor.party_projection_hash,
    });
    this.#issuedContexts.add(context);
    return context;
  }

  async readReplay(
    context: FormationPartyPersistenceContextV211,
    clientTurnInput: string,
  ): Promise<FormationReplayResponseV211 | null> {
    return (await this.readReplayRecord(context, clientTurnInput))?.response ?? null;
  }

  /** Application precheck: keeps fingerprint conflicts ahead of compilation. */
  async readReplayRecord(
    context: FormationPartyPersistenceContextV211,
    clientTurnInput: string,
  ): Promise<FormationReplayRecordV211 | null> {
    if (!this.#issuedContexts.has(context)) return null;
    const turn = clientTurnId(clientTurnInput);
    const result = await this.#pool.query(
      `select replay.record
         from ${SCHEMA}.formation_replays as replay
         join ${SCHEMA}.formation_disputes as dispute using (dispute_id)
        where replay.dispute_id = $1 and replay.party_id = $2 and replay.client_turn_id = $3
          and (($2 = 'party_a' and dispute.party_a_principal_id = $4)
            or ($2 = 'party_b' and dispute.party_b_principal_id = $4))`,
      [context.dispute_id, context.party_id, turn, context.authenticated_subject_id],
    );
    const row = result.rows[0] as ReplayRow | undefined;
    return row ? decodeReplay(row.record) : null;
  }

  async commitExternalRelaySubmission(
    input: CommitExternalRelaySubmissionInputV211,
  ): Promise<CommitExternalRelaySubmissionResultV211> {
    if (!this.#issuedContexts.has(input.context))
      return { status: 'unauthorized', replayed: false };
    validateCommitInput(input);
    return this.#transaction(async (client) => {
      const selected = await client.query(
        `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
          where dispute_id = $1 for update`,
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
        const rebased = rebaseExternalRelaySubmissionV211(submission, current.envelope);
        if (!rebased) return { status: 'conflict', replayed: false, current };
        submission = rebased;
        hiddenStateRebased = true;
      }

      const applied = applyExternalRelaySubmissionV211({
        envelope: current.envelope,
        submission,
        execution_authority: partyAuthorityV211(current.envelope, party, 'external_relay'),
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
        `update ${SCHEMA}.formation_disputes set envelope = $1::jsonb, updated_at = clock_timestamp()
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

      const response = makeReplayResponse(submission, applied.envelope, party, applied.result);
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

  /**
   * Trusted application seam for the single controlled-disclosure transition.
   * It accepts no actor or role input and is not wired to a production route.
   * The existing command audit relation is party-scoped; disclosure is a joint
   * system transition, so this does not invent a party-attributed audit row.
   * The updated envelope remains the sole canonical record of the transition.
   */
  async commitControlledDisclosure(
    input: CommitControlledDisclosureInputV211,
  ): Promise<CommitControlledDisclosureResultV211> {
    assertV211DisputePersistenceId(input.dispute_id);
    canonicalId(input.command_id, 'command_id');
    safeInteger(input.expected_internal_envelope_version, 'expected_internal_envelope_version', 1);
    hash(input.expected_internal_envelope_hash, 'expected_internal_envelope_hash');
    return this.#transaction(async (client) => {
      const selected = await client.query(
        `select ${selectedFormationColumns()} from ${SCHEMA}.formation_disputes
          where dispute_id = $1 for update`,
        [input.dispute_id],
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
      const applied = applyEnvelopeCeremonyCommandV211({
        envelope: current.envelope,
        command: ceremonyCommandForV211(current.envelope, input.command_id, {
          type: 'open_controlled_disclosure',
        }),
        execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
      });
      if (applied.status === 'rejected') {
        return {
          status: 'domain_rejected',
          reason_code: applied.reason_code,
          message: applied.message,
        };
      }
      const updated = await client.query(
        `update ${SCHEMA}.formation_disputes set envelope = $1::jsonb, updated_at = clock_timestamp()
          where dispute_id = $2 and internal_envelope_version = $3 and internal_envelope_hash = $4
          returning ${selectedFormationColumns()}`,
        [
          encode(applied.envelope),
          input.dispute_id,
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
        throw new TypeError('V2.1.1 audit identity already exists in this party scope.');
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
