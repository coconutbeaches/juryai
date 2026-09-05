/**
 * PR 8C0b-1 — complete-ContractIssue parity between the frozen V2.1.4
 * validator and the shared, spec-driven validator.
 *
 * Every case drives BOTH implementations over the SAME envelope and compares
 * the whole `ContractIssue[]` — code, path, message and order — with no
 * post-hoc normalisation, filtering or sorting. Comparing only validity would
 * hide a rule that fired with the wrong code or path, which is the failure
 * mode a mechanical extraction actually produces.
 *
 * Each case also names the code it is supposed to provoke. Without that a
 * mutation that silently stopped provoking anything would still "pass parity"
 * — two validators agreeing that nothing is wrong.
 */

import { describe, expect, it } from 'vitest';
import { sha256 } from '../v2/case-envelope.js';
import type { CaseEnvelopeV214 } from '../v2-1-4/case-envelope.js';
import { validateCaseEnvelopeV214 } from '../v2-1-4/contract-validator.js';
import { createFormationValidator } from '../formation/validator.js';
import { rawV214Spec } from './formation-v214-parity-spec.js';
import {
  acknowledgedFixture,
  disclosedChallengeFixture,
  independentFormationFixture,
  mutate,
  mutateWithoutRestamp,
} from './formation-validator-fixtures.js';

const shared = createFormationValidator({ spec: rawV214Spec() });

const base = independentFormationFixture();
const disclosed = disclosedChallengeFixture();
const acknowledged = acknowledgedFixture();

type Draft = CaseEnvelopeV214;

/** The first source turn / position / requirement belonging to party A. */
const firstTurnId = (draft: Draft): string =>
  Object.values(draft.source_turns).find((turn) => turn.attributed_party_id === 'party_a')!.turn_id;
const firstPositionId = (draft: Draft): string =>
  Object.values(draft.positions).find((position) => position.attributed_party_id === 'party_a')!
    .position_id;
const otherPositionId = (draft: Draft): string =>
  Object.values(draft.positions).find((position) => position.attributed_party_id === 'party_b')!
    .position_id;

interface Case {
  readonly name: string;
  readonly code: string;
  readonly envelope: CaseEnvelopeV214;
}

const observedCodes = new Set<string>();

/** Builds a case from a restamped mutation of the independent-formation base. */
function edit(name: string, code: string, change: (draft: Draft) => void): Case {
  return { name, code, envelope: mutate(base.envelope, change) };
}

function editOf(
  fixture: CaseEnvelopeV214,
  name: string,
  code: string,
  change: (draft: Draft) => void,
): Case {
  return { name, code, envelope: mutate(fixture, change) };
}

const cases: Case[] = [
  // ---- control ----
  edit('unknown top-level key', 'v214_exact_keys', (draft) => {
    (draft as unknown as Record<string, unknown>).extra = {};
  }),
  edit('wrong schema version', 'v214_contract_version', (draft) => {
    draft.control.schema_version = 'juryai-case-envelope-v9.9.9' as never;
  }),
  edit('wrong projection contract version', 'v214_contract_version', (draft) => {
    draft.control.projection_contract_version = 'juryai-party-formation-projection-v9' as never;
  }),
  edit('malformed dispute id', 'v214_case_id', (draft) => {
    draft.control.case_id = 'not-a-dispute';
  }),
  edit('unknown workflow state', 'v214_workflow', (draft) => {
    draft.control.workflow_state = 'archived' as never;
  }),
  edit('zero envelope version', 'v214_envelope_version', (draft) => {
    draft.control.envelope_version = 0;
  }),
  {
    name: 'malformed envelope hash',
    code: 'v214_envelope_hash',
    // Not restamped: restamping would overwrite the very field under test.
    envelope: mutateWithoutRestamp(base.envelope, (draft) => {
      draft.control.envelope_hash = 'not-a-hash';
    }),
  },
  edit('unknown disclosure state', 'v214_disclosure', (draft) => {
    draft.control.disclosure_state = 'sealed' as never;
  }),
  edit('cursor hash is malformed', 'v214_party_cursor', (draft) => {
    draft.control.party_views.party_a.party_projection_hash = 'short';
  }),

  // ---- parties ----
  edit('party role does not match its slot', 'v214_party_role', (draft) => {
    draft.parties.party_a.role = 'party_b';
  }),
  edit('unknown identity assurance', 'v214_party_state', (draft) => {
    draft.parties.party_a.identity_assurance = 'trusted' as never;
  }),
  edit('authenticated party without a subject', 'v214_party_binding', (draft) => {
    draft.parties.party_a.authenticated_subject_id = null;
  }),
  edit('unbound party carrying history', 'v214_unbound_party_state', (draft) => {
    draft.parties.party_b.identity_assurance = 'unbound';
    draft.parties.party_b.authenticated_subject_id = null;
    draft.parties.party_b.binding_event_id = null;
    draft.parties.party_b.formation_epoch = 2;
  }),
  edit('both parties share one principal', 'duplicate_authenticated_subject', (draft) => {
    draft.parties.party_b.authenticated_subject_id = draft.parties.party_a.authenticated_subject_id;
  }),

  // ---- collections ----
  edit('positions replaced by an array', 'v214_collection', (draft) => {
    (draft as unknown as Record<string, unknown>).positions = [];
  }),

  // ---- source turns ----
  edit('source turn is not an object', 'v214_source_object', (draft) => {
    (draft.source_turns as unknown as Record<string, unknown>)[firstTurnId(draft)] = null;
  }),
  edit('unknown attributed party', 'v214_source_party', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.attributed_party_id = 'party_c' as never;
  }),
  edit('turn id disagrees with its key', 'v214_source_id_scope', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.turn_id = 'turn_party_a_elsewhere';
  }),
  edit('turn names another dispute', 'v214_source_dispute', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.dispute_id = 'dispute_other';
  }),
  edit('turn subject is not the bound principal', 'v214_source_subject', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.authenticated_subject_id_at_receipt = 'someone_else';
  }),
  edit('turn cites a future party-visible version', 'v214_source_visible_version', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.party_visible_version_before = 999;
  }),
  edit('turn received_at is not ISO', 'v214_source_received_at', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.received_at = 'yesterday';
  }),
  edit('unknown source channel', 'v214_source_channel', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.source_channel = 'carrier_pigeon' as never;
  }),
  edit('relaying agent is not a string', 'v214_source_metadata', (draft) => {
    (draft.source_turns[firstTurnId(draft)] as unknown as Record<string, unknown>).relaying_agent =
      7;
  }),
  edit('translation flag is not boolean', 'v214_source_translation', (draft) => {
    (
      draft.source_turns[firstTurnId(draft)] as unknown as Record<string, unknown>
    ).translation_indicated = 'yes';
  }),
  edit('reply targets are unsorted', 'v214_source_reply_targets', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.in_reply_to = ['zzz_target', 'aaa_target'];
  }),
  edit('empty client turn id', 'v214_source_client_turn', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.client_turn_id = '   ';
  }),
  edit('malformed request fingerprint', 'v214_source_fingerprint', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.request_fingerprint = 'nope';
  }),
  edit('commitment salt is too short', 'v214_source_commitment', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.payload_commitment_salt = 'short';
  }),
  edit('malformed compile run id', 'v214_source_compile_run', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.compile_run_id = '!!!';
  }),
  edit('layout disagrees with payload', 'v214_source_layout_mismatch', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.payload_layout.answer_utf16_length += 1;
  }),
  edit('payload commitment does not match', 'v214_source_payload_commitment', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.payload_commitment = sha256('a different payload');
  }),
  edit(
    'fingerprint does not match canonical input',
    'v214_source_fingerprint_mismatch',
    (draft) => {
      draft.source_turns[firstTurnId(draft)]!.request_fingerprint = sha256('a different request');
    },
  ),
  edit('redaction metadata without redaction', 'v214_source_redaction', (draft) => {
    draft.source_turns[firstTurnId(draft)]!.redacted_at = '2026-09-03T04:00:00.000Z';
  }),

  // ---- requirements ----
  edit('requirement is not an object', 'v214_requirement_object', (draft) => {
    (draft.requirements as unknown as Record<string, unknown>)[base.requirementA] = null;
  }),
  edit('requirement label is empty', 'v214_requirement_shape', (draft) => {
    draft.requirements[base.requirementA]!.label = '';
  }),
  edit('reopened_from names nothing', 'v214_requirement_reopen_link', (draft) => {
    draft.requirements[base.requirementA]!.reopened_from = 'req_missing';
  }),
  edit('no satisfying types', 'v214_requirement_types', (draft) => {
    draft.requirements[base.requirementA]!.satisfying_types = [];
  }),
  edit('required requirement allows zero propositions', 'v214_requirement_cardinality', (draft) => {
    draft.requirements[base.requirementA]!.min_propositions = 0;
  }),
  edit('max below min', 'v214_requirement_cardinality', (draft) => {
    draft.requirements[base.requirementA]!.max_propositions = 0;
  }),

  // ---- positions ----
  edit('position is not an object', 'v214_position_object', (draft) => {
    (draft.positions as unknown as Record<string, unknown>)[firstPositionId(draft)] = null;
  }),
  edit('position id disagrees with its key', 'v214_position_id_scope', (draft) => {
    draft.positions[firstPositionId(draft)]!.position_id = 'position_party_a_elsewhere';
  }),
  edit('position names an unknown requirement', 'v214_position_requirement', (draft) => {
    draft.positions[firstPositionId(draft)]!.requirement_id = 'req_missing';
  }),
  edit('unknown proposition type', 'v214_position_semantics', (draft) => {
    draft.positions[firstPositionId(draft)]!.proposition_type = 'vibes' as never;
  }),
  edit('blank statement', 'v214_position_statement', (draft) => {
    draft.positions[firstPositionId(draft)]!.statement = '   ';
  }),
  edit('position names an unknown source turn', 'v214_position_provenance', (draft) => {
    draft.positions[firstPositionId(draft)]!.source_turn_id = 'turn_party_a_missing';
  }),
  edit('position carries no spans', 'v214_position_spans', (draft) => {
    draft.positions[firstPositionId(draft)]!.source_span_commitments = [];
  }),
  edit('position history starts at zero', 'v214_position_history', (draft) => {
    draft.positions[firstPositionId(draft)]!.introduced_envelope_version = 0;
  }),
  edit('position evidence does not resolve', 'v214_position_evidence', (draft) => {
    draft.positions[firstPositionId(draft)]!.evidence_ref_id = 'evidence_missing';
  }),
  edit('superseded without a version', 'v214_position_supersession_shape', (draft) => {
    draft.positions[firstPositionId(draft)]!.superseded_by = otherPositionId(draft);
  }),
  edit('supersedes names nothing', 'v214_supersession_link', (draft) => {
    draft.positions[firstPositionId(draft)]!.supersedes = 'position_party_a_missing';
  }),
  edit('reverse supersession link is broken', 'v214_supersession_reverse_link', (draft) => {
    const id = firstPositionId(draft);
    draft.positions[id]!.superseded_by = otherPositionId(draft);
    draft.positions[id]!.superseded_at_envelope_version = draft.control.envelope_version;
  }),
  edit('explicit absence with declined strength', 'v214_explicit_absence_source', (draft) => {
    const position = draft.positions[firstPositionId(draft)]!;
    position.proposition_type = 'explicit_absence';
    position.epistemic_strength = 'declined';
  }),

  // ---- span commitments ----
  edit('span is not an object', 'v214_span_object', (draft) => {
    (draft.positions[firstPositionId(draft)]!.source_span_commitments as unknown as unknown[])[0] =
      null;
  }),
  edit('malformed span turn id', 'v214_span_turn_id', (draft) => {
    draft.positions[firstPositionId(draft)]!.source_span_commitments[0]!.turn_id = '!!!';
  }),
  edit('unknown span region', 'v214_span_region', (draft) => {
    draft.positions[firstPositionId(draft)]!.source_span_commitments[0]!.region = 'footer' as never;
  }),
  edit('wrong span encoding', 'v214_span_encoding', (draft) => {
    draft.positions[firstPositionId(draft)]!.source_span_commitments[0]!.encoding = 'utf8' as never;
  }),
  edit('empty span range', 'v214_span_bounds', (draft) => {
    const span = draft.positions[firstPositionId(draft)]!.source_span_commitments[0]!;
    span.end = span.start;
  }),
  edit('malformed span quote hash', 'v214_span_quote_hash', (draft) => {
    draft.positions[firstPositionId(draft)]!.source_span_commitments[0]!.quote_hash = 'nope';
  }),
  edit('answer span carries a message index', 'v214_span_answer_index', (draft) => {
    draft.positions[firstPositionId(draft)]!.source_span_commitments[0]!.message_index = 0;
  }),
  edit('context span without a message index', 'v214_span_context_index', (draft) => {
    draft.positions[firstPositionId(draft)]!.source_span_commitments[0]!.region = 'context';
  }),
  edit('span names a different source turn', 'v214_span_source_mismatch', (draft) => {
    const other = Object.values(draft.source_turns).find(
      (turn) => turn.attributed_party_id === 'party_b',
    )!;
    draft.positions[firstPositionId(draft)]!.source_span_commitments[0]!.turn_id = other.turn_id;
  }),
  edit('span runs past its payload region', 'v214_span_out_of_bounds', (draft) => {
    draft.positions[firstPositionId(draft)]!.source_span_commitments[0]!.end = 100_000;
  }),
  edit('span quote commitment does not match', 'v214_span_commitment_mismatch', (draft) => {
    draft.positions[firstPositionId(draft)]!.source_span_commitments[0]!.quote_hash =
      sha256('some other quote');
  }),

  // ---- clarifications ----
  edit('clarification is not an object', 'v214_clarification_object', (draft) => {
    (draft.clarifications as unknown as Record<string, unknown>).clarification_party_a_x = null;
  }),
  edit('clarification prompt is blank', 'v214_clarification_shape', (draft) => {
    draft.clarifications.clarification_party_a_one = {
      clarification_id: 'clarification_party_a_one',
      party_id: 'party_a',
      requirement_id: base.requirementA,
      reason: 'multiple_incompatible_readings',
      prompt: '   ',
      opened_at_envelope_version: 2,
      resolved_at_envelope_version: null,
      reopened_as: null,
    };
  }),
  edit('clarification reopen target is unknown', 'v214_clarification_reopen_link', (draft) => {
    draft.clarifications.clarification_party_a_one = {
      clarification_id: 'clarification_party_a_one',
      party_id: 'party_a',
      requirement_id: base.requirementA,
      reason: 'multiple_incompatible_readings',
      prompt: 'Which delivery date do you mean?',
      opened_at_envelope_version: 2,
      resolved_at_envelope_version: null,
      reopened_as: 'req_missing',
    };
  }),
  edit(
    'two open clarifications on one requirement',
    'v214_duplicate_open_clarification',
    (draft) => {
      for (const suffix of ['one', 'two']) {
        draft.clarifications[`clarification_party_a_${suffix}`] = {
          clarification_id: `clarification_party_a_${suffix}`,
          party_id: 'party_a',
          requirement_id: base.requirementA,
          reason: 'multiple_incompatible_readings',
          prompt: 'Which delivery date do you mean?',
          opened_at_envelope_version: 2,
          resolved_at_envelope_version: null,
          reopened_as: null,
        };
      }
    },
  ),

  // ---- evidence ----
  edit('evidence is not an object', 'v214_evidence_object', (draft) => {
    (draft.evidence as unknown as Record<string, unknown>).evidence_one = null;
  }),
  edit('evidence eligibility is unknown', 'v214_evidence_shape', (draft) => {
    draft.evidence.evidence_one = {
      evidence_id: 'evidence_one',
      attributed_party_id: 'party_a',
      description: 'Delivery emails.',
      required_for_readiness: false,
      eligibility: 'maybe' as never,
    };
  }),

  // ---- challenges (disclosed fixture) ----
  editOf(disclosed.envelope, 'challenge is not an object', 'v214_challenge_object', (draft) => {
    const id = Object.keys(draft.challenges)[0]!;
    (draft.challenges as unknown as Record<string, unknown>)[id] = null;
  }),
  editOf(disclosed.envelope, 'challenge statement is blank', 'v214_challenge_shape', (draft) => {
    draft.challenges[Object.keys(draft.challenges)[0]!]!.statement = '   ';
  }),
  editOf(disclosed.envelope, 'challenge carries no spans', 'v214_challenge_spans', (draft) => {
    draft.challenges[Object.keys(draft.challenges)[0]!]!.source_span_commitments = [];
  }),
  editOf(
    disclosed.envelope,
    'resolved challenge without a response',
    'v214_challenge_response_missing',
    (draft) => {
      draft.challenges[Object.keys(draft.challenges)[0]!]!.status = 'resolved';
    },
  ),
  editOf(
    disclosed.envelope,
    'challenge response is not an object',
    'v214_challenge_response_object',
    (draft) => {
      (
        draft.challenges[Object.keys(draft.challenges)[0]!] as unknown as Record<string, unknown>
      ).response = 7;
    },
  ),
  editOf(
    disclosed.envelope,
    'challenges exist before disclosure',
    'v214_challenge_before_disclosure',
    (draft) => {
      draft.control.disclosure_state = 'embargoed';
    },
  ),

  // ---- formation ----
  edit('confirmations replaced by an array', 'v214_confirmations', (draft) => {
    (draft.formation as unknown as Record<string, unknown>).confirmations = [];
  }),
  edit('confirmation entry is not an object', 'v214_confirmation_object', (draft) => {
    (draft.formation.confirmations.party_a as unknown as unknown[]).push(null);
  }),
  edit('confirmation receipt is malformed', 'v214_confirmation_shape', (draft) => {
    draft.formation.confirmations.party_a.push({
      confirmation_version: 'juryai-party-confirmation-v2.1.4' as const,
      confirmation_id: 'confirmation_party_a_one',
      party_id: 'party_a',
      authenticated_subject_id: draft.parties.party_a.authenticated_subject_id!,
      party_projection_version: 'juryai-party-formation-projection-v2.1.4' as const,
      party_projection_hash: 'not-a-hash',
      party_visible_version: 1,
      party_readback_version: 'juryai-party-formation-readback-v2.1.4' as const,
      party_readback_hash: sha256('readback'),
      adoption_statement_hash: sha256('adoption'),
      formation_epoch: 1,
      shared_envelope_version: 1,
      shared_envelope_hash: sha256('shared'),
      confirmed_at: '2026-09-03T04:00:00.000Z',
      event_id: 'confirmation_event_party_a_one',
    });
  }),
  edit('confirmation identities collide', 'v214_confirmation_id_collision', (draft) => {
    const receipt = {
      confirmation_version: 'juryai-party-confirmation-v2.1.4' as const,
      confirmation_id: 'confirmation_party_a_one',
      party_id: 'party_a' as const,
      authenticated_subject_id: draft.parties.party_a.authenticated_subject_id!,
      party_projection_version: 'juryai-party-formation-projection-v2.1.4' as const,
      party_projection_hash: sha256('projection'),
      party_visible_version: 1,
      party_readback_version: 'juryai-party-formation-readback-v2.1.4' as const,
      party_readback_hash: sha256('readback'),
      adoption_statement_hash: sha256('adoption'),
      formation_epoch: 1,
      shared_envelope_version: 1,
      shared_envelope_hash: sha256('shared'),
      confirmed_at: '2026-09-03T04:00:00.000Z',
      event_id: 'confirmation_event_party_a_one',
    };
    draft.formation.confirmations.party_a.push(receipt, structuredClone(receipt));
  }),
  edit('reopen events replaced by an object', 'v214_reopen_events', (draft) => {
    (draft.formation as unknown as Record<string, unknown>).reopen_events = {};
  }),
  edit('reopen event is not an object', 'v214_reopen_object', (draft) => {
    (draft.formation.reopen_events as unknown as unknown[]).push(null);
  }),
  edit('reopen event epochs do not advance by one', 'v214_reopen_shape', (draft) => {
    draft.formation.reopen_events.push({
      event_id: 'reopen_event_party_a_one',
      party_id: 'party_a',
      authenticated_subject_id: draft.parties.party_a.authenticated_subject_id!,
      prior_formation_epoch: 1,
      resulting_formation_epoch: 5,
      reason: 'Correcting the delivery date.',
      occurred_at: '2026-09-03T04:00:00.000Z',
    });
  }),
  edit('reopened party without matching history', 'v214_reopen_history_missing', (draft) => {
    draft.parties.party_a.edit_state = 'reopened';
  }),
  edit('explanatory state is not an object', 'v214_explanatory', (draft) => {
    (draft.formation as unknown as Record<string, unknown>).explanatory = null;
  }),
  edit('explanatory arrays are unsorted', 'v214_explanatory_shape', (draft) => {
    draft.formation.explanatory.lock_blockers = ['zzz', 'aaa'];
  }),
  edit(
    'acknowledgment history replaced by an array',
    'v214_disclosure_acknowledgments',
    (draft) => {
      (draft.formation as unknown as Record<string, unknown>).disclosure_review_acknowledgments =
        [];
    },
  ),
  edit('acknowledgment entry is not an object', 'v214_disclosure_ack_object', (draft) => {
    draft.control.disclosure_state = 'disclosed';
    (draft.formation.disclosure_review_acknowledgments.party_a as unknown as unknown[]).push(null);
  }),
  editOf(
    acknowledged.envelope,
    'acknowledgment statement hash is wrong',
    'v214_disclosure_ack_shape',
    (draft) => {
      draft.formation.disclosure_review_acknowledgments.party_a[0]!.acknowledgment_statement_hash =
        sha256('a different statement');
    },
  ),
  editOf(
    acknowledged.envelope,
    'acknowledgment identities collide',
    'v214_disclosure_ack_id_collision',
    (draft) => {
      const existing = draft.formation.disclosure_review_acknowledgments.party_a[0]!;
      draft.formation.disclosure_review_acknowledgments.party_a.push(structuredClone(existing));
    },
  ),
  editOf(
    acknowledged.envelope,
    'acknowledgments exist before disclosure',
    'v214_disclosure_ack_before_disclosure',
    (draft) => {
      draft.control.disclosure_state = 'embargoed';
    },
  ),

  // ---- late consistency block ----
  edit(
    'final confirmation without a current bilateral review',
    'v214_disclosure_review_closure_missing',
    (draft) => {
      draft.control.workflow_state = 'final_confirmation';
    },
  ),
  edit('stored projection hash is stale', 'v214_party_projection_hash', (draft) => {
    draft.control.party_views.party_a.party_projection_hash = sha256('a stale projection');
  }),
  edit('stored explanatory state is stale', 'v214_explanatory_mismatch', (draft) => {
    draft.formation.explanatory.lock_blockers = [];
  }),
  {
    name: 'stored envelope hash is stale',
    code: 'v214_envelope_hash_mismatch',
    envelope: mutateWithoutRestamp(base.envelope, (draft) => {
      draft.control.envelope_hash = sha256('a stale envelope');
    }),
  },
];

describe('PR 8C0b-1: shared validator reproduces frozen V2.1.4 issue for issue', () => {
  it('both implementations accept every unmutated fixture', () => {
    for (const fixture of [base.envelope, disclosed.envelope, acknowledged.envelope]) {
      expect(validateCaseEnvelopeV214(fixture)).toEqual([]);
      expect(shared.validate(fixture)).toEqual([]);
    }
  });

  it.each(cases.map((entry) => [entry.name, entry] as const))(
    'identical ContractIssue[] for: %s',
    (_name, entry) => {
      const frozen = validateCaseEnvelopeV214(entry.envelope);
      for (const raised of frozen) observedCodes.add(raised.code);
      // The mutation must actually provoke its rule, or "parity" would only be
      // two validators agreeing that a no-op envelope is fine.
      expect(frozen.map((raised) => raised.code)).toContain(entry.code);
      expect(shared.validate(entry.envelope)).toEqual(frozen);
    },
  );

  it('rejects non-envelope input identically, with no cast at the boundary', () => {
    // These calls compile because `validate` accepts `unknown`. If the public
    // signature ever narrows to `CaseEnvelope`, this test stops compiling —
    // which is the point: a caller forced to assert `as CaseEnvelope` before
    // asking whether the value IS one has already bypassed the gate.
    for (const value of [null, 'envelope', 42, []]) {
      expect(shared.validate(value)).toEqual(validateCaseEnvelopeV214(value as never));
    }
    // A value canonical JSON cannot represent at all.
    const unserializable = { control: 1n } as unknown;
    expect(shared.validate(unserializable)).toEqual(
      validateCaseEnvelopeV214(unserializable as never),
    );
  });

  it('control must be an object before anything else is read', () => {
    const broken = mutateWithoutRestamp(base.envelope, (draft) => {
      (draft as unknown as Record<string, unknown>).control = null;
    });
    const frozen = validateCaseEnvelopeV214(broken);
    expect(frozen.map((raised) => raised.code)).toContain('v214_control_object');
    expect(shared.validate(broken)).toEqual(frozen);
  });

  it('drives 90 of the 107 frozen rules through a targeted mutation', () => {
    // A floor set just under what the cases actually reach (93 of 107), so it
    // catches a case that stopped provoking its rule without breaking on a
    // harmless addition. The EXHAUSTIVE statement is made by the inventory
    // suite, which compares emitted code sets rather than counting — this
    // number is about how much behaviour was compared, not how much survived.
    expect(observedCodes.size).toBeGreaterThanOrEqual(90);
  });
});

/**
 * Inherited, deliberately unchanged: the frozen validator is NOT total.
 *
 * For a handful of structurally impossible envelopes it dereferences a field
 * it has already reported as malformed and throws instead of returning issues.
 * Production cannot reach these — every envelope it validates was produced by
 * the ceremony or relay — but the behaviour is observable, so the shared
 * validator must reproduce it rather than quietly becoming more robust.
 * Silently hardening here would be an unannounced behaviour change wearing a
 * parity PR's clothes; if this should be fixed, it is a change with its own
 * review, not a side effect of extraction.
 */
describe('PR 8C0b-1: non-total inputs throw identically rather than diverging', () => {
  const throwing: ReadonlyArray<readonly [string, (draft: Draft) => void]> = [
    [
      'party views replaced by an array',
      (draft) => {
        (draft.control as unknown as Record<string, unknown>).party_views = [];
      },
    ],
    [
      'cursor is not an object',
      (draft) => {
        (draft.control.party_views as unknown as Record<string, unknown>).party_a = null;
      },
    ],
    [
      'parties replaced by an array',
      (draft) => {
        (draft as unknown as Record<string, unknown>).parties = [];
      },
    ],
    [
      'party binding is not an object',
      (draft) => {
        (draft.parties as unknown as Record<string, unknown>).party_a = null;
      },
    ],
    [
      'payload layout is not an object',
      (draft) => {
        (
          draft.source_turns[firstTurnId(draft)] as unknown as Record<string, unknown>
        ).payload_layout = null;
      },
    ],
    [
      'payload is not an object',
      (draft) => {
        (draft.source_turns[firstTurnId(draft)] as unknown as Record<string, unknown>).payload = 7;
      },
    ],
    [
      'formation is not an object',
      (draft) => {
        (draft as unknown as Record<string, unknown>).formation = null;
      },
    ],
  ];

  it.each(throwing.map(([name, change]) => [name, change] as const))(
    'both implementations throw the same error for: %s',
    (_name, change) => {
      const envelope = mutate(base.envelope, change);
      const thrown = (run: () => unknown): string => {
        try {
          run();
        } catch (error) {
          return `${(error as Error).name}: ${(error as Error).message}`;
        }
        throw new Error('Expected this input to throw.');
      };
      expect(thrown(() => shared.validate(envelope))).toBe(
        thrown(() => validateCaseEnvelopeV214(envelope)),
      );
    },
  );
});
