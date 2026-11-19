// How the hive maps are shown in THIS browser: how big the map is drawn, and
// whether bases are coloured by the plan or by the member's alliance rank.
//
// PER BROWSER, NOT PER PLAN. Both are about the reader's screen and eyes, not
// about the formation — an officer on a laptop and the same officer on a 4K
// monitor want different sizes, and neither choice means anything to anybody
// else. So localStorage, like the theme and the sidebar, and never the row.
//
// ONE STORE FOR BOTH MAPS. The members' picture and the editor are mounted at
// the same time (the editor is hidden, not unmounted, on the plan tab), so a
// size held in each component's own state would drift apart the moment one of
// them was resized.

import { type CSSProperties, useSyncExternalStore } from 'react';

const KEY = 'dw-hive-map';

/** What a base's colour says. `plan` is the colour an officer painted it. */
export type ColourBy = 'plan' | 'rank';

export interface MapPrefs {
  /** The grid's width in CSS pixels, or null for the page's own layout (the
   * 720px cap that shipped before the map could be resized). */
  size: number | null;
  colourBy: ColourBy;
}

/** Smallest and largest a viewer may drag the map to, in CSS pixels. The
 * floor is a phone's width less its axis labels; the ceiling is past any
 * screen, so it is the window that stops the drag rather than this. */
export const MAP_SIZE_MIN = 240;
export const MAP_SIZE_MAX = 2400;

export const DEFAULT_PREFS: MapPrefs = { size: null, colourBy: 'plan' };

export function clampMapSize(size: number): number {
  return Math.round(Math.min(MAP_SIZE_MAX, Math.max(MAP_SIZE_MIN, size)));
}

/** Whatever was stored, made safe. A value written by an older build, edited
 * by hand, or simply garbage reads as the defaults rather than as a map
 * 9,000px wide or a colour mode nothing draws. */
export function parsePrefs(raw: string | null): MapPrefs {
  if (raw === null) {
    return DEFAULT_PREFS;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) {
      return DEFAULT_PREFS;
    }
    const { size, colourBy } = value as Record<string, unknown>;
    return {
      size: typeof size === 'number' && Number.isFinite(size) ? clampMapSize(size) : null,
      colourBy: colourBy === 'rank' ? 'rank' : 'plan',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function readStored(): MapPrefs {
  try {
    return parsePrefs(window.localStorage.getItem(KEY));
  } catch {
    // Storage blocked (a private window, site data refused): the defaults.
    return DEFAULT_PREFS;
  }
}

let current: MapPrefs = typeof window === 'undefined' ? DEFAULT_PREFS : readStored();
const listeners = new Set<() => void>();

function getPrefs(): MapPrefs {
  return current;
}

export function setMapPrefs(patch: Partial<MapPrefs>): void {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // A blocked storage only means the choice does not survive a reload.
  }
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMapPrefs(): MapPrefs {
  return useSyncExternalStore(subscribe, getPrefs, () => DEFAULT_PREFS);
}

/** The class and custom property a page puts on the box that holds a map, so
 * the layout around the grid follows the chosen size. Nothing at all for the
 * page's own layout, which is what keeps that layout exactly as it was. */
export function mapSizeProps(size: number | null): {
  className: string;
  style: CSSProperties | undefined;
} {
  return size === null
    ? { className: '', style: undefined }
    : {
        className: 'hive-map--sized',
        style: { '--hive-map-size': `${size}px` } as CSSProperties,
      };
}
