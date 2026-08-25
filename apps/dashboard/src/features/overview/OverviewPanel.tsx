import { useQuery } from '@tanstack/react-query';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { StatTile } from '../../components/StatTile';
import { FormulaError, evaluateFormula, parseFormula } from '../../lib/formula';
import {
  type FormulaMetric,
  METRIC_CATALOGUE,
  type MetricId,
  isFormulaId,
  resolveMetrics,
  specFor,
} from '../../lib/overviewMetrics';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
import { AnnouncementsBlock } from './AnnouncementsBlock';
import { FavouritesBlock } from './FavouritesBlock';
import { GuidesBlock } from './GuidesBlock';

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
  rosterObservedAt: string | null;
  /** Every figure the catalogue knows how to show, computed whether or not
   *  it was chosen. They all come out of the four queries below, so working
   *  out which ones are on screen first would save nothing and would make
   *  the admin's choice able to change what gets fetched. */
  values: Record<MetricId, number | null>;
}

export async function fetchSummary(): Promise<OverviewSummary> {
  const { data: alliances, error: allianceError } = await supabase
    .from('alliances')
    .select('alliance_id, current_name, current_code, server_id, power, member_count')
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
  const noMatch = ['00000000-0000-0000-0000-000000000000'];

  // Who counts as a member. Two sources, and the roster wins where there is one.
  //
  // `players.current_alliance_id` is a LAST KNOWN alliance — every writer since
  // 0008 coalesces it, so nothing clears it when somebody leaves. This screen
  // read 95 for an alliance the game says has 94, and the extra row was somebody
  // last seen in a roster batch on 2026-07-28. It is the same fault the alliance
  // page had, and it is worse here: `memberIds` also decides whose contribution
  // is summed and who counts as online, so one departed member inflated four
  // figures at once.
  //
  // `alliance_roster_latest` (0067) is the newest `al.rank` response, and one of
  // those is the whole roster. The fallback stays because that view is
  // member-gated: a signed-out reader gets nothing from it, and for them a stale
  // badge is better than an empty overview.
  const [{ data: roster, error: rosterError }, { data: players, error: playerError }] =
    await Promise.all([
      supabase
        .from('alliance_roster_latest')
        .select('player_id')
        .in('alliance_id', ids.length > 0 ? ids : noMatch),
      supabase
        .from('players')
        .select('player_id, power, kills, roster_observed_at, current_alliance_id')
        .in('current_alliance_id', ids.length > 0 ? ids : noMatch),
    ]);
  if (rosterError) {
    throw new Error(`roster query failed: ${rosterError.message}`);
  }
  if (playerError) {
    throw new Error(`member query failed: ${playerError.message}`);
  }

  // Rows from `players` — they carry the power and kills — narrowed to whoever
  // the roster still lists. The roster gives identity; `players` gives figures.
  const inRoster = new Set((roster ?? []).map((row) => row.player_id));
  const known = players ?? [];
  const current = inRoster.size === 0 ? known : known.filter((row) => inRoster.has(row.player_id));

  const { data: presence, error: presenceError } = await supabase
    .from('player_presence')
    .select('player_id, online_state');
  if (presenceError) {
    throw new Error(`presence query failed: ${presenceError.message}`);
  }

  const { data: contributions, error: contributionError } = await supabase
    .from('player_contributions')
    .select(
      'player_id, daily_donation_score, weekly_donation_score, duel_daily_score, duel_weekly_score, duel_round_score',
    );
  if (contributionError) {
    throw new Error(`contribution query failed: ${contributionError.message}`);
  }

  const memberIds = new Set(current.map((row) => row.player_id));
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
    values: {
      total_power: sum(current.map((row) => row.power)),
      members: current.length === 0 ? null : current.length,
      kills: sum(current.map((row) => row.kills)),
      // Zero rows is "not visible to you", not "nobody is online" — RLS hands
      // a viewer an empty presence table, and 0 would be a claim.
      online:
        presence.length === 0
          ? null
          : presence.filter((row) => memberIds.has(row.player_id) && row.online_state === 'online')
              .length,
      daily_donation: sum(ours.map((row) => row.daily_donation_score)),
      weekly_donation: sum(ours.map((row) => row.weekly_donation_score)),
      duel_daily: sum(ours.map((row) => row.duel_daily_score)),
      duel_weekly: sum(ours.map((row) => row.duel_weekly_score)),
      duel_round: sum(ours.map((row) => row.duel_round_score)),
      alliance_power: sum(alliances.map((row) => row.power)),
      alliance_members: sum(alliances.map((row) => row.member_count)),
    },
    rosterObservedAt:
      current
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

/** The admin's choice and their formulas. One query for both keys so the
 *  tile list and the formulas it may name cannot arrive out of step. */
export interface ChosenTiles {
  tiles: string[];
  formulas: FormulaMetric[];
}

async function fetchChosenMetrics(): Promise<ChosenTiles> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['overview_metrics']);
  if (error) {
    throw new Error(`metric setting query failed: ${error.message}`);
  }
  const byKey = new Map((data ?? []).map((row) => [row.key, row.value]));
  // No formulas here any more: a formula runs on a member and lands as a
  // column on the Members table (0048). What was a tile saying one number
  // for all 93 of them is now 93 numbers.
  const formulas: FormulaMetric[] = [];
  const tiles = resolveMetrics(
    (byKey.get('overview_metrics') as { tiles?: unknown } | undefined)?.tiles,
    formulas.map((formula) => formula.id),
  );
  return { tiles, formulas };
}

/** Compute each formula against the catalogue's figures.
 *
 * Re-parsed on every read rather than stored as a tree: a formula whose
 * inputs stopped existing has to stop being shown, and parsing is where
 * that is noticed. A formula that no longer parses is dropped rather than
 * rendered — a tile with no source is worse than a missing tile, the same
 * rule an unknown catalogue id follows.
 */
function formulaValues(
  formulas: readonly FormulaMetric[],
  values: Record<MetricId, number | null>,
): Record<string, number | null> {
  const known = METRIC_CATALOGUE.map((metric) => metric.id);
  const computed: Record<string, number | null> = {};
  for (const formula of formulas) {
    try {
      computed[formula.id] = evaluateFormula(parseFormula(formula.expression, known), values);
    } catch (problem) {
      if (!(problem instanceof FormulaError)) {
        throw problem;
      }
      // Left out of the map entirely, so the tile is skipped below.
    }
  }
  return computed;
}

export function OverviewPanel({ now }: { now?: Date }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['overview'],
    queryFn: fetchSummary,
  });
  const { data: chosen } = useQuery({
    queryKey: ['overview-metrics'],
    queryFn: fetchChosenMetrics,
  });
  const formulaByTile = data && chosen ? formulaValues(chosen.formulas, data.values) : {};
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

      {data && data.values.members === null && (
        <p className="empty">
          No roster captured yet. Open the alliance member list in game with the collector running,
          and this fills in.
        </p>
      )}

      {data && data.values.members !== null && (
        <>
          <div className="stats">
            {(chosen?.tiles ?? []).map((id, index) => {
              if (isFormulaId(id)) {
                const formula = chosen?.formulas.find((item) => item.id === id);
                // Missing, or one whose expression no longer parses. Skipped
                // rather than drawn empty — same rule as an unknown metric.
                if (formula === undefined || !(id in formulaByTile)) {
                  return null;
                }
                const value = formulaByTile[id] ?? null;
                return (
                  <StatTile
                    hero={index === 0}
                    key={id}
                    label={formula.label}
                    // The expression itself is the note. A derived figure with
                    // no visible derivation is a number nobody can check.
                    note={formula.expression}
                    value={formula.compact ? formatCompact(value) : formatPlain(value)}
                  />
                );
              }
              const spec = specFor(id as MetricId);
              return (
                <StatTile
                  // The first chosen tile is the hero. One per screen, and
                  // the admin's order is what decides which — a rule the
                  // picker can state rather than a second setting.
                  hero={index === 0}
                  key={id}
                  label={spec.label}
                  note={spec.restricted && restricted ? 'alliance members only' : spec.note}
                  value={
                    spec.compact
                      ? formatCompact(data.values[id as MetricId])
                      : formatPlain(data.values[id as MetricId])
                  }
                />
              );
            })}
          </div>
          <p className="subtle">
            Roster last updated <FreshnessBadge capturedAt={data.rosterObservedAt} now={now} />
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
      {/* The 15-23 August event is over, so its scoreboard is off the landing
          screen. Unmounted rather than deleted: `EventScoreboard.tsx` still
          holds the window, the standings query and the post-the-results
          button. Bringing the next event back is two lines — import it again
          and render it here — plus new dates in that file. A finished
          scoreboard at the top of the front page is furniture that outstayed
          its deadline. */}
      {/* Notices before shortcuts: one is news and the other is furniture.
          Both boards show PINNED posts only here — the front page is not a
          second copy of the list. */}
      <AnnouncementsBlock />
      <GuidesBlock />
      <FavouritesBlock />
    </>
  );
}
