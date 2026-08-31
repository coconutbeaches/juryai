-- Step 63.5 browser authentication remains in JuryAI's private backend schema.
-- These tables are not exposed through the Supabase Data API.

create table juryai_p2.web_sessions (
  session_id_hash text primary key,
  principal_id text not null,
  auth_provider text not null,
  auth_subject uuid not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint web_sessions_hash_sha256_hex check (session_id_hash ~ '^[a-f0-9]{64}$'),
  constraint web_sessions_provider_supabase check (auth_provider = 'supabase'),
  constraint web_sessions_principal_canonical check (
    principal_id = 'supabase:' || auth_subject::text
  ),
  constraint web_sessions_expiry_after_creation check (expires_at > created_at),
  constraint web_sessions_revocation_after_creation check (
    revoked_at is null or revoked_at >= created_at
  )
);

create index web_sessions_active_expiry_idx
  on juryai_p2.web_sessions (expires_at)
  where revoked_at is null;

create table juryai_p2.disclosure_acceptances (
  principal_id text not null,
  disclosure_version text not null,
  accepted_at timestamptz not null,
  primary key (principal_id, disclosure_version),
  constraint disclosure_acceptances_principal_canonical check (
    principal_id ~ '^supabase:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint disclosure_acceptances_version_present check (length(disclosure_version) > 0)
);

create trigger disclosure_acceptances_append_only
before update or delete on juryai_p2.disclosure_acceptances
for each row execute function juryai_p2.reject_append_only_mutation();

alter table juryai_p2.web_sessions enable row level security;
alter table juryai_p2.disclosure_acceptances enable row level security;

revoke all on juryai_p2.web_sessions from public;
revoke all on juryai_p2.disclosure_acceptances from public;

-- Local PostgreSQL integration does not define Supabase's API roles. Revoke
-- explicitly when they exist without making the migration depend on them.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema juryai_p2 from anon';
    execute 'revoke all on juryai_p2.web_sessions from anon';
    execute 'revoke all on juryai_p2.disclosure_acceptances from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema juryai_p2 from authenticated';
    execute 'revoke all on juryai_p2.web_sessions from authenticated';
    execute 'revoke all on juryai_p2.disclosure_acceptances from authenticated';
  end if;
end;
$$;
