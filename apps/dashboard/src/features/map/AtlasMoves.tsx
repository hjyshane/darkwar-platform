import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Tabs } from '../../components/ui/Tabs';
import { formatAge } from '../../lib/freshness';
import { playerHash } from '../../lib/route';
import {
  type ServerFlowRow,
  type Since,
  byOtherServer,
  fetchServerFlow,
  sinceIso,
  splitFlow,
} from '../migration/moveHistory';
import { type Atlas, type AtlasBase, formatPower } from './atlas';

/** Who moved to this server and who left it, from the move log (0320), which
 * since 0334 also learns from the map: a base seen on a server's map is a
 * player living there. So every server the sweep reaches has both lists, not
 * only the ones whose rosters are read.
 *
 * An arrival whose base is on this map is a button that picks it (and copies
 * its coordinate); a departure is not on this map at all, so it links to the
 * player instead. */
export function MovesPanel({
  serverId,
  atlas,
  onChoose,
}: {
  serverId: number;
  atlas: Atlas;
  onChoose: (base: AtlasBase) => void;
}) {
  const [since, setSince] = useState<Since>('30d');
  const flow = useQuery({
    queryKey: ['map', 'moves', serverId, since],
    queryFn: () => fetchServerFlow(serverId, sinceIso(since, Date.now())),
    staleTime: 5 * 60_000,
  });
  const now = new Date();
  const onMap = new Map(atlas.bases.map((base) => [base.gameUid, base]));
  const { arrived, departed } = splitFlow(flow.data ?? []);

  return (
    <section aria-label="Moves" className="atlas-moves">
      <Tabs
        label="Since"
        items={[
          { id: '7d' as const, label: '7 days' },
          { id: '30d' as const, label: '30 days' },
          { id: 'all' as const, label: 'All' },
        ]}
        onChange={setSince}
        value={since}
      />
      {flow.isPending && <p className="empty loading">Loading…</p>}
      {flow.error && (
        <p className="error">Could not load the moves: {(flow.error as Error).message}</p>
      )}
      {flow.data && (
        <>
          <MoveList
            empty={`Nobody seen arriving on ${serverId} in this window.`}
            now={now}
            onChoose={onChoose}
            onMap={onMap}
            rows={arrived}
            title={`Migrated in (${arrived.length})`}
            verb="from"
          />
          <MoveList
            empty={`Nobody seen leaving ${serverId} in this window.`}
            now={now}
            onChoose={onChoose}
            onMap={onMap}
            rows={departed}
            title={`Migrated out (${departed.length})`}
            verb="to"
          />
          <p className="subtle">
            A move is dated when the player was first seen on the new server — on its map, a board
            or a roster — not when they moved. Name, alliance and power are their current ones.
          </p>
        </>
      )}
    </section>
  );
}

function MoveList({
  title,
  rows,
  verb,
  empty,
  onMap,
  onChoose,
  now,
}: {
  title: string;
  rows: readonly ServerFlowRow[];
  verb: 'from' | 'to';
  empty: string;
  onMap: ReadonlyMap<number, AtlasBase>;
  onChoose: (base: AtlasBase) => void;
  now: Date;
}) {
  const others = byOtherServer(rows).slice(0, 6);
  return (
    <>
      <h3 className="atlas-detail__title">{title}</h3>
      {rows.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <p className="subtle">{others.map((o) => `${verb} ${o.server}: ${o.count}`).join(' · ')}</p>
      )}
      <ul className="map-results">
        {rows.map((row) => {
          const base = onMap.get(row.game_uid);
          const line = (
            <>
              <strong>
                {row.alliance_code ? `[${row.alliance_code}] ` : ''}
                {row.player_name ?? `UID ${row.game_uid}`}
              </strong>
              <span className="subtle">
                {verb} {row.other_server_id} · seen {formatAge(row.seen_at, now)} ·{' '}
                {formatPower(row.power)}
                {base !== undefined && ' · on this map'}
              </span>
            </>
          );
          return (
            <li key={row.move_id}>
              {base !== undefined ? (
                <button onClick={() => onChoose(base)} type="button">
                  {line}
                </button>
              ) : (
                <a className="atlas-moves__link" href={playerHash(row.player_id)}>
                  {line}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
