/**
 * Canonical propositions, supersession and the contradiction invariant.
 *
 * A proposition carries `source_channel` permanently: a statement that reached
 * JuryAI through an external relay is still identified as relayed after a
 * human attests to the completed record. Attestation is the other axis and is
 * DERIVED from the attestation collection, never stored on the proposition,
 * so it cannot drift when an amendment is made.
 */

import {
  describeEpistemicStrength,
  describeSourceChannel,
  isCanonicalId,
  isEpistemicStrength,
  isHash,
  isPropositionType,
  issue,
  propositionTypeDescriptor,
  type AttestationState,
  type ContractIssue,
  type EpistemicStrength,
  type PropositionType,
  type SourceChannel,
} from './types.js';
import type { TurnSpan } from './turns.js';

export const PROPOSITION_CONTRACT_VERSION = 'juryai-webmcp-propositions-v0.2.0';

export interface Proposition {
  proposition_id: string;
  case_id: string;
  type: PropositionType;
  epistemic_strength: EpistemicStrength;
  /** JuryAI's own canonical wording. Never the relay's summary. */
  statement: string;
  in_reply_to: string;
  derived_from_turn_ids: string[];
  spans: TurnSpan[];
  source_channel: SourceChannel;
  /** Self-reported identity of the relaying agent at the time of capture. */
  relaying_agent: string | null;
  supersedes: string | null;
  superseded_by: string | null;
  superseded_at_case_version: number | null;
  created_at_case_version: number;
  /** Individual semantic compilation run that produced this proposition. */
  compile_run_id: string;
  /** Compiler prompt/configuration identity used by that run. */
  compiler_version_id: string;
  evidence_ref_id: string | null;
}

/** Attribution line for the render. Never the word "verbatim" for a relay. */
export function attributionFor(proposition: Proposition): string {
  return (
    describeSourceChannel(proposition.source_channel, proposition.relaying_agent) +
    '; ' +
    describeEpistemicStrength(proposition.epistemic_strength)
  );
}

/* ------------------------------------------------------------------------ */
/* Supersession                                                              */
/* ------------------------------------------------------------------------ */

/**
 * How a later statement relates to an earlier one. Only the human can reliably
 * tell these apart, so the compiler proposes and ambiguity fails closed.
 */
export type ContradictionKind = 'correction' | 'refinement' | 'genuine_inconsistency';

export interface SupersessionLink {
  superseding_proposition_id: string;
  superseded_proposition_id: string;
  kind: ContradictionKind;
  /** Turn that carried the superseding statement. */
  source_turn_id: string;
  at_case_version: number;
}

/**
 * Applies a supersession without deleting anything. A record in which an
 * earlier inconsistent statement silently vanished is a worse artefact than
 * one that shows the correction.
 */
export function applySupersession(
  propositions: readonly Proposition[],
  link: SupersessionLink,
): Proposition[] {
  const target = propositions.find(
    (proposition) => proposition.proposition_id === link.superseded_proposition_id,
  );
  if (!target) {
    throw new TypeError(
      "Cannot supersede unknown proposition '" + link.superseded_proposition_id + "'.",
    );
  }
  if (target.superseded_by !== null) {
    throw new TypeError(
      "Proposition '" + target.proposition_id + "' is already superseded; chains are single.",
    );
  }
  if (link.superseding_proposition_id === link.superseded_proposition_id) {
    throw new TypeError('A proposition cannot supersede itself.');
  }
  return propositions.map((proposition) => {
    if (proposition.proposition_id === link.superseded_proposition_id) {
      return {
        ...proposition,
        superseded_by: link.superseding_proposition_id,
        superseded_at_case_version: link.at_case_version,
      };
    }
    if (proposition.proposition_id === link.superseding_proposition_id) {
      return { ...proposition, supersedes: link.superseded_proposition_id };
    }
    return proposition;
  });
}

export function livePropositions(propositions: readonly Proposition[]): Proposition[] {
  return propositions.filter((proposition) => proposition.superseded_by === null);
}

export function supersessionChain(
  propositions: readonly Proposition[],
  propositionId: string,
): Proposition[] {
  const byId = new Map(propositions.map((p) => [p.proposition_id, p]));
  const chain: Proposition[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(propositionId);
  while (cursor && !seen.has(cursor.proposition_id)) {
    seen.add(cursor.proposition_id);
    chain.push(cursor);
    cursor = cursor.supersedes === null ? undefined : byId.get(cursor.supersedes);
  }
  return chain;
}

/* ------------------------------------------------------------------------ */
/* Contradiction invariant                                                   */
/* ------------------------------------------------------------------------ */

export interface CollisionFinding {
  new_proposition_id: string;
  colliding_proposition_id: string;
  requirement_id: string;
  type: PropositionType;
}

/**
 * Structural backstop for a semantic miss: any new proposition that collides
 * on (requirement, type) with a live proposition must carry either a
 * supersession link or an open clarification. Without this, a compiler that
 * misjudges a contradiction leaves two live contradictory statements and
 * readiness may still compute true.
 */
export function findUnresolvedCollisions(
  propositions: readonly Proposition[],
  openClarificationRequirementIds: ReadonlySet<string>,
): CollisionFinding[] {
  const findings: CollisionFinding[] = [];
  const live = livePropositions(propositions);
  for (const candidate of live) {
    if (openClarificationRequirementIds.has(candidate.in_reply_to)) continue;
    for (const other of live) {
      if (other.proposition_id === candidate.proposition_id) continue;
      if (other.in_reply_to !== candidate.in_reply_to) continue;
      if (other.type !== candidate.type) continue;
      if (candidate.created_at_case_version <= other.created_at_case_version) continue;
      if (candidate.supersedes === other.proposition_id) continue;
      findings.push({
        new_proposition_id: candidate.proposition_id,
        colliding_proposition_id: other.proposition_id,
        requirement_id: candidate.in_reply_to,
        type: candidate.type,
      });
    }
  }
  return findings;
}

/* ------------------------------------------------------------------------ */
/* Derived attestation                                                       */
/* ------------------------------------------------------------------------ */

export interface AttestedVersionMarker {
  case_version: number;
}

/**
 * A proposition is attested when it was live at a case version a human
 * attested to. Derived, so an amendment cannot leave a stale flag behind.
 */
export function derivePropositionAttestation(
  proposition: Proposition,
  attestedVersions: readonly AttestedVersionMarker[],
): AttestationState {
  const attested = attestedVersions.some((marker) => {
    if (marker.case_version < proposition.created_at_case_version) return false;
    if (proposition.superseded_at_case_version === null) return true;
    return marker.case_version < proposition.superseded_at_case_version;
  });
  return attested ? 'human_attested' : 'unattested';
}

export function validateProposition(proposition: Proposition, path: string): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (!isCanonicalId(proposition.proposition_id)) {
    issues.push(
      issue(
        'proposition_id_invalid',
        path + '.proposition_id',
        'proposition_id is not a canonical id.',
      ),
    );
  }
  if (!isPropositionType(proposition.type)) {
    issues.push(
      issue(
        'proposition_type_unknown',
        path + '.type',
        'type is not a canonical proposition type.',
      ),
    );
    return issues;
  }
  if (!isEpistemicStrength(proposition.epistemic_strength)) {
    issues.push(
      issue(
        'proposition_strength_unknown',
        path + '.epistemic_strength',
        'epistemic_strength is not in the canonical enum.',
      ),
    );
  }
  const descriptor = propositionTypeDescriptor(proposition.type);
  if (descriptor.is_non_answer) {
    const expected: EpistemicStrength =
      proposition.type === 'non_recollection' ? 'non_recollection' : 'declined';
    if (proposition.epistemic_strength !== expected) {
      issues.push(
        issue(
          'proposition_non_answer_strength_mismatch',
          path + '.epistemic_strength',
          "A '" + proposition.type + "' proposition must carry strength '" + expected + "'.",
        ),
      );
    }
  }
  if (proposition.statement.trim().length === 0) {
    issues.push(
      issue(
        'proposition_statement_empty',
        path + '.statement',
        'statement must carry JuryAI canonical wording.',
      ),
    );
  }
  if (proposition.derived_from_turn_ids.length === 0) {
    issues.push(
      issue(
        'proposition_without_source',
        path + '.derived_from_turn_ids',
        'Every proposition must name at least one source turn.',
      ),
    );
  }
  if (proposition.compile_run_id.trim().length === 0) {
    issues.push(
      issue(
        'proposition_compile_run_missing',
        path + '.compile_run_id',
        'Every derived proposition must record the compile run that produced it.',
      ),
    );
  }
  if (!isHash(proposition.compiler_version_id)) {
    issues.push(
      issue(
        'proposition_compiler_version_invalid',
        path + '.compiler_version_id',
        'Every derived proposition must record a sha256 compiler version id.',
      ),
    );
  }
  if (proposition.superseded_by !== null && proposition.superseded_at_case_version === null) {
    issues.push(
      issue(
        'proposition_supersession_version_missing',
        path + '.superseded_at_case_version',
        'A superseded proposition must record the version at which it was superseded.',
      ),
    );
  }
  if (proposition.supersedes === proposition.proposition_id) {
    issues.push(
      issue(
        'proposition_self_supersession',
        path + '.supersedes',
        'A proposition cannot supersede itself.',
      ),
    );
  }
  return issues;
}
