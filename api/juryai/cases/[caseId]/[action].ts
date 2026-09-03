import {
  handleDisclosureReviewAcknowledgment,
  handleFormationInvitation,
  handlePartyReviewAction,
  handlePartyReviewChallenge,
} from '../../../../src/webmcp/server/production.js';

const handlers = {
  'disclosure-review': handleDisclosureReviewAcknowledgment,
  invitations: handleFormationInvitation,
  'review-actions': handlePartyReviewAction,
  'review-challenges': handlePartyReviewChallenge,
} as const;

export default {
  fetch(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.split('/').at(-1) ?? '';
    const handler = handlers[action as keyof typeof handlers];
    if (!handler) {
      return Promise.resolve(
        new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Not found.' }), {
          status: 404,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }),
      );
    }
    return handler(request);
  },
};
