-- Private, production-disabled V2.1 Party B invitation bootstrap.
--
-- The raw CSURL token is never stored. An invitation grants permission only
-- to attempt authenticated redemption; the authoritative Party B identity is
-- the resulting binding in formation_disputes.envelope.

create table juryai_v21.formation_invitations (
  invitation_id text primary key,
  dispute_id text not null,
  target_party_id text not null,
  issuer_party_id text not null,
  issuer_principal_id text not null,
  token_hash text not null unique,
  intended_account_commitment_version text not null,
  intended_account_commitment text not null,
  invitation_contract_version text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  redeemed_principal_id text,
  redemption_event_id text,
  redemption_envelope_version bigint,
  redemption_envelope_hash text,
  constraint formation_invitations_dispute_fk foreign key (dispute_id)
    references juryai_v21.formation_disputes (dispute_id) on delete restrict,
  constraint formation_invitations_id_valid check (
    invitation_id ~ '^invitation_[A-Za-z0-9_.:-]+$' and length(invitation_id) <= 160
  ),
  constraint formation_invitations_dispute_v21 check (
    dispute_id ~ '^dispute_[A-Za-z0-9_.:-]+$' and length(dispute_id) <= 160
  ),
  constraint formation_invitations_party_slots check (
    target_party_id = 'party_b' and issuer_party_id = 'party_a'
  ),
  constraint formation_invitations_issuer_valid check (
    issuer_principal_id ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,159}$'
  ),
  constraint formation_invitations_token_hash_valid check (
    token_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint formation_invitations_account_contract_valid check (
    intended_account_commitment_version =
      'juryai-v2.1-invitation-account-hmac-sha256-v1'
    and intended_account_commitment ~ '^[a-f0-9]{64}$'
  ),
  constraint formation_invitations_contract_valid check (
    invitation_contract_version = 'juryai-v2.1-formation-invitation-v1'
  ),
  constraint formation_invitations_expiry_valid check (
    expires_at > created_at
  ),
  constraint formation_invitations_redemption_shape check (
    (
      consumed_at is null
      and redeemed_principal_id is null
      and redemption_event_id is null
      and redemption_envelope_version is null
      and redemption_envelope_hash is null
    )
    or (
      consumed_at is not null
      and consumed_at >= created_at
      and consumed_at < expires_at
      and redeemed_principal_id ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,159}$'
      and redemption_event_id ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,159}$'
      and redemption_envelope_version >= 1
      and redemption_envelope_hash ~ '^[a-f0-9]{64}$'
    )
  )
);

create index formation_invitations_dispute_target_created_idx
  on juryai_v21.formation_invitations (
    dispute_id,
    target_party_id,
    created_at desc,
    invitation_id
  );

create function juryai_v21.protect_formation_invitation_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% is bootstrap/audit history and cannot be deleted',
      tg_table_schema || '.' || tg_table_name
      using errcode = '55000';
  end if;

  if old.consumed_at is not null then
    raise exception 'consumed invitation is immutable' using errcode = '55000';
  end if;

  if row(
    new.invitation_id,
    new.dispute_id,
    new.target_party_id,
    new.issuer_party_id,
    new.issuer_principal_id,
    new.token_hash,
    new.intended_account_commitment_version,
    new.intended_account_commitment,
    new.invitation_contract_version,
    new.created_at,
    new.expires_at
  ) is distinct from row(
    old.invitation_id,
    old.dispute_id,
    old.target_party_id,
    old.issuer_party_id,
    old.issuer_principal_id,
    old.token_hash,
    old.intended_account_commitment_version,
    old.intended_account_commitment,
    old.invitation_contract_version,
    old.created_at,
    old.expires_at
  ) then
    raise exception 'invitation bootstrap fields are immutable' using errcode = '55000';
  end if;

  if new.consumed_at is null
    or new.redeemed_principal_id is null
    or new.redemption_event_id is null
    or new.redemption_envelope_version is null
    or new.redemption_envelope_hash is null then
    raise exception 'invitation update must be one complete redemption transition'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger formation_invitations_protect_transition
before update or delete on juryai_v21.formation_invitations
for each row execute function juryai_v21.protect_formation_invitation_transition();

alter table juryai_v21.formation_invitations enable row level security;

revoke all on table juryai_v21.formation_invitations from public;
revoke all on function juryai_v21.protect_formation_invitation_transition() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema juryai_v21 from anon';
    execute 'revoke all on table juryai_v21.formation_invitations from anon';
    execute
      'revoke all on function juryai_v21.protect_formation_invitation_transition() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema juryai_v21 from authenticated';
    execute 'revoke all on table juryai_v21.formation_invitations from authenticated';
    execute
      'revoke all on function juryai_v21.protect_formation_invitation_transition() from authenticated';
  end if;
end;
$$;
