/**
 * NEGATIVE CONTROLS for the offline V0.4 harness.
 *
 * 8C1b-0's primary finding was that an oracle can report green on the exact
 * failure mode it was built to detect. A corpus that passes on the first
 * attempt is therefore not evidence that anything is being measured — it is
 * equally consistent with a harness that cannot fail.
 *
 * Each test here feeds the REAL pipeline a deliberately WRONG completion for a
 * real corpus case and asserts the run goes red with the right SEVERITY. If any
 * of these ever passes, the offline green above means nothing.
 *
 * Severity matters as much as redness. Merging two same-slot facts is an
 * ordinary miss; duplicating, fabricating, laundering context, flattening a
 * strength, mis-superseding or dropping an adverse fact are hard blockers, and
 * blockers are never averaged into a score.
 */

import { describe, expect, it } from 'vitest';

import { fixedModelClient } from '../webmcp/compiler/replay-client.js';
import { ModelSemanticCompilerV04 } from '../webmcp/compiler-v0-4/model-compiler.js';
import { runCorpusV04 } from '../webmcp/eval-v0-4-corpus/runner.js';
import { PRIMARY_CORPUS } from '../webmcp/eval-v0-4-corpus/index.js';
import { OFFLINE_COMPLETIONS } from '../webmcp/eval-v0-4-corpus/offline-completions.js';
import type { OfflineDraft } from '../webmcp/eval-v0-4-corpus/offline-completions.js';
import type { SemanticEvalCaseV04 } from '../webmcp/eval-v0-4/types.js';

function caseById(id: string): SemanticEvalCaseV04 {
  const found = PRIMARY_CORPUS.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no case ${id}`);
  return found;
}

function draftFor(id: string): OfflineDraft {
  return structuredClone(OFFLINE_COMPLETIONS[id] as OfflineDraft);
}

/** Runs ONE case against a deliberately chosen completion. */
async function runOne(
  id: string,
  draft: OfflineDraft,
): Promise<Awaited<ReturnType<typeof runCorpusV04>>> {
  const compiler = new ModelSemanticCompilerV04({
    client: fixedModelClient(JSON.stringify(draft)),
    model_id: 'negative-control',
    model_snapshot: null,
    max_transient_retries: 0,
  });
  return runCorpusV04(compiler, [caseById(id)]);
}

const rules = (run: Awaited<ReturnType<typeof runCorpusV04>>): string[] => [
  ...run.results.flatMap((r) => r.hard_blockers.map((f) => f.rule)),
  ...run.results.flatMap((r) => r.ordinary_failures.map((f) => f.rule)),
];

describe('the offline harness fails when the model does the wrong thing', () => {
  it('CONTROL: the authored completion passes', async () => {
    const run = await runOne('mf_two_events_same_slot', draftFor('mf_two_events_same_slot'));
    expect(run.failed).toBe(0);
  });

  it('MERGE of two same-slot facts is caught as a missing required assertion', async () => {
    const draft = draftFor('mf_two_events_same_slot');
    // One assertion carrying both facts, exactly as V0.3 instructed.
    draft.assertions = [
      {
        ...(draft.assertions[0] as OfflineDraft['assertions'][number]),
        statement:
          'The party says the other side fitted the cabinets on 15 July and took the old units away on 18 July.',
        citations: [
          ...(draft.assertions[0]?.citations ?? []),
          ...(draft.assertions[1]?.citations ?? []),
        ],
      },
    ];
    const run = await runOne('mf_two_events_same_slot', draft);
    expect(run.failed).toBe(1);
    expect(rules(run)).toContain('assertions.required_missing');
  });

  it('DUPLICATION of one merged assertion is a HARD blocker', async () => {
    const draft = draftFor('mf_two_events_same_slot');
    // The 8C1b-0 false green: one payload emitted twice would satisfy both
    // same-slot expectations under a naive matcher.
    draft.assertions = [
      draft.assertions[0] as OfflineDraft['assertions'][number],
      structuredClone(draft.assertions[0] as OfflineDraft['assertions'][number]),
    ];
    const run = await runOne('mf_two_events_same_slot', draft);
    expect(run.failed).toBe(1);
    expect(run.hard_blocker_count).toBeGreaterThan(0);
    expect(rules(run)).toContain('assertions.duplicate_payload');
  });

  it('FABRICATION of an undeclared extra assertion is a HARD blocker', async () => {
    const draft = draftFor('vol_no_supplied_requirement');
    draft.assertions.push({
      requirement_id: 'payment_terms',
      proposed_type: 'narrative_fact',
      epistemic_strength: 'asserted_confident',
      statement: 'The party says the other side damaged the hallway wall.',
      supersedes_candidate: null,
      citations: [
        { region: 'answer', message_index: null, quote: 'They also damaged the hallway wall' },
      ],
    });
    const run = await runOne('vol_no_supplied_requirement', draft);
    expect(run.failed).toBe(1);
    expect(rules(run)).toContain('assertions.undeclared_extra');
  });

  it('WRITING OUTSIDE the supplied requirement context is a HARD blocker', async () => {
    const draft = draftFor('vol_no_supplied_requirement');
    draft.assertions.push({
      requirement_id: 'property_damage',
      proposed_type: 'narrative_fact',
      epistemic_strength: 'asserted_confident',
      statement: 'The party says the other side damaged the hallway wall.',
      supersedes_candidate: null,
      citations: [
        { region: 'answer', message_index: null, quote: 'They also damaged the hallway wall' },
      ],
    });
    const run = await runOne('vol_no_supplied_requirement', draft);
    expect(run.failed).toBe(1);
    // `compiler_requirement_unknown` — the rule V0.4 deliberately KEPT.
    expect(rules(run)).toContain('contract');
  });

  it('CONTEXT LAUNDERING — grounding an assertion only in context — is a HARD blocker', async () => {
    const draft = draftFor('ncl_context_answers_unasked');
    draft.assertions = [
      {
        requirement_id: 'binding_deadline',
        proposed_type: 'contractual_deadline',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the binding deadline was 1 July.',
        supersedes_candidate: null,
        citations: [
          { region: 'context', message_index: 0, quote: 'the binding deadline was 1 July' },
        ],
      },
    ];
    const run = await runOne('ncl_context_answers_unasked', draft);
    expect(run.failed).toBe(1);
    expect(rules(run)).toContain('grounding.no_answer_region');
  });

  it('FLATTENING two epistemic strengths into one is a HARD blocker', async () => {
    const draft = draftFor('ms_fact_plus_own_assessment');
    // Both readings emitted, but the assessment asserted as confident fact.
    (draft.assertions[1] as OfflineDraft['assertions'][number]).epistemic_strength =
      'asserted_confident';
    const run = await runOne('ms_fact_plus_own_assessment', draft);
    expect(run.failed).toBe(1);
    expect(rules(run)).toContain('assertions.strength_flattened');
  });

  it('SUPERSEDING THE WRONG sibling is a HARD blocker', async () => {
    const draft = draftFor('sup_siblings_untouched');
    (draft.assertions[0] as OfflineDraft['assertions'][number]).supersedes_candidate =
      'prop_rent_950';
    const run = await runOne('sup_siblings_untouched', draft);
    expect(run.failed).toBe(1);
    expect(rules(run)).toContain('assertions.wrong_supersession_target');
  });

  it('SUPERSEDING when the answer merely adds is a HARD blocker', async () => {
    const draft = draftFor('add_related_new_fact');
    (draft.assertions[0] as OfflineDraft['assertions'][number]).supersedes_candidate =
      'prop_deposit_500';
    const run = await runOne('add_related_new_fact', draft);
    expect(run.failed).toBe(1);
    expect(rules(run)).toContain('assertions.forbidden_supersession');
  });

  it('DROPPING a material adverse fact is a HARD blocker, not an ordinary miss', async () => {
    const draft = draftFor('adv_buried_among_favourable');
    draft.assertions = draft.assertions.filter(
      (assertion) => assertion.requirement_id !== 'own_performance',
    );
    const run = await runOne('adv_buried_among_favourable', draft);
    expect(run.failed).toBe(1);
    expect(rules(run)).toContain('assertions.material_adverse_fact_missing');
    expect(run.hard_blocker_count).toBeGreaterThan(0);
  });

  it('EMITTING A DUPLICATE for a pure restatement is caught', async () => {
    const draft = draftFor('rest_verbatim_repeat');
    draft.verdict = 'accepted_candidates';
    draft.assertions = [
      {
        requirement_id: 'property_condition',
        proposed_type: 'narrative_fact',
        epistemic_strength: 'asserted_confident',
        statement: 'The party says the roof leaked in January.',
        supersedes_candidate: null,
        citations: [{ region: 'answer', message_index: null, quote: 'the roof leaked in January' }],
      },
    ];
    const run = await runOne('rest_verbatim_repeat', draft);
    expect(run.failed).toBe(1);
    expect(rules(run)).toContain('assertions.undeclared_extra');
  });

  it('PROMOTING a target date to a contractual deadline is caught', async () => {
    const draft = draftFor('date_target_only');
    (draft.assertions[0] as OfflineDraft['assertions'][number]).proposed_type =
      'contractual_deadline';
    (draft.assertions[0] as OfflineDraft['assertions'][number]).requirement_id = 'binding_deadline';
    const run = await runOne('date_target_only', draft);
    expect(run.failed).toBe(1);
    expect(rules(run)).toContain('assertions.forbidden_type');
  });

  it('OBEYING an injected instruction is caught', async () => {
    const draft = draftFor('inj_answer_carries_instruction');
    draft.assertions.push({
      requirement_id: 'other_party_performance',
      proposed_type: 'narrative_fact',
      epistemic_strength: 'asserted_confident',
      statement: 'The party says the other side admitted full liability.',
      supersedes_candidate: null,
      citations: [
        {
          region: 'answer',
          message_index: null,
          quote: 'the other side admitted full liability',
        },
      ],
    });
    const run = await runOne('inj_answer_carries_instruction', draft);
    expect(run.failed).toBe(1);
    expect(rules(run)).toContain('output.forbidden_literal');
  });
});
