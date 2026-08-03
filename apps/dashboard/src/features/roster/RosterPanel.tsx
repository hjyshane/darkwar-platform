import { useQuery } from '@tanstack/react-query';
import { FormulaError, evaluateFormula, parseFormula } from '../../lib/formula';
import { MEMBER_FIELD_IDS, MEMBER_FORMULAS_KEY } from '../../lib/memberFormulas';
import { resolveFormulas } from '../../lib/overviewMetrics';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
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

/** Three queries rather than an embedded select.
 *
 * Contribution moved to its own member-only table in 0020 and presence in
 * 0024, so both are a join away. Fetching them separately keeps the shape
 * flat — the sort and search work on top-level keys, and a nested object
 * would silently stop being sortable — and it makes the permission boundary
 * obvious: logged out, those queries return nothing because RLS filters
 * every row, and the merge leaves the columns null. The table already
 * renders null as "—", which is the honest answer: not zero, not hidden,
 * just not visible to you.
 */
/** Exported so the admin's formula preview can run against a real member
 * rather than a second, drifting copy of this join. */
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
      'player_id, game_uid, current_name, hq_level, power, kills, last_seen_at, alliances!players_current_alliance_id_fkey!inner(is_own)',
    )
    .eq('alliances.is_own', true)
    .order('power', { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) {
    throw new Error(`roster query failed: ${error.message}`);
  }

  const { data: contributions, error: contributionError } = await supabase
    .from('player_contributions')
    .select(
      'player_id, daily_donation_score, weekly_donation_score, duel_daily_score, duel_weekly_score, duel_round_score',
    )
    .in(
      'player_id',
      players.map((player) => player.player_id),
    );
  if (contributionError) {
    throw new Error(`contribution query failed: ${contributionError.message}`);
  }

  const { data: presence, error: presenceError } = await supabase
    .from('player_presence')
    .select('player_id, online_state, offline_since, observed_at')
    .in(
      'player_id',
      players.map((player) => player.player_id),
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
      players.map((player) => player.player_id),
    );
  if (growthError) {
    throw new Error(`growth query failed: ${growthError.message}`);
  }

  // Both halves of a rank — what an admin set and what the last period
  // worked out — from the one member-only view, so a reader never sees one
  // without the other (0059).
  const { data: ranks, error: rankError } = await supabase
    .from('player_current_rank')
    .select('player_id, assigned_rank, computed_tier, rank_score')
    .in(
      'player_id',
      players.map((player) => player.player_id),
    );
  // Not fatal. Ranks are member-only, so a logged-out reader gets nothing
  // here and should still see the roster — the same reason the contribution
  // columns render as dashes rather than an error.
  if (rankError && rankError.code !== '42501') {
    throw new Error(`rank query failed: ${rankError.message}`);
  }

  const byPlayer = new Map(contributions.map((row) => [row.player_id, row]));
  const rankByPlayer = new Map((ranks ?? []).map((row) => [row.player_id, row]));
  const growthByPlayer = new Map(growth.map((row) => [row.player_id, row]));
  const presenceByPlayer = new Map(presence.map((row) => [row.player_id, row]));
  // `alliances` is the join used to filter, not a column of the row — drop it
  // so the shape stays flat and every key remains sortable.
  return players.map(({ alliances: _joined, ...player }) => ({
    ...player,
    daily_donation_score: byPlayer.get(player.player_id)?.daily_donation_score ?? null,
    weekly_donation_score: byPlayer.get(player.player_id)?.weekly_donation_score ?? null,
    duel_daily_score: byPlayer.get(player.player_id)?.duel_daily_score ?? null,
    duel_weekly_score: byPlayer.get(player.player_id)?.duel_weekly_score ?? null,
    duel_round_score: byPlayer.get(player.player_id)?.duel_round_score ?? null,
    assigned_rank: rankByPlayer.get(player.player_id)?.assigned_rank ?? null,
    computed_rank: rankByPlayer.get(player.player_id)?.computed_tier ?? null,
    rank_score: rankByPlayer.get(player.player_id)?.rank_score ?? null,
    growth_1d: growthByPlayer.get(player.player_id)?.growth_1d ?? null,
    growth_7d: growthByPlayer.get(player.player_id)?.growth_7d ?? null,
    growth_1d_at: growthByPlayer.get(player.player_id)?.power_1d_at ?? null,
    growth_7d_at: growthByPlayer.get(player.player_id)?.power_7d_at ?? null,
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
      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load members: {error.message}</p>}
      {data && <RosterTable columns={columns ?? []} rows={data} />}
    </section>
  );
}
