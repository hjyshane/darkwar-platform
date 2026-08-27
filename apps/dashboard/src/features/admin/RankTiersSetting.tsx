import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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

interface Tiers {
  r3_percent: number;
  r2_percent: number;
  offline_hours: number;
  normalisation: string;
  weights: { donation: number; duel: number; power_growth: number };
  minimums: Minimums;
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
};

async function fetchTiers(): Promise<Tiers> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'rank_tiers')
    .maybeSingle();
  if (error) {
    throw new Error(`tier settings query failed: ${error.message}`);
  }
  const stored = (data?.value as Partial<Tiers> | null) ?? {};
  // The nested objects are merged by hand: a spread replaces `minimums`
  // wholesale, so a setting saved before 0155 would arrive with the key
  // missing and every field undefined rather than falling back.
  return {
    ...FALLBACK,
    ...stored,
    weights: { ...FALLBACK.weights, ...(stored.weights ?? {}) },
    minimums: { ...FALLBACK.minimums, ...(stored.minimums ?? {}) },
  };
}

export function RankTiersSetting() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Tiers | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({ queryKey: ['rank-tiers'], queryFn: fetchTiers });
  useEffect(() => {
    if (data !== undefined) {
      setDraft(data);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: Tiers) => {
      const { error: writeError } = await supabase
        .from('app_settings')
        .upsert({ key: 'rank_tiers', value: next as unknown as never });
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
    return <p className="empty">Loading…</p>;
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
          <select
            id="normalisation"
            onChange={(event) => setDraft({ ...draft, normalisation: event.target.value })}
            value={draft.normalisation}
          >
            {METHODS.map((method) => (
              <option key={method.id} value={method.id}>
                {method.label}
              </option>
            ))}
          </select>
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

        <div className="row">
          <button disabled={save.isPending} onClick={() => save.mutate(draft)} type="button">
            Save
          </button>
        </div>
      </div>
    </>
  );
}
