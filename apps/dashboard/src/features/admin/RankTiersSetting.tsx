import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Select } from '../../components/ui/Select';
import { labAdjustment, parseSeasonLab, seasonLabApplies } from '../../lib/seasonLab';
import { currentBuildings, currentSeason, seasonWindow, useSeasons } from '../../lib/seasons';
import { supabase } from '../../lib/supabase';

/** How the score is mixed, and where the rank boundaries fall.
 *
 * The weights apply to each figure's PERCENTILE inside the alliance, not to
 * the raw number, and that is not a detail. The alliance averages 48,684
 * weekly donation against 3,502,889 duel points; weighting those directly at
 * 0.4 and 0.6 contributes 19,474 and 2,101,733, so the donation half is
 * noise and the score is the duel board wearing a disguise. Ranking each
 * figure first is what makes these numbers mean what they look like.
 *
 * Shares of the roster rather than absolute scores, for two reasons: an
 * absolute cut cannot be chosen before there is history to choose it from,
 * and it goes stale as everyone's figures climb. The in-game ranks are
 * limited slots anyway, which is what a share is. The cost is that somebody
 * always moves down even if the whole alliance improved — worth knowing
 * before reading the report as a judgement on effort.
 */
/** How each figure is put on a comparable scale before the weights mix
 * them. All four work; none is right for everything, and the difference
 * shows most on a member who dominates one board:
 *
 *   percentile  ignores how far ahead they were — a donor ten times the
 *               runner-up scores the same as one who edged them
 *   share       "4% of the alliance's donations", magnitude kept
 *   zscore      spreads the middle out, but one huge figure moves the mean
 *               and the spread, so everybody else shifts because of them
 *   median      multiples of the typical member, and an outlier cannot move
 *               a median
 */
const METHODS = [
  {
    id: 'percentile',
    label: 'Percentile — rank inside the alliance',
    formula: '100 × (members below x) ÷ (members − 1)',
    note: 'Ignores how far ahead the top member was. Immune to one huge figure.',
  },
  {
    id: 'share',
    label: 'Share — of the alliance total',
    formula: '100 × x ÷ Σx',
    note: 'Reads as a sentence: "4% of the donations". One dominant member flattens the rest.',
  },
  {
    id: 'zscore',
    label: 'Z-score — standard deviations from the mean',
    formula: '(x − mean) ÷ standard deviation',
    note: 'Spreads the middle out. One huge figure moves the mean AND the spread, so everybody else shifts because of them.',
  },
  {
    id: 'median',
    label: 'Median — multiples of the typical member',
    formula: '100 × x ÷ median',
    note: 'Keeps magnitude, and an outlier cannot move a median the way it moves a mean.',
  },
] as const;

/** The floor, under the relative scoring (0155).
 *
 * The score itself is relative — percentiles inside the alliance — so it can
 * only say who did more than whom, never whether anybody did enough. These are
 * the numbers the alliance says out loud, and missing one costs a tier step.
 *
 * WEEKLY, NOT DAILY. The daily boards are only as present as the collector's
 * day, and a member nobody captured on a Tuesday would be indistinguishable
 * from one who did nothing — so a daily floor demotes people for our own gaps.
 */
interface Minimums {
  enabled: boolean;
  donation_weekly: number;
  duel_weekly: number;
}

/** The season rule (0159).
 *
 * Between seasons the alliance is scored on donation, duel and power growth,
 * which is every part of the game EXCEPT the one a season actually asks for.
 * Inside a window, one season building moves the score: below `low` costs
 * `penalty` points, `high` or above earns `bonus`, and the tier cuts are
 * untouched — the adjusted score goes through the same percentiles, so this
 * changes who is where and never how many are there.
 *
 * The building id is a setting rather than a constant because next season is
 * a different building, and this should be a form then rather than a deploy.
 */
interface SeasonLabSetting {
  enabled: boolean;
  starts_at: string;
  ends_at: string;
  building_id: number | null;
  low: number;
  high: number;
  penalty: number;
  bonus: number;
}

/** What the duel weight is applied to (0328).
 *
 * `points` is the weekly duel board, as it has always been. `days` counts the
 * duel days (Monday to Saturday; Sunday is not a duel day) on which a member's
 * DAILY duel board met that weekday's floor, and ranks the count instead. The
 * floors are per weekday because the duel's days are not alike — Saturday's
 * kill day is worth many times a Tuesday. A weekday at 0 is not asked for and
 * not counted. A day the collector never read is left out rather than scored
 * as a miss, so a quiet collector day costs nobody a place.
 */
type DuelScoring = 'points' | 'days';

const DUEL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type DuelDay = (typeof DUEL_DAYS)[number];
const DUEL_DAY_LABEL: Record<DuelDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

/** The one number every duel day is held to, or null when the weekdays differ.
 *
 * The scorer (0328) only ever reads six weekday floors. The form offers one
 * field on top of them because that is how the floor was set the first time it
 * was used — 624,000 typed six times — and six boxes invite a typo on one of
 * them. The single field is a view over the six, not a seventh setting: saving
 * writes the same value into every weekday, and a stored setting whose
 * weekdays already agree opens on the single field. */
export function uniformDuelMinimum(minimums: Record<DuelDay, number>): number | null {
  const first = minimums.mon;
  return DUEL_DAYS.every((day) => minimums[day] === first) ? first : null;
}

/** Every duel day, Monday to Saturday, at the same floor. */
export function everyDuelDay(value: number): Record<DuelDay, number> {
  return { mon: value, tue: value, wed: value, thu: value, fri: value, sat: value };
}

interface Tiers {
  r3_percent: number;
  r2_percent: number;
  offline_hours: number;
  normalisation: string;
  weights: { donation: number; duel: number; power_growth: number };
  minimums: Minimums;
  season_lab: SeasonLabSetting;
  duel_scoring: DuelScoring;
  duel_daily_minimums: Record<DuelDay, number>;
}

const FALLBACK: Tiers = {
  r3_percent: 20,
  r2_percent: 50,
  offline_hours: 48,
  normalisation: 'percentile',
  weights: { donation: 0.4, duel: 0.6, power_growth: 0 },
  // Off, with no numbers. A floor that shipped with a default would demote
  // people for a rule the alliance never agreed.
  minimums: { enabled: false, donation_weekly: 0, duel_weekly: 0 },
  // Off, with no dates and no sizes, for the same reason: a season rule that
  // shipped with defaults would move people for a rule nobody agreed.
  season_lab: {
    enabled: false,
    starts_at: '',
    ends_at: '',
    building_id: null,
    low: 0,
    high: 0,
    penalty: 0,
    bonus: 0,
  },
  // Points, as always. Floors at zero, so switching to days before any are
  // typed counts nothing rather than demanding something nobody agreed.
  duel_scoring: 'points',
  duel_daily_minimums: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 },
};

async function fetchTiers(): Promise<Tiers> {
  // Per alliance since 0195: the alliance being viewed, falling back to
  // app_settings (which is also the primary alliance's own value).
  const { data, error } = await supabase.rpc('alliance_setting', { p_key: 'rank_tiers' });
  if (error) {
    throw new Error(`tier settings query failed: ${error.message}`);
  }
  const stored = (data as Partial<Tiers> | null) ?? {};
  // The nested objects are merged by hand: a spread replaces `minimums`
  // wholesale, so a setting saved before 0155 would arrive with the key
  // missing and every field undefined rather than falling back.
  return {
    ...FALLBACK,
    ...stored,
    weights: { ...FALLBACK.weights, ...(stored.weights ?? {}) },
    minimums: { ...FALLBACK.minimums, ...(stored.minimums ?? {}) },
    season_lab: { ...FALLBACK.season_lab, ...(stored.season_lab ?? {}) },
    // Anything but 'days' is points, which is also what the scorer does with
    // a value it does not recognise.
    duel_scoring: stored.duel_scoring === 'days' ? 'days' : 'points',
    duel_daily_minimums: {
      ...FALLBACK.duel_daily_minimums,
      ...(stored.duel_daily_minimums ?? {}),
    },
  };
}

export function RankTiersSetting() {
  const queryClient = useQueryClient();
  const seasonList = useSeasons();
  const thisSeason = currentSeason(seasonList.data ?? [], new Date());
  const seasonDates = seasonWindow(thisSeason);
  const [draft, setDraft] = useState<Tiers | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Whether the daily minimum is shown as six weekday boxes or one field.
  // Null until the officer chooses: then the stored setting decides, and six
  // weekdays that agree open on the one field.
  const [perWeekday, setPerWeekday] = useState<boolean | null>(null);
  const weekdaysShown =
    draft !== null && (perWeekday ?? uniformDuelMinimum(draft.duel_daily_minimums) === null);

  const { data, error, isPending } = useQuery({ queryKey: ['rank-tiers'], queryFn: fetchTiers });
  useEffect(() => {
    if (data !== undefined) {
      setDraft(data);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: Tiers) => {
      const { error: writeError } = await supabase.rpc('save_alliance_setting', {
        p_key: 'rank_tiers',
        p_value: next as unknown as never,
      });
      if (writeError) {
        throw new Error(writeError.message);
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved. Rebuild a period for it to take effect.');
      void queryClient.invalidateQueries({ queryKey: ['rank-tiers'] });
    },
    onError: (mutationError: Error) => {
      setFailed(true);
      setMessage(mutationError.message);
    },
  });

  if (isPending || draft === null) {
    return <p className="empty loading">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the settings: {error.message}</p>;
  }

  const r1 = Math.max(0, 100 - draft.r3_percent - draft.r2_percent);
  const weightSum = draft.weights.donation + draft.weights.duel + draft.weights.power_growth || 1;
  const share = (value: number) => `${Math.round((value / weightSum) * 100)}%`;

  return (
    <>
      <p className="subtle">
        Each figure is put on a comparable scale first, then the weights mix those. Weighting the
        raw numbers would not work: the duel board is roughly a hundred times the donation board, so
        a "0.4 / 0.6" mix of the raw figures is the duel board alone. Which scale is a real choice —
        percentile ignores how far ahead the top member was, the other three do not.
      </p>

      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      <div className="stack">
        <label htmlFor="normalisation">
          How each figure is scaled before the weights mix it
          <Select
            id="normalisation"
            onChange={(chosen) => setDraft({ ...draft, normalisation: chosen })}
            value={draft.normalisation}
          >
            {METHODS.map((method) => (
              <option key={method.id} value={method.id}>
                {method.label}
              </option>
            ))}
          </Select>
        </label>

        {/* Every method's arithmetic, not only the chosen one. Picking
            between them is the point, and a comparison cannot be made from
            a description of the one already selected. */}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="label">Method</th>
                <th className="label">Each figure becomes</th>
                <th className="label">What that costs</th>
              </tr>
            </thead>
            <tbody>
              {METHODS.map((method) => (
                <tr key={method.id}>
                  <td className="label">
                    {method.id === draft.normalisation ? <strong>{method.id}</strong> : method.id}
                  </td>
                  <td className="label">
                    <code>{method.formula}</code>
                  </td>
                  <td className="label">{method.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="subtle">
          Then: <code>score = (Σ weight × scaled figure) ÷ Σ weight</code>, and the tier comes from
          where that score ranks — top {draft.r3_percent}% R3, next {draft.r2_percent}% R2, the
          remaining {r1}% R1. Anyone offline {draft.offline_hours} hours or more is R1 whatever the
          score says.
        </p>

        {(['donation', 'duel', 'power_growth'] as const).map((key) => (
          <label htmlFor={`weight-${key}`} key={key}>
            {key === 'power_growth' ? 'Power growth weight' : `${key} weight`} (
            {share(draft.weights[key])} of the score)
            <input
              id={`weight-${key}`}
              min="0"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  weights: { ...draft.weights, [key]: Number(event.target.value) },
                })
              }
              step="0.1"
              type="number"
              value={draft.weights[key]}
            />
          </label>
        ))}

        <label htmlFor="r3-percent">
          Top share that becomes R3
          <input
            id="r3-percent"
            max="100"
            min="0"
            onChange={(event) => setDraft({ ...draft, r3_percent: Number(event.target.value) })}
            type="number"
            value={draft.r3_percent}
          />
        </label>
        <label htmlFor="r2-percent">
          Next share that becomes R2 — the remaining {r1}% are R1
          <input
            id="r2-percent"
            max="100"
            min="0"
            onChange={(event) => setDraft({ ...draft, r2_percent: Number(event.target.value) })}
            type="number"
            value={draft.r2_percent}
          />
        </label>
        <label htmlFor="offline-hours">
          Hours offline that force R1 whatever the score says
          <input
            id="offline-hours"
            min="0"
            onChange={(event) => setDraft({ ...draft, offline_hours: Number(event.target.value) })}
            type="number"
            value={draft.offline_hours}
          />
        </label>

        <p className="subtle">
          <strong>Weekly minimums.</strong> The score above is relative — it says who did more than
          whom, never whether anybody did enough. A member whose weekly donation or duel reading
          comes in under these drops one rank (R3 → R2, R2 → R1) and is marked in red on the members
          table. R1 has nothing below it in the game, so an R1 keeps the rank and the mark.
          <br />
          Weekly, not daily, and on purpose: a daily figure is only as present as the collector's
          day, so a daily floor would demote people for our own gaps. A week with no reading is
          never counted as a miss either — week two of a running fortnight has not happened yet.
        </p>

        <label htmlFor="minimums-enabled">
          <input
            checked={draft.minimums.enabled}
            id="minimums-enabled"
            onChange={(event) =>
              setDraft({
                ...draft,
                minimums: { ...draft.minimums, enabled: event.target.checked },
              })
            }
            type="checkbox"
          />
          Apply the minimums below
        </label>

        <label htmlFor="min-donation">
          Weekly donation minimum <span className="subtle">(0 = no floor)</span>
          <input
            id="min-donation"
            min="0"
            onChange={(event) =>
              setDraft({
                ...draft,
                minimums: { ...draft.minimums, donation_weekly: Number(event.target.value) },
              })
            }
            type="number"
            value={draft.minimums.donation_weekly}
          />
        </label>

        <label htmlFor="min-duel">
          Weekly duel minimum <span className="subtle">(0 = no floor)</span>
          <input
            id="min-duel"
            min="0"
            onChange={(event) =>
              setDraft({
                ...draft,
                minimums: { ...draft.minimums, duel_weekly: Number(event.target.value) },
              })
            }
            type="number"
            value={draft.minimums.duel_weekly}
          />
        </label>

        <p className="subtle">
          <strong>Duel scoring.</strong> The duel weight above is applied to the weekly duel points
          by default. Scoring it on days instead ranks each member on how many duel days — Monday to
          Saturday — their daily duel board met that day's minimum, using the same scale and weights
          as the points would. A day at 0 is not required and not counted. A day the collector did
          not read counts for nobody, so it moves no one.
          <br />
          The weekly points are still read and shown; only what the duel weight measures changes.
          The weekly duel minimum above stays a weekly floor in both modes.
        </p>

        <label htmlFor="duel-scoring">
          What the duel weight measures
          <Select
            id="duel-scoring"
            onChange={(chosen) =>
              setDraft({ ...draft, duel_scoring: chosen === 'days' ? 'days' : 'points' })
            }
            value={draft.duel_scoring}
          >
            <option value="points">Weekly duel points</option>
            <option value="days">Duel days over the daily minimum</option>
          </Select>
        </label>

        {draft.duel_scoring === 'days' && (
          <div className="stack">
            <label htmlFor="duel-day-mode">
              Daily minimum
              <Select
                id="duel-day-mode"
                onChange={(chosen) => {
                  const weekdays = chosen === 'weekday';
                  setPerWeekday(weekdays);
                  // Collapsing to one field makes Monday's floor the floor for
                  // every day, so what the field shows is what will be saved.
                  if (!weekdays) {
                    setDraft({
                      ...draft,
                      duel_daily_minimums: everyDuelDay(draft.duel_daily_minimums.mon),
                    });
                  }
                }}
                value={weekdaysShown ? 'weekday' : 'same'}
              >
                <option value="same">The same every duel day</option>
                <option value="weekday">Different per weekday</option>
              </Select>
            </label>
            {weekdaysShown ? (
              DUEL_DAYS.map((day) => (
                <label htmlFor={`duel-day-${day}`} key={day}>
                  {DUEL_DAY_LABEL[day]} minimum <span className="subtle">(0 = not counted)</span>
                  <input
                    id={`duel-day-${day}`}
                    min="0"
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        duel_daily_minimums: {
                          ...draft.duel_daily_minimums,
                          [day]: Number(event.target.value),
                        },
                      })
                    }
                    type="number"
                    value={draft.duel_daily_minimums[day]}
                  />
                </label>
              ))
            ) : (
              <label htmlFor="duel-day-all">
                Points per duel day, Monday to Saturday{' '}
                <span className="subtle">(0 = no day counted)</span>
                <input
                  id="duel-day-all"
                  min="0"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      duel_daily_minimums: everyDuelDay(Number(event.target.value)),
                    })
                  }
                  type="number"
                  value={draft.duel_daily_minimums.mon}
                />
              </label>
            )}
            {DUEL_DAYS.every((day) => draft.duel_daily_minimums[day] <= 0) && (
              <p className="error">
                Every day is at 0, so no day is counted and every member ties on duel. Set at least
                one.
              </p>
            )}
          </div>
        )}

        <p className="subtle">
          <strong>Season building.</strong> Between seasons the score is donation, duel and power
          growth — every part of the game except the one a season actually asks for. Inside the
          window below, one season building moves the score: under the low level costs points, at or
          above the high level earns them, and everyone in between is scored exactly as now. The
          tier cuts do not change, so this moves who is where and never how many are there.
          <br />
          The period's START decides which rule it gets, so a fortnight that opened before the
          season keeps the old scoring even if it ends inside one. A level nobody has swept costs
          nothing — an empty cell on the building board is a gap in our coverage, not a member who
          built nothing.
        </p>

        <label htmlFor="lab-enabled">
          <input
            checked={draft.season_lab.enabled}
            id="lab-enabled"
            onChange={(event) =>
              setDraft({
                ...draft,
                season_lab: { ...draft.season_lab, enabled: event.target.checked },
              })
            }
            type="checkbox"
          />
          Apply the season rule below
        </label>

        <label htmlFor="lab-building">
          Which building
          <Select
            id="lab-building"
            onChange={(chosen) =>
              setDraft({
                ...draft,
                season_lab: {
                  ...draft.season_lab,
                  building_id: chosen === '' ? null : Number(chosen),
                },
              })
            }
            value={draft.season_lab.building_id ?? ''}
          >
            <option value="">— none chosen —</option>
            {currentBuildings(seasonList.data, new Date()).map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.name}
              </option>
            ))}
          </Select>
        </label>

        {/* The dates are the season's own (Settings -> Shared -> Seasons), so a new
            season is not typed twice. The button copies them in; they stay
            editable, because the rule may open later than the season does. */}
        {seasonDates !== null && (
          <p className="subtle">
            <button
              onClick={() =>
                setDraft({
                  ...draft,
                  season_lab: {
                    ...draft.season_lab,
                    starts_at: seasonDates.startsAt,
                    // A season with no end yet keeps whatever end was typed.
                    ends_at:
                      seasonDates.endsAt === '' ? draft.season_lab.ends_at : seasonDates.endsAt,
                  },
                })
              }
              type="button"
            >
              Use {thisSeason?.name ?? 'the current season'}'s dates
            </button>{' '}
            {seasonDates.startsAt}
            {seasonDates.endsAt === ''
              ? ' → no end set on the season yet'
              : ` → ${seasonDates.endsAt}`}
          </p>
        )}

        {/* `datetime-local` has no zone, and every timestamp in this app is
            UTC. Typing the instant in full is uglier than a picker and is the
            only way the number saved is the number meant — the game's own week
            turns at 02:00 UTC, which is the boundary these dates sit on. */}
        <label htmlFor="lab-starts">
          Season starts (UTC, e.g. 2026-09-10T02:00:00Z)
          <input
            id="lab-starts"
            onChange={(event) =>
              setDraft({
                ...draft,
                season_lab: { ...draft.season_lab, starts_at: event.target.value },
              })
            }
            placeholder="2026-09-10T02:00:00Z"
            value={draft.season_lab.starts_at}
          />
        </label>
        <label htmlFor="lab-ends">
          Season ends (UTC) — a period opening exactly then is already outside
          <input
            id="lab-ends"
            onChange={(event) =>
              setDraft({
                ...draft,
                season_lab: { ...draft.season_lab, ends_at: event.target.value },
              })
            }
            placeholder="2026-11-10T02:00:00Z"
            value={draft.season_lab.ends_at}
          />
        </label>

        {(
          [
            ['low', 'Level under which the penalty applies', '(0 = no penalty side)'],
            ['high', 'Level at or above which the bonus applies', '(0 = no bonus side)'],
            ['penalty', 'Points taken off under the low level', '(0 = moves nobody)'],
            ['bonus', 'Points added at or above the high level', '(0 = moves nobody)'],
          ] as const
        ).map(([key, label, hint]) => (
          <label htmlFor={`lab-${key}`} key={key}>
            {label} <span className="subtle">{hint}</span>
            <input
              id={`lab-${key}`}
              min="0"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  season_lab: { ...draft.season_lab, [key]: Number(event.target.value) },
                })
              }
              type="number"
              value={draft.season_lab[key]}
            />
          </label>
        ))}

        {/* What the numbers above actually do, computed by the same functions
            the scorer's rule is mirrored in. A settings page that only
            described itself would drift from the arithmetic the first time
            either changed. */}
        <p className="subtle">
          {seasonLabApplies(parseSeasonLab({ season_lab: draft.season_lab }), new Date()) ? (
            <>
              A fortnight opening today is scored by the season rule. A member at level{' '}
              {Math.max(0, draft.season_lab.low - 1)} would score{' '}
              {labAdjustment(
                Math.max(0, draft.season_lab.low - 1),
                parseSeasonLab({ season_lab: draft.season_lab }),
              )}{' '}
              and one at level {draft.season_lab.high} would score +
              {labAdjustment(
                draft.season_lab.high,
                parseSeasonLab({ season_lab: draft.season_lab }),
              )}
              , out of 100.
            </>
          ) : (
            'A fortnight opening today is scored the ordinary way — the season window is off, ' +
            'unset, or does not contain today.'
          )}
        </p>

        <div className="row">
          <button disabled={save.isPending} onClick={() => save.mutate(draft)} type="button">
            Save
          </button>
        </div>
      </div>
    </>
  );
}
