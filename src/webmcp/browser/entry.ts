import './styles.css';
import type { ModelContextLike } from '../tools/register.js';
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
const logoutButton = element<HTMLButtonElement>('logout-button');
const status = element<HTMLElement>('status');
const disclosureCopy = element<HTMLElement>('disclosure-copy');
const capability = element<HTMLElement>('webmcp-capability');
const draftLink = element<HTMLAnchorElement>('active-draft-link');
const routeNotice = element<HTMLElement>('route-notice');

const view: BrowserShellView = {
  render(state: BrowserShellState): void {
    authSection.hidden = state.phase !== 'signed_out' && state.phase !== 'otp_requested';
    disclosureSection.hidden = state.phase !== 'disclosure';
    readySection.hidden = state.phase !== 'ready';
    logoutButton.hidden = state.phase !== 'disclosure' && state.phase !== 'ready';
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
  },
};

const controller = new BrowserShellController({
  view,
  expectedOrigin: window.location.origin,
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

logoutButton.addEventListener('click', () => {
  void controller.logout();
});

window.addEventListener('pagehide', () => controller.teardown());
window.addEventListener('pageshow', (event) => {
  void controller.pageShow(event.persisted);
});

if (/^\/cases\/[^/]+\/review$/u.test(window.location.pathname)) {
  routeNotice.hidden = false;
  routeNotice.textContent =
    'The canonical review URL is reserved. First-party read-back and attestation are not part of this step.';
}

wireBrowserShellHotLifecycle(import.meta.hot, controller);

void controller.initialize();
