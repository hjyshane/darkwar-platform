import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StatTile } from '../../components/StatTile';
import { TERMS } from '../../lib/terms';
import { BattleMembersTable } from './BattleMembersTable';
import {
  type Battle,
  battleKey,
  fetchBattleMembers,
  fetchBattles,
  groupEvents,
  noShows,
  outcome,
  serverClock,
  teamLabel,
} from './data';

const numberFormat = new Intl.NumberFormat('ko-KR');

function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : numberFormat.format(value);
}

/** Results arrive once per event, a fortnight apart, so the app's 60s default
 * would only re-ask a question whose answer has not moved. Realtime
 * invalidation still applies when a capture lands. */
const STALE_TIME = 10 * 60_000;

function resultLabel(battle: Battle): string {
  const o = outcome(battle);
  return o === 'win' ? 'Won' : o === 'loss' ? 'Lost' : '—';
}

function opponent(battle: Battle): string {
  if (battle.enemy_name === null) return 'unknown opponent';
  return battle.enemy_abbr ? `[${battle.enemy_abbr}] ${battle.enemy_name}` : battle.enemy_name;
}

export function BlackMoneyPage() {
  const battles = useQuery({
    queryKey: ['blackMoney', 'battles'],
    queryFn: fetchBattles,
    staleTime: STALE_TIME,
  });
  const [chosenKey, setChosenKey] = useState<string | null>(null);

  const events = groupEvents(battles.data ?? []);
  const chosen =
    (battles.data ?? []).find((b) => battleKey(b) === chosenKey) ?? events[0]?.teams[0] ?? null;

  const members = useQuery({
    queryKey: ['blackMoney', 'members', chosen?.battle_ended_at, chosen?.team_index],
    queryFn: () => fetchBattleMembers(chosen as Battle),
    staleTime: STALE_TIME,
    enabled: chosen !== null,
  });

  const absent = noShows(members.data ?? []);

  return (
    <section aria-labelledby="black-money-heading">
      <h2 id="black-money-heading">{TERMS.blackMoney}</h2>

      {battles.isPending && <p className="empty">Loading…</p>}
      {battles.error && (
        <p className="error">Could not load the battles: {battles.error.message}</p>
      )}
      {battles.data && events.length === 0 && (
        <p className="empty">No Black Money battle has been captured yet.</p>
      )}

      {events.length > 0 && (
        // The same scroll container ArrangedTable uses, so a narrow screen
        // scrolls the table rather than the page.
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Team</th>
                <th scope="col">Result</th>
                <th scope="col" className="numeric">
                  Score
                </th>
                <th scope="col" className="numeric">
                  Entered
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) =>
                event.teams.map((battle, index) => (
                  <tr
                    key={battleKey(battle)}
                    aria-current={chosen !== null && battleKey(battle) === battleKey(chosen)}
                  >
                    {index === 0 && <th rowSpan={event.teams.length}>{event.day}</th>}
                    <td className="label">
                      <button type="button" onClick={() => setChosenKey(battleKey(battle))}>
                        {teamLabel(battle.team_index)}
                      </button>{' '}
                      <span className="muted">{serverClock(battle.battle_ended_at)}</span>
                    </td>
                    <td className="label">
                      {resultLabel(battle)} vs {opponent(battle)}
                    </td>
                    <td className="numeric">
                      {num(battle.score)} – {num(battle.enemy_score)}
                    </td>
                    <td className="numeric">
                      {num(battle.user_num)} / {num(battle.max_user_num)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}

      {chosen !== null && (
        <>
          <h3>
            {teamLabel(chosen.team_index)} · {serverClock(chosen.battle_ended_at)}{' '}
            {zonedDayOf(events, chosen)}
          </h3>
          <div className="stats">
            <StatTile hero label="Result" value={resultLabel(chosen)} note={opponent(chosen)} />
            <StatTile
              label="Team score"
              value={`${num(chosen.score)} – ${num(chosen.enemy_score)}`}
              note="battle points, not the sum of player scores"
            />
            <StatTile
              label="Entered"
              value={num(chosen.user_num)}
              note={`of ${num(chosen.max_user_num)} starter places`}
            />
            <StatTile
              label="On the list"
              value={
                chosen.signup_read_at === null
                  ? '—'
                  : `${num(chosen.starters)} + ${num(chosen.substitutes)}`
              }
              note={
                chosen.signup_read_at === null
                  ? 'no signup reading before this battle'
                  : 'starters + substitutes'
              }
            />
            <StatTile
              label="Did not play"
              value={chosen.report_seen ? num(absent.length) : '—'}
              note={
                chosen.report_seen
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

          <p className="note">
            The list is the last signup reading taken before the battle ended. Scores come from the
            battle report mail, which the game sends only to players of that battle — so a team none
            of our accounts played on has no report, and who played is unknown rather than nobody.
            The team score is the battle&apos;s own points and is not the sum of the players&apos;
            scores.
          </p>
        </>
      )}
    </section>
  );
}

function zonedDayOf(events: ReturnType<typeof groupEvents>, battle: Battle): string {
  const event = events.find((e) => e.teams.some((t) => battleKey(t) === battleKey(battle)));
  return event ? `· ${event.day}` : '';
}
