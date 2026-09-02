-- Dark V2.1 two-party formation persistence.
--
-- The CaseEnvelope JSONB document is the sole mutable canonical truth. Every
-- other relation in this schema is append-only audit, history, or replay data.
-- Nothing in this migration exposes a production route, invitation, participant
-- binding service, browser grant, or WebMCP surface.

create schema if not exists juryai_v21;

revoke all on schema juryai_v21 from public;

create table juryai_v21.formation_disputes (
  dispute_id text generated always as (envelope #>> '{control,case_id}') stored primary key,
  schema_version text generated always as (envelope #>> '{control,schema_version}') stored not null,
  protocol_version text generated always as (envelope #>> '{control,protocol_version}') stored not null,
  internal_envelope_version bigint generated always as (
    (envelope #>> '{control,envelope_version}')::bigint
  ) stored not null,
  internal_envelope_hash text generated always as (
    envelope #>> '{control,envelope_hash}'
  ) stored not null,
  party_a_principal_id text generated always as (
    envelope #>> '{parties,party_a,authenticated_subject_id}'
  ) stored,
  party_b_principal_id text generated always as (
    envelope #>> '{parties,party_b,authenticated_subject_id}'
  ) stored,
  envelope jsonb not null,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint formation_disputes_envelope_object check (jsonb_typeof(envelope) = 'object'),
  constraint formation_disputes_id_v21 check (
    dispute_id ~ '^dispute_[A-Za-z0-9_.:-]+$' and length(dispute_id) <= 160
  ),
  constraint formation_disputes_schema_v21 check (
    schema_version = 'juryai-case-envelope-v2.1.0'
  ),
  constraint formation_disputes_protocol_v21 check (
    protocol_version = 'juryai-formation-protocol-v2.1.0'
  ),
  constraint formation_disputes_version_positive check (internal_envelope_version >= 1),
  constraint formation_disputes_hash_valid check (internal_envelope_hash ~ '^[a-f0-9]{64}$'),
  constraint formation_disputes_party_a_binding_shape check (
    (
      envelope #>> '{parties,party_a,identity_assurance}' = 'unbound'
      and party_a_principal_id is null
    )
    or (
      envelope #>> '{parties,party_a,identity_assurance}' = 'authenticated'
      and party_a_principal_id is not null
      and length(party_a_principal_id) > 0
    )
  ),
  constraint formation_disputes_party_b_binding_shape check (
    (
      envelope #>> '{parties,party_b,identity_assurance}' = 'unbound'
      and party_b_principal_id is null
    )
    or (
      envelope #>> '{parties,party_b,identity_assurance}' = 'authenticated'
      and party_b_principal_id is not null
      and length(party_b_principal_id) > 0
    )
  ),
  constraint formation_disputes_distinct_principals check (
    party_a_principal_id is null
    or party_b_principal_id is null
    or party_a_principal_id <> party_b_principal_id
  ),
  constraint formation_disputes_timestamps_ordered check (updated_at >= created_at)
);

-- Non-unique lookup indexes deliberately allow one principal to participate in
-- any number of disputes and in different party roles across those disputes.
create index formation_disputes_party_a_principal_idx
  on juryai_v21.formation_disputes (party_a_principal_id, dispute_id)
  where party_a_principal_id is not null;
create index formation_disputes_party_b_principal_idx
  on juryai_v21.formation_disputes (party_b_principal_id, dispute_id)
  where party_b_principal_id is not null;

create table juryai_v21.formation_sources (
  dispute_id text generated always as (record ->> 'dispute_id') stored,
  party_id text generated always as (record ->> 'party_id') stored,
  source_id text generated always as (record ->> 'source_id') stored,
  source_turn_id text generated always as (record ->> 'source_turn_id') stored not null,
  source_hash text generated always as (record ->> 'source_hash') stored not null,
  recorded_at_ms bigint generated always as ((record ->> 'recorded_at_ms')::bigint) stored not null,
  record jsonb not null,
  primary key (dispute_id, party_id, source_id),
  constraint formation_sources_dispute_fk foreign key (dispute_id)
    references juryai_v21.formation_disputes (dispute_id) on delete restrict,
  constraint formation_sources_record_object check (jsonb_typeof(record) = 'object'),
  constraint formation_sources_dispute_v21 check (
    dispute_id ~ '^dispute_[A-Za-z0-9_.:-]+$' and length(dispute_id) <= 160
  ),
  constraint formation_sources_party check (party_id in ('party_a', 'party_b')),
  constraint formation_sources_id_present check (length(source_id) between 1 and 160),
  constraint formation_sources_turn_present check (length(source_turn_id) between 1 and 160),
  constraint formation_sources_hash_valid check (source_hash ~ '^[a-f0-9]{64}$'),
  constraint formation_sources_recorded_at_valid check (
    recorded_at_ms >= 0 and recorded_at_ms <= 9007199254740991
  ),
  constraint formation_sources_turn_unique unique (dispute_id, party_id, source_turn_id)
);

create table juryai_v21.formation_commands (
  dispute_id text generated always as (record ->> 'dispute_id') stored,
  party_id text generated always as (record ->> 'party_id') stored,
  command_id text generated always as (record ->> 'command_id') stored,
  base_envelope_version bigint generated always as (
    (record ->> 'base_envelope_version')::bigint
  ) stored not null,
  base_envelope_hash text generated always as (record ->> 'base_envelope_hash') stored not null,
  resulting_envelope_version bigint generated always as (
    (record ->> 'resulting_envelope_version')::bigint
  ) stored not null,
  resulting_envelope_hash text generated always as (
    record ->> 'resulting_envelope_hash'
  ) stored not null,
  recorded_at_ms bigint generated always as ((record ->> 'recorded_at_ms')::bigint) stored not null,
  record jsonb not null,
  primary key (dispute_id, party_id, command_id),
  constraint formation_commands_dispute_fk foreign key (dispute_id)
    references juryai_v21.formation_disputes (dispute_id) on delete restrict,
  constraint formation_commands_record_object check (jsonb_typeof(record) = 'object'),
  constraint formation_commands_dispute_v21 check (
    dispute_id ~ '^dispute_[A-Za-z0-9_.:-]+$' and length(dispute_id) <= 160
  ),
  constraint formation_commands_party check (party_id in ('party_a', 'party_b')),
  constraint formation_commands_id_present check (length(command_id) between 1 and 160),
  constraint formation_commands_versions_valid check (
    base_envelope_version >= 1
    and resulting_envelope_version = base_envelope_version + 1
  ),
  constraint formation_commands_hashes_valid check (
    base_envelope_hash ~ '^[a-f0-9]{64}$'
    and resulting_envelope_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint formation_commands_recorded_at_valid check (
    recorded_at_ms >= 0 and recorded_at_ms <= 9007199254740991
  )
);

create table juryai_v21.formation_submissions (
  dispute_id text generated always as (record ->> 'dispute_id') stored,
  party_id text generated always as (record ->> 'party_id') stored,
  submission_id text generated always as (record ->> 'submission_id') stored,
  client_turn_id text generated always as (record ->> 'client_turn_id') stored not null,
  source_id text generated always as (record ->> 'source_id') stored not null,
  command_id text generated always as (record ->> 'command_id') stored not null,
  recorded_at_ms bigint generated always as ((record ->> 'recorded_at_ms')::bigint) stored not null,
  record jsonb not null,
  primary key (dispute_id, party_id, submission_id),
  constraint formation_submissions_dispute_fk foreign key (dispute_id)
    references juryai_v21.formation_disputes (dispute_id) on delete restrict,
  constraint formation_submissions_source_fk foreign key (dispute_id, party_id, source_id)
    references juryai_v21.formation_sources (dispute_id, party_id, source_id) on delete restrict,
  constraint formation_submissions_command_fk foreign key (dispute_id, party_id, command_id)
    references juryai_v21.formation_commands (dispute_id, party_id, command_id) on delete restrict,
  constraint formation_submissions_record_object check (jsonb_typeof(record) = 'object'),
  constraint formation_submissions_dispute_v21 check (
    dispute_id ~ '^dispute_[A-Za-z0-9_.:-]+$' and length(dispute_id) <= 160
  ),
  constraint formation_submissions_party check (party_id in ('party_a', 'party_b')),
  constraint formation_submissions_ids_present check (
    length(submission_id) between 1 and 160
    and length(client_turn_id) between 1 and 200
    and length(btrim(client_turn_id)) > 0
    and length(source_id) between 1 and 160
    and length(command_id) between 1 and 160
  ),
  constraint formation_submissions_recorded_at_valid check (
    recorded_at_ms >= 0 and recorded_at_ms <= 9007199254740991
  )
);

create table juryai_v21.formation_compiler_runs (
  dispute_id text generated always as (record ->> 'dispute_id') stored,
  party_id text generated always as (record ->> 'party_id') stored,
  compiler_run_id text generated always as (record ->> 'compiler_run_id') stored,
  submission_id text generated always as (record ->> 'submission_id') stored not null,
  compiler_version_id text generated always as (record ->> 'compiler_version_id') stored not null,
  input_hash text generated always as (record ->> 'input_hash') stored not null,
  output_hash text generated always as (record ->> 'output_hash') stored not null,
  recorded_at_ms bigint generated always as ((record ->> 'recorded_at_ms')::bigint) stored not null,
  record jsonb not null,
  primary key (dispute_id, party_id, compiler_run_id),
  constraint formation_compiler_runs_dispute_fk foreign key (dispute_id)
    references juryai_v21.formation_disputes (dispute_id) on delete restrict,
  constraint formation_compiler_runs_submission_fk
    foreign key (dispute_id, party_id, submission_id)
    references juryai_v21.formation_submissions (dispute_id, party_id, submission_id)
    on delete restrict,
  constraint formation_compiler_runs_record_object check (jsonb_typeof(record) = 'object'),
  constraint formation_compiler_runs_dispute_v21 check (
    dispute_id ~ '^dispute_[A-Za-z0-9_.:-]+$' and length(dispute_id) <= 160
  ),
  constraint formation_compiler_runs_party check (party_id in ('party_a', 'party_b')),
  constraint formation_compiler_runs_ids_present check (
    length(compiler_run_id) between 1 and 160
    and length(submission_id) between 1 and 160
  ),
  constraint formation_compiler_runs_hashes_valid check (
    compiler_version_id ~ '^[a-f0-9]{64}$'
    and input_hash ~ '^[a-f0-9]{64}$'
    and output_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint formation_compiler_runs_recorded_at_valid check (
    recorded_at_ms >= 0 and recorded_at_ms <= 9007199254740991
  )
);

create table juryai_v21.formation_replays (
  storage_sequence bigint generated always as identity primary key,
  dispute_id text generated always as (record ->> 'dispute_id') stored not null,
  party_id text generated always as (record ->> 'party_id') stored not null,
  client_turn_id text generated always as (record ->> 'client_turn_id') stored not null,
  request_fingerprint text generated always as (record ->> 'request_fingerprint') stored not null,
  recorded_at_ms bigint generated always as ((record ->> 'recorded_at_ms')::bigint) stored not null,
  record jsonb not null,
  constraint formation_replays_dispute_fk foreign key (dispute_id)
    references juryai_v21.formation_disputes (dispute_id) on delete restrict,
  constraint formation_replays_record_object check (jsonb_typeof(record) = 'object'),
  constraint formation_replays_dispute_v21 check (
    dispute_id ~ '^dispute_[A-Za-z0-9_.:-]+$' and length(dispute_id) <= 160
  ),
  constraint formation_replays_party check (party_id in ('party_a', 'party_b')),
  constraint formation_replays_client_turn_present check (
    length(client_turn_id) between 1 and 200
    and length(btrim(client_turn_id)) > 0
  ),
  constraint formation_replays_fingerprint_valid check (
    request_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint formation_replays_response_object check (
    record ? 'response' and jsonb_typeof(record -> 'response') = 'object'
  ),
  constraint formation_replays_recorded_at_valid check (
    recorded_at_ms >= 0 and recorded_at_ms <= 9007199254740991
  ),
  constraint formation_replays_party_turn_unique
    unique (dispute_id, party_id, client_turn_id)
);

create index formation_sources_dispute_idx
  on juryai_v21.formation_sources (dispute_id, party_id, recorded_at_ms);
create index formation_commands_dispute_idx
  on juryai_v21.formation_commands (dispute_id, party_id, recorded_at_ms);
create index formation_submissions_dispute_idx
  on juryai_v21.formation_submissions (dispute_id, party_id, recorded_at_ms);
create index formation_compiler_runs_dispute_idx
  on juryai_v21.formation_compiler_runs (dispute_id, party_id, recorded_at_ms);
create index formation_replays_dispute_idx
  on juryai_v21.formation_replays (dispute_id, party_id, recorded_at_ms, storage_sequence);

create function juryai_v21.reject_append_only_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception '% is append-only', tg_table_schema || '.' || tg_table_name
    using errcode = '55000';
end;
$$;

create trigger formation_sources_append_only
before update or delete on juryai_v21.formation_sources
for each row execute function juryai_v21.reject_append_only_mutation();
create trigger formation_commands_append_only
before update or delete on juryai_v21.formation_commands
for each row execute function juryai_v21.reject_append_only_mutation();
create trigger formation_submissions_append_only
before update or delete on juryai_v21.formation_submissions
for each row execute function juryai_v21.reject_append_only_mutation();
create trigger formation_compiler_runs_append_only
before update or delete on juryai_v21.formation_compiler_runs
for each row execute function juryai_v21.reject_append_only_mutation();
create trigger formation_replays_append_only
before update or delete on juryai_v21.formation_replays
for each row execute function juryai_v21.reject_append_only_mutation();

alter table juryai_v21.formation_disputes enable row level security;
alter table juryai_v21.formation_sources enable row level security;
alter table juryai_v21.formation_commands enable row level security;
alter table juryai_v21.formation_submissions enable row level security;
alter table juryai_v21.formation_compiler_runs enable row level security;
alter table juryai_v21.formation_replays enable row level security;

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
