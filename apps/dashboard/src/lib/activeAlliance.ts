/** Which of our alliances this browser is looking at.
 *
 * Sent as `x-alliance-id` on every request (see supabase.ts), where 0193's
 * `active_alliance()` reads it. The header only CHOOSES: the database ignores
 * an alliance the caller does not belong to, so a stale or edited value here
 * shows you less, never more.
 *
 * Kept in a module variable rather than React state because the fetch wrapper
 * that sends it lives outside React. localStorage makes the choice survive a
 * reload; it is a per-browser convenience, and losing it only means landing
 * on the default alliance again.
 */
const STORAGE_KEY = 'dw-active-alliance';

/** Hosts that belong to one alliance. The same build is served on each; the
 * address decides which alliance it opens on, and the choice cannot be changed
 * there (no switcher, nothing stored). That is a convenience for the people of
 * that alliance and for an admin who wants one tab per alliance — NOT a
 * boundary: RLS still decides what any account can read, whatever the host.
 *
 * The id is the production `alliances.alliance_id` of Ascension (ACE, 579).
 * cbfw.us and every other host are absent, so they behave as before. */
const HOST_ALLIANCES: Readonly<Record<string, string>> = {
  'ace-ascension.us': 'b9daa299-20e1-41a2-84e7-e14a3b544bde',
};

/** The alliance a host is pinned to, or null. `www.` counts as the same host. */
export function hostAlliance(hostname: string): string | null {
  return HOST_ALLIANCES[hostname.toLowerCase().replace(/^www\./, '')] ?? null;
}

const pinned: string | null =
  typeof window === 'undefined' ? null : hostAlliance(window.location.hostname);

/** True on a host that fixes the alliance: the switcher is not offered. */
export function isAlliancePinnedByHost(): boolean {
  return pinned !== null;
}

function readStored(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let current: string | null = pinned ?? readStored();

export function getActiveAlliance(): string | null {
  return current;
}

export function setActiveAlliance(allianceId: string | null): void {
  if (pinned !== null) {
    return;
  }
  current = allianceId;
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (allianceId === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, allianceId);
    }
  } catch {
    // Private mode or blocked storage: the choice lasts until reload instead.
  }
}

/** Whether an alliance is "ours" on this screen: one of our alliances AND the
 * one being viewed.
 *
 * `is_own` alone stopped meaning that once two alliances can be ours: the
 * other alliance's page would offer blocks whose data RLS now withholds, and
 * a chart would highlight two lines as "ours". With nothing chosen (a
 * single-alliance install, a signed-out visitor) it is `is_own`, as before.
 */
export function isViewedAlliance(allianceId: string | null | undefined, isOwn: boolean): boolean {
  if (!isOwn) {
    return false;
  }
  return current === null || allianceId === current;
}

/** The fetch every Supabase request goes through: the plain one, plus the
 * header when an alliance has been chosen. */
export function fetchWithAlliance(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const allianceId = current;
  if (allianceId === null) {
    return fetch(input, init);
  }
  const headers = new Headers(init?.headers);
  headers.set('x-alliance-id', allianceId);
  return fetch(input, { ...init, headers });
}
