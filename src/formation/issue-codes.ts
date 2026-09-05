/**
 * The contract-issue vocabulary of the shared validator.
 *
 * Frozen V2.1.4 writes every generation-scoped code as one literal, e.g.
 * `'v214_envelope_hash_mismatch'`. The shared validator cannot do that: the
 * suffix is universal but the prefix belongs to the generation.
 *
 * The prefix is therefore supplied by the GenerationSpec as an explicit
 * literal, and this module only concatenates it with a fixed suffix. It must
 * NEVER be computed from `identity.generation_id` — turning `v2.1.4` into
 * `v214_` by stripping dots is exactly the mechanical text transformation that
 * produced four separate defects during PR 8B, and a wrong prefix silently
 * renames every diagnostic a caller matches on.
 * `formation-engine-isolation.test.ts` enforces that no derivation exists.
 *
 * Two codes are deliberately NOT prefixed, because the frozen validator does
 * not prefix them. Preserving that asymmetry is parity; "tidying" it would
 * change a public code.
 */

/**
 * Generation-scoped suffixes emitted by the shared VALIDATOR, in the order a
 * sorted listing produces so the inventory is diffable. The set — not merely
 * each member — is load-bearing: `formation-validator-inventory.test.ts`
 * proves the shared validator emits exactly the frozen validator's codes,
 * which is what catches a rule that was dropped rather than mistranslated.
 */
export const VALIDATOR_ISSUE_CODE_SUFFIXES = [
  'case_id',
  'challenge_before_disclosure',
  'challenge_object',
  'challenge_response_missing',
  'challenge_response_object',
  'challenge_response_position',
  'challenge_response_shape',
  'challenge_response_spans',
  'challenge_shape',
  'challenge_spans',
  'clarification_object',
  'clarification_reopen_link',
  'clarification_shape',
  'collection',
  'confirmation_id_collision',
  'confirmation_object',
  'confirmation_shape',
  'confirmations',
  'contract_version',
  'control_object',
  'disclosure',
  'disclosure_ack_before_disclosure',
  'disclosure_ack_id_collision',
  'disclosure_ack_object',
  'disclosure_ack_shape',
  'disclosure_acknowledgments',
  'disclosure_review_closure_missing',
  'duplicate_open_clarification',
  'envelope_hash',
  'envelope_hash_mismatch',
  'envelope_json',
  'envelope_object',
  'envelope_version',
  'evidence_object',
  'evidence_shape',
  'exact_keys',
  'explanatory',
  'explanatory_mismatch',
  'explanatory_shape',
  'explicit_absence_source',
  'formation',
  'live_position_slot_duplicate',
  'parties',
  'party',
  'party_binding',
  'party_cursor',
  'party_projection_hash',
  'party_role',
  'party_state',
  'party_views',
  'position_evidence',
  'position_history',
  'position_id_scope',
  'position_object',
  'position_provenance',
  'position_requirement',
  'position_semantics',
  'position_spans',
  'position_statement',
  'position_supersession_shape',
  'reopen_events',
  'reopen_history_missing',
  'reopen_object',
  'reopen_shape',
  'requirement_cardinality',
  // PR 8C1a. Emitted ONLY under `multi_live`, where `max_propositions` becomes
  // the sole cardinality bound. The relay does not emit it: the relay already
  // validates its post-application candidate through this validator, so a
  // second effect-local implementation would mean two subtly different
  // meanings of `max_propositions`. The inventory describes reality, so this
  // suffix belongs to the validator scope only.
  'requirement_live_cardinality_exceeded',
  'requirement_object',
  'requirement_reopen_link',
  'requirement_shape',
  'requirement_types',
  'source_channel',
  'source_client_turn',
  'source_commitment',
  'source_compile_run',
  'source_dispute',
  'source_fingerprint',
  'source_fingerprint_mismatch',
  'source_id_scope',
  'source_layout',
  'source_layout_mismatch',
  'source_metadata',
  'source_object',
  'source_party',
  'source_payload',
  'source_payload_commitment',
  'source_payload_not_normalized',
  'source_received_at',
  'source_redaction',
  'source_reply_targets',
  'source_subject',
  'source_translation',
  'source_visible_version',
  'span_answer_index',
  'span_bounds',
  'span_commitment_mismatch',
  'span_context_index',
  'span_encoding',
  'span_object',
  'span_out_of_bounds',
  'span_quote_hash',
  'span_region',
  'span_source_mismatch',
  'span_turn_id',
  'supersession_link',
  'supersession_reverse_link',
  'unbound_party_state',
  'workflow',
] as const;

/**
 * Suffixes emitted by the shared RELAY. Listed separately from the validator's
 * because each is checked against its own frozen module — a relay code that
 * silently stopped being emitted must fail even though the validator's
 * inventory is untouched. `explicit_absence_source` deliberately appears in
 * both frozen files with different messages, so it is declared once here and
 * the union below de-duplicates it.
 */
export const RELAY_ISSUE_CODE_SUFFIXES = [
  'assertion_requirement',
  'assertion_semantics',
  'assertion_slot_duplicate',
  'explicit_absence_source',
  'live_position_slot_collision',
  'position_id_collision',
  'span_missing',
  'span_turn_mismatch',
  'supersession_target',
] as const;

/** Every generation-scoped suffix the engine can emit, de-duplicated. */
export const PREFIXED_ISSUE_CODE_SUFFIXES = [
  ...new Set<string>([...VALIDATOR_ISSUE_CODE_SUFFIXES, ...RELAY_ISSUE_CODE_SUFFIXES]),
].sort() as readonly string[];

export type PrefixedIssueCodeSuffix =
  (typeof VALIDATOR_ISSUE_CODE_SUFFIXES)[number] | (typeof RELAY_ISSUE_CODE_SUFFIXES)[number];

/**
 * Codes the frozen validator emits WITHOUT a generation prefix. Kept verbatim.
 */
export const UNPREFIXED_ISSUE_CODES = Object.freeze({
  duplicate_authenticated_subject: 'duplicate_authenticated_subject',
} as const);

export type FormationIssueCodes = Readonly<Record<PrefixedIssueCodeSuffix, string>> &
  typeof UNPREFIXED_ISSUE_CODES;

/**
 * Binds the vocabulary to one generation's explicit prefix.
 *
 * `prefix` arrives from `spec.contracts.contract_issue_code_prefix` and is used
 * verbatim; this function performs no inspection, parsing or rewriting of it.
 */
export function createIssueCodes(prefix: string): FormationIssueCodes {
  const codes: Record<string, string> = { ...UNPREFIXED_ISSUE_CODES };
  for (const suffix of PREFIXED_ISSUE_CODE_SUFFIXES) codes[suffix] = `${prefix}${suffix}`;
  return Object.freeze(codes) as FormationIssueCodes;
}
