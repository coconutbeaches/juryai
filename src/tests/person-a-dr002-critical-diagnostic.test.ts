import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignPersonAForCase } from '../alignment/person-a-alignment-corrected.js';
import { structuredMonetaryRecordFingerprint } from '../alignment/person-a-monetary-identity-compatibility.js';
import { evaluatePersonAForCase } from '../evaluation/person-a-diff-corrected.js';
import {
  evaluatePersonAExtractionAcceptanceSuite,
  loadPersonAExtractionAcceptanceManifest,
  serializePersonAExtractionAcceptance,
} from '../evaluation/person-a-extraction-acceptance.js';

type JsonObject = Record<string, any>;

const root = process.cwd();
const diagnosticPath = resolve(root, 'src/fixtures/dry_run_002.pr25.critical-diagnostic.json');
const diagnostic = JSON.parse(readFileSync(diagnosticPath, 'utf8')) as JsonObject;
const narrativePath = resolve(root, diagnostic.case.narrative.path);
const goldenPath = resolve(root, diagnostic.case.golden.path);
const narrativeBytes = readFileSync(narrativePath);
const narrative = narrativeBytes.toString('utf8');
const goldenBytes = readFileSync(goldenPath);
const goldenFixture = JSON.parse(goldenBytes.toString('utf8')) as JsonObject;
const options = {
  aliases: { client: 'priya', restorer: 'jordan' },
  contractVersion: 'calibrated_live_v2' as const,
  narrative,
};

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function record(name: string): JsonObject {
  return structuredClone(diagnostic.records[name].value) as JsonObject;
}

function findingIdentity(finding: JsonObject): string {
  return [
    finding.severity,
    finding.family,
    finding.code,
    finding.extracted_id ?? '',
    finding.golden_id ?? '',
  ].join('|');
}

function diagnosticProjection(): { extracted: JsonObject; golden: JsonObject } {
  return {
    extracted: {
      submission: { raw_text: narrative },
      agreement: {
        terms: [record('term_scope_1'), record('term_price_1')],
      },
      deliverable_assessments: [record('deliverable_1')],
      claims: [
        record('claim_scope_1'),
        record('claim_payment_term_1'),
        record('claim_no_refund_1'),
      ],
    },
    golden: {
      submission: { raw_text: narrative },
      agreement: {
        terms: [record('term_dry_run_002')],
      },
      deliverable_assessments: [],
      claims: [],
    },
  };
}

function evaluateProjection(projection = diagnosticProjection()) {
  const alignment = alignPersonAForCase(projection.extracted, projection.golden, options);
  return {
    alignment,
    report: evaluatePersonAForCase(projection.extracted, projection.golden, alignment, options),
  };
}

describe('PR #25 Dry Run 002 five-critical diagnostic', () => {
  it('fails closed on case, fixture, or source-span identity drift', () => {
    expect(diagnostic.version).toBe('juryai-pr25-dr002-critical-diagnostic-v1');
    expect(diagnostic.case.case_id).toBe('dry_run_002');
    expect(diagnostic.case.fixture_contract).toBe('calibrated_live_v2');
    expect(diagnostic.case.locked_base_sha).toBe('14d21cc89d916586be8dccb2a30577d46279a146');
    expect(sha256(narrativeBytes)).toBe(diagnostic.case.narrative.sha256);
    expect(sha256(goldenBytes)).toBe(diagnostic.case.golden.sha256);
    expect(narrative.length).toBe(diagnostic.case.narrative.utf16_length);
    expect(narrativeBytes.byteLength).toBe(diagnostic.case.narrative.utf8_bytes);

    for (const segment of Object.values(diagnostic.source_segments) as JsonObject[]) {
      expect(narrative.slice(segment.start_char, segment.end_char)).toBe(segment.quote);
    }
  });

  it('locks every projected extraction and golden record by canonical fingerprint', () => {
    for (const [name, entry] of Object.entries(diagnostic.records) as Array<[string, JsonObject]>) {
      expect(structuredMonetaryRecordFingerprint(entry.value), name).toBe(entry.fingerprint);
    }

    expect(
      goldenFixture.agreement.terms.find((term: JsonObject) => term.term_id === 'term_dry_run_002'),
    ).toEqual(diagnostic.records.term_dry_run_002.value);
    expect(
      goldenFixture.claims.find((claim: JsonObject) => claim.claim_id === 'cl_002_remedy'),
    ).toEqual(diagnostic.records.cl_002_remedy.value);
  });

  it('inventories exactly the five real deterministic critical finding identities', () => {
    const { report } = evaluateProjection();
    const observed = report.errors.filter((finding) => finding.severity === 'critical');
    const expected = diagnostic.critical_findings.map((finding: JsonObject) => ({
      severity: 'critical',
      family: finding.family,
      code: finding.code,
      message: 'Extracted object has no supported golden match and is a fabrication hard failure.',
      extracted_id: finding.extracted_id,
    }));

    expect(observed).toEqual(expected);
    expect(observed.map(findingIdentity)).toEqual(
      diagnostic.critical_findings.map((finding: JsonObject) => finding.stable_identity),
    );
    for (const finding of observed) {
      const inventory = diagnostic.critical_findings.find(
        (entry: JsonObject) => entry.stable_identity === findingIdentity(finding),
      );
      expect(inventory).toBeTruthy();
      expect(structuredMonetaryRecordFingerprint(finding)).toBe(inventory.finding_fingerprint);
      expect(inventory.source_grounded).toBe(true);
    }
  });

  it('ranks every inventory entry once against all ten explicit criteria', () => {
    const inventoryIds = diagnostic.critical_findings.map(
      (finding: JsonObject) => finding.stable_identity,
    );
    expect(new Set(inventoryIds).size).toBe(5);
    expect(diagnostic.ranking.map((entry: JsonObject) => entry.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(diagnostic.ranking.map((entry: JsonObject) => entry.stable_identity).sort()).toEqual(
      [...inventoryIds].sort(),
    );
    expect(diagnostic.ranking[0].stable_identity).toBe(diagnostic.selected.stable_identity);

    for (const finding of diagnostic.critical_findings as JsonObject[]) {
      expect(finding).toEqual(
        expect.objectContaining({
          stable_identity: expect.any(String),
          finding_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
          family: expect.any(String),
          code: expect.any(String),
          extracted_id: expect.any(String),
          source_segments: expect.any(Array),
          extracted_record: expect.any(String),
          golden_representation: expect.any(String),
          alignment: expect.any(String),
          category: expect.any(String),
          source_grounded: true,
          likely_root_cause: expect.any(String),
          confidence: expect.any(String),
          expected_blast_radius: expect.any(String),
          policy_change_required: expect.any(Boolean),
          controls_or_dr001_effect: expect.any(String),
          previous_adjudication: expect.any(String),
          coupled_to: expect.any(Array),
        }),
      );
    }
    for (const entry of diagnostic.ranking as JsonObject[]) {
      expect(Object.keys(entry.criteria)).toHaveLength(10);
      expect(Object.values(entry.criteria).every((score) => Number.isInteger(score))).toBe(true);
      expect(
        Object.values(entry.criteria).reduce(
          (total: number, score) => total + (score as number),
          0,
        ),
      ).toBe(entry.score);
    }
  });

  it('keeps the selected finding stable and proves its evaluator-layer root cause', () => {
    const before = evaluateProjection();
    const selectedBefore = before.report.errors.find(
      (finding) => finding.extracted_id === 'term_price_1',
    );
    expect(findingIdentity(selectedBefore!)).toBe(diagnostic.selected.stable_identity);
    expect(diagnostic.selected.classification).toBe('evaluator_defect');

    const counterfactual = diagnosticProjection();
    const term = counterfactual.extracted.agreement.terms.find(
      (candidate: JsonObject) => candidate.term_id === 'term_price_1',
    );
    term.wording = diagnostic.selected.counterfactual.to;
    const after = evaluateProjection(counterfactual);
    const selectedAfter = after.report.errors.find(
      (finding) => finding.extracted_id === 'term_price_1',
    );

    expect(after.alignment.families.agreement_terms).toEqual(
      before.alignment.families.agreement_terms,
    );
    expect(selectedBefore).toMatchObject({
      severity: 'critical',
      code: 'unsupported_extra_object',
    });
    expect(selectedAfter).toMatchObject({
      severity: 'minor',
      code: 'agreement_term_decomposition',
    });
    expect(
      after.report.errors
        .filter(
          (finding) => finding.severity === 'critical' && finding.extracted_id !== 'term_price_1',
        )
        .map(findingIdentity),
    ).toEqual(
      before.report.errors
        .filter(
          (finding) => finding.severity === 'critical' && finding.extracted_id !== 'term_price_1',
        )
        .map(findingIdentity),
    );
  });

  it('preserves the baseline finding rather than filtering or re-tiering it', () => {
    const { report } = evaluateProjection();
    expect(report.errors.find((finding) => finding.extracted_id === 'term_price_1')).toEqual({
      severity: 'critical',
      family: 'agreement_terms',
      code: 'unsupported_extra_object',
      message: 'Extracted object has no supported golden match and is a fabrication hard failure.',
      extracted_id: 'term_price_1',
    });
    expect(diagnostic.selected.implementation_decision).toBe('diagnostic_only');
    expect(diagnostic.baseline).toMatchObject({
      critical: 5,
      major: 15,
      minor: 14,
      total: 34,
      acceptance: 'pass',
    });
  });

  it('locks two byte-identical canonical offline replays with no calls, retries, or edits', () => {
    expect(diagnostic.case.canonical_replays).toHaveLength(2);
    expect(
      new Set(
        diagnostic.case.canonical_replays.map((replay: JsonObject) => replay.extraction_sha256),
      ),
    ).toEqual(new Set([diagnostic.case.frozen_evidence.extraction_sha256]));
    for (const replay of diagnostic.case.canonical_replays as JsonObject[]) {
      expect(replay).toMatchObject({
        provider_calls: 0,
        retries: 0,
        manually_edited: false,
      });
    }
  });

  it('keeps the acceptance gate, historical results, and controls unchanged', async () => {
    const cases = await loadPersonAExtractionAcceptanceManifest(
      resolve(root, 'src/fixtures/person-a-extraction-acceptance.manifest.json'),
    );
    const suite = evaluatePersonAExtractionAcceptanceSuite(cases);
    const serialized = serializePersonAExtractionAcceptance(suite);

    expect(sha256(serialized)).toBe(diagnostic.case.frozen_evidence.acceptance_sha256);
    expect(suite.gate_passed).toBe(true);
    expect(suite.historical_model_acceptance).toEqual({ accepted: 0, total: 3 });
    expect(suite.by_origin.hand_authored_control).toEqual({
      accepted: 3,
      rejected: 0,
      total: 3,
    });
  });

  it('keeps every protected Dry Run 001 artifact byte-identical', () => {
    const protectedFiles: Record<string, string> = {
      narrative_sha256: 'src/fixtures/dry_run_001.person_a.txt',
      golden_sha256: 'src/fixtures/dry_run_001.person_a.golden.extraction.json',
      frozen_extraction_sha256: 'docs/dry-run-001/extraction.json',
      frozen_alignment_sha256: 'docs/dry-run-001/alignment.json',
      frozen_evaluation_sha256: 'docs/dry-run-001/report.json',
      raw_response_sha256: 'docs/dry-run-001/raw-response.json',
      golden_projection_sha256: 'docs/dry-run-001/golden-projection.json',
      run_manifest_sha256: 'docs/dry-run-001/run-manifest.json',
    };

    for (const [identity, path] of Object.entries(protectedFiles)) {
      expect(sha256(readFileSync(resolve(root, path))), path).toBe(
        diagnostic.protected_dr001[identity],
      );
    }
  });
});
