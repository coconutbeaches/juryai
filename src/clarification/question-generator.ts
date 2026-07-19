export type AttributionStatus = 'explicit' | 'inferred' | 'unstated';
export type CausalLinkStatus = 'explicit' | 'inferred' | 'disputed' | 'unstated';
export type MergeRisk = 'none' | 'possible_merge' | 'possible_split';
export type Materiality = 'critical' | 'high' | 'medium' | 'low';
export type ClarificationPhase = 'pre_lock' | 'post_lock_amendment';

export type ClarificationTriggerKind =
  | 'actor_attribution'
  | 'causal_link'
  | 'merge_risk'
  | 'evidence_availability'
  | 'date_precision'
  | 'required_bucket_missing'
  | 'internal_representation';

export interface EpistemicAssessment {
  target_object_id: string;
  target_family: string;
  field: string;
  trigger: ClarificationTriggerKind;
  materiality: Materiality;
  actor_attribution?: AttributionStatus;
  causal_link_status?: CausalLinkStatus;
  merge_risk?: MergeRisk;
  evidence_availability?: 'available' | 'described_only' | 'unavailable' | 'unknown';
  date_precision?: 'day' | 'month' | 'year' | 'range' | 'unknown';
  question_hint?: string;
  resolves_object_ids?: string[];
}

export interface GeneratedClarificationQuestion {
  question_id: string;
  target_object_id: string;
  target_family: string;
  field: string;
  trigger: Exclude<ClarificationTriggerKind, 'internal_representation'>;
  materiality: Materiality;
  question: string;
  phase: ClarificationPhase;
  resolves_object_ids: string[];
}

export interface ClarificationAmendment {
  amendment_id: string;
  target_object_id: string;
  field: string;
  prior_value: unknown;
  new_value: unknown;
  response_text: string;
  created_at: string;
  phase: ClarificationPhase;
  supersedes: string | null;
}

const materialityRank: Record<Materiality, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const weaknessRank: Record<ClarificationTriggerKind, number> = {
  required_bucket_missing: 6,
  actor_attribution: 5,
  causal_link: 4,
  merge_risk: 3,
  evidence_availability: 2,
  date_precision: 1,
  internal_representation: 0,
};

function needsHumanClarification(assessment: EpistemicAssessment): boolean {
  switch (assessment.trigger) {
    case 'internal_representation':
      return false;
    case 'actor_attribution':
      return assessment.actor_attribution !== 'explicit';
    case 'causal_link':
      return assessment.causal_link_status === 'inferred' || assessment.causal_link_status === 'unstated';
    case 'merge_risk':
      return assessment.merge_risk !== undefined && assessment.merge_risk !== 'none';
    case 'evidence_availability':
      return assessment.evidence_availability === 'described_only' || assessment.evidence_availability === 'unknown';
    case 'date_precision':
      return assessment.date_precision === 'unknown';
    case 'required_bucket_missing':
      return true;
  }
}

function questionText(assessment: EpistemicAssessment): string {
  if (assessment.question_hint?.trim()) return assessment.question_hint.trim();
  switch (assessment.trigger) {
    case 'actor_attribution':
      return 'Who performed this action?';
    case 'causal_link':
      return 'Are you saying this event caused the claimed delay or loss?';
    case 'merge_risk':
      return assessment.merge_risk === 'possible_split'
        ? 'Should these statements be treated as one item or as separate items?'
        : 'Were these separate items, or one combined item?';
    case 'evidence_availability':
      return 'Do you currently have this document, message, recording, or other evidence?';
    case 'date_precision':
      return 'Do you remember approximately when this happened?';
    case 'required_bucket_missing':
      return `Please clarify the missing ${assessment.target_family.replaceAll('_', ' ')} information.`;
    case 'internal_representation':
      throw new Error('Internal representation triggers must never become user questions.');
  }
}

function dedupeKey(assessment: EpistemicAssessment): string {
  return [assessment.target_object_id, assessment.field, assessment.trigger].join('|');
}

export function generateClarificationQuestions(
  assessments: EpistemicAssessment[],
  options: { maxQuestions?: number; phase?: ClarificationPhase } = {},
): GeneratedClarificationQuestion[] {
  const maxQuestions = Math.min(Math.max(options.maxQuestions ?? 6, 0), 6);
  const phase = options.phase ?? 'pre_lock';
  const unique = new Map<string, EpistemicAssessment>();

  for (const assessment of assessments) {
    if (!needsHumanClarification(assessment)) continue;
    const key = dedupeKey(assessment);
    const existing = unique.get(key);
    if (!existing || materialityRank[assessment.materiality] > materialityRank[existing.materiality]) {
      unique.set(key, assessment);
    }
  }

  return [...unique.values()]
    .sort((left, right) => {
      const materiality = materialityRank[right.materiality] - materialityRank[left.materiality];
      if (materiality !== 0) return materiality;
      const weakness = weaknessRank[right.trigger] - weaknessRank[left.trigger];
      if (weakness !== 0) return weakness;
      const coverage = (right.resolves_object_ids?.length ?? 1) - (left.resolves_object_ids?.length ?? 1);
      if (coverage !== 0) return coverage;
      return dedupeKey(left).localeCompare(dedupeKey(right));
    })
    .slice(0, maxQuestions)
    .map((assessment, index) => ({
      question_id: `clarification_${String(index + 1).padStart(2, '0')}`,
      target_object_id: assessment.target_object_id,
      target_family: assessment.target_family,
      field: assessment.field,
      trigger: assessment.trigger as Exclude<ClarificationTriggerKind, 'internal_representation'>,
      materiality: assessment.materiality,
      question: questionText(assessment),
      phase,
      resolves_object_ids: assessment.resolves_object_ids?.length
        ? [...new Set(assessment.resolves_object_ids)].sort()
        : [assessment.target_object_id],
    }));
}

export function projectAmendments<T extends Record<string, unknown>>(
  original: T,
  amendments: ClarificationAmendment[],
): T {
  const projected = structuredClone(original);
  const writable = projected as Record<string, unknown>;
  const originalObjectId = original.object_id;
  const ordered = [...amendments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const amendment of ordered) {
    if (amendment.target_object_id !== originalObjectId) continue;
    writable[amendment.field] = structuredClone(amendment.new_value);
  }
  return projected;
}
