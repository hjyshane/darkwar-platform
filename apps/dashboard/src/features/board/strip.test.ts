import { describe, expect, test } from 'vitest';
import type { BoardPost } from './board';
import { boardStrip } from './strip';

const NOW = new Date('2026-10-10T12:00:00Z');

const post = (id: string, over: Partial<BoardPost> = {}): BoardPost => ({
  id,
  title: `Post ${id}`,
  body: '',
  pinned: false,
  liveAt: '2026-10-09T12:00:00Z',
  createdAt: '2026-10-09T12:00:00Z',
  updatedAt: '2026-10-09T12:00:00Z',
  createdBy: null,
  tag: null,
  ...over,
});

const page = (posts: BoardPost[], pinned: BoardPost[] = [], read: string[] = [], total = 5) => ({
  posts,
  pinned,
  total,
  read: new Set(read),
});

const cell = (p: ReturnType<typeof page>, label: string, noun: 'notice' | 'guide' = 'notice') =>
  boardStrip(p, noun, NOW).find((entry) => entry.label === label);

describe('boardStrip', () => {
  test('names the board in the first figure, and counts the whole board, not the page', () => {
    expect(cell(page([post('a')]), 'Notices posted')?.value).toBe('5');
    expect(cell(page([post('a')]), 'Guides posted', 'guide')?.value).toBe('5');
  });

  test('counts the pinned posts, and says so when there are none', () => {
    expect(cell(page([], [post('p', { pinned: true })]), 'Pinned')).toMatchObject({
      value: '1',
      note: 'kept at the top',
    });
    expect(cell(page([post('a')]), 'Pinned')).toMatchObject({ value: '0', note: 'none' });
  });

  test('counts the unread ones on the page and the pinned ones, a post in both once', () => {
    const pinned = post('p', { pinned: true });
    const p = page([pinned, post('a'), post('b')], [pinned], ['b']);

    expect(cell(p, 'Unread')?.value).toBe('2');
  });

  test('names the newest post and how long ago it went live', () => {
    const p = page([
      post('old', { liveAt: '2026-10-08T12:00:00Z', title: 'Old one' }),
      post('new', { liveAt: '2026-10-10T11:00:00Z', title: 'New one' }),
    ]);

    expect(cell(p, 'Newest')).toMatchObject({ value: 'New one', note: '1h ago' });
  });

  test('uses the created time for a post with no live time', () => {
    const p = page([post('draft', { liveAt: null, createdAt: '2026-10-10T09:00:00Z' })]);

    expect(cell(p, 'Newest')?.note).toBe('3h ago');
  });

  test('has nothing to name on an empty board, and says zero', () => {
    const empty = page([], [], [], 0);

    expect(cell(empty, 'Newest')?.value).toBeNull();
    expect(cell(empty, 'Unread')?.value).toBe('0');
  });
});
