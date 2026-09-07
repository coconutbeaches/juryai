import { V215_SPEC } from './generation-spec.js';
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
 * V2.1.5 write violates, so each literal is anchored to the column or JSON path
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
export type ReadinessBindingV215 = readonly [column: string, literal: string];

export function sameOrBranchPatternV215(bindings: readonly ReadinessBindingV215[]): string {
  return bindings
    .map(([column, literal]) => `${escapeRegex(column)}(?:(?!AND).)*${escapeRegex(literal)}`)
    .join('(?:(?!OR).)*');
}

/** formation_disputes_contract_pair_v212 — the full current-generation combination. */
export const V215_CONTRACT_PAIR_READINESS_PATTERN = sameOrBranchPatternV215([
  ['schema_version', V215_SPEC.identity.envelope_schema_version],
  ['protocol_version', V215_SPEC.identity.formation_protocol_version],
  ['command_contract_version', V215_SPEC.contracts.command_version],
  ['readiness_contract_version', V215_SPEC.contracts.readiness_version],
  ['projection_contract_version', V215_SPEC.contracts.projection_version],
  ['external_submission_contract_version', V215_SPEC.contracts.external_relay_submission_version],
]);

/** formation_disputes_external_submission_v211 — envelope ↔ relay-submission. */
export const V215_EXTERNAL_SUBMISSION_READINESS_PATTERN = sameOrBranchPatternV215([
  ['schema_version', V215_SPEC.identity.envelope_schema_version],
  ['external_submission_contract_version', V215_SPEC.contracts.external_relay_submission_version],
]);

/** formation_assurance_challenges_payload_binding — protected action ↔ command. */
export const V215_PROTECTED_ACTION_READINESS_PATTERN = sameOrBranchPatternV215([
  ['protected_action_version', V215_SPEC.contracts.protected_action_version],
  ['ceremony_command,command_version', V215_SPEC.contracts.command_version],
]);
