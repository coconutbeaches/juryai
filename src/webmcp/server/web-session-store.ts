import type { Pool } from 'pg';

const SCHEMA = 'juryai_p2';
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SUPABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface WebSessionRecord {
  session_id_hash: string;
  principal_id: string;
  auth_provider: 'supabase';
  auth_subject: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface WebSessionPersistence {
  createSession(record: WebSessionRecord): Promise<void>;
  findActiveSession(sessionIdHash: string, now: Date): Promise<WebSessionRecord | null>;
  revokeSession(sessionIdHash: string, revokedAt: Date): Promise<void>;
  hasDisclosureAcceptance(principalId: string, disclosureVersion: string): Promise<boolean>;
  acceptDisclosure(principalId: string, disclosureVersion: string, acceptedAt: Date): Promise<void>;
}

interface SessionRow {
  session_id_hash: unknown;
  principal_id: unknown;
  auth_provider: unknown;
  auth_subject: unknown;
  created_at: unknown;
  expires_at: unknown;
  revoked_at: unknown;
}

function date(value: unknown, label: string): Date {
  const decoded = value instanceof Date ? new Date(value) : new Date(String(value));
  if (Number.isNaN(decoded.getTime())) throw new TypeError(`Stored ${label} is not a date.`);
  return decoded;
}

function decodeSession(row: SessionRow): WebSessionRecord {
  const hash = String(row.session_id_hash);
  const subject = String(row.auth_subject);
  const principal = String(row.principal_id);
  if (!SHA256_HEX.test(hash)) throw new TypeError('Stored web session hash is malformed.');
  if (!SUPABASE_UUID.test(subject) || principal !== `supabase:${subject}`) {
    throw new TypeError('Stored web session principal is malformed.');
  }
  if (row.auth_provider !== 'supabase') {
    throw new TypeError('Stored web session provider is malformed.');
  }
  return {
    session_id_hash: hash,
    principal_id: principal,
    auth_provider: 'supabase',
    auth_subject: subject,
    created_at: date(row.created_at, 'created_at'),
    expires_at: date(row.expires_at, 'expires_at'),
    revoked_at: row.revoked_at === null ? null : date(row.revoked_at, 'revoked_at'),
  };
}

export class PostgresWebSessionStore implements WebSessionPersistence {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async assertReady(): Promise<void> {
    const result = await this.#pool.query<{ missing: string[] }>(
      `select array_remove(array[
                case when to_regclass($1 || '.web_sessions') is null then 'web_sessions' end,
                case when to_regclass($1 || '.disclosure_acceptances') is null
                  then 'disclosure_acceptances' end
              ], null) as missing`,
      [SCHEMA],
    );
    const missing = result.rows[0]?.missing ?? ['web_sessions', 'disclosure_acceptances'];
    if (missing.length > 0) {
      throw new Error(
        `JuryAI web persistence migration is incomplete; missing: ${missing.join(', ')}.`,
      );
    }
  }

  async createSession(record: WebSessionRecord): Promise<void> {
    await this.#pool.query(
      `insert into ${SCHEMA}.web_sessions (
         session_id_hash, principal_id, auth_provider, auth_subject,
         created_at, expires_at, revoked_at
       ) values ($1, $2, $3, $4::uuid, $5, $6, $7)`,
      [
        record.session_id_hash,
        record.principal_id,
        record.auth_provider,
        record.auth_subject,
        record.created_at,
        record.expires_at,
        record.revoked_at,
      ],
    );
  }

  async findActiveSession(sessionIdHash: string, now: Date): Promise<WebSessionRecord | null> {
    const result = await this.#pool.query<SessionRow>(
      `select session_id_hash, principal_id, auth_provider, auth_subject,
              created_at, expires_at, revoked_at
         from ${SCHEMA}.web_sessions
        where session_id_hash = $1
          and revoked_at is null
          and expires_at > $2`,
      [sessionIdHash, now],
    );
    const row = result.rows[0];
    return row === undefined ? null : decodeSession(row);
  }

  async revokeSession(sessionIdHash: string, revokedAt: Date): Promise<void> {
    await this.#pool.query(
      `update ${SCHEMA}.web_sessions
          set revoked_at = coalesce(revoked_at, $2)
        where session_id_hash = $1`,
      [sessionIdHash, revokedAt],
    );
  }

  async hasDisclosureAcceptance(principalId: string, disclosureVersion: string): Promise<boolean> {
    const result = await this.#pool.query<{ accepted: boolean }>(
      `select exists (
         select 1 from ${SCHEMA}.disclosure_acceptances
          where principal_id = $1 and disclosure_version = $2
       ) as accepted`,
      [principalId, disclosureVersion],
    );
    return result.rows[0]?.accepted === true;
  }

  async acceptDisclosure(
    principalId: string,
    disclosureVersion: string,
    acceptedAt: Date,
  ): Promise<void> {
    await this.#pool.query(
      `insert into ${SCHEMA}.disclosure_acceptances (
         principal_id, disclosure_version, accepted_at
       ) values ($1, $2, $3)
       on conflict (principal_id, disclosure_version) do nothing`,
      [principalId, disclosureVersion, acceptedAt],
    );
  }
}
