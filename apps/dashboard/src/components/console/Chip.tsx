import type { ReactNode } from 'react';
import './console.css';

export interface ChipProps {
  /** A 12px icon when the viewer may read game icons; omitted otherwise. */
  icon?: ReactNode;
  label: string;
  /** The figure the chip is about: points, a count, a quantity. */
  figure?: ReactNode;
  /** Muted trailing text: `d5–6 500`, `×10`. */
  suffix?: string;
  title?: string;
}

/** An item or reward token. Square, bordered, on the cell surface. Not the
 * arena lineup's `.chip`, which is a different thing with the same word. */
export function Chip({ icon, label, figure, suffix, title }: ChipProps) {
  return (
    <span className="chip-console" title={title}>
      {icon && (
        <span aria-hidden="true" className="chip-icon">
          {icon}
        </span>
      )}
      <span className="chip-label">{label}</span>
      {figure !== undefined && figure !== null && <span className="chip-figure">{figure}</span>}
      {suffix && <span className="chip-suffix">{suffix}</span>}
    </span>
  );
}
