import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapCanvas } from './MapCanvas';

/** Part 3 of the @dw/ui map move: MAP_INSET is fractions measured against a
 * specific 3164x2664 picture, and nothing checked the picture actually
 * loaded was that size. These tests pin the guard added on the image's
 * `load` event — kept in a separate file from MapCanvas.test.tsx, which the
 * task requires stay untouched. */

afterEach(cleanup);

// jsdom does not compute real image geometry, so naturalWidth/naturalHeight
// are stubbed directly on the element the way a real browser would report
// them once the picture has actually loaded.
function fireLoadWithSize(img: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
  fireEvent.load(img);
}

describe('MapCanvas: wrong-sized picture', () => {
  it('shows no warning when the picture loads at the size MAP_INSET was measured against', () => {
    const { container } = render(<MapCanvas markers={[]} />);
    const img = container.querySelector('img.map-frame__image');
    expect(img).not.toBeNull();
    fireLoadWithSize(img as HTMLImageElement, 3164, 2664);
    expect(container.querySelector('.map-size-warning')).toBeNull();
  });

  it('raises a loud, visible warning when the loaded picture is a different size', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<MapCanvas markers={[]} />);
    const img = container.querySelector('img.map-frame__image');
    expect(img).not.toBeNull();
    fireLoadWithSize(img as HTMLImageElement, 1600, 1200);

    const warning = container.querySelector('.map-size-warning');
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain('1600x1200');
    expect(warning?.textContent).toContain('3164x2664');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('1600x1200'));

    errorSpy.mockRestore();
  });

  it('does not blank the map for a mismatched picture — pins still render', () => {
    const { container } = render(
      <MapCanvas markers={[{ at: { x: 5, y: 5 }, label: 'still-here' }]} />,
    );
    const img = container.querySelector('img.map-frame__image');
    fireLoadWithSize(img as HTMLImageElement, 1600, 1200);

    // The warning is present, but so is the map: the frame keeps the image,
    // and the pin the caller asked for is still drawn on it.
    expect(container.querySelector('.map-size-warning')).not.toBeNull();
    expect(container.querySelector('img.map-frame__image')).not.toBeNull();
    expect(container.querySelector('.map-pin')).not.toBeNull();
  });

  it('clears a previously shown warning if a later load reports the right size', () => {
    const { container } = render(<MapCanvas markers={[]} />);
    const img = container.querySelector('img.map-frame__image') as HTMLImageElement;
    fireLoadWithSize(img, 1600, 1200);
    expect(container.querySelector('.map-size-warning')).not.toBeNull();

    fireLoadWithSize(img, 3164, 2664);
    expect(container.querySelector('.map-size-warning')).toBeNull();
  });
});
