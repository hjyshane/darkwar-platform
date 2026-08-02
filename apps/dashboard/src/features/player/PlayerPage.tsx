import { useQuery } from '@tanstack/react-query';
import { FavouriteButton } from '../../components/FavouriteButton';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { StatTile } from '../../components/StatTile';
import { formatLastOnline } from '../../lib/freshness';
import { allianceHash, serverHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useFavourites } from '../../lib/useFavourites';

/** One player, gathered from every table that knows something about them.
 *
 * Six queries rather than one embedded select. They sit behind three
 * different boundaries — players and component power are world-readable,
 * contribution and presence are member-only — and a single embed would fail
 * the whole page for a logged-out reader instead of returning the public
 * part. That is the same reason RosterPanel splits its three.
 *
 * Past names come from player_names, which is the reason that table exists:
 * a name is not an identity here, and someone looking for a player who
 * renamed has nothing else to go on.
 */
interface PlayerDetail {
  playerId: string;
  gameUid: number;
  name: string | null;
  serverId: number;
  allianceId: string | null;
  allianceName: string | null;
  allianceCode: string | null;
  hqLevel: number | null;
  power: number | null;
  kills: number | null;
  lastSeenAt: string | null;
  onlineState: string | null;
  offlineSince: string | null;
  observedAt: string | null;
  contributions: Record<string, number | null> | null;
  componentPower: { metric: string; power: number | null; rank: number | null }[];
  pastNames: { name: string; lastSeenAt: string }[];
}

async function fetchPlayer(playerId: string): Promise<PlayerDetail | null> {
  const { data: player, error } = await supabase
    .from('players')
    .select(
      'player_id, game_uid, current_name, server_id, current_alliance_id, hq_level, power, kills, last_seen_at',
    )
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) {
    throw new Error(`player query failed: ${error.message}`);
  }
  if (player === null) {
    return null;
  }

  const [alliance, presence, contributions, component, names] = await Promise.all([
    player.current_alliance_id
      ? supabase
          .from('alliances')
          .select('alliance_id, current_name, current_code')
          .eq('alliance_id', player.current_alliance_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('player_presence')
      .select('online_state, offline_since, observed_at')
      .eq('player_id', playerId)
      .maybeSingle(),
    supabase
      .from('player_contributions')
      .select(
        'daily_donation_score, weekly_donation_score, duel_daily_score, duel_weekly_score, duel_round_score',
      )
      .eq('player_id', playerId)
      .maybeSingle(),
    supabase
      .from('player_component_power_snapshots')
      .select('metric, power, rank, captured_at')
      .eq('player_id', playerId)
      .order('captured_at', { ascending: false }),
    supabase
      .from('player_names')
      .select('name, last_seen_at')
      .eq('player_id', playerId)
      .order('last_seen_at', { ascending: false }),
  ]);

  // One row per board, newest first — keep the first sighting of each.
  const seen = new Set<string>();
  const componentPower = (component.data ?? [])
    .filter((row) => (seen.has(row.metric) ? false : seen.add(row.metric)))
    .map((row) => ({ metric: row.metric, power: row.power, rank: row.rank }));

  return {
    playerId: player.player_id,
    gameUid: player.game_uid,
    name: player.current_name,
    serverId: player.server_id,
    allianceId: alliance.data?.alliance_id ?? null,
    allianceName: alliance.data?.current_name ?? null,
    allianceCode: alliance.data?.current_code ?? null,
    hqLevel: player.hq_level,
    power: player.power,
    kills: player.kills,
    lastSeenAt: player.last_seen_at,
    onlineState: presence.data?.online_state ?? null,
    offlineSince: presence.data?.offline_since ?? null,
    observedAt: presence.data?.observed_at ?? null,
    contributions: contributions.data ?? null,
    componentPower,
    pastNames: (names.data ?? [])
      .filter((row) => row.name !== player.current_name)
      .map((row) => ({ name: row.name, lastSeenAt: row.last_seen_at })),
  };
}

const plain = new Intl.NumberFormat('ko-KR');

function num(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : plain.format(value);
}

// FR-UI-008 again: `?? 0` inside a formatter is the easy way to turn "never
// observed" into a confident zero, and it reads as harmless every time.
//
// Exact, not compact. The overview compacts because it is showing a total
// across a hundred members and the magnitude is the message; here the number
// IS the subject, and 1,009,489,473 rendered as "1B" throws away the part
// someone came to this page to read.

const CONTRIBUTION_LABELS: [string, string][] = [
  ['daily_donation_score', TERMS.dailyDonation],
  ['weekly_donation_score', TERMS.weeklyDonation],
  ['duel_daily_score', TERMS.duelDaily],
  ['duel_weekly_score', TERMS.duelWeekly],
  ['duel_round_score', TERMS.duelRound],
];

export function PlayerPage({ playerId, now }: { playerId: string; now?: Date }) {
  const { signedIn, isFavourite, toggle } = useFavourites();
  const { data, error, isPending } = useQuery({
    queryKey: ['player', playerId],
    queryFn: () => fetchPlayer(playerId),
  });

  if (isPending) {
    return (
      <main>
        <p className="empty">Loading…</p>
      </main>
    );
  }
  if (error) {
    return (
      <main>
        <p className="error">Could not load the player: {error.message}</p>
      </main>
    );
  }
  if (data === null || data === undefined) {
    // Not "no data yet": the address named a player we have never observed,
    // which is a different thing and a plain 404 rather than a hint to go
    // and capture something.
    return (
      <main>
        <p className="empty">No player with that id. It may never have been observed.</p>
      </main>
    );
  }

  const label = data.name ?? `UID ${data.gameUid}`;
  return (
    <main>
      <section aria-labelledby="player-heading">
        <h2 id="player-heading">
          {signedIn && (
            <FavouriteButton
              id={data.playerId}
              isFavourite={isFavourite('player', data.playerId)}
              kind="player"
              label={label}
              onToggle={toggle}
            />
          )}
          {label}
          <span className="subtle">
            {' · '}
            <a href={serverHash(data.serverId)}>server {data.serverId}</a>
            {data.allianceId && (
              <>
                {' · '}
                <a href={allianceHash(data.allianceId)}>
                  {data.allianceCode ? `[${data.allianceCode}] ` : ''}
                  {data.allianceName ?? 'alliance'}
                </a>
              </>
            )}
          </span>
        </h2>

        <div className="stats">
          <StatTile hero label={TERMS.power} value={num(data.power)} />
          <StatTile label={TERMS.hq} value={num(data.hqLevel)} />
          <StatTile label={TERMS.kills} value={num(data.kills)} />
          <StatTile
            label={TERMS.lastOnline}
            value={formatLastOnline(data.onlineState, data.offlineSince, now ?? new Date())}
          />
        </div>
        <p className="subtle">
          UID {data.gameUid} · {TERMS.lastSeen}{' '}
          <FreshnessBadge capturedAt={data.lastSeenAt} now={now} />
        </p>
      </section>

      <section aria-labelledby="player-contribution">
        <h2 id="player-contribution">Contribution</h2>
        {data.contributions === null ? (
          <p className="empty">
            Donation and duel figures are alliance-only. <a href="#/login">Sign in</a> to see them.
          </p>
        ) : (
          <div className="stats">
            {CONTRIBUTION_LABELS.map(([key, text]) => (
              <StatTile key={key} label={text} value={num(data.contributions?.[key])} />
            ))}
          </div>
        )}
      </section>

      {data.componentPower.length > 0 && (
        <section aria-labelledby="player-component">
          <h2 id="player-component">Power breakdown</h2>
          <div className="stats">
            {data.componentPower.map((row) => (
              <StatTile
                key={row.metric}
                label={row.metric.replaceAll('_', ' ')}
                note={row.rank === null ? undefined : `rank ${row.rank}`}
                value={num(row.power)}
              />
            ))}
          </div>
        </section>
      )}

      {data.pastNames.length > 0 && (
        <section aria-labelledby="player-names">
          <h2 id="player-names">Also known as</h2>
          {/* The reason player_names exists: a name is not an identity, and
              someone looking for a player who renamed has nothing else. */}
          <p>
            {data.pastNames.map((row) => (
              <span className="badge" key={row.name}>
                {row.name}
              </span>
            ))}
          </p>
        </section>
      )}
    </main>
  );
}
