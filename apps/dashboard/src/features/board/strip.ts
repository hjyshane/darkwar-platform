// The figures at the head of the Notices and Guides screens, from the page of
// posts already loaded. Pure, so what the strip claims can be checked on its own.
//
// "Unread" and "newest" are about the posts on this page and the pinned ones, not
// the whole board: the board is paged, and a count that looked like the whole
// board's would be wrong on page two.

import type { StripCell } from '../../components/Strip';
import { formatAge } from '../../lib/freshness';
import type { BoardPage, BoardPost } from './board';

const plain = new Intl.NumberFormat('en');

/** The pinned posts and the page's own, once each: a post that is both is not two. */
function shown(page: Pick<BoardPage, 'pinned' | 'posts'>): BoardPost[] {
  const seen = new Set<string>();
  return [...page.pinned, ...page.posts].filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });
}

export function boardStrip(
  page: Pick<BoardPage, 'pinned' | 'posts' | 'total' | 'read'>,
  noun: 'notice' | 'guide',
  now: Date,
): StripCell[] {
  const posts = shown(page);
  const unread = posts.filter((post) => !page.read.has(post.id)).length;
  const newest = [...posts].sort((a, b) =>
    (b.liveAt ?? b.createdAt).localeCompare(a.liveAt ?? a.createdAt),
  )[0];
  return [
    {
      label: `${noun === 'notice' ? 'Notices' : 'Guides'} posted`,
      value: plain.format(page.total),
    },
    {
      label: 'Pinned',
      value: plain.format(page.pinned.length),
      note: page.pinned.length === 0 ? 'none' : 'kept at the top',
    },
    {
      label: 'Unread',
      value: plain.format(unread),
      note: 'on this page, and the pinned ones',
    },
    {
      label: 'Newest',
      value: newest === undefined ? null : newest.title,
      note: newest === undefined ? undefined : formatAge(newest.liveAt ?? newest.createdAt, now),
    },
  ];
}
