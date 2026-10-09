import { StatTile } from './StatTile';

/** One cell of a screen's header strip. `value` is already formatted; null shows
 * as a dash. The first cell is the hero. */
export interface StripCell {
  label: string;
  value: string | null;
  note?: string;
}

/** The figures at the head of a screen, divided by hairlines. Each screen works
 * its cells out in a pure function so what it claims can be tested on its own;
 * this only draws them. */
export function Strip({ cells }: { cells: readonly StripCell[] }) {
  if (cells.length === 0) return null;
  return (
    <div className="strip">
      {cells.map((cell, index) => (
        <StatTile
          hero={index === 0}
          key={cell.label}
          label={cell.label}
          note={cell.note}
          value={cell.value}
        />
      ))}
    </div>
  );
}
