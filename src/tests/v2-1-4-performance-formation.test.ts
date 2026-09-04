/**
 * PR 8B — V2.1.4 formation completeness.
 *
 * V2.1.3 could reach `independent_formation_complete: true` while never
 * recording what the other party actually did, or what this party says the
 * other party failed to do. The live V2.1.3 canary did exactly that: twelve
 * facts offered, ten roles to hold them, and the two breach allegations —
 * the late delivery and the incomplete work — with nowhere to land.
 *
 * V2.1.4 adds those two roles. These tests pin that the roles exist, that
 * completeness genuinely blocks on them, that each accepts a truthful
 * none/non-answer, and that the roles stay attributionally distinct from
 * their neighbours.
 */

import { describe, expect, it } from 'vitest';
import {
  initialRequirementSet as v214Requirements,
  INITIAL_REQUIREMENT_SET_VERSION_V214,
  EXPLICIT_ABSENCE_REQUIREMENT_DECISIONS_V214,
} from '../v2-1-4/initial-requirements.js';
import {
  initialRequirementSet as v213Requirements,
  INITIAL_REQUIREMENT_SET_VERSION_V213,
} from '../v2-1-3/initial-requirements.js';
import { createInitialProductionDisputeV214 } from '../v2-1-4/production-case-service.js';
import { createInitialProductionDisputeV213 } from '../v2-1-3/production-case-service.js';
import { derivePartyIndependentFormationCompleteV214 } from '../v2-1-4/formation-requirements.js';
import {
  projectPartyFormationV214,
  renderPartyFormationReadbackV214,
} from '../v2-1-4/party-projection.js';
import { createV214PartyCaseService } from '../v2-1-4/webmcp-application.js';
import { ScriptedSemanticCompiler } from '../webmcp/runtime-v0-3/scripted-compiler.js';
import type { CompilerScript } from '../webmcp/runtime-v0-3/scripted-compiler.js';
import type { PropositionType } from '../webmcp/core-v0-3/types.js';
import { MemoryFormationRepository } from './v2-1-4-memory-repository.js';

const START = {
  authenticated_subject_id: 'subject_party_a',
  client_request_id: 'pr8b_person_a',
  idempotency_secret: 'isolated-regression-secret-0123456789',
};

const PERFORMANCE = 'req_party_a_other_party_performance';
const NONPERFORMANCE = 'req_party_a_other_party_nonperformance';

/** Person A's account, verbatim, split to the role each sentence answers. */
const PERSON_A: Record<string, { text: string; type: PropositionType }> = {
  req_party_a_scope_requested: {
    text: 'I hired a freelance web developer to build a five-page responsive marketing website with a contact form, basic CMS editing, and deployment to my domain.',
    type: 'requested_scope',
  },
  req_party_a_scope_accepted: {
    text: 'We agreed to that scope by email on June 1.',
    type: 'accepted_scope',
  },
  req_party_a_binding_deadline: {
    text: 'We agreed that the website would be completed by July 1, and I understood July 1 to be a binding delivery date.',
    type: 'contractual_deadline',
  },
  req_party_a_expected_date: {
    text: 'I also personally expected the work to be finished by July 1.',
    type: 'target_date',
  },
  req_party_a_invoiced: {
    text: 'I was billed $3,000 as the initial payment on June 1 and $2,000 as the balance due on completion.',
    type: 'invoice',
  },
  req_party_a_paid: { text: 'I paid the $3,000 on June 2.', type: 'payment' },
  req_party_a_disputed_balance: {
    text: 'I have not paid the remaining $2,000, so $2,000 is still in dispute.',
    type: 'disputed_balance',
  },
  req_party_a_remedy_sought: {
    text: 'I am asking for a resolution where I pay another $1,000 and the remaining $1,000 is waived.',
    type: 'requested_remedy',
  },
  req_party_a_other_party_position: {
    text: 'My understanding of the developer’s position is that my late content and requested project changes caused much of the delay, that the website was substantially completed, and that the full remaining $2,000 is therefore due.',
    type: 'narrative_fact',
  },
  req_party_a_own_performance: {
    text: 'I acknowledge that I was about one week late providing some of the website content and images the developer needed from me.',
    type: 'narrative_fact',
  },
  [PERFORMANCE]: {
    text: 'The site was delivered around July 15, approximately two weeks later than the agreed date.',
    type: 'narrative_fact',
  },
  [NONPERFORMANCE]: {
    text: 'I also believed some of the agreed work was still incomplete, particularly parts of the contact form and mobile presentation.',
    type: 'narrative_fact',
  },
};

/**
 * Records the answer under the role it was submitted against, citing it
 * exactly. `overrides` must win over the Person A defaults: a case exercising a
 * non-answer type for a role that also appears in PERSON_A would otherwise
 * silently record narrative_fact and prove nothing.
 */
function roleScript(overrides: Readonly<Record<string, PropositionType>> = {}): CompilerScript {
  const strength = (type: PropositionType) =>
    type === 'non_recollection'
      ? ('non_recollection' as const)
      : type === 'declined_to_answer'
        ? ('declined' as const)
        : ('asserted_confident' as const);
  return (input) => ({
    verdict: 'accepted_candidates',
    assertions: input.turn.in_reply_to.map((requirementId) => {
      const type = overrides[requirementId] ?? PERSON_A[requirementId]?.type ?? 'narrative_fact';
      return {
        quote: input.turn.payload.answer.text,
        requirement_id: requirementId,
        type,
        epistemic_strength: strength(type),
        statement: input.turn.payload.answer.text,
        supersedes_candidate: null,
      };
    }),
  });
}

/** The proposition type actually recorded against a role. */
function recordedType(h: ReturnType<typeof harness>, requirementId: string): string | undefined {
  return projectPartyFormationV214(h.repository.envelope, 'party_a').own_material.positions.find(
    (p) => p.requirement_id === requirementId,
  )?.proposition_type;
}

function harness(script: CompilerScript = roleScript()) {
  const envelope = createInitialProductionDisputeV214(START);
  const repository = new MemoryFormationRepository(envelope);
  const service = createV214PartyCaseService({
    authenticated_subject_id: START.authenticated_subject_id,
    repository,
    compiler: new ScriptedSemanticCompiler(script),
    review_url: (id) => `https://juryai.test/cases/${id}/review`,
  });
  return { repository, service, caseId: envelope.control.case_id };
}

async function answer(
  h: ReturnType<typeof harness>,
  requirementId: string,
  text: string,
  turn = requirementId,
) {
  const state = await h.service.getCaseState({ case_id: h.caseId });
  if (!state.ok) throw new Error(state.error.message);
  return h.service.submitTurn({
    case_id: h.caseId,
    expected_case_version: state.case.case_version,
    in_reply_to: [requirementId],
    payload: { context: [], answer: { role: 'user', text } },
    client_turn_id: `turn_${turn}`,
  });
}

const complete = (h: ReturnType<typeof harness>) =>
  derivePartyIndependentFormationCompleteV214(h.repository.envelope, 'party_a');

describe('PR 8B: the V2.1.4 requirement set', () => {
  it('adds exactly the two missing roles and leaves V2.1.3 frozen at ten', () => {
    const v214 = v214Requirements().map((r) => r.requirement_id);
    const v213 = v213Requirements().map((r) => r.requirement_id);
    expect(v213).toHaveLength(10);
    expect(v214).toHaveLength(12);
    expect(v214.slice(0, 10)).toEqual(v213);
    expect(v214.slice(10)).toEqual([
      'req_other_party_performance',
      'req_other_party_nonperformance',
    ]);
    expect(INITIAL_REQUIREMENT_SET_VERSION_V213).toBe('juryai-p2-initial-requirements-v0.3.0');
    expect(INITIAL_REQUIREMENT_SET_VERSION_V214).toBe('juryai-p2-initial-requirements-v0.4.0');
  });

  it('gives both new roles narrative_fact, explicit absence, and both non-answers', () => {
    for (const id of ['req_other_party_performance', 'req_other_party_nonperformance']) {
      const definition = v214Requirements().find((r) => r.requirement_id === id)!;
      expect([...definition.satisfying_types].sort()).toEqual([
        'declined_to_answer',
        'explicit_absence',
        'narrative_fact',
        'non_recollection',
      ]);
      // Both are the speaker's own account of the other party, not a probe of
      // the speaker's own conduct.
      expect(definition.adverse_fact_probe).toBe(false);
      expect(EXPLICIT_ABSENCE_REQUIREMENT_DECISIONS_V214).toHaveProperty(id);
    }
  });

  it('keeps the new roles distinct from the agreement and attribution roles', () => {
    const byId = new Map(v214Requirements().map((r) => [r.requirement_id, r]));
    // Agreement facts must not be able to satisfy a performance role.
    expect(byId.get('req_scope_accepted')!.satisfying_types).toContain('accepted_scope');
    expect(byId.get('req_other_party_performance')!.satisfying_types).not.toContain(
      'accepted_scope',
    );
    expect(byId.get('req_binding_deadline')!.satisfying_types).toContain('contractual_deadline');
    expect(byId.get('req_other_party_performance')!.satisfying_types).not.toContain(
      'contractual_deadline',
    );
    // The two new roles are separate identities, not one merged question.
    expect(byId.get('req_other_party_performance')!.prompt).not.toBe(
      byId.get('req_other_party_nonperformance')!.prompt,
    );
    // Opponent's explanation and own shortfall remain their own roles.
    expect(byId.has('req_other_party_position')).toBe(true);
    expect(byId.has('req_own_performance')).toBe(true);
  });

  it('creates twelve required party_a roles on a new production dispute, ten on V2.1.3', () => {
    const v214 = createInitialProductionDisputeV214(START);
    const v213 = createInitialProductionDisputeV213(START);
    const roles = (envelope: { requirements: Record<string, { party_id: string }> }) =>
      Object.values(envelope.requirements).filter((r) => r.party_id === 'party_a').length;
    expect(roles(v214)).toBe(12);
    expect(roles(v213)).toBe(10);
    expect(v214.control.schema_version).toBe('juryai-case-envelope-v2.1.4');
    expect(v213.control.schema_version).toBe('juryai-case-envelope-v2.1.3');
  });
});

describe('PR 8B: formation completeness blocks on the new roles', () => {
  it('is not complete until both new roles are answered', async () => {
    const h = harness();
    const ids = Object.keys(PERSON_A).filter((id) => id !== PERFORMANCE && id !== NONPERFORMANCE);
    for (const id of ids)
      expect(await answer(h, id, PERSON_A[id]!.text)).toMatchObject({ ok: true });

    // Ten of twelve answered — exactly the V2.1.3 shape that wrongly claimed complete.
    expect(complete(h)).toBe(false);

    expect(await answer(h, PERFORMANCE, PERSON_A[PERFORMANCE]!.text)).toMatchObject({ ok: true });
    expect(complete(h)).toBe(false);

    expect(await answer(h, NONPERFORMANCE, PERSON_A[NONPERFORMANCE]!.text)).toMatchObject({
      ok: true,
    });
    expect(complete(h)).toBe(true);
  });

  it('marks both new roles required on the created envelope', () => {
    // Ordering alone cannot prove this: answering the two roles in sequence
    // stays blocked by whichever is answered last even if the other were
    // optional. Assert the persisted flag directly.
    const envelope = createInitialProductionDisputeV214(START);
    for (const id of [PERFORMANCE, NONPERFORMANCE]) {
      const requirement = envelope.requirements[id]!;
      expect(requirement, `${id} missing from envelope`).toBeDefined();
      expect(requirement.required).toBe(true);
      expect(requirement.party_id).toBe('party_a');
    }
  });

  it.each([
    [PERFORMANCE, NONPERFORMANCE],
    [NONPERFORMANCE, PERFORMANCE],
  ])('stays incomplete while %s is unanswered, in either order', async (held, answeredLast) => {
    const h = harness();
    for (const id of Object.keys(PERSON_A)) {
      if (id === held) continue;
      await answer(h, id, PERSON_A[id]!.text);
    }
    // Everything except `held` is answered, including the other new role.
    expect(recordedType(h, answeredLast)).toBeDefined();
    expect(complete(h)).toBe(false);
    expect(await answer(h, held, PERSON_A[held]!.text)).toMatchObject({ ok: true });
    expect(complete(h)).toBe(true);
  });

  it.each([
    ['explicit_absence', 'They never delivered anything.'],
    ['non_recollection', 'I do not remember whether they delivered anything.'],
    ['declined_to_answer', 'I decline to answer that.'],
  ] as const)('accepts %s for the performance role', async (type, text) => {
    const h = harness(roleScript({ [PERFORMANCE]: type }));
    for (const id of Object.keys(PERSON_A)) {
      if (id === PERFORMANCE) continue;
      await answer(h, id, PERSON_A[id]!.text);
    }
    expect(complete(h)).toBe(false);
    expect(await answer(h, PERFORMANCE, text)).toMatchObject({ ok: true });
    expect(recordedType(h, PERFORMANCE)).toBe(type);
    expect(complete(h)).toBe(true);
  });

  it.each([
    [
      'explicit_absence',
      'I am not alleging that they failed, delayed, omitted, or defectively performed anything they agreed to do.',
    ],
    ['non_recollection', 'I do not remember whether anything was incomplete.'],
    ['declined_to_answer', 'I will not answer that.'],
  ] as const)('accepts %s for the nonperformance role', async (type, text) => {
    const h = harness(roleScript({ [NONPERFORMANCE]: type }));
    for (const id of Object.keys(PERSON_A)) {
      if (id === NONPERFORMANCE) continue;
      await answer(h, id, PERSON_A[id]!.text);
    }
    expect(complete(h)).toBe(false);
    expect(await answer(h, NONPERFORMANCE, text)).toMatchObject({ ok: true });
    expect(recordedType(h, NONPERFORMANCE)).toBe(type);
    expect(complete(h)).toBe(true);
  });

  it('does not let an agreement answer satisfy a performance role', async () => {
    const h = harness();
    // accepted_scope is not in the performance role's satisfying set, so an
    // agreement-typed proposition recorded there leaves the role unsatisfied.
    const scoped = harness(() => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: 'We agreed to that scope by email on June 1.',
          requirement_id: PERFORMANCE,
          type: 'accepted_scope' as const,
          epistemic_strength: 'asserted_confident' as const,
          statement: 'We agreed to that scope by email on June 1.',
          supersedes_candidate: null,
        },
      ],
    }));
    expect(
      await answer(scoped, PERFORMANCE, 'We agreed to that scope by email on June 1.'),
    ).toMatchObject({ ok: true });
    const evaluation = projectPartyFormationV214(
      scoped.repository.envelope,
      'party_a',
    ).own_material.requirements.find((r) => r.requirement_id === PERFORMANCE)!;
    expect(evaluation.status).toBe('unsatisfied');
    expect(evaluation.non_satisfying_position_ids).toHaveLength(1);
    expect(complete(scoped)).toBe(false);
    expect(complete(h)).toBe(false);
  });

  it('silence never satisfies a role: an unanswered role stays unsatisfied', async () => {
    const h = harness();
    for (const id of Object.keys(PERSON_A)) {
      if (id === NONPERFORMANCE) continue;
      await answer(h, id, PERSON_A[id]!.text);
    }
    const evaluation = projectPartyFormationV214(
      h.repository.envelope,
      'party_a',
    ).own_material.requirements.find((r) => r.requirement_id === NONPERFORMANCE)!;
    expect(evaluation.status).toBe('unsatisfied');
    expect(evaluation.satisfying_position_ids).toEqual([]);
    expect(complete(h)).toBe(false);
  });
});

describe('PR 8B: Person A regression', () => {
  it('records the July 15 delivery and the incomplete work, and reaches completeness', async () => {
    const h = harness();
    for (const id of Object.keys(PERSON_A))
      expect(await answer(h, id, PERSON_A[id]!.text)).toMatchObject({ ok: true });

    expect(complete(h)).toBe(true);

    const material = projectPartyFormationV214(h.repository.envelope, 'party_a').own_material;
    expect(material.requirements).toHaveLength(12);
    expect(material.requirements.every((r) => r.status === 'satisfied')).toBe(true);

    const performance = material.positions.find((p) => p.requirement_id === PERFORMANCE)!;
    expect(performance.statement).toContain('July 15');
    const nonperformance = material.positions.find((p) => p.requirement_id === NONPERFORMANCE)!;
    expect(nonperformance.statement).toContain('contact form');
    expect(nonperformance.statement).toContain('mobile presentation');

    // Both facts must survive into the canonical readback, not merely the store.
    const readback = renderPartyFormationReadbackV214(h.repository.envelope, 'party_a').document;
    expect(readback).toContain('July 15');
    expect(readback).toContain('contact form');
    expect(readback).toContain('mobile presentation');

    // Attribution stays exact: the opponent's explanation is not the party's
    // own allegation, and the party's own lateness is not the opponent's.
    const opponentPosition = material.positions.find(
      (p) => p.requirement_id === 'req_party_a_other_party_position',
    )!;
    expect(opponentPosition.position_id).not.toBe(nonperformance.position_id);
    const ownPerformance = material.positions.find(
      (p) => p.requirement_id === 'req_party_a_own_performance',
    )!;
    expect(ownPerformance.statement).toContain('I was about one week late');
    expect(ownPerformance.position_id).not.toBe(performance.position_id);
  });

  it('reproduces the V2.1.3 defect on V2.1.3 and not on V2.1.4', () => {
    // The V2.1.3 set has no role that could hold either fact. That is the
    // defect, preserved here as the reason V2.1.4 exists.
    const v213Ids = v213Requirements().map((r) => r.requirement_id);
    expect(v213Ids).not.toContain('req_other_party_performance');
    expect(v213Ids).not.toContain('req_other_party_nonperformance');
    const v214Ids = v214Requirements().map((r) => r.requirement_id);
    expect(v214Ids).toContain('req_other_party_performance');
    expect(v214Ids).toContain('req_other_party_nonperformance');
  });
});
