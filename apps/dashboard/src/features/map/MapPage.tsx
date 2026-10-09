import { useState } from 'react';
import { Tabs } from '../../components/ui/Tabs';
import { TERMS } from '../../lib/terms';
import { AtlasPage } from './AtlasPage';
import { HuntPanel } from './HuntPanel';
import { useScannedServers } from './mapLocations';

type Mode = 'atlas' | 'hunt';

/** The map, one server at a time: where every swept base is, coloured by
 * alliance, and the trucks and plunder missions worth a march.
 *
 * The server list is what has been SWEPT, not what exists — a server nobody has
 * visited has no answer and should not offer an empty map that looks like
 * "nobody is there".
 */
export function MapPage({ serverId }: { serverId: number | null }) {
  const { data: servers, isPending, error } = useScannedServers();
  const [chosen, setChosen] = useState<number | null>(serverId);
  const [mode, setMode] = useState<Mode>('atlas');

  // The address wins on first paint; after that the tabs do. Falling back to
  // the most recently swept server means the tab opens on the ground somebody
  // was actually just looking at.
  const active = chosen ?? serverId ?? servers?.[0]?.serverId ?? null;

  if (isPending) {
    return <p className="empty loading">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the map: {(error as Error).message}</p>;
  }
  if (!servers || servers.length === 0 || active === null) {
    return (
      <section aria-labelledby="map-heading">
        <h2 id="map-heading">{TERMS.map}</h2>
        <p className="empty">
          No server has been swept yet. A position exists only where the collector has been pointed,
          so a server has to be visited before anyone on it has one.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="map-heading" className="map-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            MP
          </span>
          <div>
            <h2 id="map-heading">{TERMS.map}</h2>
            <p className="entity-meta">
              <span>One server at a time</span>
              <span>Bases are where a sweep last saw them</span>
            </p>
          </div>
        </header>
      </div>

      <Tabs
        label="Scanned server"
        items={servers.map((server) => ({ id: server.serverId, label: server.serverId }))}
        value={active}
        onChange={setChosen}
      />

      <Tabs
        label="What to show"
        items={[
          { id: 'atlas' as const, label: 'Alliances' },
          { id: 'hunt' as const, label: 'Trucks & plunder' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'hunt' ? (
        <HuntPanel serverId={active} />
      ) : (
        <AtlasPage key={active} serverId={active} />
      )}
    </section>
  );
}
