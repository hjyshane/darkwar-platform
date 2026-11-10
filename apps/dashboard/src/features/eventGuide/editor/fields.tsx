import { useEffect, useState } from 'react';
import { numberOrUndefined } from './drafts';

// Inputs the section forms share (0310).

/** A number input that keeps what is TYPED. A controlled `<input>` fed the
 * parsed number loses "1." on its way to 1.5, so the text lives here and the
 * parent is told the number. Empty reads as `undefined`, unreadable as NaN
 * (the draft then fails validation instead of silently losing the field). */
export function NumberField({
  value,
  onChange,
  label,
  min,
}: {
  value: number | null | undefined;
  onChange: (next: number | undefined) => void;
  /** The accessible name; there is no visible label inside a table row. */
  label: string;
  min?: number;
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => {
    // Follow the parent when it changes the value from outside (a row moved,
    // a section reloaded), but never fight the user's own typing.
    const typed = numberOrUndefined(text);
    const same = typed === (value ?? undefined) || (Number.isNaN(typed) && Number.isNaN(value));
    if (!same) setText(value === null || value === undefined ? '' : String(value));
  }, [value, text]);
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      min={min}
      onChange={(event) => {
        setText(event.target.value);
        onChange(numberOrUndefined(event.target.value));
      }}
      type="text"
      value={text}
    />
  );
}

/** Add, remove and reorder buttons for one row of an editable list. */
export function RowButtons({
  index,
  length,
  noun,
  onMove,
  onRemove,
}: {
  index: number;
  length: number;
  noun: string;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  return (
    <span className="actions">
      <button
        aria-label={`Move ${noun} ${n} up`}
        disabled={index === 0}
        onClick={() => onMove(-1)}
        type="button"
      >
        ↑
      </button>
      <button
        aria-label={`Move ${noun} ${n} down`}
        disabled={index === length - 1}
        onClick={() => onMove(1)}
        type="button"
      >
        ↓
      </button>
      <button aria-label={`Remove ${noun} ${n}`} onClick={onRemove} type="button">
        Remove
      </button>
    </span>
  );
}
