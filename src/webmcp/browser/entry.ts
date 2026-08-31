import './styles.css';
import type { ModelContextLike } from '../tools/register.js';
import type { ParsedFirstPartyReview } from './review-contract.js';
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

const reviewPath = /^\/cases\/([^/]+)\/review$/u.exec(window.location.pathname);
let currentReview: ParsedFirstPartyReview | null = null;
let currentWebMcp: 'available' | 'unavailable' | 'registration_failed' = 'unavailable';
let controller: BrowserShellController;

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
    if (isReview && 'review' in state) {
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
  void controller.submitCorrection({
    expected_case_version: currentReview.case_version,
    in_reply_to: [correctionRequirement.value],
    client_turn_id: `review_${crypto.randomUUID()}`,
    disposition,
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

logoutButton.addEventListener('click', () => {
  void controller.logout();
});

window.addEventListener('pagehide', () => controller.teardown());
window.addEventListener('pageshow', (event) => {
  void controller.pageShow(event.persisted);
});

routeNotice.hidden = true;

wireBrowserShellHotLifecycle(import.meta.hot, controller);

void controller.initialize();
