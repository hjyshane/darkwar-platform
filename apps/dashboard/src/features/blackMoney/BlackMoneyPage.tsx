import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { TERMS } from '../../lib/terms';
import { BattleDetail, STALE_TIME, num } from './BattleDetail';
import {
  type Battle,
  battleKey,
  fetchBattles,
  groupEvents,
  outcome,
  serverClock,
  teamLabel,
} from './data';

/** The table's column count, for the detail row that spans all of it. */
const COLUMNS = 6;

function ResultBadge({ battle }: { battle: Battle }) {
  const o = outcome(battle);
  if (o === 'unknown') return <span className="muted">—</span>;
  // Glyph AND word, not colour alone: the colour reinforces what is written.
  return o === 'win' ? (
    <span className="badge badge-win">✓ Win</span>
  ) : (
    <span className="badge badge-loss">✗ Loss</span>
  );
}

function opponent(battle: Battle): string {
  if (battle.enemy_name === null) return '—';
  return battle.enemy_abbr ? `[${battle.enemy_abbr}] ${battle.enemy_name}` : battle.enemy_name;
}

/** Ours first and strong, theirs after and quiet — the same order and weight
 * on every row, so the eye learns which side is which once. */
function Score({ battle }: { battle: Battle }) {
  return (
    <span className="bm-score">
      <strong className="bm-score-ours">{num(battle.score)}</strong>
      <span className="bm-score-sep"> : </span>
      <span className="muted">{num(battle.enemy_score)}</span>
    </span>
  );
}

export function BlackMoneyPage() {
  const battles = useQuery({
    queryKey: ['blackMoney', 'battles'],
    queryFn: fetchBattles,
    staleTime: STALE_TIME,
  });
  // One battle open at a time. Opening the detail IN the table, under the row
  // that was clicked, is the point: below the table it read as nothing having
  // happened, because what changed was off the bottom of the screen.
  const [openKey, setOpenKey] = useState<string | null>(null);

  const events = groupEvents(battles.data ?? []);

  return (
    <section aria-labelledby="black-money-heading">
      <h2 id="black-money-heading">{TERMS.blackMoney}</h2>

      {battles.isPending && <p className="empty">Loading…</p>}
      {battles.error && (
        <p className="error">Could not load the battles: {battles.error.message}</p>
      )}
      {battles.data && events.length === 0 && (
        <p className="empty">No Black Gold battle has been captured yet.</p>
      )}

      {events.length > 0 && (
        // The same scroll container ArrangedTable uses, so a narrow screen
        // scrolls the table rather than the page.
        <div className="table-wrap">
          <table className="compact bm-events">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Team</th>
                <th scope="col">Result</th>
                <th scope="col">Opponent</th>
                <th scope="col" className="numeric">
                  Score <span className="muted">(us : them)</span>
                </th>
                <th scope="col" className="numeric">
                  Entered
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) =>
                event.teams.map((battle, index) => {
                  const key = battleKey(battle);
                  const open = key === openKey;
                  return (
                    <Fragment key={key}>
                      <tr className={open ? 'bm-row bm-row-open' : 'bm-row'}>
                        {/* The day on the event's first row only. Not a
                            rowSpan: an open detail row spans the full width,
                            and a spanning date cell would cut into it. */}
                        <th scope="row">{index === 0 ? event.day : ''}</th>
                        <td className="label">
                          <button
                            type="button"
                            className="bm-toggle"
                            aria-expanded={open}
                            onClick={() => setOpenKey(open ? null : key)}
                          >
                            <span aria-hidden="true">{open ? '▾' : '▸'}</span>{' '}
                            {teamLabel(battle.team_index)}
                          </button>{' '}
                          <span className="muted">{serverClock(battle.battle_ended_at)}</span>
                        </td>
                        <td>
                          <ResultBadge battle={battle} />
                        </td>
                        {/* Not `.label`: that class pins a cell to the left edge, and
                            only the team — what identifies the row — should be. */}
                        <td>{opponent(battle)}</td>
                        <td className="numeric">
                          <Score battle={battle} />
                        </td>
                        <td className="numeric">
                          {num(battle.user_num)} / {num(battle.max_user_num)}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bm-detail-row">
                          <td colSpan={COLUMNS}>
                            <BattleDetail battle={battle} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}

      {events.length > 0 && (
        <p className="note">
          Open a team to see who was listed and who played. The list is the last signup reading
          taken before the battle ended. Scores come from the battle report mail, which the game
          sends only to players of that battle — so a team none of our accounts played on has no
          report, and who played is unknown rather than nobody. The team score is the battle&apos;s
          own points and is not the sum of the players&apos; scores.
        </p>
      )}
    </section>
  );
}
