// Player profile screen: search a uid or a name, then show one player's
// stats, alliance, rank, and — when the journal has one — a power
// breakdown. Plain DOM, same as mapView.ts — no React here (see CLAUDE.md).
//
// TEXTCONTENT ONLY, EVERYWHERE IN THIS FILE. No innerHTML, outerHTML,
// insertAdjacentHTML, or a template string turned into markup. A player's
// name, alliance tag, and the sidecar's own error sentences all came from
// somewhere that is not us — a name is chosen by another player, and an
// error string is built around whatever was typed into the search box.
// `tauri.conf.json` still has `csp: null`, so there is no second line of
// defence behind this rule.
import { invoke } from '@tauri-apps/api/core';

interface PlayerSummary {
  gameUid: string;
  serverId: number;
  name: string | null;
  allianceExternalId: string | null;
  hqLevel: number | null;
  power: number | null;
  kills: number | null;
  rank: number | null;
  capturedAt: string;
}

interface PlayerDetail {
  powerTotal: number | null;
  powerComponents: Record<string, number>;
  componentsSumMatches: boolean | null;
  capturedAt: string;
}

interface PlayerRecord {
  profile: PlayerSummary;
  detail: PlayerDetail | null;
}

interface PlayersSearchResponse {
  matches: PlayerSummary[];
}

// A DAY, not an hour — the same threshold and the same reasoning the
// dashboard's map already uses (`apps/dashboard/src/features/map/
// mapLocations.ts`, `SIGHTING_MAX_AGE_MS`, and `apps/dashboard/src/lib/
// freshness.ts`, `STALE_AFTER_MS`): this app shows what the player looked
// at, and a profile captured this morning is still worth acting on this
// evening. An hour-old threshold would paint almost every profile amber
// almost all the time for a screen that gets opened a few times a day, not
// hourly — a warning that is always on stops being a warning. "Is the
// collector still running" is a different question, answered elsewhere
// (`/health`, already on the search tab); this is only about whether ONE
// profile's numbers are still worth trusting at a glance.
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isStale(capturedAt: string, now: Date): boolean {
  return now.getTime() - new Date(capturedAt).getTime() > STALE_AFTER_MS;
}

export function formatAge(capturedAt: string, now: Date): string {
  const ageMs = Math.max(0, now.getTime() - new Date(capturedAt).getTime());
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function say(el: HTMLElement, text: string): void {
  el.textContent = text;
}

function clearChildren(el: HTMLElement): void {
  while (el.firstChild !== null) {
    el.removeChild(el.firstChild);
  }
}

/** A "captured at" line, with the stale class applied when it is old
 * enough — see `STALE_AFTER_MS` above for why a day and not something
 * shorter. The class name alone is not enough to mark data old for a
 * reader who cannot see color (or is skimming quickly): the text itself
 * always says "stale" too. */
function capturedAtLine(label: string, capturedAt: string, now: Date): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'profile-captured-at';
  const stale = isStale(capturedAt, now);
  if (stale) {
    p.classList.add('profile-captured-at--stale');
  }
  const age = formatAge(capturedAt, now);
  say(p, stale ? `${label}: ${age} — stale, may no longer be accurate` : `${label}: ${age}`);
  return p;
}

function statRow(label: string, value: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'profile-stat';
  const labelEl = document.createElement('span');
  labelEl.className = 'profile-stat__label';
  say(labelEl, label);
  const valueEl = document.createElement('span');
  valueEl.className = 'profile-stat__value';
  say(valueEl, value);
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

/** The power breakdown block. `componentsSumMatches` is surfaced exactly as
 * the sidecar sent it: `null` means too few components were captured to
 * check at all, `false` means the six components did NOT sum to
 * `powerTotal` — either way `powerTotal` is shown alongside a sentence
 * saying so, never presented alone as if it were an exact, verified
 * figure. */
function detailSection(detail: PlayerDetail, now: Date): HTMLElement {
  const section = document.createElement('section');
  section.className = 'profile-detail';

  const heading = document.createElement('h3');
  say(heading, 'Power breakdown');
  section.appendChild(heading);

  section.appendChild(capturedAtLine('Breakdown captured', detail.capturedAt, now));

  section.appendChild(statRow('Total power', formatNumber(detail.powerTotal)));

  const componentNames = Object.keys(detail.powerComponents).sort();
  if (componentNames.length > 0) {
    const list = document.createElement('div');
    list.className = 'profile-components';
    for (const name of componentNames) {
      list.appendChild(statRow(name, formatNumber(detail.powerComponents[name])));
    }
    section.appendChild(list);
  }

  const note = document.createElement('p');
  note.className = 'profile-components-note';
  if (detail.componentsSumMatches === null) {
    say(note, 'Not enough components were captured to check this total.');
  } else if (detail.componentsSumMatches === false) {
    note.classList.add('profile-components-note--mismatch');
    say(
      note,
      'The captured components do not add up to the total above — treat the total as ' +
        'approximate, not exact.',
    );
  } else {
    say(note, 'The captured components add up to the total above.');
  }
  section.appendChild(note);

  return section;
}

function profileSection(profile: PlayerSummary, now: Date): HTMLElement {
  const section = document.createElement('section');
  section.className = 'profile-summary';

  const heading = document.createElement('h2');
  say(heading, profile.name ?? `Unnamed (uid ${profile.gameUid})`);
  section.appendChild(heading);

  section.appendChild(capturedAtLine('Last seen', profile.capturedAt, now));

  section.appendChild(statRow('Server', String(profile.serverId)));
  section.appendChild(statRow('Power', formatNumber(profile.power)));
  section.appendChild(statRow('HQ level', formatNumber(profile.hqLevel)));
  section.appendChild(statRow('Kills', formatNumber(profile.kills)));
  section.appendChild(statRow('Alliance', profile.allianceExternalId ?? '—'));
  section.appendChild(statRow('Rank', formatNumber(profile.rank)));

  return section;
}

/** Builds the profile screen once. Call `createProfileView()` from
 * `main.ts` and mount the returned element; the view manages its own
 * search box, result list, and detail panel from then on. */
export function createProfileView(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'profile-view';

  const searchRow = document.createElement('div');
  searchRow.className = 'profile-search';
  const needleEl = document.createElement('input');
  needleEl.placeholder = 'UID, or part of a name';
  const goEl = document.createElement('button');
  goEl.type = 'button';
  say(goEl, 'Search');
  searchRow.appendChild(needleEl);
  searchRow.appendChild(goEl);
  root.appendChild(searchRow);

  const statusEl = document.createElement('p');
  statusEl.className = 'profile-status';
  root.appendChild(statusEl);

  const resultsEl = document.createElement('div');
  resultsEl.className = 'profile-results';
  root.appendChild(resultsEl);

  const detailRootEl = document.createElement('div');
  detailRootEl.className = 'profile-detail-root';
  root.appendChild(detailRootEl);

  async function loadProfile(uid: string): Promise<void> {
    clearChildren(detailRootEl);
    say(statusEl, 'reading…');
    try {
      const record = await invoke<PlayerRecord>('player_detail', { uid });
      say(statusEl, '');
      const now = new Date();
      detailRootEl.appendChild(profileSection(record.profile, now));
      if (record.detail !== null) {
        detailRootEl.appendChild(detailSection(record.detail, now));
      } else {
        const note = document.createElement('p');
        note.className = 'profile-detail-missing';
        say(note, 'No power breakdown has been captured for this player yet.');
        detailRootEl.appendChild(note);
      }
    } catch (error) {
      say(statusEl, String(error));
    }
  }

  function renderResults(matches: PlayerSummary[]): void {
    clearChildren(resultsEl);
    for (const match of matches) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'profile-result';
      const level = match.hqLevel === null ? '' : ` · HQ ${match.hqLevel}`;
      say(item, `${match.name ?? 'unnamed'} — uid ${match.gameUid} on ${match.serverId}${level}`);
      item.addEventListener('click', () => {
        void loadProfile(match.gameUid);
      });
      resultsEl.appendChild(item);
    }
  }

  async function search(): Promise<void> {
    const typed = needleEl.value.trim();
    if (typed === '') {
      return;
    }
    say(statusEl, 'searching…');
    clearChildren(resultsEl);
    clearChildren(detailRootEl);
    try {
      const answer = await invoke<PlayersSearchResponse>('find_players', { needle: typed });
      say(statusEl, answer.matches.length === 0 ? `nothing matching ${typed}` : '');
      renderResults(answer.matches);
      // A single unambiguous hit is worth opening straight away — the
      // player typed a full uid or a name that resolved to exactly one
      // profile, and an extra click to see what they already asked for
      // would be pure friction.
      if (answer.matches.length === 1) {
        void loadProfile(answer.matches[0].gameUid);
      }
    } catch (error) {
      say(statusEl, String(error));
    }
  }

  goEl.addEventListener('click', () => {
    void search();
  });
  needleEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      void search();
    }
  });

  return root;
}
