/**
 * PR 8C1a — compiler contract V0.4.
 *
 * V0.4 differs from the frozen V0.3 contract in exactly two admission rules and
 * nothing else. This suite proves both halves of that claim: the two rules are
 * gone, and every other rule is still enforced — including the ones a
 * hand-written reimplementation would have been most likely to lose.
 */

import { describe, expect, it } from 'vitest';
import { sha256 } from '../v2/case-envelope.js';
import { computeRequestFingerprint } from '../webmcp/core/idempotency.js';
import { computePayloadCommitment } from '../webmcp/core/turns.js';
import type { SourceTurnRecord } from '../webmcp/core/turns.js';
import {
  COMPILER_CONTRACT_VERSION,
  COMPILER_INPUT_TEMPLATE_VERSION,
  buildCompilerInput,
  validateCompilerOutputForContractVersion,
  type CompilerOutput,
} from '../webmcp/core-v0-3/compiler-contract.js';
import {
  COMPILER_CONTRACT_VERSION_V04,
  V04_SUPPRESSED_V03_ISSUE_CODES,
  validateCompilerOutputForContractVersionV04,
  validateCompilerOutputV04,
} from '../webmcp/core-v0-4/compiler-contract.js';

const CASE_ID = 'case_v04';
const RUN_ID = 'run_v04';
const COMPILER_ID = sha256('v04-fixture-compiler');
const ASKED = 'req_asked';
const UNASKED = 'req_unasked';
const ANSWER =
  'Payment was due on delivery. They delivered on July 15 and the contact form did not work.';

function requirement(id: string) {
  return {
    requirement_id: id,
    prompt: `Answer ${id}.`,
    satisfying_types: ['narrative_fact', 'non_recollection', 'declined_to_answer'] as never,
    min_propositions: 1,
    max_propositions: null,
    adverse_fact_probe: false,
    reopened_from: null,
  };
}

function input(context: string[] = []) {
  const payload = {
    context: context.map((text) => ({ role: 'assistant' as const, text })),
    answer: { role: 'user' as const, text: ANSWER },
  };
  const turn: SourceTurnRecord = {
    turn_id: 'turn_v04',
    case_id: CASE_ID,
    case_version_before: 0,
    received_at: '2026-09-05T00:00:00.000Z',
    principal_id: 'subject_a',
    source_channel: 'webmcp_agent_relay',
    relaying_agent: 'test',
    source_language: 'en',
    translation_indicated: false,
    // Only ASKED is claimed as answered. UNASKED is volunteered.
    in_reply_to: [ASKED],
    client_turn_id: 'client_v04',
    request_fingerprint: computeRequestFingerprint({
      principal_id: 'subject_a',
      case_id: CASE_ID,
      in_reply_to: [ASKED],
      payload,
    }),
    payload,
    payload_commitment_salt: 'v04-fixture-salt-0123456789',
    payload_commitment: computePayloadCommitment(payload, 'v04-fixture-salt-0123456789'),
    compile_run_id: RUN_ID,
  };
  return buildCompilerInput({
    compile_run_id: RUN_ID,
    compiler_version_id: COMPILER_ID,
    state: { case_id: CASE_ID, case_version: 0 },
    turn,
    requirements: [requirement(ASKED), requirement(UNASKED)],
    livePropositions: [],
  });
}

/**
 * Builds a RESOLVED span the way the compiler's own draft parser does: exact
 * UTF-16 offsets into the stored region, never model-supplied arithmetic.
 */
function assertion(
  requirementId: string,
  quote: string,
  region: 'answer' | 'context' = 'answer',
  haystack: string = ANSWER,
) {
  const found = haystack.indexOf(quote);
  const start = found < 0 ? 0 : found;
  return {
    assertion_id: `assertion_${requirementId}_${quote.length}`,
    requirement_id: requirementId,
    proposed_type: 'narrative_fact' as const,
    epistemic_strength: 'asserted_confident' as const,
    statement: quote,
    spans: [
      {
        turn_id: 'turn_v04',
        region,
        message_index: region === 'context' ? 0 : null,
        encoding: 'utf16' as const,
        start,
        end: start + quote.length,
        quote,
      },
    ],
    supersedes_candidate: null,
  };
}

function output(assertions: ReturnType<typeof assertion>[]): CompilerOutput {
  return {
    compile_run_id: RUN_ID,
    compiler_version_id: COMPILER_ID,
    verdict: assertions.length > 0 ? 'accepted_candidates' : 'no_assertions',
    assertions,
    rejected_candidates: [],
    clarifications_requested: [],
  } as unknown as CompilerOutput;
}

const codes = (issues: { code: string }[]) => issues.map((raised) => raised.code);

describe('PR 8C1a: V0.4 removes exactly two V0.3 admission rules', () => {
  it('the suppressed set is exactly those two codes', () => {
    expect([...V04_SUPPRESSED_V03_ISSUE_CODES].sort()).toEqual([
      'compiler_assertion_slot_duplicate',
      'compiler_requirement_not_answered',
    ]);
  });

  it('two same-slot assertions: V0.3 rejects, V0.4 accepts', () => {
    const request = input();
    const run = output([
      assertion(ASKED, 'Payment was due on delivery.'),
      assertion(ASKED, 'the contact form did not work'),
    ]);
    expect(
      codes(validateCompilerOutputForContractVersion(request, run, COMPILER_CONTRACT_VERSION)),
    ).toContain('compiler_assertion_slot_duplicate');
    expect(validateCompilerOutputV04(request, run)).toEqual([]);
  });

  it('an assertion targeting an unasked but supplied requirement: V0.3 rejects, V0.4 accepts', () => {
    const request = input();
    const run = output([assertion(UNASKED, 'They delivered on July 15')]);
    expect(
      codes(validateCompilerOutputForContractVersion(request, run, COMPILER_CONTRACT_VERSION)),
    ).toContain('compiler_requirement_not_answered');
    expect(validateCompilerOutputV04(request, run)).toEqual([]);
  });
});

describe('PR 8C1a: V0.4 keeps every other V0.3 rule', () => {
  it('a requirement outside the supplied context is still refused', () => {
    // This is what keeps a widened parsing scope from reaching an opponent's
    // requirements: the compiler may only target what it was given.
    const request = input();
    const run = output([assertion('req_never_supplied', 'They delivered on July 15')]);
    expect(codes(validateCompilerOutputV04(request, run))).toContain(
      'compiler_requirement_unknown',
    );
  });

  it('row 13 — an assertion grounded only in assistant context is refused', () => {
    const contextText = 'The assistant says the deadline was July 1.';
    const request = input([contextText]);
    const run = output([assertion(UNASKED, contextText, 'context', contextText)]);
    expect(codes(validateCompilerOutputV04(request, run))).toContain(
      'compiler_assertion_answer_span_missing',
    );
  });

  it('a quotation that is not an exact substring of the answer is refused', () => {
    const request = input();
    const run = output([assertion(ASKED, 'a sentence that never appears in the answer')]);
    expect(validateCompilerOutputV04(request, run).length).toBeGreaterThan(0);
  });

  it('an ambiguous verdict carrying assertions is still refused', () => {
    const request = input();
    const run = {
      ...output([assertion(ASKED, 'Payment was due on delivery.')]),
      verdict: 'ambiguous',
    } as unknown as CompilerOutput;
    expect(validateCompilerOutputV04(request, run).length).toBeGreaterThan(0);
  });

  it('run and compiler identity mismatches are still refused', () => {
    const request = input();
    const run = { ...output([]), compile_run_id: 'run_elsewhere' } as unknown as CompilerOutput;
    expect(codes(validateCompilerOutputV04(request, run))).toContain('compiler_run_id_mismatch');
  });

  it('the input template is unchanged, so no cosmetic bump was taken', () => {
    expect(input().input_template_version).toBe(COMPILER_INPUT_TEMPLATE_VERSION);
    expect(COMPILER_INPUT_TEMPLATE_VERSION).toBe('juryai-compiler-input-v0.3.0');
  });
});

describe('PR 8C1a: the two contracts mutually refuse each other', () => {
  it('V0.3 refuses a V0.4 run', () => {
    const request = input();
    expect(
      codes(
        validateCompilerOutputForContractVersion(
          request,
          output([]),
          COMPILER_CONTRACT_VERSION_V04,
        ),
      ),
    ).toEqual(['compiler_contract_version_mismatch']);
  });

  it('V0.4 refuses a V0.3 run', () => {
    // Symmetry is load-bearing: the input template is byte-identical across the
    // two contracts, so nothing else stops a stored V0.3 run being replayed
    // under V0.4's looser admission rules and silently changing the meaning of
    // evidence already recorded.
    const request = input();
    expect(
      codes(
        validateCompilerOutputForContractVersionV04(request, output([]), COMPILER_CONTRACT_VERSION),
      ),
    ).toEqual(['compiler_contract_version_mismatch']);
  });

  it('both refuse an unknown contract version', () => {
    const request = input();
    for (const validate of [
      validateCompilerOutputForContractVersion,
      validateCompilerOutputForContractVersionV04,
    ]) {
      expect(
        codes(validate(request, output([]), 'juryai-webmcp-compiler-contract-v9.9.9')),
      ).toEqual(['compiler_contract_version_mismatch']);
    }
  });
});
