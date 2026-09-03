import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, cloneCanonical, sha256 } from '../v2/case-envelope.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V211,
  ENVELOPE_COMMAND_VERSION_V211,
  FORMATION_PROTOCOL_VERSION_V211,
  PARTY_CONFIRMATION_VERSION_V211,
  PARTY_FORMATION_PROJECTION_VERSION_V211,
  PARTY_FORMATION_READBACK_VERSION_V211,
  TRUSTED_SYSTEM_AUTHORITY_V211,
} from '../v2-1-1/case-envelope.js';
import { validateCaseEnvelopeV211 } from '../v2-1-1/contract-validator.js';
import {
  applyEnvelopeCeremonyCommandV211,
  ceremonyCommandForV211,
  createInitialCaseEnvelopeV211,
} from '../v2-1-1/envelope-ceremony.js';
import {
  projectPartyFormationV211,
  renderPartyFormationReadbackV211,
} from '../v2-1-1/party-projection.js';
import {
  CASE_ENVELOPE_SCHEMA_VERSION_V212,
  DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V212,
  DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V212,
  ENVELOPE_COMMAND_VERSION_V212,
  FORMATION_PROTOCOL_VERSION_V212,
  FORMATION_READINESS_VERSION_V212,
  TRUSTED_SYSTEM_AUTHORITY_V212,
  hashCaseEnvelopeV212,
  partyAuthorityV212,
  type CaseEnvelopeV212,
  type FormationRequirementV212,
  type PartyIdV212,
} from '../v2-1-2/case-envelope.js';
import { validateCaseEnvelopeV212 } from '../v2-1-2/contract-validator.js';
import { currentDisclosureReviewAcknowledgmentV212 } from '../v2-1-2/disclosure-review.js';
import {
  applyEnvelopeCeremonyCommandV212,
  ceremonyCommandForV212,
  createInitialCaseEnvelopeV212,
  type EnvelopeCeremonyOperationV212,
} from '../v2-1-2/envelope-ceremony.js';
import {
  TRUSTED_EXTERNAL_RELAY_BRIDGE_V211,
  applyExternalRelaySubmissionV212,
  prepareExternalRelaySubmissionV212,
  trustedExternalRelayRuntimeV211,
  type ExternalRelayEffectCandidateV211,
  type ExternalRelaySubmissionV211,
} from '../v2-1-2/external-relay-submission.js';
import {
  authoritativeFormationExplanatoryStateV212,
  deriveFormationReadinessV212,
} from '../v2-1-2/formation-readiness.js';
import {
  projectPartyFormationV212,
  renderPartyFormationReadbackV212,
} from '../v2-1-2/party-projection.js';
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

function requirement(id: string): Omit<FormationRequirementV212, 'party_id'> {
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
  envelope: CaseEnvelopeV212,
  authority: Parameters<typeof applyEnvelopeCeremonyCommandV212>[0]['execution_authority'],
  operation: EnvelopeCeremonyOperationV212,
): CaseEnvelopeV212 {
  const result = applyEnvelopeCeremonyCommandV212({
    envelope,
    command: ceremonyCommandForV212(envelope, unique('command'), operation),
    execution_authority: authority,
  });
  if (result.status !== 'applied') throw new Error(`${result.reason_code}: ${result.message}`);
  return result.envelope;
}

function bindBoth(envelope: CaseEnvelopeV212): CaseEnvelopeV212 {
  let next = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
    type: 'bind_party',
    party_slot: 'party_a',
    authenticated_subject_id: unique('subject_a'),
    binding_event_id: unique('binding_party_a'),
  });
  next = ceremony(next, TRUSTED_SYSTEM_AUTHORITY_V212, {
    type: 'bind_party',
    party_slot: 'party_b',
    authenticated_subject_id: unique('subject_b'),
    binding_event_id: unique('binding_party_b'),
  });
  return next;
}

function disclosedEnvelope(): CaseEnvelopeV212 {
  let envelope = bindBoth(createInitialCaseEnvelopeV212(unique('dispute_closure')));
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
    type: 'open_controlled_disclosure',
  });
  return envelope;
}

function acknowledge(envelope: CaseEnvelopeV212, partyId: PartyIdV212): CaseEnvelopeV212 {
  return ceremony(envelope, partyAuthorityV212(envelope, partyId, 'first_party_human'), {
    type: 'record_disclosure_review_acknowledgment',
    acknowledgment_id: unique(`disclosure_ack_${partyId}`),
    event_id: unique(`disclosure_ack_event_${partyId}`),
    acknowledged_at: new Date(Date.parse(NOW) + sequence * 1_000).toISOString(),
  });
}

function enterFinal(envelope: CaseEnvelopeV212) {
  return applyEnvelopeCeremonyCommandV212({
    envelope,
    command: ceremonyCommandForV212(envelope, unique('command_final'), {
      type: 'enter_final_confirmation',
    }),
    execution_authority: TRUSTED_SYSTEM_AUTHORITY_V212,
  });
}

function confirmParty(envelope: CaseEnvelopeV212, partyId: PartyIdV212): CaseEnvelopeV212 {
  return ceremony(envelope, partyAuthorityV212(envelope, partyId, 'first_party_human'), {
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
  envelope: CaseEnvelopeV212,
  partyId: PartyIdV212,
  payload: SourceTurnPayload,
  inReplyTo: string[],
  effects: (turnId: string) => ExternalRelayEffectCandidateV211[],
): ExternalRelaySubmissionV211 {
  const turnId = unique(`turn_${partyId}`);
  const candidates = effects(turnId);
  const prepared = prepareExternalRelaySubmissionV212({
    envelope,
    execution_authority: partyAuthorityV212(envelope, partyId, 'external_relay'),
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
    runtime: trustedExternalRelayRuntimeV211(TRUSTED_EXTERNAL_RELAY_BRIDGE_V211, {
      source_channel: 'webmcp_agent_relay',
      relaying_agent: 'v212-test-relay',
      received_at: new Date(Date.parse(NOW) + sequence * 1_000).toISOString(),
      payload_commitment_salt: `v212-test-salt-${unique('salt')}-0123456789`,
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
      compiler_version_id: sha256('v212-test-compiler'),
      party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
      input_hash: sha256(unique('input')),
      output_hash: sha256(unique('output')),
    },
    effects: candidates,
  });
  if (prepared.status !== 'prepared') throw new Error(prepared.message);
  return prepared.submission;
}

function submit(
  envelope: CaseEnvelopeV212,
  partyId: PartyIdV212,
  payload: SourceTurnPayload,
  inReplyTo: string[],
  effects: (turnId: string) => ExternalRelayEffectCandidateV211[],
): CaseEnvelopeV212 {
  const submission = prepareSubmission(envelope, partyId, payload, inReplyTo, effects);
  const applied = applyExternalRelaySubmissionV212({
    envelope,
    submission,
    execution_authority: partyAuthorityV212(envelope, partyId, 'external_relay'),
  });
  if (applied.status !== 'applied') throw new Error(`${applied.reason_code}: ${applied.message}`);
  return applied.envelope;
}

function challengeCycleEnvelope(): {
  envelope: CaseEnvelopeV212;
  targetPositionId: string;
} {
  const requirementId = unique('req_a_story');
  let envelope = bindBoth(
    createInitialCaseEnvelopeV212(unique('dispute_challenge_cycle'), {
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
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
    type: 'open_controlled_disclosure',
  });
  return { envelope, targetPositionId: Object.keys(envelope.positions)[0]! };
}

function addChallenge(envelope: CaseEnvelopeV212, targetPositionId: string): CaseEnvelopeV212 {
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

function respondToChallenge(envelope: CaseEnvelopeV212): CaseEnvelopeV212 {
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

describe('V2.1.2 canonical disclosure-review closure', () => {
  it('freezes the V2.1.1 identifiers, validator shape, and immediate-final historical behavior', () => {
    expect(CASE_ENVELOPE_SCHEMA_VERSION_V211).toBe('juryai-case-envelope-v2.1.1');
    expect(FORMATION_PROTOCOL_VERSION_V211).toBe('juryai-formation-protocol-v2.1.1');
    expect(ENVELOPE_COMMAND_VERSION_V211).toBe('juryai-envelope-command-v2.1.1');
    expect(PARTY_FORMATION_PROJECTION_VERSION_V211).toBe(
      'juryai-party-formation-projection-v2.1.1',
    );
    expect(PARTY_FORMATION_READBACK_VERSION_V211).toBe('juryai-party-formation-readback-v2.1.1');
    expect(PARTY_CONFIRMATION_VERSION_V211).toBe('juryai-party-confirmation-v2.1.1');

    let legacy = createInitialCaseEnvelopeV211(unique('dispute_v211_frozen'));
    for (const partyId of ['party_a', 'party_b'] as const) {
      const bound = applyEnvelopeCeremonyCommandV211({
        envelope: legacy,
        command: ceremonyCommandForV211(legacy, unique('command_v211'), {
          type: 'bind_party',
          party_slot: partyId,
          authenticated_subject_id: unique(`subject_v211_${partyId}`),
          binding_event_id: unique(`binding_${partyId}`),
        }),
        execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
      });
      expect(bound.status).toBe('applied');
      if (bound.status !== 'applied') throw new Error(bound.message);
      legacy = bound.envelope;
    }
    for (const operation of [
      { type: 'open_controlled_disclosure' as const },
      { type: 'enter_final_confirmation' as const },
    ]) {
      const applied = applyEnvelopeCeremonyCommandV211({
        envelope: legacy,
        command: ceremonyCommandForV211(legacy, unique('command_v211'), operation),
        execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
      });
      expect(applied.status).toBe('applied');
      if (applied.status !== 'applied') throw new Error(applied.message);
      legacy = applied.envelope;
    }
    expect(validateCaseEnvelopeV211(legacy)).toEqual([]);
    expect('disclosure_review_acknowledgments' in legacy.formation).toBe(false);
    const injected = cloneCanonical(legacy) as unknown as Record<string, unknown>;
    (injected.formation as Record<string, unknown>).disclosure_review_acknowledgments = {
      party_a: [],
      party_b: [],
    };
    expect(validateCaseEnvelopeV211(injected).map((entry) => entry.code)).toContain(
      'v211_exact_keys',
    );
  });

  it('creates an explicitly versioned valid V2.1.2 envelope without converting V2.1.1', () => {
    const envelope = createInitialCaseEnvelopeV212(unique('dispute_v212_initial'));
    expect(envelope.control).toMatchObject({
      schema_version: CASE_ENVELOPE_SCHEMA_VERSION_V212,
      protocol_version: FORMATION_PROTOCOL_VERSION_V212,
      command_contract_version: ENVELOPE_COMMAND_VERSION_V212,
      readiness_contract_version: FORMATION_READINESS_VERSION_V212,
      projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
    });
    expect(envelope.formation.disclosure_review_acknowledgments).toEqual({
      party_a: [],
      party_b: [],
    });
    expect(validateCaseEnvelopeV212(envelope)).toEqual([]);
    expect(validateCaseEnvelopeV211(envelope).length).toBeGreaterThan(0);
    expect(
      validateCaseEnvelopeV212(createInitialCaseEnvelopeV211(unique('dispute_v211_not_v212')))
        .length,
    ).toBeGreaterThan(0);
  });

  it('fails closed without throwing when acknowledgment history references malformed state', () => {
    const malformed = cloneCanonical(createInitialCaseEnvelopeV212(unique('dispute_malformed')));
    malformed.parties = null as never;
    malformed.formation.disclosure_review_acknowledgments.party_a.push({
      acknowledgment_version: DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V212,
    } as never);
    expect(() => validateCaseEnvelopeV212(malformed)).not.toThrow();
    expect(validateCaseEnvelopeV212(malformed).length).toBeGreaterThan(0);
  });

  it('preserves V2.1.1 party projection and read-back bytes for equivalent V2.1.2 state', () => {
    const disputeId = unique('dispute_projection_freeze');
    const subjects = {
      party_a: unique('subject_projection_a'),
      party_b: unique('subject_projection_b'),
    };
    const bindingIds = {
      party_a: unique('binding_party_a'),
      party_b: unique('binding_party_b'),
    };
    let legacy = createInitialCaseEnvelopeV211(disputeId);
    let current = createInitialCaseEnvelopeV212(disputeId);
    for (const partyId of ['party_a', 'party_b'] as const) {
      const legacyResult = applyEnvelopeCeremonyCommandV211({
        envelope: legacy,
        command: ceremonyCommandForV211(legacy, unique('command_projection_v211'), {
          type: 'bind_party',
          party_slot: partyId,
          authenticated_subject_id: subjects[partyId],
          binding_event_id: bindingIds[partyId],
        }),
        execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
      });
      expect(legacyResult.status).toBe('applied');
      if (legacyResult.status !== 'applied') throw new Error(legacyResult.message);
      legacy = legacyResult.envelope;
      current = ceremony(current, TRUSTED_SYSTEM_AUTHORITY_V212, {
        type: 'bind_party',
        party_slot: partyId,
        authenticated_subject_id: subjects[partyId],
        binding_event_id: bindingIds[partyId],
      });
    }
    const legacyDisclosure = applyEnvelopeCeremonyCommandV211({
      envelope: legacy,
      command: ceremonyCommandForV211(legacy, unique('command_projection_v211'), {
        type: 'open_controlled_disclosure',
      }),
      execution_authority: TRUSTED_SYSTEM_AUTHORITY_V211,
    });
    expect(legacyDisclosure.status).toBe('applied');
    if (legacyDisclosure.status !== 'applied') throw new Error(legacyDisclosure.message);
    legacy = legacyDisclosure.envelope;
    current = ceremony(current, TRUSTED_SYSTEM_AUTHORITY_V212, {
      type: 'open_controlled_disclosure',
    });

    for (const partyId of ['party_a', 'party_b'] as const) {
      expect(canonicalSerialize(projectPartyFormationV212(current, partyId))).toBe(
        canonicalSerialize(projectPartyFormationV211(legacy, partyId)),
      );
      expect(renderPartyFormationReadbackV212(current, partyId)).toEqual(
        renderPartyFormationReadbackV211(legacy, partyId),
      );
    }
  });

  it('opens controlled disclosure but rejects immediate final-confirmation entry', () => {
    const envelope = disclosedEnvelope();
    expect(envelope.control.workflow_state).toBe('challenge_response');
    expect(envelope.formation.disclosure_review_acknowledgments).toEqual({
      party_a: [],
      party_b: [],
    });
    expect(enterFinal(envelope)).toMatchObject({
      status: 'rejected',
      reason_code: 'invalid_transition',
    });
  });

  it.each(['party_a', 'party_b'] as const)(
    '%s acknowledgment alone cannot advance both parties',
    (partyId) => {
      const envelope = acknowledge(disclosedEnvelope(), partyId);
      expect(currentDisclosureReviewAcknowledgmentV212(envelope, partyId)).not.toBeNull();
      expect(
        currentDisclosureReviewAcknowledgmentV212(
          envelope,
          partyId === 'party_a' ? 'party_b' : 'party_a',
        ),
      ).toBeNull();
      expect(enterFinal(envelope).status).toBe('rejected');
    },
  );

  it('requires first-party authority and party-scoped server identities', () => {
    const envelope = disclosedEnvelope();
    const operation = {
      type: 'record_disclosure_review_acknowledgment' as const,
      acknowledgment_id: unique('disclosure_ack_party_b'),
      event_id: unique('disclosure_ack_event_party_b'),
      acknowledged_at: NOW,
    };
    expect(
      applyEnvelopeCeremonyCommandV212({
        envelope,
        command: ceremonyCommandForV212(envelope, unique('command'), operation),
        execution_authority: partyAuthorityV212(envelope, 'party_a', 'first_party_human'),
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'invalid_transition' });
    expect(
      applyEnvelopeCeremonyCommandV212({
        envelope,
        command: ceremonyCommandForV212(envelope, unique('command'), {
          ...operation,
          acknowledgment_id: unique('disclosure_ack_party_a'),
          event_id: unique('disclosure_ack_event_party_a'),
        }),
        execution_authority: partyAuthorityV212(envelope, 'party_a', 'external_relay'),
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'unauthorized_actor' });
    const forged = {
      actor_type: 'party',
      party_id: 'party_a',
      authenticated_subject_id: envelope.parties.party_a.authenticated_subject_id,
      interaction_authority: 'first_party_human',
    } as unknown as Parameters<typeof applyEnvelopeCeremonyCommandV212>[0]['execution_authority'];
    expect(
      applyEnvelopeCeremonyCommandV212({
        envelope,
        command: ceremonyCommandForV212(envelope, unique('command'), {
          ...operation,
          acknowledgment_id: unique('disclosure_ack_party_a'),
          event_id: unique('disclosure_ack_event_party_a'),
        }),
        execution_authority: forged,
      }),
    ).toMatchObject({ status: 'rejected', reason_code: 'unauthorized_actor' });
  });

  it('rejects a second current acknowledgment without mutating append-only history', () => {
    const envelope = acknowledge(disclosedEnvelope(), 'party_a');
    const result = applyEnvelopeCeremonyCommandV212({
      envelope,
      command: ceremonyCommandForV212(envelope, unique('command'), {
        type: 'record_disclosure_review_acknowledgment',
        acknowledgment_id: unique('disclosure_ack_party_a'),
        event_id: unique('disclosure_ack_event_party_a'),
        acknowledged_at: NOW,
      }),
      execution_authority: partyAuthorityV212(envelope, 'party_a', 'first_party_human'),
    });
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'invalid_transition' });
    expect(result.envelope).toEqual(envelope);
    expect(result.envelope.formation.disclosure_review_acknowledgments.party_a).toHaveLength(1);
  });

  it('does not add acknowledgment authority to the frozen relay effect union', () => {
    const envelope = disclosedEnvelope();
    const prepared = prepareExternalRelaySubmissionV212({
      envelope,
      execution_authority: partyAuthorityV212(envelope, 'party_a', 'external_relay'),
      intent: {
        intent_version: 'juryai-external-relay-submission-intent-v2.1.1',
        expected_party_visible_version: envelope.control.party_views.party_a.party_visible_version,
        expected_party_projection_hash: envelope.control.party_views.party_a.party_projection_hash,
        client_turn_id: unique('client_turn_party_a'),
        in_reply_to: [],
        payload: { context: [], answer: { role: 'user', text: 'I am done.' } },
        source_language: 'en',
        translation_indicated: false,
      },
      runtime: trustedExternalRelayRuntimeV211(TRUSTED_EXTERNAL_RELAY_BRIDGE_V211, {
        source_channel: 'webmcp_agent_relay',
        relaying_agent: 'attempted-ack-relay',
        received_at: NOW,
        payload_commitment_salt: 'attempted-ack-salt-0123456789',
        ids: {
          submission_id: unique('submission_party_a'),
          source_turn_id: unique('turn_party_a'),
          position_ids: [],
          clarification_ids: [],
          challenge_ids: [],
          challenge_response_ids: [],
        },
      }),
      compiler_run: {
        compile_run_id: unique('compile_run_party_a'),
        compiler_version_id: sha256('compiler'),
        party_projection_contract_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
        input_hash: sha256('input'),
        output_hash: sha256('output'),
      },
      effects: [
        {
          type: 'record_disclosure_review_acknowledgment',
        } as unknown as ExternalRelayEffectCandidateV211,
      ],
    });
    expect(prepared).toMatchObject({ status: 'rejected', reason_code: 'invalid_intent' });
  });

  it('preserves authoritative V2.1.2 internal CAS before entering the frozen relay adapter', () => {
    const requirementId = unique('req_party_a_stale');
    let envelope = createInitialCaseEnvelopeV212(unique('dispute_stale_relay'), {
      party_a: [requirement(requirementId)],
      party_b: [],
    });
    envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
      type: 'bind_party',
      party_slot: 'party_a',
      authenticated_subject_id: unique('subject_stale_party_a'),
      binding_event_id: unique('binding_party_a'),
    });
    const answer = 'Party A supplied an answer before hidden Party B binding.';
    const submission = prepareSubmission(
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
    const newer = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V212, {
      type: 'bind_party',
      party_slot: 'party_b',
      authenticated_subject_id: unique('subject_stale_party_b'),
      binding_event_id: unique('binding_party_b'),
    });
    expect(newer.control.party_views.party_a).toEqual(envelope.control.party_views.party_a);
    const result = applyExternalRelaySubmissionV212({
      envelope: newer,
      submission,
      execution_authority: partyAuthorityV212(newer, 'party_a', 'external_relay'),
    });
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'stale_internal_state' });
    expect(result.envelope).toEqual(newer);
    expect(Object.keys(result.envelope.source_turns)).toHaveLength(0);
  });

  it('requires disclosed challenge-response state with zero open challenges', () => {
    const independent = bindBoth(createInitialCaseEnvelopeV212(unique('dispute_wrong_phase')));
    const result = applyEnvelopeCeremonyCommandV212({
      envelope: independent,
      command: ceremonyCommandForV212(independent, unique('command'), {
        type: 'record_disclosure_review_acknowledgment',
        acknowledgment_id: unique('disclosure_ack_party_a'),
        event_id: unique('disclosure_ack_event_party_a'),
        acknowledged_at: NOW,
      }),
      execution_authority: partyAuthorityV212(independent, 'party_a', 'first_party_human'),
    });
    expect(result).toMatchObject({ status: 'rejected', reason_code: 'invalid_transition' });

    const cycle = challengeCycleEnvelope();
    const challenged = addChallenge(cycle.envelope, cycle.targetPositionId);
    const blocked = applyEnvelopeCeremonyCommandV212({
      envelope: challenged,
      command: ceremonyCommandForV212(challenged, unique('command'), {
        type: 'record_disclosure_review_acknowledgment',
        acknowledgment_id: unique('disclosure_ack_party_a'),
        event_id: unique('disclosure_ack_event_party_a'),
        acknowledged_at: NOW,
      }),
      execution_authority: partyAuthorityV212(challenged, 'party_a', 'first_party_human'),
    });
    expect(blocked).toMatchObject({ status: 'rejected', reason_code: 'invalid_transition' });
  });

  it('stamps exact canonical state bindings and validates tampered epoch/hash/readback fields', () => {
    const envelope = acknowledge(disclosedEnvelope(), 'party_a');
    const acknowledgment = envelope.formation.disclosure_review_acknowledgments.party_a[0]!;
    expect(acknowledgment).toMatchObject({
      acknowledgment_version: DISCLOSURE_REVIEW_ACKNOWLEDGMENT_VERSION_V212,
      dispute_id: envelope.control.case_id,
      party_id: 'party_a',
      authenticated_subject_id: envelope.parties.party_a.authenticated_subject_id,
      formation_epoch: envelope.parties.party_a.formation_epoch,
      party_projection_version: PARTY_FORMATION_PROJECTION_VERSION_V211,
      party_projection_hash: envelope.control.party_views.party_a.party_projection_hash,
      party_visible_version: envelope.control.party_views.party_a.party_visible_version,
      party_readback_version: PARTY_FORMATION_READBACK_VERSION_V211,
      party_readback_hash: renderPartyFormationReadbackV212(envelope, 'party_a').document_hash,
    });
    expect(acknowledgment.acknowledgment_statement_hash).toBe(
      sha256(DISCLOSURE_REVIEW_ACKNOWLEDGMENT_STATEMENT_V212),
    );

    for (const [field, value] of [
      ['formation_epoch', acknowledgment.formation_epoch + 1],
      ['party_projection_hash', 'f'.repeat(64)],
      ['party_visible_version', acknowledgment.party_visible_version + 1],
      ['party_readback_hash', 'e'.repeat(64)],
    ] as const) {
      const tampered = cloneCanonical(envelope);
      (
        tampered.formation.disclosure_review_acknowledgments.party_a[0] as unknown as Record<
          string,
          unknown
        >
      )[field] = value;
      tampered.control.envelope_hash = hashCaseEnvelopeV212(tampered);
      expect(validateCaseEnvelopeV212(tampered).map((entry) => entry.code)).toContain(
        'v212_disclosure_ack_shape',
      );
      expect(currentDisclosureReviewAcknowledgmentV212(tampered, 'party_a')).toBeNull();
    }
  });

  it('makes a party acknowledgment stale after that party explicitly reopens formation', () => {
    let envelope = disclosedEnvelope();
    envelope = acknowledge(envelope, 'party_a');
    envelope = acknowledge(envelope, 'party_b');
    const final = enterFinal(envelope);
    expect(final.status).toBe('applied');
    if (final.status !== 'applied') throw new Error(final.message);
    envelope = confirmParty(final.envelope, 'party_a');
    const priorEpoch = envelope.parties.party_a.formation_epoch;
    envelope = ceremony(envelope, partyAuthorityV212(envelope, 'party_a', 'first_party_human'), {
      type: 'reopen_own_formation',
      event_id: unique('reopen_event_party_a'),
      reason: 'Party A needs to revise its own formation.',
      occurred_at: new Date(Date.parse(NOW) + sequence * 1_000).toISOString(),
    });
    expect(envelope.parties.party_a.formation_epoch).toBe(priorEpoch + 1);
    expect(currentDisclosureReviewAcknowledgmentV212(envelope, 'party_a')).toBeNull();
    expect(currentDisclosureReviewAcknowledgmentV212(envelope, 'party_b')).not.toBeNull();
    expect(enterFinal(envelope).status).toBe('rejected');

    envelope = acknowledge(envelope, 'party_a');
    expect(enterFinal(envelope).status).toBe('applied');
    expect(envelope.formation.disclosure_review_acknowledgments.party_a).toHaveLength(2);
  });

  it('keeps both frozen semantic projections byte-identical and hides acknowledgment status', () => {
    const before = disclosedEnvelope();
    const projections = {
      party_a: canonicalSerialize(projectPartyFormationV212(before, 'party_a')),
      party_b: canonicalSerialize(projectPartyFormationV212(before, 'party_b')),
    };
    const cursors = cloneCanonical(before.control.party_views);
    const after = acknowledge(before, 'party_a');
    expect(canonicalSerialize(projectPartyFormationV212(after, 'party_a'))).toBe(
      projections.party_a,
    );
    expect(canonicalSerialize(projectPartyFormationV212(after, 'party_b'))).toBe(
      projections.party_b,
    );
    expect(after.control.party_views).toEqual(cursors);
    expect(JSON.stringify(projectPartyFormationV212(after, 'party_b'))).not.toContain(
      'disclosure_ack',
    );
  });

  it('permits a challenge after one acknowledgment and automatically stales that acknowledgment', () => {
    const cycle = challengeCycleEnvelope();
    const acknowledged = acknowledge(cycle.envelope, 'party_a');
    const prior = currentDisclosureReviewAcknowledgmentV212(acknowledged, 'party_a');
    expect(prior).not.toBeNull();
    const challenged = addChallenge(acknowledged, cycle.targetPositionId);
    expect(Object.values(challenged.challenges)).toHaveLength(1);
    expect(currentDisclosureReviewAcknowledgmentV212(challenged, 'party_a')).toBeNull();
    expect(enterFinal(challenged).status).toBe('rejected');
    expect(challenged.formation.disclosure_review_acknowledgments.party_a).toEqual([prior]);
  });

  it('keeps stale history append-only through response and requires both parties to re-acknowledge', () => {
    const cycle = challengeCycleEnvelope();
    let envelope = acknowledge(cycle.envelope, 'party_a');
    const stale = cloneCanonical(envelope.formation.disclosure_review_acknowledgments.party_a[0]!);
    envelope = addChallenge(envelope, cycle.targetPositionId);
    envelope = respondToChallenge(envelope);
    expect(Object.values(envelope.challenges)[0]?.status).toBe('resolved');
    expect(envelope.formation.disclosure_review_acknowledgments.party_a[0]).toEqual(stale);
    expect(currentDisclosureReviewAcknowledgmentV212(envelope, 'party_a')).toBeNull();
    expect(currentDisclosureReviewAcknowledgmentV212(envelope, 'party_b')).toBeNull();
    envelope = acknowledge(envelope, 'party_a');
    expect(enterFinal(envelope).status).toBe('rejected');
    envelope = acknowledge(envelope, 'party_b');
    const final = enterFinal(envelope);
    expect(final.status).toBe('applied');
    if (final.status !== 'applied') throw new Error(final.message);
    expect(final.envelope.control.workflow_state).toBe('final_confirmation');
    expect(currentDisclosureReviewAcknowledgmentV212(final.envelope, 'party_a')).not.toBeNull();
    expect(currentDisclosureReviewAcknowledgmentV212(final.envelope, 'party_b')).not.toBeNull();
  });

  it('rejects stale, cross-party, and cross-dispute acknowledgment reuse canonically', () => {
    const source = acknowledge(disclosedEnvelope(), 'party_a');
    const sourceAcknowledgment = source.formation.disclosure_review_acknowledgments.party_a[0]!;

    const wrongParty = cloneCanonical(source);
    wrongParty.formation.disclosure_review_acknowledgments.party_b.push(
      cloneCanonical(sourceAcknowledgment),
    );
    wrongParty.control.envelope_hash = hashCaseEnvelopeV212(wrongParty);
    expect(validateCaseEnvelopeV212(wrongParty).map((entry) => entry.code)).toContain(
      'v212_disclosure_ack_shape',
    );

    const otherDispute = disclosedEnvelope();
    otherDispute.formation.disclosure_review_acknowledgments.party_a.push(
      cloneCanonical(sourceAcknowledgment),
    );
    otherDispute.control.envelope_hash = hashCaseEnvelopeV212(otherDispute);
    expect(validateCaseEnvelopeV212(otherDispute).map((entry) => entry.code)).toContain(
      'v212_disclosure_ack_shape',
    );

    const stale = acknowledge(source, 'party_b');
    const invalid = cloneCanonical(stale);
    invalid.control.party_views.party_a.party_visible_version += 1;
    invalid.control.envelope_hash = hashCaseEnvelopeV212(invalid);
    expect(currentDisclosureReviewAcknowledgmentV212(invalid, 'party_a')).toBeNull();
  });

  it('requires two current acknowledgments and zero open challenges for final confirmation', () => {
    let envelope = disclosedEnvelope();
    envelope = acknowledge(envelope, 'party_a');
    envelope = acknowledge(envelope, 'party_b');
    const beforeVersion = envelope.control.envelope_version;
    const result = enterFinal(envelope);
    expect(result).toMatchObject({
      status: 'applied',
      prior_envelope_version: beforeVersion,
      resulting_envelope_version: beforeVersion + 1,
      changed_visible_parties: [],
    });
    if (result.status !== 'applied') throw new Error(result.message);
    expect(validateCaseEnvelopeV212(result.envelope)).toEqual([]);
    expect(deriveFormationReadinessV212(result.envelope).blockers).not.toContain(
      'party_a_disclosure_review_acknowledgment_missing_or_stale',
    );
  });

  it('applies the trusted final transition exactly once against authoritative CAS', () => {
    let envelope = disclosedEnvelope();
    envelope = acknowledge(envelope, 'party_a');
    envelope = acknowledge(envelope, 'party_b');
    const command = ceremonyCommandForV212(envelope, unique('command_final_once'), {
      type: 'enter_final_confirmation',
    });
    const first = applyEnvelopeCeremonyCommandV212({
      envelope,
      command,
      execution_authority: TRUSTED_SYSTEM_AUTHORITY_V212,
    });
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') throw new Error(first.message);
    const second = applyEnvelopeCeremonyCommandV212({
      envelope: first.envelope,
      command,
      execution_authority: TRUSTED_SYSTEM_AUTHORITY_V212,
    });
    expect(second).toMatchObject({ status: 'rejected', reason_code: 'stale_base_version' });
    expect(second.envelope).toEqual(first.envelope);
  });

  it('rejects a forged final state even when explanatory state and envelope hash are recomputed', () => {
    const envelope = disclosedEnvelope();
    const forged = cloneCanonical(envelope);
    forged.control.workflow_state = 'final_confirmation';
    forged.formation.explanatory = authoritativeFormationExplanatoryStateV212(forged);
    forged.control.envelope_hash = hashCaseEnvelopeV212(forged);
    expect(validateCaseEnvelopeV212(forged).map((entry) => entry.code)).toContain(
      'v212_disclosure_review_closure_missing',
    );
  });

  it('keeps production composition dark and the public WebMCP surface at exactly three tools', () => {
    const production = readFileSync(`${projectRoot}/src/webmcp/server/production.ts`, 'utf8');
    expect(production).not.toContain('v2-1-2');
    expect(production).not.toContain('V212');
    const service = {} as CaseServicePort;
    expect(createJuryAiToolDefinitions(service).map((tool) => tool.name)).toEqual([
      'start_case',
      'get_case_state',
      'submit_turn',
    ]);
  });

  it('does not alter the checked-in golden legacy production commitments', () => {
    const fixture = JSON.parse(
      readFileSync(
        `${projectRoot}/src/fixtures/webmcp-golden-production-case-commitments-v1.json`,
        'utf8',
      ),
    ) as { case_id: string; commitments: Record<string, string> };
    expect(fixture).toMatchObject({
      case_id: 'case_21919135-c72a-4e37-a18f-b4d274025298',
      commitments: {
        canonical_state_hash: 'b4bf79467e2a85e16389f2aa26ecde415861ce5575ffa5cb873bb9b81813f1ad',
        rendered_document_hash: 'a6ca8539069b5473002d22292b6490992a042163e1d8c6e8ea7b3f9a876f37c4',
      },
    });
  });
});
