import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StatTile } from '../../components/StatTile';
import { BattleMembersTable } from './BattleMembersTable';
import {
  type Battle,
  fetchBattleMembers,
  fetchBattleOpponents,
  noShows,
  opponentAsMember,
} from './data';

const numberFormat = new Intl.NumberFormat('ko-KR');

export function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : numberFormat.format(value);
}

/** Results arrive once per event, a fortnight apart, so the app's 60s default
 * would only re-ask a question whose answer has not moved. Realtime
 * invalidation still applies when a capture lands. */
export const STALE_TIME = 10 * 60_000;

function opponentLabel(battle: Battle): string {
  return battle.enemy_abbr ? `[${battle.enemy_abbr}]` : 'opponent';
}

/** What opens under a battle's row: the figures, then who was there.
 *
 * Its own component so the member query is only made for the one battle that
 * is open, and so closing the row drops it from the page rather than leaving
 * a table nobody is looking at mounted below the fold. */
export function BattleDetail({ battle }: { battle: Battle }) {
  const [showOpponent, setShowOpponent] = useState(false);
  const members = useQuery({
    queryKey: ['blackMoney', 'members', battle.battle_ended_at, battle.team_index],
    queryFn: () => fetchBattleMembers(battle),
    staleTime: STALE_TIME,
  });
  // Only asked for once somebody wants it: most readers open a battle to see
  // our own people.
  const opponents = useQuery({
    queryKey: ['blackMoney', 'opponents', battle.battle_ended_at, battle.team_index],
    queryFn: () => fetchBattleOpponents(battle),
    staleTime: STALE_TIME,
    enabled: showOpponent,
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
            battle.report_seen ? 'listed, but not in the battle report' : 'report not captured yet'
          }
        />
      </div>

      {members.isPending && <p className="empty">Loading…</p>}
      {members.error && (
        <p className="error">Could not load the members: {members.error.message}</p>
      )}
      {members.data && <BattleMembersTable members={members.data} />}

      {battle.report_seen && (
        <p>
          <button
            type="button"
            className="chip"
            aria-pressed={showOpponent}
            onClick={() => setShowOpponent((on) => !on)}
          >
            {showOpponent ? 'Hide' : 'Show'} {opponentLabel(battle)} players
          </button>
        </p>
      )}
      {showOpponent && (
        <>
          <h4>{opponentLabel(battle)} players</h4>
          {opponents.isPending && <p className="empty">Loading…</p>}
          {opponents.error && (
            <p className="error">Could not load the opponent: {opponents.error.message}</p>
          )}
          {opponents.data && (
            <BattleMembersTable members={opponents.data.map(opponentAsMember)} side="theirs" />
          )}
        </>
      )}
    </div>
  );
}
