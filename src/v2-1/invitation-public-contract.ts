export const INVITATION_UNAVAILABLE_CODE_V21 = 'INVITATION_UNAVAILABLE';
export const INVITATION_UNAVAILABLE_MESSAGE_V21 = 'This invitation is unavailable.';

export interface InvitationUnavailableResultV21 {
  status: 'unavailable';
  code: typeof INVITATION_UNAVAILABLE_CODE_V21;
  message: typeof INVITATION_UNAVAILABLE_MESSAGE_V21;
}

export function invitationUnavailableResultV21(): InvitationUnavailableResultV21 {
  return {
    status: 'unavailable',
    code: INVITATION_UNAVAILABLE_CODE_V21,
    message: INVITATION_UNAVAILABLE_MESSAGE_V21,
  };
}
