import { createFormationCeremony } from '../formation/ceremony.js';
import { createFormationRelay } from '../formation/relay-submission.js';
import { V215_SPEC } from './generation-spec.js';
import { validator } from './contract-validator.js';

export const ceremony = createFormationCeremony({ spec: V215_SPEC, validator });
export const relay = createFormationRelay(
  {
    spec: V215_SPEC,
    validator,
    cursors: ceremony.refreshPartyViewCursors,
  },
  'frozen_minted_identity',
);
