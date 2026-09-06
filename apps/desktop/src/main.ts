// Spike UI, deliberately not React. This task proves a window opens; a
// framework here would add a second thing that could be the reason it did
// not. Task 8 replaces this with real calls.
// Named statusEl, not status: lib.dom.d.ts already declares a global
// `status` (the legacy window.status bar text), so `const status` collides.
const statusEl = document.querySelector<HTMLParagraphElement>('#status');
if (statusEl !== null) {
  statusEl.textContent = 'window is up';
}
