// Frankie (Bio-Mutant): who hit the boss, for how much, and how it moves.
//
// One row per current member, one column per event with damage on record, a
// trend line and the totals. The events come from the game's own damage board
// where somebody opened it, and from an officer's typed damage otherwise; the
// boards are only captured when somebody looks, so an event can be missing
// from the columns altogether. A dash in an event column is a member with no
// damage on that event -- for Frankie that is an absence (0277).

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { SortableTh } from '../../components/SortableTh';
import { StatTile } from '../../components/StatTile';
import { Sparkline } from '../../components/ui/Sparkline';
import { type SortState, nextSort } from '../../lib/tableControls';
import {
  type FrankieSortKey,
  type MemberSeries,
  compactDamage,
  fetchBossDamage,
  foldBossDamage,
  sortMembers,
} from './data';

const STALE_TIME = 5 * 60_000;
/** Under this share of the events a member is marked, as on Participation. */
const LOW_SHARE = 0.5;

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
      title="Newest event against the event before it that the member also hit."
    >
      {up ? '+' : '−'}
      {compactDamage(Math.abs(value))}
    </td>
  );
}

function MemberRow({ member, days }: { member: MemberSeries; days: readonly string[] }) {
  const low = member.held > 0 && member.attended / member.held < LOW_SHARE;
  return (
    <tr>
      <th className="label" scope="row">
        {member.name}
      </th>
      <td
        className={`num ${low ? 'growth-down' : ''}`}
        title={`Hit the boss on ${member.attended} of ${member.held} events on record.`}
      >
        {low && (
          <span aria-label="Under half" className="below-minimum">
            ●
          </span>
        )}
        {member.attended}/{member.held}
      </td>
      <td className="num" title={n(member.total)}>
        {compactDamage(member.total)}
      </td>
      <td
        className="num"
        title={member.average === null ? undefined : n(Math.round(member.average))}
      >
        {member.average === null ? '—' : compactDamage(Math.round(member.average))}
      </td>
      <td className="num" title={member.best === null ? undefined : n(member.best)}>
        {member.best === null ? '—' : compactDamage(member.best)}
      </td>
      <ChangeCell value={member.change} />
      <td className="spark-cell">
        <Sparkline height={22} values={member.damages} width={96} />
      </td>
      {days.map((day, index) => {
        const damage = member.damages[index] ?? null;
        return damage === null ? (
          <td className="num muted" key={day} title="No damage on this event.">
            —
          </td>
        ) : (
          <td className="num" key={day} title={n(damage)}>
            {compactDamage(damage)}
          </td>
        );
      })}
    </tr>
  );
}

export function FrankiePage() {
  const query = useQuery({
    queryKey: ['frankie-damage'],
    queryFn: fetchBossDamage,
    staleTime: STALE_TIME,
  });
  const report = useMemo(() => foldBossDamage(query.data ?? []), [query.data]);
  const [sort, setSort] = useState<SortState>({ key: 'total', direction: 'desc' });
  const onSort = (key: string) => setSort(nextSort(sort, key));
  const rows = useMemo(
    () => sortMembers(report.members, sort.key as FrankieSortKey, sort.direction === 'desc'),
    [report.members, sort],
  );

  const latest = report.events.at(-1);
  const previous = report.events.at(-2);
  const best = report.events.reduce<(typeof report.events)[number] | null>(
    (top, event) => (top === null || event.total > top.total ? event : top),
    null,
  );
  const neverHit = report.members.filter((m) => m.attended === 0).length;

  return (
    <section aria-labelledby="frankie-heading" className="participation-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            FK
          </span>
          <div>
            <h2 id="frankie-heading">Frankie</h2>
            <p className="entity-meta">
              <span>Bio-Mutant · damage per member per event</span>
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
              value={latest === undefined ? null : compactDamage(latest.total)}
            />
            <StatTile
              label="Latest turnout"
              note={
                latest === undefined
                  ? undefined
                  : `${latest.participants} of ${report.members.length} members`
              }
              value={latest?.turnout == null ? null : percent(latest.turnout)}
            />
            <StatTile
              label="Best event"
              note={best === null ? undefined : best.day}
              value={best === null ? null : compactDamage(best.total)}
            />
            <StatTile
              label="Never hit"
              note="members with no damage on any event"
              value={neverHit}
            />
          </div>
        )}
      </div>

      {query.isPending && <p className="empty loading">Loading…</p>}
      {query.error && <p className="error">Could not load Frankie: {query.error.message}</p>}
      {query.data && report.events.length === 0 && (
        <p className="empty">
          No Frankie damage is on record yet. The board is captured when somebody opens the alliance
          damage ranking after an event.
        </p>
      )}

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
                    Hit the boss
                  </th>
                  <th className="num" scope="col">
                    Turnout
                  </th>
                  <th className="num" scope="col">
                    Total damage
                  </th>
                  <th className="num" scope="col">
                    Average
                  </th>
                  <th className="num" scope="col">
                    Against last
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...report.events].reverse().map((event, index, all) => {
                  const before = all[index + 1];
                  const delta = before === undefined ? null : event.total - before.total;
                  return (
                    <tr key={event.day}>
                      <th className="label" scope="row">
                        {event.day}
                      </th>
                      <td className="num">
                        {event.participants}/{report.members.length}
                      </td>
                      <td className="num">
                        {event.turnout === null ? '—' : percent(event.turnout)}
                      </td>
                      <td className="num" title={n(event.total)}>
                        {compactDamage(event.total)}
                      </td>
                      <td className="num">
                        {event.average === null ? '—' : compactDamage(Math.round(event.average))}
                      </td>
                      <ChangeCell value={delta} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {previous !== undefined && latest !== undefined && (
            <p className="note">
              Only events whose damage board was opened (or typed in by an officer) appear. A
              missing date is an event nobody captured, not a day without Frankie.
            </p>
          )}
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
                  <SortableTh numeric onSort={onSort} sort={sort} sortKey="attended">
                    Hit
                  </SortableTh>
                  <SortableTh numeric onSort={onSort} sort={sort} sortKey="total">
                    Total
                  </SortableTh>
                  <SortableTh numeric onSort={onSort} sort={sort} sortKey="average">
                    Average
                  </SortableTh>
                  <SortableTh numeric onSort={onSort} sort={sort} sortKey="best">
                    Best
                  </SortableTh>
                  <SortableTh numeric onSort={onSort} sort={sort} sortKey="change">
                    Latest
                  </SortableTh>
                  <th scope="col">Trend</th>
                  {report.days.map((day) => (
                    <th className="num" key={day} scope="col">
                      {shortDay(day)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((member) => (
                  <MemberRow days={report.days} key={member.player_id} member={member} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            Damage is what the member did to the boss in the event. <strong>Hit</strong> is the
            events on record they have damage on; ● marks under half. A dash is no damage on that
            event. Trend draws the events in date order and needs two. Hover a figure for the exact
            number.
          </p>
        </div>
      )}
    </section>
  );
}
