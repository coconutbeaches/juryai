import type { CaseEnvelopeV215, PartyIdV215 } from './case-envelope.js';
import type { ExternalRelayEffectCandidateV215 } from './external-relay-submission.js';

/** Routing limits mutation; it never supplies semantic correction intent. */
export function ownRepairBound(
  envelope: CaseEnvelopeV215,
  party: PartyIdV215,
  targets: readonly string[],
): { target: string | null } | null {
  const ownPositions = targets.filter(
    (id) => envelope.positions[id]?.attributed_party_id === party,
  );
  if (ownPositions.length === 0) return { target: null };
  if (ownPositions.length !== 1 || targets.length !== 2) return null;
  const position = envelope.positions[ownPositions[0]!]!;
  if (
    position.superseded_by !== null ||
    !targets.includes(position.requirement_id) ||
    envelope.requirements[position.requirement_id]?.party_id !== party
  )
    return null;
  return { target: position.position_id };
}

export function repairAuthorityFailure(
  envelope: CaseEnvelopeV215,
  party: PartyIdV215,
  targets: readonly string[],
  effects: readonly ExternalRelayEffectCandidateV215[],
): string | null {
  const bound = ownRepairBound(envelope, party, targets);
  if (!bound) return 'An own correction requires one exact live position and its own requirement.';
  // Challenge/response authority is separately checked by the closed adapter and
  // domain effect validators. This gate does not grant those operations authority.
  const replacements = effects.filter(
    (effect) =>
      effect.type === 'semantic_assertion_candidate' && effect.supersedes_candidate !== null,
  );
  if (
    replacements.length > 1 ||
    replacements.some(
      (effect) =>
        effect.type === 'semantic_assertion_candidate' &&
        (bound.target === null ||
          effect.supersedes_candidate !== bound.target ||
          effect.requirement_id !== envelope.positions[bound.target]?.requirement_id),
    )
  ) {
    return 'The interpreted correction exceeds the exact own target supplied by this turn.';
  }
  return null;
}
