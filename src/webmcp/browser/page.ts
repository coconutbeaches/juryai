import './landing.css';

// Keep invitation and case URLs on the existing authenticated application.
const isLanding =
  (window.location.pathname === '/' || window.location.pathname === '/index.html') &&
  !new URLSearchParams(window.location.search).has('start');

const landing = document.getElementById('landing-page')!;
const shell = document.getElementById('case-shell')!;

if (isLanding) {
  const menu = document.getElementById('landing-menu')!;
  const toggle = document.getElementById('menu-toggle')!;
  const closeMenu = () => {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
  });
  menu.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      closeMenu();
      toggle.focus();
    }
  });
  const dialog = document.getElementById('example-rationale') as HTMLDialogElement;
  document.getElementById('view-rationale')!.addEventListener('click', () => dialog.showModal());
  document.getElementById('close-rationale')!.addEventListener('click', () => dialog.close());
} else {
  landing.hidden = true;
  shell.hidden = false;
  document.body.classList.add('case-page');
  void import('./entry.js').catch(() => {
    const status = document.getElementById('status')!;
    status.textContent = 'JuryAI could not load. Please refresh to try again.';
  });
}
