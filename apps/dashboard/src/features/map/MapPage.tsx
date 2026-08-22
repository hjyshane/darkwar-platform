import { useState } from 'react';
import { formatLastOnline } from '../../lib/freshness';
import { formatCoordinate } from '../../lib/mapProjection';
import { TERMS } from '../../lib/terms';
import { MapCanvas } from './MapCanvas';
import {
  MIN_QUERY,
  type Sighting,
  isStale,
  useHqLevelSearch,
  useScannedServers,
  useSightingSearch,
} from './mapLocations';

/** The map, one server at a time, one player at a time.
 *
 * TWO DELIBERATE NARROWINGS, and both are the feature rather than a
 * limitation. The server list is what has been SWEPT, not what exists — a
 * server nobody has visited has no answer and should not offer an empty map
 * that looks like "nobody is there". And nothing is drawn until a player is
 * named, because a swept server holds thousands of tiles and all of them at
 * once is a screen of dots that answers no question.
 */
export function MapPage({ serverId }: { serverId: number | null }) {
  const { data: servers, isPending, error } = useScannedServers();
  const [chosen, setChosen] = useState<number | null>(serverId);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Sighting | null>(null);
  // Off by default: it is a ruler, not a feature. It stays reachable because
  // the picture will be replaced when the game changes the map, and the
  // alignment has to be checkable then without a rebuild.
  const [calibrate, setCalibrate] = useState(false);
  // A base that was destroyed, or whose shield dropped, is teleported
  // somewhere random, and a sweep only records the ground it passed over — so
  // the sighting we hold is a place the player has left and no newer row
  // exists. HQ level survived the move and the tile carries it, which turns
  // "somewhere on 581" into a list short enough to read.
  const [hqMin, setHqMin] = useState<number | null>(null);
  // Optional upper bound. An industrial tower is 31-35, so "at least" gets
  // you there and "at most" narrows it when a level's worth is too many.
  const [hqMax, setHqMax] = useState<number | null>(null);
  // Clicking a pin picks it out WITHOUT leaving the level view: the whole
  // point of showing a hundred at once is comparing them, and swapping to a
  // single-base screen on every click would undo that.
  const [picked, setPicked] = useState<number | null>(null);

  // The address wins on first paint; after that the tabs do. Falling back to
  // the most recently swept server means the tab opens on the ground somebody
  // was actually just looking at.
  const active = chosen ?? serverId ?? servers?.[0]?.serverId ?? null;
  const results = useSightingSearch(active, query);
  const byLevel = useHqLevelSearch(active, hqMin, hqMax);
  const now = new Date();

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the map: {(error as Error).message}</p>;
  }
  if (!servers || servers.length === 0) {
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
    <section aria-labelledby="map-heading">
      <h2 id="map-heading">{TERMS.map}</h2>

      <div role="tablist" aria-label="Scanned server">
        {servers.map((server) => (
          <button
            aria-selected={server.serverId === active}
            key={server.serverId}
            onClick={() => {
              setChosen(server.serverId);
              // A name found on one server means nothing on another.
              setSelected(null);
              setQuery('');
              setHqMin(null);
              setHqMax(null);
            }}
            role="tab"
            type="button"
          >
            {server.serverId}
          </button>
        ))}
      </div>

      {servers
        .filter((server) => server.serverId === active)
        .map((server) => (
          <p className="subtle" key={server.serverId}>
            Server {server.serverId} — last swept {formatLastOnline('offline', server.sweptAt, now)}
            . Positions are only as recent as that sweep.
          </p>
        ))}

      <label className="map-search">
        <span>Find a player</span>
        <input
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(null);
            setHqMin(null);
            setHqMax(null);
          }}
          placeholder="Name as it appears in game"
          type="search"
          value={query}
        />
      </label>

      <fieldset className="map-range">
        <legend>Or every base by HQ level</legend>
        <label>
          <span>At least</span>
          <input
            max={99}
            min={1}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              setHqMin(Number.isNaN(next) ? null : next);
              setPicked(null);
              setSelected(null);
              setQuery('');
            }}
            placeholder="31"
            type="number"
            value={hqMin ?? ''}
          />
        </label>
        <label>
          <span>At most (optional)</span>
          <input
            max={99}
            min={1}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              setHqMax(Number.isNaN(next) ? null : next);
              setPicked(null);
            }}
            placeholder="35"
            type="number"
            value={hqMax ?? ''}
          />
        </label>
      </fieldset>

      {query.trim().length > 0 && query.trim().length < MIN_QUERY && (
        <p className="subtle">Keep typing — {MIN_QUERY} characters or more.</p>
      )}

      {results.isFetching && <p className="empty">Searching…</p>}
      {results.error && <p className="error">Search failed: {(results.error as Error).message}</p>}
      {results.data && results.data.length === 0 && !results.isFetching && (
        <p className="empty">
          Nobody on server {active} matching that name has been swept. Either they were not in view
          when this ground was read, or the name is spelled differently in game.
        </p>
      )}

      {results.data && results.data.length > 0 && selected === null && (
        <ul className="map-results">
          {results.data.map((sighting) => (
            <li key={sighting.gameUid}>
              <button onClick={() => setSelected(sighting)} type="button">
                <strong>{sighting.name ?? 'unnamed'}</strong>
                <span className="subtle">
                  {formatCoordinate(sighting.at)}
                  {sighting.hqLevel !== null && ` · HQ ${sighting.hqLevel}`} ·{' '}
                  {formatLastOnline('offline', sighting.capturedAt, now)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hqMin !== null && byLevel.isFetching && <p className="empty">Looking…</p>}
      {hqMin !== null && byLevel.error && (
        <p className="error">HQ search failed: {(byLevel.error as Error).message}</p>
      )}
      {hqMin !== null &&
        byLevel.data &&
        selected === null &&
        (byLevel.data.length === 0 ? (
          <p className="empty">
            No base at HQ {hqMin}
            {hqMax !== null ? `-${hqMax}` : ' or above'} has been swept on server {active}.
          </p>
        ) : (
          <>
            <p className="subtle">
              {byLevel.data.length} base{byLevel.data.length === 1 ? '' : 's'} at HQ {hqMin}
              {hqMax !== null ? `-${hqMax}` : ' or above'} on server {active}. Each is where it was
              last SEEN — a base that was destroyed or lost its shield is teleported somewhere
              random, and a sweep only records the ground it passed over.
            </p>
            <MapCanvas
              calibrate={calibrate}
              markers={byLevel.data.map((sighting) => ({
                at: sighting.at,
                label: sighting.name ?? formatCoordinate(sighting.at),
                faded: isStale(sighting, now),
                highlighted: sighting.gameUid === picked,
              }))}
              onSelect={(marker) => {
                // Matched on the coordinate, which is what a pin knows about
                // itself. Two bases cannot share a square.
                const hit = byLevel.data?.find(
                  (s) => s.at.x === marker.at.x && s.at.y === marker.at.y,
                );
                setPicked(hit ? hit.gameUid : null);
              }}
            />
            {/* BOTH WAYS ROUND. Clicking a pin names it; clicking a name
                lights its pin and puts the coordinate beside it. Neither
                leaves this screen, because comparing a level's worth of bases
                is the whole reason for showing them together — dropping into
                a single-base view on every click would undo that. */}
            <ul className="map-results">
              {byLevel.data.map((sighting) => (
                <li key={sighting.gameUid}>
                  <button
                    className={sighting.gameUid === picked ? 'map-result--on' : undefined}
                    onClick={() => setPicked(sighting.gameUid === picked ? null : sighting.gameUid)}
                    type="button"
                  >
                    <strong>{sighting.name ?? 'unnamed'}</strong>
                    <span className="subtle">
                      {formatCoordinate(sighting.at)}
                      {/* The level itself, because a RANGE was asked for: a
                          list of 31-35 that does not say which is which
                          answers half the question. */}
                      {sighting.hqLevel !== null && ` · HQ ${sighting.hqLevel}`} ·{' '}
                      {formatLastOnline('offline', sighting.capturedAt, now)}
                      {sighting.gameUid === picked && ' · shown on the map'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ))}

      {selected !== null && (
        <>
          <p className="map-selected">
            <strong>{selected.name ?? 'unnamed'}</strong> at {formatCoordinate(selected.at)}
            {selected.hqLevel !== null && ` · HQ ${selected.hqLevel}`} ·{' '}
            {formatLastOnline('offline', selected.capturedAt, now)}
            {isStale(selected, now) && ' — older than a day, treat it as where they were'}{' '}
            <button className="linklike" onClick={() => setSelected(null)} type="button">
              back to the list
            </button>
          </p>
          <label className="map-calibrate">
            <input
              checked={calibrate}
              onChange={(event) => setCalibrate(event.target.checked)}
              type="checkbox"
            />
            <span>Show map bounds — the outline should sit on the inside of the border</span>
          </label>
          <MapCanvas
            calibrate={calibrate}
            markers={[
              {
                at: selected.at,
                label: selected.name ?? formatCoordinate(selected.at),
                faded: isStale(selected, now),
              },
            ]}
          />
        </>
      )}
    </section>
  );
}
