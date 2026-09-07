import {
  assertValidGenerationSpec,
  type GenerationSpec,
  type ValidatedGenerationSpec,
} from '../formation/generation-spec.js';
const V215_RAW: GenerationSpec & {
  requirements: {
    initial_requirement_set_version: string;
    artifact_hash: string;
    persisted_artifact_hash: string;
  };
} = {
  identity: {
    generation_id: 'v2.1.5',
    display_label: 'V2.1.5',
    envelope_schema_version: 'juryai-case-envelope-v2.1.5',
    formation_protocol_version: 'juryai-formation-protocol-v2.1.5',
    is_current_writer: true,
  },
  contracts: {
    command_version: 'juryai-envelope-command-v2.1.5',
    projection_version: 'juryai-party-formation-projection-v2.1.5',
    readback_version: 'juryai-party-formation-readback-v2.1.5',
    readiness_version: 'juryai-formation-readiness-v2.1.5',
    confirmation_version: 'juryai-party-confirmation-v2.1.5',
    disclosure_acknowledgment_version: 'juryai-disclosure-review-acknowledgment-v2.1.5',
    disclosure_acknowledgment_statement:
      'I have reviewed the currently disclosed case material and have no further challenges to raise at this time.',
    external_relay_submission_version: 'juryai-external-relay-submission-v2.1.5',
    external_relay_submission_intent_version: 'juryai-external-relay-submission-intent-v2.1.1',
    persistence_version: 'juryai-v2.1.5-formation-persistence-v1',
    review_page_version: 'juryai-v2.1.5-first-party-review-page-v1.0.0',
    protected_action_version: 'juryai-party-review-protected-action-v1.4.0',
    party_review_state_version: 'juryai-party-review-state-v1.2.0',
    contract_issue_code_prefix: 'v215_',
  },
  requirements: {
    initial_requirement_set_version: 'juryai-p2-initial-requirements-v0.4.0',
    artifact_hash: '09b001b76017d95da304fc4fd007658fb381699ce35ae9cbcf6291e21a081ff6',
    persisted_artifact_hash: '8fb4837eab3c9c247816470619704c6a29c6da67b822c610ab7159fe6fea0b9c',
  },
  policy: {
    proposition_cardinality: 'multi_live',
    assertion_requirement_scope: 'all_own_requirements',
  },
  compiler: {
    contract_version: 'juryai-webmcp-compiler-contract-v0.4.0',
    taxonomy_version: 'juryai-p2-v0.3.0',
    assertion_cardinality_policy: 'multi_live',
  },
  authority: {
    trusted_system_authority_kind: 'trusted_domain_system_v2_1_5',
    trusted_external_relay_bridge_kind: 'trusted_external_relay_bridge_v2_1_5',
    production_invitation_authority_kind: 'trusted_v2_1_5_production_invitation',
  },
  persistence: {
    contract_pair: {
      envelope_schema_version: 'juryai-case-envelope-v2.1.5',
      formation_protocol_version: 'juryai-formation-protocol-v2.1.5',
      command_version: 'juryai-envelope-command-v2.1.5',
      readiness_version: 'juryai-formation-readiness-v2.1.5',
      projection_version: 'juryai-party-formation-projection-v2.1.5',
      external_relay_submission_version: 'juryai-external-relay-submission-v2.1.5',
    },
  },
  decoding: {
    review_page_version: 'juryai-v2.1.5-first-party-review-page-v1.0.0',
  },
};

export const V215_SPEC = assertValidGenerationSpec(V215_RAW) as ValidatedGenerationSpec & {
  requirements: typeof V215_RAW.requirements;
};
