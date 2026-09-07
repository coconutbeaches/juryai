import { repairAuthorityFailure } from './repair-authority.js';
import { createFormationCeremony } from '../formation/ceremony.js';
import { createFormationRelay } from '../formation/relay-submission.js';
import { V215_SPEC } from './generation-spec.js';
import { validator } from './contract-validator.js';

export const ceremony = createFormationCeremony({
  spec: V215_SPEC,
  validator,
  allowUnconfirmedReturnToEdit: true,
});
export const relay = createFormationRelay(
  {
    spec: V215_SPEC,
    validator,
    cursors: ceremony.refreshPartyViewCursors,
    submissionAdmission: (envelope, party, submission) =>
      repairAuthorityFailure(
        envelope,
        party,
        submission.source_turn.in_reply_to,
        submission.effects,
      ),
  },
  'frozen_minted_identity',
);
