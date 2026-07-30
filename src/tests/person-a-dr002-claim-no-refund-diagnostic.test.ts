import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignPersonAForCase } from '../alignment/person-a-alignment-corrected.js';
import { semanticSimilarity } from '../alignment/person-a-alignment.js';
import { structuredMonetaryRecordFingerprint } from '../alignment/person-a-monetary-identity-compatibility.js';
import { evaluatePersonAForCase } from '../evaluation/person-a-diff-corrected.js';
import { serializePersonAProvenanceJson } from '../extraction/person-a-provenance.js';

type JsonObject = Record<string, any>;

const root = process.cwd();
const evidence = JSON.parse(
  readFileSync(
    resolve(root, 'src/fixtures/dry_run_002.pr27.claim-no-refund-diagnostic.json'),
    'utf8',
  ),
) as JsonObject;

const narrative = readFileSync(resolve(root, 'src/fixtures/dry_run_002.person_a.txt'), 'utf8');
const goldenBytes = readFileSync(
  resolve(root, 'src/fixtures/dry_run_002.person_a.golden.extraction.json'),
);
const extractionBytes = readFileSync(
  resolve(
    root,
    'artifacts/person-a/dry-run-002-live-20260729T082958Z/dry_run_002.person_a.extraction.json',
  ),
);

const aliases = { client: 'priya', restorer: 'jordan' };
const contractVersion = 'calibrated_live_v2' as const;
const options = { aliases, contractVersion, narrative };

const HISTORICAL_IDENTITY = 'critical|claims|unsupported_extra_object|claim_no_refund_1|';

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
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

function baseline() {
  const extracted = JSON.parse(extractionBytes.toString('utf8')) as JsonObject;
  const golden = JSON.parse(goldenBytes.toString('utf8')) as JsonObject;
  return { extracted, golden };
}

function evaluate(extracted: JsonObject, golden: JsonObject) {
  const alignment = alignPersonAForCase(extracted, golden, { aliases, contractVersion });
  const report = evaluatePersonAForCase(extracted, golden, alignment, options);
  return { alignment, report };
}

function target(report: { errors: JsonObject[] }): JsonObject | undefined {
  return report.errors.find((finding) => finding.extracted_id === 'claim_no_refund_1');
}

describe('PR #27 DR002 claim_no_refund_1 diagnostic', () => {
  it('reproduces the exact historical critical finding and the frozen 34-finding baseline', () => {
    const { extracted, golden } = baseline();
    const { alignment, report } = evaluate(extracted, golden);

    expect(target(report)).toEqual({
      severity: 'critical',
      family: 'claims',
      code: 'unsupported_extra_object',
      message: 'Extracted object has no supported golden match and is a fabrication hard failure.',
      extracted_id: 'claim_no_refund_1',
    });

    expect({
      critical: report.summary.critical,
      major: report.summary.major,
      minor: report.summary.minor,
      total: report.errors.length,
    }).toEqual({
      critical: evidence.baseline.critical,
      major: evidence.baseline.major,
      minor: evidence.baseline.minor,
      total: evidence.baseline.total,
    });

    const identities = report.errors.map(findingIdentity);
    expect(identities).toEqual(evidence.after_finding_identities);
    expect(sha256(serializePersonAProvenanceJson(identities))).toBe(
      evidence.case.finding_set_sha256,
    );
    expect(sha256(serializePersonAProvenanceJson(alignment))).toBe(evidence.case.alignment_sha256);
    expect(sha256(serializePersonAProvenanceJson(report))).toBe(evidence.case.evaluation_sha256);
  });

  it('binds the exact source, provenance spans, and record fingerprints used in the diagnosis', () => {
    const { extracted, golden } = baseline();
    const claim = extracted.claims.find(
      (item: JsonObject) => item.claim_id === 'claim_no_refund_1',
    );
    const goldenRemedy = golden.claims.find(
      (item: JsonObject) => item.claim_id === 'cl_002_remedy',
    );

    expect(sha256(narrative)).toBe(evidence.case.narrative_sha256);
    expect(sha256(goldenBytes)).toBe(evidence.case.golden_sha256);
    expect(sha256(extractionBytes)).toBe(evidence.case.extraction_sha256);

    const span = claim.source_spans[0];
    expect(span.start_char).toBe(evidence.source.start_char);
    expect(span.end_char).toBe(evidence.source.end_char);
    expect(narrative.slice(span.start_char, span.end_char)).toBe(evidence.source.quote);
    expect(span.quote).toBe(evidence.source.quote);

    // The golden claim text is byte-identical to the source span the extraction cites.
    expect(goldenRemedy.claim_text).toBe(evidence.source.quote);
    expect(goldenRemedy.source_spans[0].start_char).toBe(evidence.source.start_char);
    expect(goldenRemedy.source_spans[0].end_char).toBe(evidence.source.end_char);

    expect(structuredMonetaryRecordFingerprint(claim)).toBe(evidence.fingerprints.extracted_record);
    expect(structuredMonetaryRecordFingerprint(span)).toBe(
      evidence.fingerprints.extracted_source_span,
    );
    expect(structuredMonetaryRecordFingerprint(goldenRemedy)).toBe(
      evidence.fingerprints.golden_record,
    );
    expect(structuredMonetaryRecordFingerprint(goldenRemedy.source_spans[0])).toBe(
      evidence.fingerprints.golden_source_span,
    );
  });

  it('binds the exact alignment state and proves pairing is structurally impossible', () => {
    const { extracted, golden } = baseline();
    const { alignment, report } = evaluate(extracted, golden);
    const claims = alignment.families.claims;

    expect(structuredMonetaryRecordFingerprint(claims)).toBe(
      evidence.fingerprints.claims_alignment,
    );
    expect(claims.unmatched_golden).toEqual([]);
    expect(claims.ambiguous).toEqual([]);
    expect(
      claims.unmatched_extracted.find((item: JsonObject) => item.id === 'claim_no_refund_1'),
    ).toEqual({ id: 'claim_no_refund_1', index: evidence.alignment_state.target_unmatched_index });

    const remedyPair = claims.pairs.find((pair: JsonObject) => pair.golden_id === 'cl_002_remedy')!;
    expect(remedyPair.extracted_id).toBe('claim_balance_1');
    expect(remedyPair.score).toBe(evidence.alignment_state.golden_remedy_pair_score);
    expect(structuredMonetaryRecordFingerprint(remedyPair)).toBe(
      evidence.fingerprints.matched_sibling_pair,
    );

    // Claim pairing requires exact claim_type equality, so no golden claim is even a candidate.
    const claim = extracted.claims.find(
      (item: JsonObject) => item.claim_id === 'claim_no_refund_1',
    );
    expect(claim.claim_type).toBe('refund');
    expect(golden.claims.some((item: JsonObject) => item.claim_type === 'refund')).toBe(false);

    expect(structuredMonetaryRecordFingerprint(target(report))).toBe(
      evidence.fingerprints.historical_diagnostic,
    );
  });

  it('binds the evaluator path: maximal span overlap blocked only by the similarity threshold', () => {
    const { extracted, golden } = baseline();
    const claim = extracted.claims.find(
      (item: JsonObject) => item.claim_id === 'claim_no_refund_1',
    );
    const goldenRemedy = golden.claims.find(
      (item: JsonObject) => item.claim_id === 'cl_002_remedy',
    );

    const splitStep = evidence.evaluator_rule.decision_cascade.find(
      (step: JsonObject) => step.predicate === 'isMatchedGranularitySplit',
    );
    const groundingStep = evidence.evaluator_rule.decision_cascade.find(
      (step: JsonObject) => step.predicate === 'isSourceGroundedExtra',
    );

    // Span overlap against the matched golden claim is exact and maximal.
    expect(claim.source_spans[0].start_char).toBe(goldenRemedy.source_spans[0].start_char);
    expect(claim.source_spans[0].end_char).toBe(goldenRemedy.source_spans[0].end_char);
    expect(splitStep.span_overlap).toBe(1);
    expect(splitStep.span_overlap_met).toBe(true);
    expect(claim.party_id).toBe(goldenRemedy.party_id);

    // The only failing conjunct is the symmetric similarity threshold.
    const splitScore = semanticSimilarity(claim.claim_text, goldenRemedy.claim_text, aliases);
    expect(Number(splitScore.toFixed(6))).toBe(splitStep.meaning_similarity);
    expect(splitScore).toBeLessThan(splitStep.meaning_similarity_threshold);

    const quotes = claim.source_spans.map((item: JsonObject) => item.quote).join(' ');
    const groundingScore = semanticSimilarity(claim.claim_text, quotes, aliases);
    expect(Number(groundingScore.toFixed(6))).toBe(groundingStep.grounding_similarity);
    expect(groundingScore).toBeLessThan(groundingStep.grounding_threshold);

    // Symmetric Dice cannot reach either threshold at this length ratio, even under
    // perfect lexical containment. The metric scores resemblance, not entailment.
    expect(evidence.similarity_analysis.extracted_tokens_absent_from_golden).toEqual([
      'is',
      'jordan',
      'seeking',
    ]);
    expect(
      evidence.similarity_analysis.maximum_attainable_token_dice_under_perfect_lexical_containment,
    ).toBeCloseTo(0.583333, 6);
  });

  it('isolates the defect with a wording-only counterfactual that holds alignment constant', () => {
    const { extracted, golden } = baseline();
    const before = evaluate(extracted, golden);

    const counterfactual = baseline();
    counterfactual.extracted.claims.find(
      (item: JsonObject) => item.claim_id === 'claim_no_refund_1',
    ).claim_text = evidence.counterfactual.to;
    const after = evaluate(counterfactual.extracted, counterfactual.golden);

    // Only claim_text changes; claim_type and both source spans are untouched.
    expect(evidence.counterfactual.changed_field).toBe('claims[claim_no_refund_1].claim_text');
    expect(JSON.stringify(after.alignment.families.claims)).toBe(
      JSON.stringify(before.alignment.families.claims),
    );

    expect(findingIdentity(target(before.report)!)).toBe(HISTORICAL_IDENTITY);
    expect(findingIdentity(target(after.report)!)).toBe(evidence.counterfactual.after_identity);
    expect(evidence.counterfactual.after_identity).toBe(
      'major|claims|granularity_split|claim_no_refund_1|',
    );

    const beforeIdentities = before.report.errors.map(findingIdentity);
    const afterIdentities = after.report.errors.map(findingIdentity);
    expect(afterIdentities).toHaveLength(beforeIdentities.length);
    expect(
      beforeIdentities.filter((identity, index) => identity !== afterIdentities[index]),
    ).toEqual([HISTORICAL_IDENTITY]);
  });

  it('records the diagnosis without changing runtime behavior', () => {
    expect(evidence.selected.root_cause_classification).toBe('evaluator_defect');
    expect(evidence.selected.confidence).toBe('high');
    expect(evidence.selected.first_divergent_stage).toBe('evaluator_severity_classification');
    expect(evidence.selected.expected_correction_ownership).toBe('evaluator');
    expect(evidence.selected.behavior_changed_in_pr27).toBe(false);
    expect(evidence.runtime_change_gate.decision).toBe('diagnosis_only');
    expect(evidence.runtime_change_gate.behavior_changed).toBe(false);

    // The extraction introduces no meaning absent from the source.
    expect(evidence.semantic_component_analysis.unsupported_or_inferential_additions).toEqual([]);
    expect(evidence.semantic_component_analysis.modality_preserved).toBe(true);
    expect(
      evidence.semantic_component_analysis.difference_is_structural_decomposition_not_contradiction,
    ).toBe(true);
  });

  it.each([
    ['contradicted refund position', { claim_text: 'Jordan is seeking a full refund from Priya.' }],
    ['added amount', { claim_text: 'Jordan is not seeking to refund Priya the $900 deposit.' }],
    ['added condition', { claim_text: 'Jordan is not seeking to refund Priya unless she sues.' }],
    ['different party', { party_id: 'party_b' }],
    ['unrelated claim type', { claim_type: 'defect' }],
  ])('fails closed on %s: the historical critical is not silently preserved', (_name, mutation) => {
    const { extracted, golden } = baseline();
    const claim = extracted.claims.find(
      (item: JsonObject) => item.claim_id === 'claim_no_refund_1',
    );
    Object.assign(claim, mutation);

    const { report } = evaluate(extracted, golden);
    const observed = target(report);

    // Drift in material evidence must break the recorded fingerprint, so a mutated
    // record can never be certified by this diagnostic's frozen evidence.
    expect(structuredMonetaryRecordFingerprint(claim)).not.toBe(
      evidence.fingerprints.extracted_record,
    );
    if (observed)
      expect(findingIdentity(observed)).not.toBe(evidence.counterfactual.after_identity);
  });

  it('fails the diagnostic assertion when the golden or narrative evidence drifts', () => {
    const drifted = baseline();
    const goldenRemedy = drifted.golden.claims.find(
      (item: JsonObject) => item.claim_id === 'cl_002_remedy',
    );
    goldenRemedy.claim_text = 'I am asking Priya to pay the remaining $900 after delivery.';
    expect(structuredMonetaryRecordFingerprint(goldenRemedy)).not.toBe(
      evidence.fingerprints.golden_record,
    );
    expect(goldenRemedy.claim_text).not.toBe(evidence.source.quote);

    const { report } = evaluate(drifted.extracted, drifted.golden);
    expect(sha256(serializePersonAProvenanceJson(report))).not.toBe(
      evidence.case.evaluation_sha256,
    );

    expect(sha256(`${narrative} drift`)).not.toBe(evidence.case.narrative_sha256);
  });

  it('leaves the other three DR002 criticals and PR #26 term_price_1 unchanged', () => {
    const { extracted, golden } = baseline();
    const { report } = evaluate(extracted, golden);

    for (const extractedId of ['deliverable_1', 'claim_scope_1', 'claim_payment_term_1']) {
      const finding = report.errors.find(
        (item: JsonObject) => item.extracted_id === extractedId,
      ) as JsonObject;
      expect(finding, extractedId).toMatchObject({
        severity: 'critical',
        code: 'unsupported_extra_object',
      });
    }

    expect(report.errors.filter((item: JsonObject) => item.severity === 'critical')).toHaveLength(
      4,
    );
    expect(report.errors.map(findingIdentity).filter((id) => id.startsWith('critical|'))).toEqual(
      evidence.critical_findings,
    );

    // PR #26's correction is untouched.
    expect(
      report.errors.find((item: JsonObject) => item.extracted_id === 'term_price_1'),
    ).toMatchObject({
      severity: 'minor',
      family: 'agreement_terms',
      code: 'agreement_term_decomposition',
    });
  });

  it('keeps replay provenance, acceptance counts, and protected DR001 hashes locked', () => {
    expect(evidence.replays).toHaveLength(2);
    for (const replay of evidence.replays as JsonObject[]) {
      expect(replay).toMatchObject({
        extraction_sha256: evidence.case.extraction_sha256,
        validation_sha256: evidence.case.validation_sha256,
        reevaluated_alignment_sha256: evidence.case.alignment_sha256,
        reevaluated_evaluation_sha256: evidence.case.evaluation_sha256,
        provider_calls: 0,
        retries: 0,
        manually_edited: false,
      });
    }
    expect(evidence.baseline).toMatchObject({
      provider_calls: 0,
      retries: 0,
      manually_edited: false,
      historical_accepted: 0,
      historical_total: 3,
      controls_accepted: 3,
      controls_total: 3,
    });

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
