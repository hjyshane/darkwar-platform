import { describe, expect, it } from 'vitest';
import {
  FOCUS_ZOOM,
  HOME,
  MAX_ZOOM,
  centreOn,
  clampView,
  pictureFraction,
  wheelFactor,
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

describe('wheelFactor', () => {
  it('zooms in for a wheel up and out for a wheel down, by the same amount', () => {
    const up = wheelFactor(-100);
    const down = wheelFactor(100);
    expect(up).toBeGreaterThan(1);
    expect(down).toBeLessThan(1);
    expect(up * down).toBeCloseTo(1, 10);
  });

  it('takes a notch of a mouse as a small step', () => {
    expect(wheelFactor(-100)).toBeLessThan(1.15);
    expect(wheelFactor(-100)).toBeGreaterThan(1.1);
  });

  it('is smooth for a trackpad: ten tiny deltas are about one notch', () => {
    let z = 1;
    for (let i = 0; i < 10; i += 1) z *= wheelFactor(-10);
    expect(z).toBeCloseTo(wheelFactor(-100), 6);
  });

  it('caps a flick so it cannot cross several levels at once', () => {
    expect(wheelFactor(-5000)).toBe(wheelFactor(-240));
  });

  it('counts a line-mode wheel (Firefox) as about the same notch', () => {
    expect(wheelFactor(-3, 1)).toBeGreaterThan(1.1);
    expect(wheelFactor(-3, 1)).toBeLessThan(1.15);
  });
});
