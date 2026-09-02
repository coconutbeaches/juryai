import {
  canonicalSerialize,
  cloneCanonical,
  sha256,
  type ContractIssue,
} from '../v2/case-envelope.js';
import type { AmbiguityReason } from '../webmcp/core/compiler-contract.js';
import { CONFLICT_EXCERPT_LENGTH, computeRequestFingerprint } from '../webmcp/core/idempotency.js';
import type { ConflictTurnSummary } from '../webmcp/public-contract.js';
import {
  isEpistemicStrength,
  isPropositionType,
  propositionTypeDescriptor,
  type EpistemicStrength,
  type PropositionType,
  type SourceChannel,
} from '../webmcp/core/types.js';
import {
  computePayloadCommitment,
  normalizePayload,
  validatePayloadShape,
  verifyTurnSpan,
  type SourceTurnPayload,
  type TurnSpan,
} from '../webmcp/core/turns.js';
import {
  EXTERNAL_RELAY_SUBMISSION_INTENT_VERSION_V211,
  EXTERNAL_RELAY_SUBMISSION_VERSION_V211,
  HASH_PATTERN_V211,
  ID_PATTERN_V211,
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  PARTY_IDS_V211,
  cloneCaseEnvelopeV211,
  hashCaseEnvelopeV211,
  isAuthenticatedPartyAuthorityV211,
  isPartyScopedIdV211,
  otherPartyV211,
  type AuthenticatedPartyAuthorityV211,
  type CanonicalSemanticPositionV211,
  type CaseEnvelopeV211,
  type FormationChallengeV211,
  type FormationClarificationV211,
  type PartyIdV211,
  type SourceSpanCommitmentV211,
  type SourceTurnV211,
} from './case-envelope.js';
import { validateCaseEnvelopeV211 } from './contract-validator.js';
import { refreshPartyViewCursorsV211 } from './envelope-ceremony.js';
import { authoritativeFormationExplanatoryStateV211 } from './formation-readiness.js';

export interface ExternalRelaySubmissionIntentV211 {
  intent_version: typeof EXTERNAL_RELAY_SUBMISSION_INTENT_VERSION_V211;
  expected_party_visible_version: number;
  expected_party_projection_hash: string;
  client_turn_id: string;
  in_reply_to: string[];
  payload: SourceTurnPayload;
  source_language: string | null;
  translation_indicated: boolean;
}

export interface SemanticAssertionCandidateEffectV211 {
  type: 'semantic_assertion_candidate';
  compiler_assertion_id: string;
  requirement_id: string;
  proposed_type: PropositionType;
  epistemic_strength: EpistemicStrength;
  statement: string;
  spans: TurnSpan[];
  supersedes_candidate: string | null;
}

export interface ClarificationRequestEffectV211 {
  type: 'clarification_request';
  requirement_id: string;
  reason: AmbiguityReason;
  prompt: string;
}

export interface ChallengeCandidateEffectV211 {
  type: 'challenge_candidate';
  target_position_id: string;
  statement: string;
  spans: TurnSpan[];
}

export interface ChallengeResponseCandidateEffectV211 {
  type: 'challenge_response_candidate';
  challenge_id: string;
  statement: string;
  spans: TurnSpan[];
  semantic_correction: SemanticAssertionCandidateEffectV211 | null;
}

export type ExternalRelayEffectCandidateV211 =
  | SemanticAssertionCandidateEffectV211
  | ClarificationRequestEffectV211
  | ChallengeCandidateEffectV211
  | ChallengeResponseCandidateEffectV211;

export interface PreparedSemanticAssertionEffectV211 extends SemanticAssertionCandidateEffectV211 {
  position_id: string;
}

export interface PreparedClarificationRequestEffectV211 extends ClarificationRequestEffectV211 {
  clarification_id: string;
}

export interface PreparedChallengeEffectV211 extends ChallengeCandidateEffectV211 {
  challenge_id: string;
}

export interface PreparedChallengeResponseEffectV211 extends Omit<
  ChallengeResponseCandidateEffectV211,
  'semantic_correction'
> {
  response_id: string;
  semantic_correction: PreparedSemanticAssertionEffectV211 | null;
}

export type PreparedExternalRelayEffectV211 =
  | PreparedSemanticAssertionEffectV211
  | PreparedClarificationRequestEffectV211
  | PreparedChallengeEffectV211
  | PreparedChallengeResponseEffectV211;

export interface ExternalRelayCompilerIdentityV211 {
  compile_run_id: string;
  compiler_version_id: string;
  party_projection_contract_version: typeof PARTY_FORMATION_PROJECTION_VERSION_V211;
  input_hash: string;
  output_hash: string;
}

export interface ExternalRelaySubmissionV211 {
  submission_version: typeof EXTERNAL_RELAY_SUBMISSION_VERSION_V211;
  submission_id: string;
  dispute_id: string;
  base_party_visible_version: number;
  base_party_projection_hash: string;
  base_internal_envelope_version: number;
  base_internal_envelope_hash: string;
  source_turn: SourceTurnV211;
  compiler_run: ExternalRelayCompilerIdentityV211;
  effects: PreparedExternalRelayEffectV211[];
}

export interface ExternalRelayCanonicalIdsV211 {
  submission_id: string;
  source_turn_id: string;
  position_ids: string[];
  clarification_ids: string[];
  challenge_ids: string[];
  challenge_response_ids: string[];
}

const RELAY_RUNTIME_BRAND_V211: unique symbol = Symbol('juryai-relay-runtime-v2.1.1');

export interface TrustedExternalRelayRuntimeV211 {
  readonly source_channel: SourceChannel;
  readonly relaying_agent: string | null;
  readonly received_at: string;
  readonly payload_commitment_salt: string;
  readonly ids: ExternalRelayCanonicalIdsV211;
  readonly [RELAY_RUNTIME_BRAND_V211]: true;
}

export const TRUSTED_EXTERNAL_RELAY_BRIDGE_V211 = Object.freeze({
  authority_kind: 'trusted_external_relay_bridge_v2_1_1' as const,
});

export function trustedExternalRelayRuntimeV211(
  bridge: typeof TRUSTED_EXTERNAL_RELAY_BRIDGE_V211,
  input: Omit<TrustedExternalRelayRuntimeV211, typeof RELAY_RUNTIME_BRAND_V211>,
): TrustedExternalRelayRuntimeV211 {
  if (bridge !== TRUSTED_EXTERNAL_RELAY_BRIDGE_V211) {
    throw new TypeError('Trusted external relay bridge is required.');
  }
  return Object.freeze({ ...input, [RELAY_RUNTIME_BRAND_V211]: true as const });
}

function isTrustedExternalRelayRuntimeV211(
  value: unknown,
): value is TrustedExternalRelayRuntimeV211 {
  return (
    typeof value === 'object' &&
    value !== null &&
    RELAY_RUNTIME_BRAND_V211 in value &&
    (value as TrustedExternalRelayRuntimeV211)[RELAY_RUNTIME_BRAND_V211] === true
  );
}

export type PrepareExternalRelaySubmissionResultV211 =
  | { status: 'prepared'; submission: ExternalRelaySubmissionV211 }
  | { status: 'rejected'; reason_code: 'invalid_intent' | 'unauthorized_actor'; message: string };

function validIso(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

function turnSpanShape(value: unknown): value is TurnSpan {
  if (
    !hasExactKeys(value, [
      'encoding',
      'end',
      'message_index',
      'quote',
      'region',
      'start',
      'turn_id',
    ])
  ) {
    return false;
  }
  const span = value as Record<string, unknown>;
  return (
    typeof span.turn_id === 'string' &&
    ['answer', 'context'].includes(String(span.region)) &&
    (span.message_index === null || Number.isSafeInteger(span.message_index)) &&
    span.encoding === 'utf16' &&
    Number.isSafeInteger(span.start) &&
    Number.isSafeInteger(span.end) &&
    typeof span.quote === 'string'
  );
}

function spansShape(value: unknown): value is TurnSpan[] {
  return Array.isArray(value) && value.every(turnSpanShape);
}

function candidateEffectShape(effect: unknown): effect is ExternalRelayEffectCandidateV211 {
  if (typeof effect !== 'object' || effect === null || !('type' in effect)) return false;
  const typed = effect as Record<string, unknown>;
  switch (typed.type) {
    case 'semantic_assertion_candidate':
      return (
        hasExactKeys(effect, [
          'compiler_assertion_id',
          'epistemic_strength',
          'proposed_type',
          'requirement_id',
          'spans',
          'statement',
          'supersedes_candidate',
          'type',
        ]) &&
        typeof typed.compiler_assertion_id === 'string' &&
        typeof typed.requirement_id === 'string' &&
        typeof typed.proposed_type === 'string' &&
        typeof typed.epistemic_strength === 'string' &&
        typeof typed.statement === 'string' &&
        spansShape(typed.spans) &&
        (typed.supersedes_candidate === null || typeof typed.supersedes_candidate === 'string')
      );
    case 'clarification_request':
      return (
        hasExactKeys(effect, ['prompt', 'reason', 'requirement_id', 'type']) &&
        typeof typed.prompt === 'string' &&
        typeof typed.reason === 'string' &&
        typeof typed.requirement_id === 'string'
      );
    case 'challenge_candidate':
      return (
        hasExactKeys(effect, ['spans', 'statement', 'target_position_id', 'type']) &&
        spansShape(typed.spans) &&
        typeof typed.statement === 'string' &&
        typeof typed.target_position_id === 'string'
      );
    case 'challenge_response_candidate':
      return (
        hasExactKeys(effect, [
          'challenge_id',
          'semantic_correction',
          'spans',
          'statement',
          'type',
        ]) &&
        (typed.semantic_correction === null || candidateEffectShape(typed.semantic_correction)) &&
        (typed.semantic_correction === null ||
          (typed.semantic_correction as ExternalRelayEffectCandidateV211).type ===
            'semantic_assertion_candidate') &&
        typeof typed.challenge_id === 'string' &&
        typeof typed.statement === 'string' &&
        spansShape(typed.spans)
      );
    default:
      return false;
  }
}

function preparedEffectShape(effect: unknown): effect is PreparedExternalRelayEffectV211 {
  if (typeof effect !== 'object' || effect === null || !('type' in effect)) return false;
  const typed = effect as Record<string, unknown>;
  switch (typed.type) {
    case 'semantic_assertion_candidate':
      return (
        hasExactKeys(effect, [
          'compiler_assertion_id',
          'epistemic_strength',
          'position_id',
          'proposed_type',
          'requirement_id',
          'spans',
          'statement',
          'supersedes_candidate',
          'type',
        ]) &&
        typeof typed.position_id === 'string' &&
        candidateEffectShape((({ position_id: _positionId, ...rest }) => rest)(typed))
      );
    case 'clarification_request':
      return (
        hasExactKeys(effect, ['clarification_id', 'prompt', 'reason', 'requirement_id', 'type']) &&
        typeof typed.clarification_id === 'string' &&
        typeof typed.prompt === 'string' &&
        typeof typed.reason === 'string' &&
        typeof typed.requirement_id === 'string'
      );
    case 'challenge_candidate':
      return (
        hasExactKeys(effect, [
          'challenge_id',
          'spans',
          'statement',
          'target_position_id',
          'type',
        ]) &&
        typeof typed.challenge_id === 'string' &&
        typeof typed.target_position_id === 'string' &&
        typeof typed.statement === 'string' &&
        spansShape(typed.spans)
      );
    case 'challenge_response_candidate':
      return (
        hasExactKeys(effect, [
          'challenge_id',
          'response_id',
          'semantic_correction',
          'spans',
          'statement',
          'type',
        ]) &&
        (typed.semantic_correction === null || preparedEffectShape(typed.semantic_correction)) &&
        (typed.semantic_correction === null ||
          (typed.semantic_correction as PreparedExternalRelayEffectV211).type ===
            'semantic_assertion_candidate') &&
        typeof typed.challenge_id === 'string' &&
        typeof typed.response_id === 'string' &&
        typeof typed.statement === 'string' &&
        spansShape(typed.spans)
      );
    default:
      return false;
  }
}

function idsHaveScope(ids: ExternalRelayCanonicalIdsV211, partyId: PartyIdV211): boolean {
  return (
    ID_PATTERN_V211.test(ids.submission_id) &&
    ids.submission_id.startsWith(`submission_${partyId}_`) &&
    isPartyScopedIdV211('turn', partyId, ids.source_turn_id) &&
    ids.position_ids.every((id) => isPartyScopedIdV211('position', partyId, id)) &&
    ids.clarification_ids.every((id) => isPartyScopedIdV211('clarification', partyId, id)) &&
    ids.challenge_ids.every((id) => isPartyScopedIdV211('challenge', partyId, id)) &&
    ids.challenge_response_ids.every((id) => isPartyScopedIdV211('challenge_response', partyId, id))
  );
}

function requiredIdCounts(effects: readonly ExternalRelayEffectCandidateV211[]) {
  let positions = 0;
  let clarifications = 0;
  let challenges = 0;
  let responses = 0;
  for (const effect of effects) {
    if (effect.type === 'semantic_assertion_candidate') positions += 1;
    if (effect.type === 'clarification_request') clarifications += 1;
    if (effect.type === 'challenge_candidate') challenges += 1;
    if (effect.type === 'challenge_response_candidate') {
      responses += 1;
      if (effect.semantic_correction) positions += 1;
    }
  }
  return { positions, clarifications, challenges, responses };
}

function replyTargetVisibleToPartyV211(
  envelope: CaseEnvelopeV211,
  partyId: PartyIdV211,
  targetId: string,
): boolean {
  const requirement = envelope.requirements[targetId];
  if (requirement) return requirement.party_id === partyId;
  const clarification = envelope.clarifications[targetId];
  if (clarification) return clarification.party_id === partyId;
  const position = envelope.positions[targetId];
  if (position) {
    return (
      position.attributed_party_id === partyId || envelope.control.disclosure_state === 'disclosed'
    );
  }
  const challenge = envelope.challenges[targetId];
  return Boolean(
    challenge &&
    envelope.control.disclosure_state === 'disclosed' &&
    (challenge.challenging_party_id === partyId || challenge.target_party_id === partyId),
  );
}

export function prepareExternalRelaySubmissionV211(input: {
  envelope: CaseEnvelopeV211;
  execution_authority: AuthenticatedPartyAuthorityV211;
  intent: ExternalRelaySubmissionIntentV211;
  runtime: TrustedExternalRelayRuntimeV211;
  compiler_run: ExternalRelayCompilerIdentityV211;
  effects: ExternalRelayEffectCandidateV211[];
}): PrepareExternalRelaySubmissionResultV211 {
  const {
    envelope,
    execution_authority: authority,
    intent,
    runtime,
    compiler_run,
    effects,
  } = input;
  if (
    !isAuthenticatedPartyAuthorityV211(authority) ||
    authority.interaction_authority !== 'external_relay' ||
    envelope.parties[authority.party_id].identity_assurance !== 'authenticated' ||
    envelope.parties[authority.party_id].authenticated_subject_id !==
      authority.authenticated_subject_id ||
    !isTrustedExternalRelayRuntimeV211(runtime)
  ) {
    return {
      status: 'rejected',
      reason_code: 'unauthorized_actor',
      message: 'Server-derived external relay authority is required.',
    };
  }
  if (
    !hasExactKeys(intent, [
      'client_turn_id',
      'expected_party_projection_hash',
      'expected_party_visible_version',
      'in_reply_to',
      'intent_version',
      'payload',
      'source_language',
      'translation_indicated',
    ]) ||
    !hasExactKeys(compiler_run, [
      'compile_run_id',
      'compiler_version_id',
      'input_hash',
      'output_hash',
      'party_projection_contract_version',
    ]) ||
    !Array.isArray(intent.in_reply_to) ||
    !Array.isArray(effects) ||
    !effects.every(candidateEffectShape)
  ) {
    return {
      status: 'rejected',
      reason_code: 'invalid_intent',
      message: 'External relay submission intent shape is invalid.',
    };
  }
  const cursor = envelope.control.party_views[authority.party_id];
  const counts = requiredIdCounts(effects);
  const normalizedTargets = [...new Set(intent.in_reply_to)].sort();
  let normalizedPayload: SourceTurnPayload;
  try {
    normalizedPayload = normalizePayload(intent.payload);
  } catch {
    return {
      status: 'rejected',
      reason_code: 'invalid_intent',
      message: 'Source payload is invalid.',
    };
  }
  const payloadIssues = validatePayloadShape(normalizedPayload, 'intent.payload');
  const allIds = [
    runtime.ids.submission_id,
    runtime.ids.source_turn_id,
    ...runtime.ids.position_ids,
    ...runtime.ids.clarification_ids,
    ...runtime.ids.challenge_ids,
    ...runtime.ids.challenge_response_ids,
  ];
  if (
    !hasExactKeys(intent, [
      'client_turn_id',
      'expected_party_projection_hash',
      'expected_party_visible_version',
      'in_reply_to',
      'intent_version',
      'payload',
      'source_language',
      'translation_indicated',
    ]) ||
    !hasExactKeys(compiler_run, [
      'compile_run_id',
      'compiler_version_id',
      'input_hash',
      'output_hash',
      'party_projection_contract_version',
    ]) ||
    !Array.isArray(effects) ||
    !effects.every(candidateEffectShape) ||
    intent.intent_version !== EXTERNAL_RELAY_SUBMISSION_INTENT_VERSION_V211 ||
    !Number.isSafeInteger(intent.expected_party_visible_version) ||
    intent.expected_party_visible_version < 1 ||
    !HASH_PATTERN_V211.test(intent.expected_party_projection_hash) ||
    intent.expected_party_visible_version !== cursor.party_visible_version ||
    intent.expected_party_projection_hash !== cursor.party_projection_hash ||
    typeof intent.client_turn_id !== 'string' ||
    intent.client_turn_id.trim().length === 0 ||
    intent.client_turn_id.length > 200 ||
    !Array.isArray(intent.in_reply_to) ||
    !intent.in_reply_to.every(
      (target) =>
        ID_PATTERN_V211.test(target) &&
        replyTargetVisibleToPartyV211(envelope, authority.party_id, target),
    ) ||
    typeof intent.translation_indicated !== 'boolean' ||
    (intent.source_language !== null && typeof intent.source_language !== 'string') ||
    !validIso(runtime.received_at) ||
    runtime.payload_commitment_salt.length < 16 ||
    runtime.source_channel !== 'webmcp_agent_relay' ||
    !idsHaveScope(runtime.ids, authority.party_id) ||
    new Set(allIds).size !== allIds.length ||
    runtime.ids.position_ids.length !== counts.positions ||
    runtime.ids.clarification_ids.length !== counts.clarifications ||
    runtime.ids.challenge_ids.length !== counts.challenges ||
    runtime.ids.challenge_response_ids.length !== counts.responses ||
    !ID_PATTERN_V211.test(compiler_run.compile_run_id) ||
    ![compiler_run.compiler_version_id, compiler_run.input_hash, compiler_run.output_hash].every(
      (value) => HASH_PATTERN_V211.test(value),
    ) ||
    compiler_run.party_projection_contract_version !==
      envelope.control.projection_contract_version ||
    payloadIssues.length > 0
  ) {
    return {
      status: 'rejected',
      reason_code: 'invalid_intent',
      message: payloadIssues[0]?.message ?? 'External relay submission intent is invalid.',
    };
  }

  let positionIndex = 0;
  let clarificationIndex = 0;
  let challengeIndex = 0;
  let responseIndex = 0;
  const preparedEffects: PreparedExternalRelayEffectV211[] = effects.map((effect) => {
    switch (effect.type) {
      case 'semantic_assertion_candidate':
        return {
          ...cloneCanonical(effect),
          position_id: runtime.ids.position_ids[positionIndex++]!,
        };
      case 'clarification_request':
        return {
          ...cloneCanonical(effect),
          clarification_id: runtime.ids.clarification_ids[clarificationIndex++]!,
        };
      case 'challenge_candidate':
        return {
          ...cloneCanonical(effect),
          challenge_id: runtime.ids.challenge_ids[challengeIndex++]!,
        };
      case 'challenge_response_candidate':
        return {
          ...cloneCanonical(effect),
          response_id: runtime.ids.challenge_response_ids[responseIndex++]!,
          semantic_correction: effect.semantic_correction
            ? {
                ...cloneCanonical(effect.semantic_correction),
                position_id: runtime.ids.position_ids[positionIndex++]!,
              }
            : null,
        };
    }
  });
  const sourceTurn: SourceTurnV211 = {
    turn_id: runtime.ids.source_turn_id,
    dispute_id: envelope.control.case_id,
    attributed_party_id: authority.party_id,
    authenticated_subject_id_at_receipt: authority.authenticated_subject_id,
    party_visible_version_before: cursor.party_visible_version,
    received_at: runtime.received_at,
    source_channel: runtime.source_channel,
    relaying_agent: runtime.relaying_agent,
    source_language: intent.source_language,
    translation_indicated: intent.translation_indicated,
    in_reply_to: normalizedTargets,
    client_turn_id: intent.client_turn_id,
    request_fingerprint: computeRequestFingerprint({
      principal_id: authority.authenticated_subject_id,
      case_id: envelope.control.case_id,
      in_reply_to: normalizedTargets,
      payload: normalizedPayload,
    }),
    payload: normalizedPayload,
    payload_layout: {
      context_utf16_lengths: normalizedPayload.context.map((message) => message.text.length),
      answer_utf16_length: normalizedPayload.answer.text.length,
    },
    payload_commitment_salt: runtime.payload_commitment_salt,
    payload_commitment: computePayloadCommitment(
      normalizedPayload,
      runtime.payload_commitment_salt,
    ),
    compile_run_id: compiler_run.compile_run_id,
    redacted_at: null,
    redacted_at_envelope_version: null,
  };
  return {
    status: 'prepared',
    submission: {
      submission_version: EXTERNAL_RELAY_SUBMISSION_VERSION_V211,
      submission_id: runtime.ids.submission_id,
      dispute_id: envelope.control.case_id,
      base_party_visible_version: cursor.party_visible_version,
      base_party_projection_hash: cursor.party_projection_hash,
      base_internal_envelope_version: envelope.control.envelope_version,
      base_internal_envelope_hash: envelope.control.envelope_hash,
      source_turn: sourceTurn,
      compiler_run: cloneCanonical(compiler_run),
      effects: preparedEffects,
    },
  };
}

export type ExternalRelaySubmissionFailureReasonV211 =
  | 'invalid_envelope'
  | 'invalid_submission'
  | 'unauthorized_actor'
  | 'case_mismatch'
  | 'stale_internal_state'
  | 'party_projection_stale'
  | 'explicit_reopen_required'
  | 'workflow_state_forbidden'
  | 'source_turn_collision'
  | 'span_fidelity_failed'
  | 'effect_rejected'
  | 'resulting_envelope_invalid';

export interface AppliedExternalRelaySubmissionV211 {
  accepted_position_ids: string[];
  superseded_position_ids: string[];
  opened_clarification_ids: string[];
  resolved_clarification_ids: string[];
  challenge_ids: string[];
  challenge_response_ids: string[];
  warnings: string[];
}

export type ApplyExternalRelaySubmissionResultV211 =
  | {
      status: 'applied';
      reason_code: null;
      message: string;
      envelope: CaseEnvelopeV211;
      prior_envelope_version: number;
      resulting_envelope_version: number;
      changed_visible_parties: PartyIdV211[];
      result: AppliedExternalRelaySubmissionV211;
    }
  | {
      status: 'rejected';
      reason_code: ExternalRelaySubmissionFailureReasonV211;
      message: string;
      issues: ContractIssue[];
      envelope: CaseEnvelopeV211;
      prior_envelope_version: number;
      resulting_envelope_version: number;
      changed_visible_parties: [];
    };

function rejected(
  envelope: CaseEnvelopeV211,
  reason: ExternalRelaySubmissionFailureReasonV211,
  message: string,
  issues: ContractIssue[] = [],
): ApplyExternalRelaySubmissionResultV211 {
  return {
    status: 'rejected',
    reason_code: reason,
    message,
    issues,
    envelope: cloneCaseEnvelopeV211(envelope),
    prior_envelope_version: envelope.control.envelope_version,
    resulting_envelope_version: envelope.control.envelope_version,
    changed_visible_parties: [],
  };
}

function spanCommitments(
  spans: readonly TurnSpan[],
  source: SourceTurnV211,
  path: string,
): { commitments: SourceSpanCommitmentV211[]; issues: ContractIssue[] } {
  const issues: ContractIssue[] = [];
  if (spans.length === 0 || source.payload === null) {
    return {
      commitments: [],
      issues: [
        {
          code: 'v211_span_missing',
          path,
          message: 'Relay semantic effects require at least one span over readable source text.',
        },
      ],
    };
  }
  for (const [index, span] of spans.entries()) {
    issues.push(...verifyTurnSpan(source.payload, span, `${path}[${index}]`).issues);
    if (span.turn_id !== source.turn_id) {
      issues.push({
        code: 'v211_span_turn_mismatch',
        path: `${path}[${index}].turn_id`,
        message: 'Every effect span must reference the submission source turn.',
      });
    }
  }
  return {
    commitments: spans.map((span) => ({
      turn_id: span.turn_id,
      region: span.region,
      message_index: span.message_index,
      encoding: span.encoding,
      start: span.start,
      end: span.end,
      quote_hash: sha256(span.quote),
    })),
    issues,
  };
}

function assertionFailure(
  envelope: CaseEnvelopeV211,
  partyId: PartyIdV211,
  effect: PreparedSemanticAssertionEffectV211,
  source: SourceTurnV211,
  claimedSlots: Set<string>,
  claimedTargets: Set<string>,
  path: string,
): { issue: ContractIssue | null; commitments: SourceSpanCommitmentV211[] } {
  const spanResult = spanCommitments(effect.spans, source, `${path}.spans`);
  if (spanResult.issues.length > 0) return { issue: spanResult.issues[0]!, commitments: [] };
  const requirement = envelope.requirements[effect.requirement_id];
  if (
    !requirement ||
    requirement.party_id !== partyId ||
    !source.in_reply_to.includes(effect.requirement_id)
  ) {
    return {
      issue: {
        code: 'v211_assertion_requirement',
        path,
        message: 'Assertion requirement is unavailable.',
      },
      commitments: [],
    };
  }
  if (
    !isPropositionType(effect.proposed_type) ||
    !isEpistemicStrength(effect.epistemic_strength) ||
    effect.statement.trim().length === 0 ||
    !ID_PATTERN_V211.test(effect.compiler_assertion_id) ||
    propositionTypeDescriptor(effect.proposed_type).requires_inspected_evidence
  ) {
    return {
      issue: {
        code: 'v211_assertion_semantics',
        path,
        message: 'Assertion semantics are invalid.',
      },
      commitments: [],
    };
  }
  if (envelope.positions[effect.position_id]) {
    return {
      issue: { code: 'v211_position_id_collision', path, message: 'Position id already exists.' },
      commitments: [],
    };
  }
  const slot = `${effect.requirement_id}|${effect.proposed_type}`;
  if (claimedSlots.has(slot)) {
    return {
      issue: {
        code: 'v211_assertion_slot_duplicate',
        path,
        message: 'Compiler assertion slot is duplicated.',
      },
      commitments: [],
    };
  }
  claimedSlots.add(slot);
  const existing = Object.values(envelope.positions).find(
    (position) =>
      position.attributed_party_id === partyId &&
      position.requirement_id === effect.requirement_id &&
      position.proposition_type === effect.proposed_type &&
      position.superseded_by === null,
  );
  if (effect.supersedes_candidate === null) {
    if (existing) {
      return {
        issue: {
          code: 'v211_live_position_slot_collision',
          path,
          message: 'Live position slot already exists.',
        },
        commitments: [],
      };
    }
  } else {
    const target = envelope.positions[effect.supersedes_candidate];
    if (
      !target ||
      target.attributed_party_id !== partyId ||
      target.requirement_id !== effect.requirement_id ||
      target.superseded_by !== null ||
      claimedTargets.has(target.position_id) ||
      (existing && existing.position_id !== target.position_id)
    ) {
      return {
        issue: {
          code: 'v211_supersession_target',
          path,
          message: 'Supersession target is invalid.',
        },
        commitments: [],
      };
    }
    claimedTargets.add(target.position_id);
  }
  return { issue: null, commitments: spanResult.commitments };
}

function materialOwnEdit(effect: PreparedExternalRelayEffectV211): boolean {
  return (
    effect.type === 'semantic_assertion_candidate' ||
    effect.type === 'clarification_request' ||
    (effect.type === 'challenge_response_candidate' && effect.semantic_correction !== null)
  );
}

export function rebaseExternalRelaySubmissionV211(
  submission: ExternalRelaySubmissionV211,
  current: CaseEnvelopeV211,
): ExternalRelaySubmissionV211 | null {
  const partyId = submission.source_turn.attributed_party_id;
  const cursor = current.control.party_views[partyId];
  if (
    current.control.case_id !== submission.dispute_id ||
    cursor.party_visible_version !== submission.base_party_visible_version ||
    cursor.party_projection_hash !== submission.base_party_projection_hash
  ) {
    return null;
  }
  return {
    ...cloneCanonical(submission),
    base_internal_envelope_version: current.control.envelope_version,
    base_internal_envelope_hash: current.control.envelope_hash,
  };
}

export function applyExternalRelaySubmissionV211(input: {
  envelope: CaseEnvelopeV211;
  submission: ExternalRelaySubmissionV211;
  execution_authority: AuthenticatedPartyAuthorityV211;
}): ApplyExternalRelaySubmissionResultV211 {
  const { envelope, submission, execution_authority: authority } = input;
  const inputIssues = validateCaseEnvelopeV211(envelope);
  if (inputIssues.length > 0) {
    return rejected(envelope, 'invalid_envelope', inputIssues[0]!.message, inputIssues);
  }
  try {
    canonicalSerialize(submission);
  } catch {
    return rejected(envelope, 'invalid_submission', 'Submission must be canonical JSON.');
  }
  if (
    !hasExactKeys(submission, [
      'base_internal_envelope_hash',
      'base_internal_envelope_version',
      'base_party_projection_hash',
      'base_party_visible_version',
      'compiler_run',
      'dispute_id',
      'effects',
      'source_turn',
      'submission_id',
      'submission_version',
    ]) ||
    typeof submission.source_turn !== 'object' ||
    submission.source_turn === null ||
    !hasExactKeys(submission.compiler_run, [
      'compile_run_id',
      'compiler_version_id',
      'input_hash',
      'output_hash',
      'party_projection_contract_version',
    ]) ||
    !Array.isArray(submission.effects) ||
    !submission.effects.every(preparedEffectShape)
  ) {
    return rejected(envelope, 'invalid_submission', 'Submission shape is invalid.');
  }
  const partyId = submission.source_turn.attributed_party_id;
  const effectIds = submission.effects.flatMap((effect) => {
    switch (effect.type) {
      case 'semantic_assertion_candidate':
        return [effect.position_id, effect.compiler_assertion_id];
      case 'clarification_request':
        return [effect.clarification_id];
      case 'challenge_candidate':
        return [effect.challenge_id];
      case 'challenge_response_candidate':
        return [
          effect.response_id,
          ...(effect.semantic_correction
            ? [
                effect.semantic_correction.position_id,
                effect.semantic_correction.compiler_assertion_id,
              ]
            : []),
        ];
    }
  });
  if (new Set(effectIds).size !== effectIds.length) {
    return rejected(envelope, 'invalid_submission', 'Prepared semantic identities collide.');
  }
  if (
    !isAuthenticatedPartyAuthorityV211(authority) ||
    authority.interaction_authority !== 'external_relay' ||
    authority.party_id !== partyId ||
    authority.authenticated_subject_id !== envelope.parties[partyId]?.authenticated_subject_id ||
    submission.source_turn.authenticated_subject_id_at_receipt !==
      authority.authenticated_subject_id
  ) {
    return rejected(envelope, 'unauthorized_actor', 'Authenticated relay authority is invalid.');
  }
  if (
    submission.submission_version !== EXTERNAL_RELAY_SUBMISSION_VERSION_V211 ||
    !submission.submission_id.startsWith(`submission_${partyId}_`) ||
    !ID_PATTERN_V211.test(submission.submission_id) ||
    submission.compiler_run.compile_run_id !== submission.source_turn.compile_run_id ||
    submission.compiler_run.party_projection_contract_version !==
      envelope.control.projection_contract_version ||
    ![
      submission.compiler_run.compiler_version_id,
      submission.compiler_run.input_hash,
      submission.compiler_run.output_hash,
    ].every((value) => HASH_PATTERN_V211.test(value))
  ) {
    return rejected(
      envelope,
      'invalid_submission',
      'Submission identity or compiler provenance is invalid.',
    );
  }
  if (
    submission.dispute_id !== envelope.control.case_id ||
    submission.source_turn.dispute_id !== envelope.control.case_id
  ) {
    return rejected(envelope, 'case_mismatch', 'Submission dispute does not match the envelope.');
  }
  if (
    submission.base_internal_envelope_version !== envelope.control.envelope_version ||
    submission.base_internal_envelope_hash !== envelope.control.envelope_hash
  ) {
    return rejected(envelope, 'stale_internal_state', 'Internal envelope state is stale.');
  }
  const cursor = envelope.control.party_views[partyId];
  if (
    submission.base_party_visible_version !== cursor.party_visible_version ||
    submission.base_party_projection_hash !== cursor.party_projection_hash ||
    submission.source_turn.party_visible_version_before !== cursor.party_visible_version
  ) {
    return rejected(envelope, 'party_projection_stale', 'Party-visible projection changed.');
  }
  if (
    !isPartyScopedIdV211('turn', partyId, submission.source_turn.turn_id) ||
    envelope.source_turns[submission.source_turn.turn_id]
  ) {
    return rejected(envelope, 'source_turn_collision', 'Source turn identity is unavailable.');
  }
  if (!['independent_formation', 'challenge_response'].includes(envelope.control.workflow_state)) {
    return rejected(
      envelope,
      'workflow_state_forbidden',
      'Relay submission is unavailable in this workflow state.',
    );
  }
  if (
    envelope.parties[partyId].edit_state === 'confirmed' &&
    submission.effects.some(materialOwnEdit)
  ) {
    return rejected(
      envelope,
      'explicit_reopen_required',
      'Confirmed semantic material requires explicit first-party reopen.',
    );
  }

  const candidate = cloneCaseEnvelopeV211(envelope);
  const nextVersion = envelope.control.envelope_version + 1;
  const claimedSlots = new Set<string>();
  const claimedTargets = new Set<string>();
  const acceptedPositionIds: string[] = [];
  const supersededPositionIds: string[] = [];
  const openedClarificationIds: string[] = [];
  const resolvedClarificationIds: string[] = [];
  const challengeIds: string[] = [];
  const challengeResponseIds: string[] = [];
  const newPositions: CanonicalSemanticPositionV211[] = [];
  const newClarifications: FormationClarificationV211[] = [];
  const newChallenges: FormationChallengeV211[] = [];
  const responseEffects: Array<{
    challenge: FormationChallengeV211;
    effect: PreparedChallengeResponseEffectV211;
    commitments: SourceSpanCommitmentV211[];
    correction: CanonicalSemanticPositionV211 | null;
  }> = [];

  const createPosition = (
    effect: PreparedSemanticAssertionEffectV211,
    path: string,
  ): CanonicalSemanticPositionV211 | ApplyExternalRelaySubmissionResultV211 => {
    const checked = assertionFailure(
      envelope,
      partyId,
      effect,
      submission.source_turn,
      claimedSlots,
      claimedTargets,
      path,
    );
    if (checked.issue) {
      return rejected(
        envelope,
        checked.issue.code.includes('span') ? 'span_fidelity_failed' : 'effect_rejected',
        checked.issue.message,
        [checked.issue],
      );
    }
    return {
      position_id: effect.position_id,
      attributed_party_id: partyId,
      requirement_id: effect.requirement_id,
      proposition_type: effect.proposed_type,
      epistemic_strength: effect.epistemic_strength,
      statement: effect.statement,
      resolution_status: 'unresolved',
      source_turn_id: submission.source_turn.turn_id,
      source_span_commitments: checked.commitments,
      supersedes: effect.supersedes_candidate,
      superseded_by: null,
      superseded_at_envelope_version: null,
      introduced_envelope_version: nextVersion,
      last_material_envelope_version: nextVersion,
      compile_run_id: submission.compiler_run.compile_run_id,
      compiler_version_id: submission.compiler_run.compiler_version_id,
      evidence_ref_id: null,
    };
  };

  for (const [index, effect] of submission.effects.entries()) {
    const path = `submission.effects[${index}]`;
    switch (effect.type) {
      case 'semantic_assertion_candidate': {
        if (!isPartyScopedIdV211('position', partyId, effect.position_id)) {
          return rejected(envelope, 'effect_rejected', 'Server-minted position id is invalid.');
        }
        const created = createPosition(effect, path);
        if ('status' in created) return created;
        newPositions.push(created);
        break;
      }
      case 'clarification_request': {
        const requirement = envelope.requirements[effect.requirement_id];
        if (
          !requirement ||
          requirement.party_id !== partyId ||
          !submission.source_turn.in_reply_to.includes(effect.requirement_id) ||
          !isPartyScopedIdV211('clarification', partyId, effect.clarification_id) ||
          Boolean(envelope.clarifications[effect.clarification_id]) ||
          effect.prompt.trim().length === 0 ||
          Object.values(envelope.clarifications).some(
            (clarification) =>
              clarification.requirement_id === effect.requirement_id &&
              clarification.resolved_at_envelope_version === null,
          ) ||
          newClarifications.some(
            (clarification) => clarification.requirement_id === effect.requirement_id,
          )
        ) {
          return rejected(envelope, 'effect_rejected', 'Clarification request is invalid.');
        }
        newClarifications.push({
          clarification_id: effect.clarification_id,
          party_id: partyId,
          requirement_id: effect.requirement_id,
          reason: effect.reason,
          prompt: effect.prompt,
          opened_at_envelope_version: nextVersion,
          resolved_at_envelope_version: null,
          reopened_as: null,
        });
        break;
      }
      case 'challenge_candidate': {
        const target = envelope.positions[effect.target_position_id];
        const spans = spanCommitments(effect.spans, submission.source_turn, `${path}.spans`);
        if (
          envelope.control.disclosure_state !== 'disclosed' ||
          envelope.control.workflow_state !== 'challenge_response' ||
          !target ||
          target.attributed_party_id !== otherPartyV211(partyId) ||
          target.superseded_by !== null ||
          !submission.source_turn.in_reply_to.includes(effect.target_position_id) ||
          !isPartyScopedIdV211('challenge', partyId, effect.challenge_id) ||
          Boolean(envelope.challenges[effect.challenge_id]) ||
          effect.statement.trim().length === 0 ||
          spans.issues.length > 0 ||
          Object.values(envelope.challenges).some(
            (challenge) =>
              challenge.challenging_party_id === partyId &&
              challenge.target_position_id === effect.target_position_id &&
              challenge.status === 'open',
          ) ||
          newChallenges.some(
            (challenge) =>
              challenge.challenging_party_id === partyId &&
              challenge.target_position_id === effect.target_position_id &&
              challenge.status === 'open',
          )
        ) {
          return rejected(
            envelope,
            spans.issues.length > 0 ? 'span_fidelity_failed' : 'effect_rejected',
            spans.issues[0]?.message ?? 'Challenge candidate is invalid.',
            spans.issues,
          );
        }
        newChallenges.push({
          challenge_id: effect.challenge_id,
          challenging_party_id: partyId,
          target_party_id: target.attributed_party_id,
          target_position_id: target.position_id,
          statement: effect.statement,
          source_turn_id: submission.source_turn.turn_id,
          source_span_commitments: spans.commitments,
          compile_run_id: submission.compiler_run.compile_run_id,
          compiler_version_id: submission.compiler_run.compiler_version_id,
          introduced_envelope_version: nextVersion,
          status: 'open',
          response: null,
        });
        break;
      }
      case 'challenge_response_candidate': {
        const existing = envelope.challenges[effect.challenge_id];
        const spans = spanCommitments(effect.spans, submission.source_turn, `${path}.spans`);
        if (
          envelope.control.disclosure_state !== 'disclosed' ||
          envelope.control.workflow_state !== 'challenge_response' ||
          !existing ||
          existing.target_party_id !== partyId ||
          existing.status !== 'open' ||
          existing.response !== null ||
          !submission.source_turn.in_reply_to.includes(effect.challenge_id) ||
          !isPartyScopedIdV211('challenge_response', partyId, effect.response_id) ||
          Object.values(envelope.challenges).some(
            (challenge) => challenge.response?.response_id === effect.response_id,
          ) ||
          responseEffects.some(
            (response) => response.challenge.challenge_id === effect.challenge_id,
          ) ||
          effect.statement.trim().length === 0 ||
          spans.issues.length > 0
        ) {
          return rejected(
            envelope,
            spans.issues.length > 0 ? 'span_fidelity_failed' : 'effect_rejected',
            spans.issues[0]?.message ?? 'Challenge response candidate is invalid.',
            spans.issues,
          );
        }
        let correction: CanonicalSemanticPositionV211 | null = null;
        if (effect.semantic_correction) {
          if (effect.semantic_correction.supersedes_candidate !== existing.target_position_id) {
            return rejected(
              envelope,
              'effect_rejected',
              'Challenge response correction must supersede the challenged position.',
            );
          }
          const created = createPosition(effect.semantic_correction, `${path}.semantic_correction`);
          if ('status' in created) return created;
          correction = created;
          newPositions.push(created);
        }
        responseEffects.push({
          challenge: cloneCanonical(existing),
          effect,
          commitments: spans.commitments,
          correction,
        });
        break;
      }
    }
  }

  const clarificationRequirements = new Set(
    newClarifications.map((clarification) => clarification.requirement_id),
  );
  if (
    newPositions.some(
      (position) =>
        clarificationRequirements.has(position.requirement_id) &&
        envelope.requirements[position.requirement_id]!.satisfying_types.includes(
          position.proposition_type,
        ),
    )
  ) {
    return rejected(
      envelope,
      'effect_rejected',
      'One submission cannot both satisfy and ambiguously reopen the same requirement.',
    );
  }

  candidate.source_turns[submission.source_turn.turn_id] = cloneCanonical(submission.source_turn);
  for (const position of newPositions) {
    candidate.positions[position.position_id] = position;
    acceptedPositionIds.push(position.position_id);
    if (position.supersedes !== null) {
      const target = candidate.positions[position.supersedes]!;
      target.superseded_by = position.position_id;
      target.superseded_at_envelope_version = nextVersion;
      target.last_material_envelope_version = nextVersion;
      supersededPositionIds.push(target.position_id);
    }
  }
  for (const clarification of newClarifications) {
    candidate.clarifications[clarification.clarification_id] = clarification;
    openedClarificationIds.push(clarification.clarification_id);
  }
  for (const position of newPositions) {
    const definition = candidate.requirements[position.requirement_id]!;
    if (!definition.satisfying_types.includes(position.proposition_type)) continue;
    for (const clarification of Object.values(candidate.clarifications)) {
      if (
        clarification.party_id === partyId &&
        clarification.requirement_id === position.requirement_id &&
        clarification.resolved_at_envelope_version === null
      ) {
        clarification.resolved_at_envelope_version = nextVersion;
        resolvedClarificationIds.push(clarification.clarification_id);
      }
    }
  }
  for (const challenge of newChallenges) {
    candidate.challenges[challenge.challenge_id] = challenge;
    candidate.positions[challenge.target_position_id]!.resolution_status = 'disputed';
    candidate.positions[challenge.target_position_id]!.last_material_envelope_version = nextVersion;
    challengeIds.push(challenge.challenge_id);
  }
  for (const response of responseEffects) {
    const challenge = candidate.challenges[response.challenge.challenge_id]!;
    challenge.status = 'resolved';
    challenge.response = {
      response_id: response.effect.response_id,
      responding_party_id: partyId,
      statement: response.effect.statement,
      source_turn_id: submission.source_turn.turn_id,
      source_span_commitments: response.commitments,
      compile_run_id: submission.compiler_run.compile_run_id,
      compiler_version_id: submission.compiler_run.compiler_version_id,
      semantic_position_id: response.correction?.position_id ?? null,
      introduced_envelope_version: nextVersion,
    };
    const challenged = candidate.positions[challenge.target_position_id]!;
    challenged.resolution_status = 'procedurally_resolved';
    challenged.last_material_envelope_version = nextVersion;
    challengeResponseIds.push(response.effect.response_id);
  }

  candidate.control.envelope_version = nextVersion;
  const changedVisibleParties = refreshPartyViewCursorsV211(envelope, candidate);
  candidate.formation.explanatory = authoritativeFormationExplanatoryStateV211(candidate);
  candidate.control.envelope_hash = hashCaseEnvelopeV211(candidate);
  const resultingIssues = validateCaseEnvelopeV211(candidate);
  if (resultingIssues.length > 0) {
    return rejected(
      envelope,
      'resulting_envelope_invalid',
      resultingIssues[0]!.message,
      resultingIssues,
    );
  }
  return {
    status: 'applied',
    reason_code: null,
    message: 'V2.1.1 external relay submission applied atomically.',
    envelope: candidate,
    prior_envelope_version: envelope.control.envelope_version,
    resulting_envelope_version: candidate.control.envelope_version,
    changed_visible_parties: changedVisibleParties,
    result: {
      accepted_position_ids: acceptedPositionIds,
      superseded_position_ids: supersededPositionIds,
      opened_clarification_ids: openedClarificationIds,
      resolved_clarification_ids: resolvedClarificationIds,
      challenge_ids: challengeIds,
      challenge_response_ids: challengeResponseIds,
      warnings: [],
    },
  };
}

/** Redacted turns are omitted; an answer excerpt is never fabricated after erasure. */
export function conflictTurnSummariesForPartyV211(
  envelope: CaseEnvelopeV211,
  partyId: PartyIdV211,
  limit = 3,
): ConflictTurnSummary[] {
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new TypeError('Conflict summary limit is invalid.');
  const turns = Object.values(envelope.source_turns)
    .filter((turn) => turn.attributed_party_id === partyId && turn.payload !== null)
    .sort(
      (left, right) =>
        left.received_at.localeCompare(right.received_at) ||
        left.turn_id.localeCompare(right.turn_id),
    );
  return turns.slice(Math.max(0, turns.length - limit)).map((turn) => {
    const answer = turn.payload!.answer.text;
    return {
      turn_id: turn.turn_id,
      in_reply_to: [...turn.in_reply_to],
      answer_excerpt:
        answer.length > CONFLICT_EXCERPT_LENGTH
          ? `${answer.slice(0, CONFLICT_EXCERPT_LENGTH)}...`
          : answer,
      request_fingerprint: turn.request_fingerprint,
      client_turn_id: turn.client_turn_id,
      received_at: turn.received_at,
    };
  });
}
