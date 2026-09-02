/**
 * Private PostgreSQL bootstrap for test-enabled V2.1 Party B invitations.
 * No production route or WebMCP module imports this repository in PR 3.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import {
  HASH_PATTERN_V21,
  ID_PATTERN_V21,
  TRUSTED_SYSTEM_AUTHORITY_V21,
  type CaseEnvelopeV21,
} from './case-envelope.js';
import { assertValidCaseEnvelopeV21 } from './contract-validator.js';
import { applyEnvelopeCommandV21, commandForV21 } from './envelope-command.js';
import { assertV21DisputePersistenceId } from './formation-persistence.js';
import {
  FORMATION_INVITATION_CONTRACT_VERSION_V21,
  INVITATION_ACCOUNT_COMMITMENT_VERSION_V21,
  commitIntendedInvitationAccountV21,
  generateOpaqueInvitationTokenV21,
  hashOpaqueInvitationTokenV21,
  isAuthenticatedInvitationPrincipalV21,
  isTestOnlyInvitationFeatureEnabledV21,
  isTrustedFirstPartyInvitationActionV21,
  matchesIntendedInvitationAccountV21,
} from './invitation-contract.js';
import {
  invitationUnavailableResultV21,
  type FormationInvitationPersistencePortV21,
  type IssueFormationInvitationPersistenceInputV21,
  type IssueFormationInvitationResultV21,
  type RedeemFormationInvitationPersistenceInputV21,
  type RedeemFormationInvitationResultV21,
} from './invitation-service.js';

const SCHEMA = 'juryai_v21';
const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_INVITATION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_OPAQUE_TOKEN_INPUT_LENGTH = 512;

interface FormationDisputeRow {
  envelope: unknown;
  internal_envelope_version: string | number;
  internal_envelope_hash: unknown;
}

interface InvitationRow {
  invitation_id: unknown;
  dispute_id: unknown;
  target_party_id: unknown;
  issuer_party_id: unknown;
  issuer_principal_id: unknown;
  token_hash: unknown;
  intended_account_commitment_version: unknown;
  intended_account_commitment: unknown;
  created_at_ms: string | number;
  expires_at_ms: string | number;
  consumed_at_ms: string | number | null;
}

interface DecodedInvitationRow {
  invitation_id: string;
  dispute_id: string;
  target_party_id: 'party_b';
  issuer_party_id: 'party_a';
  issuer_principal_id: string;
  token_hash: string;
  intended_account_commitment_version: typeof INVITATION_ACCOUNT_COMMITMENT_VERSION_V21;
  intended_account_commitment: string;
  created_at_ms: number;
  expires_at_ms: number;
  consumed_at_ms: number | null;
}

export interface PostgresFormationInvitationRepositoryOptionsV21 extends PoolConfig {
  pool?: Pool;
  account_commitment_secret: string | Uint8Array;
  invitation_ttl_ms?: number;
  clock?: () => number;
  random_bytes?: (size: number) => Uint8Array;
  random_uuid?: () => string;
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

function canonicalId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN_V21.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN_V21.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function decodeEnvelopeRow(row: FormationDisputeRow): CaseEnvelopeV21 {
  const envelope = cloneCanonical(row.envelope as CaseEnvelopeV21);
  assertValidCaseEnvelopeV21(envelope);
  assertV21DisputePersistenceId(envelope.control.case_id);
  const storedVersion = safeInteger(row.internal_envelope_version, 'internal_envelope_version', 1);
  const storedHash = hash(row.internal_envelope_hash, 'internal_envelope_hash');
  if (
    storedVersion !== envelope.control.envelope_version ||
    storedHash !== envelope.control.envelope_hash
  ) {
    throw new TypeError('Stored envelope identity disagrees with canonical V2.1 state.');
  }
  return envelope;
}

function decodeInvitationRow(row: InvitationRow): DecodedInvitationRow {
  const disputeId = canonicalId(row.dispute_id, 'invitation dispute id');
  assertV21DisputePersistenceId(disputeId);
  if (row.target_party_id !== 'party_b' || row.issuer_party_id !== 'party_a') {
    throw new TypeError('Invitation party provenance is invalid.');
  }
  if (row.intended_account_commitment_version !== INVITATION_ACCOUNT_COMMITMENT_VERSION_V21) {
    throw new TypeError('Invitation account commitment version is invalid.');
  }
  return {
    invitation_id: canonicalId(row.invitation_id, 'invitation id'),
    dispute_id: disputeId,
    target_party_id: 'party_b',
    issuer_party_id: 'party_a',
    issuer_principal_id: canonicalId(row.issuer_principal_id, 'invitation issuer principal'),
    token_hash: hash(row.token_hash, 'invitation token hash'),
    intended_account_commitment_version: INVITATION_ACCOUNT_COMMITMENT_VERSION_V21,
    intended_account_commitment: hash(
      row.intended_account_commitment,
      'intended account commitment',
    ),
    created_at_ms: safeInteger(row.created_at_ms, 'invitation created_at_ms'),
    expires_at_ms: safeInteger(row.expires_at_ms, 'invitation expires_at_ms'),
    consumed_at_ms:
      row.consumed_at_ms === null
        ? null
        : safeInteger(row.consumed_at_ms, 'invitation consumed_at_ms'),
  };
}

function opaqueTokenHashForLookup(token: unknown): string {
  const bounded =
    typeof token === 'string' && token.length <= MAX_OPAQUE_TOKEN_INPUT_LENGTH
      ? token
      : 'invalid-invitation-token';
  return hashOpaqueInvitationTokenV21(bounded);
}

class RedemptionRollbackV21 extends Error {}

export class PostgresFormationInvitationRepositoryV21 implements FormationInvitationPersistencePortV21 {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #accountCommitmentSecret: string | Uint8Array;
  readonly #invitationTtlMs: number;
  readonly #clock: () => number;
  readonly #randomBytes: (size: number) => Uint8Array;
  readonly #randomUuid: () => string;

  constructor(options: PostgresFormationInvitationRepositoryOptionsV21) {
    const ttl = options.invitation_ttl_ms ?? DEFAULT_INVITATION_TTL_MS;
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_INVITATION_TTL_MS) {
      throw new TypeError('Invitation TTL is invalid.');
    }
    commitIntendedInvitationAccountV21(
      'secret-check@juryai.invalid',
      options.account_commitment_secret,
    );
    this.#accountCommitmentSecret = options.account_commitment_secret;
    this.#invitationTtlMs = ttl;
    this.#clock = options.clock ?? Date.now;
    this.#randomBytes = options.random_bytes ?? randomBytes;
    this.#randomUuid = options.random_uuid ?? randomUUID;
    if (options.pool) {
      this.#pool = options.pool;
      this.#ownsPool = false;
    } else {
      const {
        pool: _pool,
        account_commitment_secret: _secret,
        invitation_ttl_ms: _ttl,
        clock: _clock,
        random_bytes: _randomBytes,
        random_uuid: _randomUuid,
        ...config
      } = options;
      this.#pool = new Pool(config);
      this.#ownsPool = true;
    }
  }

  async assertReady(): Promise<void> {
    const result = await this.#pool.query<{ ready: boolean }>(
      `select to_regnamespace($1) is not null
              and to_regclass($1 || '.formation_disputes') is not null
              and to_regclass($1 || '.formation_invitations') is not null as ready`,
      [SCHEMA],
    );
    if (result.rows[0]?.ready !== true) {
      throw new Error('V2.1 formation invitation persistence migration is incomplete.');
    }
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  async issueInvitation(
    input: IssueFormationInvitationPersistenceInputV21,
  ): Promise<IssueFormationInvitationResultV21> {
    if (
      !isTestOnlyInvitationFeatureEnabledV21(input.feature_authority) ||
      !isTrustedFirstPartyInvitationActionV21(input.first_party_authority) ||
      !isAuthenticatedInvitationPrincipalV21(input.authenticated_principal)
    ) {
      return invitationUnavailableResultV21();
    }
    let disputeId: string;
    let accountCommitment: string;
    try {
      disputeId = canonicalId(input.dispute_id, 'dispute id');
      assertV21DisputePersistenceId(disputeId);
      accountCommitment = commitIntendedInvitationAccountV21(
        input.intended_account_email,
        this.#accountCommitmentSecret,
      );
    } catch {
      return invitationUnavailableResultV21();
    }

    const generated = generateOpaqueInvitationTokenV21(this.#randomBytes);
    const invitationId = `invitation_${this.#randomUuid()}`;
    const nowMs = safeInteger(this.#clock(), 'invitation clock');
    const expiresAtMs = safeInteger(nowMs + this.#invitationTtlMs, 'invitation expiry');

    try {
      return await this.#transaction(async (client) => {
        if (!isTestOnlyInvitationFeatureEnabledV21(input.feature_authority)) {
          return invitationUnavailableResultV21();
        }
        if (!isTrustedFirstPartyInvitationActionV21(input.first_party_authority)) {
          return invitationUnavailableResultV21();
        }
        const selected = await client.query<FormationDisputeRow>(
          `select envelope, internal_envelope_version, internal_envelope_hash
             from ${SCHEMA}.formation_disputes
            where dispute_id = $1
            for update`,
          [disputeId],
        );
        const row = selected.rows[0];
        if (!row) return invitationUnavailableResultV21();
        const envelope = decodeEnvelopeRow(row);
        const issuer = envelope.parties.party_a;
        const target = envelope.parties.party_b;
        if (
          issuer.identity_assurance !== 'authenticated' ||
          issuer.authenticated_subject_id !==
            input.authenticated_principal.authenticated_subject_id ||
          target.identity_assurance !== 'unbound' ||
          target.authenticated_subject_id !== null
        ) {
          return invitationUnavailableResultV21();
        }

        await client.query(
          `insert into ${SCHEMA}.formation_invitations (
             invitation_id,
             dispute_id,
             target_party_id,
             issuer_party_id,
             issuer_principal_id,
             token_hash,
             intended_account_commitment_version,
             intended_account_commitment,
             invitation_contract_version,
             created_at,
             expires_at
           ) values (
             $1, $2, 'party_b', 'party_a', $3, $4, $5, $6, $7,
             to_timestamp($8::double precision / 1000.0),
             to_timestamp($9::double precision / 1000.0)
           )`,
          [
            invitationId,
            disputeId,
            issuer.authenticated_subject_id,
            generated.token_hash,
            INVITATION_ACCOUNT_COMMITMENT_VERSION_V21,
            accountCommitment,
            FORMATION_INVITATION_CONTRACT_VERSION_V21,
            nowMs,
            expiresAtMs,
          ],
        );
        return {
          status: 'issued',
          invitation_id: invitationId,
          opaque_token: generated.opaque_token,
          csurl_path: `/join/${generated.opaque_token}`,
          expires_at: new Date(expiresAtMs).toISOString(),
        };
      });
    } catch {
      return invitationUnavailableResultV21();
    }
  }

  async redeemInvitation(
    input: RedeemFormationInvitationPersistenceInputV21,
  ): Promise<RedeemFormationInvitationResultV21> {
    if (
      !isTestOnlyInvitationFeatureEnabledV21(input.feature_authority) ||
      !isTrustedFirstPartyInvitationActionV21(input.first_party_authority) ||
      !isAuthenticatedInvitationPrincipalV21(input.authenticated_principal)
    ) {
      return invitationUnavailableResultV21();
    }
    const tokenHash = opaqueTokenHashForLookup(input.opaque_token);
    const nowMs = safeInteger(this.#clock(), 'redemption clock');

    try {
      return await this.#transaction(async (client) => {
        if (!isTestOnlyInvitationFeatureEnabledV21(input.feature_authority)) {
          return invitationUnavailableResultV21();
        }
        if (!isTrustedFirstPartyInvitationActionV21(input.first_party_authority)) {
          return invitationUnavailableResultV21();
        }
        const invitationResult = await client.query<InvitationRow>(
          `select invitation_id,
                  dispute_id,
                  target_party_id,
                  issuer_party_id,
                  issuer_principal_id,
                  token_hash,
                  intended_account_commitment_version,
                  intended_account_commitment,
                  (extract(epoch from created_at) * 1000)::bigint as created_at_ms,
                  (extract(epoch from expires_at) * 1000)::bigint as expires_at_ms,
                  case when consumed_at is null then null
                    else (extract(epoch from consumed_at) * 1000)::bigint end as consumed_at_ms
             from ${SCHEMA}.formation_invitations
            where token_hash = $1
            for update`,
          [tokenHash],
        );
        const invitationRow = invitationResult.rows[0];
        if (!invitationRow) return invitationUnavailableResultV21();
        const invitation = decodeInvitationRow(invitationRow);
        if (
          invitation.token_hash !== tokenHash ||
          invitation.consumed_at_ms !== null ||
          nowMs >= invitation.expires_at_ms ||
          !matchesIntendedInvitationAccountV21(
            input.authenticated_principal.normalized_email,
            invitation.intended_account_commitment,
            this.#accountCommitmentSecret,
          )
        ) {
          return invitationUnavailableResultV21();
        }

        const disputeResult = await client.query<FormationDisputeRow>(
          `select envelope, internal_envelope_version, internal_envelope_hash
             from ${SCHEMA}.formation_disputes
            where dispute_id = $1
            for update`,
          [invitation.dispute_id],
        );
        const disputeRow = disputeResult.rows[0];
        if (!disputeRow) return invitationUnavailableResultV21();
        const envelope = decodeEnvelopeRow(disputeRow);
        const issuer = envelope.parties.party_a;
        const target = envelope.parties.party_b;
        if (
          invitation.target_party_id !== 'party_b' ||
          invitation.issuer_party_id !== 'party_a' ||
          issuer.identity_assurance !== 'authenticated' ||
          issuer.authenticated_subject_id !== invitation.issuer_principal_id ||
          issuer.authenticated_subject_id ===
            input.authenticated_principal.authenticated_subject_id ||
          target.identity_assurance !== 'unbound' ||
          target.authenticated_subject_id !== null
        ) {
          return invitationUnavailableResultV21();
        }

        const suffix = this.#randomUuid();
        const redemptionEventId = `binding_party_b_${suffix}`;
        const command = commandForV21(envelope, `command_invitation_${suffix}`, {
          type: 'bind_party',
          party_slot: 'party_b',
          authenticated_subject_id: input.authenticated_principal.authenticated_subject_id,
          binding_event_id: redemptionEventId,
        });
        const applied = applyEnvelopeCommandV21({
          envelope,
          command,
          execution_authority: TRUSTED_SYSTEM_AUTHORITY_V21,
        });
        if (applied.status !== 'applied') return invitationUnavailableResultV21();

        const updatedDispute = await client.query(
          `update ${SCHEMA}.formation_disputes
              set envelope = $1::jsonb, updated_at = clock_timestamp()
            where dispute_id = $2
              and internal_envelope_version = $3
              and internal_envelope_hash = $4`,
          [
            canonicalSerialize(applied.envelope),
            invitation.dispute_id,
            envelope.control.envelope_version,
            envelope.control.envelope_hash,
          ],
        );
        if (updatedDispute.rowCount !== 1) {
          throw new RedemptionRollbackV21('Authoritative envelope CAS failed.');
        }

        const consumed = await client.query(
          `update ${SCHEMA}.formation_invitations
              set consumed_at = to_timestamp($1::double precision / 1000.0),
                  redeemed_principal_id = $2,
                  redemption_event_id = $3,
                  redemption_envelope_version = $4,
                  redemption_envelope_hash = $5
            where invitation_id = $6 and consumed_at is null`,
          [
            nowMs,
            input.authenticated_principal.authenticated_subject_id,
            redemptionEventId,
            applied.envelope.control.envelope_version,
            applied.envelope.control.envelope_hash,
            invitation.invitation_id,
          ],
        );
        if (consumed.rowCount !== 1) {
          throw new RedemptionRollbackV21('Invitation consumption failed.');
        }
        return { status: 'redeemed' };
      });
    } catch {
      return invitationUnavailableResultV21();
    }
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
      throw error;
    } finally {
      client.release();
    }
  }
}
