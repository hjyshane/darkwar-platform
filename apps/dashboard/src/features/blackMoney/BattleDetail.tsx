import { useQuery } from '@tanstack/react-query';
import { StatTile } from '../../components/StatTile';
import { BattleMembersTable } from './BattleMembersTable';
import { type Battle, fetchBattleMembers, noShows } from './data';

const numberFormat = new Intl.NumberFormat('ko-KR');

export function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : numberFormat.format(value);
}

/** Results arrive once per event, a fortnight apart, so the app's 60s default
 * would only re-ask a question whose answer has not moved. Realtime
 * invalidation still applies when a capture lands. */
export const STALE_TIME = 10 * 60_000;

/** What opens under a battle's row: the figures, then who was there.
 *
 * Its own component so the member query is only made for the one battle that
 * is open, and so closing the row drops it from the page rather than leaving
 * a table nobody is looking at mounted below the fold. */
export function BattleDetail({ battle }: { battle: Battle }) {
  const members = useQuery({
    queryKey: ['blackMoney', 'members', battle.battle_ended_at, battle.team_index],
    queryFn: () => fetchBattleMembers(battle),
    staleTime: STALE_TIME,
  });
  const absent = noShows(members.data ?? []);

  return (
    <div className="bm-detail">
      <div className="stats">
        <StatTile
          label="Entered"
          value={num(battle.user_num)}
          note={`of ${num(battle.max_user_num)} starter places`}
        />
        <StatTile
          label="On the list"
          value={
            battle.signup_read_at === null
              ? '—'
              : `${num(battle.starters)} + ${num(battle.substitutes)}`
          }
          note={
            battle.signup_read_at === null
              ? 'no signup reading before this battle'
              : 'starters + substitutes'
          }
        />
        <StatTile
          label="Did not play"
          value={battle.report_seen ? num(absent.length) : '—'}
          note={
            battle.report_seen
              ? 'listed, but not in the battle report'
              : 'no battle report captured'
          }
        />
      </div>

      {members.isPending && <p className="empty">Loading…</p>}
      {members.error && (
        <p className="error">Could not load the members: {members.error.message}</p>
      )}
      {members.data && <BattleMembersTable members={members.data} />}
    </div>
  );
}
