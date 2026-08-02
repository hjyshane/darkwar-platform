import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { FormulaError, evaluateFormula, parseFormula, referencedNames } from '../../lib/formula';
import {
  FORMULA_PREFIX,
  type FormulaMetric,
  METRIC_CATALOGUE,
  resolveFormulas,
} from '../../lib/overviewMetrics';
import { supabase } from '../../lib/supabase';

/** Figures an admin describes rather than picks.
 *
 * The expression is checked HERE, before it is written. That is what keeps
 * the overview simple: it only ever meets formulas that parsed once, and a
 * reader never lands on a screen that will not draw because of somebody's
 * typo. It re-parses anyway on every read, because a formula can be made
 * invalid later by a metric going away rather than by being edited.
 *
 * The preview is the other half of that. A formula is arithmetic over
 * figures the writer cannot see the values of while typing, so showing the
 * result against real current data is the difference between "it saved" and
 * "it is right".
 */
const KNOWN = METRIC_CATALOGUE.map((metric) => metric.id);

async function fetchFormulas(): Promise<FormulaMetric[]> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'overview_formulas')
    .maybeSingle();
  if (error) {
    throw new Error(`formula query failed: ${error.message}`);
  }
  return resolveFormulas((data?.value as { formulas?: unknown } | null)?.formulas);
}

export function FormulaSetting({ values }: { values: Record<string, number | null> }) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [label, setLabel] = useState('');
  const [expression, setExpression] = useState('');
  const [compact, setCompact] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ['overview-formulas-admin'],
    queryFn: fetchFormulas,
  });

  const save = useMutation({
    mutationFn: async (formulas: FormulaMetric[]) => {
      const { error: writeError } = await supabase
        .from('app_settings')
        // The generated Json type does not know FormulaMetric; the shape is
        // whatever resolveFormulas will accept back, which is what the read
        // side actually enforces.
        .upsert({
          key: 'overview_formulas',
          value: { formulas } as unknown as Record<string, never>,
        });
      if (writeError) {
        throw new Error(writeError.message);
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved.');
      setLabel('');
      setExpression('');
      setEditing(null);
      void queryClient.invalidateQueries();
    },
    onError: (e: Error) => {
      setFailed(true);
      setMessage(e.message);
    },
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load formulas: {error.message}</p>;
  }

  // Parsed on every keystroke, which is what makes the error message and the
  // preview arrive together rather than at submit time.
  let parseProblem: string | null = null;
  let preview: number | null = null;
  let reads: string[] = [];
  if (expression.trim() !== '') {
    try {
      const tree = parseFormula(expression, KNOWN);
      preview = evaluateFormula(tree, values);
      reads = referencedNames(tree);
    } catch (problem) {
      parseProblem = problem instanceof FormulaError ? problem.message : 'Could not read that';
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (label.trim() === '' || parseProblem !== null || expression.trim() === '') {
      return;
    }
    const next: FormulaMetric = {
      id: editing ?? `${FORMULA_PREFIX}${crypto.randomUUID()}`,
      label: label.trim(),
      expression: expression.trim(),
      compact,
    };
    const rest = data.filter((item) => item.id !== next.id);
    save.mutate(editing === null ? [...data, next] : [...rest, next]);
  };

  const remove = (id: string) => save.mutate(data.filter((item) => item.id !== id));

  return (
    <>
      <p className="subtle">
        Arithmetic over the figures above — <code>+ - * /</code> and brackets, nothing else. A
        formula whose inputs are unknown stays unknown; it never turns into a zero.
      </p>

      <form className="stack" onSubmit={submit}>
        <label htmlFor={`${formId}-label`}>
          Name
          <input
            id={`${formId}-label`}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Donation per member"
            required
            value={label}
          />
        </label>
        <label htmlFor={`${formId}-expr`}>
          Formula
          <input
            id={`${formId}-expr`}
            onChange={(e) => setExpression(e.target.value)}
            placeholder="weekly_donation / members"
            required
            value={expression}
          />
        </label>

        {/* The names were undiscoverable: a formula is written against ids
            like `weekly_donation` and the only place they appeared was this
            field's placeholder. Clicking one appends it, so the list is both
            the reference and the way to use it. Each shows its current value
            because "which figure is this" is answered faster by the number
            than by the id. */}
        <div className="metric-picker">
          <span className="subtle">Figures you can use — click to insert:</span>
          {METRIC_CATALOGUE.map((metric) => (
            <button
              className="linklike"
              key={metric.id}
              onClick={() =>
                setExpression((current) =>
                  current.trim() === '' ? metric.id : `${current.trimEnd()} ${metric.id}`,
                )
              }
              title={`${metric.label} · now ${
                values[metric.id] == null ? 'unknown' : values[metric.id]?.toLocaleString('ko-KR')
              }`}
              type="button"
            >
              <code>{metric.id}</code>
            </button>
          ))}
        </div>

        {parseProblem !== null && <p className="error">{parseProblem}</p>}
        {parseProblem === null && expression.trim() !== '' && (
          <p className="subtle">
            Now: <strong>{preview === null ? '—' : preview.toLocaleString('ko-KR')}</strong>
            {preview === null && ' (one of its figures is unknown, or it divides by zero)'}
            {reads.length > 0 && ` · reads ${reads.join(', ')}`}
          </p>
        )}

        <label className="inline" htmlFor={`${formId}-compact`}>
          <input
            checked={compact}
            id={`${formId}-compact`}
            onChange={(e) => setCompact(e.target.checked)}
            type="checkbox"
          />
          Shorten big numbers (4.4M)
        </label>

        <div className="row">
          <button disabled={save.isPending || parseProblem !== null} type="submit">
            {editing === null ? 'Add figure' : 'Save changes'}
          </button>
          {editing !== null && (
            <button
              className="linklike"
              onClick={() => {
                setEditing(null);
                setLabel('');
                setExpression('');
              }}
              type="button"
            >
              cancel
            </button>
          )}
        </div>
      </form>

      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      {data.length === 0 ? (
        <p className="empty">
          No formulas yet. They appear in the list above once added, ready to be shown.
        </p>
      ) : (
        <ul className="picked">
          {data.map((item) => (
            <li key={item.id}>
              <span>
                {item.label} <code className="subtle">{item.expression}</code>
              </span>
              <span className="row">
                <button
                  className="linklike"
                  onClick={() => {
                    setEditing(item.id);
                    setLabel(item.label);
                    setExpression(item.expression);
                    setCompact(item.compact);
                  }}
                  type="button"
                >
                  edit
                </button>
                <button className="linklike" onClick={() => remove(item.id)} type="button">
                  remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="subtle">Available figures: {KNOWN.join(', ')}</p>
    </>
  );
}
