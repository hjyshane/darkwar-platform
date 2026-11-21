// Which kinds of thing the map draws (operator, 2026-11-20: "everything shows
// at once and it is confusing").
//
// Five layers, each on or off: the three kinds of pin and the bases split by
// shield. A layer that is off is not drawn at all — not dimmed, as the sidebar
// filters do — because the point is fewer things on the picture. The choice is
// per browser, in localStorage, like the theme: it is a reading preference,
// not state anyone else needs.
import { type AtlasBase, isShielded } from './atlas';

export type MapLayer = 'trucks' | 'missions' | 'treasure' | 'shielded' | 'open';

export type MapLayers = Readonly<Record<MapLayer, boolean>>;

export const MAP_LAYERS: ReadonlyArray<{ id: MapLayer; label: string }> = [
  { id: 'trucks', label: '◆ Trucks' },
  { id: 'missions', label: '■ Plunder missions' },
  { id: 'treasure', label: '✦ Treasure spots' },
  { id: 'shielded', label: '🛡 Shielded bases' },
  { id: 'open', label: 'Bases without shield' },
];

export const ALL_LAYERS: MapLayers = {
  trucks: true,
  missions: true,
  treasure: true,
  shielded: true,
  open: true,
};

const KEY = 'dw-map-layers';

/** Only the layers that are OFF are stored, so a layer added later starts on
 * for everyone and nothing has to be migrated. */
export function readLayers(): MapLayers {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === null) return ALL_LAYERS;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return ALL_LAYERS;
    const off = new Set(parsed.filter((item): item is string => typeof item === 'string'));
    const layers = { ...ALL_LAYERS };
    for (const { id } of MAP_LAYERS) if (off.has(id)) layers[id] = false;
    return layers;
  } catch {
    return ALL_LAYERS;
  }
}

export function storeLayers(layers: MapLayers): void {
  try {
    const off = MAP_LAYERS.filter(({ id }) => !layers[id]).map(({ id }) => id);
    if (off.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(off));
  } catch {
    // Storage switched off: the choice still holds for this visit.
  }
}

/** The bases the map draws: all of them when both base layers are on, else
 * only those whose shield state is wanted. */
export function visibleBases<T extends Pick<AtlasBase, 'shieldEnd'>>(
  bases: readonly T[],
  layers: MapLayers,
  now: Date,
): T[] {
  if (layers.shielded && layers.open) return [...bases];
  return bases.filter((base) => (isShielded(base, now) ? layers.shielded : layers.open));
}

/** How many of the five are off, for the pill's badge. */
export function hiddenCount(layers: MapLayers): number {
  return MAP_LAYERS.filter(({ id }) => !layers[id]).length;
}
