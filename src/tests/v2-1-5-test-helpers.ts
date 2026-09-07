import { ModelSemanticCompilerV04 } from '../webmcp/compiler-v0-4/model-compiler.js';
import type { CompilerInput } from '../webmcp/core-v0-3/compiler-contract.js';
import type {
  CompilerScript,
  ScriptedAssertion,
} from '../webmcp/runtime-v0-3/scripted-compiler.js';
import type { CompileOptions } from '../webmcp/runtime-v0-3/compiler-port.js';
import { createInitialProductionDisputeV215 } from '../v2-1-5/production-case-service.js';
import { createV215PartyCaseService } from '../v2-1-5/webmcp-application.js';
import {
  partyAuthorityV215,
  TRUSTED_SYSTEM_AUTHORITY_V215,
  type CaseEnvelopeV215,
  type PartyIdV215,
} from '../v2-1-5/case-envelope.js';
import {
  applyEnvelopeCeremonyCommandV215,
  ceremonyCommandForV215,
  type EnvelopeCeremonyOperationV215,
} from '../v2-1-5/envelope-ceremony.js';
import type { ProductionFormationRepositoryV215 } from '../v2-1-5/production-case-service.js';

let sequence = 0;
export const unique = (label: string) => `${label}_${process.pid}_${++sequence}`;
export const SUBJECT_A = 'subject_v215_a';
export const SUBJECT_B = 'subject_v215_b';
export const req = (name: string, party = 'party_a') => `req_${party}_${name}`;

/** Real qualified prompt/render/parser/contract, with provider bytes scripted. */
export class TestCompilerV215 {
  calls: CompilerInput[] = [];
  beforeModel: (() => Promise<void>) | null = null;
  afterModel: (() => Promise<void>) | null = null;
  private current!: CompilerInput;
  private readonly model: ModelSemanticCompilerV04;
  constructor(public script: CompilerScript = () => ({ verdict: 'no_assertions' })) {
    this.model = new ModelSemanticCompilerV04({
      client: {
        provider_id: 'openai.responses',
        endpoint_sha256: 'ee0291cefbb5b6136483fb38ba9efe9264f9b685d5006c273e293a54b43a1883',
        generate: async () => {
          const result = this.script(this.current);
          if (result.verdict === 'raw')
            throw new Error('Use provider draft mutations for this fixture.');
          const assertions = result.verdict === 'accepted_candidates' ? result.assertions : [];
          return {
            text: JSON.stringify({
              verdict: result.verdict,
              assertions: assertions.map((a) => ({
                requirement_id: a.requirement_id,
                proposed_type: a.type,
                epistemic_strength: a.epistemic_strength,
                statement: a.statement,
                supersedes_candidate: a.supersedes_candidate ?? null,
                citations: [
                  {
                    region: a.region ?? 'answer',
                    message_index: a.region === 'context' ? (a.message_index ?? 0) : null,
                    quote: a.quote,
                  },
                ],
              })),
              rejected_candidates: [],
              clarifications_requested: result.clarifications ?? [],
            }),
            reported_model: 'gpt-5.6-sol',
            usage: null,
          };
        },
      },
      model_id: 'gpt-5.6-sol',
      model_snapshot: null,
      decoding: { temperature: 0, top_p: null, max_output_tokens: 8192, seed: null },
      omit_sampling_params: true,
      retain_raw_output: false,
    });
  }
  get registryEntry() {
    return this.model.registryEntry;
  }
  async compile(input: CompilerInput, options?: CompileOptions) {
    this.current = structuredClone(input);
    this.calls.push(structuredClone(input));
    if (this.beforeModel) {
      const hook = this.beforeModel;
      this.beforeModel = null;
      await hook();
    }
    const output = await this.model.compile(input, options);
    if (this.afterModel) {
      const hook = this.afterModel;
      this.afterModel = null;
      await hook();
    }
    return output;
  }
}

export function assertion(
  requirement: string,
  quote: string,
  extras: Partial<ScriptedAssertion> = {},
): ScriptedAssertion {
  return {
    requirement_id: requirement,
    quote,
    statement: quote,
    type: 'narrative_fact',
    epistemic_strength: 'asserted_confident',
    ...extras,
  };
}

export function ceremony(
  envelope: CaseEnvelopeV215,
  operation: EnvelopeCeremonyOperationV215,
  party?: PartyIdV215,
): CaseEnvelopeV215 {
  const result = applyEnvelopeCeremonyCommandV215({
    envelope,
    command: ceremonyCommandForV215(envelope, unique('command'), operation),
    execution_authority: party
      ? partyAuthorityV215(envelope, party, 'first_party_human')
      : TRUSTED_SYSTEM_AUTHORITY_V215,
  });
  if (result.status !== 'applied') throw new Error(result.message);
  return result.envelope;
}

export function baseEnvelope() {
  return ceremony(
    createInitialProductionDisputeV215({
      authenticated_subject_id: SUBJECT_A,
      client_request_id: unique('start'),
      idempotency_secret: 'isolated-test-secret',
    }),
    {
      type: 'bind_party',
      party_slot: 'party_b',
      authenticated_subject_id: SUBJECT_B,
      binding_event_id: unique('binding_party_b'),
    },
  );
}

export function serviceFor(
  repository: ProductionFormationRepositoryV215,
  compiler: TestCompilerV215,
  party: PartyIdV215 = 'party_a',
) {
  return createV215PartyCaseService({
    authenticated_subject_id: party === 'party_a' ? SUBJECT_A : SUBJECT_B,
    repository,
    compiler,
    review_url: (id) => `https://juryai.test/cases/${id}/review`,
    ids: { next: (kind, p) => unique(`${kind}_${p}`) },
    clock: { now: () => 1788200000000 + sequence++ },
    salts: { next: () => unique('0123456789abcdef_salt') },
  });
}

export async function commandFor(
  service: ReturnType<typeof serviceFor>,
  id: string,
  answer: string,
  targets = [req('other_party_performance')],
  clientId = unique('client'),
) {
  const state = await service.getCaseState({ case_id: id });
  if (!state.ok) throw new Error(state.error.message);
  return {
    case_id: id,
    expected_case_version: state.case.case_version,
    in_reply_to: targets,
    payload: {
      context: [] as { role: 'assistant'; text: string }[],
      answer: { role: 'user' as const, text: answer },
    },
    client_turn_id: clientId,
  };
}
