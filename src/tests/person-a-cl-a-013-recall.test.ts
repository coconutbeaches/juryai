import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRY_RUN_001_COMPATIBILITY_ALIASES,
  alignPersonAForCase,
} from '../alignment/person-a-alignment-corrected.js';
import { evaluatePersonAForCase } from '../evaluation/person-a-diff-corrected.js';
import { evaluateDryRun001TimelineContainmentProjection } from '../evaluation/person-a-timeline-containment-compatibility.js';
import { parsePersonAModelOutputFromRawResponse } from '../evaluation/person-a-span-diagnostics.js';
import { projectDryRun001ClA013CompatibilityRecovery } from '../extraction/person-a-dry-run-001-cl-a-013-compatibility-recovery.js';
import {
  assembleDryRun001ClA003CompatibilityProjection,
  assembleDryRun001ClA013CompatibilityProjection,
  assembleDryRun001CompletionStateCompatibilityProjection,
  assembleDryRun001DeterministicClaimTypeProjection,
} from '../extraction/person-a-frozen-compatibility.js';
import { assemblePersonAExtraction, extractPersonA } from '../extraction/person-a-extractor.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';

type JsonObject = Record<string, any>;

const root = process.cwd();
const options = {
  submittedAt: '2026-07-25T00:00:00Z',
  generatedAt: '2026-07-25T13:03:42.000Z',
  model: 'gpt-5.6-sol',
};
const exactQuote =
  'I probably should have documented more clearly which requests were outside the original scope.';
const exactSpan = {
  submission_id: 'sub_a_extracted',
  quote: exactQuote,
  start_char: 937,
  end_char: 1031,
};

async function json(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(resolve(root, path), 'utf8')) as JsonObject;
}

async function frozenInputs() {
  const [narrative, golden, rawResponse] = await Promise.all([
    readFile(resolve(root, 'src/fixtures/dry_run_001.person_a.txt'), 'utf8'),
    json('docs/dry-run-001/golden-projection.json'),
    json('docs/dry-run-001/raw-response.json'),
  ]);
  const modelOutput = parsePersonAModelOutputFromRawResponse(rawResponse);
  const prior = assembleDryRun001DeterministicClaimTypeProjection(modelOutput, {
    ...options,
    narrative,
  });
  const projected = assembleDryRun001ClA013CompatibilityProjection(modelOutput, {
    ...options,
    narrative,
  });
  return { narrative, golden, rawResponse, modelOutput, prior, projected };
}

function evaluationOptions(narrative: string) {
  return {
    aliases: DRY_RUN_001_COMPATIBILITY_ALIASES,
    contractVersion: 'calibrated_live_v2' as const,
    narrative,
  };
}

function evaluate(extraction: JsonObject, golden: JsonObject, narrative: string) {
  return evaluateDryRun001TimelineContainmentProjection(
    extraction,
    golden,
    evaluationOptions(narrative),
  ).report;
}

function evaluatePrior(extraction: JsonObject, golden: JsonObject, narrative: string) {
  const optionsForEvaluation = evaluationOptions(narrative);
  const alignment = alignPersonAForCase(extraction, golden, optionsForEvaluation);
  return evaluatePersonAForCase(extraction, golden, alignment, optionsForEvaluation);
}

function prettyHash(value: JsonObject): string {
  return createHash('sha256')
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest('hex');
}

function errorKey(error: JsonObject): string {
  return JSON.stringify(error);
}

function expectRecoveryToReject(prior: JsonObject, narrative: string): void {
  expect(() => projectDryRun001ClA013CompatibilityRecovery(prior, narrative)).toThrow(
    /Dry Run 001 cl_a_013 compatibility projection/iu,
  );
}

describe('Dry Run 001 cl_a_013 grounded recall', () => {
  it('reproduces the exact pre-fix finding and proves the frozen representation map', async () => {
    const { narrative, golden, prior } = await frozenInputs();
    const report = evaluate(prior, golden, narrative);
    const goldenClaim = golden.claims.find((claim: JsonObject) => claim.claim_id === 'cl_a_013');
    const relatedTerms = [
      'term_12_pricing_section',
      'term_13_newsletter_signup',
      'term_14_homepage_changes',
    ].map((termId) => prior.agreement.terms.find((term: JsonObject) => term.term_id === termId));
    const relatedIssue = prior.extraction_issues.find(
      (issue: JsonObject) => issue.issue_id === 'issue_02_added_scope_unclear',
    );

    expect(report.summary).toMatchObject({ critical: 0, major: 36, minor: 20 });
    expect(
      report.errors.filter(
        (error) =>
          error.family === 'claims' &&
          error.code === 'missing_golden_object' &&
          error.golden_id === 'cl_a_013',
      ),
    ).toEqual([
      {
        severity: 'minor',
        family: 'claims',
        code: 'missing_golden_object',
        message: 'Golden object was not extracted.',
        golden_id: 'cl_a_013',
      },
    ]);
    expect(goldenClaim).toEqual({
      claim_id: 'cl_a_013',
      party_id: 'party_a',
      claim_text: 'Alex did not clearly document which requests were outside the original scope.',
      claim_type: 'scope',
      response_status: 'unanswered',
      materiality: 'medium',
      support_level: 'none',
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      counterclaim_ids: [],
      requires_clarification: false,
      against_asserting_party_interest: true,
      source_spans: [{ ...exactSpan, submission_id: 'sub_a_001' }],
    });
    expect(narrative.slice(exactSpan.start_char, exactSpan.end_char)).toBe(exactQuote);
    expect(
      prior.claims.some((claim: JsonObject) =>
        claim.source_spans?.some(
          (span: JsonObject) =>
            span.start_char === exactSpan.start_char && span.end_char === exactSpan.end_char,
        ),
      ),
    ).toBe(false);
    expect(
      prior.claims.find((claim: JsonObject) => claim.claim_id === 'claim_05_added_requests')
        ?.claim_text,
    ).toBe(
      'Alex asserts that Maya later requested a pricing comparison section, a newsletter signup, and several homepage design changes, and that he accepted most of those requests through WhatsApp.',
    );
    for (const term of relatedTerms) {
      expect(term.person_a_interpretation).toMatch(
        /acknowledging that he did not clearly document/iu,
      );
      expect(term.source_spans).toContainEqual(exactSpan);
    }
    expect(relatedIssue.source_spans).toEqual([
      {
        submission_id: 'sub_a_extracted',
        quote:
          'During the project Maya also asked for a pricing comparison section, a newsletter signup, and several changes to the homepage design. I accepted most of those requests through WhatsApp because I wanted to keep the client happy. I probably should have documented more clearly which requests were outside the original scope.',
        start_char: 709,
        end_char: 1031,
      },
    ]);
  });

  it('appends exactly one qualified source-verbatim claim with an exact audit', async () => {
    const { narrative, prior, projected } = await frozenInputs();
    const recovered = projected.extraction.claims.find(
      (claim: JsonObject) => claim.claim_id === 'claim_15_scope_documentation',
    );
    const reverted = structuredClone(projected.extraction);
    reverted.claims = reverted.claims.filter(
      (claim: JsonObject) => claim.claim_id !== 'claim_15_scope_documentation',
    );

    expect(recovered).toEqual({
      claim_id: 'claim_15_scope_documentation',
      party_id: 'party_a',
      claim_text: exactQuote,
      claim_type: 'scope',
      response_status: 'unanswered',
      materiality: 'medium',
      support_level: 'none',
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      counterclaim_ids: [],
      requires_clarification: false,
      against_asserting_party_interest: true,
      source_spans: [exactSpan],
    });
    expect(reverted).toEqual(prior);
    expect(projected.audit).toEqual({
      operation: 'append',
      target_family: 'claims',
      created_claim_id: 'claim_15_scope_documentation',
      narrative_sha256: '2cdb00b4b2b28c1813a979be5cf22f1ac51a30282abea9e144df491549c4fcc7',
      prior_projection_sha256: 'f46a43391795d5f8e0a8360992ce74135547f887cc5cba512f6e81d11a1f311d',
      prior_serialization_sha256:
        'a50cfa97b53d2511869839f73bf1f2daf26747fa9d0567efa79c6e09a3182797',
      prior_claims_sha256: '89d594d55df3c6f4719c57f4f55af8478375cc91ff306b8ae17e790811daa0d0',
      related_record_sha256: {
        term_12_pricing_section: '7f7689fb72897171a538f657f268aabbe7e9cae796eddbc927e1991f0e00607f',
        term_13_newsletter_signup:
          'bb04990438bc33af37edde239849b112e77162948b5024e56c89a02acf6c29a6',
        term_14_homepage_changes:
          'a4e033c40f0fb9666690edee69e490d1974714b098da0f1fd60d36991787c2c2',
        issue_02_added_scope_unclear:
          'e6f4774cb7e9192957d060a7bbffd3ea0d3f5940b7ac8d5a58c90446858e0617',
      },
      source_span: exactSpan,
      source_record_ids: [
        'term_12_pricing_section',
        'term_13_newsletter_signup',
        'term_14_homepage_changes',
        'issue_02_added_scope_unclear',
      ],
      before: null,
      after: recovered,
      rationale:
        'Projects the frozen provider response’s exact, qualified documentation admission into the claims family without changing its wording or epistemic force.',
    });
    expect(validatePersonAExtraction(projected.extraction, narrative).valid).toBe(true);
  });

  it('removes only cl_a_013 recall and changes no other finding or severity', async () => {
    const { narrative, golden, prior, projected } = await frozenInputs();
    const before = evaluate(prior, golden, narrative);
    const after = evaluate(projected.extraction, golden, narrative);
    const expected = before.errors.filter(
      (error) =>
        !(
          error.severity === 'minor' &&
          error.family === 'claims' &&
          error.code === 'missing_golden_object' &&
          error.golden_id === 'cl_a_013'
        ),
    );

    expect(after.summary).toMatchObject({ critical: 0, major: 36, minor: 19 });
    expect(after.errors.map(errorKey).sort()).toEqual(expected.map(errorKey).sort());
    expect(after.errors.filter((error) => error.golden_id === 'cl_a_013')).toEqual([]);
  });

  it('preserves every historical projection hash and count', async () => {
    const { narrative, golden, modelOutput, prior } = await frozenInputs();
    const pr14 = assembleDryRun001ClA003CompatibilityProjection(modelOutput, {
      ...options,
      narrative,
    });
    const pr15 = assembleDryRun001CompletionStateCompatibilityProjection(modelOutput, {
      ...options,
      narrative,
    });

    expect(prettyHash(pr14)).toBe(
      'd607a8555c2bda66e8b12f80ac47f8bc880b82d90a5f23ca5d9cfd58a0af4c41',
    );
    expect(prettyHash(pr15)).toBe(
      '04b927a7e54be2afccf36f32494afc563c1c7d2d6730611ee74d2c9a961775d3',
    );
    expect(prettyHash(prior)).toBe(
      'b24bb43acb4ce29ac626c4b3d75362627500a4ca8449bea7e85c93e906ffbd0b',
    );
    expect(evaluatePrior(pr14, golden, narrative).summary).toMatchObject({
      critical: 0,
      major: 44,
      minor: 20,
    });
    expect(evaluatePrior(pr15, golden, narrative).summary).toMatchObject({
      critical: 0,
      major: 41,
      minor: 20,
    });
    expect(evaluatePrior(prior, golden, narrative).summary).toMatchObject({
      critical: 0,
      major: 38,
      minor: 20,
    });
    expect(evaluate(prior, golden, narrative).summary).toMatchObject({
      critical: 0,
      major: 36,
      minor: 20,
    });
  });

  it('is deterministic, preserves input, and creates no duplicate claim', async () => {
    const { narrative, prior } = await frozenInputs();
    const before = structuredClone(prior);
    const first = projectDryRun001ClA013CompatibilityRecovery(prior, narrative);
    const second = projectDryRun001ClA013CompatibilityRecovery(prior, narrative);

    expect(first).toEqual(second);
    expect(prettyHash(first)).toBe(prettyHash(second));
    expect(prior).toEqual(before);
    expect(
      first.extraction.claims.filter(
        (claim: JsonObject) => claim.claim_id === 'claim_15_scope_documentation',
      ),
    ).toHaveLength(1);
  });

  it('returns detached audit and extraction objects that cannot corrupt later projections', async () => {
    const { narrative, prior } = await frozenInputs();
    const first = projectDryRun001ClA013CompatibilityRecovery(prior, narrative);
    first.extraction.claims.at(-1).claim_text = 'mutated caller output';
    (first.audit.source_span as JsonObject).quote = 'mutated caller audit';
    (first.audit.related_record_sha256 as JsonObject).term_12_pricing_section =
      'mutated caller fingerprint';

    const second = projectDryRun001ClA013CompatibilityRecovery(prior, narrative);
    expect(second.extraction.claims.at(-1).claim_text).toBe(exactQuote);
    expect(second.audit.source_span).toEqual(exactSpan);
    expect(second.audit.related_record_sha256.term_12_pricing_section).toBe(
      '7f7689fb72897171a538f657f268aabbe7e9cae796eddbc927e1991f0e00607f',
    );
  });

  it.each([
    [
      'negated',
      'I did not fail to document clearly which requests were outside the original scope.',
    ],
    [
      'conditional',
      'If I had accepted those requests, I should have documented which were outside scope.',
    ],
    ['incomplete', 'I probably should have documented more clearly.'],
    ['paraphrased', 'I may have needed better paperwork about the additional requests.'],
  ])('fails closed when the source statement is %s', async (_label, replacement) => {
    const { narrative, prior } = await frozenInputs();
    expectRecoveryToReject(prior, narrative.replace(exactQuote, replacement));
  });

  it('fails closed when related scope records omit or alter the admission', async () => {
    const { narrative, prior } = await frozenInputs();
    const variants: JsonObject[] = [];

    const missingAdmission = structuredClone(prior);
    missingAdmission.agreement.terms
      .find((term: JsonObject) => term.term_id === 'term_12_pricing_section')
      .source_spans.pop();
    variants.push(missingAdmission);

    const changedInterpretation = structuredClone(prior);
    changedInterpretation.agreement.terms.find(
      (term: JsonObject) => term.term_id === 'term_13_newsletter_signup',
    ).person_a_interpretation = 'The later request was added scope.';
    variants.push(changedInterpretation);

    const changedIssue = structuredClone(prior);
    changedIssue.extraction_issues.find(
      (issue: JsonObject) => issue.issue_id === 'issue_02_added_scope_unclear',
    ).severity = 'minor';
    variants.push(changedIssue);

    for (const variant of variants) expectRecoveryToReject(variant, narrative);
  });

  it('fails closed for malformed, sparse, or non-intrinsic claim arrays', async () => {
    const { narrative, prior } = await frozenInputs();
    const malformed = structuredClone(prior);
    malformed.claims = {};
    expectRecoveryToReject(malformed, narrative);

    const sparse = structuredClone(prior);
    delete sparse.claims[0];
    expectRecoveryToReject(sparse, narrative);

    const nonIntrinsic = structuredClone(prior);
    Object.setPrototypeOf(nonIntrinsic.claims, {});
    expectRecoveryToReject(nonIntrinsic, narrative);

    const extraProperty = structuredClone(prior);
    Object.defineProperty(extraProperty.claims, 'unexpected', {
      value: true,
      enumerable: true,
    });
    expectRecoveryToReject(extraProperty, narrative);
  });

  it('fails closed when an equivalent or conflicting claim already exists', async () => {
    const { narrative, prior } = await frozenInputs();
    const duplicate = structuredClone(prior);
    duplicate.claims.push({
      claim_id: 'claim_existing_scope_documentation',
      party_id: 'party_a',
      claim_text: exactQuote,
      claim_type: 'scope',
      response_status: 'unanswered',
      materiality: 'medium',
      support_level: 'none',
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      counterclaim_ids: [],
      requires_clarification: false,
      against_asserting_party_interest: true,
      source_spans: [exactSpan],
    });
    expectRecoveryToReject(duplicate, narrative);

    const collidingId = structuredClone(prior);
    collidingId.claims[0].claim_id = 'claim_15_scope_documentation';
    expectRecoveryToReject(collidingId, narrative);
  });

  it('rejects adversarial prototypes, accessors, cycles, symbols, and non-JSON values', async () => {
    const { narrative, prior } = await frozenInputs();
    const variants: JsonObject[] = [];

    const objectPrototype = structuredClone(prior);
    Object.setPrototypeOf(objectPrototype.claims[0], { inherited: true });
    variants.push(objectPrototype);

    const accessor = structuredClone(prior);
    Object.defineProperty(accessor.claims[0], 'claim_text', {
      enumerable: true,
      get: () => exactQuote,
    });
    variants.push(accessor);

    const cyclic = structuredClone(prior);
    cyclic.claims[0].cycle = cyclic.claims[0];
    variants.push(cyclic);

    const symbolKey = structuredClone(prior);
    symbolKey.claims[0][Symbol('hidden')] = true;
    variants.push(symbolKey);

    const nonFinite = structuredClone(prior);
    nonFinite.claims[0].materiality = Number.NaN;
    variants.push(nonFinite);

    const undefinedValue = structuredClone(prior);
    undefinedValue.claims[0].unexpected = undefined;
    variants.push(undefinedValue);

    for (const variant of variants) expectRecoveryToReject(variant, narrative);

    const proxied = structuredClone(prior);
    proxied.claims = new Proxy(proxied.claims, {});
    expect(() => projectDryRun001ClA013CompatibilityRecovery(proxied, narrative)).toThrow();
  });

  it('rejects stateful proxies before any reflective trap can mutate the projection', async () => {
    const { narrative, prior } = await frozenInputs();
    const attacked = structuredClone(prior);
    const termIndex = attacked.agreement.terms.findIndex(
      (term: JsonObject) => term.term_id === 'term_12_pricing_section',
    );
    const originalTerm = attacked.agreement.terms[termIndex];
    let ownKeysCalls = 0;
    attacked.agreement.terms[termIndex] = new Proxy(originalTerm, {
      ownKeys(target) {
        ownKeysCalls += 1;
        if (ownKeysCalls === 2) {
          attacked.claims[0].materiality = 'low';
          attacked.agreement.terms[termIndex] = originalTerm;
        }
        return Reflect.ownKeys(target);
      },
    });

    expectRecoveryToReject(attacked, narrative);
    expect(ownKeysCalls).toBe(0);
    expect(attacked.claims[0].materiality).toBe(prior.claims[0].materiality);
  });

  it('rejects key-reordered records that would serialize to different output bytes', async () => {
    const { narrative, prior } = await frozenInputs();
    const reordered = structuredClone(prior);
    reordered.claims[0] = Object.fromEntries(Object.entries(reordered.claims[0]).reverse());

    expect(reordered.claims[0]).toEqual(prior.claims[0]);
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(prior));
    expectRecoveryToReject(reordered, narrative);
  });

  it('leaves ordinary assembly and fresh extraction isolated from the recovery', async () => {
    const { narrative, modelOutput } = await frozenInputs();
    const before = structuredClone(modelOutput);
    const assembled = assemblePersonAExtraction(modelOutput, { ...options, narrative });
    const fresh = await extractPersonA({
      ...options,
      narrative,
      client: {
        generate: async () => ({
          output: structuredClone(modelOutput),
          rawResponse: { id: 'offline-test-response' },
        }),
      },
    });

    for (const extraction of [assembled, fresh.extraction]) {
      expect(
        extraction.claims.some(
          (claim: JsonObject) => claim.claim_id === 'claim_15_scope_documentation',
        ),
      ).toBe(false);
    }
    expect(modelOutput).toEqual(before);
  });

  it('keeps the compatibility module independent of golden, alignment, and evaluator code', async () => {
    const source = await readFile(
      resolve(root, 'src/extraction/person-a-dry-run-001-cl-a-013-compatibility-recovery.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/from ['"].*(?:golden|alignment|evaluation)/iu);
    expect(source).not.toMatch(/semanticSimilarity|threshold|fuzzy/iu);
  });
});
