// Alliance roster screen: the current membership as of the newest al.rank
// snapshot the collector has captured. Plain DOM, same as mapView.ts and
// profileView.ts — no React here (see CLAUDE.md).
//
// TEXTCONTENT ONLY, EVERYWHERE IN THIS FILE. No innerHTML, outerHTML,
// insertAdjacentHTML, or a template string turned into markup. A member's
// name is chosen by that player — somebody else's input arriving on our
// screen. See `main.ts`'s CSP comment for the second line of defence
// behind this rule.
import { invoke } from '@tauri-apps/api/core';

interface RosterMember {
  gameUid: string;
  serverId: number;
  name: string | null;
  memberRank: number | null;
  hqLevel: number | null;
  power: number | null;
  kills: number | null;
  onlineState: string | null;
  offlineSince: string | null;
  monthCardExpiresAt: string | null;
}

interface RosterResponse {
  capturedAt: string | null;
  presenceRedacted: boolean;
  members: RosterMember[];
}

export interface RosterView {
  /** The screen's root element. Mount this once; `load()` re-renders it. */
  readonly el: HTMLElement;
  /** Fetches the current roster and redraws the screen. Called once on
   * mount and again every time the roster tab is entered (see main.ts's
   * view registration) — a roster reflects the last time the player opened
   * that screen in game, so reopening THIS screen is exactly when a fresher
   * answer might be sitting in the journal. */
  load: () => Promise<void>;
}

// A DAY, not an hour — the same threshold and the same reasoning
// profileView.ts's STALE_AFTER_MS already documents (the dashboard's map
// staleness window). It matters MORE here than for a single profile: a
// roster captured yesterday may already be missing someone who joined since
// AND still be showing someone who has since left, but "is this worth
// trusting right now" is the same question at the same timescale a player
// checks a screen, so this reuses the identical threshold rather than
// inventing a second one that would need its own justification.
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

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

/** What one member's online cell should say.
 *
 * `presenceRedacted` WINS OVER WHATEVER `onlineState` HAPPENS TO CARRY.
 * When the game redacts a snapshot's presence it also reports `onlineState`
 * as null on every row (see the sidecar's `roster_json`/`roster.py`'s module
 * docstring for why), so this branch is mostly documentation — but it is the
 * one place in this file that turns the redaction fact into words instead of
 * a boolean, which is the whole reason `presence_redacted` gets read before
 * being shown at all. */
function onlineStateText(member: RosterMember, presenceRedacted: boolean): string {
  if (presenceRedacted) {
    return 'unknown';
  }
  if (member.onlineState === 'online') {
    return 'online';
  }
  if (member.onlineState === 'offline') {
    return member.offlineSince === null ? 'offline' : `offline (since ${member.offlineSince})`;
  }
  return '—';
}

/** A "captured at" line, stale-flagged past `STALE_AFTER_MS` — same shape as
 * profileView.ts's `capturedAtLine`, with roster-specific wording: a stale
 * roster is not just "old numbers", it may be missing joins or still
 * listing someone who left. */
function capturedAtLine(capturedAt: string | null, now: Date): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'roster-captured-at';
  if (capturedAt === null) {
    say(p, 'No roster has been captured yet.');
    return p;
  }
  const stale = isStale(capturedAt, now);
  if (stale) {
    p.classList.add('roster-captured-at--stale');
  }
  const age = formatAge(capturedAt, now);
  say(
    p,
    stale
      ? `Roster captured ${age} — stale, may be missing joins or still list someone who left`
      : `Roster captured ${age}`,
  );
  return p;
}

/** A banner for a redacted snapshot, or null when nothing needs saying.
 * `presenceRedacted` describes the whole snapshot (see `roster.py`'s module
 * docstring), so this renders once for the screen rather than once per
 * row. */
function presenceNote(presenceRedacted: boolean): HTMLParagraphElement | null {
  if (!presenceRedacted) {
    return null;
  }
  const p = document.createElement('p');
  p.className = 'roster-presence-note';
  say(
    p,
    'Online status is not available for this alliance right now — the game withheld it for ' +
      'this capture, so every member below shows "unknown" rather than a guessed state.',
  );
  return p;
}

function buildTable(members: RosterMember[], presenceRedacted: boolean): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'roster-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Name', 'Rank', 'HQ', 'Power', 'Kills', 'Online']) {
    const th = document.createElement('th');
    say(th, label);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const member of members) {
    const row = document.createElement('tr');
    const cells = [
      member.name ?? `Unnamed (uid ${member.gameUid})`,
      formatNumber(member.memberRank),
      formatNumber(member.hqLevel),
      formatNumber(member.power),
      formatNumber(member.kills),
      onlineStateText(member, presenceRedacted),
    ];
    for (const text of cells) {
      const td = document.createElement('td');
      say(td, text);
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

/** Builds the roster screen once. Call `createRosterView()` from `main.ts`
 * and mount the returned `el`; call `load()` on mount and whenever the tab
 * is entered (see `views.ts`'s `onEnter` hook) so the screen always shows
 * what the journal holds right now, not a stale first render. */
export function createRosterView(): RosterView {
  const root = document.createElement('div');
  root.className = 'roster-view';

  const statusEl = document.createElement('p');
  statusEl.className = 'roster-status';
  root.appendChild(statusEl);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'roster-body';
  root.appendChild(bodyEl);

  async function load(): Promise<void> {
    say(statusEl, 'reading…');
    clearChildren(bodyEl);
    try {
      const response = await invoke<RosterResponse>('get_roster');
      say(statusEl, '');
      const now = new Date();
      bodyEl.appendChild(capturedAtLine(response.capturedAt, now));
      const note = presenceNote(response.presenceRedacted);
      if (note !== null) {
        bodyEl.appendChild(note);
      }
      if (response.members.length === 0) {
        const empty = document.createElement('p');
        say(empty, 'No alliance roster has been captured yet.');
        bodyEl.appendChild(empty);
        return;
      }
      bodyEl.appendChild(buildTable(response.members, response.presenceRedacted));
    } catch (error) {
      say(statusEl, String(error));
    }
  }

  return { el: root, load };
}
