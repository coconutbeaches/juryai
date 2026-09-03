import { randomBytes, randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { canonicalSerialize, cloneCanonical } from '../v2/case-envelope.js';
import {
  FORMATION_INVITATION_CONTRACT_VERSION_V21,
  INVITATION_ACCOUNT_COMMITMENT_VERSION_V21,
  commitIntendedInvitationAccountV21,
  generateOpaqueInvitationTokenV21,
  hashOpaqueInvitationTokenV21,
  matchesIntendedInvitationAccountV21,
  normalizeInvitationEmailV21,
} from '../v2-1/invitation-contract.js';
import {
  invitationUnavailableResultV21,
  type InvitationIssuedResultV21,
  type RedeemFormationInvitationResultV21,
} from '../v2-1/invitation-service.js';
import {
  HASH_PATTERN_V212,
  ID_PATTERN_V212,
  TRUSTED_SYSTEM_AUTHORITY_V212,
  type CaseEnvelopeV212,
} from './case-envelope.js';
import { assertValidCaseEnvelopeV212 } from './contract-validator.js';
import { applyEnvelopeCeremonyCommandV212, ceremonyCommandForV212 } from './envelope-ceremony.js';

const SCHEMA = 'juryai_v21';
const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_INVITATION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_OPAQUE_TOKEN_INPUT_LENGTH = 512;
const AUTHORITY_BRAND: unique symbol = Symbol('juryai-v2.1.2-production-invitation');

export interface TrustedProductionInvitationAuthorityV212 {
  readonly authority_kind: 'trusted_v2_1_2_production_invitation';
  readonly [AUTHORITY_BRAND]: true;
}

const TRUSTED_PRODUCTION_INVITATION_AUTHORITY_V212: TrustedProductionInvitationAuthorityV212 =
  Object.freeze({
    authority_kind: 'trusted_v2_1_2_production_invitation',
    [AUTHORITY_BRAND]: true as const,
  });

/** Server composition obtains this capability only after the fail-closed switch check. */
export function productionInvitationAuthorityV212(
  enabled: boolean,
): TrustedProductionInvitationAuthorityV212 | null {
  return enabled ? TRUSTED_PRODUCTION_INVITATION_AUTHORITY_V212 : null;
}

function authorized(value: unknown): value is TrustedProductionInvitationAuthorityV212 {
  return value === TRUSTED_PRODUCTION_INVITATION_AUTHORITY_V212;
}

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
  expires_at_ms: string | number;
  consumed_at_ms: string | number | null;
}

export interface PostgresFormationInvitationRepositoryOptionsV212 extends PoolConfig {
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
  if (typeof value !== 'string' || !ID_PATTERN_V212.test(value)) {
    throw new TypeError(`${label} is invalid.`);
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
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function decodeEnvelopeRow(row: FormationDisputeRow): CaseEnvelopeV212 {
  const envelope = cloneCanonical(row.envelope as CaseEnvelopeV212);
  assertValidCaseEnvelopeV212(envelope);
  disputeId(envelope.control.case_id);
  if (
    safeInteger(row.internal_envelope_version, 'internal_envelope_version', 1) !==
      envelope.control.envelope_version ||
    hash(row.internal_envelope_hash, 'internal_envelope_hash') !== envelope.control.envelope_hash
  ) {
    throw new TypeError('Stored envelope identity disagrees with canonical V2.1.2 state.');
  }
  return envelope;
}

function opaqueTokenHashForLookup(token: unknown): string {
  const bounded =
    typeof token === 'string' && token.length <= MAX_OPAQUE_TOKEN_INPUT_LENGTH
      ? token
      : 'invalid-invitation-token';
  return hashOpaqueInvitationTokenV21(bounded);
}

export class PostgresFormationInvitationRepositoryV212 {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #secret: string | Uint8Array;
  readonly #ttl: number;
  readonly #clock: () => number;
  readonly #randomBytes: (size: number) => Uint8Array;
  readonly #randomUuid: () => string;

  constructor(options: PostgresFormationInvitationRepositoryOptionsV212) {
    const ttl = options.invitation_ttl_ms ?? DEFAULT_INVITATION_TTL_MS;
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_INVITATION_TTL_MS) {
      throw new TypeError('Invitation TTL is invalid.');
    }
    commitIntendedInvitationAccountV21(
      'secret-check@juryai.invalid',
      options.account_commitment_secret,
    );
    this.#secret = options.account_commitment_secret;
    this.#ttl = ttl;
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
        random_bytes: _bytes,
        random_uuid: _uuid,
        ...config
      } = options;
      this.#pool = new Pool(config);
      this.#ownsPool = true;
    }
  }

  async assertReady(): Promise<void> {
    const result = await this.#pool.query<{ ready: boolean }>(
      `select to_regclass($1 || '.formation_disputes') is not null
              and to_regclass($1 || '.formation_invitations') is not null
              and exists (
                select 1 from pg_constraint
                 where conname = 'formation_disputes_contract_pair_v212'
                   and conrelid = to_regclass($1 || '.formation_disputes')
              ) as ready`,
      [SCHEMA],
    );
    if (result.rows[0]?.ready !== true) {
      throw new Error('V2.1.2 invitation persistence is unavailable.');
    }
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  async issueInvitation(input: {
    authority: TrustedProductionInvitationAuthorityV212 | null;
    dispute_id: string;
    authenticated_subject_id: string;
    intended_account_email: string;
  }): Promise<InvitationIssuedResultV21 | ReturnType<typeof invitationUnavailableResultV21>> {
    if (!authorized(input.authority)) return invitationUnavailableResultV21();
    let id: string;
    let subject: string;
    let accountCommitment: string;
    try {
      id = disputeId(input.dispute_id);
      subject = canonicalId(input.authenticated_subject_id, 'authenticated_subject_id');
      accountCommitment = commitIntendedInvitationAccountV21(
        input.intended_account_email,
        this.#secret,
      );
    } catch {
      return invitationUnavailableResultV21();
    }
    const generated = generateOpaqueInvitationTokenV21(this.#randomBytes);
    const invitationId = `invitation_${this.#randomUuid()}`;
    const nowMs = safeInteger(this.#clock(), 'invitation clock');
    const expiresAtMs = safeInteger(nowMs + this.#ttl, 'invitation expiry');
    try {
      return await this.#transaction(async (client) => {
        if (!authorized(input.authority)) return invitationUnavailableResultV21();
        const selected = await client.query<FormationDisputeRow>(
          `select envelope, internal_envelope_version, internal_envelope_hash
             from ${SCHEMA}.formation_disputes
            where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2'
            for update`,
          [id],
        );
        if (!selected.rows[0]) return invitationUnavailableResultV21();
        const envelope = decodeEnvelopeRow(selected.rows[0]);
        if (
          envelope.parties.party_a.identity_assurance !== 'authenticated' ||
          envelope.parties.party_a.authenticated_subject_id !== subject ||
          envelope.parties.party_b.identity_assurance !== 'unbound' ||
          envelope.parties.party_b.authenticated_subject_id !== null
        ) {
          return invitationUnavailableResultV21();
        }
        await client.query(
          `insert into ${SCHEMA}.formation_invitations (
             invitation_id, dispute_id, target_party_id, issuer_party_id,
             issuer_principal_id, token_hash, intended_account_commitment_version,
             intended_account_commitment, invitation_contract_version, created_at, expires_at
           ) values (
             $1, $2, 'party_b', 'party_a', $3, $4, $5, $6, $7,
             to_timestamp($8::double precision / 1000.0),
             to_timestamp($9::double precision / 1000.0)
           )`,
          [
            invitationId,
            id,
            subject,
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

  async redeemInvitation(input: {
    authority: TrustedProductionInvitationAuthorityV212 | null;
    opaque_token: string;
    authenticated_subject_id: string;
    authenticated_email: string;
  }): Promise<RedeemFormationInvitationResultV21> {
    if (!authorized(input.authority)) return invitationUnavailableResultV21();
    const tokenHash = opaqueTokenHashForLookup(input.opaque_token);
    const nowMs = safeInteger(this.#clock(), 'redemption clock');
    let subject: string;
    let normalizedEmail: string;
    try {
      subject = canonicalId(input.authenticated_subject_id, 'authenticated_subject_id');
      normalizedEmail = normalizeInvitationEmailV21(input.authenticated_email);
    } catch {
      return invitationUnavailableResultV21();
    }
    try {
      return await this.#transaction(async (client) => {
        if (!authorized(input.authority)) return invitationUnavailableResultV21();
        const invitations = await client.query<InvitationRow>(
          `select invitation_id, dispute_id, target_party_id, issuer_party_id,
                  issuer_principal_id, token_hash, intended_account_commitment_version,
                  intended_account_commitment,
                  (extract(epoch from expires_at) * 1000)::bigint expires_at_ms,
                  case when consumed_at is null then null
                    else (extract(epoch from consumed_at) * 1000)::bigint end consumed_at_ms
             from ${SCHEMA}.formation_invitations
            where token_hash = $1 for update`,
          [tokenHash],
        );
        const invitation = invitations.rows[0];
        if (
          !invitation ||
          invitation.target_party_id !== 'party_b' ||
          invitation.issuer_party_id !== 'party_a' ||
          invitation.intended_account_commitment_version !==
            INVITATION_ACCOUNT_COMMITMENT_VERSION_V21 ||
          hash(invitation.token_hash, 'token_hash') !== tokenHash ||
          invitation.consumed_at_ms !== null ||
          nowMs >= safeInteger(invitation.expires_at_ms, 'expires_at_ms') ||
          !matchesIntendedInvitationAccountV21(
            normalizedEmail,
            hash(invitation.intended_account_commitment, 'intended_account_commitment'),
            this.#secret,
          )
        ) {
          return invitationUnavailableResultV21();
        }
        const id = disputeId(invitation.dispute_id);
        const issuer = canonicalId(invitation.issuer_principal_id, 'issuer_principal_id');
        const disputes = await client.query<FormationDisputeRow>(
          `select envelope, internal_envelope_version, internal_envelope_hash
             from ${SCHEMA}.formation_disputes
            where dispute_id = $1 and schema_version = 'juryai-case-envelope-v2.1.2'
            for update`,
          [id],
        );
        if (!disputes.rows[0]) return invitationUnavailableResultV21();
        const envelope = decodeEnvelopeRow(disputes.rows[0]);
        if (
          envelope.parties.party_a.authenticated_subject_id !== issuer ||
          issuer === subject ||
          envelope.parties.party_b.identity_assurance !== 'unbound' ||
          envelope.parties.party_b.authenticated_subject_id !== null
        ) {
          return invitationUnavailableResultV21();
        }
        const suffix = this.#randomUuid();
        const bindingEventId = `binding_party_b_${suffix}`;
        const command = ceremonyCommandForV212(envelope, `command_invitation_${suffix}`, {
          type: 'bind_party',
          party_slot: 'party_b',
          authenticated_subject_id: subject,
          binding_event_id: bindingEventId,
        });
        const applied = applyEnvelopeCeremonyCommandV212({
          envelope,
          command,
          execution_authority: TRUSTED_SYSTEM_AUTHORITY_V212,
        });
        if (applied.status !== 'applied') return invitationUnavailableResultV21();
        const updated = await client.query(
          `update ${SCHEMA}.formation_disputes
              set envelope = $1::jsonb, updated_at = clock_timestamp()
            where dispute_id = $2 and internal_envelope_version = $3 and internal_envelope_hash = $4`,
          [
            canonicalSerialize(applied.envelope as never),
            id,
            envelope.control.envelope_version,
            envelope.control.envelope_hash,
          ],
        );
        if (updated.rowCount !== 1) throw new Error('Invitation envelope CAS failed.');
        await client.query(`insert into ${SCHEMA}.formation_commands (record) values ($1::jsonb)`, [
          canonicalSerialize({
            dispute_id: id,
            party_id: 'party_b',
            command_id: command.command_id,
            base_envelope_version: envelope.control.envelope_version,
            base_envelope_hash: envelope.control.envelope_hash,
            resulting_envelope_version: applied.envelope.control.envelope_version,
            resulting_envelope_hash: applied.envelope.control.envelope_hash,
            authority_type: 'trusted_domain_system_v2_1_2',
            command: cloneCanonical(command),
            recorded_at_ms: nowMs,
          } as never),
        ]);
        const consumed = await client.query(
          `update ${SCHEMA}.formation_invitations
              set consumed_at = to_timestamp($1::double precision / 1000.0),
                  redeemed_principal_id = $2, redemption_event_id = $3,
                  redemption_envelope_version = $4, redemption_envelope_hash = $5
            where invitation_id = $6 and consumed_at is null`,
          [
            nowMs,
            subject,
            bindingEventId,
            applied.envelope.control.envelope_version,
            applied.envelope.control.envelope_hash,
            canonicalId(invitation.invitation_id, 'invitation_id'),
          ],
        );
        if (consumed.rowCount !== 1) throw new Error('Invitation consumption failed.');
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
