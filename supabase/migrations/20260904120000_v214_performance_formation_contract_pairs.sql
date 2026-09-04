-- Add only exact V2.1.4 pairs. No data rewrite, conversion, table, column,
-- grant, policy, or authority change. Historical branches are unchanged, so
-- every persisted V2.1.1, V2.1.2 and V2.1.3 row stays valid exactly as written.
begin;

alter table juryai_v21.formation_disputes
  drop constraint formation_disputes_external_submission_v211,
  add constraint formation_disputes_external_submission_v211 check (
    (schema_version = 'juryai-case-envelope-v2.1.1'
      and external_submission_contract_version = 'juryai-external-relay-submission-v2.1.1')
    or (schema_version = 'juryai-case-envelope-v2.1.2'
      and external_submission_contract_version = 'juryai-external-relay-submission-v2.1.1')
    or (schema_version = 'juryai-case-envelope-v2.1.3'
      and external_submission_contract_version = 'juryai-external-relay-submission-v2.1.3')
    or (schema_version = 'juryai-case-envelope-v2.1.4'
      and external_submission_contract_version = 'juryai-external-relay-submission-v2.1.4')
  );

alter table juryai_v21.formation_disputes
  drop constraint formation_disputes_contract_pair_v212,
  add constraint formation_disputes_contract_pair_v212 check (
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
  );

alter table juryai_v21.formation_assurance_challenges
  drop constraint formation_assurance_challenges_payload_binding,
  add constraint formation_assurance_challenges_payload_binding check (
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
    )
  );

commit;
