import { TIERS_TOP_DOWN, type Tier, type TierBoardRow, tierOf } from './candidates';
import { type MigrationAlliance, type MigrationPerson, type MigrationServer, delta } from './data';
import type { Mover } from './movers';

/** The game ends every uid in the six digits of the server the account was made on. */
export function homeServerOf(uid: number): number {
  return uid % 1_000_000;
}

/** How many places each tier spans on the merged board; backbone has no end. */
export const TIER_SIZE: Record<Tier, number | null> = {
  commander: 10,
  elite: 36,
  advanced: 180,
  backbone: null,
};

export interface ServerFlow {
  server: number;
  arrived: number;
  left: number;
  /** arrived − left */
  net: number;
  powerIn: number;
  powerOut: number;
  /** powerIn − powerOut */
  powerNet: number;
}

/** Per server, who the lists and rosters show arriving and leaving, with the power they
 * carried. Like `tally`, "left" is only what was seen land somewhere. */
export function serverFlows(movers: readonly Mover[]): ServerFlow[] {
  const by = new Map<number, ServerFlow>();
  const at = (server: number) => {
    const held = by.get(server) ?? {
      server,
      arrived: 0,
      left: 0,
      net: 0,
      powerIn: 0,
      powerOut: 0,
      powerNet: 0,
    };
    by.set(server, held);
    return held;
  };
  for (const m of movers) {
    const to = at(m.server_id);
    to.arrived += 1;
    to.powerIn += m.power;
    const from = at(m.home_server);
    from.left += 1;
    from.powerOut += m.power;
  }
  for (const f of by.values()) {
    f.net = f.arrived - f.left;
    f.powerNet = f.powerIn - f.powerOut;
  }
  return [...by.values()].sort((a, b) => a.server - b.server);
}

export interface BoardShift {
  server: number;
  /** Players of the top-226 board who started on this server. */
  home: number;
  /** Players of the top-226 board standing on this server now. */
  now: number;
  /** now − home */
  net: number;
  powerHome: number;
  powerNow: number;
  /** Net change in top-226 places, per tier, top tier first. */
  byTier: Record<Tier, number>;
}

const noTiers = (): Record<Tier, number> => ({
  commander: 0,
  elite: 0,
  advanced: 0,
  backbone: 0,
});

/** The top-226 board counted by where each player started (their uid) against where they
 * stand now. The merged place does not move with a migration, so this isolates what the
 * move did to each server's share of the strongest players. */
export function boardShift(rows: readonly TierBoardRow[]): BoardShift[] {
  const by = new Map<number, BoardShift>();
  const at = (server: number) => {
    const held = by.get(server) ?? {
      server,
      home: 0,
      now: 0,
      net: 0,
      powerHome: 0,
      powerNow: 0,
      byTier: noTiers(),
    };
    by.set(server, held);
    return held;
  };
  for (const r of rows) {
    const tier = tierOf(r.overall_rank);
    const home = at(homeServerOf(r.game_uid));
    home.home += 1;
    home.powerHome += r.power;
    home.byTier[tier] -= 1;
    const now = at(r.server_id);
    now.now += 1;
    now.powerNow += r.power;
    now.byTier[tier] += 1;
  }
  for (const s of by.values()) s.net = s.now - s.home;
  return [...by.values()].sort((a, b) => a.server - b.server);
}

export interface TierMobility {
  tier: Tier;
  /** Places the tier spans; null for backbone. */
  size: number | null;
  /** Movers the lists and rosters show in this tier, by their current place. */
  moved: number;
  power: number;
  /** moved / size, or null when the tier has no end to divide by. */
  share: number | null;
}

/** How many of each tier moved. The three named tiers sit wholly on the board, so their
 * share is a real fraction of the tier; backbone has no end and only the movers we have
 * seen, so it is a count and nothing more. */
export function tierMobility(movers: readonly Mover[]): TierMobility[] {
  return TIERS_TOP_DOWN.map((tier) => {
    const inTier = movers.filter((m) => tierOf(m.board_rank) === tier);
    const size = TIER_SIZE[tier];
    return {
      tier,
      size,
      moved: inTier.length,
      power: inTier.reduce((acc, m) => acc + m.power, 0),
      share: size === null ? null : inTier.length / size,
    };
  });
}

export interface Route {
  from: number;
  to: number;
  count: number;
  power: number;
  byTier: Record<Tier, number>;
}

/** Routes with their movers split by tier, biggest first. */
export function routes(movers: readonly Mover[]): Route[] {
  const by = new Map<string, Route>();
  for (const m of movers) {
    const key = `${m.home_server}>${m.server_id}`;
    const route = by.get(key) ?? {
      from: m.home_server,
      to: m.server_id,
      count: 0,
      power: 0,
      byTier: noTiers(),
    };
    route.count += 1;
    route.power += m.power;
    route.byTier[tierOf(m.board_rank)] += 1;
    by.set(key, route);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.from - b.from || a.to - b.to);
}

export interface Shift<T> {
  item: T;
  /** after − before. */
  change: number;
}

/** The `n` largest rises and the `n` largest falls of a signed change. Zero and unknown
 * changes are in neither list. */
export function extremes<T>(
  items: readonly T[],
  change: (item: T) => number | null,
  n: number,
): { up: Array<Shift<T>>; down: Array<Shift<T>> } {
  const shifts: Array<Shift<T>> = [];
  for (const item of items) {
    const c = change(item);
    if (c !== null && c !== 0) shifts.push({ item, change: c });
  }
  return {
    up: shifts
      .filter((s) => s.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, n),
    down: shifts
      .filter((s) => s.change < 0)
      .sort((a, b) => a.change - b.change)
      .slice(0, n),
  };
}

/** Power change of a person seen on both top-150 boards. */
export function personPowerChange(p: MigrationPerson): number | null {
  return delta(p.before_power, p.after_power);
}

/** Place change of a person seen on both boards; positive is a climb (a smaller place). */
export function personRankClimb(p: MigrationPerson): number | null {
  const d = delta(p.before_rank, p.after_rank);
  return d === null ? null : -d;
}

/** An alliance's power change the way the Alliances view reads it: the alliance board
 * where it is on it, the roster otherwise. */
export function alliancePowerChange(a: MigrationAlliance): number | null {
  return delta(
    a.board_power_before ?? a.roster_power_before,
    a.board_power_after ?? a.roster_power_after,
  );
}

/** Top-150 power change of a server across the window. */
export function serverPowerChange(s: MigrationServer): number | null {
  return delta(s.top_power_before, s.top_power_after);
}

/** Share of `value` in `max`, 0–1; zero for anything that cannot be drawn. */
export function scale(value: number, max: number): number {
  return max > 0 && Number.isFinite(value) ? Math.min(1, Math.abs(value) / max) : 0;
}
