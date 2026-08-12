import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalSerialize,
  cloneCanonical,
  sha256,
  type SourceRecord,
} from '../v2/case-envelope.js';
import { applyEnvelopeCommand, type CommandLedger } from '../v2/envelope-command.js';
import { validateGateZeroTurnOracle } from '../v2/gate-zero-oracle.js';
import {
  GATE_ZERO_CORPUS,
  GATE_ZERO_CORPUS_FINGERPRINT,
  GATE_ZERO_CORPUS_VERSION,
  buildGateZeroCorpusManifest,
  validateGateZeroCorpus,
} from '../gate-zero/corpus.js';
import { GATE_ZERO_CASE_PLANS } from '../gate-zero/coverage-matrix.js';

describe('Gate Zero GZ3 hash-frozen corpus', () => {
  it('freezes exactly 36 cases and 390 turns under one corpus fingerprint', () => {
    const manifest = buildGateZeroCorpusManifest();
    expect(GATE_ZERO_CORPUS_VERSION).toBe('juryai-gate-zero-corpus-v1.0.0');
    expect(GATE_ZERO_CORPUS).toHaveLength(36);
    expect(manifest.turn_count).toBe(390);
    expect(manifest.corpus_fingerprint).toBe(GATE_ZERO_CORPUS_FINGERPRINT);
    expect(GATE_ZERO_CORPUS_FINGERPRINT).toBe(
      'a91f2184fce5b269afe7d36174c864e2c0789cf29bfe9c2eeec82da510574061',
    );
    expect(validateGateZeroCorpus()).toEqual([]);
  });

  it('matches every frozen case and manifest byte for byte', async () => {
    const manifest = buildGateZeroCorpusManifest();
    const manifestBytes = await readFile(
      resolve(process.cwd(), 'src/fixtures/gate-zero/manifest.json'),
      'utf8',
    );
    expect(manifestBytes).toBe(canonicalSerialize(manifest));
    for (const [index, fixture] of GATE_ZERO_CORPUS.entries()) {
      const entry = manifest.cases[index]!;
      const bytes = await readFile(resolve(process.cwd(), entry.path), 'utf8');
      expect(bytes, fixture.case_id).toBe(canonicalSerialize(fixture));
      expect(sha256(bytes), fixture.case_id).toBe(entry.sha256);
    }
  });

  it('replays all 390 turns through deterministic GZ0 code with no provider', () => {
    let replayed = 0;
    for (const fixture of GATE_ZERO_CORPUS) {
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
        envelope = result.envelope;
        ledger = result.ledger;
        replayed += 1;
      }
      expect(canonicalSerialize(envelope), fixture.case_id).toBe(
        canonicalSerialize(fixture.final_envelope),
      );
    }
    expect(replayed).toBe(390);
  });

  it('requires an exact projection only for projection-planned cases', () => {
    for (const [index, fixture] of GATE_ZERO_CORPUS.entries()) {
      const planned =
        GATE_ZERO_CASE_PLANS[index]!.journey_phases.includes('adjudication_projection');
      expect(fixture.expected_adjudication_input !== null, fixture.case_id).toBe(planned);
    }
  });

  it('keeps superseded evidence retained but outside the active decision set', () => {
    const fixture = GATE_ZERO_CORPUS[26]!;
    const oldEvidence = fixture.final_envelope.evidence.evidence_gz_case_027_old!;
    expect(oldEvidence).toMatchObject({
      availability: 'superseded',
      decision_relevant: false,
      adjudication_eligibility: { status: 'ineligible' },
    });
    expect(fixture.expected_adjudication_input?.excluded_evidence).toContainEqual({
      evidence_id: 'evidence_gz_case_027_old',
      reasons: ['not_disclosed_to_both', 'uninspected', 'withdrawn_or_superseded'],
    });
  });

  it('rejects incomplete non-participation identities without mutation', () => {
    const turn = GATE_ZERO_CORPUS[23]!.turns[1]!;
    expect(turn.expected).toMatchObject({
      disposition: 'rejected',
      exact_no_mutation: true,
      failure_reason: 'invalid_operation',
    });
    expect(turn.command.operations[0]).toMatchObject({ deadline_expired_event_id: '' });
  });

  it('allows a structurally invalid command only as an invalid-command failure fixture', () => {
    const turn = GATE_ZERO_CORPUS[35]!.turns[0]!;
    expect(turn.expected.failure_reason).toBe('invalid_command');
    expect(validateGateZeroTurnOracle(turn)).toEqual([]);
    const mislabeled = cloneCanonical(turn);
    mislabeled.expected.failure_reason = 'invalid_operation';
    expect(validateGateZeroTurnOracle(mislabeled)).toContain('oracle_command_shape_invalid');
  });

  it('contains no accidental provider or legacy-evaluator command surface', () => {
    const bytes = canonicalSerialize(GATE_ZERO_CORPUS);
    expect(bytes).not.toContain('OPENAI_API_KEY');
    expect(bytes).not.toContain('evaluate:person-a');
    expect(bytes).not.toContain('claim_payment_term_1');
  });
});
