import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';
import { useSession } from '../../lib/useSession';
import { MigrationAlliances } from './MigrationAlliances';
import { MigrationEventForm } from './MigrationEventForm';
import { MigrationServers } from './MigrationServers';
import { MigrationTopBoard } from './MigrationTopBoard';
import { type MigrationEvent, fetchMigrationEvents } from './data';

type View = 'servers' | 'top' | 'alliances';

const VIEWS: ReadonlyArray<{ view: View; label: string }> = [
  { view: 'servers', label: 'Servers' },
  { view: 'top', label: 'Top 150' },
  { view: 'alliances', label: 'Alliances' },
];

function serverTime(iso: string): string {
  return `${zonedDayKey(iso, SERVER_ZONE)} ${zonedTime(iso, SERVER_ZONE)}`;
}

function Window({ event }: { event: MigrationEvent }) {
  return (
    <p className="subtle">
      Before: newest reading up to {serverTime(event.baseline_at)} server time.{' '}
      {event.settled_at === null
        ? 'After: live — anything captured since.'
        : `After: newest reading since ${serverTime(event.settled_at)}.`}
    </p>
  );
}

export function MigrationPage() {
  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const mayManage = isAllowed(permissions?.grants, session?.role, 'migration.manage');

  const events = useQuery({ queryKey: ['migration', 'events'], queryFn: fetchMigrationEvents });
  const [chosen, setChosen] = useState<string | null>(null);
  const [view, setView] = useState<View>('servers');
  const [editing, setEditing] = useState<'new' | 'current' | null>(null);

  const list = events.data ?? [];
  const event = list.find((e) => e.event_id === chosen) ?? list[0] ?? null;

  return (
    <section aria-labelledby="migration-heading">
      <h2 id="migration-heading">Server migration</h2>

      {events.isPending && <p className="empty">Loading…</p>}
      {events.error && <p className="error">{events.error.message}</p>}
      {events.data && list.length === 0 && (
        <p className="empty">
          No migration has been set up yet.
          {mayManage ? ' Add one with its baseline — the instant the before side is read at.' : ''}
        </p>
      )}

      <div className="migration-bar">
        {list.length > 1 && (
          <label>
            Migration{' '}
            <Select value={event?.event_id ?? ''} onChange={setChosen}>
              {list.map((e) => (
                <option key={e.event_id} value={e.event_id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        {mayManage && (
          <>
            <button type="button" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
              Add migration
            </button>
            {event && (
              <button
                type="button"
                onClick={() => setEditing(editing === 'current' ? null : 'current')}
              >
                Edit times
              </button>
            )}
          </>
        )}
      </div>

      {editing !== null && (
        <MigrationEventForm
          key={editing === 'new' ? 'new' : event?.event_id}
          event={editing === 'new' ? null : event}
          onSaved={(eventId) => {
            setChosen(eventId);
            setEditing(null);
          }}
        />
      )}

      {event && (
        <>
          <h3>{event.name}</h3>
          <Window event={event} />
          <Tabs
            label="Migration views"
            items={VIEWS.map((v) => ({ id: v.view, label: v.label }))}
            value={view}
            onChange={setView}
          />
          {view === 'servers' && <MigrationServers eventId={event.event_id} />}
          {view === 'top' && <MigrationTopBoard eventId={event.event_id} />}
          {view === 'alliances' && <MigrationAlliances eventId={event.event_id} />}
        </>
      )}
    </section>
  );
}
