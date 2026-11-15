import { useEffect, useState } from 'react';
import { Select } from '../../components/ui/Select';
import { isAllowed, usePermissions } from '../../lib/permissions';
import {
  SERVER_ZONE,
  readZone,
  storeZone,
  zoneLabel,
  zoneOptions,
  zonedDayKey,
  zonedTime,
} from '../../lib/timezone';
import { useActiveAlliance } from '../../lib/useMyAlliances';
import { useSession } from '../../lib/useSession';
import { AlarmBoardsPanel } from './AlarmBoardsPanel';
import { AlarmEntryForm } from './AlarmEntryForm';
import { AlarmEntryPanel } from './AlarmEntryPanel';
import {
  type AlarmBoard,
  type AlarmEntry,
  type Delivery,
  chipFor,
  chipText,
  entrySource,
  stepKey,
} from './alarmLogic';
import {
  type UnplacedPick,
  useAlarmBoards,
  useAlarmDeliveries,
  useAlarmEntries,
  useUnplacedPicks,
} from './alarms';
import './alarms.css';

/** The Alarms tab (spec 2026-11-14 §8): the next 14 days of the alliance's
 * events, and what each of their Discord alarms has done or will do.
 *
 * ONE PAGE FOR EVERYBODY. A member reads the list and the chips; an officer
 * (`schedule.manage`) also gets each entry's controls, the add form and the
 * boards. RLS would let a member's write through as "0 rows updated" with no
 * error, so hiding the controls is the only feedback a member could get.
 *
 * Times are drawn in the reader's zone (the same per-browser choice the old
 * schedule screen kept) with the server's clock beside it, because the game
 * shows server time and members sit in four zones.
 */

const SOURCE_LABEL = { game: 'game', pick: 'alliance pick', manual: 'manual' } as const;

/** The chips' clock. A step turns from pending to due on its minute, so the
 *  page re-reads the time once a minute rather than only when it re-renders. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** `Sat, Nov 21 20:00` in the zone. */
function dayTime(iso: string, zone: string): string {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${day.format(new Date(iso))} ${zonedTime(iso, zone)}`;
}

/** Start, and the end when there is one: only its time when it is the same day. */
function span(entry: AlarmEntry, zone: string): string {
  const start = dayTime(entry.startsAt, zone);
  if (entry.endsAt === null) {
    return start;
  }
  const sameDay = zonedDayKey(entry.startsAt, zone) === zonedDayKey(entry.endsAt, zone);
  return `${start} – ${sameDay ? zonedTime(entry.endsAt, zone) : dayTime(entry.endsAt, zone)}`;
}

function When({ entry, zone }: { entry: AlarmEntry; zone: string }) {
  return (
    <span className="alarm-when">
      <time dateTime={entry.startsAt}>{span(entry, zone)}</time>{' '}
      <span className="subtle">
        {zone === SERVER_ZONE ? '(server time)' : `(server ${span(entry, SERVER_ZONE)})`}
      </span>
    </span>
  );
}

interface RowProps {
  entry: AlarmEntry;
  board: AlarmBoard | undefined;
  /** Null until the delivery state is read. */
  deliveries: readonly Delivery[] | null;
  zone: string;
  now: Date;
  mayManage: boolean;
  boards: readonly AlarmBoard[];
  open: boolean;
  onToggle: () => void;
}

function AlarmRow({
  entry,
  board,
  deliveries,
  zone,
  now,
  mayManage,
  boards,
  open,
  onToggle,
}: RowProps) {
  return (
    <li className="alarm-entry">
      <div className="alarm-head">
        <span className="alarm-title">{entry.title}</span>
        {/* The game names most entries after their board; say it once. */}
        {board?.label !== entry.title && <span>{board?.label ?? 'No board'}</span>}
        <span className="alarm-source">{SOURCE_LABEL[entrySource(entry)]}</span>
        <When entry={entry} zone={zone} />
      </div>
      {/* The panel draws the same chips as switches, so they are not drawn twice. */}
      {!open &&
        (entry.steps.length === 0 ? (
          <p className="subtle">No alarms on this entry.</p>
        ) : (
          <ul aria-label={`Alarms for ${entry.title}`} className="alarm-chips">
            {entry.steps.map((step) => {
              const chip = chipFor(step, entry, deliveries, now, zone);
              return (
                <li className={`alarm-chip alarm-chip-${chip.state}`} key={stepKey(step)}>
                  {chipText(chip)}
                </li>
              );
            })}
          </ul>
        ))}
      {mayManage && (
        <div>
          <button
            aria-expanded={open}
            aria-label={`${open ? 'Close' : 'Alarms and message'}: ${entry.title}`}
            className="linklike"
            onClick={onToggle}
            type="button"
          >
            {open ? 'Close' : 'Alarms and message'}
          </button>
        </div>
      )}
      {mayManage && open && (
        <AlarmEntryPanel
          board={board}
          boards={boards}
          deliveries={deliveries}
          entry={entry}
          now={now}
          zone={zone}
        />
      )}
    </li>
  );
}

function UnplacedPicks({
  picks,
  zone,
  mayManage,
}: { picks: readonly UnplacedPick[]; zone: string; mayManage: boolean }) {
  return (
    <section aria-labelledby="alarm-picks-heading" className="alarm-warn">
      <h3 id="alarm-picks-heading">
        Picks the game reported that could not be tied to an alliance
      </h3>
      <ul className="alarm-picks">
        {picks.map((pick) => (
          <li key={pick.id}>
            {pick.eventKey.replaceAll('_', ' ')}, slot {pick.slot}: {dayTime(pick.startsAt, zone)}
            <span className="subtle">
              {' '}
              (read {dayTime(pick.capturedAt, zone)} on server {pick.serverId})
            </span>
          </li>
        ))}
      </ul>
      <p className="subtle">
        They have no entry here, so they send no alarm.
        {mayManage && ' Add one by hand if it matters.'}
      </p>
    </section>
  );
}

export function AlarmsPage() {
  // Per browser, not per account: the same person wants a different answer on
  // a laptop at home and a phone abroad.
  const [zone, setZone] = useState<string>(readZone);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const mayManage = isAllowed(permissions?.grants, session?.role, 'schedule.manage');
  const { active } = useActiveAlliance();

  const entries = useAlarmEntries();
  const boards = useAlarmBoards();
  // Picks are readable across the group; the ones that matter here were read
  // on this alliance's server, and the query asks for those alone.
  const picks = useUnplacedPicks(active?.server_id ?? null);
  const list = entries.data ?? [];
  const deliveries = useAlarmDeliveries(list.map((entry) => entry.id));
  const sentByEntry = deliveries.data;
  const boardList = boards.data ?? [];
  const byCategory = new Map(boardList.map((board) => [board.category, board]));
  const unplaced = picks.data ?? [];
  const now = useMinuteClock();

  return (
    <section aria-labelledby="alarms-heading" className="board-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            AL
          </span>
          <div>
            <h2 id="alarms-heading">Alarms</h2>
            <p className="entity-meta">
              <span>Discord alarms for the next 14 days</span>
              <span>{zoneLabel(zone)}</span>
            </p>
          </div>
        </header>
      </div>

      <div className="panel">
        <div className="toolbar alarm-toolbar">
          <label className="alarm-zone">
            <span className="visually-hidden">Select your time zone</span>
            <Select
              onChange={(chosen) => {
                setZone(chosen);
                storeZone(chosen);
              }}
              value={zone}
            >
              {zoneOptions(zone).map((name) => (
                <option key={name} value={name}>
                  {zoneLabel(name)}
                </option>
              ))}
            </Select>
          </label>
          {mayManage && (
            <button aria-expanded={adding} onClick={() => setAdding(!adding)} type="button">
              Add an entry
            </button>
          )}
        </div>

        {mayManage && adding && (
          <AlarmEntryForm boards={boardList} onDone={() => setAdding(false)} zone={zone} />
        )}

        {unplaced.length > 0 && (
          <UnplacedPicks mayManage={mayManage} picks={unplaced} zone={zone} />
        )}

        {entries.error !== null && <p className="error">The alarms could not be read.</p>}
        {deliveries.error !== null && (
          <p className="error">
            What the alarms have sent could not be read, so an alarm that is due shows "…" or may be
            out of date.
          </p>
        )}
        {entries.isPending && <p className="empty loading">Loading…</p>}
        {!entries.isPending && list.length === 0 && (
          <p className="empty">Nothing on the calendar in the next 14 days.</p>
        )}

        <ol className="alarm-list">
          {list.map((entry) => (
            <AlarmRow
              board={entry.category === null ? undefined : byCategory.get(entry.category)}
              boards={boardList}
              // Undefined while loading or failed: "not known", never "nothing sent".
              deliveries={sentByEntry === undefined ? null : (sentByEntry[entry.id] ?? [])}
              entry={entry}
              key={entry.id}
              mayManage={mayManage}
              now={now}
              onToggle={() => setOpen(open === entry.id ? null : entry.id)}
              open={open === entry.id}
              zone={zone}
            />
          ))}
        </ol>
      </div>

      {mayManage && (
        <AlarmBoardsPanel
          boards={boardList}
          failed={boards.error !== null}
          loading={boards.isPending}
          serverId={active?.server_id ?? null}
          zone={zone}
        />
      )}
    </section>
  );
}
