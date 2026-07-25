import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  alignPersonAForCase,
  type PersonAAlignment,
} from '../alignment/person-a-alignment-corrected.js';
import {
  evaluatePersonAForCase,
  type PersonAEvaluationReport,
} from '../evaluation/person-a-diff-corrected.js';
import {
  personAExtractionSchema,
  buildOpenAIResponseSchema,
} from '../extraction/person-a-schema.js';
import { PERSON_A_EXTRACTION_INSTRUCTIONS } from '../extraction/person-a-prompt.js';
import { validatePersonAExtraction } from '../extraction/validate-person-a-corrected.js';
import { validPersonAExtraction, clone } from './person-a-test-helpers.js';

type JsonObject = Record<string, any>;

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures');

/**
 * Synthetic, generic Person A record used to prove the v0.1.4 judgment-field and
 * epistemic contract against the real corrected evaluator. It contains no case-specific
 * identities or Dry Run wording. Correctness is anchored by self-comparison: an
 * unmutated clone evaluated against this golden must produce zero errors, so every
 * asserted error below is caused solely by the applied mutation.
 */
function syntheticGolden(): JsonObject {
  const span = (quote: string): JsonObject[] => [
    { submission_id: 'sub_a_extracted', quote, start_char: 0, end_char: quote.length },
  ];
  return {
    agreement: {
      terms: [
        {
          term_id: 'term_payment',
          term_type: 'payment_trigger',
          wording: 'the balance was due when the project was completed',
          wording_status: 'not_inspected',
          interpretation_status: 'unclear',
          // Partisan interpretation: Person A's own asserted significance of the term.
          person_a_interpretation:
            'Delivering the staging build substantially completed the project and made the final payment due.',
          person_b_interpretation: null,
          source_evidence_ids: [],
          materiality: 'high',
          source_spans: span('the balance was due when the project was completed'),
        },
        {
          term_id: 'term_deposit',
          term_type: 'deposit',
          wording: 'a deposit of 1200 was paid up front',
          wording_status: 'not_inspected',
          interpretation_status: 'not_applicable',
          // Bare amount with no accompanying meaning: the narrative supplies no basis
          // for any interpretation, so null is correct (see rule 24).
          person_a_interpretation: null,
          person_b_interpretation: null,
          source_evidence_ids: [],
          materiality: 'low',
          source_spans: span('a deposit of 1200 was paid up front'),
        },
        {
          term_id: 'term_credentials',
          term_type: 'credentials',
          wording: 'the account credentials transfer once the outstanding balance is paid',
          wording_status: 'not_inspected',
          interpretation_status: 'unclear',
          person_a_interpretation:
            'Handover of the account credentials is conditional on receiving the outstanding balance.',
          person_b_interpretation: null,
          source_evidence_ids: [],
          materiality: 'high',
          source_spans: span(
            'the account credentials transfer once the outstanding balance is paid',
          ),
        },
      ],
    },
    deliverable_assessments: [
      {
        deliverable_id: 'del_landing',
        name: 'primary landing page',
        scope_status: 'included',
        completion_status_person_a: 'substantially_complete',
        completion_status_person_b: 'unknown',
        use_status: 'unknown',
        alleged_defects: [],
        repair_attempts: [],
        source_claim_ids: [],
        source_evidence_ids: [],
        materiality: 'high',
      },
      {
        deliverable_id: 'del_pricing',
        name: 'extra pricing comparison section',
        scope_status: 'disputed',
        completion_status_person_a: 'partially_complete',
        completion_status_person_b: 'unknown',
        use_status: 'unknown',
        alleged_defects: [],
        repair_attempts: [],
        source_claim_ids: [],
        source_evidence_ids: [],
        materiality: 'medium',
      },
    ],
    timeline: [],
    claims: [
      {
        // Material, relied-upon assertion that is ALSO captured as an agreement term.
        claim_id: 'claim_credentials',
        party_id: 'party_a',
        claim_type: 'credentials',
        claim_text:
          'the account credentials will be transferred once the outstanding balance is paid',
        response_status: 'unanswered',
        against_asserting_party_interest: false,
        materiality: 'high',
        support_level: 'not_assessed',
        // Evidence grounding travels through claim linkage, not evidence source_spans:
        // the evidence definition has no source_spans property.
        supporting_evidence_ids: ['ev_messages'],
        source_spans: span(
          'the account credentials will be transferred once the outstanding balance is paid',
        ),
      },
      {
        // A belief represented as a supported claim (not as an evidence artifact).
        claim_id: 'claim_brief_publish',
        party_id: 'party_a',
        claim_type: 'other',
        claim_text: 'part of the site may have been briefly live for a short period',
        response_status: 'unanswered',
        against_asserting_party_interest: false,
        materiality: 'low',
        support_level: 'none',
        supporting_evidence_ids: [],
        source_spans: span('part of the site may have been briefly live for a short period'),
      },
    ],
    evidence: [
      {
        // The evidence definition has no source_spans property (additionalProperties: false),
        // so an evidence object is grounded by its described artifact and claim linkage.
        evidence_id: 'ev_messages',
        submitted_by_party_id: 'party_a',
        evidence_type: 'message_export',
        title: 'exported chat messages about the completion deadline',
        description_from_submitter: 'exported chat messages discussing the completion deadline',
        availability_status: 'described_only',
        authenticity_status: 'not_verified',
        completeness_status: 'unknown',
        visibility: 'party_private',
        relevance: 'medium',
        extracts: [],
      },
    ],
    claim_evidence_links: [],
    damages_claims: [],
    desired_outcomes: { party_id: 'party_a', outcomes: [] },
    extraction_issues: [],
    clarification_questions: [],
  };
}

function evaluate(candidate: JsonObject, golden: JsonObject): PersonAEvaluationReport {
  const alignment: PersonAAlignment = alignPersonAForCase(candidate, golden, { aliases: {} });
  return evaluatePersonAForCase(candidate, golden, alignment, { aliases: {} });
}

function errors(report: PersonAEvaluationReport, code: string, family?: string) {
  return report.errors.filter((e) => e.code === code && (family ? e.family === family : true));
}

describe('Person A judgment-field and epistemic contract (v0.1.4)', () => {
  it('a correct extraction of the synthetic case has zero errors (self-comparison anchor)', () => {
    const golden = syntheticGolden();
    const report = evaluate(clone(golden), golden);
    expect(report.summary.critical).toBe(0);
    expect(report.summary.major).toBe(0);
    expect(report.summary.minor).toBe(0);
  });

  describe('person_a_interpretation', () => {
    it('preserves a genuine partisan interpretation without error', () => {
      const golden = syntheticGolden();
      const report = evaluate(clone(golden), golden);
      expect(errors(report, 'party_interpretation')).toHaveLength(0);
    });

    it('rejects a neutral paraphrase that replaces a partisan interpretation', () => {
      const golden = syntheticGolden();
      const candidate = clone(golden);
      candidate.agreement.terms[0].person_a_interpretation =
        'The remaining balance became payable upon completion of the project.';
      const report = evaluate(candidate, golden);
      const flagged = errors(report, 'party_interpretation', 'agreement_terms');
      expect(flagged.map((e) => e.golden_id)).toContain('term_payment');
    });

    it('rejects filling person_a_interpretation where the narrative supplies no basis (golden null)', () => {
      const golden = syntheticGolden();
      const candidate = clone(golden);
      candidate.agreement.terms[1].person_a_interpretation = 'A deposit of 1200 was paid up front.';
      const report = evaluate(candidate, golden);
      const flagged = errors(report, 'party_interpretation', 'agreement_terms');
      expect(flagged.map((e) => e.golden_id)).toContain('term_deposit');
    });

    it('rejects nulling a genuine partisan interpretation', () => {
      const golden = syntheticGolden();
      const candidate = clone(golden);
      candidate.agreement.terms[0].person_a_interpretation = null;
      const report = evaluate(candidate, golden);
      const flagged = errors(report, 'party_interpretation', 'agreement_terms');
      expect(flagged.map((e) => e.golden_id)).toContain('term_payment');
    });
  });

  /**
   * Rule 24 must not contradict the locked PR #10 acceptance contract. Dry Runs 002 and 003
   * expect grounded restatements for their factual scope recitals, while Dry Run 001 expects
   * null only where the narrative supplies no basis. These tests read the real locked goldens
   * read-only and exercise the real unchanged evaluator.
   */
  describe('rule 24 compatibility with the locked acceptance contract', () => {
    const lockedGolden = (caseId: string): JsonObject =>
      JSON.parse(
        readFileSync(resolve(fixturesDir, `${caseId}.person_a.golden.extraction.json`), 'utf8'),
      );

    it.each(['dry_run_002', 'dry_run_003'])(
      '%s: a grounded restatement is not rejected or forced to null',
      (caseId) => {
        const golden = lockedGolden(caseId);
        const terms = golden.agreement.terms;
        // The locked contract expects a populated, narrative-grounded restatement here.
        expect(terms.every((t: JsonObject) => typeof t.person_a_interpretation === 'string')).toBe(
          true,
        );
        const report = evaluate(clone(golden), golden);
        expect(errors(report, 'party_interpretation', 'agreement_terms')).toHaveLength(0);
      },
    );

    it.each(['dry_run_002', 'dry_run_003'])(
      '%s: nulling the grounded restatement would be a major party_interpretation failure',
      (caseId) => {
        const golden = lockedGolden(caseId);
        const candidate = clone(golden);
        // This is exactly what a blanket "factual recital => null" rule would produce.
        candidate.agreement.terms.forEach((t: JsonObject) => {
          t.person_a_interpretation = null;
        });
        const report = evaluate(candidate, golden);
        const flagged = errors(report, 'party_interpretation', 'agreement_terms');
        expect(flagged.length).toBeGreaterThan(0);
        expect(flagged.every((e) => e.severity === 'major')).toBe(true);
      },
    );

    it('rule 24 no longer mandates null for factual recitals', () => {
      // The removed instruction is what made the prompt disagree with the gate.
      expect(PERSON_A_EXTRACTION_INSTRUCTIONS).not.toMatch(
        /straightforward factual recital[^.]*null|null[^.]*straightforward factual recital/i,
      );
      // A grounded restatement must remain explicitly permitted.
      expect(PERSON_A_EXTRACTION_INSTRUCTIONS).toMatch(/restatement grounded in the narrative/i);
      // null is reserved for the no-basis case only.
      expect(PERSON_A_EXTRACTION_INSTRUCTIONS).toMatch(
        /use null only when the narrative supplies no basis/i,
      );
    });

    it('following rule 24 on the locked goldens constructs no party_interpretation failure', () => {
      // End-to-end guard for all three locked cases: the values the corrected rule 24
      // endorses are exactly the values the unchanged evaluator accepts.
      for (const caseId of ['dry_run_001', 'dry_run_002', 'dry_run_003']) {
        const golden = lockedGolden(caseId);
        const report = evaluate(clone(golden), golden);
        expect(errors(report, 'party_interpretation', 'agreement_terms')).toHaveLength(0);
      }
    });

    it('rejects an invented interpretation the narrative does not support', () => {
      const golden = lockedGolden('dry_run_002');
      const candidate = clone(golden);
      candidate.agreement.terms[0].person_a_interpretation =
        'The parties additionally agreed to an unlimited warranty and a full refund on demand.';
      const report = evaluate(candidate, golden);
      expect(errors(report, 'party_interpretation', 'agreement_terms').length).toBeGreaterThan(0);
    });

    it('keeps a disputed interpretation attributed to Person A rather than an agreed fact', () => {
      const narrative = readFileSync(resolve(fixturesDir, 'dry_run_001.person_a.txt'), 'utf8');
      const record = validPersonAExtraction();
      const term = record.agreement.terms[0];
      // Person A's side is asserted; Person B's is never inferred.
      expect(['unclear', 'not_applicable']).toContain(term.interpretation_status);
      expect(term.wording_status).toBe('not_inspected');
      expect(term.person_b_interpretation).toBeNull();
      expect(validatePersonAExtraction(record, narrative).valid).toBe(true);

      // Promoting Person A's interpretation to a bilaterally agreed fact fails closed.
      const promoted = clone(record);
      promoted.agreement.terms[0].interpretation_status = 'agreed';
      expect(validatePersonAExtraction(promoted, narrative).valid).toBe(false);
    });
  });

  describe('completion and scope precision', () => {
    it('accepts the precise enums Person A stated', () => {
      const golden = syntheticGolden();
      const report = evaluate(clone(golden), golden);
      expect(errors(report, 'completion_status')).toHaveLength(0);
      expect(errors(report, 'scope_status')).toHaveLength(0);
    });

    it('rejects upgrading substantially_complete to complete', () => {
      const golden = syntheticGolden();
      const candidate = clone(golden);
      candidate.deliverable_assessments[0].completion_status_person_a = 'complete';
      const report = evaluate(candidate, golden);
      const flagged = errors(report, 'completion_status', 'deliverables');
      expect(flagged.map((e) => e.golden_id)).toContain('del_landing');
    });

    it('rejects downgrading partially_complete to unknown', () => {
      const golden = syntheticGolden();
      const candidate = clone(golden);
      candidate.deliverable_assessments[1].completion_status_person_a = 'unknown';
      const report = evaluate(candidate, golden);
      const flagged = errors(report, 'completion_status', 'deliverables');
      expect(flagged.map((e) => e.golden_id)).toContain('del_pricing');
    });

    it('rejects collapsing a disputed scope into an unsupported objective status', () => {
      const golden = syntheticGolden();
      const candidate = clone(golden);
      candidate.deliverable_assessments[1].scope_status = 'included';
      const report = evaluate(candidate, golden);
      const flagged = errors(report, 'scope_status', 'deliverables');
      expect(flagged.map((e) => e.golden_id)).toContain('del_pricing');
    });
  });

  describe('material term-to-claim duplication', () => {
    it('detects omission of a material relied-upon claim already captured as an agreement term', () => {
      const golden = syntheticGolden();
      const candidate = clone(golden);
      // The credentials term is still present; the relied-upon party_a claim is dropped.
      candidate.claims = candidate.claims.filter(
        (c: JsonObject) => c.claim_id !== 'claim_credentials',
      );
      const report = evaluate(candidate, golden);
      const missing = errors(report, 'missing_golden_object', 'claims');
      const flagged = missing.find((e) => e.golden_id === 'claim_credentials');
      expect(flagged).toBeDefined();
      // High-materiality omission is a hard failure.
      expect(flagged?.severity).toBe('critical');
    });

    it('does not force a neutral factual term (deposit) to be duplicated as a claim', () => {
      const golden = syntheticGolden();
      // The deposit term intentionally has no corresponding claim in the golden.
      const depositTerm = golden.agreement.terms.find(
        (t: JsonObject) => t.term_id === 'term_deposit',
      );
      expect(depositTerm.person_a_interpretation).toBeNull();
      const hasDepositClaim = golden.claims.some((c: JsonObject) => c.claim_type === 'deposit');
      expect(hasDepositClaim).toBe(false);
      // The correct extraction still evaluates clean: no forced duplication.
      const report = evaluate(clone(golden), golden);
      expect(errors(report, 'missing_golden_object', 'claims')).toHaveLength(0);
    });
  });

  describe('belief is not evidence', () => {
    it('rejects an unprovable belief materialized as an ungrounded evidence object', () => {
      const golden = syntheticGolden();
      const candidate = clone(golden);
      // No described artifact and no supporting claim linkage: the only available
      // grounding signals the evidence schema actually supports.
      candidate.evidence.push({
        evidence_id: 'ev_belief',
        submitted_by_party_id: 'party_a',
        evidence_type: 'campaign_record',
        title: 'belief that part of the site was briefly published',
        description_from_submitter:
          'Person A believes part of the site was briefly live but cannot prove it',
        availability_status: 'unavailable',
        authenticity_status: 'unknown',
        completeness_status: 'unavailable',
        visibility: 'party_private',
        relevance: 'unknown',
        extracts: [],
      });
      const report = evaluate(candidate, golden);
      const fabricated = errors(report, 'unsupported_extra_object', 'evidence');
      expect(fabricated.map((e) => e.extracted_id)).toContain('ev_belief');
      expect(fabricated[0]?.severity).toBe('critical');
    });

    it('accepts an explicitly described artifact grounded in the narrative', () => {
      const golden = syntheticGolden();
      const report = evaluate(clone(golden), golden);
      expect(errors(report, 'unsupported_extra_object', 'evidence')).toHaveLength(0);
      expect(errors(report, 'fabricated_inspection', 'evidence')).toHaveLength(0);
    });

    it('lets a belief live as a supported claim without spawning an evidence object', () => {
      const golden = syntheticGolden();
      const candidate = clone(golden);
      // The belief is represented as a claim (present in both) and NOT as evidence.
      const beliefClaim = candidate.claims.find(
        (c: JsonObject) => c.claim_id === 'claim_brief_publish',
      );
      expect(beliefClaim).toBeDefined();
      const beliefEvidence = candidate.evidence.some((e: JsonObject) =>
        /brief|belief|published/i.test(String(e.title)),
      );
      expect(beliefEvidence).toBe(false);
      const report = evaluate(candidate, golden);
      expect(errors(report, 'unsupported_extra_object', 'evidence')).toHaveLength(0);
    });

    it('keeps rejecting fabricated evidence contents (inspected availability on narrative-only evidence)', () => {
      const golden = syntheticGolden();
      const candidate = clone(golden);
      candidate.evidence[0].availability_status = 'inspected';
      const report = evaluate(candidate, golden);
      const flagged = errors(report, 'fabricated_inspection', 'evidence');
      expect(flagged.map((e) => e.golden_id)).toContain('ev_messages');
      expect(flagged[0]?.severity).toBe('critical');
    });
  });

  describe('generic safeguards', () => {
    it('keeps production prompt and provider schema free of case-specific identities', () => {
      const caseIdentity = /\bmaya\b|\balex\b|dry[\s_-]?run/i;
      expect(PERSON_A_EXTRACTION_INSTRUCTIONS).not.toMatch(caseIdentity);
      expect(JSON.stringify(buildOpenAIResponseSchema())).not.toMatch(caseIdentity);
    });

    it('keeps Dry Run 002 and 003 golden shapes schema- and invariant-valid', () => {
      for (const caseId of ['dry_run_002', 'dry_run_003']) {
        const narrative = readFileSync(resolve(fixturesDir, `${caseId}.person_a.txt`), 'utf8');
        const golden = JSON.parse(
          readFileSync(resolve(fixturesDir, `${caseId}.person_a.golden.extraction.json`), 'utf8'),
        );
        const result = validatePersonAExtraction(golden, narrative);
        expect(result.valid).toBe(true);
      }
    });

    it('accepts frozen prior prompt versions and the new v0.1.4 version', () => {
      const promptVersionEnum = (personAExtractionSchema as JsonObject).properties.metadata
        .properties.prompt_version.enum as string[];
      expect(promptVersionEnum).toEqual(
        expect.arrayContaining([
          'person-a-v0.1.1',
          'person-a-v0.1.2',
          'person-a-v0.1.3',
          'person-a-v0.1.4',
        ]),
      );

      const narrative = readFileSync(resolve(fixturesDir, 'dry_run_001.person_a.txt'), 'utf8');
      const v3 = validPersonAExtraction();
      v3.metadata.prompt_version = 'person-a-v0.1.3';
      expect(validatePersonAExtraction(v3, narrative).valid).toBe(true);

      const v4 = validPersonAExtraction();
      v4.metadata.prompt_version = 'person-a-v0.1.4';
      expect(validatePersonAExtraction(v4, narrative).valid).toBe(true);
    });

    it('keeps provider-only descriptions out of the locked acceptance schema path', () => {
      // The acceptance evaluator validates against personAExtractionSchema, which must NOT
      // carry the provider-facing judgment-field descriptions added in applyPersonAModelConstraints.
      const acceptanceInterp = (personAExtractionSchema as JsonObject).$defs.agreementTerm
        .properties.person_a_interpretation;
      expect(acceptanceInterp.description).toBeUndefined();

      const providerInterp = (buildOpenAIResponseSchema() as JsonObject).$defs.agreementTerm
        .properties.person_a_interpretation;
      expect(providerInterp.description).toMatch(/asserted significance/i);
    });
  });
});
