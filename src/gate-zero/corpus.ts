import { canonicalSerialize, sha256 } from '../v2/case-envelope.js';
import { GATE_ZERO_ORACLE_VERSION } from '../v2/gate-zero-oracle.js';
import {
  GATE_ZERO_CASE_FIXTURE_VERSION,
  validateGateZeroCanonicalCase,
  type GateZeroCanonicalCase,
} from './canonical-case.js';
import {
  GATE_ZERO_CASE_PLANS,
  GATE_ZERO_COVERAGE_MATRIX_VERSION,
  GATE_ZERO_PLANNED_CORPUS_SIZE,
} from './coverage-matrix.js';
import { GATE_ZERO_INITIAL_TEN_CASES } from './initial-ten-cases.js';
import { GATE_ZERO_REMAINING_CASES } from './remaining-cases.js';

export const GATE_ZERO_CORPUS_VERSION = 'juryai-gate-zero-corpus-v1.0.0';
export const GATE_ZERO_CORPUS_FINGERPRINT =
  'a91f2184fce5b269afe7d36174c864e2c0789cf29bfe9c2eeec82da510574061';

export const GATE_ZERO_CORPUS: readonly GateZeroCanonicalCase[] = Object.freeze([
  ...GATE_ZERO_INITIAL_TEN_CASES,
  ...GATE_ZERO_REMAINING_CASES,
]);

export interface GateZeroCorpusManifest {
  corpus_version: typeof GATE_ZERO_CORPUS_VERSION;
  corpus_fingerprint: string;
  fixture_version: typeof GATE_ZERO_CASE_FIXTURE_VERSION;
  matrix_version: typeof GATE_ZERO_COVERAGE_MATRIX_VERSION;
  oracle_version: typeof GATE_ZERO_ORACLE_VERSION;
  case_count: number;
  turn_count: number;
  revision_policy: string;
  cases: Array<{
    case_id: string;
    path: string;
    sha256: string;
    turn_count: number;
  }>;
}

function manifestProjection(manifest: GateZeroCorpusManifest): GateZeroCorpusManifest {
  return { ...manifest, corpus_fingerprint: '' };
}

export function buildGateZeroCorpusManifest(): GateZeroCorpusManifest {
  const manifest: GateZeroCorpusManifest = {
    corpus_version: GATE_ZERO_CORPUS_VERSION,
    corpus_fingerprint: '',
    fixture_version: GATE_ZERO_CASE_FIXTURE_VERSION,
    matrix_version: GATE_ZERO_COVERAGE_MATRIX_VERSION,
    oracle_version: GATE_ZERO_ORACLE_VERSION,
    case_count: GATE_ZERO_CORPUS.length,
    turn_count: GATE_ZERO_CORPUS.reduce((sum, fixture) => sum + fixture.turns.length, 0),
    revision_policy:
      'Any case or oracle byte change requires an explicit corpus-version decision, regenerated per-case SHA-256 identities, a new corpus fingerprint, adversarial review, and exact-head approval.',
    cases: GATE_ZERO_CORPUS.map((fixture) => ({
      case_id: fixture.case_id,
      path: `src/fixtures/gate-zero/cases/${fixture.case_id}.json`,
      sha256: sha256(canonicalSerialize(fixture)),
      turn_count: fixture.turns.length,
    })),
  };
  manifest.corpus_fingerprint = sha256(canonicalSerialize(manifestProjection(manifest)));
  return manifest;
}

export function validateGateZeroCorpus(): string[] {
  const issues: string[] = [];
  const manifest = buildGateZeroCorpusManifest();
  if (GATE_ZERO_CORPUS.length !== GATE_ZERO_PLANNED_CORPUS_SIZE) {
    issues.push('corpus_case_count_invalid');
  }
  if (
    manifest.turn_count !== GATE_ZERO_CASE_PLANS.reduce((sum, plan) => sum + plan.planned_turns, 0)
  ) {
    issues.push('corpus_turn_count_invalid');
  }
  if (
    canonicalSerialize(GATE_ZERO_CORPUS.map((fixture) => fixture.case_id)) !==
    canonicalSerialize(GATE_ZERO_CASE_PLANS.map((plan) => plan.case_id))
  ) {
    issues.push('corpus_case_order_invalid');
  }
  if (new Set(manifest.cases.map((entry) => entry.sha256)).size !== manifest.cases.length) {
    issues.push('corpus_case_hash_duplicate');
  }
  for (const fixture of GATE_ZERO_CORPUS) {
    for (const issue of validateGateZeroCanonicalCase(fixture)) {
      issues.push(`${fixture.case_id}:${issue}`);
    }
  }
  if (manifest.corpus_fingerprint !== GATE_ZERO_CORPUS_FINGERPRINT) {
    issues.push('corpus_fingerprint_invalid');
  }
  return issues;
}
