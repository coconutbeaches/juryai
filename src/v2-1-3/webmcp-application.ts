import { randomBytes, randomUUID } from 'node:crypto';
import { canonicalSerialize, sha256 } from '../v2/case-envelope.js';
import {
  buildCompileRunRecord,
  COMPILER_CONTRACT_VERSION,
  buildCompilerInput,
  compilerInputHash,
  registerCompilerVersion,
  type CompilerOutput,
} from '../webmcp/core-v0-3/compiler-contract.js';
import { computeRequestFingerprint } from '../webmcp/core/idempotency.js';
import type { Proposition } from '../webmcp/core-v0-3/propositions.js';
import type { RequirementDefinition } from '../webmcp/core-v0-3/requirements.js';
import {
  computePayloadCommitment,
  normalizePayload,
  validatePayloadShape,
  validateSourceTurnRecord,
  type SourceTurnRecord,
  type TurnSpan,
} from '../webmcp/core/turns.js';
import {
  AGENT_DATA_MAX_LENGTH,
  describeEpistemicStrength,
  PROPOSITION_TYPES,
  wrapAgentFacingText,
} from '../webmcp/core-v0-3/types.js';
import type { SemanticCompilerPort } from '../webmcp/runtime-v0-3/compiler-port.js';
import { validateCompilerOutputShape } from '../webmcp/runtime-v0-3/compiler-output-shape.js';
import type {
  CaseStateResponse,
  GetCaseStateQuery,
  GetCaseStateResult,
  JuryAiServiceError,
  RecentInterpretationSlot,
  ServiceCallOptions,
  SubmitTurnCommand,
  SubmitTurnResult,
} from '../webmcp/public-contract-v0-3.js';
import {
  WEBMCP_CORE_SCHEMA_VERSION,
  WEBMCP_PROTOCOL_VERSION,
} from '../webmcp/public-contract-v0-3.js';
import {
  EXTERNAL_RELAY_SUBMISSION_INTENT_VERSION_V213,
  PARTY_FORMATION_PROJECTION_VERSION_V213,
  partyAuthorityV213,
  type CanonicalSemanticPositionV213,
  type CaseEnvelopeV213,
  type PartyIdV213,
} from './case-envelope.js';
import {
  conflictTurnSummariesForPartyV213,
  prepareExternalRelaySubmissionV213,
  trustedExternalRelayRuntimeV213,
  TRUSTED_EXTERNAL_RELAY_BRIDGE_V213,
  type ExternalRelayEffectCandidateV213,
} from './external-relay-submission.js';
import {
  isV213DisputePersistenceId,
  resolveFormationReplayObjectsV213,
  type ActiveFormationContextV213,
  type CommitExternalRelaySubmissionInputV213,
  type CommitExternalRelaySubmissionResultV213,
  type FormationPartyPersistenceContextV213,
  type FormationReplayRecordV213,
  type FormationReplayResponseV213,
  type StoredFormationDisputeV213,
} from './formation-persistence.js';
import {
  projectPartyFormationV213,
  type PartyScopedFormationProjectionV213,
  type PartyVisiblePositionV213,
} from './party-projection.js';

const RECENT_INTERPRETATION_LIMIT = 5;
const WIRE_TEXT_TRUNCATION_MARKER = '…[truncated]';
const WIRE_TEXT_CONTENT_LIMIT = AGENT_DATA_MAX_LENGTH - wrapAgentFacingText('').length;

function wrapPartyVisibleText(text: string): string {
  const bounded =
    text.length > WIRE_TEXT_CONTENT_LIMIT
      ? `${text.slice(0, WIRE_TEXT_CONTENT_LIMIT - WIRE_TEXT_TRUNCATION_MARKER.length)}${WIRE_TEXT_TRUNCATION_MARKER}`
      : text;
  return wrapAgentFacingText(bounded);
}

export interface FormationRelayRepositoryV213 {
  findById(disputeId: string): Promise<StoredFormationDisputeV213 | null>;
  listActiveContextsForPrincipal(subjectId: string): Promise<ActiveFormationContextV213[]>;
  resolvePartyContext(
    disputeId: string,
    subjectId: string,
  ): Promise<FormationPartyPersistenceContextV213 | null>;
  readReplayRecord(
    context: FormationPartyPersistenceContextV213,
    clientTurnId: string,
  ): Promise<FormationReplayRecordV213 | null>;
  commitExternalRelaySubmission(
    input: CommitExternalRelaySubmissionInputV213,
  ): Promise<CommitExternalRelaySubmissionResultV213>;
}

export type RelayCanonicalIdKindV213 =
  | 'submission'
  | 'source'
  | 'turn'
  | 'run'
  | 'position'
  | 'clarification'
  | 'challenge'
  | 'challenge_response';

export interface RelayApplicationIdsV213 {
  next(kind: RelayCanonicalIdKindV213, partyId: PartyIdV213): string;
}

export interface RelayApplicationClockV213 {
  now(): number;
}

export interface RelayApplicationSaltsV213 {
  next(): string;
}

export function randomRelayApplicationIdsV213(): RelayApplicationIdsV213 {
  return { next: (kind, partyId) => `${kind}_${partyId}_${randomUUID()}` };
}

export const systemRelayApplicationClockV213: RelayApplicationClockV213 = {
  now: () => Date.now(),
};

export function randomRelayApplicationSaltsV213(): RelayApplicationSaltsV213 {
  return { next: () => randomBytes(32).toString('hex') };
}

export interface V213PartyCaseServiceDependencies {
  authenticated_subject_id: string;
  repository: FormationRelayRepositoryV213;
  compiler: SemanticCompilerPort;
  review_url: (disputeId: string) => string;
  ids?: RelayApplicationIdsV213;
  clock?: RelayApplicationClockV213;
  salts?: RelayApplicationSaltsV213;
  relaying_agent?: string | null;
}

export interface V213PartyCaseService {
  listActiveCaseIds(options?: ServiceCallOptions): Promise<string[]>;
  getCaseState(query: GetCaseStateQuery, options?: ServiceCallOptions): Promise<GetCaseStateResult>;
  submitTurn(command: SubmitTurnCommand, options?: ServiceCallOptions): Promise<SubmitTurnResult>;
}

function serviceError(
  code: JuryAiServiceError['error']['code'],
  message: string,
  retryable = false,
): JuryAiServiceError {
  return { ok: false, error: { code, message, retryable } };
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

/** V2.1.3 rejects authority-shaped or trusted-ID additions instead of ignoring them. */
function compilerOutputHasExactShape(output: CompilerOutput): boolean {
  const spansExact = (spans: unknown): boolean =>
    Array.isArray(spans) &&
    spans.every((span) =>
      exactKeys(span, ['encoding', 'end', 'message_index', 'quote', 'region', 'start', 'turn_id']),
    );
  return (
    exactKeys(output, [
      'assertions',
      'clarifications_requested',
      'compile_run_id',
      'compiler_version_id',
      'raw_model_output',
      'rejected_candidates',
      'verdict',
    ]) &&
    Array.isArray(output.assertions) &&
    output.assertions.every(
      (assertion) =>
        exactKeys(assertion, [
          'assertion_id',
          'epistemic_strength',
          'proposed_type',
          'requirement_id',
          'spans',
          'statement',
          'supersedes_candidate',
        ]) && spansExact(assertion.spans),
    ) &&
    Array.isArray(output.rejected_candidates) &&
    output.rejected_candidates.every(
      (candidate) =>
        exactKeys(candidate, ['assertion_id', 'proposed_type', 'reason', 'spans']) &&
        spansExact(candidate.spans),
    ) &&
    Array.isArray(output.clarifications_requested) &&
    output.clarifications_requested.every((clarification) =>
      exactKeys(clarification, ['prompt', 'reason', 'requirement_id']),
    )
  );
}

function interpretation(position: PartyVisiblePositionV213): RecentInterpretationSlot {
  return {
    proposition_id: position.position_id,
    requirement_id: position.requirement_id,
    statement: wrapPartyVisibleText(position.statement),
    type: position.proposition_type,
    epistemic_strength: position.epistemic_strength,
    attribution: wrapPartyVisibleText(
      `${position.attributed_party_id === 'party_a' ? 'Party A' : 'Party B'}; ${describeEpistemicStrength(position.epistemic_strength)}`,
    ),
  };
}

function livePositions(projection: PartyScopedFormationProjectionV213): PartyVisiblePositionV213[] {
  return [
    ...projection.own_material.positions,
    ...(projection.opponent_material?.positions ?? []),
  ].filter((position) => position.superseded_by === null);
}

/** Maps only the canonical party projection into the frozen twelve-slot wire response. */
export function projectPartyCaseStateV213(
  envelope: CaseEnvelopeV213,
  partyId: PartyIdV213,
  reviewUrl: string,
  additionalWarnings: readonly string[] = [],
): CaseStateResponse {
  const projection = projectPartyFormationV213(envelope, partyId);
  const unresolvedRequirements = projection.own_material.requirements.filter(
    (requirement) => requirement.required && requirement.status !== 'satisfied',
  );
  const unansweredChallenges = projection.visible_challenges.filter(
    (challenge) =>
      challenge.target_party_id === partyId &&
      challenge.status === 'open' &&
      challenge.response === null,
  );
  const challengePrompts = unansweredChallenges.map((challenge) => ({
    requirement_id: challenge.challenge_id,
    prompt: wrapPartyVisibleText(`Respond to this challenge: ${challenge.statement}`),
  }));
  const requirementPrompts = unresolvedRequirements.map((requirement) => ({
    requirement_id: requirement.requirement_id,
    prompt: wrapPartyVisibleText(requirement.prompt),
  }));
  const recent = livePositions(projection)
    .sort((left, right) => {
      const introduced =
        envelope.positions[left.position_id]!.introduced_envelope_version -
        envelope.positions[right.position_id]!.introduced_envelope_version;
      return introduced || left.position_id.localeCompare(right.position_id);
    })
    .slice(-RECENT_INTERPRETATION_LIMIT);
  const challengeWarnings = projection.visible_challenges.map((challenge) =>
    challenge.response
      ? `challenge_resolved:${challenge.challenge_id}; response:${challenge.response.response_id}; ${challenge.response.statement}`
      : `challenge_open:${challenge.challenge_id}; ${challenge.statement}`,
  );

  return {
    case_id: projection.case_id,
    case_version: envelope.control.party_views[partyId].party_visible_version,
    protocol_version: WEBMCP_PROTOCOL_VERSION,
    schema_version: WEBMCP_CORE_SCHEMA_VERSION,
    status: 'draft',
    unresolved_requirement_count: unresolvedRequirements.length + unansweredChallenges.length,
    next_requirements: [...challengePrompts, ...requirementPrompts].slice(0, 3),
    open_clarifications: projection.own_material.clarifications
      .filter((clarification) => clarification.status === 'open')
      .map((clarification) => ({
        clarification_id: clarification.clarification_id,
        requirement_id: clarification.requirement_id,
        prompt: wrapPartyVisibleText(clarification.prompt),
      })),
    recent_interpretations: recent.map(interpretation),
    evidence_references: [
      ...projection.own_material.evidence,
      ...(projection.opponent_material?.evidence ?? []),
    ].map((evidence) => ({
      evidence_ref_id: evidence.evidence_id,
      label: wrapPartyVisibleText(evidence.description),
      inspection_status: 'uninspected',
    })),
    warnings: [...projection.warnings, ...challengeWarnings, ...additionalWarnings].map(
      wrapPartyVisibleText,
    ),
    review_url: reviewUrl,
  };
}

function compilerProposition(
  envelope: CaseEnvelopeV213,
  position: PartyVisiblePositionV213,
): Proposition {
  const canonical = envelope.positions[position.position_id];
  if (!canonical || canonical.attributed_party_id !== position.attributed_party_id) {
    throw new TypeError('Visible position does not resolve to canonical state.');
  }
  const source = envelope.source_turns[canonical.source_turn_id];
  if (!source) throw new TypeError('Visible position source turn is unavailable.');
  const spans: TurnSpan[] = [];
  if (source.payload) {
    for (const commitment of canonical.source_span_commitments) {
      const text =
        commitment.region === 'answer'
          ? source.payload.answer.text
          : commitment.message_index === null
            ? null
            : (source.payload.context[commitment.message_index]?.text ?? null);
      if (text === null) {
        throw new TypeError('Visible position span commitment cannot resolve its source region.');
      }
      const quote = text.slice(commitment.start, commitment.end);
      if (sha256(quote) !== commitment.quote_hash) {
        throw new TypeError('Visible position span commitment does not match its source.');
      }
      spans.push({
        turn_id: commitment.turn_id,
        region: commitment.region,
        message_index: commitment.message_index,
        encoding: commitment.encoding,
        start: commitment.start,
        end: commitment.end,
        quote,
      });
    }
  }
  return {
    proposition_id: position.position_id,
    case_id: envelope.control.case_id,
    type: position.proposition_type,
    epistemic_strength: position.epistemic_strength,
    statement: position.statement,
    in_reply_to: position.requirement_id,
    derived_from_turn_ids: [position.source_turn_id],
    spans,
    source_channel: source.source_channel,
    relaying_agent: source.relaying_agent,
    supersedes: position.supersedes,
    superseded_by: position.superseded_by,
    superseded_at_case_version: canonical.superseded_at_envelope_version,
    created_at_case_version: canonical.introduced_envelope_version,
    compile_run_id: canonical.compile_run_id,
    compiler_version_id: canonical.compiler_version_id,
    evidence_ref_id: position.evidence_ref_id,
  };
}

function compilerRequirement(
  requirement: PartyScopedFormationProjectionV213['own_material']['requirements'][number],
): RequirementDefinition {
  return {
    requirement_id: requirement.requirement_id,
    prompt: requirement.prompt,
    satisfying_types: [...requirement.satisfying_types],
    min_propositions: requirement.min_propositions,
    max_propositions: requirement.max_propositions,
    adverse_fact_probe: requirement.adverse_fact_probe,
    reopened_from: requirement.reopened_from,
  };
}

type CompilePlanV213 =
  | {
      kind: 'formation';
      requirement_ids: string[];
      requirements: RequirementDefinition[];
    }
  | {
      kind: 'challenge';
      requirement_ids: string[];
      requirements: RequirementDefinition[];
      target: PartyVisiblePositionV213;
    }
  | {
      kind: 'challenge_response';
      requirement_ids: string[];
      requirements: RequirementDefinition[];
      challenge_id: string;
      challenged_position: PartyVisiblePositionV213;
    };

function planCompile(
  projection: PartyScopedFormationProjectionV213,
  targets: readonly string[],
): CompilePlanV213 | null {
  const ownRequirements = new Map(
    projection.own_material.requirements.map((requirement) => [
      requirement.requirement_id,
      requirement,
    ]),
  );
  const ownClarifications = new Map(
    projection.own_material.clarifications.map((clarification) => [
      clarification.clarification_id,
      clarification,
    ]),
  );
  const ownPositions = new Map(
    projection.own_material.positions.map((position) => [position.position_id, position]),
  );
  const opponentPositions = new Map(
    (projection.opponent_material?.positions ?? []).map((position) => [
      position.position_id,
      position,
    ]),
  );
  const visibleChallenges = new Map(
    projection.visible_challenges.map((challenge) => [challenge.challenge_id, challenge]),
  );

  const opponentTargets = targets.filter((target) => opponentPositions.has(target));
  const challengeTargets = targets.filter((target) => visibleChallenges.has(target));
  if (opponentTargets.length > 0 || challengeTargets.length > 0) {
    if (opponentTargets.length === 1 && challengeTargets.length === 0 && targets.length === 1) {
      const target = opponentPositions.get(opponentTargets[0]!)!;
      if (target.superseded_by !== null) return null;
      return {
        kind: 'challenge',
        requirement_ids: [target.requirement_id],
        requirements: [
          {
            requirement_id: target.requirement_id,
            prompt: `State the challenge to this visible opposing position: ${target.statement}`,
            satisfying_types: [...PROPOSITION_TYPES],
            min_propositions: 0,
            max_propositions: null,
            adverse_fact_probe: false,
            reopened_from: null,
          },
        ],
        target,
      };
    }
    if (challengeTargets.length === 1 && opponentTargets.length === 0) {
      const challenge = visibleChallenges.get(challengeTargets[0]!)!;
      if (
        challenge.target_party_id !== projection.party_id ||
        challenge.status !== 'open' ||
        challenge.response !== null
      ) {
        return null;
      }
      const challenged = ownPositions.get(challenge.target_position_id);
      const requirement = challenged ? ownRequirements.get(challenged.requirement_id) : undefined;
      if (!challenged || !requirement) return null;
      const allowed = new Set([challenge.challenge_id, requirement.requirement_id]);
      if (targets.some((target) => !allowed.has(target))) return null;
      return {
        kind: 'challenge_response',
        requirement_ids: [requirement.requirement_id],
        requirements: [
          {
            ...compilerRequirement(requirement),
            prompt: `Respond to this visible challenge: ${challenge.statement}\nOriginal formation question: ${requirement.prompt}`,
          },
        ],
        challenge_id: challenge.challenge_id,
        challenged_position: challenged,
      };
    }
    return null;
  }

  const requirementIds = new Set<string>();
  for (const target of targets) {
    const requirement = ownRequirements.get(target);
    if (requirement) {
      requirementIds.add(requirement.requirement_id);
      continue;
    }
    const clarification = ownClarifications.get(target);
    if (clarification) {
      requirementIds.add(clarification.requirement_id);
      continue;
    }
    const position = ownPositions.get(target);
    if (position && position.superseded_by === null) {
      requirementIds.add(position.requirement_id);
      continue;
    }
    return null;
  }
  if (requirementIds.size === 0) return null;
  // Canonical semantic effects require their requirement id in the source linkage.
  if ([...requirementIds].some((requirementId) => !targets.includes(requirementId))) return null;
  return {
    kind: 'formation',
    requirement_ids: [...requirementIds].sort(),
    requirements: [...requirementIds]
      .map((requirementId) => ownRequirements.get(requirementId))
      .filter((requirement): requirement is NonNullable<typeof requirement> => Boolean(requirement))
      .map(compilerRequirement),
  };
}

function fullAnswerSpan(turnId: string, answer: string): TurnSpan {
  return {
    turn_id: turnId,
    region: 'answer',
    message_index: null,
    encoding: 'utf16',
    start: 0,
    end: answer.length,
    quote: answer,
  };
}

function effectsForCompilerOutput(
  plan: CompilePlanV213,
  output: CompilerOutput,
  turnId: string,
  answer: string,
): ExternalRelayEffectCandidateV213[] | null {
  if (plan.kind === 'formation') {
    return [
      ...output.assertions.map((assertion) => ({
        type: 'semantic_assertion_candidate' as const,
        compiler_assertion_id: assertion.assertion_id,
        requirement_id: assertion.requirement_id,
        proposed_type: assertion.proposed_type,
        epistemic_strength: assertion.epistemic_strength,
        statement: assertion.statement,
        spans: assertion.spans,
        supersedes_candidate: assertion.supersedes_candidate,
      })),
      ...output.clarifications_requested.map((clarification) => ({
        type: 'clarification_request' as const,
        requirement_id: clarification.requirement_id,
        reason: clarification.reason,
        prompt: clarification.prompt,
      })),
    ];
  }
  if (output.verdict === 'ambiguous' || output.clarifications_requested.length > 0) return null;
  if (plan.kind === 'challenge') {
    if (output.assertions.length === 0) {
      return [
        {
          type: 'challenge_candidate',
          target_position_id: plan.target.position_id,
          statement: answer,
          spans: [fullAnswerSpan(turnId, answer)],
        },
      ];
    }
    if (output.assertions.some((candidate) => candidate.supersedes_candidate !== null)) return null;
    return output.assertions.map((candidate) => ({
      type: 'challenge_candidate',
      target_position_id: plan.target.position_id,
      statement: candidate.statement,
      spans: candidate.spans,
    }));
  }
  if (output.assertions.length === 0) {
    return [
      {
        type: 'challenge_response_candidate',
        challenge_id: plan.challenge_id,
        statement: answer,
        spans: [fullAnswerSpan(turnId, answer)],
        semantic_correction: null,
      },
    ];
  }
  if (
    output.assertions.some(
      (candidate) =>
        candidate.supersedes_candidate !== null &&
        candidate.supersedes_candidate !== plan.challenged_position.position_id,
    )
  ) {
    return null;
  }
  return output.assertions.map((candidate) => ({
    type: 'challenge_response_candidate' as const,
    challenge_id: plan.challenge_id,
    statement: candidate.statement,
    spans: candidate.spans,
    semantic_correction:
      candidate.supersedes_candidate === null
        ? null
        : {
            type: 'semantic_assertion_candidate' as const,
            compiler_assertion_id: candidate.assertion_id,
            requirement_id: candidate.requirement_id,
            proposed_type: candidate.proposed_type,
            epistemic_strength: candidate.epistemic_strength,
            statement: candidate.statement,
            spans: candidate.spans,
            supersedes_candidate: candidate.supersedes_candidate,
          },
  })) as ExternalRelayEffectCandidateV213[];
}

function recordedSlots(
  envelope: CaseEnvelopeV213,
  response: FormationReplayResponseV213,
): RecentInterpretationSlot[] {
  return resolveFormationReplayObjectsV213(envelope, response).accepted_positions.map((position) =>
    interpretation({
      position_id: position.position_id,
      attributed_party_id: position.attributed_party_id,
      requirement_id: position.requirement_id,
      proposition_type: position.proposition_type,
      epistemic_strength: position.epistemic_strength,
      statement: position.statement,
      resolution_status: position.resolution_status,
      source_turn_id: position.source_turn_id,
      source_span_commitments: position.source_span_commitments,
      supersedes: position.supersedes,
      superseded_by: position.superseded_by,
      evidence_ref_id: position.evidence_ref_id,
    }),
  );
}

export function createV213PartyCaseService(
  dependencies: V213PartyCaseServiceDependencies,
): V213PartyCaseService {
  if (
    dependencies.compiler.registryEntry.version.schema_version !== COMPILER_CONTRACT_VERSION ||
    dependencies.compiler.registryEntry.version.taxonomy_version !== 'juryai-p2-v0.3.0'
  ) {
    throw new TypeError('V2.1.3 requires the V0.3 compiler and taxonomy contracts.');
  }
  const ids = dependencies.ids ?? randomRelayApplicationIdsV213();
  const clock = dependencies.clock ?? systemRelayApplicationClockV213;
  const salts = dependencies.salts ?? randomRelayApplicationSaltsV213();
  const subjectId = dependencies.authenticated_subject_id;

  const currentFor = async (
    disputeId: string,
  ): Promise<{
    context: FormationPartyPersistenceContextV213;
    stored: StoredFormationDisputeV213;
  } | null> => {
    const context = await dependencies.repository.resolvePartyContext(disputeId, subjectId);
    if (!context) return null;
    const stored = await dependencies.repository.findById(disputeId);
    if (!stored) return null;
    return { context, stored };
  };

  const stateFor = (
    stored: StoredFormationDisputeV213,
    partyId: PartyIdV213,
    warnings: readonly string[] = [],
  ) =>
    projectPartyCaseStateV213(
      stored.envelope,
      partyId,
      dependencies.review_url(stored.envelope.control.case_id),
      warnings,
    );

  return {
    listActiveCaseIds: async (options) => {
      options?.signal?.throwIfAborted();
      const contexts = await dependencies.repository.listActiveContextsForPrincipal(subjectId);
      options?.signal?.throwIfAborted();
      return contexts.map((context) => context.dispute_id).sort();
    },

    getCaseState: async (query, options) => {
      try {
        options?.signal?.throwIfAborted();
        let disputeId = query.case_id;
        if (disputeId === undefined) {
          const active = await dependencies.repository.listActiveContextsForPrincipal(subjectId);
          if (active.length === 0)
            return serviceError('CASE_NOT_FOUND', 'No active case was found.');
          if (active.length !== 1) {
            return serviceError(
              'CONFLICT',
              'Multiple active cases exist; provide an explicit case_id.',
            );
          }
          disputeId = active[0]!.dispute_id;
        }
        if (!isV213DisputePersistenceId(disputeId)) {
          return serviceError('CASE_NOT_FOUND', 'No such case.');
        }
        const current = await currentFor(disputeId);
        options?.signal?.throwIfAborted();
        return current
          ? { ok: true, case: stateFor(current.stored, current.context.party_id) }
          : serviceError('CASE_NOT_FOUND', 'No such case.');
      } catch (error) {
        if (options?.signal?.aborted) throw error;
        return serviceError('INTERNAL_ERROR', 'The case state is temporarily unavailable.', true);
      }
    },

    submitTurn: async (command, options) => {
      try {
        options?.signal?.throwIfAborted();
        if (!isV213DisputePersistenceId(command.case_id)) {
          return serviceError('CASE_NOT_FOUND', 'No such case.');
        }
        const current = await currentFor(command.case_id);
        if (!current) return serviceError('CASE_NOT_FOUND', 'No such case.');
        const { context, stored } = current;
        const partyId = context.party_id;
        const normalizedPayload = normalizePayload(command.payload);
        const payloadIssues = validatePayloadShape(normalizedPayload, 'payload');
        if (payloadIssues.length > 0) return serviceError('INVALID_INPUT', 'The turn is invalid.');
        const directTargets = [...new Set(command.in_reply_to)].sort();
        const fingerprint = computeRequestFingerprint({
          principal_id: subjectId,
          case_id: command.case_id,
          in_reply_to: directTargets,
          payload: normalizedPayload,
        });

        // Replay is decided before visible-version validation and before any model call.
        const replayRecord = await dependencies.repository.readReplayRecord(
          context,
          command.client_turn_id,
        );
        if (replayRecord) {
          if (replayRecord.request_fingerprint !== fingerprint) {
            return serviceError(
              'CONFLICT',
              'This client_turn_id was already used for another turn.',
            );
          }
          const replay = replayRecord.response;
          const latest = await dependencies.repository.findById(command.case_id);
          if (!latest) return serviceError('CASE_NOT_FOUND', 'No such case.');
          return {
            ok: true,
            replayed: true,
            turn_id: replay.source_turn_id,
            case: stateFor(latest, partyId, replay.warnings),
            recorded: recordedSlots(latest.envelope, replay),
            superseded: [...replay.superseded_position_ids],
          };
        }

        const cursor = stored.envelope.control.party_views[partyId];
        if (command.expected_case_version !== cursor.party_visible_version) {
          return {
            ok: false,
            error: {
              code: 'VERSION_CONFLICT',
              message: 'The case changed before this turn could be recorded.',
              retryable: false,
            },
            current_case_version: cursor.party_visible_version,
            recent_turns: conflictTurnSummariesForPartyV213(stored.envelope, partyId),
            likely_already_recorded: conflictTurnSummariesForPartyV213(
              stored.envelope,
              partyId,
            ).some((turn) => turn.request_fingerprint === fingerprint),
            case: stateFor(stored, partyId),
          };
        }

        const projection = projectPartyFormationV213(stored.envelope, partyId);
        const plan = planCompile(projection, directTargets);
        if (!plan) return serviceError('INVALID_INPUT', 'The reply target is unavailable.');

        const registryEntry = structuredClone(dependencies.compiler.registryEntry);
        registerCompilerVersion([], registryEntry);
        const compileRunId = ids.next('run', partyId);
        const sourceTurnId = ids.next('turn', partyId);
        const sourceId = ids.next('source', partyId);
        const receivedAtMs = clock.now();
        const receivedAt = new Date(receivedAtMs).toISOString();
        const salt = salts.next();
        const compilerTurn: SourceTurnRecord = {
          turn_id: sourceTurnId,
          case_id: command.case_id,
          case_version_before: cursor.party_visible_version,
          received_at: receivedAt,
          principal_id: subjectId,
          source_channel: 'webmcp_agent_relay',
          relaying_agent: dependencies.relaying_agent ?? null,
          source_language: command.source_language ?? null,
          translation_indicated: command.translation_indicated ?? false,
          in_reply_to: [...plan.requirement_ids],
          client_turn_id: command.client_turn_id,
          request_fingerprint: fingerprint,
          payload: normalizedPayload,
          payload_commitment_salt: salt,
          payload_commitment: computePayloadCommitment(normalizedPayload, salt),
          compile_run_id: compileRunId,
        };
        if (validateSourceTurnRecord(compilerTurn, 'turn').length > 0) {
          return serviceError('INTERNAL_ERROR', 'That answer could not be processed.', false);
        }
        const compilerInput = buildCompilerInput({
          compile_run_id: compileRunId,
          compiler_version_id: registryEntry.compiler_version_id,
          state: { case_id: command.case_id, case_version: cursor.party_visible_version },
          turn: compilerTurn,
          requirements: plan.requirements,
          // Opponent source history is not part of the disclosed projection. The
          // visible target statement is carried by the synthetic requirement
          // prompt above; only the caller's own source-backed propositions are
          // reconstructed for compiler context.
          livePropositions: projection.own_material.positions
            .filter((position) => position.superseded_by === null)
            .map((position) => compilerProposition(stored.envelope, position)),
        });
        const startedAt = new Date(clock.now()).toISOString();
        const compiled = await dependencies.compiler.compile(structuredClone(compilerInput), {
          signal: options?.signal,
        });
        options?.signal?.throwIfAborted();
        let output: CompilerOutput;
        try {
          output = structuredClone(compiled);
        } catch {
          return serviceError('INTERNAL_ERROR', 'That answer could not be processed.', false);
        }
        if (
          validateCompilerOutputShape(output).length > 0 ||
          !compilerOutputHasExactShape(output)
        ) {
          return serviceError('INTERNAL_ERROR', 'That answer could not be processed.', false);
        }
        const runRecord = buildCompileRunRecord(
          compilerInput,
          output,
          { started_at: startedAt, finished_at: new Date(clock.now()).toISOString() },
          registryEntry.version.schema_version,
        );
        if (runRecord.contract_issues.length > 0) {
          return serviceError('INTERNAL_ERROR', 'That answer could not be processed.', false);
        }
        const effects = effectsForCompilerOutput(
          plan,
          runRecord.output,
          sourceTurnId,
          normalizedPayload.answer.text,
        );
        if (!effects)
          return serviceError('INTERNAL_ERROR', 'That answer could not be processed.', false);
        /**
         * A structurally valid answer can still carry nothing this case can
         * record: the formation branch above yields no candidate when the
         * compiler returns neither an assertion nor a clarification request.
         *
         * Committing that is worse than refusing it. It persists a source turn
         * and a replay record for a write that changes no canonical material,
         * and answers `ok: true` with an empty `recorded` array — which a
         * caller reasonably reads as "the information was recorded" when
         * JuryAI in fact discarded the substance. For an evidence system that
         * silent discard is the dangerous outcome, so fail before persistence.
         *
         * Only formation can reach zero. The challenge and challenge-response
         * branches synthesize a candidate from the answer when the compiler
         * returns no assertions, so their intentional effects are unaffected;
         * the guard stays general so a future branch cannot regress into a
         * silent no-op.
         */
        if (effects.length === 0)
          return serviceError(
            'INVALID_INPUT',
            'The answer produced no recordable change to this case.',
            false,
          );

        const positionCount = effects.reduce(
          (count, effect) =>
            count +
            (effect.type === 'semantic_assertion_candidate' ? 1 : 0) +
            (effect.type === 'challenge_response_candidate' && effect.semantic_correction ? 1 : 0),
          0,
        );
        const runtime = trustedExternalRelayRuntimeV213(TRUSTED_EXTERNAL_RELAY_BRIDGE_V213, {
          source_channel: 'webmcp_agent_relay',
          relaying_agent: dependencies.relaying_agent ?? null,
          received_at: receivedAt,
          payload_commitment_salt: salt,
          ids: {
            submission_id: ids.next('submission', partyId),
            source_turn_id: sourceTurnId,
            position_ids: Array.from({ length: positionCount }, () =>
              ids.next('position', partyId),
            ),
            clarification_ids: effects
              .filter((effect) => effect.type === 'clarification_request')
              .map(() => ids.next('clarification', partyId)),
            challenge_ids: effects
              .filter((effect) => effect.type === 'challenge_candidate')
              .map(() => ids.next('challenge', partyId)),
            challenge_response_ids: effects
              .filter((effect) => effect.type === 'challenge_response_candidate')
              .map(() => ids.next('challenge_response', partyId)),
          },
        });
        const prepared = prepareExternalRelaySubmissionV213({
          envelope: stored.envelope,
          execution_authority: partyAuthorityV213(stored.envelope, partyId, 'external_relay'),
          intent: {
            intent_version: EXTERNAL_RELAY_SUBMISSION_INTENT_VERSION_V213,
            expected_party_visible_version: cursor.party_visible_version,
            expected_party_projection_hash: cursor.party_projection_hash,
            client_turn_id: command.client_turn_id,
            in_reply_to: directTargets,
            payload: normalizedPayload,
            source_language: command.source_language ?? null,
            translation_indicated: command.translation_indicated ?? false,
          },
          runtime,
          compiler_run: {
            compile_run_id: compileRunId,
            compiler_version_id: registryEntry.compiler_version_id,
            party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V213,
            input_hash: compilerInputHash(compilerInput),
            output_hash: sha256(canonicalSerialize(runRecord.output)),
          },
          effects,
        });
        if (prepared.status !== 'prepared') {
          return serviceError('INTERNAL_ERROR', 'That answer could not be processed.', false);
        }
        const committed = await dependencies.repository.commitExternalRelaySubmission({
          context,
          submission: prepared.submission,
          compiler_artifact: { registry_entry: registryEntry, run: runRecord },
          source_id: sourceId,
          recorded_at_ms: receivedAtMs,
        });
        if (committed.status === 'committed' || committed.status === 'replayed') {
          return {
            ok: true,
            ...(committed.replayed ? { replayed: true } : {}),
            turn_id: committed.response.source_turn_id,
            case: stateFor(committed.stored, partyId, committed.response.warnings),
            recorded: recordedSlots(committed.stored.envelope, committed.response),
            superseded: [...committed.response.superseded_position_ids],
          };
        }
        if (committed.status === 'idempotency_conflict') {
          return serviceError('CONFLICT', 'This client_turn_id was already used for another turn.');
        }
        if (committed.status === 'conflict') {
          if (!committed.current) return serviceError('CASE_NOT_FOUND', 'No such case.');
          const currentCursor = committed.current.envelope.control.party_views[partyId];
          return {
            ok: false,
            error: {
              code: 'VERSION_CONFLICT',
              message: 'The case changed before this turn could be recorded.',
              retryable: false,
            },
            current_case_version: currentCursor.party_visible_version,
            recent_turns: conflictTurnSummariesForPartyV213(committed.current.envelope, partyId),
            likely_already_recorded: false,
            case: stateFor(committed.current, partyId),
          };
        }
        if (
          committed.status === 'domain_rejected' &&
          committed.reason_code === 'explicit_reopen_required'
        ) {
          return serviceError(
            'CONFLICT',
            'A first-party reopen is required before confirmed material can change.',
          );
        }
        return serviceError(
          committed.status === 'unauthorized' ? 'CASE_NOT_FOUND' : 'INVALID_INPUT',
          committed.status === 'unauthorized'
            ? 'No such case.'
            : 'The turn could not be applied to the current party-visible case.',
        );
      } catch (error) {
        if (options?.signal?.aborted) throw error;
        return serviceError(
          'INTERNAL_ERROR',
          'That answer could not be processed. Try again.',
          true,
        );
      }
    },
  };
}
