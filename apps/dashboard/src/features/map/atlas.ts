// The map of one server: every swept base, coloured by the alliance it was last
// seen in, with a ranking of those alliances (0260 map_atlas).
//
// THE COUNTS ARE BASES SEEN, NOT MEMBERS. A base is on the map where a sweep
// last saw it, and its alliance is the last one the player was seen in — neither
// is cleared when they go. So "99 bases" means 99 swept bases whose player was
// last seen in that alliance, and nothing here claims who is in it today.

import type { Coordinate } from '@dw/ui';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

/** A sighting older than this is drawn faded: the base may have moved. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Fewer than this many characters is not a search. */
export const MIN_SEARCH = 2;

export interface AtlasAlliance {
  id: string;
  code: string | null;
  name: string | null;
  bases: number;
  power: number;
}

export interface AtlasBase {
  gameUid: number;
  at: Coordinate;
  hq: number | null;
  power: number | null;
  /** Index into `alliances`, or -1 when no alliance is known. */
  alliance: number;
  seenAt: Date;
  name: string | null;
  /** When the shield ends, as of the sighting; null when never shielded. */
  shieldEnd: Date | null;
}

export interface Atlas {
  alliances: AtlasAlliance[];
  bases: AtlasBase[];
}

export const EMPTY_ATLAS: Atlas = { alliances: [], bases: [] };

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The jsonb `map_atlas` returns. A row that is not shaped as expected is
 * dropped rather than guessed at: an unplaceable base is better missing than
 * drawn at (0, 0). */
export function parseAtlas(json: unknown): Atlas {
  if (typeof json !== 'object' || json === null) return EMPTY_ATLAS;
  const { alliances, bases } = json as { alliances?: unknown; bases?: unknown };
  const parsedAlliances: AtlasAlliance[] = [];
  for (const raw of Array.isArray(alliances) ? alliances : []) {
    const row = raw as Record<string, unknown>;
    const id = text(row.id);
    if (id === null) continue;
    parsedAlliances.push({
      id,
      code: text(row.code),
      name: text(row.name),
      bases: num(row.bases) ?? 0,
      power: num(row.power) ?? 0,
    });
  }
  const parsedBases: AtlasBase[] = [];
  for (const raw of Array.isArray(bases) ? bases : []) {
    if (!Array.isArray(raw)) continue;
    const [uid, x, y, hq, power, alliance, seen, name, shield] = raw;
    if (num(uid) === null || num(x) === null || num(y) === null || num(seen) === null) continue;
    const index = num(alliance) ?? -1;
    parsedBases.push({
      gameUid: uid as number,
      at: { x: x as number, y: y as number },
      hq: num(hq),
      power: num(power),
      alliance: index < parsedAlliances.length ? index : -1,
      seenAt: new Date((seen as number) * 1000),
      name: text(name),
      shieldEnd: num(shield) === null ? null : new Date((shield as number) * 1000),
    });
  }
  return { alliances: parsedAlliances, bases: parsedBases };
}

/** Our own alliance's colour; every other alliance gets one from its id. */
export const OURS_COLOR = '#22d3ee';
export const NO_ALLIANCE_COLOR = '#94a3b8';

/** A colour from the alliance's id, so it is the same on every visit and does
 * not shuffle when the ranking does. */
export function allianceColor(id: string | null, ours = false): string {
  if (ours) return OURS_COLOR;
  if (id === null) return NO_ALLIANCE_COLOR;
  // FNV-1a, then a finalizer: ids that differ in one character (and the last one
  // is all that differs in a short id) still land far apart on the colour wheel.
  let hash = 2_166_136_261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16_777_619) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 2_246_822_507) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 3_266_489_909) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return `hsl(${hash % 360} 70% 58%)`;
}

export function isStale(base: Pick<AtlasBase, 'seenAt'>, now: Date): boolean {
  return now.getTime() - base.seenAt.getTime() > STALE_AFTER_MS;
}

/** Shielded at the moment of the sighting. A base last seen long ago with a
 * shield that had already ended may be shielded now; nothing here can know. */
export function isShielded(base: Pick<AtlasBase, 'shieldEnd'>, now: Date): boolean {
  return base.shieldEnd !== null && base.shieldEnd.getTime() > now.getTime();
}

/** Time left on a shield as `23h 5m`, `42m` or `<1m`; null when it has ended. */
export function shieldLeft(end: Date, now: Date): string | null {
  const minutes = Math.floor((end.getTime() - now.getTime()) / 60_000);
  if (end.getTime() <= now.getTime()) return null;
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${minutes % 60}m`;
}

/** What a click puts on the clipboard: `[X:123 Y:456]`, which is how a
 * coordinate is pasted into the game's chat and into the search box here. */
export function formatCopyCoordinate(at: Coordinate): string {
  return `[X:${at.x} Y:${at.y}]`;
}

/** `446:393`, `446, 393`, `446 393` or `[X:446 Y:393]`. */
export function parseCoordinate(query: string): Coordinate | null {
  const match =
    /^\s*\[?\s*(?:x\s*:?\s*)?(\d{1,3})\s*[:,\s]\s*(?:y\s*:?\s*)?(\d{1,3})\s*\]?\s*$/i.exec(query);
  if (match === null) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

export type AtlasSearch =
  | { kind: 'none' }
  | { kind: 'coordinate'; at: Coordinate; nearest: AtlasBase[] }
  | { kind: 'text'; alliances: number[]; bases: AtlasBase[] };

const NEAREST = 5;

/** A coordinate finds the bases nearest it; text finds alliances by code or
 * name and players by name. */
export function searchAtlas(atlas: Atlas, query: string): AtlasSearch {
  const at = parseCoordinate(query);
  if (at !== null) {
    const nearest = [...atlas.bases]
      .sort(
        (a, b) =>
          Math.hypot(a.at.x - at.x, a.at.y - at.y) - Math.hypot(b.at.x - at.x, b.at.y - at.y),
      )
      .slice(0, NEAREST);
    return { kind: 'coordinate', at, nearest };
  }
  const term = query.trim().toLowerCase();
  if (term.length < MIN_SEARCH) return { kind: 'none' };
  const alliances = atlas.alliances.flatMap((alliance, index) =>
    (alliance.code ?? '').toLowerCase().includes(term) ||
    (alliance.name ?? '').toLowerCase().includes(term)
      ? [index]
      : [],
  );
  const inAlliance = new Set(alliances);
  const bases = atlas.bases.filter(
    (base) =>
      (base.name ?? '').toLowerCase().includes(term) ||
      (base.alliance >= 0 && inAlliance.has(base.alliance)),
  );
  return { kind: 'text', alliances, bases };
}

export interface BaseFilter {
  hqMin: number | null;
  hqMax: number | null;
  /** Keep bases with power below this; a base of unknown power is kept out. */
  powerUnder: number | null;
  hideStale: boolean;
  /** Shielded as of the sighting, not shielded, or either. */
  shield: 'all' | 'shielded' | 'open';
}

export const NO_BASE_FILTER: BaseFilter = {
  hqMin: null,
  hqMax: null,
  powerUnder: null,
  hideStale: false,
  shield: 'all',
};

export function filterActive(filter: BaseFilter): boolean {
  return (
    filter.hqMin !== null ||
    filter.hqMax !== null ||
    filter.powerUnder !== null ||
    filter.hideStale ||
    filter.shield !== 'all'
  );
}

export function matchesFilter(base: AtlasBase, filter: BaseFilter, now: Date): boolean {
  if (filter.hqMin !== null && (base.hq === null || base.hq < filter.hqMin)) return false;
  if (filter.hqMax !== null && (base.hq === null || base.hq > filter.hqMax)) return false;
  if (filter.powerUnder !== null && (base.power === null || base.power >= filter.powerUnder)) {
    return false;
  }
  if (filter.hideStale && isStale(base, now)) return false;
  if (filter.shield === 'shielded' && !isShielded(base, now)) return false;
  if (filter.shield === 'open' && isShielded(base, now)) return false;
  return true;
}

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/** `135m`, `2.5b`, `800k` or plain digits, as the game writes power. */
export function parsePower(text: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kmb])?\s*$/i.exec(text);
  if (match === null) return null;
  const unit = match[2] ? (SUFFIX[match[2].toLowerCase()] ?? 1) : 1;
  return Math.round(Number(match[1]) * unit);
}

/** Strongest first; the list beside the map is read from the top. */
export function byPower(bases: readonly AtlasBase[]): AtlasBase[] {
  return [...bases].sort((a, b) => (b.power ?? -1) - (a.power ?? -1) || a.gameUid - b.gameUid);
}

/** The middle of an alliance's bases, for sending the map to it. */
export function centroid(bases: readonly AtlasBase[]): Coordinate | null {
  if (bases.length === 0) return null;
  const sum = bases.reduce((s, b) => ({ x: s.x + b.at.x, y: s.y + b.at.y }), { x: 0, y: 0 });
  return { x: Math.round(sum.x / bases.length), y: Math.round(sum.y / bases.length) };
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const formatPower = (power: number | null): string =>
  power === null ? '—' : compact.format(power);

export async function fetchAtlas(serverId: number): Promise<Atlas> {
  const { data, error } = await supabase.rpc('map_atlas', { p_server_id: serverId });
  if (error) {
    if (error.code === '42501') return EMPTY_ATLAS;
    throw new Error(`map query failed: ${error.message}`);
  }
  return parseAtlas(data);
}

export function useAtlas(serverId: number | null) {
  return useQuery({
    queryKey: ['map', 'atlas', serverId],
    queryFn: () => fetchAtlas(serverId as number),
    enabled: serverId !== null,
    // Only a sweep changes it, and a sweep is a deliberate act.
    staleTime: 5 * 60_000,
  });
}

export interface Cluster {
  /** Index into `alliances`. */
  alliance: number;
  at: Coordinate;
  /** How far the alliance spreads from `at`, in tiles: enough to cover most of it. */
  radius: number;
}

/** Fewer bases than this is a scatter, not a clump worth a halo and a name. */
export const MIN_CLUSTER = 5;

/** Where each sizeable alliance sits and how wide it is, for the glow and the name
 * drawn behind and over its dots. The radius is the 85th-percentile distance from
 * the middle, so a few stragglers across the map do not inflate the glow. */
export function clusters(atlas: Atlas): Cluster[] {
  const found: Cluster[] = [];
  atlas.alliances.forEach((alliance, index) => {
    if (alliance.bases < MIN_CLUSTER) return;
    const members = atlas.bases.filter((base) => base.alliance === index);
    const middle = centroid(members);
    if (middle === null || members.length < MIN_CLUSTER) return;
    const distances = members
      .map((base) => Math.hypot(base.at.x - middle.x, base.at.y - middle.y))
      .sort((a, b) => a - b);
    const radius = distances[Math.floor(distances.length * 0.85)] ?? 0;
    found.push({ alliance: index, at: middle, radius: Math.max(8, Math.round(radius)) });
  });
  return found;
}

/** Bases shielded right now, per alliance index: the "2 shielded" under a ranking row. */
export function shieldedCounts(atlas: Atlas, now: Date): number[] {
  const counts = atlas.alliances.map(() => 0);
  for (const base of atlas.bases) {
    if (base.alliance >= 0 && isShielded(base, now))
      counts[base.alliance] = (counts[base.alliance] ?? 0) + 1;
  }
  return counts;
}

/** A name pill is about this wide at zoom 1, in tiles of a 1,000-tile map drawn
 * about 700 px across. It stays the same size on screen as the window zooms in, so
 * the room it takes, in tiles, shrinks with the zoom. */
export const LABEL_SPAN_TILES = 90;

/** The clump names that fit without sitting on each other: biggest alliance first,
 * and a clump is dropped when a bigger one already has a name within the room a
 * pill takes at this zoom. Zooming in brings the smaller ones back. */
export function visibleLabels(found: readonly Cluster[], atlas: Atlas, zoom: number): Cluster[] {
  const room = LABEL_SPAN_TILES / Math.max(1, zoom);
  const bySize = [...found].sort(
    (a, b) => (atlas.alliances[b.alliance]?.bases ?? 0) - (atlas.alliances[a.alliance]?.bases ?? 0),
  );
  const kept: Cluster[] = [];
  for (const clump of bySize) {
    const crowded = kept.some(
      (other) => Math.hypot(other.at.x - clump.at.x, (other.at.y - clump.at.y) * 2.2) < room,
    );
    if (!crowded) kept.push(clump);
  }
  return kept;
}

/** Zoom from which base names are drawn at all. */
export const NAME_ZOOM = 10;
/** Zoom from which the alliance clump names step aside for the base names. */
export const CLUMP_NAME_HIDE_ZOOM = 12;
/** Zoom from which a base is drawn as its tower instead of a dot. The tower
 * starts at a small fixed size and grows with the map from about zoom 11, so
 * there is no level where everything jumps. */
export const TOWER_ZOOM = 8;

// How much screen a base name takes, and how far apart tiles sit on screen at
// zoom 1: the same ~700 px per 1,000 tiles LABEL_SPAN_TILES assumes, squashed
// vertically because the plot is wider than it is tall. Estimates on purpose: the
// window can be any size, and a name hidden by a wrong guess comes back one
// zoom step later while one that overlaps stays unreadable.
const PX_PER_TILE_X = 0.7;
const PX_PER_TILE_Y = 0.58;
const NAME_HEIGHT_PX = 14;
const NAME_GAP_PX = 3;

function nameWidthPx(name: string, hq: number | null): number {
  // Wide scripts (Korean, Chinese, Vietnamese stacks) run about twice a Latin letter.
  let width = 10;
  for (const ch of name) width += ch.charCodeAt(0) < 0x250 ? 5.6 : 10;
  // The "HQ27" tag after the name.
  return hq === null ? width : width + 34;
}

/** The base names that fit on screen without sitting on each other at `zoom`.
 *
 * Names are placed in the order given by `first` (the picked base, the lit ones)
 * and then by power, and a name is dropped when an already placed one overlaps it.
 * Zooming in spreads the bases apart on screen, so the dropped ones come back; at
 * the last zoom steps every name fits. Returns game uids.
 *
 * `only` narrows the candidates to a highlighted set (a picked alliance, a search
 * result) so the rest of the map stays unlabelled. A base with no alliance is
 * named only when it is the `clicked` one: those are the stragglers and the
 * unknowns, and a name over each would bury the alliances that matter.
 *
 * `minZoom` lets a mode that is about names (the shield timers) start earlier. */
export function visibleNames(
  atlas: Atlas,
  zoom: number,
  first: ReadonlySet<number> = new Set(),
  only: ReadonlySet<number> | null = null,
  clicked: number | null = null,
  minZoom: number = NAME_ZOOM,
): Set<number> {
  const shown = new Set<number>();
  if (zoom < minZoom) return shown;
  const ordered = atlas.bases
    .filter((base) => base.name !== null && base.name !== '')
    .filter(
      (base) =>
        base.gameUid === clicked ||
        (base.alliance >= 0 && (only === null || only.has(base.gameUid))),
    )
    .sort(
      (a, b) =>
        Number(first.has(b.gameUid)) - Number(first.has(a.gameUid)) ||
        (b.power ?? 0) - (a.power ?? 0),
    );
  // Placed boxes bucketed on a grid, so a candidate is compared with its
  // neighbours rather than with every name already on the map.
  const CELL_X = 200;
  const CELL_Y = NAME_HEIGHT_PX + NAME_GAP_PX;
  const grid = new Map<string, { x: number; y: number; w: number }[]>();
  for (const base of ordered) {
    const name = base.name as string;
    const w = nameWidthPx(name, base.hq);
    const x = base.at.x * PX_PER_TILE_X * zoom;
    const y = base.at.y * PX_PER_TILE_Y * zoom;
    const cx = Math.floor(x / CELL_X);
    const cy = Math.floor(y / CELL_Y);
    let crowded = false;
    for (let gx = cx - 1; gx <= cx + 1 && !crowded; gx += 1) {
      for (let gy = cy - 1; gy <= cy + 1 && !crowded; gy += 1) {
        for (const other of grid.get(`${gx}:${gy}`) ?? []) {
          if (
            Math.abs(other.x - x) < (other.w + w) / 2 + NAME_GAP_PX &&
            Math.abs(other.y - y) < NAME_HEIGHT_PX + NAME_GAP_PX
          ) {
            crowded = true;
            break;
          }
        }
      }
    }
    if (crowded) continue;
    shown.add(base.gameUid);
    const key = `${cx}:${cy}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push({ x, y, w });
    else grid.set(key, [{ x, y, w }]);
  }
  return shown;
}

export interface AllianceSummary {
  bases: number;
  shielded: number;
  /** Sum of the bases whose profile has been read; the rest have no power yet. */
  realPower: number;
  profilesRead: number;
  /** The strongest bases with a known power, strongest first. */
  strongest: AtlasBase[];
}

/** The figures on an alliance's detail panel, from its bases on this map. */
export function allianceSummary(
  atlas: Atlas,
  index: number,
  now: Date,
  strongestCount = 12,
): AllianceSummary {
  const members = atlas.bases.filter((base) => base.alliance === index);
  const read = members.filter((base) => base.power !== null);
  return {
    bases: members.length,
    shielded: members.filter((base) => isShielded(base, now)).length,
    realPower: read.reduce((sum, base) => sum + (base.power ?? 0), 0),
    profilesRead: read.length,
    strongest: byPower(read).slice(0, strongestCount),
  };
}
