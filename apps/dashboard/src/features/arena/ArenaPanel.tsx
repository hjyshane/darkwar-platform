import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { compareLeagues, leagueLabel, leagueScope } from '../../lib/arenaLeague';
import { formatAge } from '../../lib/freshness';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { composition } from '../../lib/troops';
import { type ArenaEntryRow, type ArenaHeader, ArenaTable } from './ArenaTable';
import { narrowHero } from './lineups';

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
  // The lineups ride EMBEDDED in the entries answer rather than fetched in a
  // second wave. The second wave was a full ocean round trip (~150-400 ms)
  // that could not leave until this one landed — the same dependent-wave cost
  // the members screen paid eight times over before 0102-0106. PostgREST
  // resolves the embed through arena_entry_heroes' entry FK and its index, so
  // the database does the same indexed reads it did before, in one request.
  const { data: entries, error: entriesError } = await supabase
    .from('arena_entries')
    .select(
      // One literal, not a concatenation — supabase-js parses this string at
      // the type level and a `+` degrades every row to an error type (the
      // 0102 lesson, second sighting).
      'snapshot_id, player_id, rank, name, game_uid, server_id, alliance_name, alliance_code, score, defense_power, arena_entry_heroes (arena_entry_id, slot, hero_id, troop_class, hero_level, level_synced, star, stage, hero_power, weapon_level, skills, equipment)',
    )
    .eq('arena_snapshot_id', snapshotId)
    .order('rank', { ascending: true });
  if (entriesError) {
    throw new Error(`arena entries query failed: ${entriesError.message}`);
  }

  return entries.map(({ arena_entry_heroes, ...entry }) => {
    const lineup = arena_entry_heroes.map(narrowHero);
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
