// The controls laid over a hive map's corners: how close, where, and what the
// colours mean. Shared by the members' picture and the officer's editor so the
// two maps are driven the same way.
//
// ON THE MAP, NOT UNDER IT. They used to be two rows under the grid, a map's
// height away from the picture they change — zoom, look, scroll down, zoom
// again. Over the corners, the way every map on a phone does it, they are
// where the eye already is, and the page under the map is shorter by both.

import type { Coordinate } from '@dw/ui';
import { useState } from 'react';
import { formatTeleport } from '../../lib/hiveFormation';
import { ZOOM_MAX, ZOOM_MIN, clampZoom, rankClass, windowRadius, zoomedBy } from './TileGrid';
import { type ColourBy, setMapPrefs } from './mapPrefs';

/** Positions along the zoom slider. */
const SLIDER_STEPS = 100;

/** Where a zoom sits on the slider: 0 is the widest, SLIDER_STEPS the closest.
 *
 * LOGARITHMIC, because what the eye sees is the ratio. On a straight scale
 * from 3 to 100 tiles either side, the whole range a hive is drawn in — 7 to
 * 40 — was the first third of the slider, and the last two thirds were ground
 * nobody plans on. Up is closer, like the + above it.
 */
export function sliderFromZoom(zoom: number): number {
  const span = Math.log(ZOOM_MAX / ZOOM_MIN);
  return Math.round((Math.log(ZOOM_MAX / clampZoom(zoom)) / span) * SLIDER_STEPS);
}

export function zoomFromSlider(position: number): number {
  return clampZoom(ZOOM_MAX / (ZOOM_MAX / ZOOM_MIN) ** (position / SLIDER_STEPS));
}

/** A 16px line icon in the text colour. Drawn here rather than taken from a
 * font: a house or a frame in a system font is a different picture on every
 * machine, and on some it is a box. */
export function Icon({ d }: { d: string }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d={d} />
    </svg>
  );
}

const HOUSE = 'M3 11 12 4l9 7M5.5 9.5V20h4.5v-6h4v6h4.5V9.5';
const FRAME = 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5';
const SHRINK = 'M4 4l6 6M10 5v5H5M20 20l-6-6M14 19v-5h5';

/** The view buttons in the map's top-right corner: closer, a slider, further,
 * how many tiles across, back to the anchor, and everything at once.
 *
 * These zoom about the middle of the view; ctrl + wheel and a pinch zoom
 * about the pointer. The slider is dropped on a map too short to hold it —
 * the buttons either side still step it. */
export function MapNav({
  zoom,
  onZoom,
  anchor,
  onHome,
  fitLabel,
  onFit,
  fitted,
  sized,
}: {
  zoom: number;
  onZoom: (zoom: number) => void;
  /** Where the home button goes, named on the button. */
  anchor: Coordinate;
  onHome: () => void;
  /** What "everything" is called on this map: the plan, or the formation. */
  fitLabel: string;
  onFit: () => void;
  /** Whether the view is already the whole of it, when the page knows. */
  fitted?: boolean;
  /** Whether the reader has resized the map, which is when "Default size" has
   * something to undo. */
  sized: boolean;
}) {
  const across = windowRadius(zoom) * 2 + 1;
  const home = `Go to the anchor, ${formatTeleport(anchor)}`;
  return (
    <fieldset className="map-nav">
      <legend className="visually-hidden">View</legend>
      <button
        aria-label="Zoom in"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => onZoom(zoomedBy(zoom, 1))}
        title="Zoom in"
        type="button"
      >
        +
      </button>
      <input
        aria-label="Zoom"
        aria-orientation="vertical"
        aria-valuetext={`${across} tiles across`}
        className="map-nav__slider"
        max={SLIDER_STEPS}
        min={0}
        onChange={(event) => onZoom(zoomFromSlider(Number(event.target.value)))}
        step={1}
        type="range"
        value={sliderFromZoom(zoom)}
      />
      <button
        aria-label="Zoom out"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => onZoom(zoomedBy(zoom, -1))}
        title="Zoom out"
        type="button"
      >
        −
      </button>
      <output aria-live="off" className="map-nav__readout" title={`${across} tiles across`}>
        {across}
      </output>
      <button aria-label={home} onClick={onHome} title={home} type="button">
        <Icon d={HOUSE} />
      </button>
      <button
        aria-label={fitLabel}
        aria-pressed={fitted}
        onClick={onFit}
        title={fitLabel}
        type="button"
      >
        <Icon d={FRAME} />
      </button>
      {sized && (
        <button
          aria-label="Default map size"
          onClick={() => setMapPrefs({ size: null })}
          title="Default map size"
          type="button"
        >
          <Icon d={SHRINK} />
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

/** The colour switch in the map's top-left corner — as drawn, or by alliance
 * rank — and, by rank, what each colour means.
 *
 * NEVER COLOUR ALONE (NFR-011). Every base still carries its member's name,
 * and the key gives each colour its rank in words and a count, so the colours
 * are a quicker way to read what is already written down.
 *
 * FOLDED ON A SMALL MAP. On a phone the list covered a third of the picture,
 * names included, so there it hides behind a Key button; on a map with room
 * the button is not drawn and the list is always open (index.css). */
export function MapKey({ colourBy, tally }: { colourBy: ColourBy; tally: RankTally }) {
  const [open, setOpen] = useState(false);
  return (
    <fieldset className={open ? 'map-key map-key--open' : 'map-key'}>
      <legend className="visually-hidden">Base colours</legend>
      <div className="map-key__switch">
        <button
          aria-pressed={colourBy === 'plan'}
          onClick={() => setMapPrefs({ colourBy: 'plan' })}
          title="Bases in the colours they were drawn in"
          type="button"
        >
          Drawn
        </button>
        <button
          aria-pressed={colourBy === 'rank'}
          onClick={() => setMapPrefs({ colourBy: 'rank' })}
          title="Bases coloured by alliance rank, R1 to R5"
          type="button"
        >
          Rank
        </button>
        {colourBy === 'rank' && (
          <button
            aria-expanded={open}
            className="map-key__more"
            onClick={() => setOpen(!open)}
            type="button"
          >
            Key
          </button>
        )}
      </div>
      {colourBy === 'rank' && (
        <ul aria-label="Rank colours" className="map-key__legend">
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
            <li className="subtle">No member bases</li>
          )}
        </ul>
      )}
    </fieldset>
  );
}
