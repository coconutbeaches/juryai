import { createHash, randomBytes } from 'node:crypto';
import type { RuntimeRequestContext } from '../runtime/index.js';
import type { TrustedRuntimeRequestContextProvider } from '../service/index.js';
import type { JuryAiCookieConfig } from './config.js';
import type { WebSessionPersistence, WebSessionRecord } from './web-session-store.js';

export const WEB_SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
export const WEB_SESSION_LIFETIME_MS = WEB_SESSION_LIFETIME_SECONDS * 1_000;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type SessionTokenFactory = () => string;

export const randomSessionToken: SessionTokenFactory = () => randomBytes(32).toString('base64url');

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function principalForSupabaseSubject(subject: string): string {
  return `supabase:${subject}`;
}

export interface IssuedWebSession {
  rawToken: string;
  record: WebSessionRecord;
}

export async function issueWebSession(
  persistence: WebSessionPersistence,
  authSubject: string,
  now: Date,
  tokenFactory: SessionTokenFactory = randomSessionToken,
): Promise<IssuedWebSession> {
  const rawToken = tokenFactory();
  if (!SESSION_TOKEN_PATTERN.test(rawToken)) {
    throw new TypeError('Session token factory must return 32 bytes encoded as base64url.');
  }
  const record: WebSessionRecord = {
    session_id_hash: hashSessionToken(rawToken),
    principal_id: principalForSupabaseSubject(authSubject),
    auth_provider: 'supabase',
    auth_subject: authSubject,
    created_at: new Date(now),
    expires_at: new Date(now.getTime() + WEB_SESSION_LIFETIME_MS),
    revoked_at: null,
  };
  await persistence.createSession(record);
  return { rawToken, record };
}

export function readSessionCookie(cookieHeader: string | null, cookieName: string): string | null {
  if (cookieHeader === null) return null;
  const matches: string[] = [];
  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=');
    if (separator < 0) continue;
    const name = segment.slice(0, separator).trim();
    if (name === cookieName) matches.push(segment.slice(separator + 1).trim());
  }
  if (matches.length !== 1 || !SESSION_TOKEN_PATTERN.test(matches[0]!)) return null;
  return matches[0]!;
}

export async function authenticateWebSession(
  persistence: WebSessionPersistence,
  cookieHeader: string | null,
  cookie: JuryAiCookieConfig,
  now: Date,
): Promise<WebSessionRecord | null> {
  const raw = readSessionCookie(cookieHeader, cookie.name);
  if (raw === null) return null;
  return persistence.findActiveSession(hashSessionToken(raw), now);
}

export function sessionCookie(
  rawToken: string,
  expiresAt: Date,
  cookie: JuryAiCookieConfig,
): string {
  const attributes = [
    `${cookie.name}=${rawToken}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${WEB_SESSION_LIFETIME_SECONDS}`,
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (cookie.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function expiredSessionCookie(cookie: JuryAiCookieConfig): string {
  const attributes = [
    `${cookie.name}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (cookie.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function runtimeContextForSession(session: WebSessionRecord): RuntimeRequestContext {
  return {
    principal: { principal_id: principalForSupabaseSubject(session.auth_subject) },
    source_channel: 'webmcp_agent_relay',
    relaying_agent: null,
  };
}

export function sessionRuntimeContextProvider(
  session: WebSessionRecord,
): TrustedRuntimeRequestContextProvider {
  return { getRuntimeRequestContext: () => runtimeContextForSession(session) };
}

export function firstPartyRuntimeContextForSession(
  session: WebSessionRecord,
): RuntimeRequestContext {
  return {
    principal: { principal_id: principalForSupabaseSubject(session.auth_subject) },
    source_channel: 'first_party_input',
    relaying_agent: null,
  };
}

/** Separate trusted provider: the relay path cannot be parameterized into first-party provenance. */
export function firstPartyRuntimeContextProvider(
  session: WebSessionRecord,
): TrustedRuntimeRequestContextProvider {
  return { getRuntimeRequestContext: () => firstPartyRuntimeContextForSession(session) };
}
