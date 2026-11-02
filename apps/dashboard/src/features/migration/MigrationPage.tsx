import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';
import { useSession } from '../../lib/useSession';
import { MigrationAllianceStats } from './MigrationAllianceStats';
import { MigrationAlliances } from './MigrationAlliances';
import { MigrationAnalytics } from './MigrationAnalytics';
import { MigrationCandidates } from './MigrationCandidates';
import { MigrationEventForm } from './MigrationEventForm';
import { MigrationMovers } from './MigrationMovers';
import { MigrationQuotas } from './MigrationQuotas';
import { MigrationServerStats } from './MigrationServerStats';
import { MigrationServerTop } from './MigrationServerTop';
import { MigrationServers } from './MigrationServers';
import { MigrationTiers } from './MigrationTiers';
import { MigrationTopBoard } from './MigrationTopBoard';
import { type MigrationEvent, fetchMigrationEvents } from './data';

type View =
  | 'analytics'
  | 'candidates'
  | 'movers'
  | 'tiers'
  | 'servers'
  | 'top'
  | 'alliances'
  | 'quotas';

const VIEWS: ReadonlyArray<{ view: View; label: string }> = [
  { view: 'analytics', label: 'Analytics' },
  { view: 'candidates', label: 'Candidates' },
  { view: 'movers', label: 'Movers' },
  { view: 'tiers', label: 'Top 226' },
  { view: 'servers', label: 'Servers' },
  { view: 'top', label: 'Top 150' },
  { view: 'alliances', label: 'Alliances' },
  { view: 'quotas', label: 'Seats & rules' },
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
    <section aria-labelledby="migration-heading" className="board-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            MG
          </span>
          <div>
            <h2 id="migration-heading">Server migration</h2>
            <p className="entity-meta">
              <span>Who moved between servers</span>
              {event && <span>{event.name}</span>}
            </p>
          </div>
        </header>
        {event && (
          <div className="entity-foot">
            <Window event={event} />
          </div>
        )}
      </div>

      <div className="panel">
        {events.isPending && <p className="empty loading">Loading…</p>}
        {events.error && <p className="error">{events.error.message}</p>}
        {events.data && list.length === 0 && (
          <>
            <p className="empty">
              No migration has been set up yet.
              {mayManage
                ? ' Add one with its baseline — the instant the before side is read at.'
                : ''}
            </p>
            <h3>Seats &amp; rules</h3>
            <MigrationQuotas />
          </>
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

        <Tabs
          label="Migration views"
          items={VIEWS.map((v) => ({ id: v.view, label: v.label }))}
          value={view}
          onChange={setView}
        />
        {view === 'candidates' &&
          (mayManage ? (
            <MigrationCandidates />
          ) : (
            <p className="empty">Officers and admins only.</p>
          ))}
        {view === 'analytics' && <MigrationAnalytics eventId={event?.event_id ?? null} />}
        {view === 'movers' && <MigrationMovers />}
        {view === 'tiers' && <MigrationTiers />}
        {view === 'top' && <MigrationServerTop />}
        {view === 'servers' && <MigrationServerStats />}
        {view === 'alliances' && <MigrationAllianceStats />}
        {view === 'quotas' && <MigrationQuotas />}
        {/* The boards that compare two readings around a baseline need a migration event;
            they stay available under the new ones once one has been set up. */}
        {event && (view === 'servers' || view === 'top' || view === 'alliances') && (
          <details>
            <summary>
              <h3>Before and after: {event.name}</h3>
            </summary>
            {view === 'servers' && <MigrationServers eventId={event.event_id} />}
            {view === 'top' && <MigrationTopBoard eventId={event.event_id} />}
            {view === 'alliances' && <MigrationAlliances eventId={event.event_id} />}
          </details>
        )}
      </div>
    </section>
  );
}
