import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** Move to another tab of the screen already open, WITHOUT adding a history
 * entry. Switching tabs is not navigation: the back button should leave the
 * screen, not step through its panels. The tab still has an address, so a link
 * or the sidebar lands on it; this only keeps clicking between tabs out of the
 * history. `replaceState` fires no `hashchange`, so it is sent by hand. */
export function replaceHash(hash: string): void {
  window.history.replaceState(null, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** The address, live. Screens whose tabs have addresses of their own read the
 * tab from it, so the sidebar, a pasted link and the back button all agree with
 * what is on screen. */
export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash);
}
