-- Private, production-dark V2.1.1 party-review intent-assurance persistence.
--
-- The CaseEnvelope in formation_disputes remains the sole mutable dispute
-- truth. These rows are one-time protected-action authority and audit records.
-- This migration adds no route, browser grant, WebMCP tool, or activation path.

begin;

do $$
begin
  if to_regclass('juryai_v21.formation_disputes') is null
    or to_regclass('juryai_v21.formation_commands') is null
    or to_regprocedure('juryai_v21.reject_append_only_mutation()') is null then
    raise exception 'V2.1.1 party review requires the dark formation persistence foundation';
  end if;
end;
$$;

create table juryai_v21.formation_assurance_challenges (
  challenge_id text generated always as (record ->> 'challenge_id') stored primary key,
  dispute_id text generated always as (record ->> 'dispute_id') stored not null,
  party_id text generated always as (record ->> 'party_id') stored not null,
  authenticated_subject_id text generated always as (
    record ->> 'authenticated_subject_id'
  ) stored not null,
  requested_action text generated always as (record ->> 'requested_action') stored not null,
  status text generated always as (record ->> 'status') stored not null,
  action_payload_hash text generated always as (record ->> 'action_payload_hash') stored not null,
  party_projection_hash text generated always as (
    record ->> 'party_projection_hash'
  ) stored not null,
  party_visible_version bigint generated always as (
    (record ->> 'party_visible_version')::bigint
  ) stored not null,
  formation_epoch bigint generated always as ((record ->> 'formation_epoch')::bigint) stored not null,
  satisfied_by_receipt_id text generated always as (
    record ->> 'satisfied_by_receipt_id'
  ) stored,
  consumed_by_consumption_id text generated always as (
    record ->> 'consumed_by_consumption_id'
  ) stored,
  review_state_hash text not null,
  action_payload jsonb not null,
  record jsonb not null,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint formation_assurance_challenges_dispute_fk foreign key (dispute_id)
    references juryai_v21.formation_disputes (dispute_id) on delete restrict,
  constraint formation_assurance_challenges_record_object check (jsonb_typeof(record) = 'object'),
  constraint formation_assurance_challenges_payload_object check (
    jsonb_typeof(action_payload) = 'object'
  ),
  constraint formation_assurance_challenges_id_valid check (
    challenge_id ~ '^handoff_challenge_[A-Za-z0-9_.:-]+$' and length(challenge_id) <= 160
  ),
  constraint formation_assurance_challenges_dispute_valid check (
    dispute_id ~ '^dispute_[A-Za-z0-9_.:-]+$' and length(dispute_id) <= 160
  ),
  constraint formation_assurance_challenges_party_valid check (party_id in ('party_a', 'party_b')),
  constraint formation_assurance_challenges_subject_valid check (
    authenticated_subject_id ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,159}$'
  ),
  constraint formation_assurance_challenges_action_valid check (
    requested_action in ('confirm_case_account', 'reopen_confirmed_material')
  ),
  constraint formation_assurance_challenges_status_valid check (
    status in ('pending', 'consumed', 'invalidated')
  ),
  constraint formation_assurance_challenges_hashes_valid check (
    action_payload_hash ~ '^[a-f0-9]{64}$'
    and party_projection_hash ~ '^[a-f0-9]{64}$'
    and review_state_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint formation_assurance_challenges_versions_valid check (
    party_visible_version >= 1 and formation_epoch >= 1
  ),
  constraint formation_assurance_challenges_payload_binding check (
    action_payload ->> 'review_state_hash' = review_state_hash
    and action_payload ->> 'protected_action_version' =
      'juryai-party-review-protected-action-v1.0.0'
  ),
  constraint formation_assurance_challenges_lifecycle_shape check (
    (
      status = 'pending'
      and satisfied_by_receipt_id is null
      and consumed_by_consumption_id is null
      and record ->> 'satisfied_at' is null
      and record ->> 'consumed_at' is null
      and record ->> 'invalidated_at' is null
    )
    or (
      status = 'consumed'
      and satisfied_by_receipt_id is not null
      and consumed_by_consumption_id is not null
      and record ->> 'satisfied_at' is not null
      and record ->> 'consumed_at' is not null
      and record ->> 'invalidated_at' is null
    )
    or (
      status = 'invalidated'
      and satisfied_by_receipt_id is null
      and consumed_by_consumption_id is null
      and record ->> 'invalidated_at' is not null
      and record ->> 'invalidation_reason' is not null
    )
  ),
  constraint formation_assurance_challenges_timestamps_ordered check (updated_at >= created_at),
  constraint formation_assurance_challenges_scope_unique unique (
    dispute_id,
    party_id,
    challenge_id
  )
);

create index formation_assurance_challenges_party_status_idx
  on juryai_v21.formation_assurance_challenges (
    dispute_id,
    party_id,
    status,
    created_at,
    challenge_id
  );

create table juryai_v21.formation_assurance_receipts (
  receipt_id text generated always as (record ->> 'receipt_id') stored primary key,
  challenge_id text generated always as (record ->> 'challenge_id') stored not null,
  dispute_id text generated always as (record ->> 'dispute_id') stored not null,
  party_id text generated always as (record ->> 'party_id') stored not null,
  requested_action text generated always as (record ->> 'requested_action') stored not null,
  authorization_status text generated always as (
    record ->> 'authorization_status'
  ) stored not null,
  consumption_id text generated always as (record ->> 'consumption_id') stored not null,
  record jsonb not null,
  recorded_at timestamptz not null default transaction_timestamp(),
  constraint formation_assurance_receipts_challenge_fk
    foreign key (dispute_id, party_id, challenge_id)
    references juryai_v21.formation_assurance_challenges (
      dispute_id,
      party_id,
      challenge_id
    ) on delete restrict,
  constraint formation_assurance_receipts_record_object check (jsonb_typeof(record) = 'object'),
  constraint formation_assurance_receipts_id_valid check (
    receipt_id ~ '^assurance_receipt_[A-Za-z0-9_.:-]+$' and length(receipt_id) <= 160
  ),
  constraint formation_assurance_receipts_scope_valid check (
    dispute_id ~ '^dispute_[A-Za-z0-9_.:-]+$'
    and length(dispute_id) <= 160
    and party_id in ('party_a', 'party_b')
    and requested_action in ('confirm_case_account', 'reopen_confirmed_material')
  ),
  constraint formation_assurance_receipts_consumed check (
    authorization_status = 'consumed'
    and consumption_id ~ '^assurance_consumption_[A-Za-z0-9_.:-]+$'
    and record ->> 'consumed_at' is not null
  ),
  constraint formation_assurance_receipts_one_per_challenge unique (challenge_id),
  constraint formation_assurance_receipts_scope_unique unique (
    dispute_id,
    party_id,
    receipt_id
  )
);

create table juryai_v21.formation_assurance_consumptions (
  consumption_id text generated always as (record ->> 'consumption_id') stored primary key,
  receipt_id text generated always as (record ->> 'receipt_id') stored not null,
  challenge_id text generated always as (record ->> 'challenge_id') stored not null,
  dispute_id text generated always as (record ->> 'dispute_id') stored not null,
  party_id text generated always as (record ->> 'party_id') stored not null,
  requested_action text generated always as (record ->> 'requested_action') stored not null,
  record jsonb not null,
  recorded_at timestamptz not null default transaction_timestamp(),
  constraint formation_assurance_consumptions_challenge_fk
    foreign key (dispute_id, party_id, challenge_id)
    references juryai_v21.formation_assurance_challenges (
      dispute_id,
      party_id,
      challenge_id
    ) on delete restrict,
  constraint formation_assurance_consumptions_receipt_fk
    foreign key (dispute_id, party_id, receipt_id)
    references juryai_v21.formation_assurance_receipts (
      dispute_id,
      party_id,
      receipt_id
    ) on delete restrict,
  constraint formation_assurance_consumptions_record_object check (jsonb_typeof(record) = 'object'),
  constraint formation_assurance_consumptions_id_valid check (
    consumption_id ~ '^assurance_consumption_[A-Za-z0-9_.:-]+$'
    and length(consumption_id) <= 160
  ),
  constraint formation_assurance_consumptions_scope_valid check (
    dispute_id ~ '^dispute_[A-Za-z0-9_.:-]+$'
    and length(dispute_id) <= 160
    and party_id in ('party_a', 'party_b')
    and requested_action in ('confirm_case_account', 'reopen_confirmed_material')
  ),
  constraint formation_assurance_consumptions_one_per_challenge unique (challenge_id),
  constraint formation_assurance_consumptions_one_per_receipt unique (receipt_id),
  constraint formation_assurance_consumptions_scope_unique unique (
    dispute_id,
    party_id,
    consumption_id
  )
);

alter table juryai_v21.formation_assurance_challenges
  add constraint formation_assurance_challenges_receipt_fk
    foreign key (dispute_id, party_id, satisfied_by_receipt_id)
    references juryai_v21.formation_assurance_receipts (dispute_id, party_id, receipt_id)
    deferrable initially deferred,
  add constraint formation_assurance_challenges_consumption_fk
    foreign key (dispute_id, party_id, consumed_by_consumption_id)
    references juryai_v21.formation_assurance_consumptions (
      dispute_id,
      party_id,
      consumption_id
    ) deferrable initially deferred;

alter table juryai_v21.formation_assurance_receipts
  add constraint formation_assurance_receipts_consumption_fk
    foreign key (dispute_id, party_id, consumption_id)
    references juryai_v21.formation_assurance_consumptions (
      dispute_id,
      party_id,
      consumption_id
    ) deferrable initially deferred;

create function juryai_v21.protect_formation_assurance_challenge_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% is protected-action history and cannot be deleted',
      tg_table_schema || '.' || tg_table_name
      using errcode = '55000';
  end if;

  if old.status <> 'pending' then
    raise exception 'completed assurance challenge is immutable' using errcode = '55000';
  end if;

  if new.record ->> 'status' not in ('consumed', 'invalidated') then
    raise exception 'assurance challenge transition is invalid' using errcode = '55000';
  end if;

  if row(
    new.record - array[
      'status',
      'satisfied_at',
      'satisfied_by_receipt_id',
      'consumed_at',
      'consumed_by_consumption_id',
      'invalidated_at',
      'invalidation_reason'
    ],
    new.review_state_hash,
    new.action_payload,
    new.created_at
  ) is distinct from row(
    old.record - array[
      'status',
      'satisfied_at',
      'satisfied_by_receipt_id',
      'consumed_at',
      'consumed_by_consumption_id',
      'invalidated_at',
      'invalidation_reason'
    ],
    old.review_state_hash,
    old.action_payload,
    old.created_at
  ) then
    raise exception 'assurance challenge binding is immutable' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger formation_assurance_challenges_protect_transition
before update or delete on juryai_v21.formation_assurance_challenges
for each row execute function juryai_v21.protect_formation_assurance_challenge_transition();

create trigger formation_assurance_receipts_append_only
before update or delete on juryai_v21.formation_assurance_receipts
for each row execute function juryai_v21.reject_append_only_mutation();

create trigger formation_assurance_consumptions_append_only
before update or delete on juryai_v21.formation_assurance_consumptions
for each row execute function juryai_v21.reject_append_only_mutation();

alter table juryai_v21.formation_assurance_challenges enable row level security;
alter table juryai_v21.formation_assurance_receipts enable row level security;
alter table juryai_v21.formation_assurance_consumptions enable row level security;

revoke all on table juryai_v21.formation_assurance_challenges from public;
revoke all on table juryai_v21.formation_assurance_receipts from public;
revoke all on table juryai_v21.formation_assurance_consumptions from public;
revoke all on function juryai_v21.protect_formation_assurance_challenge_transition() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema juryai_v21 from anon';
    execute 'revoke all on table juryai_v21.formation_assurance_challenges from anon';
    execute 'revoke all on table juryai_v21.formation_assurance_receipts from anon';
    execute 'revoke all on table juryai_v21.formation_assurance_consumptions from anon';
    execute 'revoke all on function juryai_v21.protect_formation_assurance_challenge_transition() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema juryai_v21 from authenticated';
    execute 'revoke all on table juryai_v21.formation_assurance_challenges from authenticated';
    execute 'revoke all on table juryai_v21.formation_assurance_receipts from authenticated';
    execute 'revoke all on table juryai_v21.formation_assurance_consumptions from authenticated';
    execute 'revoke all on function juryai_v21.protect_formation_assurance_challenge_transition() from authenticated';
  end if;
end;
$$;

commit;
