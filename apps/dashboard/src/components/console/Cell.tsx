import type { CSSProperties, ReactNode } from 'react';
import './console.css';

/** Direction of a signed change. Colours the context line only; the value
 * itself keeps the ordinary text colour, because a level has no better or
 * worse and a delta already carries its sign in the text. */
export type CellTone = 'up' | 'down' | 'neutral';

/** Extra class names appended per part. Exists so the legacy `StatTile`
 * can keep emitting `.stat*` hooks while rendering through `Cell`; new
 * code does not need it. */
export interface CellClassNames {
  root?: string;
  label?: string;
  value?: string;
  context?: string;
  spark?: string;
  note?: string;
}

export interface CellProps {
  /** Sentence case; the stylesheet sets it in the 10px mono label face. */
  label: string;
  /** Already formatted by the caller. `null` renders as a dash: unknown is
   * unknown, never zero. */
  value: ReactNode;
  /** A small mono suffix on the value, e.g. `/204`. */
  unit?: string;
  /** The line under the value: the gap to the neighbour, the window, the
   * source. */
  context?: ReactNode;
  tone?: CellTone;
  /** One per strip: the value steps up a size. */
  hero?: boolean;
  /** A trend under the context. Decoration, hidden from assistive tech. */
  spark?: ReactNode;
  /** What the figure is OF, when the label alone would overclaim. */
  note?: string;
  classNames?: CellClassNames;
}

function cls(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

/** One figure in the console grid: label, value, context, in that order. */
export function Cell({
  label,
  value,
  unit,
  context,
  tone,
  hero = false,
  spark,
  note,
  classNames,
}: CellProps) {
  return (
    <div
      className={cls('cell', classNames?.root)}
      data-hero={hero ? '' : undefined}
      data-tone={tone}
    >
      <div className={cls('cell-label', classNames?.label)}>{label}</div>
      <div className={cls('cell-value', classNames?.value)}>
        {value ?? '—'}
        {unit && <span className="cell-unit">{unit}</span>}
      </div>
      {context !== undefined && context !== null && (
        <div className={cls('cell-context', classNames?.context)}>{context}</div>
      )}
      {spark && (
        <div aria-hidden="true" className={cls('cell-spark', classNames?.spark)}>
          {spark}
        </div>
      )}
      {note && <div className={cls('cell-note', classNames?.note)}>{note}</div>}
    </div>
  );
}

export interface CellGridProps {
  children: ReactNode;
  /** Fixed column count. Omitted, the grid fits as many 9.5rem cells as the
   * width allows. Either way it drops to two columns under 480px. */
  columns?: number;
}

/** The bordered row of cells. A 1px gap over the rule colour gives every
 * pair of neighbours one shared line instead of two. */
export function CellGrid({ children, columns }: CellGridProps) {
  const style = columns ? ({ '--cols': String(columns) } as CSSProperties) : undefined;
  return (
    <div className="cell-grid" style={style}>
      {children}
    </div>
  );
}
