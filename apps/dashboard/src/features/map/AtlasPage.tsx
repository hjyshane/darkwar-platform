import { type Coordinate, formatCoordinate } from '@dw/ui';
import { useState } from 'react';
import { StatTile } from '../../components/StatTile';
import { Tabs } from '../../components/ui/Tabs';
import { formatAge } from '../../lib/freshness';
import { useActiveAlliance } from '../../lib/useMyAlliances';
import { AtlasMap } from './AtlasMap';
import { PannableMap } from './PannableMap';
import {
  type AtlasBase,
  EMPTY_ATLAS,
  MIN_SEARCH,
  allianceColor,
  byPower,
  centroid,
  formatPower,
  isStale,
  searchAtlas,
  useAtlas,
} from './atlas';

const BASES_SHOWN = 50;

type Panel = 'alliances' | 'bases';

/** One server's swept bases coloured by alliance, with the alliances ranked
 * beside the map. Clicking an alliance lights its bases; clicking a base or a
 * row picks it, sends the map there and copies the coordinate.
 *
 * "bases" everywhere, never "members": see atlas.ts for why the count is of
 * bases SEEN and the alliance is the LAST one seen.
 */
export function AtlasPage({ serverId }: { serverId: number }) {
  const { data, isPending, error } = useAtlas(serverId);
  const { active: mine } = useActiveAlliance();
  const atlas = data ?? EMPTY_ATLAS;
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<Panel>('alliances');
  const [picked, setPicked] = useState<number | null>(null);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ at: Coordinate; nonce: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
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

  function goTo(at: Coordinate, uid: number | null) {
    setSelectedUid(uid);
    setFocus((previous) => ({ at, nonce: (previous?.nonce ?? 0) + 1 }));
    const written = formatCoordinate(at);
    navigator.clipboard
      ?.writeText(written)
      .then(() => setCopied(written))
      .catch(() => setCopied(null));
  }

  function chooseBase(base: AtlasBase) {
    goTo(base.at, base.gameUid);
  }

  function chooseAlliance(index: number) {
    if (picked === index) {
      setPicked(null);
      return;
    }
    setPicked(index);
    setShowAll(false);
    const middle = centroid(atlas.bases.filter((base) => base.alliance === index));
    if (middle !== null)
      setFocus((previous) => ({ at: middle, nonce: (previous?.nonce ?? 0) + 1 }));
  }

  const newest = atlas.bases.reduce<Date | null>(
    (best, base) => (best === null || base.seenAt > best ? base.seenAt : best),
    null,
  );

  if (isPending) return <p className="empty loading">Loading…</p>;
  if (error) return <p className="error">Could not load the map: {(error as Error).message}</p>;

  return (
    <div className="atlas">
      <div className="strip">
        <StatTile hero label="Server" value={String(serverId)} />
        <StatTile
          label="Bases seen"
          note="swept, not everyone who plays"
          value={atlas.bases.length.toLocaleString('en')}
        />
        <StatTile label="Alliances" value={atlas.alliances.length.toLocaleString('en')} />
        <StatTile
          label="Newest sighting"
          note="positions are only as recent as the sweep"
          value={newest === null ? null : formatAge(newest.toISOString(), now)}
        />
      </div>

      <div className="hunt-body">
        <div className="hunt-map">
          <PannableMap focus={focus}>
            <AtlasMap
              atlas={atlas}
              lit={lit}
              onSelect={chooseBase}
              oursIndex={oursIndex}
              selectedUid={selectedUid}
            />
          </PannableMap>
          <p className="subtle">
            Each dot is a base, coloured by the alliance its player was last seen in; faded dots
            were last seen over a day ago. Drag to move, wheel or +/− to zoom; clicking copies the
            coordinate.
          </p>
          {copied && <output className="subtle">Copied {copied}</output>}
        </div>

        <div className="hunt-side">
          <label className="map-search">
            <span>Search</span>
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
            label="Panel"
            items={[
              { id: 'alliances' as const, label: 'Alliances' },
              { id: 'bases' as const, label: `Bases (${listed.length})` },
            ]}
            onChange={setPanel}
            value={panel}
          />

          {panel === 'alliances' && (
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
            </>
          )}

          {panel === 'bases' && (
            <>
              {picked !== null && (
                <p className="subtle">
                  {atlas.alliances[picked]?.code
                    ? `[${atlas.alliances[picked]?.code}]`
                    : 'Alliance'}
                  's bases.{' '}
                  <button className="linklike" onClick={() => setPicked(null)} type="button">
                    show all
                  </button>
                </p>
              )}
              {search.kind === 'coordinate' && (
                <p className="subtle">Nearest to {formatCoordinate(search.at)}.</p>
              )}
              {listed.length === 0 && <p className="empty">Nobody matches.</p>}
              <ul className="map-results">
                {rows.map((base) => {
                  const alliance = base.alliance >= 0 ? atlas.alliances[base.alliance] : undefined;
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
        </div>
      </div>
    </div>
  );
}
