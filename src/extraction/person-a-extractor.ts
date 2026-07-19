import { createHash } from 'node:crypto';
import type { StructuredExtractionClient } from './openai-responses.js';
import { PERSON_A_PROMPT_VERSION } from './person-a-prompt.js';
import { validatePersonAExtraction } from './validate-person-a.js';

type JsonObject = Record<string, any>;

export const PERSON_A_EXTRACTOR_VERSION = 'person-a-v0.1.0';

export type ExtractPersonAOptions = {
  narrative: string;
  submittedAt: string;
  model: string;
  client: StructuredExtractionClient;
  generatedAt?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
};

export type PersonAExtractionResult = {
  extraction: JsonObject;
  modelOutput: JsonObject;
};

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function assemblePersonAExtraction(
  modelOutput: JsonObject,
  options: Omit<ExtractPersonAOptions, 'client' | 'reasoningEffort'>,
): JsonObject {
  const submissionId = 'sub_a_extracted';
  const inputHash = sha256(options.narrative);
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  const extraction: JsonObject = {
    schema_version: '0.1.2',
    extractor_version: PERSON_A_EXTRACTOR_VERSION,
    party: {
      party_id: 'party_a',
      role: 'person_a',
      display_name: modelOutput.party_profile.display_name,
      email: null,
      country: modelOutput.party_profile.country,
      language: modelOutput.party_profile.language,
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
    third_parties: modelOutput.third_parties ?? [],
    agreement: modelOutput.agreement,
    deliverable_assessments: modelOutput.deliverable_assessments,
    timeline: modelOutput.timeline,
    claims: modelOutput.claims,
    evidence: modelOutput.evidence,
    claim_evidence_links: modelOutput.claim_evidence_links,
    damages_claims: modelOutput.damages_claims,
    desired_outcomes: modelOutput.desired_outcomes,
    extraction_issues: modelOutput.extraction_issues,
    clarification_questions: modelOutput.clarification_questions,
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
  const modelOutput = await options.client.generate({
    narrative: options.narrative,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
  });
  const extraction = assemblePersonAExtraction(modelOutput, options);
  return { extraction, modelOutput };
}
