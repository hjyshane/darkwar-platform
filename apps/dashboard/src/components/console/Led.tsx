import type { ReactNode } from 'react';
import './console.css';

export type LedTone = 'ok' | 'bad' | 'warn' | 'neutral';

export interface LedProps {
  tone: LedTone;
  /** Short mono text: `SHIELD OFF 7d`, `ONLINE 3h`, `READ 2d`. */
  children: ReactNode;
  /** The long form, for hover. */
  title?: string;
}

/** A status light: a dot that carries the only glow in the system, beside a
 * short mono label. The text says the state; the colour repeats it. */
export function Led({ tone, children, title }: LedProps) {
  return (
    <span className="led" data-tone={tone} title={title}>
      <span aria-hidden="true" className="led-dot" />
      {children}
    </span>
  );
}
