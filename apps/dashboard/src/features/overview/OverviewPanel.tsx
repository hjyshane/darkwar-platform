import { useQuery } from '@tanstack/react-query';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { StatTile } from '../../components/StatTile';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
import { FavouritesBlock } from './FavouritesBlock';

/** The landing screen: where the alliance stands, before who did what.
 *
 * The summary below is the first block on it and deliberately not the last —
 * this panel is a list of sections so the next one lands underneath without
 * anything being rearranged.
 *
 * Three queries rather than one view. Each sits behind a different boundary:
 * `alliances` is world-readable, `players` is world-readable, and
 * contribution is member-only (0020). Keeping them apart is what lets a
 * logged-out reader get the public half instead of an error — and lets the
 * tiles say "—" for the half they cannot see, rather than zero.
 */
export interface OverviewSummary {
  allianceName: string | null;
  allianceCode: string | null;
  /** How many alliances are marked as ours. More than one means the
   *  heading cannot name them and the figures are a sum across all. */
  allianceCount: number;
  serverIds: number[];
  members: number | null;
  totalPower: number | null;
  online: number | null;
  weeklyDonation: number | null;
  duelRound: number | null;
  rosterObservedAt: string | null;
}

async function fetchSummary(): Promise<OverviewSummary> {
  const { data: alliances, error: allianceError } = await supabase
    .from('alliances')
    .select('alliance_id, current_name, current_code, server_id')
    .eq('is_own', true);
  if (allianceError) {
    throw new Error(`alliance query failed: ${allianceError.message}`);
  }

  // Power is summed from the players we have actually observed, not read off
  // alliances.power. The two disagree by design: the alliance figure is what
  // the game reports for the whole roster, ours is the sum of the members a
  // capture has seen. Reporting the game's number beside a member count that
  // came from somewhere else would put two different populations in one row.
  const ids = alliances.map((row) => row.alliance_id);
  const { data: players, error: playerError } = await supabase
    .from('players')
    .select('player_id, power, roster_observed_at')
    .in('current_alliance_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
  if (playerError) {
    throw new Error(`member query failed: ${playerError.message}`);
  }

  const { data: presence, error: presenceError } = await supabase
    .from('player_presence')
    .select('player_id, online_state');
  if (presenceError) {
    throw new Error(`presence query failed: ${presenceError.message}`);
  }

  const { data: contributions, error: contributionError } = await supabase
    .from('player_contributions')
    .select('player_id, weekly_donation_score, duel_round_score');
  if (contributionError) {
    throw new Error(`contribution query failed: ${contributionError.message}`);
  }

  const memberIds = new Set(players.map((row) => row.player_id));
  const sum = (values: (number | null)[]) => {
    const known = values.filter((value): value is number => value !== null);
    // An empty set is not zero. RLS hands a logged-out reader no rows at
    // all, and "0 points donated" would be a claim we cannot make.
    return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
  };
  const ours = contributions.filter((row) => memberIds.has(row.player_id));

  return {
    // The figures below aggregate every alliance marked as ours, so the
    // heading has to as well. Naming alliances[0] would have been an
    // arbitrary pick presented as the answer — which is exactly the habit
    // that put a rank in the sticky column and right-aligned a name.
    allianceName: alliances.length === 1 ? (alliances[0]?.current_name ?? null) : null,
    allianceCode: alliances.length === 1 ? (alliances[0]?.current_code ?? null) : null,
    allianceCount: alliances.length,
    serverIds: [...new Set(alliances.map((row) => row.server_id))].sort((a, b) => a - b),
    members: players.length === 0 ? null : players.length,
    totalPower: sum(players.map((row) => row.power)),
    // Zero rows is "not visible to you", not "nobody is online" — RLS hands
    // a viewer an empty presence table, and 0 would be a claim.
    online:
      presence.length === 0
        ? null
        : presence.filter((row) => memberIds.has(row.player_id) && row.online_state === 'online')
            .length,
    weeklyDonation: sum(ours.map((row) => row.weekly_donation_score)),
    duelRound: sum(ours.map((row) => row.duel_round_score)),
    rosterObservedAt:
      players
        .map((row) => row.roster_observed_at)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1) ?? null,
  };
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('ko-KR');

function formatCompact(value: number | null): string | null {
  return value === null ? null : compact.format(value);
}

function formatPlain(value: number | null): string | null {
  return value === null ? null : plain.format(value);
}

export function OverviewPanel({ now }: { now?: Date }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['overview'],
    queryFn: fetchSummary,
  });
  const { data: session } = useSession();
  // Same wording as the roster: a dash means "never observed" everywhere
  // else in this app, so where it means "not yours to see" the tile has to
  // say which (FR-UI-008).
  const restricted = session !== undefined && session.role === 'viewer';

  return (
    <section aria-labelledby="overview-heading">
      <h2 id="overview-heading">
        {data?.allianceName ?? TERMS.overview}
        {data?.allianceCode && <span className="subtle"> · {data.allianceCode}</span>}
        {data && data.allianceCount > 1 && (
          <span className="subtle"> · {data.allianceCount} alliances</span>
        )}
        {data && data.serverIds.length > 0 && (
          <span className="subtle"> · server {data.serverIds.join(', ')}</span>
        )}
      </h2>

      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load the summary: {error.message}</p>}

      {data && data.members === null && (
        <p className="empty">
          No roster captured yet. Open the alliance member list in game with the collector running,
          and this fills in.
        </p>
      )}

      {data && data.members !== null && (
        <>
          <div className="stats">
            <StatTile
              hero
              label={TERMS.power}
              note={`summed over ${formatPlain(data.members)} observed ${TERMS.members.toLowerCase()}`}
              value={formatCompact(data.totalPower)}
            />
            <StatTile label={TERMS.members} value={formatPlain(data.members)} />
            <StatTile
              label="Online now"
              note={restricted ? 'alliance members only' : undefined}
              value={formatPlain(data.online)}
            />
            <StatTile
              label={TERMS.weeklyDonation}
              note={restricted ? 'alliance members only' : 'alliance total this week'}
              value={formatCompact(data.weeklyDonation)}
            />
            <StatTile
              label={TERMS.duelRound}
              note={restricted ? 'alliance members only' : 'alliance total, four rounds'}
              value={formatCompact(data.duelRound)}
            />
          </div>
          <p className="subtle">
            Roster last observed <FreshnessBadge capturedAt={data.rosterObservedAt} now={now} />
          </p>
        </>
      )}
    </section>
  );
}

/** The landing screen. Sections in reading order; the next one appends. */
export function Overview({ now }: { now?: Date }) {
  return (
    <>
      <OverviewPanel now={now} />
      <FavouritesBlock />
    </>
  );
}
