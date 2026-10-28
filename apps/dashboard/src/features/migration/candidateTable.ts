// The candidates table as plain data: what each row shows, which rows a filter keeps and
// in what order. Pure, so the page only draws and the rules are tested once.

import {
  type Candidate,
  type CandidateColumn,
  type Found,
  type OwnAlliance,
  type Tier,
  candidateUid,
  serverFromUid,
  tierOf,
} from './candidates';

export interface ViewRow {
  candidate: Candidate;
  found: Found[];
  /** The sighting the row shows: a state list's exact place first, else the strongest. */
  best: Found | undefined;
  /** Null when nothing is known and nothing can be inferred. */
  tier: Tier | null;
  /** The server from a sighting, else from the uid's last six digits. */
  server: number | null;
  /** True when the server comes from the uid alone. */
  serverGuessed: boolean;
  allianceNow: string | null;
  desiredId: string | null;
  desiredLabel: string | null;
}

export function allianceLabel(a: OwnAlliance): string {
  const name = a.current_name ?? '(unnamed)';
  return a.current_code ? `[${a.current_code}] ${name}` : name;
}

/** The exact place off a state list wins; otherwise the strongest estimate. */
export function bestOf(found: readonly Found[]): Found | undefined {
  return [...found].sort(
    (a, b) => Number(a.estimated) - Number(b.estimated) || (a.place ?? 1e9) - (b.place ?? 1e9),
  )[0];
}

export function buildRows(
  candidates: readonly Candidate[],
  foundOf: (candidate: Candidate) => Found[],
  alliances: readonly OwnAlliance[],
  unlisted: Tier | null,
): ViewRow[] {
  const byId = new Map(alliances.map((a) => [a.alliance_id, allianceLabel(a)]));
  return candidates.map((candidate) => {
    const found = foundOf(candidate);
    const best = bestOf(found);
    const fromUid = serverFromUid(candidateUid(candidate));
    return {
      candidate,
      found,
      best,
      tier: best?.place != null ? tierOf(best.place) : best ? null : unlisted,
      server: best?.server_id ?? fromUid,
      serverGuessed: best === undefined && fromUid !== null,
      allianceNow: best?.alliance_name ?? null,
      desiredId: candidate.desired_alliance_id,
      desiredLabel:
        candidate.desired_alliance_id === null
          ? null
          : (byId.get(candidate.desired_alliance_id) ?? '(gone)'),
    };
  });
}

// ------------------------------------------------------------------ filtering

export const ALL = '';
/** The filter value that keeps rows with nothing in that field. */
export const NONE = '__none';

export interface Filters {
  /** Part of the name, the typed text or the uid. */
  search: string;
  server: string;
  allianceNow: string;
  desired: string;
  tier: string;
}

export const NO_FILTERS: Filters = {
  search: '',
  server: ALL,
  allianceNow: ALL,
  desired: ALL,
  tier: ALL,
};

export function filtersActive(f: Filters): boolean {
  return Object.values(f).some((v) => v !== '');
}

export function applyFilters(rows: readonly ViewRow[], f: Filters): ViewRow[] {
  const needle = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (needle !== '') {
      const hay = [
        r.candidate.query,
        r.best?.name ?? '',
        String(r.best?.game_uid ?? candidateUid(r.candidate) ?? ''),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (f.server !== ALL) {
      if (f.server === NONE ? r.server !== null : String(r.server) !== f.server) return false;
    }
    if (f.allianceNow !== ALL) {
      if (f.allianceNow === NONE ? r.allianceNow !== null : r.allianceNow !== f.allianceNow) {
        return false;
      }
    }
    if (f.desired !== ALL) {
      if (f.desired === NONE ? r.desiredId !== null : r.desiredId !== f.desired) return false;
    }
    if (f.tier !== ALL) {
      if (f.tier === NONE ? r.tier !== null : r.tier !== f.tier) return false;
    }
    return true;
  });
}

/** What each filter can offer, from the rows as they are. */
export function facets(rows: readonly ViewRow[]): {
  servers: number[];
  alliancesNow: string[];
} {
  const servers = new Set<number>();
  const alliances = new Set<string>();
  for (const r of rows) {
    if (r.server !== null) servers.add(r.server);
    if (r.allianceNow !== null) alliances.add(r.allianceNow);
  }
  return {
    servers: [...servers].sort((a, b) => a - b),
    alliancesNow: [...alliances].sort((a, b) => a.localeCompare(b)),
  };
}

// -------------------------------------------------------------------- sorting

export type Direction = 'asc' | 'desc';

export interface Sort {
  key: string;
  direction: Direction;
}

/** Strongest tier first, the way the game ranks them. */
const TIER_RANK: Record<Tier, number> = { commander: 0, elite: 1, advanced: 2, backbone: 3 };

type Cell = number | string | null;

/** The value a header sorts by; null sorts last in either direction. */
export function cellOf(row: ViewRow, key: string, columns: readonly CandidateColumn[]): Cell {
  switch (key) {
    case 'name':
      return (row.best?.name ?? row.candidate.query).toLowerCase();
    case 'server':
      return row.server;
    case 'allianceNow':
      return row.allianceNow?.toLowerCase() ?? null;
    case 'power':
      return row.best?.power ?? null;
    case 'migratePower':
      return row.best?.migrate_power ?? null;
    case 'place':
      return row.best?.place ?? null;
    case 'tier':
      return row.tier === null ? null : TIER_RANK[row.tier];
    case 'read':
      return row.best?.captured_at ?? null;
    case 'desired':
      return row.desiredLabel?.toLowerCase() ?? null;
    default: {
      const column = columns.find((c) => `col:${c.column_id}` === key);
      if (column === undefined) return null;
      const text = (row.candidate.extra[column.column_id] ?? '').trim();
      if (text === '') return null;
      if (column.kind === 'number') {
        const n = Number(text.replace(/,/g, ''));
        return Number.isFinite(n) ? n : null;
      }
      if (column.kind === 'dropdown') {
        const at = column.options.indexOf(text);
        return at < 0 ? null : at;
      }
      return text.toLowerCase();
    }
  }
}

export function sortRows(
  rows: readonly ViewRow[],
  sort: Sort | null,
  columns: readonly CandidateColumn[],
): ViewRow[] {
  if (sort === null) return [...rows];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, cell: cellOf(row, sort.key, columns) }))
    .sort((a, b) => {
      if (a.cell === null && b.cell === null) return a.index - b.index;
      if (a.cell === null) return 1;
      if (b.cell === null) return -1;
      const order =
        typeof a.cell === 'number' && typeof b.cell === 'number'
          ? a.cell - b.cell
          : String(a.cell).localeCompare(String(b.cell));
      return sign * order || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** One click: ascending, then descending, then back to the order they were added in. */
export function nextSort(current: Sort | null, key: string): Sort | null {
  if (current === null || current.key !== key) return { key, direction: 'asc' };
  return current.direction === 'asc' ? { key, direction: 'desc' } : null;
}
