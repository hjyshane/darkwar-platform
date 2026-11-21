import { type Coordinate, formatCoordinate } from '@dw/ui';
import { useMemo, useState } from 'react';
import { Tabs } from '../../components/ui/Tabs';
import { formatAge } from '../../lib/freshness';
import { shareCoordinate } from '../../lib/shareCoordinate';
import { useActiveAlliance } from '../../lib/useMyAlliances';
import { AtlasMap } from './AtlasMap';
import { MovesPanel } from './AtlasMoves';
import { AllianceDetail, BaseDetail } from './AtlasPanel';
import { CopyHint, PlunderList, TreasureList, TrucksList } from './HuntLists';
import { HuntPins } from './HuntPins';
import { MapLayerMenu, type MapMode, MapModeMenu } from './MapModes';
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
  formatPower,
  isOldSweep,
  isShielded,
  isStale,
  matchesFilter,
  parsePower,
  searchAtlas,
  shieldLeft,
  shieldedCounts,
  useAtlas,
} from './atlas';
import {
  NO_FILTER,
  type TruckFilter,
  type TruckSort,
  filterTrucks,
  missionShare,
  sortTrucks,
  truckShare,
  truckSpot,
} from './hunt';
import { useHuntData } from './huntState';
import { type MapLayer, readLayers, storeLayers, visibleBases } from './layers';
import type { ScannedServer } from './mapLocations';
import { matchPlan, usePlan } from './plan';
import { shareLabel } from './sites';

const BASES_SHOWN = 50;

/** The sidebar's tabs. Trucks, missions and treasure were one "Plunder" tab of
 * three stacked lists; each is its own tab so its list starts at the top
 * (operator, 2026-11-19). */
type Panel = 'atlas' | 'trucks' | 'missions' | 'treasure' | 'moves';

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
  servers: readonly ScannedServer[];
  onServer: (id: number) => void;
}) {
  const { data, isPending, error } = useAtlas(serverId);
  const sweptAt = servers.find((server) => server.serverId === serverId)?.sweptAt;
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
  const [layers, setLayers] = useState(readLayers);
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
  // What the map draws: the bases whose shield state is switched on in the Layers
  // menu. Hidden bases are gone from the picture, not dimmed — the point is a
  // quieter map. The sidebar lists still count every base. Memoised because
  // AtlasMap clusters the atlas it is given, and `now` moves every render.
  const drawn = useMemo(
    () =>
      layers.shielded && layers.open
        ? atlas
        : { ...atlas, bases: visibleBases(atlas.bases, layers, new Date()) },
    [atlas, layers],
  );

  /** Everything a click copies goes through here, already in the game's share
   * form (`#580[X:512 Y:300]`), so the toast shows exactly what was written. */
  function writeCopy(written: string) {
    navigator.clipboard
      ?.writeText(written)
      .then(() => setCopied(written))
      .catch(() => setCopied(null));
  }

  function focusOn(at: Coordinate) {
    setFocus((previous) => ({ at, nonce: (previous?.nonce ?? 0) + 1 }));
  }

  function goTo(at: Coordinate, uid: number | null) {
    setSelectedUid(uid);
    focusOn(at);
    writeCopy(shareCoordinate(serverId, at));
  }

  const shownTrucks = sortTrucks(filterTrucks(hunt.worth, truckFilter), truckSort);
  // A pin only on the map of the server the truck belongs to: its coordinates are
  // on that map, and nobody has shown that a foreign truck's are the same.
  const placedTrucks = shownTrucks.flatMap((truck) => {
    const spot = truck.serverId === serverId ? truckSpot(truck, now) : null;
    return spot === null ? [] : [{ truck, spot }];
  });

  const onThisMap = shownTrucks.filter((truck) => truck.serverId === serverId);
  // The Layers menu says which kinds of pin are drawn; a tab shows its own kind
  // even when its layer is off, so its list is never pinless.
  const pinned = (layer: MapLayer) => layers[layer] || panel === layer;

  function setLayer(layer: MapLayer, on: boolean) {
    const next = { ...layers, [layer]: on };
    setLayers(next);
    storeLayers(next);
  }

  /** A truck, mission or treasure spot picked from a pin or a list. `at` is
   * where to send the map, null when it is not on this one; `copy` is the
   * game's share form for it, which for a treasure spot is not its tile. */
  function chooseHunt(id: string, at: Coordinate | null, copy: string | null) {
    setPickedHunt(id);
    if (at !== null) {
      setSelectedUid(null);
      focusOn(at);
    }
    if (copy !== null) writeCopy(copy);
  }

  function chooseBase(base: AtlasBase) {
    // The base's alliance is what the map highlights while it is looked at, so
    // its "strongest in" list and the glow agree.
    setPicked(base.alliance >= 0 ? base.alliance : null);
    goTo(base.at, base.gameUid);
  }

  function copyBase(base: AtlasBase) {
    writeCopy(shareCoordinate(serverId, base.at));
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
    <div className={selected !== null && panel === 'atlas' ? 'atlas atlas--sheet' : 'atlas'}>
      <div className="hunt-map">
        <PannableMap focus={focus}>
          <AtlasMap
            atlas={drawn}
            lit={lit}
            onSelect={chooseBase}
            oursIndex={oursIndex}
            pickedAlliance={picked}
            selectedUid={selectedUid}
            // Either shield filter is a question about bases one by one, so names
            // (with the shield time or the power) start from further out.
            shieldMode={baseFilter.shield !== 'all'}
            planTiles={planMatch?.tiles ?? null}
            territory={mode === 'territory'}
          >
            <HuntPins
              missions={pinned('missions') ? hunt.open : []}
              onChoose={chooseHunt}
              picked={pickedHunt}
              sites={pinned('treasure') ? hunt.treasure : []}
              trucks={pinned('trucks') ? onThisMap : []}
            />
          </AtlasMap>
        </PannableMap>
        <div className="atlas-bar">
          <MapModeMenu mode={mode} onChange={setMode} />
          <MapLayerMenu layers={layers} onChange={setLayer} />
          {planMatch !== null && (
            <span className="atlas-chip atlas-chip--static">
              {plan.loading
                ? 'Plan…'
                : plan.formation === null
                  ? `No hive plan for ${serverId}`
                  : `${plan.formation.name} · ${planMatch.placed}/${planMatch.total} in place`}
            </span>
          )}
          {selected !== null && (
            // The chosen player, on the map itself. On a phone the detail is
            // below the picture, out of sight; the chip names who is selected,
            // jumps to the detail, and its × lets go without scrolling for it.
            <span className="atlas-chip atlas-chip--selected">
              <button
                aria-label={`Show details for ${selected.name ?? 'unnamed'}`}
                className="atlas-chip__main"
                onClick={() =>
                  document
                    .querySelector('.atlas .hunt-side')
                    ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
                }
                type="button"
              >
                {selected.name ?? 'unnamed'} · {formatPower(selected.power)}
              </button>
              <button
                aria-label={`Clear ${selected.name ?? 'unnamed'}`}
                className="atlas-chip__x"
                onClick={() => setSelectedUid(null)}
                type="button"
              >
                ×
              </button>
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
              {servers.map((server) => (
                <option key={server.serverId} value={server.serverId}>
                  {server.serverId} · {formatAge(server.sweptAt, now)}
                </option>
              ))}
            </select>
          </label>
          <span className="atlas-meta">
            {atlas.bases.length.toLocaleString('en')} bases · {atlas.alliances.length} alliances
            {newest !== null && ` · ${formatAge(newest.toISOString(), now)}`}
          </span>
        </div>

        {sweptAt !== undefined && isOldSweep(sweptAt, now) && (
          <output className="subtle atlas-old-sweep">
            Server {serverId} was last swept {formatAge(sweptAt, now)}. Bases here may have moved or
            left, so treat this map as a snapshot, not as live.
          </output>
        )}

        <Tabs
          className="atlas-side__tabs"
          label="Panel"
          items={[
            { id: 'atlas' as const, label: 'Atlas' },
            { id: 'trucks' as const, label: `Trucks (${hunt.worth.length})` },
            { id: 'missions' as const, label: `Missions (${hunt.open.length})` },
            { id: 'treasure' as const, label: `Treasure (${hunt.treasure.length})` },
            { id: 'moves' as const, label: 'Moves' },
          ]}
          onChange={setPanel}
          value={panel}
        />

        {/* Search and the base filters ask about bases, so they belong to Atlas. */}
        <div className="atlas-side__filters" hidden={panel !== 'atlas'}>
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
            <p className="subtle">
              The Layers pill on the map hides ◆ trucks, ■ missions, ✦ treasure spots, or the bases
              with or without a shield ({placedTrucks.length} trucks on this map).
            </p>
            <p className="subtle">
              Each dot is a base seen in a sweep, coloured by the alliance its player was last seen
              in; faded dots were last seen over a day ago. Drag to move, wheel or +/− to zoom in
              until every tower is clear; clicking copies the coordinate.
            </p>
          </details>
        </div>

        <div className="atlas-side__body">
          {panel === 'atlas' && selected !== null && (
            <BaseDetail
              atlas={atlas}
              base={selected}
              copied={copied}
              serverId={serverId}
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
                              {base.shieldEnd !== null && isShielded(base, now)
                                ? ` · 🛡 ${shieldLeft(base.shieldEnd, now) ?? ''} left`
                                : ' · no shield'}
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

          {panel === 'moves' && (
            <MovesPanel
              atlas={atlas}
              onChoose={(base) => {
                setPanel('atlas');
                chooseBase(base);
              }}
              serverId={serverId}
            />
          )}

          {panel === 'trucks' && (
            <>
              <CopyHint copied={copied} />
              <TrucksList
                filter={truckFilter}
                loaded={hunt.trucksLoaded}
                mapServer={serverId}
                now={now}
                onChoose={(truck) => {
                  // Copied wherever it is; the map moves only to a truck on it.
                  // The clock is read at the click: a truck covers a tile every
                  // four seconds, and `now` is as old as the last render.
                  const clicked = new Date();
                  const spot = truckSpot(truck, clicked);
                  chooseHunt(
                    truck.truckUuid,
                    spot !== null && truck.serverId === serverId ? spot.at : null,
                    truckShare(truck, clicked),
                  );
                }}
                onFilter={setTruckFilter}
                onSort={setTruckSort}
                picked={pickedHunt}
                shown={shownTrucks}
                sort={truckSort}
                worth={hunt.worth}
              />
            </>
          )}

          {panel === 'missions' && (
            <>
              <CopyHint copied={copied} />
              <PlunderList
                loaded={hunt.missionsLoaded}
                now={now}
                onChoose={(mission) =>
                  chooseHunt(mission.missionUuid, mission.at, missionShare(mission))
                }
                open={hunt.open}
                picked={pickedHunt}
                serverId={serverId}
              />
            </>
          )}

          {panel === 'treasure' && (
            <>
              <CopyHint copied={copied} />
              <TreasureList
                loaded={hunt.treasureLoaded}
                now={now}
                onChoose={(site) => chooseHunt(site.siteUuid, site.at, shareLabel(site))}
                picked={pickedHunt}
                serverId={serverId}
                sites={hunt.treasure}
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
