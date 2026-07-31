import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { type MonthCardRow, MonthCardTable } from './MonthCardTable';

async function fetchMonthCards(): Promise<MonthCardRow[]> {
  // RLS decides who sees rows (admin only, migration 0016); this page just
  // renders whatever the database is willing to say.
  const { data, error } = await supabase
    .from('player_month_cards')
    .select('player_id, expires_at, observed_at, players(current_name, game_uid)')
    .order('expires_at', { ascending: true });
  if (error) {
    throw new Error(`month card query failed: ${error.message}`);
  }
  return data;
}

export function MonthCardsPage() {
  const { data, error, isPending } = useQuery({
    queryKey: ['monthCards'],
    queryFn: fetchMonthCards,
  });
  return (
    <main>
      <section aria-labelledby="month-cards-heading">
        <h2 id="month-cards-heading">{TERMS.monthlyCard}</h2>
        {isPending && <p className="empty">Loading…</p>}
        {error && <p className="error">Could not load: {error.message}</p>}
        {data && <MonthCardTable rows={data} />}
      </section>
    </main>
  );
}
