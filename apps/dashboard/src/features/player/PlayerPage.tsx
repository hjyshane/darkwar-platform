import { useQuery } from '@tanstack/react-query';
import { FavouriteButton } from '../../components/FavouriteButton';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { StatTile } from '../../components/StatTile';
import { leagueLabel } from '../../lib/arenaLeague';
import { formatLastOnline } from '../../lib/freshness';
import { allianceHash, serverHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useFavourites } from '../../lib/useFavourites';
import { LineupCell } from '../arena/LineupCell';
import { LineupLegend } from '../arena/LineupLegend';
import { fetchLineups } from '../arena/lineups';
import { MemberHistory } from './MemberHistory';
import {
  type PlayerArenaEntry,
  growthNote,
  growthTone,
  newestPerLeague,
  percent,
} from './playerArena';

/** One player, gathered from every table that knows something about them.
 *
 * Small separate queries rather than one embedded select. They sit behind
 * different boundaries — players, component power and the arena board are
 * world-readable; contribution, presence, rank and growth are member-only —
 * and a single embed would fail the whole page for a logged-out reader
 * instead of returning the public part. That is the same reason RosterPanel
 * splits its three.
 *
 * Two different "you cannot see this" are in play and must not be confused:
 *
 *   - **RLS** decides whether a READER may see a member-only figure. A
 *     logged-out reader gets nothing and the block says so.
 *   - **is_own** decides whether the figure APPLIES to this player at all.
 *     Donation and duel scores are our alliance's; for someone in another
 *     alliance they do not exist, and offering to sign in would promise
 *     something signing in cannot deliver.
 *
 * So the alliance blocks are gated on is_own, and the sign-in hint lives
 * inside them.
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
  /** Whether this player is in OUR alliance, which decides whether the
   * alliance-internal blocks are on this page at all. Not a permission —
   * RLS decides that — but the difference between "you cannot see this"
   * and "this does not apply to them". */
  isOwnAlliance: boolean;
  hqLevel: number | null;
  power: number | null;
  kills: number | null;
  lastSeenAt: string | null;
  onlineState: string | null;
  offlineSince: string | null;
  observedAt: string | null;
  contributions: Record<string, number | null> | null;
  rank: { assigned: string | null; computed: string | null; score: number | null } | null;
  growth: {
    growth1d: number | null;
    growth7d: number | null;
    power1dAt: string | null;
    power7dAt: string | null;
  } | null;
  /** Growth against the previous reading, whatever interval that was.
   *
   * The 1d/7d figures above are measured from a fixed 02:05 UTC baseline
   * (0055), which suits our own members because they are captured on a
   * schedule. Anyone else is seen only when somebody opens their profile, so
   * both of those are null and the page showed dashes for a player we have
   * two readings of. */
  recentGrowth: {
    growthSinceLast: number | null;
    powerPrev: number | null;
    powerPrevAt: string | null;
    powerAt: string | null;
  } | null;
  componentPower: { metric: string; power: number | null; rank: number | null }[];
  arena: PlayerArenaEntry[];
  pastNames: { name: string; lastSeenAt: string }[];
}

async function fetchPlayerArena(playerId: string): Promise<PlayerArenaEntry[]> {
  const { data: entries, error } = await supabase
    .from('arena_entries')
    .select('snapshot_id, arena_snapshot_id, rank, score, defense_power')
    .eq('player_id', playerId)
    .order('captured_at', { ascending: false })
    .limit(50);
  if (error) {
    throw new Error(`arena entry query failed: ${error.message}`);
  }
  if (entries.length === 0) {
    return [];
  }

  // Two queries and a client-side reduction rather than an embed: the page's
  // whole shape is "several small queries behind different boundaries", and
  // an embed on arena_entries -> arena_snapshots would be one more place for
  // PGRST201 to appear the day a second relationship is added.
  const { data: boards, error: boardError } = await supabase
    .from('arena_snapshots')
    .select('snapshot_id, league, week_start, captured_at')
    .in('snapshot_id', [...new Set(entries.map((entry) => entry.arena_snapshot_id))]);
  if (boardError) {
    throw new Error(`arena board query failed: ${boardError.message}`);
  }

  const chosen = newestPerLeague(entries, boards);
  const lineups = await fetchLineups(chosen.map((entry) => entry.entryId));
  return chosen.map((entry) => ({ ...entry, lineup: lineups.get(entry.entryId) ?? [] }));
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

  const [alliance, presence, contributions, component, names, rank, growth, recent, arena] =
    await Promise.all([
      player.current_alliance_id
        ? supabase
            .from('alliances')
            .select('alliance_id, current_name, current_code, is_own')
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
      // Member-only, and a logged-out reader must still get the rest of the
      // page. The roster treats 42501 the same way, for the same reason.
      supabase
        .from('player_current_rank')
        .select('assigned_rank, computed_tier, rank_score')
        .eq('player_id', playerId)
        .maybeSingle(),
      supabase
        .from('player_power_growth')
        .select('growth_1d, growth_7d, power_1d_at, power_7d_at')
        .eq('player_id', playerId)
        .maybeSingle(),
      // The fallback the fixed baselines cannot provide (0069). Fetched for
      // everyone rather than only when the others are null: it is one row,
      // and branching the query on the result of another query would make
      // this page two round trips deep for no benefit.
      supabase
        .from('player_growth_recent')
        .select('growth_since_last, power_prev, power_prev_at, power_at')
        .eq('player_id', playerId)
        .maybeSingle(),
      fetchPlayerArena(playerId),
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
    isOwnAlliance: alliance.data?.is_own ?? false,
    hqLevel: player.hq_level,
    power: player.power,
    kills: player.kills,
    lastSeenAt: player.last_seen_at,
    onlineState: presence.data?.online_state ?? null,
    offlineSince: presence.data?.offline_since ?? null,
    observedAt: presence.data?.observed_at ?? null,
    contributions: contributions.data ?? null,
    rank: rank.data
      ? {
          assigned: rank.data.assigned_rank,
          computed: rank.data.computed_tier,
          score: rank.data.rank_score,
        }
      : null,
    growth: growth.data
      ? {
          growth1d: growth.data.growth_1d,
          growth7d: growth.data.growth_7d,
          power1dAt: growth.data.power_1d_at,
          power7dAt: growth.data.power_7d_at,
        }
      : null,
    recentGrowth: recent.data
      ? {
          growthSinceLast: recent.data.growth_since_last,
          powerPrev: recent.data.power_prev,
          powerPrevAt: recent.data.power_prev_at,
          powerAt: recent.data.power_at,
        }
      : null,
    componentPower,
    arena,
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

      {/* Alliance-internal blocks, and only for our own members.
       *
       * RLS is what stops an outsider READING these; this decides whether
       * they belong on the page at all. Rendering "sign in to see donation"
       * on a player from another alliance promises something signing in
       * would not deliver — those figures do not exist for them, and never
       * will. */}
      {data.isOwnAlliance && (
        <>
          <section aria-labelledby="player-contribution">
            <h2 id="player-contribution">Contribution</h2>
            {data.contributions === null ? (
              <p className="empty">
                Donation and duel figures are alliance-only. <a href="#/login">Sign in</a> to see
                them.
              </p>
            ) : (
              <div className="stats">
                {CONTRIBUTION_LABELS.map(([key, text]) => (
                  <StatTile key={key} label={text} value={num(data.contributions?.[key])} />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="player-history">
            <h2 id="player-history">Roster history</h2>
            {/* Own-or-officer (0066), which is narrower than everything else
                on this page. The component says which of the three empty
                cases applies rather than leaving a bare table. */}
            <MemberHistory now={now} playerId={data.playerId} />
          </section>

          {(data.rank !== null || data.growth !== null) && (
            <section aria-labelledby="player-standing">
              <h2 id="player-standing">Standing</h2>
              <div className="stats">
                <StatTile label={TERMS.rank} value={data.rank?.assigned ?? null} />
                <StatTile
                  label="Computed tier"
                  note={data.rank?.score === null ? undefined : `score ${data.rank?.score}`}
                  value={data.rank?.computed ?? null}
                />
                {/* Coloured, unlike the level tiles above them. A delta has a
                    direction and these three are the only tiles here that do;
                    the sign is still in the text, so the hue is reinforcement
                    rather than the message. */}
                <StatTile
                  label="Power 1d"
                  note={growthNote(data.growth?.power1dAt ?? null)}
                  tone={growthTone(data.growth?.growth1d)}
                  value={percent(data.growth?.growth1d)}
                />
                <StatTile
                  label="Power 7d"
                  note={growthNote(data.growth?.power7dAt ?? null)}
                  tone={growthTone(data.growth?.growth7d)}
                  value={percent(data.growth?.growth7d)}
                />
                {/* Only when neither fixed baseline could answer. Showing all
                    three would put "grew 2% since some unspecified moment"
                    next to "grew 2% in a day" and invite reading them as the
                    same claim — the interval one is strictly better when it
                    exists, so this fills a gap rather than adding a column.
                    The gap is everyone outside our own alliance, who is
                    captured when somebody opens their profile and never on a
                    schedule. */}
                {data.growth?.growth1d == null && data.growth?.growth7d == null && (
                  <StatTile
                    label="Since last reading"
                    note={growthNote(data.recentGrowth?.powerPrevAt ?? null)}
                    tone={growthTone(data.recentGrowth?.growthSinceLast)}
                    value={percent(data.recentGrowth?.growthSinceLast)}
                  />
                )}
              </div>
            </section>
          )}
        </>
      )}

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

      {data.arena.length > 0 && (
        <section aria-labelledby="player-arena">
          <h2 id="player-arena">{TERMS.arena}</h2>
          {data.arena.map((entry) => (
            <div key={entry.entryId}>
              <h3>
                {leagueLabel(entry.league)}{' '}
                <span className="subtle">
                  Week {new Date(entry.weekStart).toISOString().slice(0, 10)}
                </span>{' '}
                {/* The board is captured weekly, so it is stale by design for
                    most of the week. It says when rather than hiding — the
                    lineup from four days ago is still the lineup. */}
                <FreshnessBadge capturedAt={entry.capturedAt} now={now} />
              </h3>
              <div className="stats">
                <StatTile label={TERMS.rank} value={num(entry.rank)} />
                <StatTile label={TERMS.score} value={num(entry.score)} />
                <StatTile label={TERMS.defensePower} value={num(entry.defensePower)} />
              </div>
              {entry.lineup.length === 0 ? (
                // An entry with no `army` is not an entry with an empty
                // defence — the payload simply carried no lineup.
                <p className="empty">No lineup was captured with this entry.</p>
              ) : (
                <>
                  <LineupLegend />
                  {/* Open on arrival. This page shows at most three entries
                      and the reader navigated here for them; the disclosure
                      also expanded below the fold with nothing scrolling to
                      follow it, so the content appeared not to be there. */}
                  <LineupCell defaultOpen heroes={entry.lineup} />
                </>
              )}
            </div>
          ))}
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
