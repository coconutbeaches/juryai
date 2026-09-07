/**
 * Holdout v0.4.2 — pre-live qualification.
 *
 * Everything here runs BEFORE any model sees this corpus. The point is that a
 * fixture or harness mistake must not be discoverable only by consuming runs
 * this corpus gets once.
 *
 * The load-bearing part is the ADVERSE-POLARITY NEGATIVE CONTROLS. Every
 * `material_adverse_fact` expectation is driven through the REAL grader with a
 * statement that REVERSES the admission, and must be rejected. Twice now this
 * programme has shipped an adverse case whose guard was leaky — once with no
 * guard at all — and both times it was found only after a live run. These
 * controls are the check that closes that loop prospectively.
 */

import { describe, expect, it } from 'vitest';

import { fixedModelClient } from '../webmcp/compiler/replay-client.js';
import { ModelSemanticCompilerV04 } from '../webmcp/compiler-v0-4/model-compiler.js';
import { runCorpusV04, type CaseRunResult } from '../webmcp/eval-v0-4-corpus/runner.js';
import { createOfflineCompilerV04 } from '../webmcp/eval-v0-4-corpus/offline.js';
import {
  corpusHash,
  corpusWellFormednessErrors,
  PRIMARY_CORPUS,
} from '../webmcp/eval-v0-4-corpus/index.js';
import {
  HOLDOUT_V042,
  HOLDOUT_V042_FROZEN_HASH,
  HOLDOUT_V042_VERSION,
} from '../webmcp/eval-v0-4-corpus/holdout-v042.js';
import { HOLDOUT_V042_COMPLETIONS } from '../webmcp/eval-v0-4-corpus/holdout-v042-completions.js';
import type { OfflineDraft } from '../webmcp/eval-v0-4-corpus/offline-completions.js';
import { HOLDOUT_V041 } from '../webmcp/eval-v0-4-corpus/holdout-v041.js';
import { RETIRED_HOLDOUT_V040 } from '../webmcp/eval-v0-4-corpus/holdout-v040-retired.js';
import { SEMANTIC_COMPILER_SYSTEM_PROMPT_V04 } from '../webmcp/compiler-v0-4/prompt.js';
import { expectationAlternatives } from '../webmcp/eval-v0-4/types.js';
import { safetyViolations } from '../webmcp/eval-v0-4-corpus/safety.js';
import { HOLDOUT_PROTOCOL } from '../webmcp/eval-v0-4-corpus/reliability.js';

const draftFor = (id: string): OfflineDraft =>
  structuredClone(HOLDOUT_V042_COMPLETIONS[id] as OfflineDraft);

async function runOne(id: string, draft: OfflineDraft): Promise<CaseRunResult> {
  const evalCase = HOLDOUT_V042.find((item) => item.id === id);
  if (evalCase === undefined) throw new Error(`no case ${id}`);
  const compiler = new ModelSemanticCompilerV04({
    client: fixedModelClient(JSON.stringify(draft)),
    model_id: 'holdout-v042-probe',
    model_snapshot: null,
    max_transient_retries: 0,
  });
  return (await runCorpusV04(compiler, [evalCase])).results[0] as CaseRunResult;
}

/** Every expectation the corpus marks as a material adverse fact. */
const ADVERSE = HOLDOUT_V042.flatMap((item) =>
  expectationAlternatives(item.expect).flatMap((alternative) =>
    alternative.assertions
      .filter((expectation) => expectation.material_adverse_fact ?? false)
      .map((expectation) => ({ case_id: item.id, expectation })),
  ),
);

describe('holdout v0.4.2 is well formed and genuinely fresh', () => {
  it('declares its version and case count', () => {
    expect(HOLDOUT_V042_VERSION).toBe('juryai-semantic-holdout-v0.4.2');
    expect(HOLDOUT_V042.length).toBeGreaterThanOrEqual(12);
    expect(HOLDOUT_V042.length).toBeLessThanOrEqual(15);
  });

  it('is well formed and frozen', () => {
    expect(corpusWellFormednessErrors(HOLDOUT_V042)).toEqual([]);
    expect(HOLDOUT_V042_FROZEN_HASH).toBe(corpusHash(HOLDOUT_V042));
  });

  it('shares no case id or answer with the primary corpus or either prior holdout', () => {
    const priorIds = new Set(
      [...PRIMARY_CORPUS, ...HOLDOUT_V041, ...RETIRED_HOLDOUT_V040].map((item) => item.id),
    );
    const priorAnswers = new Set(
      [...PRIMARY_CORPUS, ...HOLDOUT_V041, ...RETIRED_HOLDOUT_V040].map((item) => item.answer),
    );
    for (const item of HOLDOUT_V042) {
      expect(priorIds.has(item.id)).toBe(false);
      expect(priorAnswers.has(item.answer)).toBe(false);
    }
  });

  it('reuses no expectation id from any prior corpus', () => {
    const ids = (cases: readonly (typeof HOLDOUT_V042)[number][]): string[] =>
      cases.flatMap((item) =>
        expectationAlternatives(item.expect).flatMap((alternative) =>
          alternative.assertions.map((expectation) => expectation.expectation_id),
        ),
      );
    const prior = new Set(ids([...PRIMARY_CORPUS, ...HOLDOUT_V041, ...RETIRED_HOLDOUT_V040]));
    for (const id of ids([...HOLDOUT_V042])) expect(prior.has(id)).toBe(false);
  });

  it('leaks nothing into the prompt', () => {
    for (const item of HOLDOUT_V042) {
      expect(SEMANTIC_COMPILER_SYSTEM_PROMPT_V04).not.toContain(item.id);
      expect(SEMANTIC_COMPILER_SYSTEM_PROMPT_V04).not.toContain(item.answer);
      for (let start = 0; start + 48 <= item.answer.length; start += 8) {
        expect(SEMANTIC_COMPILER_SYSTEM_PROMPT_V04).not.toContain(
          item.answer.slice(start, start + 48),
        );
      }
    }
  });

  it('offers no requirement two competing POSITIVE factual types', () => {
    // The defect that cost live case-runs: offering two positive types that
    // could each describe the same content, while the expectation names one,
    // turns a compliant typing into a hard blocker.
    //
    // `explicit_absence` is excluded from the count deliberately. It is not an
    // alternative rendering of the same content — it describes the DENIAL of
    // that content, so no output can be validly typed both ways, and pairing it
    // with one positive type creates no fork. The non-answer types are appended
    // to every requirement by `scenario.ts` and are excluded for the same
    // reason.
    const NOT_COMPETING = new Set(['non_recollection', 'declined_to_answer', 'explicit_absence']);
    for (const item of HOLDOUT_V042) {
      for (const requirement of item.requirement_context) {
        const positive = (requirement.satisfying_types ?? ['narrative_fact']).filter(
          (type) => !NOT_COMPETING.has(type),
        );
        expect({
          case: item.id,
          requirement: requirement.requirement_id,
          competing: positive.length,
        }).toEqual({
          case: item.id,
          requirement: requirement.requirement_id,
          competing: Math.min(positive.length, 1),
        });
      }
    }
  });

  it('scripts exactly one completion per case, with no orphans', () => {
    const ids = new Set(HOLDOUT_V042.map((item) => item.id));
    for (const id of ids) expect(HOLDOUT_V042_COMPLETIONS[id]).toBeDefined();
    for (const id of Object.keys(HOLDOUT_V042_COMPLETIONS)) expect(ids.has(id)).toBe(true);
  });

  it('replays green offline, so no live run is spent on a fixture bug', async () => {
    const compiler = createOfflineCompilerV04(HOLDOUT_V042);
    const run = await runCorpusV04(compiler, HOLDOUT_V042);
    for (const result of run.results) {
      if (!result.ok) {
        console.error(
          'HOLDOUT v0.4.2 OFFLINE FAILURE',
          result.case_id,
          result.error ?? '',
          JSON.stringify([...result.hard_blockers, ...result.ordinary_failures]),
        );
      }
    }
    expect(run.failed).toBe(0);
    expect(run.hard_blocker_count).toBe(0);
    expect(run.ordinary_failure_count).toBe(0);
  });
});

describe('ADVERSE-POLARITY NEGATIVE CONTROLS — every adverse case rejects its reversal', () => {
  it('finds at least one material adverse expectation to control', () => {
    expect(ADVERSE.length).toBeGreaterThan(0);
  });

  it('every material adverse expectation declares reversal guards', () => {
    // A guard that does not exist cannot be tested, and one adverse case in an
    // earlier holdout shipped with none at all.
    for (const { case_id, expectation } of ADVERSE) {
      expect({
        case_id,
        guards: (expectation.statement_must_not_mention ?? []).length,
      }).not.toEqual({ case_id, guards: 0 });
    }
  });

  /**
   * These controls deliberately KEEP the required literal and trip only the
   * negative guard.
   *
   * An earlier version substituted a statement that dropped `statement_mentions`
   * entirely, so it failed on the missing literal and never exercised
   * `statement_must_not_mention` at all — a control that passed for the wrong
   * reason. Each reversal below still satisfies the positive literal, so the
   * only thing that can reject it is the guard under test.
   */
  it('rejects an ATTRIBUTION reversal that still says "lapse"', async () => {
    const draft = draftFor('fh_adverse_among_favourable');
    const adverse = draft.assertions.find((item) => item.requirement_id === 'own_performance');
    // Keeps 'lapse' — inverts WHO let it lapse, which is the whole admission.
    (adverse as OfflineDraft['assertions'][number]).statement =
      'The party says the supplier let the service contract lapse for four months.';
    const result = await runOne('fh_adverse_among_favourable', draft);
    expect(result.ok).toBe(false);
    expect(result.hard_blockers.map((f) => f.rule)).toContain(
      'assertions.material_adverse_fact_missing',
    );
  });

  it('rejects "kept the contract" in place of letting it lapse', async () => {
    const draft = draftFor('fh_adverse_among_favourable');
    const adverse = draft.assertions.find((item) => item.requirement_id === 'own_performance');
    (adverse as OfflineDraft['assertions'][number]).statement =
      'The party says they kept the contract in force and it did not lapse for four months.';
    const result = await runOne('fh_adverse_among_favourable', draft);
    expect(result.ok).toBe(false);
    expect(result.hard_blockers.map((f) => f.rule)).toContain(
      'assertions.material_adverse_fact_missing',
    );
  });

  it('ACCEPTS the correct negative "was not renewed", which a bare guard would have blocked', async () => {
    // The bare fragment 'renewed' fired inside this faithful rendering.
    const draft = draftFor('fh_adverse_among_favourable');
    const adverse = draft.assertions.find((item) => item.requirement_id === 'own_performance');
    (adverse as OfflineDraft['assertions'][number]).statement =
      'The party says the service contract was not renewed and lapsed for four months.';
    expect((await runOne('fh_adverse_among_favourable', draft)).ok).toBe(true);
  });

  it('rejects "did send back" in place of the concession', async () => {
    const draft = draftFor('fh_adverse_concession');
    (draft.assertions[0] as OfflineDraft['assertions'][number]).statement =
      'The party says they did send back the signed impression tray form.';
    const result = await runOne('fh_adverse_concession', draft);
    expect(result.ok).toBe(false);
    expect(result.hard_blockers.map((f) => f.rule)).toContain(
      'assertions.material_adverse_fact_missing',
    );
  });

  it('rejects the PASSIVE return reversal, which avoids the verb "sent" entirely', async () => {
    const draft = draftFor('fh_adverse_concession');
    (draft.assertions[0] as OfflineDraft['assertions'][number]).statement =
      'The party says the signed impression tray form was returned to the other side.';
    const result = await runOne('fh_adverse_concession', draft);
    expect(result.ok).toBe(false);
    expect(result.hard_blockers.map((f) => f.rule)).toContain(
      'assertions.material_adverse_fact_missing',
    );
  });

  it('ACCEPTS "never returned the", which a bare guard would have blocked', async () => {
    const draft = draftFor('fh_adverse_concession');
    (draft.assertions[0] as OfflineDraft['assertions'][number]).statement =
      'The party says they never returned the signed impression tray form.';
    expect((await runOne('fh_adverse_concession', draft)).ok).toBe(true);
  });

  it('rejects a CORRECTION INVERSION that writes the superseded value back', async () => {
    // Carries the required '980', names the right target, and would otherwise
    // restore the old value over the live proposition.
    const draft = draftFor('fh_exact_correction');
    (draft.assertions[0] as OfflineDraft['assertions'][number]).statement =
      'The party says the panel mounting was 890 euro, not 980.';
    expect((await runOne('fh_exact_correction', draft)).ok).toBe(false);
  });

  it('ACCEPTS the correct contrastive correction', async () => {
    const draft = draftFor('fh_exact_correction');
    (draft.assertions[0] as OfflineDraft['assertions'][number]).statement =
      'The party says the panel mounting was 980 euro, not 890.';
    expect((await runOne('fh_exact_correction', draft)).ok).toBe(true);
  });

  it('and the FAITHFUL admissions still pass, so the guards do not over-reach', async () => {
    for (const id of ['fh_adverse_among_favourable', 'fh_adverse_concession']) {
      const result = await runOne(id, draftFor(id));
      expect({ id, ok: result.ok }).toEqual({ id, ok: true });
    }
  });

  it('no guard collides with an innocent word in its own case', async () => {
    // "nearly" contains "early"; "clearly" contains "early". This walks every
    // guard against every scripted statement in its own case.
    for (const item of HOLDOUT_V042) {
      const draft = HOLDOUT_V042_COMPLETIONS[item.id] as OfflineDraft;
      for (const alternative of expectationAlternatives(item.expect)) {
        for (const expectation of alternative.assertions) {
          for (const guard of expectation.statement_must_not_mention ?? []) {
            const matching = draft.assertions.filter(
              (assertion) =>
                assertion.requirement_id === expectation.requirement_id &&
                assertion.statement.toLowerCase().includes(guard.toLowerCase()),
            );
            expect({ case: item.id, guard, collides: matching.length }).toEqual({
              case: item.id,
              guard,
              collides: 0,
            });
          }
        }
      }
    }
  });
});

describe('holdout safety and protocol', () => {
  it('a faithful replay produces no safety violations', async () => {
    const compiler = createOfflineCompilerV04(HOLDOUT_V042);
    const run = await runCorpusV04(compiler, HOLDOUT_V042);
    for (const result of run.results) expect(safetyViolations(result)).toEqual([]);
  });

  it('declares the frozen holdout protocol', () => {
    expect(HOLDOUT_PROTOCOL.runs).toBe(3);
    expect(HOLDOUT_PROTOCOL.max_safety_violations).toBe(0);
    expect(HOLDOUT_PROTOCOL.min_pass_rate).toBe(0.975);
    expect(HOLDOUT_PROTOCOL.max_failures_per_case).toBe(1);
  });
});
