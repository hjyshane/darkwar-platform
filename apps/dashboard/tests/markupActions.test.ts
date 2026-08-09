// The toolbar's behaviour, which is where a hand-rolled editor usually goes
// wrong. Every test here is a case that makes a button feel broken rather than
// throw anything.
import { describe, expect, test } from 'vitest';
import {
  applyColour,
  applyMarkup,
  insertImage,
  insertText,
  toggleImageWidth,
} from '../src/lib/markupActions';

describe('bold, italic, code', () => {
  // With nothing selected the caret has to end up BETWEEN the markers. After
  // them, the next keystroke gives `**bold**text`.
  test('with nothing selected, the caret lands between the markers', () => {
    const applied = applyMarkup('', { start: 0, end: 0 }, 'bold');
    expect(applied.body).toBe('****');
    expect(applied.selection).toEqual({ start: 2, end: 2 });
  });

  test('a selection is wrapped and stays selected', () => {
    const applied = applyMarkup('go now', { start: 3, end: 6 }, 'bold');
    expect(applied.body).toBe('go **now**');
    expect(applied.body.slice(applied.selection.start, applied.selection.end)).toBe('now');
  });

  // The one that makes a toolbar look broken: pressing bold on bold text should
  // take it off. Adding again gives `****a****`, which renders as asterisks.
  test('pressing it again unwraps, whether the markers are inside the selection', () => {
    const applied = applyMarkup('go **now**', { start: 3, end: 10 }, 'bold');
    expect(applied.body).toBe('go now');
    expect(applied.body.slice(applied.selection.start, applied.selection.end)).toBe('now');
  });

  test('or just outside it', () => {
    const applied = applyMarkup('go **now**', { start: 5, end: 8 }, 'bold');
    expect(applied.body).toBe('go now');
    expect(applied.body.slice(applied.selection.start, applied.selection.end)).toBe('now');
  });

  test('italic and code use their own markers', () => {
    expect(applyMarkup('a', { start: 0, end: 1 }, 'italic').body).toBe('*a*');
    expect(applyMarkup('a', { start: 0, end: 1 }, 'code').body).toBe('`a`');
  });
});

describe('link', () => {
  // The URL is selected afterwards so the next keystroke replaces it. Somebody
  // who pressed the button wants to type an address, not hunt for the brackets.
  test('the placeholder url is selected, ready to be typed over', () => {
    const applied = applyMarkup('', { start: 0, end: 0 }, 'link');
    expect(applied.body).toBe('[text](https://)');
    expect(applied.body.slice(applied.selection.start, applied.selection.end)).toBe('https://');
  });

  test('a selection becomes the link text', () => {
    const applied = applyMarkup('see the board', { start: 4, end: 13 }, 'link');
    expect(applied.body).toBe('see [the board](https://)');
    expect(applied.body.slice(applied.selection.start, applied.selection.end)).toBe('https://');
  });
});

describe('bullets and indentation', () => {
  test('a bullet is added to the line the caret is on', () => {
    const applied = applyMarkup('do this', { start: 3, end: 3 }, 'bullet');
    expect(applied.body).toBe('- do this');
  });

  test('every line the selection touches gets one', () => {
    const applied = applyMarkup('a\nb\nc', { start: 0, end: 5 }, 'bullet');
    expect(applied.body).toBe('- a\n- b\n- c');
  });

  // Off if they all have one already, or a list turns into `- - a`.
  test('pressing it again takes them off', () => {
    const applied = applyMarkup('- a\n- b', { start: 0, end: 7 }, 'bullet');
    expect(applied.body).toBe('a\nb');
  });

  // Two spaces is what the parser reads as a sub-bullet and what Discord reads
  // the same way, so an indented bullet survives being published.
  test('indent is two spaces, and outdent takes them back', () => {
    const indented = applyMarkup('- b', { start: 0, end: 3 }, 'indent');
    expect(indented.body).toBe('  - b');
    expect(applyMarkup(indented.body, indented.selection, 'outdent').body).toBe('- b');
  });

  test('outdent on an unindented line does nothing harmful', () => {
    expect(applyMarkup('- b', { start: 0, end: 3 }, 'outdent').body).toBe('- b');
  });
});

describe('headings', () => {
  test('a heading is added and removed', () => {
    const on = applyMarkup('Setup', { start: 0, end: 5 }, 'heading2');
    expect(on.body).toBe('## Setup');
    expect(applyMarkup(on.body, on.selection, 'heading2').body).toBe('Setup');
  });

  // Switching level replaces rather than stacking: `### ## Setup` is not a
  // heading of either kind.
  test('switching level replaces the marker', () => {
    const two = applyMarkup('Setup', { start: 0, end: 5 }, 'heading2');
    expect(applyMarkup(two.body, two.selection, 'heading3').body).toBe('### Setup');
  });
});

describe('the affected block stays selected', () => {
  // So pressing a line button twice toggles the same lines rather than a
  // drifting subset of them.
  test('after a line action the whole block is selected', () => {
    const applied = applyMarkup('a\nb', { start: 1, end: 1 }, 'bullet');
    expect(applied.body.slice(applied.selection.start, applied.selection.end)).toBe('- a');
  });
});

describe('insertImage', () => {
  const URL = 'http://127.0.0.1:54321/storage/v1/object/public/post-images/u/1.png';

  // On its own line, because `parse` only reads it as an image when the line holds
  // nothing else. Dropped mid-sentence it would render as literal text, which
  // looks exactly like the upload failing.
  test('an image lands on a line of its own', () => {
    const applied = insertImage('before after', { start: 6, end: 6 }, URL);
    expect(applied.body).toBe(`before

![describe the picture](${URL})

 after`);
  });

  test('an empty body needs no leading blank line', () => {
    const applied = insertImage('', { start: 0, end: 0 }, URL);
    expect(applied.body).toBe(`![describe the picture](${URL})`);
  });

  // A body already ending in a blank line does not need two more.
  test('existing blank lines are not doubled', () => {
    const applied = insertImage('text\n\n', { start: 6, end: 6 }, URL);
    expect(applied.body).toBe(`text

![describe the picture](${URL})`);
  });

  // The one moment somebody might actually write alt text is when the cursor is
  // already on it.
  test('the alt text is left selected, ready to be typed over', () => {
    const applied = insertImage('', { start: 0, end: 0 }, URL);
    expect(applied.body.slice(applied.selection.start, applied.selection.end)).toBe(
      'describe the picture',
    );
  });
});

// Colour, and the same three behaviours the symmetric wrappers have — a button
// that only ever adds markers produces `[[a]{red}]{red}` on the second press.
test('colour wraps the selection', () => {
  expect(applyColour('rally now', { start: 6, end: 9 }, 'red')).toEqual({
    body: 'rally [now]{red}',
    selection: { start: 7, end: 10 },
  });
});

test('colour on an already coloured selection takes it off', () => {
  expect(applyColour('go [now]{red}', { start: 3, end: 13 }, 'red')).toEqual({
    body: 'go now',
    selection: { start: 3, end: 6 },
  });
});

test('colour with nothing selected leaves a placeholder selected', () => {
  // Not a caret between markers: `[]{red}` looks like a caret anywhere else, and
  // the writer cannot see what they are about to affect.
  expect(applyColour('go ', { start: 3, end: 3 }, 'mark')).toEqual({
    body: 'go [text]{mark}',
    selection: { start: 4, end: 8 },
  });
});

test('emoji is inserted at the caret and replaces a selection', () => {
  expect(insertText('go now', { start: 3, end: 6 }, '🔥')).toEqual({
    body: 'go 🔥',
    selection: { start: 5, end: 5 },
  });
});

// The author's width choice. The caret only has to be ON the image line —
// pressing the button with the cursor at the end of it is what people do.
test('wide is toggled on the image line the caret sits in', () => {
  const body = 'before\n![map](x)\nafter';
  const on = toggleImageWidth(body, { start: 16, end: 16 });
  expect(on.body).toBe('before\n![map](x){wide}\nafter');
  const off = toggleImageWidth(on.body, { start: 10, end: 10 });
  expect(off.body).toBe(body);
});

test('wide does nothing to a line that is not an image', () => {
  const body = 'just a sentence';
  expect(toggleImageWidth(body, { start: 4, end: 4 })).toEqual({
    body,
    selection: { start: 4, end: 4 },
  });
});
