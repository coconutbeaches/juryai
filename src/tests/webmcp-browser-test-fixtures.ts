import {
  WEBMCP_CORE_SCHEMA_VERSION,
  WEBMCP_PROTOCOL_VERSION,
  type CaseStateResponse,
} from '../webmcp/public-contract.js';

export const PUBLIC_CASE_STATE: CaseStateResponse = {
  case_id: 'case_browser_1',
  case_version: 3,
  protocol_version: WEBMCP_PROTOCOL_VERSION,
  schema_version: WEBMCP_CORE_SCHEMA_VERSION,
  status: 'draft',
  unresolved_requirement_count: 1,
  next_requirements: [{ requirement_id: 'req_expected_date', prompt: 'What date did you expect?' }],
  open_clarifications: [],
  recent_interpretations: [
    {
      proposition_id: 'prop_1',
      requirement_id: 'req_expected_date',
      statement: 'The user expected completion by 25 April.',
      type: 'target_date',
      epistemic_strength: 'recalled_uncertain',
      attribution: 'as relayed by an external AI assistant',
    },
  ],
  evidence_references: [],
  warnings: [],
  review_url: 'https://juryai.test/cases/case_browser_1/review',
};
