/**
 * JuryAI P2 WebMCP — canonical core types (V0.2 freeze candidate).
 *
 * This module owns the truth/state vocabulary shared by every P2 transport
 * (WebMCP relay, first-party UI, file import). It deliberately contains no
 * model calls, no network access and no tool wiring.
 *
 * Design doctrine (from the V0.1 adversarial review):
 *  - The external AI is an untrusted conversational relay. Nothing it sends is
 *    treated as canonical fact, provenance or classification.
 *  - Illegal states are made unrepresentable via distinct canonical types
 *    rather than English rules in a validator.
 *  - `source_channel` (where text came from) and attestation (whether a human
 *    vouched for the record) are orthogonal axes, never a single ladder.
 */

import {
  canonicalSerialize as v2CanonicalSerialize,
  sha256 as v2Sha256,
  type ContractIssue,
  type JsonValue,
} from '../../v2/case-envelope.js';

export type { ContractIssue, JsonValue };

/** Single swap point for canonicalisation so every hash in P2 agrees. */
export const canonicalSerialize = v2CanonicalSerialize;
export const sha256 = v2Sha256;

export const WEBMCP_CORE_SCHEMA_VERSION = 'juryai-webmcp-core-v0.2.0';
export const WEBMCP_PROTOCOL_VERSION = 'juryai-webmcp-protocol-v0.2.0';
export const STRUCTURAL_VALIDATOR_VERSION = 'juryai-structural-validator-v0.2.0';
export const RENDER_TEMPLATE_VERSION = 'juryai-canonical-account-render-v0.2.0';

export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/u;
export const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export function isCanonicalId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function isHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

export function issue(code: string, path: string, message: string): ContractIssue {
  return { code, path, message };
}

/* ------------------------------------------------------------------------ */
/* Provenance axis 1: where the text came from (immutable, historical).       */
/* ------------------------------------------------------------------------ */

export type SourceChannel =
  'webmcp_agent_relay' | 'first_party_input' | 'file_import' | 'evidence_extraction';

export const SOURCE_CHANNELS: readonly SourceChannel[] = [
  'webmcp_agent_relay',
  'first_party_input',
  'file_import',
  'evidence_extraction',
];

/**
 * Channels whose text reached JuryAI through a party we do not control.
 * Records sourced this way must never be described as verbatim human speech.
 */
export const UNTRUSTED_RELAY_CHANNELS: ReadonlySet<SourceChannel> = new Set([
  'webmcp_agent_relay',
  'file_import',
]);

export function isRelayedChannel(channel: SourceChannel): boolean {
  return UNTRUSTED_RELAY_CHANNELS.has(channel);
}

/** Human-facing attribution. Never the word "verbatim" for relayed channels. */
export function describeSourceChannel(
  channel: SourceChannel,
  relayingAgent: string | null,
): string {
  switch (channel) {
    case 'webmcp_agent_relay':
      return `as relayed by ${relayingAgent ?? 'an external AI assistant'}`;
    case 'file_import':
      return 'as imported from a file supplied outside JuryAI';
    case 'first_party_input':
      return 'as entered directly in JuryAI';
    case 'evidence_extraction':
      return 'as extracted from inspected evidence';
  }
}

/* ------------------------------------------------------------------------ */
/* Provenance axis 2: attestation (mutable, current, derived).               */
/* ------------------------------------------------------------------------ */

export type AttestationState = 'unattested' | 'human_attested';

/** Lock status is derived from the attestation collection, never stored. */
export type CaseStatus = 'draft' | 'locked';

/* ------------------------------------------------------------------------ */
/* Canonical proposition types — illegal states made unrepresentable.        */
/* ------------------------------------------------------------------------ */

export type PropositionFamily =
  | 'date_commitment'
  | 'monetary_instrument'
  | 'scope'
  | 'balance'
  | 'remedy'
  | 'document_content'
  | 'narrative'
  | 'non_answer';

export type PropositionType =
  // date_commitment
  | 'target_date'
  | 'contractual_deadline'
  // monetary_instrument
  | 'invoice'
  | 'payment'
  // scope
  | 'requested_scope'
  | 'accepted_scope'
  // balance
  | 'disputed_balance'
  | 'established_debt'
  // remedy
  | 'requested_remedy'
  | 'established_entitlement'
  // document_content
  | 'recalled_document_content'
  | 'verified_document_content'
  // narrative / non-answer
  | 'narrative_fact'
  | 'non_recollection'
  | 'declined_to_answer';

export interface PropositionTypeDescriptor {
  readonly type: PropositionType;
  readonly family: PropositionFamily;
  /** Higher rank = stronger canonical claim. Never used to coerce roles. */
  readonly strength_rank: number;
  /** True when the type may only be produced from inspected evidence. */
  readonly requires_inspected_evidence: boolean;
  /** True when the type records the absence of an answer rather than a fact. */
  readonly is_non_answer: boolean;
}

const DESCRIPTOR_LIST: readonly PropositionTypeDescriptor[] = [
  {
    type: 'target_date',
    family: 'date_commitment',
    strength_rank: 1,
    requires_inspected_evidence: false,
    is_non_answer: false,
  },
  {
    type: 'contractual_deadline',
    family: 'date_commitment',
    strength_rank: 2,
    requires_inspected_evidence: false,
    is_non_answer: false,
  },
  {
    type: 'invoice',
    family: 'monetary_instrument',
    strength_rank: 1,
    requires_inspected_evidence: false,
    is_non_answer: false,
  },
  {
    type: 'payment',
    family: 'monetary_instrument',
    strength_rank: 2,
    requires_inspected_evidence: false,
    is_non_answer: false,
  },
  {
    type: 'requested_scope',
    family: 'scope',
    strength_rank: 1,
    requires_inspected_evidence: false,
    is_non_answer: false,
  },
  {
    type: 'accepted_scope',
    family: 'scope',
    strength_rank: 2,
    requires_inspected_evidence: false,
    is_non_answer: false,
  },
  {
    type: 'disputed_balance',
    family: 'balance',
    strength_rank: 1,
    requires_inspected_evidence: false,
    is_non_answer: false,
  },
  {
    type: 'established_debt',
    family: 'balance',
    strength_rank: 2,
    requires_inspected_evidence: false,
    is_non_answer: false,
  },
  {
    type: 'requested_remedy',
    family: 'remedy',
    strength_rank: 1,
    requires_inspected_evidence: false,
    is_non_answer: false,
  },
  {
    type: 'established_entitlement',
    family: 'remedy',
    strength_rank: 2,
    requires_inspected_evidence: false,
    is_non_answer: false,
  },
  {
    type: 'recalled_document_content',
    family: 'document_content',
    strength_rank: 1,
    requires_inspected_evidence: false,
    is_non_answer: false,
  },
  {
    type: 'verified_document_content',
    family: 'document_content',
    strength_rank: 2,
    requires_inspected_evidence: true,
    is_non_answer: false,
  },
  {
    type: 'narrative_fact',
    family: 'narrative',
    strength_rank: 1,
    requires_inspected_evidence: false,
    is_non_answer: false,
  },
  {
    type: 'non_recollection',
    family: 'non_answer',
    strength_rank: 0,
    requires_inspected_evidence: false,
    is_non_answer: true,
  },
  {
    type: 'declined_to_answer',
    family: 'non_answer',
    strength_rank: 0,
    requires_inspected_evidence: false,
    is_non_answer: true,
  },
];

export const PROPOSITION_TYPES: readonly PropositionType[] = DESCRIPTOR_LIST.map((d) => d.type);

const DESCRIPTORS = new Map<PropositionType, PropositionTypeDescriptor>(
  DESCRIPTOR_LIST.map((d) => [d.type, d]),
);

export function propositionTypeDescriptor(type: PropositionType): PropositionTypeDescriptor {
  const descriptor = DESCRIPTORS.get(type);
  if (!descriptor) throw new TypeError(`Unknown proposition type: ${String(type)}`);
  return descriptor;
}

export function isPropositionType(value: unknown): value is PropositionType {
  return typeof value === 'string' && DESCRIPTORS.has(value as PropositionType);
}

/**
 * Weaker -> stronger pairs that the architecture must never allow to collapse.
 * Exposed so the structural validator and its tests assert the same table.
 */
export const NON_COERCIBLE_TYPE_PAIRS: ReadonlyArray<readonly [PropositionType, PropositionType]> =
  [
    ['target_date', 'contractual_deadline'],
    ['invoice', 'payment'],
    ['requested_scope', 'accepted_scope'],
    ['disputed_balance', 'established_debt'],
    ['requested_remedy', 'established_entitlement'],
    ['recalled_document_content', 'verified_document_content'],
  ];

/**
 * Role satisfaction is exact set membership. Same family is NOT close enough;
 * a `target_date` can never stand in for a `contractual_deadline` role.
 */
export function canSatisfyRole(
  type: PropositionType,
  satisfyingTypes: readonly PropositionType[],
): boolean {
  return satisfyingTypes.includes(type);
}

/* ------------------------------------------------------------------------ */
/* Epistemic strength — a compiler-classified FIELD, not a proof.            */
/* ------------------------------------------------------------------------ */

export type EpistemicStrength =
  | 'asserted_confident'
  | 'asserted_qualified'
  | 'recalled_uncertain'
  | 'non_recollection'
  | 'disputed_by_user'
  | 'declined';

export const EPISTEMIC_STRENGTHS: readonly EpistemicStrength[] = [
  'asserted_confident',
  'asserted_qualified',
  'recalled_uncertain',
  'non_recollection',
  'disputed_by_user',
  'declined',
];

export function isEpistemicStrength(value: unknown): value is EpistemicStrength {
  return typeof value === 'string' && EPISTEMIC_STRENGTHS.includes(value as EpistemicStrength);
}

/** Human-facing label. The render MUST surface this for every proposition. */
export function describeEpistemicStrength(strength: EpistemicStrength): string {
  switch (strength) {
    case 'asserted_confident':
      return 'stated as certain';
    case 'asserted_qualified':
      return 'stated with qualification';
    case 'recalled_uncertain':
      return 'recalled, uncertain';
    case 'non_recollection':
      return 'does not recall';
    case 'disputed_by_user':
      return 'disputed';
    case 'declined':
      return 'declined to answer';
  }
}

/* ------------------------------------------------------------------------ */
/* Evidence references (V0: reference only, no upload through WebMCP).       */
/* ------------------------------------------------------------------------ */

export type EvidenceInspectionStatus = 'uninspected' | 'inspected';

export interface EvidenceReference {
  evidence_ref_id: string;
  case_id: string;
  label: string;
  inspection_status: EvidenceInspectionStatus;
  source_channel: SourceChannel;
  created_at_case_version: number;
}

/* ------------------------------------------------------------------------ */
/* Response-slot semantics: what may cross the WebMCP boundary.              */
/* ------------------------------------------------------------------------ */

/** The only keys `get_case_state` is permitted to return. */
export const PERMITTED_CASE_STATE_SLOTS = [
  'case_id',
  'case_version',
  'protocol_version',
  'schema_version',
  'status',
  'unresolved_requirement_count',
  'next_requirements',
  'open_clarifications',
  'recent_interpretations',
  'evidence_references',
  'warnings',
  'review_url',
] as const;

export type PermittedCaseStateSlot = (typeof PERMITTED_CASE_STATE_SLOTS)[number];

/**
 * Slots that must never leave the server. Anything here either hands the relay
 * an optimisation target, leaks internals it could steer around, or exposes
 * data belonging to someone other than the authenticated principal.
 */
export const FORBIDDEN_CASE_STATE_SLOTS = [
  'readiness_score',
  'completion_percentage',
  'legal_strength',
  'predicted_outcome',
  'adverse_fact_internals',
  'compiler_confidence',
  'compiler_version',
  'validator_internals',
  'requirement_taxonomy',
  'raw_evidence_text',
  'full_turn_history',
  'other_cases',
  'admin_notes',
  'auth_secrets',
  'principal_id',
] as const;

export type ForbiddenCaseStateSlot = (typeof FORBIDDEN_CASE_STATE_SLOTS)[number];

export interface NextRequirementSlot {
  requirement_id: string;
  prompt: string;
}

export interface OpenClarificationSlot {
  clarification_id: string;
  requirement_id: string;
  prompt: string;
}

export interface RecentInterpretationSlot {
  proposition_id: string;
  requirement_id: string;
  /** JuryAI's own wording, never the agent's summary. */
  statement: string;
  type: PropositionType;
  epistemic_strength: EpistemicStrength;
  attribution: string;
}

export interface EvidenceReferenceSlot {
  evidence_ref_id: string;
  label: string;
  inspection_status: EvidenceInspectionStatus;
}

export interface CaseStateResponse {
  case_id: string;
  case_version: number;
  protocol_version: string;
  schema_version: string;
  status: CaseStatus;
  unresolved_requirement_count: number;
  next_requirements: NextRequirementSlot[];
  open_clarifications: OpenClarificationSlot[];
  recent_interpretations: RecentInterpretationSlot[];
  evidence_references: EvidenceReferenceSlot[];
  warnings: string[];
  review_url: string;
}

/**
 * Agent-facing case content is data, never instructions. Wrapping is applied
 * at the boundary so injected text carried inside a user's own words cannot
 * present itself as a directive to the relaying model.
 */
export const AGENT_DATA_BLOCK_OPEN = '<<<JURYAI_CASE_DATA';
export const AGENT_DATA_BLOCK_CLOSE = 'JURYAI_CASE_DATA>>>';
export const AGENT_DATA_MAX_LENGTH = 4000;

export function wrapAgentFacingText(text: string): string {
  const stripped = text
    .split(AGENT_DATA_BLOCK_OPEN)
    .join('')
    .split(AGENT_DATA_BLOCK_CLOSE)
    .join('');
  const capped =
    stripped.length > AGENT_DATA_MAX_LENGTH
      ? `${stripped.slice(0, AGENT_DATA_MAX_LENGTH)}…[truncated]`
      : stripped;
  return `${AGENT_DATA_BLOCK_OPEN}\n${capped}\n${AGENT_DATA_BLOCK_CLOSE}`;
}

export function assertNoForbiddenSlots(response: Record<string, unknown>): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const permitted = new Set<string>(PERMITTED_CASE_STATE_SLOTS);
  for (const key of Object.keys(response).sort()) {
    if (!permitted.has(key)) {
      issues.push(
        issue(
          'response_slot_not_permitted',
          `response.${key}`,
          `Slot '${key}' is not in the permitted get_case_state allowlist.`,
        ),
      );
    }
  }
  return issues;
}
