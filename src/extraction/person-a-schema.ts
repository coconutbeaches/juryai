import canonicalSchema from '../schemas/juryai-case-record-v0.1.2.schema.json';

type JsonSchema = Record<string, any>;

const canonicalDefs = (canonicalSchema as JsonSchema).$defs as Record<string, JsonSchema>;

function referencedDefinitionNames(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => referencedDefinitionNames(entry, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$ref' && typeof child === 'string') {
      const match = child.match(/^#\/\$defs\/(.+)$/);
      if (match?.[1]) found.add(match[1]);
    } else referencedDefinitionNames(child, found);
  }
  return found;
}

function requireSourceSpans(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(requireSourceSpans);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as JsonSchema;
  const sourceSpans = object.properties?.source_spans;
  if (sourceSpans?.type === 'array') sourceSpans.minItems = 1;
  Object.values(object).forEach(requireSourceSpans);
}

function collectDefs(rootNames: string[]): Record<string, JsonSchema> {
  const pending = [...rootNames];
  const collected: Record<string, JsonSchema> = {};
  while (pending.length > 0) {
    const name = pending.pop();
    if (!name || collected[name]) continue;
    const definition = canonicalDefs[name];
    if (!definition) throw new Error(`Canonical schema definition '${name}' was not found.`);
    collected[name] = structuredClone(definition);
    for (const referenced of referencedDefinitionNames(definition)) {
      if (!collected[referenced]) pending.push(referenced);
    }
  }
  for (const name of ['agreementTerm', 'timelineEvent', 'claim', 'extractionIssue']) {
    if (collected[name]) requireSourceSpans(collected[name]);
  }
  return collected;
}

function applyPersonAModelConstraints(schema: JsonSchema): void {
  const agreementTerm = schema.$defs?.agreementTerm;
  if (agreementTerm?.properties) {
    agreementTerm.properties.wording_status = {
      type: 'string',
      const: 'not_inspected',
      description:
        'Person A-only intake has not inspected bilateral agreement wording, so this must be not_inspected.',
    };
    agreementTerm.properties.interpretation_status = {
      type: 'string',
      enum: ['unclear', 'not_applicable'],
      description:
        'Person A-only intake cannot establish bilateral agreement or dispute; use only unclear or not_applicable.',
    };
  }

  const sourceSpan = schema.$defs?.sourceSpan;
  if (sourceSpan?.properties) {
    sourceSpan.description =
      'An exact narrative substring with JavaScript UTF-16 offsets. quote must equal narrative.slice(start_char, end_char), and end_char - start_char must equal quote.length.';
    sourceSpan.properties.quote.description =
      'Copy an exact contiguous substring from the supplied narrative without changing any character, punctuation, or whitespace.';
    sourceSpan.properties.start_char.description =
      'Zero-based JavaScript UTF-16 code-unit offset where the exact quote starts in the supplied narrative.';
    sourceSpan.properties.end_char.description =
      'Exclusive JavaScript UTF-16 code-unit offset equal to start_char + quote.length.';
  }
}

const modelRootDefinitions = [
  'thirdParty',
  'agreement',
  'deliverableAssessment',
  'timelineEvent',
  'claim',
  'evidence',
  'claimEvidenceLink',
  'damagesClaim',
  'partyOutcomes',
  'extractionIssue',
  'clarificationQuestion',
];
const extractionRootDefinitions = [...modelRootDefinitions, 'party', 'submission'];

const modelProperties: Record<string, JsonSchema> = {
  schema_version: { type: 'string', const: '0.1.2' },
  party_profile: {
    type: 'object',
    additionalProperties: false,
    required: ['display_name', 'country', 'language'],
    properties: {
      display_name: { type: 'string', minLength: 1 },
      country: { type: ['string', 'null'] },
      language: { type: 'string', minLength: 2 },
    },
  },
  third_parties: { type: 'array', items: { $ref: '#/$defs/thirdParty' } },
  agreement: { $ref: '#/$defs/agreement' },
  deliverable_assessments: {
    type: 'array',
    items: { $ref: '#/$defs/deliverableAssessment' },
  },
  timeline: { type: 'array', items: { $ref: '#/$defs/timelineEvent' } },
  claims: { type: 'array', items: { $ref: '#/$defs/claim' } },
  evidence: { type: 'array', items: { $ref: '#/$defs/evidence' } },
  claim_evidence_links: {
    type: 'array',
    items: { $ref: '#/$defs/claimEvidenceLink' },
  },
  damages_claims: { type: 'array', items: { $ref: '#/$defs/damagesClaim' } },
  desired_outcomes: { $ref: '#/$defs/partyOutcomes' },
  extraction_issues: { type: 'array', items: { $ref: '#/$defs/extractionIssue' } },
  clarification_questions: {
    type: 'array',
    minItems: 3,
    maxItems: 8,
    items: { $ref: '#/$defs/clarificationQuestion' },
  },
};

export const personAModelOutputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(modelProperties),
  properties: modelProperties,
  $defs: collectDefs(modelRootDefinitions),
};

const extractionProperties: Record<string, JsonSchema> = {
  schema_version: { type: 'string', const: '0.1.2' },
  extractor_version: {
    type: 'string',
    enum: ['person-a-v0.1.1', 'person-a-v0.1.2'],
  },
  party: { $ref: '#/$defs/party' },
  submission: { $ref: '#/$defs/submission' },
  third_parties: { type: 'array', items: { $ref: '#/$defs/thirdParty' } },
  agreement: { $ref: '#/$defs/agreement' },
  deliverable_assessments: {
    type: 'array',
    items: { $ref: '#/$defs/deliverableAssessment' },
  },
  timeline: { type: 'array', items: { $ref: '#/$defs/timelineEvent' } },
  claims: { type: 'array', items: { $ref: '#/$defs/claim' } },
  evidence: { type: 'array', items: { $ref: '#/$defs/evidence' } },
  claim_evidence_links: {
    type: 'array',
    items: { $ref: '#/$defs/claimEvidenceLink' },
  },
  damages_claims: { type: 'array', items: { $ref: '#/$defs/damagesClaim' } },
  desired_outcomes: { $ref: '#/$defs/partyOutcomes' },
  extraction_issues: { type: 'array', items: { $ref: '#/$defs/extractionIssue' } },
  clarification_questions: {
    type: 'array',
    minItems: 3,
    maxItems: 8,
    items: { $ref: '#/$defs/clarificationQuestion' },
  },
  metadata: {
    type: 'object',
    additionalProperties: false,
    required: ['model', 'prompt_version', 'input_hash', 'generated_at'],
    properties: {
      model: { type: 'string', minLength: 1 },
      prompt_version: {
        type: 'string',
        enum: ['person-a-v0.1.1', 'person-a-v0.1.2'],
      },
      input_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      generated_at: { type: 'string', format: 'date-time' },
    },
  },
};

export const personAExtractionSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://juryai.dev/schemas/person-a-extraction-v0.1.0.schema.json',
  title: 'JuryAI Person A Extraction v0.1.0',
  type: 'object',
  additionalProperties: false,
  required: Object.keys(extractionProperties),
  properties: extractionProperties,
  $defs: collectDefs(extractionRootDefinitions),
};

export function buildOpenAIResponseSchema(): JsonSchema {
  const schema = structuredClone(personAModelOutputSchema);
  applyPersonAModelConstraints(schema);
  const stripUnsupportedKeywords = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(stripUnsupportedKeywords);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    for (const keyword of ['$schema', '$id', 'pattern', 'uniqueItems']) {
      delete object[keyword];
    }
    Object.values(object).forEach(stripUnsupportedKeywords);
  };
  stripUnsupportedKeywords(schema);
  return schema;
}
