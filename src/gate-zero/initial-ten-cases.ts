import { SYSTEM_ACTOR, createInitialCaseEnvelope, partyActor } from '../v2/case-envelope.js';
import { commandFor } from '../v2/envelope-command.js';
import { createBilateralLockedFixture } from '../v2/contract-fixtures.js';
import { CanonicalCaseAuthoringSession, type GateZeroCanonicalCase } from './canonical-case.js';
import {
  applied,
  classificationOperation,
  createBoundEnvelope,
  describedEvidence,
  exactReference,
  forbiddenPromotion,
  idempotent,
  partyFact,
  position,
  rehashEnvelope,
  rejected,
  source,
  systemFact,
  INSPECTOR_ACTOR,
} from './case-authoring-helpers.js';

function authorCase001(): GateZeroCanonicalCase {
  const session = new CanonicalCaseAuthoringSession(createInitialCaseEnvelope('gz_case_001'));
  session.turn({
    turn_id: 'gz_case_001_turn_01_bind_person_a',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_party_identity',
        party_id: 'party_a',
        authenticated_subject_id: 'subject_party_a',
        identity_assurance: 'authenticated',
        identity_event_id: 'event_gz_case_001_identity_a',
      },
    ],
    expected: applied(session, 1, {
      allowed_user_visible_facts: [
        systemFact('fact_gz_case_001_a_bound', 'Person A identity is authenticated and bound.'),
      ],
    }),
  });
  session.turn({
    turn_id: 'gz_case_001_turn_02_consent_pending',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'record_party_consent',
        party_id: 'party_a',
        consent_status: 'pending',
        consent_event_id: 'event_gz_case_001_consent_pending_a',
      },
    ],
    expected: applied(session, 1, {
      allowed_user_visible_facts: [
        systemFact('fact_gz_case_001_consent_pending', 'Person A consent remains pending.'),
      ],
    }),
  });
  const pendingActor = {
    actor_id: 'subject_party_a',
    actor_type: 'party' as const,
    party_id: 'party_a' as const,
    authenticated_subject_id: 'subject_party_a',
  };
  session.turn({
    turn_id: 'gz_case_001_turn_03_pending_consent_rejected',
    authenticated_actor: pendingActor,
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: {
          position_id: 'position_gz_case_001_pending',
          party_id: 'party_a',
          position_kind: 'assertion',
          target: null,
          statement: 'This must not be committed while consent is pending.',
          authority: {
            introduced_by: { actor_id: 'subject_party_a', actor_type: 'party' },
            authority_kind: 'party_assertion',
            authority_detail: 'Uncommitted pending-consent proposal',
            subject_actor_ids: ['subject_party_a'],
            source_references: [],
            evidence_ids: [],
            party_stances: {
              party_a: { stance: 'asserted', response_event_id: null },
              party_b: { stance: 'unresponded', response_event_id: null },
            },
            resolution_status: 'unresolved',
            adjudication_eligible: true,
            introduced_in_record_version: session.context.envelope.control.record_version + 1,
            last_material_record_version: session.context.envelope.control.record_version + 1,
            last_material_command_id: 'command_gz_case_001_turn_03_pending_consent_rejected',
          },
        },
      },
    ],
    expected: rejected(session, 'unauthorized_actor', {
      allowed_user_visible_facts: [
        systemFact(
          'fact_gz_case_001_pending_no_mutation',
          'Pending consent authorizes no party mutation.',
        ),
      ],
    }),
  });
  session.turn({
    turn_id: 'gz_case_001_turn_04_consent_granted',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'record_party_consent',
        party_id: 'party_a',
        consent_status: 'granted',
        consent_event_id: 'event_gz_case_001_consent_granted_a',
      },
    ],
    expected: applied(session, 1, {
      allowed_user_visible_facts: [
        systemFact('fact_gz_case_001_consent_granted', 'Person A explicitly granted consent.'),
      ],
    }),
  });
  const actorA = partyActor('party_a', session.context.envelope);
  session.turn({
    turn_id: 'gz_case_001_turn_05_party_cannot_bind_identity',
    authenticated_actor: actorA,
    operations: [
      {
        type: 'set_party_identity',
        party_id: 'party_a',
        authenticated_subject_id: 'subject_party_a',
        identity_assurance: 'verified',
        identity_event_id: 'event_gz_case_001_self_verified',
      },
    ],
    expected: rejected(session, 'unauthorized_actor'),
  });
  session.turn({
    turn_id: 'gz_case_001_turn_06_identity_replacement_rejected',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_party_identity',
        party_id: 'party_a',
        authenticated_subject_id: 'different_subject',
        identity_assurance: 'verified',
        identity_event_id: 'event_gz_case_001_identity_replacement',
      },
    ],
    expected: rejected(session, 'invalid_operation'),
  });
  session.turn({
    turn_id: 'gz_case_001_turn_07_person_b_preinvite_identity_rejected',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_party_identity',
        party_id: 'party_b',
        authenticated_subject_id: 'subject_party_b',
        identity_assurance: 'authenticated',
        identity_event_id: 'event_gz_case_001_identity_b_premature',
      },
    ],
    expected: rejected(session, 'invalid_operation'),
  });
  session.turn({
    turn_id: 'gz_case_001_turn_08_person_b_preinvite_consent_rejected',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'record_party_consent',
        party_id: 'party_b',
        consent_status: 'granted',
        consent_event_id: 'event_gz_case_001_consent_b_premature',
      },
    ],
    expected: rejected(session, 'invalid_operation', {
      allowed_user_visible_facts: [
        systemFact(
          'fact_gz_case_001_b_unbound',
          'Person B remains unbound, unverified, and not asked for consent.',
        ),
      ],
    }),
  });
  return session.finish('gz_case_001');
}

function authorCase002(): GateZeroCanonicalCase {
  const session = new CanonicalCaseAuthoringSession(createInitialCaseEnvelope('gz_case_002'));
  session.turn({
    turn_id: 'gz_case_002_turn_01_bind_person_a',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_party_identity',
        party_id: 'party_a',
        authenticated_subject_id: 'subject_party_a',
        identity_assurance: 'authenticated',
        identity_event_id: 'event_gz_case_002_identity_a',
      },
    ],
    expected: applied(session, 1, {}),
  });
  session.turn({
    turn_id: 'gz_case_002_turn_02_consent_person_a',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'record_party_consent',
        party_id: 'party_a',
        consent_status: 'granted',
        consent_event_id: 'event_gz_case_002_consent_a',
      },
    ],
    expected: applied(session, 1, {}),
  });
  const story = source(
    'source_gz_case_002_initial_story',
    'initial_story',
    'subject_party_a',
    'I hired a designer for a launch page. I paid a deposit, the page arrived late, and I want some money back.',
  );
  const storyRef = exactReference(story);
  session.turn({
    turn_id: 'gz_case_002_turn_03_brief_story',
    authenticated_actor: SYSTEM_ACTOR,
    introduced_sources: [story],
    operations: [
      { type: 'transition', event: 'initial_story_received', event_id: 'event_gz_case_002_story' },
    ],
    command_source_references: [storyRef],
    expected: applied(session, 0, {
      workflow_state: 'triage',
      required_source_references: [storyRef],
      next_question_target: {
        addressed_to_party: 'party_a',
        namespace: 'classification',
        object_id: null,
        field: 'required_fact_profile',
        reason_code: 'classify_brief_commercial_dispute',
      },
      allowed_user_visible_facts: [
        partyFact(
          'fact_gz_case_002_brief_story_received',
          'Person A says this is a paid design dispute involving delay and a refund request.',
          'party_a',
          [storyRef],
        ),
      ],
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_002_designer_breached',
          'The designer breached the agreement.',
          'objective_fact',
          'brief_story_is_party_assertion',
          [storyRef],
        ),
      ],
    }),
  });
  const classifyCommandId = 'command_gz_case_002_classify';
  session.turn({
    turn_id: 'gz_case_002_turn_04_classify',
    authenticated_actor: SYSTEM_ACTOR,
    command_id: classifyCommandId,
    operations: [
      classificationOperation(session, classifyCommandId, [storyRef], {
        case_category: 'commercial_service_delivery',
        suitability: 'eligible',
        maturity: 'ready',
        safety_flags: [],
        scope_flags: [],
        required_fact_profile: 'commercial_delivery',
      }),
    ],
    expected: applied(session, 1, {
      authority: [
        {
          namespace: 'classification',
          object_id: 'classification',
          authority_kind: 'system_observation',
          introduced_by_actor_id: SYSTEM_ACTOR.actor_id,
          resolution_status: 'unresolved',
          party_stances: { party_a: 'unresponded', party_b: 'unresponded' },
        },
      ],
      required_source_references: [storyRef],
    }),
  });
  session.turn({
    turn_id: 'gz_case_002_turn_05_enter_formation',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      { type: 'transition', event: 'triage_eligible', event_id: 'event_gz_case_002_eligible' },
    ],
    expected: applied(session, 0, {
      workflow_state: 'person_a_formation',
      next_question_target: {
        addressed_to_party: 'party_a',
        namespace: 'agreements',
        object_id: null,
        field: 'description',
        reason_code: 'highest_value_agreed_scope',
      },
    }),
  });
  const scopeAnswer = source(
    'source_gz_case_002_scope_answer',
    'clarification_answer',
    'subject_party_a',
    'We agreed on one responsive launch page with final files due Friday.',
  );
  const scopeRef = exactReference(scopeAnswer);
  const scopeCommandId = 'command_gz_case_002_scope_answer';
  session.turn({
    turn_id: 'gz_case_002_turn_06_scope_answer',
    authenticated_actor: partyActor('party_a', session.context.envelope),
    introduced_sources: [scopeAnswer],
    command_id: scopeCommandId,
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: position(
          session,
          'party_a',
          'position_gz_case_002_scope',
          scopeCommandId,
          'Person A says the agreed scope was one responsive launch page with final files due Friday.',
          [scopeRef],
        ),
      },
    ],
    command_source_references: [scopeRef],
    expected: applied(session, 1, {
      authority: [
        {
          namespace: 'positions',
          object_id: 'position_gz_case_002_scope',
          authority_kind: 'party_assertion',
          introduced_by_actor_id: 'subject_party_a',
          resolution_status: 'unresolved',
          party_stances: { party_a: 'asserted', party_b: 'unresponded' },
        },
      ],
      required_source_references: [scopeRef],
      next_question_target: {
        addressed_to_party: 'party_a',
        namespace: 'payments',
        object_id: null,
        field: 'due_trigger',
        reason_code: 'highest_value_payment_terms',
      },
      allowed_user_visible_facts: [
        partyFact(
          'fact_gz_case_002_a_scope',
          'Person A says the scope was one responsive launch page due Friday.',
          'party_a',
          [scopeRef],
        ),
      ],
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_002_scope_bilateral',
          'Both parties agree the scope and deadline were exactly as Person A described.',
          'bilateral_agreement',
          'person_b_has_not_responded',
          [scopeRef],
        ),
      ],
    }),
  });
  session.turn({
    turn_id: 'gz_case_002_turn_07_require_payment_term',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: ['payments.deposit', 'payments.balance_due_trigger'],
        ambiguities: ['The amount and balance due trigger are not yet stated.'],
        uncertainties: [],
        lock_prerequisites: ['person_a_record_complete'],
        lock_blockers: ['payment_terms_missing'],
      },
    ],
    expected: applied(session, 1, {
      next_question_target: {
        addressed_to_party: 'party_a',
        namespace: 'payments',
        object_id: null,
        field: 'amount_minor',
        reason_code: 'highest_value_payment_amount',
      },
    }),
  });
  const paymentAnswer = source(
    'source_gz_case_002_payment_answer',
    'clarification_answer',
    'subject_party_a',
    'I paid a USD 300 deposit. The remaining USD 300 was due only after final files were delivered.',
  );
  const paymentRef = exactReference(paymentAnswer);
  const paymentCommandId = 'command_gz_case_002_payment_answer';
  session.turn({
    turn_id: 'gz_case_002_turn_08_payment_answer',
    authenticated_actor: partyActor('party_a', session.context.envelope),
    introduced_sources: [paymentAnswer],
    command_id: paymentCommandId,
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: position(
          session,
          'party_a',
          'position_gz_case_002_payment',
          paymentCommandId,
          'Person A says USD 300 was paid and another USD 300 was due only after final delivery.',
          [paymentRef],
        ),
      },
    ],
    command_source_references: [paymentRef],
    expected: applied(session, 1, {
      authority: [
        {
          namespace: 'positions',
          object_id: 'position_gz_case_002_payment',
          authority_kind: 'party_assertion',
          introduced_by_actor_id: 'subject_party_a',
          resolution_status: 'unresolved',
          party_stances: { party_a: 'asserted', party_b: 'unresponded' },
        },
      ],
      required_source_references: [paymentRef],
    }),
  });
  session.turn({
    turn_id: 'gz_case_002_turn_09_final_catch_all_question',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: ['formation.final_open_catch_all'],
        ambiguities: [],
        uncertainties: [],
        lock_prerequisites: ['final_open_catch_all_answered'],
        lock_blockers: ['catch_all_not_answered'],
      },
    ],
    expected: applied(session, 1, {
      next_question_target: {
        addressed_to_party: 'party_a',
        namespace: 'formation',
        object_id: null,
        field: 'final_open_catch_all',
        reason_code: 'required_final_open_catch_all',
      },
    }),
  });
  const catchAll = source(
    'source_gz_case_002_catch_all',
    'clarification_answer',
    'subject_party_a',
    'One more thing: I offered two extra days, but I did not waive the Friday deadline.',
  );
  const catchAllRef = exactReference(catchAll);
  const catchAllCommandId = 'command_gz_case_002_catch_all';
  session.turn({
    turn_id: 'gz_case_002_turn_10_catch_all_answer',
    authenticated_actor: partyActor('party_a', session.context.envelope),
    introduced_sources: [catchAll],
    command_id: catchAllCommandId,
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: position(
          session,
          'party_a',
          'position_gz_case_002_extension',
          catchAllCommandId,
          'Person A says two extra days were offered without waiving the original deadline.',
          [catchAllRef],
        ),
      },
    ],
    command_source_references: [catchAllRef],
    expected: applied(session, 1, {
      authority: [
        {
          namespace: 'positions',
          object_id: 'position_gz_case_002_extension',
          authority_kind: 'party_assertion',
          introduced_by_actor_id: 'subject_party_a',
          resolution_status: 'unresolved',
          party_stances: { party_a: 'asserted', party_b: 'unresponded' },
        },
      ],
      required_source_references: [catchAllRef],
      allowed_user_visible_facts: [
        partyFact(
          'fact_gz_case_002_extension_offer',
          'Person A says an extra two days were offered without waiving the deadline.',
          'party_a',
          [catchAllRef],
        ),
      ],
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_002_no_waiver_fact',
          'The extension legally or objectively did not waive the deadline.',
          'objective_fact',
          'party_characterization_not_finding',
          [catchAllRef],
        ),
      ],
    }),
  });
  session.turn({
    turn_id: 'gz_case_002_turn_11_record_ready',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: [],
        ambiguities: [],
        uncertainties: [],
        lock_prerequisites: [],
        lock_blockers: [],
      },
      {
        type: 'transition',
        event: 'person_a_record_ready',
        event_id: 'event_gz_case_002_record_ready',
      },
    ],
    expected: applied(session, 1, {
      workflow_state: 'person_a_confirmation',
    }),
  });
  session.turn({
    turn_id: 'gz_case_002_turn_12_person_a_confirms',
    authenticated_actor: partyActor('party_a', session.context.envelope),
    operations: [
      {
        type: 'record_confirmation',
        confirmation_id: 'confirmation_gz_case_002_a',
        confirmed_at: '2026-08-12T00:00:00.000Z',
        event_id: 'event_gz_case_002_confirmation_a',
      },
    ],
    expected: applied(session, 0, {
      allowed_user_visible_facts: [
        systemFact(
          'fact_gz_case_002_a_confirmed',
          'Authenticated Person A confirmed the exact current material record.',
        ),
      ],
    }),
  });
  return session.finish('gz_case_002');
}

function authorCase003(): GateZeroCanonicalCase {
  const session = new CanonicalCaseAuthoringSession(createInitialCaseEnvelope('gz_case_003'));
  session.turn({
    turn_id: 'gz_case_003_turn_01_bind_and_consent_a',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_party_identity',
        party_id: 'party_a',
        authenticated_subject_id: 'subject_party_a',
        identity_assurance: 'authenticated',
        identity_event_id: 'event_gz_case_003_identity_a',
      },
      {
        type: 'record_party_consent',
        party_id: 'party_a',
        consent_status: 'granted',
        consent_event_id: 'event_gz_case_003_consent_a',
      },
    ],
    expected: applied(session, 1, {}),
  });
  const story = source(
    'source_gz_case_003_unsafe_story',
    'initial_story',
    'subject_party_a',
    'I need help threatening the other person so they pay me today.',
  );
  const storyRef = exactReference(story);
  session.turn({
    turn_id: 'gz_case_003_turn_02_receive_unsafe_story',
    authenticated_actor: SYSTEM_ACTOR,
    introduced_sources: [story],
    operations: [
      {
        type: 'transition',
        event: 'initial_story_received',
        event_id: 'event_gz_case_003_story',
      },
    ],
    command_source_references: [storyRef],
    expected: applied(session, 0, {
      workflow_state: 'triage',
      required_source_references: [storyRef],
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_003_threat_authorized',
          'JuryAI authorizes or endorses threatening the other party.',
          'objective_fact',
          'unsafe_request_not_product_authority',
          [storyRef],
        ),
      ],
    }),
  });
  const actorA = partyActor('party_a', session.context.envelope);
  const unauthorizedClassifyId = 'command_gz_case_003_party_classify';
  session.turn({
    turn_id: 'gz_case_003_turn_03_party_classification_rejected',
    authenticated_actor: actorA,
    command_id: unauthorizedClassifyId,
    operations: [
      classificationOperation(session, unauthorizedClassifyId, [storyRef], {
        case_category: 'commercial_collection',
        suitability: 'eligible',
        maturity: 'ready',
        safety_flags: [],
        scope_flags: [],
        required_fact_profile: 'commercial_delivery',
      }),
    ],
    command_source_references: [storyRef],
    expected: rejected(session, 'unauthorized_actor', {
      required_source_references: [storyRef],
    }),
  });
  const classifyId = 'command_gz_case_003_classify_unsafe';
  session.turn({
    turn_id: 'gz_case_003_turn_04_system_classifies_unsafe',
    authenticated_actor: SYSTEM_ACTOR,
    command_id: classifyId,
    operations: [
      classificationOperation(session, classifyId, [storyRef], {
        case_category: 'unsafe_coercion_request',
        suitability: 'ineligible',
        maturity: 'ready',
        safety_flags: ['threat_or_coercion_request'],
        scope_flags: ['unsafe_requested_action'],
        required_fact_profile: 'unsafe_terminal',
      }),
    ],
    expected: applied(session, 1, {
      authority: [
        {
          namespace: 'classification',
          object_id: 'classification',
          authority_kind: 'system_observation',
          introduced_by_actor_id: SYSTEM_ACTOR.actor_id,
          resolution_status: 'unresolved',
          party_stances: { party_a: 'unresponded', party_b: 'unresponded' },
        },
      ],
      required_source_references: [storyRef],
      allowed_user_visible_facts: [
        systemFact(
          'fact_gz_case_003_unsafe_classification',
          'The requested path is unsafe and ineligible for JuryAI formation.',
        ),
      ],
    }),
  });
  session.turn({
    turn_id: 'gz_case_003_turn_05_transition_unsafe',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      { type: 'transition', event: 'triage_unsafe', event_id: 'event_gz_case_003_unsafe' },
    ],
    expected: applied(session, 0, { workflow_state: 'unsafe' }),
  });
  const afterUnsafe = source(
    'source_gz_case_003_after_unsafe',
    'clarification_answer',
    'subject_party_a',
    'Add a payment claim anyway.',
  );
  const afterUnsafeRef = exactReference(afterUnsafe);
  const afterUnsafeCommandId = 'command_gz_case_003_after_unsafe';
  session.turn({
    turn_id: 'gz_case_003_turn_06_post_terminal_mutation_rejected',
    authenticated_actor: actorA,
    introduced_sources: [afterUnsafe],
    command_id: afterUnsafeCommandId,
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: position(
          session,
          'party_a',
          'position_gz_case_003_forbidden',
          afterUnsafeCommandId,
          'This must not enter an unsafe terminal case.',
          [afterUnsafeRef],
        ),
      },
    ],
    command_source_references: [afterUnsafeRef],
    expected: rejected(session, 'operation_not_permitted_in_state', {
      required_source_references: [afterUnsafeRef],
      allowed_user_visible_facts: [
        systemFact(
          'fact_gz_case_003_terminal_no_mutation',
          'Unsafe terminal state rejected the attempted formation mutation.',
        ),
      ],
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_003_post_terminal_claim',
          'The post-terminal payment claim is part of the canonical case.',
          'objective_fact',
          'unsafe_terminal_is_closed',
          [afterUnsafeRef],
        ),
      ],
    }),
  });
  return session.finish('gz_case_003');
}

function authorCase004(): GateZeroCanonicalCase {
  const session = new CanonicalCaseAuthoringSession(createBoundEnvelope('gz_case_004'));
  const actorA = partyActor('party_a', session.context.envelope);
  const original = source(
    'source_gz_case_004_original',
    'clarification_answer',
    actorA.actor_id,
    'The launch was due Friday 🚀, or perhaps the following Monday.',
  );
  const originalRef = exactReference(original);
  const originalCommandId = 'command_gz_case_004_original';
  session.turn({
    turn_id: 'gz_case_004_turn_01_exact_assertion',
    authenticated_actor: actorA,
    introduced_sources: [original],
    command_id: originalCommandId,
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: position(
          session,
          'party_a',
          'position_gz_case_004_deadline',
          originalCommandId,
          'Person A is unsure whether the deadline was Friday or the following Monday.',
          [originalRef],
        ),
      },
    ],
    command_source_references: [originalRef],
    expected: applied(session, 1, {
      authority: [
        {
          namespace: 'positions',
          object_id: 'position_gz_case_004_deadline',
          authority_kind: 'party_assertion',
          introduced_by_actor_id: actorA.actor_id,
          resolution_status: 'unresolved',
          party_stances: { party_a: 'asserted', party_b: 'unresponded' },
        },
      ],
      required_source_references: [originalRef],
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_004_certain_friday',
          'The deadline was Friday.',
          'objective_fact',
          'party_expressed_ambiguity',
          [originalRef],
        ),
      ],
    }),
  });
  const brokenRef = {
    source_id: originalRef.source_id,
    source_hash: originalRef.source_hash,
    span: {
      encoding: 'utf16' as const,
      start: 0,
      end: original.content.length - 1,
      quote: original.content,
    },
  };
  session.turn({
    turn_id: 'gz_case_004_turn_02_utf16_off_by_one_rejected',
    authenticated_actor: actorA,
    command_source_references: [brokenRef],
    operations: [
      {
        type: 'replace_own_field',
        namespace: 'positions',
        object_id: 'position_gz_case_004_deadline',
        field: 'statement',
        expected_prior_value:
          'Person A is unsure whether the deadline was Friday or the following Monday.',
        replacement_value: 'The deadline was Friday.',
      },
    ],
    expected: rejected(session, 'invalid_source_reference', {
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_004_bad_span',
          'An inexact UTF-16 span supports a deadline correction.',
          'objective_fact',
          'source_span_not_exact',
          [originalRef],
        ),
      ],
    }),
  });
  session.turn({
    turn_id: 'gz_case_004_turn_03_ambiguity_recorded',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: ['events.delivery_due.date'],
        ambiguities: ['Friday and following Monday are both asserted as possible deadlines.'],
        uncertainties: [],
        lock_prerequisites: ['deadline_clarified'],
        lock_blockers: ['deadline_ambiguous'],
      },
    ],
    expected: applied(session, 1, {
      next_question_target: {
        addressed_to_party: 'party_a',
        namespace: 'events',
        object_id: 'position_gz_case_004_deadline',
        field: 'date',
        reason_code: 'resolve_deadline_ambiguity',
      },
    }),
  });
  const uncertain = source(
    'source_gz_case_004_uncertain',
    'clarification_answer',
    actorA.actor_id,
    'I still do not know; I need to check the messages.',
  );
  const uncertainRef = exactReference(uncertain);
  session.turn({
    turn_id: 'gz_case_004_turn_04_uncertainty_preserved',
    authenticated_actor: SYSTEM_ACTOR,
    introduced_sources: [uncertain],
    command_source_references: [uncertainRef],
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: ['events.delivery_due.date'],
        ambiguities: ['Friday and following Monday remain possible deadlines.'],
        uncertainties: ['Person A must inspect the underlying messages.'],
        lock_prerequisites: ['deadline_clarified'],
        lock_blockers: ['deadline_ambiguous'],
      },
    ],
    expected: applied(session, 1, {
      required_source_references: [uncertainRef],
      next_question_target: {
        addressed_to_party: 'party_a',
        namespace: 'events',
        object_id: 'position_gz_case_004_deadline',
        field: 'date',
        reason_code: 'request_checked_deadline',
      },
    }),
  });
  session.turn({
    turn_id: 'gz_case_004_turn_05_unrelated_state_keeps_ambiguity',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: ['events.delivery_due.date'],
        ambiguities: ['Friday and following Monday remain possible deadlines.'],
        uncertainties: ['Awaiting the underlying message.'],
        lock_prerequisites: ['deadline_clarified'],
        lock_blockers: ['deadline_ambiguous'],
      },
    ],
    expected: applied(session, 1, {
      next_question_target: {
        addressed_to_party: 'party_a',
        namespace: 'events',
        object_id: 'position_gz_case_004_deadline',
        field: 'date',
        reason_code: 'highest_value_unresolved_deadline',
      },
    }),
  });
  const correction = source(
    'source_gz_case_004_correction',
    'clarification_answer',
    actorA.actor_id,
    'I checked. The message says Monday, not Friday.',
  );
  const correctionRef = exactReference(correction);
  session.turn({
    turn_id: 'gz_case_004_turn_06_delayed_correction',
    authenticated_actor: actorA,
    introduced_sources: [correction],
    command_source_references: [correctionRef],
    operations: [
      {
        type: 'replace_own_field',
        namespace: 'positions',
        object_id: 'position_gz_case_004_deadline',
        field: 'statement',
        expected_prior_value:
          'Person A is unsure whether the deadline was Friday or the following Monday.',
        replacement_value: 'Person A says the checked message states Monday, not Friday.',
      },
    ],
    expected: applied(session, 1, {
      required_source_references: [correctionRef],
      allowed_user_visible_facts: [
        partyFact(
          'fact_gz_case_004_corrected_deadline',
          'Person A says a checked message states Monday, not Friday.',
          'party_a',
          [correctionRef],
        ),
      ],
    }),
  });
  session.turn({
    turn_id: 'gz_case_004_turn_07_stale_prior_rejected',
    authenticated_actor: actorA,
    command_source_references: [correctionRef],
    operations: [
      {
        type: 'replace_own_field',
        namespace: 'positions',
        object_id: 'position_gz_case_004_deadline',
        field: 'statement',
        expected_prior_value:
          'Person A is unsure whether the deadline was Friday or the following Monday.',
        replacement_value: 'The stale overwrite must not apply.',
      },
    ],
    expected: rejected(session, 'stale_prior_value'),
  });
  session.turn({
    turn_id: 'gz_case_004_turn_08_ambiguity_cleared',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: [],
        ambiguities: [],
        uncertainties: [],
        lock_prerequisites: ['final_catch_all'],
        lock_blockers: [],
      },
    ],
    expected: applied(session, 1, {}),
  });
  session.turn({
    turn_id: 'gz_case_004_turn_09_assertion_remains_attributed',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: [],
        ambiguities: [],
        uncertainties: [],
        lock_prerequisites: [],
        lock_blockers: [],
      },
    ],
    expected: applied(session, 1, {
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_004_monday_objective',
          'The deadline objectively was Monday.',
          'objective_fact',
          'only_person_a_asserted_monday',
          [correctionRef],
        ),
      ],
    }),
  });
  session.turn({
    turn_id: 'gz_case_004_turn_10_ready_question_none',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: [],
        ambiguities: [],
        uncertainties: [],
        lock_prerequisites: [],
        lock_blockers: [],
      },
    ],
    expected: applied(session, 1, {}),
  });
  return session.finish('gz_case_004');
}

function authorCase005(): GateZeroCanonicalCase {
  const session = new CanonicalCaseAuthoringSession(createBoundEnvelope('gz_case_005'));
  const actorA = partyActor('party_a', session.context.envelope);
  const assertion = source(
    'source_gz_case_005_assertion',
    'clarification_answer',
    actorA.actor_id,
    'The first stable command records this assertion.',
  );
  const assertionRef = exactReference(assertion);
  const firstId = 'command_gz_case_005_stable';
  session.turn({
    turn_id: 'gz_case_005_turn_01_current_cas_applies',
    authenticated_actor: actorA,
    introduced_sources: [assertion],
    command_id: firstId,
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: position(
          session,
          'party_a',
          'position_gz_case_005_first',
          firstId,
          'Person A records the first assertion.',
          [assertionRef],
        ),
      },
    ],
    command_source_references: [assertionRef],
    save_command_as: 'first',
    expected: applied(session, 1, {}),
  });
  session.turn({
    turn_id: 'gz_case_005_turn_02_identical_retry',
    authenticated_actor: actorA,
    command_factory: (context) => context.saved_commands.first!,
    expected: idempotent(session),
  });
  session.turn({
    turn_id: 'gz_case_005_turn_03_conflicting_duplicate',
    authenticated_actor: actorA,
    command_factory: (context) =>
      commandFor(
        context.envelope,
        actorA,
        firstId,
        [
          {
            type: 'set_formation_requirements',
            open_required_fields: [],
            ambiguities: [],
            uncertainties: [],
            lock_prerequisites: [],
            lock_blockers: [],
          },
        ],
        [],
      ),
    expected: rejected(session, 'duplicate_command_conflict'),
  });
  session.turn({
    turn_id: 'gz_case_005_turn_04_stale_version',
    authenticated_actor: SYSTEM_ACTOR,
    command_factory: (context) => ({
      ...commandFor(
        context.envelope,
        SYSTEM_ACTOR,
        'command_gz_case_005_stale_version',
        [
          {
            type: 'set_formation_requirements',
            open_required_fields: [],
            ambiguities: [],
            uncertainties: [],
            lock_prerequisites: [],
            lock_blockers: [],
          },
        ],
        [],
      ),
      base_envelope_version: context.envelope.control.envelope_version - 1,
    }),
    expected: rejected(session, 'stale_base_version'),
  });
  session.turn({
    turn_id: 'gz_case_005_turn_05_stale_hash',
    authenticated_actor: SYSTEM_ACTOR,
    command_factory: (context) => ({
      ...commandFor(
        context.envelope,
        SYSTEM_ACTOR,
        'command_gz_case_005_stale_hash',
        [
          {
            type: 'set_formation_requirements',
            open_required_fields: [],
            ambiguities: [],
            uncertainties: [],
            lock_prerequisites: [],
            lock_blockers: [],
          },
        ],
        [],
      ),
      base_envelope_hash: '0'.repeat(64),
    }),
    expected: rejected(session, 'stale_base_hash'),
  });
  session.turn({
    turn_id: 'gz_case_005_turn_06_second_current_command',
    authenticated_actor: SYSTEM_ACTOR,
    command_id: 'command_gz_case_005_second',
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: ['formation.catch_all'],
        ambiguities: [],
        uncertainties: [],
        lock_prerequisites: ['catch_all_answered'],
        lock_blockers: ['catch_all_missing'],
      },
    ],
    save_command_as: 'second',
    expected: applied(session, 1, {}),
  });
  session.turn({
    turn_id: 'gz_case_005_turn_07_second_retry',
    authenticated_actor: SYSTEM_ACTOR,
    command_factory: (context) => context.saved_commands.second!,
    expected: idempotent(session),
  });
  session.turn({
    turn_id: 'gz_case_005_turn_08_execution_actor_mismatch',
    authenticated_actor: actorA,
    execution_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'replace_own_field',
        namespace: 'positions',
        object_id: 'position_gz_case_005_first',
        field: 'statement',
        expected_prior_value: 'Person A records the first assertion.',
        replacement_value: 'This mismatched actor must not apply.',
      },
    ],
    command_source_references: [assertionRef],
    expected: rejected(session, 'authentication_mismatch'),
  });
  return session.finish('gz_case_005');
}

function authorCase006(): GateZeroCanonicalCase {
  const session = new CanonicalCaseAuthoringSession(
    createBoundEnvelope('gz_case_006', 'reconciliation'),
  );
  const actorA = partyActor('party_a', session.context.envelope);
  const actorB = partyActor('party_b', session.context.envelope);
  const sourceA = source(
    'source_gz_case_006_a',
    'clarification_answer',
    actorA.actor_id,
    'A says Friday.',
  );
  const sourceB = source(
    'source_gz_case_006_b',
    'clarification_answer',
    actorB.actor_id,
    'B says Monday.',
  );
  const refA = exactReference(sourceA);
  const refB = exactReference(sourceB);
  const addAId = 'command_gz_case_006_add_a';
  session.turn({
    turn_id: 'gz_case_006_turn_01_a_adds_own_assertion',
    authenticated_actor: actorA,
    introduced_sources: [sourceA],
    command_id: addAId,
    command_source_references: [refA],
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: position(
          session,
          'party_a',
          'position_gz_case_006_a',
          addAId,
          'Person A says Friday.',
          [refA],
        ),
      },
    ],
    expected: applied(session, 1, {}),
  });
  const addBId = 'command_gz_case_006_add_b';
  session.turn({
    turn_id: 'gz_case_006_turn_02_b_adds_own_assertion',
    authenticated_actor: actorB,
    introduced_sources: [sourceB],
    command_id: addBId,
    command_source_references: [refB],
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: position(
          session,
          'party_b',
          'position_gz_case_006_b',
          addBId,
          'Person B says Monday.',
          [refB],
        ),
      },
    ],
    expected: applied(session, 1, {}),
  });
  session.turn({
    turn_id: 'gz_case_006_turn_03_a_cannot_edit_b',
    authenticated_actor: actorA,
    command_source_references: [refA],
    operations: [
      {
        type: 'replace_own_field',
        namespace: 'positions',
        object_id: 'position_gz_case_006_b',
        field: 'statement',
        expected_prior_value: 'Person B says Monday.',
        replacement_value: 'Person A overwrote B.',
      },
    ],
    expected: rejected(session, 'cross_party_mutation'),
  });
  session.turn({
    turn_id: 'gz_case_006_turn_04_b_cannot_withdraw_a',
    authenticated_actor: actorB,
    command_source_references: [refB],
    operations: [
      {
        type: 'set_own_stance',
        namespace: 'positions',
        object_id: 'position_gz_case_006_a',
        stance: 'withdrawn',
        response_event_id: 'event_gz_case_006_b_withdraw_a',
      },
    ],
    expected: rejected(session, 'invalid_operation'),
  });
  const atomicId = 'command_gz_case_006_atomic';
  session.turn({
    turn_id: 'gz_case_006_turn_05_atomic_second_operation_fails',
    authenticated_actor: actorA,
    command_id: atomicId,
    command_source_references: [refA],
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: position(
          session,
          'party_a',
          'position_gz_case_006_rolled_back',
          atomicId,
          'This valid first operation must roll back.',
          [refA],
        ),
      },
      {
        type: 'replace_own_field',
        namespace: 'positions',
        object_id: 'position_gz_case_006_b',
        field: 'statement',
        expected_prior_value: 'Person B says Monday.',
        replacement_value: 'Forbidden second operation.',
      },
    ],
    expected: rejected(session, 'cross_party_mutation'),
  });
  session.turn({
    turn_id: 'gz_case_006_turn_06_rolled_back_object_absent',
    authenticated_actor: actorA,
    command_source_references: [refA],
    operations: [
      {
        type: 'replace_own_field',
        namespace: 'positions',
        object_id: 'position_gz_case_006_rolled_back',
        field: 'statement',
        expected_prior_value: 'This valid first operation must roll back.',
        replacement_value: 'Should remain absent.',
      },
    ],
    expected: rejected(session, 'unknown_object'),
  });
  session.turn({
    turn_id: 'gz_case_006_turn_07_b_disputes_a',
    authenticated_actor: actorB,
    command_source_references: [refB],
    operations: [
      {
        type: 'set_own_stance',
        namespace: 'positions',
        object_id: 'position_gz_case_006_a',
        stance: 'disputed',
        response_event_id: 'event_gz_case_006_b_disputes_a',
      },
    ],
    expected: applied(session, 1, {}),
  });
  session.turn({
    turn_id: 'gz_case_006_turn_08_disagreement_not_agreement',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: [],
        ambiguities: ['The parties assert different deadlines.'],
        uncertainties: [],
        lock_prerequisites: [],
        lock_blockers: ['deadline_disputed'],
      },
    ],
    expected: applied(session, 1, {
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_006_silence_agreement',
          'The parties agreed on Friday.',
          'bilateral_agreement',
          'party_b_disputed_person_a',
          [refA, refB],
        ),
      ],
    }),
  });
  return session.finish('gz_case_006');
}

function authorCase007(): GateZeroCanonicalCase {
  const initial = createBoundEnvelope('gz_case_007');
  initial.parties.party_b = {
    ...createInitialCaseEnvelope('gz_case_007').parties.party_b,
  };
  initial.control.workflow_state = 'person_a_formation';
  rehashEnvelope(initial);
  const detailedA = source(
    'source_gz_case_007_detailed_a',
    'initial_story',
    'subject_party_a',
    'Person A says Person B promised a Friday delivery and kept the deposit.',
  );
  const session = new CanonicalCaseAuthoringSession(initial, [detailedA]);
  const actorA = partyActor('party_a', session.context.envelope);
  session.turn({
    turn_id: 'gz_case_007_turn_01_person_a_record_ready',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      { type: 'transition', event: 'person_a_record_ready', event_id: 'event_gz_case_007_a_ready' },
    ],
    expected: applied(session, 0, { workflow_state: 'person_a_confirmation' }),
  });
  session.turn({
    turn_id: 'gz_case_007_turn_02_person_a_confirms',
    authenticated_actor: actorA,
    operations: [
      {
        type: 'record_confirmation',
        confirmation_id: 'confirmation_gz_case_007_a',
        confirmed_at: '2026-08-12T01:00:00.000Z',
        event_id: 'event_gz_case_007_a_confirms',
      },
    ],
    expected: applied(session, 0),
  });
  session.turn({
    turn_id: 'gz_case_007_turn_03_person_a_confirmed_transition',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'transition',
        event: 'person_a_confirmed',
        event_id: 'event_gz_case_007_a_confirmed',
      },
    ],
    expected: applied(session, 0, { workflow_state: 'awaiting_person_b' }),
  });
  session.turn({
    turn_id: 'gz_case_007_turn_04_premature_detailed_disclosure',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      { type: 'record_detailed_disclosure', event_id: 'event_gz_case_007_premature_disclosure' },
    ],
    expected: rejected(session, 'operation_not_permitted_in_state', {
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_007_embargoed_a_detail',
          'Person A says Person B promised Friday and kept the deposit.',
          'disclosed_context',
          'person_b_has_not_given_independent_account',
          [exactReference(detailedA)],
        ),
      ],
    }),
  });
  session.turn({
    turn_id: 'gz_case_007_turn_05_invite_person_b',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_party_participation',
        party_id: 'party_b',
        participation_state: 'invited',
        invitation_event_id: 'event_gz_case_007_invite_b',
      },
    ],
    expected: applied(session, 1, {}),
  });
  session.turn({
    turn_id: 'gz_case_007_turn_06_enter_independent_account',
    authenticated_actor: SYSTEM_ACTOR,
    visible_source_ids: [],
    visible_envelope_paths: ['/classification', '/control/workflow_state', '/parties/party_b'],
    embargoed_envelope_paths: ['/formation/disclosure', '/positions'],
    operations: [
      { type: 'transition', event: 'person_b_invited', event_id: 'event_gz_case_007_b_invited' },
    ],
    expected: applied(session, 0, { workflow_state: 'person_b_independent_account' }),
  });
  session.turn({
    turn_id: 'gz_case_007_turn_07_bind_person_b',
    authenticated_actor: SYSTEM_ACTOR,
    visible_source_ids: [],
    visible_envelope_paths: ['/classification', '/control/workflow_state', '/parties/party_b'],
    embargoed_envelope_paths: ['/formation/disclosure', '/positions'],
    operations: [
      {
        type: 'set_party_identity',
        party_id: 'party_b',
        authenticated_subject_id: 'subject_party_b',
        identity_assurance: 'authenticated',
        identity_event_id: 'event_gz_case_007_identity_b',
      },
    ],
    expected: applied(session, 1, {}),
  });
  const actorBPending = {
    actor_id: 'subject_party_b',
    actor_type: 'party' as const,
    party_id: 'party_b' as const,
    authenticated_subject_id: 'subject_party_b',
  };
  const account = source(
    'source_gz_case_007_b_account',
    'independent_account',
    'subject_party_b',
    'I was hired for a draft page. I did not agree that final files were due Friday.',
  );
  const accountRef = exactReference(account);
  session.turn({
    turn_id: 'gz_case_007_turn_08_unconsented_b_rejected',
    authenticated_actor: actorBPending,
    introduced_sources: [account],
    visible_source_ids: [account.source_id],
    visible_envelope_paths: ['/classification', '/control/workflow_state', '/parties/party_b'],
    embargoed_envelope_paths: ['/formation/disclosure', '/positions'],
    operations: [
      {
        type: 'record_independent_account',
        source_reference: accountRef,
        event_id: 'event_gz_case_007_b_unconsented',
      },
    ],
    expected: rejected(session, 'unauthorized_actor', {
      required_source_references: [accountRef],
    }),
  });
  session.turn({
    turn_id: 'gz_case_007_turn_09_consent_person_b',
    authenticated_actor: SYSTEM_ACTOR,
    visible_source_ids: [],
    visible_envelope_paths: ['/classification', '/control/workflow_state', '/parties/party_b'],
    embargoed_envelope_paths: ['/formation/disclosure', '/positions'],
    operations: [
      {
        type: 'record_party_consent',
        party_id: 'party_b',
        consent_status: 'granted',
        consent_event_id: 'event_gz_case_007_consent_b',
      },
    ],
    expected: applied(session, 1, {}),
  });
  const fakeAAccount = source(
    'source_gz_case_007_a_fake_account',
    'independent_account',
    actorA.actor_id,
    'Person A cannot provide Person B independent account.',
  );
  const fakeARef = exactReference(fakeAAccount);
  session.turn({
    turn_id: 'gz_case_007_turn_10_person_a_cannot_answer_for_b',
    authenticated_actor: actorA,
    introduced_sources: [fakeAAccount],
    visible_source_ids: [fakeAAccount.source_id],
    visible_envelope_paths: ['/classification', '/control/workflow_state', '/parties/party_b'],
    embargoed_envelope_paths: ['/formation/disclosure', '/positions'],
    operations: [
      {
        type: 'record_independent_account',
        source_reference: fakeARef,
        event_id: 'event_gz_case_007_a_fake_b',
      },
    ],
    expected: rejected(session, 'unauthorized_actor', { required_source_references: [fakeARef] }),
  });
  const actorB = partyActor('party_b', session.context.envelope);
  session.turn({
    turn_id: 'gz_case_007_turn_11_person_b_independent_account',
    authenticated_actor: actorB,
    visible_source_ids: [account.source_id],
    visible_envelope_paths: ['/classification', '/control/workflow_state', '/parties/party_b'],
    embargoed_envelope_paths: ['/formation/disclosure', '/positions'],
    operations: [
      {
        type: 'record_independent_account',
        source_reference: accountRef,
        event_id: 'event_gz_case_007_b_account',
      },
    ],
    expected: applied(session, 1, {
      workflow_state: 'disclosure_challenge',
      required_source_references: [accountRef],
      allowed_user_visible_facts: [
        partyFact(
          'fact_gz_case_007_b_account',
          'Person B says the work was a draft and denies a Friday final-file deadline.',
          'party_b',
          [accountRef],
        ),
      ],
    }),
  });
  session.turn({
    turn_id: 'gz_case_007_turn_12_detailed_disclosure_after_account',
    authenticated_actor: SYSTEM_ACTOR,
    visible_source_ids: [account.source_id, detailedA.source_id],
    visible_envelope_paths: [''],
    embargoed_envelope_paths: [],
    operations: [{ type: 'record_detailed_disclosure', event_id: 'event_gz_case_007_disclosure' }],
    expected: applied(session, 1, {
      allowed_user_visible_facts: [
        partyFact(
          'fact_gz_case_007_a_detail_now_disclosed',
          'Person A says Person B promised Friday and kept the deposit.',
          'party_a',
          [exactReference(detailedA)],
        ),
      ],
    }),
  });
  return session.finish('gz_case_007');
}

function authorCase008(): GateZeroCanonicalCase {
  const session = new CanonicalCaseAuthoringSession(
    createBoundEnvelope('gz_case_008', 'reconciliation'),
  );
  const actorA = partyActor('party_a', session.context.envelope);
  const actorB = partyActor('party_b', session.context.envelope);
  const description = source(
    'source_gz_case_008_description',
    'clarification_answer',
    actorA.actor_id,
    'I have a screenshot that I say was sent by Person B.',
  );
  const descriptionRef = exactReference(description);
  const evidenceId = 'evidence_gz_case_008_primary';
  const describeId = 'command_gz_case_008_describe';
  session.turn({
    turn_id: 'gz_case_008_turn_01_described_only',
    authenticated_actor: actorA,
    introduced_sources: [description],
    command_id: describeId,
    command_source_references: [descriptionRef],
    operations: [
      {
        type: 'add_object',
        namespace: 'evidence',
        object: describedEvidence(
          session,
          'party_a',
          evidenceId,
          describeId,
          [descriptionRef],
          actorB.actor_id,
        ),
      },
    ],
    expected: applied(session, 1, {
      authority: [
        {
          namespace: 'evidence',
          object_id: evidenceId,
          authority_kind: 'party_assertion',
          introduced_by_actor_id: actorA.actor_id,
          resolution_status: 'unresolved',
          party_stances: { party_a: 'asserted', party_b: 'unresponded' },
        },
      ],
      evidence_actions: [{ evidence_id: evidenceId, action: 'described' }],
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_008_described_verified',
          'The described screenshot exists and was authored by Person B.',
          'verified_evidence',
          'described_only_and_asserted_authorship',
          [descriptionRef],
        ),
      ],
    }),
  });
  session.turn({
    turn_id: 'gz_case_008_turn_02_party_cannot_record_upload',
    authenticated_actor: actorA,
    operations: [
      { type: 'record_evidence_upload', evidence_id: evidenceId, content_hash: '1'.repeat(64) },
    ],
    expected: rejected(session, 'unauthorized_actor'),
  });
  session.turn({
    turn_id: 'gz_case_008_turn_03_system_records_upload',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      { type: 'record_evidence_upload', evidence_id: evidenceId, content_hash: '1'.repeat(64) },
    ],
    expected: applied(session, 1, {
      evidence_actions: [{ evidence_id: evidenceId, action: 'uploaded' }],
    }),
  });
  session.turn({
    turn_id: 'gz_case_008_turn_04_upload_identity_immutable',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      { type: 'record_evidence_upload', evidence_id: evidenceId, content_hash: '2'.repeat(64) },
    ],
    expected: rejected(session, 'invalid_operation'),
  });
  const incompleteInspection = source(
    'source_gz_case_008_incomplete_inspection',
    'evidence_inspection',
    INSPECTOR_ACTOR.actor_id,
    'Only the top half of the uploaded screenshot is readable.',
  );
  const incompleteRef = exactReference(incompleteInspection);
  session.turn({
    turn_id: 'gz_case_008_turn_05_incomplete_inspection',
    authenticated_actor: INSPECTOR_ACTOR,
    introduced_sources: [incompleteInspection],
    operations: [
      {
        type: 'record_evidence_inspection',
        evidence_id: evidenceId,
        status: 'inspected_incomplete',
        result_id: 'inspection_gz_case_008_incomplete',
        result_version: 'v1',
        result_hash: incompleteInspection.content_hash,
        limitations: ['bottom_half_unreadable'],
        source_reference: incompleteRef,
      },
    ],
    expected: applied(session, 1, {
      evidence_actions: [{ evidence_id: evidenceId, action: 'inspected' }],
      required_source_references: [incompleteRef],
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_008_incomplete_complete',
          'The inspector verified the complete screenshot.',
          'verified_evidence',
          'inspection_explicitly_incomplete',
          [incompleteRef],
        ),
      ],
    }),
  });
  const unreadableInspection = source(
    'source_gz_case_008_unreadable_inspection',
    'evidence_inspection',
    INSPECTOR_ACTOR.actor_id,
    'The uploaded bytes cannot be read reliably.',
  );
  const unreadableRef = exactReference(unreadableInspection);
  session.turn({
    turn_id: 'gz_case_008_turn_06_unreadable_inspection',
    authenticated_actor: INSPECTOR_ACTOR,
    introduced_sources: [unreadableInspection],
    operations: [
      {
        type: 'record_evidence_inspection',
        evidence_id: evidenceId,
        status: 'unreadable',
        result_id: 'inspection_gz_case_008_unreadable',
        result_version: 'v2',
        result_hash: unreadableInspection.content_hash,
        limitations: ['unreadable'],
        source_reference: unreadableRef,
      },
    ],
    expected: applied(session, 1, {
      evidence_actions: [{ evidence_id: evidenceId, action: 'inspected' }],
      required_source_references: [unreadableRef],
    }),
  });
  session.turn({
    turn_id: 'gz_case_008_turn_07_disclosure_does_not_cure_unreadable',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_evidence_visibility',
        evidence_id: evidenceId,
        visibility: 'disclosed_to_both',
        disclosure_event_id: 'event_gz_case_008_disclose_unreadable',
      },
    ],
    expected: applied(session, 1, {
      evidence_actions: [{ evidence_id: evidenceId, action: 'visibility_changed' }],
      allowed_user_visible_facts: [
        systemFact(
          'fact_gz_case_008_disclosed_but_unreadable',
          'The evidence is disclosed to both parties but remains unreadable and ineligible.',
        ),
      ],
    }),
  });
  const completeInspection = source(
    'source_gz_case_008_complete_inspection',
    'evidence_inspection',
    INSPECTOR_ACTOR.actor_id,
    'A new deterministic inspection read the complete uploaded screenshot bytes.',
  );
  const completeRef = exactReference(completeInspection);
  session.turn({
    turn_id: 'gz_case_008_turn_08_complete_reinspection',
    authenticated_actor: INSPECTOR_ACTOR,
    introduced_sources: [completeInspection],
    operations: [
      {
        type: 'record_evidence_inspection',
        evidence_id: evidenceId,
        status: 'inspected_complete',
        result_id: 'inspection_gz_case_008_complete',
        result_version: 'v3',
        result_hash: completeInspection.content_hash,
        limitations: [],
        source_reference: completeRef,
      },
    ],
    expected: applied(session, 1, {
      evidence_actions: [{ evidence_id: evidenceId, action: 'inspected' }],
      required_source_references: [completeRef],
    }),
  });
  session.turn({
    turn_id: 'gz_case_008_turn_09_disclosed_complete_is_eligible',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_evidence_visibility',
        evidence_id: evidenceId,
        visibility: 'disclosed_to_both',
        disclosure_event_id: 'event_gz_case_008_disclose_complete',
      },
    ],
    expected: applied(session, 1, {
      evidence_actions: [{ evidence_id: evidenceId, action: 'visibility_changed' }],
      allowed_user_visible_facts: [
        systemFact(
          'fact_gz_case_008_eligible',
          'The exact uploaded bytes are completely inspected, disclosed to both parties, and evidence-eligible.',
        ),
      ],
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_008_authorship_proven',
          'Person B authored the screenshot.',
          'verified_evidence',
          'inspection_does_not_prove_authorship',
          [completeRef],
        ),
      ],
    }),
  });
  const challenge = source(
    'source_gz_case_008_authorship_challenge',
    'challenge',
    actorB.actor_id,
    'I dispute that I authored this screenshot.',
  );
  const challengeRef = exactReference(challenge);
  session.turn({
    turn_id: 'gz_case_008_turn_10_authorship_disputed',
    authenticated_actor: actorB,
    introduced_sources: [challenge],
    command_source_references: [challengeRef],
    operations: [
      {
        type: 'record_challenge',
        challenge_id: 'challenge_gz_case_008_authorship',
        target_namespace: 'evidence',
        target_object_id: evidenceId,
        target_field: 'asserted_author_actor_id',
        source_references: [challengeRef],
      },
    ],
    expected: applied(session, 1, {
      authority: [
        {
          namespace: 'evidence',
          object_id: evidenceId,
          authority_kind: 'party_assertion',
          introduced_by_actor_id: actorA.actor_id,
          resolution_status: 'disputed',
          party_stances: { party_a: 'asserted', party_b: 'disputed' },
        },
      ],
      required_source_references: [challengeRef],
      forbidden_factual_promotions: [
        forbiddenPromotion(
          'proposition_gz_case_008_challenged_authorship',
          'Person B authored the screenshot.',
          'verified_evidence',
          'authorship_is_explicitly_challenged',
          [descriptionRef, challengeRef],
        ),
      ],
    }),
  });
  const withdrawal = source(
    'source_gz_case_008_withdrawal',
    'clarification_answer',
    actorA.actor_id,
    'I withdraw this screenshot from consideration.',
  );
  const withdrawalRef = exactReference(withdrawal);
  session.turn({
    turn_id: 'gz_case_008_turn_11_submitter_withdraws',
    authenticated_actor: actorA,
    introduced_sources: [withdrawal],
    command_source_references: [withdrawalRef],
    operations: [
      { type: 'set_own_evidence_availability', evidence_id: evidenceId, availability: 'withdrawn' },
    ],
    expected: applied(session, 1, {
      evidence_actions: [{ evidence_id: evidenceId, action: 'withdrawn' }],
      required_source_references: [withdrawalRef],
    }),
  });
  session.turn({
    turn_id: 'gz_case_008_turn_12_withdrawn_cannot_revive',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      { type: 'record_evidence_upload', evidence_id: evidenceId, content_hash: '3'.repeat(64) },
    ],
    expected: rejected(session, 'invalid_operation'),
  });
  const oldDescription = source(
    'source_gz_case_008_old_description',
    'clarification_answer',
    actorA.actor_id,
    'This second screenshot has a corrected replacement.',
  );
  const oldRef = exactReference(oldDescription);
  const oldId = 'evidence_gz_case_008_old';
  const oldCommandId = 'command_gz_case_008_old';
  session.turn({
    turn_id: 'gz_case_008_turn_13_describe_evidence_to_replace',
    authenticated_actor: actorA,
    introduced_sources: [oldDescription],
    command_id: oldCommandId,
    command_source_references: [oldRef],
    operations: [
      {
        type: 'add_object',
        namespace: 'evidence',
        object: describedEvidence(session, 'party_a', oldId, oldCommandId, [oldRef]),
      },
    ],
    expected: applied(session, 1, {
      evidence_actions: [{ evidence_id: oldId, action: 'described' }],
    }),
  });
  const replacementDescription = source(
    'source_gz_case_008_replacement',
    'clarification_answer',
    actorA.actor_id,
    'Use this corrected screenshot description instead.',
  );
  const replacementRef = exactReference(replacementDescription);
  const replacementId = 'evidence_gz_case_008_replacement';
  const replaceCommandId = 'command_gz_case_008_supersede';
  const replacementEvidence = describedEvidence(
    session,
    'party_a',
    replacementId,
    replaceCommandId,
    [replacementRef],
  );
  replacementEvidence.supersedes_evidence_id = oldId;
  session.turn({
    turn_id: 'gz_case_008_turn_14_atomic_supersession',
    authenticated_actor: actorA,
    introduced_sources: [replacementDescription],
    command_id: replaceCommandId,
    command_source_references: [replacementRef],
    operations: [
      { type: 'add_object', namespace: 'evidence', object: replacementEvidence },
      { type: 'set_own_evidence_availability', evidence_id: oldId, availability: 'superseded' },
    ],
    expected: applied(session, 1, {
      evidence_actions: [
        { evidence_id: oldId, action: 'superseded' },
        { evidence_id: replacementId, action: 'described' },
      ],
    }),
  });
  return session.finish('gz_case_008');
}

function authorCase009(): GateZeroCanonicalCase {
  const independentAccount = source(
    'source_gz_case_009_b_account',
    'independent_account',
    'subject_party_b',
    'Person B independent account was recorded before detailed disclosure.',
  );
  const initial = createBoundEnvelope('gz_case_009', 'final_confirmation');
  initial.control.eligibility = { status: 'eligible', reason_codes: [] };
  initial.classification.suitability = 'eligible';
  initial.classification.maturity = 'ready';
  initial.classification.required_fact_profile = 'commercial_delivery';
  initial.formation.disclosure = {
    person_b_independent_account_source_id: 'source_gz_case_009_b_account',
    detailed_a_framing: 'disclosed',
    disclosure_event_id: 'event_gz_case_009_disclosure',
  };
  rehashEnvelope(initial);
  const session = new CanonicalCaseAuthoringSession(initial, [independentAccount]);
  const actorA = partyActor('party_a', session.context.envelope);
  const actorB = partyActor('party_b', session.context.envelope);
  session.turn({
    turn_id: 'gz_case_009_turn_01_person_a_confirms',
    authenticated_actor: actorA,
    operations: [
      {
        type: 'record_confirmation',
        confirmation_id: 'confirmation_gz_case_009_a_old',
        confirmed_at: '2026-08-12T02:00:00.000Z',
        event_id: 'event_gz_case_009_a_old',
      },
    ],
    expected: applied(session, 0),
  });
  session.turn({
    turn_id: 'gz_case_009_turn_02_material_change_invalidates_a',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: ['payments.balance_due_trigger'],
        ambiguities: [],
        uncertainties: [],
        lock_prerequisites: ['payment_trigger_clarified'],
        lock_blockers: ['payment_trigger_missing'],
      },
    ],
    expected: applied(session, 1, {}),
  });
  session.turn({
    turn_id: 'gz_case_009_turn_03_b_confirmation_blocked',
    authenticated_actor: actorB,
    operations: [
      {
        type: 'record_confirmation',
        confirmation_id: 'confirmation_gz_case_009_b_blocked',
        confirmed_at: '2026-08-12T02:01:00.000Z',
        event_id: 'event_gz_case_009_b_blocked',
      },
    ],
    expected: rejected(session, 'confirmation_binding_invalid'),
  });
  session.turn({
    turn_id: 'gz_case_009_turn_04_transition_blocked',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'transition',
        event: 'final_confirmations_complete',
        event_id: 'event_gz_case_009_premature_ready',
      },
    ],
    expected: rejected(session, 'invalid_transition'),
  });
  session.turn({
    turn_id: 'gz_case_009_turn_05_clear_material_blocker',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: [],
        ambiguities: [],
        uncertainties: [],
        lock_prerequisites: [],
        lock_blockers: [],
      },
    ],
    expected: applied(session, 1, {}),
  });
  session.turn({
    turn_id: 'gz_case_009_turn_06_person_a_reconfirms',
    authenticated_actor: actorA,
    operations: [
      {
        type: 'record_confirmation',
        confirmation_id: 'confirmation_gz_case_009_a_current',
        confirmed_at: '2026-08-12T02:02:00.000Z',
        event_id: 'event_gz_case_009_a_current',
      },
    ],
    expected: applied(session, 0),
  });
  session.turn({
    turn_id: 'gz_case_009_turn_07_person_b_confirms',
    authenticated_actor: actorB,
    operations: [
      {
        type: 'record_confirmation',
        confirmation_id: 'confirmation_gz_case_009_b_current',
        confirmed_at: '2026-08-12T02:03:00.000Z',
        event_id: 'event_gz_case_009_b_current',
      },
    ],
    expected: applied(session, 0),
  });
  session.turn({
    turn_id: 'gz_case_009_turn_08_ready_for_lock',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'transition',
        event: 'final_confirmations_complete',
        event_id: 'event_gz_case_009_ready',
      },
    ],
    expected: applied(session, 0, { workflow_state: 'ready_for_lock' }),
  });
  session.turn({
    turn_id: 'gz_case_009_turn_09_wrong_lock_mode',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'lock',
        mode: 'documented_non_participation',
        lock_event_id: 'event_gz_case_009_wrong_lock',
        locked_at: '2026-08-12T02:04:00.000Z',
      },
    ],
    expected: rejected(session, 'lock_guard_failed'),
  });
  session.turn({
    turn_id: 'gz_case_009_turn_10_stale_confirmation_context',
    authenticated_actor: SYSTEM_ACTOR,
    command_factory: (context) => ({
      ...commandFor(
        context.envelope,
        SYSTEM_ACTOR,
        'command_gz_case_009_stale_confirmation_context',
        [
          {
            type: 'lock',
            mode: 'bilateral',
            lock_event_id: 'event_gz_case_009_stale_context',
            locked_at: '2026-08-12T02:05:00.000Z',
          },
        ],
        [],
      ),
      confirmation_context: { confirmation_ids: ['confirmation_gz_case_009_a_old'] },
    }),
    expected: rejected(session, 'confirmation_binding_invalid'),
  });
  session.turn({
    turn_id: 'gz_case_009_turn_11_bilateral_lock',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'lock',
        mode: 'bilateral',
        lock_event_id: 'event_gz_case_009_lock',
        locked_at: '2026-08-12T02:06:00.000Z',
      },
    ],
    expected: applied(session, 0, {
      workflow_state: 'locked',
      lock_status: 'locked',
      lock_mode: 'bilateral',
      output_scope: 'adjudication',
    }),
  });
  const lockedEdit = source(
    'source_gz_case_009_locked_edit',
    'clarification_answer',
    actorA.actor_id,
    'Try a post-lock edit without reopening.',
  );
  const lockedEditRef = exactReference(lockedEdit);
  session.turn({
    turn_id: 'gz_case_009_turn_12_locked_edit_rejected',
    authenticated_actor: actorA,
    introduced_sources: [lockedEdit],
    command_source_references: [lockedEditRef],
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: position(
          session,
          'party_a',
          'position_gz_case_009_locked_edit',
          'command_gz_case_009_turn_12_locked_edit_rejected',
          'This edit must not enter a locked envelope.',
          [lockedEditRef],
        ),
      },
    ],
    expected: rejected(session, 'locked_envelope', {
      lock_status: 'locked',
      lock_mode: 'bilateral',
      output_scope: 'adjudication',
    }),
  });
  return session.finish('gz_case_009');
}

function authorCase010(): GateZeroCanonicalCase {
  const lockedFixture = createBilateralLockedFixture();
  const locked = lockedFixture.envelope;
  locked.control.case_id = 'gz_case_010';
  rehashEnvelope(locked);
  const session = new CanonicalCaseAuthoringSession(
    locked,
    Object.values(lockedFixture.source_registry),
  );
  const actorA = partyActor('party_a', session.context.envelope);
  const actorB = partyActor('party_b', session.context.envelope);
  const lockedEdit = source(
    'source_gz_case_010_locked_edit',
    'clarification_answer',
    actorA.actor_id,
    'The deadline should now be Monday.',
  );
  const lockedEditRef = exactReference(lockedEdit);
  session.turn({
    turn_id: 'gz_case_010_turn_01_locked_material_edit_rejected',
    authenticated_actor: actorA,
    introduced_sources: [lockedEdit],
    command_source_references: [lockedEditRef],
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: position(
          session,
          'party_a',
          'position_gz_case_010_locked',
          'command_gz_case_010_turn_01_locked_material_edit_rejected',
          'This direct locked edit must not apply.',
          [lockedEditRef],
        ),
      },
    ],
    expected: rejected(session, 'locked_envelope', {
      lock_status: 'locked',
      lock_mode: 'bilateral',
      output_scope: 'adjudication',
    }),
  });
  const partyReopen = source(
    'source_gz_case_010_party_reopen',
    'clarification_answer',
    actorA.actor_id,
    'Please reopen because I found a material correction.',
  );
  const partyReopenRef = exactReference(partyReopen);
  const inexactPartyReopenRef = {
    ...partyReopenRef,
    span: {
      encoding: 'utf16' as const,
      start: 0,
      end: partyReopen.content.length - 1,
      quote: partyReopen.content,
    },
  };
  session.turn({
    turn_id: 'gz_case_010_turn_02_inexact_reopen_source_rejected',
    authenticated_actor: SYSTEM_ACTOR,
    introduced_sources: [partyReopen],
    operations: [
      {
        type: 'reopen_material_change',
        event_id: 'event_gz_case_010_bad_reopen',
        reason: 'Inexact source must fail closed',
        occurred_at: '2026-08-12T03:00:00.000Z',
        source_references: [inexactPartyReopenRef],
      },
    ],
    expected: rejected(session, 'invalid_source_reference', {
      lock_status: 'locked',
      lock_mode: 'bilateral',
      output_scope: 'adjudication',
    }),
  });
  const authoritativeChange = source(
    'source_gz_case_010_authoritative_change',
    'authoritative_record',
    SYSTEM_ACTOR.actor_id,
    'Code verified a post-lock material correction request and its exact source identity.',
  );
  const authoritativeRef = exactReference(authoritativeChange);
  session.turn({
    turn_id: 'gz_case_010_turn_03_authoritative_reopen',
    authenticated_actor: SYSTEM_ACTOR,
    introduced_sources: [authoritativeChange],
    operations: [
      {
        type: 'reopen_material_change',
        event_id: 'event_gz_case_010_reopen',
        reason: 'Verified post-lock material correction',
        occurred_at: '2026-08-12T03:01:00.000Z',
        source_references: [authoritativeRef],
      },
    ],
    expected: applied(session, 1, {
      workflow_state: 'reconciliation',
      lock_status: 'unlocked',
      lock_mode: null,
      output_scope: null,
      required_source_references: [authoritativeRef],
    }),
  });
  const correction = source(
    'source_gz_case_010_correction',
    'clarification_answer',
    actorA.actor_id,
    'The corrected deadline assertion is Monday.',
  );
  const correctionRef = exactReference(correction);
  const correctionId = 'command_gz_case_010_correction';
  session.turn({
    turn_id: 'gz_case_010_turn_04_apply_correction',
    authenticated_actor: actorA,
    introduced_sources: [correction],
    command_id: correctionId,
    command_source_references: [correctionRef],
    operations: [
      {
        type: 'add_object',
        namespace: 'positions',
        object: position(
          session,
          'party_a',
          'position_gz_case_010_correction',
          correctionId,
          'Person A says the corrected deadline is Monday.',
          [correctionRef],
        ),
      },
    ],
    expected: applied(session, 1, {
      required_source_references: [correctionRef],
    }),
  });
  session.turn({
    turn_id: 'gz_case_010_turn_05_clear_reconfirmation_blocker',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_formation_requirements',
        open_required_fields: [],
        ambiguities: [],
        uncertainties: [],
        lock_prerequisites: [],
        lock_blockers: [],
      },
    ],
    expected: applied(session, 1, {}),
  });
  session.turn({
    turn_id: 'gz_case_010_turn_06_return_to_final_confirmation',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'transition',
        event: 'reconciliation_complete',
        event_id: 'event_gz_case_010_final_confirmation',
      },
    ],
    expected: applied(session, 0, { workflow_state: 'final_confirmation' }),
  });
  session.turn({
    turn_id: 'gz_case_010_turn_07_person_a_reconfirms',
    authenticated_actor: actorA,
    operations: [
      {
        type: 'record_confirmation',
        confirmation_id: 'confirmation_gz_case_010_a',
        confirmed_at: '2026-08-12T03:02:00.000Z',
        event_id: 'event_gz_case_010_a_confirms',
      },
    ],
    expected: applied(session, 0),
  });
  session.turn({
    turn_id: 'gz_case_010_turn_08_person_b_reconfirms',
    authenticated_actor: actorB,
    operations: [
      {
        type: 'record_confirmation',
        confirmation_id: 'confirmation_gz_case_010_b',
        confirmed_at: '2026-08-12T03:03:00.000Z',
        event_id: 'event_gz_case_010_b_confirms',
      },
    ],
    expected: applied(session, 0),
  });
  session.turn({
    turn_id: 'gz_case_010_turn_09_ready_to_relock',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'transition',
        event: 'final_confirmations_complete',
        event_id: 'event_gz_case_010_ready',
      },
    ],
    expected: applied(session, 0, { workflow_state: 'ready_for_lock' }),
  });
  session.turn({
    turn_id: 'gz_case_010_turn_10_stale_relock_rejected',
    authenticated_actor: SYSTEM_ACTOR,
    command_factory: (context) => ({
      ...commandFor(
        context.envelope,
        SYSTEM_ACTOR,
        'command_gz_case_010_stale_relock',
        [
          {
            type: 'lock',
            mode: 'bilateral',
            lock_event_id: 'event_gz_case_010_stale_relock',
            locked_at: '2026-08-12T03:04:00.000Z',
          },
        ],
        [],
      ),
      base_envelope_version: context.envelope.control.envelope_version - 1,
    }),
    expected: rejected(session, 'stale_base_version'),
  });
  session.turn({
    turn_id: 'gz_case_010_turn_11_relock',
    authenticated_actor: SYSTEM_ACTOR,
    command_id: 'command_gz_case_010_relock',
    save_command_as: 'relock',
    operations: [
      {
        type: 'lock',
        mode: 'bilateral',
        lock_event_id: 'event_gz_case_010_relock',
        locked_at: '2026-08-12T03:05:00.000Z',
      },
    ],
    expected: applied(session, 0, {
      workflow_state: 'locked',
      lock_status: 'locked',
      lock_mode: 'bilateral',
      output_scope: 'adjudication',
    }),
  });
  session.turn({
    turn_id: 'gz_case_010_turn_12_direct_evidence_change_rejected',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'set_evidence_visibility',
        evidence_id: 'evidence_background_unadmitted',
        visibility: 'disclosed_to_both',
        disclosure_event_id: 'event_gz_case_010_locked_disclosure',
      },
    ],
    expected: rejected(session, 'locked_envelope', {
      lock_status: 'locked',
      lock_mode: 'bilateral',
      output_scope: 'adjudication',
    }),
  });
  session.turn({
    turn_id: 'gz_case_010_turn_13_second_reopen_requires_source',
    authenticated_actor: SYSTEM_ACTOR,
    operations: [
      {
        type: 'reopen_material_change',
        event_id: 'event_gz_case_010_missing_source',
        reason: 'No source supplied',
        occurred_at: '2026-08-12T03:06:00.000Z',
        source_references: [],
      },
    ],
    expected: rejected(session, 'invalid_source_reference', {
      lock_status: 'locked',
      lock_mode: 'bilateral',
      output_scope: 'adjudication',
    }),
  });
  session.turn({
    turn_id: 'gz_case_010_turn_14_relock_retry',
    authenticated_actor: SYSTEM_ACTOR,
    command_factory: (context) => context.saved_commands.relock!,
    expected: idempotent(session, {
      lock_status: 'locked',
      lock_mode: 'bilateral',
      output_scope: 'adjudication',
    }),
  });
  return session.finish('gz_case_010', true);
}

export const GATE_ZERO_INITIAL_TEN_CASES: readonly GateZeroCanonicalCase[] = [
  authorCase001(),
  authorCase002(),
  authorCase003(),
  authorCase004(),
  authorCase005(),
  authorCase006(),
  authorCase007(),
  authorCase008(),
  authorCase009(),
  authorCase010(),
];
