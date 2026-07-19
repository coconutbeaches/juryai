type JsonObject = Record<string, any>;

export type PersonAFamily =
  | 'agreement_terms'
  | 'deliverables'
  | 'timeline'
  | 'claims'
  | 'evidence'
  | 'damages'
  | 'outcomes'
  | 'third_parties'
  | 'extraction_issues'
  | 'clarification_questions';

export type AlignmentPair = {
  extracted_index: number;
  golden_index: number;
  extracted_id: string;
  golden_id: string;
  score: number;
  margin: number;
};

export type AmbiguousAlignment = {
  extracted_index: number;
  extracted_id: string;
  candidates: Array<{ golden_index: number; golden_id: string; score: number }>;
};

export type FamilyAlignment = {
  family: PersonAFamily;
  pairs: AlignmentPair[];
  ambiguous: AmbiguousAlignment[];
  unmatched_extracted: Array<{ index: number; id: string }>;
  unmatched_golden: Array<{ index: number; id: string }>;
};

export type PersonAAlignment = {
  version: 'person-a-alignment-v0.1.0';
  families: Record<PersonAFamily, FamilyAlignment>;
};

const familyOrder: PersonAFamily[] = [
  'agreement_terms',
  'deliverables',
  'timeline',
  'claims',
  'evidence',
  'damages',
  'outcomes',
  'third_parties',
  'extraction_issues',
  'clarification_questions',
];

const synonyms: Record<string, string> = {
  website: 'site',
  webpage: 'site',
  responsive: 'mobile',
  cellphone: 'mobile',
  smartphone: 'mobile',
  final: 'complete',
  finished: 'complete',
  completion: 'complete',
  late: 'delay',
  delayed: 'delay',
  deadline: 'launch',
  credentials: 'access',
  administrator: 'access',
  admin: 'access',
  source: 'files',
  balance: 'payment',
  owed: 'payment',
  client: 'maya',
  freelancer: 'alex',
  designer: 'alex',
  unusable: 'broken',
  defective: 'broken',
};

export function normalizeMeaning(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[^\p{L}\p{N}$]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => synonyms[token] ?? token)
    .join(' ');
}

function tokenDice(a: string, b: string): number {
  const left = new Set(a.split(' ').filter(Boolean));
  const right = new Set(b.split(' ').filter(Boolean));
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function trigrams(value: string): Map<string, number> {
  const padded = `  ${value}  `;
  const result = new Map<string, number>();
  for (let index = 0; index <= padded.length - 3; index += 1) {
    const gram = padded.slice(index, index + 3);
    result.set(gram, (result.get(gram) ?? 0) + 1);
  }
  return result;
}

function trigramDice(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const left = trigrams(a);
  const right = trigrams(b);
  let overlap = 0;
  let leftTotal = 0;
  let rightTotal = 0;
  for (const count of left.values()) leftTotal += count;
  for (const count of right.values()) rightTotal += count;
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) ?? 0);
  return (2 * overlap) / (leftTotal + rightTotal);
}

export function semanticSimilarity(a: unknown, b: unknown): number {
  const left = normalizeMeaning(a);
  const right = normalizeMeaning(b);
  return 0.65 * tokenDice(left, right) + 0.35 * trigramDice(left, right);
}

function dateScore(a: JsonObject | undefined, b: JsonObject | undefined): number {
  if (!a || !b || !a.start || !b.start) return 0.5;
  const aStart = Date.parse(a.start);
  const aEnd = Date.parse(a.end ?? a.start);
  const bStart = Date.parse(b.start);
  const bEnd = Date.parse(b.end ?? b.start);
  if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) return 0;
  if (aStart <= bEnd && bStart <= aEnd) return 1;
  const day = 86_400_000;
  const distance = Math.min(Math.abs(aStart - bEnd), Math.abs(bStart - aEnd)) / day;
  return Math.max(0, 1 - distance / 30);
}

function amountScore(a: JsonObject, b: JsonObject): number {
  const aMin = a.amount_min ?? a.transfers?.[0]?.amount ?? null;
  const aMax = a.amount_max ?? a.transfers?.[0]?.amount ?? aMin;
  const bMin = b.amount_min ?? b.transfers?.[0]?.amount ?? null;
  const bMax = b.amount_max ?? b.transfers?.[0]?.amount ?? bMin;
  if (aMin === null || bMin === null) return 0.5;
  if (aMin <= bMax && bMin <= aMax) return 1;
  return Math.max(0, 1 - Math.abs(aMin - bMin) / Math.max(aMin, bMin, 1));
}

function transferDirection(item: JsonObject): string {
  const transfer = item.transfers?.[0];
  return transfer ? `${transfer.from_party_id}->${transfer.to_party_id}` : 'none';
}

function join(value: unknown): string {
  return Array.isArray(value) ? value.join(' ') : '';
}

function idFor(family: PersonAFamily, item: JsonObject, index: number): string {
  const keys: Record<PersonAFamily, string> = {
    agreement_terms: 'term_id',
    deliverables: 'deliverable_id',
    timeline: 'event_id',
    claims: 'claim_id',
    evidence: 'evidence_id',
    damages: 'damages_claim_id',
    outcomes: 'outcome_id',
    third_parties: 'third_party_id',
    extraction_issues: 'issue_id',
    clarification_questions: 'question_id',
  };
  return typeof item[keys[family]] === 'string' ? item[keys[family]] : `${family}_${index}`;
}

export function familyItems(record: JsonObject, family: PersonAFamily): JsonObject[] {
  switch (family) {
    case 'agreement_terms':
      return Array.isArray(record.agreement?.terms) ? record.agreement.terms : [];
    case 'deliverables':
      return Array.isArray(record.deliverable_assessments) ? record.deliverable_assessments : [];
    case 'timeline':
    case 'claims':
    case 'evidence':
    case 'extraction_issues':
    case 'clarification_questions':
      return Array.isArray(record[family]) ? record[family] : [];
    case 'damages':
      return Array.isArray(record.damages_claims) ? record.damages_claims : [];
    case 'outcomes':
      return Array.isArray(record.desired_outcomes?.outcomes) ? record.desired_outcomes.outcomes : [];
    case 'third_parties':
      return Array.isArray(record.third_parties) ? record.third_parties : [];
  }
}

function candidateScore(family: PersonAFamily, extracted: JsonObject, golden: JsonObject): number | null {
  switch (family) {
    case 'claims':
      if (extracted.party_id !== golden.party_id || extracted.claim_type !== golden.claim_type) return null;
      return semanticSimilarity(extracted.claim_text, golden.claim_text);
    case 'timeline': {
      const actorMatch =
        extracted.actor_party_id === golden.actor_party_id &&
        extracted.actor_third_party_id === golden.actor_third_party_id;
      const dates = dateScore(extracted.date, golden.date);
      if (!actorMatch || dates === 0) return null;
      return 0.72 * semanticSimilarity(extracted.event_summary, golden.event_summary) + 0.28 * dates;
    }
    case 'evidence':
      if (
        extracted.submitted_by_party_id !== golden.submitted_by_party_id ||
        extracted.evidence_type !== golden.evidence_type
      )
        return null;
      return (
        0.48 * semanticSimilarity(extracted.title, golden.title) +
        0.37 *
          semanticSimilarity(extracted.description_from_submitter, golden.description_from_submitter) +
        0.1 * dateScore(extracted.created_date, golden.created_date) +
        0.05 *
          semanticSimilarity(extracted.provenance?.source_system, golden.provenance?.source_system)
      );
    case 'agreement_terms':
      if (extracted.term_type !== golden.term_type) return null;
      return (
        0.62 * semanticSimilarity(extracted.wording, golden.wording) +
        0.38 *
          semanticSimilarity(extracted.person_a_interpretation, golden.person_a_interpretation)
      );
    case 'deliverables':
      return (
        0.65 * semanticSimilarity(extracted.name, golden.name) +
        0.2 * semanticSimilarity(join(extracted.alleged_defects), join(golden.alleged_defects)) +
        0.15 * semanticSimilarity(join(extracted.repair_attempts), join(golden.repair_attempts))
      );
    case 'damages':
      if (extracted.party_id !== golden.party_id || extracted.loss_type !== golden.loss_type) return null;
      return (
        0.5 * semanticSimilarity(extracted.causal_theory, golden.causal_theory) +
        0.35 * amountScore(extracted, golden) +
        0.15 * semanticSimilarity(extracted.calculation_basis, golden.calculation_basis)
      );
    case 'outcomes':
      if (
        extracted.outcome_type !== golden.outcome_type ||
        transferDirection(extracted) !== transferDirection(golden)
      )
        return null;
      return (
        0.35 * amountScore(extracted, golden) +
        0.4 * semanticSimilarity(join(extracted.required_actions), join(golden.required_actions)) +
        0.25 * semanticSimilarity(extracted.rationale, golden.rationale)
      );
    case 'third_parties':
      if (extracted.relationship_to_party_id !== golden.relationship_to_party_id) return null;
      return (
        0.65 * semanticSimilarity(extracted.name_or_label, golden.name_or_label) +
        0.35 * semanticSimilarity(extracted.role, golden.role)
      );
    case 'extraction_issues':
      if (extracted.issue_type !== golden.issue_type) return null;
      return semanticSimilarity(extracted.description, golden.description);
    case 'clarification_questions':
      if (extracted.target_party_id !== golden.target_party_id) return null;
      return (
        0.72 * semanticSimilarity(extracted.question, golden.question) +
        0.28 * semanticSimilarity(extracted.reason, golden.reason)
      );
  }
}

const thresholds: Record<PersonAFamily, number> = {
  agreement_terms: 0.48,
  deliverables: 0.46,
  timeline: 0.5,
  claims: 0.5,
  evidence: 0.5,
  damages: 0.55,
  outcomes: 0.55,
  third_parties: 0.45,
  extraction_issues: 0.45,
  clarification_questions: 0.42,
};

function maximumWeightAssignment(scores: Array<Array<number | null>>): number[] {
  const rows = scores.length;
  const columns = scores.reduce((max, row) => Math.max(max, row.length), 0);
  if (rows === 0) return [];
  if (columns === 0) return Array(rows).fill(-1) as number[];
  const size = Math.max(rows, columns);
  const cost = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => 1 - (scores[row]?.[column] ?? 0)),
  );
  const u = Array(size + 1).fill(0) as number[];
  const v = Array(size + 1).fill(0) as number[];
  const p = Array(size + 1).fill(0) as number[];
  const way = Array(size + 1).fill(0) as number[];

  for (let row = 1; row <= size; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minv = Array(size + 1).fill(Number.POSITIVE_INFINITY) as number[];
    const used = Array(size + 1).fill(false) as boolean[];
    do {
      used[column0] = true;
      const row0 = p[column0] ?? 0;
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= size; column += 1) {
        if (used[column]) continue;
        const current = (cost[row0 - 1]?.[column - 1] ?? 1) - (u[row0] ?? 0) - (v[column] ?? 0);
        if (current < (minv[column] ?? Number.POSITIVE_INFINITY)) {
          minv[column] = current;
          way[column] = column0;
        }
        if ((minv[column] ?? Number.POSITIVE_INFINITY) < delta) {
          delta = minv[column] ?? Number.POSITIVE_INFINITY;
          column1 = column;
        }
      }
      for (let column = 0; column <= size; column += 1) {
        if (used[column]) {
          const assignedRow = p[column] ?? 0;
          u[assignedRow] = (u[assignedRow] ?? 0) + delta;
          v[column] = (v[column] ?? 0) - delta;
        } else {
          minv[column] = (minv[column] ?? 0) - delta;
        }
      }
      column0 = column1;
    } while ((p[column0] ?? 0) !== 0);

    do {
      const column1 = way[column0] ?? 0;
      p[column0] = p[column1] ?? 0;
      column0 = column1;
    } while (column0 !== 0);
  }

  const assignment = Array(rows).fill(-1) as number[];
  for (let column = 1; column <= size; column += 1) {
    const row = p[column] ?? 0;
    if (row >= 1 && row <= rows && column <= columns) assignment[row - 1] = column - 1;
  }
  return assignment;
}

function alignFamily(
  family: PersonAFamily,
  extractedItems: JsonObject[],
  goldenItems: JsonObject[],
): FamilyAlignment {
  const scores = extractedItems.map((extracted) =>
    goldenItems.map((golden) => candidateScore(family, extracted, golden)),
  );
  const assignment = maximumWeightAssignment(scores);
  const pairs: AlignmentPair[] = [];
  const ambiguous: AmbiguousAlignment[] = [];
  const usedGolden = new Set<number>();
  const usedExtracted = new Set<number>();

  assignment.forEach((goldenIndex, extractedIndex) => {
    if (goldenIndex < 0) return;
    const score = scores[extractedIndex]?.[goldenIndex];
    if (score === null || score === undefined || score < thresholds[family]) return;
    const alternatives = (scores[extractedIndex] ?? [])
      .map((candidateScoreValue, index) => ({ index, score: candidateScoreValue ?? 0 }))
      .filter((candidate) => candidate.index !== goldenIndex && candidate.score >= thresholds[family])
      .sort((a, b) => b.score - a.score);
    const second = alternatives[0]?.score ?? 0;
    const margin = score - second;
    if (alternatives.length > 0 && margin < 0.05) {
      ambiguous.push({
        extracted_index: extractedIndex,
        extracted_id: idFor(family, extractedItems[extractedIndex] ?? {}, extractedIndex),
        candidates: [
          { golden_index: goldenIndex, golden_id: idFor(family, goldenItems[goldenIndex] ?? {}, goldenIndex), score },
          ...alternatives.slice(0, 2).map((candidate) => ({
            golden_index: candidate.index,
            golden_id: idFor(family, goldenItems[candidate.index] ?? {}, candidate.index),
            score: candidate.score,
          })),
        ],
      });
      return;
    }
    usedGolden.add(goldenIndex);
    usedExtracted.add(extractedIndex);
    pairs.push({
      extracted_index: extractedIndex,
      golden_index: goldenIndex,
      extracted_id: idFor(family, extractedItems[extractedIndex] ?? {}, extractedIndex),
      golden_id: idFor(family, goldenItems[goldenIndex] ?? {}, goldenIndex),
      score,
      margin,
    });
  });

  return {
    family,
    pairs,
    ambiguous,
    unmatched_extracted: extractedItems
      .map((item, index) => ({ index, id: idFor(family, item, index) }))
      .filter((item) => !usedExtracted.has(item.index)),
    unmatched_golden: goldenItems
      .map((item, index) => ({ index, id: idFor(family, item, index) }))
      .filter((item) => !usedGolden.has(item.index)),
  };
}

export function alignPersonA(extracted: JsonObject, golden: JsonObject): PersonAAlignment {
  const families = {} as Record<PersonAFamily, FamilyAlignment>;
  for (const family of familyOrder) {
    families[family] = alignFamily(family, familyItems(extracted, family), familyItems(golden, family));
  }
  return { version: 'person-a-alignment-v0.1.0', families };
}
