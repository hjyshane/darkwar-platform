// Trucks worth taking and dispatch missions worth plundering (0254).
//
// Two layers on the map, both for the same reason: they are the things an
// alliance wants to hit that the game does not point out. Pure functions here
// (what counts, where a truck is, how long is left) so the rules can be checked
// without a screen; the two queries sit at the bottom.

import type { Coordinate } from '@dw/ui';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { StripCell } from './strip';

/** The game's truck quality: 1 grey, 2 green, 3 blue, 4 purple, 5 orange.
 *
 * "Gold tier or above" has no truck of its own — the scale stops at orange —
 * so the cut is purple. It does not change the answer today: hero fragments
 * were only ever seen on quality 4 and 5 trucks, 3,004 cargo readings, so the
 * cargo test below already implies it. Named anyway, so the rule is stated
 * once and a change in the game shows up as one edit.
 */
export const TRUCK_MIN_QUALITY = 4;

/** A truck can be looted twice. */
export const TRUCK_MAX_LOOTS = 2;

/** Gold in aps_dispatch_tasks.color: 2 blue, 3 purple, 4 gold. */
export const MISSION_GOLD_COLOR = 4;

export const QUALITY_NAMES: Record<number, string> = {
  1: 'Grey',
  2: 'Green',
  3: 'Blue',
  4: 'Purple',
  5: 'Orange',
};

export interface Truck {
  truckUuid: string;
  serverId: number;
  ownerName: string | null;
  allianceAbbr: string | null;
  quality: number;
  heroFragments: number;
  /** Loots already taken from it. */
  robTimes: number | null;
  /** When the whole trip ends. */
  arriveAt: Date;
  leg: TruckLeg | null;
  positionSeenAt: Date | null;
  cargoSeenAt: Date | null;
}

export interface TruckLeg {
  from: Coordinate;
  to: Coordinate;
  startAt: Date;
  endAt: Date;
}

export interface Mission {
  missionUuid: string;
  serverId: number;
  at: Coordinate;
  ownerName: string | null;
  allianceAbbr: string | null;
  orangeBooks: number;
  stealMax: number | null;
  endsAt: Date;
}

/** `y * 1000 + x + 1`, the game's point id — the same unpacking the collector uses. */
export function pointToCoordinate(point: number): Coordinate {
  return { x: (point % 1000) - 1, y: Math.floor(point / 1000) };
}

/** A truck that is worth a march: top quality, carrying a hero fragment, still
 * on the road. */
export function isWorthTaking(truck: Truck, now: Date): boolean {
  return (
    truck.quality >= TRUCK_MIN_QUALITY &&
    truck.heroFragments > 0 &&
    truck.arriveAt.getTime() > now.getTime() &&
    lootsLeft(truck) > 0
  );
}

export function lootsLeft(truck: Pick<Truck, 'robTimes'>): number {
  // Unknown counts as untouched: the list is the only place it is read, and it
  // always carries it, so null means "not yet seen" rather than "taken".
  return Math.max(0, TRUCK_MAX_LOOTS - (truck.robTimes ?? 0));
}

export interface TruckPosition {
  at: Coordinate;
  /** True while the leg the position came from is still being walked. After it
   * ends the truck has moved on to a leg we did not see, and this is only the
   * last place it was known to be. */
  live: boolean;
}

/** Where a truck is: straight along the leg it was last seen on. */
export function truckPosition(truck: Pick<Truck, 'leg'>, now: Date): TruckPosition | null {
  const leg = truck.leg;
  if (leg === null) return null;
  const span = leg.endAt.getTime() - leg.startAt.getTime();
  const gone = now.getTime() - leg.startAt.getTime();
  if (span <= 0 || gone >= span) return { at: leg.to, live: false };
  const t = Math.max(0, gone / span);
  return {
    at: {
      x: Math.round(leg.from.x + (leg.to.x - leg.from.x) * t),
      y: Math.round(leg.from.y + (leg.to.y - leg.from.y) * t),
    },
    live: true,
  };
}

/** "1h 12m", "9m", "under a minute"; "gone" once it has passed. */
export function timeLeft(until: Date, now: Date): string {
  const minutes = Math.floor((until.getTime() - now.getTime()) / 60_000);
  if (minutes < 0) return 'gone';
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function missionIsOpen(mission: Pick<Mission, 'endsAt'>, now: Date): boolean {
  return mission.endsAt.getTime() > now.getTime();
}

export interface HuntStripInput {
  serverId: number;
  trucks: number | null;
  /** How many of those the map could place. */
  placed: number;
  missions: number | null;
}

export function huntStrip(input: HuntStripInput): StripCell[] {
  const count = (n: number | null, one: string, many: string) =>
    n === null ? null : `${n} ${n === 1 ? one : many}`;
  return [
    { label: 'Server', value: String(input.serverId) },
    {
      label: 'Trucks',
      value: count(input.trucks, 'truck', 'trucks'),
      note:
        input.trucks === null || input.trucks === 0
          ? 'purple or orange, carrying a hero fragment'
          : `${input.placed} placed on the map`,
    },
    {
      label: 'Plunder',
      value: count(input.missions, 'mission', 'missions'),
      note: 'gold, paying Orange Skill Books',
    },
  ];
}

type TruckRow = {
  truck_uuid: string | null;
  server_id: number | null;
  owner_name: string | null;
  alliance_abbr: string | null;
  quality: number | null;
  hero_fragments: number | null;
  rob_times: number | null;
  arrive_at: string | null;
  start_pos: number | null;
  target_pos: number | null;
  segment_start_at: string | null;
  segment_end_at: string | null;
  position_seen_at: string | null;
  cargo_seen_at: string | null;
};

const date = (value: string | null): Date | null => (value === null ? null : new Date(value));

/** A row is dropped, not guessed at, when it lacks what the rules need. */
export function truckFromRow(row: TruckRow): Truck | null {
  const arriveAt = date(row.arrive_at);
  if (
    row.truck_uuid === null ||
    row.server_id === null ||
    row.quality === null ||
    arriveAt === null
  ) {
    return null;
  }
  const startAt = date(row.segment_start_at);
  const endAt = date(row.segment_end_at);
  const leg: TruckLeg | null =
    row.start_pos !== null && row.target_pos !== null && startAt !== null && endAt !== null
      ? {
          from: pointToCoordinate(row.start_pos),
          to: pointToCoordinate(row.target_pos),
          startAt,
          endAt,
        }
      : null;
  return {
    truckUuid: row.truck_uuid,
    serverId: row.server_id,
    ownerName: row.owner_name,
    allianceAbbr: row.alliance_abbr,
    quality: row.quality,
    heroFragments: row.hero_fragments ?? 0,
    robTimes: row.rob_times,
    arriveAt,
    leg,
    positionSeenAt: date(row.position_seen_at),
    cargoSeenAt: date(row.cargo_seen_at),
  };
}

type MissionRow = {
  mission_uuid: string | null;
  server_id: number | null;
  x: number | null;
  y: number | null;
  owner_name: string | null;
  alliance_abbr: string | null;
  orange_books: number | null;
  steal_max: number | null;
  ends_at: string | null;
};

export function missionFromRow(row: MissionRow): Mission | null {
  const endsAt = date(row.ends_at);
  if (
    row.mission_uuid === null ||
    row.server_id === null ||
    row.x === null ||
    row.y === null ||
    endsAt === null
  ) {
    return null;
  }
  return {
    missionUuid: row.mission_uuid,
    serverId: row.server_id,
    at: { x: row.x, y: row.y },
    ownerName: row.owner_name,
    allianceAbbr: row.alliance_abbr,
    orangeBooks: row.orange_books ?? 0,
    stealMax: row.steal_max,
    endsAt,
  };
}

const REFRESH_MS = 60_000;

export async function fetchTrucks(serverId: number): Promise<Truck[]> {
  const { data, error } = await supabase
    .from('world_trucks_latest')
    .select(
      'truck_uuid, server_id, owner_name, alliance_abbr, quality, hero_fragments, rob_times, arrive_at, start_pos, target_pos, segment_start_at, segment_end_at, position_seen_at, cargo_seen_at',
    )
    .eq('server_id', serverId)
    .gte('quality', TRUCK_MIN_QUALITY)
    .gt('hero_fragments', 0)
    .order('arrive_at', { ascending: true });
  if (error) {
    if (error.code === '42501') return [];
    throw new Error(`trucks query failed: ${error.message}`);
  }
  const trucks: Truck[] = [];
  for (const row of data ?? []) {
    const truck = truckFromRow(row);
    if (truck !== null) trucks.push(truck);
  }
  return trucks;
}

export async function fetchMissions(serverId: number): Promise<Mission[]> {
  const { data, error } = await supabase
    .from('dispatch_missions_live')
    .select(
      'mission_uuid, server_id, x, y, owner_name, alliance_abbr, orange_books, steal_max, ends_at',
    )
    .eq('server_id', serverId)
    .eq('color', MISSION_GOLD_COLOR)
    .gt('orange_books', 0)
    .gt('ends_at', new Date().toISOString())
    .order('ends_at', { ascending: true });
  if (error) {
    if (error.code === '42501') return [];
    throw new Error(`missions query failed: ${error.message}`);
  }
  const missions: Mission[] = [];
  for (const row of data ?? []) {
    const mission = missionFromRow(row);
    if (mission !== null) missions.push(mission);
  }
  return missions;
}

export function useTrucks(serverId: number | null) {
  return useQuery({
    queryKey: ['map', 'trucks', serverId],
    queryFn: () => fetchTrucks(serverId as number),
    enabled: serverId !== null,
    staleTime: REFRESH_MS / 2,
    refetchInterval: REFRESH_MS,
  });
}

export function useMissions(serverId: number | null) {
  return useQuery({
    queryKey: ['map', 'missions', serverId],
    queryFn: () => fetchMissions(serverId as number),
    enabled: serverId !== null,
    staleTime: REFRESH_MS / 2,
    refetchInterval: REFRESH_MS,
  });
}
