import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  INVITATION_ACCOUNT_COMMITMENT_VERSION_V21,
  OPAQUE_INVITATION_TOKEN_BYTES_V21,
  OPAQUE_INVITATION_TOKEN_LENGTH_V21,
  TRUSTED_FIRST_PARTY_INVITATION_ACTION_V21,
  TRUSTED_INVITATION_AUTH_BRIDGE_V21,
  authenticatedInvitationPrincipalV21,
  commitIntendedInvitationAccountV21,
  generateOpaqueInvitationTokenV21,
  hashOpaqueInvitationTokenV21,
  isOpaqueInvitationTokenV21,
  isTrustedFirstPartyInvitationActionV21,
  matchesIntendedInvitationAccountV21,
  normalizeInvitationEmailV21,
} from '../v2-1/invitation-contract.js';
import { productionDisabledInvitationRouteV21 } from '../v2-1/invitation-route.js';
import {
  invitationUnavailableResultV21,
  productionDisabledInvitationServiceV21,
  type FormationInvitationPersistencePortV21,
} from '../v2-1/invitation-service.js';
import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SECRET = 'test-server-secret-with-at-least-thirty-two-bytes';

function sourceFilesBelow(relativeDirectory: string): string[] {
  const root = resolve(repositoryRoot, relativeDirectory);
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(absolute);
    }
  };
  visit(root);
  return files.sort();
}

describe('V2.1 opaque invitation and account commitment contract', () => {
  it('generates 256-bit opaque, non-enumerable tokens and stores only their hash shape', () => {
    const first = generateOpaqueInvitationTokenV21();
    const second = generateOpaqueInvitationTokenV21();
    expect(OPAQUE_INVITATION_TOKEN_BYTES_V21).toBe(32);
    expect(first.opaque_token).toHaveLength(OPAQUE_INVITATION_TOKEN_LENGTH_V21);
    expect(isOpaqueInvitationTokenV21(first.opaque_token)).toBe(true);
    expect(first.opaque_token).not.toBe(second.opaque_token);
    expect(first.token_hash).toBe(hashOpaqueInvitationTokenV21(first.opaque_token));
    expect(first.token_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.token_hash).not.toContain(first.opaque_token);
  });

  it('normalizes deterministically and uses a versioned server-secret HMAC commitment', () => {
    expect(normalizeInvitationEmailV21('  Person@Example.COM  ')).toBe('person@example.com');
    const commitment = commitIntendedInvitationAccountV21('Person@Example.COM', SECRET);
    expect(INVITATION_ACCOUNT_COMMITMENT_VERSION_V21).toBe(
      'juryai-v2.1-invitation-account-hmac-sha256-v1',
    );
    expect(commitment).toMatch(/^[a-f0-9]{64}$/u);
    expect(commitment).toBe(commitIntendedInvitationAccountV21(' person@example.com ', SECRET));
    expect(matchesIntendedInvitationAccountV21('PERSON@example.com', commitment, SECRET)).toBe(
      true,
    );
    expect(matchesIntendedInvitationAccountV21('other@example.com', commitment, SECRET)).toBe(
      false,
    );
    expect(commitment).not.toBe(hashOpaqueInvitationTokenV21('person@example.com'));
  });

  it('requires trusted server authentication context rather than caller-shaped identity fields', () => {
    const principal = authenticatedInvitationPrincipalV21(TRUSTED_INVITATION_AUTH_BRIDGE_V21, {
      authenticated_subject_id: 'subject_party_b',
      authenticated_email: 'party-b@example.com',
    });
    expect(principal).toMatchObject({
      authenticated_subject_id: 'subject_party_b',
      normalized_email: 'party-b@example.com',
    });
    expect(() =>
      authenticatedInvitationPrincipalV21({} as never, {
        authenticated_subject_id: 'subject_party_b',
        authenticated_email: 'party-b@example.com',
      }),
    ).toThrow(/trusted server auth bridge/iu);
    expect(isTrustedFirstPartyInvitationActionV21({})).toBe(false);
    expect(isTrustedFirstPartyInvitationActionV21(TRUSTED_FIRST_PARTY_INVITATION_ACTION_V21)).toBe(
      true,
    );
  });
});

describe('structural production feature-off and neutral route', () => {
  it('rejects direct service invocation before touching persistence', async () => {
    const persistence: FormationInvitationPersistencePortV21 = {
      issueInvitation: vi.fn(async () => {
        throw new Error('must not be called');
      }),
      redeemInvitation: vi.fn(async () => {
        throw new Error('must not be called');
      }),
    };
    const principal = authenticatedInvitationPrincipalV21(TRUSTED_INVITATION_AUTH_BRIDGE_V21, {
      authenticated_subject_id: 'subject_disabled',
      authenticated_email: 'disabled@example.com',
    });
    const service = productionDisabledInvitationServiceV21(persistence);
    await expect(
      service.issueInvitation({
        dispute_id: 'dispute_disabled',
        authenticated_principal: principal,
        intended_account_email: 'target@example.com',
      }),
    ).resolves.toEqual(invitationUnavailableResultV21());
    await expect(
      service.redeemInvitation({
        opaque_token: 'x'.repeat(43),
        authenticated_principal: principal,
      }),
    ).resolves.toEqual(invitationUnavailableResultV21());
    expect(persistence.issueInvitation).not.toHaveBeenCalled();
    expect(persistence.redeemInvitation).not.toHaveBeenCalled();
  });

  it('returns one generic, non-enumerating production route response', async () => {
    const first = productionDisabledInvitationRouteV21();
    const second = productionDisabledInvitationRouteV21();
    expect(first.status).toBe(404);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect(await first.json()).toEqual(invitationUnavailableResultV21());
    expect(await second.json()).toEqual(invitationUnavailableResultV21());
  });

  it('renders a neutral join seam without case facts and makes no redemption request', () => {
    const html = readFileSync(resolve(repositoryRoot, 'index.html'), 'utf8');
    const entry = readFileSync(resolve(repositoryRoot, 'src/webmcp/browser/entry.ts'), 'utf8');
    const section = /<section id="invitation-join-section"[\s\S]*?<\/section>/u.exec(html)?.[0];
    expect(section).toContain('You’ve been invited to participate in a JuryAI dispute.');
    expect(section).toContain('Invitation verification is not available yet.');
    expect(section).not.toMatch(/Party A|amount|evidence|claim|completed formation|progress/iu);
    expect(entry).toContain('const invitationJoinPath = /^\\/join\\/[^/]+$/u');
    expect(entry).toContain('if (invitationJoinPath)');
    expect(entry).not.toMatch(/redeemInvitation|formation_invitations|opaque_token/iu);
  });

  it('keeps persistence/test authority out of production routes and WebMCP', () => {
    const productionSources = [...sourceFilesBelow('api'), ...sourceFilesBelow('src/webmcp')];
    for (const file of productionSources) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toContain('postgres-formation-invitation-repository');
      expect(source, file).not.toContain('testOnlyInvitationFeatureAuthorityV21');
      expect(source, file).not.toContain('testOnlyInvitationServiceV21');
      expect(source, file).not.toContain('TRUSTED_FIRST_PARTY_INVITATION_ACTION_V21');
    }
    const route = readFileSync(resolve(repositoryRoot, 'api/juryai/join/[token].ts'), 'utf8');
    expect(route).toContain('productionDisabledInvitationRouteV21');
    expect(route).not.toMatch(/Pool|repository|redeem|issue/iu);
  });

  it('preserves exactly the three frozen WebMCP tool names', () => {
    const service = {
      startCase: vi.fn(),
      getCaseState: vi.fn(),
      submitTurn: vi.fn(),
    };
    expect(createJuryAiToolDefinitions(service).map((tool) => tool.name)).toEqual([
      'start_case',
      'get_case_state',
      'submit_turn',
    ]);
  });
});
