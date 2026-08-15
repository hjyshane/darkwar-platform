import { describe, expect, test } from 'vitest';
import { type ViewStat, hotPostIds, topPostId } from '../src/features/board/views';

/** Which post gets "hot" and which gets "top" (0119).
 *
 * Two tags answering two questions, and the tests worth having are the ones
 * that prove they are not the same question: a post can be the most-read on
 * the board and not be hot, and a brand-new thread can be hot without being
 * anywhere near the top.
 */
const stat = (total: number, recent: number): ViewStat => ({ total, recent });

describe('hotPostIds', () => {
  test('scores a comment higher than an open', () => {
    // Two comments (6) clears the floor on its own; four views (4) does not.
    const hot = hotPostIds({ talky: stat(2, 2), glanced: stat(4, 4) }, { talky: 2 }, [
      'talky',
      'glanced',
    ]);

    expect(hot.has('talky')).toBe(true);
    expect(hot.has('glanced')).toBe(false);
  });

  test('ignores views older than the window', () => {
    // A famous old post: 500 opens all time, none this week. "Hot" is about
    // now, and a post that stops being read has to lose it.
    const hot = hotPostIds({ famous: stat(500, 0) }, {}, ['famous']);

    expect(hot.size).toBe(0);
  });

  test('is empty when nothing has happened', () => {
    expect(hotPostIds({}, {}, ['quiet']).size).toBe(0);
  });
});

describe('topPostId', () => {
  test('picks the most-read post all time, not the busiest this week', () => {
    // The exact opposite of the hot case above, on the same shape of data.
    const top = topPostId({ famous: stat(500, 0), busy: stat(9, 9) }, ['famous', 'busy']);

    expect(top).toBe('famous');
  });

  test('is null when nothing has been read', () => {
    // Rather than crowning a post with zero views, which would put a "top"
    // badge on an empty board.
    expect(topPostId({}, ['a', 'b'])).toBeNull();
  });

  test('breaks a tie towards board order, which is newest first', () => {
    const top = topPostId({ older: stat(5, 0), newer: stat(5, 0) }, ['newer', 'older']);

    expect(top).toBe('newer');
  });

  test('only considers posts on screen', () => {
    // The board pages, so "the most read post" means the most read one the
    // reader can actually see — a page-two winner must not tag page one.
    const top = topPostId({ offscreen: stat(999, 0), shown: stat(3, 0) }, ['shown']);

    expect(top).toBe('shown');
  });
});
