-- Incompatible, production-dark V2.1.1 external-relay persistence amendment.
--
-- V2.1.0 was never activated and this migration intentionally refuses to run
-- if any dark formation or invitation row exists. The authoritative envelope
-- remains the only mutable canonical record. Sources, submissions, compiler
-- runs, and replays remain append-only evidence/idempotency records.

begin;

do $$
declare
  relation_name text;
  row_count bigint;
begin
  foreach relation_name in array array[
    'formation_disputes',
    'formation_sources',
    'formation_commands',
    'formation_submissions',
    'formation_compiler_runs',
    'formation_replays',
    'formation_invitations'
  ] loop
    if to_regclass('juryai_v21.' || relation_name) is null then
      raise exception 'V2.1.1 requires existing dark relation juryai_v21.%', relation_name;
    end if;
    execute format('select count(*) from juryai_v21.%I', relation_name) into row_count;
    if row_count <> 0 then
      raise exception 'V2.1.1 refuses to reinterpret % existing row(s) in juryai_v21.%',
        row_count, relation_name
        using errcode = '55000';
    end if;
  end loop;
end;
$$;

alter table juryai_v21.formation_disputes
  drop constraint formation_disputes_schema_v21,
  drop constraint formation_disputes_protocol_v21,
  add column external_submission_contract_version text generated always as (
    envelope #>> '{control,external_submission_contract_version}'
  ) stored,
  add constraint formation_disputes_schema_v211 check (
    schema_version = 'juryai-case-envelope-v2.1.1'
  ),
  add constraint formation_disputes_protocol_v211 check (
    protocol_version = 'juryai-formation-protocol-v2.1.1'
  ),
  add constraint formation_disputes_external_submission_v211 check (
    external_submission_contract_version = 'juryai-external-relay-submission-v2.1.1'
  );

alter table juryai_v21.formation_disputes
  alter column external_submission_contract_version set not null;

-- V2.1.1 submissions are the closed relay effect batch. They are not generic
-- envelope commands, so the historical command linkage is deliberately removed.
alter table juryai_v21.formation_sources
  add constraint formation_sources_id_turn_unique_v211
    unique (dispute_id, party_id, source_id, source_turn_id);

alter table juryai_v21.formation_submissions
  drop constraint formation_submissions_command_fk,
  drop constraint formation_submissions_ids_present,
  drop column command_id,
  add column source_turn_id text generated always as (record ->> 'source_turn_id') stored,
  add column base_internal_envelope_version bigint generated always as (
    (record ->> 'base_internal_envelope_version')::bigint
  ) stored,
  add column base_internal_envelope_hash text generated always as (
    record ->> 'base_internal_envelope_hash'
  ) stored,
  add column resulting_internal_envelope_version bigint generated always as (
    (record ->> 'resulting_internal_envelope_version')::bigint
  ) stored,
  add column resulting_internal_envelope_hash text generated always as (
    record ->> 'resulting_internal_envelope_hash'
  ) stored,
  add column resulting_party_visible_version bigint generated always as (
    (record ->> 'resulting_party_visible_version')::bigint
  ) stored,
  add column resulting_party_projection_hash text generated always as (
    record ->> 'resulting_party_projection_hash'
  ) stored,
  add constraint formation_submissions_ids_present_v211 check (
    length(submission_id) between 1 and 160
    and length(client_turn_id) between 1 and 200
    and length(btrim(client_turn_id)) > 0
    and length(source_id) between 1 and 160
    and length(source_turn_id) between 1 and 160
  ),
  add constraint formation_submissions_versions_v211 check (
    base_internal_envelope_version >= 1
    and resulting_internal_envelope_version = base_internal_envelope_version + 1
    and resulting_party_visible_version >= 1
  ),
  add constraint formation_submissions_hashes_v211 check (
    base_internal_envelope_hash ~ '^[a-f0-9]{64}$'
    and resulting_internal_envelope_hash ~ '^[a-f0-9]{64}$'
    and resulting_party_projection_hash ~ '^[a-f0-9]{64}$'
  ),
  add constraint formation_submissions_source_turn_fk_v211
    foreign key (dispute_id, party_id, source_id, source_turn_id)
    references juryai_v21.formation_sources (
      dispute_id, party_id, source_id, source_turn_id
    )
    on delete restrict,
  add constraint formation_submissions_party_turn_unique_v211
    unique (dispute_id, party_id, client_turn_id);

alter table juryai_v21.formation_submissions
  alter column source_turn_id set not null,
  alter column base_internal_envelope_version set not null,
  alter column base_internal_envelope_hash set not null,
  alter column resulting_internal_envelope_version set not null,
  alter column resulting_internal_envelope_hash set not null,
  alter column resulting_party_visible_version set not null,
  alter column resulting_party_projection_hash set not null;

alter table juryai_v21.formation_compiler_runs
  add constraint formation_compiler_runs_one_per_submission_v211
    unique (dispute_id, party_id, submission_id);

-- The command table remains reserved for trusted-system and first-party-human
-- ceremony commands. External relay submissions never write to it.

revoke all on schema juryai_v21 from public;
revoke all on all tables in schema juryai_v21 from public;
revoke all on all sequences in schema juryai_v21 from public;
revoke all on all functions in schema juryai_v21 from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema juryai_v21 from anon';
    execute 'revoke all on all tables in schema juryai_v21 from anon';
    execute 'revoke all on all sequences in schema juryai_v21 from anon';
    execute 'revoke all on all functions in schema juryai_v21 from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema juryai_v21 from authenticated';
    execute 'revoke all on all tables in schema juryai_v21 from authenticated';
    execute 'revoke all on all sequences in schema juryai_v21 from authenticated';
    execute 'revoke all on all functions in schema juryai_v21 from authenticated';
  end if;
end;
$$;

commit;
