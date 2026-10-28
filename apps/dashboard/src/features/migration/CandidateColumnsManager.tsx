import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import {
  COLUMN_KINDS,
  type CandidateColumn,
  type ColumnKind,
  columnProblem,
  parseOptions,
} from './candidates';

export interface ColumnDraft {
  label: string;
  kind: ColumnKind;
  options: string[];
}

/** The form that defines a column: its name, its kind and, for a dropdown, its choices
 * (one per line). The kind of an existing column is fixed, since changing it would
 * reinterpret every cell already written. */
function ColumnForm({
  initial,
  fixedKind,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: ColumnDraft;
  fixedKind: boolean;
  submitLabel: string;
  pending: boolean;
  onSubmit: (draft: ColumnDraft) => void;
  onCancel?: () => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [kind, setKind] = useState<ColumnKind>(initial.kind);
  const [options, setOptions] = useState(initial.options.join('\n'));
  const parsed = kind === 'dropdown' ? parseOptions(options) : [];
  const problem = columnProblem(label, kind, parsed);

  return (
    <form
      className="migration-bar"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null) onSubmit({ label: label.trim(), kind, options: parsed });
      }}
    >
      <label>
        Name{' '}
        <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} />
      </label>
      <label>
        Type{' '}
        <Select
          value={kind}
          disabled={fixedKind}
          onChange={(value) => setKind(value as ColumnKind)}
          aria-label="Column type"
        >
          {COLUMN_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </Select>
      </label>
      {kind === 'dropdown' && (
        <label>
          Choices — one per line
          <textarea
            rows={4}
            value={options}
            onChange={(event) => setOptions(event.target.value)}
            placeholder={'Asked\nAccepted\nDeclined'}
          />
        </label>
      )}
      <button type="submit" disabled={pending || problem !== null} title={problem ?? undefined}>
        {submitLabel}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}

/** Add, rename and remove the extra columns of the candidates table. */
export function CandidateColumnsManager({
  columns,
  pending,
  onAdd,
  onUpdate,
  onRemove,
}: {
  columns: readonly CandidateColumn[];
  pending: boolean;
  onAdd: (draft: ColumnDraft) => void;
  onUpdate: (id: string, draft: Pick<ColumnDraft, 'label' | 'options'>) => void;
  onRemove: (column: CandidateColumn) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <details>
      <summary>
        <h3>Columns</h3>
      </summary>
      <ColumnForm
        key={columns.length}
        initial={{ label: '', kind: 'text', options: [] }}
        fixedKind={false}
        submitLabel="Add column"
        pending={pending}
        onSubmit={onAdd}
      />
      {columns.length > 0 && (
        <ul>
          {columns.map((column) => (
            <li key={column.column_id}>
              {editing === column.column_id ? (
                <ColumnForm
                  initial={column}
                  fixedKind
                  submitLabel="Save"
                  pending={pending}
                  onSubmit={(draft) => {
                    onUpdate(column.column_id, { label: draft.label, options: draft.options });
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  <strong>{column.label}</strong>{' '}
                  <span className="subtle">
                    {COLUMN_KINDS.find((k) => k.kind === column.kind)?.label}
                    {column.kind === 'dropdown' && `: ${column.options.join(', ')}`}
                  </span>{' '}
                  <button type="button" onClick={() => setEditing(column.column_id)}>
                    Edit
                  </button>{' '}
                  <button type="button" onClick={() => onRemove(column)}>
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
