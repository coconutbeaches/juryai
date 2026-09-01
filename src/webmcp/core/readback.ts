import type { CaseState, RenderedAccount } from './attestation.js';
import { deriveReadiness, evaluateRequirement } from './requirements.js';
import {
  describeEpistemicStrength,
  isEpistemicStrength,
  isPropositionType,
  RENDER_TEMPLATE_VERSION,
  sha256,
  SOURCE_CHANNELS,
  type ContractIssue,
  type SourceChannel,
} from './types.js';
import {
  dotStuff,
  parseReadbackDocument,
  READBACK_FORMAT_VERSION,
  ReadbackParseError,
  type ReadbackBlock,
} from './readback-format.js';

export { parseReadbackDocument, READBACK_FORMAT_VERSION, ReadbackParseError };

/**
 * Stable identity for the renderer used by every historical `case_...` record.
 * New dispute formats must use a separately named renderer rather than changing
 * the meaning of this artifact.
 */
export const LEGACY_READBACK_RENDERER_VERSION = 'juryai-legacy-readback-renderer-v1';

export interface RenderCompletenessReport {
  ok: boolean;
  issues: ContractIssue[];
}

export class ReadbackRenderError extends TypeError {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReadbackRenderError';
    this.code = code;
  }
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function textField(lines: string[], name: string, value: string): void {
  lines.push(`${name}:`);
  lines.push(...dotStuff(value));
  lines.push('.');
}

function scalar(lines: string[], name: string, value: unknown): void {
  lines.push(`${name}: ${json(value)}`);
}

function assertExactShape(value: object, allowed: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (json(actual) !== json(expected)) {
    throw new ReadbackRenderError(
      'readback_unknown_shape',
      `${label} has a canonical shape this renderer does not explicitly understand.`,
    );
  }
}

function assertSourceChannel(value: unknown): asserts value is SourceChannel {
  if (!SOURCE_CHANNELS.includes(value as SourceChannel)) {
    throw new ReadbackRenderError(
      'readback_unknown_source_channel',
      `Unknown source channel: ${String(value)}`,
    );
  }
}

function provenanceCopy(
  channel: SourceChannel,
  relayingAgent: string | null,
  translated: boolean,
): string {
  switch (channel) {
    case 'first_party_input':
      return 'Added directly by you during JuryAI review.';
    case 'webmcp_agent_relay':
      return translated
        ? `Relayed through ${relayingAgent ?? 'your AI assistant'} and marked as translated.`
        : `Relayed to JuryAI through ${relayingAgent ?? 'your AI assistant'}.`;
    case 'file_import':
      return translated
        ? 'Imported from a file supplied outside JuryAI and marked as translated.'
        : 'Imported from a file supplied outside JuryAI.';
    case 'evidence_extraction':
      return 'Extracted from an inspected evidence reference.';
  }
}

function renderDocument(state: CaseState): string {
  const lines: string[] = [
    'JURYAI CANONICAL READ-BACK',
    `format: ${READBACK_FORMAT_VERSION}`,
    `template: ${RENDER_TEMPLATE_VERSION}`,
    `case: ${state.case_id}`,
    `version: ${state.case_version}`,
    '',
  ];
  const turnById = new Map(state.turn_log.map((turn) => [turn.turn_id, turn]));

  for (const requirement of [...state.requirements].sort((a, b) =>
    a.requirement_id.localeCompare(b.requirement_id),
  )) {
    assertExactShape(
      requirement,
      [
        'requirement_id',
        'prompt',
        'satisfying_types',
        'min_propositions',
        'max_propositions',
        'adverse_fact_probe',
        'reopened_from',
      ],
      `Requirement ${requirement.requirement_id}`,
    );
    for (const satisfyingType of requirement.satisfying_types) {
      if (!isPropositionType(satisfyingType)) {
        throw new ReadbackRenderError(
          'readback_unknown_type',
          `Unknown requirement proposition type: ${String(satisfyingType)}`,
        );
      }
    }
    const evaluation = evaluateRequirement(requirement, state.propositions, state.clarifications);
    lines.push(`[REQUIREMENT ${requirement.requirement_id}]`);
    textField(lines, 'prompt', requirement.prompt);
    scalar(lines, 'status', evaluation.status);
    scalar(lines, 'satisfying_types', [...requirement.satisfying_types].sort());
    scalar(lines, 'min_propositions', requirement.min_propositions);
    scalar(lines, 'max_propositions', requirement.max_propositions);
    scalar(lines, 'adverse_fact_probe', requirement.adverse_fact_probe);
    scalar(lines, 'reopened_from', requirement.reopened_from);
    lines.push('[/REQUIREMENT]', '');
  }

  for (const proposition of [...state.propositions].sort((a, b) =>
    a.proposition_id.localeCompare(b.proposition_id),
  )) {
    assertExactShape(
      proposition,
      [
        'proposition_id',
        'case_id',
        'type',
        'epistemic_strength',
        'statement',
        'in_reply_to',
        'derived_from_turn_ids',
        'spans',
        'source_channel',
        'relaying_agent',
        'supersedes',
        'superseded_by',
        'superseded_at_case_version',
        'created_at_case_version',
        'compile_run_id',
        'compiler_version_id',
        'evidence_ref_id',
      ],
      `Proposition ${proposition.proposition_id}`,
    );
    if (!isPropositionType(proposition.type)) {
      throw new ReadbackRenderError(
        'readback_unknown_type',
        `Unknown proposition type: ${String(proposition.type)}`,
      );
    }
    if (!isEpistemicStrength(proposition.epistemic_strength)) {
      throw new ReadbackRenderError(
        'readback_unknown_epistemic_strength',
        `Unknown epistemic strength: ${String(proposition.epistemic_strength)}`,
      );
    }
    assertSourceChannel(proposition.source_channel);
    const sourceTurns = [...proposition.derived_from_turn_ids].sort().map((turnId) => {
      const turn = turnById.get(turnId);
      if (!turn) {
        throw new ReadbackRenderError(
          'readback_unknown_source_turn',
          `Proposition ${proposition.proposition_id} names unknown turn ${turnId}.`,
        );
      }
      assertSourceChannel(turn.source_channel);
      return {
        turn_id: turn.turn_id,
        source_channel: turn.source_channel,
        relaying_agent: turn.relaying_agent,
        source_language: turn.source_language,
        translation_indicated: turn.translation_indicated,
      };
    });
    const translated = sourceTurns.some((turn) => turn.translation_indicated === true);
    lines.push(`[PROPOSITION ${proposition.proposition_id}]`);
    textField(lines, 'statement', proposition.statement);
    scalar(lines, 'requirement', proposition.in_reply_to);
    scalar(lines, 'type', proposition.type);
    scalar(lines, 'epistemic_strength', proposition.epistemic_strength);
    textField(
      lines,
      'epistemic_meaning',
      describeEpistemicStrength(proposition.epistemic_strength),
    );
    scalar(lines, 'standing', proposition.superseded_by === null ? 'live' : 'superseded');
    scalar(lines, 'source_channel', proposition.source_channel);
    scalar(lines, 'relaying_agent', proposition.relaying_agent);
    textField(
      lines,
      'where_this_came_from',
      provenanceCopy(proposition.source_channel, proposition.relaying_agent, translated),
    );
    scalar(lines, 'source_turns', sourceTurns);
    scalar(lines, 'derived_from_turns', [...proposition.derived_from_turn_ids].sort());
    scalar(
      lines,
      'spans',
      [...proposition.spans].sort((a, b) => json(a).localeCompare(json(b))),
    );
    scalar(lines, 'supersedes', proposition.supersedes);
    scalar(lines, 'superseded_by', proposition.superseded_by);
    scalar(lines, 'superseded_at_case_version', proposition.superseded_at_case_version);
    scalar(lines, 'created_at_case_version', proposition.created_at_case_version);
    scalar(lines, 'compile_run_id', proposition.compile_run_id);
    scalar(lines, 'compiler_version_id', proposition.compiler_version_id);
    scalar(lines, 'evidence_ref_id', proposition.evidence_ref_id);
    lines.push('[/PROPOSITION]', '');
  }

  for (const clarification of [...state.clarifications].sort((a, b) =>
    a.clarification_id.localeCompare(b.clarification_id),
  )) {
    assertExactShape(
      clarification,
      [
        'clarification_id',
        'requirement_id',
        'prompt',
        'opened_at_case_version',
        'resolved_at_case_version',
        'reopened_as',
      ],
      `Clarification ${clarification.clarification_id}`,
    );
    lines.push(`[CLARIFICATION ${clarification.clarification_id}]`);
    textField(lines, 'prompt', clarification.prompt);
    scalar(lines, 'requirement', clarification.requirement_id);
    scalar(lines, 'status', clarification.resolved_at_case_version === null ? 'open' : 'resolved');
    scalar(lines, 'opened_at_case_version', clarification.opened_at_case_version);
    scalar(lines, 'resolved_at_case_version', clarification.resolved_at_case_version);
    scalar(lines, 'reopened_as', clarification.reopened_as);
    lines.push('[/CLARIFICATION]', '');
  }

  for (const evidence of [...state.evidence_references].sort((a, b) =>
    a.evidence_ref_id.localeCompare(b.evidence_ref_id),
  )) {
    assertExactShape(
      evidence,
      [
        'evidence_ref_id',
        'case_id',
        'label',
        'inspection_status',
        'source_channel',
        'created_at_case_version',
      ],
      `Evidence ${evidence.evidence_ref_id}`,
    );
    assertSourceChannel(evidence.source_channel);
    if (
      evidence.inspection_status !== 'inspected' &&
      evidence.inspection_status !== 'uninspected'
    ) {
      throw new ReadbackRenderError(
        'readback_unknown_evidence_status',
        `Unknown evidence inspection status: ${String(evidence.inspection_status)}`,
      );
    }
    lines.push(`[EVIDENCE ${evidence.evidence_ref_id}]`);
    textField(lines, 'label', evidence.label);
    scalar(lines, 'case_id', evidence.case_id);
    scalar(lines, 'inspection_status', evidence.inspection_status);
    scalar(lines, 'source_channel', evidence.source_channel);
    scalar(lines, 'created_at_case_version', evidence.created_at_case_version);
    lines.push('[/EVIDENCE]', '');
  }

  const nonAnswers = state.propositions
    .filter(
      (proposition) =>
        proposition.superseded_by === null &&
        (proposition.type === 'non_recollection' || proposition.type === 'declined_to_answer'),
    )
    .map((proposition) => proposition.proposition_id)
    .sort();
  lines.push('[NON_ANSWER_RECAP]');
  textField(
    lines,
    'heading',
    'Things you said you do not know, do not remember, or chose not to answer',
  );
  scalar(lines, 'proposition_ids', nonAnswers);
  lines.push('[/NON_ANSWER_RECAP]');
  return `${lines.join('\n')}\n`;
}

export function renderCanonicalReadbackV1(state: CaseState): RenderedAccount {
  const document = renderDocument(state);
  const report = verifyRenderCompletenessV1(state, document);
  if (!report.ok) {
    const first = report.issues[0];
    throw new ReadbackRenderError(
      first?.code ?? 'readback_incomplete',
      first?.message ?? 'Canonical read-back is incomplete.',
    );
  }
  return {
    render_template_version: RENDER_TEMPLATE_VERSION,
    case_id: state.case_id,
    case_version: state.case_version,
    document,
    document_hash: sha256(document),
  };
}

/** Backward-compatible name for the frozen legacy renderer. */
export const renderCanonicalReadback = renderCanonicalReadbackV1;

function issue(code: string, path: string, message: string): ContractIssue {
  return { code, path, message };
}

function expectedBlocks(state: CaseState): ReadbackBlock[] {
  return parseReadbackDocument(renderDocument(state)).blocks;
}

/**
 * Compares the parsed document to a fresh exhaustive projection. This catches
 * omissions, inventions, wrong block types, duplicate ids, incomplete fields,
 * and any parser/render round-trip drift.
 */
export function verifyRenderCompletenessV1(
  state: CaseState,
  renderedDocument: string,
): RenderCompletenessReport {
  let actual;
  let expected: ReadbackBlock[];
  try {
    actual = parseReadbackDocument(renderedDocument);
    expected = expectedBlocks(state);
  } catch (error) {
    const code =
      error instanceof ReadbackParseError || error instanceof ReadbackRenderError
        ? error.code
        : 'readback_parse_failed';
    return {
      ok: false,
      issues: [
        issue(code, 'readback', error instanceof Error ? error.message : 'Read-back failed.'),
      ],
    };
  }
  if (
    actual.format !== READBACK_FORMAT_VERSION ||
    actual.template !== RENDER_TEMPLATE_VERSION ||
    actual.case_id !== state.case_id ||
    actual.case_version !== state.case_version
  ) {
    return {
      ok: false,
      issues: [
        issue(
          'readback_header_mismatch',
          'readback',
          'Read-back header does not match current state.',
        ),
      ],
    };
  }
  const identity = (block: ReadbackBlock): string => `${block.type}:${block.id ?? ''}`;
  const seen = new Set<string>();
  for (const block of actual.blocks) {
    const key = identity(block);
    if (seen.has(key)) {
      return {
        ok: false,
        issues: [
          issue('readback_duplicate_id', `readback.${key}`, 'Canonical block is duplicated.'),
        ],
      };
    }
    seen.add(key);
  }
  if (actual.blocks.length !== expected.length) {
    return {
      ok: false,
      issues: [
        issue(
          'readback_element_count_mismatch',
          'readback',
          'Canonical element coverage differs from current state.',
        ),
      ],
    };
  }
  for (const [index, expectedBlock] of expected.entries()) {
    const actualBlock = actual.blocks[index];
    if (!actualBlock || identity(actualBlock) !== identity(expectedBlock)) {
      return {
        ok: false,
        issues: [
          issue(
            'readback_element_mismatch',
            `readback.blocks[${index}]`,
            'Canonical element is missing, fabricated, or in the wrong block type.',
          ),
        ],
      };
    }
    if (json(actualBlock.fields) !== json(expectedBlock.fields)) {
      return {
        ok: false,
        issues: [
          issue(
            'readback_element_incomplete',
            `readback.${identity(expectedBlock)}`,
            'Canonical element fields are incomplete or changed.',
          ),
        ],
      };
    }
  }
  if (renderedDocument !== renderDocument(state)) {
    return {
      ok: false,
      issues: [
        issue(
          'readback_noncanonical_encoding',
          'readback',
          'Parsed read-back cannot be reconstructed to the canonical byte sequence.',
        ),
      ],
    };
  }
  return { ok: true, issues: [] };
}

/** Backward-compatible name for the frozen legacy completeness verifier. */
export const verifyRenderCompleteness = verifyRenderCompletenessV1;

export function adoptionStatementForV1(state: CaseState): string {
  const base =
    'I have read this JuryAI account. It accurately represents the account I am giving JuryAI, including any uncertainty, disagreements, things I do not remember, and answers I chose not to give. I understand that attesting locks this case record.';
  const relay = state.propositions.some(
    (proposition) =>
      proposition.source_channel === 'webmcp_agent_relay' ||
      proposition.source_channel === 'file_import',
  );
  return relay
    ? `${base}\n\nSome parts may be worded by my AI assistant rather than by me. I have read those parts and they say what I mean.`
    : base;
}

/** Backward-compatible name for the frozen legacy adoption statement. */
export const adoptionStatementFor = adoptionStatementForV1;
