import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, cloneCanonical, sha256 } from '../v2/case-envelope.js';

import {
  PARTY_FORMATION_PROJECTION_VERSION_V213,
  PARTY_FORMATION_READBACK_VERSION_V213,
  PARTY_CONFIRMATION_VERSION_V213,
  CASE_ENVELOPE_SCHEMA_VERSION_V213,
  DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V213,
  DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V213,
  ENVELOPE_COMMAND_VERSION_V213,
  FORMATION_PROTOCOL_VERSION_V213,
  FORMATION_READINESS_VERSION_V213,
  TRUSTED_SYSTEM_AUTHORITY_V213,
  hashCaseEnvelopeV213,
  partyAuthorityV213,
  type CaseEnvelopeV213,
  type FormationRequirementV213,
  type PartyIdV213,
} from '../v2-1-3/case-envelope.js';
import { validateCaseEnvelopeV213 } from '../v2-1-3/contract-validator.js';
import { currentDisclosureReviewAcknowledgmentV213 } from '../v2-1-3/disclosure-review.js';
import {
  applyEnvelopeCeremonyCommandV213,
  ceremonyCommandForV213,
  createInitialCaseEnvelopeV213,
  type EnvelopeCeremonyOperationV213,
} from '../v2-1-3/envelope-ceremony.js';
import {
  TRUSTED_EXTERNAL_RELAY_BRIDGE_V213,
  applyExternalRelaySubmissionV213,
  prepareExternalRelaySubmissionV213,
  trustedExternalRelayRuntimeV213,
  type ExternalRelayEffectCandidateV213,
  type ExternalRelaySubmissionV213,
} from '../v2-1-3/external-relay-submission.js';
import {
  authoritativeFormationExplanatoryStateV213,
  deriveFormationReadinessV213,
} from '../v2-1-3/formation-readiness.js';
import {
  projectPartyFormationV213,
  renderPartyFormationReadbackV213,
} from '../v2-1-3/party-projection.js';
import type { SourceTurnPayload, TurnSpan } from '../webmcp/core/turns.js';
import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';
import type { CaseServicePort } from '../webmcp/tools/ports.js';
import { projectRoot } from './test-helpers.js';

const NOW = '2026-09-03T04:00:00.000Z';
let sequence = 0;

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence}`;
}

function requirement(id: string): Omit<FormationRequirementV213, 'party_id'> {
  return {
    requirement_id: id,
    label: id,
    prompt: `Answer ${id}.`,
    required: true,
    satisfying_types: ['narrative_fact'],
    min_propositions: 1,
    max_propositions: null,
    adverse_fact_probe: false,
    reopened_from: null,
  };
}

function ceremony(
  envelope: CaseEnvelopeV213,
  authority: Parameters<typeof applyEnvelopeCeremonyCommandV213>[0]['execution_authority'],
  operation: EnvelopeCeremonyOperationV213,
): CaseEnvelopeV213 {
  const result = applyEnvelopeCeremonyCommandV213({
    envelope,
    command: ceremonyCommandForV213(envelope, unique('command'), operation),
    execution_authority: authority,
  });
  if (result.status !== 'applied') throw new Error(`${result.reason_code}: ${result.message}`);
  return result.envelope;
}

function bindBoth(envelope: CaseEnvelopeV213): CaseEnvelopeV213 {
  let next = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V213, {
    type: 'bind_party',
    party_slot: 'party_a',
    authenticated_subject_id: unique('subject_a'),
    binding_event_id: unique('binding_party_a'),
  });
  next = ceremony(next, TRUSTED_SYSTEM_AUTHORITY_V213, {
    type: 'bind_party',
    party_slot: 'party_b',
    authenticated_subject_id: unique('subject_b'),
    binding_event_id: unique('binding_party_b'),
  });
  return next;
}

function disclosedEnvelope(): CaseEnvelopeV213 {
  let envelope = bindBoth(createInitialCaseEnvelopeV213(unique('dispute_closure')));
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V213, {
    type: 'open_controlled_disclosure',
  });
  return envelope;
}

function acknowledge(envelope: CaseEnvelopeV213, partyId: PartyIdV213): CaseEnvelopeV213 {
  return ceremony(envelope, partyAuthorityV213(envelope, partyId, 'first_party_human'), {
    type: 'record_disclosure_review_acknowledgment',
    acknowledgment_id: unique(`disclosure_ack_${partyId}`),
    event_id: unique(`disclosure_ack_event_${partyId}`),
    acknowledged_at: new Date(Date.parse(NOW) + sequence * 1_000).toISOString(),
  });
}

function enterFinal(envelope: CaseEnvelopeV213) {
  return applyEnvelopeCeremonyCommandV213({
    envelope,
    command: ceremonyCommandForV213(envelope, unique('command_final'), {
      type: 'enter_final_confirmation',
    }),
    execution_authority: TRUSTED_SYSTEM_AUTHORITY_V213,
  });
}

function confirmParty(envelope: CaseEnvelopeV213, partyId: PartyIdV213): CaseEnvelopeV213 {
  return ceremony(envelope, partyAuthorityV213(envelope, partyId, 'first_party_human'), {
    type: 'record_party_confirmation',
    confirmation_id: unique(`confirmation_${partyId}`),
    event_id: unique(`confirmation_event_${partyId}`),
    adoption_statement: `I adopt my current ${partyId} account.`,
    confirmed_at: new Date(Date.parse(NOW) + sequence * 1_000).toISOString(),
  });
}

function answerSpan(turnId: string, answer: string, quote = answer): TurnSpan {
  const start = answer.indexOf(quote);
  return {
    turn_id: turnId,
    region: 'answer',
    message_index: null,
    encoding: 'utf16',
    start,
    end: start + quote.length,
    quote,
  };
}

function prepareSubmission(
  envelope: CaseEnvelopeV213,
  partyId: PartyIdV213,
  payload: SourceTurnPayload,
  inReplyTo: string[],
  effects: (turnId: string) => ExternalRelayEffectCandidateV213[],
): ExternalRelaySubmissionV213 {
  const turnId = unique(`turn_${partyId}`);
  const candidates = effects(turnId);
  const prepared = prepareExternalRelaySubmissionV213({
    envelope,
    execution_authority: partyAuthorityV213(envelope, partyId, 'external_relay'),
    intent: {
      intent_version: 'juryai-external-relay-submission-intent-v2.1.1',
      expected_party_visible_version: envelope.control.party_views[partyId].party_visible_version,
      expected_party_projection_hash: envelope.control.party_views[partyId].party_projection_hash,
      client_turn_id: unique(`client_turn_${partyId}`),
      in_reply_to: inReplyTo,
      payload,
      source_language: 'en',
      translation_indicated: false,
    },
    runtime: trustedExternalRelayRuntimeV213(TRUSTED_EXTERNAL_RELAY_BRIDGE_V213, {
      source_channel: 'webmcp_agent_relay',
      relaying_agent: 'v213-test-relay',
      received_at: new Date(Date.parse(NOW) + sequence * 1_000).toISOString(),
      payload_commitment_salt: `v213-test-salt-${unique('salt')}-0123456789`,
      ids: {
        submission_id: unique(`submission_${partyId}`),
        source_turn_id: turnId,
        position_ids: candidates.flatMap((effect) =>
          effect.type === 'semantic_assertion_candidate' ||
          (effect.type === 'challenge_response_candidate' && effect.semantic_correction)
            ? [unique(`position_${partyId}`)]
            : [],
        ),
        clarification_ids: candidates
          .filter((effect) => effect.type === 'clarification_request')
          .map(() => unique(`clarification_${partyId}`)),
        challenge_ids: candidates
          .filter((effect) => effect.type === 'challenge_candidate')
          .map(() => unique(`challenge_${partyId}`)),
        challenge_response_ids: candidates
          .filter((effect) => effect.type === 'challenge_response_candidate')
          .map(() => unique(`challenge_response_${partyId}`)),
      },
    }),
    compiler_run: {
      compile_run_id: unique(`compile_run_${partyId}`),
      compiler_version_id: sha256('v213-test-compiler'),
      party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V213,
      input_hash: sha256(unique('input')),
      output_hash: sha256(unique('output')),
    },
    effects: candidates,
  });
  if (prepared.status !== 'prepared') throw new Error(prepared.message);
  return prepared.submission;
}

function submit(
  envelope: CaseEnvelopeV213,
  partyId: PartyIdV213,
  payload: SourceTurnPayload,
  inReplyTo: string[],
  effects: (turnId: string) => ExternalRelayEffectCandidateV213[],
): CaseEnvelopeV213 {
  const submission = prepareSubmission(envelope, partyId, payload, inReplyTo, effects);
  const applied = applyExternalRelaySubmissionV213({
    envelope,
    submission,
    execution_authority: partyAuthorityV213(envelope, partyId, 'external_relay'),
  });
  if (applied.status !== 'applied') throw new Error(`${applied.reason_code}: ${applied.message}`);
  return applied.envelope;
}

function challengeCycleEnvelope(): {
  envelope: CaseEnvelopeV213;
  targetPositionId: string;
} {
  const requirementId = unique('req_a_story');
  let envelope = bindBoth(
    createInitialCaseEnvelopeV213(unique('dispute_challenge_cycle'), {
      party_a: [requirement(requirementId)],
      party_b: [],
    }),
  );
  const answer = 'Party A says the work was not completed.';
  envelope = submit(
    envelope,
    'party_a',
    { context: [], answer: { role: 'user', text: answer } },
    [requirementId],
    (turnId) => [
      {
        type: 'semantic_assertion_candidate',
        compiler_assertion_id: unique('compiler_assertion'),
        requirement_id: requirementId,
        proposed_type: 'narrative_fact',
        epistemic_strength: 'asserted_confident',
        statement: answer,
        spans: [answerSpan(turnId, answer)],
        supersedes_candidate: null,
      },
    ],
  );
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V213, {
    type: 'open_controlled_disclosure',
  });
  return { envelope, targetPositionId: Object.keys(envelope.positions)[0]! };
}

function addChallenge(envelope: CaseEnvelopeV213, targetPositionId: string): CaseEnvelopeV213 {
  const answer = 'Party B challenges that account.';
  return submit(
    envelope,
    'party_b',
    { context: [], answer: { role: 'user', text: answer } },
    [targetPositionId],
    (turnId) => [
      {
        type: 'challenge_candidate',
        target_position_id: targetPositionId,
        statement: answer,
        spans: [answerSpan(turnId, answer)],
      },
    ],
  );
}

function respondToChallenge(envelope: CaseEnvelopeV213): CaseEnvelopeV213 {
  const challengeId = Object.values(envelope.challenges).find(
    (challenge) => challenge.status === 'open',
  )!.challenge_id;
  const answer = 'Party A stands by the account.';
  return submit(
    envelope,
    'party_a',
    { context: [], answer: { role: 'user', text: answer } },
    [challengeId],
    (turnId) => [
      {
        type: 'challenge_response_candidate',
        challenge_id: challengeId,
        statement: answer,
        spans: [answerSpan(turnId, answer)],
        semantic_correction: null,
      },
    ],
  );
}

export {
  unique,
  requirement,
  ceremony,
  bindBoth,
  acknowledge,
  answerSpan,
  prepareSubmission,
  submit,
  addChallenge,
  respondToChallenge,
};
