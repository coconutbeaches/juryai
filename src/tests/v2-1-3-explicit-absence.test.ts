import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EXPLICIT_ABSENCE_EVAL_CORPUS,
  REAL_CANARY_ANSWER,
  matchesExplicitAbsenceReplay,
} from '../v2-1-3/explicit-absence-eval-corpus.js';
import { initialRequirementSet } from '../v2-1-3/initial-requirements.js';
import { initialRequirementSet as oldRequirements } from '../webmcp/runtime/initial-requirements.js';
import {
  isPropositionType as oldType,
  PROPOSITION_TYPES as oldTypes,
} from '../webmcp/core/types.js';
import { isPropositionType } from '../webmcp/core-v0-3/types.js';
import {
  buildCompilerInput,
  validateCompilerOutput,
  COMPILER_CONTRACT_VERSION,
} from '../webmcp/core-v0-3/compiler-contract.js';
import { validateCompilerOutput as oldCompilerValidator } from '../webmcp/core/compiler-contract.js';
import { parseModelDraft as oldParse } from '../webmcp/compiler/parse-draft.js';
import { parseModelDraft } from '../webmcp/compiler-v0-3/parse-draft.js';
import { ModelSemanticCompiler } from '../webmcp/compiler-v0-3/model-compiler.js';
import { fixedModelClient } from '../webmcp/compiler/replay-client.js';
import { computeRequestFingerprint } from '../webmcp/core/idempotency.js';
import { computePayloadCommitment, type SourceTurnRecord } from '../webmcp/core/turns.js';
import { canonicalSerialize, sha256 } from '../v2/case-envelope.js';
import { createInitialProductionDisputeV212 } from '../v2-1-2/production-case-service.js';
import { createInitialProductionDisputeV213 } from '../v2-1-3/production-case-service.js';
import { createInitialCaseEnvelopeV211 } from '../v2-1-1/envelope-ceremony.js';
import { validateCaseEnvelopeV211 } from '../v2-1-1/contract-validator.js';
import { validateCaseEnvelopeV212 } from '../v2-1-2/contract-validator.js';
import { validateCaseEnvelopeV213 } from '../v2-1-3/contract-validator.js';
import { evaluateFormationRequirementV213 } from '../v2-1-3/formation-requirements.js';
import { TRUSTED_SYSTEM_AUTHORITY_V213, type CaseEnvelopeV213 } from '../v2-1-3/case-envelope.js';
import {
  projectPartyFormationV213,
  renderPartyFormationReadbackV213,
} from '../v2-1-3/party-projection.js';
import { createV213PartyCaseService } from '../v2-1-3/webmcp-application.js';
import { deriveFormationReadinessV213 } from '../v2-1-3/formation-readiness.js';
import {
  applyEnvelopeCeremonyCommandV213,
  ceremonyCommandForV213,
} from '../v2-1-3/envelope-ceremony.js';
import { MemoryFormationRepository } from './v2-1-3-memory-repository.js';
import {
  ceremony,
  unique,
  submit,
  answerSpan,
  acknowledge,
  addChallenge,
  respondToChallenge,
} from './v2-1-3-test-helpers.js';
import { decodeCaseStateResponse as decodeOld } from '../webmcp/public-contract.js';
import { decodeCaseStateResponse } from '../webmcp/supported-public-contract.js';
import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';
import { prepare, execute } from './v2-1-3-assurance-test-helpers.js';
import { projectRoot } from './test-helpers.js';

const start = {
  authenticated_subject_id: 'subject_a',
  client_request_id: 'pr7_test',
  idempotency_secret: 'only-local-fixture-secret-0123456789',
};
type Fixture = (typeof EXPLICIT_ABSENCE_EVAL_CORPUS)[number];
function draft(f: Fixture, requirement = f.requirement): string {
  return JSON.stringify({
    verdict: f.type ? 'accepted_candidates' : 'no_assertions',
    assertions: f.type
      ? [
          {
            requirement_id: requirement,
            proposed_type: f.type,
            epistemic_strength: f.strength,
            statement: f.statement,
            supersedes_candidate: null,
            citations: [{ region: 'answer', message_index: null, quote: f.answer }],
          },
        ]
      : [],
    rejected_candidates: [],
    clarifications_requested: [],
  });
}
function input(f: Fixture, compilerId = sha256('fixture')) {
  const payload = { context: [], answer: { role: 'user' as const, text: f.answer } };
  const turn: SourceTurnRecord = {
    turn_id: 'turn_1',
    case_id: 'case_eval',
    case_version_before: 0,
    received_at: '2026-09-04T00:00:00.000Z',
    principal_id: 'subject_a',
    source_channel: 'webmcp_agent_relay',
    relaying_agent: 'test',
    source_language: 'en',
    translation_indicated: false,
    in_reply_to: [f.requirement],
    client_turn_id: 'client_1',
    request_fingerprint: computeRequestFingerprint({
      principal_id: 'subject_a',
      case_id: 'case_eval',
      in_reply_to: [f.requirement],
      payload,
    }),
    payload,
    payload_commitment_salt: 'fixture-salt-0123456789',
    payload_commitment: computePayloadCommitment(payload, 'fixture-salt-0123456789'),
    compile_run_id: 'run_1',
  };
  return buildCompilerInput({
    compile_run_id: 'run_1',
    compiler_version_id: compilerId,
    state: { case_id: 'case_eval', case_version: 0 },
    turn,
    requirements: initialRequirementSet(),
    livePropositions: [],
  });
}

describe('PR 7 explicit absence compiler replay corpus (not live model accuracy)', () => {
  it.each(EXPLICIT_ABSENCE_EVAL_CORPUS)('$id', async (f) => {
    const compiler = new ModelSemanticCompiler({
      client: fixedModelClient(draft(f)),
      model_id: 'offline-fixture',
    });
    const request = input(f, compiler.registryEntry.compiler_version_id);
    const output = await compiler.compile(request);
    expect(validateCompilerOutput(request, output)).toEqual([]);
    expect(matchesExplicitAbsenceReplay(f, output)).toBe(true);
    expect(output.assertions.map((a) => a.proposed_type)).toEqual(f.type ? [f.type] : []);
    if (f.type === 'explicit_absence') expect(output.assertions[0]!.spans[0]!.quote).toBe(f.answer);
    expect(compiler.registryEntry.version.schema_version).toBe(COMPILER_CONTRACT_VERSION);
    expect(compiler.registryEntry.version.taxonomy_version).toBe('juryai-p2-v0.3.0');
    expect(sha256(compiler.registryEntry.prompt_text)).toBe(
      compiler.registryEntry.version.prompt_hash,
    );
  });
  it.each(EXPLICIT_ABSENCE_EVAL_CORPUS)(
    'trap: refuses collapsed or fabricated truth-state for $id',
    (f) => {
      const raw = JSON.parse(draft(f));
      raw.verdict = 'accepted_candidates';
      raw.assertions = [
        {
          requirement_id: f.requirement,
          proposed_type:
            f.type === 'explicit_absence'
              ? f.id === 'qualified'
                ? 'explicit_absence'
                : 'non_recollection'
              : 'explicit_absence',
          epistemic_strength:
            f.type === 'explicit_absence' && f.id !== 'qualified'
              ? 'non_recollection'
              : 'asserted_confident',
          statement: f.statement ?? 'The party says no binding deadline existed.',
          supersedes_candidate: null,
          citations: [{ region: 'answer', message_index: null, quote: f.answer }],
        },
      ];
      if (!f.answer) expect(() => parseModelDraft(input(f), JSON.stringify(raw))).toThrow();
      else
        expect(
          matchesExplicitAbsenceReplay(f, parseModelDraft(input(f), JSON.stringify(raw))),
        ).toBe(false);
    },
  );
  it.each(['target-only', 'positive-trap'])(
    'trap: refuses bidirectional date coercion for %s',
    (id) => {
      const fixture = EXPLICIT_ABSENCE_EVAL_CORPUS.find((f) => f.id === id)!;
      const raw = JSON.parse(draft(fixture));
      raw.assertions[0].proposed_type =
        id === 'target-only' ? 'contractual_deadline' : 'target_date';
      expect(
        matchesExplicitAbsenceReplay(fixture, parseModelDraft(input(fixture), JSON.stringify(raw))),
      ).toBe(false);
    },
  );
  it.each([
    'not-json',
    '[]',
    '{}',
    '{"verdict":"fabricate","assertions":[]}',
    '{"verdict":"accepted_candidates","assertions":null}',
  ])('rejects malformed additive provider output %s', (raw) => {
    expect(() => parseModelDraft(input(EXPLICIT_ABSENCE_EVAL_CORPUS[0]), raw)).toThrow();
  });
  it('keeps all historical taxonomy and requirement memberships frozen', () => {
    expect(oldTypes).toHaveLength(15);
    expect(oldType('explicit_absence')).toBe(false);
    expect(isPropositionType('explicit_absence')).toBe(true);
    expect(
      oldRequirements().every((r) => !r.satisfying_types.includes('explicit_absence' as never)),
    ).toBe(true);
    expect(
      initialRequirementSet().every((r) => r.satisfying_types.includes('explicit_absence')),
    ).toBe(true);
    expect(
      initialRequirementSet().find((r) => r.requirement_id === 'req_binding_deadline')!
        .satisfying_types,
    ).not.toContain('target_date');
    expect(
      initialRequirementSet().find((r) => r.requirement_id === 'req_binding_deadline')!
        .satisfying_types,
    ).not.toContain('narrative_fact');
  });
  it('rejects historical inputs and mismatched artifact identities before any provider call', async () => {
    const f = EXPLICIT_ABSENCE_EVAL_CORPUS[0],
      compiler = new ModelSemanticCompiler({
        client: fixedModelClient(draft(f)),
        model_id: 'offline-version-guard',
      });
    const request = input(f, compiler.registryEntry.compiler_version_id),
      output = parseModelDraft(request, draft(f));
    request.input_template_version = 'juryai-compiler-input-v0.2.0';
    expect(validateCompilerOutput(request, output).map((i) => i.code)).toContain(
      'compiler_input_version_mismatch',
    );
    await expect(compiler.compile(request)).rejects.toThrow(/input contract/);
    request.input_template_version = 'juryai-compiler-input-v0.3.0';
    request.compiler_version_id = sha256('different artifact');
    await expect(compiler.compile(request)).rejects.toThrow(/artifact/);
    expect(compiler.telemetry).toEqual([]);
  });
  it('old compiler output validator and provider parser reject the additive type', () => {
    const f = EXPLICIT_ABSENCE_EVAL_CORPUS[0];
    const request = input(f);
    const output = parseModelDraft(request, draft(f));
    expect(oldCompilerValidator(request as never, output as never).map((i) => i.code)).toContain(
      'compiler_type_unknown',
    );
    expect(() => oldParse(request as never, draft(f))).toThrow();
  });
  it.each(['July 1', 'a binding contractual deadline'])(
    'rejects cherry-picked absence source %s',
    (quote) => {
      const f = EXPLICIT_ABSENCE_EVAL_CORPUS[0],
        raw = JSON.parse(draft(f));
      raw.assertions[0].citations[0].quote = quote;
      expect(() => parseModelDraft(input(f), JSON.stringify(raw))).toThrow();
    },
  );
  it.each(['non_recollection', 'declined'])(
    'rejects non-factual absence strength %s',
    (strength) => {
      const f = EXPLICIT_ABSENCE_EVAL_CORPUS[0],
        raw = JSON.parse(draft(f));
      raw.assertions[0].epistemic_strength = strength;
      expect(() => parseModelDraft(input(f), JSON.stringify(raw))).toThrow();
    },
  );
  it('rejects fabricated, assistant-only and unknown-enum output without repairing it', () => {
    const f = EXPLICIT_ABSENCE_EVAL_CORPUS[0];
    for (const mutate of [
      (r: ReturnType<typeof JSON.parse>) =>
        (r.assertions[0].citations[0].quote = 'No invoice exists.'),
      (r: ReturnType<typeof JSON.parse>) => (r.assertions[0].citations[0].region = 'context'),
      (r: ReturnType<typeof JSON.parse>) =>
        (r.assertions[0].proposed_type = 'absence_of_everything'),
      (r: ReturnType<typeof JSON.parse>) => (r.assertions[0].authority = 'human'),
    ]) {
      const raw = JSON.parse(draft(f));
      mutate(raw);
      expect(() => parseModelDraft(input(f), JSON.stringify(raw))).toThrow();
    }
  });
  it('keeps unknown requirement IDs and duplicate assertion slots fail closed', () => {
    const f = EXPLICIT_ABSENCE_EVAL_CORPUS[0],
      request = input(f),
      raw = JSON.parse(draft(f));
    raw.assertions[0].requirement_id = 'req_invented';
    expect(
      validateCompilerOutput(request, parseModelDraft(request, JSON.stringify(raw))).map(
        (i) => i.code,
      ),
    ).toContain('compiler_requirement_unknown');
    raw.assertions[0].requirement_id = f.requirement;
    raw.assertions.push({ ...raw.assertions[0] });
    expect(
      validateCompilerOutput(request, parseModelDraft(request, JSON.stringify(raw))).map(
        (i) => i.code,
      ),
    ).toContain('compiler_assertion_slot_duplicate');
  });
  it('old V2.1.1 and V2.1.2 validators do not acquire the new requirement type', () => {
    const v211 = createInitialCaseEnvelopeV211('dispute_old');
    const v212 = createInitialProductionDisputeV212(start);
    expect(validateCaseEnvelopeV211(v211)).toEqual([]);
    expect(validateCaseEnvelopeV212(v212)).toEqual([]);
    v211.requirements.req_test = {
      requirement_id: 'req_test',
      party_id: 'party_a',
      label: 'test',
      prompt: 'test',
      required: true,
      satisfying_types: ['explicit_absence'] as never,
      min_propositions: 1,
      max_propositions: null,
      adverse_fact_probe: false,
      reopened_from: null,
    };
    Object.values(v212.requirements)[0]!.satisfying_types.push('explicit_absence' as never);
    expect(validateCaseEnvelopeV211(v211).length).toBeGreaterThan(0);
    expect(validateCaseEnvelopeV212(v212).length).toBeGreaterThan(0);
    expect(validateCaseEnvelopeV213(createInitialProductionDisputeV213(start))).toEqual([]);
  });
  it('leaves every historical serialized implementation byte-identical to the required base', () => {
    const snapshot = JSON.parse(
      readFileSync(`${projectRoot}/src/fixtures/pr7-frozen-contract-hashes.json`, 'utf8'),
    );
    expect(snapshot.base_sha).toBe('f4a663f5d22c2f2ce6498cdd087a0b8be1f72810');
    for (const [name, hash] of Object.entries(snapshot.files))
      expect(sha256(readFileSync(`${projectRoot}/${name}`, 'utf8')), name).toBe(hash);
  });
});

async function canaryRegression(): Promise<CaseEnvelopeV213> {
  let envelope = createInitialProductionDisputeV213({
    ...start,
    client_request_id: unique('start'),
  });
  envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V213, {
    type: 'bind_party',
    party_slot: 'party_b',
    authenticated_subject_id: 'subject_b',
    binding_event_id: unique('binding_party_b'),
  });
  for (const definition of Object.values(envelope.requirements)) {
    if (definition.requirement_id === 'req_party_b_binding_deadline') continue;
    const answer = definition.requirement_id.endsWith('expected_date')
      ? 'July 1 was my target date.'
      : `My answer to ${definition.requirement_id}.`;
    envelope = submit(
      envelope,
      definition.party_id,
      { context: [], answer: { role: 'user', text: answer } },
      [definition.requirement_id],
      (turnId) => [
        {
          type: 'semantic_assertion_candidate',
          compiler_assertion_id: unique('assertion'),
          requirement_id: definition.requirement_id,
          proposed_type: definition.satisfying_types[0]!,
          epistemic_strength: 'asserted_confident',
          statement: answer,
          spans: [answerSpan(turnId, answer)],
          supersedes_candidate: null,
        },
      ],
    );
  }
  const repository = new MemoryFormationRepository(envelope);
  const compiler = new ModelSemanticCompiler({
    client: fixedModelClient(
      draft(EXPLICIT_ABSENCE_EVAL_CORPUS[0], 'req_party_b_binding_deadline' as never),
    ),
    model_id: 'offline-canary-replay',
  });
  const service = createV213PartyCaseService({
    authenticated_subject_id: 'subject_b',
    repository,
    compiler,
    review_url: (id) => `https://juryai.test/cases/${id}/review`,
  });
  const before = await service.getCaseState({ case_id: envelope.control.case_id });
  expect(before.ok && before.case.unresolved_requirement_count).toBe(1);
  const result = await service.submitTurn({
    case_id: envelope.control.case_id,
    expected_case_version: envelope.control.party_views.party_b.party_visible_version,
    in_reply_to: ['req_party_b_binding_deadline'],
    payload: { context: [], answer: { role: 'user', text: REAL_CANARY_ANSWER } },
    client_turn_id: 'exact_real_canary_answer',
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw Error(result.error.message);
  expect(result.case.unresolved_requirement_count).toBe(0);
  expect(result.case.open_clarifications).toEqual([]);
  expect(result.recorded.map((p) => p.type)).toEqual(['explicit_absence']);
  expect(decodeCaseStateResponse(result.case)).toEqual(result.case);
  expect(() => decodeOld(result.case)).toThrow();
  expect(
    createJuryAiToolDefinitions({
      ...service,
      startCase: async () => ({ ok: true, case: result.case }),
    }).map((t) => t.name),
  ).toEqual(['start_case', 'get_case_state', 'submit_turn']);
  return repository.envelope;
}

describe('PR 7 exact real-canary regression and full P2 readiness', () => {
  it('does not expose a P3 operation even to the trusted domain ceremony', () => {
    const envelope = createInitialProductionDisputeV213(start);
    for (const type of ['adjudicate', 'render_verdict', 'execute_settlement', 'lock_case']) {
      const result = applyEnvelopeCeremonyCommandV213({
        envelope,
        execution_authority: TRUSTED_SYSTEM_AUTHORITY_V213,
        command: {
          ...ceremonyCommandForV213(envelope, 'command_no_p3', {
            type: 'open_controlled_disclosure',
          }),
          operation: { type } as never,
        },
      });
      expect(result.status).toBe('rejected');
    }
  });
  it('records explicit absence, preserves the target, and reaches bilateral HHC-3 readiness under V2.1.3', async () => {
    let envelope = await canaryRegression();
    const positions = Object.values(envelope.positions);
    const absence = positions.find((p) => p.requirement_id === 'req_party_b_binding_deadline')!;
    expect(absence.proposition_type).toBe('explicit_absence');
    expect(absence.source_span_commitments[0]!.quote_hash).toBe(sha256(REAL_CANARY_ANSWER));
    expect(
      positions.find((p) => p.requirement_id === 'req_party_b_expected_date')!.proposition_type,
    ).toBe('target_date');
    expect(renderPartyFormationReadbackV213(envelope, 'party_b').document).toContain(
      'explicit_absence',
    );
    expect(projectPartyFormationV213(envelope, 'party_a').opponent_material).toBeNull();
    envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V213, {
      type: 'open_controlled_disclosure',
    });
    const target = positions.find((p) => p.requirement_id === 'req_party_a_binding_deadline')!;
    envelope = addChallenge(envelope, target.position_id);
    envelope = respondToChallenge(envelope);
    envelope = acknowledge(acknowledge(envelope, 'party_a'), 'party_b');
    envelope = ceremony(envelope, TRUSTED_SYSTEM_AUTHORITY_V213, {
      type: 'enter_final_confirmation',
    });
    for (const party of ['party_a', 'party_b'] as const) {
      const prepared = prepare(envelope, party, 'confirm_case_account');
      expect(prepared.action_payload.ceremony_command.command_version).toBe(
        'juryai-envelope-command-v2.1.3',
      );
      const confirmed = execute(envelope, party, prepared, 'confirm_case_account');
      expect(confirmed.status).toBe('applied');
      if (confirmed.status !== 'applied') throw Error(confirmed.message);
      envelope = confirmed.envelope;
      expect(envelope.formation.confirmations[party][0]!.confirmation_version).toBe(
        'juryai-party-confirmation-v2.1.3',
      );
      expect(envelope.formation.confirmations[party][0]!.party_projection_version).toBe(
        'juryai-party-formation-projection-v2.1.3',
      );
    }
    expect(deriveFormationReadinessV213(envelope).ready_for_bilateral_lock).toBe(true);
    expect(validateCaseEnvelopeV213(envelope)).toEqual([]);
  });
  it('satisfaction uses exact requirement ID and cardinality, never global absence or a target date', async () => {
    const envelope = await canaryRegression();
    const definition = envelope.requirements.req_party_b_binding_deadline!;
    const position = Object.values(envelope.positions).find(
      (p) => p.requirement_id === definition.requirement_id,
    )!;
    position.requirement_id = 'req_party_b_paid';
    expect(evaluateFormationRequirementV213(envelope, definition).status).toBe('unsatisfied');
    position.requirement_id = definition.requirement_id;
    position.proposition_type = 'target_date';
    expect(evaluateFormationRequirementV213(envelope, definition).status).toBe('unsatisfied');
    position.proposition_type = 'explicit_absence';
    definition.max_propositions = 1;
    envelope.positions.position_duplicate = { ...position, position_id: 'position_duplicate' };
    expect(evaluateFormationRequirementV213(envelope, definition).status).toBe('unsatisfied');
  });
});
