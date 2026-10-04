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

// THE READER'S OWN TILE, which broke the same way the grid's background did:
// a marker written as a `background` and a `border-color`, with eight per-tile
// colour rules declared after it setting both. Measured in a browser before
// the fix — `--own` plus `--violet` gave a violet fill, a violet border and no
// marker of any kind, and `--own` plus `--green` was indistinguishable from
// the marker itself, so every green tile read as yours.
//
// Values are not what this pins. It pins that the marker is carried by a
// property the colour rules cannot reach, and that none of the ones they CAN
// reach has crept back in.

/** The declaration block for exactly one `.tile-grid__base--…` modifier. */
function modifier(name: string): string {
  const pattern = new RegExp(`\\.tile-grid__base--${name}\\s*\\{([^{}]*)\\}`, 'g');
  const found = [...css.matchAll(pattern)];
  // One block, or the cascade decides which half of the marker applies.
  expect(found).toHaveLength(1);
  return found[0]?.[1] ?? '';
}

/** Every property the per-tile colour rules set, and so can override. */
const COLOUR_PROPERTIES = ['slate', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink']
  .flatMap((colour) => modifier(colour).split(';'))
  .map((line) => line.split(':')[0]?.trim() ?? '')
  .filter((property) => property !== '');

test('the colour rules set background and border-color, and nothing else', () => {
  // If this ever grows, the assertion below is testing less than it says.
  expect([...new Set(COLOUR_PROPERTIES)].sort()).toEqual(['background', 'border-color']);
});

test('the own-tile marker is carried by a property the colours cannot reach', () => {
  expect(modifier('own')).toContain('outline:');
});

test('and sets nothing a colour rule would silently win', () => {
  const body = modifier('own');

  for (const property of new Set(COLOUR_PROPERTIES)) {
    expect(body).not.toContain(`${property}:`);
  }
  // `border-width` without `border-color` is the half-marker that survives a
  // paint: a thicker edge in the tile's own colour, saying nothing.
  expect(body).not.toContain('border');
});
