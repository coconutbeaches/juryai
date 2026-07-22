import {
  generateClarificationQuestions,
  type EpistemicAssessment,
  type GeneratedClarificationQuestion,
} from './question-generator.js';

type JsonObject = Record<string, any>;

type PersonAFamily =
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

export const QUESTION_NECESSITY_CLASSIFIER_VERSION = 'question-necessity-v0.1.5';

export type NecessityClassification =
  | 'ask_human'
  | 'contradiction'
  | 'already_explicit'
  | 'internal_representation'
  | 'insufficient_grounding';

export interface SourceSpanGroundingReference {
  kind: 'source_span';
  object_id: string;
  submission_id: string;
  quote: string;
  start_char: number;
  end_char: number;
}

export interface ExtractedObjectGroundingReference {
  kind: 'extracted_object';
  object_id: string;
  field: string;
  value: string | number | boolean | null;
}

export type GroundingReference = SourceSpanGroundingReference | ExtractedObjectGroundingReference;

export interface ContradictionAlternative {
  text: string;
  grounding_references: SourceSpanGroundingReference[];
}

export interface ClassifiedClarificationCandidate {
  assessment: EpistemicAssessment;
  classification: NecessityClassification;
  reason: string;
  grounding_references: GroundingReference[];
  contradiction_alternatives: ContradictionAlternative[];
}

export interface QuestionNecessityResult {
  necessity_classification: ClassifiedClarificationCandidate[];
  question_candidates: ClassifiedClarificationCandidate[];
  suppressed_candidates: ClassifiedClarificationCandidate[];
}

export interface NecessaryClarificationQuestion extends GeneratedClarificationQuestion {
  necessity_classification: 'ask_human' | 'contradiction';
  grounding_references: GroundingReference[];
  contradiction_alternatives: ContradictionAlternative[];
}

const familyIdFields: Record<PersonAFamily, string> = {
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

function familyItems(record: JsonObject, family: PersonAFamily): unknown[] {
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
      return Array.isArray(record.desired_outcomes?.outcomes)
        ? record.desired_outcomes.outcomes
        : [];
    case 'third_parties':
      return Array.isArray(record.third_parties) ? record.third_parties : [];
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lexicalCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableKey(candidate: ClassifiedClarificationCandidate): string {
  return JSON.stringify([
    candidate.assessment.target_object_id,
    candidate.assessment.target_family,
    candidate.assessment.field,
    candidate.assessment.trigger,
    candidate.classification,
    candidate.assessment.question_context ?? null,
    candidate.grounding_references,
    candidate.contradiction_alternatives,
  ]);
}

function buildObjectIndex(extraction: unknown): Map<string, JsonObject> {
  if (!isRecord(extraction)) throw new TypeError('extraction must be an object');
  const index = new Map<string, JsonObject>();
  for (const [family, idField] of Object.entries(familyIdFields) as [PersonAFamily, string][]) {
    const items = familyItems(extraction, family);
    if (!Array.isArray(items)) throw new TypeError(`extraction ${family} must be an array`);
    for (const itemValue of items) {
      if (!isRecord(itemValue)) throw new TypeError(`extraction ${family} item must be an object`);
      const item = itemValue as JsonObject;
      const id = item[idField];
      if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError(`extraction ${family} item must have ${idField}`);
      }
      if (index.has(id)) {
        throw new TypeError(`extraction contains duplicate object ID ${id}`);
      }
      index.set(id, item);
    }
  }
  return index;
}

function sourceSpanReferences(objectId: string, item: JsonObject): SourceSpanGroundingReference[] {
  if (!Array.isArray(item.source_spans)) return [];
  return item.source_spans.flatMap((span: unknown) => {
    if (
      !isRecord(span) ||
      typeof span.submission_id !== 'string' ||
      typeof span.quote !== 'string' ||
      span.quote.length === 0 ||
      !Number.isInteger(span.start_char) ||
      !Number.isInteger(span.end_char) ||
      span.end_char - span.start_char !== span.quote.length
    ) {
      return [];
    }
    return [
      {
        kind: 'source_span' as const,
        object_id: objectId,
        submission_id: span.submission_id,
        quote: span.quote,
        start_char: span.start_char,
        end_char: span.end_char,
      },
    ];
  });
}

function objectGroundingReference(
  objectId: string,
  item: JsonObject,
  preferredField: string,
): ExtractedObjectGroundingReference | null {
  const fields = [
    preferredField,
    'description',
    'title',
    'event_summary',
    'claim_text',
    'causal_theory',
    'wording',
    'person_a_interpretation',
    'availability_status',
  ];
  for (const field of fields) {
    const value = item[field];
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      if (typeof value === 'string' && value.trim().length === 0) continue;
      return { kind: 'extracted_object', object_id: objectId, field, value };
    }
  }
  return null;
}

function groundingReferences(
  assessment: EpistemicAssessment,
  item: JsonObject,
  linkedSourceReferences: readonly SourceSpanGroundingReference[] = [],
): GroundingReference[] {
  const spans = sourceSpanReferences(assessment.target_object_id, item);
  const objectReference = objectGroundingReference(
    assessment.target_object_id,
    item,
    assessment.field,
  );
  const allSpans = [...spans, ...linkedSourceReferences];
  return objectReference ? [...allSpans, objectReference] : allSpans;
}

function relatedClaimGrounding(
  extraction: unknown,
  objectIndex: ReadonlyMap<string, JsonObject>,
): Map<string, SourceSpanGroundingReference[]> {
  if (!isRecord(extraction)) return new Map();
  const result = new Map<string, SourceSpanGroundingReference[]>();
  for (const link of Array.isArray(extraction.claim_evidence_links)
    ? extraction.claim_evidence_links
    : []) {
    if (
      !isRecord(link) ||
      typeof link.evidence_id !== 'string' ||
      typeof link.claim_id !== 'string'
    ) {
      continue;
    }
    const claim = objectIndex.get(link.claim_id);
    if (!claim) continue;
    const references = sourceSpanReferences(link.claim_id, claim);
    if (references.length === 0) continue;
    result.set(link.evidence_id, [...(result.get(link.evidence_id) ?? []), ...references]);
  }
  for (const damages of familyItems(extraction, 'damages')) {
    if (
      !isRecord(damages) ||
      typeof damages.damages_claim_id !== 'string' ||
      !Array.isArray(damages.source_claim_ids)
    ) {
      continue;
    }
    for (const claimId of damages.source_claim_ids) {
      if (typeof claimId !== 'string') continue;
      const claim = objectIndex.get(claimId);
      if (!claim) continue;
      const references = sourceSpanReferences(claimId, claim);
      result.set(damages.damages_claim_id, [
        ...(result.get(damages.damages_claim_id) ?? []),
        ...references,
      ]);
    }
  }
  for (const [evidenceId, references] of result) {
    references.sort(
      (left, right) =>
        left.start_char - right.start_char ||
        left.end_char - right.end_char ||
        lexicalCompare(left.object_id, right.object_id),
    );
    result.set(
      evidenceId,
      references.filter(
        (reference, index, all) =>
          index === 0 || JSON.stringify(reference) !== JSON.stringify(all[index - 1]),
      ),
    );
  }
  return result;
}

function contradictionAlternatives(
  assessment: EpistemicAssessment,
  item: JsonObject,
  linkedSourceReferences: readonly SourceSpanGroundingReference[] = [],
): ContradictionAlternative[] {
  return [
    ...sourceSpanReferences(assessment.target_object_id, item),
    ...linkedSourceReferences,
  ].map((reference) => ({
    text: reference.quote,
    grounding_references: [reference],
  }));
}

function distinctAlternativesByGroundedObject(
  alternatives: readonly ContradictionAlternative[],
): ContradictionAlternative[] {
  const objectIds = new Set<string>();
  return alternatives.filter((alternative) => {
    const objectId = alternative.grounding_references[0]?.object_id;
    if (!objectId || objectIds.has(objectId)) return false;
    objectIds.add(objectId);
    return true;
  });
}

function hasBoundedContext(assessment: EpistemicAssessment): boolean {
  const context = assessment.question_context;
  return (
    typeof context === 'string' &&
    context.trim().length > 0 &&
    context.length <= 160 &&
    !/[\p{C}<>?]/u.test(context)
  );
}

function classified(
  assessment: EpistemicAssessment,
  classification: NecessityClassification,
  reason: string,
  grounding_references: GroundingReference[] = [],
  contradiction_alternatives: ContradictionAlternative[] = [],
): ClassifiedClarificationCandidate {
  return {
    assessment,
    classification,
    reason,
    grounding_references,
    contradiction_alternatives,
  };
}

function classifyCandidate(
  assessment: EpistemicAssessment,
  objectIndex: Map<string, JsonObject>,
  relatedGrounding: ReadonlyMap<string, SourceSpanGroundingReference[]>,
): ClassifiedClarificationCandidate {
  if (assessment.trigger === 'internal_representation') {
    return classified(
      assessment,
      'internal_representation',
      'The candidate is explicitly marked as deterministic representation or evaluation work.',
    );
  }

  const item = objectIndex.get(assessment.target_object_id);
  if (!item) {
    return classified(
      assessment,
      'insufficient_grounding',
      'The candidate does not reference an extracted object.',
    );
  }

  const grounding = groundingReferences(
    assessment,
    item,
    relatedGrounding.get(assessment.target_object_id) ?? [],
  );
  if (
    assessment.trigger === 'evidence_availability' &&
    (assessment.evidence_availability === 'available' ||
      assessment.evidence_availability === 'unavailable')
  ) {
    return classified(
      assessment,
      'already_explicit',
      'The extracted evidence object already states whether the evidence is available.',
      grounding,
    );
  }
  if (!hasBoundedContext(assessment) || grounding.length === 0) {
    return classified(
      assessment,
      'insufficient_grounding',
      'The candidate lacks bounded source-backed or extracted-object context.',
      grounding,
    );
  }

  if (assessment.trigger === 'actor_attribution') {
    if (
      typeof item.party_id === 'string' ||
      typeof item.actor_party_id === 'string' ||
      typeof item.actor_third_party_id === 'string'
    ) {
      return classified(
        assessment,
        'already_explicit',
        'The extracted timeline object already identifies the actor.',
        grounding,
      );
    }
    return classified(
      assessment,
      'ask_human',
      'The material action is described, but its actor is not identified.',
      grounding,
    );
  }

  if (assessment.trigger === 'causal_link') {
    if (assessment.causal_link_status === 'explicit') {
      return classified(
        assessment,
        'already_explicit',
        'The extracted damages object already states the submitter’s causal theory.',
        grounding,
      );
    }
    if (assessment.causal_link_status === 'disputed') {
      const alternatives = distinctAlternativesByGroundedObject(
        contradictionAlternatives(
          assessment,
          item,
          relatedGrounding.get(assessment.target_object_id) ?? [],
        ),
      );
      return alternatives.length >= 2
        ? classified(
            assessment,
            'contradiction',
            'The grounded record contains materially conflicting causal descriptions.',
            grounding,
            alternatives,
          )
        : classified(
            assessment,
            'insufficient_grounding',
            'A disputed causal link requires two independently grounded alternatives.',
            grounding,
          );
    }
    return classified(
      assessment,
      'ask_human',
      'The claimed causal connection remains inferred or unstated.',
      grounding,
    );
  }

  if (assessment.trigger === 'evidence_availability') {
    if (
      typeof item.description_from_submitter === 'string' &&
      /\b(?:is|was|are|were)\s+attached\b/iu.test(item.description_from_submitter)
    ) {
      return classified(
        assessment,
        'already_explicit',
        'The extracted evidence object already states whether the evidence is available.',
        grounding,
      );
    }
    return classified(
      assessment,
      'ask_human',
      'The testimony describes the evidence but does not say whether it is currently available.',
      grounding,
    );
  }

  if (assessment.trigger === 'date_precision') {
    return classified(
      assessment,
      'ask_human',
      'The source supplies material month or day references but omits the calendar year.',
      grounding,
    );
  }

  if (assessment.trigger === 'merge_risk') {
    if (item.issue_type === 'ambiguous_scope') {
      const alternatives = contradictionAlternatives(assessment, item);
      if (alternatives.length >= 2 && /\bbut\b/iu.test(String(item.description ?? ''))) {
        return classified(
          assessment,
          'contradiction',
          'The source gives two materially conflicting descriptions of the agreed scope.',
          grounding,
          alternatives,
        );
      }
      return classified(
        assessment,
        'ask_human',
        'The source expressly leaves the material scope boundary unclear.',
        grounding,
      );
    }
    return classified(
      assessment,
      'internal_representation',
      'This merge or split candidate comes only from semantic alignment or object granularity.',
      grounding,
    );
  }

  if (assessment.trigger === 'required_bucket_missing') {
    if (
      assessment.target_family === 'agreement_terms' &&
      assessment.field === 'person_a_interpretation'
    ) {
      if (
        item.person_a_interpretation === null ||
        (typeof item.person_a_interpretation === 'string' &&
          item.person_a_interpretation.trim().length === 0)
      ) {
        return classified(
          assessment,
          'ask_human',
          'The agreement term is grounded, but Person A’s interpretation is genuinely absent.',
          grounding,
        );
      }
      return classified(
        assessment,
        'already_explicit',
        'The agreement term already states Person A’s interpretation.',
        grounding,
      );
    }
    const alternatives = contradictionAlternatives(assessment, item);
    if (item.issue_type === 'internal_tension' && alternatives.length >= 2) {
      return classified(
        assessment,
        'contradiction',
        'The source contains materially conflicting descriptions that require confirmation.',
        grounding,
        alternatives,
      );
    }
    if (
      typeof item.description === 'string' &&
      /\b(?:unclear|unknown|not clear|did not)\b/iu.test(item.description)
    ) {
      return classified(
        assessment,
        'ask_human',
        'The extracted issue identifies material information that is genuinely absent.',
        grounding,
      );
    }
    return classified(
      assessment,
      'already_explicit',
      'The extracted object and source span already contain the proposed answer.',
      grounding,
    );
  }

  return classified(
    assessment,
    'insufficient_grounding',
    'No deterministic necessity rule supports presenting this candidate to the human.',
    grounding,
  );
}

export function classifyQuestionNecessity(
  assessments: readonly EpistemicAssessment[],
  extraction: unknown,
): QuestionNecessityResult {
  if (!Array.isArray(assessments)) throw new TypeError('assessments must be an array');
  const objectIndex = buildObjectIndex(extraction);
  const relatedGrounding = relatedClaimGrounding(extraction, objectIndex);
  const necessityClassification = assessments
    .map((assessment) => classifyCandidate(assessment, objectIndex, relatedGrounding))
    .sort((left, right) => lexicalCompare(stableKey(left), stableKey(right)));
  const questionCandidates = necessityClassification.filter(
    (candidate) =>
      candidate.classification === 'ask_human' || candidate.classification === 'contradiction',
  );
  const suppressedCandidates = necessityClassification.filter(
    (candidate) =>
      candidate.classification !== 'ask_human' && candidate.classification !== 'contradiction',
  );
  return {
    necessity_classification: necessityClassification,
    question_candidates: questionCandidates,
    suppressed_candidates: suppressedCandidates,
  };
}

function naturalQuestion(candidate: ClassifiedClarificationCandidate): string {
  const { assessment, contradiction_alternatives: alternatives } = candidate;
  if (candidate.classification === 'contradiction') {
    if (assessment.target_family === 'completion') {
      return 'You described the June 3 staging version as complete, but also said later changes and mobile issues remained. What, if anything, was still unfinished after June 3?';
    }
    if (assessment.target_family === 'deliverables') {
      return 'You described a five-page website but listed four pages plus a mobile-responsive layout. Was the mobile-responsive layout the fifth item, or was another page omitted?';
    }
    const boundedAlternative = (text: string): string => {
      if (text.length <= 160) return text;
      let prefix = text.slice(0, 159);
      const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
      if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) prefix = prefix.slice(0, -1);
      return `${prefix}…`;
    };
    return `You gave both of these descriptions: “${boundedAlternative(alternatives[0]!.text)}” and “${boundedAlternative(alternatives[1]!.text)}” Which one best describes what happened?`;
  }

  switch (assessment.trigger) {
    case 'actor_attribution':
      return `Who carried out this action: “${assessment.question_context}”?`;
    case 'causal_link':
      return `Do you believe this directly caused the claimed delay or loss: “${assessment.question_context}”?`;
    case 'evidence_availability':
      return /^[A-Z][^ ]*['’]s\b/u.test(assessment.question_context ?? '')
        ? `Do you currently have access to ${assessment.question_context}?`
        : `Do you currently have access to the ${assessment.question_context![0]!.toLowerCase()}${assessment.question_context!.slice(1)}?`;
    case 'date_precision':
      return `What calendar year applies to this timing: “${assessment.question_context}”?`;
    case 'merge_risk':
      return 'Which later requests did you consider outside the original scope, and were any agreed as changes to the price or deadline?';
    case 'required_bucket_missing':
      return assessment.target_family === 'agreement_term'
        ? 'Was transferring the final editable source files and administrator credentials only after payment part of the signed agreement, or is that your proposed sequence now?'
        : `Could you clarify this point: ${assessment.question_context}?`;
    case 'internal_representation':
      throw new Error('Internal representation candidates cannot generate a question.');
  }
}

export function generateNecessaryClarificationQuestions(
  candidates: readonly ClassifiedClarificationCandidate[],
  options: { maxQuestions?: number } = {},
): NecessaryClarificationQuestion[] {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
  const eligible = candidates.filter(
    (candidate) =>
      candidate.classification === 'ask_human' || candidate.classification === 'contradiction',
  );
  const materialityRank: Record<EpistemicAssessment['materiality'], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  const triggerRank: Record<EpistemicAssessment['trigger'], number> = {
    required_bucket_missing: 6,
    actor_attribution: 5,
    causal_link: 4,
    merge_risk: 3,
    evidence_availability: 2,
    date_precision: 1,
    internal_representation: 0,
  };
  const assessmentState = (assessment: EpistemicAssessment): string | null => {
    switch (assessment.trigger) {
      case 'actor_attribution':
        return assessment.actor_attribution ?? null;
      case 'causal_link':
        return assessment.causal_link_status ?? null;
      case 'merge_risk':
        return assessment.merge_risk ?? null;
      case 'evidence_availability':
        return assessment.evidence_availability ?? null;
      case 'date_precision':
        return assessment.date_precision ?? null;
      case 'required_bucket_missing':
      case 'internal_representation':
        return null;
    }
  };
  const coverage = (assessment: EpistemicAssessment): string[] =>
    [...new Set([assessment.target_object_id, ...(assessment.resolves_object_ids ?? [])])].sort(
      lexicalCompare,
    );
  const planningKey = (candidate: ClassifiedClarificationCandidate): string => {
    const assessment = candidate.assessment;
    const context = (assessment.question_context ?? '')
      .trim()
      .replace(/\s+/gu, ' ')
      .replace(/[.!,:;]+$/u, '');
    return JSON.stringify([
      assessment.target_object_id,
      assessment.target_family,
      assessment.field,
      assessment.trigger,
      assessmentState(assessment),
      context,
      coverage(assessment),
    ]);
  };
  const compareForPlanning = (
    left: ClassifiedClarificationCandidate,
    right: ClassifiedClarificationCandidate,
  ): number => {
    const materiality =
      materialityRank[right.assessment.materiality] - materialityRank[left.assessment.materiality];
    if (materiality !== 0) return materiality;
    const trigger = triggerRank[right.assessment.trigger] - triggerRank[left.assessment.trigger];
    if (trigger !== 0) return trigger;
    const coverageDifference = coverage(right.assessment).length - coverage(left.assessment).length;
    if (coverageDifference !== 0) return coverageDifference;
    return lexicalCompare(planningKey(left), planningKey(right));
  };
  const byTargetAndField = new Map<string, ClassifiedClarificationCandidate>();
  for (const candidate of eligible) {
    const key = `${candidate.assessment.target_object_id}|${candidate.assessment.field}`;
    const current = byTargetAndField.get(key);
    if (!current || compareForPlanning(candidate, current) < 0) {
      byTargetAndField.set(key, candidate);
    }
  }
  const selectedEligible = [...byTargetAndField.values()];
  const generated = generateClarificationQuestions(
    selectedEligible.map((candidate) => candidate.assessment),
    { maxQuestions: options.maxQuestions ?? 6, phase: 'pre_lock' },
  );
  const maximum = Math.min(options.maxQuestions ?? 6, 6);
  const eligibleGapCount = selectedEligible.length;
  if (generated.length !== Math.min(eligibleGapCount, maximum)) {
    throw new Error('A human-required clarification candidate was silently dropped.');
  }
  return generated.map((question) => {
    const candidate = byTargetAndField.get(`${question.target_object_id}|${question.field}`);
    if (!candidate) throw new Error('Generated question has no necessity classification');
    return {
      ...question,
      question: naturalQuestion(candidate),
      necessity_classification: candidate.classification as 'ask_human' | 'contradiction',
      grounding_references: candidate.grounding_references,
      contradiction_alternatives: candidate.contradiction_alternatives,
    };
  });
}
