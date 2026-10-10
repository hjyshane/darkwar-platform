// The hive plan laid over the atlas: which planned tiles have a base on them.
//
// A hive slot's (x, y) is the CENTRE of a 3x3 base, the same point the atlas
// keeps for a swept base, so "standing where the plan says" is an exact match
// on that point. A tile with nobody there is the one still to be filled, or
// the one somebody has not moved to yet.

import { useQuery } from '@tanstack/react-query';
import {
  type BoardSlot,
  type Formation,
  fetchBoard,
  fetchFormations,
} from '../hive/hiveFormations';
import type { AtlasBase } from './atlas';

export interface PlanTile {
  slot: BoardSlot;
  /** The swept base standing on this tile's centre, if there is one. */
  base: AtlasBase | null;
}

export interface PlanMatch {
  tiles: PlanTile[];
  placed: number;
  total: number;
}

const key = (x: number, y: number) => `${x}:${y}`;

/** Every base tile of the plan with the swept base on it, or none. Structures
 * (markers, ground) are not somebody's base and are left out. */
export function matchPlan(slots: readonly BoardSlot[], bases: readonly AtlasBase[]): PlanMatch {
  const at = new Map<string, AtlasBase>();
  for (const base of bases) at.set(key(base.at.x, base.at.y), base);
  const tiles = slots
    .filter((slot) => slot.kind === 'base')
    .map((slot) => ({ slot, base: at.get(key(slot.x, slot.y)) ?? null }));
  return { tiles, placed: tiles.filter((t) => t.base !== null).length, total: tiles.length };
}

/** The plan to show for a server: the live one, else the newest. Queries share
 * the hive screen's cache keys, and only run once the mode is chosen. */
export function usePlan(serverId: number, enabled: boolean) {
  const formations = useQuery({
    queryKey: ['hive', 'formations', serverId],
    queryFn: () => fetchFormations(serverId),
    staleTime: 60_000,
    enabled,
  });
  const formation: Formation | null = formations.data?.[0] ?? null;
  const board = useQuery({
    queryKey: ['hive', 'board', formation?.formationId ?? null],
    queryFn: () => fetchBoard(formation?.formationId as string),
    staleTime: 30_000,
    enabled: enabled && formation !== null,
  });
  return {
    formation,
    slots: board.data ?? [],
    loading: enabled && (formations.isPending || (formation !== null && board.isPending)),
    error: formations.error ?? board.error,
  };
}
