import { describe, expect, it } from 'vitest';
import {
  adoptionStatementFor,
  issueRenderChallenge,
  parseReadbackDocument,
  renderCanonicalAccount,
  verifyRenderCompleteness,
  type CaseState,
} from '../webmcp/core/attestation.js';
import type { Proposition } from '../webmcp/core/propositions.js';
import type { RequirementDefinition } from '../webmcp/core/requirements.js';
import { computePayloadCommitment, type SourceTurnRecord } from '../webmcp/core/turns.js';
import { RENDER_TEMPLATE_VERSION, sha256 } from '../webmcp/core/types.js';

const payload = { context: [], answer: { role: 'user' as const, text: 'Source answer.' } };

function requirement(id: string, prompt = `Prompt for ${id}.`): RequirementDefinition {
  return {
    requirement_id: id,
    prompt,
    satisfying_types: ['narrative_fact', 'non_recollection', 'declined_to_answer'],
    min_propositions: 1,
    max_propositions: null,
    adverse_fact_probe: false,
    reopened_from: null,
  };
}

function turn(
  id: string,
  source: SourceTurnRecord['source_channel'],
  overrides: Partial<SourceTurnRecord> = {},
): SourceTurnRecord {
  const salt = `salt_${id}`;
  return {
    turn_id: id,
    case_id: 'case_readback',
    case_version_before: 0,
    received_at: '2026-08-31T00:00:00.000Z',
    principal_id: 'user_readback',
    source_channel: source,
    relaying_agent: source === 'webmcp_agent_relay' ? 'Assistant X' : null,
    source_language: 'en',
    translation_indicated: false,
    in_reply_to: ['req_a'],
    client_turn_id: `client_${id}`,
    request_fingerprint: 'a'.repeat(64),
    payload,
    payload_commitment_salt: salt,
    payload_commitment: computePayloadCommitment(payload, salt),
    compile_run_id: `run_${id}`,
    ...overrides,
  };
}

function proposition(
  id: string,
  sourceTurn: SourceTurnRecord,
  overrides: Partial<Proposition> = {},
): Proposition {
  return {
    proposition_id: id,
    case_id: 'case_readback',
    type: 'narrative_fact',
    epistemic_strength: 'asserted_qualified',
    statement: 'I expected completion on April 25, but I was not certain.',
    in_reply_to: sourceTurn.in_reply_to[0]!,
    derived_from_turn_ids: [sourceTurn.turn_id],
    spans: [
      {
        turn_id: sourceTurn.turn_id,
        region: 'answer',
        message_index: null,
        encoding: 'utf16',
        start: 0,
        end: 6,
        quote: 'Source',
      },
    ],
    source_channel: sourceTurn.source_channel,
    relaying_agent: sourceTurn.relaying_agent,
    supersedes: null,
    superseded_by: null,
    superseded_at_case_version: null,
    created_at_case_version: 1,
    compile_run_id: `run_${id}`,
    compiler_version_id: 'b'.repeat(64),
    evidence_ref_id: null,
    ...overrides,
  };
}

function state(): CaseState {
  const relay = turn('turn_relay', 'webmcp_agent_relay', {
    source_language: 'fr',
    translation_indicated: true,
  });
  const direct = turn('turn_direct', 'first_party_input', { in_reply_to: ['req_b'] });
  const old = proposition('prop_old', relay, {
    superseded_by: 'prop_direct',
    superseded_at_case_version: 2,
  });
  return {
    case_id: 'case_readback',
    case_version: 2,
    principal_id: 'user_readback',
    disclosure_version: 'disclosure-v1',
    disclosure_accepted_at: '2026-08-31T00:00:00.000Z',
    requirements: [requirement('req_b'), requirement('req_a', 'Was there an adverse fact?')].map(
      (entry) =>
        entry.requirement_id === 'req_a' ? { ...entry, adverse_fact_probe: true } : entry,
    ),
    propositions: [
      proposition('prop_direct', direct, {
        in_reply_to: 'req_b',
        source_channel: 'first_party_input',
        relaying_agent: null,
        epistemic_strength: 'disputed_by_user',
        statement: 'I directly corrected the relayed account.',
        supersedes: 'prop_old',
        created_at_case_version: 2,
      }),
      old,
      proposition('prop_nonanswer', direct, {
        in_reply_to: 'req_b',
        type: 'non_recollection',
        epistemic_strength: 'non_recollection',
        statement: "I don't remember.",
      }),
    ],
    clarifications: [
      {
        clarification_id: 'clar_open',
        requirement_id: 'req_a',
        prompt: 'Please clarify the date.',
        opened_at_case_version: 2,
        resolved_at_case_version: null,
        reopened_as: null,
      },
      {
        clarification_id: 'clar_resolved',
        requirement_id: 'req_b',
        prompt: 'Was this corrected?',
        opened_at_case_version: 1,
        resolved_at_case_version: 2,
        reopened_as: null,
      },
    ],
    evidence_references: [
      {
        evidence_ref_id: 'evidence_1',
        case_id: 'case_readback',
        label: 'Invoice reference only',
        inspection_status: 'uninspected',
        source_channel: 'first_party_input',
        created_at_case_version: 2,
      },
    ],
    turn_log: [relay, direct],
    attestations: [],
  };
}

describe('Step 64 canonical read-back', () => {
  it('has a byte-exact minimal golden document with one v0.3 template', () => {
    const minimal: CaseState = {
      ...state(),
      case_version: 0,
      requirements: [requirement('req_a')],
      propositions: [],
      clarifications: [],
      evidence_references: [],
      turn_log: [],
    };
    expect(renderCanonicalAccount(minimal).document).toBe(
      [
        'JURYAI CANONICAL READ-BACK',
        'format: juryai-readback-v0.3.0',
        `template: ${RENDER_TEMPLATE_VERSION}`,
        'case: case_readback',
        'version: 0',
        '',
        '[REQUIREMENT req_a]',
        'prompt:',
        'Prompt for req_a.',
        '.',
        'status: "unsatisfied"',
        'satisfying_types: ["declined_to_answer","narrative_fact","non_recollection"]',
        'min_propositions: 1',
        'max_propositions: null',
        'adverse_fact_probe: false',
        'reopened_from: null',
        '[/REQUIREMENT]',
        '',
        '[NON_ANSWER_RECAP]',
        'heading:',
        'Things you said you do not know, do not remember, or chose not to answer',
        '.',
        'proposition_ids: []',
        '[/NON_ANSWER_RECAP]',
        '',
      ].join('\n'),
    );
  });

  it('normalizes free text to LF and dot-stuffs reversible delimiter lines', () => {
    const source = state();
    source.requirements[0]!.prompt = '.first\r\n.\nlast';
    const rendered = renderCanonicalAccount(source);
    expect(rendered.document).not.toContain('\r');
    expect(rendered.document).toContain('..first\n..\nlast\n.');
    expect(
      parseReadbackDocument(rendered.document).blocks.find((block) => block.id === 'req_b')?.fields
        .prompt,
    ).toBe('.first\n.\nlast');
  });

  it('sorts every canonical element and is byte/hash deterministic', () => {
    const source = state();
    const first = renderCanonicalAccount(source);
    const second = renderCanonicalAccount({
      ...source,
      requirements: [...source.requirements].reverse(),
      propositions: [...source.propositions].reverse(),
      clarifications: [...source.clarifications].reverse(),
    });
    expect(second).toEqual(first);
  });

  it.each([
    [
      'missing element',
      (document: string) => document.replace(/\[EVIDENCE[\s\S]*?\[\/EVIDENCE\]\n\n/u, ''),
    ],
    [
      'fabricated id',
      (document: string) => document.replace('[REQUIREMENT req_a]', '[REQUIREMENT req_fabricated]'),
    ],
    [
      'duplicate id',
      (document: string) =>
        `${document}${document.slice(document.indexOf('[EVIDENCE'), document.indexOf('[NON_ANSWER'))}`,
    ],
    [
      'wrong block type',
      (document: string) =>
        document
          .replaceAll('REQUIREMENT req_a', 'EVIDENCE req_a')
          .replace('[/REQUIREMENT]', '[/EVIDENCE]'),
    ],
    ['incomplete field', (document: string) => document.replace('adverse_fact_probe: true\n', '')],
  ])('fails completeness for %s', (_label, mutate) => {
    const source = state();
    expect(
      verifyRenderCompleteness(source, mutate(renderCanonicalAccount(source).document)).ok,
    ).toBe(false);
  });

  it('rejects noncanonical parser reconstruction and CR newlines', () => {
    const source = state();
    const document = renderCanonicalAccount(source).document;
    expect(
      verifyRenderCompleteness(source, document.replace('\n\n[PROPOSITION', '\n\n\n[PROPOSITION'))
        .ok,
    ).toBe(false);
    expect(verifyRenderCompleteness(source, document.replaceAll('\n', '\r\n')).ok).toBe(false);
  });

  it.each([
    [
      'readback_unknown_type',
      (source: CaseState) => ((source.propositions[0]!.type as unknown) = 'future_type'),
    ],
    [
      'readback_unknown_epistemic_strength',
      (source: CaseState) =>
        ((source.propositions[0]!.epistemic_strength as unknown) = 'future_strength'),
    ],
    [
      'readback_unknown_source_channel',
      (source: CaseState) =>
        ((source.propositions[0]!.source_channel as unknown) = 'future_channel'),
    ],
  ])('fails closed with %s', (code, mutate) => {
    const source = state();
    mutate(source);
    expect(() => renderCanonicalAccount(source)).toThrow(expect.objectContaining({ code }));
  });

  it('fails closed on a future canonical element shape instead of silently dropping it', () => {
    const source = state();
    (source.propositions[0] as Proposition & { future_stance?: string }).future_stance = 'new';
    expect(() => renderCanonicalAccount(source)).toThrow(
      expect.objectContaining({ code: 'readback_unknown_shape' }),
    );
  });

  it('renders relay, translation, direct provenance and does not infer translation from language', () => {
    const document = renderCanonicalAccount(state()).document;
    expect(document).toContain('Relayed through Assistant X and marked as translated.');
    expect(document).toContain('Added directly by you during JuryAI review.');
    const source = state();
    source.turn_log[0]!.translation_indicated = false;
    expect(renderCanonicalAccount(source).document).not.toContain('marked as translated');
  });

  it('renders uncertainty, dispute, supersession, both clarification states, evidence, and adverse probes', () => {
    const document = renderCanonicalAccount(state()).document;
    for (const fragment of [
      'asserted_qualified',
      'disputed_by_user',
      'standing: "superseded"',
      '[CLARIFICATION clar_open]',
      'status: "open"',
      '[CLARIFICATION clar_resolved]',
      'status: "resolved"',
      '[EVIDENCE evidence_1]',
      'adverse_fact_probe: true',
    ]) {
      expect(document).toContain(fragment);
    }
  });

  it('groups every live non-answer without hoisting dates, amounts, or deadlines', () => {
    const document = renderCanonicalAccount(state()).document;
    expect(document).toContain('proposition_ids: ["prop_nonanswer"]');
    expect(document).toContain('I expected completion on April 25, but I was not certain.');
    expect(document).not.toContain('Deadline: April 25');
    expect(document).not.toContain('key numbers');
  });

  it('adds the exact relay adoption paragraph only when relay material is present', () => {
    expect(adoptionStatementFor(state())).toContain('Some parts may be worded by my AI assistant');
    const direct = state();
    direct.propositions = direct.propositions.filter(
      (entry) => entry.source_channel === 'first_party_input',
    );
    expect(adoptionStatementFor(direct)).not.toContain('Some parts may be worded');
  });

  it('derives every challenge adoption hash from CaseState, never serialized byte substrings', () => {
    const directOnly = (): CaseState => {
      const source = state();
      source.propositions = source.propositions
        .filter((entry) => entry.source_channel === 'first_party_input')
        .map((entry) => ({ ...entry, supersedes: null }));
      source.turn_log = source.turn_log.filter(
        (entry) => entry.source_channel === 'first_party_input',
      );
      source.clarifications = [];
      source.evidence_references = [];
      return source;
    };
    const cases: Array<{ label: string; source: CaseState; relay: boolean }> = [];

    const standaloneFileEvidence = directOnly();
    standaloneFileEvidence.evidence_references = [
      {
        evidence_ref_id: 'evidence_file_only',
        case_id: standaloneFileEvidence.case_id,
        label: 'Standalone imported file',
        inspection_status: 'uninspected',
        source_channel: 'file_import',
        created_at_case_version: standaloneFileEvidence.case_version,
      },
    ];
    cases.push({ label: 'standalone file evidence', source: standaloneFileEvidence, relay: false });

    for (const token of ['"file_import"', '"webmcp_agent_relay"']) {
      const quotedToken = directOnly();
      quotedToken.propositions[0]!.statement = `The user literally typed ${token}.`;
      cases.push({ label: `user text ${token}`, source: quotedToken, relay: false });
    }

    cases.push({ label: 'genuine relay proposition', source: state(), relay: true });
    cases.push({ label: 'first-party only', source: directOnly(), relay: false });

    for (const testCase of cases) {
      const statement = adoptionStatementFor(testCase.source);
      const challenge = issueRenderChallenge(
        testCase.source,
        renderCanonicalAccount(testCase.source),
        `nonce_${testCase.label}`,
        0,
      );
      expect(challenge.adoption_statement_hash, testCase.label).toBe(sha256(statement));
      expect(statement.includes('Some parts may be worded'), testCase.label).toBe(testCase.relay);
    }
  });
});
