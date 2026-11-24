// Frankie (Bio-Mutant): who hit the boss, for how much, and how it moves.
//
// One row per member on record, one column per event with damage on record, a
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
import { rich, useT } from '../../lib/i18n';
import { type SortState, nextSort } from '../../lib/tableControls';
import { useLowShare } from '../participation/data';
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
  const t = useT();
  if (value === null) {
    return <td className="num muted">—</td>;
  }
  const up = value >= 0;
  return (
    <td
      className={`num ${up ? 'growth-up' : 'growth-down'}`}
      title={t('Newest event against the event before it that the member also hit.')}
    >
      {up ? '+' : '−'}
      {compactDamage(Math.abs(value))}
    </td>
  );
}

function MemberRow({ member, days }: { member: MemberSeries; days: readonly string[] }) {
  const t = useT();
  const lowShare = useLowShare();
  const low = member.held > 0 && member.attended / member.held < lowShare;
  return (
    <tr>
      <th className="label" scope="row">
        {member.name}
      </th>
      <td
        className={`num ${low ? 'growth-down' : ''}`}
        title={t('Hit the boss on {attended} of {held} events on record.', {
          attended: member.attended,
          held: member.held,
        })}
      >
        {low && (
          <span aria-label={t('Under half')} className="below-minimum">
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
          <td className="num muted" key={day} title={t('No damage on this event.')}>
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
  const t = useT();
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
              <span>{t('Bio-Mutant · damage per member per event')}</span>
              <span>{t('Server time, UTC−2')}</span>
            </p>
          </div>
        </header>
        {report.events.length > 0 && (
          <div className="strip">
            <StatTile hero label={t('Events on record')} value={report.events.length} />
            <StatTile
              label={t('Latest event')}
              note={latest === undefined ? undefined : latest.day}
              value={latest === undefined ? null : compactDamage(latest.total)}
            />
            <StatTile
              label={t('Latest turnout')}
              note={
                latest === undefined
                  ? undefined
                  : t('{count} of {total} members', {
                      count: latest.participants,
                      total: latest.roster,
                    })
              }
              value={latest?.turnout == null ? null : percent(latest.turnout)}
            />
            <StatTile
              label={t('Best event')}
              note={best === null ? undefined : best.day}
              value={best === null ? null : compactDamage(best.total)}
            />
            <StatTile
              label={t('Never hit')}
              note={t('members with no damage on any event')}
              value={neverHit}
            />
          </div>
        )}
      </div>

      {query.isPending && <p className="empty loading">{t('Loading…')}</p>}
      {query.error && (
        <p className="error">
          {t('Could not load Frankie: {error}', { error: query.error.message })}
        </p>
      )}
      {query.data && report.events.length === 0 && (
        <p className="empty">
          {t(
            'No Frankie damage is on record yet. The board is captured when somebody opens the alliance damage ranking after an event.',
          )}
        </p>
      )}

      {report.events.length > 0 && (
        <div className="panel">
          <h3>{t('By event')}</h3>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th className="label" scope="col">
                    {t('Event')}
                  </th>
                  <th className="num" scope="col">
                    {t('Hit the boss')}
                  </th>
                  <th className="num" scope="col">
                    {t('Turnout')}
                  </th>
                  <th className="num" scope="col">
                    {t('Total damage')}
                  </th>
                  <th className="num" scope="col">
                    {t('Average')}
                  </th>
                  <th className="num" scope="col">
                    {t('Against last')}
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
                        {event.participants}/{event.roster}
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
              {t(
                'Only events whose damage board was opened (or typed in by an officer) appear. A missing date is an event nobody captured, not a day without Frankie.',
              )}
            </p>
          )}
        </div>
      )}

      {report.events.length > 0 && (
        <div className="panel participation-board">
          <h3>{t('By member')}</h3>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                    {t('Member')}
                  </SortableTh>
                  <SortableTh numeric onSort={onSort} sort={sort} sortKey="attended">
                    {t('Hit')}
                  </SortableTh>
                  <SortableTh numeric onSort={onSort} sort={sort} sortKey="total">
                    {t('Total')}
                  </SortableTh>
                  <SortableTh numeric onSort={onSort} sort={sort} sortKey="average">
                    {t('Average')}
                  </SortableTh>
                  <SortableTh numeric onSort={onSort} sort={sort} sortKey="best">
                    {t('Best')}
                  </SortableTh>
                  <SortableTh numeric onSort={onSort} sort={sort} sortKey="change">
                    {t('Latest')}
                  </SortableTh>
                  <th scope="col">{t('Trend')}</th>
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
            {rich(
              t(
                'Damage is what the member did to the boss in the event. {hit} is the events they were in the alliance for that they have damage on; ● marks under half. A dash is no damage on that event. Trend draws the events in date order and needs two. Hover a figure for the exact number.',
              ),
              { hit: <strong>{t('Hit')}</strong> },
            )}
          </p>
        </div>
      )}
    </section>
  );
}
