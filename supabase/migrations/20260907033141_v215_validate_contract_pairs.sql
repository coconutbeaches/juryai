-- Separate transaction: validation scans hold SHARE UPDATE EXCLUSIVE, which
-- permits ordinary SELECT/INSERT/UPDATE/DELETE. The old constraints still enforce
-- historical pairings; V2.1.5 stays unavailable until the activation migration.
begin;
set local lock_timeout = '5s';

alter table juryai_v21.formation_disputes
  validate constraint formation_disputes_external_submission_v215_stage,
  validate constraint formation_disputes_contract_pair_v215_stage;

alter table juryai_v21.formation_assurance_challenges
  validate constraint formation_assurance_challenges_payload_binding_v215_stage;

commit;
