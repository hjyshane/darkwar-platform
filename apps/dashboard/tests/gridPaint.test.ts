// The grid's background has now been broken twice by the same mechanism, so
// it gets an assertion rather than a third comment.
//
// `.tile-grid` is a <button>, and the global `button:hover` rule uses the
// `background` SHORTHAND — which resets background-image, background-size and
// background-position along with the colour. The first fix restated the image
// and the colour on hover and left the size behind, so the gradient fell back
// to `auto`: one line down the left, one across the top, and a grid that still
// looked like it had vanished under the pointer.
//
// The fix is structural: one declaration block, listing both the resting and
// the hover selector, so a partial restore cannot be written. That is what
// this checks — not the values, but that they are still in one place.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'src', 'index.css'), 'utf8');

/** Every `{ ... }` block whose selector list mentions `.tile-grid`. */
function blocksFor(property: string): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(css);
  while (match !== null) {
    const [, selector, body] = match;
    if (body?.includes(property) === true) {
      found.push({ selector: selector?.trim() ?? '', body: body ?? '' });
    }
    match = pattern.exec(css);
  }
  return found;
}

test('the grid paints itself in exactly one place', () => {
  const painters = blocksFor('background-image: var(--grid-lines)');

  expect(painters).toHaveLength(1);
});

test('that one place covers hover, and carries the whole paint', () => {
  const [paint] = blocksFor('background-image: var(--grid-lines)');

  // Both states, or the shorthand wins on one of them.
  expect(paint?.selector).toContain('.tile-grid,');
  expect(paint?.selector).toContain('button.tile-grid:hover:not(:disabled)');

  // All four longhands the `background` shorthand would have reset. Missing
  // background-size is the exact bug that shipped.
  expect(paint?.body).toContain('background-color:');
  expect(paint?.body).toContain('background-image:');
  expect(paint?.body).toContain('background-size:');
  expect(paint?.body).toContain('background-position:');
});
