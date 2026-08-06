// An off-by-one in a range gives a page that repeats a row or skips one, and
// neither looks like a bug from the outside. Hence the arithmetic being pure and
// tested rather than inline in the component.
import { describe, expect, test } from 'vitest';
import { pageNumbers, pageOf } from '../src/lib/pagination';

describe('pageOf', () => {
  test('the first page starts at nothing and ends at size minus one', () => {
    expect(pageOf(100, 1, 20)).toEqual({ page: 1, pageCount: 5, from: 0, to: 19 });
  });

  // The join, where a repeated or skipped row would show.
  test('consecutive pages meet exactly', () => {
    const first = pageOf(100, 1, 20);
    const second = pageOf(100, 2, 20);
    expect(second.from).toBe(first.to + 1);
  });

  test('a partial last page keeps the full range', () => {
    // 45 rows, 20 a page: page 3 asks for 40-59 and gets five. Trimming `to` to
    // the row count would be arithmetic PostgREST already does.
    expect(pageOf(45, 3, 20)).toEqual({ page: 3, pageCount: 3, from: 40, to: 59 });
  });

  // Delete the last post on page 3 and page 3 no longer exists. Unclamped, the
  // offset asks for rows past the end and the board renders empty — which reads
  // as broken rather than as "that page is gone".
  test('a page past the end is clamped to the last one', () => {
    expect(pageOf(45, 9, 20).page).toBe(3);
    expect(pageOf(45, 0, 20).page).toBe(1);
    expect(pageOf(45, -4, 20).page).toBe(1);
  });

  // An empty board still has one page. Zero would divide the pager by nothing and
  // render no buttons at all, which is right, but `pageCount: 0` also makes
  // "page 1 of 0" appear anywhere it is printed.
  test('an empty board is one empty page', () => {
    expect(pageOf(0, 1, 20)).toEqual({ page: 1, pageCount: 1, from: 0, to: 19 });
  });

  test('exactly one full page is one page, not two', () => {
    expect(pageOf(20, 1, 20).pageCount).toBe(1);
    expect(pageOf(21, 1, 20).pageCount).toBe(2);
  });
});

describe('pageNumbers', () => {
  test('every page when they fit', () => {
    expect(pageNumbers(4, 1, 7)).toEqual([1, 2, 3, 4]);
  });

  // The width has to stay constant, or the row reflows under the cursor and you
  // click twice.
  test('the window is always the same size once it is full', () => {
    for (const page of [1, 2, 8, 19, 20]) {
      expect(pageNumbers(20, page, 7)).toHaveLength(7);
    }
  });

  test('it shifts at the ends rather than truncating', () => {
    expect(pageNumbers(20, 1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageNumbers(20, 20, 7)).toEqual([14, 15, 16, 17, 18, 19, 20]);
  });

  test('and centres in the middle', () => {
    expect(pageNumbers(20, 10, 7)).toEqual([7, 8, 9, 10, 11, 12, 13]);
  });

  test('the current page is always in the window', () => {
    for (let page = 1; page <= 20; page += 1) {
      expect(pageNumbers(20, page, 7)).toContain(page);
    }
  });
});
