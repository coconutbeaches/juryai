import { createHash } from 'node:crypto';
import {
  validatePersonAExtraction as validateBase,
  type PersonAValidationResult,
} from './validate-person-a.js';
import type { ValidationIssue } from '../validation/custom-invariants.js';

type JsonObject = Record<string, any>;
const array = (value: unknown): any[] => (Array.isArray(value) ? value : []);

export function validatePersonAExtraction(
  record: unknown,
  narrative: string,
): PersonAValidationResult {
  const result = validateBase(record, narrative);
  if (!record || typeof record !== 'object' || Array.isArray(record)) return result;
  const object = record as JsonObject;
  const extra: ValidationIssue[] = [];
  const add = (path: string, message: string): void => {
    if (!result.invariantErrors.some((error) => error.path === path && error.message === message)) {
      extra.push({ path, message });
    }
  };

  const traced = [
    ...array(object.agreement?.terms).map((item, index) => ({
      spans: item.source_spans,
      path: `$.agreement.terms[${index}].source_spans`,
    })),
    ...array(object.timeline).map((item, index) => ({
      spans: item.source_spans,
      path: `$.timeline[${index}].source_spans`,
    })),
    ...array(object.claims).map((item, index) => ({
      spans: item.source_spans,
      path: `$.claims[${index}].source_spans`,
    })),
    ...array(object.extraction_issues).map((item, index) => ({
      spans: item.source_spans,
      path: `$.extraction_issues[${index}].source_spans`,
    })),
  ];
  for (const item of traced) {
    if (array(item.spans).length === 0) {
      add(item.path, 'Narrative-derived objects require at least one source span.');
    }
  }

  const expectedHash = createHash('sha256').update(narrative, 'utf8').digest('hex');
  if (object.submission?.content_hash !== expectedHash) {
    add('$.submission.content_hash', 'The submission content_hash must equal sha256(narrative).');
  }
  if (object.metadata?.input_hash !== expectedHash) {
    add('$.metadata.input_hash', 'The metadata input_hash must equal sha256(narrative).');
  }

  array(object.agreement?.terms).forEach((term, index) => {
    if (term.wording_status !== 'not_inspected') {
      add(
        `$.agreement.terms[${index}].wording_status`,
        'Person A-only extraction cannot mark uninspected agreement wording agreed or disputed.',
      );
    }
    if (!['unclear', 'not_applicable'].includes(term.interpretation_status)) {
      add(
        `$.agreement.terms[${index}].interpretation_status`,
        'Person A-only extraction cannot mark a bilateral interpretation agreed or disputed.',
      );
    }
  });

  array(object.evidence).forEach((evidence, index) => {
    if (evidence.original_filename !== null && !narrative.includes(evidence.original_filename)) {
      add(
        `$.evidence[${index}].original_filename`,
        'original_filename must be null unless the exact filename appears in the narrative.',
      );
    }
    if (
      ['described_only', 'unavailable'].includes(evidence.availability_status) &&
      !['not_verified', 'not_assessable', 'unknown'].includes(evidence.authenticity_status)
    ) {
      add(
        `$.evidence[${index}].authenticity_status`,
        'Uninspected narrative evidence cannot be marked metadata-consistent or otherwise verified.',
      );
    }
  });

  array(object.damages_claims).forEach((claim, index) => {
    if (!['none', 'not_assessed'].includes(claim.support_level)) {
      add(
        `$.damages_claims[${index}].support_level`,
        'Uninspected evidence cannot receive an assessed damages support level.',
      );
    }
  });

  result.invariantErrors.push(...extra);
  result.valid = result.schemaErrors.length === 0 && result.invariantErrors.length === 0;
  return result;
}

export type { PersonAValidationResult } from './validate-person-a.js';
