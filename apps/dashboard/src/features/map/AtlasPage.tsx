import { type Coordinate, formatCoordinate } from '@dw/ui';
import { useState } from 'react';
import { Tabs } from '../../components/ui/Tabs';
import { formatAge } from '../../lib/freshness';
import { useActiveAlliance } from '../../lib/useMyAlliances';
import { AtlasMap } from './AtlasMap';
import { AllianceDetail, BaseDetail } from './AtlasPanel';
import { PlunderList, TrucksList } from './HuntLists';
import { HuntPins } from './HuntPins';
import { type MapMode, MapModeMenu } from './MapModes';
import { PannableMap } from './PannableMap';
import {
  type AtlasBase,
  type BaseFilter,
  EMPTY_ATLAS,
  MIN_SEARCH,
  NO_BASE_FILTER,
  allianceColor,
  byPower,
  centroid,
  filterActive,
  formatCopyCoordinate,
  formatPower,
  isShielded,
  isStale,
  matchesFilter,
  parsePower,
  searchAtlas,
  shieldedCounts,
  useAtlas,
} from './atlas';
import {
  NO_FILTER,
  type TruckFilter,
  type TruckSort,
  filterTrucks,
  sortTrucks,
  truckSpot,
} from './hunt';
import { useHuntData } from './huntState';
import { matchPlan, usePlan } from './plan';

const BASES_SHOWN = 50;

type Panel = 'atlas' | 'plunder';

/** One server's swept bases coloured by alliance, with the alliances ranked
 * beside the map. Clicking an alliance lights its bases; clicking a base or a
 * row picks it, sends the map there and copies the coordinate.
 *
 * "bases" everywhere, never "members": see atlas.ts for why the count is of
 * bases SEEN and the alliance is the LAST one seen.
 */
export function AtlasPage({
  serverId,
  servers,
  onServer,
}: {
  serverId: number;
  servers: readonly number[];
  onServer: (id: number) => void;
}) {
  const { data, isPending, error } = useAtlas(serverId);
  const { active: mine } = useActiveAlliance();
  const atlas = data ?? EMPTY_ATLAS;
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<Panel>('atlas');
  const [mode, setMode] = useState<MapMode>('map');
  const [picked, setPicked] = useState<number | null>(null);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ at: Coordinate; nonce: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [baseFilter, setBaseFilter] = useState<BaseFilter>(NO_BASE_FILTER);
  const [powerText, setPowerText] = useState('');
  const [truckFilter, setTruckFilter] = useState<TruckFilter>(NO_FILTER);
  const [truckSort, setTruckSort] = useState<TruckSort>('time');
  const [showPlunder, setShowPlunder] = useState(true);
  const [pickedHunt, setPickedHunt] = useState<string | null>(null);
  const hunt = useHuntData(serverId);
  const plan = usePlan(serverId, mode === 'plan');
  const planMatch = mode === 'plan' ? matchPlan(plan.slots, atlas.bases) : null;
  const now = new Date();

  const oursIndex = atlas.alliances.findIndex((a) => a.id === mine?.alliance_id);
  const search = searchAtlas(atlas, query);

  // What the map keeps bright, and what the Bases list shows.
  let lit: Set<number> | null = null;
  let listed: AtlasBase[] = atlas.bases;
  if (picked !== null) {
    listed = atlas.bases.filter((base) => base.alliance === picked);
    lit = new Set(listed.map((base) => base.gameUid));
  } else if (search.kind === 'text') {
    listed = search.bases;
    lit = new Set(listed.map((base) => base.gameUid));
  } else if (search.kind === 'coordinate') {
    listed = search.nearest;
  }
  // The filters dim what they exclude on the map and drop it from the list, on
  // top of whatever the alliance pick or the search already narrowed to.
  if (filterActive(baseFilter)) {
    const passing = new Set(
      atlas.bases.filter((base) => matchesFilter(base, baseFilter, now)).map((b) => b.gameUid),
    );
    listed = listed.filter((base) => passing.has(base.gameUid));
    lit = lit === null ? passing : new Set([...lit].filter((uid) => passing.has(uid)));
  }
  // Plunder looks at what moves, so the bases stay as a dim backdrop.
  if (mode === 'plunder') lit = new Set();
  // Plan keeps the bases that stand on their tile bright and the rest behind them.
  if (planMatch !== null) {
    lit = new Set(planMatch.tiles.flatMap((t) => (t.base ? [t.base.gameUid] : [])));
  }
  // A search or a filter is asking about bases, not alliances.
  const searching = query.trim().length > 0 || filterActive(baseFilter);
  const ranked = byPower(listed);
  const rows = showAll ? ranked : ranked.slice(0, BASES_SHOWN);

  // Our alliance stays on top, as the ranking beside the map in the game's own
  // tools does, with its true rank beside it.
  const order = atlas.alliances.map((_, index) => index);
  const visible = (
    search.kind === 'text' ? order.filter((i) => search.alliances.includes(i)) : order
  )
    .slice()
    .sort((a, b) => Number(b === oursIndex) - Number(a === oursIndex) || a - b);
  const maxBases = atlas.alliances[0]?.bases ?? 1;
  const shielded = shieldedCounts(atlas, now);
  const pickedAlliance = picked === null ? undefined : atlas.alliances[picked];
  const selected = atlas.bases.find((base) => base.gameUid === selectedUid) ?? null;

  function goTo(at: Coordinate, uid: number | null) {
    setSelectedUid(uid);
    setFocus((previous) => ({ at, nonce: (previous?.nonce ?? 0) + 1 }));
    const written = formatCopyCoordinate(at);
    navigator.clipboard
      ?.writeText(written)
      .then(() => setCopied(written))
      .catch(() => setCopied(null));
  }

  const shownTrucks = sortTrucks(filterTrucks(hunt.worth, truckFilter), truckSort);
  // A pin only on the map of the server the truck belongs to: its coordinates are
  // on that map, and nobody has shown that a foreign truck's are the same.
  const placedTrucks = shownTrucks.flatMap((truck) => {
    const spot = truck.serverId === serverId ? truckSpot(truck, now) : null;
    return spot === null ? [] : [{ truck, spot }];
  });

  const onThisMap = shownTrucks.filter((truck) => truck.serverId === serverId);

  function chooseMode(next: MapMode) {
    setMode(next);
    setBaseFilter((previous) => ({
      ...previous,
      shield: next === 'targets' ? 'open' : next === 'shields' ? 'shielded' : 'all',
    }));
  }

  function chooseHunt(id: string, at: Coordinate) {
    setPickedHunt(id);
    goTo(at, null);
  }

  function chooseBase(base: AtlasBase) {
    // The base's alliance is what the map highlights while it is looked at, so
    // its "strongest in" list and the glow agree.
    setPicked(base.alliance >= 0 ? base.alliance : null);
    goTo(base.at, base.gameUid);
  }

  function copyBase(base: AtlasBase) {
    const written = formatCopyCoordinate(base.at);
    navigator.clipboard
      ?.writeText(written)
      .then(() => setCopied(written))
      .catch(() => setCopied(null));
  }

  function centreOnAlliance(index: number) {
    const middle = centroid(atlas.bases.filter((base) => base.alliance === index));
    if (middle !== null)
      setFocus((previous) => ({ at: middle, nonce: (previous?.nonce ?? 0) + 1 }));
  }

  function chooseAlliance(index: number) {
    setPicked(index);
    setSelectedUid(null);
    setShowAll(false);
    centreOnAlliance(index);
  }

  function showAllAlliances() {
    setPicked(null);
    setSelectedUid(null);
  }

  const newest = atlas.bases.reduce<Date | null>(
    (best, base) => (best === null || base.seenAt > best ? base.seenAt : best),
    null,
  );

  if (isPending) return <p className="empty loading">Loading…</p>;
  if (error) return <p className="error">Could not load the map: {(error as Error).message}</p>;

  return (
    <div className="atlas">
      <div className="hunt-map">
        <PannableMap focus={focus}>
          <AtlasMap
            atlas={atlas}
            lit={lit}
            onSelect={chooseBase}
            oursIndex={oursIndex}
            pickedAlliance={picked}
            selectedUid={selectedUid}
            shieldMode={
              mode === 'targets' || mode === 'shields' || baseFilter.shield === 'shielded'
            }
            planTiles={planMatch?.tiles ?? null}
            territory={mode === 'territory'}
          >
            <HuntPins
              missions={showPlunder || mode === 'plunder' ? hunt.open : []}
              onChoose={chooseHunt}
              picked={pickedHunt}
              trucks={showPlunder || mode === 'plunder' ? onThisMap : []}
            />
          </AtlasMap>
        </PannableMap>
        <div className="atlas-bar">
          <MapModeMenu mode={mode} onChange={chooseMode} />
          {planMatch !== null && (
            <span className="atlas-chip atlas-chip--static">
              {plan.loading
                ? 'Plan…'
                : plan.formation === null
                  ? `No hive plan for ${serverId}`
                  : `${plan.formation.name} · ${planMatch.placed}/${planMatch.total} in place`}
            </span>
          )}
          {pickedAlliance !== undefined && (
            <button
              aria-label={`Show every alliance again (now [${pickedAlliance.code ?? '?'}])`}
              className="atlas-chip"
              onClick={showAllAlliances}
              type="button"
            >
              <span
                aria-hidden="true"
                className="atlas-chip__dot"
                style={{ background: allianceColor(pickedAlliance.id, picked === oursIndex) }}
              />
              [{pickedAlliance.code ?? '?'}]<span aria-hidden="true">×</span>
            </button>
          )}
        </div>
        {(hunt.errors.length > 0 || (copied && selected === null)) && (
          <div className="atlas-toast">
            {hunt.errors.map((message) => (
              <p className="error" key={message}>
                {message}
              </p>
            ))}
            {copied && selected === null && <output>Copied {copied}</output>}
          </div>
        )}
      </div>

      <aside className="hunt-side">
        <div className="atlas-side__top">
          <label className="atlas-state">
            <span>State</span>
            <select onChange={(event) => onServer(Number(event.target.value))} value={serverId}>
              {servers.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <span className="atlas-meta">
            {atlas.bases.length.toLocaleString('en')} bases · {atlas.alliances.length} alliances
            {newest !== null && ` · ${formatAge(newest.toISOString(), now)}`}
          </span>
        </div>

        <div className="atlas-side__filters">
          <label className="map-search">
            <span className="visually-hidden">Search</span>
            <input
              autoComplete="off"
              onChange={(event) => {
                const next = event.target.value;
                setQuery(next);
                setPicked(null);
                setShowAll(false);
                const found = searchAtlas(atlas, next);
                if (found.kind === 'coordinate') goTo(found.at, null);
              }}
              placeholder="Player, alliance or X:Y"
              type="search"
              value={query}
            />
          </label>
          {query.trim().length > 0 &&
            query.trim().length < MIN_SEARCH &&
            search.kind === 'none' && (
              <p className="subtle">Keep typing — {MIN_SEARCH} characters or more.</p>
            )}

          <Tabs
            label="Shield"
            items={[
              { id: 'all' as const, label: 'All' },
              { id: 'shielded' as const, label: 'Shield' },
              { id: 'open' as const, label: 'No shield' },
            ]}
            onChange={(shield) => setBaseFilter({ ...baseFilter, shield })}
            value={baseFilter.shield}
          />
          <div className="atlas-range">
            <label>
              <span>HQ from</span>
              <input
                max={99}
                min={1}
                onChange={(event) =>
                  setBaseFilter({ ...baseFilter, hqMin: toLevel(event.target.value) })
                }
                placeholder="1"
                type="number"
                value={baseFilter.hqMin ?? ''}
              />
            </label>
            <label>
              <span>to</span>
              <input
                max={99}
                min={1}
                onChange={(event) =>
                  setBaseFilter({ ...baseFilter, hqMax: toLevel(event.target.value) })
                }
                placeholder="35"
                type="number"
                value={baseFilter.hqMax ?? ''}
              />
            </label>
            <label>
              <span>Power under</span>
              <input
                onChange={(event) => {
                  setPowerText(event.target.value);
                  setBaseFilter({ ...baseFilter, powerUnder: parsePower(event.target.value) });
                }}
                placeholder="e.g. 135m"
                value={powerText}
              />
            </label>
          </div>
          <details className="atlas-filters">
            <summary>Layers and help</summary>
            <label>
              <input
                checked={baseFilter.hideStale}
                onChange={(event) =>
                  setBaseFilter({ ...baseFilter, hideStale: event.target.checked })
                }
                type="checkbox"
              />
              <span>Hide sightings over a day old</span>
            </label>
            <label>
              <input
                checked={showPlunder}
                onChange={(event) => setShowPlunder(event.target.checked)}
                type="checkbox"
              />
              <span>◆ Trucks and ■ missions ({placedTrucks.length} trucks on this map)</span>
            </label>
            <p className="subtle">
              Each dot is a base seen in a sweep, coloured by the alliance its player was last seen
              in; faded dots were last seen over a day ago. Drag to move, wheel or +/− to zoom in
              until every tower is clear; clicking copies the coordinate.
            </p>
          </details>
        </div>

        <div className="atlas-side__body">
          <Tabs
            label="Panel"
            items={[
              { id: 'atlas' as const, label: 'Atlas' },
              {
                id: 'plunder' as const,
                label: `Plunder (${hunt.worth.length + hunt.open.length})`,
              },
            ]}
            onChange={setPanel}
            value={panel}
          />

          {panel === 'atlas' && selected !== null && (
            <BaseDetail
              atlas={atlas}
              base={selected}
              copied={copied}
              isOurs={selected.alliance === oursIndex && oursIndex >= 0}
              now={now}
              onBack={() => {
                setSelectedUid(null);
                if (selected.alliance < 0) setPicked(null);
              }}
              onChoose={chooseBase}
              onClose={() => setSelectedUid(null)}
              onCopy={copyBase}
            />
          )}

          {panel === 'atlas' && selected === null && picked !== null && (
            <AllianceDetail
              atlas={atlas}
              index={picked}
              isOurs={picked === oursIndex}
              now={now}
              onBack={showAllAlliances}
              onCentre={() => centreOnAlliance(picked)}
              onChoose={chooseBase}
              selectedUid={selectedUid}
            />
          )}

          {panel === 'atlas' && selected === null && picked === null && (
            <>
              {atlas.alliances.length === 0 && (
                <p className="empty">
                  No swept base on server {serverId} has a known alliance yet.
                </p>
              )}
              {search.kind === 'text' && visible.length === 0 && (
                <p className="empty">No alliance matches that. Players do: see Bases.</p>
              )}
              <ul className="map-results atlas-ranking">
                {visible.map((index) => {
                  const alliance = atlas.alliances[index];
                  if (alliance === undefined) return null;
                  const isOurs = index === oursIndex;
                  return (
                    <li key={alliance.id}>
                      <button
                        className={picked === index ? 'map-result--on' : undefined}
                        onClick={() => chooseAlliance(index)}
                        type="button"
                      >
                        <span className="atlas-ranking__rank">{index + 1}</span>
                        <span
                          aria-hidden="true"
                          className="atlas-ranking__swatch"
                          style={{ background: allianceColor(alliance.id, isOurs) }}
                        />
                        <span className="atlas-ranking__name">
                          <strong>[{alliance.code ?? '?'}]</strong> {alliance.name ?? ''}
                          {isOurs && <em> · your alliance</em>}
                        </span>
                        <span className="atlas-ranking__count">
                          {alliance.bases} base{alliance.bases === 1 ? '' : 's'}
                          <span className="subtle"> · {formatPower(alliance.power)}</span>
                          {(shielded[index] ?? 0) > 0 && (
                            <span className="subtle atlas-ranking__shield">
                              {shielded[index]} shielded
                            </span>
                          )}
                        </span>
                        <span
                          aria-hidden="true"
                          className="atlas-ranking__bar"
                          style={{
                            width: `${(alliance.bases / maxBases) * 100}%`,
                            background: allianceColor(alliance.id, isOurs),
                          }}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>

              {searching && (
                <>
                  {search.kind === 'coordinate' && (
                    <p className="subtle">Nearest to {formatCoordinate(search.at)}.</p>
                  )}
                  {listed.length === 0 && <p className="empty">Nobody matches.</p>}
                  <ul className="map-results">
                    {rows.map((base) => {
                      const alliance =
                        base.alliance >= 0 ? atlas.alliances[base.alliance] : undefined;
                      return (
                        <li key={base.gameUid}>
                          <button
                            className={base.gameUid === selectedUid ? 'map-result--on' : undefined}
                            onClick={() => chooseBase(base)}
                            type="button"
                          >
                            <strong>
                              {alliance?.code ? `[${alliance.code}] ` : ''}
                              {base.name ?? 'unnamed'}
                            </strong>
                            <span className="subtle">
                              {formatCoordinate(base.at)}
                              {base.hq !== null && ` · HQ ${base.hq}`} · {formatPower(base.power)} ·{' '}
                              {formatAge(base.seenAt.toISOString(), now)}
                              {isShielded(base, now) && ' · shielded'}
                              {isStale(base, now) && ' (may have moved)'}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {!showAll && ranked.length > BASES_SHOWN && (
                    <button className="linklike" onClick={() => setShowAll(true)} type="button">
                      Show all {ranked.length}
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {panel === 'plunder' && (
            <>
              <h3 className="atlas-detail__title">Trucks</h3>
              <TrucksList
                filter={truckFilter}
                loaded={hunt.trucksLoaded}
                mapServer={serverId}
                now={now}
                onChoose={(truck) => {
                  const spot = truckSpot(truck, now);
                  if (spot) chooseHunt(truck.truckUuid, spot.at);
                  else setPickedHunt(truck.truckUuid === pickedHunt ? null : truck.truckUuid);
                }}
                onFilter={setTruckFilter}
                onSort={setTruckSort}
                picked={pickedHunt}
                shown={shownTrucks}
                sort={truckSort}
                worth={hunt.worth}
              />
              <h3 className="atlas-detail__title">Missions</h3>
              <PlunderList
                loaded={hunt.missionsLoaded}
                now={now}
                onChoose={(mission) => chooseHunt(mission.missionUuid, mission.at)}
                open={hunt.open}
                picked={pickedHunt}
                serverId={serverId}
              />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/** An HQ level typed into a number box; empty or junk is no bound. */
function toLevel(text: string): number | null {
  const level = Number.parseInt(text, 10);
  return Number.isNaN(level) ? null : level;
}
