import { describe, expect, it } from 'vitest';
import {
  FOCUS_ZOOM,
  HOME,
  MAX_ZOOM,
  centreOn,
  clampView,
  pictureFraction,
  zoomAt,
} from './PannableMap';

describe('clampView', () => {
  it('keeps the picture covering the window', () => {
    expect(clampView({ zoom: 2, x: 50, y: 50 }, 400, 300)).toEqual({ zoom: 2, x: 0, y: 0 });
    expect(clampView({ zoom: 2, x: -999, y: -999 }, 400, 300)).toEqual({
      zoom: 2,
      x: -400,
      y: -300,
    });
  });

  it('does not zoom out past the whole map or in past the limit', () => {
    expect(clampView({ zoom: 0.2, x: 0, y: 0 }, 400, 300).zoom).toBe(1);
    expect(clampView({ zoom: 99, x: 0, y: 0 }, 400, 300).zoom).toBe(MAX_ZOOM);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor where it was', () => {
    const next = zoomAt(HOME, 2, 200, 150, 400, 300);

    expect(next.zoom).toBe(2);
    // The cursor sat at 200 px; the picture point under it is still at 200 px.
    expect(200 - next.x).toBe(next.zoom * 200);
  });
});

describe('centreOn', () => {
  it('puts the tile in the middle of the window', () => {
    const at = { x: 500, y: 500 };
    const view = centreOn(at, FOCUS_ZOOM, 900, 700);
    const { fx, fy } = pictureFraction(at);

    expect(view.x + fx * 900 * view.zoom).toBeCloseTo(450, 0);
    expect(view.y + fy * 700 * view.zoom).toBeCloseTo(350, 0);
  });

  it('stops at the edge for a tile in a corner', () => {
    const view = centreOn({ x: 0, y: 999 }, FOCUS_ZOOM, 900, 700);

    expect(view.x).toBe(0);
    expect(view.y).toBe(0);
  });
});
