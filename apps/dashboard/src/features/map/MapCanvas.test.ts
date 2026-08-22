import { expect, test } from 'vitest';
import { LABEL_LIMIT, MAP_IMAGE_URL, MAP_INSET } from './MapCanvas';

// The picture the inset was measured against. If a new map is dropped in at a
// different size these numbers are wrong, and the calibration toggle is how
// you find that out.
const IMAGE_WIDTH = 3164;
const IMAGE_HEIGHT = 2664;
const FRAME_PX = 55;

test('the image is named for the format it actually is', () => {
  // It arrived as map.png.webp. Browsers sniff the bytes and would render it
  // either way, which is what makes a lying extension survive unnoticed.
  expect(MAP_IMAGE_URL.endsWith('.webp')).toBe(true);
});

test('the map does not start at the image corner', () => {
  // THE BUG THIS PREVENTS. A zero inset stretches the whole picture — frame
  // included — across the plot, and puts every marker out by the thickness of
  // that frame. Wrong everywhere, and by a consistent amount, so it reads as
  // plausible rather than broken.
  expect(MAP_INSET.left).toBeGreaterThan(0);
  expect(MAP_INSET.top).toBeGreaterThan(0);
});

test('the inset is the measured 55px frame on every side', () => {
  expect(MAP_INSET.left).toBeCloseTo(FRAME_PX / IMAGE_WIDTH, 6);
  expect(MAP_INSET.right).toBeCloseTo(FRAME_PX / IMAGE_WIDTH, 6);
  expect(MAP_INSET.top).toBeCloseTo(FRAME_PX / IMAGE_HEIGHT, 6);
  expect(MAP_INSET.bottom).toBeCloseTo(FRAME_PX / IMAGE_HEIGHT, 6);
});

test('the frame is symmetric, as the picture is', () => {
  // Measured equal on all four sides. An asymmetric inset would mean either a
  // different picture or a mis-measurement, and both deserve a failing test.
  expect(MAP_INSET.left).toBe(MAP_INSET.right);
  expect(MAP_INSET.top).toBe(MAP_INSET.bottom);
});

test('the interior is most of the picture, not a sliver or the whole of it', () => {
  // A guard against a fat-fingered value: 55/3164 is under two percent, and
  // anything approaching half would mean the frame had swallowed the world.
  const across = 1 - MAP_INSET.left - MAP_INSET.right;
  const down = 1 - MAP_INSET.top - MAP_INSET.bottom;

  expect(across).toBeGreaterThan(0.9);
  expect(across).toBeLessThan(1);
  expect(down).toBeGreaterThan(0.9);
  expect(down).toBeLessThan(1);
});

test('a tile is wider than it is tall in this picture, and that is fine', () => {
  // 3054 x 2554 for a 1000 x 1000 grid. Stated as a test so that somebody
  // meeting the non-square tiles later finds them recorded as intended rather
  // than reaching for a "fix" that would squash the map.
  const tileWidth = (IMAGE_WIDTH - 2 * FRAME_PX) / 1000;
  const tileHeight = (IMAGE_HEIGHT - 2 * FRAME_PX) / 1000;

  expect(tileWidth).toBeCloseTo(3.054, 3);
  expect(tileHeight).toBeCloseTo(2.554, 3);
  expect(tileWidth).toBeGreaterThan(tileHeight);
});

test('labels are dropped once the map is crowded', () => {
  // A hundred name tags on a 900px map overlap into a grey mass and hide the
  // dots, which are the part carrying the information. The list beside the
  // map does the naming instead.
  expect(LABEL_LIMIT).toBeGreaterThan(1);
  expect(LABEL_LIMIT).toBeLessThan(30);
});
