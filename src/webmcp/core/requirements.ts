/**
 * Requirement definitions and satisfaction rules.
 *
 * Satisfaction is declared as TYPE + CARDINALITY only. It is never "does this
 * proposition adequately answer the question" — that is a semantic judgement,
 * and if readiness depended on it, readiness would be a model verdict wearing
 * a derived-state costume.
 *
 * Requirement ids are never reused. A clarification that reopens a question
 * gets a NEW id and points back via `reopened_from`. This constraint is
 * load-bearing for idempotency: it is what makes (requirement set + answer
 * text) a sound fingerprint without needing the case version.
 */

import {
  canSatisfyRole,
  isCanonicalId,
  issue,
  type ContractIssue,
  type PropositionType,
} from './types.js';
import type { Proposition } from './propositions.js';

export const REQUIREMENT_CONTRACT_VERSION = 'juryai-webmcp-requirements-v0.2.0';

export interface RequirementDefinition {
  requirement_id: string;
  /** Question text the relay may put to the user. */
  prompt: string;
  /** Exact set of proposition types that satisfy this requirement. */
  satisfying_types: PropositionType[];
  min_propositions: number;
  max_propositions: number | null;
  /**
   * True when this requirement exists to put an adverse fact to the user.
   * Coverage of adverse-fact QUESTIONS ASKED is mechanically checkable;
   * coverage of adverse FACTS is not, and is never claimed.
   */
  adverse_fact_probe: boolean;
  /** Set when this requirement reopens an earlier one. Never the same id. */
  reopened_from: string | null;
}

export interface ClarificationRequest {
  clarification_id: string;
  requirement_id: string;
  prompt: string;
  opened_at_case_version: number;
  resolved_at_case_version: number | null;
  /** The new requirement id created to carry the reopened question, if any. */
  reopened_as: string | null;
}

export type RequirementStatus = 'unsatisfied' | 'satisfied' | 'blocked_by_clarification';

export interface RequirementEvaluation {
  requirement_id: string;
  status: RequirementStatus;
  satisfying_proposition_ids: string[];
  /** Propositions linked to this requirement whose type does not satisfy it. */
  non_satisfying_proposition_ids: string[];
}

export function liveProposition(proposition: Proposition): boolean {
  return proposition.superseded_by === null;
}

export function evaluateRequirement(
  definition: RequirementDefinition,
  propositions: readonly Proposition[],
  clarifications: readonly ClarificationRequest[],
): RequirementEvaluation {
  const linked = propositions.filter(
    (proposition) =>
      proposition.in_reply_to === definition.requirement_id && liveProposition(proposition),
  );
  const satisfying = linked.filter((proposition) =>
    canSatisfyRole(proposition.type, definition.satisfying_types),
  );
  const nonSatisfying = linked.filter(
    (proposition) => !canSatisfyRole(proposition.type, definition.satisfying_types),
  );
  const open = clarifications.some(
    (clarification) =>
      clarification.requirement_id === definition.requirement_id &&
      clarification.resolved_at_case_version === null,
  );

  let status: RequirementStatus;
  if (open) {
    status = 'blocked_by_clarification';
  } else if (
    satisfying.length >= definition.min_propositions &&
    (definition.max_propositions === null || satisfying.length <= definition.max_propositions)
  ) {
    status = 'satisfied';
  } else {
    status = 'unsatisfied';
  }

  return {
    requirement_id: definition.requirement_id,
    status,
    satisfying_proposition_ids: satisfying.map((proposition) => proposition.proposition_id),
    non_satisfying_proposition_ids: nonSatisfying.map((proposition) => proposition.proposition_id),
  };
}

export interface ReadinessReport {
  ready: boolean;
  unresolved_requirement_ids: string[];
  open_clarification_ids: string[];
  /** Adverse-fact QUESTIONS that have not been put to the user and answered. */
  unanswered_adverse_probe_ids: string[];
  evaluations: RequirementEvaluation[];
}

/**
 * Readiness is derived, never stored, and never exposed to the relay as a
 * score. A percentage would hand an untrusted component a completion gradient
 * with no accompanying truth gradient.
 */
export function deriveReadiness(
  definitions: readonly RequirementDefinition[],
  propositions: readonly Proposition[],
  clarifications: readonly ClarificationRequest[],
): ReadinessReport {
  const evaluations = definitions.map((definition) =>
    evaluateRequirement(definition, propositions, clarifications),
  );
  const unresolved = evaluations
    .filter((evaluation) => evaluation.status !== 'satisfied')
    .map((evaluation) => evaluation.requirement_id);
  const openClarifications = clarifications
    .filter((clarification) => clarification.resolved_at_case_version === null)
    .map((clarification) => clarification.clarification_id);
  const satisfied = new Set(
    evaluations
      .filter((evaluation) => evaluation.status === 'satisfied')
      .map((evaluation) => evaluation.requirement_id),
  );
  const unansweredProbes = definitions
    .filter(
      (definition) => definition.adverse_fact_probe && !satisfied.has(definition.requirement_id),
    )
    .map((definition) => definition.requirement_id);

  return {
    ready: unresolved.length === 0 && openClarifications.length === 0,
    unresolved_requirement_ids: unresolved,
    open_clarification_ids: openClarifications,
    unanswered_adverse_probe_ids: unansweredProbes,
    evaluations,
  };
}

export function validateRequirementSet(
  definitions: readonly RequirementDefinition[],
  path: string,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const seen = new Set<string>();
  for (const [index, definition] of definitions.entries()) {
    const at = path + '[' + String(index) + ']';
    if (!isCanonicalId(definition.requirement_id)) {
      issues.push(
        issue(
          'requirement_id_invalid',
          at + '.requirement_id',
          'requirement_id is not a canonical id.',
        ),
      );
    }
    if (seen.has(definition.requirement_id)) {
      issues.push(
        issue(
          'requirement_id_reused',
          at + '.requirement_id',
          "Requirement ids are never reused; '" + definition.requirement_id + "' appears twice.",
        ),
      );
    }
    seen.add(definition.requirement_id);
    if (definition.satisfying_types.length === 0) {
      issues.push(
        issue(
          'requirement_no_satisfying_types',
          at + '.satisfying_types',
          'A requirement must declare at least one satisfying proposition type.',
        ),
      );
    }
    if (!Number.isInteger(definition.min_propositions) || definition.min_propositions < 1) {
      issues.push(
        issue(
          'requirement_min_invalid',
          at + '.min_propositions',
          'min_propositions must be a positive integer.',
        ),
      );
    }
    if (
      definition.max_propositions !== null &&
      definition.max_propositions < definition.min_propositions
    ) {
      issues.push(
        issue(
          'requirement_max_below_min',
          at + '.max_propositions',
          'max_propositions must be null or at least min_propositions.',
        ),
      );
    }
    if (definition.reopened_from !== null) {
      if (definition.reopened_from === definition.requirement_id) {
        issues.push(
          issue(
            'requirement_reopen_same_id',
            at + '.reopened_from',
            'A reopened requirement must carry a new id, not the id it reopens.',
          ),
        );
      }
      if (!definitions.some((other) => other.requirement_id === definition.reopened_from)) {
        issues.push(
          issue(
            'requirement_reopen_unknown',
            at + '.reopened_from',
            "reopened_from refers to unknown requirement '" + definition.reopened_from + "'.",
          ),
        );
      }
    }
  }
  return issues;
}
