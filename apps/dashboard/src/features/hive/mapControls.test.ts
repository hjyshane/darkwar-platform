// The controls under the hive maps: the zoom slider, the rank legend, and the
// per-browser size and colour choice.

import { describe, expect, test } from 'vitest';
import { rankTally, sliderFromZoom, zoomFromSlider } from './MapControls';
import { ZOOM_MAX, ZOOM_MIN, windowRadius } from './TileGrid';
import { DEFAULT_PREFS, MAP_SIZE_MAX, MAP_SIZE_MIN, mapSizeProps, parsePrefs } from './mapPrefs';

describe('the zoom slider', () => {
  test('left is the widest view and right the closest, like the + beside it', () => {
    expect(zoomFromSlider(0)).toBeCloseTo(ZOOM_MAX, 6);
    expect(zoomFromSlider(100)).toBeCloseTo(ZOOM_MIN, 6);
    expect(sliderFromZoom(ZOOM_MAX)).toBe(0);
    expect(sliderFromZoom(ZOOM_MIN)).toBe(100);
  });

  test('a hive-sized view is mid-slider, not crammed into the first third', () => {
    // Logarithmic: 29 tiles across (radius 14) sat at 11% of a straight scale.
    const position = sliderFromZoom(14);
    expect(position).toBeGreaterThan(30);
    expect(position).toBeLessThan(70);
  });

  test('moving the slider and reading it back lands on the same window', () => {
    for (let position = 0; position <= 100; position += 1) {
      const zoom = zoomFromSlider(position);
      expect(Math.abs(sliderFromZoom(zoom) - position)).toBeLessThanOrEqual(1);
      expect(windowRadius(zoom)).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(windowRadius(zoom)).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });

  test('a zoom off either end still reads as an end, not as NaN', () => {
    expect(sliderFromZoom(0)).toBe(100);
    expect(sliderFromZoom(10_000)).toBe(0);
  });
});

describe('the rank legend', () => {
  test('counts each rank, R5 first, and only ranks somebody holds', () => {
    const tally = rankTally([{ rank: 3 }, { rank: 5 }, { rank: 3 }, { rank: 1 }, {}]);
    expect(tally.ranks).toEqual([
      { key: 'r5', label: 'R5', count: 1 },
      { key: 'r3', label: 'R3', count: 2 },
      { key: 'r1', label: 'R1', count: 1 },
    ]);
    expect(tally.vacant).toBe(0);
  });

  test('empty bases and unknown ranks are said, not dropped', () => {
    const tally = rankTally([{ vacant: true }, { vacant: true }, { rank: null }, { rank: 4 }]);
    expect(tally.vacant).toBe(2);
    expect(tally.ranks.map((entry) => entry.key)).toEqual(['r4', 'r0']);
  });

  test('ground, which carries no rank at all, is not counted', () => {
    // Frankie and the boundary keep their painted colour and are no part of
    // the legend.
    expect(rankTally([{}, {}, {}])).toEqual({ ranks: [], vacant: 0 });
  });
});

describe('what this browser remembers', () => {
  test('nothing stored is the page as it shipped', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toEqual({ size: null, colourBy: 'plan' });
  });

  test('garbage reads as the defaults rather than throwing', () => {
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('null')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('42')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"size":"big","colourBy":"rainbow"}')).toEqual(DEFAULT_PREFS);
  });

  test('a size from somewhere else is held inside the range', () => {
    expect(parsePrefs('{"size":90000}').size).toBe(MAP_SIZE_MAX);
    expect(parsePrefs('{"size":3}').size).toBe(MAP_SIZE_MIN);
    expect(parsePrefs('{"size":901.6,"colourBy":"rank"}')).toEqual({ size: 902, colourBy: 'rank' });
  });

  test('the page layout is untouched until somebody resizes', () => {
    expect(mapSizeProps(null)).toEqual({ className: '', style: undefined });
    expect(mapSizeProps(960)).toEqual({
      className: 'hive-map--sized',
      style: { '--hive-map-size': '960px' },
    });
  });
});
