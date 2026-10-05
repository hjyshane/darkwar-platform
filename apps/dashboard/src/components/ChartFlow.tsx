import { type ReactNode, createContext } from 'react';

/** The viewBox width a LineChart draws at. Full-width charts keep 720; inside
 * a ChartFlow each chart takes a third of the row, so it draws at 420 and its
 * 11px axis labels stay near 11px instead of shrinking to 6. */
export const ChartWidth = createContext(720);

/** Charts side by side, up to three a row (user 2026-10-05: one chart per
 * screen width made the player and alliance pages a long scroll). Headings,
 * notes and stat tiles inside still take the whole row; a `.chart-cell` keeps
 * a heading with its chart. */
export function ChartFlow({ children }: { children: ReactNode }) {
  return (
    <ChartWidth.Provider value={420}>
      <div className="chart-flow">{children}</div>
    </ChartWidth.Provider>
  );
}
