import { describe, expect, it } from 'vitest';
import {
  ATTESTATION_CONTRACT_VERSION,
  adoptionStatementFor,
  type CaseState,
} from '../webmcp/core/attestation.js';
import { validateCaseState } from '../webmcp/core/structural-validator.js';
import { computePayloadCommitment, type SourceTurnRecord } from '../webmcp/core/turns.js';
import { sha256 } from '../webmcp/core/types.js';
import {
  CaseRuntime,
  InMemoryCaseRuntimeStore,
  ScriptedSemanticCompiler,
  sequentialIdFactory,
  sequentialSaltFactory,
  steppingClock,
  type RuntimeRequestContext,
} from '../webmcp/runtime/index.js';
import {
  JURYAI_P2_DISCLOSURE_VERSION,
  JuryAiWebServer,
  hashSessionToken,
  type JuryAiWebServerConfig,
  type WebSessionPersistence,
  type WebSessionRecord,
} from '../webmcp/server/index.js';

const SUBJECT = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL = `supabase:${SUBJECT}`;
const RAW_SESSION = 'S'.repeat(43);
const NOW_MS = Date.parse('2026-08-31T10:00:00.000Z');
const CONFIG: JuryAiWebServerConfig = {
  publicOrigin: 'https://juryai.test',
  databaseUrl: 'postgresql://unused',
  supabaseUrl: 'https://project.supabase.co',
  supabasePublishableKey: 'publishable',
  production: true,
  cookie: { name: '__Host-juryai_session', secure: true },
};

class SessionStore implements WebSessionPersistence {
  readonly session: WebSessionRecord = {
    session_id_hash: hashSessionToken(RAW_SESSION),
    principal_id: PRINCIPAL,
    auth_provider: 'supabase',
    auth_subject: SUBJECT,
    created_at: new Date(NOW_MS - 1_000),
    expires_at: new Date(NOW_MS + 60_000),
    revoked_at: null,
  };
  accepted = true;

  async createSession(): Promise<void> {}
  async findActiveSession(hash: string): Promise<WebSessionRecord | null> {
    return hash === this.session.session_id_hash ? structuredClone(this.session) : null;
  }
  async revokeSession(): Promise<void> {}
  async hasDisclosureAcceptance(_principal: string, version: string): Promise<boolean> {
    return this.accepted && version === JURYAI_P2_DISCLOSURE_VERSION;
  }
  async acceptDisclosure(): Promise<void> {
    this.accepted = true;
  }
}

function readyState(caseId = 'case_step64'): CaseState {
  const payload = { context: [], answer: { role: 'user' as const, text: 'The initial account.' } };
  const salt = 'salt_initial';
  const source: SourceTurnRecord = {
    turn_id: 'turn_initial',
    case_id: caseId,
    case_version_before: 0,
    received_at: '2026-08-31T09:00:00.000Z',
    principal_id: PRINCIPAL,
    source_channel: 'webmcp_agent_relay',
    relaying_agent: 'ChatGPT',
    source_language: 'en',
    translation_indicated: false,
    in_reply_to: ['req_account'],
    client_turn_id: 'client_initial',
    request_fingerprint: 'a'.repeat(64),
    payload,
    payload_commitment_salt: salt,
    payload_commitment: computePayloadCommitment(payload, salt),
    compile_run_id: 'run_initial',
  };
  return {
    case_id: caseId,
    case_version: 1,
    principal_id: PRINCIPAL,
    disclosure_version: JURYAI_P2_DISCLOSURE_VERSION,
    disclosure_accepted_at: '2026-08-31T08:59:00.000Z',
    requirements: [
      {
        requirement_id: 'req_account',
        prompt: 'What account are you giving JuryAI?',
        satisfying_types: ['narrative_fact', 'non_recollection', 'declined_to_answer'],
        min_propositions: 1,
        max_propositions: null,
        adverse_fact_probe: false,
        reopened_from: null,
      },
    ],
    propositions: [
      {
        proposition_id: 'prop_initial',
        case_id: caseId,
        type: 'narrative_fact',
        epistemic_strength: 'asserted_qualified',
        statement: 'The initial account is recorded.',
        in_reply_to: 'req_account',
        derived_from_turn_ids: ['turn_initial'],
        spans: [
          {
            turn_id: 'turn_initial',
            region: 'answer',
            message_index: null,
            encoding: 'utf16',
            start: 0,
            end: 7,
            quote: 'The ini',
          },
        ],
        source_channel: 'webmcp_agent_relay',
        relaying_agent: 'ChatGPT',
        supersedes: null,
        superseded_by: null,
        superseded_at_case_version: null,
        created_at_case_version: 1,
        compile_run_id: 'run_initial',
        compiler_version_id: 'b'.repeat(64),
        evidence_ref_id: null,
      },
    ],
    clarifications: [],
    evidence_references: [],
    turn_log: [source],
    attestations: [],
  };
}

interface Harness {
  server: JuryAiWebServer;
  store: InMemoryCaseRuntimeStore;
  compiler: ScriptedSemanticCompiler;
  runtime: CaseRuntime;
  caseId: string;
}

async function harness(caseId = 'case_step64'): Promise<Harness> {
  const store = new InMemoryCaseRuntimeStore();
  const initial = readyState(caseId);
  expect(validateCaseState(initial).ok).toBe(true);
  await store.createCase({
    state: initial,
    idempotency: {
      principal_id: PRINCIPAL,
      client_request_id: `start_${caseId}`,
      case_id: caseId,
      recorded_at_ms: NOW_MS - 2_000,
    },
  });
  const compiler = new ScriptedSemanticCompiler((input) => ({
    verdict: 'accepted_candidates',
    assertions: [
      {
        quote: input.turn.payload.answer.text,
        requirement_id: 'req_account',
        type:
          input.turn.payload.answer.text === "I don't remember."
            ? 'non_recollection'
            : 'narrative_fact',
        epistemic_strength:
          input.turn.payload.answer.text === "I don't remember."
            ? 'non_recollection'
            : 'asserted_qualified',
        statement: input.turn.payload.answer.text,
        supersedes_candidate: 'prop_initial',
      },
    ],
  }));
  const runtime = new CaseRuntime({
    store,
    compiler,
    clock: steppingClock(NOW_MS, 1),
    ids: sequentialIdFactory('step64_'),
    salts: sequentialSaltFactory('step64_salt'),
    reviewUrl: (id) => `${CONFIG.publicOrigin}/cases/${id}/review`,
    disclosure: { version: JURYAI_P2_DISCLOSURE_VERSION },
  });
  let challengeSequence = 0;
  let attestationSequence = 0;
  const sessionStore = new SessionStore();
  const server = new JuryAiWebServer({
    config: CONFIG,
    persistence: sessionStore,
    authForRequest: () => ({
      requestEmailOtp: async () => undefined,
      verifyEmailOtp: async () => SUBJECT,
    }),
    runtime: () => runtime,
    caseStore: () => store,
    now: () => new Date(NOW_MS + 10_000),
    challengeTokenFactory: () => {
      challengeSequence += 1;
      return `C${String(challengeSequence).padStart(42, '0')}`;
    },
    attestationIdFactory: () => {
      attestationSequence += 1;
      return `att_step64_${attestationSequence}`;
    },
  });
  return { server, store, compiler, runtime, caseId };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function cookie(): string {
  return `${CONFIG.cookie.name}=${RAW_SESSION}`;
}

function get(path: string, withCookie = true): Request {
  return new Request(`${CONFIG.publicOrigin}${path}`, {
    headers: withCookie ? { Cookie: cookie() } : {},
  });
}

function post(path: string, body: unknown, origin = CONFIG.publicOrigin): Request {
  return new Request(`${CONFIG.publicOrigin}${path}`, {
    method: 'POST',
    headers: { Cookie: cookie(), Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function review(h: Harness): Promise<Record<string, unknown>> {
  const response = await h.server.reviewCase(get(`/api/juryai/cases/${h.caseId}/review`), h.caseId);
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

function correctionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expected_case_version: 1,
    in_reply_to: ['req_account'],
    client_turn_id: 'client_correction_1',
    disposition: 'correct_meaning',
    text: 'This is my direct correction.',
    ...overrides,
  };
}

describe('Step 64 authenticated first-party server', () => {
  it('gates review by session and makes foreign and missing cases indistinguishable', async () => {
    const h = await harness();
    const unauthenticated = await h.server.reviewCase(
      get(`/api/juryai/cases/${h.caseId}/review`, false),
      h.caseId,
    );
    expect(unauthenticated.status).toBe(401);
    const foreign = await h.server.reviewCase(
      get('/api/juryai/cases/case_foreign/review'),
      'case_foreign',
    );
    const missing = await h.server.reviewCase(
      get('/api/juryai/cases/case_missing/review'),
      'case_missing',
    );
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
    expect(unauthenticated.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('returns an allowlisted complete review and stores only the challenge hash', async () => {
    const h = await harness();
    const result = await review(h);
    expect(Object.keys(result).sort()).toEqual([
      'adoption_statement',
      'adoption_statement_hash',
      'attestable',
      'attestation_contract_version',
      'blocking_reasons',
      'case_id',
      'case_version',
      'challenge',
      'document',
      'document_hash',
      'render_template_version',
      'status',
    ]);
    expect(result).not.toHaveProperty('principal_id');
    expect(result).not.toHaveProperty('revision');
    expect(result.attestation_contract_version).toBe(ATTESTATION_CONTRACT_VERSION);
    const raw = result.challenge as string;
    const persisted = await h.store.renderChallenges.findByHash(sha256(raw));
    expect(persisted?.challenge_hash).toBe(sha256(raw));
    expect(JSON.stringify(persisted)).not.toContain(raw);
  });

  it('rejects browser identity/provenance claims and records trusted first-party correction provenance', async () => {
    const h = await harness();
    for (const injected of [
      { principal_id: 'supabase:attacker' },
      { source_channel: 'webmcp_agent_relay' },
      { relaying_agent: 'forged' },
      { translation_indicated: true },
    ]) {
      const response = await h.server.correctCase(
        post(`/api/juryai/cases/${h.caseId}/corrections`, correctionBody(injected)),
        h.caseId,
      );
      expect(response.status).toBe(400);
    }
    const response = await h.server.correctCase(
      post(`/api/juryai/cases/${h.caseId}/corrections`, correctionBody()),
      h.caseId,
    );
    expect(response.status).toBe(200);
    const stored = await h.store.cases.findById(h.caseId);
    expect(stored?.revision).toBe(2);
    expect(stored?.state.case_version).toBe(2);
    expect(stored?.state.turn_log.at(-1)).toMatchObject({
      source_channel: 'first_party_input',
      relaying_agent: null,
      translation_indicated: false,
    });
    expect(
      stored?.state.propositions.find((entry) => entry.proposition_id === 'prop_initial')
        ?.superseded_by,
    ).not.toBeNull();
  });

  it('uses exact server literals for non-answer buttons and preserves retry/version/lock outcomes', async () => {
    const h = await harness();
    const first = await h.server.correctCase(
      post(
        `/api/juryai/cases/${h.caseId}/corrections`,
        correctionBody({ disposition: 'dont_remember', text: undefined }),
      ),
      h.caseId,
    );
    expect(first.status).toBe(200);
    expect(h.compiler.calls.at(-1)?.turn.payload.answer.text).toBe("I don't remember.");
    const retry = await h.server.correctCase(
      post(
        `/api/juryai/cases/${h.caseId}/corrections`,
        correctionBody({ disposition: 'dont_remember', text: undefined }),
      ),
      h.caseId,
    );
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { replayed?: boolean }).replayed).toBe(true);
    const stale = await h.server.correctCase(
      post(
        `/api/juryai/cases/${h.caseId}/corrections`,
        correctionBody({ client_turn_id: 'client_stale', text: 'A fresh stale write.' }),
      ),
      h.caseId,
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe(
      'VERSION_CONFLICT',
    );
  });

  it('opens and resolves a same-requirement clarification first-party without reopened requirement ids', async () => {
    const h = await harness();
    h.compiler.setScript(() => ({
      verdict: 'ambiguous',
      clarifications: [
        {
          requirement_id: 'req_account',
          reason: 'contradicts_existing_proposition',
          prompt: 'Does this replace the earlier account?',
        },
      ],
    }));
    const opened = await h.server.correctCase(
      post(`/api/juryai/cases/${h.caseId}/corrections`, correctionBody()),
      h.caseId,
    );
    expect(opened.status).toBe(200);
    let stored = (await h.store.cases.findById(h.caseId))!;
    expect(stored.state.case_version).toBe(2);
    expect(stored.state.clarifications).toHaveLength(1);
    expect(stored.state.clarifications[0]).toMatchObject({
      requirement_id: 'req_account',
      resolved_at_case_version: null,
      reopened_as: null,
    });
    const blockedReview = await review(h);
    expect(blockedReview).toMatchObject({
      attestable: false,
      challenge: null,
      blocking_reasons: expect.arrayContaining(['open_clarifications']),
    });
    h.compiler.setScript((input) => ({
      verdict: 'accepted_candidates',
      assertions: [
        {
          quote: input.turn.payload.answer.text,
          requirement_id: 'req_account',
          type: 'narrative_fact',
          epistemic_strength: 'asserted_confident',
          statement: input.turn.payload.answer.text,
          supersedes_candidate: 'prop_initial',
        },
      ],
    }));
    const resolved = await h.server.correctCase(
      post(
        `/api/juryai/cases/${h.caseId}/corrections`,
        correctionBody({
          expected_case_version: 2,
          client_turn_id: 'client_clarification_answer',
          disposition: 'resolve_clarification',
          text: 'Yes, this replaces the earlier account.',
        }),
      ),
      h.caseId,
    );
    expect(resolved.status).toBe(200);
    stored = (await h.store.cases.findById(h.caseId))!;
    expect(stored.state.case_version).toBe(3);
    expect(stored.state.clarifications[0]).toMatchObject({
      resolved_at_case_version: 3,
      reopened_as: null,
    });
    expect(stored.state.requirements).toHaveLength(1);
    expect(stored.state.requirements[0]?.reopened_from).toBeNull();
  });

  it('atomically appends exact bytes/adoption, increments revision only, locks, and replays duplicates', async () => {
    const h = await harness();
    const rendered = await review(h);
    const request = post(`/api/juryai/cases/${h.caseId}/attestations`, {
      challenge: rendered.challenge,
      rendered_document_hash: rendered.document_hash,
    });
    const response = await h.server.attestCase(request, h.caseId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { attestation_id: string; replayed: boolean };
    expect(body.replayed).toBe(false);
    const stored = await h.store.cases.findById(h.caseId);
    expect(stored?.revision).toBe(2);
    expect(stored?.state.case_version).toBe(1);
    expect(stored?.state.attestations).toHaveLength(1);
    const attestation = stored!.state.attestations[0]!;
    expect(attestation.rendered_document).toBe(rendered.document);
    expect(attestation.adoption_statement).toBe(adoptionStatementFor(readyState(h.caseId)));
    expect(sha256(attestation.adoption_statement)).toBe(attestation.adoption_statement_hash);
    const retry = await h.server.attestCase(
      post(`/api/juryai/cases/${h.caseId}/attestations`, {
        challenge: rendered.challenge,
        rendered_document_hash: rendered.document_hash,
      }),
      h.caseId,
    );
    expect(await retry.json()).toMatchObject({
      ok: true,
      replayed: true,
      attestation_id: body.attestation_id,
    });
  });

  it('rejects stale render after a correction and never consumes its challenge', async () => {
    const h = await harness();
    const rendered = await review(h);
    await h.server.correctCase(
      post(`/api/juryai/cases/${h.caseId}/corrections`, correctionBody()),
      h.caseId,
    );
    const stale = await h.server.attestCase(
      post(`/api/juryai/cases/${h.caseId}/attestations`, {
        challenge: rendered.challenge,
        rendered_document_hash: rendered.document_hash,
      }),
      h.caseId,
    );
    expect(stale.status).toBe(409);
    expect(
      (await h.store.renderChallenges.findByHash(sha256(rendered.challenge as string)))
        ?.consumed_at_ms,
    ).toBeNull();
  });

  it('race B: relay and first-party correction share CAS and only one commits from the version', async () => {
    const h = await harness();
    const bothArrived = deferred();
    const release = deferred();
    let arrivals = 0;
    const compile = h.compiler.compile.bind(h.compiler);
    h.compiler.compile = async (input, options) => {
      arrivals += 1;
      if (arrivals === 2) bothArrived.resolve();
      await release.promise;
      return compile(input, options);
    };
    const relay: RuntimeRequestContext = {
      principal: { principal_id: PRINCIPAL },
      source_channel: 'webmcp_agent_relay',
      relaying_agent: 'Relay Y',
    };
    const firstParty = h.server.correctCase(
      post(`/api/juryai/cases/${h.caseId}/corrections`, correctionBody()),
      h.caseId,
    );
    const relayed = h.runtime.submitTurn(relay, {
      case_id: h.caseId,
      expected_case_version: 1,
      in_reply_to: ['req_account'],
      payload: { context: [], answer: { role: 'user', text: 'A concurrent relayed correction.' } },
      client_turn_id: 'client_concurrent_relay',
      translation_indicated: false,
    });
    await bothArrived.promise;
    release.resolve();
    const [firstPartyResponse, relayOutcome] = await Promise.all([firstParty, relayed]);
    const committedCount =
      (firstPartyResponse.status === 200 ? 1 : 0) + (relayOutcome.kind === 'committed' ? 1 : 0);
    expect(committedCount).toBe(1);
    if (firstPartyResponse.status === 200) {
      expect(relayOutcome.kind).toBe('version_conflict');
    } else {
      expect(firstPartyResponse.status).toBe(409);
      expect(relayOutcome.kind).toBe('committed');
    }
    const stored = await h.store.cases.findById(h.caseId);
    expect(stored?.revision).toBe(2);
    expect(stored?.state.turn_log).toHaveLength(2);
  });

  it('race C: when attestation wins, an in-flight correction re-resolves to CASE_LOCKED', async () => {
    const h = await harness();
    const rendered = await review(h);
    const compileStarted = deferred();
    const release = deferred();
    const compile = h.compiler.compile.bind(h.compiler);
    h.compiler.compile = async (input, options) => {
      compileStarted.resolve();
      await release.promise;
      return compile(input, options);
    };
    const correction = h.server.correctCase(
      post(`/api/juryai/cases/${h.caseId}/corrections`, correctionBody()),
      h.caseId,
    );
    await compileStarted.promise;
    const attestation = await h.server.attestCase(
      post(`/api/juryai/cases/${h.caseId}/attestations`, {
        challenge: rendered.challenge,
        rendered_document_hash: rendered.document_hash,
      }),
      h.caseId,
    );
    release.resolve();
    const correctionResponse = await correction;
    expect(attestation.status).toBe(200);
    expect(correctionResponse.status).toBe(409);
    expect(((await correctionResponse.json()) as { error: { code: string } }).error.code).toBe(
      'CASE_LOCKED',
    );
    const stored = await h.store.cases.findById(h.caseId);
    expect(stored?.state.attestations).toHaveLength(1);
    expect(stored?.state.turn_log).toHaveLength(1);
  });

  it('converges two concurrent identical attestations on one append and one identical replay', async () => {
    const h = await harness();
    const rendered = await review(h);
    const submit = () =>
      h.server.attestCase(
        post(`/api/juryai/cases/${h.caseId}/attestations`, {
          challenge: rendered.challenge,
          rendered_document_hash: rendered.document_hash,
        }),
        h.caseId,
      );
    const responses = await Promise.all([submit(), submit()]);
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{
      attestation_id: string;
      replayed: boolean;
    }>;
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(bodies.map((body) => body.replayed).sort()).toEqual([false, true]);
    expect(new Set(bodies.map((body) => body.attestation_id)).size).toBe(1);
    expect((await h.store.cases.findById(h.caseId))?.state.attestations).toHaveLength(1);
  });

  it('keeps a committed retry replayable after lock while a genuinely fresh correction returns CASE_LOCKED', async () => {
    const h = await harness();
    const committedRequest = correctionBody();
    await h.server.correctCase(
      post(`/api/juryai/cases/${h.caseId}/corrections`, committedRequest),
      h.caseId,
    );
    const rendered = await review(h);
    await h.server.attestCase(
      post(`/api/juryai/cases/${h.caseId}/attestations`, {
        challenge: rendered.challenge,
        rendered_document_hash: rendered.document_hash,
      }),
      h.caseId,
    );
    const replay = await h.server.correctCase(
      post(`/api/juryai/cases/${h.caseId}/corrections`, committedRequest),
      h.caseId,
    );
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { replayed?: boolean }).replayed).toBe(true);
    const fresh = await h.server.correctCase(
      post(
        `/api/juryai/cases/${h.caseId}/corrections`,
        correctionBody({
          expected_case_version: 2,
          client_turn_id: 'client_fresh_after_lock',
          text: 'A genuinely fresh write.',
        }),
      ),
      h.caseId,
    );
    expect(fresh.status).toBe(409);
    expect(((await fresh.json()) as { error: { code: string } }).error.code).toBe('CASE_LOCKED');
    const nextCase = await h.runtime.startCase(
      {
        principal: { principal_id: PRINCIPAL },
        source_channel: 'webmcp_agent_relay',
        relaying_agent: null,
      },
      { client_request_id: 'start_after_locked_case' },
    );
    expect(nextCase.kind).toBe('created');
    if (nextCase.kind === 'created') expect(nextCase.case.case_id).not.toBe(h.caseId);
  });

  it('requires exact same origin for both first-party POST endpoints', async () => {
    const h = await harness();
    expect(
      (
        await h.server.correctCase(
          post(
            `/api/juryai/cases/${h.caseId}/corrections`,
            correctionBody(),
            'https://foreign.test',
          ),
          h.caseId,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await h.server.attestCase(
          post(`/api/juryai/cases/${h.caseId}/attestations`, {}, 'https://foreign.test'),
          h.caseId,
        )
      ).status,
    ).toBe(403);
  });
});
