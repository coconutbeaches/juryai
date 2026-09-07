-- Short metadata-only swap. Both old constraints and staged constraints remain
-- enforced until all three replacements have validated. No table scan occurs here.
begin;
set local lock_timeout = '5s';

lock table juryai_v21.formation_disputes,
           juryai_v21.formation_assurance_challenges in access exclusive mode;

do $$
begin
  if (select count(*) from pg_constraint
      where convalidated and (
        (conrelid = 'juryai_v21.formation_disputes'::regclass
          and conname in ('formation_disputes_external_submission_v215_stage',
                          'formation_disputes_contract_pair_v215_stage'))
        or
        (conrelid = 'juryai_v21.formation_assurance_challenges'::regclass
          and conname = 'formation_assurance_challenges_payload_binding_v215_stage')
      )) <> 3 then
    raise exception 'V2.1.5 staged constraints must all be validated before activation'
      using errcode = '55000';
  end if;
end
$$;

alter table juryai_v21.formation_disputes
  drop constraint formation_disputes_external_submission_v211,
  drop constraint formation_disputes_contract_pair_v212;
alter table juryai_v21.formation_disputes
  rename constraint formation_disputes_external_submission_v215_stage
  to formation_disputes_external_submission_v211;
alter table juryai_v21.formation_disputes
  rename constraint formation_disputes_contract_pair_v215_stage
  to formation_disputes_contract_pair_v212;

alter table juryai_v21.formation_assurance_challenges
  drop constraint formation_assurance_challenges_payload_binding;
alter table juryai_v21.formation_assurance_challenges
  rename constraint formation_assurance_challenges_payload_binding_v215_stage
  to formation_assurance_challenges_payload_binding;

commit;
