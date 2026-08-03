import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { compareLeagues, leagueLabel, leagueScope } from '../../lib/arenaLeague';
import { formatAge } from '../../lib/freshness';
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

/** The newest snapshot of each league.
 *
 * This used to be `order by captured_at desc limit 1` — one board, the most
 * recently captured one. Both leagues were being stored correctly all along;
 * the query simply could not see past the first row. The collector fetches
 * Gold and Silver seconds apart, so Silver won by 1.7 seconds and Gold's 163
 * players were never rendered.
 *
 * The window is 50 rather than "one per league" in SQL because the set is
 * tiny and a view would need its own grants — 0051 dropped one and silently
 * took its grants with it. 50 covers weeks of captures at the current rate.
 */
async function fetchBoards(): Promise<ArenaHeader[]> {
  const { data, error } = await supabase
    .from('arena_snapshots')
    .select('snapshot_id, week_start, captured_at, entry_count, league')
    .order('captured_at', { ascending: false })
    .limit(50);
  if (error) {
    throw new Error(`arena header query failed: ${error.message}`);
  }
  const newest = new Map<string, ArenaHeader>();
  for (const header of data) {
    // Rows arrive newest first, so the first sighting of a league is its
    // latest board.
    const key = String(header.league);
    if (!newest.has(key)) {
      newest.set(key, header);
    }
  }
  return [...newest.values()].sort((left, right) => compareLeagues(left.league, right.league));
}

async function fetchBoardEntries(snapshotId: string): Promise<ArenaEntryRow[]> {
  const { data: entries, error: entriesError } = await supabase
    .from('arena_entries')
    .select(
      'snapshot_id, rank, name, game_uid, server_id, alliance_name, alliance_code, score, defense_power',
    )
    .eq('arena_snapshot_id', snapshotId)
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
        'arena_entry_id, slot, hero_id, troop_class, hero_level, level_synced, star, stage, hero_power, weapon_level, skills, equipment',
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

  return entries.map((entry) => {
    const lineup = lineups.get(entry.snapshot_id) ?? [];
    return { ...entry, lineup, composition: composition(lineup) };
  });
}

export function ArenaPanel({ now }: { now?: Date }) {
  const [chosen, setChosen] = useState<number | null | undefined>(undefined);
  const boards = useQuery({ queryKey: ['arena', 'boards'], queryFn: fetchBoards });

  // Undefined means "the user has not picked", which is different from having
  // picked the board whose league is null.
  const selected =
    chosen === undefined
      ? (boards.data?.[0] ?? null)
      : (boards.data?.find((board) => board.league === chosen) ?? null);

  const entries = useQuery({
    queryKey: ['arena', 'board', selected?.snapshot_id],
    queryFn: () => fetchBoardEntries(selected?.snapshot_id ?? ''),
    enabled: selected !== null,
  });

  return (
    <section aria-labelledby="arena-heading">
      <h2 id="arena-heading">{TERMS.arena}</h2>
      {boards.isPending && <p className="empty">Loading…</p>}
      {boards.error && <p className="error">Could not load arena: {boards.error.message}</p>}
      {boards.data && boards.data.length === 0 && <p className="empty">No arena snapshot yet.</p>}

      {boards.data && boards.data.length > 0 && (
        <>
          <div role="tablist" aria-label="Arena league">
            {boards.data.map((board) => (
              <button
                key={board.snapshot_id}
                type="button"
                role="tab"
                aria-selected={board.snapshot_id === selected?.snapshot_id}
                onClick={() => setChosen(board.league)}
              >
                {leagueLabel(board.league)}
                {/* The age rides on the tab because the two boards are
                    captured separately and can drift apart. A league nobody
                    has captured this week still gets its tab and its data —
                    it says how old it is instead of vanishing. */}
                <span className="subtle"> · {formatAge(board.captured_at, now ?? new Date())}</span>
              </button>
            ))}
          </div>
          {selected && leagueScope(selected.league) && (
            <p className="subtle">{leagueScope(selected.league)}</p>
          )}
          {entries.isPending && <p className="empty">Loading…</p>}
          {entries.error && <p className="error">Could not load arena: {entries.error.message}</p>}
          {selected && entries.data && (
            <ArenaTable header={selected} entries={entries.data} now={now} />
          )}
        </>
      )}
    </section>
  );
}
