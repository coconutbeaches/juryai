import { createHash } from 'node:crypto';
import {
  validatePersonAExtraction as validateBase,
  type PersonAValidationResult,
} from './validate-person-a.js';
import type { ValidationIssue } from '../validation/custom-invariants.js';

type JsonObject = Record<string, any>;
const array = (value: unknown): any[] => (Array.isArray(value) ? value : []);

function isFilenameShaped(value: string): boolean {
  return value.length <= 255 && !/[\r\n]/.test(value) && /(^|[^.])\.[A-Za-z0-9]{1,12}$/.test(value);
}

function hasExactFilenameLiteral(narrative: string, filename: string): boolean {
  let index = narrative.indexOf(filename);
  while (index >= 0) {
    const before = index > 0 ? narrative[index - 1] : '';
    const afterIndex = index + filename.length;
    const after = afterIndex < narrative.length ? narrative[afterIndex] : '';
    const filenameChar = /[A-Za-z0-9._-]/;
    if ((!before || !filenameChar.test(before)) && (!after || !filenameChar.test(after))) return true;
    index = narrative.indexOf(filename, index + 1);
  }
  return false;
}

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

  const claimEvidenceLinkIds = new Set(
    array(object.claim_evidence_links)
      .map((link) => link.link_id)
      .filter((id): id is string => typeof id === 'string'),
  );
  result.invariantErrors = result.invariantErrors.filter((error) => {
    if (
      !error.path.includes('.affected_object_ids[') &&
      !error.path.includes('.linked_object_ids[')
    ) {
      return true;
    }
    const referencedId = error.message.match(/Referenced ID '([^']+)'/)?.[1];
    return !referencedId || !claimEvidenceLinkIds.has(referencedId);
  });

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
    const spans = array(item.spans);
    if (spans.length === 0) {
      add(item.path, 'Narrative-derived objects require at least one source span.');
    }
    spans.forEach((span, index) => {
      const path = `${item.path}[${index}]`;
      const validBounds =
        Number.isInteger(span.start_char) &&
        Number.isInteger(span.end_char) &&
        span.start_char >= 0 &&
        span.end_char >= span.start_char &&
        span.end_char <= narrative.length;
      if (!validBounds || span.end_char - span.start_char !== String(span.quote ?? '').length) {
        add(
          path,
          'Source span offsets must be in bounds and end_char - start_char must equal quote.length.',
        );
      }
    });
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

  const reservedPartyIds = new Set(['party_a', 'party_b']);
  array(object.third_parties).forEach((thirdParty, index) => {
    if (reservedPartyIds.has(thirdParty.third_party_id)) {
      add(
        `$.third_parties[${index}].third_party_id`,
        'Third-party IDs cannot reuse reserved party IDs.',
      );
    }
  });

  const thirdPartyIds = new Set(
    array(object.third_parties)
      .map((thirdParty) => thirdParty.third_party_id)
      .filter(
        (id): id is string => typeof id === 'string' && !reservedPartyIds.has(id),
      ),
  );
  array(object.evidence).forEach((evidence, evidenceIndex) => {
    if (
      evidence.original_filename !== null &&
      (!isFilenameShaped(evidence.original_filename) ||
        !hasExactFilenameLiteral(narrative, evidence.original_filename))
    ) {
      add(
        `$.evidence[${evidenceIndex}].original_filename`,
        'original_filename must be a filename-shaped, boundary-delimited literal explicitly present in the narrative.',
      );
    }
    if (
      ['described_only', 'unavailable'].includes(evidence.availability_status) &&
      !['not_verified', 'not_assessable', 'unknown'].includes(evidence.authenticity_status)
    ) {
      add(
        `$.evidence[${evidenceIndex}].authenticity_status`,
        'Uninspected narrative evidence cannot be marked metadata-consistent or otherwise verified.',
      );
    }
    array(evidence.extracts).forEach((extract, extractIndex) => {
      if (
        extract.author_third_party_id !== null &&
        !thirdPartyIds.has(extract.author_third_party_id)
      ) {
        add(
          `$.evidence[${evidenceIndex}].extracts[${extractIndex}].author_third_party_id`,
          'Evidence extract author_third_party_id must reference a registered non-party third party.',
        );
      }
    });
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
