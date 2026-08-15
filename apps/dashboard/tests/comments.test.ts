import { describe, expect, test } from 'vitest';
import {
  type BoardComment,
  type CommentThread,
  groupComments,
} from '../src/features/board/comments';

/** Grouping a flat comment list into threads.
 *
 * The rules worth pinning are all about the soft delete, because that is the
 * part where "removed" and "gone" are deliberately different things: a removed
 * comment that is holding up a reply has to stay as a tombstone, and one that
 * is holding up nothing has to disappear entirely. Getting either backwards
 * looks like a rendering fault to whoever is reading the thread.
 */
function comment(overrides: Partial<BoardComment> & { id: string }): BoardComment {
  return {
    parentId: null,
    authorId: 'author-1',
    body: 'text',
    createdAt: '2026-08-13T10:00:00Z',
    updatedAt: '2026-08-13T10:00:00Z',
    deletedAt: null,
    ...overrides,
  };
}

/** The whole result in one comparable shape.
 *
 * Asserted as a single structure rather than by indexing into `threads[0]`,
 * which under `noUncheckedIndexedAccess` is possibly-undefined and, more to the
 * point, silently passes when the array is shorter than the test assumed. */
function shape(threads: readonly CommentThread[]) {
  return threads.map((thread) => ({
    id: thread.comment.id,
    removed: thread.comment.deletedAt !== null,
    replies: thread.replies.map((reply) => reply.id),
  }));
}

describe('groupComments', () => {
  test('hangs replies under the comment they answer', () => {
    const threads = groupComments([
      comment({ id: 'a' }),
      comment({ id: 'b' }),
      comment({ id: 'a-reply', parentId: 'a' }),
    ]);

    expect(shape(threads)).toEqual([
      { id: 'a', removed: false, replies: ['a-reply'] },
      { id: 'b', removed: false, replies: [] },
    ]);
  });

  test('keeps a deleted comment that still has a reply under it', () => {
    const threads = groupComments([
      comment({ id: 'a', deletedAt: '2026-08-13T11:00:00Z' }),
      comment({ id: 'a-reply', parentId: 'a' }),
    ]);

    // The whole reason deleted_at exists rather than a DELETE: the answer must
    // not lose its question.
    expect(shape(threads)).toEqual([{ id: 'a', removed: true, replies: ['a-reply'] }]);
  });

  test('drops a deleted comment that is holding nothing up', () => {
    const threads = groupComments([
      comment({ id: 'a', deletedAt: '2026-08-13T11:00:00Z' }),
      comment({ id: 'b' }),
    ]);

    expect(threads.map((thread) => thread.comment.id)).toEqual(['b']);
  });

  test('drops a deleted reply, and its parent with it when nothing else remains', () => {
    const threads = groupComments([
      comment({ id: 'a', deletedAt: '2026-08-13T11:00:00Z' }),
      comment({ id: 'a-reply', parentId: 'a', deletedAt: '2026-08-13T12:00:00Z' }),
    ]);

    // A tombstone propping up another tombstone is litter, not a thread.
    expect(threads).toEqual([]);
  });

  test('keeps a live comment whose only reply was deleted', () => {
    const threads = groupComments([
      comment({ id: 'a' }),
      comment({ id: 'a-reply', parentId: 'a', deletedAt: '2026-08-13T12:00:00Z' }),
    ]);

    expect(shape(threads)).toEqual([{ id: 'a', removed: false, replies: [] }]);
  });

  test('preserves the order it was given, which is oldest first', () => {
    const threads = groupComments([
      comment({ id: 'a', createdAt: '2026-08-13T10:00:00Z' }),
      comment({ id: 'a-r1', parentId: 'a', createdAt: '2026-08-13T10:05:00Z' }),
      comment({ id: 'a-r2', parentId: 'a', createdAt: '2026-08-13T10:09:00Z' }),
    ]);

    // A conversation read newest-first delivers the answers before the
    // question, so the query orders ascending and this must not resort it.
    expect(shape(threads)).toEqual([{ id: 'a', removed: false, replies: ['a-r1', 'a-r2'] }]);
  });

  test('is empty for a post nobody has commented on', () => {
    expect(groupComments([])).toEqual([]);
  });
});
