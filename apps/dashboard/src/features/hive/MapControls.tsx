// The row of controls under a hive map: how close, how big, and what the
// colours mean. Shared by the members' picture and the officer's editor so
// the two maps are driven the same way.

import type { ReactNode } from 'react';
import { ZOOM_MAX, ZOOM_MIN, clampZoom, rankClass, windowRadius, zoomedBy } from './TileGrid';
import { type ColourBy, setMapPrefs } from './mapPrefs';

/** Positions along the zoom slider. */
const SLIDER_STEPS = 100;

/** Where a zoom sits on the slider: 0 is the widest, SLIDER_STEPS the closest.
 *
 * LOGARITHMIC, because what the eye sees is the ratio. On a straight scale
 * from 3 to 100 tiles either side, the whole range a hive is drawn in — 7 to
 * 40 — was the first third of the slider, and the last two thirds were ground
 * nobody plans on. Right is closer, like the + beside it.
 */
export function sliderFromZoom(zoom: number): number {
  const span = Math.log(ZOOM_MAX / ZOOM_MIN);
  return Math.round((Math.log(ZOOM_MAX / clampZoom(zoom)) / span) * SLIDER_STEPS);
}

export function zoomFromSlider(position: number): number {
  return clampZoom(ZOOM_MAX / (ZOOM_MAX / ZOOM_MIN) ** (position / SLIDER_STEPS));
}

/** Zoom out, a slider, zoom in, and how many tiles that is — plus whatever the
 * page adds (a "whole plan" button). These zoom about the middle of the view;
 * the wheel zooms about the pointer. */
export function ViewControls({
  zoom,
  onZoom,
  sized,
  children,
}: {
  zoom: number;
  onZoom: (zoom: number) => void;
  /** Whether the reader has resized the map, which is when "Default size" has
   * something to undo. */
  sized: boolean;
  children?: ReactNode;
}) {
  const across = windowRadius(zoom) * 2 + 1;
  return (
    <fieldset className="hive-zoom">
      <legend>View</legend>
      <button
        aria-label="Zoom out"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => onZoom(zoomedBy(zoom, -1))}
        title="Zoom out"
        type="button"
      >
        −
      </button>
      <input
        aria-label="Zoom"
        aria-valuetext={`${across} tiles across`}
        className="hive-zoom__slider"
        max={SLIDER_STEPS}
        min={0}
        onChange={(event) => onZoom(zoomFromSlider(Number(event.target.value)))}
        step={1}
        type="range"
        value={sliderFromZoom(zoom)}
      />
      <button
        aria-label="Zoom in"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => onZoom(zoomedBy(zoom, 1))}
        title="Zoom in"
        type="button"
      >
        +
      </button>
      <output aria-live="off" className="hive-zoom__readout">
        {across} tiles
      </output>
      {children}
      {sized && (
        <button onClick={() => setMapPrefs({ size: null })} type="button">
          Default size
        </button>
      )}
    </fieldset>
  );
}

/** What one base contributes to the rank legend. */
export interface RankEntry {
  rank?: number | null;
  vacant?: boolean;
}

export interface RankTally {
  /** Bases per rank class, r5 first, only the ranks somebody holds. */
  ranks: { key: string; label: string; count: number }[];
  vacant: number;
}

const RANK_LABELS: Record<string, string> = {
  r5: 'R5',
  r4: 'R4',
  r3: 'R3',
  r2: 'R2',
  r1: 'R1',
  r0: 'Rank unknown',
};

/** How many bases each rank colour stands for, over the WHOLE formation —
 * not the window, so the legend does not change as the map is panned. */
export function rankTally(entries: readonly RankEntry[]): RankTally {
  const counts = new Map<string, number>();
  let vacant = 0;
  for (const entry of entries) {
    if (entry.vacant) {
      vacant += 1;
    } else if (entry.rank !== undefined) {
      const key = rankClass(entry.rank);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return {
    ranks: ['r5', 'r4', 'r3', 'r2', 'r1', 'r0'].flatMap((key) => {
      const count = counts.get(key) ?? 0;
      return count === 0 ? [] : [{ key, label: RANK_LABELS[key] ?? key, count }];
    }),
    vacant,
  };
}

/** As drawn, or by alliance rank — and, by rank, what each colour means.
 *
 * NEVER COLOUR ALONE (NFR-011). Every base still carries its member's name,
 * and the legend gives each colour its rank in words and a count, so the
 * colours are a quicker way to read what is already written down. */
export function BaseColours({ colourBy, tally }: { colourBy: ColourBy; tally: RankTally }) {
  return (
    <fieldset className="hive-zoom hive-colour-by">
      <legend>Base colours</legend>
      <button
        aria-pressed={colourBy === 'plan'}
        onClick={() => setMapPrefs({ colourBy: 'plan' })}
        type="button"
      >
        As drawn
      </button>
      <button
        aria-pressed={colourBy === 'rank'}
        onClick={() => setMapPrefs({ colourBy: 'rank' })}
        type="button"
      >
        By rank (R1–R5)
      </button>
      {colourBy === 'rank' && (
        <ul aria-label="Rank colours" className="hive-rank-legend">
          {tally.ranks.map((entry) => (
            <li key={entry.key}>
              <span aria-hidden="true" className={`hive-rank-chip hive-rank-chip--${entry.key}`} />
              {entry.label} <span className="subtle">{entry.count}</span>
            </li>
          ))}
          {tally.vacant > 0 && (
            <li>
              <span aria-hidden="true" className="hive-rank-chip hive-rank-chip--vacant" />
              Nobody yet <span className="subtle">{tally.vacant}</span>
            </li>
          )}
          {tally.ranks.length === 0 && tally.vacant === 0 && (
            <li className="subtle">No member bases to colour.</li>
          )}
        </ul>
      )}
    </fieldset>
  );
}
