// Arena bracket screen: each league's board at its own newest snapshot.
// Plain DOM, same as mapView.ts, profileView.ts and rosterView.ts — no React
// here (see CLAUDE.md).
//
// TEXTCONTENT ONLY, EVERYWHERE IN THIS FILE. No innerHTML, outerHTML,
// insertAdjacentHTML, or a template string turned into markup. A bracket
// entry's name and alliance tag are chosen by other players — somebody
// else's input arriving on our screen, same as the roster and profile
// screens. `tauri.conf.json` still has `csp: null`, so there is no second
// line of defence behind this rule.
import { invoke } from '@tauri-apps/api/core';

interface ArenaHero {
  heroId: number;
  slot: number | null;
  troopClass: number | null;
  heroLevel: number | null;
  levelSynced: boolean;
  star: number | null;
  stage: number | null;
  heroPower: number | null;
  weaponLevel: number | null;
}

interface ArenaEntry {
  gameUid: string;
  serverId: number;
  name: string | null;
  rank: number;
  score: number | null;
  defensePower: number | null;
  allianceName: string | null;
  allianceCode: string | null;
  heroes: ArenaHero[];
}

interface ArenaBoard {
  league: number | null;
  weekStart: string;
  capturedAt: string;
  entryCount: number | null;
  entries: ArenaEntry[];
}

interface ArenaResponse {
  boards: ArenaBoard[];
}

export interface ArenaView {
  /** The screen's root element. Mount this once; `load()` re-renders it. */
  readonly el: HTMLElement;
  /** Fetches every league's bracket and redraws the screen. Called once on
   * mount and again every time the arena tab is entered (see main.ts's view
   * registration) — a bracket reflects the last time the player opened that
   * screen in game, so reopening THIS screen is exactly when a fresher
   * snapshot might already be sitting in the journal. */
  load: () => Promise<void>;
}

// A DAY, not an hour — the same threshold and reasoning `rosterView.ts` and
// `profileView.ts` already document. An arena bracket is captured once a
// week at most, so "is this worth trusting right now" sits on the same
// timescale a player actually opens this screen, not an hourly one.
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

// --- Game week boundary --------------------------------------------------
//
// Monday 02:00 UTC, implemented three times already: SQL (`reset_week_start`
// in migrations), Python (`dw_collector.resetweek.reset_week_start`), and
// TypeScript (`apps/dashboard/src/lib/resetWeek.ts`) — all three consume
// `protocol-fixtures/reset-week/vectors.json` and must change together (see
// CLAUDE.md). THIS IS A FOURTH COPY, scoped to this desktop screen only: the
// desktop app is a separate Vite project with no shared package that
// already carries the function (`packages/ui` does not, and touching
// `apps/dashboard` is out of scope for this task — see CLAUDE.md's "Scope"
// section). If the reset rule ever changes, this copy has to change with
// the other three.
const RESET_HOUR_UTC = 2;
const HOUR_MS = 3_600_000;

function resetWeekStart(ts: Date): Date {
  const shifted = new Date(ts.getTime() - RESET_HOUR_UTC * HOUR_MS);
  const mondayOffset = (shifted.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - mondayOffset,
      RESET_HOUR_UTC,
    ),
  );
}

/** Whether `weekStart` (the server's own week boundary, carried on the
 * arena header — see `sidecar.arena_board_json`) is THIS machine's current
 * game week.
 *
 * THIS IS EXACTLY AS HONEST AS LOCAL DATA ALLOWS, NO MORE. There is no
 * server clock reachable from this desktop app — only `now`, the same
 * local clock `isStale`/`formatAge` already trust to say how old a capture
 * is. Judging "current week" against that same clock introduces no new
 * source of doubt beyond what this screen already asks the player to
 * accept for staleness; it is not a stronger claim than "captured 2h ago"
 * already is. What would NOT be supportable is inferring "current" from
 * anything captured in the journal itself (a captured_at is a fact about
 * the past, never about now) — this deliberately does not try to do that.
 */
export function isCurrentWeek(weekStart: string, now: Date): boolean {
  return resetWeekStart(now).getTime() === new Date(weekStart).getTime();
}

function formatWeek(weekStart: string): string {
  return new Date(weekStart).toISOString().slice(0, 10);
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

// --- League and hero-class labels -----------------------------------------
//
// The payload never carries the words "Gold"/"Silver" or "Fighter"/
// "Shooter"/"Rider" — both mappings were read off the game screen and are
// already recorded in `apps/dashboard/src/lib/arenaLeague.ts` and
// `apps/dashboard/src/lib/troops.ts`. Duplicated here, narrowly, for display
// text only (not joined against any data): touching those dashboard files
// is out of scope for this task (see CLAUDE.md), and this desktop app has
// no shared package that already carries them.
const LEAGUE_LABELS: Record<number, string> = { 1: 'Gold', 2: 'Silver' };

function leagueLabel(league: number | null): string {
  if (league === null) {
    return 'Unknown league';
  }
  return LEAGUE_LABELS[league] ?? `League ${league}`;
}

const TROOP_CLASS_LABELS: Record<number, string> = { 1: 'Fighter', 2: 'Shooter', 3: 'Rider' };

function troopClassName(troopClass: number | null): string {
  if (troopClass === null) {
    return '—';
  }
  return TROOP_CLASS_LABELS[troopClass] ?? `Class ${troopClass}`;
}

/** Stars as the game prints them — the payload counts one higher than the
 * screen shows. Same offset as `apps/dashboard/src/lib/troops.ts`'s
 * `starsShown`, duplicated here for the same reason as the league/class
 * labels above. */
function starsShown(star: number | null): number | null {
  if (star === null) {
    return null;
  }
  return star >= 1 ? star - 1 : star;
}

function heroLineupTable(heroes: ArenaHero[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'arena-lineup-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Slot', 'Hero', 'Class', 'Level', 'Stars', 'Power']) {
    const th = document.createElement('th');
    say(th, label);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const hero of heroes) {
    const row = document.createElement('tr');
    const stars = starsShown(hero.star);
    const starText =
      stars === null ? '—' : `${stars}★${hero.stage === null ? '' : ` step ${hero.stage}`}`;
    const cells = [
      hero.slot === null ? '—' : String(hero.slot),
      `Hero ${hero.heroId}`,
      troopClassName(hero.troopClass),
      formatNumber(hero.heroLevel),
      starText,
      formatNumber(hero.heroPower),
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

/** One entry's two rows: the always-visible bracket row, and a lineup row
 * that starts hidden and is built only the first time it is opened.
 *
 * THE LINEUP IS ON DEMAND, NOT ALWAYS RENDERED — see the task's own
 * reasoning: a hundred-entry board times five heroes times however many
 * columns is a lot of DOM for the one row a player actually opens, and the
 * ranking table is what this screen is for. An entry with no heroes gets a
 * disabled "no lineup" button rather than a toggle to nothing — it still
 * appears in the ranking above with everyone else (see `arena.py`'s module
 * docstring on why a heroless entry must still appear), it simply has
 * nothing to expand.
 */
function buildEntryRows(entry: ArenaEntry): [HTMLTableRowElement, HTMLTableRowElement] {
  const row = document.createElement('tr');
  const rank = document.createElement('td');
  rank.className = 'num';
  say(rank, String(entry.rank));
  row.appendChild(rank);

  const name = document.createElement('td');
  say(name, entry.name ?? `Unnamed (uid ${entry.gameUid})`);
  row.appendChild(name);

  const score = document.createElement('td');
  score.className = 'num';
  say(score, formatNumber(entry.score));
  row.appendChild(score);

  const defense = document.createElement('td');
  defense.className = 'num';
  say(defense, formatNumber(entry.defensePower));
  row.appendChild(defense);

  const alliance = document.createElement('td');
  say(alliance, entry.allianceCode ?? entry.allianceName ?? '—');
  row.appendChild(alliance);

  const lineupCell = document.createElement('td');
  const detailRow = document.createElement('tr');
  detailRow.className = 'arena-lineup-row';
  detailRow.hidden = true;
  const detailCell = document.createElement('td');
  detailCell.colSpan = 6;
  detailRow.appendChild(detailCell);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  if (entry.heroes.length === 0) {
    toggle.disabled = true;
    say(toggle, 'no lineup');
  } else {
    say(toggle, 'show lineup');
    let built = false;
    toggle.addEventListener('click', () => {
      if (!built) {
        detailCell.appendChild(heroLineupTable(entry.heroes));
        built = true;
      }
      detailRow.hidden = !detailRow.hidden;
      say(toggle, detailRow.hidden ? 'show lineup' : 'hide lineup');
    });
  }
  lineupCell.appendChild(toggle);
  row.appendChild(lineupCell);

  return [row, detailRow];
}

function buildEntriesTable(entries: ArenaEntry[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'arena-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Rank', 'Name', 'Score', 'Defense', 'Alliance', 'Lineup']) {
    const th = document.createElement('th');
    say(th, label);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const entry of entries) {
    const [row, detailRow] = buildEntryRows(entry);
    tbody.appendChild(row);
    tbody.appendChild(detailRow);
  }
  table.appendChild(tbody);
  return table;
}

/** The header line for one board: league, the week it covers, when it was
 * captured, and whether either of those is worth a second look. Four
 * separate facts, kept separate rather than folded into one sentence:
 * staleness is about the CAPTURE, "not current week" is about the WEEK, and
 * conflating them would hide which one a player actually needs to act on
 * (recapture now vs. this is simply last week's board, already final). */
function boardHeader(board: ArenaBoard, now: Date): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'arena-board-header';

  const stale = isStale(board.capturedAt, now);
  if (stale) {
    p.classList.add('arena-board-header--stale');
  }
  const current = isCurrentWeek(board.weekStart, now);
  if (!current) {
    p.classList.add('arena-board-header--old-week');
  }

  const parts = [
    `${leagueLabel(board.league)} · week of ${formatWeek(board.weekStart)}`,
    current ? null : '(not the current week)',
    `captured ${formatAge(board.capturedAt, now)}`,
    stale ? '— stale, may no longer be accurate' : null,
  ].filter((part): part is string => part !== null);
  say(p, parts.join(' '));
  return p;
}

function buildBoardSection(board: ArenaBoard, now: Date): HTMLElement {
  const section = document.createElement('section');
  section.className = 'arena-board';

  section.appendChild(boardHeader(board, now));

  if (board.entries.length === 0) {
    const empty = document.createElement('p');
    say(empty, 'No entries were captured for this board.');
    section.appendChild(empty);
    return section;
  }

  section.appendChild(buildEntriesTable(board.entries));
  return section;
}

/** Builds the arena screen once. Call `createArenaView()` from `main.ts`
 * and mount the returned `el`; call `load()` on mount and whenever the tab
 * is entered (see `views.ts`'s `onEnter` hook), same as the roster screen —
 * a bracket is exactly as fresh as the last time the player opened that
 * screen in game. */
export function createArenaView(): ArenaView {
  const root = document.createElement('div');
  root.className = 'arena-view';

  const statusEl = document.createElement('p');
  statusEl.className = 'arena-status';
  root.appendChild(statusEl);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'arena-body';
  root.appendChild(bodyEl);

  async function load(): Promise<void> {
    say(statusEl, 'reading…');
    clearChildren(bodyEl);
    try {
      // `league: null` IS PASSED EXPLICITLY, not omitted. The Rust command
      // takes `Option<i64>`, and Tauri's IPC deserializes a missing key
      // less predictably than an explicit `null` — this screen wants every
      // league's board, unfiltered, so it says so rather than relying on
      // omission being read the same way.
      const response = await invoke<ArenaResponse>('get_arena', { league: null });
      say(statusEl, '');
      if (response.boards.length === 0) {
        const empty = document.createElement('p');
        say(empty, 'No arena bracket has been captured yet.');
        bodyEl.appendChild(empty);
        return;
      }
      const now = new Date();
      for (const board of response.boards) {
        bodyEl.appendChild(buildBoardSection(board, now));
      }
    } catch (error) {
      say(statusEl, String(error));
    }
  }

  return { el: root, load };
}
