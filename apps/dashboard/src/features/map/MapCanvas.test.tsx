import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LABEL_LIMIT, MapCanvas, type MapMarker } from './MapCanvas';

/** MapCanvas.test.ts (kept separate) asserts three exported constants and
 * never renders anything — nothing there would notice a refactor that moved
 * every pin. This file pins what the component actually puts on screen,
 * against the component exactly as it is today, so the next change (moving
 * the layout maths into @dw/ui) has something that fails if it changes the
 * picture. */

afterEach(cleanup);

function marker(x: number, y: number, label: string, extra: Partial<MapMarker> = {}): MapMarker {
  return { at: { x, y }, label, ...extra };
}

function pins(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.map-pin')];
}

describe('MapCanvas: marker position', () => {
  it('places a marker at the position toFraction + MAP_INSET produce', () => {
    // toFraction({x: 249, y: 749}):
    //   left = (249 + 0.5) / 1000        = 249.5 / 1000 = 0.2495 -> "24.95%"
    //   top  = (999 - 749 + 0.5) / 1000  = 250.5 / 1000 = 0.2505 -> "25.05%"
    // (999 - y flips the upside-down axis; the +0.5 lands on the tile centre.)
    // The pin's own `style.left`/`style.top` are exactly this fraction * 100,
    // unadjusted for the plot's inset — the inset is applied once to the
    // `.map-plot` container, not per-pin.
    const { container } = render(<MapCanvas markers={[marker(249, 749, 'Outpost')]} />);
    const [pin] = pins(container);
    expect(pin).toBeDefined();
    expect(pin?.style.left).toBe('24.95%');
    expect(pin?.style.top).toBe('25.05%');
  });

  it('lands the two corners the coordinate system is defined by, opposite each other', () => {
    // (0, 999) is the map's top-left; (999, 0) is its bottom-right.
    //   (0, 999):  left = (0 + 0.5) / 1000       = 0.0005 -> "0.05%"
    //              top  = (999 - 999 + 0.5) / 1000 = 0.0005 -> "0.05%"
    //   (999, 0):  left = (999 + 0.5) / 1000     = 0.9995 -> "99.95%"
    //              top  = (999 - 0 + 0.5) / 1000  = 0.9995 -> "99.95%"
    const { container } = render(
      <MapCanvas markers={[marker(0, 999, 'top-left'), marker(999, 0, 'bottom-right')]} />,
    );
    const [topLeft, bottomRight] = pins(container);
    expect(topLeft?.style.left).toBe('0.05%');
    expect(topLeft?.style.top).toBe('0.05%');
    expect(bottomRight?.style.left).toBe('99.95%');
    expect(bottomRight?.style.top).toBe('99.95%');
  });

  it('drops markers that are off the map rather than drawing them somewhere misleading', () => {
    const { container } = render(<MapCanvas markers={[marker(1000, 500, 'off-map')]} />);
    expect(pins(container)).toHaveLength(0);
  });
});

describe('MapCanvas: faded and highlighted markers', () => {
  it('gives faded and highlighted markers their distinguishing classes', () => {
    const { container } = render(
      <MapCanvas
        markers={[
          marker(1, 1, 'plain'),
          marker(2, 2, 'old-sighting', { faded: true }),
          marker(3, 3, 'picked', { highlighted: true }),
        ]}
      />,
    );
    const [plain, faded, highlighted] = pins(container);
    expect(plain?.className).toBe('map-pin');
    expect(faded?.className).toBe('map-pin map-pin--faded');
    expect(highlighted?.className).toBe('map-pin map-pin--on');
  });
});

describe('MapCanvas: labels', () => {
  it('shows the label as-is, with no character truncation, under LABEL_LIMIT', () => {
    // LABEL_LIMIT gates how many MARKERS get a label shown, not how many
    // characters a label may have — there is no per-label truncation in this
    // component. A long label renders in full as long as the map is not
    // crowded.
    const longLabel = 'A Very Long Alliance Name That Exceeds Eight Characters';
    const { container } = render(<MapCanvas markers={[marker(5, 5, longLabel)]} />);
    const label = container.querySelector('.map-pin__label');
    expect(label?.textContent).toBe(longLabel);
  });

  it('a highlighted marker label carries its coordinate, appended with " · "', () => {
    const { container } = render(
      <MapCanvas markers={[marker(10, 10, 'picked', { highlighted: true })]} />,
    );
    const label = container.querySelector('.map-pin__label');
    expect(label?.textContent).toBe('picked · 10, 10');
  });

  it('every marker keeps its label right at LABEL_LIMIT', () => {
    const atLimit = Array.from({ length: LABEL_LIMIT }, (_, i) => marker(i, i, `m${i}`));
    const { container } = render(<MapCanvas markers={atLimit} />);
    expect(container.querySelectorAll('.map-pin__label')).toHaveLength(LABEL_LIMIT);
  });

  it('drops every label once markers exceed LABEL_LIMIT — this is a count, not a length, limit', () => {
    const tooMany = Array.from({ length: LABEL_LIMIT + 1 }, (_, i) => marker(i, i, `m${i}`));
    const { container } = render(<MapCanvas markers={tooMany} />);
    expect(container.querySelectorAll('.map-pin__label')).toHaveLength(0);
  });

  it('a highlighted marker still gets its label past LABEL_LIMIT; the rest stay unlabeled', () => {
    const tooMany = Array.from({ length: LABEL_LIMIT + 1 }, (_, i) => marker(i, i, `m${i}`));
    const withHighlight = tooMany.map((m, i) => (i === 0 ? { ...m, highlighted: true } : m));
    const { container } = render(<MapCanvas markers={withHighlight} />);
    const labels = container.querySelectorAll('.map-pin__label');
    expect(labels).toHaveLength(1);
    expect(labels[0]?.textContent).toBe('m0 · 0, 0');
  });
});

describe('MapCanvas: calibrate', () => {
  it('adds the calibration class to the plot and draws the two defining corners', () => {
    const { container } = render(<MapCanvas markers={[]} calibrate />);
    const plot = container.querySelector('.map-plot');
    expect(plot?.className).toBe('map-plot map-plot--calibrate');
    expect(container.querySelector('.map-edge--tl')?.textContent).toBe('0, 999');
    expect(container.querySelector('.map-edge--br')?.textContent).toBe('999, 0');
  });

  it('without calibrate, neither the class nor the corner labels appear', () => {
    const { container } = render(<MapCanvas markers={[]} />);
    const plot = container.querySelector('.map-plot');
    expect(plot?.className).toBe('map-plot');
    expect(container.querySelector('.map-edge--tl')).toBeNull();
    expect(container.querySelector('.map-edge--br')).toBeNull();
  });
});

describe('MapCanvas: empty marker list', () => {
  it('renders the map image and no pins', () => {
    const { container } = render(<MapCanvas markers={[]} />);
    expect(container.querySelector('img.map-frame__image')).not.toBeNull();
    expect(pins(container)).toHaveLength(0);
  });
});
