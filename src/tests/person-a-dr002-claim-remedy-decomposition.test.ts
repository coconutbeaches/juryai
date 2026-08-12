import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  alignPersonAForCase,
  semanticSimilarity,
} from '../alignment/person-a-alignment-corrected.js';
import { structuredMonetaryRecordFingerprint } from '../alignment/person-a-monetary-identity-compatibility.js';
import { isDryRun002ClaimRemedyDecompositionDiagnostic } from '../evaluation/person-a-dr002-claim-remedy-decomposition.js';
import { evaluatePersonAForCase } from '../evaluation/person-a-diff-corrected.js';
import {
  evaluatePersonAExtractionAcceptanceSuite,
  loadPersonAExtractionAcceptanceManifest,
} from '../evaluation/person-a-extraction-acceptance.js';
import { serializePersonAProvenanceJson } from '../extraction/person-a-provenance.js';

type JsonObject = Record<string, any>;

const root = process.cwd();
const evidence = JSON.parse(
  readFileSync(
    resolve(root, 'src/fixtures/dry_run_002.pr28.claim-remedy-decomposition-correction.json'),
    'utf8',
  ),
) as JsonObject;
const pr27 = JSON.parse(
  readFileSync(
    resolve(root, 'src/fixtures/dry_run_002.pr27.claim-no-refund-diagnostic.json'),
    'utf8',
  ),
) as JsonObject;
const narrative = readFileSync(resolve(root, 'src/fixtures/dry_run_002.person_a.txt'), 'utf8');
const goldenBytes = readFileSync(
  resolve(root, 'src/fixtures/dry_run_002.person_a.golden.extraction.json'),
);
const goldenFixture = JSON.parse(goldenBytes.toString('utf8')) as JsonObject;
const historicalDiagnostic = {
  severity: 'critical',
  family: 'claims',
  code: 'unsupported_extra_object',
  message: 'Extracted object has no supported golden match and is a fabrication hard failure.',
  extracted_id: 'claim_no_refund_1',
};
const replacementDiagnostic = {
  severity: 'minor',
  family: 'claims',
  code: 'claim_remedy_decomposition',
  message:
    'Separately represented source-grounded no-refund position is covered by a broader matched golden remedy claim.',
  extracted_id: 'claim_no_refund_1',
};

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function candidate(): { extracted: JsonObject; golden: JsonObject } {
  return {
    extracted: structuredClone(evidence.frozen_extraction),
    golden: structuredClone(goldenFixture),
  };
}

function evaluate(
  extracted: JsonObject,
  golden: JsonObject,
  options: { narrative?: string; alignment?: JsonObject } = {},
) {
  const evaluatedNarrative = options.narrative ?? narrative;
  const evaluatorOptions = {
    aliases: { client: 'priya', restorer: 'jordan' },
    contractVersion: 'calibrated_live_v2' as const,
    narrative: evaluatedNarrative,
  };
  const alignment = options.alignment ?? alignPersonAForCase(extracted, golden, evaluatorOptions);
  const report = evaluatePersonAForCase(
    extracted,
    golden,
    alignment as ReturnType<typeof alignPersonAForCase>,
    evaluatorOptions,
  );
  return { alignment, report };
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

function target(report: JsonObject, id = 'claim_no_refund_1'): JsonObject | undefined {
  return report.errors.find((finding: JsonObject) => finding.extracted_id === id);
}

function targetClaim(extracted: JsonObject): JsonObject {
  return extracted.claims.find((claim: JsonObject) => claim.claim_id === 'claim_no_refund_1');
}

function expectTargetCritical(
  extracted: JsonObject,
  golden: JsonObject = structuredClone(goldenFixture),
  options: { narrative?: string; alignment?: JsonObject; id?: string } = {},
): void {
  expect(target(evaluate(extracted, golden, options).report, options.id)).toEqual({
    ...historicalDiagnostic,
    extracted_id: options.id ?? historicalDiagnostic.extracted_id,
  });
}

describe('PR #28 frozen DR002 claim remedy decomposition correction', () => {
  it('reclassifies only the exact frozen no-refund finding', () => {
    const { extracted, golden } = candidate();
    const { alignment, report } = evaluate(extracted, golden);

    expect(target(report)).toEqual(replacementDiagnostic);
    expect(report.summary).toMatchObject({ critical: 3, major: 15, minor: 16 });
    expect(report.errors).toHaveLength(34);
    expect(
      report.errors.filter((finding: JsonObject) => finding.extracted_id === 'claim_no_refund_1'),
    ).toHaveLength(1);
    expect(
      isDryRun002ClaimRemedyDecompositionDiagnostic(
        historicalDiagnostic,
        extracted,
        golden,
        alignment,
        narrative,
        'calibrated_live_v2',
      ),
    ).toBe(true);
  });

  it('recomputes the frozen extraction and alignment hashes without ignored artifacts', () => {
    const { extracted, golden } = candidate();
    const { alignment } = evaluate(extracted, golden);

    expect(sha256(serializePersonAProvenanceJson(extracted))).toBe(
      evidence.case.extraction_file_sha256,
    );
    expect(structuredMonetaryRecordFingerprint(extracted)).toBe(
      evidence.fingerprints.complete_extraction,
    );
    expect(sha256(goldenBytes)).toBe(evidence.case.golden_file_sha256);
    expect(structuredMonetaryRecordFingerprint(golden)).toBe(evidence.fingerprints.complete_golden);
    expect(sha256(serializePersonAProvenanceJson(alignment))).toBe(
      evidence.case.before_alignment_sha256,
    );
    expect(evidence.case.after_alignment_sha256).toBe(evidence.case.before_alignment_sha256);
  });

  it('recomputes the historical critical through ordinary evaluator behavior', () => {
    const { extracted, golden } = candidate();
    extracted.pr28_fingerprint_drift = true;
    const { alignment, report } = evaluate(extracted, golden);

    expect(target(report)).toEqual(historicalDiagnostic);
    expect(report.summary).toMatchObject({ critical: 4, major: 15, minor: 15 });
    expect(sha256(serializePersonAProvenanceJson(alignment))).toBe(
      evidence.case.before_alignment_sha256,
    );
    expect(sha256(serializePersonAProvenanceJson(report))).toBe(
      evidence.case.before_evaluation_sha256,
    );
  });

  it('proves exactly one ordered finding object changes and the other 33 are byte-identical', () => {
    const beforeCandidate = candidate();
    beforeCandidate.extracted.pr28_fingerprint_drift = true;
    const before = evaluate(beforeCandidate.extracted, beforeCandidate.golden).report;
    const afterCandidate = candidate();
    const after = evaluate(afterCandidate.extracted, afterCandidate.golden).report;

    const changes = before.errors.flatMap((finding: JsonObject, index: number) =>
      JSON.stringify(finding) === JSON.stringify(after.errors[index])
        ? []
        : [{ index, before: finding, after: after.errors[index] }],
    );
    expect(changes).toEqual([
      { index: 18, before: historicalDiagnostic, after: replacementDiagnostic },
    ]);
    expect(before.errors).toHaveLength(after.errors.length);
    expect(before.errors.length - changes.length).toBe(33);

    const beforeIdentities = before.errors.map(findingIdentity);
    const afterIdentities = after.errors.map(findingIdentity);
    expect(beforeIdentities).toEqual(pr27.after_finding_identities);
    expect(afterIdentities).toEqual(evidence.after_finding_identities);
    expect(sha256(serializePersonAProvenanceJson(beforeIdentities))).toBe(
      evidence.case.before_finding_set_sha256,
    );
    expect(sha256(serializePersonAProvenanceJson(afterIdentities))).toBe(
      evidence.case.after_finding_set_sha256,
    );
    expect(sha256(serializePersonAProvenanceJson(after))).toBe(
      evidence.case.after_evaluation_sha256,
    );
  });

  it('fails closed for the same textual pattern under a different case identity', () => {
    const { extracted } = candidate();
    extracted.submission.submission_id = 'sub_different_case';
    expectTargetCritical(extracted);
  });

  it('fails closed for the same source span with different extracted meaning', () => {
    const { extracted } = candidate();
    targetClaim(extracted).claim_text = 'Jordan refuses to return unrelated furniture.';
    expectTargetCritical(extracted);
  });

  it('fails closed for the same extraction text when the golden drifts', () => {
    const { extracted, golden } = candidate();
    golden.claims.find(
      (claim: JsonObject) => claim.claim_id === 'cl_002_remedy',
    ).requires_clarification = false;
    expectTargetCritical(extracted, golden);
  });

  it('fails closed for the same golden when only alignment evidence drifts', () => {
    const { extracted, golden } = candidate();
    const alignment = alignPersonAForCase(extracted, golden, {
      aliases: { client: 'priya', restorer: 'jordan' },
      contractVersion: 'calibrated_live_v2',
      narrative,
    });
    const pair = alignment.families.claims.pairs.find(
      (entry) => entry.golden_id === 'cl_002_remedy',
    )!;
    pair.margin += 0.000001;
    expectTargetCritical(extracted, golden, { alignment });
  });

  it('does not reuse the score or wording for another claim or refund fixture', () => {
    const sameScore = candidate();
    const frozenText = targetClaim(sameScore.extracted).claim_text;
    sameScore.extracted.claims.find(
      (claim: JsonObject) => claim.claim_id === 'claim_scope_1',
    ).claim_text = frozenText;
    const sameScoreReport = evaluate(sameScore.extracted, sameScore.golden).report;
    expect(target(sameScoreReport)).toEqual(historicalDiagnostic);
    expect(target(sameScoreReport, 'claim_scope_1')).toMatchObject({
      severity: 'critical',
      code: 'unsupported_extra_object',
    });
    const goldenRemedy = sameScore.golden.claims.find(
      (claim: JsonObject) => claim.claim_id === 'cl_002_remedy',
    );
    expect(
      semanticSimilarity(frozenText, goldenRemedy.claim_text, {
        client: 'priya',
        restorer: 'jordan',
      }),
    ).toBeCloseTo(
      pr27.similarity_analysis.per_substitution_attribution.frozen_extraction_similarity,
      6,
    );

    const otherFixture = candidate();
    targetClaim(otherFixture.extracted).claim_id = 'claim_no_refund_other_fixture';
    otherFixture.extracted.submission.submission_id = 'sub_other_fixture';
    expectTargetCritical(otherFixture.extracted, otherFixture.golden, {
      id: 'claim_no_refund_other_fixture',
    });
  });

  it('fails closed without source support and for fabricated lexical overlap', () => {
    const unsupported = candidate();
    targetClaim(unsupported.extracted).source_spans = [
      {
        submission_id: 'sub_a_extracted',
        quote: narrative.slice(58, 200),
        start_char: 58,
        end_char: 200,
      },
    ];
    expectTargetCritical(unsupported.extracted);

    const fabricated = candidate();
    targetClaim(fabricated.extracted).claim_text =
      "Jordan fabricated a refund invoice for Priya's chairs.";
    expectTargetCritical(fabricated.extracted);
  });

  it('leaves legitimate unsupported extras and evidence fingerprint drift critical', () => {
    const { extracted, golden } = candidate();
    const baseline = evaluate(extracted, golden);
    const paymentTerm = target(baseline.report, 'claim_payment_term_1')!;
    expect(paymentTerm).toMatchObject({ severity: 'critical', code: 'unsupported_extra_object' });
    expect(
      isDryRun002ClaimRemedyDecompositionDiagnostic(
        paymentTerm,
        extracted,
        golden,
        baseline.alignment,
        narrative,
        'calibrated_live_v2',
      ),
    ).toBe(false);

    targetClaim(extracted).unexpected_evidence = true;
    expectTargetCritical(extracted, golden);
  });

  it('rejects contract, narrative, proxy, and accessor drift', () => {
    const { extracted, golden } = candidate();
    const { alignment } = evaluate(extracted, golden);
    const call = (extractedValue: unknown, narrativeValue: unknown, contract: any) =>
      isDryRun002ClaimRemedyDecompositionDiagnostic(
        historicalDiagnostic,
        extractedValue,
        golden,
        alignment,
        narrativeValue,
        contract,
      );

    expect(call(extracted, narrative, 'legacy_v1')).toBe(false);
    expect(call(extracted, `${narrative} drift`, 'calibrated_live_v2')).toBe(false);
    expect(call(new Proxy(extracted, {}), narrative, 'calibrated_live_v2')).toBe(false);

    const accessorBearing = structuredClone(extracted);
    Object.defineProperty(targetClaim(accessorBearing), 'claim_text', {
      enumerable: true,
      get: () => 'Jordan is not seeking to refund Priya.',
    });
    expect(call(accessorBearing, narrative, 'calibrated_live_v2')).toBe(false);
  });

  it('preserves PR #26 and the three other DR002 criticals', () => {
    const { extracted, golden } = candidate();
    const { report } = evaluate(extracted, golden);

    expect(target(report, 'term_price_1')).toMatchObject({
      severity: 'minor',
      family: 'agreement_terms',
      code: 'agreement_term_decomposition',
    });
    const remaining = report.errors
      .filter((finding: JsonObject) => finding.severity === 'critical')
      .map((finding: JsonObject) => finding.extracted_id)
      .sort();
    expect(remaining).toEqual([...evidence.remaining_criticals].sort());
  });

  it('preserves DR001 behavior and protected artifact identities', async () => {
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
        evidence.protected_dr001[identity],
      );
    }

    const cases = await loadPersonAExtractionAcceptanceManifest(
      resolve(root, 'src/fixtures/person-a-extraction-acceptance.manifest.json'),
    );
    const suite = evaluatePersonAExtractionAcceptanceSuite(cases);
    expect(suite.gate_passed).toBe(true);
    expect(suite.historical_model_acceptance).toEqual({ accepted: 0, total: 3 });
    expect(
      suite.results
        .filter((result) => result.case_id === 'dry_run_001')
        .map((result) => [
          result.candidate_id,
          result.status,
          result.critical_count,
          result.major_count,
          result.minor_count,
        ]),
    ).toEqual([
      ['golden_control', 'accepted', 0, 0, 0],
      ['historical_saved_v1', 'rejected', 1, 54, 18],
      ['historical_saved_v2', 'rejected', 1, 56, 15],
      ['historical_saved_v3', 'rejected', 1, 56, 18],
    ]);
  });

  it('records two provider-free, retry-free, unedited post-correction replays', () => {
    expect(evidence.replays).toHaveLength(2);
    for (const replay of evidence.replays as JsonObject[]) {
      expect(replay).toEqual({
        replay_index: replay.replay_index,
        extraction_sha256: evidence.case.extraction_file_sha256,
        alignment_sha256: evidence.case.after_alignment_sha256,
        evaluation_sha256: evidence.case.after_evaluation_sha256,
        finding_set_sha256: evidence.case.after_finding_set_sha256,
        provider_calls: 0,
        retries: 0,
        manually_edited: false,
      });
    }
  });
});
