-- Production-dark V2.1.2 disclosure-review closure persistence amendment.
--
-- The canonical acknowledgment history lives only inside the authoritative
-- formation_disputes.envelope JSONB document. No row is converted, backfilled,
-- or reinterpreted. V2.1.1 and V2.1.2 remain distinguishable by their exact
-- schema/protocol pair so the frozen V2.1.1 repository can continue reading its
-- own historical contract while the V2.1.2 repository fails closed on V2.1.1.

begin;

do $$
begin
  if to_regclass('juryai_v21.formation_disputes') is null then
    raise exception 'V2.1.2 requires existing dark relation juryai_v21.formation_disputes';
  end if;
end;
$$;

alter table juryai_v21.formation_disputes
  drop constraint formation_disputes_schema_v211,
  drop constraint formation_disputes_protocol_v211,
  add constraint formation_disputes_contract_pair_v212 check (
    (
      schema_version = 'juryai-case-envelope-v2.1.1'
      and protocol_version = 'juryai-formation-protocol-v2.1.1'
    )
    or
    (
      schema_version = 'juryai-case-envelope-v2.1.2'
      and protocol_version = 'juryai-formation-protocol-v2.1.2'
      and envelope #>> '{control,command_contract_version}' is not distinct from
        'juryai-envelope-command-v2.1.2'
      and envelope #>> '{control,readiness_contract_version}' is not distinct from
        'juryai-formation-readiness-v2.1.2'
      and envelope #>> '{control,projection_contract_version}' is not distinct from
        'juryai-party-formation-projection-v2.1.1'
      and jsonb_typeof(
        envelope #> '{formation,disclosure_review_acknowledgments}'
      ) is not distinct from 'object'
      and jsonb_typeof(
        envelope #> '{formation,disclosure_review_acknowledgments,party_a}'
      ) is not distinct from 'array'
      and jsonb_typeof(
        envelope #> '{formation,disclosure_review_acknowledgments,party_b}'
      ) is not distinct from 'array'
    )
  );

-- Defense in depth remains private/backend-only. This migration creates no
-- browser policy, route, participant binding, invitation activation, or grant.
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
