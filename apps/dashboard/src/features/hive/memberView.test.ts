// The picture every member sees.
//
// It drew Frankie as a 3x3 base numbered "1" and a boundary marker as a
// numbered base, because the members' grid numbered every tile by its
// ordinal and passed no size or kind. And it opened on a fixed zoom round the
// anchor, so on a real hive most members had to pan to find themselves.

import { describe, expect, test } from 'vitest';
import { footprintOf, memberNumbering, tileCaption } from '../../lib/hiveFormation';
import { ZOOM_STEPS, windowAround, windowFitting, zoomStep } from './TileGrid';

const base = (dx: number, dy: number) => ({ dx, dy, spanX: 3, spanY: 3, kind: 'base' as const });
const frankie = { dx: 0, dy: 0, spanX: 4, spanY: 3, kind: 'structure' as const };
const marker = (dx: number, dy: number) => ({
  dx,
  dy,
  spanX: 1,
  spanY: 1,
  kind: 'structure' as const,
});

describe('numbers go on member bases and nothing else', () => {
  test('Frankie and boundary markers get no number; bases count from 1, innermost first', () => {
    const tiles = [marker(-20, 0), base(0, 9), frankie, base(0, 3), marker(20, 0)];
    const numbering = memberNumbering(tiles);
    expect([...numbering.values()].sort()).toEqual([1, 2]);
    expect(numbering.get('0,3')).toBe(1);
    expect(numbering.get('0,9')).toBe(2);
    expect(numbering.has('0,0')).toBe(false);
    expect(numbering.has('-20,0')).toBe(false);
  });

  test('a 3x3 alliance building is ground, not a base to number', () => {
    const building = { dx: 6, dy: 0, spanX: 3, spanY: 3, kind: 'structure' as const };
    expect(memberNumbering([frankie, building, base(0, 3)]).has('6,0')).toBe(false);
  });
});

describe('what a tile says', () => {
  const label = (text: string) => ({ label: text });

  test('Frankie says Frankie', () => {
    expect(tileCaption({ ...frankie, ...label('Frankie') }, null, undefined)).toBe('Frankie');
  });

  test('ground with no label says nothing — never a number, never "?"', () => {
    expect(tileCaption({ ...marker(1, 1), ...label('') }, null, undefined)).toBeUndefined();
    expect(tileCaption({ ...marker(1, 1), ...label('  ') }, null, 4)).toBeUndefined();
  });

  test('a member base names who stands on it, else its fill number', () => {
    expect(tileCaption({ ...base(0, 3), ...label('') }, 'Mira', 1)).toBe('Mira');
    expect(tileCaption({ ...base(0, 3), ...label('') }, null, 7)).toBe('7');
  });

  test('the catalogue\'s "Member base" label does not replace the number', () => {
    // Loading that catalogue entry stamps its name on every base drawn; eighty
    // empty tiles reading "Member base" would say nothing about the fill.
    expect(tileCaption({ ...base(0, 3), ...label('Member base') }, null, 3)).toBe('3');
  });
});

describe('the picture opens on the whole formation', () => {
  const boxes = [
    footprintOf({ x: 500, y: 500 }, 3, 3),
    footprintOf({ x: 530, y: 470 }, 3, 3),
    footprintOf({ x: 488, y: 512 }, 3, 3),
  ];

  test('every base is inside the window', () => {
    const fit = windowFitting(boxes);
    expect(fit).not.toBeNull();
    if (fit === null) {
      return;
    }
    const view = windowAround(fit.centre, fit.radius);
    for (const box of boxes) {
      expect(box.x0).toBeGreaterThanOrEqual(view.xMin);
      expect(box.x1).toBeLessThanOrEqual(view.xMax);
      expect(box.y0).toBeGreaterThanOrEqual(view.yMin);
      expect(box.y1).toBeLessThanOrEqual(view.yMax);
    }
  });

  test('three bases are not blown up past the closest zoom step', () => {
    const fit = windowFitting([footprintOf({ x: 500, y: 500 }, 3, 3)]);
    expect(fit?.radius).toBe(ZOOM_STEPS[0]);
  });

  test('nothing drawn is no fit', () => {
    expect(windowFitting([])).toBeNull();
  });

  test('from a fitted radius, one notch goes to the nearest step that way', () => {
    // 18 sits between the 14 and 22 steps.
    expect(zoomStep(18, 1)).toBe(14);
    expect(zoomStep(18, -1)).toBe(22);
    // Past either end there is nowhere further to go.
    expect(zoomStep(50, -1)).toBe(50);
    expect(zoomStep(5, 1)).toBe(5);
  });
});
