-- JuryAI P2 persistence lives in a private schema and is reached only by the
-- trusted backend over a PostgreSQL connection. It is not a Data API surface.
create schema if not exists juryai_p2;

revoke all on schema juryai_p2 from public;

create table juryai_p2.cases (
  case_id text generated always as (state ->> 'case_id') stored primary key,
  principal_id text generated always as (state ->> 'principal_id') stored not null,
  revision bigint not null default 1,
  state jsonb not null,
  constraint cases_revision_positive check (revision >= 1),
  constraint cases_state_object check (jsonb_typeof(state) = 'object'),
  constraint cases_case_id_present check (length(case_id) > 0),
  constraint cases_principal_id_present check (length(principal_id) > 0),
  constraint cases_case_version_valid check (
    state ? 'case_version'
    and jsonb_typeof(state -> 'case_version') = 'number'
    and (state ->> 'case_version')::numeric >= 0
    and (state ->> 'case_version')::numeric = trunc((state ->> 'case_version')::numeric)
  ),
  constraint cases_attestations_array check (
    state ? 'attestations' and jsonb_typeof(state -> 'attestations') = 'array'
  )
);

create index cases_principal_id_idx on juryai_p2.cases (principal_id);

create table juryai_p2.start_case_idempotency (
  principal_id text generated always as (record ->> 'principal_id') stored,
  client_request_id text generated always as (record ->> 'client_request_id') stored,
  case_id text generated always as (record ->> 'case_id') stored not null,
  recorded_at_ms bigint generated always as ((record ->> 'recorded_at_ms')::bigint) stored not null,
  record jsonb not null,
  primary key (principal_id, client_request_id),
  constraint start_case_idempotency_case_unique unique (case_id),
  constraint start_case_idempotency_case_fk
    foreign key (case_id) references juryai_p2.cases (case_id) on delete restrict,
  constraint start_case_idempotency_record_object check (jsonb_typeof(record) = 'object'),
  constraint start_case_idempotency_principal_present check (length(principal_id) > 0),
  constraint start_case_idempotency_request_present check (length(client_request_id) > 0),
  constraint start_case_idempotency_case_present check (length(case_id) > 0),
  constraint start_case_idempotency_recorded_at_valid check (
    recorded_at_ms >= 0 and recorded_at_ms <= 9007199254740991
  )
);

create index start_case_idempotency_case_id_idx
  on juryai_p2.start_case_idempotency (case_id);

create table juryai_p2.submit_idempotency (
  storage_sequence bigint generated always as identity,
  case_id text generated always as (record ->> 'case_id') stored not null,
  request_fingerprint text generated always as (record ->> 'request_fingerprint') stored not null,
  client_turn_id text generated always as (record ->> 'client_turn_id') stored,
  turn_id text generated always as (record ->> 'turn_id') stored primary key,
  recorded_at_ms bigint generated always as ((record ->> 'recorded_at_ms')::bigint) stored not null,
  record jsonb not null,
  constraint submit_idempotency_case_fk
    foreign key (case_id) references juryai_p2.cases (case_id) on delete restrict,
  constraint submit_idempotency_record_object check (jsonb_typeof(record) = 'object'),
  constraint submit_idempotency_case_present check (length(case_id) > 0),
  constraint submit_idempotency_fingerprint_valid check (
    request_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint submit_idempotency_turn_present check (length(turn_id) > 0),
  constraint submit_idempotency_client_turn_valid check (
    client_turn_id is null or length(client_turn_id) > 0
  ),
  constraint submit_idempotency_recorded_at_valid check (
    recorded_at_ms >= 0 and recorded_at_ms <= 9007199254740991
  ),
  constraint submit_idempotency_response_turn_matches check (
    record ? 'response'
    and jsonb_typeof(record -> 'response') = 'object'
    and record -> 'response' ->> 'turn_id' = turn_id
  )
);

-- Exact transport identity is case-scoped and lifetime-unique. A null id uses
-- the bounded fingerprint heuristic instead and therefore is not indexed here.
create unique index submit_idempotency_case_client_turn_id_uidx
  on juryai_p2.submit_idempotency (case_id, client_turn_id)
  where client_turn_id is not null;
create index submit_idempotency_case_recorded_at_idx
  on juryai_p2.submit_idempotency (case_id, recorded_at_ms, storage_sequence);
create index submit_idempotency_case_fingerprint_time_idx
  on juryai_p2.submit_idempotency (case_id, request_fingerprint, recorded_at_ms);

create table juryai_p2.compiler_registry (
  compiler_version_id text generated always as (entry ->> 'compiler_version_id') stored primary key,
  entry jsonb not null,
  constraint compiler_registry_entry_object check (jsonb_typeof(entry) = 'object'),
  constraint compiler_registry_id_valid check (compiler_version_id ~ '^[a-f0-9]{64}$')
);

create table juryai_p2.compile_runs (
  storage_sequence bigint generated always as identity,
  compile_run_id text generated always as (record ->> 'compile_run_id') stored primary key,
  case_id text generated always as (record ->> 'case_id') stored not null,
  turn_id text generated always as (record ->> 'turn_id') stored not null,
  compiler_version_id text generated always as (record ->> 'compiler_version_id') stored not null,
  record jsonb not null,
  constraint compile_runs_case_fk
    foreign key (case_id) references juryai_p2.cases (case_id) on delete restrict,
  constraint compile_runs_compiler_fk
    foreign key (compiler_version_id)
    references juryai_p2.compiler_registry (compiler_version_id) on delete restrict,
  constraint compile_runs_record_object check (jsonb_typeof(record) = 'object'),
  constraint compile_runs_id_present check (length(compile_run_id) > 0),
  constraint compile_runs_case_present check (length(case_id) > 0),
  constraint compile_runs_turn_present check (length(turn_id) > 0),
  constraint compile_runs_compiler_present check (length(compiler_version_id) > 0),
  constraint compile_runs_input_identity_matches check (
    record ? 'input'
    and jsonb_typeof(record -> 'input') = 'object'
    and record -> 'input' ->> 'compile_run_id' = compile_run_id
    and record -> 'input' ->> 'case_id' = case_id
    and record -> 'input' ->> 'compiler_version_id' = compiler_version_id
    and record -> 'input' -> 'turn' ->> 'turn_id' = turn_id
  ),
  constraint compile_runs_output_identity_matches check (
    record ? 'output'
    and jsonb_typeof(record -> 'output') = 'object'
    and record -> 'output' ->> 'compile_run_id' = compile_run_id
    and record -> 'output' ->> 'compiler_version_id' = compiler_version_id
  )
);

create index compile_runs_case_id_idx
  on juryai_p2.compile_runs (case_id, storage_sequence);
create index compile_runs_turn_id_idx on juryai_p2.compile_runs (turn_id);
create index compile_runs_compiler_version_id_idx
  on juryai_p2.compile_runs (compiler_version_id);

-- Identity and audit records are append-only even for a role that otherwise
-- has table-write privileges. The function is invoker-rights and pins its
-- search path; it is not a privileged public endpoint.
create function juryai_p2.reject_append_only_mutation()
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

create trigger start_case_idempotency_append_only
before update or delete on juryai_p2.start_case_idempotency
for each row execute function juryai_p2.reject_append_only_mutation();

create trigger submit_idempotency_append_only
before update or delete on juryai_p2.submit_idempotency
for each row execute function juryai_p2.reject_append_only_mutation();

create trigger compiler_registry_append_only
before update or delete on juryai_p2.compiler_registry
for each row execute function juryai_p2.reject_append_only_mutation();

create trigger compile_runs_append_only
before update or delete on juryai_p2.compile_runs
for each row execute function juryai_p2.reject_append_only_mutation();

-- Defense in depth for Supabase deployments: the schema is private, PUBLIC
-- has no grants, and no anon/authenticated policies are created. The trusted
-- backend database role remains the only repository path.
alter table juryai_p2.cases enable row level security;
alter table juryai_p2.start_case_idempotency enable row level security;
alter table juryai_p2.submit_idempotency enable row level security;
alter table juryai_p2.compiler_registry enable row level security;
alter table juryai_p2.compile_runs enable row level security;

revoke all on all tables in schema juryai_p2 from public;
revoke all on all sequences in schema juryai_p2 from public;
revoke all on all functions in schema juryai_p2 from public;
