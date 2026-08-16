// The author's size choice, as it reaches the page.
//
// `richText.test.ts` proves the markup parses to a size. This proves the size
// becomes the right classes — which is where the interesting bug lives, because
// `.rich-image-small img` and `.rich-image-expanded img` cap the same property
// at the same specificity. If both classes were on the figure at once, which
// one won would come down to their order in the stylesheet, and a thumbnail
// that refuses to open is a bug nobody would look for in a CSS reorder.

import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

// The signing round trip is not what is under test here. Returning the URL
// straight back skips the pending state and leaves the real component doing
// everything else it normally does.
vi.mock('../src/lib/signedImage', () => ({
  useSignedImage: (url: string) => ({ data: url, isPending: false, error: null }),
}));

import { RichText } from '../src/components/RichText';

// The local stack's URL, which is what `lib/env` falls back to under vitest.
// Anything else is refused by `isSafeImageSrc` and never becomes a picture.
const OURS = 'http://127.0.0.1:54321/storage/v1/object/public/post-images';

function figureFor(markup: string): HTMLElement {
  render(<RichText body={markup} />);
  const figure = document.querySelector('figure');
  if (figure === null) {
    throw new Error(`no picture rendered for: ${markup}`);
  }
  return figure as HTMLElement;
}

test('the middle size is the plain one, with no size class at all', () => {
  expect(figureFor(`![map](${OURS}/a.png)`).className).toBe('rich-image');
});

test('a small picture is marked small and starts closed', () => {
  const figure = figureFor(`![icon](${OURS}/a.png){small}`);

  expect(figure.className).toContain('rich-image-small');
  expect(figure.className).not.toContain('rich-image-expanded');
});

test('a wide picture starts open, because the author already decided', () => {
  const figure = figureFor(`![map](${OURS}/a.png){wide}`);

  expect(figure.className).toContain('rich-image-expanded');
});

test('opening a small picture drops the small class rather than stacking it', () => {
  // The whole reason `figureClass` exists. Both classes on one figure would
  // leave the outcome to stylesheet order.
  const figure = figureFor(`![icon](${OURS}/a.png){small}`);
  fireEvent.click(screen.getByRole('button'));

  expect(figure.className).toContain('rich-image-expanded');
  expect(figure.className).not.toContain('rich-image-small');
});

test('a small picture is still openable — the author sized it, they did not hide it', () => {
  const figure = figureFor(`![icon](${OURS}/a.png){small}`);
  const button = screen.getByRole('button');

  expect(button.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(button);
  expect(figure.className).toContain('rich-image-expanded');
});
