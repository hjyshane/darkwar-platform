import { describe, expect, it } from 'vitest';
import { MAP_IMAGE_HEIGHT, MAP_IMAGE_WIDTH, checkMapImageSize } from './mapLayout';

/** Direct tests of checkMapImageSize — the decision that used to be
 * reimplemented once in the dashboard's MapCanvas.tsx (React, onLoad) and
 * once in the desktop app's mapView.ts (plain DOM, load event listener). Both
 * now call this and only decide where to put the resulting text, so this is
 * the one place the comparison and its wording are tested. */

describe('checkMapImageSize', () => {
  it('returns null when the picture matches the size MAP_INSET was measured against', () => {
    expect(checkMapImageSize(MAP_IMAGE_WIDTH, MAP_IMAGE_HEIGHT)).toBeNull();
  });

  it('complains when only the width disagrees', () => {
    const message = checkMapImageSize(MAP_IMAGE_WIDTH - 1, MAP_IMAGE_HEIGHT);
    expect(message).not.toBeNull();
    expect(message).toContain(`${MAP_IMAGE_WIDTH - 1}x${MAP_IMAGE_HEIGHT}`);
    expect(message).toContain(`${MAP_IMAGE_WIDTH}x${MAP_IMAGE_HEIGHT}`);
  });

  it('complains when only the height disagrees', () => {
    const message = checkMapImageSize(MAP_IMAGE_WIDTH, MAP_IMAGE_HEIGHT - 1);
    expect(message).not.toBeNull();
    expect(message).toContain(`${MAP_IMAGE_WIDTH}x${MAP_IMAGE_HEIGHT - 1}`);
    expect(message).toContain(`${MAP_IMAGE_WIDTH}x${MAP_IMAGE_HEIGHT}`);
  });

  it('names both the expected and the actual size, so whoever replaced the picture knows what it should have been', () => {
    const message = checkMapImageSize(1600, 1200);
    expect(message).toContain('1600x1200');
    expect(message).toContain(`${MAP_IMAGE_WIDTH}x${MAP_IMAGE_HEIGHT}`);
  });
});
