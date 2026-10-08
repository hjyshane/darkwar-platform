import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ExportButton } from '../../components/ExportButton';
import { StatTile } from '../../components/StatTile';
import { Tabs } from '../../components/ui/Tabs';
import { getActiveAlliance } from '../../lib/activeAlliance';
import { fetchAllianceSetting } from '../../lib/allianceSetting';
import type { CsvColumn } from '../../lib/csv';
import { FormulaError, evaluateFormula, parseFormula } from '../../lib/formula';
import { MEMBER_FIELD_IDS, MEMBER_FORMULAS_KEY } from '../../lib/memberFormulas';
import { resolveFormulas } from '../../lib/overviewMetrics';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
import { CurrentPeriodTable } from './CurrentPeriodTable';
import { RankMovement } from './RankMovement';
import { type ComputedColumn, type RosterRow, RosterTable } from './RosterTable';
import { rosterStrip } from './strip';

/** The columns an admin described, parsed once here.
 *
 * Parsed rather than stored as a tree: a formula is text in a settings row,
 * and it can be made invalid after it was written — by a figure going away
 * rather than by anybody editing it. One that no longer parses is dropped,
 * so a bad expression costs its own column and not the whole table.
 */
async function fetchMemberColumns(): Promise<ComputedColumn[]> {
  // The alliance on screen's columns (0200).
  const value = await fetchAllianceSetting(MEMBER_FORMULAS_KEY);
  return resolveFormulas((value as { formulas?: unknown } | null)?.formulas).flatMap((formula) => {
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
  });
}

/** What the members export carries. Month-card and VIP fields are left out:
 * the view blanks them below officer, so a file would be mostly empty cells
 * for most readers and a privacy question for the rest. */
const ROSTER_CSV: CsvColumn<RosterRow>[] = [
  { header: 'Name', value: (row) => row.current_name },
  { header: 'Game rank (R1-R5)', value: (row) => row.member_rank },
  { header: 'Assigned rank', value: (row) => row.assigned_rank },
  { header: 'Computed rank', value: (row) => row.computed_rank },
  { header: 'Rank score', value: (row) => row.rank_score },
  { header: 'HQ level', value: (row) => row.hq_level },
  { header: 'Power', value: (row) => row.power },
  { header: 'Growth 1d', value: (row) => row.growth_1d },
  { header: 'Growth 7d', value: (row) => row.growth_7d },
  { header: 'Kills', value: (row) => row.kills },
  { header: 'Daily donation', value: (row) => row.daily_donation_score },
  { header: 'Weekly donation', value: (row) => row.weekly_donation_score },
  { header: 'Duel daily', value: (row) => row.duel_daily_score },
  { header: 'Duel weekly', value: (row) => row.duel_weekly_score },
  { header: 'Duel round', value: (row) => row.duel_round_score },
  { header: 'Last online (UTC)', value: (row) => row.last_online_at },
  { header: 'Last seen (UTC)', value: (row) => row.last_seen_at },
];

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
export async function fetchOwnAllianceId(): Promise<string | null> {
  // The alliance being viewed, when one is chosen (0193). The lookup below
  // is the single-alliance answer, and it takes the first of several.
  const viewed = getActiveAlliance();
  if (viewed !== null) {
    return viewed;
  }
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

/** One query, because the round trip is the cost.
 *
 * This screen used to assemble its table from eight requests in three
 * dependent waves — roster ids, players, then six per-player reads. Every one
 * of them was milliseconds of database work behind ~150 ms of ocean (the
 * database is in us-east-2, the readers are not), so the waterfall WAS the
 * loading time. 0102 moved the join into `member_roster`, and with it the two
 * rules that lived up here: the growth fallback to since-the-previous-reading,
 * and the collapse of presence into one sortable instant.
 *
 * The permission boundaries did not move, they just changed clothes: a viewer
 * gets zero rows from the view's gate instead of from RLS row by row, and the
 * subscription columns come back null for anyone below officer because the
 * view CASE-gates them (0092), not because the client withheld them. The
 * table already renders null as "—", which remains the honest answer.
 *
 * Exported so the admin's formula preview can run against a real member
 * rather than a second, drifting copy of this query.
 */
export async function fetchRoster(): Promise<RosterRow[]> {
  const { data, error } = await supabase
    .from('member_roster')
    .select(
      // One literal, not a concatenation — supabase-js parses this string at
      // the type level and a `+` degrades every row to an error type. No
      // game_uid, same reasoning as before 0102: the column is off the screen
      // and out of the search fields, so the view does not even expose it.
      'player_id, current_name, hq_level, power, kills, last_seen_at, member_rank, daily_donation_score, weekly_donation_score, duel_daily_score, duel_weekly_score, duel_round_score, assigned_rank, computed_rank, rank_score, growth_1d, growth_7d, growth_1d_at, growth_7d_at, online_state, last_online_at, month_card_expires_at, vip_level, vip_expires_at, svip_level, below_minimum',
    )
    .order('power', { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) {
    // A reader the gate turns away gets an empty roster, not an error page —
    // the banner above the table already explains what they are missing.
    if (error.code === '42501') {
      return [];
    }
    throw new Error(`roster query failed: ${error.message}`);
  }
  return (data ?? []) as RosterRow[];
}

export function RosterPanel() {
  // Which board is on screen. Component state: it is a way of looking, not a
  // setting — and the settled table is the default because it is the one that
  // carries a decision.
  const [tab, setTab] = useState<'settled' | 'running'>('settled');
  const { data, error, isPending } = useQuery({ queryKey: ['roster'], queryFn: fetchRoster });
  const { data: columns } = useQuery({
    queryKey: ['member-formulas'],
    queryFn: fetchMemberColumns,
  });
  const { data: session } = useSession();
  const restricted = session !== undefined && session.role === 'viewer';
  return (
    <section aria-labelledby="roster-heading" className="roster-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            ME
          </span>
          <div>
            <h2 id="roster-heading">{TERMS.members}</h2>
            <p className="entity-meta">
              <span>Rank is the last finished fortnight's</span>
              <span>Power is the sum of the members the roster lists</span>
            </p>
          </div>
        </header>
        {data && data.length > 0 && (
          <div className="strip">
            {rosterStrip(data).map((cell, index) => (
              <StatTile
                hero={index === 0}
                key={cell.label}
                label={cell.label}
                note={cell.note}
                tone={cell.tone}
                value={cell.value}
              />
            ))}
          </div>
        )}
      </div>
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

      {/* Two boards, because they answer two questions and are made of
          different material. The members table carries the rank and score of
          the last FINISHED fortnight — the answer in force, which 0134 keeps
          steady until a period closes. The other tab is the fortnight now
          running, as raw weekly readings, for "am I above the line this week"
          — a question asked on a Wednesday, which the settled answer cannot
          reach. */}
      <Tabs
        label="Ranking"
        items={[
          { id: 'settled', label: 'Last ranking' },
          { id: 'running', label: 'This ranking · weekly' },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="panel roster-board">
        {tab === 'running' ? (
          <CurrentPeriodTable />
        ) : (
          <>
            {isPending && <p className="empty loading">Loading…</p>}
            {error && <p className="error">Could not load members: {error.message}</p>}
            {data && <ExportButton rows={data} columns={ROSTER_CSV} filename="members" />}
            {data && <RosterTable columns={columns ?? []} rows={data} />}
          </>
        )}
      </div>
    </section>
  );
}
