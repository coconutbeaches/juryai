import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  alignPersonAForCase,
  type PersonASemanticAliases,
} from '../alignment/person-a-alignment-corrected.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';
import { evaluatePersonAForCase, type PersonAEvaluationReport } from './person-a-diff-corrected.js';

type JsonObject = Record<string, unknown>;

export const PERSON_A_EXTRACTION_ACCEPTANCE_EVALUATOR_VERSION = 'person-a-extraction-acceptance-v1';

export type PersonAExtractionCandidateOrigin = 'historical_saved_output' | 'hand_authored_control';

export type PersonAExtractionAcceptanceStatus = 'accepted' | 'rejected';

export type PersonAExtractionCandidate = {
  candidateId: string;
  origin: PersonAExtractionCandidateOrigin;
  extraction: unknown;
  candidateHash: string;
  expectedStatus: PersonAExtractionAcceptanceStatus;
};

export type PersonAExtractionAcceptanceCase = {
  caseId: string;
  narrative: string;
  golden: unknown;
  narrativeHash: string;
  goldenHash: string;
  fixtureHash: string;
  aliases: PersonASemanticAliases;
  candidates: PersonAExtractionCandidate[];
};

export type PersonAExtractionAcceptanceResult = {
  evaluator_version: typeof PERSON_A_EXTRACTION_ACCEPTANCE_EVALUATOR_VERSION;
  alignment_version: 'person-a-alignment-v0.1.0';
  case_id: string;
  candidate_id: string;
  candidate_origin: PersonAExtractionCandidateOrigin;
  candidate_hash: string;
  fixture_hash: string;
  narrative_hash: string;
  golden_hash: string;
  schema_valid: boolean;
  invariants_valid: boolean;
  semantic_evaluation_performed: boolean;
  critical_count: number;
  major_count: number;
  minor_count: number;
  failure_code_histogram: Record<string, number>;
  recall: number;
  precision: number;
  edit_rate: number;
  weighted_error_rate: number;
  status: PersonAExtractionAcceptanceStatus;
  rejection_reasons: string[];
  expected_status: PersonAExtractionAcceptanceStatus;
  expectation_met: boolean;
};

export type PersonAExtractionAcceptanceOriginSummary = {
  total: number;
  accepted: number;
  rejected: number;
};

export type PersonAExtractionAcceptanceSuiteResult = {
  evaluator_version: typeof PERSON_A_EXTRACTION_ACCEPTANCE_EVALUATOR_VERSION;
  acceptance_rule: {
    schema_valid: true;
    invariants_valid: true;
    maximum_critical_errors: 0;
    maximum_major_errors: 0;
    minor_errors_block: false;
    edit_rate_threshold: null;
  };
  totals: {
    cases: number;
    candidates: number;
    accepted: number;
    rejected: number;
  };
  by_origin: Record<PersonAExtractionCandidateOrigin, PersonAExtractionAcceptanceOriginSummary>;
  historical_model_acceptance: {
    accepted: number;
    total: number;
  };
  gate_passed: boolean;
  gate_failures: string[];
  results: PersonAExtractionAcceptanceResult[];
};

type ManifestFileReference = {
  path: string;
  sha256: string;
};

type ManifestAlias = {
  alias: string;
  canonical: string;
};

type ManifestCase = {
  case_id: string;
  narrative: ManifestFileReference;
  golden: ManifestFileReference;
  semantic_calibration?: {
    identities: string[];
    aliases: ManifestAlias[];
  };
};

type ManifestCandidate = {
  case_id: string;
  candidate_id: string;
  origin: PersonAExtractionCandidateOrigin;
  extraction: ManifestFileReference;
  expected_status: PersonAExtractionAcceptanceStatus;
};

type PersonAExtractionAcceptanceManifest = {
  version: 'person-a-extraction-acceptance-manifest-v1';
  cases: ManifestCase[];
  candidates: ManifestCandidate[];
};

const candidateOrigins = new Set<PersonAExtractionCandidateOrigin>([
  'historical_saved_output',
  'hand_authored_control',
]);
const statuses = new Set<PersonAExtractionAcceptanceStatus>(['accepted', 'rejected']);
const safeId = /^[a-z0-9][a-z0-9._-]*$/;
const safeSemanticToken = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
const sha256Pattern = /^[a-f0-9]{64}$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ManifestFailureCode =
  | 'manifest_invalid'
  | 'manifest_file_unreadable'
  | 'fixture_path_unsafe'
  | 'fixture_path_escape'
  | 'fixture_file_unreadable'
  | 'fixture_hash_mismatch'
  | 'fixture_invalid_utf8'
  | 'fixture_invalid_json';

class PersonAExtractionAcceptanceManifestError extends Error {
  readonly code: ManifestFailureCode;

  constructor(code: ManifestFailureCode, message: string) {
    super(`Invalid Person A extraction acceptance manifest: ${message}`);
    this.name = 'PersonAExtractionAcceptanceManifestError';
    this.code = code;
  }
}

function fail(message: string, code: ManifestFailureCode = 'manifest_invalid'): never {
  throw new PersonAExtractionAcceptanceManifestError(code, message);
}

export function sha256Bytes(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function serializePersonAExtractionAcceptance(
  value: PersonAExtractionAcceptanceSuiteResult,
): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function aggregateMetrics(report: PersonAEvaluationReport): { recall: number; precision: number } {
  const metrics = Object.values(report.metrics);
  const matched = metrics.reduce((total, metric) => total + metric.matched, 0);
  const golden = metrics.reduce((total, metric) => total + metric.golden_total, 0);
  const extracted = metrics.reduce((total, metric) => total + metric.extracted_total, 0);
  return {
    recall: golden === 0 ? 1 : matched / golden,
    precision: extracted === 0 ? (golden === 0 ? 1 : 0) : matched / extracted,
  };
}

function histogram(report: PersonAEvaluationReport): Record<string, number> {
  const counts = new Map<string, number>();
  for (const error of report.errors) {
    counts.set(error.code, (counts.get(error.code) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => compareText(left, right)));
}

export function evaluatePersonAExtractionAcceptanceCase(
  acceptanceCase: PersonAExtractionAcceptanceCase,
): PersonAExtractionAcceptanceResult[] {
  return [...acceptanceCase.candidates]
    .sort((left, right) => compareText(left.candidateId, right.candidateId))
    .map((candidate) => {
      const validation = validatePersonAExtraction(candidate.extraction, acceptanceCase.narrative);
      const schemaValid = validation.schemaErrors.length === 0;
      const invariantsValid = schemaValid && validation.invariantErrors.length === 0;
      let report: PersonAEvaluationReport | null = null;

      if (schemaValid && invariantsValid) {
        const alignment = alignPersonAForCase(
          candidate.extraction as JsonObject,
          acceptanceCase.golden as JsonObject,
          { aliases: acceptanceCase.aliases },
        );
        report = evaluatePersonAForCase(
          candidate.extraction as JsonObject,
          acceptanceCase.golden as JsonObject,
          alignment,
          { aliases: acceptanceCase.aliases },
        );
      }

      const critical = report?.summary.critical ?? 0;
      const major = report?.summary.major ?? 0;
      const minor = report?.summary.minor ?? 0;
      const rejectionReasons = [
        ...(!schemaValid ? ['schema_invalid'] : []),
        ...(schemaValid && !invariantsValid ? ['invariants_invalid'] : []),
        ...(critical > 0 ? ['critical_errors'] : []),
        ...(major > 0 ? ['major_errors'] : []),
      ].sort();
      const status: PersonAExtractionAcceptanceStatus =
        rejectionReasons.length === 0 ? 'accepted' : 'rejected';
      const metrics = report ? aggregateMetrics(report) : { recall: 0, precision: 0 };

      return {
        evaluator_version: PERSON_A_EXTRACTION_ACCEPTANCE_EVALUATOR_VERSION,
        alignment_version: 'person-a-alignment-v0.1.0',
        case_id: acceptanceCase.caseId,
        candidate_id: candidate.candidateId,
        candidate_origin: candidate.origin,
        candidate_hash: candidate.candidateHash,
        fixture_hash: acceptanceCase.fixtureHash,
        narrative_hash: acceptanceCase.narrativeHash,
        golden_hash: acceptanceCase.goldenHash,
        schema_valid: schemaValid,
        invariants_valid: invariantsValid,
        semantic_evaluation_performed: report !== null,
        critical_count: critical,
        major_count: major,
        minor_count: minor,
        failure_code_histogram: report ? histogram(report) : {},
        recall: metrics.recall,
        precision: metrics.precision,
        edit_rate: report?.summary.human_edit_rate ?? 0,
        weighted_error_rate: report?.summary.weighted_error_rate ?? 0,
        status,
        rejection_reasons: rejectionReasons,
        expected_status: candidate.expectedStatus,
        expectation_met: status === candidate.expectedStatus,
      };
    });
}

export function evaluatePersonAExtractionAcceptanceSuite(
  cases: PersonAExtractionAcceptanceCase[],
): PersonAExtractionAcceptanceSuiteResult {
  const orderedCases = [...cases].sort((left, right) => compareText(left.caseId, right.caseId));
  const results = orderedCases.flatMap(evaluatePersonAExtractionAcceptanceCase);
  const byOrigin: PersonAExtractionAcceptanceSuiteResult['by_origin'] = {
    historical_saved_output: { total: 0, accepted: 0, rejected: 0 },
    hand_authored_control: { total: 0, accepted: 0, rejected: 0 },
  };
  for (const result of results) {
    const summary = byOrigin[result.candidate_origin];
    summary.total += 1;
    summary[result.status] += 1;
  }
  const gateFailures = results
    .filter((result) => !result.expectation_met)
    .map(
      (result) =>
        `${result.case_id}/${result.candidate_id}: expected ${result.expected_status}, got ${result.status}`,
    )
    .sort();
  return {
    evaluator_version: PERSON_A_EXTRACTION_ACCEPTANCE_EVALUATOR_VERSION,
    acceptance_rule: {
      schema_valid: true,
      invariants_valid: true,
      maximum_critical_errors: 0,
      maximum_major_errors: 0,
      minor_errors_block: false,
      edit_rate_threshold: null,
    },
    totals: {
      cases: orderedCases.length,
      candidates: results.length,
      accepted: results.filter((result) => result.status === 'accepted').length,
      rejected: results.filter((result) => result.status === 'rejected').length,
    },
    by_origin: byOrigin,
    historical_model_acceptance: {
      accepted: byOrigin.historical_saved_output.accepted,
      total: byOrigin.historical_saved_output.total,
    },
    gate_passed: gateFailures.length === 0,
    gate_failures: gateFailures,
    results,
  };
}

function requireString(object: JsonObject, key: string, context: string): string {
  const value = object[key];
  if (typeof value !== 'string' || value.length === 0) fail(`${context}.${key} must be a string`);
  return value;
}

function requireOnlyKeys(object: JsonObject, allowed: string[], context: string): void {
  const unsupported = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unsupported.length > 0) {
    fail(`${context} has unsupported key '${unsupported.sort()[0]}'`);
  }
}

function parseFileReference(value: unknown, context: string): ManifestFileReference {
  if (!isObject(value)) fail(`${context} must be an object`);
  requireOnlyKeys(value, ['path', 'sha256'], context);
  const path = requireString(value, 'path', context);
  const sha256 = requireString(value, 'sha256', context);
  if (!sha256Pattern.test(sha256)) fail(`${context}.sha256 must be lowercase SHA-256`);
  return { path, sha256 };
}

function parseManifest(value: unknown): PersonAExtractionAcceptanceManifest {
  if (!isObject(value)) fail('root must be an object');
  requireOnlyKeys(value, ['version', 'cases', 'candidates'], 'root');
  if (value.version !== 'person-a-extraction-acceptance-manifest-v1') {
    fail('unsupported version');
  }
  if (!Array.isArray(value.cases) || !Array.isArray(value.candidates)) {
    fail('cases and candidates must be arrays');
  }
  const cases: ManifestCase[] = value.cases.map((entry, index) => {
    if (!isObject(entry)) fail(`cases[${index}] must be an object`);
    requireOnlyKeys(
      entry,
      ['case_id', 'narrative', 'golden', 'semantic_calibration'],
      `cases[${index}]`,
    );
    const caseId = requireString(entry, 'case_id', `cases[${index}]`);
    if (!safeId.test(caseId)) fail(`cases[${index}].case_id is malformed`);
    let semanticCalibration: ManifestCase['semantic_calibration'];
    if (entry.semantic_calibration !== undefined) {
      if (!isObject(entry.semantic_calibration)) {
        fail(`cases[${index}].semantic_calibration must be an object`);
      }
      requireOnlyKeys(
        entry.semantic_calibration,
        ['identities', 'aliases'],
        `cases[${index}].semantic_calibration`,
      );
      const identities = entry.semantic_calibration.identities;
      const aliases = entry.semantic_calibration.aliases;
      if (!Array.isArray(identities) || !Array.isArray(aliases)) {
        fail(`cases[${index}].semantic_calibration identities and aliases must be arrays`);
      }
      semanticCalibration = {
        identities: identities.map((identity, identityIndex) => {
          if (typeof identity !== 'string' || !safeSemanticToken.test(identity)) {
            fail(`cases[${index}].semantic_calibration.identities[${identityIndex}] is malformed`);
          }
          return identity;
        }),
        aliases: aliases.map((alias, aliasIndex) => {
          if (!isObject(alias)) {
            fail(`cases[${index}].semantic_calibration.aliases[${aliasIndex}] must be an object`);
          }
          requireOnlyKeys(
            alias,
            ['alias', 'canonical'],
            `cases[${index}].semantic_calibration.aliases[${aliasIndex}]`,
          );
          return {
            alias: requireString(
              alias,
              'alias',
              `cases[${index}].semantic_calibration.aliases[${aliasIndex}]`,
            ),
            canonical: requireString(
              alias,
              'canonical',
              `cases[${index}].semantic_calibration.aliases[${aliasIndex}]`,
            ),
          };
        }),
      };
    }
    return {
      case_id: caseId,
      narrative: parseFileReference(entry.narrative, `cases[${index}].narrative`),
      golden: parseFileReference(entry.golden, `cases[${index}].golden`),
      ...(semanticCalibration ? { semantic_calibration: semanticCalibration } : {}),
    };
  });
  const candidates: ManifestCandidate[] = value.candidates.map((entry, index) => {
    if (!isObject(entry)) fail(`candidates[${index}] must be an object`);
    requireOnlyKeys(
      entry,
      ['case_id', 'candidate_id', 'origin', 'extraction', 'expected_status'],
      `candidates[${index}]`,
    );
    const caseId = requireString(entry, 'case_id', `candidates[${index}]`);
    const candidateId = requireString(entry, 'candidate_id', `candidates[${index}]`);
    const origin = requireString(entry, 'origin', `candidates[${index}]`);
    const expectedStatus = requireString(entry, 'expected_status', `candidates[${index}]`);
    if (!safeId.test(caseId) || !safeId.test(candidateId)) {
      fail(`candidates[${index}] has a malformed case_id or candidate_id`);
    }
    if (!candidateOrigins.has(origin as PersonAExtractionCandidateOrigin)) {
      fail(`candidates[${index}].origin is unsupported`);
    }
    if (!statuses.has(expectedStatus as PersonAExtractionAcceptanceStatus)) {
      fail(`candidates[${index}].expected_status is unsupported`);
    }
    return {
      case_id: caseId,
      candidate_id: candidateId,
      origin: origin as PersonAExtractionCandidateOrigin,
      extraction: parseFileReference(entry.extraction, `candidates[${index}].extraction`),
      expected_status: expectedStatus as PersonAExtractionAcceptanceStatus,
    };
  });
  return {
    version: 'person-a-extraction-acceptance-manifest-v1',
    cases,
    candidates,
  };
}

function validateAliases(
  calibration: ManifestCase['semantic_calibration'],
  context: string,
): PersonASemanticAliases {
  if (!calibration) return {};
  const identities = calibration.identities.map((identity) => identity.toLowerCase());
  if (new Set(identities).size !== identities.length) fail(`${context} has duplicate identities`);
  const identitySet = new Set(identities);
  const aliases: Record<string, string> = {};
  for (const entry of calibration.aliases) {
    const alias = entry.alias.toLowerCase();
    const canonical = entry.canonical.toLowerCase();
    if (!safeSemanticToken.test(alias) || !safeSemanticToken.test(canonical)) {
      fail(`${context} has a malformed alias`);
    }
    if (!identitySet.has(canonical)) fail(`${context} alias references an unknown identity`);
    if (identitySet.has(alias)) fail(`${context} alias is ambiguous with an identity`);
    if (aliases[alias] !== undefined) fail(`${context} defines a duplicate or ambiguous alias`);
    aliases[alias] = canonical;
  }
  return Object.fromEntries(
    Object.entries(aliases).sort(([left], [right]) => compareText(left, right)),
  );
}

function isWithinDirectory(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

function safeFixturePath(root: string, filePath: string, context: string): string {
  if (
    isAbsolute(filePath) ||
    filePath.includes('\\') ||
    filePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(filePath)
  ) {
    fail(`${context}.path is malformed or unsafe`, 'fixture_path_unsafe');
  }
  const absolute = resolve(root, filePath);
  const fromRoot = relative(root, absolute);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    fail(`${context}.path escapes the manifest directory`, 'fixture_path_escape');
  }
  return absolute;
}

async function readFixture(
  root: string,
  reference: ManifestFileReference,
  context: string,
): Promise<Uint8Array> {
  const lexicalPath = safeFixturePath(root, reference.path, context);
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(lexicalPath);
  } catch {
    fail(`${context}.path is missing or unreadable`, 'fixture_file_unreadable');
  }
  if (!isWithinDirectory(root, canonicalPath)) {
    fail(`${context}.path escapes the manifest directory`, 'fixture_path_escape');
  }
  let bytes: Uint8Array;
  try {
    bytes = await readFile(canonicalPath);
  } catch {
    fail(`${context}.path is missing or unreadable`, 'fixture_file_unreadable');
  }
  if (sha256Bytes(bytes) !== reference.sha256) {
    fail(`${context} hash mismatch`, 'fixture_hash_mismatch');
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array, context: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(`${context} is not valid UTF-8`, 'fixture_invalid_utf8');
  }
}

function parseJsonFixture(bytes: string | Uint8Array, context: string): unknown {
  const text = typeof bytes === 'string' ? bytes : decodeUtf8(bytes, context);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail(`${context} contains invalid JSON`, 'fixture_invalid_json');
  }
}

export async function loadPersonAExtractionAcceptanceManifest(
  manifestPath: string,
): Promise<PersonAExtractionAcceptanceCase[]> {
  let canonicalManifestPath: string;
  try {
    canonicalManifestPath = await realpath(manifestPath);
  } catch {
    fail('manifest file is missing or unreadable', 'manifest_file_unreadable');
  }
  let rawManifest: Uint8Array;
  try {
    rawManifest = await readFile(canonicalManifestPath);
  } catch {
    fail('manifest file is missing or unreadable', 'manifest_file_unreadable');
  }
  const manifest = parseManifest(parseJsonFixture(rawManifest, 'manifest'));
  const manifestDirectory = dirname(canonicalManifestPath);
  const caseIds = new Set<string>();
  for (const manifestCase of manifest.cases) {
    if (caseIds.has(manifestCase.case_id)) fail(`duplicate case ID '${manifestCase.case_id}'`);
    caseIds.add(manifestCase.case_id);
  }
  const candidateKeys = new Set<string>();
  for (const candidate of manifest.candidates) {
    if (!caseIds.has(candidate.case_id)) {
      fail(`candidate '${candidate.candidate_id}' references unknown case '${candidate.case_id}'`);
    }
    const key = `${candidate.case_id}/${candidate.candidate_id}`;
    if (candidateKeys.has(key)) fail(`duplicate candidate ID '${key}'`);
    candidateKeys.add(key);
  }
  for (const caseId of caseIds) {
    if (!manifest.candidates.some((candidate) => candidate.case_id === caseId)) {
      fail(`case '${caseId}' has no candidates`);
    }
  }

  return Promise.all(
    [...manifest.cases]
      .sort((left, right) => compareText(left.case_id, right.case_id))
      .map(async (manifestCase) => {
        const aliases = validateAliases(
          manifestCase.semantic_calibration,
          `case '${manifestCase.case_id}' semantic calibration`,
        );
        const [narrativeBytes, goldenBytes] = await Promise.all([
          readFixture(
            manifestDirectory,
            manifestCase.narrative,
            `case '${manifestCase.case_id}' narrative`,
          ),
          readFixture(
            manifestDirectory,
            manifestCase.golden,
            `case '${manifestCase.case_id}' golden`,
          ),
        ]);
        const narrative = decodeUtf8(narrativeBytes, `case '${manifestCase.case_id}' narrative`);
        const candidates = await Promise.all(
          manifest.candidates
            .filter((candidate) => candidate.case_id === manifestCase.case_id)
            .sort((left, right) => compareText(left.candidate_id, right.candidate_id))
            .map(async (candidate) => {
              const bytes = await readFixture(
                manifestDirectory,
                candidate.extraction,
                `candidate '${candidate.case_id}/${candidate.candidate_id}'`,
              );
              return {
                candidateId: candidate.candidate_id,
                origin: candidate.origin,
                extraction: parseJsonFixture(
                  bytes,
                  `candidate '${candidate.case_id}/${candidate.candidate_id}'`,
                ),
                candidateHash: candidate.extraction.sha256,
                expectedStatus: candidate.expected_status,
              };
            }),
        );
        const golden = parseJsonFixture(goldenBytes, `case '${manifestCase.case_id}' golden`);
        const goldenValidation = validatePersonAExtraction(golden, narrative);
        if (!goldenValidation.valid) {
          fail(`case '${manifestCase.case_id}' golden extraction is invalid`);
        }
        const fixtureHash = sha256Bytes(
          `${manifestCase.narrative.sha256}\n${manifestCase.golden.sha256}\n`,
        );
        return {
          caseId: manifestCase.case_id,
          narrative,
          golden,
          narrativeHash: manifestCase.narrative.sha256,
          goldenHash: manifestCase.golden.sha256,
          fixtureHash,
          aliases,
          candidates,
        };
      }),
  );
}

export function renderPersonAExtractionAcceptanceReport(
  suite: PersonAExtractionAcceptanceSuiteResult,
): string {
  const lines = [
    '# Person A extraction acceptance',
    '',
    `Gate: **${suite.gate_passed ? 'PASS' : 'FAIL'}**`,
    `Historical saved outputs: **${suite.historical_model_acceptance.accepted}/${suite.historical_model_acceptance.total} accepted**`,
    `Hand-authored controls: **${suite.by_origin.hand_authored_control.accepted}/${suite.by_origin.hand_authored_control.total} accepted**`,
    '',
    '| Case | Candidate | Provenance | Status | Critical | Major | Minor |',
    '|---|---|---|---|---:|---:|---:|',
  ];
  for (const result of suite.results) {
    lines.push(
      `| ${result.case_id} | ${result.candidate_id} | ${result.candidate_origin} | ${result.status} | ${result.critical_count} | ${result.major_count} | ${result.minor_count} |`,
    );
  }
  if (suite.gate_failures.length > 0) {
    lines.push('', '## Gate failures', '', ...suite.gate_failures.map((failure) => `- ${failure}`));
  }
  return `${lines.join('\n')}\n`;
}
