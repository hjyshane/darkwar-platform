// The row under a post: previous, the list, next.
//
// Rendered against a seeded cache rather than a mocked supabase client — the
// component reads useNeighbours, and seeding its key answers it with what the
// database would have said. What is pinned here is the SHAPE the reader gets:
// which side each neighbour lands on, that an end of the board still occupies
// its place, and that the list link is present at the bottom rather than only
// above the title.
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { BoardPostPage } from '../src/features/board/BoardPost';
import { GUIDES } from '../src/features/board/board';
import { guideHash } from '../src/lib/route';
import { renderWithQuery } from './renderWithQuery';

const POST_ID = '00000000-0000-4000-8000-00000000b001';
const NEWER = '00000000-0000-4000-8000-00000000b002';
const OLDER = '00000000-0000-4000-8000-00000000b003';

/** What the post query and the neighbours query would have returned. */
function seed(neighbours: {
  newer: { id: string; title: string } | null;
  older: { id: string; title: string } | null;
}) {
  return [
    [
      ['post', 'guides', POST_ID],
      {
        post: {
          id: POST_ID,
          title: 'Rally timings',
          body: 'Join at the whistle.',
          pinned: false,
          liveAt: '2026-08-05T10:00:00Z',
          createdAt: '2026-08-05T10:00:00Z',
          updatedAt: '2026-08-05T10:00:00Z',
          createdBy: 'u1',
          tag: 'combat',
        },
        author: 'Hyoju',
      },
    ],
    [['board-neighbours', 'guides', POST_ID], neighbours],
  ] as const;
}

function renderPost(neighbours: Parameters<typeof seed>[0]) {
  return renderWithQuery(
    <BoardPostPage
      backHref="#/guides"
      backLabel="All guides"
      config={GUIDES}
      hrefFor={guideHash}
      postId={POST_ID}
      tagLabel={(tag) => tag}
    />,
    seed(neighbours),
  );
}

test('the neighbours sit either side of the list link, newest on the left', () => {
  renderPost({
    newer: { id: NEWER, title: 'Newer guide' },
    older: { id: OLDER, title: 'Older guide' },
  });
  const nav = screen.getByRole('navigation', { name: 'More on this board' });
  const links = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  // Order in the DOM is the order on screen: newer, the list, older.
  expect(links).toEqual([guideHash(NEWER), '#/guides', guideHash(OLDER)]);
  // Titles, not bare arrows — "Next →" says nothing about whether to press it.
  expect(nav.textContent).toContain('Newer guide');
  expect(nav.textContent).toContain('Older guide');
});

test('an end of the board keeps its place in the row', () => {
  renderPost({ newer: null, older: { id: OLDER, title: 'Older guide' } });
  const nav = screen.getByRole('navigation', { name: 'More on this board' });
  expect(nav.textContent).toContain('Newest here');
  // The list link survives the missing neighbour: losing navigation entirely
  // because a post happens to be the newest would strand the reader.
  expect(nav.querySelector('a[href="#/guides"]')).not.toBeNull();
});

test('the way back to the list is at the bottom, where a finished reader is', () => {
  renderPost({ newer: null, older: null });
  const nav = screen.getByRole('navigation', { name: 'More on this board' });
  expect(nav.querySelector('a[href="#/guides"]')?.textContent).toBe('All guides');
});

// The masthead: the same facts the grey line carried, now in a block of their
// own. Pinned on the STRUCTURE rather than the styling — a rule that moves is a
// refinement, a category that stops rendering is a regression.
test('who, when and what kind are a header, set apart from the body', () => {
  renderPost({ newer: null, older: null });
  const header = document.querySelector('.post-header');
  expect(header).not.toBeNull();
  expect(header?.querySelector('h2')?.textContent).toContain('Rally timings');
  expect(header?.querySelector('.post-tag')?.textContent).toBe('combat');
  expect(header?.querySelector('.post-author')?.textContent).toBe('Hyoju');
  // A machine-readable date as well as the printed one.
  expect(header?.querySelector('time')?.getAttribute('dateTime')).toBe('2026-08-05T10:00:00Z');
  // And the body is outside it.
  expect(header?.textContent).not.toContain('Join at the whistle');
});

test('an unedited post says nothing about being edited', () => {
  renderPost({ newer: null, older: null });
  expect(document.querySelector('.post-edited')).toBeNull();
});
