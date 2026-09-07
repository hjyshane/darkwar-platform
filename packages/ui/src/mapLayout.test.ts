import { describe, expect, it } from 'vitest';
import { LABEL_LIMIT, type MapMarker, layoutMarkers } from './mapLayout';

/** Direct tests of the pure layout function. MapCanvas.test.tsx (in
 * apps/dashboard) is the rendering-level net and must keep passing unchanged
 * — this file covers the same rules at the level where they actually live
 * now: position maths, the label-limit rule, the highlighted-marker suffix,
 * faded/highlighted classes, and the empty-list case. */

function marker(x: number, y: number, label: string, extra: Partial<MapMarker> = {}): MapMarker {
  return { at: { x, y }, label, ...extra };
}

describe('layoutMarkers: position', () => {
  it('places a marker at the position toFraction produces, as a percentage', () => {
    // toFraction({x: 249, y: 749}):
    //   left = (249 + 0.5) / 1000       = 0.2495 -> "24.95%"
    //   top  = (999 - 749 + 0.5) / 1000 = 0.2505 -> "25.05%"
    const [entry] = layoutMarkers([marker(249, 749, 'Outpost')]);
    expect(entry?.position.left).toBe('24.95%');
    expect(entry?.position.top).toBe('25.05%');
  });

  it('lands the two defining corners opposite each other', () => {
    const [topLeft, bottomRight] = layoutMarkers([
      marker(0, 999, 'top-left'),
      marker(999, 0, 'bottom-right'),
    ]);
    expect(topLeft?.position.left).toBe('0.05%');
    expect(topLeft?.position.top).toBe('0.05%');
    expect(bottomRight?.position.left).toBe('99.95%');
    expect(bottomRight?.position.top).toBe('99.95%');
  });

  it('drops markers that are off the map rather than positioning them somewhere misleading', () => {
    const entries = layoutMarkers([marker(1000, 500, 'off-map')]);
    expect(entries).toHaveLength(0);
  });
});

describe('layoutMarkers: classes', () => {
  it('gives faded and highlighted markers their distinguishing classes', () => {
    const [plain, faded, highlighted] = layoutMarkers([
      marker(1, 1, 'plain'),
      marker(2, 2, 'old-sighting', { faded: true }),
      marker(3, 3, 'picked', { highlighted: true }),
    ]);
    expect(plain?.className).toBe('map-pin');
    expect(faded?.className).toBe('map-pin map-pin--faded');
    expect(highlighted?.className).toBe('map-pin map-pin--on');
  });

  it('adds map-pin--clickable only when the caller asks for it', () => {
    const [withoutOption] = layoutMarkers([marker(1, 1, 'plain')]);
    const [withOption] = layoutMarkers([marker(1, 1, 'plain')], { clickable: true });
    expect(withoutOption?.className).toBe('map-pin');
    expect(withOption?.className).toBe('map-pin map-pin--clickable');
  });
});

describe('layoutMarkers: labels', () => {
  it('shows the label as-is, with no character truncation, under LABEL_LIMIT', () => {
    const longLabel = 'A Very Long Alliance Name That Exceeds Eight Characters';
    const [entry] = layoutMarkers([marker(5, 5, longLabel)]);
    expect(entry?.showLabel).toBe(true);
    expect(entry?.label).toBe(longLabel);
  });

  it('a highlighted marker label carries its coordinate, appended with " · "', () => {
    const [entry] = layoutMarkers([marker(10, 10, 'picked', { highlighted: true })]);
    expect(entry?.label).toBe('picked · 10, 10');
  });

  it('a title always uses "—", distinct from the label\'s "·" separator', () => {
    const [entry] = layoutMarkers([marker(10, 10, 'picked', { highlighted: true })]);
    expect(entry?.title).toBe('picked — 10, 10');
  });

  it('every marker keeps its label right at LABEL_LIMIT', () => {
    const atLimit = Array.from({ length: LABEL_LIMIT }, (_, i) => marker(i, i, `m${i}`));
    const entries = layoutMarkers(atLimit);
    expect(entries.every((entry) => entry.showLabel)).toBe(true);
  });

  it('drops every label once markers exceed LABEL_LIMIT — this is a count, not a length, limit', () => {
    const tooMany = Array.from({ length: LABEL_LIMIT + 1 }, (_, i) => marker(i, i, `m${i}`));
    const entries = layoutMarkers(tooMany);
    expect(entries.every((entry) => entry.showLabel === false)).toBe(true);
  });

  it('a highlighted marker still shows its label past LABEL_LIMIT; the rest stay unlabeled', () => {
    const tooMany = Array.from({ length: LABEL_LIMIT + 1 }, (_, i) => marker(i, i, `m${i}`));
    const withHighlight = tooMany.map((m, i) => (i === 0 ? { ...m, highlighted: true } : m));
    const entries = layoutMarkers(withHighlight);
    const shown = entries.filter((entry) => entry.showLabel);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.label).toBe('m0 · 0, 0');
  });
});

describe('layoutMarkers: empty list', () => {
  it('returns an empty array', () => {
    expect(layoutMarkers([])).toEqual([]);
  });
});
