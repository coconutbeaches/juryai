-- Stage V2.1.5 exact pairings without scanning under ACCESS EXCLUSIVE.
-- Keep the old validated constraints until the separate validation and activation
-- migrations finish. Run these files separately, never in one outer transaction.
begin;
set local lock_timeout = '5s';

alter table juryai_v21.formation_disputes
  add constraint formation_disputes_external_submission_v215_stage check (
    (schema_version = 'juryai-case-envelope-v2.1.1'
      and external_submission_contract_version = 'juryai-external-relay-submission-v2.1.1')
    or (schema_version = 'juryai-case-envelope-v2.1.2'
      and external_submission_contract_version = 'juryai-external-relay-submission-v2.1.1')
    or (schema_version = 'juryai-case-envelope-v2.1.3'
      and external_submission_contract_version = 'juryai-external-relay-submission-v2.1.3')
    or (schema_version = 'juryai-case-envelope-v2.1.4'
      and external_submission_contract_version = 'juryai-external-relay-submission-v2.1.4')
    or (schema_version = 'juryai-case-envelope-v2.1.5'
      and external_submission_contract_version = 'juryai-external-relay-submission-v2.1.5')
  ) not valid;

alter table juryai_v21.formation_disputes
  add constraint formation_disputes_contract_pair_v215_stage check (
    (schema_version = 'juryai-case-envelope-v2.1.1'
      and protocol_version = 'juryai-formation-protocol-v2.1.1')
    or
    (schema_version = 'juryai-case-envelope-v2.1.2'
      and protocol_version = 'juryai-formation-protocol-v2.1.2'
      and envelope #>> '{control,command_contract_version}' is not distinct from 'juryai-envelope-command-v2.1.2'
      and envelope #>> '{control,readiness_contract_version}' is not distinct from 'juryai-formation-readiness-v2.1.2'
      and envelope #>> '{control,projection_contract_version}' is not distinct from 'juryai-party-formation-projection-v2.1.1'
      and jsonb_typeof(envelope #> '{formation,disclosure_review_acknowledgments}') is not distinct from 'object'
      and jsonb_typeof(envelope #> '{formation,disclosure_review_acknowledgments,party_a}') is not distinct from 'array'
      and jsonb_typeof(envelope #> '{formation,disclosure_review_acknowledgments,party_b}') is not distinct from 'array')
    or
    (schema_version = 'juryai-case-envelope-v2.1.3'
      and protocol_version = 'juryai-formation-protocol-v2.1.3'
      and envelope #>> '{control,command_contract_version}' is not distinct from 'juryai-envelope-command-v2.1.3'
      and envelope #>> '{control,readiness_contract_version}' is not distinct from 'juryai-formation-readiness-v2.1.3'
      and envelope #>> '{control,projection_contract_version}' is not distinct from 'juryai-party-formation-projection-v2.1.3'
      and envelope #>> '{control,external_submission_contract_version}' is not distinct from 'juryai-external-relay-submission-v2.1.3'
      and jsonb_typeof(envelope #> '{formation,disclosure_review_acknowledgments}') is not distinct from 'object'
      and jsonb_typeof(envelope #> '{formation,disclosure_review_acknowledgments,party_a}') is not distinct from 'array'
      and jsonb_typeof(envelope #> '{formation,disclosure_review_acknowledgments,party_b}') is not distinct from 'array')
    or
    (schema_version = 'juryai-case-envelope-v2.1.4'
      and protocol_version = 'juryai-formation-protocol-v2.1.4'
      and envelope #>> '{control,command_contract_version}' is not distinct from 'juryai-envelope-command-v2.1.4'
      and envelope #>> '{control,readiness_contract_version}' is not distinct from 'juryai-formation-readiness-v2.1.4'
      and envelope #>> '{control,projection_contract_version}' is not distinct from 'juryai-party-formation-projection-v2.1.4'
      and envelope #>> '{control,external_submission_contract_version}' is not distinct from 'juryai-external-relay-submission-v2.1.4'
      and jsonb_typeof(envelope #> '{formation,disclosure_review_acknowledgments}') is not distinct from 'object'
      and jsonb_typeof(envelope #> '{formation,disclosure_review_acknowledgments,party_a}') is not distinct from 'array'
      and jsonb_typeof(envelope #> '{formation,disclosure_review_acknowledgments,party_b}') is not distinct from 'array')
    or
    (schema_version = 'juryai-case-envelope-v2.1.5'
      and protocol_version = 'juryai-formation-protocol-v2.1.5'
      and envelope #>> '{control,command_contract_version}' is not distinct from 'juryai-envelope-command-v2.1.5'
      and envelope #>> '{control,readiness_contract_version}' is not distinct from 'juryai-formation-readiness-v2.1.5'
      and envelope #>> '{control,projection_contract_version}' is not distinct from 'juryai-party-formation-projection-v2.1.5'
      and envelope #>> '{control,external_submission_contract_version}' is not distinct from 'juryai-external-relay-submission-v2.1.5'
      and jsonb_typeof(envelope #> '{formation,disclosure_review_acknowledgments}') is not distinct from 'object'
      and jsonb_typeof(envelope #> '{formation,disclosure_review_acknowledgments,party_a}') is not distinct from 'array'
      and jsonb_typeof(envelope #> '{formation,disclosure_review_acknowledgments,party_b}') is not distinct from 'array')
  ) not valid;

alter table juryai_v21.formation_assurance_challenges
  add constraint formation_assurance_challenges_payload_binding_v215_stage check (
    action_payload ->> 'review_state_hash' is not distinct from review_state_hash
    and (
      (action_payload ->> 'protected_action_version' is not distinct from 'juryai-party-review-protected-action-v1.0.0'
        and action_payload #>> '{ceremony_command,command_version}' is not distinct from 'juryai-envelope-command-v2.1.1')
      or
      (action_payload ->> 'protected_action_version' is not distinct from 'juryai-party-review-protected-action-v1.1.0'
        and action_payload #>> '{ceremony_command,command_version}' is not distinct from 'juryai-envelope-command-v2.1.2')
      or
      (action_payload ->> 'protected_action_version' is not distinct from 'juryai-party-review-protected-action-v1.2.0'
        and action_payload #>> '{ceremony_command,command_version}' is not distinct from 'juryai-envelope-command-v2.1.3')
      or
      (action_payload ->> 'protected_action_version' is not distinct from 'juryai-party-review-protected-action-v1.3.0'
        and action_payload #>> '{ceremony_command,command_version}' is not distinct from 'juryai-envelope-command-v2.1.4')
      or
      (action_payload ->> 'protected_action_version' is not distinct from 'juryai-party-review-protected-action-v1.4.0'
        and action_payload #>> '{ceremony_command,command_version}' is not distinct from 'juryai-envelope-command-v2.1.5')
    )
  ) not valid;

commit;
