import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PersonAEvaluationContractVersion,
  PersonASemanticAliases,
} from '../alignment/person-a-alignment.js';

type JsonObject = Record<string, any>;

export type PersonAProvenanceCaseId = 'dry_run_001' | 'dry_run_002';

export type PersonAProvenanceCaseDefinition = {
  caseId: PersonAProvenanceCaseId;
  narrativePath: string;
  narrativeSha256: string;
  goldenPath: string;
  goldenSha256: string;
  aliases: PersonASemanticAliases;
  evaluationContract: PersonAEvaluationContractVersion;
  artifactPrefix: string;
};

export type ResolvedPersonAProvenanceCase = PersonAProvenanceCaseDefinition & {
  narrativeAbsolutePath: string;
  narrative: string;
  goldenAbsolutePath: string;
  golden: JsonObject;
};

const currentFile = fileURLToPath(import.meta.url);
export const PERSON_A_PROVENANCE_PROJECT_ROOT = resolve(dirname(currentFile), '../..');

export const PERSON_A_PROVENANCE_CASES: Readonly<
  Record<PersonAProvenanceCaseId, PersonAProvenanceCaseDefinition>
> = {
  dry_run_001: {
    caseId: 'dry_run_001',
    narrativePath: 'src/fixtures/dry_run_001.person_a.txt',
    narrativeSha256: '2cdb00b4b2b28c1813a979be5cf22f1ac51a30282abea9e144df491549c4fcc7',
    goldenPath: 'src/fixtures/dry_run_001.person_a.golden.extraction.json',
    goldenSha256: 'a6aea6cce9a3047c86f34bb5b7d36ccee1315f8f041e775793aeb1e75e3055f8',
    aliases: {
      client: 'maya',
      designer: 'alex',
      freelancer: 'alex',
    },
    evaluationContract: 'calibrated_live_v2',
    artifactPrefix: 'dry_run_001.person_a',
  },
  dry_run_002: {
    caseId: 'dry_run_002',
    narrativePath: 'src/fixtures/dry_run_002.person_a.txt',
    narrativeSha256: '0508bdb60323a32beafaa0b7e7e7ac734cd64a002830fc8eb1ca52e5feda0f86',
    goldenPath: 'src/fixtures/dry_run_002.person_a.golden.extraction.json',
    goldenSha256: 'c56a61eb606c5efbcc8fdd5f364d70a889c9c84b7092784daf2f2b814f265567',
    aliases: {
      client: 'priya',
      restorer: 'jordan',
    },
    evaluationContract: 'calibrated_live_v2',
    artifactPrefix: 'dry_run_002.person_a',
  },
};

export function sha256Bytes(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertCompleteDefinition(
  definition: PersonAProvenanceCaseDefinition | undefined,
  caseId: string,
): asserts definition is PersonAProvenanceCaseDefinition {
  if (!definition) throw new Error(`Unknown Person A provenance case: ${caseId}`);
  if (definition.caseId !== caseId) {
    throw new Error(`Person A provenance case '${caseId}' has a mismatched caseId.`);
  }
  for (const key of [
    'caseId',
    'narrativePath',
    'narrativeSha256',
    'goldenPath',
    'goldenSha256',
    'evaluationContract',
    'artifactPrefix',
  ] as const) {
    if (typeof definition[key] !== 'string' || definition[key].length === 0) {
      throw new Error(`Person A provenance case '${caseId}' is missing ${key}.`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(definition.narrativeSha256)) {
    throw new Error(`Person A provenance case '${caseId}' has an invalid narrative SHA-256.`);
  }
  if (!/^[a-f0-9]{64}$/.test(definition.goldenSha256)) {
    throw new Error(`Person A provenance case '${caseId}' has an invalid golden SHA-256.`);
  }
  if (!definition.aliases || typeof definition.aliases !== 'object') {
    throw new Error(`Person A provenance case '${caseId}' is missing aliases.`);
  }
  if (
    definition.evaluationContract !== 'locked_acceptance_v1' &&
    definition.evaluationContract !== 'calibrated_live_v2'
  ) {
    throw new Error(`Person A provenance case '${caseId}' has an invalid evaluation contract.`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(definition.artifactPrefix)) {
    throw new Error(`Person A provenance case '${caseId}' has an unsafe artifact prefix.`);
  }
}

function assertInsideProject(root: string, target: string, label: string): void {
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`) ||
    pathFromRoot.length === 0 ||
    pathFromRoot.startsWith(sep)
  ) {
    throw new Error(`${label} must resolve inside the repository.`);
  }
}

export async function resolvePersonAProvenanceCase(
  caseId: string,
  options: {
    projectRoot?: string;
    cases?: Readonly<Record<string, PersonAProvenanceCaseDefinition | undefined>>;
  } = {},
): Promise<ResolvedPersonAProvenanceCase> {
  const projectRoot = await realpath(options.projectRoot ?? PERSON_A_PROVENANCE_PROJECT_ROOT);
  const cases: Readonly<Record<string, PersonAProvenanceCaseDefinition | undefined>> =
    options.cases ?? PERSON_A_PROVENANCE_CASES;
  const definition = cases[caseId];
  assertCompleteDefinition(definition, caseId);

  const narrativeAbsolutePath = await realpath(resolve(projectRoot, definition.narrativePath));
  const goldenAbsolutePath = await realpath(resolve(projectRoot, definition.goldenPath));
  assertInsideProject(projectRoot, narrativeAbsolutePath, 'Narrative');
  assertInsideProject(projectRoot, goldenAbsolutePath, 'Golden');

  const [narrativeBytes, goldenBytes] = await Promise.all([
    readFile(narrativeAbsolutePath),
    readFile(goldenAbsolutePath),
  ]);
  const narrativeHash = sha256Bytes(narrativeBytes);
  const goldenHash = sha256Bytes(goldenBytes);
  if (narrativeHash !== definition.narrativeSha256) {
    throw new Error(
      `Person A provenance case '${caseId}' narrative hash mismatch: expected ${definition.narrativeSha256}, got ${narrativeHash}.`,
    );
  }
  if (goldenHash !== definition.goldenSha256) {
    throw new Error(
      `Person A provenance case '${caseId}' golden hash mismatch: expected ${definition.goldenSha256}, got ${goldenHash}.`,
    );
  }

  const narrative = new TextDecoder('utf-8', { fatal: true }).decode(narrativeBytes);
  const goldenText = new TextDecoder('utf-8', { fatal: true }).decode(goldenBytes);
  const golden = JSON.parse(goldenText) as JsonObject;
  if (golden?.submission?.raw_text !== narrative) {
    throw new Error(`Person A provenance case '${caseId}' golden does not contain its narrative.`);
  }
  if (golden?.submission?.content_hash !== definition.narrativeSha256) {
    throw new Error(
      `Person A provenance case '${caseId}' golden records the wrong narrative identity.`,
    );
  }

  return {
    ...definition,
    narrativeAbsolutePath,
    narrative,
    goldenAbsolutePath,
    golden,
  };
}

export function personAProvenanceCaseIdForNarrative(
  narrative: string,
): PersonAProvenanceCaseId | null {
  const narrativeSha256 = sha256Bytes(narrative);
  for (const definition of Object.values(PERSON_A_PROVENANCE_CASES)) {
    if (definition.narrativeSha256 === narrativeSha256) return definition.caseId;
  }
  return null;
}
