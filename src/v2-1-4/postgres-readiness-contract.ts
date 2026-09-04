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
 * These patterns require the literals to appear inside ONE `OR` branch, by
 * forbidding an intervening `OR` between them. `pg_get_constraintdef` renders
 * a branch's conditions in the order the migration wrote them, so the literal
 * order below mirrors the migration. That makes the check order-sensitive,
 * which fails closed: reordering the migration breaks readiness loudly rather
 * than silently weakening it.
 */

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Literals that must share a single OR-branch, in the order the branch writes them. */
export function sameOrBranchPatternV214(literals: readonly string[]): string {
  return literals.map(escapeRegex).join('(?:(?!OR).)*');
}

/** formation_disputes_contract_pair_v212 — the full current-generation combination. */
export const V214_CONTRACT_PAIR_READINESS_PATTERN = sameOrBranchPatternV214([
  'juryai-case-envelope-v2.1.4',
  'juryai-formation-protocol-v2.1.4',
  'juryai-envelope-command-v2.1.4',
  'juryai-formation-readiness-v2.1.4',
  'juryai-party-formation-projection-v2.1.4',
  'juryai-external-relay-submission-v2.1.4',
]);

/** formation_disputes_external_submission_v211 — envelope ↔ relay-submission. */
export const V214_EXTERNAL_SUBMISSION_READINESS_PATTERN = sameOrBranchPatternV214([
  'juryai-case-envelope-v2.1.4',
  'juryai-external-relay-submission-v2.1.4',
]);

/** formation_assurance_challenges_payload_binding — protected action ↔ command. */
export const V214_PROTECTED_ACTION_READINESS_PATTERN = sameOrBranchPatternV214([
  'juryai-party-review-protected-action-v1.3.0',
  'juryai-envelope-command-v2.1.4',
]);
