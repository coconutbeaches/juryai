/**
 * Readiness patterns proving THIS generation's contract pairings exist.
 *
 * A contract-pair constraint permanently carries every historical branch, so a
 * readiness probe built from independent substring searches proves nothing: an
 * older branch can supply one literal while the current branch supplies
 * another, and the probe passes even when this generation's own pairing is
 * absent or wrong. A cross-paired migration then passes readiness and fails at
 * write time instead.
 *
 * Matching version literals alone is not enough either. Literals in the right
 * order but compared to the WRONG columns still describe a constraint every
 * V2.1.4 write violates, so each literal is anchored to the column or JSON path
 * it must be compared against:
 *
 *   - between a column and its own literal, no `AND` may intervene, which keeps
 *     the pair inside one comparison;
 *   - between successive pairs, no `OR` may intervene, which keeps every pair
 *     inside one branch.
 *
 * `pg_get_constraintdef` renders a branch's conditions in the order the
 * migration wrote them, so the pairs below mirror the migration. That makes the
 * check order-sensitive, which fails closed: reordering the migration breaks
 * readiness loudly rather than silently weakening it.
 */

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** A column (or JSON path) and the exact literal it must be compared against. */
export type ReadinessBindingV214 = readonly [column: string, literal: string];

export function sameOrBranchPatternV214(bindings: readonly ReadinessBindingV214[]): string {
  return bindings
    .map(([column, literal]) => `${escapeRegex(column)}(?:(?!AND).)*${escapeRegex(literal)}`)
    .join('(?:(?!OR).)*');
}

/** formation_disputes_contract_pair_v212 — the full current-generation combination. */
export const V214_CONTRACT_PAIR_READINESS_PATTERN = sameOrBranchPatternV214([
  ['schema_version', 'juryai-case-envelope-v2.1.4'],
  ['protocol_version', 'juryai-formation-protocol-v2.1.4'],
  ['command_contract_version', 'juryai-envelope-command-v2.1.4'],
  ['readiness_contract_version', 'juryai-formation-readiness-v2.1.4'],
  ['projection_contract_version', 'juryai-party-formation-projection-v2.1.4'],
  ['external_submission_contract_version', 'juryai-external-relay-submission-v2.1.4'],
]);

/** formation_disputes_external_submission_v211 — envelope ↔ relay-submission. */
export const V214_EXTERNAL_SUBMISSION_READINESS_PATTERN = sameOrBranchPatternV214([
  ['schema_version', 'juryai-case-envelope-v2.1.4'],
  ['external_submission_contract_version', 'juryai-external-relay-submission-v2.1.4'],
]);

/** formation_assurance_challenges_payload_binding — protected action ↔ command. */
export const V214_PROTECTED_ACTION_READINESS_PATTERN = sameOrBranchPatternV214([
  ['protected_action_version', 'juryai-party-review-protected-action-v1.3.0'],
  ['ceremony_command,command_version', 'juryai-envelope-command-v2.1.4'],
]);
