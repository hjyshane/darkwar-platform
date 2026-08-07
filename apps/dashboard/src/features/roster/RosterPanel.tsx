import { useQuery } from '@tanstack/react-query';
import { FormulaError, evaluateFormula, parseFormula } from '../../lib/formula';
import { MEMBER_FIELD_IDS, MEMBER_FORMULAS_KEY } from '../../lib/memberFormulas';
import { resolveFormulas } from '../../lib/overviewMetrics';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
import { RankMovement } from './RankMovement';
import { type ComputedColumn, type RosterRow, RosterTable } from './RosterTable';

/** The columns an admin described, parsed once here.
 *
 * Parsed rather than stored as a tree: a formula is text in a settings row,
 * and it can be made invalid after it was written — by a figure going away
 * rather than by anybody editing it. One that no longer parses is dropped,
 * so a bad expression costs its own column and not the whole table.
 */
async function fetchMemberColumns(): Promise<ComputedColumn[]> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', MEMBER_FORMULAS_KEY)
    .maybeSingle();
  if (error) {
    throw new Error(`member formula query failed: ${error.message}`);
  }
  return resolveFormulas((data?.value as { formulas?: unknown } | null)?.formulas).flatMap(
    (formula) => {
      try {
        const tree = parseFormula(formula.expression, MEMBER_FIELD_IDS);
        return [
          {
            id: formula.id,
            label: formula.label,
            compact: formula.compact,
            evaluate: (values: Record<string, number | null>) => evaluateFormula(tree, values),
          },
        ];
      } catch (parseError) {
        if (parseError instanceof FormulaError) {
          return [];
        }
        throw parseError;
      }
    },
  );
}

export type DepartureRow = {
  game_uid: number;
  player_id: string | null;
  last_known_name: string | null;
  last_member_rank: number | null;
  last_hq_level: number | null;
  last_power: number | null;
  last_seen_in_alliance_at: string;
  roster_captured_at: string;
  confirmed: boolean | null;
};

/** Our alliance's id, looked up rather than embedded.
 *
 * The roster query embeds `alliances!inner(is_own)` because players has a
 * foreign key to it. A view has none, so PostgREST cannot embed against
 * these two — the id has to come first and be passed as a filter.
 */
async function fetchOwnAllianceId(): Promise<string | null> {
  const { data, error } = await supabase
    .from('alliances')
    .select('alliance_id')
    .eq('is_own', true)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (error.code === '42501') {
      return null;
    }
    throw new Error(`own alliance query failed: ${error.message}`);
  }
  return data?.alliance_id ?? null;
}

/** Who is in the alliance right now, by player_id.
 *
 * `players.current_alliance_id` is set and never cleared, so it answers "was
 * ever in this alliance". 0067 derives the real answer from the newest
 * al.rank batch, which is the whole roster in one response.
 *
 * Returns null, not an empty set, when the view yields nothing — a viewer and
 * a signed-out reader both get no rows, and treating that as "the alliance is
 * empty" would replace a roster of stale names with no roster at all. Null
 * means "no opinion", and the caller leaves the list alone.
 */
async function fetchCurrentMembers(): Promise<Map<string, number | null> | null> {
  const allianceId = await fetchOwnAllianceId();
  if (allianceId === null) {
    return null;
  }
  // `member_rank` comes down with the membership answer rather than in a query of
  // its own: this view is already the one that says who is in, and the in-game rank
  // is a fact of the same roster capture.
  //
  // THE GAME'S RANK, not `assigned_rank`. That one is what an admin typed into the
  // dashboard and is null for most of the roster; this is what the member list
  // itself reported, for all 94.
  const { data, error } = await supabase
    .from('alliance_roster_latest')
    .select('player_id, member_rank')
    .eq('alliance_id', allianceId);
  if (error) {
    // Not fatal, same rule as the rank query below: a permission failure
    // must not take the roster down with it.
    if (error.code === '42501') {
      return null;
    }
    throw new Error(`current roster query failed: ${error.message}`);
  }
  const found = new Map<string, number | null>();
  for (const row of data) {
    if (row.player_id !== null) {
      found.set(row.player_id as string, (row.member_rank as number | null) ?? null);
    }
  }
  return found.size === 0 ? null : found;
}

/** Members seen before but absent from the newest capture.
 *
 * `confirmed` is false when that capture did not cover the whole roster —
 * an unscrolled member list looks exactly like a departure, and six of this
 * alliance's ten captured batches are short by one or two.
 */
export async function fetchDepartures(): Promise<DepartureRow[]> {
  const allianceId = await fetchOwnAllianceId();
  if (allianceId === null) {
    return [];
  }
  const { data, error } = await supabase
    .from('alliance_departures')
    .select(
      'game_uid, player_id, last_known_name, last_member_rank, last_hq_level, last_power, last_seen_in_alliance_at, roster_captured_at, confirmed',
    )
    .eq('alliance_id', allianceId)
    .order('last_seen_in_alliance_at', { ascending: false })
    .limit(100);
  if (error) {
    if (error.code === '42501') {
      return [];
    }
    throw new Error(`departure query failed: ${error.message}`);
  }
  return data as DepartureRow[];
}

/** Several queries rather than one embedded select.
 *
 * Contribution moved to its own member-only table in 0020 and presence in
 * 0024, so both are a join away. Fetching them separately keeps the shape
 * flat — the sort and search work on top-level keys, and a nested object
 * would silently stop being sortable — and it makes the permission boundary
 * obvious: logged out, those queries return nothing because RLS filters every
 * row, and the merge leaves the columns null. The table already renders null
 * as "—", which is the honest answer: not zero, not hidden, just not visible
 * to you.
 *
 * Exported so the admin's formula preview can run against a real member
 * rather than a second, drifting copy of this join.
 */
export async function fetchRoster(): Promise<RosterRow[]> {
  // Our alliance's members, not the strongest players we have ever seen.
  //
  // `players` accumulates everyone the collector observes — cross-server
  // boards, kill rankings, other servers' arena entries. Against real data
  // that is 557 rows to 93 members, and our members are not the strongest of
  // them: they ranked 91st to 557th by power, so an unfiltered top 50
  // contained no member at all and every contribution column rendered "—"
  // even for a signed-in officer. Six mock players, all members, hid it.
  //
  // 0031 marks the alliance from al.rank's redaction behaviour rather than a
  // configured id; `alliances` is world-readable so this still works logged
  // out, which is why the filter is here and not on the member-only roster
  // snapshot table.
  const { data: players, error } = await supabase
    .from('players')
    // The foreign key has to be named: players and alliances are related
    // twice (players.current_alliance_id, and alliances.leader_player_id
    // pointing back), and PostgREST refuses an ambiguous embed with PGRST201
    // rather than picking one.
    .select(
      // No game_uid. The column is off the screen and out of the search
      // fields, so fetching it would only mean shipping an identifier to a
      // browser that has no use for it. No formula reads it either — the
      // picker's fields are all figures.
      'player_id, current_name, hq_level, power, kills, last_seen_at, alliances!players_current_alliance_id_fkey!inner(is_own)',
    )
    .eq('alliances.is_own', true)
    .order('power', { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) {
    throw new Error(`roster query failed: ${error.message}`);
  }

  // Drop the people who have left. The filter is here rather than in the
  // query because the membership answer lives in a view that has no foreign
  // key to embed against, and because "no opinion" has to be distinguishable
  // from "nobody is a member" — see fetchCurrentMembers.
  const current = await fetchCurrentMembers();
  const members =
    current === null ? players : players.filter((player) => current.has(player.player_id));

  const { data: contributions, error: contributionError } = await supabase
    .from('player_contributions')
    .select(
      'player_id, daily_donation_score, weekly_donation_score, duel_daily_score, duel_weekly_score, duel_round_score',
    )
    .in(
      'player_id',
      members.map((player) => player.player_id),
    );
  if (contributionError) {
    throw new Error(`contribution query failed: ${contributionError.message}`);
  }

  const { data: presence, error: presenceError } = await supabase
    .from('player_presence')
    .select('player_id, online_state, offline_since, observed_at')
    .in(
      'player_id',
      members.map((player) => player.player_id),
    );
  if (presenceError) {
    throw new Error(`presence query failed: ${presenceError.message}`);
  }

  // Which way each member's power has moved. A view rather than a fourth
  // shape to assemble here: the answer is a question about two rows of
  // player_snapshots, and the database is where that belongs (0049).
  const { data: growth, error: growthError } = await supabase
    .from('player_power_growth')
    .select('player_id, growth_1d, growth_7d, power_1d_at, power_7d_at')
    .in(
      'player_id',
      members.map((player) => player.player_id),
    );
  if (growthError) {
    throw new Error(`growth query failed: ${growthError.message}`);
  }

  // The fallback for members the fixed baselines cannot describe.
  //
  // `player_power_growth` measures against 02:05 UTC a day and a week back
  // (0055), so a member whose first capture was yesterday afternoon has no 1d
  // baseline and shows a dash — which on a young database is most of the
  // roster. `player_growth_recent` (0069) compares against the previous
  // reading whatever the interval was, and carries that reading's timestamp so
  // the column can say what it measured from.
  const { data: recent, error: recentError } = await supabase
    .from('player_growth_recent')
    .select('player_id, growth_since_last, power_prev_at')
    .in(
      'player_id',
      members.map((player) => player.player_id),
    );
  if (recentError && recentError.code !== '42501') {
    throw new Error(`recent growth query failed: ${recentError.message}`);
  }

  // Both halves of a rank — what an admin set and what the last period
  // worked out — from the one member-only view, so a reader never sees one
  // without the other (0059).
  const { data: ranks, error: rankError } = await supabase
    .from('player_current_rank')
    .select('player_id, assigned_rank, computed_tier, rank_score')
    .in(
      'player_id',
      members.map((player) => player.player_id),
    );
  // Not fatal. Ranks are member-only, so a logged-out reader gets nothing
  // here and should still see the roster — the same reason the contribution
  // columns render as dashes rather than an error.
  if (rankError && rankError.code !== '42501') {
    throw new Error(`rank query failed: ${rankError.message}`);
  }

  // What people are paying for, for officers and admins. A member's request is
  // filtered to zero rows by RLS (0092) rather than refused, so this is not an
  // error path — an empty answer IS the answer for most readers, and the table
  // leaves the columns out when it gets one.
  const { data: subscriptions, error: subscriptionError } = await supabase
    .from('player_subscriptions')
    .select('player_id, month_card_expires_at, vip_level, vip_expires_at, svip_level')
    .in(
      'player_id',
      members.map((player) => player.player_id),
    );
  // 42501 is a signed-out reader, who has no grant at all. Also not fatal: the
  // roster is the point of the screen and this is a detail on it.
  if (subscriptionError && subscriptionError.code !== '42501') {
    throw new Error(`subscription query failed: ${subscriptionError.message}`);
  }

  const byPlayer = new Map(contributions.map((row) => [row.player_id, row]));
  const subscriptionByPlayer = new Map((subscriptions ?? []).map((row) => [row.player_id, row]));
  const rankByPlayer = new Map((ranks ?? []).map((row) => [row.player_id, row]));
  const growthByPlayer = new Map(growth.map((row) => [row.player_id, row]));
  const recentByPlayer = new Map((recent ?? []).map((row) => [row.player_id, row]));
  const presenceByPlayer = new Map(presence.map((row) => [row.player_id, row]));
  // `alliances` is the join used to filter, not a column of the row — drop it
  // so the shape stays flat and every key remains sortable.
  return members.map(({ alliances: _joined, ...player }) => ({
    ...player,
    daily_donation_score: byPlayer.get(player.player_id)?.daily_donation_score ?? null,
    weekly_donation_score: byPlayer.get(player.player_id)?.weekly_donation_score ?? null,
    duel_daily_score: byPlayer.get(player.player_id)?.duel_daily_score ?? null,
    duel_weekly_score: byPlayer.get(player.player_id)?.duel_weekly_score ?? null,
    duel_round_score: byPlayer.get(player.player_id)?.duel_round_score ?? null,
    // The in-game rank the member list reported, which is what the table groups
    // by. Null when the roster answer was unavailable — a logged-out reader gets no
    // groups rather than a wrong one.
    member_rank: current?.get(player.player_id) ?? null,
    assigned_rank: rankByPlayer.get(player.player_id)?.assigned_rank ?? null,
    computed_rank: rankByPlayer.get(player.player_id)?.computed_tier ?? null,
    rank_score: rankByPlayer.get(player.player_id)?.rank_score ?? null,
    // The day figure falls back to "since the previous reading" when there is
    // no day-old baseline. Not a silent substitution: `growth_1d_at` carries
    // the timestamp it actually measured from either way, and the column
    // renders that, so a figure over six hours does not read as a day's.
    growth_1d:
      growthByPlayer.get(player.player_id)?.growth_1d ??
      recentByPlayer.get(player.player_id)?.growth_since_last ??
      null,
    growth_7d: growthByPlayer.get(player.player_id)?.growth_7d ?? null,
    growth_1d_at:
      growthByPlayer.get(player.player_id)?.power_1d_at ??
      recentByPlayer.get(player.player_id)?.power_prev_at ??
      null,
    growth_7d_at: growthByPlayer.get(player.player_id)?.power_7d_at ?? null,
    month_card_expires_at:
      subscriptionByPlayer.get(player.player_id)?.month_card_expires_at ?? null,
    vip_level: subscriptionByPlayer.get(player.player_id)?.vip_level ?? null,
    vip_expires_at: subscriptionByPlayer.get(player.player_id)?.vip_expires_at ?? null,
    svip_level: subscriptionByPlayer.get(player.player_id)?.svip_level ?? null,
    ...lastOnline(presenceByPlayer.get(player.player_id)),
  }));
}

type PresenceRow = {
  online_state: string | null;
  offline_since: string | null;
  observed_at: string;
};

/** Collapse presence to one sortable instant.
 *
 * Sorting on offline_since alone would be backwards: it is null for players
 * who are online, and the sort puts nulls last, so the people playing right
 * now would sink below everyone who left days ago. For someone online the
 * last moment we know they were there is observed_at — the snapshot that
 * said so — so that is what the column means: last known to be online.
 */
function lastOnline(presence: PresenceRow | undefined) {
  if (presence === undefined || presence.online_state === null) {
    return { online_state: null, last_online_at: null };
  }
  return {
    online_state: presence.online_state,
    last_online_at:
      presence.online_state === 'online' ? presence.observed_at : presence.offline_since,
  };
}

export function RosterPanel() {
  const { data, error, isPending } = useQuery({ queryKey: ['roster'], queryFn: fetchRoster });
  const { data: columns } = useQuery({
    queryKey: ['member-formulas'],
    queryFn: fetchMemberColumns,
  });
  const { data: session } = useSession();
  const restricted = session !== undefined && session.role === 'viewer';
  return (
    <section aria-labelledby="roster-heading">
      <h2 id="roster-heading">{TERMS.members}</h2>
      {/* Without this the contribution columns are just full of em dashes,
          which elsewhere in this app means "never observed". Here it means
          "not yours to see", and those are different enough that saying so
          is the whole point (FR-UI-008). */}
      {restricted && (
        <p className="empty">
          Donation and duel figures are alliance-only.{' '}
          {session?.email ? (
            <>
              This account is a viewer — <a href="#/login">redeem an invitation code</a> to see
              them.
            </>
          ) : (
            <>
              <a href="#/login">Sign in</a> to see them.
            </>
          )}
        </p>
      )}
      {/* Above the table, because "who moved" is what an officer opens this screen
          for and the table below answers "where does everybody stand". Renders
          nothing at all for a reader who cannot see rank figures. */}
      <RankMovement />
      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load members: {error.message}</p>}
      {data && <RosterTable columns={columns ?? []} rows={data} />}
    </section>
  );
}
