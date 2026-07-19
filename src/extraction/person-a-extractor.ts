import { createHash } from 'node:crypto';
import type { StructuredExtractionClient } from './openai-responses.js';
import { PERSON_A_PROMPT_VERSION } from './person-a-prompt.js';
import { validatePersonAExtraction } from './validate-person-a-corrected.js';

type JsonObject = Record<string, any>;

export const PERSON_A_EXTRACTOR_VERSION = 'person-a-v0.1.2';

export type ExtractPersonAOptions = {
  narrative: string;
  submittedAt: string;
  model: string;
  client: StructuredExtractionClient;
  generatedAt?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
};

export type PersonAExtractionResult = {
  extraction: JsonObject;
  modelOutput: JsonObject;
  rawResponse: JsonObject;
};

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeSourceSpanSubmissionIds(value: unknown, submissionId: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => normalizeSourceSpanSubmissionIds(item, submissionId));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as JsonObject;
  if (
    typeof object.quote === 'string' &&
    typeof object.start_char === 'number' &&
    typeof object.end_char === 'number' &&
    'submission_id' in object
  ) {
    object.submission_id = submissionId;
  }
  Object.values(object).forEach((child) => normalizeSourceSpanSubmissionIds(child, submissionId));
}

function normalizeUniqueExactSourceSpanOffsets(value: unknown, narrative: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => normalizeUniqueExactSourceSpanOffsets(item, narrative));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as JsonObject;
  if (
    typeof object.quote === 'string' &&
    object.quote.length > 0 &&
    Number.isInteger(object.start_char) &&
    Number.isInteger(object.end_char) &&
    'submission_id' in object
  ) {
    const offsetsAlreadyExact =
      object.start_char >= 0 &&
      object.end_char >= object.start_char &&
      object.end_char <= narrative.length &&
      object.end_char - object.start_char === object.quote.length &&
      narrative.slice(object.start_char, object.end_char) === object.quote;
    if (!offsetsAlreadyExact) {
      const uniqueStart = narrative.indexOf(object.quote);
      if (uniqueStart >= 0 && narrative.indexOf(object.quote, uniqueStart + 1) === -1) {
        object.start_char = uniqueStart;
        object.end_char = uniqueStart + object.quote.length;
      }
    }
  }
  Object.values(object).forEach((child) => normalizeUniqueExactSourceSpanOffsets(child, narrative));
}

export function assemblePersonAExtraction(
  modelOutput: JsonObject,
  options: Omit<ExtractPersonAOptions, 'client' | 'reasoningEffort'>,
): JsonObject {
  const submissionId = 'sub_a_extracted';
  const inputHash = sha256(options.narrative);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const normalizedModelOutput = structuredClone(modelOutput);
  normalizeSourceSpanSubmissionIds(normalizedModelOutput, submissionId);
  normalizeUniqueExactSourceSpanOffsets(normalizedModelOutput, options.narrative);

  const extraction: JsonObject = {
    schema_version: '0.1.2',
    extractor_version: PERSON_A_EXTRACTOR_VERSION,
    party: {
      party_id: 'party_a',
      role: 'person_a',
      display_name: normalizedModelOutput.party_profile.display_name,
      email: null,
      country: normalizedModelOutput.party_profile.country,
      language: normalizedModelOutput.party_profile.language,
      identity_status: 'unverified',
      consented_at: null,
      submission_complete: true,
      record_confirmed_at: null,
    },
    submission: {
      submission_id: submissionId,
      party_id: 'party_a',
      submission_type: 'initial_position',
      raw_text: options.narrative,
      submitted_at: options.submittedAt,
      supersedes_submission_id: null,
      is_locked: true,
      content_hash: inputHash,
    },
    third_parties: normalizedModelOutput.third_parties ?? [],
    agreement: normalizedModelOutput.agreement,
    deliverable_assessments: normalizedModelOutput.deliverable_assessments,
    timeline: normalizedModelOutput.timeline,
    claims: normalizedModelOutput.claims,
    evidence: normalizedModelOutput.evidence,
    claim_evidence_links: normalizedModelOutput.claim_evidence_links,
    damages_claims: normalizedModelOutput.damages_claims,
    desired_outcomes: normalizedModelOutput.desired_outcomes,
    extraction_issues: normalizedModelOutput.extraction_issues,
    clarification_questions: normalizedModelOutput.clarification_questions,
    metadata: {
      model: options.model,
      prompt_version: PERSON_A_PROMPT_VERSION,
      input_hash: inputHash,
      generated_at: generatedAt,
    },
  };

  const validation = validatePersonAExtraction(extraction, options.narrative);
  if (!validation.valid) {
    const lines = [...validation.schemaErrors, ...validation.invariantErrors].map(
      (issue) => `${issue.path}: ${issue.message}`,
    );
    throw new Error(`Person A extraction validation failed:\n${lines.join('\n')}`);
  }
  return extraction;
}

export async function extractPersonA(
  options: ExtractPersonAOptions,
): Promise<PersonAExtractionResult> {
  const generated = await options.client.generate({
    narrative: options.narrative,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
  });
  const modelOutput = generated.output;
  const extraction = assemblePersonAExtraction(modelOutput, options);
  return { extraction, modelOutput, rawResponse: generated.rawResponse };
}
