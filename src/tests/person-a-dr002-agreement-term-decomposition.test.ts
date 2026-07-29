import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignPersonAForCase } from '../alignment/person-a-alignment-corrected.js';
import { structuredMonetaryRecordFingerprint } from '../alignment/person-a-monetary-identity-compatibility.js';
import { evaluatePersonAForCase } from '../evaluation/person-a-diff-corrected.js';
import { isDryRun002AgreementTermDecompositionDiagnostic } from '../evaluation/person-a-dr002-agreement-term-decomposition.js';
import {
  evaluatePersonAExtractionAcceptanceSuite,
  loadPersonAExtractionAcceptanceManifest,
  serializePersonAExtractionAcceptance,
} from '../evaluation/person-a-extraction-acceptance.js';

type JsonObject = Record<string, any>;

const root = process.cwd();
const evidence = JSON.parse(
  readFileSync(
    resolve(root, 'src/fixtures/dry_run_002.pr26.decomposition-correction.json'),
    'utf8',
  ),
) as JsonObject;
const pr25 = JSON.parse(
  readFileSync(resolve(root, 'src/fixtures/dry_run_002.pr25.critical-diagnostic.json'), 'utf8'),
) as JsonObject;
const narrative = readFileSync(resolve(root, 'src/fixtures/dry_run_002.person_a.txt'), 'utf8');
const options = {
  aliases: { client: 'priya', restorer: 'jordan' },
  contractVersion: 'calibrated_live_v2' as const,
  narrative,
};

const historicalDiagnostic = {
  severity: 'critical',
  family: 'agreement_terms',
  code: 'unsupported_extra_object',
  message: 'Extracted object has no supported golden match and is a fabrication hard failure.',
  extracted_id: 'term_price_1',
};

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function record(name: string): JsonObject {
  return structuredClone(pr25.records[name].value) as JsonObject;
}

function projection(): { extracted: JsonObject; golden: JsonObject } {
  return {
    extracted: {
      submission: { raw_text: narrative },
      agreement: {
        terms: [
          record('term_scope_1'),
          record('term_price_1'),
          ...structuredClone(evidence.additional_extracted_terms),
        ],
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
      agreement: { terms: [record('term_dry_run_002')] },
      deliverable_assessments: [],
      claims: [],
    },
  };
}

function evaluate(candidate = projection(), alignmentOverride?: JsonObject) {
  const alignment =
    alignmentOverride ?? alignPersonAForCase(candidate.extracted, candidate.golden, options);
  return {
    alignment,
    report: evaluatePersonAForCase(
      candidate.extracted,
      candidate.golden,
      alignment as ReturnType<typeof alignPersonAForCase>,
      options,
    ),
  };
}

function selected(report: ReturnType<typeof evaluate>['report']): JsonObject | undefined {
  return report.errors.find((finding) => finding.extracted_id === 'term_price_1');
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

function expectTargetToFailClosed(candidate: ReturnType<typeof projection>): void {
  expect(selected(evaluate(candidate).report)).toEqual(historicalDiagnostic);
}

describe('PR #26 frozen DR002 agreement-term decomposition correction', () => {
  it('reclassifies exactly the verified price finding without removing or reordering it', () => {
    const { alignment, report } = evaluate();
    expect(alignment.families.agreement_terms).toEqual(evidence.alignment);
    expect(structuredMonetaryRecordFingerprint(alignment.families.agreement_terms)).toBe(
      evidence.case.agreement_alignment_fingerprint,
    );
    expect(selected(report)).toEqual({
      severity: 'minor',
      family: 'agreement_terms',
      code: 'agreement_term_decomposition',
      message:
        'Separately named source-grounded agreement component is covered by a broader compatible golden term.',
      extracted_id: 'term_price_1',
    });

    const observedOtherCriticals = report.errors
      .filter((finding) => finding.severity === 'critical')
      .map(findingIdentity);
    expect(observedOtherCriticals).toEqual(evidence.unchanged_critical_findings);
    expect(report.errors.filter((finding) => finding.extracted_id === 'term_price_1')).toHaveLength(
      1,
    );
  });

  it('binds the complete 34-finding before/after inventory to a one-entry delta', () => {
    expect(evidence.correction.before).toEqual({
      critical: 5,
      major: 15,
      minor: 14,
      total: 34,
    });
    expect(evidence.correction.after).toEqual({
      critical: 4,
      major: 15,
      minor: 15,
      total: 34,
    });
    expect(evidence.after_finding_identities).toHaveLength(34);
    expect(
      evidence.after_finding_identities.filter(
        (identity: string) => identity === evidence.correction.replacement_finding,
      ),
    ).toHaveLength(1);

    const before = [...evidence.after_finding_identities] as string[];
    const changedIndex = before.indexOf(evidence.correction.replacement_finding);
    expect(changedIndex).toBe(2);
    before[changedIndex] = evidence.correction.exact_changed_finding;
    expect(
      before.filter((identity, index) => identity !== evidence.after_finding_identities[index]),
    ).toEqual([evidence.correction.exact_changed_finding]);
    expect(evidence.correction.finding_count_preserved).toBe(true);
    expect(evidence.correction.ordering_preserved).toBe(true);
  });

  it('binds the exact source, records, consolidated golden, and matched pair', () => {
    const candidate = projection();
    const alignment = alignPersonAForCase(candidate.extracted, candidate.golden, options);
    const target = candidate.extracted.agreement.terms[1];
    const scope = candidate.extracted.agreement.terms[0];
    const golden = candidate.golden.agreement.terms[0];

    expect(sha256(narrative)).toBe(evidence.case.narrative_sha256);
    expect(narrative.slice(evidence.source.start_char, evidence.source.end_char)).toBe(
      evidence.source.quote,
    );
    expect(structuredMonetaryRecordFingerprint(target)).toBe(
      evidence.fingerprints.extracted_record,
    );
    expect(structuredMonetaryRecordFingerprint(scope)).toBe(
      evidence.fingerprints.matched_extracted_scope,
    );
    expect(structuredMonetaryRecordFingerprint(golden)).toBe(evidence.fingerprints.matched_golden);
    expect(structuredMonetaryRecordFingerprint(target.source_spans[0])).toBe(
      evidence.fingerprints.source_span,
    );
    expect(structuredMonetaryRecordFingerprint(alignment.families.agreement_terms.pairs[0])).toBe(
      evidence.fingerprints.matched_alignment_pair,
    );
    expect(structuredMonetaryRecordFingerprint(historicalDiagnostic)).toBe(
      evidence.fingerprints.unsupported_diagnostic,
    );
    expect(
      isDryRun002AgreementTermDecompositionDiagnostic(
        historicalDiagnostic,
        candidate.extracted,
        candidate.golden,
        alignment,
        narrative,
        options.contractVersion,
      ),
    ).toBe(true);
  });

  it.each([
    ['different amount', { wording: 'The total price was $1,900.' }],
    ['different currency', { wording: 'The total price was €1,800.' }],
    ['installment condition', { wording: 'The total price was $1,800, payable in installments.' }],
    ['refund condition', { wording: 'The total price was $1,800, subject to a refund.' }],
    ['timing condition', { wording: 'The total price was $1,800, payable within thirty days.' }],
    ['delivery condition', { wording: 'The total price was $1,800, only after delivery.' }],
    ['payment condition', { wording: 'The total price was $1,800 if payment clears.' }],
    [
      'semantic similarity without full containment',
      { wording: 'The total price was $1,800 for unrelated tables.' },
    ],
    ['structural fingerprint drift', { pr26_unexpected: true }],
  ])('fails closed on %s', (_name, mutation) => {
    const candidate = projection();
    Object.assign(candidate.extracted.agreement.terms[1], mutation);
    expectTargetToFailClosed(candidate);
  });

  it('fails closed when the source span does not independently support the price', () => {
    const candidate = projection();
    candidate.extracted.agreement.terms[1].source_spans = [
      {
        submission_id: 'sub_a_extracted',
        quote: narrative.slice(514, 625),
        start_char: 514,
        end_char: 625,
      },
    ];
    expectTargetToFailClosed(candidate);
  });

  it('fails closed when the source span is malformed or unrelated', () => {
    const malformed = projection();
    malformed.extracted.agreement.terms[1].source_spans[0].quote = 'not the source slice';
    expectTargetToFailClosed(malformed);

    const unrelated = projection();
    unrelated.extracted.agreement.terms[1].source_spans[0].submission_id = 'unrelated_submission';
    expectTargetToFailClosed(unrelated);
  });

  it('fails closed when the consolidated golden record is absent', () => {
    const candidate = projection();
    candidate.golden.agreement.terms = [];
    expectTargetToFailClosed(candidate);
  });

  it('fails closed when the expected matched pair or alignment fingerprint changes', () => {
    const candidate = projection();
    const alignment = alignPersonAForCase(candidate.extracted, candidate.golden, options);
    alignment.families.agreement_terms.pairs = [];
    alignment.families.agreement_terms.unmatched_extracted.unshift({
      index: 0,
      id: 'term_scope_1',
    });
    alignment.families.agreement_terms.unmatched_golden = [{ index: 0, id: 'term_dry_run_002' }];
    expect(selected(evaluate(candidate, alignment).report)).toEqual(historicalDiagnostic);
    expect(
      isDryRun002AgreementTermDecompositionDiagnostic(
        historicalDiagnostic,
        candidate.extracted,
        candidate.golden,
        alignment,
        narrative,
        options.contractVersion,
      ),
    ).toBe(false);
  });

  it('does not apply to another family or any other DR002 critical unmatched object', () => {
    const candidate = projection();
    const { alignment, report } = evaluate(candidate);
    for (const identity of evidence.unchanged_critical_findings as string[]) {
      expect(report.errors.map(findingIdentity)).toContain(identity);
    }
    for (const extractedId of [
      'claim_payment_term_1',
      'claim_scope_1',
      'claim_no_refund_1',
      'deliverable_1',
    ]) {
      const other = report.errors.find((finding) => finding.extracted_id === extractedId)!;
      expect(other).toMatchObject({ severity: 'critical', code: 'unsupported_extra_object' });
      expect(
        isDryRun002AgreementTermDecompositionDiagnostic(
          other,
          candidate.extracted,
          candidate.golden,
          alignment,
          narrative,
          options.contractVersion,
        ),
      ).toBe(false);
    }
  });

  it('rejects changed diagnostic, contract, narrative, proxy, and accessor inputs', () => {
    const candidate = projection();
    const alignment = alignPersonAForCase(candidate.extracted, candidate.golden, options);

    expect(
      isDryRun002AgreementTermDecompositionDiagnostic(
        { ...historicalDiagnostic, family: 'claims' },
        candidate.extracted,
        candidate.golden,
        alignment,
        narrative,
        options.contractVersion,
      ),
    ).toBe(false);
    expect(
      isDryRun002AgreementTermDecompositionDiagnostic(
        historicalDiagnostic,
        candidate.extracted,
        candidate.golden,
        alignment,
        narrative,
        'legacy_v1' as never,
      ),
    ).toBe(false);
    expect(
      isDryRun002AgreementTermDecompositionDiagnostic(
        historicalDiagnostic,
        candidate.extracted,
        candidate.golden,
        alignment,
        `${narrative} drift`,
        options.contractVersion,
      ),
    ).toBe(false);
    expect(
      isDryRun002AgreementTermDecompositionDiagnostic(
        historicalDiagnostic,
        new Proxy(candidate.extracted, {}),
        candidate.golden,
        alignment,
        narrative,
        options.contractVersion,
      ),
    ).toBe(false);

    const accessorBearing = structuredClone(candidate.extracted);
    Object.defineProperty(accessorBearing.agreement.terms[1], 'wording', {
      enumerable: true,
      get: () => 'The total price was $1,800.',
    });
    expect(
      isDryRun002AgreementTermDecompositionDiagnostic(
        historicalDiagnostic,
        accessorBearing,
        candidate.golden,
        alignment,
        narrative,
        options.contractVersion,
      ),
    ).toBe(false);
  });

  it('keeps acceptance, replay provenance, and protected DR001 hashes locked', async () => {
    const cases = await loadPersonAExtractionAcceptanceManifest(
      resolve(root, 'src/fixtures/person-a-extraction-acceptance.manifest.json'),
    );
    const suite = evaluatePersonAExtractionAcceptanceSuite(cases);
    expect(suite.gate_passed).toBe(true);
    expect(suite.historical_model_acceptance).toEqual({ accepted: 0, total: 3 });
    expect(suite.by_origin.hand_authored_control).toEqual({
      accepted: 3,
      rejected: 0,
      total: 3,
    });
    expect(sha256(serializePersonAExtractionAcceptance(suite))).toBe(
      evidence.acceptance.serialized_sha256,
    );

    expect(evidence.replays).toHaveLength(2);
    expect(new Set(evidence.replays.map((replay: JsonObject) => replay.extraction_sha256))).toEqual(
      new Set([evidence.case.frozen_extraction_sha256]),
    );
    for (const replay of evidence.replays as JsonObject[]) {
      expect(replay).toMatchObject({
        validation_sha256: evidence.case.validation_sha256,
        alignment_sha256: evidence.case.alignment_sha256,
        evaluation_sha256: evidence.case.after_evaluation_sha256,
        provider_calls: 0,
        retries: 0,
        manually_edited: false,
      });
    }

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
  });
});
