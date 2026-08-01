import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import type { LineupEquipment, LineupHero, LineupSkill } from '../../lib/troops';
import { composition } from '../../lib/troops';
import { type ArenaEntryRow, type ArenaHeader, ArenaTable } from './ArenaTable';

/** Narrow a jsonb column to the record list the parser writes.
 *
 * Anything that is not an array of objects carrying the identifying key is
 * dropped rather than trusted — the column is jsonb precisely so the parser
 * can put shapes there without a migration, which means the reader cannot
 * assume one.
 */
function asList<T>(value: unknown, idKey: string): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is T => typeof item === 'object' && item !== null && idKey in item,
  );
}

interface ArenaData {
  header: ArenaHeader | null;
  entries: ArenaEntryRow[];
}

async function fetchArena(): Promise<ArenaData> {
  const { data: headers, error: headerError } = await supabase
    .from('arena_snapshots')
    .select('snapshot_id, week_start, captured_at, entry_count')
    .order('captured_at', { ascending: false })
    .limit(1);
  if (headerError) {
    throw new Error(`arena header query failed: ${headerError.message}`);
  }
  const header = headers[0];
  if (header === undefined) {
    return { header: null, entries: [] };
  }
  const { data: entries, error: entriesError } = await supabase
    .from('arena_entries')
    .select(
      'snapshot_id, rank, name, game_uid, server_id, alliance_name, alliance_code, score, defense_power',
    )
    .eq('arena_snapshot_id', header.snapshot_id)
    .order('rank', { ascending: true });
  if (entriesError) {
    throw new Error(`arena entries query failed: ${entriesError.message}`);
  }

  // Chunked at 100: PostgREST puts an `in.(...)` filter in the URL, and a
  // Top100 board is exactly the size at which that starts to matter — the
  // sync worker chunks the same way for the same reason.
  const lineups = new Map<string, LineupHero[]>();
  const ids = entries.map((entry) => entry.snapshot_id);
  for (let start = 0; start < ids.length; start += 100) {
    const { data: heroes, error: heroesError } = await supabase
      .from('arena_entry_heroes')
      .select(
        'arena_entry_id, slot, hero_id, troop_class, hero_level, star, hero_power, weapon_level, skills, equipment',
      )
      .in('arena_entry_id', ids.slice(start, start + 100));
    if (heroesError) {
      throw new Error(`arena lineup query failed: ${heroesError.message}`);
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

  return {
    header,
    entries: entries.map((entry) => {
      const lineup = lineups.get(entry.snapshot_id) ?? [];
      return { ...entry, lineup, composition: composition(lineup) };
    }),
  };
}

export function ArenaPanel() {
  const { data, error, isPending } = useQuery({ queryKey: ['arena'], queryFn: fetchArena });
  return (
    <section aria-labelledby="arena-heading">
      <h2 id="arena-heading">{TERMS.arena}</h2>
      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load arena: {error.message}</p>}
      {data &&
        (data.header === null ? (
          <p className="empty">No arena snapshot yet.</p>
        ) : (
          <ArenaTable header={data.header} entries={data.entries} />
        ))}
    </section>
  );
}
