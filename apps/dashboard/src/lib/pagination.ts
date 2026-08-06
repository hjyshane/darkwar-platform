// Which page numbers to show, and which rows are on the current one.
//
// Pure, because the arithmetic is where a pager goes wrong: an off-by-one in the
// range gives you a page that silently repeats a row or skips one, and neither
// looks like a bug from the outside.

/** Rows per page. Twenty is what fits on a laptop screen without scrolling past
 * the pager, and few enough that a phone is not scrolling for a minute. */
export const PAGE_SIZE = 20;

/** How many numbered buttons at most. Seven keeps the row on one line on a
 * phone; a board with forty pages shows a window rather than forty buttons. */
const WINDOW = 7;

export interface Page {
  /** 1-based, because the buttons say 1. */
  page: number;
  pageCount: number;
  /** Inclusive row offsets, for PostgREST's `range`. */
  from: number;
  to: number;
}

export function pageOf(total: number, page: number, size = PAGE_SIZE): Page {
  const pageCount = Math.max(1, Math.ceil(total / size));
  // Clamped rather than trusted. The page number comes from state a reader can
  // leave behind — delete the last post on page 3 and page 3 no longer exists,
  // and an unclamped offset asks for rows past the end and renders an empty
  // board that looks broken.
  const current = Math.min(Math.max(1, page), pageCount);
  const from = (current - 1) * size;
  return { page: current, pageCount, from, to: from + size - 1 };
}

/** The numbers to draw, windowed around the current page.
 *
 * Always exactly `WINDOW` numbers when there are that many pages, so the row does
 * not change width as you move through it — a pager that reflows under the cursor
 * makes you click twice.
 */
export function pageNumbers(pageCount: number, page: number, window = WINDOW): number[] {
  if (pageCount <= window) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const half = Math.floor(window / 2);
  // Shifted at the ends rather than truncated, which is what keeps the count
  // constant: near page 1 the window starts at 1, near the end it ends at the
  // last page, and in between it is centred.
  const start = Math.min(Math.max(1, page - half), pageCount - window + 1);
  return Array.from({ length: window }, (_, index) => start + index);
}
