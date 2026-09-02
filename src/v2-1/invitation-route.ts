import {
  INVITATION_UNAVAILABLE_CODE_V21,
  INVITATION_UNAVAILABLE_MESSAGE_V21,
} from './invitation-public-contract.js';

/**
 * Production route composition is intentionally terminal in PR 3. It neither
 * parses the token nor imports invitation persistence, so no request can reach
 * issue, redemption, or Party B binding code.
 */
export function productionDisabledInvitationRouteV21(): Response {
  return Response.json(
    {
      status: 'unavailable',
      code: INVITATION_UNAVAILABLE_CODE_V21,
      message: INVITATION_UNAVAILABLE_MESSAGE_V21,
    },
    {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    },
  );
}
