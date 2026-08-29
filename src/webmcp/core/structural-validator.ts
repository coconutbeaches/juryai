/**
 * The structural validator.
 *
 * Renamed from "deterministic validator" deliberately. It verifies invariants
 * that are mechanically decidable: schema shape, id integrity, graph
 * consistency, span substring equality, type-role membership, locked-state
 * immutability and attestation binding.
 *
 * It does NOT verify meaning. Whether "basically what I expected" is a
 * `target_date` rather than a `contractual_deadline`, and whether that answer
 * is `recalled_uncertain` rather than `asserted_confident`, are semantic
 * classifications. They live in the compiler, and the human attestation is
 * what stands behind them. Nothing in this file should ever be cited as
 * evidence that meaning was checked.
 */

import {
  canSatisfyRole,
  isCanonicalId,
  isHash,
  issue,
  NON_COERCIBLE_TYPE_PAIRS,
  propositionTypeDescriptor,
  type ContractIssue,
} from './types.js';
import {
  deriveCaseStatus,
  hashCanonicalState,
  renderCanonicalAccount,
  validateAttestationRecord,
  type CaseState,
} from './attestation.js';
import { findUnresolvedCollisions, validateProposition, type Proposition } from './propositions.js';
import { deriveReadiness, validateRequirementSet } from './requirements.js';
import { validateSourceTurnRecord, verifyTurnSpan } from './turns.js';

export interface StructuralValidationReport {
  validator_version: string;
  ok: boolean;
  issues: ContractIssue[];
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes].sort();
}

export function validateCaseState(state: CaseState): StructuralValidationReport {
  const issues: ContractIssue[] = [];

  /* --- identity and disclosure ------------------------------------------ */
  if (!isCanonicalId(state.case_id)) {
    issues.push(issue('case_id_invalid', 'case_id', 'case_id is not a canonical id.'));
  }
  if (!Number.isInteger(state.case_version) || state.case_version < 0) {
    issues.push(
      issue('case_version_invalid', 'case_version', 'case_version must be a non-negative integer.'),
    );
  }
  if (state.disclosure_version.trim().length === 0) {
    issues.push(
      issue(
        'case_disclosure_missing',
        'disclosure_version',
        'A case must record the disclosure the principal accepted at creation.',
      ),
    );
  }
  if (Number.isNaN(Date.parse(state.disclosure_accepted_at))) {
    issues.push(
      issue(
        'case_disclosure_timestamp_invalid',
        'disclosure_accepted_at',
        'disclosure_accepted_at must be an ISO date.',
      ),
    );
  }

  /* --- id uniqueness ----------------------------------------------------- */
  for (const [label, ids] of [
    ['turn_log', state.turn_log.map((turn) => turn.turn_id)],
    ['propositions', state.propositions.map((p) => p.proposition_id)],
    ['requirements', state.requirements.map((r) => r.requirement_id)],
    ['clarifications', state.clarifications.map((c) => c.clarification_id)],
    ['attestations', state.attestations.map((a) => a.attestation_id)],
    ['evidence_references', state.evidence_references.map((e) => e.evidence_ref_id)],
  ] as const) {
    for (const duplicate of duplicates(ids)) {
      issues.push(
        issue('duplicate_id', label, "Duplicate id '" + duplicate + "' in " + label + '.'),
      );
    }
  }
  const clientTurnIds = state.turn_log
    .map((turn) => turn.client_turn_id)
    .filter((value): value is string => value !== null);
  for (const duplicate of duplicates(clientTurnIds)) {
    issues.push(
      issue(
        'duplicate_client_turn_id',
        'turn_log',
        "client_turn_id '" + duplicate + "' appears more than once.",
      ),
    );
  }

  /* --- turns ------------------------------------------------------------- */
  for (const [index, turn] of state.turn_log.entries()) {
    const path = 'turn_log[' + String(index) + ']';
    issues.push(...validateSourceTurnRecord(turn, path));
    if (turn.case_id !== state.case_id) {
      issues.push(issue('turn_foreign_case', path + '.case_id', 'Turn belongs to another case.'));
    }
    if (turn.request_fingerprint.length > 0 && !isHash(turn.request_fingerprint)) {
      issues.push(
        issue(
          'turn_fingerprint_invalid',
          path + '.request_fingerprint',
          'request_fingerprint must be a sha256 hex digest.',
        ),
      );
    }
  }

  /* --- requirements ------------------------------------------------------ */
  issues.push(...validateRequirementSet(state.requirements, 'requirements'));
  const requirementById = new Map(
    state.requirements.map((definition) => [definition.requirement_id, definition]),
  );
  const turnById = new Map(state.turn_log.map((turn) => [turn.turn_id, turn]));
  const evidenceById = new Map(
    state.evidence_references.map((reference) => [reference.evidence_ref_id, reference]),
  );
  const propositionById = new Map(
    state.propositions.map((proposition) => [proposition.proposition_id, proposition]),
  );

  /* --- evidence references ---------------------------------------------- */
  for (const [index, reference] of state.evidence_references.entries()) {
    if (reference.case_id !== state.case_id) {
      issues.push(
        issue(
          'evidence_foreign_case',
          'evidence_references[' + String(index) + '].case_id',
          'Evidence reference belongs to another case.',
        ),
      );
    }
  }

  /* --- propositions ------------------------------------------------------ */
  for (const [index, proposition] of state.propositions.entries()) {
    const path = 'propositions[' + String(index) + ']';
    issues.push(...validateProposition(proposition, path));
    if (proposition.case_id !== state.case_id) {
      issues.push(
        issue(
          'proposition_foreign_case',
          path + '.case_id',
          'Proposition belongs to another case.',
        ),
      );
    }

    const definition = requirementById.get(proposition.in_reply_to);
    if (!definition) {
      issues.push(
        issue(
          'proposition_requirement_unknown',
          path + '.in_reply_to',
          "Proposition answers unknown requirement '" + proposition.in_reply_to + "'.",
        ),
      );
    } else if (!canSatisfyRole(proposition.type, definition.satisfying_types)) {
      issues.push(
        issue(
          'proposition_type_role_mismatch',
          path + '.type',
          "Type '" +
            proposition.type +
            "' cannot satisfy requirement '" +
            definition.requirement_id +
            "'.",
        ),
      );
    }

    for (const turnId of proposition.derived_from_turn_ids) {
      const sourceTurn = turnById.get(turnId);
      if (!sourceTurn) {
        issues.push(
          issue(
            'proposition_source_turn_unknown',
            path + '.derived_from_turn_ids',
            "Proposition names unknown source turn '" + turnId + "'.",
          ),
        );
        continue;
      }
      if (proposition.source_channel !== sourceTurn.source_channel) {
        issues.push(
          issue(
            'proposition_source_channel_mismatch',
            path + '.source_channel',
            "Proposition source_channel does not match source turn '" + turnId + "'.",
          ),
        );
      }
      if (proposition.relaying_agent !== sourceTurn.relaying_agent) {
        issues.push(
          issue(
            'proposition_relaying_agent_mismatch',
            path + '.relaying_agent',
            "Proposition relaying_agent does not match source turn '" + turnId + "'.",
          ),
        );
      }
    }

    for (const [spanIndex, span] of proposition.spans.entries()) {
      const spanPath = path + '.spans[' + String(spanIndex) + ']';
      const turn = turnById.get(span.turn_id);
      if (!turn) {
        issues.push(
          issue('span_turn_unknown', spanPath + '.turn_id', 'Span addresses an unknown turn.'),
        );
        continue;
      }
      if (!proposition.derived_from_turn_ids.includes(span.turn_id)) {
        issues.push(
          issue(
            'span_turn_not_a_source',
            spanPath + '.turn_id',
            'Span addresses a turn this proposition does not name as a source.',
          ),
        );
      }
      issues.push(...verifyTurnSpan(turn.payload, span, spanPath).issues);
    }

    const descriptor = propositionTypeDescriptor(proposition.type);
    if (descriptor.requires_inspected_evidence) {
      const reference =
        proposition.evidence_ref_id === null
          ? undefined
          : evidenceById.get(proposition.evidence_ref_id);
      if (!reference) {
        issues.push(
          issue(
            'proposition_evidence_missing',
            path + '.evidence_ref_id',
            "Type '" + proposition.type + "' requires an evidence reference.",
          ),
        );
      } else if (reference.case_id !== state.case_id) {
        issues.push(
          issue(
            'proposition_evidence_foreign_case',
            path + '.evidence_ref_id',
            'Foreign-case evidence cannot satisfy verified document content.',
          ),
        );
      } else if (reference.inspection_status !== 'inspected') {
        issues.push(
          issue(
            'proposition_evidence_uninspected',
            path + '.evidence_ref_id',
            'Uninspected evidence can never yield a verified document-content proposition.',
          ),
        );
      }
    }

    if (proposition.supersedes !== null) {
      const target = propositionById.get(proposition.supersedes);
      if (!target) {
        issues.push(
          issue(
            'supersession_target_unknown',
            path + '.supersedes',
            'supersedes names an unknown proposition.',
          ),
        );
      } else {
        if (target.superseded_by !== proposition.proposition_id) {
          issues.push(
            issue(
              'supersession_not_bidirectional',
              path + '.supersedes',
              'Superseded proposition does not link back to its successor.',
            ),
          );
        }
        if (target.in_reply_to !== proposition.in_reply_to) {
          issues.push(
            issue(
              'supersession_requirement_mismatch',
              path + '.supersedes',
              'A proposition may only supersede one answering the same requirement.',
            ),
          );
        }
      }
    }
    if (proposition.superseded_by !== null) {
      const successor = propositionById.get(proposition.superseded_by);
      if (!successor) {
        issues.push(
          issue(
            'supersession_successor_unknown',
            path + '.superseded_by',
            'superseded_by names an unknown proposition.',
          ),
        );
      } else if (successor.supersedes !== proposition.proposition_id) {
        issues.push(
          issue(
            'supersession_not_bidirectional',
            path + '.superseded_by',
            'Successor does not link back to the proposition it supersedes.',
          ),
        );
      }
    }
  }

  issues.push(...detectSupersessionCycles(state.propositions));

  /* --- non-coercible type pairs ------------------------------------------ */
  for (const definition of state.requirements) {
    for (const [weaker, stronger] of NON_COERCIBLE_TYPE_PAIRS) {
      if (
        definition.satisfying_types.includes(stronger) &&
        definition.satisfying_types.includes(weaker)
      ) {
        issues.push(
          issue(
            'requirement_collapses_type_pair',
            'requirements.' + definition.requirement_id + '.satisfying_types',
            "A requirement must not accept both '" +
              weaker +
              "' and '" +
              stronger +
              "'; that collapses a distinction the schema exists to preserve.",
          ),
        );
      }
    }
  }

  /* --- contradiction invariant ------------------------------------------- */
  const openClarificationRequirements = new Set(
    state.clarifications
      .filter((clarification) => clarification.resolved_at_case_version === null)
      .map((clarification) => clarification.requirement_id),
  );
  for (const finding of findUnresolvedCollisions(
    state.propositions,
    openClarificationRequirements,
  )) {
    issues.push(
      issue(
        'unresolved_contradiction',
        'propositions.' + finding.new_proposition_id,
        "Collides with live proposition '" +
          finding.colliding_proposition_id +
          "' on requirement '" +
          finding.requirement_id +
          "' without a supersession link or an open clarification.",
      ),
    );
  }

  /* --- clarifications ----------------------------------------------------- */
  for (const [index, clarification] of state.clarifications.entries()) {
    const path = 'clarifications[' + String(index) + ']';
    if (!requirementById.has(clarification.requirement_id)) {
      issues.push(
        issue(
          'clarification_requirement_unknown',
          path + '.requirement_id',
          'Clarification names an unknown requirement.',
        ),
      );
    }
    if (clarification.reopened_as !== null && !requirementById.has(clarification.reopened_as)) {
      issues.push(
        issue(
          'clarification_reopen_unknown',
          path + '.reopened_as',
          'reopened_as names a requirement that does not exist.',
        ),
      );
    }
    if (clarification.reopened_as === clarification.requirement_id) {
      issues.push(
        issue(
          'clarification_reopen_same_id',
          path + '.reopened_as',
          'A reopened question must be carried by a new requirement id.',
        ),
      );
    }
  }

  /* --- attestations and locked-state immutability ------------------------ */
  issues.push(...validateAttestations(state));

  return {
    validator_version: 'juryai-structural-validator-v0.2.0',
    ok: issues.length === 0,
    issues,
  };
}

function detectSupersessionCycles(propositions: readonly Proposition[]): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const byId = new Map(propositions.map((p) => [p.proposition_id, p]));
  for (const proposition of propositions) {
    const seen = new Set<string>([proposition.proposition_id]);
    let cursor = proposition.supersedes === null ? undefined : byId.get(proposition.supersedes);
    while (cursor) {
      if (seen.has(cursor.proposition_id)) {
        issues.push(
          issue(
            'supersession_cycle',
            'propositions.' + proposition.proposition_id,
            'Supersession chain contains a cycle.',
          ),
        );
        break;
      }
      seen.add(cursor.proposition_id);
      cursor = cursor.supersedes === null ? undefined : byId.get(cursor.supersedes);
    }
  }
  return issues;
}

function validateAttestations(state: CaseState): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const turnIds = new Set(state.turn_log.map((turn) => turn.turn_id));
  const commitmentByTurn = new Map(
    state.turn_log.map((turn) => [turn.turn_id, turn.payload_commitment]),
  );
  let highest = -1;

  for (const [index, attestation] of state.attestations.entries()) {
    const path = 'attestations[' + String(index) + ']';
    issues.push(...validateAttestationRecord(attestation, path));
    if (attestation.case_id !== state.case_id) {
      issues.push(
        issue(
          'attestation_foreign_case',
          path + '.case_id',
          'Attestation belongs to another case.',
        ),
      );
    }
    if (attestation.principal_id !== state.principal_id) {
      issues.push(
        issue(
          'attestation_principal_mismatch',
          path + '.principal_id',
          'Attestation principal does not match the case principal.',
        ),
      );
    }
    if (attestation.case_version > state.case_version) {
      issues.push(
        issue(
          'attestation_future_version',
          path + '.case_version',
          'An attestation cannot bind a case version that does not exist yet.',
        ),
      );
    }
    if (attestation.case_version < highest) {
      issues.push(
        issue(
          'attestation_version_regression',
          path + '.case_version',
          'Attestations are append-only and must not regress in case_version.',
        ),
      );
    }
    highest = Math.max(highest, attestation.case_version);

    for (const [turnIndex, turnId] of attestation.source_turn_ids.entries()) {
      if (!turnIds.has(turnId)) {
        issues.push(
          issue(
            'attestation_source_turn_unknown',
            path + '.source_turn_ids',
            "Attestation names unknown source turn '" + turnId + "'.",
          ),
        );
        continue;
      }
      const expected = commitmentByTurn.get(turnId);
      if (expected !== undefined && attestation.source_turn_commitments[turnIndex] !== expected) {
        issues.push(
          issue(
            'attestation_commitment_mismatch',
            path + '.source_turn_commitments[' + String(turnIndex) + ']',
            'Attested commitment does not match the stored turn commitment.',
          ),
        );
      }
    }

    if (attestation.case_version === state.case_version) {
      const currentTurnIds = state.turn_log.map((turn) => turn.turn_id);
      const currentTurnCommitments = state.turn_log.map((turn) => turn.payload_commitment);
      const sourceTurnsMatch =
        attestation.source_turn_ids.length === currentTurnIds.length &&
        attestation.source_turn_ids.every(
          (turnId, turnIndex) => turnId === currentTurnIds[turnIndex],
        ) &&
        attestation.source_turn_commitments.length === currentTurnCommitments.length &&
        attestation.source_turn_commitments.every(
          (commitment, turnIndex) => commitment === currentTurnCommitments[turnIndex],
        );
      if (!sourceTurnsMatch) {
        issues.push(
          issue(
            'attestation_source_turns_drift',
            path + '.source_turn_ids',
            'Current source turns and commitments do not exactly match the attested append order.',
          ),
        );
      }
      const render = renderCanonicalAccount(state);
      if (render.document_hash !== attestation.rendered_document_hash) {
        issues.push(
          issue(
            'attestation_render_drift',
            path + '.rendered_document_hash',
            'Current state no longer renders to the attested document.',
          ),
        );
      }
      if (hashCanonicalState(state) !== attestation.canonical_state_hash) {
        issues.push(
          issue(
            'attestation_state_drift',
            path + '.canonical_state_hash',
            'Current state no longer hashes to the attested canonical state.',
          ),
        );
      }
      const readiness = deriveReadiness(
        state.requirements,
        state.propositions,
        state.clarifications,
      );
      if (!readiness.ready) {
        issues.push(
          issue(
            'attestation_over_incomplete_state',
            path,
            'An attested case version must have no unresolved requirements or open clarifications.',
          ),
        );
      }
    }
  }

  /* Locked-state immutability: nothing may be created at a version that a
     human has already attested to, and the attested version must be the
     latest one unless a later amendment raised the case version. */
  if (deriveCaseStatus(state) === 'locked') {
    for (const proposition of state.propositions) {
      if (proposition.created_at_case_version > state.case_version) {
        issues.push(
          issue(
            'locked_state_mutated',
            'propositions.' + proposition.proposition_id,
            'A locked case version cannot contain propositions created after it.',
          ),
        );
      }
    }
  }
  return issues;
}
