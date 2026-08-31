-- Step 64 render challenges are private, hash-addressed, single-use bindings.
-- The raw opaque challenge is returned to the authenticated browser and is
-- never stored here while active.

create table juryai_p2.render_challenges (
  challenge_hash text primary key,
  principal_id text not null,
  case_id text not null references juryai_p2.cases (case_id) on delete restrict,
  case_version bigint not null,
  rendered_document_hash text not null,
  render_template_version text not null,
  attestation_contract_version text not null,
  adoption_statement_hash text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attestation_id text,
  constraint render_challenges_hash_sha256 check (challenge_hash ~ '^[a-f0-9]{64}$'),
  constraint render_challenges_principal_present check (length(principal_id) > 0),
  constraint render_challenges_case_present check (length(case_id) > 0),
  constraint render_challenges_case_version_nonnegative check (case_version >= 0),
  constraint render_challenges_document_hash_sha256 check (
    rendered_document_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint render_challenges_template_present check (length(render_template_version) > 0),
  constraint render_challenges_contract_present check (length(attestation_contract_version) > 0),
  constraint render_challenges_adoption_hash_sha256 check (
    adoption_statement_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint render_challenges_expiry_after_issue check (expires_at > issued_at),
  constraint render_challenges_consumption_after_issue check (
    consumed_at is null or consumed_at >= issued_at
  ),
  constraint render_challenges_single_consumption check (
    (consumed_at is null and attestation_id is null)
    or (consumed_at is not null and attestation_id is not null and length(attestation_id) > 0)
  )
);

create index render_challenges_case_idx
  on juryai_p2.render_challenges (case_id, issued_at desc);
create index render_challenges_expiry_idx
  on juryai_p2.render_challenges (expires_at)
  where consumed_at is null;

-- Only the transition from active to consumed is mutable. Every binding is
-- immutable and a consumed challenge cannot be cleared or rebound.
create function juryai_p2.protect_render_challenge()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'juryai_p2.render_challenges cannot be deleted' using errcode = '55000';
  end if;
  if old.consumed_at is not null
     or new.challenge_hash is distinct from old.challenge_hash
     or new.principal_id is distinct from old.principal_id
     or new.case_id is distinct from old.case_id
     or new.case_version is distinct from old.case_version
     or new.rendered_document_hash is distinct from old.rendered_document_hash
     or new.render_template_version is distinct from old.render_template_version
     or new.attestation_contract_version is distinct from old.attestation_contract_version
     or new.adoption_statement_hash is distinct from old.adoption_statement_hash
     or new.issued_at is distinct from old.issued_at
     or new.expires_at is distinct from old.expires_at
     or new.consumed_at is null
     or new.attestation_id is null then
    raise exception 'juryai_p2.render_challenges bindings are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger render_challenges_protected
before update or delete on juryai_p2.render_challenges
for each row execute function juryai_p2.protect_render_challenge();

alter table juryai_p2.render_challenges enable row level security;
revoke all on juryai_p2.render_challenges from public;
revoke all on function juryai_p2.protect_render_challenge() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema juryai_p2 from anon';
    execute 'revoke all on juryai_p2.render_challenges from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema juryai_p2 from authenticated';
    execute 'revoke all on juryai_p2.render_challenges from authenticated';
  end if;
end;
$$;
