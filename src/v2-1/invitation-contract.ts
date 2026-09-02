import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ID_PATTERN_V21 } from './case-envelope.js';

export const FORMATION_INVITATION_CONTRACT_VERSION_V21 = 'juryai-v2.1-formation-invitation-v1';
export const INVITATION_EMAIL_NORMALIZATION_VERSION_V21 =
  'juryai-v2.1-invitation-email-normalization-v1';
export const INVITATION_ACCOUNT_COMMITMENT_VERSION_V21 =
  'juryai-v2.1-invitation-account-hmac-sha256-v1';
export const OPAQUE_INVITATION_TOKEN_BYTES_V21 = 32;
export const OPAQUE_INVITATION_TOKEN_LENGTH_V21 = 43;

const OPAQUE_TOKEN_PATTERN_V21 = /^[A-Za-z0-9_-]{43}$/u;
const SHA256_PATTERN_V21 = /^[a-f0-9]{64}$/u;
const TEST_FEATURE_BRAND_V21: unique symbol = Symbol('juryai-v2.1-test-invitation-feature');
const FIRST_PARTY_ACTION_BRAND_V21: unique symbol = Symbol(
  'juryai-v2.1-first-party-invitation-action',
);
const AUTH_BRIDGE_BRAND_V21: unique symbol = Symbol('juryai-v2.1-invitation-auth-bridge');
const AUTH_CONTEXT_BRAND_V21: unique symbol = Symbol('juryai-v2.1-invitation-auth-context');

export interface TestOnlyInvitationFeatureAuthorityV21 {
  readonly authority_kind: 'test_only_invitation_feature';
  readonly [TEST_FEATURE_BRAND_V21]: true;
}

const TEST_ONLY_INVITATION_FEATURE_AUTHORITY_V21: TestOnlyInvitationFeatureAuthorityV21 =
  Object.freeze({
    authority_kind: 'test_only_invitation_feature',
    [TEST_FEATURE_BRAND_V21]: true as const,
  });

/**
 * PR 3 deliberately has no production feature authority. Tests may obtain the
 * singleton only while the process is running in Vitest's test environment.
 */
export function testOnlyInvitationFeatureAuthorityV21(): TestOnlyInvitationFeatureAuthorityV21 {
  if (process.env.NODE_ENV !== 'test') {
    throw new TypeError('V2.1 invitation infrastructure is production-disabled.');
  }
  return TEST_ONLY_INVITATION_FEATURE_AUTHORITY_V21;
}

export function isTestOnlyInvitationFeatureEnabledV21(
  authority: unknown,
): authority is TestOnlyInvitationFeatureAuthorityV21 {
  return (
    process.env.NODE_ENV === 'test' && authority === TEST_ONLY_INVITATION_FEATURE_AUTHORITY_V21
  );
}

export interface TrustedFirstPartyInvitationActionV21 {
  readonly authority_kind: 'trusted_first_party_invitation_action';
  readonly [FIRST_PARTY_ACTION_BRAND_V21]: true;
}

/**
 * Server-only capability for a future first-party UI handler. It is never a
 * request field and is not available to WebMCP or an external relay.
 */
export const TRUSTED_FIRST_PARTY_INVITATION_ACTION_V21: TrustedFirstPartyInvitationActionV21 =
  Object.freeze({
    authority_kind: 'trusted_first_party_invitation_action',
    [FIRST_PARTY_ACTION_BRAND_V21]: true as const,
  });

export function isTrustedFirstPartyInvitationActionV21(
  authority: unknown,
): authority is TrustedFirstPartyInvitationActionV21 {
  return authority === TRUSTED_FIRST_PARTY_INVITATION_ACTION_V21;
}

export interface TrustedInvitationAuthBridgeV21 {
  readonly authority_kind: 'trusted_server_auth_bridge';
  readonly [AUTH_BRIDGE_BRAND_V21]: true;
}

/** Server-only seam for a future adapter that has already verified Supabase Auth. */
export const TRUSTED_INVITATION_AUTH_BRIDGE_V21: TrustedInvitationAuthBridgeV21 = Object.freeze({
  authority_kind: 'trusted_server_auth_bridge',
  [AUTH_BRIDGE_BRAND_V21]: true as const,
});

export interface AuthenticatedInvitationPrincipalV21 {
  readonly authenticated_subject_id: string;
  readonly normalized_email: string;
  readonly [AUTH_CONTEXT_BRAND_V21]: true;
}

const ISSUED_AUTH_CONTEXTS_V21 = new WeakSet<object>();

export function authenticatedInvitationPrincipalV21(
  bridge: TrustedInvitationAuthBridgeV21,
  input: { authenticated_subject_id: string; authenticated_email: string },
): AuthenticatedInvitationPrincipalV21 {
  if (bridge !== TRUSTED_INVITATION_AUTH_BRIDGE_V21) {
    throw new TypeError('Invitation authentication requires the trusted server auth bridge.');
  }
  if (!ID_PATTERN_V21.test(input.authenticated_subject_id)) {
    throw new TypeError('Authenticated subject identifier is invalid.');
  }
  const context: AuthenticatedInvitationPrincipalV21 = Object.freeze({
    authenticated_subject_id: input.authenticated_subject_id,
    normalized_email: normalizeInvitationEmailV21(input.authenticated_email),
    [AUTH_CONTEXT_BRAND_V21]: true as const,
  });
  ISSUED_AUTH_CONTEXTS_V21.add(context);
  return context;
}

export function isAuthenticatedInvitationPrincipalV21(
  context: unknown,
): context is AuthenticatedInvitationPrincipalV21 {
  return typeof context === 'object' && context !== null && ISSUED_AUTH_CONTEXTS_V21.has(context);
}

export function normalizeInvitationEmailV21(email: string): string {
  if (typeof email !== 'string') throw new TypeError('Invitation email is invalid.');
  const normalized = email.normalize('NFKC').trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (
    normalized.length < 3 ||
    normalized.length > 320 ||
    at <= 0 ||
    at === normalized.length - 1 ||
    normalized.indexOf('@') !== at ||
    /\s/u.test(normalized)
  ) {
    throw new TypeError('Invitation email is invalid.');
  }
  return normalized;
}

function secretBytes(secret: string | Uint8Array): Buffer {
  const bytes = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret);
  if (bytes.length < 32) {
    throw new TypeError('Invitation account commitment secret must contain at least 32 bytes.');
  }
  return bytes;
}

export function commitIntendedInvitationAccountV21(
  email: string,
  serverSecret: string | Uint8Array,
): string {
  return createHmac('sha256', secretBytes(serverSecret))
    .update(INVITATION_EMAIL_NORMALIZATION_VERSION_V21)
    .update('\0')
    .update(normalizeInvitationEmailV21(email))
    .digest('hex');
}

export function matchesIntendedInvitationAccountV21(
  email: string,
  expectedCommitment: string,
  serverSecret: string | Uint8Array,
): boolean {
  if (!SHA256_PATTERN_V21.test(expectedCommitment)) return false;
  const actual = commitIntendedInvitationAccountV21(email, serverSecret);
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedCommitment, 'hex'));
}

export function hashOpaqueInvitationTokenV21(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isOpaqueInvitationTokenV21(token: unknown): token is string {
  return typeof token === 'string' && OPAQUE_TOKEN_PATTERN_V21.test(token);
}

export function generateOpaqueInvitationTokenV21(
  bytes: (size: number) => Uint8Array = randomBytes,
): { opaque_token: string; token_hash: string } {
  const entropy = Buffer.from(bytes(OPAQUE_INVITATION_TOKEN_BYTES_V21));
  if (entropy.length !== OPAQUE_INVITATION_TOKEN_BYTES_V21) {
    throw new TypeError('Invitation token generator returned the wrong entropy length.');
  }
  const opaqueToken = entropy.toString('base64url');
  if (!isOpaqueInvitationTokenV21(opaqueToken)) {
    throw new TypeError('Invitation token generator returned a non-canonical token.');
  }
  return {
    opaque_token: opaqueToken,
    token_hash: hashOpaqueInvitationTokenV21(opaqueToken),
  };
}
