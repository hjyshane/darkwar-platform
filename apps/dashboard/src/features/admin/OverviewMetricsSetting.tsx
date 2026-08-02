import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  DEFAULT_METRICS,
  type FormulaMetric,
  METRIC_CATALOGUE,
  resolveFormulas,
  resolveMetrics,
} from '../../lib/overviewMetrics';
import { supabase } from '../../lib/supabase';

/** Which figures the overview shows, and in what order.
 *
 * The list an admin picks FROM is code, not configuration: every entry is a
 * value with its own source and its own idea of what unknown means, so this
 * screen chooses among them rather than describing new ones. Describing new
 * ones is the formula feature and a different problem.
 *
 * Order matters twice — it is the order of the tiles, and the first one is
 * the hero. Stating that beats a second setting for "which is big".
 */
/** Both keys in one query. A formula an admin just wrote has to be
 *  offerable immediately, and the tile list is only meaningful against the
 *  formulas that exist — fetching them apart lets the picker show a chosen
 *  id it cannot name. */
async function fetchChosen(): Promise<{ tiles: string[]; formulas: FormulaMetric[] }> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['overview_metrics', 'overview_formulas']);
  if (error) {
    throw new Error(`metric setting query failed: ${error.message}`);
  }
  const byKey = new Map((data ?? []).map((row) => [row.key, row.value]));
  const formulas = resolveFormulas(
    (byKey.get('overview_formulas') as { formulas?: unknown } | undefined)?.formulas,
  );
  const tiles = resolveMetrics(
    (byKey.get('overview_metrics') as { tiles?: unknown } | undefined)?.tiles,
    formulas.map((formula) => formula.id),
  );
  return { tiles, formulas };
}

export function OverviewMetricsSetting() {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ['overview-metrics-admin'],
    queryFn: fetchChosen,
  });

  // Seed the editable copy once the saved value arrives, and again whenever
  // it changes underneath us — another admin saving, or this one saving.
  useEffect(() => {
    if (data !== undefined) {
      setChosen(data.tiles);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async (tiles: string[]) => {
      const { error: writeError } = await supabase
        .from('app_settings')
        .upsert({ key: 'overview_metrics', value: { tiles } });
      if (writeError) {
        throw new Error(writeError.message);
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved.');
      void queryClient.invalidateQueries();
    },
    onError: (e: Error) => {
      setFailed(true);
      setMessage(e.message);
    },
  });

  // Built-ins and the admin's own formulas offered from one list — the
  // picker should not care which kind a figure is, only whether it is shown.
  const options: { id: string; label: string; restricted: boolean }[] = [
    ...METRIC_CATALOGUE.map((metric) => ({
      id: metric.id as string,
      label: metric.label,
      restricted: metric.restricted,
    })),
    ...(data?.formulas ?? []).map((formula) => ({
      id: formula.id,
      label: formula.label,
      restricted: false,
    })),
  ];

  if (isPending || chosen === null) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the setting: {error.message}</p>;
  }

  const move = (index: number, by: number) => {
    const next = [...chosen];
    const target = index + by;
    if (target < 0 || target >= next.length) {
      return;
    }
    const [item] = next.splice(index, 1);
    if (item !== undefined) {
      next.splice(target, 0, item);
    }
    setChosen(next);
  };

  const toggle = (id: string) => {
    setChosen(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  };

  // Saving an empty list would land on the default anyway (resolveMetrics
  // falls back rather than blanking the screen), so say so instead of
  // pretending it did something else.
  const empty = chosen.length === 0;

  return (
    <>
      <p className="subtle">
        Tick what the overview shows and order it. The first one is drawn large. Unticking
        everything falls back to the default rather than leaving the screen blank.
      </p>

      <ol className="picked">
        {chosen.map((id, index) => {
          const spec = options.find((option) => option.id === id);
          return (
            <li key={id}>
              <span>
                {index === 0 && <span className="badge badge-fresh">large</span>} {spec?.label}
                {spec?.restricted && <span className="badge">alliance</span>}
              </span>
              <span className="row">
                <button
                  className="linklike"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  type="button"
                >
                  up
                </button>
                <button
                  className="linklike"
                  disabled={index === chosen.length - 1}
                  onClick={() => move(index, 1)}
                  type="button"
                >
                  down
                </button>
                <button className="linklike" onClick={() => toggle(id)} type="button">
                  remove
                </button>
              </span>
            </li>
          );
        })}
      </ol>

      <p className="subtle">Not shown:</p>
      <ul className="chips">
        {options
          .filter((option) => !chosen.includes(option.id))
          .map((option) => (
            <li key={option.id}>
              <button className="chip" onClick={() => toggle(option.id)} type="button">
                + {option.label}
              </button>
            </li>
          ))}
      </ul>

      <div className="row" style={{ marginTop: '1rem' }}>
        <button disabled={save.isPending} onClick={() => save.mutate(chosen)} type="button">
          Save
        </button>
        <button className="linklike" onClick={() => setChosen([...DEFAULT_METRICS])} type="button">
          reset to default
        </button>
      </div>

      {empty && <p className="subtle">Nothing ticked — saving now restores the default.</p>}
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}
    </>
  );
}
