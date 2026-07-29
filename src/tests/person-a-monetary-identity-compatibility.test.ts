import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { alignPersonAForCase as alignPriorProjection } from '../alignment/person-a-alignment.js';
import {
  alignPersonAForCase,
  type PersonAAlignmentOptions,
} from '../alignment/person-a-alignment-corrected.js';
import {
  proveDryRun002DamageIdentity,
  structuredMonetaryRecordFingerprint,
} from '../alignment/person-a-monetary-identity-compatibility.js';
import { evaluatePersonAForCase } from '../evaluation/person-a-diff-corrected.js';

type JsonObject = Record<string, any>;

const narrative = readFileSync(
  resolve(process.cwd(), 'src/fixtures/dry_run_002.person_a.txt'),
  'utf8',
);
const sourceQuote =
  'I am asking Priya to pay the remaining $900 after I deliver the last two chairs; I am not asking to refund her.';
const sourceSpan = {
  end_char: 625,
  quote: sourceQuote,
  start_char: 514,
};
const options: PersonAAlignmentOptions = {
  aliases: { client: 'priya', restorer: 'jordan' },
  contractVersion: 'calibrated_live_v2',
  narrative,
};

function extractedSourceClaim(): JsonObject {
  return {
    against_asserting_party_interest: false,
    claim_id: 'claim_balance_1',
    claim_text: 'Jordan seeks payment of the remaining $900 after delivering the last two chairs.',
    claim_type: 'payment',
    contradicting_evidence_ids: [],
    counterclaim_ids: [],
    materiality: 'high',
    party_id: 'party_a',
    requires_clarification: true,
    response_status: 'unanswered',
    source_spans: [{ ...sourceSpan, submission_id: 'sub_a_extracted' }],
    support_level: 'none',
    supporting_evidence_ids: [],
  };
}

function goldenSourceClaim(): JsonObject {
  return {
    claim_id: 'cl_002_remedy',
    party_id: 'party_a',
    claim_text: sourceQuote,
    claim_type: 'payment',
    response_status: 'unanswered',
    materiality: 'high',
    support_level: 'not_assessed',
    supporting_evidence_ids: ['ev_dry_run_002'],
    contradicting_evidence_ids: [],
    counterclaim_ids: [],
    requires_clarification: true,
    against_asserting_party_interest: false,
    source_spans: [{ ...sourceSpan, submission_id: 'sub_dry_run_002' }],
  };
}

function extractedDamage(): JsonObject {
  return {
    amount_max: 900,
    amount_min: 900,
    calculation_basis:
      '$1,800 total price minus the asserted $900 upfront payment equals a $900 remaining balance.',
    calculation_status: 'partially_documented',
    causal_theory:
      'Jordan asserts that $900 remains payable under the agreement after Jordan delivers the last two chairs.',
    currency: 'USD',
    damages_claim_id: 'damages_unpaid_balance_1',
    loss_type: 'unpaid_balance',
    party_id: 'party_a',
    requires_clarification: true,
    source_claim_ids: ['claim_payment_term_1', 'claim_balance_1'],
    source_evidence_ids: [],
    support_level: 'none',
  };
}

function goldenDamage(): JsonObject {
  return {
    damages_claim_id: 'dam_dry_run_002',
    party_id: 'party_a',
    loss_type: 'unpaid_balance',
    amount_min: 900,
    amount_max: 900,
    currency: 'USD',
    causal_theory:
      'The project was completed or substantially completed, triggering the remaining balance.',
    calculation_basis: 'Person A requests 900 USD.',
    calculation_status: 'partially_documented',
    support_level: 'not_assessed',
    source_claim_ids: ['cl_002_remedy'],
    source_evidence_ids: ['ev_dry_run_002'],
    requires_clarification: true,
  };
}

function extractedOutcome(): JsonObject {
  return {
    outcome_id: 'outcome_payment_1',
    priority: 1,
    outcome_type: 'mixed',
    transfers: [
      {
        from_party_id: 'party_b',
        to_party_id: 'party_a',
        amount: 900,
        currency: 'USD',
      },
    ],
    required_actions: [
      'Jordan delivers the last two chairs.',
      'Priya pays Jordan the remaining $900 after delivery.',
      'No refund is made by Jordan.',
    ],
    rationale:
      'Jordan seeks the asserted remaining contract balance after delivering the last two chairs and expressly states that no refund is sought.',
  };
}

function goldenOutcome(): JsonObject {
  return {
    outcome_id: 'out_dry_run_002',
    priority: 1,
    outcome_type: 'mixed',
    transfers: [
      {
        from_party_id: 'party_b',
        to_party_id: 'party_a',
        amount: 900,
        currency: 'USD',
      },
    ],
    required_actions: [
      'Jordan delivers the final two chairs.',
      'Priya pays Jordan the remaining $900 after delivery.',
      'Jordan does not refund Priya.',
    ],
    rationale: 'Jordan requests the unpaid balance and does not request a refund.',
  };
}

function defectiveGoldenOutcome(): JsonObject {
  return {
    ...goldenOutcome(),
    outcome_type: 'payment',
    required_actions: ['Jordan delivers the final two chairs after payment.'],
  };
}

function frozenRecords(): { extracted: JsonObject; golden: JsonObject } {
  return {
    extracted: {
      submission: { raw_text: narrative },
      claims: [extractedSourceClaim()],
      damages_claims: [extractedDamage()],
      desired_outcomes: {
        party_id: 'party_a',
        outcomes: [extractedOutcome()],
      },
    },
    golden: {
      submission: { raw_text: narrative },
      claims: [goldenSourceClaim()],
      damages_claims: [goldenDamage()],
      desired_outcomes: {
        party_id: 'party_a',
        outcomes: [goldenOutcome()],
      },
    },
  };
}

function evaluate(
  extracted: JsonObject,
  golden: JsonObject,
  alignment = alignPersonAForCase(extracted, golden, options),
) {
  return evaluatePersonAForCase(extracted, golden, alignment, options);
}

function monetaryErrors(report: ReturnType<typeof evaluate>): JsonObject[] {
  return report.errors.filter((error) => ['damages', 'outcomes'].includes(error.family));
}

function alignedDamages(
  mutate: (records: { extracted: JsonObject; golden: JsonObject }) => void,
): number {
  const records = frozenRecords();
  mutate(records);
  return alignPersonAForCase(records.extracted, records.golden, options).families.damages.pairs
    .length;
}

describe('Dry Run 002 structured monetary identity compatibility', () => {
  it('recovers the adjudicated damage while the source-faithful outcome aligns normally', () => {
    const { extracted, golden } = frozenRecords();
    const priorAlignment = alignPriorProjection(extracted, golden, options);
    const prior = evaluate(extracted, golden, priorAlignment);
    const alignment = alignPersonAForCase(extracted, golden, options);
    const report = evaluate(extracted, golden, alignment);

    expect(monetaryErrors(prior)).toEqual([
      {
        severity: 'major',
        family: 'damages',
        code: 'missing_golden_object',
        message: 'Golden object was not extracted.',
        golden_id: 'dam_dry_run_002',
      },
      {
        severity: 'critical',
        family: 'damages',
        code: 'unsupported_extra_object',
        message:
          'Extracted object has no supported golden match and is a fabrication hard failure.',
        extracted_id: 'damages_unpaid_balance_1',
      },
    ]);
    expect(alignment.families.damages.pairs).toEqual([
      {
        extracted_index: 0,
        golden_index: 0,
        extracted_id: 'damages_unpaid_balance_1',
        golden_id: 'dam_dry_run_002',
        score: 0.4237076922733582,
        margin: 0.4237076922733582,
        recovery_reason: 'exact_structured_monetary_identity',
      },
    ]);
    expect(alignment.families.outcomes.pairs).toEqual([
      expect.objectContaining({
        extracted_id: 'outcome_payment_1',
        golden_id: 'out_dry_run_002',
      }),
    ]);
    expect(alignment.families.outcomes.unmatched_extracted).toEqual([]);
    expect(alignment.families.outcomes.unmatched_golden).toEqual([]);
    expect(monetaryErrors(report)).toEqual([
      {
        severity: 'major',
        family: 'damages',
        code: 'causal_theory',
        message: 'Damages causal theory differs.',
        extracted_id: 'damages_unpaid_balance_1',
        golden_id: 'dam_dry_run_002',
      },
    ]);
  });

  it('removes only the two findings caused by the reversed DR002 golden outcome', () => {
    const fixed = frozenRecords();
    const defective = frozenRecords();
    defective.golden.desired_outcomes.outcomes[0] = defectiveGoldenOutcome();

    const before = evaluate(defective.extracted, defective.golden);
    const after = evaluate(fixed.extracted, fixed.golden);
    const beforeOutcomeFindings = before.errors.filter((error) => error.family === 'outcomes');
    const afterOutcomeFindings = after.errors.filter((error) => error.family === 'outcomes');

    expect(beforeOutcomeFindings).toEqual([
      {
        severity: 'critical',
        family: 'outcomes',
        code: 'missing_golden_object',
        message: 'Golden object was not extracted.',
        golden_id: 'out_dry_run_002',
      },
      {
        severity: 'critical',
        family: 'outcomes',
        code: 'unsupported_extra_object',
        message:
          'Extracted object has no supported golden match and is a fabrication hard failure.',
        extracted_id: 'outcome_payment_1',
      },
    ]);
    expect(afterOutcomeFindings).toEqual([]);
    expect(after.errors).toEqual(before.errors.filter((error) => error.family !== 'outcomes'));
  });

  it('proves exact integer money, unpaid-balance category, causal anchor, and source containment', () => {
    const { extracted, golden } = frozenRecords();
    const damage = proveDryRun002DamageIdentity(
      extracted,
      golden,
      extracted.damages_claims[0],
      golden.damages_claims[0],
      narrative,
    );

    const expectedProof = {
      amountMinorUnits: 90_000n,
      currency: 'USD',
      sourceSpan: {
        startChar: sourceSpan.start_char,
        endChar: sourceSpan.end_char,
        quote: sourceSpan.quote,
      },
    };
    expect(damage).toEqual(expectedProof);
    expect(narrative.slice(sourceSpan.start_char, sourceSpan.end_char)).toBe(sourceQuote);
  });

  it('locks all four audited records and both grounding claims by safe canonical fingerprints', () => {
    const { extracted, golden } = frozenRecords();
    expect(structuredMonetaryRecordFingerprint(extracted.damages_claims[0])).toBe(
      '42d90ed9c3805af375ee0c12ba515bd2ae49bc2ac45b83adc3769b936ce12a37',
    );
    expect(structuredMonetaryRecordFingerprint(golden.damages_claims[0])).toBe(
      '27d5ce5fd95e7a8fee3a64aae8c068ba7e894118d3a9c7f036d6f51631f7f8a2',
    );
    expect(structuredMonetaryRecordFingerprint(extracted.desired_outcomes.outcomes[0])).toBe(
      '2513daa8d2ed1fef51bb44e4b6e14f1b35ff71237740ab09f8598da5341308e4',
    );
    expect(structuredMonetaryRecordFingerprint(golden.desired_outcomes.outcomes[0])).toBe(
      'c94e305e637d2d2d0a11efa9ebbeda14772530c9eda1a2f917d3fd23526c749b',
    );
    expect(structuredMonetaryRecordFingerprint(extracted.claims[0])).toBe(
      '9512e792b1db5df09e73b9e0afc500f567a83f16d1a8f4bd37c95d03130b045f',
    );
    expect(structuredMonetaryRecordFingerprint(golden.claims[0])).toBe(
      '2f52fd6d00c7eae617307136ec859e32ac0094d779a181ef026d49fc4193ec69',
    );
  });

  it.each([
    [
      'different causal theory',
      (records: { extracted: JsonObject }) => {
        records.extracted.damages_claims[0].causal_theory =
          'Replacing damaged chairs caused a $900 expense.';
      },
    ],
    [
      'different amount',
      (records: { extracted: JsonObject }) => {
        records.extracted.damages_claims[0].amount_min = 899;
        records.extracted.damages_claims[0].amount_max = 899;
      },
    ],
    [
      'different currency',
      (records: { extracted: JsonObject }) => {
        records.extracted.damages_claims[0].currency = 'EUR';
      },
    ],
    [
      'approximate amount',
      (records: { extracted: JsonObject }) => {
        records.extracted.damages_claims[0].amount_min = 900.001;
        records.extracted.damages_claims[0].amount_max = 900.001;
      },
    ],
    [
      'range amount',
      (records: { extracted: JsonObject }) => {
        records.extracted.damages_claims[0].amount_max = 950;
      },
    ],
    [
      'deposit instead of balance',
      (records: { extracted: JsonObject }) => {
        records.extracted.damages_claims[0].loss_type = 'other';
        records.extracted.damages_claims[0].calculation_basis = '$900 was paid as a deposit.';
      },
    ],
    [
      'paid instead of unpaid',
      (records: { extracted: JsonObject }) => {
        records.extracted.damages_claims[0].loss_type = 'other';
        records.extracted.damages_claims[0].causal_theory = 'The $900 balance was paid.';
      },
    ],
    [
      'actual instead of requested damage',
      (records: { extracted: JsonObject }) => {
        records.extracted.damages_claims[0].causal_theory = 'Jordan actually incurred a $900 loss.';
      },
    ],
    [
      'qualified causal theory',
      (records: { extracted: JsonObject }) => {
        records.extracted.damages_claims[0].causal_theory =
          'Jordan believes $900 may remain payable after delivery.';
      },
    ],
  ])('does not align damages with the same nominal amount but %s', (_label, mutate) => {
    expect(alignedDamages(mutate as (records: any) => void)).toBe(0);
  });

  it('locks the DR002 golden to the source-supported delivery-before-payment outcome', () => {
    const records = frozenRecords();
    const extracted = records.extracted.desired_outcomes.outcomes[0];
    const golden = records.golden.desired_outcomes.outcomes[0];
    const fixture = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'src/fixtures/dry_run_002.person_a.golden.extraction.json'),
        'utf8',
      ),
    );
    const alignment = alignPersonAForCase(records.extracted, records.golden, options);

    expect(extracted.outcome_type).toBe('mixed');
    expect(golden.outcome_type).toBe('mixed');
    expect(fixture.desired_outcomes.outcomes[0]).toEqual(golden);
    expect(golden.required_actions).toEqual([
      'Jordan delivers the final two chairs.',
      'Priya pays Jordan the remaining $900 after delivery.',
      'Jordan does not refund Priya.',
    ]);
    expect(narrative.slice(sourceSpan.start_char, sourceSpan.end_char)).toBe(sourceQuote);
    expect(sourceQuote).toMatch(/pay the remaining \$900 after I deliver the last two chairs/u);
    expect(alignment.families.outcomes.pairs).toEqual([
      expect.objectContaining({
        extracted_id: 'outcome_payment_1',
        golden_id: 'out_dry_run_002',
      }),
    ]);
  });

  it('aligns harmless wording variation that preserves the conditional delivery-before-payment order', () => {
    const records = frozenRecords();
    const golden = records.golden.desired_outcomes.outcomes[0];
    golden.required_actions = [
      'Jordan hands over the final two chairs before Priya pays the outstanding $900.',
      'Jordan does not refund Priya.',
    ];
    golden.rationale =
      'Jordan requests the balance once the remaining two chairs have been delivered and rejects a refund.';

    const alignment = alignPersonAForCase(records.extracted, records.golden, options);

    expect(alignment.families.outcomes.pairs).toEqual([
      expect.objectContaining({
        extracted_id: 'outcome_payment_1',
        golden_id: 'out_dry_run_002',
      }),
    ]);
    expect(alignment.families.outcomes.unmatched_extracted).toEqual([]);
    expect(alignment.families.outcomes.unmatched_golden).toEqual([]);
  });

  it.each([
    [
      'wrong quote',
      (records: { extracted: JsonObject }) => {
        records.extracted.claims[0].source_spans[0].quote = `${sourceQuote} `;
      },
    ],
    [
      'wrong coordinate',
      (records: { extracted: JsonObject }) => {
        records.extracted.claims[0].source_spans[0].end_char -= 1;
      },
    ],
    [
      'missing span',
      (records: { extracted: JsonObject }) => {
        records.extracted.claims[0].source_spans = [];
      },
    ],
    [
      'different authoritative narrative',
      (records: { extracted: JsonObject }) => {
        records.extracted.submission.raw_text = `${narrative}changed`;
      },
    ],
  ])('fails damage recovery closed for %s', (_label, mutate) => {
    const records = frozenRecords();
    mutate(records);
    const alignment = alignPersonAForCase(records.extracted, records.golden, options);
    expect(alignment.families.damages.pairs).toHaveLength(0);
  });

  it('fails closed for proxies, accessors, non-plain records, and sparse arrays', () => {
    const { extracted, golden } = frozenRecords();
    const proxy = new Proxy(extracted.damages_claims[0], {});
    expect(
      proveDryRun002DamageIdentity(extracted, golden, proxy, golden.damages_claims[0], narrative),
    ).toBeNull();

    const getter = vi.fn(() => extracted.damages_claims[0].causal_theory);
    const stateful = structuredClone(extracted.damages_claims[0]);
    Object.defineProperty(stateful, 'causal_theory', { enumerable: true, get: getter });
    expect(structuredMonetaryRecordFingerprint(stateful)).toBeNull();
    expect(getter).not.toHaveBeenCalled();

    const nonPlain = Object.assign(Object.create({ inherited: true }), extractedOutcome());
    expect(structuredMonetaryRecordFingerprint(nonPlain)).toBeNull();

    const sparse = extractedOutcome();
    sparse.transfers = new Array(2);
    sparse.transfers[0] = extractedOutcome().transfers[0];
    expect(structuredMonetaryRecordFingerprint(sparse)).toBeNull();
  });

  it('does not recover competing duplicate identities', () => {
    const records = frozenRecords();
    records.extracted.damages_claims.push(structuredClone(records.extracted.damages_claims[0]));
    records.golden.damages_claims.push(structuredClone(records.golden.damages_claims[0]));
    const alignment = alignPersonAForCase(records.extracted, records.golden, options);

    expect(alignment.families.damages.pairs).toHaveLength(0);
  });

  it('leaves unrelated same-amount damages and outcomes unmatched and visible', () => {
    const records = frozenRecords();
    records.extracted.damages_claims.push({
      ...extractedDamage(),
      damages_claim_id: 'replacement_cost_900',
      loss_type: 'replacement_cost',
      causal_theory: 'Replacing one chair would cost $900.',
    });
    records.extracted.desired_outcomes.outcomes.push({
      ...extractedOutcome(),
      outcome_id: 'refund_900',
      outcome_type: 'refund',
      rationale: 'Jordan requests a $900 refund.',
    });
    const alignment = alignPersonAForCase(records.extracted, records.golden, options);
    const report = evaluate(records.extracted, records.golden, alignment);

    expect(alignment.families.damages.unmatched_extracted).toContainEqual({
      index: 1,
      id: 'replacement_cost_900',
    });
    expect(alignment.families.outcomes.unmatched_extracted).toContainEqual({
      index: 1,
      id: 'refund_900',
    });
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: 'damages',
          code: 'unsupported_extra_object',
          extracted_id: 'replacement_cost_900',
        }),
        expect.objectContaining({
          family: 'outcomes',
          code: 'unsupported_extra_object',
          extracted_id: 'refund_900',
        }),
      ]),
    );
  });

  it('preserves causal wording and the source-faithful outcome alignment without mutation', () => {
    const { extracted, golden } = frozenRecords();
    const beforeExtracted = structuredClone(extracted);
    const beforeGolden = structuredClone(golden);
    const report = evaluate(extracted, golden);

    expect(extracted).toEqual(beforeExtracted);
    expect(golden).toEqual(beforeGolden);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: 'damages', code: 'causal_theory' }),
      ]),
    );
    expect(report.errors.filter((error) => error.family === 'outcomes')).toEqual([]);
  });

  it('keeps damage recovery inactive while the corrected outcome aligns under locked acceptance', () => {
    const { extracted, golden } = frozenRecords();
    const alignment = alignPersonAForCase(extracted, golden, {
      ...options,
      contractVersion: 'locked_acceptance_v1',
    });
    expect(alignment.families.damages.pairs).toHaveLength(0);
    expect(alignment.families.outcomes.pairs).toEqual([
      expect.objectContaining({
        extracted_id: 'outcome_payment_1',
        golden_id: 'out_dry_run_002',
      }),
    ]);
  });
});
