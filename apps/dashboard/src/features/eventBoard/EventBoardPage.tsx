// Capital Clash and Server Clash: who took part, what they scored, and how it
// moves (0290). Frankie's page, with the columns each event has.
//
// One row per current member, one column per event on record, a trend line and
// the totals. A cell is the score where there is one, otherwise a mark:
// ✓ took part, ✗ was not there, ? not known. Not known is never an absence:
// Capital Clash's board is only the top 100 and Server Clash is typed by an
// officer, so nobody recording a member says nothing about them.

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { SortableTh } from '../../components/SortableTh';
import { StatTile } from '../../components/StatTile';
import { Sparkline } from '../../components/ui/Sparkline';
import { type SortState, nextSort } from '../../lib/tableControls';
import {
  type BoardSortKey,
  type MemberSeries,
  compactScore,
  fetchEventBoard,
  foldEventBoard,
  sortMembers,
} from './data';

const STALE_TIME = 5 * 60_000;
/** Under this share of the events a member is marked, as on Participation. */
const LOW_SHARE = 0.5;

export interface EventBoardConfig {
  /** `event_board`'s kind. */
  kind: string;
  /** Two letters for the page mark. */
  code: string;
  title: string;
  subtitle: string;
  /** What a missing board means for this event. */
  emptyText: string;
  /** How the verdicts are reached, for the note under the member table. */
  rule: string;
}

function n(value: number): string {
  return value.toLocaleString('ko-KR');
}

function shortDay(day: string): string {
  return day.slice(5);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function ChangeCell({ value }: { value: number | null }) {
  if (value === null) {
    return <td className="num muted">—</td>;
  }
  const up = value >= 0;
  return (
    <td
      className={`num ${up ? 'growth-up' : 'growth-down'}`}
      title="Newest score against the one before it that the member also has."
    >
      {up ? '+' : '−'}
      {compactScore(Math.abs(value))}
    </td>
  );
}

/** A member on one event: the score, else a mark. */
function EventCell({
  mark,
  score,
  damage,
}: {
  mark: boolean | null;
  score: number | null;
  damage: number | null;
}) {
  if (mark === false) {
    return (
      <td className="num growth-down" title="Was not there.">
        ✗
      </td>
    );
  }
  if (score !== null) {
    const detail = damage === null ? n(score) : `${n(score)} · damage ${n(damage)}`;
    return (
      <td className="num" title={detail}>
        {compactScore(score)}
      </td>
    );
  }
  if (mark === true) {
    return (
      <td className="num" title="Took part; no score on record.">
        ✓
      </td>
    );
  }
  return (
    <td className="num muted" title="Not known: nobody recorded this member for the event.">
      ?
    </td>
  );
}

function MemberRow({
  member,
  days,
  hasScore,
  hasDamage,
  showTrend,
}: {
  member: MemberSeries;
  days: readonly string[];
  hasScore: boolean;
  hasDamage: boolean;
  showTrend: boolean;
}) {
  const low = member.held > 0 && member.present / member.held < LOW_SHARE;
  return (
    <tr>
      <th className="label" scope="row">
        {member.name}
      </th>
      <td
        className={`num ${low ? 'growth-down' : ''}`}
        title={`Took part in ${member.present} of ${member.held} events on record; ${member.absent} recorded as not there.`}
      >
        {low && (
          <span aria-label="Under half" className="below-minimum">
            ●
          </span>
        )}
        {member.present}/{member.held}
      </td>
      <td className={`num ${member.absent > 0 ? 'growth-down' : 'muted'}`}>{member.absent}</td>
      {hasScore && (
        <>
          <td className="num" title={n(member.totalScore)}>
            {member.totalScore === 0 && member.bestScore === null
              ? '—'
              : compactScore(member.totalScore)}
          </td>
          <td
            className="num"
            title={member.averageScore === null ? undefined : n(Math.round(member.averageScore))}
          >
            {member.averageScore === null ? '—' : compactScore(Math.round(member.averageScore))}
          </td>
          <td className="num" title={member.bestScore === null ? undefined : n(member.bestScore)}>
            {member.bestScore === null ? '—' : compactScore(member.bestScore)}
          </td>
          {showTrend && (
            <>
              <ChangeCell value={member.change} />
              <td className="spark-cell">
                <Sparkline height={22} values={member.scores} width={96} />
              </td>
            </>
          )}
        </>
      )}
      {hasDamage && (
        <td className="num" title={n(member.totalDamage)}>
          {member.totalDamage === 0 ? '—' : compactScore(member.totalDamage)}
        </td>
      )}
      {days.map((day, index) => (
        <EventCell
          damage={member.damages[index] ?? null}
          key={day}
          mark={member.marks[index] ?? null}
          score={member.scores[index] ?? null}
        />
      ))}
    </tr>
  );
}

export function EventBoardPage({ config }: { config: EventBoardConfig }) {
  const query = useQuery({
    queryKey: ['event-board', config.kind],
    queryFn: () => fetchEventBoard(config.kind),
    staleTime: STALE_TIME,
  });
  const report = useMemo(() => foldEventBoard(query.data ?? []), [query.data]);
  const [sort, setSort] = useState<SortState>({ key: 'present', direction: 'desc' });
  const onSort = (key: string) => setSort(nextSort(sort, key));
  const rows = useMemo(
    () => sortMembers(report.members, sort.key as BoardSortKey, sort.direction === 'desc'),
    [report.members, sort],
  );

  const latest = report.events.at(-1);
  const best = report.events.reduce<(typeof report.events)[number] | null>(
    (top, event) => (top === null || event.totalScore > top.totalScore ? event : top),
    null,
  );
  const neverRecorded = report.members.filter((m) => m.present === 0 && m.absent === 0).length;
  const { hasScore, hasDamage } = report;
  // Latest and the trend line compare events: one event has nothing to compare.
  const showTrend = report.days.length >= 2;
  const headingId = `${config.kind}-heading`;

  return (
    <section aria-labelledby={headingId} className="participation-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            {config.code}
          </span>
          <div>
            <h2 id={headingId}>{config.title}</h2>
            <p className="entity-meta">
              <span>{config.subtitle}</span>
              <span>Server time, UTC−2</span>
            </p>
          </div>
        </header>
        {report.events.length > 0 && (
          <div className="strip">
            <StatTile hero label="Events on record" value={report.events.length} />
            <StatTile
              label="Latest event"
              note={latest === undefined ? undefined : latest.day}
              value={
                latest === undefined
                  ? null
                  : hasScore
                    ? compactScore(latest.totalScore)
                    : `${latest.present} took part`
              }
            />
            <StatTile
              label="Latest turnout"
              note={
                latest === undefined
                  ? undefined
                  : `${latest.present} of ${report.members.length} known to have taken part`
              }
              value={latest?.turnout == null ? null : percent(latest.turnout)}
            />
            <StatTile
              label="Latest not there"
              note={
                latest === undefined ? undefined : `${latest.unknown} more not known either way`
              }
              value={latest === undefined ? null : latest.absent}
            />
            {hasScore && (
              <StatTile
                label="Best event"
                note={best === null ? undefined : best.day}
                value={best === null ? null : compactScore(best.totalScore)}
              />
            )}
            <StatTile
              label="Never recorded"
              note="members with no verdict on any event"
              value={neverRecorded}
            />
          </div>
        )}
      </div>

      {query.isPending && <p className="empty loading">Loading…</p>}
      {query.error && (
        <p className="error">
          Could not load {config.title}: {query.error.message}
        </p>
      )}
      {query.data && report.events.length === 0 && <p className="empty">{config.emptyText}</p>}

      {report.events.length > 0 && (
        <div className="panel">
          <h3>By event</h3>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th className="label" scope="col">
                    Event
                  </th>
                  <th className="num" scope="col">
                    Took part
                  </th>
                  <th className="num" scope="col">
                    Not there
                  </th>
                  <th className="num" scope="col">
                    Not known
                  </th>
                  <th className="num" scope="col">
                    Turnout
                  </th>
                  {hasScore && (
                    <>
                      <th className="num" scope="col">
                        Total score
                      </th>
                      <th className="num" scope="col">
                        Average
                      </th>
                      <th className="num" scope="col">
                        Against last
                      </th>
                    </>
                  )}
                  {hasDamage && (
                    <th className="num" scope="col">
                      Total damage
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {[...report.events].reverse().map((event, index, all) => {
                  const before = all[index + 1];
                  const delta = before === undefined ? null : event.totalScore - before.totalScore;
                  return (
                    <tr key={event.day}>
                      <th className="label" scope="row">
                        {event.day}
                      </th>
                      <td className="num">
                        {event.present}/{report.members.length}
                      </td>
                      <td className={`num ${event.absent > 0 ? 'growth-down' : 'muted'}`}>
                        {event.absent}
                      </td>
                      <td className="num muted">{event.unknown}</td>
                      <td className="num">
                        {event.turnout === null ? '—' : percent(event.turnout)}
                      </td>
                      {hasScore && (
                        <>
                          <td className="num" title={n(event.totalScore)}>
                            {event.scored === 0 ? '—' : compactScore(event.totalScore)}
                          </td>
                          <td className="num">
                            {event.averageScore === null
                              ? '—'
                              : compactScore(Math.round(event.averageScore))}
                          </td>
                          {event.scored === 0 || before?.scored === 0 ? (
                            <td className="num muted">—</td>
                          ) : (
                            <ChangeCell value={delta} />
                          )}
                        </>
                      )}
                      {hasDamage && (
                        <td className="num" title={n(event.totalDamage)}>
                          {event.totalDamage === 0 ? '—' : compactScore(event.totalDamage)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.events.length > 0 && (
        <div className="panel participation-board">
          <h3>By member</h3>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                    Member
                  </SortableTh>
                  <SortableTh numeric onSort={onSort} sort={sort} sortKey="present">
                    Took part
                  </SortableTh>
                  <th className="num" scope="col">
                    Not there
                  </th>
                  {hasScore && (
                    <>
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="total">
                        Total
                      </SortableTh>
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="average">
                        Average
                      </SortableTh>
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="best">
                        Best
                      </SortableTh>
                      {showTrend && (
                        <>
                          <SortableTh numeric onSort={onSort} sort={sort} sortKey="change">
                            Latest
                          </SortableTh>
                          <th scope="col">Trend</th>
                        </>
                      )}
                    </>
                  )}
                  {hasDamage && (
                    <SortableTh numeric onSort={onSort} sort={sort} sortKey="damage">
                      Damage
                    </SortableTh>
                  )}
                  {report.days.map((day) => (
                    <th className="num" key={day} scope="col">
                      {shortDay(day)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((member) => (
                  <MemberRow
                    days={report.days}
                    hasDamage={hasDamage}
                    hasScore={hasScore}
                    key={member.player_id}
                    member={member}
                    showTrend={showTrend}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            {config.rule} <strong>Took part</strong> is the events on record the member is known to
            have taken part in; ● marks under half. ✓ took part, ✗ was not there, ? is not known,
            which is never an absence. Trend draws the scores in date order and needs two. Hover a
            figure for the exact number.
          </p>
        </div>
      )}
    </section>
  );
}

export const CAPITAL_CLASH: EventBoardConfig = {
  kind: 'capital_clash',
  code: 'CC',
  title: 'Capital Clash',
  subtitle: 'Score per member per battle · took part from the board, teleports and the map',
  emptyText:
    'No Capital Clash is on record yet. A battle appears once its score board has been opened or an officer has recorded it.',
  rule: 'Took part: on the score board (the top 100 of the server group), teleported into the capital, or had a city inside it while the battle ran. Not there: seen outside it in the battle’s last 15 minutes and on none of those. Older battles are what an officer recorded.',
};

export const SERVER_CLASH: EventBoardConfig = {
  kind: 'server_clash',
  code: 'SC',
  title: 'Server Clash',
  subtitle: 'Score and damage per member per battle · recorded by officers',
  emptyText:
    'No Server Clash is on record yet. Officers record who took part, with an optional score and damage, on Participation.',
  rule: 'Nothing reads this event from the game yet, so every cell is what an officer recorded on Participation. Damage is the figure from the battle log, shown only when one has been typed.',
};
