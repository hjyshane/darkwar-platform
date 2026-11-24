import { formatAge } from '../../lib/freshness';
import { useT } from '../../lib/i18n';
import { type Translate, english } from '../../lib/i18n/core';
import { shareCoordinate } from '../../lib/shareCoordinate';
import {
  type Mission,
  QUALITY_NAMES,
  type Truck,
  type TruckFilter,
  type TruckSort,
  countByServer,
  lootsLeft,
  lootsSeenAt,
  missionShare,
  timeLeft,
  truckSpot,
} from './hunt';
import { type TreasureSite, closesAt, isUnlit, shareLabel } from './sites';

/** Every plunder row copies on click; the hint says so once, above the lists. */
export function CopyHint({ copied }: { copied: string | null }) {
  const t = useT();
  return (
    <p className="subtle hunt-copy-hint">
      {copied ? (
        <output>{t('Copied {text}', { text: copied })}</output>
      ) : (
        t('Click a row to copy its coordinate as #server[X: Y:] for game chat.')
      )}
    </p>
  );
}

export const who = (name: string | null, abbr: string | null, t: Translate = english) =>
  `${abbr ? `[${abbr}] ` : ''}${name ?? t('unknown')}`;

/** Trucks carrying hero fragments: a server chooser, filters, and the list.
 *
 * The list holds every server's trucks, because the interception list covers the
 * whole group; the map only has a pin for those that belong to the server on
 * screen (see the pins). `shown` is what survived the filter, so the list and
 * the pins always agree.
 */
export function TrucksList({
  worth,
  shown,
  filter,
  onFilter,
  sort,
  onSort,
  picked,
  onChoose,
  mapServer,
  loaded,
  now,
}: {
  worth: readonly Truck[];
  shown: readonly Truck[];
  filter: TruckFilter;
  onFilter: (next: TruckFilter) => void;
  sort: TruckSort;
  onSort: (next: TruckSort) => void;
  picked: string | null;
  onChoose: (truck: Truck) => void;
  mapServer: number;
  loaded: boolean;
  now: Date;
}) {
  const t = useT();
  const servers = countByServer(worth);
  return (
    <>
      {/* Small controls over the list, so the list itself is what is on screen. */}
      <div className="atlas-toolbar">
        <select
          aria-label={t('Server')}
          onChange={(event) =>
            onFilter({
              ...filter,
              serverId: event.target.value === '' ? null : Number(event.target.value),
            })
          }
          value={filter.serverId ?? ''}
        >
          <option value="">{t('All servers ({count})', { count: worth.length })}</option>
          {servers.map((entry) => (
            <option key={entry.serverId} value={entry.serverId}>
              {t('Server {server} ({trucks} · {shards} shards)', {
                server: entry.serverId,
                trucks: entry.trucks,
                shards: entry.shards,
              })}
            </option>
          ))}
        </select>
        <select
          aria-label={t('Loots left')}
          onChange={(event) => onFilter({ ...filter, minLoots: Number(event.target.value) })}
          value={filter.minLoots}
        >
          <option value={0}>{t('Loots: any')}</option>
          <option value={1}>{t('Loots: 1+')}</option>
          <option value={2}>{t('Loots: 2')}</option>
        </select>
        <select
          aria-label={t('Hero shards')}
          onChange={(event) => onFilter({ ...filter, minShards: Number(event.target.value) })}
          value={filter.minShards}
        >
          <option value={0}>{t('Shards: any')}</option>
          <option value={1}>{t('Shards: 1+')}</option>
          <option value={2}>{t('Shards: 2+')}</option>
          <option value={3}>{t('Shards: 3+')}</option>
        </select>
        <select
          aria-label={t('Sort by')}
          onChange={(event) => onSort(event.target.value as TruckSort)}
          value={sort}
        >
          <option value="time">{t('Sort: soonest')}</option>
          <option value="shards">{t('Sort: most shards')}</option>
          <option value="loots">{t('Sort: most loots')}</option>
        </select>
      </div>

      {loaded && worth.length === 0 && (
        <p className="empty">
          {t(
            'None known right now. A truck only appears once the collector has read the interception list while it was on the road.',
          )}
        </p>
      )}
      {worth.length > 0 && shown.length === 0 && (
        <p className="empty">{t('No truck matches that filter.')}</p>
      )}
      <ul className="map-results">
        {shown.map((truck) => (
          <li key={truck.truckUuid}>
            <button
              className={truck.truckUuid === picked ? 'map-result--on' : undefined}
              onClick={() => onChoose(truck)}
              type="button"
            >
              <strong>◆ {who(truck.ownerName, truck.allianceAbbr, t)}</strong>
              <span className="subtle">{truckLine(truck, mapServer, now, t)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Gold missions paying Orange Skill Books on the server on screen. */
export function PlunderList({
  open,
  serverId,
  picked,
  onChoose,
  loaded,
  now,
}: {
  open: readonly Mission[];
  serverId: number;
  picked: string | null;
  onChoose: (mission: Mission) => void;
  loaded: boolean;
  now: Date;
}) {
  const t = useT();
  return (
    <>
      {loaded && open.length === 0 && (
        <p className="empty">
          {t(
            'No gold mission paying Orange Skill Books is open on server {server} as far as the map has seen. A mission shows up once a sweep passes its tile after it was started.',
            { server: serverId },
          )}
        </p>
      )}
      <ul className="map-results">
        {open.map((mission) => (
          <li key={mission.missionUuid}>
            <button
              className={mission.missionUuid === picked ? 'map-result--on' : undefined}
              onClick={() => onChoose(mission)}
              type="button"
            >
              <strong>■ {who(mission.ownerName, mission.allianceAbbr, t)}</strong>
              <span className="subtle">
                {missionShare(mission)} ·{' '}
                {t('{count} Orange Skill Books per steal', { count: mission.orangeBooks })}
                {mission.stealMax !== null &&
                  ` · ${t('up to {count} steals', { count: mission.stealMax })}`}{' '}
                · {t('ends in {time}', { time: timeLeft(mission.endsAt, now, t) })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Large Treasure Spots on the server on screen: lanterns hiding one, and spots
 * already open (0315). The coordinate is the game's, one less than the tile. */
export function TreasureList({
  sites,
  serverId,
  picked,
  onChoose,
  loaded,
  now,
}: {
  sites: readonly TreasureSite[];
  serverId: number;
  picked: string | null;
  onChoose: (site: TreasureSite) => void;
  loaded: boolean;
  now: Date;
}) {
  const t = useT();
  return (
    <>
      {loaded && sites.length === 0 && (
        <p className="empty">
          {t('No Large Treasure Spot standing on server {server} as far as the map has seen.', {
            server: serverId,
          })}
        </p>
      )}
      <ul className="map-results">
        {sites.map((site) => (
          <li key={site.siteUuid}>
            <button
              className={site.siteUuid === picked ? 'map-result--on' : undefined}
              onClick={() => onChoose(site)}
              type="button"
            >
              <strong>◎ {shareLabel(site)}</strong>
              <span className="subtle">
                {isUnlit(site)
                  ? t('unlit lantern')
                  : site.status === 2
                    ? t('open · {count} exploring', { count: site.participants })
                    : t('being lit')}{' '}
                · {t('closes in {time}', { time: timeLeft(closesAt(site), now, t) })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function truckLine(truck: Truck, mapServer: number, now: Date, t: Translate = english): string {
  const spot = truckSpot(truck, now);
  let where = t('no position seen');
  if (spot !== null) {
    // The server in front says whose map it is on, the open one or another.
    const base = shareCoordinate(truck.serverId, spot.at);
    if (spot.origin) where = t('set off from {place}', { place: base });
    else where = spot.live ? base : t('{place} (last known)', { place: base });
  }
  if (spot !== null && truck.serverId !== mapServer) where += ` (${t('another map')})`;
  const left = lootsLeft(truck);
  // A twice-looted truck is not listed at all; one looted since it was last
  // read still is, so the count carries its age.
  const seen = lootsSeenAt(truck);
  const counted = seen === null ? '' : ` (${formatAge(seen.toISOString(), now, t)})`;
  return [
    t('server {server}', { server: truck.serverId }),
    qualityName(truck.quality, t),
    truck.heroFragments === 1
      ? t('{count} hero shard', { count: truck.heroFragments })
      : t('{count} hero shards', { count: truck.heroFragments }),
    `${left === 1 ? t('{count} loot left', { count: left }) : t('{count} loots left', { count: left })}${counted}`,
    where,
    t('arrives in {time}', { time: timeLeft(truck.arriveAt, now, t) }),
  ].join(' · ');
}

/** A truck's quality tier ("Purple"), or `Q7` for a tier this file has no name for. */
function qualityName(quality: number, t: Translate): string {
  const name = QUALITY_NAMES[quality];
  return name === undefined ? `Q${quality}` : t(name);
}
