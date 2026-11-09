import type { ReactNode } from 'react';
import './console.css';

export interface VerdictProps {
  /** One sentence or two, composed by the page from facts. Figures go in
   * `<code>`, which the stylesheet sets in amber on the accent wash. */
  children: ReactNode;
}

/** The reading at the top of an entity page: what a scout would say first.
 * One paragraph, no heading, no icon; the facts carry it. */
export function Verdict({ children }: VerdictProps) {
  return <p className="verdict">{children}</p>;
}
