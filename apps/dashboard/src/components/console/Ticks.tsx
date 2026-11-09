import type { CSSProperties, ReactNode } from 'react';
import './console.css';

export interface Tick {
  key: string;
  /** The board: `heroes`, `tech`, `troops`. Lower case; the stylesheet sets it. */
  label: string;
  /** Already formatted. */
  value: ReactNode;
  /** 0..1 of the whole. Omitted when the parts do not add up to the total
   * (then there is no bar and no percent, rather than a wrong one). */
  share?: number;
  /** The game's own rank on this board, when the board has one. */
  rank?: number;
  rankOf?: number;
  /** Gap to the neighbour on that board, already formatted and signed. */
  delta?: ReactNode;
}

export interface TicksProps {
  items: readonly Tick[];
  /** Names the list for assistive tech: `Power composition`. */
  ariaLabel: string;
}

function percent(share: number | undefined): string | undefined {
  if (share === undefined || !Number.isFinite(share)) return undefined;
  return `${Math.round(share * 100)}%`;
}

/** Composition as a row of ticks: each item is a short rule whose filled
 * part is its share, with the figure, the label and the rank under it. One
 * component instead of five identical tiles, so the SHAPE of a player reads
 * at a glance. */
export function Ticks({ items, ariaLabel }: TicksProps) {
  return (
    <ul aria-label={ariaLabel} className="ticks">
      {items.map((item) => {
        const pct = percent(item.share);
        const style = pct ? ({ '--w': pct } as CSSProperties) : undefined;
        return (
          <li
            className="tick"
            data-top={item.rank === 1 ? '' : undefined}
            key={item.key}
            style={style}
          >
            {item.rank !== undefined && (
              <span className="tick-rank">
                #{item.rank}
                {item.rankOf !== undefined && <span className="tick-rank-of">/{item.rankOf}</span>}
              </span>
            )}
            <b className="tick-value">{item.value}</b>
            <span className="tick-label">{pct ? `${item.label} · ${pct}` : item.label}</span>
            {item.delta !== undefined && item.delta !== null && (
              <span className="tick-delta">{item.delta}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
