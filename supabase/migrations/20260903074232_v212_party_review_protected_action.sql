-- Additive V2.1.2 protected-action contract pairing.
--
-- Historical V1 payloads remain bound exclusively to V2.1.1 ceremony
-- commands. New V1.1 payloads are bound exclusively to V2.1.2 ceremony
-- commands. This migration changes no row and introduces no new authority,
-- grant, relation, column, or index.

begin;

alter table juryai_v21.formation_assurance_challenges
  drop constraint formation_assurance_challenges_payload_binding,
  add constraint formation_assurance_challenges_payload_binding check (
    action_payload ->> 'review_state_hash' = review_state_hash
    and (
      (
        action_payload ->> 'protected_action_version' =
          'juryai-party-review-protected-action-v1.0.0'
        and action_payload #>> '{ceremony_command,command_version}' =
          'juryai-envelope-command-v2.1.1'
      )
      or
      (
        action_payload ->> 'protected_action_version' =
          'juryai-party-review-protected-action-v1.1.0'
        and action_payload #>> '{ceremony_command,command_version}' =
          'juryai-envelope-command-v2.1.2'
      )
    )
  );

commit;
