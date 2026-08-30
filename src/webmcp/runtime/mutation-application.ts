/**
 * Server-side application of compiler output to canonical state.
 *
 * The compiler proposes; this module disposes. Nothing the compiler returns is
 * written through: ids are minted here, supersession is applied here,
 * clarifications are opened and resolved here, and provenance is copied from
 * the SOURCE TURN rather than from anything the compiler said about it.
 *
 * The guards below fail the whole submission rather than repairing it. A
 * compiler that proposes two live statements of the same type against the same
 * requirement, or that claims verified document content with no inspected
 * evidence behind it, has produced output the record cannot honestly absorb;
 * partially applying it would leave canonical state asserting something no
 * component actually stands behind.
 */

import { issue, propositionTypeDescriptor, type ContractIssue } from '../core/types.js';
import type { CaseState } from '../core/attestation.js';
import type { CompilerOutput } from '../core/compiler-contract.js';
import { applySupersession, type Proposition } from '../core/propositions.js';
import type { ClarificationRequest } from '../core/requirements.js';
import type { SourceTurnRecord } from '../core/turns.js';
import type { RuntimeIdFactory } from './ids.js';

export interface MutationInput {
  /** Canonical state BEFORE this turn's mutation. */
  state: CaseState;
  /** The immutable source turn this compile run was given. */
  turn: SourceTurnRecord;
  output: CompilerOutput;
  /** Version the resulting canonical objects are stamped with. */
  next_case_version: number;
  ids: RuntimeIdFactory;
}

export interface AppliedMutation {
  propositions: Proposition[];
  clarifications: ClarificationRequest[];
  accepted_proposition_ids: string[];
  superseded_proposition_ids: string[];
  opened_clarification_ids: string[];
  resolved_clarification_ids: string[];
  /** True when the canonical projection actually changed. Drives versioning. */
  changed: boolean;
}

export type MutationResult =
  { ok: true; mutation: AppliedMutation } | { ok: false; issues: ContractIssue[] };

export function applyCompilerOutput(input: MutationInput): MutationResult {
  const { state, turn, output, next_case_version: version, ids } = input;
  const issues: ContractIssue[] = [];

  const liveById = new Map(
    state.propositions
      .filter((proposition) => proposition.superseded_by === null)
      .map((proposition) => [proposition.proposition_id, proposition]),
  );

  const created: Proposition[] = [];
  const supersessions: Array<{ superseding: string; superseded: string }> = [];
  const claimedSlots = new Set<string>();
  const claimedTargets = new Set<string>();

  for (const [index, assertion] of output.assertions.entries()) {
    const at = 'compiler_output.assertions[' + String(index) + ']';

    const descriptor = propositionTypeDescriptor(assertion.proposed_type);
    if (descriptor.requires_inspected_evidence) {
      // V0 WebMCP carries evidence REFERENCES only; nothing relayed through it
      // has been inspected, so this type can never be honestly produced here.
      issues.push(
        issue(
          'mutation_requires_inspected_evidence',
          at + '.proposed_type',
          "Type '" +
            assertion.proposed_type +
            "' requires inspected evidence, which a relayed turn cannot supply.",
        ),
      );
      continue;
    }

    const slot = assertion.requirement_id + '|' + assertion.proposed_type;
    if (claimedSlots.has(slot)) {
      // Two statements of one type against one requirement, created at the same
      // version, would sit outside the collision invariant's strict version
      // comparison and stay live and contradictory.
      issues.push(
        issue(
          'mutation_duplicate_requirement_type',
          at,
          "A single compile run proposed two '" +
            assertion.proposed_type +
            "' statements for requirement '" +
            assertion.requirement_id +
            "'.",
        ),
      );
      continue;
    }
    claimedSlots.add(slot);

    if (assertion.supersedes_candidate !== null) {
      const target = liveById.get(assertion.supersedes_candidate);
      if (!target) {
        issues.push(
          issue(
            'mutation_supersedes_not_live',
            at + '.supersedes_candidate',
            "supersedes_candidate '" +
              assertion.supersedes_candidate +
              "' is not a live proposition on this case.",
          ),
        );
        continue;
      }
      if (target.in_reply_to !== assertion.requirement_id) {
        issues.push(
          issue(
            'mutation_supersedes_other_requirement',
            at + '.supersedes_candidate',
            'A statement may only supersede one answering the same requirement.',
          ),
        );
        continue;
      }
      if (claimedTargets.has(assertion.supersedes_candidate)) {
        issues.push(
          issue(
            'mutation_supersedes_target_reused',
            at + '.supersedes_candidate',
            'Supersession chains are single; one proposition cannot be superseded twice.',
          ),
        );
        continue;
      }
      claimedTargets.add(assertion.supersedes_candidate);
    }

    const propositionId = ids.propositionId();
    created.push({
      proposition_id: propositionId,
      case_id: state.case_id,
      type: assertion.proposed_type,
      epistemic_strength: assertion.epistemic_strength,
      statement: assertion.statement,
      in_reply_to: assertion.requirement_id,
      derived_from_turn_ids: [turn.turn_id],
      spans: structuredClone(assertion.spans),
      // Provenance comes from the turn, never from the compiler's account of it.
      source_channel: turn.source_channel,
      relaying_agent: turn.relaying_agent,
      supersedes: null,
      superseded_by: null,
      superseded_at_case_version: null,
      created_at_case_version: version,
      compile_run_id: output.compile_run_id,
      compiler_version_id: output.compiler_version_id,
      // V0 has no evidence-linked assertion channel; types that would require
      // one were already refused above.
      evidence_ref_id: null,
    });
    if (assertion.supersedes_candidate !== null) {
      supersessions.push({
        superseding: propositionId,
        superseded: assertion.supersedes_candidate,
      });
    }
  }

  // Clarification prompts are rendered back to the relay through the core's
  // agent-facing wrapper. A prompt that is not a non-empty string survives the
  // compiler contract check, commits, and then throws every time the case is
  // projected — durable poisoned state. It is refused here, and never repaired:
  // coercing `undefined` to '' or a number to its digits would put a question
  // in the record that no component actually asked.
  const knownRequirementIds = new Set(
    state.requirements.map((definition) => definition.requirement_id),
  );
  for (const [index, request] of output.clarifications_requested.entries()) {
    const at = 'compiler_output.clarifications_requested[' + String(index) + ']';
    if (typeof request !== 'object' || request === null) {
      issues.push(issue('mutation_clarification_malformed', at, 'Clarification is not an object.'));
      continue;
    }
    if (typeof request.prompt !== 'string' || request.prompt.trim().length === 0) {
      issues.push(
        issue(
          'mutation_clarification_prompt_invalid',
          at + '.prompt',
          'A clarification prompt must be a non-empty string.',
        ),
      );
    }
    if (!knownRequirementIds.has(request.requirement_id)) {
      issues.push(
        issue(
          'mutation_clarification_requirement_unknown',
          at + '.requirement_id',
          'Clarification names a requirement this case does not have.',
        ),
      );
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  let propositions: Proposition[] = [...state.propositions, ...created];
  for (const link of supersessions) {
    try {
      propositions = applySupersession(propositions, {
        superseding_proposition_id: link.superseding,
        superseded_proposition_id: link.superseded,
        // Not persisted in canonical state. An accepted assertion carrying a
        // supersedes_candidate is, by the compiler contract, a claim that the
        // earlier statement is replaced; anything less certain must have been
        // emitted as `ambiguous` and become a clarification instead.
        kind: 'correction',
        source_turn_id: turn.turn_id,
        at_case_version: version,
      });
    } catch (error) {
      return {
        ok: false,
        issues: [
          issue(
            'mutation_supersession_rejected',
            'compiler_output.assertions',
            error instanceof Error ? error.message : 'Supersession could not be applied.',
          ),
        ],
      };
    }
  }

  /* --- clarifications ---------------------------------------------------- */

  // A requirement that this turn answered canonically no longer has an open
  // question, and does not acquire a new one. Resolution is driven by what was
  // RECORDED, not by the relay saying it answered.
  const answered = new Set(created.map((proposition) => proposition.in_reply_to));

  const openRequirementIds = new Set(
    state.clarifications
      .filter((clarification) => clarification.resolved_at_case_version === null)
      .map((clarification) => clarification.requirement_id),
  );
  const opened: ClarificationRequest[] = [];
  for (const request of output.clarifications_requested) {
    // One open clarification per requirement. A second is not a second
    // question, it is the same question asked twice.
    if (openRequirementIds.has(request.requirement_id)) continue;
    if (answered.has(request.requirement_id)) continue;
    openRequirementIds.add(request.requirement_id);
    opened.push({
      clarification_id: ids.clarificationId(),
      requirement_id: request.requirement_id,
      prompt: request.prompt,
      opened_at_case_version: version,
      resolved_at_case_version: null,
      reopened_as: null,
    });
  }

  const resolvedIds: string[] = [];
  const clarifications = [...state.clarifications, ...opened].map((clarification) => {
    if (
      clarification.resolved_at_case_version === null &&
      answered.has(clarification.requirement_id)
    ) {
      resolvedIds.push(clarification.clarification_id);
      return { ...clarification, resolved_at_case_version: version };
    }
    return clarification;
  });

  return {
    ok: true,
    mutation: {
      propositions,
      clarifications,
      accepted_proposition_ids: created.map((proposition) => proposition.proposition_id),
      superseded_proposition_ids: supersessions.map((link) => link.superseded),
      opened_clarification_ids: opened.map((clarification) => clarification.clarification_id),
      resolved_clarification_ids: resolvedIds,
      changed: created.length > 0 || opened.length > 0 || resolvedIds.length > 0,
    },
  };
}
