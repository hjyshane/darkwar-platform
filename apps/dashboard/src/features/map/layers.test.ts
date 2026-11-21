import { afterEach, describe, expect, it } from 'vitest';
import {
  ALL_LAYERS,
  MAP_LAYERS,
  hiddenCount,
  readLayers,
  storeLayers,
  visibleBases,
} from './layers';

const now = new Date('2026-11-20T12:00:00Z');
const shielded = { shieldEnd: new Date('2026-11-21T00:00:00Z'), name: 'up' };
const lapsed = { shieldEnd: new Date('2026-11-19T00:00:00Z'), name: 'lapsed' };
const never = { shieldEnd: null, name: 'none' };

describe('visibleBases', () => {
  it('keeps every base while both base layers are on', () => {
    expect(visibleBases([shielded, lapsed, never], ALL_LAYERS, now)).toHaveLength(3);
  });

  it('drops shielded bases when that layer is off', () => {
    const shown = visibleBases([shielded, lapsed, never], { ...ALL_LAYERS, shielded: false }, now);
    expect(shown.map((b) => b.name)).toEqual(['lapsed', 'none']);
  });

  it('treats a lapsed shield as no shield', () => {
    const shown = visibleBases([shielded, lapsed, never], { ...ALL_LAYERS, open: false }, now);
    expect(shown.map((b) => b.name)).toEqual(['up']);
  });

  it('draws nothing when both base layers are off', () => {
    expect(
      visibleBases([shielded, never], { ...ALL_LAYERS, shielded: false, open: false }, now),
    ).toEqual([]);
  });
});

describe('layer storage', () => {
  afterEach(() => localStorage.clear());

  it('starts with everything on', () => {
    expect(readLayers()).toEqual(ALL_LAYERS);
    expect(hiddenCount(ALL_LAYERS)).toBe(0);
  });

  it('round-trips the layers switched off', () => {
    const chosen = { ...ALL_LAYERS, trucks: false, open: false };
    storeLayers(chosen);
    expect(readLayers()).toEqual(chosen);
    expect(hiddenCount(chosen)).toBe(2);
  });

  it('removes the key once everything is on again', () => {
    storeLayers({ ...ALL_LAYERS, treasure: false });
    storeLayers(ALL_LAYERS);
    expect(localStorage.getItem('dw-map-layers')).toBeNull();
  });

  it('ignores a stored value it does not recognise', () => {
    localStorage.setItem('dw-map-layers', '{"trucks":false}');
    expect(readLayers()).toEqual(ALL_LAYERS);
    localStorage.setItem('dw-map-layers', 'not json');
    expect(readLayers()).toEqual(ALL_LAYERS);
    localStorage.setItem('dw-map-layers', '["unknown-layer", "missions"]');
    expect(readLayers()).toEqual({ ...ALL_LAYERS, missions: false });
  });

  it('lists each layer exactly once', () => {
    expect(new Set(MAP_LAYERS.map((l) => l.id)).size).toBe(MAP_LAYERS.length);
    expect(MAP_LAYERS.map((l) => l.id).sort()).toEqual(Object.keys(ALL_LAYERS).sort());
  });
});
