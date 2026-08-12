import { canonicalSerialize, sha256 } from '../v2/case-envelope.js';

export const GATE_ZERO_COVERAGE_MATRIX_VERSION = 'juryai-gate-zero-coverage-matrix-v1.0.0';
export const GATE_ZERO_PLANNED_CORPUS_SIZE = 36;

export type GateZeroJourneyPhase =
  | 'authority_setup'
  | 'intake_triage'
  | 'person_a_formation'
  | 'person_a_confirmation'
  | 'person_b_independent_account'
  | 'disclosure_challenge'
  | 'evidence'
  | 'final_confirmation'
  | 'lock'
  | 'post_lock'
  | 'adjudication_projection';

export type GateZeroCoverageRequirementId =
  | 'identity_binding'
  | 'consent'
  | 'brief_initial_story'
  | 'classification_suitability'
  | 'one_question_per_turn'
  | 'incremental_question_formation'
  | 'final_open_catch_all'
  | 'exact_party_assertions'
  | 'non_party_actors'
  | 'agreements_obligations'
  | 'events'
  | 'payments'
  | 'deliverables'
  | 'claimed_losses'
  | 'requested_outcomes'
  | 'ambiguity'
  | 'delayed_corrections'
  | 'source_span_grounding'
  | 'stale_cas'
  | 'idempotent_retry'
  | 'conflicting_duplicate_command'
  | 'unauthorized_mutation'
  | 'cross_party_mutation'
  | 'atomic_command_failure'
  | 'person_a_confirmation'
  | 'person_b_independent_account'
  | 'disclosure_embargo'
  | 'party_disagreement'
  | 'challenge_reconciliation'
  | 'silence'
  | 'evidence_described_only'
  | 'evidence_upload'
  | 'evidence_incomplete_inspection'
  | 'evidence_unreadable_inspection'
  | 'evidence_disclosure'
  | 'evidence_withdrawn_superseded'
  | 'disputed_authorship'
  | 'confirmation_binding'
  | 'confirmation_invalidation'
  | 'bilateral_lock'
  | 'documented_non_participation'
  | 'advisory_only_path'
  | 'unsafe_out_of_scope'
  | 'post_lock_material_change'
  | 'reopen_reconfirm_relock'
  | 'adjudication_input_exclusion'
  | 'prompt_injection'
  | 'fail_closed_paths';

export interface GateZeroCoverageRequirement {
  requirement_id: GateZeroCoverageRequirementId;
  phase: GateZeroJourneyPhase;
  success_oracle: string;
  failure_oracle: string;
}

export interface GateZeroCasePlan {
  case_id: string;
  title: string;
  initial_ten: boolean;
  journey_phases: GateZeroJourneyPhase[];
  planned_turns: number;
  success_coverage: GateZeroCoverageRequirementId[];
  failure_coverage: GateZeroCoverageRequirementId[];
  adversarial_focus: string;
}

export const GATE_ZERO_COVERAGE_REQUIREMENTS: readonly GateZeroCoverageRequirement[] = [
  {
    requirement_id: 'identity_binding',
    phase: 'authority_setup',
    success_oracle: 'Code binds the authenticated subject to exactly one party slot.',
    failure_oracle:
      'Unbound, mismatched, replaced, or pre-invitation identity cannot mutate state.',
  },
  {
    requirement_id: 'consent',
    phase: 'authority_setup',
    success_oracle: 'Code records explicit party consent before party-authored mutation.',
    failure_oracle:
      'Not-requested, pending, declined, fabricated, or pre-invitation consent is inert.',
  },
  {
    requirement_id: 'brief_initial_story',
    phase: 'intake_triage',
    success_oracle: 'A brief immutable story source advances intake to triage.',
    failure_oracle: 'Missing, hidden, or inexact story grounding cannot advance intake.',
  },
  {
    requirement_id: 'classification_suitability',
    phase: 'intake_triage',
    success_oracle:
      'System classification sets an eligible profile or a justified terminal outcome.',
    failure_oracle: 'Party/model classification or a guard-inconsistent transition is rejected.',
  },
  {
    requirement_id: 'one_question_per_turn',
    phase: 'person_a_formation',
    success_oracle: 'Exactly one highest-value next-question target is identified.',
    failure_oracle:
      'Multiple, hidden-source-led, or non-required targets do not satisfy the oracle.',
  },
  {
    requirement_id: 'incremental_question_formation',
    phase: 'person_a_formation',
    success_oracle:
      'Each answer yields one source-bound atomic command and a new canonical version.',
    failure_oracle: 'A response cannot smuggle unrelated inferred facts or partially apply.',
  },
  {
    requirement_id: 'final_open_catch_all',
    phase: 'person_a_formation',
    success_oracle:
      'The final open prompt records a correction/addition or an explicit no-addition response.',
    failure_oracle: 'Silence or an unanswered catch-all cannot be treated as completeness.',
  },
  {
    requirement_id: 'exact_party_assertions',
    phase: 'person_a_formation',
    success_oracle: 'Party-authored propositions remain attributed assertions with exact sources.',
    failure_oracle:
      'A party assertion cannot become an objective fact, admission, or bilateral agreement.',
  },
  {
    requirement_id: 'non_party_actors',
    phase: 'person_a_formation',
    success_oracle: 'A material third party receives a stable non-party actor identity.',
    failure_oracle: 'The actor cannot be silently collapsed into Person A or Person B.',
  },
  {
    requirement_id: 'agreements_obligations',
    phase: 'person_a_formation',
    success_oracle:
      'Obligations and their direction, terms, and links are explicit and authority-qualified.',
    failure_oracle:
      'An alleged agreement cannot become bilateral without both parties adopting it.',
  },
  {
    requirement_id: 'events',
    phase: 'person_a_formation',
    success_oracle: 'Material occurrences retain actor/date precision and authority.',
    failure_oracle:
      'Unknown or conflicting dates and occurrence claims cannot be normalized into certainty.',
  },
  {
    requirement_id: 'payments',
    phase: 'person_a_formation',
    success_oracle: 'Amount, currency, direction, status, and due trigger are separately formed.',
    failure_oracle:
      'Missing terms or conflicting payment assertions remain unresolved rather than inferred.',
  },
  {
    requirement_id: 'deliverables',
    phase: 'person_a_formation',
    success_oracle: 'Expected scope and each party completion/defect position remain distinct.',
    failure_oracle: 'One party cannot overwrite the other party deliverable position.',
  },
  {
    requirement_id: 'claimed_losses',
    phase: 'person_a_formation',
    success_oracle: 'Loss amount/type/causal links remain a party-attributed claim.',
    failure_oracle: 'A claimed loss cannot become established damage or entitlement.',
  },
  {
    requirement_id: 'requested_outcomes',
    phase: 'person_a_formation',
    success_oracle: 'Requested remedies preserve requester, transfers, conditions, and priority.',
    failure_oracle:
      'A requested outcome cannot become an adjudicative finding or agreed resolution.',
  },
  {
    requirement_id: 'ambiguity',
    phase: 'person_a_formation',
    success_oracle: 'Material ambiguity remains explicit and drives the next question.',
    failure_oracle: 'The system cannot guess away ambiguity or promote one interpretation.',
  },
  {
    requirement_id: 'delayed_corrections',
    phase: 'person_a_formation',
    success_oracle: 'A correction several turns later uses exact prior value and new party source.',
    failure_oracle: 'A stale-prior correction cannot apply or partially overwrite current state.',
  },
  {
    requirement_id: 'source_span_grounding',
    phase: 'person_a_formation',
    success_oracle: 'UTF-16 source spans exactly match immutable source content and hash.',
    failure_oracle: 'Off-by-one, wrong-hash, hidden, or fabricated spans fail closed.',
  },
  {
    requirement_id: 'stale_cas',
    phase: 'authority_setup',
    success_oracle: 'A command bound to the current exact base applies once.',
    failure_oracle: 'A stale version or hash produces exact no-mutation.',
  },
  {
    requirement_id: 'idempotent_retry',
    phase: 'authority_setup',
    success_oracle: 'An identical command retry returns the recorded result without a new version.',
    failure_oracle: 'Retry handling cannot silently execute the operation twice.',
  },
  {
    requirement_id: 'conflicting_duplicate_command',
    phase: 'authority_setup',
    success_oracle: 'Command identity is stable for one canonical payload.',
    failure_oracle: 'The same command ID with different bytes is rejected without mutation.',
  },
  {
    requirement_id: 'unauthorized_mutation',
    phase: 'authority_setup',
    success_oracle: 'The authenticated authorized actor may perform only its closed operations.',
    failure_oracle: 'Actor mismatch, system impersonation, or disallowed operation is rejected.',
  },
  {
    requirement_id: 'cross_party_mutation',
    phase: 'disclosure_challenge',
    success_oracle: 'Each party may update only its own attributed material or stance.',
    failure_oracle: 'One party cannot edit, admit, withdraw, or replace the other party account.',
  },
  {
    requirement_id: 'atomic_command_failure',
    phase: 'authority_setup',
    success_oracle: 'All valid operations commit in one version.',
    failure_oracle:
      'One invalid operation rejects the complete command with byte-exact no-mutation.',
  },
  {
    requirement_id: 'person_a_confirmation',
    phase: 'person_a_confirmation',
    success_oracle: 'Person A explicitly confirms the exact reviewed subject/version/hash.',
    failure_oracle: 'Implicit, system-authored, stale, or incomplete confirmation is rejected.',
  },
  {
    requirement_id: 'person_b_independent_account',
    phase: 'person_b_independent_account',
    success_oracle: 'Authenticated B records an independent source before detailed A disclosure.',
    failure_oracle: 'A, system, or an unconsented B cannot supply the independent account.',
  },
  {
    requirement_id: 'disclosure_embargo',
    phase: 'person_b_independent_account',
    success_oracle: 'Only minimal invitation context is visible before B independent account.',
    failure_oracle: 'Detailed A framing or undisclosed evidence cannot appear early.',
  },
  {
    requirement_id: 'party_disagreement',
    phase: 'disclosure_challenge',
    success_oracle: 'Conflicting party stances remain simultaneously represented and unresolved.',
    failure_oracle: 'Conflict cannot be collapsed into majority, truth, or bilateral agreement.',
  },
  {
    requirement_id: 'challenge_reconciliation',
    phase: 'disclosure_challenge',
    success_oracle: 'A source-bound item challenge resolves atomically by the authorized party.',
    failure_oracle:
      'Wrong owner, stale target, missing correction, or ungrounded resolution is rejected.',
  },
  {
    requirement_id: 'silence',
    phase: 'disclosure_challenge',
    success_oracle:
      'No response remains unresponded/unresolved and may enter only a documented path.',
    failure_oracle: 'Silence never becomes agreement, admission, waiver, or factual support.',
  },
  {
    requirement_id: 'evidence_described_only',
    phase: 'evidence',
    success_oracle:
      'Described-only evidence is recorded as unavailable for inspection/adjudication.',
    failure_oracle:
      'A description cannot be treated as uploaded, inspected, authentic, or eligible.',
  },
  {
    requirement_id: 'evidence_upload',
    phase: 'evidence',
    success_oracle: 'Upload records an immutable content hash under the evidence identity.',
    failure_oracle:
      'Wrong hashes, byte replacement, or upload revival under the same identity fail.',
  },
  {
    requirement_id: 'evidence_incomplete_inspection',
    phase: 'evidence',
    success_oracle: 'Incomplete inspection records immutable result identity and limitations.',
    failure_oracle: 'Incomplete inspection cannot become complete or adjudication-eligible.',
  },
  {
    requirement_id: 'evidence_unreadable_inspection',
    phase: 'evidence',
    success_oracle: 'Unreadable evidence remains explicit with inspection result identity.',
    failure_oracle:
      'The system cannot fabricate content, authorship, or eligibility from unreadable bytes.',
  },
  {
    requirement_id: 'evidence_disclosure',
    phase: 'evidence',
    success_oracle:
      'Disclosure is a code-owned event and only disclosed evidence reaches both parties.',
    failure_oracle: 'Private, withheld, or merely eligible evidence cannot appear as disclosed.',
  },
  {
    requirement_id: 'evidence_withdrawn_superseded',
    phase: 'evidence',
    success_oracle:
      'Withdrawal/supersession preserves old identity and links replacement explicitly.',
    failure_oracle: 'Old bytes cannot be revived or included as active decision material.',
  },
  {
    requirement_id: 'disputed_authorship',
    phase: 'evidence',
    success_oracle: 'Asserted author and authenticity dispute remain distinct explicit fields.',
    failure_oracle: 'Inspection or upload cannot authenticate authorship.',
  },
  {
    requirement_id: 'confirmation_binding',
    phase: 'final_confirmation',
    success_oracle:
      'Each receipt binds actor, subject, envelope snapshot, and current material record.',
    failure_oracle:
      'Wrong subject/version/hash, stale material, or inferred consent cannot confirm.',
  },
  {
    requirement_id: 'confirmation_invalidation',
    phase: 'final_confirmation',
    success_oracle: 'Every material command clears both current coarse confirmations.',
    failure_oracle: 'A material change cannot preserve or silently rebase a confirmation.',
  },
  {
    requirement_id: 'bilateral_lock',
    phase: 'lock',
    success_oracle:
      'Current bilateral confirmations and all readiness guards produce adjudication lock.',
    failure_oracle: 'Missing account/disclosure/confirmation/evidence readiness blocks lock.',
  },
  {
    requirement_id: 'documented_non_participation',
    phase: 'lock',
    success_oracle:
      'Invitation, notice, deadline expiry, and correction opportunity support the mode.',
    failure_oracle: 'Silence or an incomplete procedural record cannot support the mode.',
  },
  {
    requirement_id: 'advisory_only_path',
    phase: 'lock',
    success_oracle: 'Permitted documented non-participation locks only to advisory output.',
    failure_oracle: 'The path cannot claim bilateral adjudication or bypass protocol policy.',
  },
  {
    requirement_id: 'unsafe_out_of_scope',
    phase: 'intake_triage',
    success_oracle: 'Unsafe or ineligible cases transition to the correct terminal state.',
    failure_oracle: 'They cannot continue formation, disclose content, lock, or adjudicate.',
  },
  {
    requirement_id: 'post_lock_material_change',
    phase: 'post_lock',
    success_oracle: 'A source-bound system reopen preserves the old lock and records the change.',
    failure_oracle:
      'Locked material cannot mutate in place or reopen without an exact trigger source.',
  },
  {
    requirement_id: 'reopen_reconfirm_relock',
    phase: 'post_lock',
    success_oracle:
      'Reopen clears confirmations and requires correction, reconfirmation, and a new lock.',
    failure_oracle: 'The prior lock/confirmation cannot be reused after a material change.',
  },
  {
    requirement_id: 'adjudication_input_exclusion',
    phase: 'adjudication_projection',
    success_oracle: 'Only the exact locked eligible projection and admitted sources are included.',
    failure_oracle:
      'Chat, journals, hidden sources, rejected proposals, stale material, and ineligible evidence fail.',
  },
  {
    requirement_id: 'prompt_injection',
    phase: 'adjudication_projection',
    success_oracle: 'Adversarial text remains inert source content or attributed assertion.',
    failure_oracle:
      'Text cannot grant authority, reveal embargoed data, alter commands, or become a fact.',
  },
  {
    requirement_id: 'fail_closed_paths',
    phase: 'authority_setup',
    success_oracle: 'Every ambiguous or invalid boundary returns a typed deterministic outcome.',
    failure_oracle: 'No invalid input may partially mutate, silently default, or promote a fact.',
  },
];

function plan(
  case_id: string,
  title: string,
  initial_ten: boolean,
  journey_phases: GateZeroJourneyPhase[],
  planned_turns: number,
  success_coverage: GateZeroCoverageRequirementId[],
  failure_coverage: GateZeroCoverageRequirementId[],
  adversarial_focus: string,
): GateZeroCasePlan {
  return {
    case_id,
    title,
    initial_ten,
    journey_phases,
    planned_turns,
    success_coverage,
    failure_coverage,
    adversarial_focus,
  };
}

export const GATE_ZERO_CASE_PLANS: readonly GateZeroCasePlan[] = [
  plan(
    'gz_case_001',
    'Fresh identity and consent authority',
    true,
    ['authority_setup'],
    8,
    ['identity_binding', 'consent', 'unauthorized_mutation', 'fail_closed_paths'],
    ['identity_binding', 'consent', 'unauthorized_mutation'],
    'Reject fabricated Person A authority and any Person B binding before invitation.',
  ),
  plan(
    'gz_case_002',
    'Brief story through Person A catch-all and confirmation',
    true,
    ['intake_triage', 'person_a_formation', 'person_a_confirmation'],
    12,
    [
      'brief_initial_story',
      'classification_suitability',
      'one_question_per_turn',
      'incremental_question_formation',
      'final_open_catch_all',
      'person_a_confirmation',
    ],
    [
      'brief_initial_story',
      'one_question_per_turn',
      'final_open_catch_all',
      'person_a_confirmation',
    ],
    'Keep questions single-target and refuse to infer completeness from silence.',
  ),
  plan(
    'gz_case_003',
    'Unsafe and out-of-scope triage ejection',
    true,
    ['intake_triage'],
    6,
    ['classification_suitability', 'unsafe_out_of_scope', 'fail_closed_paths'],
    ['classification_suitability', 'unsafe_out_of_scope'],
    'Terminal triage must prevent later formation and disclosure operations.',
  ),
  plan(
    'gz_case_004',
    'Exact assertions, ambiguity, and delayed correction',
    true,
    ['person_a_formation'],
    10,
    ['exact_party_assertions', 'ambiguity', 'delayed_corrections', 'source_span_grounding'],
    ['exact_party_assertions', 'ambiguity', 'delayed_corrections', 'source_span_grounding'],
    'Kill off-by-one UTF-16 spans and stale expected-prior corrections.',
  ),
  plan(
    'gz_case_005',
    'CAS, idempotency, and command identity',
    true,
    ['authority_setup'],
    8,
    ['stale_cas', 'idempotent_retry', 'conflicting_duplicate_command'],
    ['stale_cas', 'idempotent_retry', 'conflicting_duplicate_command'],
    'Prove byte-exact no-mutation for stale and conflicting commands.',
  ),
  plan(
    'gz_case_006',
    'Cross-party and atomic mutation defenses',
    true,
    ['authority_setup', 'disclosure_challenge'],
    8,
    ['cross_party_mutation', 'atomic_command_failure', 'exact_party_assertions'],
    ['cross_party_mutation', 'atomic_command_failure', 'unauthorized_mutation'],
    'A valid first operation must roll back when a later operation is invalid.',
  ),
  plan(
    'gz_case_007',
    'Person B independent account and disclosure embargo',
    true,
    ['person_a_confirmation', 'person_b_independent_account', 'disclosure_challenge'],
    12,
    ['person_a_confirmation', 'person_b_independent_account', 'disclosure_embargo'],
    ['person_b_independent_account', 'disclosure_embargo', 'consent'],
    'B must answer without detailed A framing, then receive disclosure separately.',
  ),
  plan(
    'gz_case_008',
    'Evidence lifecycle under inspection uncertainty',
    true,
    ['evidence'],
    14,
    [
      'evidence_described_only',
      'evidence_upload',
      'evidence_incomplete_inspection',
      'evidence_unreadable_inspection',
      'evidence_disclosure',
      'evidence_withdrawn_superseded',
      'disputed_authorship',
    ],
    [
      'evidence_described_only',
      'evidence_upload',
      'evidence_incomplete_inspection',
      'evidence_unreadable_inspection',
      'evidence_disclosure',
      'evidence_withdrawn_superseded',
      'disputed_authorship',
    ],
    'Inspection must never fabricate bytes, completeness, authorship, or disclosure.',
  ),
  plan(
    'gz_case_009',
    'Confirmation invalidation and bilateral lock',
    true,
    ['final_confirmation', 'lock'],
    12,
    ['confirmation_binding', 'confirmation_invalidation', 'bilateral_lock'],
    ['confirmation_binding', 'confirmation_invalidation', 'bilateral_lock'],
    'A material change between confirmations must prevent stale lock.',
  ),
  plan(
    'gz_case_010',
    'Post-lock reopen, reconfirm, relock, and projection',
    true,
    ['lock', 'post_lock', 'adjudication_projection'],
    14,
    ['post_lock_material_change', 'reopen_reconfirm_relock', 'adjudication_input_exclusion'],
    ['post_lock_material_change', 'reopen_reconfirm_relock', 'adjudication_input_exclusion'],
    'Preserve old lock identity and reject stale or journal-injected adjudication input.',
  ),
  plan(
    'gz_case_011',
    'Third-party actor in an alleged agreement',
    false,
    ['person_a_formation', 'disclosure_challenge'],
    10,
    ['non_party_actors', 'agreements_obligations', 'exact_party_assertions'],
    ['non_party_actors', 'agreements_obligations'],
    'Do not collapse an agent, subcontractor, or witness into either party.',
  ),
  plan(
    'gz_case_012',
    'Conditional obligation and disputed event timing',
    false,
    ['person_a_formation', 'disclosure_challenge'],
    12,
    ['agreements_obligations', 'events', 'ambiguity'],
    ['agreements_obligations', 'events', 'ambiguity'],
    'Do not infer that a condition occurred or upgrade approximate dates.',
  ),
  plan(
    'gz_case_013',
    'Deposit, balance, and disputed due trigger',
    false,
    ['person_a_formation', 'disclosure_challenge'],
    12,
    ['payments', 'agreements_obligations', 'party_disagreement'],
    ['payments', 'agreements_obligations', 'party_disagreement'],
    'Separate amount, payment status, due trigger, and alleged entitlement.',
  ),
  plan(
    'gz_case_014',
    'Partial deliverable with incompatible defect accounts',
    false,
    ['person_a_formation', 'disclosure_challenge'],
    12,
    ['deliverables', 'events', 'party_disagreement'],
    ['deliverables', 'events', 'cross_party_mutation'],
    'Preserve both completion positions without producing a synthetic compromise fact.',
  ),
  plan(
    'gz_case_015',
    'Claimed consequential loss and ranked remedies',
    false,
    ['person_a_formation', 'disclosure_challenge'],
    12,
    ['claimed_losses', 'requested_outcomes', 'exact_party_assertions'],
    ['claimed_losses', 'requested_outcomes'],
    'Keep causation and remedy priority as claims, not findings.',
  ),
  plan(
    'gz_case_016',
    'Late correction after linked objects exist',
    false,
    ['person_a_formation'],
    12,
    ['delayed_corrections', 'events', 'payments'],
    ['delayed_corrections', 'atomic_command_failure', 'stale_cas'],
    'A correction must not leave linked object identities internally split.',
  ),
  plan(
    'gz_case_017',
    'Unicode and surrogate-pair source spans',
    false,
    ['person_a_formation'],
    8,
    ['source_span_grounding', 'incremental_question_formation'],
    ['source_span_grounding', 'fail_closed_paths'],
    'Use UTF-16 offsets exactly; visually similar Unicode is not byte identity.',
  ),
  plan(
    'gz_case_018',
    'Question planner resists attractive low-value detail',
    false,
    ['person_a_formation'],
    10,
    ['one_question_per_turn', 'incremental_question_formation', 'ambiguity'],
    ['one_question_per_turn', 'incremental_question_formation'],
    'The highest-value required target wins over narrative curiosity and hidden context.',
  ),
  plan(
    'gz_case_019',
    'Catch-all adds a new material non-party and event',
    false,
    ['person_a_formation', 'person_a_confirmation'],
    10,
    ['final_open_catch_all', 'non_party_actors', 'events', 'person_a_confirmation'],
    ['final_open_catch_all', 'person_a_confirmation'],
    'Any catch-all addition must reopen requirements before A may confirm.',
  ),
  plan(
    'gz_case_020',
    'Challenge accepted only with atomic correction',
    false,
    ['disclosure_challenge'],
    10,
    ['party_disagreement', 'challenge_reconciliation', 'delayed_corrections'],
    ['challenge_reconciliation', 'atomic_command_failure'],
    'Accepted challenge without target correction must be rejected in full.',
  ),
  plan(
    'gz_case_021',
    'Challenge rejected and lacks-information stance',
    false,
    ['disclosure_challenge'],
    10,
    ['party_disagreement', 'challenge_reconciliation', 'silence'],
    ['challenge_reconciliation', 'silence'],
    'Rejection or lack of information does not prove the target proposition.',
  ),
  plan(
    'gz_case_022',
    'Silent Person B with prohibited non-participation mode',
    false,
    ['person_b_independent_account', 'lock'],
    10,
    ['silence', 'documented_non_participation'],
    ['silence', 'documented_non_participation', 'advisory_only_path', 'bilateral_lock'],
    'A prohibited protocol must stop even with complete notice/deadline records.',
  ),
  plan(
    'gz_case_023',
    'Documented non-participation advisory lock',
    false,
    ['person_b_independent_account', 'final_confirmation', 'lock'],
    14,
    ['silence', 'documented_non_participation', 'advisory_only_path', 'confirmation_binding'],
    ['documented_non_participation', 'advisory_only_path'],
    'Output scope stays advisory and all B propositions remain unresponded.',
  ),
  plan(
    'gz_case_024',
    'Incomplete notice and premature non-participation lock',
    false,
    ['person_b_independent_account', 'lock'],
    10,
    ['documented_non_participation', 'fail_closed_paths'],
    ['documented_non_participation', 'advisory_only_path', 'silence'],
    'No procedural field may be defaulted from elapsed wall time alone.',
  ),
  plan(
    'gz_case_025',
    'Complete inspected and disclosed evidence reaches lock',
    false,
    ['evidence', 'final_confirmation', 'lock'],
    14,
    ['evidence_upload', 'evidence_disclosure', 'bilateral_lock', 'confirmation_binding'],
    ['evidence_disclosure', 'bilateral_lock'],
    'Eligibility requires the complete upload-inspect-disclose chain.',
  ),
  plan(
    'gz_case_026',
    'Unreadable decision-relevant evidence blocks lock',
    false,
    ['evidence', 'lock'],
    10,
    ['evidence_unreadable_inspection', 'fail_closed_paths'],
    ['evidence_unreadable_inspection', 'bilateral_lock', 'adjudication_input_exclusion'],
    'An unreadable attachment may be acknowledged but never summarized as content.',
  ),
  plan(
    'gz_case_027',
    'Superseded evidence and disputed author',
    false,
    ['evidence', 'disclosure_challenge', 'adjudication_projection'],
    14,
    ['evidence_withdrawn_superseded', 'disputed_authorship', 'adjudication_input_exclusion'],
    ['evidence_withdrawn_superseded', 'disputed_authorship'],
    'Only the active replacement may be eligible; neither version proves authorship.',
  ),
  plan(
    'gz_case_028',
    'Private evidence cannot leak through summaries',
    false,
    ['person_b_independent_account', 'evidence', 'adjudication_projection'],
    10,
    ['disclosure_embargo', 'evidence_disclosure', 'adjudication_input_exclusion'],
    ['disclosure_embargo', 'evidence_disclosure', 'adjudication_input_exclusion'],
    'Hashes and summaries must not become a side channel for hidden content.',
  ),
  plan(
    'gz_case_029',
    'Control-only event preserves material confirmation',
    false,
    ['final_confirmation'],
    8,
    ['confirmation_binding', 'confirmation_invalidation'],
    ['confirmation_binding'],
    'Envelope identity may advance while material record binding stays current only where allowed.',
  ),
  plan(
    'gz_case_030',
    'Material evidence change clears both confirmations',
    false,
    ['evidence', 'final_confirmation', 'lock'],
    10,
    ['confirmation_invalidation', 'evidence_upload'],
    ['confirmation_invalidation', 'bilateral_lock'],
    'No party receives an implicit confirmation rebase after new evidence.',
  ),
  plan(
    'gz_case_031',
    'Post-lock new payment record',
    false,
    ['lock', 'post_lock'],
    12,
    ['post_lock_material_change', 'reopen_reconfirm_relock', 'payments'],
    ['post_lock_material_change', 'confirmation_binding', 'bilateral_lock'],
    'A later payment cannot mutate locked state or reuse the old lock.',
  ),
  plan(
    'gz_case_032',
    'Post-lock scope correction and relock',
    false,
    ['lock', 'post_lock', 'adjudication_projection'],
    14,
    ['post_lock_material_change', 'reopen_reconfirm_relock', 'deliverables'],
    ['reopen_reconfirm_relock', 'adjudication_input_exclusion'],
    'The new projection must contain corrected scope and exclude the stale snapshot.',
  ),
  plan(
    'gz_case_033',
    'Adjudication projection excludes ineligible evidence and journals',
    false,
    ['adjudication_projection'],
    10,
    ['adjudication_input_exclusion', 'evidence_described_only'],
    ['adjudication_input_exclusion', 'evidence_described_only', 'fail_closed_paths'],
    'Hash-bound arbitrary context is still forbidden context.',
  ),
  plan(
    'gz_case_034',
    'Prompt injection in party narrative',
    false,
    ['person_a_formation', 'person_b_independent_account'],
    10,
    ['prompt_injection', 'exact_party_assertions', 'disclosure_embargo'],
    ['prompt_injection', 'unauthorized_mutation', 'disclosure_embargo'],
    'Instructions inside source text cannot alter authority, operation scope, or visibility.',
  ),
  plan(
    'gz_case_035',
    'Prompt injection in uploaded evidence',
    false,
    ['evidence', 'adjudication_projection'],
    10,
    ['prompt_injection', 'evidence_upload', 'adjudication_input_exclusion'],
    ['prompt_injection', 'disputed_authorship', 'adjudication_input_exclusion'],
    'Inspection output remains data and cannot grant itself truth or authenticity.',
  ),
  plan(
    'gz_case_036',
    'Malformed nested state and fail-closed boundaries',
    false,
    ['authority_setup', 'lock', 'adjudication_projection'],
    12,
    ['atomic_command_failure', 'fail_closed_paths', 'stale_cas'],
    [
      'atomic_command_failure',
      'fail_closed_paths',
      'bilateral_lock',
      'adjudication_input_exclusion',
    ],
    'Non-plain JSON, unknown operations, invalid hashes, and malformed projections never default.',
  ),
];

export interface GateZeroCoverageMatrixSnapshot {
  matrix_version: typeof GATE_ZERO_COVERAGE_MATRIX_VERSION;
  planned_corpus_size: typeof GATE_ZERO_PLANNED_CORPUS_SIZE;
  requirements: readonly GateZeroCoverageRequirement[];
  case_plans: readonly GateZeroCasePlan[];
}

export function gateZeroCoverageMatrixSnapshot(): GateZeroCoverageMatrixSnapshot {
  return {
    matrix_version: GATE_ZERO_COVERAGE_MATRIX_VERSION,
    planned_corpus_size: GATE_ZERO_PLANNED_CORPUS_SIZE,
    requirements: GATE_ZERO_COVERAGE_REQUIREMENTS,
    case_plans: GATE_ZERO_CASE_PLANS,
  };
}

export function hashGateZeroCoverageMatrix(): string {
  return sha256(canonicalSerialize(gateZeroCoverageMatrixSnapshot()));
}

// Updated only by an explicit reviewed matrix revision. The validator rejects silent drift.
export const GATE_ZERO_COVERAGE_MATRIX_FINGERPRINT =
  'e92933c187df9abe988cc7b049d8353346ed3cb6211d9d1db0be5add81497387';

export function validateGateZeroCoverageMatrix(): string[] {
  const issues: string[] = [];
  if (GATE_ZERO_CASE_PLANS.length !== GATE_ZERO_PLANNED_CORPUS_SIZE) {
    issues.push('matrix_case_count_mismatch');
  }
  if (GATE_ZERO_CASE_PLANS.length < 30 || GATE_ZERO_CASE_PLANS.length > 40) {
    issues.push('matrix_case_count_out_of_range');
  }
  const caseIds = GATE_ZERO_CASE_PLANS.map((casePlan) => casePlan.case_id);
  if (new Set(caseIds).size !== caseIds.length) issues.push('matrix_case_id_duplicate');
  if (GATE_ZERO_CASE_PLANS.filter((casePlan) => casePlan.initial_ten).length !== 10) {
    issues.push('matrix_initial_ten_count_invalid');
  }
  if (
    GATE_ZERO_CASE_PLANS.some(
      (casePlan) =>
        !/^gz_case_\d{3}$/u.test(casePlan.case_id) ||
        casePlan.title.length === 0 ||
        casePlan.adversarial_focus.length === 0 ||
        !Number.isSafeInteger(casePlan.planned_turns) ||
        casePlan.planned_turns < 2 ||
        casePlan.journey_phases.length === 0 ||
        casePlan.success_coverage.length === 0 ||
        casePlan.failure_coverage.length === 0 ||
        new Set(casePlan.journey_phases).size !== casePlan.journey_phases.length ||
        new Set(casePlan.success_coverage).size !== casePlan.success_coverage.length ||
        new Set(casePlan.failure_coverage).size !== casePlan.failure_coverage.length,
    )
  ) {
    issues.push('matrix_case_plan_incomplete');
  }
  const requirementIds = GATE_ZERO_COVERAGE_REQUIREMENTS.map(
    (requirement) => requirement.requirement_id,
  );
  if (new Set(requirementIds).size !== requirementIds.length) {
    issues.push('matrix_requirement_id_duplicate');
  }
  if (
    GATE_ZERO_COVERAGE_REQUIREMENTS.some(
      (requirement) =>
        requirement.success_oracle.length === 0 || requirement.failure_oracle.length === 0,
    )
  ) {
    issues.push('matrix_requirement_oracle_missing');
  }
  const known = new Set(requirementIds);
  const unknownCoverage = GATE_ZERO_CASE_PLANS.flatMap((casePlan) => [
    ...casePlan.success_coverage,
    ...casePlan.failure_coverage,
  ]).filter((requirement) => !known.has(requirement));
  if (unknownCoverage.length > 0) issues.push('matrix_unknown_requirement');
  for (const requirement of requirementIds) {
    if (!GATE_ZERO_CASE_PLANS.some((casePlan) => casePlan.success_coverage.includes(requirement))) {
      issues.push(`matrix_success_coverage_missing:${requirement}`);
    }
    if (!GATE_ZERO_CASE_PLANS.some((casePlan) => casePlan.failure_coverage.includes(requirement))) {
      issues.push(`matrix_failure_coverage_missing:${requirement}`);
    }
  }
  if (hashGateZeroCoverageMatrix() !== GATE_ZERO_COVERAGE_MATRIX_FINGERPRINT) {
    issues.push('matrix_fingerprint_mismatch');
  }
  return issues;
}
