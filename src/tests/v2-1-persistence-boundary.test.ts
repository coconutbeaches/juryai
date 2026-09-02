import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FORMATION_PERSISTENCE_CONTRACT_VERSION_V21,
  assertLegacyCasePersistenceId,
  assertV21DisputePersistenceId,
  persistenceFamilyForIdV21,
} from '../v2-1/formation-persistence.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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

describe('dark V2.1 persistence boundary', () => {
  it('routes only closed case_ and dispute_ namespaces', () => {
    expect(persistenceFamilyForIdV21('case_legacy')).toBe('legacy_p2');
    expect(persistenceFamilyForIdV21('dispute_new')).toBe('v2_1_formation');
    expect(() => persistenceFamilyForIdV21('unknown_record')).toThrow(/unknown/iu);
    expect(() => persistenceFamilyForIdV21('case_')).toThrow(/unknown/iu);
    expect(() => persistenceFamilyForIdV21('dispute_')).toThrow(/unknown/iu);
  });

  it('prevents either identifier family from entering the other persistence path', () => {
    expect(() => assertV21DisputePersistenceId('case_legacy')).toThrow(/legacy/iu);
    expect(() => assertLegacyCasePersistenceId('dispute_new')).toThrow(/V2\.1/iu);
    expect(() => assertV21DisputePersistenceId('dispute_new')).not.toThrow();
    expect(() => assertLegacyCasePersistenceId('case_legacy')).not.toThrow();
  });

  it('keeps dark persistence unreachable from every production route and WebMCP module', () => {
    const productionSources = [...sourceFilesBelow('api'), ...sourceFilesBelow('src/webmcp')];
    for (const file of productionSources) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toContain('postgres-formation-repository');
      expect(source, file).not.toContain('FORMATION_PERSISTENCE_CONTRACT_VERSION_V21');
      expect(source, file).not.toContain('juryai_v21');
    }
  });

  it('defines no invitation, redemption, participant, or activation contract', () => {
    expect(FORMATION_PERSISTENCE_CONTRACT_VERSION_V21).toBe(
      'juryai-v2.1-dark-formation-persistence-v1',
    );
    const source = readFileSync(
      resolve(repositoryRoot, 'src/v2-1/formation-persistence.ts'),
      'utf8',
    );
    for (const excluded of [
      'InvitationRecord',
      'redeemInvitation',
      'participantTable',
      'enableTwoParty',
      'caseNumberRecovery',
    ]) {
      expect(source).not.toContain(excluded);
    }
  });
});
