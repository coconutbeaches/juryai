import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, sha256 } from '../v2/case-envelope.js';
import { createRelayRuntimeMinter } from '../formation/relay-runtime.js';
import { assertValidGenerationSpec } from '../formation/generation-spec.js';
import { createFormationValidator } from '../formation/validator.js';
import { createFormationRelay } from '../formation/relay-submission.js';
import { V215_SPEC } from '../v2-1-5/generation-spec.js';
import {
  initialRequirementSet,
  assertRequirementArtifact,
  exactPersistedRequirements,
  assertPersistedRequirementArtifact,
} from '../v2-1-5/initial-requirements.js';
import { relay, ceremony } from '../v2-1-5/engine.js';
import { validator, validateCaseEnvelopeV215 } from '../v2-1-5/contract-validator.js';
import { partyAuthorityV215, hashCaseEnvelopeV215 } from '../v2-1-5/case-envelope.js';
import { refreshPartyViewCursorsV215 } from '../v2-1-5/envelope-ceremony.js';
import { assertQualifiedCompiler } from '../v2-1-5/compiler-contract.js';
import { createProductionCompilerV215 } from '../v2-1-5/production-compiler.js';
import { createV215PartyCaseService } from '../v2-1-5/webmcp-application.js';
import { ScriptedSemanticCompiler } from '../webmcp/runtime-v0-3/scripted-compiler.js';
import { createJuryAiToolDefinitions } from '../webmcp/tools/definitions.js';
import {
  TestCompilerV215,
  assertion,
  baseEnvelope,
  commandFor,
  req,
  serviceFor,
} from './v2-1-5-test-helpers.js';
import { MemoryFormationRepository } from './v2-1-5-memory-repository.js';
import { projectRoot } from './test-helpers.js';
import { V215_FROZEN_TREES } from './v2-1-5-frozen-trees.js';

function files(directory: string): string[] {
  return readdirSync(resolve(projectRoot, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? files(path) : [path];
    })
    .sort();
}
const read = (path: string) => readFileSync(resolve(projectRoot, path), 'utf8');

describe('8C2 immutable identities and fail-closed admission guards', () => {
  it.each(Object.entries(V215_FROZEN_TREES))(
    '%s remains byte-frozen including its path inventory',
    (root, expected) => {
      const hash = createHash('sha256');
      for (const file of files(root))
        hash
          .update(file)
          .update('\0')
          .update(readFileSync(resolve(projectRoot, file)))
          .update('\0');
      expect(hash.digest('hex')).toBe(expected);
    },
  );

  it('only V2.1.5 explicitly opts into V0.4, multi-live, broad own scope and immutable minted runtime identity', () => {
    expect(V215_SPEC.compiler.contract_version).toBe('juryai-webmcp-compiler-contract-v0.4.0');
    expect(V215_SPEC.policy).toEqual({
      proposition_cardinality: 'multi_live',
      assertion_requirement_scope: 'all_own_requirements',
    });
    expect(read('src/v2-1-5/engine.ts')).toContain("'frozen_minted_identity'");
    const importing = [
      'src/formation',
      'src/v2-1-1',
      'src/v2-1-2',
      'src/v2-1-3',
      'src/v2-1-4',
      'src/v2-1-5',
      'src/webmcp/server',
      'src/webmcp/browser',
      'api',
    ]
      .flatMap(files)
      .filter((file) => /from\s+['"][^'"]*compiler-v0-4\//u.test(read(file)));
    expect(importing).toEqual(['src/v2-1-5/production-compiler.ts']);
  });

  it.each(['proposition_cardinality', 'assertion_requirement_scope'] as const)(
    'unknown %s policy fails closed in spec, validator and relay constructors',
    (key) => {
      const bad = structuredClone(V215_SPEC);
      (bad.policy as unknown as Record<string, string>)[key] = 'unknown_policy';
      expect(() => assertValidGenerationSpec(bad)).toThrow(/recognised policy/);
      expect(() => createFormationValidator({ spec: bad })).toThrow();
      expect(() =>
        createFormationRelay({ spec: bad, validator, cursors: ceremony.refreshPartyViewCursors }),
      ).toThrow();
    },
  );

  it('exact requirement content, including finite maxima, is load-bearing in the generation binding', () => {
    const original = initialRequirementSet();
    expect(sha256(canonicalSerialize(original))).toBe(V215_SPEC.requirements.artifact_hash);
    expect(() => assertRequirementArtifact(original)).not.toThrow();
    for (const mutate of [
      (d: typeof original) => {
        d[0]!.prompt += ' Changed.';
      },
      (d: typeof original) => {
        d[0]!.max_propositions = 1;
      },
      (d: typeof original) => {
        d[0]!.satisfying_types.push('payment');
      },
      (d: typeof original) => {
        d.pop();
      },
    ]) {
      const changed = structuredClone(original);
      mutate(changed);
      expect(() => assertRequirementArtifact(changed)).toThrow(/generation binding/);
      expect(sha256(canonicalSerialize(changed))).not.toBe(V215_SPEC.requirements.artifact_hash);
    }
    original[0]!.prompt = 'mutable caller copy';
    expect(() => assertRequirementArtifact(initialRequirementSet())).not.toThrow();
    expect(Object.isFrozen(V215_SPEC.requirements)).toBe(true);
  });

  it('binds the executed requirement mapping including party ownership and required flags', () => {
    const original = exactPersistedRequirements();
    expect(() => assertPersistedRequirementArtifact(original)).not.toThrow();
    expect(sha256(canonicalSerialize(original))).toBe(
      V215_SPEC.requirements.persisted_artifact_hash,
    );
    for (const mutate of [
      (r: typeof original) => {
        r[req('paid')]!.required = false;
      },
      (r: typeof original) => {
        r[req('paid')]!.party_id = 'party_b';
      },
      (r: typeof original) => {
        r[req('paid')]!.max_propositions = 1;
      },
    ]) {
      const changed = structuredClone(original);
      mutate(changed);
      expect(() => assertPersistedRequirementArtifact(changed)).toThrow(/generation binding/);
    }
  });

  it('a persisted requirement mutation with valid restamped hashes fails specifically on artifact binding', () => {
    const before = baseEnvelope(),
      after = structuredClone(before);
    after.requirements[req('paid')]!.max_propositions = 1;
    refreshPartyViewCursorsV215(before, after);
    after.control.envelope_hash = hashCaseEnvelopeV215(after);
    expect(validateCaseEnvelopeV215(after).map((issue) => issue.code)).toEqual([
      'v215_requirement_artifact_mismatch',
    ]);
  });

  it('server runtime cannot be retargeted by direct mutation, nested aliases, spread, prototypes, shadowing or JSON', () => {
    const minter = createRelayRuntimeMinter(V215_SPEC, 'frozen_minted_identity');
    const input = {
      source_channel: 'webmcp_agent_relay' as const,
      relaying_agent: null,
      received_at: '2026-09-01T00:00:00.000Z',
      payload_commitment_salt: '0123456789abcdef',
      ids: {
        submission_id: 'submission_party_a_guard',
        source_turn_id: 'turn_party_a_guard',
        position_ids: ['position_party_a_guard'],
        clarification_ids: [],
        challenge_ids: [],
        challenge_response_ids: [],
      },
    };
    const runtime = minter.mintRuntime(minter.bridge, input);
    expect(minter.isOwnRuntime(runtime)).toBe(true);
    expect(() => {
      (runtime as typeof input).received_at = '1999-01-01T00:00:00.000Z';
    }).toThrow();
    expect(() => runtime.ids.position_ids.push('position_party_b_attack')).toThrow();
    input.ids.position_ids[0] = 'position_party_b_attack';
    expect(runtime.ids.position_ids).toEqual(['position_party_a_guard']);
    const inherited = Object.create(runtime);
    Object.defineProperty(inherited, 'received_at', { value: '1999-01-01T00:00:00.000Z' });
    for (const attack of [
      { ...runtime },
      { ...runtime, payload_commitment_salt: 'attacker' },
      inherited,
      JSON.parse(JSON.stringify(runtime)),
    ])
      expect(minter.isOwnRuntime(attack)).toBe(false);
    expect(() => minter.mintRuntime({ ...minter.bridge }, input)).toThrow(/bridge/);
    expect(
      createRelayRuntimeMinter(V215_SPEC, 'frozen_minted_identity').isOwnRuntime(runtime),
    ).toBe(false);
    expect(() => createRelayRuntimeMinter(V215_SPEC, 'unknown' as never)).toThrow(/Unknown/);
    expect(() =>
      createFormationRelay(
        { spec: V215_SPEC, validator, cursors: ceremony.refreshPartyViewCursors },
        'unknown' as never,
      ),
    ).toThrow(/Unknown/);
  });

  it('production relay prepare refuses tampered runtime provenance before creating a trusted submission', async () => {
    const before = baseEnvelope();
    const repository = new MemoryFormationRepository(before);
    const compiler = new TestCompilerV215(() => ({
      verdict: 'accepted_candidates',
      assertions: [assertion(req('other_party_performance'), 'They delivered late.')],
    }));
    const service = serviceFor(repository, compiler);
    const command = await commandFor(service, before.control.case_id, 'They delivered late.');
    expect((await service.submitTurn(command)).ok).toBe(true);
    const submission = repository.lastCommit!.submission;
    const runtime = relay.mintRuntime(relay.bridge, {
      source_channel: 'webmcp_agent_relay',
      relaying_agent: null,
      received_at: submission.source_turn.received_at,
      payload_commitment_salt: submission.source_turn.payload_commitment_salt,
      ids: {
        submission_id: submission.submission_id,
        source_turn_id: submission.source_turn.turn_id,
        position_ids: [],
        clarification_ids: [],
        challenge_ids: [],
        challenge_response_ids: [],
      },
    });
    const prepare = (candidate: typeof runtime) =>
      relay.prepareExternalRelaySubmission({
        envelope: before,
        execution_authority: partyAuthorityV215(before, 'party_a', 'external_relay'),
        intent: {
          intent_version: V215_SPEC.contracts.external_relay_submission_intent_version,
          expected_party_visible_version: submission.base_party_visible_version,
          expected_party_projection_hash: submission.base_party_projection_hash,
          client_turn_id: command.client_turn_id,
          in_reply_to: command.in_reply_to,
          payload: command.payload,
          source_language: null,
          translation_indicated: false,
        },
        runtime: candidate,
        compiler_run: submission.compiler_run,
        effects: [],
      });
    // Domain permits empty sources historically; the production application refuses them.
    expect(prepare(runtime).status).toBe('prepared');
    expect(prepare({ ...runtime, received_at: '1999-01-01T00:00:00.000Z' })).toMatchObject({
      status: 'rejected',
      reason_code: 'unauthorized_actor',
    });
    expect(prepare(Object.create(runtime))).toMatchObject({
      status: 'rejected',
      reason_code: 'unauthorized_actor',
    });
  });

  it('pins the qualified production compiler before making any call, refusing historical and unqualified identities', () => {
    let calls = 0;
    const compiler = createProductionCompilerV215({
      env: { OPENAI_API_KEY: 'isolated-test-key' },
      fetchImpl: async () => {
        calls++;
        throw new Error('No network allowed');
      },
    });
    expect(compiler.registryEntry.compiler_version_id).toBe(
      '7734c54aa9c85d0bde119db2be79f698416e120566d9186744c070582a76d71c',
    );
    expect(calls).toBe(0);
    expect(() => assertQualifiedCompiler(new ScriptedSemanticCompiler().registryEntry)).toThrow(
      /qualified/,
    );
    const bad = structuredClone(compiler.registryEntry);
    bad.version.model_id = 'unqualified-model';
    expect(() => assertQualifiedCompiler(bad)).toThrow();
    expect(() =>
      createV215PartyCaseService({ compiler: new ScriptedSemanticCompiler() } as never),
    ).toThrow(/qualified/);
  });

  it('keeps exactly the three public tools and excludes semantic matching from admission', () => {
    expect(createJuryAiToolDefinitions({} as never).map((t) => t.name)).toEqual([
      'start_case',
      'get_case_state',
      'submit_turn',
    ]);
    for (const file of [...files('src/formation'), ...files('src/v2-1-5')]) {
      const source = read(file)
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/(^|[^:])\/\/.*$/gmu, '$1');
      expect(source, file).not.toMatch(
        /cosineSimilarity|levenshtein|embedding|semanticDedup|fuzzyMatch/iu,
      );
    }
  });
});
