import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { type ArenaEntryRow, type ArenaHeader, ArenaTable } from './ArenaTable';

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
    .select('snapshot_id, rank, name, game_uid, score, defense_power')
    .eq('arena_snapshot_id', header.snapshot_id)
    .order('rank', { ascending: true });
  if (entriesError) {
    throw new Error(`arena entries query failed: ${entriesError.message}`);
  }
  return { header, entries };
}

export function ArenaPanel() {
  const { data, error, isPending } = useQuery({ queryKey: ['arena'], queryFn: fetchArena });
  return (
    <section aria-labelledby="arena-heading">
      <h2 id="arena-heading">아레나</h2>
      {isPending && <p className="empty">불러오는 중…</p>}
      {error && <p className="error">아레나를 불러오지 못했습니다: {error.message}</p>}
      {data &&
        (data.header === null ? (
          <p className="empty">아레나 스냅샷이 아직 없습니다.</p>
        ) : (
          <ArenaTable header={data.header} entries={data.entries} />
        ))}
    </section>
  );
}
