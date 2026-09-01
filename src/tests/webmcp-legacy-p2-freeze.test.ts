import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_CANONICAL_STATE_PROJECTION_VERSION,
  canonicalStateProjection,
  canonicalStateProjectionV1,
  deriveCaseStatus,
  hashCanonicalState,
  hashCanonicalStateV1,
  renderCanonicalAccount,
  renderCanonicalAccountV1,
  type AttestationRecord,
  type CaseState,
} from '../webmcp/core/attestation.js';
import {
  LEGACY_READBACK_RENDERER_VERSION,
  renderCanonicalReadback,
  renderCanonicalReadbackV1,
  verifyRenderCompleteness,
  verifyRenderCompletenessV1,
} from '../webmcp/core/readback.js';
import { CONFLICT_EXCERPT_LENGTH, summarizeTurnForConflict } from '../webmcp/core/idempotency.js';
import {
  LEGACY_CANONICAL_JSON_VERSION,
  canonicalSerializeV1,
  sha256V1,
} from '../webmcp/core/legacy-canonical-json-v1.js';
import { validateCaseState } from '../webmcp/core/structural-validator.js';
import type { SourceTurnRecord } from '../webmcp/core/turns.js';
import {
  PERMITTED_CASE_STATE_SLOTS,
  PERMITTED_CONFLICT_TURN_SUMMARY_SLOTS,
  PERMITTED_SUBMIT_TURN_ERROR_SLOTS,
  PERMITTED_SUBMIT_TURN_FAILURE_SLOTS,
  PERMITTED_SUBMIT_TURN_SUCCESS_SLOTS,
  PERMITTED_VERSION_CONFLICT_RESULT_SLOTS,
  decodeCaseServiceResult,
  decodeCaseStateResponse,
} from '../webmcp/public-contract.js';
import { projectRoot } from './test-helpers.js';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(projectRoot, 'src/fixtures', name), 'utf8')) as T;
}

interface LockedLegacyFixture {
  fixture_version: string;
  fixture_kind: string;
  canonical_projection_version: string;
  canonical_json_version: string;
  readback_renderer_version: string;
  attestation_contract_version: string;
  locked_case_state: CaseState;
  expected_canonical_state_hash: string;
  expected_rendered_document_hash: string;
}

interface ProductionCommitmentFixture {
  fixture_version: string;
  fixture_kind: string;
  observed_at: string;
  case_id: string;
  locked_case_version: number;
  expected_status: string;
  commitments: Record<string, string>;
}

interface LegacyWireFixture {
  fixture_version: string;
  case_state: Record<string, unknown>;
  submit_turn_results: Record<string, Record<string, unknown>>;
}

const locked = fixture<LockedLegacyFixture>('webmcp-legacy-p2-locked-v1.json');
const production = fixture<ProductionCommitmentFixture>(
  'webmcp-golden-production-case-commitments-v1.json',
);
const wire = fixture<LegacyWireFixture>('webmcp-legacy-p2-wire-v1.json');

describe('legacy P2 canonical compatibility freeze', () => {
  it('recomputes the checked-in non-production attestation commitments byte-for-byte', () => {
    const state = locked.locked_case_state;
    const attestation = state.attestations[0] as AttestationRecord | undefined;

    expect(locked.fixture_kind).toBe('synthetic_non_production');
    expect(locked.canonical_projection_version).toBe(LEGACY_CANONICAL_STATE_PROJECTION_VERSION);
    expect(locked.canonical_json_version).toBe(LEGACY_CANONICAL_JSON_VERSION);
    expect(locked.readback_renderer_version).toBe(LEGACY_READBACK_RENDERER_VERSION);
    expect(attestation).toBeDefined();
    expect(deriveCaseStatus(state)).toBe('locked');
    expect(validateCaseState(state)).toMatchObject({ ok: true, issues: [] });

    expect(hashCanonicalStateV1(state)).toBe(locked.expected_canonical_state_hash);
    expect(hashCanonicalState(state)).toBe(locked.expected_canonical_state_hash);
    expect(attestation?.canonical_state_hash).toBe(locked.expected_canonical_state_hash);

    const render = renderCanonicalAccountV1(state);
    expect(render.document).toBe(attestation?.rendered_document);
    expect(render.document_hash).toBe(locked.expected_rendered_document_hash);
    expect(attestation?.rendered_document_hash).toBe(locked.expected_rendered_document_hash);
    expect(sha256V1(render.document)).toBe(locked.expected_rendered_document_hash);
  });

  it('keeps the frozen V1 projection exact and excludes mutable audit collections', () => {
    const projection = canonicalStateProjectionV1(locked.locked_case_state) as Record<
      string,
      unknown
    >;
    expect(Object.keys(projection)).toEqual([
      'case_id',
      'case_version',
      'principal_id',
      'disclosure_version',
      'disclosure_accepted_at',
      'requirements',
      'propositions',
      'clarifications',
      'evidence_references',
    ]);
    expect(projection).not.toHaveProperty('turn_log');
    expect(projection).not.toHaveProperty('attestations');
    expect(sha256V1(canonicalSerializeV1(projection))).toBe(locked.expected_canonical_state_hash);
  });

  it('pins every legacy hash, render, read-back and completeness alias to V1', () => {
    expect(canonicalStateProjection).toBe(canonicalStateProjectionV1);
    expect(hashCanonicalState).toBe(hashCanonicalStateV1);
    expect(renderCanonicalAccount).toBe(renderCanonicalAccountV1);
    expect(renderCanonicalReadback).toBe(renderCanonicalReadbackV1);
    expect(verifyRenderCompleteness).toBe(verifyRenderCompletenessV1);
  });

  it('keeps only read-only commitments for the locked golden production case', () => {
    expect(Object.keys(production)).toEqual([
      'fixture_version',
      'fixture_kind',
      'observed_at',
      'case_id',
      'locked_case_version',
      'expected_status',
      'commitments',
    ]);
    expect(production).toMatchObject({
      fixture_kind: 'read_only_production_commitments',
      case_id: 'case_21919135-c72a-4e37-a18f-b4d274025298',
      locked_case_version: 10,
      expected_status: 'locked',
      commitments: {
        canonical_state_hash: 'b4bf79467e2a85e16389f2aa26ecde415861ce5575ffa5cb873bb9b81813f1ad',
        rendered_document_hash: 'a6ca8539069b5473002d22292b6490992a042163e1d8c6e8ea7b3f9a876f37c4',
      },
    });
    expect(Object.keys(production.commitments)).toEqual([
      'canonical_state_hash',
      'rendered_document_hash',
      'adoption_statement_hash',
      'render_template_version',
      'attestation_contract_version',
      'schema_version',
      'protocol_version',
      'structural_validator_version',
    ]);
    expect(JSON.stringify(production)).not.toMatch(
      /principal|proposition|source_turn|span|rendered_document"/u,
    );
  });
});

describe('legacy P2 relay wire compatibility freeze', () => {
  it('pins the exact existing 12-slot CaseStateResponse in order and at decode time', () => {
    expect(PERMITTED_CASE_STATE_SLOTS).toEqual([
      'case_id',
      'case_version',
      'protocol_version',
      'schema_version',
      'status',
      'unresolved_requirement_count',
      'next_requirements',
      'open_clarifications',
      'recent_interpretations',
      'evidence_references',
      'warnings',
      'review_url',
    ]);
    expect(PERMITTED_CASE_STATE_SLOTS).toHaveLength(12);
    expect(Object.keys(wire.case_state)).toEqual(PERMITTED_CASE_STATE_SLOTS);
    expect(decodeCaseStateResponse(wire.case_state)).toEqual(wire.case_state);
    expect(() => decodeCaseStateResponse({ ...wire.case_state, principal_id: 'secret' })).toThrow(
      /unknown field/u,
    );
  });

  it('pins every SubmitTurnResult variant and its exact relay-visible fields', () => {
    const { committed, replayed, version_conflict, service_error, service_error_with_case } =
      wire.submit_turn_results;
    expect(committed).toBeDefined();
    expect(replayed).toBeDefined();
    expect(version_conflict).toBeDefined();
    expect(service_error).toBeDefined();
    expect(service_error_with_case).toBeDefined();

    expect(Object.keys(committed!)).toEqual(
      PERMITTED_SUBMIT_TURN_SUCCESS_SLOTS.filter((slot) => slot !== 'replayed'),
    );
    expect(Object.keys(replayed!)).toEqual(PERMITTED_SUBMIT_TURN_SUCCESS_SLOTS);
    expect(Object.keys(version_conflict!)).toEqual(PERMITTED_VERSION_CONFLICT_RESULT_SLOTS);
    expect(Object.keys(service_error!)).toEqual(
      PERMITTED_SUBMIT_TURN_FAILURE_SLOTS.filter((slot) => slot !== 'case'),
    );
    expect(Object.keys(service_error_with_case!)).toEqual(PERMITTED_SUBMIT_TURN_FAILURE_SLOTS);
    expect(Object.keys(version_conflict!.error as object)).toEqual(
      PERMITTED_SUBMIT_TURN_ERROR_SLOTS,
    );
    expect(Object.keys(service_error!.error as object)).toEqual(PERMITTED_SUBMIT_TURN_ERROR_SLOTS);

    for (const result of [
      committed!,
      replayed!,
      version_conflict!,
      service_error!,
      service_error_with_case!,
    ]) {
      expect(decodeCaseServiceResult('submitTurn', result)).toEqual(result);
      expect(() =>
        decodeCaseServiceResult('submitTurn', { ...result, principal_id: 'secret' }),
      ).toThrow(/unknown field/u);
    }
  });

  it('pins VersionConflictResult and ConflictTurnSummary without hidden additions', () => {
    const conflict = wire.submit_turn_results.version_conflict!;
    const turns = conflict.recent_turns as Record<string, unknown>[];
    expect(Object.keys(turns[0]!)).toEqual(PERMITTED_CONFLICT_TURN_SUMMARY_SLOTS);
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: 'VERSION_CONFLICT', retryable: false },
      current_case_version: 3,
      likely_already_recorded: true,
    });
    expect(() =>
      decodeCaseServiceResult('submitTurn', {
        ...conflict,
        recent_turns: [{ ...turns[0], proposition_statement: 'must not cross the wire' }],
      }),
    ).toThrow(/unknown field/u);
  });

  it('freezes the current answer_excerpt truncation behavior without redesigning it', () => {
    const source = locked.locked_case_state.turn_log[0]!;
    const longAnswer = 'x'.repeat(CONFLICT_EXCERPT_LENGTH + 1);
    const longTurn: SourceTurnRecord = {
      ...source,
      payload: { ...source.payload, answer: { role: 'user', text: longAnswer } },
    };
    const exactTurn: SourceTurnRecord = {
      ...source,
      payload: {
        ...source.payload,
        answer: { role: 'user', text: 'x'.repeat(CONFLICT_EXCERPT_LENGTH) },
      },
    };

    expect(summarizeTurnForConflict(longTurn).answer_excerpt).toBe(
      `${'x'.repeat(CONFLICT_EXCERPT_LENGTH)}...`,
    );
    expect(summarizeTurnForConflict(exactTurn).answer_excerpt).toBe(
      'x'.repeat(CONFLICT_EXCERPT_LENGTH),
    );
  });
});

describe('legacy case routing boundary', () => {
  it('keeps legacy state, review and attestation modules outside V2 envelope semantics', () => {
    const legacyModules = [
      'src/webmcp/core/types.ts',
      'src/webmcp/core/attestation.ts',
      'src/webmcp/core/readback.ts',
      'src/webmcp/core/structural-validator.ts',
      'src/webmcp/runtime/runtime.ts',
      'src/webmcp/service/runtime-case-service.ts',
      'src/webmcp/server/server.ts',
    ];
    const forbidden = [
      /from ['"][^'"]*\/v2\//u,
      /validateCaseEnvelope/u,
      /buildPersonBDisclosureView/u,
      /applyEnvelopeCommand/u,
      /hashCaseEnvelope/u,
      /hashCaseRecord/u,
      /createInitialCaseEnvelope/u,
    ];
    for (const module of legacyModules) {
      const source = readFileSync(resolve(projectRoot, module), 'utf8');
      for (const pattern of forbidden) expect(source, module).not.toMatch(pattern);
    }

    const server = readFileSync(resolve(projectRoot, 'src/webmcp/server/server.ts'), 'utf8');
    const validator = readFileSync(
      resolve(projectRoot, 'src/webmcp/core/structural-validator.ts'),
      'utf8',
    );
    expect(server).toContain('renderCanonicalAccountV1');
    expect(server).toContain('verifyRenderCompletenessV1');
    expect(server).toContain('adoptionStatementForV1');
    expect(validator).toContain('hashCanonicalStateV1');
    expect(validator).toContain('renderCanonicalAccountV1');
  });
});
