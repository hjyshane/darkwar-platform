import { supabase } from '../../lib/supabase';
import type { LineupEquipment, LineupHero, LineupSkill } from '../../lib/troops';

/** Narrow a jsonb column to the record list the parser writes.
 *
 * Anything that is not an array of objects carrying the identifying key is
 * dropped rather than trusted — the column is jsonb precisely so the parser
 * can put shapes there without a migration, which means the reader cannot
 * assume one.
 */
export function asList<T>(value: unknown, idKey: string): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is T => typeof item === 'object' && item !== null && idKey in item,
  );
}

/** The decoded defence lineups for a set of arena entries.
 *
 * Chunked at 100: PostgREST puts an `in.(...)` filter in the URL, and a
 * Top100 board is exactly the size at which that starts to matter — the sync
 * worker chunks the same way for the same reason.
 *
 * Shared by the arena board and the player page. They ask the same question
 * of the same table, and the jsonb narrowing below is the kind of thing that
 * drifts if it is written twice.
 */
export async function fetchLineups(
  entryIds: readonly string[],
): Promise<Map<string, LineupHero[]>> {
  const lineups = new Map<string, LineupHero[]>();
  for (let start = 0; start < entryIds.length; start += 100) {
    const { data: heroes, error } = await supabase
      .from('arena_entry_heroes')
      .select(
        'arena_entry_id, slot, hero_id, troop_class, hero_level, level_synced, star, stage, hero_power, weapon_level, skills, equipment',
      )
      .in('arena_entry_id', entryIds.slice(start, start + 100));
    if (error) {
      throw new Error(`arena lineup query failed: ${error.message}`);
    }
    for (const row of heroes) {
      const hero: LineupHero = {
        ...row,
        // skills and equipment are jsonb, so they arrive as `Json` and have
        // to be narrowed at the boundary rather than asserted through. A
        // shape the parser did not write reads as absent, not as a crash.
        skills: asList<LineupSkill>(row.skills, 'skill_id'),
        equipment: asList<LineupEquipment>(row.equipment, 'equipment_id'),
      };
      const group = lineups.get(row.arena_entry_id);
      if (group === undefined) {
        lineups.set(row.arena_entry_id, [hero]);
      } else {
        group.push(hero);
      }
    }
  }
  return lineups;
}
