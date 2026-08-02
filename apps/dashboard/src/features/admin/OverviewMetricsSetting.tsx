import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  DEFAULT_METRICS,
  METRIC_CATALOGUE,
  type MetricId,
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
async function fetchChosen(): Promise<MetricId[]> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'overview_metrics')
    .maybeSingle();
  if (error) {
    throw new Error(`metric setting query failed: ${error.message}`);
  }
  return resolveMetrics((data?.value as { tiles?: unknown } | null)?.tiles);
}

export function OverviewMetricsSetting() {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<MetricId[] | null>(null);
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
      setChosen(data);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async (tiles: MetricId[]) => {
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

  const toggle = (id: MetricId) => {
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
          const spec = METRIC_CATALOGUE.find((metric) => metric.id === id);
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
        {METRIC_CATALOGUE.filter((metric) => !chosen.includes(metric.id)).map((metric) => (
          <li key={metric.id}>
            <button className="chip" onClick={() => toggle(metric.id)} type="button">
              + {metric.label}
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
