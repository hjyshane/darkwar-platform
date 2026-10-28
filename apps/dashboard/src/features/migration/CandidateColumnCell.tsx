import { Select } from '../../components/ui/Select';
import type { CandidateColumn } from './candidates';

/** One cell of an officer-defined column, drawn by the column's kind. Text, number and
 * note save when the field is left and only if it changed; a dropdown saves on choosing. */
export function CandidateColumnCell({
  column,
  value,
  label,
  onSave,
}: {
  column: CandidateColumn;
  value: string;
  label: string;
  onSave: (next: string) => void;
}) {
  if (column.kind === 'dropdown') {
    // A choice an officer later removed from the list stays visible, marked, until it is
    // changed: dropping it silently would look like the cell had been emptied.
    const removed = value !== '' && !column.options.includes(value);
    return (
      <Select aria-label={label} value={value} onChange={(next) => onSave(next)}>
        <option value="">—</option>
        {removed && <option value={value}>{value} (not in the list)</option>}
        {column.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    );
  }
  if (column.kind === 'note') {
    return (
      <textarea
        key={value}
        aria-label={label}
        rows={2}
        defaultValue={value}
        onBlur={(event) => {
          const next = event.target.value.trim();
          if (next !== value) onSave(next);
        }}
      />
    );
  }
  return (
    <input
      key={value}
      aria-label={label}
      type={column.kind === 'number' ? 'number' : 'text'}
      step={column.kind === 'number' ? 'any' : undefined}
      inputMode={column.kind === 'number' ? 'decimal' : undefined}
      defaultValue={value}
      onBlur={(event) => {
        const next = event.target.value.trim();
        if (next !== value) onSave(next);
      }}
    />
  );
}
