// A mouse's sideways buttons scrolling a wide table.
//
// The assertion that matters most is the one about NOT taking the button: back
// and forward are controls people rely on, and a handler that swallowed them
// everywhere would be worse than the missing feature it fixes.
import { expect, test } from 'vitest';
import { BACK_BUTTON, FORWARD_BUTTON, sidewaysStep } from '../src/lib/tableScroll';

/** A table twice as wide as its frame, scrolled to the given offset. */
function wide(scrollLeft: number) {
  return { scrollLeft, scrollWidth: 2000, clientWidth: 1000 };
}

test('forward scrolls right and back scrolls left', () => {
  expect(sidewaysStep(FORWARD_BUTTON, wide(500))).toBeGreaterThan(0);
  expect(sidewaysStep(BACK_BUTTON, wide(500))).toBeLessThan(0);
});

test('the step is a fraction of what is visible, not a fixed jump', () => {
  // 20% of 1000 against 20% of 400 — a 200px jump on a phone is most of the
  // screen and barely a column on a desktop.
  expect(sidewaysStep(FORWARD_BUTTON, wide(500))).toBe(200);
  expect(
    sidewaysStep(FORWARD_BUTTON, { scrollLeft: 100, scrollWidth: 900, clientWidth: 400 }),
  ).toBe(80);
});

test('a narrow table gets a step you can feel rather than a proportional crumb', () => {
  expect(sidewaysStep(FORWARD_BUTTON, { scrollLeft: 0, scrollWidth: 400, clientWidth: 200 })).toBe(
    64,
  );
});

// Everything below is a press this must NOT take.
test('a table with nothing to scroll leaves the button alone', () => {
  expect(sidewaysStep(FORWARD_BUTTON, { scrollLeft: 0, scrollWidth: 800, clientWidth: 800 })).toBe(
    0,
  );
});

test('at the left edge, back stays Back', () => {
  expect(sidewaysStep(BACK_BUTTON, wide(0))).toBe(0);
  // A fractional scrollLeft from a zoomed page must not swallow the button
  // forever — a leftover half pixel is not a scroll anybody asked for.
  expect(sidewaysStep(BACK_BUTTON, wide(0.5))).toBe(0);
});

test('at the right edge, forward stays Forward', () => {
  expect(sidewaysStep(FORWARD_BUTTON, wide(1000))).toBe(0);
  expect(sidewaysStep(FORWARD_BUTTON, wide(999.5))).toBe(0);
});

test('near an edge it moves only what is left', () => {
  expect(sidewaysStep(FORWARD_BUTTON, wide(950))).toBe(50);
  expect(sidewaysStep(BACK_BUTTON, wide(30))).toBe(-30);
});

test('no other button is touched', () => {
  for (const button of [0, 1, 2, 5]) {
    expect(sidewaysStep(button, wide(500))).toBe(0);
  }
});
