import { buildPersonAGoldenProjection } from '../evaluation/person-a-golden.js';

type JsonObject = Record<string, any>;

export const clone = <T>(value: T): T => structuredClone(value);

/** Start of a top-level numbered rule, anchored to the beginning of a line. */
const RULE_START = /^\d+\.\s/;

/**
 * End of the numbered-rule block. The instructions close with a standalone
 * directive rather than another rule, so that line is the structural terminator.
 */
const END_OF_RULES = /^Return only\b/;

/**
 * Extract one complete numbered rule from the extraction instructions.
 *
 * The rule is identified structurally: it starts at the line beginning `<n>. ` and
 * continues until a genuine boundary — the next top-level numbered rule, or the
 * end-of-rules directive. Blank lines do NOT terminate extraction, so a rule split
 * into several paragraphs is still returned in full; terminating on blank lines
 * would let a later paragraph escape validation entirely.
 */
export function extractNumberedRule(instructions: string, ruleNumber: number): string {
  const lines = instructions.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^${ruleNumber}\\.\\s`).test(line));
  if (start === -1) throw new Error(`Instruction rule ${ruleNumber} was not found.`);
  const body: string[] = [lines[start]!];
  for (const line of lines.slice(start + 1)) {
    if (RULE_START.test(line) || END_OF_RULES.test(line)) break;
    body.push(line);
  }
  // Keep interior blank lines; drop only trailing padding before the boundary.
  return body.join('\n').replace(/\s+$/u, '');
}

/** All snake_case tokens appearing anywhere in a block of instruction text. */
export function snakeCaseTokens(text: string): string[] {
  return [...new Set(text.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [])];
}

/**
 * Vocabulary a strict provider definition can actually express: its own property
 * names plus every enum/const string nested inside it. Deliberately scoped to one
 * definition so a token that exists only on some *other* definition is still
 * reported as unsupported.
 */
export function definitionVocabulary(definition: JsonObject): Set<string> {
  const vocabulary = new Set<string>(Object.keys(definition.properties ?? {}));
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const record = node as JsonObject;
    if (Array.isArray(record.enum)) {
      record.enum.forEach((value) => typeof value === 'string' && vocabulary.add(value));
    }
    if (typeof record.const === 'string') vocabulary.add(record.const);
    Object.values(record).forEach(walk);
  };
  walk(definition);
  return vocabulary;
}

/** Field tokens named in `ruleText` that `definition` cannot express. */
export function unsupportedFieldTokens(ruleText: string, definition: JsonObject): string[] {
  const vocabulary = definitionVocabulary(definition);
  return snakeCaseTokens(ruleText).filter((token) => !vocabulary.has(token));
}

function remapSourceSpans(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(remapSourceSpans);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as JsonObject;
  if (
    typeof object.submission_id === 'string' &&
    typeof object.quote === 'string' &&
    typeof object.start_char === 'number'
  ) {
    object.submission_id = 'sub_a_extracted';
  }
  Object.values(object).forEach(remapSourceSpans);
}

export function validPersonAExtraction(): JsonObject {
  const extraction = clone(buildPersonAGoldenProjection());
  extraction.submission.submission_id = 'sub_a_extracted';
  extraction.metadata = {
    model: 'test-model',
    prompt_version: 'person-a-v0.1.3',
    input_hash: extraction.submission.content_hash,
    generated_at: '2026-07-19T00:00:00Z',
  };
  remapSourceSpans(extraction);
  return extraction;
}

export function modelOutputFromGolden(): JsonObject {
  const extraction = validPersonAExtraction();
  return {
    schema_version: '0.1.2',
    party_profile: {
      display_name: extraction.party.display_name,
      country: extraction.party.country,
      language: extraction.party.language,
    },
    third_parties: extraction.third_parties,
    agreement: extraction.agreement,
    deliverable_assessments: extraction.deliverable_assessments,
    timeline: extraction.timeline,
    claims: extraction.claims,
    evidence: extraction.evidence,
    claim_evidence_links: extraction.claim_evidence_links,
    damages_claims: extraction.damages_claims,
    desired_outcomes: extraction.desired_outcomes,
    extraction_issues: extraction.extraction_issues,
    clarification_questions: extraction.clarification_questions,
  };
}
