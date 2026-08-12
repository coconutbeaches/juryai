import { describe, expect, it } from 'vitest';
import { applyEnvelopeCommand, commandFor, type CommandLedger } from '../v2/envelope-command.js';
import { canonicalSerialize, cloneCanonical, type SourceRecord } from '../v2/case-envelope.js';
import { hashAdjudicationInput, validateAdjudicationInput } from '../v2/adjudication-input.js';
import { validateGateZeroTurnOracle } from '../v2/gate-zero-oracle.js';
import {
  GATE_ZERO_CASE_FIXTURE_VERSION,
  validateGateZeroCanonicalCase,
} from '../gate-zero/canonical-case.js';
import { GATE_ZERO_INITIAL_TEN_CASES } from '../gate-zero/initial-ten-cases.js';

function replayThrough(caseIndex: number, turnCount: number) {
  const fixture = GATE_ZERO_INITIAL_TEN_CASES[caseIndex]!;
  let envelope = cloneCanonical(fixture.initial_envelope);
  let ledger: CommandLedger = {};
  let sourceRegistry: Record<string, SourceRecord> = {};
  for (const turn of fixture.turns.slice(0, turnCount)) {
    sourceRegistry = Object.fromEntries(
      turn.source_records.map((source) => [source.source_id, source]),
    );
    const result = applyEnvelopeCommand({
      envelope,
      command: turn.command,
      authenticated_actor: turn.authenticated_actor,
      source_registry: sourceRegistry,
      ledger,
    });
    envelope = result.envelope;
    ledger = result.ledger;
  }
  return { envelope, ledger, sourceRegistry };
}

describe('Gate Zero GZ2 initial ten canonical cases', () => {
  it('freezes exactly the planned first ten as 104 valid ordered turns', () => {
    expect(GATE_ZERO_CASE_FIXTURE_VERSION).toBe('juryai-gate-zero-case-fixture-v1.0.0');
    expect(GATE_ZERO_INITIAL_TEN_CASES.map((fixture) => fixture.case_id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `gz_case_${String(index + 1).padStart(3, '0')}`),
    );
    expect(
      GATE_ZERO_INITIAL_TEN_CASES.reduce((sum, fixture) => sum + fixture.turns.length, 0),
    ).toBe(104);
    for (const fixture of GATE_ZERO_INITIAL_TEN_CASES) {
      expect(validateGateZeroCanonicalCase(fixture), fixture.case_id).toEqual([]);
    }
  });

  it('replays every command through the merged deterministic GZ0 contract', () => {
    for (const fixture of GATE_ZERO_INITIAL_TEN_CASES) {
      let envelope = cloneCanonical(fixture.initial_envelope);
      let ledger: CommandLedger = {};
      for (const turn of fixture.turns) {
        const sourceRegistry: Record<string, SourceRecord> = Object.fromEntries(
          turn.source_records.map((source) => [source.source_id, source]),
        );
        const result = applyEnvelopeCommand({
          envelope,
          command: turn.command,
          authenticated_actor: turn.authenticated_actor,
          source_registry: sourceRegistry,
          ledger,
        });
        expect(result.status, turn.turn_id).toBe(turn.expected.disposition);
        expect(result.reason_code, turn.turn_id).toBe(turn.expected.failure_reason);
        expect(result.envelope.control.envelope_hash, turn.turn_id).toBe(
          turn.expected.resulting_envelope_hash,
        );
        expect(result.envelope.control.record_hash, turn.turn_id).toBe(
          turn.expected.resulting_record_hash,
        );
        envelope = result.envelope;
        ledger = result.ledger;
      }
      expect(canonicalSerialize(envelope), fixture.case_id).toBe(
        canonicalSerialize(fixture.final_envelope),
      );
    }
  });

  it('makes rejected and idempotent turns byte-exact no-mutation oracles', () => {
    const noMutationTurns = GATE_ZERO_INITIAL_TEN_CASES.flatMap((fixture) => fixture.turns).filter(
      (turn) => turn.expected.disposition !== 'applied',
    );
    expect(noMutationTurns.length).toBeGreaterThan(20);
    for (const turn of noMutationTurns) {
      expect(turn.expected.exact_no_mutation, turn.turn_id).toBe(true);
      expect(turn.expected.resulting_envelope_hash, turn.turn_id).toBe(turn.base_envelope_hash);
      expect(turn.expected.resulting_record_hash, turn.turn_id).toBe(turn.base_record_hash);
      expect(turn.expected.envelope_version_delta, turn.turn_id).toBe(0);
      expect(turn.expected.record_version_delta, turn.turn_id).toBe(0);
    }
  });

  it('reports only confirmations that actually existed and were invalidated', () => {
    expect(
      GATE_ZERO_INITIAL_TEN_CASES.flatMap((fixture) => fixture.turns)
        .filter((turn) => turn.expected.invalidated_confirmation_parties.length > 0)
        .map((turn) => [turn.turn_id, turn.expected.invalidated_confirmation_parties]),
    ).toEqual([
      ['gz_case_007_turn_05_invite_person_b', ['party_a']],
      ['gz_case_009_turn_02_material_change_invalidates_a', ['party_a']],
      ['gz_case_010_turn_03_authoritative_reopen', ['party_a', 'party_b']],
    ]);
  });

  it('represents execution-authentication mismatch without accepting an ordinary actor mismatch', () => {
    const turn = GATE_ZERO_INITIAL_TEN_CASES[4]!.turns[7]!;
    expect(turn.expected.failure_reason).toBe('authentication_mismatch');
    expect(turn.command.authenticated_actor).not.toEqual(turn.authenticated_actor);
    expect(validateGateZeroTurnOracle(turn)).toEqual([]);
    const mislabeled = cloneCanonical(turn);
    mislabeled.expected.failure_reason = 'unauthorized_actor';
    expect(validateGateZeroTurnOracle(mislabeled)).toContain(
      'oracle_command_actor_binding_invalid',
    );
  });

  it('keeps Person B detailed context embargoed until an independent account commits', () => {
    const fixture = GATE_ZERO_INITIAL_TEN_CASES[6]!;
    const preAccount = fixture.turns.slice(5, 10);
    for (const turn of preAccount) {
      expect(turn.visible_source_ids, turn.turn_id).not.toContain('source_gz_case_007_detailed_a');
      expect(turn.hidden_source_ids, turn.turn_id).toContain('source_gz_case_007_detailed_a');
      expect(turn.embargoed_envelope_paths, turn.turn_id).toContain('/formation/disclosure');
    }
    expect(fixture.turns[10]!.expected.workflow_state).toBe('disclosure_challenge');
    expect(fixture.turns[9]!.forbidden_operation_types).toContain('record_independent_account');
    expect(fixture.turns[10]!.permitted_operation_types).toContain('record_independent_account');
    expect(fixture.turns[11]!.visible_source_ids).toContain('source_gz_case_007_detailed_a');
  });

  it('records authorship dispute and terminal evidence disposition as canonical state', () => {
    const fixture = GATE_ZERO_INITIAL_TEN_CASES[7]!;
    expect(fixture.turns[9]!.expected.authority_fragments[0]?.authority).toMatchObject({
      resolution_status: 'disputed',
      party_stances: { party_b: { stance: 'disputed' } },
    });
    expect(fixture.final_envelope.evidence.evidence_gz_case_008_primary).toMatchObject({
      availability: 'withdrawn',
      authenticity_status: 'disputed',
      adjudication_eligibility: { status: 'ineligible' },
    });
    expect(fixture.final_envelope.evidence.evidence_gz_case_008_old?.availability).toBe(
      'superseded',
    );
    expect(
      fixture.final_envelope.evidence.evidence_gz_case_008_replacement?.supersedes_evidence_id,
    ).toBe('evidence_gz_case_008_old');
  });

  it('requires submitter ownership, exact grounding, and atomic replacement for evidence disposition', () => {
    const beforeWithdrawal = replayThrough(7, 10);
    const withdrawalTurn = GATE_ZERO_INITIAL_TEN_CASES[7]!.turns[10]!;
    const ungrounded = cloneCanonical(withdrawalTurn.command);
    ungrounded.command_id = 'command_gz_case_008_ungrounded_withdrawal';
    ungrounded.source_references = [];
    const ungroundedResult = applyEnvelopeCommand({
      envelope: beforeWithdrawal.envelope,
      ledger: beforeWithdrawal.ledger,
      command: ungrounded,
      authenticated_actor: withdrawalTurn.authenticated_actor,
      source_registry: Object.fromEntries(
        withdrawalTurn.source_records.map((source) => [source.source_id, source]),
      ),
    });
    expect(ungroundedResult).toMatchObject({
      status: 'rejected',
      reason_code: 'invalid_source_reference',
    });
    expect(ungroundedResult.envelope.control.envelope_hash).toBe(
      beforeWithdrawal.envelope.control.envelope_hash,
    );

    const actorB = GATE_ZERO_INITIAL_TEN_CASES[7]!.turns[9]!.authenticated_actor;
    const challengeReference = GATE_ZERO_INITIAL_TEN_CASES[7]!.turns[9]!.command.source_references;
    const crossParty = commandFor(
      beforeWithdrawal.envelope,
      actorB,
      'command_gz_case_008_cross_party_withdrawal',
      [
        {
          type: 'set_own_evidence_availability',
          evidence_id: 'evidence_gz_case_008_primary',
          availability: 'withdrawn',
        },
      ],
      challengeReference,
    );
    const crossPartyResult = applyEnvelopeCommand({
      envelope: beforeWithdrawal.envelope,
      ledger: beforeWithdrawal.ledger,
      source_registry: beforeWithdrawal.sourceRegistry,
      command: crossParty,
      authenticated_actor: actorB,
    });
    expect(crossPartyResult).toMatchObject({
      status: 'rejected',
      reason_code: 'cross_party_mutation',
    });

    const beforeSupersession = replayThrough(7, 13);
    const supersessionTurn = GATE_ZERO_INITIAL_TEN_CASES[7]!.turns[13]!;
    const missingReplacement = cloneCanonical(supersessionTurn.command);
    missingReplacement.command_id = 'command_gz_case_008_missing_replacement';
    missingReplacement.operations = missingReplacement.operations.slice(1);
    const missingReplacementResult = applyEnvelopeCommand({
      envelope: beforeSupersession.envelope,
      ledger: beforeSupersession.ledger,
      command: missingReplacement,
      authenticated_actor: supersessionTurn.authenticated_actor,
      source_registry: Object.fromEntries(
        supersessionTurn.source_records.map((source) => [source.source_id, source]),
      ),
    });
    expect(missingReplacementResult).toMatchObject({
      status: 'rejected',
      reason_code: 'invalid_operation',
    });
    expect(missingReplacementResult.envelope.control.envelope_hash).toBe(
      beforeSupersession.envelope.control.envelope_hash,
    );
  });

  it('freezes an exact projection and rejects audit-journal injection', () => {
    const fixture = GATE_ZERO_INITIAL_TEN_CASES[9]!;
    const projection = fixture.expected_adjudication_input;
    expect(projection).not.toBeNull();
    expect(projection?.locked_envelope.envelope_hash).toBe(
      fixture.final_envelope.control.envelope_hash,
    );
    expect(projection?.excluded_evidence).toContainEqual({
      evidence_id: 'evidence_background_unadmitted',
      reasons: ['not_disclosed_to_both', 'not_uploaded', 'uninspected'],
    });
    const injected = cloneCanonical(projection!) as typeof projection & {
      audit_journal: unknown[];
    };
    injected.audit_journal = [{ unsupported: 'must not enter adjudication' }];
    injected.input_hash = hashAdjudicationInput(injected);
    expect(
      validateAdjudicationInput(injected, fixture.final_envelope).map((issue) => issue.code),
    ).toContain('adjudication_projection_invalid');
  });

  it('fails closed when fixture plan, source history, or turn chaining is tampered', () => {
    const fixture = cloneCanonical(GATE_ZERO_INITIAL_TEN_CASES[0]!);
    fixture.title = 'Drifted title';
    expect(validateGateZeroCanonicalCase(fixture)).toContain('case_fixture_plan_drift');

    const sourceHistory = cloneCanonical(GATE_ZERO_INITIAL_TEN_CASES[3]!);
    sourceHistory.turns[1]!.source_records[0]!.content = 'tampered';
    expect(validateGateZeroCanonicalCase(sourceHistory)).toContain(
      'case_fixture_source_history_invalid:1',
    );

    const chain = cloneCanonical(GATE_ZERO_INITIAL_TEN_CASES[4]!);
    chain.turns[1]!.base_envelope_hash = 'f'.repeat(64);
    expect(validateGateZeroCanonicalCase(chain)).toContain('case_fixture_turn_chain_invalid:1');
  });
});
