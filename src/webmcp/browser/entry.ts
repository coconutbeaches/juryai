import './styles.css';
import type { ParsedFormationReview } from './supported-review-contract.js';
import type { ModelContextLike } from '../tools/register.js';
import type { ParsedFirstPartyReview } from './review-contract.js';
import { decodeInvitationRedemptionV212 } from './v2-1-2-review-contract.js';
import {
  BrowserShellController,
  type BrowserShellState,
  type BrowserShellView,
  wireBrowserShellHotLifecycle,
} from './shell-controller.js';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing JuryAI shell element: ${id}`);
  return found as T;
}

const authSection = element<HTMLElement>('auth-section');
const invitationJoinSection = element<HTMLElement>('invitation-join-section');
const disclosureSection = element<HTMLElement>('disclosure-section');
const readySection = element<HTMLElement>('ready-section');
const reviewSection = element<HTMLElement>('review-section');
const logoutButton = element<HTMLButtonElement>('logout-button');
const status = element<HTMLElement>('status');
const disclosureCopy = element<HTMLElement>('disclosure-copy');
const capability = element<HTMLElement>('webmcp-capability');
const draftLink = element<HTMLAnchorElement>('active-draft-link');
const routeNotice = element<HTMLElement>('route-notice');
const reviewCapability = element<HTMLElement>('review-capability');
const reviewHeading = element<HTMLElement>('review-heading');
const reviewVersion = element<HTMLElement>('review-version');
const reviewMessage = element<HTMLElement>('review-message');
const reviewBlockers = element<HTMLUListElement>('review-blockers');
const readbackBlocks = element<HTMLElement>('readback-blocks');
const canonicalDocument = element<HTMLElement>('canonical-document');
const correctionPanel = element<HTMLElement>('correction-panel');
const correctionForm = element<HTMLFormElement>('correction-form');
const correctionRequirement = element<HTMLSelectElement>('correction-requirement');
const correctionDisposition = element<HTMLSelectElement>('correction-disposition');
const correctionTextLabel = element<HTMLElement>('correction-text-label');
const correctionText = element<HTMLTextAreaElement>('correction-text');
const attestationPanel = element<HTMLElement>('attestation-panel');
const adoptionStatement = element<HTMLElement>('adoption-statement');
const adoptionCheckbox = element<HTMLInputElement>('adoption-checkbox');
const attestButton = element<HTMLButtonElement>('attest-button');
const lockedPanel = element<HTMLElement>('locked-panel');
const v212ReviewPanel = element<HTMLElement>('v212-review-panel');
const v212Workflow = element<HTMLElement>('v212-workflow');
const v212InvitationPanel = element<HTMLElement>('v212-invitation-panel');
const v212InvitationForm = element<HTMLFormElement>('v212-invitation-form');
const v212InvitationEmail = element<HTMLInputElement>('v212-invitation-email');
const v212InvitationResult = element<HTMLElement>('v212-invitation-result');
const v212WaitingPanel = element<HTMLElement>('v212-waiting-panel');
const v212VisibleMaterialDocument = element<HTMLElement>('v212-visible-material-document');
const v212DisclosureReviewPanel = element<HTMLElement>('v212-disclosure-review-panel');
const v212DisclosureReviewStatement = element<HTMLElement>('v212-disclosure-review-statement');
const v212FinishReview = element<HTMLButtonElement>('v212-finish-review');
const v212ConfirmationPanel = element<HTMLElement>('v212-confirmation-panel');
const v212PrepareConfirmation = element<HTMLButtonElement>('v212-prepare-confirmation');
const v212ConfirmationCeremony = element<HTMLElement>('v212-confirmation-ceremony');
const v212ConfirmationReference = element<HTMLElement>('v212-confirmation-reference');
const v212ConfirmationCheckbox = element<HTMLInputElement>('v212-confirmation-checkbox');
const v212Confirm = element<HTMLButtonElement>('v212-confirm');
const v212ReopenPanel = element<HTMLElement>('v212-reopen-panel');
const v212ReopenReason = element<HTMLTextAreaElement>('v212-reopen-reason');
const v212PrepareReopen = element<HTMLButtonElement>('v212-prepare-reopen');
const v212ReopenCeremony = element<HTMLElement>('v212-reopen-ceremony');
const v212ReopenReference = element<HTMLElement>('v212-reopen-reference');
const v212ReopenCheckbox = element<HTMLInputElement>('v212-reopen-checkbox');
const v212Reopen = element<HTMLButtonElement>('v212-reopen');
const v212ReadyPanel = element<HTMLElement>('v212-ready-panel');

const reviewPath = /^\/cases\/([^/]+)\/review$/u.exec(window.location.pathname);
const invitationJoinPath = /^\/join\/[^/]+$/u.test(window.location.pathname);
let currentReview: ParsedFirstPartyReview | null = null;
let currentV212Review: ParsedFormationReview | null = null;
let currentWebMcp: 'available' | 'unavailable' | 'registration_failed' = 'unavailable';
let currentCorrectionTarget: { propositionId: string; requirementId: string } | null = null;
let controller: BrowserShellController;
let confirmationChallengeId: string | null = null;
let reopenChallengeId: string | null = null;
let pageActionController = new AbortController();

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
  return response.json() as Promise<unknown>;
}

function challengeResponse(value: unknown): { challenge_id: string; public_reference: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Challenge response is invalid.');
  }
  const challenge = (value as { challenge?: unknown }).challenge;
  if (typeof challenge !== 'object' || challenge === null || Array.isArray(challenge)) {
    throw new TypeError('Challenge response is invalid.');
  }
  const decoded = challenge as { challenge_id?: unknown; public_reference?: unknown };
  if (typeof decoded.challenge_id !== 'string' || typeof decoded.public_reference !== 'string') {
    throw new TypeError('Challenge response is invalid.');
  }
  return { challenge_id: decoded.challenge_id, public_reference: decoded.public_reference };
}

function isReplacementDisposition(value: string): boolean {
  return value === 'correct_meaning' || value === 'change_answer';
}

function syncCorrectionTargetControls(): void {
  const hasTarget = currentCorrectionTarget !== null;
  for (const option of correctionDisposition.options) {
    if (isReplacementDisposition(option.value)) option.disabled = !hasTarget;
  }
  if (!hasTarget && isReplacementDisposition(correctionDisposition.value)) {
    correctionDisposition.value = 'add_information';
  }
}

function scalar(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function requirementForBlock(
  block: ParsedFirstPartyReview['parsed_document']['blocks'][number],
): string | null {
  if (block.type === 'REQUIREMENT') return block.id;
  if (block.type === 'PROPOSITION' || block.type === 'CLARIFICATION') {
    const value = scalar(block.fields.requirement);
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function renderCanonicalBlocks(review: ParsedFirstPartyReview): void {
  readbackBlocks.replaceChildren();
  correctionRequirement.replaceChildren();
  currentCorrectionTarget = null;
  syncCorrectionTargetControls();
  const requirementIds = review.parsed_document.blocks
    .filter((block) => block.type === 'REQUIREMENT' && block.id !== null)
    .map((block) => block.id as string);
  for (const requirementId of requirementIds) {
    const option = document.createElement('option');
    option.value = requirementId;
    option.textContent = requirementId;
    correctionRequirement.append(option);
  }
  for (const block of review.parsed_document.blocks) {
    const article = document.createElement('article');
    article.className = 'readback-block';
    const heading = document.createElement('h3');
    heading.textContent = block.id === null ? block.type : `${block.type} ${block.id}`;
    article.append(heading);
    const fields = document.createElement('dl');
    fields.className = 'readback-fields';
    for (const [name, value] of Object.entries(block.fields)) {
      const term = document.createElement('dt');
      term.textContent = name.replaceAll('_', ' ');
      const description = document.createElement('dd');
      description.textContent = value;
      fields.append(term, description);
    }
    article.append(fields);
    const requirementId = requirementForBlock(block);
    const isCurrentProposition =
      block.type !== 'PROPOSITION' || scalar(block.fields.standing) === 'live';
    const isOpenClarification =
      block.type !== 'CLARIFICATION' || scalar(block.fields.status) === 'open';
    if (
      requirementId !== null &&
      isCurrentProposition &&
      isOpenClarification &&
      review.status === 'draft'
    ) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary correct-button';
      button.textContent = 'Correct this here';
      button.addEventListener('click', () => {
        correctionRequirement.value = requirementId;
        if (block.type === 'PROPOSITION' && block.id !== null) {
          currentCorrectionTarget = { propositionId: block.id, requirementId };
          correctionDisposition.value = 'correct_meaning';
        } else {
          currentCorrectionTarget = null;
          correctionDisposition.value =
            block.type === 'CLARIFICATION' ? 'resolve_clarification' : 'add_information';
        }
        syncCorrectionTargetControls();
        correctionPanel.hidden = false;
        correctionPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      article.append(button);
    }
    readbackBlocks.append(article);
  }
}

function webMcpCopy(value: typeof currentWebMcp): string {
  return value === 'available'
    ? 'AI integration is available.'
    : value === 'unavailable'
      ? 'AI integration is not available in this browser. You can still review and attest here.'
      : 'AI integration could not be registered. You can still review and attest here.';
}

const view: BrowserShellView = {
  render(state: BrowserShellState): void {
    authSection.hidden = state.phase !== 'signed_out' && state.phase !== 'otp_requested';
    disclosureSection.hidden = state.phase !== 'disclosure';
    readySection.hidden = state.phase !== 'ready';
    const isReview =
      state.phase.startsWith('review_') ||
      state.phase === 'v212_review' ||
      state.phase === 'correction_submitting' ||
      state.phase === 'attesting' ||
      state.phase === 'locked';
    reviewSection.hidden = !isReview;
    logoutButton.hidden = state.phase !== 'disclosure' && state.phase !== 'ready' && !isReview;
    status.textContent = 'message' in state && state.message ? state.message : '';

    if (state.phase === 'loading') status.textContent = 'Loading JuryAI\u2026';
    if (state.phase === 'disclosure') disclosureCopy.textContent = state.copy;
    if (state.phase === 'ready') {
      capability.textContent =
        state.webMcp === 'available'
          ? 'AI integration is available.'
          : state.webMcp === 'unavailable'
            ? 'AI integration is not available in this browser.'
            : 'AI integration could not be registered.';
      if (state.activeDraftReviewUrl === null) {
        draftLink.hidden = true;
        draftLink.removeAttribute('href');
      } else {
        draftLink.hidden = false;
        draftLink.href = state.activeDraftReviewUrl;
      }
    }
    if (isReview && 'webMcp' in state) {
      currentWebMcp = state.webMcp;
      reviewCapability.textContent = webMcpCopy(state.webMcp);
      reviewMessage.textContent = 'message' in state && state.message ? state.message : '';
    }
    if (state.phase === 'v212_review') {
      const page = state.v212Review;
      currentReview = null;
      currentV212Review = page;
      reviewHeading.textContent = 'Your canonical JuryAI account';
      reviewVersion.textContent = `Dispute ${page.review.dispute_id}, visible version ${page.review.party_visible_version}`;
      canonicalDocument.textContent = page.review.formation_readback.document;
      readbackBlocks.replaceChildren();
      reviewBlockers.replaceChildren();
      correctionPanel.hidden = true;
      attestationPanel.hidden = true;
      lockedPanel.hidden = true;
      v212ReviewPanel.hidden = false;
      v212Workflow.textContent = `Workflow: ${page.workflow_phase.replaceAll('_', ' ')}. Your confirmation: ${page.review.own_confirmation_state.replaceAll('_', ' ')}.`;
      v212InvitationPanel.hidden = !page.can_invite_party_b;
      v212WaitingPanel.hidden = !page.waiting_for_other_party;
      v212VisibleMaterialDocument.textContent = JSON.stringify(
        {
          own_material: page.review.formation_projection.own_material,
          opponent_material: page.review.formation_projection.opponent_material,
          visible_challenges: page.review.formation_projection.visible_challenges,
        },
        null,
        2,
      );
      v212DisclosureReviewPanel.hidden = !page.can_acknowledge_disclosure_review;
      v212DisclosureReviewStatement.textContent = page.disclosure_review_acknowledgment_statement;
      v212ConfirmationPanel.hidden = !page.can_confirm;
      v212ReopenPanel.hidden = !page.can_reopen;
      v212ReadyPanel.hidden = page.review.shared_readiness !== 'ready_for_lock';
      confirmationChallengeId = null;
      reopenChallengeId = null;
      v212ConfirmationCeremony.hidden = true;
      v212ReopenCeremony.hidden = true;
      v212ConfirmationCheckbox.checked = false;
      v212ReopenCheckbox.checked = false;
      v212Confirm.disabled = true;
      v212Reopen.disabled = true;
      return;
    }
    if (isReview && 'review' in state) {
      currentV212Review = null;
      v212ReviewPanel.hidden = true;
      currentReview = state.review;
      reviewHeading.textContent =
        state.phase === 'locked' ? 'My account' : 'JuryAI currently has this as your account';
      reviewVersion.textContent = `Case ${state.review.case_id}, version ${state.review.case_version}`;
      canonicalDocument.textContent = state.review.document;
      renderCanonicalBlocks(state.review);
      reviewBlockers.replaceChildren(
        ...state.review.blocking_reasons.map((reason) => {
          const item = document.createElement('li');
          item.textContent = reason.replaceAll('_', ' ');
          return item;
        }),
      );
      correctionPanel.hidden = state.review.status === 'locked' || state.phase === 'attesting';
      attestationPanel.hidden = state.phase !== 'review_ready';
      lockedPanel.hidden = state.phase !== 'locked';
      adoptionStatement.textContent = state.review.adoption_statement;
      adoptionCheckbox.checked = false;
      attestButton.disabled = true;
    } else if (state.phase === 'review_loading' || state.phase === 'review_error') {
      currentReview = null;
      currentV212Review = null;
      v212ReviewPanel.hidden = true;
      readbackBlocks.replaceChildren();
      canonicalDocument.textContent = '';
      reviewBlockers.replaceChildren();
      correctionPanel.hidden = true;
      attestationPanel.hidden = true;
      lockedPanel.hidden = true;
    }
  },
};

controller = new BrowserShellController({
  view,
  expectedOrigin: window.location.origin,
  reviewCaseId: reviewPath ? decodeURIComponent(reviewPath[1]!) : null,
  getModelContext: () => (document as Document & { modelContext?: ModelContextLike }).modelContext,
});

const authForm = element<HTMLFormElement>('auth-form');
const emailInput = element<HTMLInputElement>('email');
const otpInput = element<HTMLInputElement>('otp');
const requestCodeButton = element<HTMLButtonElement>('request-code-button');

requestCodeButton.addEventListener('click', () => {
  void controller.requestOtp(emailInput.value);
});

authForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void controller.verifyOtp(emailInput.value, otpInput.value);
});

element<HTMLFormElement>('disclosure-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void controller.acceptDisclosure();
});

correctionDisposition.addEventListener('change', () => {
  const takesText =
    correctionDisposition.value !== 'dont_remember' &&
    correctionDisposition.value !== 'decline_to_answer';
  correctionTextLabel.hidden = !takesText;
  correctionText.required = takesText;
});

correctionRequirement.addEventListener('change', () => {
  if (
    currentCorrectionTarget !== null &&
    currentCorrectionTarget.requirementId !== correctionRequirement.value
  ) {
    currentCorrectionTarget = null;
    syncCorrectionTargetControls();
  }
});

correctionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (currentReview === null) return;
  const disposition = correctionDisposition.value as
    | 'correct_meaning'
    | 'add_information'
    | 'change_answer'
    | 'dont_remember'
    | 'decline_to_answer'
    | 'resolve_clarification';
  const takesText = disposition !== 'dont_remember' && disposition !== 'decline_to_answer';
  const targetPropositionId = isReplacementDisposition(disposition)
    ? currentCorrectionTarget?.propositionId
    : undefined;
  if (isReplacementDisposition(disposition) && targetPropositionId === undefined) return;
  void controller.submitCorrection({
    expected_case_version: currentReview.case_version,
    in_reply_to: [correctionRequirement.value],
    client_turn_id: `review_${crypto.randomUUID()}`,
    disposition,
    ...(targetPropositionId === undefined ? {} : { target_proposition_id: targetPropositionId }),
    ...(takesText ? { text: correctionText.value } : {}),
    current_review: currentReview,
    webMcp: currentWebMcp,
  });
});

adoptionCheckbox.addEventListener('change', () => {
  attestButton.disabled = !adoptionCheckbox.checked;
});

attestButton.addEventListener('click', () => {
  if (currentReview === null || !adoptionCheckbox.checked) return;
  void controller.attest(currentReview, currentWebMcp);
});

v212InvitationForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!currentV212Review) return;
  const disputeId = currentV212Review.review.dispute_id;
  const actionSignal = pageActionController.signal;
  void (async () => {
    try {
      const response = (await postJson(
        `/api/juryai/cases/${encodeURIComponent(disputeId)}/invitations`,
        { email: v212InvitationEmail.value },
        actionSignal,
      )) as { csurl_path?: unknown };
      if (actionSignal.aborted) return;
      if (typeof response.csurl_path !== 'string')
        throw new TypeError('Invitation URL is invalid.');
      const link = new URL(response.csurl_path, window.location.origin).toString();
      v212InvitationResult.replaceChildren(
        document.createTextNode('Secure invitation: '),
        Object.assign(document.createElement('a'), { href: link, textContent: link }),
      );
      await controller.initialize();
    } catch {
      if (actionSignal.aborted) return;
      v212InvitationResult.textContent = 'The invitation could not be created.';
    }
  })();
});

v212FinishReview.addEventListener('click', () => {
  if (!currentV212Review) return;
  const disputeId = currentV212Review.review.dispute_id;
  const actionSignal = pageActionController.signal;
  void (async () => {
    try {
      await postJson(
        `/api/juryai/cases/${encodeURIComponent(disputeId)}/disclosure-review`,
        {},
        actionSignal,
      );
      if (actionSignal.aborted) return;
      await controller.initialize();
    } catch {
      if (actionSignal.aborted) return;
      reviewMessage.textContent = 'The visible review changed. Reload and review it again.';
    }
  })();
});

v212PrepareConfirmation.addEventListener('click', () => {
  if (!currentV212Review) return;
  const disputeId = currentV212Review.review.dispute_id;
  const actionSignal = pageActionController.signal;
  void (async () => {
    try {
      const challenge = challengeResponse(
        await postJson(
          `/api/juryai/cases/${encodeURIComponent(disputeId)}/review-challenges`,
          { action: 'confirm_case_account' },
          actionSignal,
        ),
      );
      if (actionSignal.aborted) return;
      confirmationChallengeId = challenge.challenge_id;
      v212ConfirmationReference.textContent = `Confirmation reference: ${challenge.public_reference}`;
      v212ConfirmationCeremony.hidden = false;
    } catch {
      if (actionSignal.aborted) return;
      reviewMessage.textContent = 'Confirmation is not available for the current account.';
    }
  })();
});

v212ConfirmationCheckbox.addEventListener('change', () => {
  v212Confirm.disabled = !v212ConfirmationCheckbox.checked || confirmationChallengeId === null;
});

v212Confirm.addEventListener('click', () => {
  if (!currentV212Review || !confirmationChallengeId || !v212ConfirmationCheckbox.checked) return;
  const disputeId = currentV212Review.review.dispute_id;
  const challengeId = confirmationChallengeId;
  const actionSignal = pageActionController.signal;
  void (async () => {
    try {
      await postJson(
        `/api/juryai/cases/${encodeURIComponent(disputeId)}/review-actions`,
        { action: 'confirm_case_account', challenge_id: challengeId },
        actionSignal,
      );
      if (actionSignal.aborted) return;
      await controller.initialize();
    } catch {
      if (actionSignal.aborted) return;
      reviewMessage.textContent =
        'The account changed. Review the current account before confirming.';
    }
  })();
});

v212PrepareReopen.addEventListener('click', () => {
  if (!currentV212Review || !v212ReopenReason.value.trim()) return;
  const disputeId = currentV212Review.review.dispute_id;
  const actionSignal = pageActionController.signal;
  void (async () => {
    try {
      const challenge = challengeResponse(
        await postJson(
          `/api/juryai/cases/${encodeURIComponent(disputeId)}/review-challenges`,
          { action: 'reopen_confirmed_material', reason: v212ReopenReason.value },
          actionSignal,
        ),
      );
      if (actionSignal.aborted) return;
      reopenChallengeId = challenge.challenge_id;
      v212ReopenReference.textContent = `Reopen reference: ${challenge.public_reference}`;
      v212ReopenCeremony.hidden = false;
    } catch {
      if (actionSignal.aborted) return;
      reviewMessage.textContent = 'Reopen is not available for the current account.';
    }
  })();
});

v212ReopenCheckbox.addEventListener('change', () => {
  v212Reopen.disabled = !v212ReopenCheckbox.checked || reopenChallengeId === null;
});

v212Reopen.addEventListener('click', () => {
  if (!currentV212Review || !reopenChallengeId || !v212ReopenCheckbox.checked) return;
  const disputeId = currentV212Review.review.dispute_id;
  const challengeId = reopenChallengeId;
  const actionSignal = pageActionController.signal;
  void (async () => {
    try {
      await postJson(
        `/api/juryai/cases/${encodeURIComponent(disputeId)}/review-actions`,
        { action: 'reopen_confirmed_material', challenge_id: challengeId },
        actionSignal,
      );
      if (actionSignal.aborted) return;
      await controller.initialize();
    } catch {
      if (actionSignal.aborted) return;
      reviewMessage.textContent =
        'The account changed. Review the current account before reopening.';
    }
  })();
});

logoutButton.addEventListener('click', () => {
  void controller.logout();
});

routeNotice.hidden = true;

window.addEventListener('pagehide', () => {
  pageActionController.abort();
  controller.teardown();
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  pageActionController = new AbortController();
  if (!invitationJoinPath) void controller.pageShow(true);
});

if (invitationJoinPath) {
  invitationJoinSection.hidden = false;
  authSection.hidden = true;
  disclosureSection.hidden = true;
  readySection.hidden = true;
  reviewSection.hidden = true;
  logoutButton.hidden = true;
  status.textContent = '';
  const invitationEmail = element<HTMLInputElement>('invitation-email');
  const invitationOtp = element<HTMLInputElement>('invitation-otp');
  const invitationStatus = element<HTMLElement>('invitation-status');
  element<HTMLButtonElement>('invitation-request-code').addEventListener('click', () => {
    const actionSignal = pageActionController.signal;
    void (async () => {
      try {
        await postJson(
          '/api/juryai/auth/request-otp',
          { email: invitationEmail.value },
          actionSignal,
        );
        if (actionSignal.aborted) return;
        invitationStatus.textContent =
          'If this invited address can sign in, a six-digit code has been sent.';
      } catch {
        if (actionSignal.aborted) return;
        invitationStatus.textContent = 'The code request could not be completed.';
      }
    })();
  });
  element<HTMLFormElement>('invitation-join-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const token = window.location.pathname.slice('/join/'.length);
    const actionSignal = pageActionController.signal;
    void (async () => {
      try {
        const redemption = decodeInvitationRedemptionV212(
          await postJson(
            `/api/juryai/join/${encodeURIComponent(decodeURIComponent(token))}`,
            { email: invitationEmail.value, otp: invitationOtp.value },
            actionSignal,
          ),
        );
        if (actionSignal.aborted) return;
        window.location.assign(redemption.review_path);
      } catch {
        if (actionSignal.aborted) return;
        invitationStatus.textContent = 'This invitation is unavailable.';
      }
    })();
  });
} else {
  wireBrowserShellHotLifecycle(import.meta.hot, {
    teardown: () => {
      pageActionController.abort();
      controller.teardown();
    },
  });
  void controller.initialize();
}
