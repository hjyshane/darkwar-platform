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
